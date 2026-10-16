/**
 * Keys_Osi responsive probe (isolated world). Injected once per capture;
 * the service worker then calls snapshot() at each emulated width and
 * finish() at the end. Elements are tracked by reference between calls, so
 * the page's DOM is never modified. Reads layout only: no clicks, no scroll
 * except back to the top for the screenshots, restored by finish().
 */
(() => {
  const MAX_TRACKED = 4000;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "BR", "WBR", "SOURCE", "TRACK", "PARAM"]);

  const state = {
    elements: [],
    index: new Map(),
    widths: [],
    shown: [],
    area: [],
    scroll: [window.scrollX, window.scrollY]
  };
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    if (state.elements.length >= MAX_TRACKED) break;
    if (SKIP.has(el.tagName) || el.closest("svg") !== null && el.tagName.toLowerCase() !== "svg") continue;
    state.index.set(el, state.elements.length);
    state.elements.push(el);
  }

  // Layout viewport: innerWidth follows the visual viewport, which grows when
  // a phone zooms out on an overflowing page.
  const vw = () => document.documentElement.clientWidth;

  const onScreen = (el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null;
    const r = el.getBoundingClientRect();
    // Visually hidden helpers (skip links, sr-only) are 1px boxes.
    if (r.width < 2 || r.height < 2) return null;
    // Off-canvas drawers sit beside the viewport: not shown.
    if (r.right <= 0 || r.left >= vw()) return null;
    return r;
  };

  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && !/\d{3,}|[:_-]r\d/.test(el.id)) return `${tag}#${el.id}`;
    const classes = Array.from(el.classList)
      .filter((name) => name.length < 30 && !/^(css|sc|jsx|svelte|astro)-|__|[0-9a-f]{5,}/i.test(name))
      .slice(0, 2);
    return classes.length ? `${tag}.${classes.join(".")}` : tag;
  };

  // innerText is empty or glued for hidden elements: join text nodes instead.
  const textOf = (el, max = 50) => {
    let text = el.checkVisibility() ? el.innerText : "";
    if (!text) {
      const parts = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node && parts.join(" ").length < max * 2; node = walker.nextNode()) {
        if (!/^(SCRIPT|STYLE)$/.test(node.parentElement?.tagName || "")) parts.push(node.textContent);
      }
      text = parts.join(" ");
    }
    return text.replace(/\s+/g, " ").trim().slice(0, max);
  };

  // The header band: menu links and a menu button within the top 200px,
  // wherever the site nests them (header, nav, a sticky div).
  const BAND = 200;
  const inBand = (el) => {
    const r = onScreen(el);
    return r && r.top < BAND ? r : null;
  };

  function navigation() {
    const links = Array.from(document.querySelectorAll("a[href]")).filter((a) => a.closest("nav, [role=navigation], ul, ol, menu") && !a.closest("[aria-hidden=true], [inert]") && inBand(a));
    const toggles = 'button, [role=button], [aria-controls], [aria-expanded], [class*="hamburger" i], [class*="burger" i], [class*="menu-toggle" i], [class*="nav-toggle" i], [class*="navbar-toggler" i]';
    const toggle = Array.from(document.querySelectorAll(toggles)).find((el) => {
      if (!inBand(el)) return false;
      const hint = [el.getAttribute("aria-label"), el.getAttribute("aria-controls"), el.getAttribute("aria-haspopup"), el.getAttribute("data-bs-toggle"), el.getAttribute("data-toggle"), el.id, el.getAttribute("class"), el.getAttribute("title"), textOf(el, 20)].join(" ");
      // Theme, search and language switchers open menus too: not the navigation.
      if (/theme|search|recherche|langu|dark|light|sombre|clair/i.test(hint)) return false;
      return /menu|burger|hamburger|navigation|nav-toggle|toggle-nav|drawer|offcanvas/i.test(hint);
    });
    const count = new Set(links.map((a) => a.getAttribute("href"))).size;
    // Links side by side are an inline menu; a vertical list is an open menu.
    const rows = new Map();
    for (const a of links) {
      const top = Math.round(a.getBoundingClientRect().top / 8);
      rows.set(top, (rows.get(top) || 0) + 1);
    }
    const perRow = Math.max(0, ...rows.values());
    let mode = "none";
    if (perRow >= 3) mode = "inline";
    else if (toggle) mode = "toggle";
    else if (count >= 3) mode = "stacked";
    else if (count > 0) mode = "inline";
    return { mode, links: count, toggle: toggle ? describe(toggle) : null };
  }

  const significant = (el) => {
    const r = onScreen(el);
    // Narrow reading columns on wide screens still count (htmx: 640px at 1440).
    return r && r.height >= 40 && r.width >= Math.min(vw() * 0.5, 480) ? r : null;
  };

  function unwrap(el) {
    for (let depth = 0; depth < 8; depth++) {
      const kids = Array.from(el.children).filter(significant);
      if (kids.length !== 1) return el;
      el = kids[0];
    }
    return el;
  }

  function topBlocks() {
    const root = unwrap(document.body);
    const blocks = [];
    for (const child of Array.from(root.children).filter(significant)) {
      if (child.tagName === "MAIN" || child.getAttribute("role") === "main") {
        const inner = unwrap(child);
        const parts = Array.from(inner.children).filter(significant);
        blocks.push(...(parts.length ? parts : [child]));
      } else {
        blocks.push(child);
      }
    }
    return blocks.slice(0, 40);
  }

  // The container whose children form the widest row of real items.
  function columnsOf(block) {
    const blockRect = block.getBoundingClientRect();
    let best = null;
    const queue = [[block, 0]];
    let visited = 0;
    while (queue.length && visited < 500) {
      const [el, depth] = queue.shift();
      visited += 1;
      const rect = el.getBoundingClientRect();
      const kids = Array.from(el.children);
      const items = [];
      for (const kid of kids) {
        const r = onScreen(kid);
        // Real content blocks: buttons and icons in a row are not columns.
        if (r && r.width >= rect.width * 0.12 && r.height >= 56) items.push(r);
      }
      if (items.length >= 2 && rect.width >= blockRect.width * 0.5) {
        const top = Math.min(...items.map((r) => r.top));
        const row = items.filter((r) => Math.abs(r.top - top) < 8).sort((a, b) => a.left - b.left);
        let count = 0;
        let right = -Infinity;
        for (const r of row) {
          if (r.left >= right - 2) {
            count += 1;
            right = r.right;
          }
        }
        if (count >= 2 && (!best || count > best.columns || (count === best.columns && items.length > best.items))) {
          best = { columns: count, items: items.length, container: describe(el) };
        }
      }
      if (depth < 6) for (const kid of kids) queue.push([kid, depth + 1]);
    }
    return best || { columns: 1, items: 0, container: null };
  }

  // A centered container has equal side margins (auto); its width is the
  // content box, its gutter where the content starts.
  function container(blocks) {
    const counts = new Map();
    const centered = (el) => {
      const style = getComputedStyle(el);
      const marginLeft = parseFloat(style.marginLeft) || 0;
      const marginRight = parseFloat(style.marginRight) || 0;
      const r = el.getBoundingClientRect();
      if (!(r.width < vw() - 2 && marginLeft >= 4 && Math.abs(marginLeft - marginRight) <= 2)) return null;
      const padLeft = parseFloat(style.paddingLeft) || 0;
      return { width: Math.round(r.width - padLeft - (parseFloat(style.paddingRight) || 0)), gutter: Math.round(r.left + padLeft) };
    };
    // Each section votes for the first centered box around it (a wrapper
    // such as main or #app) or inside it (a .container).
    for (const block of blocks) {
      let hit = null;
      for (let el = block.parentElement; !hit && el && el !== document.documentElement; el = el.parentElement) hit = centered(el);
      for (let el = block, depth = 0; !hit && el && depth < 5; depth++) {
        hit = centered(el);
        const width = el.getBoundingClientRect().width;
        el = Array.from(el.children).find((kid) => onScreen(kid) && kid.getBoundingClientRect().width >= width * 0.6);
      }
      if (hit) {
        const key = `${hit.width}:${hit.gutter}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    // Most used width; ties go to the widest (the page container, not a column).
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(b[0].split(":")[0]) - Number(a[0].split(":")[0]))[0];
    if (top && top[1] >= Math.max(1, blocks.length * 0.3)) {
      const [width, gutter] = top[0].split(":").map(Number);
      return { width, gutter };
    }
    const lefts = Array.from(document.querySelectorAll("h1, h2, h3, p"))
      .map((el) => onScreen(el))
      .filter(Boolean)
      .map((r) => Math.round(r.left))
      .filter((left) => left >= 0);
    return { width: null, gutter: lefts.length ? Math.min(...lefts) : 0 };
  }

  function typeOf(selector, minText = 0) {
    const el = Array.from(document.querySelectorAll(selector)).find((node) => onScreen(node) && textOf(node, 200).length >= minText);
    if (!el) return null;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    return { fontSize: parseFloat(style.fontSize), lineHeight: Number.isFinite(lineHeight) ? lineHeight : null, fontWeight: Number(style.fontWeight) || 400 };
  }

  function overflow() {
    const extra = Math.round(document.documentElement.scrollWidth - vw());
    if (extra <= 1) return { px: 0, culprits: [] };
    const culprits = [];
    for (const el of state.elements) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw() + 1 || r.width < 1) continue;
      const parent = el.parentElement && el.parentElement.getBoundingClientRect();
      // The origin of the overflow: past the edge while its parent is not.
      if (parent && parent.right > vw() + 1) continue;
      let clipped = false;
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).overflowX !== "visible") {
          clipped = true;
          break;
        }
      }
      if (!clipped) culprits.push(`${describe(el)} (+${Math.round(r.right - vw())}px)`);
      if (culprits.length >= 5) break;
    }
    return { px: extra, culprits };
  }

  function snapshot() {
    window.scrollTo(0, 0);
    const column = state.widths.length;
    state.widths.push(vw());
    state.elements.forEach((el, i) => {
      const r = el.isConnected ? onScreen(el) : null;
      (state.shown[i] ||= [])[column] = Boolean(r);
      if (r) state.area[i] = Math.max(state.area[i] || 0, r.width * r.height);
    });
    const blocks = topBlocks();
    // The header is described by the navigation row, not as a section.
    const isHeader = (block) => block.matches("header, nav, [role=banner], [role=navigation]") || (block.getBoundingClientRect().top < 10 && block.getBoundingClientRect().height < BAND && block.querySelector("nav, [role=navigation]"));
    const sections = blocks.filter((block) => !isHeader(block)).map((block, order) => {
      const heading = block.querySelector("h1, h2, h3");
      const label = (heading && onScreen(heading) && textOf(heading)) || block.getAttribute("aria-label") || describe(block);
      const index = state.index.has(block) ? state.index.get(block) : `x${order}`;
      return { key: `e${index}`, order, label, columns: columnsOf(block).columns, height: Math.round(block.getBoundingClientRect().height) };
    });
    return {
      width: vw(),
      height: window.innerHeight,
      pageHeight: Math.round(document.documentElement.scrollHeight),
      nav: navigation(),
      container: container(blocks),
      type: { h1: typeOf("h1"), h2: typeOf("h2"), body: typeOf("p, li", 40) },
      sections,
      overflow: overflow()
    };
  }

  // Elements shown at some widths and not others, outermost only.
  function visibility() {
    const changed = new Set();
    state.elements.forEach((el, i) => {
      const flags = state.shown[i] || [];
      if (flags.length === state.widths.length && flags.some(Boolean) && !flags.every(Boolean) && (state.area[i] || 0) >= 600) changed.add(el);
    });
    const outer = [...changed].filter((el) => {
      for (let node = el.parentElement; node; node = node.parentElement) if (changed.has(node)) return false;
      return true;
    });
    return outer
      .sort((a, b) => (state.area[state.index.get(b)] || 0) - (state.area[state.index.get(a)] || 0))
      .slice(0, 25)
      .map((el) => {
        const flags = state.shown[state.index.get(el)];
        const text = textOf(el, 40);
        return { label: text ? `${describe(el)} « ${text} »` : describe(el), visibleAt: state.widths.filter((_, column) => flags[column]) };
      });
  }

  // Same-origin stylesheets; the service worker adds cross-origin ones through CDP.
  function mediaTexts() {
    const out = [];
    const walk = (rules, depth) => {
      if (!rules || depth > 6) return;
      for (const rule of rules) {
        if (rule.media && rule.conditionText !== undefined) out.push(rule.conditionText);
        else if (rule.media && rule.media.mediaText) out.push(rule.media.mediaText);
        if (rule.cssRules) walk(rule.cssRules, depth + 1);
        if (rule.styleSheet) {
          try {
            walk(rule.styleSheet.cssRules, depth + 1);
          } catch (error) {}
        }
      }
    };
    for (const sheet of document.styleSheets) {
      if (sheet.media && sheet.media.mediaText) out.push(sheet.media.mediaText);
      try {
        walk(sheet.cssRules, 0);
      } catch (error) {}
    }
    for (const node of document.querySelectorAll("source[media], link[media]")) out.push(node.getAttribute("media"));
    return out.filter(Boolean);
  }

  function finish() {
    window.scrollTo(state.scroll[0], state.scroll[1]);
    const result = { visibility: visibility(), mediaTexts: mediaTexts() };
    delete globalThis.__keysOsiLayout;
    return result;
  }

  globalThis.__keysOsiLayout = { snapshot, finish };
})();
