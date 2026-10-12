/**
 * Keys_Osi accessibility fixer: finds the text/background pairs of an
 * extraction that fail WCAG contrast and proposes the smallest correction
 * that passes, moving only OKLCH lightness (hue and chroma are kept, so the
 * brand still looks like itself).
 */
import { contrastRatio, parseCssColor, rgbToHex } from "./color-science.mjs";
import { hexToOklch, oklchToHex } from "./brand-kit.mjs";

const toHex = (value) => {
  const parsed = parseCssColor(String(value || "").split(" ")[0]);
  return parsed && parsed.a > 0.5 ? rgbToHex(parsed) : null;
};

/** Every text-on-background pair the design actually uses. */
export function collectContrastPairs(normalized) {
  const palette = normalized?.colorPalette || [];
  const role = (token) => toHex(palette.find((row) => row.token === token)?.value);
  const pairs = [];
  const add = (fg, bg, required, source, label) => {
    if (!fg || !bg || fg === bg) return;
    if (pairs.some((pair) => pair.fg === fg && pair.bg === bg)) return;
    pairs.push({ fg, bg, required, source, label });
  };
  for (const surface of ["color.surface.base", "color.surface.muted", "color.surface.raised"]) {
    for (const text of ["color.text.primary", "color.text.secondary", "color.text.muted"]) {
      add(role(text), role(surface), 4.5, "tokens", `${text.replace("color.", "")} sur ${surface.replace("color.", "")}`);
    }
  }
  add(role("color.text.inverse"), role("color.surface.inverse"), 4.5, "tokens", "text.inverse sur surface.inverse");
  for (const variant of normalized?.buttonVariants || []) {
    add(toHex(variant.spec?.color), toHex(variant.spec?.background), 4.5, "button", `bouton ${variant.name || variant.kind || ""}`.trim());
  }
  if (normalized?.linkSpec?.color) add(toHex(normalized.linkSpec.color), role("color.surface.base"), 4.5, "link", "liens sur surface.base");
  for (const pair of normalized?.a11y?.worstPairs || []) {
    add(toHex(pair.foreground), toHex(pair.background), Number(pair.required) || 4.5, "page", pair.selector || "élément de la page");
  }
  return pairs.map((pair) => ({ ...pair, ratio: Math.round(contrastRatio(pair.fg, pair.bg) * 100) / 100 }));
}

/** Smallest lightness change of fg (same hue/chroma) reaching the ratio against bg. */
export function fixForeground(fg, bg, required) {
  const start = hexToOklch(fg);
  const target = required + 0.05;
  const tryDirection = (sign) => {
    for (let step = 0.005; step <= 1; step += 0.005) {
      const l = start.l + sign * step;
      if (l < 0 || l > 1) break;
      const hex = oklchToHex(l, start.c, start.h);
      const ratio = contrastRatio(hex, bg);
      if (ratio >= target) return { hex, ratio: Math.round(ratio * 100) / 100, deltaL: Math.round(step * 1000) / 1000 };
    }
    return null;
  };
  // Move away from the background's lightness first.
  const darker = hexToOklch(bg).l > start.l || hexToOklch(bg).l > 0.6;
  return tryDirection(darker ? -1 : 1) || tryDirection(darker ? 1 : -1);
}

export function planContrastFixes(normalized) {
  const pairs = collectContrastPairs(normalized).map((pair) => {
    const pass = pair.ratio >= pair.required;
    return { ...pair, pass, fix: pass ? null : fixForeground(pair.fg, pair.bg, pair.required) };
  });
  // One replacement per source color: the strictest fix wins when a color fails on several backgrounds.
  const replacements = new Map();
  for (const pair of pairs) {
    if (!pair.fix) continue;
    const current = replacements.get(pair.fg);
    if (!current || pair.fix.deltaL > current.deltaL) replacements.set(pair.fg, { to: pair.fix.hex, deltaL: pair.fix.deltaL });
  }
  const colorMap = [...replacements.entries()].map(([from, entry]) => ({ from, to: entry.to }));
  const variables = (normalized?.cssVariables || []).filter((variable) => replacements.has(toHex(variable.value)));
  const cssOverrides = [
    ":root {",
    ...variables.map((variable) => `  ${variable.name}: ${replacements.get(toHex(variable.value)).to}; /* was ${toHex(variable.value)} */`),
    "}",
    ...colorMap.map((entry) => `/* ${entry.from} → ${entry.to} */`)
  ].join("\n");
  return {
    pairs,
    failing: pairs.filter((pair) => !pair.pass).length,
    fixable: pairs.filter((pair) => pair.fix).length,
    colorMap,
    cssOverrides
  };
}

export function a11yFixMarkdown(plan, { title = "" } = {}) {
  const out = [`# A11Y_FIXES.md${title ? ` — ${title}` : ""}`, ""];
  out.push(`${plan.pairs.length} paires texte/fond vérifiées, ${plan.failing} sous le seuil WCAG AA, ${plan.fixable} corrigées en ne changeant que la luminosité (teinte et saturation conservées).`, "");
  out.push("| Usage | Texte | Fond | Contraste | Requis | Correction | Nouveau contraste |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const pair of plan.pairs) {
    out.push(`| ${pair.label.replace(/\|/g, "\\|")} | \`${pair.fg}\` | \`${pair.bg}\` | ${pair.ratio}:1 | ${pair.required}:1 | ${pair.pass ? "—" : pair.fix ? `\`${pair.fix.hex}\`` : "impossible"} | ${pair.pass ? "✓" : pair.fix ? `${pair.fix.ratio}:1 ✓` : "✗"} |`);
  }
  if (plan.colorMap.length) {
    out.push("", "## CSS à appliquer", "```css", plan.cssOverrides, "```");
  }
  return out.join("\n");
}
