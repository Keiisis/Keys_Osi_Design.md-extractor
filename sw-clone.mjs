/**
 * Keys_Osi code clone, service worker side: measures the tab at each width
 * through the debugger (shared with the responsive capture), reads every
 * stylesheet through CDP for @font-face rules and media queries, checks
 * which images and fonts can be downloaded, then zips the React + Tailwind
 * project built by lib/code-clone.mjs.
 */
import { buildCloneProject, cloneWidths, collectCloneAssets, fontFamiliesUsed, parseFontFaces } from "./lib/code-clone.mjs";
import { parseBreakpoints } from "./lib/responsive.mjs";
import { cdp, withViewports } from "./sw-responsive.mjs";

export const CLONE_KEY = "keysOsiLastClone";
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;

const progress = (message) => chrome.runtime.sendMessage({ type: "CODE_CLONE_PROGRESS", message }).catch(() => {});

/** Media queries and @font-face rules of every stylesheet (cross-origin included). */
async function readStylesheets(target, pageUrl) {
  const sheets = [];
  const onEvent = (source, method, params) => {
    if (source.tabId === target.tabId && method === "CSS.styleSheetAdded") sheets.push(params.header);
  };
  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await cdp(target, "DOM.enable");
    await cdp(target, "CSS.enable");
    const { medias = [] } = await cdp(target, "CSS.getMediaQueries").catch(() => ({}));
    const fontFaces = [];
    for (const header of sheets) {
      try {
        const { text } = await cdp(target, "CSS.getStyleSheetText", { styleSheetId: header.styleSheetId });
        if (/@font-face/i.test(text)) fontFaces.push(...parseFontFaces(text, header.sourceURL || pageUrl));
      } catch (error) {}
    }
    return { mediaTexts: medias.map((media) => media.text).filter(Boolean), fontFaces };
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    await cdp(target, "CSS.disable").catch(() => {});
    await cdp(target, "DOM.disable").catch(() => {});
  }
}

async function reachable(url) {
  if (url.startsWith("data:")) return url.length < MAX_ASSET_BYTES * 1.4 ? 0 : -1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { credentials: "omit", signal: controller.signal });
    const length = Number(response.headers.get("content-length") || 0);
    response.body?.cancel().catch(() => {});
    if (!response.ok || length > MAX_ASSET_BYTES) return -1;
    return length;
  } catch (error) {
    return -1;
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, size, worker) {
  let index = 0;
  const run = async () => {
    while (index < items.length) await worker(items[index++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

/** data: URL → zip entry content. */
function dataEntry(path, url) {
  const match = url.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!match) return null;
  return match[2] ? { path, base64: match[3] } : { path, content: decodeURIComponent(match[3]) };
}

async function clone(message, deps) {
  const tabId = Number(message.tabId);
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/i.test(tab.url || "")) throw new Error("Ouvre une page web pour la cloner en code.");
  progress("Défilement de la page (images différées, apparitions au scroll)…");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["clone-probe.js"] });
  await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__keysOsiClone.prepare() });
  let css = { mediaTexts: [], fontFaces: [] };
  let widths = [];
  await withViewports(
    tabId,
    [],
    async ({ width }) => {
      progress(`Mesure des styles à ${width}px…`);
      await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__keysOsiClone.measure() });
    },
    {
      onAttached: async (target) => {
        css = await readStylesheets(target, tab.url);
        widths = cloneWidths(parseBreakpoints(css.mediaTexts).all);
        return widths;
      }
    }
  );
  const [{ result: capture }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__keysOsiClone.finish() });

  const used = fontFamiliesUsed(capture);
  const fontFaces = css.fontFaces.filter((face) => used.has(face.family.toLowerCase()));
  const assets = collectCloneAssets(capture, fontFaces);
  progress(`Vérification de ${assets.length} fichiers (images, polices)…`);
  const assetPaths = new Map();
  const entries = [];
  let total = 0;
  await pool(assets, 6, async (asset) => {
    const size = await reachable(asset.url);
    if (size < 0 || total + size > MAX_TOTAL_BYTES) return;
    total += size;
    assetPaths.set(asset.url, asset.path);
    entries.push(asset.url.startsWith("data:") ? dataEntry(asset.path, asset.url) : { path: asset.path, url: asset.url });
  });

  progress("Génération du projet React + Tailwind…");
  const breakpoints = parseBreakpoints(css.mediaTexts).all;
  const project = buildCloneProject(capture, { breakpoints, fontFaces, assetPaths, widths });
  const host = new URL(tab.url).hostname.replace(/^www\./, "");
  const folder = `${host.replace(/[^a-z0-9]+/gi, "-")}-react`;
  const files = [...project.files.map((file) => ({ path: `${folder}/${file.path}`, content: file.content })), ...entries.filter(Boolean).map((entry) => ({ ...entry, path: `${folder}/${entry.path}` }))];
  const zip = await deps.buildZip(files);
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  const filename = `${folder.replace(/-react$/, "")}_react-tailwind.zip`;
  const downloadId = await chrome.downloads.download({ url: zip.blobUrl, filename, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
  deps.revokeLater(downloadId, zip.blobUrl);
  const record = {
    url: tab.url,
    filename,
    fileCount: zip.fileCount,
    failedFiles: (zip.failures || []).length,
    stats: { ...project.stats, screens: project.stats.screens.map((screen) => `${screen.name}:${screen.px}`), assets: assetPaths.size, assetsTried: assets.length },
    createdAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [CLONE_KEY]: record });
  return record;
}

export function handleCloneMessage(message, deps) {
  switch (message.type) {
    case "CODE_CLONE":
      return clone(message, deps);
    case "CODE_CLONE_LAST":
      return chrome.storage.local.get(CLONE_KEY).then((data) => ({ record: data[CLONE_KEY] || null }));
    default:
      return null;
  }
}
