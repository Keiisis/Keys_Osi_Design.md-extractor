/**
 * Advanced reverse engineering E2E: the real extension talks to the real
 * Keys_Osi native host (installed with `node native-host/install.mjs`),
 * which drives the real REA engine and a private headless Chrome on a local
 * page with a JavaScript bundle and its source map.
 *
 * Usage: node native-host/install.mjs && node tests/e2e/run-rea-e2e.mjs
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUNDLE = `(function(){var api="/api/devis";function load(id){return fetch("/api/meubles/"+id).then(function(r){return r.json()})}window.addEventListener("load",function(){document.getElementById("out").textContent="ok"});window.__nova={load:load,api:api};})();\n//# sourceMappingURL=app.js.map\n`;
const MAP = JSON.stringify({ version: 3, file: "app.js", sources: ["src/app.ts"], sourcesContent: ["export const api = '/api/devis';\nexport function load(id: string) { return fetch(`/api/meubles/${id}`); }\n"], names: [], mappings: "AAAA" });
const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Atelier Nova — REA</title><script src="/static/app.js" defer></script><script src="/static/vendor.js" defer></script></head><body><main><h1>Atelier Nova</h1><p id="out">…</p><a href="/contact">Contact</a></main></body></html>`;

async function main() {
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/static/app.js") return res.writeHead(200, { "Content-Type": "text/javascript" }).end(BUNDLE);
    if (path === "/static/app.js.map") return res.writeHead(200, { "Content-Type": "application/json" }).end(MAP);
    if (path === "/static/vendor.js") return res.writeHead(200, { "Content-Type": "text/javascript" }).end("window.vendor=1;");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const userDataDir = await mkdtemp(join(tmpdir(), "keys-osi-rea-"));
  const context = await chromium.launchPersistentContext(userDataDir, { headless: true, channel: "chromium", args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] });
  const failures = [];
  const check = (label, condition, detail) => {
    console.log(`  ${condition ? "ok" : "FAIL"} - ${label}${condition || detail === undefined ? "" : `  (${JSON.stringify(detail).slice(0, 500)})`}`);
    if (!condition) failures.push(label);
  };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    // Authorise this run's extension ID on the host, as for a store-installed copy.
    execFileSync(process.execPath, [join(ROOT, "native-host", "install.mjs"), extensionId], { stdio: "ignore" });
    await worker.evaluate(() => chrome.storage.local.set({ keysOsiSaveAs: false }));
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "load" });
    const ext = await context.newPage();
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=0`);
    const tabId = await ext.evaluate(async (origin) => (await chrome.tabs.query({})).find((t) => (t.url || "").startsWith(origin)).id, base);
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
    // Wait for the popup to finish initialising (views wired).
    await ext.waitForFunction(() => document.body.dataset.view && document.querySelector("#siteStatus") && window.getComputedStyle(document.getElementById("viewDesign")).display !== "none", null, { timeout: 30000, polling: 200 });
    await ext.waitForTimeout(1500);

    console.log("Native host + REA status:");
    await ext.evaluate(() => document.querySelector('.view-tab[data-view="site"]').click());
    await ext.evaluate(() => {
      document.getElementById("reaFold").open = true;
    });
    await ext.waitForFunction(() => /outils/.test(document.getElementById("reaState").textContent) || !document.getElementById("reaSetup").hidden || /rror|chec/.test(document.getElementById("reaState").textContent), null, { timeout: 180000, polling: 500 }).catch(async (error) => { console.log("  (diag)", JSON.stringify(await ext.evaluate(() => ({ state: document.getElementById("reaState").textContent, setup: !document.getElementById("reaSetup").hidden, open: document.getElementById("reaFold").open, view: document.body.dataset.view })))); throw error; });
    const stateText = await ext.textContent("#reaState");
    console.log(`  (${stateText})`);
    const toolCount = Number(await ext.textContent("#reaToolCount"));
    check("host reached through native messaging, REA started", /^REA \S+ · \d+ outils/.test(stateText), stateText);
    check("REA exposes its tool catalogue (> 100 tools)", toolCount > 100, toolCount);

    console.log("Page analysis:");
    await ext.click("#reaAnalyzeBtn");
    await ext.waitForFunction(() => !document.getElementById("reaResult").hidden || document.getElementById("reaStatus").classList.contains("is-error"), null, { timeout: 300000, polling: 500 });
    const record = (await ext.evaluate(async () => (await chrome.storage.local.get("keysOsiLastRea")).keysOsiLastRea)) || {};
    const summary = record.summary || {};
    check("bundles analysed statically (app.js + vendor.js)", (summary.bundle?.scriptsAnalyzed || 0) >= 2 && summary.bundle.chunks.some((chunk) => chunk.url.endsWith("/static/app.js")), summary.bundle || (await ext.textContent("#reaStatus")));
    check("passive page inspection captured DOM and resources", (summary.page?.domNodes || 0) > 5 && summary.page.scripts >= 2, summary.page);
    check("evidence written to disk with the report", Boolean(record.dir) && existsSync(join(record.dir, "REA_REPORT.md")) && existsSync(join(record.dir, "bundle.json")), record.dir);
    const report = record.dir ? await readFile(join(record.dir, "REA_REPORT.md"), "utf8") : "";
    check("REA_REPORT.md lists the bundle", report.includes("/static/app.js"), report.slice(0, 300));
    const ui = await ext.evaluate(() => ({ stats: document.querySelectorAll("#reaStats .site-stat").length, findings: document.querySelectorAll("#reaFindings li").length }));
    check("popup shows the readout", ui.stats === 6 && ui.findings >= 2, ui);

    console.log("Harmony with tech decoding:");
    await ext.evaluate((id) => chrome.runtime.sendMessage({ type: "TECH_DECODE", tabId: id }), tabId);
    // The service worker downloads the file: read the real file from disk.
    const techFile = await ext.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "TECH_EXPORT", what: "md" });
      for (let i = 0; i < 40; i++) {
        const [item] = await chrome.downloads.search({ query: ["TECH_STACK"] });
        if (item?.state === "complete" && item.filename) return { path: item.filename, response };
        if (i === 39) return { path: "", response, item };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return { path: "", response };
    });
    const techMd = techFile.path ? await readFile(techFile.path, "utf8") : "";
    check("TECH_STACK.md carries the REA section (same site)", /## Advanced reverse engineering \(REA\)/.test(techMd) && techMd.includes("/static/app.js"), techFile);

    console.log("Expert mode:");
    const expert = await ext.evaluate(async (url) => chrome.runtime.sendMessage({ type: "REA_CALL", name: "list_browser_targets", args: {}, useBrowser: true, url }), base);
    check("any REA tool callable with the analysis browser", expert.ok && JSON.stringify(expert.result).includes("127.0.0.1"), expert);
    const fileRun = await ext.evaluate(async (bundle) => chrome.runtime.sendMessage({ type: "REA_FILE", name: "app.js", base64: btoa(bundle) }), BUNDLE);
    check("local artifact analysed (open + inventory)", fileRun.ok && Boolean(fileRun.dir) && existsSync(join(fileRun.dir, "open.json")), fileRun);
  } finally {
    await context.close();
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  if (failures.length > 0) {
    console.error(`\nREA E2E FAILED: ${failures.length} assertion(s):\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nREA E2E passed.");
}

main().catch((error) => {
  console.error("REA E2E crashed:", error);
  process.exit(1);
});
