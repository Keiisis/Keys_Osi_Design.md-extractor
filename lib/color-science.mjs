/**
 * Keys_Osi color science: parse every color syntax a browser's computed
 * style can return, composite translucency over the real backdrop, and
 * measure what designers reason with (luminance, contrast, chroma, hue).
 *
 * Root cause this module removes: rgba(0,0,0,0.08) borders/overlays used
 * to be flattened to opaque #000000, painting "black" into every site.
 */

const INVISIBLE_ALPHA = 0.04;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));

function num(token, scale = 1) {
  if (token === undefined || token === null || token === "none") return 0;
  const text = String(token).trim();
  if (text.endsWith("%")) return (Number.parseFloat(text) / 100) * scale;
  return Number.parseFloat(text);
}

function alphaOf(token) {
  if (token === undefined || token === null || token === "") return 1;
  return clamp01(num(token, 1));
}

const srgbEncode = (linear) => {
  const c = clamp01(linear);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};
const srgbDecode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function fromLinear(r, g, b, a) {
  return { r: byte(srgbEncode(r) * 255), g: byte(srgbEncode(g) * 255), b: byte(srgbEncode(b) * 255), a };
}

function oklabToRgb(L, A, B, alpha) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return fromLinear(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    alpha
  );
}

// CIE Lab (D50, as CSS defines it) -> sRGB via Bradford-adapted XYZ D65.
function labToRgb(L, A, B, alpha) {
  const e = 216 / 24389;
  const k = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = fy + A / 500;
  const fz = fy - B / 200;
  const x = (fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k) * 0.96422;
  const y = L > k * e ? fy ** 3 : L / k;
  const z = (fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k) * 0.82521;
  // D50 -> D65 (Bradford)
  const X = 0.9554734527042182 * x - 0.023098536874261423 * y + 0.0632593086610217 * z;
  const Y = -0.028369706963208136 * x + 1.0099954580058226 * y + 0.021041398966943008 * z;
  const Z = 0.012314001688319899 * x - 0.020507696433477912 * y + 1.3303659366080753 * z;
  return fromLinear(
    3.2409699419045226 * X - 1.537383177570094 * Y - 0.4986107602930034 * Z,
    -0.9692436362808796 * X + 1.8759675015077202 * Y + 0.04155505740717559 * Z,
    0.05563007969699366 * X - 0.20397695888897652 * Y + 1.0569715142428786 * Z,
    alpha
  );
}

/**
 * Parses rgb()/rgba() (comma or space syntax), #hex (3/4/6/8), oklch(),
 * oklab(), lab(), lch(), color(srgb|srgb-linear|display-p3 ...) and
 * "none" components. Returns { r, g, b, a } (bytes + 0..1 alpha) or null.
 */
export function parseCssColor(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (text.startsWith("#")) {
    let h = text.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    };
  }
  const fn = text.match(/^([a-z-]+)\((.*)\)$/);
  if (!fn) return null;
  const [, name, body] = fn;
  const [main, alphaPart] = body.split("/");
  const parts = main.replace(/,/g, " ").trim().split(/\s+/);
  // A 4th bare component is alpha only in legacy rgba(r, g, b, a); in
  // color(space x y z) the first token is the space name.
  const legacyAlpha = (name === "rgb" || name === "rgba") && parts.length === 4;
  const alpha = alphaPart !== undefined ? alphaOf(alphaPart.trim()) : legacyAlpha ? alphaOf(parts[3]) : 1;

  if (name === "rgb" || name === "rgba") {
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255));
    if (![r, g, b].every(Number.isFinite)) return null;
    return { r: byte(r), g: byte(g), b: byte(b), a: alpha };
  }
  if (name === "oklch") {
    const L = num(parts[0], 1);
    const C = num(parts[1], 0.4);
    const H = (num(parts[2]) * Math.PI) / 180;
    return oklabToRgb(L, C * Math.cos(H), C * Math.sin(H), alpha);
  }
  if (name === "oklab") return oklabToRgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4), alpha);
  if (name === "lab") return labToRgb(num(parts[0], 100), num(parts[1], 125), num(parts[2], 125), alpha);
  if (name === "lch") {
    const H = (num(parts[2]) * Math.PI) / 180;
    const C = num(parts[1], 150);
    return labToRgb(num(parts[0], 100), C * Math.cos(H), C * Math.sin(H), alpha);
  }
  if (name === "color") {
    const [space, ...values] = parts;
    const [x, y, z] = values.slice(0, 3).map((p) => num(p, 1));
    if (![x, y, z].every(Number.isFinite)) return null;
    if (space === "srgb") return { r: byte(x * 255), g: byte(y * 255), b: byte(z * 255), a: alpha };
    if (space === "srgb-linear") return fromLinear(x, y, z, alpha);
    if (space === "display-p3") {
      const [lr, lg, lb] = [x, y, z].map(srgbDecode);
      return fromLinear(
        1.2249401 * lr - 0.2249404 * lg,
        -0.0420569 * lr + 1.0420571 * lg,
        -0.0196376 * lr - 0.0786361 * lg + 1.0982735 * lb,
        alpha
      );
    }
    return null;
  }
  return null;
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => byte(v).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex) {
  const parsed = parseCssColor(hex);
  return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : null;
}

/** Source-over compositing of a translucent color on an opaque backdrop. */
export function composite(fg, backdrop) {
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + backdrop.r * (1 - a),
    g: fg.g * a + backdrop.g * (1 - a),
    b: fg.b * a + backdrop.b * (1 - a),
    a: 1
  };
}

/**
 * The color a viewer actually sees, as #rrggbb.
 * - invisible (alpha < 4%) -> "transparent"
 * - translucent -> composited over `backdropHex` (the page canvas)
 * - unparseable -> null
 */
export function visibleHex(value, backdropHex) {
  const color = parseCssColor(value);
  if (!color) return null;
  if (color.a < INVISIBLE_ALPHA) return "transparent";
  if (color.a < 1 && backdropHex) {
    const backdrop = parseCssColor(backdropHex);
    if (backdrop) return rgbToHex(composite(color, backdrop));
  }
  return rgbToHex(color);
}

export function relativeLuminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const [r, g, b] = [c.r, c.g, c.b].map((v) => srgbDecode(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** HSL-style saturation 0..1 weighted by how far from grey the color is. */
export function chroma(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
}

/** Brand-grade color: clearly saturated (HSL) and not near black/white. */
export function isSaturated(hex) {
  const c = hexToRgb(hex);
  if (!c) return false;
  const max = Math.max(c.r, c.g, c.b) / 255;
  const min = Math.min(c.r, c.g, c.b) / 255;
  const l = (max + min) / 2;
  if (l < 0.1 || l > 0.92 || max - min < 0.12) return false;
  const s = (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  return s >= 0.45;
}

export function hue(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

export function colorDistance(a, b) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return Infinity;
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
}
