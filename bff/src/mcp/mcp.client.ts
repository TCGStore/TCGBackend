import { Inject, Injectable, Logger } from "@nestjs/common";
import { GraphQLError } from "graphql";

import { CONFIG, type Config } from "../config";

// A confirm makes up to two gRPC calls of 5 s each inside the mcp-server.
const TIMEOUT_MS = 15_000;
// The agent gives up on a message after 90 s.
const CHAT_TIMEOUT_MS = 100_000;

const CLIENT_ERRORS: Record<number, string> = {
  400: "BAD_USER_INPUT",
  401: "UNAUTHENTICATED",
  404: "NOT_FOUND",
  409: "FAILED_PRECONDITION",
  503: "SERVICE_UNAVAILABLE",
};

export interface ConfirmedAction {
  kind: "checkout" | "set_stock";
  result: { id?: string; product_id?: string };
}

export interface ChatReply {
  conversationId: string;
  reply: string;
  actions: { actionId: string; kind: "checkout" | "set_stock"; summary: string; expiresAt: string }[];
}

/** REST client for the mcp-server. It forwards the user's JWT, which the mcp-server verifies again. */
@Injectable()
export class McpClient {
  private readonly logger = new Logger("mcp");

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  chat(authorization: string, message: string, conversationId: string | undefined): Promise<ChatReply> {
    return this.post(authorization, "/chat", { message, conversationId }, CHAT_TIMEOUT_MS);
  }

  confirmAction(authorization: string, actionId: string): Promise<ConfirmedAction> {
    return this.post(authorization, `/actions/${encodeURIComponent(actionId)}/confirm`);
  }

  async cancelAction(authorization: string, actionId: string): Promise<void> {
    await this.post(authorization, `/actions/${encodeURIComponent(actionId)}/cancel`);
  }

  private async post<T>(authorization: string, path: string, body?: object, timeoutMs = TIMEOUT_MS): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.mcpUrl}${path}`, {
        method: "POST",
        headers: { authorization, ...(body && { "content-type": "application/json" }) },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logger.error(`POST ${path} failed: ${error}`);
      throw new GraphQLError("mcp-server is unavailable", { extensions: { code: "SERVICE_UNAVAILABLE" } });
    }

    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.ok) {
      return result as T;
    }
    const code = CLIENT_ERRORS[response.status];
    if (code) {
      throw new GraphQLError(result.error ?? "request rejected", { extensions: { code } });
    }
    this.logger.error(`POST ${path} failed: ${response.status} ${result.error ?? ""}`);
    throw new GraphQLError("internal error", { extensions: { code: "INTERNAL_SERVER_ERROR" } });
  }
}
