/**
 * Keys_Osi technical decoding (reverse engineering of a live site from
 * what it publicly ships): framework runtimes, build manifests (hidden
 * routes), API endpoints referenced by the bundles, public source maps
 * (original source tree), hosting/CDN and security headers, CSS
 * architecture. Pure functions; the service worker does the fetching.
 */

// ---------------------------------------------------------------- source maps

/** Source map location of a script: SourceMap header, or the last sourceMappingURL comment. */
export function findSourceMapUrl(jsText, scriptUrl, headers = {}) {
  const header = headers.sourcemap || headers["x-sourcemap"];
  if (header) return resolveUrl(header, scriptUrl);
  const tail = String(jsText || "").slice(-4000);
  const matches = [...tail.matchAll(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/gm)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  return last[1].startsWith("data:") ? last[1] : resolveUrl(last[1], scriptUrl);
}

function resolveUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch (error) {
    return null;
  }
}

export function decodeInlineSourceMap(dataUrl) {
  const match = String(dataUrl).match(/^data:application\/json(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) return null;
  try {
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    return null;
  }
}

/** Bundler-specific prefixes turned into a clean relative project path. */
export function normalizeSourcePath(source, sourceRoot = "") {
  let path = `${sourceRoot ? `${sourceRoot.replace(/\/$/, "")}/` : ""}${source}`;
  path = path
    .replace(/^(webpack|turbopack|vite|rollup|parcel|esbuild|ng|file):\/{0,3}/i, "")
    .replace(/^\[project\]\//, "")
    .replace(/^_N_E\//, "")
    .replace(/\?[^/]*$/, "")
    .replace(/\\/g, "/");
  const parts = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part.replace(/[<>:"|?*\u0000-\u001f]/g, "_"));
  }
  return parts.join("/");
}

/** Flattens a v3 source map (incl. indexed "sections") into source files. */
export function parseSourceMap(map) {
  if (!map || typeof map !== "object") return [];
  if (Array.isArray(map.sections)) return map.sections.flatMap((section) => parseSourceMap(section.map));
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
  return sources.map((source, i) => {
    const path = normalizeSourcePath(source, map.sourceRoot || "");
    return {
      path,
      content: typeof contents[i] === "string" ? contents[i] : null,
      external: /(^|\/)node_modules\//.test(path) || /^(external|ignored)/.test(path)
    };
  });
}

/** Tree summary of original sources (first-party only), for the report. */
export function summarizeSourceTree(files, maxLines = 80) {
  const own = files.filter((file) => !file.external && file.path);
  const dirs = new Map();
  for (const file of own) {
    const dir = file.path.split("/").slice(0, -1).join("/") || ".";
    dirs.set(dir, (dirs.get(dir) || 0) + 1);
  }
  return [...dirs.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, maxLines)
    .map(([dir, count]) => `${dir}/ (${count})`);
}

// ---------------------------------------------------------------- bundles

const ENDPOINT_PATTERNS = [
  /\bfetch\(\s*[`'"]([^`'"\s]{2,200})[`'"]/g,
  /\baxios\.(?:get|post|put|patch|delete)\(\s*[`'"]([^`'"\s]{2,200})[`'"]/g,
  /\.(?:get|post|put|patch|delete)\(\s*[`'"](\/(?:api|v\d|graphql|rest|wp-json)[^`'"\s]{0,200})[`'"]/g,
  /[`'"]((?:https?:)?\/\/[a-z0-9.-]+\/(?:api|v\d|graphql|rest)\b[^`'"\s]{0,200})[`'"]/gi,
  /[`'"](\/(?:api|graphql|wp-json|rest\/v\d|v\d\/)[^`'"\s]{0,200})[`'"]/g,
  /[`'"](wss?:\/\/[^`'"\s]{4,200})[`'"]/g
];

/** API endpoints, GraphQL operations and public config keys referenced by a bundle. */
export function scanBundle(jsText) {
  const text = String(jsText || "");
  const endpoints = new Set();
  for (const re of ENDPOINT_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const value = match[1];
      if (/\.(js|css|png|jpe?g|svg|webp|woff2?|map)(\?|$)/i.test(value) || value.includes("${") && value.length < 6) continue;
      endpoints.add(value.replace(/\$\{[^}]*\}/g, ":param"));
      if (endpoints.size >= 300) break;
    }
  }
  const graphql = new Set();
  for (const match of text.matchAll(/\b(query|mutation|subscription)\s+([A-Z][A-Za-z0-9_]{2,60})\s*[({]/g)) {
    graphql.add(`${match[1]} ${match[2]}`);
    if (graphql.size >= 200) break;
  }
  // Names only: values of public env variables are not collected.
  const envKeys = new Set();
  for (const match of text.matchAll(/\b((?:NEXT_PUBLIC|VITE|NUXT_PUBLIC|REACT_APP|PUBLIC|GATSBY)_[A-Z0-9_]{2,60})\b/g)) {
    envKeys.add(match[1]);
    if (envKeys.size >= 80) break;
  }
  return { endpoints: [...endpoints], graphql: [...graphql], envKeys: [...envKeys] };
}

// ---------------------------------------------------------------- build manifests

/** Next.js pages router: routes from /_next/static/<buildId>/_buildManifest.js. */
export function parseNextBuildManifest(text) {
  // Quoted items may contain "]" (/blog/[slug]): match strings, not "anything but ]".
  const sorted = String(text || "").match(/sortedPages\s*:\s*\[((?:\s*(?:"[^"]*"|'[^']*')\s*,?)*)\]/);
  const list = sorted
    ? [...sorted[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((match) => match[1] || match[2])
    : [...String(text || "").matchAll(/"(\/[^"]*)"\s*:\s*\[/g)].map((match) => match[1]);
  return [...new Set(list)].filter((route) => !/^\/_(app|error|document)$/.test(route) && route !== "/404" && route !== "/500");
}

/** Next.js app router: routes from loaded chunk URLs (…/chunks/app/(group)/blog/[slug]/page-hash.js). */
export function routesFromAppChunks(urls) {
  const routes = new Set();
  for (const url of urls) {
    const match = String(url).match(/\/_next\/static\/chunks\/app\/(.*?)\/?(page|layout)-[a-z0-9]+\.js/i);
    if (!match || match[2] !== "page") continue;
    const route = `/${decodeURIComponent(match[1])}`
      .split("/")
      .filter((part) => part && !/^\(.*\)$/.test(part) && !part.startsWith("@"))
      .join("/");
    routes.add(`/${route}`.replace(/\/$/, "") || "/");
  }
  return [...routes];
}

/** Remix / React Router manifest → URL patterns (parents joined). */
export function routesFromRemix(routes = []) {
  const byId = new Map(routes.map((route) => [route.id, route]));
  const full = (route) => {
    const parts = [];
    for (let node = route; node; node = byId.get(node.parentId)) if (node.path) parts.unshift(node.path.replace(/^\/|\/$/g, ""));
    return `/${parts.filter(Boolean).join("/")}`;
  };
  return [...new Set(routes.filter((route) => route.path !== undefined || route.index).map(full))];
}

/** File-system routes recovered from original source paths (Next, SvelteKit, Nuxt, Astro). */
export function routesFromSourcePaths(paths) {
  const routes = new Set();
  const clean = (segments) => `/${segments.filter((part) => part && !/^\(.*\)$/.test(part) && !part.startsWith("@") && part !== "index").join("/")}`;
  for (const raw of paths) {
    const path = String(raw).replace(/^.*?(?=(?:src\/)?(?:app|pages|routes)\/)/, "");
    let match = path.match(/^(?:src\/)?app\/(.*?)\/?page\.(?:t|j)sx?$/);
    if (match) {
      routes.add(clean(match[1].split("/")));
      continue;
    }
    match = path.match(/^(?:src\/)?routes\/(.*?)\/?\+page\.(?:svelte|ts|js)$/);
    if (match) {
      routes.add(clean(match[1].split("/")));
      continue;
    }
    match = path.match(/^(?:src\/)?pages\/(.+)\.(?:t|j)sx?$|^(?:src\/)?pages\/(.+)\.(?:vue|astro|mdx?)$/);
    if (match) {
      const route = (match[1] || match[2]).split("/");
      if (/^_(app|document|error)$/.test(route[route.length - 1]) || route[0] === "api") continue;
      routes.add(clean(route));
    }
  }
  return [...routes].map((route) => (route === "/" ? "/" : route.replace(/\/$/, "")));
}

/** Static (crawlable) routes of a list of patterns: no [param], :param or *. */
export function staticRoutes(routes) {
  return routes.filter((route) => !/[[\]:*]|\$/.test(route));
}

// ---------------------------------------------------------------- headers & CSS

const HOSTING_RULES = [
  ["Vercel", (h) => h["x-vercel-id"] || /vercel/i.test(h.server || "")],
  ["Netlify", (h) => h["x-nf-request-id"] || /netlify/i.test(h.server || "")],
  ["Cloudflare", (h) => h["cf-ray"] || /cloudflare/i.test(h.server || "")],
  ["Amazon CloudFront", (h) => h["x-amz-cf-id"] || /cloudfront/i.test(h.via || "")],
  ["Amazon S3", (h) => /AmazonS3/i.test(h.server || "")],
  ["Fastly", (h) => /fastly/i.test(`${h["x-served-by"] || ""} ${h.via || ""}`) || h["x-fastly-request-id"]],
  ["Akamai", (h) => h["x-akamai-transformed"] || /akamai/i.test(h.server || "")],
  ["GitHub Pages", (h) => h["x-github-request-id"]],
  ["Fly.io", (h) => h["fly-request-id"]],
  ["Render", (h) => h["x-render-origin-server"] || /render/i.test(h["x-powered-by"] || "")],
  ["Heroku", (h) => /heroku/i.test(h.via || "")],
  ["Google Cloud", (h) => /gws|Google Frontend/i.test(h.server || "")],
  ["Azure", (h) => h["x-azure-ref"] || h["x-ms-request-id"]],
  ["Shopify", (h) => h["x-shopify-stage"] || h["x-shopid"]],
  ["Wix", (h) => h["x-wix-request-id"]],
  ["Webflow", (h) => /webflow/i.test(h["x-powered-by"] || "")],
  ["Framer", (h) => /framer/i.test(h.server || "")],
  ["Nginx", (h) => /nginx/i.test(h.server || "")],
  ["Apache", (h) => /apache/i.test(h.server || "")],
  ["LiteSpeed", (h) => /litespeed/i.test(h.server || "")]
];

const SECURITY_HEADERS = ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"];

export function analyzeHeaders(headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    hosting: HOSTING_RULES.filter(([, test]) => test(h)).map(([name]) => name),
    server: h.server || "",
    poweredBy: h["x-powered-by"] || "",
    cache: h["cache-control"] || "",
    security: Object.fromEntries(SECURITY_HEADERS.map((name) => [name, Boolean(h[name])])),
    cspSources: (h["content-security-policy"] || "")
      .split(";")
      .flatMap((directive) => directive.trim().split(/\s+/).slice(1))
      .filter((source) => /^https?:|\*\./.test(source))
      .slice(0, 40)
  };
}

export function detectCssArchitecture(tokens = []) {
  const total = Math.max(1, tokens.length);
  const count = (re) => tokens.filter((token) => re.test(token)).length;
  const tailwind = count(/^(?:[a-z]+:)*-?(?:p[xytrbl]?|m[xytrbl]?|gap|w|h|min-w|max-w|text|bg|border|rounded|flex|grid|col-span|items|justify|font|leading|tracking|shadow|opacity|z|top|left|right|bottom|inset|space-[xy]|translate-[xy]|duration|ease)-[\w./[\]%-]+$|^(?:sm|md|lg|xl|2xl|hover|focus|dark):/);
  const modules = count(/^[A-Za-z][\w-]*_[\w-]+__[A-Za-z0-9_-]{5}$|^[A-Za-z]+-module__/);
  const styled = count(/^sc-[A-Za-z0-9]{5,}$/);
  const emotion = count(/^css-[a-z0-9]{5,}(-|$)/);
  const bem = count(/^[a-z][a-z0-9-]*__[a-z0-9-]+(--[a-z0-9-]+)?$/);
  const framer = count(/^framer-[A-Za-z0-9]{5,}$/);
  const webflow = count(/^w-[a-z-]+$/);
  const result = [];
  if (tailwind / total > 0.15) result.push({ name: "Tailwind CSS (utilities)", share: tailwind / total });
  if (modules > 5) result.push({ name: "CSS Modules", share: modules / total });
  if (styled > 3) result.push({ name: "styled-components", share: styled / total });
  if (emotion > 3) result.push({ name: "Emotion (CSS-in-JS)", share: emotion / total });
  if (bem / total > 0.08) result.push({ name: "BEM naming", share: bem / total });
  if (framer > 5) result.push({ name: "Framer generated classes", share: framer / total });
  if (webflow > 5) result.push({ name: "Webflow classes", share: webflow / total });
  return result.sort((a, b) => b.share - a.share);
}

// ---------------------------------------------------------------- report

/**
 * @param {{ probe, headers, bundles: [{ url, endpoints, graphql, envKeys, sourceMap }], maps: [{ url, files }], routes: { source, list }[] }} input
 */
export function buildTechReport({ probe, headers = {}, bundles = [], maps = [], routes = [], decodedAt = new Date().toISOString() }) {
  const origin = new URL(probe.url).origin;
  const endpoints = new Map();
  for (const bundle of bundles) {
    for (const endpoint of bundle.endpoints) {
      if (!endpoints.has(endpoint)) endpoints.set(endpoint, new Set());
      endpoints.get(endpoint).add(bundle.url);
    }
  }
  // Calls the page actually made (XHR/fetch/beacon), from Resource Timing.
  for (const resource of probe.resources || []) {
    if (!/^(xmlhttprequest|fetch|beacon)$/.test(resource.type)) continue;
    let key = resource.url;
    try {
      const url = new URL(resource.url);
      key = url.origin === origin ? url.pathname : `${url.origin}${url.pathname}`;
    } catch (error) {}
    if (!endpoints.has(key)) endpoints.set(key, new Set());
    endpoints.get(key).add("runtime");
  }
  const allFiles = maps.flatMap((map) => map.files);
  const ownFiles = allFiles.filter((file) => !file.external);
  const routeList = [...new Set(routes.flatMap((entry) => entry.list))].sort();
  const thirdPartyHosts = new Map();
  for (const resource of probe.resources || []) {
    try {
      const host = new URL(resource.url).hostname;
      if (new URL(resource.url).origin !== origin) thirdPartyHosts.set(host, (thirdPartyHosts.get(host) || 0) + 1);
    } catch (error) {}
  }
  return {
    generator: "Keys_Osi tech decode",
    version: 1,
    url: probe.url,
    origin,
    title: probe.title,
    decodedAt,
    frameworks: probe.frameworks,
    generatorMeta: probe.generator,
    services: probe.services,
    hosting: analyzeHeaders(headers),
    css: detectCssArchitecture(probe.classTokens),
    stateRoots: probe.stateRoots,
    customElements: probe.customElements,
    serviceWorker: probe.serviceWorker,
    manifest: probe.manifest,
    cookieNames: probe.cookieNames,
    storageKeys: probe.storageKeys,
    routes: routeList,
    routeSources: routes.map((entry) => ({ source: entry.source, count: entry.list.length })),
    endpoints: [...endpoints.entries()].map(([endpoint, from]) => ({ endpoint, runtime: from.has("runtime"), bundles: [...from].filter((item) => item !== "runtime").length })).sort((a, b) => Number(b.runtime) - Number(a.runtime) || a.endpoint.localeCompare(b.endpoint)),
    graphql: [...new Set(bundles.flatMap((bundle) => bundle.graphql))],
    envKeys: [...new Set(bundles.flatMap((bundle) => bundle.envKeys))],
    bundles: bundles.map((bundle) => ({ url: bundle.url, bytes: bundle.bytes || 0, sourceMap: bundle.sourceMap || null })),
    sourceMaps: maps.map((map) => ({ url: map.url, files: map.files.length, withContent: map.files.filter((file) => file.content !== null).length })),
    sourceTree: summarizeSourceTree(allFiles),
    sourceStats: { files: allFiles.length, own: ownFiles.length, withContent: ownFiles.filter((file) => file.content !== null).length },
    thirdPartyHosts: [...thirdPartyHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([host, count]) => ({ host, count })),
    scripts: probe.scripts.length,
    inlineScripts: probe.inlineScripts
  };
}

function fw(report) {
  return report.frameworks.map((entry) => `${entry.name}${entry.version ? ` ${entry.version}` : ""}`).join(", ") || "none detected (static HTML or custom)";
}

export function generateTechMarkdown(report) {
  const out = [];
  out.push(`# TECH_STACK.md — ${report.title || report.origin}`);
  out.push("");
  out.push(`> Decoded by Keys_Osi from what ${report.origin} publicly ships (runtime globals, bundles, build manifests, source maps, HTTP headers) on ${report.decodedAt.slice(0, 10)}.`);
  out.push("");
  out.push("## Summary for the rebuild");
  out.push(`- Frameworks / runtimes: ${fw(report)}`);
  const next = report.frameworks.find((entry) => entry.name === "Next.js");
  if (next) out.push(`- Next.js ${next.router === "app" ? "App Router" : "Pages Router"}${next.buildId ? ` (build ${next.buildId})` : ""}${next.locales?.length ? `, i18n locales: ${next.locales.join(", ")}` : ""}`);
  out.push(`- Styling: ${report.css.map((entry) => `${entry.name} (${Math.round(entry.share * 100)} % of classes)`).join(", ") || "plain CSS classes"}`);
  out.push(`- Hosting / CDN: ${report.hosting.hosting.join(", ") || report.hosting.server || "unknown"}`);
  if (report.services.length) out.push(`- Client services: ${report.services.join(", ")}`);
  if (report.generatorMeta) out.push(`- Generator meta: ${report.generatorMeta}`);
  out.push(`- Recommended rebuild stack: ${recommendStack(report)}`);
  out.push("");

  out.push("## Routes found in build data");
  if (report.routes.length) {
    out.push(`Sources: ${report.routeSources.map((entry) => `${entry.source} (${entry.count})`).join(", ")}`);
    out.push("```text");
    out.push(...report.routes.slice(0, 300));
    out.push("```");
  } else {
    out.push("_No route manifest exposed (crawl the site with the Site view to map pages)._");
  }
  out.push("");

  out.push("## API surface");
  if (report.endpoints.length) {
    out.push("| Endpoint | Called at runtime | Referenced in bundles |");
    out.push("| --- | --- | --- |");
    for (const entry of report.endpoints.slice(0, 120)) out.push(`| \`${entry.endpoint.replace(/\|/g, "\\|")}\` | ${entry.runtime ? "yes" : ""} | ${entry.bundles || ""} |`);
  } else {
    out.push("_No API endpoint found._");
  }
  if (report.graphql.length) {
    out.push("");
    out.push(`GraphQL operations: ${report.graphql.slice(0, 60).map((op) => `\`${op}\``).join(", ")}`);
  }
  if (report.envKeys.length) out.push(`\nPublic build-time config keys (names only): ${report.envKeys.map((key) => `\`${key}\``).join(", ")}`);
  out.push("");

  out.push("## Data & state");
  for (const root of report.stateRoots) out.push(`- \`window.${root.key}\` shape: \`${JSON.stringify(root.shape).slice(0, 400)}\``);
  if (next?.pagePropsShape && Object.keys(next.pagePropsShape).length) out.push(`- Current page props shape: \`${JSON.stringify(next.pagePropsShape).slice(0, 400)}\``);
  if (!report.stateRoots.length) out.push("_No serialized client state found._");
  out.push("");

  out.push("## Original sources (public source maps)");
  if (report.sourceMaps.length) {
    out.push(`${report.sourceMaps.length} source map(s), ${report.sourceStats.own} first-party files (${report.sourceStats.withContent} with full content), ${report.sourceStats.files - report.sourceStats.own} dependency files.`);
    out.push("```text");
    out.push(...report.sourceTree);
    out.push("```");
    out.push("Use the Keys_Osi “Sources (ZIP)” export to get the files. Respect the site's license: study and interoperability, not copying.");
  } else {
    out.push("_No public source map: production bundles only._");
  }
  out.push("");

  out.push("## Platform details");
  if (report.customElements.length) out.push(`- Custom elements: ${report.customElements.join(", ")}`);
  if (report.serviceWorker) out.push(`- Service worker: ${report.serviceWorker}`);
  if (report.manifest) out.push(`- Web app manifest: ${report.manifest}`);
  out.push(`- Scripts: ${report.scripts} external, ${report.inlineScripts} inline`);
  out.push(`- Security headers: ${Object.entries(report.hosting.security).map(([name, present]) => `${name} ${present ? "✓" : "✗"}`).join(", ")}`);
  if (report.thirdPartyHosts.length) out.push(`- Third-party hosts: ${report.thirdPartyHosts.map((entry) => `${entry.host} (${entry.count})`).join(", ")}`);
  if (report.cookieNames.length) out.push(`- Cookies (names): ${report.cookieNames.join(", ")}`);
  if (report.storageKeys.length) out.push(`- localStorage keys: ${report.storageKeys.join(", ")}`);
  out.push("");
  return out.join("\n");
}

function recommendStack(report) {
  const names = report.frameworks.map((entry) => entry.name);
  const css = report.css[0]?.name || "";
  if (names.includes("Next.js")) return `Next.js (same router)${css.startsWith("Tailwind") ? " + Tailwind CSS" : ""}`;
  if (names.includes("Nuxt")) return "Nuxt 3 + Vue";
  if (names.includes("SvelteKit")) return "SvelteKit";
  if (names.includes("Astro")) return "Astro";
  if (names.includes("Remix / React Router")) return "React Router v7 (framework mode)";
  if (names.includes("Gatsby")) return "Next.js or Astro (Gatsby successor)";
  if (names.some((name) => ["Webflow", "Framer", "Wix", "Squarespace"].includes(name))) return `Astro or Next.js static export with the measured tokens (source is a no-code builder: ${names.filter((name) => ["Webflow", "Framer", "Wix", "Squarespace"].includes(name)).join(", ")})`;
  if (names.includes("WordPress")) return "WordPress block theme, or Astro/Next.js headless";
  if (names.includes("Shopify")) return "Shopify Online Store 2.0 theme (or Hydrogen)";
  if (names.includes("Vue")) return "Vue 3 + Vite";
  if (names.includes("Angular")) return "Angular";
  if (names.includes("React")) return `React + Vite${css.startsWith("Tailwind") ? " + Tailwind CSS" : ""}`;
  return "Astro (static HTML + islands)";
}

/** Files of the original sources ZIP (first-party files with content, optionally dependencies). */
export function buildSourceZipFiles(maps, { includeDependencies = false } = {}) {
  const used = new Set();
  const files = [];
  for (const map of maps) {
    for (const file of map.files) {
      if (file.content === null || (!includeDependencies && file.external) || !file.path) continue;
      let path = `sources/${file.path}`;
      for (let n = 2; used.has(path); n++) path = `sources/${file.path.replace(/(\.[^./]+)?$/, `~${n}$1`)}`;
      used.add(path);
      files.push({ path, content: file.content });
    }
  }
  return files;
}
