import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Express, NextFunction, Request, Response } from "express";

import type { PendingActions } from "./actions.js";
import { type Identity, verifyBearer } from "./auth.js";
import { type GrpcClients, ToolError } from "./grpc.js";
import { createMcpServer } from "./mcp.js";

interface Deps {
  jwtSecret: string;
  grpc: GrpcClients;
  actions: PendingActions;
}

export function createApp({ jwtSecret, grpc, actions }: Deps): Express {
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
