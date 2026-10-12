// 3D model detection + GLB/glTF -> STL/3MF conversion on real assets
// (Khronos glTF sample "Box" / "BoxTextured", CC-BY 4.0, Cesium).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  classifyRequest,
  detectFormat,
  detectFromBytes,
  extractFilename,
  findSiblingGltf
} from "../lib/model-detect.mjs";
import { convertModel, exportStl, loadGltf, extractTriangles } from "../lib/glb-convert.mjs";

const require = createRequire(import.meta.url);
const fixture = (name) => readFile(new URL(`./fixtures/3d/${name}`, import.meta.url));

export async function loadDecoders() {
  const DracoDecoderModule = require("../lib/vendor/draco_wasm_wrapper.js");
  const MeshoptDecoder = require("../lib/vendor/meshopt_decoder.js");
  const wasmBinary = await readFile(new URL("../lib/vendor/draco_decoder.wasm", import.meta.url));
  let draco = null;
  return {
    meshopt: MeshoptDecoder,
    getDraco: () => (draco ||= DracoDecoderModule({ wasmBinary }))
  };
}

const readStlCount = (bytes) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);

/* ---------- detection ---------- */
assert.equal(detectFormat("https://cdn.x.com/a/scene.glb?v=3"), "glb");
assert.equal(detectFormat("https://prod.spline.design/abc/scene.splinecode"), "splinecode");
assert.equal(detectFormat("https://x.com/file", "model/gltf-binary"), "glb");
assert.equal(detectFormat("https://x.com/app.js", "application/javascript"), null, "js is not a model");
assert.equal(detectFormat("https://x.com/w.wrl"), "vrml");

// Heuristic must not flag hashed bundles / fonts served as octet-stream.
assert.equal(classifyRequest("https://x.com/assets/a3d9f.woff2", "application/octet-stream", 90_000).isModel, false);
assert.equal(classifyRequest("https://x.com/_next/static/3d1e2a.js", "", 200_000).isModel, false);
assert.equal(classifyRequest("https://x.com/models/hero", "application/octet-stream", 400_000).confidence, "low");
assert.equal(classifyRequest("https://x.com/models/hero", "application/octet-stream", 10_000).isModel, false);

assert.equal(extractFilename("https://x.com/a/my%20chair.glb"), "my chair.glb");
assert.equal(extractFilename("https://x.com/models/hero", "glb"), "hero.glb");
assert.equal(extractFilename("https://x.com/a/b:c", "unknown"), "b_c.bin", "Windows-safe filename");

const boxGlb = new Uint8Array(await fixture("Box.glb"));
assert.equal(detectFromBytes(boxGlb).format, "glb");
assert.equal(detectFromBytes(new Uint8Array(await fixture("BoxDraco.gltf"))).format, "gltf");
assert.equal(detectFromBytes(new Uint8Array(await fixture("Box.bin"))).format, "drc", "Draco bitstream buffer");
assert.equal(detectFromBytes(boxGlb.subarray(boxGlb.length - 600)).format, "bin", "raw vertex buffer");
assert.equal(detectFromBytes(new TextEncoder().encode("solid cube\n facet normal 0 0 1\n")).format, "stl");
assert.equal(detectFromBytes(new TextEncoder().encode("ply\nformat ascii 1.0\n")).format, "ply");
assert.equal(detectFromBytes(new TextEncoder().encode("# obj\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")).format, "obj");

// Binary STL whose header starts with "solid" (common exporter quirk) is
// identified by its exact size, not mistaken for ASCII.
const stlBin = new Uint8Array(84 + 50);
stlBin.set(new TextEncoder().encode("solid exported-by-cad"));
new DataView(stlBin.buffer).setUint32(80, 1, true);
assert.deepEqual(
  [detectFromBytes(stlBin, stlBin.length).format, detectFromBytes(stlBin, stlBin.length).confidence],
  ["stl", "high"]
);

assert.equal(
  findSiblingGltf([{ url: "https://x.com/m/Box.gltf" }, { url: "https://y.com/m/Other.gltf" }], "https://x.com/m/Box.bin"),
  "https://x.com/m/Box.gltf"
);

/* ---------- conversion ---------- */
const decoders = await loadDecoders();

// Plain GLB: a cube = 12 triangles.
const stl = await convertModel(boxGlb, "stl", { decoders });
assert.equal(stl.triangleCount, 12);
assert.equal(readStlCount(stl.bytes), 12);
assert.equal(stl.bytes.length, 84 + 12 * 50);

// Unit scale, no rotation: the Khronos box spans [-0.5, 0.5] (its root node
// rotates the cube; coordinates stay within half-unit bounds).
const tris = await extractTriangles(await loadGltf(boxGlb), { scale: 1 });
const maxAbs = Math.max(...tris.positions.map(Math.abs));
assert.ok(Math.abs(maxAbs - 0.5) < 1e-5, `box half-extent should be 0.5, got ${maxAbs}`);

// Outward normals: every STL normal points away from the box center.
const outward = (() => {
  const out = exportStl(tris);
  const dv = new DataView(out.buffer);
  for (let t = 0; t < 12; t++) {
    const o = 84 + t * 50;
    const n = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
    const c = [0, 1, 2].map((k) => (dv.getFloat32(o + 12 + k * 4, true) + dv.getFloat32(o + 24 + k * 4, true) + dv.getFloat32(o + 36 + k * 4, true)) / 3);
    if (n[0] * c[0] + n[1] * c[1] + n[2] * c[2] <= 0) return false;
  }
  return true;
})();
assert.ok(outward, "STL normals must point outward");

// Mirrored node (negative scale) keeps outward winding.
{
  const model = await loadGltf(boxGlb);
  model.json.nodes = [{ children: [1], scale: [-1, 1, 1] }, ...model.json.nodes.map((n) => ({ ...n, children: n.children?.map((c) => c + 1) }))];
  model.json.scenes = [{ nodes: [0] }];
  const mirrored = exportStl(await extractTriangles(model, { scale: 1 }));
  const dv = new DataView(mirrored.buffer);
  for (let t = 0; t < 12; t++) {
    const o = 84 + t * 50;
    const n = [0, 1, 2].map((k) => dv.getFloat32(o + k * 4, true));
    const c = [0, 1, 2].map((k) => (dv.getFloat32(o + 12 + k * 4, true) + dv.getFloat32(o + 24 + k * 4, true) + dv.getFloat32(o + 36 + k * 4, true)) / 3);
    assert.ok(n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0, "mirrored model normals must stay outward");
  }
}

// Draco-compressed .gltf with an EXTERNAL .bin buffer, resolved by URL.
const dracoGltf = new Uint8Array(await fixture("BoxDraco.gltf"));
const binBytes = new Uint8Array(await fixture("Box.bin"));
const fetched = [];
const draco = await convertModel(dracoGltf, "stl", {
  decoders,
  baseUrl: "https://cdn.example.com/models/BoxDraco.gltf",
  fetchBytes: async (url) => {
    fetched.push(url);
    return binBytes;
  }
});
assert.deepEqual(fetched, ["https://cdn.example.com/models/Box.bin"], "external buffer resolved next to the .gltf");
assert.equal(draco.triangleCount, 12, "Draco box decodes to 12 triangles");

// Textured 3MF: package parts + texture relationship.
const textured = await convertModel(new Uint8Array(await fixture("BoxTextured.glb")), "3mf", { decoders });
assert.equal(textured.triangleCount, 12);
assert.equal(textured.hasTexture, true);
const zipText = new TextDecoder("latin1").decode(textured.bytes);
for (const part of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model", "3D/_rels/3dmodel.model.rels", "3D/Textures/baseColor.png"]) {
  assert.ok(zipText.includes(part), `3MF must contain ${part}`);
}
assert.equal(textured.bytes[0], 0x50, "3MF is a ZIP");

// Plain 3MF (no texture requested).
const plain3mf = await convertModel(boxGlb, "3mf", { decoders });
assert.equal(plain3mf.hasTexture, false);
assert.ok(!new TextDecoder("latin1").decode(plain3mf.bytes).includes("Textures/"));

console.log("3D model tests passed.");
