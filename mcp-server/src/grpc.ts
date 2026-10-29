import { join } from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import type { Config } from "./config.js";

// Messages as @grpc/proto-loader returns them (same options as the BFF): camelCase,
// int64 as number, enums by full name ("PRODUCT_TYPE_CARD") and unset scalars as "" or 0.

export interface Product {
  id: string;
  name: string;
  type: string;
  priceCents: number;
  description: string;
  card?: {
    setCode: string;
    setName: string;
    number: string;
    rarity: string;
    language: string;
    supertype: string;
    types: string[];
    condition: string;
    grading: { company: string; grade: string } | null;
  };
  sealed?: { setCode: string; setName: string; language: string };
}

export interface SearchProductsRequest {
  query?: string;
  type?: string;
  setCode?: string;
  language?: string;
  supertype?: string;
  energyType?: string;
  condition?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  gradedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface StockLevel {
  productId: string;
  available: number;
  reserved: number;
  lowStock: boolean;
}

export interface Address {
  recipientName: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface LineItem {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
}

export interface Cart {
  items: LineItem[];
  totalCents: number;
}

export interface Order {
  id: string;
  status: string;
  items: LineItem[];
  totalCents: number;
  shippingAddress: Address;
  cancellationReason: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  orderId: string;
  productId: string;
}

interface Reader {
  userId: string;
  includeAdmin: boolean;
}

export interface GrpcClients {
  catalog: {
    getProducts(request: { ids: string[] }): Promise<{ products: Product[] }>;
    searchProducts(request: SearchProductsRequest): Promise<{ products: Product[]; totalCount: number }>;
  };
  inventory: {
    getStocks(request: { productIds: string[] }): Promise<{ stocks: StockLevel[] }>;
    setStock(request: { productId: string; available: number }): Promise<StockLevel>;
  };
  orders: {
    getCart(request: { userId: string }): Promise<Cart>;
    addCartItem(request: { userId: string; productId: string; quantity: number }): Promise<Cart>;
    updateCartItem(request: { userId: string; productId: string; quantity: number }): Promise<Cart>;
    checkout(request: { userId: string; userEmail: string; shippingAddress: Address }): Promise<Order>;
    getOrder(request: { userId: string; orderId: string }): Promise<Order>;
    listOrders(request: { userId: string; page: number; pageSize: number }): Promise<{ orders: Order[]; totalCount: number }>;
  };
  users: {
    getProfile(request: { userId: string }): Promise<{ shippingAddress: Address | null }>;
  };
  notifications: {
    listNotifications(
      request: Reader & { unreadOnly: boolean; page: number; pageSize: number },
    ): Promise<{ notifications: Notification[]; totalCount: number }>;
  };
  close(): void;
}

/** An error the model can read and act on, e.g. "quantity must be positive". */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// Errors caused by the request keep the service's message; the rest is hidden.
const CLIENT_ERRORS: Partial<Record<grpc.status, number>> = {
  [grpc.status.INVALID_ARGUMENT]: 400,
  [grpc.status.NOT_FOUND]: 404,
  [grpc.status.ALREADY_EXISTS]: 409,
  [grpc.status.FAILED_PRECONDITION]: 409,
};

function toToolError(error: grpc.ServiceError, service: string, method: string): ToolError {
  const status = CLIENT_ERRORS[error.code];
  if (status) {
    return new ToolError(error.details, status);
  }
  console.error(`${service}.${method} failed: ${grpc.status[error.code]} ${error.details}`);
  if (error.code === grpc.status.UNAVAILABLE || error.code === grpc.status.DEADLINE_EXCEEDED) {
    return new ToolError(`${service} is unavailable, try again later`, 503);
  }
  return new ToolError("internal error", 500);
}

const PROTO_FILES = ["catalog.proto", "inventory.proto", "orders.proto", "users.proto", "notifications.proto"];

export function createGrpcClients(config: Config): GrpcClients {
  const definition = protoLoader.loadSync(
    PROTO_FILES.map((file) => join(config.protoDir, file)),
    { keepCase: false, longs: Number, enums: String, defaults: true, oneofs: true },
  );
  const proto = grpc.loadPackageDefinition(definition) as any;
  const channels: grpc.Client[] = [];

  // Turns every RPC of the service ("GetCart") into an async method ("getCart").
  const connect = (Service: grpc.ServiceClientConstructor, target: string): any => {
    const client = new Service(target, grpc.credentials.createInsecure()) as any;
    channels.push(client);
    const api: Record<string, (request: object) => Promise<unknown>> = {};
    for (const method of Object.keys(Service.service)) {
      const name = method[0]!.toLowerCase() + method.slice(1);
      api[name] = (request) =>
        new Promise((resolve, reject) => {
          const deadline = Date.now() + config.grpcDeadlineMs;
          client[method](request, { deadline }, (error: grpc.ServiceError | null, response: unknown) =>
            error ? reject(toToolError(error, Service.serviceName, method)) : resolve(response),
          );
        });
    }
    return api;
  };

  return {
    catalog: connect(proto.tcgstore.catalog.CatalogService, config.targets.catalog),
    inventory: connect(proto.tcgstore.inventory.InventoryService, config.targets.inventory),
    orders: connect(proto.tcgstore.orders.OrdersService, config.targets.orders),
    users: connect(proto.tcgstore.users.UsersService, config.targets.users),
    notifications: connect(proto.tcgstore.notifications.NotificationsService, config.targets.notifications),
    close: () => channels.forEach((channel) => channel.close()),
  };
}
