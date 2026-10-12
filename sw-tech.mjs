/**
 * Keys_Osi technical decoding, service worker side: probes the page's
 * runtime, fetches its first-party bundles, build manifests and public
 * source maps, and keeps the report. Routes found here seed the site
 * structure crawl; original sources export as a ZIP.
 */
import { reaSectionFor } from "./sw-rea.mjs";
import {
  buildSourceZipFiles,
  buildTechReport,
  decodeInlineSourceMap,
  findSourceMapUrl,
  generateTechMarkdown,
  parseNextBuildManifest,
  parseSourceMap,
  routesFromAppChunks,
  routesFromRemix,
  routesFromSourcePaths,
  scanBundle
} from "./lib/tech-decode.mjs";

export const TECH_KEY = "keysOsiLastTech";
const MAX_BUNDLES = 40;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_MAPS = 40;
const MAX_MAP_BYTES = 30 * 1024 * 1024;

async function fetchWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { credentials: "omit", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCapped(url, maxBytes) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("trop volumineux");
  const text = await response.text();
  if (text.length > maxBytes) throw new Error("trop volumineux");
  return { text, headers: Object.fromEntries([...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value])) };
}

async function pool(items, size, worker) {
  const results = [];
  let index = 0;
  const run = async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i]).catch((error) => ({ error: String(error?.message || error) }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

function sameSiteOrBuild(url, origin) {
  try {
    const parsed = new URL(url);
    const host = (h) => h.replace(/^www\./, "");
    if (host(parsed.hostname) === host(new URL(origin).hostname)) return true;
    // Framework asset CDNs of the same project (assetPrefix, *.vercel.app, cdn subdomain).
    return /\/(_next|_nuxt|_astro|_app|assets|static|build|dist|js)\//.test(parsed.pathname) && parsed.hostname.split(".").slice(-2).join(".") === new URL(origin).hostname.split(".").slice(-2).join(".");
  } catch (error) {
    return false;
  }
}

async function loadMaps(mapRefs) {
  const maps = await pool(mapRefs.slice(0, MAX_MAPS), 4, async (ref) => {
    const json = ref.mapUrl.startsWith("data:") ? decodeInlineSourceMap(ref.mapUrl) : JSON.parse((await fetchCapped(ref.mapUrl, MAX_MAP_BYTES)).text);
    if (!json) throw new Error("source map illisible");
    return { url: ref.mapUrl.startsWith("data:") ? `${ref.scriptUrl} (inline)` : ref.mapUrl, files: parseSourceMap(json) };
  });
  return maps.filter((map) => map && !map.error);
}

async function decode({ tabId }) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!/^https?:/i.test(tab.url || "")) throw new Error("Ouvre le site à décoder (http/https).");
  const origin = new URL(tab.url).origin;
  const [{ result: probe }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["tech-probe.js"] });
  if (!probe) throw new Error("La page n'a pas répondu à la sonde.");

  let headers = {};
  try {
    headers = (await fetchCapped(tab.url, 16 * 1024 * 1024)).headers;
  } catch (error) {
    // Headers are a bonus; the runtime probe already answers most questions.
  }

  const scriptUrls = [...new Set([...probe.scripts, ...probe.resources.filter((resource) => resource.type === "script").map((resource) => resource.url)])]
    .filter((url) => /^https?:/.test(url) && sameSiteOrBuild(url, origin))
    .slice(0, MAX_BUNDLES);
  const bundles = (
    await pool(scriptUrls, 6, async (url) => {
      const { text, headers: scriptHeaders } = await fetchCapped(url, MAX_BUNDLE_BYTES);
      const scan = scanBundle(text);
      const mapUrl = findSourceMapUrl(text, url, scriptHeaders);
      return { url, bytes: text.length, ...scan, sourceMap: mapUrl && !mapUrl.startsWith("data:") ? mapUrl : mapUrl ? "inline" : null, mapRef: mapUrl ? { scriptUrl: url, mapUrl } : null };
    })
  ).filter((bundle) => bundle && !bundle.error);

  const mapRefs = bundles.map((bundle) => bundle.mapRef).filter(Boolean);
  const maps = await loadMaps(mapRefs);

  const routes = [];
  const next = probe.frameworks.find((entry) => entry.name === "Next.js");
  if (next?.buildId) {
    try {
      const prefix = next.assetPrefix ? new URL(next.assetPrefix, origin).href.replace(/\/$/, "") : origin;
      const { text } = await fetchCapped(`${prefix}/_next/static/${next.buildId}/_buildManifest.js`, 4 * 1024 * 1024);
      routes.push({ source: "Next.js build manifest", list: parseNextBuildManifest(text) });
    } catch (error) {}
  }
  const appChunks = routesFromAppChunks([...probe.scripts, ...probe.resources.map((resource) => resource.url)]);
  if (appChunks.length) routes.push({ source: "Next.js app chunks", list: appChunks });
  const remix = probe.frameworks.find((entry) => entry.routes?.length);
  if (remix) routes.push({ source: "Remix / React Router manifest", list: routesFromRemix(remix.routes) });
  const fromSources = routesFromSourcePaths(maps.flatMap((map) => map.files.filter((file) => !file.external).map((file) => file.path)));
  if (fromSources.length) routes.push({ source: "source map file tree", list: fromSources });

  const report = buildTechReport({ probe, headers, bundles, maps, routes });
  await chrome.storage.local.set({ [TECH_KEY]: { report, mapRefs } });
  return { summary: summarize(report) };
}

function summarize(report) {
  if (!report) return null;
  return {
    origin: report.origin,
    decodedAt: report.decodedAt,
    frameworks: report.frameworks.map((entry) => `${entry.name}${entry.version ? ` ${entry.version}` : ""}`),
    css: report.css.map((entry) => entry.name),
    hosting: report.hosting.hosting,
    services: report.services,
    routes: report.routes.length,
    endpoints: report.endpoints.length,
    graphql: report.graphql.length,
    sourceMaps: report.sourceMaps.length,
    sourceFiles: report.sourceStats.withContent
  };
}

async function exportTech(message, deps) {
  const { [TECH_KEY]: stored } = await chrome.storage.local.get(TECH_KEY);
  if (!stored) throw new Error("Lance d'abord le décodage technique.");
  const { report, mapRefs } = stored;
  const name = new URL(report.origin).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-");
  const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
  const saveAs = keysOsiSaveAs !== false;
  if (message.what === "sources") {
    const maps = await loadMaps(mapRefs);
    const files = buildSourceZipFiles(maps, { includeDependencies: Boolean(message.includeDependencies) });
    if (files.length === 0) throw new Error("Aucune source originale publiée par ce site (source maps absentes ou sans contenu).");
    files.push({ path: "TECH_STACK.md", content: generateTechMarkdown(report) });
    const zip = await deps.buildZip(files);
    const filename = `${name}_sources.zip`;
    const downloadId = await chrome.downloads.download({ url: zip.blobUrl, filename, saveAs, conflictAction: "uniquify" });
    deps.revokeLater(downloadId, zip.blobUrl);
    return { filename, fileCount: zip.fileCount };
  }
  const json = message.what === "json";
  const rea = json ? "" : await reaSectionFor(report.origin);
  const text = json ? JSON.stringify(report, null, 2) : `${generateTechMarkdown(report)}${rea ? `\n${rea}` : ""}`;
  const filename = json ? `${name}_tech-stack.json` : `${name}_TECH_STACK.md`;
  await chrome.downloads.download({ url: `data:${json ? "application/json" : "text/markdown"};charset=utf-8,${encodeURIComponent(text)}`, filename, saveAs, conflictAction: "uniquify" });
  return { filename };
}

/** Same-origin routes from the last decode, to seed the structure crawl. */
export async function techSeedUrls(origin) {
  const { [TECH_KEY]: stored } = await chrome.storage.local.get(TECH_KEY);
  if (!stored || stored.report.origin !== origin) return { seeds: [], tech: null };
  const seeds = stored.report.routes.filter((route) => !/[[\]:*$]/.test(route)).map((route) => origin + route).slice(0, 300);
  return { seeds, tech: summarize(stored.report) };
}

export function handleTechMessage(message, deps) {
  switch (message.type) {
    case "TECH_DECODE":
      return decode(message);
    case "TECH_STATE":
      return chrome.storage.local.get(TECH_KEY).then((data) => ({ summary: summarize(data[TECH_KEY]?.report) }));
    case "TECH_EXPORT":
      return exportTech(message, deps);
    default:
      return null;
  }
}
