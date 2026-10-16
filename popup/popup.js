import "./panel.js";
import { computeDesignScore } from "../lib/generate-design-md.mjs";
import { initViews } from "./views.js";
import { initBrandKit } from "./brand.js";
import { initInsight } from "./insight.js";
import { parseConnectionString } from "../lib/ai-client.mjs";

// popup.html?tab=<id> (detached window, E2E) targets that tab instead of the active one.
function pinnedTabId() {
  return Number(new URLSearchParams(location.search).get("tab")) || undefined;
}

const PROVIDERS_WITH_BASE_URL = ["custom", "newapi"];

const state = {
  markdown: "",
  filename: "",
  mode: "design",
  busy: false,
  lastResult: null,
  proMarkdown: "",
  // "site" = the active tab, "figma" = the imported Figma file.
  source: "site"
};

const QUICK_INSTALL_PROVIDERS = {
  claude: {
    label: "Claude Code",
    targetDir: ".claude/skills/design-system"
  },
  codex: {
    label: "Codex",
    targetDir: ".agents/skills/design-system"
  },
  cursor: {
    label: "Cursor",
    targetDir: ".cursor/skills/design-system"
  }
};

const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const exportTailwindBtn = document.getElementById("exportTailwindBtn");
const exportW3cBtn = document.getElementById("exportW3cBtn");
const exportCssBtn = document.getElementById("exportCssBtn");
const exportScssBtn = document.getElementById("exportScssBtn");
const diffBtn = document.getElementById("diffBtn");
const mcpBtn = document.getElementById("mcpBtn");
const platformBtn = document.getElementById("platformBtn");
platformBtn?.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "PLATFORM_ZIP", normalized: state.lastResult?.normalized });
    if (!response?.ok) throw new Error(response?.error || "Export impossible.");
    setStatus(`Exports natifs : ${response.filename} (${response.fileCount} fichiers — SwiftUI, Compose, Flutter, Tailwind v4, Storybook, WordPress, motion, règles d'agent).`, false);
  } catch (error) {
    setStatus(toErrorText(error), true);
  }
});
const refreshBtn = document.getElementById("refreshBtn");
const downloadBtn = document.getElementById("downloadBtn");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const copyBtn = document.getElementById("copyBtn");
const copySiteBtn = document.getElementById("copySiteBtn");
const quickInstallButtons = Array.from(document.querySelectorAll(".quick-install-btn"));
const quickInstallResultEl = document.getElementById("quickInstallResult");
const helpBtn = document.getElementById("helpBtn");
const helpPanel = document.getElementById("helpPanel");
const helpContentEl = document.getElementById("helpContent");
const closeHelpBtn = document.getElementById("closeHelpBtn");
const previewEl = document.getElementById("preview");
const statusEl = document.getElementById("status");
const issuesEl = document.getElementById("issues");

refreshBtn.addEventListener("click", () => {
  runExtraction().catch((error) => setStatus(toErrorText(error), true));
});

for (const button of modeButtons) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;
    if (!mode || mode === state.mode) {
      return;
    }
    state.mode = mode;
    syncModeUi();
    runExtraction().catch((error) => setStatus(toErrorText(error), true));
  });
}

for (const button of quickInstallButtons) {
  button.addEventListener("click", () => {
    const providerId = button.dataset.provider;
    installQuick(providerId).catch((error) => {
      setQuickInstallResult(`Quick install failed: ${toErrorText(error)}`, true);
    });
  });
}

downloadBtn.addEventListener("click", () => {
  downloadCurrent().catch((error) => setStatus(toErrorText(error), true));
});

if (downloadJsonBtn) {
  downloadJsonBtn.addEventListener("click", () => {
    downloadTokensJson().catch((error) => setStatus(toErrorText(error), true));
  });
}

helpBtn.addEventListener("click", () => {
  const shouldOpen = helpPanel.hidden;
  helpPanel.hidden = !shouldOpen;
  if (shouldOpen) {
    renderGenerationExplanation();
  }
});

closeHelpBtn.addEventListener("click", () => {
  helpPanel.hidden = true;
});

copyBtn.addEventListener("click", async () => {
  try {
    const text = state.mode === "pro" ? state.proMarkdown : state.markdown;
    if (!text) {
      setStatus("Nothing to copy yet.", true);
      return;
    }
    await navigator.clipboard.writeText(text);
    
    copyBtn.classList.add("copied");
    const copyIcon = copyBtn.querySelector(".icon-copy");
    const successIcon = copyBtn.querySelector(".icon-success");
    if (copyIcon && successIcon) {
      copyIcon.hidden = true;
      successIcon.hidden = false;
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyIcon.hidden = false;
        successIcon.hidden = true;
      }, 2000);
    }
  } catch (error) {
    setStatus(`Copy failed: ${toErrorText(error)}`, true);
  }
});

if (copySiteBtn) {
  copySiteBtn.addEventListener("click", () => {
    runCopySite().catch((error) => setStatus(toErrorText(error), true));
  });
}

if (exportTailwindBtn) {
  exportTailwindBtn.addEventListener("click", () => {
    exportGeneratedTokens("tailwind").catch((error) => setStatus(toErrorText(error), true));
  });
}

for (const [button, kind] of [[exportCssBtn, "css"], [exportScssBtn, "scss"]]) {
  button?.addEventListener("click", () => {
    exportGeneratedTokens(kind).catch((error) => setStatus(toErrorText(error), true));
  });
}

if (exportW3cBtn) {
  exportW3cBtn.addEventListener("click", () => {
    exportGeneratedTokens("w3c").catch((error) => setStatus(toErrorText(error), true));
  });
}

if (diffBtn) {
  diffBtn.addEventListener("click", () => {
    downloadDiffWithPrevious().catch((error) => setStatus(toErrorText(error), true));
  });
}

if (mcpBtn) {
  mcpBtn.addEventListener("click", () => {
    sendToMcp().catch((error) => setStatus(toErrorText(error), true));
  });
}

const assetsZipBtn = document.getElementById("assetsZipBtn");
if (assetsZipBtn) {
  assetsZipBtn.addEventListener("click", () => {
    runDownloadAssets().catch((error) => setStatus(toErrorText(error), true));
  });
}

const starterKitBtn = document.getElementById("starterKitBtn");
if (starterKitBtn) {
  starterKitBtn.addEventListener("click", () => {
    runDownloadStarterKit().catch((error) => setStatus(toErrorText(error), true));
  });
}

/* ---------------- PROMPT PRO ---------------- */

const PRO_PLACEHOLDER = [
  "PROMPT PRO — le design mesuré de ce site, appliqué à TON projet.",
  "",
  "1. Décris ton projet ci-dessus (offre, audience, sections, ton) ou importe un brief .md/.txt.",
  "2. Choisis un fournisseur IA et colle ta clé — ou le JSON de connexion d'une passerelle",
  "   (MiaRouter, One API…). La clé reste sur cet ordinateur.",
  "3. Clique « Générer PROMPT_PRO.md » : la progression s'affiche en direct, et le résultat",
  "   est conservé même si tu fermes le popup.",
  "",
  "Sans clé, le moteur local Keys_Osi produit la même structure (13 blocs, recettes motion",
  "chiffrées, accessibilité, critères de fin) à partir des mesures du site."
].join("\n");

function renderProPreview() {
  previewEl.value = state.proMarkdown || PRO_PLACEHOLDER;
  const hasResult = Boolean(state.proMarkdown);
  downloadBtn.disabled = !hasResult;
  copyBtn.disabled = !hasResult;
}

async function loadProSettings() {
  try {
    const data = await chrome.storage.local.get(["promptProSettings"]);
    const settings = data.promptProSettings || {};
    const provider = document.getElementById("proProvider");
    const model = document.getElementById("proModel");
    const baseUrl = document.getElementById("proBaseUrl");
    const apiKey = document.getElementById("proApiKey");
    if (provider && settings.provider) provider.value = settings.provider;
    if (model) model.value = settings.model || "";
    if (baseUrl) {
      baseUrl.value = settings.baseUrl || "";
      baseUrl.hidden = !PROVIDERS_WITH_BASE_URL.includes(provider?.value || "groq");
    }
    if (apiKey) apiKey.value = settings.apiKey || "";
    const priority = document.getElementById("proPriority");
    if (priority) priority.value = settings.priority || "quality";
  } catch (error) {}
}

async function saveProSettings() {
  const provider = document.getElementById("proProvider");
  const baseUrl = document.getElementById("proBaseUrl");
  if (baseUrl && provider) {
    baseUrl.hidden = !PROVIDERS_WITH_BASE_URL.includes(provider.value);
  }
  await chrome.storage.local.set({
    promptProSettings: {
      provider: provider?.value || "groq",
      model: document.getElementById("proModel")?.value.trim() || "",
      baseUrl: baseUrl?.value.trim() || "",
      apiKey: document.getElementById("proApiKey")?.value.trim() || "",
      priority: document.getElementById("proPriority")?.value || "quality"
    }
  });
}

function proVisionEnabled() {
  const chk = document.getElementById("proVisionChk");
  return Boolean(chk && chk.checked);
}

async function runGenerateCode() {
  if (state.busy) return;
  const framework = document.getElementById("codeFramework")?.value || "react";
  setBusy(true);
  setProStatus(`Génération du code ${framework} en cours...`);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_CODE",
      framework,
      vision: proVisionEnabled()
    });
    if (!response || !response.ok) {
      throw new Error(response?.error || "Génération de code échouée.");
    }
    setProStatus(`Code exporté : ${response.path} (${response.fileCount} fichiers, via ${response.engine}).`);
  } finally {
    setBusy(false);
  }
}

async function runRenameTokens() {
  if (state.busy || !state.lastResult?.normalized) {
    setProStatus("Lance d'abord une extraction.", true);
    return;
  }
  setBusy(true);
  setProStatus("Renommage sémantique des tokens (IA)...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "RENAME_TOKENS",
      normalized: state.lastResult.normalized
    });
    if (!response || !response.ok) {
      throw new Error(response?.error || "Renommage échoué.");
    }
    const text = JSON.stringify(response.renameMap, null, 2);
    const dl = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_TEXT",
      filename: "token-rename-map.json",
      text,
      mime: "application/json"
    });
    if (!dl || !dl.ok) throw new Error(dl?.error || "Téléchargement échoué.");
    setProStatus(`Carte de renommage générée (${Object.keys(response.renameMap).length} tokens) — token-rename-map.json.`);
  } finally {
    setBusy(false);
  }
}

async function runFidelityBaseline() {
  setProStatus("Capture de la référence...");
  const response = await chrome.runtime.sendMessage({ type: "FIDELITY_BASELINE" });
  if (!response || !response.ok) {
    setProStatus(response?.error || "Capture échouée.", true);
    return;
  }
  setProStatus("Référence capturée. Ouvre ta reproduction et clique « Comparer la fidélité ».");
}

async function runFidelityCompare() {
  if (state.busy) return;
  setBusy(true);
  setProStatus("Comparaison en cours (SSIM + analyse)...");
  try {
    const response = await chrome.runtime.sendMessage({ type: "FIDELITY_COMPARE" });
    if (!response || !response.ok) {
      throw new Error(response?.error || "Comparaison échouée.");
    }
    let text = `Fidélité mesurée : ${response.percent}% (${response.label}).`;
    if (response.critique) {
      text += `\nÉcarts à corriger :\n${response.critique}`;
    }
    previewEl.value = text;
    setProStatus(`Fidélité : ${response.percent}% (${response.label}).`);
  } finally {
    setBusy(false);
  }
}

for (const [id, handler] of [
  ["genCodeBtn", runGenerateCode],
  ["renameTokensBtn", runRenameTokens],
  ["fidelityBaselineBtn", runFidelityBaseline],
  ["fidelityCompareBtn", runFidelityCompare]
]) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("click", () => {
      handler().catch((error) => setProStatus(toErrorText(error), true));
    });
  }
}

// A gateway connection string ({"_type":"newapi_channel_conn","key":..,"url":..})
// pasted into the key or URL field fills provider + base URL + key at once.
for (const id of ["proBaseUrl", "proApiKey"]) {
  document.getElementById(id)?.addEventListener("input", (event) => {
    const conn = parseConnectionString(event.target.value);
    if (!conn) return;
    document.getElementById("proProvider").value = conn.provider;
    document.getElementById("proBaseUrl").value = conn.baseUrl;
    document.getElementById("proApiKey").value = conn.apiKey;
    saveProSettings()
      .then(() =>
        setProStatus(
          conn.apiKey
            ? `Connexion importée : ${conn.baseUrl}. Clique « Modèles » pour lister les modèles.`
            : `URL importée : ${conn.baseUrl}. La clé du JSON est vide : colle ta clé API.`,
          !conn.apiKey
        )
      )
      .catch(() => {});
  });
}

// Complete briefs: append one or more .md/.txt files to the description.
const proDescriptionEl = document.getElementById("proDescription");
const updateBriefCount = () => {
  const counter = document.getElementById("proBriefCount");
  if (counter) counter.textContent = proDescriptionEl.value ? `${proDescriptionEl.value.length.toLocaleString("fr-FR")} caractères` : "";
};
// The draft survives the popup closing (e.g. while a file picker is open).
let briefSaveTimer = null;
const saveBriefDraft = () => {
  clearTimeout(briefSaveTimer);
  briefSaveTimer = setTimeout(() => chrome.storage.local.set({ keysOsiBriefDraft: proDescriptionEl.value }).catch(() => {}), 300);
};
chrome.storage.local.get("keysOsiBriefDraft").then(({ keysOsiBriefDraft }) => {
  if (keysOsiBriefDraft && proDescriptionEl && !proDescriptionEl.value) {
    proDescriptionEl.value = keysOsiBriefDraft;
    updateBriefCount();
  }
});
const appendBriefFiles = async (files) => {
  for (const file of files) {
    if (!/\.(md|markdown|txt)$/i.test(file.name) && !file.type.startsWith("text/")) continue;
    const text = (await file.text()).trim();
    if (text) proDescriptionEl.value = `${proDescriptionEl.value.trim()}\n\n--- ${file.name} ---\n${text}`.trim();
  }
  updateBriefCount();
  saveBriefDraft();
};
proDescriptionEl?.addEventListener("input", () => {
  updateBriefCount();
  saveBriefDraft();
});
proDescriptionEl?.addEventListener("dragover", (event) => event.preventDefault());
proDescriptionEl?.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  appendBriefFiles(event.dataTransfer.files).catch((error) => setProStatus(toErrorText(error), true));
});
document.getElementById("proBriefBtn")?.addEventListener("click", () => document.getElementById("proBriefFile").click());
document.getElementById("proBriefFile")?.addEventListener("change", (event) => {
  appendBriefFiles(event.target.files)
    .catch((error) => setProStatus(toErrorText(error), true))
    .finally(() => {
      event.target.value = "";
    });
});

document.getElementById("proListModelsBtn")?.addEventListener("click", async () => {
  try {
    await saveProSettings();
    setProStatus("Lecture des modèles de l'endpoint...");
    const response = await chrome.runtime.sendMessage({ type: "LIST_AI_MODELS" });
    if (!response || !response.ok) throw new Error(response?.error || "Liste des modèles indisponible.");
    const list = document.getElementById("proModelList");
    list.replaceChildren(...response.models.map((id) => Object.assign(document.createElement("option"), { value: id })));
    const modelInput = document.getElementById("proModel");
    if (!modelInput.value && response.best) {
      modelInput.value = response.best;
      await saveProSettings();
    }
    const measured = Object.entries(response.stats || {})
      .filter(([, s]) => s.runs > 0)
      .sort(([, a], [, b]) => a.totalMs / a.runs - b.totalMs / b.runs)
      .map(([id, s]) => `${id} ≈ ${Math.round(s.totalMs / s.runs / 1000)} s (${s.runs} réussite${s.runs > 1 ? "s" : ""}${s.fails ? `, ${s.fails} échec${s.fails > 1 ? "s" : ""}` : ""})`);
    setProStatus(`${response.models.length} modèles disponibles. Sélectionné : ${modelInput.value || response.best}.${measured.length ? ` Mesuré ici : ${measured.join(" · ")}.` : ""}`);
  } catch (error) {
    setProStatus(toErrorText(error), true);
  }
});

for (const id of ["proProvider", "proModel", "proBaseUrl", "proApiKey", "proPriority"]) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("change", () => {
      saveProSettings().catch(() => {});
    });
  }
}

const proGenerateBtn = document.getElementById("proGenerateBtn");
if (proGenerateBtn) {
  proGenerateBtn.addEventListener("click", () => {
    runGeneratePromptPro().catch((error) => setProStatus(toErrorText(error), true));
  });
}

function setProStatus(text, isError = false) {
  const el = document.getElementById("proStatus");
  if (!el) return;
  const value = String(text || "").trim();
  el.hidden = !value;
  el.textContent = value;
  el.classList.toggle("is-error", Boolean(isError));
}

// Live steps streamed by the service worker during PROMPT_PRO generation.
const PRO_STEPS = {
  extract: "1/3 · Extraction du design du site",
  vision: "2/3 · Captures des sections (vision)",
  ai: "2/3 · Connexion à l'IA",
  think: "3/3 · L'IA réfléchit à ton projet",
  stream: "3/3 · L'IA écrit le PROMPT_PRO",
  done: "Terminé"
};
let proRun = null;

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "PRO_PROGRESS" || !proRun) return;
  proRun.step = message.step;
  if (message.chars) proRun.chars = message.chars;
  if (message.reasoning) proRun.reasoning = message.reasoning;
  if (message.round) proRun.round = message.round;
  if (message.model) proRun.model = message.model;
  renderProProgress();
});

function renderProProgress() {
  if (!proRun) return;
  const seconds = Math.round((Date.now() - proRun.startedAt) / 1000);
  const parts = [PRO_STEPS[proRun.step] || "Préparation", `${seconds} s`];
  if (proRun.step === "think" && proRun.reasoning) parts.push(`${proRun.reasoning.toLocaleString("fr-FR")} caractères de réflexion`);
  if (proRun.chars) parts.push(`${proRun.chars.toLocaleString("fr-FR")} caractères écrits`);
  if (proRun.round) parts.push(`suite ${proRun.round}`);
  if (proRun.step === "ai" && proRun.model) parts.push(`modèle : ${proRun.model}`);
  setProStatus(`⏳ ${parts.join(" · ")}`);
}

async function runGeneratePromptPro() {
  if (state.busy) {
    return;
  }
  const description = document.getElementById("proDescription")?.value || "";
  await saveProSettings();
  setBusy(true);
  proRun = { startedAt: Date.now(), step: "extract", chars: 0, model: "" };
  renderProProgress();
  const ticker = setInterval(renderProProgress, 1000);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_PROMPT_PRO",
      source: state.source,
      tabId: pinnedTabId(),
      projectDescription: description,
      vision: proVisionEnabled(),
      useBrand: document.getElementById("proUseBrand")?.checked !== false,
      useBoard: document.getElementById("proUseBoard")?.checked !== false,
      useSite: document.getElementById("proUseSite")?.checked !== false
    });
    if (!response) {
      throw new Error("Le service worker Keys_Osi ne répond pas : recharge l'extension (chrome://extensions → ↻).");
    }
    if (!response.ok) {
      throw new Error(response.error || "Génération échouée.");
    }
    const result = response.pending ? await waitForProResult(response.jobId, proRun.startedAt) : response;
    state.proMarkdown = result.markdown;
    renderProPreview();
    const seconds = Math.round((Date.now() - proRun.startedAt) / 1000);
    const contextNote = result.context?.length ? ` Contexte : ${result.context.map((title) => title.split(" (")[0].toLowerCase()).join(", ")}.` : "";
    const missingNote = result.missingSections?.length ? ` Sections absentes notées en mémoire : ${result.missingSections.join(", ")}.` : "";
    setProStatus(
      `✓ PROMPT_PRO.md prêt en ${seconds} s via ${result.engine} (${result.markdown.length.toLocaleString("fr-FR")} caractères).${contextNote}${missingNote}${result.warning ? ` ⚠ ${result.warning}` : ""}`,
      Boolean(result.warning)
    );
    document.dispatchEvent(new CustomEvent("keysosi:result", { detail: { feature: "pro", model: result.engine } }));
  } finally {
    clearInterval(ticker);
    proRun = null;
    setBusy(false);
  }
}

// Long AI runs finish in the offscreen document: wait for PRO_DONE, with a
// storage poll as a safety net if the message is missed.
function waitForProResult(jobId, startedAt) {
  return new Promise((resolve) => {
    const finish = (result) => {
      chrome.runtime.onMessage.removeListener(onDone);
      clearInterval(poll);
      resolve(result);
    };
    const onDone = (message) => {
      if (message?.type === "PRO_DONE" && message.jobId === jobId) finish(message.result);
    };
    chrome.runtime.onMessage.addListener(onDone);
    const poll = setInterval(async () => {
      const { keysOsiLastPro } = await chrome.storage.local.get("keysOsiLastPro");
      if (keysOsiLastPro && Date.parse(keysOsiLastPro.at) >= startedAt) finish(keysOsiLastPro);
    }, 3000);
  });
}

// A generation finished while the popup was closed: show it again.
async function restoreLastPromptPro() {
  // A generation is still running in the background: resume its progress.
  const { keysOsiProJob } = await chrome.storage.session.get("keysOsiProJob").catch(() => ({}));
  if (keysOsiProJob?.jobId && !state.busy) {
    setBusy(true);
    proRun = { startedAt: Date.now(), step: "think", chars: 0, model: "" };
    renderProProgress();
    const ticker = setInterval(renderProProgress, 1000);
    waitForProResult(keysOsiProJob.jobId, 0)
      .then((result) => {
        state.proMarkdown = result.markdown;
        renderProPreview();
        setProStatus(`✓ PROMPT_PRO.md prêt via ${result.engine}.${result.warning ? ` ⚠ ${result.warning}` : ""}`, Boolean(result.warning));
      })
      .finally(() => {
        clearInterval(ticker);
        proRun = null;
        setBusy(false);
      });
    return;
  }
  const { keysOsiLastPro } = await chrome.storage.local.get("keysOsiLastPro");
  if (!keysOsiLastPro?.markdown || state.proMarkdown) return;
  state.proMarkdown = keysOsiLastPro.markdown;
  if (state.mode === "pro") {
    renderProPreview();
    setProStatus(`Dernier PROMPT_PRO.md (${new Date(keysOsiLastPro.at).toLocaleString("fr-FR")}, ${keysOsiLastPro.engine}).`);
  }
}

async function runDownloadStarterKit() {
  if (state.busy) {
    return;
  }
  setBusy(true);
  setStatus("Génération du starter kit (tokens, composants, preview)...", false);
  try {
    const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_STARTER_KIT" });
    if (!response || !response.ok) {
      throw new Error(response?.error || "Starter kit generation failed.");
    }
    setStatus(`Starter kit exporté : ${response.path} (${response.fileCount} fichiers — ouvre components.html pour la preview)`, false);
  } catch (error) {
    setStatus(`Erreur starter kit : ${toErrorText(error)}`, true);
  } finally {
    setBusy(false);
  }
}

async function runDownloadAssets() {
  if (state.busy) {
    return;
  }
  setBusy(true);
  setStatus("Extraction des polices, CSS, JS et couleurs en cours...", false);
  try {
    const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_ASSETS" });
    if (!response || !response.ok) {
      throw new Error(response?.error || "Assets download failed.");
    }
    const skippedNote = response.skipped > 0 ? `, ${response.skipped} fichiers ignorés` : "";
    setStatus(`Assets exportés : ${response.path} (${response.fileCount} fichiers${skippedNote})`, false);
  } catch (error) {
    setStatus(`Erreur d'export des assets : ${toErrorText(error)}`, true);
  } finally {
    setBusy(false);
  }
}

init().catch((error) => setStatus(`Init failed: ${toErrorText(error)}`, true));

// Unpacked installs only re-read manifest.json (version, permissions such
// as webRequest) on reload: when the files on disk are newer than the
// running extension, reload it so new permissions take effect.
async function reloadIfManifestChanged() {
  try {
    // Only unpacked (developer) installs: store builds update through Chrome.
    const self = await chrome.management.getSelf();
    if (self.installType !== "development") return false;
    const onDisk = await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json();
    if (onDisk.version && onDisk.version !== chrome.runtime.getManifest().version) {
      setStatus(`Mise à jour Keys_Osi ${chrome.runtime.getManifest().version} → ${onDisk.version} : rechargement…`, false);
      setTimeout(() => chrome.runtime.reload(), 400);
      return true;
    }
  } catch (error) {}
  return false;
}

async function init() {
  if (await reloadIfManifestChanged()) {
    return;
  }
  const versionEl = document.getElementById("appVersion");
  if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  const data = await chrome.storage.local.get(["outputMode", "keysOsiSource"]);
  state.source = data.keysOsiSource === "figma" ? "figma" : "site";
  state.mode = ["skill", "json", "motion", "prompt", "pro"].includes(data.outputMode) ? data.outputMode : "design";
  await loadProSettings();
  await restoreLastPromptPro().catch(() => {});
  initViews({
    getSource: () => state.source,
    setSource: async (source) => {
      state.source = source === "figma" ? "figma" : "site";
      await chrome.storage.local.set({ keysOsiSource: state.source });
      // An extraction may be running (popup opening): regenerate after it.
      for (let waited = 0; state.busy && waited < 120000; waited += 150) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      await runExtraction();
    },
    getNormalized: () => state.lastResult?.normalized || null,
    setNormalized: (result) => {
      state.lastResult = result;
      setExportButtonsEnabled(!state.busy);
    }
  });
  syncModeUi();
  updateQuickInstallUi();
  initBrandKit({ getDescription: () => document.getElementById("proDescription")?.value || "" });
  initInsight({ getNormalized: () => state.lastResult?.normalized || null });
  await runExtraction();
}

async function runExtraction() {
  if (state.busy) {
    return;
  }
  if (state.mode === "pro") {
    chrome.storage.local.set({ outputMode: "pro" }).catch(() => {});
    renderProPreview();
    return;
  }
  setBusy(true);
  clearStatus();
  issuesEl.innerHTML = "";

  const progressEl = document.getElementById("extractionProgress");
  const stepConnect = document.getElementById("step-connect");
  const stepExtract = document.getElementById("step-extract");
  const stepNormalize = document.getElementById("step-normalize");
  const stepAssemble = document.getElementById("step-assemble");

  const setStep = (el, status) => {
    if (!el) return;
    el.classList.remove("active", "completed");
    if (status === "active") el.classList.add("active");
    if (status === "completed") el.classList.add("completed");
  };

  if (progressEl) {
    progressEl.hidden = false;
    setStep(stepConnect, "active");
    setStep(stepExtract, "");
    setStep(stepNormalize, "");
    setStep(stepAssemble, "");
  }

  try {
    await new Promise((r) => setTimeout(r, 200));
    setStep(stepConnect, "completed");
    setStep(stepExtract, "active");

    const responsePromise = chrome.runtime.sendMessage({
      type: "RUN_EXTRACTION",
      source: state.source,
      tabId: pinnedTabId(),
      mode: state.mode
    });

    await new Promise((r) => setTimeout(r, 350));
    setStep(stepExtract, "completed");
    setStep(stepNormalize, "active");

    const response = await responsePromise;

    await new Promise((r) => setTimeout(r, 300));
    setStep(stepNormalize, "completed");
    setStep(stepAssemble, "active");

    await new Promise((r) => setTimeout(r, 250));
    setStep(stepAssemble, "completed");
    await new Promise((r) => setTimeout(r, 150));

    if (!response || !response.ok) {
      throw new Error(response?.error || "Extraction request failed.");
    }

    state.markdown = response.markdown;
    state.filename = response.filename;
    state.lastResult = response;

    previewEl.value = response.markdown;
    downloadBtn.disabled = false;
    downloadJsonBtn.disabled = false;
    copyBtn.disabled = false;
    setExportButtonsEnabled(true);

    renderValidationIssues(response.validation);
    clearStatus();
    if (response.selfCheck?.length) {
      setStatus(`Auto-contrôle : ${response.selfCheck.map((issue) => issue.message).join(" · ")} (noté en mémoire).`, true);
    }
    document.dispatchEvent(new CustomEvent("keysosi:result", { detail: { feature: state.mode, normalized: response.normalized, source: state.source } }));
    clearQuickInstallResult();
    updateQuickInstallUi();
    if (!helpPanel.hidden) {
      renderGenerationExplanation();
    }
  } catch (error) {
    if (progressEl) {
      progressEl.hidden = true;
    }
    throw error;
  } finally {
    setBusy(false);
    if (progressEl) {
      setTimeout(() => {
        progressEl.hidden = true;
      }, 1000);
    }
  }
}

async function downloadCurrent() {
  if (state.mode === "pro" && !state.proMarkdown) {
    setStatus("Génère d'abord ton PROMPT_PRO.md.", true);
    return;
  }
  if (state.mode !== "pro" && (!state.markdown || !state.filename)) {
    setStatus("Nothing to download yet.", true);
    return;
  }

  const response =
    state.mode === "pro"
      ? await chrome.runtime.sendMessage({
          type: "DOWNLOAD_TEXT",
          filename: "PROMPT_PRO.md",
          text: state.proMarkdown,
          mime: "text/markdown"
        })
      : state.mode === "json"
      ? await chrome.runtime.sendMessage({
          type: "DOWNLOAD_TEXT",
          filename: state.filename,
          text: state.markdown,
          mime: "application/json"
        })
      : await chrome.runtime.sendMessage({
          type: "DOWNLOAD_MARKDOWN",
          mode: state.mode,
          filename: state.filename,
          markdown: state.markdown
        });

  if (!response || !response.ok) {
    throw new Error(response?.error || "Download failed.");
  }
  clearStatus();
}

function setBusy(isBusy) {
  state.busy = isBusy;
  refreshBtn.disabled = isBusy;
  if (copySiteBtn) {
    copySiteBtn.disabled = isBusy;
  }
  if (downloadJsonBtn) {
    downloadJsonBtn.disabled = isBusy || !state.lastResult;
  }
  setExportButtonsEnabled(!isBusy && Boolean(state.lastResult));
  const assetsBtn = document.getElementById("assetsZipBtn");
  if (assetsBtn) {
    assetsBtn.disabled = isBusy;
  }
  for (const button of modeButtons) {
    button.disabled = isBusy;
  }
  updateQuickInstallUi();
}

function setExportButtonsEnabled(enabled) {
  for (const button of [exportTailwindBtn, exportW3cBtn, exportCssBtn, exportScssBtn, diffBtn, mcpBtn, platformBtn]) {
    if (button) {
      button.disabled = !enabled;
    }
  }
}

async function exportGeneratedTokens(kind) {
  if (!state.lastResult || !state.lastResult.normalized) {
    setStatus("Nothing to export yet.", true);
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "EXPORT_TOKENS",
    normalized: state.lastResult.normalized
  });
  if (!response || !response.ok) {
    throw new Error(response?.error || "Token export failed.");
  }

  const siteName = String(state.lastResult.normalized.source?.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30) || "design";

  const download = {
    tailwind: { filename: "tailwind.config.js", text: response.tailwindConfig, mime: "text/javascript" },
    css: { filename: "tokens.css", text: response.cssVariables, mime: "text/css" },
    scss: { filename: "_tokens.scss", text: response.scss, mime: "text/x-scss" },
    w3c: { filename: `${siteName}.tokens.json`, text: response.w3cTokens, mime: "application/json" }
  }[kind];

  const result = await chrome.runtime.sendMessage({ type: "DOWNLOAD_TEXT", ...download });
  if (!result || !result.ok) {
    throw new Error(result?.error || "Download failed.");
  }
  setStatus(`${download.filename} exporté.`, false);
}

async function downloadDiffWithPrevious() {
  if (!state.lastResult || !state.lastResult.normalized) {
    setStatus("Nothing to compare yet.", true);
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "DIFF_WITH_PREVIOUS",
    normalized: state.lastResult.normalized
  });
  if (!response || !response.ok) {
    throw new Error(response?.error || "Diff failed.");
  }
  const result = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_TEXT",
    filename: "DIFF.md",
    text: response.markdown,
    mime: "text/markdown"
  });
  if (!result || !result.ok) {
    throw new Error(result?.error || "Download failed.");
  }
  setStatus(`DIFF.md généré (comparé à l'extraction du ${response.beforeDate}).`, false);
}

async function sendToMcp() {
  if (!state.lastResult || !state.lastResult.normalized) {
    setStatus("Nothing to send yet.", true);
    return;
  }
  setStatus("Envoi vers le bridge MCP local (127.0.0.1:8765)...", false);

  let designMarkdown = state.mode === "design" ? state.markdown : "";
  let skillMarkdown = state.mode === "skill" ? state.markdown : "";
  if (!designMarkdown) {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_EXTRACTION",
      source: state.source,
      tabId: pinnedTabId(),
      mode: "design",
      persistOutputMode: false
    });
    designMarkdown = response?.markdown || "";
  }
  if (!skillMarkdown) {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_EXTRACTION",
      source: state.source,
      tabId: pinnedTabId(),
      mode: "skill",
      persistOutputMode: false
    });
    skillMarkdown = response?.markdown || "";
  }

  const response = await chrome.runtime.sendMessage({
    type: "SEND_TO_MCP",
    normalized: state.lastResult.normalized,
    designMarkdown,
    skillMarkdown
  });
  if (!response || !response.ok) {
    throw new Error(response?.error || "MCP send failed.");
  }
  setStatus("Extraction envoyée au serveur MCP — accessible depuis Claude Code / Cursor.", false);
}

function renderValidationIssues(validation) {
  issuesEl.innerHTML = "";
  if (!validation) {
    issuesEl.hidden = true;
    return;
  }

  const issues = [
    ...(validation.errors || []),
    ...(validation.warnings || [])
  ];

  if (issues.length === 0) {
    issuesEl.hidden = true;
    return;
  }

  issuesEl.hidden = false;
  for (const issue of issues) {
    const item = document.createElement("li");
    item.textContent = issue;
    issuesEl.appendChild(item);
  }
}

function setStatus(text, isError = false) {
  const value = String(text || "").trim();
  if (!value) {
    clearStatus();
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = value;
  statusEl.classList.toggle("is-error", Boolean(isError));
}

function toErrorText(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "Unknown error");
}

function syncModeUi() {
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", isActive);
  }
  const proPanel = document.getElementById("proPanel");
  if (proPanel) {
    proPanel.hidden = state.mode !== "pro";
  }
  if (state.mode === "pro") {
    renderProPreview();
  }
  clearQuickInstallResult();
  updateQuickInstallUi();
  if (!helpPanel.hidden) {
    renderGenerationExplanation();
  }
}

function renderGenerationExplanation() {
  const modeLabels = {
    skill: "SKILL.md",
    json: "design-system.json",
    motion: "MOTION.md",
    prompt: "PROMPT.md",
    pro: "PROMPT_PRO.md",
    design: "DESIGN.md"
  };
  const modeLabel = modeLabels[state.mode] || "DESIGN.md";
  const result = state.lastResult;

  if (!result) {
    helpContentEl.innerHTML = `
      <p>No extraction result is loaded yet.</p>
      <p>Run extraction and open this panel again for a full breakdown.</p>
      <p>
        The format is the Keys_Osi DESIGN.md blueprint (YAML tokens + narrative + agent guide).
      </p>
    `;
    return;
  }

  const normalized = result.normalized || {};
  const siteProfile = normalized.siteProfile || {};
  const checks = result.validation?.checks || [];
  const passedChecks = checks.filter((item) => item.ok).length;

  const summary = {
    sampledElements: normalized.sampledElements ?? "n/a",
    totalElements: normalized.totalElements ?? "n/a",
    typographyTokens: (normalized.typographyScale || []).length,
    colorTokens: (normalized.colorPalette || []).length,
    spacingTokens: (normalized.spacingScale || []).length,
    gradientTokens: (normalized.gradientTokens || []).length,
    shadowTokens: (normalized.shadowTokens || []).length,
    keyframes: (normalized.keyframes || []).length,
    interactionRules: (normalized.interactionStyles || []).length,
    breakpoints: (normalized.breakpoints || []).length,
    runtimeAnimations: (normalized.runtimeAnimations || []).length,
    headings: (normalized.headings || []).length,
    buttonVariants: (normalized.buttonVariants || []).length
  };

  const stackNames = (normalized.stack || []).map((item) => item.name).join(", ");
  const fontFaceCount = normalized.resources?.fontFaces?.length || 0;

  let scoreHtml = "";
  try {
    const { score, breakdown } = computeDesignScore(normalized);
    scoreHtml = `<li><strong>Design Health Score.</strong> ${escapeHtml(String(score))}/100 — ${escapeHtml(breakdown.slice(0, 3).join("; "))}.</li>`;
  } catch (error) {
    scoreHtml = "";
  }

  const inferenceEvidence = (siteProfile.evidence || []).slice(0, 5).join("; ");
  const inferenceText = siteProfile.audience || siteProfile.productSurface
    ? `Audience "${escapeHtml(siteProfile.audience || "n/a")}" and surface "${escapeHtml(siteProfile.productSurface || "n/a")}" inferred with ${escapeHtml(siteProfile.confidence || "unknown")} confidence.`
    : "Audience and product surface fallback values were used because evidence confidence was low.";

  const conformanceItem =
    state.mode === "json"
      ? "<li><strong>Machine-readable assembly.</strong> The JSON bundles every measurement: tokens with hex/RGB/HSL formats, component specs, layout system, resources inventory, design score, and an embedded W3C Design Tokens document.</li>"
      : `<li><strong>Blueprint assembly & conformance.</strong> Sections are assembled (YAML frontmatter with colors/typography blocks, atmosphere, component specs, agent prompt guide) and validated: ${escapeHtml(String(passedChecks))}/${escapeHtml(String(checks.length))} checks passed.</li>`;

  helpContentEl.innerHTML = `
    <p><strong>${modeLabel}</strong> is generated through a measurement pipeline:</p>
    <ol>
      <li><strong>Deep capture.</strong> ${escapeHtml(String(summary.sampledElements))} elements sampled from ${escapeHtml(String(summary.totalElements))} nodes — including open shadow DOM, constructed stylesheets (adoptedStyleSheets), and same-origin iframes. Captured: ${escapeHtml(String(summary.keyframes))} @keyframes, ${escapeHtml(String(summary.interactionRules))} hover/focus rules, ${escapeHtml(String(summary.breakpoints))} breakpoints, ${escapeHtml(String(summary.runtimeAnimations))} runtime animations, ${escapeHtml(String(fontFaceCount))} @font-face declarations.</li>
      <li><strong>Element precision.</strong> ${escapeHtml(String(summary.headings))} heading levels measured, ${escapeHtml(String(summary.buttonVariants))} button variants clustered into copy-paste CSS specs, form control and link specs, layout system (container width, flex/grid, z-index scale).</li>
      <li><strong>Token normalization.</strong> Colors ${escapeHtml(String(summary.colorTokens))} (clustered, mapped to CSS variables), typography ${escapeHtml(String(summary.typographyTokens))}, spacing ${escapeHtml(String(summary.spacingTokens))}, gradients ${escapeHtml(String(summary.gradientTokens))}, shadows ${escapeHtml(String(summary.shadowTokens))}.</li>
      <li><strong>Profiling.</strong> ${escapeHtml(inferenceText)}${stackNames ? ` Detected stack: ${escapeHtml(stackNames)}.` : ""} ${inferenceEvidence ? `Evidence: ${escapeHtml(inferenceEvidence)}.` : ""}</li>
      ${scoreHtml}
      ${conformanceItem}
    </ol>
    <p>Format: Keys_Osi DESIGN.md blueprint — YAML token frontmatter, measured narrative sections and an agent prompt guide.</p>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.hidden = true;
}

async function installQuick(providerId) {
  const provider = QUICK_INSTALL_PROVIDERS[providerId];
  if (!provider) {
    setQuickInstallResult("Unknown provider.", true);
    return;
  }
  if (state.busy) {
    return;
  }
  clearQuickInstallResult();
  clearStatus();

  const relativePath = `${provider.targetDir}/SKILL.md`;
  setBusy(true);

  try {
    const skillMarkdown = await fetchSkillMarkdownForInstall();

    if (typeof window.showDirectoryPicker !== "function") {
      await fallbackQuickInstall(provider, relativePath, skillMarkdown);
      return;
    }

    try {
      const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      await writeFileToProject(rootHandle, relativePath, skillMarkdown);
      setQuickInstallResult(`Installed for ${provider.label} at ${provider.targetDir}/`);
    } catch (error) {
      if (isAbortError(error)) {
        setQuickInstallResult("Quick install cancelled.");
        return;
      }
      await fallbackQuickInstall(provider, relativePath, skillMarkdown, error);
    }
  } finally {
    setBusy(false);
  }
}

async function fetchSkillMarkdownForInstall() {
  const response = await chrome.runtime.sendMessage({
    type: "RUN_EXTRACTION",
      source: state.source,
      tabId: pinnedTabId(),
    mode: "skill",
    persistOutputMode: false
  });

  if (!response || !response.ok || !response.markdown) {
    throw new Error(response?.error || "Could not generate SKILL.md for quick install.");
  }
  return response.markdown;
}

async function writeFileToProject(rootHandle, relativePath, content) {
  const parts = relativePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error("Invalid target path.");
  }

  let currentDir = rootHandle;
  for (const segment of parts) {
    currentDir = await currentDir.getDirectoryHandle(segment, { create: true });
  }

  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function fallbackQuickInstall(provider, relativePath, skillMarkdown, originalError) {
  let copied = false;
  let downloaded = false;

  try {
    await navigator.clipboard.writeText(skillMarkdown);
    copied = true;
  } catch (_) {
    copied = false;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_MARKDOWN",
      mode: "skill",
      filename: "SKILL.md",
      markdown: skillMarkdown
    });
    downloaded = Boolean(response?.ok);
  } catch (_) {
    downloaded = false;
  }

  if (copied || downloaded) {
    setQuickInstallResult(
      `${copied ? "Copied content." : "Could not copy."} ${downloaded ? "Downloaded SKILL.md." : "Could not auto-download."} Move it to <project>/${relativePath} for ${provider.label}.`,
      false
    );
    return;
  }

  const reason = originalError ? ` (${toErrorText(originalError)})` : "";
  setQuickInstallResult(`Quick install failed${reason}.`, true);
}

function updateQuickInstallUi() {
  const enabled = !state.busy;

  for (const button of quickInstallButtons) {
    button.disabled = !enabled;
  }
}

function setQuickInstallResult(text, isError = false) {
  const value = String(text || "").trim();
  if (!value) {
    clearQuickInstallResult();
    return;
  }

  quickInstallResultEl.hidden = false;
  quickInstallResultEl.textContent = value;
  quickInstallResultEl.classList.toggle("error", Boolean(isError));
}

function clearQuickInstallResult() {
  quickInstallResultEl.hidden = true;
  quickInstallResultEl.textContent = "";
  quickInstallResultEl.classList.remove("error");
}

function isAbortError(error) {
  return error && typeof error === "object" && error.name === "AbortError";
}

async function runCopySite() {
  if (state.busy) {
    return;
  }
  setBusy(true);
  clearStatus();
  setStatus("Clonage et téléchargement du site en cours (HTML + Médias + Scripts)...", false);

  try {
    const staticSnapshotChk = document.getElementById("staticSnapshotChk");
    const screenshotsChk = document.getElementById("screenshotsChk");
    const safeInteractChk = document.getElementById("safeInteractChk");
    const advancedAuditChk = document.getElementById("advancedAuditChk");
    const crawlPagesSelect = document.getElementById("crawlPagesSelect");
    const crawlPages = crawlPagesSelect ? Number(crawlPagesSelect.value) || 0 : 0;

    // The debugger permission is optional and only requested here, from a
    // user gesture, when the advanced audit is explicitly enabled.
    let advancedAudit = Boolean(advancedAuditChk && advancedAuditChk.checked);
    if (advancedAudit) {
      try {
        const granted = await chrome.permissions.request({ permissions: ["debugger"] });
        if (!granted) {
          advancedAudit = false;
          setStatus("Permission refusée — clonage sans audit multi-viewport/dark mode.", false);
        }
      } catch (permError) {
        advancedAudit = false;
      }
    }

    if (crawlPages > 0 || advancedAudit) {
      setStatus("Clonage en cours (pages, screenshots, CSS, polices, audits)... Cela peut prendre une minute.", false);
    }

    const response = await chrome.runtime.sendMessage({
      type: "COPY_SITE",
      staticSnapshot: Boolean(staticSnapshotChk && staticSnapshotChk.checked),
      screenshots: Boolean(screenshotsChk && screenshotsChk.checked),
      safeInteractions: Boolean(safeInteractChk && safeInteractChk.checked),
      advancedAudit,
      crawlPages
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Site copy request failed.");
    }

    const details = [
      `${response.fileCount} fichiers`,
      response.pageCount > 1 ? `${response.pageCount} pages` : null,
      response.screenshotCount > 0 ? `${response.screenshotCount} screenshots` : null,
      response.skipped > 0 ? `${response.skipped} assets ignorés` : null
    ].filter(Boolean).join(", ");

    if (response.packaging === "zip") {
      setStatus(`Site cloné : ${response.path} (${details})`, false);
    } else {
      setStatus(`Site cloné dans /Downloads/${response.path}/ (${details})`, false);
    }
  } catch (error) {
    setStatus(`Erreur de clonage : ${toErrorText(error)}`, true);
  } finally {
    setBusy(false);
  }
}

async function downloadTokensJson() {
  if (!state.lastResult || !state.lastResult.normalized) {
    setStatus("Nothing to download yet.", true);
    return;
  }

  const siteName = String(state.lastResult.normalized.source?.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30) || "design";

  const response = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_JSON",
    filename: `design_tokens_${siteName}.json`,
    data: state.lastResult.normalized
  });

  if (!response || !response.ok) {
    throw new Error(response?.error || "Download failed.");
  }
  clearStatus();
}

// Card spotlight: feeds the pointer position to the CSS radial highlight.
document.addEventListener(
  "pointermove",
  (event) => {
    const card = event.target.closest?.(".format, .agent, .asset-card, .model-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    card.style.setProperty("--my", `${event.clientY - rect.top}px`);
  },
  { passive: true }
);
