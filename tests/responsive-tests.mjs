import assert from "node:assert/strict";
import {
  breakpointsInMedia,
  describeChange,
  generateResponsiveMarkdown,
  parseBreakpoints,
  responsivePromptBlock,
  summarizeResponsive,
  tailwindScreens
} from "../lib/responsive.mjs";

const bps = (text) => breakpointsInMedia(text).map(({ px, kind }) => `${kind}:${px}`);

// Media query parsing: px/em/rem, max-width bounds, level 4 ranges.
assert.deepEqual(bps("screen and (min-width: 768px)"), ["min:768"]);
assert.deepEqual(bps("(max-width: 767px)"), ["max:768"]);
assert.deepEqual(bps("(max-width:767.98px)"), ["max:768"]);
assert.deepEqual(bps("(min-width: 64em)"), ["min:1024"]);
assert.deepEqual(bps("(min-width: 40rem) and (max-width: 63.9375rem)"), ["min:640", "max:1024"]);
assert.deepEqual(bps("(width >= 48rem)"), ["min:768"]);
assert.deepEqual(bps("(width > 767px)"), ["min:768"]);
assert.deepEqual(bps("(width < 1024px)"), ["max:1024"]);
assert.deepEqual(bps("(width <= 1023px)"), ["max:1024"]);
assert.deepEqual(bps("(40em <= width < 64em)").sort(), ["max:1024", "min:640"]);
assert.deepEqual(bps("only screen and (max-device-width: 480px)"), ["max:481"]);
assert.deepEqual(bps("(min-height: 600px)"), [], "height is not a width breakpoint");
assert.deepEqual(bps("(min-aspect-ratio: 16/9)"), []);
assert.deepEqual(bps("(prefers-color-scheme: dark)"), []);
assert.deepEqual(bps("(min-width: 10px)"), [], "implausibly small values are dropped");

// Merging: 767px max-width and 768px min-width are the same breakpoint.
const parsed = parseBreakpoints([
  "(min-width: 768px)",
  "(max-width: 767px)",
  "(min-width: 768px)",
  "(min-width: 1024px)",
  "(min-width: 1024px) and (max-width: 1279px)",
  "(min-width: 1280px)",
  "print",
  "(min-width: 768px)"
]);
assert.deepEqual(parsed.all.map((entry) => entry.px), [768, 1024, 1280]);
assert.equal(parsed.all[0].count, 4);
assert.deepEqual(parsed.all[0].kinds, ["max", "min"]);
assert.equal(parsed.all[2].count, 2, "1280 counted once as max (1279) and once as min");
assert.deepEqual(parsed.primary.map((entry) => entry.px), [768, 1024, 1280]);
assert.equal(parsed.queries, 8);

// Tailwind screens: site values keep ordered Tailwind names.
const names = (list) => list.map((screen) => `${screen.name}=${screen.px}`).join(" ");
assert.equal(names(tailwindScreens(parseBreakpoints(["(min-width:640px)", "(min-width:768px)", "(min-width:1024px)", "(min-width:1280px)"]))), "sm=640 md=768 lg=1024 xl=1280");
assert.equal(names(tailwindScreens(parseBreakpoints(["(min-width:600px)", "(min-width:900px)", "(min-width:1200px)"]))), "sm=600 lg=900 xl=1200");
assert.equal(names(tailwindScreens(parseBreakpoints(["(min-width:1500px)", "(min-width:1600px)"]))), "xl=1500 2xl=1600");
const defaults = tailwindScreens(parseBreakpoints([]));
assert.equal(names(defaults), "sm=640 md=768 lg=1024 xl=1280");
assert.ok(defaults.every((screen) => !screen.fromSite));

// Summary from synthetic snapshots.
const snap = (width, extra) => ({
  width,
  height: 800,
  pageHeight: 3000 - width,
  nav: { mode: "inline", links: 5 },
  container: { width: null, gutter: 16 },
  type: { h1: { fontSize: 48, lineHeight: 52 }, h2: { fontSize: 30 }, body: { fontSize: 16, lineHeight: 24 } },
  sections: [
    { key: "e1", label: "Header", order: 0, columns: 3 },
    { key: "e9", label: "Features", order: 1, columns: 3 }
  ],
  overflow: { px: 0, culprits: [] },
  ...extra
});
const summary = summarizeResponsive({
  url: "https://example.com/",
  mediaTexts: ["(min-width: 768px)", "(min-width: 1024px)", "(min-width: 1024px)"],
  snapshots: [
    snap(1024, { container: { width: 960, gutter: 32 } }),
    snap(375, {
      nav: { mode: "toggle", links: 0 },
      type: { h1: { fontSize: 32, lineHeight: 36 }, h2: { fontSize: 24 }, body: { fontSize: 16, lineHeight: 24 } },
      sections: [
        { key: "e1", label: "Header", order: 0, columns: 2 },
        { key: "e9", label: "Features", order: 1, columns: 1 }
      ],
      overflow: { px: 40, culprits: ["div.wide"] }
    }),
    snap(768, { sections: [{ key: "e1", label: "Header", order: 0, columns: 3 }, { key: "e9", label: "Features", order: 1, columns: 2 }] })
  ],
  visibility: [{ label: "aside.sidebar", visibleAt: [1024] }]
});
assert.deepEqual(summary.widths, [375, 768, 1024], "snapshots sorted by width");
assert.equal(summary.transitions.length, 2);
const first = summary.transitions[0];
assert.deepEqual(first.breakpoints, [768]);
const firstText = first.changes.map((change) => describeChange(change, "fr"));
assert.ok(firstText.includes("Navigation : bouton menu → 5 liens visibles"), firstText.join(" | "));
assert.ok(firstText.includes("« Features » : 1 → 2 colonnes"), firstText.join(" | "));
assert.ok(firstText.includes("« Header » : 2 → 3 colonnes"));
assert.ok(firstText.includes("Titre h1 : 32px → 48px"));
assert.ok(!firstText.some((text) => text.startsWith("Texte courant")), "unchanged body size is not reported");
const second = summary.transitions[1];
assert.deepEqual(second.breakpoints, [1024]);
const secondText = second.changes.map((change) => describeChange(change, "en"));
assert.ok(secondText.includes('"Features": 2 → 3 columns'), secondText.join(" | "));
assert.ok(secondText.includes("Appears: aside.sidebar"));
assert.ok(secondText.includes("Container: full width, gutter 16px → 960px centered"), secondText.join(" | "));
assert.deepEqual(summary.screens.map((screen) => screen.px), [768, 1024]);
assert.deepEqual(summary.fluid, [], "h1 changes once: stepped, not fluid");

const md = generateResponsiveMarkdown(summary, { withScreenshots: true });
assert.match(md, /^# Responsive — example\.com/);
assert.match(md, /Main breakpoints: \*\*768px\*\*, \*\*1024px\*\*/);
assert.match(md, /\| Navigation \| menu button \| 5 visible links \| 5 visible links \|/);
assert.match(md, /\| Features \| 1 \| 2 \| 3 \|/);
assert.match(md, /### 375px → 768px — CSS breakpoints in between: 768px/);
assert.match(md, /\*\*375px\*\*: the page is 40px wider than the viewport\. Elements past the edge: div\.wide/);
assert.match(md, /--breakpoint-md: 48rem; --breakpoint-lg: 64rem;/);
assert.match(md, /`responsive\/`/);
assert.ok(!/[àéèçù]/.test(md.replace(/example/g, "")), "the generated file is English");

const block = responsivePromptBlock(summary);
assert.match(block, /^Breakpoints \(CSS\): 768px, 1024px\./);
assert.match(block, /375→768px: Navigation: menu button → 5 visible links/);

// Stacked menu links and a page without a viewport meta tag.
const phone = summarizeResponsive({
  url: "https://example.com/",
  snapshots: [
    { width: 375, layoutWidth: 980, nav: { mode: "stacked", links: 5 }, type: {}, sections: [] },
    { width: 768, nav: { mode: "inline", links: 5 }, type: {}, sections: [] }
  ]
});
assert.equal(describeChange(phone.transitions[0].changes[0], "fr"), "Navigation : 5 liens empilés → 5 liens visibles");
assert.equal(phone.viewports[0].layoutWidth, 980);
assert.equal(phone.viewports[1].layoutWidth, 768, "layout width defaults to the requested width");
assert.match(generateResponsiveMarkdown(phone), /At 375px the page lays out 980px wide: no `<meta name="viewport">`/);

// A section that stops being a top-level block is not reported as hidden.
const regrouped = summarizeResponsive({
  snapshots: [
    { width: 375, sections: [{ key: "e3", label: "Intro", order: 0, columns: 1 }] },
    { width: 768, sections: [] }
  ]
});
assert.equal(regrouped.transitions[0].changes.length, 0);

// Fluid type: a size that moves at every width.
const fluid = summarizeResponsive({
  snapshots: [375, 768, 1440].map((width, i) => ({ width, type: { h1: { fontSize: 30 + i * 9 } }, sections: [] }))
});
assert.deepEqual(fluid.fluid, ["h1"]);
assert.match(generateResponsiveMarkdown(fluid), /No width media query found/);

console.log("Responsive tests passed.");
