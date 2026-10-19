(() => {
  const MODE = window.__KOE_MODE__ || "collect";
  // One-shot: a stale mode must not leak into the next injection on this page.
  delete window.__KOE_MODE__;
  const MIN_LEN = 8;
  const MAX_LEN = 50000;
  const SCROLL_DELAY = 800;
  const MAX_SAME_HEIGHT = 3;

  const safe = (fn, fallback = null) => {
    try {
      const v = fn();
      return v === undefined ? fallback : v;
    } catch { return fallback; }
  };

  const normalize = (t) => t.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 400);

  const seen = new Set();
  const isDupe = (text) => {
    const key = normalize(text);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  };

  const getText = (el) => {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    if (el.isContentEditable) return el.innerText || "";
    return el.innerText || el.textContent || "";
  };

  const PROMPT_PATTERNS = [
    /\byou are (?:a|an)\b/i,
    /\bact as\b/i,
    /\bsystem\s*:/i,
    /\buser\s*:/i,
    /\bassistant\s*:/i,
    /\brole\s*:/i,
    /\binstructions?\s*:/i,
    /\bprompt\s*:/i,
    /\brespond (?:in|with)\b/i,
    /\bgenerate (?:a|an)\b/i,
    /\bwrite (?:a|an|me)\b/i,
    /\bcreate (?:a|an)\b/i,
    /\btask\s*:/i,
    /\bcontext\s*:/i,
    /\bgoal\s*:/i,
    /\boutput format\s*:/i,
    /\bconstraints?\s*:/i,
    /\bexamples?\s*:/i,
    /\bstep\s+\d/i,
    /\{[a-z_]+\}/,
    /\[\[[a-z_]+\]\]/,
    /<<[a-z_]+>>/,
    /\b(?:tone|persona|audience)\s*:/i,
    // Image prompts: Midjourney-style parameters.
    /(?:^|\s)--(?:ar|v|q|s|style|niji|chaos|seed|stylize|no)\s/i
  ];

  const scoreText = (text) => {
    if (!text || text.length < MIN_LEN) return 0;
    let score = 0;
    for (const pat of PROMPT_PATTERNS) {
      if (pat.test(text)) score++;
    }
    const lines = text.split("\n").filter(l => l.trim().length > 0);
    if (lines.length >= 3) score += 0.5;
    // imperative openings
    if (/^(You |Please |Write |Generate |Create |Act |Respond |Given |Task)/m.test(text)) score += 0.5;
    // Image prompts are descriptor lists on one line: "subject, style, lighting, lens".
    if (lines.length <= 2 && text.split(",").length >= 4) score += 1;
    return score;
  };

  const items = [];

  // A short text that reads like nothing (a card title and its category,
  // a menu label) is not a prompt: low-confidence items need some length.
  const MIN_LOW_LEN = 80;

  // Paywall and sign-up messages ("free copy limit", "create an account") are not prompts.
  const PAYWALL_TEXT = /copy limit|create an account|sign up to|log in to|upgrade to|limite de copies|crée un compte|créez un compte/i;

  const addItem = (text, source, forced = null) => {
    if (!text) return;
    const t = text.trim();
    if (t.length < MIN_LEN || t.length > MAX_LEN) return;
    if (t.length < 800 && PAYWALL_TEXT.test(t)) return;
    const score = scoreText(t);
    const confidence = forced || (score >= 1 ? "high" : "low");
    if (confidence === "low" && t.length < MIN_LOW_LEN) return;
    if (isDupe(t)) return;
    items.push({ text: t, source, chars: t.length, confidence });
  };

  const PROMPT_SELECTORS = [
    "[data-prompt]",
    "[class*='prompt']",
    "[id*='prompt']",
    "[class*='template']",
    "[class*='instruction']",
    "[class*='system-message']",
    "[class*='message-content']",
    "[class*='chat-message']",
    "[class*='completion']",
    "[class*='snippet']",
    "[class*='example']"
  ];

  const CODE_SELECTORS = [
    "pre",
    "code",
    "textarea",
    "[contenteditable]"
  ];

  const EDITOR_SELECTORS = [
    ".monaco-editor .view-lines",
    ".CodeMirror",
    ".cm-editor .cm-content",
    ".ace_editor .ace_text-layer"
  ];

  const CLIPBOARD_ATTRS = ["data-clipboard-text", "data-copy-text", "data-copy-value"];

  const HOST = location.hostname.replace(/^www\./, "");
  // Per-site selectors. flowgpt.com serves its catalogue through __NEXT_DATA__ (see
  // scanInlineData). promptbase.com did not render headless: best-guess selectors.
  const SITE_ADAPTERS = {
    "flowgpt.com": "[class*='PromptCard'], [class*='prompt-detail' i], [class*='ChatMessage']",
    "promptbase.com": "[class*='prompt-text' i], [class*='PromptCard'], [data-prompt-id], .prompt-content, .prompt-body"
  };
  // Catalogue cards that carry a title and a category, never the prompt (checked on
  // motionsites.ai, 2026-10-19: the text only comes from "Copy full prompt" on an opened
  // card). Used to explain an empty result, not as prompts.
  const CATALOGUE_CARDS = {
    "motionsites.ai": ".prompt-card-hover"
  };

  const PROMPT_JSON_KEYS = /prompt|instruction|template|system_?message|user_?message|^(message|messages|content|query|input|text|body|description)$/i;

  // Gated content is not taken: a premium prompt shown blurred, hidden in a paywall
  // block or present only in the page data under a premium flag has not been given
  // to this account. Visible text that is merely not selectable stays readable.
  const GATED_ATTR = /\b(paywall(ed)?|premium|pro-only|gated|subscribers?-only|members?-only)\b/i;
  const GATED_KEY = /^(is_?|has_?)?(premium|locked|paid|gated|pro_?only|paywall(ed)?|requires?_?(subscription|purchase|payment|unlock))$/i;
  let gatedCount = 0;
  const gatedCache = new WeakMap();
  const isGated = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (gatedCache.has(el)) return gatedCache.get(el);
    const attrs = `${typeof el.className === "string" ? el.className : ""} ${el.id || ""} ${el.getAttribute("aria-label") || ""}`;
    const gated = GATED_ATTR.test(attrs) || /blur\(/.test(safe(() => getComputedStyle(el).filter, "")) || isGated(el.parentElement);
    gatedCache.set(el, gated);
    return gated;
  };
  const addFrom = (el, text, source) => {
    if (isGated(el)) {
      if (text && String(text).trim().length >= MIN_LEN) gatedCount++;
      return;
    }
    addItem(text, source);
  };

  const scanElement = (root) => {
    if (!root || !root.querySelectorAll) return;

    if (SITE_ADAPTERS[HOST]) {
      safe(() => {
        for (const el of root.querySelectorAll(SITE_ADAPTERS[HOST])) addFrom(el, getText(el), `adapter:${HOST}`);
      });
    }

    for (const sel of PROMPT_SELECTORS) {
      safe(() => {
        for (const el of root.querySelectorAll(sel)) {
          addFrom(el, getText(el), `dom:${sel}`);
          if (el.hasAttribute("data-prompt")) {
            addFrom(el, el.getAttribute("data-prompt"), "attr:data-prompt");
          }
        }
      });
    }

    for (const sel of CODE_SELECTORS) {
      safe(() => {
        for (const el of root.querySelectorAll(sel)) {
          addFrom(el, getText(el), `code:${sel}`);
        }
      });
    }

    for (const sel of EDITOR_SELECTORS) {
      safe(() => {
        for (const el of root.querySelectorAll(sel)) {
          addFrom(el, getText(el), `editor:${sel}`);
        }
      });
    }

    for (const attr of CLIPBOARD_ATTRS) {
      safe(() => {
        for (const el of root.querySelectorAll(`[${attr}]`)) {
          addFrom(el, el.getAttribute(attr), `clipboard:${attr}`);
        }
      });
    }

    // copy buttons: traverse up to find sibling text container
    safe(() => {
      const copyBtns = root.querySelectorAll(
        "[class*='copy'], [aria-label*='copy' i], [aria-label*='Copy' i], [title*='copy' i], [data-copy], button[class*='clipboard']"
      );
      for (const btn of copyBtns) {
        const btnText = getText(btn);
        // Stop at the nearest semantic container; climbing to <body> would grab the whole
        // page (nav, footer, every other card) as one bogus item.
        let scope = btn.closest("article, section, li, [class*='card' i], [class*='item' i], [class*='prompt' i], [class*='message' i]") || btn.parentElement;
        for (let i = 0; i < 5 && scope && scope !== document.body && scope !== document.documentElement; i++, scope = scope.parentElement) {
          const text = getText(scope).replace(btnText, "").trim();
          if (text.length >= MIN_LEN) {
            addFrom(scope, text, "copy-button-sibling");
            break;
          }
        }
      }
    });

    // hidden elements
    safe(() => {
      for (const el of root.querySelectorAll("[aria-hidden='true'], [style*='display:none'], [style*='display: none'], [style*='visibility:hidden'], [style*='visibility: hidden'], [style*='opacity:0'], [style*='opacity: 0'], [hidden]")) {
        const t = getText(el);
        if (t.length >= MIN_LEN && scoreText(t) >= 1) {
          addFrom(el, t, "hidden-element");
        }
      }
    });

    // all data-* attributes
    safe(() => {
      for (const el of root.querySelectorAll("*")) {
        if (!el.dataset) continue;
        for (const [key, val] of Object.entries(el.dataset)) {
          if (val && val.length >= MIN_LEN && val.length <= MAX_LEN && scoreText(val) >= 1) {
            addFrom(el, val, `data-attr:${key}`);
          }
        }
      }
    });
  };

  const walkShadowRoots = (root) => {
    if (!root || !root.querySelectorAll) return;
    scanElement(root);
    safe(() => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          walkShadowRoots(el.shadowRoot);
        }
      }
    });
  };

  const scanIframes = () => {
    safe(() => {
      for (const iframe of document.querySelectorAll("iframe")) {
        safe(() => {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc) walkShadowRoots(doc);
        });
      }
    });
  };

  // Framework payloads nest their data under neutral keys (props.pageProps.<x>), so every
  // branch is visited; a string is kept when its key is prompt-like or its text scores.
  const deepScanJSON = (obj, path, depth, keyHit = false) => {
    if (!obj || depth > 12) return;
    if (typeof obj === "string") {
      if (obj.length >= MIN_LEN && obj.length <= MAX_LEN && (keyHit || scoreText(obj) >= 1)) {
        addItem(obj, `json:${path}`);
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < Math.min(obj.length, 200); i++) {
        deepScanJSON(obj[i], `${path}[${i}]`, depth + 1, keyHit);
      }
      return;
    }
    if (typeof obj === "object") {
      // A record flagged premium / locked / paid is gated: skip it whole.
      if (Object.entries(obj).some(([k, v]) => GATED_KEY.test(k) && v === true)) {
        gatedCount++;
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        deepScanJSON(v, `${path}.${k}`, depth + 1, PROMPT_JSON_KEYS.test(k));
      }
    }
  };

  const scanInlineData = () => {
    // __NEXT_DATA__
    safe(() => {
      const el = document.getElementById("__NEXT_DATA__");
      if (el) {
        const data = JSON.parse(el.textContent);
        deepScanJSON(data, "__NEXT_DATA__", 0);
      }
    });

    // __NUXT__ / __NUXT_DATA__
    safe(() => {
      if (window.__NUXT__) deepScanJSON(window.__NUXT__, "__NUXT__", 0);
    });
    safe(() => {
      const nuxtEls = document.querySelectorAll("[id^='__NUXT_DATA__']");
      for (const el of nuxtEls) {
        safe(() => deepScanJSON(JSON.parse(el.textContent), "__NUXT_DATA__", 0));
      }
    });

    // application/json and JSON-LD
    safe(() => {
      for (const s of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')) {
        safe(() => deepScanJSON(JSON.parse(s.textContent), "script-json", 0));
      }
    });

    // window globals
    const globals = ["__INITIAL_STATE__", "__APP_DATA__", "__PRELOADED_STATE__"];
    for (const g of globals) {
      safe(() => {
        if (window[g]) deepScanJSON(window[g], g, 0);
      });
    }

    // inline script strings — look for large quoted strings that smell like prompts
    safe(() => {
      // JSON data scripts are read structurally above (with the premium guard).
      for (const s of document.querySelectorAll("script:not([src]):not([type='application/json']):not([type='application/ld+json'])")) {
        const src = s.textContent || "";
        if (src.length > 500000) continue; // skip huge bundles
        const matches = src.match(/"([^"]{40,2000})"/g) || [];
        for (const m of matches) {
          const val = m.slice(1, -1);
          if (scoreText(val) >= 1) {
            addItem(val, "inline-script-string");
          }
        }
        const singleMatches = src.match(/'([^']{40,2000})'/g) || [];
        for (const m of singleMatches) {
          const val = m.slice(1, -1);
          if (scoreText(val) >= 1) {
            addItem(val, "inline-script-string");
          }
        }
        const backtickMatches = src.match(/`([^`]{40,2000})`/g) || [];
        for (const m of backtickMatches) {
          const val = m.slice(1, -1);
          if (scoreText(val) >= 1) {
            addItem(val, "inline-script-string");
          }
        }
      }
    });
  };

  // The page's own copy controls, pressed as a visitor would: what the page writes
  // to the clipboard is kept, then navigator.clipboard.writeText is put back. Unlock,
  // buy and premium controls are never pressed: a prompt the account cannot copy is
  // not taken. promptOnly keeps controls that name a prompt ("Copy full prompt").
  const LOCKED = /unlock|buy|purchase|acheter|débloquer|upgrade|premium|subscribe|s'abonner/i;
  const NOT_PROMPT = /source code|code source|\blink\b|\blien\b|\burl\b/i;
  const label = (b) => `${getText(b)} ${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`.replace(/\s+/g, " ").trim();
  // An opened prompt shows in a dialog or a fixed panel above the page.
  const inOverlay = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.matches && n.matches("[role='dialog'], [aria-modal='true'], dialog[open]")) return true;
      if (getComputedStyle(n).position === "fixed") return true;
    }
    return false;
  };
  const copyControls = ({ promptOnly, overlayOnly }) =>
    [...document.querySelectorAll("button, [role='button']")]
      .filter((b) => (b.checkVisibility ? b.checkVisibility() : true))
      .filter((b) => /\b(copy|copier)\b/i.test(label(b)) && !LOCKED.test(label(b)) && !NOT_PROMPT.test(label(b)))
      .filter((b) => !promptOnly || /prompt/i.test(label(b)))
      .filter((b) => !overlayOnly || inOverlay(b));
  const pressCopyControls = async ({ promptOnly, overlayOnly = false, max }) => {
    const controls = copyControls({ promptOnly, overlayOnly }).slice(0, max);
    const pressed = [];
    if (controls.length === 0) return pressed;
    const clipboard = navigator.clipboard;
    const original = clipboard && typeof clipboard.writeText === "function" ? clipboard.writeText : null;
    const copied = [];
    if (original) {
      clipboard.writeText = function (text) {
        copied.push(String(text ?? ""));
        return original.call(this, text).catch(() => {});
      };
    }
    // document.execCommand("copy") paths: read the event after the page filled it.
    const onCopy = (e) => {
      const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || String(window.getSelection() || "");
      if (text) copied.push(text);
    };
    window.addEventListener("copy", onCopy);
    try {
      for (const control of controls) {
        const before = copied.length;
        control.click();
        // The text may be fetched first: wait up to 3 s for it.
        for (let i = 0; i < 30 && copied.length === before; i++) await new Promise((r) => setTimeout(r, 100));
        pressed.push({ label: label(control).slice(0, 60), texts: copied.slice(before) });
      }
    } finally {
      if (original) clipboard.writeText = original;
      window.removeEventListener("copy", onCopy);
    }
    return pressed;
  };

  const notes = new Set();
  // A refused copy usually opens the site's own message (sign-up, copy limit):
  // quote it to the user instead of guessing.
  const refusalMessage = () =>
    safe(
      () =>
        [...document.querySelectorAll("[role='dialog'], [aria-modal='true'], dialog[open], body *")]
          .filter((el) => (el.checkVisibility ? el.checkVisibility() : true) && inOverlay(el))
          .map((el) => getText(el).replace(/\s+/g, " ").trim())
          .find((text) => text.length > 0 && text.length < 400 && PAYWALL_TEXT.test(text)),
      ""
    );
  const keepCopied = (pressed, promptOnly) => {
    for (const press of pressed) for (const text of press.texts) addItem(text, `copie:${press.label}`, promptOnly ? "high" : null);
    if (pressed.some((press) => press.texts.length === 0)) {
      const message = refusalMessage();
      notes.add(
        message
          ? `Le site a refusé la copie : « ${message.slice(0, 160)} ». Connecte-toi sur le site avec un compte qui a accès à ce prompt, puis relance.`
          : "Un bouton de copie n'a rien donné : ce prompt demande peut-être un compte connecté ou un accès payant."
      );
    }
  };

  const autoScroll = () => {
    return new Promise((resolve) => {
      let prevHeight = document.body.scrollHeight;
      let sameCount = 0;

      const step = () => {
        window.scrollBy(0, window.innerHeight);
        setTimeout(() => {
          const h = document.body.scrollHeight;
          if (h === prevHeight) {
            sameCount++;
          } else {
            sameCount = 0;
            prevHeight = h;
          }

          if (sameCount >= MAX_SAME_HEIGHT || window.scrollY + window.innerHeight >= h) {
            window.scrollTo(0, 0);
            setTimeout(resolve, 300);
          } else {
            step();
          }
        }, SCROLL_DELAY);
      };

      step();
    });
  };

  const pickMode = () => {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;";

      let lastHighlight = null;

      const highlight = (el) => {
        if (lastHighlight) lastHighlight.style.outline = "";
        if (el && el !== overlay) {
          el.style.outline = "3px solid #ff6b00";
          lastHighlight = el;
        }
      };

      const cleanup = () => {
        if (lastHighlight) lastHighlight.style.outline = "";
        overlay.remove();
      };

      overlay.addEventListener("mousemove", (e) => {
        overlay.style.pointerEvents = "none";
        const target = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = "auto";
        highlight(target);
      });

      overlay.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        overlay.style.pointerEvents = "none";
        const target = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = "auto";
        cleanup();
        const text = getText(target);
        resolve({ mode: "pick", text: text.trim(), host: location.hostname });
      });

      const onKey = (e) => {
        if (e.key === "Escape") {
          cleanup();
          document.removeEventListener("keydown", onKey, true);
          resolve({ mode: "pick", text: "", host: location.hostname });
        }
      };
      document.addEventListener("keydown", onKey, true);

      document.body.appendChild(overlay);
    });
  };

  const collect = () => {
    walkShadowRoots(document);
    scanIframes();
    scanInlineData();

    items.sort((a, b) => {
      if (a.confidence === "high" && b.confidence !== "high") return -1;
      if (a.confidence !== "high" && b.confidence === "high") return 1;
      return b.chars - a.chars;
    });

    const cards = CATALOGUE_CARDS[HOST] ? safe(() => document.querySelectorAll(CATALOGUE_CARDS[HOST]).length, 0) : 0;
    const waiting = MODE === "collect" ? copyControls({ promptOnly: true, overlayOnly: false }).filter((b) => !inOverlay(b)).length : 0;
    if (gatedCount) {
      notes.add(`${gatedCount} bloc(s) réservé(s) (premium, flouté ou verrouillé) ignoré(s) : le site ne les donne pas à ce compte.`);
    }
    // Copy controls left alone are prompts not taken: always say so.
    if (waiting) {
      notes.add(`${waiting} boutons « Copy prompt » de la page n'ont pas été pressés : ouvre une fiche (clic sur une carte) puis « Extraire la page », ou « Scan profond » pour tous les presser. Chaque copie compte dans la limite du site.`);
    } else if (cards && !items.some((it) => it.confidence === "high")) {
      notes.add(`Page catalogue : ${cards} cartes, sans texte de prompt. Ouvre une fiche (clic sur une carte), puis « Extraire la page ».`);
    }

    return {
      mode: MODE,
      host: location.hostname,
      title: document.title,
      url: location.href,
      count: items.length,
      items,
      hint: [...notes].join(" ")
    };
  };

  if (MODE === "pick") {
    return pickMode();
  }

  if (MODE === "deep") {
    // Deep: scroll everything in, then press every copy control on the page.
    return autoScroll()
      .then(() => pressCopyControls({ promptOnly: false, max: 60 }))
      .then((pressed) => keepCopied(pressed, false))
      .then(() => collect());
  }

  // Extract: an opened prompt (motionsites.ai "?prompt=…") shows no text, only its
  // "Copy full prompt" control in the panel above the page: press that one only, so
  // the catalogue behind it does not spend the site's copy allowance.
  return pressCopyControls({ promptOnly: true, overlayOnly: true, max: 2 })
    .then((pressed) => keepCopied(pressed, true))
    .then(() => collect());
})();
