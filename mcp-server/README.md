# design-extractor-mcp

Local MCP server + HTTP bridge for the **Keys_Osi_Design.md-extractor** Chrome extension.

It closes the loop between the browser and your coding agent:

```text
Chrome extension ──POST──▶ HTTP bridge (127.0.0.1:8765) ──▶ ~/.design-extractor/
                                                                   ▲
Claude Code / Cursor / Codex ◀── MCP tools (stdio) ────────────────┘
```

Click **→ MCP** in the extension popup and the current extraction (DESIGN.md,
SKILL.md, W3C tokens, tailwind.config.js, full normalized data) becomes
instantly queryable by your agent — no downloading and dragging files around.

## Install

```bash
cd mcp-server
npm install
```

## Register with Claude Code

```bash
claude mcp add design-extractor -- node /absolute/path/to/mcp-server/server.mjs
```

Or in `.mcp.json` / Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "design-extractor": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/server.mjs"]
    }
  }
}
```

The MCP client starts the process; the HTTP bridge starts with it. You can
also run it standalone (`npm start`) if you only want the bridge.

## MCP tools

| Tool | Description |
| --- | --- |
| `list_extractions` | All received extractions, newest first. |
| `get_extraction_summary` | Compact overview: stack, token counts, a11y audit, breakpoints. |
| `get_design_md` | The DESIGN.md blueprint (defaults to latest). |
| `get_skill_md` | The agent-ready SKILL.md (defaults to latest). |
| `get_design_tokens` | Tokens as `raw` (full normalized data), `w3c`, or `tailwind`. |
| `list_curated_brands` | 60+ brand design systems from [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md). |
| `get_curated_design` | Fetches a curated brand DESIGN.md (Stripe, Linear, Vercel...) as a style reference. |

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `DESIGN_EXTRACTOR_PORT` | `8765` | HTTP bridge port (must match the extension). |

Extractions are stored as JSON under `~/.design-extractor/extractions/`.

## Example agent workflow

1. Open the target site in Chrome, click the extension, click **→ MCP**.
2. In Claude Code: *"Use design-extractor to get the latest extraction summary,
   then rebuild the landing page with the extracted tokens and DESIGN.md rules."*
