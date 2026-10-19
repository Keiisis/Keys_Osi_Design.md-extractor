/**
 * Keys_Osi 3D hub (service worker side).
 *
 * - Passive network capture (webRequest, non-blocking): every response
 *   per tab goes into a capped log; 3D models are classified by URL,
 *   content-type and size.
 * - On-demand page scan: DOM references + Resource Timing entries catch
 *   models loaded before capture started (or while the worker slept).
 * - Magic-byte identification (8 KB range fetch) and GLB/glTF -> STL/3MF
 *   conversion in the offscreen document (WebAssembly decoders, blobs).
 *
 * State lives in memory and is mirrored to chrome.storage.session so it
 * survives the MV3 worker going idle.
 */
import {
  CONVERTIBLE_FORMATS,
  classifyRequest,
  detectFormat,
  detectFromBytes,
  extractFilename,
  findSiblingGltf,
  modelFilename,
  renameWithExtension
} from "./lib/model-detect.mjs";

const LOG_LIMIT = 600;
const STORE_KEY = "keysOsi3d";
const tabs = new Map(); // tabId -> { requests: [], models: [] }

function tabState(tabId) {
  if (!tabs.has(tabId)) tabs.set(tabId, { requests: [], models: [] });
  return tabs.get(tabId);
}

// Restore after a worker restart; in-memory entries captured meanwhile win.
const restored = chrome.storage.session
  .get(STORE_KEY)
  .then((data) => {
    for (const [id, saved] of Object.entries(data[STORE_KEY] || {})) {
      const live = tabState(Number(id));
      const liveUrls = new Set(live.requests.map((r) => r.url));
      live.requests = [...saved.requests.filter((r) => !liveUrls.has(r.url)), ...live.requests].slice(-LOG_LIMIT);
      const modelUrls = new Set(live.models.map((m) => m.url));
      live.models = [...saved.models.filter((m) => !modelUrls.has(m.url)), ...live.models];
    }
  })
  .catch(() => {});

let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.session.set({ [STORE_KEY]: Object.fromEntries(tabs) }).catch(() => {});
  }, 800);
}

function updateBadge(tabId) {
  const count = tabs.get(tabId)?.models.length || 0;
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#7c3aed" }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" }).catch(() => {});
}

function addModel(tabId, model) {
  const state = tabState(tabId);
  const existing = state.models.find((m) => m.url === model.url);
  if (existing) {
    // A better signal (network headers) upgrades a DOM/perf guess.
    if (existing.size == null && model.size != null) existing.size = model.size;
    if (existing.confidence !== "verified" && model.confidence === "high") existing.confidence = "high";
    return;
  }
  state.models.push(model);
  updateBadge(tabId);
  persistSoon();
}

// User preference (3D view toggle): ask where to save, or save silently.
async function askWhereToSave() {
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  return keysOsiSaveAs !== false;
}

function header(headers, name) {
  return (headers || []).find((h) => h.name.toLowerCase() === name)?.value || "";
}

/* ---------------- passive capture ---------------- */

// Guarded: if the permission is not active yet (extension updated but not
// reloaded), the rest of the worker must keep running; the page scan
// (Resource Timing) still finds models.
export const CAPTURE_ACTIVE = Boolean(chrome.webRequest?.onResponseStarted);

CAPTURE_ACTIVE && chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    if (details.tabId < 0 || /^(chrome|chrome-extension|data|blob):/.test(details.url)) return;
    const contentType = header(details.responseHeaders, "content-type").split(";")[0].trim();
    const lengthHeader = Number.parseInt(header(details.responseHeaders, "content-length"), 10);
    const size = Number.isFinite(lengthHeader) ? lengthHeader : null;
    const verdict = classifyRequest(details.url, contentType, size);
    const state = tabState(details.tabId);
    state.requests.push({
      url: details.url,
      method: details.method,
      type: details.type,
      status: details.statusCode,
      contentType,
      size,
      fromCache: Boolean(details.fromCache),
      flagged: verdict.isModel
    });
    if (state.requests.length > LOG_LIMIT) state.requests.splice(0, state.requests.length - LOG_LIMIT);
    if (verdict.isModel) {
      addModel(details.tabId, {
        url: details.url,
        filename: extractFilename(details.url, verdict.format),
        format: verdict.format,
        size,
        contentType,
        confidence: verdict.confidence,
        source: "network"
      });
    }
    persistSoon();
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  persistSoon();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // New top-level document: start a fresh log (subframe loads keep it).
  if (changeInfo.status === "loading" && changeInfo.url) {
    tabs.set(tabId, { requests: [], models: [] });
    updateBadge(tabId);
    persistSoon();
  }
});

/* ---------------- on-demand page scan ---------------- */

// Runs in the page (isolated world). Self-contained: no closures.
function scanPageForModels() {
  const EXT = /\.(glb|gltf|m3f|3mf|fbx|obj|usdz|usdc|usd|stl|ply|dae|3ds|blend|x3d|vrml|wrl|drc|splinecode)(?:[?#]|$)/i;
  const found = new Set();
  const add = (value) => {
    if (!value) return;
    try {
      const url = new URL(String(value).trim(), document.baseURI).href;
      if (/^https?:/.test(url)) found.add(url);
    } catch (e) {}
  };
  const viewers = "model-viewer, spline-viewer, a-asset-item, a-gltf-model, [data-model], [data-glb], [data-gltf], [data-model-src], [data-src], [data-url], a[href], source[src], iframe[src]";
  for (const el of document.querySelectorAll(viewers)) {
    for (const attr of ["src", "url", "ios-src", "href", "data-model", "data-glb", "data-gltf", "data-model-src", "data-src", "data-url", "gltf-model"]) {
      const value = el.getAttribute(attr);
      if (value && (EXT.test(value) || el.matches("model-viewer, spline-viewer"))) add(value);
    }
  }
  const inline = /https?:\/\/[^\s"'<>()\\]+?\.(?:glb|gltf|3mf|fbx|obj|usdz|stl|ply|dae|splinecode|drc)(?:\?[^\s"'<>()\\]*)?/gi;
  for (const script of document.querySelectorAll("script:not([src])")) {
    for (const match of (script.textContent || "").slice(0, 400000).match(inline) || []) add(match);
  }
  // Everything the page already downloaded (Resource Timing).
  const resources = [];
  for (const entry of performance.getEntriesByType("resource")) {
    resources.push({
      url: entry.name,
      type: entry.initiatorType,
      size: entry.encodedBodySize || entry.transferSize || null,
      status: entry.responseStatus || null
    });
    if (EXT.test(entry.name)) add(entry.name);
  }
  return { urls: Array.from(found), resources };
}

async function scanTab(tabId) {
  await restored;
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: scanPageForModels
  });
  const state = tabState(tabId);
  const knownUrls = new Set(state.requests.map((r) => r.url));
  let added = 0;
  for (const { result } of results) {
    if (!result) continue;
    for (const resource of result.resources) {
      if (knownUrls.has(resource.url) || /^(data|blob):/.test(resource.url)) continue;
      knownUrls.add(resource.url);
      const verdict = classifyRequest(resource.url, "", resource.size);
      state.requests.push({
        url: resource.url,
        // Resource Timing does not expose the method: unknown, not "GET".
        method: null,
        type: resource.type || "other",
        status: resource.status,
        contentType: "",
        size: resource.size,
        fromCache: false,
        flagged: verdict.isModel,
        origin: "timing"
      });
    }
    for (const url of result.urls) {
      const before = state.models.length;
      const format = detectFormat(url) || "unknown";
      addModel(tabId, {
        url,
        filename: extractFilename(url, format),
        format,
        size: null,
        contentType: "",
        confidence: "dom",
        source: "dom"
      });
      added += state.models.length - before;
    }
  }
  if (state.requests.length > LOG_LIMIT) state.requests.splice(0, state.requests.length - LOG_LIMIT);
  persistSoon();
  return { added, total: state.models.length };
}

/* ---------------- identification + conversion ---------------- */

async function identifyModel(tabId, url) {
  let bytes;
  let total = null;
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-8191" }, credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const range = response.headers.get("content-range");
    total = range ? Number(range.split("/")[1]) : Number(response.headers.get("content-length")) || null;
    bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, 8192);
  } catch (error) {
    return { result: { format: "unknown", confidence: "none", hint: `Fetch failed: ${error.message}` } };
  }
  const result = detectFromBytes(bytes, total);
  const state = tabState(tabId);
  const model = state.models.find((m) => m.url === url);
  const real = !["unknown", "bin", "json", "xml", "zip"].includes(result.format);
  if (model) {
    model.detected = result;
    if (total && !model.size) model.size = total;
    if (real && result.confidence !== "low") {
      model.format = result.format;
      model.filename = renameWithExtension(model.filename, result.format);
      model.confidence = "verified";
    }
    persistSoon();
  }
  const siblingGltf = result.format === "bin" || result.format === "drc" ? findSiblingGltf(state.requests, url) : null;
  return { result, siblingGltf };
}

function flagModel(tabId, url) {
  const state = tabState(tabId);
  const request = state.requests.find((r) => r.url === url);
  const format = detectFormat(url, request?.contentType) || "unknown";
  if (request) request.flagged = true;
  addModel(tabId, {
    url,
    filename: extractFilename(url, format),
    format,
    size: request?.size ?? null,
    contentType: request?.contentType || "",
    confidence: "manual",
    source: "manual"
  });
}

/**
 * Message router for the popup's 3D tab. Returns a promise, or null when
 * the message is not a 3D message.
 */
export function handle3dMessage(message, { buildInOffscreen, revokeLater }) {
  const tabId = Number(message.tabId);
  switch (message.type) {
    case "MODELS_STATE":
      return restored.then(() => {
        const state = tabState(tabId);
        return {
          models: state.models,
          requests: message.withRequests ? state.requests : undefined,
          requestCount: state.requests.length,
          captureActive: CAPTURE_ACTIVE
        };
      });
    case "MODELS_SCAN":
      return scanTab(tabId);
    case "MODELS_CLEAR":
      return restored.then(() => {
        tabs.set(tabId, { requests: message.keepRequests ? tabState(tabId).requests : [], models: [] });
        updateBadge(tabId);
        persistSoon();
        return {};
      });
    case "MODEL_FLAG":
      return restored.then(() => {
        flagModel(tabId, message.url);
        return {};
      });
    case "MODEL_IDENTIFY":
      return restored.then(() => identifyModel(tabId, message.url));
    case "MODEL_DOWNLOAD":
      return askWhereToSave().then((saveAs) => chrome.downloads
        .download({
          url: message.url,
          // The popup sends the (possibly identify-renamed) model filename.
          // Inspector downloads keep their own name/extension; models get a model extension.
          filename: message.keepName
            ? String(message.filename || "fichier").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120) || "fichier"
            : modelFilename(message.filename, message.format),
          saveAs,
          conflictAction: "uniquify"
        })
        .then((downloadId) => ({ downloadId })));
    case "MODEL_PREVIEW":
      // Raw geometry (no slicer rotation/scale) as an STL blob the popup reads.
      if (!CONVERTIBLE_FORMATS.has(message.format)) return Promise.reject(new Error("Aperçu disponible pour GLB et glTF."));
      return buildInOffscreen({
        type: "KEYS_OSI_CONVERT_MODEL",
        url: message.url,
        outputFormat: "stl",
        options: { rotateYupToZup: false, scale: 1 }
      }).then(({ blobUrl, triangleCount }) => ({ blobUrl, triangleCount }));
    case "MODEL_CONVERT":
      return (async () => {
        if (!CONVERTIBLE_FORMATS.has(message.format)) throw new Error("Seuls GLB et glTF sont convertibles.");
        const target = message.target === "3mf" ? "3mf" : "stl";
        const result = await buildInOffscreen({
          type: "KEYS_OSI_CONVERT_MODEL",
          url: message.url,
          outputFormat: target, // not "target": that key routes the message
          options: { rotateYupToZup: message.rotateYupToZup !== false, scale: message.scale ?? 1000 }
        });
        const filename = renameWithExtension(extractFilename(message.url, message.format), target);
        const downloadId = await chrome.downloads.download({ url: result.blobUrl, filename, saveAs: await askWhereToSave(), conflictAction: "uniquify" });
        revokeLater(downloadId, result.blobUrl);
        return { triangleCount: result.triangleCount, hasTexture: result.hasTexture, filename };
      })();
    default:
      return null;
  }
}
