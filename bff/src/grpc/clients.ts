import { join } from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";

import { CONFIG, type Config } from "../config";
import { toGraphQLError } from "./errors";
import type { CatalogService, InventoryService, NotificationsService, OrdersService, UsersService } from "./types";

const PROTO_FILES = ["catalog.proto", "inventory.proto", "orders.proto", "users.proto", "notifications.proto"];

// The .proto files are read at startup, as in notifications-service: no generated code.
const LOADER_OPTIONS: protoLoader.Options = {
  keepCase: false,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
};

@Injectable()
export class GrpcClients implements OnModuleDestroy {
  readonly catalog: CatalogService;
  readonly inventory: InventoryService;
  readonly orders: OrdersService;
  readonly users: UsersService;
  readonly notifications: NotificationsService;

  private readonly channels: grpc.Client[] = [];

  constructor(@Inject(CONFIG) config: Config) {
    const definition = protoLoader.loadSync(
      PROTO_FILES.map((file) => join(config.protoDir, file)),
      LOADER_OPTIONS,
    );
    const proto = grpc.loadPackageDefinition(definition) as any;
    const connect = <T>(Service: grpc.ServiceClientConstructor, target: string) =>
      this.connect<T>(Service, target, config.grpcDeadlineMs);

    this.catalog = connect(proto.tcgstore.catalog.CatalogService, config.targets.catalog);
    this.inventory = connect(proto.tcgstore.inventory.InventoryService, config.targets.inventory);
    this.orders = connect(proto.tcgstore.orders.OrdersService, config.targets.orders);
    this.users = connect(proto.tcgstore.users.UsersService, config.targets.users);
    this.notifications = connect(proto.tcgstore.notifications.NotificationsService, config.targets.notifications);
  }

  onModuleDestroy() {
    for (const channel of this.channels) {
      channel.close();
    }
  }

  // Turns every RPC of the service ("GetProduct") into an async method ("getProduct").
  private connect<T>(Service: grpc.ServiceClientConstructor, target: string, deadlineMs: number): T {
    const client = new Service(target, grpc.credentials.createInsecure()) as any;
    this.channels.push(client);

    const api: Record<string, (request: object) => Promise<unknown>> = {};
    for (const method of Object.keys(Service.service)) {
      const name = method[0]!.toLowerCase() + method.slice(1);
      api[name] = (request) =>
        new Promise((resolve, reject) => {
          // Without a deadline, a call to a service that hangs would wait forever.
          client[method](request, { deadline: Date.now() + deadlineMs }, (error: grpc.ServiceError | null, response: unknown) =>
            error ? reject(toGraphQLError(error, Service.serviceName, method)) : resolve(response),
          );
        });
    }
    return api as T;
  }
}
