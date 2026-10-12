/**
 * Keys_Osi popup views: "Assets & Styles" inspector and "3D" models hub.
 * Page data is rendered with textContent / attributes only; SVG markup is
 * previewed through <img src="data:image/svg+xml"> so it can never run.
 */

import { mountModelViewer } from "./model-viewer.js";
import { createBoardView } from "./insight.js";
import { importFigFile, importFigmaClipboard } from "../lib/figma-offline.mjs";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1048576).toFixed(2)} Mo`;
}

function safeName(name, fallback) {
  return String(name || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").slice(0, 100) || fallback;
}

function fileNameFromUrl(url, ext) {
  if (url.startsWith("data:")) return `inline-${Date.now().toString(36)}.${ext || "bin"}`;
  let last = "";
  try {
    last = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch (e) {}
  last = safeName(last, "asset");
  return /\.[a-z0-9]{2,5}$/i.test(last) ? last : `${last}.${ext || "bin"}`;
}

async function activeTabId() {
  // popup.html?tab=<id> targets a given tab (detached window, E2E runs).
  const pinned = Number(new URLSearchParams(location.search).get("tab"));
  if (pinned) return pinned;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Aucun onglet actif.");
  return tab.id;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) {
    throw new Error("Le service worker Keys_Osi ne répond pas : recharge l'extension (chrome://extensions → ↻) puis la page.");
  }
  if (!response.ok) throw new Error(response.error || "Requête échouée.");
  return response;
}

function setPaneStatus(node, text, isError = false) {
  node.hidden = !text;
  node.textContent = text || "";
  node.classList.toggle("is-error", isError);
}

async function copyText(text, statusNode, label) {
  await navigator.clipboard.writeText(text);
  setPaneStatus(statusNode, `${label} copié.`);
}

function download(url, filename) {
  return chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
}

/* =============================== VIEWS =============================== */

export function initViews({ getNormalized, setNormalized, getSource, setSource }) {
  const tabs = Array.from(document.querySelectorAll(".view-tab"));
  const views = { design: $("viewDesign"), site: $("viewSite"), assets: $("viewAssets"), models: $("viewModels"), board: $("viewBoard") };
  let current = "design";

  const show = (name) => {
    current = name;
    for (const tab of tabs) tab.classList.toggle("is-active", tab.dataset.view === name);
    // Drives the view color and the sliding selector thumb in popup.css.
    document.body.dataset.view = name;
    tabs[0]?.parentElement?.style.setProperty("--i", String(Math.max(0, tabs.findIndex((tab) => tab.dataset.view === name))));
    for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
    chrome.storage.local.set({ keysOsiView: name }).catch(() => {});
    if (name === "assets") assets.open();
    if (name === "site") site.open();
    if (name === "board") board.open();
    if (name === "models") models.open();
    else models.close();
  };
  for (const tab of tabs) tab.addEventListener("click", () => show(tab.dataset.view));

  // Lens: on-page inspector; the popup closes so the page is usable.
  $("lensBtn")?.addEventListener("click", async () => {
    const tabId = await activeTabId();
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lens.js"] });
    if (!new URLSearchParams(location.search).get("tab")) window.close();
  });

  initCompare();
  initFigma({ getNormalized, getSource, setSource });

  // Header chip: which site the popup is working on.
  activeTabId()
    .then((id) => chrome.tabs.get(id))
    .then((tab) => {
      const host = $("siteHost");
      if (host && tab?.url) host.textContent = /^https?:/.test(tab.url) ? new URL(tab.url).hostname.replace(/^www\./, "") : "page système";
      const specimen = $("heroSpecimen");
      if (specimen && /^https?:/.test(tab?.url || "")) specimen.textContent = new URL(tab.url).hostname.replace(/^www\./, "");
    })
    .catch(() => {});

  const site = createSiteView();
  const board = createBoardView();
  const assets = createAssetsView({ getNormalized, setNormalized });
  const models = createModelsView();
  models.refreshBadge();

  chrome.storage.local.get("keysOsiView").then(({ keysOsiView }) => {
    if (keysOsiView && views[keysOsiView] && keysOsiView !== current) show(keysOsiView);
  });
}

/* ============================= SITE VIEW ============================= */

const SITE_PHASES = {
  robots: "Lecture de robots.txt",
  sitemap: "Lecture des sitemaps",
  crawl: "Exploration",
  render: "Rendu JavaScript",
  analyze: "Analyse globale"
};

function createSiteView() {
  const status = $("siteStatus");
  const progress = $("siteProgress");
  const fill = $("siteProgressFill");
  const progressText = $("siteProgressText");
  const scanBtn = $("siteScanBtn");
  const cancelBtn = $("siteCancelBtn");
  const result = $("siteResult");
  const list = $("sitePages");
  let summary = null;
  let jobId = null;

  const setRunning = (running) => {
    scanBtn.disabled = running;
    cancelBtn.hidden = !running;
    progress.hidden = !running;
  };

  const showProgress = (p) => {
    if (!p) return;
    const done = Number(p.analyzed) || 0;
    const budget = Math.max(1, Number(p.budget) || 50);
    fill.style.setProperty("--p", String(Math.min(1, Math.max(0.04, done / budget))));
    let path = "";
    try {
      path = p.current ? new URL(p.current).pathname : "";
    } catch (e) {}
    progressText.textContent = `${SITE_PHASES[p.phase] || "Exploration"} · ${done}/${budget} pages analysées · ${p.discovered || 0} URL découvertes${p.rendered ? ` · ${p.rendered} rendues` : ""}${p.failed ? ` · ${p.failed} échecs` : ""}${path ? ` · ${path}` : ""}`;
  };

  const renderSummary = () => {
    result.hidden = !summary;
    if (!summary) return;
    const s = summary.stats;
    $("siteStats").replaceChildren(
      ...[
        [s.pagesAnalyzed, "pages analysées"],
        [s.templates, "modèles de routes"],
        [s.listedNotFetched, "URL listées"],
        [summary.flows, "parcours"],
        [summary.forms, "formulaires"],
        [s.rendered, "rendues en JS"]
      ].map(([value, label]) => el("div", { class: "site-stat" }, [el("strong", { text: String(value ?? 0) }), el("span", { text: label })]))
    );
    renderList();
  };

  const renderList = () => {
    const query = $("siteFilter").value.trim().toLowerCase();
    const pages = summary.pages.filter((page) => !query || `${page.path} ${page.type} ${page.title} ${page.pattern}`.toLowerCase().includes(query));
    list.replaceChildren(
      ...pages.map((page) =>
        el("li", { class: "site-page" }, [
          el("div", { class: "site-page__head" }, [
            el("code", { class: "site-page__path", text: page.path }),
            el("span", { class: "tag is-accent", text: page.type }),
            page.pattern !== page.path ? el("span", { class: "tag", text: page.pattern }) : null,
            page.rendered ? el("span", { class: "tag", text: "JS" }) : null
          ]),
          el("p", { class: "site-page__purpose", text: page.purpose }),
          el("div", { class: "asset-actions" }, [
            el("button", { type: "button", text: `${page.sections} sections · .md`, onclick: () => exportSite("page", page.path) }),
            el("button", { type: "button", text: "Ouvrir", onclick: () => chrome.tabs.create({ url: summary.origin + page.path, active: false }) })
          ])
        ])
      )
    );
  };

  const exportSite = async (what, path) => {
    try {
      const response = await send({ type: "SITE_EXPORT", what, path });
      setPaneStatus(status, `Téléchargé : ${response.filename}${response.fileCount ? ` (${response.fileCount} fichiers)` : ""}`);
    } catch (error) {
      setPaneStatus(status, error.message, true);
    }
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "SITE_PROGRESS" && (!jobId || message.jobId === jobId)) {
      setRunning(true);
      showProgress(message);
    }
    if (message?.type === "SITE_DONE" && (!jobId || message.jobId === jobId)) {
      setRunning(false);
      jobId = null;
      if (message.ok) {
        summary = message.summary;
        setPaneStatus(status, `Structure prête : ${summary.stats.pagesAnalyzed} pages, ${summary.stats.templates} modèles. Télécharge SITE_STRUCTURE.md ou le ZIP complet.`);
        renderSummary();
      } else {
        setPaneStatus(status, `Scan interrompu : ${message.error}`, true);
      }
    }
  });

  scanBtn.addEventListener("click", async () => {
    setPaneStatus(status, "");
    setRunning(true);
    showProgress({ phase: "robots", analyzed: 0, budget: Number($("siteMaxPages").value) });
    try {
      const response = await send({
        type: "SITE_SCAN_START",
        tabId: await activeTabId(),
        maxPages: Number($("siteMaxPages").value),
        samplePerTemplate: Number($("siteSample").value),
        render: $("siteRenderChk").checked
      });
      jobId = response.jobId;
    } catch (error) {
      setRunning(false);
      setPaneStatus(status, error.message, true);
    }
  });
  cancelBtn.addEventListener("click", () => send({ type: "SITE_SCAN_CANCEL" }).catch(() => {}));
  $("siteMasterBtn").addEventListener("click", () => exportSite("master"));
  $("siteZipBtn").addEventListener("click", () => exportSite("zip"));
  $("siteJsonBtn").addEventListener("click", () => exportSite("json"));
  $("siteFilter").addEventListener("input", () => summary && renderList());

  initTech();
  initRea();

  let opened = false;
  return {
    async open() {
      activeTabId()
        .then((id) => chrome.tabs.get(id))
        .then((tab) => {
          if (/^https?:/.test(tab?.url || "")) $("siteOrigin").textContent = new URL(tab.url).origin;
        })
        .catch(() => {});
      if (opened) return;
      opened = true;
      try {
        const state = await send({ type: "SITE_STATE" });
        summary = state.summary;
        renderSummary();
        if (state.job) {
          jobId = state.job.jobId;
          setRunning(true);
          showProgress(state.job.progress || { phase: "crawl", analyzed: 0, budget: state.job.options?.maxPages });
        }
      } catch (error) {
        setPaneStatus(status, error.message, true);
      }
    }
  };
}

function initTech() {
  const status = $("techStatus");
  const render = (summary) => {
    $("techResult").hidden = !summary;
    if (!summary) return;
    $("techChips").replaceChildren(
      ...[...summary.frameworks, ...summary.css, ...summary.hosting, ...summary.services].map((name) => el("span", { class: "chip is-active", text: name }))
    );
    $("techStats").replaceChildren(
      ...[
        [summary.routes, "routes de build"],
        [summary.endpoints, "endpoints API"],
        [summary.graphql, "opérations GraphQL"],
        [summary.sourceMaps, "source maps"],
        [summary.sourceFiles, "fichiers sources"],
        [summary.frameworks.length, "frameworks"]
      ].map(([value, label]) => el("div", { class: "site-stat" }, [el("strong", { text: String(value ?? 0) }), el("span", { text: label })]))
    );
    $("techSourcesBtn").disabled = !summary.sourceFiles;
  };
  const exportTech = async (what) => {
    try {
      const response = await send({ type: "TECH_EXPORT", what });
      setPaneStatus(status, `Téléchargé : ${response.filename}${response.fileCount ? ` (${response.fileCount} fichiers)` : ""}`);
    } catch (error) {
      setPaneStatus(status, error.message, true);
    }
  };
  send({ type: "TECH_STATE" })
    .then((state) => render(state.summary))
    .catch(() => {});
  $("techBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setPaneStatus(status, "Sonde du runtime, lecture des bundles, manifestes et source maps…");
    try {
      const { summary } = await send({ type: "TECH_DECODE", tabId: await activeTabId() });
      render(summary);
      setPaneStatus(status, `${summary.frameworks.join(", ") || "Aucun framework détecté"} — ${summary.routes} routes, ${summary.endpoints} endpoints, ${summary.sourceFiles} fichiers sources.${summary.routes ? " Le prochain scan inclura ces routes." : ""}`);
    } catch (error) {
      setPaneStatus(status, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $("techMdBtn").addEventListener("click", () => exportTech("md"));
  $("techSourcesBtn").addEventListener("click", () => exportTech("sources"));
  $("techJsonBtn").addEventListener("click", () => exportTech("json"));
}

/* ============================== REA ============================== */

function initRea() {
  const status = $("reaStatus");
  const state = $("reaState");
  let started = false;
  let tools = [];
  let lastDir = "";

  const fmtKb = (bytes) => `${Math.round((bytes || 0) / 1024)} Ko`;
  const render = (record) => {
    $("reaResult").hidden = !record;
    if (!record) return;
    lastDir = record.dir;
    const s = record.summary;
    $("reaStats").replaceChildren(
      ...[
        [s.bundle?.scriptsAnalyzed ?? 0, "scripts analysés"],
        [fmtKb(s.bundle?.bytes), "de JavaScript"],
        [s.bundle?.routes.length ?? 0, "routes dans le code"],
        [s.bundle?.endpoints.length ?? 0, "endpoints"],
        [s.page?.resources ?? 0, "ressources"],
        [s.webmcpTools.length, "outils WebMCP"]
      ].map(([value, label]) => el("div", { class: "site-stat" }, [el("strong", { text: String(value) }), el("span", { text: label })]))
    );
    const findings = [
      ...(s.bundle?.chunks || []).slice(0, 6).map((chunk) => `${chunk.url} — ${fmtKb(chunk.bytes)}`),
      ...(s.bundle?.routes || []).slice(0, 10).map((route) => `route ${route}`),
      ...(s.bundle?.endpoints || []).slice(0, 10).map((endpoint) => `endpoint ${endpoint}`),
      s.bundle ? `source maps : ${s.bundle.sourceMaps.status} (${s.bundle.sourceMaps.processed})` : "",
      ...(s.page?.thirdPartyOrigins || []).slice(0, 6).map(([host, count]) => `tiers ${host} ×${count}`),
      ...Object.entries(s.errors || {}).map(([key, error]) => `échec ${key} : ${error}`)
    ].filter(Boolean);
    $("reaFindings").replaceChildren(...findings.map((text) => el("li", { text })));
  };

  const start = async () => {
    if (started) return;
    started = true;
    state.textContent = "Démarrage de REA (premier lancement : téléchargement du moteur, jusqu'à une minute)…";
    try {
      const { status: info, extensionId } = await send({ type: "REA_STATUS" });
      $("reaSetup").hidden = true;
      if (info.error) throw new Error(info.error);
      state.textContent = `REA ${info.rea.version} · ${info.rea.tools} outils · navigateur d'analyse : ${info.browser ? info.browser.split(/[\\/]/).pop() : "introuvable"} · preuves : ${info.output}`;
      const list = await send({ type: "REA_TOOLS" });
      tools = list.tools;
      $("reaToolCount").textContent = String(tools.length);
      $("reaTool").replaceChildren(...tools.map((tool) => el("option", { value: tool.name, text: tool.name })));
      $("reaTool").dispatchEvent(new Event("change"));
      void extensionId;
    } catch (error) {
      started = false;
      const command = (error.message.match(/node native-host\/install\.mjs[^—]*/) || [""])[0].trim();
      $("reaSetup").hidden = !command;
      if (command) $("reaInstallCmd").textContent = command;
      state.textContent = command ? "Hôte à installer ou à autoriser." : error.message;
    }
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "REA_PROGRESS" && message.message) setPaneStatus(status, message.message);
  });
  $("reaFold").addEventListener("toggle", () => $("reaFold").open && start());
  if ($("reaFold").open) start();
  send({ type: "REA_LAST" })
    .then(({ record }) => render(record))
    .catch(() => {});

  const busy = async (button, work) => {
    button.disabled = true;
    try {
      await work();
    } catch (error) {
      setPaneStatus(status, error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  $("reaAnalyzeBtn").addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      await start();
      setPaneStatus(status, "Analyse REA en cours…");
      const record = await send({ type: "REA_ANALYZE", tabId: await activeTabId(), sourceMaps: $("reaMaps").checked, accessibility: $("reaA11y").checked, storageKeys: $("reaStorage").checked });
      render(record);
      setPaneStatus(status, `Analyse terminée. Preuves enregistrées dans ${record.dir}. Le rapport est aussi ajouté à TECH_STACK.md.`);
    })
  );
  $("reaFileBtn").addEventListener("click", () => $("reaFile").click());
  $("reaFile").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    busy($("reaFileBtn"), async () => {
      await start();
      if (file.size > 48 * 1024 * 1024) throw new Error("Fichier trop gros pour la messagerie native (48 Mo max).");
      setPaneStatus(status, `Analyse de ${file.name}…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const result = await send({ type: "REA_FILE", name: file.name, base64: btoa(binary) });
      lastDir = result.dir;
      $("reaOutput").hidden = false;
      $("reaOutput").textContent = JSON.stringify(result.results, null, 2).slice(0, 60000);
      $("reaFold").querySelector(".rea__expert").open = true;
      setPaneStatus(status, `${file.name} analysé. Preuves : ${result.dir}`);
    });
    event.target.value = "";
  });
  $("reaOpenBtn").addEventListener("click", () => send({ type: "REA_OPEN" }).catch((error) => setPaneStatus(status, error.message, true)));
  $("reaOpenRunBtn").addEventListener("click", () => send({ type: "REA_OPEN", path: lastDir }).catch((error) => setPaneStatus(status, error.message, true)));
  $("reaReportBtn").addEventListener("click", () =>
    send({ type: "REA_REPORT" })
      .then((response) => setPaneStatus(status, `Téléchargé : ${response.filename}`))
      .catch((error) => setPaneStatus(status, error.message, true))
  );
  $("reaCopyCmd").addEventListener("click", () => navigator.clipboard.writeText($("reaInstallCmd").textContent).then(() => setPaneStatus(status, "Commande copiée.")));

  $("reaTool").addEventListener("change", async () => {
    const tool = tools.find((entry) => entry.name === $("reaTool").value);
    if (!tool) return;
    $("reaToolDesc").textContent = `${tool.description}${tool.required.length ? ` — requis : ${tool.required.join(", ")}` : ""}`;
    $("reaUseBrowser").checked = tool.properties.includes("cdp_endpoint");
    const skeleton = Object.fromEntries(tool.required.filter((key) => !["cdp_endpoint", "target_id"].includes(key)).map((key) => [key, ""]));
    $("reaArgs").value = JSON.stringify(skeleton, null, 2);
  });
  $("reaRunTool").addEventListener("click", (event) =>
    busy(event.currentTarget, async () => {
      let args;
      try {
        args = JSON.parse($("reaArgs").value || "{}");
      } catch (error) {
        throw new Error("Arguments : JSON invalide.");
      }
      const useBrowser = $("reaUseBrowser").checked;
      const tab = useBrowser ? await chrome.tabs.get(await activeTabId()) : null;
      setPaneStatus(status, `${$("reaTool").value} en cours…`);
      const response = await send({ type: "REA_CALL", name: $("reaTool").value, args, useBrowser, url: tab?.url || "" });
      $("reaOutput").hidden = false;
      $("reaOutput").textContent = JSON.stringify(response.result, null, 2).slice(0, 60000);
      setPaneStatus(status, `Résultat complet : ${response.file}`);
    })
  );
}

/* ============================ ASSETS VIEW ============================ */

function createAssetsView({ getNormalized, setNormalized }) {
  const grid = $("assetGrid");
  const status = $("assetsStatus");
  const search = $("assetSearch");
  const chips = Array.from(document.querySelectorAll("#assetChips .chip"));
  let inventory = null;
  let filter = "images";
  const selected = new Set();

  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      filter = chip.dataset.filter;
      chips.forEach((c) => c.classList.toggle("is-active", c === chip));
      render();
    })
  );
  search.addEventListener("input", render);
  $("assetsRescanBtn").addEventListener("click", () => load(true).catch(fail));
  $("assetsZipAllBtn").addEventListener("click", () => zipSelection().catch(fail));

  function fail(error) {
    setPaneStatus(status, error instanceof Error ? error.message : String(error), true);
  }

  async function load(force) {
    if (inventory && !force) return;
    setPaneStatus(status, "Inventaire des assets de la page...");
    const tabId = await activeTabId();
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
    const response = await chrome.tabs.sendMessage(tabId, { type: "KEYS_OSI_COLLECT_ASSETS" });
    if (!response?.ok) throw new Error(response?.error || "Inventaire impossible sur cette page.");
    inventory = response.assets;
    selected.clear();
    updateChipCounts();
    setPaneStatus(status, "");
    render();
  }

  function updateChipCounts() {
    const counts = {
      images: inventory.images.length,
      svgs: inventory.svgs.length,
      fonts: inventory.fonts.length,
      media: inventory.media.length,
      animations: inventory.animations.length
    };
    for (const chip of chips) {
      chip.querySelector(".count")?.remove();
      if (counts[chip.dataset.filter] !== undefined) chip.append(el("span", { class: "count", text: String(counts[chip.dataset.filter]) }));
    }
  }

  function matches(...fields) {
    const query = search.value.trim().toLowerCase();
    return !query || fields.some((field) => String(field || "").toLowerCase().includes(query));
  }

  function card({ key, thumb, title, meta, actions, tags = [] }) {
    const checkbox = el("input", {
      type: "checkbox",
      class: "asset-select",
      title: "Inclure dans le ZIP",
      onchange: (event) => {
        if (event.target.checked) selected.add(key);
        else selected.delete(key);
        node.classList.toggle("is-selected", event.target.checked);
      }
    });
    checkbox.checked = selected.has(key);
    const node = el("div", { class: `asset-card${selected.has(key) ? " is-selected" : ""}` }, [
      checkbox,
      thumb,
      el("div", { class: "asset-meta" }, [
        el("strong", { text: title, title }),
        el("span", {}, tags.map((tag) => el("span", { class: `tag${tag.accent ? " is-accent" : ""}${tag.warn ? " is-warn" : ""}`, text: tag.text }))),
        el("span", { text: meta })
      ]),
      el("div", { class: "asset-actions" }, actions.map(([label, handler, title2]) => el("button", { type: "button", text: label, title: title2 || label, onclick: () => Promise.resolve(handler()).catch(fail) })))
    ]);
    return node;
  }

  function render() {
    grid.replaceChildren();
    grid.classList.toggle("is-list", false);
    if (filter === "styles") return renderStyles();
    if (!inventory) return;
    const items = [];
    if (filter === "images") {
      for (const image of inventory.images) {
        if (!matches(image.url, image.alt, image.kind, image.ext)) continue;
        const name = fileNameFromUrl(image.url, image.ext);
        items.push(
          card({
            key: `img:${image.url}`,
            thumb: el("div", { class: "asset-thumb" }, el("img", { src: image.url, alt: image.alt || "", loading: "lazy", referrerpolicy: "no-referrer" })),
            title: image.alt || name,
            tags: [{ text: image.ext || "img", accent: true }, { text: image.kind }],
            meta: [image.width && image.height ? `${image.width}×${image.height}` : "", formatBytes(image.bytes)].filter(Boolean).join(" · "),
            actions: [
              ["⬇", () => download(image.url, name), "Télécharger"],
              ["URL", () => copyText(image.url, status, "URL"), "Copier l'URL"],
              ["↗", () => chrome.tabs.create({ url: image.url }), "Ouvrir"]
            ]
          })
        );
      }
    } else if (filter === "svgs") {
      for (const svg of inventory.svgs) {
        if (!matches(svg.label, svg.markup.slice(0, 200))) continue;
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.markup)}`;
        const name = `${safeName(svg.label, "icon").replace(/\s+/g, "-").toLowerCase()}-${svg.id}.svg`;
        items.push(
          card({
            key: `svg:${svg.id}`,
            thumb: el("div", { class: "asset-thumb" }, el("img", { src: dataUrl, alt: svg.label })),
            title: svg.label || `svg-${svg.id}`,
            tags: [{ text: "svg", accent: true }],
            meta: [svg.width && svg.height ? `${svg.width}×${svg.height}` : "", formatBytes(svg.markup.length)].filter(Boolean).join(" · "),
            actions: [
              ["⬇", () => download(dataUrl, name), "Télécharger .svg"],
              ["Code", () => copyText(svg.markup, status, "Code SVG"), "Copier le code SVG"],
              ["JSX", () => copyText(svgToJsx(svg.markup), status, "Composant JSX"), "Copier en JSX"]
            ]
          })
        );
      }
    } else if (filter === "fonts") {
      grid.classList.toggle("is-list", true);
      for (const font of inventory.fonts) {
        if (!matches(font.family, font.url, font.ext)) continue;
        const name = fileNameFromUrl(font.url, font.ext);
        const previewFamily = `keysosi-${Math.abs(hashCode(font.url))}`;
        const sample = el("div", { class: "asset-thumb is-font", text: font.icon ? "★ ✓ ☰ ⌕" : "Aa Bb 123" });
        loadFontPreview(previewFamily, font.url, sample);
        const tags = [{ text: font.ext || "font", accent: true }, { text: `${font.weight} ${font.style}` }];
        if (font.used) tags.push({ text: "utilisée" });
        else if (!font.loaded) tags.push({ text: "non chargée", warn: true });
        if (font.icon) tags.push({ text: "icon font", warn: true });
        items.push(
          card({
            key: `font:${font.url}`,
            thumb: sample,
            title: font.family,
            tags,
            meta: formatBytes(font.bytes),
            actions: [
              ["Fichier", () => download(font.url, name), "Télécharger la police"],
              ["@font-face", () => copyText(fontFaceCss(font, name), status, "@font-face"), "Copier la règle @font-face"],
              ["URL", () => copyText(font.url, status, "URL")]
            ]
          })
        );
      }
    } else if (filter === "media") {
      for (const item of inventory.media) {
        if (!matches(item.url, item.kind, item.ext)) continue;
        const name = fileNameFromUrl(item.url, item.ext || "mp4");
        const thumb =
          item.kind === "video"
            ? el("div", { class: "asset-thumb" }, el("video", { src: item.url, poster: item.poster || null, muted: true, preload: "metadata" }))
            : el("div", { class: "asset-thumb is-font", text: item.kind === "audio" ? "♪" : "▶" });
        const streaming = /\.m3u8(?:[?#]|$)/i.test(item.url) || item.kind === "embed";
        items.push(
          card({
            key: `media:${item.url}`,
            thumb,
            title: name,
            tags: [{ text: item.ext || item.kind, accent: true }, { text: item.kind }].concat(streaming ? [{ text: "stream", warn: true }] : []),
            meta: formatBytes(item.bytes),
            actions: [
              ["⬇", () => download(item.url, name), streaming ? "Playlist HLS / embed : télécharge le manifeste" : "Télécharger"],
              ["URL", () => copyText(item.url, status, "URL")],
              ["↗", () => chrome.tabs.create({ url: item.url })]
            ]
          })
        );
      }
    } else if (filter === "animations") {
      for (const item of inventory.animations) {
        if (!matches(item.url, item.kind)) continue;
        const name = fileNameFromUrl(item.url, item.ext || "json");
        items.push(
          card({
            key: `anim:${item.url}`,
            thumb: el("div", { class: "asset-thumb is-font", text: { lottie: "◐", rive: "◆", spline: "◈" }[item.kind] || "◇" }),
            title: name,
            tags: [{ text: item.kind, accent: true }],
            meta: formatBytes(item.bytes),
            actions: [
              ["⬇", () => download(item.url, name), "Télécharger"],
              ["URL", () => copyText(item.url, status, "URL")],
              ["Embed", () => copyText(embedSnippet(item), status, "Snippet d'intégration"), "Copier le code d'intégration"]
            ]
          })
        );
      }
    }
    if (items.length === 0) items.push(el("p", { class: "empty-state", text: inventory ? "Rien trouvé pour ce filtre." : "" }));
    grid.append(...items);
  }

  async function renderStyles() {
    let normalized = getNormalized();
    if (!normalized) {
      grid.append(
        el("div", { class: "empty-state" }, [
          el("p", { text: "Les couleurs, dégradés, ombres et polices viennent de l'extraction du design system." }),
          el("button", {
            type: "button",
            class: "export-btn",
            text: "Extraire maintenant",
            onclick: async () => {
              setPaneStatus(status, "Extraction...");
              const response = await send({ type: "RUN_EXTRACTION", mode: "design", persistOutputMode: false }).catch(fail);
              if (response) {
                setNormalized(response);
                setPaneStatus(status, "");
                render();
              }
            }
          })
        ])
      );
      return;
    }
    const section = (text) => el("p", { class: "style-section-title", text });
    const valueOf = (row) => String(row.value || "").split(" ")[0];

    const exportRow = el("div", { class: "export-grid" }, [
      ["CSS vars", "cssVariables"],
      ["SCSS", "scss"],
      ["Tailwind", "tailwindConfig"],
      ["W3C JSON", "w3cTokens"]
    ].map(([label, field]) =>
      el("button", {
        type: "button",
        class: "export-btn",
        text: `Copier ${label}`,
        onclick: async () => {
          const response = await send({ type: "EXPORT_TOKENS", normalized }).catch(fail);
          if (response) await copyText(response[field], status, label);
        }
      })
    ));
    grid.append(section("Exports"), exportRow);

    const colors = (normalized.colorPalette || []).filter((row) => matches(row.token, row.value));
    if (colors.length) grid.append(section(`Couleurs (${colors.length})`));
    for (const row of colors) {
      const hex = valueOf(row);
      grid.append(
        el("div", { class: "asset-card" }, [
          el("div", { class: "swatch", style: `background:${hex}`, title: "Cliquer pour copier", onclick: () => copyText(hex, status, hex).catch(fail) }),
          el("div", { class: "asset-meta" }, [el("strong", { text: hex }), el("span", { text: `${row.token}${row.usage ? ` · ${row.usage}×` : ""}` })]),
          el("div", { class: "asset-actions" }, [
            el("button", { type: "button", text: "HEX", onclick: () => copyText(hex, status, "HEX").catch(fail) }),
            el("button", { type: "button", text: "RGB", onclick: () => copyText(hexToRgb(hex), status, "RGB").catch(fail) }),
            el("button", { type: "button", text: "HSL", onclick: () => copyText(hexToHsl(hex), status, "HSL").catch(fail) })
          ])
        ])
      );
    }

    const gradients = (normalized.gradientTokens || []).filter((row) => matches(row.token, row.value));
    if (gradients.length) grid.append(section(`Dégradés (${gradients.length})`));
    for (const row of gradients) {
      const css = String(row.value).replace(/\s*\(var\(--[^)]*\)\)\s*$/, "");
      grid.append(
        el("div", { class: "asset-card" }, [
          el("div", { class: "swatch", style: `background:${css}`, onclick: () => copyText(`background: ${css};`, status, "Dégradé").catch(fail) }),
          el("div", { class: "asset-meta" }, [el("strong", { text: row.token }), el("span", { text: css.slice(0, 90) })])
        ])
      );
    }

    const shadows = (normalized.shadowTokens || []).filter((row) => matches(row.token, row.value));
    if (shadows.length) grid.append(section(`Ombres (${shadows.length})`));
    for (const row of shadows) {
      const css = String(row.value).replace(/\s*\(var\(--[^)]*\)\)\s*$/, "");
      grid.append(
        el("div", { class: "asset-card" }, [
          el("div", { class: "asset-thumb is-font", onclick: () => copyText(`box-shadow: ${css};`, status, "Ombre").catch(fail) }, el("div", { class: "shadow-demo", style: `box-shadow:${css}` })),
          el("div", { class: "asset-meta" }, [el("strong", { text: row.token }), el("span", { text: css.slice(0, 90) })])
        ])
      );
    }

    const headings = normalized.headings || [];
    if (headings.length) grid.append(section("Échelle typographique (mesurée)"));
    for (const h of headings) {
      const spec = `font-family: ${h.fontFamily}; font-size: ${h.fontSize}; line-height: ${h.lineHeight}; font-weight: ${h.fontWeight}; letter-spacing: ${h.letterSpacing};`;
      grid.append(
        el("div", { class: "asset-card" }, [
          el("div", { class: "asset-meta" }, [el("strong", { text: `${h.level.toUpperCase()} · ${h.fontSize}/${h.lineHeight}` }), el("span", { text: `${h.fontFamily} ${h.fontWeight}` })]),
          el("div", { class: "asset-actions" }, [el("button", { type: "button", text: "Copier CSS", onclick: () => copyText(spec, status, `Style ${h.level}`).catch(fail) })])
        ])
      );
    }
  }

  async function zipSelection() {
    if (!inventory) throw new Error("Lance d'abord l'inventaire.");
    const files = [];
    const used = new Set();
    const unique = (folder, name) => {
      let path = `${folder}/${name}`;
      for (let i = 2; used.has(path); i++) path = `${folder}/${name.replace(/(\.[a-z0-9]+)?$/i, `-${i}$1`)}`;
      used.add(path);
      return path;
    };
    const all = selected.size === 0;
    for (const image of inventory.images) if (all || selected.has(`img:${image.url}`)) files.push({ path: unique("images", fileNameFromUrl(image.url, image.ext)), url: image.url });
    for (const svg of inventory.svgs) if (all || selected.has(`svg:${svg.id}`)) files.push({ path: unique("svg", `${safeName(svg.label, "icon").replace(/\s+/g, "-").toLowerCase()}-${svg.id}.svg`), content: svg.markup });
    for (const font of inventory.fonts) if (all || selected.has(`font:${font.url}`)) files.push({ path: unique("fonts", fileNameFromUrl(font.url, font.ext)), url: font.url });
    for (const item of inventory.media) if ((all && item.kind !== "embed") || selected.has(`media:${item.url}`)) files.push({ path: unique("media", fileNameFromUrl(item.url, item.ext || "mp4")), url: item.url });
    for (const item of inventory.animations) if (all || selected.has(`anim:${item.url}`)) files.push({ path: unique("animations", fileNameFromUrl(item.url, item.ext || "json")), url: item.url });
    if (inventory.fonts.length && (all || inventory.fonts.some((f) => selected.has(`font:${f.url}`)))) {
      files.push({ path: "fonts/fonts.css", content: inventory.fonts.map((font) => fontFaceCss(font, fileNameFromUrl(font.url, font.ext))).join("\n\n") });
    }
    if (files.length === 0) throw new Error("Sélection vide.");
    setPaneStatus(status, `Assemblage du ZIP (${files.length} fichiers)...`);
    const response = await send({ type: "ASSETS_ZIP", files, title: inventory.page.title });
    setPaneStatus(status, `ZIP téléchargé : ${response.path} (${response.fileCount} fichiers${response.skipped ? `, ${response.skipped} inaccessibles` : ""}).`);
  }

  return {
    open() {
      load(false).catch(fail);
      if (filter === "styles") render();
    }
  };
}

function hashCode(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

function loadFontPreview(family, url, node) {
  try {
    const face = new FontFace(family, `url("${url.replace(/"/g, "%22")}")`);
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        node.style.fontFamily = `"${family}"`;
      })
      .catch(() => {});
  } catch (e) {}
}

function fontFaceCss(font, fileName) {
  const format = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype", eot: "embedded-opentype" }[font.ext] || font.ext;
  return `@font-face {\n  font-family: "${font.family.replace(/"/g, "")}";\n  src: url("./${fileName}") format("${format}");\n  font-weight: ${font.weight === "?" ? "400" : font.weight};\n  font-style: ${font.style === "?" ? "normal" : font.style};\n  font-display: swap;\n}`;
}

function svgToJsx(markup) {
  const jsx = markup
    .replace(/\s(class)=/g, " className=")
    .replace(/\s([a-z]+)-([a-z])([a-z-]*)=/g, (_m, a, b, c) => ` ${a}${b.toUpperCase()}${c.replace(/-([a-z])/g, (_x, y) => y.toUpperCase())}=`)
    .replace(/\sxlink:href=/g, " xlinkHref=")
    .replace(/<svg([^>]*)>/, "<svg$1 {...props}>");
  return `export function Icon(props) {\n  return (\n    ${jsx}\n  );\n}\n`;
}

function embedSnippet(item) {
  if (item.kind === "spline") return `<script type="module" src="https://unpkg.com/@splinetool/viewer/build/spline-viewer.js"></script>\n<spline-viewer url="${item.url}"></spline-viewer>`;
  if (item.kind === "rive") return `<canvas id="rive" width="500" height="500"></canvas>\n<script src="https://unpkg.com/@rive-app/canvas"></script>\n<script>new rive.Rive({ src: "${item.url}", canvas: document.getElementById("rive"), autoplay: true });</script>`;
  return `<script src="https://unpkg.com/@lottiefiles/dotlottie-wc" type="module"></script>\n<dotlottie-wc src="${item.url}" autoplay loop></dotlottie-wc>`;
}

function hexToRgbParts(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
}

function hexToRgb(hex) {
  return `rgb(${hexToRgbParts(hex).join(", ")})`;
}

function hexToHsl(hex) {
  const [r, g, b] = hexToRgbParts(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

/* ============================= 3D VIEW ============================= */

const CONFIDENCE_LABEL = {
  high: "réseau",
  low: "heuristique",
  dom: "page",
  manual: "manuel",
  verified: "vérifié"
};

function createModelsView() {
  const list = $("modelList");
  const status = $("modelsStatus");
  const netList = $("netList");
  const badge = $("modelBadge");
  let timer = null;
  let tabId = null;

  const fail = (error) => setPaneStatus(status, error instanceof Error ? error.message : String(error), true);

  chrome.storage.local.get(["keysOsiZup", "keysOsiMm", "keysOsiSaveAs"]).then((data) => {
    if (data.keysOsiZup === false) $("optZup").checked = false;
    if (data.keysOsiMm === false) $("optMm").checked = false;
    if (data.keysOsiSaveAs === false) $("optSaveAs").checked = false;
  });
  $("optSaveAs").addEventListener("change", (e) => chrome.storage.local.set({ keysOsiSaveAs: e.target.checked }));
  $("optZup").addEventListener("change", (e) => chrome.storage.local.set({ keysOsiZup: e.target.checked }));
  $("optMm").addEventListener("change", (e) => chrome.storage.local.set({ keysOsiMm: e.target.checked }));
  $("modelsScanBtn").addEventListener("click", () => scan().catch(fail));
  $("sceneExportBtn").addEventListener("click", () => exportScene().catch(fail));

  // Live three.js scene → GLB (page world; works when no model file was fetched).
  async function exportScene() {
    if (tabId == null) tabId = await activeTabId();
    setPaneStatus(status, "Lecture de la scène three.js de la page...");
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["scene-export.js"] });
    if (!result?.ok) throw new Error(result?.error || "Export impossible sur cette page.");
    setPaneStatus(status, `Scène exportée : ${result.meshes} mesh, ${Math.round(result.triangles).toLocaleString("fr-FR")} triangles, ${formatBytes(result.bytes)}${result.revision ? ` (three.js r${result.revision})` : ""}.`);
  }
  $("modelsClearBtn").addEventListener("click", () =>
    send({ type: "MODELS_CLEAR", tabId, keepRequests: true }).then(refresh).catch(fail)
  );
  for (const id of ["netSearch", "netType", "netMinKb", "netFlagged"]) $(id).addEventListener("input", refresh);
  $("netPanel").addEventListener("toggle", refresh);

  let autoScanned = false;
  async function scan({ quiet = false } = {}) {
    if (tabId == null) tabId = await activeTabId();
    if (!quiet) setPaneStatus(status, "Scan du DOM et des ressources chargées...");
    const result = await send({ type: "MODELS_SCAN", tabId });
    if (!quiet || result.added) {
      setPaneStatus(status, result.added ? `${result.added} modèle(s) trouvé(s) dans la page et ses ressources.` : "Aucun nouveau modèle dans le DOM.");
    }
    await refresh();
  }

  async function refresh() {
    if (tabId == null) tabId = await activeTabId();
    const withRequests = $("netPanel").open;
    const state = await send({ type: "MODELS_STATE", tabId, withRequests });
    renderModels(state.models);
    $("netCount").textContent = String(state.requestCount);
    if (withRequests) renderRequests(state.requests || []);
    if (!state.captureActive) {
      setPaneStatus(status, "Capture réseau inactive : recharge l'extension (chrome://extensions → ↻) pour activer la permission webRequest. Le scan de la page fonctionne quand même.", true);
    }
    badge.hidden = state.models.length === 0;
    badge.textContent = String(state.models.length);
  }

  // Open 3D previews survive list refreshes (url -> { wrap, viewer }).
  const previews = new Map();
  let lastModelsSignature = "";

  async function togglePreview(model) {
    if (previews.has(model.url)) {
      previews.get(model.url).viewer?.destroy();
      previews.delete(model.url);
      lastModelsSignature = "";
      return refresh();
    }
    setPaneStatus(status, "Décodage du modèle pour l'aperçu (Draco/meshopt local)...");
    const { blobUrl, triangleCount } = await send({ type: "MODEL_PREVIEW", url: model.url, format: model.format });
    const bytes = new Uint8Array(await (await fetch(blobUrl)).arrayBuffer());
    chrome.runtime.sendMessage({ target: "offscreen", type: "KEYS_OSI_REVOKE_ZIP", blobUrl }).catch(() => {});
    const canvas = el("canvas", { class: "model-preview__canvas", "aria-label": `Aperçu 3D de ${model.filename}` });
    const wrap = el("div", { class: "model-preview" }, [canvas, el("span", { class: "model-preview__meta", text: `${triangleCount.toLocaleString("fr-FR")} triangles · glisser pour tourner · molette pour zoomer` })]);
    previews.set(model.url, { wrap, viewer: null });
    lastModelsSignature = "";
    await refresh();
    previews.get(model.url).viewer = mountModelViewer(canvas, bytes);
    setPaneStatus(status, "");
  }

  function renderModels(models) {
    const signature = JSON.stringify([models, [...previews.keys()]]);
    if (signature === lastModelsSignature) return;
    lastModelsSignature = signature;
    $("modelCount").textContent = `${models.length} modèle${models.length > 1 ? "s" : ""} 3D`;
    if (models.length === 0) {
      list.replaceChildren(el("li", { class: "empty-state", text: "Aucun modèle détecté. Laisse la page charger sa scène 3D (ou recharge-la) puis « Scanner la page »." }));
      return;
    }
    list.replaceChildren(
      ...models.map((model) => {
        const convertible = model.format === "glb" || model.format === "gltf";
        const actions = [
          ["Télécharger", () => send({ type: "MODEL_DOWNLOAD", url: model.url, filename: model.filename, format: model.format })],
          ["Copier l'URL", () => copyText(model.url, status, "URL")],
          ["Identifier", () => identify(model)]
        ];
        if (convertible) {
          actions.unshift([previews.has(model.url) ? "Fermer l'aperçu" : "Aperçu 3D", () => togglePreview(model)]);
          actions.push(["→ STL", () => convert(model, "stl")], ["→ 3MF", () => convert(model, "3mf")]);
        }
        const hint = model.detected ? el("div", { class: "model-hint", text: `Octets magiques : ${model.detected.hint}` }) : null;
        return el("li", { class: "model-card" }, [
          el("div", { class: "model-name", text: model.filename }),
          el("div", {}, [
            el("span", { class: "tag is-accent", text: model.format }),
            el("span", { class: `tag${model.confidence === "low" ? " is-warn" : ""}`, text: CONFIDENCE_LABEL[model.confidence] || model.confidence }),
            el("span", { class: "net-sub", text: ` ${formatBytes(model.size) || "taille inconnue"}` })
          ]),
          hint,
          previews.get(model.url)?.wrap || null,
          el("div", { class: "asset-actions" }, actions.map(([label, handler]) => el("button", { type: "button", text: label, onclick: () => Promise.resolve(handler()).catch(fail) })))
        ]);
      })
    );
  }

  async function identify(model) {
    setPaneStatus(status, "Lecture des 8 premiers Ko...");
    const response = await send({ type: "MODEL_IDENTIFY", tabId, url: model.url });
    let text = `${response.result.format.toUpperCase()} (${response.result.confidence}) — ${response.result.hint}`;
    if (response.siblingGltf) {
      text += ` Fichier parent trouvé : ${response.siblingGltf} (ajouté à la liste).`;
      await send({ type: "MODEL_FLAG", tabId, url: response.siblingGltf });
    }
    setPaneStatus(status, text);
    await refresh();
  }

  async function convert(model, target) {
    setPaneStatus(status, `Conversion ${model.format.toUpperCase()} → ${target.toUpperCase()} (décodage Draco/meshopt local)...`);
    const response = await send({
      type: "MODEL_CONVERT",
      url: model.url,
      format: model.format,
      target,
      rotateYupToZup: $("optZup").checked,
      scale: $("optMm").checked ? 1000 : 1
    });
    setPaneStatus(status, `${response.filename} : ${response.triangleCount.toLocaleString("fr-FR")} triangles${response.hasTexture ? ", texture incluse" : ""}.`);
  }

  let lastNetSignature = "";
  function renderRequests(requests) {
    const signature = JSON.stringify([requests.length, requests.filter((r) => r.flagged).length, $("netSearch").value, $("netType").value, $("netMinKb").value, $("netFlagged").checked]);
    if (signature === lastNetSignature) return;
    lastNetSignature = signature;
    const query = $("netSearch").value.trim().toLowerCase();
    const type = $("netType").value;
    const minBytes = (Number($("netMinKb").value) || 0) * 1024;
    const flaggedOnly = $("netFlagged").checked;
    const rows = requests
      .filter((r) => (!query || r.url.toLowerCase().includes(query) || r.contentType.toLowerCase().includes(query)))
      .filter((r) => !type || r.type === type || (type === "xmlhttprequest" && r.type === "fetch"))
      .filter((r) => !minBytes || (r.size || 0) >= minBytes)
      .filter((r) => !flaggedOnly || r.flagged)
      .slice(-250)
      .reverse();
    netList.replaceChildren(
      ...rows.map((r) =>
        el("li", { class: `net-row${r.flagged ? " is-flagged" : ""}` }, [
          el("div", { class: "net-url", text: r.url }),
          el("div", { class: "net-sub", text: [r.type, r.status, r.contentType, formatBytes(r.size), r.origin === "timing" ? "resource timing" : ""].filter(Boolean).join(" · ") }),
          el("div", { class: "asset-actions" }, [
            el("button", { type: "button", text: r.flagged ? "✓ Modèle" : "Marquer comme modèle", onclick: () => send({ type: "MODEL_FLAG", tabId, url: r.url }).then(refresh).catch(fail) }),
            el("button", { type: "button", text: "Télécharger", onclick: () => send({ type: "MODEL_DOWNLOAD", url: r.url, filename: decodeURIComponent(r.url.split(/[?#]/)[0].split("/").pop() || "fichier"), format: "unknown", keepName: true }).catch(fail) }),
            el("button", { type: "button", text: "Identifier", onclick: () => identify({ url: r.url }).catch(fail) })
          ])
        ])
      )
    );
  }

  return {
    open() {
      // Autonomous: scan the page (DOM + Resource Timing) on first open, so
      // models loaded before the extension started are listed too.
      if (!autoScanned) {
        autoScanned = true;
        scan({ quiet: true }).catch(fail);
      }
      refresh().catch(fail);
      clearInterval(timer);
      timer = setInterval(() => refresh().catch(() => {}), 1500);
    },
    close() {
      clearInterval(timer);
      timer = null;
    },
    refreshBadge() {
      refresh().catch(() => {});
    }
  };
}

/* ======================= BEFORE / AFTER COMPARISON ======================= */

/* ============================== FIGMA ============================== */

function initFigma({ getNormalized, getSource, setSource }) {
  const status = $("figmaStatus");
  const bar = $("sourceBar");
  const run = async (button, label, work) => {
    button.disabled = true;
    setPaneStatus(status, label);
    try {
      await work();
    } catch (error) {
      setPaneStatus(status, error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  const showSummary = (summary) => {
    $("figmaSummary").hidden = !summary;
    $("figmaExports").hidden = !summary;
    bar.hidden = !(summary && getSource() === "figma");
    if (!summary) return;
    $("sourceName").textContent = `Figma — ${summary.name}`;
    $("figmaSummary").replaceChildren(
      ...[
        [summary.screens, "écrans"],
        [summary.sections, "sections"],
        [summary.componentSets + summary.components, "composants"],
        [summary.styles, "styles"],
        [summary.variables, "variables"],
        [summary.icons, "icônes"]
      ].map(([value, label]) => el("div", { class: "site-stat" }, [el("strong", { text: String(value ?? 0) }), el("span", { text: label })]))
    );
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "FIGMA_PROGRESS" && message.message) setPaneStatus(status, message.message);
  });

  send({ type: "FIGMA_STATE" })
    .then((state) => {
      showSummary(state.summary);
      if (state.hasToken) $("figmaToken").placeholder = "Jeton enregistré (laisser vide pour le réutiliser)";
      if (state.summary) $("figmaUrl").value = state.summary.url;
    })
    .catch(() => {});

  // A Figma tab pre-fills the link and opens the panel.
  activeTabId()
    .then((id) => chrome.tabs.get(id))
    .then((tab) => {
      if (/^https:\/\/(www\.)?figma\.com\/(design|file|proto|board)\//.test(tab?.url || "")) {
        $("figmaUrl").value = tab.url;
        $("figmaFold").open = true;
      }
    })
    .catch(() => {});

  $("figmaImportBtn").addEventListener("click", (event) =>
    run(event.currentTarget, "Connexion à Figma…", async () => {
      const response = await send({ type: "FIGMA_IMPORT", url: $("figmaUrl").value.trim(), token: $("figmaToken").value.trim(), wholeFile: $("figmaWholeFile").checked });
      $("figmaToken").value = "";
      $("figmaToken").placeholder = "Jeton enregistré (laisser vide pour le réutiliser)";
      setPaneStatus(status, `« ${response.summary.name} » aspiré : ${response.summary.screens} écrans, ${response.summary.components + response.summary.componentSets} composants. DESIGN.md, SKILL.md et PROMPT_PRO utilisent maintenant ce fichier.`);
      await setSource("figma");
      showSummary(response.summary);
    })
  );
  // Offline routes: decoded here (pure module), pipeline in the service worker.
  const importDecoded = async (label, decode) => {
    setPaneStatus(status, label);
    try {
      const { file, imageFills, source } = await decode();
      const response = await send({ type: "FIGMA_IMPORT_DECODED", file, imageFills, fileKey: source.fileKey || "", via: source.kind || "fig" });
      setPaneStatus(status, `« ${response.summary.name} » importé sans API : ${response.summary.screens} écrans, ${response.summary.components + response.summary.componentSets} composants. DESIGN.md, SKILL.md et PROMPT_PRO utilisent maintenant ce design.`);
      await setSource("figma");
      showSummary(response.summary);
    } catch (error) {
      setPaneStatus(status, error.message, true);
    }
  };
  $("figmaPaste").addEventListener("paste", (event) => {
    const html = event.clipboardData?.getData("text/html") || "";
    event.preventDefault();
    if (!html.includes("(figma)")) {
      setPaneStatus(status, "Le presse-papiers ne contient pas de cadres Figma : dans Figma, sélectionne des cadres puis Ctrl+C.", true);
      return;
    }
    importDecoded("Décodage du presse-papiers Figma…", () => importFigmaClipboard(html));
  });
  $("figmaFigBtn").addEventListener("click", () => $("figmaFigFile").click());
  $("figmaFigFile").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) importDecoded(`Lecture de ${file.name}…`, async () => importFigFile(new Uint8Array(await file.arrayBuffer()), { fileName: file.name }));
    event.target.value = "";
  });
  $("figmaLiveBtn").addEventListener("click", async () => {
    setPaneStatus(status, "Lecture de l'onglet Figma…");
    try {
      const response = await send({ type: "FIGMA_LIVE", tabId: await activeTabId() });
      setPaneStatus(status, `« ${response.summary.name} » lu depuis l'onglet : ${response.summary.screens} écrans.`);
      await setSource("figma");
      showSummary(response.summary);
    } catch (error) {
      setPaneStatus(status, error.message, true);
    }
  });

  $("figmaUseBtn").addEventListener("click", async () => {
    await setSource("figma");
    bar.hidden = false;
  });
  $("sourceSiteBtn").addEventListener("click", async () => {
    bar.hidden = true;
    await setSource("site");
  });
  $("figmaKitBtn").addEventListener("click", (event) =>
    run(event.currentTarget, "Kit Figma : documents, écrans, rendus PNG, icônes SVG, images…", async () => {
      const response = await send({ type: "FIGMA_EXPORT", what: "zip" });
      setPaneStatus(status, `Kit téléchargé : ${response.filename} (${response.fileCount} fichiers${response.skipped ? `, ${response.skipped} ignorés` : ""})${response.note ? ` — ${response.note}` : ""}`);
    })
  );
  $("figmaStructBtn").addEventListener("click", (event) =>
    run(event.currentTarget, "FIGMA_STRUCTURE.md…", async () => {
      const response = await send({ type: "FIGMA_EXPORT", what: "structure" });
      setPaneStatus(status, `Téléchargé : ${response.filename}`);
    })
  );
  $("figmaCaptureBtn").addEventListener("click", (event) =>
    run(event.currentTarget, "Capture des calques de la page…", async () => {
      const response = await send({ type: "FIGMA_CAPTURE_PAGE", tabId: await activeTabId() });
      setPaneStatus(status, `${response.filename} : ${response.layers} calques, ${response.components} composants détectés, ${response.embedded}/${response.images} images intégrées. Importe-le avec le plugin Keys_Osi.`);
    })
  );
  $("figmaTokensBtn").addEventListener("click", (event) =>
    run(event.currentTarget, "Tokens…", async () => {
      const response = await send({ type: "FIGMA_TOKENS", normalized: getSource() === "figma" ? null : getNormalized() });
      setPaneStatus(status, `${response.filename} prêt : dépose-le dans le plugin Keys_Osi pour créer les Variables.`);
    })
  );
  $("figmaPluginBtn").addEventListener("click", (event) =>
    run(event.currentTarget, "Plugin…", async () => {
      const response = await send({ type: "FIGMA_PLUGIN" });
      setPaneStatus(status, `${response.filename} : dans Figma Desktop → Plugins → Development → Import plugin from manifest.`);
    })
  );
  if (getSource() === "figma") bar.hidden = false;
}

function initCompare() {
  const fold = $("compareFold");
  if (!fold) return;
  const status = $("cmpStatus");
  const list = $("cmpSections");
  const renderResult = (r) => {
    setPaneStatus(status, `Fidélité ${r.grade.percent} % (${r.grade.label}) — rapport : ${r.filename}`);
    list.replaceChildren(
      ...r.sections.map((s) =>
        el("li", { class: "compare__row" }, [
          el("span", { text: `Section ${s.index + 1}` }),
          el("span", { class: "compare__bar", style: `--score:${Math.round(s.score * 100)}%` }),
          el("strong", { text: `${Math.round(s.score * 1000) / 10} %` })
        ])
      )
    );
  };
  const fillTabs = async () => {
    const tabs = (await chrome.tabs.query({})).filter((t) => /^(https?|file):/i.test(t.url || ""));
    for (const [id, pick] of [["cmpRef", 0], ["cmpCand", 1]]) {
      $(id).replaceChildren(...tabs.map((t) => el("option", { value: String(t.id), text: `${(t.title || t.url).slice(0, 48)}` })));
      if (tabs[pick]) $(id).value = String(tabs[pick].id);
    }
  };
  fold.addEventListener("toggle", () => {
    if (!fold.open) return;
    fillTabs().catch(() => {});
    chrome.storage.local.get("keysOsiLastCompare").then(({ keysOsiLastCompare }) => keysOsiLastCompare && renderResult(keysOsiLastCompare));
  });
  $("cmpBtn").addEventListener("click", async () => {
    setPaneStatus(status, "Captures alternées des deux onglets… (le popup peut se fermer : le rapport se télécharge à la fin et reste visible ici)");
    const response = await chrome.runtime.sendMessage({ type: "COMPARE_TABS", refTabId: $("cmpRef").value, candTabId: $("cmpCand").value });
    if (!response?.ok) {
      setPaneStatus(status, response?.error || "Comparaison impossible.", true);
      return;
    }
    renderResult(response);
  });
}
