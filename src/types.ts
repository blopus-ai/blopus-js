// Public types mirroring the deployed Blopus API 1:1.

/** Coarse recency filter. */
export type Freshness = "pd" | "pw" | "pm" | "p3m" | "p1y" | "all";

/** Options for {@link Blopus.search}. */
export interface SearchParams {
  query: string;
  /** 1..50. Default 10. */
  count?: number;
  /** Default "all". */
  freshness?: Freshness;
  /** Restrict to these domains (e.g. ["techcrunch.com"]). */
  include_domains?: string[];
  /** Exclude these domains. */
  exclude_domains?: string[];
  /** Absolute window start: "YYYY-MM-DD" or epoch seconds (as string). */
  start_date?: string;
  /** Absolute window end. */
  end_date?: string;
  /** Language code, e.g. "en". */
  language?: string;
  /** Pagination offset, up to 200. Default 0. */
  offset?: number;
  /** Opt in to longer excerpts. */
  include_excerpt?: boolean;
  /** Excerpt length, up to 1200. */
  excerpt_chars?: number;
  /**
   * Restrict the search to newsroom sources - newspapers, wire services,
   * broadcasters, magazines. Runs over a dedicated news channel, so it is *faster*
   * than an unscoped search rather than slower. Set it for events and current affairs; leave
   * it off when the answer may live in documentation, reference material or forums.
   * Omitting it searches everything, which is always safe.
   */
  /**
   * Only return results whose body has at least this many words (1-5000).
   * About 10-17% of the index is under 120 words: tag listings, stubs and
   * photo captions, which rank on keywords without answering anything.
   */
  min_words?: number;
  news_only?: boolean;
  /**
   * Ranking preference, NOT a filter (that is `freshness`). "normal" leans recent,
   * "relaxed" leans less, "off" ignores age entirely — use "off" for timeless
   * questions where the best answer may be months old.
   */
  recency?: "normal" | "relaxed" | "off";
  /**
   * Return each result's full text inline. One call instead of a search plus N
   * fetches, so it is cheaper when you know you need most results in full.
   */
  include_content?: boolean;
  /** Cap on inline content length per result, up to 8000. */
  content_chars?: number;
  /**
   * Return a hero image URL on each result. Off by default: it costs roughly 295
   * tokens per 10 results, which matters when the caller is a language model.
   * Coverage is partial, so `image` is null on plenty of hits.
   */
  include_images?: boolean;
}

/** One search hit. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string | null;
  site_name: string | null;
  favicon: string | null;
  published_at: number | null;
  age_seconds: number | null;
  language: string | null;
  score: number | null;
  /** Crawl time. `published_at` falls back to this when the article date is unknown. */
  fetched_at?: number | null;
  /** How many near-identical pages were collapsed into this hit. */
  duplicate_count?: number;
  /**
   * Full text — present only when the request set `include_content`. Without that
   * flag it is absent, which is why it is optional rather than nullable.
   */
  content?: string | null;
  /**
   * Body length in words. Always returned, so you can see that a hit is a 40-word
   * stub before reading it — this is what makes `min_words` self-evident.
   */
  word_count?: number | null;
  /**
   * Hero image URL — populated only when the request set `include_images`, and
   * null whenever the page has no hero. Always check it before use.
   */
  image?: string | null;
  /** Hero image dimensions in pixels, when the crawler recorded them. */
  image_w?: number | null;
  image_h?: number | null;
}

/** Response from `POST /v1/search`. */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
  count: number;
  offset: number;
  more_results: boolean;
  remaining_quota: number | null;
  /** True when a `freshness` window was widened because it returned too little. */
  freshness_relaxed?: boolean;
  /** Set when results were served from a degraded path. */
  degraded?: boolean;
}

/** A single fetched document. */
export interface FetchResult {
  url: string;
  canonical_url: string | null;
  title: string;
  content: string;
  domain: string | null;
  published_at: number | null;
  language: string | null;
  found: boolean;
}

/** A URL that had no indexed content. */
export interface FetchFailure {
  url: string;
  found: false;
}

/** Response from a batch `POST /v1/fetch` (a list of URLs). */
export interface BatchFetchResponse {
  results: FetchResult[];
  failed_results: FetchFailure[];
  count: number;
  remaining_quota: number | null;
}

/** Client constructor options. */
export interface BlopusOptions {
  /** `blp_live_...` key. Falls back to `process.env.BLOPUS_API_KEY`. */
  apiKey?: string;
  /** API origin. Default `https://api.blopus.ai`. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 30000. */
  timeout?: number;
  /** Retries on 429 / 5xx / network errors. Default 2. */
  maxRetries?: number;
  /** Delay (ms) between auto-chunked batch-fetch calls. Default 250. */
  chunkDelay?: number;
  /** Override the User-Agent (must be a real UA — CF blocks default lib UAs). */
  userAgent?: string;
  /** Inject a fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
}
