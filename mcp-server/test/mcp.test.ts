import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PendingActions } from "../src/actions.js";
import { createApp } from "../src/app.js";
import { createGrpcClients, type GrpcClients } from "../src/grpc.js";
import { PROTO_DIR, startFakeServices } from "./fake-services.js";

const SECRET = "test-secret-with-at-least-32-characters";

let services: Awaited<ReturnType<typeof startFakeServices>>;
let grpc: GrpcClients;
let server: Server;
let baseUrl: string;
const clients: Client[] = [];

function tokenFor(role: "customer" | "admin", userId = "usr_misty") {
  return jwt.sign({ sub: userId, email: "misty@example.com", role }, SECRET, { algorithm: "HS256" });
}

async function connect(token: string) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: object = {}) {
  const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
  const text = (result.content[0] as { text: string }).text;
  return { isError: result.isError ?? false, text, json: () => JSON.parse(text) };
}

function callsTo(method: string) {
  return services.calls.filter((c) => c.method === method);
}

async function postAction(path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  services = await startFakeServices();
  grpc = createGrpcClients({
    port: 0,
    jwtSecret: SECRET,
    protoDir: PROTO_DIR,
    grpcDeadlineMs: 2000,
    targets: Object.fromEntries(
      ["catalog", "orders", "inventory", "users", "notifications"].map((name) => [name, services.target]),
    ) as any,
  });
  const app = createApp({ jwtSecret: SECRET, grpc, actions: new PendingActions() });
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  grpc?.close();
  services?.stop();
});

beforeEach(() => {
  services.calls.length = 0;
  services.carts.clear();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("access", () => {
  it("rejects requests without a valid token", async () => {
    const response = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    expect(response.status).toBe(401);

    const forged = jwt.sign({ sub: "usr_misty", email: "m@x.com", role: "admin" }, "another-secret-of-32-characters!!");
    await expect(connect(forged)).rejects.toThrow();
  });

  it("lists admin tools only to admins", async () => {
    const customer = (await (await connect(tokenFor("customer"))).listTools()).tools.map((tool) => tool.name);
    const admin = (await (await connect(tokenFor("admin"))).listTools()).tools.map((tool) => tool.name);

    expect(customer).toContain("search_products");
    expect(customer).not.toContain("set_stock");
    expect(customer).not.toContain("list_low_stock");
    expect(admin).toEqual(expect.arrayContaining(["set_stock", "list_low_stock"]));
  });
});

describe("catalog tools", () => {
  it("searches in dollars and includes the stock of the whole page in one call", async () => {
    const client = await connect(tokenFor("customer"));
    const result = await call(client, "search_products", { type: "CARD", energy_type: "Water", max_price_usd: 30 });

    expect(result.isError).toBe(false);
    expect(callsTo("CatalogService.SearchProducts")[0]!.request).toMatchObject({
      type: "PRODUCT_TYPE_CARD",
      energyType: "Water",
      maxPriceCents: 3000,
      page: 1,
      pageSize: 20,
    });
    expect(callsTo("InventoryService.GetStocks")).toHaveLength(1);
    expect(result.json().products[0]).toEqual({
      id: "prd_blastoise",
      name: "Blastoise ex",
      type: "CARD",
      price_usd: 8.99,
      available: 2,
      card: {
        set: "151 (MEW)",
        number: "009/165",
        rarity: "Double Rare",
        language: "en",
        supertype: "POKEMON",
        energy_types: ["Water"],
        condition: "NEAR_MINT",
        grading: "PSA 10",
      },
    });
  });

  it("rejects invalid input before calling any service", async () => {
    const client = await connect(tokenFor("customer"));
    const result = await call(client, "search_products", { type: "TOY" });

    expect(result.isError).toBe(true);
    expect(callsTo("CatalogService.SearchProducts")).toHaveLength(0);
  });
});

describe("cart and orders", () => {
  it("uses the user from the token and passes service errors to the model", async () => {
    const client = await connect(tokenFor("customer", "usr_ash"));
    const added = await call(client, "add_to_cart", { product_id: "prd_blastoise", quantity: 2 });
    expect(added.json()).toMatchObject({ total_usd: 17.98 });
    expect(callsTo("OrdersService.AddCartItem")[0]!.request.userId).toBe("usr_ash");

    const missing = await call(client, "get_order", { order_id: "ord_x" });
    expect(missing).toMatchObject({ isError: true, text: "order not found" });
  });

  it("only buys after the user confirms through REST, once", async () => {
    const token = tokenFor("customer");
    const client = await connect(token);
    await call(client, "add_to_cart", { product_id: "prd_box", quantity: 1 });

    const pending = (await call(client, "checkout")).json();
    expect(pending).toMatchObject({ kind: "checkout", summary: "Buy 1 product(s) for $149.99" });
    expect(pending.details.shipping_address.city).toBe("Cerulean");
    expect(callsTo("OrdersService.Checkout")).toHaveLength(0);

    const otherUser = await postAction(`/actions/${pending.actionId}/confirm`, tokenFor("customer", "usr_brock"));
    expect(otherUser.status).toBe(404);

    const confirmed = await postAction(`/actions/${pending.actionId}/confirm`, token);
    expect(confirmed).toMatchObject({
      status: 200,
      body: { kind: "checkout", result: { id: "ord_new", status: "PENDING", total_usd: 149.99 } },
    });
    expect(callsTo("OrdersService.Checkout")[0]!.request).toMatchObject({ userId: "usr_misty", userEmail: "misty@example.com" });

    const again = await postAction(`/actions/${pending.actionId}/confirm`, token);
    expect(again.status).toBe(404);
  });

  it("refuses to buy a cart that changed after it was prepared", async () => {
    const token = tokenFor("customer");
    const client = await connect(token);
    await call(client, "add_to_cart", { product_id: "prd_box", quantity: 1 });
    const pending = (await call(client, "checkout")).json();

    await call(client, "add_to_cart", { product_id: "prd_blastoise", quantity: 1 });
    const confirmed = await postAction(`/actions/${pending.actionId}/confirm`, token);

    expect(confirmed.status).toBe(409);
    expect(callsTo("OrdersService.Checkout")).toHaveLength(0);
  });

  it("asks for an address when the profile has none", async () => {
    const client = await connect(tokenFor("customer", "usr_ash"));
    await call(client, "add_to_cart", { product_id: "prd_box", quantity: 1 });

    const result = await call(client, "checkout");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("shipping_address");
  });
});

describe("admin tools", () => {
  it("lists only products that are still low on stock", async () => {
    const client = await connect(tokenFor("admin"));
    const { products } = (await call(client, "list_low_stock")).json();

    expect(products.map((product: { id: string }) => product.id)).toEqual(["prd_box"]);
  });

  it("changes stock only after confirmation", async () => {
    const token = tokenFor("admin");
    const client = await connect(token);
    const pending = (await call(client, "set_stock", { product_id: "prd_box", available: 10 })).json();

    expect(pending.summary).toBe("Set stock of Obsidian Flames Booster Box from 2 to 10");
    expect(callsTo("InventoryService.SetStock")).toHaveLength(0);

    const cancelled = await postAction(`/actions/${pending.actionId}/cancel`, token);
    expect(cancelled.status).toBe(200);
    expect((await postAction(`/actions/${pending.actionId}/confirm`, token)).status).toBe(404);
    expect(callsTo("InventoryService.SetStock")).toHaveLength(0);
  });
});
