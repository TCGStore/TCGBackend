import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";

import type { PendingActions } from "./actions.js";
import type { Agent } from "./agent.js";
import { type Identity, verifyBearer } from "./auth.js";
import type { Conversations } from "./conversations.js";
import { type GrpcClients, ToolError } from "./grpc.js";
import { createMcpServer } from "./mcp.js";

interface Deps {
  jwtSecret: string;
  grpc: GrpcClients;
  actions: PendingActions;
  /** Null without ANTHROPIC_API_KEY. */
  agent: Agent | null;
  conversations: Conversations;
}

const chatBody = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().optional(),
});

export function createApp({ jwtSecret, grpc, actions, agent, conversations }: Deps): Express {
  // No Host header allow-list: it protects unauthenticated localhost servers, and
  // here every route except /health needs the user's JWT.
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const identity = verifyBearer(req.headers.authorization, jwtSecret);
    if (!identity) {
      res.status(401).json({ error: "missing, invalid or expired Bearer token" });
      return;
    }
    res.locals.identity = identity;
    next();
  };

  const mcp = toNodeHandler(
    createMcpHandler(({ authInfo }) => createMcpServer({ identity: authInfo!.extra!.identity as Identity, grpc, actions })),
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.all("/mcp", authenticate, (req, res) => {
    const identity: Identity = res.locals.identity;
    const token = req.headers.authorization!.slice("Bearer ".length);
    Object.assign(req, { auth: { token, clientId: identity.userId, scopes: [identity.role], extra: { identity } } });
    return mcp(req, res, req.body);
  });

  app.post("/chat", authenticate, async (req, res) => {
    if (!agent) {
      res.status(503).json({ error: "the assistant is not configured (ANTHROPIC_API_KEY)" });
      return;
    }
    const body = chatBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "message must have 1 to 2000 characters" });
      return;
    }

    const identity: Identity = res.locals.identity;
    await respond(res, async () => {
      const conversation = conversations.open(identity, body.data.conversationId);
      if (conversation.busy) {
        throw new ToolError("the assistant is still answering the previous message", 409);
      }
      conversation.busy = true;
      try {
        const turn = await agent.reply({ identity, grpc, actions }, conversation.messages, body.data.message);
        conversations.save(conversation, turn.messages);
        return { conversationId: conversation.id, reply: turn.reply, actions: turn.actions };
      } finally {
        conversation.busy = false;
      }
    });
  });

  // Only the user's click reaches these (through the BFF); the model has no tool for them.
  app.post("/actions/:id/confirm", authenticate, async (req, res) => {
    await respond(res, () => actions.confirm(res.locals.identity, req.params.id as string));
  });

  app.post("/actions/:id/cancel", authenticate, async (req, res) => {
    await respond(res, async () => {
      actions.cancel(res.locals.identity, req.params.id as string);
      return { cancelled: true };
    });
  });

  return app;
}

async function respond(res: Response, run: () => Promise<object>) {
  try {
    res.json(await run());
  } catch (error) {
    if (error instanceof ToolError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("action failed", error);
    res.status(500).json({ error: "internal error" });
  }
}
