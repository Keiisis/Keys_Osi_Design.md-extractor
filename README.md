# Keys_Osi_Design.md-extractor (Chrome Extension)

Extract the complete, **measured** design system of any website — tokens, typography, colors, motion, page anatomy — and turn it into files that AI coding agents (Claude Code, Codex, Cursor, Google Stitch...) can use to rebuild the site: `DESIGN.md`, `SKILL.md`, `MOTION.md`, a machine-readable JSON, a full site clone ZIP, a ready-to-use code Starter Kit, and a local MCP server.

Everything runs locally in your browser: no account, no remote server, nothing leaves your machine.

## Getting started

Load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

## Available actions

| Action | Description |
| --- | --- |
| Auto-extract | Reads styles from the active tab (typography, colors, gradients, spacing, radius, shadows, motion, `@keyframes`, hover/focus states, responsive breakpoints, runtime animations via the Web Animations API, detected tech stack, and a measured WCAG contrast + target-size audit). Traverses open shadow roots, `adoptedStyleSheets`, and same-origin iframes. |
| Motion intelligence | GSAP timelines with animated values and targets, **ScrollTrigger instances** (trigger, start/end, scrub, pin, tween values), **measured parallax** (scroll-diff: elements whose transforms move at a different speed than the page, with their speed ratio), `background-attachment: fixed` surfaces, **WebGL/canvas inventory** (context type, dimensions, renderer library), and signatures of 20+ animation libraries (Lottie, AOS, Lenis, Swiper, Three.js, Locomotive...). All of it lands in DESIGN.md, SKILL.md, and the JSON export. |
| Page Anatomy | The ordered wireframe of the page: each top-level section with its inferred role (header, hero, features, pricing, testimonials, FAQ, CTA, footer...), layout (grid/flex, column count), real content (heading, CTA labels), surface, vertical rhythm, and height — plus an **image inventory with role guesses** (logo, hero, icons, photos) and a **forms map** (fields, labels, types, required, submit label). Everything an agent needs to rebuild the page, not just restyle it. |
| Generate `DESIGN.md` | Expert design-system blueprint: token tables with CSS-variable mapping, measured contrast of the core text/surface pair, estimated type-scale ratio, inferred spacing base grid, **measured h1–h6 hierarchy**, **button variants clustered into copy-paste CSS specs**, form-control and link specs, **layout system** (container width, flex/grid architecture, section rhythm, z-index scale), motion specs (keyframes + Web Animations API + GSAP), responsive breakpoint table, measured interaction states, a **Design Health Score (0–100)** with breakdown, and stack-aware implementation notes. |
| Generate `SKILL.md` | The same measured sections packaged as an agent-ready skill (frontmatter + managed markers). |
| Generate `MOTION.md` | Fourth output mode: a dedicated, exhaustive motion report — full `@keyframes` steps as copy-paste CSS, every hover/focus rule, WAAPI runtime animations with keyframes, GSAP timelines and ScrollTriggers, measured parallax speed ratios, WebGL scenes, animation libraries, and a step-by-step reproduction guide. |
| Generate `PROMPT.md` | Fifth output mode: a ready-to-paste **master prompt for coding agents** — role framing, the measured atmosphere in one sentence, non-negotiable tokens (with source CSS variables), the section-by-section build plan carrying the site's real headlines and CTA labels, verbatim component CSS, the motion script (ScrollTriggers with exact values, measured parallax ratios, libraries), responsive + accessibility directives, a working method, and a definition-of-done checklist anchored to the source's own Design Health Score. |
| PROMPT PRO (AI) | Sixth tab: describe **your own project** and the engine fuses it with the extracted design DNA — a master prompt that builds *your* site with the target's exact tokens, typography, spacing grid, and motion language, with each measured section remapped to your content. Two engines: an AI provider (Groq / OpenAI / any OpenAI-compatible endpoint — the API key is stored **only** in `chrome.storage.local`, never in the code) and a deterministic local template fallback that works without any key. |
| Generate JSON | Third output mode: a complete machine-readable `design-system.json` — every token with raw value + CSS variable, colors in **hex + RGB + HSL**, component specs (headings, button variants, form control, links), layout system, design score, fonts with file URLs, stylesheets/scripts inventory, animations, breakpoints, interactions, a11y audit, detected stack, and an embedded W3C tokens document. |
| Fonts + CSS + JS + Colors (ZIP) | One-click assets ZIP: every stylesheet (rewritten to local paths), scripts, font files referenced by the CSS, plus `colors.json` and `fonts.json`. |
| Starter Kit (ZIP) | The extracted design system as ready-to-use code: `tokens.css` (every token as CSS custom properties), `components.css` (measured buttons/input/card/link/headings), a zero-build `components.html` live preview, React components, `tailwind.config.js`, and W3C tokens. |
| Extract this component (right-click) | Context-menu action on any element: downloads a standalone `component_<name>.html` with computed styles inlined on every node and absolute asset URLs — pixel-faithful, framework-free. |
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
It also exposes the curated [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
library (60+ brand design systems) via `list_curated_brands` and
`get_curated_design` — perfect for comparing an extraction against Stripe,
Linear, Vercel, Apple... See [mcp-server/README.md](mcp-server/README.md).

## Format lineage & credits

The generated `DESIGN.md` fuses three formats:

- [TypeUI DESIGN.md](https://www.typeui.sh/design-md) — base section structure and SKILL.md conventions.
- [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — YAML frontmatter with machine-readable `colors:` and `typography:` token blocks.
- [adityarajdigital/designmd](https://github.com/adityarajdigital/designmd) — narrative sections: Visual Theme & Atmosphere, Do's and Don'ts, Responsive Behavior (touch targets, collapsing strategy), and the Agent Prompt Guide.

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

Run the unit tests (generators, normalization, ZIP, tokens, diff):

```bash
npm test
```

Run the end-to-end test — executes `content-script.js` inside a real local
Chrome/Edge (via `playwright-core`, no browser download) against a fixture
page covering shadow DOM, `adoptedStyleSheets`, same-origin iframes, WAAPI
animations, and the clone's asset rewriting:

```bash
npm install
npm run test:e2e   # or npm run test:all
```

## License

This project is open-source under the MIT License.
