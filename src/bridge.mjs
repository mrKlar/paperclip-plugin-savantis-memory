import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { BRIDGE_TOOLS, executeBridgeTool } from "./bridge-core.mjs";

const server = new Server(
  { name: "paperclip-savantis-memory", version: "0.1.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: BRIDGE_TOOLS.map(({ pluginTool: _pluginTool, ...tool }) => tool),
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const result = await executeBridgeTool(params.name, params.arguments);
    return {
      content: [{ type: "text", text: result.data === undefined ? (result.content ?? result.error ?? "{}") : JSON.stringify(result.data) }],
      ...(result.data === undefined ? {} : { structuredContent: result.data }),
      ...(result.error ? { isError: true } : {}),
    };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : "Memory bridge failed" }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
