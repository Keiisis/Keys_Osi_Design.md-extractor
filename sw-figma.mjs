/**
 * Keys_Osi Figma bridge (service worker side): imports a whole Figma file
 * through the REST API into the regular design pipeline (the imported
 * design becomes the "source" of DESIGN.md, SKILL.md, PROMPT_PRO…), and
 * exports a complete Figma kit ZIP (docs, per-screen files, renders, icons,
 * image fills, tokens).
 */
import { normalizeExtractedStyles } from "./lib/normalize.mjs";
import {
  buildFigmaStructure,
  fetchFigmaFile,
  fetchFigmaImages,
  figmaToPayload,
  generateFigmaStructureMarkdown,
  generateFrameMarkdown,
  parseFigmaUrl,
  planFigmaExports
} from "./lib/figma-import.mjs";
import { generateDesignMarkdown } from "./lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "./lib/generate-skill-md.mjs";
import { generateMotionMarkdown } from "./lib/generate-motion-md.mjs";
import { generatePromptMarkdown } from "./lib/generate-prompt-md.mjs";
import { generateDesignJson } from "./lib/generate-json-export.mjs";
import { generateCssVariables, generateTailwindConfig, generateW3cTokens } from "./lib/export-tokens.mjs";

export const FIGMA_SOURCE_KEY = "keysOsiLastFigma";
const TOKEN_KEY = "keysOsiFigmaToken";

function slug(text, fallback) {
  return (
    String(text || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || fallback
  );
}

/** Normalized design of the imported Figma file, or null. */
export async function figmaNormalized() {
  const { [FIGMA_SOURCE_KEY]: source } = await chrome.storage.local.get(FIGMA_SOURCE_KEY);
  return source?.normalized || null;
}

async function importFile(message) {
  const parsed = parseFigmaUrl(message.url);
  if (!parsed) throw new Error("Lien Figma invalide : colle l'URL d'un fichier (figma.com/design/…).");
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  const token = String(message.token || stored[TOKEN_KEY] || "").trim();
  if (!token) throw new Error("Jeton Figma requis : Figma → Settings → Security → Personal access tokens (lecture des fichiers).");
  if (message.token) await chrome.storage.local.set({ [TOKEN_KEY]: token });

  const progress = (step) => chrome.runtime.sendMessage({ type: "FIGMA_PROGRESS", ...step }).catch(() => {});
  const { file, imageFills, variables } = await fetchFigmaFile({
    fileKey: parsed.fileKey,
    token,
    nodeId: message.wholeFile ? null : parsed.nodeId,
    fetchImpl: fetch,
    onProgress: progress
  });
  progress({ step: "analyse", message: "Conversion en design system…" });
  return storeSource({ file, imageFills, variables, fileKey: parsed.fileKey, nodeId: parsed.nodeId, url: String(message.url), via: "api" });
}

/** Common end of every import route: design pipeline + stored source. */
async function storeSource({ file, imageFills = {}, variables = null, fileKey = "", nodeId = null, url = "", via, renders = [] }) {
  const payload = figmaToPayload(file, { variables, fileKey, url, imageFills });
  const normalized = normalizeExtractedStyles(payload);
  const structure = buildFigmaStructure(file, { variables });
  const plan = planFigmaExports(file, { maxFrames: 24 });
  const source = {
    fileKey,
    nodeId,
    url,
    via,
    name: file.name || "Figma",
    importedAt: new Date().toISOString(),
    normalized,
    structure,
    plan,
    imageFills: imageFills || {},
    renders
  };
  await chrome.storage.local.set({ [FIGMA_SOURCE_KEY]: source });
  return { summary: summarize(source), normalized };
}

/** File already decoded without the API (clipboard, .fig) by the popup. */
function importDecoded(message) {
  if (!message.file?.document) throw new Error("Données Figma illisibles.");
  return storeSource({ file: message.file, imageFills: message.imageFills || {}, fileKey: message.fileKey || "", url: message.url || "", via: message.via || "fig" });
}

/** Live figma.com tab: reads the open document through the page's own plugin API, when exposed. */
async function importLive(message) {
  const tab = await chrome.tabs.get(Number(message.tabId));
  if (!/^https:\/\/(www\.)?figma\.com\//.test(tab.url || "")) throw new Error("Ouvre le fichier dans un onglet figma.com.");
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["figma-live-probe.js"] });
  if (!result?.available) throw new Error(`Lecture directe indisponible sur cet onglet (${result?.reason || "API de page absente"}). Utilise le copier-coller des cadres ou un fichier .fig.`);
  return storeSource({ file: result.file, imageFills: result.imageFills || {}, url: tab.url, fileKey: parseFigmaUrl(tab.url)?.fileKey || "", via: "live", renders: result.renders || [] });
}

function summarize(source) {
  if (!source) return null;
  return {
    name: source.name,
    url: source.url,
    via: source.via || "api",
    importedAt: source.importedAt,
    ...source.structure.stats,
    icons: source.plan.icons.length
  };
}

async function exportKit(message, deps) {
  const { [FIGMA_SOURCE_KEY]: source } = await chrome.storage.local.get(FIGMA_SOURCE_KEY);
  if (!source) throw new Error("Importe d'abord un fichier Figma.");
  const name = slug(source.name, "figma");
  const context = { normalized: source.normalized };
  const structureMd = generateFigmaStructureMarkdown(source.structure, { fileName: source.name, url: source.url });
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");

  if (message.what === "structure") {
    await chrome.downloads.download({
      url: `data:text/markdown;charset=utf-8,${encodeURIComponent(structureMd)}`,
      filename: `${name}_FIGMA_STRUCTURE.md`,
      saveAs: keysOsiSaveAs !== false,
      conflictAction: "uniquify"
    });
    return { filename: `${name}_FIGMA_STRUCTURE.md` };
  }

  const files = [
    { path: "FIGMA_STRUCTURE.md", content: structureMd },
    { path: "DESIGN.md", content: generateDesignMarkdown(context) },
    { path: "SKILL.md", content: generateSkillMarkdown(context) },
    { path: "MOTION.md", content: generateMotionMarkdown(context) },
    { path: "PROMPT.md", content: generatePromptMarkdown(context) },
    { path: "tokens/design-system.json", content: JSON.stringify(generateDesignJson(source.normalized, { version: chrome.runtime.getManifest().version }), null, 2) },
    { path: "tokens/design.tokens.json", content: JSON.stringify(generateW3cTokens(source.normalized), null, 2) },
    { path: "tokens/tailwind.config.js", content: generateTailwindConfig(source.normalized) },
    { path: "tokens/tokens.css", content: generateCssVariables(source.normalized) }
  ];
  const usedNames = new Set();
  const screenPath = (screen) => {
    let base = slug(`${screen.page || ""}-${screen.name}`, "screen");
    for (let n = 2; usedNames.has(base); n++) base = `${slug(`${screen.page || ""}-${screen.name}`, "screen")}-${n}`;
    usedNames.add(base);
    return base;
  };
  const screenFiles = new Map();
  for (const page of source.structure.pages) {
    for (const screen of page.screens) {
      const base = screenPath(screen);
      screenFiles.set(screen.id, base);
      files.push({ path: `screens/${base}.md`, content: generateFrameMarkdown(screen) });
    }
  }

  // Renders: screens as PNG, icons as SVG, image fills as originals.
  let renderNote = "";
  for (const render of source.renders || []) {
    if (String(render.dataUrl || "").startsWith("data:image/")) files.push({ path: `renders/${slug(render.name, render.id)}.png`, base64: render.dataUrl.split(",")[1] });
  }
  if (message.renders !== false && source.via === "api") {
    const { [TOKEN_KEY]: token } = await chrome.storage.local.get(TOKEN_KEY);
    try {
      const frameUrls = await fetchFigmaImages({ fileKey: source.fileKey, token, ids: source.plan.frames.map((frame) => frame.id), format: "png", scale: 1, fetchImpl: fetch });
      for (const frame of source.plan.frames) {
        if (frameUrls[frame.id]) files.push({ path: `renders/${screenFiles.get(frame.id) || slug(frame.name, frame.id)}.png`, url: frameUrls[frame.id] });
      }
      const iconUrls = await fetchFigmaImages({ fileKey: source.fileKey, token, ids: source.plan.icons.map((icon) => icon.id), format: "svg", fetchImpl: fetch });
      const iconNames = new Set();
      for (const icon of source.plan.icons) {
        let base = slug(icon.name, "icon");
        for (let n = 2; iconNames.has(base); n++) base = `${slug(icon.name, "icon")}-${n}`;
        iconNames.add(base);
        if (iconUrls[icon.id]) files.push({ path: `icons/${base}.svg`, url: iconUrls[icon.id] });
      }
    } catch (error) {
      renderNote = `Rendus Figma indisponibles : ${error.message}`;
    }
  }
  for (const [ref, url] of Object.entries(source.imageFills || {})) {
    if (url) files.push({ path: `images/${ref.slice(0, 40)}.png`, url });
  }

  const zip = await deps.buildZip(files);
  const filename = `${name}_figma_kit.zip`;
  const downloadId = await chrome.downloads.download({ url: zip.blobUrl, filename, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
  deps.revokeLater(downloadId, zip.blobUrl);
  return { filename, fileCount: zip.fileCount, skipped: zip.failures?.length || 0, note: renderNote };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Live page → editable Figma layers document. Image bytes are embedded as
 * data URLs here: the plugin UI runs on a null origin, so most image hosts
 * would refuse it (CORS).
 */
async function capturePage(message) {
  const tabId = Number(message.tabId);
  if (!tabId) throw new Error("Onglet introuvable.");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["figma-capture.js"] });
  const [{ result: doc }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (options) => window.__keysOsiFigmaCapture(options),
    args: [{ maxNodes: Number(message.maxNodes) || 5000, selector: message.selector || undefined }]
  });
  if (!doc || !doc.root) throw new Error("Capture vide : la page n'a pas d'élément visible.");
  let embedded = 0;
  for (const image of doc.images.slice(0, 80)) {
    if (!/^https?:/i.test(image.url || "")) continue;
    try {
      const response = await fetch(image.url, { credentials: "omit" });
      const type = response.headers.get("content-type") || "";
      if (!response.ok || !/image\/(png|jpe?g|gif|webp)/i.test(type)) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 4 * 1024 * 1024) continue;
      image.dataUrl = `data:${type.split(";")[0]};base64,${bytesToBase64(bytes)}`;
      embedded += 1;
    } catch (error) {
      // The plugin falls back to fetching the URL, then to a placeholder.
    }
  }
  const json = JSON.stringify(doc);
  const name = slug(doc.source?.title, "page");
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  const filename = `${name}.keysosi-figma.json`;
  await chrome.downloads.download({ url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`, filename, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
  return { filename, layers: doc.stats?.nodes || 0, images: doc.images.length, embedded, fonts: doc.fonts.length, components: new Set(collectCandidates(doc.root)).size };
}

function collectCandidates(node, out = []) {
  if (node.componentCandidate) out.push(node.componentCandidate);
  for (const child of node.children || []) collectCandidates(child, out);
  return out;
}

async function exportTokens(message) {
  const normalized = message.normalized || (await figmaNormalized());
  if (!normalized) throw new Error("Lance d'abord une extraction (ou importe un fichier Figma).");
  const json = JSON.stringify(generateW3cTokens(normalized), null, 2);
  const name = slug(normalized.source?.title, "design");
  const filename = `${name}.keysosi-tokens.json`;
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  await chrome.downloads.download({ url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`, filename, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
  return { filename };
}

async function exportPlugin(deps) {
  const files = [];
  for (const path of ["manifest.json", "code.js", "ui.html"]) {
    const response = await fetch(chrome.runtime.getURL(`figma-plugin/${path}`));
    files.push({ path: `keys-osi-figma-plugin/${path}`, content: await response.text() });
  }
  files.push({
    path: "keys-osi-figma-plugin/LISEZMOI.txt",
    content: [
      "Plugin Figma « Keys_Osi Import »",
      "",
      "1. Figma Desktop → Plugins → Development → Import plugin from manifest…",
      "2. Choisis keys-osi-figma-plugin/manifest.json.",
      "3. Lance le plugin et dépose un fichier .keysosi-figma.json (calques de page)",
      "   ou .keysosi-tokens.json (variables, styles de texte, ombres)."
    ].join("\n")
  });
  const zip = await deps.buildZip(files);
  const filename = "keys-osi-figma-plugin.zip";
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  const downloadId = await chrome.downloads.download({ url: zip.blobUrl, filename, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
  deps.revokeLater(downloadId, zip.blobUrl);
  return { filename, fileCount: zip.fileCount };
}

/** Routes FIGMA_* messages; returns a promise, or null when not ours. */
export function handleFigmaMessage(message, deps) {
  switch (message.type) {
    case "FIGMA_IMPORT":
      return importFile(message);
    case "FIGMA_IMPORT_DECODED":
      return importDecoded(message);
    case "FIGMA_LIVE":
      return importLive(message);
    case "FIGMA_EXPORT":
      return exportKit(message, deps);
    case "FIGMA_STATE":
      return chrome.storage.local.get([FIGMA_SOURCE_KEY, TOKEN_KEY]).then((data) => ({ summary: summarize(data[FIGMA_SOURCE_KEY]), hasToken: Boolean(data[TOKEN_KEY]) }));
    case "FIGMA_CAPTURE_PAGE":
      return capturePage(message);
    case "FIGMA_TOKENS":
      return exportTokens(message);
    case "FIGMA_PLUGIN":
      return exportPlugin(deps);
    case "FIGMA_CLEAR":
      return chrome.storage.local.remove(FIGMA_SOURCE_KEY).then(() => ({ cleared: true }));
    default:
      return null;
  }
}
