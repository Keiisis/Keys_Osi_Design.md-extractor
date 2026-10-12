/**
 * GLB / glTF -> STL / 3MF conversion, fully in-browser (also runs in Node).
 *
 * Keys_Osi 3D converter (third-party notice: THIRD_PARTY_NOTICES.md),
 * extended with: .gltf with external or data: buffers, triangle
 * strips/fans, mirrored transforms (winding flip), per-material texture
 * guard and the 3MF texture relationship part.
 *
 * Compressed geometry needs decoders passed in `decoders`:
 *   { getDraco: () => Promise<DracoModule>, meshopt: MeshoptDecoder }
 */
import { createZip } from "./zip.mjs";

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function isGlb(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}

export function parseGlb(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 20) throw new Error("File too small to be a GLB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Not a GLB (magic mismatch).");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error("First GLB chunk must be JSON.");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  let offset = 20 + jsonLen;
  let bin = null;
  if (offset + 8 <= bytes.byteLength && view.getUint32(offset + 4, true) === CHUNK_BIN) {
    const binLen = view.getUint32(offset, true);
    bin = bytes.subarray(offset + 8, offset + 8 + binLen);
  }
  return { json, bin };
}

function dataUriToBytes(uri) {
  const comma = uri.indexOf(",");
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (meta.endsWith(";base64")) {
    const binary = atob(payload);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

/**
 * Build { json, buffers[] } from GLB or glTF JSON bytes. External buffer
 * URIs are resolved against `baseUrl` and loaded through `fetchBytes`.
 */
export async function loadGltf(bytes, { baseUrl, fetchBytes } = {}) {
  let json;
  let glbBin = null;
  if (isGlb(bytes)) {
    ({ json, bin: glbBin } = parseGlb(bytes));
  } else {
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("Neither a GLB nor a glTF JSON file.");
    }
    if (!json.asset) throw new Error("JSON is not a glTF asset.");
  }
  const buffers = [];
  for (const [i, buf] of (json.buffers || []).entries()) {
    if (!buf.uri) {
      buffers.push(i === 0 ? glbBin : null);
    } else if (buf.uri.startsWith("data:")) {
      buffers.push(dataUriToBytes(buf.uri));
    } else {
      if (!fetchBytes || !baseUrl) throw new Error(`External buffer "${buf.uri}" needs the source URL.`);
      buffers.push(await fetchBytes(new URL(buf.uri, baseUrl).href));
    }
  }
  return { json, buffers };
}

// ============================== accessors =================================

const COMPONENT = {
  5120: { ctor: Int8Array, size: 1, norm: 127, get: (dv, o) => dv.getInt8(o) },
  5121: { ctor: Uint8Array, size: 1, norm: 255, get: (dv, o) => dv.getUint8(o) },
  5122: { ctor: Int16Array, size: 2, norm: 32767, get: (dv, o) => dv.getInt16(o, true) },
  5123: { ctor: Uint16Array, size: 2, norm: 65535, get: (dv, o) => dv.getUint16(o, true) },
  5125: { ctor: Uint32Array, size: 4, norm: 0, get: (dv, o) => dv.getUint32(o, true) },
  5126: { ctor: Float32Array, size: 4, norm: 0, get: (dv, o) => dv.getFloat32(o, true) }
};
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function meshoptExt(bv) {
  return bv.extensions && (bv.extensions.EXT_meshopt_compression || bv.extensions.KHR_meshopt_compression);
}

function bufferViewBytes(model, bvIdx) {
  if (model.meshoptCache.has(bvIdx)) return model.meshoptCache.get(bvIdx);
  const bv = model.json.bufferViews[bvIdx];
  const buf = model.buffers[bv.buffer];
  if (!buf) throw new Error(`Buffer ${bv.buffer} is missing (meshopt fallback or empty GLB).`);
  const start = bv.byteOffset || 0;
  return buf.subarray(start, start + bv.byteLength);
}

function readAccessor(model, idx) {
  const acc = model.json.accessors[idx];
  if (acc.bufferView === undefined) throw new Error("Sparse / zero-filled accessors are not supported.");
  if (acc.sparse) throw new Error("Sparse accessors are not supported.");
  const bv = model.json.bufferViews[acc.bufferView];
  const bytes = bufferViewBytes(model, acc.bufferView);
  const ci = COMPONENT[acc.componentType];
  if (!ci) throw new Error(`Unknown componentType: ${acc.componentType}`);
  const comps = TYPE_COUNT[acc.type];
  const tight = comps * ci.size;
  const stride = bv.byteStride || tight;
  const start = acc.byteOffset || 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw = new ci.ctor(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) raw[i * comps + c] = ci.get(dv, start + i * stride + c * ci.size);
  }
  if (acc.normalized && ci.norm) {
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = Math.max(-1, raw[i] / ci.norm);
    return out;
  }
  return raw;
}

async function decodeMeshopt(model, meshopt) {
  const bvs = model.json.bufferViews || [];
  for (let i = 0; i < bvs.length; i++) {
    const ext = meshoptExt(bvs[i]);
    if (!ext) continue;
    if (!meshopt) throw new Error("Model uses meshopt compression but no meshopt decoder is loaded.");
    await meshopt.ready;
    const src = model.buffers[ext.buffer];
    if (!src) throw new Error("Meshopt source buffer missing.");
    const start = ext.byteOffset || 0;
    const decoded = await meshopt.decodeGltfBufferAsync(
      ext.count, ext.byteStride, src.subarray(start, start + ext.byteLength), ext.mode, ext.filter || "NONE"
    );
    model.meshoptCache.set(i, decoded);
  }
}

async function decodeDraco(model, prim, getDraco) {
  if (!getDraco) throw new Error("Model uses Draco compression but no Draco decoder is loaded.");
  const ext = prim.extensions.KHR_draco_mesh_compression;
  const data = bufferViewBytes(model, ext.bufferView);
  const draco = await getDraco();
  const decoder = new draco.Decoder();
  const buffer = new draco.DecoderBuffer();
  const mesh = new draco.Mesh();
  try {
    buffer.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
    const geometryType = decoder.GetEncodedGeometryType(buffer);
    if (geometryType !== draco.TRIANGULAR_MESH) {
      throw new Error(`Draco primitive is not a triangular mesh (type ${geometryType}, ${data.byteLength} bytes).`);
    }
    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!status.ok()) throw new Error(`Draco decode failed: ${status.error_msg()}`);

    const readFloatAttr = (uniqueId, comps) => {
      if (uniqueId === undefined) return null;
      const attr = decoder.GetAttributeByUniqueId(mesh, uniqueId);
      const n = mesh.num_points() * comps;
      const arr = new draco.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(mesh, attr, arr);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = arr.GetValue(i);
      draco.destroy(arr);
      return out;
    };
    const positions = readFloatAttr(ext.attributes.POSITION, 3);
    if (!positions) throw new Error("Draco primitive missing POSITION.");
    const uvs = readFloatAttr(ext.attributes.TEXCOORD_0, 2);

    const faces = mesh.num_faces();
    const indices = new Uint32Array(faces * 3);
    const face = new draco.DracoInt32Array();
    for (let i = 0; i < faces; i++) {
      decoder.GetFaceFromMesh(mesh, i, face);
      indices[i * 3] = face.GetValue(0);
      indices[i * 3 + 1] = face.GetValue(1);
      indices[i * 3 + 2] = face.GetValue(2);
    }
    draco.destroy(face);
    return { positions, indices, uvs };
  } finally {
    draco.destroy(mesh);
    draco.destroy(buffer);
    draco.destroy(decoder);
  }
}

// ============================== matrices ==================================

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Column-major 4x4 (glTF convention).
function mul(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i + k * 4] * b[k + j * 4];
      o[i + j * 4] = s;
    }
  }
  return o;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1
  ];
}

function det3(m) {
  return (
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2])
  );
}

// Triangle vertex index triples for TRIANGLES (4), STRIP (5), FAN (6).
function triangleIndexList(mode, count, indexAt) {
  const out = [];
  if (mode === 4) {
    for (let i = 0; i + 2 < count; i += 3) out.push(indexAt(i), indexAt(i + 1), indexAt(i + 2));
  } else if (mode === 5) {
    for (let i = 0; i + 2 < count; i++) {
      if (i % 2 === 0) out.push(indexAt(i), indexAt(i + 1), indexAt(i + 2));
      else out.push(indexAt(i + 1), indexAt(i), indexAt(i + 2));
    }
  } else if (mode === 6) {
    for (let i = 1; i + 1 < count; i++) out.push(indexAt(0), indexAt(i), indexAt(i + 1));
  }
  return out;
}

/**
 * Walk the default scene and return world-space triangles:
 * { positions: number[] (9 per tri), uvs: number[] | null (6 per tri), materials: Set }
 */
export async function extractTriangles(model, options = {}, decoders = {}) {
  const { json } = model;
  model.meshoptCache = model.meshoptCache || new Map();
  await decodeMeshopt(model, decoders.meshopt);

  const nodes = json.nodes || [];
  const meshes = json.meshes || [];
  let roots;
  const scene = (json.scenes || [])[json.scene ?? 0];
  if (scene && scene.nodes) {
    roots = scene.nodes;
  } else {
    // No scene: every node that is nobody's child is a root.
    const children = new Set(nodes.flatMap((n) => n.children || []));
    roots = nodes.map((_, i) => i).filter((i) => !children.has(i));
  }

  let root = IDENTITY;
  if (options.rotateYupToZup) {
    // +90 deg around X: (x, y, z) -> (x, -z, y)
    root = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
  }
  if (options.scale && options.scale !== 1) {
    const s = options.scale;
    root = mul([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1], root);
  }

  const positions = [];
  let uvs = [];
  const materials = new Set();
  const texCoordFor = (matIdx) => {
    const tex = json.materials?.[matIdx]?.pbrMetallicRoughness?.baseColorTexture;
    return tex ? tex.texCoord || 0 : 0;
  };

  const walk = async (nodeIdx, parent) => {
    const node = nodes[nodeIdx];
    const world = mul(parent, nodeMatrix(node));
    const mirrored = det3(world) < 0;
    if (node.mesh !== undefined) {
      for (const prim of meshes[node.mesh].primitives || []) {
        const mode = prim.mode ?? 4;
        if (mode < 4) continue; // points / lines
        let pos;
        let idx = null;
        let uv = null;
        if (prim.extensions && prim.extensions.KHR_draco_mesh_compression) {
          ({ positions: pos, indices: idx, uvs: uv } = await decodeDraco(model, prim, decoders.getDraco));
        } else {
          if (prim.attributes?.POSITION === undefined) continue;
          pos = readAccessor(model, prim.attributes.POSITION);
          if (prim.indices !== undefined) idx = readAccessor(model, prim.indices);
          const uvAttr = prim.attributes[`TEXCOORD_${texCoordFor(prim.material)}`];
          if (uvAttr !== undefined) uv = readAccessor(model, uvAttr);
        }
        materials.add(prim.material ?? -1);
        const count = idx ? idx.length : pos.length / 3;
        const list = triangleIndexList(mode, count, idx ? (i) => idx[i] : (i) => i);
        if (!uv) uvs = null;
        for (let t = 0; t < list.length; t += 3) {
          const tri = mirrored ? [list[t], list[t + 2], list[t + 1]] : [list[t], list[t + 1], list[t + 2]];
          for (const v of tri) {
            const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
            positions.push(
              world[0] * x + world[4] * y + world[8] * z + world[12],
              world[1] * x + world[5] * y + world[9] * z + world[13],
              world[2] * x + world[6] * y + world[10] * z + world[14]
            );
            if (uvs) uvs.push(uv[v * 2], uv[v * 2 + 1]);
          }
        }
      }
    }
    for (const child of node.children || []) await walk(child, world);
  };
  for (const r of roots) await walk(r, root);
  return { positions, uvs: uvs && uvs.length ? uvs : null, materials, triangleCount: positions.length / 9 };
}

// ============================== STL =======================================

export function exportStl(tris) {
  const n = tris.triangleCount;
  const out = new Uint8Array(84 + n * 50);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("Keys_Osi STL export").subarray(0, 80));
  dv.setUint32(80, n, true);
  const p = tris.positions;
  let o = 84;
  for (let t = 0; t < n; t++) {
    const b = t * 9;
    const ux = p[b + 3] - p[b], uy = p[b + 4] - p[b + 1], uz = p[b + 5] - p[b + 2];
    const vx = p[b + 6] - p[b], vy = p[b + 7] - p[b + 1], vz = p[b + 8] - p[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) { nx /= len; ny /= len; nz /= len; } else { nx = ny = nz = 0; }
    for (const value of [nx, ny, nz, ...p.slice(b, b + 9)]) {
      dv.setFloat32(o, value, true);
      o += 4;
    }
    o += 2; // attribute byte count = 0
  }
  return out;
}

// ============================== 3MF =======================================

/** baseColor texture of the single textured material, png/jpeg only. */
export function extractBaseColorTexture(model, materials) {
  const { json } = model;
  if (materials.size !== 1) return null;
  const [matIdx] = materials;
  const texRef = json.materials?.[matIdx]?.pbrMetallicRoughness?.baseColorTexture;
  if (!texRef) return null;
  const tex = json.textures?.[texRef.index];
  const image = json.images?.[tex?.source];
  if (!image) return null;
  let bytes;
  if (image.bufferView !== undefined) bytes = bufferViewBytes(model, image.bufferView);
  else if (image.uri && image.uri.startsWith("data:")) bytes = dataUriToBytes(image.uri);
  else return null;
  let mimeType = null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) mimeType = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) mimeType = "image/jpeg";
  if (!mimeType) return null; // webp / ktx2 are not valid 3MF textures
  return { bytes: new Uint8Array(bytes), mimeType, extension: mimeType === "image/png" ? "png" : "jpg" };
}

const f6 = (v) => (Math.round(v * 1e6) / 1e6).toString();

export async function exportThreeMf(tris, texture) {
  const textured = Boolean(texture && tris.uvs);
  const index = new Map();
  const verts = [];
  const coords = [];
  const vid = (t, k) => {
    const b = t * 9 + k * 3;
    const pos = [tris.positions[b], tris.positions[b + 1], tris.positions[b + 2]];
    const uv = textured ? [tris.uvs[t * 6 + k * 2], tris.uvs[t * 6 + k * 2 + 1]] : null;
    const key = pos.map(f6).join(",") + (uv ? `|${uv.map(f6).join(",")}` : "");
    let i = index.get(key);
    if (i === undefined) {
      i = verts.length;
      index.set(key, i);
      verts.push(pos);
      if (uv) coords.push(uv);
    }
    return i;
  };
  const triIdx = [];
  for (let t = 0; t < tris.triangleCount; t++) triIdx.push([vid(t, 0), vid(t, 1), vid(t, 2)]);

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"',
    textured ? ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"' : "",
    ">\n  <resources>\n"
  ];
  const texPath = textured ? `/3D/Textures/baseColor.${texture.extension}` : null;
  if (textured) {
    parts.push(`    <m:texture2d id="1" path="${texPath}" contenttype="${texture.mimeType}" tilestyleu="wrap" tilestylev="wrap"/>\n`);
    parts.push('    <m:texture2dgroup id="2" texid="1">\n');
    for (const [u, v] of coords) parts.push(`      <m:tex2coord u="${f6(u)}" v="${f6(1 - v)}"/>\n`);
    parts.push("    </m:texture2dgroup>\n");
  }
  const objectId = textured ? 3 : 1;
  parts.push(`    <object id="${objectId}" type="model"${textured ? ' pid="2" pindex="0"' : ""}>\n      <mesh>\n        <vertices>\n`);
  for (const [x, y, z] of verts) parts.push(`          <vertex x="${f6(x)}" y="${f6(y)}" z="${f6(z)}"/>\n`);
  parts.push("        </vertices>\n        <triangles>\n");
  for (const [a, b, c] of triIdx) {
    parts.push(
      textured
        ? `          <triangle v1="${a}" v2="${b}" v3="${c}" pid="2" p1="${a}" p2="${b}" p3="${c}"/>\n`
        : `          <triangle v1="${a}" v2="${b}" v3="${c}"/>\n`
    );
  }
  parts.push(`        </triangles>\n      </mesh>\n    </object>\n  </resources>\n  <build>\n    <item objectid="${objectId}"/>\n  </build>\n</model>\n`);

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
    (textured ? `  <Default Extension="${texture.extension}" ContentType="${texture.mimeType}"/>\n` : "") +
    "</Types>\n";
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
    "</Relationships>\n";

  const enc = new TextEncoder();
  const entries = [
    { path: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { path: "_rels/.rels", data: enc.encode(rels) },
    { path: "3D/3dmodel.model", data: enc.encode(parts.join("")) }
  ];
  if (textured) {
    const modelRels =
      '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      `  <Relationship Target="${texPath}" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture"/>\n` +
      "</Relationships>\n";
    entries.push({ path: "3D/_rels/3dmodel.model.rels", data: enc.encode(modelRels) });
    entries.push({ path: texPath.slice(1), data: texture.bytes });
  }
  return createZip(entries);
}

// ============================== top level =================================

/**
 * bytes: GLB or glTF JSON. target: "stl" | "3mf".
 * options: { baseUrl, fetchBytes, rotateYupToZup = true, scale = 1000, includeTexture = true, decoders }
 */
export async function convertModel(bytes, target, options = {}) {
  const opts = { rotateYupToZup: true, scale: 1000, includeTexture: true, ...options };
  const model = await loadGltf(bytes, opts);
  const tris = await extractTriangles(model, opts, opts.decoders || {});
  if (tris.triangleCount === 0) throw new Error("No triangles extracted (empty model or points/lines only).");
  let texture = null;
  if (target === "3mf" && opts.includeTexture) texture = extractBaseColorTexture(model, tris.materials);
  let out;
  if (target === "stl") out = exportStl(tris);
  else if (target === "3mf") out = await exportThreeMf(tris, texture);
  else throw new Error(`Unsupported target format: ${target}`);
  return { bytes: out, triangleCount: tris.triangleCount, hasTexture: Boolean(texture && tris.uvs) };
}
