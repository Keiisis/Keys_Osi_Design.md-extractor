// Code clone E2E: a fixture page (custom font from another origin, grid of
// repeated cards, inline SVG icons, pseudo-element, centered container,
// absolute badge, menu that collapses on mobile) is cloned by the real
// extension into a React + Tailwind project. The project is installed,
// built, served, and compared with the original, screenshot to screenshot.
// Needs network access for npm install.
// Usage: node tests/e2e/run-clone-e2e.mjs [keep-dir] [url]
// With a URL, a real page is cloned and built; the comparison is reported
// without thresholds (live sites move, load third-party content, animate).
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { inflateRawSync } from "node:zlib";
import { chromium } from "playwright-core";
import { ssimFromRgba } from "../../lib/fidelity.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const KEEP = process.argv[2] || "";
const TARGET = process.argv[3] || "";
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

/* ----------------------------------------------------------- fixture */
const FONT = await readFile(join(ROOT, "assets/fonts/instrument-serif.woff2"));
const PNG = await readFile(join(ROOT, "assets/icons/icon128.png"));
const cdn = await listen((req, res) => {
  if (req.url === "/display.css") {
    res.writeHead(200, { "Content-Type": "text/css", "Access-Control-Allow-Origin": "*" });
    return res.end(`@font-face { font-family: "Fixture Display"; src: url("./fonts/display.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
@media (min-width: 1280px) { .hero h1 { letter-spacing: -1px; } }`);
  }
  if (req.url === "/fonts/display.woff2") {
    res.writeHead(200, { "Content-Type": "font/woff2", "Access-Control-Allow-Origin": "*" });
    return res.end(FONT);
  }
  res.writeHead(404).end();
});
const cdnBase = `http://localhost:${cdn.address().port}`;

const ICON = `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 2l3 7h7l-5.5 4 2 7-6.5-4.5L5.5 20l2-7L2 9h7z"/></svg>`;
const card = (title, text) => `<article class="card">${ICON}<img src="/card.png" alt="${title}"><h3>${title}</h3><p>${text}</p><a class="more" href="/${title.toLowerCase()}">En savoir plus</a></article>`;
const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fixture Atelier</title><meta name="description" content="Page de test du clone en code.">
<link rel="stylesheet" href="${cdnBase}/display.css">
<style>
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1d2433; background: #fbf8f2; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 0 24px; }
  header { background: #1d2433; color: #fbf8f2; }
  header .wrap { display: flex; align-items: center; justify-content: space-between; height: 64px; }
  .logo { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; font-weight: 700; }
  .logo img { width: 32px; height: 32px; border-radius: 8px; }
  nav { display: none; gap: 24px; }
  nav a { color: #fbf8f2; text-decoration: none; font-size: 15px; }
  .burger { width: 40px; height: 40px; border: 1px solid #fbf8f2; border-radius: 8px; background: none; color: #fbf8f2; }
  .hero { position: relative; padding: 56px 0 48px; background: #f0e6d6 url("/bg.svg") no-repeat right top / 240px; }
  .hero h1 { font-family: "Fixture Display", Georgia, serif; font-size: 44px; line-height: 1.05; margin: 0 0 16px; font-weight: 400; }
  .hero p { font-size: 18px; line-height: 1.5; max-width: 34em; margin: 0 0 24px; }
  .cta { display: inline-block; padding: 14px 24px; border-radius: 999px; background: #c2410c; color: #fff; text-decoration: none; font-weight: 600; }
  .badge { position: absolute; top: 16px; right: 16px; padding: 4px 10px; border-radius: 6px; background: #1d2433; color: #fbf8f2; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .features { padding: 48px 0; }
  .features h2 { font-size: 28px; margin: 0 0 24px; }
  .grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
  .card { background: #fff; border: 1px solid #e5dccb; border-radius: 16px; padding: 20px; box-shadow: 0 8px 24px rgba(29, 36, 51, 0.08); }
  .card img { display: block; width: 100%; height: 120px; object-fit: cover; border-radius: 10px; margin: 12px 0; }
  .card .icon { width: 28px; height: 28px; color: #c2410c; }
  .icon path { fill: currentColor; }
  .card h3 { margin: 0 0 8px; font-size: 20px; }
  .card p { margin: 0 0 12px; font-size: 15px; line-height: 1.5; color: #4b5563; }
  .more { color: #c2410c; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
  blockquote { margin: 0 0 48px; padding: 24px 24px 24px 56px; position: relative; background: #fff; border-left: 4px solid #c2410c; font-size: 20px; line-height: 1.4; }
  blockquote::before { content: "\\201C"; position: absolute; left: 16px; top: 8px; font-size: 48px; color: #c2410c; font-family: Georgia, serif; }
  footer { background: #1d2433; color: #cbd5e1; padding: 24px 0; font-size: 14px; }
  footer .wrap { display: flex; flex-direction: column; gap: 12px; }
  footer a { color: #fbf8f2; }
  @media (min-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } .hero h1 { font-size: 56px; } }
  @media (min-width: 768px) { nav { display: flex; } .burger { display: none; } footer .wrap { flex-direction: row; justify-content: space-between; } }
  @media (min-width: 1024px) { .grid { grid-template-columns: repeat(3, 1fr); } .hero { padding: 96px 0 80px; } .hero h1 { font-size: 72px; } }
</style></head><body>
<header><div class="wrap"><a class="logo" href="/"><img src="/card.png" alt="Atelier">Atelier</a>
<button class="burger" aria-label="Ouvrir le menu">=</button>
<nav aria-label="Principal"><a href="/offre">Offre</a><a href="/atelier">Atelier</a><a href="/contact">Contact</a></nav></div></header>
<main>
<section class="hero"><span class="badge">Nouveau</span><div class="wrap"><h1>Des meubles faits pour durer</h1><p>Chêne massif, assemblages à tenons et une finition à l'huile : chaque pièce est dessinée et fabriquée dans notre atelier.</p><a class="cta" href="/offre">Voir la collection</a></div></section>
<section class="features"><div class="wrap"><h2>Ce que nous fabriquons</h2><div class="grid">
${card("Tables", "Plateaux massifs, pieds tournés, dimensions sur mesure.")}
${card("Chaises", "Assises sculptées et dossiers cintrés à la vapeur.")}
${card("Rangements", "Buffets et bibliothèques aux tiroirs à queue d'aronde.")}
</div></div></section>
<div class="wrap"><blockquote>La table a traversé trois déménagements sans un jeu. On en commande une deuxième.</blockquote></div>
</main>
<footer><div class="wrap"><span>© 2026 Atelier Fixture</span><span><a href="/mentions">Mentions légales</a> · <a href="/contact">Contact</a></span></div></footer>
</body></html>`;
const BG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><circle cx="160" cy="80" r="70" fill="#e9d5b5"/></svg>`;
const site = await listen((req, res) => {
  if (req.url === "/card.png") return res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
  if (req.url === "/bg.svg") return res.writeHead(200, { "Content-Type": "image/svg+xml" }).end(BG);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
});
const base = `http://127.0.0.1:${site.address().port}`;
const pageUrl = TARGET || `${base}/`;

/* ------------------------------------------------------------- unzip */
function unzip(buffer) {
  const files = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30);
    const comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    offset += 46 + nameLength + extra + comment;
  }
  return files;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".jpg": "image/jpeg" };
const serveDir = (dir) =>
  listen(async (req, res) => {
    const path = join(dir, decodeURIComponent(req.url.split("?")[0]));
    const file = existsSync(path) && extname(path) ? path : join(dir, "index.html");
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" }).end(await readFile(file));
  });

/* ------------------------------------------------------- the capture */
const work = KEEP || (await mkdtemp(join(tmpdir(), "keys-osi-clone-")));
await mkdir(work, { recursive: true });
const ext = join(work, "ext");
await rm(ext, { recursive: true, force: true });
await cp(ROOT, ext, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git|tests|graphify-out|corpus)([\\/]|$)/.test(src) });
const manifest = JSON.parse(await readFile(join(ext, "manifest.json"), "utf8"));
manifest.permissions.push("debugger");
await writeFile(join(ext, "manifest.json"), JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  headless: true,
  channel: "chromium",
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
});
let zipPath = "";
let zipBuffer = null;
let record = null;
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ keysOsiSaveAs: false }));
  const page = await context.newPage();
  await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 });
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/popup/popup.html`);
  const tabId = await panel.evaluate(async (origin) => (await chrome.tabs.query({})).find((t) => (t.url || "").startsWith(origin)).id, new URL(pageUrl).origin);
  await panel.goto(`chrome-extension://${id}/popup/popup.html?tab=${tabId}`);
  await page.bringToFront();
  console.log("Clone from the panel:");
  await panel.click("#codeCloneBtn");
  await panel.waitForFunction(() => !document.getElementById("codeCloneBtn").disabled, null, { timeout: 600000, polling: 500 });
  const status = await panel.textContent("#codeCloneStatus");
  const isError = await panel.evaluate(() => document.getElementById("codeCloneStatus").classList.contains("is-error"));
  check("clone finished without error", !isError, status);
  record = (await panel.evaluate(() => chrome.storage.local.get("keysOsiLastClone"))).keysOsiLastClone;
  check("panel reports the clone", /react-tailwind\.zip/.test(status) && /npm install/.test(status), status);
  const download = await panel.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      // Playwright stores downloads under a GUID name: take the latest one.
      const [item] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
      if (item?.state === "complete") return item.filename;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { all: (await chrome.downloads.search({})).map((item) => [item.filename, item.state, item.error]) };
  });
  zipPath = typeof download === "string" ? download : "";
  check("ZIP downloaded", Boolean(zipPath), download);
  // Playwright deletes its download artifacts with the context: read it now.
  if (zipPath) zipBuffer = await readFile(zipPath);
} finally {
  await context.close();
}

/* ---------------------------------------------------- project checks */
const files = zipBuffer ? unzip(zipBuffer) : new Map();
const names = [...files.keys()];
const folder = names[0]?.split("/")[0] || "";
const text = (path) => files.get(`${folder}/${path}`)?.toString("utf8") || "";
console.log(`Project (${names.length} files):`);
check("Vite + React + Tailwind v4 project", /"vite"/.test(text("package.json")) && /"@tailwindcss\/vite"/.test(text("package.json")) && /tailwindcss\(\)/.test(text("vite.config.js")), text("package.json"));
check("Tailwind without Preflight", text("src/index.css").includes('@import "tailwindcss/utilities.css" layer(utilities);') && !text("src/index.css").includes("preflight"));
if (!TARGET) {
const css = text("src/index.css");
check("every site breakpoint is a Tailwind screen (640, 768, 1024, and 1280 from the cross-origin sheet)", [40, 48, 64, 80].every((rem) => css.includes(`: ${rem}rem;`) && /--breakpoint-/.test(css)), css.slice(0, 700));
check("cross-origin font copied with a local @font-face", /font-family: "Fixture Display";\n\s+src: url\("\/fonts\/display\.woff2"\)/.test(text("src/index.css")) && files.has(`${folder}/public/fonts/display.woff2`), names.filter((n) => n.includes("font")));
const components = names.filter((n) => n.includes("/src/components/")).map((n) => n.split("/").pop());
check("sections as components (Header, Footer, hero, features)", components.includes("Header.jsx") && components.includes("Footer.jsx") && components.some((n) => /^DesMeubles/.test(n)) && components.some((n) => /^CeQueNous/.test(n)), components);
const features = text(`src/components/${components.find((n) => /^CeQueNous/.test(n))}`);
check("the 3 cards become one component fed by 3 data rows", /function \w+Card\(\{ [^}]*title[^}]*\}\)/.test(features) && /\.map\(\(item, index\) =>/.test(features) && (features.match(/"title": /g) || []).length === 3, features.slice(0, 900));
check("card image downloaded", files.has(`${folder}/public/assets/card.png`) && features.includes('"/assets/card.png"'));
check("background image downloaded and referenced", [...files.keys()].some((n) => n.endsWith("/public/assets/bg.svg")) && /bg-\[url\('\/assets\/bg\.svg'\)\]|\[background-image:url\('\/assets\/bg\.svg'\)\]/.test([...files.values()].map(String).join("\n")));
const quote = ([...files.values()].map(String).join("\n").match(/<blockquote className=\{?String\.raw`([^`]*)`|<blockquote className="([^"]*)"/) || [])[1] || "";
check("::before carried by before: classes (content and position)", quote.includes("before:content-['\\201c_']") && quote.includes("before:absolute"), quote.slice(0, 400));
check("mobile-first menu: hidden then shown at the 768 breakpoint", /<nav [^>]*className="[^"]*hidden[^"]*md:flex/.test(text("src/components/Header.jsx")) || /<nav [^>]*className="[^"]*hidden[^"]*\w+:flex/.test(text("src/components/Header.jsx")), (text("src/components/Header.jsx").match(/<nav[^>]*>/) || [""])[0]);
}
check("README explains how to run and the limits", /npm run dev/.test(text("README.md")) && /JavaScript behavior/.test(text("README.md")));

/* ------------------------------------------------- build and compare */
const project = join(work, "project");
await rm(project, { recursive: true, force: true });
for (const [name, data] of files) {
  if (name.endsWith("/")) continue;
  const target = join(project, name.slice(folder.length + 1));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}
let built = false;
try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: project, stdio: "pipe", shell: process.platform === "win32", timeout: 300000 });
  execFileSync(npm, ["run", "build"], { cwd: project, stdio: "pipe", shell: process.platform === "win32", timeout: 300000 });
  built = existsSync(join(project, "dist", "index.html"));
} catch (error) {
  console.log(String(error.stdout || ""), String(error.stderr || error.message).slice(0, 2000));
}
check("npm install + vite build succeed", built);

if (built) {
  const clone = await serveDir(join(project, "dist"));
  const cloneBase = `http://127.0.0.1:${clone.address().port}`;
  const browser = await chromium.launch({ channel: "chromium" });
  const errors = [];
  const shoot = async (url, width) => {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    p.on("console", (message) => message.type() === "error" && url.startsWith(cloneBase) && errors.push(message.text()));
    await p.goto(url, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
    await p.evaluate(() => document.fonts.ready);
    const info = await p.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      text: document.body.innerText.replace(/\s+/g, " ").trim(),
      broken: Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).length,
      font: document.fonts.check('72px "Fixture Display"')
    }));
    const png = await p.screenshot({ fullPage: true });
    await p.close();
    return { ...info, png };
  };
  // RGBA pixels as base64 (a JSON array of numbers runs out of memory on
  // real pages); `scale` shrinks both images alike.
  const pixels = async (pngA, pngB, width, height, scale = 1) => {
    const p = await browser.newPage();
    const result = await p.evaluate(
      async ({ a, b, width, height, scale }) => {
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        const read = async (data) => {
          const img = new Image();
          img.src = `data:image/png;base64,${data}`;
          await img.decode();
          const canvas = new OffscreenCanvas(w, h);
          const g = canvas.getContext("2d");
          g.fillStyle = "#fff";
          g.fillRect(0, 0, w, h);
          g.drawImage(img, 0, 0, img.width * scale, img.height * scale);
          const bytes = g.getImageData(0, 0, w, h).data;
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(binary);
        };
        return { w, h, a: await read(a), b: await read(b) };
      },
      { a: pngA.toString("base64"), b: pngB.toString("base64"), width, height, scale }
    );
    await p.close();
    return { w: result.w, h: result.h, a: Buffer.from(result.a, "base64"), b: Buffer.from(result.b, "base64") };
  };
  // Measured at 375 and at each site breakpoint: any width in between must match too.
  for (const width of [375, 700, 900, 1440]) {
    const original = await shoot(pageUrl, width);
    const copy = await shoot(`${cloneBase}/`, width);
    // Real pages: compare the first 3000px (pixel arrays stay small).
    const height = Math.min(original.height, copy.height, TARGET ? 3000 : Infinity);
    const px = await pixels(original.png, copy.png, width, height, TARGET ? 0.5 : 1);
    const score = ssimFromRgba(px.a, px.b, px.w, px.h);
    const delta = Math.abs(original.height - copy.height) / original.height;
    if (KEEP) {
      await writeFile(join(work, `original-${width}.png`), original.png);
      await writeFile(join(work, `clone-${width}.png`), copy.png);
    }
    console.log(`  ${width}px: SSIM ${score.toFixed(4)}, heights ${original.height} / ${copy.height}`);
    if (!TARGET) {
      check(`${width}px: SSIM ≥ 0.98`, score >= 0.98, score);
      check(`${width}px: page height within 1%`, delta <= 0.01, [original.height, copy.height]);
      const at = [...original.text].findIndex((ch, n) => ch !== copy.text[n]);
      check(`${width}px: same text`, original.text === copy.text, { at, original: original.text.slice(Math.max(0, at - 40), at + 60), copy: copy.text.slice(Math.max(0, at - 40), at + 60) });
      check(`${width}px: no broken image`, copy.broken === 0, copy.broken);
      check(`${width}px: display font loaded from the copy`, copy.font, copy.font);
    }
  }
  if (TARGET) console.log(`  console errors in the clone: ${errors.length}${errors.length ? ` (${errors[0].slice(0, 160)})` : ""}`);
  else check("no console error in the clone", errors.length === 0, errors);
  await browser.close();
  clone.close();
}

site.close();
cdn.close();
if (!KEEP) await rm(work, { recursive: true, force: true }).catch(() => {});
if (failures) {
  console.log(`\n${failures} clone check(s) failed.`);
  process.exit(1);
}
console.log("\nClone E2E passed.");
