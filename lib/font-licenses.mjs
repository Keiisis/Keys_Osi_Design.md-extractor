/**
 * Font license intelligence — flags commercial/proprietary fonts in an
 * extraction and suggests free alternatives. Important for a
 * commercial product: it protects users from unknowingly shipping a
 * paid typeface they don't have a license for.
 *
 * Purely local, deterministic data — no network, no AI.
 */

// Known open-source / free-to-self-host families (won't be flagged).
const OPEN_FONTS = new Set(
  [
    "inter", "roboto", "open sans", "lato", "montserrat", "poppins", "raleway",
    "nunito", "work sans", "source sans", "source serif", "source code",
    "ibm plex", "space grotesk", "space mono", "dm sans", "dm serif", "dm mono",
    "manrope", "fraunces", "playfair display", "merriweather", "lora", "pt sans",
    "pt serif", "noto sans", "noto serif", "figtree", "outfit", "sora", "epilogue",
    "public sans", "libre franklin", "libre baskerville", "karla", "rubik",
    "jetbrains mono", "fira code", "fira sans", "cabin", "arvo", "bitter",
    "archivo", "red hat", "instrument sans", "instrument serif", "geist", "geist mono",
    "onest", "hanken grotesk", "schibsted grotesk", "unbounded", "bricolage grotesque"
  ].map((n) => n.toLowerCase())
);

// System / generic families — safe, not commercial.
const SYSTEM_FONTS = new Set(
  [
    "sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif",
    "ui-monospace", "-apple-system", "blinkmacsystemfont", "segoe ui", "arial",
    "helvetica", "times new roman", "georgia", "courier new", "verdana", "tahoma",
    "cursive", "fantasy", "emoji", "math", "webflow-icons"
  ].map((n) => n.toLowerCase())
);

// Known commercial families → a close free alternative.
const COMMERCIAL_ALTERNATIVES = [
  [/helvetica now|neue haas|akzidenz/i, "Inter or Manrope"],
  [/gt (walsheim|america|super|sectra|flexa)/i, "Space Grotesk or Hanken Grotesk"],
  [/söhne|sohne|monument|graphik|maison|circular/i, "Inter, Geist, or DM Sans"],
  [/founders grotesk|aktiv grotesk|neue montreal|pp neue/i, "Space Grotesk or Onest"],
  [/sohne|test söhne/i, "Inter"],
  [/tiempos|canela|ogg|reckless|editorial new/i, "Fraunces or Playfair Display"],
  [/suisse|neue world|basis grotesque/i, "Hanken Grotesk"],
  [/gilroy|proxima nova|brandon|gotham/i, "Poppins, Montserrat, or Figtree"],
  [/apercu|maax|calibre|styrene/i, "DM Sans or Onest"],
  [/sharp (grotesk|sans)|beausite|cirka/i, "Bricolage Grotesque or Sora"],
  [/salo|degular|obviously|migra/i, "Fraunces or Unbounded"]
];

function normalizeFamily(name) {
  return String(name || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    // Foundries often ship trial fonts with "TEST" / "Placeholder" in the name.
    .replace(/\b(test|trial|placeholder|web|var|variable)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classifies the fonts in a normalized extraction.
 * @returns {{ commercial: Array<{family, alternative}>, open: string[], system: string[] }}
 */
export function analyzeFontLicensing(normalized) {
  const families = new Set();
  const primary = normalized.mainFontStyle?.primaryFamily;
  if (primary) families.add(primary);
  for (const face of normalized.resources?.fontFaces || []) {
    if (face.family) families.add(face.family);
  }
  for (const heading of normalized.headings || []) {
    if (heading.fontFamily) families.add(heading.fontFamily);
  }
  if (normalized.mainFontStyle?.familyStack) {
    for (const part of normalized.mainFontStyle.familyStack.split(",")) {
      families.add(part);
    }
  }

  const commercial = [];
  const open = [];
  const system = [];
  const seen = new Set();

  for (const rawFamily of families) {
    const family = normalizeFamily(rawFamily);
    const key = family.toLowerCase();
    if (!family || seen.has(key)) continue;
    seen.add(key);

    if (SYSTEM_FONTS.has(key)) {
      system.push(family);
    } else if (OPEN_FONTS.has(key) || [...OPEN_FONTS].some((f) => key.startsWith(f))) {
      open.push(family);
    } else {
      const match = COMMERCIAL_ALTERNATIVES.find(([pattern]) => pattern.test(family));
      commercial.push({
        family,
        alternative: match ? match[1] : "Inter, Manrope, or a Google Fonts equivalent"
      });
    }
  }

  return { commercial, open, system };
}

export function buildFontLicenseMarkdown(normalized) {
  const { commercial, open } = analyzeFontLicensing(normalized);
  if (commercial.length === 0 && open.length === 0) return "";
  const lines = [];
  if (commercial.length > 0) {
    lines.push(
      `- ⚠️ Likely commercial fonts (verify your license before shipping): ${commercial.map((c) => `\`${c.family}\` → free alternative: ${c.alternative}`).join("; ")}`
    );
  }
  if (open.length > 0) {
    lines.push(`- Free / self-hostable fonts detected: ${open.map((f) => `\`${f}\``).join(", ")}`);
  }
  return lines.join("\n");
}
