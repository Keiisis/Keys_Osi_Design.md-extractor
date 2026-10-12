/**
 * DESIGN.md / SKILL.md validation on real sites, with a regression baseline.
 *
 * For each URL: real Chrome, real extraction, real generators, then
 * invariant checks against what the page actually paints. Results are
 * compared with tests/e2e/validation-baseline.json (palette roles per
 * site) so a change in the normalizer shows up as a diff, not a surprise.
 *
 * Usage:
 *   node tests/e2e/validate-sites.mjs                 # default 20 sites
 *   node tests/e2e/validate-sites.mjs --update        # rewrite the baseline
 *   node tests/e2e/validate-sites.mjs https://a.com   # custom list
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { normalizeExtractedStyles } from "../../lib/normalize.mjs";
import { generateDesignMarkdown } from "../../lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "../../lib/generate-skill-md.mjs";
import { colorDistance, contrastRatio, relativeLuminance, isSaturated } from "../../lib/color-science.mjs";

const DEFAULT_SITES = [
  "https://stripe.com", "https://linear.app", "https://www.notion.com", "https://www.figma.com",
  "https://www.apple.com/fr/", "https://mailchimp.com", "https://vercel.com", "https://github.com",
  "https://www.airbnb.com", "https://open.spotify.com", "https://www.shopify.com", "https://www.framer.com",
  "https://webflow.com", "https://dribbble.com", "https://medium.com", "https://www.nytimes.com",
  "https://www.booking.com", "https://www.ikea.com/fr/fr/", "https://www.pizza-amici.nl/", "https://www.duolingo.com"
];
const BASELINE = new URL("./validation-baseline.json", import.meta.url);
const args = process.argv.slice(2);
const update = args.includes("--update");
const sites = args.filter((a) => /^https?:/.test(a));
const urls = sites.length ? sites : DEFAULT_SITES;

const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/usr/bin/google-chrome"
].find((p) => p && existsSync(p));
const inspector = await readFile(new URL("../../inspector-main.js", import.meta.url), "utf8");
const contentScript = await readFile(new URL("../../content-script.js", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: chrome, headless: true });

const hexOf = (row) => String(row?.value || "").split(" ")[0];
const token = (n, name) => n.colorPalette.find((r) => r.token === name);

async function audit(url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    // What the page paints: edge pixels down the whole document.
    const shot = await page.screenshot({ type: "png", fullPage: true, timeout: 30000 }).catch(() => page.screenshot({ type: "png" }));
    const painted = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const h = Math.min(img.height, 12000);
      const c = new OffscreenCanvas(img.width, h);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const counts = new Map();
      let total = 0;
      for (let y = 0; y < h; y += 24) {
        for (const x of [6, Math.floor(img.width / 2), img.width - 6]) {
          const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
          const k = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          counts.set(k, (counts.get(k) || 0) + 1);
          total += 1;
        }
      }
      return { top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), total };
    }, shot.toString("base64"));

    await page.evaluate(() => {
      window.__keysOsiHandlers = [];
      window.chrome = { runtime: { onMessage: { addListener(fn) { window.__keysOsiHandlers.push(fn); } } } };
    });
    await page.evaluate(inspector);
    await page.evaluate(contentScript);
    const extraction = await page.evaluate(
      () => new Promise((resolve) => window.__keysOsiHandlers[0]({ type: "KEYS_OSI_EXTRACT_STYLES" }, null, resolve))
    );
    if (!extraction?.ok) throw new Error(extraction?.error || "no extraction");
    const n = normalizeExtractedStyles(extraction.payload);
    const design = generateDesignMarkdown({ normalized: n });
    const skill = generateSkillMarkdown({ normalized: n });

    // Bot walls / consent shells: almost nothing rendered, nothing to judge.
    if (n.sampledElements < 30 || !token(n, "color.text.primary")) {
      return { url, ok: false, error: `page bloquée ou vide pour un navigateur headless (${n.sampledElements} éléments mesurés)` };
    }
    const checks = {};
    const base = hexOf(token(n, "color.surface.base"));
    const paintedHexes = painted.top.map(([hex]) => hex);
    // 1. canvas: surface.base is one of the dominant painted edge colors.
    checks.canvas = paintedHexes.slice(0, 4).some((hex) => colorDistance(hex, base) <= 12);
    // 2. no phantom black: a near-black surface/border/brand token must be painted.
    // Text and 1px borders are too thin for edge sampling: surfaces/brand only.
    const blackish = n.colorPalette.filter((r) => /^#/.test(hexOf(r)) && relativeLuminance(hexOf(r)) < 0.004 && !/^color.(text|border|focus)/.test(r.token));
    checks.noPhantomBlack = blackish.every((r) => painted.top.some(([hex]) => colorDistance(hex, hexOf(r)) <= 10));
    // 3. readable core pair.
    const primary = hexOf(token(n, "color.text.primary"));
    checks.coreContrast = Boolean(primary) && contrastRatio(primary, base) >= 4.5;
    // 4. a saturated button means a brand color must exist.
    const saturatedButton = (n.buttonVariants || []).some((v) => /^#/.test(v.spec.background) && isSaturated(v.spec.background));
    checks.brand = !saturatedButton || Boolean(token(n, "color.brand.primary"));
    // 5. no leaked placeholders.
    checks.noLeaks = !/\bundefined\b|\bNaN\b|\[object Object\]/.test(design + skill);
    // 6. frontmatter + tables well formed.
    const fm = design.split("---")[1] || "";
    checks.frontmatter = /\ncolors:\n/.test(fm) && /\ntypography:\n/.test(fm);
    let tablesOk = true;
    for (const block of design.split(/\n\n/)) {
      const rows = block.split("\n").filter((l) => l.startsWith("|"));
      if (rows.length < 2) continue;
      const cols = rows[0].split("|").length;
      if (rows.some((r) => r.split("|").length !== cols)) tablesOk = false;
    }
    checks.tables = tablesOk;
    // 7. SKILL.md markers.
    checks.skillMarkers = skill.includes("<!-- KEYS_OSI_MANAGED_START -->") && skill.includes("<!-- KEYS_OSI_MANAGED_END -->");
    // 8. every var() mapped in the palette exists on the page.
    const varNames = new Set((n.cssVariables || []).map((v) => v.name));
    checks.varsExist = n.colorPalette.every((r) => {
      const m = String(r.value).match(/var\((--[^)]+)\)/);
      return !m || varNames.has(m[1]);
    });

    const roles = Object.fromEntries(n.colorPalette.map((r) => [r.token, hexOf(r)]));
    return { url, ok: true, checks, roles, painted: paintedHexes.slice(0, 3), profile: `${n.siteProfile.audience} | ${n.siteProfile.productSurface}` };
  } catch (error) {
    return { url, ok: false, error: error.message.slice(0, 160) };
  } finally {
    await page.close().catch(() => {});
  }
}

// 3 pages at a time.
const results = [];
for (let i = 0; i < urls.length; i += 3) {
  results.push(...(await Promise.all(urls.slice(i, i + 3).map(audit))));
}
await browser.close();

const baseline = existsSync(BASELINE) ? JSON.parse(await readFile(BASELINE, "utf8")) : {};
let failures = 0;
for (const r of results) {
  if (!r.ok) {
    console.log(`SKIP ${r.url} — ${r.error}`);
    continue;
  }
  const failed = Object.entries(r.checks).filter(([, ok]) => !ok).map(([k]) => k);
  failures += failed.length;
  const prev = baseline[r.url]?.roles;
  const changed = prev
    ? Object.keys({ ...prev, ...r.roles }).filter((k) => prev[k] !== r.roles[k]).map((k) => `${k.replace("color.", "")}:${prev[k] || "∅"}→${r.roles[k] || "∅"}`)
    : [];
  console.log(`${failed.length ? "FAIL" : "ok  "} ${r.url}${failed.length ? ` — ${failed.join(", ")}` : ""}`);
  console.log(`     base=${r.roles["color.surface.base"]} text=${r.roles["color.text.primary"]} brand=${r.roles["color.brand.primary"] || "—"} painted=${r.painted.join(" ")} · ${r.profile}`);
  if (changed.length) console.log(`     vs baseline: ${changed.join(" ")}`);
}
const okCount = results.filter((r) => r.ok).length;
console.log(`\n${okCount}/${results.length} sites extracted · ${failures} failed check(s)`);
if (update) {
  const next = Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.url, { roles: r.roles, checks: r.checks }]));
  await writeFile(BASELINE, JSON.stringify(next, null, 2) + "\n");
  console.log(`baseline written: ${Object.keys(next).length} sites`);
}
process.exit(failures > 0 ? 1 : 0);
