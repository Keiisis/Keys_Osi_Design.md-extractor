/**
 * Keys_Osi PROMPT_PRO playbook: how an elite, build-ready website prompt
 * is written, distilled from a study of 109 production landing-page
 * prompts (structure, density, motion vocabulary) plus the gaps that
 * corpus leaves open (accessibility, reduced motion, performance,
 * acceptance criteria). Original wording; no prompt is reproduced.
 *
 * Measured facts from that study (used to calibrate the defaults):
 * median prompt 4.4k chars (p90 9.6k); 78% are Tailwind builds with
 * exact classes; 81% use a video or media backdrop; 60% use lucide icons; 44% a glass
 * surface; 31% staggered reveals; 27% 3D/WebGL; Inter (61%) and
 * Instrument Serif (29%) dominate; reduced-motion handled in 1%.
 */

/** Blocks every PROMPT_PRO must contain, in order. */
export const PROMPT_ANATOMY = [
  ["Mission line", "One sentence: what to build, for whom, the aesthetic in 3-5 concrete adjectives, the number of sections, and the exact stack (e.g. React + Vite + TypeScript + Tailwind CSS + motion/react + lucide-react)."],
  ["Fonts", "Exact families, weights, how to load them (Google Fonts <link> in index.html or @fontsource packages), and the role of each (display, body, mono, accent italic). Tailwind fontFamily keys."],
  ["Color system", "Every color as a CSS variable in :root (HSL triplets for Tailwind/shadcn or hex), semantic names (background, foreground, primary, muted, border, accent), registered in tailwind.config. Values copied from the reference DNA."],
  ["Surface & utility CSS", "Complete CSS for any custom utility (glass card, grain overlay, gradient border, text gradient), written out in full so the agent can paste it."],
  ["Global layout rules", "Container width, section vertical padding, grid gaps, radius scale, shadow scale, z-index layers — numbers from the reference."],
  ["Sections", "Numbered, in page order. For each: purpose, layout (grid/flex, columns, alignment, heights), exact Tailwind classes for key elements, the real copy (headline, sub, CTAs, labels — written for the user's project and language), media (type, source or precise art direction, overlay/fade), interactive states (hover, focus, active), and its animation with numbers."],
  ["Motion system", "Each animation as: trigger (mount / in-view / scroll-scrub / hover), properties from → to, duration, delay, stagger, easing curve, library. Plus the prefers-reduced-motion fallback."],
  ["Data & state", "Arrays for repeated content (features, logos, testimonials, pricing tiers, stats) with every field filled; state/logic for carousels, tabs, toggles (locks, timings)."],
  ["Responsive behaviour", "What changes at each breakpoint (stacking order, font sizes via clamp or md:/lg: steps, hidden elements, media cropping, nav → menu)."],
  ["Accessibility & performance", "Contrast targets, focus-visible rings, aria labels for icon buttons, alt text, semantic landmarks, lazy media, video poster + preload policy, font-display swap, no layout shift."],
  ["Dependencies", "Exact npm packages to install."],
  ["Key patterns", "The 4-8 rules that keep every section consistent (badge style, heading style, button styles, card style, fade heights, spacing rhythm)."],
  ["Definition of done", "Checkable acceptance criteria: tokens match, sections present in order, Lighthouse a11y ≥ 95, no console errors, animations respect reduced motion, mobile 375px has no horizontal scroll."]
];

/** Reusable motion & surface recipes with production numbers. */
export const MOTION_RECIPES = {
  blurWordReveal:
    "Blur word reveal (headlines): split by word; each word animates filter blur(10px)→blur(0), opacity 0→1, y 40→0, duration 0.6s, stagger 0.08s, ease [0.22,1,0.36,1]; triggered once when 30% in view.",
  fadeUpStagger:
    "Fade-up stagger (cards, list items): opacity 0→1, y 24→0, duration 0.55s, stagger 0.07s, ease [0.16,1,0.3,1]; whileInView once, viewport amount 0.25.",
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
    "Parallax layer: background moves at 0.5× scroll speed (translateY = scrollY × 0.5 via useScroll/useTransform or ScrollTrigger scrub), foreground at 1×; clamp to the section bounds.",
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
    "3D scene: @react-three/fiber Canvas (dpr [1,2], gl antialias), suspense fallback, lazy-load below the fold, OrbitControls disabled on touch, or a Spline scene via <spline-viewer url=…>; pause rendering when off-screen.",
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
    motion: ["heroTimeline", "blurWordReveal", "marquee", "fadeUpStagger", "countUp", "stickyStory"],
    copy: "Benefit-first headlines (outcome + time frame), proof numbers, low-friction CTAs (Start free / Book a demo)."
  },
  {
    id: "ai",
    label: "AI product / agent",
    match: /\bia\b|\bai\b|intelligence artificielle|artificial intelligence|agent|llm|gpt|machine learning|neural|chatbot|copilot|génératif|generative/i,
    sections: ["navbar", "hero (prompt-style input or animated product demo, glowing accent)", "logo marquee", "how it works (3 steps)", "capabilities bento", "live demo / before-after", "use cases by persona", "security & privacy band", "pricing", "final CTA", "footer"],
    motion: ["heroTimeline", "blurWordReveal", "cursorSpotlight", "textSheen", "fadeUpStagger", "marquee"],
    copy: "Concrete tasks the AI does, time saved, trust (privacy, accuracy)."
  },
  {
    id: "agency",
    label: "Agency / studio",
    match: /agence|agency|studio|créatif|creative|design studio|branding|marketing agency|production|collectif/i,
    sections: ["navbar (logo, menu, contact pill)", "hero (oversized display type, showreel video)", "client logos", "selected work (large case-study cards with hover video)", "services list (numbered, hover reveal)", "process (4 steps)", "stats", "testimonials", "team or culture", "contact CTA (big email link)", "footer"],
    motion: ["pageLoader", "heroTimeline", "videoBackdrop", "parallaxLayer", "magneticButton", "fadeUpStagger"],
    copy: "Confident, short, editorial; outcomes for named clients."
  },
  {
    id: "portfolio",
    label: "Personal portfolio",
    match: /portfolio|freelance|personal site|site perso|cv|résumé|resume|photographe|photographer|designer|développeur|developer|artiste|artist/i,
    sections: ["minimal navbar (name, 3 links, availability dot)", "hero (name in display type, role, location, one-line pitch)", "selected projects (grid or list with hover previews)", "about (portrait, short bio, skills)", "experience timeline", "testimonials (optional)", "contact (email, socials)", "footer"],
    motion: ["heroTimeline", "blurWordReveal", "cursorSpotlight", "fadeUpStagger", "magneticButton"],
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
    motion: ["pageLoader", "three", "scrollScrub", "parallaxLayer", "grainOverlay", "blurWordReveal"],
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
  }
];

/** What separates a great PROMPT_PRO from an average one. */
export const QUALITY_BAR = [
  "Zero vague words: no 'modern', 'nice', 'clean' without the numbers that make it so.",
  "Every visible string is written out (headlines, subs, CTAs, nav, footer, stats, testimonials) in the user's language, specific to the project.",
  "Every element that matters has its Tailwind classes or CSS values; every animation has trigger, from→to, duration, delay/stagger and easing.",
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
  const lines = [
    `PROJECT TYPE: ${archetypes.map((a) => a.label).join(" + ")}`,
    `COPY LANGUAGE: ${language}`,
    `RECOMMENDED SECTION MAP (adapt to the user's explicit wishes first, then to the reference rhythm): ${archetypes[0].sections.join(" → ")}`,
    `COPY VOICE: ${archetypes.map((a) => a.copy).join(" ")}`,
    "MOTION RECIPES (use these exact numbers unless the reference measured different ones):",
    ...recipes.map((key) => `- ${MOTION_RECIPES[key]}`),
    "REQUIRED DOCUMENT ANATOMY:",
    ...PROMPT_ANATOMY.map(([title, rule], index) => `${index + 1}. ${title} — ${rule}`),
    "QUALITY BAR:",
    ...QUALITY_BAR.map((rule) => `- ${rule}`)
  ];
  return { text: lines.join("\n"), archetypes, language, recipes };
}
