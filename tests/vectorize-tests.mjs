// Keys_Osi vectorizer tests: synthetic anti-aliased logos → SVG → rendered back
// in Chromium → SSIM against the source.
// Usage: node tests/vectorize-tests.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { vectorizeLogo, scoreVectorization, bestVectorization } from "../lib/vectorize.mjs";

const SS = 4;

// Rasterizes inside-tests with 4x4 supersampling: real anti-aliased edges.
// `shapes` is a list of { color: [r,g,b], inside(x, y) } painted in order.
function raster(w, h, bg, shapes) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let c = bg;
          for (const s of shapes) if (s.inside(px, py)) c = [...s.color, 255];
          const a = c[3] / 255;
          acc = [acc[0] + c[0] * a, acc[1] + c[1] * a, acc[2] + c[2] * a, acc[3] + c[3]];
        }
      }
      const n = SS * SS;
      const p = (y * w + x) * 4;
      const alpha = acc[3] / n;
      out[p + 3] = Math.round(alpha);
      for (let k = 0; k < 3; k++) out[p + k] = alpha > 0 ? Math.round((acc[k] / n) / (alpha / 255)) : 0;
    }
  }
  return out;
}

const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const polygon = (pts) => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];
const NAVY = [27, 42, 74];
const ORANGE = [242, 107, 29];

const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage();
await page.setContent("<!doctype html><canvas id=c></canvas>");

async function render(svg, w, h) {
  const data = await page.evaluate(async ({ svg, w, h }) => {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const c = document.getElementById("c");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return Array.from(ctx.getImageData(0, 0, w, h).data);
  }, { svg, w, h });
  return Uint8ClampedArray.from(data);
}

async function parses(svg) {
  return page.evaluate((svg) => {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    return !doc.querySelector("parsererror") && doc.documentElement.nodeName === "svg";
  }, svg);
}

const px = (rgba, w, x, y) => Array.from(rgba.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

async function check(name, rgba, w, h, opts, maxPaths) {
  const result = vectorizeLogo(rgba, w, h, opts);
  const rendered = await render(result.svg, w, h);
  const score = scoreVectorization(rgba, rendered, w, h);
  const bytes = Buffer.byteLength(result.svg);
  console.log(`  ${name}: ssim=${score.ssim.toFixed(4)} diff=${(score.diffRatio * 100).toFixed(2)}% paths=${result.pathCount} colors=${result.colors.join(",")} bytes=${bytes}`);
  assert.ok(await parses(result.svg), `${name}: SVG parses`);
  assert.ok(score.ssim >= 0.92, `${name}: SSIM ${score.ssim} < 0.92`);
  assert.ok(bytes < 20 * 1024, `${name}: SVG ${bytes} B >= 20 KB`);
  assert.ok(result.pathCount >= 1 && result.pathCount <= maxPaths, `${name}: pathCount ${result.pathCount}`);
  assert.equal(result.width, w);
  assert.equal(result.height, h);
  assert.ok(result.svg.includes(`viewBox="0 0 ${w} ${h}"`), `${name}: viewBox`);
  assert.ok(!/<rect/.test(result.svg), `${name}: no background rect`);
  assert.ok(!/\d\.\d{3}/.test(result.svg), `${name}: coordinates rounded to 2 decimals`);
  assert.ok(/fill-rule="evenodd"/.test(result.svg), `${name}: evenodd`);
  return { result, rendered, score };
}

console.log("Vectorize tests:");

// 1. Filled circle on transparent background (alpha removal).
{
  const w = 200;
  const img = raster(w, w, CLEAR, [{ color: NAVY, inside: circle(100, 100, 70) }]);
  const { result, rendered } = await check("circle", img, w, w, {}, 1);
  assert.equal(result.colors.length, 1);
  assert.equal(px(rendered, w, 5, 5)[3], 0, "circle: outside stays transparent");
  assert.ok(px(rendered, w, 100, 100)[3] === 255, "circle: center opaque");
  // A circle must come out as curves, not as a polygon with corners.
  assert.ok(!/l/.test(result.svg.match(/ d="([^"]+)"/)[1]), "circle: no straight segments");
}

// 2. Ring with a hole on white, explicit background.
{
  const w = 220;
  const ring = (x, y) => circle(110, 110, 90)(x, y) && !circle(110, 110, 50)(x, y);
  const img = raster(w, w, WHITE, [{ color: NAVY, inside: ring }]);
  const { result, rendered } = await check("ring", img, w, w, { background: "#ffffff" }, 1);
  const hole = px(rendered, w, 110, 110);
  assert.equal(hole[3], 0, "ring: hole pixel transparent");
  assert.equal((result.svg.match(/M/g) || []).length, 2, "ring: outer + hole subpaths");
}

// 3. Letter-like polygon with sharp corners on white (auto background).
{
  const w = 240;
  const K = [[40, 30], [90, 30], [90, 100], [160, 30], [215, 30], [130, 115], [215, 210], [160, 210], [90, 130], [90, 210], [40, 210]];
  const img = raster(w, w, WHITE, [{ color: NAVY, inside: polygon(K) }]);
  const { result, rendered } = await check("letter", img, w, w, {}, 1);
  // Corner sharpness: points 1.5 px inside the square corners stay solid.
  for (const [x, y] of [[41, 31], [88, 31], [41, 208], [88, 208]]) {
    const p = px(rendered, w, x, y);
    assert.ok(p[3] > 200, `letter: corner (${x},${y}) stays sharp (alpha ${p[3]})`);
  }
  assert.ok(/l/.test(result.svg), "letter: straight edges emitted as lines");
}

// 4. Two-color mark (navy + orange) on white with a brand palette.
{
  const w = 256;
  const shapes = [
    { color: NAVY, inside: circle(128, 128, 100) },
    { color: ORANGE, inside: polygon([[128, 50], [200, 170], [56, 170]]) }
  ];
  const img = raster(w, w, WHITE, shapes);
  const palette = ["#1b2a4a", "#f26b1d"];
  const { result, rendered } = await check("two-color", img, w, w, { palette }, 2);
  assert.deepEqual([...result.colors].sort(), [...palette].sort(), "two-color: palette hexes exactly");
  for (const hex of palette) assert.ok(result.svg.includes(`fill="${hex}"`), `two-color: ${hex} used`);
  const o = px(rendered, w, 128, 140);
  assert.ok(Math.abs(o[0] - 242) < 3 && Math.abs(o[1] - 107) < 3 && Math.abs(o[2] - 29) < 3, "two-color: orange area orange");
  const auto = await check("two-color auto", img, w, w, {}, 2);
  assert.equal(auto.result.colors.length, 2, "two-color auto: two colors found");
  for (const ref of [NAVY, ORANGE]) {
    const near = auto.result.colors.some((hex) => [1, 3, 5].every((o, k) => Math.abs(parseInt(hex.slice(o, o + 2), 16) - ref[k]) <= 6));
    assert.ok(near, `two-color auto: found a color near rgb(${ref})`);
  }
}

// 5. Tiny 48x48 icon: rounded square with a check-mark cut-out (upscale path).
{
  const w = 48;
  const rounded = (x, y) => {
    const cx = Math.max(8, Math.min(40, x));
    const cy = Math.max(8, Math.min(40, y));
    return x >= 4 && x <= 44 && y >= 4 && y <= 44 && (x - cx) ** 2 + (y - cy) ** 2 <= 16;
  };
  const check_ = polygon([[13, 24], [17, 20], [21, 25], [31, 14], [35, 18], [21, 33]]);
  const img = raster(w, w, CLEAR, [{ color: ORANGE, inside: (x, y) => rounded(x, y) && !check_(x, y) }]);
  const { rendered } = await check("tiny icon", img, w, w, {}, 1);
  assert.equal(px(rendered, w, 21, 28)[3], 0, "tiny icon: check-mark cut-out transparent");
}

// 6. Hard-edged (aliased) art: the staircase must become smooth curves.
{
  const w = 160;
  const img = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const inside = (x + 0.5 - 80) ** 2 + (y + 0.5 - 80) ** 2 <= 60 * 60;
      img.set(inside ? [...NAVY, 255] : WHITE, (y * w + x) * 4);
    }
  }
  const { result } = await check("aliased circle", img, w, w, {}, 1);
  // Commands only (implicit repeats count too): each c has 6 numbers, each l has 2.
  const d = result.svg.match(/ d="([^"]+)"/)[1];
  const segments = d.split(/(?=[cl])/).slice(1).reduce((n, part) => n + Math.round((part.slice(1).match(/-?\.?\d[\d.]*/g) || []).length / (part[0] === "c" ? 6 : 2)), 0);
  assert.ok(segments <= 16, `aliased circle: ${segments} segment commands, staircase not smoothed`);
}

// scoreVectorization sanity + bestVectorization with the browser renderer.
{
  const img = raster(64, 64, WHITE, [{ color: NAVY, inside: circle(32, 32, 20) }]);
  const same = scoreVectorization(img, img, 64, 64);
  assert.equal(same.ssim, 1);
  assert.equal(same.diffRatio, 0);
  const best = await bestVectorization(img, 64, 64, {}, render);
  console.log(`  best: detail=${best.detail} ssim=${best.score.ssim.toFixed(4)} trials=${best.trials.map((t) => `${t.detail}:${t.ssim.toFixed(4)}/${t.bytes}B`).join(" ")}`);
  assert.equal(best.trials.length, 3);
  assert.ok(best.score.ssim >= Math.max(...best.trials.map((t) => t.ssim)) - 0.002, "best: picks top score");
  assert.ok(best.score.ssim >= 0.92);
}

// Input validation.
assert.throws(() => vectorizeLogo(new Uint8Array(10), 10, 10), /width\*height\*4/);

await browser.close();
console.log("Vectorize tests passed.");
