// Runs deep-probe.js in a real Chromium isolated world (same world type as
// chrome.scripting.executeScript with files) against tests/fixtures/deep/,
// then checks lib/deep-signals.mjs on the result.
// Usage: node tests/deep-signals-tests.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  classifyImage,
  cssColorToHex,
  deepSignalsPromptBlock,
  generateDeepSignalsMarkdown,
  summarizeDeepSignals
} from "../lib/deep-signals.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROBE = readFileSync(`${ROOT}deep-probe.js`, "utf8");
const FIXTURE = readFileSync(`${ROOT}tests/fixtures/deep/index.html`, "utf8");

/* ---------------- pure unit checks (no browser) ---------------- */

assert.equal(cssColorToHex("rgb(15, 44, 86)"), "#0f2c56");
assert.equal(cssColorToHex("rgba(0, 0, 0, 0.5)"), "#00000080");
assert.equal(cssColorToHex("#ABCDEF"), "#abcdef");
assert.equal(classifyImage({ src: "a.png", fmt: "png", w: 300, h: 200, px: { unique: 9, flat: 0.8, sat: 0.6 } }), "illustration");
assert.equal(classifyImage({ src: "a.jpg", fmt: "jpg", w: 300, h: 200, px: { unique: 80, flat: 0.1, sat: 0.4 } }), "photo");
assert.equal(classifyImage({ src: "/img/hero-3d-render.png", fmt: "png", w: 600, h: 400 }), "3d-render");
assert.equal(classifyImage({ src: "x.svg", fmt: "svg", w: 24, h: 24 }), "icon");
assert.equal(summarizeDeepSignals(null), null);
{
  // An empty probe must not throw and must tell the agent what NOT to invent.
  const empty = summarizeDeepSignals({});
  const md = generateDeepSignalsMarkdown(empty);
  assert.match(md, /No dark theme detected/);
  assert.match(md, /No icon system detected/);
  assert.match(md, /No explicit z-index found/);
  assert.equal(empty.voice, null);
}
{
  // English, informal, you-focused copy with frequent emoji.
  const s = summarizeDeepSignals({
    meta: { lang: "en" },
    copy: {
      headings: [{ level: "h1", text: "Build Faster With Your Team", transform: "none" }],
      ctas: [{ text: "Get started", count: 3 }, { text: "Start my free trial", count: 1 }],
      paragraphs: [
        "You're gonna love how fast this is! Let's ship your next idea today 🚀.",
        "Your team can try it for free and you'll see results in minutes 🎉. It's awesome!"
      ],
      nav: []
    }
  });
  assert.equal(s.voice.language, "en");
  assert.equal(s.voice.formality, "informal");
  assert.equal(s.voice.person, "you-focused");
  assert.equal(s.voice.cta.style, "imperative");
  assert.equal(s.voice.cta.verbs[0].verb, "get");
  assert.equal(s.voice.headings.case, "Title Case");
  assert.equal(s.voice.emoji.level, "frequent");
}

/* ---------------- browser run against the fixture ---------------- */

const remote = createServer((_q, r) => r.writeHead(200, { "Content-Type": "text/css" }).end(".remote { position: relative; z-index: 3; }"));
await new Promise((ok) => remote.listen(0, "127.0.0.1", ok));
const html = FIXTURE.replace("{{XORIGIN}}", `http://localhost:${remote.address().port}`);

// Stress page: ~25k elements, ~6k CSS rules, 400 SVGs, 300 images.
const bigCss = Array.from({ length: 6000 }, (_, i) => `.c${i}{color:#${(i * 2654435).toString(16).slice(-6).padStart(6, "0")};padding:${i % 40}px;z-index:${i % 7}}`).join("\n");
const bigBody = Array.from({ length: 2500 }, (_, i) =>
  `<section class="c${i}"><h2>Section ${i} heading text</h2><p>Paragraph ${i} with enough words to be counted as real body copy for the voice analysis.</p>` +
  `<ul><li>a</li><li>b</li><li>c</li></ul>${i % 6 === 0 ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"/></svg>` : ""}` +
  `${i % 8 === 0 ? `<img width="120" height="80" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%23${(i * 999).toString(16).slice(-6).padStart(6, "0")}'/%3E%3C/svg%3E">` : ""}<a class="btn" href="#">Go ${i}</a></section>`
).join("");
const bigHtml = `<!doctype html><html lang="en"><head><title>Big</title><style>${bigCss}</style></head><body>${bigBody}</body></html>`;

const server = createServer((q, r) => {
  r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  r.end(q.url.startsWith("/big") ? bigHtml : html);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: "chromium", headless: true });

async function runProbe(page) {
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { executionContextId } = await cdp.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "keys-osi-test" });
  const started = performance.now();
  const out = await cdp.send("Runtime.evaluate", { expression: PROBE, contextId: executionContextId, returnByValue: true });
  const wallMs = performance.now() - started;
  assert.equal(out.exceptionDetails, undefined, `probe threw: ${JSON.stringify(out.exceptionDetails)}`);
  return { probe: out.result.value, wallMs };
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));

  // Read-only: no DOM change, no network request while the probe runs.
  const before = await page.evaluate(() => document.documentElement.outerHTML);
  let requests = 0;
  page.on("request", () => requests++);
  const { probe, wallMs } = await runProbe(page);
  const after = await page.evaluate(() => document.documentElement.outerHTML);
  assert.equal(after, before, "probe must not mutate the DOM");
  assert.equal(requests, 0, "probe must not issue network requests");

  // Bounds and coverage.
  assert.equal(probe.version, 1);
  assert.ok(probe.meta.durationMs < 1500 && wallMs < 1500, `fixture probe too slow: ${probe.meta.durationMs}ms / ${wallMs}ms`);
  assert.ok(JSON.stringify(probe).length < 200000);
  assert.deepEqual(probe.meta.truncated, []);
  assert.equal(probe.meta.sheets.crossOrigin, 1, "cross-origin sheet counted, not read");
  assert.equal(probe.meta.sheets.readable, 1);
  assert.equal(probe.meta.lang, "fr");

  const s = summarizeDeepSignals(probe);

  // Voice & tone.
  const v = s.voice;
  assert.equal(v.language, "fr");
  assert.equal(v.languageMismatch, false);
  assert.equal(v.formality, "formal");
  assert.equal(v.addressForm, "vous");
  assert.equal(v.addressEvidence.informal, 0, "no false 'ta' match inside 'table'");
  assert.equal(v.person, "we-to-you");
  assert.equal(v.tone, "friendly");
  assert.equal(v.secondaryTone, "premium");
  assert.deepEqual(v.adjectives, ["warm", "refined", "courteous", "personal", "concise"]);
  assert.equal(v.sentences.length, "short");
  assert.equal(v.sentences.exclamations, 0);
  assert.equal(v.emoji.level, "rare");
  assert.deepEqual(v.emoji.used, ["✨", "🍷"]);
  assert.equal(v.cta.style, "imperative");
  assert.deepEqual(v.cta.verbs[0], { verb: "réservez", count: 2 });
  assert.equal(v.cta.casing, "Sentence case");
  assert.equal(v.headings.case, "Sentence case");
  assert.deepEqual(v.headings.cssTransforms, ["h2: uppercase"]);

  // Imagery and backgrounds.
  const im = s.imagery;
  assert.equal(im.dominant, "photography");
  assert.deepEqual(im.counts, { photo: 4, illustration: 1 });
  assert.equal(im.corners, "rounded 16px");
  assert.equal(im.circles, 1);
  assert.equal(im.clipPaths, 1);
  assert.deepEqual(im.filters, [{ value: "grayscale(1)", count: 1 }]);
  assert.equal(im.objectFitCover, 3);
  assert.equal(im.altCoverage, 1);
  assert.deepEqual(im.patterns, ["dot-grid", "line-grid", "gradient-mesh", "noise", "glass (backdrop blur)"]);
  assert.ok(im.patternSamples.some((p) => p.kind === "dotGrid" && p.size === "16px 16px" && p.value.includes("#cbd5e1")));

  // Icons.
  const ic = s.icons;
  assert.equal(ic.library, "lucide");
  assert.equal(ic.system, "inline-svg");
  assert.deepEqual(ic.systems, [{ id: "inline-svg", count: 5 }, { id: "icon-font", count: 1 }]);
  assert.equal(ic.style, "stroke");
  assert.equal(ic.strokeWidth, 2);
  assert.equal(ic.roundCaps, true);
  assert.equal(ic.grid, 24);
  assert.equal(ic.primarySize, "24x24");
  assert.equal(ic.fonts[0].family, "Font Awesome 6 Free");

  // Logo.
  const logo = s.logo;
  assert.equal(logo.kind, "svg");
  assert.equal(logo.width, 120);
  assert.equal(logo.height, 32);
  assert.deepEqual(logo.colors, ["#0f2c56"]);
  assert.equal(logo.label, "Maison Lumière");
  assert.equal(logo.placement, "header, links to /");
  assert.match(logo.svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(logo.favicon, /\/favicon\.svg$/);

  // Dark mode.
  const d = s.darkMode;
  assert.equal(d.supported, true);
  assert.equal(d.mechanism, "system + manual override");
  assert.deepEqual(d.strategies, ["prefers-color-scheme", "data-attribute"]);
  assert.deepEqual(d.selectors, ['[data-theme="dark"]']);
  assert.deepEqual(d.pairs, [
    { name: "--bg", light: "#ffffff", dark: "#0b0b0c" },
    { name: "--fg", light: "#111111", dark: "#f5f5f5" },
    { name: "--accent", light: "#2563eb", dark: "#8ab4ff" }
  ]);
  assert.equal(d.toggle, true);
  assert.equal(d.colorScheme, "light dark");
  assert.equal(d.metaColorScheme, "light dark");
  assert.deepEqual(d.themeColor, { light: "#ffffff", dark: "#0b0b0c" });

  // Form states.
  const f = s.formStates;
  assert.equal(f.states.focus.selector, "input:focus-visible");
  assert.deepEqual(f.states.focus.decls, { outline: "#2563eb solid 2px", "outline-offset": "2px" });
  assert.deepEqual(f.states.invalid.decls, { "border-color": "#dc2626" });
  assert.deepEqual(f.states.disabled.decls, { opacity: "0.5", cursor: "not-allowed" });
  assert.deepEqual(f.states.placeholder.decls, { color: "#9ca3af" });
  assert.equal(f.accentColor, "#2563eb");
  assert.deepEqual(f.missing, []);
  assert.equal(f.inputs, 3);

  // Modern CSS.
  const m = s.modernCss;
  for (const key of ["containerQueries", "containerType", "has", "subgrid", "viewTransitions", "layers", "nesting", "clamp", "colorMix", "oklch", "displayP3", "animationTimeline", "viewTimeline", "propertyRule", "startingStyle", "textWrapBalance", "reducedMotion", "backdropFilter", "focusVisible"]) {
    assert.ok(m.used.includes(key), `modern CSS feature not detected: ${key}`);
  }
  for (const absent of ["anchor", "scope", "lightDark", "textWrapPretty"]) assert.ok(!m.used.includes(absent), `false positive: ${absent}`);
  assert.deepEqual(m.layers, ["reset", "base"]);
  assert.deepEqual(m.containers, [{ condition: "(min-width: 400px)", count: 1 }]);
  assert.deepEqual(m.registeredProperties, ["--angle"]);

  // Z-index (the cross-origin sheet's z-index: 3 is unreadable and absent).
  const z = s.zIndex;
  assert.deepEqual(z.scale.map((e) => e.value), [50, 1000, 9999, 99999]);
  assert.deepEqual(z.scale.map((e) => e.layer), ["sticky", "overlay", "overlay", "toast"]);
  assert.deepEqual(z.scale[0].positions, ["sticky"]);
  assert.equal(z.issues.length, 1);
  assert.match(z.issues[0], /99999/);

  // Markdown + prompt block.
  const md = generateDeepSignalsMarkdown(s);
  const order = ["## Voice & Tone", "## Imagery", "## Icon System", "## Logo", "## Dark Mode", "## Form States", "## Modern CSS", "## Z-Index Scale"];
  let last = -1;
  for (const h of order) {
    const at = md.indexOf(h);
    assert.ok(at > last, `section missing or out of order: ${h}`);
    last = at;
  }
  assert.ok(md.includes('address the reader with "vous"'));
  assert.ok(md.includes("| `--bg` | `#ffffff` | `#0b0b0c` |"));
  assert.ok(md.includes("Library: lucide"));
  assert.ok(md.includes("`input:focus-visible` → `outline: #2563eb solid 2px; outline-offset: 2px`"));
  assert.ok(md.includes("glass: `backdrop-filter: blur(12px)`"));
  assert.ok(md.includes("```svg"));
  const block = deepSignalsPromptBlock(s);
  assert.ok(block.startsWith("Voice: French, formal (vous), we-to-you"));
  assert.ok(block.length < 1500, `prompt block too long: ${block.length}`);
  assert.equal(block.split("\n").length, 8);

  // Time and size bounds on a large page.
  const big = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await big.goto(`${base}/big`, { waitUntil: "load" });
  const heavy = await runProbe(big);
  const elementsTotal = heavy.probe.meta.elementsTotal;
  assert.ok(elementsTotal > 20000, `stress page too small: ${elementsTotal}`);
  assert.ok(heavy.probe.meta.durationMs < 1500, `big page probe: ${heavy.probe.meta.durationMs}ms`);
  assert.ok(heavy.wallMs < 1500, `big page wall time: ${Math.round(heavy.wallMs)}ms`);
  const heavyBytes = JSON.stringify(heavy.probe).length;
  assert.ok(heavyBytes < 200000, `big page result: ${heavyBytes} bytes`);
  const heavySummary = summarizeDeepSignals(heavy.probe);
  assert.equal(heavySummary.voice.language, "en");
  assert.ok(generateDeepSignalsMarkdown(heavySummary).includes("## Z-Index Scale"));
  console.log(`  fixture: ${probe.meta.durationMs}ms, ${probe.meta.bytes} B | stress (${elementsTotal} elements, ${heavy.probe.meta.sheets.rules} rules): ${heavy.probe.meta.durationMs}ms probe / ${Math.round(heavy.wallMs)}ms wall, ${heavyBytes} B, truncated=[${heavy.probe.meta.truncated}]`);
} finally {
  await browser.close();
  server.close();
  remote.close();
}

console.log("Deep signals tests passed.");
