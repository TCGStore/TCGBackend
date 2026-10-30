import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";

import { runTool, type ToolContext, toolsFor } from "./tools/index.js";

/** Built per HTTP request, so it only lists the tools this user may call. */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "tcg-store", version: "0.1.0" });
  for (const tool of toolsFor(ctx.identity)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false },
      },
      async (input: unknown): Promise<CallToolResult> => {
        const outcome = await runTool(tool, input, ctx);
        return outcome.ok
          ? { content: [{ type: "text", text: JSON.stringify(outcome.result) }] }
          : { content: [{ type: "text", text: outcome.message }], isError: true };
      },
    );
  }
  return server;
}
