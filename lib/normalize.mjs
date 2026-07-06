const SIZE_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];
const RADIUS_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl"];
const SURFACE_NAMES = ["base", "muted", "raised", "strong"];
const TEXT_NAMES = ["primary", "secondary", "tertiary", "inverse"];
const BORDER_NAMES = ["default", "muted", "strong"];
const MOTION_NAMES = ["instant", "fast", "normal", "slow", "slower"];

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

  for (const row of payload.colors || []) {
    const text = toCanonicalColor(row.textColor);
    const bg = toCanonicalColor(row.backgroundColor);
    const border = toCanonicalColor(row.borderColor);
    const outline = toCanonicalColor(row.outlineColor);

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
    const easing = normalizeWhitespace(row.transitionTimingFunction || row.animationTimingFunction);

    if (duration !== null && duration > 0) {
      increment(motionDurationMap, String(duration));
    }
    if (easing && easing !== "ease") {
      increment(motionEasingMap, easing);
    }
  }

  // The measured page canvas must rank first among surfaces: on small
  // pages, button backgrounds can otherwise outnumber the real canvas.
  const pageBackground = toCanonicalColor(payload.pageBackground);
  if (pageBackground && !isTransparent(pageBackground) && pageBackground.startsWith("#")) {
    let maxCount = 0;
    for (const count of backgroundColorMap.values()) {
      maxCount = Math.max(maxCount, count);
    }
    backgroundColorMap.set(
      pageBackground,
      (backgroundColorMap.get(pageBackground) || 0) + maxCount + 1
    );
  }

  const typographyScale = toTokenRows(sortNumericKeys(typographyMap), SIZE_NAMES, "font.size", false, "px", payload.cssVariables);
  const mainFontStyle = inferMainFontStyle(payload.typography || [], fontFamilyMap);
  const spacingScale = toTokenRows(sortNumericKeys(spacingMap), [], "space", true, "px", payload.cssVariables);
  const radiusTokens = toTokenRows(sortNumericKeys(radiusMap), RADIUS_NAMES, "radius", false, "px", payload.cssVariables);
  const shadowTokens = toRankedTokenRows(shadowMap, "shadow", false, payload.cssVariables);
  const motionDurationTokens = toTokenRows(sortNumericKeys(motionDurationMap), MOTION_NAMES, "motion.duration", false, "ms", payload.cssVariables);
  const motionEasingTokens = toRankedTokenRows(motionEasingMap, "motion.easing", true, payload.cssVariables);

  const colorPalette = buildColorTokens(
    clusterColorMap(textColorMap),
    clusterColorMap(backgroundColorMap),
    clusterColorMap(borderColorMap),
    clusterColorMap(focusColorMap),
    payload.cssVariables
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
  const formControl = payload.formControl && typeof payload.formControl === "object" ? payload.formControl : null;
  const linkSpec = payload.linkSpec && typeof payload.linkSpec === "object" ? payload.linkSpec : null;
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
    ["shop", "product", "checkout", "cart", "sku", "inventory", "buy now", "shipping", "order", "wishlist"],
    0.8,
    evidence,
    "e-commerce"
  );
  surfaceScores.ecommerce += numericCue(counts.productMarkers, 1, 1.1, evidence, "product markers");
  surfaceScores.ecommerce += numericCue(counts.checkoutMarkers, 1, 1.2, evidence, "checkout markers");

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
    ["enterprise", "teams", "pricing", "sales", "compliance", "roi", "case study", "customers", "business"],
    0.55,
    evidence,
    "business audience"
  );

  audienceScores.consumer += keywordScore(
    corpus,
    ["shop", "cart", "checkout", "buy", "shipping", "deal", "discount", "collection", "product"],
    0.65,
    evidence,
    "consumer audience"
  );
  audienceScores.consumer += numericCue(counts.productMarkers, 1, 0.6, evidence, "consumer product markers");

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
    if (corpus.includes(keyword)) {
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
  const [key, score] = rows[0] || ["webapp", 0];
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
  return "website visitors and product users";
}

function dedupeEvidence(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function inferMainFontStyle(typographyRows, fontFamilyMap) {
  const topFamilyEntry = topEntries(fontFamilyMap, 1)[0];
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
  const names = ["primary", "secondary", "tertiary", "ghost"];
  return variants
    .filter((item) => item && item.spec)
    .slice(0, 4)
    .map((item, index) => ({
      name: names[index] || `variant${index + 1}`,
      count: Number(item.count) || 1,
      example: String(item.example || ""),
      spec: {
        background: canonicalizeIfColor(item.spec.background),
        color: canonicalizeIfColor(item.spec.color),
        border: String(item.spec.border || "none"),
        borderRadius: String(item.spec.borderRadius || "0px"),
        padding: String(item.spec.padding || ""),
        fontSize: String(item.spec.fontSize || ""),
        fontWeight: String(item.spec.fontWeight || ""),
        boxShadow: String(item.spec.boxShadow || ""),
        textTransform: String(item.spec.textTransform || "")
      }
    }));
}

function canonicalizeIfColor(value) {
  const text = String(value || "");
  // Preserve transparency: rgba alpha would be lost by hex conversion.
  const alphaMatch = text.match(/^rgba\([^)]+,\s*([\d.]+)\s*\)$/);
  if (alphaMatch) {
    const alpha = Number.parseFloat(alphaMatch[1]);
    if (alpha === 0) {
      return "transparent";
    }
    if (alpha < 1) {
      return text;
    }
  }
  const canonical = toCanonicalColor(text);
  return canonical && canonical.startsWith("#") ? canonical : text;
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

function buildColorTokens(textMap, bgMap, borderMap, focusMap, cssVariables = []) {
  const rows = [];

  const textRows = topEntries(textMap, 4);
  textRows.forEach((entry, index) => {
    const variable = findCssVariableForValue(cssVariables, entry.key);
    rows.push({
      token: `color.text.${TEXT_NAMES[index] || `level${index + 1}`}`,
      value: variable ? `${entry.key} (${variable})` : entry.key,
      usage: entry.count
    });
  });

  const bgRows = topEntries(bgMap, 4);
  bgRows.forEach((entry, index) => {
    const variable = findCssVariableForValue(cssVariables, entry.key);
    rows.push({
      token: `color.surface.${SURFACE_NAMES[index] || `level${index + 1}`}`,
      value: variable ? `${entry.key} (${variable})` : entry.key,
      usage: entry.count
    });
  });

  const borderRows = topEntries(borderMap, 3);
  borderRows.forEach((entry, index) => {
    const variable = findCssVariableForValue(cssVariables, entry.key);
    rows.push({
      token: `color.border.${BORDER_NAMES[index] || `level${index + 1}`}`,
      value: variable ? `${entry.key} (${variable})` : entry.key,
      usage: entry.count
    });
  });

  const focusRow = topEntries(focusMap, 1)[0];
  if (focusRow) {
    const variable = findCssVariableForValue(cssVariables, focusRow.key);
    rows.push({
      token: "color.focus.ring",
      value: variable ? `${focusRow.key} (${variable})` : focusRow.key,
      usage: focusRow.count
    });
  }

  return dedupeByValue(rows);
}

function dedupeByValue(rows) {
  const byValue = new Map();
  for (const row of rows) {
    const existing = byValue.get(row.value);
    if (!existing || row.usage > existing.usage) {
      byValue.set(row.value, row);
    }
  }
  return Array.from(byValue.values());
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

function findCssVariableForValue(cssVariables, value) {
  if (!cssVariables || !value) return null;
  const valLower = String(value).toLowerCase().trim();
  
  const canonicalValue = toCanonicalColor(valLower) || valLower;

  for (const variable of cssVariables) {
    const varValRaw = String(variable.value).toLowerCase().trim();
    const varVal = toCanonicalColor(varValRaw) || varValRaw;
    if (varVal === canonicalValue) {
      return `var(${variable.name})`;
    }
  }
  return null;
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

function toCanonicalColor(value) {
  if (!value) {
    return null;
  }
  const raw = normalizeWhitespace(String(value).toLowerCase());
  if (!raw) {
    return null;
  }
  if (raw === "transparent") {
    return "transparent";
  }
  if (raw.startsWith("#")) {
    return raw;
  }
  const oklch = parseOklch(raw);
  if (oklch) {
    // Fully transparent oklch behaves like transparent rgba.
    return oklch.alpha === 0 ? "transparent" : oklchToHex(oklch.l, oklch.c, oklch.h);
  }
  const rgb = parseRgbLike(raw);
  if (!rgb) {
    return raw;
  }
  // A fully transparent color must never collapse to #000000: it is
  // the default background of almost every element on every site.
  if (rgb.a === 0) {
    return "transparent";
  }
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function parseRgbLike(value) {
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) {
    return null;
  }
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  const [r, g, b] = parts;
  if (![r, g, b].every((part) => Number.isFinite(part))) {
    return null;
  }
  return {
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
    a: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
  };
}

/** Parses "oklch(0.208 0.042 265.755)" / "oklch(62% 0.2 30 / 0.5)". */
function parseOklch(value) {
  const match = value.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/);
  if (!match) {
    return null;
  }
  let l = Number.parseFloat(match[1]);
  if (match[1].endsWith("%")) {
    l = l / 100;
  }
  let alpha = 1;
  if (match[4] !== undefined) {
    alpha = Number.parseFloat(match[4]);
    if (match[4].endsWith("%")) {
      alpha = alpha / 100;
    }
  }
  return { l, c: Number.parseFloat(match[2]), h: Number.parseFloat(match[3]), alpha };
}

/** OKLCH → OKLab → linear sRGB → sRGB hex (standard reference math). */
function oklchToHex(l, c, h) {
  const hr = (h * Math.PI) / 180;
  const labA = c * Math.cos(hr);
  const labB = c * Math.sin(hr);

  const l_ = (l + 0.3963377774 * labA + 0.2158037573 * labB) ** 3;
  const m_ = (l - 0.1055613458 * labA - 0.0638541728 * labB) ** 3;
  const s_ = (l - 0.0894841775 * labA - 1.291485548 * labB) ** 3;

  const linR = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const linG = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const linB = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;

  const toByte = (linear) => {
    const clamped = Math.max(0, Math.min(1, linear));
    const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return clampByte(srgb * 255);
  };
  return rgbToHex(toByte(linR), toByte(linG), toByte(linB));
}

function rgbToHex(r, g, b) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value) {
  return value.toString(16).padStart(2, "0");
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
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
        if (dist < 18.0) {
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

function hexToRgb(hex) {
  if (!hex || !hex.startsWith("#")) {
    return null;
  }
  const clean = hex.substring(1);
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return { r, g, b };
  }
  return null;
}
