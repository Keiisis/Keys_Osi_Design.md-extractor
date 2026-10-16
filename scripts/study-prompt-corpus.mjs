#!/usr/bin/env node
/**
 * Étude du corpus de prompts web qui calibre le playbook PROMPT_PRO (lib/prompt-pro-playbook.mjs).
 * Lit les trois sources de corpus/ (voir corpus/README.md), mesure la structure et le
 * vocabulaire, relève les valeurs médianes autour de chaque motif d'animation, et écrit
 * corpus/study.json (par source + combiné). Aucun prompt n'est recopié dans le playbook :
 * seules les mesures servent.
 *
 * Usage : node scripts/study-prompt-corpus.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = join(ROOT, "corpus");

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(name)) out.push(p);
  }
  return out;
}

/** Frontmatter YAML minimal : clés simples et listes « - "x" ». */
function frontmatter(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return {}; }
  const m = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r/g, ""));
  if (!m) return {};
  const data = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) { key = kv[1]; data[key] = kv[2] ? kv[2].replace(/^"|"$/g, "") : []; continue; }
    const item = /^\s+-\s+"?([^"]*)"?$/.exec(line);
    if (item && key && Array.isArray(data[key])) data[key].push(item[1]);
    const en = /^\s+en:\s*"?(.*?)"?$/.exec(line);
    if (en && key === "description") data.description = en[1];
  }
  return data;
}

const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const median = (xs) => quantile(xs, 0.5);
const pct = (n, total) => Math.round((n / total) * 100);

// Signaux mesurés (présence par prompt)
const SIGNALS = {
  tailwind: /tailwind|className="[^"]*\b(flex|grid|px-\d|text-(xs|sm|lg|xl))/i,
  react: /\breact\b|\.tsx\b|useState|useEffect/i,
  plainHtml: /single[- ]file|index\.html|vanilla (js|javascript)|no (framework|dependenc)/i,
  videoBackdrop: /<video|\.mp4|\.m3u8|video background|background video|autoPlay|autoplay/i,
  lucide: /lucide/i,
  glass: /backdrop-blur|backdrop-filter|glass/i,
  liquidGlass: /liquid[- ]?glass/i,
  stagger: /stagger/i,
  webgl3d: /three\.?js|@react-three|webgl|spline|\bglsl\b|shader/i,
  gsap: /\bgsap\b|scrolltrigger/i,
  framerMotion: /framer[- ]motion|motion\/react|from ['"]motion['"]/i,
  reducedMotion: /prefers-reduced-motion|useReducedMotion|reduced[- ]motion/i,
  ariaOrAlt: /aria-|alt=|focus-visible|sr-only/i,
  cursorInteraction: /mousemove|onMouseMove|pointermove|cursor[- ](follow|spotlight)|mouse[- ]scrub/i,
  typewriter: /typewriter|typing effect/i,
  marqueeTicker: /marquee|ticker|infinite (scroll|loop)/i,
  cssMask: /mask-image|-webkit-mask|mask:/i,
  videoSwitcher: /crossfade|video switcher|switch(es|ing)? between .*video|\d-video/i,
  wordReveal: /word[- ]by[- ]word|split.*word|per[- ]word|word reveal/i,
  countUp: /count[- ]?up|counter|animated number/i,
  parallax: /parallax/i,
  canvas2d: /<canvas|canvas\b(?!.*3d)/i,
  darkMode: /bg-black|#0{3,6}\b|dark (mode|theme)|pure black/i,
  // Precision traits shared by the exact-spec prompts (Mostar, Driftbar, Vesper, Planet Jumping, Ethan Vale)
  negativeScope: /\bdo (\*\*)?not(\*\*)? (add|use|invent|redesign|substitute|swap|rename|center|move|fade|wait)|\bno extra\b|\bnever (add|use|invent)/i,
  exactAssets: /exact (urls?|assets?)|use these (exact )?urls|only allowed sources|do not substitute|swap asset urls/i,
  exactDom: /dom (tree|structure|order)|source order|markup order|exact (ids|classes)|layer stack|bottom to top|back → front/i,
  acceptanceCheck: /acceptance|definition of done|you should see|checklist/i,
  backstop: /backstop|timeout|whichever first|autoplay (is|never) (blocked|starts)|animations? (fail|are not running)|on (any throw|error)/i
};

// Familles de polices citées (Google Fonts ou déclarations font-family)
function fonts(text) {
  const found = new Set();
  for (const m of text.matchAll(/family=([A-Za-z+]+)/g)) found.add(m[1].replace(/\+/g, " "));
  for (const m of text.matchAll(/['"]([A-Z][A-Za-z0-9 ]{2,30})['"]\s*,\s*(sans-serif|serif|monospace|cursive)/g)) found.add(m[1].trim());
  return [...found];
}

// Valeurs numériques relevées autour d'un motif (fenêtre de 500 caractères)
function numbersNear(text, re) {
  const res = { durations: [], blurs: [], staggers: [], scales: [] };
  for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
    const w = text.slice(Math.max(0, m.index - 250), m.index + 250);
    for (const d of w.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s)\b/g)) {
      const v = d[2] === "ms" ? Number(d[1]) / 1000 : Number(d[1]);
      if (v > 0 && v <= 20) res.durations.push(v);
    }
    for (const b of w.matchAll(/blur\(\s*(\d+(?:\.\d+)?)px/g)) res.blurs.push(Number(b[1]));
    for (const s of w.matchAll(/stagger[^0-9]{0,24}(\d+(?:\.\d+)?)\s*(ms|s)?/gi)) {
      const v = s[2] === "ms" || Number(s[1]) > 5 ? Number(s[1]) / 1000 : Number(s[1]);
      if (v > 0 && v < 2) res.staggers.push(v);
    }
    for (const sc of w.matchAll(/scale\(?\s*(0?\.\d+|1\.\d+)/g)) res.scales.push(Number(sc[1]));
  }
  return res;
}

const RECIPE_PATTERNS = {
  liquidGlass: /liquid[- ]?glass/,
  wordReveal: /word[- ]by[- ]word|word reveal|per[- ]word/,
  videoSwitcher: /crossfade|video switcher/,
  cssMask: /mask-image/,
  typewriter: /typewriter/,
  marqueeTicker: /marquee|ticker/,
  cursorInteraction: /mousemove|cursor|mouse[- ]scrub/,
  stagger: /stagger/,
  fadeUp: /fade[- ]?up|translateY|y: ?\d+/,
  scrollStage: /smoothstep|position: ?sticky/,
  loopCarousel: /clonenode|infinite (slider|carousel)/
};

// Sources : dossier, fichiers retenus, métadonnées (catégorie, tags, description)
const SOURCES = [
  {
    name: "awesome-web-prompts", label: "DexZane/awesome-web-prompts (MIT)", dir: join(CORPUS, "awesome-web-prompts", "prompts"),
    keep: (name) => name === "prompt.md",
    meta: (file, text, dir) => {
      const m = frontmatter(join(dirname(file), "README.md"));
      return { category: m.category || dirname(relative(dir, file)).split(/[\\/]/)[1], level: m.level, tags: m.tags || [], description: m.description || "" };
    }
  },
  {
    name: "winter-motionsites-prompts", label: "winter-motionsites-prompts (motionsites.ai, no license)", dir: join(CORPUS, "winter-motionsites-prompts", "prompts"),
    keep: (name) => name.endsWith(".md"),
    meta: (file, text) => ({ category: ((/Category:\*\*\s*(.+?)\s*$/m.exec(text) || [])[1] || "?").toLowerCase(), tags: [], description: (/^#\s+(.+)$/m.exec(text) || [])[1] || "" })
  },
  {
    name: "ajouts-manuels", label: "prompts added by the user", dir: join(CORPUS, "ajouts-manuels"),
    keep: (name) => name.endsWith(".md"),
    meta: (file, text) => ({ category: "manual", tags: [], description: (/^#\s+(.+)$/m.exec(text) || [])[1] || "" })
  }
];

const rows = SOURCES.flatMap((source) => {
  const files = walk(source.dir, source.keep);
  if (!files.length) throw new Error(`aucun prompt dans ${source.dir}`);
  return files.map((file) => {
    const text = readFileSync(file, "utf8");
    const signals = Object.fromEntries(Object.entries(SIGNALS).map(([k, re]) => [k, re.test(text)]));
    return { source: source.name, file: relative(CORPUS, file).replace(/\\/g, "/"), chars: text.length, ...source.meta(file, text, source.dir), signals, fonts: fonts(text), text };
  });
});

const tally = (list) => Object.entries(list.reduce((acc, x) => ((acc[x] = (acc[x] || 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);

function summarize(rows) {
  const n = rows.length;
  const count = (pred) => rows.filter(pred).length;
  const recipeEvidence = {};
  for (const [name, re] of Object.entries(RECIPE_PATTERNS)) {
    const agg = { prompts: 0, durations: [], blurs: [], staggers: [], scales: [] };
    for (const r of rows) {
      if (!re.test(r.text.toLowerCase())) continue;
      agg.prompts += 1;
      const v = numbersNear(r.text, re);
      for (const k of ["durations", "blurs", "staggers", "scales"]) agg[k].push(...v[k]);
    }
    recipeEvidence[name] = {
      prompts: agg.prompts,
      medianDurationS: median(agg.durations), p25DurationS: quantile(agg.durations, 0.25), p75DurationS: quantile(agg.durations, 0.75),
      medianBlurPx: median(agg.blurs), medianStaggerS: median(agg.staggers), medianScale: median(agg.scales), samples: agg.durations.length
    };
  }
  return {
    prompts: n,
    chars: { median: median(rows.map((r) => r.chars)), p90: quantile(rows.map((r) => r.chars), 0.9), min: Math.min(...rows.map((r) => r.chars)), max: Math.max(...rows.map((r) => r.chars)) },
    signalsPct: Object.fromEntries(Object.keys(SIGNALS).map((k) => [k, pct(count((r) => r.signals[k]), n)])),
    fonts: tally(rows.flatMap((r) => r.fonts)).slice(0, 15).map(([font, c]) => ({ font, pct: pct(c, n) })),
    recipeEvidence
  };
}

const study = {
  measuredAt: new Date().toISOString().slice(0, 10),
  sources: SOURCES.map((source) => {
    const own = rows.filter((r) => r.source === source.name);
    return { name: source.name, label: source.label, files: own.map((r) => r.file), ...summarize(own) };
  }),
  combined: {
    ...summarize(rows),
    // Same signals split by stack: does a vanilla prompt carry more precision than a React one?
    byStack: Object.fromEntries([
      ["vanilla", rows.filter((r) => r.signals.plainHtml && !r.signals.react)],
      ["react", rows.filter((r) => r.signals.react && !r.signals.plainHtml)]
    ].map(([name, subset]) => { const s = summarize(subset); return [name, { prompts: s.prompts, chars: s.chars, signalsPct: s.signalsPct }]; })),
    categories: tally(rows.map((r) => `${r.source}/${r.level ? r.level + "/" : ""}${r.category}`)),
    tags: tally(rows.flatMap((r) => r.tags)).slice(0, 30),
    byCategory: Object.fromEntries(tally(rows.map((r) => r.category)).map(([cat]) => [cat, rows.filter((r) => r.category === cat).map((r) => r.description).filter(Boolean)]))
  }
};

writeFileSync(join(CORPUS, "study.json"), JSON.stringify(study, null, 2) + "\n");
for (const s of [...study.sources, { name: "COMBINÉ", ...study.combined }]) {
  console.log(`\n== ${s.name} : ${s.prompts} prompts · médiane ${s.chars.median} car. (p90 ${s.chars.p90})`);
  console.log("signaux %", JSON.stringify(s.signalsPct));
  console.log("polices", s.fonts.slice(0, 6).map((f) => `${f.font} ${f.pct}%`).join(", "));
}
console.log("\nrecettes (combiné)", JSON.stringify(study.combined.recipeEvidence));
