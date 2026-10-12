# Keys_Osi_Design.md-extractor (Chrome Extension)

Extract the complete, **measured** design system of any website (tokens, typography, colors, motion, page anatomy), plus every **asset** (images, SVG icons, fonts, video, Lottie/Rive/Spline) and **3D model** (GLB/glTF/FBX/OBJ/USDZ… with GLB→STL/3MF conversion), and turn it into files that AI coding agents (Claude Code, Codex, Cursor, Google Stitch...) can use to rebuild the site: `DESIGN.md`, `SKILL.md`, `MOTION.md`, a machine-readable JSON, a full site clone ZIP, a ready-to-use code Starter Kit, and a local MCP server.

Everything runs locally in your browser: no account, no remote server, nothing leaves your machine.

## Getting started

> Updating an unpacked install: open the popup once — when the files on disk are newer than the running extension (new version or permissions), Keys_Osi reloads itself. Otherwise click ↻ on `chrome://extensions`.

Load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

## Available actions

| Action | Description |
| --- | --- |
| Site structure (Site view) | Crawls the whole site: robots.txt respected, sitemaps and sitemap indexes, navigation-first breadth-first discovery, JavaScript-only pages rendered in a minimized window. Every page is analysed (type, purpose, sections in order with verbatim copy, CTAs and their targets, forms with fields, JSON-LD), repeated routes are grouped into templates (`/blog/:slug` ×37, only a few samples fetched). Exports `SITE_STRUCTURE.md` (route tree, global navigation and footer, shared blocks, templates and their data fields, page index, CTA flows, forms catalog, SEO, Next.js route scaffold, definition of done), one `pages/*.md` per page, and a JSON twin. |
| Advanced reverse engineering (REA) | Through the Keys_Osi native host, the popup drives the REA engine locally: static analysis of the page’s JavaScript bundles (module graph, routes and endpoints found in code, source maps), passive inspection of the page (DOM, accessibility, resources, network, workers, redacted storage), page-declared WebMCP tools, an evidence screenshot, and analysis of local artifacts (bundles, source maps, WASM, archives, APK, executables). Every REA tool is also available in an expert mode. Evidence is saved under `Downloads/Keys_Osi-REA/`; `REA_REPORT.md` is added to `TECH_STACK.md`. |
| Tech decoding | Reads what the site publicly ships: framework runtimes and versions, build manifests (hidden routes, which then seed the structure crawl), API endpoints and GraphQL operations in the bundles, public source maps (original source tree, downloadable as a ZIP), hosting/CDN and security headers, CSS architecture. Exports `TECH_STACK.md`. |
| Figma | **No API needed**: paste frames copied in Figma (Ctrl+C → Ctrl+V in the popup) or open a `.fig` file (“Save local copy”); Keys_Osi decodes Figma’s own binary format locally, including auto-layout, text styles, components and instances, and image fills from `.fig` files. A live figma.com tab can also be read when the page exposes its plugin API. Optionally, the REST API (personal token) imports a whole file: every screen, auto-layout, component sets and variants, text/color/effect/grid styles, variables (Enterprise), prototype transitions. The file becomes the source of DESIGN.md, SKILL.md and PROMPT_PRO; the Figma kit ZIP adds `FIGMA_STRUCTURE.md`, one file per screen, PNG renders, SVG icons and image fills. The other way: any page becomes editable Figma layers (auto-layout, text runs, images, SVG, effects, components) and tokens become Figma Variables, through the bundled Keys_Osi Import plugin. |
| Brand Kit (PROMPT PRO) | Drop a logo: exact logo colors, shape personality, a full palette (11-step scales, semantic colors, roles checked for WCAG AA), three font pairings resolved on the Fontsource catalogue with downloadable woff2 files, a vectorized SVG logo, and a ZIP (BRAND.md charter, tokens CSS/JSON, Tailwind, visual charter page, fonts). **Try it on this site** recolors and re-types the live page with the brand, reversibly. The kit overrides the reference colors and fonts in PROMPT_PRO. |
| Learning memory | Every AI failure, missing section, extraction self-check failure and user rating is recorded once and counted. Lessons are injected into later AI prompts, failing models are skipped by automatic model choice, and anomalies are exported as regression cases. Lessons can be disabled one by one; memory exports and imports as JSON. |
| Moodboard | Pin colors and type (Lens: P), section captures (Lens: S) and images or text (right-click). Export as a visual board ZIP; sent to PROMPT_PRO as art direction. |
| Accessibility fixer | Checks every text/background pair the design uses, proposes the smallest lightness-only fix that passes WCAG AA (hue and chroma kept), previews it on the live page, exports CSS overrides and `A11Y_FIXES.md`. |
| Native & platform exports | SwiftUI, Jetpack Compose (Material 3), Flutter ThemeData, Tailwind v4 `@theme`, Storybook docs, WordPress `theme.json`, motion variants and agent rules from the same tokens. DESIGN.md also documents voice and tone, imagery, icon system, logo, dark mode, form states, modern CSS and the z-index scale. |
| Accurate colors | Translucent colors are composited over the real page canvas (an `rgba(0,0,0,0.08)` border is the light grey you see, never `#000000`); oklch/oklab/lab/lch/display-p3 are parsed; roles come from contrast and chroma (`surface.base/muted/raised/inverse/brand`, `text.primary/secondary/muted/inverse`, `brand.primary/secondary`, `border.*`), and CSS variables are mapped by role. Verified on Stripe, Linear, Notion, Figma, Apple, Mailchimp and a Webflow restaurant site (`tests/e2e/audit-sites.mjs`). |
| Assets & Styles inspector | Second view: every image (img, srcset, `<picture>`, CSS backgrounds and masks, pseudo-elements, favicons, social images, posters), inline SVG icons and sprite symbols (with `currentColor` resolved), fonts (`@font-face` files, loaded/used state, icon fonts), videos/audio/embeds and Lottie/Rive/Spline files — with real dimensions and transfer sizes. Preview, copy URL, copy SVG code or **JSX**, copy `@font-face`, single download or **ZIP of the selection**. A Styles tab shows colors (HEX/RGB/HSL copy), gradients, shadows and the measured type scale, with one-click CSS / SCSS / Tailwind / W3C exports. |
| 3D models | Third view: passive network capture of 3D files (GLB, glTF, 3MF, FBX, OBJ, USDZ, STL, PLY, DAE, 3DS, Blend, X3D, VRML, Draco, Spline scenes), page scan (DOM + Resource Timing) for models loaded earlier, **magic-byte identification** of opaque files, parent-`.gltf` lookup for buffers, a filterable **network inspector** to flag anything as a model, and in-browser **GLB/glTF → STL / 3MF** conversion (Draco + meshopt + quantization decoders in WebAssembly, external buffers, textured 3MF, Y-up→Z-up and m→mm for slicers). |
| 3D preview & live scene export | **Aperçu 3D** renders any captured model in the popup (WebGL, orbit, zoom, triangle count). **Exporter la scène (GLB)** grabs a live three.js scene straight from the page (world transforms baked, InstancedMesh expanded, materials and textures embedded) — works even when the model is generated in code and never downloaded as a file. |
| Lens (on-page inspector) | **Lens** button: hover any element to read its selector, font (family, size, weight, line-height), colors and measured WCAG contrast; click copies the CSS spec; `E` opens the native eyedropper; `Esc` closes. |
| Before/after fidelity | **Comparer deux pages**: pick the reference and your reproduction among open tabs; both are captured section by section at identical scroll offsets, scored (SSIM + differing pixels) and an HTML report with heatmaps is downloaded. |
| Auto-extract | Reads styles from the active tab (typography, colors, gradients, spacing, radius, shadows, motion, `@keyframes`, hover/focus states, responsive breakpoints, runtime animations via the Web Animations API, detected tech stack, and a measured WCAG contrast + target-size audit). Traverses open shadow roots, `adoptedStyleSheets`, and same-origin iframes. |
| Motion intelligence | GSAP timelines with animated values and targets, **ScrollTrigger instances** (trigger, start/end, scrub, pin, tween values), **measured parallax** (scroll-diff: elements whose transforms move at a different speed than the page, with their speed ratio), `background-attachment: fixed` surfaces, **WebGL/canvas inventory** (context type, dimensions, renderer library), and signatures of 20+ animation libraries (Lottie, AOS, Lenis, Swiper, Three.js, Locomotive...). All of it lands in DESIGN.md, SKILL.md, and the JSON export. |
| Page Anatomy | The ordered wireframe of the page: each top-level section with its inferred role (header, hero, features, pricing, testimonials, FAQ, CTA, footer...), layout (grid/flex, column count), real content (heading, CTA labels), surface, vertical rhythm, and height — plus an **image inventory with role guesses** (logo, hero, icons, photos) and a **forms map** (fields, labels, types, required, submit label). Everything an agent needs to rebuild the page, not just restyle it. |
| Generate `DESIGN.md` | Expert design-system blueprint: token tables with CSS-variable mapping, measured contrast of the core text/surface pair, estimated type-scale ratio, inferred spacing base grid, **measured h1–h6 hierarchy**, **button variants clustered into copy-paste CSS specs**, form-control and link specs, **layout system** (container width, flex/grid architecture, section rhythm, z-index scale), motion specs (keyframes + Web Animations API + GSAP), responsive breakpoint table, measured interaction states, a **Design Health Score (0–100)** with breakdown, and stack-aware implementation notes. |
| Generate `SKILL.md` | The same measured sections packaged as an agent-ready skill (frontmatter + managed markers). |
| Generate `MOTION.md` | Fourth output mode: a dedicated, exhaustive motion report — full `@keyframes` steps as copy-paste CSS, every hover/focus rule, WAAPI runtime animations with keyframes, GSAP timelines and ScrollTriggers, measured parallax speed ratios, WebGL scenes, animation libraries, and a step-by-step reproduction guide. |
| Generate `PROMPT.md` | Fifth output mode: a ready-to-paste **master prompt for coding agents** — role framing, the measured atmosphere in one sentence, non-negotiable tokens (with source CSS variables), the section-by-section build plan carrying the site's real headlines and CTA labels, verbatim component CSS, the motion script (ScrollTriggers with exact values, measured parallax ratios, libraries), responsive + accessibility directives, a working method, and a definition-of-done checklist anchored to the source's own Design Health Score. |
| PROMPT PRO (AI) | Generation is **streamed** (no proxy timeout such as Cloudflare 524), runs in the offscreen document (no 5-minute worker limit), continues automatically when the output is cut by the token budget (reasoning models), shows live progress (thinking / writing) and keeps the result if the popup closes. Sixth tab: describe **your own project** (or import complete `.md`/`.txt` briefs) and the engine fuses it with the extracted design DNA and the **Keys_Osi playbook** — 10 project archetypes, section maps, 19 motion recipes with production numbers, a 13-block document anatomy and a quality bar distilled from a study of 109 production landing-page prompts. Output: a build-ready master prompt (fonts, CSS variables, utilities, numbered sections with Tailwind classes and real copy, motion timeline, data arrays, responsive, a11y, reduced motion, dependencies, definition of done). **Vision-grounded** option. A local engine produces the same anatomy without any key. |
| PROMPT PRO speed priority | **Priorité : vitesse** picks the fastest model measured on your own past runs (failures excluded); **qualité** keeps the strongest model. Every run updates the local model stats shown by **Modèles**. |
| AI providers | Groq, OpenAI, **Claude (Anthropic, native Messages API)**, Kimi (Moonshot), **New API / One API gateways** (e.g. MiaRouter — paste the `{"_type":"newapi_channel_conn",…}` connection JSON) or any OpenAI-compatible endpoint. The base URL is normalized (`https://host` → `https://host/v1`), the **Models** button lists the endpoint's models, an empty or rejected model is replaced by the best available chat model, and refused parameters (`max_tokens`, `temperature`) are adapted automatically. API keys are stored **only** in `chrome.storage.local`, never in the code. |
| Component code generation (AI) | Turns the measured tokens (and optional screenshots) into real, paste-ready **React / Vue / standalone HTML** component code — not just a prompt. The Locofy-killer: it starts from the live site with exact measured values. |
| Fidelity score | Capture a **baseline** screenshot of the target, then compare your reproduction: a measured **SSIM structural-similarity percentage** plus, with an AI key, a vision-grounded gap analysis listing the top differences to fix. No other tool measures this. |
| Token intelligence | Classifies the palette into brand / neutral / semantic roles, detects tonal ramps (and flags partial ones), and can **rename tokens semantically** with AI. Included in the JSON export. |
| Font license check | Flags likely **commercial fonts** (Helvetica Now, GT/Söhne/Graphik families…) and suggests free alternatives — protecting you legally before you ship. Lottie animation files are downloaded into the clone. |
| Generate JSON | Third output mode: a complete machine-readable `design-system.json` — every token with raw value + CSS variable, colors in **hex + RGB + HSL**, component specs (headings, button variants, form control, links), layout system, design score, fonts with file URLs, stylesheets/scripts inventory, animations, breakpoints, interactions, a11y audit, detected stack, and an embedded W3C tokens document. |
| Fonts + CSS + JS + Colors (ZIP) | One-click assets ZIP: every stylesheet (rewritten to local paths), scripts, font files referenced by the CSS, plus `colors.json` and `fonts.json`. |
| Starter Kit (ZIP) | The extracted design system as ready-to-use code: `tokens.css` (every token as CSS custom properties), `components.css` (measured buttons/input/card/link/headings), a zero-build `components.html` live preview, React components, `tailwind.config.js`, and W3C tokens. |
| Extract this component (right-click) | Context-menu action on any element: downloads a standalone `component_<name>.html` with computed styles inlined on every node and absolute asset URLs — pixel-faithful, framework-free. |
| Clone site (ZIP) | Packages the page into a single ZIP: HTML, rewritten CSS (fonts/background images/`@import` chains resolved to local paths), images, fonts, media, inline SVG icons, PWA manifest/favicons, and optional section-by-section screenshots. Can crawl up to 10 internal pages with working local navigation. Optional static snapshot strips scripts so SPA clones render offline. |
| Export tokens | `tailwind.config.js`, W3C Design Tokens JSON (Style Dictionary / Figma Tokens compatible), `tokens.css` (CSS custom properties) and `_tokens.scss` (variables + map). |
| Advanced audit (opt-in) | Real device emulation at 375/768/1440px with per-viewport tokens + screenshots, and a `prefers-color-scheme: dark` capture with its own palette (only kept when the site actually implements a dark theme). Uses the `debugger` permission, requested on demand — never at install. |
| Disclosure capture (opt-in) | Safely opens menus/accordions/dropdowns before capture (never links, never forms, never transactional buttons — FR/EN blocklist), screenshots the open state, then restores the page. |
| `DIFF.md` | Compares the current extraction with the previous one of the same site from local history. |
| `→ MCP` | Pushes the extraction to the local [design-extractor-mcp](mcp-server/README.md) bridge so Claude Code / Cursor can query it directly. |
| Refresh | Re-runs extraction for the current page state. |
| Download | Saves generated output as `DESIGN.md` or `SKILL.md`. |
| Explain (`?`) | Shows how the file was generated (pipeline, counts, Design Health Score, checks). |

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
It also exposes a library of 60+ brand design systems via `list_curated_brands` and
`get_curated_design` — perfect for comparing an extraction against Stripe,
Linear, Vercel, Apple... See [mcp-server/README.md](mcp-server/README.md).

## Keys_Osi DESIGN.md format

YAML frontmatter with machine-readable `colors:` and `typography:` token blocks, measured narrative sections (visual theme & atmosphere, do's and don'ts, responsive behavior) and an agent prompt guide.

Third-party components and their licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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

## Native host (advanced reverse engineering)

REA runs as a local process, which a browser extension cannot start by itself. Register the Keys_Osi native host once (Node.js 20+, Chrome, Edge or Brave installed):

```bash
node native-host/install.mjs            # unpacked copy: the extension ID is derived from this folder
node native-host/install.mjs <store-id> # also authorise a store-installed copy
node native-host/install.mjs --uninstall
```

The host registers itself for the current user only (no admin rights). On first use it downloads REA with `npx`, then starts a private headless Chrome with a loopback debugging port for each analysis. Logs: `~/.keys-osi/native-host.log`.

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
npm run test:e2e   # content script in a real Chrome
npm run test:ext   # the whole unpacked extension (service worker, webRequest,
                   # offscreen WASM conversion, popup) in Playwright Chromium
npm run test:update # self-reload of an unpacked install after a manifest change
npm run test:browser # vectorizer, page → Figma capture, page signals (Chromium)
npm run test:site    # whole-site crawl + tech decoding in the real extension
npm run test:features # Figma (API and no-API), Brand Kit, try-on, moodboard, memory, accessibility
npm run test:rea      # native host + REA + headless Chrome (run native-host/install.mjs first)
npm run test:all

node tests/e2e/audit-sites.mjs --md https://stripe.com https://linear.app   # real-site accuracy audit
node tests/e2e/screenshots.mjs ./shots                                    # popup screenshots (light + dark)
node tests/e2e/validate-sites.mjs                                         # DESIGN.md invariants on 20 real sites (--update rewrites the baseline)
```

## License

This project is open-source under the MIT License.
