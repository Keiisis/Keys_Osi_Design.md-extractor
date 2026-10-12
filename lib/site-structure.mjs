/**
 * Keys_Osi site structure: crawl planning (robots.txt, sitemaps, URL
 * normalisation, route templates) and whole-site analysis of the page
 * models produced by lib/page-model.js, rendered as AI-ready documents:
 * SITE_STRUCTURE.md, one pages/<slug>.md per page, and a JSON twin.
 *
 * Pure functions: run in the service worker, the offscreen crawler and Node.
 */

const TRACKING_PARAM = /^(utm_|gclid$|fbclid$|msclkid$|mc_cid$|mc_eid$|_ga$|_gl$|ref$|ref_src$|igshid$|yclid$|_hs|hsa_|srsltid$)/i;
// Query keys that change the page meaningfully; every other key (filters,
// sorts, sessions) is dropped so faceted navigation cannot explode the crawl.
const KEPT_PARAMS = new Set(["page", "p", "lang", "locale", "id", "lng"]);
const NON_HTML_EXT = /\.(pdf|zip|rar|7z|gz|tgz|dmg|exe|msi|apk|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|avi|mp3|wav|ogg|m4a|woff2?|ttf|otf|eot|css|js|mjs|json|xml|rss|atom|txt|csv|ics|glb|gltf|stl|usdz|wasm|map)$/i;
const SKIP_PATH = /(\/wp-admin|\/wp-json|\/wp-login|\/xmlrpc|\/cdn-cgi\/|\/feed\/?$|\/log-?out|\/sign-?out|\/deconnexion|\/cart\/add|add-to-cart|\/api\/|\/graphql|\/_next\/|\/_nuxt\/|\/static\/|\/assets\/|\/print\/)/i;
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;
const COMMON_LOCALES = new Set(["en", "fr", "de", "es", "it", "pt", "nl", "ja", "zh", "ko", "ru", "pl", "sv", "da", "fi", "no", "nb", "tr", "ar", "he", "cs", "el", "hu", "ro", "uk", "id", "th", "vi"]);
const COLLECTION_PARENT = /^(blog|news|actualites?|articles?|posts?|journal|magazine|insights|stories|ressources|resources|products?|produits?|shop|boutique|store|collections?|categor(y|ies)|categories|tags?|authors?|auteurs?|events?|evenements?|jobs?|careers?|offres-emploi|case-studies|customers|clients|realisations|portfolio|projets?|projects?|work|docs?|guides?|help|aide|recipes?|recettes?|listings?|annonces?|properties|biens|team|equipe|p|item|items|t|c)$/i;

export function hostKey(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

/**
 * Canonical crawl URL, or null when the link must not be crawled
 * (other site, non-HTML file, admin/logout/API route, unsupported scheme).
 */
export function normalizeCrawlUrl(href, origin) {
  let url;
  let base;
  try {
    base = new URL(origin);
    url = new URL(href, base);
  } catch (error) {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || hostKey(url.hostname) !== hostKey(base.hostname)) {
    return null;
  }
  // http/https and www/apex variants are the same page for the crawl.
  url.protocol = base.protocol;
  url.hostname = base.hostname;
  url.port = base.port;
  url.hash = "";
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key) || !KEPT_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (NON_HTML_EXT.test(path) || SKIP_PATH.test(path + url.search)) {
    return null;
  }
  path = path.replace(/\/index\.(html?|php)$/i, "/");
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  url.pathname = path || "/";
  return url.href;
}

export function pathKey(url) {
  try {
    const parsed = new URL(url);
    return (parsed.pathname || "/") + (parsed.search || "");
  } catch (error) {
    return String(url || "/");
  }
}

// ---------------------------------------------------------------- robots.txt

/** Rules of the group that applies to us (our name if present, else "*"). */
export function parseRobots(text, agent = "keysosi") {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      current.rules.push({ type: field, path: value });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) current.crawlDelay = seconds;
    }
  }
  const own = groups.find((group) => group.agents.some((name) => name !== "*" && agent.toLowerCase().includes(name)));
  const chosen = own || groups.find((group) => group.agents.includes("*")) || { rules: [], crawlDelay: null };
  return { rules: chosen.rules, crawlDelay: chosen.crawlDelay, sitemaps };
}

function robotsPatternToRegex(pattern) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest matching rule wins; Allow wins a tie (RFC 9309). */
export function isAllowedByRobots(pathWithQuery, robots) {
  if (!robots || !robots.rules || robots.rules.length === 0) return true;
  let best = null;
  for (const rule of robots.rules) {
    if (rule.type === "disallow" && rule.path === "") continue;
    if (!robotsPatternToRegex(rule.path).test(pathWithQuery)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.type === "allow")) {
      best = { type: rule.type, length };
    }
  }
  return !best || best.type === "allow";
}

// ---------------------------------------------------------------- sitemaps

function decodeXml(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

export function parseSitemap(xml) {
  const text = String(xml || "");
  const isIndex = /<sitemapindex[\s>]/i.test(text);
  const entries = [];
  const blockRe = isIndex ? /<sitemap[\s>][\s\S]*?<\/sitemap>/gi : /<url[\s>][\s\S]*?<\/url>/gi;
  for (const block of text.match(blockRe) || []) {
    const loc = (block.match(/<loc>([\s\S]*?)<\/loc>/i) || [])[1];
    if (!loc) continue;
    const lastmod = (block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i) || [])[1];
    entries.push({ loc: decodeXml(loc), lastmod: lastmod ? decodeXml(lastmod) : "" });
  }
  return isIndex ? { sitemaps: entries.map((entry) => entry.loc), urls: [] } : { sitemaps: [], urls: entries };
}

// ---------------------------------------------------------------- route templates

function looksDynamic(segment) {
  return (
    /\d/.test(segment) ||
    segment.length >= 16 ||
    segment.split("-").length >= 3 ||
    /^[0-9a-f]{8,}$/i.test(segment) ||
    /^[0-9a-f-]{32,36}$/i.test(segment)
  );
}

function isIdSegment(segment) {
  return /^\d+$/.test(segment) || /^[0-9a-f-]{32,36}$/i.test(segment) || /^[0-9a-f]{12,}$/i.test(segment);
}

export function detectLocales(paths) {
  const counts = new Map();
  for (const path of paths) {
    const first = path.split("?")[0].split("/").filter(Boolean)[0];
    if (first && LOCALE_SEGMENT.test(first) && COMMON_LOCALES.has(first.slice(0, 2).toLowerCase())) {
      counts.set(first.toLowerCase(), (counts.get(first.toLowerCase()) || 0) + 1);
    }
  }
  return counts.size >= 2 || [...counts.values()].some((count) => count >= 3) ? new Set(counts.keys()) : new Set();
}

/**
 * Groups paths into route patterns: "/blog/my-post" → "/blog/:slug",
 * "/fr/menu" → "/:lang/menu", "/shop/shoes/42" → "/shop/:category/:id".
 * Returns { patternOf: Map(path → pattern), templates: [{ pattern, paths }] }.
 */
export function buildRouteIndex(paths, { locales } = {}) {
  const localeSet = locales || detectLocales(paths);
  const root = { children: new Map(), paths: [] };
  const split = (path) => {
    const [pathname, query = ""] = path.split("?");
    const segments = pathname.split("/").filter(Boolean).map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch (error) {
        return segment;
      }
    });
    return { segments, query };
  };
  for (const path of paths) {
    const { segments } = split(path);
    let node = root;
    segments.forEach((segment, depth) => {
      const key = depth === 0 && localeSet.has(segment.toLowerCase()) ? ":lang" : segment;
      if (!node.children.has(key)) node.children.set(key, { children: new Map(), paths: [], name: key });
      node = node.children.get(key);
    });
    node.paths.push(path);
  }

  // Bottom-up: collapse sibling groups that share one subtree shape.
  const collapse = (node, depth, parentName) => {
    for (const child of node.children.values()) collapse(child, depth + 1, child.name);
    const shapeOf = (child) => [...child.children.keys()].sort().join("|");
    const groups = new Map();
    for (const [name, child] of node.children) {
      if (name.startsWith(":")) continue;
      const shape = shapeOf(child);
      if (!groups.has(shape)) groups.set(shape, []);
      groups.get(shape).push([name, child]);
    }
    for (const [shape, members] of groups) {
      // Numeric ids and UUIDs are dynamic even when alone (/order/1042).
      const ids = members.filter(([name]) => isIdSegment(name));
      if (ids.length > 0 && ids.length < members.length) {
        groups.set(`${shape}#ids`, ids);
        members.splice(0, members.length, ...members.filter(([name]) => !isIdSegment(name)));
      }
    }
    for (const [shape, members] of groups) {
      if (members.length === 0) continue;
      const names = members.map(([name]) => name);
      const dynamicShare = names.filter(looksDynamic).length / names.length;
      const collectionParent = COLLECTION_PARENT.test(parentName || "");
      const isLeafGroup = shape === "" || shape === "#ids";
      let collapseIt;
      if (names.every(isIdSegment)) {
        collapseIt = true;
      } else if (depth === 0) {
        collapseIt = names.length >= 6 && dynamicShare >= 0.8;
      } else if (collectionParent) {
        collapseIt = names.length >= 2;
      } else {
        collapseIt = (names.length >= 3 && dynamicShare >= 0.6) || (isLeafGroup && names.length >= 8) || (!isLeafGroup && names.length >= 3 && dynamicShare >= 0.34);
      }
      if (!collapseIt) continue;
      const allNumeric = names.every(isIdSegment);
      const placeholder = allNumeric ? ":id" : !isLeafGroup ? ":category" : ":slug";
      const merged = node.children.get(placeholder) || { children: new Map(), paths: [], name: placeholder };
      for (const [name, child] of members) {
        node.children.delete(name);
        merged.paths.push(...child.paths);
        for (const [grandName, grand] of child.children) {
          const existing = merged.children.get(grandName);
          if (existing) {
            existing.paths.push(...grand.paths);
            for (const [k, v] of grand.children) existing.children.set(k, v);
          } else {
            merged.children.set(grandName, grand);
          }
        }
      }
      node.children.set(placeholder, merged);
    }
  };
  collapse(root, 0, "");

  const patternOf = new Map();
  const templates = [];
  const walk = (node, prefix) => {
    if (node.paths.length > 0) {
      const pattern = prefix || "/";
      for (const path of node.paths) {
        const { query } = split(path);
        const pageParam = query.match(/(?:^|&)(page|p)=\d+/);
        patternOf.set(path, pageParam ? `${pattern}?${pageParam[1]}=:n` : pattern);
      }
    }
    for (const [name, child] of node.children) walk(child, `${prefix}/${name}`);
  };
  walk(root, "");
  const byPattern = new Map();
  for (const [path, pattern] of patternOf) {
    if (!byPattern.has(pattern)) byPattern.set(pattern, []);
    byPattern.get(pattern).push(path);
  }
  for (const [pattern, members] of byPattern) {
    templates.push({ pattern, paths: members, dynamic: pattern.includes(":") });
  }
  templates.sort((a, b) => a.pattern.localeCompare(b.pattern));
  return { patternOf, templates, locales: [...localeSet] };
}

// ---------------------------------------------------------------- crawl state

/**
 * Breadth-first crawl plan with priorities (navigation > sitemap > content),
 * a fetch budget, robots.txt and per-template sampling: once a dynamic route
 * (e.g. /blog/:slug) has `samplePerTemplate` analysed pages, its other URLs
 * are listed without being fetched.
 */
export function createCrawlState({ startUrl, maxPages = 50, samplePerTemplate = 3, robots = null, maxDiscovered = 5000 }) {
  const start = normalizeCrawlUrl(startUrl, startUrl);
  if (!start) throw new Error("URL de départ invalide (http/https requis).");
  return {
    origin: new URL(start).origin,
    startUrl: start,
    maxPages,
    samplePerTemplate,
    robots,
    maxDiscovered,
    queue: [{ url: start, depth: 0, priority: 0, source: "start" }],
    seen: new Set([start]),
    fetched: 0,
    analyzedByPattern: new Map(),
    listed: [],
    robotsExcluded: [],
    sources: new Map([[start, "start"]])
  };
}

export function enqueueUrl(state, href, { depth = 1, source = "content" } = {}) {
  const url = normalizeCrawlUrl(href, state.origin);
  if (!url || state.seen.has(url)) return false;
  if (state.seen.size >= state.maxDiscovered) return false;
  state.seen.add(url);
  if (!isAllowedByRobots(pathKey(url), state.robots)) {
    state.robotsExcluded.push(url);
    return false;
  }
  const priority = source === "nav" ? 0 : source === "sitemap" ? 1 : source === "footer" ? 2 : 3;
  state.sources.set(url, source);
  state.queue.push({ url, depth, priority, source });
  return true;
}

export function currentPatternOf(state, url) {
  // The index only changes when new URLs are discovered.
  if (state.indexSize !== state.seen.size) {
    state.index = buildRouteIndex([...state.seen].map(pathKey));
    state.indexSize = state.seen.size;
  }
  return state.index.patternOf.get(pathKey(url)) || pathKey(url);
}

/** Next URL to fetch, or null when the budget is spent or the queue empty. */
export function nextCrawlTarget(state) {
  while (state.queue.length > 0 && state.fetched < state.maxPages) {
    state.queue.sort((a, b) => a.priority - b.priority || a.depth - b.depth);
    const target = state.queue.shift();
    const pattern = currentPatternOf(state, target.url);
    if (pattern.includes(":") && (state.analyzedByPattern.get(pattern) || 0) >= state.samplePerTemplate) {
      state.listed.push({ url: target.url, pattern });
      continue;
    }
    state.analyzedByPattern.set(pattern, (state.analyzedByPattern.get(pattern) || 0) + 1);
    state.fetched += 1;
    return target;
  }
  return null;
}

export function remainingUrls(state) {
  return state.queue.map((entry) => entry.url);
}

// ---------------------------------------------------------------- page types

const TYPE_RULES = [
  ["auth", /\/(login|log-in|signin|sign-in|connexion|se-connecter|signup|sign-up|register|inscription|creer-un-compte|account|mon-compte|compte)(\/|$)/i],
  ["cart", /\/(cart|panier|checkout|commande|basket)(\/|$)/i],
  ["legal", /(privacy|confidentialit|terms|conditions-generales|conditions|cgu|cgv|mentions-legales|legal|cookies?|imprint|impressum|gdpr|rgpd|politique-de)/i],
  ["careers", /\/(careers?|jobs?|carrieres?|recrutement|emplois?|join-us|nous-rejoindre|offres-emploi)(\/|$)/i],
  ["pricing", /\/(pricing|tarifs?|prix|plans|abonnements?|precios)(\/|$)/i],
  ["contact", /\/(contact|contactez-nous|nous-contacter|contact-us|get-in-touch)(\/|$)/i],
  ["about", /\/(about|about-us|a-propos|qui-sommes-nous|notre-histoire|histoire|company|entreprise|team|equipe|notre-equipe|manifesto|mission)(\/|$)/i],
  ["faq", /\/(faq|faqs|questions-frequentes)(\/|$)/i],
  ["docs", /\/(docs?|documentation|guides?|help|aide|kb|knowledge-base|support|api-reference|reference|changelog)(\/|$)/i],
  ["blog", /\/(blog|news|actualites?|articles?|journal|magazine|insights|ressources|resources|stories|posts?|essays?)(\/|$)/i],
  ["case-study", /\/(case-stud(y|ies)|customers|clients|realisations|portfolio|projets?|projects?|references|work|showcase)(\/|$)/i],
  ["shop", /\/(shop|boutique|store|collections?|categories|category|produits?|products?)(\/|$)/i],
  ["services", /\/(services?|solutions?|prestations?|offres?|expertises?)(\/|$)/i],
  ["features", /\/(features?|fonctionnalites|product|produit|platform|plateforme|how-it-works|comment-ca-marche)(\/|$)/i],
  ["menu", /\/(menu|carte|nos-plats|la-carte)(\/|$)/i],
  ["booking", /\/(reservations?|reserver|book(ing)?|rendez-vous|appointment)(\/|$)/i],
  ["events", /\/(events?|evenements?|agenda|webinars?)(\/|$)/i],
  ["search", /\/(search|recherche)(\/|$)/i]
];

const DETAIL_TYPES = {
  blog: "blog-post",
  shop: "product",
  "case-study": "case-study",
  events: "event",
  careers: "job",
  docs: "doc-page",
  services: "service",
  menu: "menu-item"
};
const INDEX_TYPES = { blog: "blog-index", shop: "product-listing", "case-study": "case-study-index", events: "events-index", careers: "careers", docs: "docs" };

export const TYPE_LABELS = {
  home: "Home page",
  about: "About / company",
  pricing: "Pricing",
  contact: "Contact",
  "blog-index": "Blog / news index",
  "blog-post": "Blog article",
  "product-listing": "Product listing",
  product: "Product detail",
  "case-study-index": "Case studies / portfolio index",
  "case-study": "Case study / project",
  docs: "Documentation",
  "doc-page": "Documentation page",
  legal: "Legal / policy",
  careers: "Careers",
  job: "Job offer",
  auth: "Authentication",
  cart: "Cart / checkout",
  faq: "FAQ",
  services: "Services overview",
  service: "Service detail",
  features: "Product / features",
  menu: "Menu",
  "menu-item": "Menu item",
  booking: "Booking / reservation",
  "events-index": "Events",
  event: "Event detail",
  search: "Search",
  "not-found": "Not found (404)",
  page: "Content / landing page"
};

export function classifyPage(page, pattern = "") {
  if (page.status === 404) return { type: "not-found", confidence: 1 };
  const path = (page.path || "/").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const localeless = segments.length === 1 && LOCALE_SEGMENT.test(segments[0]) && COMMON_LOCALES.has(segments[0].slice(0, 2).toLowerCase());
  if (segments.length === 0 || localeless) return { type: "home", confidence: 1 };

  const ld = (page.jsonLd?.types || []).join(" ");
  if (/\bProduct\b/.test(ld)) return { type: "product", confidence: 0.95 };
  if (/\b(Article|BlogPosting|NewsArticle|TechArticle)\b/.test(ld) && !/\b(CollectionPage|ItemList)\b/.test(ld)) return { type: "blog-post", confidence: 0.9 };
  if (/\bJobPosting\b/.test(ld)) return { type: "job", confidence: 0.95 };
  if (/\bEvent\b/.test(ld) && segments.length > 1) return { type: "event", confidence: 0.85 };
  if (/\bFAQPage\b/.test(ld) && segments.length === 1) return { type: "faq", confidence: 0.85 };
  if (/\bContactPage\b/.test(ld)) return { type: "contact", confidence: 0.9 };
  if (/\bAboutPage\b/.test(ld)) return { type: "about", confidence: 0.9 };

  const dynamicTail = /\/:(slug|id)(\?|$)/.test(pattern);
  for (const [type, re] of TYPE_RULES) {
    if (!re.test(path)) continue;
    if (dynamicTail && DETAIL_TYPES[type]) return { type: DETAIL_TYPES[type], confidence: 0.85 };
    if (INDEX_TYPES[type] && (page.sections || []).some((section) => section.items?.length >= 3)) {
      return { type: INDEX_TYPES[type], confidence: 0.8 };
    }
    return { type: INDEX_TYPES[type] && segments.length === 1 ? INDEX_TYPES[type] : DETAIL_TYPES[type] && segments.length > 1 ? DETAIL_TYPES[type] : type, confidence: 0.75 };
  }
  const purposes = (page.forms || []).map((form) => form.purpose);
  if (purposes.includes("login") || purposes.includes("signup")) return { type: "auth", confidence: 0.7 };
  if (purposes.includes("booking")) return { type: "booking", confidence: 0.6 };
  if (purposes.includes("contact") && (page.sections || []).length <= 4) return { type: "contact", confidence: 0.6 };
  if ((page.sections || []).some((section) => section.role === "pricing")) return { type: "pricing", confidence: 0.55 };
  if (page.wordCount > 900 && page.sections?.some((section) => section.role === "article")) return { type: "blog-post", confidence: 0.5 };
  return { type: "page", confidence: 0.4 };
}

export function pageSlug(path, used = new Set()) {
  const [pathname, query = ""] = String(path || "/").split("?");
  let base = pathname
    .split("/")
    .filter(Boolean)
    .join("--")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/-{3,}/g, "--")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "home";
  if (query) base += `--${query.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 30)}`;
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}

// ---------------------------------------------------------------- site analysis

function pathOfHref(href, origin) {
  const url = normalizeCrawlUrl(href, origin);
  return url ? pathKey(url) : "";
}

function navSignature(items, origin) {
  return JSON.stringify((items || []).map((item) => [item.text, pathOfHref(item.href, origin) || item.href, (item.children || []).length]));
}

function mostCommon(entries) {
  const counts = new Map();
  for (const [key, weight] of entries) counts.set(key, (counts.get(key) || 0) + weight);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
}

export function purposeOf(page) {
  const label = TYPE_LABELS[page.type] || "Page";
  const headline = page.h1 || page.title || page.path;
  const description = page.metaDescription || page.og?.description || "";
  const primary = (page.ctas || []).find((cta) => cta.internal && cta.href) || (page.ctas || [])[0];
  let text = `${label}: “${headline}”.`;
  if (description && description !== headline) text += ` ${description}`;
  if (primary) {
    text += ` Main action: “${primary.label}”${primary.href ? ` → ${primary.internal ? pathOfHref(primary.href, page.url) || primary.href : primary.href}` : ""}.`;
  }
  return text;
}

/**
 * Whole-site analysis.
 * @param {{ startUrl, pages: PageModel[], listed, failures, robotsExcluded, sitemapUrls, crawledAt, options }} input
 */
export function analyzeSite({ startUrl, pages, listed = [], failures = [], robotsExcluded = [], sitemapUrls = [], crawledAt = new Date().toISOString(), options = {} }) {
  const origin = new URL(startUrl).origin;
  const allPaths = [...new Set([...pages.map((page) => page.path), ...listed.map((entry) => pathKey(entry.url))])];
  const index = buildRouteIndex(allPaths);
  const usedSlugs = new Set();

  const enriched = pages
    .map((page) => {
      const pattern = index.patternOf.get(page.path) || page.path;
      const { type, confidence } = classifyPage(page, pattern);
      return { ...page, pattern, type, typeConfidence: confidence };
    })
    .sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
  for (const page of enriched) {
    page.slug = pageSlug(page.path, usedSlugs);
    page.file = `pages/${page.slug}.md`;
    page.purpose = purposeOf(page);
  }
  const byPath = new Map(enriched.map((page) => [page.path, page]));

  // Global navigation and footer: the variant most pages share (home counts double).
  const navWinner = mostCommon(enriched.filter((page) => page.nav?.length).map((page) => [navSignature(page.nav, origin), page.path === "/" ? 2 : 1]));
  const navSource = navWinner ? enriched.find((page) => navSignature(page.nav, origin) === navWinner[0]) : null;
  const footerWinner = mostCommon(enriched.filter((page) => page.footer?.groups?.length).map((page) => [JSON.stringify(page.footer.groups.map((group) => [group.title, group.links.length])), 1]));
  const footerSource = footerWinner ? enriched.find((page) => page.footer && JSON.stringify(page.footer.groups.map((group) => [group.title, group.links.length])) === footerWinner[0]) : null;

  // Blocks repeated across pages (newsletter band, CTA banner, logo wall...).
  const blockCounts = new Map();
  for (const page of enriched) {
    const seenHere = new Set();
    for (const section of page.sections || []) {
      if (section.role === "hero" || section.index === 0) continue;
      const key = `${section.role}|${(section.heading || "").toLowerCase()}`;
      if (!section.heading || seenHere.has(key)) continue;
      seenHere.add(key);
      if (!blockCounts.has(key)) blockCounts.set(key, { role: section.role, heading: section.heading, pages: [], ctas: section.ctas });
      blockCounts.get(key).pages.push(page.path);
    }
  }
  const sharedBlocks = [...blockCounts.values()]
    .filter((block) => block.pages.length >= Math.max(3, Math.ceil(enriched.length * 0.15)))
    .sort((a, b) => b.pages.length - a.pages.length)
    .slice(0, 12);

  // Templates: dynamic routes with their members, sampled pages and data shape.
  const templates = index.templates
    .filter((template) => template.dynamic)
    .map((template) => {
      const samples = template.paths.map((path) => byPath.get(path)).filter(Boolean);
      const types = mostCommon(samples.map((page) => [page.type, 1]));
      const roleLists = samples.map((page) => (page.sections || []).map((section) => section.role));
      const common = roleLists.length ? roleLists[0].filter((role) => roleLists.every((list) => list.includes(role))) : [];
      return {
        pattern: template.pattern,
        count: template.paths.length,
        type: types ? types[0] : "page",
        samples: samples.map((page) => page.path),
        listed: template.paths.filter((path) => !byPath.has(path)),
        sectionSkeleton: [...new Set(common)],
        fields: inferTemplateFields(samples)
      };
    })
    .sort((a, b) => b.count - a.count);

  // CTA graph → flows.
  const edges = new Map();
  for (const page of enriched) {
    for (const cta of collectPageCtas(page)) {
      if (!cta.internal || !cta.href) continue;
      const target = pathOfHref(cta.href, origin);
      if (!target || target === page.path) continue;
      const key = `${target}|${cta.label}`;
      if (!edges.has(key)) edges.set(key, { to: target, label: cta.label, from: new Set() });
      edges.get(key).from.add(page.path);
    }
  }
  const ctaEdges = [...edges.values()].map((edge) => ({ ...edge, from: [...edge.from] })).sort((a, b) => b.from.length - a.from.length);
  const flows = buildFlows(enriched, ctaEdges, byPath);

  // Forms catalog, deduplicated by field signature.
  const formMap = new Map();
  for (const page of enriched) {
    for (const form of page.forms || []) {
      const key = `${form.purpose}|${form.fields.map((field) => `${field.type}:${field.name || field.label}`).join(",")}`;
      if (!formMap.has(key)) formMap.set(key, { ...form, pages: [] });
      formMap.get(key).pages.push(page.path);
    }
  }

  const integrationCounts = new Map();
  for (const page of enriched) for (const name of page.integrations || []) integrationCounts.set(name, (integrationCounts.get(name) || 0) + 1);

  const languages = [...new Set([...enriched.map((page) => page.lang).filter(Boolean), ...index.locales])];
  const hreflang = new Map();
  for (const page of enriched) for (const alt of page.hreflang || []) hreflang.set(alt.lang, alt.href);

  const titles = new Map();
  for (const page of enriched) {
    if (!page.title) continue;
    if (!titles.has(page.title)) titles.set(page.title, []);
    titles.get(page.title).push(page.path);
  }
  const seo = {
    missingDescription: enriched.filter((page) => !page.metaDescription && page.status < 400).map((page) => page.path),
    missingH1: enriched.filter((page) => page.h1Count === 0 && page.status < 400).map((page) => page.path),
    multipleH1: enriched.filter((page) => page.h1Count > 1).map((page) => page.path),
    duplicateTitles: [...titles.entries()].filter(([, paths]) => paths.length > 1).map(([title, paths]) => ({ title, paths })),
    noindex: enriched.filter((page) => /noindex/i.test(page.robots || "")).map((page) => page.path),
    titlePattern: inferTitlePattern(enriched)
  };

  const inbound = new Map();
  for (const page of enriched) {
    for (const link of page.internalLinks || []) {
      const target = pathOfHref(link.href, origin);
      if (target && target !== page.path) inbound.set(target, (inbound.get(target) || 0) + 1);
    }
  }
  const sitemapPaths = new Set(sitemapUrls.map((url) => pathOfHref(url, origin)).filter(Boolean));
  const orphans = [...sitemapPaths].filter((path) => byPath.has(path) && !inbound.get(path) && path !== "/");

  const typeCounts = new Map();
  for (const page of enriched) typeCounts.set(page.type, (typeCounts.get(page.type) || 0) + 1);
  const primaryGoal = ctaEdges[0] ? `${ctaEdges[0].label} → ${ctaEdges[0].to}` : "";

  return {
    generator: "Keys_Osi site structure",
    version: 1,
    origin,
    startUrl,
    siteName: guessSiteName(enriched),
    crawledAt,
    options,
    stats: {
      pagesAnalyzed: enriched.length,
      rendered: enriched.filter((page) => page.rendered).length,
      listedNotFetched: listed.length,
      templates: templates.length,
      failures: failures.length,
      robotsExcluded: robotsExcluded.length,
      sitemapUrls: sitemapUrls.length,
      types: Object.fromEntries([...typeCounts.entries()].sort((a, b) => b[1] - a[1]))
    },
    languages,
    hreflang: Object.fromEntries(hreflang),
    navigation: navSource ? navSource.nav : [],
    footer: footerSource ? footerSource.footer : null,
    sharedBlocks,
    templates,
    routes: index.templates.map((template) => ({ pattern: template.pattern, count: template.paths.length, dynamic: template.dynamic })),
    ctaEdges: ctaEdges.slice(0, 40),
    flows,
    primaryGoal,
    forms: [...formMap.values()],
    integrations: [...integrationCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, pages: count })),
    seo,
    orphans,
    inbound: Object.fromEntries(inbound),
    failures,
    robotsExcluded,
    listed,
    pages: enriched
  };
}

function collectPageCtas(page) {
  const all = [...(page.ctas || [])];
  for (const section of page.sections || []) all.push(...(section.ctas || []));
  const seen = new Set();
  return all.filter((cta) => {
    const key = `${cta.label}|${cta.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferTemplateFields(samples) {
  const fields = new Map();
  const add = (name, evidence) => {
    if (!fields.has(name)) fields.set(name, { name, evidence, seenIn: 0 });
    fields.get(name).seenIn += 1;
  };
  for (const page of samples) {
    add("title", "h1");
    if (page.metaDescription) add("excerpt", "meta description");
    if (page.og?.image) add("coverImage", "og:image");
    for (const entry of page.jsonLd?.summary || []) {
      for (const key of Object.keys(entry)) {
        if (key === "type" || key === "name" || key === "headline") continue;
        add(key, `JSON-LD ${entry.type}`);
      }
    }
    if ((page.sections || []).some((section) => section.prices > 0)) add("price", "price in content");
    if ((page.internalLinks || []).some((link) => /\/(tags?|categor(y|ies)|topics?)\//i.test(link.href))) add("tags", "tag/category links");
    if ((page.sections || []).some((section) => section.role === "article")) add("body", "long-form content");
    if ((page.breadcrumb || []).length) add("breadcrumb", "breadcrumb trail");
  }
  return [...fields.values()].sort((a, b) => b.seenIn - a.seenIn);
}

function buildFlows(pages, edges, byPath) {
  const flows = [];
  const home = byPath.get("/") || pages[0];
  if (!home) return flows;
  const outgoing = (path) => edges.filter((edge) => edge.from.includes(path) && byPath.has(edge.to));
  const visit = (path, trail, depth) => {
    const next = outgoing(path).filter((edge) => !trail.some((step) => step.path === edge.to)).slice(0, depth === 0 ? 4 : 1);
    if (next.length === 0 || depth >= 3) {
      if (trail.length > 1) flows.push(trail);
      return;
    }
    for (const edge of next) visit(edge.to, [...trail, { path: edge.to, via: edge.label }], depth + 1);
  };
  visit(home.path, [{ path: home.path, via: "" }], 0);
  const conversionTypes = new Set(["contact", "auth", "cart", "booking", "pricing"]);
  return flows
    .map((trail) => ({
      steps: trail,
      endsInConversion: conversionTypes.has(byPath.get(trail[trail.length - 1].path)?.type) || Boolean(byPath.get(trail[trail.length - 1].path)?.forms?.length)
    }))
    .slice(0, 8);
}

function inferTitlePattern(pages) {
  const separators = [" | ", " – ", " — ", " - ", " · ", " :: "];
  for (const separator of separators) {
    const withSep = pages.filter((page) => page.title.includes(separator));
    if (withSep.length < Math.max(2, pages.length * 0.5)) continue;
    const tails = mostCommon(withSep.map((page) => [page.title.split(separator).pop().trim(), 1]));
    if (tails && tails[1] >= withSep.length * 0.6) return `{Page title}${separator}${tails[0]}`;
  }
  return "";
}

function guessSiteName(pages) {
  const home = pages.find((page) => page.path === "/") || pages[0];
  if (!home) return "Site";
  const pattern = inferTitlePattern(pages);
  if (pattern) return pattern.replace(/^\{Page title\}\s*\S+\s*/, "");
  return (home.og?.title || home.title || "Site").split(/[|–—-]/)[0].trim() || "Site";
}

// ---------------------------------------------------------------- documents

function mdEscape(text) {
  return String(text || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function quote(text) {
  return `“${String(text || "").replace(/[“”]/g, '"')}”`;
}

function relHref(href, origin) {
  const path = pathOfHref(href, origin);
  return path || href || "";
}

function renderRouteTree(site) {
  const lines = [];
  const rootNode = { name: "", children: new Map(), route: null };
  for (const route of site.routes) {
    const parts = route.pattern.split("?")[0].split("/").filter(Boolean);
    let node = rootNode;
    for (const part of parts) {
      if (!node.children.has(part)) node.children.set(part, { name: part, children: new Map(), route: null });
      node = node.children.get(part);
    }
    if (!node.route || route.count > node.route.count) node.route = route;
  }
  const describe = (pattern, route) => {
    const page = site.pages.find((candidate) => candidate.pattern === pattern);
    const type = page ? page.type : site.templates.find((template) => template.pattern === pattern)?.type || "";
    const count = route && route.dynamic ? ` ×${route.count}` : "";
    const title = page && !route?.dynamic ? ` — ${page.h1 || page.title}` : "";
    return `${type ? ` (${type}${count})` : count}${title}`.slice(0, 120);
  };
  lines.push(`/${describe("/", rootNode.route)}`);
  const walk = (node, prefix, path) => {
    const children = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    children.forEach((child, i) => {
      const last = i === children.length - 1;
      const childPath = `${path}/${child.name}`;
      lines.push(`${prefix}${last ? "└── " : "├── "}${childPath}${child.route ? describe(childPath, child.route) : ""}`);
      walk(child, `${prefix}${last ? "    " : "│   "}`, childPath);
    });
  };
  walk(rootNode, "", "");
  return lines.join("\n");
}

function renderNav(items, origin, depth = 0) {
  return (items || [])
    .map((item) => {
      const line = `${"  ".repeat(depth)}- ${item.text || "(no label)"}${item.href ? ` → \`${relHref(item.href, origin)}\`` : ""}`;
      const children = item.children?.length ? `\n${renderNav(item.children, origin, depth + 1)}` : "";
      return line + children;
    })
    .join("\n");
}

function nextRoute(pattern) {
  const parts = pattern.split("?")[0].split("/").filter(Boolean).map((part) => (part.startsWith(":") ? `[${part.slice(1)}]` : part));
  return `app/${parts.length ? `${parts.join("/")}/` : ""}page.tsx`;
}

export function generateSiteStructureMarkdown(site) {
  const origin = site.origin;
  const out = [];
  out.push(`# SITE_STRUCTURE.md — ${site.siteName}`);
  out.push("");
  out.push(`> Generated by Keys_Osi from a crawl of ${origin} on ${site.crawledAt.slice(0, 10)}: ${site.stats.pagesAnalyzed} pages analysed (${site.stats.rendered} rendered with JavaScript), ${site.stats.templates} dynamic templates, ${site.stats.listedNotFetched} more URLs listed from templates/sitemaps.`);
  out.push("");
  out.push("## How to use this document");
  out.push("You are rebuilding this website. This file is the map: routes, shared layout, navigation, templates and flows. Every page has its own detailed file in `pages/` (sections in order, verbatim copy, CTAs, forms, media). Visual styling comes from DESIGN.md (tokens, components) when provided.");
  out.push("1. Scaffold the routes of §2 / §10 first, including dynamic templates.");
  out.push("2. Build the global layout (§3: header, navigation, footer, shared blocks) once and reuse it on every page.");
  out.push("3. Build each template of §4 as one component fed by the listed data fields.");
  out.push("4. Build every page from its `pages/*.md` file, keeping the section order and the exact copy.");
  out.push("5. Wire the flows of §6 and the forms of §7, then check the definition of done (§11).");
  out.push("");

  out.push("## 1. Overview");
  out.push(`- Site: **${site.siteName}** — ${origin}`);
  const types = Object.entries(site.stats.types).map(([type, count]) => `${TYPE_LABELS[type] || type} ×${count}`).join(", ");
  out.push(`- Page types: ${types || "n/a"}`);
  if (site.languages.length) out.push(`- Languages: ${site.languages.join(", ")}${Object.keys(site.hreflang).length ? ` (hreflang: ${Object.keys(site.hreflang).join(", ")})` : ""}`);
  if (site.primaryGoal) out.push(`- Main conversion path (most repeated CTA): ${site.primaryGoal}`);
  if (site.integrations.length) out.push(`- Platform & services: ${site.integrations.map((entry) => entry.name).join(", ")}`);
  const tech = site.options.tech;
  if (tech) {
    out.push(`- Technology (decoded): ${tech.frameworks.join(", ") || "n/a"}${tech.css.length ? `; styling: ${tech.css.join(", ")}` : ""}${tech.hosting.length ? `; hosting: ${tech.hosting.join(", ")}` : ""}. Details in TECH_STACK.md.`);
  }
  out.push("");

  out.push("## 2. Sitemap (route tree)");
  out.push("```text");
  out.push(renderRouteTree(site));
  out.push("```");
  out.push("");

  out.push("## 3. Global layout");
  out.push("### Header / primary navigation");
  out.push(site.navigation.length ? renderNav(site.navigation, origin) : "_No navigation detected._");
  out.push("");
  out.push("### Footer");
  if (site.footer) {
    for (const group of site.footer.groups) {
      out.push(`- **${group.title || "Links"}**: ${group.links.map((link) => `${link.text} (\`${relHref(link.href, origin)}\`)`).join(", ")}`);
    }
    if (site.footer.social.length) out.push(`- Social: ${site.footer.social.map((entry) => `${entry.network} (${entry.href})`).join(", ")}`);
    if (site.footer.contact.length) out.push(`- Contact: ${site.footer.contact.join(", ")}`);
    if (site.footer.legal) out.push(`- Legal line: ${quote(site.footer.legal)}`);
  } else {
    out.push("_No footer detected._");
  }
  out.push("");
  if (site.sharedBlocks.length) {
    out.push("### Shared blocks (repeated on several pages — build once as components)");
    for (const block of site.sharedBlocks) {
      out.push(`- **${block.role}** ${quote(block.heading)} — on ${block.pages.length} pages${block.ctas?.length ? `; CTA: ${block.ctas.map((cta) => quote(cta.label)).join(", ")}` : ""}`);
    }
    out.push("");
  }

  out.push("## 4. Templates (dynamic routes)");
  if (site.templates.length === 0) {
    out.push("_No dynamic route detected: every page is unique._");
  }
  for (const template of site.templates) {
    out.push(`### \`${template.pattern}\` — ${TYPE_LABELS[template.type] || template.type}, ${template.count} pages`);
    out.push(`- Analysed samples: ${template.samples.map((path) => `\`${path}\``).join(", ") || "none"}`);
    if (template.listed.length) out.push(`- Other members (same template, not fetched): ${template.listed.slice(0, 12).map((path) => `\`${path}\``).join(", ")}${template.listed.length > 12 ? ` … (+${template.listed.length - 12})` : ""}`);
    if (template.sectionSkeleton.length) out.push(`- Section skeleton shared by every sample: ${template.sectionSkeleton.join(" → ")}`);
    if (template.fields.length) out.push(`- Data fields: ${template.fields.map((field) => `\`${field.name}\` (${field.evidence})`).join(", ")}`);
    out.push("");
  }

  out.push("## 5. Page index");
  out.push("| Route | Type | Purpose | Sections | File |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const page of site.pages) {
    const sections = (page.sections || []).map((section) => section.role).join(" → ");
    out.push(`| \`${page.path}\` | ${page.type} | ${mdEscape(page.purpose).slice(0, 220)} | ${mdEscape(sections).slice(0, 140)} | \`${page.file}\` |`);
  }
  out.push("");

  out.push("## 6. User flows & conversion paths");
  if (site.flows.length) {
    for (const flow of site.flows) {
      out.push(`- ${flow.steps.map((step, i) => (i === 0 ? `\`${step.path}\`` : `—${quote(step.via)}→ \`${step.path}\``)).join(" ")}${flow.endsInConversion ? " ✅ conversion" : ""}`);
    }
  } else {
    out.push("_No internal CTA path detected from the home page._");
  }
  if (site.ctaEdges.length) {
    out.push("");
    out.push("Most repeated calls to action:");
    for (const edge of site.ctaEdges.slice(0, 10)) out.push(`- ${quote(edge.label)} → \`${edge.to}\` (from ${edge.from.length} page${edge.from.length > 1 ? "s" : ""})`);
  }
  out.push("");

  out.push("## 7. Forms catalog");
  if (site.forms.length === 0) out.push("_No form found._");
  for (const form of site.forms) {
    out.push(`### ${form.purpose} form${form.id ? ` (#${form.id})` : ""} — ${form.method.toUpperCase()} on ${form.pages.map((path) => `\`${path}\``).join(", ")}`);
    for (const field of form.fields) {
      out.push(`- ${field.label || field.placeholder || field.name || field.type} — \`${field.type}\`${field.name ? ` name=\`${field.name}\`` : ""}${field.required ? " (required)" : ""}${field.options.length ? ` options: ${field.options.join(" / ")}` : ""}`);
    }
    if (form.submit) out.push(`- Submit: ${quote(form.submit)}`);
    out.push("");
  }

  out.push("## 8. Integrations & third-party services");
  out.push(site.integrations.length ? site.integrations.map((entry) => `- ${entry.name} (${entry.pages} page${entry.pages > 1 ? "s" : ""})`).join("\n") : "_None detected._");
  out.push("");

  out.push("## 9. SEO & metadata conventions");
  if (site.seo.titlePattern) out.push(`- Title pattern: \`${site.seo.titlePattern}\``);
  out.push(`- Pages without meta description: ${site.seo.missingDescription.length}${site.seo.missingDescription.length ? ` (${site.seo.missingDescription.slice(0, 8).join(", ")})` : ""}`);
  out.push(`- Pages without H1: ${site.seo.missingH1.length}; with several H1: ${site.seo.multipleH1.length}`);
  if (site.seo.duplicateTitles.length) out.push(`- Duplicate titles: ${site.seo.duplicateTitles.map((entry) => `${quote(entry.title)} on ${entry.paths.join(", ")}`).join("; ")}`);
  if (site.seo.noindex.length) out.push(`- noindex pages: ${site.seo.noindex.join(", ")}`);
  out.push("- Rebuild rule: one H1 per page, a unique title and meta description per page, Open Graph tags on every page.");
  out.push("");

  out.push("## 10. Route scaffold");
  out.push("```text");
  for (const route of site.routes) out.push(`${route.pattern.padEnd(36)} → ${nextRoute(route.pattern)}${route.dynamic ? `   (${route.count} entries)` : ""}`);
  out.push("```");
  out.push("Next.js App Router shown; map the same tree to any router (Astro `src/pages`, Nuxt `pages/`, SvelteKit `src/routes`).");
  out.push("");

  out.push("## 11. Definition of done");
  out.push(`- [ ] Every route of §2 exists (${site.routes.length} routes incl. ${site.templates.length} templates) and the navigation of §3 links them exactly.`);
  out.push("- [ ] Header, footer and shared blocks are single components reused everywhere.");
  out.push("- [ ] Each page keeps the section order, headings and CTA labels of its `pages/*.md` file.");
  out.push(`- [ ] The ${site.forms.length} form(s) of §7 have the same fields, required flags and submit labels.`);
  out.push("- [ ] The CTA flows of §6 lead to the same destinations.");
  out.push("- [ ] Titles/descriptions follow §9; one H1 per page; responsive and accessible (focus, contrast, alt text).");
  out.push("");

  out.push("## Crawl report");
  out.push(`- Start URL: ${site.startUrl}; budget: ${site.options.maxPages || "?"} pages; JavaScript rendering: ${site.options.render === false ? "off" : "on for empty shells"}; robots.txt respected.`);
  if (site.options.seedCount) out.push(`- ${site.options.seedCount} routes from the build manifests / source maps were added to the crawl.`);
  if (site.robotsExcluded.length) out.push(`- Excluded by robots.txt: ${site.robotsExcluded.length} (${site.robotsExcluded.slice(0, 6).map((url) => pathOfHref(url, origin)).join(", ")}${site.robotsExcluded.length > 6 ? "…" : ""})`);
  if (site.failures.length) out.push(`- Failures: ${site.failures.slice(0, 10).map((failure) => `${pathOfHref(failure.url, origin) || failure.url} (${failure.error})`).join("; ")}`);
  if (site.orphans.length) out.push(`- In the sitemap but linked from no crawled page: ${site.orphans.slice(0, 10).join(", ")}`);
  out.push("");
  return out.join("\n");
}

export function generatePageMarkdown(page, site) {
  const origin = site.origin;
  const out = [];
  out.push(`# ${page.path} — ${TYPE_LABELS[page.type] || page.type}`);
  out.push("");
  out.push(`- URL: ${page.url}${page.canonical && page.canonical !== page.url ? ` (canonical: ${page.canonical})` : ""}`);
  if (page.pattern !== page.path) out.push(`- Template: \`${page.pattern}\` — this page is one instance; build the template, not a one-off page.`);
  if (page.lang) out.push(`- Language: ${page.lang}`);
  out.push(`- Rendering: ${page.rendered ? "client-side JavaScript (content read after rendering)" : "server HTML"}`);
  out.push(`- Purpose: ${page.purpose}`);
  if (page.breadcrumb?.length) out.push(`- Breadcrumb: ${page.breadcrumb.join(" › ")}`);
  out.push("");
  out.push("## SEO");
  out.push(`- Title: ${quote(page.title)}`);
  out.push(`- Meta description: ${page.metaDescription ? quote(page.metaDescription) : "_missing_"}`);
  if (page.og?.title || page.og?.image) out.push(`- Open Graph: ${page.og.title ? quote(page.og.title) : ""}${page.og.image ? ` image ${page.og.image}` : ""}`);
  if (page.jsonLd?.types?.length) out.push(`- Structured data: ${page.jsonLd.types.join(", ")}`);
  out.push("");

  if (page.outline?.length) {
    out.push("## Heading outline");
    for (const heading of page.outline) out.push(`${"  ".repeat(heading.level - 1)}- H${heading.level} ${heading.text}`);
    out.push("");
  }

  out.push("## Layout");
  out.push(`- Uses the global header/navigation and footer (see SITE_STRUCTURE.md §3).`);
  out.push(`- ${page.sections.length} content sections, top to bottom.`);
  out.push("");
  out.push("## Sections (in order)");
  if (page.sections.length === 0) out.push("_No content section detected (empty or blocked page)._");
  page.sections.forEach((section, i) => {
    out.push(`### ${i + 1}. ${section.role}${section.heading ? ` — ${quote(section.heading)}` : ""}`);
    const details = [];
    if (section.eyebrow) details.push(`Eyebrow: ${quote(section.eyebrow)}`);
    if (section.headingLevel) details.push(`Heading level: H${section.headingLevel}`);
    if (section.subheading) details.push(`Lead: ${quote(section.subheading)}`);
    for (const paragraph of section.paragraphs || []) details.push(`Copy: ${quote(paragraph)}`);
    if (section.bullets?.length) details.push(`List: ${section.bullets.map((bullet) => quote(bullet)).join(" · ")}`);
    if (section.items?.length) {
      details.push(`Repeated items (${section.items.length}, build as one card component):`);
      for (const item of section.items) {
        const parts = [item.title && quote(item.title), item.text && `— ${item.text}`, item.price && `price ${item.price}`, item.href && `→ \`${relHref(item.href, origin)}\``, item.image && `image: ${item.image}`].filter(Boolean);
        details.push(`  - ${parts.join(" ")}`);
      }
    }
    for (const cta of section.ctas || []) details.push(`CTA: ${quote(cta.label)}${cta.href ? ` → \`${relHref(cta.href, origin)}\`` : ` (${cta.action})`}`);
    if (section.media?.images?.length) details.push(`Images: ${section.media.images.map((image) => (image.alt ? quote(image.alt) : "(no alt)")).join(", ")}`);
    if (section.media?.embeds?.length) details.push(`Embeds: ${section.media.embeds.map((embed) => `${embed.kind} ${embed.src}`).join(", ")}`);
    if (section.media?.svgCount) details.push(`Inline SVG icons: ${section.media.svgCount}`);
    if (section.forms?.length) details.push(`Form(s): ${section.forms.map((formIndex) => `#${formIndex + 1} (${page.forms[formIndex]?.purpose || "form"})`).join(", ")}`);
    for (const line of details) out.push(line.startsWith("  ") ? line : `- ${line}`);
    out.push("");
  });

  if (page.forms?.length) {
    out.push("## Forms");
    page.forms.forEach((form, i) => {
      out.push(`### Form #${i + 1} — ${form.purpose} (${form.method.toUpperCase()}${form.action ? ` ${relHref(form.action, origin)}` : ""})`);
      for (const field of form.fields) {
        out.push(`- ${field.label || field.placeholder || field.name || field.type}: \`${field.type}\`${field.name ? ` name=\`${field.name}\`` : ""}${field.required ? " required" : ""}${field.placeholder ? ` placeholder ${quote(field.placeholder)}` : ""}${field.options.length ? ` options: ${field.options.join(" / ")}` : ""}`);
      }
      if (form.submit) out.push(`- Submit button: ${quote(form.submit)}`);
      out.push("");
    });
  }

  const contentLinks = (page.internalLinks || []).filter((link) => link.context === "content" || link.context === "subnav");
  if (contentLinks.length) {
    out.push("## Links to other pages (in content)");
    for (const link of contentLinks.slice(0, 30)) out.push(`- ${link.text ? quote(link.text) : "(no text)"} → \`${relHref(link.href, origin)}\``);
    out.push("");
  }
  if (page.jsonLd?.summary?.length) {
    out.push("## Structured data (JSON-LD summary)");
    for (const entry of page.jsonLd.summary) {
      out.push(`- ${entry.type}: ${Object.entries(entry).filter(([key]) => key !== "type").map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(" / ") : value}`).join("; ")}`);
    }
    out.push("");
  }
  out.push("## Rebuild notes");
  out.push(`- Keep the section order (${page.sections.map((section) => section.role).join(" → ") || "n/a"}) and the exact headings/CTA labels above.`);
  if (page.pattern !== page.path) {
    const template = site.templates.find((entry) => entry.pattern === page.pattern);
    if (template?.fields?.length) out.push(`- Template data: ${template.fields.map((field) => `\`${field.name}\``).join(", ")}.`);
  }
  if (page.spa?.needsRender && !page.rendered) out.push("- Warning: the server HTML is an empty JavaScript shell; content may be incomplete.");
  out.push("");
  return out.join("\n");
}

/** Compact text of the structure for an AI prompt (PROMPT_PRO context). */
export function buildSiteDigest(site, maxChars = 7000) {
  const lines = [];
  lines.push(`Site ${site.siteName} (${site.origin}): ${site.stats.pagesAnalyzed} pages, ${site.templates.length} templates.`);
  lines.push(`Navigation: ${site.navigation.map((item) => item.text + (item.children?.length ? ` [${item.children.map((child) => child.text).join(", ")}]` : "")).join(" | ")}`);
  for (const template of site.templates) lines.push(`Template ${template.pattern} (${template.type}, ${template.count} pages): ${template.sectionSkeleton.join(" → ")}`);
  for (const page of site.pages) {
    lines.push(`Page ${page.path} [${page.type}]: ${(page.sections || []).map((section) => `${section.role}${section.heading ? ` "${section.heading.slice(0, 60)}"` : ""}`).join(" → ")}`);
  }
  if (site.flows.length) lines.push(`Flows: ${site.flows.map((flow) => flow.steps.map((step) => step.path).join(" → ")).join(" ; ")}`);
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

export function generateSiteStructureJson(site) {
  return JSON.stringify(site, null, 2);
}

/** Every file of the structure export, ready for the ZIP builder. */
export function buildSiteStructureFiles(site) {
  return [
    { path: "SITE_STRUCTURE.md", content: generateSiteStructureMarkdown(site) },
    { path: "site-structure.json", content: generateSiteStructureJson(site) },
    ...site.pages.map((page) => ({ path: page.file, content: generatePageMarkdown(page, site) }))
  ];
}
