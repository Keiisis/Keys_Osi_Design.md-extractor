# Keys_Osi_Design.md-extractor (Chrome Extension)

This Chrome extension extracts styles and information from any given site and generates a `DESIGN.md` or `SKILL.md` file that you can use with tools such as Google Stitch, Claude Code, Codex, and others to build websites with a given design system blueprint. The file format is based on the open-source [TypeUI DESIGN.md](https://www.typeui.sh/design-md) specification.

<img width="1200" height="630" alt="designmdchrome" src="https://github.com/user-attachments/assets/64efbebb-1c68-4ca1-8792-ca167d5e12d6" />

## Getting started

Load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

## Curated design skills

Check out curated design systems at [typeui.sh/design-skills](https://www.typeui.sh/design-skills).

## Available actions

| Action | Description |
| --- | --- |
| Auto-extract | Reads styles from the active tab (typography, colors, gradients, spacing, radius, shadows, motion, `@keyframes`, hover/focus states, responsive breakpoints, runtime animations via the Web Animations API, detected tech stack, and a measured WCAG contrast + target-size audit). Traverses open shadow roots. |
| Generate `DESIGN.md` | Produces design-system documentation markdown from extracted signals. |
| Generate `SKILL.md` | Produces agent-ready skill markdown from extracted signals. |
| Clone site (ZIP) | Packages the page — HTML, rewritten CSS (fonts/background images/`@import` chains resolved to local paths), images, fonts, media, inline SVG icons, PWA manifest/favicons, and optional section-by-section screenshots — into a single ZIP. Can crawl up to 10 internal pages with working local navigation. Optional static snapshot strips scripts so SPA clones render offline. |
| Export tokens | `tailwind.config.js` and W3C Design Tokens JSON (Style Dictionary / Figma Tokens compatible). |
| Advanced audit (opt-in) | Real device emulation at 375/768/1440px with per-viewport tokens + screenshots, and a `prefers-color-scheme: dark` capture with its own palette (only kept when the site actually implements a dark theme). Uses the `debugger` permission, requested on demand — never at install. |
| Disclosure capture (opt-in) | Safely opens menus/accordions/dropdowns before capture (never links, never forms, never transactional buttons — FR/EN blocklist), screenshots the open state, then restores the page. |
| `DIFF.md` | Compares the current extraction with the previous one of the same site from local history. |
| `→ MCP` | Pushes the extraction to the local [design-extractor-mcp](mcp-server/README.md) bridge so Claude Code / Cursor can query it directly. |
| Refresh | Re-runs extraction for the current page state. |
| Download | Saves generated output as `DESIGN.md` or `SKILL.md`. |
| Explain (`?`) | Shows how the file was generated, with TypeUI reference. |

## Clone ZIP layout

```text
site.zip
├── index.html            # rewritten to local paths
├── pages/*.html          # crawled internal pages (optional)
├── css/ js/ img/ fonts/  # downloaded assets, deduplicated
├── icons/                # extracted inline SVG icons
├── meta/                 # PWA manifest + site-meta.json
├── screenshots/          # sections, viewport-{mobile,tablet,desktop}.png,
│                         # dark-mode.png, disclosures-open.png (optional)
├── tokens/               # design_tokens.json, design.tokens.json (W3C),
│                         # tailwind.config.js, responsive-audit.json
├── DESIGN.md             # blueprint incl. visual references
└── SKILL.md              # agent-ready skill
```

## MCP integration

The [mcp-server/](mcp-server/) package runs a local MCP server with an HTTP
bridge: click **→ MCP** in the popup, then query `get_design_md`,
`get_design_tokens`, `get_extraction_summary`, etc. from Claude Code or Cursor.
See [mcp-server/README.md](mcp-server/README.md).

## Generated file structure

The generated markdown follows this structure:

| Section | What it does |
| --- | --- |
| `Mission` | Defines the design-system objective for the extracted site. |
| `Brand` | Captures product/brand context, URL, audience, and product surface. |
| `Style Foundations` | Lists inferred visual tokens and foundations. |
| `Accessibility` | Applies WCAG 2.2 AA requirements and interaction constraints. |
| `Writing Tone` | Sets guidance tone for implementation-ready output. |
| `Rules: Do` | Lists required implementation practices. |
| `Rules: Don't` | Lists anti-patterns and prohibited behavior. |
| `Guideline Authoring Workflow` | Defines ordered guideline authoring steps. |
| `Required Output Structure` | Enforces consistent output sections. |
| `Component Rule Expectations` | Defines required interaction/state details. |
| `Quality Gates` | Adds testable quality and consistency checks. |

## Local development

Run tests locally:

```bash
node tests/run-tests.mjs
```

## License

This project is open-source under the MIT License.

## Sponsors

A huge thank you to the companies supporting our open-source work.

<table width="100%">
  <tr>
    <td align="center" width="33%">
      <a href="https://www.skybridge.tech/?ref=typeui.sh" target="_blank" rel="noopener noreferrer">
        <img src="https://github.com/user-attachments/assets/88c401ee-b19b-4b78-9a7e-325337dba529" alt="Skybridge" width="300" />
        <br /><b>Skybridge</b>
      </a>
    </td>
  </tr>
</table>

Want to see your logo here? [Become a sponsor](https://www.typeui.sh/sponsor).
