// Technical decoding: source maps, bundles, build manifests, headers, CSS.
import assert from "node:assert/strict";
import {
  analyzeHeaders,
  buildSourceZipFiles,
  buildTechReport,
  decodeInlineSourceMap,
  detectCssArchitecture,
  findSourceMapUrl,
  generateTechMarkdown,
  normalizeSourcePath,
  parseNextBuildManifest,
  parseSourceMap,
  routesFromAppChunks,
  routesFromRemix,
  routesFromSourcePaths,
  scanBundle,
  staticRoutes
} from "../lib/tech-decode.mjs";

// Source map discovery and parsing
{
  assert.equal(findSourceMapUrl("x();\n//# sourceMappingURL=main.js.map\n", "https://a.com/_next/static/chunks/main.js"), "https://a.com/_next/static/chunks/main.js.map");
  assert.equal(findSourceMapUrl("x()", "https://a.com/app.js", { sourcemap: "/maps/app.map" }), "https://a.com/maps/app.map", "SourceMap header wins");
  assert.equal(findSourceMapUrl("var s = '//# sourceMappingURL=fake.map'; run();", "https://a.com/a.js"), null, "only a trailing comment counts");
  const inline = `data:application/json;base64,${Buffer.from(JSON.stringify({ version: 3, sources: ["src/a.ts"], sourcesContent: ["export const a = 1;"] })).toString("base64")}`;
  assert.equal(decodeInlineSourceMap(inline).sources[0], "src/a.ts");
  assert.equal(normalizeSourcePath("webpack://_N_E/./app/blog/[slug]/page.tsx?abc"), "app/blog/[slug]/page.tsx");
  assert.equal(normalizeSourcePath("../../src/components/Hero.vue", "vite:"), "src/components/Hero.vue");
  assert.equal(normalizeSourcePath("turbopack://[project]/src/app/page.tsx"), "src/app/page.tsx");
  const files = parseSourceMap({
    sections: [
      { offset: { line: 0, column: 0 }, map: { version: 3, sources: ["webpack://_N_E/./app/page.tsx", "webpack://_N_E/./node_modules/react/index.js"], sourcesContent: ["export default function Home(){}", "module.exports={}"] } },
      { offset: { line: 9, column: 0 }, map: { version: 3, sourceRoot: "webpack://", sources: ["./app/about/page.tsx"], sourcesContent: [null] } }
    ]
  });
  assert.deepEqual(files.map((file) => [file.path, file.external, file.content !== null]), [
    ["app/page.tsx", false, true],
    ["node_modules/react/index.js", true, true],
    ["app/about/page.tsx", false, false]
  ]);
  const zip = buildSourceZipFiles([{ url: "m", files }]);
  assert.deepEqual(zip.map((file) => file.path), ["sources/app/page.tsx"], "dependencies and content-less files skipped");
  assert.equal(buildSourceZipFiles([{ url: "m", files }], { includeDependencies: true }).length, 2);
}

// Bundle scanning
{
  const scan = scanBundle(`
    fetch("/api/products?limit=10");axios.post('/api/cart', x);client.get("/v2/orders/" + id);
    const ws = "wss://live.example.com/socket";
    const q = gql\`query GetProducts { products { id } }\`; const m = "mutation AddToCart($id: ID!) {";
    process.env.NEXT_PUBLIC_API_URL; import.meta.env.VITE_STRIPE_KEY;
    fetch("/static/logo.png");
  `);
  assert.ok(scan.endpoints.includes("/api/products?limit=10") && scan.endpoints.includes("/api/cart") && scan.endpoints.includes("wss://live.example.com/socket"), scan.endpoints);
  assert.ok(!scan.endpoints.some((endpoint) => endpoint.endsWith(".png")), "assets are not endpoints");
  assert.deepEqual(scan.graphql.sort(), ["mutation AddToCart", "query GetProducts"]);
  assert.deepEqual(scan.envKeys.sort(), ["NEXT_PUBLIC_API_URL", "VITE_STRIPE_KEY"]);
}

// Build manifests and routes
{
  assert.deepEqual(parseNextBuildManifest(`self.__BUILD_MANIFEST=function(s){return{__rewrites:{},"/":[s],"/blog/[slug]":[s],sortedPages:["/","/_app","/_error","/about","/blog/[slug]","/pricing"]}}("x");`), ["/", "/about", "/blog/[slug]", "/pricing"]);
  assert.deepEqual(routesFromAppChunks(["https://a.com/_next/static/chunks/app/(marketing)/blog/%5Bslug%5D/page-ab12cd.js", "https://a.com/_next/static/chunks/app/layout-99.js", "https://a.com/_next/static/chunks/app/page-11aa.js"]).sort(), ["/", "/blog/[slug]"]);
  assert.deepEqual(routesFromRemix([{ id: "root", path: "" }, { id: "routes/_index", parentId: "root", index: true }, { id: "routes/blog", parentId: "root", path: "blog" }, { id: "routes/blog.$slug", parentId: "routes/blog", path: ":slug" }]).sort(), ["/", "/blog", "/blog/:slug"]);
  assert.deepEqual(routesFromSourcePaths(["app/(shop)/products/[id]/page.tsx", "src/app/page.tsx", "pages/_app.tsx", "pages/about.tsx", "pages/api/hello.ts", "src/routes/contact/+page.svelte", "pages/index.vue", "src/pages/blog/index.astro"]).sort(), ["/", "/about", "/blog", "/contact", "/products/[id]"]);
  assert.deepEqual(staticRoutes(["/", "/blog/[slug]", "/a/:id", "/about", "/docs/*"]), ["/", "/about"]);
}

// Headers and CSS
{
  const headers = analyzeHeaders({ "X-Vercel-Id": "cdg1::abc", Server: "Vercel", "Strict-Transport-Security": "max-age=1", "Content-Security-Policy": "default-src 'self'; script-src 'self' https://js.stripe.com" });
  assert.deepEqual(headers.hosting, ["Vercel"]);
  assert.equal(headers.security["strict-transport-security"], true);
  assert.equal(headers.security["x-frame-options"], false);
  assert.deepEqual(headers.cspSources, ["https://js.stripe.com"]);
  const tailwind = detectCssArchitecture(["flex", "items-center", "gap-4", "px-6", "md:grid-cols-3", "text-sm", "bg-white", "rounded-xl", "hero", "card"]);
  assert.equal(tailwind[0].name, "Tailwind CSS (utilities)");
  const modules = detectCssArchitecture(Array.from({ length: 8 }, (_, i) => `Header_nav__a1B2${i}`));
  assert.equal(modules[0].name, "CSS Modules");
}

// Report + markdown
{
  const report = buildTechReport({
    probe: {
      url: "https://shop.example.com/",
      title: "Shop",
      generator: "",
      frameworks: [{ name: "Next.js", version: "15.1.0", router: "app", buildId: "b1", locales: [] }, { name: "React", version: "19.0.0" }],
      services: ["Stripe.js"],
      stateRoots: [{ key: "__NEXT_DATA__", shape: { pageProps: { products: [{ id: "string" }] } } }],
      scripts: ["https://shop.example.com/_next/static/chunks/main.js"],
      inlineScripts: 2,
      resources: [{ url: "https://shop.example.com/api/cart", type: "fetch" }, { url: "https://js.stripe.com/v3", type: "script" }],
      customElements: [],
      serviceWorker: "",
      manifest: "",
      cookieNames: ["session"],
      storageKeys: [],
      classTokens: ["flex", "gap-4", "px-6", "text-sm"]
    },
    headers: { "x-vercel-id": "x" },
    bundles: [{ url: "https://shop.example.com/_next/static/chunks/main.js", endpoints: ["/api/products", "/api/cart"], graphql: [], envKeys: ["NEXT_PUBLIC_API_URL"], bytes: 1000, sourceMap: "https://shop.example.com/_next/static/chunks/main.js.map" }],
    maps: [{ url: "m", files: [{ path: "app/page.tsx", content: "x", external: false }, { path: "node_modules/a.js", content: "y", external: true }] }],
    routes: [{ source: "Next.js build manifest", list: ["/", "/pricing"] }],
    decodedAt: "2026-10-07T12:00:00.000Z"
  });
  assert.equal(report.endpoints[0].endpoint, "/api/cart", "runtime-confirmed endpoints first");
  assert.equal(report.endpoints[0].runtime, true);
  assert.deepEqual(report.sourceStats, { files: 2, own: 1, withContent: 1 });
  const md = generateTechMarkdown(report);
  for (const needle of ["# TECH_STACK.md — Shop", "Next.js 15.1.0, React 19.0.0", "Next.js App Router (build b1)", "Tailwind CSS", "Hosting / CDN: Vercel", "Recommended rebuild stack: Next.js (same router) + Tailwind CSS", "/pricing", "| `/api/cart` | yes | 1 |", "`NEXT_PUBLIC_API_URL`", "app/ (1)"]) {
    assert.ok(md.includes(needle), `TECH_STACK.md contains ${needle}`);
  }
}

console.log("Tech decode tests passed.");
