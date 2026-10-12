/**
 * Keys_Osi site crawler (offscreen document): robots.txt + sitemaps + link
 * discovery, polite concurrent fetches, DOMParser page models, and live
 * rendering (through the service worker) for pages whose HTML is an empty
 * JavaScript shell. Reports SITE_PROGRESS while running and SITE_RESULT at
 * the end; no MV3 worker time limit applies here.
 */
import {
  analyzeSite,
  createCrawlState,
  enqueueUrl,
  nextCrawlTarget,
  normalizeCrawlUrl,
  parseRobots,
  parseSitemap,
  pathKey
} from "../lib/site-structure.mjs";

const jobs = new Map();
const MAX_SITEMAP_FILES = 12;
const MAX_SITEMAP_URLS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, timeoutMs, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { credentials: "omit", redirect: "follow", ...init, signal: controller.signal });
  } catch (error) {
    throw new Error(error.name === "AbortError" ? `délai dépassé (${Math.round(timeoutMs / 1000)} s)` : "réseau injoignable");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeoutMs = 12000) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function post(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function readSitemaps(origin, robots, job) {
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set();
  const urls = [];
  while (queue.length && seen.size < MAX_SITEMAP_FILES && urls.length < MAX_SITEMAP_URLS && !job.cancelled) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    let xml;
    try {
      xml = await fetchText(url);
    } catch (error) {
      continue;
    }
    // Gzipped sitemaps arrive decoded by fetch only when served with
    // Content-Encoding; raw .gz files are skipped.
    if (!/<(urlset|sitemapindex)[\s>]/i.test(xml)) continue;
    const parsed = parseSitemap(xml);
    queue.push(...parsed.sitemaps.filter((loc) => !/\.gz$/i.test(loc)));
    for (const entry of parsed.urls) {
      if (urls.length >= MAX_SITEMAP_URLS) break;
      urls.push(entry.loc);
    }
  }
  return urls;
}

function parseHtml(html, finalUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // DOMParser documents inherit the extension URL: pin relative links to the page.
  const existing = doc.querySelector("base[href]");
  if (existing) {
    existing.setAttribute("href", new URL(existing.getAttribute("href"), finalUrl).href);
  } else if (doc.head) {
    const base = doc.createElement("base");
    base.setAttribute("href", finalUrl);
    doc.head.prepend(base);
  }
  return doc;
}

async function analyzeUrl(target, state, job, options) {
  const response = await fetchWithTimeout(target.url, 20000, { headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" } });
  const finalUrl = normalizeCrawlUrl(response.url || target.url, state.origin);
  if (!finalUrl) throw new Error("redirection hors du site");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (type && !/html|xml/i.test(type)) throw new Error(`pas une page HTML (${type.split(";")[0]})`);
  if (finalUrl !== target.url) {
    // A redirect may land on a page already analysed (/home → /).
    if (job.analyzedPaths.has(pathKey(finalUrl))) return null;
    state.seen.add(finalUrl);
  }
  const html = await response.text();
  let model = globalThis.KeysOsiPageModel.analyzeDocument(parseHtml(html, finalUrl), { url: finalUrl, status: response.status });

  if (model.spa.needsRender && options.render !== false && job.renderBudget > 0) {
    job.renderBudget -= 1;
    post({ type: "SITE_PROGRESS", jobId: job.id, phase: "render", current: finalUrl, ...counters(state, job) });
    const rendered = await chrome.runtime
      .sendMessage({ type: "SITE_RENDER_PAGE", jobId: job.id, url: finalUrl })
      .catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (rendered?.ok && rendered.model) {
      model = { ...rendered.model, url: finalUrl, path: pathKey(finalUrl), rendered: true, status: response.status };
    } else {
      job.renderFailures.push({ url: finalUrl, error: rendered?.error || "rendu impossible" });
    }
  }

  // Canonical duplicates (?ref=…, alternate paths) count once.
  const canonical = model.canonical ? normalizeCrawlUrl(model.canonical, state.origin) : null;
  if (canonical && canonical !== finalUrl && job.analyzedPaths.has(pathKey(canonical))) return null;
  job.analyzedPaths.add(pathKey(finalUrl));
  return { ...model, url: finalUrl, path: pathKey(finalUrl) };
}

function counters(state, job) {
  return {
    discovered: state.seen.size,
    analyzed: job.pages.length,
    queued: state.queue.length,
    listed: state.listed.length,
    failed: job.failures.length,
    rendered: job.pages.filter((page) => page.rendered).length,
    budget: state.maxPages
  };
}

async function crawl(job, startUrl, options) {
  const origin = new URL(startUrl).origin;
  post({ type: "SITE_PROGRESS", jobId: job.id, phase: "robots", current: `${origin}/robots.txt`, discovered: 0, analyzed: 0 });
  const robots = parseRobots(await fetchText(`${origin}/robots.txt`).catch(() => ""));
  const state = createCrawlState({
    startUrl: `${origin}/`,
    maxPages: options.maxPages,
    samplePerTemplate: options.samplePerTemplate,
    robots
  });
  // The page the user is on is crawled right after the home page.
  if (startUrl !== state.startUrl) enqueueUrl(state, startUrl, { depth: 1, source: "nav" });

  post({ type: "SITE_PROGRESS", jobId: job.id, phase: "sitemap", current: "sitemap.xml", ...counters(state, job) });
  const sitemapUrls = options.useSitemap === false ? [] : await readSitemaps(origin, robots, job);
  for (const url of sitemapUrls) enqueueUrl(state, url, { depth: 1, source: "sitemap" });
  for (const url of options.seedUrls || []) enqueueUrl(state, url, { depth: 1, source: "sitemap" });

  const delay = robots.crawlDelay ? Math.min(robots.crawlDelay * 1000, 5000) : options.delayMs;
  const concurrency = robots.crawlDelay ? 1 : options.concurrency;
  let inFlight = 0;

  const worker = async () => {
    while (!job.cancelled) {
      const target = nextCrawlTarget(state);
      if (!target) {
        if (inFlight === 0) return;
        // Pages in flight may still discover new links.
        await sleep(120);
        continue;
      }
      inFlight += 1;
      try {
        const page = await analyzeUrl(target, state, job, options);
        if (page) {
          page.depth = target.depth;
          page.discoveredFrom = target.source;
          job.pages.push(page);
          for (const link of page.internalLinks) {
            const source = link.context === "nav" ? "nav" : link.context === "footer" ? "footer" : "content";
            if (!/nofollow/.test(link.rel || "")) enqueueUrl(state, link.href, { depth: target.depth + 1, source });
          }
        }
      } catch (error) {
        job.failures.push({ url: target.url, error: error instanceof Error ? error.message : String(error) });
      } finally {
        inFlight -= 1;
      }
      post({ type: "SITE_PROGRESS", jobId: job.id, phase: "crawl", current: target.url, ...counters(state, job) });
      await sleep(delay);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  post({ type: "SITE_PROGRESS", jobId: job.id, phase: "analyze", ...counters(state, job) });
  // Whatever the budget left unvisited is listed, so the map stays complete.
  const leftovers = state.queue.map((entry) => ({ url: entry.url, pattern: "" }));
  return analyzeSite({
    startUrl: state.startUrl,
    pages: job.pages,
    listed: [...state.listed, ...leftovers],
    failures: [...job.failures, ...job.renderFailures],
    robotsExcluded: state.robotsExcluded,
    sitemapUrls,
    options: { ...options, seedUrls: undefined, seedCount: (options.seedUrls || []).length, cancelled: Boolean(job.cancelled) }
  });
}

/** Starts a crawl; resolves immediately, reports through runtime messages. */
export function startSiteCrawl({ jobId, startUrl, options = {} }) {
  const settings = {
    maxPages: Math.max(1, Math.min(500, Number(options.maxPages) || 50)),
    samplePerTemplate: Math.max(1, Math.min(10, Number(options.samplePerTemplate) || 3)),
    render: options.render !== false,
    useSitemap: options.useSitemap !== false,
    concurrency: Math.max(1, Math.min(6, Number(options.concurrency) || 4)),
    delayMs: Math.max(0, Number(options.delayMs ?? 150)),
    seedUrls: Array.isArray(options.seedUrls) ? options.seedUrls.slice(0, 300) : [],
    tech: options.tech || null
  };
  const job = { id: jobId, cancelled: false, pages: [], failures: [], renderFailures: [], analyzedPaths: new Set(), renderBudget: Math.max(0, Math.min(40, Number(options.maxRenders) || 20)) };
  jobs.set(jobId, job);
  crawl(job, startUrl, settings)
    .then((site) => post({ type: "SITE_RESULT", jobId, ok: true, site }))
    .catch((error) => post({ type: "SITE_RESULT", jobId, ok: false, error: error instanceof Error ? error.message : String(error) }))
    .finally(() => jobs.delete(jobId));
}

export function cancelSiteCrawl(jobId) {
  const job = jobs.get(jobId);
  if (job) job.cancelled = true;
  return Boolean(job);
}
