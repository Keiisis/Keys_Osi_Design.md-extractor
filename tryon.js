/**
 * Keys_Osi try-on: previews a brand (or a corrected palette) on the live
 * page. Chromatic colors are grouped by hue family and moved to the brand's
 * hues while keeping each color's lightness offset (hover/darker variants
 * stay darker); neutrals get the brand's tint; fonts are registered from
 * bytes (no network, no CSP issue) and applied to headings / body text.
 * Every change is inline and reverted exactly by revert().
 * Classic script (ISOLATED world); safe to inject twice.
 */
(() => {
  if (window.__keysOsiTryOn) return;

  // ---- color math (sRGB <-> OKLCH)
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toGamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  function rgbToOklch([r, g, b]) {
    const [lr, lg, lb] = [r / 255, g / 255, b / 255].map(toLinear);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
  }
  function oklchToRgb({ l, c, h }) {
    // Reduce chroma until the color fits sRGB (keeps hue and lightness).
    for (let chroma = c; chroma >= 0; chroma -= 0.005) {
      const a = chroma * Math.cos((h * Math.PI) / 180);
      const b = chroma * Math.sin((h * Math.PI) / 180);
      const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
      const rgb = [
        4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
        -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
        -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1
      ];
      if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) return rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, v))))) * 255));
    }
    const grey = Math.round(toGamma(Math.min(1, Math.max(0, l ** 3))) * 255);
    return [grey, grey, grey];
  }
  const hexToRgb = (hex) => {
    const value = hex.replace("#", "");
    const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const parseRgb = (text) => {
    const match = String(text).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
    if (!match) return null;
    const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
    return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha };
  };
  const css = (rgb, alpha) => (alpha >= 1 ? `rgb(${rgb.join(", ")})` : `rgba(${rgb.join(", ")}, ${alpha})`);
  const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  const PROPS = ["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "fill", "stroke", "text-decoration-color"];
  const ICON_FONT = /icon|awesome|material|glyph|symbol|fontello|ionicons|feather/i;
  let saved = [];
  let fontFaces = [];

  function remember(el, prop) {
    saved.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
  }

  function collect() {
    const elements = [...document.body.querySelectorAll("*")].filter((el) => !el.closest("keys-osi-lens")).slice(0, 8000);
    elements.unshift(document.body, document.documentElement);
    return elements;
  }

  /** Hue families of the page's chromatic colors, heaviest first. */
  function hueFamilies(elements) {
    const families = [];
    for (const el of elements) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const area = Math.min(rect.width * rect.height, 400000) / 1000 + 1;
      for (const prop of ["background-color", "color", "border-top-color", "fill"]) {
        const parsed = parseRgb(style.getPropertyValue(prop));
        if (!parsed || parsed.alpha < 0.1) continue;
        const lch = rgbToOklch(parsed.rgb);
        if (lch.c < 0.05) continue;
        const weight = prop === "background-color" ? area : 1;
        let family = families.find((entry) => hueGap(entry.h, lch.h) < 28);
        if (!family) {
          family = { h: lch.h, weight: 0, l: 0, c: 0, n: 0 };
          families.push(family);
        }
        family.weight += weight;
        family.l += lch.l * weight;
        family.c += lch.c * weight;
        family.n += weight;
      }
    }
    return families
      .map((family) => ({ h: family.h, weight: family.weight, l: family.l / family.n, c: family.c / family.n }))
      .sort((a, b) => b.weight - a.weight);
  }

  function makeMapper(options, families) {
    if (options.colorMap) {
      // Exact replacements (accessibility fixes): nearest source within a small distance.
      const pairs = options.colorMap.map(({ from, to }) => ({ from: hexToRgb(from), to: hexToRgb(to) }));
      return (rgb) => {
        const hit = pairs.find((pair) => Math.abs(pair.from[0] - rgb[0]) + Math.abs(pair.from[1] - rgb[1]) + Math.abs(pair.from[2] - rgb[2]) <= 6);
        return hit ? hit.to : null;
      };
    }
    const targets = [options.colors.primary, options.colors.secondary || options.colors.primary, options.colors.accent || options.colors.secondary || options.colors.primary].map((hex) => rgbToOklch(hexToRgb(hex)));
    const tint = targets[0];
    return (rgb) => {
      const lch = rgbToOklch(rgb);
      if (lch.c < 0.05) {
        // Neutrals keep their lightness and take a light brand tint.
        if (lch.l > 0.985 || lch.l < 0.03) return null;
        return oklchToRgb({ l: lch.l, c: Math.min(0.018, tint.c * 0.12), h: tint.h });
      }
      const index = families.findIndex((family) => hueGap(family.h, lch.h) < 28);
      const family = families[index] || { l: lch.l, c: lch.c };
      const target = targets[Math.min(Math.max(index, 0), 2)];
      return oklchToRgb({
        l: Math.min(0.98, Math.max(0.05, target.l + (lch.l - family.l))),
        c: Math.max(0, target.c * (family.c ? lch.c / family.c : 1)),
        h: target.h
      });
    };
  }

  function recolor(elements, mapper) {
    let changed = 0;
    for (const el of elements) {
      const style = getComputedStyle(el);
      for (const prop of PROPS) {
        const parsed = parseRgb(style.getPropertyValue(prop));
        if (!parsed || parsed.alpha === 0) continue;
        const mapped = mapper(parsed.rgb);
        if (!mapped) continue;
        remember(el, prop);
        el.style.setProperty(prop, css(mapped, parsed.alpha), "important");
        changed += 1;
      }
      const image = style.getPropertyValue("background-image");
      if (image && image.includes("gradient")) {
        const next = image.replace(/rgba?\([^)]*\)/g, (match) => {
          const parsed = parseRgb(match);
          const mapped = parsed && mapper(parsed.rgb);
          return mapped ? css(mapped, parsed.alpha) : match;
        });
        if (next !== image) {
          remember(el, "background-image");
          el.style.setProperty("background-image", next, "important");
          changed += 1;
        }
      }
    }
    return changed;
  }

  async function loadFonts(fonts) {
    const families = {};
    for (const role of ["display", "body"]) {
      const font = fonts?.[role];
      if (!font?.faces?.length) continue;
      const family = `Keys_Osi ${role} ${font.family}`;
      for (const face of font.faces) {
        try {
          const bytes = Uint8Array.from(atob(face.base64), (char) => char.charCodeAt(0));
          const fontFace = new FontFace(family, bytes, { weight: String(face.weight || 400), style: face.style || "normal" });
          await fontFace.load();
          document.fonts.add(fontFace);
          fontFaces.push(fontFace);
        } catch (error) {
          // A broken file only costs that weight; colors still apply.
        }
      }
      if (fontFaces.some((face) => face.family.replace(/"/g, "") === family)) families[role] = `"${family}", ${font.fallback || "sans-serif"}`;
    }
    return families;
  }

  function applyFonts(elements, families) {
    let changed = 0;
    for (const el of elements) {
      if (!el.childNodes.length || /^(CODE|PRE|KBD|SAMP|SCRIPT|STYLE|SVG|svg)$/.test(el.tagName)) continue;
      const style = getComputedStyle(el);
      if (ICON_FONT.test(style.fontFamily)) continue;
      const heading = /^H[1-6]$/.test(el.tagName) || parseFloat(style.fontSize) >= 28;
      const family = heading ? families.display || families.body : families.body || families.display;
      if (!family) continue;
      remember(el, "font-family");
      el.style.setProperty("font-family", family, "important");
      changed += 1;
    }
    return changed;
  }

  async function apply(options) {
    revert();
    const elements = collect();
    const families = options.colorMap ? [] : hueFamilies(elements);
    const recolored = options.colors || options.colorMap ? recolor(elements, makeMapper(options, families)) : 0;
    const fontFamilies = options.fonts ? await loadFonts(options.fonts) : {};
    const fonted = Object.keys(fontFamilies).length ? applyFonts(elements, fontFamilies) : 0;
    document.documentElement.dataset.keysOsiTryon = "on";
    return { recolored, fonted, families: families.slice(0, 3).map((family) => Math.round(family.h)) };
  }

  function revert() {
    for (const entry of saved.reverse()) {
      if (entry.value) entry.el.style.setProperty(entry.prop, entry.value, entry.priority);
      else entry.el.style.removeProperty(entry.prop);
    }
    saved = [];
    for (const face of fontFaces) document.fonts.delete(face);
    fontFaces = [];
    delete document.documentElement.dataset.keysOsiTryon;
    return { reverted: true };
  }

  window.__keysOsiTryOn = { apply, revert, active: () => saved.length > 0 };
})();
