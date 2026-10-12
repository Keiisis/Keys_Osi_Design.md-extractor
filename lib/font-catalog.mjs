/**
 * Keys_Osi font catalog: a curated set of free (OFL) families served by the
 * Fontsource API/CDN, a live catalog search, and woff2 file resolution so a
 * brand kit can ship self-hosted fonts.
 *
 * Verified live (2026-10-07):
 *  - GET https://api.fontsource.org/v1/fonts?category=serif&subsets=latin-ext
 *    -> array of { id, family, subsets, weights, styles, defSubset, variable,
 *       lastModified, category, license, type } (https://fontsource.org/docs/api/fonts)
 *  - GET https://api.fontsource.org/v1/fonts/{id} -> same + unicodeRange and
 *    variants[weight][style][subset].url.{woff2,woff,ttf}
 *    (https://fontsource.org/docs/api/font-id), files on
 *    https://cdn.jsdelivr.net/fontsource/fonts/{id}@latest/{subset}-{weight}-{style}.woff2
 *  - GET https://api.fontsource.org/v1/variable/{id} -> { family, axes }
 *    (https://fontsource.org/docs/api/variable)
 *  - Google Fonts css2 (https://developers.google.com/fonts/docs/css2):
 *    /css2?family=Name:ital,wght@0,400;1,700&display=swap. Without a modern
 *    User-Agent it answers truetype; with a Chrome UA it answers woff2 split
 *    per subset behind "latin" / "latin-ext" comments.
 *
 * Every catalog id below was checked against the live listing; weights,
 * styles, variable and subsets are copied from it. Tags (0..1) are Keys_Osi
 * editorial judgments used for personality matching.
 */

const FONTSOURCE_API = "https://api.fontsource.org/v1";
const GOOGLE_CSS2 = "https://fonts.googleapis.com/css2";
// Google serves woff2 only to browsers it recognizes.
const MODERN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const TAG_KEYS = ["geometric", "humanist", "elegant", "tech", "playful", "bold", "luxury", "friendly"];

export const CURATED_FONTS = [
  { id: "inter", family: "Inter", category: "sans-serif", roles: ["body", "display"], tags: { geometric: 0.5, humanist: 0.4, elegant: 0.3, tech: 0.8, playful: 0.1, bold: 0.4, luxury: 0.2, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "manrope", family: "Manrope", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.7, humanist: 0.3, elegant: 0.4, tech: 0.8, playful: 0.2, bold: 0.4, luxury: 0.3, friendly: 0.5 }, weights: [200, 300, 400, 500, 600, 700, 800], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "dm-sans", family: "DM Sans", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.8, humanist: 0.3, elegant: 0.4, tech: 0.6, playful: 0.3, bold: 0.4, luxury: 0.3, friendly: 0.6 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "space-grotesk", family: "Space Grotesk", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.6, humanist: 0.2, elegant: 0.3, tech: 0.9, playful: 0.4, bold: 0.5, luxury: 0.2, friendly: 0.4 }, weights: [300, 400, 500, 600, 700], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "plus-jakarta-sans", family: "Plus Jakarta Sans", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.7, humanist: 0.4, elegant: 0.5, tech: 0.6, playful: 0.3, bold: 0.4, luxury: 0.4, friendly: 0.7 }, weights: [200, 300, 400, 500, 600, 700, 800], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "outfit", family: "Outfit", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.9, humanist: 0.2, elegant: 0.4, tech: 0.6, playful: 0.4, bold: 0.5, luxury: 0.3, friendly: 0.7 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "sora", family: "Sora", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.8, humanist: 0.2, elegant: 0.4, tech: 0.8, playful: 0.3, bold: 0.5, luxury: 0.3, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700, 800], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "figtree", family: "Figtree", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.7, humanist: 0.4, elegant: 0.3, tech: 0.5, playful: 0.4, bold: 0.4, luxury: 0.2, friendly: 0.8 }, weights: [300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "onest", family: "Onest", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.5, humanist: 0.5, elegant: 0.4, tech: 0.7, playful: 0.2, bold: 0.4, luxury: 0.3, friendly: 0.6 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "hanken-grotesk", family: "Hanken Grotesk", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.5, humanist: 0.5, elegant: 0.5, tech: 0.6, playful: 0.2, bold: 0.4, luxury: 0.4, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "work-sans", family: "Work Sans", category: "sans-serif", roles: ["body", "display"], tags: { geometric: 0.4, humanist: 0.6, elegant: 0.3, tech: 0.5, playful: 0.3, bold: 0.4, luxury: 0.2, friendly: 0.6 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "public-sans", family: "Public Sans", category: "sans-serif", roles: ["body"], tags: { geometric: 0.5, humanist: 0.5, elegant: 0.2, tech: 0.6, playful: 0.1, bold: 0.3, luxury: 0.1, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "ibm-plex-sans", family: "IBM Plex Sans", category: "sans-serif", roles: ["body", "display"], tags: { geometric: 0.3, humanist: 0.5, elegant: 0.4, tech: 0.8, playful: 0.1, bold: 0.3, luxury: 0.3, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "source-sans-3", family: "Source Sans 3", category: "sans-serif", roles: ["body"], tags: { geometric: 0.2, humanist: 0.8, elegant: 0.4, tech: 0.4, playful: 0.1, bold: 0.3, luxury: 0.2, friendly: 0.6 }, weights: [200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "nunito", family: "Nunito", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.6, humanist: 0.4, elegant: 0.2, tech: 0.2, playful: 0.8, bold: 0.4, luxury: 0.1, friendly: 0.9 }, weights: [200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "nunito-sans", family: "Nunito Sans", category: "sans-serif", roles: ["body"], tags: { geometric: 0.5, humanist: 0.5, elegant: 0.3, tech: 0.4, playful: 0.4, bold: 0.3, luxury: 0.2, friendly: 0.8 }, weights: [200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "poppins", family: "Poppins", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.9, humanist: 0.1, elegant: 0.3, tech: 0.5, playful: 0.5, bold: 0.6, luxury: 0.2, friendly: 0.7 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext"] },
  { id: "montserrat", family: "Montserrat", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.8, humanist: 0.2, elegant: 0.5, tech: 0.4, playful: 0.3, bold: 0.7, luxury: 0.4, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "raleway", family: "Raleway", category: "sans-serif", roles: ["display"], tags: { geometric: 0.6, humanist: 0.3, elegant: 0.8, tech: 0.3, playful: 0.2, bold: 0.3, luxury: 0.7, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "rubik", family: "Rubik", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.6, humanist: 0.3, elegant: 0.1, tech: 0.4, playful: 0.7, bold: 0.6, luxury: 0.1, friendly: 0.8 }, weights: [300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "karla", family: "Karla", category: "sans-serif", roles: ["body"], tags: { geometric: 0.4, humanist: 0.5, elegant: 0.3, tech: 0.5, playful: 0.4, bold: 0.3, luxury: 0.2, friendly: 0.6 }, weights: [200, 300, 400, 500, 600, 700, 800], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "lexend", family: "Lexend", category: "sans-serif", roles: ["body", "display"], tags: { geometric: 0.7, humanist: 0.4, elegant: 0.2, tech: 0.5, playful: 0.3, bold: 0.4, luxury: 0.1, friendly: 0.8 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "urbanist", family: "Urbanist", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.9, humanist: 0.2, elegant: 0.6, tech: 0.6, playful: 0.2, bold: 0.4, luxury: 0.5, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "red-hat-display", family: "Red Hat Display", category: "sans-serif", roles: ["display"], tags: { geometric: 0.6, humanist: 0.4, elegant: 0.4, tech: 0.6, playful: 0.3, bold: 0.6, luxury: 0.3, friendly: 0.6 }, weights: [300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "red-hat-text", family: "Red Hat Text", category: "sans-serif", roles: ["body"], tags: { geometric: 0.5, humanist: 0.5, elegant: 0.3, tech: 0.5, playful: 0.2, bold: 0.3, luxury: 0.2, friendly: 0.6 }, weights: [300, 400, 500, 600, 700], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "archivo", family: "Archivo", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.4, humanist: 0.4, elegant: 0.3, tech: 0.6, playful: 0.2, bold: 0.8, luxury: 0.2, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "schibsted-grotesk", family: "Schibsted Grotesk", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.4, humanist: 0.5, elegant: 0.5, tech: 0.5, playful: 0.2, bold: 0.6, luxury: 0.4, friendly: 0.5 }, weights: [400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "bricolage-grotesque", family: "Bricolage Grotesque", category: "sans-serif", roles: ["display"], tags: { geometric: 0.3, humanist: 0.6, elegant: 0.5, tech: 0.3, playful: 0.7, bold: 0.7, luxury: 0.4, friendly: 0.6 }, weights: [200, 300, 400, 500, 600, 700, 800], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "instrument-sans", family: "Instrument Sans", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.5, humanist: 0.5, elegant: 0.6, tech: 0.6, playful: 0.2, bold: 0.4, luxury: 0.5, friendly: 0.5 }, weights: [400, 500, 600, 700], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "geist", family: "Geist", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.6, humanist: 0.3, elegant: 0.5, tech: 0.9, playful: 0.1, bold: 0.4, luxury: 0.4, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "albert-sans", family: "Albert Sans", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.7, humanist: 0.4, elegant: 0.5, tech: 0.5, playful: 0.3, bold: 0.4, luxury: 0.4, friendly: 0.6 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "be-vietnam-pro", family: "Be Vietnam Pro", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.7, humanist: 0.4, elegant: 0.4, tech: 0.6, playful: 0.3, bold: 0.5, luxury: 0.3, friendly: 0.6 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "atkinson-hyperlegible", family: "Atkinson Hyperlegible", category: "sans-serif", roles: ["body"], tags: { geometric: 0.3, humanist: 0.7, elegant: 0.1, tech: 0.4, playful: 0.2, bold: 0.4, luxury: 0, friendly: 0.7 }, weights: [400, 700], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext"] },
  { id: "quicksand", family: "Quicksand", category: "sans-serif", roles: ["display"], tags: { geometric: 0.8, humanist: 0.2, elegant: 0.4, tech: 0.2, playful: 0.8, bold: 0.1, luxury: 0.2, friendly: 0.9 }, weights: [300, 400, 500, 600, 700], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "fredoka", family: "Fredoka", category: "sans-serif", roles: ["display"], tags: { geometric: 0.7, humanist: 0.2, elegant: 0.1, tech: 0.1, playful: 0.95, bold: 0.7, luxury: 0, friendly: 0.95 }, weights: [300, 400, 500, 600, 700], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "lato", family: "Lato", category: "sans-serif", roles: ["body", "display"], tags: { geometric: 0.4, humanist: 0.7, elegant: 0.5, tech: 0.3, playful: 0.2, bold: 0.4, luxury: 0.4, friendly: 0.7 }, weights: [100, 300, 400, 700, 900], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext"] },
  { id: "open-sans", family: "Open Sans", category: "sans-serif", roles: ["body"], tags: { geometric: 0.3, humanist: 0.8, elegant: 0.3, tech: 0.4, playful: 0.2, bold: 0.3, luxury: 0.2, friendly: 0.7 }, weights: [300, 400, 500, 600, 700, 800], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "barlow", family: "Barlow", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.5, humanist: 0.3, elegant: 0.3, tech: 0.7, playful: 0.2, bold: 0.6, luxury: 0.2, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "josefin-sans", family: "Josefin Sans", category: "sans-serif", roles: ["display"], tags: { geometric: 0.9, humanist: 0.1, elegant: 0.8, tech: 0.3, playful: 0.3, bold: 0.2, luxury: 0.7, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "syne", family: "Syne", category: "sans-serif", roles: ["display"], tags: { geometric: 0.4, humanist: 0.2, elegant: 0.6, tech: 0.6, playful: 0.6, bold: 0.8, luxury: 0.5, friendly: 0.3 }, weights: [400, 500, 600, 700, 800], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "unbounded", family: "Unbounded", category: "sans-serif", roles: ["display"], tags: { geometric: 0.8, humanist: 0.1, elegant: 0.2, tech: 0.8, playful: 0.6, bold: 0.95, luxury: 0.2, friendly: 0.4 }, weights: [200, 300, 400, 500, 600, 700, 800, 900], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "epilogue", family: "Epilogue", category: "sans-serif", roles: ["display", "body"], tags: { geometric: 0.5, humanist: 0.4, elegant: 0.5, tech: 0.5, playful: 0.3, bold: 0.6, luxury: 0.4, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "oswald", family: "Oswald", category: "sans-serif", roles: ["display"], tags: { geometric: 0.4, humanist: 0.2, elegant: 0.3, tech: 0.5, playful: 0.2, bold: 0.9, luxury: 0.2, friendly: 0.3 }, weights: [200, 300, 400, 500, 600, 700], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "chakra-petch", family: "Chakra Petch", category: "sans-serif", roles: ["display"], tags: { geometric: 0.6, humanist: 0.1, elegant: 0.2, tech: 0.95, playful: 0.4, bold: 0.6, luxury: 0.1, friendly: 0.3 }, weights: [300, 400, 500, 600, 700], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "orbitron", family: "Orbitron", category: "sans-serif", roles: ["display"], tags: { geometric: 0.9, humanist: 0, elegant: 0.3, tech: 0.95, playful: 0.4, bold: 0.7, luxury: 0.3, friendly: 0.2 }, weights: [400, 500, 600, 700, 800, 900], styles: ["normal"], variable: true, subsets: ["latin"] },
  { id: "fraunces", family: "Fraunces", category: "serif", roles: ["display"], tags: { geometric: 0.1, humanist: 0.7, elegant: 0.8, tech: 0.1, playful: 0.6, bold: 0.6, luxury: 0.7, friendly: 0.6 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "playfair-display", family: "Playfair Display", category: "serif", roles: ["display"], tags: { geometric: 0.1, humanist: 0.4, elegant: 0.95, tech: 0.1, playful: 0.2, bold: 0.6, luxury: 0.9, friendly: 0.3 }, weights: [400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "cormorant-garamond", family: "Cormorant Garamond", category: "serif", roles: ["display"], tags: { geometric: 0, humanist: 0.6, elegant: 0.95, tech: 0, playful: 0.1, bold: 0.2, luxury: 0.95, friendly: 0.3 }, weights: [300, 400, 500, 600, 700], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "eb-garamond", family: "EB Garamond", category: "serif", roles: ["display", "body"], tags: { geometric: 0, humanist: 0.8, elegant: 0.85, tech: 0, playful: 0.1, bold: 0.2, luxury: 0.8, friendly: 0.4 }, weights: [400, 500, 600, 700, 800], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "libre-baskerville", family: "Libre Baskerville", category: "serif", roles: ["display", "body"], tags: { geometric: 0.1, humanist: 0.6, elegant: 0.8, tech: 0.1, playful: 0.1, bold: 0.4, luxury: 0.7, friendly: 0.4 }, weights: [400, 500, 600, 700], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "lora", family: "Lora", category: "serif", roles: ["body", "display"], tags: { geometric: 0.1, humanist: 0.8, elegant: 0.7, tech: 0.1, playful: 0.3, bold: 0.4, luxury: 0.5, friendly: 0.7 }, weights: [400, 500, 600, 700], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "merriweather", family: "Merriweather", category: "serif", roles: ["body"], tags: { geometric: 0.1, humanist: 0.7, elegant: 0.5, tech: 0.2, playful: 0.1, bold: 0.6, luxury: 0.4, friendly: 0.6 }, weights: [300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "source-serif-4", family: "Source Serif 4", category: "serif", roles: ["body", "display"], tags: { geometric: 0.1, humanist: 0.8, elegant: 0.7, tech: 0.3, playful: 0.1, bold: 0.4, luxury: 0.5, friendly: 0.5 }, weights: [200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "dm-serif-display", family: "DM Serif Display", category: "serif", roles: ["display"], tags: { geometric: 0.1, humanist: 0.4, elegant: 0.85, tech: 0.1, playful: 0.3, bold: 0.7, luxury: 0.8, friendly: 0.4 }, weights: [400], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext"] },
  { id: "instrument-serif", family: "Instrument Serif", category: "serif", roles: ["display"], tags: { geometric: 0.1, humanist: 0.5, elegant: 0.9, tech: 0.2, playful: 0.2, bold: 0.3, luxury: 0.85, friendly: 0.4 }, weights: [400], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext"] },
  { id: "crimson-pro", family: "Crimson Pro", category: "serif", roles: ["body", "display"], tags: { geometric: 0, humanist: 0.8, elegant: 0.8, tech: 0.1, playful: 0.1, bold: 0.3, luxury: 0.7, friendly: 0.5 }, weights: [200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "newsreader", family: "Newsreader", category: "serif", roles: ["display", "body"], tags: { geometric: 0.1, humanist: 0.7, elegant: 0.8, tech: 0.2, playful: 0.1, bold: 0.4, luxury: 0.6, friendly: 0.5 }, weights: [200, 300, 400, 500, 600, 700, 800], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "literata", family: "Literata", category: "serif", roles: ["body"], tags: { geometric: 0.1, humanist: 0.8, elegant: 0.6, tech: 0.3, playful: 0.1, bold: 0.4, luxury: 0.4, friendly: 0.6 }, weights: [200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "ibm-plex-serif", family: "IBM Plex Serif", category: "serif", roles: ["body", "display"], tags: { geometric: 0.2, humanist: 0.5, elegant: 0.5, tech: 0.6, playful: 0.1, bold: 0.5, luxury: 0.4, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "bodoni-moda", family: "Bodoni Moda", category: "serif", roles: ["display"], tags: { geometric: 0.2, humanist: 0.1, elegant: 0.95, tech: 0.1, playful: 0.1, bold: 0.6, luxury: 0.95, friendly: 0.2 }, weights: [400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "spectral", family: "Spectral", category: "serif", roles: ["body"], tags: { geometric: 0.1, humanist: 0.7, elegant: 0.8, tech: 0.2, playful: 0.1, bold: 0.3, luxury: 0.7, friendly: 0.4 }, weights: [200, 300, 400, 500, 600, 700, 800], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "young-serif", family: "Young Serif", category: "serif", roles: ["display"], tags: { geometric: 0.2, humanist: 0.5, elegant: 0.5, tech: 0.1, playful: 0.6, bold: 0.7, luxury: 0.4, friendly: 0.8 }, weights: [400], styles: ["normal"], variable: false, subsets: ["latin", "latin-ext"] },
  { id: "righteous", family: "Righteous", category: "display", roles: ["display"], tags: { geometric: 0.8, humanist: 0.1, elegant: 0.1, tech: 0.6, playful: 0.8, bold: 0.8, luxury: 0, friendly: 0.7 }, weights: [400], styles: ["normal"], variable: false, subsets: ["latin", "latin-ext"] },
  { id: "baloo-2", family: "Baloo 2", category: "display", roles: ["display"], tags: { geometric: 0.6, humanist: 0.3, elegant: 0.1, tech: 0.1, playful: 0.95, bold: 0.8, luxury: 0, friendly: 0.95 }, weights: [400, 500, 600, 700, 800], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "jetbrains-mono", family: "JetBrains Mono", category: "monospace", roles: ["mono"], tags: { geometric: 0.4, humanist: 0.3, elegant: 0.2, tech: 0.9, playful: 0.2, bold: 0.4, luxury: 0.1, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700, 800], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "ibm-plex-mono", family: "IBM Plex Mono", category: "monospace", roles: ["mono"], tags: { geometric: 0.3, humanist: 0.4, elegant: 0.4, tech: 0.8, playful: 0.1, bold: 0.3, luxury: 0.3, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "fira-code", family: "Fira Code", category: "monospace", roles: ["mono"], tags: { geometric: 0.4, humanist: 0.3, elegant: 0.2, tech: 0.9, playful: 0.2, bold: 0.4, luxury: 0.1, friendly: 0.5 }, weights: [300, 400, 500, 600, 700], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext"] },
  { id: "space-mono", family: "Space Mono", category: "monospace", roles: ["mono"], tags: { geometric: 0.5, humanist: 0.1, elegant: 0.3, tech: 0.8, playful: 0.5, bold: 0.5, luxury: 0.2, friendly: 0.3 }, weights: [400, 700], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "dm-mono", family: "DM Mono", category: "monospace", roles: ["mono"], tags: { geometric: 0.6, humanist: 0.3, elegant: 0.5, tech: 0.6, playful: 0.3, bold: 0.3, luxury: 0.4, friendly: 0.6 }, weights: [300, 400, 500], styles: ["italic", "normal"], variable: false, subsets: ["latin", "latin-ext"] },
  { id: "source-code-pro", family: "Source Code Pro", category: "monospace", roles: ["mono"], tags: { geometric: 0.3, humanist: 0.5, elegant: 0.3, tech: 0.7, playful: 0.1, bold: 0.3, luxury: 0.2, friendly: 0.5 }, weights: [200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "geist-mono", family: "Geist Mono", category: "monospace", roles: ["mono"], tags: { geometric: 0.6, humanist: 0.2, elegant: 0.5, tech: 0.9, playful: 0.1, bold: 0.4, luxury: 0.4, friendly: 0.4 }, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "roboto-mono", family: "Roboto Mono", category: "monospace", roles: ["mono"], tags: { geometric: 0.5, humanist: 0.3, elegant: 0.2, tech: 0.7, playful: 0.1, bold: 0.3, luxury: 0.1, friendly: 0.5 }, weights: [100, 200, 300, 400, 500, 600, 700], styles: ["italic", "normal"], variable: true, subsets: ["latin", "latin-ext", "vietnamese"] },
  { id: "martian-mono", family: "Martian Mono", category: "monospace", roles: ["mono"], tags: { geometric: 0.7, humanist: 0.1, elegant: 0.2, tech: 0.9, playful: 0.4, bold: 0.7, luxury: 0.2, friendly: 0.3 }, weights: [100, 200, 300, 400, 500, 600, 700, 800], styles: ["normal"], variable: true, subsets: ["latin", "latin-ext"] }
].map((font) => Object.freeze({ ...font, curated: true }));

const CURATED_BY_ID = new Map(CURATED_FONTS.map((font) => [font.id, font]));

const slug = (text) => String(text || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Curated entry by id or family name (case-insensitive), or null. */
export function findCatalogFont(nameOrId) {
  return CURATED_BY_ID.get(slug(nameOrId)) || null;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Uncurated fonts get tags from their category, nudged by words in the name.
function inferTags(category, family) {
  const base = {
    "sans-serif": { geometric: 0.5, humanist: 0.4, elegant: 0.3, tech: 0.5, playful: 0.3, bold: 0.4, luxury: 0.2, friendly: 0.5 },
    serif: { geometric: 0.1, humanist: 0.6, elegant: 0.7, tech: 0.1, playful: 0.2, bold: 0.4, luxury: 0.6, friendly: 0.4 },
    display: { geometric: 0.4, humanist: 0.2, elegant: 0.3, tech: 0.3, playful: 0.7, bold: 0.8, luxury: 0.2, friendly: 0.5 },
    handwriting: { geometric: 0, humanist: 0.6, elegant: 0.4, tech: 0, playful: 0.8, bold: 0.2, luxury: 0.3, friendly: 0.8 },
    monospace: { geometric: 0.4, humanist: 0.2, elegant: 0.2, tech: 0.9, playful: 0.2, bold: 0.4, luxury: 0.1, friendly: 0.4 }
  }[category] || { geometric: 0.4, humanist: 0.4, elegant: 0.4, tech: 0.4, playful: 0.4, bold: 0.4, luxury: 0.3, friendly: 0.4 };
  const tags = { ...base };
  const name = String(family || "").toLowerCase();
  const bump = (key, by) => (tags[key] = clamp01(tags[key] + by));
  if (/grotesk|grotesque|neo|tech|digital|pixel/.test(name)) bump("tech", 0.2);
  if (/mono|code/.test(name)) bump("tech", 0.3);
  if (/round|comic|bubble|baloo|fun|candy/.test(name)) {
    bump("playful", 0.3);
    bump("friendly", 0.2);
  }
  if (/display|black|heavy|condensed|slab/.test(name)) bump("bold", 0.2);
  if (/garamond|bodoni|didot|caslon|cormorant|baskerville|playfair/.test(name)) {
    bump("elegant", 0.2);
    bump("luxury", 0.2);
  }
  if (/script|hand|brush/.test(name)) {
    bump("playful", 0.2);
    bump("humanist", 0.2);
  }
  return tags;
}

function inferRoles(category, weights) {
  if (category === "monospace") return ["mono"];
  if ((category === "sans-serif" || category === "serif") && weights.length >= 4) return ["display", "body"];
  return ["display"];
}

function fromApi(row) {
  const weights = (row.weights || []).map(Number).filter(Number.isFinite);
  return {
    id: row.id,
    family: row.family,
    category: row.category,
    roles: inferRoles(row.category, weights),
    tags: inferTags(row.category, row.family),
    weights,
    styles: row.styles || ["normal"],
    variable: Boolean(row.variable),
    subsets: row.subsets || [],
    license: row.license || null,
    curated: false
  };
}

function matches(font, { category, subset, minWeights, query }) {
  if (category && font.category !== category) return false;
  if (subset && !font.subsets.includes(subset)) return false;
  if (font.weights.length < minWeights) return false;
  if (query) {
    const q = String(query).toLowerCase();
    if (!font.family.toLowerCase().includes(q) && !font.id.includes(slug(q))) return false;
  }
  return true;
}

/**
 * Live Fontsource search merged with the curated list (curated first and
 * wins on the same id). Throws when the request fails; without fetchImpl it
 * returns the curated matches only.
 */
export async function searchFontCatalog({ category, subset = "latin", minWeights = 3, query, fetchImpl } = {}) {
  const filters = { category, subset, minWeights, query };
  const curated = CURATED_FONTS.filter((font) => matches(font, filters));
  if (!fetchImpl) return curated;
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (subset) params.set("subsets", subset);
  const qs = params.toString();
  const response = await fetchImpl(`${FONTSOURCE_API}/fonts${qs ? `?${qs}` : ""}`);
  if (!response.ok) throw new Error(`Keys_Osi : catalogue de polices indisponible (HTTP ${response.status})`);
  const rows = await response.json();
  const live = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.id && !CURATED_BY_ID.has(row.id))
    .map(fromApi)
    .filter((font) => matches(font, filters));
  return [...curated, ...live];
}

const titleCase = (id) =>
  String(id)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * woff2 files for a family. Fontsource first; Google Fonts css2 when the
 * Fontsource lookup fails or yields nothing.
 * @returns {Promise<Array<{ id, family, weight, style, subset, url, format: "woff2", unicodeRange, fileName, source }>>}
 */
export async function resolveFontFiles({ id, family, weights = [400], styles = ["normal"], subset = "latin", fetchImpl } = {}) {
  if (!fetchImpl) throw new Error("Keys_Osi : fetchImpl requis pour résoudre les fichiers de police");
  const familyName = family || findCatalogFont(id)?.family || titleCase(id);
  let files = [];
  try {
    files = await fromFontsource({ id, familyName, weights, styles, subset, fetchImpl });
  } catch {
    // Network or JSON failure: the Google fallback below decides.
    files = [];
  }
  if (files.length > 0) return files;
  return fromGoogleCss({ id, familyName, weights, styles, subset, fetchImpl });
}

async function fromFontsource({ id, familyName, weights, styles, subset, fetchImpl }) {
  const response = await fetchImpl(`${FONTSOURCE_API}/fonts/${encodeURIComponent(id)}`);
  if (!response.ok) return [];
  const meta = await response.json();
  const out = [];
  for (const weight of weights) {
    for (const style of styles) {
      const bySubset = meta.variants?.[String(weight)]?.[style];
      if (!bySubset) continue;
      // French fits in "latin"; otherwise take the font's own default subset.
      const used = bySubset[subset] ? subset : meta.defSubset;
      const url = bySubset[used]?.url?.woff2;
      if (!url) continue;
      out.push(
        fileEntry({ id, family: meta.family || familyName, weight, style, subset: used, url, unicodeRange: meta.unicodeRange?.[used], source: "fontsource" })
      );
    }
  }
  return out;
}

function fileEntry({ id, family, weight, style, subset, url, unicodeRange, source }) {
  return {
    id,
    family,
    weight: Number(weight),
    style,
    subset,
    url,
    format: "woff2",
    unicodeRange: unicodeRange || null,
    fileName: `${id}-${weight}-${style}.woff2`,
    source
  };
}

/** css2 URL; the API wants tuples sorted (ital first, then weight). */
export function googleCss2Url(family, weights = [400], styles = ["normal"]) {
  const tuples = [];
  for (const style of styles) for (const weight of weights) tuples.push([style === "italic" ? 1 : 0, Number(weight)]);
  tuples.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const name = String(family).trim().replace(/\s+/g, "+");
  return `${GOOGLE_CSS2}?family=${name}:ital,wght@${tuples.map((t) => t.join(",")).join(";")}&display=swap`;
}

/** Parses css2 output into { subset, style, weight, url, unicodeRange } rows (woff2 only). */
export function parseGoogleCss(css) {
  const rows = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  let match;
  while ((match = re.exec(String(css || "")))) {
    const body = match[2];
    const prop = (name) => body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim();
    const src = body.match(/url\(([^)]+)\)\s*format\(['"]?woff2['"]?\)/);
    if (!src) continue;
    rows.push({
      subset: match[1] || null,
      style: prop("font-style") || "normal",
      weight: Number.parseInt(prop("font-weight") || "400", 10),
      url: src[1].replace(/^['"]|['"]$/g, ""),
      unicodeRange: prop("unicode-range") || null
    });
  }
  return rows;
}

async function fromGoogleCss({ id, familyName, weights, styles, subset, fetchImpl }) {
  const response = await fetchImpl(googleCss2Url(familyName, weights, styles), { headers: { "User-Agent": MODERN_UA } });
  if (!response.ok) throw new Error(`Keys_Osi : police « ${familyName} » introuvable (HTTP ${response.status})`);
  const rows = parseGoogleCss(await response.text());
  const out = [];
  for (const weight of weights) {
    for (const style of styles) {
      const candidates = rows.filter((row) => row.weight === Number(weight) && row.style === style);
      // Unlabelled blocks (single-subset families) count as a match.
      const row =
        candidates.find((r) => r.subset === subset) || candidates.find((r) => r.subset === null) || candidates.find((r) => r.subset === "latin");
      if (row) {
        out.push(fileEntry({ id, family: familyName, weight, style, subset: row.subset || subset, url: row.url, unicodeRange: row.unicodeRange, source: "google" }));
      }
    }
  }
  return out;
}

/** @font-face rules; localDir null keeps the remote CDN URLs. */
export function fontFaceCss(files, { family, localDir = "fonts" } = {}) {
  return (files || [])
    .map((file) => {
      const src = localDir ? `${localDir.replace(/\/$/, "")}/${file.fileName}` : file.url;
      const lines = [
        "@font-face {",
        `  font-family: "${family || file.family}";`,
        `  font-style: ${file.style};`,
        `  font-weight: ${file.weight};`,
        "  font-display: swap;",
        `  src: url("${src}") format("woff2");`
      ];
      if (file.unicodeRange) lines.push(`  unicode-range: ${file.unicodeRange};`);
      lines.push("}");
      return lines.join("\n");
    })
    .join("\n");
}
