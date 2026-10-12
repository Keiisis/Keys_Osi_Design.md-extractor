/**
 * Keys_Osi tech probe — injected in the page's MAIN world (read-only).
 * Reads what only the page's own JavaScript realm exposes: framework
 * runtimes and versions, router/build data, client state roots, analytics
 * SDKs, network resources actually loaded, custom elements. Values that may
 * hold personal data (cookies, storage) are reduced to key names.
 * The completion value of this script is the probe result.
 */
(() => {
  const w = window;
  const safe = (fn, fallback = null) => {
    try {
      const value = fn();
      return value === undefined ? fallback : value;
    } catch (error) {
      return fallback;
    }
  };
  const keysOf = (obj, max = 40) => (obj && typeof obj === "object" ? Object.keys(obj).slice(0, max) : []);
  const shape = (obj, depth = 0) => {
    // Data shape without values: { field: "string" | "number" | [shape] | {…} }.
    if (obj === null) return "null";
    if (Array.isArray(obj)) return obj.length ? [shape(obj[0], depth + 1)] : [];
    if (typeof obj !== "object") return typeof obj;
    if (depth >= 3) return "object";
    const out = {};
    for (const key of Object.keys(obj).slice(0, 25)) out[key] = shape(obj[key], depth + 1);
    return out;
  };

  const frameworks = [];
  const add = (name, version, extra) => frameworks.push({ name, version: version ? String(version) : "", ...(extra || {}) });

  // React: the devtools hook lists renderers with their versions even without devtools.
  const reactVersions = safe(() => [...w.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.values()].map((r) => r.version).filter(Boolean), []);
  const reactRoot = safe(() => Boolean(document.querySelector("[data-reactroot]") || [...document.querySelectorAll("body > div")].some((el) => Object.keys(el).some((k) => k.startsWith("__reactContainer") || k.startsWith("_reactRootContainer")))), false);
  if (reactVersions.length || reactRoot || w.React) add("React", reactVersions[0] || safe(() => w.React.version, ""));

  const nextData = safe(() => w.__NEXT_DATA__);
  const nextAppRouter = safe(() => Array.isArray(w.__next_f), false);
  if (nextData || nextAppRouter || w.next) {
    add("Next.js", safe(() => w.next.version, ""), {
      router: nextAppRouter ? "app" : "pages",
      buildId: nextData?.buildId || "",
      page: nextData?.page || "",
      assetPrefix: nextData?.assetPrefix || "",
      locales: nextData?.locales || [],
      runtimeConfigKeys: keysOf(nextData?.runtimeConfig),
      pagePropsShape: shape(safe(() => nextData.props.pageProps, {}))
    });
  }
  const nuxt = safe(() => w.__NUXT__ || w.useNuxtApp?.());
  if (nuxt || document.getElementById("__nuxt")) {
    add("Nuxt", safe(() => w.__nuxt_vue?.version || "", ""), { publicConfigKeys: keysOf(safe(() => nuxt.config.public)), stateKeys: keysOf(safe(() => nuxt.state || nuxt.payload?.state)) });
  }
  const vueApp = safe(() => document.querySelector("[data-v-app]")?.__vue_app__);
  if (vueApp || w.Vue || w.__VUE__) add("Vue", safe(() => vueApp.version, "") || safe(() => w.Vue.version, ""));
  const ngVersion = safe(() => document.querySelector("[ng-version]")?.getAttribute("ng-version"));
  if (ngVersion || w.ng || w.getAllAngularRootElements) add("Angular", ngVersion || "");
  if (w.__sveltekit_dev || Object.keys(w).some((k) => k.startsWith("__sveltekit"))) add("SvelteKit", "");
  else if (document.querySelector("[class*='svelte-']")) add("Svelte", "");
  const remix = safe(() => w.__remixContext);
  if (remix || w.__remixManifest) {
    const routes = safe(() => Object.values(w.__remixManifest.routes).map((route) => ({ id: route.id, path: route.path ?? "", parentId: route.parentId || "", index: Boolean(route.index) })), []);
    add("Remix / React Router", w.__reactRouterVersion || "", { routes });
  }
  if (w.___gatsby || w.___loader) add("Gatsby", "");
  if (document.querySelector("astro-island, [data-astro-cid], astro-slot")) add("Astro", safe(() => document.querySelector("meta[name='generator'][content^='Astro']").content.split(" ")[1], ""));
  if (document.querySelector("[q\\:container]")) add("Qwik", safe(() => document.querySelector("[q\\:version]")?.getAttribute("q:version"), ""));
  if (w._$HY) add("SolidJS", "");
  if (w.__PREACT_DEVTOOLS__ || w.preact) add("Preact", "");
  if (w.Ember) add("Ember", safe(() => w.Ember.VERSION, ""));
  if (w.jQuery) add("jQuery", safe(() => w.jQuery.fn.jquery, ""));
  if (w.Alpine) add("Alpine.js", safe(() => w.Alpine.version, ""));
  if (w.htmx) add("htmx", safe(() => w.htmx.version, ""));
  if (w.litElementVersions || w.litHtmlVersions) add("Lit", safe(() => w.litElementVersions[0] || w.litHtmlVersions[0], ""));
  if (w.Turbo || w.Stimulus) add("Hotwire (Turbo/Stimulus)", "");
  if (w.gsap) add("GSAP", safe(() => w.gsap.version, ""));
  if (w.THREE || w.__THREE__) add("three.js", safe(() => w.THREE?.REVISION || w.__THREE__, ""));
  if (w.Webflow || document.documentElement.hasAttribute("data-wf-site")) add("Webflow", "", { siteId: document.documentElement.getAttribute("data-wf-site") || "" });
  if (w.__framer_importFromPackage || document.querySelector("[data-framer-name], #__framer-badge-container")) add("Framer", "");
  if (w.wixBiSession || document.querySelector("meta[name='generator'][content*='Wix']")) add("Wix", "");
  if (w.Shopify) add("Shopify", "", { theme: safe(() => ({ name: w.Shopify.theme.name, id: w.Shopify.theme.id, schema: w.Shopify.theme.schema_name || "" }), null) });
  if (w.Static?.SQUARESPACE_CONTEXT) add("Squarespace", "");
  if (w.drupalSettings) add("Drupal", "");
  if (w.wp || document.querySelector("link[href*='wp-content'], script[src*='wp-includes']")) {
    const themes = [...new Set([...document.querySelectorAll("link[href*='/wp-content/themes/'], script[src*='/wp-content/themes/']")].map((el) => ((el.href || el.src).match(/themes\/([^/]+)/) || [])[1]).filter(Boolean))];
    const plugins = [...new Set([...document.querySelectorAll("link[href*='/wp-content/plugins/'], script[src*='/wp-content/plugins/']")].map((el) => ((el.href || el.src).match(/plugins\/([^/]+)/) || [])[1]).filter(Boolean))];
    add("WordPress", "", { themes, plugins });
  }

  const services = [];
  const svc = (name, test) => safe(test, false) && services.push(name);
  svc("Google Tag Manager / gtag", () => Boolean(w.dataLayer || w.gtag));
  svc("Segment", () => Boolean(w.analytics && w.analytics.VERSION));
  svc("PostHog", () => Boolean(w.posthog));
  svc("Mixpanel", () => Boolean(w.mixpanel));
  svc("Amplitude", () => Boolean(w.amplitude));
  svc("Hotjar", () => Boolean(w.hj));
  svc("Microsoft Clarity", () => Boolean(w.clarity));
  svc("Sentry", () => Boolean(w.__SENTRY__ || w.Sentry));
  svc("Datadog RUM", () => Boolean(w.DD_RUM));
  svc("LogRocket", () => Boolean(w.LogRocket));
  svc("Intercom", () => Boolean(w.Intercom));
  svc("Crisp", () => Boolean(w.$crisp));
  svc("HubSpot", () => Boolean(w._hsq || w.HubSpotConversations));
  svc("Stripe.js", () => Boolean(w.Stripe));
  svc("Algolia", () => Boolean(w.algoliasearch || document.querySelector("[class*='ais-']")));
  svc("Firebase", () => Boolean(w.firebase || Object.keys(w).some((k) => k.startsWith("__FIREBASE"))));
  svc("Supabase", () => [...document.scripts].some((s) => /supabase/.test(s.src)));
  svc("Apollo GraphQL", () => Boolean(w.__APOLLO_CLIENT__ || w.__APOLLO_STATE__));
  svc("Redux", () => Boolean(w.__PRELOADED_STATE__ || w.__REDUX_STATE__));
  svc("Lenis smooth scroll", () => Boolean(w.lenis || document.documentElement.classList.contains("lenis")));

  const stateRoots = ["__APOLLO_STATE__", "__PRELOADED_STATE__", "__INITIAL_STATE__", "__INITIAL_DATA__", "__remixContext", "__NUXT__", "__NEXT_DATA__"]
    .filter((key) => safe(() => w[key] !== undefined, false))
    .map((key) => ({ key, shape: shape(safe(() => (key === "__NEXT_DATA__" ? w[key].props : w[key]), {})) }));

  const resources = safe(
    () =>
      performance
        .getEntriesByType("resource")
        .slice(0, 600)
        .map((entry) => ({ url: entry.name, type: entry.initiatorType, size: entry.transferSize || 0 })),
    []
  );

  const customElements = safe(
    () => [...new Set([...document.querySelectorAll("*")].map((el) => el.localName).filter((name) => name.includes("-") && w.customElements.get(name)))].slice(0, 40),
    []
  );

  const classTokens = [];
  for (const el of document.querySelectorAll("[class]")) {
    if (classTokens.length > 3000) break;
    const value = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
    classTokens.push(...value.split(/\s+/).filter(Boolean));
  }

  return {
    url: location.href,
    title: document.title,
    generator: safe(() => document.querySelector("meta[name='generator']").content, ""),
    frameworks,
    services,
    stateRoots,
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 200),
    inlineScripts: [...document.scripts].filter((s) => !s.src).length,
    stylesheets: [...document.querySelectorAll("link[rel='stylesheet']")].map((l) => l.href).slice(0, 100),
    resources,
    customElements,
    serviceWorker: safe(() => navigator.serviceWorker.controller?.scriptURL || "", ""),
    manifest: safe(() => document.querySelector("link[rel='manifest']").href, ""),
    cookieNames: safe(() => document.cookie.split(";").map((part) => part.split("=")[0].trim()).filter(Boolean).slice(0, 40), []),
    storageKeys: safe(() => Object.keys(localStorage).slice(0, 40), []),
    classTokens: classTokens.slice(0, 3000)
  };
})();
