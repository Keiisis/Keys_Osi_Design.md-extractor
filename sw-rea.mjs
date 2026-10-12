/**
 * Keys_Osi advanced reverse engineering, service worker side: talks to the
 * Keys_Osi native host (native-host/) which drives REA and a private
 * headless Chrome. Progress events are relayed to the popup; the last
 * analysis is kept for the popup and for TECH_STACK.md.
 */
import { buildReaReport } from "./lib/rea-report.mjs";

export const REA_KEY = "keysOsiLastRea";
const HOST_NAME = "com.keysosi.host";
const INSTALL_HINT = "Hôte Keys_Osi non installé. Dans le dossier de l'extension, lance une fois : node native-host/install.mjs — puis recharge l'extension.";

let port = null;
let nextId = 1;
const pending = new Map();

function friendly(message) {
  if (/forbidden/i.test(message || "")) {
    return `Hôte Keys_Osi installé mais cette extension n'est pas autorisée (identifiant ${chrome.runtime.id}). Lance : node native-host/install.mjs ${chrome.runtime.id} — puis recharge l'extension.`;
  }
  return /not found|not installed|Specified native messaging host/i.test(message || "") ? INSTALL_HINT : message || "Hôte Keys_Osi déconnecté.";
}

function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener((message) => {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    if (message.progress) {
      chrome.runtime.sendMessage({ type: "REA_PROGRESS", ...message.progress }).catch(() => {});
      return;
    }
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.ok) waiter.resolve(message.result);
    else waiter.reject(new Error(message.error || "Échec REA."));
  });
  port.onDisconnect.addListener(() => {
    const reason = friendly(chrome.runtime.lastError?.message);
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    pending.clear();
    port = null;
  });
  return port;
}

function call(method, params = {}, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`REA n'a pas terminé « ${method} » en ${Math.round(timeoutMs / 60000)} min.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      connect().postMessage({ id, method, params });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error(friendly(error.message)));
    }
  });
}

async function analyzeTab(message) {
  const tab = await chrome.tabs.get(Number(message.tabId));
  if (!/^https?:/i.test(tab.url || "")) throw new Error("Ouvre le site à analyser (http/https).");
  const result = await call("analyze_url", { url: tab.url, sourceMaps: message.sourceMaps !== false, accessibility: Boolean(message.accessibility), storageKeys: Boolean(message.storageKeys) });
  const record = { url: tab.url, origin: new URL(tab.url).origin, dir: result.dir, files: result.files, summary: result.summary, at: new Date().toISOString() };
  await chrome.storage.local.set({ [REA_KEY]: record });
  return record;
}

async function downloadReport() {
  const { [REA_KEY]: record } = await chrome.storage.local.get(REA_KEY);
  if (!record) throw new Error("Lance d'abord une analyse REA.");
  const text = buildReaReport(record.summary, { url: record.url, dir: record.dir });
  const name = new URL(record.url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  await chrome.downloads.download({ url: `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`, filename: `${name}_REA_REPORT.md`, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
  return { filename: `${name}_REA_REPORT.md` };
}

/** REA findings for TECH_STACK.md when they belong to the same site. */
export async function reaSectionFor(origin) {
  const { [REA_KEY]: record } = await chrome.storage.local.get(REA_KEY);
  if (!record || record.origin !== origin) return "";
  return buildReaReport(record.summary, { url: record.url, dir: record.dir }).replace(/^# REA_REPORT\.md[^\n]*\n/, "## Advanced reverse engineering (REA)\n");
}

export function handleReaMessage(message) {
  switch (message.type) {
    case "REA_STATUS":
      return call("status", {}, 5 * 60 * 1000).then((status) => ({ status, extensionId: chrome.runtime.id }));
    case "REA_ANALYZE":
      return analyzeTab(message);
    case "REA_LAST":
      return chrome.storage.local.get(REA_KEY).then((data) => ({ record: data[REA_KEY] || null }));
    case "REA_REPORT":
      return downloadReport();
    case "REA_TOOLS":
      return call("list_tools", {}, 5 * 60 * 1000);
    case "REA_SCHEMA":
      return call("tool_schema", { name: message.name }, 60000);
    case "REA_CALL":
      return call("call_tool", { name: message.name, arguments: message.args || {}, useBrowser: Boolean(message.useBrowser), url: message.url || "" });
    case "REA_FILE":
      return call("analyze_file", { name: message.name, base64: message.base64 });
    case "REA_OPEN":
      return call("open_path", { path: message.path || "" }, 30000);
    default:
      return null;
  }
}
