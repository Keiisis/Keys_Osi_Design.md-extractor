/**
 * Keys_Osi HAR / XHR / fetch-JSON prompt extractor.
 *
 * Two detection layers:
 *   1. URL-based: known AI provider hosts and paths → confidence "high"
 *   2. Content-based: any POST body containing messages/role/prompt
 *      structures regardless of URL → confidence "medium"
 *
 * This means your own proxy APIs (e.g. /api/my-chatbot) and custom
 * backends that relay AI calls are caught by layer 2.
 */

/* ─── URL-based detection (known AI providers) ─── */

const AI_PATH_PATTERNS = [
  /\/v\d+\/chat\/completions/i,
  /\/v\d+\/completions/i,
  /\/v\d+\/messages/i,
  /\/v\d+\/generate/i,
  /\/api\/generate/i,
  /\/api\/chat/i,
  /\/inference/i,
  /\/predict/i,
  /\/prompt/i,
  /\/llm/i,
  /\/ai\//i,
  /\/copilot/i,
  /\/anthropic/i,
  /\/openai/i,
  /\/groq/i,
  /\/mistral/i,
  /\/cohere/i,
  /\/gemini/i,
  /\/claude/i,
  /\/perplexity/i,
  /\/together/i,
  /\/replicate/i,
  /\/huggingface/i,
  /\/deepseek/i,
];

const AI_HOST_PATTERNS = [
  /api\.openai\.com/i,
  /api\.anthropic\.com/i,
  /api\.groq\.com/i,
  /api\.mistral\.ai/i,
  /api\.cohere\.ai/i,
  /generativelanguage\.googleapis\.com/i,
  /api\.perplexity\.ai/i,
  /api\.together\.xyz/i,
  /api\.replicate\.com/i,
  /api-inference\.huggingface\.co/i,
  /api\.deepseek\.com/i,
  /api\.fireworks\.ai/i,
  /gateway\.ai\.cloudflare\.com/i,
  /api\.x\.ai/i,
];

/* ─── Content-based detection (any URL) ─── */

const PROMPT_KEYS = [
  "prompt", "messages", "system", "input", "inputs", "query",
  "question", "instruction", "text", "content", "context",
];

const CONTENT_SIGNALS = [
  (obj) => Array.isArray(obj.messages) && obj.messages.some((m) => m.role || m.type),
  (obj) => typeof obj.system === "string" && obj.system.length >= 8,
  (obj) => typeof obj.prompt === "string" && obj.prompt.length >= 8,
  (obj) => typeof obj.instruction === "string" && obj.instruction.length >= 8,
  (obj) => typeof obj.query === "string" && obj.query.length >= 8,
  (obj) => typeof obj.model === "string" && /^(gpt|claude|llama|mistral|gemini|command|deepseek|qwen)/i.test(obj.model),
  (obj) => Array.isArray(obj.choices),
  (obj) => Array.isArray(obj.content) && obj.content.some((b) => b.type === "text"),
  (obj) => obj.object === "chat.completion",
  (obj) => typeof obj.completion === "string",
  (obj) => obj.stop_reason || obj.finish_reason,
];

const MIN_LEN = 12;
const MAX_LEN = 100_000;

/* ─── Helpers ─── */

function classifyUrl(url) {
  try {
    const u = new URL(url);
    if (AI_HOST_PATTERNS.some((p) => p.test(u.hostname))) return "high";
    if (AI_PATH_PATTERNS.some((p) => p.test(u.pathname))) return "high";
  } catch { /* ignore */ }
  return null;
}

function classifyBody(text) {
  const obj = tryParse(text);
  if (!obj || typeof obj !== "object") return null;
  const hits = CONTENT_SIGNALS.reduce((n, fn) => { try { return fn(obj) ? n + 1 : n; } catch { return n; } }, 0);
  return hits >= 2 ? "medium" : hits === 1 ? "low" : null;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return "unknown"; }
}

function tryParse(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try { return JSON.parse(t); } catch { return null; }
}

function extractFromBody(body) {
  if (!body) return null;
  if (body.text) return body.text;
  if (body.mimeType === "application/x-www-form-urlencoded" && Array.isArray(body.params)) {
    const hit = body.params.find((p) => PROMPT_KEYS.includes(p.name?.toLowerCase()));
    if (hit) return hit.value;
    return body.params.map((p) => `${p.name}=${p.value}`).join("&");
  }
  return null;
}

function collectTexts(obj, depth = 0) {
  if (depth > 6) return [];
  const results = [];
  if (typeof obj === "string" && obj.length >= MIN_LEN && obj.length <= MAX_LEN) {
    results.push(obj);
  }
  if (Array.isArray(obj)) {
    for (const item of obj) results.push(...collectTexts(item, depth + 1));
  } else if (obj && typeof obj === "object") {
    for (const key of PROMPT_KEYS) {
      if (obj[key] !== undefined) results.push(...collectTexts(obj[key], depth + 1));
    }
    if (Array.isArray(obj.messages)) {
      for (const msg of obj.messages) {
        const role = msg.role || msg.type || "";
        const content = msg.content || msg.text || "";
        if (typeof content === "string" && content.length >= MIN_LEN) {
          results.push(`[${role}] ${content}`);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text?.length >= MIN_LEN) {
              results.push(`[${role}] ${block.text}`);
            }
          }
        }
      }
    }
  }
  return results;
}

function extractResponses(parsed, entryHost, confidence, url) {
  const items = [];
  if (!parsed || typeof parsed !== "object") return items;
  const choices = parsed.choices || parsed.completions || [];
  if (Array.isArray(choices)) {
    for (const c of choices) {
      const msg = c.message?.content || c.text || c.delta?.content || "";
      if (typeof msg === "string" && msg.length >= MIN_LEN) {
        items.push({ text: `[response] ${msg.trim()}`, source: `HAR:${entryHost}`, chars: msg.trim().length, confidence, url });
      }
    }
  }
  if (Array.isArray(parsed.content)) {
    for (const block of parsed.content) {
      if (block.type === "text" && block.text?.length >= MIN_LEN) {
        items.push({ text: `[response] ${block.text.trim()}`, source: `HAR:${entryHost}`, chars: block.text.trim().length, confidence, url });
      }
    }
  }
  if (typeof parsed.completion === "string" && parsed.completion.length >= MIN_LEN) {
    items.push({ text: `[response] ${parsed.completion.trim()}`, source: `HAR:${entryHost}`, chars: parsed.completion.trim().length, confidence, url });
  }
  return items;
}

function dedup(items) {
  const seen = new Set();
  return items.filter((it) => {
    const k = it.text.toLowerCase().replace(/\s+/g, " ").slice(0, 400);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function best(a, b) {
  const rank = { high: 3, medium: 2, low: 1 };
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}

/* ─── HAR parser ─── */

/**
 * @param {string} harText — raw HAR file content (JSON string)
 * @returns {{ items: Array<{text:string, source:string, chars:number, confidence:string, url?:string}>, stats: {entries:number, matched:number, scanned:number, hosts:string[]} }}
 */
export function parseHarPrompts(harText) {
  const har = JSON.parse(harText);
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("Format HAR invalide : pas de log.entries.");

  const items = [];
  let matched = 0;
  let scanned = 0;
  const hostsSet = new Set();

  for (const entry of entries) {
    const url = entry.request?.url || "";
    const method = (entry.request?.method || "").toUpperCase();
    const entryHost = hostOf(url);

    // Layer 1: URL detection
    let confidence = classifyUrl(url);

    // Layer 2: content detection on POST/PUT/PATCH bodies
    const reqText = extractFromBody(entry.request?.postData);
    if (!confidence && reqText && (method === "POST" || method === "PUT" || method === "PATCH")) {
      confidence = classifyBody(reqText);
    }

    // Layer 2 bis: response body can also reveal AI traffic
    const resText = entry.response?.content?.text;
    if (!confidence && resText) {
      const resConfidence = classifyBody(resText);
      if (resConfidence) confidence = resConfidence;
    }

    if (!confidence) continue;
    matched++;
    scanned++;
    hostsSet.add(entryHost);

    // Extract from request
    if (reqText) {
      const parsed = tryParse(reqText);
      if (parsed) {
        const texts = collectTexts(parsed);
        for (const t of texts) {
          items.push({ text: t.trim(), source: `HAR:${entryHost}`, chars: t.trim().length, confidence, url });
        }
      } else if (reqText.length >= MIN_LEN && reqText.length <= MAX_LEN) {
        items.push({ text: reqText.trim(), source: `HAR:${entryHost}`, chars: reqText.trim().length, confidence, url });
      }
    }

    // Extract from response
    if (resText) {
      const parsed = tryParse(resText);
      if (parsed) items.push(...extractResponses(parsed, entryHost, confidence, url));
    }

    // WebSocket messages
    if (Array.isArray(entry._webSocketMessages)) {
      for (const ws of entry._webSocketMessages) {
        const data = ws.data;
        if (!data || typeof data !== "string") continue;
        const parsed = tryParse(data);
        if (parsed) {
          const bodyConf = classifyBody(data);
          const wsConf = best(confidence, bodyConf || "low");
          const texts = collectTexts(parsed);
          for (const t of texts) {
            items.push({ text: t.trim(), source: `HAR-WS:${entryHost}`, chars: t.trim().length, confidence: wsConf, url });
          }
          items.push(...extractResponses(parsed, entryHost, wsConf, url));
        }
      }
    }
  }

  return {
    items: dedup(items),
    stats: { entries: entries.length, matched, scanned, hosts: [...hostsSet] },
  };
}

/* ─── XHR / fetch / generic JSON parser ─── */

/**
 * Parse raw XHR/fetch JSON export (array of request objects, single object,
 * or HAR). Handles: Chrome DevTools "Copy all as HAR", browser extension
 * network exports, custom [{url, body, response}] arrays, or any JSON
 * file containing prompt-like structures.
 */
export function parseXhrPrompts(jsonText) {
  const data = JSON.parse(jsonText);

  // HAR format → delegate
  if (data?.log?.entries) return parseHarPrompts(jsonText);

  // Direct prompt structure (e.g. a single OpenAI request body pasted as JSON)
  if (!Array.isArray(data) && data && typeof data === "object" && !data.url && !data.requestUrl) {
    const bodyConf = classifyBody(jsonText);
    if (bodyConf) {
      const texts = collectTexts(data);
      const items = texts.map((t) => ({ text: t.trim(), source: "JSON", chars: t.trim().length, confidence: bodyConf }));
      const respItems = extractResponses(data, "local", bodyConf, "");
      return {
        items: dedup([...items, ...respItems]),
        stats: { entries: 1, matched: 1, scanned: 1, hosts: ["local"] },
      };
    }
  }

  const arr = Array.isArray(data) ? data : [data];
  const items = [];
  const hostsSet = new Set();
  let matched = 0;

  for (const req of arr) {
    const url = req.url || req.requestUrl || req.request?.url || "";
    const entryHost = url ? hostOf(url) : "local";

    // Layer 1: URL
    let confidence = url ? classifyUrl(url) : null;

    // Layer 2: content in any body field
    const bodyFields = ["body", "postData", "requestBody", "request", "data", "payload"];
    for (const field of bodyFields) {
      if (confidence) break;
      const val = req[field];
      if (!val) continue;
      const raw = typeof val === "string" ? val : JSON.stringify(val);
      const bodyConf = classifyBody(raw);
      if (bodyConf) confidence = best(confidence, bodyConf);
    }

    // Layer 2 bis: response fields
    const respFields = ["response", "responseBody", "responseText", "result", "output"];
    for (const field of respFields) {
      if (confidence) break;
      const val = req[field];
      if (!val) continue;
      const raw = typeof val === "string" ? val : JSON.stringify(val);
      const resConf = classifyBody(raw);
      if (resConf) confidence = best(confidence, resConf);
    }

    if (!confidence) continue;
    matched++;
    hostsSet.add(entryHost);

    // Extract request prompts
    for (const field of bodyFields) {
      const val = req[field];
      if (!val) continue;
      const raw = typeof val === "string" ? val : JSON.stringify(val);
      if (raw.length < MIN_LEN) continue;
      const parsed = tryParse(raw);
      if (parsed) {
        for (const t of collectTexts(parsed)) {
          items.push({ text: t.trim(), source: `XHR:${entryHost}`, chars: t.trim().length, confidence, url });
        }
      }
    }

    // Extract responses
    for (const field of respFields) {
      const val = req[field];
      if (!val) continue;
      const raw = typeof val === "string" ? val : JSON.stringify(val);
      if (raw.length < MIN_LEN) continue;
      const parsed = tryParse(raw);
      if (parsed) {
        items.push(...extractResponses(parsed, entryHost, confidence, url));
        for (const t of collectTexts(parsed)) {
          items.push({ text: `[response] ${t.trim()}`, source: `XHR:${entryHost}`, chars: t.trim().length, confidence, url });
        }
      }
    }
  }

  return {
    items: dedup(items),
    stats: { entries: arr.length, matched, scanned: arr.length, hosts: [...hostsSet] },
  };
}
