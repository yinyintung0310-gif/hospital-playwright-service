# Playwright Service

This is a small browser-automation API for hospital workflows that are too fragile for pure n8n HTTP requests.

## What it does now

- `GET /health`
- `POST /search/edah`

Example request:

```bash
curl -X POST http://localhost:3000/search/edah \
  -H 'Content-Type: application/json' \
  -d '{"keyword":"febuxostat"}'
```

## Response shape

The service returns the same high-level shape that n8n can merge into the existing hospital results:

```json
{
  "hospitalId": "edah",
  "hospitalName": "義大醫院",
  "source": "playwright-service",
  "status": "success",
  "keyword": "febuxostat",
  "searchUrl": "https://www.edah.org.tw/medicine/",
  "results": [
    {
      "genericName": "Febuxostat",
      "chineseName": "福避痛膜衣錠",
      "brandName": "Feburic",
      "strength": "80mg/tab"
    }
  ]
}
```

## Local run

```bash
npm install
npm start
```

## Railway

This project includes a `Dockerfile`, so Railway can deploy it as a Docker service.

Suggested first deployment flow:

1. Push this folder to a git repo.
2. In Railway, create a new project from that repo.
3. Let Railway detect the `Dockerfile`.
4. After deploy, verify:
   - `GET /health`
   - `POST /search/edah`

## Notes

- The EDAH route is intentionally a first-pass scaffold.
- It gives you a real Playwright service shape and deployment baseline.
- After the first deploy, the next step is to tune selectors and parsing against the live EDAH page.

