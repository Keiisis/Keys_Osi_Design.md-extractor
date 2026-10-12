import { buildAtmosphereDescription, inferSpacingBase, splitTokenValue } from "./generate-design-md.mjs";
import { AI_PROVIDERS, callAI } from "./ai-client.mjs";
import { MOTION_RECIPES, PROMPT_ANATOMY, QUALITY_BAR, buildPlaybookBrief } from "./prompt-pro-playbook.mjs";

/**
 * PROMPT PRO — adapts the extracted design DNA to the USER'S project.
 *
 * The user describes what they want to build; the engine fuses that
 * with everything measured on the target site and with the Keys_Osi
 * playbook (lib/prompt-pro-playbook.mjs: project archetypes, section
 * maps, motion recipes with numbers, document anatomy, quality bar),
 * and produces a build-ready master prompt. Two engines:
 *
 *  - AI (Groq / OpenAI / Claude / Kimi / New API gateways / any
 *    OpenAI-compatible endpoint, via lib/ai-client.mjs): digest +
 *    playbook + base prompt + project brief (+ optional screenshots).
 *    The API key lives ONLY in chrome.storage.local, never in this repo.
 *  - Local engine: no key needed; deterministic, implementation-grade
 *    document built from the same playbook and measurements.
 */

export { AI_PROVIDERS };

/** Compact, LLM-friendly summary of everything measured on the site. */
export function buildDesignDigest(normalized) {
  const lines = [];
  lines.push(`SITE: ${normalized.source?.title || "?"} — ${normalized.source?.url || "?"}`);
  lines.push(`ATMOSPHERE: ${buildAtmosphereDescription(normalized)}`);

  const palette = (normalized.colorPalette || [])
    .slice(0, 10)
    .map((row) => `${row.token}=${splitTokenValue(row.value).raw}`)
    .join(" | ");
  if (palette) lines.push(`COLORS: ${palette}`);

  const font = normalized.mainFontStyle;
  if (font?.familyStack) {
    lines.push(`FONT: ${font.familyStack} (base ${font.size || "?"}/${font.lineHeight || "?"}, weight ${font.weight || "?"})`);
  }
  const headings = (normalized.headings || [])
    .map((h) => `${h.level}:${h.fontSize}/${h.fontWeight}${h.textTransform !== "none" ? "/" + h.textTransform : ""}`)
    .join(" ");
  if (headings) lines.push(`HEADINGS: ${headings}`);

  const base = inferSpacingBase(normalized.spacingScale);
  lines.push(`SPACING GRID: ${base ? base + "px" : "?"} | RADII: ${(normalized.radiusTokens || []).map((r) => splitTokenValue(r.value).raw).join(",") || "?"} | SHADOWS: ${(normalized.shadowTokens || []).slice(0, 2).map((r) => splitTokenValue(r.value).raw).join(" ; ") || "none"}`);

  const structure = (normalized.structure || [])
    .map((block, index) => {
      const bits = [block.role];
      if (block.heading) bits.push(`"${block.heading}"`);
      if (block.layout) bits.push(block.layout + (block.columns > 1 ? `x${block.columns}` : ""));
      bits.push(`~${block.height}px`);
      return `${index + 1}.${bits.join(" ")}`;
    })
    .join(" → ");
  if (structure) lines.push(`STRUCTURE: ${structure}`);

  const buttons = (normalized.buttonVariants || [])
    .map((variant) => `${variant.name}{bg:${variant.spec.background},color:${variant.spec.color},radius:${variant.spec.borderRadius},pad:${variant.spec.padding}}`)
    .join(" ");
  if (buttons) lines.push(`BUTTONS: ${buttons}`);

  const motion = [];
  for (const keyframe of (normalized.keyframes || []).slice(0, 5)) motion.push(`@keyframes ${keyframe.name}`);
  for (const st of (normalized.scrollTriggers || []).slice(0, 5)) {
    if (st.trigger || Object.keys(st.animation || {}).length > 0) {
      motion.push(`ScrollTrigger ${st.trigger || "?"}${st.pin ? "(pin)" : ""}${st.scrub ? "(scrub)" : ""}:${Object.entries(st.animation || {}).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(",")}`);
    }
  }
  for (const layer of (normalized.parallax?.measured || []).slice(0, 3)) motion.push(`parallax ${layer.selector}@${layer.speedRatio}x`);
  for (const lib of (normalized.animationLibs || []).slice(0, 6)) motion.push(lib.name);
  if (motion.length > 0) lines.push(`MOTION: ${motion.join(" | ")}`);

  const breakpoints = (normalized.breakpoints || []).map((item) => `${item.px}px`).join(",");
  if (breakpoints) lines.push(`BREAKPOINTS: ${breakpoints}`);

  const stack = (normalized.stack || []).map((item) => item.name).join(", ");
  if (stack) lines.push(`SOURCE STACK: ${stack}`);

  return lines.join("\n").slice(0, 6000);
}

export function buildProMessages({ digest, description, basePrompt, screenshots, playbook, context = [] }) {
  const brief = playbook || buildPlaybookBrief({ description });
  const system = [
    "You are Keys_Osi PROMPT PRO: an elite design director and prompt engineer. You write build-ready master prompts that coding agents (Claude Code, Cursor, Bolt, v0, Lovable) execute to ship production websites in one pass.",
    "Inputs: (1) the measured DESIGN DNA of a reference website, (2) the USER PROJECT brief, (3) a PLAYBOOK (project type, section map, motion recipes with numbers, required anatomy, quality bar), (4) a BASE PROMPT that rebuilds the reference literally.",
    "Output: a complete PROMPT_PRO.md that builds the USER'S project while inheriting the reference's design DNA: same tokens, typography system, spacing grid, radii, shadows, motion language and section rhythm.",
    "Hard rules:",
    "- Keep every measured value verbatim (colors, sizes, line-heights, radii, shadows, durations, easings, breakpoints) — never invent new tokens; compose new needs from existing ones and say so.",
    "- Follow the playbook anatomy in order, one heading per block. Each page section gets: purpose, layout, exact Tailwind classes for key elements, the real copy written for the user's project in the copy language, media (exact source or a precise art-direction brief + stock search query), hover/focus states, and its animation with trigger, from→to values, duration, delay/stagger and easing.",
    "- Respect the user's explicit wishes (sections, tone, audience, language) over the playbook defaults.",
    "- Include data arrays for repeated content with every field filled (features, testimonials, pricing, stats, menu items...).",
    "- Mobile behaviour, accessibility (contrast, focus-visible, aria, alt) and prefers-reduced-motion are mandatory.",
    "- End with Dependencies, Key patterns and a checkable Definition of done.",
    "- Density over fluff: aim for 7,000–15,000 characters, no filler sentences, no generic adjectives without numbers.",
    ...(context.some((block) => block.brand)
      ? ["- A BRAND KIT is provided: its colors and fonts REPLACE the reference palette and fonts everywhere (CSS variables, Tailwind config, components). Keep the reference's spacing, radii, shadows, motion and layout rhythm."]
      : []),
    ...(context.length ? ["- Use every CONTEXT block below (brand kit, moodboard, site structure, page signals): they come from the user and override generic choices."] : []),
    "Think briefly: spend your budget on writing the document, not on deliberation.",
    "Output ONLY the markdown document (no preamble, no closing remarks)."
  ].join("\n");

  const visionNote = screenshots && screenshots.length > 0
    ? "\nThe attached screenshots show the reference site's actual composition and art direction. Ground the adaptation in what you SEE (asymmetry, overlap, whitespace, image treatment), not only in the numbers."
    : "";

  const userText = [
    "=== DESIGN DNA (measured) ===",
    digest,
    "",
    "=== USER PROJECT ===",
    description,
    "",
    "=== PLAYBOOK ===",
    brief.text,
    "",
    ...context.flatMap((block) => ["", `=== ${block.title} ===`, block.text]),
    "",
    "=== BASE PROMPT (literal rebuild of the reference site) ===",
    String(basePrompt || "").slice(0, 9000),
    visionNote
  ].join("\n");

  const userMessage = { role: "user", text: userText };
  if (screenshots && screenshots.length > 0) {
    userMessage.images = screenshots.slice(0, 4).map((base64) => ({ mediaType: "image/png", base64 }));
  }
  return [{ role: "system", text: system }, userMessage];
}

/** Messages + playbook for an AI PROMPT_PRO run (also used by the offscreen runner). */
export function buildAiProRequest({ normalized, basePrompt, description, screenshots, context = [] }) {
  const playbook = buildPlaybookBrief({ description, normalized });
  const messages = buildProMessages({ digest: buildDesignDigest(normalized), description, basePrompt, screenshots, playbook, context });
  return { messages, archetypes: playbook.archetypes.map((a) => a.id) };
}

export function wrapAiProOutput({ content, provider, model, sourceUrl, archetypes, vision }) {
  const header = `<!-- PROMPT_PRO.md — generated by Keys_Osi_Design.md-extractor (${provider}/${model}${vision ? ", vision-grounded" : ""}) from ${sourceUrl || "?"} · ${archetypes.join("+")} -->\n\n`;
  return header + content.trim() + "\n";
}

/**
 * Streams the document and, when the output is cut by the token budget
 * (long reasoning on large prompts), asks the model to continue exactly
 * where it stopped — up to 3 continuations.
 */
export async function runAiPromptPro({ messages, settings, fetchImpl, onProgress }) {
  let document = "";
  let used = null;
  let retriedEmpty = false;
  const conversation = [...messages];
  const continueFrom = () =>
    conversation.push(
      { role: "assistant", text: document },
      { role: "user", text: "Continue the document exactly where it stopped — mid-sentence if needed. No repetition, no preamble, no commentary." }
    );
  for (let round = 0; round < 4; round++) {
    let result;
    try {
      result = await callAI({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: used?.model || settings.model,
        baseUrl: settings.baseUrl,
        messages: conversation,
        temperature: 0.5,
        // Reasoning models spend part of the budget thinking before writing.
        maxTokens: 32000,
        // Streamed: long generations survive 100 s proxy cut-offs (HTTP 524)
        // and the popup can show live progress. timeoutMs = max silence.
        timeoutMs: 120000,
        stream: true,
        onDelta: (chars, reasoning) => onProgress?.(document.length + chars, reasoning, round),
        fetchImpl,
        avoidModels: settings.avoidModels || []
      });
    } catch (error) {
      // A dropped stream keeps its partial text: continue from it. With
      // nothing received yet, retry the same request once.
      if (error.partialText) {
        document += error.partialText;
        continueFrom();
        continue;
      }
      if (!retriedEmpty && !error.status) {
        retriedEmpty = true;
        continue;
      }
      throw error;
    }
    used = result;
    document += result.content;
    if (!result.truncated) break;
    continueFrom();
  }
  if (!document.trim()) throw new Error("L'IA n'a rien renvoyé après plusieurs tentatives.");
  return { content: document, model: used?.model || settings.model, provider: used?.provider || settings.provider };
}

export async function generateAiPromptPro({ normalized, basePrompt, description, settings, screenshots, fetchImpl, onProgress }) {
  const { messages, archetypes } = buildAiProRequest({ normalized, basePrompt, description, screenshots });
  const { content, model, provider } = await runAiPromptPro({ messages, settings, fetchImpl, onProgress });
  return wrapAiProOutput({ content, provider, model, sourceUrl: normalized.source?.url, archetypes, vision: Boolean(screenshots && screenshots.length) });
}

/* ------------------------------------------------------------------ *
 * Local engine (no API key): deterministic, implementation-grade.
 * ------------------------------------------------------------------ */

// Sections the user names explicitly, kept in the order they are mentioned.
const SECTION_WORDS = [
  [/\b(menu|carte)\b/i, "Menu"],
  [/réserv|booking|\bbook\b|rendez-vous|appointment/i, "Réservation / booking"],
  [/avis|review|testimon|témoign/i, "Avis / testimonials"],
  [/galerie|gallery|réalisations|projets|projects|\bwork\b|portfolio/i, "Galerie / réalisations"],
  [/tarif|pricing|\bprix\b|\bplans?\b|abonnement|subscription/i, "Tarifs / pricing"],
  [/\bfaq\b|questions/i, "FAQ"],
  [/équipe|\bteam\b/i, "Équipe / team"],
  [/événement|event|privatis/i, "Événements / events"],
  [/\bblog\b|articles|actualités|news/i, "Blog / news"],
  [/services?\b|prestations/i, "Services"],
  [/fonctionnalit|features?\b/i, "Features"],
  [/à propos|about|histoire|story|notre mission/i, "À propos / story"],
  [/newsletter/i, "Newsletter"],
  [/statisti|chiffres|metrics|stats/i, "Chiffres clés / stats"],
  [/partenaires|partners|clients|logos/i, "Logos partenaires"],
  [/contact|localisation|location|horaires|hours|adresse|\bmap\b/i, "Contact / localisation"]
];

export function extractRequestedSections(description) {
  const text = String(description || "");
  return SECTION_WORDS.map(([re, name]) => ({ name, at: text.search(re) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.name);
}

function dependenciesFor(normalized, recipes) {
  const deps = ["react", "react-dom", "tailwindcss", "motion", "lucide-react"];
  if (recipes.includes("scrollScrub") || recipes.includes("pageLoader")) deps.push("gsap");
  if (recipes.includes("hlsVideo")) deps.push("hls.js");
  if (recipes.includes("three")) deps.push("three", "@react-three/fiber", "@react-three/drei");
  if ((normalized.animationLibs || []).some((lib) => /lenis/i.test(lib.name))) deps.push("lenis");
  return deps;
}

function cssVar(token) {
  return `--${String(token).replace(/^color\./, "").replace(/\./g, "-")}`;
}

/** Anatomy blocks whose heading is absent from a generated document. */
export function missingAnatomySections(markdown) {
  const headings = String(markdown || "")
    .split("\n")
    .filter((line) => /^#{1,4}\s/.test(line))
    .map((line) => line.toLowerCase());
  const keyword = (title) => title.toLowerCase().split(/[\s&]+/)[0];
  return PROMPT_ANATOMY.map(([title]) => title).filter((title) => !headings.some((line) => line.includes(keyword(title))));
}

export function generateLocalPromptPro(normalized, description, basePrompt, context = []) {
  const name = (normalized.source?.title || "the reference site").replace(/\s*[|\-–].*$/, "").trim() || "the reference site";
  const playbook = buildPlaybookBrief({ description, normalized });
  const [archetype] = playbook.archetypes;
  const structure = normalized.structure || [];
  const requested = extractRequestedSections(description);
  const sectionNames =
    requested.length >= 2
      ? ["Navigation", "Hero", ...requested.filter((n) => !/contact/i.test(n)), ...requested.filter((n) => /contact/i.test(n)), "Footer"]
      : archetype.sections;
  const deps = dependenciesFor(normalized, playbook.recipes);
  const font = normalized.mainFontStyle || {};
  const families = Array.from(new Set([font.primaryFamily, ...(normalized.headings || []).map((h) => h.fontFamily)].filter(Boolean)));
  const raw = (value) => splitTokenValue(value).raw;

  // Pair each planned section with the closest measured skeleton.
  const skeletonFor = (sectionName, index) => {
    const lower = sectionName.toLowerCase();
    const byRole = structure.find(
      (block) =>
        (lower.includes("nav") && block.role.startsWith("header")) ||
        (lower.includes("hero") && block.role.startsWith("hero")) ||
        (lower.includes("footer") && block.role === "footer") ||
        (/(tarif|pricing)/.test(lower) && block.role === "pricing") ||
        (/(avis|testimon)/.test(lower) && block.role === "testimonials") ||
        (lower.includes("faq") && block.role === "faq") ||
        (/(contact|réserv|booking|newsletter)/.test(lower) && block.role === "contact/form") ||
        (/(galerie|gallery|features|services)/.test(lower) && block.role === "features/gallery")
    );
    return byRole || structure[Math.min(index, structure.length - 1)] || null;
  };

  const sectionPlan = sectionNames.map((sectionName, index) => {
    const block = skeletonFor(sectionName, index);
    const skeleton = block
      ? `Reuse the **${block.role}** skeleton measured on ${name}: layout ${block.layout}${block.columns > 1 ? ` (${block.columns} columns)` : ""}, background ${block.background}, padding-y ${block.paddingY}, ≈${block.height}px tall${block.ctas.length ? `, CTA prominence like ${block.ctas.map((c) => `"${c}"`).join(", ")}` : ""}.`
      : "Compose it from the shared tokens (same container, paddings and card style as the measured sections).";
    const isHero = /hero/i.test(sectionName);
    return [
      `### Section ${index + 1} — ${sectionName}`,
      `- **Skeleton:** ${skeleton}`,
      `- **Content:** write the final ${playbook.language} copy for this section from the project brief (headline ≤ 8 words, one supporting sentence, CTA verbs). List every item (cards, menu lines, reviews, plans) as a data array with all fields filled.`,
      `- **Media:** ${isHero ? "hero visual — full-bleed photo or looping video matching the brief; overlay + bottom fade into the page background" : "only if it serves the content; give an art-direction brief (subject, framing, light, palette, ratio) and a stock search query"}.`,
      `- **Motion:** ${isHero ? "hero mount timeline + blur word reveal on the headline" : "fade-up stagger when 25% in view"} (numbers in §7).`
    ].join("\n");
  });

  const buttons = (normalized.buttonVariants || []).slice(0, 3).map(
    (variant) =>
      `- Button **${variant.name}**: background ${variant.spec.background}; color ${variant.spec.color}; radius ${variant.spec.borderRadius}; padding ${variant.spec.padding}; font ${variant.spec.fontSize}/${variant.spec.fontWeight}${variant.spec.border !== "none" ? `; border ${variant.spec.border}` : ""}.`
  );
  const headings = (normalized.headings || []).slice(0, 4).map(
    (h) => `- ${h.level.toUpperCase()}: ${h.fontFamily} ${h.fontSize}/${h.lineHeight}, weight ${h.fontWeight}, tracking ${h.letterSpacing}${h.textTransform !== "none" ? `, ${h.textTransform}` : ""}.`
  );
  const container = normalized.layout?.containerMaxWidth || "1280px";
  const sectionPad = normalized.layout?.sectionPaddings?.[0]?.value || "96px";
  const spacingBase = inferSpacingBase(normalized.spacingScale);
  const measuredMotion = [
    ...(normalized.motionDurationTokens || []).slice(0, 4).map((row) => `duration ${raw(row.value)}`),
    ...(normalized.motionEasingTokens || []).slice(0, 3).map((row) => `easing ${raw(row.value)}`),
    ...(normalized.keyframes || []).slice(0, 4).map((kf) => `@keyframes ${kf.name}`)
  ];

  return [
    `# PROMPT_PRO.md — Build YOUR project with the design DNA of "${name}"`,
    "",
    "> Generated by the Keys_Osi local engine (no AI key configured). Add an AI key in PRO for fully written copy and a deeper adaptation.",
    "",
    "## 0. Mission",
    `Build a ${archetype.label.toLowerCase()} website for the project below — ${sectionNames.length} sections — inheriting the visual system of ${name}. Stack: React + Vite + TypeScript + Tailwind CSS + motion/react + lucide-react${deps.includes("gsap") ? " + GSAP (ScrollTrigger)" : ""}${deps.includes("three") ? " + @react-three/fiber" : ""}. All copy in ${playbook.language}.`,
    "",
    "## 1. Project brief (from the user)",
    description.trim(),
    "",
    "## 2. Fonts",
    families.length
      ? `${families.map((family) => `- **${family}** — load via Google Fonts (<link> with display=swap) or @fontsource/${family.toLowerCase().replace(/\s+/g, "-")}.`).join("\n")}\n- Body: ${font.familyStack || families[0]} at ${font.size || "16px"}/${font.lineHeight || "1.5"}, weight ${font.weight || "400"}.`
      : "- Use the reference font stack from the measured system below.",
    ...headings,
    "",
    "## 3. Color system (verbatim from the reference)",
    "```css",
    ":root {",
    ...(normalized.colorPalette || []).slice(0, 14).map((row) => `  ${cssVar(row.token)}: ${raw(row.value)};`),
    "}",
    "```",
    "Register each variable in tailwind.config `theme.extend.colors` (e.g. `'surface-base': 'var(--surface-base)'`).",
    "",
    "## 4. Surfaces & utilities",
    `- Radii: ${(normalized.radiusTokens || []).map((r) => raw(r.value)).join(", ") || "from the measured system"}.`,
    `- Shadows: ${(normalized.shadowTokens || []).slice(0, 3).map((r) => `\`${raw(r.value)}\``).join(" · ") || "none measured (flat surfaces)"}.`,
    ...(normalized.gradientTokens || []).slice(0, 2).map((r) => `- Gradient: \`${raw(r.value)}\`.`),
    ...buttons,
    "",
    "## 5. Global layout",
    `- Container max-width ${container}, centered, side padding 24px (16px under 640px).`,
    `- Section padding-y ${sectionPad}${spacingBase ? `; spacing grid ${spacingBase}px` : ""}.`,
    `- Breakpoints: ${(normalized.breakpoints || []).map((b) => `${b.px}px`).join(", ") || "640, 768, 1024, 1280px"}.`,
    "",
    "## 6. Sections (in order)",
    ...sectionPlan,
    "",
    "## 7. Motion system",
    ...playbook.recipes.map((key) => `- ${MOTION_RECIPES[key]}`),
    ...(measuredMotion.length ? [`- Measured on the reference (keep these): ${measuredMotion.join(" · ")}.`] : []),
    "",
    "## 8. Responsive behaviour",
    "- Under 768px: single column, nav collapses to a full-screen menu, hero headline uses clamp(2.25rem, 8vw, 4.5rem), media crops to 4:5, CTAs full width.",
    "- No horizontal scroll at 375px; touch targets ≥ 44px.",
    "",
    "## 9. Accessibility & performance",
    "- Text contrast ≥ 4.5:1 (3:1 for ≥ 24px), visible focus-visible rings in the accent color, aria-label on icon buttons, alt text on every image, landmarks (header/main/footer).",
    "- Lazy-load below-the-fold media, video poster + preload=\"metadata\", font-display: swap, explicit width/height to avoid layout shift.",
    "",
    "## 10. Dependencies",
    `\`npm i ${deps.join(" ")}\``,
    "",
    "## 11. Key patterns",
    "- One heading style per level (§2), one card style (radius + shadow from §4), one button family (§4) used everywhere.",
    "- Same section padding and container width on every section; alternate surfaces only with the measured surface colors.",
    "- Every animation comes from §7; nothing animates longer than the measured durations without a reason.",
    "",
    "## 12. Definition of done",
    ...[
      "All sections of §6 present in order with final copy (no lorem ipsum).",
      "Only the colors/fonts/radii/shadows of §2–§4 appear in the CSS.",
      "Lighthouse accessibility ≥ 95, no console errors.",
      "prefers-reduced-motion disables transforms, marquees and autoplay.",
      "375px, 768px and 1440px screenshots look intentional."
    ].map((item) => `- [ ] ${item}`),
    "",
    "## Quality bar",
    ...QUALITY_BAR.map((rule) => `- ${rule}`),
    "",
    "## Document anatomy reference",
    ...PROMPT_ANATOMY.map(([title], index) => `${index + 1}. ${title}`),
    "",
    "---",
    "",
    ...context.flatMap((block) => [`# ${block.title}`, "", block.text, "", "---", ""]),
    "# Reference design system (measured — inherit verbatim)",
    "",
    String(basePrompt || "").replace(/^# PROMPT\.md[^\n]*\n/, "").trim(),
    ""
  ].join("\n");
}
