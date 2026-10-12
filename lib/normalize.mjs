const SIZE_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"];
const RADIUS_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl"];
import { chroma, colorDistance, isSaturated, contrastRatio, hexToRgb, hue, parseCssColor, rgbToHex, visibleHex } from "./color-science.mjs";

const MOTION_NAMES = ["instant", "fast", "normal", "slow", "slower", "slowest", "glacial"];

export function normalizeExtractedStyles(payload) {
  const typographyMap = new Map();
  const fontFamilyMap = new Map();
  const textColorMap = new Map();
  const backgroundColorMap = new Map();
  const borderColorMap = new Map();
  const focusColorMap = new Map();
  const spacingMap = new Map();
  const radiusMap = new Map();
  const shadowMap = new Map();
  const motionDurationMap = new Map();
  const motionEasingMap = new Map();

  for (const row of payload.typography || []) {
    const fontSize = parsePx(row.fontSize);
    if (fontSize !== null) {
      increment(typographyMap, String(fontSize));
    }

    const fontFamily = normalizeFontFamilyStack(row.fontFamily);
    if (fontFamily) {
      increment(fontFamilyMap, fontFamily);
    }
  }

  // The painted page canvas: every translucent color is composited over
  // it, so rgba(0,0,0,0.08) becomes the light grey the eye sees, never
  // an opaque #000000.
  const canvas = visibleHex(payload.pageBackground, "#ffffff");
  const canvasHex = canvas && canvas.startsWith("#") ? canvas : "#ffffff";

  for (const row of payload.colors || []) {
    const text = visibleHex(row.textColor, canvasHex);
    const bg = visibleHex(row.backgroundColor, canvasHex);
    const border = visibleHex(row.borderColor, canvasHex);
    const outline = visibleHex(row.outlineColor, canvasHex);

    if (text && !isTransparent(text)) {
      increment(textColorMap, text);
    }
    if (bg && !isTransparent(bg)) {
      increment(backgroundColorMap, bg);
    }
    if (border && !isTransparent(border)) {
      increment(borderColorMap, border);
    }
    if (outline && !isTransparent(outline)) {
      increment(focusColorMap, outline);
    }
  }

  for (const row of payload.spacing || []) {
    const values = [
      row.marginTop,
      row.marginRight,
      row.marginBottom,
      row.marginLeft,
      row.paddingTop,
      row.paddingRight,
      row.paddingBottom,
      row.paddingLeft
    ];
    for (const raw of values) {
      const px = parsePx(raw);
      if (px !== null && px > 0) {
        increment(spacingMap, String(px));
      }
    }
  }

  for (const value of payload.radius || []) {
    const px = parsePx(value);
    if (px !== null && px > 0) {
      increment(radiusMap, String(px));
    }
  }

  for (const value of payload.shadows || []) {
    const normalized = normalizeWhitespace(value);
    if (normalized && normalized !== "none") {
      increment(shadowMap, normalized);
    }
  }

  for (const row of payload.motion || []) {
    const duration = parseDuration(row.transitionDuration) ?? parseDuration(row.animationDuration);
    const easings = new Set(splitTopLevel(normalizeWhitespace(row.transitionTimingFunction || row.animationTimingFunction)));

    if (duration !== null && duration > 0) {
      increment(motionDurationMap, String(duration));
    }
    for (const easing of easings) {
      if (easing && easing !== "ease") {
        increment(motionEasingMap, easing);
      }
    }
  }

  const typographyScale = toTokenRows(sortNumericKeys(typographyMap), SIZE_NAMES, "font.size", false, "px", payload.cssVariables);
  const mainFontStyle = inferMainFontStyle(payload.typography || [], fontFamilyMap);
  const recurringSpacing = new Map([...spacingMap].filter(([, count]) => count >= 2));
  const spacingScale = toTokenRows(
    sortNumericKeys(recurringSpacing.size >= 4 ? recurringSpacing : spacingMap),
    [],
    "space",
    true,
    "px",
    payload.cssVariables
  );
  const radiusTokens = toTokenRows(sortNumericKeys(radiusMap), RADIUS_NAMES, "radius", false, "px", payload.cssVariables);
  const shadowTokens = toRankedTokenRows(shadowMap, "shadow", false, payload.cssVariables);
  const motionDurationTokens = toTokenRows(sortNumericKeys(motionDurationMap), MOTION_NAMES, "motion.duration", false, "ms", payload.cssVariables);
  const motionEasingTokens = toRankedTokenRows(motionEasingMap, "motion.easing", true, payload.cssVariables);

  const colorPalette = buildColorTokens(
    clusterColorMap(textColorMap),
    clusterColorMap(backgroundColorMap),
    clusterColorMap(borderColorMap),
    clusterColorMap(focusColorMap),
    payload.cssVariables,
    canvasHex,
    payload.buttonVariants || [],
    payload.linkSpec
  );
  const gradientTokens = buildGradientTokens(payload.backgroundImages || []);
  const keyframes = summarizeKeyframes(payload.keyframes || []);
  const interactionStyles = summarizeInteractionStyles(payload.interactionStyles || []);
  const breakpoints = summarizeBreakpoints(payload.breakpoints || []);
  const runtimeAnimations = summarizeRuntimeAnimations(payload.runtimeAnimations || []);
  const scrollTriggers = summarizeScrollTriggers(payload.scrollTriggers || []);
  const animationLibs = summarizeAnimationLibs(payload.animationLibs || []);
  const webgl = summarizeCanvasInventory(payload.canvasInventory || []);
  const parallax = summarizeParallax(payload.parallax);
  const stack = summarizeStack(payload.stack || []);
  const a11y = summarizeA11y(payload.a11y);
  const resources = summarizeResources(payload.resources);
  const headings = summarizeHeadings(payload.headings || []);
  const buttonVariants = summarizeButtonVariants(payload.buttonVariants || []);
  const formControl = payload.formControl && typeof payload.formControl === "object"
    ? {
        ...payload.formControl,
        background: canonicalizeIfColor(payload.formControl.background),
        color: canonicalizeIfColor(payload.formControl.color),
        border: canonicalBorder(payload.formControl.border)
      }
    : null;
  const linkSpec = payload.linkSpec && typeof payload.linkSpec === "object"
    ? { ...payload.linkSpec, color: canonicalizeIfColor(payload.linkSpec.color) }
    : null;
  const layout = summarizeLayout(payload.layout);
  const structure = summarizeStructure(payload.structure || []);
  const imageInventory = summarizeImageInventory(payload.imageInventory || []);
  const forms = summarizeForms(payload.forms || []);
  const siteProfile = inferSiteProfile(payload);

  const diagnostics = [];
  if (payload.sampledElements < 30) {
    diagnostics.push("Low sample size: fewer than 30 visible elements were extracted.");
  }
  if (colorPalette.length < 4) {
    diagnostics.push("Limited color diversity detected; color token inference confidence is low.");
  }
  if (typographyScale.length < 3) {
    diagnostics.push("Limited typography variety detected; size scale may need manual refinement.");
  }
  if (!mainFontStyle.familyStack) {
    diagnostics.push("Main font family could not be confidently extracted from computed styles.");
  }
  if (siteProfile.confidence === "low") {
    diagnostics.push("Audience and product surface inference confidence is low; verify generated brand context.");
  }

  return {
    source: payload.source,
    sampledAt: payload.sampledAt,
    sampledElements: payload.sampledElements,
    totalElements: payload.totalElements,
    typographyScale,
    mainFontStyle,
    colorPalette,
    gradientTokens,
    spacingScale,
    radiusTokens,
    shadowTokens,
    motionDurationTokens,
    motionEasingTokens,
    keyframes,
    interactionStyles,
    breakpoints,
    runtimeAnimations,
    scrollTriggers,
    animationLibs,
    webgl,
    parallax,
    stack,
    a11y,
    resources,
    headings,
    buttonVariants,
    formControl,
    linkSpec,
    layout,
    structure,
    imageInventory,
    forms,
    componentHints: summarizeComponents(payload.components || []),
    siteProfile,
    diagnostics,
    cssVariables: payload.cssVariables,
    gsap: payload.gsap,
    platformInfo: payload.platformInfo
  };
}

function inferSiteProfile(payload) {
  const signals = payload.siteSignals || {};
  const counts = signals.elementCounts || {};
  const corpus = toCorpus(payload, signals);
  const evidence = [];

  const surfaceScores = {
    documentation: 0,
    dashboard: 0,
    marketing: 0,
    content: 0,
    ecommerce: 0,
    local: 0,
    webapp: 0
  };

  surfaceScores.documentation += keywordScore(
    corpus,
    ["docs", "documentation", "api", "reference", "sdk", "cli", "guide", "tutorial", "endpoint", "quickstart"],
    0.8,
    evidence,
    "documentation"
  );
  surfaceScores.documentation += numericCue(counts.codeBlocks, 4, 0.35, evidence, "code blocks");
  surfaceScores.documentation += pathnameCue(signals.pathname, ["/docs", "/documentation", "/api"], 2, evidence, "documentation path");

  surfaceScores.dashboard += keywordScore(
    corpus,
    ["dashboard", "workspace", "settings", "analytics", "reports", "admin", "billing", "projects", "users", "team"],
    0.7,
    evidence,
    "dashboard"
  );
  surfaceScores.dashboard += numericCue(counts.forms, 3, 0.4, evidence, "forms");
  surfaceScores.dashboard += numericCue(counts.inputs, 8, 0.2, evidence, "inputs");
  surfaceScores.dashboard += numericCue(counts.tables, 1, 0.45, evidence, "tables");
  surfaceScores.dashboard += numericCue(counts.authMarkers, 2, 0.35, evidence, "auth markers");

  surfaceScores.marketing += keywordScore(
    corpus,
    ["features", "pricing", "contact sales", "book demo", "testimonials", "enterprise", "why", "benefits", "get started", "start free"],
    0.6,
    evidence,
    "marketing"
  );
  surfaceScores.marketing += numericCue(counts.pricingSections, 1, 1.4, evidence, "pricing sections");

  surfaceScores.content += keywordScore(
    corpus,
    ["blog", "article", "news", "read more", "newsletter", "editorial", "author", "published"],
    0.7,
    evidence,
    "content"
  );
  surfaceScores.content += numericCue(counts.articles, 2, 0.5, evidence, "article containers");

  surfaceScores.ecommerce += keywordScore(
    corpus,
    ["add to cart", "add to bag", "shopping cart", "checkout", "sku", "in stock", "buy now", "shop now", "free shipping", "wishlist", "panier", "ajouter au panier", "livraison offerte"],
    0.8,
    evidence,
    "e-commerce"
  );
  // [class*=product] is common on SaaS sites too: weak signal.
  surfaceScores.ecommerce += numericCue(counts.productMarkers, 4, 0.3, evidence, "product markers");
  surfaceScores.ecommerce += numericCue(counts.checkoutMarkers, 1, 1.2, evidence, "checkout markers");

  surfaceScores.local += keywordScore(
    corpus,
    ["menu", "reservation", "réservation", "reserveren", "reservieren", "reservar", "book a table", "opening hours", "horaires", "openingstijden", "öffnungszeiten", "horario", "takeaway", "à emporter", "afhalen", "delivery", "livraison", "bezorgen", "restaurant", "pizzeria", "café", "bistro", "bakery", "boulangerie", "salon", "spa", "barber", "clinic", "studio", "directions", "itinéraire", "our location", "notre adresse"],
    0.7,
    evidence,
    "local business"
  );

  surfaceScores.webapp += keywordScore(
    corpus,
    ["account", "profile", "workspace", "app", "platform", "notifications", "integrations"],
    0.35,
    evidence,
    "web app"
  );

  const bestSurface = pickTop(surfaceScores);
  const surfaceConfidence = confidenceFromScores(bestSurface);
  const productSurface = toProductSurfaceLabel(bestSurface.key);

  const audienceScores = {
    developer: 0,
    operator: 0,
    business: 0,
    consumer: 0,
    reader: 0,
    local: 0,
    general: 0
  };

  audienceScores.developer += keywordScore(
    corpus,
    ["developer", "api", "sdk", "cli", "repository", "github", "code", "integration", "docs", "terminal"],
    0.75,
    evidence,
    "developer audience"
  );
  audienceScores.developer += numericCue(counts.codeBlocks, 3, 0.45, evidence, "developer code blocks");

  audienceScores.operator += keywordScore(
    corpus,
    ["dashboard", "workspace", "manage", "settings", "admin", "team", "reports", "billing", "monitor"],
    0.55,
    evidence,
    "operator audience"
  );
  audienceScores.operator += numericCue(counts.forms, 2, 0.35, evidence, "operator workflows");
  audienceScores.operator += numericCue(counts.tables, 1, 0.35, evidence, "operator data tables");

  audienceScores.business += keywordScore(
    corpus,
    ["enterprise", "teams", "pricing", "sales", "compliance", "roi", "case study", "customers", "business", "businesses", "infrastructure", "revenue", "payments", "solutions", "platform", "startups", "contact sales", "workflow", "automation", "b2b"],
    0.55,
    evidence,
    "business audience"
  );

  audienceScores.consumer += keywordScore(
    corpus,
    ["add to cart", "add to bag", "buy now", "shop now", "free shipping", "discount", "sale", "deals", "panier", "soldes"],
    0.65,
    evidence,
    "consumer audience"
  );
  audienceScores.consumer += numericCue(counts.checkoutMarkers, 2, 0.6, evidence, "consumer checkout markers");

  audienceScores.reader += keywordScore(
    corpus,
    ["blog", "article", "newsletter", "guide", "news", "story", "read", "insights"],
    0.55,
    evidence,
    "reader audience"
  );
  audienceScores.reader += numericCue(counts.articles, 2, 0.4, evidence, "reader article containers");

  if (bestSurface.key === "documentation") {
    audienceScores.developer += 1.8;
  }
  if (bestSurface.key === "dashboard") {
    audienceScores.operator += 1.3;
  }
  if (bestSurface.key === "ecommerce") {
    audienceScores.consumer += 1.2;
  }
  if (bestSurface.key === "marketing") {
    audienceScores.business += 0.8;
  }
  if (bestSurface.key === "content") {
    audienceScores.reader += 0.8;
  }
  if (bestSurface.key === "local") {
    audienceScores.local += 1.5;
  }

  audienceScores.general += keywordScore(
    corpus,
    ["home", "welcome", "about", "contact"],
    0.2,
    evidence,
    "general audience"
  );

  const bestAudience = pickTop(audienceScores);
  const audience = toAudienceLabel(bestAudience.key, bestSurface.key);
  const audienceConfidence = confidenceFromScores(bestAudience);

  return {
    audience,
    productSurface,
    confidence: lowerConfidence(surfaceConfidence, audienceConfidence),
    scores: {
      surface: surfaceScores,
      audience: audienceScores
    },
    evidence: dedupeEvidence(evidence).slice(0, 8)
  };
}

function toCorpus(payload, signals) {
  const blocks = [
    payload.source?.url || "",
    payload.source?.title || "",
    signals.title || "",
    signals.description || "",
    signals.keywords || "",
    signals.ogType || "",
    signals.ogSiteName || "",
    signals.appName || "",
    signals.pathname || "",
    (signals.headings || []).join(" "),
    (signals.navTexts || []).join(" "),
    (signals.ctaTexts || []).join(" "),
    (signals.textSample || "").slice(0, 2400)
  ];
  return normalizeWhitespace(blocks.join(" ").toLowerCase());
}

function keywordScore(corpus, keywords, weight, evidence, label) {
  let hits = 0;
  for (const keyword of keywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(corpus)) {
      hits += 1;
    }
  }
  const score = hits * weight;
  if (hits > 0) {
    evidence.push(`${label}: ${hits} keyword hit${hits > 1 ? "s" : ""}`);
  }
  return score;
}

function numericCue(value, threshold, weight, evidence, label) {
  const numeric = Number(value || 0);
  if (numeric < threshold) {
    return 0;
  }
  const strength = Math.max(1, Math.floor(numeric / threshold));
  evidence.push(`${label}: ${numeric}`);
  return strength * weight;
}

function pathnameCue(pathname, fragments, score, evidence, label) {
  const path = String(pathname || "").toLowerCase();
  if (!path) {
    return 0;
  }
  for (const fragment of fragments) {
    if (path.includes(fragment)) {
      evidence.push(`${label}: ${fragment}`);
      return score;
    }
  }
  return 0;
}

function pickTop(scoreMap) {
  const rows = Object.entries(scoreMap).sort((a, b) => b[1] - a[1]);
  const [topKey, score] = rows[0] || ["none", 0];
  const key = score > 0 ? topKey : "none";
  const next = rows[1]?.[1] ?? 0;
  return {
    key,
    score,
    next,
    gap: score - next
  };
}

function confidenceFromScores(result) {
  if (result.score >= 5 && result.gap >= 1.4) {
    return "high";
  }
  if (result.score >= 2.4 && result.gap >= 0.5) {
    return "medium";
  }
  return "low";
}

function lowerConfidence(a, b) {
  const ranks = { low: 0, medium: 1, high: 2 };
  return ranks[a] <= ranks[b] ? a : b;
}

function toProductSurfaceLabel(surfaceKey) {
  switch (surfaceKey) {
    case "documentation":
      return "documentation site";
    case "dashboard":
      return "dashboard web app";
    case "marketing":
      return "marketing site";
    case "content":
      return "content site";
    case "ecommerce":
      return "e-commerce storefront";
    case "local":
      return "local business site";
    case "none":
      return "website";
    default:
      return "web app";
  }
}

function toAudienceLabel(audienceKey, surfaceKey) {
  switch (audienceKey) {
    case "developer":
      return "developers and technical teams";
    case "operator":
      return "authenticated users and operators";
    case "business":
      return "buyers, teams, and decision-makers";
    case "consumer":
      return "online shoppers and consumers";
    case "reader":
      return "readers and knowledge seekers";
    case "local":
      return "local customers and visitors";
    default:
      return fallbackAudienceForSurface(surfaceKey);
  }
}

function fallbackAudienceForSurface(surfaceKey) {
  if (surfaceKey === "documentation") {
    return "developers and technical teams";
  }
  if (surfaceKey === "marketing") {
    return "prospective customers and evaluators";
  }
  if (surfaceKey === "dashboard") {
    return "authenticated users and operators";
  }
  if (surfaceKey === "ecommerce") {
    return "online shoppers and consumers";
  }
  if (surfaceKey === "content") {
    return "readers and subscribers";
  }
  if (surfaceKey === "local") {
    return "local customers and visitors";
  }
  return "website visitors and product users";
}

function dedupeEvidence(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

const GENERIC_FONT_PATTERN = /^(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|cursive|fantasy)$/i;

function inferMainFontStyle(typographyRows, fontFamilyMap) {
  let topFamilyEntry = topEntries(fontFamilyMap, 1)[0];
  // A bare generic stack (unstyled wrappers) must not beat the real
  // brand stack used by the visible content.
  if (topFamilyEntry && GENERIC_FONT_PATTERN.test(getPrimaryFontFamily(topFamilyEntry.key))) {
    const nonGeneric = topEntries(fontFamilyMap, 6).find(
      (entry) => !GENERIC_FONT_PATTERN.test(getPrimaryFontFamily(entry.key))
    );
    if (nonGeneric) {
      topFamilyEntry = nonGeneric;
    }
  }
  const familyStack = topFamilyEntry?.key || "";
  const primaryFamily = getPrimaryFontFamily(familyStack);
  const familyUsage = topFamilyEntry?.count || 0;

  if (!familyStack) {
    return {
      familyStack: "",
      primaryFamily: "",
      weight: "",
      size: "",
      lineHeight: "",
      usage: 0,
      confidence: "low"
    };
  }

  const styleMap = new Map();
  for (const row of typographyRows || []) {
    const normalizedFamily = normalizeFontFamilyStack(row.fontFamily);
    if (!normalizedFamily || normalizedFamily !== familyStack) {
      continue;
    }
    const style = snapshotFontStyle(row);
    const key = JSON.stringify(style);
    increment(styleMap, key);
  }

  const topStyleEntry = topEntries(styleMap, 1)[0];
  const style = topStyleEntry ? JSON.parse(topStyleEntry.key) : {};
  const styleUsage = topStyleEntry?.count || 0;
  const confidence = inferFontConfidence(familyUsage, styleUsage, typographyRows.length);

  return {
    familyStack,
    primaryFamily,
    weight: style.weight || "",
    size: style.size || "",
    lineHeight: style.lineHeight || "",
    usage: familyUsage,
    confidence
  };
}

function snapshotFontStyle(row) {
  return {
    weight: normalizeWhitespace(row.fontWeight || ""),
    size: normalizeWhitespace(row.fontSize || ""),
    lineHeight: normalizeWhitespace(row.lineHeight || "")
  };
}

function normalizeFontFamilyStack(value) {
  const raw = normalizeWhitespace(value || "");
  if (!raw) {
    return "";
  }

  const parts = raw
    .split(",")
    .map((item) => item.trim())
    .map((item) => item.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }
  return parts.join(", ");
}

function getPrimaryFontFamily(stack) {
  const first = String(stack || "").split(",")[0]?.trim() || "";
  return first.replace(/^['"]|['"]$/g, "");
}

function inferFontConfidence(familyUsage, styleUsage, totalRows) {
  const ratio = totalRows > 0 ? familyUsage / totalRows : 0;
  if (ratio >= 0.45 && styleUsage >= 3) {
    return "high";
  }
  if (ratio >= 0.2 && styleUsage >= 1) {
    return "medium";
  }
  return "low";
}

function buildGradientTokens(backgroundImages) {
  const gradientMap = new Map();
  for (const value of backgroundImages) {
    const normalized = normalizeWhitespace(value);
    if (!normalized || !normalized.includes("gradient(")) {
      continue;
    }
    increment(gradientMap, normalized.slice(0, 240));
  }
  return topEntries(gradientMap, 4).map((entry, index) => ({
    token: `color.gradient.${index + 1}`,
    value: entry.key,
    usage: entry.count
  }));
}

function summarizeKeyframes(keyframes) {
  return keyframes.slice(0, 12).map((item) => ({
    name: String(item.name || "unnamed"),
    stepCount: Array.isArray(item.steps) ? item.steps.length : 0,
    steps: Array.isArray(item.steps) ? item.steps.slice(0, 6) : []
  }));
}

function summarizeInteractionStyles(interactionStyles) {
  return interactionStyles
    .filter((item) => item && item.selector && Array.isArray(item.declarations) && item.declarations.length > 0)
    .slice(0, 12)
    .map((item) => ({
      selector: normalizeWhitespace(item.selector).slice(0, 140),
      declarations: item.declarations.slice(0, 6)
    }));
}

function summarizeRuntimeAnimations(runtimeAnimations) {
  return runtimeAnimations
    .filter((item) => item && (item.name || item.target))
    .slice(0, 12)
    .map((item) => ({
      type: String(item.type || "Animation"),
      name: String(item.name || ""),
      duration: Number(item.duration) || 0,
      delay: Number(item.delay) || 0,
      easing: String(item.easing || ""),
      iterations: item.iterations === "infinite" ? "infinite" : Number(item.iterations) || 1,
      target: String(item.target || ""),
      keyframes: Array.isArray(item.keyframes) ? item.keyframes.slice(0, 6) : []
    }));
}

function summarizeScrollTriggers(scrollTriggers) {
  return scrollTriggers
    .filter((item) => item && (item.trigger || item.start))
    .slice(0, 10)
    .map((item) => ({
      trigger: String(item.trigger || ""),
      start: String(item.start || ""),
      end: String(item.end || ""),
      scrub: item.scrub === true ? true : Number.isFinite(Number(item.scrub)) && item.scrub !== false ? Number(item.scrub) : false,
      pin: Boolean(item.pin),
      snap: Boolean(item.snap),
      toggleActions: String(item.toggleActions || ""),
      animation: item.animation && typeof item.animation === "object" ? item.animation : {}
    }));
}

function summarizeAnimationLibs(animationLibs) {
  return animationLibs
    .filter((item) => item && item.name)
    .slice(0, 14)
    .map((item) => ({ name: String(item.name), evidence: String(item.evidence || "") }));
}

function summarizeCanvasInventory(canvasInventory) {
  const canvases = canvasInventory
    .filter((item) => item && item.context)
    .slice(0, 10)
    .map((item) => ({
      selector: String(item.selector || "canvas"),
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      context: String(item.context),
      inViewport: Boolean(item.inViewport)
    }));
  return {
    canvases,
    webglCount: canvases.filter((item) => item.context.startsWith("webgl")).length,
    twoDCount: canvases.filter((item) => item.context === "2d").length
  };
}

function summarizeParallax(parallax) {
  if (!parallax || typeof parallax !== "object") {
    return { measured: [], fixedBackgroundCount: 0 };
  }
  return {
    measured: (parallax.measured || [])
      .filter((item) => item && item.selector)
      .slice(0, 8)
      .map((item) => ({
        selector: String(item.selector),
        speedRatio: Number(item.speedRatio) || 0,
        kind: String(item.kind || "scroll-linked")
      })),
    fixedBackgroundCount: Number(parallax.fixedBackgroundCount) || 0
  };
}

function summarizeStack(stack) {
  return stack
    .filter((item) => item && item.name)
    .slice(0, 12)
    .map((item) => ({
      name: String(item.name),
      evidence: String(item.evidence || "")
    }));
}

function summarizeA11y(a11y) {
  if (!a11y || typeof a11y !== "object") {
    return null;
  }
  return {
    contrastChecked: Number(a11y.contrastChecked) || 0,
    contrastFailures: Number(a11y.contrastFailures) || 0,
    worstPairs: Array.isArray(a11y.worstPairs) ? a11y.worstPairs.slice(0, 5) : [],
    targetsChecked: Number(a11y.targetsChecked) || 0,
    smallTargets: Number(a11y.smallTargets) || 0
  };
}

function summarizeHeadings(headings) {
  return headings
    .filter((item) => item && item.level && item.fontSize)
    .slice(0, 6)
    .map((item) => ({
      level: String(item.level),
      fontSize: String(item.fontSize),
      lineHeight: String(item.lineHeight || ""),
      fontWeight: String(item.fontWeight || ""),
      letterSpacing: String(item.letterSpacing || "normal"),
      textTransform: String(item.textTransform || "none"),
      color: toCanonicalColor(item.color) || String(item.color || ""),
      marginTop: String(item.marginTop || ""),
      marginBottom: String(item.marginBottom || ""),
      fontFamily: String(item.fontFamily || "")
    }));
}

function summarizeButtonVariants(variants) {
  const kindOf = (spec) => {
    const bg = canonicalizeIfColor(spec.background);
    const solid = bg && bg.startsWith("#");
    const bordered = String(spec.border || "none") !== "none";
    if (solid && chroma(bg) >= 0.3) return "primary";
    if (solid) return "neutral";
    if (/gradient/.test(String(spec.background))) return "primary";
    if (bordered) return "secondary";
    return "ghost";
  };
  const order = { primary: 0, secondary: 1, neutral: 2, ghost: 3 };
  const seen = new Map();
  return variants
    .filter((item) => item && item.spec)
    .slice(0, 6)
    .map((item) => ({ item, kind: kindOf(item.spec) }))
    .sort((a, b) => order[a.kind] - order[b.kind] || (Number(b.item.count) || 1) - (Number(a.item.count) || 1))
    .slice(0, 4)
    .map(({ item, kind }) => {
      const n = (seen.get(kind) || 0) + 1;
      seen.set(kind, n);
      return {
        name: n === 1 ? kind : `${kind}-${n}`,
        count: Number(item.count) || 1,
        example: String(item.example || ""),
        spec: {
          background: canonicalizeIfColor(item.spec.background),
          color: canonicalizeIfColor(item.spec.color),
          border: canonicalBorder(item.spec.border),
          borderRadius: String(item.spec.borderRadius || "0px"),
          padding: String(item.spec.padding || ""),
          fontSize: String(item.spec.fontSize || ""),
          fontWeight: String(item.spec.fontWeight || ""),
          boxShadow: String(item.spec.boxShadow || ""),
          textTransform: String(item.spec.textTransform || "")
        }
      };
    });
}

// "1px solid rgb(185, 185, 249)" -> "1px solid #b9b9f9"; zero/none -> "none".
function canonicalBorder(value) {
  const text = normalizeWhitespace(value || "none");
  if (text === "none" || /^0(px)?\b/.test(text) || /\bnone\b/.test(text)) return "none";
  return text.replace(/(rgba?|oklch|oklab|lab|lch|color)\([^)]*\)/g, (color) => canonicalizeIfColor(color));
}

// Split a CSS list on top-level commas (not inside parentheses).
function splitTopLevel(value) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of String(value || "")) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function canonicalizeIfColor(value) {
  const text = String(value || "");
  const parsed = parseCssColor(text);
  if (!parsed) return text; // gradients, keywords, var()
  if (parsed.a < 0.04) return "transparent";
  // Keep translucency visible in specs: hex would drop the alpha.
  if (parsed.a < 1) return text;
  return rgbToHex(parsed);
}

function summarizeLayout(layout) {
  if (!layout || typeof layout !== "object") {
    return null;
  }
  return {
    containerMaxWidth: layout.containerMaxWidth ? String(layout.containerMaxWidth) : null,
    flexCount: Number(layout.flexCount) || 0,
    gridCount: Number(layout.gridCount) || 0,
    zIndexScale: Array.isArray(layout.zIndexScale) ? layout.zIndexScale.slice(0, 12) : [],
    borderWidths: Array.isArray(layout.borderWidths) ? layout.borderWidths.slice(0, 4) : [],
    sectionPaddings: Array.isArray(layout.sectionPaddings) ? layout.sectionPaddings.slice(0, 4) : []
  };
}

function summarizeStructure(structure) {
  return structure
    .filter((item) => item && item.role)
    .slice(0, 14)
    .map((item) => ({
      role: String(item.role),
      tag: String(item.tag || "section"),
      heading: String(item.heading || ""),
      ctas: Array.isArray(item.ctas) ? item.ctas.slice(0, 3).map(String) : [],
      layout: String(item.layout || ""),
      columns: Number(item.columns) || 0,
      imageCount: Number(item.imageCount) || 0,
      svgCount: Number(item.svgCount) || 0,
      linkCount: Number(item.linkCount) || 0,
      hasForm: Boolean(item.hasForm),
      background: String(item.background || "transparent"),
      paddingY: String(item.paddingY || ""),
      height: Number(item.height) || 0
    }));
}

function summarizeImageInventory(imageInventory) {
  return imageInventory
    .filter((item) => item && item.src)
    .slice(0, 20)
    .map((item) => ({
      src: String(item.src),
      alt: String(item.alt || ""),
      role: String(item.role || "photo"),
      width: Number(item.width) || 0,
      height: Number(item.height) || 0
    }));
}

function summarizeForms(forms) {
  return forms
    .filter((item) => item && item.fieldCount > 0)
    .slice(0, 5)
    .map((item) => ({
      name: String(item.name || "form"),
      method: String(item.method || "get"),
      fieldCount: Number(item.fieldCount) || 0,
      fields: Array.isArray(item.fields)
        ? item.fields.slice(0, 12).map((field) => ({
            tag: String(field.tag || "input"),
            type: String(field.type || "text"),
            name: String(field.name || ""),
            placeholder: String(field.placeholder || ""),
            required: Boolean(field.required),
            label: String(field.label || "")
          }))
        : [],
      submitText: String(item.submitText || "")
    }));
}

function summarizeResources(resources) {
  if (!resources || typeof resources !== "object") {
    return { stylesheets: [], scripts: [], fontFaces: [], inlineStyleBlocks: 0 };
  }
  return {
    stylesheets: (resources.stylesheets || []).slice(0, 30).map(String),
    scripts: (resources.scripts || []).slice(0, 30).map(String),
    fontFaces: dedupeFontFaces(resources.fontFaces || []),
    inlineStyleBlocks: Number(resources.inlineStyleBlocks) || 0
  };
}

function dedupeFontFaces(fontFaces) {
  const byVariant = new Map();
  for (const item of fontFaces) {
    if (!item || !item.family) continue;
    const key = `${item.family}|${item.weight || "400"}|${item.style || "normal"}`;
    const existing = byVariant.get(key);
    const urls = Array.isArray(item.urls) ? item.urls.map(String) : [];
    if (existing) {
      for (const url of urls) {
        if (!existing.urls.includes(url) && existing.urls.length < 4) {
          existing.urls.push(url);
        }
      }
    } else {
      byVariant.set(key, {
        family: String(item.family),
        weight: String(item.weight || "400"),
        style: String(item.style || "normal"),
        urls: urls.slice(0, 4)
      });
    }
    if (byVariant.size >= 20) break;
  }
  return Array.from(byVariant.values());
}

function summarizeBreakpoints(breakpoints) {
  return breakpoints
    .filter((item) => item && Number.isFinite(Number(item.px)) && Number(item.px) > 0)
    .map((item) => ({ px: Number(item.px), count: Number(item.count) || 1 }))
    .sort((a, b) => a.px - b.px)
    .slice(0, 10);
}

function summarizeComponents(components) {
  return components
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);
}

/**
 * Semantic palette from measured usage: roles come from contrast against
 * the real canvas, lightness and chroma — not from frequency order.
 *   surface.base     the painted page canvas
 *   surface.muted    alternate neutral band, close to the canvas
 *   surface.raised   cards/panels: the neutral surface nearest the canvas
 *   surface.inverse  neutral surface of opposite lightness (dark band on a light site)
 *   surface.brand    the most used saturated surface
 *   text.primary     most used readable text on the canvas
 *   text.secondary   next readable neutral text
 *   text.muted       quietest readable neutral text
 *   text.inverse     text meant for inverse/brand surfaces
 *   brand.primary / brand.secondary   most used saturated hues (any channel)
 *   border.default / border.muted / border.strong, focus.ring
 */
function buildColorTokens(textMap, bgMap, borderMap, focusMap, cssVariables = [], canvasHex = "#ffffff", buttonVariants = [], linkSpec = null) {
  const rows = [];
  const used = new Map();
  const add = (token, hex, usage) => {
    if (!hex) return;
    const variable = findCssVariableForValue(cssVariables, hex, token.split(".")[1]);
    rows.push({ token, value: variable ? `${hex} (${variable})` : hex, usage: usage || 0 });
    used.set(token, hex);
  };
  const ranked = (map) =>
    Array.from(map.entries())
      .map(([hex, count]) => ({ hex, count }))
      .filter((entry) => entry.hex.startsWith("#"))
      .sort((a, b) => b.count - a.count);
  const isNeutral = (hex) => chroma(hex) < 0.16;
  // Dark navy / slate body text is still "neutral" text.
  const isNeutralText = (hex) => chroma(hex) < 0.25;
  const distinct = (hex, ...others) => others.every((other) => !other || colorDistance(hex, other) > 14);
  const distinctSurface = (hex, other) => colorDistance(hex, other) > 4;

  const texts = ranked(textMap);
  const bgs = ranked(bgMap);
  // A border painted in the canvas color is invisible on the canvas.
  const borders = ranked(borderMap).filter((e) => contrastRatio(e.hex, canvasHex) > 1.04);

  // Surfaces
  const canvasUsage = bgMap.get(canvasHex) || 0;
  add("color.surface.base", canvasHex, canvasUsage);
  const nearCanvas = bgs.filter((e) => isNeutral(e.hex) && distinctSurface(e.hex, canvasHex) && contrastRatio(e.hex, canvasHex) < 1.6);
  const muted = nearCanvas[0];
  if (muted) add("color.surface.muted", muted.hex, muted.count);
  const raised = nearCanvas
    .filter((e) => e !== muted)
    .sort((a, b) => contrastRatio(a.hex, canvasHex) - contrastRatio(b.hex, canvasHex))[0];
  if (raised) add("color.surface.raised", raised.hex, raised.count);
  const inverse = bgs.find((e) => isNeutral(e.hex) && contrastRatio(e.hex, canvasHex) >= 3);
  if (inverse) add("color.surface.inverse", inverse.hex, inverse.count);
  const brandSurface = bgs.find((e) => !isNeutral(e.hex) && e.hex !== canvasHex);
  if (brandSurface) add("color.surface.brand", brandSurface.hex, brandSurface.count);

  // Text
  const readable = texts.filter((e) => contrastRatio(e.hex, canvasHex) >= 3);
  // Primary = the highest-emphasis text among the frequent ones (headings +
  // body), not merely the most frequent grey.
  const frequent = readable.filter((e) => readable[0] && e.count >= readable[0].count * 0.25 && isNeutralText(e.hex));
  const primary = [...frequent].sort((a, b) => contrastRatio(b.hex, canvasHex) - contrastRatio(a.hex, canvasHex))[0] || readable[0] || texts[0];
  if (primary) add("color.text.primary", primary.hex, primary.count);
  const secondary = readable.find((e) => e !== primary && isNeutralText(e.hex) && distinct(e.hex, primary?.hex));
  if (secondary) add("color.text.secondary", secondary.hex, secondary.count);
  const mutedText = readable
    .filter((e) => e !== primary && e !== secondary && isNeutralText(e.hex) && distinct(e.hex, primary?.hex, secondary?.hex))
    .sort((a, b) => contrastRatio(a.hex, canvasHex) - contrastRatio(b.hex, canvasHex))[0];
  if (mutedText) add("color.text.muted", mutedText.hex, mutedText.count);
  const inverseText = texts.find((e) => contrastRatio(e.hex, canvasHex) < 2 && isNeutral(e.hex));
  if (inverseText) add("color.text.inverse", inverseText.hex, inverseText.count);

  // Brand: saturated hues from every channel, backgrounds weigh double;
  // the browser default link blue is never a brand color.
  const brandScores = new Map();
  const score = (entries, weight) => {
    for (const e of entries) {
      if (!isSaturated(e.hex) || e.hex === "#0000ee" || e.hex === "#551a8b") continue;
      const entry = brandScores.get(e.hex) || { score: 0, count: 0 };
      entry.score += e.count * weight;
      entry.count += e.occurrences ?? e.count;
      brandScores.set(e.hex, entry);
    }
  };
  score(bgs, 2);
  score(texts, 1);
  score(borders, 1);
  // Buttons and links are where a brand color lives: weigh them heavily.
  const solid = (value) => {
    const hex = visibleHex(value, canvasHex);
    return hex && hex.startsWith("#") ? hex : null;
  };
  score(buttonVariants.map((v) => ({ hex: solid(v.spec?.background), count: (v.count || 1) * 3, occurrences: v.count || 1 })).filter((e) => e.hex), 1);
  if (linkSpec?.color && solid(linkSpec.color)) score([{ hex: solid(linkSpec.color), count: (linkSpec.usage || 1) * 2, occurrences: linkSpec.usage || 1 }], 1);
  const brands = Array.from(brandScores.entries()).sort((a, b) => b[1].score - a[1].score);
  if (brands[0]) add("color.brand.primary", brands[0][0], brands[0][1].count);
  const second = brands.find(([hex]) => brands[0] && Math.min(Math.abs(hue(hex) - hue(brands[0][0])), 360 - Math.abs(hue(hex) - hue(brands[0][0]))) > 24);
  if (second) add("color.brand.secondary", second[0], second[1].count);

  // Borders: default = most used, muted = closest to canvas, strong = highest contrast.
  if (borders[0]) add("color.border.default", borders[0].hex, borders[0].count);
  const byContrast = borders.slice(1).filter((e) => distinct(e.hex, borders[0]?.hex));
  const borderMuted = [...byContrast].sort((a, b) => contrastRatio(a.hex, canvasHex) - contrastRatio(b.hex, canvasHex))[0];
  if (borderMuted && contrastRatio(borderMuted.hex, canvasHex) < contrastRatio(borders[0].hex, canvasHex)) {
    add("color.border.muted", borderMuted.hex, borderMuted.count);
  }
  const borderStrong = [...byContrast].sort((a, b) => contrastRatio(b.hex, canvasHex) - contrastRatio(a.hex, canvasHex))[0];
  if (borderStrong && borderStrong !== borderMuted && contrastRatio(borderStrong.hex, canvasHex) > contrastRatio(borders[0].hex, canvasHex)) {
    add("color.border.strong", borderStrong.hex, borderStrong.count);
  }

  const focus = ranked(focusMap)[0];
  if (focus) add("color.focus.ring", focus.hex, focus.count);

  return rows;
}

function topEntries(map, limit) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function toTokenRows(values, names, prefix, useNumericSequence = false, unit = "px", cssVariables = []) {
  return values.map((value, index) => {
    const rawVal = `${value}${unit}`;
    const variable = findCssVariableForValue(cssVariables, rawVal) || findCssVariableForValue(cssVariables, String(value));
    return {
      token: `${prefix}.${useNumericSequence ? index + 1 : names[index] || `step${index + 1}`}`,
      value: variable ? `${rawVal} (${variable})` : rawVal,
      usage: 0
    };
  });
}

function toRankedTokenRows(map, prefix, keepRawValue = false, cssVariables = []) {
  return topEntries(map, 4).map((entry, index) => {
    const rawVal = keepRawValue ? entry.key : normalizeWhitespace(entry.key);
    const variable = findCssVariableForValue(cssVariables, rawVal);
    return {
      token: `${prefix}.${index + 1}`,
      value: variable ? `${rawVal} (${variable})` : rawVal,
      usage: entry.count
    };
  });
}

// Several variables often share a value (#fff is "--white", "--bg",
// "--cta-stroke-color"...): prefer the one whose name matches the role.
const ROLE_HINTS = {
  surface: /bg|background|surface|canvas|base|page|paper|body/,
  text: /text|fg|foreground|ink|copy|body|heading|title|content/,
  border: /border|stroke|line|divider|outline|separator/,
  brand: /brand|primary|accent|action|cta|link|highlight/,
  focus: /focus|ring|outline/
};

function findCssVariableForValue(cssVariables, value, role) {
  if (!cssVariables || !value) return null;
  const valLower = String(value).toLowerCase().trim();
  const canonicalValue = toCanonicalColor(valLower) || valLower;
  const matches = [];
  for (const variable of cssVariables) {
    const varValRaw = String(variable.value).toLowerCase().trim();
    const varVal = toCanonicalColor(varValRaw) || varValRaw;
    if (varVal === canonicalValue) matches.push(variable.name);
  }
  if (matches.length === 0) return null;
  const hint = ROLE_HINTS[role];
  if (!hint) return `var(${matches.sort((x, y) => x.length - y.length)[0]})`;
  // Score names: role keyword +2, plain palette name +1, component-state
  // name -2. Below 1 the mapping would mislead the agent: emit none.
  const scoreName = (name) => {
    const n = name.toLowerCase();
    let score = 0;
    if (hint.test(n)) score += 2;
    if (/white|black|gr[ae]y|neutral|swatch|palette|color-d|-d{2,3}$/.test(n)) score += 1;
    if (role !== "brand" && /btn|button|cta|link|hover|active|pressed|overlay|statsig|badge|tooltip|toast/.test(n)) score -= 2;
    return score;
  };
  const best = matches.map((name) => ({ name, score: scoreName(name) })).sort((x, y) => y.score - x.score || x.name.length - y.name.length)[0];
  return best.score >= 1 ? `var(${best.name})` : null;
}

function sortNumericKeys(map) {
  return Array.from(map.keys())
    .map((key) => Number.parseFloat(key))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function parsePx(value) {
  if (!value || value === "normal" || value === "auto") {
    return null;
  }
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return round(parsed, 2);
}

function parseDuration(value) {
  if (!value) {
    return null;
  }
  const first = String(value).split(",")[0].trim();
  if (!first) {
    return null;
  }
  if (first.endsWith("ms")) {
    const parsed = Number.parseFloat(first);
    return Number.isFinite(parsed) ? round(parsed, 1) : null;
  }
  if (first.endsWith("s")) {
    const parsed = Number.parseFloat(first);
    return Number.isFinite(parsed) ? round(parsed * 1000, 1) : null;
  }
  return null;
}

/** Opaque #rrggbb of any CSS color (alpha ignored), "transparent" if invisible. */
function toCanonicalColor(value) {
  if (!value) {
    return null;
  }
  const raw = normalizeWhitespace(String(value).toLowerCase());
  if (!raw) {
    return null;
  }
  const parsed = parseCssColor(raw);
  if (!parsed) {
    return raw;
  }
  // A fully transparent color must never collapse to #000000.
  return parsed.a < 0.04 ? "transparent" : rgbToHex(parsed);
}

function isTransparent(value) {
  return value.includes("transparent");
}

function normalizeWhitespace(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function round(value, precision) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clusterColorMap(colorMap) {
  if (colorMap.size <= 1) {
    return colorMap;
  }

  const sortedEntries = Array.from(colorMap.entries()).sort((a, b) => b[1] - a[1]);
  const clusteredMap = new Map();

  for (const [color, count] of sortedEntries) {
    const rgb = hexToRgb(color);
    if (!rgb) {
      clusteredMap.set(color, (clusteredMap.get(color) || 0) + count);
      continue;
    }

    let merged = false;
    for (const centroid of clusteredMap.keys()) {
      const centroidRgb = hexToRgb(centroid);
      if (centroidRgb) {
        const dist = Math.sqrt(
          (rgb.r - centroidRgb.r) ** 2 +
          (rgb.g - centroidRgb.g) ** 2 +
          (rgb.b - centroidRgb.b) ** 2
        );
        // Only near-identical shades merge: #f9fafb vs #ffffff is a real design token.
        if (dist < 6.0) {
          clusteredMap.set(centroid, clusteredMap.get(centroid) + count);
          merged = true;
          break;
        }
      }
    }

    if (!merged) {
      clusteredMap.set(color, count);
    }
  }

  return clusteredMap;
}
