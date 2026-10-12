/**
 * MAIN-world inspector: runs in the page's own JavaScript context to
 * read animation runtimes the isolated content script cannot see —
 * GSAP timelines (with values and targets), ScrollTrigger instances,
 * WebGL/animation library globals, and framework globals.
 *
 * Results are written as JSON onto a hidden DOM node that the content
 * script reads back.
 */
(function keysOsiMainWorldInspector() {
  const data = {
    gsap: { detected: false, version: null, timelines: [] },
    scrollTriggers: [],
    animationLibs: [],
    frameworks: []
  };

  function describeTarget(target) {
    try {
      if (!target) return "";
      if (typeof target === "string") return target.slice(0, 60);
      if (target.tagName) {
        const id = target.id ? `#${target.id}` : "";
        const classes =
          target.classList && target.classList.length > 0
            ? `.${Array.from(target.classList).slice(0, 2).join(".")}`
            : "";
        return `${target.tagName.toLowerCase()}${id}${classes}`.slice(0, 60);
      }
      return String(target).slice(0, 40);
    } catch (e) {
      return "";
    }
  }

  function serializeVars(vars) {
    const out = {};
    let count = 0;
    for (const key in vars) {
      if (count >= 10) break;
      const value = vars[key];
      const type = typeof value;
      if (type === "number" || type === "boolean") {
        out[key] = value;
        count += 1;
      } else if (type === "string") {
        out[key] = value.slice(0, 60);
        count += 1;
      }
    }
    return out;
  }

  /* ---- GSAP: timelines with animated values and targets ---- */
  try {
    if (window.gsap) {
      data.gsap.detected = true;
      data.gsap.version = window.gsap.version || "unknown";
      const children = window.gsap.globalTimeline.getChildren(true, true, true);
      data.gsap.timelines = children.slice(0, 12).map((tween) => {
        let targets = [];
        try {
          if (typeof tween.targets === "function") {
            targets = tween.targets().slice(0, 3).map(describeTarget);
          }
        } catch (e) {}
        return {
          type: (tween.constructor && tween.constructor.name) || "Tween",
          duration: typeof tween.duration === "function" ? tween.duration() : tween.duration || 0,
          delay: typeof tween.delay === "function" ? tween.delay() : tween.delay || 0,
          vars: tween.vars ? Object.keys(tween.vars).filter((k) => typeof tween.vars[k] !== "function") : [],
          values: tween.vars ? serializeVars(tween.vars) : {},
          targets
        };
      });
    }
  } catch (e) {}

  /* ---- ScrollTrigger: scroll-linked animation instances ---- */
  try {
    const ScrollTrigger = window.ScrollTrigger;
    if (ScrollTrigger && typeof ScrollTrigger.getAll === "function") {
      data.scrollTriggers = ScrollTrigger.getAll().slice(0, 12).map((st) => {
        const vars = st.vars || {};
        return {
          trigger: describeTarget(st.trigger || vars.trigger),
          start: typeof st.start === "number" ? `${Math.round(st.start)}px` : String(vars.start || ""),
          end: typeof st.end === "number" ? `${Math.round(st.end)}px` : String(vars.end || ""),
          scrub: vars.scrub === true ? true : typeof vars.scrub === "number" ? vars.scrub : false,
          pin: Boolean(vars.pin),
          snap: Boolean(vars.snap),
          toggleActions: vars.toggleActions ? String(vars.toggleActions).slice(0, 60) : "",
          animation:
            st.animation && st.animation.vars ? serializeVars(st.animation.vars) : {}
        };
      });
    }
  } catch (e) {}

  /* ---- WebGL & animation library globals ---- */
  const addLib = (name, evidence) => data.animationLibs.push({ name, evidence });
  try {
    // Bundled three.js has no window.THREE but always sets __THREE__ = REVISION.
    if (window.THREE || window.__THREE__) {
      addLib("Three.js", `r${(window.THREE && window.THREE.REVISION) || window.__THREE__ || "?"} (WebGL)`);
    }
    if (customElements.get("spline-viewer") || document.querySelector("spline-viewer")) addLib("Spline", "3D scene viewer");
    if (customElements.get("model-viewer") || document.querySelector("model-viewer")) addLib("model-viewer", "glTF viewer web component");
    if (window.PIXI) addLib("PixiJS", `v${(window.PIXI.VERSION || "?")} (WebGL)`);
    if (window.BABYLON) addLib("Babylon.js", `v${(window.BABYLON.Engine && window.BABYLON.Engine.Version) || "?"} (WebGL)`);
    if (window.VANTA) addLib("Vanta.js", "animated WebGL backgrounds");
    if (window.lottie || window.bodymovin) {
      const lottie = window.lottie || window.bodymovin;
      addLib("Lottie", `v${lottie.version || "?"}`);
    }
    if (window.AOS) addLib("AOS", "animate-on-scroll");
    if (window.Lenis) addLib("Lenis", "smooth scroll");
    if (window.LocomotiveScroll) addLib("Locomotive Scroll", "smooth scroll + parallax");
    if (window.Swiper) addLib("Swiper", "carousel");
    if (window.ScrollReveal) addLib("ScrollReveal", "reveal-on-scroll");
    if (window.Rellax) addLib("Rellax", "parallax");
    if (window.anime) addLib("Anime.js", `v${window.anime.version || "?"}`);
    if (window.particlesJS || window.tsParticles) addLib("Particles", "particle background");
    if (window.ScrollMagic) addLib("ScrollMagic", "scroll choreography");
    if (window.Typed) addLib("Typed.js", "typing animation");
    if (window.barba) addLib("Barba.js", "page transitions");
  } catch (e) {}

  /* ---- Framework globals ---- */
  const addFramework = (name, evidence) => data.frameworks.push({ name, evidence });
  try {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if ((hook && hook.renderers && hook.renderers.size > 0) || window.React) {
      addFramework("React", "runtime global");
    }
    if (window.next || window.__NEXT_DATA__) addFramework("Next.js", "window.__NEXT_DATA__");
    if (window.__VUE__ || window.__VUE_DEVTOOLS_GLOBAL_HOOK__) addFramework("Vue", "runtime global");
    if (window.__NUXT__ || window.useNuxtApp) addFramework("Nuxt", "window.__NUXT__");
    if (window.ng || window.getAllAngularRootElements) addFramework("Angular", "runtime global");
    if (window.__svelte) addFramework("Svelte", "window.__svelte");
    if (window.Shopify) addFramework("Shopify", "window.Shopify");
    if (window.Webflow) addFramework("Webflow", "window.Webflow");
    if (window.wixBiSession) addFramework("Wix", "window.wixBiSession");
    if (window.wp && window.wp.blocks) addFramework("WordPress", "window.wp.blocks");
    if (window.jQuery && window.jQuery.fn) addFramework("jQuery", `v${window.jQuery.fn.jquery || "?"}`);
    if (window.Alpine) addFramework("Alpine.js", "window.Alpine");
    if (window.htmx) addFramework("htmx", "window.htmx");
  } catch (e) {}

  let meta = document.getElementById("__keys_osi_inspector_data");
  if (!meta) {
    meta = document.createElement("div");
    meta.id = "__keys_osi_inspector_data";
    meta.style.display = "none";
    (document.body || document.documentElement).appendChild(meta);
  }
  meta.setAttribute("data-gsap", JSON.stringify(data));
})();
