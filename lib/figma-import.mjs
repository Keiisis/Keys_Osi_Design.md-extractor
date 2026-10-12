/**
 * Figma import: vacuums a whole Figma design file through the REST API and
 * turns it into the exact payload shape the content script produces, so the
 * existing normalize -> DESIGN.md / SKILL.md / JSON pipeline runs unchanged.
 * It also builds an ordered screen/section structure (FIGMA_STRUCTURE.md)
 * that tells an agent what to rebuild, in which order, with the real copy.
 *
 * Pure functions, no DOM: runs in the MV3 service worker and in Node.
 * Every network call goes through an injected `fetchImpl`.
 */

import { contrastRatio, rgbToHex, visibleHex } from "./color-science.mjs";

const API_BASE = "https://api.figma.com";
const URL_KINDS = new Set(["file", "design", "proto", "board"]);
const DEFAULT_MAX_WAIT_MS = 90000;
const MAX_ATTEMPTS = 5;
const IMAGE_FORMATS = new Set(["png", "jpg", "svg", "pdf"]);

// Shapes drawn as glyphs: their fills are icon ink, not surfaces.
const VECTOR_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "REGULAR_POLYGON"]);
const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "INSTANCE", "COMPONENT", "COMPONENT_SET", "SECTION"]);

const BUTTON_NAME = /button|btn|\bcta\b|bouton/i;
const NOT_BUTTON_NAME = /badge|\btag\b|chip|avatar|input|field|champ|toggle|switch|checkbox|radio|\btab\b/i;
const INPUT_NAME = /input|text ?field|textarea|search ?bar|\bselect\b|dropdown|champ/i;
const STATE_KEY = /^(state|status|interaction|etat|état)$/i;
const STATE_PATTERNS = [
  ["disabled", /disabled|inactive|désactivé/i],
  ["hover", /hover|survol/i],
  ["focus-visible", /focus/i],
  ["active", /press|active|click/i]
];
const PURCHASE_LABEL = /^(add to (cart|bag|basket)|buy( it)? now|shop now|checkout|view cart|cart|basket|panier|ajouter au panier|acheter)(\s|$)/i;
const AUTH_LABEL = /sign in|log in|login|register|dashboard|workspace|connexion|s'inscrire/i;

/* ------------------------------------------------------------------ *
 * URL parsing
 * ------------------------------------------------------------------ */

/**
 * @returns {{ fileKey: string, nodeId: string|null, kind: string } | null}
 */
export function parseFigmaUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch (e) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "figma.com" && !host.endsWith(".figma.com")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = (parts[0] || "").toLowerCase();
  const isKey = (value) => /^[A-Za-z0-9]+$/.test(value || "");
  if (!URL_KINDS.has(kind) || !isKey(parts[1])) return null;
  // Branch URLs (/design/<main>/branch/<branch>/...) must query the branch key.
  const fileKey = parts[2] === "branch" && isKey(parts[3]) ? parts[3] : parts[1];
  // URLs write node ids as "1-23"; the API expects "1:23".
  const rawNode = url.searchParams.get("node-id");
  const nodeId = rawNode ? rawNode.trim().replace(/-/g, ":") : null;
  return { fileKey, nodeId: nodeId || null, kind };
}

/* ------------------------------------------------------------------ *
 * HTTP layer
 * ------------------------------------------------------------------ */

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (e) {
    return null;
  }
}

function headerOf(response, name) {
  try {
    return response.headers && typeof response.headers.get === "function" ? response.headers.get(name) : null;
  } catch (e) {
    return null;
  }
}

function retryDelayMs(response, attempt) {
  const seconds = Number.parseFloat(headerOf(response, "retry-after"));
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  return Math.min(30000, 2000 * 2 ** (attempt - 1));
}

function httpError(response, body) {
  const status = response.status;
  const detail = body && (body.err || body.message) ? ` Détail : ${body.err || body.message}` : "";
  if (status === 400) {
    return apiError(status, `Requête refusée par Figma (400) : paramètres invalides ou portée trop volumineuse.${detail}`);
  }
  if (status === 403) {
    return apiError(
      status,
      `Accès refusé par Figma (403) : jeton personnel invalide ou expiré, portée « file_content:read » absente, ou ce compte n'a pas accès au fichier.${detail}`
    );
  }
  if (status === 404) {
    return apiError(status, `Fichier ou nœud Figma introuvable (404) : vérifiez l'URL et que le fichier existe toujours.${detail}`);
  }
  if (status === 429) {
    const retryAfter = headerOf(response, "retry-after");
    const lowSeat = headerOf(response, "x-figma-rate-limit-type") === "low";
    return apiError(
      status,
      `Limite de requêtes Figma atteinte (429).${retryAfter ? ` Réessayez dans ${retryAfter} s.` : " Réessayez dans une minute."}${
        lowSeat ? " Les sièges Lecteur/Collaborateur ont une limite d'API plus basse." : ""
      }`
    );
  }
  if (status >= 500) {
    return apiError(status, `Erreur serveur Figma (${status}) : réessayez plus tard ou importez un cadre précis (lien avec node-id).${detail}`);
  }
  return apiError(status, `Erreur de l'API Figma (${status}).${detail}`);
}

// One GET with 429 handling: Retry-After is honored until the total wait
// budget is spent, then the 429 surfaces as a readable error.
async function figmaRequest(path, { token, fetchImpl, sleepImpl = defaultSleep, maxWaitMs = DEFAULT_MAX_WAIT_MS }) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("Aucune fonction fetch disponible pour appeler l'API Figma.");
  }
  let waited = 0;
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await doFetch(`${API_BASE}${path}`, { headers: { "X-Figma-Token": token } });
    } catch (error) {
      throw apiError(0, `Connexion à l'API Figma impossible : ${error && error.message ? error.message : error}`);
    }
    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      const delay = retryDelayMs(response, attempt);
      if (waited + delay <= maxWaitMs) {
        waited += delay;
        await sleepImpl(delay);
        continue;
      }
    }
    const body = await readJson(response);
    if (response.ok) return body || {};
    throw httpError(response, body);
  }
}

function requireToken(token) {
  if (!token) {
    throw new Error(
      "Jeton d'accès personnel Figma manquant : créez-en un dans Figma (Paramètres > Sécurité > Jetons d'accès personnels) avec la portée « file_content:read »."
    );
  }
}

/**
 * @returns {Promise<{ file: object, imageFills: Record<string,string>, variables: object|null }>}
 */
export async function fetchFigmaFile({ fileKey, token, nodeId = null, fetchImpl, onProgress, sleepImpl, maxWaitMs } = {}) {
  if (!fileKey) throw new Error("Clé de fichier Figma manquante : collez l'URL complète du fichier.");
  requireToken(token);
  const options = { token, fetchImpl, sleepImpl, maxWaitMs };
  const key = encodeURIComponent(fileKey);
  const progress = (step, message) => {
    if (typeof onProgress === "function") onProgress({ step, message });
  };

  let file;
  if (nodeId) {
    progress("file", `Téléchargement du nœud ${nodeId}…`);
    const body = await figmaRequest(`/v1/files/${key}/nodes?ids=${encodeURIComponent(nodeId)}`, options);
    file = fileFromNodesResponse(body, nodeId);
  } else {
    progress("file", "Téléchargement du fichier Figma…");
    file = await figmaRequest(`/v1/files/${key}`, options);
  }
  if (!file || !file.document) {
    throw new Error("Réponse Figma inattendue : le document est absent.");
  }

  // Image fills are a second endpoint: only called when the tree has any.
  let imageFills = {};
  if (collectImageRefs(file.document).length > 0) {
    progress("images", "Récupération des URL des images…");
    try {
      const body = await figmaRequest(`/v1/files/${key}/images`, options);
      imageFills = (body.meta && body.meta.images) || body.images || {};
    } catch (error) {
      progress("images", `Images indisponibles : ${error.message}`);
    }
  }

  progress("variables", "Lecture des variables…");
  let variables = null;
  try {
    const body = await figmaRequest(`/v1/files/${key}/variables/local`, options);
    variables = body.meta && body.meta.variables ? body.meta : null;
  } catch (error) {
    // Enterprise-only endpoint: other plans answer 403. Styles still give tokens.
    progress("variables", "Variables non disponibles (réservées aux offres Enterprise) : styles utilisés à la place.");
  }

  progress("done", "Fichier Figma importé.");
  return { file, imageFills, variables };
}

// The nodes endpoint returns a subtree; wrap it as a regular file so every
// function below works on one shape.
function fileFromNodesResponse(body, nodeId) {
  const nodes = (body && body.nodes) || {};
  const entry = nodes[nodeId] || Object.values(nodes).find((value) => value && value.document);
  if (!entry || !entry.document) {
    throw apiError(404, `Nœud ${nodeId} introuvable dans ce fichier Figma (404) : vérifiez le paramètre node-id de l'URL.`);
  }
  const node = entry.document;
  const page = node.type === "CANVAS" ? node : { id: `${node.id}::page`, name: node.name, type: "CANVAS", children: [node] };
  return {
    name: body.name || node.name,
    lastModified: body.lastModified || "",
    thumbnailUrl: body.thumbnailUrl || "",
    version: body.version || "",
    editorType: body.editorType || "",
    document: { id: "0:0", name: "Document", type: "DOCUMENT", children: [page] },
    components: entry.components || {},
    componentSets: entry.componentSets || {},
    styles: entry.styles || {},
    scopedNodeId: nodeId
  };
}

/**
 * Renders nodes to images. Batches ids, splits a batch that times out
 * server-side (5xx), and drops ids whose rendering failed (null URL).
 * @returns {Promise<Record<string,string>>}
 */
export async function fetchFigmaImages({ fileKey, token, ids = [], format = "png", scale = 2, fetchImpl, sleepImpl, maxWaitMs, batchSize = 50 } = {}) {
  if (!fileKey) throw new Error("Clé de fichier Figma manquante.");
  requireToken(token);
  const options = { token, fetchImpl, sleepImpl, maxWaitMs };
  const fmt = IMAGE_FORMATS.has(format) ? format : "png";
  const sc = Math.min(4, Math.max(0.01, Number(scale) || 1));
  const unique = Array.from(new Set((ids || []).filter(Boolean)));
  const urls = {};

  const renderBatch = async (batch) => {
    const params = new URLSearchParams({ ids: batch.join(","), format: fmt, scale: String(sc) });
    let body;
    try {
      body = await figmaRequest(`/v1/images/${encodeURIComponent(fileKey)}?${params}`, options);
    } catch (error) {
      if (error.status >= 500 && batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        await renderBatch(batch.slice(0, half));
        await renderBatch(batch.slice(half));
        return;
      }
      throw error;
    }
    const images = (body && body.images) || {};
    if (body && body.err && Object.keys(images).length === 0) {
      throw new Error(`Rendu d'images Figma impossible : ${body.err}`);
    }
    for (const [id, url] of Object.entries(images)) {
      if (url) urls[id] = url;
    }
  };

  for (let i = 0; i < unique.length; i += batchSize) {
    await renderBatch(unique.slice(i, i + batchSize));
  }
  return urls;
}

/* ------------------------------------------------------------------ *
 * Value helpers
 * ------------------------------------------------------------------ */

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round = (value, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round(num(value) * factor) / factor;
};
const px = (value) => `${round(value)}px`;
const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const isVisible = (node) => Boolean(node) && node.visible !== false;

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function boxOf(node) {
  const box = node && node.absoluteBoundingBox;
  return box ? { x: num(box.x), y: num(box.y), width: num(box.width), height: num(box.height) } : { x: 0, y: 0, width: 0, height: 0 };
}

function cssColorOf(color, opacity = 1) {
  if (!color) return "";
  const r = Math.round(num(color.r) * 255);
  const g = Math.round(num(color.g) * 255);
  const b = Math.round(num(color.b) * 255);
  const a = round((color.a ?? 1) * (opacity ?? 1), 3);
  return a >= 1 ? rgbToHex({ r, g, b }) : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function visiblePaints(paints) {
  return Array.isArray(paints) ? paints.filter((paint) => paint && paint.visible !== false && (paint.opacity ?? 1) > 0) : [];
}

// The last visible paint is the one drawn on top.
function topPaint(paints) {
  const list = visiblePaints(paints);
  return list[list.length - 1] || null;
}

function topSolid(paints) {
  const list = visiblePaints(paints).filter((paint) => paint.type === "SOLID");
  return list[list.length - 1] || null;
}

// Handles are normalized to the node box: angles are computed in pixel space
// so a horizontal-ish gradient on a wide banner keeps its real direction.
function gradientCss(paint, box = { width: 1, height: 1 }) {
  const opacity = paint.opacity ?? 1;
  const stops = (paint.gradientStops || [])
    .map((stop) => `${cssColorOf(stop.color, opacity)} ${Math.round(num(stop.position) * 100)}%`)
    .join(", ");
  const [start, end] = paint.gradientHandlePositions || [];
  const w = box.width || 1;
  const h = box.height || 1;
  const angleOf = () =>
    start && end ? Math.round(((Math.atan2((end.y - start.y) * h, (end.x - start.x) * w) * 180) / Math.PI + 90 + 360) % 360) : 180;
  const at = start ? `${Math.round(num(start.x) * 100)}% ${Math.round(num(start.y) * 100)}%` : "50% 50%";
  if (paint.type === "GRADIENT_LINEAR") return `linear-gradient(${angleOf()}deg, ${stops})`;
  if (paint.type === "GRADIENT_ANGULAR") return `conic-gradient(from ${start && end ? angleOf() : 0}deg at ${at}, ${stops})`;
  return `radial-gradient(${paint.type === "GRADIENT_DIAMOND" ? "ellipse" : "circle"} at ${at}, ${stops})`;
}

function paintCss(paint, box) {
  if (!paint) return "";
  if (paint.type === "SOLID") return cssColorOf(paint.color, paint.opacity ?? 1);
  if (String(paint.type).startsWith("GRADIENT_")) return gradientCss(paint, box);
  return "";
}

function backgroundOf(node) {
  const paint = topPaint(node.fills);
  if (!paint) return { kind: "none", css: "" };
  if (paint.type === "IMAGE") return { kind: "image", css: "", imageRef: paint.imageRef || "" };
  if (paint.type === "SOLID") return { kind: "color", css: paintCss(paint) };
  if (String(paint.type).startsWith("GRADIENT_")) return { kind: "gradient", css: gradientCss(paint, boxOf(node)) };
  return { kind: "other", css: "" };
}

function strokeOf(node) {
  const paint = topSolid(node.strokes);
  const individual = node.individualStrokeWeights || {};
  const weight = num(node.strokeWeight) || Math.max(num(individual.top), num(individual.right), num(individual.bottom), num(individual.left));
  if (!paint || weight <= 0) return null;
  return { width: round(weight), color: paintCss(paint) };
}

function radiusValues(node) {
  if (Array.isArray(node.rectangleCornerRadii) && node.rectangleCornerRadii.length === 4) {
    return node.rectangleCornerRadii.map(num);
  }
  const r = num(node.cornerRadius);
  return [r, r, r, r];
}

function radiusCss(node) {
  const values = radiusValues(node);
  return values.every((value) => value === values[0]) ? px(values[0]) : values.map(px).join(" ");
}

function shadowCss(node) {
  const parts = [];
  for (const effect of node.effects || []) {
    if (!effect || effect.visible === false) continue;
    if (effect.type !== "DROP_SHADOW" && effect.type !== "INNER_SHADOW") continue;
    const offset = effect.offset || {};
    parts.push(
      `${effect.type === "INNER_SHADOW" ? "inset " : ""}${px(offset.x)} ${px(offset.y)} ${px(effect.radius)} ${px(effect.spread)} ${cssColorOf(effect.color)}`
    );
  }
  return parts.join(", ");
}

// A Figma blur radius renders about twice as strong as CSS blur().
function blurCss(node) {
  const out = [];
  for (const effect of node.effects || []) {
    if (!effect || effect.visible === false || num(effect.radius) <= 0) continue;
    if (effect.type === "LAYER_BLUR") out.push(`filter: blur(${px(effect.radius / 2)})`);
    if (effect.type === "BACKGROUND_BLUR") out.push(`backdrop-filter: blur(${px(effect.radius / 2)})`);
  }
  return out.join("; ");
}

function paddingOf(node) {
  return [num(node.paddingTop), num(node.paddingRight), num(node.paddingBottom), num(node.paddingLeft)];
}

const ALIGN = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between", BASELINE: "baseline" };

function layoutOf(node) {
  const mode = node && node.layoutMode;
  if (mode !== "HORIZONTAL" && mode !== "VERTICAL" && mode !== "GRID") return null;
  const layout = {
    direction: mode === "HORIZONTAL" ? "row" : mode === "VERTICAL" ? "column" : "grid",
    gap: num(node.itemSpacing),
    padding: paddingOf(node),
    justify: ALIGN[node.primaryAxisAlignItems || "MIN"] || "flex-start",
    align: ALIGN[node.counterAxisAlignItems || "MIN"] || "flex-start",
    wrap: node.layoutWrap === "WRAP",
    counterGap: num(node.counterAxisSpacing)
  };
  if (mode === "GRID") {
    layout.columns = num(node.gridColumnCount);
    layout.rowGap = num(node.gridRowGap);
    layout.columnGap = num(node.gridColumnGap);
  }
  // Container sizing: AUTO on an axis = hug contents.
  layout.mainSizing = node.primaryAxisSizingMode === "AUTO" ? "hug" : "fixed";
  layout.crossSizing = node.counterAxisSizingMode === "AUTO" ? "hug" : "fixed";
  return layout;
}

// How a node sits inside its parent: sizing (fixed/hug/fill), constraints
// for free-positioned children, absolute escape from auto-layout, min/max.
function placementOf(node) {
  const parts = [];
  const h = node.layoutSizingHorizontal;
  const v = node.layoutSizingVertical;
  if (h || v) parts.push(`width ${String(h || "FIXED").toLowerCase()}, height ${String(v || "FIXED").toLowerCase()}`);
  else if (node.layoutGrow === 1 || node.layoutAlign === "STRETCH") parts.push(`${node.layoutGrow === 1 ? "grow 1" : ""}${node.layoutGrow === 1 && node.layoutAlign === "STRETCH" ? ", " : ""}${node.layoutAlign === "STRETCH" ? "stretch" : ""}`);
  if (node.layoutPositioning === "ABSOLUTE") parts.push("absolute inside auto-layout");
  if (num(node.minWidth) > 0) parts.push(`min-width ${px(node.minWidth)}`);
  if (num(node.maxWidth) > 0) parts.push(`max-width ${px(node.maxWidth)}`);
  const c = node.constraints;
  if (c && (c.horizontal || c.vertical) && !(c.horizontal === "LEFT" && c.vertical === "TOP")) {
    parts.push(`constraints ${String(c.horizontal || "LEFT").toLowerCase()}/${String(c.vertical || "TOP").toLowerCase()}`);
  }
  return parts.join("; ");
}

function surfaceOf(node) {
  const parts = [];
  const background = backgroundOf(node);
  if (background.css) parts.push(`background ${background.css}`);
  if (background.kind === "image") parts.push(`image fill \`${background.imageRef}\``);
  const stroke = strokeOf(node);
  if (stroke) parts.push(`border ${px(stroke.width)} solid ${stroke.color}`);
  if (Math.max(...radiusValues(node)) > 0) parts.push(`radius ${radiusCss(node)}`);
  const shadow = shadowCss(node);
  if (shadow) parts.push(`box-shadow ${shadow}`);
  const blur = blurCss(node);
  if (blur) parts.push(blur);
  if (num(node.opacity ?? 1) < 1) parts.push(`opacity ${round(node.opacity, 2)}`);
  return parts.join("; ");
}

function gridsOf(node) {
  return (node.layoutGrids || [])
    .filter((grid) => grid && grid.visible !== false)
    .map((grid) => {
      const pattern = String(grid.pattern || "GRID").toLowerCase();
      if (pattern === "grid") return `square grid ${px(grid.sectionSize)}`;
      const count = num(grid.count) > 0 && num(grid.count) < 1000 ? `${grid.count} ` : "";
      return `${count}${pattern} (${String(grid.alignment || "").toLowerCase()}, gutter ${px(grid.gutterSize)}, offset ${px(grid.offset)}${grid.alignment !== "STRETCH" && num(grid.sectionSize) ? `, size ${px(grid.sectionSize)}` : ""})`;
    })
    .join(" + ");
}

// Every container frame below a section, with its auto-layout: depth- and
// count-limited so huge files stay readable.
function layoutTree(node, ctx, depth = 0, budget = { left: 40 }) {
  const out = [];
  for (const child of orderedChildren(node)) {
    if (budget.left <= 0 || depth > 4) break;
    if (!CONTAINER_TYPES.has(child.type)) continue;
    budget.left -= 1;
    const box = boxOf(child);
    const label = child.type === "INSTANCE" ? componentLabel(ctx, child) : null;
    const isComponent = Boolean(label);
    out.push({
      name: child.name,
      type: child.type,
      component: label ? (label.variant ? `${label.base} (${label.variant})` : label.base) : "",
      width: round(box.width, 0),
      height: round(box.height, 0),
      layout: describeLayout(layoutOf(child)),
      surface: surfaceOf(child),
      placement: placementOf(child),
      grids: gridsOf(child),
      // Component internals are documented once in the catalog.
      children: isComponent ? [] : layoutTree(child, ctx, depth + 1, budget)
    });
  }
  return out;
}

function layoutLabel(layout) {
  if (!layout) return "absolute (free positioning)";
  if (layout.direction === "grid") return "grid";
  return `flex ${layout.direction}${layout.wrap ? " wrap" : ""}`;
}

function describeLayout(layout) {
  if (!layout) return "absolute positioning (no auto-layout): place children by their x/y offsets";
  const parts = [layoutLabel(layout)];
  if (layout.direction === "grid") {
    if (layout.columns) parts.push(`${layout.columns} columns`);
    parts.push(`row gap ${px(layout.rowGap)}`, `column gap ${px(layout.columnGap)}`);
  } else if (layout.justify === "space-between") {
    parts.push("gap auto (space-between)");
  } else {
    parts.push(`gap ${px(layout.gap)}`);
  }
  if (layout.wrap) parts.push(`row gap ${px(layout.counterGap)}`);
  parts.push(`padding ${layout.padding.map(px).join(" ")}`);
  parts.push(`justify-content ${layout.justify}`, `align-items ${layout.align}`);
  if (layout.direction !== "grid") parts.push(`main axis ${layout.mainSizing}, cross axis ${layout.crossSizing}`);
  return parts.join("; ");
}

function textCaseCss(textCase) {
  return { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" }[textCase] || "";
}

// Computed-style form ("24px" / "normal"), the unit the normalizer expects.
function lineHeightCss(style) {
  if (style.lineHeightUnit === "INTRINSIC_%" || !num(style.lineHeightPx)) return "normal";
  return px(style.lineHeightPx);
}

function typeSummary(style = {}) {
  const parts = [`${style.fontFamily || "?"} ${px(style.fontSize)}/${lineHeightCss(style)} ${style.fontWeight ?? 400}`];
  if (num(style.letterSpacing)) parts.push(`letter-spacing ${px(style.letterSpacing)}`);
  if (style.italic) parts.push("italic");
  const transform = textCaseCss(style.textCase);
  if (transform) parts.push(transform);
  if (style.textDecoration && style.textDecoration !== "NONE") parts.push(style.textDecoration.toLowerCase());
  return parts.join(", ");
}

function textColorOf(node) {
  return paintCss(topSolid(node.fills));
}

/* ------------------------------------------------------------------ *
 * File index and detection heuristics
 * ------------------------------------------------------------------ */

function indexFile(file) {
  const nodes = new Map();
  const parents = new Map();
  const instanceCounts = new Map();
  const visit = (node, parent) => {
    if (!isVisible(node)) return;
    nodes.set(node.id, node);
    if (parent) parents.set(node.id, parent);
    if (node.type === "INSTANCE" && node.componentId) {
      instanceCounts.set(node.componentId, (instanceCounts.get(node.componentId) || 0) + 1);
    }
    for (const child of node.children || []) visit(child, node);
  };
  visit(file.document, null);
  return {
    file,
    nodes,
    parents,
    instanceCounts,
    components: file.components || {},
    componentSets: file.componentSets || {},
    styles: file.styles || {}
  };
}

function walk(node, visit, depth = 0) {
  if (!isVisible(node)) return;
  if (visit(node, depth) === false) return;
  for (const child of node.children || []) walk(child, visit, depth + 1);
}

function collectTexts(node, maxDepth = 6) {
  const out = [];
  walk(node, (current, depth) => {
    if (depth > maxDepth) return false;
    if (current.type === "TEXT" && clean(current.characters)) out.push(current);
    return true;
  });
  return out;
}

function collectImageRefs(root) {
  const refs = [];
  const seen = new Set();
  walk(root, (node) => {
    for (const paint of visiblePaints(node.fills)) {
      if (paint.type === "IMAGE" && paint.imageRef && !seen.has(paint.imageRef)) {
        seen.add(paint.imageRef);
        refs.push({ imageRef: paint.imageRef, name: node.name || "", nodeId: node.id });
      }
    }
  });
  return refs;
}

function hasImage(node) {
  let found = false;
  walk(node, (current) => {
    if (found) return false;
    if (visiblePaints(current.fills).some((paint) => paint.type === "IMAGE")) found = true;
    return !found;
  });
  return found;
}

function parseVariantName(name) {
  const props = {};
  for (const part of String(name || "").split(",")) {
    const index = part.indexOf("=");
    if (index > 0) props[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return props;
}

function stateOf(props) {
  for (const value of Object.values(props || {})) {
    for (const [state, pattern] of STATE_PATTERNS) {
      if (pattern.test(String(value))) return state;
    }
  }
  return "default";
}

function variantIdentity(props) {
  return Object.entries(props || {})
    .filter(([key, value]) => !STATE_KEY.test(key) && stateOf({ [key]: value }) === "default")
    .map(([, value]) => value)
    .join(" ");
}

function parentSet(ctx, node) {
  const parent = ctx.parents.get(node.id);
  return parent && parent.type === "COMPONENT_SET" ? parent : null;
}

// Display name of what an instance/component is: set name + variant name.
function componentLabel(ctx, node) {
  if (node.type === "COMPONENT") {
    const set = parentSet(ctx, node);
    return set ? { base: set.name, variant: node.name } : { base: node.name, variant: "" };
  }
  if (node.type !== "INSTANCE") return { base: node.name || "", variant: "" };
  const meta = ctx.components[node.componentId];
  const main = ctx.nodes.get(node.componentId);
  const setMeta = meta && meta.componentSetId ? ctx.componentSets[meta.componentSetId] : null;
  const setNode = main ? parentSet(ctx, main) : null;
  const variantName = (meta && meta.name) || (main && main.name) || "";
  if (setMeta || setNode) return { base: (setMeta && setMeta.name) || setNode.name, variant: variantName };
  return { base: variantName || node.name || "", variant: "" };
}

function variantPropsOf(ctx, node) {
  if (node.type === "COMPONENT") return parentSet(ctx, node) ? parseVariantName(node.name) : {};
  if (node.type !== "INSTANCE") return {};
  const props = {};
  for (const [key, prop] of Object.entries(node.componentProperties || {})) {
    if (prop && prop.type === "VARIANT") props[key.replace(/#[^#]*$/, "")] = String(prop.value);
  }
  if (Object.keys(props).length > 0) return props;
  const label = componentLabel(ctx, node);
  return label.variant ? parseVariantName(label.variant) : {};
}

function isButtonLike(node, ctx) {
  if (!["INSTANCE", "COMPONENT", "FRAME"].includes(node.type)) return false;
  const box = boxOf(node);
  if (box.height > 96 || box.width > 480 || box.height <= 0) return false;
  const label = componentLabel(ctx, node).base;
  const names = `${node.name} ${label}`;
  if (NOT_BUTTON_NAME.test(names)) return false;
  const texts = collectTexts(node, 4);
  const named = BUTTON_NAME.test(names);
  if (named) return texts.length >= 1 && texts.length <= 2;
  // Unnamed buttons: one short label on a painted, rounded, compact box.
  if (texts.length !== 1) return false;
  const painter = paintedNode(node);
  const painted = ["color", "gradient"].includes(backgroundOf(painter).kind) || Boolean(strokeOf(painter));
  const text = clean(texts[0].characters);
  return (
    painted &&
    Math.max(...radiusValues(painter)) > 0 &&
    box.height >= 24 &&
    box.height <= 72 &&
    text.length > 0 &&
    text.length <= 32 &&
    !hasImage(node)
  );
}

function isInputLike(node, ctx) {
  if (!["INSTANCE", "COMPONENT", "FRAME"].includes(node.type)) return false;
  const names = `${node.name} ${componentLabel(ctx, node).base}`;
  if (!INPUT_NAME.test(names) || BUTTON_NAME.test(node.name)) return false;
  const box = boxOf(node);
  return box.height >= 24 && box.height <= 240 && box.width >= 80;
}

// Instances often wrap the painted box one level down: use the first
// descendant that actually paints a fill or stroke over most of the area.
function paintedNode(node) {
  const paints = (current) => ["color", "gradient"].includes(backgroundOf(current).kind) || Boolean(strokeOf(current));
  if (paints(node)) return node;
  const box = boxOf(node);
  for (const child of node.children || []) {
    if (!isVisible(child) || child.type === "TEXT" || VECTOR_TYPES.has(child.type)) continue;
    const childBox = boxOf(child);
    if (paints(child) && childBox.width >= box.width * 0.9 && childBox.height >= box.height * 0.9) return child;
  }
  return node;
}

function layoutNode(node) {
  if (layoutOf(node)) return node;
  return (node.children || []).find((child) => isVisible(child) && layoutOf(child)) || node;
}

// Same declaration format as the content script's computed button specs.
function visualSpec(node) {
  const painter = paintedNode(node);
  const text = collectTexts(node, 4)[0];
  const style = (text && text.style) || {};
  const background = backgroundOf(painter);
  const stroke = strokeOf(painter);
  return {
    background: background.css || "rgba(0, 0, 0, 0)",
    color: text ? textColorOf(text) : "",
    border: stroke ? `${px(stroke.width)} solid ${stroke.color}` : "none",
    borderRadius: radiusCss(painter),
    padding: paddingOf(layoutNode(node)).map(px).join(" "),
    fontSize: text ? px(style.fontSize) : "",
    fontWeight: text ? String(style.fontWeight ?? 400) : "",
    boxShadow: shadowCss(painter),
    textTransform: textCaseCss(style.textCase)
  };
}

function specSummary(spec) {
  const parts = [spec.background === "rgba(0, 0, 0, 0)" ? "no fill" : `background ${spec.background}`];
  if (spec.color) parts.push(`text ${spec.color}${spec.fontSize ? ` ${spec.fontSize}/${spec.fontWeight}` : ""}`);
  if (spec.border !== "none") parts.push(`border ${spec.border}`);
  if (spec.borderRadius !== "0px") parts.push(`radius ${spec.borderRadius}`);
  if (spec.padding && spec.padding !== "0px 0px 0px 0px") parts.push(`padding ${spec.padding}`);
  if (spec.boxShadow) parts.push(`shadow ${spec.boxShadow}`);
  if (spec.textTransform) parts.push(spec.textTransform);
  return parts.join("; ");
}

function orderedChildren(node) {
  const children = (node.children || []).filter(isVisible);
  const horizontal = node.layoutMode === "HORIZONTAL";
  return children
    .map((child, index) => ({ child, index, box: boxOf(child) }))
    .sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y || a.box.x - b.box.x) || a.index - b.index)
    .map((entry) => entry.child);
}

function easingCss(easing) {
  if (!easing) return "";
  const bezier = easing.easingFunctionCubicBezier;
  if (bezier) return `cubic-bezier(${round(bezier.x1, 3)}, ${round(bezier.y1, 3)}, ${round(bezier.x2, 3)}, ${round(bezier.y2, 3)})`;
  return { EASE_IN: "ease-in", EASE_OUT: "ease-out", EASE_IN_AND_OUT: "ease-in-out", LINEAR: "linear" }[easing.type] || "";
}

function easingLabel(easing) {
  if (!easing) return "";
  const css = easingCss(easing);
  if (css) return css;
  const spring = easing.easingFunctionSpring;
  if (spring) return `spring (mass ${spring.mass}, stiffness ${spring.stiffness}, damping ${spring.damping})`;
  return String(easing.type || "").toLowerCase().replace(/_/g, " ");
}

// REST documents transition durations in milliseconds; a value below 10
// can only be seconds (the plugin API unit), so it is converted.
function durationMs(value) {
  const n = num(value);
  return n > 0 && n < 10 ? round(n * 1000, 1) : round(n, 1);
}

function interactionsOf(node, ctx) {
  const out = [];
  for (const interaction of node.interactions || []) {
    const trigger = (interaction && interaction.trigger && interaction.trigger.type) || "ON_CLICK";
    for (const action of (interaction && interaction.actions) || []) {
      if (!action || action.type !== "NODE") continue;
      const destination = action.destinationId ? ctx.nodes.get(action.destinationId) : null;
      const transition = action.transition || null;
      out.push({
        trigger,
        navigation: action.navigation || "NAVIGATE",
        destination: destination ? destination.name : action.destinationId || "",
        transition: transition ? String(transition.type || "") : "",
        duration: transition ? durationMs(transition.duration) : 0,
        easing: transition ? easingCss(transition.easing) : "",
        easingLabel: transition ? easingLabel(transition.easing) : ""
      });
    }
  }
  // Legacy prototype fields, still present on older files.
  if (node.transitionNodeID && out.length === 0) {
    const destination = ctx.nodes.get(node.transitionNodeID);
    out.push({
      trigger: "ON_CLICK",
      navigation: "NAVIGATE",
      destination: destination ? destination.name : node.transitionNodeID,
      transition: "",
      duration: durationMs(node.transitionDuration),
      easing: easingCss(node.transitionEasing ? { type: node.transitionEasing } : null),
      easingLabel: easingLabel(node.transitionEasing ? { type: node.transitionEasing } : null)
    });
  }
  return out;
}

function interactionText(item) {
  const transition = item.transition
    ? ` (${item.transition.toLowerCase().replace(/_/g, " ")}${item.duration ? `, ${item.duration}ms` : ""}${item.easingLabel ? `, ${item.easingLabel}` : ""})`
    : "";
  return `${item.trigger} → ${item.navigation.toLowerCase().replace(/_/g, " ")} \`${item.destination}\`${transition}`;
}

/* ------------------------------------------------------------------ *
 * Typography hierarchy
 * ------------------------------------------------------------------ */

const HEADING_STYLE_NAME = /(?:^|[\s/_.-])h([1-6])(?:$|[\s/_.-])|heading\s*([1-6])|titre\s*([1-6])/i;

function inferTypography(ctx) {
  const samples = [];
  for (const node of ctx.nodes.values()) {
    if (node.type !== "TEXT" || !clean(node.characters)) continue;
    const style = node.style || {};
    const styleId = node.styles && node.styles.text;
    samples.push({
      size: round(style.fontSize),
      chars: clean(node.characters).length,
      style,
      color: textColorOf(node),
      styleName: styleId && ctx.styles[styleId] ? ctx.styles[styleId].name : ""
    });
  }
  const charsBySize = new Map();
  for (const sample of samples) charsBySize.set(sample.size, (charsBySize.get(sample.size) || 0) + sample.chars);
  const bodySize = Array.from(charsBySize.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 16;

  const pickSpec = (list) => {
    const counts = new Map();
    for (const sample of list) {
      const key = JSON.stringify({
        family: sample.style.fontFamily || "",
        weight: String(sample.style.fontWeight ?? 400),
        lineHeight: lineHeightCss(sample.style),
        letterSpacing: num(sample.style.letterSpacing) ? px(sample.style.letterSpacing) : "normal",
        transform: textCaseCss(sample.style.textCase) || "none",
        color: sample.color,
        size: sample.size
      });
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return JSON.parse(Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0]);
  };
  const toHeading = (level, spec, source) => ({
    level: `h${level}`,
    fontSize: px(spec.size),
    lineHeight: spec.lineHeight,
    fontWeight: spec.weight,
    letterSpacing: spec.letterSpacing,
    textTransform: spec.transform,
    color: spec.color,
    marginTop: "",
    marginBottom: "",
    fontFamily: spec.family,
    source
  });

  // Named text styles ("Heading/H1") are the designer's intent: they win.
  const named = new Map();
  for (const sample of samples) {
    const match = sample.styleName.match(HEADING_STYLE_NAME);
    const level = match ? Number(match[1] || match[2] || match[3]) : 0;
    if (level) named.set(level, [...(named.get(level) || []), sample]);
  }
  let headings;
  if (named.size > 0) {
    headings = Array.from(named.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([level, list]) => toHeading(level, pickSpec(list), "text style"));
  } else {
    const sizes = Array.from(charsBySize.keys())
      .filter((size) => size >= bodySize * 1.15)
      .sort((a, b) => b - a)
      .slice(0, 6);
    headings = sizes.map((size, index) => toHeading(index + 1, pickSpec(samples.filter((s) => s.size === size)), "size ranking"));
  }
  const levelBySize = new Map();
  for (const heading of headings) {
    const size = Number.parseFloat(heading.fontSize);
    if (!levelBySize.has(size)) levelBySize.set(size, heading.level);
  }
  const headingSizes = headings.map((heading) => Number.parseFloat(heading.fontSize));
  return {
    bodySize,
    headings,
    headingMin: headingSizes.length > 0 ? Math.min(...headingSizes) : Infinity,
    levelBySize
  };
}

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

function listScreens(ctx) {
  const scoped = Boolean(ctx.file.scopedNodeId);
  const allowed = scoped ? new Set(["FRAME", "COMPONENT", "INSTANCE", "GROUP", "COMPONENT_SET"]) : new Set(["FRAME"]);
  const out = [];
  for (const page of ctx.file.document?.children || []) {
    if (!isVisible(page)) continue;
    const found = [];
    const add = (node, group) => {
      if (!isVisible(node)) return;
      if (node.type === "SECTION") {
        for (const child of node.children || []) add(child, node.name);
        return;
      }
      if (!allowed.has(node.type)) return;
      const box = boxOf(node);
      if (!scoped && (box.width < 200 || box.height < 150)) return;
      found.push({ node, group, page });
    };
    for (const child of page.children || []) add(child, "");
    // Canvas reading order: rows top to bottom, left to right within a row.
    found.sort((a, b) => {
      const A = boxOf(a.node);
      const B = boxOf(b.node);
      return Math.abs(A.y - B.y) < 200 ? A.x - B.x : A.y - B.y;
    });
    out.push(...found);
  }
  return out;
}

// Screens often wrap all sections in one full-size frame: descend through it.
function contentRoot(node) {
  let current = node;
  for (let depth = 0; depth < 3; depth += 1) {
    const children = (current.children || []).filter(isVisible);
    if (children.length !== 1 || !CONTAINER_TYPES.has(children[0].type)) break;
    if (boxOf(children[0]).height < boxOf(current).height * 0.8) break;
    current = children[0];
  }
  return current;
}

function isSectionCandidate(node) {
  if (CONTAINER_TYPES.has(node.type) || node.type === "TEXT") return true;
  return visiblePaints(node.fills).some((paint) => paint.type === "IMAGE");
}

function scanSubtree(root, ctx, typography) {
  const out = { texts: [], ctas: [], images: [], vectors: 0, instances: new Map(), inputs: [], links: 0, interactions: [] };
  const visit = (node, insideButton) => {
    if (!isVisible(node)) return;
    for (const item of interactionsOf(node, ctx)) {
      if (out.interactions.length < 12) out.interactions.push({ source: node.name, ...item });
    }
    let button = insideButton;
    if (!insideButton && isButtonLike(node, ctx)) {
      const label = collectTexts(node, 4).map((text) => clean(text.characters)).join(" ");
      if (label && !out.ctas.includes(label)) out.ctas.push(truncate(label, 60));
      button = true;
    }
    if (node.type === "INSTANCE") {
      const { base, variant } = componentLabel(ctx, node);
      const key = variant ? `${base} (${variant})` : base;
      out.instances.set(key, (out.instances.get(key) || 0) + 1);
    }
    if (!button && isInputLike(node, ctx)) {
      const placeholder = collectTexts(node, 5).map((text) => clean(text.characters));
      out.inputs.push({ name: node.name, kind: inputKind(`${node.name} ${placeholder.join(" ")}`), texts: placeholder.slice(0, 3) });
      return;
    }
    const background = backgroundOf(node);
    if (background.kind === "image") {
      const box = boxOf(node);
      out.images.push({ id: node.id, name: node.name, width: round(box.width, 0), height: round(box.height, 0), imageRef: background.imageRef });
    }
    if (VECTOR_TYPES.has(node.type)) {
      out.vectors += 1;
      return;
    }
    if (node.type === "TEXT") {
      const characters = clean(node.characters);
      if (!characters) return;
      const style = node.style || {};
      const size = round(style.fontSize);
      if (style.hyperlink || style.textDecoration === "UNDERLINE") out.links += 1;
      if (out.texts.length < 60) {
        out.texts.push({
          text: truncate(characters, 280),
          kind: button ? "button" : headingLevel(size, typography) ? "heading" : "body",
          level: button ? "" : headingLevel(size, typography),
          size,
          font: typeSummary(style),
          color: textColorOf(node),
          styleName: node.styles && node.styles.text && ctx.styles[node.styles.text] ? ctx.styles[node.styles.text].name : ""
        });
      }
      return;
    }
    for (const child of orderedChildren(node)) visit(child, button);
  };
  visit(root, false);
  return out;
}

// Named heading styles may cover one breakpoint only (a 36px mobile title
// next to a 64px desktop H1): large unstyled text takes the nearest level.
function headingLevel(size, typography) {
  if (typography.levelBySize.has(size)) return typography.levelBySize.get(size);
  if (size < typography.headingMin && size < typography.bodySize * 1.75) return "";
  let best = "";
  let distance = Infinity;
  for (const [headingSize, level] of typography.levelBySize) {
    if (Math.abs(headingSize - size) < distance) {
      distance = Math.abs(headingSize - size);
      best = level;
    }
  }
  return best || "h2";
}

function inputKind(text) {
  const t = text.toLowerCase();
  if (/mail/.test(t)) return "email";
  if (/password|mot de passe/.test(t)) return "password";
  if (/phone|tel|téléphone/.test(t)) return "tel";
  if (/search|recherche/.test(t)) return "search";
  if (/message|textarea|comment/.test(t)) return "textarea";
  if (/select|dropdown/.test(t)) return "select";
  return "text";
}

function sectionRole(section, index, total) {
  const name = section.name.toLowerCase();
  const text = section.texts.map((item) => item.text).join(" ").toLowerCase();
  if (/header|nav|menu|top ?bar|en-tête/.test(name)) return "header/navigation";
  if (/footer|pied/.test(name)) return "footer";
  if (/hero/.test(name)) return "hero";
  if (/pricing|price|tarif|plans?\b/.test(name) || /[$€£]\s*\d|\/mo\b|\/month|per month|par mois|billed/.test(text)) return "pricing";
  if (/testimonial|review|avis|témoign/.test(name) || /testimonial|what (our )?(customers|clients) say|avis clients|témoignage|[“”]/.test(text)) return "testimonials";
  if (/faq|frequently asked|questions fréquentes/.test(`${name} ${text}`)) return "faq";
  if (section.inputs.length > 0 || /contact|newsletter|subscribe|form/.test(name)) return "contact/form";
  if (/feature|benefit|avantage|gallery|galerie/.test(name)) return "features/gallery";
  if (index <= 1 && section.texts.some((item) => item.level === "h1")) return "hero";
  // Three or more look-alike blocks (same component or same size) = a
  // features/cards grid, whatever the frame is called.
  if (repeatedBlocks(section) >= 3) return "features/gallery";
  if (/\bcta\b|call to action/.test(name) || (section.ctas.length > 0 && text.length < 400 && index > 0)) return "cta";
  if (/get started|sign up|try (it )?free|start now|request (a )?demo|contact sales|commencer|essai gratuit/.test(text) && text.length < 400) return "cta";
  if (index === 0 && section.height <= 140) return "header/navigation";
  if (index === total - 1 && total > 2 && /©|copyright|privacy|confidentialité/.test(text)) return "footer";
  return "content";
}

function repeatedBlocks(section) {
  const counts = new Map();
  const visit = (blocks) => {
    for (const block of blocks) {
      visit(block.children || []);
      // Card-sized only: repeated buttons or icons are not a features grid.
      if (block.width < 120 || block.height < 80) continue;
      const key = block.component || `${block.type}:${Math.round(block.width / 8)}x${Math.round(block.height / 8)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  };
  visit(section.layoutTree || []);
  return Math.max(0, ...counts.values());
}

function describeSection(node, index, total, screenBox, ctx, typography) {
  const box = boxOf(node);
  const scan = scanSubtree(node, ctx, typography);
  const own = layoutOf(node);
  const inner = own ? null : layoutOf(layoutNode(node));
  const layout = own || inner;
  const background = backgroundOf(node);
  const section = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: round(box.x - screenBox.x, 0),
    y: round(box.y - screenBox.y, 0),
    width: round(box.width, 0),
    height: round(box.height, 0),
    layout,
    layoutLabel: `${layoutLabel(layout)}${inner ? " (nested)" : ""}`,
    columns: layout ? (layout.direction === "row" ? Math.min(12, (layoutNode(node).children || []).filter(isVisible).length) : layout.columns || 0) : 0,
    background: background.css || (background.kind === "image" ? "image" : "transparent"),
    radius: Math.max(...radiusValues(node)) > 0 ? radiusCss(node) : "",
    shadow: node.type === "TEXT" ? "" : shadowCss(node),
    blur: blurCss(node),
    paddingY: `${px(num(node.paddingTop))}/${px(num(node.paddingBottom))}`,
    texts: scan.texts,
    ctas: scan.ctas.slice(0, 6),
    images: scan.images.slice(0, 12),
    vectorCount: scan.vectors,
    instances: Array.from(scan.instances.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    inputs: scan.inputs,
    links: scan.links,
    interactions: scan.interactions,
    placement: placementOf(node),
    grids: gridsOf(node),
    layoutTree: node.type === "INSTANCE" ? [] : layoutTree(node, ctx)
  };
  section.role = sectionRole(section, index, total);
  section.tag = section.role === "header/navigation" ? "header" : section.role === "footer" ? "footer" : "section";
  return section;
}

function describeScreen(entry, ctx, typography) {
  const { node, group, page } = entry;
  const box = boxOf(node);
  const root = contentRoot(node);
  const children = orderedChildren(root);
  const candidates = children.filter(isSectionCandidate);
  const sections = candidates.map((child, index) => describeSection(child, index, candidates.length, box, ctx, typography));
  // Every screen gets one top level: on a mobile frame the largest title is
  // its h1 even when it is smaller than the desktop H1 style.
  const headingTexts = sections.flatMap((section) => section.texts.filter((item) => item.kind === "heading"));
  if (headingTexts.length > 0 && !headingTexts.some((item) => item.level === "h1")) {
    const largest = Math.max(...headingTexts.map((item) => item.size));
    for (const item of headingTexts) if (item.size === largest) item.level = "h1";
  }
  const instances = new Map();
  for (const section of sections) {
    for (const item of section.instances) instances.set(item.name, (instances.get(item.name) || 0) + item.count);
  }
  const background = backgroundOf(node);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    page: page.name,
    group,
    width: round(box.width, 0),
    height: round(box.height, 0),
    background: background.css || (background.kind === "image" ? "image" : "transparent"),
    layout: layoutOf(root),
    grids: gridsOf(node),
    decorations: children.length - candidates.length,
    sections,
    componentsUsed: Array.from(instances.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    interactions: [...interactionsOf(node, ctx).map((item) => ({ source: node.name, ...item })), ...sections.flatMap((section) => section.interactions)].slice(0, 20)
  };
}

function buildComponentCatalog(ctx) {
  const componentSets = [];
  const components = [];
  for (const node of ctx.nodes.values()) {
    if (node.type === "COMPONENT_SET") {
      const properties = Object.entries(node.componentPropertyDefinitions || {}).map(([name, def]) => ({
        name: name.replace(/#[^#]*$/, ""),
        type: (def && def.type) || "",
        options: (def && def.variantOptions) || [],
        default: def && def.defaultValue !== undefined ? def.defaultValue : ""
      }));
      const variants = (node.children || [])
        .filter((child) => isVisible(child) && child.type === "COMPONENT")
        .map((child) => {
          const box = boxOf(child);
          return {
            id: child.id,
            name: child.name,
            props: parseVariantName(child.name),
            width: round(box.width, 0),
            height: round(box.height, 0),
            usage: ctx.instanceCounts.get(child.id) || 0,
            spec: specSummary(visualSpec(child)),
            interactions: interactionsOf(child, ctx).map(interactionText)
          };
        });
      componentSets.push({
        id: node.id,
        name: node.name,
        description: (ctx.componentSets[node.id] && ctx.componentSets[node.id].description) || "",
        properties,
        variants,
        usage: variants.reduce((sum, variant) => sum + variant.usage, 0)
      });
    } else if (node.type === "COMPONENT" && !parentSet(ctx, node)) {
      const box = boxOf(node);
      components.push({
        id: node.id,
        name: node.name,
        description: (ctx.components[node.id] && ctx.components[node.id].description) || "",
        width: round(box.width, 0),
        height: round(box.height, 0),
        usage: ctx.instanceCounts.get(node.id) || 0,
        spec: specSummary(visualSpec(node)),
        remote: false
      });
    }
  }
  // Library components exist only as instances: list them by usage.
  const remote = new Map();
  for (const [componentId, count] of ctx.instanceCounts) {
    if (ctx.nodes.has(componentId)) continue;
    const meta = ctx.components[componentId];
    const set = meta && meta.componentSetId ? ctx.componentSets[meta.componentSetId] : null;
    const name = set ? set.name : (meta && meta.name) || componentId;
    remote.set(name, (remote.get(name) || 0) + count);
  }
  for (const [name, usage] of remote) {
    components.push({ id: "", name, description: "", width: 0, height: 0, usage, spec: "", remote: true });
  }
  return { componentSets, components };
}

function styleValue(type, use) {
  if (!use) return "";
  const { node, key } = use;
  if (type === "FILL") {
    const paint = /stroke/i.test(key) ? topPaint(node.strokes) : topPaint(node.fills);
    if (paint && paint.type === "IMAGE") return "image";
    return paintCss(paint, boxOf(node));
  }
  if (type === "TEXT") return typeSummary(node.style || {});
  if (type === "EFFECT") return shadowCss(node) || blurCss(node);
  if (type === "GRID") return gridsOf(node) || "layout grid";
  return "";
}

function buildStyleCatalog(ctx) {
  const firstUse = new Map();
  const usage = new Map();
  for (const node of ctx.nodes.values()) {
    for (const [key, styleId] of Object.entries(node.styles || {})) {
      if (!firstUse.has(styleId)) firstUse.set(styleId, { node, key });
      usage.set(styleId, (usage.get(styleId) || 0) + 1);
    }
  }
  return Object.entries(ctx.styles).map(([id, meta]) => ({
    id,
    name: (meta && meta.name) || id,
    type: (meta && meta.styleType) || "",
    description: (meta && meta.description) || "",
    value: styleValue(meta && meta.styleType, firstUse.get(id)),
    usage: usage.get(id) || 0
  }));
}

// Variables per collection with every mode's value (aliases kept visible
// as references, so the agent can rebuild the semantic layer).
function buildVariableCatalog(variables) {
  if (!variables || !variables.variables) return [];
  const all = variables.variables;
  const collections = variables.variableCollections || {};
  const valueText = (variable, value) => {
    if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS") {
      return `→ ${all[value.id] ? all[value.id].name : value.id}`;
    }
    if (value && typeof value === "object" && "r" in value) return cssColorOf(value);
    if (variable.resolvedType === "FLOAT") return String(round(value, 3));
    return String(value);
  };
  return Object.values(collections)
    .filter(Boolean)
    .map((collection) => {
      const modes = collection.modes || [];
      const ids = collection.variableIds || Object.keys(all).filter((id) => all[id] && all[id].variableCollectionId === collection.id);
      return {
        id: collection.id,
        name: collection.name,
        modes: modes.map((mode) => mode.name),
        defaultMode: (modes.find((mode) => mode.modeId === collection.defaultModeId) || modes[0] || {}).name || "",
        variables: ids
          .map((id) => all[id])
          .filter(Boolean)
          .map((variable) => ({
            name: variable.name,
            cssName: variableCssName(variable),
            type: variable.resolvedType,
            remote: Boolean(variable.remote),
            description: variable.description || "",
            values: modes.map((mode) => valueText(variable, (variable.valuesByMode || {})[mode.modeId]))
          }))
      };
    });
}

function structureFromContext(ctx, variables = null) {
  const typography = inferTypography(ctx);
  const screens = listScreens(ctx).map((entry) => describeScreen(entry, ctx, typography));
  const pages = [];
  for (const page of ctx.file.document?.children || []) {
    if (!isVisible(page)) continue;
    pages.push({
      id: page.id,
      name: page.name,
      flows: (page.flowStartingPoints || []).map((flow) => ({ name: flow.name, start: ctx.nodes.get(flow.nodeId)?.name || flow.nodeId })),
      screens: screens.filter((screen) => screen.page === page.name)
    });
  }
  const { componentSets, components } = buildComponentCatalog(ctx);
  const styles = buildStyleCatalog(ctx);
  const imageFills = collectImageRefs(ctx.file.document);
  const variableCollections = buildVariableCatalog(variables);
  return {
    name: ctx.file.name || "Figma file",
    lastModified: ctx.file.lastModified || "",
    version: ctx.file.version || "",
    scopedNodeId: ctx.file.scopedNodeId || null,
    pages,
    componentSets,
    components,
    styles,
    variableCollections,
    imageFills,
    typography: { bodySize: typography.bodySize, headings: typography.headings },
    stats: {
      pages: pages.length,
      screens: screens.length,
      sections: screens.reduce((sum, screen) => sum + screen.sections.length, 0),
      componentSets: componentSets.length,
      components: components.length,
      styles: styles.length,
      variables: variableCollections.reduce((sum, collection) => sum + collection.variables.length, 0),
      imageFills: imageFills.length,
      nodes: ctx.nodes.size
    }
  };
}

/**
 * @returns {{ name, lastModified, version, scopedNodeId, pages: Array<{ id, name, flows, screens }>,
 *   componentSets, components, styles, variableCollections, imageFills, typography: { bodySize, headings }, stats }}
 */
export function buildFigmaStructure(file, { variables = null } = {}) {
  if (!file || !file.document) throw new Error("Fichier Figma invalide : document absent.");
  return structureFromContext(indexFile(file), variables);
}

/* ------------------------------------------------------------------ *
 * Payload (content-script shape)
 * ------------------------------------------------------------------ */

const PIXEL_SCOPES = new Set([
  "CORNER_RADIUS",
  "WIDTH_HEIGHT",
  "GAP",
  "STROKE_FLOAT",
  "EFFECT_FLOAT",
  "FONT_SIZE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
  "PARAGRAPH_SPACING",
  "PARAGRAPH_INDENT"
]);
const PIXEL_NAME = /space|spacing|gap|radius|radii|size|padding|margin|width|height|inset|offset|blur|border|stroke/i;

function variableCssName(variable) {
  const web = variable.codeSyntax && variable.codeSyntax.WEB;
  const declared = web ? String(web).match(/--[A-Za-z0-9_-]+/) : null;
  if (declared) return declared[0];
  return `--${String(variable.name || variable.id).split("/").map(slugify).filter(Boolean).join("-")}`;
}

// Aliases are followed to a concrete value (cycle-guarded): normalize
// matches tokens to variables by value, so a reference would never match.
function resolveVariableValue(variable, modeId, all, collections, depth = 0) {
  if (!variable || depth > 10) return undefined;
  const values = variable.valuesByMode || {};
  const value = modeId in values ? values[modeId] : Object.values(values)[0];
  if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS") {
    const target = all[value.id];
    if (!target) return undefined;
    const sameCollection = target.variableCollectionId === variable.variableCollectionId;
    const targetCollection = collections[target.variableCollectionId];
    const targetMode = sameCollection ? modeId : targetCollection && targetCollection.defaultModeId;
    return resolveVariableValue(target, targetMode, all, collections, depth + 1);
  }
  return value;
}

function variablesToCss(variables) {
  if (!variables || !variables.variables) return [];
  const all = variables.variables;
  const collections = variables.variableCollections || {};
  const out = [];
  const ordered = Object.values(all).sort((a, b) => Number(Boolean(a && a.remote)) - Number(Boolean(b && b.remote)));
  for (const variable of ordered) {
    if (!variable) continue;
    const collection = collections[variable.variableCollectionId];
    const modeId = (collection && collection.defaultModeId) || Object.keys(variable.valuesByMode || {})[0];
    const value = resolveVariableValue(variable, modeId, all, collections);
    let css = null;
    if (variable.resolvedType === "COLOR" && value && typeof value === "object" && "r" in value) {
      css = cssColorOf(value);
    } else if (variable.resolvedType === "FLOAT" && Number.isFinite(Number(value))) {
      const scopes = variable.scopes || [];
      const pixel = scopes.some((scope) => PIXEL_SCOPES.has(scope)) || ((scopes.length === 0 || scopes.includes("ALL_SCOPES")) && PIXEL_NAME.test(variable.name));
      css = pixel ? px(value) : String(round(value, 3));
    } else if (variable.resolvedType === "STRING" && typeof value === "string") {
      css = value;
    }
    if (css !== null && css !== "") out.push({ name: variableCssName(variable), value: css });
  }
  return out;
}

// Text styles are left out on purpose: normalize maps any token to any
// variable of equal value, so "--text-h1-font-size: 64px" would label a 64px
// spacing step. Text styles are documented in FIGMA_STRUCTURE.md instead.
function stylesToCss(styleCatalog) {
  const out = [];
  const prefixed = (prefix, name) => {
    const slug = String(name).split("/").map(slugify).filter(Boolean).join("-");
    return slug.startsWith(`${prefix}-`) || slug === prefix ? `--${slug}` : `--${prefix}-${slug}`;
  };
  for (const style of styleCatalog) {
    if (style.type === "FILL" && style.value && style.value !== "image") {
      out.push({ name: prefixed("color", style.name), value: style.value });
    } else if (style.type === "EFFECT" && style.value && !/blur\(/.test(style.value)) {
      out.push({ name: prefixed("shadow", style.name), value: style.value });
    }
  }
  return out;
}

function topCounts(map, limit) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function measureA11y(screenNodes, ctx) {
  const metrics = { contrastChecked: 0, contrastFailures: 0, worstPairs: [], targetsChecked: 0, smallTargets: 0 };
  const pairs = [];
  const visit = (node, backdrop, path) => {
    if (!isVisible(node)) return;
    let surface = backdrop;
    if (node.type !== "TEXT" && !VECTOR_TYPES.has(node.type)) {
      const paint = topSolid(node.fills);
      if (paint && (paint.color?.a ?? 1) * (paint.opacity ?? 1) >= 0.5) surface = visibleHex(paintCss(paint), backdrop) || backdrop;
    }
    if ((isButtonLike(node, ctx) || isInputLike(node, ctx)) && metrics.targetsChecked < 200) {
      const box = boxOf(node);
      metrics.targetsChecked += 1;
      if (box.width < 24 || box.height < 24) metrics.smallTargets += 1;
    }
    if (node.type === "TEXT" && clean(node.characters)) {
      const css = textColorOf(node);
      const fg = css ? visibleHex(css, surface) : null;
      if (fg && fg.startsWith("#")) {
        const style = node.style || {};
        const ratio = contrastRatio(fg, surface);
        const size = num(style.fontSize) || 16;
        const large = size >= 24 || (size >= 18.66 && num(style.fontWeight) >= 700);
        const required = large ? 3 : 4.5;
        metrics.contrastChecked += 1;
        if (ratio < required) {
          metrics.contrastFailures += 1;
          pairs.push({ selector: `${path} / ${node.name}`.slice(0, 120), foreground: fg, background: surface, ratio: round(ratio), required });
        }
      }
      return;
    }
    for (const child of node.children || []) visit(child, surface, node === screenNodes[0] ? node.name : path);
  };
  for (const screen of screenNodes) visit(screen, "#ffffff", screen.name);
  pairs.sort((a, b) => a.ratio - b.ratio);
  metrics.worstPairs = pairs.slice(0, 5);
  return metrics;
}

/**
 * Converts a Figma file into the content-script payload consumed by
 * normalizeExtractedStyles(). `imageFills` (imageRef -> URL) is optional.
 */
export function figmaToPayload(file, { variables = null, fileKey = "", url = "", imageFills = {} } = {}) {
  if (!file || !file.document) throw new Error("Fichier Figma invalide : document absent.");
  const ctx = indexFile(file);
  const structure = structureFromContext(ctx, variables);
  const screenEntries = listScreens(ctx);
  const screens = structure.pages.flatMap((page) => page.screens);

  const typography = [];
  const colors = [];
  const spacing = [];
  const radius = [];
  const shadows = [];
  const motion = [];
  const backgroundImages = [];
  const runtimeAnimations = [];
  const borderWidths = new Map();
  const maxWidths = new Map();
  const fontFaces = new Map();
  let flexCount = 0;
  let gridCount = 0;
  let sampled = 0;

  for (const node of ctx.nodes.values()) {
    if (node.type === "DOCUMENT" || node.type === "CANVAS") continue;

    for (const item of interactionsOf(node, ctx)) {
      if (item.duration > 0) {
        motion.push({ transitionDuration: `${item.duration}ms`, transitionTimingFunction: item.easing, animationDuration: "", animationTimingFunction: "" });
      }
      if (item.transition && runtimeAnimations.length < 12) {
        runtimeAnimations.push({
          type: `prototype ${item.transition.toLowerCase().replace(/_/g, " ")}`,
          name: `${item.trigger} → ${item.destination}`,
          duration: item.duration,
          delay: 0,
          easing: item.easingLabel,
          iterations: 1,
          target: node.name,
          keyframes: []
        });
      }
    }

    if (node.type === "TEXT") {
      if (!clean(node.characters)) continue;
      const base = node.style || {};
      const used = new Set(node.characterStyleOverrides || []);
      const variants = [base, ...Object.entries(node.styleOverrideTable || {}).filter(([id]) => used.has(Number(id)) || used.has(id)).map(([, override]) => ({ ...base, ...override }))];
      // A paragraph weighs more than a two-word label when electing the
      // body style: rows are repeated by text length (capped).
      const weight = Math.min(4, 1 + Math.floor(clean(node.characters).length / 60));
      for (const style of variants) {
        for (let i = 0; i < weight; i += 1) typography.push({
          fontFamily: style.fontFamily || "",
          fontSize: px(style.fontSize),
          lineHeight: lineHeightCss(style),
          fontWeight: String(style.fontWeight ?? 400),
          letterSpacing: num(style.letterSpacing) ? px(style.letterSpacing) : "normal",
          textTransform: textCaseCss(style.textCase) || "none"
        });
        if (style.fontFamily) {
          const face = { family: style.fontFamily, weight: String(style.fontWeight ?? 400), style: style.italic ? "italic" : "normal", urls: [] };
          fontFaces.set(`${face.family}|${face.weight}|${face.style}`, face);
        }
      }
      const color = textColorOf(node);
      if (color) colors.push({ textColor: color, backgroundColor: "", borderColor: "", outlineColor: "" });
      sampled += 1;
      continue;
    }
    // Sections and component-set frames are editor chrome (the dashed
    // purple variant border), not part of the design.
    if (node.type === "SECTION" || node.type === "COMPONENT_SET") continue;

    let contributed = false;
    const shape = VECTOR_TYPES.has(node.type);
    const background = backgroundOf(node);
    const stroke = strokeOf(node);
    const focusState = node.type === "COMPONENT" && stateOf(variantPropsOf(ctx, node)) === "focus-visible";
    const backgroundColor = !shape && background.kind === "color" ? background.css : "";
    // Only lines count among glyph strokes: they are dividers, not icon ink.
    const edge = stroke && (!shape || node.type === "LINE") ? stroke : null;
    if (backgroundColor || edge) {
      colors.push({
        textColor: "",
        backgroundColor,
        borderColor: edge && !focusState ? edge.color : "",
        outlineColor: edge && focusState ? edge.color : ""
      });
      contributed = true;
    }
    if (edge) borderWidths.set(px(edge.width), (borderWidths.get(px(edge.width)) || 0) + 1);
    if (!shape && background.kind === "gradient") backgroundImages.push(background.css);

    const layout = layoutOf(node);
    if (layout) {
      if (layout.direction === "grid") gridCount += 1;
      else flexCount += 1;
      const [top, right, bottom, left] = layout.padding;
      if (top || right || bottom || left) {
        spacing.push({ paddingTop: px(top), paddingRight: px(right), paddingBottom: px(bottom), paddingLeft: px(left) });
      }
      // normalize only reads margin/padding pairs: a gap is the margin
      // between siblings, so it is reported as one.
      const visibleChildren = (node.children || []).filter(isVisible).length;
      if (layout.direction === "grid") {
        if (layout.rowGap > 0) spacing.push({ marginTop: px(layout.rowGap) });
        if (layout.columnGap > 0) spacing.push({ marginLeft: px(layout.columnGap) });
      } else if (layout.justify !== "space-between" && layout.gap > 0 && visibleChildren > 1) {
        spacing.push({ marginTop: px(layout.gap) });
      }
      if (layout.wrap && layout.counterGap > 0) spacing.push({ marginLeft: px(layout.counterGap) });
      contributed = true;
    }
    if (num(node.maxWidth) > 0) maxWidths.set(px(node.maxWidth), (maxWidths.get(px(node.maxWidth)) || 0) + 1);

    if (node.type !== "ELLIPSE") {
      for (const value of new Set(radiusValues(node).filter((r) => r > 0))) {
        radius.push(px(value));
        contributed = true;
      }
    }
    const shadow = shadowCss(node);
    if (shadow) {
      shadows.push(shadow);
      contributed = true;
    }
    if (contributed) sampled += 1;
  }

  // Page canvas = the dominant screen background.
  const canvasCounts = new Map();
  for (const { node } of screenEntries) {
    const background = backgroundOf(node);
    if (background.kind !== "color") continue;
    const hex = visibleHex(background.css, "#ffffff");
    if (hex && hex.startsWith("#")) canvasCounts.set(hex, (canvasCounts.get(hex) || 0) + 1);
  }
  const pageBackground = topCounts(canvasCounts, 1)[0]?.value || "#ffffff";

  const mainScreen = pickMainScreen(screens);
  const mainEntry = mainScreen ? screenEntries.find((entry) => entry.node.id === mainScreen.id) : null;

  // Container width: auto-layout max-width when set, otherwise inner
  // blocks centered in a full-width section (the classic max-width wrapper).
  if (maxWidths.size === 0 && mainEntry) {
    for (const sectionNode of orderedChildren(contentRoot(mainEntry.node))) {
      const sectionBox = boxOf(sectionNode);
      // Symmetric horizontal padding on a full-width auto-layout section
      // defines the content column directly.
      const [, padRight, , padLeft] = paddingOf(sectionNode);
      if (layoutOf(sectionNode) && padLeft > 0 && padLeft === padRight && sectionBox.width - padLeft * 2 >= 320) {
        const width = px(sectionBox.width - padLeft * 2);
        maxWidths.set(width, (maxWidths.get(width) || 0) + 1);
        continue;
      }
      for (const child of (sectionNode.children || []).filter((item) => isVisible(item) && CONTAINER_TYPES.has(item.type))) {
        const childBox = boxOf(child);
        const left = childBox.x - sectionBox.x;
        const right = sectionBox.x + sectionBox.width - (childBox.x + childBox.width);
        if (childBox.width >= 320 && childBox.width < sectionBox.width - 32 && Math.abs(left - right) <= 2) {
          maxWidths.set(px(childBox.width), (maxWidths.get(px(childBox.width)) || 0) + 1);
        }
      }
    }
  }

  const { buttonVariants, interactionStyles, buttonCount } = collectButtons(ctx);
  const formControl = collectFormControl(ctx, mainEntry);
  const linkSpec = collectLinkSpec(ctx);
  const sections = mainScreen ? mainScreen.sections : [];
  const allSections = screens.flatMap((screen) => screen.sections);
  const allTexts = allSections.flatMap((section) => section.texts);

  const sectionPaddings = new Map();
  for (const section of sections) {
    const top = Number.parseFloat(section.paddingY);
    if (top >= 16) sectionPaddings.set(px(top), (sectionPaddings.get(px(top)) || 0) + 1);
  }

  // Frame widths are the designer's breakpoints: every width above the
  // smallest one becomes a min-width breakpoint.
  const widthCounts = new Map();
  for (const screen of screens) widthCounts.set(screen.width, (widthCounts.get(screen.width) || 0) + 1);
  const widths = Array.from(widthCounts.keys()).sort((a, b) => a - b);
  const breakpoints = widths.length >= 2 ? widths.slice(1).map((width) => ({ px: width, count: widthCounts.get(width) })) : [];

  const imageInventory = [];
  let heroAssigned = false;
  const imageSources = [...sections.flatMap((section) => section.images), ...allSections.flatMap((section) => section.images)];
  const seenImages = new Set();
  for (const image of imageSources) {
    if (imageInventory.length >= 20 || seenImages.has(image.id)) continue;
    seenImages.add(image.id);
    let role = "photo";
    if (/logo|brand/i.test(image.name)) role = "logo";
    else if (Math.max(image.width, image.height) <= 48) role = "icon";
    else if (!heroAssigned && image.width * image.height > 90000) {
      role = "hero";
      heroAssigned = true;
    }
    imageInventory.push({
      src: imageFills[image.imageRef] || `figma-image:${image.imageRef}`,
      alt: image.name,
      role,
      width: image.width,
      height: image.height
    });
  }

  const forms = allSections
    .filter((section) => section.inputs.length > 0)
    .slice(0, 5)
    .map((section) => ({
      name: section.name,
      method: "post",
      fieldCount: section.inputs.length,
      fields: section.inputs.slice(0, 12).map((input) => ({
        tag: input.kind === "textarea" ? "textarea" : input.kind === "select" ? "select" : "input",
        type: ["textarea", "select"].includes(input.kind) ? input.kind : input.kind,
        name: input.name,
        placeholder: input.texts[input.texts.length - 1] || "",
        required: input.texts.some((text) => /\*/.test(text)),
        label: input.texts.length > 1 ? input.texts[0] : ""
      })),
      submitText: section.ctas[0] || ""
    }));

  let cards = 0;
  let navigation = 0;
  let lists = 0;
  let tables = 0;
  let inputs = 0;
  for (const node of ctx.nodes.values()) {
    if (!["FRAME", "INSTANCE", "COMPONENT"].includes(node.type)) continue;
    const name = `${node.name} ${componentLabel(ctx, node).base}`;
    if (/card|tile|carte/i.test(name)) cards += 1;
    if (/\bnav|navbar|header|menu|top ?bar/i.test(name)) navigation += 1;
    if (/\blist|liste/i.test(name)) lists += 1;
    if (/\btable|tableau/i.test(name)) tables += 1;
    if (isInputLike(node, ctx)) inputs += 1;
  }
  const links = allSections.reduce((sum, section) => sum + section.links, 0) || (linkSpec ? linkSpec.usage : 0);

  const textCorpus = allTexts.map((item) => item.text);
  const shortTexts = textCorpus.filter((text) => text.length <= 30);
  const siteSignals = {
    title: file.name || "",
    description: "",
    keywords: "",
    ogType: "",
    ogSiteName: "",
    appName: "",
    pathname: "/",
    hostname: "www.figma.com",
    headings: Array.from(new Set(allTexts.filter((item) => item.kind === "heading" && item.text.length <= 120).map((item) => item.text))).slice(0, 10),
    navTexts: Array.from(
      new Set(allSections.filter((section) => section.role === "header/navigation").flatMap((section) => section.texts.map((item) => item.text)).filter((text) => text.length <= 50))
    ).slice(0, 24),
    ctaTexts: Array.from(new Set(allSections.flatMap((section) => section.ctas))).slice(0, 24),
    textSample: textCorpus.join(" ").slice(0, 14000),
    elementCounts: {
      forms: forms.length,
      inputs,
      tables,
      codeBlocks: 0,
      articles: cards,
      pricingSections: allSections.filter((section) => section.role === "pricing").length,
      productMarkers: 0,
      authMarkers: shortTexts.filter((text) => AUTH_LABEL.test(text)).length,
      checkoutMarkers: shortTexts.filter((text) => PURCHASE_LABEL.test(text)).length
    }
  };

  const styleCatalog = structure.styles;
  const cssVariables = [];
  const seenVariables = new Set();
  for (const variable of [...variablesToCss(variables), ...stylesToCss(styleCatalog)]) {
    if (seenVariables.has(variable.name)) continue;
    seenVariables.add(variable.name);
    cssVariables.push(variable);
  }

  const screenNodes = screenEntries.map((entry) => entry.node);
  const a11y = measureA11y(screenNodes.length > 0 ? screenNodes : (file.document.children || []).filter(isVisible), ctx);

  return {
    source: {
      url: url || (fileKey ? `https://www.figma.com/design/${fileKey}` : ""),
      title: file.name || "Figma file"
    },
    sampledAt: new Date().toISOString(),
    totalElements: ctx.nodes.size,
    sampledElements: sampled,
    typography,
    colors,
    spacing,
    radius,
    shadows,
    motion,
    backgroundImages,
    pageBackground,
    keyframes: [],
    interactionStyles,
    breakpoints,
    runtimeAnimations,
    scrollTriggers: [],
    animationLibs: [],
    canvasInventory: [],
    parallax: null,
    a11y,
    stack: [],
    resources: { stylesheets: [], scripts: [], fontFaces: Array.from(fontFaces.values()).slice(0, 20), inlineStyleBlocks: 0 },
    headings: structure.typography.headings.map(({ source, ...heading }) => heading),
    buttonVariants,
    formControl,
    linkSpec,
    layout: {
      containerMaxWidth: topCounts(maxWidths, 1)[0]?.value || null,
      flexCount,
      gridCount,
      zIndexScale: [],
      borderWidths: topCounts(borderWidths, 4),
      sectionPaddings: topCounts(sectionPaddings, 4)
    },
    structure: sections.map((section) => ({
      role: section.role,
      tag: section.tag,
      heading: (section.texts.find((item) => item.kind === "heading") || section.texts[0] || { text: "" }).text.slice(0, 90),
      ctas: section.ctas.slice(0, 3),
      layout: section.layoutLabel,
      columns: section.columns,
      imageCount: section.images.length,
      svgCount: section.vectorCount,
      linkCount: section.links,
      hasForm: section.inputs.length > 0,
      background: section.background.includes("gradient(") ? "gradient" : section.background,
      paddingY: section.paddingY,
      height: section.height
    })),
    imageInventory,
    forms,
    components: [
      { type: "buttons", count: buttonCount },
      { type: "links", count: links },
      { type: "inputs", count: inputs },
      { type: "cards", count: cards },
      { type: "navigation", count: navigation },
      { type: "lists", count: lists },
      { type: "tables", count: tables }
    ],
    siteSignals,
    cssVariables,
    gsap: null,
    platformInfo: {
      platform: "figma",
      fileKey: fileKey || null,
      nodeId: file.scopedNodeId || null,
      details: `Imported from Figma: "${file.name || "Figma file"}", ${structure.stats.screens} screen(s), ${structure.stats.componentSets + structure.stats.components} component(s), ${structure.stats.styles} style(s)${file.lastModified ? `, last modified ${file.lastModified}` : ""}`
    }
  };
}

// The screen most representative of the product: desktop-width first,
// then the richest in sections, then the tallest.
function pickMainScreen(screens) {
  return [...screens].sort(
    (a, b) => Number(b.width >= 1024) - Number(a.width >= 1024) || b.sections.length - a.sections.length || b.height - a.height
  )[0] || null;
}

function collectButtons(ctx) {
  const clusters = new Map();
  let buttonCount = 0;
  const visit = (node) => {
    if (!isVisible(node)) return;
    if (isButtonLike(node, ctx)) {
      buttonCount += 1;
      if (stateOf(variantPropsOf(ctx, node)) === "default") {
        const spec = visualSpec(node);
        const key = JSON.stringify(spec);
        const entry = clusters.get(key) || { spec, count: 0, example: "" };
        entry.count += 1;
        if (!entry.example) entry.example = truncate(collectTexts(node, 4).map((text) => clean(text.characters)).join(" "), 30);
        clusters.set(key, entry);
      }
      return;
    }
    for (const child of node.children || []) visit(child);
  };
  visit(ctx.file.document);

  // Hover/focus/pressed/disabled variants become interaction rules, diffed
  // against the default variant with the same identity (Type, Size...).
  const interactionStyles = [];
  for (const node of ctx.nodes.values()) {
    if (node.type !== "COMPONENT_SET") continue;
    const variants = (node.children || []).filter((child) => isVisible(child) && child.type === "COMPONENT" && isButtonLike(child, ctx));
    if (variants.length === 0) continue;
    const byIdentity = new Map();
    for (const variant of variants) {
      const props = parseVariantName(variant.name);
      const identity = variantIdentity(props);
      const group = byIdentity.get(identity) || { base: null, states: [] };
      const state = stateOf(props);
      if (state === "default") group.base = group.base || variant;
      else group.states.push({ state, node: variant });
      byIdentity.set(identity, group);
    }
    for (const [identity, group] of byIdentity) {
      if (!group.base) continue;
      const base = visualSpec(group.base);
      for (const { state, node: variant } of group.states) {
        const next = visualSpec(variant);
        const declarations = [];
        if (next.background !== base.background) declarations.push(`${/gradient\(/.test(next.background) ? "background" : "background-color"}: ${next.background}`);
        if (next.color !== base.color) declarations.push(`color: ${next.color}`);
        if (next.border !== base.border) declarations.push(`border: ${next.border}`);
        if (next.boxShadow !== base.boxShadow) declarations.push(`box-shadow: ${next.boxShadow || "none"}`);
        if ((variant.opacity ?? 1) !== (group.base.opacity ?? 1)) declarations.push(`opacity: ${round(variant.opacity ?? 1, 2)}`);
        if (declarations.length === 0) continue;
        const selector = `.${[slugify(node.name), slugify(identity)].filter(Boolean).join("-")}:${state === "disabled" ? "disabled" : state}`;
        interactionStyles.push({ selector, declarations: declarations.slice(0, 6) });
      }
    }
  }

  return {
    buttonVariants: Array.from(clusters.values()).sort((a, b) => b.count - a.count).slice(0, 4),
    interactionStyles: interactionStyles.slice(0, 40),
    buttonCount
  };
}

function collectFormControl(ctx, mainEntry) {
  let found = null;
  const search = (root) => {
    walk(root, (node) => {
      if (found) return false;
      if (isInputLike(node, ctx)) {
        found = node;
        return false;
      }
      return true;
    });
  };
  if (mainEntry) search(mainEntry.node);
  if (!found) search(ctx.file.document);
  if (!found) return null;
  const spec = visualSpec(found);
  const box = boxOf(found);
  return {
    tag: inputKind(found.name) === "textarea" ? "textarea" : inputKind(found.name) === "select" ? "select" : "input",
    height: px(box.height),
    padding: spec.padding,
    border: spec.border === "none" ? "0px none rgba(0, 0, 0, 0)" : spec.border,
    borderRadius: spec.borderRadius,
    background: spec.background,
    color: spec.color,
    fontSize: spec.fontSize
  };
}

function collectLinkSpec(ctx) {
  const counts = new Map();
  for (const node of ctx.nodes.values()) {
    if (node.type !== "TEXT" || !clean(node.characters)) continue;
    const style = node.style || {};
    if (!style.hyperlink && style.textDecoration !== "UNDERLINE" && !/\blink\b|\blien\b/i.test(node.name)) continue;
    const key = JSON.stringify({
      color: textColorOf(node),
      textDecoration: style.textDecoration === "UNDERLINE" ? "underline" : "none",
      fontWeight: String(style.fontWeight ?? 400)
    });
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  return top ? { ...JSON.parse(top[0]), usage: top[1] } : null;
}

/* ------------------------------------------------------------------ *
 * Markdown (AI-facing, English)
 * ------------------------------------------------------------------ */

function mdEscape(text) {
  return String(text || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function quote(text) {
  return `"${String(text).replace(/"/g, '\\"')}"`;
}

/**
 * One screen as a standalone Markdown document (downloadable on its own).
 */
export function generateFrameMarkdown(frame) {
  const lines = [`# Screen: ${frame.name}`, ""];
  lines.push(`- Page: ${frame.page}${frame.group ? ` (section \`${frame.group}\`)` : ""}`);
  lines.push(`- Frame size: ${frame.width} x ${frame.height}px; background ${frame.background}`);
  lines.push(`- Root layout: ${describeLayout(frame.layout)}`);
  if (frame.grids) lines.push(`- Layout grid: ${frame.grids}`);
  lines.push(`- Sections: ${frame.sections.length}, listed top to bottom${frame.decorations ? `; plus ${frame.decorations} decorative layer(s) (shapes/vectors) not listed` : ""}`);
  if (frame.componentsUsed.length > 0) {
    lines.push(`- Components used: ${frame.componentsUsed.slice(0, 12).map((item) => `\`${item.name}\` x${item.count}`).join(", ")}`);
  }
  lines.push("");

  frame.sections.forEach((section, index) => {
    lines.push(`## ${index + 1}. ${section.name} — ${section.role}`);
    lines.push(`- Element: \`<${section.tag}>\` from \`${section.name}\` (${section.type}), ${section.width} x ${section.height}px at x=${section.x}, y=${section.y}`);
    lines.push(`- Layout: ${describeLayout(section.layout)}${section.layoutLabel.endsWith("(nested)") ? " (applies to the inner wrapper)" : ""}`);
    if (section.placement) lines.push(`- Placement: ${section.placement}`);
    if (section.grids) lines.push(`- Layout grid: ${section.grids}`);
    const surface = [`background ${section.background}`];
    if (section.radius) surface.push(`radius ${section.radius}`);
    if (section.shadow) surface.push(`box-shadow ${section.shadow}`);
    if (section.blur) surface.push(section.blur);
    lines.push(`- Surface: ${surface.join("; ")}`);
    if (section.texts.length > 0) {
      lines.push("- Copy (verbatim, reading order):");
      for (const item of section.texts) {
        const tag = item.kind === "heading" ? `heading${item.level ? ` ${item.level}` : ""}` : item.kind;
        lines.push(`  - [${tag}] ${quote(item.text)} — ${item.font}${item.color ? `, ${item.color}` : ""}${item.styleName ? ` (style \`${item.styleName}\`)` : ""}`);
      }
    }
    if (section.ctas.length > 0) lines.push(`- Calls to action: ${section.ctas.map(quote).join(", ")}`);
    if (section.inputs.length > 0) {
      lines.push(`- Form fields: ${section.inputs.map((input) => `\`${input.name}\` (${input.kind}${input.texts.length ? `, placeholder ${quote(input.texts[input.texts.length - 1])}` : ""})`).join(", ")}`);
    }
    if (section.layoutTree.length > 0) {
      lines.push("- Layout tree (every nested frame, in flow order):");
      const renderTree = (blocks, indent) => {
        for (const block of blocks) {
          const extras = [block.surface, block.placement, block.grids ? `grid ${block.grids}` : ""].filter(Boolean).join("; ");
          const component = block.component && block.component !== block.name ? ` = \`${block.component}\`` : "";
          lines.push(`${indent}- \`${block.name}\`${component} ${block.width}x${block.height} — ${block.layout}${extras ? `; ${extras}` : ""}`);
          renderTree(block.children, `${indent}  `);
        }
      };
      renderTree(section.layoutTree, "  ");
    }
    if (section.instances.length > 0) lines.push(`- Components: ${section.instances.map((item) => `\`${item.name}\` x${item.count}`).join(", ")}`);
    if (section.images.length > 0) {
      lines.push(`- Images: ${section.images.map((image) => `\`${image.name}\` ${image.width}x${image.height} (image fill \`${image.imageRef}\`)`).join(", ")}`);
    }
    if (section.vectorCount > 0) lines.push(`- Vector shapes/icons: ${section.vectorCount} (export as SVG)`);
    lines.push("");
  });

  if (frame.interactions.length > 0) {
    lines.push("## Prototype interactions");
    for (const item of frame.interactions) lines.push(`- \`${item.source}\`: ${interactionText(item)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function demote(markdown, levels) {
  const prefix = "#".repeat(levels);
  return markdown.replace(/^(#+) /gm, `${prefix}$1 `);
}

/**
 * FIGMA_STRUCTURE.md: everything an agent needs to rebuild the file in code.
 */
export function generateFigmaStructureMarkdown(structure, { fileName = "", url = "" } = {}) {
  const name = fileName || structure.name;
  const screens = structure.pages.flatMap((page) => page.screens);
  const lines = [`# FIGMA_STRUCTURE.md — ${name}`, ""];
  lines.push(`> Generated by Keys_Osi from Figma${url ? ` (${url})` : ""}${structure.lastModified ? `, file last modified ${structure.lastModified}` : ""}.`);
  lines.push("> Purpose: rebuild this design in code. Screens follow canvas order, sections run top to bottom, and copy is verbatim. Visual tokens live in DESIGN.md.");
  if (structure.scopedNodeId) lines.push(`> Scope: only node \`${structure.scopedNodeId}\` and its children were imported.`);
  lines.push("");

  lines.push("## Overview");
  lines.push(`- Pages: ${structure.pages.length} (${structure.pages.map((page) => `\`${page.name}\``).join(", ")})`);
  const widthCounts = new Map();
  for (const screen of screens) widthCounts.set(screen.width, (widthCounts.get(screen.width) || 0) + 1);
  lines.push(`- Screens: ${screens.length}${widthCounts.size > 0 ? `; frame widths ${Array.from(widthCounts.entries()).sort((a, b) => b[0] - a[0]).map(([width, count]) => `${width}px (${count})`).join(", ")}` : ""}`);
  lines.push(`- Components: ${structure.componentSets.length} component set(s), ${structure.components.filter((item) => !item.remote).length} standalone, ${structure.components.filter((item) => item.remote).length} from libraries`);
  lines.push(`- Styles: ${structure.styles.length}; variables: ${structure.stats.variables}${structure.variableCollections.length === 0 ? " (variables API unavailable or none defined)" : ""}; image fills: ${structure.imageFills.length}`);
  for (const page of structure.pages) {
    if (page.flows.length > 0) lines.push(`- Prototype flows on \`${page.name}\`: ${page.flows.map((flow) => `${quote(flow.name)} starts at \`${flow.start}\``).join(", ")}`);
  }
  if (structure.typography.headings.length > 0) {
    lines.push(
      `- Type hierarchy: ${structure.typography.headings.map((heading) => `${heading.level.toUpperCase()} ${heading.fontFamily} ${heading.fontSize}/${heading.lineHeight} ${heading.fontWeight}`).join("; ")}; body ${structure.typography.bodySize}px`
    );
  }
  lines.push("");

  lines.push("## How to Rebuild");
  lines.push("1. You must build the tokens from DESIGN.md first; never invent a color, size, radius or shadow absent from it.");
  lines.push("2. Implement the components of the catalog below; variant properties map to component props.");
  lines.push("3. Build each screen section by section in the listed order, with the exact copy.");
  lines.push("4. Auto-layout maps to flexbox: `flex row`/`flex column` = flex-direction, gap = gap, padding = padding (top right bottom left), justify-content and align-items as listed. `absolute` means free positioning: use the given x/y offsets or rebuild with a flex/grid equivalent.");
  lines.push("5. Frame widths are breakpoints: the widest frame is the desktop layout; you should derive the narrower layouts from the matching screens when they exist.");
  lines.push("");

  lines.push("## Screens Index");
  if (screens.length === 0) {
    lines.push("No screen frames were found (top-level frames of at least 200x150px).");
  } else {
    lines.push("| # | Page | Screen | Size | Sections |");
    lines.push("|---|---|---|---|---|");
    screens.forEach((screen, index) => {
      lines.push(`| ${index + 1} | ${mdEscape(screen.page)} | ${mdEscape(screen.name)} | ${screen.width}x${screen.height} | ${screen.sections.map((section) => mdEscape(section.name)).join(" → ")} |`);
    });
  }
  lines.push("");

  if (screens.length > 0) {
    lines.push("## Screens");
    lines.push("");
    for (const screen of screens) lines.push(demote(generateFrameMarkdown(screen), 2));
  }

  lines.push("## Component Catalog");
  if (structure.componentSets.length === 0 && structure.components.length === 0) {
    lines.push("No components are defined or used in this file.");
  }
  for (const set of structure.componentSets) {
    lines.push(`### ${set.name} (component set, ${set.usage} instance(s))`);
    if (set.description) lines.push(`- Description: ${set.description}`);
    if (set.properties.length > 0) {
      lines.push(
        `- Properties: ${set.properties
          .map((prop) => `\`${prop.name}\` (${String(prop.type).toLowerCase()}${prop.options.length ? `: ${prop.options.join(" | ")}` : ""}${prop.default !== "" ? `; default ${quote(prop.default)}` : ""})`)
          .join(", ")}`
      );
    }
    lines.push("- Variants:");
    for (const variant of set.variants) {
      lines.push(`  - \`${variant.name}\` — ${variant.width}x${variant.height}; ${variant.spec}; used ${variant.usage}x`);
      for (const interaction of variant.interactions) lines.push(`    - Interaction: ${interaction}`);
    }
    lines.push("");
  }
  const local = structure.components.filter((item) => !item.remote);
  if (local.length > 0) {
    lines.push("### Standalone components");
    for (const component of local) {
      lines.push(`- \`${component.name}\` — ${component.width}x${component.height}; ${component.spec}; used ${component.usage}x${component.description ? `; ${component.description}` : ""}`);
    }
    lines.push("");
  }
  const remote = structure.components.filter((item) => item.remote);
  if (remote.length > 0) {
    lines.push("### Library components (defined in another file)");
    for (const component of remote) lines.push(`- \`${component.name}\` — used ${component.usage}x`);
    lines.push("");
  }

  lines.push("## Styles");
  if (structure.styles.length === 0) {
    lines.push("No shared styles are defined in this file.");
  } else {
    lines.push("| Style | Type | Value | Uses | Description |");
    lines.push("|---|---|---|---|---|");
    for (const style of structure.styles) {
      lines.push(`| ${mdEscape(style.name)} | ${style.type} | ${mdEscape(style.value) || "(not applied in this file)"} | ${style.usage} | ${mdEscape(style.description)} |`);
    }
  }
  lines.push("");

  if (structure.variableCollections.length > 0) {
    lines.push("## Variables");
    for (const collection of structure.variableCollections) {
      lines.push(`### ${collection.name} (modes: ${collection.modes.join(", ")}; default ${collection.defaultMode})`);
      lines.push(`| Variable | CSS name | Type | ${collection.modes.map(mdEscape).join(" | ")} |`);
      lines.push(`|---|---|---|${collection.modes.map(() => "---").join("|")}|`);
      for (const variable of collection.variables) {
        lines.push(`| ${mdEscape(variable.name)}${variable.remote ? " (library)" : ""} | \`${variable.cssName}\` | ${variable.type} | ${variable.values.map(mdEscape).join(" | ")} |`);
      }
      lines.push("");
    }
  }

  if (structure.imageFills.length > 0) {
    lines.push("## Image Fills");
    lines.push("Raster images placed in the design (download them with the image-fills endpoint; URLs expire).");
    for (const image of structure.imageFills) lines.push(`- \`${image.imageRef}\` on \`${image.name}\` (node ${image.nodeId})`);
    lines.push("");
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Export planning
 * ------------------------------------------------------------------ */

const GENERIC_LAYER_NAME = /^(vector|union|subtract|intersect|exclude|group|frame|ellipse|rectangle|polygon|star|line|shape)\s*\d*$/i;
const ICON_NAME = /icon|ico\b|logo|glyph|picto/i;
const GLYPH_LEAF = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "REGULAR_POLYGON", "LINE", "ELLIPSE"]);
const ICON_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "REGULAR_POLYGON", "INSTANCE", "COMPONENT", "FRAME", "GROUP"]);

function isIconCandidate(node) {
  if (!ICON_TYPES.has(node.type)) return false;
  const box = boxOf(node);
  const named = ICON_NAME.test(node.name);
  const limit = named ? 128 : 64;
  if (box.width < 8 || box.height < 8 || box.width > limit || box.height > limit) return false;
  if (GLYPH_LEAF.has(node.type)) return true;
  let glyph = false;
  let blocked = false;
  walk(node, (current) => {
    if (blocked) return false;
    if (current.type === "TEXT" || visiblePaints(current.fills).some((paint) => paint.type === "IMAGE")) {
      blocked = true;
      return false;
    }
    if (current !== node && GLYPH_LEAF.has(current.type)) glyph = true;
    return true;
  });
  return !blocked && (glyph || named);
}

/**
 * @returns {{ frames: Array<{id,name}>, icons: Array<{id,name}>, imageRefs: Array<{imageRef,name,nodeId}> }}
 */
export function planFigmaExports(file, { maxFrames = 24 } = {}) {
  if (!file || !file.document) throw new Error("Fichier Figma invalide : document absent.");
  const ctx = indexFile(file);
  const screens = listScreens(ctx);
  const frames = screens.slice(0, maxFrames).map(({ node }) => ({ id: node.id, name: node.name }));
  const screenIds = new Set(screens.map(({ node }) => node.id));

  const icons = [];
  const seenComponents = new Set();
  const visit = (node, parent) => {
    if (!isVisible(node) || icons.length >= 200) return;
    if (node.type !== "DOCUMENT" && node.type !== "CANVAS" && !screenIds.has(node.id) && isIconCandidate(node)) {
      // One export per component, whether met as definition or instance.
      const componentKey = node.type === "COMPONENT" ? node.id : node.type === "INSTANCE" ? node.componentId : null;
      if (componentKey && seenComponents.has(componentKey)) return;
      if (componentKey) seenComponents.add(componentKey);
      let name = node.type === "INSTANCE" ? componentLabel(ctx, node).base || node.name : node.name;
      if (GENERIC_LAYER_NAME.test(name) && parent && parent.type !== "CANVAS") name = parent.name;
      icons.push({ id: node.id, name });
      return;
    }
    for (const child of node.children || []) visit(child, node);
  };
  visit(file.document, null);

  return { frames, icons, imageRefs: collectImageRefs(file.document) };
}
