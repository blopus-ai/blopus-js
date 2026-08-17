# Changelog

## 0.3.7

- Normalise the `bin` path to `dist/cli.js`. npm rejects the `./` prefix and auto-corrects it,
  so the manifest now says what npm will actually publish.

## 0.3.6

- Point the CLI's docs link at https://blopus.ai/docs/. The previous URL did not resolve.

## 0.3.5

- Search and fetch clients with CLI and MCP config helpers.
