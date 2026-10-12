// Keys_Osi Import — Figma plugin main thread.
// Rebuilds a Keys_Osi page capture ("keys-osi-figma" v1, produced by
// figma-capture.js) as editable layers, or imports Keys_Osi W3C design tokens
// as Variables + text/effect styles. The UI iframe fetches image bytes (the
// sandbox has no fetch) and sends them along with the document.
//
// Syntax is kept to ES2017 on purpose: no optional chaining, nullish
// coalescing or object spread, so older plugin sandboxes parse it too.
"use strict";

var COLLECTION_NAME = "Keys_Osi tokens";
var STYLE_PREFIX = "Keys_Osi";
var INTER = { family: "Inter", style: "Regular" };

figma.showUI(__html__, { width: 400, height: 600, themeColors: true });

figma.ui.onmessage = function (msg) {
  return handleMessage(msg);
};

function post(message) {
  figma.ui.postMessage(message);
}

function progress(label, done, total) {
  post({ type: "progress", label: label, done: done, total: total });
}

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  try {
    if (msg.type === "import-capture") {
      var summary = await importCapture(msg.doc, msg.images || {});
      post({ type: "done", kind: "capture", summary: summary });
      figma.notify("Keys_Osi : page importée (" + summary.nodes + " calques).");
    } else if (msg.type === "import-tokens") {
      var tokenSummary = await importTokens(msg.tokens);
      post({ type: "done", kind: "tokens", summary: tokenSummary });
      figma.notify("Keys_Osi : " + (tokenSummary.created + tokenSummary.updated) + " variables importées.");
    } else if (msg.type === "close") {
      figma.closePlugin();
    }
  } catch (err) {
    post({ type: "error", message: errorMessage(err) });
  }
}

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

// Generic CSS families -> Figma families to look for, in order.
var SYSTEM_SANS = ["SF Pro Text", "Segoe UI", "Roboto", "Inter"];
var GENERIC_ALIASES = {
  "system-ui": SYSTEM_SANS,
  "-apple-system": SYSTEM_SANS,
  "blinkmacsystemfont": SYSTEM_SANS,
  "ui-sans-serif": SYSTEM_SANS,
  "sans-serif": ["Arial", "Helvetica", "Inter"],
  "serif": ["Times New Roman", "Georgia", "Noto Serif"],
  "ui-serif": ["New York", "Times New Roman", "Georgia"],
  "monospace": ["Roboto Mono", "Courier New", "Menlo"],
  "ui-monospace": ["SF Mono", "Roboto Mono", "Menlo"],
  "cursive": ["Comic Sans MS"],
  "fantasy": ["Impact"]
};

function isGeneric(family) {
  var f = String(family).toLowerCase();
  return Object.prototype.hasOwnProperty.call(GENERIC_ALIASES, f) || /emoji|^math$|^fangsong$/.test(f);
}

// Web-only names ("Inter Variable", "Foo VF") map to the installed family.
function familyCandidates(family) {
  var f = String(family);
  var alias = GENERIC_ALIASES[f.toLowerCase()];
  if (alias) return alias;
  var base = f.replace(/s+(variable|vf|var)$/i, "");
  return base !== f ? [f, base] : [f];
}

function styleWeight(style) {
  var s = String(style).toLowerCase().replace(/[\s_-]/g, "");
  if (/thin|hairline/.test(s)) return 100;
  if (/(extra|ultra)light/.test(s)) return 200;
  if (/light/.test(s)) return 300;
  if (/medium/.test(s)) return 500;
  if (/(semi|demi)bold/.test(s)) return 600;
  if (/(extra|ultra)bold/.test(s)) return 800;
  if (/black|heavy/.test(s)) return 900;
  if (/bold/.test(s)) return 700;
  return 400;
}

/** Closest weight with matching italic; plain styles beat Condensed/Display. */
function pickStyle(styles, weight, italic) {
  var best = styles[0];
  var bestScore = Infinity;
  for (var i = 0; i < styles.length; i++) {
    var f = styles[i];
    var isItalic = /italic|oblique/i.test(f.style);
    var extra = f.style.replace(/italic|oblique|regular|normal|book|roman|thin|hairline|extra|ultra|semi|demi|light|medium|bold|black|heavy|\s/gi, "");
    var score = Math.abs(styleWeight(f.style) - weight) + (isItalic !== italic ? 1000 : 0) + (extra ? 50 : 0);
    if (score < bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

var fontIndexCache = null;

async function fontIndex() {
  if (fontIndexCache) return fontIndexCache;
  var index = {};
  var list = await figma.listAvailableFontsAsync();
  for (var i = 0; i < list.length; i++) {
    var fn = list[i].fontName;
    var key = fn.family.toLowerCase();
    if (!index[key]) index[key] = [];
    index[key].push(fn);
  }
  fontIndexCache = index;
  return index;
}

/** Resolves CSS family stacks to loaded Figma fonts; records missing families. */
async function createFontResolver(segments) {
  var index = await fontIndex();
  var chosen = {};
  var missing = {};
  var keyOf = function (seg) {
    return (seg.families || [seg.family]).join(",") + "|" + seg.weight + "|" + seg.style;
  };
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    var key = keyOf(seg);
    if (chosen[key]) continue;
    var families = seg.families && seg.families.length ? seg.families : [seg.family || "Inter"];
    var styles = null;
    for (var f = 0; f < families.length && !styles; f++) {
      var fam = families[f];
      var candidates = familyCandidates(fam);
      for (var c = 0; c < candidates.length; c++) {
        if (index[candidates[c].toLowerCase()]) {
          styles = index[candidates[c].toLowerCase()];
          break;
        }
      }
      if (!styles && !isGeneric(fam)) missing[fam] = true;
    }
    chosen[key] = pickStyle(styles || index.inter || [INTER], Number(seg.weight) || 400, seg.style === "italic");
  }
  var unique = {};
  Object.keys(chosen).forEach(function (k) {
    unique[chosen[k].family + "::" + chosen[k].style] = chosen[k];
  });
  unique["Inter::Regular"] = INTER;
  var failed = {};
  await Promise.all(
    Object.keys(unique).map(function (k) {
      return figma.loadFontAsync(unique[k]).catch(function () {
        failed[k] = true;
      });
    })
  );
  return {
    missing: Object.keys(missing),
    get: function (seg) {
      var fn = seg ? chosen[keyOf(seg)] : null;
      return fn && !failed[fn.family + "::" + fn.style] ? fn : INTER;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Paints, effects                                                     */
/* ------------------------------------------------------------------ */

function solid(c) {
  return { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a === undefined ? 1 : c.a };
}

function toPaints(list, st) {
  var out = [];
  (list || []).forEach(function (p) {
    if (!p) return;
    if (p.type === "SOLID") {
      out.push({ type: "SOLID", color: { r: p.color.r, g: p.color.g, b: p.color.b }, opacity: p.opacity === undefined ? 1 : p.opacity });
    } else if (/^GRADIENT_/.test(p.type)) {
      out.push({
        type: p.type,
        gradientTransform: p.gradientTransform,
        gradientStops: p.gradientStops.map(function (s) {
          return { position: s.position, color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a } };
        })
      });
    } else if (p.type === "IMAGE") {
      var hash = st.hashes[p.imageId];
      if (!hash) {
        // Unreachable image: neutral placeholder keeps the layout readable.
        st.stats.missingImageFills++;
        out.push({ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 1 });
        return;
      }
      var paint = { type: "IMAGE", imageHash: hash, scaleMode: p.scaleMode || "FILL" };
      if (p.scaleMode === "TILE" && p.scalingFactor) paint.scalingFactor = p.scalingFactor;
      out.push(paint);
    }
  });
  return out;
}

function toEffects(list) {
  return (list || []).map(function (e) {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      return {
        type: e.type,
        color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a },
        offset: { x: e.offset.x, y: e.offset.y },
        radius: e.radius || 0,
        spread: e.spread || 0,
        visible: true,
        blendMode: e.blendMode || "NORMAL"
      };
    }
    return { type: e.type, radius: e.radius || 0, visible: true, blurType: "NORMAL" };
  });
}

function setEffects(node, list) {
  if (!list || !list.length) return;
  var effects = toEffects(list);
  try {
    node.effects = effects;
  } catch (err) {
    // Editors that predate blurType reject the key: retry without it.
    node.effects = effects.map(function (e) {
      if (e.blurType === undefined) return e;
      return { type: e.type, radius: e.radius, visible: e.visible };
    });
  }
}

function applyVisual(f, n, st) {
  var shape = n.type === "FRAME" || n.type === "IMAGE" || n.type === "RECTANGLE";
  if (shape || n.type === "SVG") f.fills = toPaints(n.fills, st);
  if (shape && n.strokes && n.strokes.length) {
    f.strokes = toPaints(n.strokes, st);
    f.strokeAlign = "INSIDE";
    var w = n.strokeWeights;
    if (w) {
      if (w.top === w.right && w.top === w.bottom && w.top === w.left) f.strokeWeight = w.top;
      else {
        f.strokeTopWeight = w.top;
        f.strokeRightWeight = w.right;
        f.strokeBottomWeight = w.bottom;
        f.strokeLeftWeight = w.left;
      }
    }
  }
  if (shape && n.cornerRadii) {
    f.topLeftRadius = n.cornerRadii[0];
    f.topRightRadius = n.cornerRadii[1];
    f.bottomRightRadius = n.cornerRadii[2];
    f.bottomLeftRadius = n.cornerRadii[3];
  }
  setEffects(f, n.effects);
  if (n.opacity !== undefined && n.opacity !== 1) f.opacity = n.opacity;
  if (n.blendMode && n.blendMode !== "NORMAL") f.blendMode = n.blendMode;
  if (n.type === "FRAME" || n.type === "SVG") f.clipsContent = !!n.clipsContent;
  if (n.visible === false) f.visible = false;
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

function applyText(t, n, st) {
  var text = n.text || { characters: "", segments: [] };
  var chars = text.characters || "";
  var segs = text.segments || [];
  t.fontName = segs.length ? st.fonts.get(segs[0]) : INTER;
  t.characters = chars;
  segs.forEach(function (seg) {
    var s = seg.start;
    var e = Math.min(seg.end, chars.length);
    if (e <= s) return;
    t.setRangeFontName(s, e, st.fonts.get(seg));
    t.setRangeFontSize(s, e, Math.max(1, seg.size || 16));
    if (seg.color) t.setRangeFills(s, e, [solid(seg.color)]);
    t.setRangeLineHeight(s, e, seg.lineHeightPx ? { value: seg.lineHeightPx, unit: "PIXELS" } : { unit: "AUTO" });
    t.setRangeLetterSpacing(s, e, { value: seg.letterSpacingPx || 0, unit: "PIXELS" });
    t.setRangeTextDecoration(s, e, seg.decoration || "NONE");
    t.setRangeTextCase(s, e, seg.case || "ORIGINAL");
    if (seg.href) {
      try {
        t.setRangeHyperlink(s, e, { type: "URL", value: seg.href });
      } catch (err) {
        // invalid URL for Figma: keep the styled text without the link
      }
    }
  });
  t.textAlignHorizontal = text.align || "LEFT";
  t.textAutoResize = text.autoResize || "WIDTH_AND_HEIGHT";
  if (t.textAutoResize !== "WIDTH_AND_HEIGHT") t.resize(Math.max(1, n.width), Math.max(1, n.height));
  setEffects(t, n.effects);
  if (n.visible === false) t.visible = false;
}

/* ------------------------------------------------------------------ */
/* Layer tree                                                          */
/* ------------------------------------------------------------------ */

function isAuto(layout) {
  return !!layout && (layout.mode === "HORIZONTAL" || layout.mode === "VERTICAL");
}

function applyLayout(f, L) {
  if (!isAuto(L)) return;
  f.layoutMode = L.mode;
  if (L.wrap === "WRAP") {
    f.layoutWrap = "WRAP";
    if (L.counterGap !== null && L.counterGap !== undefined) f.counterAxisSpacing = L.counterGap;
  }
  f.itemSpacing = L.gap || 0;
  f.paddingTop = L.padding[0];
  f.paddingRight = L.padding[1];
  f.paddingBottom = L.padding[2];
  f.paddingLeft = L.padding[3];
  f.primaryAxisAlignItems = L.primaryAlign || "MIN";
  f.counterAxisAlignItems = L.counterAlign || "MIN";
  // Keep the measured size while children are appended.
  f.primaryAxisSizingMode = "FIXED";
  f.counterAxisSizingMode = "FIXED";
}

/** Own sizing of an auto-layout frame, once its children exist. */
function applyOwnSizing(f, n) {
  if (!isAuto(n.layout)) return;
  var s = n.layout.sizing || {};
  var hugW = s.horizontal === "HUG";
  var hugH = s.vertical === "HUG";
  f.layoutSizingHorizontal = hugW ? "HUG" : "FIXED";
  f.layoutSizingVertical = hugH ? "HUG" : "FIXED";
  if (!hugW || !hugH) f.resize(hugW ? f.width : Math.max(0.01, n.width), hugH ? f.height : Math.max(0.01, n.height));
}

/** Settings that only exist once the node sits in an auto-layout parent. */
function applyChildLayout(f, n, parentLayout) {
  if (!isAuto(parentLayout)) {
    f.x = n.x;
    f.y = n.y;
    return;
  }
  if (n.layoutPositioning === "ABSOLUTE") {
    f.layoutPositioning = "ABSOLUTE";
    f.x = n.x;
    f.y = n.y;
    return;
  }
  if (n.sizing) {
    if (n.sizing.horizontal === "FILL") f.layoutSizingHorizontal = "FILL";
    if (n.sizing.vertical === "FILL") f.layoutSizingVertical = "FILL";
  }
}

function createSvg(n, st) {
  try {
    var f = figma.createNodeFromSvg(n.svg);
    st.stats.svgs++;
    return f;
  } catch (err) {
    st.stats.failedSvgs++;
    var r = figma.createRectangle();
    r.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 }, opacity: 1 }];
    return r;
  }
}

/** Applies a captured subtree onto an instance (text, fills, effects...). */
function overrideInstance(f, n, st) {
  if (n.type === "TEXT" && f.type === "TEXT") {
    applyText(f, n, st);
    return;
  }
  if (n.type !== "SVG") applyVisual(f, n, st);
  var kids = f.children || [];
  (n.children || []).forEach(function (c, i) {
    if (kids[i] && n.type !== "SVG") overrideInstance(kids[i], c, st);
  });
}

function buildNode(n, parent, parentLayout, st, inComponent) {
  st.stats.nodes++;
  if (st.stats.nodes % 200 === 0) progress("Calques…", st.stats.nodes, st.total);
  var f;
  var main = n.componentCandidate && !inComponent ? st.components[n.componentCandidate] : null;
  if (main) {
    f = main.createInstance();
    parent.appendChild(f);
    f.name = n.name;
    f.resize(Math.max(0.01, n.width), Math.max(0.01, n.height));
    overrideInstance(f, n, st);
    applyChildLayout(f, n, parentLayout);
    st.stats.instances++;
    return f;
  }
  if (n.type === "TEXT") {
    f = figma.createText();
    parent.appendChild(f);
    applyText(f, n, st);
    st.stats.texts++;
  } else if (n.type === "SVG") {
    f = createSvg(n, st);
    parent.appendChild(f);
    applyVisual(f, n, st);
  } else if (n.type === "IMAGE" || n.type === "RECTANGLE") {
    f = figma.createRectangle();
    parent.appendChild(f);
    f.resize(Math.max(0.01, n.width), Math.max(0.01, n.height));
    applyVisual(f, n, st);
    if (n.type === "IMAGE") st.stats.images++;
  } else {
    f = figma.createFrame();
    parent.appendChild(f);
    f.resize(Math.max(0.01, n.width), Math.max(0.01, n.height));
    applyVisual(f, n, st);
    applyLayout(f, n.layout);
    var makeComponent = !!n.componentCandidate && !inComponent;
    (n.children || []).forEach(function (c) {
      buildNode(c, f, n.layout, st, inComponent || makeComponent);
    });
    applyOwnSizing(f, n);
    st.stats.frames++;
    if (makeComponent) {
      // First occurrence becomes the main component, in place.
      f = figma.createComponentFromNode(f);
      st.components[n.componentCandidate] = f;
      st.stats.components++;
    }
  }
  f.name = n.name || n.type;
  applyChildLayout(f, n, parentLayout);
  return f;
}

function walk(n, fn) {
  fn(n);
  (n.children || []).forEach(function (c) {
    walk(c, fn);
  });
}

async function prepareImages(doc, bytesById, st) {
  var list = doc.images || [];
  for (var i = 0; i < list.length; i++) {
    var img = list[i];
    progress("Images…", i, list.length);
    var bytes = bytesById[img.id];
    if (bytes) {
      try {
        st.hashes[img.id] = figma.createImage(bytes).hash;
        continue;
      } catch (err) {
        // undecodable bytes: let Figma try the URL itself
      }
    }
    if (/^https?:/i.test(img.url || "")) {
      try {
        var image = await figma.createImageAsync(img.url);
        st.hashes[img.id] = image.hash;
        continue;
      } catch (err) {
        // blocked by CORS / format / network
      }
    }
    st.failedImages.push(img.url);
  }
}

async function importCapture(doc, bytesById) {
  if (!doc || doc.format !== "keys-osi-figma" || !doc.root) throw new Error("Ce fichier n'est pas une capture Keys_Osi.");
  if (doc.version !== 1) throw new Error("Version de capture non prise en charge : " + doc.version + ".");
  var st = {
    hashes: {},
    failedImages: [],
    components: {},
    total: 0,
    stats: { nodes: 0, frames: 0, texts: 0, images: 0, svgs: 0, failedSvgs: 0, components: 0, instances: 0, missingImageFills: 0 }
  };
  var segments = [];
  walk(doc.root, function (n) {
    st.total++;
    if (n.text && n.text.segments) segments = segments.concat(n.text.segments);
  });
  progress("Polices…", 0, 1);
  st.fonts = await createFontResolver(segments);
  await prepareImages(doc, bytesById, st);
  progress("Calques…", 0, st.total);

  var page = figma.currentPage;
  var right = 0;
  page.children.forEach(function (c) {
    right = Math.max(right, c.x + c.width);
  });
  var rootNode = Object.assign({}, doc.root, { x: 0, y: 0 });
  var root = buildNode(rootNode, page, null, st, false);
  root.name = (doc.source && doc.source.title) || doc.root.name || "Page Keys_Osi";
  root.x = page.children.length > 1 ? right + 200 : 0;
  root.y = 0;
  page.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);
  progress("Terminé", st.total, st.total);

  var summary = {
    title: root.name,
    nodes: st.stats.nodes,
    frames: st.stats.frames,
    texts: st.stats.texts,
    images: st.stats.images,
    svgs: st.stats.svgs,
    failedSvgs: st.stats.failedSvgs,
    components: st.stats.components,
    instances: st.stats.instances,
    missingFonts: st.fonts.missing,
    failedImages: st.failedImages,
    truncated: !!(doc.stats && doc.stats.truncated)
  };
  return summary;
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  var f = function (n) {
    var k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/** CSS color string -> RGBA (0..1), or null. */
function parseCssColor(value) {
  var v = String(value || "").trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  var hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    var h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map(function (c) { return c + c; }).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    };
  }
  var fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v);
  if (!fn) return null;
  var parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  var alpha = parts[3] === undefined ? 1 : parts[3].slice(-1) === "%" ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  if (fn[1].indexOf("rgb") === 0) {
    var ch = function (p) { return p.slice(-1) === "%" ? parseFloat(p) / 100 : parseFloat(p) / 255; };
    return { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a: alpha };
  }
  var rgb = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: alpha };
}

function tokenColor(value) {
  if (value && typeof value === "object" && Array.isArray(value.components)) {
    return { r: value.components[0], g: value.components[1], b: value.components[2], a: value.alpha === undefined ? 1 : value.alpha };
  }
  return parseCssColor(value);
}

function tokenNumber(value, unitFactor) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && typeof value.value === "number") {
    return value.value * (unitFactor[value.unit] || 1);
  }
  var m = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(String(value || "").trim());
  if (!m) return null;
  var factor = m[2] ? unitFactor[m[2]] : 1;
  return factor === undefined ? null : parseFloat(m[1]) * factor;
}

var DIMENSION_UNITS = { px: 1, rem: 16, em: 16, "": 1 };
var DURATION_UNITS = { ms: 1, s: 1000, "": 1 };

function flattenTokens(node, path, inheritedType, out) {
  Object.keys(node).forEach(function (key) {
    if (key.charAt(0) === "$") return;
    var child = node[key];
    if (!child || typeof child !== "object") return;
    var type = child.$type || inheritedType;
    if (Object.prototype.hasOwnProperty.call(child, "$value")) {
      out.push({ path: path.concat(key), type: type, value: child.$value, description: child.$description });
    } else {
      flattenTokens(child, path.concat(key), type, out);
    }
  });
}

function scopesFor(path, type) {
  var p = path.join("/").toLowerCase();
  if (type === "COLOR") {
    if (/text|foreground/.test(p)) return ["TEXT_FILL"];
    if (/border|stroke|outline|ring/.test(p)) return ["STROKE_COLOR"];
    if (/surface|background|bg/.test(p)) return ["FRAME_FILL", "SHAPE_FILL"];
    return null;
  }
  if (/radius|rounded/.test(p)) return ["CORNER_RADIUS"];
  if (/space|spacing|gap/.test(p)) return ["GAP", "WIDTH_HEIGHT"];
  if (/font\/size|font-size|fontsize/.test(p)) return ["FONT_SIZE"];
  if (/weight/.test(p)) return ["FONT_WEIGHT"];
  return null;
}

function convertToken(token) {
  var t = String(token.type || "").toLowerCase();
  if (t === "color") {
    var c = tokenColor(token.value);
    return c ? { type: "COLOR", value: c } : null;
  }
  if (t === "dimension" || t === "number" || t === "fontweight") {
    var n = tokenNumber(token.value, DIMENSION_UNITS);
    return n === null || !isFinite(n) ? null : { type: "FLOAT", value: n };
  }
  if (t === "duration") {
    var d = tokenNumber(token.value, DURATION_UNITS);
    return d === null || !isFinite(d) ? null : { type: "FLOAT", value: d };
  }
  return null;
}

/** CSS box-shadow list (or DTCG shadow objects) -> Figma effects. */
function parseShadowToken(value) {
  var list = Array.isArray(value) ? value : [value];
  var out = [];
  list.forEach(function (item) {
    if (item && typeof item === "object") {
      var oc = tokenColor(item.color);
      if (!oc) return;
      out.push({
        type: item.inset ? "INNER_SHADOW" : "DROP_SHADOW",
        color: oc,
        offset: { x: tokenNumber(item.offsetX, DIMENSION_UNITS) || 0, y: tokenNumber(item.offsetY, DIMENSION_UNITS) || 0 },
        radius: tokenNumber(item.blur, DIMENSION_UNITS) || 0,
        spread: tokenNumber(item.spread, DIMENSION_UNITS) || 0,
        visible: true,
        blendMode: "NORMAL"
      });
      return;
    }
    splitOutsideParens(String(item || ""), ",").forEach(function (shadow) {
      var inset = false;
      var lens = [];
      var colorParts = [];
      splitOutsideParens(shadow, " ").forEach(function (p) {
        if (p === "inset") inset = true;
        else if (/^-?[\d.]+(px)?$/.test(p)) lens.push(parseFloat(p));
        else colorParts.push(p);
      });
      var color = parseCssColor(colorParts.join(" ") || "#000000");
      if (!color || lens.length < 2) return;
      out.push({
        type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
        color: color,
        offset: { x: lens[0], y: lens[1] },
        radius: lens[2] || 0,
        spread: lens[3] || 0,
        visible: true,
        blendMode: "NORMAL"
      });
    });
  });
  return out;
}

function splitOutsideParens(str, sep) {
  var out = [];
  var depth = 0;
  var cur = "";
  for (var i = 0; i < str.length; i++) {
    var ch = str.charAt(i);
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    var isSep = sep === " " ? /\s/.test(ch) : ch === sep;
    if (depth === 0 && isSep) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function sanitizeName(segment) {
  return String(segment).replace(/[.{}$]/g, "-");
}

async function resolveFamily(families, weight) {
  var index = await fontIndex();
  var list = Array.isArray(families) ? families : String(families || "").split(",");
  for (var i = 0; i < list.length; i++) {
    var fam = String(list[i]).replace(/^["']|["']$/g, "").trim();
    var candidates = familyCandidates(fam);
    for (var c = 0; c < candidates.length; c++) {
      var styles = index[candidates[c].toLowerCase()];
      if (styles) return pickStyle(styles, weight || 400, false);
    }
  }
  return INTER;
}

async function loadOrInter(fontName) {
  try {
    await figma.loadFontAsync(fontName);
    return fontName;
  } catch (err) {
    await figma.loadFontAsync(INTER);
    return INTER;
  }
}

async function importTokens(doc) {
  if (!doc || typeof doc !== "object") throw new Error("Fichier de tokens invalide.");
  var tokens = [];
  flattenTokens(doc, [], doc.$type, tokens);
  if (!tokens.length) throw new Error("Aucun token trouvé dans ce fichier.");
  progress("Variables…", 0, tokens.length);

  var collections = await figma.variables.getLocalVariableCollectionsAsync();
  var collection = null;
  collections.forEach(function (c) {
    if (c.name === COLLECTION_NAME) collection = c;
  });
  if (!collection) {
    collection = figma.variables.createVariableCollection(COLLECTION_NAME);
    collection.renameMode(collection.modes[0].modeId, "Valeur");
  }
  var modeId = collection.defaultModeId;
  var existing = {};
  (await figma.variables.getLocalVariablesAsync()).forEach(function (v) {
    if (v.variableCollectionId === collection.id) existing[v.name] = v;
  });

  var summary = { collection: COLLECTION_NAME, created: 0, updated: 0, colors: 0, floats: 0, textStyles: 0, effectStyles: 0, skipped: [] };
  var variablesByPath = {};
  tokens.forEach(function (token, i) {
    var conv = convertToken(token);
    var name = token.path.map(sanitizeName).join("/");
    if (!conv) {
      if (!/^(fontfamily|shadow|typography)$/i.test(String(token.type))) summary.skipped.push(name + " (" + (token.type || "?") + ")");
      return;
    }
    var variable = existing[name];
    if (variable && variable.resolvedType !== conv.type) {
      variable.remove();
      variable = null;
    }
    if (variable) summary.updated++;
    else {
      variable = figma.variables.createVariable(name, collection, conv.type);
      summary.created++;
    }
    variable.setValueForMode(modeId, conv.value);
    var scopes = scopesFor(token.path, conv.type);
    if (scopes) variable.scopes = scopes;
    if (token.description) variable.description = String(token.description);
    if (conv.type === "COLOR") summary.colors++;
    else summary.floats++;
    variablesByPath[name] = variable;
    if (i % 25 === 0) progress("Variables…", i, tokens.length);
  });

  // Text styles: one per font size token, in the primary family.
  var familyToken = null;
  tokens.forEach(function (t) {
    if (!familyToken && String(t.type).toLowerCase() === "fontfamily") familyToken = t;
  });
  var textStyles = {};
  (await figma.getLocalTextStylesAsync()).forEach(function (s) {
    textStyles[s.name] = s;
  });
  var textSpecs = [];
  tokens.forEach(function (t) {
    var p = t.path.map(function (s) { return String(s).toLowerCase(); });
    var type = String(t.type).toLowerCase();
    if (type === "dimension" && p.indexOf("font") >= 0 && p.indexOf("size") >= 0) {
      var size = tokenNumber(t.value, DIMENSION_UNITS);
      if (size) textSpecs.push({ name: t.path.slice(p.indexOf("size") + 1).map(sanitizeName).join("/") || "base", size: size, families: familyToken ? familyToken.value : ["Inter"], weight: 400 });
    } else if (type === "typography" && t.value && typeof t.value === "object") {
      textSpecs.push({
        name: t.path.slice(1).map(sanitizeName).join("/") || sanitizeName(t.path[0]),
        size: tokenNumber(t.value.fontSize, DIMENSION_UNITS) || 16,
        families: t.value.fontFamily || (familyToken ? familyToken.value : ["Inter"]),
        weight: Number(t.value.fontWeight) || 400,
        lineHeight: t.value.lineHeight,
        letterSpacing: t.value.letterSpacing
      });
    }
  });
  for (var i = 0; i < textSpecs.length; i++) {
    var spec = textSpecs[i];
    var fontName = await loadOrInter(await resolveFamily(spec.families, spec.weight));
    var styleName = STYLE_PREFIX + "/Texte/" + spec.name;
    var style = textStyles[styleName] || figma.createTextStyle();
    style.name = styleName;
    style.fontName = fontName;
    style.fontSize = spec.size;
    if (typeof spec.lineHeight === "number") style.lineHeight = { value: spec.lineHeight * 100, unit: "PERCENT" };
    var ls = spec.letterSpacing !== undefined ? tokenNumber(spec.letterSpacing, DIMENSION_UNITS) : null;
    if (ls !== null && isFinite(ls)) style.letterSpacing = { value: ls, unit: "PIXELS" };
    summary.textStyles++;
  }

  // Effect styles: one per shadow token.
  var effectStyles = {};
  (await figma.getLocalEffectStylesAsync()).forEach(function (s) {
    effectStyles[s.name] = s;
  });
  tokens.forEach(function (t) {
    if (String(t.type).toLowerCase() !== "shadow") return;
    var effects = parseShadowToken(t.value);
    var name = STYLE_PREFIX + "/Ombre/" + (t.path.slice(1).map(sanitizeName).join("/") || sanitizeName(t.path[0]));
    if (!effects.length) {
      summary.skipped.push(name);
      return;
    }
    var style = effectStyles[name] || figma.createEffectStyle();
    style.name = name;
    style.effects = effects;
    summary.effectStyles++;
  });
  progress("Terminé", tokens.length, tokens.length);
  return summary;
}
