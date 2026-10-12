// Site structure: crawl planning, route templates, page types and documents.
import assert from "node:assert/strict";
import {
  analyzeSite,
  buildRouteIndex,
  buildSiteDigest,
  buildSiteStructureFiles,
  classifyPage,
  createCrawlState,
  enqueueUrl,
  generatePageMarkdown,
  generateSiteStructureMarkdown,
  isAllowedByRobots,
  nextCrawlTarget,
  normalizeCrawlUrl,
  pageSlug,
  parseRobots,
  parseSitemap
} from "../lib/site-structure.mjs";

// URL normalisation
{
  const origin = "https://www.example.com";
  assert.equal(normalizeCrawlUrl("/blog/?utm_source=x#top", origin), "https://www.example.com/blog");
  assert.equal(normalizeCrawlUrl("http://example.com/Pricing/", origin), "https://www.example.com/Pricing", "apex/http variants fold into the start origin");
  assert.equal(normalizeCrawlUrl("/shop?color=red&sort=asc&page=2", origin), "https://www.example.com/shop?page=2", "facets dropped, pagination kept");
  assert.equal(normalizeCrawlUrl("https://other.com/", origin), null);
  assert.equal(normalizeCrawlUrl("/brochure.pdf", origin), null);
  assert.equal(normalizeCrawlUrl("/wp-admin/edit.php", origin), null);
  assert.equal(normalizeCrawlUrl("/account/logout", origin), null);
  assert.equal(normalizeCrawlUrl("mailto:a@b.c", origin), null);
  assert.equal(normalizeCrawlUrl("/fr/index.html", origin), "https://www.example.com/fr");
}

// robots.txt (RFC 9309 longest match, Allow wins ties)
{
  const robots = parseRobots(`
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /private
Disallow: /*.json$
Allow: /private/press
Crawl-delay: 2
Sitemap: https://example.com/sitemap.xml
`);
  assert.equal(robots.crawlDelay, 2);
  assert.deepEqual(robots.sitemaps, ["https://example.com/sitemap.xml"]);
  assert.equal(isAllowedByRobots("/about", robots), true);
  assert.equal(isAllowedByRobots("/private/team", robots), false);
  assert.equal(isAllowedByRobots("/private/press/kit", robots), true, "longer Allow beats shorter Disallow");
  assert.equal(isAllowedByRobots("/data/feed.json", robots), false, "wildcard + end anchor");
  assert.equal(isAllowedByRobots("/data/feed.json?x=1", robots), true);
  assert.equal(isAllowedByRobots("/anything", parseRobots("User-agent: *\nDisallow:")), true, "empty Disallow allows all");
}

// Sitemaps (index + urlset, entities, CDATA)
{
  const index = parseSitemap(`<?xml version="1.0"?><sitemapindex><sitemap><loc>https://ex.com/s1.xml</loc></sitemap><sitemap><loc><![CDATA[https://ex.com/s2.xml]]></loc></sitemap></sitemapindex>`);
  assert.deepEqual(index.sitemaps, ["https://ex.com/s1.xml", "https://ex.com/s2.xml"]);
  const set = parseSitemap(`<urlset><url><loc>https://ex.com/a?x=1&amp;y=2</loc><lastmod>2026-01-02</lastmod></url><url><loc>https://ex.com/b</loc></url></urlset>`);
  assert.deepEqual(set.urls.map((entry) => entry.loc), ["https://ex.com/a?x=1&y=2", "https://ex.com/b"]);
  assert.equal(set.urls[0].lastmod, "2026-01-02");
}

// Route templates
{
  const paths = [
    "/", "/about", "/pricing", "/contact", "/careers", "/privacy",
    "/blog", "/blog/how-we-built-our-engine", "/blog/launch-2026", "/blog/ten-tips-for-teams", "/blog/why-design",
    "/shop/shoes/41", "/shop/shoes/42", "/shop/hats/7", "/shop/bags/3",
    "/fr", "/fr/menu", "/en", "/en/menu",
    "/blog?page=2"
  ];
  const { patternOf } = buildRouteIndex(paths);
  assert.equal(patternOf.get("/about"), "/about", "distinct top-level pages stay static");
  assert.equal(patternOf.get("/blog"), "/blog");
  assert.equal(patternOf.get("/blog/launch-2026"), "/blog/:slug");
  assert.equal(patternOf.get("/blog/why-design"), "/blog/:slug", "collection parent collapses even plain words");
  assert.equal(patternOf.get("/shop/shoes/41"), "/shop/:category/:id");
  assert.equal(patternOf.get("/fr/menu"), "/:lang/menu");
  assert.equal(patternOf.get("/blog?page=2"), "/blog?page=:n");
}

// Crawl state: priorities, robots, template sampling, budget
{
  const state = createCrawlState({ startUrl: "https://ex.com/", maxPages: 6, samplePerTemplate: 2, robots: parseRobots("User-agent: *\nDisallow: /admin") });
  assert.equal(nextCrawlTarget(state).url, "https://ex.com/");
  for (const slug of ["a-first-post-x", "b-second-post-y", "c-third-post-z", "d-fourth-post-w"]) enqueueUrl(state, `/blog/${slug}`, { source: "content" });
  enqueueUrl(state, "/pricing", { source: "nav" });
  enqueueUrl(state, "/admin/settings", { source: "nav" });
  enqueueUrl(state, "/blog", { source: "nav" });
  assert.equal(enqueueUrl(state, "/pricing"), false, "already seen");
  const order = [];
  for (let target = nextCrawlTarget(state); target; target = nextCrawlTarget(state)) order.push(new URL(target.url).pathname);
  assert.deepEqual(order.slice(0, 2), ["/pricing", "/blog"], "navigation links first");
  assert.equal(order.filter((path) => path.startsWith("/blog/")).length, 2, "only 2 samples of /blog/:slug");
  assert.equal(state.listed.length, 2, "other template members listed, not fetched");
  assert.deepEqual(state.robotsExcluded, ["https://ex.com/admin/settings"]);
  assert.ok(state.fetched <= 6);
}

// Page types
{
  assert.equal(classifyPage({ path: "/", sections: [] }).type, "home");
  assert.equal(classifyPage({ path: "/fr", sections: [] }).type, "home", "locale root is a home");
  assert.equal(classifyPage({ path: "/tarifs", sections: [] }).type, "pricing");
  assert.equal(classifyPage({ path: "/blog/x-y-z", sections: [] }, "/blog/:slug").type, "blog-post");
  assert.equal(classifyPage({ path: "/blog", sections: [{ items: [1, 2, 3] }] }).type, "blog-index");
  assert.equal(classifyPage({ path: "/item-9", jsonLd: { types: ["Product"] }, sections: [] }).type, "product");
  assert.equal(classifyPage({ path: "/mentions-legales", sections: [] }).type, "legal");
  assert.equal(classifyPage({ path: "/essays/hypermedia-apis", sections: [] }, "/essays/:slug").type, "blog-post");
  assert.equal(classifyPage({ path: "/reference", sections: [] }).type, "docs");
  assert.equal(classifyPage({ path: "/x", status: 404, sections: [] }).type, "not-found");
  assert.equal(classifyPage({ path: "/espace", forms: [{ purpose: "login" }], sections: [] }).type, "auth");
  assert.equal(pageSlug("/"), "home");
  const used = new Set();
  assert.equal(pageSlug("/Blog/Été 2026", used), "blog--ete-2026");
  assert.equal(pageSlug("/blog/ete-2026", new Set(["blog--ete-2026"])), "blog--ete-2026-2");
}

// Whole-site analysis and documents
{
  const origin = "https://ex.com";
  const nav = [
    { text: "Produit", href: `${origin}/product`, children: [{ text: "Fonctionnalités", href: `${origin}/features`, children: [] }] },
    { text: "Tarifs", href: `${origin}/pricing`, children: [] },
    { text: "Blog", href: `${origin}/blog`, children: [] }
  ];
  const footer = { groups: [{ title: "Société", links: [{ text: "À propos", href: `${origin}/about` }] }], social: [{ network: "linkedin", href: "https://linkedin.com/x" }], contact: ["hello@ex.com"], legal: "© 2026 Ex" };
  const newsletter = { role: "newsletter", heading: "Restez informé", ctas: [{ label: "S'abonner", href: "", internal: false, action: "submit" }], index: 3, items: [], forms: [0] };
  const page = (path, extra = {}) => ({
    url: origin + path,
    path,
    status: 200,
    title: `${extra.h1 || path} | Ex`,
    h1: extra.h1 || path,
    h1Count: 1,
    metaDescription: extra.desc || "",
    nav,
    footer,
    forms: extra.forms || [],
    ctas: extra.ctas || [],
    sections: extra.sections || [],
    internalLinks: (extra.links || []).map((href) => ({ href: origin + href, text: href, context: "content" })),
    integrations: ["Stripe"],
    jsonLd: extra.jsonLd || { types: [], summary: [] },
    hreflang: [],
    og: {},
    outline: [{ level: 1, text: extra.h1 || path }],
    wordCount: 300,
    lang: "fr",
    spa: { needsRender: false },
    rendered: Boolean(extra.rendered)
  });
  const newsletterForm = { purpose: "newsletter", method: "post", fields: [{ label: "Email", name: "email", type: "email", required: true, options: [], placeholder: "" }], submit: "S'abonner" };
  const pages = [
    page("/", {
      h1: "Le CRM des artisans",
      desc: "Gérez vos devis.",
      sections: [
        { role: "hero", heading: "Le CRM des artisans", index: 0, ctas: [{ label: "Voir les tarifs", href: `${origin}/pricing`, internal: true }], items: [] },
        { role: "features", heading: "Tout-en-un", index: 1, items: [{ title: "Devis" }, { title: "Factures" }, { title: "Planning" }], ctas: [] },
        newsletter
      ],
      forms: [newsletterForm]
    }),
    page("/pricing", {
      h1: "Tarifs",
      sections: [
        { role: "pricing", heading: "Nos offres", index: 0, items: [], ctas: [{ label: "Commencer", href: `${origin}/signup`, internal: true }], prices: 3 },
        newsletter
      ],
      forms: [newsletterForm]
    }),
    page("/signup", { h1: "Créer un compte", forms: [{ purpose: "signup", method: "post", fields: [{ label: "Email", name: "email", type: "email", required: true, options: [] }, { label: "Mot de passe", name: "password", type: "password", required: true, options: [] }], submit: "Créer" }], sections: [{ role: "contact", heading: "Inscription", index: 0, items: [], ctas: [] }] }),
    page("/blog", { h1: "Blog", sections: [{ role: "blog-list", heading: "Articles", index: 0, items: [{}, {}, {}], ctas: [] }, newsletter], forms: [newsletterForm], links: ["/blog/devis-en-5-minutes", "/blog/facturer-plus-vite"] }),
    page("/blog/devis-en-5-minutes", { h1: "Devis en 5 minutes", jsonLd: { types: ["BlogPosting"], summary: [{ type: "BlogPosting", datePublished: "2026-01-01", author: "Ana" }] }, sections: [{ role: "article", heading: "", index: 0, items: [], ctas: [] }] }),
    page("/blog/facturer-plus-vite", { h1: "Facturer plus vite", jsonLd: { types: ["BlogPosting"], summary: [{ type: "BlogPosting", datePublished: "2026-02-01", author: "Léo" }] }, sections: [{ role: "article", heading: "", index: 0, items: [], ctas: [] }] }),
    page("/about", { h1: "À propos", rendered: true, sections: [{ role: "team", heading: "L'équipe", index: 0, items: [], ctas: [] }] })
  ];
  const site = analyzeSite({
    startUrl: `${origin}/`,
    pages,
    listed: [{ url: `${origin}/blog/relances-automatiques`, pattern: "/blog/:slug" }],
    failures: [{ url: `${origin}/old`, error: "HTTP 500" }],
    robotsExcluded: [`${origin}/admin`],
    sitemapUrls: [`${origin}/about`],
    crawledAt: "2026-10-07T10:00:00.000Z",
    options: { maxPages: 50 }
  });
  assert.equal(site.siteName, "Ex", "site name from the title pattern");
  assert.equal(site.stats.pagesAnalyzed, 7);
  assert.equal(site.stats.rendered, 1);
  const blogTemplate = site.templates.find((template) => template.pattern === "/blog/:slug");
  assert.ok(blogTemplate, "blog template detected");
  assert.equal(blogTemplate.count, 3, "2 analysed + 1 listed");
  assert.equal(blogTemplate.type, "blog-post");
  assert.ok(blogTemplate.fields.some((field) => field.name === "datePublished"), "template data fields from JSON-LD");
  assert.equal(site.pages.find((p) => p.path === "/signup").type, "auth");
  assert.equal(site.navigation[0].children[0].text, "Fonctionnalités", "nested navigation kept");
  assert.ok(site.sharedBlocks.some((block) => block.role === "newsletter" && block.pages.length === 3), "newsletter band shared");
  assert.deepEqual(site.flows[0].steps.map((step) => step.path), ["/", "/pricing", "/signup"]);
  assert.equal(site.flows[0].endsInConversion, true);
  assert.equal(site.forms.length, 2, "newsletter form deduplicated across pages");
  assert.equal(site.seo.titlePattern, "{Page title} | Ex");
  assert.deepEqual(site.orphans, ["/about"], "sitemap page with no inbound link");

  const master = generateSiteStructureMarkdown(site);
  for (const needle of [
    "# SITE_STRUCTURE.md — Ex",
    "## 2. Sitemap (route tree)",
    "/blog/:slug (blog-post ×3)",
    "- Produit → `/product`",
    "  - Fonctionnalités → `/features`",
    "### `/blog/:slug` — Blog article, 3 pages",
    "`/blog/relances-automatiques`",
    "| `/pricing` | pricing |",
    "`/` —“Voir les tarifs”→ `/pricing` —“Commencer”→ `/signup` ✅ conversion",
    "### signup form",
    "app/blog/[slug]/page.tsx",
    "Excluded by robots.txt: 1",
    "Stripe"
  ]) {
    assert.ok(master.includes(needle), `SITE_STRUCTURE.md contains ${needle}`);
  }
  const home = site.pages.find((p) => p.path === "/");
  const homeMd = generatePageMarkdown(home, site);
  for (const needle of ["# / — Home page", "### 1. hero — “Le CRM des artisans”", "- CTA: “Voir les tarifs” → `/pricing`", "Repeated items (3, build as one card component)", "### Form #1 — newsletter"]) {
    assert.ok(homeMd.includes(needle), `home page md contains ${needle}`);
  }
  const files = buildSiteStructureFiles(site);
  assert.deepEqual(files.slice(0, 2).map((file) => file.path), ["SITE_STRUCTURE.md", "site-structure.json"]);
  assert.equal(files.length, 2 + 7);
  assert.ok(files.some((file) => file.path === "pages/blog--devis-en-5-minutes.md"));
  assert.ok(JSON.parse(files[1].content).pages.length === 7);
  const digest = buildSiteDigest(site);
  assert.ok(digest.includes("Template /blog/:slug") && digest.includes("Page /pricing [pricing]"));
}

console.log("Site structure tests passed.");
