import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import Anthropic from "@anthropic-ai/sdk";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PendingActions } from "../src/actions.js";
import { Agent } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { Conversations } from "../src/conversations.js";
import { createGrpcClients, type GrpcClients } from "../src/grpc.js";
import { startFakeClaude, text, toolUse } from "./fake-claude.js";
import { PROTO_DIR, startFakeServices } from "./fake-services.js";

const SECRET = "test-secret-with-at-least-32-characters";

let services: Awaited<ReturnType<typeof startFakeServices>>;
let claude: Awaited<ReturnType<typeof startFakeClaude>>;
let grpc: GrpcClients;
const servers: Server[] = [];

function tokenFor(role: "customer" | "admin", userId = "usr_misty") {
  return jwt.sign({ sub: userId, email: "misty@example.com", role }, SECRET, { algorithm: "HS256" });
}

function listen(agent: Agent | null) {
  const app = createApp({ jwtSecret: SECRET, grpc, actions: new PendingActions(), agent, conversations: new Conversations() });
  const server = app.listen(0);
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let baseUrl: string;

async function post(path: string, token: string | null, body?: object, url = baseUrl) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

function lastMessage(request: any) {
  return request.messages.at(-1);
}

beforeAll(async () => {
  services = await startFakeServices();
  claude = await startFakeClaude();
  grpc = createGrpcClients({
    port: 0,
    jwtSecret: SECRET,
    protoDir: PROTO_DIR,
    grpcDeadlineMs: 2000,
    anthropicApiKey: undefined,
    anthropicModel: "claude-opus-5-5",
    targets: Object.fromEntries(
      ["catalog", "orders", "inventory", "users", "notifications"].map((name) => [name, services.target]),
    ) as any,
  });
  const client = new Anthropic({ apiKey: "test-key", baseURL: claude.url, maxRetries: 0 });
  baseUrl = listen(new Agent(client, "claude-opus-5-5"));
});

afterAll(() => {
  servers.forEach((server) => server.close());
  grpc?.close();
  services?.stop();
  claude?.stop();
});

beforeEach(() => {
  services.calls.length = 0;
  services.carts.clear();
  claude.requests.length = 0;
  claude.replies.length = 0;
});

describe("POST /chat", () => {
  it("runs the tools Claude asks for and returns its answer", async () => {
    claude.replies.push(
      toolUse("search_products", { energy_type: "Water", max_price_usd: 30 }),
      text("Tengo Blastoise ex a $8.99."),
    );

    const { status, body } = await post("/chat", tokenFor("customer"), { message: "cartas de agua bajo 30 dólares" });

    expect(status).toBe(200);
    expect(body).toMatchObject({ reply: "Tengo Blastoise ex a $8.99.", actions: [] });
    expect(body.conversationId).toMatch(/^conv_/);
    expect(services.calls.find((c) => c.method === "CatalogService.SearchProducts")!.request).toMatchObject({
      energyType: "Water",
      maxPriceCents: 3000,
    });

    const [first, second] = claude.requests;
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.tools.map((tool: any) => tool.name)).not.toContain("set_stock");
    expect(lastMessage(second).content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_search_products" });
    expect(lastMessage(second).content[0].content).toContain("Blastoise ex");
  });

  it("returns the purchase it prepared, which only runs when the user confirms", async () => {
    claude.replies.push(
      toolUse("add_to_cart", { product_id: "prd_box" }),
      toolUse("checkout"),
      text("Preparé la compra: presiona Confirmar."),
    );
    const token = tokenFor("customer");

    const { body } = await post("/chat", token, { message: "compra la booster box de Obsidian Flames" });

    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]).toMatchObject({ kind: "checkout", summary: "Buy 1 product(s) for $149.99" });
    expect(services.calls.filter((c) => c.method === "OrdersService.Checkout")).toHaveLength(0);

    const confirmed = await post(`/actions/${body.actions[0].actionId}/confirm`, token);
    expect(confirmed).toMatchObject({ status: 200, body: { kind: "checkout", result: { status: "PENDING" } } });
  });

  it("sends tool errors to Claude so it can explain them", async () => {
    claude.replies.push(toolUse("get_order", { order_id: "ord_x" }), text("No encontré ese pedido."));

    await post("/chat", tokenFor("customer"), { message: "¿qué pasó con mi pedido ord_x?" });

    expect(lastMessage(claude.requests[1]).content[0]).toMatchObject({ is_error: true, content: "order not found" });
  });

  it("continues a conversation only for the user who started it", async () => {
    claude.replies.push(text("¡Hola!"), text("Claro."), text("Hola, ¿en qué te ayudo?"));
    const first = await post("/chat", tokenFor("customer"), { message: "hola" });
    const { conversationId } = first.body;

    const second = await post("/chat", tokenFor("customer"), { message: "¿me ayudas?", conversationId });
    const stranger = await post("/chat", tokenFor("customer", "usr_brock"), { message: "hola", conversationId });

    expect(second.body.conversationId).toBe(conversationId);
    expect(claude.requests[1].messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(stranger.body.conversationId).not.toBe(conversationId);
    expect(claude.requests[2].messages).toHaveLength(1);
  });

  it("answers 503 when Claude is unavailable and keeps the conversation as it was", async () => {
    claude.replies.push(text("¡Hola!"));
    const { body } = await post("/chat", tokenFor("customer"), { message: "hola" });

    const failed = await post("/chat", tokenFor("customer"), { message: "¿sigues ahí?", conversationId: body.conversationId });
    claude.replies.push(text("Sí."));
    await post("/chat", tokenFor("customer"), { message: "¿y ahora?", conversationId: body.conversationId });

    expect(failed.status).toBe(503);
    expect(claude.requests.at(-1).messages).toHaveLength(3);
  });

  it("validates the request before calling Claude", async () => {
    const noToken = await post("/chat", null, { message: "hola" });
    const empty = await post("/chat", tokenFor("customer"), { message: "  " });
    const noKey = await post("/chat", tokenFor("customer"), { message: "hola" }, listen(null));

    expect([noToken.status, empty.status, noKey.status]).toEqual([401, 400, 503]);
    expect(claude.requests).toHaveLength(0);
  });
});
