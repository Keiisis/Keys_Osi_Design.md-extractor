// Fake MCP stdio server for the native host tests: answers like REA with
// the real htmx.org evidence captured in this folder.
import { readFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, here), "utf8"));
const tools = Array.from({ length: 130 }, (_, i) => ({ name: i === 0 ? "analyze_web_bundle" : `tool_${i}`, description: `Tool ${i}`, inputSchema: { type: "object", properties: { cdp_endpoint: {}, target_id: {} }, required: ["cdp_endpoint"] } }));
const calls = [];

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    const reply = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    if (message.method === "initialize") reply({ protocolVersion: "2025-06-18", serverInfo: { name: "rea", version: "6.4.0-test" }, capabilities: { tools: {} } });
    else if (message.method === "tools/list") {
      // Two pages, like a paginating server.
      const start = message.params?.cursor ? 100 : 0;
      reply({ tools: tools.slice(start, start + 100), ...(start === 0 ? { nextCursor: "page2" } : {}) });
    } else if (message.method === "tools/call") {
      const { name, arguments: args } = message.params;
      calls.push({ name, args });
      const text = (value) => reply({ content: [{ type: "text", text: JSON.stringify(value) }] });
      if (name === "analyze_web_bundle") text(fixture("bundle-htmx.json"));
      else if (name === "inspect_web_page") text(fixture("page-htmx.json"));
      // Real REA 6.4 shape: Evidence object, data in normalized_result, tools as { total, items }.
      else if (name === "discover_webmcp_tools") text({ evidence_id: "ev_test", normalized_result: { status: "available", tools: { total: 1, items: [{ name: "search_docs" }] } } });
      else if (name === "capture_web_screenshot") text({ result: { artifact: { media_type: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" } } });
      else if (name === "debug_calls") text({ calls });
      else if (name === "fails") reply({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: "target not found" }) }] });
      else text({ ok: true, name, args });
    }
  }
});
