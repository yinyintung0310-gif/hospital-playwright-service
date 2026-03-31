const https = require('https');
const { successResponse, errorResponse } = require('../lib/response');

const MMH = {
  hospitalId: 'mmh',
  hospitalName: '馬偕紀念醫院',
  searchUrl: 'https://mcloud.mmh.org.tw/DMZDrugFormB817/DrugQuery.html',
  apiUrl: 'https://mcloud.mmh.org.tw/DMZDrugFormB817/api/GetDrug'
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
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

  const payload = JSON.stringify({
    data: {
      TYPE: '',
      DRUG: keyword.trim(),
      IMG: 'N',
      myHospital: '1'
    }
  });

  const url = new URL(MMH.apiUrl);
  const text = await new Promise((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://mcloud.mmh.org.tw',
        Referer: MMH.searchUrl
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode || 0) >= 400) {
          reject(new Error(`MMH API failed (${response.statusCode}). Body: ${clean(body).slice(0, 240)}`));
          return;
        }
        resolve(body);
      });
    });

    request.on('error', (error) => {
      reject(new Error(`MMH HTTPS request failed: ${error.message}`));
    });

    request.write(payload);
    request.end();
  });

  let json;
  try {
    json = JSON.parse(text);
  } catch (_error) {
    throw new Error(`MMH API did not return JSON. Body: ${clean(text).slice(0, 240)}`);
  }

  if (!Array.isArray(json)) {
    throw new Error(`MMH API returned unexpected payload. Body: ${clean(text).slice(0, 240)}`);
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
