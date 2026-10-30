import { randomUUID } from "node:crypto";

import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { Identity } from "./auth.js";

const TTL_MS = 60 * 60 * 1000;

export interface Conversation {
  id: string;
  userId: string;
  /** Everything sent to and received from Claude, including tool calls; the next turn resends it. */
  messages: BetaMessageParam[];
  /** True while a message is being answered: a second one at the same time would mix up the history. */
  busy: boolean;
  expiresAt: number;
}

// In memory like PendingActions (one replica); a restart forgets every conversation.
export class Conversations {
  private readonly conversations = new Map<string, Conversation>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The user's conversation, or a new one when the id is unknown, expired or someone else's. */
  open(identity: Identity, id: string | undefined): Conversation {
    this.dropExpired();
    const existing = id ? this.conversations.get(id) : undefined;
    if (existing && existing.userId === identity.userId) {
      return existing;
    }
    const conversation: Conversation = {
      id: `conv_${randomUUID()}`,
      userId: identity.userId,
      messages: [],
      busy: false,
      expiresAt: this.now() + TTL_MS,
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  save(conversation: Conversation, messages: BetaMessageParam[]): void {
    conversation.messages = messages;
    conversation.expiresAt = this.now() + TTL_MS;
  }

  private dropExpired() {
    const now = this.now();
    for (const [id, conversation] of this.conversations) {
      if (conversation.expiresAt <= now && !conversation.busy) {
        this.conversations.delete(id);
      }
    }
  }
}
