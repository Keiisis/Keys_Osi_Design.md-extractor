// Keys_Osi: exports the live three.js scenes of the page as one GLB.
// Runs in the page world (executeScript world: MAIN). World transforms are
// baked into the vertices, instances are expanded, base colors and color
// maps are kept. Evaluates to a Promise of a summary (and the bytes as
// base64 when window.__keysOsiExportReturnBytes is set, for tests).
(async () => {
  const registry = window.__keysOsiThree;
  const scenes = (registry?.scenes || []).map((ref) => ref.deref()).filter(Boolean);
  if (scenes.length === 0) {
    return {
      ok: false,
      error: registry
        ? "Aucune scène three.js vivante sur cette page."
        : "Hook three.js absent : recharge la page avec Keys_Osi actif, puis réessaie."
    };
  }

  const nodes = [];
  const meshes = [];
  const accessors = [];
  const bufferViews = [];
  const materials = [];
  const images = [];
  const textures = [];
  const chunks = [];
  let byteLength = 0;
  const materialIndex = new Map();
  let triangles = 0;

  const pushView = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = (bytes.byteLength + 3) & ~3;
    const copy = new Uint8Array(padded);
    copy.set(bytes);
    chunks.push(copy);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    byteLength += padded;
    return bufferViews.length - 1;
  };
  const pushAccessor = (typed, type, componentType, count, extra = {}) => {
    accessors.push({ bufferView: pushView(typed, extra.target), componentType, count, type, ...extra.meta });
    return accessors.length - 1;
  };

  async function imageBytes(image) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.width || image.videoWidth || 1;
      canvas.height = image.height || image.videoHeight || 1;
      canvas.getContext("2d").drawImage(image, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      return new Uint8Array(await blob.arrayBuffer());
    } catch (e) {
      return null; // tainted (cross-origin) or unsupported image
    }
  }

  async function materialFor(material) {
    const m = Array.isArray(material) ? material[0] : material;
    if (!m) return undefined;
    if (materialIndex.has(m)) return materialIndex.get(m);
    const color = m.color ? [m.color.r, m.color.g, m.color.b, m.opacity ?? 1] : [0.8, 0.8, 0.8, 1];
    const pbr = { baseColorFactor: color, metallicFactor: m.metalness ?? 0, roughnessFactor: m.roughness ?? 1 };
    if (m.map?.image) {
      const bytes = await imageBytes(m.map.image);
      if (bytes) {
        images.push({ bufferView: pushView(bytes), mimeType: "image/png" });
        textures.push({ source: images.length - 1 });
        pbr.baseColorTexture = { index: textures.length - 1 };
      }
    }
    materials.push({ name: m.name || m.type, pbrMetallicRoughness: pbr, doubleSided: m.side === 2 });
    materialIndex.set(m, materials.length - 1);
    return materials.length - 1;
  }

  async function exportMesh(mesh, matrix) {
    const geometry = mesh.geometry;
    const position = geometry?.attributes?.position;
    if (!position) return;
    const normalAttr = geometry.attributes.normal;
    const uvAttr = geometry.attributes.uv;
    const e = matrix.elements;
    // Normal matrix ≈ upper 3x3 of the world matrix (re-normalized below).
    const count = position.count;
    const pos = new Float32Array(count * 3);
    const nor = normalAttr ? new Float32Array(count * 3) : null;
    const uv = uvAttr ? new Float32Array(count * 2) : null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      pos[i * 3] = wx; pos[i * 3 + 1] = wy; pos[i * 3 + 2] = wz;
      min[0] = Math.min(min[0], wx); min[1] = Math.min(min[1], wy); min[2] = Math.min(min[2], wz);
      max[0] = Math.max(max[0], wx); max[1] = Math.max(max[1], wy); max[2] = Math.max(max[2], wz);
      if (nor) {
        const nx = normalAttr.getX(i), ny = normalAttr.getY(i), nz = normalAttr.getZ(i);
        let tx = e[0] * nx + e[4] * ny + e[8] * nz;
        let ty = e[1] * nx + e[5] * ny + e[9] * nz;
        let tz = e[2] * nx + e[6] * ny + e[10] * nz;
        const len = Math.hypot(tx, ty, tz) || 1;
        nor[i * 3] = tx / len; nor[i * 3 + 1] = ty / len; nor[i * 3 + 2] = tz / len;
      }
      if (uv) {
        uv[i * 2] = uvAttr.getX(i);
        uv[i * 2 + 1] = uvAttr.getY(i);
      }
    }
    const attributes = {
      POSITION: pushAccessor(pos, "VEC3", 5126, count, { target: 34962, meta: { min, max } })
    };
    if (nor) attributes.NORMAL = pushAccessor(nor, "VEC3", 5126, count, { target: 34962 });
    if (uv) attributes.TEXCOORD_0 = pushAccessor(uv, "VEC2", 5126, count, { target: 34962 });
    const primitive = { attributes, mode: 4 };
    if (geometry.index) {
      const index = new Uint32Array(geometry.index.count);
      for (let i = 0; i < index.length; i++) index[i] = geometry.index.getX(i);
      primitive.indices = pushAccessor(index, "SCALAR", 5125, index.length, { target: 34963 });
      triangles += index.length / 3;
    } else {
      triangles += count / 3;
    }
    const mat = await materialFor(mesh.material);
    if (mat !== undefined) primitive.material = mat;
    meshes.push({ name: mesh.name || mesh.type, primitives: [primitive] });
    nodes.push({ name: mesh.name || `mesh-${meshes.length}`, mesh: meshes.length - 1 });
  }

  for (const scene of scenes) {
    scene.updateMatrixWorld(true);
    const queue = [scene];
    while (queue.length) {
      const object = queue.shift();
      queue.push(...(object.children || []));
      if (!object.isMesh || object.visible === false) continue;
      if (object.isInstancedMesh) {
        // Expand instances: world = mesh world × instance matrix.
        const instance = object.matrixWorld.clone();
        for (let i = 0; i < object.count; i++) {
          const local = object.matrixWorld.clone();
          object.getMatrixAt(i, instance);
          local.multiply(instance);
          await exportMesh(object, local);
        }
      } else {
        await exportMesh(object, object.matrixWorld);
      }
    }
  }
  if (meshes.length === 0) return { ok: false, error: "Scène trouvée mais aucun mesh exportable." };

  const json = {
    asset: { version: "2.0", generator: "Keys_Osi scene export" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
    ...(materials.length ? { materials } : {}),
    ...(images.length ? { images, textures } : {})
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = (jsonBytes.byteLength + 3) & ~3;
  const total = 12 + 8 + jsonPadded + 8 + byteLength;
  const glb = new Uint8Array(total);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonBytes, 20);
  glb.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonPadded);
  let offset = 20 + jsonPadded;
  view.setUint32(offset, byteLength, true);
  view.setUint32(offset + 4, 0x004e4942, true);
  offset += 8;
  for (const chunk of chunks) {
    glb.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const summary = { ok: true, scenes: scenes.length, meshes: meshes.length, triangles, bytes: total, revision: registry.revision };
  if (window.__keysOsiExportReturnBytes) {
    let binary = "";
    for (let i = 0; i < glb.length; i += 0x8000) binary += String.fromCharCode(...glb.subarray(i, i + 0x8000));
    return { ...summary, base64: btoa(binary) };
  }
  const url = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `${(document.title || "scene").replace(/[^\w-]+/g, "_").slice(0, 40) || "scene"}-keys-osi.glb` });
  document.documentElement.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return summary;
})();
