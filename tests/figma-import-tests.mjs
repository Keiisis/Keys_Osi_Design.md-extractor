// Figma import: URL parsing, REST client (mocked fetch), payload -> normalize
// -> DESIGN.md, FIGMA_STRUCTURE.md and export planning, on a fixture that
// follows the documented REST schema.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildFigmaStructure,
  fetchFigmaFile,
  fetchFigmaImages,
  figmaToPayload,
  generateFigmaStructureMarkdown,
  generateFrameMarkdown,
  parseFigmaUrl,
  planFigmaExports
} from "../lib/figma-import.mjs";
import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { generateDesignMarkdown } from "../lib/generate-design-md.mjs";
import { validateMarkdownOutput } from "../lib/validate.mjs";

const fixtureUrl = (name) => new URL(`./fixtures/figma/${name}`, import.meta.url);
const sampleFile = JSON.parse(await readFile(fixtureUrl("sample-file.json"), "utf8"));
const variablesResponse = JSON.parse(await readFile(fixtureUrl("variables-local.json"), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// ---------- parseFigmaUrl ----------
assert.deepEqual(parseFigmaUrl("https://www.figma.com/design/AbC123xyz/Lumen-Site?node-id=1-23&t=abc"), {
  fileKey: "AbC123xyz",
  nodeId: "1:23",
  kind: "design"
});
assert.deepEqual(parseFigmaUrl("https://www.figma.com/file/KEY987/Old-File"), { fileKey: "KEY987", nodeId: null, kind: "file" });
assert.deepEqual(parseFigmaUrl("https://figma.com/proto/PROTO1/Flow?node-id=12-345&scaling=min-zoom"), {
  fileKey: "PROTO1",
  nodeId: "12:345",
  kind: "proto"
});
assert.deepEqual(parseFigmaUrl("www.figma.com/board/BOARD9/Workshop"), { fileKey: "BOARD9", nodeId: null, kind: "board" });
assert.deepEqual(parseFigmaUrl("https://www.figma.com/design/MAIN1/branch/BRANCH2/Site?node-id=4%3A5"), {
  fileKey: "BRANCH2",
  nodeId: "4:5",
  kind: "design"
});
assert.equal(parseFigmaUrl("https://example.com/design/AbC123/x"), null);
assert.equal(parseFigmaUrl("https://www.figma.com/community/file/123"), null);
assert.equal(parseFigmaUrl("https://evilfigma.com/design/AbC/x"), null);
assert.equal(parseFigmaUrl("not a url at all"), null);
assert.equal(parseFigmaUrl(""), null);

// ---------- fetchFigmaFile: 429 retried, variables 403 -> null ----------
{
  const calls = [];
  const sleeps = [];
  let fileHits = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, token: init.headers["X-Figma-Token"] });
    if (url.endsWith("/v1/files/AbC123")) {
      fileHits += 1;
      if (fileHits === 1) return json({ status: 429, err: "Rate limit exceeded" }, 429, { "Retry-After": "2" });
      return json(sampleFile);
    }
    if (url.endsWith("/v1/files/AbC123/images")) {
      return json({ error: false, status: 200, meta: { images: { a1b2c3hero0001: "https://cdn.example/hero.png" } } });
    }
    if (url.endsWith("/v1/files/AbC123/variables/local")) {
      return json({ status: 403, error: true, message: "Limited by Figma plan" }, 403);
    }
    throw new Error(`unexpected ${url}`);
  };
  const progress = [];
  const result = await fetchFigmaFile({
    fileKey: "AbC123",
    token: "figd_test",
    fetchImpl,
    sleepImpl: async (ms) => sleeps.push(ms),
    onProgress: (event) => progress.push(event.step)
  });
  assert.equal(fileHits, 2, "429 must be retried once");
  assert.deepEqual(sleeps, [2000], "Retry-After seconds must be honored");
  assert.ok(calls.every((call) => call.token === "figd_test" && call.url.startsWith("https://api.figma.com/v1/")));
  assert.equal(result.file.name, sampleFile.name);
  assert.equal(result.variables, null, "non-Enterprise 403 on variables must not be fatal");
  assert.equal(result.imageFills.a1b2c3hero0001, "https://cdn.example/hero.png");
  assert.ok(progress.includes("file") && progress.includes("done"));
}

// Variables available (Enterprise): meta is returned as-is.
{
  const fetchImpl = async (url) => {
    if (url.endsWith("/variables/local")) return json(variablesResponse);
    if (url.endsWith("/images")) return json({ error: false, status: 200, meta: { images: {} } });
    return json(sampleFile);
  };
  const result = await fetchFigmaFile({ fileKey: "AbC123", token: "t", fetchImpl });
  assert.ok(result.variables.variables["VariableID:1:1"]);
  assert.ok(result.variables.variableCollections["VariableCollectionId:1:0"]);
}

// 403 / 404 / exhausted 429 budget -> clear French errors.
await assert.rejects(
  fetchFigmaFile({ fileKey: "X1", token: "bad", fetchImpl: async () => json({ status: 403, err: "Invalid token" }, 403) }),
  (error) => error.status === 403 && /Accès refusé par Figma \(403\)/.test(error.message) && /jeton/.test(error.message) && /Invalid token/.test(error.message)
);
await assert.rejects(
  fetchFigmaFile({ fileKey: "X1", token: "t", fetchImpl: async () => json({ status: 404, err: "Not found" }, 404) }),
  (error) => error.status === 404 && /introuvable \(404\)/.test(error.message)
);
{
  const sleeps = [];
  await assert.rejects(
    fetchFigmaFile({
      fileKey: "X1",
      token: "t",
      maxWaitMs: 5000,
      sleepImpl: async (ms) => sleeps.push(ms),
      fetchImpl: async () => json({ status: 429 }, 429, { "Retry-After": "3", "X-Figma-Rate-Limit-Type": "low" })
    }),
    (error) => error.status === 429 && /Limite de requêtes Figma atteinte \(429\)/.test(error.message) && /Lecteur\/Collaborateur/.test(error.message)
  );
  assert.ok(sleeps.reduce((sum, ms) => sum + ms, 0) <= 5000, "total wait must stay within the cap");
}
await assert.rejects(fetchFigmaFile({ fileKey: "X1", token: "" }), /Jeton d'accès personnel Figma manquant/);

// nodeId scope: nodes endpoint, still a usable document.
{
  const desktop = sampleFile.document.children[0].children[0];
  let requested = "";
  const fetchImpl = async (url) => {
    if (url.includes("/nodes?")) {
      requested = url;
      return json({
        name: sampleFile.name,
        lastModified: sampleFile.lastModified,
        nodes: { "1:2": { document: desktop, components: sampleFile.components, componentSets: sampleFile.componentSets, styles: sampleFile.styles } }
      });
    }
    if (url.endsWith("/images")) return json({ error: false, status: 200, meta: { images: {} } });
    return json({ status: 403 }, 403);
  };
  const { file } = await fetchFigmaFile({ fileKey: "AbC123", token: "t", nodeId: "1:2", fetchImpl });
  assert.match(requested, /\/v1\/files\/AbC123\/nodes\?ids=1%3A2$/);
  assert.equal(file.scopedNodeId, "1:2");
  const scoped = buildFigmaStructure(file);
  assert.equal(scoped.stats.screens, 1);
  assert.equal(scoped.pages[0].screens[0].name, "Desktop / Home");
  const scopedPayload = normalizeExtractedStyles(figmaToPayload(file, { fileKey: "AbC123" }));
  assert.ok(scopedPayload.colorPalette.length >= 4);
  await assert.rejects(
    fetchFigmaFile({ fileKey: "AbC123", token: "t", nodeId: "9:9", fetchImpl: async () => json({ name: "x", nodes: { "9:9": null } }) }),
    (error) => error.status === 404 && /Nœud 9:9 introuvable/.test(error.message)
  );
}

// ---------- payload -> normalize -> DESIGN.md ----------
const variables = variablesResponse.meta;
const payload = figmaToPayload(clone(sampleFile), {
  variables,
  fileKey: "AbC123",
  url: "https://www.figma.com/design/AbC123/Lumen",
  imageFills: { a1b2c3hero0001: "https://cdn.example/hero.png" }
});
assert.equal(payload.pageBackground, "#ffffff");
assert.equal(payload.platformInfo.platform, "figma");
assert.ok(payload.typography.every((row) => row.fontFamily === "Inter"));
assert.ok(!payload.siteSignals.textSample.includes("Hidden draft"), "hidden layers must be skipped");
assert.deepEqual(
  payload.headings.map((heading) => [heading.level, heading.fontSize, heading.lineHeight, heading.fontWeight, heading.letterSpacing]),
  [
    ["h1", "64px", "72px", "800", "-1.5px"],
    ["h2", "40px", "48px", "700", "normal"]
  ]
);
assert.ok(payload.backgroundImages.includes("linear-gradient(180deg, #eef2ff 0%, #ffffff 100%)"));
assert.ok(payload.shadows.includes("0px 4px 12px 0px rgba(15, 23, 42, 0.08)"));
assert.ok(payload.shadows.includes("0px 24px 48px -12px rgba(15, 23, 42, 0.18)"));
assert.ok(payload.radius.includes("8px") && payload.radius.includes("16px") && payload.radius.includes("24px"));
assert.ok(!payload.radius.includes("5px"), "component-set chrome must not leak into tokens");
assert.ok(payload.spacing.some((row) => row.paddingTop === "96px" && row.paddingLeft === "80px"));
assert.ok(payload.spacing.some((row) => row.marginTop === "24px"), "auto-layout gap must be reported");
assert.deepEqual(payload.breakpoints, [{ px: 1440, count: 1 }]);
assert.equal(payload.layout.containerMaxWidth, "1280px");
assert.deepEqual(
  payload.motion.map((row) => [row.transitionDuration, row.transitionTimingFunction]).sort(),
  [
    ["150ms", "cubic-bezier(0.4, 0, 0.2, 1)"],
    ["200ms", "ease-out"],
    ["300ms", "ease-in-out"]
  ]
);
assert.ok(payload.runtimeAnimations.some((item) => item.name === "ON_HOVER → Type=Primary, State=Hover" && item.duration === 200));
assert.deepEqual(payload.interactionStyles, [
  { selector: ".button-primary:hover", declarations: ["background-color: #4338ca", "box-shadow: 0px 4px 12px 0px rgba(79, 70, 229, 0.35)"] },
  { selector: ".button-secondary:hover", declarations: ["background-color: #f1f5f9"] }
]);
assert.equal(payload.buttonVariants[0].spec.background, "#4f46e5");
assert.equal(payload.buttonVariants[0].spec.padding, "12px 24px 12px 24px");
assert.equal(payload.buttonVariants[1].spec.border, "1px solid #cbd5e1");
assert.deepEqual(
  payload.structure.map((section) => section.role),
  ["header/navigation", "hero", "features/gallery", "contact/form", "footer"]
);
assert.equal(payload.structure[1].heading, "Ship design systems faster");
assert.deepEqual(payload.structure[1].ctas, ["Start free trial", "Book a demo"]);
assert.equal(payload.formControl.border, "1px solid #cbd5e1");
assert.equal(payload.forms[0].fields[0].type, "email");
assert.equal(payload.linkSpec.textDecoration, "underline");
assert.equal(payload.imageInventory[0].src, "https://cdn.example/hero.png");
assert.equal(payload.imageInventory[0].role, "hero");
const cssVar = (name) => payload.cssVariables.find((variable) => variable.name === name)?.value;
assert.equal(cssVar("--color-primary-500"), "#4f46e5");
assert.equal(cssVar("--color-action"), "#4f46e5", "alias must resolve and codeSyntax.WEB must name it");
assert.equal(cssVar("--spacing-md"), "16px");
assert.equal(cssVar("--radius-md"), "8px");
assert.equal(cssVar("--color-brand-primary"), "#4f46e5", "fill styles must become variables");
assert.equal(cssVar("--shadow-elevation-card"), "0px 4px 12px 0px rgba(15, 23, 42, 0.08)");
assert.equal(payload.a11y.contrastFailures, 0);
assert.ok(payload.a11y.contrastChecked >= 20);

const normalized = normalizeExtractedStyles(payload);
const tokenValue = (token) => normalized.colorPalette.find((row) => row.token === token)?.value || "";
assert.match(tokenValue("color.brand.primary"), /^#4f46e5/);
assert.match(tokenValue("color.surface.base"), /^#ffffff/);
assert.match(tokenValue("color.text.primary"), /^#0f172a/);
assert.equal(normalized.mainFontStyle.primaryFamily, "Inter");
assert.ok(normalized.typographyScale.length >= 6);
assert.ok(normalized.motionEasingTokens.some((row) => row.value.startsWith("cubic-bezier(0.4, 0, 0.2, 1)")));

const designMd = generateDesignMarkdown({ normalized });
assert.ok(designMd.includes("#4f46e5"), "DESIGN.md must carry the brand hex");
assert.ok(designMd.includes("Inter"), "DESIGN.md must carry the font family");
assert.ok(designMd.includes("FIGMA"), "DESIGN.md must state the design platform");
const validation = validateMarkdownOutput("design", designMd);
assert.equal(validation.isValid, true, `DESIGN.md invalid: ${validation.errors.join("; ")}`);

// Without variables (non-Enterprise) the pipeline still holds.
const plainNormalized = normalizeExtractedStyles(figmaToPayload(clone(sampleFile), { variables: null, fileKey: "AbC123" }));
assert.equal(validateMarkdownOutput("design", generateDesignMarkdown({ normalized: plainNormalized })).isValid, true);

// ---------- FIGMA_STRUCTURE.md ----------
const structure = buildFigmaStructure(clone(sampleFile), { variables });
assert.deepEqual(structure.pages.map((page) => page.name), ["Landing", "Components"]);
assert.deepEqual(structure.pages[0].flows, [{ name: "Main flow", start: "Desktop / Home" }]);
const screens = structure.pages.flatMap((page) => page.screens);
assert.deepEqual(screens.map((screen) => screen.name), ["Desktop / Home", "Mobile / Home"]);
assert.deepEqual(screens[0].sections.map((section) => section.name), ["Header", "Hero", "Features", "Newsletter", "Footer"]);
assert.equal(structure.componentSets[0].name, "Button");
assert.deepEqual(structure.componentSets[0].properties.map((prop) => prop.name), ["Type", "State", "Label"]);
assert.deepEqual(structure.componentSets[0].variants.map((variant) => variant.name), [
  "Type=Primary, State=Default",
  "Type=Primary, State=Hover",
  "Type=Secondary, State=Default",
  "Type=Secondary, State=Hover"
]);
assert.equal(structure.componentSets[0].variants[0].usage, 3, "1:9, 1:15, 1:66");
assert.equal(structure.componentSets[0].usage, 5);
assert.equal(structure.stats.variables, 4);
assert.equal(structure.imageFills[0].imageRef, "a1b2c3hero0001");
assert.equal(structure.styles.find((style) => style.name === "Grid/Desktop 12 col").value, "12 columns (stretch, gutter 24px, offset 80px)");
assert.equal(structure.styles.find((style) => style.name === "Heading/H1").value, "Inter 64px/72px 800, letter-spacing -1.5px");

const structureMd = generateFigmaStructureMarkdown(structure, { fileName: "Lumen", url: "https://www.figma.com/design/AbC123/Lumen" });
const positions = (needles) => needles.map((needle) => structureMd.indexOf(needle));
const inOrder = (needles, label) => {
  const found = positions(needles);
  assert.ok(found.every((index) => index >= 0), `${label}: missing ${needles[found.findIndex((index) => index < 0)]}`);
  assert.deepEqual([...found].sort((a, b) => a - b), found, `${label}: wrong order`);
};
inOrder(["### Screen: Desktop / Home", "### Screen: Mobile / Home"], "screens");
inOrder(["#### 1. Header", "#### 2. Hero", "#### 3. Features", "#### 4. Newsletter", "#### 5. Footer"], "desktop sections");
inOrder(
  [
    '"Lumen"',
    '"Get started"',
    '"Ship design systems faster"',
    '"Lumen turns your Figma files into production-ready tokens and components."',
    '"Start free trial"',
    '"Book a demo"',
    '"Everything you need"',
    '"Token sync"',
    '"Join 12,000 designers"',
    '"© 2026 Lumen. All rights reserved."'
  ],
  "copy"
);
assert.ok(!structureMd.includes("Hidden draft"));
assert.ok(structureMd.includes("flex column; gap 24px; padding 96px 80px 96px 80px; justify-content flex-start; align-items center"));
assert.ok(structureMd.includes("gap auto (space-between)"));
assert.ok(structureMd.includes("width fill, height hug; constraints left_right/top"), "sizing and constraints must be documented");
assert.ok(structureMd.includes("Layout grid: 12 columns (stretch, gutter 24px, offset 80px)"));
assert.ok(structureMd.includes("`Card` 410x240 — flex column; gap 12px"), "nested frames must carry their auto-layout");
assert.ok(structureMd.includes("ON_HOVER → change to `Type=Primary, State=Hover` (smart animate, 200ms, ease-out)"));
assert.ok(structureMd.includes("ON_CLICK → navigate `Mobile / Home` (smart animate, 300ms, ease-in-out)"));
assert.ok(structureMd.includes("### Button (component set, 5 instance(s))"));
assert.ok(structureMd.includes("`Type` (variant: Primary | Secondary; default \"Primary\")"));
assert.ok(structureMd.includes("| Brand/Primary | FILL | #4f46e5 |"));
assert.ok(structureMd.includes("| color/action/primary | `--color-action` | COLOR | → color/primary/500 | → color/primary/500 |"));
assert.ok(structureMd.includes("| color/primary/500 | `--color-primary-500` | COLOR | #4f46e5 | #818cf8 |"));
assert.ok(structureMd.includes("`a1b2c3hero0001` on `Hero image`"));
assert.ok(structureMd.includes('Prototype flows on `Landing`: "Main flow" starts at `Desktop / Home`'));

const frameMd = generateFrameMarkdown(screens[1]);
assert.ok(frameMd.startsWith("# Screen: Mobile / Home"));
assert.ok(frameMd.includes("## 1. Header") && frameMd.includes("## 2. Hero"));
assert.ok(frameMd.includes('"Start free trial"'));
assert.ok(frameMd.includes('[heading h1] "Ship design systems faster" — Inter 36px/44px 800'), "each screen gets its own h1");
assert.ok(
  structureMd.includes("background #ffffff; border 1px solid #e2e8f0; radius 16px; box-shadow 0px 4px 12px 0px rgba(15, 23, 42, 0.08)"),
  "nested frames must carry their surface"
);

// ---------- export planning + image rendering ----------
const plan = planFigmaExports(clone(sampleFile));
assert.deepEqual(plan.frames, [
  { id: "1:2", name: "Desktop / Home" },
  { id: "1:60", name: "Mobile / Home" }
]);
assert.deepEqual(plan.icons.map((item) => item.name).sort(), ["Icon/Bolt", "Icon/Menu"], "one export per icon component");
assert.deepEqual(plan.imageRefs, [{ imageRef: "a1b2c3hero0001", name: "Hero image", nodeId: "1:19" }]);
assert.equal(planFigmaExports(clone(sampleFile), { maxFrames: 1 }).frames.length, 1);

{
  const requested = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const ids = parsed.searchParams.get("ids").split(",");
    requested.push({ ids, format: parsed.searchParams.get("format"), scale: parsed.searchParams.get("scale") });
    if (ids.length > 2) return json({ status: 500, err: "Render timeout" }, 500);
    return json({ err: null, images: Object.fromEntries(ids.map((id) => [id, id === "5:2" ? null : `https://render.example/${id}.svg`])) });
  };
  const urls = await fetchFigmaImages({ fileKey: "AbC123", token: "t", ids: ["1:2", "1:60", "5:1", "5:2", "5:1"], format: "svg", scale: 9, batchSize: 3, fetchImpl });
  assert.deepEqual(urls, {
    "1:2": "https://render.example/1:2.svg",
    "1:60": "https://render.example/1:60.svg",
    "5:1": "https://render.example/5:1.svg"
  });
  assert.ok(requested.every((request) => request.format === "svg" && request.scale === "4"), "scale must be clamped to 4");
  assert.ok(requested.some((request) => request.ids.length === 3), "a 5xx batch must be split and retried");
}

console.log("Figma import tests passed.");
