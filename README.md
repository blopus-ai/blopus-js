# blopus — TypeScript / JavaScript SDK

Official client for the [Blopus](https://blopus.ai) web search + fetch API.
Blopus is a cheap, fast web-search API backed by an owned index — built for bots
and agents.

Works in Node 18+, edge runtimes, and modern browsers (uses global `fetch`).
The SDK calls only two data-plane endpoints: `POST /v1/search` and
`POST /v1/fetch` on `https://api.blopus.ai`.



### Topic filters

```ts
const vocab = await client.topics(100000);     // free, not billed
await client.search({ query: "data breach", topics: ["cybersecurity"] });
await client.search({ query: "world cup", exclude_topics: ["sports"] });
```

Topics are matched **exactly**, so an unknown value returns zero results — call `topics()`
rather than guessing. A topic describes what a **publication** covers, not what an individual
article is about.

### Images

```ts
const res = await client.search({ query: "tesla factory", include_images: true });
for (const r of res.results) {
  if (r.image) console.log(r.title, r.image, `${r.image_w}x${r.image_h}`);
}
```

Off by default — it costs roughly 295 tokens per 10 results. Coverage is partial, so `image`
is `null` on plenty of hits. Never promise a picture before you have a non-null URL.

### Filtering out stubs

Every result carries `word_count`. `min_words` turns that into a filter:

```ts
await client.search({ query: "how does raft consensus work", min_words: 120 });
```

## Install

```bash
npm install blopus
```

## News scoping (`news_only`)

Set `news_only: true` when the question is about **events** — what happened, who
announced what, market reaction, election results, earnings news. It searches only
sources with a real newsroom, over a **dedicated news channel** that is **faster**
than an unscoped search, and it drops the vendor blogs, marketing pages and
documentation that otherwise crowd news results.

```ts
// events → scope it, and pair with a freshness window
await blopus.search({ query: "what did the Fed announce", freshness: "pd", news_only: true });

// documentation / reference → leave it off
await blopus.search({ query: "kubernetes ingress example" });

// wants both the announcement AND the changelog → leave it off
await blopus.search({ query: "what's new in Python 3.14" });
```

Omitting it searches everything, so leaving it off is always the safe choice.

## Authentication

Pass an API key (`blp_live_...`) or set `BLOPUS_API_KEY`:

```bash
export BLOPUS_API_KEY="blp_live_xxx"
```

## Quickstart

```ts
import { Blopus } from "blopus";

const blopus = new Blopus(); // reads BLOPUS_API_KEY

const res = await blopus.search({ query: "who won the game last night", count: 5, freshness: "pd", news_only: true });
for (const hit of res.results) {
  console.log(hit.score, hit.title, hit.url);
}
console.log("remaining quota:", res.remaining_quota);

// Fetch indexed page content
const doc = await blopus.fetch("https://example.com/article");
console.log(doc.title, doc.content.length);
```

## `search(params)`

```ts
await blopus.search({
  query: "openai",
  count: 10,                              // 1..50
  freshness: "all",                       // "pd" | "pw" | "pm" | "p3m" | "p1y" | "all"
  news_only: false,                       // true = newsroom sources only. Faster dedicated news
                                          // channel; drops vendor blogs/docs. Use for events;
                                          // leave off for docs/tutorials/forums, or for both.
  include_domains: ["techcrunch.com"],
  exclude_domains: ["example.com"],
  start_date: "2026-01-01",               // "YYYY-MM-DD" or epoch seconds (string)
  end_date: "2026-02-01",
  language: "en",
  offset: 0,                              // up to 200
  include_excerpt: false,
  excerpt_chars: 800,                     // up to 1200
});
```

Returns `SearchResponse`:

```ts
{
  query: string;
  results: SearchResult[]; // title, url, snippet, domain, site_name, favicon,
                           // published_at, age_seconds, language, score
  count: number;
  offset: number;
  more_results: boolean;
  remaining_quota: number | null;
}
```

Search always costs **1 credit**, regardless of parameters.

## `fetch(url | urls)`

```ts
// single URL -> FetchResult
const doc = await blopus.fetch("https://example.com/a");

// array -> BatchFetchResponse
const batch = await blopus.fetch(["https://a.com", "https://b.com"]);
batch.results;        // FetchResult[] found
batch.failed_results; // FetchFailure[] not found
batch.count;          // number found (== credits billed)
```

Arrays over the server cap of **50 URLs** are automatically split into ≤50-URL
calls, run sequentially with a small delay, and merged. Fetch bills per document
found.

## Errors

All errors extend `BlopusError`:

| Class                | When                                    |
|----------------------|-----------------------------------------|
| `AuthError`          | 401 / 403 — bad, missing or revoked key  |
| `QuotaError`         | 402 — monthly quota exhausted            |
| `RateLimitError`     | 429 — slow down (`.retryAfter`)          |
| `NotFoundError`      | 404 — no indexed content for a URL       |
| `BadRequestError`    | 400 / 413 — malformed / too large        |
| `ServerError`        | 5xx — gateway/backend problem            |
| `APIConnectionError` | network failure (no response)            |

`429` / `5xx` / network errors are retried with exponential backoff (honoring
`Retry-After`); tune with `new Blopus({ maxRetries })`.

## Vercel AI SDK

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { blopusSearchTool } from "blopus/ai";

const { text } = await generateText({
  model: openai("gpt-4o"),
  prompt: "What happened in tech today?",
  tools: { web_search: await blopusSearchTool() },
  maxSteps: 3,
});
```

`ai` is an optional peer dependency — install it only if you use this adapter.

## MCP

Blopus hosts an MCP server (`search` + `fetch` tools) at `https://mcp.blopus.ai`
using the same Bearer auth.

```ts
import { mcpConfig } from "blopus";
console.log(JSON.stringify(mcpConfig(), null, 2));
```

## CLI

```bash
npx blopus search "who won the game" --count 5 --freshness pd --news-only
npx blopus fetch https://example.com/a https://example.com/b
npx blopus mcp-config
```

## License

MIT
