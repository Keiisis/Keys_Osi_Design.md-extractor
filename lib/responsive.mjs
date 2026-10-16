/**
 * Keys_Osi responsive capture: the breakpoints a page declares in its CSS,
 * and what its layout does at each tested width (navigation, columns,
 * type sizes, container, elements shown or hidden, horizontal overflow).
 * Pure functions: responsive-probe.js measures the page, sw-responsive.mjs
 * drives the widths, these turn the measures into a report.
 */

export const RESPONSIVE_WIDTHS = [375, 768, 1024, 1440];

const MIN_BREAKPOINT = 200;
const MAX_BREAKPOINT = 3000;
const TAILWIND_SCREENS = [
  ["sm", 640],
  ["md", 768],
  ["lg", 1024],
  ["xl", 1280],
  ["2xl", 1536]
];

const toPx = (value, unit) => Number(value) * (unit.toLowerCase() === "px" ? 1 : 16);
// "(max-width: 767px)" and "(max-width: 767.98px)" both end the layout that starts at 768.
const afterMax = (px) => (Number.isInteger(px) ? px + 1 : Math.ceil(px));

/** Width breakpoints of one media query text, in CSS px (em/rem at 16px). */
export function breakpointsInMedia(text) {
  const source = String(text || "").toLowerCase();
  const found = [];
  const push = (px, kind) => {
    const value = Math.round(px);
    if (value >= MIN_BREAKPOINT && value <= MAX_BREAKPOINT) found.push({ px: value, kind });
  };
  for (const m of source.matchAll(/(min|max)-(?:device-)?width\s*:\s*(\d*\.?\d+)\s*(px|em|rem)/g)) {
    const px = toPx(m[2], m[3]);
    if (m[1] === "min") push(px, "min");
    else push(afterMax(px), "max");
  }
  // Media Queries level 4 ranges: (width >= 48rem), (40em <= width < 64em).
  for (const m of source.matchAll(/(?<![\w-])width\s*(>=|<=|>|<)\s*(\d*\.?\d+)\s*(px|em|rem)/g)) {
    const px = toPx(m[2], m[3]);
    if (m[1] === ">=") push(px, "min");
    else if (m[1] === ">") push(afterMax(px), "min");
    else if (m[1] === "<=") push(afterMax(px), "max");
    else push(px, "max");
  }
  for (const m of source.matchAll(/(\d*\.?\d+)\s*(px|em|rem)\s*(>=|<=|>|<)\s*width(?![\w-])/g)) {
    const px = toPx(m[1], m[2]);
    if (m[3] === "<=") push(px, "min");
    else if (m[3] === "<") push(afterMax(px), "min");
    else if (m[3] === ">=") push(afterMax(px), "max");
    else push(px, "max");
  }
  return found;
}

/**
 * Breakpoints declared across all media queries, merged when 2px apart or
 * less, with how many queries use each one. `primary` keeps the most used.
 */
export function parseBreakpoints(mediaTexts) {
  const byPx = new Map();
  for (const text of mediaTexts || []) {
    const seen = new Set();
    for (const { px, kind } of breakpointsInMedia(text)) {
      const key = `${px}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = byPx.get(px) || { px, count: 0, kinds: new Set() };
      entry.count += 1;
      entry.kinds.add(kind);
      byPx.set(px, entry);
    }
  }
  const sorted = [...byPx.values()].sort((a, b) => a.px - b.px);
  const merged = [];
  for (const entry of sorted) {
    const last = merged[merged.length - 1];
    if (last && entry.px - last.px <= 2) {
      // Keep the more used value of the two.
      if (entry.count > last.count) last.px = entry.px;
      last.count += entry.count;
      for (const kind of entry.kinds) last.kinds.add(kind);
    } else {
      merged.push({ ...entry, kinds: new Set(entry.kinds) });
    }
  }
  const all = merged.map((entry) => ({ px: entry.px, count: entry.count, kinds: [...entry.kinds].sort() }));
  const total = all.reduce((sum, entry) => sum + entry.count, 0);
  const primary = all
    .filter((entry) => entry.count >= Math.max(2, total * 0.05) || all.length <= 5)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .sort((a, b) => a.px - b.px);
  return { all, primary, queries: total };
}

/**
 * Tailwind screens that reproduce the site's own breakpoints: each primary
 * breakpoint between 480 and 1700px takes the nearest free Tailwind name.
 * Falls back to Tailwind's defaults when the CSS declares none.
 */
export function tailwindScreens(breakpoints) {
  const candidates = (breakpoints?.primary || []).map((entry) => entry.px).filter((px) => px >= 480 && px <= 1700);
  if (candidates.length === 0) return TAILWIND_SCREENS.slice(0, 4).map(([name, px]) => ({ name, px, fromSite: false }));
  const chosen = [...new Set(candidates)].sort((a, b) => a - b).slice(0, 5);
  const free = TAILWIND_SCREENS.map(([name, px]) => ({ name, px }));
  const result = [];
  for (const px of chosen) {
    // Names keep their order: a later breakpoint never takes an earlier name.
    const after = result.length ? free.findIndex((slot) => slot.name === result[result.length - 1].name) + 1 : 0;
    const options = free.slice(after);
    if (options.length === 0) break;
    const reserve = chosen.length - result.length - 1;
    const usable = options.slice(0, Math.max(1, options.length - reserve));
    const best = usable.reduce((a, b) => (Math.abs(b.px - px) < Math.abs(a.px - px) ? b : a));
    result.push({ name: best.name, px, fromSite: true });
  }
  return result;
}

const px = (value) => (value ? `${Math.round(value * 10) / 10}px` : "—");

const WORDS = {
  fr: { sep: " : ", quote: (t) => `« ${t} »`, noNav: "aucune navigation détectée", stacked: "liens empilés", menu: "bouton menu", link: "lien", links: "liens visibles", full: "pleine largeur", gutter: "marge", centered: "centré", nav: "Navigation", container: "Conteneur", col: "colonne", hidden: "masquée", shown: "affichée", appears: "Apparaît", disappears: "Disparaît", h1: "Titre h1", h2: "Titre h2", body: "Texte courant" },
  en: { sep: ": ", quote: (t) => `"${t}"`, noNav: "no navigation found", stacked: "stacked links", menu: "menu button", link: "link", links: "visible links", full: "full width", gutter: "gutter", centered: "centered", nav: "Navigation", container: "Container", col: "column", hidden: "hidden", shown: "shown", appears: "Appears", disappears: "Disappears", h1: "h1", h2: "h2", body: "Body text" }
};

export function navLabel(nav, lang = "fr") {
  const w = WORDS[lang];
  if (!nav || nav.mode === "none") return w.noNav;
  if (nav.mode === "stacked") return `${nav.links} ${w.stacked}`;
  if (nav.mode === "toggle") return `${w.menu}${nav.links ? ` + ${nav.links} ${w.link}${nav.links > 1 ? "s" : ""}` : ""}`;
  return `${nav.links} ${w.links}`;
}

export function containerLabel(container, lang = "fr") {
  const w = WORDS[lang];
  if (!container) return "—";
  if (!container.width) return `${w.full}, ${w.gutter} ${container.gutter ?? 0}px`;
  // A centered container: its side margins follow the viewport, only the width matters.
  return `${container.width}px ${w.centered}`;
}

/** One measured change between two widths, as a sentence. */
export function describeChange(change, lang = "fr") {
  const w = WORDS[lang];
  const columns = (n) => `${n} ${w.col}${n > 1 ? "s" : ""}`;
  switch (change.type) {
    case "nav":
      return `${w.nav}${w.sep}${navLabel(change.from, lang)} → ${navLabel(change.to, lang)}`;
    case "columns":
      if (!change.to) return `${w.quote(change.label)}${w.sep}${w.hidden}`;
      if (!change.from) return `${w.quote(change.label)}${w.sep}${w.shown}`;
      return `${w.quote(change.label)}${w.sep}${change.from} → ${columns(change.to)}`;
    case "type":
      return `${w[change.key]}${w.sep}${px(change.from)} → ${px(change.to)}`;
    case "container":
      return `${w.container}${w.sep}${containerLabel(change.from, lang)} → ${containerLabel(change.to, lang)}`;
    case "visibility":
      return `${change.shown ? w.appears : w.disappears}${w.sep}${change.label}`;
    default:
      return "";
  }
}

/**
 * Report from the probe's snapshots (one per width) and the cross-width
 * visibility list. Sections are matched across widths by their key.
 */
export function summarizeResponsive({ url = "", title = "", mediaTexts = [], snapshots = [], visibility = [] } = {}) {
  const breakpoints = parseBreakpoints(mediaTexts);
  const viewports = [...snapshots].sort((a, b) => a.width - b.width);
  const widths = viewports.map((vp) => vp.width);

  // One row per section key, columns per width.
  const sectionRows = new Map();
  viewports.forEach((vp, index) => {
    for (const section of vp.sections || []) {
      const row = sectionRows.get(section.key) || { key: section.key, label: section.label, order: section.order ?? 999, columns: widths.map(() => null) };
      row.columns[index] = section.columns;
      if (!row.label && section.label) row.label = section.label;
      row.order = Math.min(row.order, section.order ?? 999);
      sectionRows.set(section.key, row);
    }
  });
  const sections = [...sectionRows.values()].sort((a, b) => a.order - b.order);

  const transitions = [];
  for (let i = 0; i + 1 < viewports.length; i++) {
    const a = viewports[i];
    const b = viewports[i + 1];
    const changes = [];
    if ((a.nav?.mode || "none") !== (b.nav?.mode || "none")) changes.push({ type: "nav", from: a.nav, to: b.nav });
    for (const row of sections) {
      const before = row.columns[i];
      const after = row.columns[i + 1];
      // A section missing at one width only stopped being a top-level block:
      // real hiding is reported by the visibility list.
      if (before && after && before !== after) changes.push({ type: "columns", label: row.label, from: before, to: after });
    }
    for (const key of ["h1", "h2", "body"]) {
      const before = a.type?.[key]?.fontSize;
      const after = b.type?.[key]?.fontSize;
      if (before && after && Math.abs(before - after) >= 1) changes.push({ type: "type", key, from: before, to: after });
    }
    if (containerLabel(a.container) !== containerLabel(b.container) && (a.container?.width || b.container?.width)) {
      changes.push({ type: "container", from: a.container, to: b.container });
    }
    for (const item of visibility) {
      const shownBefore = item.visibleAt.includes(a.width);
      const shownAfter = item.visibleAt.includes(b.width);
      if (shownBefore !== shownAfter) changes.push({ type: "visibility", label: item.label, shown: shownAfter });
    }
    const inRange = breakpoints.all.filter((entry) => entry.px > a.width && entry.px <= b.width).map((entry) => entry.px);
    transitions.push({ from: a.width, to: b.width, breakpoints: inRange, changes });
  }

  // A size that moves at every width without matching a step reads as fluid type.
  const fluid = [];
  for (const key of ["h1", "h2"]) {
    const sizes = viewports.map((vp) => vp.type?.[key]?.fontSize).filter(Boolean);
    const distinct = new Set(sizes.map((size) => Math.round(size))).size;
    if (sizes.length >= 3 && distinct === sizes.length) fluid.push(key);
  }

  return {
    url,
    title,
    capturedAt: new Date().toISOString(),
    widths,
    breakpoints,
    screens: tailwindScreens(breakpoints),
    viewports: viewports.map((vp) => ({
      width: vp.width,
      layoutWidth: vp.layoutWidth || vp.width,
      height: vp.height,
      nav: vp.nav || null,
      container: vp.container || null,
      type: vp.type || {},
      overflow: vp.overflow || { px: 0, culprits: [] },
      pageHeight: vp.pageHeight || 0
    })),
    sections,
    transitions,
    visibility,
    fluid
  };
}

const typeCell = (entry) => (entry?.fontSize ? `${px(entry.fontSize)}${entry.lineHeight ? ` / ${px(entry.lineHeight)}` : ""}` : "—");

/** RESPONSIVE.md: written for a developer or an AI rebuilding the page. */
export function generateResponsiveMarkdown(summary, { withScreenshots = false } = {}) {
  if (!summary) return "";
  const lines = [];
  let host = summary.url;
  try {
    host = new URL(summary.url).hostname.replace(/^www\./, "");
  } catch (error) {}
  const cols = (cells) => `| ${cells.join(" | ")} |`;
  const head = summary.widths.map((w) => `${w}px`);
  lines.push(`# Responsive — ${host}`, "");
  lines.push(`Source: ${summary.url}`);
  lines.push(`Measured on ${summary.capturedAt.slice(0, 10)} at ${head.join(", ")} (emulated viewport, same page, same state).`, "");
  for (const vp of summary.viewports.filter((entry) => entry.layoutWidth !== entry.width)) {
    lines.push(`At ${vp.width}px the page lays out ${vp.layoutWidth}px wide: no \`<meta name="viewport">\`, phones zoom out. Add one in the rebuild.`, "");
  }

  lines.push("## Breakpoints declared in the CSS", "");
  if (summary.breakpoints.all.length === 0) {
    lines.push("No width media query found: the layout adapts without breakpoints (flex, grid auto-fit, clamp) or through JavaScript.", "");
  } else {
    lines.push(`${summary.breakpoints.queries} width media queries. Main breakpoints: ${summary.breakpoints.primary.map((entry) => `**${entry.px}px**`).join(", ")}.`, "");
    lines.push("| Width | Media queries | Direction |", "|---|---|---|");
    for (const entry of summary.breakpoints.all) {
      lines.push(`| ${entry.px}px | ${entry.count} | ${entry.kinds.map((kind) => (kind === "min" ? "min-width (mobile first)" : "max-width (desktop first)")).join(", ")} |`);
    }
    lines.push("");
  }

  lines.push("## Layout at each width", "");
  lines.push(cols(["", ...head]), `|---|${head.map(() => "---").join("|")}|`);
  lines.push(cols(["Navigation", ...summary.viewports.map((vp) => navLabel(vp.nav, "en"))]));
  lines.push(cols(["Container", ...summary.viewports.map((vp) => containerLabel(vp.container, "en"))]));
  lines.push(cols(["h1 (size / line height)", ...summary.viewports.map((vp) => typeCell(vp.type.h1))]));
  lines.push(cols(["h2", ...summary.viewports.map((vp) => typeCell(vp.type.h2))]));
  lines.push(cols(["Body text", ...summary.viewports.map((vp) => typeCell(vp.type.body))]));
  lines.push(cols(["Page height", ...summary.viewports.map((vp) => (vp.pageHeight ? `${vp.pageHeight}px` : "—"))]));
  lines.push("");

  const multi = summary.sections.filter((row) => row.columns.some((count) => count && count > 1));
  if (multi.length) {
    lines.push("## Columns per section", "");
    lines.push(cols(["Section", ...head]), `|---|${head.map(() => "---").join("|")}|`);
    for (const row of multi) lines.push(cols([row.label.replace(/\|/g, "/"), ...row.columns.map((count) => (count ? String(count) : "—"))]));
    lines.push("");
  }

  lines.push("## What changes from one width to the next", "");
  for (const step of summary.transitions) {
    const bps = step.breakpoints.length ? ` — CSS breakpoints in between: ${step.breakpoints.map((value) => `${value}px`).join(", ")}` : "";
    lines.push(`### ${step.from}px → ${step.to}px${bps}`, "");
    if (step.changes.length === 0) lines.push("- No structural change measured.");
    for (const change of step.changes) lines.push(`- ${describeChange(change, "en")}`);
    lines.push("");
  }
  if (summary.fluid.length) {
    lines.push(`Probably fluid type for ${summary.fluid.join(", ")}: the size changes at every tested width (clamp() or vw units).`, "");
  }

  const overflowing = summary.viewports.filter((vp) => vp.overflow?.px > 0);
  if (overflowing.length) {
    lines.push("## Horizontal overflow (bugs of the reference)", "");
    for (const vp of overflowing) {
      lines.push(`- **${vp.width}px**: the page is ${vp.overflow.px}px wider than the viewport. Elements past the edge: ${vp.overflow.culprits.join(", ") || "not identified"}. Do not reproduce.`);
    }
    lines.push("");
  }

  lines.push("## Rebuild rules", "");
  lines.push("- Write mobile first: base styles for 375px, then one min-width rule per breakpoint below.");
  lines.push(`- Equivalent Tailwind screens: ${summary.screens.map((screen) => `\`${screen.name}\` = ${screen.px}px`).join(", ")}${summary.screens.some((screen) => screen.fromSite) ? " (the site's own values)" : " (Tailwind defaults: the site declares none)"}.`);
  lines.push(`- Tailwind v4: \`@theme { ${summary.screens.map((screen) => `--breakpoint-${screen.name}: ${screen.px / 16}rem;`).join(" ")} }\``);
  lines.push(`- Check every line of "What changes" at the stated width${withScreenshots ? "; the first screen at each width is in `responsive/`" : ""}.`, "");
  return lines.join("\n");
}

/** Short block for PROMPT_PRO and DESIGN.md context. */
export function responsivePromptBlock(summary) {
  if (!summary) return "";
  const lines = [];
  lines.push(`Breakpoints (CSS): ${summary.breakpoints.primary.map((entry) => `${entry.px}px`).join(", ") || "none declared"}.`);
  for (const vp of summary.viewports) {
    lines.push(`${vp.width}px: nav ${navLabel(vp.nav, "en")}; container ${containerLabel(vp.container, "en")}; h1 ${typeCell(vp.type.h1)}; body ${typeCell(vp.type.body)}.`);
  }
  for (const step of summary.transitions) {
    if (step.changes.length) lines.push(`${step.from}→${step.to}px: ${step.changes.slice(0, 8).map((change) => describeChange(change, "en")).join("; ")}.`);
  }
  if (summary.fluid.length) lines.push(`Fluid type: ${summary.fluid.join(", ")}.`);
  return lines.join("\n");
}
