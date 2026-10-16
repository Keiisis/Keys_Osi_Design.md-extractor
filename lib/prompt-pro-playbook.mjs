/**
 * Keys_Osi PROMPT_PRO playbook: how an elite, build-ready website prompt
 * is written, distilled from a study of 185 production website prompts
 * (structure, density, motion vocabulary) plus the gaps that corpus
 * leaves open (accessibility, reduced motion, performance, acceptance
 * criteria). Original wording; no prompt is reproduced.
 *
 * Study (2026-10-16, scripts/study-prompt-corpus.mjs → corpus/study.json,
 * sources in corpus/README.md): 109 motionsites.ai prompts, 72 prompts of
 * DexZane/awesome-web-prompts (MIT) and 4 exact-spec prompts added by the
 * user (Mostar, Driftbar, Planet Jumping, Ethan Vale). Combined: median
 * 6.1k chars (p90 17.1k); 83% video backdrop, 77% React, 72% Tailwind,
 * 32% single-file / zero-dependency builds, 61% glass (24% "liquid glass"),
 * 39% staggered reveals, 25% CSS masks, 8% cursor-driven media, 3% 3D/WebGL,
 * 16% reduced-motion, 20% aria/alt/focus rules. Fonts: Inter (25%),
 * Instrument Serif (15%), Barlow (4%). Per source: motionsites median 4.6k
 * chars and 1% reduced-motion; awesome-web-prompts median 8.6k and 35%.
 * Medians measured around each motion pattern calibrate the recipes below
 * (fade-up 0.6s, stagger 0.085s, liquid-glass blur 4px, video crossfade 0.55s).
 *
 * Split by stack (combined.byStack): the 20 vanilla prompts (median 20.4k
 * chars) state what NOT to add in 70% of cases vs 13% for the 103 React
 * prompts (median 5.6k), pin exact asset URLs 65% vs 7%, give the exact
 * DOM / layer order 55% vs 1%, an acceptance check 35% vs 1%, timeout
 * backstops 55% vs 5%, reduced motion 75% vs 4%, aria/alt/focus 90% vs 6%.
 * Correlation, not proof, but it matches what the user observed: the
 * exact-spec vanilla prompts are the ones that leave an agent no room for
 * generic output. The QUALITY_BAR and recipes below encode those traits
 * (scroll stage and looping carousel from Mostar, glass wordmark from
 * Driftbar, fail-safe entrance from the Vesper prompt, portal window from
 * Planet Jumping, sphere gallery from Ethan Vale).
 *
 * Default build stack: plain HTML + CSS + vanilla JavaScript, no framework,
 * no build step. A framework is used only when the user names one (detectStack).
 */

/** Build stack when the user names none: plain files, native APIs. */
export const VANILLA_STACK =
  "Plain HTML + CSS + vanilla JavaScript in three files: index.html, styles.css, script.js. No framework, no build step, no npm install. Native APIs first: CSS custom properties, IntersectionObserver, requestAnimationFrame, the Web Animations API. A library only when an effect needs it (GSAP, three.js, hls.js), loaded as an ES module from a CDN.";

// Frameworks the user can ask for; anything else stays vanilla.
const FRAMEWORKS = [
  [/\bnext\.?js\b/i, "Next.js"],
  [/\breact\b/i, "React"],
  [/\bnuxt\b/i, "Nuxt"],
  [/\bvue\.?js\b|\bvue ?3\b/i, "Vue"],
  [/\bsvelte(kit)?\b/i, "Svelte"],
  [/\bastro\b/i, "Astro"],
  [/\bangular\b/i, "Angular"],
  [/\btailwind/i, "Tailwind CSS"],
  [/\bvite\b/i, "Vite"]
];

/** Stack for the prompt: the frameworks the user names, otherwise vanilla. */
export function detectStack(description) {
  const text = String(description || "");
  const named = FRAMEWORKS.filter(([re]) => re.test(text)).map(([, name]) => name);
  if (!named.length) return { vanilla: true, named, text: VANILLA_STACK };
  return { vanilla: false, named, text: `${named.join(" + ")} (named by the user). Add no other framework; libraries only when an effect needs them.` };
}

/** Blocks every PROMPT_PRO must contain, in order. */
export const PROMPT_ANATOMY = [
  ["Mission line", "One sentence: what to build, for whom, the aesthetic in 3-5 concrete adjectives, the number of sections, and the exact build stack (default: plain HTML + CSS + vanilla JavaScript in index.html / styles.css / script.js, no build step; a framework only when the user names one)."],
  ["Fonts", "Exact families, weights, how to load them (Google Fonts <link> in index.html, or @font-face on a font file URL), and the role of each (display, body, mono, accent italic)."],
  ["Color system", "Every color as a CSS variable in :root (hex or HSL), semantic names (background, foreground, primary, muted, border, accent). Values copied from the reference DNA; a framework theme, if the user chose one, only maps these variables."],
  ["Surface & utility CSS", "Complete CSS for any custom utility (glass card, grain overlay, gradient border, text gradient), written out in full so the agent can paste it."],
  ["Global layout rules", "Container width, section vertical padding, grid gaps, radius scale, shadow scale — numbers from the reference. The layer stack back → front with z-index, and the exact DOM order with the ids/classes the script relies on."],
  ["Sections", "Numbered, in page order. For each: purpose, layout (grid/flex, columns, alignment, heights), exact CSS (selectors and values) for key elements, the real copy (headline, sub, CTAs, labels — written for the user's project and language), media (type, source or precise art direction, overlay/fade), interactive states (hover, focus, active), and its animation with numbers."],
  ["Motion system", "Each animation as: trigger (mount / in-view / scroll-scrub / hover), properties from → to, duration, delay, stagger, easing curve, library. Entrances fail safe (content visible if an animation never runs) and every wait on media has a timeout. Plus the prefers-reduced-motion fallback."],
  ["Data & state", "Arrays for repeated content (features, logos, testimonials, pricing tiers, stats) with every field filled; state/logic for carousels, tabs, toggles (locks, timings)."],
  ["Responsive behaviour", "What changes at each breakpoint (stacking order, font sizes via clamp or stepped values, hidden elements, media cropping, nav → menu). Height breakpoints (max-height) when the page is viewport-locked; safe-area insets on phones."],
  ["Accessibility & performance", "Contrast targets, focus-visible rings, aria labels for icon buttons, alt text, semantic landmarks, lazy media, video poster + preload policy, font-display swap, no layout shift."],
  ["Dependencies", "Exact CDN URLs or packages to load; none for a vanilla build whose effects need no library."],
  ["Key patterns", "The 4-8 rules that keep every section consistent (badge style, heading style, button styles, card style, fade heights, spacing rhythm)."],
  ["Definition of done", "Checkable acceptance criteria: what is visible where at a stated viewport (e.g. 1440×900, with x/y positions) and in what order over time or scroll; tokens match, sections present in order, Lighthouse a11y ≥ 95, no console errors, animations respect reduced motion, mobile 375px has no horizontal scroll."]
];

/** Reusable motion & surface recipes with production numbers. */
export const MOTION_RECIPES = {
  blurWordReveal:
    "Blur word reveal (headlines): split by word; each word animates filter blur(10px)→blur(0), opacity 0→1, y 40→0, duration 0.6s, stagger 0.08s, ease [0.22,1,0.36,1]; triggered once when 30% in view.",
  fadeUpStagger:
    "Fade-up stagger (cards, list items): opacity 0→1, y 24→0, duration 0.55s, stagger 0.07s, ease [0.16,1,0.3,1]; triggered once by an IntersectionObserver at threshold 0.25 (whileInView in motion/react).",
  heroTimeline:
    "Hero mount timeline: badge (0s) → headline words (0.1s) → subtitle (0.45s) → CTAs (0.65s) → media/visual (0.8s scale 1.04→1, opacity 0→1, 1.2s). Ease power3.out / [0.22,1,0.36,1].",
  marquee:
    "Logo marquee: track contains the list twice; keyframes translateX(0)→translateX(-50%), 30s linear infinite; mask-image linear-gradient(to right, transparent, #000 10%, #000 90%, transparent) on the viewport; pause on hover.",
  videoBackdrop:
    "Video backdrop: <video autoPlay muted loop playsInline preload=\"metadata\" poster=…> absolute inset-0 object-cover; overlay bg-black/40; top and bottom fades (h-48, linear-gradient to background color) so the video melts into the page; fade the video in (opacity 0→1, 1s) on canplay.",
  hlsVideo:
    "HLS stream (.m3u8): use hls.js when Hls.isSupported(), else native video.canPlayType('application/vnd.apple.mpegurl') for Safari; destroy the instance on unmount.",
  glassSurface:
    "Glass surface: background rgba(255,255,255,0.04); backdrop-filter blur(12px) saturate(140%); border 1px solid rgba(255,255,255,0.12); inner highlight box-shadow inset 0 1px 0 rgba(255,255,255,0.12); for a gradient edge use a ::before with padding 1px, a vertical white gradient (0.4 → 0 → 0.4) and mask-composite: exclude.",
  grainOverlay:
    "Grain overlay: fixed inset-0 pointer-events-none z-50, SVG feTurbulence fractalNoise baseFrequency 0.9, numOctaves 4, rendered as a 200px tile at opacity 0.05–0.08, mix-blend-mode overlay.",
  countUp:
    "Stat count-up: animate from 0 to the value over 1.6s easeOut when 50% in view, once; keep the suffix (+, %, x) static; tabular-nums.",
  scrollScrub:
    "Scroll-scrubbed section: GSAP ScrollTrigger (or motion useScroll) with start 'top top', end '+=150%', scrub 1, pin true; map progress to transforms (y, scale, opacity); disable pin under 768px.",
  parallaxLayer:
    "Parallax layer: background moves at 0.5× scroll speed (translateY = scrollY × 0.5 in a requestAnimationFrame loop, ScrollTrigger scrub, or useScroll/useTransform in React), foreground at 1×; clamp to the section bounds.",
  stickyStory:
    "Sticky storytelling: left column sticky top-24 holds the visual that cross-fades (opacity 0.4s) as each right-column step enters the viewport center.",
  magneticButton:
    "Magnetic CTA: on pointermove translate the button by 0.25 × the cursor offset from its center (max 10px), spring back on leave (stiffness 300, damping 20).",
  cursorSpotlight:
    "Cursor spotlight: radial-gradient(600px circle at var(--x) var(--y), rgba(255,255,255,0.08), transparent 40%) on the section, CSS vars updated on pointermove (rAF-throttled).",
  textSheen:
    "Gradient text sheen: bg-clip-text text-transparent with a 200% wide linear gradient, background-position animated 0%→200% over 6s linear infinite.",
  carousel:
    "Carousel: index state + isAnimating lock released after the transition duration (e.g. 650ms cubic-bezier(0.4,0,0.2,1)); keyboard arrows; swipe on touch; preload next images.",
  pageLoader:
    "Intro loader: full-screen overlay with a counter 0→100 over 1.4s, then the overlay slides up (y 0→-100%, 0.8s, [0.76,0,0.24,1]) and hands off to the hero timeline.",
  three:
    "3D scene: three.js renderer (pixel ratio min(devicePixelRatio, 2), antialias; @react-three/fiber Canvas dpr [1,2] in React), loading fallback, lazy-load below the fold, OrbitControls disabled on touch, or a Spline scene via <spline-viewer url=…>; pause rendering when off-screen.",
  liquidGlass:
    "Liquid glass (nav pills, buttons, prompt cards): background rgba(255,255,255,0.06); backdrop-filter blur(4px) saturate(160%); a 1px gradient rim drawn with a padded pseudo-element and mask-composite: exclude (white 45% at top-left → transparent at 40% → white 15% at bottom-right); inset 0 1px 1px rgba(255,255,255,0.35) highlight; hover scale 1.03 over 0.7s ease [0.22,1,0.36,1].",
  videoSwitcher:
    "Video switcher (2-4 clips): stacked <video> layers, only the active one at opacity 1; crossfade 0.55s ease-in-out on change; pause and rewind hidden clips; tabs or thumbnails as triggers with aria-pressed; preload=\"metadata\" except the first clip.",
  maskFade:
    "Mask fade: mask-image (and -webkit-mask-image) linear-gradient(to bottom, #000 60%, transparent 100%) dissolves media or a giant headline into the page; for a blurred edge, add a bottom band h-40 with backdrop-filter blur(16px) masked the same way.",
  cursorScrubVideo:
    "Cursor-scrubbed video: video paused, muted, preload=\"auto\"; on pointermove map x (0→1 across the section) to currentTime = x × duration, smoothed by a rAF lerp of 0.1 per frame; seek only once the previous seek has fired 'seeked', keeping the latest target, so seeks never pile up; on touch devices fall back to a muted autoplay loop.",
  scrollScrubVideo:
    "Scroll-scrubbed video: encode the clip all-intra (ffmpeg -g 1) so every seek is instant; pin a 300-500vh section and map its progress to currentTime with a rAF lerp of 0.1; first frame as poster; under 768px play it as a muted loop instead.",
  unitScaling:
    "Reference-unit scaling (viewport-locked heroes): design on the reference artboard (e.g. 1440×900), set --u: min(100vw / 1440, 100vh / 900), then declare it again with 100svh so browsers that know small-viewport units override the first line, and write every size as calc(N * var(--u)) so the composition keeps its exact proportions; return to normal flow under 768px.",
  imageTextMask:
    "Image-filled headline: background-clip: text with a photo or poster frame, color transparent, background-size cover; drift background-position 0%→100% over 12s linear infinite; keep a solid fallback color that passes 4.5:1 contrast.",
  typewriter:
    "Typewriter: reveal one character every 40ms, caret 2px wide blinking every 0.5s (steps(1)); when cycling words, hold 1.5s then delete at 25ms per character; aria-label holds the full sentence so screen readers skip the animation.",
  scrollStage:
    "Sticky scroll stage (vanilla, layered cut-out images): the section is 100vh plus a scroll budget of 3000-4000px and holds a sticky 100vh stage of absolutely positioned layers. Each frame, read how far the section has scrolled, ease toward it with a lerp of 0.14 (snap when the gap is under 0.08px), and turn overlapping scroll windows into 0→1 enter/exit values with smoothstep (a chapter enters over ~340px and leaves over ~320px). Write those values to CSS custom properties that drive each layer's translate/scale, a background blur up to 14px with ~25% darkening, and a tinted gradient veil. Pointer depth: pointer offset −0.5…0.5 eased with a lerp of 0.12, multiplied per layer (far −12px, near +22px). Under reduced motion, skip both lerps and write the values directly.",
  loopCarousel:
    "Looping card carousel: render the card list three times and start on the first card of the middle copy; move the track by −(card width + gap) × index with a 640ms cubic-bezier(0.22,1,0.36,1) transform. On transitionend, if the index has left the middle copy, shift it back by one copy length with the transition disabled for two animation frames, so the loop never shows a seam. Cards are role=button with tabindex 0 and answer Enter/Space; prev/next buttons carry aria-labels.",
  failSafeEntrance:
    "Fail-safe entrance: CSS keyframe entrances with animation-fill-mode both (the from-state holds during the delay) on elements whose resting opacity is 1; each element gets a settled class on its own animationend (once: true); after two requestAnimationFrames, if getAnimations() reports nothing running, add the settled class everywhere so the page is never left blank. Every wait on media (canplaythrough, autoplay, preloader) races a timeout backstop of 1.5-9s and has an error path.",
  glassWordmark:
    "Glass wordmark (giant brand name at the page foot): one line of display type at ~27% of the canvas height (≈390 units on a 1440-wide canvas, line-height 0.74, tracking −0.045em) filled with a vertical white-to-lavender gradient through background-clip: text and a transparent text fill, lifted by two drop-shadow filters (1-unit white rim on top, 18-unit soft glow); no -webkit-text-stroke, because overlapping letters would show the stroke inside the overlaps. It sinks into a 17%-tall fog gradient at the bottom edge.",
  portalWindow:
    "Portal window (canvas): a full-screen fixed canvas clips a rounded rectangle (radius 90px) and draws the media inside it in cover mode, locked to the screen: the outline slides across a picture that stays put. The shape tilts toward the pointer (up to ~19° and 16.5°, eased per frame by dt × 0.009) through a fake perspective (focal 850) applied to ~44 points sampled along the rounded outline. A transition grows it from its DOM slot to the full viewport over 1.1s (easeInOutCubic) while radius and tilt relax to 0; the source <video>/<img> stay invisible and only feed pixels. Device pixel ratio capped at 2.",
  sphereGallery:
    "Sphere gallery: N cards spread on a Fibonacci sphere (golden angle π(3 − √5)) inside a preserve-3d world that is a 0×0 point at the viewport centre; each card is translate3d(x·R, −y·R, z·R) then rotateY(lon) rotateX(lat). R = max(floor, min(480px, 0.46 × viewport height, 0.58 × viewport width)), cards ~0.47 R wide, perspective 1150px on desktop down to 620px on small phones. The headline sits on the same 0×0 point, centred with a negative margin of half its width (never a percentage, never a CSS transform the script overwrites). Drag rotates the world; depth is a black wash per card, not a CSS filter.",
  reducedMotion:
    "Reduced motion: under prefers-reduced-motion: reduce, replace transforms/blur by a 0.2s opacity fade, stop marquees and video autoplay (show poster), disable parallax and scrub."
};

/** Project archetypes: matched from the user's description. */
export const ARCHETYPES = [
  {
    id: "saas",
    label: "SaaS / B2B product",
    match: /saas|logiciel|software|dashboard|platform|plateforme|b2b|crm|analytics|workflow|api|startup|outil|tool|automation|automatisation/i,
    sections: ["navbar (logo, 4-5 links, sign-in + primary CTA)", "hero (badge, benefit headline, sub, 2 CTAs, product visual/video)", "logo marquee (trusted by)", "feature grid or bento (6 features with icons)", "product deep-dive (alternating rows / sticky story)", "metrics band (count-up stats)", "testimonials", "pricing (3 tiers, monthly/yearly toggle, highlighted plan)", "FAQ accordion", "final CTA band", "footer (columns, newsletter, socials, legal)"],
    motion: ["heroTimeline", "blurWordReveal", "failSafeEntrance", "marquee", "fadeUpStagger", "countUp", "stickyStory", "glassWordmark"],
    copy: "Benefit-first headlines (outcome + time frame), proof numbers, low-friction CTAs (Start free / Book a demo)."
  },
  {
    id: "ai",
    label: "AI product / agent",
    match: /\bia\b|\bai\b|intelligence artificielle|artificial intelligence|agent|llm|gpt|machine learning|neural|chatbot|copilot|génératif|generative/i,
    sections: ["navbar", "hero (prompt-style input or animated product demo, glowing accent)", "logo marquee", "how it works (3 steps)", "capabilities bento", "live demo / before-after", "use cases by persona", "security & privacy band", "pricing", "final CTA", "footer"],
    motion: ["heroTimeline", "blurWordReveal", "failSafeEntrance", "cursorSpotlight", "textSheen", "fadeUpStagger", "marquee"],
    copy: "Concrete tasks the AI does, time saved, trust (privacy, accuracy)."
  },
  {
    id: "agency",
    label: "Agency / studio",
    match: /agence|agency|studio|créatif|creative|design studio|branding|marketing agency|production|collectif/i,
    sections: ["navbar (logo, menu, contact pill)", "hero (oversized display type, showreel video)", "client logos", "selected work (large case-study cards with hover video)", "services list (numbered, hover reveal)", "process (4 steps)", "stats", "testimonials", "team or culture", "contact CTA (big email link)", "footer"],
    motion: ["pageLoader", "heroTimeline", "videoBackdrop", "parallaxLayer", "magneticButton", "fadeUpStagger", "glassWordmark"],
    copy: "Confident, short, editorial; outcomes for named clients."
  },
  {
    id: "portfolio",
    label: "Personal portfolio",
    match: /portfolio|freelance|personal site|site perso|cv|résumé|resume|photographe|photographer|designer|développeur|developer|artiste|artist/i,
    sections: ["minimal navbar (name, 3 links, availability dot)", "hero (name in display type, role, location, one-line pitch)", "selected projects (grid or list with hover previews)", "about (portrait, short bio, skills)", "experience timeline", "testimonials (optional)", "contact (email, socials)", "footer"],
    motion: ["heroTimeline", "blurWordReveal", "sphereGallery", "cursorSpotlight", "fadeUpStagger", "magneticButton"],
    copy: "First person, specific achievements, clear availability."
  },
  {
    id: "ecommerce",
    label: "E-commerce / product brand",
    match: /e-?commerce|boutique|shop|store|produit|product|vente|sell|collection|mode|fashion|cosmétique|cosmetic|bijou|jewel|sneaker|marque/i,
    sections: ["announcement bar", "navbar (logo, categories, search, cart)", "hero (product imagery, offer, shop CTA)", "category tiles", "best sellers carousel", "brand story split", "reviews with ratings", "UGC / Instagram grid", "guarantees (shipping, returns, payment)", "newsletter", "footer"],
    motion: ["heroTimeline", "carousel", "fadeUpStagger", "parallaxLayer"],
    copy: "Sensory product language, price clarity, urgency without pressure, reassurance."
  },
  {
    id: "restaurant",
    label: "Restaurant / food / local business",
    match: /restaurant|food|burger|pizza|café|coffee|bar|bistro|traiteur|food.?truck|boulangerie|bakery|chef|cuisine|menu|réservation|salon|coiffure|spa|hôtel|hotel|gym|fitness|clinique|cabinet/i,
    sections: ["navbar (logo, menu, book/order CTA)", "hero (appetizing full-bleed photo/video, tagline, reserve + order)", "signature items carousel", "full menu (tabs by category, prices)", "story / chef / values", "gallery", "reviews (Google rating)", "events / private hire", "location, hours & map", "reservation form", "footer"],
    motion: ["videoBackdrop", "heroTimeline", "fadeUpStagger", "carousel", "parallaxLayer"],
    copy: "Warm, local, sensory; hours, address and booking always one tap away."
  },
  {
    id: "fintech",
    label: "Fintech / crypto / web3",
    match: /fintech|finance|banque|bank|paiement|payment|crypto|web3|blockchain|nft|defi|trading|invest|wallet|token|assurance|insurance/i,
    sections: ["navbar", "hero (headline, live-looking chart or card visual, CTAs, trust badges)", "partner/exchange logos", "key metrics (volume, users, uptime)", "features bento", "security section (audits, compliance)", "how it works", "app showcase (phone mockups)", "FAQ", "CTA", "footer with legal disclaimers"],
    motion: ["heroTimeline", "countUp", "textSheen", "fadeUpStagger", "three"],
    copy: "Precise, trustworthy, regulatory-safe claims; numbers with sources."
  },
  {
    id: "immersive",
    label: "Immersive / 3D / launch",
    match: /3d|three|webgl|immersi|spline|launch|lancement|waitlist|liste d'attente|teaser|coming soon|futur|space|espace|automobile|car|voiture|gaming|jeu/i,
    sections: ["minimal navbar", "full-viewport 3D or video hero with huge display type", "scroll-driven story chapters (pinned)", "specs / features grid", "gallery", "waitlist or pre-order CTA with counter", "footer"],
    motion: ["pageLoader", "portalWindow", "three", "scrollScrub", "scrollStage", "parallaxLayer", "grainOverlay", "blurWordReveal"],
    copy: "Cinematic, few words per screen, strong verbs."
  },
  {
    id: "education",
    label: "Education / course / community",
    match: /formation|course|cours|école|school|academy|académie|learn|apprendre|coaching|bootcamp|communauté|community|webinar|ebook/i,
    sections: ["navbar", "hero (transformation promise, instructor/visual, enroll CTA)", "social proof (students, ratings)", "curriculum accordion", "instructor bio", "outcomes / projects", "testimonials with results", "pricing / plans", "guarantee", "FAQ", "final CTA", "footer"],
    motion: ["heroTimeline", "fadeUpStagger", "countUp", "carousel"],
    copy: "Transformation, concrete outcomes, objection handling."
  },
  {
    id: "health",
    label: "Health / biotech / wellbeing",
    match: /santé|health|médical|medical|biotech|pharma|wellness|bien-être|thérapie|therapy|clinic|nutrition|mental/i,
    sections: ["navbar", "calm hero (human imagery, reassurance, primary CTA)", "trust badges (certifications)", "services/treatments cards", "how it works", "results / research", "practitioners", "testimonials", "FAQ", "booking CTA", "footer"],
    motion: ["heroTimeline", "fadeUpStagger", "parallaxLayer"],
    copy: "Empathetic, clear, compliant; no exaggerated claims."
  },
  {
    id: "notFound",
    label: "404 / error / maintenance page",
    match: /\b404\b|page introuvable|page not found|page d'erreur|error page|maintenance/i,
    sections: ["viewport-locked single screen (100vh, no scroll)", "giant 404 numerals or illustration as the hero", "one-line explanation in the brand voice", "primary CTA back home + secondary search or support link", "minimal footer or none"],
    motion: ["videoBackdrop", "liquidGlass", "unitScaling", "fadeUpStagger"],
    copy: "One honest sentence about what happened, then a clear way back; humour only if the brand allows it."
  },
  {
    id: "auth",
    label: "Sign-in / sign-up / onboarding",
    match: /connexion|\blogin\b|log in|sign.?in|sign.?up|inscription|authentification|mot de passe|password|onboarding|créer un compte|create an account/i,
    sections: ["split screen: media half (video or image) + form half", "logo and one-line value reminder", "form (labels above inputs, show-password toggle, inline validation, primary button full width)", "social sign-in buttons", "switch link (sign in ↔ sign up) and legal note"],
    motion: ["videoBackdrop", "heroTimeline", "fadeUpStagger"],
    copy: "Short labels, explicit error messages, no marketing inside the form."
  },
  {
    id: "editorial",
    label: "Editorial / magazine / storytelling",
    match: /magazine|éditorial|editorial|\bblog\b|journal|revue|newsletter|publication|presse|storytelling|récit|documentaire|documentary|archive/i,
    sections: ["masthead navbar", "cover hero (headline set in display serif, standfirst, byline)", "scroll-driven chapters (pinned media, scrubbed video)", "pull quotes and large figures", "related stories grid", "newsletter sign-up", "footer"],
    motion: ["scrollScrubVideo", "imageTextMask", "stickyStory", "blurWordReveal", "fadeUpStagger"],
    copy: "Narrative, precise, sourced; one idea per screen."
  },
  {
    id: "travel",
    label: "Travel / hospitality / destination",
    match: /voyage|travel|tourisme|tourism|séjour|trip|destination|vacances|holiday|excursion|circuit|itinéraire|itinerary|\bville\b|\bcity\b/i,
    sections: ["transparent navbar over media", "full-viewport destination video hero with a search or prompt card (glass)", "featured destinations cards", "itinerary / how it works", "testimonials with photos", "booking CTA band", "footer"],
    motion: ["videoBackdrop", "scrollStage", "loopCarousel", "liquidGlass", "videoSwitcher", "fadeUpStagger", "parallaxLayer"],
    copy: "Sensory and concrete: places, durations, what is included, how to book."
  },
  {
    id: "industrial",
    label: "Industry / logistics / energy / environment",
    match: /industrie|industrial|manufactur|usine|factory|logistique|logistics|fret|freight|supply.?chain|énergie|energy|environnement|environmental|ong|nonprofit|conservation|agri|construction|btp/i,
    sections: ["navbar", "hero with aerial or process video and one strong claim", "key figures band (capacity, sites, certifications)", "product or service specs (cards linked to video scenes)", "process / supply chain steps", "sustainability or impact section", "contact / quote CTA", "footer"],
    motion: ["videoBackdrop", "scrollScrubVideo", "countUp", "fadeUpStagger", "unitScaling"],
    copy: "Factual and measurable: specs, standards, volumes, lead times."
  }
];

/** What separates a great PROMPT_PRO from an average one. */
export const QUALITY_BAR = [
  "Zero vague words: no 'modern', 'nice', 'clean' without the numbers that make it so.",
  "Every visible string is written out (headlines, subs, CTAs, nav, footer, stats, testimonials) in the user's language, specific to the project.",
  "Every element that matters has its CSS values (or the classes of the framework the user chose); every animation has trigger, from→to, duration, delay/stagger and easing.",
  "The build stack is named exactly; no framework, build step or package the project does not need.",
  "Scope is locked: the document says what must NOT be added or changed (extra sections, libraries, fonts, class names) and never invents an asset URL — unknown media gets an art-direction brief instead.",
  "Every trap is named with its reason: when an obvious shortcut would break the result, write 'do not … because …'.",
  "Nothing can stay blank or stuck: entrances fail safe, every wait on media or autoplay has a timeout and an error path.",
  "No instruction contradicts another (e.g. 'no video' next to a video URL); every asset appears once, with its role.",
  "Design tokens come from the reference DNA verbatim; new needs are composed from existing tokens.",
  "Media: exact source when known, otherwise a precise art-direction brief (subject, framing, lighting, palette, aspect ratio) and a stock search query.",
  "Mobile is specified, not implied.",
  "Accessibility and reduced motion are first-class, not an afterthought.",
  "Ends with dependencies, key patterns and a checkable definition of done."
];

/** Rough language guess for the copy language. */
export function detectLanguage(text) {
  const t = ` ${String(text || "").toLowerCase()} `;
  const fr = (t.match(/ (le|la|les|des|une|pour|avec|mon|notre|nos|est|sur|dans|qui|du|et) /g) || []).length;
  const en = (t.match(/ (the|and|for|with|my|our|is|on|in|who|of|to) /g) || []).length;
  return fr > en ? "French" : "English";
}

export function detectArchetypes(description, limit = 2) {
  const scored = ARCHETYPES.map((archetype) => ({
    archetype,
    score: (String(description || "").match(new RegExp(archetype.match.source, "gi")) || []).length
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return (scored.length ? scored : [{ archetype: ARCHETYPES[0], score: 0 }]).slice(0, limit).map((entry) => entry.archetype);
}

/** Motion recipes to use: reference motion first, then the archetype's. */
export function selectMotionRecipes(normalized, archetypes) {
  // The section plan always references these three.
  const keys = new Set(["heroTimeline", "blurWordReveal", "fadeUpStagger"]);
  const libs = (normalized?.animationLibs || []).map((lib) => lib.name).join(" ");
  if ((normalized?.scrollTriggers || []).length) keys.add("scrollScrub");
  if ((normalized?.parallax?.measured || []).length) keys.add("parallaxLayer");
  if (/three|spline|babylon|webgl/i.test(libs) || normalized?.webgl?.webglCount > 0) keys.add("three");
  for (const archetype of archetypes) for (const key of archetype.motion) keys.add(key);
  keys.delete("reducedMotion");
  // Reduced motion is mandatory: it always closes the list.
  return [...Array.from(keys).filter((key) => MOTION_RECIPES[key]).slice(0, 10), "reducedMotion"];
}

/** Markdown brief handed to the model (and used by the local engine). */
export function buildPlaybookBrief({ description, normalized }) {
  const archetypes = detectArchetypes(description);
  const language = detectLanguage(description);
  const recipes = selectMotionRecipes(normalized, archetypes);
  const stack = detectStack(description);
  const lines = [
    `PROJECT TYPE: ${archetypes.map((a) => a.label).join(" + ")}`,
    `COPY LANGUAGE: ${language}`,
    `BUILD STACK: ${stack.text}`,
    `RECOMMENDED SECTION MAP (adapt to the user's explicit wishes first, then to the reference rhythm): ${archetypes[0].sections.join(" → ")}`,
    `COPY VOICE: ${archetypes.map((a) => a.copy).join(" ")}`,
    "MOTION RECIPES (use these exact numbers unless the reference measured different ones):",
    ...recipes.map((key) => `- ${MOTION_RECIPES[key]}`),
    "REQUIRED DOCUMENT ANATOMY:",
    ...PROMPT_ANATOMY.map(([title, rule], index) => `${index + 1}. ${title} — ${rule}`),
    "QUALITY BAR:",
    ...QUALITY_BAR.map((rule) => `- ${rule}`)
  ];
  return { text: lines.join("\n"), archetypes, language, recipes, stack };
}
