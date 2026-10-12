/**
 * Keys_Osi brand kit + moodboard, service worker side: storage, ZIP
 * exports, optional AI typeface identification of the logo, live try-on on
 * the active tab, and pins coming from Lens / the context menu.
 */
import { buildBrandKitFiles } from "./lib/brand-kit.mjs";
import { BOARD_KEY, addPins, buildMoodboardFiles, removePin } from "./lib/moodboard.mjs";
import { callAI } from "./lib/ai-client.mjs";

export const BRAND_KEY = "keysOsiBrandKit";

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function saveAs() {
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  return keysOsiSaveAs !== false;
}

async function readBoard() {
  const { [BOARD_KEY]: board } = await chrome.storage.local.get(BOARD_KEY);
  return Array.isArray(board) ? board : [];
}

let boardQueue = Promise.resolve();
function updateBoard(mutator) {
  boardQueue = boardQueue.then(async () => {
    const result = mutator(await readBoard());
    const board = Array.isArray(result) ? result : result.board;
    await chrome.storage.local.set({ [BOARD_KEY]: board });
    chrome.action.setBadgeBackgroundColor({ color: "#c9772a" }).catch(() => {});
    chrome.runtime.sendMessage({ type: "BOARD_CHANGED", count: board.length }).catch(() => {});
    return { board, added: result.added ?? 0 };
  });
  return boardQueue;
}

/** Visible-tab capture cropped to a rectangle (CSS px), as a small JPEG. */
async function captureSection(windowId, rect, dpr, deps) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const result = await deps.runInOffscreen({ type: "KEYS_OSI_CROP", dataUrl, rect, dpr: dpr || 1, maxWidth: 720 });
  return result.dataUrl;
}

async function pinSection(message, sender, deps) {
  const windowId = sender?.tab?.windowId;
  if (!windowId) throw new Error("Onglet source inconnu.");
  const image = await captureSection(windowId, message.rect, message.dpr, deps);
  const role = message.tag === "header" ? "header" : message.tag === "footer" ? "footer" : "section";
  return updateBoard((board) => addPins(board, [{ kind: "section", heading: message.heading || "", role, image, sourceUrl: message.sourceUrl || sender.tab.url }]));
}

/** Context menu "Épingler dans le moodboard": image, selected text or the section under the cursor. */
export async function handlePinContextMenu(info, tab, deps) {
  if (info.srcUrl && info.mediaType === "image") {
    return updateBoard((board) => addPins(board, [{ kind: "image", url: info.srcUrl, alt: "", sourceUrl: tab.url }]));
  }
  if (info.selectionText) {
    return updateBoard((board) => addPins(board, [{ kind: "text", text: info.selectionText.slice(0, 600), sourceUrl: tab.url }]));
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [info.frameId || 0] },
    func: () => {
      const target = window.__keysOsiContextTarget || document.body;
      const section = target.closest("section, header, footer, article, main > div, [class*='section' i]") || target;
      section.scrollIntoView({ block: "nearest" });
      const rect = section.getBoundingClientRect();
      return {
        rect: { x: rect.left, y: rect.top, width: rect.width, height: Math.min(rect.height, innerHeight) },
        dpr: devicePixelRatio,
        heading: (section.querySelector("h1, h2, h3")?.textContent || "").trim().slice(0, 120),
        tag: section.tagName.toLowerCase()
      };
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  return pinSection({ ...result, sourceUrl: tab.url }, { tab }, deps);
}

async function guessFont(message) {
  const { promptProSettings: settings = {} } = await chrome.storage.local.get("promptProSettings");
  if (!settings.apiKey) throw new Error("Clé API requise (onglet PROMPT PRO) pour identifier la police du logo.");
  const base64 = String(message.dataUrl || "").split(",")[1];
  if (!base64) throw new Error("Logo manquant.");
  const result = await callAI({
    provider: settings.provider,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.visionModel || "",
    maxTokens: 300,
    temperature: 0,
    messages: [
      { role: "system", text: "You identify typefaces in logos. Answer with JSON only: {\"family\": string|null, \"classification\": one of geometric-sans|humanist-sans|grotesque|neo-grotesque|slab|didone|old-style|transitional|script|display|mono, \"confidence\": 0-1}." },
      { role: "user", text: "Which typeface (or closest well-known family) is used in this logo's wordmark? If there is no text, family is null.", images: [{ mediaType: message.dataUrl.slice(5, message.dataUrl.indexOf(";")), base64 }] }
    ],
    fetchImpl: fetch
  });
  const json = String(result.content || "").match(/\{[\s\S]*\}/);
  if (!json) throw new Error("Réponse IA illisible.");
  const parsed = JSON.parse(json[0]);
  return { fontGuess: { family: parsed.family || null, classification: parsed.classification || null, confidence: Number(parsed.confidence) || 0 }, model: result.model };
}

async function fontFaces(files = [], family) {
  const faces = [];
  // Any upright weight the kit chose (a display face may only ship 800 or 900).
  for (const file of files.filter((entry) => (entry.style || "normal") === "normal").slice(0, 3)) {
    const response = await fetch(file.url);
    if (!response.ok) continue;
    faces.push({ weight: file.weight, style: "normal", base64: bytesToBase64(new Uint8Array(await response.arrayBuffer())) });
  }
  return faces.length ? { family, faces } : null;
}

async function tryOn(message) {
  const tabId = Number(message.tabId);
  await chrome.scripting.executeScript({ target: { tabId }, files: ["tryon.js"] });
  if (message.enable === false) {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__keysOsiTryOn.revert() });
    return { reverted: true };
  }
  let options;
  if (message.colorMap) {
    options = { colorMap: message.colorMap };
  } else {
    const { [BRAND_KEY]: stored } = await chrome.storage.local.get(BRAND_KEY);
    if (!stored?.kit) throw new Error("Crée d'abord ton Brand Kit (logo).");
    const { kit } = stored;
    const roles = kit.palette.roles;
    const chosen = kit.fonts.chosen;
    options = {
      colors: { primary: roles["brand.primary"], secondary: roles["brand.secondary"], accent: roles.accent },
      fonts: {
        // One superfamily for both roles ships its files once, under "body".
        display: await fontFaces(kit.files?.display?.length ? kit.files.display : chosen.display.id === chosen.body.id ? kit.files?.body : [], chosen.display.family),
        body: await fontFaces(kit.files?.body, chosen.body.family)
      }
    };
  }
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: (opts) => window.__keysOsiTryOn.apply(opts), args: [options] });
  return result;
}

async function brandZip(deps) {
  const { [BRAND_KEY]: stored } = await chrome.storage.local.get(BRAND_KEY);
  if (!stored?.kit) throw new Error("Crée d'abord ton Brand Kit (logo).");
  const files = buildBrandKitFiles(stored.kit, { logoDataUrl: stored.logoDataUrl || null, logoSvg: stored.logoSvg || null });
  const zip = await deps.buildZip(files);
  const name = String(stored.kit.name || "marque").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "marque";
  const filename = `${name}_brand-kit.zip`;
  const downloadId = await chrome.downloads.download({ url: zip.blobUrl, filename, saveAs: await saveAs(), conflictAction: "uniquify" });
  deps.revokeLater(downloadId, zip.blobUrl);
  return { filename, fileCount: zip.fileCount, skipped: zip.failures?.length || 0 };
}

async function boardZip(deps) {
  const board = await readBoard();
  if (!board.length) throw new Error("Le moodboard est vide : épingle d'abord des éléments (Lens : P / S, ou clic droit).");
  const zip = await deps.buildZip(buildMoodboardFiles(board));
  const filename = `keys-osi-moodboard-${new Date().toISOString().slice(0, 10)}.zip`;
  const downloadId = await chrome.downloads.download({ url: zip.blobUrl, filename, saveAs: await saveAs(), conflictAction: "uniquify" });
  deps.revokeLater(downloadId, zip.blobUrl);
  return { filename, fileCount: zip.fileCount };
}

export function handleBrandBoardMessage(message, sender, deps) {
  switch (message.type) {
    case "BRAND_SAVE":
      return chrome.storage.local.set({ [BRAND_KEY]: { kit: message.kit, logoDataUrl: message.logoDataUrl || null, logoSvg: message.logoSvg || null, savedAt: new Date().toISOString() } }).then(() => ({ saved: true }));
    case "BRAND_STATE":
      return chrome.storage.local.get(BRAND_KEY).then((data) => ({ brand: data[BRAND_KEY] || null }));
    case "BRAND_CLEAR":
      return chrome.storage.local.remove(BRAND_KEY).then(() => ({ cleared: true }));
    case "BRAND_ZIP":
      return brandZip(deps);
    case "BRAND_FONT_GUESS":
      return guessFont(message);
    case "BRAND_TRYON":
    case "A11Y_TRYON":
      return tryOn(message);
    case "BOARD_STATE":
      return readBoard().then((board) => ({ board }));
    case "BOARD_PIN":
      return updateBoard((board) =>
        addPins(
          board,
          (message.pins || []).map((pin) => ({ ...pin, sourceUrl: pin.sourceUrl || sender?.tab?.url || "" }))
        )
      ).then(({ board, added }) => ({ count: board.length, added }));
    case "BOARD_PIN_SECTION":
      return pinSection(message, sender, deps).then(({ board, added }) => ({ count: board.length, added }));
    case "BOARD_REMOVE":
      return updateBoard((board) => removePin(board, message.id)).then(({ board }) => ({ board }));
    case "BOARD_NOTE":
      return updateBoard((board) => board.map((item) => (item.id === message.id ? { ...item, note: String(message.note || "").slice(0, 200) } : item))).then(({ board }) => ({ board }));
    case "BOARD_CLEAR":
      return updateBoard(() => []).then(() => ({ board: [] }));
    case "BOARD_EXPORT":
      return boardZip(deps);
    default:
      return null;
  }
}
