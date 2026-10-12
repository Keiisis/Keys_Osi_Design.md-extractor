// Checks lib/platform-exports.mjs on the normalized output of the shared
// mock payload (copied from tests/run-tests.mjs, fields the exporters read).
// Usage: node tests/platform-exports-tests.mjs
import assert from "node:assert/strict";
import { normalizeExtractedStyles } from "../lib/normalize.mjs";
import {
  allPlatformExports,
  readTokens,
  toAgentRules,
  toCompose,
  toFlutter,
  toFramerMotion,
  toStorybook,
  toSwiftUI,
  toTailwindV4,
  toWordPressThemeJson
} from "../lib/platform-exports.mjs";

const mockPayload = {
  source: { url: "https://example.com/dashboard", title: "Example Dashboard" },
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
    { marginTop: "8px", marginRight: "16px", marginBottom: "8px", marginLeft: "16px", paddingTop: "12px", paddingRight: "16px", paddingBottom: "12px", paddingLeft: "16px" }
  ],
  radius: ["6px", "8px", "8px"],
  shadows: ["none", "0 1px 2px rgba(0, 0, 0, 0.08)"],
  motion: [{ transitionDuration: "150ms", transitionTimingFunction: "ease-in-out", animationDuration: "0s", animationTimingFunction: "ease" }],
  pageBackground: "#ffffff",
  backgroundImages: [
    "linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(147, 51, 234) 100%)",
    "linear-gradient(135deg, rgb(59, 130, 246) 0%, rgb(147, 51, 234) 100%)",
    "url(\"https://example.com/hero.jpg\")"
  ],
  keyframes: [
    { name: "fade-in", steps: ["0% { opacity: 0; }", "100% { opacity: 1; }"] },
    { name: "slide-up", steps: ["0% { transform: translateY(16px); }", "100% { transform: translateY(0); }"] }
  ],
  interactionStyles: [
    { selector: ".btn-primary:hover", declarations: ["background-color: rgb(37, 99, 235)", "box-shadow: 0 2px 8px rgba(0,0,0,0.2)"] },
    { selector: "a:focus-visible", declarations: ["outline: 2px solid rgb(59, 130, 246)"] }
  ],
  breakpoints: [{ px: 1024, count: 6 }, { px: 640, count: 12 }, { px: 768, count: 9 }],
  runtimeAnimations: [
    { type: "CSSAnimation", name: "fade-in", duration: 400, delay: 0, easing: "ease-out", iterations: 1, playState: "finished", target: "section.hero", keyframes: [{ offset: 0, opacity: "0" }, { offset: 1, opacity: "1" }] }
  ],
  headings: [
    { level: "h1", fontSize: "48px", lineHeight: "56px", fontWeight: "700", letterSpacing: "-0.02em", textTransform: "none", color: "rgb(17, 24, 39)", marginTop: "0px", marginBottom: "24px", fontFamily: "Inter" },
    { level: "h2", fontSize: "32px", lineHeight: "40px", fontWeight: "600", letterSpacing: "normal", textTransform: "none", color: "rgb(17, 24, 39)", marginTop: "48px", marginBottom: "16px", fontFamily: "Inter" }
  ],
  buttonVariants: [
    { count: 8, example: "Get started", spec: { background: "rgb(37, 99, 235)", color: "rgb(255, 255, 255)", border: "none", borderRadius: "8px", padding: "12px 24px 12px 24px", fontSize: "16px", fontWeight: "600", boxShadow: "", textTransform: "" } },
    { count: 4, example: "Learn more", spec: { background: "rgba(0, 0, 0, 0)", color: "rgb(37, 99, 235)", border: "1px solid rgb(37, 99, 235)", borderRadius: "8px", padding: "12px 24px 12px 24px", fontSize: "16px", fontWeight: "600", boxShadow: "", textTransform: "" } }
  ],
  formControl: { tag: "input", height: "40px", padding: "8px 12px 8px 12px", border: "1px solid rgb(209, 213, 219)", borderRadius: "6px", background: "rgb(255, 255, 255)", color: "rgb(17, 24, 39)", fontSize: "14px" },
  linkSpec: { color: "rgb(37, 99, 235)", textDecoration: "none", fontWeight: "500", usage: 18 },
  layout: {
    containerMaxWidth: "1280px",
    flexCount: 120,
    gridCount: 14,
    zIndexScale: [10, 50, 100],
    borderWidths: [{ value: "1px", count: 60 }],
    sectionPaddings: [{ value: "96px", count: 4 }, { value: "64px", count: 2 }]
  },
  cssVariables: [
    { name: "--font-size-base", value: "14px" },
    { name: "--color-bg", value: "#ffffff" },
    { name: "--spacing-margin", value: "8px" }
  ],
  gsap: {
    detected: true,
    version: "3.12.2",
    timelines: [{ type: "Tween", duration: 1.5, delay: 0.2, vars: ["x", "opacity", "ease"], values: { x: 100, opacity: 1, ease: "power2.out" }, targets: ["section.hero"] }]
  }
};

const normalized = normalizeExtractedStyles(mockPayload);

/** Bracket balance outside string literals and comments (C-like syntaxes). */
function assertBalanced(code, label) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  let quote = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      i = code.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      i = code.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (ch === "\"" || ch === "'") quote = ch;
    else if ("([{".includes(ch)) stack.push(ch);
    else if (pairs[ch]) assert.equal(stack.pop(), pairs[ch], `${label}: unbalanced '${ch}' at ${i}`);
  }
  assert.equal(stack.length, 0, `${label}: unclosed ${stack.join("")}`);
  assert.equal(quote, null, `${label}: unterminated string`);
}

/* ---------------- token reading ---------------- */
const t = readTokens(normalized);
assert.equal(t.byPath["brand.primary"], "#2563eb");
assert.equal(t.byPath["surface.base"], "#ffffff", "the (var(--x)) annotation is stripped");
assert.deepEqual(t.spacing, [8, 12, 16]);
assert.equal(t.baseGrid, 4);
assert.deepEqual(t.radii, [{ name: "xs", px: 6 }, { name: "sm", px: 8 }]);
assert.equal(t.family, "Inter");

/* ---------------- SwiftUI ---------------- */
{
  const out = toSwiftUI(normalized);
  assert.equal(out.path, "ios/DesignTokens.swift");
  const c = out.content;
  assertBalanced(c, "swift");
  assert.ok(c.includes("import SwiftUI"));
  assert.ok(c.includes("self.init(\n      .sRGB,"));
  assert.ok(c.includes("static let brandPrimary = Color(rgbHex: 0x2563EB) // color.brand.primary"));
  assert.ok(c.includes("static let textPrimary = Color(rgbHex: 0x111827)"));
  assert.ok(c.includes("static let surfaceBase = Color(rgbHex: 0xFFFFFF)"));
  assert.ok(c.includes('static let headingH1 = Font.custom("Inter", size: 48, relativeTo: .largeTitle).weight(.bold)'));
  assert.ok(c.includes('static let bodyText = Font.custom("Inter", size: 16, relativeTo: .callout).weight(.regular)'));
  assert.ok(c.includes("static let s1: CGFloat = 8"));
  assert.ok(c.includes("static let s3: CGFloat = 16"));
  assert.ok(c.includes("static let xs: CGFloat = 6"));
  assert.ok(c.includes("static let curve1 = Animation.timingCurve(0.42, 0, 0.58, 1, duration: 0.15)"));
  assert.ok(c.includes("shadow(color: Color(rgbHex: 0x000000, opacity: 0.08), radius: 1, x: 0, y: 1)"));
}

/* ---------------- Compose ---------------- */
{
  const out = toCompose(normalized);
  assert.equal(out.path, "android/Theme.kt");
  const c = out.content;
  assertBalanced(c, "kotlin");
  assert.ok(c.includes("import androidx.compose.material3.lightColorScheme"));
  assert.ok(c.includes("val BrandPrimary = Color(0xFF2563EB)"));
  assert.ok(c.includes("    primary = Color(0xFF2563EB),"));
  assert.ok(c.includes("    onPrimary = Color(0xFFFFFFFF),"));
  assert.ok(c.includes("    onSurface = Color(0xFF111827),"));
  assert.ok(c.includes("    outline = Color(0xFFE5E7EB),"));
  assert.ok(c.includes("headlineLarge = TextStyle(fontFamily = AppFontFamily, fontWeight = FontWeight(700), fontSize = 48.sp, lineHeight = 56.sp, letterSpacing = (-0.02).em)"));
  assert.ok(c.includes("bodyLarge = TextStyle(fontFamily = AppFontFamily, fontWeight = FontWeight(400), fontSize = 16.sp, lineHeight = 24.sp)"));
  assert.ok(c.includes("extraSmall = RoundedCornerShape(6.dp)"));
  assert.ok(c.includes("small = RoundedCornerShape(8.dp)"));
  assert.ok(c.includes("val S1 = 8.dp"));
  assert.ok(c.includes("MaterialTheme(\n        colorScheme = AppColorScheme,"));
}

/* ---------------- Flutter ---------------- */
{
  const out = toFlutter(normalized);
  assert.equal(out.path, "flutter/app_theme.dart");
  const c = out.content;
  assertBalanced(c, "dart");
  assert.ok(c.includes("import 'package:flutter/material.dart';"));
  assert.ok(c.includes("static const Color brandPrimary = Color(0xFF2563EB);"));
  // ColorScheme's required parameters are all present.
  for (const p of ["brightness: Brightness.light", "primary:", "onPrimary:", "secondary:", "onSecondary:", "error:", "onError:", "surface:", "onSurface:"]) {
    assert.ok(c.includes(`    ${p}`), `ColorScheme param missing: ${p}`);
  }
  assert.ok(c.includes("    primary: Color(0xFF2563EB),"));
  assert.ok(c.includes("    onSurface: Color(0xFF111827),"));
  assert.ok(c.includes("headlineLarge: TextStyle(fontSize: 48, fontWeight: FontWeight.w700, height: 1.167, letterSpacing: -0.96),"));
  assert.ok(c.includes("bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w400, height: 1.5),"));
  assert.ok(c.includes("static const double s1 = 8;"));
  assert.ok(c.includes("static const double sm = 8;"));
  assert.ok(c.includes("padding: const EdgeInsets.fromLTRB(24, 12, 24, 12),"));
  assert.ok(c.includes("shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),"));
  assert.ok(c.includes("borderSide: const BorderSide(color: Color(0xFFD1D5DB))"));
  assert.ok(c.includes("const String appFontFamily = 'Inter';"));
}

/* ---------------- Tailwind v4 ---------------- */
{
  const out = toTailwindV4(normalized);
  assert.equal(out.path, "tailwind/theme.css");
  const css = out.content.replace(/\/\*[\s\S]*?\*\//g, "");
  assertBalanced(css, "tailwind");
  assert.ok(css.indexOf('@import "tailwindcss";') < css.indexOf("@theme {"), "@theme comes after the import");
  // Parse the @theme block: custom properties in known namespaces, plus nested @keyframes.
  const start = css.indexOf("@theme {") + "@theme {".length;
  let depth = 1;
  let i = start;
  for (; i < css.length && depth; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
  }
  const body = css.slice(start, i - 1);
  const keyframes = [...body.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
  assert.deepEqual(keyframes.map((k) => k[1]), ["fade-in", "slide-up"]);
  const decls = body.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "").split(";").map((s) => s.trim()).filter(Boolean);
  const NAMESPACES = /^--(color|font|text|font-weight|tracking|leading|breakpoint|container|spacing|radius|shadow|inset-shadow|drop-shadow|blur|perspective|aspect|ease|animate)(-|$)/;
  const vars = {};
  for (const d of decls) {
    const m = /^(--[a-z0-9-]+)\s*:\s*([^;{}]+)$/i.exec(d);
    assert.ok(m, `invalid @theme declaration: ${d}`);
    assert.match(m[1], NAMESPACES, `unknown Tailwind namespace: ${m[1]}`);
    vars[m[1]] = m[2].trim();
  }
  assert.equal(vars["--color-brand-primary"], "#2563eb");
  assert.equal(vars["--color-text-primary"], "#111827");
  assert.equal(vars["--font-sans"], 'Inter, "Helvetica Neue", Arial, sans-serif');
  assert.equal(vars["--text-h1"], "48px");
  assert.equal(vars["--text-h1--line-height"], "56px");
  assert.equal(vars["--text-h1--letter-spacing"], "-0.02em");
  assert.equal(vars["--text-h1--font-weight"], "700");
  assert.equal(vars["--spacing"], "4px");
  assert.equal(vars["--radius-xs"], "6px");
  assert.equal(vars["--shadow-1"], "0 1px 2px rgba(0, 0, 0, 0.08)");
  assert.equal(vars["--breakpoint-md"], "768px");
  assert.equal(vars["--container-site"], "1280px");
  assert.equal(vars["--animate-fade-in"], "fade-in 400ms ease-out both");
  assert.ok(css.includes(":root {\n  --duration-instant: 150ms;\n}"));
}

/* ---------------- WordPress theme.json ---------------- */
{
  const out = toWordPressThemeJson(normalized);
  assert.equal(out.path, "wordpress/theme.json");
  const doc = JSON.parse(out.content);
  assert.equal(doc.version, 3);
  assert.equal(doc.$schema, "https://schemas.wp.org/trunk/theme.json");
  for (const entry of doc.settings.color.palette) assert.deepEqual(Object.keys(entry), ["name", "slug", "color"]);
  assert.deepEqual(doc.settings.color.palette.find((p) => p.slug === "brand-primary"), { name: "Brand Primary", slug: "brand-primary", color: "#2563eb" });
  assert.deepEqual(doc.settings.typography.fontFamilies, [{ name: "Inter", slug: "inter", fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif' }]);
  assert.deepEqual(doc.settings.typography.fontSizes.find((s) => s.slug === "h1"), { name: "Heading H1", slug: "h1", size: "48px" });
  assert.deepEqual(doc.settings.spacing.spacingSizes.map((s) => s.size), ["8px", "12px", "16px"]);
  assert.deepEqual(doc.settings.shadow.presets, [{ name: "Elevation 1", slug: "elevation-1", shadow: "0 1px 2px rgba(0, 0, 0, 0.08)" }]);
  assert.equal(doc.settings.shadow.defaultPresets, false);
  assert.equal(doc.settings.layout.wideSize, "1280px");
  assert.equal(doc.styles.color.background, "var(--wp--preset--color--surface-base)");
  assert.equal(doc.styles.elements.h1.typography.fontSize, "var(--wp--preset--font-size--h1)");
  assert.equal(doc.styles.elements.button.color.background, "var(--wp--preset--color--brand-primary)");
  assert.equal(doc.styles.elements.button.border.radius, "8px");
  assert.deepEqual(doc.styles.elements.button.spacing.padding, { top: "12px", right: "24px", bottom: "12px", left: "24px" });
}

/* ---------------- Storybook ---------------- */
{
  const out = toStorybook(normalized);
  assert.equal(out.files.length, 2);
  const [mdx, stories] = out.files;
  assert.equal(mdx.path, "storybook/Tokens.mdx");
  assert.equal(out.path, mdx.path);
  assert.ok(mdx.content.includes('import { Meta, ColorPalette, ColorItem, Typeset } from "@storybook/addon-docs/blocks";'));
  assert.ok(mdx.content.includes('<ColorItem title="brand" subtitle="color.brand.*" colors={{"primary":"#2563eb"}} />'));
  assert.ok(mdx.content.includes("fontSizes={[14,16,20,32,48]}"));
  assertBalanced(mdx.content.replace(/^#.*$/gm, ""), "mdx");
  assert.equal(stories.path, "storybook/tokens.stories.js");
  const mod = await import(`data:text/javascript;base64,${Buffer.from(stories.content).toString("base64")}`);
  assert.equal(mod.default.title, "Design Tokens/Stories");
  // Render every story against a minimal DOM stub: proves the CSF3 objects run.
  const make = () => ({ style: {}, children: [], textContent: "", append(...nodes) { this.children.push(...nodes); } });
  globalThis.document = { createElement: make };
  try {
    assert.equal(mod.Palette.render().children.length, 7);
    const type = mod.TypeScale.render();
    assert.deepEqual(type.children.map((n) => n.style.fontSize), ["14px", "16px", "20px", "48px", "32px"]);
    assert.equal(mod.Spacing.render().children.length, 3);
    assert.equal(mod.RadiusAndShadow.render().children[2].style.boxShadow, "0 1px 2px rgba(0, 0, 0, 0.08)");
  } finally {
    delete globalThis.document;
  }
}

/* ---------------- Motion presets ---------------- */
{
  const out = toFramerMotion(normalized);
  assert.equal(out.path, "motion/motion.js");
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.content).toString("base64")}`);
  assert.deepEqual(mod.durations, { instant: 0.15 });
  assert.deepEqual(mod.easings.standard, [0.42, 0, 0.58, 1]);
  assert.deepEqual(mod.easings.power2Out, [0.33, 1, 0.68, 1], "GSAP ease from the page mapped to a bezier");
  assert.deepEqual(mod.transitions.base, { duration: 0.15, ease: [0.42, 0, 0.58, 1] });
  assert.deepEqual(mod.variants.slideUp.hidden, { opacity: 0, y: 16 });
  assert.deepEqual(mod.keyframeVariants.fadeIn.animate, { opacity: [0, 1], transition: { duration: 0.4, ease: [0, 0, 0.58, 1] } });
  assert.deepEqual(mod.keyframeVariants.slideUp.animate.y, [16, 0]);
  assert.deepEqual(mod.reducedMotionTransition, { duration: 0 });
  assert.ok(out.content.includes("[0.42, 0, 0.58, 1]"), "bezier arrays stay on one line");
}

/* ---------------- Agent rules ---------------- */
{
  const out = toAgentRules(normalized);
  assert.equal(out.path, "AGENT_RULES.md");
  const c = out.content;
  assert.ok(c.includes("- `color.brand.primary`: #2563eb"));
  assert.ok(c.includes("brand actions use #2563eb with #ffffff text (contrast 5.17:1)"));
  assert.ok(c.includes("- h1: 48px/56px, weight 700, letter-spacing -0.02em"));
  assert.ok(c.includes("- Spacing steps: 8px, 12px, 16px (4px grid; never use off-grid values)"));
  assert.ok(c.includes("- Secondary button: background transparent, text #2563eb, border 1px solid #2563eb."));
  assert.ok(c.includes("- Breakpoints (min-width): 640px, 768px, 1024px"));
}

/* ---------------- aggregate + edge cases ---------------- */
{
  const all = allPlatformExports(normalized);
  assert.deepEqual(all.map((f) => f.path), [
    "ios/DesignTokens.swift", "android/Theme.kt", "flutter/app_theme.dart", "tailwind/theme.css",
    "storybook/Tokens.mdx", "storybook/tokens.stories.js", "wordpress/theme.json", "motion/motion.js", "AGENT_RULES.md"
  ]);
  for (const f of all) assert.ok(f.content.length > 100, `${f.path} is empty`);
  assert.ok(all.every((f) => !/undefined|NaN|\[object Object\]/.test(f.content)), "no leaked undefined/NaN");

  // Dark canvas → dark Material schemes.
  const dark = structuredClone(normalized);
  dark.colorPalette = dark.colorPalette.map((row) =>
    row.token === "color.surface.base" ? { ...row, value: "#0b0b0c" } : row.token === "color.text.primary" ? { ...row, value: "#f5f5f5" } : row
  );
  assert.ok(toCompose(dark).content.includes("val AppColorScheme = darkColorScheme("));
  assert.ok(toFlutter(dark).content.includes("brightness: Brightness.dark"));

  // An empty extraction must still produce syntactically sane files.
  for (const f of allPlatformExports({})) {
    assert.ok(f.content.length > 0, `${f.path} empty for {}`);
    if (f.path.endsWith(".json")) JSON.parse(f.content);
    if (/\.(swift|kt|dart|css)$/.test(f.path)) assertBalanced(f.content, `${f.path} ({})`);
  }
}

console.log("Platform exports tests passed.");
