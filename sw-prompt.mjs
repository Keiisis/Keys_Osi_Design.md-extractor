/**
 * Keys_Osi prompt extractor, service worker side: injects prompt-probe.js
 * into the page (MAIN world, so framework globals such as __NUXT__ are
 * readable), returns what the page already rendered, and exports the
 * collected prompts as .txt / .md / .json / .csv.
 *
 * Distinct from lib/generate-prompt-md.mjs (PROMPT.md / PROMPT_PRO.md),
 * which writes prompts FOR a coding agent from measured design data.
 */

const MODES = { PROMPT_SCAN: "collect", PROMPT_DEEP_SCAN: "deep", PROMPT_PICK: "pick" };

async function probe(tabId, mode) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!/^(https?|file):/i.test(tab.url || "")) throw new Error("Ouvre une page web (http/https) à extraire.");
  const target = { tabId: tab.id };
  await chrome.scripting.executeScript({ target, world: "MAIN", func: (m) => { window.__KOE_MODE__ = m; }, args: [mode] });
  const [{ result } = {}] = await chrome.scripting.executeScript({ target, world: "MAIN", files: ["prompt-probe.js"] });
  if (!result) throw new Error("La page n'a pas répondu à la sonde.");
  return result;
}

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function formatPrompts(items, format, host = "page") {
  const date = new Date().toISOString().slice(0, 10);
  const list = Array.isArray(items) ? items : [];
  switch (format) {
    case "json":
      return {
        ext: "json",
        mime: "application/json",
        content: JSON.stringify({ host, date, count: list.length, items: list }, null, 2)
      };
    case "md":
      return {
        ext: "md",
        mime: "text/markdown",
        content:
          `# Prompts — ${host} — ${date}\n\n` +
          list.map((it, i) => `## ${i + 1}. ${it.source} · ${it.confidence || "?"} · ${it.chars} car.\n\n\`\`\`\n${it.text}\n\`\`\``).join("\n\n") +
          "\n"
      };
    case "csv":
      return {
        ext: "csv",
        mime: "text/csv",
        content:
          ["index", "source", "confidence", "chars", "text"].map(csvCell).join(",") +
          "\r\n" +
          list.map((it, i) => [i + 1, it.source, it.confidence, it.chars, it.text].map(csvCell).join(",")).join("\r\n") +
          "\r\n"
      };
    case "txt":
    default:
      return {
        ext: "txt",
        mime: "text/plain",
        content: list.map((it, i) => `# Prompt ${i + 1} [${it.source}]\n${it.text}`).join("\n\n---\n\n") + "\n"
      };
  }
}

async function exportPrompts({ items, format, host, saveAs }) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Aucun prompt à exporter.");
  const { ext, mime, content } = formatPrompts(items, format, host);
  const safeHost = String(host || "page").replace(/[^a-z0-9.-]+/gi, "_").slice(0, 60);
  const downloadId = await chrome.downloads.download({
    url: `data:${mime};charset=utf-8,${encodeURIComponent(content)}`,
    filename: `prompts-${safeHost}-${new Date().toISOString().slice(0, 10)}.${ext}`,
    saveAs: saveAs !== false,
    conflictAction: "uniquify"
  });
  return { downloadId, count: items.length };
}

// While capture is on for a site, xhr-capture.js is also registered as a
// document_start content script for that origin: a reload (the natural way to
// replay a page's requests) re-arms it before the first request goes out.
const SCRIPT_PREFIX = "koe-net:";
const scriptId = (origin) => `${SCRIPT_PREFIX}${origin}`;
const registeredFor = (origin) => chrome.scripting.getRegisteredContentScripts({ ids: [scriptId(origin)] }).then((list) => list.length > 0, () => false);

async function armOrigin(origin) {
  if (await registeredFor(origin)) return;
  await chrome.scripting.registerContentScripts([{
    id: scriptId(origin),
    matches: [`${origin}/*`],
    js: ["xhr-capture.js"],
    runAt: "document_start",
    world: "MAIN",
    persistAcrossSessions: false
  }]).catch(() => { /* e.g. file:// without file access: in-page patch only */ });
}

const disarmOrigin = (origin) => chrome.scripting.unregisterContentScripts({ ids: [scriptId(origin)] }).catch(() => {});

// Last tab of a captured site closed: stop patching that site's future pages.
// (Guarded: formatPrompts is unit-tested under Node, where chrome is absent.)
globalThis.chrome?.tabs?.onRemoved.addListener(async () => {
  const scripts = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  for (const script of scripts) {
    if (!script.id.startsWith(SCRIPT_PREFIX)) continue;
    const origin = script.id.slice(SCRIPT_PREFIX.length);
    const open = await chrome.tabs.query({ url: `${origin}/*` }).catch(() => []);
    if (open.length === 0) await disarmOrigin(origin);
  }
});

async function netCapture(tabId, args) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!/^(https?|file):/i.test(tab.url || "")) throw new Error("Ouvre une page web (http/https).");
  const origin = /^https?:/i.test(tab.url) ? new URL(tab.url).origin : null;
  if (origin && args.mode === "start") await armOrigin(origin);
  if (origin && args.mode === "stop") await disarmOrigin(origin);
  const target = { tabId: tab.id };
  await chrome.scripting.executeScript({ target, world: "MAIN", func: (a) => { window.__KOE_NET_ARGS__ = a; }, args: [args] });
  const [{ result } = {}] = await chrome.scripting.executeScript({ target, world: "MAIN", files: ["xhr-capture.js"] });
  const out = result || {};
  if (args.mode === "status" && origin) out.armed = await registeredFor(origin);
  return out;
}

async function probeGet(tabId, url) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: Number(tabId) },
    world: "MAIN",
    func: async (u) => {
      try {
        // Default credentials: same-origin cookies go along, and cross-origin APIs
        // answering Access-Control-Allow-Origin: * are not refused by CORS.
        const res = await fetch(u, { method: "GET" });
        try { await res.body?.cancel(); } catch { /* headers were enough */ }
        return { ok: res.ok, status: res.status };
      } catch (error) { return { ok: false, status: 0, error: String(error?.message || error) }; }
    },
    args: [url]
  });
  return result || { ok: false, status: 0 };
}

const replayHint = (active) => (active
  ? "Capture active : recharge la page (F5) pour que cette requête soit enregistrée, puis retélécharge."
  : "Active « Capturer les corps », recharge la page (F5), puis retélécharge.");

const parseMaybe = (s) => { if (typeof s !== "string") return s ?? null; try { return JSON.parse(s); } catch { return s; } };
const safeName = (name) => String(name || "fichier").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120) || "fichier";

// Inspector download. A POST/PUT/PATCH endpoint cannot be re-fetched by URL
// (chrome.downloads issues a GET → 404/405, "fichier non disponible"), so the
// body must come from the live capture log. GET falls back to a plain download.
async function netBody({ tabId, url, method, filename, saveAs }) {
  const { entry, active } = await netCapture(tabId, { mode: "find", url });
  const name = safeName(filename);
  const where = saveAs !== false;
  if (!entry) {
    // Unknown method (Resource Timing row) or GET: check from the page that a GET
    // works before handing the URL to chrome.downloads, whose own failure bubble
    // (« fichier non disponible ») says nothing about why.
    if (!method || /^GET$/i.test(method)) {
      const probe = await probeGet(tabId, url);
      if (!probe.ok) {
        throw new Error(`GET ${probe.status ? `HTTP ${probe.status}` : `impossible (${probe.error || "réseau"})`} sur cette URL : le site l'appelle avec ses propres en-têtes (authentification, clé d'API). ${replayHint(active)}`);
      }
      const downloadId = await chrome.downloads.download({ url, filename: name, saveAs: where, conflictAction: "uniquify" });
      return { downloadId, captured: false, unknownMethod: !method, status: probe.status };
    }
    throw new Error(`Requête ${method} : un téléchargement par URL refait un GET et échoue. ${replayHint(active)}`);
  }
  const bundle = [{
    url: entry.url,
    method: entry.method,
    status: entry.status,
    contentType: entry.contentType || null,
    requestBody: parseMaybe(entry.requestBody),
    responseBody: parseMaybe(entry.responseBody)
  }];
  const content = JSON.stringify(bundle, null, 2);
  const downloadId = await chrome.downloads.download({
    url: `data:application/json;charset=utf-8,${encodeURIComponent(content)}`,
    filename: `${name.replace(/\.[a-z0-9]{1,5}$/i, "")}.xhr.json`,
    saveAs: where,
    conflictAction: "uniquify"
  });
  return { downloadId, captured: true, bytes: content.length };
}

export function handlePromptMessage(message) {
  if (MODES[message.type]) return probe(message.tabId, MODES[message.type]);
  if (message.type === "PROMPT_EXPORT") return exportPrompts(message);
  if (message.type === "PROMPT_NET_START") return netCapture(message.tabId, { mode: "start" });
  if (message.type === "PROMPT_NET_STOP") return netCapture(message.tabId, { mode: "stop" });
  if (message.type === "PROMPT_NET_STATUS") return netCapture(message.tabId, { mode: "status" });
  if (message.type === "PROMPT_NET_READ") return netCapture(message.tabId, { mode: "read", since: message.since || 0, doc: message.doc || null });
  if (message.type === "NET_BODY") return netBody(message);
  return null;
}
