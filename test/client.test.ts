// Smoke tests using node:test with an injected mock fetch (no network).
// Run against the compiled output or via a TS runner (tsx):
//   npx tsx --test test/client.test.ts
import assert from "node:assert";
import test from "node:test";
import { Blopus } from "../src/index.js";
import { QuotaError, RateLimitError } from "../src/index.js";

function mockFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {})) as unknown as typeof fetch;
}

test("search parses response and sends a real User-Agent", async () => {
  let seenUA = "";
  let seenPath = "";
  const client = new Blopus({
    apiKey: "blp_live_test",
    fetch: mockFetch((url, init) => {
      seenUA = (init.headers as Record<string, string>)["User-Agent"];
      seenPath = new URL(url).pathname;
      return new Response(
        JSON.stringify({
          query: "cats",
          results: [{ title: "Cats", url: "https://x.com", snippet: "meow", score: 0.9 }],
          count: 1,
          offset: 0,
          more_results: true,
          remaining_quota: 1499,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  });
  const res = await client.search({ query: "cats", count: 1 });
  assert.equal(res.results[0].title, "Cats");
  assert.equal(res.remaining_quota, 1499);
  assert.equal(res.more_results, true);
  assert.equal(seenPath, "/v1/search");
  assert.ok(seenUA.startsWith("blopus-js/"));
});

test("batch fetch auto-chunks over 50 URLs", async () => {
  const calls: number[] = [];
  const client = new Blopus({
    apiKey: "blp_live_test",
    chunkDelay: 0,
    fetch: mockFetch((_url, init) => {
      const body = JSON.parse(String(init.body));
      const urls: string[] = body.urls;
      calls.push(urls.length);
      return new Response(
        JSON.stringify({
          results: urls.map((u) => ({ url: u, title: "t", content: "c" })),
          failed_results: [],
          count: urls.length,
          remaining_quota: 42,
        }),
        { status: 200 },
      );
    }),
  });
  const urls = Array.from({ length: 120 }, (_, i) => `https://x.com/${i}`);
  const res = await client.fetch(urls);
  assert.deepEqual(calls, [50, 50, 20]);
  assert.equal(res.count, 120);
  assert.equal(res.remaining_quota, 42);
});

test("quota error maps to QuotaError", async () => {
  const client = new Blopus({
    apiKey: "blp_live_test",
    fetch: mockFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: "quota_exceeded", message: "exhausted" } }),
          { status: 402 },
        ),
    ),
  });
  await assert.rejects(() => client.search({ query: "x" }), QuotaError);
});

test("429 retries then raises RateLimitError", async () => {
  let n = 0;
  const client = new Blopus({
    apiKey: "blp_live_test",
    maxRetries: 2,
    fetch: mockFetch(() => {
      n++;
      return new Response(
        JSON.stringify({ error: { code: "rate_limited", message: "slow" } }),
        { status: 429, headers: { "Retry-After": "0" } },
      );
    }),
  });
  await assert.rejects(() => client.search({ query: "x" }), RateLimitError);
  assert.equal(n, 3);
});
