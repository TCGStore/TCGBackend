import { join } from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export const PROTO_DIR = join(import.meta.dirname, "..", "..", "proto");

const PRODUCTS = [
  {
    id: "prd_blastoise",
    name: "Blastoise ex",
    type: "PRODUCT_TYPE_CARD",
    priceCents: 899,
    card: {
      setCode: "MEW",
      setName: "151",
      number: "009/165",
      rarity: "Double Rare",
      language: "en",
      supertype: "CARD_SUPERTYPE_POKEMON",
      types: ["Water"],
      condition: "CARD_CONDITION_NEAR_MINT",
      grading: { company: "PSA", grade: "10" },
    },
  },
  {
    id: "prd_box",
    name: "Obsidian Flames Booster Box",
    type: "PRODUCT_TYPE_BOOSTER_BOX",
    priceCents: 14999,
    sealed: { setCode: "OBF", setName: "Obsidian Flames", language: "en" },
  },
];

const ADDRESS = {
  recipientName: "Misty",
  street: "Gym 2",
  city: "Cerulean",
  region: "Kanto",
  postalCode: "00002",
  country: "JP",
};

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
  const carts = new Map<string, { productId: string; quantity: number }[]>();
  const server = new grpc.Server();

  const cart = (userId: string) => {
    const items = (carts.get(userId) ?? []).map((item) => {
      const product = PRODUCTS.find((p) => p.id === item.productId)!;
      return { ...item, name: product.name, unitPriceCents: product.priceCents, subtotalCents: product.priceCents * item.quantity };
    });
    return { userId, items, totalCents: items.reduce((sum, item) => sum + item.subtotalCents, 0) };
  };

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
    GetProducts: ({ ids }) => ({ products: PRODUCTS.filter((product) => ids.includes(product.id)) }),
    SearchProducts: () => ({ products: PRODUCTS, totalCount: PRODUCTS.length }),
  });
  add(proto.tcgstore.inventory.InventoryService, {
    GetStocks: ({ productIds }) => ({
      stocks: productIds.map((productId: string) => ({ productId, available: 2, reserved: 0, lowStock: productId === "prd_box" })),
    }),
    SetStock: ({ productId, available }) => ({ productId, available, reserved: 0, lowStock: false }),
  });
  add(proto.tcgstore.orders.OrdersService, {
    GetCart: ({ userId }) => cart(userId),
    AddCartItem: ({ userId, productId, quantity }) => {
      if (quantity <= 0) {
        fail(grpc.status.INVALID_ARGUMENT, "quantity must be positive");
      }
      carts.set(userId, [...(carts.get(userId) ?? []), { productId, quantity }]);
      return cart(userId);
    },
    Checkout: ({ userId, shippingAddress }) => {
      const { items, totalCents } = cart(userId);
      carts.delete(userId);
      return {
        id: "ord_new",
        status: "ORDER_STATUS_PENDING",
        items,
        totalCents,
        shippingAddress,
        cancellationReason: "CANCELLATION_REASON_UNSPECIFIED",
        createdAt: "2026-10-29T12:00:00Z",
      };
    },
    GetOrder: () => fail(grpc.status.NOT_FOUND, "order not found"),
  });
  add(proto.tcgstore.users.UsersService, {
    // usr_misty has a saved address; anyone else doesn't.
    GetProfile: ({ userId }) => ({ id: userId, shippingAddress: userId === "usr_misty" ? ADDRESS : null }),
  });
  add(proto.tcgstore.notifications.NotificationsService, {
    ListNotifications: () => ({
      notifications: [
        { id: "n1", type: "NOTIFICATION_TYPE_LOW_STOCK", productId: "prd_box" },
        { id: "n2", type: "NOTIFICATION_TYPE_LOW_STOCK", productId: "prd_blastoise" },
      ],
      totalCount: 2,
    }),
  });

  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) =>
      error ? reject(error) : resolve(port),
    ),
  );

  return {
    target: `127.0.0.1:${port}`,
    calls,
    carts,
    stop: () => server.forceShutdown(),
  };
}
