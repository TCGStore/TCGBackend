export interface Config {
  port: number;
  jwtSecret: string;
  protoDir: string;
  grpcDeadlineMs: number;
  targets: {
    catalog: string;
    orders: string;
    inventory: string;
    users: string;
    notifications: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 4100),
    jwtSecret: required(env, "JWT_SECRET", "the same value users-service uses"),
    protoDir: env.PROTO_DIR ?? "../proto",
    grpcDeadlineMs: Number(env.GRPC_DEADLINE_MS ?? 5000),
    targets: {
      catalog: env.CATALOG_GRPC_TARGET ?? "localhost:50051",
      orders: env.ORDERS_GRPC_TARGET ?? "localhost:50052",
      inventory: env.INVENTORY_GRPC_TARGET ?? "localhost:50053",
      users: env.USERS_GRPC_TARGET ?? "localhost:50054",
      notifications: env.NOTIFICATIONS_GRPC_TARGET ?? "localhost:50055",
    },
  };
}

function required(env: NodeJS.ProcessEnv, key: string, example: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required, e.g. ${example}`);
  }
  return value;
}
