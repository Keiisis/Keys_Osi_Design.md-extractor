/**
 * Keys_Osi popup: rating of generated documents (feeds the learning
 * memory), memory panel, accessibility fixer, moodboard view.
 */
import { a11yFixMarkdown, planContrastFixes } from "../lib/a11y-fix.mjs";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") node.style.cssText = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error("Le service worker Keys_Osi ne répond pas.");
  if (!response.ok) throw new Error(response.error || "Requête échouée.");
  return response;
}

function status(node, text, isError = false) {
  node.hidden = !text;
  node.textContent = text || "";
  node.classList.toggle("is-error", isError);
}

async function targetTabId() {
  const pinned = Number(new URLSearchParams(location.search).get("tab"));
  if (pinned) return pinned;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/* ------------------------------------------------------------- memory */

function renderMemory(state) {
  $("memoryCount").textContent = String(state.stats.lessons);
  $("memoryStats").replaceChildren(
    ...[
      [state.stats.events, "événements"],
      [state.stats.lessons, "leçons actives"],
      [state.stats.ratings, "avis"]
    ].map(([value, label]) => el("div", { class: "site-stat" }, [el("strong", { text: String(value) }), el("span", { text: label })]))
  );
  $("memoryLessons").replaceChildren(
    ...(state.lessons.length
      ? state.lessons.map((lesson) =>
          el("li", { class: `memory__lesson${lesson.enabled ? "" : " is-off"}` }, [
            el("label", { class: "switch" }, [
              el("input", {
                type: "checkbox",
                checked: lesson.enabled,
                "aria-label": "Leçon active",
                onchange: (event) => send({ type: "MEMORY_TOGGLE", id: lesson.id, enabled: event.target.checked }).then(renderMemory)
              }),
              el("span", { text: lesson.text })
            ]),
            el("span", { class: "memory__source", text: `${lesson.type === "routing" ? "routage" : lesson.type === "watch" ? "surveillance" : lesson.feature} · ${lesson.source}` })
          ])
        )
      : [el("li", { class: "memory__empty", text: "Aucune leçon pour l'instant : elles apparaissent après un échec, une incohérence détectée ou un avis." })])
  );
  $("memoryEvents").replaceChildren(
    ...state.recent.map((event) => el("li", { text: `${event.lastAt.slice(0, 10)} · ${event.kind} · ${event.message}${event.count > 1 ? ` (×${event.count})` : ""}${event.model ? ` · ${event.model}` : ""}` }))
  );
  return state;
}

function initMemory() {
  const memoryStatus = $("memoryStatus");
  const refresh = () => send({ type: "MEMORY_STATE" }).then(renderMemory).catch(() => {});
  $("memoryFold").addEventListener("toggle", () => $("memoryFold").open && refresh());
  $("memoryExportBtn").addEventListener("click", async () => {
    try {
      const response = await send({ type: "MEMORY_EXPORT" });
      status(memoryStatus, `Exporté : ${response.filename} (leçons + cas de régression pour les tests).`);
    } catch (error) {
      status(memoryStatus, error.message, true);
    }
  });
  $("memoryImportBtn").addEventListener("click", () => $("memoryImportFile").click());
  $("memoryImportFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      renderMemory(await send({ type: "MEMORY_IMPORT", data: JSON.parse(await file.text()) }));
      status(memoryStatus, "Mémoire fusionnée.");
    } catch (error) {
      status(memoryStatus, error.message, true);
    }
  });
  $("memoryResetBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.dataset.confirm !== "1") {
      button.dataset.confirm = "1";
      button.textContent = "Confirmer l'effacement";
      setTimeout(() => {
        button.dataset.confirm = "";
        button.textContent = "Effacer";
      }, 4000);
      return;
    }
    button.dataset.confirm = "";
    button.textContent = "Effacer";
    renderMemory(await send({ type: "MEMORY_RESET" }));
    status(memoryStatus, "Mémoire effacée.");
  });
  refresh();
  return refresh;
}

/* ------------------------------------------------------------- rating */

function initRating(refreshMemory) {
  let current = null;
  const bar = $("rateBar");
  const form = $("rateForm");
  const selected = new Set();
  send({ type: "MEMORY_STATE" })
    .then((state) => {
      $("rateReasons").replaceChildren(
        ...Object.entries(state.reasons).map(([id, label]) =>
          el("button", {
            type: "button",
            class: "chip",
            text: label,
            onclick: (event) => {
              if (selected.has(id)) selected.delete(id);
              else selected.add(id);
              event.currentTarget.classList.toggle("is-active", selected.has(id));
            }
          })
        )
      );
    })
    .catch(() => {});
  const reset = () => {
    selected.clear();
    form.hidden = true;
    $("rateNote").value = "";
    for (const chip of $("rateReasons").children) chip.classList.remove("is-active");
  };
  document.addEventListener("keysosi:result", (event) => {
    current = event.detail;
    bar.hidden = false;
    bar.classList.remove("is-done");
    $("rateBar").querySelector(".rate__label").textContent = "Ce résultat est-il juste ?";
    reset();
  });
  const submit = async (value) => {
    if (!current) return;
    const tabId = await targetTabId().catch(() => null);
    const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
    let host = "";
    try {
      host = tab?.url ? new URL(tab.url).hostname : "";
    } catch (error) {}
    await send({ type: "MEMORY_RATE", feature: current.feature, value, reasons: [...selected], note: $("rateNote").value, host, url: tab?.url || "", model: current.model || "" });
    bar.classList.add("is-done");
    bar.querySelector(".rate__label").textContent = value === "up" ? "Merci, noté." : "Mémorisé : la prochaine génération en tiendra compte.";
    reset();
    refreshMemory();
  };
  $("rateUp").addEventListener("click", () => submit("up"));
  $("rateDown").addEventListener("click", () => {
    form.hidden = !form.hidden;
  });
  $("rateSend").addEventListener("click", () => {
    if (!selected.size && !$("rateNote").value.trim()) {
      $("rateNote").focus();
      return;
    }
    submit("down");
  });
}

/* ------------------------------------------------------------- a11y */

function initA11y({ getNormalized }) {
  const a11yStatus = $("a11yStatus");
  let plan = null;
  let previewing = false;
  const render = (normalized) => {
    if (!normalized) return;
    plan = planContrastFixes(normalized);
    $("a11ySummary").textContent = `${plan.pairs.length} paires vérifiées · ${plan.failing} sous le seuil AA · ${plan.fixable} corrigées (luminosité seule, teinte conservée).`;
    $("a11yList").replaceChildren(
      ...plan.pairs.map((pair) =>
        el("li", { class: `a11y__row${pair.pass ? " is-pass" : ""}` }, [
          el("span", { class: "a11y__sample", style: `color:${pair.fix ? pair.fix.hex : pair.fg};background:${pair.bg}`, text: "Aa" }),
          el("span", { class: "a11y__label", text: pair.label }),
          el("span", { class: "a11y__ratio", text: pair.pass ? `${pair.ratio}:1 ✓` : pair.fix ? `${pair.ratio} → ${pair.fix.ratio}:1` : `${pair.ratio}:1 ✗` }),
          !pair.pass && pair.fix ? el("code", { text: `${pair.fg} → ${pair.fix.hex}` }) : null
        ])
      )
    );
    const has = plan.colorMap.length > 0;
    $("a11yPreviewBtn").disabled = !has;
    $("a11yCssBtn").disabled = !has;
    $("a11yMdBtn").disabled = !plan.pairs.length;
  };
  document.addEventListener("keysosi:result", (event) => event.detail.normalized && render(event.detail.normalized));
  $("a11yFold").addEventListener("toggle", () => $("a11yFold").open && !plan && render(getNormalized()));
  $("a11yPreviewBtn").addEventListener("click", async () => {
    try {
      const tabId = await targetTabId();
      const result = await send({ type: "A11Y_TRYON", tabId, colorMap: plan.colorMap, enable: !previewing });
      previewing = !previewing;
      $("a11yPreviewBtn").textContent = previewing ? "Retirer l'aperçu" : "Voir sur la page";
      status(a11yStatus, previewing ? `${result.recolored} couleurs corrigées sur la page.` : "Page restaurée.");
    } catch (error) {
      status(a11yStatus, error.message, true);
    }
  });
  $("a11yCssBtn").addEventListener("click", () => navigator.clipboard.writeText(plan.cssOverrides).then(() => status(a11yStatus, "CSS des correctifs copié.")));
  $("a11yMdBtn").addEventListener("click", () => {
    const md = a11yFixMarkdown(plan, { title: getNormalized()?.source?.title || "" });
    chrome.downloads.download({ url: `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`, filename: "A11Y_FIXES.md", saveAs: false, conflictAction: "uniquify" });
    status(a11yStatus, "A11Y_FIXES.md téléchargé.");
  });
}

/* ------------------------------------------------------------- moodboard */

export function createBoardView() {
  const boardStatus = $("boardStatus");
  let board = [];
  let filter = "";
  const badge = $("boardBadge");
  const host = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (error) {
      return "";
    }
  };
  const render = () => {
    $("boardCount").textContent = String(board.length);
    if (badge) {
      badge.hidden = board.length === 0;
      badge.textContent = String(board.length);
    }
    const items = board.filter((item) => !filter || item.kind === filter);
    $("boardGrid").replaceChildren(
      ...(items.length
        ? items.map((item) => {
            let visual;
            if (item.kind === "color") visual = el("div", { class: "pin__swatch", style: `background:${item.hex}` });
            else if (item.kind === "font") visual = el("p", { class: "pin__specimen", style: `font-family:"${item.family}",serif;font-weight:${item.weight || 400}`, text: item.sample || "Aa Bb Cc" });
            else if (item.kind === "image") visual = el("img", { class: "pin__img", src: item.url, alt: item.alt || "", loading: "lazy" });
            else if (item.kind === "section") visual = item.image ? el("img", { class: "pin__img", src: item.image, alt: item.heading || "Section" }) : el("p", { text: item.heading });
            else visual = el("blockquote", { class: "pin__quote", text: item.text });
            const label = item.kind === "color" ? item.hex : item.kind === "font" ? `${item.family} ${item.weight || ""}` : item.kind === "section" ? item.heading || item.role : item.alt || "";
            return el("figure", { class: `pin pin--${item.kind}` }, [
              visual,
              el("figcaption", {}, [el("strong", { text: label || item.kind }), el("span", { text: host(item.sourceUrl || item.url) })]),
              el("button", { type: "button", class: "pin__remove", "aria-label": "Retirer", text: "×", onclick: () => send({ type: "BOARD_REMOVE", id: item.id }).then((response) => ((board = response.board), render())) })
            ]);
          })
        : [el("p", { class: "empty-state", text: "Rien d'épinglé pour l'instant. Ouvre Lens sur un site et appuie sur P ou S." })])
    );
  };
  for (const chip of document.querySelectorAll("#boardChips .chip")) {
    chip.addEventListener("click", () => {
      filter = chip.dataset.kind;
      for (const other of document.querySelectorAll("#boardChips .chip")) other.classList.toggle("is-active", other === chip);
      render();
    });
  }
  $("boardLensBtn").addEventListener("click", async () => {
    const tabId = await targetTabId();
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lens.js"] });
    if (!new URLSearchParams(location.search).get("tab")) window.close();
  });
  $("boardExportBtn").addEventListener("click", async () => {
    try {
      const response = await send({ type: "BOARD_EXPORT" });
      status(boardStatus, `Moodboard exporté : ${response.filename} (${response.fileCount} fichiers).`);
    } catch (error) {
      status(boardStatus, error.message, true);
    }
  });
  $("boardClearBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.dataset.confirm !== "1") {
      button.dataset.confirm = "1";
      button.textContent = "Confirmer";
      setTimeout(() => {
        button.dataset.confirm = "";
        button.textContent = "Vider";
      }, 4000);
      return;
    }
    button.dataset.confirm = "";
    button.textContent = "Vider";
    board = (await send({ type: "BOARD_CLEAR" })).board;
    render();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "BOARD_CHANGED") send({ type: "BOARD_STATE" }).then((response) => ((board = response.board), render()));
  });
  const load = () => send({ type: "BOARD_STATE" }).then((response) => ((board = response.board), render())).catch(() => {});
  load();
  return { open: load };
}

export function initInsight({ getNormalized }) {
  const refreshMemory = initMemory();
  initRating(refreshMemory);
  initA11y({ getNormalized });
}
