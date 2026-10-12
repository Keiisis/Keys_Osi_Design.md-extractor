// Offline Figma import: binary decoding (ZIP, fig-kiwi header, zstd and
// deflate chunks, kiwi schema + message), REST-shaped rebuild, then the
// existing figma-import -> normalize -> DESIGN.md pipeline.
// Real samples: tests/fixtures/figma-offline/*.fig (see SOURCES.md). The
// clipboard fixture wraps a real canvas.fig in the clipboard HTML envelope.
// The auto-layout / component / style / image sample is synthetic: encoded
// below with the real schema shipped inside the clipboard sample.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  decodeFigBinary,
  decodeKiwiSchema,
  importFigFile,
  importFigmaClipboard,
  kiwiToRestFile,
  parseFigmaClipboardHtml,
  readFigFile
} from "../lib/figma-offline.mjs";
import { decompress as zstdDecompress } from "../lib/vendor/zstd-decode.mjs";
import { buildFigmaStructure, figmaToPayload, generateFigmaStructureMarkdown } from "../lib/figma-import.mjs";
import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { generateDesignMarkdown } from "../lib/generate-design-md.mjs";

const fixture = (name) => new URL(`./fixtures/figma-offline/${name}`, import.meta.url);
const close = (actual, expected, epsilon = 0.01, label = "") => assert.ok(Math.abs(actual - expected) <= epsilon, `${label} ${actual} ≉ ${expected}`);
const walk = (node, visit) => {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
};
const findAll = (root, predicate) => {
  const out = [];
  walk(root, (node) => {
    if (predicate(node)) out.push(node);
  });
  return out;
};
const findByName = (root, name) => findAll(root, (node) => node.name === name)[0];

/* ------------------------------------------------------------------ *
 * Byte helpers for the synthetic sample (encoder side of the format)
 * ------------------------------------------------------------------ */

function splitFigChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  for (let offset = 12; offset + 4 <= bytes.length; ) {
    const length = view.getUint32(offset, true);
    chunks.push(bytes.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  return { prelude: String.fromCharCode(...bytes.subarray(0, 8)), version: view.getUint32(8, true), chunks };
}

function buildFig(prelude, version, chunks) {
  const total = 12 + chunks.reduce((sum, chunk) => sum + 4 + chunk.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) out[i] = prelude.charCodeAt(i);
  view.setUint32(8, version, true);
  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.length, true);
    out.set(chunk, offset + 4);
    offset += 4 + chunk.length;
  }
  return out;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Kiwi encoder driven by the decoded schema: unknown field or enum names
// throw, so the synthetic sample can only use real format fields.
function encodeKiwi(schema, rootType, value) {
  const defs = new Map(schema.definitions.map((definition) => [definition.name, definition]));
  const out = [];
  const f32 = new Float32Array(1);
  const i32 = new Int32Array(f32.buffer);
  const byte = (b) => out.push(b & 255);
  const varUint = (v) => {
    let rest = v >>> 0;
    do {
      const b = rest & 127;
      rest >>>= 7;
      byte(rest ? b | 128 : b);
    } while (rest);
  };
  const varInt = (v) => varUint(((v << 1) ^ (v >> 31)) >>> 0);
  const varFloat = (v) => {
    f32[0] = v;
    const bits = (i32[0] >>> 23) | (i32[0] << 9);
    if ((bits & 255) === 0) return byte(0);
    byte(bits);
    byte(bits >> 8);
    byte(bits >> 16);
    byte(bits >> 24);
  };
  const string = (s) => {
    for (const b of new TextEncoder().encode(s)) byte(b);
    byte(0);
  };
  const single = (type, v) => {
    if (type === "bool") return byte(v ? 1 : 0);
    if (type === "byte") return byte(v);
    if (type === "int") return varInt(v);
    if (type === "uint") return varUint(v);
    if (type === "float") return varFloat(v);
    if (type === "string") return string(v);
    const definition = defs.get(type);
    if (!definition) throw new Error(`unknown type ${type}`);
    if (definition.kind === "ENUM") {
      const field = definition.fields.find((item) => item.name === v);
      if (!field) throw new Error(`unknown enum value ${type}.${v}`);
      return varUint(field.value);
    }
    return record(definition, v);
  };
  const field = (definition, v) => {
    if (!definition.isArray) return single(definition.type, v);
    varUint(v.length);
    for (const item of v) single(definition.type, item);
  };
  function record(definition, v) {
    if (definition.kind === "STRUCT") {
      for (const item of definition.fields) {
        if (v[item.name] === undefined) throw new Error(`missing struct field ${definition.name}.${item.name}`);
        field(item, v[item.name]);
      }
      return;
    }
    for (const [name, item] of Object.entries(v)) {
      const definitionField = definition.fields.find((candidate) => candidate.name === name);
      if (!definitionField) throw new Error(`unknown field ${definition.name}.${name}`);
      varUint(definitionField.value);
      field(definitionField, item);
    }
    byte(0);
  }
  record(defs.get(rootType), value);
  return Uint8Array.from(out);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Minimal ZIP writer: { name, data, deflate } entries.
async function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const body = entry.deflate ? await deflateRaw(entry.data) : entry.data;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, entry.deflate ? 8 : 0, true);
    local.setUint32(14, crc32(entry.data), true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint16(10, entry.deflate ? 8 : 0, true);
    record.setUint32(16, crc32(entry.data), true);
    record.setUint32(20, body.length, true);
    record.setUint32(24, entry.data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    central.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1. Real .fig: basic shapes (header, ZIP, geometry, paints, effects)
 * ------------------------------------------------------------------ */

const basicBytes = await readFile(fixture("basic-shapes.fig"));
const basicRaw = await readFigFile(basicBytes);
assert.equal(basicRaw.prelude, "fig-kiwi");
assert.equal(basicRaw.version, 101);
assert.ok(basicRaw.schema.definitions.some((definition) => definition.name === "NodeChange" && definition.kind === "MESSAGE"));
assert.equal(basicRaw.message.type, "NODE_CHANGES");
assert.equal(basicRaw.meta.file_name, "Untitled");
assert.ok(basicRaw.thumbnail && basicRaw.thumbnail[0] === 0x89, "thumbnail.png extracted");

const basic = await importFigFile(basicBytes, { fileName: "C:\\designs\\basic-shapes.fig" });
assert.equal(basic.source.kind, "fig-file");
assert.equal(basic.source.fileName, "basic-shapes");
assert.equal(basic.file.name, "Untitled");
assert.equal(basic.file.document.type, "DOCUMENT");
// The internal component canvas is not a REST page.
assert.deepEqual(basic.file.document.children.map((page) => page.name), ["Page 1"]);
const basicFrame = basic.file.document.children[0].children[0];
assert.equal(basicFrame.name, "basic_shapes");
assert.equal(basicFrame.type, "FRAME");
// Figma's own export metadata records the frame bounds: they must match the
// accumulated transforms.
const render = basicRaw.meta.client_meta.render_coordinates;
close(basicFrame.absoluteBoundingBox.x, render.x, 0.01, "frame x");
close(basicFrame.absoluteBoundingBox.y, render.y, 0.01, "frame y");
close(basicFrame.absoluteBoundingBox.width, render.width, 0.01, "frame width");
close(basicFrame.absoluteBoundingBox.height, render.height, 0.01, "frame height");
const group = basicFrame.children[0];
assert.equal(group.type, "GROUP", "resize-to-fit frame without auto-layout = group");
assert.deepEqual(group.children.map((node) => node.name), ["Rectangle 1", "Line 1", "Arrow 1", "Ellipse 1", "Polygon 1", "Star 1"]);
assert.deepEqual(group.children.map((node) => node.type), ["RECTANGLE", "LINE", "VECTOR", "ELLIPSE", "REGULAR_POLYGON", "STAR"]);
const rectangle = group.children[0];
assert.equal(rectangle.fills[0].type, "SOLID");
close(rectangle.fills[0].color.r, 0.8549);
close(rectangle.fills[0].color.g, 0.7961);
assert.equal(rectangle.strokes[0].type, "SOLID");
close(rectangle.strokes[0].color.r, 0.9282);
assert.equal(rectangle.strokeWeight, 3);
assert.equal(rectangle.strokeAlign, "OUTSIDE");
assert.equal(rectangle.effects[0].type, "DROP_SHADOW");
assert.deepEqual(rectangle.effects[0].offset, { x: 0, y: 4 });
assert.equal(rectangle.effects[0].radius, 4);
close(rectangle.effects[0].color.a, 0.25);
// Rotated group: children bounds are inside the frame.
for (const child of group.children) {
  assert.ok(child.absoluteBoundingBox.x >= basicFrame.absoluteBoundingBox.x - 1, `${child.name} inside frame`);
  assert.ok(child.absoluteBoundingBox.x + child.absoluteBoundingBox.width <= basicFrame.absoluteBoundingBox.x + basicFrame.absoluteBoundingBox.width + 1, `${child.name} inside frame`);
}

/* ------------------------------------------------------------------ *
 * 2. Real .fig: multi-page file with text, instances, gradient, grids
 * ------------------------------------------------------------------ */

const medium = await importFigFile(await readFile(fixture("medium-complex.fig")), { fileName: "medium-complex.fig" });
assert.equal(medium.source.version, 106, "newer format version decoded with its own embedded schema");
// Pages follow parentIndex.position (" ~" < "!" < "~!"), not file order.
assert.deepEqual(medium.file.document.children.map((page) => page.name), ["Great Seal Page", "Page 2", "Page 3"]);
assert.deepEqual(medium.file.document.children[1].children.map((node) => node.name), ["how-to", "Lady"]);
assert.deepEqual(medium.file.document.children[2].children.map((node) => node.name), ["User Bio", "bike lady", "RANDOM"]);
const greatSeal = medium.file.document.children[0].children[0];
assert.deepEqual(greatSeal.absoluteBoundingBox, { x: 0, y: 0, width: 731, height: 609 });
assert.equal(greatSeal.fills[0].type, "GRADIENT_LINEAR");
assert.equal(greatSeal.fills[0].gradientStops.length, 3);
assert.equal(greatSeal.fills[0].gradientHandlePositions.length, 3);
const diana = findAll(medium.file.document, (node) => node.type === "TEXT" && node.characters === "Diana W.")[0];
assert.ok(diana, "text content decoded");
assert.equal(diana.style.fontFamily, "Avenir Next");
assert.equal(diana.style.fontSize, 38);
assert.equal(diana.style.fontWeight, 700);
assert.equal(diana.style.lineHeightUnit, "INTRINSIC_%", "line height 100% PERCENT = Auto");
const coreNeeds = findAll(medium.file.document, (node) => node.type === "TEXT" && /^Core Needs/.test(node.characters))[0];
assert.equal(coreNeeds.style.lineHeightUnit, "PIXELS");
assert.equal(coreNeeds.style.lineHeightPx, 24);
const randomText = findByName(medium.file.document, "RANDOM");
assert.equal(randomText.style.fontFamily, "Inter");
assert.equal(randomText.style.fontSize, 200);
const userBio = findByName(medium.file.document, "User Bio");
assert.deepEqual(userBio.layoutGrids.map((grid) => grid.pattern), ["ROWS", "COLUMNS"]);
assert.equal(userBio.layoutGrids[1].count, 12);
assert.equal(userBio.layoutGrids[1].gutterSize, 20);
// Instances are rebuilt from their component masters with REST-style ids.
const person = medium.file.document.children[1].children[0].children.find((node) => node.type === "INSTANCE");
assert.ok(person, "instance on the how-to screen");
assert.equal(person.name, "Person");
assert.ok(medium.file.components[person.componentId], "instance component listed in components");
assert.equal(medium.file.components[person.componentId].name, "a person/bust");
assert.ok(person.children.length > 0, "instance children expanded");
assert.ok(person.children.every((child) => child.id.startsWith(`I${person.id};`)));
assert.equal(medium.source.truncated, false);

const mediumStructure = buildFigmaStructure(medium.file);
const mediumScreens = mediumStructure.pages.flatMap((page) => page.screens.map((screen) => screen.name));
for (const name of ["GreatSeal", "how-to", "Lady", "User Bio", "bike lady"]) assert.ok(mediumScreens.includes(name), `screen ${name} listed`);
const mediumNormalized = normalizeExtractedStyles(figmaToPayload(medium.file, { imageFills: medium.imageFills }));
const mediumDesign = generateDesignMarkdown({ normalized: mediumNormalized });
assert.match(mediumDesign, /Avenir Next/);
assert.match(mediumDesign, /#ffffff/i);
assert.match(mediumDesign, /#000000/i);
const mediumMd = generateFigmaStructureMarkdown(mediumStructure, { fileName: medium.file.name });
assert.match(mediumMd, /Create a Character!/);

/* ------------------------------------------------------------------ *
 * 3. Clipboard route (real canvas.fig in the clipboard envelope)
 * ------------------------------------------------------------------ */

const clipboardHtml = await readFile(fixture("clipboard-clip-test.html"), "utf8");
const parsed = parseFigmaClipboardHtml(clipboardHtml);
assert.equal(parsed.meta.fileKey, "GJSmZTdqCU3BBIhaH3X4EH");
assert.equal(parsed.meta.pasteID, 2135852607);
assert.equal(String.fromCharCode(...parsed.bytes.subarray(0, 8)), "fig-kiwi");
const clipDecoded = await decodeFigBinary(parsed.bytes);
assert.equal(clipDecoded.version, 101);
assert.equal(clipDecoded.message.pasteFileKey, "GJSmZTdqCU3BBIhaH3X4EH");
const clip = await importFigmaClipboard(clipboardHtml);
assert.equal(clip.source.kind, "clipboard");
assert.equal(clip.source.fileKey, "GJSmZTdqCU3BBIhaH3X4EH");
assert.deepEqual(clip.file.document.children[0].children.map((node) => node.name), ["clip_on", "clip_off"]);
const clipOn = clip.file.document.children[0].children[0];
assert.equal(clipOn.clipsContent, true);
assert.equal(clip.file.document.children[0].children[1].clipsContent, false);
assert.equal(clipOn.children[0].type, "ELLIPSE");
assert.deepEqual(clipOn.absoluteBoundingBox, { x: 0, y: 0, width: 100, height: 100 });
// The overflowing ellipse of clip_off ends at the export's render bounds (223 x 104).
assert.deepEqual(clip.file.document.children[0].children[1].children[0].absoluteBoundingBox, { x: 173, y: 54, width: 50, height: 50 });
// 100px frames are below the screen threshold: structure has the page, no screen.
assert.equal(buildFigmaStructure(clip.file).stats.pages, 1);
assert.deepEqual(clip.imageFills, {});

assert.throws(() => parseFigmaClipboardHtml("<p>Bonjour</p>"), /Aucune donnée Figma dans le presse-papiers/);
assert.throws(() => parseFigmaClipboardHtml("<!--(figma)AAAA(/figma)-->"), /en-tête « fig-kiwi » absent/);
await assert.rejects(() => importFigFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])), /en-tête « fig-kiwi » absent/);

// Same payload with a deflate-raw data chunk padded to 4 bytes (the other
// compression Figma writes): identical tree.
const split = splitFigChunks(parsed.bytes);
assert.deepEqual([split.chunks[1][0], split.chunks[1][1], split.chunks[1][2], split.chunks[1][3]], [0x28, 0xb5, 0x2f, 0xfd], "real data chunk is zstd");
const deflated = await deflateRaw(zstdDecompress(split.chunks[1]));
const padded = new Uint8Array(deflated.length + (4 - (deflated.length % 4)));
padded.set(deflated);
const deflateBinary = buildFig(split.prelude, split.version, [split.chunks[0], padded]);
const deflateHtml = clipboardHtml.replace(/\(figma\)[\s\S]*?\(\/figma\)/, `(figma)${Buffer.from(deflateBinary).toString("base64")}(/figma)`);
const clipDeflate = await importFigmaClipboard(deflateHtml);
assert.deepEqual(clipDeflate.file.document, clip.file.document);

// Raw fig-kiwi (canvas.fig extracted from an archive).
const rawRoute = await importFigFile(parsed.bytes, { fileName: "canvas.fig" });
assert.equal(rawRoute.source.kind, "fig-binary");
assert.deepEqual(rawRoute.file.document, clip.file.document);

/* ------------------------------------------------------------------ *
 * 4. Synthetic sample encoded with the real schema: auto-layout, text
 *    styles and overrides, styles, component set, instance overrides,
 *    bound properties, derived geometry, image fill inside the ZIP.
 * ------------------------------------------------------------------ */

const schema = clipDecoded.schema;
const schemaBytes = new Uint8Array(await new Response(new Blob([split.chunks[0]]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
assert.equal(decodeKiwiSchema(schemaBytes).definitions.length, schema.definitions.length);
assert.equal(schema.definitions.length, 550);

const G = (sessionID, localID) => ({ sessionID, localID });
const P = (guid, position) => ({ guid, position });
const M = (x, y) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });
const V = (x, y) => ({ x, y });
const C = (hex, a = 1) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255, a });
const solid = (hex) => ({ type: "SOLID", color: C(hex), opacity: 1, visible: true, blendMode: "NORMAL" });

const imageBytes = basicRaw.thumbnail;
const imageHash = new Uint8Array(await crypto.subtle.digest("SHA-1", imageBytes));
const imageHex = Buffer.from(imageHash).toString("hex");

const nodeChanges = [
  { guid: G(0, 0), type: "DOCUMENT", name: "Document", visible: true },
  { guid: G(0, 1), parentIndex: P(G(0, 0), "!"), type: "CANVAS", name: "Landing page", visible: true, backgroundColor: C("#f5f5f5") },
  { guid: G(0, 2), parentIndex: P(G(0, 0), "~"), type: "CANVAS", name: "Internal Only Canvas", visible: false, internalOnly: true },
  // Style masters live on the internal canvas.
  {
    guid: G(5, 1), parentIndex: P(G(0, 2), "!"), type: "TEXT", name: "Heading/H1", visible: false, styleType: "TEXT", key: "h1-style-key",
    fontName: { family: "Poppins", style: "Bold", postscript: "Poppins-Bold" }, fontSize: 48, textData: { characters: "Ag" }
  },
  { guid: G(5, 2), parentIndex: P(G(0, 2), "\""), type: "ROUNDED_RECTANGLE", name: "Brand/Primary", visible: false, styleType: "FILL", key: "brand-style-key", fillPaints: [solid("#6d28d9")] },
  // Main screen: vertical auto-layout.
  {
    guid: G(1, 1), parentIndex: P(G(0, 1), "!"), type: "FRAME", name: "Landing", visible: true, opacity: 1,
    size: V(1440, 900), transform: M(100, 50), fillPaints: [solid("#ffffff")], frameMaskDisabled: false,
    stackMode: "VERTICAL", stackSpacing: 32, stackVerticalPadding: 64, stackPaddingBottom: 80, stackHorizontalPadding: 120, stackPaddingRight: 120,
    stackPrimaryAlignItems: "CENTER", stackCounterAlignItems: "CENTER", stackPrimarySizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE", stackCounterSizing: "FIXED"
  },
  {
    guid: G(1, 2), parentIndex: P(G(1, 1), "!"), type: "TEXT", name: "Title", visible: true, size: V(600, 58), transform: M(420, 64),
    fontName: { family: "Poppins", style: "Bold", postscript: "Poppins-Bold" }, fontSize: 48, lineHeight: { value: 1.2, units: "RAW" },
    letterSpacing: { value: -2, units: "PERCENT" }, textAlignHorizontal: "CENTER", textCase: "UPPER", textAutoResize: "WIDTH_AND_HEIGHT",
    textData: { characters: "Build faster" }, fillPaints: [solid("#111827")], styleIdForText: { assetRef: { key: "h1-style-key", version: "1:1" } }
  },
  {
    guid: G(1, 3), parentIndex: P(G(1, 1), "\""), type: "TEXT", name: "Body", visible: true, size: V(600, 48), transform: M(420, 154),
    fontName: { family: "Inter", style: "Regular", postscript: "Inter-Regular" }, fontSize: 16, lineHeight: { value: 24, units: "PIXELS" },
    textData: {
      characters: "Ship pixel-perfect interfaces with every value measured, never guessed. Bold words.",
      characterStyleIDs: [...Array(72).fill(0), ...Array(10).fill(1)],
      styleOverrideTable: [{ styleID: 1, fontName: { family: "Inter", style: "Semi Bold", postscript: "Inter-SemiBold" }, fillPaints: [solid("#6d28d9")] }]
    },
    fillPaints: [solid("#4b5563")]
  },
  {
    guid: G(1, 4), parentIndex: P(G(1, 1), "#"), type: "INSTANCE", name: "CTA", visible: true, size: V(150, 44), transform: M(645, 234),
    fillPaints: [solid("#6d28d9")], cornerRadius: 8, stackMode: "HORIZONTAL", stackSpacing: 8, stackHorizontalPadding: 24, stackPaddingRight: 24,
    stackVerticalPadding: 12, stackPaddingBottom: 12, stackPrimarySizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE", stackCounterSizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE",
    styleIdForFill: { guid: G(5, 2) },
    symbolData: { symbolID: G(3, 1), symbolOverrides: [{ guidPath: { guids: [G(7, 2)] }, textData: { characters: "Get started" } }] },
    componentPropAssignments: [{ defID: G(9, 2), value: { boolValue: false } }],
    derivedSymbolData: [{ guidPath: { guids: [G(7, 2)] }, size: V(102, 20), transform: M(24, 12) }]
  },
  {
    guid: G(1, 5), parentIndex: P(G(1, 1), "$"), type: "ROUNDED_RECTANGLE", name: "Hero image", visible: true, size: V(1200, 400), transform: M(120, 310),
    cornerRadius: 16, stackChildAlignSelf: "STRETCH",
    fillPaints: [{ type: "IMAGE", opacity: 1, visible: true, blendMode: "NORMAL", image: { hash: imageHash, name: "hero" }, imageScaleMode: "FILL" }],
    effects: [{ type: "DROP_SHADOW", offset: V(0, 8), radius: 24, spread: -4, visible: true, blendMode: "NORMAL", color: C("#000000", 0.12) }]
  },
  // Local component set with two variants and a boolean property.
  {
    guid: G(2, 1), parentIndex: P(G(0, 1), "\""), type: "FRAME", name: "Button", visible: true, size: V(400, 100), transform: M(100, 1100),
    isStateGroup: true, frameMaskDisabled: true,
    stateGroupPropertyValueOrders: [{ property: "State", values: ["Default", "Hover"] }],
    componentPropDefs: [
      { id: G(9, 1), name: "State", type: "VARIANT", initialValue: {} },
      { id: G(9, 2), name: "Show icon", type: "BOOL", initialValue: { boolValue: true } }
    ]
  },
  {
    guid: G(3, 1), parentIndex: P(G(2, 1), "!"), type: "SYMBOL", name: "State=Default", visible: true, size: V(150, 44), transform: M(20, 20),
    componentKey: "button-default-key", variantPropSpecs: [{ propDefId: G(9, 1), value: "Default" }],
    fillPaints: [solid("#6d28d9")], cornerRadius: 8, styleIdForFill: { guid: G(5, 2) },
    stackMode: "HORIZONTAL", stackSpacing: 8, stackHorizontalPadding: 24, stackPaddingRight: 24, stackVerticalPadding: 12, stackPaddingBottom: 12,
    stackPrimarySizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE", stackCounterSizing: "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE"
  },
  {
    guid: G(3, 2), parentIndex: P(G(3, 1), "!"), overrideKey: G(7, 2), type: "TEXT", name: "Label", visible: true, size: V(54, 20), transform: M(24, 12),
    fontName: { family: "Inter", style: "Semi Bold", postscript: "Inter-SemiBold" }, fontSize: 14, lineHeight: { value: 20, units: "PIXELS" },
    textData: { characters: "Button" }, fillPaints: [solid("#ffffff")], textAutoResize: "WIDTH_AND_HEIGHT"
  },
  {
    guid: G(3, 3), parentIndex: P(G(3, 1), "\""), overrideKey: G(7, 3), type: "ROUNDED_RECTANGLE", name: "Icon", visible: true, size: V(16, 16), transform: M(86, 14),
    fillPaints: [solid("#ffffff")], componentPropRefs: [{ defID: G(9, 2), componentPropNodeField: "VISIBLE" }]
  },
  {
    guid: G(3, 4), parentIndex: P(G(2, 1), "\""), type: "SYMBOL", name: "State=Hover", visible: true, size: V(150, 44), transform: M(220, 20),
    componentKey: "button-hover-key", variantPropSpecs: [{ propDefId: G(9, 1), value: "Hover" }], fillPaints: [solid("#5b21b6")], cornerRadius: 8,
    stackMode: "HORIZONTAL", stackSpacing: 8, stackHorizontalPadding: 24, stackPaddingRight: 24, stackVerticalPadding: 12, stackPaddingBottom: 12
  },
  {
    guid: G(3, 5), parentIndex: P(G(3, 4), "!"), overrideKey: G(7, 2), type: "TEXT", name: "Label", visible: true, size: V(54, 20), transform: M(24, 12),
    fontName: { family: "Inter", style: "Semi Bold", postscript: "Inter-SemiBold" }, fontSize: 14, textData: { characters: "Button" }, fillPaints: [solid("#ffffff")]
  },
  // Deleted layers stay in the file with phase REMOVED.
  { guid: G(1, 9), parentIndex: P(G(1, 1), "%"), type: "FRAME", name: "Removed", phase: "REMOVED", visible: true, size: V(10, 10), transform: M(0, 0) }
];
const syntheticMessage = encodeKiwi(schema, "Message", { type: "NODE_CHANGES", sessionID: 0, ackID: 0, nodeChanges });
const syntheticCanvas = buildFig("fig-kiwi", split.version, [split.chunks[0], await deflateRaw(syntheticMessage)]);
const syntheticZip = await buildZip([
  { name: "canvas.fig", data: syntheticCanvas },
  { name: "meta.json", data: new TextEncoder().encode(JSON.stringify({ file_name: "Synthetic landing", exported_at: "2026-10-12T00:00:00.000Z" })), deflate: true },
  { name: "thumbnail.png", data: imageBytes },
  { name: `images/${imageHex}`, data: imageBytes }
]);

const synthetic = await importFigFile(syntheticZip, { fileName: "synthetic.fig" });
const sfile = synthetic.file;
assert.equal(sfile.name, "Synthetic landing");
assert.equal(sfile.lastModified, "2026-10-12T00:00:00.000Z");
assert.deepEqual(sfile.document.children.map((page) => page.name), ["Landing page"]);
assert.deepEqual(sfile.document.children[0].children.map((node) => [node.name, node.type]), [["Landing", "FRAME"], ["Button", "COMPONENT_SET"]]);
const landing = sfile.document.children[0].children[0];
assert.deepEqual(landing.absoluteBoundingBox, { x: 100, y: 50, width: 1440, height: 900 });
assert.equal(landing.layoutMode, "VERTICAL");
assert.equal(landing.itemSpacing, 32);
assert.deepEqual([landing.paddingTop, landing.paddingRight, landing.paddingBottom, landing.paddingLeft], [64, 120, 80, 120]);
assert.equal(landing.primaryAxisAlignItems, "CENTER");
assert.equal(landing.counterAxisAlignItems, "CENTER");
assert.equal(landing.primaryAxisSizingMode, "AUTO");
assert.equal(landing.counterAxisSizingMode, "FIXED");
assert.equal(landing.clipsContent, true);
assert.deepEqual(landing.children.map((node) => node.name), ["Title", "Body", "CTA", "Hero image"], "removed layer dropped, order kept");

const title = landing.children[0];
assert.deepEqual(title.absoluteBoundingBox, { x: 520, y: 114, width: 600, height: 58 });
assert.equal(title.characters, "Build faster");
assert.equal(title.style.fontFamily, "Poppins");
assert.equal(title.style.fontWeight, 700);
assert.equal(title.style.fontSize, 48);
assert.equal(title.style.lineHeightUnit, "FONT_SIZE_%");
close(title.style.lineHeightPx, 57.6, 0.001, "RAW line height");
close(title.style.letterSpacing, -0.96, 0.001, "PERCENT letter spacing");
assert.equal(title.style.textCase, "UPPER");
assert.equal(title.style.textAlignHorizontal, "CENTER");
assert.equal(title.layoutSizingHorizontal, "HUG");
const h1StyleId = title.styles.text;
assert.equal(sfile.styles[h1StyleId].name, "Heading/H1");
assert.equal(sfile.styles[h1StyleId].styleType, "TEXT");

const body = landing.children[1];
assert.equal(body.style.lineHeightPx, 24);
assert.equal(body.characterStyleOverrides.length, 82);
assert.equal(body.styleOverrideTable[1].fontWeight, 600);
assert.equal(body.styleOverrideTable[1].fontFamily, "Inter");
assert.equal(body.styleOverrideTable[1].fills[0].type, "SOLID");

const cta = landing.children[2];
assert.equal(cta.type, "INSTANCE");
assert.equal(cta.componentId, "3:1");
assert.equal(cta.layoutMode, "HORIZONTAL");
assert.equal(cta.cornerRadius, 8);
assert.equal(sfile.styles[cta.styles.fill].name, "Brand/Primary");
assert.deepEqual(cta.componentProperties.State, { type: "VARIANT", value: "Default" });
assert.deepEqual(cta.componentProperties["Show icon#9:2"], { type: "BOOLEAN", value: false });
assert.deepEqual(cta.children.map((node) => node.id), ["I1:4;3:2", "I1:4;3:3"]);
assert.equal(cta.children[0].characters, "Get started", "text override applied by guidPath");
assert.deepEqual(cta.children[0].absoluteBoundingBox, { x: 769, y: 296, width: 102, height: 20 }, "derived geometry applied");
assert.equal(cta.children[1].visible, false, "boolean property bound to visibility");
assert.equal(sfile.components["3:1"].componentSetId, "2:1");
assert.equal(sfile.components["3:1"].key, "button-default-key");
assert.equal(sfile.componentSets["2:1"].name, "Button");

const hero = landing.children[3];
assert.equal(hero.type, "RECTANGLE");
assert.equal(hero.layoutAlign, "STRETCH");
assert.equal(hero.layoutSizingHorizontal, "FILL", "stretch in a vertical stack = fill width");
assert.equal(hero.fills[0].imageRef, imageHex);
assert.equal(hero.fills[0].scaleMode, "FILL");
assert.ok(synthetic.imageFills[imageHex].startsWith("data:image/png;base64,"));
assert.equal(synthetic.source.imagesInArchive, 1);

const buttonSet = sfile.document.children[0].children[1];
assert.deepEqual(buttonSet.componentPropertyDefinitions.State.variantOptions, ["Default", "Hover"]);
assert.equal(buttonSet.componentPropertyDefinitions["Show icon#9:2"].type, "BOOLEAN");
assert.deepEqual(buttonSet.children.map((node) => [node.name, node.type]), [["State=Default", "COMPONENT"], ["State=Hover", "COMPONENT"]]);

// Existing pipeline, unchanged.
const syntheticStructure = buildFigmaStructure(sfile);
assert.deepEqual(syntheticStructure.pages[0].screens.map((screen) => screen.name), ["Landing"]);
assert.equal(syntheticStructure.componentSets[0].name, "Button");
assert.deepEqual(syntheticStructure.componentSets[0].variants.map((variant) => variant.name), ["State=Default", "State=Hover"]);
assert.ok(syntheticStructure.styles.some((style) => style.name === "Brand/Primary" && style.value === "#6d28d9"));
const syntheticPayload = figmaToPayload(sfile, { imageFills: synthetic.imageFills });
assert.ok(syntheticPayload.imageInventory.some((image) => image.src.startsWith("data:image/png;base64,")));
assert.ok(syntheticPayload.buttonVariants.some((variant) => variant.spec.background === "#6d28d9"));
const syntheticNormalized = normalizeExtractedStyles(syntheticPayload);
const syntheticDesign = generateDesignMarkdown({ normalized: syntheticNormalized });
assert.match(syntheticDesign, /Poppins/);
assert.match(syntheticDesign, /Inter/);
assert.match(syntheticDesign, /#6d28d9/i);
assert.match(syntheticDesign, /#111827/i);
const syntheticMd = generateFigmaStructureMarkdown(syntheticStructure, { fileName: sfile.name });
assert.match(syntheticMd, /Build faster/);
assert.match(syntheticMd, /Get started/);

/* ------------------------------------------------------------------ *
 * 5. Live tab probe (classic MAIN-world script) against a mocked
 *    plugin-API global: the real global only exists in the editor page.
 * ------------------------------------------------------------------ */

const probeSource = await readFile(new URL("../figma-live-probe.js", import.meta.url), "utf8");
const runProbe = (globals) => vm.runInNewContext(probeSource, { btoa, Uint8Array, Symbol, Promise, Math, Array, Object, String, ...globals });
assert.deepEqual(Object.keys(await runProbe({})), ["available", "reason"]);
assert.equal((await runProbe({})).available, false);
assert.match((await runProbe({})).reason, /API Figma n'est pas exposée/);

const mixedSymbol = Symbol("mixed");
const liveSolid = (r, g, b) => ({ type: "SOLID", color: { r, g, b }, opacity: 1, visible: true, blendMode: "NORMAL" });
const liveText = {
  id: "1:3", name: "Title", type: "TEXT", visible: true, absoluteBoundingBox: { x: 120, y: 64, width: 400, height: 48 },
  characters: "Hello live", fills: mixedSymbol, textAlignHorizontal: "LEFT", textAlignVertical: "TOP", textAutoResize: "WIDTH_AND_HEIGHT",
  textStyleId: "S:h1", fillStyleId: mixedSymbol,
  getStyledTextSegments: () => [
    { start: 0, end: 6, fontName: { family: "Sora", style: "Bold" }, fontSize: 40, fontWeight: 700, fills: [liveSolid(0.07, 0.09, 0.15)], lineHeight: { unit: "PERCENT", value: 120 }, letterSpacing: { unit: "PERCENT", value: -2 }, textCase: "ORIGINAL", textDecoration: "NONE" },
    { start: 6, end: 10, fontName: { family: "Sora", style: "Regular" }, fontSize: 40, fontWeight: 400, fills: [liveSolid(0.43, 0.16, 0.85)], lineHeight: { unit: "PERCENT", value: 120 }, letterSpacing: { unit: "PERCENT", value: -2 }, textCase: "ORIGINAL", textDecoration: "NONE" }
  ]
};
const liveFrame = {
  id: "1:2", name: "Home", type: "FRAME", visible: true, width: 1440, height: 900, absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
  fills: [liveSolid(1, 1, 1)], strokes: [], effects: [], layoutGrids: [], cornerRadius: 0, clipsContent: true,
  layoutMode: "VERTICAL", itemSpacing: 24, paddingTop: 64, paddingRight: 120, paddingBottom: 64, paddingLeft: 120,
  primaryAxisAlignItems: "MIN", counterAxisAlignItems: "CENTER", primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED",
  children: [liveText],
  exportAsync: async (settings) => {
    assert.equal(JSON.stringify(settings), JSON.stringify({ format: "PNG", constraint: { type: "WIDTH", value: 1440 } }));
    return imageBytes;
  }
};
const livePage = { id: "0:1", name: "Page 1", type: "PAGE", children: [liveFrame], backgrounds: [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.96 }, opacity: 1 }], flowStartingPoints: [] };
const live = await runProbe({
  figma: {
    mixed: mixedSymbol,
    root: { id: "0:0", name: "Live file", children: [livePage] },
    currentPage: livePage,
    fileKey: "LIVEKEY",
    loadAllPagesAsync: async () => {},
    getStyleByIdAsync: async (id) => (id === "S:h1" ? { id, key: "h1", name: "Display/H1", type: "TEXT", description: "" } : null),
    getImageByHash: () => null
  }
});
assert.equal(live.available, true);
assert.equal(live.source.fileKey, "LIVEKEY");
assert.equal(live.renders.length, 1);
assert.ok(live.renders[0].dataUrl.startsWith("data:image/png;base64,"));
const liveHome = live.file.document.children[0].children[0];
assert.equal(liveHome.layoutMode, "VERTICAL");
assert.equal(liveHome.paddingLeft, 120);
const liveTitle = liveHome.children[0];
assert.equal(liveTitle.style.fontFamily, "Sora");
assert.equal(liveTitle.style.fontWeight, 700);
close(liveTitle.style.lineHeightPx, 48, 0.001, "live PERCENT line height");
close(liveTitle.style.letterSpacing, -0.8, 0.001, "live letter spacing");
assert.deepEqual(liveTitle.characterStyleOverrides, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
assert.equal(liveTitle.styleOverrideTable[1].fontWeight, 400);
assert.equal(live.file.styles["S:h1"].name, "Display/H1");
assert.equal(liveTitle.styles.text, "S:h1");
const liveStructure = buildFigmaStructure(live.file);
assert.deepEqual(liveStructure.pages[0].screens.map((screen) => screen.name), ["Home"]);
const liveDesign = generateDesignMarkdown({ normalized: normalizeExtractedStyles(figmaToPayload(live.file, { imageFills: live.imageFills })) });
assert.match(liveDesign, /Sora/);

// kiwiToRestFile is usable on an already decoded message.
const direct = kiwiToRestFile(clipDecoded.message, { name: "Direct" });
assert.equal(direct.name, "Direct");
assert.deepEqual(direct.document, clip.file.document);
assert.throws(() => kiwiToRestFile({ nodeChanges: [] }), /Aucun calque/);

console.log("Figma offline tests passed.");
