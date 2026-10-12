/*
 * Keys_Osi — figma-capture.js
 *
 * Turns the live page into a JSON document ("keys-osi-figma" v1) that the
 * Keys_Osi Import Figma plugin rebuilds as editable layers. Injected with
 * chrome.scripting.executeScript (ISOLATED world); it only reads the page.
 *
 * Usage (after injecting this file):
 *   await window.__keysOsiFigmaCapture({ selector, maxNodes, includeHidden })
 *
 * The auto-layout inference (geometry-verified: a container only becomes an
 * auto-layout frame when replaying Figma's layout reproduces the browser's
 * rects) is adapted from MIT-licensed code; see THIRD_PARTY_NOTICES.md.
 */
(() => {
  "use strict";

  // Max deviation (px) between replayed and measured child positions.
  const TOL = 0.6;
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "BASE",
    "BR", "WBR", "SOURCE", "TRACK", "PARAM", "DATALIST", "OPTION", "OPTGROUP", "MAP", "AREA"
  ]);
  const REPLACED_TAGS = new Set([
    "IMG", "SVG", "VIDEO", "CANVAS", "IFRAME", "OBJECT", "EMBED", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "AUDIO"
  ]);
  // Generic wrappers that may be hoisted away; semantic tags always stay frames.
  const FLATTENABLE = new Set(["DIV", "SPAN", "PICTURE", "FONT", "CENTER"]);
  const BLOCK_LEVEL = new Set(["block", "flex", "grid", "flow-root", "table", "list-item"]);
  const JUSTIFY = {
    normal: "MIN", "flex-start": "MIN", start: "MIN", left: "MIN", stretch: "MIN",
    center: "CENTER", "flex-end": "MAX", end: "MAX", right: "MAX",
    "space-between": "SPACE_BETWEEN",
    // Rebuilt with CENTER + the measured gap: identical geometry, and the
    // replay check below guards the equivalence.
    "space-evenly": "CENTER", "space-around": "CENTER"
  };
  const ALIGN = {
    normal: "MIN", stretch: "MIN", "flex-start": "MIN", start: "MIN", "self-start": "MIN",
    center: "CENTER", "flex-end": "MAX", end: "MAX", "self-end": "MAX"
  };
  const CONTENT_KEYWORDS = new Set(["auto", "min-content", "max-content", "fit-content"]);

  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  // "+ 0" folds -0 into 0.
  const r2 = (n) => Math.round(n * 100) / 100 + 0;
  const r4 = (n) => Math.round(n * 10000) / 10000 + 0;
  const r6 = (n) => Math.round(n * 1e6) / 1e6 + 0;
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  // Internal per-node data that must not leak into the JSON output.
  let meta = new WeakMap();

  /* ------------------------------------------------------------------ */
  /* Strings                                                             */
  /* ------------------------------------------------------------------ */

  /** Splits on `sep` (or whitespace when sep is " ") outside parens/quotes. */
  function splitTop(str, sep) {
    const out = [];
    let depth = 0;
    let quote = null;
    let cur = "";
    for (const ch of String(str || "")) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "\"" || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      const isSep = sep === " " ? /\s/.test(ch) : ch === sep;
      if (depth === 0 && isSep) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ------------------------------------------------------------------ */
  /* Colors and paints                                                   */
  /* ------------------------------------------------------------------ */

  const colorCache = new Map();
  let colorCtx = null;

  // Computed colors are rgb()/rgba() in most cases; anything else (oklch,
  // color(), lab...) is rasterized on a detached 1x1 canvas to get sRGB.
  function canvasColor(value) {
    try {
      if (!colorCtx) {
        const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        colorCtx = canvas.getContext("2d", { willReadFrequently: true });
      }
      colorCtx.fillStyle = "rgba(1, 2, 3, 0.5)";
      const sentinel = colorCtx.fillStyle;
      colorCtx.fillStyle = value;
      if (colorCtx.fillStyle === sentinel) return null;
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillRect(0, 0, 1, 1);
      const d = colorCtx.getImageData(0, 0, 1, 1).data;
      return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 };
    } catch (e) {
      return null;
    }
  }

  /** CSS color -> { r, g, b, a } in 0..1, or null when unparseable. */
  function parseColor(value) {
    const v = String(value || "").trim();
    if (!v || v === "none" || v === "currentcolor") return null;
    if (colorCache.has(v)) return colorCache.get(v);
    let out = null;
    if (v === "transparent") out = { r: 0, g: 0, b: 0, a: 0 };
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/i.exec(v);
    if (!out && m) {
      const a = m[4] === undefined ? 1 : m[5] ? Number(m[4]) / 100 : Number(m[4]);
      out = { r: Number(m[1]) / 255, g: Number(m[2]) / 255, b: Number(m[3]) / 255, a };
    }
    if (!out) out = canvasColor(v);
    if (out) out = { r: r4(out.r), g: r4(out.g), b: r4(out.b), a: r4(out.a) };
    colorCache.set(v, out);
    return out;
  }

  function solidPaint(c) {
    return c && c.a > 0 ? { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a } : null;
  }

  /** CSS angle token -> degrees (box-dependent for corner keywords). */
  function angleOf(token, w, h) {
    const t = String(token || "").trim();
    const m = /^(-?[\d.]+)(deg|rad|turn|grad)$/.exec(t);
    if (m) {
      const n = Number(m[1]);
      return m[2] === "deg" ? n : m[2] === "rad" ? (n * 180) / Math.PI : m[2] === "turn" ? n * 360 : n * 0.9;
    }
    if (!t.startsWith("to ")) return null;
    const words = t.slice(3).trim().split(/\s+/).sort().join(" ");
    // Corner keywords put the 50% line through the two neighbouring corners.
    const corner = (Math.atan2(h || 1, w || 1) * 180) / Math.PI;
    const map = {
      top: 0, right: 90, bottom: 180, left: 270,
      "right top": corner, "bottom right": 180 - corner, "bottom left": 180 + corner, "left top": 360 - corner
    };
    return words in map ? map[words] : null;
  }

  /** Color-stop list -> [{ position, color }] with CSS position fix-up rules. */
  function parseStops(args, lineLength, angular) {
    const raw = [];
    for (const arg of args) {
      const parts = splitTop(arg, " ");
      const lens = [];
      const colorParts = [];
      for (const p of parts) {
        if (/^-?[\d.]+(px|%|deg|turn|rad|grad)?$/.test(p)) lens.push(p);
        else colorParts.push(p);
      }
      if (!colorParts.length) continue; // color hint: interpolation midpoint, approximated as linear
      const color = parseColor(colorParts.join(" "));
      if (!color) return null;
      const toFrac = (l) => {
        if (l.endsWith("%")) return parseFloat(l) / 100;
        if (angular) {
          const deg = angleOf(l, 1, 1);
          return deg === null ? parseFloat(l) / 360 : deg / 360;
        }
        return lineLength > 0 ? parseFloat(l) / lineLength : 0;
      };
      if (!lens.length) raw.push({ color, pos: null });
      else lens.forEach((l) => raw.push({ color, pos: toFrac(l) }));
    }
    if (raw.length < 2) return null;
    if (raw[0].pos === null) raw[0].pos = 0;
    if (raw[raw.length - 1].pos === null) raw[raw.length - 1].pos = 1;
    let max = raw[0].pos;
    for (const s of raw) {
      if (s.pos === null) continue;
      if (s.pos < max) s.pos = max;
      max = s.pos;
    }
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].pos !== null) continue;
      let j = i;
      while (raw[j].pos === null) j++;
      const a = raw[i - 1].pos;
      const b = raw[j].pos;
      for (let k = i; k < j; k++) raw[k].pos = a + ((b - a) * (k - i + 1)) / (j - i + 1);
      i = j;
    }
    return raw.map((s) => ({ position: r4(clamp01(s.pos)), color: s.color }));
  }

  /*
   * Figma gradientTransform maps normalized layer space (0..1) to gradient
   * space, where a linear ramp runs from (0, .5) to (1, .5): the progress is
   * t = m00*x + m01*y + m02. CSS runs the line along (sin a, -cos a) with
   * length |w sin a| + |h cos a|, so the end stops land on the same corners.
   */
  function linearTransform(angleDeg, w, h) {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const W = w > 0 ? w : 1;
    const H = h > 0 ? h : 1;
    const len = Math.abs(W * dx) + Math.abs(H * dy);
    if (!len) return [[0, 1, 0], [-1, 0, 1]];
    const m00 = (W * dx) / len;
    const m01 = (H * dy) / len;
    // Second row: perpendicular axis, keeps the matrix invertible.
    return [
      [r6(m00), r6(m01), r6(0.5 - 0.5 * (m00 + m01))],
      [r6(-m01), r6(m00), r6(0.5 - 0.5 * (m00 - m01))]
    ];
  }

  function positionValue(tok, size) {
    const keywords = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
    if (tok in keywords) return keywords[tok] * size;
    if (String(tok).endsWith("%")) return (parseFloat(tok) / 100) * size;
    return px(tok);
  }

  function parsePosition(pos, w, h) {
    if (!pos) return { cx: w / 2, cy: h / 2 };
    let words = pos.trim().split(/\s+/);
    if (words.length === 1) words = /^(top|bottom)$/.test(words[0]) ? ["center", words[0]] : [words[0], "center"];
    if (/^(top|bottom)$/.test(words[0]) || /^(left|right)$/.test(words[1])) words = [words[1], words[0]];
    return { cx: positionValue(words[0], w), cy: positionValue(words[1], h) };
  }

  /*
   * Figma reads a radial ramp as the distance from (.5, .5) in gradient
   * space, in units of .5: the ellipse of radii (rx, ry) centred on (cx, cy)
   * maps to that unit circle.
   */
  function radialGeometry(token, w, h) {
    let shape = "ellipse";
    let size = "farthest-corner";
    const explicit = [];
    let head = token || "";
    let pos = null;
    const at = /(^|\s)at\s+(.*)$/.exec(head);
    if (at) {
      pos = at[2];
      head = head.slice(0, at.index);
    }
    let shapeGiven = false;
    for (const word of head.split(/\s+/).filter(Boolean)) {
      if (word === "circle" || word === "ellipse") {
        shape = word;
        shapeGiven = true;
      } else if (/^(closest|farthest)-(side|corner)$/.test(word)) size = word;
      else explicit.push(word);
    }
    if (explicit.length === 1 && !shapeGiven) shape = "circle";
    const { cx, cy } = parsePosition(pos, w, h);
    const dxs = [Math.abs(cx), Math.abs(w - cx)];
    const dys = [Math.abs(cy), Math.abs(h - cy)];
    let rx;
    let ry;
    if (explicit.length) {
      rx = String(explicit[0]).endsWith("%") ? (parseFloat(explicit[0]) / 100) * w : px(explicit[0]);
      ry = explicit[1] === undefined ? rx : String(explicit[1]).endsWith("%") ? (parseFloat(explicit[1]) / 100) * h : px(explicit[1]);
    } else {
      const pick = size.startsWith("closest") ? Math.min : Math.max;
      const sx = pick(dxs[0], dxs[1]);
      const sy = pick(dys[0], dys[1]);
      if (size.endsWith("side")) {
        if (shape === "circle") rx = ry = pick(sx, sy);
        else {
          rx = sx;
          ry = sy;
        }
      } else if (shape === "circle" || !sy) {
        rx = ry = Math.hypot(sx, sy);
      } else {
        // Corner sizes keep the aspect ratio of the matching side size.
        const aspect = sx / sy;
        ry = Math.sqrt((sx / aspect) ** 2 + sy ** 2);
        rx = aspect * ry;
      }
    }
    rx = rx > 0 ? rx : 1;
    ry = ry > 0 ? ry : 1;
    const W = w > 0 ? w : 1;
    const H = h > 0 ? h : 1;
    const m00 = W / (2 * rx);
    const m11 = H / (2 * ry);
    return {
      ray: rx,
      transform: [
        [r6(m00), 0, r6(0.5 - (cx / W) * m00)],
        [0, r6(m11), r6(0.5 - (cy / H) * m11)]
      ]
    };
  }

  /** CSS gradient -> Figma GradientPaint (repeating gradients approximated). */
  function gradientPaint(str, w, h) {
    const m = /^(-webkit-)?(repeating-)?(linear|radial|conic)-gradient\(([\s\S]*)\)$/i.exec(String(str).trim());
    if (!m) return null;
    const kind = m[3].toLowerCase();
    const args = splitTop(m[4], ",");
    if (kind === "linear") {
      let angle = 180;
      const a = angleOf(args[0], w, h);
      if (a !== null) {
        angle = a;
        args.shift();
      }
      const rad = (angle * Math.PI) / 180;
      const len = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      const stops = parseStops(args, len, false);
      return stops && { type: "GRADIENT_LINEAR", gradientTransform: linearTransform(angle, w, h), gradientStops: stops };
    }
    if (kind === "radial") {
      let geo = null;
      if (/^(circle|ellipse|closest-|farthest-|at\s)|^-?[\d.]+(px|%)(\s|$)/.test(args[0] || "")) geo = args.shift();
      const g = radialGeometry(geo, w, h);
      const stops = parseStops(args, g.ray, false);
      return stops && { type: "GRADIENT_RADIAL", gradientTransform: g.transform, gradientStops: stops };
    }
    // Conic: only the default `from 0deg at center` geometry is modelled.
    // Figma's angular ramp starts at 3 o'clock, CSS at 12: rotate a quarter turn.
    if (/^(from|at)\s/.test(args[0] || "")) args.shift();
    const stops = parseStops(args, 1, true);
    return stops && { type: "GRADIENT_ANGULAR", gradientTransform: [[0, -1, 1], [1, 0, 0]], gradientStops: stops };
  }

  function imageLayerPaint(layer, size, repeat, w, ctx) {
    const m = /url\((['"]?)([\s\S]*?)\1\)/.exec(layer);
    if (!m || !m[2]) return null;
    const id = ctx.addImage(new URL(m[2], document.baseURI).href);
    if (size === "cover") return { type: "IMAGE", imageId: id, scaleMode: "FILL" };
    if (size === "contain") return { type: "IMAGE", imageId: id, scaleMode: "FIT" };
    if (!/no-repeat/.test(repeat) && repeat !== "space round") {
      const paint = { type: "IMAGE", imageId: id, scaleMode: "TILE", scalingFactor: 1 };
      const first = splitTop(size, " ")[0] || "auto";
      if (first !== "auto") {
        const tileW = first.endsWith("%") ? (parseFloat(first) / 100) * w : px(first);
        ctx.pendingTiles.push({ paint, id, tileW });
      }
      return paint;
    }
    // Explicit size/position without repeat: approximated as a cover fill.
    return { type: "IMAGE", imageId: id, scaleMode: "FILL" };
  }

  /** Background color + layers -> Figma fills (array end paints on top). */
  function backgroundPaints(cs, w, h, ctx) {
    const paints = [];
    const layers = cs.backgroundImage && cs.backgroundImage !== "none" ? splitTop(cs.backgroundImage, ",") : [];
    const sizes = splitTop(cs.backgroundSize, ",");
    const repeats = splitTop(cs.backgroundRepeat, ",");
    layers.forEach((layer, i) => {
      let paint = null;
      if (/^url\(/i.test(layer)) {
        paint = imageLayerPaint(layer, sizes[i % (sizes.length || 1)] || "auto", repeats[i % (repeats.length || 1)] || "repeat", w, ctx);
      } else if (/gradient\(/i.test(layer)) {
        paint = gradientPaint(layer, w, h);
      }
      if (paint) paints.push(paint);
    });
    // CSS paints the first layer on top; Figma paints the last array entry on top.
    paints.reverse();
    const bg = solidPaint(parseColor(cs.backgroundColor));
    if (bg) paints.unshift(bg);
    return paints;
  }

  /* ------------------------------------------------------------------ */
  /* Borders, radii, effects                                             */
  /* ------------------------------------------------------------------ */

  const SIDES = ["Top", "Right", "Bottom", "Left"];

  /*
   * Figma has one stroke paint per node but per-side weights. The dominant
   * border color becomes the stroke; sides in another color become inset
   * shadows (the classic `inset 0 -4px 0 color` trick), which follow radii.
   */
  function borderInfo(cs) {
    const sides = SIDES.map((s) => {
      const style = cs[`border${s}Style`];
      const width = style === "none" || style === "hidden" ? 0 : px(cs[`border${s}Width`]);
      const color = parseColor(cs[`border${s}Color`]);
      return { width, color, visible: width > 0 && !!color && color.a > 0 };
    });
    const visible = sides.filter((s) => s.visible);
    if (!visible.length) return { strokes: [], strokeWeights: null, effects: [] };
    const groups = new Map();
    for (const s of visible) {
      const key = JSON.stringify(s.color);
      const g = groups.get(key) || { color: s.color, count: 0, total: 0 };
      g.count++;
      g.total += s.width;
      groups.set(key, g);
    }
    let main = null;
    for (const g of groups.values()) {
      if (!main || g.count > main.count || (g.count === main.count && g.total > main.total)) main = g;
    }
    const mainKey = JSON.stringify(main.color);
    const weights = sides.map((s) => (s.visible && JSON.stringify(s.color) === mainKey ? r2(s.width) : 0));
    const offsets = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    const effects = [];
    sides.forEach((s, i) => {
      if (!s.visible || JSON.stringify(s.color) === mainKey) return;
      effects.push({
        type: "INNER_SHADOW", color: s.color,
        offset: { x: offsets[i][0] * s.width, y: offsets[i][1] * s.width },
        radius: 0, spread: 0, visible: true, blendMode: "NORMAL"
      });
    });
    return {
      strokes: [solidPaint(main.color)],
      strokeWeights: { top: weights[0], right: weights[1], bottom: weights[2], left: weights[3] },
      effects
    };
  }

  /** Per-corner radii [tl, tr, br, bl], percent-resolved and CSS-scaled. */
  function cornerRadii(cs, w, h) {
    const read = (v) => {
      const parts = String(v || "0").split(/\s+/);
      const len = (p, size) => (p.endsWith("%") ? (parseFloat(p) / 100) * size : px(p));
      return Math.min(len(parts[0], w), len(parts[1] || parts[0], h));
    };
    const r = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(read);
    const f = Math.min(
      1,
      r[0] + r[1] > 0 ? w / (r[0] + r[1]) : 1,
      r[3] + r[2] > 0 ? w / (r[3] + r[2]) : 1,
      r[0] + r[3] > 0 ? h / (r[0] + r[3]) : 1,
      r[1] + r[2] > 0 ? h / (r[1] + r[2]) : 1
    );
    return r.map((v) => r2(Math.max(0, v * f)));
  }

  /** box-shadow / text-shadow / drop-shadow() list -> Figma shadow effects. */
  function parseShadowList(value, allowInset) {
    if (!value || value === "none") return [];
    const out = [];
    for (const shadow of splitTop(value, ",")) {
      let inset = false;
      const lens = [];
      const colorParts = [];
      for (const p of splitTop(shadow, " ")) {
        if (p === "inset") inset = true;
        else if (/^-?[\d.]+(px)?$/.test(p)) lens.push(px(p));
        else colorParts.push(p);
      }
      const color = parseColor(colorParts.join(" ") || "rgb(0, 0, 0)");
      if (!color || color.a === 0 || lens.length < 2) continue;
      out.push({
        type: inset && allowInset ? "INNER_SHADOW" : "DROP_SHADOW",
        color,
        offset: { x: lens[0], y: lens[1] },
        radius: lens[2] || 0,
        spread: allowInset ? lens[3] || 0 : 0,
        visible: true,
        blendMode: "NORMAL"
      });
    }
    return out;
  }

  // CSS blur() is a Gaussian sigma; Figma's blur radius is twice that.
  function filterEffects(cs) {
    const out = [];
    const filter = cs.filter || "none";
    for (const m of filter.matchAll(/blur\(([^)]+)\)/g)) {
      const sigma = px(m[1]);
      if (sigma > 0) out.push({ type: "LAYER_BLUR", radius: r2(sigma * 2), visible: true, blurType: "NORMAL" });
    }
    let idx = filter.indexOf("drop-shadow(");
    while (idx >= 0) {
      let depth = 0;
      let end = idx + "drop-shadow(".length;
      for (; end < filter.length; end++) {
        if (filter[end] === "(") depth++;
        else if (filter[end] === ")") {
          if (depth === 0) break;
          depth--;
        }
      }
      out.push(...parseShadowList(filter.slice(idx + "drop-shadow(".length, end), false));
      idx = filter.indexOf("drop-shadow(", end);
    }
    const backdrop = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    for (const m of backdrop.matchAll(/blur\(([^)]+)\)/g)) {
      const sigma = px(m[1]);
      if (sigma > 0) out.push({ type: "BACKGROUND_BLUR", radius: r2(sigma * 2), visible: true, blurType: "NORMAL" });
    }
    return out;
  }

  function blendOf(value) {
    const v = String(value || "normal");
    if (v === "normal") return "NORMAL";
    if (v === "plus-lighter") return "LINEAR_DODGE";
    if (v === "plus-darker") return "LINEAR_BURN";
    return v.toUpperCase().replace(/-/g, "_");
  }

  const clipsOf = (cs) => cs.overflowX !== "visible" || cs.overflowY !== "visible";

  function hasBox(cs) {
    if (parseColor(cs.backgroundColor) && parseColor(cs.backgroundColor).a > 0) return true;
    if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
    if (cs.boxShadow && cs.boxShadow !== "none") return true;
    return SIDES.some((s) => {
      const style = cs[`border${s}Style`];
      const c = parseColor(cs[`border${s}Color`]);
      return style !== "none" && style !== "hidden" && px(cs[`border${s}Width`]) > 0 && c && c.a > 0;
    });
  }

  /** Base node with every visual property of an element box. */
  function visualNode(type, name, box, cs, ctx) {
    const border = borderInfo(cs);
    return {
      type,
      name,
      x: box.x,
      y: box.y,
      width: r2(box.width),
      height: r2(box.height),
      fills: backgroundPaints(cs, box.width, box.height, ctx),
      strokes: border.strokes,
      strokeWeights: border.strokeWeights,
      cornerRadii: cornerRadii(cs, box.width, box.height),
      effects: [...parseShadowList(cs.boxShadow, true), ...border.effects, ...filterEffects(cs)],
      opacity: r4(Number.isFinite(parseFloat(cs.opacity)) ? parseFloat(cs.opacity) : 1),
      blendMode: blendOf(cs.mixBlendMode),
      clipsContent: clipsOf(cs)
    };
  }

  function isPlain(node) {
    return (
      node.type === "FRAME" &&
      !node.fills.length &&
      !node.strokes.length &&
      !node.effects.length &&
      !node.clipsContent &&
      node.opacity === 1 &&
      node.blendMode === "NORMAL" &&
      node.visible !== false
    );
  }

  /* ------------------------------------------------------------------ */
  /* Names                                                               */
  /* ------------------------------------------------------------------ */

  const UTILITY_CLASS = /^(m|p|mx|my|px|py|mt|mb|ml|mr|pt|pb|pl|pr|w|h|min|max|gap|text|bg|border|rounded|flex|grid|items|justify|self|shadow|font|leading|tracking|col|row|z|top|left|right|bottom|inset|overflow|opacity|transition|duration|ease|hidden|block|inline|relative|absolute|fixed|sticky|space|divide|ring|cursor|select|order|sm|md|lg|xl)(-|$)/;

  function classHint(el) {
    const classes = String(el.getAttribute("class") || "").split(/\s+/).filter(Boolean);
    return (
      classes.find(
        (c) => /^[A-Za-z][\w-]{1,40}$/.test(c) && !/^(css|sc|jsx|svelte|emotion|chakra|mui)-/.test(c) && !UTILITY_CLASS.test(c) && !/\d{3,}/.test(c)
      ) || ""
    );
  }

  function nameFor(el) {
    const tag = el.tagName.toLowerCase();
    let base = tag;
    if (el.id && /^[A-Za-z][\w-]{0,40}$/.test(el.id)) base += `#${el.id}`;
    else {
      const cls = classHint(el);
      if (cls) base += `.${cls}`;
    }
    const label =
      el.getAttribute("aria-label") ||
      (/^h[1-6]$/.test(tag) ? el.textContent : "") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      "";
    const clean = String(label).replace(/\s+/g, " ").trim().slice(0, 40);
    return clean ? `${base} · ${clean}` : base;
  }

  /* ------------------------------------------------------------------ */
  /* Text                                                                */
  /* ------------------------------------------------------------------ */

  function renderedChildren(el) {
    if (el.shadowRoot) return Array.from(el.shadowRoot.childNodes);
    if (el.tagName === "SLOT") {
      const assigned = el.assignedNodes({ flatten: true });
      return assigned.length ? assigned : Array.from(el.childNodes);
    }
    return Array.from(el.childNodes);
  }

  function parseFamilies(stack) {
    return splitTop(stack, ",").map((f) => f.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
  }

  function decorationOf(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      const line = cs.textDecorationLine || "";
      if (line.includes("underline")) return "UNDERLINE";
      if (line.includes("line-through")) return "STRIKETHROUGH";
      // Decorations do not propagate into atomic or out-of-flow boxes.
      if (/inline-|^flex$|^grid$/.test(cs.display) && node !== el) break;
      if (cs.position === "absolute" || cs.position === "fixed" || cs.float !== "none") break;
      node = node.parentElement;
    }
    return "NONE";
  }

  function caseOf(transform) {
    return { uppercase: "UPPER", lowercase: "LOWER", capitalize: "TITLE" }[transform] || "ORIGINAL";
  }

  function segStyle(cs, el) {
    const families = parseFamilies(cs.fontFamily);
    const fill = parseColor(cs.webkitTextFillColor);
    const color = (fill && fill.a > 0 ? fill : parseColor(cs.color)) || { r: 0, g: 0, b: 0, a: 1 };
    const link = el && el.closest ? el.closest("a[href]") : null;
    const seg = {
      family: families[0] || "Inter",
      families,
      style: /italic|oblique/.test(cs.fontStyle) ? "italic" : "normal",
      weight: parseInt(cs.fontWeight, 10) || 400,
      size: r2(px(cs.fontSize)),
      lineHeightPx: cs.lineHeight === "normal" ? null : r2(px(cs.lineHeight)),
      letterSpacingPx: cs.letterSpacing === "normal" ? 0 : r2(px(cs.letterSpacing)),
      color,
      decoration: el ? decorationOf(el) : "NONE",
      case: caseOf(cs.textTransform)
    };
    if (link && link.href) seg.href = link.href;
    return seg;
  }

  function contentText(content, el) {
    if (!content || content === "none" || content === "normal") return null;
    let out = "";
    for (const tok of splitTop(content, " ")) {
      if (/^["']/.test(tok)) {
        out += tok
          .slice(1, -1)
          .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
          .replace(/\\(.)/g, "$1");
      } else {
        const attr = /^attr\(\s*([\w-]+)\s*\)$/.exec(tok);
        if (attr) out += el.getAttribute(attr[1]) || "";
      }
    }
    return out;
  }

  function whiteSpaceMode(cs) {
    const collapse = cs.whiteSpaceCollapse;
    if (collapse) return collapse === "preserve-spaces" ? "preserve" : collapse;
    const ws = cs.whiteSpace;
    if (ws === "pre" || ws === "pre-wrap" || ws === "break-spaces") return "preserve";
    if (ws === "pre-line") return "preserve-breaks";
    return "collapse";
  }

  /** Inline (non-box) pseudo text that flows with the element's text. */
  function inlinePseudoRun(el, which) {
    const pcs = getComputedStyle(el, which);
    const text = contentText(pcs.content, el);
    if (!text || pcs.display === "none" || pcs.position === "absolute" || pcs.position === "fixed") return null;
    if (pcs.display !== "inline" || hasBox(pcs)) return null;
    return { text, el, cs: pcs };
  }

  function boxPseudo(el, which) {
    const pcs = getComputedStyle(el, which);
    if (!pcs.content || pcs.content === "none" || pcs.content === "normal" || pcs.display === "none") return false;
    return hasBox(pcs) || pcs.position === "absolute" || pcs.position === "fixed" || pcs.display !== "inline";
  }

  function collectInline(el, runs, ctx) {
    for (const n of renderedChildren(el)) {
      if (n.nodeType === 3) runs.push({ text: n.data, el });
      else if (n.nodeType === 1) {
        if (n.tagName === "BR") {
          runs.push({ text: "\n", el, hard: true });
          continue;
        }
        const cs = getComputedStyle(n);
        if (cs.display === "none") continue;
        if (!ctx.opts.includeHidden && cs.visibility === "hidden") continue;
        const before = inlinePseudoRun(n, "::before");
        if (before) runs.push(before);
        collectInline(n, runs, ctx);
        const after = inlinePseudoRun(n, "::after");
        if (after) runs.push(after);
      }
    }
  }

  /** Element whose whole content is styled inline text (one TEXT layer). */
  function isTextLeaf(el) {
    let hasText = false;
    const pseudoText = (n) => {
      const a = inlinePseudoRun(n, "::before");
      const b = inlinePseudoRun(n, "::after");
      if ((a && a.text.trim()) || (b && b.text.trim())) hasText = true;
    };
    const walk = (node) => {
      for (const c of renderedChildren(node)) {
        if (c.nodeType === 3) {
          if (c.data.trim()) hasText = true;
        } else if (c.nodeType === 1) {
          if (c.tagName === "BR" || SKIP_TAGS.has(c.tagName)) continue;
          const cs = getComputedStyle(c);
          if (cs.display === "none") continue;
          if (cs.display !== "inline" && cs.display !== "contents") return false;
          if (REPLACED_TAGS.has(c.tagName.toUpperCase()) || c instanceof SVGElement) return false;
          if (hasBox(cs) || cs.position === "absolute" || cs.position === "fixed" || parseFloat(cs.opacity) < 1) return false;
          if (boxPseudo(c, "::before") || boxPseudo(c, "::after")) return false;
          pseudoText(c);
          if (!walk(c)) return false;
        }
      }
      return true;
    };
    pseudoText(el);
    return walk(el) && hasText;
  }

  /** Runs -> { characters, segments } with CSS white-space collapsing. */
  function buildText(runs) {
    const chars = [];
    const styles = [];
    const keys = [];
    let prevSpace = true;
    for (const run of runs) {
      const cs = run.cs || getComputedStyle(run.el);
      const mode = whiteSpaceMode(cs);
      let t = run.text;
      if (!run.hard) {
        if (mode === "collapse") t = t.replace(/[\t\n\r\f ]+/g, " ");
        else if (mode === "preserve-breaks") t = t.replace(/[\t\f ]+/g, " ").replace(/ ?\n ?/g, "\n");
        if (mode !== "preserve" && prevSpace && t.startsWith(" ")) t = t.slice(1);
      }
      if (!t) continue;
      prevSpace = /[ \n]$/.test(t);
      const style = segStyle(cs, run.el);
      const key = JSON.stringify(style);
      let idx = keys.indexOf(key);
      if (idx < 0) {
        keys.push(key);
        styles.push(style);
        idx = keys.length - 1;
      }
      for (const ch of t) chars.push([ch, idx]);
    }
    // Line-end spaces are not rendered.
    for (let i = chars.length - 1; i >= 0; i--) {
      if (chars[i][0] === " " && (i === chars.length - 1 || chars[i + 1][0] === "\n")) chars.splice(i, 1);
    }
    while (chars.length && chars[0][0] === " ") chars.shift();
    const segments = [];
    let characters = "";
    for (const [ch, idx] of chars) {
      const last = segments[segments.length - 1];
      if (last && last._idx === idx) last.end += ch.length;
      else segments.push({ _idx: idx, start: characters.length, end: characters.length + ch.length });
      characters += ch;
    }
    return {
      characters,
      segments: segments.map((s) => Object.assign({ start: s.start, end: s.end }, styles[s._idx]))
    };
  }

  function countLines(rects) {
    const list = Array.from(rects).filter((r) => r.width > 0 || r.height > 0).sort((a, b) => a.top - b.top);
    let lines = 0;
    let bottom = -Infinity;
    for (const r of list) {
      if (r.top >= bottom - 1) {
        lines++;
        bottom = r.bottom;
      } else bottom = Math.max(bottom, r.bottom);
    }
    return Math.max(lines, 1);
  }

  function alignOf(value) {
    return { center: "CENTER", right: "RIGHT", end: "RIGHT", justify: "JUSTIFIED" }[value] || "LEFT";
  }

  function makeText(built, box, align, lines, effects, ctx) {
    ctx.count++;
    for (const s of built.segments) ctx.addFont(s);
    return {
      type: "TEXT",
      name: built.characters.replace(/\s+/g, " ").trim().slice(0, 40) || "Texte",
      x: box.x,
      y: box.y,
      width: r2(box.width),
      height: r2(box.height),
      fills: [],
      strokes: [],
      strokeWeights: null,
      cornerRadii: [0, 0, 0, 0],
      effects: effects || [],
      opacity: 1,
      blendMode: "NORMAL",
      clipsContent: false,
      text: {
        characters: built.characters,
        segments: built.segments,
        align,
        // Single left-aligned lines hug, so font metric differences in Figma
        // never force a wrap; anything else keeps the measured width.
        autoResize: lines > 1 || align !== "LEFT" ? "HEIGHT" : "WIDTH_AND_HEIGHT"
      }
    };
  }

  const pageBox = (r, ctx) => ({ x: r.left + ctx.sx, y: r.top + ctx.sy, width: r.width, height: r.height });

  function contentBox(box, cs) {
    const l = px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const t = px(cs.borderTopWidth) + px(cs.paddingTop);
    const r = px(cs.borderRightWidth) + px(cs.paddingRight);
    const b = px(cs.borderBottomWidth) + px(cs.paddingBottom);
    return { x: box.x + l, y: box.y + t, width: Math.max(0, box.width - l - r), height: Math.max(0, box.height - t - b) };
  }

  function leafText(el, cs, box, ctx) {
    const runs = [];
    const before = inlinePseudoRun(el, "::before");
    if (before) runs.push(before);
    collectInline(el, runs, ctx);
    const after = inlinePseudoRun(el, "::after");
    if (after) runs.push(after);
    const built = buildText(runs);
    if (!built.characters) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = countLines(range.getClientRects());
    const inner = contentBox(box, cs);
    let tb = pageBox(range.getBoundingClientRect(), ctx);
    // Pseudo text is outside the Range; multi-line text wraps at the content width.
    if (before || after || !tb.width) tb = inner;
    else if (lines > 1) tb = { x: inner.x, y: tb.y, width: inner.width, height: tb.height };
    return makeText(built, tb, alignOf(cs.textAlign), lines, parseShadowList(cs.textShadow, false), ctx);
  }

  function rawTextNode(textNode, parentCs, ctx) {
    const built = buildText([{ text: textNode.data, el: textNode.parentElement, cs: parentCs }]);
    if (!built.characters) return null;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const box = pageBox(range.getBoundingClientRect(), ctx);
    if (!box.width || !box.height) return null;
    const lines = countLines(range.getClientRects());
    return makeText(built, box, alignOf(parentCs.textAlign), lines, parseShadowList(parentCs.textShadow, false), ctx);
  }

  /* ------------------------------------------------------------------ */
  /* Replaced elements                                                   */
  /* ------------------------------------------------------------------ */

  function rasterToDataUrl(source, w, h) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } catch (e) {
      return null; // tainted canvas
    }
  }

  function imageNode(el, cs, box, ctx) {
    ctx.count++;
    const node = visualNode("IMAGE", nameFor(el), box, cs, ctx);
    let url = el.currentSrc || el.src || "";
    if (url.startsWith("blob:")) url = rasterToDataUrl(el, el.naturalWidth, el.naturalHeight) || url;
    if (url) {
      const fit = cs.objectFit;
      const id = ctx.addImage(url, el.naturalWidth, el.naturalHeight);
      node.fills.push({ type: "IMAGE", imageId: id, scaleMode: fit === "contain" || fit === "scale-down" ? "FIT" : "FILL" });
      node.imageId = id;
    }
    return node;
  }

  function mediaNode(el, cs, box, ctx) {
    ctx.count++;
    const node = visualNode("IMAGE", nameFor(el), box, cs, ctx);
    let url = null;
    if (el.tagName === "CANVAS") {
      try {
        url = el.toDataURL("image/png");
      } catch (e) {
        url = null;
      }
    } else if (el.tagName === "VIDEO") {
      url = el.poster || (el.videoWidth ? rasterToDataUrl(el, el.videoWidth, el.videoHeight) : null);
    }
    if (url) {
      const id = ctx.addImage(url);
      node.fills.push({ type: "IMAGE", imageId: id, scaleMode: cs.objectFit === "cover" ? "FILL" : "FIT" });
      node.imageId = id;
    } else {
      node.type = "RECTANGLE";
      if (!node.fills.length) node.fills.push(solidPaint({ r: 0.1, g: 0.1, b: 0.1, a: 1 }));
    }
    return node;
  }

  function serializeSvg(el, cs, box) {
    const clone = el.cloneNode(true); // detached copy, the page is untouched
    const originals = [el, ...el.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    const inDefs = (n) => !!(n.closest && n.closest("defs, symbol, clipPath, mask, pattern, marker, linearGradient, radialGradient"));
    originals.forEach((orig, i) => {
      const copy = copies[i];
      if (!copy) return;
      const ocs = getComputedStyle(orig);
      // Resolve CSS-driven paints (classes, currentColor) into attributes.
      for (const prop of ["fill", "stroke"]) {
        const v = ocs[prop];
        if (v && (v === "none" || /^rgba?\(/.test(v))) copy.setAttribute(prop, v);
      }
      if (ocs.stroke && ocs.stroke !== "none") copy.setAttribute("stroke-width", String(px(ocs.strokeWidth)));
      if (orig.tagName.toLowerCase() === "stop") {
        copy.setAttribute("stop-color", ocs.stopColor);
        copy.setAttribute("stop-opacity", ocs.stopOpacity);
      }
      for (const [prop, attr] of [["opacity", "opacity"], ["fillOpacity", "fill-opacity"], ["strokeOpacity", "stroke-opacity"]]) {
        if (ocs[prop] && ocs[prop] !== "1") copy.setAttribute(attr, ocs[prop]);
      }
      if (i > 0 && !inDefs(orig) && (ocs.display === "none" || ocs.visibility === "hidden")) copy.setAttribute("display", "none");
    });
    // <use> pointing at sprites outside this <svg>: inline the referenced symbols.
    let defs = null;
    for (const use of clone.querySelectorAll("use")) {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
      if (!href.startsWith("#")) continue;
      const id = href.slice(1);
      if (clone.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
      const ref = document.getElementById(id);
      if (!ref) continue;
      if (!defs) {
        defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        clone.insertBefore(defs, clone.firstChild);
      }
      defs.appendChild(ref.cloneNode(true));
    }
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(r2(box.width)));
    clone.setAttribute("height", String(r2(box.height)));
    clone.removeAttribute("class");
    clone.removeAttribute("style");
    return new XMLSerializer().serializeToString(clone).replace(/currentColor/gi, cs.color);
  }

  function svgNode(el, cs, box, ctx) {
    ctx.count++;
    const node = visualNode("SVG", nameFor(el), box, cs, ctx);
    node.svg = serializeSvg(el, cs, box);
    return node;
  }

  function fieldNode(el, cs, box, ctx) {
    ctx.count++;
    const node = visualNode("FRAME", nameFor(el), box, cs, ctx);
    meta.set(node, { tag: el.tagName });
    node.children = [];
    const type = String(el.getAttribute("type") || "").toLowerCase();
    if (el.tagName === "INPUT" && (type === "checkbox" || type === "radio")) {
      if (!node.strokes.length) {
        node.strokes = [solidPaint({ r: 0.46, g: 0.46, b: 0.46, a: 1 })];
        node.strokeWeights = { top: 1, right: 1, bottom: 1, left: 1 };
      }
      const r = type === "radio" ? box.width / 2 : 2;
      if (!node.cornerRadii.some(Boolean)) node.cornerRadii = [r, r, r, r];
      if (el.checked) node.fills = [solidPaint(parseColor(cs.accentColor) || { r: 0.1, g: 0.45, b: 0.91, a: 1 })];
      return node;
    }
    let value = el.tagName === "SELECT" ? (el.selectedOptions[0] ? el.selectedOptions[0].text : "") : el.value;
    let tcs = cs;
    if (!value && el.placeholder) {
      value = el.placeholder;
      tcs = getComputedStyle(el, "::placeholder");
    }
    if (type === "password" && el.value) value = "•".repeat(el.value.length);
    if (!value) return node;
    const built = buildText([{ text: value, el, cs: tcs }]);
    if (!built.characters) return node;
    const inner = contentBox(box, cs);
    const size = px(tcs.fontSize) || 14;
    const lh = tcs.lineHeight === "normal" ? size * 1.2 : px(tcs.lineHeight);
    const tb =
      el.tagName === "TEXTAREA"
        ? inner
        : { x: inner.x, y: inner.y + (inner.height - lh) / 2, width: inner.width, height: lh };
    const text = makeText(built, tb, alignOf(cs.textAlign), el.tagName === "TEXTAREA" ? 2 : 1, [], ctx);
    text.text.autoResize = "HEIGHT";
    node.children.push(text);
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* Pseudo-elements                                                     */
  /* ------------------------------------------------------------------ */

  function pseudoItem(el, which, box, cs, ctx, leaf) {
    const pcs = getComputedStyle(el, which);
    const text = contentText(pcs.content, el);
    if (text === null || pcs.display === "none") return null;
    const visual = hasBox(pcs);
    if (!visual && !text.trim()) return null;
    // Inline text pseudo of a text leaf is already part of its text flow.
    if (leaf && !visual && pcs.display === "inline" && pcs.position !== "absolute" && pcs.position !== "fixed") return null;
    const extraW = pcs.boxSizing === "content-box" ? px(pcs.paddingLeft) + px(pcs.paddingRight) + px(pcs.borderLeftWidth) + px(pcs.borderRightWidth) : 0;
    const extraH = pcs.boxSizing === "content-box" ? px(pcs.paddingTop) + px(pcs.paddingBottom) + px(pcs.borderTopWidth) + px(pcs.borderBottomWidth) : 0;
    let w = px(pcs.width) + extraW;
    let h = px(pcs.height) + extraH;
    if (!px(pcs.width) && text) {
      // `auto` width on inline pseudo content: measure the glyph run.
      try {
        const canvas = document.createElement("canvas").getContext("2d");
        canvas.font = pcs.font;
        w = canvas.measureText(text).width + extraW;
      } catch (e) {
        w = text.length * px(pcs.fontSize) * 0.6;
      }
    }
    if (!px(pcs.height)) h = (pcs.lineHeight === "normal" ? px(pcs.fontSize) * 1.2 : px(pcs.lineHeight)) + extraH;
    const absolute = pcs.position === "absolute" || pcs.position === "fixed";
    let x;
    let y;
    if (absolute) {
      const cbEl = pcs.position === "fixed" ? null : cs.position !== "static" ? el : el.offsetParent;
      let ox = ctx.sx;
      let oy = ctx.sy;
      let pw = innerWidth;
      let ph = innerHeight;
      if (cbEl) {
        const cr = cbEl.getBoundingClientRect();
        const ccs = getComputedStyle(cbEl);
        ox = cr.left + ctx.sx + px(ccs.borderLeftWidth);
        oy = cr.top + ctx.sy + px(ccs.borderTopWidth);
        pw = cr.width - px(ccs.borderLeftWidth) - px(ccs.borderRightWidth);
        ph = cr.height - px(ccs.borderTopWidth) - px(ccs.borderBottomWidth);
      }
      x = pcs.left !== "auto" ? ox + px(pcs.left) + px(pcs.marginLeft) : pcs.right !== "auto" ? ox + pw - px(pcs.right) - w - px(pcs.marginRight) : ox;
      y = pcs.top !== "auto" ? oy + px(pcs.top) + px(pcs.marginTop) : pcs.bottom !== "auto" ? oy + ph - px(pcs.bottom) - h - px(pcs.marginBottom) : oy;
    } else {
      // No geometry API for pseudo-elements: in-flow ones are placed at the
      // content edge and flagged approximate (the parent then stays absolute).
      const inner = contentBox(box, cs);
      x = which === "::before" ? inner.x : inner.x + inner.width - w;
      y = inner.y;
    }
    const pbox = { x, y, width: w, height: h };
    let node;
    if (visual) {
      ctx.count++;
      node = visualNode("FRAME", which, pbox, pcs, ctx);
      meta.set(node, { tag: which });
      node.children = [];
      if (text.trim()) {
        const built = buildText([{ text, el, cs: pcs }]);
        const t = makeText(built, contentBox(pbox, pcs), alignOf(pcs.textAlign), 1, parseShadowList(pcs.textShadow, false), ctx);
        t.text.autoResize = "HEIGHT";
        node.children.push(t);
      }
    } else {
      const built = buildText([{ text, el, cs: pcs }]);
      node = makeText(built, pbox, alignOf(pcs.textAlign), 1, parseShadowList(pcs.textShadow, false), ctx);
      node.name = `${which} ${node.name}`;
    }
    return { node, el: null, display: pcs.display, absolute, approx: !absolute, pseudo: true };
  }

  /* ------------------------------------------------------------------ */
  /* Auto-layout inference                                               */
  /* ------------------------------------------------------------------ */

  function uniformGap(rects, isRow) {
    const gaps = [];
    for (let i = 1; i < rects.length; i++) {
      const a = rects[i - 1];
      const b = rects[i];
      gaps.push(isRow ? b.x - (a.x + a.width) : b.y - (a.y + a.height));
    }
    if (gaps.some((g) => Math.abs(g - (gaps[0] || 0)) > TOL)) return null;
    return r2(gaps[0] || 0);
  }

  /** Replays Figma's stack placement and compares with measured rects. */
  function verify(spec, parent, rects) {
    const isRow = spec.mode === "HORIZONTAL";
    const [pt, pr, pb, pl] = spec.padding;
    const lead = isRow ? pl : pt;
    const trail = isRow ? pr : pb;
    const crossLead = isRow ? pt : pl;
    const crossTrail = isRow ? pb : pr;
    const main = (r) => (isRow ? r.width : r.height);
    const cross = (r) => (isRow ? r.height : r.width);
    const inner = (isRow ? parent.width : parent.height) - lead - trail;
    const innerCross = (isRow ? parent.height : parent.width) - crossLead - crossTrail;
    const total = rects.reduce((n, r) => n + main(r), 0);
    let gap = spec.gap;
    let cursor = lead;
    if (spec.primaryAlign === "CENTER") cursor += (inner - total - gap * (rects.length - 1)) / 2;
    else if (spec.primaryAlign === "MAX") cursor += inner - total - gap * (rects.length - 1);
    else if (spec.primaryAlign === "SPACE_BETWEEN") gap = rects.length > 1 ? (inner - total) / (rects.length - 1) : 0;
    for (const r of rects) {
      let expectedCross = crossLead;
      if (spec.counterAlign === "CENTER") expectedCross += (innerCross - cross(r)) / 2;
      else if (spec.counterAlign === "MAX") expectedCross += innerCross - cross(r);
      if (Math.abs((isRow ? r.x : r.y) - cursor) > TOL || Math.abs((isRow ? r.y : r.x) - expectedCross) > TOL) return false;
      cursor += main(r) + gap;
    }
    return true;
  }

  // Typed OM keeps `auto`-style keywords that getComputedStyle resolves away.
  function contentSizedKeyword(el, prop) {
    if (!el || typeof el.computedStyleMap !== "function") return false;
    try {
      const v = el.computedStyleMap().get(prop);
      return !!v && v.constructor && v.constructor.name === "CSSKeywordValue" && CONTENT_KEYWORDS.has(v.value);
    } catch (e) {
      return false;
    }
  }

  function contentDriven(el, cs, prop) {
    if (!contentSizedKeyword(el, prop)) return false;
    const parent = el.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    if (pcs && pcs.display.includes("flex")) {
      const isMain = (prop === "width") === pcs.flexDirection.startsWith("row");
      if (isMain) return true;
      const self = cs.alignSelf === "auto" || cs.alignSelf === "normal" ? pcs.alignItems : cs.alignSelf;
      return self !== "stretch" && self !== "normal";
    }
    if (prop === "height") return true;
    return /^inline/.test(cs.display) || cs.position === "absolute" || cs.position === "fixed" || cs.float !== "none";
  }

  /** HUG per axis only when CSS is content-sized and hugging is a no-op. */
  function ownSizing(el, cs, spec, parent, rects) {
    const isRow = spec.mode === "HORIZONTAL";
    const [pt, pr, pb, pl] = spec.padding;
    const sizing = { horizontal: "FIXED", vertical: "FIXED" };
    if (!el) return sizing;
    const mainContent = rects.reduce((n, r) => n + (isRow ? r.width : r.height), 0) + spec.gap * (rects.length - 1) + (isRow ? pl + pr : pt + pb);
    const crossContent = Math.max(...rects.map((r) => (isRow ? r.height : r.width))) + (isRow ? pt + pb : pl + pr);
    const mainProp = isRow ? "width" : "height";
    const crossProp = isRow ? "height" : "width";
    const growers = spec.primaryAlign === "SPACE_BETWEEN" || spec.hasGrower;
    if (!spec.wrap && !growers && contentDriven(el, cs, mainProp) && Math.abs(parent[mainProp] - mainContent) <= TOL) {
      sizing[isRow ? "horizontal" : "vertical"] = "HUG";
    }
    const crossActual = spec.crossContent !== undefined ? spec.crossContent : crossContent;
    if (contentDriven(el, cs, crossProp) && Math.abs(parent[crossProp] - crossActual) <= TOL) {
      sizing[isRow ? "vertical" : "horizontal"] = "HUG";
    }
    return sizing;
  }

  /** Per-child FILL: flex-grow matching Figma's equal split, and stretch. */
  function childFills(spec, cs, flow, rects, parent) {
    const isRow = spec.mode === "HORIZONTAL";
    const [pt, pr, pb, pl] = spec.padding;
    const inner = (isRow ? parent.width - pl - pr : parent.height - pt - pb);
    const innerCross = (isRow ? parent.height - pt - pb : parent.width - pl - pr);
    const main = (r) => (isRow ? r.width : r.height);
    const cross = (r) => (isRow ? r.height : r.width);
    const mainKey = isRow ? "horizontal" : "vertical";
    const crossKey = isRow ? "vertical" : "horizontal";
    const growers = flow.filter((it) => it.cs && parseFloat(it.cs.flexGrow) > 0);
    if (growers.length && !spec.wrap) {
      const fixed = flow.reduce((n, it, i) => (growers.includes(it) ? n : n + main(rects[i])), 0);
      const share = (inner - fixed - spec.gap * (flow.length - 1)) / growers.length;
      const ok = flow.every((it, i) => !growers.includes(it) || Math.abs(main(rects[i]) - share) <= TOL);
      if (ok) growers.forEach((it) => (it.fill = Object.assign(it.fill || {}, { [mainKey]: "FILL" })));
    }
    flow.forEach((it, i) => {
      if (!it.el || !it.cs) return;
      const self = it.cs.alignSelf === "auto" || it.cs.alignSelf === "normal" ? cs.alignItems : it.cs.alignSelf;
      const isFlexOrGrid = /flex|grid/.test(cs.display);
      const stretches = isFlexOrGrid ? self === "stretch" || self === "normal" : true;
      if (stretches && contentSizedKeyword(it.el, isRow ? "height" : "width") && Math.abs(cross(rects[i]) - innerCross) <= TOL) {
        it.fill = Object.assign(it.fill || {}, { [crossKey]: "FILL" });
      }
    });
  }

  function padOf(cs) {
    return [
      r2(px(cs.borderTopWidth) + px(cs.paddingTop)),
      r2(px(cs.borderRightWidth) + px(cs.paddingRight)),
      r2(px(cs.borderBottomWidth) + px(cs.paddingBottom)),
      r2(px(cs.borderLeftWidth) + px(cs.paddingLeft))
    ];
  }

  function flexSpec(cs, rects, parent) {
    if (cs.flexDirection.endsWith("reverse")) return null;
    const isRow = cs.flexDirection.startsWith("row");
    const primaryAlign = JUSTIFY[cs.justifyContent];
    const counterAlign = ALIGN[cs.alignItems];
    if (!primaryAlign || !counterAlign) return null;
    const gap = uniformGap(rects, isRow);
    if (gap === null) return null;
    const spec = { mode: isRow ? "HORIZONTAL" : "VERTICAL", gap, primaryAlign, counterAlign, padding: padOf(cs) };
    return verify(spec, parent, rects) ? spec : null;
  }

  // Multi-line flex rows: accepted only when Figma's greedy wrap packing
  // reproduces the browser's row breaks and positions exactly.
  function wrapSpec(cs, flow, rects, parent) {
    if (cs.flexDirection !== "row" || cs.flexWrap !== "wrap") return null;
    if (JUSTIFY[cs.justifyContent] !== "MIN" || ALIGN[cs.alignItems] !== "MIN") return null;
    if (flow.some((it) => it.cs && parseFloat(it.cs.flexGrow) > 0)) return null;
    const [pt, pr, pb, pl] = padOf(cs);
    const rows = groupRows(rects);
    const inRow = [];
    rows.forEach((row) => row.slice(1).forEach((idx, k) => inRow.push(rects[idx].x - (rects[row[k]].x + rects[row[k]].width))));
    const gap = r2(inRow[0] || 0);
    if (inRow.some((g) => Math.abs(g - gap) > TOL)) return null;
    const heights = rows.map((row) => Math.max(...row.map((i) => rects[i].height)));
    const rowGaps = rows.slice(1).map((row, r) => rects[row[0]].y - (rects[rows[r][0]].y + heights[r]));
    const counterGap = r2(rowGaps[0] || 0);
    if (counterGap < -TOL || rowGaps.some((g) => Math.abs(g - counterGap) > TOL)) return null;
    let x = pl;
    let y = pt;
    let rowH = 0;
    let start = true;
    for (const r of rects) {
      if (!start && x + r.width - (parent.width - pr) > TOL) {
        y += rowH + counterGap;
        x = pl;
        rowH = 0;
      }
      if (Math.abs(r.x - x) > TOL || Math.abs(r.y - y) > TOL) return null;
      x += r.width + gap;
      rowH = Math.max(rowH, r.height);
      start = false;
    }
    return {
      mode: "HORIZONTAL", gap, counterGap, wrap: true, primaryAlign: "MIN", counterAlign: "MIN",
      padding: [pt, pr, pb, pl],
      crossContent: pt + pb + heights.reduce((n, hh) => n + hh, 0) + counterGap * (rows.length - 1)
    };
  }

  function groupRows(rects) {
    const rows = [];
    let top = -Infinity;
    rects.forEach((r, i) => {
      if (Math.abs(r.y - top) > TOL) {
        rows.push([]);
        top = r.y;
      }
      rows[rows.length - 1].push(i);
    });
    return rows;
  }

  function blockSpec(cs, flow, rects, parent) {
    if (flow.length > 1 && flow.some((it) => !BLOCK_LEVEL.has(it.display) || (it.cs && it.cs.float !== "none"))) return null;
    const gap = uniformGap(rects, false);
    if (gap === null) return null;
    const [, pr, , pl] = padOf(cs);
    // Vertical paddings are measured: first/last margins fold into them.
    const top = rects[0].y;
    const last = rects[rects.length - 1];
    const bottom = parent.height - (last.y + last.height);
    if (top < -TOL || bottom < -TOL) return null;
    for (const counterAlign of ["MIN", "CENTER", "MAX"]) {
      const spec = { mode: "VERTICAL", gap, primaryAlign: "MIN", counterAlign, padding: [r2(Math.max(0, top)), pr, r2(Math.max(0, bottom)), pl] };
      if (verify(spec, parent, rects)) return spec;
    }
    return null;
  }

  /*
   * Regular CSS grids become rows of horizontal auto-layout: one row maps to
   * the container itself, several rows to a vertical stack of row frames.
   */
  function gridSpec(cs, flow, rects, parent, container, ctx) {
    const rows = groupRows(rects);
    if (rows.length === 1) {
      const gap = uniformGap(rects, true);
      if (gap === null) return null;
      const spec = { mode: "HORIZONTAL", gap, primaryAlign: JUSTIFY[cs.justifyContent] || "MIN", counterAlign: "MIN", padding: padOf(cs) };
      return verify(spec, parent, rects) ? spec : null;
    }
    if (rows.every((row) => row.length === 1)) return blockSpec(cs, flow.length > 1 ? flow.map((it) => Object.assign({}, it, { display: "block" })) : flow, rects, parent);
    const colGaps = [];
    for (const row of rows) {
      for (let k = 1; k < row.length; k++) colGaps.push(rects[row[k]].x - (rects[row[k - 1]].x + rects[row[k - 1]].width));
      if (row.slice(1).some((idx) => Math.abs(rects[idx].y - rects[row[0]].y) > TOL)) return null;
    }
    const colGap = r2(colGaps[0] || 0);
    if (colGaps.some((g) => Math.abs(g - colGap) > TOL)) return null;
    const firstX = rects[rows[0][0]].x;
    if (rows.some((row) => Math.abs(rects[row[0]].x - firstX) > TOL)) return null;
    const rowRects = rows.map((row) => {
      const items = row.map((i) => rects[i]);
      const x = items[0].x;
      const y = Math.min(...items.map((r) => r.y));
      const right = items[items.length - 1].x + items[items.length - 1].width;
      const bottom = Math.max(...items.map((r) => r.y + r.height));
      return { x, y, width: right - x, height: bottom - y };
    });
    const rowGap = uniformGap(rowRects, false);
    if (rowGap === null) return null;
    const spec = { mode: "VERTICAL", gap: rowGap, primaryAlign: "MIN", counterAlign: "MIN", padding: padOf(cs) };
    if (!verify(spec, parent, rowRects)) return null;
    spec.rows = rows.map((row, n) => {
      const rr = rowRects[n];
      ctx.count++;
      const rowNode = {
        type: "FRAME", name: `Ligne ${n + 1}`,
        x: container.x + rr.x, y: container.y + rr.y, width: r2(rr.width), height: r2(rr.height),
        fills: [], strokes: [], strokeWeights: null, cornerRadii: [0, 0, 0, 0], effects: [],
        opacity: 1, blendMode: "NORMAL", clipsContent: false,
        layout: {
          mode: "HORIZONTAL", wrap: "NO_WRAP", gap: colGap, counterGap: null, padding: [0, 0, 0, 0],
          primaryAlign: "MIN", counterAlign: "MIN", sizing: { horizontal: "HUG", vertical: "HUG" }
        },
        children: row.map((i) => flow[i].node)
      };
      meta.set(rowNode, { tag: "ROW" });
      return rowNode;
    });
    return spec;
  }

  function inferLayout(container, el, cs, items, ctx) {
    const flow = items.filter((it) => !it.absolute);
    const abs = items.filter((it) => it.absolute);
    if (!flow.length || flow.some((it) => it.approx || (it.cs && it.cs.order !== "0"))) return null;
    const rects = flow.map((it) => ({ x: it.node.x - container.x, y: it.node.y - container.y, width: it.node.width, height: it.node.height }));
    const parent = { width: container.width, height: container.height };
    const d = cs.display;
    let spec = null;
    if (d.includes("flex")) spec = cs.flexWrap === "nowrap" ? flexSpec(cs, rects, parent) : wrapSpec(cs, flow, rects, parent);
    else if (d.includes("grid")) spec = gridSpec(cs, flow, rects, parent, container, ctx);
    else spec = blockSpec(cs, flow, rects, parent);
    if (!spec) return null;
    spec.hasGrower = flow.some((it) => it.cs && parseFloat(it.cs.flexGrow) > 0);
    if (!spec.rows) childFills(spec, cs, flow, rects, parent);
    const sizingRects = spec.rows ? spec.rows.map((r) => ({ x: r.x - container.x, y: r.y - container.y, width: r.width, height: r.height })) : rects;
    const layout = {
      mode: spec.mode,
      wrap: spec.wrap ? "WRAP" : "NO_WRAP",
      gap: spec.gap,
      counterGap: spec.wrap ? spec.counterGap : null,
      padding: spec.padding,
      primaryAlign: spec.primaryAlign,
      counterAlign: spec.counterAlign,
      sizing: ownSizing(el, cs, spec, parent, sizingRects)
    };
    // FILL on an axis the container hugs would be circular in Figma.
    const crossKey = spec.mode === "HORIZONTAL" ? "vertical" : "horizontal";
    if (layout.sizing[crossKey] === "HUG") flow.forEach((it) => it.fill && delete it.fill[crossKey]);
    for (const it of flow) {
      if (it.fill && Object.keys(it.fill).length) it.node.sizing = Object.assign({ horizontal: "FIXED", vertical: "FIXED" }, it.fill);
    }
    for (const it of abs) it.node.layoutPositioning = "ABSOLUTE";
    return { layout, children: spec.rows ? [...spec.rows, ...abs.map((it) => it.node)] : items.map((it) => it.node) };
  }

  const NONE_LAYOUT = () => ({
    mode: "NONE", wrap: "NO_WRAP", gap: 0, counterGap: null, padding: [0, 0, 0, 0],
    primaryAlign: "MIN", counterAlign: "MIN", sizing: { horizontal: "FIXED", vertical: "FIXED" }
  });

  /* ------------------------------------------------------------------ */
  /* Tree walk                                                           */
  /* ------------------------------------------------------------------ */

  function isWrapper(node) {
    const m = meta.get(node);
    const tag = m ? m.tag : "";
    return (
      isPlain(node) &&
      (FLATTENABLE.has(tag) || String(tag).includes("-")) &&
      (!node.layout || node.layout.mode === "NONE")
    );
  }

  function collectChild(child, items, parentCs, ctx) {
    if (ctx.count >= ctx.opts.maxNodes) {
      ctx.truncated = true;
      return;
    }
    if (child.nodeType === 3) {
      if (!child.data.trim()) return;
      const t = rawTextNode(child, parentCs, ctx);
      if (t) items.push({ node: t, el: null, display: "inline" });
      return;
    }
    if (child.nodeType !== 1) return;
    const ccs = getComputedStyle(child);
    if (ccs.display === "contents") {
      for (const g of renderedChildren(child)) collectChild(g, items, ccs, ctx);
      return;
    }
    const node = captureElement(child, ctx);
    if (!node) return;
    items.push({
      node,
      el: child,
      cs: ccs,
      display: ccs.display,
      absolute: ccs.position === "absolute" || ccs.position === "fixed"
    });
  }

  function containerNode(el, cs, box, ctx) {
    ctx.count++;
    const node = visualNode("FRAME", nameFor(el), box, cs, ctx);
    meta.set(node, { tag: el.tagName.toUpperCase() });
    const items = [];
    const leaf = isTextLeaf(el);
    const before = pseudoItem(el, "::before", box, cs, ctx, leaf);
    const after = pseudoItem(el, "::after", box, cs, ctx, leaf);
    if (before) items.push(before);
    if (leaf) {
      const text = leafText(el, cs, box, ctx);
      const noInset = padOf(cs).every((p) => p === 0);
      if (text && !before && !after && isPlain(node) && noInset) {
        // Bare text element: the element box is the text layer.
        Object.assign(text, { x: box.x, y: box.y, width: r2(box.width), height: r2(box.height) });
        if (text.text.autoResize === "WIDTH_AND_HEIGHT" && cs.textAlign !== "start" && cs.textAlign !== "left") text.text.autoResize = "HEIGHT";
        ctx.count--;
        return text;
      }
      if (text) items.push({ node: text, el: null, display: "inline" });
    } else {
      for (const child of renderedChildren(el)) collectChild(child, items, cs, ctx);
    }
    if (after) items.push(after);

    const res = items.length ? inferLayout(node, el, cs, items, ctx) : null;
    let kids;
    if (res) {
      node.layout = res.layout;
      kids = res.children;
    } else {
      kids = [];
      for (const it of items) {
        if (it.node.type === "FRAME" && isWrapper(it.node)) kids.push(...(it.node.children || []));
        else kids.push(it.node);
      }
      // Empty plain frames only matter as spacers inside auto-layout.
      kids = kids.filter((k) => !(k.type === "FRAME" && isPlain(k) && !(k.children && k.children.length)));
      if (kids.length) node.layout = NONE_LAYOUT();
    }
    node.children = kids;
    // A plain generic wrapper around one child of the same box adds nothing.
    if (isPlain(node) && FLATTENABLE.has(el.tagName.toUpperCase()) && kids.length === 1) {
      const k = kids[0];
      if (Math.abs(k.x - node.x) <= TOL && Math.abs(k.y - node.y) <= TOL && Math.abs(k.width - node.width) <= TOL && Math.abs(k.height - node.height) <= TOL) {
        delete k.sizing;
        delete k.layoutPositioning;
        ctx.count--;
        return k;
      }
    }
    return node;
  }

  function captureElement(el, ctx) {
    if (ctx.count >= ctx.opts.maxNodes) {
      ctx.truncated = true;
      return null;
    }
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return null;
    const hidden = cs.visibility !== "visible" || parseFloat(cs.opacity) === 0;
    if (hidden && !ctx.opts.includeHidden) return null;
    const box = pageBox(el.getBoundingClientRect(), ctx);
    const clips = clipsOf(cs);
    if (clips && (box.width < 0.5 || box.height < 0.5 || (box.width <= 1 && box.height <= 1))) return null;
    let node;
    if (tag === "SVG" && el instanceof SVGSVGElement) node = svgNode(el, cs, box, ctx);
    else if (el instanceof SVGElement) return null;
    else if (tag === "IMG") node = imageNode(el, cs, box, ctx);
    else if (tag === "VIDEO" || tag === "CANVAS") node = mediaNode(el, cs, box, ctx);
    else if (tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED") {
      ctx.count++;
      node = visualNode("RECTANGLE", nameFor(el), box, cs, ctx);
      if (!node.fills.length) node.fills.push(solidPaint({ r: 0.93, g: 0.93, b: 0.93, a: 1 }));
    } else if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") node = fieldNode(el, cs, box, ctx);
    else node = containerNode(el, cs, box, ctx);
    if (!node) return null;
    if (el.getAttribute("aria-hidden") === "true" && node.type === "FRAME" && isPlain(node) && !(node.children && node.children.length)) return null;
    if (hidden) node.visible = false;
    return node;
  }

  function captureRoot(rootEl, ctx) {
    const title = document.title || location.hostname || "Page";
    if (rootEl === document.body || rootEl === document.documentElement) {
      const docEl = document.documentElement;
      const body = document.body;
      const W = Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0, docEl.clientWidth);
      const H = Math.max(docEl.scrollHeight, body ? body.scrollHeight : 0, docEl.clientHeight);
      let fills = backgroundPaints(getComputedStyle(docEl), W, H, ctx);
      const bodyNode = body ? captureElement(body, ctx) : null;
      // With a transparent <html>, the body background paints the canvas.
      if (!fills.length && bodyNode && bodyNode.type === "FRAME" && bodyNode.fills.length) {
        fills = bodyNode.fills;
        bodyNode.fills = [];
      }
      if (!fills.length) fills = [solidPaint({ r: 1, g: 1, b: 1, a: 1 })];
      ctx.count++;
      const root = {
        type: "FRAME", name: title, x: 0, y: 0, width: r2(W), height: r2(H),
        fills, strokes: [], strokeWeights: null, cornerRadii: [0, 0, 0, 0], effects: [],
        opacity: 1, blendMode: "NORMAL", clipsContent: true, layout: NONE_LAYOUT(), children: []
      };
      meta.set(root, { tag: "ROOT" });
      if (bodyNode) {
        const plainNone = bodyNode.type === "FRAME" && isPlain(bodyNode) && (!bodyNode.layout || bodyNode.layout.mode === "NONE");
        root.children = plainNone ? bodyNode.children || [] : [bodyNode];
      }
      return root;
    }
    const node = captureElement(rootEl, ctx);
    if (!node) throw new Error("Keys_Osi : l'élément ciblé n'est pas visible.");
    node.name = title;
    node.clipsContent = true;
    delete node.sizing;
    delete node.layoutPositioning;
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* Components and output                                               */
  /* ------------------------------------------------------------------ */

  function signature(node, memo) {
    if (memo.has(node)) return memo.get(node);
    let s;
    if (node.type === "FRAME") {
      const m = meta.get(node);
      s = `F:${m ? m.tag : ""}:${node.layout ? node.layout.mode : "NONE"}`;
    } else if (node.type === "SVG") {
      // Instances cannot swap vector content, so different icons are different structures.
      s = `SVG:${hashString(node.svg || "")}`;
    } else s = node.type;
    if (node.children && node.children.length) s += `[${node.children.map((c) => signature(c, memo)).join(",")}]`;
    memo.set(node, s);
    return s;
  }

  /** Flags sibling frames sharing a subtree signature (3+) as component candidates. */
  function flagComponents(node, memo) {
    const kids = node.children || [];
    const groups = new Map();
    for (const k of kids) {
      if (k.type !== "FRAME" || !(k.children && k.children.length)) continue;
      const s = signature(k, memo);
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(k);
    }
    for (const [s, list] of groups) {
      if (list.length >= 3) list.forEach((k) => (k.componentCandidate = `c${hashString(s)}`));
    }
    kids.forEach((k) => flagComponents(k, memo));
  }

  /** Absolute page coords -> parent-relative, rounded; drops empty fields. */
  function finalize(node, ox, oy) {
    const ax = node.x;
    const ay = node.y;
    node.x = r2(ax - ox);
    node.y = r2(ay - oy);
    if (node.children) {
      node.children.forEach((c) => finalize(c, ax, ay));
      if (!node.children.length && node.type !== "FRAME") delete node.children;
    } else if (node.type === "FRAME") node.children = [];
    return node;
  }

  function loadNaturalSize(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 2000);
      img.onload = () => {
        clearTimeout(timer);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    });
  }

  async function capture(options) {
    const opts = Object.assign({ selector: null, maxNodes: 5000, includeHidden: false }, options || {});
    const rootEl = opts.selector ? document.querySelector(opts.selector) : document.body;
    if (!rootEl) throw new Error(`Keys_Osi : sélecteur introuvable (${opts.selector}).`);
    meta = new WeakMap();
    try {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    } catch (e) {
      // fonts API unavailable: capture with whatever is rendered
    }
    const images = new Map();
    const fonts = new Map();
    const ctx = {
      opts,
      count: 0,
      truncated: false,
      sx: window.scrollX,
      sy: window.scrollY,
      pendingTiles: [],
      addImage(url, width, height) {
        if (!images.has(url)) {
          const entry = { id: `img-${images.size + 1}`, url };
          if (width && height) Object.assign(entry, { width, height });
          images.set(url, entry);
        }
        return images.get(url).id;
      },
      addFont(seg) {
        const key = `${seg.family}|${seg.style}|${seg.weight}`;
        if (!fonts.has(key)) fonts.set(key, { family: seg.family, style: seg.style, weight: seg.weight });
      }
    };
    const root = captureRoot(rootEl, ctx);
    if (ctx.pendingTiles.length) {
      const byId = new Map([...images.values()].map((e) => [e.id, e]));
      await Promise.all(
        ctx.pendingTiles.map(async (tile) => {
          const entry = byId.get(tile.id);
          const size = entry.width ? entry : await loadNaturalSize(entry.url);
          if (size && size.width) {
            entry.width = size.width;
            entry.height = size.height;
            tile.paint.scalingFactor = r4(tile.tileW / size.width);
          }
        })
      );
    }
    flagComponents(root, new Map());
    finalize(root, root.x, root.y);
    root.x = 0;
    root.y = 0;
    return {
      format: "keys-osi-figma",
      version: 1,
      source: {
        url: location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        capturedAt: new Date().toISOString()
      },
      root,
      images: [...images.values()],
      fonts: [...fonts.values()],
      stats: { nodes: ctx.count, truncated: ctx.truncated, maxNodes: opts.maxNodes }
    };
  }

  // Re-injection simply re-binds the same pure function.
  window.__keysOsiFigmaCapture = capture;
})();
