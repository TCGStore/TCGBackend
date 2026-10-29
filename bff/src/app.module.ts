import { join } from "node:path";

import { ApolloDriver, type ApolloDriverConfig } from "@nestjs/apollo";
import { Controller, Get, type DynamicModule, Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { JwtModule } from "@nestjs/jwt";
import type { Request } from "express";

import { CONFIG, type Config } from "./config";
import { createLoaders, type GraphQLContext } from "./graphql/context";
import { GrpcClients } from "./grpc/clients";
import { CartItemResolver, CatalogResolver, OrderItemResolver, ProductResolver } from "./resolvers/catalog.resolver";
import { ChatResolver } from "./resolvers/chat.resolver";
import { NotificationsResolver } from "./resolvers/notifications.resolver";
import { OrdersResolver } from "./resolvers/orders.resolver";
import { UsersResolver } from "./resolvers/users.resolver";

// For the Kubernetes probes.
@Controller("health")
class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}

@Module({})
class GrpcModule {}

@Module({})
export class AppModule {
  static forConfig(config: Config): DynamicModule {
    // Shared by the resolvers and the GraphQL context, so both use the same connections.
    const grpcModule: DynamicModule = {
      module: GrpcModule,
      providers: [{ provide: CONFIG, useValue: config }, GrpcClients],
      exports: [GrpcClients],
    };

    return {
      module: AppModule,
      imports: [
        grpcModule,
        JwtModule.register({ secret: config.jwtSecret }),
        GraphQLModule.forRootAsync<ApolloDriverConfig>({
          driver: ApolloDriver,
          imports: [grpcModule],
          inject: [GrpcClients],
          useFactory: (grpc: GrpcClients) => ({
            // Schema-first: schema.graphql is the contract with the frontend.
            typePaths: [join(__dirname, "..", "schema.graphql")],
            // On even with NODE_ENV=production, for the demo and the frontend's codegen.
            graphiql: true,
            introspection: true,
            context: ({ req }: { req: Request }): GraphQLContext => ({ req, loaders: createLoaders(grpc) }),
          }),
        }),
      ],
      controllers: [HealthController],
      providers: [
        CatalogResolver,
        ProductResolver,
        CartItemResolver,
        OrderItemResolver,
        UsersResolver,
        OrdersResolver,
        NotificationsResolver,
        ChatResolver,
      ],
    };
  }
}
