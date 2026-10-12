/**
 * 3D model detection: URL / content-type classification and magic-byte
 * identification. Pure functions, shared by the service worker (network
 * log) and the tests.
 *
 * Keys_Osi 3D detection (third-party notice: THIRD_PARTY_NOTICES.md), with
 * fixes: the "3d"/"asset" URL heuristic no longer flags hashed bundles or
 * fonts served as octet-stream, and Spline scenes / Draco blobs are known.
 */

export const MODEL_EXTENSIONS = [
  "glb", "gltf", "m3f", "3mf", "fbx", "obj", "mtl", "usdz", "usdc", "usd",
  "stl", "ply", "dae", "3ds", "blend", "x3d", "vrml", "wrl", "drc", "splinecode"
];

// Formats GLB/glTF conversion can read.
export const CONVERTIBLE_FORMATS = new Set(["glb", "gltf"]);

const EXT_RE = new RegExp(`\\.(${MODEL_EXTENSIONS.join("|")})(?:[?#]|$)`, "i");

// Never models, even when served as octet-stream from an /assets/ path.
const NON_MODEL_EXT = /\.(?:js|mjs|css|map|json|html?|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|ogg|wasm|txt|xml)(?:[?#]|$)/i;
const MODEL_PATH_HINT = /\/(?:models?|mesh(?:es)?|3d|scenes?|avatars?|gltf|glb)(?:[/_.-]|$)/i;

export function extractExtension(url) {
  let path = String(url || "");
  try {
    path = new URL(path).pathname;
  } catch {
    path = path.split(/[?#]/)[0];
  }
  const m = path.match(/\.([a-z0-9]{2,10})$/i);
  return m ? m[1].toLowerCase() : null;
}

export function detectFormat(url, contentType) {
  const ext = extractExtension(url);
  if (ext && MODEL_EXTENSIONS.includes(ext)) return ext === "wrl" ? "vrml" : ext;
  const loose = String(url || "").match(EXT_RE);
  if (loose) return loose[1].toLowerCase() === "wrl" ? "vrml" : loose[1].toLowerCase();

  const ct = String(contentType || "").toLowerCase();
  if (!ct) return null;
  if (ct.includes("gltf-binary")) return "glb";
  if (ct.includes("gltf")) return "gltf";
  if (ct.includes("3mf") || ct.includes("3dmanufacturing")) return "3mf";
  if (ct.includes("collada")) return "dae";
  if (ct.includes("usdz")) return "usdz";
  if (ct.includes("application/sla") || ct.includes("model/stl")) return "stl";
  if (ct.includes("fbx")) return "fbx";
  if (ct.includes("model/obj")) return "obj";
  if (ct.includes("model/vrml") || ct.includes("model/x3d")) return "x3d";
  return null;
}

export function classifyRequest(url, contentType, size) {
  const format = detectFormat(url, contentType);
  if (format) return { isModel: true, format, confidence: "high" };

  // Soft heuristic: large opaque binary on a model-ish path segment.
  const ct = String(contentType || "").toLowerCase();
  const looksBinary = ct === "" || ct.includes("octet-stream") || ct.includes("binary");
  if (looksBinary && typeof size === "number" && size > 50_000 && !NON_MODEL_EXT.test(url)) {
    let path = String(url);
    try {
      path = new URL(url).pathname;
    } catch {
      // keep raw
    }
    if (MODEL_PATH_HINT.test(path)) return { isModel: true, format: "unknown", confidence: "low" };
  }
  return { isModel: false };
}

export function extractFilename(url, format) {
  let base = "model";
  try {
    const last = new URL(url).pathname.split("/").pop();
    if (last) base = decodeURIComponent(last);
  } catch {
    // keep default
  }
  return modelFilename(base, format);
}

/** Windows-safe filename that always ends with a model extension. */
export function modelFilename(name, format) {
  let base = String(name || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120) || "model";
  const hasKnownExt = MODEL_EXTENSIONS.some((ext) => base.toLowerCase().endsWith(`.${ext}`));
  if (!hasKnownExt) {
    const ext = format && format !== "unknown" ? format : "bin";
    base = `${base.replace(/\.[a-z0-9]{1,6}$/i, "")}.${ext}`;
  }
  return base;
}

export function renameWithExtension(filename, ext) {
  return `${String(filename).replace(/\.[a-z0-9]{1,10}$/i, "") || "model"}.${ext}`;
}

function startsWithAscii(bytes, text, offset = 0) {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function decodeHead(bytes, max = 4096) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, max)));
  } catch {
    return "";
  }
}

/**
 * Identify a file from its first bytes. `totalSize` (optional) lets the
 * binary-STL check verify 84 + 50 * triangleCount === size.
 * Returns { format, confidence: high|medium|low|none, hint }.
 */
export function detectFromBytes(bytes, totalSize) {
  if (!bytes || bytes.length < 4) {
    return { format: "unknown", confidence: "none", hint: "File too small to identify." };
  }
  if (startsWithAscii(bytes, "glTF")) return { format: "glb", confidence: "high", hint: "GLB (binary glTF)" };
  if (startsWithAscii(bytes, "Kaydara FBX Binary")) return { format: "fbx", confidence: "high", hint: "FBX Binary" };
  if (startsWithAscii(bytes, "DRACO")) return { format: "drc", confidence: "high", hint: "Draco-compressed mesh" };
  if (startsWithAscii(bytes, "BLENDER")) return { format: "blend", confidence: "high", hint: "Blender file" };

  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    const text = decodeHead(bytes);
    if (text.includes("3dmodel.model")) return { format: "3mf", confidence: "high", hint: "3MF archive" };
    if (/\.usd[ca]?\b/i.test(text)) return { format: "usdz", confidence: "high", hint: "USDZ archive" };
    if (text.includes("vnd.collada") || text.includes(".dae")) return { format: "dae", confidence: "medium", hint: "Collada ZAE archive" };
    return { format: "zip", confidence: "low", hint: "ZIP archive (3MF / USDZ / ZAE / KMZ?)." };
  }

  let text = decodeHead(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const trimmed = text.trimStart();

  if (trimmed.startsWith("{")) {
    if (/"asset"\s*:/.test(trimmed) && /"version"|"buffers"|"meshes"/.test(trimmed)) {
      return { format: "gltf", confidence: "high", hint: "glTF JSON" };
    }
    return { format: "json", confidence: "low", hint: "JSON (scene description?)" };
  }
  if (/^ply\r?\n/i.test(trimmed)) return { format: "ply", confidence: "high", hint: "PLY" };
  if (/^#VRML/i.test(trimmed)) return { format: "vrml", confidence: "high", hint: "VRML" };
  if (/^(<\?xml|<COLLADA|<X3D)/i.test(trimmed)) {
    if (/<COLLADA/i.test(trimmed)) return { format: "dae", confidence: "high", hint: "Collada XML" };
    if (/<X3D/i.test(trimmed)) return { format: "x3d", confidence: "high", hint: "X3D XML" };
    return { format: "xml", confidence: "low", hint: "XML (unknown 3D dialect)" };
  }

  // Binary STL: 80-byte header + uint32 count. Checked before "solid" because
  // many binary STL exporters write "solid" into the header.
  if (bytes.length >= 84) {
    const tri = (bytes[80] | (bytes[81] << 8) | (bytes[82] << 16) | (bytes[83] << 24)) >>> 0;
    if (tri > 0 && Number.isFinite(totalSize) && 84 + tri * 50 === totalSize) {
      return { format: "stl", confidence: "high", hint: `STL Binary (${tri} triangles)` };
    }
  }
  if (/^solid\b/i.test(trimmed) && /facet\s+normal/i.test(trimmed)) {
    return { format: "stl", confidence: "high", hint: "STL ASCII" };
  }

  const objHits = trimmed
    .split("\n")
    .slice(0, 40)
    .filter((line) => /^(v|vn|vt|f|o|g|mtllib|usemtl)\s/.test(line)).length;
  if (objHits >= 3) return { format: "obj", confidence: "high", hint: "Wavefront OBJ" };

  if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes.length >= 6) {
    const chunkLen = (bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24)) >>> 0;
    if (!Number.isFinite(totalSize) || chunkLen === totalSize) {
      return { format: "3ds", confidence: "medium", hint: "3DS (main chunk 0x4D4D)" };
    }
  }

  return {
    format: "bin",
    confidence: "low",
    hint: "Raw binary without header: most likely a glTF buffer (.bin). Grab the sibling .gltf instead."
  };
}

/** Find a .gltf in the same directory (same host) as a .bin buffer. */
export function findSiblingGltf(requests, binUrl) {
  let dir;
  let host;
  try {
    const u = new URL(binUrl);
    host = u.host;
    dir = u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1);
  } catch {
    return null;
  }
  for (const req of requests || []) {
    try {
      const u = new URL(req.url);
      if (u.host === host && u.pathname.startsWith(dir) && /\.gltf$/i.test(u.pathname)) return req.url;
    } catch {
      // skip
    }
  }
  return null;
}
