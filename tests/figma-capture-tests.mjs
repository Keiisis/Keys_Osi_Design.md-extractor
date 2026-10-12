/**
 * Keys_Osi page -> Figma pipeline tests.
 *  1. figma-capture.js on a fixture page in Chromium (exact layout/paint values).
 *  2. figma-plugin/ui.html in Chromium: image bytes fetched and posted to main.
 *  3. figma-plugin/code.js in node:vm against a mock `figma` API: layers,
 *     auto-layout, components/instances, then W3C tokens -> Variables/styles.
 *
 * Usage: node tests/figma-capture-tests.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { chromium } from "playwright-core";
import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { generateW3cTokens } from "../lib/export-tokens.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIXTURES = join(ROOT, "tests", "fixtures", "figma-capture");
const CAPTURE_JS = join(ROOT, "figma-capture.js");
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png" };

const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected, label, eps = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
const findAll = (node, pred, out = []) => {
  if (pred(node)) out.push(node);
  (node.children || []).forEach((c) => findAll(c, pred, out));
  return out;
};
const findOne = (node, pred, label) => {
  const list = findAll(node, pred);
  assert.equal(list.length, 1, `exactly one node expected: ${label}`);
  return list[0];
};
const rgb = (r, g, b, a = 1) => ({ r: Math.round((r / 255) * 10000) / 10000, g: Math.round((g / 255) * 10000) / 10000, b: Math.round((b / 255) * 10000) / 10000, a });

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const file = path === "/ui.html" ? join(ROOT, "figma-plugin", "ui.html") : join(FIXTURES, path.slice(1));
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: "chromium", headless: true });
let doc;
let uiMessage;
try {
  /* ---------------------------------------------------------------- */
  /* 1. Capture                                                        */
  /* ---------------------------------------------------------------- */
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/page.html`);
  await page.addScriptTag({ path: CAPTURE_JS });
  const htmlBefore = await page.evaluate(() => document.documentElement.outerHTML);
  doc = await page.evaluate(() => window.__keysOsiFigmaCapture({}));
  const htmlAfter = await page.evaluate(() => document.documentElement.outerHTML);
  assert.equal(htmlAfter, htmlBefore, "capture must not mutate the page");

  // Safe to inject twice: same function, same output.
  await page.addScriptTag({ path: CAPTURE_JS });
  const again = await page.evaluate(() => window.__keysOsiFigmaCapture({}));
  const strip = (d) => Object.assign({}, d, { source: Object.assign({}, d.source, { capturedAt: "" }) });
  assert.deepEqual(strip(again), strip(doc), "second injection must produce the same document");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(doc)), "document must be JSON-serializable");

  assert.equal(doc.format, "keys-osi-figma");
  assert.equal(doc.version, 1);
  assert.equal(doc.source.title, "Keys_Osi Figma fixture");
  assert.equal(doc.source.url, `${base}/page.html`);
  assert.deepEqual(doc.source.viewport, { width: 1280, height: 800 });
  assert.ok(!Number.isNaN(Date.parse(doc.source.capturedAt)));

  const root = doc.root;
  assert.equal(root.type, "FRAME");
  assert.equal(root.name, "Keys_Osi Figma fixture");
  assert.equal(root.clipsContent, true);
  assert.deepEqual(root.fills, [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }], "canvas fill comes from body");
  assert.deepEqual(
    root.children.map((c) => c.name),
    ["nav#main-nav · Navigation principale", "section.hero", "div.cards", "img.photo · Photo test", "Un paragraphe avec gras et un lien."],
    "plain body is flattened, hidden ghost skipped"
  );

  // Flex nav with gap.
  const nav = root.children[0];
  assert.deepEqual(nav.layout, {
    mode: "HORIZONTAL", wrap: "NO_WRAP", gap: 24, counterGap: null, padding: [16, 32, 16, 32],
    primaryAlign: "MIN", counterAlign: "CENTER", sizing: { horizontal: "FIXED", vertical: "HUG" }
  });
  assert.deepEqual(nav.fills, [{ type: "SOLID", color: { r: rgb(15, 23, 42).r, g: rgb(15, 23, 42).g, b: rgb(15, 23, 42).b }, opacity: 1 }]);
  assert.deepEqual([nav.x, nav.y, nav.width, nav.height], [0, 0, 1280, 56]);
  assert.deepEqual(nav.children.map((c) => c.type), ["SVG", "TEXT", "TEXT", "TEXT"]);
  assert.deepEqual(nav.children.slice(1).map((c) => c.text.characters), ["Accueil", "Produits", "Contact"]);
  assert.deepEqual([nav.children[0].x, nav.children[0].y, nav.children[0].width, nav.children[0].height], [32, 16, 24, 24]);

  // Inline SVG with currentColor resolved.
  const svg = nav.children[0];
  assert.match(svg.svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg.svg, /<path fill="rgb\(220, 38, 38\)"/);
  assert.ok(!/currentColor/i.test(svg.svg), "currentColor must be resolved");
  assert.match(svg.svg, /width="24" height="24"/);

  // Gradient hero: two layers, shadows, per-corner radius, ::before badge.
  const hero = root.children[1];
  assert.equal(hero.fills.length, 2);
  assert.deepEqual(hero.fills[0], {
    type: "GRADIENT_LINEAR",
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }]
  }, "bottom CSS layer (linear) is first Figma fill");
  const radial = hero.fills[1];
  assert.equal(radial.type, "GRADIENT_RADIAL");
  assert.deepEqual(radial.gradientStops, [{ position: 0, color: { r: 1, g: 1, b: 1, a: 0.5 } }, { position: 1, color: { r: 1, g: 1, b: 1, a: 0 } }]);
  {
    // circle at 25% 50%, farthest-corner: radius = distance to the far corner.
    const w = hero.width;
    const h = hero.height;
    const r = Math.hypot(0.75 * w, 0.5 * h);
    const [[a, b, c], [d, e, f]] = radial.gradientTransform;
    close(a, w / (2 * r), "radial m00", 1e-5);
    close(b, 0, "radial m01", 1e-9);
    close(c, 0.5 - 0.25 * (w / (2 * r)), "radial m02", 1e-5);
    close(d, 0, "radial m10", 1e-9);
    close(e, h / (2 * r), "radial m11", 1e-5);
    close(f, 0.5 - 0.5 * (h / (2 * r)), "radial m12", 1e-5);
  }
  assert.deepEqual(hero.effects, [
    { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 12, spread: 2, visible: true, blendMode: "NORMAL" },
    { type: "INNER_SHADOW", color: { r: 1, g: 1, b: 1, a: 0.5 }, offset: { x: 0, y: 1 }, radius: 0, spread: 0, visible: true, blendMode: "NORMAL" }
  ]);
  assert.deepEqual(hero.cornerRadii, [24, 8, 0, 16]);
  assert.equal(hero.layout.mode, "VERTICAL");
  assert.deepEqual(hero.layout.padding, [48, 48, 144, 48]);
  const badge = hero.children[0];
  assert.equal(badge.name, "::before");
  assert.equal(badge.layoutPositioning, "ABSOLUTE");
  assert.deepEqual([badge.x, badge.y, badge.width, badge.height], [12, 12, 80, 24]);
  assert.deepEqual(badge.fills, [{ type: "SOLID", color: { r: rgb(250, 204, 21).r, g: rgb(250, 204, 21).g, b: rgb(250, 204, 21).b }, opacity: 1 }]);
  assert.deepEqual(badge.cornerRadii, [12, 12, 12, 12]);
  assert.equal(badge.children[0].text.characters, "Nouveau");
  assert.equal(badge.children[0].text.align, "CENTER");
  const h1 = hero.children[1];
  assert.equal(h1.type, "TEXT");
  assert.equal(h1.text.characters, "Titre héros");
  assert.deepEqual(h1.sizing, { horizontal: "FILL", vertical: "FIXED" });
  assert.deepEqual([h1.x, h1.y], [48, 48]);

  // Grid of 3 cards -> horizontal auto-layout row, component candidates.
  const cards = root.children[2];
  assert.equal(cards.layout.mode, "HORIZONTAL");
  assert.equal(cards.layout.gap, 20);
  assert.deepEqual(cards.layout.padding, [24, 24, 24, 24]);
  assert.equal(cards.children.length, 3);
  const candidates = cards.children.map((c) => c.componentCandidate);
  assert.ok(candidates[0] && candidates.every((c) => c === candidates[0]), "3 identical cards share a candidate signature");
  assert.equal(findAll(root, (n) => n.componentCandidate).length, 3, "only the cards are candidates");
  assert.deepEqual(cards.children.map((c) => c.x), [24, 244, 464]);
  const card = cards.children[0];
  assert.deepEqual(card.layout, {
    mode: "VERTICAL", wrap: "NO_WRAP", gap: 8, counterGap: null, padding: [17, 17, 20, 17],
    primaryAlign: "MIN", counterAlign: "MIN", sizing: { horizontal: "FIXED", vertical: "HUG" }
  });
  assert.deepEqual(card.strokes, [{ type: "SOLID", color: { r: rgb(229, 231, 235).r, g: rgb(229, 231, 235).g, b: rgb(229, 231, 235).b }, opacity: 1 }]);
  assert.deepEqual(card.strokeWeights, { top: 1, right: 1, bottom: 0, left: 1 }, "odd-colored side moves to an inset shadow");
  assert.deepEqual(card.effects, [
    { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0, visible: true, blendMode: "NORMAL" },
    { type: "INNER_SHADOW", color: rgb(37, 99, 235), offset: { x: 0, y: -4 }, radius: 0, spread: 0, visible: true, blendMode: "NORMAL" }
  ]);
  assert.deepEqual(card.cornerRadii, [12, 12, 12, 12]);
  assert.deepEqual(card.children.map((c) => c.text.characters), ["Carte 1", "Texte un"]);
  assert.deepEqual(card.children[0].sizing, { horizontal: "FILL", vertical: "FIXED" });

  // Image with object-fit: cover.
  const img = root.children[3];
  assert.equal(img.type, "IMAGE");
  assert.deepEqual([img.width, img.height], [300, 150]);
  assert.deepEqual(img.fills, [{ type: "IMAGE", imageId: "img-1", scaleMode: "FILL" }]);
  assert.deepEqual(doc.images, [{ id: "img-1", url: `${base}/photo.png`, width: 4, height: 2 }]);

  // Paragraph with bold + link spans -> segments.
  const lead = root.children[4];
  assert.equal(lead.type, "TEXT");
  assert.equal(lead.text.characters, "Un paragraphe avec gras et un lien.");
  const ink = rgb(17, 24, 39);
  const linkBlue = rgb(37, 99, 235);
  const seg = (start, end, weight, color, decoration, href) => {
    const s = {
      start, end, family: "Keys Missing Font", families: ["Keys Missing Font", "Arial", "sans-serif"], style: "normal",
      weight, size: 16, lineHeightPx: 24, letterSpacingPx: 0, color, decoration, case: "ORIGINAL"
    };
    if (href) s.href = href;
    return s;
  };
  assert.deepEqual(lead.text.segments, [
    seg(0, 19, 400, ink, "NONE"),
    seg(19, 23, 700, ink, "NONE"),
    seg(23, 30, 400, ink, "NONE"),
    seg(30, 34, 400, linkBlue, "UNDERLINE", "https://example.com/doc"),
    seg(34, 35, 400, ink, "NONE")
  ]);
  assert.deepEqual(
    doc.fonts.filter((f) => f.family === "Arial").map((f) => f.weight).sort(),
    [400, 700]
  );

  // Options.
  const scoped = await page.evaluate(() => window.__keysOsiFigmaCapture({ selector: "#main-nav" }));
  assert.equal(scoped.root.name, "Keys_Osi Figma fixture");
  assert.deepEqual([scoped.root.x, scoped.root.y], [0, 0]);
  assert.equal(scoped.root.children.length, 4);
  const truncated = await page.evaluate(() => window.__keysOsiFigmaCapture({ maxNodes: 5 }));
  assert.equal(truncated.stats.truncated, true);
  assert.ok(truncated.stats.nodes <= 6);
  const withHidden = await page.evaluate(() => window.__keysOsiFigmaCapture({ includeHidden: true }));
  const ghost = findOne(withHidden.root, (n) => n.name === "div.ghost", "ghost");
  assert.equal(ghost.visible, false);
  assert.equal(findAll(doc.root, (n) => n.name === "div.ghost").length, 0);
  await assert.rejects(page.evaluate(() => window.__keysOsiFigmaCapture({ selector: "#nope" })), /sélecteur introuvable/);

  /* ---------------------------------------------------------------- */
  /* 2. Plugin UI: fetch image bytes, post to main                     */
  /* ---------------------------------------------------------------- */
  const ui = await browser.newPage();
  await ui.goto(`${base}/ui.html`);
  await ui.evaluate(() => {
    window.__posted = [];
    window.addEventListener("message", (e) => {
      if (e.data && e.data.pluginMessage) window.__posted.push(e.data.pluginMessage);
    });
  });
  await ui.fill("#paste", JSON.stringify(doc));
  await ui.click("#import");
  await ui.waitForFunction(() => window.__posted.some((m) => m.type === "import-capture"));
  uiMessage = await ui.evaluate(() => {
    const m = window.__posted.find((x) => x.type === "import-capture");
    const images = {};
    for (const [id, bytes] of Object.entries(m.images)) {
      images[id] = { isUint8: bytes instanceof Uint8Array, bytes: Array.from(bytes) };
    }
    return { doc: m.doc, images };
  });
  assert.equal(uiMessage.doc.root.name, doc.root.name);
  assert.equal(uiMessage.images["img-1"].isUint8, true, "image bytes travel as Uint8Array");
  const png = await readFile(join(FIXTURES, "photo.png"));
  assert.deepEqual(uiMessage.images["img-1"].bytes, Array.from(png), "PNG bytes are passed through untouched");
  await ui.evaluate(() => window.postMessage({ pluginMessage: {
    type: "done", kind: "capture",
    summary: { title: "T", nodes: 3, frames: 1, texts: 1, images: 1, svgs: 0, components: 1, instances: 2, missingFonts: ["Keys Missing Font"], failedImages: [], failedSvgs: 0 }
  } }, "*"));
  await ui.waitForFunction(() => document.getElementById("result").textContent.includes("importée"));
  const resultText = await ui.textContent("#result");
  assert.match(resultText, /Page « T » importée\./);
  assert.match(resultText, /Polices absentes de Figma \(remplacées\) :Keys Missing Font/);
  await ui.fill("#paste", "{ pas du json");
  await ui.click("#import");
  assert.match(await ui.textContent("#result"), /JSON invalide/);
} finally {
  await browser.close();
  server.close();
}

/* ------------------------------------------------------------------ */
/* 3. Plugin main thread against a mock figma API                      */
/* ------------------------------------------------------------------ */

function createMockFigma() {
  let seq = 0;
  const loaded = new Set();
  const fontKey = (f) => `${f.family}::${f.style}`;
  const available = [
    ["Inter", ["Regular", "Medium", "Semi Bold", "Bold"]],
    ["Arial", ["Regular", "Bold", "Italic", "Bold Italic"]]
  ];
  const availableSet = new Set(available.flatMap(([family, styles]) => styles.map((style) => `${family}::${style}`)));
  const requireFont = (f) => {
    if (!loaded.has(fontKey(f))) throw new Error(`font not loaded: ${fontKey(f)}`);
  };
  const isAuto = (n) => !!n && (n.layoutMode === "HORIZONTAL" || n.layoutMode === "VERTICAL");
  const checkPaints = (paints) => {
    for (const p of paints) {
      if (p.type === "SOLID") assert.deepEqual(Object.keys(p.color).sort(), ["b", "g", "r"], "SolidPaint.color is RGB");
      else if (p.type.startsWith("GRADIENT_")) {
        assert.equal(p.gradientTransform.length, 2);
        assert.ok(p.gradientStops.every((s) => "a" in s.color));
      } else if (p.type === "IMAGE") assert.ok(typeof p.imageHash === "string" && p.imageHash, "image paint needs imageHash");
      else throw new Error(`unknown paint ${p.type}`);
    }
  };

  class MockNode {
    constructor(type) {
      this.id = `n${++seq}`;
      this.type = type;
      this.name = type;
      this.parent = null;
      this.x = 0;
      this.y = 0;
      this.width = 100;
      this.height = 100;
      this.opacity = 1;
      this.visible = true;
      this.effects = [];
      if (type !== "TEXT" && type !== "RECTANGLE") this.children = [];
      if (type === "FRAME" || type === "COMPONENT" || type === "INSTANCE") {
        this.layoutMode = "NONE";
        this.clipsContent = true; // Figma frames clip by default
      }
    }
    appendChild(child) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = this;
      this.children.push(child);
    }
    resize(w, h) {
      assert.ok(w >= 0.01 && h >= 0.01, `invalid resize ${w}x${h}`);
      this.width = w;
      this.height = h;
    }
    set fills(v) { checkPaints(v); this._fills = v; }
    get fills() { return this._fills || []; }
    set strokes(v) { checkPaints(v); this._strokes = v; }
    get strokes() { return this._strokes || []; }
    set layoutPositioning(v) {
      if (!isAuto(this.parent)) throw new Error("layoutPositioning needs an auto-layout parent");
      this._layoutPositioning = v;
    }
    get layoutPositioning() { return this._layoutPositioning || "AUTO"; }
    set layoutSizingHorizontal(v) { this._sizing("H", v); }
    get layoutSizingHorizontal() { return this._sizeH || "FIXED"; }
    set layoutSizingVertical(v) { this._sizing("V", v); }
    get layoutSizingVertical() { return this._sizeV || "FIXED"; }
    _sizing(axis, v) {
      if (v === "FILL" && !isAuto(this.parent)) throw new Error("FILL needs an auto-layout parent");
      if (v === "HUG" && !isAuto(this) && this.type !== "TEXT") throw new Error("HUG needs an auto-layout frame or text");
      this[axis === "H" ? "_sizeH" : "_sizeV"] = v;
    }
  }

  class MockText extends MockNode {
    constructor() {
      super("TEXT");
      this._fontName = { family: "Inter", style: "Regular" };
      this.ranges = [];
    }
    set fontName(f) { requireFont(f); this._fontName = f; }
    get fontName() { return this._fontName; }
    set characters(v) { requireFont(this._fontName); this._characters = v; }
    get characters() { return this._characters || ""; }
  }
  for (const method of ["FontName", "FontSize", "Fills", "LineHeight", "LetterSpacing", "TextDecoration", "TextCase", "Hyperlink"]) {
    MockText.prototype[`setRange${method}`] = function (start, end, value) {
      requireFont(this._fontName);
      if (method === "FontName") requireFont(value);
      if (method === "Fills") checkPaints(value);
      assert.ok(start >= 0 && end <= this.characters.length && start < end, `bad range ${start}-${end}`);
      this.ranges.push({ method, start, end, value });
    };
  }

  const cloneTree = (node, asInstance) => {
    const copy = node.type === "TEXT" ? new MockText() : new MockNode(asInstance ? "INSTANCE" : node.type);
    for (const key of Object.keys(node)) {
      if (["id", "parent", "children", "type"].includes(key) || typeof node[key] === "function") continue;
      copy[key] = structuredClone(node[key]);
    }
    if (node.children) {
      copy.children = [];
      node.children.forEach((c) => copy.appendChild(cloneTree(c, false)));
    }
    return copy;
  };

  const page = new MockNode("PAGE");
  page.selection = [];
  const messages = [];
  const variables = [];
  const collections = [];
  const textStyles = [];
  const effectStyles = [];
  let imageSeq = 0;
  const imageAsyncCalls = [];

  const figma = {
    currentPage: page,
    messages,
    imageAsyncCalls,
    ui: { postMessage: (m) => messages.push(plain(m)), onmessage: null },
    showUI: (html, opts) => { figma.shownWith = opts; },
    notify: (m) => { figma.notified = m; },
    closePlugin: () => { figma.closed = true; },
    viewport: { scrollAndZoomIntoView: (nodes) => { figma.zoomedTo = nodes; } },
    listAvailableFontsAsync: async () => available.flatMap(([family, styles]) => styles.map((style) => ({ fontName: { family, style } }))),
    loadFontAsync: async (f) => {
      if (!availableSet.has(fontKey(f))) throw new Error(`no font ${fontKey(f)}`);
      loaded.add(fontKey(f));
    },
    createFrame: () => { const n = new MockNode("FRAME"); page.appendChild(n); return n; },
    createRectangle: () => { const n = new MockNode("RECTANGLE"); page.appendChild(n); return n; },
    createText: () => { const n = new MockText(); page.appendChild(n); return n; },
    createNodeFromSvg: (svg) => {
      assert.match(svg, /^<svg/);
      const n = new MockNode("FRAME");
      n.svg = svg;
      n.appendChild(new MockNode("VECTOR"));
      page.appendChild(n);
      return n;
    },
    createImage: (bytes) => {
      assert.ok(bytes instanceof Uint8Array, "createImage takes a Uint8Array");
      assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
      return { hash: `hash-${++imageSeq}` };
    },
    createImageAsync: async (url) => {
      imageAsyncCalls.push(url);
      throw new Error("offline");
    },
    createComponentFromNode: (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (p.type === "COMPONENT" || p.type === "INSTANCE") throw new Error("Cannot create component from node");
      }
      node.type = "COMPONENT";
      node.createInstance = () => {
        const inst = cloneTree(node, true);
        delete inst.createInstance;
        page.appendChild(inst);
        return inst;
      };
      return node;
    },
    createTextStyle: () => {
      const s = { type: "TEXT", name: "", fontSize: 12, _font: null };
      Object.defineProperty(s, "fontName", { set(f) { requireFont(f); s._font = f; }, get() { return s._font; }, enumerable: true });
      textStyles.push(s);
      return s;
    },
    createEffectStyle: () => {
      const s = { type: "EFFECT", name: "", effects: [] };
      effectStyles.push(s);
      return s;
    },
    getLocalTextStylesAsync: async () => textStyles.slice(),
    getLocalEffectStylesAsync: async () => effectStyles.slice(),
    variables: {
      getLocalVariableCollectionsAsync: async () => collections.slice(),
      getLocalVariablesAsync: async () => variables.slice(),
      createVariableCollection: (name) => {
        const c = {
          id: `col${collections.length + 1}`, name, modes: [{ modeId: "m1", name: "Mode 1" }], defaultModeId: "m1",
          renameMode(modeId, newName) { this.modes.find((m) => m.modeId === modeId).name = newName; }
        };
        collections.push(c);
        return c;
      },
      createVariable: (name, collection, type) => {
        assert.equal(typeof collection, "object", "createVariable takes the collection object");
        assert.ok(["COLOR", "FLOAT"].includes(type));
        const v = {
          id: `var${variables.length + 1}`, name, resolvedType: type, variableCollectionId: collection.id,
          valuesByMode: {}, scopes: ["ALL_SCOPES"], description: "",
          setValueForMode(modeId, value) {
            assert.ok(collection.modes.some((m) => m.modeId === modeId), "unknown mode");
            if (type === "COLOR") assert.ok(["r", "g", "b", "a"].every((k) => typeof value[k] === "number" && value[k] >= 0 && value[k] <= 1));
            else assert.equal(typeof value, "number");
            this.valuesByMode[modeId] = value;
          },
          remove() { variables.splice(variables.indexOf(this), 1); }
        };
        variables.push(v);
        return v;
      }
    },
    _state: { variables, collections, textStyles, effectStyles, loaded }
  };
  return figma;
}

const code = await readFile(join(ROOT, "figma-plugin", "code.js"), "utf8");
assert.ok(!/\?\.|\?\?|\bcatch\s*\{/.test(code), "code.js stays ES2017 (no ?. / ?? / optional catch binding)");
const manifest = JSON.parse(await readFile(join(ROOT, "figma-plugin", "manifest.json"), "utf8"));
assert.equal(manifest.name, "Keys_Osi Import");
assert.deepEqual(manifest.editorType, ["figma"]);
assert.equal(manifest.documentAccess, "dynamic-page");
assert.equal(manifest.main, "code.js");
assert.equal(manifest.ui, "ui.html");
assert.ok(manifest.networkAccess.reasoning && manifest.networkAccess.allowedDomains.includes("*"), "wildcard access needs reasoning");

const figma = createMockFigma();
vm.runInContext(code, vm.createContext({ figma, __html__: "<html></html>", console }));
assert.equal(typeof figma.ui.onmessage, "function");
assert.equal(figma.shownWith.themeColors, true);

{
  const images = {};
  for (const [id, entry] of Object.entries(uiMessage.images)) images[id] = new Uint8Array(entry.bytes);
  await figma.ui.onmessage({ type: "import-capture", doc: uiMessage.doc, images });
  const done = figma.messages.find((m) => m.type === "done");
  assert.ok(done, `import should finish: ${JSON.stringify(figma.messages.filter((m) => m.type === "error"))}`);
  assert.ok(figma.messages.some((m) => m.type === "progress"), "progress is reported");
  assert.deepEqual(figma.imageAsyncCalls, [], "UI bytes are used, no main-thread fetch");

  const page = figma.currentPage;
  assert.equal(page.children.length, 1);
  const root = page.children[0];
  assert.equal(root.type, "FRAME");
  assert.equal(root.name, "Keys_Osi Figma fixture");
  assert.ok(page.selection.length === 1 && page.selection[0] === root, "imported frame is selected");
  assert.deepEqual([root.width, root.height], [doc.root.width, doc.root.height]);
  assert.equal(root.clipsContent, true);
  assert.equal(root.children.length, 5);

  const all = findAll(root, () => true);
  const count = (type) => all.filter((n) => n.type === type).length;
  assert.equal(count("FRAME"), 1 + 1 + 1 + 1 + 1 + 1, "root, nav, hero, ::before, cards, svg frame");
  assert.equal(count("COMPONENT"), 1);
  assert.equal(count("INSTANCE"), 2);
  assert.equal(count("RECTANGLE"), 1);

  const nav = root.children[0];
  assert.equal(nav.layoutMode, "HORIZONTAL");
  assert.equal(nav.itemSpacing, 24);
  assert.deepEqual([nav.paddingTop, nav.paddingRight, nav.paddingBottom, nav.paddingLeft], [16, 32, 16, 32]);
  assert.equal(nav.primaryAxisAlignItems, "MIN");
  assert.equal(nav.counterAxisAlignItems, "CENTER");
  assert.equal(nav.layoutSizingVertical, "HUG");
  assert.equal(nav.layoutSizingHorizontal, "FIXED");
  assert.equal(nav.clipsContent, false);
  assert.deepEqual(plain(nav.fills), [{ type: "SOLID", color: { r: rgb(15, 23, 42).r, g: rgb(15, 23, 42).g, b: rgb(15, 23, 42).b }, opacity: 1 }]);
  assert.match(nav.children[0].svg, /fill="rgb\(220, 38, 38\)"/);
  assert.deepEqual(plain(nav.children[0].fills), []);
  assert.deepEqual(nav.children.slice(1).map((t) => t.characters), ["Accueil", "Produits", "Contact"]);
  assert.equal(nav.children[1].textAutoResize, "WIDTH_AND_HEIGHT");

  const hero = root.children[1];
  assert.deepEqual(plain(hero.fills).map((p) => p.type), ["GRADIENT_LINEAR", "GRADIENT_RADIAL"]);
  assert.deepEqual(plain(hero.fills[0].gradientTransform), [[1, 0, 0], [0, 1, 0]]);
  assert.deepEqual(plain(hero.effects), plain(doc.root.children[1].effects));
  assert.deepEqual([hero.topLeftRadius, hero.topRightRadius, hero.bottomRightRadius, hero.bottomLeftRadius], [24, 8, 0, 16]);
  assert.equal(hero.layoutMode, "VERTICAL");
  assert.deepEqual([hero.paddingTop, hero.paddingBottom], [48, 144]);
  const badge = hero.children[0];
  assert.equal(badge.name, "::before");
  assert.equal(badge.layoutPositioning, "ABSOLUTE");
  assert.deepEqual([badge.x, badge.y, badge.width, badge.height], [12, 12, 80, 24]);
  assert.equal(badge.children[0].characters, "Nouveau");
  assert.equal(badge.children[0].textAlignHorizontal, "CENTER");
  const h1 = hero.children[1];
  assert.equal(h1.characters, "Titre héros");
  assert.equal(h1.layoutSizingHorizontal, "FILL");

  const cards = root.children[2];
  assert.equal(cards.layoutMode, "HORIZONTAL");
  assert.equal(cards.itemSpacing, 20);
  assert.deepEqual(cards.children.map((c) => c.type), ["COMPONENT", "INSTANCE", "INSTANCE"]);
  const [main, inst2, inst3] = cards.children;
  assert.equal(main.layoutMode, "VERTICAL");
  assert.equal(main.itemSpacing, 8);
  assert.deepEqual([main.strokeTopWeight, main.strokeRightWeight, main.strokeBottomWeight, main.strokeLeftWeight], [1, 1, 0, 1]);
  assert.equal(main.strokeAlign, "INSIDE");
  assert.deepEqual(main.children.map((t) => t.characters), ["Carte 1", "Texte un"]);
  assert.deepEqual(inst2.children.map((t) => t.characters), ["Carte 2", "Texte deux"]);
  assert.deepEqual(inst3.children.map((t) => t.characters), ["Carte 3", "Texte trois"]);
  assert.equal(inst2.layoutMode, "VERTICAL", "instance mirrors the main component");

  const photo = root.children[3];
  assert.equal(photo.type, "RECTANGLE");
  assert.deepEqual(plain(photo.fills), [{ type: "IMAGE", imageHash: "hash-1", scaleMode: "FILL" }]);
  assert.deepEqual([photo.x, photo.y, photo.width, photo.height], [doc.root.children[3].x, doc.root.children[3].y, 300, 150]);

  const lead = root.children[4];
  assert.equal(lead.characters, "Un paragraphe avec gras et un lien.");
  const fontRanges = lead.ranges.filter((r) => r.method === "FontName").map((r) => [r.start, r.end, r.value.family, r.value.style]);
  assert.deepEqual(fontRanges, [[0, 19, "Arial", "Regular"], [19, 23, "Arial", "Bold"], [23, 30, "Arial", "Regular"], [30, 34, "Arial", "Regular"], [34, 35, "Arial", "Regular"]]);
  assert.deepEqual(plain(lead.ranges.find((r) => r.method === "Hyperlink")), { method: "Hyperlink", start: 30, end: 34, value: { type: "URL", value: "https://example.com/doc" } });
  assert.deepEqual(plain(lead.ranges.find((r) => r.method === "TextDecoration" && r.start === 30).value), "UNDERLINE");
  assert.deepEqual(plain(lead.ranges.find((r) => r.method === "LineHeight").value), { value: 24, unit: "PIXELS" });

  assert.deepEqual(done.summary.missingFonts, ["Keys Missing Font"]);
  assert.equal(done.summary.components, 1);
  assert.equal(done.summary.instances, 2);
  assert.equal(done.summary.images, 1);
  assert.equal(done.summary.svgs, 1);
  assert.deepEqual(done.summary.failedImages, []);

  // Missing image bytes: main thread falls back to createImageAsync, then a placeholder.
  figma.messages.length = 0;
  await figma.ui.onmessage({ type: "import-capture", doc: uiMessage.doc, images: {} });
  const second = figma.messages.find((m) => m.type === "done");
  assert.deepEqual(figma.imageAsyncCalls, [uiMessage.doc.images[0].url]);
  assert.deepEqual(second.summary.failedImages, [uiMessage.doc.images[0].url]);
  const secondRoot = figma.currentPage.children[1];
  assert.ok(secondRoot.x >= root.x + root.width, "new import is placed beside existing content");
  assert.deepEqual(plain(secondRoot.children[3].fills), [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 1 }]);

  figma.messages.length = 0;
  await figma.ui.onmessage({ type: "import-capture", doc: { format: "other" }, images: {} });
  assert.match(figma.messages.find((m) => m.type === "error").message, /n'est pas une capture Keys_Osi/);
}

{
  // Tokens: mockPayload from tests/run-tests.mjs -> normalize -> W3C tokens.
  const src = await readFile(join(ROOT, "tests", "run-tests.mjs"), "utf8");
  const start = src.indexOf("const mockPayload = {");
  const end = src.indexOf("\n};\n", start);
  assert.ok(start > 0 && end > start, "mockPayload found in run-tests.mjs");
  const mockPayload = vm.runInNewContext(`(${src.slice(start + "const mockPayload = ".length, end + 2)})`);
  const tokens = plain(generateW3cTokens(normalizeExtractedStyles(mockPayload)));

  const figmaT = createMockFigma();
  vm.runInContext(code, vm.createContext({ figma: figmaT, __html__: "", console }));
  await figmaT.ui.onmessage({ type: "import-tokens", tokens });
  const done = figmaT.messages.find((m) => m.type === "done");
  assert.ok(done, `tokens import should finish: ${JSON.stringify(figmaT.messages.filter((m) => m.type === "error"))}`);
  const { variables, collections, textStyles, effectStyles } = figmaT._state;
  assert.equal(collections.length, 1);
  assert.equal(collections[0].name, "Keys_Osi tokens");
  assert.equal(collections[0].modes[0].name, "Valeur");

  const byName = Object.fromEntries(variables.map((v) => [v.name, v]));
  const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });
  const expectColors = {
    "color/surface/base": "#ffffff", "color/surface/muted": "#f9fafb", "color/text/primary": "#111827",
    "color/text/secondary": "#4b5563", "color/brand/primary": "#2563eb", "color/border/default": "#e5e7eb", "color/focus/ring": "#3b82f6"
  };
  for (const [name, value] of Object.entries(expectColors)) {
    assert.ok(byName[name], `variable ${name}`);
    assert.equal(byName[name].resolvedType, "COLOR");
    assert.deepEqual(plain(byName[name].valuesByMode.m1), hex(value), name);
  }
  const expectFloats = {
    "font/size/xs": 14, "font/size/sm": 16, "font/size/md": 20,
    "dimension/space/1": 8, "dimension/space/2": 12, "dimension/space/3": 16,
    "dimension/radius/xs": 6, "dimension/radius/sm": 8, "duration/instant": 150
  };
  for (const [name, value] of Object.entries(expectFloats)) {
    assert.ok(byName[name], `variable ${name}`);
    assert.equal(byName[name].resolvedType, "FLOAT");
    assert.equal(byName[name].valuesByMode.m1, value, name);
  }
  assert.equal(variables.length, Object.keys(expectColors).length + Object.keys(expectFloats).length);
  assert.deepEqual(plain(byName["font/size/xs"].scopes), ["FONT_SIZE"]);
  assert.deepEqual(plain(byName["dimension/radius/xs"].scopes), ["CORNER_RADIUS"]);
  assert.deepEqual(plain(byName["dimension/space/1"].scopes), ["GAP", "WIDTH_HEIGHT"]);
  assert.deepEqual(plain(byName["color/text/primary"].scopes), ["TEXT_FILL"]);
  assert.deepEqual(plain(byName["color/border/default"].scopes), ["STROKE_COLOR"]);

  assert.deepEqual(
    textStyles.map((s) => [s.name, s.fontName.family, s.fontName.style, s.fontSize]),
    [["Keys_Osi/Texte/xs", "Inter", "Regular", 14], ["Keys_Osi/Texte/sm", "Inter", "Regular", 16], ["Keys_Osi/Texte/md", "Inter", "Regular", 20]]
  );
  assert.equal(effectStyles.length, 1);
  assert.equal(effectStyles[0].name, "Keys_Osi/Ombre/1");
  assert.deepEqual(plain(effectStyles[0].effects), [
    { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0, visible: true, blendMode: "NORMAL" }
  ]);
  assert.deepEqual(done.summary, {
    collection: "Keys_Osi tokens", created: 16, updated: 0, colors: 7, floats: 9,
    textStyles: 3, effectStyles: 1, skipped: ["gradient/1 (gradient)"]
  });

  // Re-import is idempotent: same collection, variables and styles updated in place.
  figmaT.messages.length = 0;
  await figmaT.ui.onmessage({ type: "import-tokens", tokens });
  const again = figmaT.messages.find((m) => m.type === "done");
  assert.equal(again.summary.created, 0);
  assert.equal(again.summary.updated, 16);
  assert.equal(collections.length, 1);
  assert.equal(variables.length, 16);
  assert.equal(textStyles.length, 3);
  assert.equal(effectStyles.length, 1);
}

console.log("Figma capture tests passed.");
