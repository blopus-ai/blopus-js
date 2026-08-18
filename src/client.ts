// The Blopus client. Uses global fetch (Node 18+, edge runtimes, browsers).

import { loadConfigKey } from "./config.js";
import { APIConnectionError, BlopusError, errorFromResponse } from "./errors.js";
import type {
  BatchFetchResponse,
  BlopusOptions,
  FetchResult,
  SearchParams,
  SearchResponse,
} from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://api.blopus.ai";
export const DEFAULT_MCP_URL = "https://mcp.blopus.ai";
export const BATCH_URL_LIMIT = 50; // server cap: <=50 URLs per /v1/fetch call
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

// A *real* User-Agent is mandatory: Cloudflare 1010-blocks default library UAs.
export const USER_AGENT = `blopus-js/${VERSION}`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
}

function backoffMs(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec !== undefined) return retryAfterSec * 1000;
  return Math.min(8000, 2 ** attempt * 500) + Math.floor(Math.random() * 250);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class Blopus {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly chunkDelay: number;
  private readonly userAgent: string;
  private readonly _fetch: typeof fetch;

  constructor(options: BlopusOptions = {}) {
    // Precedence: explicit option > env var > saved login (`blopus login`).
    const apiKey =
      options.apiKey ??
      (typeof process !== "undefined" ? process.env?.BLOPUS_API_KEY : undefined) ??
      (typeof process !== "undefined" ? loadConfigKey() : undefined);
    if (!apiKey) {
      throw new BlopusError(
        "No API key found. Run `blopus login` to save one, or set BLOPUS_API_KEY, or pass { apiKey }.",
        { code: "no_api_key" },
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? 30000;
    this.maxRetries = options.maxRetries ?? 2;
    this.chunkDelay = options.chunkDelay ?? 250;
    this.userAgent = options.userAgent ?? USER_AGENT;
    const f = options.fetch ?? (globalThis.fetch as typeof fetch | undefined);
    if (!f) {
      throw new BlopusError(
        "No fetch implementation available. Use Node 18+, an edge runtime, or pass { fetch }.",
        { code: "no_fetch" },
      );
    }
    this._fetch = f;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let status: number | undefined;
      let retryAfter: number | undefined;
      let text = "";
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        let resp: Response;
        try {
          resp = await this._fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "User-Agent": this.userAgent,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        status = resp.status;
        retryAfter = parseRetryAfter(resp.headers.get("Retry-After"));
        text = await resp.text();
        if (status >= 200 && status < 300) {
          return parseJson<T>(status, text);
        }
      } catch (err) {
        if (attempt >= this.maxRetries) {
          throw new APIConnectionError(`Request failed: ${(err as Error).message}`);
        }
        await sleep(backoffMs(attempt));
        attempt++;
        continue;
      }

      if (RETRY_STATUSES.has(status) && attempt < this.maxRetries) {
        await sleep(backoffMs(attempt, retryAfter));
        attempt++;
        continue;
      }
      throw errorFromResponse(status, safeParse(text), retryAfter);
    }
  }

  /**
   * Run a web search.
   *
   * Cost is 1 credit per block of 10 RESULTS — count 10 is 1 credit, count 50 is 5 —
   * and is unaffected by the other parameters. `include_content` is therefore the
   * cheap way to get full text: one search beats a search plus N fetches.
   */
  async search(params: SearchParams): Promise<SearchResponse> {
    const body: Record<string, unknown> = {
      query: params.query,
      count: params.count ?? 10,
      freshness: params.freshness ?? "all",
      offset: params.offset ?? 0,
    };
    if (params.include_domains?.length) body.include_domains = params.include_domains;
    if (params.exclude_domains?.length) body.exclude_domains = params.exclude_domains;
    if (params.start_date !== undefined) body.start_date = params.start_date;
    if (params.end_date !== undefined) body.end_date = params.end_date;
    if (params.language !== undefined) body.language = params.language;
    if (params.include_excerpt) body.include_excerpt = true;
    if (params.excerpt_chars !== undefined) body.excerpt_chars = params.excerpt_chars;
    // only sent when true: an older gateway would reject an unknown field
    if (params.min_words) body.min_words = params.min_words;
    if (params.news_only) body.news_only = true;
    if (params.recency !== undefined) body.recency = params.recency;
    if (params.include_content) body.include_content = true;
    if (params.content_chars !== undefined) body.content_chars = params.content_chars;
    if (params.include_images) body.include_images = true;
    return this.post<SearchResponse>("/v1/search", body);
  }

  /**
   * Fetch indexed page content.
   * A single URL string resolves to a {@link FetchResult}; an array resolves to a
   * {@link BatchFetchResponse}. Arrays longer than 50 are auto-chunked into
   * <=50-URL calls, run sequentially with a small delay, and merged.
   */
  fetch(url: string): Promise<FetchResult>;
  fetch(urls: string[]): Promise<BatchFetchResponse>;
  async fetch(
    urlOrUrls: string | string[],
  ): Promise<FetchResult | BatchFetchResponse> {
    if (typeof urlOrUrls === "string") {
      return this.post<FetchResult>("/v1/fetch", { url: urlOrUrls });
    }
    if (urlOrUrls.length === 0) {
      throw new BlopusError("fetch() requires at least one URL.", { code: "bad_request" });
    }
    return this.fetchBatch(urlOrUrls);
  }

  private async fetchBatch(urls: string[]): Promise<BatchFetchResponse> {
    const chunks = chunk(urls, BATCH_URL_LIMIT);
    const results: FetchResult[] = [];
    const failed: BatchFetchResponse["failed_results"] = [];
    let remaining: number | null = null;
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0 && this.chunkDelay > 0) await sleep(this.chunkDelay);
      const part = await this.post<BatchFetchResponse>("/v1/fetch", { urls: chunks[i] });
      results.push(...(part.results ?? []));
      failed.push(...(part.failed_results ?? []));
      if (part.remaining_quota != null) remaining = part.remaining_quota;
    }
    return {
      results,
      failed_results: failed,
      count: results.length,
      remaining_quota: remaining,
    };
  }
}

function safeParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function parseJson<T>(status: number, text: string): T {
  const data = safeParse(text);
  if (data === undefined || data === null || typeof data !== "object") {
    throw errorFromResponse(status, {
      error: { code: "invalid_response", message: "Malformed JSON from API." },
    });
  }
  return data as T;
}
