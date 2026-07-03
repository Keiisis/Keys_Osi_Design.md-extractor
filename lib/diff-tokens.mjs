/**
 * Compares two normalized extractions and produces a DIFF.md report:
 * added, removed and changed tokens per category, plus breakpoint and
 * profile changes. Useful for before/after redesign audits and
 * competitor comparisons.
 */

const TOKEN_GROUPS = [
  ["typographyScale", "Typography"],
  ["colorPalette", "Colors"],
  ["gradientTokens", "Gradients"],
  ["spacingScale", "Spacing"],
  ["radiusTokens", "Radius"],
  ["shadowTokens", "Shadows"],
  ["motionDurationTokens", "Motion durations"],
  ["motionEasingTokens", "Motion easings"]
];

export function diffNormalized(before, after) {
  const groups = [];

  for (const [key, label] of TOKEN_GROUPS) {
    const beforeMap = toTokenMap(before?.[key]);
    const afterMap = toTokenMap(after?.[key]);
    const added = [];
    const removed = [];
    const changed = [];

    for (const [token, value] of afterMap) {
      if (!beforeMap.has(token)) {
        added.push({ token, value });
      } else if (beforeMap.get(token) !== value) {
        changed.push({ token, before: beforeMap.get(token), after: value });
      }
    }
    for (const [token, value] of beforeMap) {
      if (!afterMap.has(token)) {
        removed.push({ token, value });
      }
    }

    if (added.length || removed.length || changed.length) {
      groups.push({ key, label, added, removed, changed });
    }
  }

  const beforeBp = (before?.breakpoints || []).map((item) => item.px);
  const afterBp = (after?.breakpoints || []).map((item) => item.px);
  const breakpointChange =
    JSON.stringify(beforeBp) !== JSON.stringify(afterBp) ? { before: beforeBp, after: afterBp } : null;

  const fontChange =
    (before?.mainFontStyle?.primaryFamily || "") !== (after?.mainFontStyle?.primaryFamily || "")
      ? {
          before: before?.mainFontStyle?.primaryFamily || "(none)",
          after: after?.mainFontStyle?.primaryFamily || "(none)"
        }
      : null;

  return {
    identical: groups.length === 0 && !breakpointChange && !fontChange,
    groups,
    breakpointChange,
    fontChange
  };
}

export function generateDiffMarkdown(before, after) {
  const diff = diffNormalized(before, after);
  const lines = [];

  lines.push("# Design Diff Report");
  lines.push("");
  lines.push(`- Before: ${before?.source?.url || "unknown"} (${before?.sampledAt || "unknown date"})`);
  lines.push(`- After: ${after?.source?.url || "unknown"} (${after?.sampledAt || "unknown date"})`);
  lines.push("");

  if (diff.identical) {
    lines.push("No token-level differences detected between the two extractions.");
    lines.push("");
    return lines.join("\n");
  }

  if (diff.fontChange) {
    lines.push("## Primary Font");
    lines.push(`- \`${diff.fontChange.before}\` → \`${diff.fontChange.after}\``);
    lines.push("");
  }

  if (diff.breakpointChange) {
    lines.push("## Breakpoints");
    lines.push(`- Before: ${diff.breakpointChange.before.map((px) => `${px}px`).join(", ") || "(none)"}`);
    lines.push(`- After: ${diff.breakpointChange.after.map((px) => `${px}px`).join(", ") || "(none)"}`);
    lines.push("");
  }

  for (const group of diff.groups) {
    lines.push(`## ${group.label}`);
    for (const item of group.changed) {
      lines.push(`- Changed \`${item.token}\`: \`${item.before}\` → \`${item.after}\``);
    }
    for (const item of group.added) {
      lines.push(`- Added \`${item.token}\` = \`${item.value}\``);
    }
    for (const item of group.removed) {
      lines.push(`- Removed \`${item.token}\` (was \`${item.value}\`)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function toTokenMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (row && row.token) {
      map.set(row.token, String(row.value ?? ""));
    }
  }
  return map;
}
