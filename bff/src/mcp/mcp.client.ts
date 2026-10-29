import { Inject, Injectable, Logger } from "@nestjs/common";
import { GraphQLError } from "graphql";

import { CONFIG, type Config } from "../config";

// A confirm makes up to two gRPC calls of 5 s each inside the mcp-server.
const TIMEOUT_MS = 15_000;

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

/** REST client for the mcp-server. It forwards the user's JWT, which the mcp-server verifies again. */
@Injectable()
export class McpClient {
  private readonly logger = new Logger("mcp");

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  confirmAction(authorization: string, actionId: string): Promise<ConfirmedAction> {
    return this.post(authorization, `/actions/${encodeURIComponent(actionId)}/confirm`);
  }

  async cancelAction(authorization: string, actionId: string): Promise<void> {
    await this.post(authorization, `/actions/${encodeURIComponent(actionId)}/cancel`);
  }

  private async post<T>(authorization: string, path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.mcpUrl}${path}`, {
        method: "POST",
        headers: { authorization },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`POST ${path} failed: ${error}`);
      throw new GraphQLError("mcp-server is unavailable", { extensions: { code: "SERVICE_UNAVAILABLE" } });
    }

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.ok) {
      return body as T;
    }
    const code = CLIENT_ERRORS[response.status];
    if (code) {
      throw new GraphQLError(body.error ?? "request rejected", { extensions: { code } });
    }
    this.logger.error(`POST ${path} failed: ${response.status} ${body.error ?? ""}`);
    throw new GraphQLError("internal error", { extensions: { code: "INTERNAL_SERVER_ERROR" } });
  }
}
