const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

function sanitizeFileName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function scrapeDraftKingsPlayerProps(url, outputDirectory, combinedFileName) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 2200 },
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(7000);

    const marketRowSelector = '.cb-market__template--2-columns-big-cells';
    await page.waitForSelector(marketRowSelector, { timeout: 60000 });

    const players = await page.evaluate(async (rowSelector) => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const cleanText = (value) => (value || '').replace(/\s+/g, ' ').trim();

      const parseOddsFromText = (value) => {
        const match = cleanText(value).match(/[+-]\d{2,4}$/);
        return match ? match[0] : '';
      };

      const getFocusedSelection = (row) => {
        const focused = row.querySelector('.cb-selection-picker__selection--focused');
        if (!focused) {
          return null;
        }

        const lineLabel = cleanText(
          focused.querySelector('.cb-selection-picker__selection-label')?.textContent || ''
        );
        const oddsLabel = cleanText(
          focused.querySelector('.cb-selection-picker__selection-odds')?.textContent ||
            parseOddsFromText(focused.textContent || '')
        );

        if (!lineLabel) {
          return null;
        }

        return {
          line: lineLabel,
          odds: oddsLabel,
          key: `${lineLabel}|${oddsLabel}`,
        };
      };

      const readPlayerStatValue = (row) => {
        const statContainer = row.querySelector('.cb-player-stats');
        if (!statContainer) {
          return '';
        }

        const activeDigits = [...statContainer.querySelectorAll('.cb-player-stats__digit.active')]
          .map((node) => cleanText(node.textContent))
          .filter(Boolean);

        if (activeDigits.length > 0) {
          return activeDigits.join('.');
        }

        const fallback = cleanText(statContainer.textContent || '');
        const numberMatch = fallback.match(/\d+(?:\.\d+)?/);
        return numberMatch ? numberMatch[0] : '';
      };

      const rows = [...document.querySelectorAll(rowSelector)];
      const results = [];

      for (const row of rows) {
        const playerName = cleanText(
          row.querySelector('.cb-player-page-link p, .cb-market__label--truncate-strings')?.textContent || ''
        );
        const statType = cleanText(
          row.querySelector('.cb-player-stats__prefix')?.textContent?.replace(':', '') || ''
        );
        const statValue = readPlayerStatValue(row);

        const leftArrow = row.querySelector('button[data-testid="cb-selection-picker__left-arrow"]');
        const rightArrow = row.querySelector('button[data-testid="cb-selection-picker__right-arrow"]');
        if (!playerName || !leftArrow || !rightArrow) {
          continue;
        }

        // Move to the left-most line first so we capture all available lines.
        let leftGuard = 0;
        while (!leftArrow.disabled && leftGuard < 60) {
          const before = getFocusedSelection(row)?.key || '';
          leftArrow.click();
          await delay(120);
          const after = getFocusedSelection(row)?.key || '';
          leftGuard += 1;
          if (after === before) {
            break;
          }
        }

        const lineMap = new Map();
        let rightGuard = 0;
        while (rightGuard < 80) {
          const focused = getFocusedSelection(row);
          if (focused) {
            lineMap.set(focused.line, {
              line: focused.line,
              odds: focused.odds,
            });
          }

          if (rightArrow.disabled) {
            break;
          }

          const before = focused?.key || '';
          rightArrow.click();
          await delay(120);
          const after = getFocusedSelection(row)?.key || '';
          rightGuard += 1;

          if (after === before) {
            break;
          }
        }

        results.push({
          playerName,
          statType,
          statValue,
          lines: [...lineMap.values()],
        });
      }

      return results;
    }, marketRowSelector);

    await ensureDirectory(outputDirectory);

    const combinedPath = path.join(outputDirectory, combinedFileName);
    await fs.writeFile(combinedPath, `${JSON.stringify(players, null, 2)}\n`, 'utf8');

    return {
      playerCount: players.length,
      outputDirectory,
      combinedPath,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const [, , urlArg, combinedFileNameArg] = process.argv;

  if (!urlArg) {
    console.error('Usage: node scrape-draftkings-props.js <url> [combinedFileName]');
    process.exit(1);
  }

  const outputDirectory = path.resolve(process.cwd(), 'output');
  const combinedFileName = sanitizeFileName(combinedFileNameArg || 'all-players');

  const result = await scrapeDraftKingsPlayerProps(
    urlArg,
    outputDirectory,
    `${combinedFileName}.json`
  );
  console.log(
    `Scraped ${result.playerCount} players. Files written to: ${result.outputDirectory}\nCombined file: ${result.combinedPath}`
  );
}

main().catch((error) => {
  console.error('Scrape failed:', error);
  process.exit(1);
});
