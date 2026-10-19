// Prompt extractor exports (sw-prompt.mjs): the four formats must round-trip
// quotes, commas and newlines without corrupting the prompt text.
import assert from "node:assert/strict";
import { formatPrompts, handlePromptMessage } from "../sw-prompt.mjs";

const items = [
  { text: 'You are a "senior" copywriter.\nTone: warm, short.', source: "code:pre", chars: 48, confidence: "high" },
  { text: "Act as a travel planner, 3 days, {budget}", source: "adapter:motionsites.ai", chars: 42, confidence: "high" }
];

const csv = formatPrompts(items, "csv", "motionsites.ai");
assert.equal(csv.ext, "csv");
assert.equal(csv.mime, "text/csv");
const rows = csv.content.trimEnd().split("\r\n");
assert.equal(rows[0], '"index","source","confidence","chars","text"');
assert.equal(rows.length, 3, "one header + two records; the embedded newline must stay inside its quoted cell");
assert.ok(rows[1].includes('"You are a ""senior"" copywriter.\nTone: warm, short."'), "quotes doubled, newline preserved");
assert.ok(rows[2].startsWith('"2","adapter:motionsites.ai","high","42",'));

const md = formatPrompts(items, "md", "motionsites.ai");
assert.ok(md.content.startsWith("# Prompts — motionsites.ai — "));
assert.equal((md.content.match(/^```$/gm) || []).length, 4, "each prompt fenced");
assert.ok(md.content.includes("## 2. adapter:motionsites.ai · high · 42 car."));

const json = JSON.parse(formatPrompts(items, "json", "motionsites.ai").content);
assert.equal(json.count, 2);
assert.equal(json.host, "motionsites.ai");
assert.deepEqual(json.items, items);

const txt = formatPrompts(items, "txt");
assert.ok(txt.content.startsWith("# Prompt 1 [code:pre]\nYou are a"));
assert.ok(txt.content.includes("\n\n---\n\n# Prompt 2 [adapter:motionsites.ai]\n"));

assert.equal(formatPrompts(undefined, "json").content.includes('"count": 0'), true, "missing items export as an empty set");
assert.equal(handlePromptMessage({ type: "MODELS_SCAN" }), null, "ignores other modules' messages");

console.log("prompt-export-tests: ok");
