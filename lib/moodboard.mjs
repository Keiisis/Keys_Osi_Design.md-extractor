/**
 * Keys_Osi moodboard: pins collected while browsing (colors, fonts, images,
 * section captures, copy snippets) kept across sites, exported as a visual
 * board and fed to PROMPT_PRO.
 */

export const BOARD_KEY = "keysOsiMoodboard";
const MAX_ITEMS = 200;

function keyOf(item) {
  switch (item.kind) {
    case "color":
      return `color:${String(item.hex).toLowerCase()}`;
    case "font":
      return `font:${String(item.family).toLowerCase()}:${item.weight || ""}`;
    case "image":
      return `image:${item.url}`;
    case "text":
      return `text:${String(item.text).slice(0, 120)}`;
    case "section":
      return `section:${item.sourceUrl}:${item.selector || item.heading || ""}`;
    default:
      return `${item.kind}:${JSON.stringify(item).slice(0, 120)}`;
  }
}

/** Adds pins (deduplicated); returns { board, added }. */
export function addPins(board, pins, at = new Date().toISOString()) {
  const items = Array.isArray(board) ? [...board] : [];
  let added = 0;
  for (const pin of [].concat(pins)) {
    if (!pin || !pin.kind) continue;
    const key = keyOf(pin);
    if (items.some((item) => item.key === key)) continue;
    items.unshift({ ...pin, key, id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at });
    added += 1;
  }
  return { board: items.slice(0, MAX_ITEMS), added };
}

export function removePin(board, id) {
  return (board || []).filter((item) => item.id !== id);
}

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

/** Compact block for the AI master prompt. */
export function moodboardPromptBlock(items) {
  const lines = ["The user collected these references while browsing. Use them as art direction: borrow the listed colors, type, imagery and section ideas (adapted, never copied verbatim)."];
  const colors = items.filter((item) => item.kind === "color");
  const fonts = items.filter((item) => item.kind === "font");
  const sections = items.filter((item) => item.kind === "section");
  const images = items.filter((item) => item.kind === "image");
  const texts = items.filter((item) => item.kind === "text");
  if (colors.length) lines.push(`- Colors: ${colors.map((item) => `${item.hex}${item.role ? ` (${item.role})` : ""}${item.note ? ` — ${item.note}` : ""}`).join(", ")}`);
  if (fonts.length) lines.push(`- Type: ${fonts.map((item) => `${item.family} ${item.weight || ""} ${item.size || ""}`.replace(/\s+/g, " ").trim()).join("; ")}`);
  for (const item of sections) lines.push(`- Section idea from ${host(item.sourceUrl)}: ${item.role || "section"}${item.heading ? ` “${item.heading}”` : ""}${item.layout ? `, layout ${item.layout}` : ""}${item.note ? ` — ${item.note}` : ""}`);
  if (images.length) lines.push(`- Imagery references: ${images.slice(0, 12).map((item) => `${item.alt || "image"} (${host(item.sourceUrl || item.url)})`).join("; ")}`);
  for (const item of texts.slice(0, 8)) lines.push(`- Tone reference: “${String(item.text).slice(0, 200)}”`);
  return lines.join("\n");
}

export function moodboardMarkdown(items) {
  const out = ["# MOODBOARD.md — Keys_Osi", "", `${items.length} références épinglées.`, ""];
  const group = (kind, title, render) => {
    const list = items.filter((item) => item.kind === kind);
    if (!list.length) return;
    out.push(`## ${title}`);
    for (const item of list) out.push(render(item));
    out.push("");
  };
  group("color", "Couleurs", (item) => `- \`${item.hex}\`${item.role ? ` ${item.role}` : ""} — ${host(item.sourceUrl)}${item.note ? ` — ${item.note}` : ""}`);
  group("font", "Typographies", (item) => `- **${item.family}** ${item.weight || ""} ${item.size || ""} — ${host(item.sourceUrl)}${item.sample ? ` — « ${item.sample} »` : ""}`);
  group("section", "Sections", (item) => `- ${item.role || "section"}${item.heading ? ` « ${item.heading} »` : ""} — ${item.sourceUrl}${item.image ? ` — ![capture](${item.image})` : ""}${item.note ? ` — ${item.note}` : ""}`);
  group("image", "Images", (item) => `- ![${item.alt || "image"}](${item.file || item.url}) — ${host(item.sourceUrl || item.url)}`);
  group("text", "Textes", (item) => `- « ${item.text} » — ${host(item.sourceUrl)}`);
  return out.join("\n");
}

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

/** Self-contained visual board (opens offline). */
export function moodboardHtml(items) {
  const cards = items
    .map((item) => {
      const meta = `<p class="meta">${escapeHtml(host(item.sourceUrl || item.url))}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</p>`;
      if (item.kind === "color") return `<figure class="card color"><div class="swatch" style="background:${escapeHtml(item.hex)}"></div><figcaption><code>${escapeHtml(item.hex)}</code>${meta}</figcaption></figure>`;
      if (item.kind === "font") return `<figure class="card font"><div class="specimen" style="font-family:'${escapeHtml(item.family)}',serif;font-weight:${escapeHtml(item.weight || 400)}">${escapeHtml(item.sample || "Aa Bb Cc 0123")}</div><figcaption>${escapeHtml(item.family)} ${escapeHtml(item.weight || "")} ${escapeHtml(item.size || "")}${meta}</figcaption></figure>`;
      if (item.kind === "image") return `<figure class="card image"><img src="${escapeHtml(item.file || item.url)}" alt="${escapeHtml(item.alt || "")}"><figcaption>${escapeHtml(item.alt || "")}${meta}</figcaption></figure>`;
      if (item.kind === "section") return `<figure class="card section">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : ""}<figcaption>${escapeHtml(item.role || "section")} ${item.heading ? `« ${escapeHtml(item.heading)} »` : ""}${meta}</figcaption></figure>`;
      return `<figure class="card text"><blockquote>${escapeHtml(item.text)}</blockquote>${meta}</figure>`;
    })
    .join("\n");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Moodboard — Keys_Osi</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;padding:32px;background:#120f14;color:#f4efe6;font:15px/1.5 system-ui,sans-serif}
h1{font:400 40px/1 Georgia,serif;margin:0 0 24px;background:linear-gradient(110deg,#f5c76a,#ff7a59,#9b6bff);-webkit-background-clip:text;background-clip:text;color:transparent}
.board{columns:4 240px;column-gap:16px}
.card{break-inside:avoid;margin:0 0 16px;padding:12px;border-radius:16px;background:#1d1922;border:1px solid #ffffff14}
.card img{display:block;width:100%;border-radius:10px}
.swatch{height:120px;border-radius:10px}
.specimen{font-size:36px;line-height:1.1;padding:8px 0}
blockquote{margin:0;font:italic 18px/1.4 Georgia,serif}
.meta{margin:6px 0 0;color:#b8afc2;font-size:12px}
code{font:600 14px ui-monospace,monospace}
</style></head><body><h1>Moodboard</h1><div class="board">${cards}</div></body></html>`;
}

/** Files of the moodboard ZIP; remote images are downloaded into images/. */
export function buildMoodboardFiles(items) {
  const files = [];
  const prepared = items.map((item, index) => {
    if (item.kind !== "image" || !/^https?:/.test(item.url || "")) return item;
    const ext = (String(item.url).split("?")[0].match(/\.(png|jpe?g|webp|gif|avif|svg)$/i) || [".jpg", "jpg"])[1];
    const file = `images/${String(index + 1).padStart(3, "0")}.${ext.toLowerCase()}`;
    files.push({ path: file, url: item.url });
    return { ...item, file };
  });
  const sections = prepared.map((item, index) => {
    if (item.kind !== "section" || !String(item.image || "").startsWith("data:image/")) return item;
    const file = `captures/section-${String(index + 1).padStart(3, "0")}.jpg`;
    files.push({ path: file, base64: item.image.split(",")[1] });
    return { ...item, image: file };
  });
  files.unshift({ path: "MOODBOARD.md", content: moodboardMarkdown(sections) }, { path: "moodboard.html", content: moodboardHtml(sections) });
  return files;
}
