const { withBrowser } = require('../lib/browser');
const { successResponse, errorResponse } = require('../lib/response');

const MMH = {
  hospitalId: 'mmh',
  hospitalName: '馬偕紀念醫院',
  searchUrl: 'https://mcloud.mmh.org.tw/DMZDrugFormB817/DrugQuery.html'
};

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractStrength(...values) {
  const text = values.map(clean).filter(Boolean).join(' ');
  const match = text.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|mL|IU|units|%)\s*(?:\/\s*[A-Za-z]+)?/i);
  return match ? clean(match[0]) : '';
}

async function callGetDrug(page, payload) {
  return page.evaluate(async (requestPayload) => {
    const response = await fetch('api/GetDrug', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ data: requestPayload })
    });

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_error) {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      text,
      json
    };
  }, payload);
}

async function searchMmh(keyword) {
  return withBrowser(async (browser) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1024 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
      await page.goto(MMH.searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      if (!(await page.locator('#txtDrug').count())) {
        throw new Error(`MMH search form did not render. Current URL: ${page.url()}`);
      }

      const searchResponse = await callGetDrug(page, {
        TYPE: '',
        DRUG: keyword.trim(),
        IMG: 'N',
        myHospital: '1'
      });

      if (!searchResponse.ok || !Array.isArray(searchResponse.json)) {
        throw new Error(`MMH search API failed (${searchResponse.status}). Body: ${clean(searchResponse.text).slice(0, 240)}`);
      }

      const matches = searchResponse.json.filter((item) => clean(item.Status).toUpperCase() === 'Y');
      const results = [];

      for (const match of matches) {
        const code = clean(match.mcode);
        const detailResponse = code
          ? await callGetDrug(page, {
              TYPE: '',
              DRUG: code,
              IMG: 'Y',
              myHospital: '1'
            })
          : null;
        const detailItem = Array.isArray(detailResponse?.json) ? detailResponse.json[0] : null;

        results.push({
          code,
          genericName: clean(detailItem?.generic || match.generic),
          brandName: clean(detailItem?.ename || match.ename),
          chineseName: clean(detailItem?.cname || match.cname),
          strength: extractStrength(
            detailItem?.ename,
            detailItem?.generic,
            match.ename,
            match.generic,
            match.cname
          ),
          detailUrl: code ? new URL(`DrugQuery1.html?mcode=${encodeURIComponent(code)}`, MMH.searchUrl).toString() : '',
          indication: clean(detailItem?.indication),
          appearance: clean(detailItem?.appear_t),
          precautions: clean(detailItem?.patnote),
          storage: clean(detailItem?.tore),
          insuranceCode: clean(detailItem?.nhi_c)
        });
      }

      return successResponse({ ...MMH, keyword, results });
    } finally {
      await context.close();
    }
  });
}

function registerMmhRoute(app) {
  app.post('/search/mmh', async (req, res) => {
    const keyword = String(req.body?.keyword || '').trim();
    if (!keyword) {
      return res.status(400).json({ error: 'keyword is required' });
    }

    if (process.env.MOCK_MMH === 'true') {
      return res.json(successResponse({
        ...MMH,
        keyword,
        results: [
          {
            code: '28403',
            genericName: 'Febuxostat',
            brandName: 'Feburic F.C. Tablets',
            chineseName: '福避痛膜衣錠',
            strength: '80mg'
          }
        ]
      }));
    }

    try {
      const data = await searchMmh(keyword);
      res.json(data);
    } catch (error) {
      res.status(200).json(errorResponse({
        ...MMH,
        keyword,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  });
}

module.exports = { registerMmhRoute };
