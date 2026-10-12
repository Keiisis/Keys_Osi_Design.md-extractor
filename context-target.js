// Keys_Osi: remembers the element under the last right-click so
// "Extraire ce composant" works on the first try, before the extractor
// is injected. Shares the extension's isolated world with content-script.js.
document.addEventListener(
  "contextmenu",
  (event) => {
    const el = event.target instanceof Element ? event.target.closest("*:not(svg *):not(svg)") : null;
    if (el instanceof HTMLElement) {
      window.__keysOsiContextTarget = el;
    }
  },
  true
);
