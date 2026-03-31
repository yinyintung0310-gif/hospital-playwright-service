const { chromium } = require('playwright');

async function withBrowser(task) {
  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args: ['--disable-dev-shm-usage']
  });

  try {
    return await task(browser);
  } finally {
    await browser.close();
  }
}

module.exports = { withBrowser };

