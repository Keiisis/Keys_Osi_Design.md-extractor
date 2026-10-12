/**
 * Keys_Osi logo vectorizer — raster logo (RGBA) → compact, clean SVG.
 *
 * Pure functions on RGBA arrays: the caller decodes images (OffscreenCanvas
 * in the extension, synthetic buffers in tests). Works in Node and browsers.
 *
 * Pipeline: background removal → per-color membership fields (anti-aliased
 * edge pixels are unmixed between two colors, so contours land at subpixel
 * precision) → upscale small inputs → iso-contours at 0.5 (holes included) →
 * corner detection → polygon simplification → cubic Bézier fitting between
 * corners → evenodd paths, coordinates rounded to 2 decimals.
 */
import { ssimFromRgba, diffMask } from "./fidelity.mjs";

const DETAIL = {
  // tol: max curve-fit error in source pixels; corner: min turn (degrees);
  // speck: default minimum ring area as a share of the image area.
  low: { tol: 0.9, corner: 50, speck: 0.0006 },
  medium: { tol: 0.45, corner: 38, speck: 0.0002 },
  high: { tol: 0.2, corner: 30, speck: 0.00005 }
};
const UPSCALE_BELOW = 256;
const MAX_AUTO_COLORS = 8;

/* ---------- colors ---------- */

function parseHex(hex) {
  let h = String(hex).trim().replace(/^#/, "").toLowerCase();
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/.test(h)) throw new Error(`Invalid color: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(c) {
  return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function dist2(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/* ---------- background ---------- */

// Decides how the background is removed: an explicit color, the alpha
// channel, a dominant border color, or nothing (full-bleed artwork).
function detectBackground(rgba, w, h, background) {
  if (background) return { mode: "color", color: parseHex(background) };
  let transparent = 0;
  for (let p = 3; p < rgba.length; p += 4) if (rgba[p] < 250) transparent++;
  if (transparent >= w * h * 0.01) return { mode: "alpha" };

  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const groups = [];
  for (const i of border) {
    const c = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
    let g = groups.find((gr) => dist2(gr.mean, c) < 24 * 24);
    if (!g) groups.push((g = { mean: c.slice(), sum: [0, 0, 0], n: 0 }));
    g.sum[0] += c[0];
    g.sum[1] += c[1];
    g.sum[2] += c[2];
    g.n++;
    g.mean = g.sum.map((v) => v / g.n);
  }
  groups.sort((a, b) => b.n - a.n);
  if (groups.length && groups[0].n >= border.length * 0.6) return { mode: "color", color: groups[0].mean };
  return { mode: "none" };
}

/* ---------- palette ---------- */

// Auto palette from "solid" pixels only: anti-aliased edges are blends and
// would otherwise spawn fake in-between colors.
function autoPalette(rgba, w, h, bg) {
  const bins = new Map();
  let total = 0;
  const near = (i, j) =>
    Math.abs(rgba[i] - rgba[j]) <= 20 && Math.abs(rgba[i + 1] - rgba[j + 1]) <= 20 && Math.abs(rgba[i + 2] - rgba[j + 2]) <= 20 &&
    rgba[j + 3] >= 240;
  const add = (p) => {
    const key = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
    let b = bins.get(key);
    if (!b) bins.set(key, (b = { sum: [0, 0, 0], n: 0 }));
    b.sum[0] += rgba[p];
    b.sum[1] += rgba[p + 1];
    b.sum[2] += rgba[p + 2];
    b.n++;
    total++;
  };
  const isFg = (p) => rgba[p + 3] >= 240 && (bg.mode !== "color" || dist2([rgba[p], rgba[p + 1], rgba[p + 2]], bg.color) > 40 * 40);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      if (!isFg(p)) continue;
      if (near(p, p - 4) && near(p, p + 4) && near(p, p - w * 4) && near(p, p + w * 4)) add(p);
    }
  }
  if (total === 0) for (let p = 0; p < rgba.length; p += 4) if (isFg(p)) add(p);
  const sorted = [...bins.values()].map((b) => ({ c: b.sum.map((v) => v / b.n), n: b.n })).sort((a, b) => b.n - a.n);
  let clusters = [];
  for (const b of sorted) {
    const k = clusters.find((cl) => dist2(cl.c, b.c) < 48 * 48);
    if (k) {
      k.c = k.c.map((v, i) => (v * k.n + b.c[i] * b.n) / (k.n + b.n));
      k.n += b.n;
    } else clusters.push({ c: b.c.slice(), n: b.n });
  }
  clusters = clusters.filter((cl) => cl.n >= Math.max(3, total * 0.004)).sort((a, b) => b.n - a.n).slice(0, MAX_AUTO_COLORS);
  // A few k-means passes over the bins settle each color on its true mean.
  for (let it = 0; it < 4 && clusters.length; it++) {
    const acc = clusters.map(() => ({ s: [0, 0, 0], n: 0 }));
    for (const b of sorted) {
      let best = 0;
      for (let k = 1; k < clusters.length; k++) if (dist2(clusters[k].c, b.c) < dist2(clusters[best].c, b.c)) best = k;
      acc[best].s = acc[best].s.map((v, i) => v + b.c[i] * b.n);
      acc[best].n += b.n;
    }
    clusters = clusters.map((cl, k) => (acc[k].n ? { c: acc[k].s.map((v) => v / acc[k].n), n: acc[k].n } : cl));
  }
  return clusters.map((cl) => cl.c.map(Math.round));
}

/* ---------- membership fields ---------- */

// For every pixel, splits its coverage between at most two reference colors
// (pixel ≈ t·A + (1−t)·B). Edge pixels thereby carry subpixel position info.
function membershipFields(rgba, w, h, colors, bg) {
  const refs = bg.mode === "color" ? [...colors, bg.color] : colors;
  const fields = colors.map(() => new Float32Array(w * h));
  const cache = new Map();
  const unmix = (r, g, b) => {
    const p = [r, g, b];
    let n = 0;
    for (let i = 1; i < refs.length; i++) if (dist2(p, refs[i]) < dist2(p, refs[n])) n = i;
    let best = { i: n, j: n, t: 1, err: dist2(p, refs[n]) };
    if (best.err > 100) {
      for (let i = 0; i < refs.length; i++) {
        for (let j = i + 1; j < refs.length; j++) {
          const a = refs[i];
          const c = refs[j];
          const d = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
          const len = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
          const t = Math.max(0, Math.min(1, ((p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1] + (p[2] - c[2]) * d[2]) / len));
          const q = [c[0] + t * d[0], c[1] + t * d[1], c[2] + t * d[2]];
          const err = dist2(p, q);
          if (err < best.err * 0.8) best = { i, j, t, err };
        }
      }
    }
    return best;
  };
  for (let k = 0, p = 0; k < w * h; k++, p += 4) {
    let a = 1;
    if (bg.mode === "alpha") {
      a = rgba[p + 3] / 255;
      if (a <= 0.01) continue;
    }
    let r = rgba[p];
    let g = rgba[p + 1];
    let b = rgba[p + 2];
    if (bg.mode === "color" && rgba[p + 3] < 255) {
      // Composite onto the declared background so transparency means background.
      const al = rgba[p + 3] / 255;
      r = r * al + bg.color[0] * (1 - al);
      g = g * al + bg.color[1] * (1 - al);
      b = b * al + bg.color[2] * (1 - al);
    }
    const key = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    let m = cache.get(key);
    if (!m) cache.set(key, (m = unmix(r, g, b)));
    if (m.i < colors.length) fields[m.i][k] += m.t * a;
    if (m.j !== m.i && m.j < colors.length) fields[m.j][k] += (1 - m.t) * a;
  }
  return fields;
}

// Hard-edged (non anti-aliased) art has no subpixel information: its
// contour is a staircase. Detected when boundary pixels are almost never
// partial.
function isAliased(f, w, h) {
  let boundary = 0;
  let partial = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = f[i];
      if (v > 0.06 && v < 0.94) partial++;
      else if (v >= 0.94 && ((x > 0 && f[i - 1] <= 0.5) || (x < w - 1 && f[i + 1] <= 0.5) || (y > 0 && f[i - w] <= 0.5) || (y < h - 1 && f[i + w] <= 0.5))) boundary++;
    }
  }
  return boundary > 16 && partial < boundary * 0.3;
}

// Light [1 4 1]/6 blur: rounds the staircase into a line the curve fit can
// follow, while a 1 px stroke still peaks above the 0.5 iso level.
function soften(f, w, h) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      tmp[i] = (f[x > 0 ? i - 1 : i] + 4 * f[i] + f[x < w - 1 ? i + 1 : i]) / 6;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = (tmp[y > 0 ? i - w : i] + 4 * tmp[i] + tmp[y < h - 1 ? i + w : i]) / 6;
    }
  }
  return out;
}

// Cubic-interpolation upscale: smoother iso-contours than the raw pixel grid.
function upscaleField(f, w, h, s) {
  if (s === 1) return f;
  const W = w * s;
  const H = h * s;
  const out = new Float32Array(W * H);
  const at = (x, y) => f[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  const wts = (t) => [
    ((-t + 2) * t - 1) * t * 0.5,
    ((3 * t - 5) * t * t + 2) * 0.5,
    ((-3 * t + 4) * t + 1) * t * 0.5,
    (t - 1) * t * t * 0.5
  ];
  const tab = [];
  for (let i = 0; i < s; i++) {
    const u = (i + 0.5) / s - 0.5;
    const base = Math.floor(u);
    tab.push({ base, w: wts(u - base) });
  }
  for (let Y = 0; Y < H; Y++) {
    const ty = tab[Y % s];
    const y0 = Math.floor(Y / s) + ty.base;
    for (let X = 0; X < W; X++) {
      const tx = tab[X % s];
      const x0 = Math.floor(X / s) + tx.base;
      let v = 0;
      for (let j = 0; j < 4; j++) {
        const wy = ty.w[j];
        const yy = y0 - 1 + j;
        v += wy * (tx.w[0] * at(x0 - 1, yy) + tx.w[1] * at(x0, yy) + tx.w[2] * at(x0 + 1, yy) + tx.w[3] * at(x0 + 2, yy));
      }
      out[Y * W + X] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

// Box blur (separable, prefix sums) used to build a soft "near this layer" mask.
function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0;
    const row = y * W;
    for (let x = -r; x <= r; x++) acc += src[row + Math.max(0, Math.min(W - 1, x))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(H - 1, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / n;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

// A hole of a lower layer that the layers above cover entirely is invisible:
// filling it drops a subpath and puts the upper color over a solid base.
function fillCoveredHoles(ext, above, W, H) {
  const label = new Int32Array(W * H);
  const stack = new Int32Array(W * H);
  let next = 0;
  for (let seed = 0; seed < ext.length; seed++) {
    if (label[seed] || ext[seed] > 0.5) continue;
    next++;
    let top = 0;
    let size = 0;
    let covered = 0;
    let border = false;
    stack[top++] = seed;
    label[seed] = next;
    const members = [];
    while (top) {
      const i = stack[--top];
      members.push(i);
      size++;
      if (above[i] > 0.5) covered++;
      const x = i % W;
      const y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !label[j] && ext[j] <= 0.5) {
          label[j] = next;
          stack[top++] = j;
        }
      }
    }
    if (!border && covered >= size * 0.97) for (const i of members) ext[i] = 1;
  }
}

/* ---------- contours ---------- */

// Marching squares at iso 0.5 with a zero border, so every ring closes.
// Rings never cross, which is exactly what fill-rule="evenodd" needs for holes.
function traceContours(f, W, H) {
  const GW = W + 2;
  const GH = H + 2;
  const v = (x, y) => (x <= 0 || y <= 0 || x > W || y > H ? 0 : f[(y - 1) * W + (x - 1)]);
  const pts = new Map();
  const point = (id) => {
    let p = pts.get(id);
    if (p) return p;
    const e = id >> 1;
    const x = e % GW;
    const y = (e - x) / GW;
    if (id & 1) {
      const a = v(x, y);
      const b = v(x, y + 1);
      p = [x, y + (0.5 - a) / (b - a)];
    } else {
      const a = v(x, y);
      const b = v(x + 1, y);
      p = [x + (0.5 - a) / (b - a), y];
    }
    pts.set(id, p);
    return p;
  };
  const links = new Map();
  const link = (a, b) => {
    (links.get(a) || links.set(a, []).get(a)).push(b);
    (links.get(b) || links.set(b, []).get(b)).push(a);
  };
  for (let y = 0; y < GH - 1; y++) {
    for (let x = 0; x < GW - 1; x++) {
      const tl = v(x, y) > 0.5;
      const tr = v(x + 1, y) > 0.5;
      const br = v(x + 1, y + 1) > 0.5;
      const bl = v(x, y + 1) > 0.5;
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = 2 * (y * GW + x);
      const bottom = 2 * ((y + 1) * GW + x);
      const left = 2 * (y * GW + x) + 1;
      const right = 2 * (y * GW + x + 1) + 1;
      switch (c) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        case 5: case 10: {
          const center = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 > 0.5;
          // Saddle: the cell center decides whether the two "inside" corners connect.
          if ((c === 5) === center) { link(left, top); link(bottom, right); }
          else { link(left, bottom); link(top, right); }
          break;
        }
      }
    }
  }
  const rings = [];
  const seen = new Set();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      ring.push(point(cur));
      const nb = links.get(cur);
      const next = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur;
      cur = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}

/* ---------- geometry ---------- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};

// Point at signed arc distance d from vertex i on a closed ring.
function walk(ring, cum, total, i, d) {
  const n = ring.length;
  let target = cum[i] + d;
  target = ((target % total) + total) % total;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  const k = lo - 1;
  const a = ring[k];
  const b = ring[(k + 1) % n];
  const seg = cum[k + 1] - cum[k] || 1;
  return add(a, mul(sub(b, a), (target - cum[k]) / seg));
}

function turnAngle(ring, cum, total, i, d) {
  const p = ring[i];
  const a = norm(sub(p, walk(ring, cum, total, i, -d)));
  const b = norm(sub(walk(ring, cum, total, i, d), p));
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

// Turn between the edge directions measured just outside the vertex
// neighbourhood, so the anti-aliasing round-off does not hide the angle.
function edgeTurn(ring, cum, total, i, d) {
  const a = norm(sub(walk(ring, cum, total, i, -d), walk(ring, cum, total, i, -2.5 * d)));
  const b = norm(sub(walk(ring, cum, total, i, 2.5 * d), walk(ring, cum, total, i, d)));
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

// How much one arm of a vertex bends on its own: near zero for the straight
// or gently curved edges that meet at a real corner, large along an arc.
function armBend(ring, cum, total, i, d) {
  const a = walk(ring, cum, total, i, d);
  const b = walk(ring, cum, total, i, 2.5 * d);
  const c = walk(ring, cum, total, i, 4 * d);
  return Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(b, a)), norm(sub(c, b))))));
}

// Corner = local maximum of the short-window turn, with a large edge turn
// and two arms that are not themselves curving (that would be a tight arc).
function findCorners(ring, d, minTurn) {
  const n = ring.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + len(sub(ring[(i + 1) % n], ring[i]));
  const total = cum[n];
  if (total < 12 * d) return { corners: [], cum, total };
  const ang = new Float64Array(n);
  for (let i = 0; i < n; i++) ang[i] = turnAngle(ring, cum, total, i, d);
  const corners = [];
  const win = 2 * d;
  for (let i = 0; i < n; i++) {
    if (ang[i] < minTurn * 0.5) continue;
    let isMax = true;
    for (let k = 1; k < n && isMax; k++) {
      const j = (i + k) % n;
      const back = (i - k + n) % n;
      const dj = cum[j] - cum[i] + (j < i ? total : 0);
      const db = cum[i] - cum[back] + (back > i ? total : 0);
      if (dj > win && db > win) break;
      if ((dj <= win && (ang[j] > ang[i] || (ang[j] === ang[i] && j < i))) || (db <= win && (ang[back] > ang[i] || (ang[back] === ang[i] && back < i)))) isMax = false;
    }
    if (!isMax) continue;
    const turn = edgeTurn(ring, cum, total, i, d);
    if (turn < minTurn) continue;
    const bend = Math.max(armBend(ring, cum, total, i, -d), armBend(ring, cum, total, i, d));
    if (bend > Math.min(0.3 * turn, 0.26)) continue;
    corners.push(i);
  }
  return { corners, cum, total };
}

// Rebuilds the sharp tip that anti-aliasing rounded off: intersect the two
// incoming/outgoing edge lines, accept only if it stays close to the vertex.
function sharpenCorner(ring, cum, total, i, d) {
  const p = ring[i];
  const a1 = walk(ring, cum, total, i, -3 * d);
  const a2 = walk(ring, cum, total, i, -1.2 * d);
  const b1 = walk(ring, cum, total, i, 1.2 * d);
  const b2 = walk(ring, cum, total, i, 3 * d);
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return p;
  const t = ((b1[0] - a1[0]) * s[1] - (b1[1] - a1[1]) * s[0]) / den;
  const q = add(a1, mul(r, t));
  return len(sub(q, p)) <= 2 * d ? q : p;
}

// Polygon simplification by uniform arc-length resampling: collapses the
// dense upscaled contour while keeping long straight runs sampled, so the
// curve fit cannot bulge between far-apart points.
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const seg = len(sub(pts[i], a));
    let t = step - carry;
    while (t < seg) {
      out.push(add(a, mul(sub(pts[i], a), t / seg)));
      t += step;
    }
    carry = seg - (t - step);
  }
  const last = pts[pts.length - 1];
  if (len(sub(last, out[out.length - 1])) < step * 0.4 && out.length > 1) out.pop();
  out.push(last);
  return out;
}

/* ---------- Bézier fitting (least squares with root-finding reparameterization) ---------- */

function bez(c, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const tot = u[u.length - 1] || 1;
  return u.map((x) => x / tot);
}

function generateBezier(pts, u, t1, t2) {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b0 = mt * mt * mt;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const b3 = t * t * t;
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const segLen = len(sub(p3, p0));
  let al = 0;
  let ar = 0;
  if (Math.abs(det) > 1e-12) {
    al = (x0 * c11 - x1 * c01) / det;
    ar = (c00 * x1 - c01 * x0) / det;
  }
  const eps = 1e-6 * segLen;
  if (!(al > eps) || !(ar > eps) || al > segLen * 2 || ar > segLen * 2) al = ar = segLen / 3;
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3];
}

function refineParam(c, p, t) {
  const q = bez(c, t);
  const mt = 1 - t;
  const d1 = [
    3 * (mt * mt * (c[1][0] - c[0][0]) + 2 * mt * t * (c[2][0] - c[1][0]) + t * t * (c[3][0] - c[2][0])),
    3 * (mt * mt * (c[1][1] - c[0][1]) + 2 * mt * t * (c[2][1] - c[1][1]) + t * t * (c[3][1] - c[2][1]))
  ];
  const d2 = [
    6 * (mt * (c[2][0] - 2 * c[1][0] + c[0][0]) + t * (c[3][0] - 2 * c[2][0] + c[1][0])),
    6 * (mt * (c[2][1] - 2 * c[1][1] + c[0][1]) + t * (c[3][1] - 2 * c[2][1] + c[1][1]))
  ];
  const diff = sub(q, p);
  const den = dot(d1, d1) + dot(diff, d2);
  if (Math.abs(den) < 1e-12) return t;
  return Math.max(0, Math.min(1, t - dot(diff, d1) / den));
}

function maxError(pts, c, u) {
  let max = 0;
  let split = pts.length >> 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dot(sub(bez(c, u[i]), pts[i]), sub(bez(c, u[i]), pts[i]));
    if (d > max) {
      max = d;
      split = i;
    }
  }
  return { err: Math.sqrt(max), split };
}

function fitCubic(pts, t1, t2, tol, out, depth = 0) {
  const p0 = pts[0];
  const p3 = pts[pts.length - 1];
  // Straight run: a line is exact and shorter than a degenerate curve.
  const chord = sub(p3, p0);
  const cl = len(chord);
  // Only when both end tangents agree with the chord, or the join would kink.
  const aligned = cl > 0 && dot(t1, chord) / cl > 0.99 && -dot(t2, chord) / cl > 0.99;
  if (pts.length <= 2 || (aligned && pts.every((p) => Math.abs(chord[0] * (p[1] - p0[1]) - chord[1] * (p[0] - p0[0])) / cl <= tol * 0.5) && pts.every((p, i) => i === 0 || dot(sub(p, pts[i - 1]), chord) >= 0))) {
    out.push({ line: true, to: p3 });
    return;
  }
  let u = chordParams(pts);
  let c = generateBezier(pts, u, t1, t2);
  let { err, split } = maxError(pts, c, u);
  if (err <= tol) {
    out.push({ c });
    return;
  }
  if (err <= tol * 4) {
    for (let k = 0; k < 6; k++) {
      u = u.map((t, i) => refineParam(c, pts[i], t));
      c = generateBezier(pts, u, t1, t2);
      ({ err, split } = maxError(pts, c, u));
      if (err <= tol) {
        out.push({ c });
        return;
      }
    }
  }
  if (depth > 24 || pts.length < 4) {
    out.push({ c });
    return;
  }
  split = Math.max(1, Math.min(pts.length - 2, split));
  const k = Math.min(2, split, pts.length - 1 - split);
  const tc = norm(sub(pts[split - k], pts[split + k]));
  fitCubic(pts.slice(0, split + 1), t1, tc, tol, out, depth + 1);
  fitCubic(pts.slice(split), mul(tc, -1), t2, tol, out, depth + 1);
}

// Tangent leaving pts[0] (or entering the end when reversed), averaged over a
// short arc so marching-squares jitter does not tilt it.
function endTangent(pts, reach) {
  let acc = [0, 0];
  let travelled = 0;
  for (let i = 1; i < pts.length && travelled < reach; i++) {
    travelled += len(sub(pts[i], pts[i - 1]));
    acc = add(acc, sub(pts[i], pts[0]));
  }
  const t = norm(acc);
  return t[0] || t[1] ? t : norm(sub(pts[pts.length - 1], pts[0]));
}

// Maximal straight stretches of a sampled run (index pairs). Consecutive
// stretches meeting at a shallow angle are a large arc being chopped into a
// polygon, so they are dropped and left to the curve fit.
function straightRuns(pts, lineTol, minLen, step) {
  const n = pts.length;
  const runs = [];
  let i = 0;
  while (i < n - 1) {
    let best = -1;
    for (let j = i + 1; j < n; j++) {
      const ch = sub(pts[j], pts[i]);
      const cl = len(ch);
      let ok = cl > 0;
      for (let k = i + 1; ok && k < j; k++) {
        ok = Math.abs(ch[0] * (pts[k][1] - pts[i][1]) - ch[1] * (pts[k][0] - pts[i][0])) / cl <= lineTol;
      }
      if (!ok) break;
      best = j;
    }
    if (best > 0 && (best - i) * step >= minLen) {
      runs.push([i, best]);
      i = best;
    } else i++;
  }
  const dir = (r) => norm(sub(pts[r[1]], pts[r[0]]));
  const shallow = runs.map(() => false);
  for (let k = 1; k < runs.length; k++) {
    if ((runs[k][0] - runs[k - 1][1]) * step < minLen * 0.5 && dot(dir(runs[k]), dir(runs[k - 1])) > Math.cos(0.35)) shallow[k] = shallow[k - 1] = true;
  }
  return runs.filter((_, k) => !shallow[k]);
}

// Binomial smoothing of a sampled run (ends pinned unless closed): melts the
// staircase of hard-edged art into the line or curve it approximates.
function smoothRun(pts, iterations, closed) {
  let cur = pts;
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    const next = cur.slice();
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = cur[closed ? (i - 1 + n) % n : i - 1];
      const b = cur[closed ? (i + 1) % n : i + 1];
      next[i] = [(a[0] + 2 * cur[i][0] + b[0]) / 4, (a[1] + 2 * cur[i][1] + b[1]) / 4];
    }
    cur = next;
  }
  return cur;
}

// Fits one open run: exact lines on straight stretches, cubics elsewhere,
// with each curve leaving and entering a line along that line (no kinks).
function fitRun(pts, t1, t2, opts, segs) {
  const runs = straightRuns(pts, opts.lineTol, opts.minLine, opts.step);
  let cur = 0;
  let curT = t1;
  for (const [i, j] of runs) {
    const dir = norm(sub(pts[j], pts[i]));
    if (i > cur) fitCubic(pts.slice(cur, i + 1), curT, mul(dir, -1), opts.tol, segs);
    segs.push({ line: true, to: pts[j] });
    cur = j;
    curT = dir;
  }
  if (cur < pts.length - 1) fitCubic(pts.slice(cur), curT, t2, opts.tol, segs);
}

// Joins consecutive line segments that continue in the same direction.
function mergeLines(start, segs, lineTol) {
  const out = [];
  let prevStart = null;
  let cur = start;
  for (const sg of segs) {
    const last = out[out.length - 1];
    if (sg.line && last && last.line) {
      const ch = sub(sg.to, prevStart);
      const cl = len(ch);
      if (cl > 0 && Math.abs(ch[0] * (cur[1] - prevStart[1]) - ch[1] * (cur[0] - prevStart[0])) / cl <= lineTol && dot(sub(cur, prevStart), ch) > 0) {
        last.to = sg.to;
        cur = sg.to;
        continue;
      }
    }
    prevStart = cur;
    out.push({ ...sg });
    cur = sg.line ? sg.to : sg.c[3];
  }
  return out;
}

function fitRing(ring, opts) {
  const fit = fitRingRaw(ring, opts);
  return fit && { start: fit.start, segs: mergeLines(fit.start, fit.segs, opts.lineTol) };
}

function fitRingRaw(ring, opts) {
  const { d, minTurn, tol, step } = opts;
  const { corners, cum, total } = findCorners(ring, d, minTurn);
  const n = ring.length;
  const segs = [];
  if (!corners.length) {
    let pts = resample([...ring, ring[0]], step);
    if (pts.length < 5) return null;
    if (opts.smooth) {
      const loop = smoothRun(pts.slice(0, -1), opts.smooth, true);
      pts = [...loop, loop[0]];
    }
    let m = pts.length - 1;
    const runs = straightRuns(pts, opts.lineTol, opts.minLine, step);
    if (runs.length) {
      // Smooth loop with straight sides (rounded rectangle, stadium): start
      // on a side so the seam sits inside a line, then fit as an open run.
      const ring2 = [...pts.slice(runs[0][0], m), ...pts.slice(0, runs[0][0])];
      pts = [...ring2, ring2[0]];
      const t = norm(sub(pts[runs[0][1] - runs[0][0]], pts[0]));
      fitRun(pts, t, mul(t, -1), opts, segs);
      return { start: pts[0], segs };
    }
    // Pure curve: pre-split into quarters, since a quarter turn is what one
    // cubic fits best; a circle comes out as four clean arcs.
    // Tangents come from a symmetric chord over a few samples: parallel to
    // the true tangent on arcs and steadier than adjacent points.
    const tangent = (k) => norm(sub(pts[(k + 2) % m], pts[(k - 2 + m) % m]));
    const cuts = [0, 1, 2, 3, 4].map((q) => Math.round((q * m) / 4));
    for (let q = 0; q < 4; q++) {
      const a = cuts[q];
      const b = cuts[q + 1];
      if (b - a < 1) continue;
      fitCubic(pts.slice(a, b + 1), tangent(a), mul(tangent(b), -1), tol, segs);
    }
    return { start: pts[0], segs };
  }
  const tips = corners.map((i) => sharpenCorner(ring, cum, total, i, d));
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % corners.length];
    const run = [tips[k]];
    // Skip the anti-aliasing round-off right next to each tip: those samples
    // lie inside the sharp corner and would pull the fit into a zigzag.
    for (let i = (a + 1) % n; i !== b; i = (i + 1) % n) {
      if ((cum[i] - cum[a] + total) % total < 0.75 * d || (cum[b] - cum[i] + total) % total < 0.75 * d) continue;
      run.push(ring[i]);
    }
    run.push(tips[(k + 1) % corners.length]);
    const pts = smoothRun(resample(run, step), opts.smooth || 0, false);
    if (pts.length < 2 || len(sub(pts[pts.length - 1], pts[0])) < 1e-9) continue;
    const reach = 3 * d;
    fitRun(pts, endTangent(pts, reach), endTangent(pts.slice().reverse(), reach), opts, segs);
  }
  return { start: tips[0], segs };
}

/* ---------- SVG output ---------- */

const fmt = (v) => {
  let s = (Math.round(v * 100) / 100).toString();
  if (s === "-0") s = "0";
  return s.replace(/^(-?)0\./, "$1.");
};

// Relative commands from rounded absolute points: compact and drift-free.
function ringToPath(fit, scale) {
  const R = (p) => [Math.round(p[0] * scale * 100) / 100, Math.round(p[1] * scale * 100) / 100];
  let cur = R(fit.start);
  let d = "M" + fmt(cur[0]) + " " + fmt(cur[1]);
  const nums = (arr) => arr.map(fmt).join(" ").replace(/ -/g, "-");
  let lastCmd = "";
  for (const s of fit.segs) {
    if (s.line) {
      const p = R(s.to);
      const rel = [p[0] - cur[0], p[1] - cur[1]];
      if (Math.abs(rel[0]) < 0.005 && Math.abs(rel[1]) < 0.005) continue;
      d += (lastCmd === "l" ? (rel[0] < 0 ? "" : " ") : "l") + nums(rel);
      lastCmd = "l";
      cur = p;
    } else {
      const [, c1, c2, e] = s.c.map(R);
      const rel = [c1[0] - cur[0], c1[1] - cur[1], c2[0] - cur[0], c2[1] - cur[1], e[0] - cur[0], e[1] - cur[1]];
      d += (lastCmd === "c" ? (rel[0] < 0 ? "" : " ") : "c") + nums(rel);
      lastCmd = "c";
      cur = e;
    }
  }
  return d + "z";
}

/* ---------- public API ---------- */

/**
 * Vectorizes a raster logo.
 * @param {Uint8Array|Uint8ClampedArray|number[]} rgba  w*h*4 pixels
 * @param {number} width
 * @param {number} height
 * @param {{palette?: string[], background?: string, detail?: "low"|"medium"|"high", minArea?: number}} [opts]
 * @returns {{svg: string, width: number, height: number, pathCount: number, colors: string[]}}
 */
export function vectorizeLogo(rgba, width, height, opts = {}) {
  const { palette, background, detail = "medium" } = opts;
  const cfg = DETAIL[detail] || DETAIL.medium;
  const w = width | 0;
  const h = height | 0;
  if (!(w > 0 && h > 0) || !rgba || rgba.length < w * h * 4) throw new Error("vectorizeLogo: rgba must hold width*height*4 values.");
  const minArea = opts.minArea ?? Math.max(1, w * h * cfg.speck);

  const bg = detectBackground(rgba, w, h, background);
  let colors;
  let hexes;
  if (palette && palette.length) {
    hexes = palette.map((c) => toHex(parseHex(c)));
    colors = hexes.map(parseHex);
  } else {
    colors = autoPalette(rgba, w, h, bg);
    hexes = colors.map(toHex);
  }
  const s = Math.max(w, h) < UPSCALE_BELOW ? Math.min(8, Math.ceil(UPSCALE_BELOW / Math.max(w, h))) : 1;
  const W = w * s;
  const H = h * s;

  const raw = membershipFields(rgba, w, h, colors, bg);
  let layers = raw
    .map((f, i) => ({ hex: hexes[i], area: f.reduce((a, v) => a + v, 0), field: f }))
    .filter((l) => l.area >= Math.max(minArea, 0.5));
  // Largest first (bottom); every layer is cut out where others sit, so the
  // order only matters along shared edges.
  layers.sort((a, b) => b.area - a.area);
  layers.forEach((l) => {
    l.aliased = isAliased(l.field, w, h);
    l.field = upscaleField(l.aliased ? soften(l.field, w, h) : l.field, w, h, s);
  });

  // Seam fix: a lower layer extends slightly under the layers drawn above it,
  // so two colors meeting edge-to-edge show no background hairline.
  const r = Math.max(1, Math.round(s * 1.25));
  const fields = layers.map((l, k) => {
    if (k === layers.length - 1) return l.field;
    const own = new Float32Array(W * H);
    for (let i = 0; i < own.length; i++) own[i] = l.field[i] > 0.3 ? 1 : 0;
    const nearOwn = boxBlur(own, W, H, r);
    const ext = new Float32Array(W * H);
    const above = new Float32Array(W * H);
    for (let i = 0; i < ext.length; i++) {
      for (let m = k + 1; m < layers.length; m++) above[i] += layers[m].field[i];
      ext[i] = Math.min(1, l.field[i] + above[i] * Math.min(1, nearOwn[i] * 4));
    }
    fillCoveredHoles(ext, above, W, H);
    return ext;
  });

  const fitOpts = { d: s, minTurn: (cfg.corner * Math.PI) / 180, tol: cfg.tol * s, step: 0.75 * s, lineTol: 0.12 * s, minLine: Math.max(6, 0.08 * Math.max(w, h)) * s };
  // Staircase edges are only known to ±0.5 px: wider corner window and
  // looser tolerances let the fit run through the steps instead of along them.
  const aliasedOpts = { ...fitOpts, d: 2.5 * s, tol: Math.max(cfg.tol, 0.75) * s, lineTol: 0.6 * s, smooth: 12 };
  const scale = 1 / s;
  const paths = [];
  const used = [];
  layers.forEach((l, k) => {
    const rings = traceContours(fields[k], W, H)
      .map((ring) => ring.map(([x, y]) => [x - 0.5, y - 0.5]))
      .filter((ring) => Math.abs(ringArea(ring)) * scale * scale >= minArea);
    const d = rings.map((ring) => fitRing(ring, l.aliased ? aliasedOpts : fitOpts)).filter(Boolean).map((f) => ringToPath(f, scale)).join("");
    if (!d) return;
    paths.push(`<path fill="${l.hex}" fill-rule="evenodd" d="${d}"/>`);
    used.push(l.hex);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${paths.join("")}</svg>`;
  return { svg, width: w, height: h, pathCount: paths.length, colors: used };
}

function overWhite(rgba) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let p = 0; p < rgba.length; p += 4) {
    const a = rgba[p + 3] / 255;
    out[p] = rgba[p] * a + 255 * (1 - a);
    out[p + 1] = rgba[p + 1] * a + 255 * (1 - a);
    out[p + 2] = rgba[p + 2] * a + 255 * (1 - a);
    out[p + 3] = 255;
  }
  return out;
}

/**
 * Fidelity of a rendered SVG against the source raster, both composited on white.
 * @returns {{ssim: number, diffRatio: number}}
 */
export function scoreVectorization(originalRgba, renderedRgba, width, height) {
  const a = overWhite(originalRgba);
  const b = overWhite(renderedRgba);
  return { ssim: ssimFromRgba(a, b, width, height), diffRatio: diffMask(a, b, width, height).ratio };
}

/**
 * Tries every detail level, renders each with the caller's
 * `render(svg, w, h) → Promise<rgba>`, keeps the best SSIM (smaller SVG on near-ties).
 * @returns {Promise<{svg, width, height, pathCount, colors, detail, score: {ssim, diffRatio}, trials: Array}>}
 */
export async function bestVectorization(rgba, width, height, opts = {}, render) {
  if (typeof render !== "function") throw new Error("bestVectorization: render(svg, w, h) is required.");
  let best = null;
  const trials = [];
  for (const detail of ["low", "medium", "high"]) {
    const result = vectorizeLogo(rgba, width, height, { ...opts, detail });
    const score = scoreVectorization(rgba, await render(result.svg, width, height), width, height);
    trials.push({ detail, ...score, bytes: result.svg.length });
    const better = !best || score.ssim > best.score.ssim + 0.002 || (score.ssim > best.score.ssim - 0.002 && result.svg.length < best.svg.length);
    if (better) best = { ...result, detail, score };
  }
  return { ...best, trials };
}
