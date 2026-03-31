const express = require('express');
const { registerEdahRoute } = require('./routes/edah');
const { registerVghtpeRoute } = require('./routes/vghtpe');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    service: 'playwright-service',
    status: 'ok',
    routes: ['/health', '/search/edah', '/search/vghtpe']
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'playwright-service',
    timestamp: new Date().toISOString()
  });
});

registerEdahRoute(app);
registerVghtpeRoute(app);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: err instanceof Error ? err.message : 'Unexpected server error'
  });
});

app.listen(port, () => {
  console.log(`playwright-service listening on port ${port}`);
});
