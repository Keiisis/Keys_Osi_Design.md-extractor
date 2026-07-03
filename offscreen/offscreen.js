/**
 * Offscreen document: assembles the site clone ZIP.
 *
 * The MV3 service worker cannot use URL.createObjectURL, so the ZIP is
 * built here. Remote assets are fetched with a small concurrency pool
 * (host permissions make cross-origin fetches readable), generated
 * files arrive as text or base64, and the resulting archive is exposed
 * as a blob URL that the service worker hands to chrome.downloads.
 */
import { createZip } from "../lib/zip.mjs";

const activeBlobUrls = new Set();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen") {
    return;
  }

  if (message.type === "TYPEUI_BUILD_ZIP") {
    buildZip(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message.type === "TYPEUI_REVOKE_ZIP") {
    if (message.blobUrl && activeBlobUrls.has(message.blobUrl)) {
      URL.revokeObjectURL(message.blobUrl);
      activeBlobUrls.delete(message.blobUrl);
    }
    sendResponse({ ok: true });
    return;
  }
});

async function buildZip(message) {
  const files = Array.isArray(message.files) ? message.files : [];
  const encoder = new TextEncoder();
  const entries = [];
  const failures = [];

  const remote = [];
  for (const file of files) {
    if (!file || !file.path) {
      continue;
    }
    if (typeof file.content === "string") {
      entries.push({ path: file.path, data: encoder.encode(file.content) });
    } else if (typeof file.base64 === "string") {
      try {
        entries.push({ path: file.path, data: base64ToBytes(file.base64) });
      } catch (error) {
        failures.push({ path: file.path, reason: "invalid base64" });
      }
    } else if (typeof file.url === "string") {
      remote.push(file);
    }
  }

  await fetchWithPool(remote, 6, async (file) => {
    try {
      const response = await fetch(file.url, { credentials: "omit" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      entries.push({ path: file.path, data: new Uint8Array(buffer) });
    } catch (error) {
      failures.push({
        path: file.path,
        reason: error instanceof Error ? error.message : "fetch failed"
      });
    }
  });

  if (entries.length === 0) {
    throw new Error("No files could be added to the archive.");
  }

  const zipBytes = await createZip(entries);
  const blob = new Blob([zipBytes], { type: "application/zip" });
  const blobUrl = URL.createObjectURL(blob);
  activeBlobUrls.add(blobUrl);

  return {
    blobUrl,
    fileCount: entries.length,
    byteLength: zipBytes.length,
    failures: failures.slice(0, 25)
  };
}

async function fetchWithPool(items, poolSize, worker) {
  const queue = [...items];
  const runners = [];
  for (let i = 0; i < Math.min(poolSize, queue.length); i++) {
    runners.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item) {
            await worker(item);
          }
        }
      })()
    );
  }
  await Promise.all(runners);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
