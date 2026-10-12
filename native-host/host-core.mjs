/**
 * Keys_Osi native host core: Chrome native messaging framing, a minimal MCP
 * (JSON-RPC over stdio) client for the REA reverse-engineering server, a
 * headless Chrome with a loopback CDP endpoint for REA's web tools, and the
 * high-level operations the extension calls.
 *
 * Nothing here writes to stdout except framed messages: stdout is the
 * native messaging channel.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildReaReport, summarizeReaResults } from "../lib/rea-report.mjs";

export const HOST_VERSION = "1.0.0";
export const REA_PACKAGE = "rea-agents@6.4.0";
const MAX_MESSAGE = 900 * 1024; // Chrome caps host → extension messages at 1 MB.

// ---------------------------------------------------------------- framing

export function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Incremental decoder of 4-byte little-endian length-prefixed JSON frames. */
export class FrameReader {
  constructor(onMessage) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + length) return;
      const body = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      this.onMessage(JSON.parse(body));
    }
  }
}

// ---------------------------------------------------------------- MCP client

/** Minimal MCP stdio client: newline-delimited JSON-RPC 2.0. */
export class McpClient {
  constructor({ command, args = [], log = () => {} }) {
    this.command = command;
    this.args = args;
    this.log = log;
    this.nextId = 1;
    this.pending = new Map();
    this.child = null;
    this.serverInfo = null;
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      // npx/npm are .cmd shims on Windows: Node refuses to spawn them without
      // a shell, so run them through cmd.exe with fixed arguments.
      const viaCmd = platform() === "win32" && /^(npx|npm)(\.cmd)?$/i.test(this.command);
      this.child = viaCmd
        ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", this.command, ...this.args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
        : spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let line = "";
      this.child.stdout.on("data", (chunk) => {
        line += chunk.toString("utf8");
        let index;
        while ((index = line.indexOf("\n")) !== -1) {
          const raw = line.slice(0, index).trim();
          line = line.slice(index + 1);
          if (!raw) continue;
          let message;
          try {
            message = JSON.parse(raw);
          } catch (error) {
            this.log(`mcp: non-JSON line ${raw.slice(0, 200)}`);
            continue;
          }
          const waiter = message.id !== undefined ? this.pending.get(message.id) : null;
          if (waiter) {
            this.pending.delete(message.id);
            clearTimeout(waiter.timer);
            if (message.error) waiter.reject(new Error(message.error.message || "Erreur MCP"));
            else waiter.resolve(message.result);
          }
        }
      });
      this.child.stderr.on("data", (chunk) => this.log(`rea: ${chunk.toString("utf8").trim().slice(0, 500)}`));
      this.child.on("exit", (code) => {
        for (const waiter of this.pending.values()) waiter.reject(new Error(`Le serveur REA s'est arrêté (code ${code}).`));
        this.pending.clear();
        this.ready = null;
      });
      this.child.on("error", (error) => this.log(`spawn: ${error.message}`));
      const init = await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "keys-osi", version: HOST_VERSION } }, 180000);
      this.serverInfo = init.serverInfo || null;
      this.notify("notifications/initialized", {});
      return init;
    })();
    try {
      return await this.ready;
    } catch (error) {
      this.ready = null;
      throw error;
    }
  }

  request(method, params, timeoutMs = 120000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`REA n'a pas répondu à ${method} en ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async listTools() {
    await this.start();
    const tools = [];
    let cursor;
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(page.tools || []));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  /** Calls a tool and returns its JSON result (structured content or parsed text). */
  async callTool(name, args, timeoutMs = 300000) {
    await this.start();
    const result = await this.request("tools/call", { name, arguments: args || {} }, timeoutMs);
    const text = (result.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
    let data = result.structuredContent ?? null;
    if (data === null && text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = { text };
      }
    }
    if (result.isError) {
      const message = typeof data?.error === "string" ? data.error : data?.error?.message || text || "Échec de l'outil REA.";
      throw new Error(`${name} : ${String(message).slice(0, 600)}`);
    }
    return data;
  }

  stop() {
    if (this.child && !this.child.killed) this.child.kill();
  }
}

// ---------------------------------------------------------------- headless browser

export function findBrowser() {
  if (process.env.KEYS_OSI_CHROME && existsSync(process.env.KEYS_OSI_CHROME)) return process.env.KEYS_OSI_CHROME;
  const candidates =
    platform() === "win32"
      ? [
          join(process.env.ProgramFiles || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
          join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
          join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
          join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
          join(process.env.ProgramFiles || "C:\\Program Files", "BraveSoftware\\Brave-Browser\\Application\\brave.exe")
        ]
      : platform() === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  return candidates.find((path) => path && existsSync(path)) || null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A private headless Chrome exposing a loopback CDP endpoint for REA. */
export class CdpBrowser {
  constructor({ executable = findBrowser(), log = () => {} } = {}) {
    this.executable = executable;
    this.log = log;
    this.child = null;
    this.endpoint = null;
  }

  async start() {
    if (this.endpoint) return this.endpoint;
    if (!this.executable) throw new Error("Aucun Chrome, Edge ou Brave trouvé : installe Chrome ou définis KEYS_OSI_CHROME.");
    this.profile = await mkdtemp(join(tmpdir(), "keys-osi-cdp-"));
    this.child = spawn(this.executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${this.profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "about:blank"], { stdio: "ignore", windowsHide: true });
    this.child.on("exit", () => {
      this.endpoint = null;
    });
    const portFile = join(this.profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(150);
    if (!existsSync(portFile)) throw new Error("Chrome sans interface n'a pas ouvert son port de débogage.");
    const port = (await readFile(portFile, "utf8")).split(/\r?\n/)[0].trim();
    this.endpoint = `http://127.0.0.1:${port}`;
    return this.endpoint;
  }

  async open(url) {
    const endpoint = await this.start();
    const response = await fetch(`${endpoint}/json/new?${url}`, { method: "PUT" });
    if (!response.ok) throw new Error(`Ouverture de l'onglet d'analyse impossible (HTTP ${response.status}).`);
    const target = await response.json();
    return target.id;
  }

  /** Waits until the page title appears and stays stable (rendered enough to analyse). */
  async settle(targetId, maxMs = 15000) {
    let previous = null;
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(500);
      const list = await fetch(`${this.endpoint}/json/list`).then((response) => response.json()).catch(() => []);
      const target = list.find((entry) => entry.id === targetId);
      const signature = target ? `${target.url}|${target.title}` : "";
      if (target && target.title && signature === previous) return target;
      previous = signature;
    }
    return null;
  }

  async close(targetId) {
    if (this.endpoint && targetId) await fetch(`${this.endpoint}/json/close/${targetId}`).catch(() => {});
  }

  async stop() {
    if (this.child && !this.child.killed) this.child.kill();
    this.endpoint = null;
    if (this.profile) await rm(this.profile, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------- operations

export function outputRoot() {
  return process.env.KEYS_OSI_REA_OUT || join(homedir(), "Downloads", "Keys_Osi-REA");
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function safeName(text) {
  return String(text || "analyse").replace(/[^a-z0-9.-]+/gi, "_").slice(0, 60);
}

function capped(value) {
  const text = JSON.stringify(value);
  return text.length <= MAX_MESSAGE ? value : { truncated: true, preview: text.slice(0, 20000) };
}

/** Finds the base64 PNG inside a REA screenshot result, wherever the tool put it. */
function findPngBase64(value, depth = 0) {
  if (!value || depth > 6) return null;
  if (typeof value === "string") return value.startsWith("iVBORw0KGgo") ? value : null;
  if (typeof value !== "object") return null;
  for (const child of Object.values(value)) {
    const found = findPngBase64(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function createHost({ mcp, browser, log = () => {}, onProgress = () => {} }) {
  let toolCache = null;

  async function status() {
    const browserPath = browser.executable;
    let rea = null;
    let error = null;
    try {
      const tools = toolCache || (toolCache = await mcp.listTools());
      rea = { name: mcp.serverInfo?.name || "rea", version: mcp.serverInfo?.version || "", tools: tools.length };
    } catch (failure) {
      error = failure.message;
    }
    return { host: HOST_VERSION, node: process.version, platform: platform(), browser: browserPath, rea, error, output: outputRoot() };
  }

  async function listTools() {
    const tools = toolCache || (toolCache = await mcp.listTools());
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: String(tool.description || "").slice(0, 400),
        required: tool.inputSchema?.required || [],
        properties: Object.keys(tool.inputSchema?.properties || {})
      }))
    };
  }

  async function toolSchema({ name }) {
    const tools = toolCache || (toolCache = await mcp.listTools());
    const tool = tools.find((entry) => entry.name === name);
    if (!tool) throw new Error(`Outil REA inconnu : ${name}`);
    return { name, inputSchema: capped(tool.inputSchema || {}) };
  }

  /** One full web reverse-engineering pass on a URL, evidence saved to disk. */
  async function analyzeUrl({ url, sourceMaps = true, accessibility = false, storageKeys = false, observeMs = 1500 }) {
    if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("URL http(s) requise.");
    const dir = join(outputRoot(), `${safeName(new URL(url).hostname)}-${stamp()}`);
    await mkdir(dir, { recursive: true });
    onProgress({ step: "browser", message: "Chrome d'analyse (CDP)…" });
    const endpoint = await browser.start();
    const targetId = await browser.open(url);
    try {
      onProgress({ step: "load", message: "Chargement de la page…" });
      await browser.settle(targetId);
      const base = { cdp_endpoint: endpoint, target_id: targetId };
      const results = {};
      const run = async (key, tool, args, label) => {
        onProgress({ step: key, message: label });
        try {
          results[key] = await mcp.callTool(tool, { ...base, ...args });
          await writeFile(join(dir, `${key}.json`), JSON.stringify(results[key], null, 2));
        } catch (error) {
          results[key] = { error: error.message };
        }
      };
      await run("bundle", "analyze_web_bundle", { fetch_source_maps: Boolean(sourceMaps), observation_ms: observeMs, include_storage_keys: Boolean(storageKeys) }, "Analyse statique des bundles JavaScript…");
      await run("page", "inspect_web_page", { observation_ms: observeMs, include_accessibility_text: Boolean(accessibility), include_storage_keys: Boolean(storageKeys) }, "Inspection passive de la page (DOM, réseau, workers, stockage)…");
      await run("webmcp", "discover_webmcp_tools", { observation_ms: 300 }, "Recherche des outils WebMCP déclarés…");
      await run("screenshot", "capture_web_screenshot", {}, "Capture de preuve…");
      const png = findPngBase64(results.screenshot);
      if (png) await writeFile(join(dir, "screenshot.png"), Buffer.from(png, "base64"));
      const summary = summarizeReaResults(results, { url });
      const report = buildReaReport(summary, { url, dir });
      await writeFile(join(dir, "REA_REPORT.md"), report);
      return { dir, files: ["REA_REPORT.md", "bundle.json", "page.json", "webmcp.json", ...(png ? ["screenshot.png"] : [])], summary, report };
    } finally {
      await browser.close(targetId);
    }
  }

  /** A local artifact (bundle, source map, archive, APK, executable, WASM…) analysed by REA. */
  async function analyzeFile({ name, base64 }) {
    if (!base64) throw new Error("Fichier vide.");
    const dir = join(outputRoot(), `fichier-${safeName(name)}-${stamp()}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, basename(safeName(name)));
    await writeFile(path, Buffer.from(base64, "base64"));
    const results = {};
    onProgress({ step: "open", message: "Ouverture de l'artefact…" });
    results.open = await mcp.callTool("open_binary", { path });
    onProgress({ step: "inspect", message: "Inventaire de l'artefact…" });
    try {
      results.inspect = await mcp.callTool("inspect_artifact", {});
    } catch (error) {
      results.inspect = { error: error.message };
    }
    try {
      results.overview = await mcp.callTool("binary_overview", {});
    } catch (error) {
      results.overview = { error: error.message };
    }
    await mcp.callTool("close_binary", {}).catch(() => {});
    for (const [key, value] of Object.entries(results)) await writeFile(join(dir, `${key}.json`), JSON.stringify(value, null, 2));
    return { dir, path, results: capped(results) };
  }

  /** Expert mode: any REA tool with explicit arguments; a full copy lands on disk. */
  async function callTool({ name, arguments: args, useBrowser = false, url }) {
    let targetId = null;
    let finalArgs = args || {};
    if (useBrowser) {
      // Only inject what the tool declares: REA rejects unknown keys.
      const tools = toolCache || (toolCache = await mcp.listTools());
      const declared = Object.keys(tools.find((tool) => tool.name === name)?.inputSchema?.properties || {});
      const endpoint = await browser.start();
      // The page is opened even for endpoint-only tools so they see it listed.
      if (url && declared.includes("cdp_endpoint")) {
        targetId = await browser.open(url);
        await browser.settle(targetId);
      }
      finalArgs = {
        ...(declared.includes("cdp_endpoint") ? { cdp_endpoint: endpoint } : {}),
        ...(targetId && declared.includes("target_id") ? { target_id: targetId } : {}),
        ...finalArgs
      };
    }
    try {
      const result = await mcp.callTool(name, finalArgs);
      const dir = join(outputRoot(), "outils");
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${safeName(name)}-${stamp()}.json`);
      await writeFile(file, JSON.stringify(result, null, 2));
      return { file, result: capped(result) };
    } finally {
      if (targetId) await browser.close(targetId);
    }
  }

  function openPath({ path }) {
    const target = String(path || outputRoot());
    const opener = platform() === "win32" ? ["explorer.exe", [target]] : platform() === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
    spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref();
    return { opened: target };
  }

  const handlers = { status, list_tools: listTools, tool_schema: toolSchema, analyze_url: analyzeUrl, analyze_file: analyzeFile, call_tool: callTool, open_path: openPath, ping: async () => ({ pong: true, host: HOST_VERSION }) };

  return {
    async handle(message) {
      const handler = handlers[message.method];
      if (!handler) throw new Error(`Méthode inconnue : ${message.method}`);
      return handler(message.params || {});
    },
    async shutdown() {
      mcp.stop();
      await browser.stop();
    }
  };
}
