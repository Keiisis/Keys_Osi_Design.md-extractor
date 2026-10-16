/**
 * Keys_Osi code clone: turns what clone-probe.js measured (computed styles
 * and layout at several widths) into a runnable React + Tailwind v4 project.
 *
 * - Every value comes from the page: the classes are Tailwind utilities or
 *   arbitrary values, mobile first, one variant per breakpoint the site uses.
 * - Sizes are read across widths: a width equal to its parent stays fluid,
 *   one that never changes is fixed, one that keeps its ratio becomes a %.
 * - Top-level sections become components; repeated siblings with the same
 *   shape become one component fed by a data array.
 * Pure functions: the service worker (sw-clone.mjs) drives the capture.
 */

export const CLONE_WIDTHS = [375, 768, 1024, 1440];
export const CLONE_DEPENDENCIES = {
  dependencies: { react: "^19.3.1", "react-dom": "^19.3.1" },
  devDependencies: { "@tailwindcss/vite": "^4.3.3", "@vitejs/plugin-react": "^6.1.2", tailwindcss: "^4.3.3", vite: "^8.3.4" }
};

const DEFAULT = Symbol("default");
const SKIPPED = Symbol("skipped");
const NAMES = [
  ["sm", 640],
  ["md", 768],
  ["lg", 1024],
  ["xl", 1280],
  ["2xl", 1536],
  ["3xl", 1792],
  ["4xl", 2048]
];

/* ============================== values ============================== */

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** rgb()/rgba() → #rrggbb(aa), anywhere in a value (shadows, gradients). */
export function rgbToHex(value) {
  return String(value).replace(/rgba?\(([^()]*)\)/g, (match, inner) => {
    const parts = inner.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return match;
    const [r, g, b, a = 1] = parts;
    if (a === 0) return "transparent";
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ""}`;
  });
}

/** A computed value made safe for a class: hex colors, no spaces after commas, single quotes. */
export function normalizeValue(value) {
  return rgbToHex(String(value).trim())
    .replace(/,\s+/g, ",")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .replace(/(^|[\s(,])0px(?=$|[\s),])/g, (match, before) => `${before}0`);
}

const KEYWORD_VALUE = /^(revert|inherit|initial|unset)$/;

// Page-controlled text ends up in className (a String.raw template when it
// holds a backslash): a backtick or "${" must never reach the source.
const arbitrary = (value) =>
  normalizeValue(value)
    .replace(/`/g, "%60")
    .replace(/\$\{/g, "$%7B")
    .replace(/_/g, "\\_")
    .replace(/ /g, "_");

const URL_IN_VALUE = /url\((['"]?)([^'")]+)\1\)/g;

/** Rewrites url(...) through the asset map (local path, or the original URL). */
function rewriteUrls(value, assetPath) {
  return String(value).replace(URL_IN_VALUE, (match, quote, url) => `url('${assetPath(url) || url}')`);
}

/* ============================ breakpoints ============================ */

/**
 * Widths to measure: 375px, then each main breakpoint of the site (at most
 * five, the most used). The layout cannot change between two breakpoints,
 * so measuring at each one reproduces every range; only fluid units (vw,
 * clamp) move in between. Without breakpoints, the standard four widths.
 */
export function cloneWidths(breakpoints = [], base = CLONE_WIDTHS[0]) {
  const inRange = breakpoints.filter((bp) => bp.px > base && bp.px <= 1600);
  if (inRange.length === 0) return [...CLONE_WIDTHS];
  const chosen = [...inRange].sort((a, b) => b.count - a.count || a.px - b.px).slice(0, 5).map((bp) => bp.px).sort((a, b) => a - b);
  // Two control widths share an interval with a measured one: a value that
  // differs between them is fluid (clamp, vw), not a breakpoint step.
  const widths = [base, ...chosen];
  if (chosen[0] - base >= 120) widths.splice(1, 0, Math.round((base + chosen[0]) / 2));
  widths.push(Math.min(chosen[chosen.length - 1] + 200, 1920));
  return widths;
}

/**
 * Heights tied to the viewport height: measured at several viewport heights,
 * a value that keeps its offset (100vh - 92px) or its ratio (80vh) becomes
 * that formula. Samples without a px value (content-driven) stay as they are.
 */
export function viewportHeightFit(vhs, values) {
  const points = [];
  values.forEach((value, i) => {
    const match = typeof value === "string" && value.match(/^(-?\d+(?:\.\d+)?)px$/);
    if (match) points.push([vhs[i], Number(match[1]), i]);
  });
  if (points.length < 2 || new Set(points.map((p) => p[0])).size < 2) return null;
  const offsets = points.map(([vh, v]) => v - vh);
  const ratios = points.map(([vh, v]) => v / vh);
  let formula = null;
  if (constant(ratios, 0.004)) formula = `${Math.round(ratios[0] * 1000) / 10}vh`;
  else if (constant(offsets, 1.5)) {
    const offset = Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length);
    formula = offset === 0 ? "100vh" : `calc(100vh ${offset < 0 ? "-" : "+"} ${Math.abs(offset)}px)`;
  }
  if (!formula) return null;
  const out = [...values];
  for (const [, , i] of points) out[i] = formula;
  return out;
}

const FLUID_PROPS = new Set([
  "font-size", "line-height", "letter-spacing", "width", "max-width", "height", "min-height", "row-gap", "column-gap",
  "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "top", "right", "bottom", "left", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"
]);

/**
 * A px value that moves with the viewport inside one breakpoint interval is
 * fluid: rebuilt as clamp(min, calc(a·vw + b), max) when one line fits every
 * measure within 0.6px. `xs` are the layout widths, `breakpoints` the site's.
 */
export function fluidFit(xs, values, breakpoints = []) {
  const points = [];
  for (let i = 0; i < values.length; i++) {
    const match = typeof values[i] === "string" && values[i].match(/^(-?\d+(?:\.\d+)?)px$/);
    if (!match) return null;
    points.push([xs[i], Number(match[1])]);
  }
  if (points.length < 3) return null;
  const interval = (x) => breakpoints.filter((bp) => bp <= x).length;
  const evidence = points.some(([x1, v1], i) => points.some(([x2, v2], j) => j > i && x1 !== x2 && interval(x1) === interval(x2) && Math.abs(v1 - v2) > 0.5));
  if (!evidence) return null;
  const lo = Math.min(...points.map((p) => p[1]));
  const hi = Math.max(...points.map((p) => p[1]));
  const clamp = (v) => Math.min(hi, Math.max(lo, v));
  let best = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const [x1, v1] = points[i];
      const [x2, v2] = points[j];
      if (x1 === x2 || v1 === v2) continue;
      const a = (v2 - v1) / (x2 - x1);
      const b = v1 - a * x1;
      const error = Math.max(...points.map(([x, v]) => Math.abs(clamp(a * x + b) - v)));
      if (error <= 0.6 && (!best || error < best.error)) best = { a, b, error };
    }
  }
  if (!best) return null;
  const slope = Math.round(best.a * 100 * 10000) / 10000;
  const intercept = Math.round(best.b * 100) / 100;
  const core = `calc(${slope}vw ${intercept < 0 ? "-" : "+"} ${Math.abs(intercept)}px)`;
  const bounded = points.some(([x]) => best.a * x + best.b < lo - 0.3 || best.a * x + best.b > hi + 0.3);
  return bounded ? `clamp(${lo}px, ${core}, ${hi}px)` : core;
}

/**
 * One Tailwind breakpoint per measured width after the first. Each picks the
 * site's most used breakpoint between the previous width and this one (the
 * layout can only change there), or the width itself when the CSS has none.
 */
export function planScreens(widths, breakpoints = []) {
  const chosen = [];
  for (let i = 1; i < widths.length; i++) {
    const inside = breakpoints.filter((bp) => bp.px > widths[i - 1] && bp.px <= widths[i]).sort((a, b) => b.count - a.count || b.px - a.px);
    chosen.push(inside[0]?.px ?? widths[i]);
  }
  const screens = [];
  let from = 0;
  chosen.forEach((px, index) => {
    const reserve = chosen.length - index - 1;
    const options = NAMES.slice(from, NAMES.length - reserve);
    const best = options.reduce((a, b) => (Math.abs(b[1] - px) < Math.abs(a[1] - px) ? b : a));
    from = NAMES.indexOf(best) + 1;
    screens.push({ name: best[0], px, fromSite: breakpoints.some((bp) => bp.px === px) });
  });
  return screens;
}

/* ============================ class names ============================ */

const KEYWORDS = {
  display: { block: "block", inline: "inline", "inline-block": "inline-block", flex: "flex", "inline-flex": "inline-flex", grid: "grid", "inline-grid": "inline-grid", none: "hidden", contents: "contents", "list-item": "list-item", "flow-root": "flow-root", table: "table", "table-row": "table-row", "table-cell": "table-cell" },
  position: { static: "static", relative: "relative", absolute: "absolute", fixed: "fixed", sticky: "sticky" },
  "flex-direction": { row: "flex-row", column: "flex-col", "row-reverse": "flex-row-reverse", "column-reverse": "flex-col-reverse" },
  "flex-wrap": { wrap: "flex-wrap", nowrap: "flex-nowrap", "wrap-reverse": "flex-wrap-reverse" },
  "justify-content": { "flex-start": "justify-start", start: "justify-start", "flex-end": "justify-end", end: "justify-end", center: "justify-center", "space-between": "justify-between", "space-around": "justify-around", "space-evenly": "justify-evenly", stretch: "justify-stretch", normal: "justify-normal" },
  "align-items": { "flex-start": "items-start", start: "items-start", "flex-end": "items-end", end: "items-end", center: "items-center", baseline: "items-baseline", stretch: "items-stretch" },
  "align-content": { center: "content-center", "flex-start": "content-start", start: "content-start", "flex-end": "content-end", end: "content-end", "space-between": "content-between", "space-around": "content-around", "space-evenly": "content-evenly", stretch: "content-stretch", normal: "content-normal" },
  "align-self": { auto: "self-auto", "flex-start": "self-start", start: "self-start", "flex-end": "self-end", end: "self-end", center: "self-center", stretch: "self-stretch", baseline: "self-baseline" },
  "justify-items": { start: "justify-items-start", end: "justify-items-end", center: "justify-items-center", stretch: "justify-items-stretch" },
  "justify-self": { auto: "justify-self-auto", start: "justify-self-start", end: "justify-self-end", center: "justify-self-center", stretch: "justify-self-stretch" },
  "text-align": { left: "text-left", center: "text-center", right: "text-right", justify: "text-justify", start: "text-start", end: "text-end" },
  "text-transform": { uppercase: "uppercase", lowercase: "lowercase", capitalize: "capitalize", none: "normal-case" },
  "font-style": { italic: "italic", normal: "not-italic" },
  "text-decoration-line": { underline: "underline", "line-through": "line-through", overline: "overline", none: "no-underline" },
  "white-space": { normal: "whitespace-normal", nowrap: "whitespace-nowrap", pre: "whitespace-pre", "pre-line": "whitespace-pre-line", "pre-wrap": "whitespace-pre-wrap", "break-spaces": "whitespace-break-spaces" },
  "word-break": { "break-all": "break-all", "keep-all": "break-keep", normal: "break-normal" },
  "text-overflow": { ellipsis: "text-ellipsis", clip: "text-clip" },
  "text-wrap-style": { balance: "text-balance", pretty: "text-pretty" },
  "box-sizing": { "border-box": "box-border", "content-box": "box-content" },
  float: { left: "float-left", right: "float-right", none: "float-none" },
  clear: { left: "clear-left", right: "clear-right", both: "clear-both", none: "clear-none" },
  "object-fit": { contain: "object-contain", cover: "object-cover", fill: "object-fill", none: "object-none", "scale-down": "object-scale-down" },
  visibility: { visible: "visible", hidden: "invisible", collapse: "collapse" },
  isolation: { isolate: "isolate", auto: "isolation-auto" },
  "pointer-events": { none: "pointer-events-none", auto: "pointer-events-auto" },
  "user-select": { none: "select-none", text: "select-text", all: "select-all", auto: "select-auto" },
  cursor: { pointer: "cursor-pointer", default: "cursor-default", text: "cursor-text", "not-allowed": "cursor-not-allowed", grab: "cursor-grab", move: "cursor-move", help: "cursor-help", wait: "cursor-wait", auto: "cursor-auto" },
  "grid-auto-flow": { row: "grid-flow-row", column: "grid-flow-col", "row dense": "grid-flow-row-dense", "column dense": "grid-flow-col-dense", dense: "grid-flow-dense" },
  "background-repeat": { "no-repeat": "bg-no-repeat", repeat: "bg-repeat", "repeat-x": "bg-repeat-x", "repeat-y": "bg-repeat-y", round: "bg-repeat-round", space: "bg-repeat-space" },
  "background-size": { cover: "bg-cover", contain: "bg-contain", auto: "bg-auto" },
  "border-collapse": { collapse: "border-collapse", separate: "border-separate" },
  "table-layout": { fixed: "table-fixed", auto: "table-auto" },
  "list-style-position": { inside: "list-inside", outside: "list-outside" },
  "flex-grow": { 0: "grow-0", 1: "grow" },
  "flex-shrink": { 0: "shrink-0", 1: "shrink" }
};

const PREFIX = {
  "z-index": "z", top: "top", right: "right", bottom: "bottom", left: "left",
  width: "w", height: "h", "min-width": "min-w", "max-width": "max-w", "min-height": "min-h", "max-height": "max-h",
  "margin-top": "mt", "margin-right": "mr", "margin-bottom": "mb", "margin-left": "ml",
  "padding-top": "pt", "padding-right": "pr", "padding-bottom": "pb", "padding-left": "pl",
  "font-size": "text", "line-height": "leading", "letter-spacing": "tracking", "text-indent": "indent",
  "background-color": "bg", color: "text", opacity: "opacity", "box-shadow": "shadow", "transform-origin": "origin",
  "flex-basis": "basis", order: "order", "row-gap": "gap-y", "column-gap": "gap-x", "grid-auto-columns": "auto-cols", "grid-auto-rows": "auto-rows",
  "aspect-ratio": "aspect", "column-count": "columns", "text-decoration-color": "decoration", "text-underline-offset": "underline-offset",
  "border-top-left-radius": "rounded-tl", "border-top-right-radius": "rounded-tr", "border-bottom-right-radius": "rounded-br", "border-bottom-left-radius": "rounded-bl",
  "border-top-width": "border-t", "border-right-width": "border-r", "border-bottom-width": "border-b", "border-left-width": "border-l",
  "border-top-color": "border-t", "border-right-color": "border-r", "border-bottom-color": "border-b", "border-left-color": "border-l",
  "grid-template-columns": "grid-cols"
};
const AUTO_KEYWORD = { width: "w-auto", height: "h-auto", "max-width": "max-w-none", "max-height": "max-h-none", "box-shadow": "shadow-none" };
const WEIGHTS = { 100: "font-thin", 200: "font-extralight", 300: "font-light", 400: "font-normal", 500: "font-medium", 600: "font-semibold", 700: "font-bold", 800: "font-extrabold", 900: "font-black" };
const COLOR_PROPS = new Set(["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "text-decoration-color"]);
const SIDES = ["top", "right", "bottom", "left"];

/** One declaration → one class (no variant). */
export function classFor(prop, rawValue, tokens = {}) {
  if (KEYWORD_VALUE.test(rawValue)) return `[${prop}:${rawValue}]`;
  // Already escaped by contentValue().
  if (prop === "content") return `content-[${rawValue}]`;
  const value = normalizeValue(rawValue);
  const keyword = KEYWORDS[prop]?.[value];
  if (keyword) return keyword;
  if (prop === "font-weight" && WEIGHTS[value]) return WEIGHTS[value];
  if (prop === "font-family" && tokens.fonts?.[rawValue]) return `font-${tokens.fonts[rawValue]}`;
  if (COLOR_PROPS.has(prop) && tokens.colors?.[value]) return `${PREFIX[prop]}-${tokens.colors[value]}`;
  if (prop === "grid-template-columns") {
    const repeat = value.match(/^repeat\((\d+),minmax\(0,1fr\)\)$/);
    if (repeat) return `grid-cols-${repeat[1]}`;
  }
  if (value === "auto" && AUTO_KEYWORD[prop]) return AUTO_KEYWORD[prop];
  if (value === "100%" && (prop === "width" || prop === "height")) return `${PREFIX[prop]}-full`;
  if (value === "auto" && /^margin-/.test(prop)) return `${PREFIX[prop]}-auto`;
  if (prop === "aspect-ratio" && /^\d+(\.\d+)? ?\/ ?\d+(\.\d+)?$/.test(value)) return `aspect-[${value.replace(/ /g, "")}]`;
  const prefix = PREFIX[prop];
  // Keywords on length utilities stay explicit properties.
  if (prefix && !/^(auto|none|normal|initial|unset)$/.test(value)) return `${prefix}-[${arbitrary(value)}]`;
  return `[${prop}:${arbitrary(value)}]`;
}

// Four sides collapse only when all are set to the same, non-keyword value.
const same = (map, props) => props.every((prop) => prop in map) && props.every((prop) => map[prop] === map[props[0]]) && !KEYWORD_VALUE.test(map[props[0]]);

/** A declaration map → classes, with side shorthands collapsed. */
export function classesFor(map, tokens = {}) {
  const decls = { ...map };
  const out = [];
  const take = (props) => {
    for (const prop of props) delete decls[prop];
  };
  for (const [box, short] of [["padding", "p"], ["margin", "m"]]) {
    const [t, r, b, l] = SIDES.map((side) => `${box}-${side}`);
    if (same(decls, [t, r, b, l])) {
      out.push(classFor(t, decls[t], tokens).replace(/^mt-|^pt-/, `${short}-`));
      take([t, r, b, l]);
    } else {
      if (same(decls, [t, b])) {
        out.push(classFor(t, decls[t], tokens).replace(/^mt-|^pt-/, `${short}y-`));
        take([t, b]);
      }
      if (same(decls, [l, r])) {
        out.push(classFor(l, decls[l], tokens).replace(/^ml-|^pl-/, `${short}x-`));
        take([l, r]);
      }
    }
  }
  const widths = SIDES.map((side) => `border-${side}-width`);
  if (same(decls, widths)) {
    out.push(`border-[${arbitrary(decls[widths[0]])}]`);
    take(widths);
  }
  const styles = SIDES.map((side) => `border-${side}-style`);
  if (same(decls, styles)) {
    const style = decls[styles[0]];
    out.push(/^(solid|dashed|dotted|double|none|hidden)$/.test(style) ? `border-${style}` : `[border-style:${style}]`);
    take(styles);
  }
  const colors = SIDES.map((side) => `border-${side}-color`);
  if (same(decls, colors)) {
    const value = normalizeValue(decls[colors[0]]);
    out.push(tokens.colors?.[value] ? `border-${tokens.colors[value]}` : `border-[${arbitrary(value)}]`);
    take(colors);
  }
  const radii = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];
  if (same(decls, radii)) {
    out.push(`rounded-[${arbitrary(decls[radii[0]])}]`);
    take(radii);
  }
  if (same(decls, ["overflow-x", "overflow-y"])) {
    const value = decls["overflow-x"];
    out.push(/^(visible|hidden|clip|scroll|auto)$/.test(value) ? `overflow-${value}` : `[overflow:${value}]`);
    take(["overflow-x", "overflow-y"]);
  }
  for (const axis of ["x", "y"]) {
    const prop = `overflow-${axis}`;
    if (prop in decls && /^(visible|hidden|clip|scroll|auto)$/.test(decls[prop])) {
      out.push(`overflow-${axis}-${decls[prop]}`);
      take([prop]);
    }
  }
  if (same(decls, ["row-gap", "column-gap"])) {
    out.push(`gap-[${arbitrary(decls["row-gap"])}]`);
    take(["row-gap", "column-gap"]);
  }
  if (same(decls, ["top", "right", "bottom", "left"]) && decls.top !== "auto") {
    out.push(`inset-[${arbitrary(decls.top)}]`);
    take(["top", "right", "bottom", "left"]);
  }
  for (const [prop, value] of Object.entries(decls)) out.push(classFor(prop, value, tokens));
  return out;
}

/* ============================== sizing ============================== */

const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;
const constant = (values, tolerance = 1.5) => values.length > 0 && values.every((v) => near(v, values[0], tolerance));
const pct = (n) => `${Math.round(n * 10000) / 100}%`;
const pxv = (n) => `${Math.round(n * 10) / 10}px`;
const REPLACED = new Set(["img", "video", "iframe", "canvas", "svg", "input", "select", "textarea", "embed", "picture", "audio"]);

/**
 * Width and height for one element at each sample, from its measures
 * across all samples. Returns per-sample maps of synthetic declarations
 * (width, max-width, height, min-height, offsets, auto margins).
 */
export function sizeDeclarations(tag, samples) {
  const out = samples.map(() => ({}));
  const on = samples.map((s, i) => (s && s.m && s.m.v ? i : -1)).filter((i) => i >= 0);
  if (on.length === 0) return out;
  const M = (i) => samples[i].m;
  const D = (i) => samples[i].d || {};
  const display = (i) => D(i).display || (/^(span|a|strong|em|b|i|small|code|label|abbr|sub|sup|mark|time|q|cite|s|u)$/.test(tag) || tag === "::before" || tag === "::after" ? "inline" : "block");
  const position = (i) => D(i).position || "static";
  const set = (i, prop, value) => {
    out[i][prop] = value;
  };
  const per = (fn) => on.forEach(fn);

  // Pseudo-elements: no box to measure, the computed sizes are what was set.
  if (tag === "::before" || tag === "::after") {
    per((i) => {
      const m = M(i);
      if (/px$|%$/.test(m.w || "")) set(i, "width", m.w);
      if (/px$|%$/.test(m.h || "")) set(i, "height", m.h);
      if (/^(absolute|fixed)$/.test(position(i)) && Array.isArray(m.off)) {
        SIDES.forEach((side, k) => {
          if (m.off[k] !== "auto") set(i, side, m.off[k]);
        });
      }
    });
    return out;
  }

  const inline = (i) => display(i) === "inline" && !REPLACED.has(tag);
  if (on.every(inline)) return out;
  const replaced = REPLACED.has(tag);
  const positioned = (i) => /^(absolute|fixed)$/.test(position(i));
  const boxParent = (i) => /flex|grid/.test(M(i).pd || "");
  // Width not set: the browser's auto width (measured by the probe) matches.
  const shrinkW = (i) => (M(i).nw !== undefined ? near(M(i).cw, M(i).nw) : near(M(i).cw, M(i).ew ?? -99));
  const shrinkH = (i) => near(M(i).ch, M(i).eh ?? -99);
  // width/height apply to the content box unless box-sizing says otherwise.
  const borderBox = (i) => (M(i).bs || D(i)["box-sizing"]) === "border-box";
  const bw = (i) => (borderBox(i) ? M(i).w : M(i).cw);
  const bh = (i) => (borderBox(i) ? M(i).h : M(i).ch);

  // ---- horizontal
  const widths = on.map(bw);
  const ratios = on.map((i) => (M(i).pw ? bw(i) / M(i).pw : 0));
  const parentsDiffer = !constant(on.map((i) => M(i).pw), 2);
  const fixedWidth = constant(widths);
  const ratioWidth = parentsDiffer && constant(ratios, 0.015) && !near(ratios[0], 1, 0.005);
  // A share of the parent that is a simple fraction (grid columns: 1/2,
  // 1/3, 5/12...) stays a percentage, right at every width.
  const cleanFraction = (ratio) => {
    for (let n = 2; n <= 12; n++) {
      const k = Math.round(ratio * n);
      if (k > 0 && k < n && Math.abs(ratio - k / n) < 0.003) return k / n;
    }
    return null;
  };
  const widthFor = (i, k) => {
    if (ratioWidth) return pct(ratios[0]);
    if (fixedWidth) return pxv(widths[0]);
    if (near(bw(i), M(i).pw)) return "100%";
    const fraction = M(i).pw ? cleanFraction(bw(i) / M(i).pw) : null;
    return fraction ? pct(fraction) : pxv(bw(i));
  };

  if (on.some(positioned)) {
    const cbw = on.map((i) => M(i).cb?.[0] || M(i).pw);
    const cbh = on.map((i) => M(i).cb?.[1] || M(i).ph);
    const off = (k) => on.map((i) => M(i).off?.[k] ?? 0);
    const axis = (startK, endK, sizes, boxes, sizeProp, shrink) => {
      const start = off(startK);
      const end = off(endK);
      const startConst = constant(start);
      const endConst = constant(end);
      const startProp = SIDES[startK];
      const endProp = SIDES[endK];
      on.forEach((i, k) => {
        if (!positioned(i)) return;
        if (startConst) set(i, startProp, pxv(start[0]));
        else if (endConst) set(i, endProp, pxv(end[0]));
        else if (constant(start.map((v, n) => v / (boxes[n] || 1)), 0.01)) set(i, startProp, pct(start[0] / (boxes[0] || 1)));
        else set(i, startProp, pxv(start[k]));
        if (startConst && endConst && !constant(sizes)) {
          set(i, endProp, pxv(end[0]));
          return;
        }
        if (replaced || !shrink(i)) {
          if (constant(sizes)) set(i, sizeProp, pxv(sizes[0]));
          else if (constant(sizes.map((v, n) => v / (boxes[n] || 1)), 0.01)) set(i, sizeProp, pct(sizes[0] / (boxes[0] || 1)));
          else set(i, sizeProp, pxv(sizes[k]));
        }
      });
    };
    axis(3, 1, widths, cbw, "width", shrinkW);
    axis(0, 2, on.map(bh), cbh, "height", shrinkH);
    // Relative/sticky siblings of these samples keep their offsets below.
  }

  on.forEach((i, k) => {
    const m = M(i);
    if (positioned(i)) return;
    // Relative and sticky: offsets that are not zero.
    if (/^(relative|sticky)$/.test(position(i)) && Array.isArray(m.off)) {
      SIDES.forEach((side, n) => {
        if (m.off[n] && !m.offAuto?.[n]) set(i, side, pxv(m.off[n]));
      });
    }
    if (inline(i)) return;
    const disp = display(i);
    if (replaced) {
      set(i, "width", widthFor(i, k));
      // Images keep their proportions unless the page distorts them.
      const ratio = m.nat && m.nat[0] && m.nat[1] ? m.nat[0] / m.nat[1] : null;
      if (ratio && m.h && near(m.w / m.h, ratio, 0.02)) set(i, "height", "auto");
      else set(i, "height", pxv(bh(i)));
      return;
    }
    const flexItem = /flex/.test(m.pd || "");
    const gridItem = /grid/.test(m.pd || "");
    const row = !/column/.test(m.pfd || "row");
    const grows = Number(D(i)["flex-grow"] || 0) > 0 || (D(i)["flex-basis"] && D(i)["flex-basis"] !== "auto");
    // Width
    if (flexItem) {
      const mainAxis = row;
      if (mainAxis ? !grows && !shrinkW(i) : !m.st && !shrinkW(i)) set(i, "width", widthFor(i, k));
    } else if (gridItem) {
      if (!m.st && !shrinkW(i)) set(i, "width", widthFor(i, k));
    } else if (/inline-|table/.test(disp) || D(i).float) {
      if (!shrinkW(i)) set(i, "width", widthFor(i, k));
    } else {
      // Block in flow. Margins that follow the parent are auto (a centered
      // capped box); margins that never move are fixed and the width is auto.
      const fills = (n) => near(M(n).w + (M(n).ml || 0) + (M(n).mr || 0), M(n).pw);
      const fixedMargins = constant(on.map((n) => M(n).ml || 0)) && constant(on.map((n) => M(n).mr || 0));
      const centered = on.some((n) => M(n).ce) && (!fixedMargins || !parentsDiffer);
      // Full bleed: equal negative margins that take the box to the viewport edges.
      const bleed = (m.ml || 0) < -0.5 && near(m.ml, m.mr || 0) && m.vw && near(m.w, m.vw, 2);
      if (bleed) {
        set(i, "margin-left", "calc(50% - 50vw)");
        set(i, "margin-right", "calc(50% - 50vw)");
      } else if (centered) {
        const capped = on.filter((n) => (M(n).ml || 0) > 0.5).map(bw);
        set(i, "max-width", pxv(capped.length ? Math.max(...capped) : bw(i)));
        set(i, "margin-left", "auto");
        set(i, "margin-right", "auto");
      } else if (!fills(i)) {
        if (ratioWidth) set(i, "width", pct(ratios[0]));
        else set(i, "max-width", pxv(bw(i)));
      }
    }
    // Height
    const stretched = (flexItem && row && m.st) || (gridItem && m.st);
    const mainHeight = flexItem && !row && grows;
    if (stretched || mainHeight || disp === "contents" || D(i)["aspect-ratio"]) return;
    const empty = !(m.ew || m.eh);
    const viewportRatio = on.map((n) => bh(n) / (M(n).vh || 1));
    const tall = constant(viewportRatio, 0.01) && viewportRatio[0] >= 0.5 && !constant(on.map(bh));
    // The browser's natural height when the probe measured it, else the text extent.
    const natural = m.nh ?? (m.eh || 0);
    // Shorter than its content: a fixed height, clipped or overflowing visibly.
    const clipped = natural > m.ch + 1.5 && (m.nh !== undefined || /hidden|clip|auto|scroll/.test(D(i)["overflow-y"] || ""));
    if (empty) {
      set(i, "height", tall ? `${Math.round(viewportRatio[0] * 100)}vh` : pxv(bh(i)));
    } else if (clipped) {
      set(i, "height", tall ? `${Math.round(viewportRatio[0] * 100)}vh` : pxv(bh(i)));
    } else if (m.ch > natural + 1.5 && !D(i)["min-height"]) {
      set(i, "min-height", tall ? `${Math.round(viewportRatio[0] * 100)}vh` : pxv(bh(i)));
    }
  });
  return out;
}

/**
 * Track list per sample: fixed tracks stay in px, tracks that follow the
 * container become fr, equal flexible tracks become repeat(n, 1fr).
 */
export function gridColumns(samples) {
  const out = samples.map(() => null);
  const groups = new Map();
  samples.forEach((s, i) => {
    const tracks = s?.m?.v && s.m.tracks;
    if (!tracks || tracks.length === 0) return;
    if (!groups.has(tracks.length)) groups.set(tracks.length, []);
    groups.get(tracks.length).push(i);
  });
  for (const [count, indexes] of groups) {
    const fill = (i) => near(samples[i].m.tracks.reduce((a, b) => a + b, 0) + (count - 1) * (samples[i].m.gap || 0), samples[i].m.cw, 2);
    const varying = Array.from({ length: count }, (_, k) => indexes.length > 1 ? !constant(indexes.map((i) => samples[i].m.tracks[k])) : fill(indexes[0]));
    for (const i of indexes) {
      const tracks = samples[i].m.tracks;
      if (!varying.some(Boolean)) {
        out[i] = tracks.map(pxv).join(" ");
        continue;
      }
      const flexible = tracks.filter((_, k) => varying[k]);
      if (varying.every(Boolean) && constant(flexible, 1)) {
        out[i] = `repeat(${count},minmax(0,1fr))`;
        continue;
      }
      const smallest = Math.min(...flexible);
      out[i] = tracks.map((track, k) => (varying[k] ? `minmax(0,${Math.round((track / smallest) * 100) / 100}fr)` : pxv(track))).join(" ");
    }
  }
  return out;
}

/* ========================= per-node variants ========================= */

/**
 * Declarations of one node at every sample (computed + synthetic sizes),
 * with samples where the node is not rendered filled from its neighbours.
 */
function declarationsBySample(node, samples, fluid = null) {
  const sizes = sizeDeclarations(node.tag, samples);
  const grid = gridColumns(samples);
  const props = new Set();
  const rows = samples.map((s, i) => {
    if (!s) return null;
    if (!s.m.v) return s.d?.display === "none" ? { display: "none" } : null;
    const row = { ...s.d, ...sizes[i] };
    delete row.content;
    if (grid[i]) row["grid-template-columns"] = grid[i];
    else delete row["grid-template-columns"];
    return row;
  });
  for (const row of rows) if (row) for (const prop of Object.keys(row)) props.add(prop);
  const values = {};
  for (const prop of props) {
    const list = rows.map((row) => {
      if (!row) return SKIPPED;
      if (row.display === "none" && Object.keys(row).length === 1) return prop === "display" ? "none" : SKIPPED;
      return prop in row ? row[prop] : DEFAULT;
    });
    // Fill samples where the node is hidden by an ancestor.
    for (let i = 1; i < list.length; i++) if (list[i] === SKIPPED) list[i] = list[i - 1];
    for (let i = list.length - 2; i >= 0; i--) if (list[i] === SKIPPED) list[i] = list[i + 1];
    values[prop] = list.map((value) => (value === SKIPPED ? DEFAULT : value));
    // Heights that follow the viewport height (100vh - header).
    if (fluid?.vhs && (prop === "height" || prop === "min-height")) {
      const tied = viewportHeightFit(fluid.vhs, values[prop]);
      if (tied) {
        values[prop] = tied;
        continue;
      }
    }
    // One fluid formula replaces per-breakpoint px steps.
    if (fluid && FLUID_PROPS.has(prop)) {
      const formula = fluidFit(fluid.xs, values[prop], fluid.breakpoints);
      if (formula) values[prop] = values[prop].map(() => formula);
    }
  }
  return values;
}

/** Mobile-first maps: base, then only what changes at each breakpoint. */
export function variantMaps(values, sampleCount) {
  const maps = Array.from({ length: sampleCount }, () => ({}));
  for (const [prop, list] of Object.entries(values)) {
    if (list[0] !== DEFAULT) maps[0][prop] = list[0];
    for (let i = 1; i < sampleCount; i++) {
      if (list[i] !== list[i - 1]) maps[i][prop] = list[i] === DEFAULT ? "revert" : list[i];
    }
  }
  return maps;
}

export function classNameFor(maps, screens, tokens, pseudo = "") {
  const parts = [];
  maps.forEach((map, i) => {
    const prefix = `${i === 0 ? "" : `${screens[i - 1].name}:`}${pseudo}`;
    for (const cls of classesFor(map, tokens)) parts.push(prefix + cls);
  });
  return parts.join(" ");
}

/* ============================== tokens ============================== */

const slug = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export const familyNames = (stack) =>
  String(stack || "")
    .split(",")
    .map((name) => name.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

/** Font stacks and recurring colors become @theme tokens (font-*, bg-*, text-*). */
export function buildTokens(allValues) {
  const fontCount = new Map();
  const colorCount = new Map();
  const textCount = new Map();
  const bgCount = new Map();
  for (const values of allValues) {
    for (const [prop, list] of Object.entries(values)) {
      for (const value of list) {
        if (value === DEFAULT || value === "revert") continue;
        if (prop === "font-family") fontCount.set(value, (fontCount.get(value) || 0) + 1);
        if (COLOR_PROPS.has(prop)) {
          const hex = normalizeValue(value);
          if (!/^#[0-9a-f]{6,8}$/.test(hex)) continue;
          colorCount.set(hex, (colorCount.get(hex) || 0) + 1);
          if (prop === "color") textCount.set(hex, (textCount.get(hex) || 0) + 1);
          if (prop === "background-color") bgCount.set(hex, (bgCount.get(hex) || 0) + 1);
        }
      }
    }
  }
  const fonts = {};
  const used = new Set();
  for (const [stack] of [...fontCount.entries()].sort((a, b) => b[1] - a[1])) {
    let name = slug(familyNames(stack)[0]) || "family";
    let n = 2;
    while (used.has(name)) name = `${slug(familyNames(stack)[0])}-${n++}`;
    used.add(name);
    fonts[stack] = name;
  }
  const colors = {};
  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ink = top(textCount);
  // "paper" is a surface: opaque colors only.
  const paper = top(new Map([...bgCount].filter(([hex]) => hex.length === 7)));
  if (ink) colors[ink] = "ink";
  if (paper && paper !== ink) colors[paper] = "paper";
  let tone = 1;
  for (const [hex, count] of [...colorCount.entries()].sort((a, b) => b[1] - a[1])) {
    if (colors[hex] || count < 3 || tone > 16) continue;
    colors[hex] = `tone-${tone++}`;
  }
  return { fonts, colors };
}

/* =============================== fonts =============================== */

/** Font families the measured page actually renders (lowercase). */
export function fontFamiliesUsed(capture) {
  const used = new Set();
  for (const list of capture.measures || []) {
    for (const entry of list) {
      const stack = entry?.m?.v && entry.d?.["font-family"];
      if (stack) for (const name of familyNames(stack)) used.add(name.toLowerCase());
    }
  }
  return used;
}

/** @font-face rules of a stylesheet, URLs made absolute. */
export function parseFontFaces(cssText, sheetUrl) {
  const faces = [];
  for (const block of String(cssText || "").matchAll(/@font-face\s*{([^}]*)}/gi)) {
    const body = block[1];
    const get = (name) => (body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i")) || [])[1]?.trim() || "";
    const family = get("font-family").replace(/^['"]|['"]$/g, "");
    if (!family) continue;
    const srcs = [];
    for (const m of get("src").matchAll(/url\((['"]?)([^'")]+)\1\)\s*(?:format\((['"]?)([^'")]+)\3\))?/g)) {
      let url = m[2];
      try {
        url = new URL(url, sheetUrl || undefined).href;
      } catch (error) {}
      srcs.push({ url, format: m[4] || "" });
    }
    if (srcs.length === 0) continue;
    faces.push({ family, weight: get("font-weight") || "400", style: get("font-style") || "normal", display: get("font-display") || "swap", unicodeRange: get("unicode-range"), srcs });
  }
  return faces;
}

/* =============================== assets =============================== */

function fileNameFor(url, used, fallbackExt) {
  let name = "asset";
  let ext = fallbackExt;
  if (url.startsWith("data:")) {
    const mime = (url.match(/^data:([^;,]+)/) || [])[1] || "";
    ext = { "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "font/woff2": "woff2", "font/woff": "woff" }[mime] || fallbackExt;
    name = "inline";
  } else {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
      const match = last.match(/^(.*?)(?:\.([a-z0-9]{2,5}))?$/i);
      name = slug(match[1]) || "asset";
      if (match[2]) ext = match[2].toLowerCase();
    } catch (error) {}
  }
  let file = `${name}.${ext}`;
  let n = 2;
  while (used.has(file)) file = `${name}-${n++}.${ext}`;
  used.add(file);
  return file;
}

/* ============================ tree + names ============================ */

const VOID = new Set(["img", "input", "br", "hr", "area", "col", "wbr", "embed", "source", "track"]);
const NO_WHITESPACE = /^(table|thead|tbody|tfoot|tr|colgroup|select|optgroup|datalist|ul|ol|dl|picture|video|audio)$/;
const INLINE_TAGS = /^(span|a|strong|em|b|i|small|code|label|abbr|sub|sup|mark|time|q|cite|s|u|img|svg|button|input|select|textarea|br|kbd|var|samp|bdi|bdo|data|dfn|del|ins|wbr)$/;
const REACT_ATTR = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", colspan: "colSpan", rowspan: "rowSpan", maxlength: "maxLength", readonly: "readOnly",
  autocomplete: "autoComplete", allowfullscreen: "allowFullScreen", referrerpolicy: "referrerPolicy", playsinline: "playsInline", autoplay: "autoPlay",
  crossorigin: "crossOrigin", datetime: "dateTime", srcset: "srcSet", novalidate: "noValidate", spellcheck: "spellCheck", value: "defaultValue", checked: "defaultChecked"
};
const BOOLEAN_ATTR = new Set(["muted", "loop", "autoplay", "playsinline", "controls", "disabled", "required", "multiple", "open", "reversed", "allowfullscreen", "checked", "readonly"]);

const pascal = (text) => {
  const words = slug(text).split("-").filter(Boolean).slice(0, 3);
  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return /^[A-Z]/.test(name) ? name : name ? `S${name}` : "";
};

/** Whole-tree model: kept nodes with children, classes, attributes. */
function buildTree(capture, ctx) {
  const { nodes, measures } = capture;
  const sampleCount = measures.length;
  const samplesOf = (index) => measures.map((list) => list[index]);
  const kept = new Array(nodes.length).fill(false);
  const tree = nodes.map((node, index) => ({ ...node, index, children: [] }));
  const allValues = [];
  nodes.forEach((node, index) => {
    if (node.parent >= 0 && !kept[node.parent]) return;
    if (node.k === "t") {
      kept[index] = node.x.length > 0;
      return;
    }
    const samples = samplesOf(index);
    if (!samples.some((s) => s && s.m && s.m.v)) return;
    kept[index] = true;
    tree[index].values = declarationsBySample(node, samples, ctx.fluid);
    tree[index].samples = samples;
    allValues.push(tree[index].values);
    if (node.k === "p") {
      const last = [...samples].reverse().find((s) => s && s.m.v);
      tree[index].content = last?.d?.content || '""';
    }
  });
  for (const node of tree) if (kept[node.index] && node.parent >= 0) tree[node.parent].children.push(node);
  ctx.tokens = buildTokens(allValues);
  // A site-wide `* { box-sizing: border-box }` becomes one global rule
  // instead of a class on every element.
  const boxed = allValues.filter((values) => values["box-sizing"]?.every((value) => value === "border-box")).length;
  ctx.borderBox = allValues.length > 20 && boxed / allValues.length >= 0.8;
  if (ctx.borderBox) {
    for (const values of allValues) {
      const list = (values["box-sizing"] || Array(sampleCount).fill(DEFAULT)).map((value) => (value === "border-box" ? DEFAULT : value === DEFAULT ? "content-box" : value));
      if (list.every((value) => value === DEFAULT)) delete values["box-sizing"];
      else values["box-sizing"] = list;
    }
  }
  const lastDisplay = (node) => {
    const list = node.values?.display;
    return list ? (list[sampleCount - 1] === DEFAULT ? "" : list[sampleCount - 1]) : "";
  };
  // Whitespace between blocks or inside flex/grid renders nothing: drop it.
  for (const node of tree) {
    if (!kept[node.index] || node.k === "t") continue;
    const disp = lastDisplay(node);
    // A space only renders between two inline runs; keep one per run.
    const inlineLevel = (sibling) => sibling.k === "t" || /^inline/.test(lastDisplay(sibling) || (INLINE_TAGS.test(sibling.tag) ? "inline" : "block"));
    const blank = (child) => child.k === "t" && !child.x.trim();
    const kids = node.children.filter((child) => child.k !== "p");
    node.children = node.children.filter((child) => {
      if (!blank(child)) return true;
      if (NO_WHITESPACE.test(node.tag) || /flex|grid/.test(disp)) return false;
      const at = kids.indexOf(child);
      let prev = at - 1;
      while (prev >= 0 && blank(kids[prev])) prev -= 1;
      let next = at + 1;
      while (next < kids.length && blank(kids[next])) next += 1;
      if (prev < 0 || next >= kids.length || !inlineLevel(kids[prev]) || !inlineLevel(kids[next])) return false;
      return prev === at - 1;
    });
  }
  return tree[0];
}

function attrValue(value) {
  return /["{}\n\\&<>]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
}

// Plain JSX text when it is safe; a string expression keeps edge spaces and braces.
function textChild(text) {
  const plain = /^[^{}<>&\s](?:[^{}<>&]*[^{}<>&\s])?$/.test(text) && !/\s{2}/.test(text);
  return plain ? text : `{${JSON.stringify(text)}}`;
}

const camel = (name) => name.replace(/[-:]([a-z])/g, (_, c) => c.toUpperCase());

const SCRIPT_URL = /^\s*(javascript|vbscript|data:text\/html)/i;

function svgAttrs(attrs) {
  const out = [];
  for (const [name, value] of Object.entries(attrs || {})) {
    if (name === "class" || (name === "style" && !value)) continue;
    // Page markup: no event handlers, no odd attribute names, no script URLs.
    if (/^on/i.test(name) || !/^[a-zA-Z_][\w:.-]*$/.test(name)) continue;
    if (/href$/i.test(name) && SCRIPT_URL.test(String(value))) continue;
    if (name.includes(":") && !/^(xlink|xml|xmlns):/.test(name)) continue;
    if (name === "style") {
      const style = {};
      for (const part of value.split(";")) {
        const [key, ...rest] = part.split(":");
        if (key && rest.length) style[camel(key.trim())] = rest.join(":").trim();
      }
      out.push(`style={${JSON.stringify(style)}}`);
      continue;
    }
    const key = /^(data|aria)-/.test(name) ? name : camel(name);
    out.push(`${key}=${attrValue(String(value))}`);
  }
  return out;
}

function printSvg(node, pad) {
  if (node.x !== undefined) return [`${pad}${textChild(node.x)}`];
  const attrs = svgAttrs(node.a);
  const open = `${pad}<${node.t}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  if (!node.c || node.c.length === 0) return [`${open} />`];
  return [`${open}>`, ...node.c.flatMap((child) => printSvg(child, `${pad}  `)), `${pad}</${node.t}>`];
}

// A character Tailwind can carry in content-['…']: anything else becomes a
// CSS escape ended by a space (written "_", which Tailwind turns into a space).
const escapeContent = (text) =>
  [...text]
    .map((ch) => (/[A-Za-z0-9.,:;!?()+*/#%&@=|~^$-]/.test(ch) ? ch : ch === " " ? "_" : `\\${ch.codePointAt(0).toString(16)}_`))
    .join("");

/** A computed `content` value as the argument of Tailwind's content-[…]. */
export function contentValue(content, publicUrl = () => null) {
  const parts = [];
  for (const m of String(content || "").matchAll(/"((?:[^"\\]|\\.)*)"|url\((['"]?)([^'")]+)\2\)|attr\(([^)]+)\)/g)) {
    if (m[3]) parts.push(`url('${publicUrl(m[3]) || m[3]}')`);
    else if (m[4]) parts.push(`attr(${m[4].trim()})`);
    else parts.push(`'${escapeContent(m[1].replace(/\\(.)/g, "$1"))}'`);
  }
  return parts.join("_") || "''";
}

/** Parses a computed `content` value: strings and url() images. */
export function pseudoContent(content) {
  const parts = [];
  for (const m of String(content || "").matchAll(/"((?:[^"\\]|\\.)*)"|url\((['"]?)([^'")]+)\2\)/g)) {
    if (m[3]) parts.push({ image: m[3] });
    else parts.push({ text: m[1].replace(/\\(.)/g, "$1") });
  }
  return parts;
}

/* ============================ the project ============================ */

/**
 * URLs the clone needs (images, backgrounds, video posters, favicon), each
 * with its path in the project. The service worker fetches them, then
 * passes the ones it got back to buildCloneProject().
 */
export function collectCloneAssets(capture, fontFaces = []) {
  const used = new Set();
  const assets = new Map();
  const add = (url, folder, ext) => {
    if (!url || assets.has(url) || /^(blob|about|javascript):/.test(url)) return;
    assets.set(url, { url, path: `public/${folder}/${fileNameFor(url, used, ext)}` });
  };
  capture.nodes.forEach((node, index) => {
    if (node.k === "e") {
      if (node.tag === "img" && node.a?.src) add(node.a.src, "assets", "png");
      if (node.tag === "video" && node.a?.poster) add(node.a.poster, "assets", "jpg");
    }
    for (const list of capture.measures) {
      const entry = list[index];
      if (!entry || !entry.m?.v) continue;
      const image = entry.d?.["background-image"];
      if (image) for (const m of image.matchAll(URL_IN_VALUE)) add(m[2], "assets", "png");
      if (entry.d?.content) for (const part of pseudoContent(entry.d.content)) if (part.image) add(part.image, "assets", "png");
    }
  });
  if (capture.icon) add(capture.icon, "assets", "ico");
  for (const face of fontFaces) {
    const src = face.srcs.find((s) => /woff2/.test(s.format) || /\.woff2(\?|$)/i.test(s.url)) || face.srcs[0];
    add(src.url, "fonts", "woff2");
  }
  return [...assets.values()];
}

function cssRule(selector, maps, screens, toCss) {
  const blocks = [];
  maps.forEach((map, i) => {
    const decls = Object.entries(map).map(([prop, value]) => `  ${prop}: ${toCss(prop, value)};`);
    if (decls.length === 0) return;
    const rule = `${selector} {\n${decls.join("\n")}\n}`;
    blocks.push(i === 0 ? rule : `@media (width >= ${screens[i - 1].px / 16}rem) {\n${rule.replace(/^/gm, "  ")}\n}`);
  });
  return blocks.join("\n\n");
}

/**
 * The project files. `assetPaths` maps each asset URL fetched by the
 * service worker to its project path; URLs it could not get stay remote.
 */
export function buildCloneProject(capture, { breakpoints = [], fontFaces = [], assetPaths = new Map(), widths = CLONE_WIDTHS } = {}) {
  const screens = planScreens(widths, breakpoints);
  const ctx = { fluid: { xs: capture.widths || widths, vhs: capture.measures.map((list) => list[0]?.m?.vh), breakpoints: breakpoints.map((bp) => bp.px) } };
  const root = buildTree(capture, ctx);
  const tokens = ctx.tokens;
  const publicUrl = (url) => {
    const path = assetPaths.get(url);
    return path ? `/${path.replace(/^public\//, "")}` : null;
  };
  const sampleCount = capture.measures.length;
  let host = "site";
  try {
    host = new URL(capture.url).hostname.replace(/^www\./, "");
  } catch (error) {}

  const mapsOf = (node) => {
    const maps = variantMaps(node.values || {}, sampleCount);
    for (const map of maps) {
      if (map["background-image"]) map["background-image"] = rewriteUrls(map["background-image"], publicUrl);
    }
    return maps;
  };
  // ::before / ::after become before: / after: classes on their element.
  const classOf = (node) => {
    if (node.className !== undefined) return node.className;
    const parts = [classNameFor(mapsOf(node), screens, tokens)];
    for (const pseudo of node.children || []) {
      if (pseudo.k !== "p") continue;
      const maps = mapsOf(pseudo);
      maps[0] = { content: contentValue(pseudo.content, publicUrl), ...maps[0] };
      parts.push(classNameFor(maps, screens, tokens, `${pseudo.tag.slice(2)}:`));
    }
    node.className = parts.filter(Boolean).join(" ");
    return node.className;
  };

  // ---------- JSX
  const printNode = (node, pad, slots) => {
    if (node.k === "t") {
      const slot = slots?.get(node);
      return [`${pad}${slot ? `{${slot}}` : textChild(node.x)}`];
    }
    if (node.component && !slots) return [`${pad}<${node.component} />`];
    // A heading and its run of siblings: a fragment in its own file.
    if (node.k === "g") return [`${pad}<>`, ...node.children.flatMap((child) => printNode(child, `${pad}  `, slots)), `${pad}</>`];
    if (node.repeat && !slots) {
      const { name, data } = node.repeat;
      return [`${pad}{${data}.map((item, index) => (`, `${pad}  <${name} key={index} {...item} />`, `${pad}))}`];
    }
    const className = classOf(node);
    const classAttr = className ? (className.includes("\\") ? `className={String.raw\`${className}\`}` : `className="${className}"`) : "";
    if (node.k === "p") return [];
    if (node.tag === "svg" && node.svg) {
      const svg = { ...node.svg, a: { ...node.svg.a } };
      delete svg.a.class;
      delete svg.a.style;
      const lines = printSvg(svg, pad);
      if (classAttr) lines[0] = lines[0].replace(/^(\s*<svg)/, `$1 ${classAttr}`);
      return lines;
    }
    const attrs = [];
    if (classAttr) attrs.push(classAttr);
    for (const [name, raw] of Object.entries(node.a || {})) {
      if (raw === undefined || name === "hidden") continue;
      if ((name === "href" || name === "src") && SCRIPT_URL.test(String(raw))) continue;
      const slot = slots?.get(`${node.index}:${name}`);
      let value = raw;
      if ((name === "src" || name === "poster") && raw) value = publicUrl(raw) || raw;
      const key = REACT_ATTR[name] || name;
      if (slot) attrs.push(`${key}={${slot}}`);
      else if (BOOLEAN_ATTR.has(name) && (value === "" || value === name)) attrs.push(key);
      else attrs.push(`${key}=${attrValue(String(value))}`);
    }
    if (node.tag === "img" && !("alt" in (node.a || {}))) attrs.push('alt=""');
    const open = `${pad}<${node.tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
    if (VOID.has(node.tag) || node.children.every((child) => child.k === "p")) return [`${open} />`];
    return [`${open}>`, ...node.children.flatMap((child) => printNode(child, `${pad}  `, slots)), `${pad}</${node.tag}>`];
  };

  // ---------- repeated siblings → one component + data
  const signature = (node) => {
    if (node.k === "t") return "#";
    if (node.k === "p") return `p:${classOf(node)}:${node.content}`;
    if (node.tag === "svg") return `svg:${classOf(node)}`;
    return `${node.tag}.${classOf(node)}[${Object.keys(node.a || {}).sort().join(",")}](${node.children.map(signature).join("|")})`;
  };
  const size = (node) => 1 + (node.children || []).reduce((sum, child) => sum + size(child), 0);
  const components = [];
  const usedNames = new Set(["App"]);
  const unique = (name) => {
    let candidate = name;
    let n = 2;
    while (usedNames.has(candidate)) candidate = `${name}${n++}`;
    usedNames.add(candidate);
    return candidate;
  };
  const SLOT_ATTRS = new Set(["src", "alt", "href", "title", "aria-label", "placeholder", "poster", "id", "datetime"]);
  const propName = (owner, attr) => {
    if (attr) return { src: "image", alt: "imageAlt", href: "href", poster: "poster", "aria-label": "label", placeholder: "placeholder", id: "anchor", title: "tooltip", datetime: "date" }[attr] || camel(attr);
    if (/^h[1-6]$/.test(owner.tag)) return "title";
    return { p: "text", a: "link", button: "action", li: "item", dt: "term", dd: "detail", figcaption: "caption", time: "date", label: "label" }[owner.tag] || "label";
  };

  const extractRepeats = (node, sectionName) => {
    if ((node.k !== "e" && node.k !== "g") || node.tag === "svg") return;
    let kids = node.children;
    for (let start = 0; start < kids.length; ) {
      const sig = kids[start].k === "e" ? signature(kids[start]) : null;
      let end = start + 1;
      while (sig && end < kids.length && kids[end].k === "e" && signature(kids[end]) === sig) end += 1;
      const run = kids.slice(start, end);
      const big = run.length && size(run[0]) >= 4;
      if (sig && (run.length >= 3 || (run.length === 2 && big)) && size(run[0]) >= 2) {
        // Leaves that differ across instances become props.
        const slots = new Map();
        const props = [];
        const usedProps = new Set();
        const rows = run.map(() => ({}));
        const walk = (nodesAt, owner) => {
          const first = nodesAt[0];
          if (first.k === "t") {
            const texts = nodesAt.map((n) => n.x);
            if (texts.some((t) => t !== texts[0])) {
              let name = propName(owner);
              let n = 2;
              while (usedProps.has(name)) name = `${propName(owner)}${n++}`;
              usedProps.add(name);
              props.push(name);
              slots.set(first, name);
              texts.forEach((text, k) => (rows[k][name] = text));
            }
            return;
          }
          if (first.k !== "e" || first.tag === "svg") return;
          for (const attr of Object.keys(first.a || {})) {
            if (!SLOT_ATTRS.has(attr)) continue;
            const values = nodesAt.map((n) => {
              const raw = n.a?.[attr] ?? "";
              return attr === "src" || attr === "poster" ? publicUrl(raw) || raw : raw;
            });
            if (values.every((v) => v === values[0])) continue;
            let name = propName(first, attr);
            let n = 2;
            while (usedProps.has(name)) name = `${propName(first, attr)}${n++}`;
            usedProps.add(name);
            props.push(name);
            slots.set(`${first.index}:${attr}`, name);
            values.forEach((value, k) => (rows[k][name] = value));
          }
          first.children.forEach((child, c) => walk(nodesAt.map((n) => n.children[c]), first));
        };
        walk(run, node);
        const kind = run[0].tag === "li" ? "Item" : /img|h[1-6]/.test(signature(run[0])) ? "Card" : "Item";
        const name = unique(`${sectionName}${kind}`);
        const data = `${name[0].toLowerCase()}${name.slice(1)}s`;
        components.push({ section: sectionName, name, props, rows, template: run[0], slots, data });
        run[0].repeat = { name, data };
        node.children = [...kids.slice(0, start), run[0], ...kids.slice(end)];
        kids = node.children;
        start += 1;
        continue;
      }
      start = end;
    }
    for (const child of node.children) if (!child.repeat) extractRepeats(child, sectionName);
  };

  // ---------- sections
  // Sectioning elements, large blocks and blocks with a heading become
  // components. A flat document (h2, p, ul... side by side, as in docs and
  // blogs) is cut at each heading instead: one component per heading, which
  // renders its run of siblings in a fragment.
  const lastW = (node) => node.samples?.[sampleCount - 1]?.m;
  const vw = lastW(root)?.w || widths[widths.length - 1];
  const significant = (node) => {
    const m = lastW(node);
    return node.k === "e" && m && m.v && m.h >= 40 && m.w >= Math.min(vw * 0.5, 480);
  };
  const isHeading = (node) => node.k === "e" && /^h[1-3]$/.test(node.tag);
  const findHeading = (node) => {
    if (isHeading(node)) return node;
    for (const child of node.children || []) {
      const hit = findHeading(child);
      if (hit) return hit;
    }
    return null;
  };
  const words = (node) => (node.k === "t" ? node.x : (node.children || []).map(words).join(" "));
  const isPart = (node) => significant(node) && (/^(section|header|footer|nav|aside|article|form)$/.test(node.tag) || findHeading(node) || lastW(node).h >= 160);
  const nameFor = (node, n) => {
    if (node.tag === "header" || node.a?.role === "banner") return "Header";
    if (node.tag === "footer" || node.a?.role === "contentinfo") return "Footer";
    if (node.tag === "nav") return "Navigation";
    const heading = findHeading(node);
    return pascal(heading ? words(heading) : "") || pascal(node.a?.["aria-label"] || "") || pascal(node.a?.id || "") || pascal(node.cls?.[0] || "") || `Section${n}`;
  };
  const sectionFiles = [];
  const addPart = (node) => {
    const name = unique(nameFor(node, sectionFiles.length + 1));
    node.component = name;
    sectionFiles.push({ name, node });
  };
  const groupFlat = (parent) => {
    const out = [];
    let run = null;
    const flush = () => {
      if (!run) return;
      const name = unique(pascal(run.title) || `Section${sectionFiles.length + 1}`);
      const group = { k: "g", index: -1, children: run.nodes, component: name };
      sectionFiles.push({ name, node: group });
      out.push(group);
      run = null;
    };
    for (const child of parent.children) {
      if (isHeading(child)) {
        flush();
        run = { title: words(child), nodes: [child] };
      } else if (run) {
        run.nodes.push(child);
      } else {
        if (child.k === "e" && isPart(child)) addPart(child);
        out.push(child);
      }
    }
    flush();
    parent.children = out;
  };
  const splitChildren = (parent) => {
    if (parent.children.some(isHeading)) groupFlat(parent);
    else for (const child of parent.children) if (child.k === "e" && isPart(child)) addPart(child);
  };
  let top = root;
  for (let depth = 0; depth < 8; depth++) {
    const kids = top.children.filter(significant);
    if (kids.length !== 1) break;
    top = kids[0];
  }
  const mains = top.children.filter((child) => child.k === "e" && (child.tag === "main" || child.a?.role === "main"));
  if (mains.length) {
    for (const child of top.children) {
      if (mains.includes(child)) {
        let inner = child;
        for (let depth = 0; depth < 6; depth++) {
          const kids = inner.children.filter(significant);
          if (inner.children.some(isHeading) || kids.length !== 1) break;
          inner = kids[0];
        }
        splitChildren(inner);
      } else if (child.k === "e" && isPart(child)) {
        addPart(child);
      }
    }
  } else {
    splitChildren(top);
  }
  if (sectionFiles.length < 2) {
    // One block is no structure: undo and keep the page in App.
    const undo = (node) => {
      if (node.k === "g") return node.children;
      delete node.component;
      return [node];
    };
    for (const { node } of sectionFiles) if (node.k !== "g") delete node.component;
    const flatten = (node) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => (child.k === "g" ? undo(child) : [child]));
      node.children.forEach(flatten);
    };
    flatten(root);
    sectionFiles.length = 0;
    extractRepeats(root, "Page");
  } else {
    for (const { name, node } of sectionFiles) extractRepeats(node, name);
  }

  const header = `// Measured by Keys_Osi from ${capture.url} at ${widths.join(", ")}px.\n`;
  const repeatedParts = (section) =>
    components
      .filter((component) => component.section === section)
      .map((component) => `const ${component.data} = ${JSON.stringify(component.rows, null, 2)};\n\nfunction ${component.name}({ ${component.props.join(", ")} }) {\n  return (\n${printNode(component.template, "    ", component.slots).join("\n")}\n  );\n}\n`);
  const files = [];
  for (const { name, node } of sectionFiles) {
    // In its own file the section prints in full; in App it is <Name />.
    node.component = null;
    const body = printNode(node, "    ").join("\n");
    node.component = name;
    const parts = repeatedParts(name);
    files.push({ path: `src/components/${name}.jsx`, content: `${header}\n${parts.join("\n")}${parts.length ? "\n" : ""}export default function ${name}() {\n  return (\n${body}\n  );\n}\n` });
  }
  const appBody = root.children.flatMap((child) => printNode(child, "      "));
  const imports = sectionFiles.map(({ name }) => `import ${name} from "./components/${name}.jsx";`);
  const pageParts = repeatedParts("Page");
  files.push({
    path: "src/App.jsx",
    content: `${header}${imports.join("\n")}${imports.length ? "\n\n" : ""}${pageParts.join("\n")}${pageParts.length ? "\n" : ""}export default function App() {\n  return (\n    <>\n${appBody.join("\n")}\n    </>\n  );\n}\n`
  });

  // ---------- CSS: no Preflight (the page was measured on browser defaults)
  const bodyMaps = variantMaps(root.values || {}, sampleCount);
  for (const map of bodyMaps) for (const prop of ["width", "height", "max-width", "min-height", "margin-left", "margin-right"]) if (prop in map && (map[prop] === "auto" || /^(width|height|max-width|min-height)$/.test(prop))) delete map[prop];
  const toCss = (prop, value) => (prop === "background-image" ? rewriteUrls(value, publicUrl) : value);
  const usedFamilies = new Set(Object.keys(tokens.fonts).flatMap((stack) => familyNames(stack).map((name) => name.toLowerCase())));
  const faces = fontFaces.filter((face) => usedFamilies.has(face.family.toLowerCase()));
  const faceCss = faces
    .map((face) => {
      const src = face.srcs.find((s) => /woff2/.test(s.format) || /\.woff2(\?|$)/i.test(s.url)) || face.srcs[0];
      const local = publicUrl(src.url);
      const format = src.format || (/\.woff2/i.test(src.url) ? "woff2" : /\.woff(\?|$)/i.test(src.url) ? "woff" : "");
      return [`@font-face {`, `  font-family: "${face.family}";`, `  src: url("${local || src.url}")${format ? ` format("${format}")` : ""};`, `  font-weight: ${face.weight};`, `  font-style: ${face.style};`, `  font-display: ${face.display};`, face.unicodeRange ? `  unicode-range: ${face.unicodeRange};` : "", `}`].filter(Boolean).join("\n");
    })
    .join("\n\n");
  const theme = [
    "  --breakpoint-*: initial;",
    ...screens.map((screen) => `  --breakpoint-${screen.name}: ${screen.px / 16}rem;`),
    ...Object.entries(tokens.fonts).map(([stack, name]) => `  --font-${name}: ${stack};`),
    ...Object.entries(tokens.colors).map(([hex, name]) => `  --color-${name}: ${hex};`)
  ];
  const htmlBg = capture.htmlBackground && !/rgba\(0, 0, 0, 0\)|transparent/.test(capture.htmlBackground) ? `html {\n  background-color: ${rgbToHex(capture.htmlBackground)};\n}\n\n` : "";
  files.push({
    path: "src/index.css",
    content: [
      "/* Tailwind without Preflight: the page was measured on browser defaults. */",
      "@layer theme, base, components, utilities;",
      '@import "tailwindcss/theme.css" layer(theme);',
      '@import "tailwindcss/utilities.css" layer(utilities);',
      "",
      `@theme {\n${theme.join("\n")}\n}`,
      "",
      faceCss,
      faceCss ? "" : null,
      ctx.borderBox ? "*,\n::before,\n::after {\n  box-sizing: border-box;\n}\n" : null,
      `${htmlBg}${cssRule("body", bodyMaps, screens, toCss)}`,
      "",
      "#root {\n  display: contents;\n}",
      ""
    ].filter((line) => line !== null).join("\n")
  });

  const name = slug(host) || "site";
  files.push({ path: "src/main.jsx", content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\nimport "./index.css";\n\ncreateRoot(document.getElementById("root")).render(\n  <StrictMode>\n    <App />\n  </StrictMode>\n);\n` });
  const icon = capture.icon ? publicUrl(capture.icon) || capture.icon : "";
  const esc = (text) => String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  files.push({
    path: "index.html",
    content: `<!doctype html>\n<html lang="${esc(capture.lang || "en")}">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${esc(capture.title)}</title>\n${capture.description ? `    <meta name="description" content="${esc(capture.description)}" />\n` : ""}${icon ? `    <link rel="icon" href="${esc(icon)}" />\n` : ""}  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`
  });
  files.push({ path: "vite.config.js", content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nimport tailwindcss from "@tailwindcss/vite";\n\nexport default defineConfig({\n  plugins: [react(), tailwindcss()]\n});\n` });
  files.push({
    path: "package.json",
    content: `${JSON.stringify({ name: `${name}-clone`, private: true, version: "0.0.0", type: "module", scripts: { dev: "vite", build: "vite build", preview: "vite preview" }, ...CLONE_DEPENDENCIES }, null, 2)}\n`
  });
  files.push({ path: ".gitignore", content: "node_modules\ndist\n" });
  const remote = [...new Set(collectCloneAssets(capture, faces).map((asset) => asset.url).filter((url) => !assetPaths.has(url)))];
  files.push({ path: "README.md", content: readme({ capture, host, widths, screens, sectionFiles, components, faces, remote }) });
  const elementCount = (function count(node) {
    return (node.k === "e" ? 1 : 0) + (node.children || []).reduce((sum, child) => sum + count(child), 0);
  })(root);
  return {
    files,
    stats: { sections: sectionFiles.length, repeated: components.length, elements: elementCount, screens, fonts: faces.length, colors: Object.keys(tokens.colors).length, remoteAssets: remote.length, truncated: Boolean(capture.truncated) }
  };
}

function readme({ capture, host, widths, screens, sectionFiles, components, faces, remote }) {
  const families = [...new Set(faces.map((face) => face.family))];
  const limits = [
    "- JavaScript behavior: menus that open, sliders, tabs, forms that submit, animations and scroll effects. The markup and styles are there; wire the state in React.",
    "- Hover, focus and active states: only the resting state was measured.",
    "- Content loaded after the capture, shadow DOM content and canvas/WebGL drawings.",
    "- Between two measured widths, sizes follow the closest breakpoint: check intermediate widths."
  ];
  if (families.length) limits.push(`- Fonts: ${families.join(", ")} were copied from the site. Check their license before publishing.`);
  if (remote.length) limits.push(`- ${remote.length} file(s) could not be downloaded and still point to the original site.`);
  if (capture.truncated) limits.push("- The page was larger than the capture limit (6000 nodes): the end of the page is missing.");
  const structure = [
    "- `src/App.jsx`: the page, in source order.",
    ...sectionFiles.map(({ name }) => {
      const own = components.filter((component) => component.section === name);
      return `- \`src/components/${name}.jsx\`${own.length ? `: repeated blocks as ${own.map((component) => `\`${component.name}\``).join(", ")}, fed by a data array` : ""}`;
    }),
    "- `src/index.css`: Tailwind v4 without Preflight, the site's breakpoints, font and color tokens, `@font-face` rules.",
    "- `public/assets/`, `public/fonts/`: images and fonts downloaded from the page."
  ];
  return [
    `# ${capture.title || host} — React + Tailwind clone`,
    "",
    `Generated by Keys_Osi from ${capture.url}. Layout and styles were measured in the browser at ${widths.map((w) => `${w}px`).join(", ")}; every class comes from those measures.`,
    "",
    "## Run",
    "",
    "```bash",
    "npm install",
    "npm run dev     # http://localhost:5173",
    "npm run build   # static site in dist/",
    "```",
    "",
    "## Structure",
    "",
    ...structure,
    "",
    "## Breakpoints",
    "",
    `Mobile first: ${screens.map((screen) => `\`${screen.name}:\` from ${screen.px}px`).join(", ")}${screens.some((screen) => screen.fromSite) ? " (taken from the site's own media queries)" : ""}.`,
    "",
    "## What a static clone does not carry",
    "",
    ...limits,
    ""
  ].join("\n");
}
