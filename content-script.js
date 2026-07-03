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

    try {
      const payload = extractStylesFromPage();
      sendResponse({ ok: true, payload });
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unknown extraction error";
      sendResponse({ ok: false, error: text });
    }
  });

  function extractStylesFromPage() {
    const sampledElements = collectSampledElements(280);
    const typography = [];
    const colors = [];
    const spacing = [];
    const radius = [];
    const shadows = [];
    const motion = [];
    const backgroundImages = [];

    for (const el of sampledElements) {
      const style = window.getComputedStyle(el);
      typography.push({
        fontFamily: normalizeWhitespace(style.fontFamily),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing
      });

      colors.push({
        textColor: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        outlineColor: style.outlineColor
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
          } else {
            // Backward-compatible: older inspector wrote the GSAP object directly.
            gsap = inspectorData;
          }
        }
      }
    } catch (e) {}

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
      keyframes: collectKeyframes(),
      interactionStyles: collectInteractionStyles(),
      breakpoints: collectBreakpoints(),
      runtimeAnimations: collectRuntimeAnimations(),
      a11y: collectAccessibilityMetrics(sampledElements),
      stack: detectStack(mainWorldFrameworks),
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

  // Depth-first walk that also enters open shadow roots, so web-component
  // sites (Stencil, Lit, Salesforce...) are not invisible to extraction.
  function getAllElementsDeep(limit) {
    const output = [];
    const stack = document.documentElement ? [document.documentElement] : [];
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
    const style = window.getComputedStyle(el);
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
      for (const sheet of document.styleSheets) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;
          for (const rule of rules) {
            if (rule.type === CSSRule.STYLE_RULE) {
              const selector = rule.selectorText ? rule.selectorText.toLowerCase() : "";
              if (selector.includes(":root") || selector.includes("body") || selector.includes("html") || selector === "*") {
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
            }
          }
        } catch (e) {
          // ignore cross-origin stylesheet errors
        }
      }
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

  function forEachAccessibleRule(callback) {
    for (const sheet of document.styleSheets) {
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
      try {
        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i];
          const isInteresting = interactionProps.some(
            (candidate) => prop === candidate || prop.startsWith(`${candidate}-`)
          );
          if (!isInteresting) {
            continue;
          }
          const value = rule.style.getPropertyValue(prop).trim();
          if (value) {
            declarations.push(`${prop}: ${value}`);
          }
          if (declarations.length >= 6) break;
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

  function collectComputedBackgroundImageAssets(addAsset) {
    const elements = getAllElementsDeep(4000);
    let scanned = 0;
    for (const el of elements) {
      if (scanned >= 3000) break;
      if (!(el instanceof HTMLElement)) continue;
      scanned += 1;
      let backgroundImage = "";
      try {
        backgroundImage = window.getComputedStyle(el).backgroundImage;
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
      const style = window.getComputedStyle(el);
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

  function resolveEffectiveBackground(el) {
    let current = el;
    for (let depth = 0; current && depth < 12; depth++) {
      const bg = parseColorToRgb(window.getComputedStyle(current).backgroundColor);
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
