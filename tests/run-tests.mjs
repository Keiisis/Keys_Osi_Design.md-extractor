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
assert.ok(designMd.includes("- Main font style: `font.family.primary=Inter`"), "DESIGN.md should include inferred main font style");
assert.ok(skillMd.includes("- URL: https://example.com/dashboard"), "SKILL.md should include extraction URL");
assert.ok(skillMd.includes("- Main font style: `font.family.primary=Inter`"), "SKILL.md should include inferred main font style");
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
assert.ok(designMd.includes("Animations: GSAP v3.12.2 detected"), "DESIGN.md should include GSAP details");
assert.ok(skillMd.includes("Animations: GSAP v3.12.2 detected"), "SKILL.md should include GSAP details");

// Design platform assertions
assert.ok(designMd.includes("- Design platform: FIGMA (Figma workspace detected. File Key: AbCdEfGh1234, Active Node ID: 1:23.)"), "DESIGN.md should include Figma platform details");
assert.ok(skillMd.includes("- Design platform: FIGMA (Figma workspace detected. File Key: AbCdEfGh1234, Active Node ID: 1:23.)"), "SKILL.md should include Figma platform details");

// Gradient / keyframes / interaction / breakpoint assertions
assert.ok(normalized.gradientTokens.length === 1, "duplicate gradients should be merged into one token");
assert.equal(normalized.gradientTokens[0].usage, 2, "gradient usage should be counted");
assert.deepEqual(normalized.breakpoints.map((b) => b.px), [640, 768, 1024], "breakpoints should be sorted ascending");
assert.equal(normalized.keyframes.length, 2, "keyframes should be preserved");
assert.equal(normalized.interactionStyles.length, 2, "interaction styles should be preserved");
assert.ok(designMd.includes("- Gradients: `color.gradient.1=linear-gradient(135deg"), "DESIGN.md should include gradient tokens");
assert.ok(designMd.includes("- Responsive breakpoints: 640px (12 rules), 768px (9 rules), 1024px (6 rules)"), "DESIGN.md should include breakpoints");
assert.ok(designMd.includes("- Keyframe animations: `@keyframes fade-in` (2 steps), `@keyframes slide-up` (2 steps)"), "DESIGN.md should include keyframes");
assert.ok(designMd.includes("- Interaction states: 2 hover/focus/active rules captured"), "DESIGN.md should include interaction states");
assert.ok(skillMd.includes("- Responsive breakpoints: 640px (12 rules)"), "SKILL.md should include breakpoints");
assert.ok(skillMd.includes("- Keyframe animations: `@keyframes fade-in` (2 steps)"), "SKILL.md should include keyframes");

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
assert.ok(designMd.includes("- Runtime animations (Web Animations API): `fade-in` (400ms ease-out)"), "DESIGN.md should include runtime animations");
assert.ok(designMd.includes("- Detected tech stack: React, Tailwind CSS"), "DESIGN.md should include detected stack");
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
