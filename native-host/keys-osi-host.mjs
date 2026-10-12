#!/usr/bin/env node
/**
 * Keys_Osi native messaging host. Started by Chrome through
 * chrome.runtime.connectNative("com.keysosi.host"); speaks length-prefixed
 * JSON on stdin/stdout and drives REA (reverse engineering) plus a private
 * headless Chrome. Logs go to a file: stdout is reserved for the protocol.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CdpBrowser, FrameReader, McpClient, REA_PACKAGE, createHost, encodeFrame } from "./host-core.mjs";

const logDir = join(homedir(), ".keys-osi");
mkdirSync(logDir, { recursive: true });
const log = (line) => {
  try {
    appendFileSync(join(logDir, "native-host.log"), `${new Date().toISOString()} ${line}\n`);
  } catch (error) {}
};

const send = (message) => process.stdout.write(encodeFrame(message));
const command = process.env.KEYS_OSI_REA_COMMAND || "npx";
const args = process.env.KEYS_OSI_REA_ARGS ? JSON.parse(process.env.KEYS_OSI_REA_ARGS) : ["-y", REA_PACKAGE, "mcp"];
const mcp = new McpClient({ command, args, log });
const browser = new CdpBrowser({ log });
let current = null;
const host = createHost({ mcp, browser, log, onProgress: (progress) => current && send({ id: current, progress }) });

// One request at a time: progress events always belong to the running one.
let queue = Promise.resolve();
const reader = new FrameReader((message) => {
  queue = queue.then(async () => {
    current = message.id;
    try {
      const result = await host.handle(message);
      send({ id: message.id, ok: true, result });
    } catch (error) {
      log(`error ${message.method}: ${error.stack || error.message}`);
      send({ id: message.id, ok: false, error: error.message });
    }
  });
});

process.stdin.on("data", (chunk) => reader.push(chunk));
process.stdin.on("end", async () => {
  await host.shutdown().catch(() => {});
  process.exit(0);
});
log(`started pid ${process.pid}`);
