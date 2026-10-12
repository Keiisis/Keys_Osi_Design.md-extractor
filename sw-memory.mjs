/**
 * Keys_Osi learning memory, service worker side: storage with serialized
 * writes (events can arrive concurrently), plus the popup API.
 */
import {
  MEMORY_KEY,
  RATING_REASONS,
  applyLessonsToMessages,
  deriveLessons,
  emptyMemory,
  exportMemory,
  importMemory,
  lessonsFor,
  memoryStats,
  modelsToAvoid,
  recordEvent,
  recordRating,
  setLessonEnabled
} from "./lib/learning-memory.mjs";

let queue = Promise.resolve();

async function readMemory() {
  const { [MEMORY_KEY]: memory } = await chrome.storage.local.get(MEMORY_KEY);
  return memory && memory.version ? memory : emptyMemory();
}

/** Read-modify-write, one at a time. */
function update(mutator) {
  queue = queue.then(async () => {
    const memory = mutator(await readMemory()) || (await readMemory());
    await chrome.storage.local.set({ [MEMORY_KEY]: memory });
    return memory;
  });
  return queue.catch(() => emptyMemory());
}

export function recordMemoryEvent(event) {
  return update((memory) => recordEvent(memory, event));
}

export async function memoryLessons(feature) {
  return lessonsFor(await readMemory(), feature);
}

export async function memoryAvoidModels() {
  return [...modelsToAvoid(await readMemory())];
}

export { applyLessonsToMessages };

async function state() {
  const memory = await readMemory();
  const lessons = deriveLessons(memory);
  return {
    stats: memoryStats(memory),
    lessons: lessons.slice(0, 40),
    recent: [...memory.events].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 15).map((event) => ({ kind: event.kind, feature: event.feature, message: event.message, count: event.count, lastAt: event.lastAt, model: event.scope.model, hosts: event.hosts })),
    reasons: Object.fromEntries(Object.entries(RATING_REASONS).map(([id, reason]) => [id, reason.label]))
  };
}

export function handleMemoryMessage(message) {
  switch (message.type) {
    case "MEMORY_STATE":
      return state();
    case "MEMORY_RATE":
      return update((memory) =>
        recordRating(memory, {
          feature: message.feature,
          value: message.value,
          reasons: message.reasons || [],
          note: message.note || "",
          scope: { host: message.host || "", url: message.url || "", model: message.model || "" }
        })
      ).then(state);
    case "MEMORY_TOGGLE":
      return update((memory) => setLessonEnabled(memory, message.id, message.enabled)).then(state);
    case "MEMORY_EXPORT":
      return readMemory().then(async (memory) => {
        const json = JSON.stringify(exportMemory(memory), null, 2);
        const filename = `keys-osi-memoire-${new Date().toISOString().slice(0, 10)}.json`;
        const { keysOsiSaveAs } = await chrome.storage.local.get("keysOsiSaveAs");
        await chrome.downloads.download({ url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`, filename, saveAs: keysOsiSaveAs !== false, conflictAction: "uniquify" });
        return { filename };
      });
    case "MEMORY_IMPORT":
      return update((memory) => importMemory(memory, message.data)).then(state);
    case "MEMORY_RESET":
      return update(() => emptyMemory()).then(state);
    default:
      return null;
  }
}
