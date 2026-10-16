// Responsive capture E2E: a page with known breakpoints (one declared in a
// cross-origin stylesheet), measured through the real extension at
// 375/768/1024/1440, from the panel button to RESPONSIVE.md on disk.
// The extension copy declares "debugger" as required: headless Chrome
// cannot answer the optional-permission prompt.
// Usage: node tests/e2e/run-responsive-e2e.mjs
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 700)}`}`);
  if (!ok) failures += 1;
};

const listen = (handler) =>
  new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

// Cross-origin sheet: unreadable through the CSSOM, visible to CDP.
const cdn = await listen((req, res) => {
  res.writeHead(200, { "Content-Type": "text/css" });
  res.end("@media (min-width: 1440px) { .card { outline: 1px solid #ccc; } }");
});
const cdnUrl = `http://localhost:${cdn.address().port}/wide.css`;

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Responsive fixture</title>
<link rel="stylesheet" href="${cdnUrl}">
<style>
  body { margin: 0; font-family: sans-serif; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px; }
  header nav { display: none; gap: 16px; }
  .burger { display: block; width: 32px; height: 32px; }
  .wrap { padding: 0 16px; }
  h1 { font-size: 32px; line-height: 36px; }
  p { font-size: 16px; line-height: 24px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
  .card { height: 120px; background: #eee; }
  aside.promo { display: none; height: 200px; background: #fde; }
  .wide { width: 420px; height: 20px; background: #def; }
  @media (min-width: 400px) { .wide { width: auto; } }
  @media (min-width: 768px) {
    header nav { display: flex; }
    .burger { display: none; }
    .grid { grid-template-columns: repeat(2, 1fr); }
    h1 { font-size: 48px; line-height: 52px; }
  }
  @media (min-width: 1024px) {
    .grid { grid-template-columns: repeat(3, 1fr); }
    aside.promo { display: block; }
    .wrap { max-width: 960px; margin: 0 auto; }
  }
  @media (max-width: 1279.98px) { .grid { gap: 12px; } }
</style></head><body>
<header><a href="/">Logo</a><button class="burger" aria-label="Ouvrir le menu">=</button>
<nav><a href="/a">Produit</a><a href="/b">Tarifs</a><a href="/c">Docs</a><a href="/d">Blog</a></nav></header>
<main>
<section class="wrap"><h1>Bonjour</h1><p>Un paragraphe assez long pour compter comme texte courant de la page.</p>
<div class="grid"><div class="card">1</div><div class="card">2</div><div class="card">3</div></div></section>
<section class="wrap"><aside class="promo">Offre</aside><h2>Deuxième section</h2><p>Encore un paragraphe assez long pour la mesure du texte.</p><div class="wide"></div></section>
</main></body></html>`;
const site = await listen((req, res) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE));
const base = `http://127.0.0.1:${site.address().port}`;

const work = await mkdtemp(join(tmpdir(), "keys-osi-resp-"));
const ext = join(work, "ext");
await cp(ROOT, ext, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git|tests|graphify-out|corpus)([\\/]|$)/.test(src) });
const manifest = JSON.parse(await readFile(join(ext, "manifest.json"), "utf8"));
manifest.permissions.push("debugger");
manifest.optional_permissions = (manifest.optional_permissions || []).filter((p) => p !== "debugger");
await writeFile(join(ext, "manifest.json"), JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  headless: true,
  channel: "chromium",
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
});
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ keysOsiSaveAs: false }));

  const page = await context.newPage();
  await page.goto(`${base}/`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/popup/popup.html`);
  const tabId = await panel.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/*` }))[0].id, base);
  await panel.goto(`chrome-extension://${id}/popup/popup.html?tab=${tabId}`);
  await page.bringToFront();

  console.log("Capture from the panel:");
  await panel.evaluate(() => (document.getElementById("responsiveFold").open = true));
  await panel.click("#respBtn");
  await panel.waitForFunction(() => !document.getElementById("respResult").hidden || document.getElementById("respStatus").classList.contains("is-error"), null, { timeout: 120000, polling: 300 });
  const status = await panel.textContent("#respStatus");
  check("capture finished without error", !(await panel.evaluate(() => document.getElementById("respStatus").classList.contains("is-error"))), status);

  // Clearing the emulation also drops Playwright's own 1280px override, so
  // the page falls back to the window size: check it left the test widths.
  const viewport = await page.evaluate(() => document.documentElement.clientWidth);
  check("emulation cleared after the capture", viewport > 1100 && ![375, 768, 1024, 1440].includes(viewport), viewport);
  const detached = await worker.evaluate(
    (tab) =>
      new Promise((resolve) =>
        chrome.debugger.attach({ tabId: tab }, "1.3", () => {
          const error = chrome.runtime.lastError?.message || "";
          chrome.debugger.detach({ tabId: tab }, () => resolve(error || "free"));
        })
      ),
    tabId
  );
  check("debugger detached after the capture", detached === "free", detached);
  const { keysOsiResponsive: stored } = await panel.evaluate(() => chrome.storage.local.get("keysOsiResponsive"));
  const summary = stored?.summary;
  if (!summary) throw new Error(`no capture stored: ${status}`);
  const bps = summary.breakpoints.all.map((entry) => entry.px);
  check("breakpoints from the page CSS (400, 768, 1024, 1280)", [400, 768, 1024, 1280].every((px) => bps.includes(px)), bps);
  check("breakpoint from the cross-origin stylesheet (1440, through CDP)", bps.includes(1440), bps);
  check("widths measured", JSON.stringify(summary.widths) === "[375,768,1024,1440]", summary.widths);

  const vp = Object.fromEntries(summary.viewports.map((entry) => [entry.width, entry]));
  check("375px: menu button, no inline links", vp[375].nav.mode === "toggle" && vp[375].nav.links === 0, vp[375].nav);
  check("768px: 4 inline links", vp[768].nav.mode === "inline" && vp[768].nav.links === 4, vp[768].nav);
  check("h1 32px at 375, 48px at 768", vp[375].type.h1.fontSize === 32 && vp[768].type.h1.fontSize === 48, [vp[375].type.h1, vp[768].type.h1]);
  check("body text measured at 16px", vp[375].type.body?.fontSize === 16, vp[375].type.body);
  check("container: full width at 768, 960px centered at 1024 and 1440", !vp[768].container.width && vp[1024].container.width === 960 && vp[1440].container.width === 960, [vp[768].container, vp[1024].container, vp[1440].container]);
  const grid = summary.sections.find((row) => row.label === "Bonjour");
  check("card grid: 1 → 2 → 3 → 3 columns", JSON.stringify(grid?.columns) === "[1,2,3,3]", summary.sections);
  check("overflow at 375px traced to div.wide", vp[375].overflow.px > 0 && vp[375].overflow.culprits.some((c) => c.startsWith("div.wide")), vp[375].overflow);
  check("no overflow at 768px", vp[768].overflow.px === 0, vp[768].overflow);
  const promo = summary.visibility.find((item) => item.label.startsWith("aside.promo"));
  check("aside.promo shown from 1024px only", JSON.stringify(promo?.visibleAt) === "[1024,1440]", summary.visibility);
  const nav = summary.visibility.find((item) => item.label.startsWith("nav"));
  check("nav shown from 768px", JSON.stringify(nav?.visibleAt) === "[768,1024,1440]", summary.visibility);
  const step768 = summary.transitions.find((step) => step.from === 375);
  check("375→768 transition names the 400 and 768 breakpoints", JSON.stringify(step768.breakpoints) === "[400,768]", step768.breakpoints);
  check("Tailwind screens use the site's values", summary.screens.every((screen) => screen.fromSite) && summary.screens.some((screen) => screen.px === 768), summary.screens);
  check("4 first-screen captures", stored.screenshots.length === 4 && stored.screenshots.every((shot) => shot.data.length > 1000), stored.screenshots.map((shot) => shot.width));

  const ui = await panel.evaluate(() => ({
    chips: Array.from(document.querySelectorAll("#respBreakpoints .chip")).map((chip) => chip.firstChild.textContent),
    shots: document.querySelectorAll("#respShots img").length,
    changes: Array.from(document.querySelectorAll("#respChanges li li")).map((li) => li.textContent)
  }));
  check("panel shows the breakpoint chips", ui.chips.includes("768px") && ui.chips.includes("1440px"), ui.chips);
  check("panel shows the 4 captures", ui.shots === 4, ui.shots);
  check("panel lists the nav change in French", ui.changes.includes("Navigation : bouton menu → 4 liens visibles"), ui.changes);
  check("panel lists the column change", ui.changes.includes("« Bonjour » : 1 → 2 colonnes"), ui.changes);
  for (const width of [320, 414]) {
    await panel.setViewportSize({ width, height: 900 });
    await panel.evaluate(() => document.getElementById("responsiveFold").scrollIntoView());
    const extra = await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`filled panel fits a ${width}px side panel`, extra <= 0, extra);
    if (process.argv[2]) await panel.screenshot({ path: join(process.argv[2], `responsive-panel-${width}.png`) });
  }


  console.log("Exports:");
  const file = await panel.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: "RESPONSIVE_EXPORT", what: "md" });
    for (let i = 0; i < 40; i++) {
      const [item] = await chrome.downloads.search({ query: ["RESPONSIVE"] });
      if (item?.state === "complete" && item.filename) return { path: item.filename, response };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { path: "", response };
  });
  const md = file.path ? await readFile(file.path, "utf8") : "";
  check("RESPONSIVE.md downloaded", md.startsWith("# Responsive — 127.0.0.1"), file);
  check("RESPONSIVE.md lists the breakpoints", /Main breakpoints: .*\*\*768px\*\*/.test(md), md.slice(0, 600));
  check("RESPONSIVE.md flags the 375px overflow", /\*\*375px\*\*: the page is \d+px wider than the viewport/.test(md));
  check("RESPONSIVE.md gives the Tailwind v4 theme", md.includes("--breakpoint-md: 48rem;"));
  const zip = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "RESPONSIVE_EXPORT", what: "zip" }));
  check("ZIP export: md + json + 4 captures", zip.ok && zip.fileCount === 6, zip);

  console.log("Harmony with DESIGN.md:");
  const design = await panel.evaluate((tab) => chrome.runtime.sendMessage({ type: "RUN_EXTRACTION", mode: "design", tabId: tab, persistOutputMode: false }), tabId);
  check("DESIGN.md carries the measured responsive behavior", design.ok && design.markdown.includes("## Responsive Behavior") && design.markdown.includes("Breakpoints (CSS): "), design.ok ? design.markdown.slice(design.markdown.indexOf("## Responsive"), design.markdown.indexOf("## Responsive") + 300) : design.error);
} finally {
  await context.close();
  site.close();
  cdn.close();
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
if (failures) {
  console.log(`\n${failures} responsive check(s) failed.`);
  process.exit(1);
}
console.log("\nResponsive E2E passed.");
