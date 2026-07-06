import { splitTokenValue } from "./generate-design-md.mjs";

/**
 * MOTION.md — dedicated, exhaustive motion report. Where DESIGN.md
 * summarizes, this file gives an agent everything needed to reproduce
 * the site's animation system: full keyframe steps, every interaction
 * rule, WAAPI runtime animations with their keyframes, GSAP timelines
 * and ScrollTriggers, measured parallax, WebGL scenes, and libraries.
 */
export function generateMotionMarkdown(context) {
  const { normalized } = context;
  const name = inferName(normalized.source?.title);
  const lines = [];

  lines.push(`# Motion & Animation — ${name}`);
  lines.push("");
  lines.push(`- Source: ${normalized.source?.url || "Unknown URL"}`);
  lines.push(`- Extracted: ${normalized.sampledAt || "unknown"}`);
  lines.push("");

  /* Overview */
  const counts = [
    `${(normalized.keyframes || []).length} @keyframes`,
    `${(normalized.runtimeAnimations || []).length} runtime animations (WAAPI)`,
    `${(normalized.interactionStyles || []).length} hover/focus/active rules`,
    `${(normalized.scrollTriggers || []).length} ScrollTriggers`,
    `${normalized.parallax?.measured?.length || 0} measured parallax layers`,
    `${normalized.webgl?.webglCount || 0} WebGL scenes`,
    `${(normalized.animationLibs || []).length} animation libraries`
  ];
  lines.push("## Overview");
  lines.push(counts.map((item) => `- ${item}`).join("\n"));
  lines.push("");

  /* Timing tokens */
  lines.push("## Timing Tokens");
  const durations = (normalized.motionDurationTokens || [])
    .map((row) => `\`${row.token}=${splitTokenValue(row.value).raw}\``)
    .join(", ");
  const easings = (normalized.motionEasingTokens || [])
    .map((row) => `\`${splitTokenValue(row.value).raw}\``)
    .join(", ");
  lines.push(`- Durations: ${durations || "none measured"}`);
  lines.push(`- Easings: ${easings || "none measured"}`);
  lines.push("");

  /* CSS keyframes with full steps */
  lines.push("## CSS @keyframes");
  const keyframes = normalized.keyframes || [];
  if (keyframes.length === 0) {
    lines.push("None captured.");
  }
  for (const keyframe of keyframes) {
    lines.push(`### \`@keyframes ${keyframe.name}\` (${keyframe.stepCount} steps)`);
    lines.push("```css");
    lines.push(`@keyframes ${keyframe.name} {`);
    for (const step of keyframe.steps || []) {
      lines.push(`  ${step}`);
    }
    lines.push("}");
    lines.push("```");
  }
  lines.push("");

  /* Interaction states */
  lines.push("## Interaction States (hover / focus / active)");
  const interactions = normalized.interactionStyles || [];
  if (interactions.length === 0) {
    lines.push("None captured.");
  }
  for (const rule of interactions) {
    lines.push(`- \`${rule.selector}\` → ${rule.declarations.map((decl) => `\`${decl}\``).join(", ")}`);
  }
  lines.push("");

  /* Runtime animations */
  lines.push("## Runtime Animations (Web Animations API)");
  const runtime = normalized.runtimeAnimations || [];
  if (runtime.length === 0) {
    lines.push("None running at extraction time.");
  }
  for (const animation of runtime) {
    const loop = animation.iterations === "infinite" ? ", infinite" : `, x${animation.iterations}`;
    lines.push(
      `- \`${animation.name || animation.type}\` on \`${animation.target || "?"}\` — ${Math.round(animation.duration)}ms ${animation.easing || "linear"}${animation.delay ? `, delay ${animation.delay}ms` : ""}${loop} (${animation.playState})`
    );
    if (animation.keyframes && animation.keyframes.length > 0) {
      lines.push(`  - keyframes: ${JSON.stringify(animation.keyframes)}`);
    }
  }
  lines.push("");

  /* GSAP */
  lines.push("## GSAP");
  if (normalized.gsap && normalized.gsap.detected) {
    lines.push(`Version ${normalized.gsap.version} — ${normalized.gsap.timelines.length} active timelines:`);
    for (const tween of normalized.gsap.timelines) {
      const values = tween.values && Object.keys(tween.values).length > 0
        ? Object.entries(tween.values).map(([key, value]) => `${key}: ${value}`).join(", ")
        : tween.vars.join(", ");
      const target = tween.targets && tween.targets.length > 0 ? ` on \`${tween.targets.join("`, `")}\`` : "";
      lines.push(`- ${tween.type} { ${values} }${target} — ${tween.duration}s${tween.delay ? `, delay ${tween.delay}s` : ""}`);
    }
  } else {
    lines.push("Not detected.");
  }
  lines.push("");

  /* ScrollTrigger */
  lines.push("## GSAP ScrollTrigger");
  const triggers = normalized.scrollTriggers || [];
  if (triggers.length === 0) {
    lines.push("Not detected.");
  } else {
    lines.push("| Trigger | Start | End | Scrub | Pin | Animation |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const st of triggers) {
      const animation = Object.entries(st.animation || {})
        .slice(0, 5)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      lines.push(
        `| \`${st.trigger || "?"}\` | ${st.start || "—"} | ${st.end || "—"} | ${st.scrub === true ? "yes" : st.scrub || "no"} | ${st.pin ? "yes" : "no"} | ${animation || "—"} |`
      );
    }
  }
  lines.push("");

  /* Parallax */
  lines.push("## Measured Parallax");
  const parallax = normalized.parallax || { measured: [], fixedBackgroundCount: 0 };
  if (parallax.measured.length === 0 && parallax.fixedBackgroundCount === 0) {
    lines.push("No scroll-linked movement measured.");
  }
  for (const layer of parallax.measured) {
    lines.push(`- \`${layer.selector}\` moves at **${layer.speedRatio}x** scroll speed (${layer.kind}).`);
  }
  if (parallax.fixedBackgroundCount > 0) {
    lines.push(`- ${parallax.fixedBackgroundCount} surface(s) use \`background-attachment: fixed\`.`);
  }
  lines.push("");

  /* WebGL */
  lines.push("## WebGL & Canvas");
  const webgl = normalized.webgl || { canvases: [] };
  if (webgl.canvases.length === 0) {
    lines.push("No canvas graphics detected.");
  }
  for (const canvas of webgl.canvases) {
    lines.push(
      `- \`${canvas.selector}\` — ${canvas.context}, ${canvas.width}x${canvas.height}${canvas.inViewport ? ", above the fold" : ""}`
    );
  }
  lines.push("");

  /* Libraries */
  lines.push("## Animation Libraries");
  const libs = normalized.animationLibs || [];
  if (libs.length === 0) {
    lines.push("None detected.");
  }
  for (const lib of libs) {
    lines.push(`- ${lib.name} (${lib.evidence})`);
  }
  lines.push("");

  /* Reproduction guide */
  lines.push("## Reproduction Guide");
  lines.push("1. Copy the `@keyframes` blocks above verbatim; attach them with the measured durations and easings.");
  lines.push("2. Recreate every interaction rule listed — hover and focus-visible states are part of the design, not an extra.");
  lines.push("3. Rebuild runtime animations with the Web Animations API or CSS using the exact duration/easing/keyframes captured.");
  if (triggers.length > 0) {
    lines.push("4. Reinstall GSAP + ScrollTrigger and recreate each trigger with the table above (same start/end/scrub/pin).");
  }
  if (parallax.measured.length > 0) {
    lines.push(`${triggers.length > 0 ? 5 : 4}. Reproduce parallax by updating each layer's transform at its measured speed ratio on scroll.`);
  }
  if (webgl.webglCount > 0) {
    lines.push("- WebGL scenes cannot be extracted: plan an equivalent canvas scene, a video loop, or static keyart of the same dimensions.");
  }
  lines.push("");

  return lines.join("\n");
}

function inferName(title) {
  if (!title) {
    return "Extracted Site";
  }
  return title.replace(/\s*\|\s*.*/g, "").replace(/\s*-\s*.*/g, "").trim() || "Extracted Site";
}
