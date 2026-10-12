/**
 * Keys_Osi model viewer: a tiny WebGL renderer for binary STL bytes
 * (produced from GLB/glTF by the offscreen converter). Orbit by dragging,
 * zoom with the wheel, auto-rotation until the user takes over.
 */

function parseStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  const normals = new Float32Array(count * 9);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++) {
    const o = 84 + t * 50;
    const n = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
    for (let v = 0; v < 3; v++) {
      for (let k = 0; k < 3; k++) {
        const value = view.getFloat32(o + 12 + v * 12 + k * 4, true);
        positions[t * 9 + v * 3 + k] = value;
        normals[t * 9 + v * 3 + k] = n[k];
        if (value < min[k]) min[k] = value;
        if (value > max[k]) max[k] = value;
      }
    }
  }
  return { positions, normals, count, min, max };
}

const VERTEX = `
attribute vec3 aPos; attribute vec3 aNormal;
uniform mat4 uMvp; uniform mat4 uModel;
varying vec3 vNormal;
void main() { vNormal = mat3(uModel) * aNormal; gl_Position = uMvp * vec4(aPos, 1.0); }`;
const FRAGMENT = `
precision mediump float;
varying vec3 vNormal;
uniform vec3 uBase; uniform vec3 uRim;
void main() {
  vec3 n = normalize(vNormal);
  float key = max(dot(n, normalize(vec3(0.4, 0.8, 0.6))), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.6, 0.2, -0.4))), 0.0) * 0.35;
  float rim = pow(1.0 - abs(n.z), 2.5) * 0.55;
  vec3 color = uBase * (0.28 + key * 0.8 + fill) + uRim * rim;
  gl_FragColor = vec4(color, 1.0);
}`;

function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + i] * b[j * 4 + k];
    o[j * 4 + i] = s;
  }
  return o;
}
function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function rotation(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ry = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
  const rx = new Float32Array([1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1]);
  return mat4Mul(rx, ry);
}
function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = fallback;
  ctx.fillStyle = value || fallback;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

/** Renders STL bytes into `canvas`; returns { destroy, triangles }. */
export function mountModelViewer(canvas, stlBytes) {
  const gl = canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL indisponible.");
  const mesh = parseStl(stlBytes);
  const compile = (type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = (data, attr) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, attr);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  };
  buffer(mesh.positions, "aPos");
  buffer(mesh.normals, "aNormal");
  const uMvp = gl.getUniformLocation(program, "uMvp");
  const uModel = gl.getUniformLocation(program, "uModel");
  gl.uniform3fv(gl.getUniformLocation(program, "uBase"), cssColor("--color-accent", "#d4a94c"));
  gl.uniform3fv(gl.getUniformLocation(program, "uRim"), cssColor("--color-accent-2", "#ff6a4d"));
  gl.enable(gl.DEPTH_TEST);

  const center = mesh.min.map((v, i) => -(v + mesh.max[i]) / 2);
  const radius = Math.max(1e-6, Math.hypot(...mesh.max.map((v, i) => v - mesh.min[i])) / 2);
  const state = { yaw: 0.6, pitch: 0.35, distance: radius * 2.6, auto: true, drag: null };
  let frame = 0;

  const draw = () => {
    const w = canvas.clientWidth * devicePixelRatio;
    const h = canvas.clientHeight * devicePixelRatio;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (state.auto) state.yaw += 0.006;
    const model = mat4Mul(rotation(state.yaw, state.pitch), translation(...center));
    const view = translation(0, 0, -state.distance);
    const mvp = mat4Mul(perspective(0.8, w / h, radius / 100, radius * 20), mat4Mul(view, model));
    gl.uniformMatrix4fv(uMvp, false, mvp);
    gl.uniformMatrix4fv(uModel, false, model);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count * 3);
    frame = requestAnimationFrame(draw);
  };

  const onDown = (e) => {
    state.auto = false;
    state.drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!state.drag) return;
    state.yaw = state.drag.yaw + (e.clientX - state.drag.x) * 0.01;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.drag.pitch + (e.clientY - state.drag.y) * 0.01));
  };
  const onUp = () => {
    state.drag = null;
  };
  const onWheel = (e) => {
    e.preventDefault();
    state.distance = Math.max(radius * 0.6, Math.min(radius * 12, state.distance * (1 + Math.sign(e.deltaY) * 0.1)));
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) state.auto = false;
  draw();

  return {
    triangles: mesh.count,
    destroy() {
      cancelAnimationFrame(frame);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
}
