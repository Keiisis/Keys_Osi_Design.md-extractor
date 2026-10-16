/**
 * Keys_Osi code clone probe (isolated world). The service worker injects it,
 * calls prepare() once, measure() at every emulated width, then finish().
 *
 * measure() keeps, for every element (and ::before/::after), the computed
 * declarations that differ from what the clone would get anyway: the
 * browser default for that tag (the clone ships without Preflight) or the
 * value inherited from the parent. Layout facts (sizes, parent box, content
 * extent, offsets) come along so lib/code-clone.mjs can tell a fluid width
 * from a fixed one. Elements are tracked by reference: the page DOM is not
 * modified, except for a hidden blank iframe used to read default styles,
 * removed by finish().
 */
(() => {
  if (globalThis.__keysOsiClone) return;
  const MAX_NODES = 6000;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "BASE", "TITLE", "HEAD", "SLOT", "SOURCE", "TRACK", "PARAM", "OBJECT", "EMBED"]);
  const PROPS = [
    "display", "position", "z-index", "float", "clear", "box-sizing",
    "min-width", "max-width", "min-height", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
    "background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip", "background-attachment",
    "color", "font-family", "font-size", "font-weight", "font-style", "font-stretch", "line-height", "letter-spacing", "word-spacing",
    "text-align", "text-transform", "text-indent", "text-decoration-line", "text-decoration-color", "text-decoration-style", "text-decoration-thickness", "text-underline-offset",
    "white-space", "word-break", "overflow-wrap", "text-overflow", "text-wrap-style", "vertical-align", "list-style-type", "list-style-position",
    "overflow-x", "overflow-y", "opacity", "visibility", "box-shadow", "text-shadow", "transform", "transform-origin", "filter", "backdrop-filter", "mix-blend-mode", "isolation", "clip-path",
    "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "align-self", "justify-items", "justify-self", "flex-grow", "flex-shrink", "flex-basis", "order", "row-gap", "column-gap",
    "grid-template-columns", "grid-template-areas", "grid-auto-flow", "grid-auto-columns", "grid-auto-rows", "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
    "object-fit", "object-position", "aspect-ratio", "cursor", "pointer-events", "user-select",
    "-webkit-line-clamp", "-webkit-box-orient", "column-count", "border-collapse", "border-spacing", "table-layout",
    "font-variant-numeric", "font-feature-settings", "fill", "stroke", "stroke-width"
  ];
  const INHERITED = new Set([
    "color", "font-family", "font-size", "font-weight", "font-style", "font-stretch", "line-height", "letter-spacing", "word-spacing",
    "text-align", "text-transform", "text-indent", "white-space", "word-break", "overflow-wrap", "text-wrap-style", "list-style-type", "list-style-position",
    "visibility", "cursor", "text-shadow", "pointer-events", "font-variant-numeric", "font-feature-settings", "fill", "stroke", "stroke-width",
    "border-collapse", "border-spacing"
  ]);
  // Distinct values for the parent in the sandbox: a child that does not
  // inherit them gets a browser default for that tag (h1 size, a color...).
  const PROBE_PARENT = {
    color: "rgb(1, 2, 3)", "font-family": "zz-probe", "font-size": "13px", "font-weight": "300", "font-style": "italic", "line-height": "17px",
    "letter-spacing": "1px", "word-spacing": "2px", "text-align": "right", "text-transform": "lowercase", "text-indent": "3px", "white-space": "pre-wrap",
    "word-break": "break-all", "overflow-wrap": "anywhere", "list-style-type": "square", "list-style-position": "inside", cursor: "crosshair",
    "text-shadow": "rgb(1, 2, 3) 1px 1px 0px", "pointer-events": "none", "font-variant-numeric": "tabular-nums", fill: "rgb(1, 2, 3)", stroke: "rgb(1, 2, 3)",
    "border-collapse": "collapse", "border-spacing": "3px 3px", "font-stretch": "75%", "text-wrap-style": "balance", visibility: "visible"
  };

  const state = { nodes: [], widths: [], measures: [], frame: null, defaults: new Map(), overrides: new Map(), scroll: [window.scrollX, window.scrollY], truncated: false };
  const vw = () => document.documentElement.clientWidth;
  const round = (n) => Math.round(n * 10) / 10;

  function sandbox() {
    if (state.frame?.isConnected) return state.frame.contentDocument;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:absolute;left:-10000px;top:0;width:1200px;height:800px;border:0;visibility:hidden;pointer-events:none";
    document.documentElement.appendChild(frame);
    state.frame = frame;
    const doc = frame.contentDocument;
    doc.open();
    doc.write("<!doctype html><html><head></head><body></body></html>");
    doc.close();
    return doc;
  }

  const sandboxTag = (tag) => (tag === "::before" || tag === "::after" ? "span" : tag);

  // Browser default of every property for this tag, at this font size
  // (em-based defaults such as h1 margins follow the font size).
  function defaultsFor(tag, fontSize) {
    const key = `${tag}|${fontSize}`;
    if (state.defaults.has(key)) return state.defaults.get(key);
    const doc = sandbox();
    const isSvg = ["svg", "path", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse", "use", "symbol", "defs", "text", "tspan"].includes(tag);
    const make = () => {
      const node = isSvg ? doc.createElementNS("http://www.w3.org/2000/svg", tag) : doc.createElement(sandboxTag(tag));
      // Links get their browser look (color, underline) only with an href.
      if (tag === "a" || tag === "area") node.setAttribute("href", "#");
      doc.body.appendChild(node);
      return node;
    };
    // The sized twin gives em-based defaults (h1 margins); the plain one the font size itself.
    const plain = make();
    const sized = make();
    sized.style.fontSize = fontSize;
    const cs = doc.defaultView.getComputedStyle(sized);
    const values = {};
    for (const prop of PROPS) values[prop] = cs.getPropertyValue(prop);
    values["font-size"] = doc.defaultView.getComputedStyle(plain).getPropertyValue("font-size");
    plain.remove();
    sized.remove();
    state.defaults.set(key, values);
    return values;
  }

  // Inherited properties the browser resets on this tag.
  function overridesFor(tag) {
    if (state.overrides.has(tag)) return state.overrides.get(tag);
    const doc = sandbox();
    const parent = doc.createElement("div");
    for (const [prop, value] of Object.entries(PROBE_PARENT)) parent.style.setProperty(prop, value);
    const isSvg = tag === "svg";
    const child = isSvg ? doc.createElementNS("http://www.w3.org/2000/svg", "svg") : doc.createElement(sandboxTag(tag));
    if (tag === "a" || tag === "area") child.setAttribute("href", "#");
    parent.appendChild(child);
    doc.body.appendChild(parent);
    const pcs = doc.defaultView.getComputedStyle(parent);
    const ccs = doc.defaultView.getComputedStyle(child);
    const set = new Set();
    for (const prop of INHERITED) if (ccs.getPropertyValue(prop) !== pcs.getPropertyValue(prop)) set.add(prop);
    parent.remove();
    state.overrides.set(tag, set);
    return set;
  }

  function hasPseudo(el, which) {
    const cs = getComputedStyle(el, which);
    const content = cs.getPropertyValue("content");
    return content && content !== "none" && content !== "normal" && cs.display !== "none";
  }

  // Document order, ::before first and ::after last among an element's children.
  function collect() {
    const walk = (el, parent) => {
      if (state.nodes.length >= MAX_NODES) {
        state.truncated = true;
        return;
      }
      const index = state.nodes.length;
      const tag = el.tagName.toLowerCase();
      state.nodes.push({ k: "e", el, tag, parent });
      if (tag === "svg") return; // serialized whole by finish()
      if (hasPseudo(el, "::before")) state.nodes.push({ k: "p", el, tag: "::before", parent: index });
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.textContent.length) state.nodes.push({ k: "t", node: child, parent: index });
        } else if (child.nodeType === Node.ELEMENT_NODE && !SKIP.has(child.tagName) && !(child.tagName === "IFRAME" && child === state.frame)) {
          walk(child, index);
        }
      }
      if (hasPseudo(el, "::after")) state.nodes.push({ k: "p", el, tag: "::after", parent: index });
    };
    walk(document.body, -1);
  }

  const px = (value) => parseFloat(value) || 0;

  // Union of the in-flow children (elements and text) inside the content box.
  function contentExtent(el, cs, rect) {
    const left = rect.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const top = rect.top + px(cs.borderTopWidth) + px(cs.paddingTop);
    let maxRight = left;
    let maxBottom = top;
    let any = false;
    // Text rects are glyph boxes: the line box adds half the leading below.
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    for (const child of el.childNodes) {
      let rects = [];
      let marginBottom = 0;
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        rects = Array.from(range.getClientRects());
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const ccs = getComputedStyle(child);
        if (ccs.display === "none" || ccs.position === "absolute" || ccs.position === "fixed") continue;
        rects = [child.getBoundingClientRect()];
        marginBottom = px(ccs.marginBottom);
      }
      const leading = child.nodeType === Node.TEXT_NODE ? (r) => Math.max(0, (lineHeight - r.height) / 2) : () => 0;
      for (const r of rects) {
        if (r.width === 0 && r.height === 0) continue;
        any = true;
        maxRight = Math.max(maxRight, r.right);
        maxBottom = Math.max(maxBottom, r.bottom + leading(r) + marginBottom);
      }
    }
    return any ? [round(maxRight - left), round(maxBottom - top)] : [0, 0];
  }

  function metrics(node, cs, parentInfo) {
    const el = node.el;
    if (node.k === "p") {
      const content = cs.getPropertyValue("content");
      const on = content && content !== "none" && content !== "normal" && cs.display !== "none";
      return { v: on ? 1 : 0, w: cs.width, h: cs.height, off: [cs.top, cs.right, cs.bottom, cs.left] };
    }
    const rect = el.getBoundingClientRect();
    const visible = el.checkVisibility() && (rect.width > 0 || rect.height > 0 || cs.display === "contents");
    const m = {
      v: visible ? 1 : 0,
      w: round(rect.width),
      h: round(rect.height),
      cw: round(rect.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth)),
      ch: round(rect.height - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth)),
      pw: parentInfo ? parentInfo.cw : vw(),
      ph: parentInfo ? parentInfo.ch : window.innerHeight,
      pd: parentInfo ? parentInfo.display : "block",
      pfd: parentInfo ? parentInfo.dir : "row",
      vh: window.innerHeight
    };
    if (!visible) return m;
    const [ew, eh] = contentExtent(el, cs, rect);
    m.ew = ew;
    m.eh = eh;
    m.vw = vw();
    // Line boxes (struts, tall line-heights) escape the text rects: when the
    // box and its content disagree, ask the browser for the natural height.
    // Set and restored within this task: no frame is drawn in between.
    if (Math.abs(m.ch - eh) > 1.5 && !/^(inline|contents|table-cell|table-row)$/.test(cs.display)) {
      const saved = el.getAttribute("style");
      el.style.setProperty("height", "auto", "important");
      el.style.setProperty("min-height", "0px", "important");
      el.style.setProperty("max-height", "none", "important");
      const natural = el.getBoundingClientRect().height;
      if (saved === null) el.removeAttribute("style");
      else el.setAttribute("style", saved);
      m.nh = round(natural - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth));
    }
    // Same question for widths that do not simply fill their parent: is this
    // width set, or what the content (or the flex/grid algorithm) gives?
    const sized = /flex|grid/.test(m.pd) || /^(inline-block|inline-flex|inline-grid|table|inline-table)$/.test(cs.display) || cs.float !== "none" || cs.position === "absolute" || cs.position === "fixed";
    if (sized && !/^(inline|contents|table-cell|table-row)$/.test(cs.display) && !/^(IMG|VIDEO|IFRAME|CANVAS|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const saved = el.getAttribute("style");
      el.style.setProperty("width", "auto", "important");
      const natural = el.getBoundingClientRect().width;
      if (saved === null) el.removeAttribute("style");
      else el.setAttribute("style", saved);
      m.nw = round(natural - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth));
    }
    const parentIsBox = /flex|grid/.test(m.pd);
    const selfAlign = cs.alignSelf === "auto" ? parentInfo?.alignItems : cs.alignSelf;
    m.st = parentIsBox && /normal|stretch/.test(selfAlign || "normal") ? 1 : 0;
    const marginLeft = px(cs.marginLeft);
    const marginRight = px(cs.marginRight);
    m.ml = round(marginLeft);
    m.mr = round(marginRight);
    // Buttons and some inputs are border-box by default: the lib needs the real one.
    m.bs = cs.boxSizing;
    m.ce =!parentIsBox && cs.position !== "absolute" && cs.position !== "fixed" && marginLeft >= 1 && Math.abs(marginLeft - marginRight) <= 1 && rect.width < m.pw - 1 ? 1 : 0;
    if (cs.position === "absolute" || cs.position === "fixed" || cs.position === "sticky" || cs.position === "relative") {
      const cb = cs.position === "fixed" ? { width: vw(), height: window.innerHeight } : (el.offsetParent || document.documentElement).getBoundingClientRect();
      m.off = [round(px(cs.top)), round(px(cs.right)), round(px(cs.bottom)), round(px(cs.left))];
      m.offAuto = [cs.top, cs.right, cs.bottom, cs.left].map((value) => (value === "auto" ? 1 : 0));
      m.cb = [round(cb.width), round(cb.height)];
    }
    if (cs.display.includes("grid") && cs.gridTemplateColumns !== "none") {
      m.tracks = cs.gridTemplateColumns.split(" ").map(parseFloat).filter((n) => Number.isFinite(n));
      m.gap = px(cs.columnGap);
    }
    if (el.tagName === "IMG") m.nat = [el.naturalWidth, el.naturalHeight];
    return m;
  }

  function measure() {
    window.scrollTo(0, 0);
    const width = vw();
    state.widths.push(width);
    const out = new Array(state.nodes.length).fill(null);
    const infos = new Array(state.nodes.length);
    const styles = new Array(state.nodes.length);
    state.nodes.forEach((node, index) => {
      if (node.k === "t") return;
      if (node.k === "e" && !node.el.isConnected) return;
      const cs = node.k === "p" ? getComputedStyle(node.el, node.tag) : getComputedStyle(node.el);
      styles[index] = cs;
      const parentIndex = node.k === "p" ? node.parent : node.parent;
      const parentCs = parentIndex >= 0 ? styles[parentIndex] : null;
      const parentInfo = parentIndex >= 0 ? infos[parentIndex] : null;
      const m = metrics(node, cs, parentInfo);
      infos[index] = { cw: m.cw ?? 0, ch: m.ch ?? 0, display: cs.display, dir: cs.flexDirection, alignItems: cs.alignItems };
      if (!m.v) {
        out[index] = { m, d: cs.display === "none" ? { display: "none" } : {} };
        return;
      }
      const defaults = defaultsFor(node.tag, cs.fontSize);
      const overrides = overridesFor(node.tag);
      const d = {};
      const ownColor = cs.color;
      const noTransform = cs.transform === "none" && cs.rotate === "none" && cs.scale === "none" && cs.translate === "none";
      for (const prop of PROPS) {
        const value = cs.getPropertyValue(prop);
        if (!value) continue;
        // Values that only follow other ones: a border color with no border,
        // currentColor defaults, the origin of a transform that does not exist.
        const side = prop.match(/^border-(top|right|bottom|left)-color$/);
        if (side && (/^(none|hidden)$/.test(cs.getPropertyValue(`border-${side[1]}-style`)) || cs.getPropertyValue(`border-${side[1]}-width`) === "0px" || value === ownColor)) continue;
        if (prop === "text-decoration-color" && value === ownColor) continue;
        if (prop === "transform-origin" && noTransform) continue;
        // "auto" is the initial min size of flex and grid items: nothing to say.
        if ((prop === "min-width" || prop === "min-height") && value === "auto") continue;
        // Layered backgrounds list one value per layer ("scroll, scroll").
        if (/^background-(attachment|clip|position|repeat|size)$/.test(prop) && value.split(/,\s*/).every((part) => part === defaults[prop])) continue;
        if (INHERITED.has(prop) && !overrides.has(prop)) {
          const inherited = parentCs ? parentCs.getPropertyValue(prop) : defaults[prop];
          if (value === inherited) continue;
        } else if (value === defaults[prop]) {
          continue;
        }
        d[prop] = value;
      }
      if (node.k === "p") d.content = cs.getPropertyValue("content");
      out[index] = { d, m };
    });
    state.measures.push(out);
    return { width, nodes: state.nodes.length };
  }

  const ATTRS = {
    "*": ["id", "title", "role", "lang", "dir", "tabindex", "hidden"],
    a: ["href", "target", "rel"],
    img: ["alt", "width", "height", "loading", "decoding"],
    video: ["poster", "autoplay", "muted", "loop", "playsinline", "controls", "preload"],
    audio: ["controls", "loop", "muted"],
    iframe: ["src", "title", "allow", "allowfullscreen", "loading", "referrerpolicy"],
    input: ["type", "placeholder", "name", "value", "checked", "disabled", "required", "min", "max", "step", "maxlength", "autocomplete"],
    textarea: ["placeholder", "rows", "cols", "name", "disabled", "required"],
    select: ["name", "disabled", "required", "multiple"],
    option: ["value", "selected", "disabled"],
    label: ["for"],
    button: ["type", "disabled"],
    form: ["method"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    ol: ["start", "reversed", "type"],
    time: ["datetime"],
    abbr: ["title"],
    blockquote: ["cite"],
    details: ["open"],
    dialog: ["open"]
  };

  const absolute = (value) => {
    try {
      return new URL(value, document.baseURI).href;
    } catch (error) {
      return "";
    }
  };

  function attributesOf(el, tag) {
    const out = {};
    for (const name of [...ATTRS["*"], ...(ATTRS[tag] || [])]) {
      if (el.hasAttribute(name)) out[name] = el.getAttribute(name);
    }
    for (const attr of el.attributes) if (/^aria-/.test(attr.name)) out[attr.name] = attr.value;
    if (tag === "a" && out.href && !out.href.startsWith("#") && !/^(mailto|tel):/i.test(out.href)) out.href = absolute(out.href);
    if (tag === "img") out.src = el.currentSrc || absolute(el.getAttribute("src") || "");
    if (tag === "video") {
      out.src = el.currentSrc || absolute(el.getAttribute("src") || "");
      if (out.poster) out.poster = absolute(out.poster);
    }
    if (tag === "iframe" && out.src) out.src = absolute(out.src);
    if (tag === "input" && /checkbox|radio/.test(out.type || "")) out.checked = el.checked ? "" : undefined;
    return out;
  }

  // SVG kept as a tree; shapes get their computed paint as attributes since
  // the site's stylesheet will not travel with the clone.
  function svgTree(el) {
    const node = { t: el.tagName, a: {} };
    for (const attr of el.attributes) node.a[attr.name] = attr.value;
    if (/^(path|circle|rect|line|polyline|polygon|ellipse|text|tspan|use)$/i.test(el.tagName)) {
      const cs = getComputedStyle(el);
      node.a.fill = cs.fill;
      node.a.stroke = cs.stroke;
      if (cs.stroke !== "none") node.a["stroke-width"] = cs.strokeWidth;
      if (cs.opacity !== "1") node.a.opacity = cs.opacity;
    }
    const href = el.getAttribute("href") || el.getAttribute("xlink:href");
    if (el.tagName.toLowerCase() === "use" && href && href.startsWith("#")) {
      const target = document.getElementById(href.slice(1));
      if (target) {
        const group = { t: target.tagName.toLowerCase() === "symbol" ? "svg" : "g", a: {}, c: Array.from(target.children).map(svgTree) };
        if (target.getAttribute("viewBox")) group.a.viewBox = target.getAttribute("viewBox");
        for (const name of ["x", "y", "width", "height"]) if (el.hasAttribute(name)) group.a[name] = el.getAttribute(name);
        return group;
      }
    }
    const children = [];
    for (const child of el.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) children.push(svgTree(child));
      else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) children.push({ x: child.textContent });
    }
    if (children.length) node.c = children;
    return node;
  }

  function collapse(text, whiteSpace) {
    return /^pre/.test(whiteSpace || "") || whiteSpace === "break-spaces" ? text : text.replace(/[\t\n\r ]+/g, " ");
  }

  function finish() {
    const nodes = state.nodes.map((node, index) => {
      if (node.k === "t") {
        const parent = state.nodes[node.parent];
        const ws = parent && parent.el.isConnected ? getComputedStyle(parent.el).whiteSpace : "normal";
        return { k: "t", parent: node.parent, x: collapse(node.node.textContent, ws) };
      }
      if (node.k === "p") return { k: "p", parent: node.parent, tag: node.tag };
      const el = node.el;
      const out = { k: "e", parent: node.parent, tag: node.tag, a: el.isConnected ? attributesOf(el, node.tag) : {} };
      // Original class names: only used to name the generated components.
      const cls = (el.getAttribute("class") || "").split(/\s+/).filter((name) => name && name.length < 30 && !/\d{3,}|__|^(css|sc|jsx)-/.test(name));
      if (cls.length) out.cls = cls.slice(0, 3);
      if (node.tag === "svg" && el.isConnected) out.svg = svgTree(el);
      return out;
    });
    const html = getComputedStyle(document.documentElement);
    const description = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    const icon = document.querySelector('link[rel~="icon"]')?.href || "";
    const result = {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || "",
      description,
      icon,
      widths: state.widths,
      nodes,
      measures: state.measures,
      htmlBackground: html.backgroundColor,
      truncated: state.truncated
    };
    state.frame?.remove();
    window.scrollTo(state.scroll[0], state.scroll[1]);
    delete globalThis.__keysOsiClone;
    return result;
  }

  // Lazy images and scroll-triggered reveals: scroll through once.
  async function prepare() {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const step = Math.max(400, Math.floor(window.innerHeight * 0.85));
    const max = Math.min(document.documentElement.scrollHeight, 30000);
    for (let y = 0; y <= max; y += step) {
      window.scrollTo(0, y);
      await sleep(80);
    }
    window.scrollTo(0, 0);
    await sleep(300);
    collect();
    return { nodes: state.nodes.length, truncated: state.truncated };
  }

  globalThis.__keysOsiClone = { prepare, measure, finish };
})();
