import { parseHarPrompts, parseXhrPrompts } from "../lib/har-prompts.mjs";
import assert from "node:assert/strict";

// 1. Valid HAR with OpenAI-style chat completion (URL-based detection)
const har1 = JSON.stringify({
  log: {
    version: "1.2",
    entries: [
      {
        request: {
          method: "POST",
          url: "https://api.openai.com/v1/chat/completions",
          postData: {
            mimeType: "application/json",
            text: JSON.stringify({
              model: "gpt-4",
              messages: [
                { role: "system", content: "You are a helpful assistant specialized in code review." },
                { role: "user", content: "Review this function and suggest improvements for error handling." },
              ],
            }),
          },
        },
        response: {
          status: 200,
          content: {
            mimeType: "application/json",
            text: JSON.stringify({
              choices: [{ message: { role: "assistant", content: "Here are my suggestions for improving your error handling in this function." } }],
            }),
          },
        },
      },
      { request: { method: "GET", url: "https://cdn.example.com/style.css" }, response: { status: 200, content: {} } },
    ],
  },
});

const r1 = parseHarPrompts(har1);
assert.ok(r1.items.length >= 2, `expected >=2 items, got ${r1.items.length}`);
assert.ok(r1.items.some((it) => it.text.includes("code review")), "system prompt found");
assert.ok(r1.items.some((it) => it.text.includes("error handling")), "user prompt found");
assert.equal(r1.stats.matched, 1, "1 AI endpoint matched");
assert.ok(r1.stats.hosts.includes("api.openai.com"));
assert.ok(r1.items.every((it) => it.source.startsWith("HAR:")));
assert.ok(r1.items.every((it) => it.confidence === "high"), "known provider → high confidence");

// 2. Anthropic-style response
const har2 = JSON.stringify({
  log: {
    entries: [
      {
        request: {
          method: "POST",
          url: "https://api.anthropic.com/v1/messages",
          postData: { mimeType: "application/json", text: JSON.stringify({ system: "Be concise.", messages: [{ role: "user", content: "Explain recursion in one sentence." }] }) },
        },
        response: {
          status: 200,
          content: {
            text: JSON.stringify({ content: [{ type: "text", text: "Recursion is when a function calls itself to solve smaller instances of the same problem." }] }),
          },
        },
      },
    ],
  },
});

const r2 = parseHarPrompts(har2);
assert.ok(r2.items.some((it) => it.text.includes("recursion")), "user prompt about recursion");
assert.ok(r2.items.some((it) => it.text.includes("[response]")), "response extracted");

// 3. Invalid HAR throws
assert.throws(() => parseHarPrompts("not json"), /Unexpected token/);
assert.throws(() => parseHarPrompts("{}"), /Format HAR invalide/);

// 4. XHR format (array of request objects, known endpoint)
const xhr = JSON.stringify([
  { url: "https://api.groq.com/openai/v1/chat/completions", method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "Write a haiku about programming in Rust." }] }) },
  { url: "https://example.com/api/data", method: "GET" },
]);

const r3 = parseXhrPrompts(xhr);
assert.ok(r3.items.length >= 1, `XHR: expected >=1 items, got ${r3.items.length}`);
assert.ok(r3.items.some((it) => it.text.includes("haiku")));

// 5. XHR delegates to HAR parser when log.entries present
const r4 = parseXhrPrompts(har1);
assert.ok(r4.items.length >= 2, "XHR delegates to HAR parser");

// 6. Dedup works
const harDup = JSON.stringify({
  log: {
    entries: [
      {
        request: { method: "POST", url: "https://api.openai.com/v1/completions", postData: { mimeType: "application/json", text: JSON.stringify({ prompt: "Tell me a joke about cats." }) } },
        response: { status: 200, content: {} },
      },
      {
        request: { method: "POST", url: "https://api.openai.com/v1/completions", postData: { mimeType: "application/json", text: JSON.stringify({ prompt: "Tell me a joke about cats." }) } },
        response: { status: 200, content: {} },
      },
    ],
  },
});
const r5 = parseHarPrompts(harDup);
assert.equal(r5.items.filter((it) => it.text.includes("cats")).length, 1, "dedup removes duplicate");

// 7. Non-AI endpoint with non-AI content → ignored
const harNoAi = JSON.stringify({ log: { entries: [{ request: { method: "POST", url: "https://example.com/login", postData: { text: "user=foo&pass=bar" } }, response: { status: 200, content: {} } }] } });
const r6 = parseHarPrompts(harNoAi);
assert.equal(r6.items.length, 0, "login form ignored");
assert.equal(r6.stats.matched, 0);

// ════════════════════════════════════════════════════════════════════
// 8. CONTENT-BASED DETECTION: custom API endpoint with messages/role
// ════════════════════════════════════════════════════════════════════
const harCustomApi = JSON.stringify({
  log: {
    entries: [
      {
        request: {
          method: "POST",
          url: "https://my-saas.com/backend/assistant",
          postData: {
            mimeType: "application/json",
            text: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: "Tu es un assistant culinaire spécialisé en cuisine française." },
                { role: "user", content: "Donne-moi une recette de blanquette de veau." },
              ],
            }),
          },
        },
        response: {
          status: 200,
          content: {
            text: JSON.stringify({
              choices: [{ message: { role: "assistant", content: "Voici une recette de blanquette de veau traditionnelle avec sauce blanche." } }],
              finish_reason: "stop",
            }),
          },
        },
      },
    ],
  },
});

const r8 = parseHarPrompts(harCustomApi);
assert.ok(r8.items.length >= 2, `custom API: expected >=2 items, got ${r8.items.length}`);
assert.ok(r8.items.some((it) => it.text.includes("cuisine française")), "system prompt found via content detection");
assert.ok(r8.items.some((it) => it.text.includes("blanquette")), "user prompt found via content detection");
assert.ok(r8.items.some((it) => it.text.includes("[response]")), "response found via content detection");
assert.ok(r8.stats.hosts.includes("my-saas.com"), "custom host detected");
assert.ok(r8.items.some((it) => it.confidence === "medium"), "content-detected custom API → medium");

// 9. Content detection on response only (GET that returns AI-shaped data)
const harRespOnly = JSON.stringify({
  log: {
    entries: [
      {
        request: { method: "GET", url: "https://my-app.io/conversation/42" },
        response: {
          status: 200,
          content: {
            text: JSON.stringify({
              object: "chat.completion",
              choices: [{ message: { content: "The capital of France is Paris, known for the Eiffel Tower." } }],
              finish_reason: "stop",
            }),
          },
        },
      },
    ],
  },
});

const r9 = parseHarPrompts(harRespOnly);
assert.ok(r9.items.length >= 1, "response-only content detection works");
assert.ok(r9.items.some((it) => it.text.includes("Paris")), "AI response extracted from unknown endpoint");

// 10. Raw JSON body (no URL, direct prompt structure → parseXhrPrompts)
const rawBody = JSON.stringify({
  model: "claude-sonnet-4-20250514",
  system: "You are a senior frontend developer who writes clean TypeScript.",
  messages: [
    { role: "user", content: "Refactor this component to use React hooks instead of class state." },
  ],
});

const r10 = parseXhrPrompts(rawBody);
assert.ok(r10.items.length >= 1, `raw JSON: expected >=1 items, got ${r10.items.length}`);
assert.ok(r10.items.some((it) => it.text.includes("React hooks")), "prompt from raw JSON body");
assert.ok(r10.items.some((it) => it.source === "JSON"), "source is JSON for direct body");

// 11. XHR array with custom proxy endpoint (content-based)
const xhrCustom = JSON.stringify([
  {
    url: "https://internal.corp.com/proxy/llm",
    body: JSON.stringify({
      messages: [{ role: "user", content: "Summarize the Q3 earnings report in three bullet points." }],
      model: "gpt-4-turbo",
    }),
    response: JSON.stringify({
      choices: [{ message: { content: "Here are the three key takeaways from Q3 earnings." } }],
      finish_reason: "stop",
    }),
  },
]);

const r11 = parseXhrPrompts(xhrCustom);
assert.ok(r11.items.length >= 1, "XHR custom proxy detected via content");
assert.ok(r11.items.some((it) => it.text.includes("Q3 earnings")), "prompt from custom proxy");
assert.ok(r11.stats.hosts.includes("internal.corp.com"), "custom proxy host captured");

// 12. Anthropic completion field in response
const harCompletion = JSON.stringify({
  log: {
    entries: [
      {
        request: {
          method: "POST",
          url: "https://my-gateway.com/v1/complete",
          postData: {
            text: JSON.stringify({
              prompt: "\n\nHuman: What is the meaning of life?\n\nAssistant:",
              model: "claude-3-opus",
            }),
          },
        },
        response: {
          status: 200,
          content: {
            text: JSON.stringify({
              completion: "The meaning of life is a deeply philosophical question that has been debated throughout history.",
              stop_reason: "stop_sequence",
            }),
          },
        },
      },
    ],
  },
});

const r12 = parseHarPrompts(harCompletion);
assert.ok(r12.items.some((it) => it.text.includes("meaning of life") && !it.text.startsWith("[response]")), "prompt field extracted");
assert.ok(r12.items.some((it) => it.text.includes("[response]") && it.text.includes("philosophical")), "completion field extracted as response");

// 13. Live-capture entries (xhr-capture.js shape) and the .xhr.json bundle written
//     by NET_BODY both go straight through parseXhrPrompts — bodies as strings or objects.
const captured = [{
  id: 1, ts: 1, url: "https://my-saas.com/backend/assistant", method: "POST", status: 200, contentType: "application/json", source: "fetch",
  requestBody: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "Rédige un email de relance poli pour une facture impayée depuis 30 jours." }] }),
  responseBody: JSON.stringify({ choices: [{ message: { content: "Objet : Relance concernant la facture n°2024-118 échue depuis 30 jours." } }], finish_reason: "stop" }),
}];
const r13 = parseXhrPrompts(JSON.stringify(captured));
assert.ok(r13.items.some((it) => it.text.includes("facture impayée")), "live capture entry: request prompt extracted");
assert.ok(r13.items.some((it) => it.text.includes("[response]") && it.text.includes("2024-118")), "live capture entry: response extracted");
assert.ok(r13.stats.hosts.includes("my-saas.com"), "live capture entry: host kept");

const bundle = [{ url: captured[0].url, method: "POST", status: 200, contentType: "application/json", requestBody: JSON.parse(captured[0].requestBody), responseBody: JSON.parse(captured[0].responseBody) }];
const r13b = parseXhrPrompts(JSON.stringify(bundle));
assert.ok(r13b.items.some((it) => it.text.includes("facture impayée")), ".xhr.json bundle (parsed objects) round-trips");
assert.equal(r13b.items.length, r13.items.length, "bundle and raw capture yield the same prompts");

console.log("har-prompts-tests: ok");
