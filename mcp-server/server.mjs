#!/usr/bin/env node
/**
 * design-extractor-mcp
 *
 * One process, two faces:
 *  1. An HTTP bridge on 127.0.0.1:8765 that receives extractions pushed
 *     by the Keys_Osi_Design.md-extractor Chrome extension ("→ MCP" button).
 *  2. An MCP server (stdio) exposing those extractions to Claude Code,
 *     Cursor, Codex, or any Model Context Protocol client.
 *
 * Extractions are persisted as JSON files under ~/.design-extractor/ so
 * they survive restarts and can be inspected manually.
 *
 * Register with Claude Code:
 *   claude mcp add design-extractor -- node /path/to/mcp-server/server.mjs
 */

import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PORT = Number(process.env.DESIGN_EXTRACTOR_PORT) || 8765;
const STORE_DIR = join(homedir(), ".design-extractor", "extractions");
const MAX_BODY_BYTES = 50 * 1024 * 1024;

await mkdir(STORE_DIR, { recursive: true });

/* ---------------------------------------------------------------- *
 * Storage
 * ---------------------------------------------------------------- */

async function listExtractions() {
  const files = await readdir(STORE_DIR).catch(() => []);
  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(STORE_DIR, file), "utf8");
      const data = JSON.parse(raw);
      entries.push({
        id: file.replace(/\.json$/, ""),
        url: data.source?.url || "",
        title: data.source?.title || "",
        sampledAt: data.sampledAt || "",
        receivedAt: data.receivedAt || ""
      });
    } catch (error) {
      // Skip unreadable entries.
    }
  }
  entries.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  return entries;
}

async function readExtraction(id) {
  const safeId = String(id || "").replace(/[^a-z0-9_-]/gi, "");
  if (!safeId) {
    throw new Error("Invalid extraction id.");
  }
  const raw = await readFile(join(STORE_DIR, `${safeId}.json`), "utf8");
  return JSON.parse(raw);
}

async function latestExtraction() {
  const entries = await listExtractions();
  if (entries.length === 0) {
    throw new Error(
      "No extraction received yet. Open the Chrome extension on a site and click the \"→ MCP\" button."
    );
  }
  return readExtraction(entries[0].id);
}

async function resolveExtraction(id) {
  return id ? readExtraction(id) : latestExtraction();
}

/* ---------------------------------------------------------------- *
 * HTTP bridge (extension → this process)
 * ---------------------------------------------------------------- */

const httpServer = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "design-extractor-mcp" }));
    return;
  }

  if (req.method === "GET" && req.url === "/extractions") {
    const entries = await listExtractions();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(entries));
    return;
  }

  if (req.method === "POST" && req.url === "/extraction") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      if (!data || typeof data !== "object" || !data.normalized) {
        throw new Error("Payload must contain a 'normalized' extraction object.");
      }
      const hostname = safeHostname(data.source?.url) || "site";
      const id = `${hostname.replace(/[^a-z0-9-]/gi, "-")}-${Date.now()}`;
      data.receivedAt = new Date().toISOString();
      await writeFile(join(STORE_DIR, `${id}.json`), JSON.stringify(data, null, 2), "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id }));
      log(`Extraction stored: ${id} (${data.source?.url || "unknown url"})`);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

httpServer.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    log(`Port ${PORT} already in use — HTTP bridge disabled (another instance is probably running). MCP tools remain available.`);
  } else {
    log(`HTTP bridge error: ${error.message}`);
  }
});

httpServer.listen(PORT, "127.0.0.1", () => {
  log(`HTTP bridge listening on http://127.0.0.1:${PORT}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Payload too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "";
  }
}

function log(message) {
  // stdout is reserved for the MCP stdio protocol.
  process.stderr.write(`[design-extractor-mcp] ${message}\n`);
}

/* ---------------------------------------------------------------- *
 * MCP server (this process → Claude Code / Cursor / any MCP client)
 * ---------------------------------------------------------------- */

const mcp = new McpServer({
  name: "design-extractor",
  version: "0.1.0"
});

mcp.tool(
  "list_extractions",
  "Lists design extractions received from the Keys_Osi_Design.md-extractor Chrome extension, newest first.",
  {},
  async () => {
    const entries = await listExtractions();
    return textResult(JSON.stringify(entries, null, 2));
  }
);

mcp.tool(
  "get_design_md",
  "Returns the DESIGN.md design-system blueprint for an extraction (defaults to the most recent one). Use it as the source of truth when rebuilding the site's UI.",
  { id: z.string().optional().describe("Extraction id from list_extractions; omit for the latest.") },
  async ({ id }) => {
    const data = await resolveExtraction(id);
    return textResult(data.designMarkdown || "No DESIGN.md was included in this extraction.");
  }
);

mcp.tool(
  "get_skill_md",
  "Returns the agent-ready SKILL.md for an extraction (defaults to the most recent one). Install it under .claude/skills/ to enforce the extracted design system.",
  { id: z.string().optional().describe("Extraction id from list_extractions; omit for the latest.") },
  async ({ id }) => {
    const data = await resolveExtraction(id);
    return textResult(data.skillMarkdown || "No SKILL.md was included in this extraction.");
  }
);

mcp.tool(
  "get_design_tokens",
  "Returns the extracted design tokens. Format 'w3c' gives a W3C Design Tokens JSON (Style Dictionary compatible), 'tailwind' a tailwind.config.js, 'raw' the full normalized extraction (colors, typography, spacing, shadows, breakpoints, keyframes, interaction states, detected stack, accessibility audit).",
  {
    id: z.string().optional().describe("Extraction id; omit for the latest."),
    format: z.enum(["w3c", "tailwind", "raw"]).optional().describe("Token format, defaults to 'raw'.")
  },
  async ({ id, format }) => {
    const data = await resolveExtraction(id);
    if (format === "w3c") {
      return textResult(JSON.stringify(data.w3cTokens || {}, null, 2));
    }
    if (format === "tailwind") {
      return textResult(data.tailwindConfig || "// No tailwind config in this extraction.");
    }
    return textResult(JSON.stringify(data.normalized || {}, null, 2));
  }
);

mcp.tool(
  "get_extraction_summary",
  "Returns a compact summary of an extraction: source, detected stack, token counts, accessibility findings, breakpoints. Cheap way to orient before pulling full documents.",
  { id: z.string().optional().describe("Extraction id; omit for the latest.") },
  async ({ id }) => {
    const data = await resolveExtraction(id);
    const normalized = data.normalized || {};
    const summary = {
      source: data.source || {},
      sampledAt: data.sampledAt || "",
      detectedStack: (normalized.stack || []).map((item) => item.name),
      breakpoints: (normalized.breakpoints || []).map((item) => `${item.px}px`),
      tokenCounts: {
        colors: (normalized.colorPalette || []).length,
        typography: (normalized.typographyScale || []).length,
        spacing: (normalized.spacingScale || []).length,
        shadows: (normalized.shadowTokens || []).length,
        gradients: (normalized.gradientTokens || []).length,
        keyframes: (normalized.keyframes || []).length,
        interactionRules: (normalized.interactionStyles || []).length
      },
      accessibility: normalized.a11y || null,
      primaryFont: normalized.mainFontStyle?.primaryFamily || ""
    };
    return textResult(JSON.stringify(summary, null, 2));
  }
);

/* ---------------------------------------------------------------- *
 * Curated design library (VoltAgent/awesome-design-md)
 * 60+ brand design systems, fetched on demand and cached in memory.
 * ---------------------------------------------------------------- */

const CURATED_REPO = "VoltAgent/awesome-design-md";
const curatedCache = { brands: null, brandsAt: 0, files: new Map() };
const CURATED_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchCuratedBrands() {
  const now = Date.now();
  if (curatedCache.brands && now - curatedCache.brandsAt < CURATED_TTL_MS) {
    return curatedCache.brands;
  }
  const response = await fetch(
    `https://api.github.com/repos/${CURATED_REPO}/contents/design-md`,
    { headers: { "User-Agent": "design-extractor-mcp", Accept: "application/vnd.github+json" } }
  );
  if (!response.ok) {
    throw new Error(`GitHub API responded ${response.status} — try again later.`);
  }
  const entries = await response.json();
  const brands = entries
    .filter((entry) => entry.type === "dir")
    .map((entry) => entry.name)
    .sort();
  curatedCache.brands = brands;
  curatedCache.brandsAt = now;
  return brands;
}

async function fetchCuratedDesign(brand) {
  const safeBrand = String(brand || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!safeBrand) {
    throw new Error("Provide a brand name from list_curated_brands.");
  }
  if (curatedCache.files.has(safeBrand)) {
    return curatedCache.files.get(safeBrand);
  }
  const response = await fetch(
    `https://raw.githubusercontent.com/${CURATED_REPO}/main/design-md/${safeBrand}/DESIGN.md`,
    { headers: { "User-Agent": "design-extractor-mcp" } }
  );
  if (!response.ok) {
    throw new Error(
      `No curated DESIGN.md found for "${safeBrand}" (HTTP ${response.status}). Use list_curated_brands for valid names.`
    );
  }
  const text = await response.text();
  curatedCache.files.set(safeBrand, text);
  return text;
}

mcp.tool(
  "list_curated_brands",
  "Lists the 60+ brand design systems available in the curated VoltAgent/awesome-design-md library (Stripe, Linear, Apple, Vercel...). Use get_curated_design to fetch one.",
  {},
  async () => {
    const brands = await fetchCuratedBrands();
    return textResult(JSON.stringify(brands, null, 2));
  }
);

mcp.tool(
  "get_curated_design",
  "Fetches the curated DESIGN.md of a famous brand from VoltAgent/awesome-design-md (YAML tokens + full design-system analysis). Great as a style reference or to compare against an extraction.",
  { brand: z.string().describe("Brand folder name, e.g. 'stripe', 'linear.app', 'vercel' — see list_curated_brands.") },
  async ({ brand }) => {
    const text = await fetchCuratedDesign(brand);
    return textResult(text);
  }
);

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

const transport = new StdioServerTransport();
await mcp.connect(transport);
log("MCP server connected on stdio.");
