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
    visionModel: "llama-3.2-90b-vision-preview"
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
    // The claude-api skill is firm: default to claude-opus-4-8 unless the
    // user names another model. The field stays user-editable in settings.
    defaultModel: "claude-opus-4-8",
    visionModel: "claude-opus-4-8"
  },
  kimi: {
    label: "Kimi (Moonshot)",
    kind: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2-0905-preview",
    visionModel: "moonshot-v1-8k-vision-preview"
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
  fetchImpl
}) {
  const cfg = providerConfig(provider);
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!doFetch) {
    throw new Error("No fetch implementation available.");
  }
  if (!apiKey) {
    throw new Error("No API key configured.");
  }
  const hasImages = messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
  const usedModel =
    model || (hasImages ? cfg.visionModel || cfg.defaultModel : cfg.defaultModel);
  if (!usedModel) {
    throw new Error("No model configured for this provider.");
  }
  const endpointBase = (baseUrl || cfg.baseUrl).replace(/\/$/, "");
  if (!endpointBase) {
    throw new Error("No base URL configured for this provider.");
  }

  if (cfg.kind === "anthropic") {
    return callAnthropic({ doFetch, apiKey, model: usedModel, baseUrl: endpointBase, messages, maxTokens, provider });
  }
  return callOpenAiCompatible({ doFetch, apiKey, model: usedModel, baseUrl: endpointBase, messages, temperature, maxTokens, provider });
}

/* ---------------------------------------------------------------- *
 * OpenAI-compatible (Groq / OpenAI / Kimi / custom)
 * ---------------------------------------------------------------- */
async function callOpenAiCompatible({ doFetch, apiKey, model, baseUrl, messages, temperature, maxTokens, provider }) {
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: messages.map(toOpenAiMessage)
  };
  const response = await doFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await safeText(response);
    throw new Error(`${AI_PROVIDERS[provider]?.label || provider} API error ${response.status}: ${detail.slice(0, 200)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI API returned no content.");
  }
  return { content: String(content), model, provider };
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
async function callAnthropic({ doFetch, apiKey, model, baseUrl, messages, maxTokens, provider }) {
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
    const detail = await safeText(response);
    throw new Error(`Claude API error ${response.status}: ${detail.slice(0, 200)}`);
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

async function safeText(response) {
  try {
    return await response.text();
  } catch (error) {
    return "";
  }
}
