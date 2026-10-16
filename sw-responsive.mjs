/**
 * Keys_Osi responsive capture, service worker side. The tab's viewport is
 * emulated through chrome.debugger (optional permission, asked from the
 * panel) at each width; responsive-probe.js measures the layout, the
 * breakpoints come from every stylesheet through CDP (cross-origin too).
 * withViewports() is shared with the code clone.
 */
import { RESPONSIVE_WIDTHS, generateResponsiveMarkdown, responsivePromptBlock, summarizeResponsive } from "./lib/responsive.mjs";

export const RESPONSIVE_KEY = "keysOsiResponsive";
const HEIGHTS = { 375: 812, 768: 1024, 1024: 768, 1440: 900 };
const SETTLE_MS = 700;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function cdp(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

function attach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      const error = chrome.runtime.lastError;
      if (!error) return resolve();
      if (/already attached/i.test(error.message)) reject(new Error("Un débogueur est déjà attaché à cet onglet (DevTools ouvert ?) : ferme-le puis relance."));
      else reject(new Error(error.message));
    });
  });
}

/**
 * Emulates each width on the tab, runs `each({ width, height, target })`,
 * then restores the real viewport and detaches, even on error. Widths not
 * listed in HEIGHTS get a 900px-tall viewport.
 */
export async function withViewports(tabId, widths, each, { onAttached } = {}) {
  if (!chrome.debugger) {
    throw new Error("Autorise l'accès « debugger » : il sert à simuler les largeurs d'écran sur cet onglet.");
  }
  const target = { tabId };
  await attach(target);
  try {
    await cdp(target, "Page.enable");
    // onAttached may pick the widths once it has read the page (code clone).
    const picked = onAttached ? await onAttached(target) : null;
    const results = [];
    for (const width of Array.isArray(picked) ? picked : widths) {
      const height = HEIGHTS[width] || 900;
      await cdp(target, "Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 1024 });
      await sleep(SETTLE_MS);
      results.push(await each({ width, height, target }));
    }
    return results;
  } finally {
    await cdp(target, "Emulation.clearDeviceMetricsOverride").catch(() => {});
    await new Promise((resolve) => chrome.debugger.detach(target, () => resolve(void chrome.runtime.lastError)));
  }
}

/** Every media query of the page, cross-origin sheets included. */
export async function cdpMediaTexts(target) {
  try {
    await cdp(target, "DOM.enable");
    await cdp(target, "CSS.enable");
    const { medias = [] } = await cdp(target, "CSS.getMediaQueries");
    return medias.map((media) => media.text).filter(Boolean);
  } catch (error) {
    return [];
  } finally {
    await cdp(target, "CSS.disable").catch(() => {});
    await cdp(target, "DOM.disable").catch(() => {});
  }
}

const progress = (message) => chrome.runtime.sendMessage({ type: "RESPONSIVE_PROGRESS", message }).catch(() => {});

async function capture(message) {
  const tabId = Number(message.tabId);
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/i.test(tab.url || "")) throw new Error("Ouvre une page web pour la capture responsive.");
  await chrome.scripting.executeScript({ target: { tabId }, files: ["responsive-probe.js"] });
  let cdpMedia = [];
  const snapshots = await withViewports(
    tabId,
    RESPONSIVE_WIDTHS,
    async ({ width, target }) => {
      progress(`Mesure à ${width}px…`);
      const [{ result: snapshot }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__keysOsiLayout.snapshot() });
      let screenshot = null;
      try {
        // First screen only: a beyond-viewport capture resizes the page and
        // stretches every 100vh section.
        screenshot = (await cdp(target, "Page.captureScreenshot", { format: "jpeg", quality: 78 })).data;
      } catch (error) {}
      // A page without <meta name=viewport> lays out wider than the phone.
      return { ...snapshot, width, layoutWidth: snapshot.width, screenshot };
    },
    {
      onAttached: async (target) => {
        cdpMedia = await cdpMediaTexts(target);
      }
    }
  );
  const [{ result: extra }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__keysOsiLayout.finish() });
  const summary = summarizeResponsive({
    url: tab.url,
    title: tab.title || "",
    mediaTexts: cdpMedia.length ? cdpMedia : extra.mediaTexts,
    snapshots: snapshots.map(({ screenshot, ...snapshot }) => snapshot),
    visibility: extra.visibility
  });
  const screenshots = snapshots.map((snapshot) => ({ width: snapshot.width, data: snapshot.screenshot })).filter((shot) => shot.data);
  await chrome.storage.local.set({ [RESPONSIVE_KEY]: { summary, screenshots } });
  return { summary, screenshots };
}

async function exportResponsive(message, deps) {
  const { [RESPONSIVE_KEY]: stored } = await chrome.storage.local.get(RESPONSIVE_KEY);
  if (!stored) throw new Error("Lance d'abord la capture responsive.");
  const { summary, screenshots } = stored;
  const name = new URL(summary.url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  const saveAs = keysOsiSaveAs !== false;
  if (message.what === "zip") {
    const files = [
      { path: "RESPONSIVE.md", content: generateResponsiveMarkdown(summary, { withScreenshots: screenshots.length > 0 }) },
      { path: "responsive.json", content: JSON.stringify(summary, null, 2) },
      ...screenshots.map((shot) => ({ path: `responsive/${shot.width}.jpg`, base64: shot.data }))
    ];
    const zip = await deps.buildZip(files);
    const filename = `${name}_responsive.zip`;
    const downloadId = await chrome.downloads.download({ url: zip.blobUrl, filename, saveAs, conflictAction: "uniquify" });
    deps.revokeLater(downloadId, zip.blobUrl);
    return { filename, fileCount: zip.fileCount };
  }
  const text = generateResponsiveMarkdown(summary);
  const filename = `${name}_RESPONSIVE.md`;
  await chrome.downloads.download({ url: `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`, filename, saveAs, conflictAction: "uniquify" });
  return { filename };
}

/** Last capture for this origin, if any: summary only. */
export async function responsiveFor(url) {
  const { [RESPONSIVE_KEY]: stored } = await chrome.storage.local.get(RESPONSIVE_KEY);
  try {
    if (stored && new URL(stored.summary.url).origin === new URL(url).origin) return stored.summary;
  } catch (error) {}
  return null;
}

/** DESIGN.md section and PROMPT_PRO block from the last capture of this origin. */
export async function responsiveSectionFor(url) {
  const summary = await responsiveFor(url);
  return summary ? `## Responsive Behavior\n\nMeasured at ${summary.widths.map((w) => `${w}px`).join(", ")} by Keys_Osi.\n\n${responsivePromptBlock(summary)}\n` : "";
}

export function handleResponsiveMessage(message, deps) {
  switch (message.type) {
    case "RESPONSIVE_CAPTURE":
      return capture(message);
    case "RESPONSIVE_LAST":
      return chrome.storage.local.get(RESPONSIVE_KEY).then((data) => data[RESPONSIVE_KEY] || { summary: null, screenshots: [] });
    case "RESPONSIVE_EXPORT":
      return exportResponsive(message, deps);
    default:
      return null;
  }
}
