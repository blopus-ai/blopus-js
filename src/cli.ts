#!/usr/bin/env node
// Blopus CLI — the web-search layer for AI agents.
// Commands: login, logout, whoami, setup, search, fetch, mcp-config.

import { Blopus } from "./client.js";
import { clearConfigKey, configFilePath, loadConfigKey, saveConfigKey } from "./config.js";
import { AuthError, BlopusError } from "./errors.js";
import { mcpConfig } from "./mcp.js";
import { VERSION } from "./version.js";
import type { BatchFetchResponse, Freshness } from "./types.js";

const SIGNUP_URL = "https://blopus.ai";
const DOCS_URL = "https://blopus.ai/docs/";

// Control characters (avoid embedding raw bytes in source).
const CH_ENTER_N = "\n";
const CH_ENTER_R = "\r";
const CH_EOT = String.fromCharCode(4); // Ctrl-D
const CH_ETX = String.fromCharCode(3); // Ctrl-C
const CH_BS = String.fromCharCode(8); // backspace
const CH_DEL = String.fromCharCode(127); // delete

interface Flags {
  _: string[];
  [key: string]: string | boolean | string[];
}

// Every flag the CLI understands. An unrecognised flag is an ERROR, not something to
// ignore: the bug that motivated this list was `--count=50` parsing as a flag literally
// named "count=50", so `flags.count` was undefined and the CLI silently returned the
// default 10 results while the user believed they had asked for 50. Silent defaults are
// worse than a hard error, because nothing tells you the request was not the one you made.
const KNOWN_FLAGS = new Set([
  "count", "freshness", "recency", "news-only", "offset", "language",
  "include-domains", "exclude-domains", "start-date", "end-date",
  "include-excerpt", "excerpt-chars", "include-content", "content-chars",
  "min-words", "include-images", "topics", "exclude-topics", "min-docs",
  "json", "api-key", "base-url", "no-verify", "help", "version",
]);

// Flags that take no value. `--news-only` and `--news-only=false` must both behave
// sensibly — Boolean("false") is true, so the value form needs real parsing.
const BOOL_FLAGS = new Set([
  "news-only", "include-excerpt", "include-content", "include-images",
  "json", "no-verify", "help", "version",
]);

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      // Accept both `--key value` and `--key=value`; the latter used to be dropped.
      const body = a.slice(2);
      const eq = body.indexOf("=");
      let key = eq === -1 ? body : body.slice(0, eq);
      let value: string | undefined = eq === -1 ? undefined : body.slice(eq + 1);
      if (!KNOWN_FLAGS.has(key)) {
        unknown.push(`--${key}`);
        if (value === undefined && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) i++;
        continue;
      }
      if (value === undefined) {
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(key)) {
          flags[key] = true;
          continue;
        }
        if (next === undefined || next.startsWith("--")) {
          // A value-taking flag with no value: record it as present-but-empty so the
          // command layer can complain about the specific flag.
          flags[key] = true;
          continue;
        }
        flags[key] = next;
        i++;
        continue;
      }
      flags[key] = BOOL_FLAGS.has(key) ? !/^(false|0|no|off)$/i.test(value) : value;
    } else if (a.length > 1 && a[0] === "-" && /^-[hv]+$/.test(a)) {
      // `-h` / `-v` are near-universal; without this they landed in `_` as a bogus
      // command and the CLI answered "No API key found", which is actively misleading.
      for (const ch of a.slice(1)) {
        if (ch === "h") flags.help = true;
        if (ch === "v") flags.version = true;
      }
    } else {
      (flags._ as string[]).push(a);
    }
  }
  if (unknown.length) flags.__unknown = unknown;
  return flags;
}

/** Parse a numeric flag, failing loudly rather than sending NaN upstream. */
function num(v: string | boolean | string[] | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`--${name} needs a value, e.g. --${name} 20`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got "${v}"`);
  return n;
}

/** Read a flag that must carry a string value. */
function str(v: string | boolean | string[] | undefined, name: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`--${name} needs a value`);
  return v;
}

function csv(v: string | boolean | string[] | undefined): string[] | undefined {
  if (typeof v !== "string") return undefined;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function mask(key: string): string {
  return key.length > 20 ? `${key.slice(0, 12)}...${key.slice(-4)}` : "(set)";
}

function activeKey(): { key?: string; source?: string } {
  if (typeof process !== "undefined" && process.env?.BLOPUS_API_KEY) {
    return { key: process.env.BLOPUS_API_KEY, source: "environment variable BLOPUS_API_KEY" };
  }
  const saved = loadConfigKey();
  if (saved) return { key: saved, source: `saved login (${configFilePath()})` };
  return {};
}

const SETUP_STEPS = `Set up your API key (one time):

  1. Create a key:  sign in at ${SIGNUP_URL} -> Dashboard -> API keys -> Create key
     (it looks like  blp_live_xxxxxxxxxxxx)

  2. Save it:       blopus login
     ...paste the key when prompted. It's stored in
     ~/.config/blopus/credentials.json (owner-only) and used automatically.

  3. Use it:        blopus search "spacex latest news" --freshness pd

  Prefer env vars / CI?  export BLOPUS_API_KEY="blp_live_..."
  Prefer one-off?        blopus search "..." --api-key blp_live_...`;

const USAGE = `Blopus ${VERSION} — the web-search layer for AI agents.

${SETUP_STEPS}

Commands:
  blopus login                      save your API key (recommended)
  blopus logout                     remove the saved key
  blopus whoami                     show which key is active
  blopus setup                      show this guide + check your key
  blopus search "<query>" [flags]   search the live web
  blopus fetch <url> [<url> ...]    fetch indexed page content (batch billed per URL)
  blopus mcp-config                 MCP config for Claude Code, Cursor, etc.

Search flags:                       (--flag value and --flag=value both work)
  --count N                    10 | 20 | 30 | 40 | 50 (rounds up; 1 credit per 10)
  --freshness pd|pw|pm|p3m|p1y|all    FILTER by publish date
  --recency normal|relaxed|off        ranking preference only - "off" for timeless
                                      questions where the best answer may be old
  --news-only                  search ONLY sources with a newsroom  (see below)
  --include-domains a.com,b.com       --exclude-domains a.com
  --start-date 2026-01-01             --end-date 2026-06-30
  --language en                --offset N
  --include-excerpt            longer snippet   --excerpt-chars N
  --include-content            full text inline, no second call
                               (cheaper than fetching each result)
  --content-chars N            cap inline content length
  --min-words N                only pages with >= N words (120 drops stubs and
                               tag listings; leave off for breaking news)
  --include-images             hero image URL per result (coverage is partial,
                               so some results will have none)
  --topics a,b                 only publications covering these topics
  --exclude-topics a,b         drop publications covering these topics
                               (run: blopus topics -- for valid values)
  --json                       raw JSON

--news-only — use it for EVENTS:
  Restricts results to sources that employ journalists: newspapers, wire services,
  broadcasters, magazines. It drops the vendor blogs, marketing pages, product
  listings and software docs that otherwise crowd out real reporting, and it runs
  over a dedicated news channel, so it is faster, not slower.

  Use it for        what happened, who announced what, market reaction,
                    election results, earnings news, an ongoing story.
  Leave it off for  documentation, tutorials, forums, reference material —
                    newsrooms do not write those.
  Wants both?       Leave it off. An unscoped search returns everything, so
                    omitting it is never wrong.

Examples:
  # an event — scope it, and add a freshness window for breaking stories
  blopus search "what did the Fed announce" --news-only --freshness pd

  # documentation — leave it off
  blopus search "kubernetes ingress example"

  # wants the announcement AND the changelog — leave it off
  blopus search "what's new in Python 3.14"

  # scope to specific publishers instead
  blopus search "openai" --include-domains reuters.com,ft.com
  blopus fetch https://a.com/x https://b.com/y --json

Auth precedence: --api-key  >  BLOPUS_API_KEY  >  saved login.
Docs: ${DOCS_URL}`;

/** Read a line from stdin with the input hidden (for secrets). */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let buf = "";
    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf-8");
      for (const ch of s) {
        if (ch === CH_ENTER_N || ch === CH_ENTER_R || ch === CH_EOT) {
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(buf.trim());
          return;
        } else if (ch === CH_ETX) {
          process.stdout.write("\n");
          process.exit(130);
        } else if (ch === CH_BS || ch === CH_DEL) {
          buf = buf.slice(0, -1);
        } else if (ch >= " ") {
          buf += ch;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function cmdLogin(flags: Flags): Promise<number> {
  let key = typeof flags["api-key"] === "string" ? (flags["api-key"] as string) : "";
  if (!key) {
    console.log(`Paste your Blopus API key (get one at ${SIGNUP_URL} -> API keys).`);
    key = await promptHidden("API key (hidden): ");
  }
  if (!key) {
    console.error("No key entered.");
    return 1;
  }
  if (!key.startsWith("blp_")) {
    console.error("Warning: that doesn't look like a Blopus key (expected blp_live_...).");
  }
  const path = saveConfigKey(key);
  console.log(`Saved to ${path}  (readable only by you).`);

  if (flags["no-verify"] === true) {
    console.log('Skipped verification. Try:  blopus search "hello" --count 1');
    return 0;
  }
  process.stdout.write("Verifying... ");
  try {
    await new Blopus({ apiKey: key }).search({ query: "blopus setup check", count: 1 });
    console.log("OK - your key works. You're all set!");
    return 0;
  } catch (err) {
    if (err instanceof AuthError) {
      console.log("FAILED.");
      console.error(
        "The key was saved but the server rejected it — double-check you copied the whole key. Re-run `blopus login` to try again.",
      );
      return 1;
    }
    console.log(
      `couldn't verify right now (${(err as Error).message}). Key is saved; try a search later.`,
    );
    return 0;
  }
}

function cmdLogout(): number {
  if (clearConfigKey()) console.log(`Removed saved key (${configFilePath()}).`);
  else console.log("No saved key to remove.");
  return 0;
}

function cmdWhoami(): number {
  const { key, source } = activeKey();
  if (key) {
    console.log(`API key: ${mask(key)}`);
    console.log(`Source:  ${source}`);
    return 0;
  }
  console.log("No API key configured. Run `blopus login` to set one.");
  return 1;
}

function cmdSetup(): number {
  console.log(`Blopus ${VERSION} — the web-search layer for AI agents.\n`);
  console.log(SETUP_STEPS);
  const { key, source } = activeKey();
  if (key) {
    console.log(`\n[ok] Active key: ${mask(key)}  (from ${source})`);
    console.log('     Try it:  blopus search "hello world" --count 1');
  } else {
    console.log("\n[!] No API key yet — run `blopus login` (step 2 above).");
  }
  console.log(`\nMCP (Claude Code, Cursor, Cline, ...):  blopus mcp-config`);
  console.log(`Docs: ${DOCS_URL}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const flags = parseArgs(argv);
  const cmd = (flags._ as string[])[0];
  const apiKey = typeof flags["api-key"] === "string" ? (flags["api-key"] as string) : undefined;

  if (flags.version) {
    console.log(`blopus ${VERSION}`);
    return 0;
  }
  // Reject unknown flags instead of ignoring them. A mistyped or unsupported flag used
  // to be discarded silently, so the command ran with defaults and looked like it had
  // worked — which is how `--count=50` came back with 10 results and no warning.
  if (Array.isArray(flags.__unknown)) {
    console.error(
      `error: unknown flag${flags.__unknown.length > 1 ? "s" : ""}: ${flags.__unknown.join(", ")}\n\n` +
        "Run  blopus --help  for the supported flags.",
    );
    return 1;
  }
  // `blopus --help` / `-h` must show the real usage (flags + examples). Previously it
  // fell through to cmdSetup() because there is no cmd, so the flag list — including
  // --news-only — was unreachable except via e.g. `blopus login --help`.
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!cmd) {
    return cmdSetup();
  }

  if (cmd === "login") return cmdLogin(flags);
  if (cmd === "logout") return cmdLogout();
  if (cmd === "whoami") return cmdWhoami();
  if (cmd === "setup") return cmdSetup();

  if (cmd === "mcp-config") {
    console.log(JSON.stringify(mcpConfig(apiKey), null, 2));
    return 0;
  }

  const baseUrl = typeof flags["base-url"] === "string" ? (flags["base-url"] as string) : undefined;
  const client = new Blopus({ apiKey, baseUrl });

  if (cmd === "search") {
    const query = (flags._ as string[])[1];
    if (!query) {
      console.error("error: search requires a query\n\n" + USAGE);
      return 1;
    }
    const res = await client.search({
      query,
      count: num(flags.count, "count"),
      freshness: (str(flags.freshness, "freshness") as Freshness) || undefined,
      recency: str(flags.recency, "recency") as "normal" | "relaxed" | "off" | undefined,
      news_only: flags["news-only"] === true ? true : undefined,
      include_domains: csv(flags["include-domains"]),
      exclude_domains: csv(flags["exclude-domains"]),
      start_date: str(flags["start-date"], "start-date"),
      end_date: str(flags["end-date"], "end-date"),
      language: str(flags.language, "language"),
      offset: num(flags.offset, "offset"),
      include_excerpt: flags["include-excerpt"] === true || undefined,
      excerpt_chars: num(flags["excerpt-chars"], "excerpt-chars"),
      include_content: flags["include-content"] === true || undefined,
      content_chars: num(flags["content-chars"], "content-chars"),
      min_words: num(flags["min-words"], "min-words"),
      include_images: flags["include-images"] === true || undefined,
      topics: csv(flags.topics),
      exclude_topics: csv(flags["exclude-topics"]),
    });
    if (flags.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      if (res.results.length === 0) console.log("No results.");
      res.results.forEach((r, i) => {
        console.log(`${i + 1}. ${r.title}`);
        console.log(`   ${r.url}`);
        if (r.snippet) console.log(`   ${r.snippet}`);
        // only when asked for AND present — partial coverage is normal
        if (r.image) {
          const dims = r.image_w && r.image_h ? ` (${r.image_w}x${r.image_h})` : "";
          console.log(`   image: ${r.image}${dims}`);
        }
        console.log();
      });
      if (res.remaining_quota != null) {
        console.error(`[remaining quota: ${res.remaining_quota}]`);
      }
    }
    return 0;
  }

  if (cmd === "topics") {
    // Valid values for --topics / --exclude-topics. Not billed: topics are matched
    // exactly, so without a published vocabulary a wrong guess is indistinguishable
    // from a genuine no-match.
    const minDocs = num(flags["min-docs"], "min-docs") ?? 1000;
    const items = await client.topics(minDocs);
    if (flags.json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      for (const t of items) {
        console.log(`${String(t.documents).padStart(12)}  ${t.topic}`);
      }
      console.error(`\n[${items.length} topics with >= ${minDocs} documents]`);
    }
    return 0;
  }

  if (cmd === "fetch") {
    const urls = (flags._ as string[]).slice(1);
    if (urls.length === 0) {
      console.error("error: fetch requires at least one URL");
      return 1;
    }
    const result = urls.length > 1 ? await client.fetch(urls) : await client.fetch(urls[0]);
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    if ("results" in (result as object)) {
      const batch = result as BatchFetchResponse;
      for (const r of batch.results) {
        console.log(`# ${r.title}\n${r.url}\n${r.content.slice(0, 2000)}\n`);
      }
      if (batch.failed_results.length) {
        console.error("Not found: " + batch.failed_results.map((f) => f.url).join(", "));
      }
    } else {
      const doc = result as { title: string; url: string; content: string };
      console.log(`# ${doc.title}\n${doc.url}\n\n${doc.content}`);
    }
    return 0;
  }

  console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
  return 1;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof BlopusError) {
      if (err.code === "no_api_key") {
        console.error(`No API key found. Run \`blopus login\` to save one (get a key at ${SIGNUP_URL}).`);
      } else {
        console.error(`Error: ${err.message}${err.code ? ` (${err.code})` : ""}`);
      }
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  });
