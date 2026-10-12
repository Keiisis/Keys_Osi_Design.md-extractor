/**
 * Offscreen document: assembles the site clone ZIP.
 *
 * The MV3 service worker cannot use URL.createObjectURL, so the ZIP is
 * built here. Remote assets are fetched with a small concurrency pool
 * (host permissions make cross-origin fetches readable), generated
 * files arrive as text or base64, and the resulting archive is exposed
 * as a blob URL that the service worker hands to chrome.downloads.
 */
import { createZip } from "../lib/zip.mjs";
import { diffMask, ssimFromRgba } from "../lib/fidelity.mjs";
import { convertModel } from "../lib/glb-convert.mjs";
import { runAiPromptPro } from "../lib/generate-prompt-pro.mjs";
import { cancelSiteCrawl, startSiteCrawl } from "./site-crawler.js";

// Draco / meshopt decoders are classic scripts loaded by offscreen.html.
let dracoModule = null;
const decoders = {
  meshopt: globalThis.MeshoptDecoder,
  getDraco: () =>
    (dracoModule ||= globalThis.DracoDecoderModule({
      locateFile: (path) => chrome.runtime.getURL(`lib/vendor/${path}`)
    }))
};

async function fetchBytes(url) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} on ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function convertModelToBlob({ url, outputFormat: target, options }) {
  const bytes = await fetchBytes(url);
  const result = await convertModel(bytes, target, { ...options, baseUrl: url, fetchBytes, decoders });
  const type = target === "3mf" ? "model/3mf" : "model/stl";
  const blobUrl = URL.createObjectURL(new Blob([result.bytes], { type }));
  activeBlobUrls.add(blobUrl);
  return { blobUrl, triangleCount: result.triangleCount, hasTexture: result.hasTexture };
}

const activeBlobUrls = new Set();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen") {
    return;
  }

  if (message.type === "KEYS_OSI_BUILD_ZIP") {
    buildZip(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message.type === "KEYS_OSI_PRO_RUN") {
    // Acknowledge at once; the generation may take minutes (no MV3 worker
    // time limit here) and reports back with PRO_RESULT.
    sendResponse({ ok: true });
    let lastSent = 0;
    runAiPromptPro({
      messages: message.messages,
      settings: message.settings,
      fetchImpl: fetch,
      onProgress: (chars, reasoning, round) => {
        if (Date.now() - lastSent < 400) return;
        lastSent = Date.now();
        chrome.runtime
          .sendMessage({ type: "PRO_PROGRESS", step: chars > 0 ? "stream" : "think", chars, reasoning, round })
          .catch(() => {});
      }
    })
      .then((result) =>
        chrome.runtime.sendMessage({ type: "PRO_RESULT", jobId: message.jobId, ok: true, ...result })
      )
      .catch((error) =>
        chrome.runtime.sendMessage({
          type: "PRO_RESULT",
          jobId: message.jobId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      )
      .catch(() => {});
    return;
  }

  if (message.type === "KEYS_OSI_CROP") {
    cropToJpeg(message)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "KEYS_OSI_SITE_CRAWL") {
    // Acknowledged at once: the crawl reports with SITE_PROGRESS / SITE_RESULT.
    startSiteCrawl(message);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "KEYS_OSI_SITE_CANCEL") {
    sendResponse({ ok: true, cancelled: cancelSiteCrawl(message.jobId) });
    return;
  }

  if (message.type === "KEYS_OSI_CONVERT_MODEL") {
    convertModelToBlob(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "KEYS_OSI_COMPARE") {
    comparePairs(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "KEYS_OSI_SSIM") {
    computeSsim(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message.type === "KEYS_OSI_REVOKE_ZIP") {
    if (message.blobUrl && activeBlobUrls.has(message.blobUrl)) {
      URL.revokeObjectURL(message.blobUrl);
      activeBlobUrls.delete(message.blobUrl);
    }
    sendResponse({ ok: true });
    return;
  }
});

/** Crops a screenshot to a CSS-pixel rectangle and returns a compact JPEG data URL. */
async function cropToJpeg({ dataUrl, rect, dpr = 1, maxWidth = 720 }) {
  const bitmap = await loadBitmap(dataUrl);
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.width * dpr)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.height * dpr)));
  const scale = Math.min(1, maxWidth / sw);
  const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Lecture de la capture impossible."));
    reader.readAsDataURL(blob);
  });
}

async function buildZip(message) {
  const files = Array.isArray(message.files) ? message.files : [];
  const encoder = new TextEncoder();
  const entries = [];
  const failures = [];

  const remote = [];
  for (const file of files) {
    if (!file || !file.path) {
      continue;
    }
    if (typeof file.content === "string") {
      entries.push({ path: file.path, data: encoder.encode(file.content) });
    } else if (typeof file.base64 === "string") {
      try {
        entries.push({ path: file.path, data: base64ToBytes(file.base64) });
      } catch (error) {
        failures.push({ path: file.path, reason: "invalid base64" });
      }
    } else if (typeof file.url === "string") {
      remote.push(file);
    }
  }

  await fetchWithPool(remote, 6, async (file) => {
    try {
      const response = await fetch(file.url, { credentials: "omit" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      entries.push({ path: file.path, data: new Uint8Array(buffer) });
    } catch (error) {
      failures.push({
        path: file.path,
        reason: error instanceof Error ? error.message : "fetch failed"
      });
    }
  });

  if (entries.length === 0) {
    throw new Error("No files could be added to the archive.");
  }

  const zipBytes = await createZip(entries);
  const blob = new Blob([zipBytes], { type: "application/zip" });
  const blobUrl = URL.createObjectURL(blob);
  activeBlobUrls.add(blobUrl);

  return {
    blobUrl,
    fileCount: entries.length,
    byteLength: zipBytes.length,
    failures: failures.slice(0, 25)
  };
}

// Structural similarity between two screenshots (baseline vs reproduction).
// Both are decoded, drawn to a common canvas size, and compared.
async function computeSsim({ baselineDataUrl, compareDataUrl }) {
  const [imgA, imgB] = await Promise.all([
    loadBitmap(baselineDataUrl),
    loadBitmap(compareDataUrl)
  ]);
  // Common comparison size — cap for speed, preserve the baseline aspect ratio.
  const width = Math.min(1024, imgA.width);
  const height = Math.round((width / imgA.width) * imgA.height);

  const rgbaA = drawToRgba(imgA, width, height);
  const rgbaB = drawToRgba(imgB, width, height);
  const score = ssimFromRgba(rgbaA, rgbaB, width, height);
  return { score, width, height };
}

async function loadBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

function drawToRgba(bitmap, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

async function fetchWithPool(items, poolSize, worker) {
  const queue = [...items];
  const runners = [];
  for (let i = 0; i < Math.min(poolSize, queue.length); i++) {
    runners.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item) {
            await worker(item);
          }
        }
      })()
    );
  }
  await Promise.all(runners);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Section-by-section comparison of two pages → scores + heatmaps + HTML report.
async function comparePairs({ pairs, meta }) {
  const sections = [];
  for (const [index, pair] of pairs.entries()) {
    const [imgA, imgB] = await Promise.all([loadBitmap(pair.ref), loadBitmap(pair.cand)]);
    const width = Math.min(960, imgA.width);
    const height = Math.round((width / imgA.width) * imgA.height);
    const rgbaA = drawToRgba(imgA, width, height);
    const rgbaB = drawToRgba(imgB, width, height);
    const score = ssimFromRgba(rgbaA, rgbaB, width, height);
    const { ratio, mask } = diffMask(rgbaA, rgbaB, width, height);
    // Heatmap: reproduction in faded grey, differing pixels in signal red.
    const heat = new OffscreenCanvas(width, height);
    const ctx = heat.getContext("2d");
    const out = ctx.createImageData(width, height);
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const grey = 0.299 * rgbaB[p] + 0.587 * rgbaB[p + 1] + 0.114 * rgbaB[p + 2];
      const faded = 200 + grey * 0.2;
      out.data[p] = mask[i] ? 235 : faded;
      out.data[p + 1] = mask[i] ? 48 : faded;
      out.data[p + 2] = mask[i] ? 72 : faded;
      out.data[p + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    const heatmap = await blobToDataUrl(await heat.convertToBlob({ type: "image/png" }));
    sections.push({ index, y: pair.y, score, diffRatio: ratio, ref: pair.ref, cand: pair.cand, heatmap });
  }
  const overall = sections.reduce((sum, s) => sum + s.score, 0) / Math.max(1, sections.length);
  const html = renderCompareReport({ sections, overall, meta });
  const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  activeBlobUrls.add(blobUrl);
  return {
    blobUrl,
    overall,
    sections: sections.map(({ index, y, score, diffRatio }) => ({ index, y, score, diffRatio }))
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function renderCompareReport({ sections, overall, meta }) {
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pct = (v) => `${Math.round(v * 1000) / 10} %`;
  const rows = sections
    .map(
      (s) => `<section><h2>Section ${s.index + 1} <small>y = ${s.y}px · similarité ${pct(s.score)} · pixels différents ${pct(s.diffRatio)}</small></h2>
<div class="grid"><figure><img src="${s.ref}" alt=""><figcaption>Référence</figcaption></figure><figure><img src="${s.cand}" alt=""><figcaption>Reproduction</figcaption></figure><figure><img src="${s.heatmap}" alt=""><figcaption>Écarts</figcaption></figure></div></section>`
    )
    .join("\n");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Keys_Osi — fidélité</title><style>
body{margin:0;padding:32px;background:#16120c;color:#f3ede2;font:15px/1.5 system-ui,sans-serif}
h1{font:400 40px/1.1 Georgia,serif;margin:0 0 6px}h2{font:600 16px/1.3 system-ui;margin:28px 0 10px}small{font-weight:400;opacity:.65;margin-left:8px}
.score{font:600 64px/1 Georgia,serif;background:linear-gradient(90deg,#f1c96b,#ff7a59);-webkit-background-clip:text;color:transparent}
.meta{opacity:.7}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
figure{margin:0}img{width:100%;border-radius:10px;border:1px solid #3a3123}figcaption{font-size:12px;opacity:.6;margin-top:4px}
</style></head><body><h1>Rapport de fidélité Keys_Osi</h1>
<p class="meta">Référence : ${esc(meta.refUrl)}<br>Reproduction : ${esc(meta.candUrl)}<br>${esc(new Date().toLocaleString("fr-FR"))}</p>
<div class="score">${pct(overall)}</div><p class="meta">similarité structurelle moyenne (SSIM) sur ${sections.length} section(s)</p>
${rows}</body></html>`;
}
