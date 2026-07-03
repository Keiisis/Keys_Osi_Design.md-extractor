import { normalizeExtractedStyles } from "./lib/normalize.mjs";
import { formatAuditSections, generateDesignMarkdown } from "./lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "./lib/generate-skill-md.mjs";
import { validateMarkdownOutput } from "./lib/validate.mjs";
import { processCssAssets } from "./lib/css-assets.mjs";
import { generateTailwindConfig, generateW3cTokens } from "./lib/export-tokens.mjs";
import { generateDiffMarkdown } from "./lib/diff-tokens.mjs";

const EXTRACTION_MESSAGE = "TYPEUI_EXTRACT_STYLES";
const HISTORY_KEY = "extractionHistory";
const HISTORY_LIMIT = 15;
const MCP_BRIDGE_URL = "http://127.0.0.1:8765";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    outputMode: "design"
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return;
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

  if (message.type === "EXPORT_TOKENS") {
    try {
      const normalized = message.normalized;
      if (!normalized) {
        throw new Error("No extraction data available yet.");
      }
      sendResponse({
        ok: true,
        w3cTokens: JSON.stringify(generateW3cTokens(normalized), null, 2),
        tailwindConfig: generateTailwindConfig(normalized)
      });
    } catch (error) {
      sendResponse({ ok: false, error: stringifyError(error) });
    }
    return;
  }
});

async function handleExtraction(message) {
  const mode = message.mode === "skill" ? "skill" : "design";
  const tab = await getActiveTab();
  await injectExtractor(tab.id);
  await injectMainWorldInspector(tab.id);
  const payload = await requestExtractionPayload(tab.id);
  const normalized = normalizeExtractedStyles(payload);

  const context = {
    normalized
  };

  const markdown =
    mode === "skill"
      ? generateSkillMarkdown(context)
      : generateDesignMarkdown(context);

  const validation = validateMarkdownOutput(mode, markdown);
  const filename = mode === "skill" ? "SKILL.md" : "DESIGN.md";

  if (message.persistOutputMode !== false) {
    await chrome.storage.local.set({
      outputMode: mode
    });
  }

  await saveToHistory(normalized).catch(() => {});

  return {
    mode,
    filename,
    markdown,
    normalized,
    validation
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
  const filename = String(message.filename || "export.txt").replace(/[\\/]/g, "").trim();
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

  const filename = String(message.filename || "design_tokens.json").replace(/[\\/]/g, "").trim();
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
    throw new Error("No active tab available.");
  }
  if (String(tab.url || "").startsWith("chrome://")) {
    throw new Error("Extraction is not available on chrome:// pages.");
  }
  return tab;
}

async function injectExtractor(tabId) {
  try {
    const alreadyInjected = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "TYPEUI_PING" }, (response) => {
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

function stringifyError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "Unknown error");
}

function normalizeMarkdownFilename(inputName, mode) {
  const normalizedMode = mode === "skill" ? "skill" : "design";
  const fallback = normalizedMode === "skill" ? "SKILL.md" : "DESIGN.md";
  const raw = String(inputName || "").trim();

  if (!raw) {
    return fallback;
  }

  const name = raw.replace(/[\\/]/g, "").trim();
  if (!name) {
    return fallback;
  }

  if (normalizedMode === "skill") {
    if (/^skill(\.md)?$/i.test(name)) {
      return "SKILL.md";
    }
    return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
  }

  if (/^design(\.md)?$/i.test(name)) {
    return "DESIGN.md";
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
    const links = await sendTabMessage(tab.id, { type: "TYPEUI_LIST_LINKS" })
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
    type: "TYPEUI_COPY_SITE",
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

  const siteName = String(tab.title || "cloned_site")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()
    .slice(0, 30) || "cloned_site";

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
      `design_extractor_clones/${siteName}`,
      zipFiles
    );
    return {
      fileCount,
      pageCount: pages.length,
      screenshotCount: screenshots.length,
      skipped: 0,
      path: `design_extractor_clones/${siteName}`,
      packaging: "files"
    };
  }
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
    const openResult = await sendTabMessage(tab.id, { type: "TYPEUI_SAFE_INTERACT_OPEN" });
    if (!openResult.opened || openResult.opened === 0) {
      return null;
    }
    await sleep(650);
    let screenshotBase64 = null;
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      screenshotBase64 = String(dataUrl || "").split(",")[1] || null;
    } catch (error) {}
    await sendTabMessage(tab.id, { type: "TYPEUI_SAFE_INTERACT_CLOSE" }).catch(() => {});
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
    const metrics = await sendTabMessage(tab.id, { type: "TYPEUI_PAGE_METRICS" });
    const viewportHeight = Math.max(200, Number(metrics.viewportHeight) || 800);
    const scrollHeight = Math.max(viewportHeight, Number(metrics.scrollHeight) || viewportHeight);
    const steps = Math.min(12, Math.ceil(scrollHeight / viewportHeight));

    for (let i = 0; i < steps; i++) {
      await sendTabMessage(tab.id, { type: "TYPEUI_SCROLL_TO", y: i * viewportHeight });
      // captureVisibleTab is rate-limited to ~2 calls per second.
      await sleep(620);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const base64 = String(dataUrl || "").split(",")[1];
      if (base64) {
        shots.push(base64);
      }
    }
    await sendTabMessage(tab.id, { type: "TYPEUI_SCROLL_TO", y: 0 }).catch(() => {});
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
      type: "TYPEUI_COPY_SITE",
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

async function buildZipViaOffscreen(files) {
  await ensureOffscreenDocument();
  const result = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "TYPEUI_BUILD_ZIP",
    files
  });
  if (!result || !result.ok) {
    throw new Error(result?.error || "ZIP packaging failed.");
  }
  return result;
}

function revokeBlobWhenDownloadSettles(downloadId, blobUrl) {
  const onChanged = (delta) => {
    if (delta.id !== downloadId || !delta.state) {
      return;
    }
    if (delta.state.current === "complete" || delta.state.current === "interrupted") {
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.runtime
        .sendMessage({ target: "offscreen", type: "TYPEUI_REVOKE_ZIP", blobUrl })
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
      func: () => {
        const gsapInfo = {
          detected: false,
          version: null,
          timelines: []
        };

        if (window.gsap) {
          gsapInfo.detected = true;
          gsapInfo.version = window.gsap.version || "unknown";

          try {
            const children = window.gsap.globalTimeline.getChildren(true, true, true);
            gsapInfo.timelines = children.slice(0, 10).map(t => {
              return {
                type: t.constructor.name || "Tween",
                duration: typeof t.duration === 'function' ? t.duration() : (t.duration || 0),
                delay: typeof t.delay === 'function' ? t.delay() : (t.delay || 0),
                vars: t.vars ? Object.keys(t.vars).filter(k => typeof t.vars[k] !== 'function') : []
              };
            });
          } catch (e) {}
        }

        const frameworks = [];
        const add = (name, evidence) => frameworks.push({ name, evidence });
        try {
          const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
          if ((hook && hook.renderers && hook.renderers.size > 0) || window.React) {
            add("React", "runtime global");
          }
          if (window.next || window.__NEXT_DATA__) add("Next.js", "window.__NEXT_DATA__");
          if (window.__VUE__ || window.__VUE_DEVTOOLS_GLOBAL_HOOK__) add("Vue", "runtime global");
          if (window.__NUXT__ || window.useNuxtApp) add("Nuxt", "window.__NUXT__");
          if (window.ng || window.getAllAngularRootElements) add("Angular", "runtime global");
          if (window.__svelte) add("Svelte", "window.__svelte");
          if (window.Shopify) add("Shopify", "window.Shopify");
          if (window.Webflow) add("Webflow", "window.Webflow");
          if (window.wixBiSession) add("Wix", "window.wixBiSession");
          if (window.wp && window.wp.blocks) add("WordPress", "window.wp.blocks");
          if (window.jQuery && window.jQuery.fn) {
            add("jQuery", `v${window.jQuery.fn.jquery || "?"}`);
          }
          if (window.Alpine) add("Alpine.js", "window.Alpine");
          if (window.htmx) add("htmx", "window.htmx");
        } catch (e) {}

        let meta = document.getElementById("__typeui_gsap_data");
        if (!meta) {
          meta = document.createElement("div");
          meta.id = "__typeui_gsap_data";
          meta.style.display = "none";
          document.body.appendChild(meta);
        }
        meta.setAttribute("data-gsap", JSON.stringify({ gsap: gsapInfo, frameworks }));
      }
    });
  } catch (e) {
    // ignore
  }
}
