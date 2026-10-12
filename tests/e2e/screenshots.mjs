// Visual check of the popup: screenshots of every view in light and dark.
// Usage: node tests/e2e/screenshots.mjs <output-dir>
// Usage: node tests/e2e/screenshots.mjs <output-dir>
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = process.argv[2];
const server = createServer((q, r) => r.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Smash Bros</title><style>body{font-family:Georgia;background:#f2ede9;color:#0f2c56}button{background:#0f2c56;color:#fff;border-radius:8px;padding:12px 24px}</style><h1>Smash Bros Lyon</h1><p>Burgers.</p><button>Réserver</button><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Ccircle cx='40' cy='40' r='30' fill='%23e8b04a'/%3E%3C/svg%3E"><svg width="24" height="24" aria-label="Star" style="color:#c00"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg><script>fetch('/models/x.glb')</script>`));
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
for (const scheme of ["dark", "light"]) {
  const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "ko-")), { headless: true, channel: "chromium", colorScheme: scheme, args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] });
  let [w] = ctx.serviceWorkers(); if (!w) w = await ctx.waitForEvent("serviceworker");
  const id = new URL(w.url()).host;
  const page = await ctx.newPage(); await page.goto(base); await page.waitForTimeout(800);
  const tabId = await page.evaluate(() => 0);
  const ext = await ctx.newPage();
  await ext.setViewportSize({ width: 560, height: 600 });
  await ext.goto(`chrome-extension://${id}/popup/popup.html`);
  const realTab = await ext.evaluate(async (b) => (await chrome.tabs.query({ url: b + "/*" }))[0].id, base);
  await ext.goto(`chrome-extension://${id}/popup/popup.html?tab=${realTab}`);
  await ext.waitForTimeout(1500);
  await ext.screenshot({ path: `${OUT}/${scheme}-design.png`, fullPage: true });
  await ext.click("#proModeBtn"); await ext.waitForTimeout(500);
  await ext.screenshot({ path: `${OUT}/${scheme}-pro.png`, fullPage: true });
  await ext.evaluate(() => window.scrollTo(0, 220)); await ext.waitForTimeout(400);
  await ext.screenshot({ path: `${OUT}/${scheme}-pro-scrolled.png` });
  await ext.evaluate(() => window.scrollTo(0, 0));
  await ext.click('.view-tab[data-view="site"]'); await ext.waitForTimeout(800);
  await ext.screenshot({ path: `${OUT}/${scheme}-site.png`, fullPage: true });
  await ext.click('.view-tab[data-view="board"]'); await ext.waitForTimeout(800);
  await ext.screenshot({ path: `${OUT}/${scheme}-board.png`, fullPage: true });
  await ext.click('.view-tab[data-view="assets"]'); await ext.waitForTimeout(1500);
  await ext.screenshot({ path: `${OUT}/${scheme}-assets.png`, fullPage: true });
  await ext.click('.view-tab[data-view="models"]'); await ext.waitForTimeout(1500);
  await ext.screenshot({ path: `${OUT}/${scheme}-models.png`, fullPage: true });
  await ctx.close();
}
server.close();
console.log("shots done");
