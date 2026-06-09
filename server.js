/**
 * Backend API — runs on port 3000
 *
 * Responsibilities:
 *   1. Acts as MCP CLIENT — connects to mcp-server.js and fetches tool definitions
 *   2. Acts as LLM bridge  — runs the OpenAI agentic loop (chat → tool_calls → results → chat)
 *   3. Serves the frontend static files
 *   4. Exposes POST /api/chat consumed by the browser chatbot
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------------------------------------------------------------------
// Connect to the MCP server once at startup and keep the client alive
// ---------------------------------------------------------------------------

const mcpClient = new McpClient({ name: "chatbot-backend", version: "1.0.0" });

async function connectMcp() {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3001/mcp")
  );
  await mcpClient.connect(transport);
  console.log("[MCP Client] Connected to MCP server at http://localhost:3001/mcp");
}

// ---------------------------------------------------------------------------
// Convert MCP tool definitions → OpenAI function-calling schema
// ---------------------------------------------------------------------------

function toOpenAITools(mcpTools) {
  return mcpTools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// ---------------------------------------------------------------------------
// Agentic loop — runs until the model produces a final text response
// ---------------------------------------------------------------------------

async function runAgentLoop(userMessage, openAITools) {
  const messages = [{ role: "user", content: userMessage }];
  const toolCallLog = []; // returned to frontend for visibility

  while (true) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: openAITools,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    // Model produced a final answer — done
    if (choice.finish_reason === "stop") {
      return { answer: assistantMsg.content, toolCallLog };
    }

    // Model requested one or more tool calls
    if (choice.finish_reason === "tool_calls") {
      for (const toolCall of assistantMsg.tool_calls) {
        const name = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log(`[Tool Call] ${name}(${JSON.stringify(args)})`);

        // Execute the tool via MCP
        const result = await mcpClient.callTool({ name, arguments: args });
        const resultText = result.content.map((c) => c.text).join("\n");

        toolCallLog.push({ tool: name, args, result: resultText });

        // Feed tool result back to OpenAI
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultText,
        });
      }
      // Loop — send tool results back to the model
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/chat — entry point called by the browser chatbot
// ---------------------------------------------------------------------------

app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    // Fetch available tools from the MCP server every request
    // (in production you'd cache these and invalidate on change)
    const { tools: mcpTools } = await mcpClient.listTools();
    const openAITools = toOpenAITools(mcpTools);

    const { answer, toolCallLog } = await runAgentLoop(message, openAITools);

    res.json({ answer, toolCallLog });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

connectMcp()
  .then(() => {
    app.listen(3000, () => {
      console.log("[API Server] Listening on http://localhost:3000");
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MCP server:", err.message);
    console.error("Make sure mcp-server.js is running first (npm run mcp)");
    process.exit(1);
  });
