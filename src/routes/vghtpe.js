const { withBrowser } = require('../lib/browser');
const { successResponse, errorResponse } = require('../lib/response');
const { createWorker, PSM } = require('tesseract.js');

const VGHTPE = {
  hospitalId: 'vghtpe',
  hospitalName: '臺北榮民總醫院',
  searchUrl: 'https://www7.vghtpe.gov.tw/home/index'
};

async function waitForSearchForm(page) {
  const input = page.locator('input[name="extConditions[keyWord]"]').first();
  const captchaInput = page.locator('input[name="kapatcha"]').first();
  const submit = page.locator('button[type="submit"], input[type="submit"]').first();
  const deadline = Date.now() + 60000;

  while (Date.now() < deadline) {
    if (await input.count() && await captchaInput.count()) {
      return { input, captchaInput, submit };
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const title = await page.title().catch(() => '');
  throw new Error(`VGHTPE search form did not render. URL: ${page.url()} TITLE: ${title}`);
}

async function markCaptchaElement(page) {
  return page.evaluate(() => {
    const input = document.querySelector('input[name="kapatcha"]');
    if (!input) return '';

    const mark = (node) => {
      if (!node) return '';
      node.setAttribute('data-codex-captcha', '1');
      return '[data-codex-captcha="1"]';
    };

    let node = input.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const candidate = node.querySelector('img, canvas');
      if (candidate) return mark(candidate);
    }

    const inputRect = input.getBoundingClientRect();
    const candidates = Array.from(document.querySelectorAll('img, canvas')).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 40
        && rect.height >= 20
        && Math.abs(rect.top - inputRect.top) < 250
        && Math.abs(rect.left - inputRect.left) < 500;
    });

    return mark(candidates[0] || null);
  });
}

async function recognizeCaptcha(locator) {
  const image = await locator.screenshot();
  const worker = await createWorker('eng');

  try {
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: PSM.SINGLE_WORD
    });
    const { data } = await worker.recognize(image);
    return (data?.text || '').replace(/\D/g, '').slice(0, 4);
  } finally {
    await worker.terminate();
  }
}

async function extractResults(page, keyword) {
  return page.evaluate((searchKeyword) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const keywordLower = searchKeyword.toLowerCase();
    const results = [];
    const rows = Array.from(document.querySelectorAll('table tr'));

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) continue;

      const texts = cells.map((cell) => normalize(cell.innerText)).filter(Boolean);
      if (!texts.length) continue;

      const rowText = texts.join(' | ');
      if (!rowText.toLowerCase().includes(keywordLower)) continue;

      const englishTexts = texts.filter((text) => /[A-Za-z]/.test(text));
      const chineseTexts = texts.filter((text) => /[\u4e00-\u9fff]/.test(text));
      const genericName = englishTexts.find((text) => text.toLowerCase().includes(keywordLower)) || searchKeyword;
      const chineseName = chineseTexts.find((text) => !text.includes('查詢') && !text.includes('藥品')) || '';
      const brandName = englishTexts.find((text) => text !== genericName) || '';
      const strengthMatch = rowText.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)\b(?:\/[A-Za-z.]+)?/i);
      const code = texts.find((text) => /^[A-Z0-9-]{4,}$/i.test(text) && !text.toLowerCase().includes(keywordLower)) || '';
      const link = row.querySelector('a[href]')?.getAttribute('href') || '';

      results.push({
        genericName,
        chineseName,
        brandName,
        strength: strengthMatch ? normalize(strengthMatch[0]) : '',
        code,
        detailUrl: link ? new URL(link, window.location.href).toString() : '',
        rawRow: rowText
      });
    }

    return results;
  }, keyword);
}

async function inspectPage(page) {
  return page.evaluate(() => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
      .map((node) => normalize(node.innerText))
      .filter(Boolean)
      .slice(0, 10);
    const formFields = Array.from(document.querySelectorAll('form input, form select, form textarea, form button'))
      .map((node) => {
        const tag = node.tagName.toLowerCase();
        const type = node.getAttribute('type') || '';
        const name = node.getAttribute('name') || node.getAttribute('id') || '';
        const value = node.getAttribute('value') || '';
        return [tag, type, name, value].filter(Boolean).join(':');
      })
      .filter(Boolean)
      .slice(0, 20);
    const tables = Array.from(document.querySelectorAll('table')).slice(0, 5).map((table, tableIndex) => ({
      tableIndex,
      rows: Array.from(table.querySelectorAll('tr')).slice(0, 8).map((row) =>
        Array.from(row.querySelectorAll('th,td')).map((cell) => normalize(cell.innerText)).filter(Boolean)
      )
    }));
    const alerts = Array.from(document.querySelectorAll('.alert, .warning, .error, .invalid-feedback, .help-block'))
      .map((node) => normalize(node.innerText))
      .filter(Boolean)
      .slice(0, 10);
    const bodyText = normalize(document.body.innerText).slice(0, 1200);

    return {
      title: document.title,
      url: window.location.href,
      headings,
      formFields,
      alerts,
      tables,
      bodyText
    };
  });
}

async function searchVghtpe(keyword) {
  return withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1024 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
      let lastDebug = null;

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await page.goto(VGHTPE.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const { input, captchaInput, submit } = await waitForSearchForm(page);

        const title = await page.title().catch(() => '');
        if (/just a moment/i.test(title)) {
          throw new Error(`VGHTPE Cloudflare challenge not cleared. URL: ${page.url()}`);
        }

        const captchaSelector = await markCaptchaElement(page);
        if (!captchaSelector) {
          const debug = await inspectPage(page);
          throw new Error(`VGHTPE captcha element not found. DEBUG ${JSON.stringify(debug)}`);
        }

        const captchaCode = await recognizeCaptcha(page.locator(captchaSelector).first());
        if (captchaCode.length !== 4) {
          lastDebug = { attempt, captchaCode, reason: 'ocr_not_four_digits' };
          continue;
        }

        await input.fill(keyword.toLowerCase());
        await captchaInput.fill(captchaCode);

        await Promise.all([
          page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
          submit.click()
        ]);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        const results = await extractResults(page, keyword);
        if (results.length > 0) {
          return successResponse({ ...VGHTPE, keyword, results });
        }

        const debug = await inspectPage(page);
        lastDebug = { attempt, captchaCode, debug };

        const bodyLower = (debug.bodyText || '').toLowerCase();
        if (bodyLower.includes('驗證碼') || bodyLower.includes('必須填寫')) {
          continue;
        }

        throw new Error(`VGHTPE returned no parsed results. DEBUG ${JSON.stringify(debug)}`);
      }

      throw new Error(`VGHTPE OCR attempts exhausted. DEBUG ${JSON.stringify(lastDebug)}`);
    } finally {
      await context.close();
    }
  });
}

function registerVghtpeRoute(app) {
  app.post('/search/vghtpe', async (req, res) => {
    const keyword = String(req.body?.keyword || '').trim();
    if (!keyword) {
      return res.status(400).json({ error: 'keyword is required' });
    }

    try {
      const data = await searchVghtpe(keyword);
      res.json(data);
    } catch (error) {
      res.status(200).json(errorResponse({
        ...VGHTPE,
        keyword,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  });
}

module.exports = { registerVghtpeRoute };
