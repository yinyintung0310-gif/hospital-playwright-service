const { withBrowser } = require('../lib/browser');
const { successResponse, errorResponse } = require('../lib/response');

const EDAH = {
  hospitalId: 'edah',
  hospitalName: '義大醫院',
  searchUrl: 'https://dept.edah.org.tw/ph/asp/search.asp?TAB=1&orgby=ED'
};

async function extractResults(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tr'));
    const results = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 8) continue;

      const genericName = (cells[0].innerText || '').replace(/\s+/g, ' ').trim();
      const code = (cells[1].innerText || '').replace(/\s+/g, ' ').trim();
      const brandName = (cells[2].innerText || '').replace(/\s+/g, ' ').trim();
      const chineseName = (cells[3].innerText || '').replace(/\s+/g, ' ').trim();
      const strength = (cells[4].innerText || '').replace(/\s+/g, ' ').trim();
      const pregnancyCategory = (cells[6].innerText || '').replace(/\s+/g, ' ').trim();

      if (!genericName || !code || !brandName) continue;
      if (genericName === '學名' || brandName === '商品名') continue;

      const detailHref = row.querySelector('a[href*="med_d.asp"]')?.getAttribute('href') || '';
      const imageSrc = row.querySelector('img')?.getAttribute('src') || '';

      results.push({
        genericName,
        chineseName,
        brandName,
        strength,
        code,
        pregnancyCategory,
        detailUrl: detailHref ? new URL(detailHref, window.location.href).toString() : '',
        imageUrl: imageSrc ? new URL(imageSrc, window.location.href).toString() : ''
      });
    }

    return results;
  });
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

      const genericInput = page.locator('#SCI_NAME');
      const submitButton = page.locator('input[type="submit"][value="查詢"]').first();

      if (!(await genericInput.count())) {
        throw new Error(`EDAH search form did not render. Current URL: ${page.url()}`);
      }

      await genericInput.fill(keyword.toLowerCase());

      await Promise.all([
        page.waitForURL(/med\.asp/i, { timeout: 20000 }).catch(() => {}),
        page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
        submitButton.click()
      ]);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      const results = await extractResults(page);
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
            chineseName: '達理痛膜衣錠',
            brandName: 'Febuton',
            strength: '80mg/FC. tab',
            code: 'KFEBUXO'
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
