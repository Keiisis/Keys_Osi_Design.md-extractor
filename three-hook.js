// Keys_Osi: three.js announces every Scene/WebGLRenderer it creates to
// window.__THREE_DEVTOOLS__ (official devtools hook). Listening to it, from
// document_start in the page world, lets the 3D view export live scenes.
(() => {
  const registry = (window.__keysOsiThree ||= { scenes: [], renderers: [], revision: null });
  const hook = window.__THREE_DEVTOOLS__ || (window.__THREE_DEVTOOLS__ = new EventTarget());
  hook.addEventListener("register", (event) => {
    registry.revision = event.detail?.revision || registry.revision;
  });
  hook.addEventListener("observe", (event) => {
    const object = event.detail;
    if (object?.isScene) registry.scenes.push(new WeakRef(object));
    else if (object?.isWebGLRenderer) registry.renderers.push(new WeakRef(object));
  });
})();
