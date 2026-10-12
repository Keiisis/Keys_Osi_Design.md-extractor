/**
 * Keys_Osi Brand Kit engine: from an uploaded logo (decoded RGBA) to a
 * precise brand charter (palette + typography), downloadable files, and a
 * block injected into the PROMPT_PRO master prompt.
 *
 * Pure functions. The caller decodes the image (canvas / OffscreenCanvas)
 * and passes RGBA bytes; network access only happens through an injected
 * fetchImpl (see resolveKitFonts).
 *
 * The `kit` object (output of createBrandKit, input of brandKitPromptBlock
 * and buildBrandKitFiles):
 * {
 *   name: string,
 *   colors: { background: hex|null, transparent: boolean,
 *             swatches: [{ hex, oklch: { l, c, h }, share, isNeutral, fromBackground? }] },
 *   shape: { aspect, inkCoverage, strokeContrast, roundness, cornerSharpness,
 *            complexity, isWordmarkLikely, personality, bbox: { x, y, width, height },
 *            imageSize: { width, height }, strokeWidth: { thin, median, thick }, components },
 *   personality: { geometric, humanist, elegant, tech, playful, bold, luxury, friendly },
 *   archetypes: string[],
 *   palette: { scales, semantic, roles, contrast, anchors, harmony, notes },
 *   fonts: { chosen: Pairing, alternatives: Pairing[] },
 *   files: { display: FontFile[], body: FontFile[], mono: FontFile[] }
 * }
 * Pairing  = { display, body, mono (catalog entries), weights: { display, body, mono },
 *              rationale (fr), score, scale: { ratio, name, base, sizes: [{ token, px, rem }] } }
 * FontFile = resolveFontFiles() row: { id, family, weight, style, subset, url, format, unicodeRange, fileName, source }
 */

import { contrastRatio, hexToRgb, relativeLuminance } from "./color-science.mjs";
import { CURATED_FONTS, TAG_KEYS, findCatalogFont, fontFaceCss, googleCss2Url, resolveFontFiles } from "./font-catalog.mjs";
import { analyzeFontLicensing } from "./font-licenses.mjs";

/* ------------------------------------------------------------------ */
/* OKLab / OKLCH (color-science only goes OKLab -> sRGB, clamped)      */
/* ------------------------------------------------------------------ */

const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v, digits = 3) => Number(v.toFixed(digits));

function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

const encode = (v) => {
  const c = clamp01(v);
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

const toHex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export function rgbToOklab(r, g, b) {
  return linearToOklab(LINEAR[r], LINEAR[g], LINEAR[b]);
}

export function hexToOklab(hex) {
  const c = hexToRgb(hex);
  return c ? rgbToOklab(c.r, c.g, c.b) : [0, 0, 0];
}

export function hexToOklch(hex) {
  const [l, a, b] = hexToOklab(hex);
  const c = Math.hypot(a, b);
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

const labToHex = ([L, a, b]) => {
  const [r, g, bl] = oklabToLinear(L, a, b);
  return toHex(encode(r), encode(g), encode(bl));
};

function inGamut(l, c, h) {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear(l, c * Math.cos(rad), c * Math.sin(rad)).every((v) => v >= -1e-5 && v <= 1 + 1e-5);
}

/** OKLCH -> #hex, chroma reduced (hue and lightness kept) until inside sRGB. */
export function oklchToHex(l, c, h) {
  const L = clamp01(l);
  let C = Math.max(0, c);
  if (!inGamut(L, C, h)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(L, mid, h)) lo = mid;
      else hi = mid;
    }
    C = lo;
  }
  const rad = (h * Math.PI) / 180;
  return labToHex([L, C * Math.cos(rad), C * Math.sin(rad)]);
}

/** Perceptual distance (Euclidean OKLab; 0.02 is a just-noticeable step). */
export function deltaEOK(x, y) {
  const a = typeof x === "string" ? hexToOklab(x) : x;
  const b = typeof y === "string" ? hexToOklab(y) : y;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const formatOklch = ({ l, c, h }) => `oklch(${round(l, 3)} ${round(c, 3)} ${round(h, 1)})`;
const oklchOf = (hex) => {
  const o = hexToOklch(hex);
  return { l: round(o.l, 4), c: round(o.c, 4), h: round(o.h, 1) };
};
const hueDiff = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/* ------------------------------------------------------------------ */
/* Pixel sampling                                                      */
/* ------------------------------------------------------------------ */

// Big uploads are sampled on a regular grid: k-means and morphology only
// need ~200k pixels to be exact on flat logo colors.
function sampleGrid(rgba, width, height, maxPixels) {
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxPixels)));
  const sw = Math.ceil(width / step);
  const sh = Math.ceil(height / step);
  const n = sw * sh;
  const key = new Int32Array(n);
  const alpha = new Uint8Array(n);
  const lab = new Float32Array(n * 3);
  const cache = new Map();
  for (let sy = 0; sy < sh; sy++) {
    const y = Math.min(height - 1, sy * step);
    for (let sx = 0; sx < sw; sx++) {
      const x = Math.min(width - 1, sx * step);
      const o = (y * width + x) * 4;
      const i = sy * sw + sx;
      const k = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
      key[i] = k;
      alpha[i] = rgba[o + 3];
      let v = cache.get(k);
      if (!v) {
        v = rgbToOklab(rgba[o], rgba[o + 1], rgba[o + 2]);
        cache.set(k, v);
      }
      lab[i * 3] = v[0];
      lab[i * 3 + 1] = v[1];
      lab[i * 3 + 2] = v[2];
    }
  }
  return { step, sw, sh, n, key, alpha, lab };
}

const keyHex = (k) => toHex((k >> 16) & 255, (k >> 8) & 255, k & 255);
const labAt = (grid, i) => [grid.lab[i * 3], grid.lab[i * 3 + 1], grid.lab[i * 3 + 2]];

// Logos are flat: the most frequent exact color is the true color when it
// dominates; otherwise (photos, JPEG noise) the mean is safer.
function representative(counts, total, meanLab) {
  let topKey = -1;
  let topCount = 0;
  for (const [k, count] of counts) {
    if (count > topCount) {
      topCount = count;
      topKey = k;
    }
  }
  return topKey >= 0 && topCount >= 0.2 * total ? keyHex(topKey) : labToHex(meanLab);
}

function detectBackground(grid) {
  const { sw, sh, alpha, key } = grid;
  const ring = Math.max(1, Math.round(Math.min(sw, sh) * 0.02));
  let border = 0;
  let clear = 0;
  const buckets = new Map();
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      if (sx >= ring && sy >= ring && sx < sw - ring && sy < sh - ring) continue;
      const i = sy * sw + sx;
      border++;
      if (alpha[i] < 16) {
        clear++;
        continue;
      }
      if (alpha[i] < 200) continue;
      const k = key[i];
      const q = (((k >> 20) & 15) << 8) | (((k >> 12) & 15) << 4) | ((k >> 4) & 15);
      let bucket = buckets.get(q);
      if (!bucket) buckets.set(q, (bucket = { count: 0, exact: new Map(), sum: [0, 0, 0] }));
      bucket.count++;
      bucket.exact.set(k, (bucket.exact.get(k) || 0) + 1);
      const v = labAt(grid, i);
      bucket.sum[0] += v[0];
      bucket.sum[1] += v[1];
      bucket.sum[2] += v[2];
    }
  }
  let clearAll = 0;
  for (let i = 0; i < grid.n; i++) if (alpha[i] < 16) clearAll++;
  const transparent = clear / Math.max(1, border) > 0.5 || clearAll / grid.n > 0.25;
  if (transparent) return { transparent: true, background: null };
  const opaque = [...buckets.values()].reduce((s, b) => s + b.count, 0);
  const top = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  // A busy border (photo, full-bleed artwork) has no single background.
  if (!top || top.count < 0.5 * opaque) return { transparent: false, background: null };
  const mean = top.sum.map((v) => v / top.count);
  return { transparent: false, background: representative(top.exact, top.count, mean) };
}

/* ------------------------------------------------------------------ */
/* 1. Logo colors                                                      */
/* ------------------------------------------------------------------ */

const dist2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;

// Where does p fall on segment a->b? t in [0,1] along it, d = distance off it.
function segmentProjection(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (len2 < 1e-9) return { t: 0, d: Math.sqrt(dist2(p, a)) };
  const t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2;
  const q = [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
  return { t, d: Math.sqrt(dist2(p, q)) };
}

function isBlendOf(p, anchors, maxOff) {
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const { t, d } = segmentProjection(p, anchors[i], anchors[j]);
      if (t > 0.1 && t < 0.9 && d < maxOff) return true;
    }
  }
  return false;
}

// Deterministic k-means++ (heaviest point first, then argmax weight * D^2)
// followed by weighted Lloyd iterations, all in OKLab.
function kmeans(points, k) {
  if (points.length === 0) return [];
  let first = 0;
  points.forEach((p, i) => {
    if (p.w > points[first].w) first = i;
  });
  const centers = [[...points[first].lab]];
  const d2 = points.map((p) => dist2(p.lab, centers[0]));
  while (centers.length < k) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < points.length; i++) {
      const score = points[i].w * d2[i];
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    // Remaining points all sit on existing centers: no further real color.
    if (best < 0 || d2[best] < 0.015 ** 2) break;
    centers.push([...points[best].lab]);
    for (let i = 0; i < points.length; i++) d2[i] = Math.min(d2[i], dist2(points[i].lab, points[best].lab));
  }
  const assign = new Int32Array(points.length).fill(-1);
  for (let iter = 0; iter < 40; iter++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(points[i].lab, centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const s = sums[assign[i]];
      s[0] += p.lab[0] * p.w;
      s[1] += p.lab[1] * p.w;
      s[2] += p.lab[2] * p.w;
      s[3] += p.w;
    });
    sums.forEach((s, c) => {
      if (s[3] > 0) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
    if (!changed) break;
  }
  const weights = centers.map(() => 0);
  points.forEach((p, i) => (weights[assign[i]] += p.w));
  return centers.map((lab, i) => ({ lab, w: weights[i] })).filter((c) => c.w > 0);
}

function mergeNear(clusters, threshold) {
  const list = clusters.map((c) => ({ lab: [...c.lab], w: c.w }));
  for (;;) {
    let pair = null;
    let best = threshold;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = Math.sqrt(dist2(list[i].lab, list[j].lab));
        if (d < best) {
          best = d;
          pair = [i, j];
        }
      }
    }
    if (!pair) return list;
    const [a, b] = pair.map((i) => list[i]);
    const w = a.w + b.w;
    list[pair[0]] = { lab: a.lab.map((v, k) => (v * a.w + b.lab[k] * b.w) / w), w };
    list.splice(pair[1], 1);
  }
}

/**
 * Dominant logo colors.
 * @returns {{ background: string|null, transparent: boolean,
 *   swatches: Array<{ hex, oklch: { l, c, h }, share, isNeutral, fromBackground? }> }}
 */
export function extractLogoColors(rgba, width, height, { maxColors = 6 } = {}) {
  const grid = sampleGrid(rgba, width, height, 200000);
  const { background, transparent } = detectBackground(grid);
  const bgLab = background ? hexToOklab(background) : null;
  const { sw, sh, n, alpha } = grid;

  // 0 = background / clear, 1 = anti-aliased alpha edge (ignored), 2 = ink
  const cls = new Uint8Array(n);
  let opaqueCount = 0;
  let bgCount = 0;
  for (let i = 0; i < n; i++) {
    if (alpha[i] < 16) continue;
    if (alpha[i] < 200) {
      cls[i] = 1;
      continue;
    }
    opaqueCount++;
    if (bgLab && dist2(labAt(grid, i), bgLab) < 0.04 ** 2) {
      bgCount++;
      continue;
    }
    cls[i] = 2;
  }

  // Interior ink = all 4 neighbours are ink of (almost) the same color.
  // Anti-aliased rims fail this test, so they never seed a cluster.
  const interior = new Uint8Array(n);
  let inkCount = 0;
  let interiorCount = 0;
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const i = sy * sw + sx;
      if (cls[i] !== 2) continue;
      inkCount++;
      const here = labAt(grid, i);
      let edge = sx === 0 || sy === 0 || sx === sw - 1 || sy === sh - 1;
      for (const j of edge ? [] : [i - 1, i + 1, i - sw, i + sw]) {
        if (cls[j] !== 2 || dist2(here, labAt(grid, j)) > 0.03 ** 2) {
          edge = true;
          break;
        }
      }
      if (!edge) {
        interior[i] = 1;
        interiorCount++;
      }
    }
  }
  // Hairline logos have no interior: fall back to every ink pixel and let
  // the blend filter below discard the rims.
  const useInterior = interiorCount >= Math.max(30, 0.3 * inkCount);

  const exact = new Map(); // key -> { w, lab }
  for (let i = 0; i < n; i++) {
    if (cls[i] !== 2 || (useInterior && !interior[i])) continue;
    const k = grid.key[i];
    const e = exact.get(k);
    if (e) e.w++;
    else exact.set(k, { key: k, w: 1, lab: labAt(grid, i) });
  }
  const swatches = [];
  if (exact.size > 0) {
    // Noisy photos can have 100k+ unique colors: k-means on 5-bit buckets.
    let points = [...exact.values()];
    if (points.length > 6000) {
      const buckets = new Map();
      for (const p of points) {
        const q = ((p.key >> 19) & 31) * 1024 + ((p.key >> 11) & 31) * 32 + ((p.key >> 3) & 31);
        const b = buckets.get(q) || { w: 0, s: [0, 0, 0] };
        b.w += p.w;
        b.s[0] += p.lab[0] * p.w;
        b.s[1] += p.lab[1] * p.w;
        b.s[2] += p.lab[2] * p.w;
        buckets.set(q, b);
      }
      points = [...buckets.values()].map((b) => ({ w: b.w, lab: b.s.map((v) => v / b.w) }));
    }
    let clusters = mergeNear(kmeans(points, Math.min(maxColors + 2, points.length)), 0.045);
    const total0 = clusters.reduce((s, c) => s + c.w, 0);

    // A small cluster lying on the segment between two heavier colors (or a
    // color and the background) is anti-aliasing, not a brand color.
    clusters = clusters.filter((c) => {
      if (c.w / total0 >= 0.25) return true;
      const anchors = clusters.filter((o) => o !== c && o.w > c.w).map((o) => o.lab);
      if (bgLab) anchors.push(bgLab);
      return !isBlendOf(c.lab, anchors, 0.03);
    });
    const centers = clusters.map((c) => c.lab);
    const anchors = bgLab ? [...centers, bgLab] : centers;
    const acc = centers.map(() => ({ w: 0, s: [0, 0, 0], counts: new Map() }));
    for (const p of exact.values()) {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, i) => {
        const d = dist2(p.lab, c);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (Math.sqrt(bestD) > 0.03 && isBlendOf(p.lab, anchors, 0.02)) continue;
      const a = acc[best];
      a.w += p.w;
      a.s[0] += p.lab[0] * p.w;
      a.s[1] += p.lab[1] * p.w;
      a.s[2] += p.lab[2] * p.w;
      a.counts.set(p.key, p.w);
    }
    const total = acc.reduce((s, a) => s + a.w, 0);
    for (const a of acc) {
      if (a.w === 0 || a.w / total < 0.01) continue;
      const hex = representative(a.counts, a.w, a.s.map((v) => v / a.w));
      const oklch = oklchOf(hex);
      swatches.push({ hex, oklch, share: a.w, isNeutral: oklch.c < 0.03 });
    }
    const kept = swatches.reduce((s, sw0) => s + sw0.share, 0);
    for (const s of swatches) s.share = round(s.share / kept, 4);
    // Visual importance: area, boosted by chroma (a small vivid mark reads
    // as strongly as a large dark wordmark).
    const importance = (s) => s.share * (1 + 2 * Math.min(s.oklch.c / 0.15, 1));
    swatches.sort((a, b) => importance(b) - importance(a));
    swatches.splice(maxColors);
  }
  // App-icon style logos: a chromatic background *is* a brand color.
  if (background) {
    const oklch = oklchOf(background);
    if (oklch.c >= 0.05 && !swatches.some((s) => deltaEOK(s.hex, background) < 0.045)) {
      swatches.push({ hex: background, oklch, share: round(bgCount / Math.max(1, opaqueCount), 4), isNeutral: false, fromBackground: true });
    }
  }
  return { background, transparent, swatches };
}

/* ------------------------------------------------------------------ */
/* 2. Logo shape                                                       */
/* ------------------------------------------------------------------ */

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : 0);

/**
 * Geometry of the ink mask and the personality it suggests.
 * `background` is the hex from extractLogoColors (null when transparent).
 */
export function analyzeLogoShape(rgba, width, height, background = null) {
  const grid = sampleGrid(rgba, width, height, 160000);
  const { sw, sh, n, step } = grid;
  const bgLab = background ? hexToOklab(background) : null;
  const mask = new Uint8Array(n);
  let minX = sw;
  let minY = sh;
  let maxX = -1;
  let maxY = -1;
  let ink = 0;
  for (let i = 0; i < n; i++) {
    if (grid.alpha[i] < 128) continue;
    if (bgLab && dist2(labAt(grid, i), bgLab) < 0.08 ** 2) continue;
    mask[i] = 1;
    ink++;
    const x = i % sw;
    const y = (i - x) / sw;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const neutral = { geometric: 0.5, humanist: 0.5, elegant: 0.5, tech: 0.5, playful: 0.5, bold: 0.5, luxury: 0.5, friendly: 0.5 };
  if (ink === 0) {
    return {
      aspect: round(width / Math.max(1, height), 3),
      inkCoverage: 0,
      strokeContrast: 0,
      roundness: 0,
      cornerSharpness: 0,
      complexity: 0,
      isWordmarkLikely: false,
      personality: neutral,
      bbox: { x: 0, y: 0, width, height },
      imageSize: { width, height },
      strokeWidth: { thin: 0, median: 0, thick: 0 },
      components: 0
    };
  }
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const inside = (x, y) => x >= 0 && y >= 0 && x < sw && y < sh;
  const at = (x, y) => (inside(x, y) ? mask[y * sw + x] : 0);

  // Chamfer 3-4 distance transform: distance of each ink pixel to the
  // nearest background. Ridge maxima are half stroke widths.
  const dt = new Float32Array(n);
  const get = (x, y) => (inside(x, y) ? dt[y * sw + x] : 0);
  for (let i = 0; i < n; i++) dt[i] = mask[i] ? 1e9 : 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!mask[i]) continue;
      dt[i] = Math.min(dt[i], get(x - 1, y) + 3, get(x - 1, y - 1) + 4, get(x, y - 1) + 3, get(x + 1, y - 1) + 4);
    }
  }
  for (let y = sh - 1; y >= 0; y--) {
    for (let x = sw - 1; x >= 0; x--) {
      const i = y * sw + x;
      if (!mask[i]) continue;
      dt[i] = Math.min(dt[i], get(x + 1, y) + 3, get(x + 1, y + 1) + 4, get(x, y + 1) + 3, get(x - 1, y + 1) + 4);
    }
  }
  const widths = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!mask[i]) continue;
      const d = dt[i];
      let ridge = true;
      for (let dy = -1; dy <= 1 && ridge; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && get(x + dx, y + dy) > d) ridge = false;
      if (ridge) widths.push(Math.max(1, (2 * d) / 3 - 1));
    }
  }
  widths.sort((a, b) => a - b);
  const thin = percentile(widths, 0.2);
  const median = percentile(widths, 0.5);
  const thick = percentile(widths, 0.8);
  // Thin/thick stroke ratio: ~0 for monoline (geometric sans), high for
  // Didone-like contrast (elegant serif) logos.
  const strokeContrast = clamp01(1 - thin / Math.max(thick, 1e-6));
  const boldness = clamp01((median / bh) * 4);

  // Connected components (8-neighbourhood), ignoring specks.
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let components = 0;
  const minArea = Math.max(2, ink * 0.001);
  for (let i = 0; i < n; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    let top = 0;
    let area = 0;
    stack[top++] = i;
    label[i] = components;
    while (top) {
      const j = stack[--top];
      area++;
      const x = j % sw;
      const y = (j - x) / sw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!inside(x + dx, y + dy)) continue;
          const k = (y + dy) * sw + x + dx;
          if (mask[k] && label[k] < 0) {
            label[k] = components;
            stack[top++] = k;
          }
        }
      }
    }
    // Labels only mark pixels as visited; specks just don't count.
    if (area >= minArea) components++;
  }

  // Boundary curvature by integral invariant: share of a small disk around
  // each contour pixel covered by ink. Straight edge ~0.5, convex 90° corner
  // ~0.25, concave corner ~0.75, a curve deviates gently from 0.5.
  const boundary = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (mask[y * sw + x] && (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1))) boundary.push(x, y);
    }
  }
  const r = Math.max(2, Math.min(Math.round(median * 0.6), Math.round(0.12 * Math.min(bw, bh))));
  const disk = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) disk.push(dx, dy);
  const diskSize = disk.length / 2;
  // Contour pixels lie half a pixel inside the true edge, so a straight edge
  // covers slightly more than half the disk: measure that exact baseline.
  let halfPlane = 0;
  for (let k = 1; k < disk.length; k += 2) if (disk[k] >= 0) halfPlane++;
  const straightBaseline = halfPlane / diskSize;
  const boundaryCount = boundary.length / 2;
  const stride = Math.max(1, Math.floor(boundaryCount / 5000));
  let straight = 0;
  let curved = 0;
  let corner = 0;
  for (let b = 0; b < boundaryCount; b += stride) {
    const x = boundary[b * 2];
    const y = boundary[b * 2 + 1];
    let covered = 0;
    for (let k = 0; k < disk.length; k += 2) covered += at(x + disk[k], y + disk[k + 1]);
    const dev = Math.abs(covered / diskSize - straightBaseline);
    if (dev < 0.035) straight++;
    else if (dev < 0.12) curved++;
    else corner++;
  }
  const sampled = Math.max(1, straight + curved + corner);
  const roundness = clamp01(curved / (curved + corner + 0.35 * straight + 1e-6));
  const cornerSharpness = clamp01((corner / sampled) * 4);

  // Complexity: contour length vs. a circle of equal area, plus parts count.
  const perimeterRatio = boundaryCount / (2 * Math.sqrt(Math.PI * ink));
  const complexity = clamp01(0.5 * clamp01((perimeterRatio - 1) / 4) + 0.5 * clamp01(Math.log2(Math.max(1, components)) / 4));
  const aspect = bw / bh;
  const inkCoverage = ink / (bw * bh);
  // Letters = several separate parts laid out horizontally.
  const isWordmarkLikely = (aspect >= 2.2 && components >= 3) || aspect >= 3.5;

  const sc = strokeContrast;
  const personality = {
    // Monoline, few parts, built from pure arcs or right angles.
    geometric: 0.45 * (1 - sc) + 0.3 * (1 - complexity) + 0.25 * Math.max(roundness, cornerSharpness),
    // Moderate stroke modulation and organic curves.
    humanist: 0.5 * clamp01(1 - Math.abs(sc - 0.35) / 0.35) + 0.25 * roundness + 0.25 * complexity,
    // High thick/thin contrast with light overall weight.
    elegant: 0.55 * sc + 0.45 * (1 - boldness),
    // Sharp corners, straight edges, even strokes.
    tech: 0.45 * cornerSharpness + 0.3 * (1 - roundness) + 0.25 * (1 - sc),
    // Round, heavy, many parts.
    playful: 0.45 * roundness + 0.3 * boldness + 0.25 * complexity,
    bold: 0.7 * boldness + 0.3 * clamp01(inkCoverage * 1.5),
    luxury: 0.45 * sc + 0.35 * (1 - boldness) + 0.2 * (1 - complexity),
    friendly: 0.55 * roundness + 0.25 * (1 - cornerSharpness) + 0.2 * boldness
  };
  for (const k of TAG_KEYS) personality[k] = round(clamp01(personality[k]), 3);

  return {
    aspect: round(aspect, 3),
    inkCoverage: round(inkCoverage, 3),
    strokeContrast: round(strokeContrast, 3),
    roundness: round(roundness, 3),
    cornerSharpness: round(cornerSharpness, 3),
    complexity: round(complexity, 3),
    isWordmarkLikely,
    personality,
    bbox: { x: minX * step, y: minY * step, width: Math.min(width, bw * step), height: Math.min(height, bh * step) },
    imageSize: { width, height },
    strokeWidth: { thin: round(thin * step, 2), median: round(median * step, 2), thick: round(thick * step, 2) },
    components
  };
}

/* ------------------------------------------------------------------ */
/* 3. Palette                                                          */
/* ------------------------------------------------------------------ */

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const RAMP_L = [0.975, 0.95, 0.9, 0.83, 0.74, 0.65, 0.56, 0.48, 0.4, 0.32, 0.25];
const NEUTRAL_L = [0.985, 0.967, 0.925, 0.869, 0.708, 0.556, 0.446, 0.373, 0.269, 0.205, 0.145];
const MIN_GAP = 0.015;

/**
 * 50..950 ramp around `hex`, which stays verbatim at the step whose target
 * lightness is nearest. Neighbour steps absorb the offset with a linear
 * falloff; chroma tapers toward white/black and is clamped to sRGB.
 */
function buildScale(hex) {
  const base = hexToOklch(hex);
  let anchor = 0;
  RAMP_L.forEach((l, i) => {
    if (Math.abs(l - base.l) < Math.abs(RAMP_L[anchor] - base.l)) anchor = i;
  });
  const offset = base.l - RAMP_L[anchor];
  const L = RAMP_L.map((l, i) => l + offset * Math.max(0, 1 - Math.abs(i - anchor) / 4));
  L[anchor] = base.l;
  for (let i = anchor - 1; i >= 0; i--) L[i] = Math.min(0.995, Math.max(L[i], L[i + 1] + MIN_GAP));
  for (let i = anchor + 1; i < L.length; i++) L[i] = Math.max(0, Math.min(L[i], L[i - 1] - MIN_GAP));
  const scale = {};
  SCALE_STEPS.forEach((step, i) => {
    if (i === anchor) {
      scale[step] = hex.toLowerCase();
      return;
    }
    const span = L[i] > base.l ? 1 - base.l : base.l;
    const t = span > 1e-6 ? (L[i] - base.l) / span : 0;
    const c = base.c * Math.max(0.12, 1 - 0.85 * t * t);
    scale[step] = oklchToHex(L[i], c, base.h);
  });
  return { scale, step: SCALE_STEPS[anchor] };
}

function buildNeutralScale(hue, tint) {
  const scale = {};
  SCALE_STEPS.forEach((step, i) => {
    const edge = i === 0 || i === SCALE_STEPS.length - 1 ? 0.6 : 1;
    scale[step] = oklchToHex(NEUTRAL_L[i], tint * edge, hue);
  });
  return scale;
}

/** Moves lightness away from `bg` (hue kept) until contrast >= min. */
export function ensureContrast(hex, bg, min) {
  if (contrastRatio(hex, bg) >= min) return hex;
  const { l, c, h } = hexToOklch(hex);
  const darken = relativeLuminance(bg) > 0.18;
  for (let k = 1; k <= 200; k++) {
    const candidate = oklchToHex(darken ? l - k * 0.005 : l + k * 0.005, c, h);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return darken ? "#000000" : "#ffffff";
}

function bestOn(bg, neutral) {
  const tinted = [neutral[50], neutral[950]].sort((a, b) => contrastRatio(b, bg) - contrastRatio(a, bg))[0];
  if (contrastRatio(tinted, bg) >= 4.5) return tinted;
  return contrastRatio("#ffffff", bg) >= contrastRatio("#000000", bg) ? "#ffffff" : "#000000";
}

function levelOf(ratio) {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA grand texte / UI";
  return "insuffisant";
}

const SEMANTIC_BASE = {
  success: { l: 0.62, c: 0.16, h: 150 },
  warning: { l: 0.78, c: 0.16, h: 80 },
  danger: { l: 0.6, c: 0.21, h: 27 },
  info: { l: 0.6, c: 0.15, h: 245 }
};

// Personality-driven accent for logos without any hue (monochrome).
function fallbackAccentHue(p = {}) {
  const ranked = [
    ["luxury", { l: 0.72, c: 0.12, h: 85 }],
    ["tech", { l: 0.58, c: 0.17, h: 255 }],
    ["playful", { l: 0.66, c: 0.19, h: 30 }],
    ["friendly", { l: 0.62, c: 0.14, h: 150 }],
    ["elegant", { l: 0.5, c: 0.13, h: 15 }]
  ].sort((a, b) => (p[b[0]] || 0) - (p[a[0]] || 0));
  return (p[ranked[0][0]] || 0) > 0 ? ranked[0][1] : { l: 0.58, c: 0.17, h: 255 };
}

/**
 * Full palette from logo swatches.
 * @returns {{ scales: { primary, secondary, accent, neutral }, semantic: { success, warning, danger, info },
 *   roles: Record<string, string>, contrast: Array<{ fg, bg, ratio, level, pair, min }>,
 *   anchors: { primary, secondary, accent }, harmony: string, notes: string[] }}
 */
export function buildBrandPalette(swatches, { personality = {} } = {}) {
  const notes = [];
  const list = swatches || [];
  const chromatic = list.filter((s) => !s.isNeutral);
  const primaryHex = (chromatic[0] || list[0] || { hex: "#334155" }).hex;
  if (!list.length) notes.push("Aucune couleur détectée : ardoise neutre utilisée comme primaire.");
  const P = hexToOklch(primaryHex);
  const isChromatic = P.c >= 0.03;
  const lively = (personality.playful || 0) + (personality.bold || 0) > (personality.elegant || 0) + (personality.luxury || 0);
  const harmony = isChromatic ? (lively ? "complémentaire" : "analogue") : "monochrome + accent";

  const distinct = (hex, others) => others.every((o) => deltaEOK(hex, o) > 0.08);
  let secondary = chromatic.slice(1).find((s) => distinct(s.hex, [primaryHex]))?.hex || null;
  let secondaryDerived = false;
  if (!secondary) {
    secondaryDerived = true;
    if (isChromatic) {
      const h = (P.h + (lively ? 180 : -35) + 360) % 360;
      const l = Math.min(0.75, Math.max(0.35, P.l > 0.5 ? P.l - 0.2 : P.l + 0.2));
      secondary = oklchToHex(l, P.c * 0.85, h);
      notes.push(`Secondaire dérivée par harmonie ${harmony} (teinte ${Math.round(h) % 360}°).`);
    } else {
      secondary = oklchToHex(0.45, 0, 0);
      notes.push("Logo monochrome : secondaire = gris anthracite.");
    }
  }
  let accent = chromatic.find((s) => distinct(s.hex, [primaryHex, secondary]))?.hex || null;
  let accentDerived = false;
  if (!accent) {
    accentDerived = true;
    if (isChromatic) {
      const S = hexToOklch(secondary);
      const opposite = (P.h + 180) % 360;
      const h = S.c >= 0.03 && hueDiff(S.h, opposite) < 40 ? (P.h + 120) % 360 : opposite;
      accent = oklchToHex(0.68, Math.max(0.12, Math.min(0.2, P.c)), h);
      notes.push(`Accent dérivé (teinte ${Math.round(h) % 360}°) pour contraster avec la primaire.`);
    } else {
      const a = fallbackAccentHue(personality);
      accent = oklchToHex(a.l, a.c, a.h);
      notes.push("Logo monochrome : accent choisi selon la personnalité de la marque.");
    }
  }

  const primary = buildScale(primaryHex);
  const second = buildScale(secondary);
  const acc = buildScale(accent);
  const tint = isChromatic ? Math.min(0.014, P.c * 0.18) : 0;
  const neutral = buildNeutralScale(P.h, tint);
  const scales = { primary: primary.scale, secondary: second.scale, accent: acc.scale, neutral };

  const roles = {};
  roles["surface.base"] = neutral[50];
  roles["surface.muted"] = neutral[100];
  roles["surface.raised"] = "#ffffff";
  roles["surface.inverse"] = neutral[900];
  // surface.muted is the darkest light surface: passing on it passes on all.
  const darkestLight = roles["surface.muted"];
  roles["text.primary"] = ensureContrast(neutral[900], darkestLight, 4.5);
  roles["text.secondary"] = ensureContrast(neutral[700], darkestLight, 4.5);
  roles["text.muted"] = ensureContrast(neutral[600], darkestLight, 4.5);
  roles["text.inverse"] = ensureContrast(neutral[50], roles["surface.inverse"], 4.5);
  roles["brand.primary"] = ensureContrast(primaryHex, darkestLight, 3);
  if (roles["brand.primary"] !== primaryHex.toLowerCase()) {
    notes.push(`La primaire du logo ${primaryHex} est trop claire pour l'UI : ${roles["brand.primary"]} (même teinte) est utilisée sur fond clair.`);
  }
  roles["brand.onPrimary"] = bestOn(roles["brand.primary"], neutral);
  roles["brand.secondary"] = ensureContrast(secondary, darkestLight, 3);
  roles["brand.onSecondary"] = bestOn(roles["brand.secondary"], neutral);
  roles.accent = ensureContrast(accent, darkestLight, 3);
  roles["border.default"] = neutral[200];
  roles["border.strong"] = ensureContrast(neutral[500], darkestLight, 3);
  roles["focus.ring"] = ensureContrast(isChromatic ? primary.scale[500] : accent, darkestLight, 3);

  // Semantic colors pulled slightly toward the brand hue so they belong.
  const semantic = {};
  for (const [name, base] of Object.entries(SEMANTIC_BASE)) {
    let h = base.h;
    if (isChromatic) {
      const diff = ((P.h - base.h + 540) % 360) - 180;
      h = (base.h + Math.sign(diff) * Math.min(10, Math.abs(diff) * 0.15) + 360) % 360;
    }
    const raw = oklchToHex(base.l, base.c, h);
    const solid = ensureContrast(raw, roles["surface.base"], 3);
    semantic[name] = {
      base: solid,
      text: ensureContrast(oklchToHex(Math.min(base.l, 0.5), base.c, h), darkestLight, 4.5),
      surface: oklchToHex(0.97, Math.min(base.c * 0.25, 0.04), h),
      on: bestOn(solid, neutral)
    };
  }

  const pairs = [
    ["text.primary", "surface.base", 4.5],
    ["text.primary", "surface.muted", 4.5],
    ["text.primary", "surface.raised", 4.5],
    ["text.secondary", "surface.base", 4.5],
    ["text.secondary", "surface.muted", 4.5],
    ["text.secondary", "surface.raised", 4.5],
    ["text.muted", "surface.base", 4.5],
    ["text.muted", "surface.muted", 4.5],
    ["text.muted", "surface.raised", 4.5],
    ["text.inverse", "surface.inverse", 4.5],
    ["brand.onPrimary", "brand.primary", 4.5],
    ["brand.onSecondary", "brand.secondary", 4.5],
    ["brand.primary", "surface.base", 3],
    ["brand.primary", "surface.raised", 3],
    ["brand.secondary", "surface.base", 3],
    ["accent", "surface.base", 3],
    ["border.strong", "surface.base", 3],
    ["focus.ring", "surface.base", 3],
    ["focus.ring", "surface.raised", 3]
  ];
  const contrast = pairs.map(([fg, bg, min]) => {
    const ratio = round(contrastRatio(roles[fg], roles[bg]), 2);
    return { fg: roles[fg], bg: roles[bg], ratio, level: levelOf(ratio), pair: `${fg} / ${bg}`, min };
  });
  for (const [name, s] of Object.entries(semantic)) {
    for (const [fg, bg, min, pair] of [
      [s.text, roles["surface.base"], 4.5, `${name}.text / surface.base`],
      [s.text, s.surface, 4.5, `${name}.text / ${name}.surface`],
      [s.on, s.base, 4.5, `${name}.on / ${name}.base`],
      [s.base, roles["surface.base"], 3, `${name}.base / surface.base`]
    ]) {
      const ratio = round(contrastRatio(fg, bg), 2);
      contrast.push({ fg, bg, ratio, level: levelOf(ratio), pair, min });
    }
  }

  return {
    scales,
    semantic,
    roles,
    contrast,
    anchors: {
      primary: { hex: primaryHex.toLowerCase(), step: primary.step, derived: false },
      secondary: { hex: secondary.toLowerCase(), step: second.step, derived: secondaryDerived },
      accent: { hex: accent.toLowerCase(), step: acc.step, derived: accentDerived }
    },
    harmony,
    notes
  };
}

/* ------------------------------------------------------------------ */
/* 4. Fonts                                                            */
/* ------------------------------------------------------------------ */

const TRAIT_FR = {
  geometric: "géométrique",
  humanist: "humaniste",
  elegant: "élégant",
  tech: "technique",
  playful: "ludique",
  bold: "affirmé",
  luxury: "luxe",
  friendly: "chaleureux"
};
// Agrees with "une marque …".
const BRAND_TRAIT_FR = {
  geometric: "géométrique",
  humanist: "humaniste",
  elegant: "élégante",
  tech: "technique",
  playful: "ludique",
  bold: "affirmée",
  luxury: "haut de gamme",
  friendly: "chaleureuse"
};
const CATEGORY_FR = { "sans-serif": "sans empattements", serif: "à empattements", display: "display", monospace: "chasse fixe", handwriting: "manuscrite" };

const ARCHETYPE_TRAITS = [
  [/lux|premium|haut de gamme|prestige/, ["luxury", "elegant"]],
  [/tech|saas|logiciel|software|startup|fintech|ia\b|ai\b/, ["tech", "geometric"]],
  [/ludique|fun|playful|enfant|kids|jeu|game/, ["playful", "friendly"]],
  [/artisan|humain|human|bio|nature|organic|santé|health/, ["humanist", "friendly"]],
  [/corporate|sérieux|serious|finance|banque|bank|juridique|legal/, ["geometric", "elegant"]],
  [/audacieux|bold|sport|énergie|energy|street/, ["bold", "playful"]],
  [/minimal/, ["geometric", "elegant"]],
  [/chaleureux|friendly|convivial|restaurant|food|café|cafe/, ["friendly", "humanist"]],
  [/élégant|elegant|mode|fashion|beauté|beauty/, ["elegant", "luxury"]]
];

/** Archetype keywords (fr/en) nudge the matching traits up by 0.3. */
export function applyArchetypes(personality = {}, archetypes = []) {
  const out = {};
  for (const k of TAG_KEYS) out[k] = personality[k] ?? 0.5;
  for (const raw of archetypes || []) {
    const text = String(raw).toLowerCase();
    for (const [re, traits] of ARCHETYPE_TRAITS) if (re.test(text)) for (const t of traits) out[t] = clamp01(out[t] + 0.3);
  }
  for (const k of TAG_KEYS) out[k] = round(out[k], 3);
  return out;
}

function cosine(tags, p) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of TAG_KEYS) {
    const a = tags[k] || 0;
    const b = p[k] || 0;
    dot += a * b;
    na += a * a;
    nb += b * b;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// What an AI vision guess ("Didone serif", "geometric sans"...) implies.
function classificationProfile(text) {
  const t = String(text || "").toLowerCase();
  const tags = {};
  let category = null;
  if (/mono/.test(t)) category = "monospace";
  else if (/sans/.test(t) || /grotes/.test(t)) category = "sans-serif";
  else if (/serif|didone|didot|bodoni|garalde|slab|transitional|old.?style/.test(t)) category = "serif";
  else if (/script|hand|brush/.test(t)) category = "handwriting";
  else if (/display|decorative/.test(t)) category = "display";
  if (/geometric|géométrique/.test(t)) tags.geometric = 1;
  if (/grotes|neo/.test(t)) tags.tech = 1;
  if (/humanist|humaniste/.test(t)) tags.humanist = 1;
  if (/didone|didot|bodoni|high.?contrast|modern serif/.test(t)) Object.assign(tags, { elegant: 1, luxury: 1 });
  if (/slab|black|heavy|condensed/.test(t)) tags.bold = 1;
  if (/round|script|hand|playful/.test(t)) Object.assign(tags, { playful: 1, friendly: 1 });
  return { category, tags };
}

function guessBoosts(fontGuess, catalog) {
  const boosts = new Map();
  if (!fontGuess || (!fontGuess.family && !fontGuess.classification)) return { boosts, matched: null };
  let matched = null;
  const family = String(fontGuess.family || "").trim();
  if (family) {
    const direct = catalog.find((f) => f.family.toLowerCase() === family.toLowerCase()) || findCatalogFont(family);
    if (direct && catalog.some((f) => f.id === direct.id)) {
      boosts.set(direct.id, 0.35);
      matched = { family: direct.family, exact: true };
    } else {
      // Commercial family: reuse Keys_Osi's license map for a free twin.
      const alt = analyzeFontLicensing({ mainFontStyle: { primaryFamily: family } }).commercial[0]?.alternative || "";
      const names = alt.split(/,|\bor\b/).map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        const hit = catalog.find((f) => f.family.toLowerCase() === name.toLowerCase());
        if (hit) {
          boosts.set(hit.id, Math.max(boosts.get(hit.id) || 0, 0.25));
          matched = matched || { family: hit.family, exact: false, original: family };
        }
      }
    }
  }
  const profile = classificationProfile(fontGuess.classification);
  if (profile.category || Object.keys(profile.tags).length) {
    for (const f of catalog) {
      let b = 0;
      if (profile.category && f.category === profile.category) b += 0.12;
      if (Object.keys(profile.tags).length) b += 0.12 * cosine(f.tags, profile.tags);
      if (b) boosts.set(f.id, (boosts.get(f.id) || 0) + b);
    }
  }
  return { boosts, matched };
}

const LANGUAGE_SUBSET = { fr: "latin", en: "latin", es: "latin", de: "latin", it: "latin", pt: "latin", vi: "vietnamese", pl: "latin-ext", cs: "latin-ext", tr: "latin-ext", ro: "latin-ext", hu: "latin-ext" };

const SCALE_BY_TRAIT = {
  luxury: [1.414, "quarte augmentée"],
  bold: [1.5, "quinte juste"],
  elegant: [1.333, "quarte juste"],
  playful: [1.333, "quarte juste"],
  tech: [1.25, "tierce majeure"],
  geometric: [1.25, "tierce majeure"],
  humanist: [1.2, "tierce mineure"],
  friendly: [1.2, "tierce mineure"]
};
const SIZE_TOKENS = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];

export function typeScale(personality = {}) {
  const top = [...TAG_KEYS].sort((a, b) => (personality[b] || 0) - (personality[a] || 0))[0];
  const [ratio, name] = SCALE_BY_TRAIT[top] || [1.25, "tierce majeure"];
  const sizes = SIZE_TOKENS.map((token, i) => {
    // Large ratios shrink small text below legibility: floor xs/sm at 12/14 px.
    const px = round(Math.max(i === 0 ? 12 : i === 1 ? 14 : 0, 16 * ratio ** (i - 2)), 2);
    return { token, px, rem: `${round(px / 16, 4)}rem` };
  });
  return { ratio, name, base: 16, sizes };
}

const nearestWeight = (weights, target) => weights.reduce((best, w) => (Math.abs(w - target) < Math.abs(best - target) ? w : best), weights[0]);
const topTraits = (tags, n = 2) => [...TAG_KEYS].sort((a, b) => (tags[b] || 0) - (tags[a] || 0)).slice(0, n);

function pairHarmony(d, b) {
  if (d.id === b.id) return 0.6;
  const similarity = cosine(d.tags, b.tags);
  if (d.category === "serif" && b.category === "sans-serif") return 0.9;
  if (d.category === "display" && b.category !== "display") return 0.85;
  if (d.category === "sans-serif" && b.category === "serif") return 0.7;
  if (d.category === b.category) return 0.55 - 0.35 * similarity;
  return 0.6;
}

/**
 * Three diverse display/body/mono pairings ranked for the personality.
 * @returns {Array<{ display, body, mono, weights: { display: number[], body: number[], mono: number[] }, rationale: string, score: number, scale }>}
 */
export function recommendFonts({ personality = {}, archetypes = [], language = "fr", fontGuess = null, catalog = CURATED_FONTS } = {}) {
  const p = applyArchetypes(personality, archetypes);
  const subset = LANGUAGE_SUBSET[language] || "latin";
  const pool = (catalog && catalog.length ? catalog : CURATED_FONTS).filter((f) => (f.subsets || []).includes(subset));
  const { boosts, matched } = guessBoosts(fontGuess, pool);
  const score = (f) => cosine(f.tags, p) + (boosts.get(f.id) || 0);

  const displayTarget = p.bold > 0.6 ? 800 : p.elegant > 0.6 || p.luxury > 0.6 ? 500 : 700;
  // A heading face that cannot reach the weight the brand needs is a poor fit.
  const weightFit = (f) => 0.15 * Math.min(1, Math.abs(nearestWeight(f.weights, displayTarget) - displayTarget) / 400);
  const rankedDisplays = pool
    .filter((f) => f.roles.includes("display"))
    .map((f) => ({ f, s: score(f) - weightFit(f) }))
    .sort((a, b) => b.s - a.s);
  // Shortlist = top 16 plus the best two of every category, so the third
  // proposal can always switch category.
  const displays = rankedDisplays.filter((d, i) => i < 16 || rankedDisplays.filter((o) => o.f.category === d.f.category).indexOf(d) < 2);
  const bodies = pool
    .filter((f) => f.roles.includes("body") && f.weights.includes(400) && f.weights.length >= 3)
    // Body text must stay readable: humanist forms help, novelty hurts.
    .map((f) => ({ f, s: cosine(f.tags, p) + 0.1 * (f.tags.humanist || 0) - 0.15 * Math.max(0, (f.tags.playful || 0) - 0.6) + 0.5 * (boosts.get(f.id) || 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 16);
  const monos = pool
    .filter((f) => f.roles.includes("mono"))
    .map((f) => ({ f, s: cosine(f.tags, p) }))
    .sort((a, b) => b.s - a.s);

  const pairs = [];
  for (const d of displays) for (const b of bodies) pairs.push({ d: d.f, b: b.f, s: 0.55 * d.s + 0.3 * b.s + 0.15 * pairHarmony(d.f, b.f) });
  pairs.sort((a, b) => b.s - a.s || a.d.id.localeCompare(b.d.id));

  const chosen = [];
  for (const pair of pairs) {
    if (chosen.length === 3) break;
    if (chosen.some((c) => c.d.id === pair.d.id || c.b.id === pair.b.id)) continue;
    // Keep at least two display categories across the three proposals.
    if (chosen.length === 2 && chosen.every((c) => c.d.category === pair.d.category) && pairs.some((o) => o.d.category !== pair.d.category)) continue;
    chosen.push(pair);
  }

  const scale = typeScale(p);
  return chosen.map(({ d, b, s }, index) => {
    const mono = monos[index % Math.max(1, Math.min(2, monos.length))]?.f || null;
    const weights = {
      display: [nearestWeight(d.weights, displayTarget)],
      body: [...new Set([400, nearestWeight(b.weights, 600), nearestWeight(b.weights, 700)])].sort((x, y) => x - y),
      mono: mono ? [...new Set([400, nearestWeight(mono.weights, 600)])].sort((x, y) => x - y) : []
    };
    const why = topTraits(p).map((t) => BRAND_TRAIT_FR[t]).join(" et ");
    const parts = [
      `Titres en ${d.family} (${CATEGORY_FR[d.category] || d.category}, ${topTraits(d.tags).map((t) => TRAIT_FR[t]).join(", ")}) pour traduire une marque ${why}.`,
      `Texte courant en ${b.family}, lisible à 16 px, ${b.weights.length} graisses${b.variable ? " en police variable" : ""}.`,
      d.id === b.id ? "Une seule famille : cohérence maximale et chargement léger." : `Le contraste ${CATEGORY_FR[d.category] || d.category} / ${CATEGORY_FR[b.category] || b.category} hiérarchise clairement titres et texte.`,
      mono ? `Code et chiffres techniques en ${mono.family}.` : "",
      matched && (matched.family === d.family || matched.family === b.family)
        ? matched.exact
          ? `Reprend la police détectée dans le logo (${matched.family}).`
          : `Alternative libre la plus proche de ${matched.original} détectée dans le logo.`
        : "",
      language === "fr" ? "Jeu latin complet pour le français (é, è, ç, œ, « »)." : ""
    ].filter(Boolean);
    return { display: d, body: b, mono, weights, rationale: parts.join(" "), score: round(s, 4), scale };
  });
}

/* ------------------------------------------------------------------ */
/* Kit assembly                                                        */
/* ------------------------------------------------------------------ */

// Hue/chroma cues: warm vivid = playful/friendly, blue = tech, dark
// achromatic = luxury/elegant, green = humanist/friendly, violet = luxury.
function colorPersonality(swatches) {
  const p = Object.fromEntries(TAG_KEYS.map((k) => [k, 0.4]));
  const main = (swatches || []).find((s) => !s.isNeutral) || (swatches || [])[0];
  if (!main) return p;
  const { l, c, h } = main.oklch;
  if (c < 0.03) {
    p.luxury = l < 0.35 ? 0.75 : 0.5;
    p.elegant = 0.7;
    p.playful = 0.2;
  } else if (h >= 20 && h < 100 && c > 0.12) {
    p.playful = 0.75;
    p.friendly = 0.75;
    p.bold = 0.6;
  } else if (h >= 200 && h < 290) {
    p.tech = 0.75;
    p.geometric = 0.6;
  } else if (h >= 120 && h < 200) {
    p.friendly = 0.65;
    p.humanist = 0.65;
  } else if (h >= 290 || h < 20) {
    p.luxury = 0.6;
    p.elegant = 0.55;
    p.bold = 0.5;
  }
  if ((swatches || []).filter((s) => !s.isNeutral).length >= 3) p.playful = clamp01(p.playful + 0.2);
  return p;
}

/**
 * Chains extractLogoColors -> analyzeLogoShape -> buildBrandPalette ->
 * recommendFonts. Fonts files stay empty until resolveKitFonts().
 */
export function createBrandKit({ name = "Marque", rgba, width, height, archetypes = [], fontGuess = null, catalog = CURATED_FONTS, language = "fr" } = {}) {
  const colors = extractLogoColors(rgba, width, height);
  const shape = analyzeLogoShape(rgba, width, height, colors.background);
  const fromColors = colorPersonality(colors.swatches);
  const blended = {};
  for (const k of TAG_KEYS) blended[k] = round(0.6 * shape.personality[k] + 0.4 * fromColors[k], 3);
  const personality = applyArchetypes(blended, archetypes);
  const palette = buildBrandPalette(colors.swatches, { personality });
  const pairings = recommendFonts({ personality: blended, archetypes, language, fontGuess, catalog });
  return {
    name,
    colors,
    shape,
    personality,
    archetypes: [...archetypes],
    palette,
    fonts: { chosen: pairings[0] || null, alternatives: pairings.slice(1) },
    files: { display: [], body: [], mono: [] }
  };
}

/** Resolves woff2 files of the chosen pairing (network via fetchImpl). Returns a new kit. */
export async function resolveKitFonts(kit, { fetchImpl, subset = "latin" } = {}) {
  const chosen = kit.fonts?.chosen;
  if (!chosen) return kit;
  const files = { display: [], body: [], mono: [] };
  for (const role of ["display", "body", "mono"]) {
    const font = chosen[role];
    if (!font) continue;
    files[role] = await resolveFontFiles({ id: font.id, family: font.family, weights: chosen.weights[role], styles: ["normal"], subset, fetchImpl });
  }
  // A single superfamily for display and body: ship each file once.
  if (chosen.display.id === chosen.body.id) {
    const seen = new Set(files.body.map((f) => f.fileName));
    files.display = files.display.filter((f) => !seen.has(f.fileName));
  }
  return { ...kit, files };
}

/* ------------------------------------------------------------------ */
/* 5. Prompt block                                                     */
/* ------------------------------------------------------------------ */

const FALLBACK_STACK = {
  "sans-serif": ["ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
  serif: ["ui-serif", "Georgia", '"Times New Roman"', "serif"],
  display: ["system-ui", "sans-serif"],
  handwriting: ["cursive"],
  monospace: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"]
};

export function fontStack(font) {
  if (!font) return "";
  return [`"${font.family}"`, ...(FALLBACK_STACK[font.category] || FALLBACK_STACK["sans-serif"])].join(", ");
}

const cssVar = (role) => `--${role.replace(/\./g, "-").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;

function pairingFonts(pairing) {
  const out = [];
  for (const role of ["display", "body", "mono"]) {
    const font = pairing?.[role];
    if (!font) continue;
    const existing = out.find((o) => o.font.id === font.id);
    if (existing) existing.weights = [...new Set([...existing.weights, ...pairing.weights[role]])].sort((a, b) => a - b);
    else out.push({ font, weights: [...pairing.weights[role]] });
  }
  return out;
}

function googleLinkHref(pairing) {
  const families = pairingFonts(pairing).map(({ font, weights }) => googleCss2Url(font.family, weights, ["normal"]).split("?")[1].replace(/&display=swap$/, ""));
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

const ROLE_USE = {
  "surface.base": "page background",
  "surface.muted": "alternate sections, input fills",
  "surface.raised": "cards, popovers, modals",
  "surface.inverse": "footer / inverted bands",
  "text.primary": "headings and body text",
  "text.secondary": "supporting text",
  "text.muted": "captions, placeholders, meta",
  "text.inverse": "text on surface.inverse",
  "brand.primary": "primary CTA fill, key links, logo color",
  "brand.onPrimary": "text/icons on brand.primary",
  "brand.secondary": "secondary buttons, highlights",
  "brand.onSecondary": "text/icons on brand.secondary",
  accent: "badges, small highlights, data accents (≤10% of the screen)",
  "border.default": "dividers, card outlines (decorative)",
  "border.strong": "input and control borders",
  "focus.ring": "keyboard focus outline"
};

/** Markdown block for the PROMPT_PRO master prompt (written for an AI coding agent). */
export function brandKitPromptBlock(kit) {
  const { palette, fonts } = kit;
  const chosen = fonts?.chosen;
  const lines = [];
  lines.push(`## Brand kit — ${kit.name} (from the user's logo)`);
  lines.push("");
  lines.push("This brand kit overrides any color or font taken from the reference site. Use these exact values; do not invent extra brand colors, do not substitute fonts.");
  lines.push("");
  lines.push("### Color roles (light theme) — expose each as a CSS custom property");
  lines.push("| Role | CSS variable | Hex | OKLCH | Use |");
  lines.push("|---|---|---|---|---|");
  for (const [role, hex] of Object.entries(palette.roles)) {
    lines.push(`| \`${role}\` | \`${cssVar(role)}\` | \`${hex}\` | \`${formatOklch(hexToOklch(hex))}\` | ${ROLE_USE[role] || ""} |`);
  }
  lines.push("");
  lines.push("### Scales (50 → 950, lightest → darkest)");
  for (const [name, scale] of Object.entries(palette.scales)) {
    const anchor = palette.anchors[name];
    const tail = anchor ? ` — logo color \`${anchor.hex}\` sits at step ${anchor.step}${anchor.derived ? " (derived harmonically)" : ""}` : "";
    lines.push(`- **${name}**: ${SCALE_STEPS.map((s) => `${s} \`${scale[s]}\``).join(" · ")}${tail}`);
  }
  lines.push("");
  lines.push("### Semantic colors");
  for (const [name, s] of Object.entries(palette.semantic)) {
    lines.push(`- **${name}**: solid \`${s.base}\` with text \`${s.on}\` on it · text-on-light \`${s.text}\` · tinted surface \`${s.surface}\``);
  }
  lines.push("");
  lines.push("### Contrast guarantees (WCAG 2.x, measured)");
  lines.push("- Every text/background role pair is ≥ 4.5:1; every UI pair (brand fills, accent, strong border, focus ring) is ≥ 3:1. Keep these pairings; any new pairing must be checked to the same thresholds.");
  for (const row of palette.contrast) lines.push(`- \`${row.pair}\`: ${row.ratio}:1 (${row.level}, min ${row.min})`);
  lines.push("");
  if (chosen) {
    lines.push("### Typography");
    for (const role of ["display", "body", "mono"]) {
      const font = chosen[role];
      if (!font) continue;
      const label = role === "display" ? "Headings / display" : role === "body" ? "Body / UI" : "Code / tabular";
      lines.push(`- ${label}: **${font.family}** — weights ${chosen.weights[role].join(", ")} — \`font-family: ${fontStack(font)};\``);
    }
    lines.push("- Load the fonts (pick ONE method):");
    lines.push("  1. Self-hosted (preferred): include `brand-tokens.css`; its `@font-face` rules point to `fonts/*.woff2` with `font-display: swap`.");
    const npm = pairingFonts(chosen);
    lines.push(`  2. npm: \`npm install ${npm.map(({ font }) => `@fontsource/${font.id}`).join(" ")}\` then ${npm.flatMap(({ font, weights }) => weights.map((w) => `\`import "@fontsource/${font.id}/${w}.css";\``)).join(" ")}`);
    lines.push(`  3. CDN: \`<link rel="stylesheet" href="${googleLinkHref(chosen)}">\``);
    const sc = chosen.scale;
    lines.push(`- Type scale: ratio ${sc.ratio} (${sc.name}), base ${sc.base}px — ${sc.sizes.map((s) => `${s.token} ${s.px}px/${s.rem}`).join(" · ")}`);
    lines.push("- Line-height: 1.5 for body, 1.1–1.2 for display sizes ≥ 2xl; letter-spacing −0.01em to −0.02em on display sizes ≥ 3xl.");
    lines.push("");
  }
  lines.push("### Usage rules");
  lines.push("- Primary call-to-action: background `brand.primary`, text `brand.onPrimary`; hover = one step darker in the primary scale; never place brand.primary text on brand.secondary.");
  lines.push("- Body text always `text.primary` on `surface.*`; `text.muted` only for secondary information, never for actionable controls.");
  lines.push("- Accent covers at most ~10% of any screen; never use it for long text.");
  lines.push("- Focus: `outline: 2px solid var(--focus-ring); outline-offset: 2px` on every interactive element.");
  lines.push("- Semantic colors only for status (success/warning/danger/info), never as decoration.");
  lines.push("- Do not recolor, stretch, rotate or add effects to the logo; keep the clear space defined in BRAND.md.");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* 6. Files                                                            */
/* ------------------------------------------------------------------ */

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rgbText = (hex) => {
  const c = hexToRgb(hex);
  return `rgb(${c.r} ${c.g} ${c.b})`;
};

function allFontFiles(kit) {
  const seen = new Set();
  const out = [];
  for (const role of ["display", "body", "mono"]) {
    for (const file of kit.files?.[role] || []) {
      if (seen.has(file.fileName)) continue;
      seen.add(file.fileName);
      out.push(file);
    }
  }
  return out;
}

function brandCss(kit) {
  const { palette, fonts } = kit;
  const chosen = fonts?.chosen;
  const lines = [`/* Keys_Osi brand tokens — ${kit.name} */`];
  const faces = fontFaceCss(allFontFiles(kit), { localDir: "fonts" });
  if (faces) lines.push(faces, "");
  lines.push(":root {");
  for (const [name, scale] of Object.entries(palette.scales)) for (const s of SCALE_STEPS) lines.push(`  --brand-${name}-${s}: ${scale[s]};`);
  for (const [name, s] of Object.entries(palette.semantic)) {
    lines.push(`  --${name}: ${s.base};`, `  --${name}-on: ${s.on};`, `  --${name}-text: ${s.text};`, `  --${name}-surface: ${s.surface};`);
  }
  for (const [role, hex] of Object.entries(palette.roles)) lines.push(`  ${cssVar(role)}: ${hex};`);
  if (chosen) {
    lines.push(`  --font-display: ${fontStack(chosen.display)};`, `  --font-body: ${fontStack(chosen.body)};`);
    if (chosen.mono) lines.push(`  --font-mono: ${fontStack(chosen.mono)};`);
    for (const s of chosen.scale.sizes) lines.push(`  --text-${s.token}: ${s.rem};`);
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function tailwindBrand(kit) {
  const { palette, fonts } = kit;
  const chosen = fonts?.chosen;
  const colors = { ...palette.scales };
  for (const [name, s] of Object.entries(palette.semantic)) colors[name] = { DEFAULT: s.base, on: s.on, text: s.text, surface: s.surface };
  const roleTree = {};
  for (const [role, hex] of Object.entries(palette.roles)) {
    const [group, key] = role.includes(".") ? role.split(".") : [role, "DEFAULT"];
    roleTree[group] = roleTree[group] || {};
    roleTree[group][key] = hex;
  }
  Object.assign(colors, { surface: roleTree.surface, text: roleTree.text, border: roleTree.border, focus: roleTree.focus });
  colors.brand = roleTree.brand;
  colors.accent = { ...palette.scales.accent, DEFAULT: palette.roles.accent };
  const extend = { colors };
  if (chosen) {
    const stack = (font) => fontStack(font).split(", ").map((s) => s.replace(/"/g, ""));
    extend.fontFamily = { display: stack(chosen.display), sans: stack(chosen.body), ...(chosen.mono ? { mono: stack(chosen.mono) } : {}) };
    extend.fontSize = Object.fromEntries(chosen.scale.sizes.map((s) => [s.token, s.rem]));
  }
  return `/** Keys_Osi brand theme — ${kit.name}. Merge into tailwind.config.js: presets: [require("./tailwind.brand.js")] */\n/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  theme: {\n    extend: ${JSON.stringify(extend, null, 2).replace(/\n/g, "\n    ")}\n  }\n};\n`;
}

function w3cTokens(kit) {
  const { palette, fonts } = kit;
  const chosen = fonts?.chosen;
  const color = { scale: {}, role: {}, semantic: {} };
  for (const [name, scale] of Object.entries(palette.scales)) {
    color.scale[name] = Object.fromEntries(SCALE_STEPS.map((s) => [String(s), { $type: "color", $value: scale[s] }]));
  }
  for (const [role, hex] of Object.entries(palette.roles)) {
    const [group, key] = role.includes(".") ? role.split(".") : [role, "default"];
    color.role[group] = color.role[group] || {};
    color.role[group][key] = { $type: "color", $value: hex };
  }
  for (const [name, s] of Object.entries(palette.semantic)) {
    color.semantic[name] = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { $type: "color", $value: v }]));
  }
  const doc = {
    $schema: "https://design-tokens.github.io/community-group/format/",
    $description: `Keys_Osi brand kit — ${kit.name}`,
    color
  };
  if (chosen) {
    const family = {};
    const weight = {};
    for (const role of ["display", "body", "mono"]) {
      const font = chosen[role];
      if (!font) continue;
      family[role] = { $type: "fontFamily", $value: fontStack(font).split(", ").map((s) => s.replace(/"/g, "")) };
      weight[role] = Object.fromEntries(chosen.weights[role].map((w) => [String(w), { $type: "fontWeight", $value: w }]));
    }
    doc.font = {
      family,
      weight,
      size: Object.fromEntries(chosen.scale.sizes.map((s) => [s.token, { $type: "dimension", $value: s.rem }]))
    };
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function paletteSvg(kit) {
  const { palette } = kit;
  const cell = 72;
  const labelW = 110;
  const rows = [
    ...Object.entries(palette.scales).map(([name, scale]) => [name, SCALE_STEPS.map((s) => [String(s), scale[s]])]),
    ["semantic", Object.entries(palette.semantic).map(([name, s]) => [name, s.base])]
  ];
  const width = labelW + SCALE_STEPS.length * cell + 16;
  const height = rows.length * (cell + 28) + 16;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, sans-serif">`,
    `<title>Palette ${escapeHtml(kit.name)} — Keys_Osi</title>`,
    `<rect width="100%" height="100%" fill="${palette.roles["surface.base"]}"/>`
  ];
  rows.forEach(([name, cells], r) => {
    const y = 16 + r * (cell + 28);
    out.push(`<text x="12" y="${y + cell / 2 + 4}" font-size="13" font-weight="600" fill="${palette.roles["text.primary"]}">${escapeHtml(name)}</text>`);
    cells.forEach(([label, hex], c) => {
      const x = labelW + c * cell;
      const ink = contrastRatio("#ffffff", hex) >= contrastRatio("#000000", hex) ? "#ffffff" : "#000000";
      out.push(`<rect x="${x}" y="${y}" width="${cell - 4}" height="${cell}" rx="6" fill="${hex}"/>`);
      out.push(`<text x="${x + 6}" y="${y + 16}" font-size="10" fill="${ink}">${escapeHtml(label)}</text>`);
      out.push(`<text x="${x + 6}" y="${y + cell - 8}" font-size="10" fill="${ink}">${hex}</text>`);
    });
  });
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}

function clearSpace(kit) {
  const bbox = kit.shape?.bbox;
  if (!bbox) return null;
  const unit = Math.max(1, Math.round(Math.min(bbox.width, bbox.height) * 0.25));
  return { unit, bbox };
}

function brandMd(kit) {
  const { palette, fonts, colors } = kit;
  const chosen = fonts?.chosen;
  const space = clearSpace(kit);
  const L = [];
  L.push(`# Charte de marque — ${kit.name}`);
  L.push("");
  L.push("Générée par Keys_Osi à partir du logo. Les valeurs ci-dessous font foi pour tout support (web, print, présentation).");
  L.push("");
  L.push("## 1. Logo");
  L.push("");
  if (space) {
    L.push(`- Boîte englobante mesurée : ${space.bbox.width} × ${space.bbox.height} px (fichier source ${kit.shape.imageSize.width} × ${kit.shape.imageSize.height} px), ratio ${kit.shape.aspect}.`);
    L.push(`- Zone de protection : **x = 25 % de la plus petite dimension du logo** (${space.unit} px à la taille source). Aucun texte, bord ou image dans cette marge, sur les quatre côtés.`);
  }
  L.push("- Taille minimale : 24 px de haut à l'écran, 10 mm à l'impression.");
  L.push(`- Fond d'origine : ${colors?.transparent ? "transparent" : colors?.background || "non uniforme"}. Sur fond foncé, utiliser la version claire (\`text.inverse\`) ; sur photo, poser le logo sur un aplat \`surface.raised\`.`);
  L.push("- Couleurs du logo : " + (colors?.swatches || []).map((s) => `\`${s.hex}\` (${Math.round(s.share * 100)} %)`).join(", ") + ".");
  L.push("");
  L.push("## 2. Couleurs");
  L.push("");
  L.push(`Harmonie : ${palette.harmony}.${palette.notes.length ? ` ${palette.notes.join(" ")}` : ""}`);
  L.push("");
  L.push("| Rôle | Hex | OKLCH | RGB |");
  L.push("|---|---|---|---|");
  for (const [role, hex] of Object.entries(palette.roles)) L.push(`| \`${role}\` | \`${hex}\` | \`${formatOklch(hexToOklch(hex))}\` | \`${rgbText(hex)}\` |`);
  L.push("");
  L.push("### Nuanciers");
  L.push("");
  L.push(`| Échelle | ${SCALE_STEPS.join(" | ")} |`);
  L.push(`|---|${SCALE_STEPS.map(() => "---").join("|")}|`);
  for (const [name, scale] of Object.entries(palette.scales)) L.push(`| ${name} | ${SCALE_STEPS.map((s) => `\`${scale[s]}\``).join(" | ")} |`);
  L.push("");
  for (const [name, a] of Object.entries(palette.anchors)) L.push(`- ${name} : couleur d'origine \`${a.hex}\` au pas ${a.step}${a.derived ? " (dérivée)" : " (issue du logo)"}.`);
  L.push("");
  L.push("### Couleurs fonctionnelles");
  L.push("");
  for (const [name, s] of Object.entries(palette.semantic)) L.push(`- ${name} : aplat \`${s.base}\` (texte \`${s.on}\`), texte \`${s.text}\`, fond \`${s.surface}\`.`);
  L.push("");
  L.push("### Contrastes (WCAG)");
  L.push("");
  L.push("| Paire | Avant-plan | Fond | Ratio | Niveau | Minimum |");
  L.push("|---|---|---|---|---|---|");
  for (const row of palette.contrast) L.push(`| ${row.pair} | \`${row.fg}\` | \`${row.bg}\` | ${row.ratio}:1 | ${row.level} | ${row.min}:1 |`);
  L.push("");
  if (chosen) {
    L.push("## 3. Typographie");
    L.push("");
    for (const role of ["display", "body", "mono"]) {
      const font = chosen[role];
      if (!font) continue;
      const label = role === "display" ? "Titres" : role === "body" ? "Texte" : "Code";
      L.push(`- **${label}** : ${font.family} — graisses ${chosen.weights[role].join(", ")} — \`font-family: ${fontStack(font)};\``);
    }
    L.push("");
    L.push(`Pourquoi : ${chosen.rationale}`);
    L.push("");
    L.push(`Échelle typographique : ratio ${chosen.scale.ratio} (${chosen.scale.name}), base ${chosen.scale.base} px.`);
    L.push("");
    L.push("| Jeton | px | rem |");
    L.push("|---|---|---|");
    for (const s of chosen.scale.sizes) L.push(`| ${s.token} | ${s.px} | ${s.rem} |`);
    L.push("");
    if (fonts.alternatives?.length) {
      L.push("Alternatives :");
      for (const alt of fonts.alternatives) L.push(`- ${alt.display.family} + ${alt.body.family} — ${alt.rationale}`);
      L.push("");
    }
    L.push("Polices sous licence libre (SIL Open Font License), fichiers woff2 fournis dans `fonts/`.");
    L.push("");
  }
  L.push("## 4. À faire / À éviter");
  L.push("");
  L.push("À faire :");
  L.push(`- Boutons principaux en \`${palette.roles["brand.primary"]}\` avec texte \`${palette.roles["brand.onPrimary"]}\`.`);
  L.push(`- Texte courant en \`${palette.roles["text.primary"]}\` sur \`${palette.roles["surface.base"]}\` ou \`${palette.roles["surface.raised"]}\`.`);
  L.push("- Respecter la zone de protection et la taille minimale du logo.");
  L.push("- Utiliser l'accent avec parcimonie (moins de 10 % de la surface).");
  L.push("");
  L.push("À éviter :");
  L.push("- Déformer, recolorer, ombrer ou faire pivoter le logo.");
  L.push("- Créer de nouvelles couleurs hors nuanciers, ou du texte gris clair sous 4,5:1.");
  L.push("- Mélanger d'autres polices que celles de la charte.");
  L.push("- Utiliser les couleurs fonctionnelles (succès, erreur…) comme décoration.");
  return `${L.join("\n")}\n`;
}

function charteHtml(kit, { logoDataUrl, logoSvg }) {
  const { palette, fonts } = kit;
  const chosen = fonts?.chosen;
  const r = palette.roles;
  const faces = fontFaceCss(allFontFiles(kit), { localDir: "fonts" });
  const logo = logoSvg ? logoSvg : logoDataUrl ? `<img src="${escapeHtml(logoDataUrl)}" alt="Logo ${escapeHtml(kit.name)}">` : "";
  const swatchRow = (name, scale) =>
    `<div class="row"><h3>${escapeHtml(name)}</h3><div class="sw">${SCALE_STEPS.map((s) => {
      const ink = contrastRatio("#ffffff", scale[s]) >= contrastRatio("#000000", scale[s]) ? "#ffffff" : "#000000";
      return `<div style="background:${scale[s]};color:${ink}"><b>${s}</b><span>${scale[s]}</span></div>`;
    }).join("")}</div></div>`;
  const roleCards = Object.entries(r)
    .map(([role, hex]) => `<li><i style="background:${hex}"></i><code>${role}</code><span>${hex}</span></li>`)
    .join("");
  const sizes = chosen ? chosen.scale.sizes.slice().reverse().map((s) => `<p style="font-size:${s.rem};font-family:var(--font-display);margin:.2em 0">${s.token} — Portez ce vieux whisky</p>`).join("") : "";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Charte ${escapeHtml(kit.name)}</title>
<style>
${faces}
:root {
${Object.entries(r).map(([role, hex]) => `  ${cssVar(role)}: ${hex};`).join("\n")}
  --font-display: ${chosen ? fontStack(chosen.display) : "system-ui, sans-serif"};
  --font-body: ${chosen ? fontStack(chosen.body) : "system-ui, sans-serif"};
  --font-mono: ${chosen?.mono ? fontStack(chosen.mono) : "ui-monospace, monospace"};
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface-base); color: var(--text-primary); font: 16px/1.5 var(--font-body); }
main { max-width: 1080px; margin: 0 auto; padding: 48px 16px; }
h1, h2, h3 { font-family: var(--font-display); line-height: 1.15; }
h2 { margin-top: 56px; border-bottom: 1px solid var(--border-default); padding-bottom: 8px; }
.logo { background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 12px; padding: 48px; display: grid; place-items: center; }
.logo img, .logo svg { max-width: 100%; max-height: 160px; }
.row h3 { font-size: 14px; margin: 16px 0 6px; color: var(--text-secondary); }
.sw { display: grid; grid-template-columns: repeat(11, minmax(0, 1fr)); gap: 4px; }
.sw div { border-radius: 6px; padding: 8px 6px; min-height: 64px; display: flex; flex-direction: column; justify-content: space-between; font: 11px/1.2 var(--font-mono); }
.roles { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.roles li { display: flex; gap: 8px; align-items: center; background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 8px; padding: 8px; font-size: 13px; }
.roles i { width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border-default); flex: none; }
.roles span { margin-left: auto; font-family: var(--font-mono); color: var(--text-muted); }
.btn { display: inline-block; padding: 12px 20px; border-radius: 8px; font-weight: 600; margin-right: 8px; border: 0; font-family: var(--font-body); font-size: 15px; }
.btn.primary { background: var(--brand-primary); color: var(--brand-on-primary); }
.btn.secondary { background: var(--brand-secondary); color: var(--brand-on-secondary); }
.btn.ghost { background: transparent; color: var(--text-primary); border: 1px solid var(--border-strong); }
.btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.inverse { background: var(--surface-inverse); color: var(--text-inverse); padding: 24px; border-radius: 12px; margin-top: 16px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border-default); }
@media (max-width: 640px) { .sw { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
</style>
</head>
<body>
<main>
<h1>Charte de marque — ${escapeHtml(kit.name)}</h1>
<p style="color:var(--text-secondary)">Aperçu visuel généré par Keys_Osi. Valeurs détaillées : BRAND.md.</p>
${logo ? `<div class="logo">${logo}</div>` : ""}
<h2>Couleurs</h2>
${Object.entries(palette.scales).map(([name, scale]) => swatchRow(name, scale)).join("\n")}
<h3>Rôles</h3>
<ul class="roles">${roleCards}</ul>
<h2>Typographie</h2>
${chosen ? `<p><b>${escapeHtml(chosen.display.family)}</b> (titres) · <b>${escapeHtml(chosen.body.family)}</b> (texte)${chosen.mono ? ` · <b>${escapeHtml(chosen.mono.family)}</b> (code)` : ""}</p>
${sizes}
<p style="max-width:65ch">Texte courant : « Le cœur déçu mais l'âme plutôt naïve, Louÿs rêva de crapaüter en canoë au delà des îles, près du mälström où brûlent les novæ. »</p>
<p style="font-family:var(--font-mono)">const marque = "${escapeHtml(kit.name)}"; // 0123456789</p>
<p style="color:var(--text-secondary)">${escapeHtml(chosen.rationale)}</p>` : "<p>Aucune police choisie.</p>"}
<h2>Composants</h2>
<button class="btn primary">Action principale</button><button class="btn secondary">Secondaire</button><button class="btn ghost">Discret</button>
<div class="inverse">Bandeau inversé — texte ${escapeHtml(r["text.inverse"])} sur ${escapeHtml(r["surface.inverse"])}</div>
<h2>Contrastes</h2>
<table><tr><th>Paire</th><th>Ratio</th><th>Niveau</th></tr>
${palette.contrast.map((row) => `<tr><td>${escapeHtml(row.pair)}</td><td>${row.ratio}:1</td><td>${escapeHtml(row.level)}</td></tr>`).join("\n")}
</table>
</main>
</body>
</html>
`;
}

/**
 * Every file of the downloadable kit. Text files carry `content`; remote or
 * data-URL assets carry `url` (the zip step fetches them).
 */
export function buildBrandKitFiles(kit, { logoDataUrl = null, logoSvg = null } = {}) {
  const files = [
    { path: "BRAND.md", content: brandMd(kit) },
    { path: "brand-tokens.css", content: brandCss(kit) },
    { path: "tailwind.brand.js", content: tailwindBrand(kit) },
    { path: "brand.tokens.json", content: w3cTokens(kit) },
    { path: "charte.html", content: charteHtml(kit, { logoDataUrl, logoSvg }) },
    { path: "palette.svg", content: paletteSvg(kit) }
  ];
  for (const file of allFontFiles(kit)) files.push({ path: `fonts/${file.fileName}`, url: file.url });
  if (logoSvg) files.push({ path: "logo/logo.svg", content: logoSvg });
  if (logoDataUrl) {
    const ext = (String(logoDataUrl).match(/^data:image\/([a-z0-9+.-]+)/i)?.[1] || "png").replace("svg+xml", "svg").replace("jpeg", "jpg");
    files.push({ path: `logo/logo.${ext}`, url: logoDataUrl });
  }
  return files;
}
