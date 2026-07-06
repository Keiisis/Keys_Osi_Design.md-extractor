import {
  buildAgentPromptGuide,
  buildAtmosphereSection,
  buildBrandLines,
  buildColorSection,
  buildComponentInventory,
  buildComponentSpecsSection,
  buildDataDrivenDoRules,
  buildDataDrivenDontRules,
  buildDesignScoreSection,
  buildGeometrySection,
  buildImplementationNotes,
  buildInteractionSection,
  buildLayoutSection,
  buildMotionSection,
  buildPageAnatomySection,
  buildResponsiveSection,
  buildTypographySection,
  formatAccessibilitySection
} from "./generate-design-md.mjs";

export function generateSkillMarkdown(context) {
  const { normalized, metadata = {} } = context;
  const siteProfile = normalized.siteProfile || {};
  const systemName = metadata.systemName || inferSystemName(normalized.source?.title);
  const slug = slugify(metadata.scope || metadata.brand || systemName || "extracted");
  const brand = metadata.brand || systemName;
  const audience = metadata.audience || siteProfile.audience || "website visitors and product users";
  const productSurface = metadata.productSurface || siteProfile.productSurface || "web app";

  return `---
name: design-system-${slug}
description: Creates implementation-ready design-system guidance with measured tokens, component behavior, and accessibility standards for ${brand}. Use when creating or updating UI rules, component specifications, or design-system documentation.
---

<!-- TYPEUI_SH_MANAGED_START -->

# ${systemName}

## Mission
Deliver implementation-ready design-system guidance for ${brand} that can be applied consistently across ${productSurface} interfaces. Every token below was measured on the live site — reuse it verbatim.

## Brand
${buildBrandLines(normalized, { brand, audience, productSurface }).join("\n")}

## Style Foundations
${buildAtmosphereSection(normalized)}
- Visual style: structured, accessible, implementation-first
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
concise, confident, implementation-focused

## Rules: Do
- Use semantic tokens, not raw hex values in component guidance.
- Every component must define required states: default, hover, focus-visible, active, disabled, loading, error.
- Responsive behavior and edge-case handling should be specified for every component family.
- Accessibility acceptance criteria must be testable in implementation.
${buildDataDrivenDoRules(normalized).join("\n")}

## Rules: Don't
- Do not allow low-contrast text or hidden focus indicators.
- Do not introduce one-off spacing or typography exceptions.
- Do not use ambiguous labels or non-descriptive actions.
${buildDataDrivenDontRules(normalized).join("\n")}

## Guideline Authoring Workflow
1. Restate design intent in one sentence.
2. Define foundations and tokens.
3. Define component anatomy, variants, and interactions.
4. Add accessibility acceptance criteria.
5. Add anti-patterns and migration notes.
6. End with QA checklist.

## Required Output Structure
- Context and goals
- Design tokens and foundations
- Component-level rules (anatomy, variants, states, responsive behavior)
- Accessibility requirements and testable acceptance criteria
- Content and tone standards with examples
- Anti-patterns and prohibited implementations
- QA checklist

## Component Rule Expectations
- Include keyboard, pointer, and touch behavior.
- Include spacing and typography token requirements.
- Include long-content, overflow, and empty-state handling.

## Quality Gates
- Every non-negotiable rule must use "must".
- Every recommendation should use "should".
- Every accessibility rule must be testable in implementation.
- Prefer system consistency over local visual exceptions.
- Reproductions must reuse the measured tokens above; no unexplained new color, spacing, or radius value.

## Implementation Notes
${buildImplementationNotes(normalized).join("\n")}

## Agent Prompt Guide
${buildAgentPromptGuide(normalized, systemName)}

<!-- TYPEUI_SH_MANAGED_END -->
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

function slugify(value) {
  return String(value || "extracted")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
