/**
 * Self-update E2E: an unpacked install whose manifest.json changed on disk
 * (new version + webRequest permission) must keep its worker alive and
 * reload itself when the popup opens.
 *
 * Verified up to the chrome.runtime.reload() call: the Playwright Chromium
 * build does not re-enable command-line-loaded extensions after a reload
 * (even for a version-only change), so the post-reload state is checked in
 * a real Chrome (Load unpacked).
 *
 * Usage: node tests/e2e/run-update-e2e.mjs
 */
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const work = await mkdtemp(join(tmpdir(), "keys-osi-update-"));
const ext = join(work, "ext");
await cp(ROOT, ext, {
  recursive: true,
  filter: (src) => !/[\\/](node_modules|\.git|\.audit|tests|graphify-out)([\\/]|$)/.test(src)
});
const manifestPath = join(ext, "manifest.json");
const current = JSON.parse(await readFile(manifestPath, "utf8"));

// The previous install: older version, no webRequest.
const old = { ...current, version: "0.14.0", permissions: current.permissions.filter((p) => p !== "webRequest") };
await writeFile(manifestPath, JSON.stringify(old, null, 2));

const context = await chromium.launchPersistentContext(join(work, "profile"), {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
});
try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup/popup.html?tab=1`);
  const before = await page.evaluate(async () => ({
    version: chrome.runtime.getManifest().version,
    state: await chrome.runtime.sendMessage({ type: "MODELS_STATE", tabId: 1 })
  }));
  assert.equal(before.version, "0.14.0");
  assert.equal(before.state.ok, true, "worker keeps answering without webRequest");
  assert.equal(before.state.captureActive, false, "capture reported inactive");
  console.log("  ok - old install: worker alive, 3D capture reported inactive (no crash)");

  // New files land on disk; the running extension is still the old one.
  await writeFile(manifestPath, JSON.stringify(current, null, 2));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html?tab=1`).catch(() => {});
  // reload() closes every extension page: wait for the popup to go away.
  for (let i = 0; i < 40 && !popup.isClosed(); i++) await new Promise((r) => setTimeout(r, 250));
  assert.ok(popup.isClosed(), "popup must call chrome.runtime.reload() when the on-disk manifest is newer");
  console.log(`  ok - popup detected manifest ${current.version} on disk and reloaded the extension`);
  console.log("\nUpdate E2E passed.");
} finally {
  await context.close();
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
