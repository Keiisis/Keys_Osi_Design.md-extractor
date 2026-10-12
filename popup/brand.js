/**
 * Keys_Osi Brand Kit panel (PROMPT PRO): logo → colors, shape personality,
 * palette with contrast guarantees, 3 font pairings resolved on the web
 * (files downloadable), clean SVG logo, ZIP, live try-on on the active tab.
 * Heavy work runs here (the popup has a canvas); the kit is stored by the
 * service worker so PROMPT_PRO can use it.
 */
import { buildBrandPalette, createBrandKit, resolveKitFonts } from "../lib/brand-kit.mjs";
import { bestVectorization } from "../lib/vectorize.mjs";
import { detectArchetypes } from "../lib/prompt-pro-playbook.mjs";

const $ = (id) => document.getElementById(id);
const ROLE_ORDER = ["brand.primary", "brand.secondary", "accent", "surface.base", "surface.muted", "text.primary", "text.secondary", "border.default", "focus.ring"];
const MAX_SIDE = 480;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error("Le service worker Keys_Osi ne répond pas.");
  if (!response.ok) throw new Error(response.error || "Requête échouée.");
  return response;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

async function rasterize(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const ratio = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth || MAX_SIDE, image.naturalHeight || MAX_SIDE));
  const width = Math.max(1, Math.round((image.naturalWidth || MAX_SIDE) * ratio));
  const height = Math.max(1, Math.round((image.naturalHeight || MAX_SIDE) * ratio));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height };
}

async function renderSvg(svg, width, height) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const loadedFamilies = new Set();
async function loadFontFiles(font, files = []) {
  if (!font || loadedFamilies.has(font.family)) return;
  loadedFamilies.add(font.family);
  for (const file of files.filter((entry) => (entry.style || "normal") === "normal").slice(0, 3)) {
    try {
      const face = new FontFace(font.family, `url(${file.url})`, { weight: String(file.weight) });
      document.fonts.add(await face.load());
    } catch (error) {
      // The specimen falls back to the system stack.
    }
  }
}

export function initBrandKit({ getDescription }) {
  const status = $("brandStatus");
  let state = null; // { kit, logoDataUrl, logoSvg }

  const setStatus = (text, isError = false) => {
    status.hidden = !text;
    status.textContent = text || "";
    status.classList.toggle("is-error", isError);
  };

  const save = () => send({ type: "BRAND_SAVE", kit: state.kit, logoDataUrl: state.logoDataUrl, logoSvg: state.logoSvg });

  const render = () => {
    $("brandResult").hidden = !state;
    if (!state) return;
    const { kit } = state;
    $("brandLogo").replaceChildren(el("img", { src: state.logoSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.logoSvg)}` : state.logoDataUrl, alt: `Logo ${kit.name}` }));
    $("brandMeta").textContent = `${kit.name} · ${Object.entries(kit.personality || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([trait]) => trait)
      .join(" · ")}`;

    // Logo colors: click one to make it the primary.
    $("brandLogoColors").replaceChildren(
      ...kit.colors.swatches.map((swatch, index) =>
        el("button", {
          type: "button",
          class: `brand-chip${kit.palette.roles["brand.primary"] === swatch.hex || (index === 0 && !kit.colors.swatches.some((s) => s.hex === kit.palette.roles["brand.primary"])) ? " is-active" : ""}`,
          title: `Utiliser ${swatch.hex} comme couleur principale`,
          style: `--chip:${swatch.hex}`,
          text: swatch.hex,
          onclick: async () => {
            const ordered = [swatch, ...kit.colors.swatches.filter((other) => other !== swatch)];
            kit.palette = buildBrandPalette(ordered, { personality: kit.personality });
            await save();
            render();
          }
        })
      )
    );

    $("brandSwatches").replaceChildren(
      ...ROLE_ORDER.filter((role) => kit.palette.roles[role]).map((role) =>
        el("button", { type: "button", class: "brand-swatch", title: `Copier ${kit.palette.roles[role]}`, onclick: () => navigator.clipboard.writeText(kit.palette.roles[role]).then(() => setStatus(`${role} ${kit.palette.roles[role]} copié.`)) }, [
          el("span", { class: "brand-swatch__color", style: `background:${kit.palette.roles[role]}` }),
          el("span", { class: "brand-swatch__role", text: role }),
          el("code", { text: kit.palette.roles[role] })
        ])
      )
    );
    const scale = kit.palette.scales.primary;
    $("brandScale").replaceChildren(...Object.entries(scale).map(([step, hex]) => el("span", { title: `primary-${step} ${hex}`, style: `background:${hex}` })));

    const pairings = [kit.fonts.chosen, ...kit.fonts.alternatives];
    $("brandFonts").replaceChildren(
      ...pairings.map((pairing, index) =>
        el("div", { class: `brand-font${index === 0 ? " is-active" : ""}` }, [
          el("p", { class: "brand-font__display", style: `font-family:"${pairing.display.family}",serif`, text: kit.name || "Aa Bb" }),
          el("p", { class: "brand-font__body", style: `font-family:"${pairing.body.family}",sans-serif`, text: "Une phrase de texte courant pour juger le rythme et la lisibilité." }),
          el("p", { class: "brand-font__names", text: `${pairing.display.family} / ${pairing.body.family}${pairing.mono ? ` / ${pairing.mono.family}` : ""}` }),
          el("p", { class: "brand-font__why", text: pairing.rationale || "" }),
          el("div", { class: "asset-actions" }, [
            index === 0
              ? el("button", { type: "button", text: "Polices (woff2)", onclick: () => downloadFonts() })
              : el("button", {
                  type: "button",
                  text: "Choisir",
                  onclick: async () => {
                    kit.fonts.alternatives = pairings.filter((other) => other !== pairing);
                    kit.fonts.chosen = pairing;
                    setStatus("Récupération des fichiers de police…");
                    state.kit = await resolveKitFonts(kit, { fetchImpl: fetch });
                    await save();
                    setStatus(`${pairing.display.family} / ${pairing.body.family} retenues.`);
                    render();
                  }
                })
          ])
        ])
      )
    );
    // Same family for both roles: its files are stored once, under "body".
    loadFontFiles(kit.fonts.chosen.display, kit.files.display?.length ? kit.files.display : kit.files.body);
    loadFontFiles(kit.fonts.chosen.body, kit.files.body);
  };

  const downloadFonts = async () => {
    const files = [...(state.kit.files.display || []), ...(state.kit.files.body || []), ...(state.kit.files.mono || [])];
    for (const file of files) {
      await chrome.downloads.download({ url: file.url, filename: `keys-osi-fonts/${file.fileName || `${file.id}-${file.weight}.woff2`}`, conflictAction: "uniquify", saveAs: false });
    }
    setStatus(`${files.length} fichiers de police téléchargés (dossier keys-osi-fonts).`);
  };

  const build = async (file) => {
    try {
      setStatus("Lecture du logo…");
      const logoDataUrl = await readFile(file);
      const { rgba, width, height } = await rasterize(logoDataUrl);
      let fontGuess = null;
      if ($("brandAiFont").checked) {
        setStatus("Identification de la police du logo par IA…");
        fontGuess = await send({ type: "BRAND_FONT_GUESS", dataUrl: logoDataUrl })
          .then((response) => response.fontGuess)
          .catch((error) => {
            setStatus(`IA indisponible (${error.message}) : analyse locale seule.`);
            return null;
          });
      }
      setStatus("Couleurs, forme et personnalité…");
      const archetypes = detectArchetypes(getDescription() || "", 2).map((archetype) => archetype.id);
      let kit = createBrandKit({ name: $("brandName").value.trim() || file.name.replace(/\.[^.]+$/, ""), rgba, width, height, archetypes, fontGuess });
      setStatus("Recherche des polices sur le catalogue en ligne…");
      kit = await resolveKitFonts(kit, { fetchImpl: fetch }).catch(() => kit);
      let logoSvg = null;
      if (/svg/.test(file.type)) {
        logoSvg = await file.text();
      } else {
        setStatus("Vectorisation du logo (SVG)…");
        const palette = kit.colors.swatches.map((swatch) => swatch.hex);
        const best = await bestVectorization(rgba, width, height, { palette, background: kit.colors.background || undefined }, renderSvg).catch(() => null);
        if (best && best.score.ssim >= 0.85) logoSvg = best.svg;
      }
      state = { kit, logoDataUrl, logoSvg };
      await save();
      render();
      setStatus(`Charte prête : ${kit.colors.swatches.length} couleur(s) du logo, palette complète contrôlée AA, ${kit.fonts.chosen.display.family} / ${kit.fonts.chosen.body.family}${logoSvg ? ", logo vectorisé" : ""}. Elle sera appliquée au PROMPT_PRO.`);
    } catch (error) {
      setStatus(error.message, true);
    }
  };

  $("brandFile").addEventListener("change", (event) => event.target.files[0] && build(event.target.files[0]));
  const drop = $("brandDrop");
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    const file = [...event.dataTransfer.files].find((candidate) => /^image\//.test(candidate.type));
    if (file) build(file);
  });
  $("brandZipBtn").addEventListener("click", async () => {
    try {
      const response = await send({ type: "BRAND_ZIP" });
      setStatus(`Brand kit téléchargé : ${response.filename} (${response.fileCount} fichiers).`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  let tryOn = false;
  $("brandTryBtn").addEventListener("click", async () => {
    try {
      const tabId = Number(new URLSearchParams(location.search).get("tab")) || (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id;
      const result = await send({ type: "BRAND_TRYON", tabId, enable: !tryOn });
      tryOn = !tryOn;
      $("brandTryBtn").textContent = tryOn ? "Retirer l'essai" : "Essayer sur ce site";
      setStatus(tryOn ? `Ta marque est appliquée à la page (${result.recolored} couleurs, ${result.fonted} textes).` : "Page restaurée.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  $("brandSvgBtn").addEventListener("click", () => {
    if (!state?.logoSvg) return setStatus("Pas de SVG fiable pour ce logo (score de vectorisation trop bas).", true);
    chrome.downloads.download({ url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.logoSvg)}`, filename: "logo.svg", saveAs: false, conflictAction: "uniquify" });
  });
  $("brandClearBtn").addEventListener("click", async () => {
    await send({ type: "BRAND_CLEAR" });
    state = null;
    render();
    setStatus("Brand Kit retiré : PROMPT_PRO reprend les couleurs et polices du site.");
  });

  send({ type: "BRAND_STATE" })
    .then(({ brand }) => {
      if (brand?.kit) {
        state = { kit: brand.kit, logoDataUrl: brand.logoDataUrl, logoSvg: brand.logoSvg };
        $("brandName").value = brand.kit.name || "";
        render();
      }
    })
    .catch(() => {});
}
