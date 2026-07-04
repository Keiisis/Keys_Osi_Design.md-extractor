import assert from "node:assert/strict";
import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import { formatAuditSections, generateDesignMarkdown } from "../lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "../lib/generate-skill-md.mjs";
import { validateMarkdownOutput } from "../lib/validate.mjs";
import {
  assignAssetPath,
  folderForAssetUrl,
  processCssAssets,
  relativePathBetween,
  rewriteCssText
} from "../lib/css-assets.mjs";
import { createZip, crc32 } from "../lib/zip.mjs";
import { generateTailwindConfig, generateW3cTokens } from "../lib/export-tokens.mjs";
import { diffNormalized, generateDiffMarkdown } from "../lib/diff-tokens.mjs";
import { generateDesignJson } from "../lib/generate-json-export.mjs";

const mockPayload = {
  source: {
    url: "https://example.com/dashboard",
    title: "Example Dashboard"
  },
  sampledAt: "2026-04-14T12:00:00.000Z",
  totalElements: 460,
  sampledElements: 120,
  typography: [
    { fontFamily: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif", fontSize: "14px", lineHeight: "20px", fontWeight: "400" },
    { fontFamily: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif", fontSize: "16px", lineHeight: "24px", fontWeight: "400" },
    { fontFamily: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif", fontSize: "16px", lineHeight: "24px", fontWeight: "400" },
    { fontFamily: "\"Inter\", \"Helvetica Neue\", Arial, sans-serif", fontSize: "20px", lineHeight: "28px", fontWeight: "600" }
  ],
  colors: [
    { textColor: "rgb(17, 24, 39)", backgroundColor: "rgb(255, 255, 255)", borderColor: "rgb(229, 231, 235)", outlineColor: "rgb(59, 130, 246)" },
    { textColor: "rgb(75, 85, 99)", backgroundColor: "rgb(249, 250, 251)", borderColor: "rgb(209, 213, 219)", outlineColor: "rgb(59, 130, 246)" },
    { textColor: "rgb(17, 24, 39)", backgroundColor: "rgb(255, 255, 255)", borderColor: "rgb(229, 231, 235)", outlineColor: "rgb(59, 130, 246)" },
    { textColor: "rgb(17, 24, 39)", backgroundColor: "rgb(254, 254, 254)", borderColor: "rgb(229, 231, 235)", outlineColor: "rgb(59, 130, 246)" }
  ],
  spacing: [
    {
      marginTop: "8px",
      marginRight: "16px",
      marginBottom: "8px",
      marginLeft: "16px",
      paddingTop: "12px",
      paddingRight: "16px",
      paddingBottom: "12px",
      paddingLeft: "16px"
    }
  ],
  radius: ["6px", "8px", "8px"],
  shadows: ["none", "0 1px 2px rgba(0, 0, 0, 0.08)"],
  motion: [
    {
      transitionDuration: "150ms",
      transitionTimingFunction: "ease-in-out",
      animationDuration: "0s",
      animationTimingFunction: "ease"
    }
  ],
  backgroundImages: [
    "linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(147, 51, 234) 100%)",
    "linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(147, 51, 234) 100%)",
    "url(\"https://example.com/hero.jpg\")"
  ],
  keyframes: [
    {
      name: "fade-in",
      steps: ["0% { opacity: 0; }", "100% { opacity: 1; }"]
    },
    {
      name: "slide-up",
      steps: ["0% { transform: translateY(16px); }", "100% { transform: translateY(0); }"]
    }
  ],
  interactionStyles: [
    {
      selector: ".btn-primary:hover",
      declarations: ["background-color: rgb(37, 99, 235)", "box-shadow: 0 2px 8px rgba(0,0,0,0.2)"]
    },
    {
      selector: "a:focus-visible",
      declarations: ["outline: 2px solid rgb(59, 130, 246)"]
    }
  ],
  breakpoints: [
    { px: 1024, count: 6 },
    { px: 640, count: 12 },
    { px: 768, count: 9 }
  ],
  runtimeAnimations: [
    {
      type: "CSSAnimation",
      name: "fade-in",
      duration: 400,
      delay: 0,
      easing: "ease-out",
      iterations: 1,
      playState: "finished",
      target: "section.hero",
      keyframes: [{ offset: 0, opacity: "0" }, { offset: 1, opacity: "1" }]
    }
  ],
  stack: [
    { name: "React", evidence: "runtime global" },
    { name: "Tailwind CSS", evidence: "responsive/state utility classes" }
  ],
  a11y: {
    contrastChecked: 80,
    contrastFailures: 3,
    worstPairs: [
      { selector: "p.muted", foreground: "#9ca3af", background: "#f9fafb", ratio: 2.31, required: 4.5 }
    ],
    targetsChecked: 40,
    smallTargets: 5
  },
  resources: {
    stylesheets: ["https://example.com/css/app.css"],
    scripts: ["https://example.com/js/app.js"],
    fontFaces: [
      { family: "Inter", weight: "400", style: "normal", urls: ["https://example.com/fonts/inter-400.woff2"] },
      { family: "Inter", weight: "700", style: "normal", urls: ["https://example.com/fonts/inter-700.woff2"] }
    ],
    inlineStyleBlocks: 2
  },
  headings: [
    {
      level: "h1",
      fontSize: "48px",
      lineHeight: "56px",
      fontWeight: "700",
      letterSpacing: "-0.02em",
      textTransform: "none",
      color: "rgb(17, 24, 39)",
      marginTop: "0px",
      marginBottom: "24px",
      fontFamily: "Inter"
    },
    {
      level: "h2",
      fontSize: "32px",
      lineHeight: "40px",
      fontWeight: "600",
      letterSpacing: "normal",
      textTransform: "none",
      color: "rgb(17, 24, 39)",
      marginTop: "48px",
      marginBottom: "16px",
      fontFamily: "Inter"
    }
  ],
  buttonVariants: [
    {
      count: 8,
      example: "Get started",
      spec: {
        background: "rgb(37, 99, 235)",
        color: "rgb(255, 255, 255)",
        border: "none",
        borderRadius: "8px",
        padding: "12px 24px 12px 24px",
        fontSize: "16px",
        fontWeight: "600",
        boxShadow: "",
        textTransform: ""
      }
    },
    {
      count: 4,
      example: "Learn more",
      spec: {
        background: "rgba(0, 0, 0, 0)",
        color: "rgb(37, 99, 235)",
        border: "1px solid rgb(37, 99, 235)",
        borderRadius: "8px",
        padding: "12px 24px 12px 24px",
        fontSize: "16px",
        fontWeight: "600",
        boxShadow: "",
        textTransform: ""
      }
    }
  ],
  formControl: {
    tag: "input",
    height: "40px",
    padding: "8px 12px 8px 12px",
    border: "1px solid rgb(209, 213, 219)",
    borderRadius: "6px",
    background: "rgb(255, 255, 255)",
    color: "rgb(17, 24, 39)",
    fontSize: "14px"
  },
  linkSpec: { color: "rgb(37, 99, 235)", textDecoration: "none", fontWeight: "500", usage: 18 },
  layout: {
    containerMaxWidth: "1280px",
    flexCount: 120,
    gridCount: 14,
    zIndexScale: [10, 50, 100],
    borderWidths: [{ value: "1px", count: 60 }],
    sectionPaddings: [
      { value: "96px", count: 4 },
      { value: "64px", count: 2 }
    ]
  },
  components: [
    { type: "buttons", count: 12 },
    { type: "inputs", count: 9 },
    { type: "navigation", count: 2 }
  ],
  siteSignals: {
    title: "Example Dashboard",
    description: "Manage your workspace, analytics, billing, and team settings.",
    keywords: "dashboard, analytics, reports, workspace, admin",
    ogType: "website",
    ogSiteName: "Example",
    appName: "Example App",
    pathname: "/app/dashboard",
    hostname: "example.com",
    headings: ["Team Dashboard", "Usage Analytics"],
    navTexts: ["Dashboard", "Reports", "Settings", "Billing", "Users"],
    ctaTexts: ["Invite user", "Save settings"],
    textSample: "Use this workspace dashboard to manage team projects, billing, reports, and account settings.",
    elementCounts: {
      forms: 4,
      inputs: 22,
      tables: 2,
      codeBlocks: 0,
      articles: 0,
      pricingSections: 0,
      productMarkers: 0,
      authMarkers: 3,
      checkoutMarkers: 0
    }
  },
  cssVariables: [
    { name: "--font-size-base", value: "14px" },
    { name: "--color-bg", value: "#ffffff" },
    { name: "--spacing-margin", value: "8px" }
  ],
  gsap: {
    detected: true,
    version: "3.12.2",
    timelines: [
      { type: "Tween", duration: 1.5, delay: 0.2, vars: ["x", "opacity", "ease"] }
    ]
  },
  platformInfo: {
    platform: "figma",
    fileKey: "AbCdEfGh1234",
    nodeId: "1:23",
    details: "Figma workspace detected. File Key: AbCdEfGh1234, Active Node ID: 1:23."
  }
};

const normalized = normalizeExtractedStyles(mockPayload);

assert.ok(normalized.typographyScale.length >= 3, "typography scale should be inferred");
assert.equal(normalized.mainFontStyle.primaryFamily, "Inter", "main font family should be inferred");
assert.ok(normalized.colorPalette.length >= 3, "color palette should be inferred");
assert.ok(normalized.spacingScale.length >= 2, "spacing scale should be inferred");

const designMd = generateDesignMarkdown({
  normalized,
  metadata: {
    systemName: "Example DS",
    brand: "Example"
  }
});

const skillMd = generateSkillMarkdown({
  normalized,
  metadata: {
    systemName: "Example DS",
    brand: "Example"
  }
});

const designValidation = validateMarkdownOutput("design", designMd);
const skillValidation = validateMarkdownOutput("skill", skillMd);

assert.ok(designValidation.isValid, `DESIGN.md should be valid: ${designValidation.errors.join(", ")}`);
assert.ok(skillValidation.isValid, `SKILL.md should be valid: ${skillValidation.errors.join(", ")}`);
assert.ok(skillMd.includes("TYPEUI_SH_MANAGED_START"), "SKILL.md should include managed markers");
assert.ok(designMd.includes("WCAG 2.2 AA"), "DESIGN.md should include accessibility target");
assert.ok(designMd.includes("- URL: https://example.com/dashboard"), "DESIGN.md should include extraction URL");
assert.ok(designMd.includes("- Primary font: `Inter` — stack: `Inter, Helvetica Neue, Arial, sans-serif`"), "DESIGN.md should include inferred main font style");
assert.ok(skillMd.includes("- URL: https://example.com/dashboard"), "SKILL.md should include extraction URL");
assert.ok(skillMd.includes("- Primary font: `Inter` — stack: `Inter, Helvetica Neue, Arial, sans-serif`"), "SKILL.md should include inferred main font style");
assert.ok(designMd.includes("- Audience: authenticated users and operators"), "DESIGN.md should infer audience from site signals");
assert.ok(designMd.includes("- Product surface: dashboard web app"), "DESIGN.md should infer product surface from site signals");
assert.ok(skillMd.includes("- Product surface: dashboard web app"), "SKILL.md should infer product surface from site signals");
assert.ok(!designMd.includes("Audience/surface inference confidence"), "DESIGN.md should not include inference confidence text");
assert.ok(!skillMd.includes("Audience/surface inference confidence"), "SKILL.md should not include inference confidence text");

// CSS variables mapping assertions
assert.ok(normalized.typographyScale.some(t => t.value.includes("var(--font-size-base)")), "typography scale should map CSS variable");
assert.ok(normalized.colorPalette.some(c => c.value.includes("var(--color-bg)")), "color palette should map CSS variable");
assert.ok(normalized.spacingScale.some(s => s.value.includes("var(--spacing-margin)")), "spacing scale should map CSS variable");

// Color clustering assertion
assert.ok(!normalized.colorPalette.some(c => c.value.includes("#fefefe")), "visually similar color #fefefe should be merged into #ffffff");

// GSAP animations assertions
assert.ok(designMd.includes("- GSAP v3.12.2 detected: 1 active timelines"), "DESIGN.md should include GSAP details");
assert.ok(skillMd.includes("- GSAP v3.12.2 detected: 1 active timelines"), "SKILL.md should include GSAP details");

// Design platform assertions
assert.ok(designMd.includes("- Design platform: FIGMA (Figma workspace detected. File Key: AbCdEfGh1234, Active Node ID: 1:23.)"), "DESIGN.md should include Figma platform details");
assert.ok(skillMd.includes("- Design platform: FIGMA (Figma workspace detected. File Key: AbCdEfGh1234, Active Node ID: 1:23.)"), "SKILL.md should include Figma platform details");

// Gradient / keyframes / interaction / breakpoint assertions
assert.ok(normalized.gradientTokens.length === 1, "duplicate gradients should be merged into one token");
assert.equal(normalized.gradientTokens[0].usage, 2, "gradient usage should be counted");
assert.deepEqual(normalized.breakpoints.map((b) => b.px), [640, 768, 1024], "breakpoints should be sorted ascending");
assert.equal(normalized.keyframes.length, 2, "keyframes should be preserved");
assert.equal(normalized.interactionStyles.length, 2, "interaction styles should be preserved");
assert.ok(designMd.includes("- `color.gradient.1` = `linear-gradient(135deg"), "DESIGN.md should include gradient tokens");
assert.ok(designMd.includes("### Responsive Breakpoints"), "DESIGN.md should include breakpoints section");
assert.ok(designMd.includes("| sm | 640px | 12 |"), "DESIGN.md should include breakpoint table rows");
assert.ok(designMd.includes("`@keyframes fade-in` (2 steps)"), "DESIGN.md should include keyframes");
assert.ok(designMd.includes("### Interaction States (measured)"), "DESIGN.md should include interaction section");
assert.ok(designMd.includes("- `.btn-primary:hover` → `background-color: rgb(37, 99, 235)`"), "DESIGN.md should include measured interaction rules");
assert.ok(skillMd.includes("| sm | 640px | 12 |"), "SKILL.md should include breakpoints");
assert.ok(skillMd.includes("`@keyframes fade-in` (2 steps)"), "SKILL.md should include keyframes");

// css-assets: relative path computation
assert.equal(relativePathBetween("css/main.css", "fonts/inter.woff2"), "../fonts/inter.woff2");
assert.equal(relativePathBetween("css/main.css", "css/theme.css"), "theme.css");
assert.equal(relativePathBetween("css/main.css", "img/bg.png"), "../img/bg.png");

// css-assets: folder inference
assert.deepEqual(folderForAssetUrl("https://x.com/a.woff2?v=3"), { folder: "fonts", ext: ".woff2" });
assert.deepEqual(folderForAssetUrl("https://x.com/a.css"), { folder: "css", ext: ".css" });
assert.deepEqual(folderForAssetUrl("https://x.com/a.svg#icon"), { folder: "img", ext: ".png" });

// css-assets: filename collision handling
{
  const usedPaths = new Set();
  const first = assignAssetPath("https://a.com/logo.png", "img", ".png", usedPaths);
  const second = assignAssetPath("https://b.com/assets/logo.png", "img", ".png", usedPaths);
  assert.equal(first, "img/logo.png");
  assert.notEqual(second, first, "colliding filenames should be deduplicated");
  assert.ok(second.startsWith("img/logo_") && second.endsWith(".png"), "dedup should keep folder and extension");
}

// css-assets: url() rewriting keeps data: URIs and rewrites the rest
{
  const css = ".a { background: url('bg.png'); } .b { src: url(data:font/woff2;base64,AAA); }";
  const rewritten = rewriteCssText(css, (ref) => (ref === "bg.png" ? "../img/bg.png" : null));
  assert.ok(rewritten.includes('url("../img/bg.png")'), "relative url should be rewritten");
  assert.ok(rewritten.includes("url(data:font/woff2;base64,AAA)"), "data: URI should be untouched");
}

// css-assets: end-to-end CSS processing with fonts and chained @import
{
  const cssByUrl = {
    "https://site.com/css/main.css":
      "@import \"reset.css\";\n.hero { background-image: url('../images/hero.jpg'); }\n@font-face { src: url('https://fonts.gstatic.com/inter.woff2'); }",
    "https://site.com/css/reset.css": "body { margin: 0; }"
  };
  const initialAssets = [{ url: "https://site.com/css/main.css", path: "css/main.css" }];
  const result = await processCssAssets(initialAssets, async (url) => {
    if (!cssByUrl[url]) throw new Error("404");
    return cssByUrl[url];
  });

  assert.equal(result.rewrittenCss.length, 2, "main.css and the @import chain should both be rewritten");
  const mainCss = result.rewrittenCss.find((entry) => entry.path === "css/main.css").text;
  assert.ok(mainCss.includes('@import "reset.css"'), "@import should point to the local css file");
  assert.ok(mainCss.includes('url("../img/hero.jpg")'), "background image should point to the local img folder");
  assert.ok(mainCss.includes('url("../fonts/inter.woff2")'), "font should point to the local fonts folder");

  const extraUrls = result.extraAssets.map((asset) => asset.url).sort();
  assert.deepEqual(
    extraUrls,
    [
      "https://fonts.gstatic.com/inter.woff2",
      "https://site.com/css/reset.css",
      "https://site.com/images/hero.jpg"
    ],
    "referenced assets should be scheduled for download"
  );
}

// Runtime animations / stack / a11y assertions
assert.equal(normalized.runtimeAnimations.length, 1, "runtime animations should be preserved");
assert.deepEqual(normalized.stack.map((s) => s.name), ["React", "Tailwind CSS"], "stack should be preserved");
assert.equal(normalized.a11y.contrastFailures, 3, "a11y contrast failures should be preserved");
assert.ok(designMd.includes("- Runtime (WAAPI): `fade-in` on `section.hero` — 400ms ease-out"), "DESIGN.md should include runtime animations");
assert.ok(designMd.includes("- Detected tech stack: React (runtime global), Tailwind CSS"), "DESIGN.md should include detected stack");
assert.ok(designMd.includes("- Measured contrast audit: 3/80 sampled text elements fail"), "DESIGN.md should include measured contrast audit");
assert.ok(designMd.includes("- Target size audit: 5/40 interactive targets are below the 24x24px"), "DESIGN.md should include target size audit");
assert.ok(skillMd.includes("- Measured contrast audit: 3/80"), "SKILL.md should include measured contrast audit");
assert.ok(designMd.includes("WCAG 2.2 AA"), "accessibility target must survive the a11y rewrite");

// W3C tokens export
{
  const w3c = generateW3cTokens(normalized);
  assert.ok(w3c.color && Object.keys(w3c.color).length > 0, "W3C tokens should include colors");
  assert.deepEqual(
    w3c.font.family.primary.$value[0],
    "Inter",
    "W3C tokens should include the primary font family"
  );
  const flat = JSON.stringify(w3c);
  assert.ok(!flat.includes("var(--"), "W3C token values should strip var() annotations");
  assert.ok(flat.includes('"$type":"color"'), "W3C tokens should be typed");
}

// Tailwind config export
{
  const tailwind = generateTailwindConfig(normalized);
  assert.ok(tailwind.includes("module.exports"), "tailwind config should be a CommonJS module");
  assert.ok(tailwind.includes('"sm": "640px"'), "tailwind config should map breakpoints to screens");
  assert.ok(tailwind.includes("Inter"), "tailwind config should include the font family");
  assert.ok(!tailwind.includes("var(--"), "tailwind values should strip var() annotations");
}

// Diff report
{
  const before = JSON.parse(JSON.stringify(normalized));
  const after = JSON.parse(JSON.stringify(normalized));
  const identical = diffNormalized(before, after);
  assert.ok(identical.identical, "identical extractions should produce an empty diff");

  after.colorPalette[0] = { ...after.colorPalette[0], value: "#123456" };
  after.spacingScale.push({ token: "space.99", value: "128px", usage: 1 });
  const diffMd = generateDiffMarkdown(before, after);
  assert.ok(diffMd.includes("# Design Diff Report"), "diff markdown should have a title");
  assert.ok(diffMd.includes("→ `#123456`"), "diff markdown should show changed color value");
  assert.ok(diffMd.includes("Added `space.99` = `128px`"), "diff markdown should show added token");
}

// ZIP writer (STORE)
{
  const encoder = new TextEncoder();
  const files = [
    { path: "index.html", data: encoder.encode("<!doctype html><title>x</title>") },
    { path: "css/main.css", data: encoder.encode("body { margin: 0; }") }
  ];
  const zip = await createZip(files, { compress: false });
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50, "zip should start with a local file header");
  const eocdOffset = zip.length - 22;
  assert.equal(view.getUint32(eocdOffset, true), 0x06054b50, "zip should end with EOCD");
  assert.equal(view.getUint16(eocdOffset + 10, true), 2, "EOCD should count 2 entries");
  assert.equal(crc32(encoder.encode("")), 0, "crc32 of empty input should be 0");
  assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926, "crc32 should match the reference vector");

  // Compressed variant (skipped when the runtime lacks deflate-raw support).
  let deflateSupported = true;
  try {
    new CompressionStream("deflate-raw");
  } catch (error) {
    deflateSupported = false;
  }
  if (deflateSupported) {
    const bigText = "abcdef".repeat(5000);
    const compressed = await createZip(
      [{ path: "big.txt", data: encoder.encode(bigText) }],
      { compress: true }
    );
    assert.ok(compressed.length < bigText.length, "deflate should shrink repetitive content");
    const cView = new DataView(compressed.buffer);
    assert.equal(cView.getUint16(8, true), 8, "compressed entry should use method 8 (deflate)");
  }
}

// Expert-level generator assertions (tables, measured metrics, inventory)
assert.ok(designMd.includes("### Color System"), "DESIGN.md should have a color system section");
assert.ok(designMd.includes("| `color.text.primary` | `#111827` | — | 3 |"), "DESIGN.md color table should include text primary");
assert.ok(designMd.includes("| `color.surface.base` | `#ffffff` | `var(--color-bg)` | 4 |"), "DESIGN.md color table should map CSS variables");
assert.ok(/measured contrast \*\*\d+(\.\d+)?:1\*\*/.test(designMd), "DESIGN.md should compute the core contrast pair");
assert.ok(designMd.includes("- Spacing base grid: **4px**"), "DESIGN.md should infer the spacing base grid");
assert.ok(designMd.includes("- Estimated type scale ratio: ~1.2"), "DESIGN.md should estimate the type scale ratio");
assert.ok(designMd.includes("| `font.size.xs` | `14px` | `var(--font-size-base)` |"), "DESIGN.md typography table should map CSS variables");
assert.ok(designMd.includes("## Component Inventory"), "DESIGN.md should include the component inventory");
assert.ok(designMd.includes("- **Buttons** (12 detected)"), "DESIGN.md should include a data-driven button spec");
assert.ok(designMd.includes("## Implementation Notes"), "DESIGN.md should include implementation notes");
assert.ok(designMd.includes("- Page loads 1 external stylesheet(s), 1 external script(s), 2 inline style block(s)."), "DESIGN.md should include resource counts");
assert.ok(designMd.includes("- Self-hosted @font-face families: `Inter` (400, 700)"), "DESIGN.md should list @font-face families");
assert.ok(designMd.includes("- Font files to self-host: `inter-400.woff2`, `inter-700.woff2`"), "DESIGN.md should list font files");
assert.ok(designMd.includes("- Snap all spacing to the measured 4px base grid."), "DESIGN.md should include data-driven Do rules");
assert.ok(designMd.includes("-color measured palette without a documented reason."), "DESIGN.md should include data-driven Don't rules");
assert.ok(skillMd.includes("## Component Inventory"), "SKILL.md should include the component inventory");
assert.ok(skillMd.includes("## Implementation Notes"), "SKILL.md should include implementation notes");

// Frontmatter + atmosphere + agent guide (designmd / awesome-design-md fusion)
assert.ok(designMd.startsWith("---\nversion: 1"), "DESIGN.md should start with YAML frontmatter");
assert.ok(designMd.includes("name: example-ds-design-system"), "frontmatter should include a slugged name");
assert.ok(designMd.includes("description: >-"), "frontmatter should include a folded description");
assert.ok(designMd.includes('  text-primary: "#111827"'), "frontmatter colors block should map semantic names to hex");
assert.ok(designMd.includes('  surface-base: "#ffffff"'), "frontmatter colors block should include surfaces");
assert.ok(designMd.includes("  heading-h1:"), "frontmatter typography block should include measured headings");
assert.ok(designMd.includes("    fontSize: 48px"), "frontmatter typography should carry measured sizes");
assert.ok(designMd.includes('    fontFamily: "Inter, Helvetica Neue, Arial, sans-serif"'), "frontmatter body should carry the font stack");
assert.ok(designMd.includes("Extracted design system: a light, airy canvas (#ffffff)"), "atmosphere should describe the canvas tone");
assert.ok(designMd.includes("blue accent"), "atmosphere should name the accent hue");
assert.ok(designMd.includes("## Agent Prompt Guide"), "DESIGN.md should include the agent prompt guide");
assert.ok(designMd.includes("> Non-negotiables:"), "agent guide should include non-negotiables");
assert.ok(designMd.includes("4px spacing grid"), "agent guide should include the measured grid");
assert.ok(designMd.includes("- Touch targets: keep every interactive target at 24x24px minimum"), "responsive section should include touch targets");
assert.ok(designMd.includes("- Collapsing strategy: below 640px"), "responsive section should include the collapsing strategy");
assert.ok(skillMd.includes("## Agent Prompt Guide"), "SKILL.md should include the agent prompt guide");
assert.ok(skillMd.includes("Extracted design system: a light, airy canvas"), "SKILL.md should include the atmosphere");
assert.ok(skillMd.startsWith("---\nname: design-system-"), "SKILL.md must keep its own frontmatter format");

// Element-precision assertions (heading hierarchy, button variants, layout, score)
assert.ok(designMd.includes("Measured heading hierarchy:"), "DESIGN.md should include the heading hierarchy");
assert.ok(designMd.includes("| `h1` | `48px/56px` | 700 | -0.02em | none | `#111827` | 0px/24px |"), "DESIGN.md heading table should include measured h1");
assert.ok(designMd.includes("### Component Specs (measured)"), "DESIGN.md should include component specs");
assert.ok(designMd.includes("/* button.primary — seen 8x, e.g. \"Get started\" */"), "DESIGN.md should include the primary button variant");
assert.ok(designMd.includes("background: #2563eb;"), "DESIGN.md button spec should canonicalize colors to hex");
assert.ok(designMd.includes("border: 1px solid rgb(37, 99, 235);"), "DESIGN.md should include the secondary button border");
assert.ok(designMd.includes("- Form control (`input`): height 40px"), "DESIGN.md should include the form control spec");
assert.ok(designMd.includes("- Links: color `#2563eb`") || designMd.includes("- Links: color `rgb(37, 99, 235)`"), "DESIGN.md should include the link spec");
assert.ok(designMd.includes("### Layout System"), "DESIGN.md should include the layout system");
assert.ok(designMd.includes("- Content container max-width: **1280px**"), "DESIGN.md should include the container width");
assert.ok(designMd.includes("flexbox-first architecture"), "DESIGN.md should identify the layout method");
assert.ok(designMd.includes("- Section vertical rhythm: 96px (4x), 64px (2x)"), "DESIGN.md should include section rhythm");
assert.ok(designMd.includes("- Z-index scale: 10, 50, 100"), "DESIGN.md should include the z-index scale");
assert.ok(designMd.includes("## Design Health Score"), "DESIGN.md should include the design score");
assert.ok(/Measured design health: \*\*\d+\/100\*\*/.test(designMd), "DESIGN.md should include a numeric score");
assert.ok(skillMd.includes("### Component Specs (measured)"), "SKILL.md should include component specs");
assert.ok(skillMd.includes("## Design Health Score"), "SKILL.md should include the design score");

// Complete JSON export
{
  const json = generateDesignJson(normalized, { version: "0.6.0" });
  assert.equal(json.meta.generator, "Keys_Osi_Design.md-extractor v0.6.0", "JSON export should name the generator");
  assert.equal(json.meta.sourceUrl, "https://example.com/dashboard", "JSON export should include the source URL");
  assert.ok(json.tokens.colorCodes.includes("#111827"), "JSON export should include flat color codes");
  assert.ok(json.tokens.colors.some((row) => row.cssVariable === "var(--color-bg)"), "JSON export should split CSS variables");
  assert.equal(json.tokens.typography.estimatedScaleRatio, 1.2, "JSON export should include the scale ratio");
  assert.equal(json.tokens.spacing.baseGrid, 4, "JSON export should include the spacing base grid");
  assert.equal(json.resources.fontFaces.length, 2, "JSON export should include @font-face inventory");
  assert.equal(json.resources.fontFaces[0].urls[0], "https://example.com/fonts/inter-400.woff2", "JSON export should include font file URLs");
  assert.ok(json.w3cTokens && json.w3cTokens.color, "JSON export should embed W3C tokens");
  assert.equal(json.animation.keyframes.length, 2, "JSON export should include keyframes");
  assert.deepEqual(json.responsive.breakpoints.map((b) => b.px), [640, 768, 1024], "JSON export should include breakpoints");
  assert.equal(json.accessibility.contrastFailures, 3, "JSON export should include the a11y audit");
  assert.deepEqual(json.stack.map((s) => s.name), ["React", "Tailwind CSS"], "JSON export should include the stack");

  const textPrimary = json.tokens.colors.find((row) => row.token === "color.text.primary");
  assert.equal(textPrimary.formats.rgb, "rgb(17, 24, 39)", "JSON colors should include RGB format");
  assert.ok(/^hsl\(\d+, \d+%, \d+%\)$/.test(textPrimary.formats.hsl), "JSON colors should include HSL format");
  assert.equal(json.componentSpecs.headings.length, 2, "JSON should include the heading hierarchy");
  assert.equal(json.componentSpecs.buttonVariants[0].name, "primary", "JSON should name button variants");
  assert.equal(json.componentSpecs.buttonVariants[0].spec.background, "#2563eb", "JSON button colors should be canonical hex");
  assert.equal(json.componentSpecs.buttonVariants[1].spec.background, "transparent", "transparent button backgrounds must stay transparent, not become black");
  assert.equal(json.componentSpecs.formControl.tag, "input", "JSON should include the form control spec");
  assert.equal(json.layout.containerMaxWidth, "1280px", "JSON should include the layout system");
  assert.ok(json.designScore.score > 0 && json.designScore.score <= 100, "JSON should include the design score");
  assert.ok(json.designScore.breakdown.length >= 6, "JSON design score should include its breakdown");
}

// Advanced audit sections (multi-viewport, dark mode, disclosures)
{
  assert.equal(formatAuditSections(null), "", "no audit should produce no sections");
  assert.equal(
    formatAuditSections({ viewports: [], darkMode: null, interactions: null }),
    "",
    "empty audit should produce no sections"
  );

  const audit = {
    viewports: [
      {
        name: "mobile",
        width: 375,
        height: 812,
        typographyScale: [{ token: "font.size.xs", value: "13px" }],
        spacingScale: [{ token: "space.1", value: "8px" }]
      },
      {
        name: "desktop",
        width: 1440,
        height: 900,
        typographyScale: [{ token: "font.size.xs", value: "14px" }],
        spacingScale: [{ token: "space.1", value: "12px" }]
      }
    ],
    darkMode: {
      colorPalette: [{ token: "color.surface.base", value: "#0b0f19", usage: 40 }]
    },
    interactions: { opened: 3, report: ["details", "button.hamburger"] }
  };
  const sections = formatAuditSections(audit);
  assert.ok(sections.includes("## Responsive Audit (measured)"), "audit should include responsive section");
  assert.ok(sections.includes("**mobile** (375x812): font sizes [13px]"), "audit should include mobile viewport data");
  assert.ok(sections.includes("## Dark Mode Palette (measured)"), "audit should include dark mode section");
  assert.ok(sections.includes("`color.surface.base=#0b0f19`"), "audit should include dark palette tokens");
  assert.ok(sections.includes("## Disclosure States (captured)"), "audit should include disclosures section");
  assert.ok(sections.includes("3 menus/accordions/dropdowns were safely opened"), "audit should count opened disclosures");
}

console.log("All tests passed.");
