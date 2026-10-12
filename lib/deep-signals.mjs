/**
 * Interprets the raw result of deep-probe.js.
 *
 *  - summarizeDeepSignals(probe)       → compact, normalized summary
 *  - generateDeepSignalsMarkdown(sum)  → extra DESIGN.md sections, written
 *                                         as rebuild instructions for an AI
 *                                         coding agent
 *  - deepSignalsPromptBlock(sum)       → a few dense lines for an AI prompt
 *
 * Pure functions (no DOM): runs in the MV3 service worker and in Node.
 * The probe only measures; every judgement (language, formality, photo vs
 * illustration, icon library, z-index layers…) is made here so it can be
 * unit-tested without a browser.
 */

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

const toHex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** "rgb(15, 44, 86)" → "#0f2c56"; keeps alpha as #rrggbbaa; other values unchanged. */
export function cssColorToHex(value) {
  const text = String(value || "").trim();
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(text);
  if (!m) return /^#[0-9a-f]{3,8}$/i.test(text) ? text.toLowerCase() : text;
  let alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!Number.isFinite(alpha)) alpha = 1;
  const hex = `#${toHex2(+m[1])}${toHex2(+m[2])}${toHex2(+m[3])}`;
  return alpha >= 1 ? hex : `${hex}${toHex2(alpha * 255)}`;
}

/** Replaces every rgb()/rgba() inside a declaration value by its hex form. */
function hexifyValue(value) {
  return String(value || "").replace(/rgba?\([^)]*\)/gi, (match) => cssColorToHex(match));
}

const countBy = (items, keyFn) => {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key === null || key === undefined || key === "") continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ *
 * Voice & tone
 * ------------------------------------------------------------------ */

const STOPWORDS = {
  en: ["the", "and", "you", "your", "with", "for", "our", "we", "to", "of", "is", "are", "this", "that", "it", "in"],
  fr: ["le", "la", "les", "des", "et", "vous", "votre", "nous", "notre", "pour", "avec", "une", "est", "du", "au", "dans"],
  es: ["el", "los", "las", "y", "para", "con", "nuestro", "usted", "una", "es", "del", "que", "por", "en"],
  de: ["der", "die", "das", "und", "mit", "für", "wir", "unsere", "ist", "ein", "eine", "nicht", "zu", "auf"],
  it: ["il", "gli", "della", "e", "per", "con", "nostro", "una", "è", "che", "del", "sono", "di", "le"],
  pt: ["o", "os", "as", "e", "para", "com", "nosso", "uma", "é", "que", "do", "da", "você", "em"],
  nl: ["de", "het", "en", "voor", "met", "onze", "wij", "een", "is", "van", "jouw", "uw", "je", "op"]
};

// Word lists become regexes with Unicode-aware boundaries: \b is ASCII-only
// and misfires around accented letters ("à", "você", "nós").
const words = (list, flags = "giu") =>
  new RegExp(`(?<![\\p{L}\\p{N}'])(?:${list.join("|")})(?![\\p{L}\\p{N}])`, flags);

// Formal / informal address per language. German and Italian formal forms
// are capitalised, so those patterns are case-sensitive.
const ADDRESS = {
  fr: { formal: words(["vous", "votre", "vos"]), informal: words(["tu", "ton", "ta", "tes", "toi"]) },
  de: { formal: words(["Sie", "Ihr", "Ihre", "Ihnen", "Ihrem", "Ihren"], "gu"), informal: words(["du", "dein", "deine", "dich", "dir", "deinen"]) },
  es: { formal: words(["usted", "ustedes"]), informal: words(["tú", "tus", "contigo"]) },
  it: { formal: words(["Lei", "Suo", "Sua", "Suoi"], "gu"), informal: words(["tu", "tuo", "tua", "tuoi", "ti"]) },
  nl: { formal: words(["u", "uw"]), informal: words(["je", "jij", "jouw", "jou"]) },
  pt: { formal: words(["o senhor", "a senhora"]), informal: words(["tu", "teu", "tua", "teus"]) }
};
const WE_WORDS = {
  en: words(["we", "our", "ours", "us"]), fr: words(["nous", "notre", "nos"]),
  es: words(["nosotros", "nuestro", "nuestra", "nuestros", "nuestras"]), de: words(["wir", "unser", "unsere", "unseren", "uns"]),
  it: words(["noi", "nostro", "nostra", "nostri"]), pt: words(["nós", "nosso", "nossa", "nossos"]), nl: words(["wij", "we", "ons", "onze"])
};
const YOU_WORDS = {
  en: words(["you", "your", "yours"]), fr: words(["vous", "votre", "vos", "tu", "ton", "ta", "tes"]),
  es: words(["usted", "ustedes", "tú", "tus"]), de: words(["Sie", "Ihr", "Ihre", "Ihnen", "du", "dein", "deine"], "gu"),
  it: words(["tu", "tuo", "tua", "voi", "vostro", "vostra"]), pt: words(["você", "vocês", "seu", "sua", "tu"]),
  nl: words(["u", "uw", "je", "jij", "jouw"])
};
const EN_VERBS = new Set([
  "get", "start", "try", "build", "create", "ship", "deploy", "launch", "learn", "read", "buy", "shop", "explore",
  "discover", "join", "sign", "subscribe", "book", "download", "install", "contact", "talk", "request", "view", "see",
  "watch", "meet", "order", "reserve", "find", "browse", "add", "continue", "send", "submit", "register", "apply",
  "schedule", "upgrade", "claim", "save", "compare", "choose", "go", "make", "play", "open", "call", "chat", "email",
  "follow", "check", "enter", "donate", "visit", "reach", "unlock", "grab", "plan", "share", "let's", "show"
]);
const FIRST_PERSON = /\b(my|mon|ma|mes|mein|meine|meinen|mi|mis|mio|mia|meu|minha|mijn)\b/i;
const TONE_MARKERS = {
  friendly: /\b(hey|hi|welcome|thanks|love|enjoy|happy|easy|together|friends?|bienvenue|plaisir|merci|ensemble|chaleureu\w*|convivia\w*|volontiers|partag\w*|accueil\w*|genereu\w*|généreu\w*)\b/giu,
  formal: /\b(enterprise|solutions?|leverage|empower|facilitate|utili[sz]e|comprehensive|compliance|stakeholders?|entreprise|accompagnement|expertise|optimiser|garantir|conformité)\b/giu,
  technical: /\b(api|sdk|webhooks?|latency|cli|runtime|schema|endpoints?|typescript|kubernetes|deploy\w*|integrations?|open[- ]source|github|docs)\b/giu,
  playful: /\b(wow|magic\w*|boom|yay|fun|oops|ta-da|awesome|génial|magique|youpi)\b/giu,
  premium: /\b(crafted|exclusive|bespoke|luxury|timeless|artisan\w*|heritage|curated|signature|elegan\w*|savoir-faire|exception\w*|raffiné\w*|élégan\w*|gastronomi\w*|prestige|sélection\w*|chef)\b/giu
};
const TONE_ADJECTIVE = { friendly: "warm", formal: "corporate", technical: "technical", playful: "playful", premium: "refined" };
const EMOJI = /\p{Extended_Pictographic}/gu;

function detectLanguage(text, declared) {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) || [];
  const scores = {};
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    scores[lang] = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const declaredBase = String(declared || "").toLowerCase().split(/[-_]/)[0];
  const detected = ranked[0] && ranked[0][1] >= 3 ? ranked[0][0] : declaredBase || "en";
  return { detected, declared: declaredBase, mismatch: !!declaredBase && STOPWORDS[declaredBase] !== undefined && declaredBase !== detected };
}

function ctaStyleOf(text, lang) {
  const trimmed = String(text).trim();
  const words = trimmed.split(/\s+/);
  const first = (words[0] || "").toLowerCase().replace(/[^\p{L}']/gu, "");
  const last = (words[words.length - 1] || "").toLowerCase();
  if (trimmed.endsWith("?")) return { style: "question", verb: "" };
  if (FIRST_PERSON.test(trimmed)) return { style: "first-person", verb: first };
  if (lang === "fr") {
    if (/(ez|ons)$/.test(first) && first.length > 3) return { style: "imperative", verb: first };
    if (/(er|ir|re|oir)$/.test(first) && first.length > 3) return { style: "infinitive", verb: first };
  } else if (lang === "de" || lang === "nl") {
    if (/en$/.test(last) && words.length > 1) return { style: "infinitive", verb: last };
    if (/en$/.test(first) && words.length === 1) return { style: "infinitive", verb: first };
  } else if (lang === "es" || lang === "pt") {
    if (/(ar|er|ir)$/.test(first) && first.length > 3) return { style: "infinitive", verb: first };
  } else if (lang === "it") {
    if (/(are|ere|ire)$/.test(first)) return { style: "infinitive", verb: first };
  }
  if (EN_VERBS.has(first)) return { style: "imperative", verb: first };
  return { style: "noun-phrase", verb: "" };
}

function headingCaseOf(heading) {
  if (heading.transform === "uppercase") return "UPPERCASE (CSS)";
  if (heading.transform === "lowercase") return "lowercase (CSS)";
  if (heading.transform === "capitalize") return "Title Case (CSS)";
  const text = heading.text;
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length > 2 && letters === letters.toUpperCase()) return "UPPERCASE";
  if (letters === letters.toLowerCase()) return "lowercase";
  const words = text.split(/\s+/).slice(1).filter((w) => w.replace(/[^\p{L}]/gu, "").length >= 4);
  if (!words.length) return "Sentence case";
  const capped = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  return capped / words.length > 0.6 ? "Title Case" : "Sentence case";
}

function casingOfLabel(text) {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return "UPPERCASE";
  const words = text.split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, "").length >= 3);
  if (words.length > 1 && words.every((w) => /^\p{Lu}/u.test(w))) return "Title Case";
  return /^\p{Lu}/u.test(text) ? "Sentence case" : "lowercase";
}

function summarizeVoice(copy = {}, declaredLang = "") {
  const headings = Array.isArray(copy.headings) ? copy.headings : [];
  const ctas = Array.isArray(copy.ctas) ? copy.ctas : [];
  const paragraphs = Array.isArray(copy.paragraphs) ? copy.paragraphs : [];
  const all = [...headings.map((h) => h.text), ...ctas.map((c) => c.text), ...paragraphs].join(" \n ");
  const wordCount = (all.match(/[\p{L}']+/gu) || []).length;
  if (wordCount < 8) return null;

  const language = detectLanguage(all, declaredLang);
  const lang = language.detected;

  // Address formality: explicit T/V forms first, English falls back on
  // contractions and register markers.
  const address = ADDRESS[lang];
  let formal = 0;
  let informal = 0;
  if (address) {
    formal = (all.match(address.formal) || []).length;
    informal = (all.match(address.informal) || []).length;
  } else {
    informal = (all.match(/\b\w+'(re|ll|ve|t|d|m)\b|\b(let's|hey|gonna|awesome|super)\b/gi) || []).length;
    formal = (all.match(/\b(enterprise|leverage|solutions?|comprehensive|facilitate|utili[sz]e|ensure|hereby|pursuant)\b/gi) || []).length;
  }
  const formality = formal > informal * 1.5 && formal > 0 ? "formal" : informal > formal * 1.5 && informal > 0 ? "informal" : "neutral";
  const addressForm = lang === "fr" ? (formality === "formal" ? "vous" : formality === "informal" ? "tu" : "")
    : lang === "de" ? (formality === "formal" ? "Sie" : formality === "informal" ? "du" : "")
    : lang === "es" ? (formality === "formal" ? "usted" : formality === "informal" ? "tú" : "")
    : "";

  const we = (all.match(WE_WORDS[lang] || WE_WORDS.en) || []).length;
  const you = (all.match(YOU_WORDS[lang] || YOU_WORDS.en) || []).length;
  const person = we > 0 && you > 0 ? "we-to-you" : you > 0 ? "you-focused" : we > 0 ? "we-focused" : "impersonal";

  // Sentences.
  const sentences = paragraphs
    .flatMap((p) => p.split(/(?<=[.!?…])\s+/))
    .map((s) => s.trim())
    .filter((s) => (s.match(/[\p{L}']+/gu) || []).length >= 3);
  const sentenceWords = sentences.map((s) => (s.match(/[\p{L}']+/gu) || []).length);
  const avgSentenceWords = sentenceWords.length ? round(sentenceWords.reduce((a, b) => a + b, 0) / sentenceWords.length) : 0;
  const sentenceLength = !sentenceWords.length ? "unknown" : avgSentenceWords <= 12 ? "short" : avgSentenceWords <= 20 ? "medium" : "long";
  const exclamations = (paragraphs.join(" ").match(/!/g) || []).length;
  const emojiList = all.match(EMOJI) || [];
  const emojiRate = sentences.length ? emojiList.length / sentences.length : emojiList.length;
  const emoji = emojiList.length === 0 ? "none" : emojiRate < 0.34 ? "rare" : "frequent";

  // CTAs.
  const styled = ctas.map((c) => ({ ...c, ...ctaStyleOf(c.text, lang) }));
  const styleTally = new Map();
  const verbTally = new Map();
  for (const c of styled) {
    styleTally.set(c.style, (styleTally.get(c.style) || 0) + c.count);
    if (c.verb) verbTally.set(c.verb, (verbTally.get(c.verb) || 0) + c.count);
  }
  const ctaStyle = [...styleTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
  const ctaVerbs = [...verbTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([verb, count]) => ({ verb, count }));
  const ctaCasing = countBy(ctas, (c) => casingOfLabel(c.text))[0]?.[0] || "unknown";
  const ctaWords = ctas.length ? round(ctas.reduce((n, c) => n + c.text.split(/\s+/).length, 0) / ctas.length) : 0;

  // Headings.
  const caseTally = countBy(headings, headingCaseOf);
  const headingCase = caseTally[0]?.[0] || "unknown";
  const cssTransforms = headings.filter((h) => h.transform && h.transform !== "none").map((h) => `${h.level}: ${h.transform}`);
  const headingWords = headings.length ? round(headings.reduce((n, h) => n + h.text.split(/\s+/).length, 0) / headings.length) : 0;

  // Tone and the adjectives an agent should write with.
  const toneScores = {};
  for (const [tone, re] of Object.entries(TONE_MARKERS)) toneScores[tone] = (all.match(re) || []).length;
  toneScores.playful += Math.min(4, exclamations) + (emoji === "frequent" ? 3 : 0);
  const toneRanked = Object.entries(toneScores).sort((a, b) => b[1] - a[1]);
  const toneTotal = toneRanked.reduce((n, [, v]) => n + v, 0);
  const tone = toneTotal && toneRanked[0][1] / toneTotal > 0.35 ? toneRanked[0][0] : "balanced";
  const secondaryTone = toneRanked[1] && toneRanked[1][1] > 0 && tone !== "balanced" ? toneRanked[1][0] : "";
  const adjectives = [
    TONE_ADJECTIVE[tone],
    TONE_ADJECTIVE[secondaryTone],
    formality === "formal" ? "courteous" : formality === "informal" ? "casual" : "",
    person === "we-to-you" ? "personal" : person === "you-focused" ? "customer-centred" : person === "impersonal" ? "matter-of-fact" : "",
    sentenceLength === "short" ? "concise" : sentenceLength === "long" ? "explanatory" : sentenceLength === "medium" ? "measured" : "",
    emoji === "frequent" || exclamations > sentences.length / 3 ? "expressive" : ""
  ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);

  return {
    language: language.detected,
    declaredLanguage: language.declared,
    languageMismatch: language.mismatch,
    formality,
    addressForm,
    addressEvidence: { formal, informal },
    person,
    personEvidence: { we, you },
    tone,
    secondaryTone,
    toneScores,
    adjectives,
    sentences: { count: sentences.length, avgWords: avgSentenceWords, length: sentenceLength, exclamations },
    emoji: { level: emoji, count: emojiList.length, used: [...new Set(emojiList)].slice(0, 6) },
    cta: {
      style: ctaStyle,
      casing: ctaCasing,
      avgWords: ctaWords,
      verbs: ctaVerbs,
      examples: ctas.slice(0, 6).map((c) => c.text)
    },
    headings: {
      case: headingCase,
      cssTransforms,
      avgWords: headingWords,
      examples: headings.slice(0, 5).map((h) => h.text)
    },
    wordCount
  };
}

/* ------------------------------------------------------------------ *
 * Imagery + background patterns
 * ------------------------------------------------------------------ */

const ASPECTS = [["1:1", 1], ["4:3", 4 / 3], ["3:2", 1.5], ["16:10", 1.6], ["16:9", 16 / 9], ["21:9", 21 / 9], ["3:4", 0.75], ["2:3", 2 / 3], ["9:16", 9 / 16], ["4:5", 0.8]];
const aspectOf = (w, h) => {
  if (!w || !h) return "";
  const r = w / h;
  let best = ASPECTS[0];
  for (const a of ASPECTS) if (Math.abs(Math.log(r / a[1])) < Math.abs(Math.log(r / best[1]))) best = a;
  return Math.abs(Math.log(r / best[1])) < 0.08 ? best[0] : `${round(r, 2)}:1`;
};

export function classifyImage(img) {
  const src = String(img.src || "").toLowerCase();
  const maxSide = Math.max(img.w || 0, img.h || 0);
  if (maxSide < 48) return "icon";
  if (/(^|[\/_.-])(3d|render|blender|isometric|c4d|spline)([\/_.-]|$)|\.glb/.test(src)) return "3d-render";
  if (/screenshot|screen-shot|dashboard|(^|[\/_-])ui[-_]|app-preview|mockup/.test(src)) return "screenshot";
  if (/illustration|illustr|drawing|mascot|character/.test(src)) return "illustration";
  if (img.px) {
    if (img.px.unique >= 28 && img.px.flat <= 0.45) return "photo";
    if (img.px.unique <= 20 || img.px.flat >= 0.6) return img.fmt === "png" && img.px.sat < 0.15 && maxSide >= 400 ? "screenshot" : "illustration";
  }
  if (img.fmt === "svg") return "illustration";
  if (/^(jpg|webp|avif|jxl)$/.test(img.fmt) && maxSide >= 160) return "photo";
  if (/photo|portrait|team|headshot|hero/.test(src)) return "photo";
  return "unknown";
}

function summarizeImagery(imagery = {}, backgrounds = {}) {
  const images = (Array.isArray(imagery.images) ? imagery.images : []).filter((img) => !img.header);
  const kinds = images.map((img) => ({ ...img, kind: classifyImage(img) }));
  const content = kinds.filter((img) => img.kind !== "icon");
  const kindTally = countBy(content, (img) => img.kind);
  const known = kindTally.filter(([kind]) => kind !== "unknown");
  const knownTotal = known.reduce((n, [, c]) => n + c, 0);
  const LABEL = { photo: "photography", illustration: "illustration", "3d-render": "3d-render", screenshot: "product-screenshots" };
  let dominant = "none";
  if (known.length) dominant = known[0][1] / knownTotal >= 0.6 ? LABEL[known[0][0]] : "mixed";
  else if (content.length) dominant = "unknown";
  const media = imagery.media || {};
  if (dominant === "none" && (media.canvases || media.modelViewers)) dominant = "3d-render";

  // Circles (avatars) are reported apart; the corner style is decided on
  // the remaining rectangular images.
  const radii = content.map((img) => img.radius);
  const circles = radii.filter((r) => r === "circle").length;
  const numeric = radii.filter((r) => typeof r === "number");
  const radiusMode = countBy(numeric.filter((r) => r > 0), (r) => r)[0];
  const rounded = numeric.filter((r) => r > 0).length;
  const corners = !content.length ? "none"
    : !numeric.length ? "circular"
    : rounded >= numeric.length / 2 ? `rounded ${radiusMode[0]}px`
    : "square";

  const filters = countBy(content.filter((img) => img.filter), (img) => img.filter).map(([value, count]) => ({ value, count }));
  const blends = countBy(content.filter((img) => img.blend), (img) => img.blend).map(([value, count]) => ({ value, count }));
  const duotone = blends.some((b) => /multiply|screen|color|luminosity/.test(b.value)) || filters.some((f) => /url\(/.test(f.value));

  const bgCounts = backgrounds.counts || {};
  const patterns = [];
  if (bgCounts.dotGrid) patterns.push("dot-grid");
  if (bgCounts.lineGrid) patterns.push("line-grid");
  if (bgCounts.mesh) patterns.push("gradient-mesh");
  if (bgCounts.noise) patterns.push("noise");
  if (bgCounts.svgPattern) patterns.push("svg-pattern");
  if (bgCounts.glass) patterns.push("glass (backdrop blur)");

  return {
    dominant,
    counts: Object.fromEntries(kindTally),
    total: content.length,
    aspectRatios: countBy(content, (img) => aspectOf(img.w, img.h)).slice(0, 4).map(([ratio, count]) => ({ ratio, count })),
    corners,
    circles,
    radiusPx: radiusMode ? radiusMode[0] : 0,
    clipPaths: content.filter((img) => img.clip).length,
    masks: content.filter((img) => img.mask).length,
    clipSamples: [...new Set(content.filter((img) => img.clip).map((img) => img.clip))].slice(0, 2),
    filters,
    blends,
    duotone,
    objectFitCover: content.filter((img) => img.fit === "cover").length,
    formats: countBy(content, (img) => img.fmt).map(([fmt, count]) => ({ fmt, count })),
    media: {
      videos: media.videos || 0,
      canvases: media.canvases || 0,
      modelViewers: media.modelViewers || 0,
      largeSvgs: media.largeSvgs || 0,
      responsiveSources: media.pictureSources || 0,
      lazy: media.lazy || 0,
      backgroundImages: Array.isArray(imagery.backgrounds) ? imagery.backgrounds.length : 0
    },
    patterns,
    patternSamples: (backgrounds.samples || []).slice(0, 6).map((s) => ({ kind: s.kind, value: hexifyValue(s.value), size: s.size || "" })),
    altCoverage: content.length ? round(content.filter((img) => img.alt).length / content.length, 2) : 1
  };
}

/* ------------------------------------------------------------------ *
 * Icons
 * ------------------------------------------------------------------ */

const ICON_LIBRARIES = [
  { id: "lucide", test: (i) => /\blucide\b/.test(i.cls) || /data-lucide/.test(i.attrs) },
  { id: "feather", test: (i) => /\bfeather\b/.test(i.cls) || /data-feather/.test(i.attrs) },
  { id: "tabler", test: (i) => /icon-tabler/.test(i.cls) },
  { id: "font-awesome", test: (i) => /svg-inline--fa|\bfa-/.test(i.cls) || /data-prefix=fa/.test(i.attrs) },
  { id: "phosphor", test: (i) => /\bph(-[\w-]+)?\b/.test(i.cls) || i.viewBox === "0 0 256 256" },
  { id: "bootstrap-icons", test: (i) => /\bbi(-[\w-]+)?\b/.test(i.cls) },
  { id: "ionicons", test: (i) => /\bionicon\b/.test(i.cls) || i.viewBox === "0 0 512 512" },
  { id: "heroicons", test: (i) => /data-slot=icon/.test(i.attrs) && /^0 0 (24 24|20 20|16 16)$/.test(i.viewBox) },
  { id: "material-symbols", test: (i) => /material-(icons|symbols)/.test(i.cls) },
  { id: "iconify", test: (i) => /\biconify\b/.test(i.cls) }
];
const FONT_LIBRARIES = [
  ["font-awesome", /font ?awesome/i],
  ["material-symbols", /material (icons|symbols)/i],
  ["bootstrap-icons", /bootstrap-icons/i],
  ["remix-icon", /remixicon/i],
  ["ionicons", /ionicons/i],
  ["tabler", /tabler/i],
  ["line-awesome", /line ?awesome/i],
  ["unicons", /unicons/i]
];

function summarizeIcons(icons = {}) {
  const svg = Array.isArray(icons.svg) ? icons.svg : [];
  const fonts = Array.isArray(icons.fonts) ? icons.fonts : [];
  const svgCount = icons.svgCount || svg.length;
  const fontCount = icons.fontCount || 0;
  const imgCount = icons.imgIcons || 0;
  const total = svgCount + fontCount + imgCount;
  if (!total) return null;

  const systems = [["inline-svg", svgCount], ["icon-font", fontCount], ["img", imgCount]].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const sprite = icons.spriteUses > 0 && icons.spriteUses >= svgCount / 2;

  // Library: explicit class/attribute fingerprints beat geometry.
  const libTally = new Map();
  for (const icon of svg) {
    const hit = ICON_LIBRARIES.find((lib) => lib.test({ cls: icon.cls || "", attrs: icon.attrs || "", viewBox: icon.viewBox || "" }));
    if (hit) libTally.set(hit.id, (libTally.get(hit.id) || 0) + 1);
  }
  for (const font of fonts) {
    const hit = FONT_LIBRARIES.find(([, re]) => re.test(font.family) || re.test(font.sample || ""));
    if (hit) libTally.set(hit[0], (libTally.get(hit[0]) || 0) + font.count);
  }
  const styleTally = countBy(svg, (i) => i.style).filter(([s]) => s !== "unknown");
  const style = styleTally[0]?.[0] || (fontCount ? "fill" : "unknown");
  const widths = countBy(svg.filter((i) => i.strokeWidth > 0), (i) => i.strokeWidth);
  const strokeWidth = widths[0] ? widths[0][0] : 0;
  const grid = countBy(svg, (i) => {
    const parts = String(i.viewBox || "").trim().split(/[\s,]+/).map(Number);
    return parts.length === 4 && parts[2] === parts[3] ? parts[2] : null;
  })[0]?.[0] || 0;
  const roundCaps = svg.length ? svg.filter((i) => i.roundCaps).length / svg.length > 0.5 : false;

  let library = "";
  let confidence = 0;
  const libRanked = [...libTally.entries()].sort((a, b) => b[1] - a[1]);
  if (libRanked.length) {
    library = libRanked[0][0];
    confidence = round(Math.min(1, libRanked[0][1] / Math.max(1, Math.min(total, svg.length + fontCount))), 2);
  } else if (style === "stroke" && grid === 24) {
    // Geometry fallback. Lucide/Feather/Tabler draw at stroke 2 with round
    // caps on a 24 grid; Heroicons outline uses 1.5.
    if (strokeWidth >= 1.75 && roundCaps) { library = "lucide-compatible (stroke 2, round caps)"; confidence = 0.5; }
    else if (strokeWidth > 1.25 && strokeWidth < 1.75) { library = "heroicons-outline-compatible (stroke 1.5)"; confidence = 0.45; }
  } else if (style === "fill" && grid === 24) {
    library = "material/heroicons-solid-compatible (filled, 24 grid)"; confidence = 0.35;
  } else if (style === "fill" && grid === 20) {
    library = "heroicons-mini-compatible (filled, 20 grid)"; confidence = 0.35;
  } else if (style === "fill" && grid === 16) {
    library = "bootstrap/octicons-compatible (filled, 16 grid)"; confidence = 0.3;
  }

  const sizes = (icons.sizes || []).map((s) => s.size);
  const colors = countBy(svg, (i) => cssColorToHex(i.color)).slice(0, 3).map(([c]) => c);
  return {
    system: systems[0][0],
    systems: systems.map(([id, count]) => ({ id, count })),
    sprite,
    library: library || "custom/unknown",
    confidence,
    style,
    strokeWidth,
    roundCaps,
    grid,
    sizes: sizes.slice(0, 4),
    primarySize: sizes[0] || "",
    colors,
    fonts: fonts.map((f) => ({ family: f.family, count: f.count, size: f.size })),
    total
  };
}

/* ------------------------------------------------------------------ *
 * Logo
 * ------------------------------------------------------------------ */

function summarizeLogo(logo, assets = {}) {
  const favicons = Array.isArray(assets.favicons) ? assets.favicons : [];
  if (!logo && !favicons.length) return null;
  const out = {
    found: !!logo,
    kind: logo ? logo.kind : "",
    width: logo ? logo.width : 0,
    height: logo ? logo.height : 0,
    aspect: logo ? logo.aspect || round(logo.width / Math.max(1, logo.height), 2) : 0,
    placement: logo ? (logo.inHeader ? "header" : "page top") + (logo.homeLink ? ", links to /" : "") : "",
    label: logo ? logo.label || logo.alt || logo.text || "" : "",
    siteName: assets.siteName || "",
    favicon: favicons.find((f) => /icon/.test(f.rel))?.href || "",
    appleTouchIcon: favicons.find((f) => /apple-touch-icon/.test(f.rel))?.href || "",
    ogImage: assets.ogImage || ""
  };
  if (logo && logo.kind === "svg") {
    out.colors = (logo.colors || []).map(cssColorToHex);
    out.viewBox = logo.viewBox || "";
    out.svg = logo.svg || "";
  } else if (logo && logo.kind === "img") {
    out.src = logo.src || "";
    out.natural = logo.naturalWidth ? `${logo.naturalWidth}×${logo.naturalHeight}` : "";
    out.format = (/\.(svg|png|webp|jpe?g|gif|avif)(\?|#|$)/i.exec(logo.src || "") || [])[1] || (/^data:image\/(\w+)/.exec(logo.src || "") || [])[1] || "";
  } else if (logo && logo.kind === "text") {
    out.text = logo.text;
    out.font = { ...logo.font, color: cssColorToHex(logo.font?.color) };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Dark mode
 * ------------------------------------------------------------------ */

function summarizeDarkMode(dark = {}, assets = {}) {
  const strategies = [];
  if (dark.mediaRules) strategies.push("prefers-color-scheme");
  if (dark.classRules) strategies.push("class");
  if (dark.attributeRules) strategies.push("data-attribute");
  if (dark.lightDarkFn) strategies.push("light-dark()");
  const schemeDeclares = /dark/.test(`${dark.colorScheme || ""} ${dark.metaColorScheme || ""} ${(dark.colorSchemeDecls || []).join(" ")}`);
  const themeColors = Array.isArray(assets.themeColors) ? assets.themeColors : [];
  const darkThemeColor = themeColors.find((t) => /dark/.test(t.media || ""));
  const lightThemeColor = themeColors.find((t) => /light/.test(t.media || "")) || themeColors.find((t) => !t.media);
  const pairs = (dark.pairs || []).map((p) => ({ name: p.name, light: hexifyValue(p.light), dark: hexifyValue(p.dark) }));
  const supported = strategies.length > 0 || pairs.length > 0;
  const toggle = (dark.toggles || []).length > 0;
  let mechanism = "none";
  if (strategies.includes("prefers-color-scheme") && (strategies.includes("class") || strategies.includes("data-attribute"))) mechanism = "system + manual override";
  else if (strategies.includes("prefers-color-scheme")) mechanism = "system preference only";
  else if (strategies.includes("class") || strategies.includes("data-attribute")) mechanism = toggle ? "manual toggle" : "class/attribute switch";
  else if (strategies.includes("light-dark()")) mechanism = "light-dark() with color-scheme";
  else if (schemeDeclares) mechanism = "UA defaults only (color-scheme)";
  return {
    supported,
    mechanism,
    strategies,
    colorScheme: dark.colorScheme || "",
    metaColorScheme: dark.metaColorScheme || "",
    selectors: dark.darkSelectors || [],
    toggle,
    toggleLabels: dark.toggles || [],
    storageKeys: dark.storageKeys || [],
    currentTheme: dark.rootTheme || (/\bdark\b/.test(dark.rootClass || "") ? "dark" : ""),
    pairs,
    darkOnlyVars: dark.darkOnly || [],
    themeColor: { light: lightThemeColor ? lightThemeColor.color : "", dark: darkThemeColor ? darkThemeColor.color : "" }
  };
}

/* ------------------------------------------------------------------ *
 * Form states
 * ------------------------------------------------------------------ */

function summarizeFormStates(form = {}) {
  const states = form.states || {};
  const out = {};
  for (const state of ["focus", "invalid", "valid", "disabled", "placeholder", "checked", "hover"]) {
    const list = Array.isArray(states[state]) ? states[state] : [];
    if (!list.length) continue;
    const best = list.find((entry) => entry.field) || list[0];
    out[state] = {
      selector: best.selector,
      field: !!best.field,
      decls: Object.fromEntries(Object.entries(best.decls || {})
        // Shorthand already carries the longhands' values; keep it lean.
        .filter(([prop], _i, all) => !(prop.startsWith("outline-") && all.some(([p]) => p === "outline") && prop !== "outline-offset"))
        .map(([prop, value]) => [prop, hexifyValue(value)])),
      rules: (form.counts || {})[state] || list.length
    };
  }
  const controls = form.controls || {};
  const accent = controls.checkboxAccent || (form.accentColors || [])[0] || "";
  const required = ["focus", "invalid", "disabled"];
  return {
    states: out,
    accentColor: accent ? cssColorToHex(accent) : "",
    inputs: controls.inputs || 0,
    missing: required.filter((s) => !out[s])
  };
}

/* ------------------------------------------------------------------ *
 * Modern CSS
 * ------------------------------------------------------------------ */

const MODERN_FEATURES = [
  ["containerQueries", "Container queries (@container)", "Size components from their container, not the viewport: keep `container-type: inline-size` on wrappers and `@container` rules on children."],
  ["containerType", "container-type declarations", ""],
  ["has", ":has() relational selectors", "Parent styling depends on children (`:has()`); do not replace with JS class toggling."],
  ["subgrid", "Subgrid", "Nested grids align to the parent tracks with `grid-template-columns: subgrid`."],
  ["viewTransitions", "View transitions", "Page/state changes animate with the View Transitions API (`@view-transition`, `::view-transition-*`)."],
  ["viewTransitionNames", "view-transition-name", ""],
  ["layers", "Cascade layers (@layer)", "Keep the cascade layer order; put overrides in the later layer instead of raising specificity."],
  ["nesting", "Native CSS nesting", "Native nesting is used; nested rules are fine without a preprocessor."],
  ["clamp", "clamp() fluid sizing", "Fluid type/spacing uses `clamp(min, preferred, max)`; keep it fluid instead of breakpoint-stepping."],
  ["colorMix", "color-mix()", "Tints/shades are derived with `color-mix()`; derive hover/overlay colors the same way."],
  ["oklch", "OKLCH colors", "Colors are authored in OKLCH; keep OKLCH values (with hex fallbacks for old browsers)."],
  ["oklab", "OKLab colors", ""],
  ["labLch", "lab()/lch() colors", ""],
  ["displayP3", "Display-P3 wide gamut", "Wide-gamut `color(display-p3 …)` is used; provide sRGB fallback first, then the P3 value."],
  ["lightDark", "light-dark()", "Theme colors use `light-dark(light, dark)` together with `color-scheme`."],
  ["animationTimeline", "Scroll-driven animations (animation-timeline)", "Scroll-driven animations use `animation-timeline`; wrap them in `@supports (animation-timeline: view())`."],
  ["scrollTimeline", "scroll() timelines", ""],
  ["viewTimeline", "view() timelines", ""],
  ["propertyRule", "@property registered properties", "Animatable custom properties are registered with `@property`."],
  ["scope", "@scope", "Component styles are bounded with `@scope`."],
  ["startingStyle", "@starting-style entry animations", "Entry transitions use `@starting-style` (no JS needed for enter animations)."],
  ["anchor", "Anchor positioning", "Popovers/tooltips use CSS anchor positioning; provide a fallback position."],
  ["textWrapBalance", "text-wrap: balance", "Headings use `text-wrap: balance`."],
  ["textWrapPretty", "text-wrap: pretty", "Body copy uses `text-wrap: pretty`."],
  ["isWhere", ":is()/:where()", ""],
  ["focusVisible", ":focus-visible", ""],
  ["aspectRatio", "aspect-ratio", ""],
  ["backdropFilter", "backdrop-filter", ""],
  ["logicalProps", "Logical properties", "Spacing uses logical properties (`margin-inline`, `padding-block`); keep them for RTL safety."],
  ["supports", "@supports feature queries", ""],
  ["reducedMotion", "prefers-reduced-motion", "Motion is disabled/reduced under `prefers-reduced-motion: reduce`; keep that branch."],
  ["fieldSizing", "field-sizing", ""],
  ["popover", "Popover API", ""],
  ["mask", "CSS masks", ""]
];

function summarizeModernCss(modern = {}) {
  const counts = modern.counts || {};
  const samples = modern.samples || {};
  const features = MODERN_FEATURES
    .filter(([key]) => counts[key] > 0)
    .map(([key, label, advice]) => ({ key, label, count: counts[key], advice, sample: (samples[key] || [])[0] || "" }));
  return {
    features,
    used: features.map((f) => f.key),
    layers: modern.layers || [],
    containers: modern.containers || [],
    registeredProperties: modern.properties || []
  };
}

/* ------------------------------------------------------------------ *
 * Z-index
 * ------------------------------------------------------------------ */

const Z_LAYERS = [
  ["below", -Infinity, -1],
  ["base", 0, 9],
  ["sticky", 10, 99],
  ["dropdown", 100, 999],
  ["overlay", 1000, 9999],
  ["toast", 10000, Infinity]
];

function summarizeZIndex(z = {}) {
  const map = new Map();
  for (const d of z.declared || []) {
    const entry = map.get(d.value) || { value: d.value, declared: 0, rendered: 0, examples: [], positions: [] };
    entry.declared += d.count;
    entry.examples.push(...(d.selectors || []));
    map.set(d.value, entry);
  }
  for (const c of z.computed || []) {
    const entry = map.get(c.value) || { value: c.value, declared: 0, rendered: 0, examples: [], positions: [] };
    entry.rendered += c.count;
    entry.positions = [...new Set([...entry.positions, ...(c.positions || [])])];
    if (!entry.examples.length) entry.examples.push(...(c.elements || []));
    map.set(c.value, entry);
  }
  const scale = [...map.values()].sort((a, b) => a.value - b.value).map((e) => ({
    ...e,
    examples: [...new Set(e.examples)].slice(0, 3),
    layer: Z_LAYERS.find(([, min, max]) => e.value >= min && e.value <= max)[0]
  }));
  if (!scale.length) return null;
  const issues = [];
  const excessive = scale.filter((e) => e.value > 9999).map((e) => e.value);
  if (excessive.length) issues.push(`excessive values (${excessive.join(", ")}): cap the top layer at 9999`);
  if (scale.length >= 8) issues.push(`${scale.length} distinct values: collapse them into the named layers below`);
  if (scale.some((e) => e.value < 0)) issues.push("negative z-index used: make sure the parent creates a stacking context");
  const layers = Z_LAYERS
    .map(([name]) => ({ name, values: scale.filter((e) => e.layer === name).map((e) => e.value) }))
    .filter((l) => l.values.length);
  return { scale, layers, issues };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export function summarizeDeepSignals(probe) {
  if (!probe || typeof probe !== "object") return null;
  const meta = probe.meta || {};
  return {
    source: { url: meta.url || "", title: meta.title || "", lang: meta.lang || "" },
    voice: summarizeVoice(probe.copy, meta.lang),
    imagery: summarizeImagery(probe.imagery, probe.backgrounds),
    icons: summarizeIcons(probe.icons),
    logo: summarizeLogo(probe.logo, probe.brandAssets),
    darkMode: summarizeDarkMode(probe.darkMode, probe.brandAssets),
    formStates: summarizeFormStates(probe.formStates),
    modernCss: summarizeModernCss(probe.modernCss),
    zIndex: summarizeZIndex(probe.zIndex),
    coverage: {
      durationMs: meta.durationMs || 0,
      truncated: meta.truncated || [],
      stylesheets: meta.sheets ? { readable: meta.sheets.readable, crossOrigin: meta.sheets.crossOrigin, rules: meta.sheets.rules } : null
    }
  };
}

const LANGUAGE_NAMES = { en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch" };
const declLine = (decls) => Object.entries(decls).map(([p, v]) => `${p}: ${v}`).join("; ");

function voiceMarkdown(v) {
  if (!v) return "- Not enough on-page copy was found to infer a voice. Write plain, concise copy and ask for brand guidance before inventing a personality.";
  const lines = [];
  const langName = LANGUAGE_NAMES[v.language] || v.language;
  lines.push(`- Language: write all UI copy in ${langName}${v.languageMismatch ? ` (the page declares \`lang="${v.declaredLanguage}"\` but the copy is ${langName}; set \`<html lang="${v.language}">\`)` : ""}.`);
  const address = v.addressForm ? ` — address the reader with "${v.addressForm}"` : "";
  lines.push(`- Register: ${v.formality}${address} (evidence: ${v.addressEvidence.formal} formal / ${v.addressEvidence.informal} informal markers). Never mix registers.`);
  const personText = {
    "we-to-you": "the brand speaks as \"we\" directly to \"you\"",
    "you-focused": "copy talks to the reader (\"you\") and rarely about the company",
    "we-focused": "copy speaks about the company (\"we\") more than to the reader",
    impersonal: "copy is impersonal (no we/you)"
  }[v.person];
  lines.push(`- Point of view: ${personText}.`);
  lines.push(`- Personality: ${v.adjectives.join(", ") || "neutral"} (dominant tone: ${v.tone}${v.secondaryTone ? `, then ${v.secondaryTone}` : ""}).`);
  if (v.sentences.count) {
    lines.push(`- Sentence length: ${v.sentences.length} — average ${v.sentences.avgWords} words per sentence; keep new copy within ±3 words of that.`);
  }
  if (v.cta.examples.length) {
    const verbs = v.cta.verbs.map((x) => `"${x.verb}"`).join(", ");
    lines.push(`- Buttons/CTAs: ${v.cta.style} style, ${v.cta.casing}, ~${v.cta.avgWords} words${verbs ? `; reuse these verbs first: ${verbs}` : ""}. Examples: ${v.cta.examples.map((t) => `"${t}"`).join(", ")}.`);
  }
  if (v.headings.examples.length) {
    const css = v.headings.cssTransforms.length ? ` Casing applied by CSS, not in the text: ${v.headings.cssTransforms.join(", ")} — keep the source text in normal case and reproduce the \`text-transform\`.` : "";
    lines.push(`- Headings: ${v.headings.case}, ~${v.headings.avgWords} words.${css}`);
  }
  const emojiRule = v.emoji.level === "none" ? "do not use emoji"
    : v.emoji.level === "rare" ? `emoji are rare accents (${v.emoji.used.join(" ")}): at most one per block, never in headings or buttons`
    : `emoji are part of the voice (${v.emoji.used.join(" ")}): use them in body copy and lists`;
  lines.push(`- Emoji: ${emojiRule}. Exclamation marks: ${v.sentences.exclamations === 0 ? "none — do not add any" : `${v.sentences.exclamations} in body copy, keep them sparse`}.`);
  return lines.join("\n");
}

function imageryMarkdown(im) {
  if (!im || (!im.total && !im.patterns.length && !im.media.videos && !im.media.canvases)) {
    return "- No content imagery detected. Do not add stock photos; use typography, color and layout instead.";
  }
  const lines = [];
  if (im.total) {
    const counts = Object.entries(im.counts).map(([k, n]) => `${n} ${k}`).join(", ");
    lines.push(`- Style: ${im.dominant} (${counts}). Replacement images must match this style${im.dominant === "photography" ? " — real photographs, not illustrations or 3D renders" : im.dominant === "illustration" ? " — flat vector illustration (SVG), not photos" : ""}.`);
    if (im.aspectRatios.length) lines.push(`- Aspect ratios: ${im.aspectRatios.map((a) => `${a.ratio} ×${a.count}`).join(", ")}. Fix the ratio with \`aspect-ratio\` and \`object-fit: cover\` (${im.objectFitCover}/${im.total} images already use cover).`);
    lines.push(`- Corners: ${im.corners}${im.circles ? `; ${plural(im.circles, "circular image")} (avatars → \`border-radius: 50%\`)` : ""}.`);
    if (im.clipPaths || im.masks) lines.push(`- Shape masks: ${im.clipPaths} clip-path, ${im.masks} mask-image${im.clipSamples.length ? ` (e.g. \`clip-path: ${im.clipSamples[0]}\`)` : ""}.`);
    if (im.filters.length || im.blends.length) {
      lines.push(`- Treatments: ${[...im.filters.map((f) => `\`filter: ${f.value}\` ×${f.count}`), ...im.blends.map((b) => `\`mix-blend-mode: ${b.value}\` ×${b.count}`)].join(", ")}${im.duotone ? " — duotone look, reproduce with a blend layer" : ""}.`);
    } else {
      lines.push("- Treatments: none — images are shown untouched; do not add filters or overlays.");
    }
    if (im.altCoverage < 1) lines.push(`- Accessibility: only ${Math.round(im.altCoverage * 100)}% of images have alt text; write alt text for every content image.`);
  }
  const m = im.media;
  const extras = [m.videos ? plural(m.videos, "video") : "", m.canvases ? plural(m.canvases, "large canvas") + " (WebGL/3D likely)" : "", m.modelViewers ? plural(m.modelViewers, "3D model viewer") : "", m.backgroundImages ? plural(m.backgroundImages, "large background image") : ""].filter(Boolean);
  if (extras.length) lines.push(`- Other media: ${extras.join(", ")}.`);
  if (im.patterns.length) {
    const samples = im.patternSamples.map((s) => {
      const cut = s.value.endsWith("…") ? " (value truncated by the probe; rebuild the same technique)" : "";
      if (s.kind === "glass") return `  - glass: \`backdrop-filter: ${s.value}\` over a translucent background`;
      return `  - ${s.kind}: \`background-image: ${s.value}\`${s.size && !/^auto(, auto)*$/.test(s.size) ? `; \`background-size: ${s.size}\`` : ""}${cut}`;
    });
    lines.push(`- Background patterns: ${im.patterns.join(", ")}. Reproduce them in CSS (no raster images):`, ...samples);
  }
  return lines.join("\n");
}

function iconsMarkdown(ic) {
  if (!ic) return "- No icon system detected. If icons are needed, use one consistent outline set at a single size; do not mix libraries.";
  const lines = [];
  lines.push(`- Delivery: ${ic.systems.map((s) => `${s.id} ×${s.count}`).join(", ")}${ic.sprite ? " (SVG sprite with `<use>`)" : ""}.`);
  const isKnown = !/compatible|unknown/.test(ic.library);
  lines.push(`- Library: ${ic.library}${ic.confidence ? ` (confidence ${ic.confidence})` : ""}. ${isKnown ? `Use the same library (${ic.library}) for every new icon.` : "Pick an open-source set with the same geometry and use it everywhere."}`);
  if (ic.style !== "unknown") {
    const stroke = ic.style === "stroke" ? `, stroke-width ${ic.strokeWidth}${ic.roundCaps ? ", round line caps and joins" : ""}, \`fill="none"\`` : "";
    lines.push(`- Geometry: ${ic.style}${stroke}${ic.grid ? `, ${ic.grid}×${ic.grid} viewBox` : ""}.`);
  }
  if (ic.primarySize) lines.push(`- Size: render at ${ic.primarySize.replace("x", "×")} px${ic.sizes.length > 1 ? ` (other sizes seen: ${ic.sizes.slice(1).join(", ")})` : ""}; color via \`currentColor\`${ic.colors.length ? ` (observed ${ic.colors.join(", ")})` : ""}.`);
  if (ic.fonts.length) lines.push(`- Icon fonts present: ${ic.fonts.map((f) => `${f.family} ×${f.count} at ${f.size}`).join(", ")}. Prefer inline SVG for new work unless matching this font exactly.`);
  return lines.join("\n");
}

function logoMarkdown(logo) {
  if (!logo || !logo.found) {
    return `- No logo element found in the header.${logo && logo.favicon ? ` Favicon: ${logo.favicon}.` : ""} Use the site name as a text wordmark in the primary font.`;
  }
  const lines = [];
  lines.push(`- Element: ${logo.kind === "text" ? "text wordmark" : `inline ${logo.kind.toUpperCase()}`} in the ${logo.placement}, rendered at ${logo.width}×${logo.height}px (aspect ${logo.aspect}:1). Keep this exact rendered size on desktop.`);
  if (logo.label) lines.push(`- Accessible name: "${logo.label}" — keep it on the link/SVG (\`aria-label\` or \`<title>\`).`);
  if (logo.kind === "svg") {
    if (logo.colors?.length) lines.push(`- Colors: ${logo.colors.join(", ")}; do not recolor except for a single-color inverse version on dark surfaces.`);
    if (logo.svg && logo.svg.length <= 2500) lines.push("- Source markup (reuse verbatim, do not redraw):", "```svg", logo.svg, "```");
    else if (logo.svg) lines.push(`- Source markup captured (${logo.svg.length} chars); export it to \`logo.svg\` and reference that file.`);
  } else if (logo.kind === "img") {
    lines.push(`- Source: ${logo.src}${logo.format ? ` (${logo.format})` : ""}${logo.natural ? `, intrinsic ${logo.natural}` : ""}. Download it; never redraw the logo.`);
  } else if (logo.kind === "text") {
    lines.push(`- Wordmark text "${logo.text}": font ${logo.font.family}, weight ${logo.font.weight}, size ${logo.font.size}, letter-spacing ${logo.font.letterSpacing}${logo.font.transform !== "none" ? `, text-transform ${logo.font.transform}` : ""}, color ${logo.font.color}.`);
  }
  const icons = [logo.favicon ? `favicon ${logo.favicon}` : "", logo.appleTouchIcon ? `apple-touch-icon ${logo.appleTouchIcon}` : "", logo.ogImage ? `og:image ${logo.ogImage}` : ""].filter(Boolean);
  if (icons.length) lines.push(`- Brand assets: ${icons.join("; ")}.`);
  return lines.join("\n");
}

function darkModeMarkdown(d) {
  if (!d || !d.supported) {
    const ua = d && d.mechanism === "UA defaults only (color-scheme)" ? " The page sets `color-scheme` to allow dark form controls, but defines no dark palette." : "";
    return `- No dark theme detected.${ua} Ship light only; do not invent a dark palette.`;
  }
  const lines = [];
  lines.push(`- Mechanism: ${d.mechanism} (${d.strategies.join(", ")}).`);
  if (d.strategies.includes("prefers-color-scheme")) lines.push("- Default to the OS setting with `@media (prefers-color-scheme: dark)`.");
  if (d.selectors.length) lines.push(`- Manual override selector(s): ${d.selectors.map((s) => `\`${s}\``).join(", ")}${d.toggle ? ` — a theme toggle exists (${d.toggleLabels.map((t) => `"${t}"`).join(", ")}); persist the choice${d.storageKeys.length ? ` in localStorage key ${d.storageKeys.map((k) => `\`${k}\``).join(", ")}` : " in localStorage"} and apply it before first paint` : ""}.`);
  if (d.colorScheme || d.metaColorScheme) lines.push(`- Declare \`color-scheme: ${d.colorScheme || d.metaColorScheme}\`${d.metaColorScheme ? ` and \`<meta name="color-scheme" content="${d.metaColorScheme}">\`` : ""} so native controls and scrollbars follow the theme.`);
  if (d.pairs.length) {
    lines.push("- Token pairs (swap only these variables; components keep using the same `var()` names):", "", "| Variable | Light | Dark |", "|---|---|---|");
    for (const p of d.pairs.slice(0, 24)) lines.push(`| \`${p.name}\` | \`${p.light}\` | \`${p.dark}\` |`);
    lines.push("");
  }
  if (d.darkOnlyVars.length) lines.push(`- Variables defined only in dark mode: ${d.darkOnlyVars.map((v) => `\`${v}\``).join(", ")}.`);
  if (d.themeColor.dark) lines.push(`- \`<meta name="theme-color">\`: light ${d.themeColor.light || "—"}, dark ${d.themeColor.dark} (with \`media="(prefers-color-scheme: …)"\`).`);
  return lines.join("\n");
}

function formStatesMarkdown(f) {
  if (!f || (!Object.keys(f.states).length && !f.accentColor)) {
    return "- No form state styles found in readable stylesheets. Define focus (visible ring), invalid (error border + message) and disabled (reduced opacity, `cursor: not-allowed`) states from the existing tokens.";
  }
  const names = { focus: "Focus", invalid: "Invalid / error", valid: "Valid", disabled: "Disabled", placeholder: "Placeholder", checked: "Checked", hover: "Hover" };
  const lines = [];
  for (const [state, info] of Object.entries(f.states)) {
    lines.push(`- ${names[state]}: \`${info.selector}\` → \`${declLine(info.decls)}\`${info.field ? "" : " (generic, not field-specific)"}.`);
  }
  if (f.accentColor) lines.push(`- Checkboxes/radios: \`accent-color: ${f.accentColor}\`.`);
  if (f.missing.length) lines.push(`- Not found on the page: ${f.missing.join(", ")} — derive them from the tokens above rather than leaving defaults.`);
  lines.push("- Always pair `:invalid` styling with `:user-invalid` (or an `aria-invalid` flag set after interaction) so untouched fields do not show errors.");
  return lines.join("\n");
}

function modernCssMarkdown(m, coverage) {
  if (!m || !m.features.length) {
    return "- No modern CSS features detected in readable stylesheets. Plain, widely supported CSS is enough.";
  }
  const lines = [];
  for (const f of m.features) {
    if (!f.advice) continue;
    lines.push(`- ${f.label} (×${f.count}): ${f.advice}${f.sample ? ` Seen: \`${f.sample}\`.` : ""}`);
  }
  const minor = m.features.filter((f) => !f.advice).map((f) => `${f.label} ×${f.count}`);
  if (minor.length) lines.push(`- Also used: ${minor.join(", ")}.`);
  if (m.layers.length) lines.push(`- Layer order: \`@layer ${m.layers.join(", ")};\``);
  if (m.containers.length) lines.push(`- Container conditions: ${m.containers.map((c) => `\`${c.condition}\``).join(", ")}.`);
  if (m.registeredProperties.length) lines.push(`- Registered properties: ${m.registeredProperties.map((p) => `\`${p}\``).join(", ")}.`);
  if (coverage?.stylesheets?.crossOrigin) lines.push(`- Note: ${plural(coverage.stylesheets.crossOrigin, "cross-origin stylesheet")} could not be read; the list may be incomplete.`);
  return lines.join("\n");
}

function zIndexMarkdown(z) {
  if (!z) return "- No explicit z-index found. Use a small named scale if layering is needed: base 0, sticky 10, dropdown 100, overlay 1000.";
  const lines = ["- Use named tokens instead of raw numbers:", "", "| Token | Value | Layer | Used by |", "|---|---|---|---|"];
  for (const e of z.scale) {
    lines.push(`| \`--z-${e.layer}${z.scale.filter((x) => x.layer === e.layer).length > 1 ? `-${e.value}` : ""}\` | ${e.value} | ${e.layer} | ${e.examples.map((x) => `\`${x}\``).join(", ") || "—"}${e.positions.length ? ` (${e.positions.join("/")})` : ""} |`);
  }
  lines.push("");
  if (z.issues.length) lines.push(...z.issues.map((i) => `- Fix: ${i}.`));
  return lines.join("\n");
}

/**
 * Extra DESIGN.md sections. Every section is always emitted: an explicit
 * "not detected" tells the agent not to invent that layer.
 */
export function generateDeepSignalsMarkdown(summary) {
  if (!summary) return "";
  return [
    "## Voice & Tone",
    voiceMarkdown(summary.voice),
    "",
    "## Imagery",
    imageryMarkdown(summary.imagery),
    "",
    "## Icon System",
    iconsMarkdown(summary.icons),
    "",
    "## Logo",
    logoMarkdown(summary.logo),
    "",
    "## Dark Mode",
    darkModeMarkdown(summary.darkMode),
    "",
    "## Form States",
    formStatesMarkdown(summary.formStates),
    "",
    "## Modern CSS",
    modernCssMarkdown(summary.modernCss, summary.coverage),
    "",
    "## Z-Index Scale",
    zIndexMarkdown(summary.zIndex),
    ""
  ].join("\n");
}

/** Dense one-line-per-topic block for an AI prompt (well under 1.5 KB). */
export function deepSignalsPromptBlock(summary) {
  if (!summary) return "";
  const lines = [];
  const v = summary.voice;
  if (v) {
    const verbs = v.cta.verbs.slice(0, 3).map((x) => x.verb).join("/");
    lines.push(`Voice: ${LANGUAGE_NAMES[v.language] || v.language}, ${v.formality}${v.addressForm ? ` (${v.addressForm})` : ""}, ${v.person}, ${v.adjectives.join("/")}; ${v.sentences.length} sentences (~${v.sentences.avgWords} words); CTAs ${v.cta.style}${verbs ? ` (${verbs})` : ""}; headings ${v.headings.case}; emoji ${v.emoji.level}.`);
  }
  const im = summary.imagery;
  if (im && (im.total || im.patterns.length)) {
    lines.push(`Imagery: ${im.dominant}${im.total ? `, corners ${im.corners}` : ""}${im.filters.length ? `, filters ${im.filters.map((f) => f.value).join("/")}` : ""}${im.clipPaths ? `, ${im.clipPaths} clip-path` : ""}${im.patterns.length ? `; backgrounds ${im.patterns.join("/")}` : ""}.`);
  }
  const ic = summary.icons;
  if (ic) lines.push(`Icons: ${ic.library}, ${ic.style}${ic.strokeWidth ? ` ${ic.strokeWidth}px` : ""}${ic.grid ? `, ${ic.grid}-grid` : ""}${ic.primarySize ? `, ${ic.primarySize}` : ""}, via ${ic.system}.`);
  const logo = summary.logo;
  if (logo && logo.found) lines.push(`Logo: ${logo.kind} ${logo.width}x${logo.height}${logo.colors?.length ? ` ${logo.colors.join("/")}` : ""}${logo.label ? ` "${logo.label}"` : ""}.`);
  const d = summary.darkMode;
  if (d) lines.push(`Dark mode: ${d.supported ? `${d.mechanism}; ${d.pairs.slice(0, 4).map((p) => `${p.name} ${p.light}→${p.dark}`).join(", ")}` : "none (do not add)"}.`);
  const f = summary.formStates;
  if (f && Object.keys(f.states).length) {
    lines.push(`Form states: ${Object.entries(f.states).filter(([s]) => s !== "hover").map(([s, i]) => `${s} {${declLine(i.decls)}}`).join(" ")}${f.accentColor ? ` accent ${f.accentColor}` : ""}.`);
  }
  const m = summary.modernCss;
  if (m && m.features.length) lines.push(`Modern CSS: ${m.features.map((x) => x.key).join(", ")}.`);
  const z = summary.zIndex;
  if (z) lines.push(`Z-index: ${z.scale.map((e) => `${e.layer}=${e.value}`).join(", ")}.`);
  return lines.join("\n");
}
