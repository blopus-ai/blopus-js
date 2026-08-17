// Vercel AI SDK adapter (subpath: `blopus/ai`).
//
// Returns a tool for `generateText` / `streamText`. The `ai` package is a peer
// dependency, loaded lazily so the base `blopus` install stays dependency-free.
//
//   import { generateText } from "ai";
//   import { openai } from "@ai-sdk/openai";
//   import { blopusSearchTool } from "blopus/ai";
//
//   const { text } = await generateText({
//     model: openai("gpt-4o"),
//     prompt: "What happened in tech today?",
//     tools: { web_search: await blopusSearchTool() },
//     maxSteps: 3,
//   });

import { Blopus } from "./client.js";
import type { Freshness } from "./types.js";

export interface BlopusToolOptions {
  /** Reuse an existing client (otherwise one is created from apiKey/env). */
  client?: Blopus;
  apiKey?: string;
  /** Results per search. Default 10. */
  count?: number;
  /** Default freshness. Default "all". */
  freshness?: Freshness;
  /** Override the tool description shown to the model. */
  description?: string;
}

const DEFAULT_DESCRIPTION =
  "Search the web with Blopus for current events, facts, and pages to read. " +
  "Returns ranked results with title, url and snippet. " +
  "IF THE QUESTION IS ABOUT AN EVENT, set news_only=true - what happened, who " +
  "announced what, latest developments, market reaction, election results, earnings " +
  "news, an ongoing story. It restricts results to sources that employ journalists, " +
  "removing the vendor blogs, marketing pages, product listings and documentation " +
  "that otherwise crowd out actual reporting, so you get better answers to event " +
  "questions. Do NOT set it when the answer lives in documentation, tutorials, forums " +
  "or reference material, because newsrooms do not write those ('how does asyncio " +
  "work', 'kubernetes ingress example'). If the question wants both, leave it off - " +
  "an unscoped search returns everything, so omitting it is never wrong.";

/**
 * Build a Vercel AI SDK tool backed by `Blopus.search`.
 * Async because it lazily imports the `ai` peer dependency.
 */
export async function blopusSearchTool(options: BlopusToolOptions = {}): Promise<unknown> {
  // Variable specifier keeps `ai` out of the core's compile-time module graph.
  const spec = "ai";
  let aiMod: { tool: (def: unknown) => unknown; jsonSchema: (s: unknown) => unknown };
  try {
    aiMod = (await import(spec)) as typeof aiMod;
  } catch {
    throw new Error(
      "blopusSearchTool requires the 'ai' package. Install it: npm install ai",
    );
  }
  const { tool, jsonSchema } = aiMod;
  const client = options.client ?? new Blopus({ apiKey: options.apiKey });
  const count = options.count ?? 10;
  const freshness = options.freshness ?? "all";

  return tool({
    description: options.description ?? DEFAULT_DESCRIPTION,
    parameters: jsonSchema({
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        freshness: {
          type: "string",
          enum: ["pd", "pw", "pm", "p3m", "p1y", "all"],
          description:
            "Recency filter. Use 'pd'/'pw' for time-sensitive queries; 'all' otherwise.",
        },
        min_words: {
          type: "number",
          description:
            "Only return pages with at least this many words. Set 120 when the user " +
            "wants something to READ - analysis, background, a comparison, 'explain', " +
            "'how does'. About 10-17% of the index is tag listings and stubs that rank " +
            "on keywords without answering anything. Leave unset for breaking news, " +
            "where a two-line wire story is a legitimate answer.",
        },
        news_only: {
          type: "boolean",
          description:
            "Set true if the question is about an event - what happened, who announced " +
            "what, latest developments. Restricts results to sources that employ " +
            "journalists. Leave unset for documentation, tutorials, forums or reference " +
            "material, or when the question wants both.",
        },
        recency: {
          type: "string",
          enum: ["normal", "relaxed", "off"],
          description:
            "Ranking preference, unlike freshness which filters. Use 'off' for timeless " +
            "questions where the best answer may be months old.",
        },
        count: {
          type: "number",
          description:
            "Number of results: 10, 20, 30, 40 or 50. Costs 1 credit per 10, so leave it " +
            "at 10 unless you genuinely need more coverage.",
        },
        include_domains: {
          type: "array",
          items: { type: "string" },
          description:
            "Only return results from these hostnames, e.g. [\"arxiv.org\"]. Use when the " +
            "user names a source or you know which site holds the answer.",
        },
        exclude_domains: {
          type: "array",
          items: { type: "string" },
          description: "Drop results from these hostnames.",
        },
        include_content: {
          type: "boolean",
          description:
            "Return each result's full text inline instead of a snippet. Set it when you " +
            "expect to need most results in full - it costs the same as the search, so it " +
            "is cheaper than fetching them one by one. Leave it off when triaging.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({
      query,
      freshness: f,
      news_only,
      min_words,
      recency,
      include_content,
      count: c,
      include_domains,
      exclude_domains,
    }: {
      query: string;
      freshness?: Freshness;
      news_only?: boolean;
      min_words?: number;
      recency?: "normal" | "relaxed" | "off";
      include_content?: boolean;
      count?: number;
      include_domains?: string[];
      exclude_domains?: string[];
    }) => {
      const res = await client.search({
        // the model may ask for more; `count` from the factory stays the default
        query, count: c ?? count, freshness: f ?? freshness, news_only, min_words, recency,
        include_content, include_domains, exclude_domains,
      });
      return {
        results: res.results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          score: r.score,
          // only present when include_content was requested
          ...(r.content ? { content: r.content } : {}),
        })),
        remaining_quota: res.remaining_quota,
      };
    },
  });
}
