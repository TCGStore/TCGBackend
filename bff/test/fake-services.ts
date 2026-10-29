import { join } from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export const PROTO_DIR = join(__dirname, "..", "..", "proto");

const ADDRESS = {
  recipientName: "Ash Ketchum",
  street: "Route 1",
  city: "Pallet Town",
  region: "Kanto",
  postalCode: "00001",
  country: "JP",
};

const PRODUCTS = [
  {
    id: "prd_pikachu",
    name: "Pikachu",
    type: "PRODUCT_TYPE_CARD",
    priceCents: 1250,
    imageUrl: "",
    description: "",
    card: {
      setCode: "SV1",
      setName: "Scarlet & Violet",
      number: "025/165",
      rarity: "Common",
      language: "en",
      supertype: "CARD_SUPERTYPE_POKEMON",
      types: ["Lightning"],
      condition: "CARD_CONDITION_NEAR_MINT",
    },
  },
  {
    id: "prd_etb",
    name: "Obsidian Flames Elite Trainer Box",
    type: "PRODUCT_TYPE_ELITE_TRAINER_BOX",
    priceCents: 4999,
    imageUrl: "https://img.example/etb.png",
    description: "9 booster packs",
    sealed: { setCode: "OBF", setName: "Obsidian Flames", language: "en" },
  },
];

const CART = {
  userId: "usr_ash",
  items: [{ productId: "prd_pikachu", name: "Pikachu", unitPriceCents: 1250, quantity: 2, subtotalCents: 2500 }],
  totalCents: 2500,
};

function order(id: string, shippingAddress: object = ADDRESS) {
  return {
    id,
    userId: "usr_ash",
    status: "ORDER_STATUS_PENDING",
    items: CART.items,
    totalCents: CART.totalCents,
    shippingAddress,
    cancellationReason: "CANCELLATION_REASON_UNSPECIFIED",
    createdAt: "2026-10-29T12:00:00Z",
    updatedAt: "2026-10-29T12:00:00Z",
  };
}

type Handler = (request: any) => object;

function fail(code: grpc.status, details: string): never {
  throw Object.assign(new Error(details), { code, details });
}

/** The five microservices in one gRPC server built from the real .proto files; requests go to `calls`. */
export async function startFakeServices() {
  const definition = protoLoader.loadSync(
    ["catalog.proto", "inventory.proto", "orders.proto", "users.proto", "notifications.proto"].map((file) =>
      join(PROTO_DIR, file),
    ),
    { keepCase: false, longs: Number, enums: String, defaults: true, oneofs: true },
  );
  const proto = grpc.loadPackageDefinition(definition) as any;
  const calls: { method: string; request: any }[] = [];
  const server = new grpc.Server();

  const add = (Service: grpc.ServiceClientConstructor, handlers: Record<string, Handler>) => {
    const implementation: grpc.UntypedServiceImplementation = {};
    for (const [method, handler] of Object.entries(handlers)) {
      implementation[method] = (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
        calls.push({ method: `${Service.serviceName}.${method}`, request: call.request });
        try {
          callback(null, handler(call.request));
        } catch (error) {
          callback(error as grpc.ServiceError);
        }
      };
    }
    server.addService(Service.service, implementation);
  };

  add(proto.tcgstore.catalog.CatalogService, {
    GetProduct: ({ id }) => PRODUCTS.find((product) => product.id === id) ?? fail(grpc.status.NOT_FOUND, "product not found"),
    GetProducts: ({ ids }) => ({ products: PRODUCTS.filter((product) => ids.includes(product.id)) }),
    SearchProducts: () => ({ products: PRODUCTS, totalCount: PRODUCTS.length }),
  });
  add(proto.tcgstore.inventory.InventoryService, {
    GetStocks: ({ productIds }) => ({
      stocks: productIds.map((productId: string) => ({ productId, available: 3, reserved: 1, lowStock: true })),
    }),
    SetStock: ({ productId, available }) => ({ productId, available, reserved: 0, lowStock: false }),
  });
  add(proto.tcgstore.orders.OrdersService, {
    GetCart: () => CART,
    Checkout: ({ shippingAddress }) => order("ord_new", shippingAddress),
    GetOrder: ({ orderId }) => (orderId === "ord_1" ? order("ord_1") : fail(grpc.status.NOT_FOUND, "order not found")),
  });
  add(proto.tcgstore.users.UsersService, {
    Register: () => fail(grpc.status.ALREADY_EXISTS, "email already registered"),
    Login: ({ email }) => ({
      accessToken: "token-from-users-service",
      expiresAt: 1793275200,
      user: { id: "usr_ash", email, name: "Ash", role: "ROLE_CUSTOMER", createdAt: "2026-10-01T00:00:00Z" },
    }),
    GetProfile: ({ userId }) => ({
      id: userId,
      email: "ash@example.com",
      name: "Ash",
      role: "ROLE_CUSTOMER",
      // Ash has a saved address; anyone else doesn't.
      shippingAddress: userId === "usr_ash" ? ADDRESS : null,
      createdAt: "2026-10-01T00:00:00Z",
    }),
  });
  add(proto.tcgstore.notifications.NotificationsService, {
    GetUnreadCount: ({ includeAdmin }) => ({ count: includeAdmin ? 5 : 2 }),
  });

  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) =>
      error ? reject(error) : resolve(port),
    ),
  );

  return {
    target: `127.0.0.1:${port}`,
    calls,
    stop: () => server.forceShutdown(),
  };
}
