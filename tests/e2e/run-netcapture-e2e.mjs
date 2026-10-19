// Live body capture E2E: a POST API call cannot be re-downloaded by URL (GET →
// 405, Chrome says "fichier non disponible"), and a GET behind an API key fails
// the same way. With « Capturer les corps » on, the site's origin gets
// xhr-capture.js at document_start (so a reload re-arms it before the first
// request), the inspector downloads captured bodies as .xhr.json bundles, and
// the Prompts view extracts prompts from the same live traffic.
// Usage: node tests/e2e/run-netcapture-e2e.mjs
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 600)}`}`);
  if (!ok) failures += 1;
};

const PROMPT = "Rédige un email de relance poli pour une facture impayée depuis trente jours.";
const ANSWER = "Objet : Relance concernant la facture n°2024-118 échue depuis trente jours.";
const page = (other) => `<!doctype html><meta charset="utf-8"><title>API site</title>
<script>fetch("/api/history").catch(() => {});</script>
<h1>API</h1>
<script>
  const OTHER = ${JSON.stringify(other)};
  window.callFetch = () => fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: ${JSON.stringify(PROMPT)} }] }) }).then((r) => r.json());
  window.callGet = () => fetch("/api/history").then((r) => r.json());
  window.callMissing = () => fetch("/api/missing").then((r) => r.status);
  window.callApiKey = () => fetch(OTHER + "/rest/v1/prompts?select=id", { headers: { apikey: "k" } }).then((r) => r.json());
  window.callXhr = () => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/xhr-chat");
    x.setRequestHeader("content-type", "application/json");
    x.onload = () => resolve(x.responseText);
    x.send(JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: ${JSON.stringify(PROMPT + " (xhr)")} }] }));
  });
</script>`;

// A Supabase-like API on another origin: CORS *, data only with an apikey header.
const other = createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (!req.headers.apikey) return res.writeHead(401, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify({ message: "No API key found in request" }));
  res.writeHead(200, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify([{ id: 1, title: "Prompt A" }, { id: 2, title: "Prompt B" }]));
});
await new Promise((ok) => other.listen(0, "127.0.0.1", ok));
const otherBase = `http://127.0.0.1:${other.address().port}`;

const server = createServer((req, res) => {
  if (req.url === "/ping") return res.writeHead(200, { "Content-Type": "text/plain" }).end("pong");
  if (req.url === "/api/missing") return res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
  if (req.url === "/api/history" && req.method === "GET") {
    return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: PROMPT }, { role: "assistant", content: ANSWER }] }));
  }
  if (req.url.startsWith("/api/")) {
    if (req.method !== "POST") return res.writeHead(405, { "Content-Type": "text/plain" }).end("Method Not Allowed");
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content: ANSWER } }], finish_reason: "stop" })));
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page(otherBase));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "ko-net-")), {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
});
try {
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const registered = () => worker.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((l) => l.map((s) => s.id)));
  const downloadsNewest = (test) => worker.evaluate(() => chrome.downloads.search({ orderBy: ["-startTime"] })).then((items) => items.find(test));
  const waitComplete = async (test) => {
    let item;
    for (let i = 0; i < 25 && item?.state !== "complete"; i++) {
      await new Promise((r) => setTimeout(r, 200));
      item = await downloadsNewest(test);
    }
    return item;
  };
  const decodeBundle = (item) => JSON.parse(decodeURIComponent(item.url.split(",")[1]))[0];

  const site = await ctx.newPage();
  await site.goto(`${base}/`);
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/popup/popup.html`);
  const tabId = await panel.evaluate(async (b) => (await chrome.tabs.query({ url: `${b}/*` }))[0].id, base);

  // Chrome wires an extension's webRequest listeners asynchronously after the
  // worker starts (--load-extension): wait until passive capture sees traffic.
  let live = false;
  for (let i = 0; i < 40 && !live; i++) {
    await site.evaluate(() => fetch("/ping").then((r) => r.text()));
    await site.waitForTimeout(250);
    live = await panel.evaluate(async (t) => {
      const s = await chrome.runtime.sendMessage({ type: "MODELS_STATE", tabId: t, withRequests: true });
      return (s.requests || []).some((r) => !r.origin && /\/ping$/.test(r.url));
    }, tabId);
  }
  check("passive webRequest capture is live", live);

  const first = await site.evaluate(() => window.callFetch());
  check("site: POST /api/chat answers before capture", first?.finish_reason === "stop", first);
  const keyed = await site.evaluate(() => window.callApiKey());
  check("site: cross-origin GET with apikey answers", Array.isArray(keyed) && keyed.length === 2, keyed);
  await site.evaluate(() => window.callMissing());

  await panel.goto(`chrome-extension://${id}/popup/popup.html?tab=${tabId}`);
  await panel.waitForSelector(".view-tab");
  await panel.setViewportSize({ width: 560, height: 900 });

  // ─── Inspector before capture: honest failures, no Chrome bubble ───
  const toggle = (i) => panel.evaluate((x) => {
    const input = document.getElementById(x);
    input.checked = !input.checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, i);
  const statusAfter = async (label, clickRow, pattern) => {
    await panel.evaluate(() => { document.getElementById("modelsStatus").textContent = ""; });
    await clickRow();
    await panel.waitForFunction((p) => new RegExp(p).test(document.getElementById("modelsStatus").textContent), pattern.source, { timeout: 8000 }).then(
      () => check(label, true),
      async () => check(label, false, await panel.textContent("#modelsStatus"))
    );
    return panel.textContent("#modelsStatus");
  };
  const row = (text) => panel.locator("li.net-row", { hasText: text }).first();
  const download = (text) => () => row(text).getByRole("button", { name: "Télécharger" }).click();

  await panel.click('.view-tab[data-view="models"]');
  await panel.waitForSelector("#netPanel", { state: "attached" });
  await panel.evaluate(() => { document.getElementById("netPanel").open = true; });
  await panel.waitForSelector("#netBodies", { state: "attached" });
  if (await panel.isChecked("#optSaveAs")) await toggle("optSaveAs"); // silent downloads (no save dialog in headless)
  await row("/api/chat").waitFor({ timeout: 8000 });
  await panel.waitForTimeout(2000); // let the auto page scan (Resource Timing) land
  const subs = await panel.locator("li.net-row", { hasText: "/api/chat" }).locator(".net-sub").allTextContents();
  check("inspector lists the POST once, with its method", subs.length === 1 && /^POST/.test(subs[0].trim()), subs);
  check("body capture is off by default", !(await panel.isChecked("#netBodies")));

  await statusAfter("uncaptured POST: explains how to capture it", download("/api/chat"), /Capturer les corps/);
  await statusAfter("GET that 404s: names the status instead of Chrome's bubble", download("/api/missing"), /HTTP 404/);
  const keyedStatus = await statusAfter("GET behind an API key: names HTTP 401", download("rest/v1/prompts"), /HTTP 401/);
  check("cross-origin probe is not refused by CORS (no « Failed to fetch »)", !/Failed to fetch/.test(keyedStatus), keyedStatus);
  check("no download was created before capture", (await worker.evaluate(() => chrome.downloads.search({}).then((d) => d.length))) === 0);

  // ─── Capture on: origin armed at document_start, survives a reload ───
  await toggle("netBodies");
  await panel.waitForFunction(() => /capturés en direct/.test(document.getElementById("modelsStatus").textContent), null, { timeout: 5000 });
  check("page fetch/XHR are patched after toggling capture", await site.evaluate(() => Boolean(window.__KOE_ORIG_FETCH__ && window.__KOE_NET_LOG__)));
  check("site origin registered as a document_start script", (await registered()).includes(`koe-net:${base}`), await registered());

  await site.reload();
  await site.waitForLoadState("load");
  check("after a reload the page is patched without any injection", await site.evaluate(() => Boolean(window.__KOE_ORIG_FETCH__)));
  await site.waitForFunction(() => (window.__KOE_NET_LOG__ || []).some((e) => e.url.endsWith("/api/history")), null, { timeout: 5000 }).then(
    () => check("load-time request captured (document_start timing)", true),
    async () => check("load-time request captured (document_start timing)", false, await site.evaluate(() => window.__KOE_NET_LOG__))
  );

  await site.evaluate(() => window.callFetch());
  await site.evaluate(() => window.callXhr());
  await site.evaluate(() => window.callGet());
  await site.evaluate(() => window.callMissing());
  await site.evaluate(() => window.callApiKey());
  await site.waitForFunction(() => (window.__KOE_NET_LOG__ || []).length >= 5, null, { timeout: 5000 });
  await site.waitForTimeout(300);
  const log = await site.evaluate(() => window.__KOE_NET_LOG__.map((e) => ({ url: e.url, method: e.method, status: e.status, source: e.source, ct: e.contentType, req: e.requestBody?.length, res: e.responseBody?.length })));
  check("fetch POST captured with both bodies", log.some((e) => e.source === "fetch" && e.url.endsWith("/api/chat") && e.req > 50 && e.res > 50 && e.status === 200), log);
  check("XHR POST captured with both bodies", log.some((e) => e.source === "xhr" && e.url.endsWith("/api/xhr-chat") && e.req > 50 && e.res > 50), log);
  check("GET returning JSON captured (response only)", log.some((e) => e.method === "GET" && e.url.endsWith("/api/history") && e.req == null && e.res > 50), log);
  check("cross-origin GET with apikey captured with its JSON", log.some((e) => e.method === "GET" && e.url.includes("/rest/v1/prompts") && e.status === 200 && e.res > 20), log);
  check("GET returning non-JSON is not logged", !log.some((e) => e.url.endsWith("/api/missing")), log);

  // ─── Inspector downloads from the capture ───
  await statusAfter("captured POST downloads as a bundle", download("/api/chat"), /Corps capturé enregistré/);
  const dl = await waitComplete((d) => /^data:application\/json/.test(d.url) && /api(%2F|\/)chat/.test(d.url));
  check("POST bundle completed (no « fichier non disponible »)", dl?.state === "complete" && !dl?.error, dl && { state: dl.state, error: dl.error });
  if (dl) {
    const bundle = decodeBundle(dl);
    check("bundle carries the exact request prompt", bundle.requestBody?.messages?.[0]?.content === PROMPT, bundle.requestBody);
    check("bundle carries the exact response", bundle.responseBody?.choices?.[0]?.message?.content === ANSWER, bundle.responseBody);
    check("bundle names method and status", bundle.method === "POST" && bundle.status === 200, bundle);
  }
  await statusAfter("captured GET behind an API key downloads as a bundle", download("rest/v1/prompts"), /Corps capturé enregistré/);
  const keyedDl = await waitComplete((d) => /^data:application\/json/.test(d.url) && /rest(%2F|\/)v1/.test(d.url));
  check("API-key GET bundle completed", keyedDl?.state === "complete", keyedDl && { state: keyedDl.state, error: keyedDl.error });
  if (keyedDl) {
    const got = decodeBundle(keyedDl);
    check("API-key GET bundle has the JSON the page received", got.method === "GET" && got.requestBody == null && got.responseBody?.[1]?.title === "Prompt B", got);
  }

  // ─── Prompts view: same traffic → prompt list, poll survives a reload ───
  await panel.click('.view-tab[data-view="prompts"]');
  await panel.waitForSelector("#promptNetCapture", { state: "attached" });
  await toggle("promptNetCapture");
  await panel.waitForFunction(() => /Capture/.test(document.getElementById("promptStatus").textContent), null, { timeout: 5000 });
  await panel.waitForFunction((p) => document.getElementById("promptList").textContent.includes(p), PROMPT, { timeout: 10000 }).then(
    () => check("prompts view extracts the prompt from captured entries", true),
    async () => check("prompts view extracts the prompt from captured entries", false, await panel.textContent("#promptStatus"))
  );
  check("prompts view lists the response too", (await panel.textContent("#promptList")).includes("2024-118"));
  await site.reload();
  await site.waitForLoadState("load");
  await site.evaluate(() => window.callFetch());
  await panel.evaluate(() => { document.getElementById("promptStatus").textContent = ""; });
  await panel.waitForFunction(() => /requête\(s\) lue\(s\)/.test(document.getElementById("promptStatus").textContent), null, { timeout: 10000 }).then(
    () => check("prompts poll keeps reading after the page reloaded (cursor reset)", true),
    async () => check("prompts poll keeps reading after the page reloaded (cursor reset)", false, await panel.textContent("#promptStatus"))
  );

  // ─── Stop from Prompts: page restored, origin disarmed, inspector follows ───
  await toggle("promptNetCapture");
  await panel.waitForFunction(() => /arrêtée/.test(document.getElementById("promptStatus").textContent), null, { timeout: 5000 });
  check("stop restores the native fetch and drops the log", await site.evaluate(() => window.fetch.toString().includes("native code") && !window.__KOE_NET_LOG__));
  check("stop unregisters the origin script", !(await registered()).includes(`koe-net:${base}`), await registered());
  await site.reload();
  await site.waitForLoadState("load");
  check("a reload after stop is not patched", await site.evaluate(() => !window.__KOE_ORIG_FETCH__));
  await panel.click('.view-tab[data-view="models"]');
  await panel.waitForTimeout(600);
  check("inspector checkbox reflects the stopped capture", !(await panel.isChecked("#netBodies")));

  // ─── Closing the last tab of a captured site disarms it ───
  await toggle("netBodies");
  await panel.waitForFunction(() => /capturés en direct/.test(document.getElementById("modelsStatus").textContent), null, { timeout: 5000 });
  check("re-armed from the inspector", (await registered()).includes(`koe-net:${base}`));
  await site.close();
  let gone = false;
  for (let i = 0; i < 25 && !gone; i++) {
    await new Promise((r) => setTimeout(r, 200));
    gone = !(await registered()).includes(`koe-net:${base}`);
  }
  check("closing the site's last tab unregisters its script", gone, await registered());
} finally {
  await ctx.close();
  server.close();
  other.close();
}
if (failures) {
  console.log(`\n${failures} net-capture check(s) failed.`);
  process.exit(1);
}
console.log("\nNet-capture E2E passed.");
