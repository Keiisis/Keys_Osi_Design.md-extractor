import { computeDesignScore } from "../lib/generate-design-md.mjs";

const state = {
  markdown: "",
  filename: "",
  mode: "design",
  busy: false,
  lastResult: null,
  proMarkdown: ""
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
const diffBtn = document.getElementById("diffBtn");
const mcpBtn = document.getElementById("mcpBtn");
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
    if (!state.markdown) {
      setStatus("Nothing to copy yet.", true);
      return;
    }
    await navigator.clipboard.writeText(state.markdown);
    
    copyBtn.classList.add("copied");
    const copyIcon = copyBtn.querySelector(".icon-copy");
    const successIcon = copyBtn.querySelector(".icon-success");
    if (copyIcon && successIcon) {
      copyIcon.style.display = "none";
      successIcon.style.display = "block";
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyIcon.style.display = "block";
        successIcon.style.display = "none";
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
  "PROMPT PRO — adapte le design du site courant à TON projet.",
  "",
  "1. Décris ton projet dans le champ ci-dessus (produit, audience, sections, ton).",
  "2. (Recommandé) Configure un fournisseur IA + ta clé API — elle reste stockée",
  "   uniquement sur cet ordinateur (chrome.storage.local), jamais dans le code.",
  "3. Clique « Générer PROMPT_PRO.md ».",
  "",
  "Sans clé API, un moteur local (template) est utilisé. Avec l'IA, le prompt est",
  "entièrement réécrit et adapté : mêmes tokens, même motion, TON contenu."
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
      baseUrl.hidden = (provider?.value || "groq") !== "custom";
    }
    if (apiKey) apiKey.value = settings.apiKey || "";
  } catch (error) {}
}

async function saveProSettings() {
  const provider = document.getElementById("proProvider");
  const baseUrl = document.getElementById("proBaseUrl");
  if (baseUrl && provider) {
    baseUrl.hidden = provider.value !== "custom";
  }
  await chrome.storage.local.set({
    promptProSettings: {
      provider: provider?.value || "groq",
      model: document.getElementById("proModel")?.value.trim() || "",
      baseUrl: baseUrl?.value.trim() || "",
      apiKey: document.getElementById("proApiKey")?.value.trim() || ""
    }
  });
}

for (const id of ["proProvider", "proModel", "proBaseUrl", "proApiKey"]) {
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
  el.style.color = isError ? "#b91c1c" : "";
}

async function runGeneratePromptPro() {
  if (state.busy) {
    return;
  }
  const description = document.getElementById("proDescription")?.value || "";
  await saveProSettings();
  setBusy(true);
  setProStatus("Extraction du site + génération en cours...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_PROMPT_PRO",
      projectDescription: description
    });
    if (!response || !response.ok) {
      throw new Error(response?.error || "Génération échouée.");
    }
    state.proMarkdown = response.markdown;
    renderProPreview();
    setProStatus(
      `Généré via ${response.engine}.${response.warning ? ` ⚠ ${response.warning}` : ""} Télécharge ou copie le résultat.`,
      Boolean(response.warning)
    );
  } finally {
    setBusy(false);
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

async function init() {
  const data = await chrome.storage.local.get(["outputMode"]);
  state.mode = ["skill", "json", "motion", "prompt", "pro"].includes(data.outputMode) ? data.outputMode : "design";
  await loadProSettings();
  syncModeUi();
  updateQuickInstallUi();
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
  for (const button of [exportTailwindBtn, exportW3cBtn, diffBtn, mcpBtn]) {
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

  const siteName = String(state.lastResult.normalized.source?.title || "design")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()
    .slice(0, 30);

  const download =
    kind === "tailwind"
      ? { filename: "tailwind.config.js", text: response.tailwindConfig, mime: "text/javascript" }
      : { filename: `${siteName}.tokens.json`, text: response.w3cTokens, mime: "application/json" };

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
      mode: "design",
      persistOutputMode: false
    });
    designMarkdown = response?.markdown || "";
  }
  if (!skillMarkdown) {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_EXTRACTION",
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
  statusEl.style.color = isError ? "#b91c1c" : "#1f1f1f";
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
        The format is based on the TypeUI DESIGN.md configuration:
        <a href="https://www.typeui.sh/design-md" target="_blank" rel="noopener noreferrer">https://www.typeui.sh/design-md</a>
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
    <p>Format lineage: <a href="https://www.typeui.sh/design-md" target="_blank" rel="noopener noreferrer">TypeUI DESIGN.md</a> structure, <a href="https://github.com/VoltAgent/awesome-design-md" target="_blank" rel="noopener noreferrer">awesome-design-md</a> YAML frontmatter, <a href="https://github.com/adityarajdigital/designmd" target="_blank" rel="noopener noreferrer">designmd</a> narrative sections.</p>
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

  const siteName = String(state.lastResult.normalized.source?.title || "design")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase()
    .slice(0, 30);

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
