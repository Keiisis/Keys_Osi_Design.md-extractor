import { splitTokenValue } from "./generate-design-md.mjs";
import { callAI } from "./ai-client.mjs";

/**
 * Token intelligence — local analysis that turns a flat measured palette
 * into a structured design system:
 *  - groups colors into brand / neutral / semantic families
 *  - detects tonal ramps (e.g. a gray scale) and estimates the missing steps
 *  - proposes semantic names (color.brand.primary vs color.surface.raised)
 *
 * Optionally, an AI pass renames tokens meaningfully. Everything here is
 * deterministic and testable; the AI rename is a thin enhancement.
 */

function hexToHsl(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length < 6) return null;
  const R = parseInt(clean.slice(0, 2), 16);
  const G = parseInt(clean.slice(2, 4), 16);
  const B = parseInt(clean.slice(4, 6), 16);
  const r = R / 255;
  const g = G / 255;
  const b = B / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  // chroma = absolute channel spread (0-255); stable for near-white/black
  // grays where HSL saturation spikes misleadingly.
  return { h, s: Math.round(s * 100), l: Math.round(l * 100), chroma: Math.round(delta * 255) };
}

/**
 * Classifies each measured color and detects families and ramps.
 * @returns {{ colors, families, ramps }}
 */
export function analyzeColorSystem(normalized) {
  const rows = (normalized.colorPalette || [])
    .map((row) => {
      const { raw } = splitTokenValue(row.value);
      const hsl = /^#[0-9a-f]{6}$/i.test(raw) ? hexToHsl(raw) : null;
      return hsl ? { token: row.token, hex: raw.toLowerCase(), usage: row.usage || 0, ...hsl } : null;
    })
    .filter(Boolean);

  const colors = rows.map((c) => ({
    token: c.token,
    hex: c.hex,
    hsl: `hsl(${c.h}, ${c.s}%, ${c.l}%)`,
    role: classifyColor(c),
    usage: c.usage
  }));

  // Families by hue bucket; neutrals separated by low absolute chroma
  // (channel spread), which is stable near white/black.
  const families = {};
  for (const c of rows) {
    const family = isNeutral(c) ? "neutral" : hueFamily(c.h);
    if (!families[family]) families[family] = [];
    families[family].push({ hex: c.hex, l: c.l, token: c.token });
  }
  for (const key of Object.keys(families)) {
    families[key].sort((a, b) => b.l - a.l);
  }

  // Ramps: a family with 3+ steps spanning a lightness range is a scale.
  const ramps = [];
  for (const [family, members] of Object.entries(families)) {
    if (members.length >= 3) {
      const lightest = members[0].l;
      const darkest = members[members.length - 1].l;
      if (lightest - darkest >= 25) {
        ramps.push({
          family,
          steps: members.map((m) => m.hex),
          span: `${darkest}%–${lightest}%`,
          note: members.length < 5 ? "partial ramp — interpolate intermediate steps for a full scale" : "complete tonal ramp"
        });
      }
    }
  }

  return { colors, families, ramps };
}

function isNeutral(c) {
  return (c.chroma || 0) < 26;
}

function classifyColor({ s, l, chroma }) {
  if ((chroma || 0) < 26 || s < 12) {
    if (l >= 92) return "surface (near-white)";
    if (l <= 12) return "ink (near-black)";
    return l >= 55 ? "neutral (light)" : "neutral (dark)";
  }
  if (l >= 45 && l <= 65) return "brand/accent";
  return l > 65 ? "accent (light)" : "accent (deep)";
}

function hueFamily(h) {
  const bands = [
    [15, "red"], [45, "orange"], [70, "yellow"], [160, "green"],
    [200, "teal"], [255, "blue"], [290, "violet"], [335, "magenta"], [361, "red"]
  ];
  for (const [limit, name] of bands) {
    if (h < limit) return name;
  }
  return "neutral";
}

export function buildTokenSystemMarkdown(normalized) {
  const { colors, families, ramps } = analyzeColorSystem(normalized);
  if (colors.length === 0) return "";
  const lines = ["## Color System Intelligence", ""];
  lines.push("Measured colors classified by role:");
  for (const c of colors) {
    lines.push(`- \`${c.token}\` ${c.hex} / ${c.hsl} — ${c.role}`);
  }
  const familyNames = Object.keys(families);
  if (familyNames.length > 0) {
    lines.push("");
    lines.push(`Color families: ${familyNames.map((f) => `${f} (${families[f].length})`).join(", ")}.`);
  }
  for (const ramp of ramps) {
    lines.push(`- Tonal ramp (${ramp.family}, ${ramp.span}): ${ramp.steps.join(" → ")} — ${ramp.note}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * AI semantic renaming: proposes human-meaningful token names for the
 * measured palette, returned as a { oldToken: newName } map.
 */
export async function renameTokensWithAI({ normalized, settings, fetchImpl }) {
  const { colors } = analyzeColorSystem(normalized);
  const list = colors.map((c) => `${c.token} = ${c.hex} (${c.role})`).join("\n");
  const messages = [
    {
      role: "system",
      text: "You name design tokens. Given measured colors with their roles, propose concise semantic names (e.g. color.brand.primary, color.surface.base, color.text.muted, color.border.subtle). Output ONLY a JSON object mapping each original token to a new name. No prose."
    },
    { role: "user", text: `Site: ${normalized.source?.title || "?"}\n\n${list}` }
  ];
  const { content } = await callAI({
    provider: settings.provider,
    apiKey: settings.apiKey,
    model: settings.model,
    baseUrl: settings.baseUrl,
    messages,
    maxTokens: 1200,
    fetchImpl
  });
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("AI did not return a rename map.");
  }
  return JSON.parse(match[0]);
}
