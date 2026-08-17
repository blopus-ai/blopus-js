// blopus — official TypeScript/JavaScript SDK for the Blopus search + fetch API.

export { Blopus, DEFAULT_BASE_URL, DEFAULT_MCP_URL, BATCH_URL_LIMIT, USER_AGENT } from "./client.js";
export { mcpConfig } from "./mcp.js";
export type { McpServerConfig } from "./mcp.js";
export { VERSION } from "./version.js";
export {
  BlopusError,
  APIConnectionError,
  AuthError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
  QuotaError,
  ServerError,
} from "./errors.js";
export type {
  Freshness,
  SearchParams,
  SearchResult,
  SearchResponse,
  FetchResult,
  FetchFailure,
  BatchFetchResponse,
  BlopusOptions,
} from "./types.js";

import { Blopus } from "./client.js";
export default Blopus;
