import { randomUUID } from "node:crypto";

import type { Identity } from "./auth.js";
import { ToolError } from "./grpc.js";

const TTL_MS = 10 * 60 * 1000;

export interface PendingActionView {
  actionId: string;
  kind: string;
  summary: string;
  details: object;
  expiresAt: string;
}

interface PendingAction extends PendingActionView {
  userId: string;
  execute: () => Promise<object>;
}

// Purchases and stock changes wait here until the user confirms through REST, which the model can't reach.
// Kept in memory, so the mcp-server runs as a single replica.
export class PendingActions {
  private readonly actions = new Map<string, PendingAction>();

  constructor(private readonly now: () => number = Date.now) {}

  create(
    identity: Identity,
    kind: string,
    summary: string,
    details: object,
    execute: () => Promise<object>,
  ): PendingActionView {
    this.dropExpired();
    const view = {
      actionId: `act_${randomUUID()}`,
      kind,
      summary,
      details,
      expiresAt: new Date(this.now() + TTL_MS).toISOString(),
    };
    this.actions.set(view.actionId, { ...view, userId: identity.userId, execute });
    return view;
  }

  /** Runs the action once; a second confirm finds nothing. */
  async confirm(identity: Identity, actionId: string): Promise<object> {
    const action = this.take(identity, actionId);
    return action.execute();
  }

  cancel(identity: Identity, actionId: string): void {
    this.take(identity, actionId);
  }

  private take(identity: Identity, actionId: string): PendingAction {
    this.dropExpired();
    const action = this.actions.get(actionId);
    // Another user's action looks the same as a missing one.
    if (!action || action.userId !== identity.userId) {
      throw new ToolError("pending action not found or expired", 404);
    }
    this.actions.delete(actionId);
    return action;
  }

  private dropExpired() {
    const now = this.now();
    for (const [id, action] of this.actions) {
      if (Date.parse(action.expiresAt) <= now) {
        this.actions.delete(id);
      }
    }
  }
}
