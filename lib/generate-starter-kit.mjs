import { splitTokenValue } from "./generate-design-md.mjs";

/**
 * Design System Starter Kit: turns an extraction into ready-to-use code.
 *
 *  - tokens.css        every measured token as CSS custom properties
 *  - components.css    button variants, input, card, link, headings —
 *                      exact measured declarations, no framework needed
 *  - components.html   zero-build live preview of the whole system
 *  - react/*.jsx       thin React components over the CSS classes
 *  - README.md         usage
 */
export function generateStarterKit(normalized, options = {}) {
  const name = String(options.name || normalized.source?.title || "extracted").slice(0, 60);
  const tokensCss = buildTokensCss(normalized);
  const componentsCss = buildComponentsCss(normalized);
  const previewHtml = buildPreviewHtml(normalized, name);

  return [
    { path: "starter-kit/tokens.css", content: tokensCss },
    { path: "starter-kit/components.css", content: componentsCss },
    { path: "starter-kit/components.html", content: previewHtml },
    { path: "starter-kit/react/Button.jsx", content: buildReactButton(normalized) },
    { path: "starter-kit/react/Input.jsx", content: REACT_INPUT },
    { path: "starter-kit/react/Card.jsx", content: REACT_CARD },
    { path: "starter-kit/README.md", content: buildKitReadme(name) }
  ];
}

function buildTokensCss(normalized) {
  const lines = ["/* Design tokens measured from the source site. */", ":root {"];

  const push = (rows, prefix) => {
    for (const row of rows || []) {
      const { raw } = splitTokenValue(row.value);
      const key = row.token.replace(/\./g, "-");
      lines.push(`  --${prefix ? `${prefix}-` : ""}${key}: ${raw};`);
    }
  };

  push(normalized.colorPalette);
  push(normalized.typographyScale);
  push(normalized.spacingScale);
  push(normalized.radiusTokens);
  push(normalized.shadowTokens);
  push(normalized.motionDurationTokens);
  push(normalized.gradientTokens);

  const font = normalized.mainFontStyle;
  if (font && font.familyStack) {
    lines.push(`  --font-family-primary: ${font.familyStack};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function buildComponentsCss(normalized) {
  const blocks = ["/* Components generated from measured specs. */"];
  const font = normalized.mainFontStyle;

  blocks.push(
    [
      "body {",
      "  font-family: var(--font-family-primary, system-ui, sans-serif);",
      font && font.size ? `  font-size: ${font.size};` : null,
      font && font.lineHeight ? `  line-height: ${font.lineHeight};` : null,
      "  color: var(--color-text-primary, #111);",
      "  background: var(--color-surface-base, #fff);",
      "  margin: 0;",
      "}"
    ].filter(Boolean).join("\n")
  );

  for (const heading of normalized.headings || []) {
    blocks.push(
      [
        `${heading.level} {`,
        `  font-size: ${heading.fontSize};`,
        heading.lineHeight ? `  line-height: ${heading.lineHeight};` : null,
        `  font-weight: ${heading.fontWeight};`,
        heading.letterSpacing && heading.letterSpacing !== "normal" ? `  letter-spacing: ${heading.letterSpacing};` : null,
        heading.textTransform && heading.textTransform !== "none" ? `  text-transform: ${heading.textTransform};` : null,
        heading.marginTop ? `  margin-top: ${heading.marginTop};` : null,
        heading.marginBottom ? `  margin-bottom: ${heading.marginBottom};` : null,
        "}"
      ].filter(Boolean).join("\n")
    );
  }

  for (const variant of normalized.buttonVariants || []) {
    const spec = variant.spec;
    blocks.push(
      [
        `.ko-button--${variant.name} {`,
        `  background: ${spec.background};`,
        `  color: ${spec.color};`,
        `  border: ${spec.border};`,
        `  border-radius: ${spec.borderRadius};`,
        `  padding: ${spec.padding};`,
        `  font-size: ${spec.fontSize};`,
        `  font-weight: ${spec.fontWeight};`,
        spec.boxShadow ? `  box-shadow: ${spec.boxShadow};` : null,
        spec.textTransform ? `  text-transform: ${spec.textTransform};` : null,
        "  font-family: inherit;",
        "  cursor: pointer;",
        "  transition: filter var(--motion-duration-instant, 150ms) ease;",
        "}",
        `.ko-button--${variant.name}:hover { filter: brightness(0.92); }`,
        `.ko-button--${variant.name}:focus-visible { outline: 2px solid var(--color-focus-ring, currentColor); outline-offset: 2px; }`
      ].filter(Boolean).join("\n")
    );
  }

  const control = normalized.formControl;
  if (control) {
    blocks.push(
      [
        ".ko-input {",
        `  height: ${control.height};`,
        `  padding: ${control.padding};`,
        `  border: ${control.border};`,
        `  border-radius: ${control.borderRadius};`,
        `  background: ${control.background};`,
        `  color: ${control.color};`,
        `  font-size: ${control.fontSize};`,
        "  font-family: inherit;",
        "  box-sizing: border-box;",
        "}",
        ".ko-input:focus-visible { outline: 2px solid var(--color-focus-ring, currentColor); outline-offset: 1px; }"
      ].join("\n")
    );
  }

  const shadow = (normalized.shadowTokens || [])[0];
  const radius = (normalized.radiusTokens || [])[1] || (normalized.radiusTokens || [])[0];
  blocks.push(
    [
      ".ko-card {",
      "  background: var(--color-surface-raised, var(--color-surface-base, #fff));",
      shadow ? `  box-shadow: ${splitTokenValue(shadow.value).raw};` : "  border: 1px solid var(--color-border-default, #e5e7eb);",
      radius ? `  border-radius: ${splitTokenValue(radius.value).raw};` : null,
      "  padding: var(--space-3, 16px);",
      "}"
    ].filter(Boolean).join("\n")
  );

  const link = normalized.linkSpec;
  if (link) {
    blocks.push(
      [
        ".ko-link {",
        `  color: ${link.color};`,
        `  text-decoration: ${link.textDecoration || "none"};`,
        `  font-weight: ${link.fontWeight};`,
        "}",
        ".ko-link:hover { text-decoration: underline; }"
      ].join("\n")
    );
  }

  return blocks.join("\n\n") + "\n";
}

function buildPreviewHtml(normalized, name) {
  const swatches = (normalized.colorPalette || [])
    .map((row) => {
      const { raw } = splitTokenValue(row.value);
      return `      <div class="swatch"><div class="chip" style="background:${raw}"></div><code>${row.token}</code><code>${raw}</code></div>`;
    })
    .join("\n");

  const buttons = (normalized.buttonVariants || [])
    .map((variant) => `      <button class="ko-button--${variant.name}">${variant.example || variant.name}</button>`)
    .join("\n");

  const headings = (normalized.headings || [])
    .map((heading) => `      <${heading.level}>Heading ${heading.level.toUpperCase()} — ${heading.fontSize}</${heading.level}>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(name)} — Starter Kit Preview</title>
  <link rel="stylesheet" href="tokens.css" />
  <link rel="stylesheet" href="components.css" />
  <style>
    main { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
    section { margin-bottom: 48px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .swatch { display: inline-flex; flex-direction: column; gap: 4px; margin: 0 12px 12px 0; font-size: 11px; }
    .chip { width: 72px; height: 44px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.08); }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(name)} — Design System Starter Kit</h1>
    <p>Generated by Keys_Osi_Design.md-extractor. Every value below was measured on the source site.</p>
    <section>
      <h2>Colors</h2>
      <div class="row">
${swatches}
      </div>
    </section>
    <section>
      <h2>Typography</h2>
${headings}
    </section>
    <section>
      <h2>Buttons</h2>
      <div class="row">
${buttons}
      </div>
    </section>
    <section>
      <h2>Form & Card</h2>
      <div class="row">
        <input class="ko-input" placeholder="Measured input" />
        <a class="ko-link" href="#">Measured link</a>
      </div>
      <br />
      <div class="ko-card" style="max-width:360px">
        <h3>Card title</h3>
        <p>This card uses the measured shadow, radius, and surface tokens.</p>
      </div>
    </section>
  </main>
</body>
</html>
`;
}

function buildReactButton(normalized) {
  const variants = (normalized.buttonVariants || []).map((variant) => variant.name);
  const union = variants.length > 0 ? variants.map((name) => `"${name}"`).join(" | ") : '"primary"';
  return `import "../components.css";

/**
 * Measured button. Variants: ${variants.join(", ") || "primary"}.
 * @param {{ variant?: ${union}, children: any }} props
 */
export function Button({ variant = "${variants[0] || "primary"}", children, ...rest }) {
  return (
    <button className={\`ko-button--\${variant}\`} {...rest}>
      {children}
    </button>
  );
}
`;
}

const REACT_INPUT = `import "../components.css";

export function Input(props) {
  return <input className="ko-input" {...props} />;
}
`;

const REACT_CARD = `import "../components.css";

export function Card({ children, ...rest }) {
  return (
    <div className="ko-card" {...rest}>
      {children}
    </div>
  );
}
`;

function buildKitReadme(name) {
  return `# ${name} — Design System Starter Kit

Generated by Keys_Osi_Design.md-extractor from measured values.

## Instant preview

Open \`components.html\` in a browser — no build step needed.

## Use in any project

1. Copy \`tokens.css\` and \`components.css\` into your styles.
2. Use the classes: \`ko-button--primary\`, \`ko-input\`, \`ko-card\`, \`ko-link\`.

## React

Copy the \`react/\` folder and import:

\`\`\`jsx
import { Button } from "./react/Button.jsx";

<Button variant="primary">Get started</Button>
\`\`\`

Pair with \`tailwind.config.js\` from the tokens export for utility-first work.
`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
