/**
 * Keys_Osi learning memory: every failure, self-check anomaly, user rating
 * and correction is recorded once (deduplicated by signature, counted), then
 * turned into lessons that change later runs:
 *  - prompt lessons are appended to the AI system prompt of the feature;
 *  - routing lessons keep failing models out of automatic model choice;
 *  - extraction anomalies become regression cases exported for the test suite.
 * Pure functions on a plain JSON object stored in chrome.storage.local.
 */

export const MEMORY_KEY = "keysOsiMemory";
const MAX_EVENTS = 400;
const MAX_RATINGS = 200;

export const RATING_REASONS = {
  colors: { label: "Couleurs fausses", lesson: "Use only the exact hex values listed in the token tables; never invent, shift or approximate colors." },
  typography: { label: "Typographie fausse", lesson: "Use exactly the listed font families, weights, sizes and line heights; never substitute fonts." },
  generic: { label: "Trop générique", lesson: "Be specific: reuse the real copy, measured values and section names; no generic filler or placeholder text." },
  incomplete: { label: "Incomplet", lesson: "Cover every requested section completely; never stop early, summarize or leave TODOs." },
  structure: { label: "Structure fausse", lesson: "Respect the section order and the layout described (columns, grids, alignment, spacing) exactly." },
  motion: { label: "Animations fausses", lesson: "Reproduce motion values exactly (durations, easings, delays, scroll triggers); no invented animation." },
  long: { label: "Trop long", lesson: "Be concise: no repetition, no prose around code blocks, no restating the brief." },
  language: { label: "Mauvaise langue", lesson: "Write the whole document in the user's language." }
};

export function emptyMemory() {
  return { version: 1, events: [], ratings: [], lessonState: {}, updatedAt: "" };
}

function normalizeMessage(message) {
  return String(message || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Error families that decide routing lessons. */
export function classifyError(message) {
  const text = String(message || "").toLowerCase();
  if (/524|timeout|délai|timed out|aborted/.test(text)) return "timeout";
  if (/429|rate.?limit|quota|too many/.test(text)) return "rate-limit";
  if (/401|403|invalid.*key|unauthori[sz]ed|forbidden/.test(text)) return "auth";
  if (/truncat|tronqu|incomplet|missing section/.test(text)) return "truncated";
  if (/empty|vide|no content/.test(text)) return "empty";
  if (/5\d\d|server error|bad gateway|unavailable/.test(text)) return "server";
  if (/network|réseau|fetch failed|failed to fetch/.test(text)) return "network";
  return "other";
}

/**
 * Records one event; identical events (same kind, feature, normalized message,
 * model, platform) are merged and counted instead of duplicated.
 * @param {{ kind: string, feature: string, message: string, scope?: object, detail?: object, at?: string }} event
 */
export function recordEvent(memory, event) {
  const mem = memory && memory.version ? memory : emptyMemory();
  const scope = event.scope || {};
  const at = event.at || new Date().toISOString();
  const signature = [event.kind, event.feature, normalizeMessage(event.message), scope.model || "", scope.platform || ""].join("|");
  const existing = mem.events.find((entry) => entry.signature === signature);
  if (existing) {
    existing.count += 1;
    existing.lastAt = at;
    if (scope.host && !existing.hosts.includes(scope.host)) existing.hosts = [...existing.hosts, scope.host].slice(-10);
    if (scope.url) existing.lastUrl = scope.url;
    if (event.detail) existing.detail = event.detail;
  } else {
    mem.events.push({
      id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      signature,
      kind: event.kind,
      feature: event.feature,
      message: String(event.message || "").slice(0, 400),
      family: event.kind === "ai-failure" ? classifyError(event.message) : "",
      scope: { model: scope.model || "", provider: scope.provider || "", platform: scope.platform || "", archetype: scope.archetype || "" },
      hosts: scope.host ? [scope.host] : [],
      lastUrl: scope.url || "",
      detail: event.detail || null,
      count: 1,
      firstAt: at,
      lastAt: at
    });
  }
  if (mem.events.length > MAX_EVENTS) {
    mem.events.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    mem.events.length = MAX_EVENTS;
  }
  mem.updatedAt = at;
  return mem;
}

/** A user's verdict on a generated document (👍/👎 + reasons + free note). */
export function recordRating(memory, { feature, value, reasons = [], note = "", scope = {}, at }) {
  const mem = memory && memory.version ? memory : emptyMemory();
  const when = at || new Date().toISOString();
  const cleanReasons = reasons.filter((reason) => RATING_REASONS[reason]);
  mem.ratings.push({ feature, value: value === "up" ? "up" : "down", reasons: cleanReasons, note: String(note || "").trim().slice(0, 400), scope, at: when });
  if (mem.ratings.length > MAX_RATINGS) mem.ratings.splice(0, mem.ratings.length - MAX_RATINGS);
  if (value !== "up") {
    for (const reason of cleanReasons) recordEvent(mem, { kind: "rating", feature, message: `reason:${reason}`, scope, at: when });
  }
  mem.updatedAt = when;
  return mem;
}

function recency(at, now) {
  const days = Math.max(0, (now - Date.parse(at || 0)) / 86400000);
  return 1 / (1 + days / 30);
}

/**
 * Lessons derived from the memory. Each has a stable id so the user can
 * disable one (lessonState[id] = false) without it reappearing.
 */
export function deriveLessons(memory, now = Date.now()) {
  const mem = memory && memory.version ? memory : emptyMemory();
  const lessons = [];
  const push = (lesson) => lessons.push({ ...lesson, enabled: mem.lessonState[lesson.id] !== false });

  // Rating reasons → prompt rules for the rated feature.
  const reasonWeights = new Map();
  for (const event of mem.events.filter((entry) => entry.kind === "rating")) {
    const reason = event.message.replace(/^reason:/, "");
    if (!RATING_REASONS[reason]) continue;
    const key = `${event.feature}|${reason}`;
    const previous = reasonWeights.get(key) || { count: 0, weight: 0 };
    reasonWeights.set(key, { count: previous.count + event.count, weight: previous.weight + event.count * recency(event.lastAt, now), feature: event.feature, reason });
  }
  for (const [key, entry] of reasonWeights) {
    push({ id: `rating:${key}`, type: "prompt", feature: entry.feature, text: RATING_REASONS[entry.reason].lesson, source: `${entry.count} avis « ${RATING_REASONS[entry.reason].label} »`, count: entry.count, weight: entry.weight + 1 });
  }

  // Free notes on negative ratings are the user's own rules, kept verbatim.
  for (const rating of mem.ratings.filter((entry) => entry.value === "down" && entry.note)) {
    const id = `note:${rating.feature}:${normalizeMessage(rating.note).slice(0, 60)}`;
    if (lessons.some((lesson) => lesson.id === id)) continue;
    push({ id, type: "prompt", feature: rating.feature, text: rating.note, source: "ta note", count: 1, weight: 3 * recency(rating.at, now) + 1 });
  }

  // Sections missing from AI outputs.
  const missing = new Map();
  for (const event of mem.events.filter((entry) => entry.kind === "missing-sections")) {
    for (const section of event.detail?.sections || []) missing.set(section, (missing.get(section) || 0) + event.count);
  }
  if (missing.size) {
    const list = [...missing.entries()].sort((a, b) => b[1] - a[1]).map(([section]) => section);
    push({ id: "pro:missing-sections", type: "prompt", feature: "pro", text: `Previous outputs omitted these sections — include every one of them, complete: ${list.slice(0, 8).join(", ")}.`, source: `${[...missing.values()].reduce((a, b) => a + b, 0)} oublis mesurés`, count: list.length, weight: 4 });
  }

  // Models that keep failing → routing lesson.
  const modelFails = new Map();
  for (const event of mem.events.filter((entry) => entry.kind === "ai-failure" && entry.scope.model)) {
    const previous = modelFails.get(event.scope.model) || { count: 0, families: new Set(), lastAt: "" };
    previous.count += event.count;
    previous.families.add(event.family);
    if (event.lastAt > previous.lastAt) previous.lastAt = event.lastAt;
    modelFails.set(event.scope.model, previous);
  }
  for (const [model, entry] of modelFails) {
    if (entry.count < 2 || [...entry.families].every((family) => family === "auth" || family === "network")) continue;
    push({ id: `route:${model}`, type: "routing", feature: "pro", model, text: `Éviter ${model} en choix automatique : ${entry.count} échecs (${[...entry.families].join(", ")}).`, source: "échecs mesurés", count: entry.count, weight: entry.count * recency(entry.lastAt, now) });
  }

  // Extraction anomalies per platform: shown and exported as regression cases.
  for (const event of mem.events.filter((entry) => entry.kind === "extract-anomaly")) {
    push({ id: `extract:${event.signature}`, type: "watch", feature: "extract", text: `${event.message}${event.scope.platform ? ` (${event.scope.platform})` : ""} — ${event.hosts.join(", ")}`, source: `${event.count} occurrence(s)`, count: event.count, weight: event.count * recency(event.lastAt, now) });
  }

  return lessons.sort((a, b) => b.weight - a.weight);
}

export function lessonsFor(memory, feature, limit = 8) {
  return deriveLessons(memory)
    .filter((lesson) => lesson.enabled && lesson.type === "prompt" && lesson.feature === feature)
    .slice(0, limit);
}

export function modelsToAvoid(memory) {
  return new Set(deriveLessons(memory).filter((lesson) => lesson.enabled && lesson.type === "routing").map((lesson) => lesson.model));
}

/** Appends the active lessons to the system message (OpenAI/Anthropic message list of { role, text }). */
export function applyLessonsToMessages(messages, lessons) {
  if (!lessons.length) return messages;
  const block = `\n\n## Lessons from previous runs (Keys_Osi memory — follow them strictly)\n${lessons.map((lesson) => `- ${lesson.text}`).join("\n")}`;
  const copy = messages.map((message) => ({ ...message }));
  const system = copy.find((message) => message.role === "system");
  if (system) system.text = `${system.text || ""}${block}`;
  else copy.unshift({ role: "system", text: block.trim() });
  return copy;
}

export function setLessonEnabled(memory, id, enabled) {
  const mem = memory && memory.version ? memory : emptyMemory();
  mem.lessonState = { ...mem.lessonState, [id]: Boolean(enabled) };
  return mem;
}

/**
 * Self-check of an extraction (the invariants of the real-site validation
 * that need no screenshot). Returns the failed checks with a message.
 */
export function auditExtraction(normalized, { design = "", skill = "" } = {}, helpers) {
  const issues = [];
  const palette = normalized?.colorPalette || [];
  const hexOf = (token) => String(palette.find((row) => row.token === token)?.value || "").split(" ")[0];
  const base = hexOf("color.surface.base");
  const text = hexOf("color.text.primary");
  if (!base) issues.push({ check: "canvas", message: "Aucun fond (surface.base) détecté" });
  if (!text) issues.push({ check: "text", message: "Aucune couleur de texte principale" });
  if (base && text && helpers?.contrastRatio && helpers.contrastRatio(text, base) < 4.5) issues.push({ check: "coreContrast", message: `Contraste texte/fond ${helpers.contrastRatio(text, base).toFixed(2)}:1 < 4.5` });
  const saturatedButton = (normalized?.buttonVariants || []).some((variant) => /^#/.test(variant.spec?.background || "") && helpers?.isSaturated?.(variant.spec.background));
  if (saturatedButton && !hexOf("color.brand.primary")) issues.push({ check: "brand", message: "Bouton coloré mais aucune couleur de marque" });
  if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(design + skill)) issues.push({ check: "leaks", message: "Valeur non résolue (undefined/NaN) dans le document" });
  if (!(normalized?.typographyScale || []).length) issues.push({ check: "typography", message: "Échelle typographique vide" });
  const varNames = new Set((normalized?.cssVariables || []).map((variable) => variable.name));
  const ghost = palette.find((row) => {
    const match = String(row.value).match(/var\((--[^)]+)\)/);
    return match && !varNames.has(match[1]);
  });
  if (ghost) issues.push({ check: "varsExist", message: `Variable CSS inexistante citée : ${ghost.value}` });
  return issues;
}

export function regressionCases(memory) {
  return (memory?.events || [])
    .filter((event) => event.kind === "extract-anomaly")
    .map((event) => ({ check: event.detail?.check || "", message: event.message, platform: event.scope.platform, urls: event.lastUrl ? [event.lastUrl] : [], hosts: event.hosts, count: event.count }));
}

export function exportMemory(memory) {
  return {
    format: "keys-osi-memory",
    version: 1,
    exportedAt: new Date().toISOString(),
    memory,
    lessons: deriveLessons(memory),
    regressionCases: regressionCases(memory)
  };
}

/** Merges an exported memory into the current one (events summed by signature). */
export function importMemory(memory, data) {
  let mem = memory && memory.version ? memory : emptyMemory();
  const incoming = data?.memory || data;
  if (!incoming || !Array.isArray(incoming.events)) throw new Error("Fichier de mémoire Keys_Osi invalide.");
  for (const event of incoming.events) {
    const existing = mem.events.find((entry) => entry.signature === event.signature);
    if (existing) {
      existing.count += event.count;
      if (event.lastAt > existing.lastAt) existing.lastAt = event.lastAt;
      existing.hosts = [...new Set([...existing.hosts, ...(event.hosts || [])])].slice(-10);
    } else {
      mem.events.push({ ...event });
    }
  }
  mem.ratings = [...mem.ratings, ...(incoming.ratings || [])].slice(-MAX_RATINGS);
  mem.lessonState = { ...(incoming.lessonState || {}), ...mem.lessonState };
  mem.updatedAt = new Date().toISOString();
  return mem;
}

export function memoryStats(memory) {
  const mem = memory && memory.version ? memory : emptyMemory();
  const lessons = deriveLessons(mem);
  return {
    events: mem.events.reduce((sum, event) => sum + event.count, 0),
    distinct: mem.events.length,
    ratings: mem.ratings.length,
    positive: mem.ratings.filter((rating) => rating.value === "up").length,
    lessons: lessons.filter((lesson) => lesson.enabled).length,
    disabled: lessons.filter((lesson) => !lesson.enabled).length
  };
}
