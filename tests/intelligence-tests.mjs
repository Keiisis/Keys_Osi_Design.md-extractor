// Learning memory, accessibility fixer, moodboard.
import assert from "node:assert/strict";
import {
  applyLessonsToMessages,
  auditExtraction,
  classifyError,
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
} from "../lib/learning-memory.mjs";
import { a11yFixMarkdown, collectContrastPairs, fixForeground, planContrastFixes } from "../lib/a11y-fix.mjs";
import { addPins, buildMoodboardFiles, moodboardHtml, moodboardPromptBlock, removePin } from "../lib/moodboard.mjs";
import { contrastRatio, isSaturated } from "../lib/color-science.mjs";
import { hexToOklch } from "../lib/brand-kit.mjs";
import { missingAnatomySections } from "../lib/generate-prompt-pro.mjs";

// Memory: dedupe, lessons, routing, toggles, export/import
{
  let memory = emptyMemory();
  const t0 = "2026-10-01T10:00:00.000Z";
  memory = recordEvent(memory, { kind: "ai-failure", feature: "pro", message: "HTTP 524 after 100 s", scope: { model: "gpt-slow", host: "a.com" }, at: t0 });
  memory = recordEvent(memory, { kind: "ai-failure", feature: "pro", message: "HTTP 524 after 120 s", scope: { model: "gpt-slow", host: "b.com" }, at: t0 });
  assert.equal(memory.events.length, 1, "same failure family merged");
  assert.equal(memory.events[0].count, 2);
  assert.deepEqual(memory.events[0].hosts, ["a.com", "b.com"]);
  assert.equal(classifyError("HTTP 524"), "timeout");
  assert.equal(classifyError("401 invalid api key"), "auth");
  assert.deepEqual([...modelsToAvoid(memory)], ["gpt-slow"], "2 timeouts → avoided in auto choice");
  memory = recordEvent(memory, { kind: "ai-failure", feature: "pro", message: "401 Unauthorized", scope: { model: "good-model" }, at: t0 });
  memory = recordEvent(memory, { kind: "ai-failure", feature: "pro", message: "401 Unauthorized", scope: { model: "good-model" }, at: t0 });
  assert.ok(!modelsToAvoid(memory).has("good-model"), "auth errors are the key's fault, not the model's");

  memory = recordRating(memory, { feature: "pro", value: "down", reasons: ["colors", "bogus"], note: "Toujours un header sticky avec fond flouté.", at: t0 });
  memory = recordRating(memory, { feature: "pro", value: "down", reasons: ["colors"], at: t0 });
  memory = recordRating(memory, { feature: "pro", value: "up", reasons: [], at: t0 });
  memory = recordEvent(memory, { kind: "missing-sections", feature: "pro", message: "missing", detail: { sections: ["Motion system", "Dependencies"] }, at: t0 });
  const lessons = lessonsFor(memory, "pro");
  const texts = lessons.map((lesson) => lesson.text);
  assert.ok(texts.some((text) => text.startsWith("Use only the exact hex values")), texts);
  assert.ok(texts.includes("Toujours un header sticky avec fond flouté."), "user note kept verbatim");
  assert.ok(texts.some((text) => text.includes("Motion system") && text.includes("Dependencies")));
  const colorLesson = deriveLessons(memory).find((lesson) => lesson.id === "rating:pro|colors");
  assert.equal(colorLesson.count, 2, "both negative color ratings counted");

  const messages = applyLessonsToMessages([{ role: "system", text: "Base." }, { role: "user", text: "Brief" }], lessons);
  assert.ok(messages[0].text.startsWith("Base.") && messages[0].text.includes("## Lessons from previous runs"));
  assert.equal(messages[1].text, "Brief");

  memory = setLessonEnabled(memory, "rating:pro|colors", false);
  assert.ok(!lessonsFor(memory, "pro").some((lesson) => lesson.id === "rating:pro|colors"), "disabled lesson not applied");
  assert.equal(deriveLessons(memory).find((lesson) => lesson.id === "rating:pro|colors").enabled, false, "but still listed");

  const stats = memoryStats(memory);
  assert.equal(stats.ratings, 3);
  assert.equal(stats.positive, 1);
  const exported = exportMemory(memory);
  const merged = importMemory(emptyMemory(), JSON.parse(JSON.stringify(exported)));
  assert.equal(merged.events.length, memory.events.length);
  assert.throws(() => importMemory(emptyMemory(), { nope: true }), /invalide/);
}

// Extraction self-check
{
  const normalized = {
    colorPalette: [
      { token: "color.surface.base", value: "#ffffff" },
      { token: "color.text.primary", value: "#9a9a9a" },
      { token: "color.border.default", value: "var(--ghost)" }
    ],
    buttonVariants: [{ spec: { background: "#ff3b30" } }],
    typographyScale: [],
    cssVariables: []
  };
  const issues = auditExtraction(normalized, { design: "size: undefined" }, { contrastRatio, isSaturated }).map((issue) => issue.check);
  assert.deepEqual(issues.sort(), ["brand", "coreContrast", "leaks", "typography", "varsExist"]);
}

// Accessibility fixer
{
  const fix = fixForeground("#8a8f98", "#ffffff", 4.5);
  assert.ok(fix && contrastRatio(fix.hex, "#ffffff") >= 4.5, fix);
  const before = hexToOklch("#8a8f98");
  const after = hexToOklch(fix.hex);
  assert.ok(Math.abs(before.h - after.h) < 4 && after.l < before.l, "darker, same hue");
  const onDark = fixForeground("#4a4a6a", "#101018", 4.5);
  assert.ok(hexToOklch(onDark.hex).l > hexToOklch("#4a4a6a").l, "lighter on a dark background");
  const normalized = {
    colorPalette: [
      { token: "color.surface.base", value: "#ffffff" },
      { token: "color.text.primary", value: "#1a1a1a" },
      { token: "color.text.muted", value: "#a0a4ab" }
    ],
    buttonVariants: [{ name: "primary", spec: { color: "#ffffff", background: "#ff8a3d" } }],
    linkSpec: { color: "#3b82f6" },
    cssVariables: [{ name: "--muted", value: "#a0a4ab" }],
    a11y: { worstPairs: [{ selector: "p.legal", foreground: "#c0c0c0", background: "#ffffff", ratio: 1.8, required: 4.5 }] }
  };
  assert.equal(collectContrastPairs(normalized).length, 5);
  const plan = planContrastFixes(normalized);
  assert.equal(plan.failing, 4, plan.pairs.map((pair) => `${pair.label}:${pair.ratio}`));
  assert.equal(plan.fixable, 4);
  assert.ok(plan.pairs.every((pair) => pair.pass || contrastRatio(pair.fix.hex, pair.bg) >= pair.required));
  assert.ok(plan.cssOverrides.includes("--muted:"), "CSS variable overridden");
  const button = plan.pairs.find((pair) => pair.source === "button");
  assert.ok(button.fix, "white text on orange gets a fix");
  const md = a11yFixMarkdown(plan, { title: "Demo" });
  assert.ok(md.includes("# A11Y_FIXES.md — Demo") && md.includes("`#a0a4ab`") && md.includes("```css"));
}

// Moodboard
{
  let { board, added } = addPins([], [
    { kind: "color", hex: "#FF7A00", role: "accent", sourceUrl: "https://a.com/x" },
    { kind: "font", family: "Fraunces", weight: "600", size: "48px", sourceUrl: "https://a.com/x" },
    { kind: "image", url: "https://cdn.a.com/hero.webp?w=800", alt: "Hero", sourceUrl: "https://a.com/x" },
    { kind: "section", heading: "Nos offres", role: "pricing", image: "data:image/jpeg;base64,AAAA", sourceUrl: "https://b.com/" },
    { kind: "text", text: "Du bois qui dure.", sourceUrl: "https://b.com/" }
  ]);
  assert.equal(added, 5);
  ({ board, added } = addPins(board, [{ kind: "color", hex: "#ff7a00", sourceUrl: "https://c.com" }]));
  assert.equal(added, 0, "same color not pinned twice");
  const block = moodboardPromptBlock(board);
  assert.ok(block.includes("#FF7A00 (accent)") && block.includes("Fraunces 600 48px") && block.includes("pricing “Nos offres”") && block.includes("“Du bois qui dure.”"));
  const files = buildMoodboardFiles(board);
  assert.deepEqual(files.map((file) => file.path).sort(), ["MOODBOARD.md", "captures/section-002.jpg", "images/003.webp", "moodboard.html"].sort());
  assert.ok(files.find((file) => file.path === "moodboard.html").content.includes("images/003.webp"), "board references the local copy");
  assert.ok(!moodboardHtml([{ kind: "text", text: "<script>x</script>", sourceUrl: "" }]).includes("<script>x"), "escaped");
  assert.equal(removePin(board, board[0].id).length, 4);
}

// Missing anatomy sections
{
  const doc = "# Mission line\n## Fonts\n## Color system\n## Sections\n### Hero\n## Motion system\n## Definition of done";
  const missing = missingAnatomySections(doc);
  assert.ok(missing.includes("Dependencies") && missing.includes("Responsive behaviour") && !missing.includes("Fonts") && !missing.includes("Motion system"), missing);
}

console.log("Intelligence tests passed.");
