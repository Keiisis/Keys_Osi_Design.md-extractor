(function installExtractor() {
  const MESSAGE_TYPE = "TYPEUI_EXTRACT_STYLES";

  if (window.__typeuiStyleExtractorInstalled) {
    return;
  }

  window.__typeuiStyleExtractorInstalled = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "TYPEUI_PING") {
      sendResponse({ ok: true });
      return;
    }
    if (message && message.type === "TYPEUI_COPY_SITE") {
      collectPageResources(message.options || {})
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) => {
          const text = error instanceof Error ? error.message : "Unknown copy error";
          sendResponse({ ok: false, error: text });
        });
      return true;
    }
    if (message && message.type === "TYPEUI_LIST_LINKS") {
      try {
        sendResponse({ ok: true, links: collectInternalLinks() });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Link listing error" });
      }
      return;
    }
    if (message && message.type === "TYPEUI_PAGE_METRICS") {
      sendResponse({
        ok: true,
        scrollHeight: document.body ? document.body.scrollHeight : 0,
        viewportHeight: window.innerHeight,
        scrollY: window.scrollY
      });
      return;
    }
    if (message && message.type === "TYPEUI_SCROLL_TO") {
      window.scrollTo(0, Number(message.y) || 0);
      setTimeout(() => sendResponse({ ok: true, scrollY: window.scrollY }), 350);
      return true;
    }
    if (message && message.type === "TYPEUI_EXTRACT_ELEMENT") {
      try {
        const target = message.selector
          ? document.querySelector(message.selector)
          : lastContextMenuTarget;
        if (!target || !(target instanceof HTMLElement)) {
          sendResponse({ ok: false, error: "No element selected. Right-click an element first." });
          return;
        }
        sendResponse({ ok: true, ...serializeElementAsComponent(target) });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Element extraction error" });
      }
      return;
    }
    if (message && message.type === "TYPEUI_SAFE_INTERACT_OPEN") {
      try {
        sendResponse({ ok: true, ...openSafeDisclosures() });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Interaction error" });
      }
      return;
    }
    if (message && message.type === "TYPEUI_SAFE_INTERACT_CLOSE") {
      try {
        closeSafeDisclosures();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Interaction error" });
      }
      return;
    }
    if (!message || message.type !== MESSAGE_TYPE) {
      return;
    }

    extractStylesFromPage()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        const text = error instanceof Error ? error.message : "Unknown extraction error";
        sendResponse({ ok: false, error: text });
      });
    return true;
  });

  async function extractStylesFromPage() {
    const sampledElements = collectSampledElements(280);
    const typography = [];
    const colors = [];
    const spacing = [];
    const radius = [];
    const shadows = [];
    const motion = [];
    const backgroundImages = [];

    for (const el of sampledElements) {
      const style = computedStyleOf(el);
      typography.push({
        fontFamily: normalizeWhitespace(style.fontFamily),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing
      });

      // Border/outline colors are only meaningful when actually drawn:
      // Chrome reports the text color as the default for both, which
      // would poison the palette with phantom tokens.
      const hasBorder = Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none";
      const hasOutline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
      colors.push({
        textColor: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: hasBorder ? style.borderColor : "",
        outlineColor: hasOutline ? style.outlineColor : ""
      });

      spacing.push({
        marginTop: style.marginTop,
        marginRight: style.marginRight,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft
      });

      radius.push(style.borderRadius);
      shadows.push(style.boxShadow);
      if (style.backgroundImage && style.backgroundImage !== "none") {
        backgroundImages.push(style.backgroundImage);
      }
      motion.push({
        transitionDuration: style.transitionDuration,
        transitionTimingFunction: style.transitionTimingFunction,
        animationDuration: style.animationDuration,
        animationTimingFunction: style.animationTimingFunction
      });
    }

    let gsap = null;
    let mainWorldFrameworks = [];
    let scrollTriggers = [];
    let mainWorldLibs = [];
    try {
      const gsapEl = document.getElementById("__typeui_gsap_data");
      if (gsapEl) {
        const inspectorData = JSON.parse(gsapEl.getAttribute("data-gsap"));
        if (inspectorData && typeof inspectorData === "object") {
          if (inspectorData.gsap || inspectorData.frameworks) {
            gsap = inspectorData.gsap || null;
            mainWorldFrameworks = Array.isArray(inspectorData.frameworks)
              ? inspectorData.frameworks
              : [];
            scrollTriggers = Array.isArray(inspectorData.scrollTriggers)
              ? inspectorData.scrollTriggers
              : [];
            mainWorldLibs = Array.isArray(inspectorData.animationLibs)
              ? inspectorData.animationLibs
              : [];
          } else {
            // Backward-compatible: older inspector wrote the GSAP object directly.
            gsap = inspectorData;
          }
        }
      }
    } catch (e) {}

    const parallax = await measureParallax();

    return {
      source: {
        url: window.location.href,
        title: document.title || "Untitled page"
      },
      sampledAt: new Date().toISOString(),
      totalElements: document.querySelectorAll("*").length,
      sampledElements: sampledElements.length,
      typography,
      colors,
      spacing,
      radius,
      shadows,
      motion,
      backgroundImages,
      pageBackground: getPageBackgroundHex(),
      keyframes: collectKeyframes(),
      interactionStyles: collectInteractionStyles(),
      breakpoints: collectBreakpoints(),
      runtimeAnimations: collectRuntimeAnimations(),
      scrollTriggers,
      animationLibs: mergeAnimationLibs(mainWorldLibs, detectDomAnimationLibs()),
      canvasInventory: collectCanvasInventory(),
      parallax,
      a11y: collectAccessibilityMetrics(sampledElements),
      stack: detectStack(mainWorldFrameworks),
      resources: collectResourceInventory(),
      headings: collectHeadingStyles(),
      buttonVariants: collectButtonVariants(),
      formControl: collectFormControlSpec(),
      linkSpec: collectLinkSpec(),
      layout: collectLayoutSignals(),
      structure: collectPageStructure(),
      imageInventory: collectImageInventory(),
      forms: collectFormsMap(),
      components: collectComponentCounts(),
      siteSignals: collectSiteSignals(),
      cssVariables: collectCssVariables(),
      gsap,
      platformInfo: detectDesignPlatforms()
    };
  }

  function collectSampledElements(limit) {
    const selectors = [
      "body",
      "h1,h2,h3,h4,h5,h6",
      "p",
      "a",
      "button",
      "input,textarea,select",
      "label",
      "nav,header,footer,main,section,article,aside",
      "ul li,ol li",
      "table,th,td",
      "[role='button']",
      "[class*='card']",
      "[class*='btn']",
      "[tabindex]"
    ];

    const seen = new Set();
    const output = [];
    const deepElements = getAllElementsDeep(9000);

    for (const selector of selectors) {
      for (const node of deepElements) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        let matches = false;
        try {
          matches = node.matches(selector);
        } catch (e) {
          continue;
        }
        if (!matches) {
          continue;
        }
        if (seen.has(node)) {
          continue;
        }
        if (!isVisible(node)) {
          continue;
        }
        seen.add(node);
        output.push(node);
        if (output.length >= limit) {
          return output;
        }
      }
    }

    if (output.length === 0 && document.body) {
      output.push(document.body);
    }

    return output;
  }

  // Depth-first walk that also enters open shadow roots and same-origin
  // iframes, so web-component sites and embedded widgets are not
  // invisible to extraction.
  function getAllElementsDeep(limit) {
    const output = [];
    const stack = document.documentElement ? [document.documentElement] : [];
    let iframesEntered = 0;
    while (stack.length > 0 && output.length < limit) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      output.push(node);
      if (node.shadowRoot) {
        for (let i = node.shadowRoot.children.length - 1; i >= 0; i--) {
          stack.push(node.shadowRoot.children[i]);
        }
      }
      if (node.tagName === "IFRAME" && iframesEntered < 5) {
        try {
          const doc = node.contentDocument;
          if (doc && doc.documentElement) {
            iframesEntered += 1;
            stack.push(doc.documentElement);
          }
        } catch (e) {
          // cross-origin iframe
        }
      }
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
    return output;
  }

  function isVisible(el) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0) {
      if (el.namespaceURI !== "http://www.w3.org/2000/svg") {
        return false;
      }
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const style = computedStyleOf(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return true;
  }

  function collectComponentCounts() {
    const map = {
      buttons: "button, [role='button'], .btn, [class*='button']",
      links: "a[href]",
      inputs: "input, textarea, select",
      cards: ".card, [class*='card'], article",
      navigation: "nav, header",
      lists: "ul, ol",
      tables: "table"
    };

    return Object.entries(map).map(([type, selector]) => ({
      type,
      count: document.querySelectorAll(selector).length
    }));
  }

  function collectSiteSignals() {
    const title = document.title || "";
    const description = getMetaContent("description");
    const keywords = getMetaContent("keywords");
    const ogType = getMetaContent("og:type", true);
    const ogSiteName = getMetaContent("og:site_name", true);
    const appName = getMetaContent("application-name");

    const headings = collectTexts("h1, h2", 10, 120);
    const navTexts = collectTexts("nav a, nav button, header a, header button", 24, 50);
    const ctaTexts = collectTexts(
      "button, [role='button'], a[class*='button'], a[class*='btn'], input[type='submit']",
      24,
      40
    );

    const bodyText = getBodyTextSample(14000);

    return {
      title,
      description,
      keywords,
      ogType,
      ogSiteName,
      appName,
      pathname: window.location.pathname || "/",
      hostname: window.location.hostname || "",
      headings,
      navTexts,
      ctaTexts,
      textSample: bodyText,
      elementCounts: {
        forms: document.querySelectorAll("form").length,
        inputs: document.querySelectorAll("input, textarea, select").length,
        tables: document.querySelectorAll("table").length,
        codeBlocks: document.querySelectorAll("pre, code").length,
        articles: document.querySelectorAll("article").length,
        pricingSections: countNodesByText("section, div, article", ["pricing", "plans"]),
        productMarkers: document.querySelectorAll(
          "[itemtype*='Product'], [class*='product'], [id*='product'], [data-product]"
        ).length,
        authMarkers: countNodesByText("a, button, label, span", [
          "sign in",
          "log in",
          "login",
          "register",
          "dashboard",
          "workspace"
        ]),
        checkoutMarkers: countNodesByText("a, button, span", [
          "add to cart",
          "checkout",
          "buy now",
          "cart"
        ])
      }
    };
  }

  function getMetaContent(name, property = false) {
    const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    const value = document.querySelector(selector)?.getAttribute("content");
    return normalizeWhitespace(value || "");
  }

  function collectTexts(selector, limit, maxLength) {
    const seen = new Set();
    const output = [];
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }
      const text = normalizeWhitespace(node.textContent || "");
      if (!text || text.length > maxLength) {
        continue;
      }
      if (seen.has(text)) {
        continue;
      }
      seen.add(text);
      output.push(text);
      if (output.length >= limit) {
        break;
      }
    }
    return output;
  }

  function countNodesByText(selector, keywords) {
    const nodes = document.querySelectorAll(selector);
    let count = 0;
    for (const node of nodes) {
      const text = normalizeWhitespace((node.textContent || "").toLowerCase());
      if (!text) {
        continue;
      }
      if (keywords.some((keyword) => text.includes(keyword))) {
        count += 1;
      }
    }
    return count;
  }

  function normalizeWhitespace(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function getBodyTextSample(limit) {
    if (!document.body) {
      return "";
    }
    try {
      const clone = document.body.cloneNode(true);
      const elementsToRemove = clone.querySelectorAll("script, style, svg, iframe, noscript");
      for (const el of elementsToRemove) {
        el.remove();
      }
      return normalizeWhitespace(clone.textContent || "").slice(0, limit);
    } catch (e) {
      return normalizeWhitespace(document.body.textContent || "").slice(0, limit);
    }
  }

  function collectCssVariables() {
    const variables = {};
    try {
      forEachAccessibleRule((rule) => {
        if (rule.type !== CSSRule.STYLE_RULE) {
          return;
        }
        const selector = rule.selectorText ? rule.selectorText.toLowerCase() : "";
        if (selector.includes(":root") || selector.includes("body") || selector.includes("html") || selector.includes(":host") || selector === "*") {
          const style = rule.style;
          for (let i = 0; i < style.length; i++) {
            const prop = style[i];
            if (prop.startsWith("--")) {
              const val = style.getPropertyValue(prop).trim();
              if (val) {
                variables[prop] = val;
              }
            }
          }
        }
      });
    } catch (e) {
      // ignore
    }

    try {
      const inlineRoot = document.documentElement.style;
      for (let i = 0; i < inlineRoot.length; i++) {
        const prop = inlineRoot[i];
        if (prop.startsWith("--")) {
          variables[prop] = inlineRoot.getPropertyValue(prop).trim();
        }
      }
      if (document.body) {
        const inlineBody = document.body.style;
        for (let i = 0; i < inlineBody.length; i++) {
          const prop = inlineBody[i];
          if (prop.startsWith("--")) {
            variables[prop] = inlineBody.getPropertyValue(prop).trim();
          }
        }
      }
    } catch (e) {
      // ignore
    }

    return Object.entries(variables).map(([name, value]) => ({ name, value }));
  }

  // Computed style resolved through the element's own document view, so
  // elements inside same-origin iframes are measured correctly.
  function computedStyleOf(el) {
    const view = (el && el.ownerDocument && el.ownerDocument.defaultView) || window;
    return view.getComputedStyle(el);
  }

  function getSameOriginIframeDocs(limit) {
    const docs = [];
    for (const iframe of document.querySelectorAll("iframe")) {
      if (docs.length >= limit) break;
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.documentElement) {
          docs.push(doc);
        }
      } catch (e) {
        // cross-origin iframe
      }
    }
    return docs;
  }

  function getOpenShadowRoots(limit) {
    const roots = [];
    for (const el of getAllElementsDeep(6000)) {
      if (roots.length >= limit) break;
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
      }
    }
    return roots;
  }

  // Iterates every reachable CSS rule: document stylesheets, constructed
  // stylesheets (adoptedStyleSheets — CSS-in-JS, web components), open
  // shadow roots, and same-origin iframe documents.
  function forEachAccessibleRule(callback) {
    const sheets = [];
    const pushAll = (list) => {
      try {
        for (const sheet of list || []) {
          sheets.push(sheet);
        }
      } catch (e) {}
    };

    pushAll(document.styleSheets);
    pushAll(document.adoptedStyleSheets);
    for (const root of getOpenShadowRoots(50)) {
      pushAll(root.styleSheets);
      pushAll(root.adoptedStyleSheets);
    }
    for (const doc of getSameOriginIframeDocs(5)) {
      pushAll(doc.styleSheets);
      pushAll(doc.adoptedStyleSheets);
    }

    for (const sheet of sheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        walkRules(rules, callback, 0);
      } catch (e) {
        // ignore cross-origin stylesheet errors
      }
    }
  }

  function walkRules(rules, callback, depth) {
    if (depth > 3) {
      return;
    }
    for (const rule of rules) {
      callback(rule);
      if (rule.cssRules && (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE)) {
        try {
          walkRules(rule.cssRules, callback, depth + 1);
        } catch (e) {}
      }
    }
  }

  function collectKeyframes() {
    const results = [];
    const seen = new Set();
    forEachAccessibleRule((rule) => {
      if (rule.type !== CSSRule.KEYFRAMES_RULE || results.length >= 16) {
        return;
      }
      if (!rule.name || seen.has(rule.name)) {
        return;
      }
      seen.add(rule.name);
      const steps = [];
      try {
        for (const frame of rule.cssRules) {
          steps.push(normalizeWhitespace(frame.cssText).slice(0, 240));
          if (steps.length >= 8) break;
        }
      } catch (e) {}
      results.push({ name: rule.name, steps });
    });
    return results;
  }

  function collectInteractionStyles() {
    const interactionProps = [
      "color",
      "background",
      "background-color",
      "border",
      "border-color",
      "box-shadow",
      "outline",
      "outline-color",
      "outline-offset",
      "transform",
      "opacity",
      "filter",
      "text-decoration",
      "scale",
      "translate"
    ];
    const results = [];
    const seenSelectors = new Set();
    forEachAccessibleRule((rule) => {
      if (rule.type !== CSSRule.STYLE_RULE || results.length >= 40) {
        return;
      }
      const selector = rule.selectorText || "";
      if (!/:hover|:focus-visible|:focus|:active/.test(selector)) {
        return;
      }
      if (seenSelectors.has(selector)) {
        return;
      }
      const declarations = [];
      const seenProps = new Set();
      const pushDeclaration = (prop, value) => {
        if (value && !seenProps.has(prop) && declarations.length < 6) {
          seenProps.add(prop);
          declarations.push(`${prop}: ${value}`);
        }
      };
      try {
        // Query shorthands directly first: a shorthand written with var()
        // (e.g. `outline: 2px solid var(--x)`) leaves its longhands empty
        // in the CSSOM, so iterating style[i] alone would miss it.
        for (const prop of interactionProps) {
          pushDeclaration(prop, rule.style.getPropertyValue(prop).trim());
        }
        for (let i = 0; i < rule.style.length && declarations.length < 6; i++) {
          const prop = rule.style[i];
          const isInteresting = interactionProps.some(
            (candidate) => prop === candidate || prop.startsWith(`${candidate}-`)
          );
          if (!isInteresting) {
            continue;
          }
          pushDeclaration(prop, rule.style.getPropertyValue(prop).trim());
        }
      } catch (e) {}
      if (declarations.length === 0) {
        return;
      }
      seenSelectors.add(selector);
      results.push({
        selector: normalizeWhitespace(selector).slice(0, 140),
        declarations
      });
    });
    return results;
  }

  function collectBreakpoints() {
    const counts = new Map();
    forEachAccessibleRule((rule) => {
      if (rule.type !== CSSRule.MEDIA_RULE) {
        return;
      }
      const condition = rule.conditionText || (rule.media && rule.media.mediaText) || "";
      const matches = condition.matchAll(/\((?:min|max)-width:\s*([\d.]+)(px|em|rem)\)/g);
      for (const match of matches) {
        let px = Number.parseFloat(match[1]);
        if (match[2] === "em" || match[2] === "rem") {
          px = px * 16;
        }
        px = Math.round(px);
        if (Number.isFinite(px) && px > 0) {
          counts.set(px, (counts.get(px) || 0) + 1);
        }
      }
    });
    return Array.from(counts.entries())
      .map(([px, count]) => ({ px, count }))
      .sort((a, b) => a.px - b.px)
      .slice(0, 12);
  }

  async function collectPageResources(options = {}) {
    if (options.autoScroll !== false) {
      await autoScrollToTriggerLazyLoad();
    }

    const assets = [];
    const seenUrls = new Map();
    const usedPaths = new Set();

    // Multi-page crawls share one asset registry so every page reuses the
    // same local paths and only new assets are downloaded once.
    for (const seed of options.seedAssets || []) {
      if (seed && seed.url && seed.path) {
        seenUrls.set(seed.url, seed.path);
        usedPaths.add(seed.path);
      }
    }

    // Where this page's HTML file will live inside the clone folder,
    // e.g. "index.html" or "pages/about.html".
    const currentPagePath = String(options.currentPagePath || "index.html");
    const pageDirDepth = currentPagePath.split("/").length - 1;
    const assetPrefix = "../".repeat(pageDirDepth);

    function relFromCurrentPage(rootRelativePath) {
      return `${assetPrefix}${rootRelativePath}`;
    }

    function addAsset(url, folder, extFallback) {
      if (!url) return null;
      let absUrl;
      try {
        absUrl = new URL(url, window.location.href).href;
      } catch (e) {
        return null;
      }

      if (absUrl.startsWith("data:") || absUrl.startsWith("chrome-extension:") || absUrl.startsWith("blob:")) {
        return null;
      }

      if (seenUrls.has(absUrl)) {
        return seenUrls.get(absUrl);
      }

      let filename = absUrl.split("/").pop().split("?")[0].split("#")[0];
      if (!filename || !filename.includes(".")) {
        filename = `asset_${shortHash(absUrl)}${extFallback}`;
      }

      let relativePath = `${folder}/${filename}`;
      if (usedPaths.has(relativePath)) {
        const dotIndex = filename.lastIndexOf(".");
        const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
        const ext = dotIndex > 0 ? filename.slice(dotIndex) : extFallback;
        relativePath = `${folder}/${base}_${shortHash(absUrl)}${ext}`;
      }
      usedPaths.add(relativePath);
      seenUrls.set(absUrl, relativePath);
      assets.push({ url: absUrl, path: relativePath });
      return relativePath;
    }

    const styleLinks = document.querySelectorAll("link[rel='stylesheet']");
    for (const link of styleLinks) {
      const href = link.getAttribute("href");
      if (href) {
        addAsset(href, "css", ".css");
      }
    }

    const scriptTags = document.querySelectorAll("script[src]");
    for (const script of scriptTags) {
      const src = script.getAttribute("src");
      if (src) {
        addAsset(src, "js", ".js");
      }
    }

    const imgTags = document.querySelectorAll("img");
    for (const img of imgTags) {
      const src = img.getAttribute("src") || img.getAttribute("data-src");
      if (src) {
        addAsset(src, "img", ".png");
      }
      const srcset = img.getAttribute("srcset");
      if (srcset) {
        const parts = srcset.split(",");
        for (const part of parts) {
          const url = part.trim().split(/\s+/)[0];
          if (url) {
            addAsset(url, "img", ".png");
          }
        }
      }
    }

    const audioTags = document.querySelectorAll("audio, video, source");
    for (const media of audioTags) {
      const src = media.getAttribute("src") || media.getAttribute("data-src");
      if (src) {
        const isAudio = media.tagName.toLowerCase() === "audio" || (media.tagName.toLowerCase() === "source" && media.parentElement?.tagName.toLowerCase() === "audio");
        addAsset(src, isAudio ? "audio" : "video", isAudio ? ".mp3" : ".mp4");
      }
    }

    collectComputedBackgroundImageAssets(addAsset);
    collectSameOriginIframeAssets(addAsset);
    const siteMeta = collectSiteMetaAndAssets(addAsset);
    const generatedFiles = [
      ...collectInlineSvgIcons(),
      { path: "meta/site-meta.json", content: JSON.stringify(siteMeta, null, 2) }
    ];

    try {
      for (const sheet of document.styleSheets) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;
          for (const rule of rules) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
              const srcVal = rule.style.getPropertyValue("src");
              if (srcVal) {
                const matches = srcVal.match(/url\(['"]?([^'")]+)['"]?\)/g);
                if (matches) {
                  for (const match of matches) {
                    const fontUrl = match.replace(/url\(['"]?|['"]?\)/g, "");
                    addAsset(fontUrl, "fonts", ".woff2");
                  }
                }
              }
            }
          }
        } catch (e) {
          // ignore cross-origin stylesheet errors
        }
      }
    } catch (e) {
      // ignore
    }

    const clone = document.documentElement.cloneNode(true);

    // A <base> tag would break the rewritten relative paths.
    for (const base of clone.querySelectorAll("base")) {
      base.remove();
    }

    function localPathFor(rawUrl) {
      if (!rawUrl) return null;
      try {
        const absUrl = new URL(rawUrl, window.location.href).href;
        return seenUrls.get(absUrl) || null;
      } catch (e) {
        return null;
      }
    }

    const cloneStyleLinks = clone.querySelectorAll("link[rel='stylesheet']");
    for (const link of cloneStyleLinks) {
      const localPath = localPathFor(link.getAttribute("href"));
      if (localPath) {
        link.setAttribute("href", relFromCurrentPage(localPath));
      }
    }

    const cloneScripts = clone.querySelectorAll("script[src]");
    for (const script of cloneScripts) {
      const localPath = localPathFor(script.getAttribute("src"));
      if (localPath) {
        script.setAttribute("src", relFromCurrentPage(localPath));
      }
    }

    const cloneImgs = clone.querySelectorAll("img");
    for (const img of cloneImgs) {
      const src = img.getAttribute("src") || img.getAttribute("data-src");
      const localPath = localPathFor(src);
      if (localPath) {
        img.setAttribute("src", relFromCurrentPage(localPath));
      }
      img.removeAttribute("srcset");
      img.removeAttribute("data-src");
      img.removeAttribute("loading");
    }

    const cloneMedias = clone.querySelectorAll("audio, video, source");
    for (const media of cloneMedias) {
      const localPath = localPathFor(media.getAttribute("src") || media.getAttribute("data-src"));
      if (localPath) {
        media.setAttribute("src", relFromCurrentPage(localPath));
      }
    }

    const cloneIconLinks = clone.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='manifest']");
    for (const link of cloneIconLinks) {
      const localPath = localPathFor(link.getAttribute("href"));
      if (localPath) {
        link.setAttribute("href", relFromCurrentPage(localPath));
      }
    }

    // Inline <style> blocks: download url(...) refs and point them to local files.
    const cloneStyleBlocks = clone.querySelectorAll("style");
    for (const styleBlock of cloneStyleBlocks) {
      const cssText = styleBlock.textContent || "";
      if (cssText.includes("url(")) {
        styleBlock.textContent = rewriteCssUrlsForClone(cssText, addAsset, relFromCurrentPage);
      }
    }

    // Inline style="" attributes (background-image etc.).
    const cloneStyledEls = clone.querySelectorAll("[style]");
    for (const el of cloneStyledEls) {
      const styleValue = el.getAttribute("style") || "";
      if (styleValue.includes("url(")) {
        el.setAttribute("style", rewriteCssUrlsForClone(styleValue, addAsset, relFromCurrentPage));
      }
    }

    // Point internal links to their crawled local pages when a crawl plan exists.
    if (options.pageMap && typeof options.pageMap === "object") {
      const cloneAnchors = clone.querySelectorAll("a[href]");
      for (const anchor of cloneAnchors) {
        let normalized;
        try {
          normalized = normalizePageUrl(new URL(anchor.getAttribute("href"), window.location.href).href);
        } catch (e) {
          continue;
        }
        const localPage = options.pageMap[normalized];
        if (localPage) {
          anchor.setAttribute("href", relFromCurrentPage(localPage));
        }
      }
    }

    if (options.staticSnapshot) {
      for (const script of clone.querySelectorAll("script")) {
        script.remove();
      }
      const preloadLinks = clone.querySelectorAll(
        "link[rel='preload'], link[rel='modulepreload'], link[rel='prefetch'], link[rel='dns-prefetch'], link[rel='preconnect']"
      );
      for (const link of preloadLinks) {
        link.remove();
      }
    }

    return {
      html: "<!DOCTYPE html>\n" + clone.outerHTML,
      assets: assets,
      generatedFiles,
      internalLinks: collectInternalLinks(),
      pagePath: currentPagePath,
      staticSnapshot: Boolean(options.staticSnapshot)
    };
  }

  function collectInlineSvgIcons() {
    const files = [];
    const seenHashes = new Set();
    const svgs = document.querySelectorAll("svg");
    for (const svg of svgs) {
      if (files.length >= 40) break;
      let markup = svg.outerHTML || "";
      if (!markup || markup.length > 20000) continue;
      if (!markup.includes("xmlns=")) {
        markup = markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      const hash = shortHash(markup);
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      files.push({
        path: `icons/icon-${hash}.svg`,
        content: `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`
      });
    }
    return files;
  }

  function collectSiteMetaAndAssets(addAsset) {
    const meta = {
      url: window.location.href,
      title: document.title || "",
      description: getMetaContent("description"),
      language: document.documentElement.getAttribute("lang") || "",
      themeColor: getMetaContent("theme-color"),
      ogTitle: getMetaContent("og:title", true),
      ogDescription: getMetaContent("og:description", true),
      ogImage: getMetaContent("og:image", true),
      canonical: document.querySelector("link[rel='canonical']")?.getAttribute("href") || "",
      manifest: "",
      favicons: []
    };

    const manifestLink = document.querySelector("link[rel='manifest']");
    if (manifestLink) {
      const localPath = addAsset(manifestLink.getAttribute("href"), "meta", ".webmanifest");
      if (localPath) {
        meta.manifest = localPath;
      }
    }

    const iconLinks = document.querySelectorAll("link[rel~='icon'], link[rel='apple-touch-icon']");
    for (const link of iconLinks) {
      const localPath = addAsset(link.getAttribute("href"), "img", ".png");
      if (localPath) {
        meta.favicons.push(localPath);
      }
    }

    if (meta.ogImage) {
      addAsset(meta.ogImage, "img", ".png");
    }

    return meta;
  }

  // Media inside same-origin iframes (embedded widgets, players...):
  // downloaded alongside the page assets. The iframe itself keeps its
  // original URL in the clone.
  function collectSameOriginIframeAssets(addAsset) {
    for (const doc of getSameOriginIframeDocs(5)) {
      const nodes = doc.querySelectorAll("img, source, video, audio");
      let scanned = 0;
      for (const node of nodes) {
        if (scanned >= 80) break;
        scanned += 1;
        const src = node.getAttribute("src") || node.getAttribute("data-src");
        if (!src) continue;
        try {
          const absUrl = new URL(src, doc.baseURI).href;
          const isImage = node.tagName === "IMG" || /\.(png|jpe?g|gif|webp|avif|svg)([?#]|$)/i.test(absUrl);
          addAsset(absUrl, isImage ? "img" : "video", isImage ? ".png" : ".mp4");
        } catch (e) {}
      }
    }
  }

  function collectComputedBackgroundImageAssets(addAsset) {
    const elements = getAllElementsDeep(4000);
    let scanned = 0;
    for (const el of elements) {
      if (scanned >= 3000) break;
      if (!(el instanceof HTMLElement)) continue;
      scanned += 1;
      let backgroundImage = "";
      try {
        backgroundImage = computedStyleOf(el).backgroundImage;
      } catch (e) {
        continue;
      }
      if (!backgroundImage || backgroundImage === "none" || !backgroundImage.includes("url(")) {
        continue;
      }
      const matches = backgroundImage.matchAll(/url\((['"]?)([^'")]+)\1\)/g);
      for (const match of matches) {
        addAsset(match[2], "img", ".png");
      }
    }
  }

  function rewriteCssUrlsForClone(cssText, addAsset, toPageRelative) {
    const rel = typeof toPageRelative === "function" ? toPageRelative : (path) => path;
    return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (full, _quote, rawUrl) => {
      const trimmed = rawUrl.trim();
      if (trimmed.startsWith("data:") || trimmed.startsWith("#") || trimmed.startsWith("blob:")) {
        return full;
      }
      const isFont = /\.(woff2?|ttf|otf|eot)([?#]|$)/i.test(trimmed);
      const isCss = /\.css([?#]|$)/i.test(trimmed);
      const folder = isFont ? "fonts" : isCss ? "css" : "img";
      const fallbackExt = isFont ? ".woff2" : isCss ? ".css" : ".png";
      const localPath = addAsset(trimmed, folder, fallbackExt);
      if (!localPath) {
        return full;
      }
      return `url("${rel(localPath)}")`;
    });
  }

  async function autoScrollToTriggerLazyLoad() {
    if (!document.body) {
      return;
    }
    const startX = window.scrollX;
    const startY = window.scrollY;
    const step = Math.max(400, Math.floor(window.innerHeight * 0.85));
    const maxHeight = Math.min(document.body.scrollHeight, 30000);
    for (let y = 0; y <= maxHeight; y += step) {
      window.scrollTo(0, y);
      await sleep(90);
    }
    window.scrollTo(startX, startY);
    await sleep(300);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function shortHash(value) {
    let hash = 5381;
    const text = String(value || "");
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36).slice(0, 7);
  }

  // Inventory of external resources: stylesheets, scripts and every
  // @font-face the page declares (family, weight, style, file URLs).
  function collectResourceInventory() {
    const stylesheets = [];
    for (const link of document.querySelectorAll("link[rel='stylesheet']")) {
      const href = link.getAttribute("href");
      if (!href) continue;
      try {
        stylesheets.push(new URL(href, window.location.href).href);
      } catch (e) {}
      if (stylesheets.length >= 30) break;
    }

    const scripts = [];
    for (const script of document.querySelectorAll("script[src]")) {
      const src = script.getAttribute("src");
      if (!src) continue;
      try {
        scripts.push(new URL(src, window.location.href).href);
      } catch (e) {}
      if (scripts.length >= 30) break;
    }

    const fontFaces = [];
    forEachAccessibleRule((rule) => {
      if (rule.type !== CSSRule.FONT_FACE_RULE || fontFaces.length >= 20) {
        return;
      }
      try {
        const family = normalizeWhitespace(rule.style.getPropertyValue("font-family")).replace(/^['"]|['"]$/g, "");
        const weight = normalizeWhitespace(rule.style.getPropertyValue("font-weight")) || "400";
        const fontStyle = normalizeWhitespace(rule.style.getPropertyValue("font-style")) || "normal";
        const src = rule.style.getPropertyValue("src") || "";
        const urls = [];
        const matches = src.matchAll(/url\((['"]?)([^'")]+)\1\)/g);
        for (const match of matches) {
          const ref = match[2].trim();
          if (ref.startsWith("data:")) continue;
          try {
            const baseHref = rule.parentStyleSheet?.href || window.location.href;
            urls.push(new URL(ref, baseHref).href);
          } catch (e) {}
        }
        if (family) {
          fontFaces.push({ family, weight, style: fontStyle, urls: urls.slice(0, 4) });
        }
      } catch (e) {}
    });

    return {
      stylesheets,
      scripts,
      fontFaces,
      inlineStyleBlocks: document.querySelectorAll("style").length
    };
  }

  // Page anatomy: the ordered list of top-level sections with their
  // inferred role, layout, content, and surface — the wireframe an
  // agent needs to rebuild the page, not just restyle it.
  function collectPageStructure() {
    // `section` anywhere in the tree: modern sites nest sections under
    // framework wrappers (div#__next > main > div > section...), and the
    // outermost-wins dedupe below keeps the top-level ones.
    const candidates = document.querySelectorAll(
      "body > header, body > nav, header, footer, main > section, main > div, body > section, section, [role='banner'], [role='contentinfo']"
    );
    const used = [];

    for (const el of candidates) {
      if (used.length >= 14) break;
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      // Landmarks (header/nav/footer) are structural even when compact.
      const isLandmark = ["header", "nav", "footer"].includes(el.tagName.toLowerCase());
      if (rect.height < (isLandmark ? 24 : 60)) continue;
      if (used.some((other) => other.contains(el) || el.contains(other))) continue;
      used.push(el);
    }

    // Present sections in visual order, top of the page first.
    used.sort((a, b) => {
      const topA = a.getBoundingClientRect().top;
      const topB = b.getBoundingClientRect().top;
      return topA - topB;
    });

    return used.map((el, index) => analyzeSection(el, index));
  }

  function analyzeSection(el, index) {
    const style = computedStyleOf(el);
    const rect = el.getBoundingClientRect();
    const text = normalizeWhitespace(el.textContent || "").slice(0, 500).toLowerCase();
    const headingEl = el.querySelector("h1, h2, h3");
    const heading = headingEl ? normalizeWhitespace(headingEl.textContent || "").slice(0, 90) : "";

    const ctas = [];
    for (const button of el.querySelectorAll("button, [role='button'], a[class*='btn'], a[class*='button'], input[type='submit']")) {
      if (ctas.length >= 3) break;
      const label = normalizeWhitespace(button.textContent || button.getAttribute("value") || "").slice(0, 40);
      if (label) ctas.push(label);
    }

    const imageCount = el.querySelectorAll("img").length;
    const svgCount = el.querySelectorAll("svg").length;
    const linkCount = el.querySelectorAll("a[href]").length;
    const hasForm = Boolean(el.querySelector("form, input:not([type='hidden'])"));
    const tag = el.tagName.toLowerCase();

    let role = "content";
    if (tag === "header" || el.getAttribute("role") === "banner") role = "header/navigation";
    else if (tag === "footer" || el.getAttribute("role") === "contentinfo") role = "footer";
    else if (/price|pricing|\/mo|\/month|per month|plan[s]?\b|tarif/.test(text)) role = "pricing";
    else if (/testimonial|review|customers say|trusted by|avis/.test(text) && text.length < 2500) role = "testimonials";
    else if (/faq|frequently asked|questions fréquentes/.test(text)) role = "faq";
    else if (hasForm && /contact|subscribe|newsletter|get in touch/.test(text)) role = "contact/form";
    else if (el.querySelector("h1") && index <= 2) role = "hero";
    else if (imageCount + svgCount >= 3 && linkCount <= imageCount) role = "features/gallery";
    else if (ctas.length > 0 && text.length < 400) role = "cta";

    let columns = 0;
    let layoutKind = style.display;
    if (style.display === "grid") {
      columns = style.gridTemplateColumns && style.gridTemplateColumns !== "none"
        ? style.gridTemplateColumns.split(" ").length
        : 0;
      layoutKind = "grid";
    } else if (style.display === "flex") {
      layoutKind = `flex ${style.flexDirection}`;
      if (style.flexDirection.startsWith("row")) {
        columns = Math.min(el.children.length, 12);
      }
    } else {
      // The layout often lives one wrapper deeper.
      const inner = Array.from(el.children).find((child) => {
        if (!(child instanceof HTMLElement)) return false;
        const display = computedStyleOf(child).display;
        return display === "grid" || display === "flex";
      });
      if (inner) {
        const innerStyle = computedStyleOf(inner);
        if (innerStyle.display === "grid") {
          layoutKind = "grid (nested)";
          columns = innerStyle.gridTemplateColumns !== "none"
            ? innerStyle.gridTemplateColumns.split(" ").length
            : 0;
        } else {
          layoutKind = `flex ${innerStyle.flexDirection} (nested)`;
          if (innerStyle.flexDirection.startsWith("row")) {
            columns = Math.min(inner.children.length, 12);
          }
        }
      }
    }

    const bgColor = style.backgroundColor;
    const bgImage = style.backgroundImage;
    let background = "transparent";
    if (bgImage && bgImage !== "none") {
      background = bgImage.includes("gradient") ? "gradient" : "image";
    } else if (bgColor && !bgColor.includes("rgba(0, 0, 0, 0)")) {
      background = bgColor;
    }

    return {
      role,
      tag,
      heading,
      ctas,
      layout: layoutKind,
      columns,
      imageCount,
      svgCount,
      linkCount,
      hasForm,
      background,
      paddingY: `${style.paddingTop}/${style.paddingBottom}`,
      height: Math.round(rect.height)
    };
  }

  // Image inventory with role guesses: logo, hero, icon, photo.
  function collectImageInventory() {
    const images = [];
    let heroAssigned = false;
    for (const img of document.querySelectorAll("img")) {
      if (images.length >= 20) break;
      if (!(img instanceof HTMLElement) || !isVisible(img)) continue;
      const rect = img.getBoundingClientRect();
      const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
      let absSrc = src;
      try {
        absSrc = new URL(src, window.location.href).href;
      } catch (e) {}
      const alt = normalizeWhitespace(img.getAttribute("alt") || "").slice(0, 80);
      const hint = `${img.className} ${src} ${alt}`.toLowerCase();

      let role = "photo";
      if (/logo|brand/.test(hint) || (img.closest("header, nav") && rect.height <= 80)) {
        role = "logo";
      } else if (Math.max(rect.width, rect.height) <= 48) {
        role = "icon";
      } else if (!heroAssigned && rect.top < window.innerHeight && rect.width * rect.height > 90000) {
        role = "hero";
        heroAssigned = true;
      }

      images.push({
        src: absSrc,
        alt,
        role,
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    }
    return images;
  }

  // Forms map: every field with its label, type, and constraints —
  // enough to rebuild the form without guessing.
  function collectFormsMap() {
    const forms = [];
    for (const form of document.querySelectorAll("form")) {
      if (forms.length >= 5) break;
      if (!(form instanceof HTMLElement)) continue;

      const fields = [];
      for (const field of form.querySelectorAll("input:not([type='hidden']), textarea, select")) {
        if (fields.length >= 12) break;
        let label = "";
        if (field.id) {
          const labelEl = form.querySelector(`label[for="${CSS.escape(field.id)}"]`);
          if (labelEl) label = normalizeWhitespace(labelEl.textContent || "");
        }
        if (!label) {
          const parentLabel = field.closest("label");
          if (parentLabel) label = normalizeWhitespace(parentLabel.textContent || "");
        }
        fields.push({
          tag: field.tagName.toLowerCase(),
          type: field.getAttribute("type") || (field.tagName === "SELECT" ? "select" : "text"),
          name: field.getAttribute("name") || "",
          placeholder: field.getAttribute("placeholder") || "",
          required: field.hasAttribute("required"),
          label: label.slice(0, 60)
        });
      }

      const submitEl = form.querySelector("button[type='submit'], input[type='submit'], button:not([type])");
      forms.push({
        name:
          form.getAttribute("id") ||
          form.getAttribute("name") ||
          form.getAttribute("aria-label") ||
          `form-${forms.length + 1}`,
        method: (form.getAttribute("method") || "get").toLowerCase(),
        fieldCount: fields.length,
        fields,
        submitText: submitEl ? normalizeWhitespace(submitEl.textContent || submitEl.getAttribute("value") || "").slice(0, 40) : ""
      });
    }
    return forms;
  }

  // Measured heading hierarchy: the exact computed style of the first
  // visible instance of each heading level.
  function collectHeadingStyles() {
    const out = [];
    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      const el = Array.from(document.querySelectorAll(level)).find(
        (node) => node instanceof HTMLElement && isVisible(node)
      );
      if (!el) continue;
      const style = computedStyleOf(el);
      out.push({
        level,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
        color: style.color,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        fontFamily: normalizeWhitespace(style.fontFamily).split(",")[0].replace(/^['"]|['"]$/g, "")
      });
    }
    return out;
  }

  // Buttons clustered by visual signature → variant specs with exact,
  // copy-paste-ready declarations.
  function collectButtonVariants() {
    const nodes = document.querySelectorAll(
      "button, [role='button'], a[class*='btn'], a[class*='button'], input[type='submit']"
    );
    const clusters = new Map();
    let scanned = 0;
    for (const el of nodes) {
      if (scanned >= 60) break;
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      scanned += 1;
      const style = computedStyleOf(el);
      const spec = {
        background:
          style.backgroundImage && style.backgroundImage !== "none"
            ? style.backgroundImage
            : style.backgroundColor,
        color: style.color,
        border:
          Number.parseFloat(style.borderTopWidth) > 0
            ? `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`
            : "none",
        borderRadius: style.borderRadius,
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        boxShadow: style.boxShadow !== "none" ? style.boxShadow : "",
        textTransform: style.textTransform !== "none" ? style.textTransform : ""
      };
      const key = JSON.stringify(spec);
      const entry = clusters.get(key) || { spec, count: 0, example: "" };
      entry.count += 1;
      if (!entry.example) {
        entry.example = normalizeWhitespace(el.textContent || el.getAttribute("value") || "").slice(0, 30);
      }
      clusters.set(key, entry);
    }
    return Array.from(clusters.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }

  function collectFormControlSpec() {
    const el = Array.from(document.querySelectorAll("input:not([type='hidden']), textarea, select")).find(
      (node) => node instanceof HTMLElement && isVisible(node)
    );
    if (!el) return null;
    const style = computedStyleOf(el);
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      height: `${Math.round(rect.height)}px`,
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
      borderRadius: style.borderRadius,
      background: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize
    };
  }

  function collectLinkSpec() {
    const counts = new Map();
    let scanned = 0;
    for (const el of document.querySelectorAll("a[href]")) {
      if (scanned >= 40) break;
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      scanned += 1;
      const style = computedStyleOf(el);
      const key = JSON.stringify({
        color: style.color,
        textDecoration: style.textDecorationLine,
        fontWeight: style.fontWeight
      });
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    return { ...JSON.parse(top[0]), usage: top[1] };
  }

  // Layout system: container width, layout method usage, vertical
  // rhythm of top-level sections, z-index scale, border widths.
  function collectLayoutSignals() {
    const maxWidthCounts = new Map();
    const containers = document.querySelectorAll(
      "main, section, [class*='container'], [class*='wrapper'], header > div, footer > div"
    );
    let scanned = 0;
    for (const el of containers) {
      if (scanned >= 200) break;
      if (!(el instanceof HTMLElement)) continue;
      scanned += 1;
      const maxWidth = computedStyleOf(el).maxWidth;
      if (maxWidth && maxWidth !== "none" && maxWidth.endsWith("px")) {
        maxWidthCounts.set(maxWidth, (maxWidthCounts.get(maxWidth) || 0) + 1);
      }
    }
    const containerMaxWidth =
      Array.from(maxWidthCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    let flexCount = 0;
    let gridCount = 0;
    const zIndexes = new Set();
    const borderWidthCounts = new Map();
    const elements = getAllElementsDeep(2500);
    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue;
      let style;
      try {
        style = computedStyleOf(el);
      } catch (e) {
        continue;
      }
      if (style.display === "flex" || style.display === "inline-flex") flexCount += 1;
      else if (style.display === "grid" || style.display === "inline-grid") gridCount += 1;
      if (style.zIndex !== "auto") {
        const z = Number.parseInt(style.zIndex, 10);
        if (Number.isFinite(z) && zIndexes.size < 12) zIndexes.add(z);
      }
      const bw = Number.parseFloat(style.borderTopWidth);
      if (bw > 0) {
        borderWidthCounts.set(style.borderTopWidth, (borderWidthCounts.get(style.borderTopWidth) || 0) + 1);
      }
    }

    const sectionPaddingCounts = new Map();
    for (const el of document.querySelectorAll("body > section, main > section, main > div, body > main > *")) {
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      const pt = computedStyleOf(el).paddingTop;
      const px = Number.parseFloat(pt);
      if (Number.isFinite(px) && px >= 16) {
        sectionPaddingCounts.set(pt, (sectionPaddingCounts.get(pt) || 0) + 1);
      }
    }

    return {
      containerMaxWidth,
      flexCount,
      gridCount,
      zIndexScale: Array.from(zIndexes).sort((a, b) => a - b),
      borderWidths: Array.from(borderWidthCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([value, count]) => ({ value, count })),
      sectionPaddings: Array.from(sectionPaddingCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([value, count]) => ({ value, count }))
    };
  }

  // "Extract this component": tracks the element under the last
  // right-click so the context-menu action knows what to serialize.
  let lastContextMenuTarget = null;
  document.addEventListener(
    "contextmenu",
    (event) => {
      if (event.target instanceof HTMLElement) {
        lastContextMenuTarget = event.target;
      }
    },
    true
  );

  // Serializes an element subtree into a standalone HTML document:
  // computed styles inlined on every node, asset URLs made absolute.
  const COMPONENT_STYLE_PROPS = [
    "display", "position", "flex-direction", "flex-wrap", "flex", "justify-content",
    "align-items", "align-self", "gap", "grid-template-columns", "grid-template-rows",
    "width", "max-width", "min-width", "height", "min-height", "aspect-ratio",
    "margin", "padding", "box-sizing", "overflow",
    "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "color", "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "text-align", "text-transform", "text-decoration", "white-space",
    "border", "border-radius", "box-shadow", "outline", "opacity", "z-index",
    "transition", "transform", "cursor", "object-fit", "list-style"
  ];

  function serializeElementAsComponent(target) {
    const clone = target.cloneNode(true);
    const originals = [target, ...target.querySelectorAll("*")];
    const clones = [clone, ...clone.querySelectorAll("*")];
    const limit = Math.min(originals.length, clones.length, 300);

    for (let i = 0; i < limit; i++) {
      const original = originals[i];
      const copy = clones[i];
      if (!(original instanceof HTMLElement) || !(copy instanceof HTMLElement)) {
        continue;
      }
      const style = computedStyleOf(original);
      const declarations = [];
      for (const prop of COMPONENT_STYLE_PROPS) {
        const value = style.getPropertyValue(prop);
        if (value && value !== "none" && value !== "normal" && value !== "auto") {
          declarations.push(`${prop}: ${value}`);
        }
      }
      copy.setAttribute("style", declarations.join("; "));
      copy.removeAttribute("class");
      copy.removeAttribute("id");

      if (copy.tagName === "IMG") {
        const src = original.getAttribute("src") || original.getAttribute("data-src");
        if (src) {
          try {
            copy.setAttribute("src", new URL(src, window.location.href).href);
          } catch (e) {}
        }
        copy.removeAttribute("srcset");
        copy.removeAttribute("loading");
      }
      if (copy.tagName === "A") {
        const href = original.getAttribute("href");
        if (href) {
          try {
            copy.setAttribute("href", new URL(href, window.location.href).href);
          } catch (e) {}
        }
      }
    }

    for (const script of clone.querySelectorAll("script")) {
      script.remove();
    }

    const suggestedName = (
      target.id ||
      (target.className && String(target.className).split(/\s+/)[0]) ||
      target.tagName.toLowerCase()
    )
      .replace(/[^a-z0-9-_]/gi, "")
      .slice(0, 40) || "component";

    const bodyStyle = computedStyleOf(document.body || document.documentElement);
    const html = [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      `  <title>${suggestedName} — extracted component</title>`,
      `  <!-- Extracted from ${window.location.href} by Keys_Osi_Design.md-extractor -->`,
      "</head>",
      `<body style="margin:0; padding:24px; background:${bodyStyle.backgroundColor}; font-family:${bodyStyle.fontFamily.replace(/"/g, "'")}">`,
      clone.outerHTML,
      "</body>",
      "</html>"
    ].join("\n");

    return {
      html,
      suggestedName,
      elementCount: limit,
      source: window.location.href
    };
  }

  // Measured parallax detection: sample transforms/positions of likely
  // candidates, scroll the page, resample, diff, restore. Any element
  // whose transform changes with scroll (or that moves at a different
  // speed than the page) is scroll-linked.
  async function measureParallax() {
    const result = { measured: [], fixedBackgroundCount: 0 };

    // background-attachment: fixed surfaces are parallax by construction.
    let scannedBg = 0;
    for (const el of document.querySelectorAll("section, header, div[class], footer")) {
      if (scannedBg >= 300) break;
      if (!(el instanceof HTMLElement)) continue;
      scannedBg += 1;
      try {
        if (computedStyleOf(el).backgroundAttachment.includes("fixed")) {
          result.fixedBackgroundCount += 1;
        }
      } catch (e) {}
    }

    const scrollRoom = (document.body ? document.body.scrollHeight : 0) - window.innerHeight;
    if (scrollRoom < 400) {
      return result;
    }

    const candidates = [];
    for (const el of getAllElementsDeep(3000)) {
      if (candidates.length >= 150) break;
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      let style;
      try {
        style = computedStyleOf(el);
      } catch (e) {
        continue;
      }
      if (style.position === "fixed" || style.position === "sticky") continue;
      const hasTransform = style.transform && style.transform !== "none";
      const willChange = (style.willChange || "").includes("transform");
      const parallaxClass = /parallax|rellax|jarallax/i.test(el.className || "");
      if (hasTransform || willChange || parallaxClass) {
        candidates.push(el);
      }
    }
    if (candidates.length === 0) {
      return result;
    }

    const before = candidates.map((el) => ({
      transform: computedStyleOf(el).transform,
      top: el.getBoundingClientRect().top
    }));

    const startX = window.scrollX;
    const startY = window.scrollY;
    const delta = Math.min(600, scrollRoom - startY > 200 ? Math.min(600, scrollRoom - startY) : 600);
    window.scrollTo({ top: startY + delta, behavior: "instant" });
    await sleep(260);
    const actualDelta = window.scrollY - startY;

    if (actualDelta > 50) {
      for (let i = 0; i < candidates.length && result.measured.length < 10; i++) {
        const el = candidates[i];
        try {
          const afterTransform = computedStyleOf(el).transform;
          const afterTop = el.getBoundingClientRect().top;
          const movedBy = before[i].top - afterTop; // page content moves up by actualDelta
          const speedRatio = Math.round((movedBy / actualDelta) * 100) / 100;
          const transformChanged = afterTransform !== before[i].transform;
          if (transformChanged && Math.abs(speedRatio - 1) > 0.12) {
            result.measured.push({
              selector: describeElement(el),
              speedRatio,
              kind: "scroll-linked transform"
            });
          }
        } catch (e) {}
      }
    }

    window.scrollTo({ top: startY, left: startX, behavior: "instant" });
    await sleep(150);
    return result;
  }

  function detectDomAnimationLibs() {
    const libs = [];
    const domChecks = [
      ["AOS", "[data-aos]", "data-aos attributes"],
      ["Lottie", "lottie-player, dotlottie-player", "lottie web component"],
      ["Swiper", ".swiper, .swiper-container", "carousel markup"],
      ["Locomotive Scroll", "[data-scroll-container], [data-scroll-section]", "data-scroll markup"],
      ["Lenis", "html.lenis, .lenis", "smooth-scroll class"],
      ["Rellax", ".rellax", "parallax class"],
      ["Particles", "#particles-js", "particles container"],
      ["Jarallax", ".jarallax", "parallax class"],
      ["Splide", ".splide", "carousel markup"],
      ["Framer Motion", "[data-framer-name], [data-projection-id]", "framer attributes"]
    ];
    for (const [name, selector, evidence] of domChecks) {
      try {
        if (document.querySelector(selector)) {
          libs.push({ name, evidence });
        }
      } catch (e) {}
    }
    return libs;
  }

  function mergeAnimationLibs(mainWorldLibs, domLibs) {
    const merged = new Map();
    for (const lib of [...(mainWorldLibs || []), ...(domLibs || [])]) {
      if (lib && lib.name && !merged.has(lib.name)) {
        merged.set(lib.name, {
          name: String(lib.name),
          evidence: String(lib.evidence || "")
        });
      }
    }
    return Array.from(merged.values()).slice(0, 14);
  }

  // Canvas inventory: dimensions, position, and context type. GPU-drawn
  // content cannot be extracted as CSS, but knowing a WebGL scene sits
  // in the hero changes how a reproduction should be planned.
  function collectCanvasInventory() {
    const inventory = [];
    for (const canvas of getAllElementsDeep(4000)) {
      if (inventory.length >= 10) break;
      if (!(canvas instanceof HTMLCanvasElement)) continue;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) continue;
      let context = "unknown";
      try {
        // getContext returns the existing context for a matching type and
        // null for a mismatched one, so probing identifies initialized
        // canvases without disturbing them.
        if (canvas.getContext("webgl2")) context = "webgl2";
        else if (canvas.getContext("webgl")) context = "webgl";
        else if (canvas.getContext("2d")) context = "2d";
      } catch (e) {}
      inventory.push({
        selector: describeElement(canvas),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        context,
        inViewport: rect.top < window.innerHeight && rect.bottom > 0
      });
    }
    return inventory;
  }

  function collectRuntimeAnimations() {
    const results = [];
    let animations = [];
    try {
      animations = document.getAnimations ? document.getAnimations() : [];
    } catch (e) {
      return results;
    }

    for (const animation of animations.slice(0, 20)) {
      try {
        const effect = animation.effect;
        const timing = effect && effect.getTiming ? effect.getTiming() : {};
        let keyframes = [];
        if (effect && effect.getKeyframes) {
          keyframes = effect.getKeyframes().slice(0, 6).map((frame) => {
            const compact = {};
            for (const [key, value] of Object.entries(frame)) {
              if (key === "composite" || key === "easing" || key === "computedOffset") {
                continue;
              }
              compact[key] = String(value).slice(0, 120);
            }
            return compact;
          });
        }
        results.push({
          type: animation.constructor ? animation.constructor.name : "Animation",
          name: animation.animationName || animation.transitionProperty || "",
          duration: timing.duration || 0,
          delay: timing.delay || 0,
          easing: timing.easing || "",
          iterations: timing.iterations === Infinity ? "infinite" : timing.iterations || 1,
          playState: animation.playState,
          target: describeElement(effect && effect.target),
          keyframes
        });
      } catch (e) {}
    }
    return results;
  }

  function describeElement(el) {
    if (!el || !el.tagName) {
      return "";
    }
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const classes = el.classList
      ? Array.from(el.classList).slice(0, 2).map((cls) => `.${cls}`).join("")
      : "";
    return `${tag}${id}${classes}`.slice(0, 80);
  }

  function collectAccessibilityMetrics(sampledElements) {
    const metrics = {
      contrastChecked: 0,
      contrastFailures: 0,
      worstPairs: [],
      targetsChecked: 0,
      smallTargets: 0
    };
    const pairs = [];

    for (const el of sampledElements.slice(0, 150)) {
      const hasDirectText = Array.from(el.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
      );
      if (!hasDirectText) {
        continue;
      }
      const style = computedStyleOf(el);
      const fg = parseColorToRgb(style.color);
      const bg = resolveEffectiveBackground(el);
      if (!fg || !bg) {
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const isBold = Number.parseInt(style.fontWeight, 10) >= 700;
      const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && isBold);
      const required = isLargeText ? 3.0 : 4.5;

      metrics.contrastChecked += 1;
      if (ratio < required) {
        metrics.contrastFailures += 1;
        pairs.push({
          selector: describeElement(el),
          foreground: rgbToHexString(fg),
          background: rgbToHexString(bg),
          ratio: Math.round(ratio * 100) / 100,
          required
        });
      }
    }
    pairs.sort((a, b) => a.ratio - b.ratio);
    metrics.worstPairs = pairs.slice(0, 5);

    const targets = document.querySelectorAll("a[href], button, [role='button'], input, select, textarea");
    let checked = 0;
    for (const target of targets) {
      if (checked >= 200) break;
      if (!(target instanceof HTMLElement) || !isVisible(target)) {
        continue;
      }
      checked += 1;
      const rect = target.getBoundingClientRect();
      // WCAG 2.2 "Target Size (Minimum)": 24x24 CSS pixels.
      if (rect.width < 24 || rect.height < 24) {
        metrics.smallTargets += 1;
      }
    }
    metrics.targetsChecked = checked;
    return metrics;
  }

  // The page canvas color: body/html background resolved through
  // transparency, white as the browser default.
  function getPageBackgroundHex() {
    const root = document.body || document.documentElement;
    if (!root) {
      return "#ffffff";
    }
    return rgbToHexString(resolveEffectiveBackground(root));
  }

  function resolveEffectiveBackground(el) {
    let current = el;
    for (let depth = 0; current && depth < 12; depth++) {
      const bg = parseColorToRgb(computedStyleOf(current).backgroundColor);
      if (bg && bg.a > 0.05) {
        return bg;
      }
      current = current.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function parseColorToRgb(value) {
    const raw = String(value || "").trim().toLowerCase();
    const match = raw.match(/^rgba?\(([^)]+)\)$/);
    if (!match) {
      return null;
    }
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
      return null;
    }
    return {
      r: parts[0],
      g: parts[1],
      b: parts[2],
      a: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
    };
  }

  function contrastRatio(fg, bg) {
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function relativeLuminance(color) {
    const channels = [color.r, color.g, color.b].map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function rgbToHexString(color) {
    const toHexByte = (value) =>
      Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
    return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
  }

  function detectStack(mainWorldFrameworks) {
    const detected = new Map();
    const add = (name, evidence) => {
      if (!detected.has(name)) {
        detected.set(name, evidence);
      }
    };

    for (const framework of mainWorldFrameworks || []) {
      if (framework && framework.name) {
        add(framework.name, framework.evidence || "runtime global");
      }
    }

    const domChecks = [
      ["React", "[data-reactroot], [data-react-helmet]"],
      ["Next.js", "#__next, script#__NEXT_DATA__"],
      ["Vue", "[data-v-app], [data-server-rendered='true']"],
      ["Nuxt", "#__nuxt"],
      ["Angular", "[ng-version]"],
      ["Svelte", "[class*='svelte-']"],
      ["Astro", "astro-island"],
      ["Radix UI", "[data-radix-popper-content-wrapper], [data-radix-collection-item]"],
      ["Font Awesome", ".fa, [class*='fa-solid'], [class*='fa-brands']"],
      ["WordPress", "[class*='wp-block'], link[href*='wp-content']"],
      ["Bootstrap", "link[href*='bootstrap'], .btn.btn-primary, .container .row [class*='col-']"]
    ];
    for (const [name, selector] of domChecks) {
      try {
        if (document.querySelector(selector)) {
          add(name, `selector: ${selector.split(",")[0].trim()}`);
        }
      } catch (e) {}
    }

    try {
      if (document.querySelector("[class*='md:'], [class*='lg:'], [class*='hover:']")) {
        add("Tailwind CSS", "responsive/state utility classes");
      }
    } catch (e) {}

    try {
      const scripts = document.querySelectorAll("script[src]");
      for (const script of scripts) {
        const src = script.getAttribute("src") || "";
        if (src.includes("cdn.shopify.com")) add("Shopify", "cdn.shopify.com script");
        if (src.includes("static.parastorage.com")) add("Wix", "parastorage script");
        if (src.includes("assets-global.website-files.com") || src.includes("assets.website-files.com")) {
          add("Webflow", "website-files.com assets");
        }
      }
    } catch (e) {}

    return Array.from(detected.entries()).map(([name, evidence]) => ({ name, evidence }));
  }

  function collectInternalLinks() {
    const seen = new Set();
    const priority = [];
    const rest = [];
    const currentUrl = normalizePageUrl(window.location.href);
    const skipExtensions = /\.(pdf|zip|rar|dmg|exe|jpe?g|png|gif|webp|svg|mp4|mp3|xml|rss)([?#]|$)/i;

    const anchors = document.querySelectorAll("a[href]");
    for (const anchor of anchors) {
      let absUrl;
      try {
        absUrl = new URL(anchor.getAttribute("href"), window.location.href);
      } catch (e) {
        continue;
      }
      if (absUrl.origin !== window.location.origin) {
        continue;
      }
      if (!/^https?:$/.test(absUrl.protocol) || skipExtensions.test(absUrl.pathname)) {
        continue;
      }
      const normalized = normalizePageUrl(absUrl.href);
      if (normalized === currentUrl || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      const entry = {
        url: normalized,
        text: normalizeWhitespace(anchor.textContent || "").slice(0, 60)
      };
      if (anchor.closest("nav, header")) {
        priority.push(entry);
      } else {
        rest.push(entry);
      }
      if (priority.length + rest.length >= 60) {
        break;
      }
    }
    return [...priority, ...rest].slice(0, 30);
  }

  // Safe disclosure interactions: opens menus/accordions/dropdowns for a
  // richer capture, with hard safety filters — never navigates, never
  // touches forms, never clicks anything that reads like a transaction.
  const safeInteractionState = {
    clickedElements: [],
    openedDetails: []
  };

  const DANGEROUS_TEXT_PATTERN =
    /buy|checkout|pay|order|purchase|delete|remove|submit|send|sign\s?(in|up|out)|log\s?(in|out)|register|subscribe|download|install|accept|confirm|cart|add to|save|apply|book|reserve|donate|upload|share|post|publish|unsubscribe|cancel|acheter|payer|commander|supprimer|envoyer|connexion|inscription|panier|ajouter|enregistrer|réserver|publier/i;

  function openSafeDisclosures() {
    closeSafeDisclosures();

    let opened = 0;
    const report = [];

    // <details> is state-only: opening it cannot run site JS.
    const detailsElements = document.querySelectorAll("details:not([open])");
    for (const details of detailsElements) {
      if (opened >= 10) break;
      details.setAttribute("open", "");
      safeInteractionState.openedDetails.push(details);
      opened += 1;
      report.push("details");
    }

    const candidates = document.querySelectorAll(
      "[aria-expanded='false'], [data-state='closed'], [aria-haspopup='true'], " +
        "button[class*='menu-toggle'], button[class*='navbar-toggle'], button[class*='hamburger'], " +
        "button[class*='accordion'], button[class*='dropdown']"
    );

    for (const el of candidates) {
      if (opened >= 10) break;
      if (!(el instanceof HTMLElement) || !isVisible(el)) continue;
      if (!isSafeToClick(el)) continue;
      try {
        el.click();
        safeInteractionState.clickedElements.push(el);
        opened += 1;
        report.push(describeElement(el));
      } catch (e) {}
    }

    return { opened, report: report.slice(0, 10) };
  }

  function isSafeToClick(el) {
    // Never anything that can navigate.
    const anchor = el.closest("a[href]");
    if (anchor) {
      const href = anchor.getAttribute("href") || "";
      if (href && href !== "#" && !href.startsWith("#")) {
        return false;
      }
    }
    // Never inside or controlling a form.
    if (el.closest("form") || el.hasAttribute("form")) {
      return false;
    }
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "submit" || type === "reset") {
      return false;
    }
    // Never anything whose label reads like an action with consequences.
    const label = `${el.textContent || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`;
    if (DANGEROUS_TEXT_PATTERN.test(label)) {
      return false;
    }
    // Only elements that advertise a disclosure role.
    const advertisesDisclosure =
      el.getAttribute("aria-expanded") === "false" ||
      el.getAttribute("data-state") === "closed" ||
      el.getAttribute("aria-haspopup") === "true" ||
      /menu-toggle|navbar-toggle|hamburger|accordion|dropdown/i.test(el.className || "");
    return advertisesDisclosure;
  }

  function closeSafeDisclosures() {
    for (const details of safeInteractionState.openedDetails) {
      try {
        details.removeAttribute("open");
      } catch (e) {}
    }
    safeInteractionState.openedDetails = [];

    for (const el of safeInteractionState.clickedElements.reverse()) {
      try {
        // A second click toggles most disclosures back shut.
        if (el.isConnected && el.getAttribute("aria-expanded") === "true") {
          el.click();
        } else if (el.isConnected && el.getAttribute("data-state") === "open") {
          el.click();
        }
      } catch (e) {}
    }
    safeInteractionState.clickedElements = [];

    // Escape closes whatever is left (modals, poppers, comboboxes).
    try {
      const escapeEvent = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(escapeEvent);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.dispatchEvent(escapeEvent);
      }
    } catch (e) {}
  }

  function normalizePageUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      let text = parsed.href;
      if (text.endsWith("/") && parsed.pathname !== "/") {
        text = text.slice(0, -1);
      }
      return text;
    } catch (e) {
      return String(url || "");
    }
  }

  function detectDesignPlatforms() {
    const info = {
      platform: "generic",
      fileKey: null,
      nodeId: null,
      details: ""
    };

    const href = window.location.href;
    const hostname = window.location.hostname.toLowerCase();

    if (hostname.includes("figma.com")) {
      info.platform = "figma";
      const fileMatch = href.match(/\/file\/([a-zA-Z0-9]+)/);
      if (fileMatch) {
        info.fileKey = fileMatch[1];
      }
      const nodeMatch = href.match(/node-id=([a-zA-Z0-9\-:]+)/);
      if (nodeMatch) {
        info.nodeId = decodeURIComponent(nodeMatch[1]);
      }
      info.details = `Figma workspace detected. File Key: ${info.fileKey || "unknown"}, Active Node ID: ${info.nodeId || "none"}.`;
    } else if (hostname.includes("framer.com") || hostname.includes("framer.website")) {
      info.platform = "framer";
      info.details = "Framer project dashboard or canvas detected.";
    }

    return info;
  }
})();
