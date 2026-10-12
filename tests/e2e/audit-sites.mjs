/**
 * Multi-site accuracy audit: real Chrome, real extraction, real generators.
 * For each URL compares the canvas color actually painted (screenshot
 * pixels) with the tokens Keys_Osi emits, and flags black/white tokens
 * that do not exist on the page.
 *
 * Usage: node tests/e2e/audit-sites.mjs [--md] url1 url2 ...
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { normalizeExtractedStyles } from "../../lib/normalize.mjs";
import { generateDesignMarkdown } from "../../lib/generate-design-md.mjs";
import { generateSkillMarkdown } from "../../lib/generate-skill-md.mjs";

const args = process.argv.slice(2);
const saveMd = args.includes("--md");
const urls = args.filter((a) => /^https?:/.test(a));
const chrome = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
].find((p) => p && existsSync(p));

const inspector = await readFile(new URL("../../inspector-main.js", import.meta.url), "utf8");
const contentScript = await readFile(new URL("../../content-script.js", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const outDir = new URL("../../.audit/", import.meta.url);
if (saveMd) await mkdir(outDir, { recursive: true });

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

for (const url of urls) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3500);
    // Painted canvas: most frequent color along the page edges of the first viewport.
    const shot = await page.screenshot({ type: "png" });
    const painted = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const counts = new Map();
      const sample = (x, y) => {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        const k = `${r},${g},${b}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      };
      for (let y = 120; y < img.height; y += 40) {
        sample(8, y);
        sample(img.width - 8, y);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
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
    if (!extraction.ok) throw new Error(extraction.error);
    const n = normalizeExtractedStyles(extraction.payload);
    const design = generateDesignMarkdown({ normalized: n });
    const skill = generateSkillMarkdown({ normalized: n });
    const paintedHex = painted.map(([k, c]) => `${hex(...k.split(",").map(Number))}×${c}`).join(" ");
    const surface = n.colorPalette.find((r) => r.token === "color.surface.base")?.value || "-";
    const blackTokens = n.colorPalette.filter((r) => /^#0{6}\b|^#000\b/.test(r.value)).map((r) => r.token);
    const designBlack = (design.match(/#000000/gi) || []).length;
    const fm = design.split("\n").filter((l) => /^\s{2,}(background|surface|canvas|primary|text|on-?|foreground)[\w-]*:/i.test(l)).slice(0, 8).join(" | ");
    console.log(`\n=== ${url}`);
    console.log(`painted edges: ${paintedHex} | pageBackground(raw): ${extraction.payload.pageBackground}`);
    console.log(`surface.base: ${surface} | palette: ${n.colorPalette.slice(0, 8).map((r) => `${r.token.replace("color.", "")}=${String(r.value).split(" ")[0]}`).join(" ")}`);
    console.log(`black tokens: ${blackTokens.join(",") || "none"} | #000000 in DESIGN.md: ${designBlack}x`);
    console.log(`frontmatter: ${fm}`);
    console.log(`profile: ${n.siteProfile?.audience} | ${n.siteProfile?.productSurface} (${n.siteProfile?.confidence}) | ${(n.siteProfile?.evidence || []).slice(0, 6).join("; ")}`);
    console.log(`brand: ${n.colorPalette.filter((r) => r.token.startsWith("color.brand")).map((r) => r.token + "=" + r.value).join(" ") || "none"} | buttons: ${(n.buttonVariants || []).map((b) => b.name + ":" + b.spec.background).join(" ")}`);
    if (saveMd) {
      const slug = new URL(url).hostname.replace(/[^a-z0-9]+/gi, "_");
      await writeFile(new URL(`${slug}.DESIGN.md`, outDir), design);
      await writeFile(new URL(`${slug}.SKILL.md`, outDir), skill);
    }
  } catch (error) {
    console.log(`\n=== ${url}\nERROR ${error.message}`);
  } finally {
    await page.close();
  }
}
await browser.close();
