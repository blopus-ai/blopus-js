// MCP config helper. Blopus hosts a streamable-HTTP MCP server (search + fetch
// tools) at https://mcp.blopus.ai, gated by the same Bearer auth as the REST API.

import { DEFAULT_MCP_URL } from "./client.js";

export interface McpServerConfig {
  mcpServers: Record<
    string,
    { type: "http"; url: string; headers: { Authorization: string } }
  >;
}

export function mcpConfig(
  apiKey?: string,
  opts: { url?: string; serverName?: string } = {},
): McpServerConfig {
  const key =
    apiKey ??
    (typeof process !== "undefined" ? process.env?.BLOPUS_API_KEY : undefined);
  if (!key) {
    throw new Error("No API key provided. Pass apiKey or set BLOPUS_API_KEY.");
  }
  const name = opts.serverName ?? "blopus";
  return {
    mcpServers: {
      [name]: {
        type: "http",
        url: opts.url ?? DEFAULT_MCP_URL,
        headers: { Authorization: `Bearer ${key}` },
      },
    },
  };
}
