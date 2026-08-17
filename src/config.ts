// Persistent credential store, written by `blopus login` (like `aws configure` /
// `gh auth login`). Honored as a fallback so users never have to touch env vars.
// Node-only (fs/os/path); safe to import in bundles that also run in browsers as
// long as these functions aren't called there.

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function configDir(): string {
  return process.env.BLOPUS_CONFIG_DIR || join(homedir(), ".config", "blopus");
}

export function configFilePath(): string {
  return join(configDir(), "credentials.json");
}

/** Return the API key saved by `blopus login`, or undefined. */
export function loadConfigKey(): string | undefined {
  try {
    const data = JSON.parse(readFileSync(configFilePath(), "utf-8")) as { api_key?: unknown };
    return typeof data.api_key === "string" && data.api_key ? data.api_key : undefined;
  } catch {
    return undefined;
  }
}

/** Persist the API key with owner-only permissions. Returns the file path. */
export function saveConfigKey(apiKey: string): string {
  const file = configFilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ api_key: apiKey }) + "\n", "utf-8");
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best-effort on platforms without POSIX perms */
  }
  return file;
}

/** Delete the stored credential. Returns true if a file was removed. */
export function clearConfigKey(): boolean {
  try {
    rmSync(configFilePath());
    return true;
  } catch {
    return false;
  }
}
