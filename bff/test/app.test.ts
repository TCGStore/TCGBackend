import type { AddressInfo } from "node:net";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import type { Config } from "../src/config";
import { startFakeMcp } from "./fake-mcp";
import { PROTO_DIR, startFakeServices } from "./fake-services";

const SECRET = "test-secret-with-at-least-32-characters";

let services: Awaited<ReturnType<typeof startFakeServices>>;
let mcp: Awaited<ReturnType<typeof startFakeMcp>>;
let app: INestApplication;
let url: string;

function configFor(target: string, overrides: Partial<Config["targets"]> = {}): Config {
  return {
    port: 0,
    jwtSecret: SECRET,
    corsOrigins: [],
    protoDir: PROTO_DIR,
    grpcDeadlineMs: 2000,
    mcpUrl: mcp.url,
    targets: { catalog: target, orders: target, inventory: target, users: target, notifications: target, ...overrides },
  };
}

async function startApp(config: Config) {
  const instance = await NestFactory.create(AppModule.forConfig(config), { logger: false });
  await instance.listen(0);
  const { port } = instance.getHttpServer().address() as AddressInfo;
  return { instance, url: `http://127.0.0.1:${port}/graphql` };
}

function tokenFor(role: "customer" | "admin", id = "usr_ash", secret = SECRET) {
  return new JwtService({ secret }).sign({ sub: id, email: "ash@example.com", role });
}

async function gql(query: string, options: { token?: string; variables?: object; url?: string } = {}) {
  const response = await fetch(options.url ?? url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.token && { authorization: `Bearer ${options.token}` }),
    },
    body: JSON.stringify({ query, variables: options.variables }),
  });
  return (await response.json()) as { data?: any; errors?: { message: string; extensions: { code: string } }[] };
}

function callsTo(method: string) {
  return services.calls.filter((call) => call.method === method);
}

beforeAll(async () => {
  services = await startFakeServices();
  mcp = await startFakeMcp();
  ({ instance: app, url } = await startApp(configFor(services.target)));
});

afterAll(async () => {
  await app?.close();
  services?.stop();
  mcp?.stop();
});

beforeEach(() => {
  services.calls.length = 0;
  mcp.requests.length = 0;
});

describe("catalog", () => {
  it("maps products and loads the stock of the whole page in one GetStocks call", async () => {
    const { data, errors } = await gql(`{
      products(filter: { type: CARD, condition: NEAR_MINT }) {
        totalCount
        items { id type priceCents imageUrl card { supertype condition grading { grade } } sealed { setName } stock { available } }
      }
    }`);

    expect(errors).toBeUndefined();
    expect(data.products.totalCount).toBe(2);
    expect(data.products.items[0]).toEqual({
      id: "prd_pikachu",
      type: "CARD",
      priceCents: 1250,
      imageUrl: null,
      card: { supertype: "POKEMON", condition: "NEAR_MINT", grading: null },
      sealed: null,
      stock: { available: 3 },
    });
    expect(data.products.items[1].sealed).toEqual({ setName: "Obsidian Flames" });

    expect(callsTo("CatalogService.SearchProducts")[0]!.request).toMatchObject({
      type: "PRODUCT_TYPE_CARD",
      condition: "CARD_CONDITION_NEAR_MINT",
      page: 1,
      pageSize: 20,
    });
    expect(callsTo("InventoryService.GetStocks")).toHaveLength(1);
    expect(callsTo("InventoryService.GetStocks")[0]!.request.productIds).toEqual(["prd_pikachu", "prd_etb"]);
  });

  it("returns null for a product that doesn't exist", async () => {
    const { data, errors } = await gql(`{ product(id: "prd_missing") { id } }`);

    expect(errors).toBeUndefined();
    expect(data.product).toBeNull();
  });

  it("still lists products when inventory-service is down", async () => {
    const down = await startApp(configFor(services.target, { inventory: "127.0.0.1:1" }));
    try {
      const { data, errors } = await gql(`{ products { items { id stock { available } } } }`, { url: down.url });

      expect(data.products.items.map((item: any) => item.id)).toEqual(["prd_pikachu", "prd_etb"]);
      expect(data.products.items[0].stock).toBeNull();
      expect(errors?.[0]?.extensions.code).toBe("SERVICE_UNAVAILABLE");
      expect(errors?.[0]?.message).toBe("InventoryService is unavailable");
    } finally {
      await down.instance.close();
    }
  });
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const { errors } = await gql(`{ me { id } }`);

    expect(errors?.[0]?.extensions.code).toBe("UNAUTHENTICATED");
    expect(callsTo("UsersService.GetProfile")).toHaveLength(0);
  });

  it("rejects tokens signed with another secret", async () => {
    const forged = tokenFor("admin", "usr_ash", "another-secret-with-at-least-32-chars");
    const { errors } = await gql(`{ me { id } }`, { token: forged });

    expect(errors?.[0]?.extensions.code).toBe("UNAUTHENTICATED");
  });

  it("takes the user id from the token", async () => {
    const { data } = await gql(`{ me { id role shippingAddress { city } } }`, { token: tokenFor("customer") });

    expect(data.me).toEqual({ id: "usr_ash", role: "CUSTOMER", shippingAddress: { city: "Pallet Town" } });
    expect(callsTo("UsersService.GetProfile")[0]!.request.userId).toBe("usr_ash");
  });

  it("returns the users-service token and converts expiresAt to RFC 3339", async () => {
    const { data } = await gql(`mutation { login(email: "ash@example.com", password: "pikachu123") { token expiresAt } }`);

    expect(data.login).toEqual({ token: "token-from-users-service", expiresAt: "2026-10-29T12:00:00Z" });
  });

  it("keeps the message of client errors from the services", async () => {
    const { errors } = await gql(`mutation { register(input: { email: "a@b.c", password: "x", name: "A" }) { token } }`);

    expect(errors?.[0]).toMatchObject({ message: "email already registered", extensions: { code: "ALREADY_EXISTS" } });
  });

  it("lets only admins change stock", async () => {
    const mutation = `mutation { setStock(productId: "prd_etb", available: 10) { available } }`;

    const asCustomer = await gql(mutation, { token: tokenFor("customer") });
    expect(asCustomer.errors?.[0]?.extensions.code).toBe("FORBIDDEN");
    expect(callsTo("InventoryService.SetStock")).toHaveLength(0);

    const asAdmin = await gql(mutation, { token: tokenFor("admin") });
    expect(asAdmin.data.setStock).toEqual({ available: 10 });
  });

  it("includes admin notifications based on the token role", async () => {
    const customer = await gql(`{ unreadNotificationCount }`, { token: tokenFor("customer") });
    const admin = await gql(`{ unreadNotificationCount }`, { token: tokenFor("admin") });

    expect(customer.data.unreadNotificationCount).toBe(2);
    expect(admin.data.unreadNotificationCount).toBe(5);
  });
});

describe("orders", () => {
  it("checks out with the profile address and the email from the token", async () => {
    const { data, errors } = await gql(`mutation { checkout { id status cancellationReason shippingAddress { city } } }`, {
      token: tokenFor("customer"),
    });

    expect(errors).toBeUndefined();
    expect(data.checkout).toEqual({
      id: "ord_new",
      status: "PENDING",
      cancellationReason: null,
      shippingAddress: { city: "Pallet Town" },
    });
    expect(callsTo("OrdersService.Checkout")[0]!.request).toMatchObject({
      userId: "usr_ash",
      userEmail: "ash@example.com",
    });
  });

  it("asks for an address when the profile has none", async () => {
    const { errors } = await gql(`mutation { checkout { id } }`, { token: tokenFor("customer", "usr_new") });

    expect(errors?.[0]?.extensions.code).toBe("BAD_USER_INPUT");
    expect(callsTo("OrdersService.Checkout")).toHaveLength(0);
  });

  it("adds catalog data to cart lines", async () => {
    const { data } = await gql(`{ cart { totalCents items { quantity product { card { number } } } } }`, {
      token: tokenFor("customer"),
    });

    expect(data.cart).toEqual({ totalCents: 2500, items: [{ quantity: 2, product: { card: { number: "025/165" } } }] });
  });

  it("returns null for another user's order", async () => {
    const { data, errors } = await gql(`{ order(id: "ord_other") { id } }`, { token: tokenFor("customer") });

    expect(errors).toBeUndefined();
    expect(data.order).toBeNull();
  });
});

describe("assistant actions", () => {
  it("confirms a purchase with the user's token and returns the order", async () => {
    const token = tokenFor("customer");
    const { data, errors } = await gql(`mutation { confirmAction(actionId: "act_checkout") { kind order { id status } stock { available } } }`, {
      token,
    });

    expect(errors).toBeUndefined();
    expect(data.confirmAction).toEqual({ kind: "CHECKOUT", order: { id: "ord_1", status: "PENDING" }, stock: null });
    expect(mcp.requests).toEqual([{ path: "/actions/act_checkout/confirm", authorization: `Bearer ${token}` }]);
    expect(callsTo("OrdersService.GetOrder")[0]!.request).toMatchObject({ userId: "usr_ash", orderId: "ord_1" });
  });

  it("returns the current stock after a stock change", async () => {
    const { data } = await gql(`mutation { confirmAction(actionId: "act_stock") { kind stock { productId available } } }`, {
      token: tokenFor("admin"),
    });

    expect(data.confirmAction).toEqual({ kind: "SET_STOCK", stock: { productId: "prd_etb", available: 3 } });
  });

  it("maps mcp-server errors to GraphQL codes", async () => {
    const token = tokenFor("customer");
    const expired = await gql(`mutation { confirmAction(actionId: "act_old") { kind } }`, { token });
    const changed = await gql(`mutation { confirmAction(actionId: "act_changed") { kind } }`, { token });

    expect(expired.errors?.[0]).toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(changed.errors?.[0]).toMatchObject({
      message: "the cart changed after the purchase was prepared: prepare it again",
      extensions: { code: "FAILED_PRECONDITION" },
    });
  });

  it("cancels an action", async () => {
    const { data } = await gql(`mutation { cancelAction(actionId: "act_checkout") }`, { token: tokenFor("customer") });

    expect(data.cancelAction).toBe(true);
    expect(mcp.requests[0]!.path).toBe("/actions/act_checkout/cancel");
  });

  it("doesn't call the mcp-server without a valid token", async () => {
    const { errors } = await gql(`mutation { confirmAction(actionId: "act_checkout") { kind } }`);

    expect(errors?.[0]?.extensions.code).toBe("UNAUTHENTICATED");
    expect(mcp.requests).toHaveLength(0);
  });

  it("reports SERVICE_UNAVAILABLE when the mcp-server is down", async () => {
    const down = await startApp({ ...configFor(services.target), mcpUrl: "http://127.0.0.1:1" });
    try {
      const { errors } = await gql(`mutation { confirmAction(actionId: "act_checkout") { kind } }`, {
        token: tokenFor("customer"),
        url: down.url,
      });
      expect(errors?.[0]).toMatchObject({ message: "mcp-server is unavailable", extensions: { code: "SERVICE_UNAVAILABLE" } });
    } finally {
      await down.instance.close();
    }
  });
});
