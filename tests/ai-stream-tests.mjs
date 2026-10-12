// Streaming AI calls: SSE parsing, Cloudflare 524 summaries, idle timeout.
import assert from "node:assert/strict";
import { callAI } from "../lib/ai-client.mjs";

const sse = (chunks, { delayMs = 0, hangAfter = false } = {}) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(encoder.encode(chunk));
      }
      if (!hangAfter) controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

// OpenAI-compatible stream, events split across network chunks.
{
  const deltas = [];
  let sentBody;
  const result = await callAI({
    provider: "newapi",
    apiKey: "k",
    baseUrl: "https://miarouter.online",
    model: "gpt-4o",
    stream: true,
    onDelta: (n) => deltas.push(n),
    messages: [{ role: "user", text: "x" }],
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return sse([
        'data: {"model":"gpt-4o-2024","choices":[{"delta":{"content":"# PROMPT"}}]}\n\nda',
        'ta: {"choices":[{"delta":{"content":"_PRO"}}]}\n\n',
        "data: [DONE]\n\n"
      ]);
    }
  });
  assert.equal(sentBody.stream, true, "requests a stream");
  assert.equal(result.content, "# PROMPT_PRO", "joins deltas across chunk boundaries");
  assert.equal(result.model, "gpt-4o-2024");
  assert.deepEqual(deltas, [8, 12], "reports progress per delta");
}

// Reasoning models (MiaRouter claude-opus-5-5): reasoning_content is progress,
// never content; a budget burnt on thinking is reported, not returned as "#".
{
  const progress = [];
  const result = await callAI({
    provider: "newapi",
    apiKey: "k",
    baseUrl: "https://g.io",
    model: "m",
    stream: true,
    onDelta: (text, reasoning) => progress.push([text, reasoning]),
    messages: [{ role: "user", text: "x" }],
    fetchImpl: async () =>
      sse([
        ": PING\n\n",
        'data: {"choices":[{"delta":{"reasoning_content":"Let me plan "}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"the sections."}}]}\n\n',
        `data: {"choices":[{"delta":{"content":"${"# PROMPT_PRO ".repeat(20)}"}}]}\n\n`,
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
      ])
  });
  assert.ok(result.content.startsWith("# PROMPT_PRO") && !result.content.includes("Let me plan"), "thinking stays out of the document");
  assert.deepEqual(progress.slice(0, 2), [[0, 12], [0, 25]], "thinking reported as progress");

  await assert.rejects(
    callAI({
      provider: "newapi",
      apiKey: "k",
      baseUrl: "https://g.io",
      model: "m",
      stream: true,
      messages: [{ role: "user", text: "x" }],
      fetchImpl: async () =>
        sse([
          `data: {"choices":[{"delta":{"reasoning_content":"${"think ".repeat(400)}"}}]}\n\n`,
          'data: {"choices":[{"delta":{"content":"#"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        ])
    }),
    /Réponse tronquée.*réfléchir/,
    "a document truncated by the thinking budget is an explicit error"
  );
}

// Anthropic stream.
{
  const result = await callAI({
    provider: "claude",
    apiKey: "k",
    stream: true,
    messages: [{ role: "user", text: "x" }],
    fetchImpl: async () =>
      sse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Bon"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"jour"}}\n\n',
        'data: {"type":"message_stop"}\n\n'
      ])
  });
  assert.equal(result.content, "Bonjour");
}

// Gateway ignores stream and answers plain JSON: still works.
{
  const result = await callAI({
    provider: "openai",
    apiKey: "k",
    model: "m",
    stream: true,
    messages: [{ role: "user", text: "x" }],
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "json ok" } }] }), { headers: { "content-type": "application/json" } })
  });
  assert.equal(result.content, "json ok");
}

// Gateway rejects the stream parameter: retried without it.
{
  const bodies = [];
  const result = await callAI({
    provider: "openai",
    apiKey: "k",
    model: "m",
    stream: true,
    messages: [{ role: "user", text: "x" }],
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      bodies.push(body);
      if (body.stream) return new Response("stream is not supported", { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "no-stream ok" } }] }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.content, "no-stream ok");
  assert.equal(bodies.length, 2);
}

// Cloudflare 524 HTML page -> one readable line.
await assert.rejects(
  callAI({
    provider: "newapi",
    apiKey: "k",
    baseUrl: "https://miarouter.online",
    model: "m",
    messages: [{ role: "user", text: "x" }],
    fetchImpl: async () =>
      new Response('<!DOCTYPE html><!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]--><head><title>miarouter.online | 524: A timeout occurred</title></head>', { status: 524 })
  }),
  (error) => {
    assert.match(error.message, /Cloudflare/);
    assert.match(error.message, /HTTP 524/);
    assert.match(error.message, /« miarouter\.online \| 524: A timeout occurred »/);
    assert.ok(!error.message.includes("<!DOCTYPE"), "no raw HTML in the message");
    return true;
  }
);

// A stream that stops sending bytes is aborted after the idle window.
await assert.rejects(
  callAI({
    provider: "openai",
    apiKey: "k",
    model: "m",
    stream: true,
    timeoutMs: 200,
    messages: [{ role: "user", text: "x" }],
    fetchImpl: async () => sse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'], { hangAfter: true })
  }),
  /rien reçu pendant/
);

// PROMPT_PRO continuation: a cut-off output (gateway says "stop" but used the
// whole budget) is continued where it stopped and stitched together.
{
  const { runAiPromptPro } = await import("../lib/generate-prompt-pro.mjs");
  const requests = [];
  const result = await runAiPromptPro({
    messages: [{ role: "user", text: "build" }],
    settings: { provider: "newapi", apiKey: "k", baseUrl: "https://g.io", model: "m" },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (requests.length === 1) {
        return sse([
          'data: {"choices":[{"delta":{"content":"## 6. Sections\\nPOST /api/reser"}}]}\n\n',
          `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":${body.max_tokens}}}\n\ndata: [DONE]\n\n`
        ]);
      }
      return sse([
        'data: {"choices":[{"delta":{"content":"vations\\n## 13. Definition of done"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":40}}\n\ndata: [DONE]\n\n'
      ]);
    }
  });
  assert.equal(result.content, "## 6. Sections\nPOST /api/reservations\n## 13. Definition of done", "continuation is stitched seamlessly");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-2).role, "assistant", "continuation resends the partial document");
  assert.match(requests[1].messages.at(-1).content, /Continue the document exactly where it stopped/);
}

// A gateway that drops the stream mid-way ("terminated", seen with
// gpt-6-astra on MiaRouter): the partial text is kept and continued.
{
  const { runAiPromptPro } = await import("../lib/generate-prompt-pro.mjs");
  let calls = 0;
  const result = await runAiPromptPro({
    messages: [{ role: "user", text: "build" }],
    settings: { provider: "newapi", apiKey: "k", baseUrl: "https://g.io", model: "m" },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"## 1. Mission\\nBuild the"}}]}\n\n'));
            setTimeout(() => controller.error(new TypeError("terminated")), 20);
          }
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      return sse(['data: {"choices":[{"delta":{"content":" food-truck site."}}]}\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\ndata: [DONE]\n\n']);
    }
  });
  assert.equal(result.content, "## 1. Mission\nBuild the food-truck site.", "dropped stream is continued, not lost");
  assert.equal(calls, 2);
}

console.log("AI streaming tests passed.");
