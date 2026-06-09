/**
 * MCP Server — runs on port 3001
 *
 * Exposes 3 tools over Streamable HTTP transport.
 * The backend (server.js) connects to this as an MCP client.
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Tool definitions — registered on every fresh server instance per request.
// McpServer can only be connected to one transport at a time, so in stateless
// HTTP mode we create a new instance per request instead of reusing one.
// ---------------------------------------------------------------------------

function buildMcpServer() {
  const server = new McpServer({ name: "demo-tools", version: "1.0.0" });

  // Tool 1 — mocked weather lookup
  server.tool(
    "get_weather",
    "Get current weather conditions for a city",
    { city: z.string().describe("City name, e.g. 'London'") },
    async ({ city }) => {
      const conditions = ["sunny", "cloudy", "rainy", "partly cloudy", "windy"];
      const data = {
        city,
        temperature_c: Math.floor(Math.random() * 30) + 5,
        condition: conditions[Math.floor(Math.random() * conditions.length)],
        humidity_pct: Math.floor(Math.random() * 50) + 30,
        wind_kmh: Math.floor(Math.random() * 40) + 5,
      };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // Tool 2 — real system time for any IANA timezone
  server.tool(
    "get_current_time",
    "Get the current date and time, optionally for a specific IANA timezone",
    {
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone string, e.g. 'America/New_York'. Defaults to UTC."),
    },
    async ({ timezone = "UTC" }) => {
      try {
        const time = new Date().toLocaleString("en-US", {
          timeZone: timezone,
          dateStyle: "full",
          timeStyle: "long",
        });
        return { content: [{ type: "text", text: `${timezone}: ${time}` }] };
      } catch {
        return {
          content: [{ type: "text", text: `Unknown timezone: ${timezone}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 3 — mocked knowledge-base search
  server.tool(
    "search_knowledge_base",
    "Search the internal knowledge base for information on a topic",
    { query: z.string().describe("Search query") },
    async ({ query }) => {
      const kb = {
        mcp: "MCP (Model Context Protocol) is an open protocol by Anthropic that standardises how AI models connect to external tools and data sources.",
        openai: "OpenAI provides GPT-4o and other models via a REST API. Tool/function calling lets models request external actions mid-conversation.",
        webmcp: "WebMCP is a W3C Web Machine Learning proposal that lets browsers act as native MCP clients, currently requiring Chrome Canary.",
        default: `No specific entry found for "${query}". Try rephrasing or ask about: mcp, openai, webmcp.`,
      };
      const key = Object.keys(kb).find((k) => query.toLowerCase().includes(k)) ?? "default";
      return { content: [{ type: "text", text: kb[key] }] };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Handle MCP over HTTP — fresh server + transport instance per request
// ---------------------------------------------------------------------------

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });
  const server = buildMcpServer();
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = buildMcpServer();
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.listen(3001, () => {
  console.log("[MCP Server] Listening on http://localhost:3001/mcp");
});
