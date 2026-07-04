import { computeDesignScore, estimateScaleRatio, inferSpacingBase, splitTokenValue } from "./generate-design-md.mjs";
import { generateW3cTokens } from "./export-tokens.mjs";

/**
 * Complete machine-readable export of an extraction: every token with
 * raw value + CSS variable, flat color codes, fonts with file URLs,
 * stylesheets/scripts inventory, animation specs, breakpoints,
 * interaction states, accessibility audit, detected stack, and an
 * embedded W3C Design Tokens document.
 */
export function generateDesignJson(normalized, options = {}) {
  const tokenRows = (rows) =>
    (rows || []).map((row) => {
      const { raw, cssVar } = splitTokenValue(row.value);
      return {
        token: row.token,
        value: raw,
        cssVariable: cssVar,
        usage: row.usage || 0
      };
    });

  // Colors carry hex + rgb + hsl, so any tool can consume them directly.
  const colors = tokenRows(normalized.colorPalette).map((row) => ({
    ...row,
    formats: colorFormats(row.value)
  }));

  return {
    meta: {
      generator: `Keys_Osi_Design.md-extractor v${options.version || "0.6.0"}`,
      generatedAt: new Date().toISOString(),
      sourceUrl: normalized.source?.url || "",
      sourceTitle: normalized.source?.title || "",
      sampledAt: normalized.sampledAt || "",
      sampledElements: normalized.sampledElements || 0,
      totalElements: normalized.totalElements || 0
    },
    profile: {
      audience: normalized.siteProfile?.audience || "",
      productSurface: normalized.siteProfile?.productSurface || "",
      confidence: normalized.siteProfile?.confidence || "",
      evidence: normalized.siteProfile?.evidence || []
    },
    stack: normalized.stack || [],
    platform: normalized.platformInfo || null,
    tokens: {
      colors,
      colorCodes: colors.map((row) => row.value).filter((value) => value.startsWith("#")),
      gradients: tokenRows(normalized.gradientTokens),
      typography: {
        fontFamily: normalized.mainFontStyle || null,
        scale: tokenRows(normalized.typographyScale),
        estimatedScaleRatio: estimateScaleRatio(normalized.typographyScale)
      },
      spacing: {
        baseGrid: inferSpacingBase(normalized.spacingScale),
        scale: tokenRows(normalized.spacingScale)
      },
      radius: tokenRows(normalized.radiusTokens),
      shadows: tokenRows(normalized.shadowTokens),
      motion: {
        durations: tokenRows(normalized.motionDurationTokens),
        easings: tokenRows(normalized.motionEasingTokens)
      }
    },
    animation: {
      keyframes: normalized.keyframes || [],
      runtimeAnimations: normalized.runtimeAnimations || [],
      gsap: normalized.gsap || null
    },
    responsive: {
      breakpoints: normalized.breakpoints || []
    },
    interactions: normalized.interactionStyles || [],
    accessibility: normalized.a11y || null,
    designScore: computeDesignScore(normalized),
    componentSpecs: {
      headings: normalized.headings || [],
      buttonVariants: normalized.buttonVariants || [],
      formControl: normalized.formControl || null,
      link: normalized.linkSpec || null
    },
    layout: normalized.layout || null,
    components: normalized.componentHints || [],
    resources: normalized.resources || { stylesheets: [], scripts: [], fontFaces: [], inlineStyleBlocks: 0 },
    cssVariables: normalized.cssVariables || [],
    diagnostics: normalized.diagnostics || [],
    w3cTokens: generateW3cTokens(normalized)
  };
}

/** hex → { hex, rgb: "rgb(...)", hsl: "hsl(...)" }; non-hex values pass through. */
export function colorFormats(value) {
  const hex = String(value || "").trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) {
    return { hex: null, rgb: null, hsl: null, raw: hex };
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }

  return {
    hex,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${hue}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%)`,
    raw: hex
  };
}
