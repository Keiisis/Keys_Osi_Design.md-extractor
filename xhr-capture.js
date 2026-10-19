/**
 * Keys_Osi XHR/fetch interceptor — runs in MAIN world.
 *
 * Patches window.fetch and XMLHttpRequest to capture request and response
 * bodies at the moment they happen (MV3 webRequest never exposes bodies, and
 * a POST endpoint cannot be re-fetched by URL). Entries live in
 * window.__KOE_NET_LOG__ with monotonic ids so readers can poll incrementally.
 *
 * Also registered by sw-prompt.mjs as a document_start content script for the
 * site's origin while capture is on, so a reload re-arms it before the page's
 * first request. No args then: mode defaults to "start".
 *
 * Driven by window.__KOE_NET_ARGS__ = { mode, since, doc, url } set by sw-prompt.mjs:
 *   start  → install patches            → { started } | { already, pending }
 *   stop   → restore originals, drop log → { stopped }
 *   status → { active, pending, last }
 *   read   → entries with id > since     → { active, entries, last }
 *   find   → latest entry for an URL     → { active, entry|null }
 */
(() => {
  const args = window.__KOE_NET_ARGS__ || {};
  delete window.__KOE_NET_ARGS__;
  const MODE = args.mode || "start";
  const log = () => window.__KOE_NET_LOG__ || [];
  const active = () => Boolean(window.__KOE_ORIG_FETCH__);
  const last = () => window.__KOE_NET_SEQ__ || 0;
  const doc = () => window.__KOE_NET_DOC__ || null;

  if (MODE === "status") return { active: active(), pending: log().length, last: last(), doc: doc() };

  if (MODE === "read") {
    // A reload starts a new document with fresh ids: a cursor from the old one restarts at 0.
    const since = args.doc && args.doc !== doc() ? 0 : Number(args.since) || 0;
    return { active: active(), entries: log().filter((e) => e.id > since), last: last(), doc: doc() };
  }

  if (MODE === "find") {
    const entries = log();
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].url === args.url) return { active: active(), entry: entries[i] };
    return { active: active(), entry: null };
  }

  if (MODE === "stop") {
    if (window.__KOE_ORIG_FETCH__) window.fetch = window.__KOE_ORIG_FETCH__;
    if (window.__KOE_ORIG_XHR_OPEN__) XMLHttpRequest.prototype.open = window.__KOE_ORIG_XHR_OPEN__;
    if (window.__KOE_ORIG_XHR_SEND__) XMLHttpRequest.prototype.send = window.__KOE_ORIG_XHR_SEND__;
    delete window.__KOE_NET_LOG__;
    delete window.__KOE_NET_SEQ__;
    delete window.__KOE_NET_DOC__;
    delete window.__KOE_ORIG_FETCH__;
    delete window.__KOE_ORIG_XHR_OPEN__;
    delete window.__KOE_ORIG_XHR_SEND__;
    return { stopped: true };
  }

  if (active()) return { already: true, pending: log().length };

  const LOG_LIMIT = 200;
  const MAX_BODY = 200_000;
  const entries = [];
  window.__KOE_NET_LOG__ = entries;
  window.__KOE_NET_SEQ__ = 0;
  window.__KOE_NET_DOC__ = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const absolute = (u) => { try { return new URL(u, location.href).href; } catch { return String(u); } };

  function push(entry) {
    entry.id = ++window.__KOE_NET_SEQ__;
    entries.push(entry);
    if (entries.length > LOG_LIMIT) entries.splice(0, entries.length - LOG_LIMIT);
  }

  function safeString(body) {
    if (body == null) return null;
    let s;
    if (typeof body === "string") s = body;
    else if (body instanceof URLSearchParams) s = body.toString();
    else if (body instanceof FormData) { try { s = JSON.stringify(Object.fromEntries(body)); } catch { return null; } }
    else if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof ReadableStream) return null;
    else { try { s = JSON.stringify(body); } catch { return null; } }
    return s.length <= MAX_BODY ? s : s.slice(0, MAX_BODY);
  }

  const isJsonLike = (ct) => !ct || /json|text\/plain|x-www-form-urlencoded|event-stream/i.test(ct);
  const hasBody = (method) => /^(POST|PUT|PATCH)$/i.test(method);
  // Writes are always logged (their request body is the prompt); GETs only when the answer is JSON.
  const wantsResponse = (method, ct) => (hasBody(method) ? isJsonLike(ct) : /json/i.test(ct));
  const shouldCapture = (method) => hasBody(method) || /^GET$/i.test(method);

  // ─── fetch ───
  const origFetch = window.fetch;
  window.__KOE_ORIG_FETCH__ = origFetch;

  window.fetch = async function (input, init) {
    const method = (init?.method || input?.method || "GET").toUpperCase();
    const url = absolute(typeof input === "string" ? input : input?.url || String(input));
    let requestBody = null;
    if (hasBody(method)) {
      try {
        if (init?.body != null) requestBody = safeString(init.body);
        else if (input instanceof Request) requestBody = safeString(await input.clone().text());
      } catch { /* body not readable */ }
    }

    const response = await origFetch.apply(this, arguments);

    if (shouldCapture(method)) {
      try {
        const ct = response.headers.get("content-type") || "";
        const base = { ts: Date.now(), url, method, status: response.status, contentType: ct, requestBody, source: "fetch" };
        if (wantsResponse(method, ct)) {
          response.clone().text().then((text) => push({ ...base, responseBody: safeString(text) })).catch(() => push({ ...base, responseBody: null }));
        } else if (hasBody(method)) {
          push({ ...base, responseBody: null });
        }
      } catch { /* never break the page */ }
    }
    return response;
  };

  // ─── XMLHttpRequest ───
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  window.__KOE_ORIG_XHR_OPEN__ = origOpen;
  window.__KOE_ORIG_XHR_SEND__ = origSend;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__koe_method = method;
    this.__koe_url = absolute(typeof url === "string" ? url : String(url));
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const method = (this.__koe_method || "GET").toUpperCase();
    const url = this.__koe_url || "";
    if (shouldCapture(method)) {
      const requestBody = hasBody(method) ? safeString(body) : null;
      this.addEventListener("loadend", function () {
        try {
          const ct = this.getResponseHeader("content-type") || "";
          if (!wantsResponse(method, ct) && !hasBody(method)) return;
          const text = this.responseType === "" || this.responseType === "text" ? this.responseText : null;
          push({
            ts: Date.now(),
            url,
            method,
            status: this.status,
            contentType: ct,
            requestBody,
            responseBody: wantsResponse(method, ct) ? safeString(text) : null,
            source: "xhr"
          });
        } catch { /* never break the page */ }
      }, { once: true });
    }
    return origSend.apply(this, arguments);
  };

  return { started: true };
})();
