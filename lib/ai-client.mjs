/**
 * Unified multi-provider AI client for the extension.
 *
 * Supports four providers behind one call surface:
 *  - Groq, OpenAI, Kimi (Moonshot): OpenAI-compatible /chat/completions
 *  - Claude (Anthropic): the native Messages API (NOT an OpenAI shim)
 *
 * Vision is supported: pass images and they are serialized to each
 * provider's image-block shape.
 *
 * Runs from the MV3 service worker with raw fetch (no SDK bundling).
 * `fetchImpl` is injectable so the whole thing is unit-testable.
 *
 * API keys live ONLY in chrome.storage.local — never in the repo.
 */

export const AI_PROVIDERS = {
  groq: {
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    visionModel: "qwen/qwen3.8-27b"
  },
  openai: {
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    visionModel: "gpt-4o"
  },
  claude: {
    label: "Claude (Anthropic)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    // Latest Claude model; the field stays user-editable in settings.
    defaultModel: "claude-opus-5-5",
    visionModel: "claude-opus-5-5"
  },
  kimi: {
    label: "Kimi (Moonshot)",
    kind: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2-0905-preview",
    visionModel: "moonshot-v1-8k-vision-preview"
  },
  // New API / One API gateways (e.g. MiaRouter): OpenAI-compatible under
  // <host>/v1, many upstream models behind one key. Model auto-discovered.
  newapi: {
    label: "Passerelle New API / One API",
    kind: "openai",
    baseUrl: "",
    defaultModel: "",
    visionModel: ""
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    defaultModel: "",
    visionModel: ""
  }
};

export function providerConfig(provider) {
  return AI_PROVIDERS[provider] || AI_PROVIDERS.groq;
}

/**
 * "https://host" -> "https://host/v1"; strips a pasted endpoint suffix
 * ("/chat/completions", "/models", "/messages") and trailing slashes.
 */
export function normalizeBaseUrl(url) {
  let value = String(url || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  value = value.replace(/\/(chat\/completions|completions|models|messages)$/i, "");
  try {
    const parsed = new URL(value);
    if (parsed.pathname === "" || parsed.pathname === "/") return `${parsed.origin}/v1`;
  } catch {
    return "";
  }
  return value;
}

/**
 * Accepts a gateway connection string such as
 * {"_type":"newapi_channel_conn","key":"sk-...","url":"https://host"}
 * Returns { provider, baseUrl, apiKey } or null.
 */
export function parseConnectionString(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("{")) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const url = data.url || data.base_url || data.baseUrl || data.endpoint;
  if (!url) return null;
  return {
    provider: /newapi|oneapi/i.test(String(data._type || "")) ? "newapi" : "custom",
    baseUrl: normalizeBaseUrl(url),
    apiKey: String(data.key || data.api_key || data.apiKey || "").trim()
  };
}

const NON_CHAT_MODEL = /embed|whisper|tts|audio|dall-?e|image|vision-only|moderation|rerank|transcri|speech|realtime|sora|midjourney|flux|stable-?diffusion|kling|veo|suno|search-preview|davinci|babbage/i;

// Strongest first. Used when no model is configured or the configured
// one is rejected by the gateway.
const MODEL_PREFERENCE = [
  /claude-(opus|sonnet)-(5|4)/i,
  /claude-.*(opus|sonnet)/i,
  /^gpt-5(?!.*(nano|mini))/i,
  /gpt-4\.1(?!-(nano|mini))/i,
  /^gpt-4o(?!-mini)/i,
  /gemini-.*(3|2\.5)-pro/i,
  /deepseek-(v3|chat|r1|reasoner)/i,
  /qwen.*(max|plus|235b|coder|72b)/i,
  /kimi-k2/i,
  /grok-[34]/i,
  /glm-4/i,
  /llama-(4|3\.3-70b|3\.1-405b)/i,
  /mistral-(large|medium)/i,
  /gpt-5|gpt-4/i
];

export function pickBestModel(ids, { vision = false } = {}) {
  const chat = (ids || []).filter((id) => id && !NON_CHAT_MODEL.test(id));
  const pool = vision ? chat.filter((id) => /vision|vl|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|qwen3|llama-4/i.test(id)) : chat;
  for (const pattern of MODEL_PREFERENCE) {
    const hit = (pool.length ? pool : chat).find((id) => pattern.test(id));
    if (hit) return hit;
  }
  return (pool.length ? pool : chat)[0] || null;
}

/** Model ids exposed by the endpoint (OpenAI-compatible or Anthropic /v1/models). */
export async function listModels({ provider = "groq", apiKey, baseUrl, fetchImpl }) {
  const cfg = providerConfig(provider);
  const doFetch = fetchImpl || fetch;
  const base = normalizeBaseUrl(baseUrl || cfg.baseUrl);
  if (!base) throw new Error("Aucune URL de base configurée.");
  if (!apiKey) throw new Error("Aucune clé API configurée.");
  const headers =
    cfg.kind === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
      : { Authorization: `Bearer ${apiKey}` };
  const response = await doFetch(`${base}/models`, { headers });
  if (!response.ok) {
    throw new Error(describeHttpError(cfg.label, response.status, await safeText(response)));
  }
  const data = await response.json();
  return (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [])
    .map((item) => (typeof item === "string" ? item : item.id))
    .filter(Boolean);
}

// Gateway error pages are HTML (Cloudflare...): keep only their title.
function summarizeDetail(detail) {
  const text = String(detail || "");
  if (/^\s*</.test(text)) {
    const title = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    return title ? `page d'erreur : « ${title} »` : "page d'erreur HTML de la passerelle";
  }
  return text.slice(0, 200);
}

function describeHttpError(label, status, detail) {
  const hint =
    status === 524 || status === 522 || status === 504
      ? "la passerelle (Cloudflare) a coupé la connexion faute de réponse à temps — réponse trop longue pour un appel non streamé"
      : status === 401 || status === 403
      ? "clé API refusée ou expirée"
      : status === 404
        ? "endpoint ou modèle introuvable (vérifie l'URL de base, ex. https://hôte/v1)"
        : status === 429
          ? "quota ou limite de débit atteint"
          : status >= 500
            ? "erreur côté fournisseur"
            : "requête refusée";
  return `${label} : ${hint} (HTTP ${status}). ${summarizeDetail(detail)}`.trim();
}

/**
 * Internal message shape: { role: "system"|"user"|"assistant", text, images }
 * images: [{ mediaType: "image/png", base64: "<no data: prefix>" }]
 *
 * @returns {Promise<{ content: string, model: string, provider: string }>}
 */
export async function callAI({
  provider = "groq",
  apiKey,
  model,
  baseUrl,
  messages,
  temperature = 0.6,
  maxTokens = 4096,
  timeoutMs = 90000,
  stream = false,
  onDelta,
  fetchImpl,
  // Models the learning memory saw failing: skipped by automatic choice.
  avoidModels = []
}) {
  const cfg = providerConfig(provider);
  const rawFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!rawFetch) {
    throw new Error("No fetch implementation available.");
  }
  // A silent gateway must never leave the UI waiting forever.
  const doFetch = (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return Promise.resolve(rawFetch(url, { ...options, signal: controller.signal }))
      .catch((error) => {
        if (error && error.name === "AbortError") {
          throw new Error(`Pas de réponse de l'IA après ${Math.round(timeoutMs / 1000)} s (délai dépassé). Essaie un modèle plus rapide.`);
        }
        throw error;
      })
      .finally(() => clearTimeout(timer));
  };
  if (!apiKey) {
    throw new Error("Aucune clé API configurée.");
  }
  const endpointBase = normalizeBaseUrl(baseUrl || cfg.baseUrl);
  if (!endpointBase) {
    throw new Error("Aucune URL de base configurée pour ce fournisseur (ex. https://hôte/v1).");
  }
  const hasImages = messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
  const discover = async () => {
    const ids = await listModels({ provider, apiKey, baseUrl: endpointBase, fetchImpl: doFetch });
    const avoid = new Set(avoidModels);
    const usable = ids.filter((id) => !avoid.has(id));
    const best = pickBestModel(usable.length ? usable : ids, { vision: hasImages });
    if (!best) throw new Error("Aucun modèle de chat disponible sur cet endpoint.");
    return best;
  };

  let usedModel = model || (hasImages ? cfg.visionModel || cfg.defaultModel : cfg.defaultModel);
  if (!usedModel) usedModel = await discover();

  const run = (m) =>
    cfg.kind === "anthropic"
      ? callAnthropic({ doFetch, apiKey, model: m, baseUrl: endpointBase, messages, maxTokens, provider, stream, onDelta, idleMs: timeoutMs })
      : callOpenAiCompatible({ doFetch, apiKey, model: m, baseUrl: endpointBase, messages, temperature, maxTokens, provider, stream, onDelta, idleMs: timeoutMs });

  try {
    return await run(usedModel);
  } catch (error) {
    // Configured/default model unknown to this endpoint: pick one it serves.
    const modelRejected = [400, 404, 422].includes(error.status) && /model/i.test(error.detail || "");
    if (!modelRejected) throw error;
    const fallback = await discover();
    if (fallback === usedModel) throw error;
    return run(fallback);
  }
}

class AiHttpError extends Error {
  constructor(label, status, detail) {
    super(describeHttpError(label, status, detail));
    this.status = status;
    this.detail = detail;
  }
}

/* ---------------------------------------------------------------- *
 * OpenAI-compatible (Groq / OpenAI / Kimi / New API gateways / custom)
 * ---------------------------------------------------------------- */
async function callOpenAiCompatible({ doFetch, apiKey, model, baseUrl, messages, temperature, maxTokens, provider, stream, onDelta, idleMs }) {
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: messages.map(toOpenAiMessage)
  };
  // Streaming keeps bytes flowing, so proxies with a 100 s idle cut-off
  // (Cloudflare 524) never kill long generations.
  if (stream) body.stream = true;
  const label = AI_PROVIDERS[provider]?.label || provider;
  // Gateways and newer models reject some parameters: adapt and retry.
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (response.ok) {
      if (isEventStream(response)) {
        const streamed = await readEventStream(response, idleMs, onDelta, (event) => event?.choices?.[0]?.delta?.content || "");
        // Some gateways answer finish_reason "stop" on a cut-off output: the
        // usage (completion tokens == budget) is the reliable signal.
        const budget = body.max_tokens || body.max_completion_tokens || Infinity;
        const truncated = streamed.finishReason === "length" || (streamed.usage?.completion_tokens || 0) >= budget - 8;
        if (truncated) {
          return { content: streamed.text, model: streamed.model || model, provider, truncated: true };
        }
        if (streamed.reasoning > 0 && streamed.text.trim().length < 200) {
          throw new Error(`Réponse tronquée : le modèle a passé son budget à réfléchir (${streamed.reasoning.toLocaleString("fr-FR")} caractères de réflexion, ${streamed.text.trim().length} de réponse). Réessaie ou choisis un modèle sans raisonnement.`);
        }
        if (!streamed.text) throw new Error("L'API a répondu sans contenu.");
        return { content: streamed.text, model: streamed.model || model, provider };
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("L'API a répondu sans contenu.");
      }
      onDelta?.(String(content).length);
      return { content: String(content), model: data.model || model, provider, truncated: data?.choices?.[0]?.finish_reason === "length" };
    }
    const detail = await safeText(response);
    if (response.status === 400 && attempt < 5) {
      if (body.stream && /stream/i.test(detail)) {
        delete body.stream;
        continue;
      }
      if (/max_tokens/.test(detail) && /max_completion_tokens|unsupported/i.test(detail) && body.max_tokens) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
        continue;
      }
      if (/temperature/i.test(detail) && "temperature" in body) {
        delete body.temperature;
        continue;
      }
      const limit = Math.min(body.max_tokens || Infinity, body.max_completion_tokens || Infinity);
      if (/max_tokens|max_completion_tokens|maximum|too (large|long)|context length/i.test(detail) && limit > 4096) {
        const next = limit > 16000 ? 16000 : limit > 8000 ? 8000 : 4096;
        if (body.max_tokens) body.max_tokens = next;
        if (body.max_completion_tokens) body.max_completion_tokens = next;
        continue;
      }
    }
    throw new AiHttpError(label, response.status, detail);
  }
  throw new Error(`${label} : requête refusée après ajustements.`);
}

function toOpenAiMessage(message) {
  if (!message.images || message.images.length === 0) {
    return { role: message.role, content: message.text || "" };
  }
  const parts = [];
  if (message.text) {
    parts.push({ type: "text", text: message.text });
  }
  for (const image of message.images) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${image.mediaType || "image/png"};base64,${image.base64}` }
    });
  }
  return { role: message.role, content: parts };
}

/* ---------------------------------------------------------------- *
 * Anthropic Messages API (native shape)
 * ---------------------------------------------------------------- */
async function callAnthropic({ doFetch, apiKey, model, baseUrl, messages, maxTokens, provider, stream, onDelta, idleMs }) {
  // Anthropic takes the system prompt as a top-level field, not a message.
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.text)
    .filter(Boolean)
    .join("\n\n");
  const turns = messages.filter((m) => m.role !== "system").map(toAnthropicMessage);

  const body = {
    model,
    max_tokens: maxTokens,
    messages: turns
  };
  if (systemText) {
    body.system = systemText;
  }
  if (stream) {
    body.stream = true;
  }

  const response = await doFetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required for direct calls from a browser/extension context.
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new AiHttpError("Claude", response.status, await safeText(response));
  }
  if (isEventStream(response)) {
    const streamed = await readEventStream(response, idleMs, onDelta, (event) =>
      event?.type === "content_block_delta" ? event.delta?.text || "" : ""
    );
    if (!streamed.text) throw new Error("Claude API returned no text content.");
    return { content: streamed.text, model, provider, truncated: streamed.finishReason === "max_tokens" };
  }
  const data = await response.json();
  const content = Array.isArray(data?.content)
    ? data.content.filter((block) => block.type === "text").map((block) => block.text).join("")
    : "";
  if (!content) {
    throw new Error("Claude API returned no text content.");
  }
  return { content: String(content), model, provider };
}

function toAnthropicMessage(message) {
  const role = message.role === "assistant" ? "assistant" : "user";
  if (!message.images || message.images.length === 0) {
    return { role, content: message.text || "" };
  }
  const parts = [];
  for (const image of message.images) {
    parts.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType || "image/png",
        data: image.base64
      }
    });
  }
  if (message.text) {
    parts.push({ type: "text", text: message.text });
  }
  return { role, content: parts };
}

function isEventStream(response) {
  const type = response.headers?.get?.("content-type") || "";
  return /text\/event-stream/i.test(type) && typeof response.body?.getReader === "function";
}

/**
 * Reads an SSE body ("data: {json}" lines, "[DONE]" terminator). Aborts if
 * no byte arrives for idleMs. extract(event) returns the text delta.
 */
async function readEventStream(response, idleMs, onDelta, extract) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = 0;
  let finishReason = null;
  let usage = null;
  let model = null;
  for (;;) {
    let timer;
    const idle = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Flux IA interrompu : rien reçu pendant ${Math.round(idleMs / 1000)} s.`)), idleMs);
    });
    let chunk;
    try {
      chunk = await Promise.race([reader.read(), idle]);
    } catch (error) {
      reader.cancel().catch(() => {});
      // Gateways sometimes drop long streams ("terminated"): keep what
      // arrived so the caller can continue from there.
      error.partialText = text;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event?.error) throw new Error(`Erreur IA en cours de flux : ${event.error.message || JSON.stringify(event.error).slice(0, 160)}`);
      model = event?.model || model;
      usage = event?.usage || usage;
      finishReason = event?.choices?.[0]?.finish_reason || event?.delta?.stop_reason || finishReason;
      // Reasoning models think before writing: report it as progress, never as content.
      const thought = event?.choices?.[0]?.delta?.reasoning_content || event?.choices?.[0]?.delta?.reasoning || (event?.delta?.type === "thinking_delta" ? event.delta.thinking : "");
      if (thought) {
        reasoning += thought.length;
        onDelta?.(text.length, reasoning);
      }
      const delta = extract(event);
      if (delta) {
        text += delta;
        onDelta?.(text.length, reasoning);
      }
    }
  }
  return { text, model, reasoning, finishReason, usage };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch (error) {
    return "";
  }
}
