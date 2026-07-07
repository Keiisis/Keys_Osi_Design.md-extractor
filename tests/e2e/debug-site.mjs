/**
 * Live-site diagnostic: drives a real Chrome to any URL, injects the
 * actual inspector + content script, runs the extraction, normalizes
 * it, and prints what the generators would say — so real-world bugs
 * are seen on real sites, not just fixtures.
 *
 * Usage: node tests/e2e/debug-site.mjs https://example.com
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { normalizeExtractedStyles } from "../../lib/normalize.mjs";
import { buildAtmosphereDescription } from "../../lib/generate-design-md.mjs";
import { generatePromptMarkdown } from "../../lib/generate-prompt-md.mjs";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node tests/e2e/debug-site.mjs <url>");
  process.exit(1);
}

function findLocalChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  return candidates.find((path) => path && existsSync(path));
}

const browser = await chromium.launch({ executablePath: findLocalChrome(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch (error) {
    await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch(() => {});
  }
  // Let hydration, web fonts, and lazy content settle — a small scroll
  // wakes up builders that render on first interaction.
  await page.evaluate(async () => {
    await document.fonts.ready.catch(() => {});
    window.scrollTo(0, 400);
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    window.__typeuiHandlers = [];
    window.chrome = {
      runtime: { onMessage: { addListener(fn) { window.__typeuiHandlers.push(fn); } } }
    };
  });
  const inspector = await readFile(new URL("../../inspector-main.js", import.meta.url), "utf8");
  await page.evaluate(inspector);
  const contentScript = await readFile(new URL("../../content-script.js", import.meta.url), "utf8");
  await page.evaluate(contentScript);

  const extraction = await page.evaluate(
    () => new Promise((resolve) => window.__typeuiHandlers[0]({ type: "TYPEUI_EXTRACT_STYLES" }, null, resolve))
  );
  if (!extraction.ok) {
    throw new Error(extraction.error);
  }
  const p = extraction.payload;

  console.log(`URL: ${url}`);
  console.log(`Sampled: ${p.sampledElements}/${p.totalElements} elements\n`);

  // Raw background colors — frequency of what the sampler actually saw.
  const bgCounts = new Map();
  for (const row of p.colors) {
    const key = row.backgroundColor;
    bgCounts.set(key, (bgCounts.get(key) || 0) + 1);
  }
  console.log("Top raw backgroundColor samples:");
  for (const [value, count] of [...bgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`  ${count}x ${value}`);
  }

  const fontCounts = new Map();
  for (const row of p.typography) {
    const key = row.fontFamily;
    fontCounts.set(key, (fontCounts.get(key) || 0) + 1);
  }
  console.log("\nTop raw fontFamily samples:");
  for (const [value, count] of [...fontCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    console.log(`  ${count}x ${value.slice(0, 90)}`);
  }

  const n = normalizeExtractedStyles(p);
  console.log("\nNormalized color palette:");
  for (const row of n.colorPalette) {
    console.log(`  ${row.token} = ${row.value} (${row.usage})`);
  }
  console.log(`\nPrimary font: ${n.mainFontStyle.primaryFamily} | stack: ${n.mainFontStyle.familyStack.slice(0, 90)}`);
  console.log(`@font-face families: ${n.resources.fontFaces.map((f) => `${f.family}(${f.weight})`).join(", ") || "none readable"}`);
  console.log(`Stylesheets: ${n.resources.stylesheets.length}, Scripts: ${n.resources.scripts.length}`);
  console.log(`Keyframes: ${n.keyframes.map((k) => k.name).join(", ") || "none"}`);
  console.log(`Runtime animations: ${n.runtimeAnimations.length}, GSAP: ${n.gsap?.detected ? n.gsap.version : "no"}, ScrollTriggers: ${n.scrollTriggers.length}`);
  console.log(`Animation libs: ${n.animationLibs.map((l) => l.name).join(", ") || "none"}`);
  console.log(`Parallax measured: ${n.parallax.measured.length}, fixed-bg: ${n.parallax.fixedBackgroundCount}`);
  console.log(`Structure: ${n.structure.map((s) => s.role).join(" → ")}`);
  console.log(`\nATMOSPHERE:\n  ${buildAtmosphereDescription(n)}`);

  if (process.argv.includes("--prompt")) {
    console.log("\n===== PROMPT.md =====");
    console.log(generatePromptMarkdown({ normalized: n }));
  }
} finally {
  await browser.close();
}
