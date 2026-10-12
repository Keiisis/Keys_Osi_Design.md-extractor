/**
 * Keys_Osi page model: the semantic structure of one page read from its DOM
 * alone (no layout, no computed styles), so the exact same analysis runs on
 * fetched HTML parsed with DOMParser (offscreen crawler) and on a live,
 * JavaScript-rendered tab (SPA pages).
 *
 * Classic script: defines globalThis.KeysOsiPageModel. Loaded by the
 * offscreen document, injected into tabs with chrome.scripting, and
 * importable as a side-effect module in tests.
 */
(function installKeysOsiPageModel() {
  const ROOT = globalThis;
  if (ROOT.KeysOsiPageModel) {
    return;
  }

  const PAGE_MODEL_VERSION = 1;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "svg", "IFRAME", "OBJECT", "CANVAS"]);
  const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6, [role='heading']";
  const CTA_SELECTOR =
    "button, [role='button'], input[type='submit'], input[type='button'], a[class*='btn' i], a[class*='button' i], a[class*='cta' i], a[role='button']";
  // Symbol currencies are not word characters: \b only applies to letter codes.
  const PRICE_RE = /(?:[$€£¥₦]\s?\d[\d\s.,]*\d|\d[\d\s.,]*\s?(?:€|\$|£|(?:EUR|USD|CHF|FCFA|XOF|CFA|MAD|CAD)\b))/i;
  const STAT_RE = /(?:^|\s)\d+(?:[.,]\d+)?\s?(?:%|\+|k\b|K\b|M\b|x\b|★)/g;
  const SOCIAL_RE = /(facebook|instagram|twitter|x\.com|linkedin|youtube|youtu\.be|tiktok|github|pinterest|dribbble|behance|threads\.net|discord|whatsapp|telegram|snapchat|medium)\./i;
  const LOGOUT_RE = /(log-?out|sign-?out|deconnexion|déconnexion|logoff)/i;

  // Third-party services recognisable from script/iframe/link sources.
  const INTEGRATIONS = [
    ["Google Analytics", /google-analytics\.com|googletagmanager\.com\/gtag|gtag\(/i],
    ["Google Tag Manager", /googletagmanager\.com\/gtm|GTM-[A-Z0-9]+/i],
    ["Meta Pixel", /connect\.facebook\.net|fbq\(/i],
    ["Hotjar", /hotjar\.com/i],
    ["Microsoft Clarity", /clarity\.ms/i],
    ["Segment", /cdn\.segment\.com/i],
    ["Plausible", /plausible\.io/i],
    ["Matomo", /matomo|piwik/i],
    ["HubSpot", /hs-scripts\.com|hubspot\.com|hsforms/i],
    ["Intercom", /intercom(cdn)?\.(io|com)|widget\.intercom/i],
    ["Crisp", /crisp\.chat/i],
    ["Zendesk", /zdassets\.com|zendesk\.com/i],
    ["Tawk.to", /tawk\.to/i],
    ["Drift", /drift\.com|driftt\.com/i],
    ["Stripe", /js\.stripe\.com|checkout\.stripe\.com|buy\.stripe\.com/i],
    ["PayPal", /paypal\.com\/sdk|paypalobjects/i],
    ["Shopify", /cdn\.shopify\.com|myshopify\.com/i],
    ["WooCommerce", /woocommerce/i],
    ["Calendly", /calendly\.com/i],
    ["Typeform", /typeform\.com/i],
    ["Tally", /tally\.so/i],
    ["Google Maps", /maps\.google|google\.com\/maps|maps\.googleapis/i],
    ["YouTube", /youtube\.com\/embed|youtube-nocookie|ytimg/i],
    ["Vimeo", /player\.vimeo\.com/i],
    ["Mailchimp", /list-manage\.com|mailchimp/i],
    ["reCAPTCHA", /recaptcha/i],
    ["hCaptcha", /hcaptcha\.com/i],
    ["Cookiebot", /cookiebot/i],
    ["OneTrust", /onetrust|cookielaw\.org/i],
    ["Axeptio", /axept\.io|axeptio/i],
    ["Lottie", /lottie/i],
    ["Spline", /spline\.design|splinecode/i],
    ["Webflow", /webflow\.(com|io)|data-wf-page/i],
    ["Framer", /framer(usercontent)?\.com|framer\.app/i],
    ["Wix", /wixstatic\.com|parastorage\.com/i],
    ["Squarespace", /squarespace(-cdn)?\.com|static1\.squarespace/i],
    ["WordPress", /wp-content|wp-includes/i],
    ["Next.js", /\/_next\/|__NEXT_DATA__/i],
    ["Nuxt", /\/_nuxt\/|__NUXT__/i],
    ["Gatsby", /\/page-data\/|___gatsby/i],
    ["Astro", /astro-island|\/_astro\//i]
  ];

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function clip(value, max) {
    const text = clean(value);
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
    const style = (el.getAttribute("style") || "").replace(/\s+/g, "").toLowerCase();
    if (style.includes("display:none") || style.includes("visibility:hidden")) return true;
    const cls = typeof el.className === "string" ? el.className : "";
    return /(^|\s)(sr-only|visually-hidden|screen-reader-text|hidden)(\s|$)/.test(cls);
  }

  // Visible text of a subtree, without script/style/hidden content.
  function textOf(el, max = 20000) {
    if (!el) return "";
    const doc = el.ownerDocument || el;
    const parts = [];
    let length = 0;
    const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    let node = walker.nextNode();
    while (node && length < max) {
      let parent = node.parentElement;
      let skip = false;
      while (parent && parent !== el.parentElement) {
        if (SKIP_TAGS.has(parent.tagName) || isHidden(parent)) {
          skip = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!skip) {
        const value = node.nodeValue;
        if (value && value.trim()) {
          parts.push(value);
          length += value.length;
        }
      }
      node = walker.nextNode();
    }
    return clean(parts.join(" ")).slice(0, max);
  }

  function absUrl(value, base) {
    if (!value) return "";
    try {
      return new URL(value, base).href;
    } catch (error) {
      return "";
    }
  }

  function sameSite(url, origin) {
    try {
      const a = new URL(url);
      const b = new URL(origin);
      return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
    } catch (error) {
      return false;
    }
  }

  function pathOf(url) {
    try {
      const parsed = new URL(url);
      return parsed.pathname + (parsed.search || "");
    } catch (error) {
      return url;
    }
  }

  function meta(doc, name) {
    const el =
      doc.querySelector(`meta[name="${name}" i]`) ||
      doc.querySelector(`meta[property="${name}" i]`);
    return el ? clean(el.getAttribute("content")) : "";
  }

  function linkInfo(anchor, base, origin) {
    const href = absUrl(anchor.getAttribute("href"), base);
    if (!href || /^(javascript|mailto|tel|sms):/i.test(anchor.getAttribute("href") || "")) {
      return null;
    }
    const text = clip(textOf(anchor, 200) || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.querySelector("img")?.getAttribute("alt") || "", 80);
    return { text, href, internal: sameSite(href, origin) };
  }

  // Navigation tree: nested lists become children (dropdowns / mega menus).
  function navTree(container, base, origin) {
    const list = container.matches("ul, ol") ? container : container.querySelector("ul, ol");
    if (list) {
      const items = [];
      for (const li of list.children) {
        if (li.tagName !== "LI" || isHidden(li)) continue;
        // Only the item's own link: a nested submenu link is a child, not the label.
        const anchor = li.querySelector(":scope > a, :scope > :not(ul):not(ol) > a");
        const sub = li.querySelector(":scope ul, :scope ol");
        const label = anchor ? linkInfo(anchor, base, origin) : null;
        const text = label?.text || clip(textOf(li.querySelector(":scope > button, :scope > span, :scope > div") || li, 60), 60);
        const children = sub ? navTree(sub, base, origin) : [];
        if (!text && children.length === 0) continue;
        items.push({ text, href: label?.href || "", children: children.filter((child) => child.href !== label?.href) });
        if (items.length >= 24) break;
      }
      if (items.length > 0) return items;
    }
    const items = [];
    const seen = new Set();
    for (const anchor of container.querySelectorAll("a[href]")) {
      if (isHidden(anchor)) continue;
      const info = linkInfo(anchor, base, origin);
      if (!info || !info.text || seen.has(info.href + info.text)) continue;
      seen.add(info.href + info.text);
      items.push({ text: info.text, href: info.href, children: [] });
      if (items.length >= 24) break;
    }
    return items;
  }

  function findHeader(doc) {
    const candidates = [...doc.querySelectorAll("header, [role='banner']")].filter(
      (el) => !el.closest("article, section, main > *:not(header)") && !isHidden(el)
    );
    return candidates[0] || null;
  }

  function findFooter(doc) {
    const candidates = [...doc.querySelectorAll("footer, [role='contentinfo']")].filter(
      (el) => !el.closest("article") && !isHidden(el)
    );
    return candidates[candidates.length - 1] || null;
  }

  function findPrimaryNav(doc, header) {
    const scoped = header ? header.querySelector("nav, [role='navigation']") : null;
    if (scoped) return scoped;
    const navs = [...doc.querySelectorAll("nav, [role='navigation']")].filter(
      (nav) => !nav.closest("footer") && !/breadcrumb/i.test(nav.getAttribute("aria-label") || nav.className || "")
    );
    return navs[0] || header || null;
  }

  function footerModel(footer, base, origin) {
    if (!footer) return null;
    const groups = [];
    const blocks = footer.querySelectorAll("ul, ol");
    for (const list of blocks) {
      if (isHidden(list)) continue;
      const links = [];
      for (const anchor of list.querySelectorAll("a[href]")) {
        const info = linkInfo(anchor, base, origin);
        if (info && info.text) links.push({ text: info.text, href: info.href });
      }
      if (links.length === 0 || links.every((link) => SOCIAL_RE.test(link.href))) continue;
      // The group title is the closest heading-like element before the list.
      let title = "";
      let probe = list.previousElementSibling || list.parentElement?.previousElementSibling || null;
      for (let i = 0; probe && i < 3 && !title; i++) {
        if (/^H[1-6]$/.test(probe.tagName) || /^(STRONG|B|P|SPAN|DIV)$/.test(probe.tagName)) {
          const text = clip(textOf(probe, 80), 50);
          if (text && text.length <= 50 && !probe.querySelector("a")) title = text;
        }
        probe = probe.previousElementSibling;
      }
      if (!title) {
        const heading = list.parentElement?.querySelector(":scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > p, :scope > strong");
        if (heading && heading !== list) title = clip(textOf(heading, 80), 50);
      }
      groups.push({ title, links: links.slice(0, 16) });
      if (groups.length >= 10) break;
    }
    const social = [];
    const contact = [];
    for (const anchor of footer.querySelectorAll("a[href]")) {
      const raw = anchor.getAttribute("href") || "";
      if (/^(mailto|tel):/i.test(raw)) {
        contact.push(raw.replace(/^(mailto|tel):/i, "").split("?")[0]);
      } else if (SOCIAL_RE.test(raw)) {
        const match = raw.match(SOCIAL_RE);
        if (match && !social.some((item) => item.network === match[1])) {
          social.push({ network: match[1].replace(/\.net$/, ""), href: absUrl(raw, base) });
        }
      }
    }
    const text = textOf(footer, 4000);
    const legal = (text.match(/(©|\(c\)|copyright)[^.|]{0,120}/i) || [""])[0];
    if (groups.length === 0) {
      const links = navTree(footer, base, origin).map((item) => ({ text: item.text, href: item.href }));
      if (links.length > 0) groups.push({ title: "", links });
    }
    return { groups, social, contact: [...new Set(contact)].slice(0, 6), legal: clip(legal, 140) };
  }

  // Descends through single dominant wrappers to the element whose children
  // are the page's real sections (works for div-soup builders too).
  function contentRoot(doc, header, footer) {
    let node = doc.querySelector("main, [role='main']") || doc.body;
    if (!node) return null;
    const total = Math.max(1, textOf(node, 60000).length);
    for (let depth = 0; depth < 10; depth++) {
      const children = [...node.children].filter(
        (child) => !SKIP_TAGS.has(child.tagName) && !isHidden(child) && child !== header && child !== footer && !child.contains(header) && !child.contains(footer)
      );
      if (children.length !== 1) {
        // Two children where one is the header/footer wrapper still counts as dominant.
        const heavy = children.filter((child) => textOf(child, 60000).length > total * 0.8);
        if (heavy.length === 1 && children.length <= 3 && heavy[0].children.length > 1) {
          node = heavy[0];
          continue;
        }
        break;
      }
      if (textOf(children[0], 60000).length < total * 0.6 || children[0].children.length === 0) break;
      node = children[0];
    }
    return node;
  }

  function directHeading(el) {
    return el.querySelector(HEADING_SELECTOR);
  }

  function isSectionLike(el) {
    if (/^(SECTION|ARTICLE|ASIDE|FORM|FIGURE)$/.test(el.tagName)) return true;
    return Boolean(el.querySelector(":scope > h1, :scope > h2, :scope > * > h1, :scope > * > h2, :scope > * > * > h2"));
  }

  function collectSectionElements(root, header, footer) {
    const output = [];
    const visit = (parent, depth) => {
      for (const child of parent.children) {
        if (output.length >= 40) return;
        if (SKIP_TAGS.has(child.tagName) || isHidden(child)) continue;
        if (child === header || child === footer || child.contains(header) || child.contains(footer)) {
          if (child !== header && child !== footer && depth < 6) visit(child, depth + 1);
          continue;
        }
        if (/^(NAV|DIALOG)$/.test(child.tagName) && !child.querySelector("h1, h2")) continue;
        const text = textOf(child, 4000);
        const media = child.querySelectorAll("img, video, picture, iframe, svg").length;
        if (text.length < 12 && media === 0 && !child.querySelector("form, input")) continue;
        // A wrapper that holds several sections of its own is flattened.
        const sectionKids = [...child.children].filter((kid) => !isHidden(kid) && isSectionLike(kid));
        if (depth < 4 && sectionKids.length >= 2 && !/^(SECTION|ARTICLE)$/.test(child.tagName)) {
          visit(child, depth + 1);
          continue;
        }
        output.push(child);
      }
    };
    visit(root, 0);
    return output;
  }

  // Repeated siblings (cards, tiers, posts, logos): the deepest container
  // whose children share one structural signature.
  function signature(el) {
    return `${el.tagName}>${[...el.children].slice(0, 6).map((child) => child.tagName).join(",")}`;
  }

  function findRepeatedItems(section) {
    let best = null;
    const containers = [section, ...section.querySelectorAll("div, ul, ol, section")].slice(0, 400);
    for (const container of containers) {
      const kids = [...container.children].filter((kid) => !isHidden(kid) && !SKIP_TAGS.has(kid.tagName));
      if (kids.length < 3) continue;
      const counts = new Map();
      for (const kid of kids) counts.set(signature(kid), (counts.get(signature(kid)) || 0) + 1);
      const [sig, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (count < 3 || count < kids.length * 0.6) continue;
      const items = kids.filter((kid) => signature(kid) === sig);
      const richness = items.reduce((sum, item) => sum + Math.min(400, textOf(item, 400).length) + item.querySelectorAll("img, svg").length * 20, 0);
      if (!best || richness > best.richness) {
        best = { items, richness };
      }
    }
    if (!best) return [];
    return best.items.slice(0, 12).map((item) => {
      const heading = item.querySelector("h2, h3, h4, h5, h6, strong, b, [class*='title' i]");
      const paragraph = [...item.querySelectorAll("p, li, span")].map((el) => textOf(el, 300)).find((text) => text && text !== textOf(heading, 200));
      const anchor = item.matches("a[href]") ? item : item.querySelector("a[href]");
      const img = item.querySelector("img");
      const text = textOf(item, 600);
      const price = (text.match(PRICE_RE) || [""])[0];
      return {
        title: clip(textOf(heading, 160) || (text.length <= 60 ? text : ""), 90),
        text: clip(paragraph || (heading ? "" : text), 220),
        href: anchor ? absUrl(anchor.getAttribute("href"), item.ownerDocument.baseURI) : "",
        image: img ? clip(img.getAttribute("alt") || "", 80) || "(image)" : "",
        price: clean(price)
      };
    });
  }

  function ctasOf(scope, base, origin, limit = 4) {
    const ctas = [];
    for (const el of scope.querySelectorAll(CTA_SELECTOR)) {
      if (ctas.length >= limit) break;
      if (isHidden(el) || el.closest("nav")) continue;
      const label = clip(textOf(el, 120) || el.getAttribute("value") || el.getAttribute("aria-label") || "", 50);
      if (!label || label.length < 2) continue;
      const anchor = el.closest("a[href]") || (el.matches("a[href]") ? el : null);
      const href = anchor ? absUrl(anchor.getAttribute("href"), base) : "";
      if (ctas.some((cta) => cta.label === label)) continue;
      ctas.push({ label, href, internal: href ? sameSite(href, origin) : false, action: href ? "link" : el.closest("form") ? "submit" : "button" });
    }
    // Hero/CTA sections often use plain links styled as buttons without class hints.
    if (ctas.length === 0) {
      for (const anchor of scope.querySelectorAll("a[href]")) {
        if (ctas.length >= 2) break;
        if (isHidden(anchor) || anchor.closest("nav, li, p")) continue;
        const label = clip(textOf(anchor, 80), 40);
        if (!label || label.split(" ").length > 6) continue;
        const href = absUrl(anchor.getAttribute("href"), base);
        ctas.push({ label, href, internal: sameSite(href, origin), action: "link" });
      }
    }
    return ctas;
  }

  function mediaOf(scope, base) {
    const images = [];
    for (const img of scope.querySelectorAll("img")) {
      if (images.length >= 8) break;
      if (isHidden(img)) continue;
      const src = img.getAttribute("src") || img.getAttribute("data-src") || (img.getAttribute("srcset") || "").split(/\s+/)[0] || "";
      images.push({ alt: clip(img.getAttribute("alt") || "", 100), src: absUrl(src, base) });
    }
    const embeds = [];
    for (const frame of scope.querySelectorAll("iframe[src], video, [data-video-id]")) {
      const src = frame.getAttribute("src") || frame.querySelector("source")?.getAttribute("src") || frame.getAttribute("poster") || "";
      const kind = /youtube|youtu\.be/.test(src) ? "youtube" : /vimeo/.test(src) ? "vimeo" : /maps/.test(src) ? "map" : frame.tagName === "VIDEO" ? "video" : "embed";
      embeds.push({ kind, src: absUrl(src, base) });
      if (embeds.length >= 4) break;
    }
    return { images, embeds, svgCount: scope.querySelectorAll("svg").length };
  }

  const ROLE_RULES = [
    ["faq", (s) => s.hasDetails || /\b(faq|frequently asked|questions fréquentes|questions frequentes|preguntas frecuentes|häufige fragen)\b/i.test(s.headText)],
    ["pricing", (s) => s.priceCount >= 2 || /\b(pricing|tarifs?|prix|plans?|abonnements?|precios)\b/i.test(s.headText)],
    ["testimonials", (s) => s.quoteCount >= 1 || /\b(testimonials?|reviews?|avis|témoignages?|temoignages?|ce qu.ils disent|what (our )?(customers|clients) say|trusted by)\b/i.test(s.headText)],
    ["newsletter", (s) => s.formFields > 0 && s.formFields <= 2 && /\b(newsletter|subscribe|inscri|abonne|updates)\b/i.test(s.text)],
    ["contact", (s) => (s.formFields >= 2 && /\b(contact|message|devis|quote|rendez-vous|appointment|book)\b/i.test(s.text)) || /\b(contact|nous contacter|get in touch|écrivez-nous)\b/i.test(s.headText)],
    ["logos", (s) => s.imageCount >= 4 && s.text.length < 160],
    ["stats", (s) => s.statCount >= 3 && s.text.length < 900],
    ["team", (s) => /\b(team|équipe|equipe|our people|fondateurs|founders)\b/i.test(s.headText)],
    ["blog-list", (s) => s.items.length >= 3 && s.timeCount >= 2],
    ["steps", (s) => /\b(how it works|comment ça marche|comment ca marche|étapes|etapes|steps|process|processus)\b/i.test(s.headText) || s.orderedList],
    ["gallery", (s) => s.imageCount >= 4 && s.items.length >= 4 && s.text.length < 600],
    ["video", (s) => s.embeds.some((embed) => /youtube|vimeo|video/.test(embed.kind)) && s.text.length < 400],
    ["map", (s) => s.embeds.some((embed) => embed.kind === "map")],
    ["comparison", (s) => s.tableCount > 0],
    ["features", (s) => s.items.length >= 3],
    ["cta", (s) => s.ctas.length > 0 && s.text.length < 420],
    ["article", (s) => s.text.length > 1500 && s.paragraphCount >= 5],
    ["content", () => true]
  ];

  function classifySection(signals, index) {
    if (signals.hasH1 && index <= 1) return "hero";
    for (const [role, test] of ROLE_RULES) {
      if (test(signals)) return role;
    }
    return "content";
  }

  function analyzeSection(el, index, base, origin, formIndex) {
    const headingEl = directHeading(el);
    const heading = clip(textOf(headingEl, 300), 140);
    const paragraphs = [...el.querySelectorAll("p")]
      .filter((p) => !isHidden(p) && !p.closest("li, blockquote, nav"))
      .map((p) => clip(textOf(p, 600), 320))
      .filter(Boolean);
    const headingLevel = headingEl && /^H[1-6]$/.test(headingEl.tagName) ? Number(headingEl.tagName[1]) : 0;
    // The eyebrow is a short label right before the heading ("PRICING", "Nouveau").
    let eyebrow = "";
    const prev = headingEl?.previousElementSibling;
    if (prev && !/^H[1-6]$/.test(prev.tagName)) {
      const text = clip(textOf(prev, 80), 50);
      if (text && text.split(" ").length <= 5) eyebrow = text;
    }
    const subheading = paragraphs[0] || "";
    const bullets = [...el.querySelectorAll("li")]
      .filter((li) => !isHidden(li) && !li.closest("nav") && !(li.children.length === 1 && li.firstElementChild?.tagName === "A" && textOf(li, 80).split(" ").length <= 3))
      .map((li) => clip(textOf(li, 300), 160))
      .filter(Boolean)
      .slice(0, 12);
    const items = findRepeatedItems(el);
    const ctas = ctasOf(el, base, origin);
    const media = mediaOf(el, base);
    const text = textOf(el, 6000);
    const forms = [...el.querySelectorAll("form")].map((form) => formIndex.get(form)).filter((value) => value !== undefined);
    const formFields = el.querySelectorAll("input:not([type='hidden']):not([type='submit']), textarea, select").length;
    const signals = {
      text,
      headText: `${heading} ${eyebrow} ${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`,
      hasH1: Boolean(el.querySelector("h1")),
      hasDetails: el.querySelectorAll("details, [aria-expanded]").length >= 3,
      priceCount: (text.match(new RegExp(PRICE_RE.source, "gi")) || []).length,
      quoteCount: el.querySelectorAll("blockquote, q, [class*='testimonial' i], [class*='review' i]").length,
      statCount: (text.match(STAT_RE) || []).length,
      timeCount: el.querySelectorAll("time").length,
      imageCount: media.images.length,
      embeds: media.embeds,
      tableCount: el.querySelectorAll("table").length,
      orderedList: Boolean(el.querySelector("ol > li + li + li")),
      paragraphCount: paragraphs.length,
      items,
      ctas,
      formFields
    };
    const tag = el.tagName.toLowerCase();
    return {
      index,
      role: classifySection(signals, index),
      tag,
      id: el.id || "",
      heading,
      headingLevel,
      eyebrow,
      subheading,
      paragraphs: paragraphs.slice(1, 6),
      bullets: items.length >= 3 ? [] : bullets,
      items,
      ctas,
      media,
      forms,
      prices: signals.priceCount,
      wordCount: text ? text.split(" ").length : 0
    };
  }

  function formsOf(doc, base) {
    const forms = [];
    const index = new Map();
    for (const form of doc.querySelectorAll("form")) {
      if (forms.length >= 12) break;
      if (isHidden(form)) continue;
      const fields = [];
      for (const field of form.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']), textarea, select")) {
        if (fields.length >= 20) break;
        let label = "";
        if (field.id) {
          const labelEl = doc.querySelector(`label[for="${field.id.replace(/"/g, '\\"')}"]`);
          if (labelEl) label = textOf(labelEl, 120);
        }
        if (!label) label = textOf(field.closest("label"), 120) || field.getAttribute("aria-label") || "";
        const type = field.tagName === "SELECT" ? "select" : field.tagName === "TEXTAREA" ? "textarea" : (field.getAttribute("type") || "text").toLowerCase();
        const options = field.tagName === "SELECT" ? [...field.querySelectorAll("option")].map((option) => clip(textOf(option, 60), 40)).filter(Boolean).slice(0, 12) : [];
        fields.push({
          label: clip(label, 60),
          name: field.getAttribute("name") || "",
          type,
          placeholder: clip(field.getAttribute("placeholder") || "", 60),
          required: field.hasAttribute("required") || field.getAttribute("aria-required") === "true",
          options
        });
      }
      const submit = form.querySelector("button[type='submit'], input[type='submit'], button:not([type])");
      const text = textOf(form, 400).toLowerCase();
      const fieldNames = fields.map((field) => `${field.type} ${field.name} ${field.label}`.toLowerCase()).join(" ");
      let purpose = "form";
      if (/password|mot de passe/.test(fieldNames) && fields.length <= 3) purpose = "login";
      else if (/password|mot de passe/.test(fieldNames)) purpose = "signup";
      else if (fields.length === 1 && /search|recherche|\bq\b/.test(fieldNames + text)) purpose = "search";
      else if (fields.length <= 2 && /email|e-mail/.test(fieldNames)) purpose = "newsletter";
      else if (/message|textarea/.test(fieldNames)) purpose = "contact";
      else if (/date|time|heure|guests|personnes|couverts/.test(fieldNames)) purpose = "booking";
      else if (/card|carte|cvc|iban/.test(fieldNames)) purpose = "payment";
      index.set(form, forms.length);
      forms.push({
        index: forms.length,
        purpose,
        id: form.id || form.getAttribute("name") || "",
        method: (form.getAttribute("method") || "get").toLowerCase(),
        action: absUrl(form.getAttribute("action") || "", base),
        fields,
        submit: clip(submit ? textOf(submit, 80) || submit.getAttribute("value") || "" : "", 40)
      });
    }
    return { forms, index };
  }

  function jsonLdOf(doc) {
    const types = new Set();
    const summary = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node["@graph"]) visit(node["@graph"]);
      const type = [].concat(node["@type"] || []).join(",");
      if (type) {
        types.add(type);
        const entry = { type };
        for (const key of ["name", "headline", "description", "datePublished", "author", "price", "priceCurrency", "brand", "sku", "telephone", "address", "openingHours", "servesCuisine", "aggregateRating"]) {
          const value = node[key];
          if (value === undefined) continue;
          entry[key] = typeof value === "object" ? clip(value.name || value.ratingValue || value.streetAddress || JSON.stringify(value), 120) : clip(value, 160);
        }
        if (node.offers) {
          const offer = [].concat(node.offers)[0] || {};
          if (offer.price) entry.price = clip(offer.price, 20);
          if (offer.priceCurrency) entry.priceCurrency = clip(offer.priceCurrency, 8);
        }
        if (type.includes("FAQPage") && Array.isArray(node.mainEntity)) {
          entry.questions = node.mainEntity.map((question) => clip(question.name, 140)).slice(0, 12);
        }
        if (type.includes("BreadcrumbList") && Array.isArray(node.itemListElement)) {
          entry.trail = node.itemListElement.map((item) => clip(item.name || item.item?.name || "", 40)).filter(Boolean);
        }
        if (summary.length < 8) summary.push(entry);
      }
    };
    for (const script of doc.querySelectorAll("script[type='application/ld+json']")) {
      try {
        visit(JSON.parse(script.textContent || "null"));
      } catch (error) {
        // Malformed JSON-LD is common; ignore that block only.
      }
    }
    return { types: [...types], summary };
  }

  function integrationsOf(doc) {
    const haystack = [
      ...[...doc.querySelectorAll("script[src], iframe[src], link[href]")].map((el) => el.getAttribute("src") || el.getAttribute("href") || ""),
      ...[...doc.querySelectorAll("script:not([src])")].map((el) => (el.textContent || "").slice(0, 3000)),
      doc.documentElement ? [...doc.documentElement.attributes].map((attr) => `${attr.name}=${attr.value}`).join(" ") : ""
    ].join("\n");
    return INTEGRATIONS.filter(([, re]) => re.test(haystack)).map(([name]) => name);
  }

  function outlineOf(doc) {
    const outline = [];
    for (const el of doc.querySelectorAll("h1, h2, h3")) {
      if (outline.length >= 60) break;
      if (isHidden(el) || el.closest("nav, footer")) continue;
      const text = clip(textOf(el, 300), 140);
      if (text) outline.push({ level: Number(el.tagName[1]), text });
    }
    return outline;
  }

  function breadcrumbOf(doc) {
    const nav = doc.querySelector("nav[aria-label*='breadcrumb' i], [class*='breadcrumb' i], ol[itemtype*='BreadcrumbList']");
    if (!nav) return [];
    return [...nav.querySelectorAll("a, li > span, li")].map((el) => clip(textOf(el, 80), 40)).filter((text, i, all) => text && all.indexOf(text) === i).slice(0, 8);
  }

  // Signals that the HTML is an empty client-side shell (needs rendering).
  function spaSignals(doc, bodyText) {
    const root = doc.querySelector("#root, #app, #__next, #__nuxt, #___gatsby, [data-reactroot], app-root, #svelte");
    const scripts = doc.querySelectorAll("script[src]").length;
    const thin = bodyText.length < 200;
    const emptyRoot = Boolean(root) && textOf(root, 400).length < 80;
    return { bodyTextLength: bodyText.length, scripts, appRoot: Boolean(root), needsRender: (thin && scripts > 0) || (emptyRoot && bodyText.length < 600) };
  }

  /**
   * Full semantic model of a page.
   * @param {Document} doc parsed or live document
   * @param {{ url?: string, rendered?: boolean, status?: number }} options
   */
  function analyzeDocument(doc, options = {}) {
    const url = options.url || doc.URL || "";
    const base = doc.baseURI && !/^about:/.test(doc.baseURI) ? doc.baseURI : url;
    let origin = url;
    try {
      origin = new URL(url).origin;
    } catch (error) {}

    const header = findHeader(doc);
    const footer = findFooter(doc);
    const nav = findPrimaryNav(doc, header);
    const { forms, index: formIndex } = formsOf(doc, base);
    const root = contentRoot(doc, header, footer);
    const sectionEls = root ? collectSectionElements(root, header, footer) : [];
    const sections = sectionEls.map((el, i) => analyzeSection(el, i, base, origin, formIndex));
    const bodyText = textOf(doc.body, 120000);

    const internalLinks = [];
    const external = new Map();
    const seen = new Set();
    for (const anchor of doc.querySelectorAll("a[href]")) {
      const info = linkInfo(anchor, base, origin);
      if (!info) continue;
      if (!info.internal) {
        try {
          const host = new URL(info.href).hostname.replace(/^www\./, "");
          external.set(host, (external.get(host) || 0) + 1);
        } catch (error) {}
        continue;
      }
      const key = info.href.split("#")[0];
      if (seen.has(key) || LOGOUT_RE.test(key)) continue;
      seen.add(key);
      const context = anchor.closest("header, [role='banner']") || (nav && nav.contains(anchor))
        ? "nav"
        : anchor.closest("footer, [role='contentinfo']")
          ? "footer"
          : anchor.closest("nav")
            ? "subnav"
            : "content";
      internalLinks.push({ href: key, text: info.text, context, rel: (anchor.getAttribute("rel") || "").toLowerCase() });
      if (internalLinks.length >= 400) break;
    }

    const hreflang = [...doc.querySelectorAll("link[rel='alternate'][hreflang]")]
      .map((link) => ({ lang: link.getAttribute("hreflang"), href: absUrl(link.getAttribute("href"), base) }))
      .filter((entry) => entry.lang && entry.href)
      .slice(0, 40);

    const canonicalEl = doc.querySelector("link[rel='canonical']");
    const jsonLd = jsonLdOf(doc);
    const h1 = doc.querySelector("h1");

    return {
      version: PAGE_MODEL_VERSION,
      url,
      path: pathOf(url),
      status: options.status || 200,
      rendered: Boolean(options.rendered),
      lang: clean(doc.documentElement?.getAttribute("lang") || ""),
      title: clip(doc.title || "", 200),
      h1: clip(textOf(h1, 300), 160),
      h1Count: doc.querySelectorAll("h1").length,
      metaDescription: clip(meta(doc, "description"), 300),
      robots: meta(doc, "robots"),
      canonical: canonicalEl ? absUrl(canonicalEl.getAttribute("href"), base) : "",
      og: {
        title: clip(meta(doc, "og:title"), 200),
        description: clip(meta(doc, "og:description"), 300),
        image: absUrl(meta(doc, "og:image"), base),
        type: meta(doc, "og:type")
      },
      hreflang,
      jsonLd,
      breadcrumb: breadcrumbOf(doc),
      outline: outlineOf(doc),
      nav: nav ? navTree(nav, base, origin) : [],
      footer: footerModel(footer, base, origin),
      sections,
      forms,
      ctas: ctasOf(root || doc.body || doc, base, origin, 8),
      internalLinks,
      externalDomains: [...external.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([host, count]) => ({ host, count })),
      integrations: integrationsOf(doc),
      media: {
        images: doc.querySelectorAll("img").length,
        videos: doc.querySelectorAll("video, iframe[src*='youtube'], iframe[src*='vimeo']").length,
        svgs: doc.querySelectorAll("svg").length
      },
      wordCount: bodyText ? bodyText.split(" ").length : 0,
      textSample: clip(textOf(root || doc.body, 1600), 1200),
      spa: spaSignals(doc, bodyText)
    };
  }

  ROOT.KeysOsiPageModel = { analyzeDocument, PAGE_MODEL_VERSION };
})();
