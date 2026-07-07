/**
 * Expert-level DESIGN.md generator.
 *
 * Every section is data-driven: token tables with CSS-variable mapping,
 * measured contrast between the real text/surface pair, an estimated
 * typographic scale ratio, an inferred spacing base grid, motion specs
 * from @keyframes + the Web Animations API, and component guidance
 * wired to the actually extracted tokens.
 *
 * The section builders are exported and reused by the SKILL.md generator.
 */

import { buildFontLicenseMarkdown } from "./font-licenses.mjs";

export function generateDesignMarkdown(context) {
  const { normalized, metadata = {} } = context;
  const siteProfile = normalized.siteProfile || {};
  const systemName = metadata.systemName || inferSystemName(normalized.source?.title);
  const brand = metadata.brand || systemName;
  const audience = metadata.audience || siteProfile.audience || "website visitors and product users";
  const productSurface = metadata.productSurface || siteProfile.productSurface || "web app";

  return `${buildDesignFrontmatter(normalized, systemName)}
# ${systemName}

## Mission
Create implementation-ready, token-driven UI guidance for ${brand} that is optimized for consistency, accessibility, and fast delivery across ${productSurface}. Every value in this document was measured on the live site — treat it as the source of truth, not as a suggestion.

## Brand
${buildBrandLines(normalized, { brand, audience, productSurface }).join("\n")}

## Style Foundations
${buildAtmosphereSection(normalized)}
- Visual style: ${inferVisualStyle(normalized)}
${buildTypographySection(normalized)}
${buildColorSection(normalized)}
${buildGeometrySection(normalized)}
${buildLayoutSection(normalized)}
${buildMotionSection(normalized)}
${buildResponsiveSection(normalized)}
${buildInteractionSection(normalized)}
${buildComponentSpecsSection(normalized)}

## Accessibility
${formatAccessibilitySection(normalized)}

## Design Health Score
${buildDesignScoreSection(normalized)}

## Page Anatomy
${buildPageAnatomySection(normalized)}

## Component Inventory
${buildComponentInventory(normalized)}

## Writing Tone
Concise, confident, implementation-focused.

## Rules: Do
- Use semantic tokens, not raw hex values, in component guidance.
- Every component must define states for default, hover, focus-visible, active, disabled, loading, and error.
- Component behavior should specify responsive and edge-case handling.
- Interactive components must document keyboard, pointer, and touch behavior.
- Accessibility acceptance criteria must be testable in implementation.
${buildDataDrivenDoRules(normalized).join("\n")}

## Rules: Don't
- Do not allow low-contrast text or hidden focus indicators.
- Do not introduce one-off spacing or typography exceptions.
- Do not use ambiguous labels or non-descriptive actions.
- Do not ship component guidance without explicit state rules.
${buildDataDrivenDontRules(normalized).join("\n")}

## Guideline Authoring Workflow
1. Restate design intent in one sentence.
2. Define foundations and semantic tokens.
3. Define component anatomy, variants, interactions, and state behavior.
4. Add accessibility acceptance criteria with pass/fail checks.
5. Add anti-patterns, migration notes, and edge-case handling.
6. End with a QA checklist.

## Required Output Structure
- Context and goals.
- Design tokens and foundations.
- Component-level rules (anatomy, variants, states, responsive behavior).
- Accessibility requirements and testable acceptance criteria.
- Content and tone standards with examples.
- Anti-patterns and prohibited implementations.
- QA checklist.

## Component Rule Expectations
- Include keyboard, pointer, and touch behavior.
- Include spacing and typography token requirements.
- Include long-content, overflow, and empty-state handling.
- Include known page component density: ${componentDensityLine(normalized)}.

## Quality Gates
- Every non-negotiable rule must use "must".
- Every recommendation should use "should".
- Every accessibility rule must be testable in implementation.
- Teams should prefer system consistency over local visual exceptions.
- Reproductions must reuse the measured tokens above; a reviewer comparing against the source should find no unexplained new color, spacing, or radius value.

## Implementation Notes
${buildImplementationNotes(normalized).join("\n")}

## Agent Prompt Guide
${buildAgentPromptGuide(normalized, systemName)}
`;
}

/* ------------------------------------------------------------------ *
 * Section builders (shared with SKILL.md)
 * ------------------------------------------------------------------ */

/**
 * YAML frontmatter in the awesome-design-md (VoltAgent) format:
 * machine-readable `colors:` and `typography:` blocks built from the
 * measured tokens, so the file is directly consumable by that ecosystem.
 */
export function buildDesignFrontmatter(normalized, systemName) {
  const lines = ["---"];
  lines.push("version: 1");
  lines.push(`name: ${slugifyName(systemName)}-design-system`);
  lines.push("description: >-");
  lines.push(`  ${buildAtmosphereDescription(normalized)}`);

  const palette = normalized.colorPalette || [];
  if (palette.length > 0) {
    lines.push("");
    lines.push("colors:");
    for (const row of palette.slice(0, 14)) {
      const { raw } = splitTokenValue(row.value);
      const key = row.token.replace(/^color\./, "").replace(/\./g, "-");
      lines.push(`  ${key}: "${raw}"`);
    }
  }

  const headings = normalized.headings || [];
  const font = normalized.mainFontStyle;
  if (headings.length > 0 || (font && font.familyStack)) {
    lines.push("");
    lines.push("typography:");
    for (const heading of headings.slice(0, 6)) {
      lines.push(`  heading-${heading.level}:`);
      if (heading.fontFamily) lines.push(`    fontFamily: "${heading.fontFamily}"`);
      lines.push(`    fontSize: ${heading.fontSize}`);
      lines.push(`    fontWeight: ${heading.fontWeight}`);
      if (heading.lineHeight) lines.push(`    lineHeight: ${heading.lineHeight}`);
      if (heading.letterSpacing && heading.letterSpacing !== "normal") {
        lines.push(`    letterSpacing: ${heading.letterSpacing}`);
      }
    }
    if (font && font.familyStack) {
      lines.push("  body:");
      lines.push(`    fontFamily: "${font.familyStack}"`);
      if (font.size) lines.push(`    fontSize: ${font.size}`);
      if (font.weight) lines.push(`    fontWeight: ${font.weight}`);
      if (font.lineHeight) lines.push(`    lineHeight: ${font.lineHeight}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * One-paragraph "Visual Theme & Atmosphere" (designmd-style), synthesized
 * from measurements: canvas tone, accent hue, corner personality,
 * elevation philosophy, motion character.
 */
export function buildAtmosphereDescription(normalized) {
  const palette = normalized.colorPalette || [];
  const parts = [];

  const surface = findTokenHex(palette, "color.surface.base");
  if (surface) {
    const { lightness } = hslFromHex(surface);
    parts.push(
      lightness >= 55
        ? `a light, airy canvas (${surface})`
        : `a dark shell canvas (${surface})`
    );
  }

  const accent = findAccentColor(palette);
  if (accent) {
    parts.push(`a ${hueName(accent.hex)} accent (${accent.hex}) driving interactive elements`);
  }

  const font = normalized.mainFontStyle;
  if (font && font.primaryFamily) {
    // When the computed stack starts with a generic family, the real
    // brand font usually lives in @font-face declarations.
    let family = font.primaryFamily;
    if (/^(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace)$/i.test(family)) {
      const declared = normalized.resources?.fontFaces?.[0];
      if (declared && declared.family) {
        family = declared.family;
      }
    }
    parts.push(`\`${family}\` typography${font.weight ? ` at weight ${font.weight}` : ""}`);
  }

  parts.push(radiusPersonality(normalized.radiusTokens));
  parts.push(shadowPhilosophy(normalized.shadowTokens));

  const motionCount = (normalized.keyframes || []).length + (normalized.runtimeAnimations || []).length;
  if (motionCount > 0 || (normalized.gsap && normalized.gsap.detected)) {
    parts.push("purposeful motion");
  }

  return `Extracted design system: ${parts.filter(Boolean).join(", ")}.`;
}

export function buildAtmosphereSection(normalized) {
  return `${buildAtmosphereDescription(normalized)}\n`;
}

function radiusPersonality(radiusTokens) {
  const values = (radiusTokens || [])
    .map((row) => Number.parseFloat(splitTokenValue(row.value).raw))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return "square, radius-free geometry";
  }
  const max = Math.max(...values);
  if (max <= 6) return "sharp, tight-radius corners";
  if (max <= 14) return "softly rounded corners";
  return "pill-rounded, friendly corners";
}

function shadowPhilosophy(shadowTokens) {
  const first = (shadowTokens || [])[0];
  if (!first) {
    return "flat, borders-first depth";
  }
  const blurMatch = splitTokenValue(first.value).raw.match(/(-?\d+(?:\.\d+)?)(?:px)?\s+(-?\d+(?:\.\d+)?)(?:px)?\s+(\d+(?:\.\d+)?)(?:px)?/);
  const blur = blurMatch ? Number.parseFloat(blurMatch[3]) : 0;
  if (blur >= 12) return "soft, diffuse elevation";
  if (blur > 0) return "crisp, low elevation";
  return "hard-edged elevation";
}

// Browser-default link colors: computed data, but almost never the brand.
const UA_DEFAULT_COLORS = new Set(["#0000ee", "#551a8b", "#ff0000"]);

function findAccentColor(palette) {
  let best = null;
  for (const row of palette) {
    const { raw } = splitTokenValue(row.value);
    if (!/^#[0-9a-f]{6}$/i.test(raw)) continue;
    if (UA_DEFAULT_COLORS.has(raw.toLowerCase())) continue;
    const { saturation, lightness } = hslFromHex(raw);
    if (lightness < 8 || lightness > 92 || saturation < 25) continue;
    // Usage-weighted: a brand color used 30x must beat a stray default
    // link blue (#0000ee) seen once, even if the latter is more saturated.
    const score = saturation * Math.log2(2 + (row.usage || 0));
    if (!best || score > best.score) {
      best = { hex: raw.toLowerCase(), saturation, score, token: row.token };
    }
  }
  return best;
}

export function hueName(hex) {
  const { hue, saturation } = hslFromHex(hex);
  if (saturation < 12) return "neutral";
  const names = [
    [15, "red"], [40, "orange"], [65, "yellow"], [95, "lime"], [150, "green"],
    [180, "teal"], [200, "cyan"], [240, "blue"], [270, "indigo"], [290, "violet"],
    [330, "magenta"], [345, "pink"], [361, "red"]
  ];
  for (const [limit, name] of names) {
    if (hue < limit) return name;
  }
  return "neutral";
}

function hslFromHex(hex) {
  const clean = String(hex || "").replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }
  return { hue, saturation: Math.round(saturation * 100), lightness: Math.round(lightness * 100) };
}

/**
 * Ready-to-paste prompt for coding agents (designmd-style "Agent Prompt
 * Guide" merged with awesome-design-md's "Iteration Guide").
 */
export function buildAgentPromptGuide(normalized, systemName) {
  const palette = normalized.colorPalette || [];
  const accent = findAccentColor(palette);
  const surface = findTokenHex(palette, "color.surface.base");
  const font = normalized.mainFontStyle;
  const base = inferSpacingBase(normalized.spacingScale);
  const breakpoints = (normalized.breakpoints || []).map((item) => `${item.px}px`).join(", ");

  const promptFacts = [
    surface ? `canvas ${surface}` : null,
    accent ? `${hueName(accent.hex)} accent ${accent.hex}` : null,
    font && font.primaryFamily ? `font "${font.primaryFamily}"` : null,
    base ? `${base}px spacing grid` : null,
    breakpoints ? `breakpoints at ${breakpoints}` : null
  ].filter(Boolean).join(", ");

  return [
    "Copy this prompt when asking a coding agent to build UI with this system:",
    "",
    "> Build the requested UI strictly following the attached DESIGN.md for " + systemName + ".",
    `> Non-negotiables: ${promptFacts || "use the measured tokens in this file"}.`,
    "> Use the frontmatter `colors:` and `typography:` blocks as design tokens — never invent new values.",
    "> Reproduce the Component Specs CSS verbatim for buttons, inputs, and links, including all interaction states.",
    "> Check your output against the Rules: Do / Rules: Don't sections and the Quality Gates before finishing.",
    "",
    "Iteration guide: when refining, change one token family at a time (color, then type, then spacing), re-check the measured contrast pair after any color change, and keep the Design Health Score criteria green."
  ].join("\n");
}

export function buildBrandLines(normalized, { brand, audience, productSurface }) {
  const lines = [
    `- Product/brand: ${brand}`,
    `- URL: ${normalized.source?.url || "Unknown URL"}`,
    `- Audience: ${audience}`,
    `- Product surface: ${productSurface}`
  ];
  if (normalized.platformInfo && normalized.platformInfo.platform !== "generic") {
    lines.push(`- Design platform: ${normalized.platformInfo.platform.toUpperCase()} (${normalized.platformInfo.details})`);
  }
  if (normalized.stack && normalized.stack.length > 0) {
    lines.push(`- Detected tech stack: ${normalized.stack.map((item) => `${item.name} (${item.evidence})`).join(", ")}`);
  }
  return lines;
}

export function buildTypographySection(normalized) {
  const lines = ["", "### Typography"];
  const font = normalized.mainFontStyle;

  if (font && font.familyStack) {
    const base = [font.size, font.lineHeight].filter(Boolean).join("/");
    lines.push(
      `- Primary font: \`${font.primaryFamily || font.familyStack}\` — stack: \`${font.familyStack}\`${base ? ` — base: ${base}` : ""}${font.weight ? `, weight ${font.weight}` : ""} (confidence: ${font.confidence})`
    );
  } else {
    lines.push("- Primary font: not reliably detected from computed styles; define `font.family.primary` manually.");
  }

  const fontFaces = normalized.resources?.fontFaces || [];
  if (fontFaces.length > 0) {
    const families = new Map();
    for (const face of fontFaces) {
      if (!families.has(face.family)) {
        families.set(face.family, new Set());
      }
      families.get(face.family).add(face.weight);
    }
    const summary = Array.from(families.entries())
      .slice(0, 6)
      .map(([family, weights]) => `\`${family}\` (${Array.from(weights).join(", ")})`)
      .join(", ");
    lines.push(`- Self-hosted @font-face families: ${summary}`);
  }

  const scale = normalized.typographyScale || [];
  if (scale.length > 0) {
    const ratio = estimateScaleRatio(scale);
    if (ratio) {
      lines.push(`- Estimated type scale ratio: ~${ratio} between consecutive steps`);
    }
    lines.push("");
    lines.push(mdTable(["Token", "Size", "CSS Variable"], scale.slice(0, 10).map((row) => {
      const { raw, cssVar } = splitTokenValue(row.value);
      return [`\`${row.token}\``, `\`${raw}\``, cssVar ? `\`${cssVar}\`` : "—"];
    })));
  } else {
    lines.push("- Type scale: not enough evidence; define sizes manually.");
  }

  const headings = normalized.headings || [];
  if (headings.length > 0) {
    lines.push("");
    lines.push("Measured heading hierarchy:");
    lines.push("");
    lines.push(mdTable(
      ["Level", "Size/Line", "Weight", "Letter-spacing", "Transform", "Color", "Margins (t/b)"],
      headings.map((h) => [
        `\`${h.level}\``,
        `\`${h.fontSize}/${h.lineHeight}\``,
        h.fontWeight,
        h.letterSpacing,
        h.textTransform,
        `\`${h.color}\``,
        `${h.marginTop}/${h.marginBottom}`
      ])
    ));
  }
  return lines.join("\n");
}

export function buildComponentSpecsSection(normalized) {
  const parts = [];
  const variants = normalized.buttonVariants || [];

  if (variants.length > 0) {
    for (const variant of variants) {
      const spec = variant.spec;
      const declarations = [
        `background: ${spec.background};`,
        `color: ${spec.color};`,
        `border: ${spec.border};`,
        `border-radius: ${spec.borderRadius};`,
        `padding: ${spec.padding};`,
        `font-size: ${spec.fontSize};`,
        `font-weight: ${spec.fontWeight};`
      ];
      if (spec.boxShadow) declarations.push(`box-shadow: ${spec.boxShadow};`);
      if (spec.textTransform) declarations.push(`text-transform: ${spec.textTransform};`);
      parts.push(
        [
          `\`\`\`css`,
          `/* button.${variant.name} — seen ${variant.count}x${variant.example ? `, e.g. "${variant.example}"` : ""} */`,
          `.button-${variant.name} {`,
          ...declarations.map((decl) => `  ${decl}`),
          `}`,
          `\`\`\``
        ].join("\n")
      );
    }
  }

  const control = normalized.formControl;
  if (control) {
    parts.push(
      `- Form control (\`${control.tag}\`): height ${control.height}, padding ${control.padding}, border ${control.border}, radius ${control.borderRadius}, background \`${control.background}\`, text \`${control.color}\` at ${control.fontSize}.`
    );
  }

  const link = normalized.linkSpec;
  if (link) {
    parts.push(
      `- Links: color \`${link.color}\`, decoration ${link.textDecoration || "none"}, weight ${link.fontWeight} (measured on ${link.usage} links).`
    );
  }

  if (parts.length === 0) {
    return "";
  }
  return ["", "### Component Specs (measured)", ...parts].join("\n");
}

export function buildLayoutSection(normalized) {
  const layout = normalized.layout;
  if (!layout) {
    return "";
  }
  const lines = ["", "### Layout System"];
  if (layout.containerMaxWidth) {
    lines.push(`- Content container max-width: **${layout.containerMaxWidth}** (most common measured value).`);
  }
  if (layout.flexCount + layout.gridCount > 0) {
    lines.push(`- Layout method: ${layout.flexCount} flex containers vs ${layout.gridCount} grid containers — ${layout.flexCount >= layout.gridCount ? "flexbox-first" : "grid-first"} architecture.`);
  }
  if (layout.sectionPaddings.length > 0) {
    lines.push(`- Section vertical rhythm: ${layout.sectionPaddings.map((item) => `${item.value} (${item.count}x)`).join(", ")}`);
  }
  if (layout.borderWidths.length > 0) {
    lines.push(`- Border widths in use: ${layout.borderWidths.map((item) => `${item.value} (${item.count}x)`).join(", ")}`);
  }
  if (layout.zIndexScale.length > 0) {
    lines.push(`- Z-index scale: ${layout.zIndexScale.join(", ")}`);
  }
  return lines.length > 2 ? lines.join("\n") : "";
}

/**
 * Design Health Score (0-100), Peek-style audit but computed from the
 * full-page measurements: contrast, target sizes, palette discipline,
 * spacing grid, type scale, and focus affordances.
 */
export function computeDesignScore(normalized) {
  const breakdown = [];
  let score = 0;

  const a11y = normalized.a11y;
  if (a11y && a11y.contrastChecked > 0) {
    const pts = Math.round(30 * (1 - a11y.contrastFailures / a11y.contrastChecked));
    score += pts;
    breakdown.push(`Contrast: ${pts}/30 (${a11y.contrastFailures}/${a11y.contrastChecked} failures)`);
  } else {
    score += 15;
    breakdown.push("Contrast: 15/30 (not measurable)");
  }

  if (a11y && a11y.targetsChecked > 0) {
    const pts = Math.round(20 * (1 - a11y.smallTargets / a11y.targetsChecked));
    score += pts;
    breakdown.push(`Target sizes: ${pts}/20 (${a11y.smallTargets}/${a11y.targetsChecked} below 24px)`);
  } else {
    score += 10;
    breakdown.push("Target sizes: 10/20 (not measurable)");
  }

  const paletteSize = (normalized.colorPalette || []).length;
  const palettePts = paletteSize === 0 ? 7 : paletteSize <= 12 ? 15 : Math.max(5, 15 - (paletteSize - 12));
  score += palettePts;
  breakdown.push(`Palette discipline: ${palettePts}/15 (${paletteSize} colors)`);

  const base = inferSpacingBase(normalized.spacingScale);
  const gridPts = base === 8 ? 15 : base === 4 ? 13 : base === 2 ? 8 : 4;
  score += gridPts;
  breakdown.push(`Spacing grid: ${gridPts}/15 (${base ? `${base}px base` : "no consistent base"})`);

  const ratio = estimateScaleRatio(normalized.typographyScale);
  const scalePts = ratio && ratio >= 1.1 && ratio <= 1.5 ? 10 : ratio ? 6 : 3;
  score += scalePts;
  breakdown.push(`Type scale: ${scalePts}/10 (${ratio ? `ratio ~${ratio}` : "not measurable"})`);

  const hasFocusToken = (normalized.colorPalette || []).some((row) => row.token === "color.focus.ring");
  const hasFocusRules = (normalized.interactionStyles || []).some((rule) => rule.selector.includes(":focus"));
  const focusPts = hasFocusToken || hasFocusRules ? 10 : 0;
  score += focusPts;
  breakdown.push(`Focus affordances: ${focusPts}/10 (${hasFocusToken || hasFocusRules ? "present" : "none detected"})`);

  return { score: Math.max(0, Math.min(100, score)), breakdown };
}

export function buildDesignScoreSection(normalized) {
  const { score, breakdown } = computeDesignScore(normalized);
  return [
    `Measured design health: **${score}/100**`,
    ...breakdown.map((line) => `- ${line}`)
  ].join("\n");
}

export function buildColorSection(normalized) {
  const lines = ["", "### Color System"];
  const palette = normalized.colorPalette || [];

  if (palette.length > 0) {
    lines.push(mdTable(["Token", "Value", "CSS Variable", "Usage"], palette.slice(0, 12).map((row) => {
      const { raw, cssVar } = splitTokenValue(row.value);
      return [`\`${row.token}\``, `\`${raw}\``, cssVar ? `\`${cssVar}\`` : "—", String(row.usage || 0)];
    })));

    const textPrimary = findTokenHex(palette, "color.text.primary");
    const surfaceBase = findTokenHex(palette, "color.surface.base");
    if (textPrimary && surfaceBase) {
      const ratio = contrastRatioHex(textPrimary, surfaceBase);
      if (ratio) {
        lines.push("");
        lines.push(
          `- Core pair: \`color.text.primary\` (${textPrimary}) on \`color.surface.base\` (${surfaceBase}) — measured contrast **${ratio}:1** (${ratio >= 4.5 ? "passes" : "FAILS"} WCAG AA for body text).`
        );
      }
    }
  } else {
    lines.push("- Palette: not enough evidence; define semantic colors manually.");
  }

  if (normalized.gradientTokens && normalized.gradientTokens.length > 0) {
    lines.push("");
    for (const row of normalized.gradientTokens.slice(0, 4)) {
      lines.push(`- \`${row.token}\` = \`${row.value}\` (seen ${row.usage}x)`);
    }
  }
  return lines.join("\n");
}

export function buildGeometrySection(normalized) {
  const lines = ["", "### Spacing & Geometry"];
  const spacing = normalized.spacingScale || [];

  if (spacing.length > 0) {
    const base = inferSpacingBase(spacing);
    if (base) {
      lines.push(`- Spacing base grid: **${base}px** (every measured spacing value is a multiple).`);
    }
    lines.push(`- Spacing scale: ${spacing.slice(0, 10).map((row) => `\`${splitTokenValue(row.value).raw}\``).join(", ")}`);
  } else {
    lines.push("- Spacing: not enough evidence; define a 4px or 8px grid manually.");
  }

  if (normalized.radiusTokens && normalized.radiusTokens.length > 0) {
    lines.push(`- Radii: ${normalized.radiusTokens.slice(0, 8).map((row) => `\`${row.token}=${splitTokenValue(row.value).raw}\``).join(", ")}`);
  }
  if (normalized.shadowTokens && normalized.shadowTokens.length > 0) {
    lines.push("");
    lines.push(mdTable(["Token", "Value", "Usage"], normalized.shadowTokens.slice(0, 4).map((row) => {
      const { raw } = splitTokenValue(row.value);
      return [`\`${row.token}\``, `\`${raw}\``, String(row.usage || 0)];
    })));
  }
  return lines.join("\n");
}

export function buildMotionSection(normalized) {
  const lines = ["", "### Motion & Animation"];
  let hasContent = false;

  if (normalized.motionDurationTokens && normalized.motionDurationTokens.length > 0) {
    lines.push(`- Durations: ${normalized.motionDurationTokens.slice(0, 6).map((row) => `\`${row.token}=${splitTokenValue(row.value).raw}\``).join(", ")}`);
    hasContent = true;
  }
  if (normalized.motionEasingTokens && normalized.motionEasingTokens.length > 0) {
    lines.push(`- Easings: ${normalized.motionEasingTokens.slice(0, 4).map((row) => `\`${splitTokenValue(row.value).raw}\``).join(", ")}`);
    hasContent = true;
  }

  for (const keyframe of (normalized.keyframes || []).slice(0, 8)) {
    const steps = (keyframe.steps || []).slice(0, 4).map((step) => `\`${step}\``).join(" ");
    lines.push(`- \`@keyframes ${keyframe.name}\` (${keyframe.stepCount} steps)${steps ? `: ${steps}` : ""}`);
    hasContent = true;
  }

  for (const animation of (normalized.runtimeAnimations || []).slice(0, 6)) {
    const label = animation.name || animation.target || animation.type;
    const loop = animation.iterations === "infinite" ? ", infinite" : "";
    lines.push(`- Runtime (WAAPI): \`${label}\` on \`${animation.target || "?"}\` — ${Math.round(animation.duration)}ms ${animation.easing || "linear"}${loop}`);
    hasContent = true;
  }

  if (normalized.gsap && normalized.gsap.detected) {
    const timelines = normalized.gsap.timelines.slice(0, 3).map((tween) => {
      const values = tween.values && Object.keys(tween.values).length > 0
        ? Object.entries(tween.values).slice(0, 5).map(([key, value]) => `${key}: ${value}`).join(", ")
        : tween.vars.join(", ");
      const target = tween.targets && tween.targets.length > 0 ? ` on \`${tween.targets[0]}\`` : "";
      return `${tween.type} { ${values} }${target} (${tween.duration}s)`;
    });
    lines.push(`- GSAP v${normalized.gsap.version} detected: ${normalized.gsap.timelines.length} active timelines — ${timelines.join("; ")}`);
    hasContent = true;
  }

  const scrollTriggers = normalized.scrollTriggers || [];
  if (scrollTriggers.length > 0) {
    const details = scrollTriggers.slice(0, 4).map((st) => {
      const flags = [
        st.scrub === true ? "scrub" : st.scrub ? `scrub ${st.scrub}` : null,
        st.pin ? "pinned" : null,
        st.snap ? "snap" : null
      ].filter(Boolean).join(", ");
      const animation = st.animation && Object.keys(st.animation).length > 0
        ? ` → { ${Object.entries(st.animation).slice(0, 4).map(([key, value]) => `${key}: ${value}`).join(", ")} }`
        : "";
      return `\`${st.trigger || "?"}\` (start ${st.start || "?"}${st.end ? `, end ${st.end}` : ""}${flags ? `, ${flags}` : ""})${animation}`;
    });
    lines.push(`- GSAP ScrollTrigger: ${scrollTriggers.length} scroll-linked animations — ${details.join("; ")}`);
    hasContent = true;
  }

  const parallax = normalized.parallax;
  if (parallax && parallax.measured.length > 0) {
    const items = parallax.measured
      .slice(0, 5)
      .map((item) => `\`${item.selector}\` at ${item.speedRatio}x scroll speed`)
      .join(", ");
    lines.push(`- Measured parallax (scroll-diff): ${items}. Reproduce with transform updates tied to scroll position.`);
    hasContent = true;
  }
  if (parallax && parallax.fixedBackgroundCount > 0) {
    lines.push(`- Fixed-background parallax surfaces: ${parallax.fixedBackgroundCount} (\`background-attachment: fixed\`).`);
    hasContent = true;
  }

  const webgl = normalized.webgl;
  if (webgl && webgl.canvases.length > 0) {
    const renderer = (normalized.animationLibs || []).find((lib) =>
      /three|pixi|babylon|vanta/i.test(lib.name)
    );
    const canvases = webgl.canvases
      .slice(0, 3)
      .map((item) => `\`${item.selector}\` (${item.context}, ${item.width}x${item.height}${item.inViewport ? ", above the fold" : ""})`)
      .join(", ");
    if (webgl.webglCount > 0) {
      lines.push(
        `- WebGL scenes: ${webgl.webglCount} — ${canvases}${renderer ? `, rendered with ${renderer.name} ${renderer.evidence}` : ""}. GPU-drawn content cannot be extracted as CSS: plan an equivalent canvas scene, video loop, or static keyart of the same dimensions.`
      );
    } else {
      lines.push(`- Canvas graphics: ${canvases}.`);
    }
    hasContent = true;
  }

  const animationLibs = normalized.animationLibs || [];
  if (animationLibs.length > 0) {
    lines.push(
      `- Animation libraries detected: ${animationLibs.map((lib) => `${lib.name} (${lib.evidence})`).join(", ")}`
    );
    hasContent = true;
  }

  if (!hasContent) {
    lines.push("- No motion signals captured; keep transitions between 120ms and 300ms with `ease-out` as a default.");
  }
  return lines.join("\n");
}

export function buildResponsiveSection(normalized) {
  const breakpoints = normalized.breakpoints || [];
  if (breakpoints.length === 0) {
    return "";
  }
  const names = ["sm", "md", "lg", "xl", "2xl"];
  const lines = ["", "### Responsive Breakpoints", mdTable(
    ["Breakpoint", "Width", "Media-query rules"],
    breakpoints.slice(0, 8).map((item, index) => [names[index] || `bp${index + 1}`, `${item.px}px`, String(item.count)])
  )];

  const a11y = normalized.a11y;
  if (a11y && a11y.targetsChecked > 0) {
    lines.push("");
    lines.push(
      `- Touch targets: keep every interactive target at 24x24px minimum (44x44px recommended on mobile) — the source currently has ${a11y.smallTargets}/${a11y.targetsChecked} below the minimum.`
    );
  }
  const smallest = breakpoints[0];
  if (smallest) {
    lines.push(
      `- Collapsing strategy: below ${smallest.px}px, stack multi-column layouts vertically and move primary navigation into a disclosure menu, preserving the measured spacing rhythm.`
    );
  }
  return lines.join("\n");
}

export function buildInteractionSection(normalized) {
  const rules = normalized.interactionStyles || [];
  if (rules.length === 0) {
    return "";
  }
  const lines = ["", "### Interaction States (measured)"];
  for (const rule of rules.slice(0, 10)) {
    lines.push(`- \`${rule.selector}\` → ${rule.declarations.map((decl) => `\`${decl}\``).join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Page Anatomy: the ordered wireframe of the page — section roles,
 * layouts, real content (headings, CTAs), surfaces, and rhythm — plus
 * the image inventory and the forms map. This is what lets an agent
 * rebuild the page, not just restyle it.
 */
export function buildPageAnatomySection(normalized) {
  const parts = [];
  const structure = normalized.structure || [];

  if (structure.length > 0) {
    const lines = structure.map((block, index) => {
      const details = [];
      if (block.heading) details.push(`"${block.heading}"`);
      if (block.ctas.length > 0) details.push(`CTAs: ${block.ctas.map((cta) => `"${cta}"`).join(", ")}`);
      if (block.layout) details.push(`layout ${block.layout}${block.columns > 1 ? ` (${block.columns} columns)` : ""}`);
      if (block.imageCount + block.svgCount > 0) details.push(`${block.imageCount} img / ${block.svgCount} svg`);
      if (block.linkCount > 0 && (block.role === "header/navigation" || block.role === "footer")) {
        details.push(`${block.linkCount} links`);
      }
      if (block.hasForm) details.push("contains form");
      details.push(`background ${block.background}`);
      details.push(`padding-y ${block.paddingY}`);
      details.push(`~${block.height}px tall`);
      return `${index + 1}. **${block.role}** (\`${block.tag}\`) — ${details.join("; ")}`;
    });
    parts.push(lines.join("\n"));
  } else {
    parts.push("No top-level section structure could be measured on this page.");
  }

  const images = normalized.imageInventory || [];
  if (images.length > 0) {
    const logo = images.find((img) => img.role === "logo");
    const hero = images.find((img) => img.role === "hero");
    const counts = images.reduce((acc, img) => {
      acc[img.role] = (acc[img.role] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts).map(([role, count]) => `${count} ${role}`).join(", ");
    const lines = ["", `Images: ${summary}.`];
    if (logo) {
      lines.push(`- Logo: \`${logo.src.split("/").pop().split("?")[0]}\` (${logo.width}x${logo.height}${logo.alt ? `, alt "${logo.alt}"` : ""})`);
    }
    if (hero) {
      lines.push(`- Hero visual: \`${hero.src.split("/").pop().split("?")[0]}\` (${hero.width}x${hero.height})`);
    }
    parts.push(lines.join("\n"));
  }

  const forms = normalized.forms || [];
  for (const form of forms) {
    const fields = form.fields
      .slice(0, 8)
      .map((field) => {
        const label = field.label || field.placeholder || field.name || field.type;
        return `\`${label}\` (${field.type}${field.required ? ", required" : ""})`;
      })
      .join(", ");
    parts.push(
      `Form \`${form.name}\` (${form.method.toUpperCase()}, ${form.fieldCount} fields): ${fields}${form.submitText ? ` → submit "${form.submitText}"` : ""}`
    );
  }

  return parts.join("\n\n");
}

export function buildComponentInventory(normalized) {
  const hints = normalized.componentHints || [];
  if (hints.length === 0) {
    return "No strong component density signals were detected on this page.";
  }

  const palette = normalized.colorPalette || [];
  const focusRing = findTokenValue(palette, "color.focus.ring");
  const radius = (normalized.radiusTokens || [])[1] || (normalized.radiusTokens || [])[0];
  const duration = (normalized.motionDurationTokens || [])[0];
  const hoverRuleCount = (normalized.interactionStyles || []).length;

  const lines = [];
  for (const hint of hints) {
    switch (hint.type) {
      case "buttons":
        lines.push(
          `- **Buttons** (${hint.count} detected): radius ${radius ? `\`${radius.token}=${splitTokenValue(radius.value).raw}\`` : "from the radius scale"}, transition ${duration ? `\`${splitTokenValue(duration.value).raw}\`` : "150ms"}, focus ring ${focusRing ? `\`${focusRing}\`` : "2px visible outline"}; ${hoverRuleCount} measured hover/focus rules to replicate.`
        );
        break;
      case "inputs":
        lines.push(
          `- **Form inputs** (${hint.count} detected): use \`color.border.default\` at rest, \`color.focus.ring\` on focus-visible, spacing from the measured grid; document error and disabled states.`
        );
        break;
      case "cards":
        lines.push(
          `- **Cards** (${hint.count} detected): surface \`color.surface.raised\` or \`base\`, shadow \`shadow.1\`, radius from the measured scale; define hover elevation only if the interaction rules above show one.`
        );
        break;
      case "navigation":
        lines.push(
          `- **Navigation** (${hint.count} regions): sticky behavior and active-item treatment must match the source; use measured text colors for idle/active contrast.`
        );
        break;
      case "links":
        lines.push(`- **Links** (${hint.count} detected): replicate the measured hover declarations; never remove focus-visible styling.`);
        break;
      case "tables":
        lines.push(`- **Tables** (${hint.count} detected): use \`color.border.muted\` for row separators and the measured type scale for cells vs headers.`);
        break;
      default:
        lines.push(`- **${hint.type}** (${hint.count} detected).`);
    }
  }
  return lines.join("\n");
}

export function buildDataDrivenDoRules(normalized) {
  const rules = [];
  const spacing = normalized.spacingScale || [];
  const base = inferSpacingBase(spacing);
  if (base) {
    rules.push(`- Snap all spacing to the measured ${base}px base grid.`);
  }
  const palette = normalized.colorPalette || [];
  const textPrimary = findTokenHex(palette, "color.text.primary");
  const surfaceBase = findTokenHex(palette, "color.surface.base");
  if (textPrimary && surfaceBase) {
    const ratio = contrastRatioHex(textPrimary, surfaceBase);
    if (ratio) {
      rules.push(`- Keep body text at the measured pair ${textPrimary} on ${surfaceBase} (${ratio}:1) or better.`);
    }
  }
  if (normalized.breakpoints && normalized.breakpoints.length > 0) {
    rules.push(`- Implement the measured breakpoints exactly: ${normalized.breakpoints.map((item) => `${item.px}px`).join(", ")}.`);
  }
  return rules;
}

export function buildDataDrivenDontRules(normalized) {
  const rules = [];
  const paletteSize = (normalized.colorPalette || []).length;
  if (paletteSize > 0) {
    rules.push(`- Do not introduce colors outside the ${paletteSize}-color measured palette without a documented reason.`);
  }
  if ((normalized.keyframes || []).length > 0 || (normalized.runtimeAnimations || []).length > 0) {
    rules.push("- Do not invent new animations; reuse the measured keyframes and durations listed under Motion & Animation.");
  }
  return rules;
}

export function buildImplementationNotes(normalized) {
  const lines = [];
  const stackNames = (normalized.stack || []).map((item) => item.name);

  if (stackNames.length > 0) {
    lines.push(`- Source stack: ${stackNames.join(", ")}. ${recommendStack(stackNames)}`);
  } else {
    lines.push("- Source stack: not detected. Any modern stack works; the tokens above are framework-agnostic.");
  }

  const resources = normalized.resources;
  if (resources && (resources.stylesheets.length > 0 || resources.scripts.length > 0)) {
    lines.push(`- Page loads ${resources.stylesheets.length} external stylesheet(s), ${resources.scripts.length} external script(s), ${resources.inlineStyleBlocks} inline style block(s).`);
  }
  if (resources && resources.fontFaces.length > 0) {
    const files = resources.fontFaces
      .flatMap((face) => face.urls)
      .slice(0, 6)
      .map((url) => `\`${url.split("/").pop().split("?")[0]}\``)
      .join(", ");
    if (files) {
      lines.push(`- Font files to self-host: ${files} (full URLs in the JSON export).`);
    }
  }

  const fontLicense = buildFontLicenseMarkdown(normalized);
  if (fontLicense) {
    lines.push(...fontLicense.split("\n"));
  }

  lines.push("- Machine-readable exports of every token in this document: `tokens/design.tokens.json` (W3C), `tokens/tailwind.config.js`, and the JSON export from the extension popup.");

  for (const diagnostic of normalized.diagnostics || []) {
    lines.push(`- Extraction diagnostic: ${diagnostic}`);
  }
  return lines;
}

export function formatAccessibilitySection(normalized) {
  const lines = [
    "- Target: WCAG 2.2 AA",
    "- Keyboard-first interactions required.",
    "- Focus-visible rules required.",
    "- Contrast constraints required."
  ];

  const a11y = normalized.a11y;
  if (a11y && a11y.contrastChecked > 0) {
    lines.push(
      `- Measured contrast audit: ${a11y.contrastFailures}/${a11y.contrastChecked} sampled text elements fail their WCAG contrast threshold.`
    );
    if (a11y.worstPairs && a11y.worstPairs.length > 0) {
      const pairs = a11y.worstPairs
        .slice(0, 3)
        .map((pair) => `\`${pair.selector || "element"}\` ${pair.foreground} on ${pair.background} = ${pair.ratio}:1 (needs ${pair.required}:1)`)
        .join("; ");
      lines.push(`- Worst measured pairs: ${pairs}.`);
    }
  }
  if (a11y && a11y.targetsChecked > 0) {
    lines.push(
      `- Target size audit: ${a11y.smallTargets}/${a11y.targetsChecked} interactive targets are below the 24x24px WCAG 2.2 minimum.`
    );
  }

  return lines.join("\n");
}

/**
 * Formats the advanced audit (real multi-viewport emulation + dark mode
 * + safe disclosure interactions) as extra DESIGN.md sections.
 */
export function formatAuditSections(audit) {
  if (!audit) {
    return "";
  }
  const sections = [];

  if (Array.isArray(audit.viewports) && audit.viewports.length > 0) {
    const lines = ["## Responsive Audit (measured)"];
    lines.push(
      "Real device emulation was used to re-extract tokens at each viewport. Screenshots: `screenshots/viewport-<name>.png`."
    );
    for (const viewport of audit.viewports) {
      const typography = (viewport.typographyScale || [])
        .slice(0, 5)
        .map((row) => row.value)
        .join(", ");
      const spacing = (viewport.spacingScale || [])
        .slice(0, 5)
        .map((row) => row.value)
        .join(", ");
      lines.push(
        `- **${viewport.name}** (${viewport.width}x${viewport.height}): font sizes [${typography || "n/a"}], spacing [${spacing || "n/a"}]`
      );
    }
    sections.push(lines.join("\n"));
  }

  if (audit.darkMode && Array.isArray(audit.darkMode.colorPalette) && audit.darkMode.colorPalette.length > 0) {
    const lines = ["## Dark Mode Palette (measured)"];
    lines.push(
      "Captured by emulating `prefers-color-scheme: dark`. Screenshot: `screenshots/dark-mode.png`."
    );
    for (const row of audit.darkMode.colorPalette.slice(0, 10)) {
      lines.push(`- \`${row.token}=${row.value}\``);
    }
    sections.push(lines.join("\n"));
  }

  if (audit.interactions && audit.interactions.opened > 0) {
    const samples = (audit.interactions.report || []).slice(0, 6).join(", ");
    sections.push(
      [
        "## Disclosure States (captured)",
        `${audit.interactions.opened} menus/accordions/dropdowns were safely opened during capture (no navigation, no form submission). Screenshot: \`screenshots/disclosures-open.png\`.`,
        samples ? `Opened elements: ${samples}.` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (sections.length === 0) {
    return "";
  }
  return `\n${sections.join("\n\n")}\n`;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export function mdTable(headers, rows) {
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
  return [header, divider, body].join("\n");
}

/** Splits "14px (var(--x))" into { raw: "14px", cssVar: "var(--x)" }. */
export function splitTokenValue(value) {
  const text = String(value || "");
  const match = text.match(/^(.*?)\s*\((var\(--[^)]*\))\)\s*$/);
  if (match) {
    return { raw: match[1].trim(), cssVar: match[2] };
  }
  return { raw: text.trim(), cssVar: null };
}

function findTokenValue(rows, token) {
  const row = (rows || []).find((item) => item.token === token);
  return row ? splitTokenValue(row.value).raw : null;
}

function findTokenHex(rows, token) {
  const raw = findTokenValue(rows, token);
  return raw && /^#[0-9a-f]{3,8}$/i.test(raw) ? raw.toLowerCase() : null;
}

export function contrastRatioHex(fgHex, bgHex) {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) {
    return null;
  }
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

function hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16)
    };
  }
  if (clean.length >= 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }
  return null;
}

function relativeLuminance({ r, g, b }) {
  const channels = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Average ratio between consecutive font sizes, e.g. 1.25 (major third). */
export function estimateScaleRatio(typographyScale) {
  const sizes = (typographyScale || [])
    .map((row) => Number.parseFloat(splitTokenValue(row.value).raw))
    .filter((size) => Number.isFinite(size) && size > 0)
    .sort((a, b) => a - b);
  if (sizes.length < 3) {
    return null;
  }
  const ratios = [];
  for (let i = 1; i < sizes.length; i++) {
    ratios.push(sizes[i] / sizes[i - 1]);
  }
  const average = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  return Math.round(average * 100) / 100;
}

/** Largest base (8 or 4) that divides every measured spacing value. */
export function inferSpacingBase(spacingScale) {
  const values = (spacingScale || [])
    .map((row) => Number.parseFloat(splitTokenValue(row.value).raw))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2) {
    return null;
  }
  for (const base of [8, 4, 2]) {
    if (values.every((value) => value % base === 0)) {
      return base;
    }
  }
  return null;
}

function componentDensityLine(normalized) {
  const hints = normalized.componentHints || [];
  if (hints.length === 0) {
    return "not enough evidence from extraction";
  }
  return hints.map((item) => `${item.type} (${item.count})`).join(", ");
}

function recommendStack(stackNames) {
  const names = stackNames.map((name) => name.toLowerCase());
  if (names.some((name) => name.includes("next"))) {
    return "Recommended reproduction: Next.js + Tailwind, using `tokens/tailwind.config.js`.";
  }
  if (names.some((name) => name.includes("react"))) {
    return "Recommended reproduction: React + Tailwind, using `tokens/tailwind.config.js`.";
  }
  if (names.some((name) => name.includes("vue") || name.includes("nuxt"))) {
    return "Recommended reproduction: Vue/Nuxt + Tailwind, using `tokens/tailwind.config.js`.";
  }
  if (names.some((name) => name.includes("wordpress") || name.includes("shopify") || name.includes("webflow") || name.includes("wix"))) {
    return "Source is a site builder/CMS; reproduce with any component framework and the measured tokens.";
  }
  return "Reproduce with the same stack for maximum fidelity, or any modern framework using the tokens above.";
}

function inferSystemName(title) {
  if (!title) {
    return "Extracted Design System";
  }
  const clean = title
    .replace(/\s*\|\s*.*/g, "")
    .replace(/\s*-\s*.*/g, "")
    .trim();
  return clean || "Extracted Design System";
}

function slugifyName(value) {
  return String(value || "extracted")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "extracted";
}

function inferVisualStyle(normalized) {
  const colorCount = (normalized.colorPalette || []).length;
  const spacingCount = (normalized.spacingScale || []).length;
  if (colorCount >= 8 && spacingCount >= 6) {
    return "structured, tokenized, content-first";
  }
  if (colorCount >= 5) {
    return "clean, functional, implementation-oriented";
  }
  return "minimal, utility-first, accessibility-prioritized";
}
