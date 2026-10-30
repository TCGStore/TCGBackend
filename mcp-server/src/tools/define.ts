import { z } from "zod";

import type { PendingActions } from "../actions.js";
import type { Identity } from "../auth.js";
import { type GrpcClients, ToolError } from "../grpc.js";

export interface ToolContext {
  identity: Identity;
  grpc: GrpcClients;
  actions: PendingActions;
}

/** Written once: both the MCP server and the agent's Tool Runner use it. */
export interface Tool<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  inputSchema: Input;
  /** Admin tools aren't even listed for customers. */
  adminOnly?: boolean;
  readOnly: boolean;
  /** Returns a pending action (PendingActionView) that the user confirms with a button. */
  needsConfirmation?: boolean;
  run(input: z.infer<Input>, ctx: ToolContext): Promise<object>;
}

export function defineTool<Input extends z.ZodObject>(tool: Tool<Input>): Tool<Input> {
  return tool;
}

export type ToolOutcome = { ok: true; result: object } | { ok: false; message: string };

// Errors go back to the model as text it can read and react to; unexpected ones are hidden.
export async function runTool(tool: Tool<any>, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: `invalid input: ${z.prettifyError(parsed.error)}` };
  }
  try {
    return { ok: true, result: await tool.run(parsed.data, ctx) };
  } catch (error) {
    if (error instanceof ToolError) {
      return { ok: false, message: error.message };
    }
    console.error(`tool ${tool.name} failed`, error);
    return { ok: false, message: "internal error" };
  }
}
