/**
 * Keys_Osi Lens — on-page inspector, injected on demand from the popup.
 * Hover: element card (font, size, weight, colors, contrast, box).
 * Click: copy the element's CSS spec. E: eyedropper. P: pin colors/type. S: pin the section. Esc: quit.
 * Everything lives in a shadow root so page CSS cannot touch it.
 */
(() => {
  if (window.__keysOsiLens) {
    window.__keysOsiLens.toggle();
    return;
  }

  const host = document.createElement("keys-osi-lens");
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { --gold: oklch(82% 0.14 82); --ink: oklch(96% 0.01 85); --paper: oklch(17% 0.02 300 / 0.94); --rule: oklch(100% 0 0 / 0.12); }
      .box { position: fixed; border: 1.5px solid var(--gold); border-radius: 3px; box-shadow: 0 0 0 4000px oklch(10% 0.02 300 / 0.12); transition: all 90ms cubic-bezier(0.16, 1, 0.3, 1); pointer-events: none; }
      .card { position: fixed; min-width: 230px; max-width: 300px; padding: 12px 14px; border-radius: 14px; background: var(--paper); color: var(--ink);
        border: 1px solid var(--rule); box-shadow: 0 18px 40px -18px oklch(0% 0 0 / 0.7); font: 500 12px/1.45 ui-monospace, "Cascadia Code", monospace; pointer-events: none;
        backdrop-filter: blur(10px); }
      .card::before { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
        background: linear-gradient(135deg, oklch(82% 0.14 82), oklch(68% 0.2 20), oklch(62% 0.2 300));
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
      .tag { color: var(--gold); font-weight: 600; margin-bottom: 6px; overflow-wrap: anywhere; }
      .font { font: 400 17px/1.2 Georgia, serif; margin-bottom: 6px; overflow-wrap: anywhere; }
      .row { display: flex; justify-content: space-between; gap: 12px; }
      .row span:first-child { opacity: 0.6; }
      .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; border: 1px solid var(--rule); }
      .badge { padding: 0 6px; border-radius: 6px; font-weight: 700; }
      .pass { background: oklch(72% 0.17 150 / 0.25); color: oklch(85% 0.15 150); }
      .fail { background: oklch(65% 0.2 25 / 0.25); color: oklch(82% 0.13 25); }
      .bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; background: var(--paper); color: var(--ink);
        border: 1px solid var(--rule); font: 500 12px/1 ui-monospace, monospace; white-space: nowrap; box-shadow: 0 12px 30px -14px oklch(0% 0 0 / 0.7); }
      .bar b { color: var(--gold); }
      .toast { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; background: var(--gold); color: oklch(18% 0.02 70);
        font: 600 12px/1 ui-monospace, monospace; opacity: 0; transition: opacity 160ms ease-out; }
      .toast.show { opacity: 1; }
    </style>
    <div class="box" hidden></div>
    <div class="card" hidden></div>
    <div class="bar"><b>Keys_Osi Lens</b> · survol : inspecter · clic : copier le CSS · E : pipette · P : épingler · S : épingler la section · Échap : quitter</div>
    <div class="toast"></div>`;
  document.documentElement.appendChild(host);

  const box = root.querySelector(".box");
  const card = root.querySelector(".card");
  const toast = root.querySelector(".toast");
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  let active = true;
  let current = null;

  // Any CSS color (rgb, oklch, lab, color()) -> [r, g, b, a] via the canvas.
  const rgba = (value) => {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const effectiveBackground = (el) => {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const c = rgba(getComputedStyle(node).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let out = [255, 255, 255];
    for (const [r, g, b, a] of layers.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
    return out;
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 60);
  };
  const renderedFamily = (stack) => {
    for (const raw of stack.split(",")) {
      const family = raw.trim().replace(/^['"]|['"]$/g, "");
      if (/^(serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-[a-z-]+)$/i.test(family)) return family;
      try {
        if (document.fonts.check(`16px "${family}"`)) return family;
      } catch (e) {}
    }
    return stack.split(",")[0].trim();
  };

  function inspect(el) {
    const s = getComputedStyle(el);
    const fg = rgba(s.color);
    const bg = effectiveBackground(el);
    const fgHex = hex(fg[3] < 1 ? [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])] : fg);
    const ratio = (Math.max(lum(rgba(fgHex)), lum(bg)) + 0.05) / (Math.min(lum(rgba(fgHex)), lum(bg)) + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
    const needed = large ? 3 : 4.5;
    const rect = el.getBoundingClientRect();
    return {
      selector: describe(el),
      family: renderedFamily(s.fontFamily),
      stack: s.fontFamily,
      size: s.fontSize,
      lineHeight: s.lineHeight,
      weight: s.fontWeight,
      tracking: s.letterSpacing,
      color: fgHex,
      background: hex(bg),
      contrast: Math.round(ratio * 100) / 100,
      level: ratio >= (large ? 4.5 : 7) ? "AAA" : ratio >= needed ? "AA" : "échec",
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      radius: s.borderRadius,
      padding: s.padding,
      rect
    };
  }

  function show(info) {
    const { rect } = info;
    box.hidden = false;
    Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    card.hidden = false;
    card.innerHTML = "";
    const add = (cls, html) => {
      const div = document.createElement("div");
      div.className = cls;
      div.innerHTML = html;
      card.appendChild(div);
    };
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    add("tag", esc(info.selector));
    add("font", `${esc(info.family)}`);
    add("row", `<span>taille / interligne</span><span>${esc(info.size)} / ${esc(info.lineHeight)}</span>`);
    add("row", `<span>graisse · tracking</span><span>${esc(info.weight)} · ${esc(info.tracking)}</span>`);
    add("row", `<span>texte</span><span><i class="sw" style="background:${info.color}"></i>${info.color}</span>`);
    add("row", `<span>fond</span><span><i class="sw" style="background:${info.background}"></i>${info.background}</span>`);
    add("row", `<span>contraste</span><span>${info.contrast}:1 <b class="badge ${info.level === "échec" ? "fail" : "pass"}">${info.level}</b></span>`);
    add("row", `<span>boîte</span><span>${info.width}×${info.height} · r ${esc(info.radius)}</span>`);
    const cardW = 300;
    const left = Math.min(window.innerWidth - cardW - 12, Math.max(12, rect.left));
    const below = rect.bottom + 12 + 190 < window.innerHeight;
    card.style.left = `${left}px`;
    card.style.top = `${below ? rect.bottom + 10 : Math.max(12, rect.top - 200)}px`;
    host.dataset.selector = info.selector;
    host.dataset.font = `${info.family}|${info.size}|${info.weight}`;
    host.dataset.contrast = `${info.contrast}|${info.level}`;
  }

  function flash(text) {
    toast.textContent = text;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1400);
  }

  async function copy(text, label) {
    host.dataset.copied = text;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    flash(`${label} copié`);
  }

  const cssSpec = (info) =>
    [
      `/* ${info.selector} — Keys_Osi Lens */`,
      `font-family: ${info.stack};`,
      `font-size: ${info.size};`,
      `line-height: ${info.lineHeight};`,
      `font-weight: ${info.weight};`,
      `letter-spacing: ${info.tracking};`,
      `color: ${info.color};`,
      `background: ${info.background};`,
      `border-radius: ${info.radius};`,
      `padding: ${info.padding};`
    ].join("\n");

  const onMove = (event) => {
    if (!active) return;
    const el = event.composedPath().find((n) => n instanceof Element && n !== host);
    if (!el || el === current) return;
    current = el;
    show(inspect(el));
  };
  const onClick = (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    const el = event.composedPath().find((n) => n instanceof Element && n !== host) || current;
    if (el) copy(cssSpec(inspect(el)), "CSS");
  };
  const onKey = async (event) => {
    if (!active) return;
    if (event.key === "Escape") {
      api.toggle(false);
    } else if (event.key.toLowerCase() === "p" && current) {
      // P: pin the hovered element's colors and type to the moodboard.
      event.preventDefault();
      const info = inspect(current);
      const sourceUrl = location.href;
      const pins = [
        { kind: "color", hex: info.color, role: "texte", sourceUrl },
        { kind: "font", family: info.family, weight: info.weight, size: info.size, sample: (current.textContent || "").trim().slice(0, 60), sourceUrl }
      ];
      if (info.background !== "#ffffff" || info.color !== "#000000") pins.push({ kind: "color", hex: info.background, role: "fond", sourceUrl });
      const reply = await chrome.runtime.sendMessage({ type: "BOARD_PIN", pins }).catch(() => null);
      flash(reply?.ok ? `${reply.added} épingle(s) ajoutée(s)` : "Épinglage impossible");
    } else if (event.key.toLowerCase() === "s" && current) {
      // S: pin the whole section around the hovered element as a capture.
      event.preventDefault();
      const section = current.closest("section, header, footer, article, main > div, [class*='section' i]") || current;
      section.scrollIntoView({ block: "nearest" });
      const rect = section.getBoundingClientRect();
      const heading = (section.querySelector("h1, h2, h3")?.textContent || "").trim().slice(0, 120);
      host.style.visibility = "hidden";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const reply = await chrome.runtime
        .sendMessage({ type: "BOARD_PIN_SECTION", rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, dpr: devicePixelRatio, heading, tag: section.tagName.toLowerCase(), sourceUrl: location.href })
        .catch(() => null);
      host.style.visibility = "";
      flash(reply?.ok ? "Section épinglée" : "Capture impossible");
    } else if (event.key.toLowerCase() === "e" && "EyeDropper" in window) {
      event.preventDefault();
      try {
        const { sRGBHex } = await new window.EyeDropper().open();
        copy(sRGBHex, `Couleur ${sRGBHex}`);
      } catch (e) {}
    }
  };
  const swallow = (event) => {
    if (active) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousedown", swallow, true);
  document.addEventListener("mouseup", swallow, true);
  document.addEventListener("keydown", onKey, true);

  const api = {
    toggle(force) {
      active = typeof force === "boolean" ? force : !active;
      host.style.display = active ? "" : "none";
      if (!active) current = null;
    },
    inspect
  };
  window.__keysOsiLens = api;
})();
