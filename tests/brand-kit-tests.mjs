// Keys_Osi Brand Kit engine: synthetic logos with known colors, real
// Fontsource / Google Fonts responses saved under tests/fixtures/fonts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { contrastRatio } from "../lib/color-science.mjs";
import {
  SCALE_STEPS,
  analyzeLogoShape,
  brandKitPromptBlock,
  buildBrandKitFiles,
  buildBrandPalette,
  createBrandKit,
  deltaEOK,
  extractLogoColors,
  hexToOklch,
  recommendFonts,
  resolveKitFonts
} from "../lib/brand-kit.mjs";
import { CURATED_FONTS, fontFaceCss, resolveFontFiles, searchFontCatalog } from "../lib/font-catalog.mjs";

const fixture = (name) => readFile(new URL(`./fixtures/fonts/${name}`, import.meta.url), "utf8");
const INTER_JSON = await fixture("fontsource-inter.json");
const INTER_CSS = await fixture("google-css2-inter-400-700.css");

/* ---------- synthetic logos ---------- */

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function canvas(width, height, bg) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (bg) rgba.set([...hexRgb(bg), 255], i * 4);
  }
  return rgba;
}

// Coverage of a pixel by a shape, 4x4 supersampled: real anti-aliasing.
function coverage(inside, x, y) {
  let hit = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hit++;
  return hit / 16;
}

// Paints `color` with coverage: blended over opaque pixels, alpha on clear ones.
function paint(rgba, width, height, inside, color) {
  const c = hexRgb(color);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = coverage(inside, x, y);
      if (k === 0) continue;
      const o = (y * width + x) * 4;
      if (rgba[o + 3] === 0) {
        rgba.set([...c, Math.round(k * 255)], o);
      } else {
        for (let ch = 0; ch < 3; ch++) rgba[o + ch] = Math.round(c[ch] * k + rgba[o + ch] * (1 - k));
      }
    }
  }
}

const NAVY = "#1b2a4a";
const ORANGE = "#f26b1d";
const TEAL = "#0f9d8a";

function logoA() {
  const w = 240;
  const h = 96;
  const rgba = canvas(w, h, "#ffffff");
  // Wordmark-like bars, slightly slanted so their edges anti-alias too.
  for (let i = 0; i < 5; i++) {
    const x0 = 16 + i * 26;
    paint(rgba, w, h, (x, y) => y >= 22 && y <= 74 && x >= x0 + (74 - y) * 0.08 && x <= x0 + 15 + (74 - y) * 0.08, NAVY);
  }
  paint(rgba, w, h, (x, y) => (x - 196) ** 2 + (y - 48) ** 2 <= 30 ** 2, ORANGE);
  return { rgba, width: w, height: h };
}

function logoB() {
  const w = 128;
  const h = 128;
  const rgba = canvas(w, h, null);
  paint(rgba, w, h, (x, y) => (x - 64) ** 2 + (y - 64) ** 2 <= 46 ** 2, TEAL);
  return { rgba, width: w, height: h };
}

function logoC() {
  const w = 200;
  const h = 80;
  const rgba = canvas(w, h, "#ffffff");
  for (let i = 0; i < 4; i++) {
    const x0 = 20 + i * 42;
    paint(rgba, w, h, (x, y) => x >= x0 + 0.3 && x <= x0 + 28.6 && y >= 16.3 && y <= 63.7, "#000000");
  }
  return { rgba, width: w, height: h };
}

/* ---------- 1. colors ---------- */

const a = logoA();
const colorsA = extractLogoColors(a.rgba, a.width, a.height);
assert.equal(colorsA.background, "#ffffff");
assert.equal(colorsA.transparent, false);
assert.equal(colorsA.swatches.length, 2, `logo A: anti-aliasing leaked into swatches ${JSON.stringify(colorsA.swatches)}`);
const navySw = colorsA.swatches.find((s) => deltaEOK(s.hex, NAVY) < 0.01);
const orangeSw = colorsA.swatches.find((s) => deltaEOK(s.hex, ORANGE) < 0.01);
assert.ok(navySw, `navy not recovered: ${colorsA.swatches.map((s) => s.hex)}`);
assert.ok(orangeSw, `orange not recovered: ${colorsA.swatches.map((s) => s.hex)}`);
assert.ok(navySw.share > orangeSw.share, "bars cover more area than the circle");
// Importance = share x chroma boost: the vivid orange mark outranks the
// larger but dark navy wordmark.
assert.equal(colorsA.swatches[0].hex, orangeSw.hex);
for (const s of colorsA.swatches) {
  assert.match(s.hex, /^#[0-9a-f]{6}$/);
  assert.equal(s.isNeutral, false);
  assert.ok(Math.abs(s.oklch.l - hexToOklch(s.hex).l) < 1e-3);
}

const b = logoB();
const colorsB = extractLogoColors(b.rgba, b.width, b.height);
assert.equal(colorsB.transparent, true);
assert.equal(colorsB.background, null);
assert.equal(colorsB.swatches.length, 1, JSON.stringify(colorsB.swatches));
assert.ok(deltaEOK(colorsB.swatches[0].hex, TEAL) < 0.01, colorsB.swatches[0].hex);

const c = logoC();
const colorsC = extractLogoColors(c.rgba, c.width, c.height);
assert.equal(colorsC.background, "#ffffff");
assert.equal(colorsC.swatches.length, 1, JSON.stringify(colorsC.swatches));
assert.ok(deltaEOK(colorsC.swatches[0].hex, "#000000") < 0.01, colorsC.swatches[0].hex);
assert.equal(colorsC.swatches[0].isNeutral, true);

/* ---------- 2. shape ---------- */

const shapeA = analyzeLogoShape(a.rgba, a.width, a.height, colorsA.background);
const shapeB = analyzeLogoShape(b.rgba, b.width, b.height, colorsB.background);
const shapeC = analyzeLogoShape(c.rgba, c.width, c.height, colorsC.background);
for (const shape of [shapeA, shapeB, shapeC]) {
  for (const key of ["inkCoverage", "strokeContrast", "roundness", "cornerSharpness", "complexity"]) {
    assert.ok(shape[key] >= 0 && shape[key] <= 1, `${key}=${shape[key]}`);
  }
  for (const [k, v] of Object.entries(shape.personality)) assert.ok(v >= 0 && v <= 1, `${k}=${v}`);
  assert.equal(Object.keys(shape.personality).length, 8);
}
assert.equal(shapeA.isWordmarkLikely, true, JSON.stringify(shapeA));
assert.equal(shapeA.components, 6);
assert.equal(shapeB.isWordmarkLikely, false);
assert.ok(Math.abs(shapeB.aspect - 1) < 0.05);
assert.ok(shapeB.roundness > shapeC.roundness, `disc rounder than squares: ${shapeB.roundness} vs ${shapeC.roundness}`);
assert.ok(shapeC.cornerSharpness > shapeB.cornerSharpness, `squares sharper than disc: ${shapeC.cornerSharpness} vs ${shapeB.cornerSharpness}`);
assert.ok(shapeB.personality.friendly > shapeC.personality.friendly);
assert.ok(shapeC.personality.tech > shapeB.personality.tech);
// bbox of the disc: 92 px wide, centered.
assert.ok(Math.abs(shapeB.bbox.width - 92) <= 2 && Math.abs(shapeB.bbox.x - 18) <= 2, JSON.stringify(shapeB.bbox));

/* ---------- 3. palette ---------- */

const L = (hex) => hexToOklch(hex).l;
function checkPalette(palette, logoHexes) {
  for (const [name, scale] of Object.entries(palette.scales)) {
    assert.deepEqual(Object.keys(scale).map(Number), SCALE_STEPS, name);
    for (let i = 1; i < SCALE_STEPS.length; i++) {
      assert.ok(L(scale[SCALE_STEPS[i]]) < L(scale[SCALE_STEPS[i - 1]]), `${name} not monotonic at ${SCALE_STEPS[i]}`);
    }
  }
  for (const hex of logoHexes) {
    const inScale = Object.values(palette.scales).some((scale) => Object.values(scale).includes(hex));
    assert.ok(inScale, `logo color ${hex} missing from scales`);
  }
  assert.ok(Object.values(palette.scales.primary).includes(palette.anchors.primary.hex));
  const expectedRoles = [
    "surface.base", "surface.muted", "surface.raised", "surface.inverse", "text.primary", "text.secondary", "text.muted",
    "text.inverse", "brand.primary", "brand.onPrimary", "brand.secondary", "brand.onSecondary", "accent",
    "border.default", "border.strong", "focus.ring"
  ];
  assert.deepEqual(Object.keys(palette.roles).sort(), expectedRoles.sort());
  for (const hex of Object.values(palette.roles)) assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.ok(palette.contrast.length >= 19 + 16);
  for (const row of palette.contrast) {
    assert.ok(row.ratio >= row.min, `${row.pair}: ${row.ratio} < ${row.min}`);
    assert.equal(row.ratio, Number(contrastRatio(row.fg, row.bg).toFixed(2)));
  }
  // Every text role against every light surface, beyond the listed pairs.
  for (const t of ["text.primary", "text.secondary", "text.muted"]) {
    for (const s of ["surface.base", "surface.muted", "surface.raised"]) {
      assert.ok(contrastRatio(palette.roles[t], palette.roles[s]) >= 4.5, `${t} on ${s}`);
    }
  }
  for (const s of Object.values(palette.semantic)) {
    assert.ok(contrastRatio(s.on, s.base) >= 4.5);
    assert.ok(contrastRatio(s.text, palette.roles["surface.base"]) >= 4.5);
  }
}

const paletteA = buildBrandPalette(colorsA.swatches, { personality: shapeA.personality });
checkPalette(paletteA, [navySw.hex, orangeSw.hex]);
assert.equal(paletteA.anchors.primary.hex, orangeSw.hex);
assert.equal(paletteA.anchors.secondary.derived, false);
assert.equal(paletteA.anchors.secondary.hex, navySw.hex);
assert.equal(paletteA.roles["brand.secondary"], NAVY, "navy passes 3:1, kept verbatim");
// Orange is under 3:1 on surface.muted: darkened for UI, hue kept.
assert.ok(contrastRatio(ORANGE, paletteA.roles["surface.muted"]) < 3);
assert.notEqual(paletteA.roles["brand.primary"], ORANGE);
assert.ok(Math.abs(hexToOklch(paletteA.roles["brand.primary"]).h - hexToOklch(ORANGE).h) < 4);
assert.ok(paletteA.notes.some((n) => n.includes(ORANGE)), "darkening is explained");
assert.equal(paletteA.anchors.accent.derived, true);
// Neutrals are tinted toward the navy hue.
const n500 = hexToOklch(paletteA.scales.neutral[500]);
assert.ok(n500.c > 0.003 && Math.abs(n500.h - hexToOklch(ORANGE).h) < 25, JSON.stringify(n500));

const paletteB = buildBrandPalette(colorsB.swatches, { personality: shapeB.personality });
checkPalette(paletteB, [colorsB.swatches[0].hex]);
assert.equal(paletteB.anchors.secondary.derived, true, "single-color logo derives secondary");
assert.equal(paletteB.anchors.accent.derived, true);
assert.ok(deltaEOK(paletteB.anchors.secondary.hex, paletteB.anchors.primary.hex) > 0.08);
// Hue kept when brand.primary had to be darkened for 3:1.
assert.ok(Math.abs(hexToOklch(paletteB.roles["brand.primary"]).h - hexToOklch(TEAL).h) < 4);

const paletteC = buildBrandPalette(colorsC.swatches, { personality: shapeC.personality });
checkPalette(paletteC, ["#000000"]);
assert.equal(paletteC.harmony, "monochrome + accent");
assert.ok(hexToOklch(paletteC.anchors.accent.hex).c > 0.08, "monochrome logo still gets a chromatic accent");

// A light logo color is darkened for UI use but stays in its scale verbatim.
const yellow = buildBrandPalette([{ hex: "#ffd23f", oklch: hexToOklch("#ffd23f"), share: 1, isNeutral: false }]);
checkPalette(yellow, ["#ffd23f"]);
assert.notEqual(yellow.roles["brand.primary"], "#ffd23f");
assert.ok(Math.abs(hexToOklch(yellow.roles["brand.primary"]).h - hexToOklch("#ffd23f").h) < 6);

/* ---------- 4. fonts ---------- */

function checkPairings(pairings) {
  assert.equal(pairings.length, 3);
  assert.equal(new Set(pairings.map((p) => p.display.id)).size, 3);
  assert.equal(new Set(pairings.map((p) => p.body.id)).size, 3);
  assert.ok(new Set(pairings.map((p) => p.display.category)).size >= 2, "display categories vary");
  for (const p of pairings) {
    assert.ok(CURATED_FONTS.includes(p.display) && CURATED_FONTS.includes(p.body));
    assert.ok(p.display.roles.includes("display") && p.body.roles.includes("body"));
    assert.equal(p.mono.category, "monospace");
    assert.match(p.rationale, /Titres en .+Texte courant en .+français/);
    assert.match(p.rationale, /[éèàç]/);
    assert.ok(Number.isFinite(p.score));
    assert.ok(p.weights.body.includes(400));
    for (const w of p.weights.display) assert.ok(p.display.weights.includes(w));
    assert.ok(p.scale.ratio >= 1.2 && p.scale.ratio <= 1.5);
    assert.equal(p.scale.sizes.length, 9);
    assert.equal(p.scale.sizes[2].px, 16);
    assert.ok(p.scale.sizes[0].px >= 12 && p.scale.sizes[1].px >= 14, "small text stays legible");
    for (let i = 1; i < p.scale.sizes.length; i++) assert.ok(p.scale.sizes[i].px > p.scale.sizes[i - 1].px);
  }
  for (let i = 1; i < pairings.length; i++) assert.ok(pairings[i].score <= pairings[i - 1].score);
}

const luxe = recommendFonts({ personality: { elegant: 0.9, luxury: 0.95, geometric: 0.2, humanist: 0.4, tech: 0.1, playful: 0.1, bold: 0.3, friendly: 0.3 } });
checkPairings(luxe);
assert.equal(luxe[0].display.category, "serif", "luxury brand gets a serif display");
assert.equal(luxe[0].scale.ratio, 1.414);

const techy = recommendFonts({ personality: shapeC.personality, archetypes: ["SaaS tech"] });
checkPairings(techy);
assert.equal(techy[0].display.category, "sans-serif");
assert.equal(techy[0].scale.ratio, 1.25);

const guessed = recommendFonts({ personality: shapeA.personality, fontGuess: { family: "Playfair Display", classification: "Didone serif" } });
checkPairings(guessed);
assert.equal(guessed[0].display.family, "Playfair Display");
assert.match(guessed[0].rationale, /police détectée dans le logo \(Playfair Display\)/);

const commercial = recommendFonts({ personality: shapeB.personality, fontGuess: { family: "Gotham", classification: "geometric sans" } });
checkPairings(commercial);
assert.ok(["Poppins", "Montserrat", "Figtree"].includes(commercial[0].display.family), commercial[0].display.family);
assert.match(commercial[0].rationale, /Alternative libre la plus proche de Gotham/);

/* ---------- font catalog ---------- */

assert.ok(CURATED_FONTS.length >= 60);
assert.equal(new Set(CURATED_FONTS.map((f) => f.id)).size, CURATED_FONTS.length);
for (const f of CURATED_FONTS) {
  assert.ok(f.subsets.includes("latin"), f.id);
  assert.equal(Object.keys(f.tags).length, 8, f.id);
}
for (const cat of ["sans-serif", "serif", "display", "monospace"]) assert.ok(CURATED_FONTS.some((f) => f.category === cat), cat);

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body
  };
}

const calls = [];
const fontsourceFetch = async (url, init) => {
  calls.push({ url, init });
  const m = String(url).match(/api\.fontsource\.org\/v1\/fonts\/([^/?]+)$/);
  if (m) return response(INTER_JSON.replaceAll("inter@latest", `${m[1]}@latest`));
  return response("not found", 404);
};

const interFiles = await resolveFontFiles({ id: "inter", weights: [400, 700], styles: ["normal", "italic"], fetchImpl: fontsourceFetch });
assert.equal(calls[0].url, "https://api.fontsource.org/v1/fonts/inter");
assert.equal(interFiles.length, 4);
assert.deepEqual(interFiles[0], {
  id: "inter",
  family: "Inter",
  weight: 400,
  style: "normal",
  subset: "latin",
  url: "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff2",
  format: "woff2",
  unicodeRange: JSON.parse(INTER_JSON).unicodeRange.latin,
  fileName: "inter-400-normal.woff2",
  source: "fontsource"
});
assert.ok(interFiles.some((f) => f.url.endsWith("latin-700-italic.woff2")));
assert.match(interFiles[0].unicodeRange, /U\+0152-0153/, "latin subset covers French œ");

// Fallback: Fontsource down -> Google css2 parsed (real Chrome-UA response).
const googleCalls = [];
const googleFetch = async (url, init) => {
  googleCalls.push({ url, init });
  if (String(url).includes("fontsource")) return response("{}", 503);
  return response(INTER_CSS);
};
const gFiles = await resolveFontFiles({ id: "inter", weights: [400, 700], fetchImpl: googleFetch });
assert.equal(googleCalls[1].url, "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,700&display=swap");
assert.match(googleCalls[1].init.headers["User-Agent"], /Chrome/);
assert.equal(gFiles.length, 2);
for (const f of gFiles) {
  assert.equal(f.source, "google");
  assert.equal(f.subset, "latin");
  assert.match(f.url, /^https:\/\/fonts\.gstatic\.com\/s\/inter\/v20\/.+\.woff2$/);
  assert.match(f.unicodeRange, /^U\+0000-00FF/);
}

const css = fontFaceCss(interFiles.slice(0, 1), { family: "Inter" });
assert.match(css, /font-family: "Inter";/);
assert.match(css, /src: url\("fonts\/inter-400-normal\.woff2"\) format\("woff2"\);/);
assert.match(css, /font-display: swap;/);
assert.match(fontFaceCss(interFiles.slice(0, 1), { localDir: null }), /cdn\.jsdelivr\.net/);

// Live search mapped + merged with curated (mocked listing, real field names).
const listing = [
  JSON.parse(INTER_JSON),
  { id: "gowun-batang", family: "Gowun Batang", subsets: ["korean", "latin", "latin-ext"], weights: [400, 700, 800], styles: ["normal"], defSubset: "korean", variable: false, category: "serif", license: "OFL-1.1", type: "google" },
  { id: "thin-one", family: "Thin One", subsets: ["latin"], weights: [400], styles: ["normal"], defSubset: "latin", variable: false, category: "serif", license: "OFL-1.1", type: "google" }
];
let searchUrl = "";
const found = await searchFontCatalog({
  category: "serif",
  fetchImpl: async (url) => {
    searchUrl = url;
    return response(JSON.stringify(listing.filter((f) => f.category === "serif")));
  }
});
assert.equal(searchUrl, "https://api.fontsource.org/v1/fonts?category=serif&subsets=latin");
assert.ok(found[0].curated && found.every((f) => f.category === "serif"));
const gowun = found.find((f) => f.id === "gowun-batang");
assert.ok(gowun && gowun.curated === false && gowun.tags.elegant > 0.5);
assert.ok(!found.some((f) => f.id === "thin-one"), "minWeights filter");
assert.ok((await searchFontCatalog({ query: "mono" })).every((f) => /mono/i.test(f.family)));

/* ---------- kit, prompt block, files ---------- */

const kit0 = createBrandKit({ name: "Atelier Nova", ...a, archetypes: ["artisanal"] });
assert.equal(kit0.colors.swatches.length, 2);
assert.ok(kit0.fonts.chosen && kit0.fonts.alternatives.length === 2);
assert.ok(kit0.personality.humanist >= kit0.shape.personality.humanist * 0.6);
const kit = await resolveKitFonts(kit0, { fetchImpl: fontsourceFetch });
const chosen = kit.fonts.chosen;
for (const role of ["display", "body", "mono"]) {
  assert.ok(kit.files[role].length > 0 || (role === "display" && chosen.display.id === chosen.body.id), role);
}

const block = brandKitPromptBlock(kit);
for (const role of Object.keys(kit.palette.roles)) assert.ok(block.includes(`\`${role}\``), role);
for (const hex of [NAVY, ORANGE, kit.palette.roles["surface.base"]]) assert.ok(block.includes(hex), hex);
for (const f of [chosen.display.family, chosen.body.family, chosen.mono.family]) assert.ok(block.includes(f), f);
assert.match(block, /oklch\(/);
assert.match(block, /font-family: "/);
assert.match(block, /fonts\.googleapis\.com\/css2\?family=/);
assert.match(block, /@fontsource\//);
assert.match(block, /≥ 4\.5:1/);

const logoDataUrl = "data:image/png;base64,iVBORw0KGgo=";
const files = buildBrandKitFiles(kit, { logoDataUrl, logoSvg: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>" });
const paths = files.map((f) => f.path);
for (const p of ["BRAND.md", "brand-tokens.css", "tailwind.brand.js", "brand.tokens.json", "charte.html", "palette.svg", "logo/logo.svg", "logo/logo.png"]) {
  assert.ok(paths.includes(p), p);
}
assert.equal(new Set(paths).size, paths.length, "no duplicate paths");
const fontEntries = files.filter((f) => f.path.startsWith("fonts/"));
assert.ok(fontEntries.length >= 4);
for (const f of fontEntries) {
  assert.match(f.path, /^fonts\/[a-z0-9-]+-\d{3}-normal\.woff2$/);
  assert.match(f.url, /^https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\/.+\.woff2$/);
}
assert.equal(files.find((f) => f.path === "logo/logo.png").url, logoDataUrl);
const get = (p) => files.find((f) => f.path === p).content;
const brandMd = get("BRAND.md");
for (const hex of [NAVY, ORANGE, ...Object.values(kit.palette.roles)]) assert.ok(brandMd.includes(hex), `BRAND.md ${hex}`);
for (const f of [chosen.display.family, chosen.body.family, chosen.mono.family]) assert.ok(brandMd.includes(f), `BRAND.md ${f}`);
assert.match(brandMd, /Zone de protection/);
assert.match(brandMd, /À éviter/);
const tokensCss = get("brand-tokens.css");
assert.match(tokensCss, /@font-face/);
assert.match(tokensCss, /url\("fonts\/[a-z0-9-]+-400-normal\.woff2"\)/);
assert.match(tokensCss, /--brand-secondary: #1b2a4a;/);
assert.match(tokensCss, /--brand-primary-500: #f26b1d;|--brand-primary-d+: #f26b1d;/);
assert.match(tokensCss, /--font-display: "/);
for (const f of fontEntries) assert.ok(tokensCss.includes(f.path), `css references ${f.path}`);
const tokens = JSON.parse(get("brand.tokens.json"));
assert.equal(tokens.$schema, "https://design-tokens.github.io/community-group/format/");
assert.equal(tokens.color.role.brand.secondary.$value, NAVY);
assert.equal(tokens.color.role.brand.primary.$value, kit.palette.roles["brand.primary"]);
assert.equal(tokens.color.scale.primary[String(kit.palette.anchors.primary.step)].$value, ORANGE);
assert.equal(tokens.font.family.display.$type, "fontFamily");
const tw = get("tailwind.brand.js");
assert.match(tw, /module\.exports = \{/);
assert.ok(tw.includes(NAVY));
const tailwindModule = { exports: {} };
new Function("module", tw)(tailwindModule);
assert.equal(tailwindModule.exports.theme.extend.colors.brand.secondary, NAVY);
const html = get("charte.html");
assert.match(html, /^<!doctype html>/);
assert.ok(html.includes(chosen.display.family) && html.includes(NAVY) && html.includes("<svg"));
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), "charte.html is self-contained");
const svg = get("palette.svg");
assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
assert.ok(svg.includes(NAVY) && svg.includes(ORANGE));
for (const f of files) assert.ok(!/typeui|anthropic|claude/i.test(f.content || ""), `${f.path} branding`);

console.log("Brand kit tests passed.");
