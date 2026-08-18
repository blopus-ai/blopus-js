# Changelog

## 0.4.0

### Added
- `include_images` on `search()` and CLI `--include-images`. Returns a hero image URL per
  result. Off by default: roughly 295 extra tokens per 10 results. Coverage is partial, so
  `result.image` is null on plenty of hits — check before use.
- `SearchResult.image`, `.image_w`, `.image_h`, and `.word_count`.
- The Vercel AI tool now exposes `include_images` and returns `word_count`, so a model can
  see a stub before reading it.
- CLI `--min-words`, which the library supported but the CLI never exposed.


## 0.3.8

- Add `min_words` to `search()` and to the Vercel AI tool schema. Only return results whose
  body has at least that many words. Measured: 10.2% of the news index and 17.3% of the rest
  index are under 120 words.

## 0.3.7

- Normalise the `bin` path to `dist/cli.js`. npm rejects the `./` prefix and auto-corrects it,
  so the manifest now says what npm will actually publish.

## 0.3.6

- Point the CLI's docs link at https://blopus.ai/docs/. The previous URL did not resolve.

## 0.3.5

- Search and fetch clients with CLI and MCP config helpers.
