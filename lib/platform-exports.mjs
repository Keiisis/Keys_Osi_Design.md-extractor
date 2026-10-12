/**
 * Platform exports built from the `normalized` object returned by
 * normalizeExtractedStyles(). Every exporter returns `{ path, content }`
 * (Storybook also lists both of its files in `files`).
 *
 * Syntax follows the official references:
 *  - SwiftUI Color(_:red:green:blue:opacity:) / Font.custom(_:size:relativeTo:)
 *    https://developer.apple.com/documentation/swiftui/color
 *    https://developer.apple.com/documentation/swiftui/font/custom(_:size:relativeto:)
 *  - Compose Material3 lightColorScheme / Typography / Shapes / MaterialTheme
 *    https://developer.android.com/reference/kotlin/androidx/compose/material3/package-summary
 *  - Flutter ThemeData / ColorScheme
 *    https://api.flutter.dev/flutter/material/ThemeData/ThemeData.html
 *    https://api.flutter.dev/flutter/material/ColorScheme/ColorScheme.html
 *  - Tailwind v4 @theme namespaces
 *    https://tailwindcss.com/docs/theme  https://tailwindcss.com/docs/font-size
 *  - WordPress theme.json v3
 *    https://developer.wordpress.org/block-editor/reference-guides/theme-json-reference/theme-json-living/
 *  - Storybook CSF3 + doc blocks (ColorPalette, Typeset)
 *    https://storybook.js.org/docs/api/csf
 *    https://storybook.js.org/docs/api/doc-blocks/doc-block-colorpalette
 *  - Motion (Framer Motion) transitions
 *    https://motion.dev/docs/react-transitions
 */

/* ------------------------------------------------------------------ *
 * Token reading (shared)
 * ------------------------------------------------------------------ */

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "-apple-system", "blinkmacsystemfont"]);

/** Removes the " (var(--x))" annotation added during normalization. */
function rawValue(value) {
  return String(value || "").replace(/\s*\(var\(--[^)]*\)\)\s*$/, "").trim();
}
const px = (value) => {
  const m = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(rawValue(value));
  return m ? Number(m[1]) : null;
};
const ms = (value) => {
  const m = /^(-?\d+(?:\.\d+)?)(ms|s)$/.exec(rawValue(value));
  return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : null;
};
const tail = (token, prefix) => String(token || "").replace(new RegExp(`^${prefix.replace(/\./g, "\\.")}\\.`), "");
const camel = (text) => String(text).replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^[A-Z]/, (c) => c.toLowerCase());
const pascal = (text) => camel(text).replace(/^[a-z]/, (c) => c.toUpperCase());
const kebab = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
// Identifiers may not start with a digit in Swift/Kotlin/Dart/JS.
const ident = (name) => (/^[0-9]/.test(name) ? `n${name}` : name);
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
// Pretty JSON with short scalar arrays kept on one line (bezier curves, keyframes).
const json = (value) => JSON.stringify(value, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.split(/,\s*/).join(", ")}]`);

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}
function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Readable foreground for a fill: measured text colors first, then black/white. */
function onColor(fill, candidates = []) {
  const options = [...candidates.filter(Boolean), "#ffffff", "#000000"];
  return options.find((c) => contrast(fill, c) >= 4.5) || (contrast(fill, "#ffffff") >= contrast(fill, "#000000") ? "#ffffff" : "#000000");
}

/** "0 1px 2px rgba(0, 0, 0, 0.08)" → { x, y, blur, spread, hex, alpha } (first outer layer). */
function parseShadow(value) {
  const layers = rawValue(value).split(/,(?![^(]*\))/).map((s) => s.trim()).filter((s) => !/^inset\b|\binset$/.test(s));
  const layer = layers[0];
  if (!layer) return null;
  const colorMatch = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(layer);
  const lengths = layer.replace(colorMatch ? colorMatch[0] : "", "").trim().split(/\s+/).map((t) => parseFloat(t)).filter((n) => Number.isFinite(n));
  if (lengths.length < 2) return null;
  let hex = "#000000";
  let alpha = 1;
  if (colorMatch) {
    const rgba = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i.exec(colorMatch[0]);
    if (rgba) {
      hex = `#${[rgba[1], rgba[2], rgba[3]].map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("")}`;
      alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    } else {
      hex = colorMatch[0].slice(0, 7).toLowerCase();
    }
  }
  return { x: lengths[0], y: lengths[1], blur: lengths[2] || 0, spread: lengths[3] || 0, hex, alpha };
}

const BEZIER = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1]
};
function bezierOf(easing) {
  const text = rawValue(easing).trim();
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i.exec(text);
  if (m) return [+m[1], +m[2], +m[3], +m[4]];
  return BEZIER[text] || null;
}

/** Quotes multi-word family names for CSS/JSON stacks. */
function cssFontStack(stack) {
  return String(stack || "")
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .map((name) => (GENERIC_FAMILIES.has(name.toLowerCase()) || !/\s/.test(name) ? name : `"${name}"`))
    .join(", ");
}

const SIZE_ORDER = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];

/** One flat, platform-neutral view of the tokens every exporter reads. */
export function readTokens(normalized = {}) {
  const colors = (normalized.colorPalette || [])
    .map((row) => ({ token: row.token, path: tail(row.token, "color"), hex: rawValue(row.value).toLowerCase() }))
    .filter((c) => /^#[0-9a-f]{6}$/.test(c.hex));
  const byPath = Object.fromEntries(colors.map((c) => [c.path, c.hex]));
  const font = normalized.mainFontStyle || {};
  const family = font.primaryFamily || (font.familyStack || "").split(",")[0].replace(/["']/g, "").trim();
  const typeScale = (normalized.typographyScale || [])
    .map((row) => ({ name: tail(row.token, "font.size"), px: px(row.value) }))
    .filter((t) => t.px !== null);
  const headings = (normalized.headings || []).map((h) => ({
    level: h.level,
    px: px(h.fontSize),
    lineHeight: px(h.lineHeight),
    weight: Number(h.fontWeight) || 400,
    letterSpacing: h.letterSpacing,
    transform: h.textTransform
  })).filter((h) => h.px !== null);
  const spacing = (normalized.spacingScale || []).map((row) => px(row.value)).filter((v) => v !== null);
  const radii = (normalized.radiusTokens || []).map((row) => ({ name: tail(row.token, "radius"), px: px(row.value) })).filter((r) => r.px !== null);
  const shadows = (normalized.shadowTokens || []).map((row, i) => ({ name: `${i + 1}`, value: rawValue(row.value), parsed: parseShadow(row.value) }));
  const durations = (normalized.motionDurationTokens || []).map((row) => ({ name: tail(row.token, "motion.duration"), ms: ms(row.value) })).filter((d) => d.ms !== null);
  const easings = (normalized.motionEasingTokens || []).map((row, i) => ({ name: `${i + 1}`, value: rawValue(row.value), bezier: bezierOf(row.value) }));
  const button = (normalized.buttonVariants || [])[0]?.spec || null;
  return {
    source: normalized.source?.url || "unknown URL",
    sampledAt: normalized.sampledAt || "",
    colors,
    byPath,
    family,
    familyStack: font.familyStack || "",
    body: { px: px(font.size) || 16, lineHeight: px(font.lineHeight), weight: Number(font.weight) || 400 },
    typeScale,
    headings,
    spacing,
    baseGrid: gridOf(spacing),
    radii,
    shadows,
    durations,
    easings,
    gradients: (normalized.gradientTokens || []).map((row, i) => ({ name: `${i + 1}`, value: rawValue(row.value) })),
    keyframes: normalized.keyframes || [],
    runtimeAnimations: normalized.runtimeAnimations || [],
    breakpoints: (normalized.breakpoints || []).map((b) => b.px).filter(Number.isFinite).sort((a, b) => a - b),
    container: px(normalized.layout?.containerMaxWidth),
    button,
    formControl: normalized.formControl || null,
    link: normalized.linkSpec || null
  };
}

function gridOf(values) {
  const ints = values.filter((v) => Number.isInteger(v) && v > 0);
  if (!ints.length) return 0;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = ints.reduce(gcd);
  return g >= 2 ? g : 0;
}

/** Semantic roles mapped once, reused by the native themes. */
function roles(t) {
  const c = t.byPath;
  const surface = c["surface.base"] || "#ffffff";
  const text = c["text.primary"] || (luminance(surface) < 0.4 ? "#ffffff" : "#111111");
  const primary = c["brand.primary"] || text;
  const secondary = c["brand.secondary"] || c["text.secondary"] || primary;
  return {
    dark: luminance(surface) < 0.4,
    primary,
    onPrimary: onColor(primary, [t.button && /^#/.test(t.button.color || "") ? t.button.color : "", surface, text]),
    secondary,
    onSecondary: onColor(secondary, [surface, text]),
    surface,
    onSurface: text,
    surfaceVariant: c["surface.muted"] || c["surface.raised"] || null,
    onSurfaceVariant: c["text.secondary"] || c["text.muted"] || null,
    outline: c["border.default"] || null,
    outlineVariant: c["border.muted"] || c["border.default"] || null,
    inverseSurface: c["surface.inverse"] || null,
    inverseOnSurface: c["text.inverse"] || (c["surface.inverse"] ? surface : null),
    focus: c["focus.ring"] || null
  };
}

const header = (t, comment) => `${comment} Keys_Osi design tokens — ${t.source}${t.sampledAt ? ` (${t.sampledAt})` : ""}`;
const hexUpper = (hex) => hex.replace("#", "").toUpperCase();

/** Headings + body mapped to the Material 3 type roles. */
function materialTypeRoles(t) {
  const roleFor = { h1: "headlineLarge", h2: "headlineMedium", h3: "headlineSmall", h4: "titleLarge", h5: "titleMedium", h6: "titleSmall" };
  const out = [];
  const h1 = t.headings.find((h) => h.level === "h1");
  const biggest = Math.max(0, ...t.typeScale.map((s) => s.px));
  if (h1 && biggest > h1.px) out.push({ role: "displayLarge", px: biggest, lineHeight: null, weight: h1.weight, letterSpacing: h1.letterSpacing });
  for (const h of t.headings) if (roleFor[h.level]) out.push({ role: roleFor[h.level], ...h });
  out.push({ role: "bodyLarge", px: t.body.px, lineHeight: t.body.lineHeight, weight: t.body.weight, letterSpacing: "normal" });
  const smaller = t.typeScale.filter((s) => s.px < t.body.px).sort((a, b) => b.px - a.px);
  if (smaller[0]) out.push({ role: "bodyMedium", px: smaller[0].px, lineHeight: null, weight: t.body.weight, letterSpacing: "normal" });
  if (smaller[1]) out.push({ role: "bodySmall", px: smaller[1].px, lineHeight: null, weight: t.body.weight, letterSpacing: "normal" });
  if (t.button) {
    const bpx = px(t.button.fontSize);
    if (bpx) out.push({ role: "labelLarge", px: bpx, lineHeight: null, weight: Number(t.button.fontWeight) || 500, letterSpacing: "normal" });
  }
  // One entry per role: the first (most specific) wins.
  return out.filter((r, i, all) => all.findIndex((x) => x.role === r.role) === i);
}
/** CSS letter-spacing → em number (0 for normal/unknown). */
function letterSpacingEm(value, fontPx) {
  const text = String(value || "").trim();
  if (/em$/.test(text)) return parseFloat(text) || 0;
  if (/px$/.test(text) && fontPx) return round(parseFloat(text) / fontPx, 4);
  return 0;
}

/* ------------------------------------------------------------------ *
 * SwiftUI
 * ------------------------------------------------------------------ */

const SWIFT_WEIGHT = { 100: "thin", 200: "ultraLight", 300: "light", 400: "regular", 500: "medium", 600: "semibold", 700: "bold", 800: "heavy", 900: "black" };
const swiftWeight = (w) => SWIFT_WEIGHT[Math.min(900, Math.max(100, Math.round((Number(w) || 400) / 100) * 100))];
function swiftTextStyle(size) {
  if (size >= 34) return "largeTitle";
  if (size >= 28) return "title";
  if (size >= 22) return "title2";
  if (size >= 20) return "title3";
  if (size >= 17) return "body";
  if (size >= 16) return "callout";
  if (size >= 15) return "subheadline";
  if (size >= 13) return "footnote";
  if (size >= 12) return "caption";
  return "caption2";
}
const swiftNum = (n) => (Number.isInteger(n) ? `${n}` : `${round(n)}`);

export function toSwiftUI(normalized) {
  const t = readTokens(normalized);
  const family = t.family || "System";
  const lines = [header(t, "//"), "// Font.custom needs the font's PostScript name and the font bundled in the app (Info.plist UIAppFonts).", "import SwiftUI", ""];
  lines.push("extension Color {");
  lines.push("  /// sRGB color from a 0xRRGGBB literal.");
  lines.push("  init(rgbHex: UInt32, opacity: Double = 1) {");
  lines.push("    self.init(");
  lines.push("      .sRGB,");
  lines.push("      red: Double((rgbHex >> 16) & 0xFF) / 255,");
  lines.push("      green: Double((rgbHex >> 8) & 0xFF) / 255,");
  lines.push("      blue: Double(rgbHex & 0xFF) / 255,");
  lines.push("      opacity: opacity");
  lines.push("    )");
  lines.push("  }");
  lines.push("");
  for (const c of t.colors) lines.push(`  static let ${ident(camel(c.path))} = Color(rgbHex: 0x${hexUpper(c.hex)}) // ${c.token}`);
  lines.push("}", "");

  lines.push("extension Font {");
  const fontLine = (name, size, weight) =>
    `  static let ${name} = Font.custom("${family}", size: ${swiftNum(size)}, relativeTo: .${swiftTextStyle(size)}).weight(.${swiftWeight(weight)})`;
  lines.push(fontLine("bodyText", t.body.px, t.body.weight));
  for (const s of t.typeScale) lines.push(fontLine(ident(camel(`text-${s.name}`)), s.px, t.body.weight));
  for (const h of t.headings) lines.push(fontLine(camel(`heading-${h.level}`), h.px, h.weight));
  lines.push("}", "");

  if (t.spacing.length) {
    lines.push("enum Spacing {");
    t.spacing.forEach((v, i) => lines.push(`  static let s${i + 1}: CGFloat = ${swiftNum(v)}`));
    lines.push("}", "");
  }
  if (t.radii.length) {
    lines.push("enum Radius {");
    for (const r of t.radii) lines.push(`  static let ${ident(camel(r.name))}: CGFloat = ${swiftNum(r.px)}`);
    lines.push("}", "");
  }
  if (t.durations.length || t.easings.length) {
    lines.push("enum Motion {");
    for (const d of t.durations) lines.push(`  static let ${ident(camel(d.name))}: Double = ${swiftNum(d.ms / 1000)} // ${d.ms}ms`);
    const base = (t.durations[0]?.ms || 250) / 1000;
    t.easings.forEach((e, i) => {
      if (e.bezier) lines.push(`  static let curve${i + 1} = Animation.timingCurve(${e.bezier.join(", ")}, duration: ${swiftNum(base)}) // ${e.value}`);
    });
    lines.push("}", "");
  }
  const shadows = t.shadows.filter((s) => s.parsed);
  if (shadows.length) {
    lines.push("extension View {");
    shadows.forEach((s, i) => {
      const p = s.parsed;
      // CSS blur is twice SwiftUI's radius (Gaussian sigma vs. blur extent).
      lines.push(`  /// ${s.value}`);
      lines.push(`  func elevation${i + 1}() -> some View {`);
      lines.push(`    shadow(color: Color(rgbHex: 0x${hexUpper(p.hex)}, opacity: ${swiftNum(p.alpha)}), radius: ${swiftNum(p.blur / 2)}, x: ${swiftNum(p.x)}, y: ${swiftNum(p.y)})`);
      lines.push("  }");
    });
    lines.push("}", "");
  }
  return { path: "ios/DesignTokens.swift", content: lines.join("\n") };
}

/* ------------------------------------------------------------------ *
 * Jetpack Compose (Material 3)
 * ------------------------------------------------------------------ */

const kNum = (n) => (Number.isInteger(n) ? `${n}` : `${round(n)}f`);
const kColor = (hex) => `Color(0xFF${hexUpper(hex)})`;

export function toCompose(normalized) {
  const t = readTokens(normalized);
  const r = roles(t);
  const lines = [header(t, "//"), "package com.example.designsystem", ""];
  const imports = [
    "androidx.compose.foundation.shape.RoundedCornerShape",
    "androidx.compose.material3.MaterialTheme",
    "androidx.compose.material3.Shapes",
    "androidx.compose.material3.Typography",
    `androidx.compose.material3.${r.dark ? "darkColorScheme" : "lightColorScheme"}`,
    "androidx.compose.runtime.Composable",
    "androidx.compose.ui.graphics.Color",
    "androidx.compose.ui.text.TextStyle",
    "androidx.compose.ui.text.font.FontFamily",
    "androidx.compose.ui.text.font.FontWeight",
    "androidx.compose.ui.unit.dp",
    "androidx.compose.ui.unit.em",
    "androidx.compose.ui.unit.sp"
  ];
  lines.push(...imports.map((i) => `import ${i}`), "");

  lines.push("object Palette {");
  for (const c of t.colors) lines.push(`    val ${ident(pascal(c.path))} = ${kColor(c.hex)} // ${c.token}`);
  lines.push("}", "");

  const scheme = [
    ["primary", r.primary], ["onPrimary", r.onPrimary], ["secondary", r.secondary], ["onSecondary", r.onSecondary],
    ["background", r.surface], ["onBackground", r.onSurface], ["surface", r.surface], ["onSurface", r.onSurface],
    ["surfaceVariant", r.surfaceVariant], ["onSurfaceVariant", r.onSurfaceVariant], ["outline", r.outline],
    ["outlineVariant", r.outlineVariant], ["inverseSurface", r.inverseSurface], ["inverseOnSurface", r.inverseOnSurface]
  ].filter(([, v]) => v);
  lines.push(`val AppColorScheme = ${r.dark ? "darkColorScheme" : "lightColorScheme"}(`);
  lines.push(scheme.map(([k, v]) => `    ${k} = ${kColor(v)}`).join(",\n"));
  lines.push(")", "");

  lines.push(`// Measured family: "${t.family || "system"}". Bundle it in res/font and replace with`);
  lines.push(`// FontFamily(Font(R.font.${kebab(t.family || "brand").replace(/-/g, "_")}_regular, FontWeight.Normal), ...).`);
  lines.push("val AppFontFamily = FontFamily.SansSerif", "");
  lines.push("val AppTypography = Typography(");
  const typeRoles = materialTypeRoles(t);
  lines.push(typeRoles.map((role) => {
    const parts = [`fontFamily = AppFontFamily`, `fontWeight = FontWeight(${role.weight})`, `fontSize = ${kNum(role.px)}.sp`];
    if (role.lineHeight) parts.push(`lineHeight = ${kNum(role.lineHeight)}.sp`);
    const em = letterSpacingEm(role.letterSpacing, role.px);
    if (em) parts.push(`letterSpacing = (${em}).em`);
    return `    ${role.role} = TextStyle(${parts.join(", ")})`;
  }).join(",\n"));
  lines.push(")", "");

  const shapeRoles = ["extraSmall", "small", "medium", "large", "extraLarge"];
  const radii = [...new Set(t.radii.map((x) => x.px))].sort((a, b) => a - b);
  if (radii.length) {
    lines.push("val AppShapes = Shapes(");
    lines.push(shapeRoles.slice(0, radii.length).map((role, i) => `    ${role} = RoundedCornerShape(${kNum(radii[i])}.dp)`).join(",\n"));
    lines.push(")", "");
  }
  if (t.spacing.length) {
    lines.push("object Spacing {");
    t.spacing.forEach((v, i) => lines.push(`    val S${i + 1} = ${kNum(v)}.dp`));
    lines.push("}", "");
  }
  lines.push("@Composable");
  lines.push("fun AppTheme(content: @Composable () -> Unit) {");
  lines.push("    MaterialTheme(");
  lines.push("        colorScheme = AppColorScheme,");
  lines.push("        typography = AppTypography,");
  if (radii.length) lines.push("        shapes = AppShapes,");
  lines.push("        content = content");
  lines.push("    )");
  lines.push("}", "");
  return { path: "android/Theme.kt", content: lines.join("\n") };
}

/* ------------------------------------------------------------------ *
 * Flutter
 * ------------------------------------------------------------------ */

const dNum = (n) => (Number.isInteger(n) ? `${n}` : `${round(n)}`);
const dColor = (hex) => `Color(0xFF${hexUpper(hex)})`;
const dWeight = (w) => `FontWeight.w${Math.min(900, Math.max(100, Math.round((Number(w) || 400) / 100) * 100))}`;
const DART_TEXT_ROLES = new Set(["displayLarge", "headlineLarge", "headlineMedium", "headlineSmall", "titleLarge", "titleMedium", "titleSmall", "bodyLarge", "bodyMedium", "bodySmall", "labelLarge"]);

export function toFlutter(normalized) {
  const t = readTokens(normalized);
  const r = roles(t);
  const lines = [header(t, "//"), "import 'package:flutter/material.dart';", ""];
  lines.push("class AppColors {", "  AppColors._();", "");
  for (const c of t.colors) lines.push(`  static const Color ${ident(camel(c.path))} = ${dColor(c.hex)}; // ${c.token}`);
  lines.push("}", "");
  if (t.spacing.length) {
    lines.push("class AppSpacing {", "  AppSpacing._();", "");
    t.spacing.forEach((v, i) => lines.push(`  static const double s${i + 1} = ${dNum(v)};`));
    lines.push("}", "");
  }
  if (t.radii.length) {
    lines.push("class AppRadius {", "  AppRadius._();", "");
    for (const x of t.radii) lines.push(`  static const double ${ident(camel(x.name))} = ${dNum(x.px)};`);
    lines.push("}", "");
  }
  lines.push(`// Measured family "${t.family || "system"}": declare it under flutter/fonts in pubspec.yaml.`);
  lines.push(`const String appFontFamily = '${(t.family || "Roboto").replace(/'/g, "\\'")}';`, "");

  const textStyle = (role) => {
    const parts = [`fontSize: ${dNum(role.px)}`, `fontWeight: ${dWeight(role.weight)}`];
    if (role.lineHeight) parts.push(`height: ${dNum(round(role.lineHeight / role.px))}`);
    const em = letterSpacingEm(role.letterSpacing, role.px);
    // Flutter letterSpacing is in logical pixels, not em.
    if (em) parts.push(`letterSpacing: ${dNum(round(em * role.px))}`);
    return `TextStyle(${parts.join(", ")})`;
  };
  const scheme = [
    ["brightness", r.dark ? "Brightness.dark" : "Brightness.light"],
    ["primary", dColor(r.primary)], ["onPrimary", dColor(r.onPrimary)],
    ["secondary", dColor(r.secondary)], ["onSecondary", dColor(r.onSecondary)],
    // Error colors were not measured on the page: Material 3 baseline values.
    ["error", "Color(0xFFB3261E)"], ["onError", "Color(0xFFFFFFFF)"],
    ["surface", dColor(r.surface)], ["onSurface", dColor(r.onSurface)],
    ...(r.surfaceVariant ? [["surfaceContainerHighest", dColor(r.surfaceVariant)]] : []),
    ...(r.onSurfaceVariant ? [["onSurfaceVariant", dColor(r.onSurfaceVariant)]] : []),
    ...(r.outline ? [["outline", dColor(r.outline)]] : []),
    ...(r.outlineVariant ? [["outlineVariant", dColor(r.outlineVariant)]] : []),
    ...(r.inverseSurface ? [["inverseSurface", dColor(r.inverseSurface)]] : []),
    ...(r.inverseOnSurface ? [["onInverseSurface", dColor(r.inverseOnSurface)]] : [])
  ];
  lines.push("final ThemeData appTheme = ThemeData(");
  lines.push("  useMaterial3: true,");
  lines.push("  fontFamily: appFontFamily,");
  lines.push("  colorScheme: const ColorScheme(");
  lines.push(scheme.map(([k, v]) => `    ${k}: ${v},`).join("\n"));
  lines.push("  ),");
  lines.push(`  scaffoldBackgroundColor: ${dColor(r.surface)},`);
  if (r.outline) lines.push(`  dividerColor: ${dColor(r.outline)},`);
  lines.push("  textTheme: const TextTheme(");
  lines.push(materialTypeRoles(t).filter((x) => DART_TEXT_ROLES.has(x.role)).map((x) => `    ${x.role}: ${textStyle(x)},`).join("\n"));
  lines.push("  ),");
  if (t.button) {
    const b = t.button;
    const pad = String(b.padding || "").split(/\s+/).map((v) => px(v)).filter((v) => v !== null);
    const [pt, pr, pb, pl] = pad.length === 4 ? pad : pad.length === 2 ? [pad[0], pad[1], pad[0], pad[1]] : [12, 24, 12, 24];
    const bg = /^#[0-9a-f]{6}$/i.test(b.background || "") ? b.background : r.primary;
    const fg = /^#[0-9a-f]{6}$/i.test(b.color || "") ? b.color : r.onPrimary;
    lines.push("  elevatedButtonTheme: ElevatedButtonThemeData(");
    lines.push("    style: ElevatedButton.styleFrom(");
    lines.push(`      backgroundColor: ${dColor(bg)},`);
    lines.push(`      foregroundColor: ${dColor(fg)},`);
    lines.push(`      padding: const EdgeInsets.fromLTRB(${dNum(pl)}, ${dNum(pt)}, ${dNum(pr)}, ${dNum(pb)}),`);
    lines.push(`      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(${dNum(px(b.borderRadius) ?? 8)})),`);
    lines.push(`      textStyle: const TextStyle(fontSize: ${dNum(px(b.fontSize) ?? 16)}, fontWeight: ${dWeight(b.fontWeight)}),`);
    lines.push("    ),");
    lines.push("  ),");
  }
  if (t.formControl) {
    const f = t.formControl;
    const borderHex = (/#[0-9a-f]{6}/i.exec(f.border || "") || [])[0] || r.outline || "#d1d5db";
    const pad = String(f.padding || "").split(/\s+/).map((v) => px(v)).filter((v) => v !== null);
    const [pt, pr, pb, pl] = pad.length === 4 ? pad : [8, 12, 8, 12];
    const radius = px(f.borderRadius) ?? 6;
    lines.push("  inputDecorationTheme: InputDecorationTheme(");
    if (/^#[0-9a-f]{6}$/i.test(f.background || "")) lines.push(`    filled: true,\n    fillColor: ${dColor(f.background)},`);
    lines.push(`    contentPadding: const EdgeInsets.fromLTRB(${dNum(pl)}, ${dNum(pt)}, ${dNum(pr)}, ${dNum(pb)}),`);
    lines.push(`    border: OutlineInputBorder(borderRadius: BorderRadius.circular(${dNum(radius)}), borderSide: const BorderSide(color: ${dColor(borderHex)})),`);
    lines.push(`    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(${dNum(radius)}), borderSide: const BorderSide(color: ${dColor(borderHex)})),`);
    if (r.focus) lines.push(`    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(${dNum(radius)}), borderSide: const BorderSide(color: ${dColor(r.focus)}, width: 2)),`);
    lines.push("  ),");
  }
  lines.push(");", "");
  return { path: "flutter/app_theme.dart", content: lines.join("\n") };
}

/* ------------------------------------------------------------------ *
 * Tailwind v4 (@theme)
 * ------------------------------------------------------------------ */

export function toTailwindV4(normalized) {
  const t = readTokens(normalized);
  const theme = [];
  for (const c of t.colors) theme.push(`  --color-${kebab(c.path)}: ${c.hex};`);
  if (t.familyStack) theme.push(`  --font-sans: ${cssFontStack(t.familyStack)};`);
  for (const s of t.typeScale) theme.push(`  --text-${s.name}: ${s.px}px;`);
  for (const h of t.headings) {
    theme.push(`  --text-${h.level}: ${h.px}px;`);
    if (h.lineHeight) theme.push(`  --text-${h.level}--line-height: ${h.lineHeight}px;`);
    if (h.letterSpacing && h.letterSpacing !== "normal") theme.push(`  --text-${h.level}--letter-spacing: ${h.letterSpacing};`);
    theme.push(`  --text-${h.level}--font-weight: ${h.weight};`);
  }
  if (t.baseGrid) {
    // Numeric utilities multiply this base: p-2 = 2 × base.
    theme.push(`  --spacing: ${t.baseGrid}px; /* measured steps: ${t.spacing.map((v) => `${v}px = p-${round(v / t.baseGrid, 2)}`).join(", ")} */`);
  }
  for (const r of t.radii) theme.push(`  --radius-${r.name}: ${r.px}px;`);
  for (const s of t.shadows) theme.push(`  --shadow-${s.name}: ${s.value};`);
  for (const e of t.easings) theme.push(`  --ease-${e.name}: ${e.bezier && !BEZIER[e.value] ? `cubic-bezier(${e.bezier.join(", ")})` : e.value};`);
  const bpNames = ["sm", "md", "lg", "xl", "2xl"];
  t.breakpoints.forEach((b, i) => theme.push(`  --breakpoint-${bpNames[i] || `bp${i + 1}`}: ${b}px;`));
  if (t.container) theme.push(`  --container-site: ${t.container}px;`);

  // @keyframes declared inside @theme are emitted with their --animate-*.
  const animations = [];
  for (const k of t.keyframes) {
    if (!/^[a-z][\w-]*$/i.test(k.name || "") || !Array.isArray(k.steps) || !k.steps.length) continue;
    const runtime = t.runtimeAnimations.find((a) => a.name === k.name);
    const duration = runtime?.duration || t.durations[0]?.ms || 300;
    const easing = runtime?.easing || t.easings[0]?.value || "ease";
    theme.push(`  --animate-${k.name}: ${k.name} ${duration}ms ${easing} both;`);
    animations.push(`  @keyframes ${k.name} {`, ...k.steps.map((s) => `    ${String(s).trim()}`), "  }");
  }
  const lines = [`/*${header(t, "")} */`, '@import "tailwindcss";', "", "@theme {", ...theme, ...(animations.length ? ["", ...animations] : []), "}", ""];
  if (t.durations.length) {
    // Tailwind v4 has no duration namespace: plain variables, used as duration-(--duration-fast).
    lines.push(":root {", ...t.durations.map((d) => `  --duration-${d.name}: ${d.ms}ms;`), "}", "");
  }
  return { path: "tailwind/theme.css", content: lines.join("\n") };
}

/* ------------------------------------------------------------------ *
 * WordPress theme.json v3
 * ------------------------------------------------------------------ */

const titleCase = (text) => kebab(text).split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export function toWordPressThemeJson(normalized) {
  const t = readTokens(normalized);
  const r = roles(t);
  const familySlug = kebab(t.family || "primary") || "primary";
  const settings = {
    appearanceTools: true,
    color: {
      defaultPalette: false,
      defaultGradients: false,
      palette: t.colors.map((c) => ({ name: titleCase(c.path), slug: kebab(c.path), color: c.hex }))
    },
    typography: {
      defaultFontSizes: false,
      fontFamilies: t.familyStack ? [{ name: t.family, slug: familySlug, fontFamily: cssFontStack(t.familyStack) }] : [],
      fontSizes: [
        ...t.typeScale.map((s) => ({ name: s.name.toUpperCase(), slug: s.name, size: `${s.px}px` })),
        ...t.headings.map((h) => ({ name: `Heading ${h.level.toUpperCase()}`, slug: h.level, size: `${h.px}px` }))
      ]
    },
    spacing: {
      defaultSpacingSizes: false,
      units: ["px", "rem", "%", "vw", "vh"],
      spacingSizes: t.spacing.map((v, i) => ({ name: `Step ${i + 1}`, slug: `${(i + 1) * 10}`, size: `${v}px` }))
    },
    shadow: {
      defaultPresets: false,
      presets: t.shadows.map((s) => ({ name: `Elevation ${s.name}`, slug: `elevation-${s.name}`, shadow: s.value }))
    }
  };
  if (t.gradients.length) settings.color.gradients = t.gradients.map((g) => ({ name: `Gradient ${g.name}`, slug: `gradient-${g.name}`, gradient: g.value }));
  if (t.container) settings.layout = { contentSize: `${Math.min(t.container, 840)}px`, wideSize: `${t.container}px` };

  const preset = (kind, slug) => `var(--wp--preset--${kind}--${slug})`;
  const colorSlug = (path) => (t.byPath[path] ? preset("color", kebab(path)) : null);
  const styles = {
    color: { background: colorSlug("surface.base") || r.surface, text: colorSlug("text.primary") || r.onSurface },
    typography: {
      ...(t.familyStack ? { fontFamily: preset("font-family", familySlug) } : {}),
      fontSize: `${t.body.px}px`,
      ...(t.body.lineHeight ? { lineHeight: `${round(t.body.lineHeight / t.body.px)}` } : {})
    },
    elements: {}
  };
  if (t.link?.color) styles.elements.link = { color: { text: colorSlug("brand.primary") && t.link.color === t.byPath["brand.primary"] ? colorSlug("brand.primary") : t.link.color } };
  for (const h of t.headings) {
    styles.elements[h.level] = {
      typography: {
        fontSize: preset("font-size", h.level),
        fontWeight: `${h.weight}`,
        ...(h.lineHeight ? { lineHeight: `${round(h.lineHeight / h.px)}` } : {}),
        ...(h.letterSpacing && h.letterSpacing !== "normal" ? { letterSpacing: h.letterSpacing } : {})
      }
    };
  }
  if (t.button) {
    const b = t.button;
    styles.elements.button = {
      color: {
        background: b.background === t.byPath["brand.primary"] ? colorSlug("brand.primary") : b.background,
        text: b.color
      },
      border: { radius: b.borderRadius || "0px" },
      typography: { fontSize: b.fontSize || `${t.body.px}px`, fontWeight: `${b.fontWeight || 500}` },
      spacing: { padding: Object.fromEntries(["top", "right", "bottom", "left"].map((side, i) => [side, String(b.padding || "").split(/\s+/)[i] || "0px"])) }
    };
  }
  const doc = { $schema: "https://schemas.wp.org/trunk/theme.json", version: 3, settings, styles };
  return { path: "wordpress/theme.json", content: `${JSON.stringify(doc, null, 2)}\n` };
}

/* ------------------------------------------------------------------ *
 * Storybook (MDX docs page + CSF3 stories)
 * ------------------------------------------------------------------ */

export function toStorybook(normalized) {
  const t = readTokens(normalized);
  const groups = new Map();
  for (const c of t.colors) {
    const [group, ...rest] = c.path.split(".");
    const entry = groups.get(group) || {};
    entry[rest.join("-") || group] = c.hex;
    groups.set(group, entry);
  }
  const sizes = [...new Set([...t.typeScale.map((s) => s.px), ...t.headings.map((h) => h.px)])].sort((a, b) => a - b);
  const mdx = [
    `{/*${header(t, "")} */}`,
    'import { Meta, ColorPalette, ColorItem, Typeset } from "@storybook/addon-docs/blocks";',
    "",
    '<Meta title="Design Tokens/Overview" />',
    "",
    "# Design tokens",
    "",
    `Measured on ${t.source}. Use these values; do not introduce new ones.`,
    "",
    "## Colors",
    "",
    "<ColorPalette>",
    ...[...groups.entries()].map(([group, colors]) => `  <ColorItem title="${group}" subtitle="color.${group}.*" colors={${JSON.stringify(colors)}} />`),
    "</ColorPalette>",
    "",
    "## Typography",
    "",
    `<Typeset fontFamily={${JSON.stringify(cssFontStack(t.familyStack) || "sans-serif")}} fontSizes={${JSON.stringify(sizes)}} fontWeight={${t.body.weight}} sampleText="The quick brown fox jumps over the lazy dog" />`,
    ""
  ].join("\n");

  const data = {
    colors: t.colors.map((c) => ({ token: c.token, hex: c.hex })),
    fontFamily: cssFontStack(t.familyStack) || "sans-serif",
    typeScale: [...t.typeScale.map((s) => ({ name: `font.size.${s.name}`, px: s.px, weight: t.body.weight })), ...t.headings.map((h) => ({ name: h.level, px: h.px, weight: h.weight }))],
    spacing: t.spacing,
    radii: t.radii,
    shadows: t.shadows.map((s) => s.value)
  };
  const stories = `// ${header(t, "").trim()}
// CSF3 stories rendering plain DOM nodes: works with the html and
// web-components renderers (no framework dependency).
const tokens = ${json(data)};

const el = (tag, style = {}, text = "") => {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text) node.textContent = text;
  return node;
};
const grid = () => el("div", { display: "grid", gap: "12px", fontFamily: tokens.fontFamily });

export default {
  title: "Design Tokens/Stories",
  parameters: { layout: "padded" }
};

export const Palette = {
  render: () => {
    const root = grid();
    root.style.gridTemplateColumns = "repeat(auto-fill, minmax(160px, 1fr))";
    for (const c of tokens.colors) {
      const card = el("div", { border: "1px solid #0001", borderRadius: "8px", overflow: "hidden" });
      card.append(el("div", { background: c.hex, height: "64px" }), el("div", { padding: "8px", fontSize: "12px" }, c.token + " " + c.hex));
      root.append(card);
    }
    return root;
  }
};

export const TypeScale = {
  render: () => {
    const root = grid();
    for (const t of tokens.typeScale) {
      root.append(el("div", { fontSize: t.px + "px", fontWeight: String(t.weight), lineHeight: 1.2 }, t.name + " — " + t.px + "px"));
    }
    return root;
  }
};

export const Spacing = {
  render: () => {
    const root = grid();
    tokens.spacing.forEach((v, i) => {
      const row = el("div", { display: "flex", alignItems: "center", gap: "12px", fontSize: "12px" });
      row.append(el("div", { width: v + "px", height: "16px", background: "currentColor", opacity: "0.6" }), el("span", {}, "space." + (i + 1) + " " + v + "px"));
      root.append(row);
    });
    return root;
  }
};

export const RadiusAndShadow = {
  render: () => {
    const root = grid();
    root.style.gridTemplateColumns = "repeat(auto-fill, minmax(120px, 1fr))";
    for (const r of tokens.radii) {
      root.append(el("div", { height: "80px", borderRadius: r.px + "px", border: "2px solid currentColor", display: "grid", placeItems: "center", fontSize: "12px" }, "radius." + r.name + " " + r.px + "px"));
    }
    tokens.shadows.forEach((s, i) => {
      root.append(el("div", { height: "80px", borderRadius: "8px", boxShadow: s, display: "grid", placeItems: "center", fontSize: "12px" }, "shadow." + (i + 1)));
    });
    return root;
  }
};
`;
  const files = [
    { path: "storybook/Tokens.mdx", content: mdx },
    { path: "storybook/tokens.stories.js", content: stories }
  ];
  return { ...files[0], files };
}

/* ------------------------------------------------------------------ *
 * Motion (Framer Motion) presets
 * ------------------------------------------------------------------ */

const GSAP_EASE = {
  "power1.out": [0.5, 1, 0.89, 1], "power2.out": [0.33, 1, 0.68, 1], "power3.out": [0.25, 1, 0.5, 1], "power4.out": [0.22, 1, 0.36, 1],
  "power1.in": [0.11, 0, 0.5, 0], "power2.in": [0.32, 0, 0.67, 0], "power3.in": [0.5, 0, 0.75, 0], "power4.in": [0.64, 0, 0.78, 0],
  "power1.inOut": [0.45, 0, 0.55, 1], "power2.inOut": [0.65, 0, 0.35, 1], "power3.inOut": [0.76, 0, 0.24, 1], "power4.inOut": [0.83, 0, 0.17, 1]
};

/** "0% { transform: translateY(16px); opacity: 0 }" steps → Motion keyframe arrays. */
function keyframesToMotion(steps) {
  const frames = {};
  const read = (body, prop) => (new RegExp(`${prop}\\s*:\\s*([^;}]+)`, "i").exec(body) || [])[1];
  for (const step of steps) {
    const body = String(step);
    const opacity = read(body, "opacity");
    if (opacity !== undefined) (frames.opacity ||= []).push(Number(opacity));
    const transform = read(body, "transform") || "";
    const ty = /translateY\(\s*(-?[\d.]+)px/i.exec(transform);
    const tx = /translateX\(\s*(-?[\d.]+)px/i.exec(transform);
    const t3 = /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/i.exec(transform);
    const sc = /scale\(\s*([\d.]+)/i.exec(transform);
    const rot = /rotate\(\s*(-?[\d.]+)deg/i.exec(transform);
    if (ty || t3) (frames.y ||= []).push(Number(ty ? ty[1] : t3[2]));
    else if (/translateY\(0\)|translate\(0/.test(transform) || (transform === "none" && frames.y)) (frames.y ||= []).push(0);
    if (tx || t3) (frames.x ||= []).push(Number(tx ? tx[1] : t3[1]));
    if (sc) (frames.scale ||= []).push(Number(sc[1]));
    if (rot) (frames.rotate ||= []).push(Number(rot[1]));
  }
  // A property must appear in every step to be a valid keyframe track.
  return Object.fromEntries(Object.entries(frames).filter(([, v]) => v.length === steps.length && v.length > 1));
}

export function toFramerMotion(normalized) {
  const t = readTokens(normalized);
  const durations = Object.fromEntries(t.durations.map((d) => [camel(d.name), round(d.ms / 1000)]));
  const easings = {};
  t.easings.forEach((e, i) => {
    if (e.bezier) easings[i === 0 ? "standard" : `curve${i + 1}`] = e.bezier;
  });
  for (const tl of normalized.gsap?.timelines || []) {
    const ease = tl.values?.ease;
    if (GSAP_EASE[ease] && !Object.values(easings).some((b) => b.join() === GSAP_EASE[ease].join())) easings[camel(ease.replace(".", "-"))] = GSAP_EASE[ease];
  }
  const baseDuration = t.durations.length ? round(t.durations[Math.min(1, t.durations.length - 1)].ms / 1000) : 0.3;
  const baseEase = easings.standard || [0.25, 0.1, 0.25, 1];
  const transitions = { base: { duration: baseDuration, ease: baseEase } };
  for (const [name, seconds] of Object.entries(durations)) transitions[name] = { duration: seconds, ease: baseEase };
  // Overshooting curves (y outside 0..1) read as springs in Motion.
  for (const [name, b] of Object.entries(easings)) {
    if (b[1] > 1 || b[3] > 1 || b[1] < 0 || b[3] < 0) {
      const overshoot = Math.max(b[1] - 1, b[3] - 1, -b[1], -b[3]);
      transitions[`${name}Spring`] = { type: "spring", stiffness: Math.round(Math.min(700, 600 / Math.max(0.1, baseDuration))), damping: Math.max(8, Math.round(30 - overshoot * 40)), mass: 1 };
    }
  }
  const stagger = round(Math.max(0.04, baseDuration * 0.25));
  const variants = {
    fadeIn: { hidden: { opacity: 0 }, show: { opacity: 1, transition: transitions.base } },
    slideUp: { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: transitions.base } },
    scaleIn: { hidden: { opacity: 0, scale: 0.96 }, show: { opacity: 1, scale: 1, transition: transitions.base } },
    stagger: { hidden: {}, show: { transition: { staggerChildren: stagger } } }
  };
  const keyframeVariants = {};
  for (const k of t.keyframes) {
    const tracks = keyframesToMotion(k.steps || []);
    if (!Object.keys(tracks).length) continue;
    const runtime = t.runtimeAnimations.find((a) => a.name === k.name);
    const ease = bezierOf(runtime?.easing || "") || baseEase;
    keyframeVariants[camel(k.name)] = { animate: { ...tracks, transition: { duration: runtime ? round(runtime.duration / 1000) : baseDuration, ease, ...(runtime?.delay ? { delay: round(runtime.delay / 1000) } : {}) } } };
  }
  const content = `// ${header(t, "").trim()}
// Usage:
//   import { motion } from "motion/react";
//   import { transitions, variants } from "./motion";
//   <motion.ul variants={variants.stagger} initial="hidden" animate="show">
//     <motion.li variants={variants.slideUp} />
//   </motion.ul>
// Durations are in seconds, eases are cubic-bezier arrays.

export const durations = ${json(durations)};

export const easings = ${json(easings)};

export const transitions = ${json(transitions)};

export const variants = ${json(variants)};

/** Rebuilt from the page's @keyframes (timing from the live animations). */
export const keyframeVariants = ${json(keyframeVariants)};

/** Pass to MotionConfig / useReducedMotion branches. */
export const reducedMotionTransition = { duration: 0 };
`;
  return { path: "motion/motion.js", content };
}

/* ------------------------------------------------------------------ *
 * Agent rules (.cursorrules / CLAUDE.md design section)
 * ------------------------------------------------------------------ */

export function toAgentRules(normalized) {
  const t = readTokens(normalized);
  const r = roles(t);
  const lines = [
    "# Design rules",
    "",
    `Source: ${t.source}. These values were measured on the live site. Use them as the only allowed design values.`,
    "",
    "## Hard rules",
    "- Never introduce a color, font size, spacing, radius or shadow that is not listed below. If a value is missing, reuse the closest token and say so.",
    "- Reference tokens through CSS variables / theme keys, never raw hex in components.",
    `- Text on the base surface uses ${r.onSurface}; brand actions use ${r.primary} with ${r.onPrimary} text (contrast ${round(contrast(r.primary, r.onPrimary), 2)}:1).`,
    ...(r.focus ? [`- Every interactive element shows a visible focus ring in ${r.focus}.`] : ["- Every interactive element shows a visible focus ring."]),
    "",
    "## Colors"
  ];
  for (const c of t.colors) lines.push(`- \`${c.token}\`: ${c.hex}`);
  lines.push("", "## Typography");
  if (t.familyStack) lines.push(`- Font stack: ${cssFontStack(t.familyStack)}`);
  lines.push(`- Body: ${t.body.px}px${t.body.lineHeight ? `/${t.body.lineHeight}px` : ""}, weight ${t.body.weight}`);
  for (const h of t.headings) lines.push(`- ${h.level}: ${h.px}px${h.lineHeight ? `/${h.lineHeight}px` : ""}, weight ${h.weight}${h.letterSpacing && h.letterSpacing !== "normal" ? `, letter-spacing ${h.letterSpacing}` : ""}${h.transform && h.transform !== "none" ? `, ${h.transform}` : ""}`);
  if (t.typeScale.length) lines.push(`- Size scale: ${t.typeScale.map((s) => `${s.name} ${s.px}px`).join(", ")}`);
  lines.push("", "## Layout");
  if (t.spacing.length) lines.push(`- Spacing steps: ${t.spacing.map((v) => `${v}px`).join(", ")}${t.baseGrid ? ` (${t.baseGrid}px grid; never use off-grid values)` : ""}`);
  if (t.radii.length) lines.push(`- Radii: ${t.radii.map((x) => `${x.name} ${x.px}px`).join(", ")}`);
  if (t.shadows.length) lines.push(`- Shadows: ${t.shadows.map((s) => `\`${s.value}\``).join("; ")}`);
  if (t.container) lines.push(`- Content max width: ${t.container}px`);
  if (t.breakpoints.length) lines.push(`- Breakpoints (min-width): ${t.breakpoints.map((b) => `${b}px`).join(", ")}`);
  if (t.button) {
    const b = t.button;
    lines.push("", "## Components", `- Primary button: background ${b.background}, text ${b.color}, radius ${b.borderRadius}, padding ${b.padding}, ${b.fontSize}/${b.fontWeight}${b.border && b.border !== "none" ? `, border ${b.border}` : ""}.`);
    for (const v of (normalized.buttonVariants || []).slice(1, 3)) lines.push(`- ${titleCase(v.name || "secondary")} button: background ${v.spec.background}, text ${v.spec.color}, border ${v.spec.border}.`);
  }
  if (t.formControl) lines.push(`- Inputs: height ${t.formControl.height}, padding ${t.formControl.padding}, border ${t.formControl.border}, radius ${t.formControl.borderRadius}, ${t.formControl.fontSize}.`);
  if (t.link?.color) lines.push(`- Links: ${t.link.color}, weight ${t.link.fontWeight || "inherit"}, decoration ${t.link.textDecoration || "none"}.`);
  if (t.durations.length || t.easings.length) {
    lines.push("", "## Motion");
    if (t.durations.length) lines.push(`- Durations: ${t.durations.map((d) => `${d.name} ${d.ms}ms`).join(", ")}`);
    if (t.easings.length) lines.push(`- Easing: ${t.easings.map((e) => e.value).join(", ")}`);
    lines.push("- Respect `prefers-reduced-motion: reduce` (disable non-essential animation).");
  }
  lines.push("");
  return { path: "AGENT_RULES.md", content: lines.join("\n") };
}

/** Every export as a flat array of `{ path, content }`. */
export function allPlatformExports(normalized) {
  return [toSwiftUI, toCompose, toFlutter, toTailwindV4, toStorybook, toWordPressThemeJson, toFramerMotion, toAgentRules]
    .flatMap((fn) => {
      const out = fn(normalized);
      return out.files ? out.files : [out];
    });
}
