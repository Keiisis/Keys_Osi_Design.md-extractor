import { normalizeExtractedStyles } from "./lib/normalize.mjs";
import { formatAuditSections, generateDesignMarkdown } from "./lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "./lib/generate-skill-md.mjs";
import { validateMarkdownOutput } from "./lib/validate.mjs";
import { processCssAssets } from "./lib/css-assets.mjs";
import { generateCssVariables, generateScss, generateTailwindConfig, generateW3cTokens } from "./lib/export-tokens.mjs";
import { generateDiffMarkdown } from "./lib/diff-tokens.mjs";
import { generateDesignJson } from "./lib/generate-json-export.mjs";
import { generateStarterKit } from "./lib/generate-starter-kit.mjs";
import { generateMotionMarkdown } from "./lib/generate-motion-md.mjs";
import { generatePromptMarkdown } from "./lib/generate-prompt-md.mjs";
import { buildAiProRequest, generateLocalPromptPro, wrapAiProOutput } from "./lib/generate-prompt-pro.mjs";
import { generateComponentCode } from "./lib/generate-code.mjs";
import { renameTokensWithAI } from "./lib/token-intelligence.mjs";
import { scoreToGrade } from "./lib/fidelity.mjs";
import { handle3dMessage } from "./sw-3d.mjs";
import { figmaNormalized, handleFigmaMessage } from "./sw-figma.mjs";
import { handleTechMessage, techSeedUrls } from "./sw-tech.mjs";
import { handleReaMessage } from "./sw-rea.mjs";
import { handlePromptMessage } from "./sw-prompt.mjs";
import { handleResponsiveMessage, responsiveFor, responsiveSectionFor } from "./sw-responsive.mjs";
import { handleCloneMessage } from "./sw-clone.mjs";
import { responsivePromptBlock } from "./lib/responsive.mjs";
import { applyLessonsToMessages, handleMemoryMessage, memoryAvoidModels, memoryLessons, recordMemoryEvent } from "./sw-memory.mjs";
import { BRAND_KEY, handleBrandBoardMessage, handlePinContextMenu } from "./sw-brand-board.mjs";
import { auditExtraction } from "./lib/learning-memory.mjs";
import { brandKitPromptBlock } from "./lib/brand-kit.mjs";
import { BOARD_KEY, moodboardPromptBlock } from "./lib/moodboard.mjs";
import { buildSiteDigest } from "./lib/site-structure.mjs";
import { missingAnatomySections } from "./lib/generate-prompt-pro.mjs";
import { contrastRatio, isSaturated } from "./lib/color-science.mjs";
import { deepSignalsPromptBlock, generateDeepSignalsMarkdown, summarizeDeepSignals } from "./lib/deep-signals.mjs";
import { allPlatformExports } from "./lib/platform-exports.mjs";
import { listModels, pickBestModel } from "./lib/ai-client.mjs";
import { buildSiteStructureFiles, generatePageMarkdown, generateSiteStructureMarkdown } from "./lib/site-structure.mjs";

const EXTRACTION_MESSAGE = "KEYS_OSI_EXTRACT_STYLES";
const HISTORY_KEY = "extractionHistory";
const HISTORY_LIMIT = 15;
const MCP_BRIDGE_URL = "http://127.0.0.1:8765";

// The toolbar icon opens the side panel (the workspace stays open while browsing).
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    outputMode: "design"
  });
  // Menus survive updates: recreate from scratch to avoid "duplicate id".
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "keys-osi-extract-element",
      title: "Extraire ce composant (Keys_Osi)",
      contexts: ["all"]
    });
    chrome.contextMenus.create({
      id: "keys-osi-pin",
      title: "Épingler dans le moodboard (Keys_Osi)",
      contexts: ["page", "image", "selection", "link"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "keys-osi-pin" && tab?.id) {
    handlePinContextMenu(info, tab, { runInOffscreen }).catch((error) => {
      chrome.action.setBadgeText({ tabId: tab.id, text: "ERR" });
      chrome.action.setTitle({ tabId: tab.id, title: `Keys_Osi : ${stringifyError(error)}` });
    });
    return;
  }
  if (info.menuItemId !== "keys-osi-extract-element" || !tab || !tab.id) {
    return;
  }
  handleExtractElement(tab, info.frameId || 0).catch((error) => {
    // No popup is open: surface the failure on the toolbar icon.
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#d93025" });
    chrome.action.setBadgeText({ tabId: tab.id, text: "ERR" });
    chrome.action.setTitle({ tabId: tab.id, title: `Keys_Osi : ${stringifyError(error)}` });
  });
});

async function handleExtractElement(tab, frameId) {
  // The right-clicked element may live in an iframe: inject there.
  const target = { tabId: tab.id, frameIds: [frameId] };
  await chrome.scripting.executeScript({ target, files: ["content-script.js"] });
  const response = await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { type: "KEYS_OSI_EXTRACT_ELEMENT" }, { frameId }, (reply) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!reply || !reply.ok) reject(new Error(reply?.error || "No response from tab."));
      else resolve(reply);
    });
  });
  if (!response.html) {
    return;
  }
  await chrome.downloads.download({
    url: `data:text/html;charset=utf-8,${encodeURIComponent(response.html)}`,
    filename: `component_${response.suggestedName || "extracted"}.html`,
    saveAs: true,
    conflictAction: "uniquify"
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type || message.target === "offscreen") {
    return;
  }

  const sideJob =
    handleReaMessage(message) ||
    handlePromptMessage(message) ||
    handleMemoryMessage(message) ||
    handleBrandBoardMessage(message, sender, {
      buildZip: buildZipViaOffscreen,
      revokeLater: revokeBlobWhenDownloadSettles,
      runInOffscreen
    }) ||
    handleResponsiveMessage(message, { buildZip: buildZipViaOffscreen, revokeLater: revokeBlobWhenDownloadSettles }) ||
    handleCloneMessage(message, { buildZip: buildZipViaOffscreen, revokeLater: revokeBlobWhenDownloadSettles });
  if (sideJob) {
    sideJob
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "PRO_RESULT") {
    handleProResult(message).catch(() => {});
    return;
  }

  if (message.type === "SITE_PROGRESS") {
    rememberSiteProgress(message);
    return;
  }

  if (message.type === "SITE_RESULT") {
    handleSiteResult(message).catch(() => {});
    return;
  }

  const siteJob = {
    SITE_SCAN_START: handleSiteScanStart,
    SITE_SCAN_CANCEL: handleSiteScanCancel,
    SITE_RENDER_PAGE: renderPageForCrawl,
    SITE_STATE: handleSiteState,
    SITE_EXPORT: handleSiteExport
  }[message.type];
  if (siteJob) {
    siteJob(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  const job3d = handle3dMessage(message, {
    buildInOffscreen: runInOffscreen,
    revokeLater: revokeBlobWhenDownloadSettles
  });
  if (job3d) {
    job3d
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  const figmaJob = handleFigmaMessage(message, {
    buildZip: buildZipViaOffscreen,
    revokeLater: revokeBlobWhenDownloadSettles
  });
  const techJob = handleTechMessage(message, {
    buildZip: buildZipViaOffscreen,
    revokeLater: revokeBlobWhenDownloadSettles
  });
  if (techJob) {
    techJob
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }
  if (figmaJob) {
    figmaJob
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "RUN_EXTRACTION") {
    handleExtraction(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "DOWNLOAD_MARKDOWN") {
    handleDownload(message)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "DOWNLOAD_JSON") {
    handleDownloadJson(message)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "COPY_SITE") {
    handleCopySite(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "GENERATE_PROMPT_PRO") {
    handleGeneratePromptPro(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "GENERATE_CODE") {
    handleGenerateCode(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "RENAME_TOKENS") {
    handleRenameTokens(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "FIDELITY_BASELINE") {
    handleFidelityBaseline()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "FIDELITY_COMPARE") {
    handleFidelityCompare()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "DOWNLOAD_STARTER_KIT") {
    handleDownloadStarterKit()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "DOWNLOAD_ASSETS") {
    handleDownloadAssets()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "COMPARE_TABS") {
    handleCompareTabs(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "LIST_AI_MODELS") {
    chrome.storage.local
      .get(["promptProSettings"])
      .then(async ({ promptProSettings: settings = {} }) => {
        const models = await listModels({ provider: settings.provider, apiKey: settings.apiKey, baseUrl: settings.baseUrl, fetchImpl: fetch });
        const { keysOsiModelStats: stats = {} } = await chrome.storage.local.get("keysOsiModelStats");
        sendResponse({ ok: true, models, best: pickBestModel(models), stats });
      })
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "ASSETS_ZIP") {
    handleAssetsZip(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "DOWNLOAD_TEXT") {
    handleDownloadText(message)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "SEND_TO_MCP") {
    handleSendToMcp(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "DIFF_WITH_PREVIOUS") {
    handleDiffWithPrevious(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "PLATFORM_ZIP") {
    (async () => {
      if (!message.normalized) throw new Error("Lance d'abord une extraction.");
      const files = allPlatformExports(message.normalized);
      const zip = await buildZipViaOffscreen(files);
      const filename = `${siteSlug(message.normalized.source?.title, "design")}_plateformes.zip`;
      const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
      const downloadId = await chrome.downloads.download({ url: zip.blobUrl, filename, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
      revokeBlobWhenDownloadSettles(downloadId, zip.blobUrl);
      return { filename, fileCount: zip.fileCount };
    })()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: stringifyError(error) }));
    return true;
  }

  if (message.type === "EXPORT_TOKENS") {
    try {
      const normalized = message.normalized;
      if (!normalized) {
        throw new Error("No extraction data available yet.");
      }
      sendResponse({
        ok: true,
        w3cTokens: JSON.stringify(generateW3cTokens(normalized), null, 2),
        tailwindConfig: generateTailwindConfig(normalized),
        cssVariables: generateCssVariables(normalized),
        scss: generateScss(normalized)
      });
    } catch (error) {
      sendResponse({ ok: false, error: stringifyError(error) });
    }
    return;
  }
});

/** Normalized design of the chosen source: the imported Figma file or the live tab. */
async function sourceNormalized(message, tab) {
  if (message.source === "figma") {
    const normalized = await figmaNormalized();
    if (!normalized) throw new Error("Aucun fichier Figma importé : importe-le d'abord (dépli « Figma »).");
    return normalized;
  }
  const target = tab || (message.tabId ? await chrome.tabs.get(Number(message.tabId)) : await getActiveTab());
  await injectExtractor(target.id);
  await injectMainWorldInspector(target.id);
  return normalizeExtractedStyles(await requestExtractionPayload(target.id));
}

/** Page-level signals read by deep-probe.js; null when the page cannot be probed. */
async function probeDeepSignals(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, files: ["deep-probe.js"] });
    return summarizeDeepSignals(result);
  } catch (error) {
    return null;
  }
}

/** Inserts the deep-signal sections before the DESIGN.md rules. */
function withDeepSections(markdown, deep) {
  return deep ? withSectionsBeforeRules(markdown, generateDeepSignalsMarkdown(deep)) : markdown;
}

function withSectionsBeforeRules(markdown, text) {
  const sections = String(text || "").trim();
  if (!sections) return markdown;
  const anchor = markdown.indexOf("\n## Rules: Do");
  return anchor === -1 ? `${markdown.trimEnd()}\n\n${sections}\n` : `${markdown.slice(0, anchor)}\n${sections}\n${markdown.slice(anchor)}`;
}

async function handleExtraction(message) {
  const mode = ["skill", "json", "motion", "prompt"].includes(message.mode) ? message.mode : "design";
  const normalized = await sourceNormalized(message);

  const context = {
    normalized
  };

  let markdown;
  let validation = null;
  let filename;
  if (mode === "json") {
    markdown = JSON.stringify(generateDesignJson(normalized, { version: chrome.runtime.getManifest().version }), null, 2);
    filename = "design-system.json";
  } else if (mode === "motion") {
    markdown = generateMotionMarkdown(context);
    filename = "MOTION.md";
  } else if (mode === "prompt") {
    markdown = generatePromptMarkdown(context);
    filename = "PROMPT.md";
  } else if (mode === "skill") {
    markdown = generateSkillMarkdown(context);
    validation = validateMarkdownOutput(mode, markdown);
    filename = "SKILL.md";
  } else {
    markdown = generateDesignMarkdown(context);
    if (message.source !== "figma") {
      const tabId = message.tabId ? Number(message.tabId) : (await getActiveTab()).id;
      markdown = withDeepSections(markdown, await probeDeepSignals(tabId));
      markdown = withSectionsBeforeRules(markdown, await responsiveSectionFor(normalized.source?.url || ""));
    }
    validation = validateMarkdownOutput(mode, markdown);
    filename = "DESIGN.md";
  }

  if (message.persistOutputMode !== false) {
    await chrome.storage.local.set({
      outputMode: mode
    });
  }

  if (message.source !== "figma") {
    await saveToHistory(normalized).catch(() => {});
  }
  const selfCheck = auditExtraction(normalized, { design: mode === "design" ? markdown : "", skill: mode === "skill" ? markdown : "" }, { contrastRatio, isSaturated });
  for (const issue of selfCheck) {
    await recordMemoryEvent({
      kind: "extract-anomaly",
      feature: "extract",
      message: issue.message,
      detail: { check: issue.check },
      scope: { host: safeHostname(normalized.source?.url), url: normalized.source?.url || "", platform: normalized.platformInfo?.platform || "" }
    }).catch(() => {});
  }

  return {
    mode,
    filename,
    markdown,
    normalized,
    validation,
    selfCheck
  };
}

async function saveToHistory(normalized) {
  const hostname = safeHostname(normalized.source?.url);
  if (!hostname) {
    return;
  }
  const data = await chrome.storage.local.get([HISTORY_KEY]);
  const history = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];

  const entry = {
    id: `${hostname}-${Date.now()}`,
    hostname,
    url: normalized.source?.url || "",
    title: normalized.source?.title || "",
    sampledAt: normalized.sampledAt || new Date().toISOString(),
    normalized
  };

  // Re-extracting an unchanged page should refresh the entry, not spam history.
  const newestSameHost = history.find((item) => item.hostname === hostname);
  if (newestSameHost && tokensFingerprint(newestSameHost.normalized) === tokensFingerprint(normalized)) {
    newestSameHost.sampledAt = entry.sampledAt;
    newestSameHost.normalized = normalized;
  } else {
    history.unshift(entry);
  }

  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, HISTORY_LIMIT) });
}

function tokensFingerprint(normalized) {
  if (!normalized) {
    return "";
  }
  return JSON.stringify({
    c: normalized.colorPalette,
    t: normalized.typographyScale,
    s: normalized.spacingScale,
    r: normalized.radiusTokens
  });
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "";
  }
}

async function handleDiffWithPrevious(message) {
  const current = message.normalized;
  if (!current) {
    throw new Error("Run an extraction first.");
  }
  const hostname = safeHostname(current.source?.url);
  const data = await chrome.storage.local.get([HISTORY_KEY]);
  const history = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];

  const previous = history.find(
    (item) =>
      item.hostname === hostname &&
      item.sampledAt !== current.sampledAt &&
      tokensFingerprint(item.normalized) !== tokensFingerprint(current)
  );
  if (!previous) {
    throw new Error("No earlier extraction of this site with different tokens was found in history.");
  }

  return {
    markdown: generateDiffMarkdown(previous.normalized, current),
    beforeDate: previous.sampledAt
  };
}

async function handleSendToMcp(message) {
  if (!message.normalized) {
    throw new Error("Run an extraction first.");
  }

  const body = JSON.stringify({
    source: message.normalized.source || {},
    sampledAt: message.normalized.sampledAt || "",
    designMarkdown: message.designMarkdown || "",
    skillMarkdown: message.skillMarkdown || "",
    normalized: message.normalized,
    w3cTokens: generateW3cTokens(message.normalized),
    tailwindConfig: generateTailwindConfig(message.normalized)
  });

  let response;
  try {
    response = await fetch(`${MCP_BRIDGE_URL}/extraction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
  } catch (error) {
    throw new Error(
      "MCP bridge unreachable on 127.0.0.1:8765. Start it with: npx design-extractor-mcp (see mcp-server/README.md)."
    );
  }
  if (!response.ok) {
    throw new Error(`MCP bridge rejected the extraction (HTTP ${response.status}).`);
  }
  const result = await response.json().catch(() => ({}));
  return { extractionId: result.id || null };
}

async function handleDownloadText(message) {
  if (!message.text) {
    throw new Error("Cannot download empty content.");
  }
  const filename = safeFilename(message.filename, "export.txt");
  const mime = String(message.mime || "text/plain");
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(message.text)}`;
  return chrome.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  });
}

async function handleDownload(message) {
  if (!message.markdown) {
    throw new Error("Cannot download empty markdown.");
  }

  const filename = normalizeMarkdownFilename(message.filename, message.mode);
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(message.markdown)}`;
  return chrome.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  });
}

async function handleDownloadJson(message) {
  if (!message.data) {
    throw new Error("Cannot download empty data.");
  }

  const filename = safeFilename(message.filename, "design_tokens.json");
  const jsonString = JSON.stringify(message.data, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(jsonString)}`;
  return chrome.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  if (!tab || !tab.id) {
    throw new Error("Aucun onglet actif.");
  }
  // Chrome forbids scripting chrome://, the Web Store, other extensions and
  // its PDF viewer: say so instead of surfacing a raw permission error.
  const url = String(tab.url || "");
  if (url && (!/^(https?|file):/i.test(url) || /^https:\/\/chromewebstore\.google\.com/i.test(url))) {
    throw new Error("Keys_Osi analyse les sites web (http/https). Cette page est protégée par Chrome : ouvre le site à extraire puis relance.");
  }
  return tab;
}

async function injectExtractor(tabId) {
  try {
    const alreadyInjected = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "KEYS_OSI_PING" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
    if (alreadyInjected) {
      return;
    }
  } catch (err) {
    // Ignore and proceed to inject
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-script.js"]
  });
}

function requestExtractionPayload(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: EXTRACTION_MESSAGE }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error(response?.error || "No extraction response from tab."));
        return;
      }
      resolve(response.payload);
    });
  });
}

// ASCII slug of a tab title; non-Latin titles fall back instead of "_".
function siteSlug(title, fallback) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || fallback;
}

// Windows rejects these in chrome.downloads filenames.
function safeFilename(name, fallback) {
  return String(name || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || fallback;
}

function stringifyError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "Unknown error");
}

function normalizeMarkdownFilename(inputName, mode) {
  const normalizedMode = ["skill", "motion", "prompt"].includes(mode) ? mode : "design";
  const fallbacks = { skill: "SKILL.md", motion: "MOTION.md", prompt: "PROMPT.md", design: "DESIGN.md" };
  const fallback = fallbacks[normalizedMode];
  const raw = String(inputName || "").trim();

  if (!raw) {
    return fallback;
  }

  const name = safeFilename(raw, "");
  if (!name) {
    return fallback;
  }

  if (new RegExp(`^${normalizedMode}(\\.md)?$`, "i").test(name)) {
    return fallback;
  }
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

async function handleCopySite(message) {
  const tab = await getActiveTab();
  await injectExtractor(tab.id);
  await injectMainWorldInspector(tab.id);

  const options = {
    staticSnapshot: Boolean(message.staticSnapshot),
    autoScroll: message.autoScroll !== false,
    crawlPages: Math.max(0, Math.min(10, Number(message.crawlPages) || 0)),
    screenshots: Boolean(message.screenshots),
    safeInteractions: Boolean(message.safeInteractions),
    advancedAudit: Boolean(message.advancedAudit)
  };

  // Phase 1: crawl plan — decide up front which internal pages become
  // pages/*.html so every page can rewrite its links consistently.
  const pageMap = {};
  const crawlTargets = [];
  if (options.crawlPages > 0) {
    const links = await sendTabMessage(tab.id, { type: "KEYS_OSI_LIST_LINKS" })
      .then((response) => response.links || [])
      .catch(() => []);
    const usedSlugs = new Set();
    for (const link of links.slice(0, options.crawlPages)) {
      const slug = uniquePageSlug(link.url, usedSlugs);
      const path = `pages/${slug}.html`;
      pageMap[link.url] = path;
      crawlTargets.push({ url: link.url, path });
    }
  }

  // Phase 2: section screenshots while the original tab is still active.
  const screenshots = options.screenshots ? await captureSectionScreenshots(tab) : [];

  // Phase 2b: safely open menus/accordions, capture that state, restore.
  // Runs before the main capture so the cloned HTML stays in its clean state.
  const interactions = options.safeInteractions
    ? await captureDisclosureState(tab)
    : null;

  // Phase 3: capture the active page.
  const mainPayload = await sendTabMessage(tab.id, {
    type: "KEYS_OSI_COPY_SITE",
    options: { ...options, currentPagePath: "index.html", pageMap, seedAssets: [] }
  }).then((response) => response.payload);

  const registry = [...mainPayload.assets];
  const pages = [{ path: "index.html", html: mainPayload.html }];
  const generatedByPath = new Map(
    (mainPayload.generatedFiles || []).map((file) => [file.path, file])
  );

  // Phase 4: crawl internal pages in background tabs, sharing the registry.
  for (const target of crawlTargets) {
    try {
      const payload = await capturePageInBackgroundTab(target.url, {
        ...options,
        autoScroll: true,
        currentPagePath: target.path,
        pageMap,
        seedAssets: registry.map((asset) => ({ url: asset.url, path: asset.path }))
      });
      registry.push(...payload.assets);
      pages.push({ path: target.path, html: payload.html });
      for (const file of payload.generatedFiles || []) {
        if (!generatedByPath.has(file.path)) {
          generatedByPath.set(file.path, file);
        }
      }
    } catch (error) {
      // A page that fails to load or extract is skipped, not fatal.
    }
  }

  // Phase 4b: real multi-viewport + dark-mode audit through the debugger
  // API (optional permission, requested by the popup on demand).
  const deviceAudit = options.advancedAudit ? await runAdvancedAudit(tab) : null;

  const audit = {
    viewports: deviceAudit?.viewports || [],
    darkMode: deviceAudit?.darkMode || null,
    interactions: interactions
      ? { opened: interactions.opened, report: interactions.report }
      : null
  };

  // Phase 5: stylesheet processing across every page's assets.
  const { rewrittenCss, extraAssets } = await processCssAssets(registry, fetchTextResource);
  const rewrittenPaths = new Set(rewrittenCss.map((entry) => entry.path));
  const allAssets = [...registry, ...extraAssets];

  // Phase 6: blueprint + token exports bundled with the clone.
  const blueprint = await buildBlueprintFiles(tab.id, screenshots.length, audit);

  const siteName = siteSlug(tab.title, "cloned_site");

  const zipFiles = [
    ...pages.map((page) => ({ path: page.path, content: page.html })),
    ...rewrittenCss.map((entry) => ({ path: entry.path, content: entry.text })),
    ...allAssets
      .filter((asset) => !rewrittenPaths.has(asset.path))
      .map((asset) => ({ path: asset.path, url: asset.url })),
    ...Array.from(generatedByPath.values()).map((file) => ({
      path: file.path,
      content: file.content
    })),
    ...screenshots.map((base64, index) => ({
      path: `screenshots/section-${String(index + 1).padStart(2, "0")}.png`,
      base64
    })),
    ...(deviceAudit?.viewports || [])
      .filter((viewport) => viewport.screenshotBase64)
      .map((viewport) => ({
        path: `screenshots/viewport-${viewport.name}.png`,
        base64: viewport.screenshotBase64
      })),
    ...(deviceAudit?.darkMode?.screenshotBase64
      ? [{ path: "screenshots/dark-mode.png", base64: deviceAudit.darkMode.screenshotBase64 }]
      : []),
    ...(interactions?.screenshotBase64
      ? [{ path: "screenshots/disclosures-open.png", base64: interactions.screenshotBase64 }]
      : []),
    ...blueprint
  ];

  try {
    const zipResult = await buildZipViaOffscreen(zipFiles);
    const downloadId = await chrome.downloads.download({
      url: zipResult.blobUrl,
      filename: `${siteName}.zip`,
      saveAs: true,
      conflictAction: "uniquify"
    });
    revokeBlobWhenDownloadSettles(downloadId, zipResult.blobUrl);
    return {
      fileCount: zipResult.fileCount,
      pageCount: pages.length,
      screenshotCount: screenshots.length,
      skipped: zipResult.failures?.length || 0,
      path: `${siteName}.zip`,
      packaging: "zip"
    };
  } catch (error) {
    // ZIP packaging failed (offscreen unavailable, archive too large...):
    // fall back to individual downloads so the user still gets the clone.
    const fileCount = await downloadFilesIndividually(
      `keys_osi_clones/${siteName}`,
      zipFiles
    );
    return {
      fileCount,
      pageCount: pages.length,
      screenshotCount: screenshots.length,
      skipped: 0,
      path: `keys_osi_clones/${siteName}`,
      packaging: "files"
    };
  }
}

/**
 * Downloads a focused assets ZIP: every stylesheet (rewritten to local
 * paths), every script, every font file the CSS references, plus
 * colors.json (palette, gradients, CSS variables) and fonts.json
 * (@font-face inventory).
 */
async function handleDownloadAssets() {
  const tab = await getActiveTab();
  await injectExtractor(tab.id);
  await injectMainWorldInspector(tab.id);

  const payload = await sendTabMessage(tab.id, {
    type: "KEYS_OSI_COPY_SITE",
    options: { autoScroll: true, staticSnapshot: false, currentPagePath: "index.html" }
  }).then((response) => response.payload);

  // Pull fonts/@imports referenced inside the stylesheets too.
  const { rewrittenCss, extraAssets } = await processCssAssets(payload.assets, fetchTextResource);
  const rewrittenPaths = new Set(rewrittenCss.map((entry) => entry.path));
  const allAssets = [...payload.assets, ...extraAssets];

  const isWanted = (path) =>
    path.startsWith("css/") || path.startsWith("js/") || path.startsWith("fonts/");

  const extraction = await requestExtractionPayload(tab.id);
  const normalized = normalizeExtractedStyles(extraction);

  const colorsJson = {
    palette: normalized.colorPalette,
    colorCodes: (normalized.colorPalette || [])
      .map((row) => String(row.value).split(" ")[0])
      .filter((value) => value.startsWith("#")),
    gradients: normalized.gradientTokens,
    cssVariables: normalized.cssVariables
  };

  const siteName = siteSlug(tab.title, "site");

  const zipFiles = [
    ...rewrittenCss.map((entry) => ({ path: entry.path, content: entry.text })),
    ...allAssets
      .filter((asset) => isWanted(asset.path) && !rewrittenPaths.has(asset.path))
      .map((asset) => ({ path: asset.path, url: asset.url })),
    { path: "colors.json", content: JSON.stringify(colorsJson, null, 2) },
    {
      path: "fonts.json",
      content: JSON.stringify(normalized.resources?.fontFaces || [], null, 2)
    }
  ];

  const zipResult = await buildZipViaOffscreen(zipFiles);
  const downloadId = await chrome.downloads.download({
    url: zipResult.blobUrl,
    filename: `${siteName}_assets.zip`,
    saveAs: true,
    conflictAction: "uniquify"
  });
  revokeBlobWhenDownloadSettles(downloadId, zipResult.blobUrl);

  return {
    fileCount: zipResult.fileCount,
    skipped: zipResult.failures?.length || 0,
    path: `${siteName}_assets.zip`
  };
}

/** Assets panel selection (images, SVG, fonts, media, animations) as one ZIP. */
async function handleAssetsZip(message) {
  const files = (Array.isArray(message.files) ? message.files : [])
    .filter((file) => file && typeof file.path === "string" && !file.path.includes(".."))
    .map((file) =>
      typeof file.content === "string"
        ? { path: file.path, content: file.content }
        : { path: file.path, url: String(file.url || "") }
    )
    .filter((file) => file.content !== undefined || /^(https?|data):/.test(file.url));
  if (files.length === 0) {
    throw new Error("Aucun fichier à archiver.");
  }
  const name = `${siteSlug(message.title, "site")}_keys_osi_assets.zip`;
  const zipResult = await buildZipViaOffscreen(files);
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  const downloadId = await chrome.downloads.download({
    url: zipResult.blobUrl,
    filename: name,
    saveAs: keysOsiSaveAs !== false,
    conflictAction: "uniquify"
  });
  revokeBlobWhenDownloadSettles(downloadId, zipResult.blobUrl);
  return { path: name, fileCount: zipResult.fileCount, skipped: zipResult.failures?.length || 0 };
}

/**
 * Design System Starter Kit ZIP: tokens.css + components.css built from
 * the measured specs, a zero-build preview page, and React components.
 */
async function handleDownloadStarterKit() {
  const tab = await getActiveTab();
  await injectExtractor(tab.id);
  await injectMainWorldInspector(tab.id);

  const payload = await requestExtractionPayload(tab.id);
  const normalized = normalizeExtractedStyles(payload);

  const siteName = siteSlug(tab.title, "site");

  const files = [
    ...generateStarterKit(normalized, { name: normalized.source?.title || siteName }).map((file) => ({
      path: file.path,
      content: file.content
    })),
    {
      path: "starter-kit/tailwind.config.js",
      content: generateTailwindConfig(normalized)
    },
    {
      path: "starter-kit/design.tokens.json",
      content: JSON.stringify(generateW3cTokens(normalized), null, 2)
    }
  ];

  const zipResult = await buildZipViaOffscreen(files);
  const downloadId = await chrome.downloads.download({
    url: zipResult.blobUrl,
    filename: `${siteName}_starter_kit.zip`,
    saveAs: true,
    conflictAction: "uniquify"
  });
  revokeBlobWhenDownloadSettles(downloadId, zipResult.blobUrl);

  return { fileCount: zipResult.fileCount, path: `${siteName}_starter_kit.zip` };
}

/**
 * PROMPT PRO: fuses the measured design DNA of the current site with
 * the user's own project description. Uses the AI provider configured
 * in settings (key stored in chrome.storage.local only), with a
 * deterministic local template as fallback.
 */
async function handleGeneratePromptPro(message) {
  const description = String(message.projectDescription || "").trim();
  if (description.length < 15) {
    throw new Error("Décris ton projet en quelques phrases d'abord (produit, audience, sections voulues).");
  }

  // Live progress for the popup (it may be closed: errors are ignored).
  const progress = (step, extra = {}) =>
    chrome.runtime.sendMessage({ type: "PRO_PROGRESS", step, ...extra }).catch(() => {});

  progress("extract");
  const tab = message.source === "figma" ? { url: "" } : message.tabId ? await chrome.tabs.get(Number(message.tabId)) : await getActiveTab();
  const normalized = await sourceNormalized(message, message.source === "figma" ? null : tab);
  const basePrompt = generatePromptMarkdown({ normalized });

  const stored = await chrome.storage.local.get(["promptProSettings"]);
  const settings = stored.promptProSettings || {};
  const context = await buildProContext(message, normalized);
  if (message.source !== "figma" && tab.id) {
    const deep = await probeDeepSignals(tab.id);
    if (deep) context.push({ title: "PAGE SIGNALS (voice, imagery, icons, dark mode, form states of the reference)", text: deepSignalsPromptBlock(deep) });
    const responsive = await responsiveFor(tab.url || "");
    if (responsive) context.push({ title: "RESPONSIVE BEHAVIOR (measured at 375/768/1024/1440: breakpoints, navigation, columns, type)", text: responsivePromptBlock(responsive) });
  }

  // Vision grounding: capture a few section screenshots so the model
  // sees the real composition, not just the numbers.
  let screenshots = null;
  if (settings.apiKey && message.vision && tab.id) {
    progress("vision");
    screenshots = await captureSectionScreenshots(tab).catch(() => []);
  }

  if (settings.apiKey) {
    // Reasoning models can take several minutes; MV3 kills a worker whose
    // event runs > 5 min. The offscreen document has no such limit: it
    // streams the answer and reports back with PRO_RESULT.
    // "Vitesse": no model imposed → the fastest model that already
    // succeeded here, measured by previous generations.
    const runSettings = { ...settings };
    if (!runSettings.model && runSettings.priority === "speed") {
      runSettings.model = (await fastestModel()) || "";
    }
    progress("ai", { model: runSettings.model || "auto" });
    const { messages: baseMessages, archetypes } = buildAiProRequest({ normalized, basePrompt, description, screenshots, context });
    const lessons = await memoryLessons("pro");
    const messages = applyLessonsToMessages(baseMessages, lessons);
    runSettings.avoidModels = await memoryAvoidModels();
    const jobId = crypto.randomUUID();
    await chrome.storage.session.set({
      [PRO_JOB_KEY]: {
        jobId,
        normalized,
        description,
        basePrompt,
        archetypes,
        provider: runSettings.provider || "groq",
        requestedModel: runSettings.model || "auto",
        startedAt: Date.now(),
        vision: Boolean(screenshots && screenshots.length),
        url: tab.url || "",
        context,
        lessons: lessons.length
      }
    });
    await runInOffscreen({ type: "KEYS_OSI_PRO_RUN", jobId, messages, settings: runSettings });
    return { pending: true, jobId };
  }

  return saveProResult(
    {
      markdown: generateLocalPromptPro(normalized, description, basePrompt, context),
      engine: "moteur local Keys_Osi (pas de clé API configurée)",
      context: context.map((block) => block.title)
    },
    tab.url || ""
  );
}

/** User-supplied context for PROMPT_PRO: brand kit, moodboard, scanned structure of the same site. */
async function buildProContext(message, normalized) {
  const context = [];
  const data = await chrome.storage.local.get([BRAND_KEY, BOARD_KEY, "keysOsiLastSite"]);
  if (message.useBrand !== false && data[BRAND_KEY]?.kit) {
    context.push({ title: "BRAND KIT (the user's brand — overrides the reference colors and fonts)", text: brandKitPromptBlock(data[BRAND_KEY].kit), brand: true });
  }
  if (message.useBoard !== false && Array.isArray(data[BOARD_KEY]) && data[BOARD_KEY].length) {
    context.push({ title: "MOODBOARD (references pinned by the user)", text: moodboardPromptBlock(data[BOARD_KEY]) });
  }
  const site = data.keysOsiLastSite;
  if (message.useSite !== false && site && normalized.source?.url && safeHostname(site.origin) === safeHostname(normalized.source.url)) {
    context.push({ title: "SITE STRUCTURE (every page of the reference site)", text: buildSiteDigest(site) });
  }
  return context;
}

const PRO_JOB_KEY = "keysOsiProJob";
const MODEL_STATS_KEY = "keysOsiModelStats";

// Measured PROMPT_PRO runs per model: { model: { runs, fails, totalMs } }.
async function recordModelRun(model, ok, durationMs) {
  if (!model || model === "auto") return;
  const { [MODEL_STATS_KEY]: stats = {} } = await chrome.storage.local.get(MODEL_STATS_KEY);
  const entry = stats[model] || { runs: 0, fails: 0, totalMs: 0 };
  if (ok) {
    entry.runs += 1;
    entry.totalMs += durationMs;
  } else {
    entry.fails += 1;
  }
  stats[model] = entry;
  await chrome.storage.local.set({ [MODEL_STATS_KEY]: stats });
}

async function fastestModel() {
  const { [MODEL_STATS_KEY]: stats = {} } = await chrome.storage.local.get(MODEL_STATS_KEY);
  return Object.entries(stats)
    .filter(([, s]) => s.runs > 0 && s.fails <= s.runs)
    .sort(([, a], [, b]) => a.totalMs / a.runs - b.totalMs / b.runs)[0]?.[0] || null;
}

// The popup can close during a long generation: keep the result so it
// reappears the next time the popup opens.
async function saveProResult(result, url) {
  await chrome.storage.local
    .set({ keysOsiLastPro: { ...result, at: new Date().toISOString(), url } })
    .catch(() => {});
  chrome.runtime.sendMessage({ type: "PRO_PROGRESS", step: "done" }).catch(() => {});
  return result;
}

/** Offscreen runner finished (or failed): build, save and announce the result. */
async function handleProResult(message) {
  const { [PRO_JOB_KEY]: job } = await chrome.storage.session.get(PRO_JOB_KEY);
  if (!job || job.jobId !== message.jobId) {
    return;
  }
  await chrome.storage.session.remove(PRO_JOB_KEY);
  const result = message.ok
    ? {
        markdown: wrapAiProOutput({
          content: message.content,
          provider: message.provider || job.provider,
          model: message.model || "?",
          sourceUrl: job.normalized.source?.url,
          archetypes: job.archetypes,
          vision: job.vision
        }),
        engine: `${job.provider} · ${message.model || "IA"}${job.vision ? " + vision" : ""}${job.lessons ? ` · ${job.lessons} leçon(s) appliquée(s)` : ""}`,
        context: (job.context || []).map((block) => block.title)
      }
    : {
        markdown: generateLocalPromptPro(job.normalized, job.description, job.basePrompt, job.context || []),
        engine: "moteur local Keys_Osi (repli)",
        warning: `Appel IA échoué : ${message.error || "erreur inconnue"}`
      };
  await recordModelRun(message.ok ? message.model || job.requestedModel : job.requestedModel, message.ok, Date.now() - (job.startedAt || Date.now()));
  const memoryScope = { model: message.model || job.requestedModel, provider: job.provider, host: safeHostname(job.url), url: job.url };
  if (!message.ok) {
    await recordMemoryEvent({ kind: "ai-failure", feature: "pro", message: message.error || "erreur inconnue", scope: memoryScope }).catch(() => {});
  } else {
    const missing = missingAnatomySections(message.content);
    if (missing.length) {
      await recordMemoryEvent({ kind: "missing-sections", feature: "pro", message: `${missing.length} section(s) absente(s)`, detail: { sections: missing }, scope: memoryScope }).catch(() => {});
      result.missingSections = missing;
    }
  }
  await saveProResult(result, job.url);
  chrome.runtime.sendMessage({ type: "PRO_DONE", jobId: job.jobId, result }).catch(() => {});
}

async function handleGenerateCode(message) {
  const framework = ["react", "vue", "html"].includes(message.framework) ? message.framework : "react";
  const stored = await chrome.storage.local.get(["promptProSettings"]);
  const settings = stored.promptProSettings || {};
  if (!settings.apiKey) {
    throw new Error("Configure une clé API dans l'onglet PRO pour générer du code.");
  }

  const tab = await getActiveTab();
  await injectExtractor(tab.id);
  await injectMainWorldInspector(tab.id);
  const payload = await requestExtractionPayload(tab.id);
  const normalized = normalizeExtractedStyles(payload);

  let screenshots = null;
  if (message.vision) {
    screenshots = await captureSectionScreenshots(tab).catch(() => []);
  }

  const { files, provider, model } = await generateComponentCode({
    normalized,
    framework,
    settings,
    screenshots,
    fetchImpl: fetch
  });

  const siteName = siteSlug(tab.title, "site");
  const zipResult = await buildZipViaOffscreen(files);
  const downloadId = await chrome.downloads.download({
    url: zipResult.blobUrl,
    filename: `${siteName}_${framework}_code.zip`,
    saveAs: true,
    conflictAction: "uniquify"
  });
  revokeBlobWhenDownloadSettles(downloadId, zipResult.blobUrl);
  return { fileCount: files.length, engine: `${provider}/${model}`, path: `${siteName}_${framework}_code.zip` };
}

async function handleRenameTokens(message) {
  const stored = await chrome.storage.local.get(["promptProSettings"]);
  const settings = stored.promptProSettings || {};
  if (!settings.apiKey) {
    throw new Error("Configure une clé API dans l'onglet PRO pour renommer les tokens.");
  }
  const normalized = message.normalized;
  if (!normalized) {
    throw new Error("Lance d'abord une extraction.");
  }
  const renameMap = await renameTokensWithAI({ normalized, settings, fetchImpl: fetch });
  return { renameMap };
}

const FIDELITY_BASELINE_KEY = "fidelityBaseline";

async function handleFidelityBaseline() {
  const tab = await getActiveTab();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  await chrome.storage.local.set({
    [FIDELITY_BASELINE_KEY]: { dataUrl, url: tab.url || "", capturedAt: new Date().toISOString() }
  });
  return { url: tab.url || "" };
}

async function handleFidelityCompare() {
  const stored = await chrome.storage.local.get([FIDELITY_BASELINE_KEY, "promptProSettings"]);
  const baseline = stored[FIDELITY_BASELINE_KEY];
  if (!baseline || !baseline.dataUrl) {
    throw new Error("Capture d'abord une référence sur le site cible (bouton « Référence »).");
  }
  const tab = await getActiveTab();
  const compareDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

  await ensureOffscreenDocument();
  const ssimResult = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "KEYS_OSI_SSIM",
    baselineDataUrl: baseline.dataUrl,
    compareDataUrl
  });
  if (!ssimResult || !ssimResult.ok) {
    throw new Error(ssimResult?.error || "Comparaison échouée.");
  }
  const grade = scoreToGrade(ssimResult.score);

  // Optional AI gap analysis grounded in the two screenshots.
  let critique = "";
  const settings = stored.promptProSettings || {};
  if (settings.apiKey) {
    try {
      const { callAI } = await import("./lib/ai-client.mjs");
      const result = await callAI({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
        baseUrl: settings.baseUrl,
        maxTokens: 800,
        messages: [
          { role: "system", text: "You compare a reference website design (first image) with a reproduction (second image). List the top 4 concrete visual differences to fix, most impactful first. Be specific (spacing, color, type weight, layout). Bullet points only." },
          {
            role: "user",
            text: `Measured structural similarity: ${grade.percent}%. What differs?`,
            images: [
              { mediaType: "image/png", base64: baseline.dataUrl.split(",")[1] },
              { mediaType: "image/png", base64: compareDataUrl.split(",")[1] }
            ]
          }
        ],
        fetchImpl: fetch
      });
      critique = result.content;
    } catch (error) {
      critique = "";
    }
  }

  return {
    percent: grade.percent,
    label: grade.label,
    baselineUrl: baseline.url,
    compareUrl: tab.url || "",
    critique
  };
}

async function buildBlueprintFiles(tabId, screenshotCount, audit) {
  try {
    const payload = await requestExtractionPayload(tabId);
    const normalized = normalizeExtractedStyles(payload);
    const context = { normalized };

    let designMd = generateDesignMarkdown(context);
    if (screenshotCount > 0) {
      const refs = Array.from(
        { length: screenshotCount },
        (_, index) => `- screenshots/section-${String(index + 1).padStart(2, "0")}.png`
      ).join("\n");
      designMd += `\n## Visual References\nSection-by-section screenshots captured during extraction. Use them as the source of truth for layout, spacing, and art direction.\n${refs}\n`;
    }
    designMd += formatAuditSections(audit);

    const files = [
      { path: "DESIGN.md", content: designMd },
      { path: "SKILL.md", content: generateSkillMarkdown(context) },
      { path: "MOTION.md", content: generateMotionMarkdown(context) },
      { path: "PROMPT.md", content: generatePromptMarkdown(context) },
      { path: "tokens/design_tokens.json", content: JSON.stringify(normalized, null, 2) },
      { path: "tokens/design.tokens.json", content: JSON.stringify(generateW3cTokens(normalized), null, 2) },
      { path: "tokens/tailwind.config.js", content: generateTailwindConfig(normalized) }
    ];

    if (audit && (audit.viewports.length > 0 || audit.darkMode || audit.interactions)) {
      const auditData = {
        viewports: audit.viewports.map((viewport) => ({
          name: viewport.name,
          width: viewport.width,
          height: viewport.height,
          typographyScale: viewport.typographyScale,
          spacingScale: viewport.spacingScale
        })),
        darkMode: audit.darkMode ? { colorPalette: audit.darkMode.colorPalette } : null,
        interactions: audit.interactions
      };
      files.push({
        path: "tokens/responsive-audit.json",
        content: JSON.stringify(auditData, null, 2)
      });
    }

    return files;
  } catch (error) {
    // The clone is still valuable without the blueprint files.
    return [];
  }
}

async function captureDisclosureState(tab) {
  try {
    const openResult = await sendTabMessage(tab.id, { type: "KEYS_OSI_SAFE_INTERACT_OPEN" });
    if (!openResult.opened || openResult.opened === 0) {
      return null;
    }
    await sleep(650);
    let screenshotBase64 = null;
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      screenshotBase64 = String(dataUrl || "").split(",")[1] || null;
    } catch (error) {}
    await sendTabMessage(tab.id, { type: "KEYS_OSI_SAFE_INTERACT_CLOSE" }).catch(() => {});
    return {
      opened: openResult.opened,
      report: openResult.report || [],
      screenshotBase64
    };
  } catch (error) {
    return null;
  }
}

const AUDIT_VIEWPORTS = [
  { name: "mobile", width: 375, height: 812, deviceScaleFactor: 3, mobile: true },
  { name: "tablet", width: 768, height: 1024, deviceScaleFactor: 2, mobile: true },
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }
];

async function runAdvancedAudit(tab) {
  // chrome.debugger only exists once the optional permission is granted.
  if (!chrome.debugger) {
    return null;
  }
  const target = { tabId: tab.id };
  try {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach(target, "1.3", () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    // Another debugger (DevTools) is attached, or permission was revoked.
    return null;
  }

  const audit = { viewports: [], darkMode: null };
  try {
    await debuggerCmd(target, "Page.enable");

    for (const viewport of AUDIT_VIEWPORTS) {
      await debuggerCmd(target, "Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
        mobile: viewport.mobile
      });
      await sleep(900);

      let screenshotBase64 = null;
      try {
        const shot = await debuggerCmd(target, "Page.captureScreenshot", { format: "png" });
        screenshotBase64 = shot?.data || null;
      } catch (error) {}

      let typographyScale = [];
      let spacingScale = [];
      try {
        const payload = await requestExtractionPayload(tab.id);
        const normalized = normalizeExtractedStyles(payload);
        typographyScale = normalized.typographyScale;
        spacingScale = normalized.spacingScale;
      } catch (error) {}

      audit.viewports.push({
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        screenshotBase64,
        typographyScale,
        spacingScale
      });
    }
    await debuggerCmd(target, "Emulation.clearDeviceMetricsOverride").catch(() => {});

    try {
      // Baseline palette in light mode, to detect whether the site
      // actually implements a dark theme.
      let lightPalette = [];
      try {
        const payload = await requestExtractionPayload(tab.id);
        lightPalette = normalizeExtractedStyles(payload).colorPalette;
      } catch (error) {}

      await debuggerCmd(target, "Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "dark" }]
      });
      await sleep(700);

      let screenshotBase64 = null;
      try {
        const shot = await debuggerCmd(target, "Page.captureScreenshot", { format: "png" });
        screenshotBase64 = shot?.data || null;
      } catch (error) {}

      let colorPalette = [];
      try {
        const payload = await requestExtractionPayload(tab.id);
        colorPalette = normalizeExtractedStyles(payload).colorPalette;
      } catch (error) {}

      const hasRealDarkTheme =
        JSON.stringify(colorPalette.map((row) => row.value)) !==
        JSON.stringify(lightPalette.map((row) => row.value));
      audit.darkMode = hasRealDarkTheme ? { screenshotBase64, colorPalette } : null;

      await debuggerCmd(target, "Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "" }]
      });
    } catch (error) {}
  } finally {
    chrome.debugger.detach(target, () => {
      void chrome.runtime.lastError;
    });
  }
  return audit;
}

function debuggerCmd(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params || {}, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

async function captureSectionScreenshots(tab) {
  const shots = [];
  try {
    const metrics = await sendTabMessage(tab.id, { type: "KEYS_OSI_PAGE_METRICS" });
    const viewportHeight = Math.max(200, Number(metrics.viewportHeight) || 800);
    const scrollHeight = Math.max(viewportHeight, Number(metrics.scrollHeight) || viewportHeight);
    const steps = Math.min(12, Math.ceil(scrollHeight / viewportHeight));

    for (let i = 0; i < steps; i++) {
      await sendTabMessage(tab.id, { type: "KEYS_OSI_SCROLL_TO", y: i * viewportHeight });
      // captureVisibleTab is rate-limited to ~2 calls per second.
      await sleep(620);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const base64 = String(dataUrl || "").split(",")[1];
      if (base64) {
        shots.push(base64);
      }
    }
    await sendTabMessage(tab.id, { type: "KEYS_OSI_SCROLL_TO", y: 0 }).catch(() => {});
  } catch (error) {
    // Screenshots are best-effort; the clone proceeds without them.
  }
  return shots;
}

async function capturePageInBackgroundTab(url, options) {
  const created = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(created.id, 20000);
    await injectExtractor(created.id);
    const response = await sendTabMessage(created.id, {
      type: "KEYS_OSI_COPY_SITE",
      options
    });
    return response.payload;
  } finally {
    chrome.tabs.remove(created.id).catch(() => {});
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        // Give SPA hydration a moment before extraction.
        setTimeout(() => finish(), 1200);
      }
    };
    const timer = setTimeout(() => finish(new Error("Page load timed out.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === "complete") {
        setTimeout(() => finish(), 1200);
      }
    }).catch(() => {});
  });
}

function uniquePageSlug(url, usedSlugs) {
  let base = "page";
  try {
    const parsed = new URL(url);
    base =
      parsed.pathname
        .replace(/\/$/, "")
        .split("/")
        .filter(Boolean)
        .join("-")
        .replace(/[^a-z0-9-]+/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .slice(0, 60) || "home";
  } catch (error) {}
  let slug = base;
  let counter = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.ok === false) {
        reject(new Error(response?.error || "No response from tab."));
        return;
      }
      resolve(response);
    });
  });
}

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  if (existing.length > 0) {
    return;
  }
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: "offscreen/offscreen.html",
        reasons: ["BLOBS"],
        justification: "Assemble the site clone ZIP archive and expose it as a blob URL."
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function runInOffscreen(message) {
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({ target: "offscreen", ...message });
  if (!result || !result.ok) {
    throw new Error(result?.error || "Offscreen task failed.");
  }
  return result;
}

function buildZipViaOffscreen(files) {
  return runInOffscreen({ type: "KEYS_OSI_BUILD_ZIP", files });
}

function revokeBlobWhenDownloadSettles(downloadId, blobUrl) {
  const onChanged = (delta) => {
    if (delta.id !== downloadId || !delta.state) {
      return;
    }
    if (delta.state.current === "complete" || delta.state.current === "interrupted") {
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.runtime
        .sendMessage({ target: "offscreen", type: "KEYS_OSI_REVOKE_ZIP", blobUrl })
        .catch(() => {});
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
}

async function downloadFilesIndividually(parentFolder, zipFiles) {
  let downloaded = 0;
  for (const file of zipFiles) {
    try {
      let url;
      if (typeof file.content === "string") {
        const mime = file.path.endsWith(".html")
          ? "text/html"
          : file.path.endsWith(".css")
            ? "text/css"
            : "text/plain";
        url = `data:${mime};charset=utf-8,${encodeURIComponent(file.content)}`;
      } else if (typeof file.base64 === "string") {
        url = `data:image/png;base64,${file.base64}`;
      } else if (typeof file.url === "string") {
        url = file.url;
      } else {
        continue;
      }
      await chrome.downloads.download({
        url,
        filename: `${parentFolder}/${file.path}`,
        saveAs: false,
        conflictAction: "overwrite"
      });
      downloaded += 1;
    } catch (error) {
      // Ignore individual failures.
    }
  }
  return downloaded;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextResource(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`);
  }
  return response.text();
}

async function injectMainWorldInspector(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["inspector-main.js"]
    });
  } catch (e) {
    // ignore
  }
}

/**
 * Before/after fidelity: captures two tabs (reference and reproduction)
 * section by section at the same scroll offsets, then scores every pair
 * (SSIM + differing pixels + heatmap) and downloads an HTML report.
 */
async function handleCompareTabs(message) {
  const [ref, cand] = await Promise.all([chrome.tabs.get(Number(message.refTabId)), chrome.tabs.get(Number(message.candTabId))]);
  if (ref.id === cand.id) {
    throw new Error("Choisis deux onglets différents (référence et reproduction).");
  }
  for (const tab of [ref, cand]) {
    if (!/^(https?|file):/i.test(tab.url || "")) {
      throw new Error(`Onglet non comparable (page protégée) : ${tab.title || tab.url}`);
    }
    await injectExtractor(tab.id);
  }
  const [refMetrics, candMetrics] = await Promise.all([
    sendTabMessage(ref.id, { type: "KEYS_OSI_PAGE_METRICS" }),
    sendTabMessage(cand.id, { type: "KEYS_OSI_PAGE_METRICS" })
  ]);
  const viewport = Math.max(200, Number(refMetrics.viewportHeight) || 800);
  const height = Math.min(Number(refMetrics.scrollHeight) || viewport, Number(candMetrics.scrollHeight) || viewport);
  const steps = Math.max(1, Math.min(8, Math.ceil(height / viewport)));

  const capture = async (tab, y) => {
    await chrome.tabs.update(tab.id, { active: true });
    await sendTabMessage(tab.id, { type: "KEYS_OSI_SCROLL_TO", y });
    // captureVisibleTab is rate-limited (~2/s) and needs the paint to settle.
    await sleep(650);
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 88 });
  };
  const pairs = [];
  for (let i = 0; i < steps; i++) {
    const y = i * viewport;
    pairs.push({ y, ref: await capture(ref, y), cand: await capture(cand, y) });
  }
  await sendTabMessage(ref.id, { type: "KEYS_OSI_SCROLL_TO", y: 0 }).catch(() => {});
  await sendTabMessage(cand.id, { type: "KEYS_OSI_SCROLL_TO", y: 0 }).catch(() => {});

  const result = await runInOffscreen({ type: "KEYS_OSI_COMPARE", pairs, meta: { refUrl: ref.url, candUrl: cand.url } });
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  const filename = `keys-osi-fidelite-${siteSlug(ref.title, "reference")}.html`;
  const downloadId = await chrome.downloads.download({ url: result.blobUrl, filename, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
  revokeBlobWhenDownloadSettles(downloadId, result.blobUrl);
  const summary = {
    overall: result.overall,
    grade: scoreToGrade(result.overall),
    sections: result.sections,
    filename,
    refUrl: ref.url,
    candUrl: cand.url,
    at: new Date().toISOString()
  };
  // Switching tabs closes the popup: keep the result for its next opening.
  await chrome.storage.local.set({ keysOsiLastCompare: summary });
  return summary;
}

// ---------------------------------------------------------------- site structure

const SITE_JOB_KEY = "keysOsiSiteJob";
const SITE_RESULT_KEY = "keysOsiLastSite";
const renderWindows = new Map();
let lastProgressWrite = 0;

async function handleSiteScanStart(message) {
  const { [SITE_JOB_KEY]: running } = await chrome.storage.session.get(SITE_JOB_KEY);
  if (running && Date.now() - running.startedAt < 30 * 60 * 1000) {
    throw new Error("Un scan est déjà en cours : attends la fin ou annule-le.");
  }
  const tab = message.tabId ? await chrome.tabs.get(Number(message.tabId)) : await getActiveTab();
  if (!/^https?:/i.test(tab.url || "")) throw new Error("Ouvre le site à scanner (http/https) puis relance.");
  const jobId = crypto.randomUUID();
  const options = {
    maxPages: Number(message.maxPages) || 50,
    samplePerTemplate: Number(message.samplePerTemplate) || 3,
    render: message.render !== false,
    maxRenders: Number(message.maxRenders) || 20
  };
  // Routes recovered by the technical decoding are crawled too.
  const { seeds, tech } = await techSeedUrls(new URL(tab.url).origin);
  options.seedUrls = seeds;
  options.tech = tech;
  await chrome.storage.session.set({ [SITE_JOB_KEY]: { jobId, startUrl: tab.url, startedAt: Date.now(), options, progress: null } });
  await runInOffscreen({ type: "KEYS_OSI_SITE_CRAWL", jobId, startUrl: tab.url, options });
  return { pending: true, jobId, startUrl: tab.url };
}

async function handleSiteScanCancel() {
  const { [SITE_JOB_KEY]: job } = await chrome.storage.session.get(SITE_JOB_KEY);
  if (!job) return { cancelled: false };
  await runInOffscreen({ type: "KEYS_OSI_SITE_CANCEL", jobId: job.jobId }).catch(() => {});
  return { cancelled: true };
}

function rememberSiteProgress(message) {
  // The popup may close mid-scan: keep the latest counters for its reopening.
  if (Date.now() - lastProgressWrite < 800) return;
  lastProgressWrite = Date.now();
  chrome.storage.session
    .get(SITE_JOB_KEY)
    .then(({ [SITE_JOB_KEY]: job }) => {
      if (job && job.jobId === message.jobId) {
        return chrome.storage.session.set({ [SITE_JOB_KEY]: { ...job, progress: message } });
      }
    })
    .catch(() => {});
}

/** Live render of a JavaScript-only page, in a minimized window kept per scan. */
async function renderPageForCrawl({ jobId, url }) {
  if (!/^https?:/i.test(String(url || ""))) throw new Error("URL invalide.");
  let windowId = renderWindows.get(jobId);
  let tabId = null;
  if (windowId) {
    try {
      tabId = (await chrome.tabs.create({ windowId, url, active: false })).id;
    } catch (error) {
      windowId = null;
    }
  }
  if (!windowId) {
    const created = await chrome.windows.create({ url, state: "minimized", focused: false });
    windowId = created.id;
    tabId = created.tabs[0].id;
    renderWindows.set(jobId, windowId);
  }
  try {
    await waitForTabComplete(tabId, 25000);
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/page-model.js"] });
    // Hydration has settled when the word count stops changing.
    let model = null;
    let previous = -1;
    for (let attempt = 0; attempt < 10; attempt++) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.KeysOsiPageModel.analyzeDocument(document, { url: location.href, rendered: true })
      });
      model = result;
      if (model && model.wordCount > 30 && model.wordCount === previous) break;
      previous = model ? model.wordCount : -1;
      await sleep(600);
    }
    return { model };
  } finally {
    const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
    if (tabs.length > 1) {
      chrome.tabs.remove(tabId).catch(() => {});
    } else {
      chrome.tabs.update(tabId, { url: "about:blank" }).catch(() => {});
    }
  }
}

async function handleSiteResult(message) {
  const { [SITE_JOB_KEY]: job } = await chrome.storage.session.get(SITE_JOB_KEY);
  if (!job || job.jobId !== message.jobId) return;
  await chrome.storage.session.remove(SITE_JOB_KEY);
  const windowId = renderWindows.get(job.jobId);
  if (windowId) {
    renderWindows.delete(job.jobId);
    chrome.windows.remove(windowId).catch(() => {});
  }
  if (message.ok && message.site) {
    await chrome.storage.local.set({ [SITE_RESULT_KEY]: message.site });
  }
  chrome.runtime
    .sendMessage({ type: "SITE_DONE", jobId: job.jobId, ok: Boolean(message.ok), error: message.error || "", summary: message.ok ? siteSummary(message.site) : null })
    .catch(() => {});
}

function siteSummary(site) {
  if (!site) return null;
  return {
    siteName: site.siteName,
    origin: site.origin,
    crawledAt: site.crawledAt,
    stats: site.stats,
    templates: site.templates.map((template) => ({ pattern: template.pattern, type: template.type, count: template.count })),
    flows: site.flows.length,
    forms: site.forms.length,
    pages: site.pages.map((page) => ({
      path: page.path,
      type: page.type,
      pattern: page.pattern,
      title: page.h1 || page.title,
      purpose: page.purpose,
      sections: (page.sections || []).length,
      rendered: Boolean(page.rendered),
      file: page.file
    }))
  };
}

async function handleSiteState() {
  const { [SITE_JOB_KEY]: job } = await chrome.storage.session.get(SITE_JOB_KEY);
  const { [SITE_RESULT_KEY]: site } = await chrome.storage.local.get(SITE_RESULT_KEY);
  return { job: job || null, summary: siteSummary(site) };
}

async function handleSiteExport(message) {
  const { [SITE_RESULT_KEY]: site } = await chrome.storage.local.get(SITE_RESULT_KEY);
  if (!site) throw new Error("Lance d'abord un scan de la structure du site.");
  const slug = siteSlug(site.siteName, "site");
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  const saveAs = keysOsiSaveAs !== false;
  if (message.what === "zip") {
    const zipResult = await buildZipViaOffscreen(buildSiteStructureFiles(site));
    const filename = `${slug}_structure.zip`;
    const downloadId = await chrome.downloads.download({ url: zipResult.blobUrl, filename, saveAs, conflictAction: "uniquify" });
    revokeBlobWhenDownloadSettles(downloadId, zipResult.blobUrl);
    return { filename, fileCount: zipResult.fileCount };
  }
  let text;
  let filename;
  let mime = "text/markdown";
  if (message.what === "json") {
    text = JSON.stringify(site, null, 2);
    filename = `${slug}_site-structure.json`;
    mime = "application/json";
  } else if (message.what === "page") {
    const page = site.pages.find((candidate) => candidate.path === message.path);
    if (!page) throw new Error("Page introuvable dans le dernier scan.");
    text = generatePageMarkdown(page, site);
    filename = `${slug}_${page.slug}.md`;
  } else {
    text = generateSiteStructureMarkdown(site);
    filename = `${slug}_SITE_STRUCTURE.md`;
  }
  await chrome.downloads.download({ url: `data:${mime};charset=utf-8,${encodeURIComponent(text)}`, filename, saveAs, conflictAction: "uniquify" });
  return { filename, bytes: text.length };
}
