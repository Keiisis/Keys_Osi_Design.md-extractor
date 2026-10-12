/**
 * Site structure E2E: the real extension crawls a local multi-page site
 * (robots.txt, sitemap index, nested navigation, a blog template, a
 * JavaScript-only page, forms, a redirect, a broken link, a locale) from the
 * popup's "Site" view, then the exports are generated from the stored result.
 *
 * Usage: node tests/e2e/run-site-e2e.mjs
 */
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { buildSiteStructureFiles, generateSiteStructureMarkdown } from "../../lib/site-structure.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const layout = (title, body, { lang = "fr", head = "" } = {}) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${title} | Atelier Nova</title>
<meta name="description" content="${title} — Atelier Nova, studio de mobilier sur mesure.">
<link rel="alternate" hreflang="en" href="/en">${head}
<script type="text/plain" src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
</head><body>
<header><a href="/">Atelier Nova</a>
  <nav aria-label="Principale"><ul>
    <li><button>Produit</button><ul><li><a href="/features">Fonctionnalités</a></li><li><a href="/app">Démo</a></li></ul></li>
    <li><a href="/pricing">Tarifs</a></li>
    <li><a href="/blog">Blog</a></li>
    <li><a href="/contact">Contact</a></li>
  </ul></nav>
</header>
<main>${body}</main>
<footer>
  <div><h4>Société</h4><ul><li><a href="/about">À propos</a></li><li><a href="/old-page">Ancienne page</a></li><li><a href="/broken">Presse</a></li></ul></div>
  <div><h4>Légal</h4><ul><li><a href="/mentions-legales">Mentions légales</a></li></ul></div>
  <a href="https://www.instagram.com/ateliernova">Instagram</a> <a href="mailto:hello@nova.test">hello@nova.test</a>
  <p>© 2026 Atelier Nova. Tous droits réservés.</p>
</footer></body></html>`;

const newsletter = `<section><h2>Restez informé</h2><p>Une lettre par mois, pas plus.</p>
<form method="post" action="/subscribe"><label for="nl">Email</label><input id="nl" type="email" name="email" required><button type="submit">S'abonner</button></form></section>`;

const posts = ["chene-massif-guide", "atelier-en-images-2026", "entretenir-son-bois", "choisir-sa-table", "noyer-ou-frene", "commande-sur-mesure-etapes"];

function pages(base) {
  const routes = {
    "/robots.txt": ["text/plain", `User-agent: *\nDisallow: /private\nSitemap: ${base}/sitemap_index.xml\n`],
    "/sitemap_index.xml": ["application/xml", `<?xml version="1.0"?><sitemapindex><sitemap><loc>${base}/sitemap-pages.xml</loc></sitemap></sitemapindex>`],
    "/sitemap-pages.xml": [
      "application/xml",
      `<?xml version="1.0"?><urlset>${["/", "/about", "/pricing", "/blog", "/private/secret", "/mentions-legales", "/fr", ...posts.map((slug) => `/blog/${slug}`)].map((path) => `<url><loc>${base}${path}</loc></url>`).join("")}</urlset>`
    ],
    "/_next/static/chunks/main-abc.js": [
      "text/javascript",
      `window.__keysOsiFixtureLoaded = true; function loadQuotes(){ return fetch("/api/devis?atelier=1"); } const q = "query GetMeubles { meubles { id } }"; const id = "NEXT_PUBLIC_SHOP_ID";\n//# sourceMappingURL=main-abc.js.map\n`
    ],
    "/_next/static/chunks/main-abc.js.map": [
      "application/json",
      JSON.stringify({
        version: 3,
        sources: ["webpack://_N_E/./app/offre-cachee/page.tsx", "webpack://_N_E/./app/page.tsx", "webpack://_N_E/./node_modules/react/index.js"],
        sourcesContent: ["export default function Offre() { return <h1>Offre</h1>; }", "export default function Home() { return null; }", "module.exports = {};"],
        mappings: ""
      })
    ],
    "/_next/static/b42/_buildManifest.js": ["text/javascript", `self.__BUILD_MANIFEST={sortedPages:["/","/_app","/offre-cachee","/blog/[slug]"]};`],
    "/offre-cachee": ["text/html", layout("Offre privée", `<section><h1>Offre réservée</h1><p>Page publiée mais liée nulle part.</p></section>`)],
    "/": [
      "text/html",
      layout(
        "Accueil",
        `<section class="hero"><p>Nouveau</p><h1>Du mobilier qui dure trois générations</h1><p>Tables, bibliothèques et cuisines en bois massif, dessinées avec vous.</p>
        <a class="btn btn-primary" href="/pricing?utm_source=hero">Voir les tarifs</a> <a class="btn" href="/contact">Prendre rendez-vous</a></section>
        <section><h2>Pourquoi Atelier Nova</h2><div class="grid">
          <div class="card"><h3>Bois français</h3><p>Chêne et frêne des forêts du Jura.</p></div>
          <div class="card"><h3>Sur mesure</h3><p>Chaque pièce est dessinée pour votre espace.</p></div>
          <div class="card"><h3>Garantie 10 ans</h3><p>Réparation gratuite à l'atelier.</p></div>
        </div></section>
        <section><h2>Ce qu'en disent nos clients</h2><blockquote>« Une table magnifique, livrée à l'heure. » — Claire</blockquote></section>
        ${newsletter}`,
        { head: `<script>window.__NEXT_DATA__={"buildId":"b42","page":"/","props":{"pageProps":{"meubles":[{"nom":"Table","prix":290}]}}};</script><script src="/_next/static/chunks/main-abc.js"></script>` }
      )
    ],
    "/about": ["text/html", layout("À propos", `<section><h1>Notre histoire</h1><p>Fondé en 2009 à Besançon.</p></section><section><h2>L'équipe</h2><ul><li>Marc — ébéniste</li><li>Inès — designer</li></ul></section>`)],
    "/features": ["text/html", layout("Fonctionnalités", `<section><h1>Comment nous travaillons</h1><ol><li>Visite</li><li>Plans 3D</li><li>Fabrication</li></ol></section>`)],
    "/pricing": [
      "text/html",
      layout(
        "Tarifs",
        `<section><h1>Nos formules</h1><div class="tiers">
          <div class="tier"><h3>Essentiel</h3><p>290 €</p><a class="btn" href="/signup">Commencer</a></div>
          <div class="tier"><h3>Atelier</h3><p>890 €</p><a class="btn" href="/signup">Commencer</a></div>
          <div class="tier"><h3>Signature</h3><p>2 400 €</p><a class="btn" href="/contact">Nous écrire</a></div>
        </div></section>${newsletter}`
      )
    ],
    "/signup": ["text/html", layout("Créer un compte", `<section><h1>Créer votre espace</h1><form method="post"><label>Email <input type="email" name="email" required></label><label>Mot de passe <input type="password" name="password" required></label><button type="submit">Créer mon compte</button></form></section>`)],
    "/contact": [
      "text/html",
      layout(
        "Contact",
        `<section><h1>Parlons de votre projet</h1><form id="contact" method="post" action="/send">
          <label for="n">Nom</label><input id="n" name="name" required>
          <label for="e">Email</label><input id="e" type="email" name="email" required>
          <label for="t">Type</label><select id="t" name="type"><option>Table</option><option>Cuisine</option></select>
          <label for="m">Message</label><textarea id="m" name="message" required></textarea>
          <button type="submit">Envoyer</button></form></section>`
      )
    ],
    "/blog": [
      "text/html",
      layout(
        "Blog",
        `<section><h1>Le journal de l'atelier</h1><div class="posts">${posts
          .map((slug, i) => `<article><time datetime="2026-0${(i % 9) + 1}-01">2026</time><h3><a href="/blog/${slug}">${slug.replace(/-/g, " ")}</a></h3><p>Extrait ${i + 1}.</p></article>`)
          .join("")}</div></section>${newsletter}`
      )
    ],
    "/mentions-legales": ["text/html", layout("Mentions légales", `<section><h1>Mentions légales</h1><p>Éditeur : Atelier Nova SAS.</p></section>`)],
    "/fr": ["text/html", layout("Accueil FR", `<section><h1>Bienvenue</h1><p>Version française.</p></section>`)],
    "/private/secret": ["text/html", layout("Secret", `<section><h1>Ne pas explorer</h1></section>`)],
    "/app": ["text/html", `<!doctype html><html lang="fr"><head><title>Démo | Atelier Nova</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`],
    "/app.js": [
      "text/javascript",
      `setTimeout(() => { document.getElementById("root").innerHTML = '<header><nav><a href="/">Accueil</a></nav></header><main><section><h1>Tableau de bord démo</h1><p>Visualisez vos commandes, vos plans et vos livraisons en temps réel depuis un seul écran, partout.</p><a class="btn" href="/signup">Essayer gratuitement</a></section><section><h2>Vos commandes</h2><div><div class="row"><h3>Table chêne</h3><p>En fabrication</p></div><div class="row"><h3>Bibliothèque</h3><p>Livrée</p></div><div class="row"><h3>Cuisine</h3><p>Plans validés</p></div></div></section></main>'; }, 300);`
    ]
  };
  for (const slug of posts) {
    routes[`/blog/${slug}`] = [
      "text/html",
      layout(
        slug,
        `<article><h1>${slug.replace(/-/g, " ")}</h1><time datetime="2026-03-01">1 mars 2026</time>${"<p>Le bois massif demande un séchage lent et une finition à l'huile naturelle pour durer.</p>".repeat(8)}<a href="/blog">Retour au journal</a></article>`,
        { head: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"${slug}","datePublished":"2026-03-01","author":{"@type":"Person","name":"Inès"}}</script>` }
      )
    ];
  }
  return routes;
}

async function main() {
  let routes = {};
  const hits = new Map();
  const server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    hits.set(path, (hits.get(path) || 0) + 1);
    if (path === "/old-page") return res.writeHead(301, { Location: "/about" }).end();
    const route = routes[path];
    if (!route) return res.writeHead(404, { "Content-Type": "text/html" }).end("<h1>Introuvable</h1>");
    res.writeHead(200, { "Content-Type": `${route[0]}; charset=utf-8`, "x-vercel-id": "cdg1::fixture", "Strict-Transport-Security": "max-age=63072000" }).end(route[1]);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  routes = pages(base);

  const userDataDir = await mkdtemp(join(tmpdir(), "keys-osi-site-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: "chromium",
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
  });
  const failures = [];
  const check = (label, condition, detail) => {
    console.log(`  ${condition ? "ok" : "FAIL"} - ${label}${condition || detail === undefined ? "" : `  (${JSON.stringify(detail).slice(0, 400)})`}`);
    if (!condition) failures.push(label);
  };

  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(() => chrome.storage.local.set({ keysOsiSaveAs: false }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const swErrors = [];
    worker.on("console", (msg) => msg.type() === "error" && swErrors.push(msg.text()));

    const page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: "load" });
    const ext = await context.newPage();
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=0`);
    const tabId = await ext.evaluate(async (origin) => (await chrome.tabs.query({ url: `${origin}/*` }))[0].id, base);
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html?tab=${tabId}`);

    console.log("Technical decoding:");
    await ext.click('.view-tab[data-view="site"]');
    await ext.click("#techBtn");
    await ext.waitForSelector("#techResult:not([hidden])", { timeout: 60000 });
    const tech = (await ext.evaluate(async () => (await chrome.storage.local.get("keysOsiLastTech")).keysOsiLastTech)).report;
    check("Next.js detected with its build id", tech.frameworks.some((f) => f.name === "Next.js" && f.buildId === "b42"), tech.frameworks);
    check("routes from the build manifest and the source tree", tech.routes.includes("/offre-cachee") && tech.routes.includes("/blog/[slug]") && tech.routeSources.length >= 2, { routes: tech.routes, sources: tech.routeSources });
    check("API endpoint, GraphQL operation, public env key from the bundle", tech.endpoints.some((e) => e.endpoint === "/api/devis?atelier=1") && tech.graphql.includes("query GetMeubles") && tech.envKeys.includes("NEXT_PUBLIC_SHOP_ID"), { endpoints: tech.endpoints, graphql: tech.graphql });
    check("source map read (2 first-party files with content)", tech.sourceStats.own === 2 && tech.sourceStats.withContent === 2, tech.sourceStats);
    check("hosting and security headers", tech.hosting.hosting.includes("Vercel") && tech.hosting.security["strict-transport-security"] === true, tech.hosting);
    check("page props shape without values", JSON.stringify(tech.frameworks.find((f) => f.name === "Next.js").pagePropsShape) === '{"meubles":[{"nom":"string","prix":"number"}]}', tech.frameworks);
    const sources = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "TECH_EXPORT", what: "sources" }));
    check("original sources ZIP (2 files + TECH_STACK.md)", sources.ok && sources.fileCount === 3, sources);

    console.log("Site view scan:");
    await ext.selectOption("#siteSample", "3");
    const started = Date.now();
    await ext.click("#siteScanBtn");
    await ext.waitForSelector("#siteResult:not([hidden])", { timeout: 120000 });
    console.log(`  (scan: ${((Date.now() - started) / 1000).toFixed(1)} s)`);
    const ui = await ext.evaluate(() => ({
      rows: document.querySelectorAll("#sitePages .site-page").length,
      stats: [...document.querySelectorAll(".site-stat")].map((node) => node.textContent),
      status: document.getElementById("siteStatus").textContent
    }));
    check("popup lists the analysed pages", ui.rows >= 12, ui);
    check("popup shows the summary", /Structure prête/.test(ui.status), ui.status);

    const site = await ext.evaluate(async () => (await chrome.storage.local.get("keysOsiLastSite")).keysOsiLastSite);
    const paths = site.pages.map((p) => p.path).sort();
    console.log(`  analysed: ${paths.join(" ")}`);
    check("route found only by the decoding is crawled", paths.includes("/offre-cachee"));
    for (const path of ["/", "/about", "/pricing", "/signup", "/features", "/blog", "/contact", "/app", "/fr", "/mentions-legales"]) {
      check(`analysed ${path}`, paths.includes(path));
    }
    check("robots.txt Disallow respected (never requested)", !hits.has("/private/secret") && site.robotsExcluded.some((url) => url.endsWith("/private/secret")), { hit: hits.get("/private/secret"), excluded: site.robotsExcluded });
    check("sitemap index followed", hits.has("/sitemap-pages.xml") && site.stats.sitemapUrls >= 13);
    const blogTemplate = site.templates.find((t) => t.pattern === "/blog/:slug");
    check("blog posts grouped as one template of 6", blogTemplate?.count === 6, blogTemplate);
    check("only 3 posts fetched (template sampling)", posts.filter((slug) => hits.has(`/blog/${slug}`)).length === 3, posts.map((slug) => hits.get(`/blog/${slug}`) || 0));
    check("template type and data fields", blogTemplate?.type === "blog-post" && blogTemplate.fields.some((f) => f.name === "datePublished"), blogTemplate);
    const app = site.pages.find((p) => p.path === "/app");
    check("JavaScript-only page rendered in a real tab", app?.rendered === true && app.h1 === "Tableau de bord démo", { rendered: app?.rendered, h1: app?.h1 });
    check("rendered page keeps its sections and CTA", app?.sections.some((s) => s.ctas.some((c) => c.label === "Essayer gratuitement")), app?.sections);
    check("tracking parameters stripped (/pricing analysed once)", paths.filter((p) => p.startsWith("/pricing")).length === 1);
    check("redirect /old-page folded into /about", !paths.includes("/old-page"));
    check("broken link reported", site.failures.some((f) => f.url.endsWith("/broken") && /404/.test(f.error)), site.failures);
    check("nested navigation kept", site.navigation.some((item) => item.text === "Produit" && item.children.some((child) => child.text === "Fonctionnalités")), site.navigation);
    check("footer groups, social, legal line", site.footer?.groups.some((g) => g.title === "Société") && site.footer.social.some((s) => s.network === "instagram") && /© 2026/.test(site.footer.legal), site.footer);
    check("newsletter detected as shared block", site.sharedBlocks.some((b) => b.heading === "Restez informé" && b.pages.length >= 3), site.sharedBlocks);
    const flow = site.flows.find((f) => f.steps.map((s) => s.path).join(">") === "/>/pricing>/signup");
    check("conversion flow home → pricing → signup", Boolean(flow?.endsInConversion), site.flows);
    const contactForm = site.forms.find((f) => f.purpose === "contact");
    check("contact form fields with labels and required flags", contactForm?.fields.length === 4 && contactForm.fields.find((f) => f.name === "message")?.required === true && contactForm.fields.find((f) => f.type === "select")?.options.join() === "Table,Cuisine", contactForm);
    check("page types", site.pages.find((p) => p.path === "/pricing")?.type === "pricing" && site.pages.find((p) => p.path === "/signup")?.type === "auth" && site.pages.find((p) => p.path === "/mentions-legales")?.type === "legal" && site.pages.find((p) => p.path === "/fr")?.type === "home");
    const pricing = site.pages.find((p) => p.path === "/pricing");
    check("pricing tiers extracted as items with prices", pricing?.sections[0].items.length === 3 && pricing.sections[0].items[2].price === "2 400 €", pricing?.sections[0].items);
    check("integrations detected from script sources", site.integrations.some((i) => i.name === "Google Analytics"));
    check("site name from title pattern", site.siteName === "Atelier Nova", site.siteName);

    console.log("Exports:");
    const master = generateSiteStructureMarkdown(site);
    for (const needle of ["Technology (decoded): Next.js", "routes from the build manifests / source maps were added to the crawl", "/blog/:slug (blog-post ×6)", "- Produit", "  - Fonctionnalités → `/features`", "### contact form", "app/blog/[slug]/page.tsx", "Excluded by robots.txt: 1"]) {
      check(`SITE_STRUCTURE.md has ${needle}`, master.includes(needle));
    }
    const files = buildSiteStructureFiles(site);
    check("one markdown file per analysed page", files.filter((f) => f.path.startsWith("pages/")).length === site.pages.length);
    const zip = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "SITE_EXPORT", what: "zip" }));
    check("ZIP export through the offscreen builder", zip.ok && zip.fileCount === files.length, zip);
    const pageExport = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "SITE_EXPORT", what: "page", path: "/contact" }));
    check("single page export", pageExport.ok && /contact\.md$/.test(pageExport.filename), pageExport);
    const windows = await ext.evaluate(() => chrome.windows.getAll());
    check("render window closed after the scan", windows.length === 1, windows.length);
    check("service worker logged no errors", swErrors.length === 0, swErrors);
  } finally {
    await context.close();
    server.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }

  if (failures.length > 0) {
    console.error(`\nSITE E2E FAILED: ${failures.length} assertion(s):\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nSite structure E2E passed.");
}

main().catch((error) => {
  console.error("Site E2E crashed:", error);
  process.exit(1);
});
