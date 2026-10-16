import assert from "node:assert/strict";
import {
  buildCloneProject,
  buildTokens,
  classFor,
  classesFor,
  cloneWidths,
  collectCloneAssets,
  contentValue,
  fluidFit,
  gridColumns,
  normalizeValue,
  parseFontFaces,
  planScreens,
  rgbToHex,
  sizeDeclarations,
  variantMaps,
  viewportHeightFit
} from "../lib/code-clone.mjs";

/* values */
assert.equal(rgbToHex("rgb(17, 20, 17)"), "#111411");
assert.equal(rgbToHex("rgba(0, 0, 0, 0.32)"), "#00000052");
assert.equal(rgbToHex("rgba(0, 0, 0, 0)"), "transparent");
assert.equal(normalizeValue("rgba(29, 36, 51, 0.08) 0px 8px 24px 0px"), "#1d243314 0 8px 24px 0");
assert.equal(normalizeValue('url("a.png")'), "url('a.png')");
assert.equal(normalizeValue("matrix(1, 0, 0, 1, 0, -12)"), "matrix(1,0,0,1,0,-12)");

/* classes */
assert.equal(classFor("display", "none"), "hidden");
assert.equal(classFor("display", "flex"), "flex");
assert.equal(classFor("display", "-webkit-box"), "[display:-webkit-box]");
assert.equal(classFor("width", "100%"), "w-full");
assert.equal(classFor("margin-left", "auto"), "ml-auto");
assert.equal(classFor("font-weight", "600"), "font-semibold");
assert.equal(classFor("font-size", "16px"), "text-[16px]");
assert.equal(classFor("color", "rgb(29, 36, 51)"), "text-[#1d2433]");
assert.equal(classFor("color", "rgb(29, 36, 51)", { colors: { "#1d2433": "ink" } }), "text-ink");
assert.equal(classFor("font-family", '"Inter", sans-serif', { fonts: { '"Inter", sans-serif': "inter" } }), "font-inter");
assert.equal(classFor("box-shadow", "rgba(0, 0, 0, 0.5) 0px 4px 6px 0px"), "shadow-[#00000080_0_4px_6px_0]");
assert.equal(classFor("grid-template-columns", "repeat(3,minmax(0,1fr))"), "grid-cols-3");
assert.equal(classFor("grid-template-columns", "120px minmax(0,1fr)"), "grid-cols-[120px_minmax(0,1fr)]");
assert.equal(classFor("aspect-ratio", "16 / 9"), "aspect-[16/9]");
assert.equal(classFor("mix-blend-mode", "multiply"), "[mix-blend-mode:multiply]");
assert.equal(classFor("display", "revert"), "[display:revert]");
assert.equal(classFor("line-height", "normal"), "[line-height:normal]");
assert.equal(classFor("grid-template-areas", '"a b" "c d"'), "[grid-template-areas:'a_b'_'c_d']");
assert.equal(classFor("font-feature-settings", '"ss_01"'), "[font-feature-settings:'ss\\_01']", "real underscores are escaped");
assert.equal(classFor("content", "'\\201c_'"), "content-['\\201c_']");
// Page-controlled URLs cannot inject code into the generated source.
const hostile = classFor("background-image", 'url("https://x.test/a.png?q=${process.exit(1)}`x`")');
assert.ok(!hostile.includes("${") && !hostile.includes("`"), hostile);

const sides = (prefix, values) => Object.fromEntries(["top", "right", "bottom", "left"].map((side, i) => [`${prefix}-${side}`, values[i]]));
assert.deepEqual(classesFor(sides("padding", ["16px", "16px", "16px", "16px"])), ["p-[16px]"]);
assert.deepEqual(classesFor(sides("padding", ["8px", "16px", "8px", "16px"])).sort(), ["px-[16px]", "py-[8px]"]);
assert.deepEqual(classesFor({ ...sides("margin", ["0px", "auto", "0px", "auto"]) }).sort(), ["mx-auto", "my-[0]"]);
assert.deepEqual(classesFor(sides("padding", ["revert", "revert", "revert", "revert"])).length, 4, "keywords are not collapsed");
assert.deepEqual(
  classesFor({ ...sides("border", []), "border-top-width": "1px", "border-right-width": "1px", "border-bottom-width": "1px", "border-left-width": "1px", "border-top-style": "solid", "border-right-style": "solid", "border-bottom-style": "solid", "border-left-style": "solid" }).filter((c) => !c.includes("undefined")).sort(),
  ["border-[1px]", "border-solid"]
);
assert.deepEqual(classesFor({ "overflow-x": "hidden", "overflow-y": "hidden" }), ["overflow-hidden"]);
assert.deepEqual(classesFor({ "row-gap": "20px", "column-gap": "20px" }), ["gap-[20px]"]);

/* breakpoints and widths */
const bps = [
  { px: 640, count: 2 },
  { px: 768, count: 5 },
  { px: 1024, count: 4 },
  { px: 1280, count: 1 }
];
assert.deepEqual(cloneWidths(bps), [375, 508, 640, 768, 1024, 1280, 1480]);
assert.deepEqual(cloneWidths([]), [375, 768, 1024, 1440]);
const screens = planScreens([375, 508, 640, 768, 1024, 1280, 1480], bps);
assert.deepEqual(screens.map((s) => `${s.name}:${s.px}`), ["sm:508", "md:640", "lg:768", "xl:1024", "2xl:1280", "3xl:1480"]);
assert.deepEqual(screens.map((s) => s.fromSite), [false, true, true, true, true, false]);
assert.deepEqual(planScreens([375, 768, 1024, 1440], bps).map((s) => s.px), [768, 1024, 1280], "an interval takes the site's most used breakpoint");

/* variants */
const maps = variantMaps({ display: ["none", "none", "flex", "flex"], "font-size": ["16px", "20px", "20px", "24px"] }, 4);
assert.deepEqual(maps, [{ display: "none", "font-size": "16px" }, { "font-size": "20px" }, { display: "flex" }, { "font-size": "24px" }]);

/* sizing */
const sample = (m, d = {}) => ({ d, m: { v: 1, pd: "block", pfd: "row", vh: 900, ml: 0, mr: 0, bs: "content-box", ...m } });
const widthsOf = (out, prop = "width") => out.map((o) => o[prop]);
// Block that fills its parent: no width.
assert.deepEqual(sizeDeclarations("div", [sample({ w: 375, cw: 343, pw: 375, h: 50, ch: 50, eh: 50, ew: 343 }), sample({ w: 1440, cw: 1408, pw: 1440, h: 50, ch: 50, eh: 50, ew: 1408 })]), [{}, {}]);
// Centered capped container (margin auto, max-width).
const centered = sizeDeclarations("div", [sample({ w: 375, cw: 327, pw: 375, h: 50, ch: 50, eh: 50 }), sample({ w: 1008, cw: 960, pw: 1440, ml: 216, mr: 216, ce: 1, h: 50, ch: 50, eh: 50 })]);
assert.deepEqual(centered[1], { "max-width": "960px", "margin-left": "auto", "margin-right": "auto" }, "content-box: max-width is the content width");
// Fixed symmetric margins: auto width.
assert.deepEqual(sizeDeclarations("div", [sample({ w: 343, cw: 343, pw: 375, ml: 16, mr: 16, ce: 1, h: 20, ch: 20, eh: 20 }), sample({ w: 1408, cw: 1408, pw: 1440, ml: 16, mr: 16, ce: 1, h: 20, ch: 20, eh: 20 })]), [{}, {}]);
// Half of the parent at every width.
assert.deepEqual(widthsOf(sizeDeclarations("div", [sample({ w: 187.5, cw: 187.5, pw: 375, h: 20, ch: 20, eh: 20 }), sample({ w: 720, cw: 720, pw: 1440, h: 20, ch: 20, eh: 20 })])), ["50%", "50%"]);
// Flex item with a set width (the probe's auto width differs): a clean fraction stays a %.
const col = sizeDeclarations("div", [
  sample({ w: 187.5, cw: 163.5, pw: 375, pd: "flex", nw: 90, h: 80, ch: 80, eh: 80 }),
  sample({ w: 120, cw: 96, pw: 720, pd: "flex", nw: 90, h: 80, ch: 80, eh: 80 })
]);
assert.deepEqual(widthsOf(col), ["43.6%", "96px"].map((v, i) => (i === 0 ? col[0].width : v)));
const col6 = sizeDeclarations("div", [sample({ w: 187.5, cw: 187.5, pw: 375, pd: "flex", nw: 90, h: 80, ch: 80, eh: 80 }), sample({ w: 240, cw: 240, pw: 1440, pd: "flex", nw: 90, h: 80, ch: 80, eh: 80 })]);
assert.deepEqual(widthsOf(col6), ["50%", "16.67%"]);
// Flex item sized by its content: nothing.
assert.deepEqual(sizeDeclarations("div", [sample({ w: 90, cw: 90, pw: 375, pd: "flex", nw: 90, h: 20, ch: 20, eh: 20 })]), [{}]);
// Absolute badge anchored to the right.
const badge = sizeDeclarations("span", [
  sample({ w: 80, cw: 60, pw: 375, h: 24, ch: 16, ew: 60, eh: 16, nw: 60, off: [16, 16, 200, 279], cb: [375, 240] }, { position: "absolute", display: "block" }),
  sample({ w: 80, cw: 60, pw: 1440, h: 24, ch: 16, ew: 60, eh: 16, nw: 60, off: [16, 16, 200, 1344], cb: [1440, 240] }, { position: "absolute", display: "block" })
]);
assert.deepEqual(badge.map((o) => [o.top, o.right, o.left, o.width]), [["16px", "16px", undefined, undefined], ["16px", "16px", undefined, undefined]]);
// Heights: taller than the content → min-height; shorter → height; equal → nothing.
const tall = sizeDeclarations("div", [sample({ w: 375, cw: 375, pw: 375, h: 300, ch: 300, eh: 120, nh: 120 })]);
assert.equal(tall[0]["min-height"], "300px");
const short = sizeDeclarations("div", [sample({ w: 375, cw: 375, pw: 375, h: 240, ch: 240, eh: 200, nh: 280 })]);
assert.equal(short[0].height, "240px");
assert.deepEqual(sizeDeclarations("div", [sample({ w: 375, cw: 375, pw: 375, h: 100, ch: 100, eh: 97, nh: 100 })]), [{}]);
// Full bleed out of a padded column.
const bleed = sizeDeclarations("div", [sample({ w: 375, cw: 375, pw: 351, ml: -12, mr: -12, vw: 375, h: 200, ch: 200, eh: 200 }), sample({ w: 1440, cw: 1440, pw: 640, ml: -400, mr: -400, vw: 1440, h: 200, ch: 200, eh: 200 })]);
assert.deepEqual(bleed[1], { "margin-left": "calc(50% - 50vw)", "margin-right": "calc(50% - 50vw)" });
// Fluid image keeps its ratio.
const image = sizeDeclarations("img", [sample({ w: 343, cw: 343, pw: 343, h: 171.5, ch: 171.5, nat: [800, 400] }), sample({ w: 600, cw: 600, pw: 600, h: 300, ch: 300, nat: [800, 400] })]);
assert.deepEqual(image, [{ width: "100%", height: "auto" }, { width: "100%", height: "auto" }]);

/* grid tracks */
const grid = (tracks, cw, gap = 20) => ({ d: {}, m: { v: 1, tracks, cw, gap } });
assert.deepEqual(gridColumns([grid([343], 343), grid([304, 304], 628), grid([293.3, 293.3, 293.3], 920)]), ["repeat(1,minmax(0,1fr))", "repeat(2,minmax(0,1fr))", "repeat(3,minmax(0,1fr))"]);
assert.deepEqual(gridColumns([grid([120, 223], 375, 32), grid([120, 1288], 1440, 32)]), ["120px minmax(0,1fr)", "120px minmax(0,1fr)"]);

/* fluid values */
const xs = [375, 475, 576, 768, 992, 1200, 1400];
const fluid = (x) => Math.min(48, Math.max(24, 0.04 * x + 10));
assert.equal(fluidFit(xs, xs.map((x) => `${fluid(x).toFixed(2)}px`), [576, 768, 992, 1200]), "clamp(25px, calc(4vw + 10px), 48px)");
assert.equal(fluidFit(xs, ["16px", "16px", "20px", "20px", "24px", "24px", "24px"], [576, 768, 992, 1200]), null, "steps at breakpoints are not fluid");
assert.equal(fluidFit([375, 768, 1440], ["10px", "20px", "30px"], [768, 1440]), null, "no two measures inside one interval: no evidence");
assert.equal(fluidFit([375, 768, 1440], ["10px", "20px", "30px"], [768]), "clamp(10px, calc(2.5445vw + 0.46px), 30px)", "768 and 1440 share [768, ∞): fluid");
assert.equal(fluidFit([375, 475, 768], ["auto", "1px", "2px"], []), null);

/* heights tied to the viewport height */
assert.deepEqual(viewportHeightFit([812, 900, 1024, 768, 900], ["revert", "808px", "932px", "676px", "808px"]), ["revert", ...Array(4).fill("calc(100vh - 92px)")]);
assert.deepEqual(viewportHeightFit([812, 1024, 768], ["650px", "819px", "614px"]), Array(3).fill("80vh"));
assert.equal(viewportHeightFit([812, 1024, 768], ["600px", "600px", "600px"]), null, "a fixed height stays fixed");
assert.equal(viewportHeightFit([900, 900], ["808px", "808px"]), null, "one viewport height proves nothing");

/* pseudo content, fonts, tokens */
assert.equal(contentValue('"“"'), "'\\201c_'");
assert.equal(contentValue('"a b"'), "'a_b'");
assert.equal(contentValue('url("https://x.test/i.png")', (url) => (url.endsWith("i.png") ? "/assets/i.png" : null)), "url('/assets/i.png')");
assert.equal(contentValue("none"), "''");
const faces = parseFontFaces(`@font-face{font-family:"Brand Sans";src:url(./b.woff2) format("woff2"),url(./b.woff) format("woff");font-weight:400 700;font-display:swap}
@font-face { font-family: 'Mono'; src: local('Mono'), url("https://cdn.test/m.ttf"); }`, "https://site.test/css/main.css");
assert.equal(faces.length, 2);
assert.deepEqual(faces[0].srcs.map((s) => s.url), ["https://site.test/css/b.woff2", "https://site.test/css/b.woff"]);
assert.equal(faces[0].weight, "400 700");
assert.equal(faces[1].family, "Mono");
const tokens = buildTokens([
  { color: ["rgb(17, 17, 17)", "rgb(17, 17, 17)"], "background-color": ["rgba(52, 101, 164, 0.12)", "rgba(52, 101, 164, 0.12)"], "font-family": ['"Inter", sans-serif', '"Inter", sans-serif'] },
  { color: ["rgb(17, 17, 17)", "rgb(17, 17, 17)"], "background-color": ["rgb(255, 255, 255)", "rgb(255, 255, 255)"] },
  { "background-color": ["rgb(255, 255, 255)", "rgb(255, 255, 255)"], "border-top-color": ["rgb(194, 65, 12)", "rgb(194, 65, 12)"] },
  { "border-top-color": ["rgb(194, 65, 12)", "rgb(194, 65, 12)"] }
]);
assert.equal(tokens.colors["#111111"], "ink");
assert.equal(tokens.colors["#ffffff"], "paper", "paper is the most used opaque background");
assert.equal(tokens.colors["#c2410c"], "tone-1");
assert.equal(tokens.fonts['"Inter", sans-serif'], "inter");

/* a whole project from a synthetic capture */
function capture() {
  const widths = [375, 1024];
  const nodes = [];
  const measures = widths.map(() => []);
  const add = (node, sampleFor) => {
    const index = nodes.length;
    nodes.push(node);
    widths.forEach((w, s) => (measures[s][index] = node.k === "t" ? null : sampleFor(w, s)));
    return index;
  };
  const box = (w, s, extra = {}, d = {}) => ({ d, m: { v: 1, w, h: 100, cw: w, ch: 100, ew: w, eh: 100, pw: w, ph: 900, pd: "block", pfd: "row", vh: 900, ml: 0, mr: 0, bs: "content-box", vw: w, ...extra } });
  const body = add({ k: "e", tag: "body", parent: -1, a: {} }, (w) => box(w, 0, {}, { margin: undefined, "margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px", color: "rgb(17, 17, 17)" }));
  const header = add({ k: "e", tag: "header", parent: body, a: {} }, (w) => box(w, 0, { h: 64, ch: 64, eh: 64 }, { "background-color": "rgb(17, 17, 17)" }));
  add({ k: "t", parent: header, x: "Atelier" });
  const main = add({ k: "e", tag: "main", parent: body, a: {} }, (w) => box(w));
  const section = add({ k: "e", tag: "section", parent: main, a: {}, cls: ["features"] }, (w) => box(w, 0, { h: 600, ch: 600, eh: 600 }));
  const h2 = add({ k: "e", tag: "h2", parent: section, a: {} }, (w) => box(w, 0, { h: 40, ch: 40, eh: 40 }, { "margin-top": "0px" }));
  add({ k: "t", parent: h2, x: "Nos pièces" });
  const grid = add({ k: "e", tag: "div", parent: section, a: {} }, (w, s) => box(w, 0, { h: 300, ch: 300, eh: 300, tracks: s ? [313, 313, 313] : [343], gap: 20, cw: s ? 979 : 343 }, { display: "grid", "row-gap": "20px", "column-gap": "20px", "grid-template-columns": s ? "313px 313px 313px" : "343px" }));
  for (const [title, text] of [["Tables", "Chêne massif."], ["Chaises", "Assises sculptées."], ["Buffets", "Tiroirs à queue d'aronde."]]) {
    const card = add({ k: "e", tag: "article", parent: grid, a: {} }, (w, s) => box(s ? 313 : 343, 0, { pd: "grid", st: 1, pw: s ? 313 : 343 }, { "padding-top": "20px", "padding-right": "20px", "padding-bottom": "20px", "padding-left": "20px", "background-color": "rgb(255, 255, 255)" }));
    const img = add({ k: "e", tag: "img", parent: card, a: { src: "https://site.test/card.png", alt: title } }, (w, s) => box(s ? 273 : 303, 0, { h: s ? 136.5 : 151.5, ch: s ? 136.5 : 151.5, nat: [800, 400], pw: s ? 273 : 303 }, { display: "block" }));
    void img;
    const h3 = add({ k: "e", tag: "h3", parent: card, a: {} }, (w, s) => box(s ? 273 : 303, 0, { h: 24, ch: 24, eh: 24, pw: s ? 273 : 303 }));
    add({ k: "t", parent: h3, x: title });
    const p = add({ k: "e", tag: "p", parent: card, a: {} }, (w, s) => box(s ? 273 : 303, 0, { h: 22, ch: 22, eh: 22, pw: s ? 273 : 303 }));
    add({ k: "t", parent: p, x: text });
  }
  const footer = add({ k: "e", tag: "footer", parent: body, a: {} }, (w) => box(w, 0, { h: 80, ch: 80, eh: 80 }));
  add({ k: "t", parent: footer, x: "© 2026" });
  const bad = add({ k: "e", tag: "a", parent: footer, a: { href: "javascript:alert(1)" } }, (w) => box(40, 0, { h: 20, ch: 20, eh: 20, pw: w }, { display: "inline-block" }));
  add({ k: "t", parent: bad, x: "x" });
  add({ k: "e", tag: "svg", parent: footer, a: {}, svg: { t: "svg", a: { viewBox: "0 0 1 1", onload: "alert(1)", "x{y": "1" }, c: [{ t: "a", a: { href: "javascript:alert(2)" }, c: [{ t: "path", a: { d: "M0 0" } }] }] } }, (w) => box(24, 0, { h: 24, ch: 24, pw: w }));
  return { url: "https://site.test/", title: "Atelier", lang: "fr", description: "", icon: "", widths, nodes, measures, htmlBackground: "rgba(0, 0, 0, 0)", truncated: false };
}
const cap = capture();
const assets = collectCloneAssets(cap);
assert.deepEqual(assets.map((a) => a.path), ["public/assets/card.png"]);
const project = buildCloneProject(cap, { breakpoints: [{ px: 1024, count: 3 }], widths: [375, 1024], assetPaths: new Map([["https://site.test/card.png", "public/assets/card.png"]]) });
const file = (path) => project.files.find((f) => f.path === path)?.content || "";
assert.ok(file("src/components/Header.jsx").includes("export default function Header()"));
assert.ok(file("src/components/Footer.jsx").includes("© 2026"));
const features = file("src/components/NosPieces.jsx");
assert.ok(features, `section named after its heading: ${project.files.map((f) => f.path).join(", ")}`);
assert.match(features, /const nosPiecesCards = \[/);
assert.match(features, /function NosPiecesCard\(\{ imageAlt, title, text \}\)/);
assert.equal((features.match(/"title": /g) || []).length, 3);
assert.match(features, /grid-cols-1|\[grid-template-columns:343px\]|grid-cols-\[343px\]/);
assert.match(features, /lg:grid-cols-3|xl:grid-cols-3|md:grid-cols-3/, "3 equal tracks become grid-cols-3 at the breakpoint");
assert.match(features, /src="\/assets\/card\.png"/);
assert.match(features, /className="[^"]*w-full[^"]*h-auto/, "card image fluid with its ratio");
assert.match(file("src/App.jsx"), /<Header \/>[\s\S]*<NosPieces \/>[\s\S]*<Footer \/>/);
assert.match(file("src/index.css"), /--breakpoint-\w+: 64rem;/);
assert.match(file("src/index.css"), /--color-ink: #111111;/);
assert.ok(!file("src/index.css").includes("preflight"));
assert.match(file("package.json"), /"tailwindcss": "\^4/);
assert.match(file("index.html"), /<html lang="fr">/);
assert.equal(project.stats.sections, 3);
const footerJsx = file("src/components/Footer.jsx");
assert.ok(!/onload|javascript:|x\{y/i.test(footerJsx), footerJsx);
assert.match(footerJsx, /<path d="M0 0" \/>/, "the rest of the svg is kept");
assert.equal(project.stats.repeated, 1);

console.log("Code clone tests passed.");
