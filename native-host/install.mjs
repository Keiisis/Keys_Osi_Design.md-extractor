#!/usr/bin/env node
/**
 * Registers the Keys_Osi native host with Chrome, Chromium, Edge and Brave
 * for the current user (no admin rights). The unpacked extension ID is
 * derived from this folder's path the way Chromium does (SHA-256 of the
 * path, UTF-16LE on Windows), so no argument is needed; store IDs can be
 * added as arguments.
 *
 *   node native-host/install.mjs [extra-extension-id ...] [--uninstall]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOST_NAME = "com.keysosi.host";
const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = resolve(HERE, "..");

/** Chromium's ID for an unpacked extension loaded from `dir`. */
export function unpackedExtensionId(dir, os = platform()) {
  let path = dir;
  if (os === "win32") path = path.replace(/\//g, "\\").replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`);
  const bytes = Buffer.from(path, os === "win32" ? "utf16le" : "utf8");
  const hex = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  return [...hex].map((char) => String.fromCharCode(97 + parseInt(char, 16))).join("");
}

const REGISTRY_ROOTS = ["Software\\Google\\Chrome", "Software\\Chromium", "Software\\Microsoft\\Edge", "Software\\BraveSoftware\\Brave-Browser"];
const UNIX_DIRS =
  platform() === "darwin"
    ? ["Library/Application Support/Google/Chrome", "Library/Application Support/Chromium", "Library/Application Support/Microsoft Edge", "Library/Application Support/BraveSoftware/Brave-Browser"]
    : [".config/google-chrome", ".config/chromium", ".config/microsoft-edge", ".config/BraveSoftware/Brave-Browser"];

function launcherPath() {
  if (platform() === "win32") {
    const bat = join(HERE, "keys-osi-host.bat");
    writeFileSync(bat, `@echo off\r\n"${process.execPath}" "${join(HERE, "keys-osi-host.mjs")}" %*\r\n`);
    return bat;
  }
  const sh = join(HERE, "keys-osi-host.sh");
  writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${join(HERE, "keys-osi-host.mjs")}" "$@"\n`);
  chmodSync(sh, 0o755);
  return sh;
}

function manifestFor(ids, previous) {
  const origins = new Set([...(previous?.allowed_origins || []), ...ids.map((id) => `chrome-extension://${id}/`)]);
  return {
    name: HOST_NAME,
    description: "Keys_Osi native host — advanced reverse engineering (REA) and local tools",
    path: launcherPath(),
    type: "stdio",
    allowed_origins: [...origins]
  };
}

export function install({ extraIds = [], uninstall = false } = {}) {
  const ids = [unpackedExtensionId(EXTENSION_DIR), ...extraIds.filter((id) => /^[a-p]{32}$/.test(id))];
  const done = [];
  if (platform() === "win32") {
    const manifestPath = join(HERE, `${HOST_NAME}.json`);
    if (uninstall) {
      for (const root of REGISTRY_ROOTS) {
        try {
          execFileSync("reg", ["delete", `HKCU\\${root}\\NativeMessagingHosts\\${HOST_NAME}`, "/f"], { stdio: "ignore" });
          done.push(root);
        } catch (error) {}
      }
      rmSync(manifestPath, { force: true });
      return { uninstalled: done };
    }
    const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
    writeFileSync(manifestPath, JSON.stringify(manifestFor(ids, previous), null, 2));
    for (const root of REGISTRY_ROOTS) {
      execFileSync("reg", ["add", `HKCU\\${root}\\NativeMessagingHosts\\${HOST_NAME}`, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], { stdio: "ignore" });
      done.push(`HKCU\\${root}`);
    }
    return { ids, manifest: manifestPath, registered: done };
  }
  for (const base of UNIX_DIRS) {
    const dir = join(homedir(), base, "NativeMessagingHosts");
    const manifestPath = join(dir, `${HOST_NAME}.json`);
    if (uninstall) {
      if (existsSync(manifestPath)) {
        rmSync(manifestPath, { force: true });
        done.push(manifestPath);
      }
      continue;
    }
    mkdirSync(dir, { recursive: true });
    const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
    writeFileSync(manifestPath, JSON.stringify(manifestFor(ids, previous), null, 2));
    done.push(manifestPath);
  }
  return uninstall ? { uninstalled: done } : { ids, registered: done };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const result = install({ extraIds: argv.filter((arg) => !arg.startsWith("--")), uninstall: argv.includes("--uninstall") });
  console.log(JSON.stringify(result, null, 2));
  if (!argv.includes("--uninstall")) console.log("\nHôte Keys_Osi installé. Recharge l'extension puis ouvre la vue Site → Reverse engineering avancé.");
}
