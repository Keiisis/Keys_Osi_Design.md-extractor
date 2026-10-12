/**
 * Feature E2E on the real extension: Figma import (REST API answered by a
 * Playwright route with the fixture file), Figma kit export, page → Figma
 * layers capture, plugin ZIP, tokens export, source switching.
 *
 * Usage: node tests/e2e/run-features-e2e.mjs
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer as createHttpServer } from "node:http";

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Studio Lumen</title>
<style>
  body { margin: 0; font-family: Georgia, serif; background: #faf7f2; color: #1d1b16; }
  nav { display: flex; gap: 24px; padding: 16px 32px; align-items: center; }
  .hero { padding: 64px 32px; background: linear-gradient(90deg, #ff7a00, #7c3aed); color: #fff; }
  .btn { display: inline-block; padding: 12px 20px; border-radius: 12px; background: #1d1b16; color: #fff; text-decoration: none; }
  .cards { display: flex; gap: 20px; padding: 32px; }
  .card { flex: 1; padding: 20px; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.12); }
</style></head><body>
<nav><a href="/">Lumen</a><a href="/work">Projets</a><a href="/contact">Contact</a></nav>
<section class="hero"><h1>Des marques qui brillent</h1><p>Identités, sites et motion.</p><a class="btn" href="/contact">Démarrer</a></section>
<section class="cards">
  <div class="card"><img src="/a.png" width="40" height="40" alt=""><h3>Identité</h3><p>Logos et chartes.</p></div>
  <div class="card"><img src="/a.png" width="40" height="40" alt=""><h3>Web</h3><p>Sites rapides.</p></div>
  <div class="card"><img src="/a.png" width="40" height="40" alt=""><h3>Motion</h3><p>Animations.</p></div>
</section>
<footer><p class="legal" style="color:#bdbdbd">Mentions légales — Studio Lumen 2026</p></footer></body></html>`;

async function main() {
  const server = createServer((req, res) => {
    if (req.url.startsWith("/a.png")) return res.writeHead(200, { "Content-Type": "image/png" }).end(PNG_1PX);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const figmaFile = await readFile(join(ROOT, "tests/fixtures/figma/sample-file.json"), "utf8");
  const fontsourceInter = await readFile(join(ROOT, "tests/fixtures/fonts/fontsource-inter.json"), "utf8");
  const woff2 = await readFile(join(ROOT, "assets/fonts/geist.woff2"));

  const userDataDir = await mkdtemp(join(tmpdir(), "keys-osi-feat-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: "chromium",
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
  });
  const figmaCalls = [];
  await context.route("https://api.figma.com/**", (route) => {
    const url = new URL(route.request().url());
    figmaCalls.push({ path: url.pathname, token: route.request().headers()["x-figma-token"], time: Date.now() });
    if (/\/v1\/files\/[^/]+\/variables\/local$/.test(url.pathname)) return route.fulfill({ status: 403, contentType: "application/json", body: '{"status":403,"err":"Limited by Figma plan"}' });
    if (/\/v1\/files\/[^/]+\/images$/.test(url.pathname)) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ error: false, status: 200, meta: { images: { "img-hero-1": `${base}/a.png` } } }) });
    if (/\/v1\/images\//.test(url.pathname)) {
      const ids = (url.searchParams.get("ids") || "").split(",");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ err: null, images: Object.fromEntries(ids.map((id) => [id, `${base}/a.png`])) }) });
    }
    if (/\/v1\/files\/[^/]+$/.test(url.pathname)) return route.fulfill({ contentType: "application/json", body: figmaFile });
    return route.fulfill({ status: 404, body: "{}" });
  });

  // Font catalog and font files answered locally (deterministic, offline).
  await context.route("https://api.fontsource.org/**", (route) => route.fulfill({ contentType: "application/json", body: fontsourceInter }));
  await context.route("https://cdn.jsdelivr.net/fontsource/**", (route) => route.fulfill({ contentType: "font/woff2", body: woff2 }));

  const failures = [];
  const check = (label, condition, detail) => {
    console.log(`  ${condition ? "ok" : "FAIL"} - ${label}${condition || detail === undefined ? "" : `  (${JSON.stringify(detail).slice(0, 400)})`}`);
    if (!condition) failures.push(label);
  };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => chrome.storage.local.set({ keysOsiSaveAs: false }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const swErrors = [];
    worker.on("console", (msg) => msg.type() === "error" && swErrors.push(msg.text()));

    const page = await context.newPage();
    await page.goto(base, { waitUntil: "load" });
    const ext = await context.newPage();
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=0`);
    const tabId = await ext.evaluate(async (origin) => (await chrome.tabs.query({ url: `${origin}/*` }))[0].id, base);
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
    await ext.waitForTimeout(1500);

    console.log("Figma import (popup):");
    await ext.evaluate(() => {
      document.getElementById("figmaFold").open = true;
      document.querySelector(".figma__api").open = true;
    });
    await ext.fill("#figmaUrl", "https://www.figma.com/design/AbC123xyz/Lumen-Site?node-id=1-2");
    await ext.fill("#figmaToken", "figd_test_token");
    await ext.click("#figmaImportBtn");
    await ext.waitForFunction(() => !document.getElementById("figmaSummary").hidden, null, { timeout: 30000 }).catch(() => {});
    const status = await ext.textContent("#figmaStatus");
    check("import succeeds from the popup", /aspiré/.test(status), status);
    check("REST calls carry the token header", figmaCalls.length > 0 && figmaCalls.every((call) => call.token === "figd_test_token"), figmaCalls);
    check("whole file requested (node-id ignored by default)", figmaCalls.some((call) => call.path === "/v1/files/AbC123xyz"), figmaCalls.map((c) => c.path));
    const stats = await ext.$$eval("#figmaSummary .site-stat", (nodes) => nodes.map((n) => n.textContent));
    check("summary lists screens and components", stats.some((s) => /^2écrans/.test(s)) && stats.some((s) => /composants/.test(s)), stats);
    await ext.waitForFunction(() => document.getElementById("preview").value.includes("#4f46e5"), null, { timeout: 30000 }).catch(() => {});
    const preview = await ext.inputValue("#preview");
    check("DESIGN.md regenerated from the Figma file", preview.includes("#4f46e5") && /Inter/.test(preview), preview.slice(0, 200));
    check("source bar shows Figma", await ext.isVisible("#sourceBar"));
    const stored = await ext.evaluate(async () => (await chrome.storage.local.get(["keysOsiSource", "keysOsiFigmaToken"])));
    check("source and token persisted locally", stored.keysOsiSource === "figma" && stored.keysOsiFigmaToken === "figd_test_token");

    console.log("Figma kit export:");
    const kit = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "FIGMA_EXPORT", what: "zip" }));
    check("kit ZIP built with docs, screens, renders, icons and images", kit.ok && kit.fileCount >= 9 + 2 + 2 && !kit.note, kit);
    check("render endpoint called for frames (png) and icons (svg)", figmaCalls.filter((c) => c.path.startsWith("/v1/images/")).length >= 1);

    console.log("Figma without API (.fig file, clipboard, live tab):");
    const callsBefore = figmaCalls.length;
    await ext.setInputFiles("#figmaFigFile", join(ROOT, "tests/fixtures/figma-offline/medium-complex.fig"));
    await ext.waitForFunction(() => /sans API/.test(document.getElementById("figmaStatus").textContent) || document.getElementById("figmaStatus").classList.contains("is-error"), null, { timeout: 60000, polling: 300 });
    const figStatus = await ext.textContent("#figmaStatus");
    check(".fig file imported without token or API", /importé sans API/.test(figStatus) && figmaCalls.length === callsBefore, figStatus);
    await ext.waitForFunction(() => /Avenir Next/.test(document.getElementById("preview").value), null, { timeout: 30000, polling: 300 }).catch(() => {});
    check("DESIGN.md rebuilt from the .fig (Avenir Next)", /Avenir Next/.test(await ext.inputValue("#preview")));
    const clipboardHtml = await readFile(join(ROOT, "tests/fixtures/figma-offline/clipboard-clip-test.html"), "utf8");
    await ext.evaluate((html) => {
      const data = new DataTransfer();
      data.setData("text/html", html);
      document.getElementById("figmaPaste").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, clipboardHtml);
    await ext.waitForFunction(() => /sans API/.test(document.getElementById("figmaStatus").textContent) && !/medium/i.test(document.getElementById("figmaStatus").textContent) || document.getElementById("figmaStatus").classList.contains("is-error"), null, { timeout: 60000, polling: 300 });
    const pasteStatus = await ext.textContent("#figmaStatus");
    const pasted = await ext.evaluate(async () => (await chrome.storage.local.get("keysOsiLastFigma")).keysOsiLastFigma);
    check("Figma clipboard paste imported (no API)", /importé sans API/.test(pasteStatus) && pasted?.via !== "api" && pasted.structure.stats.screens >= 1, { pasteStatus, via: pasted?.via, stats: pasted?.structure?.stats });
    const live = await ext.evaluate((id) => chrome.runtime.sendMessage({ type: "FIGMA_LIVE", tabId: id }), tabId);
    check("live reading refuses non-Figma tabs with a clear message", live.ok === false && /figma.com/.test(live.error), live);

    console.log("Back to the site:");
    await ext.click("#sourceSiteBtn");
    await ext.waitForFunction(() => document.getElementById("preview").value.includes("Studio Lumen") || document.getElementById("preview").value.includes("#1d1b16"), null, { timeout: 20000 }).catch(() => {});
    const sitePreview = await ext.inputValue("#preview");
    check("switching back regenerates from the live tab", !sitePreview.includes("#4f46e5"), sitePreview.slice(0, 160));

    console.log("Page → Figma layers:");
    const capture = await ext.evaluate((id) => chrome.runtime.sendMessage({ type: "FIGMA_CAPTURE_PAGE", tabId: id }), tabId);
    check("capture produces layers, components and embedded images", capture.ok && capture.layers > 15 && capture.components >= 1 && capture.embedded >= 1, capture);
    const plugin = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "FIGMA_PLUGIN" }));
    check("plugin ZIP (manifest, code, ui, readme)", plugin.ok && plugin.fileCount === 4, plugin);
    const tokens = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "FIGMA_TOKENS", normalized: null }));
    check("tokens export works from the Figma source", tokens.ok && /keysosi-tokens\.json$/.test(tokens.filename), tokens);

    console.log("Brand Kit from a logo:");
    const logoBase64 = await ext.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 240, 96);
      ctx.fillStyle = "#1b2a4a";
      ctx.fillRect(20, 24, 120, 48);
      ctx.fillStyle = "#f26b1d";
      ctx.beginPath();
      ctx.arc(190, 48, 30, 0, Math.PI * 2);
      ctx.fill();
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await ext.click("#proModeBtn");
    await ext.fill("#brandName", "Atelier Nova");
    await ext.setInputFiles("#brandFile", { name: "atelier.png", mimeType: "image/png", buffer: Buffer.from(logoBase64, "base64") });
    await ext.waitForSelector("#brandResult:not([hidden])", { timeout: 60000 }).catch(() => {});
    const brand = (await ext.evaluate(async () => (await chrome.storage.local.get("keysOsiBrandKit")).keysOsiBrandKit)) || {};
    const hexes = (brand.kit?.colors?.swatches || []).map((swatch) => swatch.hex);
    check("logo colors recovered exactly", hexes.includes("#1b2a4a") && hexes.includes("#f26b1d"), { hexes, status: await ext.textContent("#brandStatus") });
    check("palette roles with contrast guarantees", brand.kit?.palette?.contrast?.every((pair) => pair.ratio >= pair.min), brand.kit?.palette?.contrast?.filter((pair) => pair.ratio < pair.min));
    check("3 font pairings shown with resolved files", (await ext.$$eval("#brandFonts .brand-font", (nodes) => nodes.length)) === 3 && (brand.kit?.files?.display?.length > 0 || (brand.kit?.fonts?.chosen?.display?.id === brand.kit?.fonts?.chosen?.body?.id && brand.kit?.files?.body?.length > 0)), { cards: await ext.$$eval("#brandFonts .brand-font", (n) => n.length), display: brand.kit?.fonts?.chosen?.display?.id, body: brand.kit?.fonts?.chosen?.body?.id, files: Object.fromEntries(Object.entries(brand.kit?.files || {}).map(([k, v]) => [k, v.length])) });
    check("logo vectorized to SVG", /^<svg[\s\S]*<\/svg>\s*$/.test(brand.logoSvg || ""), (brand.logoSvg || "").slice(0, 80));
    const brandZip = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "BRAND_ZIP" }));
    check("brand kit ZIP (charter, tokens, fonts, logo)", brandZip.ok && brandZip.fileCount >= 8 && brandZip.skipped === 0, brandZip);

    console.log("Brand try-on on the live page:");
    const heroBefore = await page.evaluate(() => getComputedStyle(document.querySelector(".hero")).backgroundImage);
    const tryOn = await ext.evaluate((id) => chrome.runtime.sendMessage({ type: "BRAND_TRYON", tabId: id, enable: true }), tabId);
    const heroAfter = await page.evaluate(() => getComputedStyle(document.querySelector(".hero")).backgroundImage);
    const fontAfter = await page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
    check("brand colors applied to the page", tryOn.ok && tryOn.recolored > 0 && heroAfter !== heroBefore, { tryOn, heroBefore, heroAfter });
    check("brand display font applied to headings", /Keys_Osi display/.test(fontAfter), fontAfter);
    await ext.evaluate((id) => chrome.runtime.sendMessage({ type: "BRAND_TRYON", tabId: id, enable: false }), tabId);
    const heroReverted = await page.evaluate(() => getComputedStyle(document.querySelector(".hero")).backgroundImage);
    check("try-on reverts exactly", heroReverted === heroBefore, heroReverted);

    console.log("Moodboard (Lens P / S):");
    await page.bringToFront();
    await ext.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["lens.js"] }), tabId);
    const h1 = await page.locator("h1").boundingBox();
    await page.mouse.move(h1.x + 20, h1.y + 10);
    await page.waitForTimeout(150);
    await page.keyboard.press("p");
    await page.waitForTimeout(600);
    await page.keyboard.press("s");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");
    const board = (await ext.evaluate(() => chrome.runtime.sendMessage({ type: "BOARD_STATE" }))).board || [];
    check("P pins text color, background and font", board.some((pin) => pin.kind === "font") && board.filter((pin) => pin.kind === "color").length >= 1, board.map((pin) => pin.kind));
    const sectionPin = board.find((pin) => pin.kind === "section");
    check("S pins the section as a capture", Boolean(sectionPin && /^data:image\/jpeg;base64,/.test(sectionPin.image) && sectionPin.heading === "Des marques qui brillent"), sectionPin && { ...sectionPin, image: (sectionPin.image || "").slice(0, 30) });
    const boardZip = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "BOARD_EXPORT" }));
    check("moodboard ZIP", boardZip.ok && boardZip.fileCount >= 3, boardZip);

    console.log("Learning memory + PROMPT_PRO context:");
    const bodies = [];
    const gateway = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.url.endsWith("/models")) return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "bad-model" }, { id: "good-model" }] }));
        const parsed = JSON.parse(body || "{}");
        bodies.push(parsed);
        if (parsed.model === "bad-model") return res.writeHead(500, { "Content-Type": "application/json" }).end('{"error":{"message":"upstream exploded"}}');
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end('data: {"choices":[{"delta":{"content":"# Mission line\\n## Fonts\\n## Sections"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":20}}\n\ndata: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const runPro = (model) =>
      ext.evaluate(
        async ([port, id, modelId]) => {
          await chrome.storage.local.set({ promptProSettings: { provider: "newapi", baseUrl: `http://127.0.0.1:${port}`, model: modelId, apiKey: "sk-test", priority: "quality" } });
          let response = await chrome.runtime.sendMessage({ type: "GENERATE_PROMPT_PRO", tabId: id, projectDescription: "Site vitrine pour un atelier de mobilier sur mesure à Lyon, ton chaleureux." });
          if (response?.pending) {
            response = await new Promise((resolve) => {
              const onDone = (m) => {
                if (m?.type === "PRO_DONE") {
                  chrome.runtime.onMessage.removeListener(onDone);
                  resolve(m.result);
                }
              };
              chrome.runtime.onMessage.addListener(onDone);
            });
          }
          return response;
        },
        [gateway.address().port, tabId, model]
      );
    await ext.evaluate(() => chrome.runtime.sendMessage({ type: "MEMORY_RATE", feature: "pro", value: "down", reasons: ["colors"], note: "Toujours un header sticky avec fond flouté." }));
    const first = await runPro("bad-model");
    check("a failing model falls back to the local engine with a warning", Boolean(first.warning), first.warning);
    await runPro("bad-model");
    const memoryState = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "MEMORY_STATE" }));
    check("two failures produce a routing lesson", memoryState.lessons.some((lesson) => lesson.type === "routing" && lesson.model === "bad-model"), memoryState.lessons);
    bodies.length = 0;
    const auto = await runPro("");
    const sent = bodies.find((body) => body.model) || {};
    check("automatic model choice skips the failing model", sent.model === "good-model", bodies.map((body) => body.model));
    const systemText = JSON.stringify(sent.messages?.[0] || {});
    const userText = JSON.stringify(sent.messages?.[1] || {});
    check("lessons injected in the system prompt", systemText.includes("Lessons from previous runs") && systemText.includes("exact hex values") && systemText.includes("header sticky"), systemText.slice(-600));
    check("brand kit and moodboard sent as context", userText.includes("BRAND KIT") && userText.includes("#1b2a4a") && userText.includes("MOODBOARD") && systemText.includes("REPLACE the reference palette"), userText.slice(0, 300));
    check("page signals (voice, icons, dark mode...) sent as context", userText.includes("PAGE SIGNALS"), userText.slice(0, 200));
    check("missing anatomy sections reported and remembered", auto.missingSections?.includes("Dependencies") && (await ext.evaluate(() => chrome.runtime.sendMessage({ type: "MEMORY_STATE" }))).lessons.some((lesson) => lesson.id === "pro:missing-sections"), auto.missingSections);
    gateway.close();

    console.log("Accessibility fixer:");
    await ext.evaluate(() => chrome.storage.local.set({ outputMode: "design" }));
    await ext.reload();
    await ext.waitForFunction(() => document.getElementById("preview").value.includes("Studio Lumen") || document.getElementById("preview").value.length > 500, null, { timeout: 30000 }).catch(() => {});
    await ext.evaluate(() => {
      document.getElementById("a11yFold").open = true;
    });
    await ext.waitForTimeout(300);
    const a11y = await ext.evaluate(() => ({ rows: document.querySelectorAll("#a11yList .a11y__row").length, failing: document.querySelectorAll("#a11yList .a11y__row:not(.is-pass)").length, summary: document.getElementById("a11ySummary").textContent }));
    check("contrast pairs checked, failing ones listed with fixes", a11y.rows >= 2 && a11y.failing >= 1, a11y);
    const legalBefore = await page.evaluate(() => getComputedStyle(document.querySelector(".legal")).color);
    await ext.click("#a11yPreviewBtn");
    await ext.waitForTimeout(500);
    const legalAfter = await page.evaluate(() => getComputedStyle(document.querySelector(".legal")).color);
    check("fix previewed on the live page", legalAfter !== legalBefore, { legalBefore, legalAfter, status: await ext.textContent("#a11yStatus") });
    await ext.click("#a11yPreviewBtn");

    console.log("Deep signals + native exports:");
    const designDoc = await ext.inputValue("#preview");
    check("DESIGN.md carries the deep sections (voice, icons, dark mode, modern CSS)", ["## Voice & Tone", "## Icon System", "## Dark Mode", "## Modern CSS"].every((h) => designDoc.includes(h)) && designDoc.indexOf("## Voice & Tone") < designDoc.indexOf("## Rules: Do"), designDoc.slice(0, 120));
    const platforms = await ext.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "RUN_EXTRACTION", mode: "design", tabId: Number(new URLSearchParams(location.search).get("tab")), persistOutputMode: false });
      return chrome.runtime.sendMessage({ type: "PLATFORM_ZIP", normalized: response.normalized });
    });
    check("native & platform exports ZIP (SwiftUI, Compose, Flutter, Tailwind v4, Storybook, WordPress, motion, rules)", platforms.ok && platforms.fileCount === 9, platforms);

    check("service worker logged no errors", swErrors.length === 0, swErrors);
  } finally {
    await context.close();
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  if (failures.length > 0) {
    console.error(`\nFEATURES E2E FAILED: ${failures.length} assertion(s):\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nFeatures E2E passed.");
}

main().catch((error) => {
  console.error("Features E2E crashed:", error);
  process.exit(1);
});
