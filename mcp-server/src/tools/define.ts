import type { z } from "zod";

import type { PendingActions } from "../actions.js";
import type { Identity } from "../auth.js";
import type { GrpcClients } from "../grpc.js";

export interface ToolContext {
  identity: Identity;
  grpc: GrpcClients;
  actions: PendingActions;
}

/** Written once: the MCP server exposes it now, the agent's Tool Runner will use it later. */
export interface Tool<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  inputSchema: Input;
  /** Admin tools aren't even listed for customers. */
  adminOnly?: boolean;
  readOnly: boolean;
  run(input: z.infer<Input>, ctx: ToolContext): Promise<object>;
}

export function defineTool<Input extends z.ZodObject>(tool: Tool<Input>): Tool<Input> {
  return tool;
}
