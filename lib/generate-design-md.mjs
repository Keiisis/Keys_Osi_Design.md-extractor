export function generateDesignMarkdown(context) {
  const { normalized, metadata = {} } = context;
  const siteProfile = normalized.siteProfile || {};
  const systemName = metadata.systemName || inferSystemName(normalized.source?.title);
  const brand = metadata.brand || systemName;
  const extractionUrl = normalized.source?.url || "Unknown URL";
  const audience = metadata.audience || siteProfile.audience || "website visitors and product users";
  const productSurface = metadata.productSurface || siteProfile.productSurface || "web app";

  const platformNote = normalized.platformInfo && normalized.platformInfo.platform !== "generic"
    ? `\n- Design platform: ${normalized.platformInfo.platform.toUpperCase()} (${normalized.platformInfo.details})`
    : "";

  const visualStyle = inferVisualStyle(normalized);
  const mainFontStyle = formatMainFontStyle(normalized.mainFontStyle);
  const typographyScale = joinTokens(normalized.typographyScale, 8);
  const colors = joinTokens(normalized.colorPalette, 10);
  const spacing = joinTokens(normalized.spacingScale, 8);
  const radiusShadowMotion = joinTokenGroups(
    [normalized.radiusTokens, normalized.shadowTokens, normalized.motionDurationTokens],
    8
  );
  const componentNotes = normalized.componentHints
    .map((item) => `${item.type} (${item.count})`)
    .join(", ");
  const diagnosticsNote = normalized.diagnostics.length
    ? `\n- Extraction diagnostics: ${normalized.diagnostics.join(" ")}`
    : "";

  const gsapNote = normalized.gsap && normalized.gsap.detected
    ? `\n- Animations: GSAP v${normalized.gsap.version} detected (${normalized.gsap.timelines.length} active timelines | targets: ${normalized.gsap.timelines.slice(0, 3).map(t => `${t.type} [${t.vars.join(', ')}]`).join(', ')})`
    : "";

  const extractedSignals = formatExtractedSignals(normalized);

  return `# ${systemName}
 
## Mission
Create implementation-ready, token-driven UI guidance for ${brand} that is optimized for consistency, accessibility, and fast delivery across ${productSurface}.
 
## Brand
- Product/brand: ${brand}
- URL: ${extractionUrl}
- Audience: ${audience}
- Product surface: ${productSurface}${platformNote}
 
## Style Foundations
- Visual style: ${visualStyle}
- Main font style: ${mainFontStyle}
- Typography scale: ${typographyScale}
- Color palette: ${colors}
- Spacing scale: ${spacing}
- Radius/shadow/motion tokens: ${radiusShadowMotion}${gsapNote}${extractedSignals}

## Accessibility
${formatAccessibilitySection(normalized)}

## Writing Tone
Concise, confident, implementation-focused.

## Rules: Do
- Use semantic tokens, not raw hex values, in component guidance.
- Every component must define states for default, hover, focus-visible, active, disabled, loading, and error.
- Component behavior should specify responsive and edge-case handling.
- Interactive components must document keyboard, pointer, and touch behavior.
- Accessibility acceptance criteria must be testable in implementation.

## Rules: Don't
- Do not allow low-contrast text or hidden focus indicators.
- Do not introduce one-off spacing or typography exceptions.
- Do not use ambiguous labels or non-descriptive actions.
- Do not ship component guidance without explicit state rules.

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
- Include known page component density: ${componentNotes || "not enough evidence from extraction"}.
${diagnosticsNote}

## Quality Gates
- Every non-negotiable rule must use "must".
- Every recommendation should use "should".
- Every accessibility rule must be testable in implementation.
- Teams should prefer system consistency over local visual exceptions.
`;
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

export function formatExtractedSignals(normalized) {
  const notes = [];

  if (normalized.gradientTokens && normalized.gradientTokens.length > 0) {
    const gradients = normalized.gradientTokens
      .map((row) => `\`${row.token}=${row.value}\``)
      .join(", ");
    notes.push(`- Gradients: ${gradients}`);
  }

  if (normalized.breakpoints && normalized.breakpoints.length > 0) {
    const breakpoints = normalized.breakpoints
      .map((item) => `${item.px}px (${item.count} rule${item.count > 1 ? "s" : ""})`)
      .join(", ");
    notes.push(`- Responsive breakpoints: ${breakpoints}`);
  }

  if (normalized.keyframes && normalized.keyframes.length > 0) {
    const keyframes = normalized.keyframes
      .map((item) => `\`@keyframes ${item.name}\` (${item.stepCount} steps)`)
      .join(", ");
    notes.push(`- Keyframe animations: ${keyframes}`);
  }

  if (normalized.interactionStyles && normalized.interactionStyles.length > 0) {
    const samples = normalized.interactionStyles
      .slice(0, 3)
      .map((rule) => `\`${rule.selector} { ${rule.declarations.join("; ")} }\``)
      .join(", ");
    notes.push(
      `- Interaction states: ${normalized.interactionStyles.length} hover/focus/active rules captured (e.g. ${samples})`
    );
  }

  if (normalized.runtimeAnimations && normalized.runtimeAnimations.length > 0) {
    const animations = normalized.runtimeAnimations
      .slice(0, 5)
      .map((item) => {
        const label = item.name || item.target || item.type;
        const loop = item.iterations === "infinite" ? ", infinite" : "";
        return `\`${label}\` (${Math.round(item.duration)}ms ${item.easing || "linear"}${loop})`;
      })
      .join(", ");
    notes.push(`- Runtime animations (Web Animations API): ${animations}`);
  }

  if (normalized.stack && normalized.stack.length > 0) {
    const stack = normalized.stack.map((item) => item.name).join(", ");
    notes.push(`- Detected tech stack: ${stack}`);
  }

  if (notes.length === 0) {
    return "";
  }
  return `\n${notes.join("\n")}`;
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

function inferVisualStyle(normalized) {
  const colorCount = normalized.colorPalette.length;
  const spacingCount = normalized.spacingScale.length;
  if (colorCount >= 8 && spacingCount >= 6) {
    return "structured, tokenized, content-first";
  }
  if (colorCount >= 5) {
    return "clean, functional, implementation-oriented";
  }
  return "minimal, utility-first, accessibility-prioritized";
}

function formatMainFontStyle(mainFontStyle) {
  if (!mainFontStyle || !mainFontStyle.familyStack) {
    return "No reliable primary font family detected from computed styles.";
  }

  const family = `\`font.family.primary=${mainFontStyle.primaryFamily || mainFontStyle.familyStack}\``;
  const stack = mainFontStyle.familyStack ? `\`font.family.stack=${mainFontStyle.familyStack}\`` : "";
  const size = mainFontStyle.size ? `\`font.size.base=${mainFontStyle.size}\`` : "";
  const weight = mainFontStyle.weight ? `\`font.weight.base=${mainFontStyle.weight}\`` : "";
  const lineHeight = mainFontStyle.lineHeight ? `\`font.lineHeight.base=${mainFontStyle.lineHeight}\`` : "";

  return [family, stack, size, weight, lineHeight].filter(Boolean).join(", ");
}

function joinTokens(rows, limit) {
  if (!rows || rows.length === 0) {
    return "No reliable extraction yet; teams should define explicit semantic tokens manually.";
  }
  return rows
    .slice(0, limit)
    .map((row) => `\`${row.token}=${row.value}\``)
    .join(", ");
}

function joinTokenGroups(groups, limitPerGroup) {
  const lines = groups
    .filter((rows) => rows && rows.length > 0)
    .map((rows) => rows.slice(0, limitPerGroup).map((row) => `\`${row.token}=${row.value}\``).join(", "));
  if (lines.length === 0) {
    return "No reliable extraction yet; motion and shape tokens should be defined manually.";
  }
  return lines.join(" | ");
}
