const { withBrowser } = require('../lib/browser');
const { successResponse, errorResponse } = require('../lib/response');

const MMH = {
  hospitalId: 'mmh',
  hospitalName: '馬偕紀念醫院',
  searchUrl: 'https://mcloud.mmh.org.tw/DMZDrugFormB817/DrugQuery.html',
  apiUrl: 'https://mcloud.mmh.org.tw/DMZDrugFormB817/api/GetDrug',
  apiIpv4: '60.251.96.49'
};

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractStrength(...values) {
  const text = values.map(clean).filter(Boolean).join(' ');
  const match = text.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|mL|IU|units|%)\s*(?:\/\s*[A-Za-z]+)?/i);
  return match ? clean(match[0]) : '';
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

      const bodyText = clean(await page.textContent('body').catch(() => ''));
      if (/request rejected|access denied|forbidden/i.test(bodyText)) {
        throw new Error(`MMH page access blocked. BODY: ${bodyText.slice(0, 240)}`);
      }

      const apiResult = await page.evaluate(async ({ apiUrl, keyword: currentKeyword }) => {
        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'X-Requested-With': 'XMLHttpRequest',
              Accept: 'application/json, text/javascript, */*; q=0.01'
            },
            body: JSON.stringify({
              data: {
                TYPE: '',
                DRUG: currentKeyword.trim(),
                IMG: 'N',
                myHospital: '1'
              }
            })
          });

          const text = await response.text();
          return {
            ok: response.ok,
            status: response.status,
            text
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            text: '',
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }, { apiUrl: MMH.apiUrl, keyword });

      if (apiResult.error) {
        throw new Error(`MMH browser fetch failed: ${apiResult.error}`);
      }

      if (!apiResult.ok) {
        throw new Error(`MMH API failed (${apiResult.status}). Body: ${clean(apiResult.text).slice(0, 240)}`);
      }

      let json;
      try {
        json = JSON.parse(apiResult.text);
      } catch (_error) {
        throw new Error(`MMH API did not return JSON. Body: ${clean(apiResult.text).slice(0, 240)}`);
      }

      if (!Array.isArray(json)) {
        throw new Error(`MMH API returned unexpected payload. Body: ${clean(apiResult.text).slice(0, 240)}`);
      }

      const results = json
        .filter((item) => clean(item.Status).toUpperCase() === 'Y')
        .map((item) => {
          const code = clean(item.mcode);
          return {
            code,
            genericName: clean(item.generic),
            brandName: clean(item.ename),
            chineseName: clean(item.cname),
            strength: extractStrength(item.ename, item.generic, item.cname),
            detailUrl: code ? new URL(`DrugQuery1.html?mcode=${encodeURIComponent(code)}`, MMH.searchUrl).toString() : '',
            indication: clean(item.indication),
            appearance: clean(item.appear_t),
            precautions: clean(item.patnote),
            storage: clean(item.tore),
            insuranceCode: clean(item.nhi_c),
            licenseUrl: clean(item.license)
          };
        });

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
            code: '23738',
            genericName: 'Febuxostat 80mg FC tab',
            brandName: 'Febuton F.C. Tablets 80mg (Febuxostat)',
            chineseName: '達理痛膜衣錠80毫克',
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
