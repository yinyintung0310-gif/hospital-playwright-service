const { withBrowser } = require('../lib/browser');
const { successResponse, errorResponse } = require('../lib/response');

const EDAH = {
  hospitalId: 'edah',
  hospitalName: '義大醫院',
  searchUrl: 'https://www.edah.org.tw/medicine/'
};

const SEARCH_SELECTORS = [
  'input[type="search"]',
  'input[name*="drug" i]',
  'input[id*="drug" i]',
  'input[name*="keyword" i]',
  'input[id*="keyword" i]',
  'input[name*="query" i]',
  'input[id*="query" i]',
  'input[type="text"]'
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("查詢")',
  'button:has-text("搜尋")',
  'input[value*="查詢"]',
  'input[value*="搜尋"]'
];

async function findFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const handle = page.locator(selector).first();
    if (await handle.count()) {
      try {
        if (await handle.isVisible({ timeout: 500 })) return handle;
      } catch {
        // ignore and try the next candidate
      }
    }
  }
  return null;
}

async function extractRows(page, keyword) {
  const lowerKeyword = keyword.toLowerCase();
  return await page.evaluate((kw) => {
    const rows = [];
    const candidates = Array.from(document.querySelectorAll('table tr, .table tr, .card, .result, .search-result li'));

    for (const el of candidates) {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (!text.toLowerCase().includes(kw)) continue;

      const matchStrength = text.match(/(\d+(?:\.\d+)?)\s*(mg|ml|mcg|g|iu|u)\b/i);
      rows.push({
        genericName: text.match(/[A-Z][A-Za-z0-9\-]*(?:\s+[A-Za-z0-9\-]+){0,5}/)?.[0] || '',
        chineseName: text.match(/[\u4e00-\u9fff]{2,20}/)?.[0] || '',
        brandName: '',
        strength: matchStrength ? `${matchStrength[1]}${matchStrength[2]}` : '',
        rawText: text
      });
    }

    return rows;
  }, lowerKeyword);
}

async function searchEdah(keyword) {
  return withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1024 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
      await page.goto(EDAH.searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      const input = await findFirstVisible(page, SEARCH_SELECTORS);
      if (!input) {
        throw new Error('Could not find a searchable input on the EDAH page.');
      }

      await input.click();
      await input.fill(keyword);

      const submit = await findFirstVisible(page, SUBMIT_SELECTORS);
      if (submit) {
        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
          submit.click()
        ]);
      } else {
        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
          input.press('Enter')
        ]);
      }

      const rows = await extractRows(page, keyword);
      const results = rows.map((row) => ({
        genericName: row.genericName,
        chineseName: row.chineseName,
        brandName: row.brandName,
        strength: row.strength,
        rawText: row.rawText
      }));

      return successResponse({ ...EDAH, keyword, results });
    } finally {
      await context.close();
    }
  });
}

function registerEdahRoute(app) {
  app.post('/search/edah', async (req, res) => {
    const keyword = String(req.body?.keyword || '').trim();
    if (!keyword) {
      return res.status(400).json({ error: 'keyword is required' });
    }

    if (process.env.MOCK_EDAH === 'true') {
      return res.json(successResponse({
        ...EDAH,
        keyword,
        results: [
          {
            genericName: 'Febuxostat',
            chineseName: '福避痛膜衣錠',
            brandName: 'Feburic',
            strength: '80mg/tab'
          }
        ]
      }));
    }

    try {
      const data = await searchEdah(keyword);
      res.json(data);
    } catch (error) {
      res.status(200).json(errorResponse({
        ...EDAH,
        keyword,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  });
}

module.exports = { registerEdahRoute };

