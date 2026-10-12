// Keys_Osi native host: framing, MCP client, operations, report, installer ID.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FrameReader, McpClient, createHost, encodeFrame } from "../native-host/host-core.mjs";
import { unpackedExtensionId } from "../native-host/install.mjs";
import { buildReaReport, summarizeReaResults } from "../lib/rea-report.mjs";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/rea/${name}`, import.meta.url), "utf8"));

// Framing: split and coalesced chunks
{
  const received = [];
  const reader = new FrameReader((message) => received.push(message));
  const a = encodeFrame({ id: 1, method: "status", text: "é ✓" });
  const b = encodeFrame({ id: 2, method: "ping" });
  const both = Buffer.concat([a, b]);
  reader.push(both.subarray(0, 3));
  reader.push(both.subarray(3, a.length + 5));
  reader.push(both.subarray(a.length + 5));
  assert.deepEqual(received, [{ id: 1, method: "status", text: "é ✓" }, { id: 2, method: "ping" }]);
  assert.equal(a.readUInt32LE(0), a.length - 4);
}

// Installer: unpacked extension ID derived like Chromium (value observed on a real load of this folder)
assert.equal(unpackedExtensionId("C:\\Users\\HP\\Desktop\\Nouveau dossier", "win32"), "cflaookoopknmkifochefjnfhooclmdi");
assert.equal(unpackedExtensionId("c:/Users/HP/Desktop/Nouveau dossier", "win32"), "cflaookoopknmkifochefjnfhooclmdi", "separators and drive case normalised");

// Report from real REA evidence (htmx.org)
{
  const results = { bundle: await fixture("bundle-htmx.json"), page: await fixture("page-htmx.json"), webmcp: { error: "Experimental domain disabled" } };
  const summary = summarizeReaResults(results, { url: "https://htmx.org/" });
  assert.equal(summary.bundle.scriptsAnalyzed, 5);
  assert.equal(summary.bundle.bytes, 3293 + 287 + 171362 + 4752 + 101285);
  assert.equal(summary.bundle.chunks[0].url, "https://htmx.org/js/htmx.js", "largest chunk first");
  assert.equal(summary.bundle.sourceMaps.status, "unavailable");
  assert.equal(summary.bundle.completeness, "partial");
  assert.equal(summary.page.resources, 50);
  assert.equal(summary.page.scripts, 5);
  assert.ok(summary.page.domNodes > 500);
  assert.deepEqual(summary.errors, { webmcp: "Experimental domain disabled" });
  const report = buildReaReport(summary, { url: "https://htmx.org/", dir: "C:/out" });
  for (const needle of ["# REA_REPORT.md", "## Operations that failed", "- webmcp: Experimental domain disabled", "`https://htmx.org/js/htmx.js` — 167.3 KB", "Source maps: unavailable", "## Page inspection (passive CDP)", "Resources: 50", "REA does not execute captured JavaScript"]) {
    assert.ok(report.includes(needle), `report contains ${needle}`);
  }
}

// MCP client + host operations against a fake REA server
{
  const fake = fileURLToPath(new URL("./fixtures/rea/fake-mcp.mjs", import.meta.url));
  const logs = [];
  const mcp = new McpClient({ command: process.execPath, args: [fake], log: (line) => logs.push(line) });
  const opened = [];
  const browser = {
    executable: "chrome-test",
    start: async () => "http://127.0.0.1:9999",
    open: async (url) => (opened.push(url), "TARGET1"),
    settle: async () => ({}),
    close: async (id) => opened.push(`closed:${id}`),
    stop: async () => {}
  };
  process.env.KEYS_OSI_REA_OUT = await mkdtemp(join(tmpdir(), "keys-osi-rea-test-"));
  const progress = [];
  const host = createHost({ mcp, browser, onProgress: (event) => progress.push(event.step) });

  const status = await host.handle({ method: "status" });
  assert.equal(status.rea.tools, 130, "paginated tools/list collected");
  assert.equal(status.rea.version, "6.4.0-test");
  const list = await host.handle({ method: "list_tools" });
  assert.equal(list.tools[0].name, "analyze_web_bundle");
  assert.deepEqual(list.tools[0].required, ["cdp_endpoint"]);

  const analysis = await host.handle({ method: "analyze_url", params: { url: "https://htmx.org/", sourceMaps: true } });
  assert.deepEqual(opened, ["https://htmx.org/", "closed:TARGET1"], "analysis tab opened then closed");
  assert.deepEqual(progress.slice(0, 3), ["browser", "load", "bundle"]);
  assert.equal(analysis.summary.bundle.scriptsAnalyzed, 5);
  assert.deepEqual(analysis.summary.webmcpTools, ["search_docs"]);
  assert.ok(analysis.files.includes("screenshot.png"), "screenshot evidence saved");
  const saved = await readFile(join(analysis.dir, "REA_REPORT.md"), "utf8");
  assert.ok(saved.includes("search_docs") && saved.includes("htmx.js"));
  const debug = await host.handle({ method: "call_tool", params: { name: "debug_calls" } });
  const bundleCall = debug.result.calls.find((call) => call.name === "analyze_web_bundle");
  assert.deepEqual([bundleCall.args.cdp_endpoint, bundleCall.args.target_id, bundleCall.args.fetch_source_maps], ["http://127.0.0.1:9999", "TARGET1", true], "REA receives the CDP endpoint and target");

  await assert.rejects(() => host.handle({ method: "call_tool", params: { name: "fails" } }), /fails : target not found/);
  await assert.rejects(() => host.handle({ method: "nope" }), /Méthode inconnue/);
  await assert.rejects(() => host.handle({ method: "analyze_url", params: { url: "file:///etc/passwd" } }), /URL http/);
  await host.shutdown();
}

console.log("Native host tests passed.");
