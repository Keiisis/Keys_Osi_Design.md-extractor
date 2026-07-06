/**
 * End-to-end test: runs content-script.js inside a real Chrome (via
 * playwright-core + the locally installed Chrome/Edge) against a rich
 * fixture page, then asserts the extraction and copy-site payloads.
 *
 * Covers what the Node unit tests cannot: real getComputedStyle,
 * adoptedStyleSheets (document + shadow root), open shadow DOM,
 * same-origin iframes, Web Animations API, media queries, and the
 * clone's asset rewriting.
 *
 * Usage: npm run test:e2e
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Fixture Site — E2E</title>
<meta name="description" content="A demo dashboard for testing extraction." />
<style>
  :root { --brand: #2563eb; --space-4: 16px; }
  body { font-family: Arial, sans-serif; color: rgb(17, 24, 39); background: #ffffff; margin: 0; }
  h1 { font-size: 48px; line-height: 56px; font-weight: 700; letter-spacing: -0.02em; }
  h2 { font-size: 32px; line-height: 40px; font-weight: 600; }
  .btn { background: var(--brand); color: #fff; border: none; border-radius: 8px;
         padding: 12px 24px; font-size: 16px; font-weight: 600; cursor: pointer; }
  .btn:hover { background: rgb(29, 78, 216); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .btn-ghost { background: transparent; color: var(--brand); border: 1px solid var(--brand);
               border-radius: 8px; padding: 12px 24px; font-size: 16px; font-weight: 600; }
  a { color: var(--brand); text-decoration: none; font-weight: 500; }
  a:focus-visible { outline: 2px solid var(--brand); }
  .hero { background-image: url(/bg.png); padding: 96px 0; }
  .card { box-shadow: 0 1px 2px rgba(0,0,0,0.08); border-radius: 8px; padding: 16px; margin: 8px; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @media (min-width: 768px) { .grid { display: grid; } }
  @media (min-width: 1024px) { .wide { max-width: 1280px; } }
  .container { max-width: 1280px; margin: 0 auto; display: flex; }
</style>
</head>
<body>
  <header><nav>
    <img src="/photo.png" alt="Fixture logo" class="logo" width="120" height="32" />
    <a href="/pricing">Pricing</a>
    <a href="/docs">Docs</a>
    <a href="https://external.example.com/x">External</a>
  </nav></header>
  <main>
    <section class="hero container">
      <h1>Fixture Dashboard</h1>
      <p>Manage the workspace, analytics and reports.</p>
      <button class="btn">Get started</button>
      <button class="btn">Try free</button>
      <button class="btn">Book demo</button>
      <button class="btn-ghost">Learn more</button>
    </section>
    <section class="container">
      <h2>Analytics</h2>
      <div class="card"><input type="text" placeholder="Search" /></div>
      <img src="/photo.png" alt="chart" />
      <div id="shadow-host"></div>
      <details><summary>FAQ item</summary><p>Answer.</p></details>
    </section>
    <iframe src="/frame.html" title="widget" width="300" height="120"></iframe>
    <section>
      <div id="para" class="parallax-bg" style="will-change: transform; transform: translateY(0px); height: 80px; background: #eee">Parallax layer</div>
      <canvas id="chart" width="200" height="100"></canvas>
      <div data-aos="fade-up">Reveals on scroll</div>
      <div class="swiper"><div class="swiper-wrapper"><div class="swiper-slide">Slide</div></div></div>
      <form id="newsletter" method="post">
        <label for="nl-email">Email</label>
        <input id="nl-email" type="email" name="email" placeholder="you@company.com" required />
        <button type="submit">Subscribe</button>
      </form>
    </section>
    <div style="height: 1800px"></div>
  </main>
  <script>
    // Constructed stylesheet on the document (CSS-in-JS pattern).
    const adopted = new CSSStyleSheet();
    adopted.replaceSync(
      ":root { --adopted-accent: #10b981; } " +
      "@keyframes adoptedpulse { 0% { opacity: 0.4; } 100% { opacity: 1; } } " +
      ".adopted-btn:hover { transform: scale(1.05); }"
    );
    document.adoptedStyleSheets = [adopted];

    // Open shadow root with its own constructed stylesheet.
    const host = document.getElementById("shadow-host");
    const root = host.attachShadow({ mode: "open" });
    const shadowSheet = new CSSStyleSheet();
    shadowSheet.replaceSync(
      "@keyframes shadowfade { from { opacity: 0; } to { opacity: 1; } } " +
      ".sh:hover { color: rgb(220, 38, 38); }"
    );
    root.adoptedStyleSheets = [shadowSheet];
    const inner = document.createElement("button");
    inner.className = "sh";
    inner.textContent = "Shadow action";
    root.appendChild(inner);

    // Web Animations API runtime animation.
    document.querySelector("h1").animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 400, easing: "ease-out", fill: "forwards" }
    );

    // JS parallax: layer moves at half the scroll speed.
    window.addEventListener("scroll", () => {
      document.getElementById("para").style.transform =
        "translateY(" + window.scrollY * 0.5 + "px)";
    });

    // 2D canvas graphic.
    const ctx = document.getElementById("chart").getContext("2d");
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(0, 0, 200, 100);

    // Fake GSAP + ScrollTrigger runtimes for the MAIN-world inspector.
    window.gsap = {
      version: "3.12.5",
      globalTimeline: {
        getChildren: () => [{
          constructor: { name: "Tween" },
          duration: () => 1.2,
          delay: () => 0,
          vars: { x: 100, opacity: 1, onComplete: function () {} },
          targets: () => [document.querySelector("h1")]
        }]
      }
    };
    window.ScrollTrigger = {
      getAll: () => [{
        trigger: document.querySelector(".hero"),
        start: 120,
        end: 800,
        vars: { scrub: true, pin: true, start: "top top" },
        animation: { vars: { y: -120 } }
      }]
    };
  </script>
</body>
</html>`;

const FRAME_HTML = `<!doctype html>
<html><head><style>
  @keyframes framespin { to { transform: rotate(1turn); } }
  h3 { font-size: 20px; }
</style></head>
<body><h3>Widget</h3><img src="/frame-img.png" alt="w" /></body></html>`;

async function main() {
  const executablePath = findLocalChrome();
  assert.ok(executablePath, "No local Chrome/Edge found for the E2E run.");

  const server = createServer((req, res) => {
    if (req.url === "/frame.html") {
      res.writeHead(200, { "Content-Type": "text/html" }).end(FRAME_HTML);
    } else if (req.url === "/bg.png" || req.url === "/photo.png" || req.url === "/frame-img.png") {
      res.writeHead(200, { "Content-Type": "image/png" }).end(PNG_1PX);
    } else {
      res.writeHead(200, { "Content-Type": "text/html" }).end(FIXTURE_HTML);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({ executablePath, headless: true });
  const failures = [];
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto(baseUrl, { waitUntil: "load" });

    // Stub the chrome extension API surface the content script uses,
    // then inject content-script.js exactly as the extension would.
    await page.evaluate(() => {
      window.__typeuiHandlers = [];
      window.chrome = {
        runtime: {
          onMessage: {
            addListener(fn) {
              window.__typeuiHandlers.push(fn);
            }
          }
        }
      };
    });
    // Run the MAIN-world inspector first (in E2E everything shares the
    // page context), then the content script that reads its output.
    const inspectorScript = await readFile(new URL("../../inspector-main.js", import.meta.url), "utf8");
    await page.evaluate(inspectorScript);
    const contentScript = await readFile(new URL("../../content-script.js", import.meta.url), "utf8");
    await page.evaluate(contentScript);

    const dispatch = (message) =>
      page.evaluate(
        (msg) =>
          new Promise((resolve) => {
            const keepAlive = window.__typeuiHandlers[0](msg, null, resolve);
            if (!keepAlive) {
              // synchronous handlers resolve via sendResponse already
            }
          }),
        message
      );

    /* ---------------- extraction ---------------- */
    const extraction = await dispatch({ type: "TYPEUI_EXTRACT_STYLES" });
    assert.ok(extraction.ok, `extraction failed: ${extraction.error}`);
    const p = extraction.payload;

    const check = (label, condition) => {
      if (condition) {
        console.log(`  ok - ${label}`);
      } else {
        failures.push(label);
        console.log(`  FAIL - ${label}`);
      }
    };

    console.log("Extraction payload:");
    check("samples visible elements", p.sampledElements > 10);
    const keyframeNames = p.keyframes.map((k) => k.name);
    check("captures document @keyframes", keyframeNames.includes("spin"));
    check("captures adoptedStyleSheets @keyframes", keyframeNames.includes("adoptedpulse"));
    check("captures shadow-root adoptedStyleSheets @keyframes", keyframeNames.includes("shadowfade"));
    check("captures same-origin iframe @keyframes", keyframeNames.includes("framespin"));
    const selectors = p.interactionStyles.map((r) => r.selector);
    check("captures hover rules", selectors.some((s) => s.includes(".btn:hover")));
    check("captures shadow-root hover rules", selectors.some((s) => s.includes(".sh:hover")));
    check("captures focus-visible rules", selectors.some((s) => s.includes(":focus-visible")));
    check("captures breakpoints", p.breakpoints.some((b) => b.px === 768) && p.breakpoints.some((b) => b.px === 1024));
    const varNames = p.cssVariables.map((v) => v.name);
    check("captures :root CSS variables", varNames.includes("--brand"));
    check("captures adopted CSS variables", varNames.includes("--adopted-accent"));
    check("measures h1 heading", p.headings.some((h) => h.level === "h1" && h.fontSize === "48px"));
    check("clusters button variants", p.buttonVariants.length >= 2 && p.buttonVariants[0].count >= 3);
    check("captures runtime WAAPI animation", p.runtimeAnimations.length >= 1);
    check("captures background images", p.backgroundImages.some((v) => v.includes("bg.png")));
    check("measures layout container", p.layout.containerMaxWidth === "1280px");
    check("runs the a11y audit", p.a11y.contrastChecked > 0 && p.a11y.targetsChecked > 0);
    check("collects form control spec", p.formControl && p.formControl.tag === "input");
    check("collects link spec", Boolean(p.linkSpec));

    console.log("Motion payload:");
    check("detects GSAP with animated values", p.gsap && p.gsap.detected && p.gsap.timelines[0].values.x === 100);
    check("describes GSAP targets", p.gsap.timelines[0].targets[0] === "h1");
    check(
      "captures ScrollTrigger details",
      p.scrollTriggers.length === 1 &&
        p.scrollTriggers[0].pin === true &&
        p.scrollTriggers[0].scrub === true &&
        p.scrollTriggers[0].trigger.includes(".hero") &&
        p.scrollTriggers[0].animation.y === -120
    );
    check(
      "measures JS parallax speed",
      p.parallax.measured.some(
        (item) => item.selector.includes("parallax-bg") && item.speedRatio > 0.3 && item.speedRatio < 0.7
      )
    );
    check(
      "inventories canvas graphics",
      p.canvasInventory.some((item) => item.selector.includes("chart") && item.context === "2d")
    );
    const libNames = p.animationLibs.map((lib) => lib.name);
    check("detects DOM animation libraries", libNames.includes("AOS") && libNames.includes("Swiper"));

    console.log("Anatomy payload:");
    const roles = p.structure.map((block) => block.role);
    check("maps the page structure", p.structure.length >= 3);
    check("identifies the header block", roles.includes("header/navigation"));
    check(
      "identifies the hero with its content",
      p.structure.some(
        (block) => block.role === "hero" && block.heading.includes("Fixture Dashboard") && block.ctas.includes("Get started")
      )
    );
    check(
      "detects the logo image",
      p.imageInventory.some((img) => img.role === "logo" && img.alt === "Fixture logo")
    );
    check(
      "maps the newsletter form",
      p.forms.some(
        (form) =>
          form.name === "newsletter" &&
          form.method === "post" &&
          form.fields.some((field) => field.type === "email" && field.required && field.label === "Email") &&
          form.submitText === "Subscribe"
      )
    );

    /* ---------------- copy site ---------------- */
    const copy = await dispatch({ type: "TYPEUI_COPY_SITE", options: { autoScroll: false, staticSnapshot: true } });
    assert.ok(copy.ok, `copy failed: ${copy.error}`);
    const c = copy.payload;

    console.log("Copy-site payload:");
    const assetUrls = c.assets.map((a) => a.url);
    check("collects <img> assets", assetUrls.some((u) => u.endsWith("/photo.png")));
    check("collects CSS background assets", assetUrls.some((u) => u.endsWith("/bg.png")));
    check("collects same-origin iframe assets", assetUrls.some((u) => u.endsWith("/frame-img.png")));
    check("rewrites img src to local path", c.html.includes('src="img/photo.png"'));
    check("static snapshot strips scripts", !c.html.includes("<script"));
    check("collects internal links only", c.internalLinks.every((l) => !l.url.includes("external.example.com")));
    check("emits site-meta.json", c.generatedFiles.some((f) => f.path === "meta/site-meta.json"));

    /* ---------------- extract element ---------------- */
    const component = await dispatch({ type: "TYPEUI_EXTRACT_ELEMENT", selector: ".hero" });
    assert.ok(component.ok, `element extraction failed: ${component.error}`);

    console.log("Extract-element payload:");
    check("returns a standalone document", component.html.startsWith("<!doctype html>"));
    check("inlines computed styles", component.html.includes("font-size: 48px"));
    check("keeps the subtree content", component.html.includes("Fixture Dashboard"));
    check("inlines button styles", /background-color: rgb\(37, 99, 235\)/.test(component.html));
    check("strips classes after inlining", !component.html.includes('class="btn"'));
    check("suggests a component name", component.suggestedName === "hero");

    check("no page errors during run", pageErrors.length === 0);
    if (pageErrors.length > 0) {
      console.log("  page errors:", pageErrors.join(" | "));
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\nE2E FAILED: ${failures.length} assertion(s):\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nAll E2E tests passed.");
}

function findLocalChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  return candidates.find((path) => path && existsSync(path));
}

main().catch((error) => {
  console.error("E2E run crashed:", error);
  process.exit(1);
});
