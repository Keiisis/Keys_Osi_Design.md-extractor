/**
 * Real-extension E2E: loads the unpacked Keys_Osi extension into the
 * Playwright Chromium build (branded Chrome ignores --load-extension) and
 * exercises the service worker, webRequest capture, offscreen WASM
 * conversion, the context-menu target script and the popup views.
 *
 * Usage: npm run test:ext
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const fixture = (name) => readFile(join(ROOT, "tests", "fixtures", "3d", name));
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const MASK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Keys_Osi Fixture 3D</title>
<link rel="icon" href="/favicon.png">
<meta property="og:image" content="/og.png">
<style>
  @font-face { font-family: "FixtureSans"; src: url(/fonts/fixture.ttf) format("truetype"); }
  @layer theme { :root { --layer-accent: #7c3aed; } }
  body { font-family: FixtureSans, sans-serif; margin: 0; }
  .hero { background-image: url(/bg.png); height: 220px; }
  .icon-mask { -webkit-mask-image: url(/mask.svg); mask-image: url(/mask.svg); width: 20px; height: 20px; background: red; }
</style></head>
<body>
  <section class="hero"><h1>Hero title</h1></section>
  <img src="/photo.png" srcset="/img/w_400,h_300/photo.png 1x, /img/w_800,h_600/photo.png 2x" alt="Photo">
  <picture><source srcset="/pic.webp" type="image/webp"><img src="/pic.png" alt="pic"></picture>
  <svg width="24" height="24" viewBox="0 0 24 24" aria-label="Star icon" style="color: rgb(255, 0, 0)"><path fill="currentColor" d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"/></svg>
  <svg style="display:none"><symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></symbol></svg>
  <svg width="16" height="16"><use href="#i-check"/></svg>
  <video poster="/poster.jpg" src="/clip.mp4" muted></video>
  <lottie-player src="/anim/lottie.json"></lottie-player>
  <spline-viewer url="https://prod.spline.design/abc123/scene.splinecode"></spline-viewer>
  <model-viewer src="/models/Box.glb"></model-viewer>
  <div class="icon-mask"></div>
  <script>
    fetch("/models/Box.glb").then((r) => r.arrayBuffer());
    fetch("/draco/BoxDraco.gltf").then((r) => r.json()).then(() => fetch("/draco/Box.bin"));
    fetch("/api/mesh/hero").then((r) => r.arrayBuffer());
  </script>
</body></html>`;

// Live three.js scene: box (12 tris) + 16x8 sphere (224 tris) + 3 instanced boxes (36 tris).
const THREE_PAGE = `<!doctype html><html><head><title>Keys_Osi three fixture</title>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script></head>
<body style="margin:0"><script type="module">
import * as THREE from "three";
const renderer = new THREE.WebGLRenderer();
renderer.setSize(320, 240);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100);
camera.position.set(0, 2, 6);
const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd4a94c }));
box.position.set(-1.5, 0, 0);
box.rotation.y = 0.7;
scene.add(box);
const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 8), new THREE.MeshStandardMaterial({ color: 0x3355ff }));
sphere.position.set(1.5, 0, 0);
scene.add(sphere);
const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial(), 3);
for (let i = 0; i < 3; i++) instanced.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i - 1, -1.5, 0));
scene.add(instanced);
scene.add(new THREE.DirectionalLight(0xffffff, 2));
renderer.render(scene, camera);
window.__sceneReady = true;
</script></body></html>`;

async function main() {
  const box = await fixture("Box.glb");
  const routes = {
    "/": ["text/html", PAGE],
    "/models/Box.glb": ["model/gltf-binary", box],
    // Buffer served under a non-.bin name too: on this Windows host a web-filtering
    // antivirus empties every plain-HTTP *.bin response (even without the extension).
    "/draco/BoxDraco.gltf": ["model/gltf+json", JSON.stringify({ ...JSON.parse(await fixture("BoxDraco.gltf")), buffers: [{ byteLength: 120, uri: "Box-geometry.drc" }] })],
    "/draco/Box-geometry.drc": ["application/octet-stream", await fixture("Box.bin")],
    "/draco/Box.bin": ["application/octet-stream", await fixture("Box.bin")],
    // Opaque binary on a model-ish path, no extension: heuristic + magic bytes.
    "/api/mesh/hero": ["application/octet-stream", Buffer.concat([box, Buffer.alloc(60_000)])],
    "/mask.svg": ["image/svg+xml", MASK_SVG],
    "/fonts/fixture.ttf": ["font/ttf", existsSync("C:/Windows/Fonts/arial.ttf") ? await readFile("C:/Windows/Fonts/arial.ttf") : PNG_1PX],
    "/anim/lottie.json": ["application/json", '{"v":"5.7.4","fr":30,"layers":[]}'],
    "/clip.mp4": ["video/mp4", Buffer.alloc(16)],
    "/vendor/three.module.js": ["text/javascript", await readFile(join(ROOT, "node_modules/three/build/three.module.js"))],
    "/vendor/three.core.js": ["text/javascript", await readFile(join(ROOT, "node_modules/three/build/three.core.js"))],
    "/three.html": ["text/html", THREE_PAGE],
    // Same page with a different hero: the comparison must see the gap.
    "/variant": ["text/html", PAGE.replace("Hero title", "Totally different headline").replace("height: 220px;", "height: 220px; background: #7a1f3d;")]
  };
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    const route = routes[path] || (/\.(png|webp|jpg)$/.test(path) ? ["image/png", PNG_1PX] : null);
    if (!route) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": route[0], "Content-Length": Buffer.byteLength(route[1]) }).end(route[1]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const userDataDir = await mkdtemp(join(tmpdir(), "keys-osi-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: "chromium",
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
  });
  const failures = [];
  const check = (label, condition, detail) => {
    console.log(`  ${condition ? "ok" : "FAIL"} - ${label}${condition || detail === undefined ? "" : `  (${JSON.stringify(detail).slice(0, 300)})`}`);
    if (!condition) failures.push(label);
  };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => chrome.storage.local.set({ keysOsiSaveAs: false })); // no Save-As dialog headless
    await new Promise((resolve) => setTimeout(resolve, 500)); // let the worker register its listeners
    const swErrors = [];
    worker.on("console", (msg) => msg.type() === "error" && swErrors.push(msg.text()));

    const page = await context.newPage();
    await page.goto(base, { waitUntil: "load" });
    await page.waitForTimeout(1200);

    // Right-click BEFORE any extractor injection: context-target.js must
    // already have recorded the element.
    await page.click(".hero h1", { button: "right" });

    const ext = await context.newPage();
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=0`);
    const tabId = await ext.evaluate(async (origin) => (await chrome.tabs.query({ url: `${origin}/*` }))[0].id, base);
    // Re-open the popup pinned to the fixture tab (it is not the "active" tab here).
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);
    const call = (message) => ext.evaluate((msg) => chrome.runtime.sendMessage(msg), { tabId, ...message });
    const tabCall = (message) =>
      ext.evaluate(
        async ([id, msg]) => {
          await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content-script.js"] });
          return chrome.tabs.sendMessage(id, msg);
        },
        [tabId, message]
      );

    console.log("Context menu:");
    const component = await tabCall({ type: "KEYS_OSI_EXTRACT_ELEMENT" });
    check("first right-click target is known without prior injection", component.ok && component.html.includes("Hero title"), component);

    console.log("3D capture:");
    let state = await call({ type: "MODELS_STATE", withRequests: true });
    const byName = (name) => state.models.find((m) => m.url.includes(name));
    check("captures GLB from the network with content-type", byName("Box.glb")?.confidence === "high", state.models);
    check("captures glTF (Draco) from the network", byName("BoxDraco.gltf")?.format === "gltf");
    check("flags opaque binary on a model path (heuristic)", byName("/api/mesh/hero")?.confidence === "low");
    check("does not flag the .bin buffer", !byName("Box.bin"));
    check("logs every request for the inspector", state.requests.some((r) => r.url.endsWith("/img/w_400,h_300/photo.png")));

    const scan = await call({ type: "MODELS_SCAN" });
    state = await call({ type: "MODELS_STATE" });
    check("page scan finds the Spline scene", Boolean(byName("scene.splinecode")), scan);

    const identified = await call({ type: "MODEL_IDENTIFY", url: `${base}/api/mesh/hero` });
    state = await call({ type: "MODELS_STATE" });
    check("magic bytes identify the opaque file as GLB", identified.result?.format === "glb" && byName("/api/mesh/hero")?.confidence === "verified", identified);
    check("renames the identified file", byName("/api/mesh/hero")?.filename === "hero.glb");

    const sibling = await call({ type: "MODEL_IDENTIFY", url: `${base}/draco/Box.bin` });
    check("Draco buffer points to its parent .gltf", sibling.siblingGltf === `${base}/draco/BoxDraco.gltf`, sibling);

    console.log("Conversion (offscreen, WASM):");
    await ext.click('.view-tab[data-view="models"]');
    await ext.waitForSelector(".model-card");
    const convertVia = async (name, label) => {
      const card = ext.locator(".model-card", { hasText: name }).first();
      await card.locator("button", { hasText: label }).click();
      // Poll from Node: page-side waiters stall while the popup tab is in the background.
      for (let i = 0; i < 120; i++) {
        if (/triangles|Error|échou|failed/i.test(await ext.locator("#modelsStatus").textContent())) break;
        await ext.waitForTimeout(250);
      }
      return ext.locator("#modelsStatus").textContent();
    };
    const stlText = await convertVia("Box.glb", "→ STL");
    check("GLB → STL from the popup: 12 triangles", /Box\.stl : 12 triangles/.test(stlText), stlText);
    const dracoText = await convertVia("BoxDraco.gltf", "→ 3MF");
    check("Draco glTF + external .bin → 3MF: 12 triangles", /BoxDraco\.3mf : 12 triangles/.test(dracoText), dracoText);

    console.log("Assets inventory:");
    const inventory = (await tabCall({ type: "KEYS_OSI_COLLECT_ASSETS" })).assets;
    const imageUrls = inventory.images.map((i) => i.url);
    check("srcset URL with commas kept intact", imageUrls.includes(`${base}/img/w_400,h_300/photo.png`), imageUrls);
    for (const path of ["/pic.webp", "/bg.png", "/mask.svg", "/og.png", "/favicon.png", "/poster.jpg"]) {
      check(`collects ${path}`, imageUrls.includes(`${base}${path}`));
    }
    check("inline SVG resolves currentColor", inventory.svgs.some((s) => s.label === "Star icon" && s.markup.includes("rgb(255, 0, 0)")));
    check("sprite <use> becomes a standalone icon", inventory.svgs.some((s) => s.markup.includes("M5 12l5 5L20 7")));
    check("lists @font-face files", inventory.fonts.some((f) => f.family === "FixtureSans" && f.url.endsWith("/fonts/fixture.ttf")), inventory.fonts);
    check("lists video", inventory.media.some((m) => m.url.endsWith("/clip.mp4")));
    check("lists Lottie + Spline", inventory.animations.some((a) => a.kind === "lottie") && inventory.animations.some((a) => a.kind === "spline"), inventory.animations);

    await ext.click('.view-tab[data-view="assets"]');
    await ext.waitForSelector("#assetGrid .asset-card");
    check("Assets view renders cards", (await ext.locator("#assetGrid .asset-card").count()) > 5);

    console.log("AI gateway settings (PRO):");
    await ext.click('.view-tab[data-view="design"]');
    await ext.click("#proModeBtn");
    await ext.fill("#proApiKey", '{"_type":"newapi_channel_conn","key":"","url":"https://miarouter.online"}');
    const gateway = await ext.evaluate(() => ({
      provider: document.getElementById("proProvider").value,
      baseUrl: document.getElementById("proBaseUrl").value,
      baseUrlVisible: !document.getElementById("proBaseUrl").hidden,
      status: document.getElementById("proStatus").textContent
    }));
    check("pasting the New API JSON selects the gateway provider", gateway.provider === "newapi", gateway);
    check("base URL normalized to /v1 and shown", gateway.baseUrl === "https://miarouter.online/v1" && gateway.baseUrlVisible, gateway);
    check("warns that the JSON key is empty", /clé du JSON est vide/.test(gateway.status), gateway);
    const saved = await ext.evaluate(async () => (await chrome.storage.local.get("promptProSettings")).promptProSettings);
    check("gateway settings persisted", saved?.provider === "newapi" && saved?.baseUrl === "https://miarouter.online/v1", saved);

    console.log("PROMPT_PRO via a streaming gateway:");
    let gatewayMode = "stream";
    const aiGateway = createServer((req, res) => {
      if (gatewayMode === "524") {
        res.writeHead(524, { "Content-Type": "text/html" }).end("<!DOCTYPE html><html><head><title>gw.test | 524: A timeout occurred</title></head></html>");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const parts = ["# PROMPT_PRO.md — Burger", "\n\n## 0. Mission", "\nBuild it."];
      let i = 0;
      const tick = setInterval(() => {
        if (i < parts.length) {
          res.write(`data: ${JSON.stringify({ model: "test-model", choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
        } else {
          clearInterval(tick);
          res.end("data: [DONE]\n\n");
        }
      }, 450);
    });
    await new Promise((resolve) => aiGateway.listen(0, "127.0.0.1", resolve));
    await ext.evaluate((port) => chrome.storage.local.set({
      promptProSettings: { provider: "newapi", baseUrl: `http://127.0.0.1:${port}`, model: "test-model", apiKey: "sk-test" }
    }), aiGateway.address().port);
    await page.bringToFront();
    const runPro = () =>
      ext.evaluate(async () => {
        const steps = [];
        const listener = (m) => m?.type === "PRO_PROGRESS" && steps.push(m.step + (m.chars ? `:${m.chars}` : ""));
        chrome.runtime.onMessage.addListener(listener);
        let response = await chrome.runtime.sendMessage({
          type: "GENERATE_PROMPT_PRO",
          projectDescription: "Site vitrine pour mon food-truck de burgers à Lyon, sections menu et réservation."
        });
        if (response?.pending) {
          // Long AI runs finish in the offscreen document.
          response = await new Promise((resolve) => {
            const onDone = (m) => {
              if (m?.type === "PRO_DONE" && m.jobId === response.jobId) {
                chrome.runtime.onMessage.removeListener(onDone);
                resolve({ ok: true, ...m.result });
              }
            };
            chrome.runtime.onMessage.addListener(onDone);
          });
        }
        chrome.runtime.onMessage.removeListener(listener);
        const saved = (await chrome.storage.local.get("keysOsiLastPro")).keysOsiLastPro;
        return { response, steps, saved };
      });
    const streamed = await runPro();
    check("PRO streamed from the gateway (offscreen runner)", streamed.response.ok && streamed.response.markdown.includes("## 0. Mission") && streamed.response.engine === "newapi · test-model", streamed.response);
    check("PRO reports live progress steps", ["extract", "ai", "done"].every((s) => streamed.steps.some((x) => x.startsWith(s))) && streamed.steps.some((x) => x.startsWith("stream:")), streamed.steps);
    check("PRO result persisted for a closed popup", streamed.saved?.markdown === streamed.response.markdown);
    gatewayMode = "524";
    const failed = await runPro();
    check("Cloudflare 524 falls back to the local engine", failed.response.ok && failed.response.markdown.startsWith("# PROMPT_PRO.md") && /repli/.test(failed.response.engine), failed.response.engine);
    check("524 warning is one readable line (no HTML)", /HTTP 524/.test(failed.response.warning) && /Cloudflare/.test(failed.response.warning) && !failed.response.warning.includes("<!DOCTYPE"), failed.response.warning);
    aiGateway.close();

    console.log("Lens (on-page inspector):");
    await ext.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["lens.js"] }), tabId);
    await page.bringToFront();
    const h1Box = await page.locator(".hero h1").boundingBox();
    await page.mouse.move(h1Box.x + 10, h1Box.y + 10);
    await page.waitForTimeout(150);
    const lensHover = await page.evaluate(() => ({ ...document.querySelector("keys-osi-lens")?.dataset }));
    check("Lens describes the hovered heading", /^h1/.test(lensHover.selector || "") && /\|32px\|/.test(lensHover.font || ""), lensHover);
    check("Lens measures contrast with a WCAG level", /^\d+(\.\d+)?\|(AAA|AA|échec)$/.test(lensHover.contrast || ""), lensHover);
    await page.mouse.click(h1Box.x + 10, h1Box.y + 10);
    const copied = await page.evaluate(() => document.querySelector("keys-osi-lens")?.dataset.copied || "");
    check("Lens click copies the CSS spec", copied.includes("font-size: 32px;") && copied.includes("color: #"), copied.slice(0, 120));
    await page.keyboard.press("Escape");

    console.log("3D preview in the popup:");
    await ext.click('.view-tab[data-view="models"]');
    const previewCard = ext.locator(".model-card", { hasText: "Box.glb" }).first();
    await previewCard.locator("button", { hasText: "Aperçu 3D" }).click();
    await ext.waitForSelector(".model-preview__canvas", { timeout: 20000 });
    await ext.waitForTimeout(800);
    const painted = await ext.evaluate(() => {
      const canvas = document.querySelector(".model-preview__canvas");
      const probe = document.createElement("canvas");
      probe.width = canvas.width;
      probe.height = canvas.height;
      const ctx = probe.getContext("2d");
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
      return { lit, total: data.length / 4, meta: document.querySelector(".model-preview__meta")?.textContent };
    });
    check("preview renders the model (WebGL pixels)", painted.lit > painted.total * 0.02, painted);
    check("preview reports the triangle count", /12 triangles/.test(painted.meta || ""), painted.meta);

    console.log("Live three.js scene export:");
    const threePage = await context.newPage();
    await threePage.goto(`${base}/three.html`);
    await threePage.waitForFunction(() => window.__sceneReady === true, null, { timeout: 20000 });
    const threeTab = await ext.evaluate(async (origin) => (await chrome.tabs.query({ url: `${origin}/three.html` }))[0].id, base);
    const exported = await ext.evaluate(async (id) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, world: "MAIN", func: () => { window.__keysOsiExportReturnBytes = true; } });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: id }, world: "MAIN", files: ["scene-export.js"] });
      return result;
    }, threeTab);
    check("hook captured the live scene", exported?.ok && exported.scenes === 1, exported && { ...exported, base64: undefined });
    let reloadedTris = 0;
    if (exported?.ok) {
      const { loadGltf, extractTriangles } = await import("../../lib/glb-convert.mjs");
      const model = await loadGltf(new Uint8Array(Buffer.from(exported.base64, "base64")));
      reloadedTris = (await extractTriangles(model, { scale: 1 })).triangleCount;
    }
    check("exported GLB re-reads with every triangle (12 + 224 + 3×12)", reloadedTris === 272, { reloadedTris, meshes: exported?.meshes });
    await threePage.close();

    console.log("PROMPT_PRO speed priority:");
    const seenModels = [];
    const speedGateway = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try { seenModels.push(JSON.parse(body).model); } catch (e) {}
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end('data: {"choices":[{"delta":{"content":"# PROMPT_PRO.md — fast"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\ndata: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => speedGateway.listen(0, "127.0.0.1", resolve));
    await ext.evaluate((port) => chrome.storage.local.set({
      promptProSettings: { provider: "newapi", baseUrl: `http://127.0.0.1:${port}`, model: "", apiKey: "sk-test", priority: "speed" },
      keysOsiModelStats: { "slow-model": { runs: 2, fails: 0, totalMs: 600000 }, "fast-model": { runs: 1, fails: 0, totalMs: 120000 }, "flaky-model": { runs: 0, fails: 3, totalMs: 0 } }
    }), speedGateway.address().port);
    await page.bringToFront();
    const speedRun = await ext.evaluate(async () => {
      let response = await chrome.runtime.sendMessage({ type: "GENERATE_PROMPT_PRO", projectDescription: "Landing page pour une application de covoiturage étudiant." });
      if (response?.pending) {
        response = await new Promise((resolve) => {
          const onDone = (m) => {
            if (m?.type === "PRO_DONE") {
              chrome.runtime.onMessage.removeListener(onDone);
              resolve({ ok: true, ...m.result });
            }
          };
          chrome.runtime.onMessage.addListener(onDone);
        });
      }
      return { response, stats: (await chrome.storage.local.get("keysOsiModelStats")).keysOsiModelStats };
    });
    check("speed priority picks the fastest measured model", seenModels[0] === "fast-model", seenModels);
    check("the run is recorded in the model stats", speedRun.stats?.["fast-model"]?.runs === 2, speedRun.stats);
    speedGateway.close();

    console.log("Before/after comparison:");
    const variant = await context.newPage();
    await variant.goto(`${base}/variant`);
    const variantTab = await ext.evaluate(async (origin) => (await chrome.tabs.query({ url: `${origin}/variant` }))[0].id, base);
    const same = await ext.evaluate(([a]) => chrome.runtime.sendMessage({ type: "COMPARE_TABS", refTabId: a, candTabId: a }), [tabId]);
    check("refuses comparing a tab with itself", same.ok === false && /deux onglets/.test(same.error), same);
    const comparison = await ext.evaluate(([a, b]) => chrome.runtime.sendMessage({ type: "COMPARE_TABS", refTabId: a, candTabId: b }), [tabId, variantTab]);
    check("comparison scores every section", comparison.ok && comparison.sections.length >= 1 && comparison.sections.every((x) => x.score > 0 && x.score <= 1), comparison);
    check("a different hero lowers the score and shows differing pixels", comparison.ok && comparison.overall < 0.97 && comparison.sections[0].diffRatio > 0.02, comparison.sections?.[0]);
    const savedCompare = await ext.evaluate(async () => (await chrome.storage.local.get("keysOsiLastCompare")).keysOsiLastCompare);
    check("comparison result kept for the popup", savedCompare?.filename?.startsWith("keys-osi-fidelite-"), savedCompare);
    await variant.close();

    console.log("Extraction fixes:");
    const extraction = await tabCall({ type: "KEYS_OSI_EXTRACT_STYLES" });
    check("reads CSS variables declared inside @layer", extraction.payload.cssVariables.some((v) => v.name === "--layer-accent"));

    check("service worker logged no errors", swErrors.length === 0, swErrors);
  } finally {
    await context.close();
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }

  if (failures.length > 0) {
    console.error(`\nEXTENSION E2E FAILED: ${failures.length} assertion(s):\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nAll extension E2E tests passed.");
}

main().catch((error) => {
  console.error("Extension E2E crashed:", error);
  process.exit(1);
});
