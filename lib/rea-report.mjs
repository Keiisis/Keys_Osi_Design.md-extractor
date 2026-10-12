/**
 * Keys_Osi advanced reverse engineering: compact summary and AI-facing
 * report of REA evidence (web bundle analysis, passive page inspection,
 * WebMCP discovery). Pure functions; tolerant of missing sections because
 * each REA operation can fail independently.
 */

// REA answers either { result, evidence } or the Evidence object itself,
// whose data sits in normalized_result, depending on the transport.
const resultOf = (entry) => (entry && !entry.error ? entry.result || entry.normalized_result || entry.evidence?.normalized_result || entry : null);

function labelOf(item) {
  if (item === null || item === undefined) return "";
  if (typeof item !== "object") return String(item);
  for (const key of ["value", "route", "path", "pattern", "url", "endpoint", "name", "label", "literal"]) {
    if (typeof item[key] === "string" && item[key]) return item[key];
  }
  return JSON.stringify(item).slice(0, 160);
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (error) {
    return "";
  }
}

function countBy(list, key) {
  const counts = {};
  for (const item of list) {
    const value = typeof key === "function" ? key(item) : item?.[key];
    if (value) counts[value] = (counts[value] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export function summarizeReaResults(results = {}, { url = "" } = {}) {
  const bundle = resultOf(results.bundle);
  const page = resultOf(results.page);
  const webmcp = resultOf(results.webmcp);
  const origin = originOf(url);
  const observations = bundle?.observations || {};
  const chunkNodes = observations.chunks?.nodes || [];
  const resources = Array.isArray(page?.resources) ? page.resources : [];
  const requests = page?.network?.requests || [];
  const storage = page?.storage || {};

  const summary = {
    url,
    errors: Object.fromEntries(Object.entries(results).filter(([, value]) => value?.error).map(([key, value]) => [key, value.error])),
    browser: page?.browser?.product || "",
    title: page?.target?.title || "",
    bundle: bundle
      ? {
          scriptsObserved: bundle.capture?.scripts_observed ?? chunkNodes.length,
          scriptsAnalyzed: bundle.capture?.scripts_analyzed ?? chunkNodes.length,
          bytes: chunkNodes.reduce((sum, node) => sum + (node.bytes || 0), 0),
          chunks: chunkNodes.map((node) => ({ url: node.url, bytes: node.bytes || 0 })).sort((a, b) => b.bytes - a.bytes),
          chunkEdges: (observations.chunks?.edges || []).length,
          routes: [...new Set((observations.routes || []).map(labelOf).filter(Boolean))],
          endpoints: [...new Set((observations.endpoints || []).map(labelOf).filter(Boolean))],
          webmcpDeclarations: (observations.webmcp_declarations || []).map(labelOf),
          sourceMaps: { status: observations.source_maps?.status || "unknown", processed: observations.source_maps?.processed || 0, items: (observations.source_maps?.items || []).map(labelOf) },
          inferences: (bundle.inferences || []).map(labelOf).slice(0, 40),
          unknowns: (bundle.unknowns || []).map((unknown) => `${unknown.dimension || "?"}: ${unknown.reason || labelOf(unknown)}`),
          completeness: bundle.completeness?.status || "unknown",
          parseFailures: bundle.completeness?.parse_failures || 0
        }
      : null,
    page: page
      ? {
          domNodes: page.dom?.total_nodes || 0,
          accessibilityNodes: page.accessibility?.total_nodes || 0,
          scripts: page.scripts?.total || 0,
          scriptsWithSourceMap: (page.scripts?.items || []).filter((item) => item.source_map_url).length,
          modules: (page.scripts?.items || []).filter((item) => item.is_module).length,
          resources: resources.length,
          resourceTypes: countBy(resources, "type"),
          thirdPartyOrigins: countBy(resources.filter((item) => item.origin && item.origin !== origin), "origin").slice(0, 20),
          requests: requests.length,
          websocketEvents: (page.network?.websocket_events || []).length,
          consoleEvents: (page.console?.events || []).length,
          workers: (page.workers || []).map(labelOf),
          frames: (page.frames || []).length,
          storage: {
            localStorageKeys: (storage.local_storage_keys || []).length,
            sessionStorageKeys: (storage.session_storage_keys || []).length,
            indexedDb: storage.indexed_db_names || [],
            caches: storage.cache_names || [],
            usageBytes: storage.usage_bytes || 0
          },
          agentHints: (page.metadata?.agent_hints || []).map(labelOf).slice(0, 20),
          completeness: page.completeness?.status || "unknown"
        }
      : null,
    webmcpTools: webmcp ? [].concat(webmcp.tools?.items || (Array.isArray(webmcp.tools) ? webmcp.tools : []) || []).map(labelOf) : [],
    limitations: [...new Set([...(bundle?.limitations || []), ...(page?.limitations || [])])].slice(0, 12)
  };
  return summary;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function buildReaReport(summary, { url = "", dir = "" } = {}) {
  const out = [];
  out.push(`# REA_REPORT.md — ${summary.title || url}`);
  out.push("");
  out.push(`> Advanced reverse engineering by Keys_Osi + REA on ${url}. Evidence is passive (no page JavaScript evaluated by the analyzers, no clicks, no navigation beyond loading the page). Full JSON evidence${dir ? ` in \`${dir}\`` : ""}.`);
  out.push("");
  if (Object.keys(summary.errors).length) {
    out.push("## Operations that failed");
    for (const [key, error] of Object.entries(summary.errors)) out.push(`- ${key}: ${error}`);
    out.push("");
  }
  const bundle = summary.bundle;
  if (bundle) {
    out.push("## JavaScript bundles (static analysis)");
    out.push(`- Scripts: ${bundle.scriptsAnalyzed}/${bundle.scriptsObserved} analysed, ${kb(bundle.bytes)} total, ${bundle.chunkEdges} chunk dependencies, completeness: ${bundle.completeness}${bundle.parseFailures ? `, ${bundle.parseFailures} parse failures` : ""}.`);
    for (const chunk of bundle.chunks.slice(0, 25)) out.push(`  - \`${chunk.url}\` — ${kb(chunk.bytes)}`);
    out.push(`- Routes found in code: ${bundle.routes.length ? bundle.routes.map((route) => `\`${route}\``).join(", ") : "none"}`);
    out.push(`- Endpoints found in code: ${bundle.endpoints.length ? bundle.endpoints.map((endpoint) => `\`${endpoint}\``).join(", ") : "none"}`);
    out.push(`- Source maps: ${bundle.sourceMaps.status} (${bundle.sourceMaps.processed} processed)${bundle.sourceMaps.items.length ? `: ${bundle.sourceMaps.items.slice(0, 10).join(", ")}` : ""}`);
    if (bundle.webmcpDeclarations.length) out.push(`- WebMCP declarations: ${bundle.webmcpDeclarations.join(", ")}`);
    if (bundle.inferences.length) out.push(`- Inferences: ${bundle.inferences.join("; ")}`);
    if (bundle.unknowns.length) out.push(`- Explicit unknowns: ${bundle.unknowns.join("; ")}`);
    out.push("");
  }
  const page = summary.page;
  if (page) {
    out.push("## Page inspection (passive CDP)");
    out.push(`- DOM nodes: ${page.domNodes}; accessibility nodes: ${page.accessibilityNodes}; frames: ${page.frames}`);
    out.push(`- Scripts: ${page.scripts} (${page.modules} ES modules, ${page.scriptsWithSourceMap} with a source map URL)`);
    out.push(`- Resources: ${page.resources} — ${page.resourceTypes.map(([type, count]) => `${type} ×${count}`).join(", ")}`);
    if (page.thirdPartyOrigins.length) out.push(`- Third-party origins: ${page.thirdPartyOrigins.map(([host, count]) => `${host} (${count})`).join(", ")}`);
    out.push(`- Network during the window: ${page.requests} requests, ${page.websocketEvents} WebSocket events, ${page.consoleEvents} console events`);
    if (page.workers.length) out.push(`- Workers: ${page.workers.join(", ")}`);
    out.push(`- Storage: ${page.storage.localStorageKeys} localStorage keys, ${page.storage.sessionStorageKeys} sessionStorage keys, IndexedDB: ${page.storage.indexedDb.join(", ") || "none"}, caches: ${page.storage.caches.join(", ") || "none"} (values redacted)`);
    if (page.agentHints.length) out.push(`- Agent hints: ${page.agentHints.join(", ")}`);
    out.push(`- Completeness: ${page.completeness}`);
    out.push("");
  }
  out.push("## WebMCP tools declared by the page");
  out.push(summary.webmcpTools.length ? summary.webmcpTools.map((tool) => `- ${tool}`).join("\n") : "_None declared._");
  out.push("");
  if (summary.limitations.length) {
    out.push("## Limitations stated by the analyzers");
    for (const limitation of summary.limitations) out.push(`- ${limitation}`);
    out.push("");
  }
  return out.join("\n");
}
