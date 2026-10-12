/**
 * Keys_Osi deep probe — injected in the ISOLATED world (read-only).
 * Collects the page-level signals the main extractor does not cover:
 * real copy (for voice & tone), imagery treatment, icon system, logo,
 * dark-mode pairing, form state styles, modern CSS usage, z-index layers
 * and background patterns. Interpretation lives in lib/deep-signals.mjs;
 * this script only measures.
 *
 * Guarantees: never mutates the page (no DOM writes, no events, no network),
 * bounded in time (soft budget checked inside every loop) and in size (the
 * result is shrunk until its JSON fits MAX_BYTES). Cross-origin stylesheets
 * throw on cssRules access; they are counted, not read.
 * The completion value of this script is the probe result.
 */
(() => {
  const T0 = performance.now();
  const BUDGET_MS = 1100;
  const MAX_BYTES = 190000;
  const MAX_RULES = 12000;
  const MAX_ELEMENTS = 3500;
  const now = () => performance.now() - T0;
  const late = () => now() > BUDGET_MS;
  const truncated = [];

  const safe = (fn, fallback = null) => {
    try {
      const value = fn();
      return value === undefined ? fallback : value;
    } catch (error) {
      return fallback;
    }
  };
  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const clip = (text, max) => {
    const value = clean(text);
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  };
  const bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
  const topOf = (map, limit) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const csOf = (el, pseudo) => safe(() => getComputedStyle(el, pseudo || null), null);
  const rectOf = (el) => safe(() => el.getBoundingClientRect(), null);
  const isShown = (el, rect, cs) =>
    !!rect && rect.width > 0 && rect.height > 0 && !!cs && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
  const label = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim()
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    return clip(`${el.tagName.toLowerCase()}${id}${cls}`, 60);
  };
  const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  const docOrigin = location.origin;

  /* ---------------------------------------------------------------- *
   * 1. Stylesheet pass — one walk feeds dark mode, form states,
   *    modern CSS and declared z-index.
   * ---------------------------------------------------------------- */
  const sheets = { total: 0, readable: 0, crossOrigin: 0, rules: 0, bytesScanned: 0 };
  const modern = {
    containerQueries: 0, containerType: 0, has: 0, subgrid: 0, viewTransitions: 0,
    viewTransitionNames: 0, layers: 0, nesting: 0, clamp: 0, minMax: 0, colorMix: 0,
    oklch: 0, oklab: 0, labLch: 0, displayP3: 0, lightDark: 0, scrollTimeline: 0,
    viewTimeline: 0, animationTimeline: 0, propertyRule: 0, scope: 0, startingStyle: 0,
    anchor: 0, textWrapBalance: 0, textWrapPretty: 0, isWhere: 0, focusVisible: 0,
    aspectRatio: 0, backdropFilter: 0, logicalProps: 0, supports: 0, reducedMotion: 0,
    fieldSizing: 0, popover: 0, mask: 0
  };
  const modernSamples = {};
  const layerNames = new Set();
  const containerConditions = new Map();
  const propertyNames = [];
  const sampleModern = (key, value) => {
    const list = modernSamples[key] || (modernSamples[key] = []);
    if (list.length < 3) list.push(clip(value, 140));
  };

  const dark = {
    mediaRules: 0,
    classRules: 0,
    attributeRules: 0,
    lightDarkFn: 0,
    colorSchemeDecls: [],
    darkSelectors: [],
    lightMediaRules: 0
  };
  const lightVars = new Map();
  const darkVars = new Map();

  const formStates = { focus: [], invalid: [], valid: [], disabled: [], placeholder: [], checked: [], hover: [] };
  const formCounts = { focus: 0, invalid: 0, valid: 0, disabled: 0, placeholder: 0, checked: 0, hover: 0 };
  const zDeclared = new Map();
  const zDeclaredSamples = new Map();
  const accentColors = new Map();

  const STATE_PATTERNS = {
    focus: /:focus(-visible|-within)?\b/i,
    invalid: /:(user-)?invalid\b|\[aria-invalid(=["']?true["']?)?\]|\.(is-invalid|has-error|invalid|error)\b/i,
    valid: /:(user-)?valid\b|\.(is-valid|has-success)\b/i,
    disabled: /:disabled\b|\[disabled\]|\[aria-disabled(=["']?true["']?)?\]|\.(is-)?disabled\b/i,
    placeholder: /::?placeholder\b|:placeholder-shown\b/i,
    checked: /:checked\b|\[aria-checked=["']?true/i,
    hover: /:hover\b/i
  };
  const FIELD_PATTERN = /\b(input|textarea|select)\b|\[type=|\.form-|field|control|\.input|checkbox|radio|switch/i;
  const STATE_PROPS = [
    "outline", "outline-color", "outline-width", "outline-style", "outline-offset", "box-shadow",
    "border", "border-color", "border-width", "background", "background-color", "color",
    "opacity", "cursor", "text-decoration", "accent-color", "filter"
  ];
  const DARK_SELECTOR = /(^|[\s,>+~(])(:root|html|body)?(\.dark\b|\.dark-mode\b|\.dark-theme\b|\.theme-dark\b|\.is-dark\b|\.mode-dark\b)/i;
  const DARK_ATTRIBUTE = /\[data-(theme|mode|color-scheme|color-mode|bs-theme|scheme)\s*=\s*["']?dark["']?\]|\[class~=["']?dark["']?\]/i;
  const ROOT_SELECTOR = /^\s*(:root|html|body|:host|\[data-(theme|mode|color-scheme|color-mode|bs-theme|scheme)=["']?light["']?\]|\.light|\.theme-light|html\.light|:root\.light)\s*$/i;

  const kindOf = (rule) => safe(() => rule.constructor.name, "");

  const collectVars = (style, target) => {
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (prop.startsWith("--") && !target.has(prop) && target.size < 600) {
        target.set(prop, clip(style.getPropertyValue(prop), 120));
      }
    }
  };

  const pickDecls = (style) => {
    const out = {};
    for (const prop of STATE_PROPS) {
      const value = style.getPropertyValue(prop);
      if (value) out[prop] = clip(value, 120);
    }
    return out;
  };

  const scanDeclarations = (text, selector) => {
    // Regex tests on the declaration block only (not the whole rule) keep
    // the scan linear and the samples meaningful.
    const tests = [
      ["clamp", /\bclamp\(/i],
      ["minMax", /(^|[^a-z-])(min|max)\(/i],
      ["colorMix", /\bcolor-mix\(/i],
      ["oklch", /\boklch\(/i],
      ["oklab", /\boklab\(/i],
      ["labLch", /(^|[^a-z-])(lab|lch)\(/i],
      ["displayP3", /color\(\s*display-p3/i],
      ["lightDark", /\blight-dark\(/i],
      ["subgrid", /grid-template-(columns|rows)\s*:\s*subgrid/i],
      ["containerType", /container(-type)?\s*:\s*(inline-size|size|[a-z-]+\s*\/\s*(inline-size|size))/i],
      ["viewTransitionNames", /view-transition-name\s*:\s*(?!none)/i],
      ["animationTimeline", /animation-timeline\s*:/i],
      ["scrollTimeline", /scroll-timeline(-name)?\s*:|\bscroll\(\s*(root|nearest|self|block|inline|x|y|\))/i],
      ["viewTimeline", /view-timeline(-name)?\s*:|\bview\(\s*(block|inline|x|y|\)|\d)/i],
      ["anchor", /anchor-name\s*:|position-anchor\s*:|\banchor\(/i],
      ["textWrapBalance", /text-wrap(-style)?\s*:\s*balance/i],
      ["textWrapPretty", /text-wrap(-style)?\s*:\s*pretty/i],
      ["aspectRatio", /aspect-ratio\s*:/i],
      ["backdropFilter", /backdrop-filter\s*:\s*(?!none)/i],
      ["logicalProps", /(margin|padding|inset|border)-(inline|block)(-start|-end)?\s*:/i],
      ["fieldSizing", /field-sizing\s*:/i],
      ["mask", /(-webkit-)?mask(-image)?\s*:\s*(?!none)/i]
    ];
    for (const [key, re] of tests) {
      if (re.test(text)) {
        modern[key]++;
        sampleModern(key, `${selector} { ${text.slice(0, 100)} }`);
      }
    }
    if (/\blight-dark\(/i.test(text)) dark.lightDarkFn++;
  };

  const visitStyleRule = (rule, ctx) => {
    const selector = rule.selectorText || "";
    const style = rule.style;
    if (!style) return;
    const text = style.cssText || "";
    sheets.bytesScanned += text.length + selector.length;

    if ((rule.cssRules && rule.cssRules.length > 0) || ctx.parentStyle || selector.includes("&")) {
      modern.nesting++;
      if (modern.nesting <= 3) sampleModern("nesting", selector);
    }
    if (/:has\(/i.test(selector)) { modern.has++; sampleModern("has", selector); }
    if (/:(is|where)\(/i.test(selector)) modern.isWhere++;
    if (/:focus-visible/i.test(selector)) modern.focusVisible++;
    if (/::view-transition/i.test(selector)) { modern.viewTransitions++; sampleModern("viewTransitions", selector); }
    if (/:popover-open|\[popover\]/i.test(selector)) modern.popover++;
    if (text) scanDeclarations(text, selector);

    // Dark-mode pairing: variables set under a dark context vs at the root.
    const scheme = style.getPropertyValue("color-scheme");
    if (scheme && dark.colorSchemeDecls.length < 6) dark.colorSchemeDecls.push(`${clip(selector, 60)} { color-scheme: ${clean(scheme)} }`);
    if (ctx.darkMedia) {
      collectVars(style, darkVars);
    } else if (DARK_SELECTOR.test(selector) || DARK_ATTRIBUTE.test(selector)) {
      if (DARK_ATTRIBUTE.test(selector)) dark.attributeRules++;
      else dark.classRules++;
      if (dark.darkSelectors.length < 8 && !dark.darkSelectors.includes(clip(selector, 80))) dark.darkSelectors.push(clip(selector, 80));
      collectVars(style, darkVars);
    } else if (!ctx.lightMedia && ROOT_SELECTOR.test(selector)) {
      collectVars(style, lightVars);
    } else if (ctx.lightMedia) {
      collectVars(style, lightVars);
    }

    // Form state styles.
    for (const [state, re] of Object.entries(STATE_PATTERNS)) {
      if (!re.test(selector)) continue;
      const isField = FIELD_PATTERN.test(selector);
      const isGeneric = state === "focus" && /^\s*(\*|:root|html|body)?\s*:focus(-visible)?\s*$/i.test(selector);
      if (state === "hover" && !isField) continue;
      if (!isField && !isGeneric && state !== "focus" && state !== "disabled" && state !== "placeholder") continue;
      const decls = pickDecls(style);
      if (!Object.keys(decls).length) continue;
      formCounts[state]++;
      const list = formStates[state];
      // Field selectors first: they are what an agent must reproduce.
      if (list.length < 6) list.push({ selector: clip(selector, 100), field: isField, decls });
      else if (isField) {
        const generic = list.findIndex((entry) => !entry.field);
        if (generic >= 0) list[generic] = { selector: clip(selector, 100), field: true, decls };
      }
    }

    const accent = style.getPropertyValue("accent-color");
    if (accent && accent !== "auto") bump(accentColors, clean(accent));

    const z = style.getPropertyValue("z-index");
    if (z && /^-?\d+$/.test(z.trim())) {
      const value = Number(z.trim());
      bump(zDeclared, value);
      const samples = zDeclaredSamples.get(value) || [];
      if (samples.length < 3) samples.push(clip(selector, 60));
      zDeclaredSamples.set(value, samples);
    }
  };

  const walkRules = (rules, ctx) => {
    for (let i = 0; i < rules.length; i++) {
      if (sheets.rules >= MAX_RULES || late()) {
        if (!truncated.includes("stylesheets")) truncated.push("stylesheets");
        return;
      }
      const rule = rules[i];
      sheets.rules++;
      const kind = kindOf(rule);
      let childCtx = ctx;
      if (kind === "CSSStyleRule") {
        visitStyleRule(rule, ctx);
        childCtx = { ...ctx, parentStyle: true };
      } else if (kind === "CSSMediaRule") {
        const media = safe(() => rule.media.mediaText, "") || "";
        if (/prefers-color-scheme\s*:\s*dark/i.test(media)) { dark.mediaRules++; childCtx = { ...ctx, darkMedia: true }; }
        if (/prefers-color-scheme\s*:\s*light/i.test(media)) { dark.lightMediaRules++; childCtx = { ...ctx, lightMedia: true }; }
        if (/prefers-reduced-motion/i.test(media)) modern.reducedMotion++;
      } else if (kind === "CSSContainerRule") {
        modern.containerQueries++;
        bump(containerConditions, clip(rule.conditionText || rule.containerQuery || "", 80));
      } else if (kind === "CSSLayerBlockRule") {
        modern.layers++;
        if (rule.name) layerNames.add(rule.name);
      } else if (kind === "CSSLayerStatementRule") {
        modern.layers++;
        for (const name of rule.nameList || []) layerNames.add(name);
      } else if (kind === "CSSSupportsRule") {
        modern.supports++;
      } else if (kind === "CSSPropertyRule") {
        modern.propertyRule++;
        if (propertyNames.length < 10) propertyNames.push(rule.name);
      } else if (kind === "CSSScopeRule") {
        modern.scope++;
        sampleModern("scope", `@scope (${rule.start || ""})`);
      } else if (kind === "CSSStartingStyleRule") {
        modern.startingStyle++;
      } else if (kind === "CSSViewTransitionRule") {
        modern.viewTransitions++;
        sampleModern("viewTransitions", `@view-transition { navigation: ${rule.navigation || "auto"} }`);
      } else if (kind === "CSSKeyframesRule" || kind === "CSSFontFaceRule" || kind === "CSSPageRule") {
        continue;
      } else if (kind === "CSSImportRule") {
        const imported = safe(() => rule.styleSheet, null);
        if (imported) readSheet(imported);
        continue;
      }
      const children = safe(() => rule.cssRules, null);
      if (children && children.length) walkRules(children, childCtx);
    }
  };

  const seenSheets = new Set();
  function readSheet(sheet) {
    if (!sheet || seenSheets.has(sheet)) return;
    seenSheets.add(sheet);
    sheets.total++;
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch (error) {
      sheets.crossOrigin++;
      return;
    }
    if (!rules) return;
    sheets.readable++;
    walkRules(rules, {});
  }
  for (const sheet of Array.from(document.styleSheets || [])) readSheet(sheet);
  for (const sheet of safe(() => Array.from(document.adoptedStyleSheets || []), [])) readSheet(sheet);

  /* ---------------------------------------------------------------- *
   * 2. Element pass — computed z-index and background treatments of
   *    what is actually rendered. Large pages are strided so the
   *    sample still spans the whole document.
   * ---------------------------------------------------------------- */
  const allElements = document.body ? document.body.getElementsByTagName("*") : [];
  const stride = Math.max(1, Math.ceil(allElements.length / MAX_ELEMENTS));
  const zComputed = new Map();
  const bgCounts = { dotGrid: 0, lineGrid: 0, mesh: 0, noise: 0, svgPattern: 0, linear: 0, radial: 0, conic: 0, imageUrl: 0, glass: 0 };
  const bgSamples = [];
  const largeBgImages = [];
  let elementsScanned = 0;

  const smallSize = (size) => {
    const parts = String(size || "").match(/(\d+(?:\.\d+)?)px/g) || [];
    return parts.length > 0 && parts.every((part) => parseFloat(part) <= 80);
  };
  const classifyBackground = (image, size) => {
    const text = String(image).slice(0, 4096);
    const radial = (text.match(/radial-gradient\(/gi) || []).length;
    const linear = (text.match(/linear-gradient\(/gi) || []).length;
    const conic = (text.match(/conic-gradient\(/gi) || []).length;
    bgCounts.radial += radial;
    bgCounts.linear += linear;
    bgCounts.conic += conic;
    if (/feTurbulence|fractalNoise|(noise|grain)[\w-]*\.(png|svg|webp|jpe?g|gif)/i.test(text)) return "noise";
    if (/repeating-linear-gradient/i.test(text)) return "lineGrid";
    if (radial >= 1 && radial <= 2 && linear === 0 && smallSize(size)) return "dotGrid";
    if (linear >= 1 && smallSize(size) && /\b[0-3](\.\d+)?px\b/.test(text)) return "lineGrid";
    if (radial >= 2) return "mesh";
    if (/url\(["']?data:image\/svg/i.test(text)) return "svgPattern";
    if (/url\(/i.test(text)) return "imageUrl";
    return null;
  };

  for (let i = 0; i < allElements.length; i += stride) {
    if (late()) {
      truncated.push("elements");
      break;
    }
    const el = allElements[i];
    const cs = csOf(el);
    if (!cs) continue;
    elementsScanned++;
    if (cs.zIndex !== "auto" && cs.position !== "static") {
      const value = Number(cs.zIndex);
      if (Number.isFinite(value)) {
        const entry = zComputed.get(value) || { count: 0, positions: new Set(), elements: [] };
        entry.count++;
        entry.positions.add(cs.position);
        if (entry.elements.length < 3) entry.elements.push(label(el));
        zComputed.set(value, entry);
      }
    }
    const bdf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bdf && bdf !== "none") {
      bgCounts.glass++;
      if (bgSamples.length < 10) bgSamples.push({ kind: "glass", element: label(el), value: clip(bdf, 80) });
    }
    if (cs.backgroundImage && cs.backgroundImage !== "none") {
      const kind = classifyBackground(cs.backgroundImage, cs.backgroundSize);
      if (kind) {
        bgCounts[kind]++;
        if (kind !== "imageUrl" && bgSamples.length < 10) {
          bgSamples.push({ kind, element: label(el), value: clip(cs.backgroundImage, 160), size: clip(cs.backgroundSize, 40) });
        }
        if (kind === "imageUrl" && largeBgImages.length < 20) {
          const rect = rectOf(el);
          if (rect && rect.width >= 200 && rect.height >= 120) {
            const url = (cs.backgroundImage.match(/url\(["']?([^"')]+)/i) || [])[1] || "";
            largeBgImages.push({ src: clip(url, 160), w: Math.round(rect.width), h: Math.round(rect.height) });
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * 3. Logo — header/nav first, then the top-left home link.
   * ---------------------------------------------------------------- */
  const siteName = clean(
    safe(() => document.querySelector("meta[property='og:site_name']").content, "") ||
      (document.title || "").split(/\s[|\-–—·:]\s/)[0]
  );
  const homeHref = (a) => {
    const href = safe(() => new URL(a.getAttribute("href") || "", location.href), null);
    return !!href && href.origin === docOrigin && (href.pathname === "/" || href.pathname === "") && !href.hash;
  };
  const LOGO_CANDIDATES = [
    "header a[href] svg, nav a[href] svg",
    "header a[href] img, nav a[href] img",
    "header [class*='logo' i] svg, nav [class*='logo' i] svg, [id*='logo' i] svg, [class*='brand' i] svg",
    "header [class*='logo' i] img, nav [class*='logo' i] img, [id*='logo' i] img, img[alt*='logo' i], [class*='brand' i] img",
    "a[href] svg, a[href] img",
    "header svg, nav svg, header img, nav img"
  ];
  const sanitizeSvg = (markup) =>
    markup
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
      .slice(0, 6000);
  const svgColors = (svg) => {
    const colors = new Map();
    // Leaf shapes only: the <svg> root reports the default black fill even
    // when every shape overrides it.
    const shapes = Array.from(svg.querySelectorAll("path,circle,rect,polygon,ellipse,line,polyline,text")).slice(0, 60);
    const nodes = shapes.length ? shapes : [svg];
    for (const node of nodes) {
      const cs = csOf(node);
      if (!cs) continue;
      for (const value of [cs.fill, cs.stroke]) {
        if (value && value !== "none" && !/^url\(/.test(value) && value !== "rgba(0, 0, 0, 0)") bump(colors, value);
      }
    }
    return topOf(colors, 6).map(([value]) => value);
  };

  const logo = (() => {
    const started = now();
    for (const selector of LOGO_CANDIDATES) {
      const nodes = safe(() => Array.from(document.querySelectorAll(selector)).slice(0, 40), []);
      for (const node of nodes) {
        if (now() - started > 120) return null;
        const link = node.closest("a");
        // The generic last-resort selectors only qualify inside a home link
        // or a header, or near the top-left of the page.
        const rect = rectOf(node);
        const cs = csOf(node);
        if (!isShown(node, rect, cs)) continue;
        const inHeader = !!node.closest("header, nav, [role='banner']");
        const nearTop = rect.top + (window.scrollY || 0) < 220;
        if (!inHeader && !(link && homeHref(link) && nearTop) && !/logo/i.test(`${node.getAttribute("class") || ""} ${node.id || ""} ${node.getAttribute("alt") || ""}`)) continue;
        const tag = node.tagName.toLowerCase();
        const w = rect.width;
        const h = rect.height;
        if (tag === "svg" && (w < 16 || w > 320 || h < 12 || h > 140)) continue;
        if (tag === "img" && (w < 16 || w > 360 || h < 12 || h > 160)) continue;
        // A 24px square inside a nav link is usually an icon, not the logo.
        if (!/logo|brand/i.test(`${node.getAttribute("class") || ""} ${node.closest("[class*='logo' i],[class*='brand' i],[id*='logo' i]") ? "logo" : ""}`) && w <= 28 && h <= 28) continue;
        const base = {
          kind: tag,
          width: Math.round(w),
          height: Math.round(h),
          aspect: round(w / Math.max(1, h), 2),
          x: Math.round(rect.left),
          y: Math.round(rect.top + (window.scrollY || 0)),
          inHeader,
          homeLink: !!(link && homeHref(link)),
          href: link ? clip(link.getAttribute("href"), 120) : "",
          label: clip(node.getAttribute("aria-label") || (link && link.getAttribute("aria-label")) || node.getAttribute("title") || "", 80)
        };
        if (tag === "svg") {
          return { ...base, colors: svgColors(node), svg: sanitizeSvg(node.outerHTML), viewBox: node.getAttribute("viewBox") || "" };
        }
        return { ...base, src: clip(node.currentSrc || node.src, 300), alt: clip(node.getAttribute("alt"), 80), naturalWidth: node.naturalWidth || 0, naturalHeight: node.naturalHeight || 0 };
      }
    }
    // Text wordmark: a home link in the header without any graphic.
    const textLink = safe(() => Array.from(document.querySelectorAll("header a[href], nav a[href], a[href]")).slice(0, 80)
      .find((a) => homeHref(a) && !a.querySelector("svg,img") && clean(a.textContent).length > 1 && clean(a.textContent).length <= 40), null);
    if (textLink) {
      const rect = rectOf(textLink);
      const cs = csOf(textLink);
      if (isShown(textLink, rect, cs) && rect.top + (window.scrollY || 0) < 220) {
        return {
          kind: "text",
          text: clip(textLink.textContent, 40),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          inHeader: !!textLink.closest("header, nav, [role='banner']"),
          homeLink: true,
          font: {
            family: clip(cs.fontFamily, 80),
            weight: cs.fontWeight,
            size: cs.fontSize,
            letterSpacing: cs.letterSpacing,
            transform: cs.textTransform,
            color: cs.color
          }
        };
      }
    }
    return null;
  })();

  const brandAssets = {
    siteName: clip(siteName, 80),
    favicons: safe(() => Array.from(document.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='mask-icon']"))
      .slice(0, 6)
      .map((l) => ({ rel: l.getAttribute("rel"), href: clip(l.href, 200), sizes: l.getAttribute("sizes") || "", color: l.getAttribute("color") || "" })), []),
    ogImage: clip(safe(() => document.querySelector("meta[property='og:image']").content, ""), 200),
    themeColors: safe(() => Array.from(document.querySelectorAll("meta[name='theme-color']"))
      .map((m) => ({ color: clean(m.content), media: clean(m.getAttribute("media")) })), [])
  };

  /* ---------------------------------------------------------------- *
   * 4. Icons — inline SVG, icon fonts, small image icons.
   * ---------------------------------------------------------------- */
  const ICON_FONT_CLASS = /(^|\s)(fa[srlbdt]?|fa-[\w-]+|material-icons[\w-]*|material-symbols[\w-]*|bi|bi-[\w-]+|icon-[\w-]+|glyphicon[\w-]*|ri-[\w-]+|la[srb]?|ti|ti-[\w-]+|ion-[\w-]+|mdi|mdi-[\w-]+|icofont-[\w-]+|uil|uil-[\w-]+)(\s|$)/;
  const svgIcons = [];
  const iconSizes = new Map();
  let spriteUses = 0;
  let svgScanned = 0;
  const logoSvg = logo && logo.kind === "svg" ? logo.svg : null;
  for (const svg of safe(() => Array.from(document.querySelectorAll("svg")).slice(0, 500), [])) {
    if (late()) {
      truncated.push("icons");
      break;
    }
    svgScanned++;
    if (svg.parentElement && svg.parentElement.closest("svg")) continue;
    const rect = rectOf(svg);
    const cs = csOf(svg);
    if (!isShown(svg, rect, cs)) continue;
    if (rect.width < 8 || rect.height < 8 || rect.width > 64 || rect.height > 64) continue;
    if (logoSvg && svg.outerHTML.slice(0, 200) === logoSvg.slice(0, 200)) continue;
    const use = svg.querySelector("use");
    if (use) spriteUses++;
    const shapes = Array.from(svg.querySelectorAll("path,circle,rect,line,polyline,polygon,ellipse")).slice(0, 6);
    let strokeShapes = 0;
    let fillShapes = 0;
    let strokeWidth = 0;
    let roundCaps = 0;
    for (const shape of shapes.length ? shapes : [svg]) {
      const scs = csOf(shape);
      if (!scs) continue;
      const stroked = scs.stroke && scs.stroke !== "none" && parseFloat(scs.strokeWidth) > 0;
      const filled = scs.fill && scs.fill !== "none" && scs.fill !== "rgba(0, 0, 0, 0)";
      if (stroked) {
        strokeShapes++;
        strokeWidth = Math.max(strokeWidth, parseFloat(scs.strokeWidth) || 0);
        if (scs.strokeLinecap === "round" || scs.strokeLinejoin === "round") roundCaps++;
      }
      if (filled && !stroked) fillShapes++;
    }
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    bump(iconSizes, `${w}x${h}`);
    if (svgIcons.length < 80) {
      const ownClass = svg.getAttribute("class") || "";
      const parentClass = (svg.parentElement && svg.parentElement.getAttribute("class")) || "";
      svgIcons.push({
        w,
        h,
        viewBox: clip(svg.getAttribute("viewBox"), 40),
        cls: clip(`${ownClass} ${parentClass}`, 100),
        attrs: clip(["data-icon", "data-prefix", "data-slot", "data-lucide", "data-feather", "icon-name"]
          .filter((a) => svg.hasAttribute(a)).map((a) => `${a}=${svg.getAttribute(a)}`).join(" "), 80),
        sprite: use ? clip(use.getAttribute("href") || use.getAttribute("xlink:href"), 60) : "",
        style: strokeShapes && !fillShapes ? "stroke" : fillShapes && !strokeShapes ? "fill" : strokeShapes && fillShapes ? "mixed" : "unknown",
        strokeWidth: round(strokeWidth, 2),
        roundCaps: roundCaps > 0,
        color: clip(cs.color, 40)
      });
    }
  }

  const iconFonts = new Map();
  let iconFontCount = 0;
  for (const el of safe(() => Array.from(document.querySelectorAll("i, span, [class*='icon']")).slice(0, 1500), [])) {
    if (late()) break;
    const cls = typeof el.className === "string" ? el.className : "";
    if (!ICON_FONT_CLASS.test(cls)) continue;
    const before = csOf(el, "::before");
    const own = csOf(el);
    const family = before && before.content && before.content !== "none" && before.content !== "normal" ? before.fontFamily : own ? own.fontFamily : "";
    if (!family) continue;
    iconFontCount++;
    const key = clean(family.split(",")[0].replace(/["']/g, ""));
    const entry = iconFonts.get(key) || { count: 0, size: own ? own.fontSize : "", sample: clip(cls, 60) };
    entry.count++;
    iconFonts.set(key, entry);
  }

  /* ---------------------------------------------------------------- *
   * 5. Imagery — per-image treatment plus a 16×16 pixel probe on
   *    same-origin/data images to tell photos from flat illustration.
   * ---------------------------------------------------------------- */
  const pixelStats = (img) => {
    const src = img.currentSrc || img.src || "";
    const sameOrigin = /^(data|blob):/i.test(src) || safe(() => new URL(src, location.href).origin === docOrigin, false) || img.crossOrigin;
    if (!sameOrigin || !img.complete || !img.naturalWidth) return null;
    try {
      // A fresh canvas per image: one tainted draw would poison a shared one.
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      const bins = new Set();
      let flat = 0;
      let pairs = 0;
      let satSum = 0;
      const q = (i) => ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      for (let p = 0; p < 256; p++) {
        const i = p * 4;
        bins.add(q(i));
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        satSum += max === 0 ? 0 : (max - min) / max;
        if (p % 16 !== 15) {
          pairs++;
          if (q(i) === q(i + 4)) flat++;
        }
      }
      return { unique: bins.size, flat: round(flat / pairs, 2), sat: round(satSum / 256, 2) };
    } catch (error) {
      return null;
    }
  };
  const fmtOf = (src) => {
    const data = /^data:image\/([\w+.-]+)/i.exec(src);
    if (data) return data[1].replace("svg+xml", "svg").replace("jpeg", "jpg");
    const ext = /\.(jpe?g|png|webp|avif|gif|svg|jxl)(\?|#|$)/i.exec(src);
    return ext ? ext[1].toLowerCase().replace("jpeg", "jpg") : "";
  };
  const images = [];
  let pixelProbes = 0;
  for (const img of safe(() => Array.from(document.images).slice(0, 240), [])) {
    if (late()) {
      truncated.push("images");
      break;
    }
    const rect = rectOf(img);
    const cs = csOf(img);
    if (!isShown(img, rect, cs) || rect.width < 24 || rect.height < 24) continue;
    const src = img.currentSrc || img.src || "";
    const radiusPx = parseFloat(cs.borderTopLeftRadius) || 0;
    const minSide = Math.min(rect.width, rect.height);
    const wrap = img.parentElement ? csOf(img.parentElement) : null;
    const wrapRadius = wrap ? parseFloat(wrap.borderTopLeftRadius) || 0 : 0;
    const wrapClips = wrap && (wrap.overflow === "hidden" || wrap.overflow === "clip") && wrapRadius > 0;
    const effectiveRadius = Math.max(radiusPx, wrapClips ? wrapRadius : 0);
    const entry = {
      src: clip(src, 160),
      fmt: fmtOf(src),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      nw: img.naturalWidth || 0,
      nh: img.naturalHeight || 0,
      radius: /%$/.test(cs.borderTopLeftRadius) && parseFloat(cs.borderTopLeftRadius) >= 50
        ? "circle"
        : effectiveRadius >= minSide / 2 - 0.5 ? "circle" : Math.round(effectiveRadius),
      clip: cs.clipPath && cs.clipPath !== "none" ? clip(cs.clipPath, 60) : "",
      mask: (cs.maskImage && cs.maskImage !== "none") || (cs.webkitMaskImage && cs.webkitMaskImage !== "none") ? "mask" : "",
      filter: cs.filter && cs.filter !== "none" ? clip(cs.filter, 80) : "",
      blend: cs.mixBlendMode && cs.mixBlendMode !== "normal" ? cs.mixBlendMode : wrap && wrap.mixBlendMode !== "normal" ? wrap.mixBlendMode : "",
      fit: cs.objectFit,
      alt: clip(img.getAttribute("alt"), 80),
      header: !!img.closest("header, nav"),
      px: null
    };
    if (pixelProbes < 40 && rect.width >= 48 && rect.height >= 48 && !late()) {
      entry.px = pixelStats(img);
      if (entry.px) pixelProbes++;
    }
    images.push(entry);
  }
  const media = {
    videos: safe(() => Array.from(document.querySelectorAll("video")).filter((v) => { const r = rectOf(v); return r && r.width >= 120; }).length, 0),
    canvases: safe(() => Array.from(document.querySelectorAll("canvas")).filter((c) => { const r = rectOf(c); return r && r.width >= 200 && r.height >= 150; }).length, 0),
    modelViewers: safe(() => document.querySelectorAll("model-viewer, spline-viewer").length, 0),
    largeSvgs: safe(() => Array.from(document.querySelectorAll("svg")).slice(0, 300).filter((s) => { const r = rectOf(s); return r && r.width >= 160 && r.height >= 120; }).length, 0),
    pictureSources: safe(() => document.querySelectorAll("picture source").length, 0),
    lazy: safe(() => document.querySelectorAll("img[loading='lazy']").length, 0)
  };

  /* ---------------------------------------------------------------- *
   * 6. Copy — raw text for the voice & tone analysis.
   * ---------------------------------------------------------------- */
  const shownText = (el) => {
    const rect = rectOf(el);
    const cs = csOf(el);
    return isShown(el, rect, cs) ? cs : null;
  };
  const headings = [];
  for (const h of safe(() => Array.from(document.querySelectorAll("h1, h2, h3")).slice(0, 60), [])) {
    if (headings.length >= 24 || late()) break;
    const text = clip(h.textContent, 140);
    if (text.length < 2) continue;
    const cs = shownText(h);
    if (!cs) continue;
    headings.push({ level: h.tagName.toLowerCase(), text, transform: cs.textTransform });
  }
  const ctaMap = new Map();
  for (const el of safe(() => Array.from(document.querySelectorAll(
    "button, [role='button'], input[type='submit'], input[type='button'], a[class*='btn' i], a[class*='button' i], a[class*='cta' i]"
  )).slice(0, 200), [])) {
    if (ctaMap.size >= 40 || late()) break;
    const text = clip(el.tagName === "INPUT" ? el.value : el.textContent || el.getAttribute("aria-label"), 48);
    const words = text.split(" ").filter(Boolean).length;
    if (!text || words > 7 || text.length < 2) continue;
    if (!shownText(el)) continue;
    bump(ctaMap, text);
  }
  const paragraphs = [];
  let copyChars = 0;
  for (const p of safe(() => Array.from(document.querySelectorAll("p, li, blockquote, figcaption, dd")).slice(0, 600), [])) {
    if (copyChars > 14000 || paragraphs.length >= 60 || late()) break;
    const text = clean(p.textContent);
    if (text.length < 40 || p.querySelector("p")) continue;
    if (!shownText(p)) continue;
    const piece = clip(text, 320);
    paragraphs.push(piece);
    copyChars += piece.length;
  }
  const navLabels = safe(() => Array.from(document.querySelectorAll("nav a, header a"))
    .map((a) => clip(a.textContent, 30)).filter((t) => t.length > 1).slice(0, 20), []);

  /* ---------------------------------------------------------------- *
   * 7. Dark-mode runtime signals (no toggling, read only).
   * ---------------------------------------------------------------- */
  const root = document.documentElement;
  const darkRuntime = {
    colorScheme: clean(safe(() => getComputedStyle(root).colorScheme, "")),
    metaColorScheme: clean(safe(() => document.querySelector("meta[name='color-scheme']").content, "")),
    prefersDark: safe(() => matchMedia("(prefers-color-scheme: dark)").matches, false),
    rootClass: clip(root.getAttribute("class"), 120),
    rootTheme: clip(root.getAttribute("data-theme") || root.getAttribute("data-mode") || root.getAttribute("data-color-scheme") || root.getAttribute("data-bs-theme") || (document.body && document.body.getAttribute("data-theme")) || "", 30),
    toggles: safe(() => Array.from(document.querySelectorAll("button, [role='button'], [role='switch'], a, label"))
      .slice(0, 400)
      .map((el) => clean(`${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.textContent || ""}`).slice(0, 80))
      .filter((text) => /\b(dark|light|theme|night|sombre|clair|thème|nuit|modo oscuro|dunkel)\b/i.test(text) && text.length <= 80)
      .slice(0, 4), []),
    storageKeys: safe(() => Object.keys(localStorage).filter((k) => /theme|color-?scheme|dark|mode/i.test(k)).slice(0, 5), [])
  };
  const varPairs = [];
  for (const [name, darkValue] of darkVars) {
    if (varPairs.length >= 60) break;
    const lightValue = lightVars.get(name);
    if (lightValue !== undefined && lightValue !== darkValue) varPairs.push({ name, light: lightValue, dark: darkValue });
  }
  const darkOnly = [...darkVars.keys()].filter((name) => !lightVars.has(name)).slice(0, 20);

  /* ---------------------------------------------------------------- *
   * 8. Assemble, then shrink until the JSON fits.
   * ---------------------------------------------------------------- */
  const formControls = {
    inputs: safe(() => document.querySelectorAll("input:not([type='hidden']), textarea, select").length, 0),
    checkboxAccent: (() => {
      const box = safe(() => document.querySelector("input[type='checkbox'], input[type='radio']"), null);
      const cs = box ? csOf(box) : null;
      return cs && cs.accentColor && cs.accentColor !== "auto" ? cs.accentColor : "";
    })()
  };

  const result = {
    version: 1,
    meta: {
      url: location.href,
      title: clip(document.title, 120),
      lang: clean(root.getAttribute("lang")),
      durationMs: 0,
      bytes: 0,
      truncated,
      sheets,
      elementsTotal: allElements.length,
      elementsScanned,
      svgScanned
    },
    copy: {
      headings,
      ctas: topOf(ctaMap, 40).map(([text, count]) => ({ text, count })),
      paragraphs,
      nav: navLabels
    },
    imagery: { images, media, backgrounds: largeBgImages, pixelProbes },
    icons: {
      svg: svgIcons,
      svgCount: [...iconSizes.values()].reduce((a, b) => a + b, 0),
      sizes: topOf(iconSizes, 8).map(([size, count]) => ({ size, count })),
      spriteUses,
      fonts: [...iconFonts.entries()].map(([family, info]) => ({ family, ...info })),
      fontCount: iconFontCount,
      imgIcons: safe(() => Array.from(document.images).slice(0, 300).filter((img) => {
        const r = rectOf(img);
        return r && r.width > 0 && r.width <= 48 && r.height <= 48 && /\.svg|icon/i.test(img.currentSrc || img.src || "");
      }).length, 0)
    },
    logo,
    brandAssets,
    darkMode: {
      ...dark,
      ...darkRuntime,
      lightVarCount: lightVars.size,
      darkVarCount: darkVars.size,
      pairs: varPairs,
      darkOnly
    },
    formStates: { states: formStates, counts: formCounts, controls: formControls, accentColors: topOf(accentColors, 4).map(([v]) => v) },
    modernCss: {
      counts: modern,
      samples: modernSamples,
      layers: [...layerNames].slice(0, 12),
      containers: topOf(containerConditions, 6).map(([condition, count]) => ({ condition, count })),
      properties: propertyNames
    },
    zIndex: {
      declared: topOf(zDeclared, 30).map(([value, count]) => ({ value, count, selectors: zDeclaredSamples.get(value) || [] })),
      computed: [...zComputed.entries()].sort((a, b) => a[0] - b[0]).slice(0, 30)
        .map(([value, info]) => ({ value, count: info.count, positions: [...info.positions], elements: info.elements }))
    },
    backgrounds: { counts: bgCounts, samples: bgSamples }
  };

  let json = JSON.stringify(result);
  const shrinkSteps = [
    () => { if (result.logo && result.logo.svg) result.logo.svg = result.logo.svg.slice(0, 1500); },
    () => { result.copy.paragraphs = result.copy.paragraphs.slice(0, 20); },
    () => { result.icons.svg = result.icons.svg.slice(0, 30); },
    () => { result.imagery.images = result.imagery.images.slice(0, 60); },
    () => { result.formStates.states = Object.fromEntries(Object.entries(result.formStates.states).map(([k, v]) => [k, v.slice(0, 2)])); },
    () => { result.darkMode.pairs = result.darkMode.pairs.slice(0, 20); result.modernCss.samples = {}; },
    () => { result.copy.paragraphs = result.copy.paragraphs.slice(0, 6); result.imagery.images = result.imagery.images.slice(0, 20); result.backgrounds.samples = []; },
    () => { if (result.logo) delete result.logo.svg; result.zIndex.declared = result.zIndex.declared.slice(0, 10); }
  ];
  for (const step of shrinkSteps) {
    if (json.length <= MAX_BYTES) break;
    step();
    if (!truncated.includes("size")) truncated.push("size");
    json = JSON.stringify(result);
  }
  result.meta.durationMs = Math.round(now());
  result.meta.bytes = JSON.stringify(result).length;
  return result;
})();
