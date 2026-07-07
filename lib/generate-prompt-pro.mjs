import { buildAtmosphereDescription, inferSpacingBase, splitTokenValue } from "./generate-design-md.mjs";

/**
 * PROMPT PRO — adapts the extracted design DNA to the USER'S project.
 *
 * The user describes what they want to build; the engine fuses that
 * with everything measured on the target site and produces a master
 * prompt that rebuilds the user's project with the target's design
 * language. Two engines:
 *
 *  - AI (Groq / OpenAI / any OpenAI-compatible endpoint): the design
 *    digest + base prompt + project description are sent to the model,
 *    which writes a bespoke adaptation. The API key lives ONLY in
 *    chrome.storage.local — never in this repository.
 *  - Local template: no key needed; deterministic merge of the project
 *    description into the measured design system.
 */

export const AI_PROVIDERS = {
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile"
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini"
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    defaultModel: ""
  }
};

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

export function buildProMessages({ digest, description, basePrompt }) {
  const system = [
    "You are an elite prompt engineer and design director. You write master prompts that coding agents follow to build production websites.",
    "You receive: (1) the measured DESIGN DNA of a reference website, (2) the USER PROJECT to build, (3) a BASE PROMPT that rebuilds the reference site literally.",
    "Write a complete PROMPT_PRO.md that instructs a coding agent to build the USER'S project while inheriting the reference site's design DNA exactly: same tokens, typography system, spacing grid, radii, motion language, and section rhythm.",
    "Rules: keep every measured value verbatim (colors, sizes, ratios, durations) — never invent new tokens. Remap each measured section to the user's content: same layout skeleton, new purpose, and write concrete suggested copy (headlines, CTAs) fitting the user's project and language. If the user's project needs a section the reference lacks, design it strictly from the same tokens and say so. Keep the structure of the base prompt (mission, stack, tokens, build order, components, motion, responsive, definition of done). Answer in the user's language. Output ONLY the markdown document, no preamble."
  ].join("\n");

  const user = [
    "=== DESIGN DNA (measured) ===",
    digest,
    "",
    "=== USER PROJECT ===",
    description,
    "",
    "=== BASE PROMPT (literal rebuild of the reference site) ===",
    basePrompt.slice(0, 9000)
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

/**
 * Calls an OpenAI-compatible chat completions endpoint.
 * `fetchImpl` is injectable for tests.
 */
export async function callChatCompletion({ provider = "groq", apiKey, model, baseUrl, messages, fetchImpl }) {
  const providerConfig = AI_PROVIDERS[provider] || AI_PROVIDERS.groq;
  const url = `${(baseUrl || providerConfig.baseUrl).replace(/\/$/, "")}/chat/completions`;
  const usedModel = model || providerConfig.defaultModel;
  if (!apiKey) {
    throw new Error("No API key configured.");
  }
  if (!usedModel) {
    throw new Error("No model configured for this provider.");
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: usedModel,
      messages,
      temperature: 0.6,
      max_tokens: 4096
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI API error ${response.status}: ${detail.slice(0, 200)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI API returned no content.");
  }
  return { content: String(content), model: usedModel };
}

export async function generateAiPromptPro({ normalized, basePrompt, description, settings, fetchImpl }) {
  const digest = buildDesignDigest(normalized);
  const messages = buildProMessages({ digest, description, basePrompt });
  const { content, model } = await callChatCompletion({
    provider: settings.provider,
    apiKey: settings.apiKey,
    model: settings.model,
    baseUrl: settings.baseUrl,
    messages,
    fetchImpl
  });
  const header = `<!-- PROMPT_PRO.md — generated by Keys_Osi_Design.md-extractor (${settings.provider || "groq"}/${model}) from ${normalized.source?.url || "?"} -->\n\n`;
  return header + content.trim() + "\n";
}

/** Deterministic no-API fallback: measured DNA + project adaptation rules. */
export function generateLocalPromptPro(normalized, description, basePrompt) {
  const name = (normalized.source?.title || "the reference site").replace(/\s*[|\-].*$/, "").trim();
  const structure = normalized.structure || [];

  const remap = structure.map((block, index) => {
    const skeleton = [
      block.layout ? `layout ${block.layout}${block.columns > 1 ? ` (${block.columns} columns)` : ""}` : null,
      `background ${block.background}`,
      `padding-y ${block.paddingY}`,
      `≈${block.height}px`
    ].filter(Boolean).join(", ");
    return `${index + 1}. Reuse the **${block.role}** skeleton (${skeleton}) — replace its content with the equivalent for YOUR project${block.ctas.length > 0 ? `; keep the CTA prominence (source had ${block.ctas.map((cta) => `"${cta}"`).join(", ")})` : ""}.`;
  });

  return [
    `# PROMPT_PRO.md — Build YOUR project with the design DNA of "${name}"`,
    "",
    "> Local template engine (no AI key configured). For a richer, fully",
    "> tailored adaptation, add an AI API key in the PRO settings.",
    "",
    "## Your project",
    description.trim(),
    "",
    "## The rule of the game",
    `Build the project described above so it looks and feels like ${name}: inherit **every** measured token, the typography system, the spacing grid, the radii, and the motion language from the base prompt below. Adapt only the content, the copy, the imagery, and the section purposes to the project. Never invent a new color, size, or animation — if you need something the reference lacks, compose it from the existing tokens.`,
    "",
    "## Section remapping plan",
    ...(remap.length > 0 ? remap : ["Mirror the reference's section rhythm and repurpose each section for the project."]),
    "",
    "## Copy guidelines",
    "- Rewrite every headline and CTA for the project above, in its language, matching the reference's tone (headline length, capitalization, punchiness).",
    "- Replace images with project-appropriate visuals at the same dimensions and treatment.",
    "",
    "---",
    "",
    "# Reference design system (measured — inherit verbatim)",
    "",
    (basePrompt || "").replace(/^# PROMPT\.md[^\n]*\n/, "").trim(),
    ""
  ].join("\n");
}
