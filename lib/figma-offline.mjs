/**
 * Offline Figma import: decodes Figma's own binary format (no REST API, no
 * token) and rebuilds the REST-shaped `file` object that figma-import.mjs
 * consumes, so figmaToPayload / buildFigmaStructure run unchanged.
 *
 * Inputs: the clipboard `text/html` written by the Figma app on copy, a
 * `.fig` file ("Save local copy", a ZIP around `canvas.fig`), or a raw
 * `fig-kiwi` binary.
 *
 * Binary layout (canvas.fig and clipboard buffer alike):
 *   8-byte prelude ("fig-kiwi", "fig-jam.", "fig-deck"...) + uint32 LE version,
 *   then length-prefixed chunks (uint32 LE length + bytes):
 *   chunk 0 = kiwi binary schema, chunk 1 = kiwi-encoded `Message`.
 *   Each chunk is deflate-raw or zstd (detected by the zstd magic bytes).
 *
 * Pure ES module, no DOM: MV3 service worker, offscreen document, Node 24.
 * No eval / new Function (MV3 CSP): the kiwi decoder interprets the schema.
 */

import { decompress as zstdDecompress } from "./vendor/zstd-decode.mjs";

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const MAX_IMAGE_DATA_URL_BYTES = 8 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * Byte helpers
 * ------------------------------------------------------------------ */

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error("Données binaires attendues (Uint8Array ou ArrayBuffer).");
}

function base64ToBytes(text) {
  const clean = String(text || "").replace(/[^A-Za-z0-9+/=_-]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function bytesToHex(bytes) {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));

function hasZstdMagic(bytes) {
  return ZSTD_MAGIC.every((value, index) => bytes[index] === value);
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Some writers pad chunks to 4 bytes with zeros after the deflate stream;
// the native decoder rejects trailing data, so the padding is trimmed on retry.
async function inflateChunk(bytes) {
  try {
    return await inflateRaw(bytes);
  } catch (error) {
    let end = bytes.length;
    while (end > 0 && bytes.length - end < 3 && bytes[end - 1] === 0) {
      end -= 1;
      try {
        return await inflateRaw(bytes.subarray(0, end));
      } catch (retryError) {
        // keep trimming
      }
    }
    throw error;
  }
}

async function decompressChunk(bytes, label) {
  try {
    return hasZstdMagic(bytes) ? zstdDecompress(bytes) : await inflateChunk(bytes);
  } catch (error) {
    throw new Error(`Décompression impossible (${label}) : ${error && error.message ? error.message : error}`);
  }
}

/* ------------------------------------------------------------------ *
 * Minimal ZIP reader (central directory + deflate via DecompressionStream)
 * ------------------------------------------------------------------ */

function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// Entries come from the central directory: .fig writers set the data
// descriptor flag, so local headers carry zero sizes.
function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Archive .fig illisible : fin de répertoire ZIP introuvable (fichier tronqué ?).");
  let count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  // ZIP64: the classic record holds 0xFFFF / 0xFFFFFFFF placeholders.
  if ((count === 0xffff || offset === 0xffffffff) && eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50) {
    const record = Number(view.getBigUint64(eocd - 12, true));
    count = Number(view.getBigUint64(record + 32, true));
    offset = Number(view.getBigUint64(record + 48, true));
  }
  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Archive .fig illisible : répertoire central ZIP corrompu.");
    }
    const method = view.getUint16(offset + 10, true);
    let compressedSize = view.getUint32(offset + 20, true);
    let size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    // ZIP64 extended info: only the saturated fields are present, in order.
    let extra = offset + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let cursor = extra + 4;
        if (size === 0xffffffff) { size = Number(view.getBigUint64(cursor, true)); cursor += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(view.getBigUint64(cursor, true)); cursor += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(view.getBigUint64(cursor, true)); }
      }
      extra += 4 + length;
    }
    entries.push({ name, method, compressedSize, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function extractZipEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
    throw new Error(`Archive .fig illisible : en-tête local de « ${entry.name} » invalide.`);
  }
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new Error(`Archive .fig : méthode de compression ZIP ${entry.method} non prise en charge pour « ${entry.name} ».`);
}

/* ------------------------------------------------------------------ *
 * Kiwi decoding (binary schema + schema-driven message decoder)
 * ------------------------------------------------------------------ */

const KIWI_PRIMITIVES = ["bool", "byte", "int", "uint", "float", "string", "int64", "uint64"];
const KIWI_KINDS = ["ENUM", "STRUCT", "MESSAGE"];

const int32Scratch = new Int32Array(1);
const float32Scratch = new Float32Array(int32Scratch.buffer);

class ByteReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.index = 0;
  }

  byte() {
    if (this.index >= this.bytes.length) throw new Error("lecture hors limites");
    return this.bytes[this.index++];
  }

  byteArray() {
    const length = this.varUint();
    const end = this.index + length;
    if (end > this.bytes.length) throw new Error("tableau d'octets hors limites");
    const out = this.bytes.slice(this.index, end);
    this.index = end;
    return out;
  }

  varUint() {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = this.byte();
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128 && shift < 35);
    return value >>> 0;
  }

  varInt() {
    const value = this.varUint() | 0;
    return value & 1 ? ~(value >>> 1) : value >>> 1;
  }

  // Kiwi floats: zero is one byte, otherwise 4 bytes with the exponent
  // rotated into the first byte.
  varFloat() {
    const first = this.byte();
    if (first === 0) return 0;
    if (this.index + 3 > this.bytes.length) throw new Error("lecture hors limites");
    const data = this.bytes;
    let bits = first | (data[this.index] << 8) | (data[this.index + 1] << 16) | (data[this.index + 2] << 24);
    this.index += 3;
    bits = (bits << 23) | (bits >>> 9);
    int32Scratch[0] = bits;
    return float32Scratch[0];
  }

  varUint64() {
    let value = 0n;
    let shift = 0n;
    let byte;
    while ((byte = this.byte()) & 128 && shift < 56n) {
      value |= BigInt(byte & 127) << shift;
      shift += 7n;
    }
    value |= BigInt(byte) << shift;
    return value;
  }

  varInt64() {
    const value = this.varUint64();
    return value & 1n ? ~(value >> 1n) : value >> 1n;
  }

  // Null-terminated UTF-8.
  string() {
    const start = this.index;
    const end = this.bytes.indexOf(0, start);
    if (end < 0) throw new Error("chaîne non terminée");
    this.index = end + 1;
    return utf8.decode(this.bytes.subarray(start, end));
  }
}

const utf8 = new TextDecoder();

// 64-bit values stay numbers when exact, strings otherwise (JSON-safe).
const bigToJson = (value) => (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : String(value));

/**
 * @returns {{ definitions: Array<{ name: string, kind: "ENUM"|"STRUCT"|"MESSAGE", fields: Array<{ name: string, type: string|null, isArray: boolean, value: number }> }> }}
 */
export function decodeKiwiSchema(bytes) {
  const reader = new ByteReader(toBytes(bytes));
  const count = reader.varUint();
  const definitions = [];
  for (let i = 0; i < count; i += 1) {
    const name = reader.string();
    const kind = KIWI_KINDS[reader.byte()];
    if (!kind) throw new Error(`Schéma kiwi invalide : type de définition inconnu pour « ${name} ».`);
    const fieldCount = reader.varUint();
    const fields = [];
    for (let j = 0; j < fieldCount; j += 1) {
      const fieldName = reader.string();
      const type = reader.varInt();
      const isArray = Boolean(reader.byte() & 1);
      const value = reader.varUint();
      fields.push({ name: fieldName, type: kind === "ENUM" ? null : type, isArray, value });
    }
    definitions.push({ name, kind, fields });
  }
  // Negative type = primitive (bitwise not of its index), else a definition index.
  for (const definition of definitions) {
    for (const field of definition.fields) {
      if (field.type === null) continue;
      if (field.type < 0) {
        const primitive = KIWI_PRIMITIVES[~field.type];
        if (!primitive) throw new Error(`Schéma kiwi invalide : type ${field.type}.`);
        field.type = primitive;
      } else {
        if (field.type >= definitions.length) throw new Error(`Schéma kiwi invalide : type ${field.type}.`);
        field.type = definitions[field.type].name;
      }
    }
  }
  return { definitions };
}

function compileKiwi(schema) {
  const byName = new Map();
  for (const definition of schema.definitions) {
    const entry = { definition, enumNames: null, fieldsById: null };
    if (definition.kind === "ENUM") {
      entry.enumNames = new Map(definition.fields.map((field) => [field.value, field.name]));
    } else if (definition.kind === "MESSAGE") {
      entry.fieldsById = new Map(definition.fields.map((field) => [field.value, field]));
    }
    byName.set(definition.name, entry);
  }
  return byName;
}

function readKiwiValue(reader, type, compiled) {
  switch (type) {
    case "bool": return reader.byte() !== 0;
    case "byte": return reader.byte();
    case "int": return reader.varInt();
    case "uint": return reader.varUint();
    case "float": return reader.varFloat();
    case "string": return reader.string();
    case "int64": return bigToJson(reader.varInt64());
    case "uint64": return bigToJson(reader.varUint64());
    default: {
      const entry = compiled.get(type);
      if (!entry) throw new Error(`type kiwi inconnu « ${type} »`);
      if (entry.enumNames) {
        const raw = reader.varUint();
        return entry.enumNames.has(raw) ? entry.enumNames.get(raw) : raw;
      }
      return readKiwiRecord(reader, entry, compiled);
    }
  }
}

function readKiwiField(reader, field, compiled) {
  if (!field.isArray) return readKiwiValue(reader, field.type, compiled);
  if (field.type === "byte") return reader.byteArray();
  const length = reader.varUint();
  const values = new Array(length);
  for (let i = 0; i < length; i += 1) values[i] = readKiwiValue(reader, field.type, compiled);
  return values;
}

// STRUCT: every field in order. MESSAGE: (field id, value) pairs until id 0.
function readKiwiRecord(reader, entry, compiled) {
  const result = {};
  if (!entry.fieldsById) {
    for (const field of entry.definition.fields) result[field.name] = readKiwiField(reader, field, compiled);
    return result;
  }
  for (;;) {
    const id = reader.varUint();
    if (id === 0) return result;
    const field = entry.fieldsById.get(id);
    if (!field) throw new Error(`champ ${id} inconnu dans « ${entry.definition.name} »`);
    result[field.name] = readKiwiField(reader, field, compiled);
  }
}

/**
 * Decodes one kiwi-encoded record of `rootType` with the given schema.
 */
export function decodeKiwiMessage(schema, bytes, rootType = "Message") {
  const compiled = compileKiwi(schema);
  const entry = compiled.get(rootType);
  if (!entry) throw new Error(`Schéma Figma inattendu : définition « ${rootType} » absente.`);
  try {
    return readKiwiRecord(new ByteReader(toBytes(bytes)), entry, compiled);
  } catch (error) {
    throw new Error(`Décodage du contenu Figma impossible : ${error.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * fig-kiwi container
 * ------------------------------------------------------------------ */

function readFigChunks(bytes) {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "fig-") {
    throw new Error("Format Figma non reconnu : en-tête « fig-kiwi » absent (fichier ou presse-papiers d'une autre application ?).");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prelude = ascii(bytes, 0, 8);
  const version = view.getUint32(8, true);
  const chunks = [];
  let offset = 12;
  while (offset + 4 <= bytes.length) {
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > bytes.length) {
      throw new Error(`Binaire Figma tronqué : le bloc ${chunks.length} annonce ${length} octets, ${bytes.length - offset} disponibles.`);
    }
    chunks.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  if (chunks.length < 2) throw new Error("Binaire Figma incomplet : schéma ou données manquants.");
  return { prelude, version, chunks };
}

/**
 * @returns {Promise<{ prelude: string, version: number, schema: object, message: object }>}
 */
export async function decodeFigBinary(input) {
  const bytes = toBytes(input);
  const { prelude, version, chunks } = readFigChunks(bytes);
  const schema = decodeKiwiSchema(await decompressChunk(chunks[0], "schéma"));
  const message = decodeKiwiMessage(schema, await decompressChunk(chunks[1], "données"));
  return { prelude: prelude.replace(/[^\x21-\x7e]/g, ""), version, schema, message };
}

/**
 * Reads a `.fig` file (ZIP with canvas.fig, meta.json, thumbnail.png and
 * images/<sha1>) or a raw fig-kiwi binary.
 * @returns {Promise<{ message: object, images: Record<string, Uint8Array>, meta: object|null, prelude: string, version: number, schema: object, thumbnail: Uint8Array|null }>}
 */
export async function readFigFile(input) {
  const bytes = toBytes(input);
  if (!isZip(bytes)) {
    const decoded = await decodeFigBinary(bytes);
    return { ...decoded, images: {}, meta: null, thumbnail: null };
  }
  const entries = readZipEntries(bytes);
  const canvas = entries.find((entry) => /(^|\/)canvas\.fig$/.test(entry.name));
  if (!canvas) throw new Error("Archive .fig sans « canvas.fig » : ce n'est pas un fichier Figma enregistré localement.");
  const decoded = await decodeFigBinary(await extractZipEntry(bytes, canvas));
  let meta = null;
  const metaEntry = entries.find((entry) => /(^|\/)meta\.json$/.test(entry.name));
  if (metaEntry) {
    try {
      meta = JSON.parse(utf8.decode(await extractZipEntry(bytes, metaEntry)));
    } catch (error) {
      meta = null;
    }
  }
  const thumbEntry = entries.find((entry) => /(^|\/)thumbnail\.png$/.test(entry.name));
  const thumbnail = thumbEntry ? await extractZipEntry(bytes, thumbEntry) : null;
  // Image files are named by the lowercase hex SHA-1 the paints reference.
  const images = {};
  for (const entry of entries) {
    const match = entry.name.match(/(?:^|\/)images\/([0-9a-f]{40})$/i);
    if (match) images[match[1].toLowerCase()] = await extractZipEntry(bytes, entry);
  }
  return { ...decoded, images, meta, thumbnail };
}

/* ------------------------------------------------------------------ *
 * Kiwi Message -> REST-shaped file
 * ------------------------------------------------------------------ */

const gid = (guid) => (guid ? `${guid.sessionID}:${guid.localID}` : "");
// styleIdFor* = 0xFFFFFFFF:0xFFFFFFFF means "style detached".
const isDetached = (guid) => Boolean(guid) && guid.sessionID === 0xffffffff && guid.localID === 0xffffffff;
const MAX_NODES = 200000;
const MAX_INSTANCE_DEPTH = 16;
// Non-visual records stored as nodes: design variables, not layers.
const SKIPPED_TYPES = new Set(["VARIABLE_SET", "VARIABLE", "VARIABLE_OVERRIDE"]);
// Kiwi type -> REST type when they differ (SYMBOL is the component master).
const TYPE_MAP = { SYMBOL: "COMPONENT", ROUNDED_RECTANGLE: "RECTANGLE" };
const FRAME_LIKE = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION"]);
const CONTAINER_OUT = new Set(["DOCUMENT", "CANVAS", "FRAME", "GROUP", "SECTION", "COMPONENT", "COMPONENT_SET", "INSTANCE", "BOOLEAN_OPERATION"]);
const PROP_TYPES = { BOOL: "BOOLEAN", TEXT: "TEXT", INSTANCE_SWAP: "INSTANCE_SWAP", VARIANT: "VARIANT", NUMBER: "NUMBER", COLOR: "COLOR", IMAGE: "IMAGE", SLOT: "SLOT" };
const H_CONSTRAINT = { MIN: "LEFT", MAX: "RIGHT", CENTER: "CENTER", STRETCH: "LEFT_RIGHT", SCALE: "SCALE", FIXED_MIN: "LEFT", FIXED_MAX: "RIGHT" };
const V_CONSTRAINT = { MIN: "TOP", MAX: "BOTTOM", CENTER: "CENTER", STRETCH: "TOP_BOTTOM", SCALE: "SCALE", FIXED_MIN: "TOP", FIXED_MAX: "BOTTOM" };
const STYLE_REFS = { styleIdForFill: "fill", styleIdForStrokeFill: "stroke", styleIdForText: "text", styleIdForEffect: "effect", styleIdForGrid: "grid" };
// Instance-resolved values (instance scaling, auto-layout) cached per nested
// node in derivedSymbolData: only geometry and typography are taken from it.
const DERIVED_FIELDS = [
  "size", "transform", "fontSize", "lineHeight", "letterSpacing", "paragraphSpacing", "cornerRadius",
  "rectangleTopLeftCornerRadius", "rectangleTopRightCornerRadius", "rectangleBottomLeftCornerRadius", "rectangleBottomRightCornerRadius",
  "strokeWeight", "borderTopWeight", "borderRightWeight", "borderBottomWeight", "borderLeftWeight",
  "stackSpacing", "stackHorizontalPadding", "stackVerticalPadding", "stackPaddingRight", "stackPaddingBottom", "stackCounterSpacing"
];
const FONT_WEIGHTS = [
  [/thin|hairline/i, 100],
  [/extra[\s-]?light|ultra[\s-]?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi[\s-]?bold|demi[\s-]?bold/i, 600],
  [/extra[\s-]?bold|ultra[\s-]?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700]
];
const WGHT_AXIS = 0x77676874; // OpenType axis tag "wght"
const IDENTITY = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function multiply(a, b) {
  return {
    m00: a.m00 * b.m00 + a.m01 * b.m10,
    m01: a.m00 * b.m01 + a.m01 * b.m11,
    m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02,
    m10: a.m10 * b.m00 + a.m11 * b.m10,
    m11: a.m10 * b.m01 + a.m11 * b.m11,
    m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12
  };
}

function invert(m) {
  const det = m.m00 * m.m11 - m.m01 * m.m10;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return IDENTITY;
  const a = m.m11 / det;
  const b = -m.m01 / det;
  const c = -m.m10 / det;
  const d = m.m00 / det;
  return { m00: a, m01: b, m02: -(a * m.m02 + b * m.m12), m10: c, m11: d, m12: -(c * m.m02 + d * m.m12) };
}

const applyMatrix = (m, x, y) => ({ x: m.m00 * x + m.m01 * y + m.m02, y: m.m10 * x + m.m11 * y + m.m12 });
const round3 = (value) => Math.round(value * 1000) / 1000;

// REST absoluteBoundingBox = axis-aligned box of the transformed node rect.
function boundingBox(world, size) {
  const w = (size && size.x) || 0;
  const h = (size && size.y) || 0;
  const corners = [applyMatrix(world, 0, 0), applyMatrix(world, w, 0), applyMatrix(world, 0, h), applyMatrix(world, w, h)];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: round3(x), y: round3(y), width: round3(Math.max(...xs) - x), height: round3(Math.max(...ys) - y) };
}

const colorOf = (c) => ({ r: c?.r ?? 0, g: c?.g ?? 0, b: c?.b ?? 0, a: c?.a ?? 1 });

// Paint.transform maps node space to gradient space (a linear gradient runs
// from (0, .5) to (1, .5)); REST handles are the inverse image of those points.
function gradientHandles(paint) {
  const inverse = invert(paint.transform || IDENTITY);
  const points = paint.type === "GRADIENT_LINEAR" ? [[0, 0.5], [1, 0.5], [0, 1]] : [[0.5, 0.5], [1, 0.5], [0.5, 1]];
  return points.map(([x, y]) => {
    const p = applyMatrix(inverse, x, y);
    return { x: round3(p.x), y: round3(p.y) };
  });
}

function convertPaint(paint, ctx) {
  const out = { type: paint.type, visible: paint.visible !== false, opacity: paint.opacity ?? 1, blendMode: paint.blendMode || "NORMAL" };
  if (paint.type === "SOLID") {
    out.color = colorOf(paint.color);
  } else if (String(paint.type).startsWith("GRADIENT_")) {
    out.gradientStops = (paint.stops || []).map((stop) => ({ color: colorOf(stop.color), position: stop.position ?? 0 }));
    out.gradientHandlePositions = gradientHandles(paint);
  } else if (paint.type === "IMAGE") {
    out.scaleMode = paint.imageScaleMode || "FILL";
    // Image hash = SHA-1 of the file stored as images/<hex> in the archive.
    const hash = paint.image && paint.image.hash;
    if (hash instanceof Uint8Array && hash.length > 0) {
      out.imageRef = bytesToHex(hash);
      ctx.imageRefs.add(out.imageRef);
    }
  }
  return out;
}

const convertPaints = (paints, ctx) => (Array.isArray(paints) ? paints.map((paint) => convertPaint(paint, ctx)) : []);

function convertEffect(effect) {
  // FOREGROUND_BLUR is the binary name of the REST LAYER_BLUR.
  const type = effect.type === "FOREGROUND_BLUR" ? "LAYER_BLUR" : effect.type;
  const out = { type, visible: effect.visible !== false, radius: effect.radius ?? 0 };
  if (type === "DROP_SHADOW" || type === "INNER_SHADOW") {
    out.color = colorOf(effect.color);
    out.offset = { x: effect.offset?.x ?? 0, y: effect.offset?.y ?? 0 };
    out.spread = effect.spread ?? 0;
    out.blendMode = effect.blendMode || "NORMAL";
    out.showShadowBehindNode = Boolean(effect.showShadowBehindNode);
  }
  return out;
}

function fontWeightOf(node) {
  const axis = (node.fontVariations || []).find((variation) => variation.axisTag === WGHT_AXIS);
  if (axis && Number.isFinite(axis.value)) return axis.value;
  const style = (node.fontName && node.fontName.style) || "";
  for (const [pattern, weight] of FONT_WEIGHTS) if (pattern.test(style)) return weight;
  return 400;
}

// Number { value, units }: RAW = multiple of the font size (an explicit
// "120%" in the editor), PIXELS, PERCENT 100 = "Auto" (font intrinsic).
function lineHeightOf(lineHeight, fontSize) {
  if (!lineHeight) return { lineHeightUnit: "INTRINSIC_%", lineHeightPercent: 100 };
  const { value = 0, units } = lineHeight;
  if (units === "PIXELS") return { lineHeightPx: value, lineHeightUnit: "PIXELS", lineHeightPercentFontSize: fontSize ? (value / fontSize) * 100 : 0 };
  if (units === "RAW") return { lineHeightPx: value * fontSize, lineHeightUnit: "FONT_SIZE_%", lineHeightPercentFontSize: value * 100 };
  return { lineHeightUnit: "INTRINSIC_%", lineHeightPercent: value };
}

function letterSpacingOf(spacing, fontSize) {
  if (!spacing) return 0;
  const { value = 0, units } = spacing;
  if (units === "PERCENT") return (value / 100) * fontSize;
  if (units === "RAW") return value * fontSize;
  return value;
}

// REST TypeStyle from binary text fields. `partial` keeps only the fields the
// record sets (style override table entries are diffs on the base style).
function textStyleOf(node, baseFontSize, partial, ctx) {
  const style = {};
  const fontSize = node.fontSize ?? baseFontSize ?? 12;
  if (node.fontName || !partial) {
    const font = node.fontName || {};
    style.fontFamily = font.family || "";
    style.fontPostScriptName = font.postscript || null;
    style.fontStyle = font.style || "Regular";
    style.fontWeight = fontWeightOf(node);
    style.italic = /italic|oblique/i.test(font.style || "");
  }
  if (node.fontSize !== undefined || !partial) style.fontSize = fontSize;
  if (node.textAlignHorizontal || !partial) style.textAlignHorizontal = node.textAlignHorizontal || "LEFT";
  if (node.textAlignVertical || !partial) style.textAlignVertical = node.textAlignVertical || "TOP";
  if (node.letterSpacing || !partial) style.letterSpacing = letterSpacingOf(node.letterSpacing, fontSize);
  if (node.lineHeight || !partial) Object.assign(style, lineHeightOf(node.lineHeight, fontSize));
  if (node.textCase && node.textCase !== "ORIGINAL") style.textCase = node.textCase;
  if (node.textDecoration && node.textDecoration !== "NONE") style.textDecoration = node.textDecoration;
  if (node.textAutoResize) style.textAutoResize = node.textAutoResize;
  if (node.paragraphSpacing) style.paragraphSpacing = node.paragraphSpacing;
  if (node.hyperlink && node.hyperlink.url) style.hyperlink = { type: "URL", url: node.hyperlink.url };
  if (partial && Array.isArray(node.fillPaints)) style.fills = convertPaints(node.fillPaints, ctx);
  return style;
}

function applyText(out, node, ctx) {
  const textData = node.textData || {};
  out.characters = textData.characters || "";
  out.style = textStyleOf(node, node.fontSize, false, ctx);
  out.characterStyleOverrides = Array.isArray(textData.characterStyleIDs) ? textData.characterStyleIDs : [];
  out.styleOverrideTable = {};
  for (const entry of textData.styleOverrideTable || []) {
    if (entry && entry.styleID !== undefined) out.styleOverrideTable[entry.styleID] = textStyleOf(entry, out.style.fontSize, true, ctx);
  }
}

const isAutoSize = (value) => /RESIZE_TO_FIT/.test(String(value || ""));

function applyLayout(out, node) {
  const mode = node.stackMode;
  if (mode !== "HORIZONTAL" && mode !== "VERTICAL" && mode !== "GRID") return;
  out.layoutMode = mode;
  out.itemSpacing = node.stackSpacing ?? 0;
  // Left/top live in the per-axis fields; right/bottom have their own fields
  // and fall back to the axis value (older files store one value per axis).
  const uniform = node.stackPadding ?? 0;
  out.paddingLeft = node.stackHorizontalPadding ?? uniform;
  out.paddingRight = node.stackPaddingRight ?? node.stackHorizontalPadding ?? uniform;
  out.paddingTop = node.stackVerticalPadding ?? uniform;
  out.paddingBottom = node.stackPaddingBottom ?? node.stackVerticalPadding ?? uniform;
  out.primaryAxisAlignItems = node.stackPrimaryAlignItems || node.stackJustify || "MIN";
  out.counterAxisAlignItems = node.stackCounterAlignItems || node.stackAlign || "MIN";
  out.primaryAxisSizingMode = isAutoSize(node.stackPrimarySizing) ? "AUTO" : "FIXED";
  out.counterAxisSizingMode = isAutoSize(node.stackCounterSizing) ? "AUTO" : "FIXED";
  out.layoutWrap = node.stackWrap === "WRAP" ? "WRAP" : "NO_WRAP";
  if (node.stackCounterSpacing !== undefined) out.counterAxisSpacing = node.stackCounterSpacing;
  if (node.stackReverseZIndex) out.itemReverseZIndex = true;
  if (mode === "GRID") {
    out.gridColumnCount = (node.gridColumns && node.gridColumns.entries ? node.gridColumns.entries.length : 0) || 0;
    out.gridRowCount = (node.gridRows && node.gridRows.entries ? node.gridRows.entries.length : 0) || 0;
    out.gridRowGap = node.gridRowGap ?? 0;
    out.gridColumnGap = node.gridColumnGap ?? 0;
  }
}

// FILL / HUG / FIXED per axis, as REST reports for auto-layout frames and
// their children.
function applySizing(out, node, parentMode) {
  const selfMode = out.layoutMode;
  if (!parentMode && !selfMode) return;
  const grow = (node.stackChildPrimaryGrow ?? 0) > 0;
  const stretch = node.stackChildAlignSelf === "STRETCH";
  const isText = out.type === "TEXT";
  const hugX = (selfMode === "HORIZONTAL" && out.primaryAxisSizingMode === "AUTO") || (selfMode === "VERTICAL" && out.counterAxisSizingMode === "AUTO") || (isText && node.textAutoResize === "WIDTH_AND_HEIGHT");
  const hugY = (selfMode === "VERTICAL" && out.primaryAxisSizingMode === "AUTO") || (selfMode === "HORIZONTAL" && out.counterAxisSizingMode === "AUTO") || (isText && (node.textAutoResize === "WIDTH_AND_HEIGHT" || node.textAutoResize === "HEIGHT"));
  const fillX = (parentMode === "HORIZONTAL" && grow) || (parentMode === "VERTICAL" && stretch);
  const fillY = (parentMode === "VERTICAL" && grow) || (parentMode === "HORIZONTAL" && stretch);
  out.layoutSizingHorizontal = fillX ? "FILL" : hugX ? "HUG" : "FIXED";
  out.layoutSizingVertical = fillY ? "FILL" : hugY ? "HUG" : "FIXED";
}

function applyShape(out, node, ctx) {
  out.fills = convertPaints(node.fillPaints, ctx);
  out.strokes = convertPaints(node.strokePaints, ctx);
  out.strokeWeight = node.strokeWeight ?? 0;
  out.strokeAlign = node.strokeAlign || "CENTER";
  if (node.borderStrokeWeightsIndependent) {
    out.individualStrokeWeights = {
      top: node.borderTopWeight ?? 0,
      right: node.borderRightWeight ?? 0,
      bottom: node.borderBottomWeight ?? 0,
      left: node.borderLeftWeight ?? 0
    };
  }
  // REST order: top-left, top-right, bottom-right, bottom-left.
  const corners = [node.rectangleTopLeftCornerRadius, node.rectangleTopRightCornerRadius, node.rectangleBottomRightCornerRadius, node.rectangleBottomLeftCornerRadius];
  const radius = node.cornerRadius ?? 0;
  if (radius) out.cornerRadius = radius;
  if (corners.some((value) => value !== undefined)) {
    const radii = corners.map((value) => value ?? radius);
    if (radii.some((value) => value !== radii[0])) out.rectangleCornerRadii = radii;
    else if (!radius && radii[0]) out.cornerRadius = radii[0];
  }
  out.effects = Array.isArray(node.effects) ? node.effects.map(convertEffect) : [];
  if (Array.isArray(node.layoutGrids) && node.layoutGrids.length > 0) {
    out.layoutGrids = node.layoutGrids.map((grid) => ({
      pattern: grid.pattern === "GRID" ? "GRID" : grid.axis === "Y" ? "ROWS" : "COLUMNS",
      sectionSize: grid.sectionSize ?? 0,
      visible: grid.visible !== false,
      color: colorOf(grid.color),
      alignment: grid.type || "MIN",
      gutterSize: grid.gutterSize ?? 0,
      offset: grid.offset ?? 0,
      count: grid.numSections ?? 0
    }));
  }
}

function propValueOf(value, type) {
  if (!value) return null;
  if (type === "BOOL") return Boolean(value.boolValue);
  if (type === "TEXT") return (value.textValue && value.textValue.characters) || "";
  if (type === "INSTANCE_SWAP") return value.guidValue ? gid(value.guidValue) : null;
  if (value.floatValue !== undefined) return value.floatValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.textValue) return value.textValue.characters || "";
  if (value.guidValue) return gid(value.guidValue);
  return null;
}

// Property definitions of a component: its own plus, for a variant, the
// ones declared on its component set.
function propDefsOf(symbol, ctx) {
  const defs = [...(symbol.componentPropDefs || [])];
  const parent = symbol.parentIndex ? ctx.byId.get(gid(symbol.parentIndex.guid)) : null;
  if (parent && parent.isStateGroup) defs.push(...(parent.componentPropDefs || []));
  return defs.filter((def) => def && def.id && !def.isDeleted);
}

function propertyDefinitionsOf(node) {
  const out = {};
  for (const order of node.stateGroupPropertyValueOrders || []) {
    out[order.property] = { type: "VARIANT", defaultValue: (order.values || [])[0] || "", variantOptions: order.values || [] };
  }
  for (const def of node.componentPropDefs || []) {
    if (!def || def.isDeleted || def.type === "VARIANT") continue;
    out[`${def.name}#${gid(def.id)}`] = { type: PROP_TYPES[def.type] || def.type, defaultValue: propValueOf(def.initialValue, def.type) };
  }
  return out;
}

// Local styles are referenced by guid, library styles by asset key; both
// resolve to the style master node id used as the REST style id.
function resolveStyles(out, node, ctx) {
  const styles = {};
  for (const [field, key] of Object.entries(STYLE_REFS)) {
    const ref = node[field];
    if (!ref) continue;
    let id = "";
    if (ref.guid && !isDetached(ref.guid) && ctx.styleIds.has(gid(ref.guid))) id = gid(ref.guid);
    else if (ref.assetRef && ctx.styleByKey.has(ref.assetRef.key)) id = ctx.styleByKey.get(ref.assetRef.key);
    if (id) styles[key] = id;
  }
  if (Object.keys(styles).length > 0) out.styles = styles;
}

function convertNode(node, id, world, parentMode, ctx) {
  ctx.count += 1;
  let type = TYPE_MAP[node.type] || node.type;
  // Component sets are FRAMEs flagged isStateGroup; groups are FRAMEs that
  // resize to fit their children without auto-layout.
  if (type === "FRAME" && node.isStateGroup) type = "COMPONENT_SET";
  else if (type === "FRAME" && node.resizeToFit && (!node.stackMode || node.stackMode === "NONE")) type = "GROUP";
  const out = { id, name: node.name || "", type, visible: node.visible !== false };
  if (type === "DOCUMENT") return out;
  if (type === "CANVAS") {
    if (node.backgroundColor) out.backgroundColor = colorOf(node.backgroundColor);
    return out;
  }
  const local = node.transform || IDENTITY;
  const nodeWorld = multiply(world, local);
  out.absoluteBoundingBox = boundingBox(nodeWorld, node.size);
  out.relativeTransform = [[local.m00, local.m01, local.m02], [local.m10, local.m11, local.m12]];
  out.size = { x: (node.size && node.size.x) || 0, y: (node.size && node.size.y) || 0 };
  out.opacity = node.opacity ?? 1;
  out.blendMode = node.blendMode || "PASS_THROUGH";
  if (node.mask) out.isMask = true;
  out.constraints = { horizontal: H_CONSTRAINT[node.horizontalConstraint] || "LEFT", vertical: V_CONSTRAINT[node.verticalConstraint] || "TOP" };
  applyShape(out, node, ctx);
  if (FRAME_LIKE.has(type)) out.clipsContent = node.frameMaskDisabled === false;
  applyLayout(out, node);
  applySizing(out, node, parentMode);
  if (parentMode) {
    out.layoutAlign = node.stackChildAlignSelf === "STRETCH" ? "STRETCH" : "INHERIT";
    out.layoutGrow = (node.stackChildPrimaryGrow ?? 0) > 0 ? 1 : 0;
    if (node.stackPositioning === "ABSOLUTE") out.layoutPositioning = "ABSOLUTE";
  }
  const min = node.minSize && node.minSize.value;
  const max = node.maxSize && node.maxSize.value;
  if (min && min.x) out.minWidth = min.x;
  if (min && min.y) out.minHeight = min.y;
  if (max && max.x && max.x < 1e6) out.maxWidth = max.x;
  if (max && max.y && max.y < 1e6) out.maxHeight = max.y;
  if (type === "TEXT" || type === "TEXT_PATH") applyText(out, node, ctx);
  if (type === "COMPONENT" || type === "COMPONENT_SET") {
    const defs = propertyDefinitionsOf(node);
    if (Object.keys(defs).length > 0) out.componentPropertyDefinitions = defs;
    if (node.symbolDescription) out.description = node.symbolDescription;
  }
  if (node.prototypeStartingPoint && node.prototypeStartingPoint.name) {
    ctx.flowStarts.push({ nodeId: id, name: node.prototypeStartingPoint.name });
  }
  resolveStyles(out, node, ctx);
  ctx.worlds.set(out, nodeWorld);
  return out;
}

const childrenOf = (node, ctx) => (ctx.children.get(gid(node.guid)) || []).filter((child) => !SKIPPED_TYPES.has(child.type) && !child.internalOnly);

function convertTree(node, world, parentMode, ctx) {
  const out = convertNode(node, gid(node.guid), world, parentMode, ctx);
  const nodeWorld = ctx.worlds.get(out) || world;
  const kids = childrenOf(node, ctx);
  if (node.type === "INSTANCE" && kids.length === 0) {
    expandInstance(out, node, nodeWorld, { overrides: new Map(), derived: new Map() }, [], ctx);
    return out;
  }
  if (out.type === "INSTANCE") setInstanceComponent(out, node, ctx);
  if (kids.length > 0 || CONTAINER_OUT.has(out.type)) {
    out.children = kids.map((child) => convertTree(child, nodeWorld, out.layoutMode, ctx));
  }
  return out;
}

const pathKey = (guids) => guids.map(gid).join("/");

// Override records are keyed by guidPath: the overrideKey (or guid) of each
// instance boundary crossed from the instance down to the target node.
function indexByPath(records) {
  const map = new Map();
  for (const record of records || []) {
    const guids = record && record.guidPath && record.guidPath.guids;
    if (!guids || guids.length === 0) continue;
    const key = pathKey(guids);
    map.set(key, { ...(map.get(key) || {}), ...record });
  }
  return map;
}

function subMap(map, prefix) {
  const out = new Map();
  const start = `${prefix}/`;
  for (const [key, value] of map) if (key.startsWith(start)) out.set(key.slice(start.length), value);
  return out;
}

function setInstanceComponent(out, node, ctx) {
  const symbolId = node.overriddenSymbolID ? gid(node.overriddenSymbolID) : gid(node.symbolData && node.symbolData.symbolID);
  if (!symbolId) return null;
  out.componentId = symbolId;
  ctx.instanceCount += 1;
  return ctx.byId.get(symbolId) || null;
}

function mergeOverride(base, override, derived) {
  const merged = { ...base };
  if (override) {
    for (const [key, value] of Object.entries(override)) {
      if (key === "guidPath") continue;
      if (key === "componentPropAssignments") merged.componentPropAssignments = [...(base.componentPropAssignments || []), ...value];
      else merged[key] = value;
    }
  }
  if (derived) {
    for (const field of DERIVED_FIELDS) if (derived[field] !== undefined) merged[field] = derived[field];
  }
  return merged;
}

// Applies the boolean / text / instance-swap properties bound to a node.
function applyPropRefs(node, scope) {
  if (!Array.isArray(node.componentPropRefs) || node.componentPropRefs.length === 0) return node;
  const out = { ...node };
  for (const ref of node.componentPropRefs) {
    if (!ref || ref.isDeleted || !ref.defID) continue;
    const entry = scope.get(gid(ref.defID));
    if (!entry || entry.value == null) continue;
    if (ref.componentPropNodeField === "VISIBLE") out.visible = Boolean(entry.value);
    else if (ref.componentPropNodeField === "TEXT_DATA") out.textData = { characters: String(entry.value) };
    else if (ref.componentPropNodeField === "OVERRIDDEN_SYMBOL_ID" && entry.raw) out.overriddenSymbolID = entry.raw;
  }
  return out;
}

function propScopeOf(symbol, instance, ctx) {
  const scope = new Map();
  for (const def of propDefsOf(symbol, ctx)) {
    scope.set(gid(def.id), { name: def.name, type: def.type, value: propValueOf(def.initialValue, def.type), raw: def.initialValue && def.initialValue.guidValue });
  }
  for (const assignment of instance.componentPropAssignments || []) {
    if (!assignment || !assignment.defID) continue;
    const key = gid(assignment.defID);
    const def = scope.get(key) || { name: key, type: "" };
    scope.set(key, { ...def, value: propValueOf(assignment.value, def.type), raw: assignment.value && assignment.value.guidValue });
  }
  return scope;
}

function instanceProperties(symbol, scope, ctx) {
  const props = {};
  const defs = new Map(propDefsOf(symbol, ctx).map((def) => [gid(def.id), def]));
  for (const spec of symbol.variantPropSpecs || []) {
    const def = defs.get(gid(spec.propDefId));
    if (def) props[def.name] = { type: "VARIANT", value: spec.value };
  }
  for (const [key, entry] of scope) {
    if (entry.type === "VARIANT" || !entry.type) continue;
    props[`${entry.name}#${key}`] = { type: PROP_TYPES[entry.type] || entry.type, value: entry.value };
  }
  return props;
}

/**
 * Instances carry no children in the file: they are rebuilt from the
 * component master, then overrides, bound properties and derived (resolved)
 * geometry are applied by guidPath. Ids follow REST: "I<instance>;<node>".
 */
function expandInstance(out, node, world, inherited, stack, ctx) {
  const symbol = setInstanceComponent(out, node, ctx);
  out.children = [];
  if (!symbol || stack.length >= MAX_INSTANCE_DEPTH || stack.includes(out.componentId)) return;
  // Overrides from enclosing instances win over the instance's own ones.
  const overrides = indexByPath(node.symbolData && node.symbolData.symbolOverrides);
  for (const [key, value] of inherited.overrides) overrides.set(key, { ...(overrides.get(key) || {}), ...value });
  const derived = indexByPath(node.derivedSymbolData);
  for (const [key, value] of inherited.derived) derived.set(key, { ...(derived.get(key) || {}), ...value });
  const scope = propScopeOf(symbol, node, ctx);
  const props = instanceProperties(symbol, scope, ctx);
  if (Object.keys(props).length > 0) out.componentProperties = props;
  const nextStack = [...stack, out.componentId];
  const prefix = out.id.startsWith("I") ? out.id : `I${out.id}`;

  const visit = (source, parentOut, parentWorld) => {
    parentOut.children = parentOut.children || [];
    for (const child of childrenOf(source, ctx)) {
      if (ctx.count >= MAX_NODES) {
        ctx.truncated = true;
        return;
      }
      const key = gid(child.overrideKey || child.guid);
      const merged = applyPropRefs(mergeOverride(child, overrides.get(key), derived.get(key)), scope);
      const childOut = convertNode(merged, `${prefix};${gid(child.guid)}`, parentWorld, parentOut.layoutMode, ctx);
      const childWorld = ctx.worlds.get(childOut);
      parentOut.children.push(childOut);
      if (merged.type === "INSTANCE" && childrenOf(child, ctx).length === 0) {
        expandInstance(childOut, merged, childWorld, { overrides: subMap(overrides, key), derived: subMap(derived, key) }, nextStack, ctx);
      } else {
        if (childOut.type === "INSTANCE") setInstanceComponent(childOut, merged, ctx);
        visit(child, childOut, childWorld);
        if (childOut.children.length === 0 && !CONTAINER_OUT.has(childOut.type)) delete childOut.children;
      }
    }
  };
  visit(symbol, out, world);
}

function buildStyleIndex(nodes) {
  const styleIds = new Map();
  const styleByKey = new Map();
  for (const node of nodes) {
    if (!node.styleType || node.styleType === "NONE") continue;
    const id = gid(node.guid);
    styleIds.set(id, node);
    if (node.key) styleByKey.set(node.key, id);
  }
  return { styleIds, styleByKey };
}

function buildComponentMaps(nodes, ctx) {
  const components = {};
  const componentSets = {};
  for (const node of nodes) {
    const id = gid(node.guid);
    if (node.type === "SYMBOL") {
      const parent = node.parentIndex ? ctx.byId.get(gid(node.parentIndex.guid)) : null;
      components[id] = {
        key: node.componentKey || "",
        name: node.name || "",
        description: node.symbolDescription || "",
        remote: Boolean(node.sourceLibraryKey),
        documentationLinks: [],
        ...(parent && parent.isStateGroup ? { componentSetId: gid(parent.guid) } : {})
      };
    } else if (node.isStateGroup) {
      componentSets[id] = { key: node.componentKey || "", name: node.name || "", description: node.symbolDescription || "", remote: Boolean(node.sourceLibraryKey) };
    }
  }
  return { components, componentSets };
}

function imageMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (/^\s*<(\?xml|svg)/.test(ascii(bytes, 0, 16))) return "image/svg+xml";
  return "application/octet-stream";
}

/**
 * Rebuilds the REST `GET /v1/files/:key` shape from a decoded Message.
 * @param {object} message decoded Message (nodeChanges[])
 * @param {{ name?: string, images?: Record<string, Uint8Array>, lastModified?: string, version?: string|number, editorType?: string }} [options]
 * @returns {{ name: string, lastModified: string, version: string, editorType: string, document: object, components: object, componentSets: object, styles: object, imageFills: Record<string, string>, stats: object }}
 */
export function kiwiToRestFile(message, { name = "", images = {}, lastModified = "", version = "", editorType = "figma" } = {}) {
  const all = (message && Array.isArray(message.nodeChanges) ? message.nodeChanges : []).filter((node) => node && node.guid && node.phase !== "REMOVED");
  if (all.length === 0) throw new Error("Aucun calque dans ces données Figma : la sélection copiée ou le fichier est vide.");
  const byId = new Map(all.map((node) => [gid(node.guid), node]));
  const children = new Map();
  const roots = [];
  for (const node of all) {
    const parentId = node.parentIndex && node.parentIndex.guid ? gid(node.parentIndex.guid) : "";
    if (parentId && byId.has(parentId) && parentId !== gid(node.guid)) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(node);
    } else {
      roots.push(node);
    }
  }
  // Siblings are ordered by parentIndex.position compared as plain strings
  // (code unit order); later = drawn on top, like REST children.
  for (const list of children.values()) {
    list.sort((a, b) => {
      const pa = (a.parentIndex && a.parentIndex.position) || "";
      const pb = (b.parentIndex && b.parentIndex.position) || "";
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
  }
  const ctx = { byId, children, worlds: new WeakMap(), imageRefs: new Set(), flowStarts: [], count: 0, instanceCount: 0, truncated: false, ...buildStyleIndex(all) };
  const { components, componentSets } = buildComponentMaps(all, ctx);

  const docNode = roots.find((node) => node.type === "DOCUMENT");
  const document = docNode ? convertNode(docNode, gid(docNode.guid), IDENTITY, null, ctx) : { id: "0:0", name: "Document", type: "DOCUMENT", visible: true };
  const pages = [...(docNode ? childrenOf(docNode, ctx) : []), ...roots.filter((node) => node.type === "CANVAS" && !node.internalOnly)];
  document.children = [];
  for (const page of pages) {
    // The internal canvas only stores component and style masters.
    if (page.type !== "CANVAS") continue;
    ctx.flowStarts = [];
    const pageOut = convertTree(page, IDENTITY, null, ctx);
    if (ctx.flowStarts.length > 0) pageOut.flowStartingPoints = ctx.flowStarts;
    document.children.push(pageOut);
  }
  // Clipboard selections may come without their page: loose roots get one.
  const loose = roots.filter((node) => node.type !== "DOCUMENT" && node.type !== "CANVAS" && !SKIPPED_TYPES.has(node.type));
  if (loose.length > 0) {
    document.children.push({ id: "0:clipboard", name: "Presse-papiers", type: "CANVAS", visible: true, children: loose.map((node) => convertTree(node, IDENTITY, null, ctx)) });
  }

  const styles = {};
  for (const [id, node] of ctx.styleIds) {
    // REST has no STROKE style type: stroke styles are FILL styles.
    styles[id] = { key: node.key || "", name: node.name || "", styleType: node.styleType === "STROKE" ? "FILL" : node.styleType, description: node.styleDescription || "", remote: false };
  }

  const imageFills = {};
  let imageBytes = 0;
  for (const ref of ctx.imageRefs) {
    const bytes = images[ref];
    if (!bytes || bytes.length > MAX_IMAGE_DATA_URL_BYTES) continue;
    imageFills[ref] = `data:${imageMime(bytes)};base64,${bytesToBase64(bytes)}`;
    imageBytes += bytes.length;
  }

  return {
    name: name || "Fichier Figma",
    lastModified,
    version: String(version || ""),
    editorType,
    thumbnailUrl: "",
    document,
    components,
    componentSets,
    styles,
    imageFills,
    stats: {
      nodes: ctx.count,
      instancesExpanded: ctx.instanceCount,
      truncated: ctx.truncated,
      imageRefs: ctx.imageRefs.size,
      imagesEmbedded: Object.keys(imageFills).length,
      imageBytes
    }
  };
}

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

const EDITOR_BY_PRELUDE = { "fig-jam.": "figjam", "fig-deck": "slides" };
const editorTypeOf = (prelude) => EDITOR_BY_PRELUDE[prelude] || "figma";

/**
 * Extracts the two base64 payloads Figma writes in the clipboard `text/html`:
 * `(figmeta)` JSON (fileKey, pasteID, dataType) and `(figma)` fig-kiwi bytes.
 * @returns {{ meta: object|null, bytes: Uint8Array }}
 */
export function parseFigmaClipboardHtml(html) {
  const text = String(html || "");
  const data = text.match(/\(figma\)([\s\S]*?)\(\/figma\)/);
  if (!data) {
    throw new Error("Aucune donnée Figma dans le presse-papiers : sélectionnez des calques dans l'application Figma, copiez-les (Ctrl+C ou Cmd+C), puis collez-les ici.");
  }
  let bytes;
  try {
    bytes = base64ToBytes(data[1]);
  } catch (error) {
    throw new Error("Données Figma du presse-papiers illisibles : encodage base64 invalide.");
  }
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "fig-") {
    throw new Error("Données Figma du presse-papiers inattendues : en-tête « fig-kiwi » absent.");
  }
  let meta = null;
  const metaMatch = text.match(/\(figmeta\)([\s\S]*?)\(\/figmeta\)/);
  if (metaMatch) {
    try {
      meta = JSON.parse(utf8.decode(base64ToBytes(metaMatch[1])));
    } catch (error) {
      meta = null;
    }
  }
  return { meta, bytes };
}

/**
 * Clipboard route. Copied layers reference images by hash only (the bytes
 * are not in the clipboard), so imageFills stays empty.
 * @returns {Promise<{ file: object, imageFills: Record<string,string>, source: object }>}
 */
export async function importFigmaClipboard(html) {
  const { meta, bytes } = parseFigmaClipboardHtml(html);
  const decoded = await decodeFigBinary(bytes);
  const file = kiwiToRestFile(decoded.message, {
    name: "Presse-papiers Figma",
    version: decoded.version,
    editorType: editorTypeOf(decoded.prelude)
  });
  // A paste is an explicit selection: every copied top-level node counts,
  // whatever its size (same rule as an API import scoped to one node).
  file.scopedNodeId = "clipboard-selection";
  return {
    file,
    imageFills: file.imageFills,
    source: {
      kind: "clipboard",
      prelude: decoded.prelude,
      version: decoded.version,
      fileKey: (meta && meta.fileKey) || decoded.message.pasteFileKey || "",
      pasteID: meta && meta.pasteID !== undefined ? meta.pasteID : decoded.message.pasteID ?? null,
      dataType: (meta && meta.dataType) || "",
      ...file.stats
    }
  };
}

/**
 * `.fig` route (ZIP from "Save local copy", or a raw fig-kiwi binary).
 * @returns {Promise<{ file: object, imageFills: Record<string,string>, source: object }>}
 */
export async function importFigFile(input, { fileName = "" } = {}) {
  const bytes = toBytes(input);
  const result = await readFigFile(bytes);
  const meta = result.meta || {};
  const baseName = String(fileName || "").replace(/^.*[\\/]/, "").replace(/\.(fig|jam|deck)$/i, "");
  const file = kiwiToRestFile(result.message, {
    name: meta.file_name || baseName || "Fichier Figma",
    images: result.images,
    lastModified: meta.exported_at || "",
    version: result.version,
    editorType: editorTypeOf(result.prelude)
  });
  return {
    file,
    imageFills: file.imageFills,
    source: {
      kind: isZip(bytes) ? "fig-file" : "fig-binary",
      prelude: result.prelude,
      version: result.version,
      fileName: baseName,
      exportedAt: meta.exported_at || "",
      thumbnail: result.thumbnail ? `data:image/png;base64,${bytesToBase64(result.thumbnail)}` : "",
      imagesInArchive: Object.keys(result.images).length,
      ...file.stats
    }
  };
}
