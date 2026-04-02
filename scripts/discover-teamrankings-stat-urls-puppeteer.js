const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
      pragma: 'no-cache',
      'cache-control': 'no-cache',
    });
    await page.goto('https://www.teamrankings.com/ncb/stats/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Click all section toggles so hidden links become visible.
    const sectionCount = await page.$$eval('ul.chooser-list .expand-section', (nodes) => nodes.length);
    for (let i = 0; i < sectionCount; i += 1) {
      // Re-query each loop in case DOM changes after click.
      const toggles = await page.$$('ul.chooser-list .expand-section');
      if (!toggles[i]) {
        continue;
      }
      await toggles[i].click();
      await sleep(40);
    }

    const urls = await page.$$eval('ul.chooser-list a[href]', (anchors) => {
      const toAbsolute = (href) => {
        try {
          return new URL(href, 'https://www.teamrankings.com').toString();
        } catch {
          return '';
        }
      };

      return [...new Set(
        anchors
          .map((anchor) => anchor.getAttribute('href') || '')
          .map((href) => toAbsolute(href))
          .filter((href) => href.includes('/ncaa-basketball/stat/'))
      )].sort();
    });

    const outputPath = path.resolve(process.cwd(), 'output', 'teamrankings-ncb-stat-urls.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(urls, null, 2)}\n`, 'utf8');

    console.log(`Found ${urls.length} stat URLs.`);
    console.log(`Saved: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error('Failed to discover TeamRankings stat URLs:', error);
  process.exit(1);
});
