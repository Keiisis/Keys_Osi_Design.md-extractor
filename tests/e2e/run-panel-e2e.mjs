// Side panel E2E: the panel is wired as the toolbar action, and every view
// lays out cleanly at the widths a user can drag the panel to.
// Usage: node tests/e2e/run-panel-e2e.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = process.argv[2] || "";
const WIDTHS = [320, 375, 414, 560, 768];
const VIEWS = ["design", "site", "assets", "models", "board"];
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 600)}`}`);
  if (!ok) failures += 1;
};

const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
check("manifest declares the side panel", manifest.side_panel?.default_path === "popup/popup.html");
check("manifest requests sidePanel", manifest.permissions.includes("sidePanel"));
check("toolbar click is not captured by a popup", !manifest.action.default_popup);

const pages = {
  "/a": "<!doctype html><title>Page A</title><h1>A</h1>",
  "/b": "<!doctype html><title>Page B</title><h1>B</h1>"
};
const server = createServer((req, res) => res.writeHead(200, { "Content-Type": "text/html" }).end(pages[req.url] || pages["/a"]));
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "ko-panel-")), {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
});
try {
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const behavior = await worker.evaluate(() => chrome.sidePanel.getPanelBehavior());
  check("toolbar click opens the side panel", behavior.openPanelOnActionClick === true, behavior);

  const site = await ctx.newPage();
  await site.goto(`${base}/a`);

  // Layout: no horizontal overflow, no wrapped affordance, at every width.
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/popup/popup.html`);
  const tabId = await panel.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/*` }))[0].id, base);
  await panel.goto(`chrome-extension://${id}/popup/popup.html?tab=${tabId}`);
  await panel.waitForSelector(".view-tab");
  for (const width of WIDTHS) {
    await panel.setViewportSize({ width, height: 800 });
    for (const view of VIEWS) {
      await panel.click(`.view-tab[data-view="${view}"]`);
      await panel.waitForTimeout(350);
      // Open every fold so hidden layouts get measured too.
      await panel.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      await panel.waitForTimeout(150);
      const report = await panel.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        };
        const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
        const overflow = [];
        for (const el of document.body.querySelectorAll("*")) {
          if (!visible(el)) continue;
          // Content inside a horizontal scroller is allowed to extend.
          let scroller = el.parentElement;
          let clipped = false;
          while (scroller && scroller !== document.body) {
            const ox = getComputedStyle(scroller).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") {
              clipped = true;
              break;
            }
            scroller = scroller.parentElement;
          }
          if (clipped) continue;
          const r = el.getBoundingClientRect();
          if (r.right > vw + 1 || r.left < -1) overflow.push(`${describe(el)} [${Math.round(r.left)}→${Math.round(r.right)}]`);
        }
        const wrapped = [];
        for (const el of document.querySelectorAll("button, .view-tab, a.btn, summary")) {
          if (!visible(el) || el.closest("[hidden]")) continue;
          if (el.tagName === "SUMMARY") continue;
          // Content wider than its button: cut by an ellipsis or spilling out.
          if (el.scrollWidth > el.clientWidth + 1) {
            wrapped.push(`${describe(el)} overflows "${el.textContent.trim().slice(0, 30)}"`);
            continue;
          }
          // A label wraps when one of its text runs spans two lines; stacked
          // title + caption spans are separate runs and do not count.
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (!text) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1);
            const line = parseFloat(getComputedStyle(node.parentElement).fontSize) || 12;
            if (rects.length > 1 && rects.at(-1).top - rects[0].top > line * 0.5) {
              wrapped.push(`${describe(el)} "${text.slice(0, 30)}"`);
              break;
            }
          }
        }
        return { scroll: document.documentElement.scrollWidth - vw, overflow: overflow.slice(0, 8), wrapped: wrapped.slice(0, 8) };
      });
      check(`${width}px ${view}: no horizontal scroll`, report.scroll <= 0, report.scroll);
      check(`${width}px ${view}: nothing past the edge`, report.overflow.length === 0, report.overflow);
      check(`${width}px ${view}: no wrapped button`, report.wrapped.length === 0, report.wrapped);
      if (SHOTS) await panel.screenshot({ path: join(SHOTS, `${width}-${view}.png`), fullPage: true });
    }
  }

  // Tab following: an unpinned panel reloads onto the newly active tab.
  const follow = await ctx.newPage();
  await follow.goto(`chrome-extension://${id}/popup/popup.html`);
  await follow.waitForSelector(".view-tab");
  const reloadsAfter = async (label, action) => {
    await follow.waitForSelector(".view-tab");
    await follow.evaluate(() => (window.__marker = 1));
    await action();
    await follow.waitForFunction(() => window.__marker === undefined, null, { timeout: 8000, polling: 200 }).then(
      () => check(label, true),
      () => check(label, false)
    );
  };
  await reloadsAfter("panel follows a tab switch", () => site.bringToFront());
  await reloadsAfter("panel follows a navigation of the active tab", () => site.goto(`${base}/b`));
  await follow.waitForSelector("#siteHost");
  const host = await follow.evaluate(() => document.getElementById("siteHost").textContent);
  check("panel header names the followed tab", host === "127.0.0.1", host);
} finally {
  await ctx.close();
  server.close();
}
if (failures) {
  console.log(`\n${failures} panel check(s) failed.`);
  process.exit(1);
}
console.log("\nPanel E2E passed.");
