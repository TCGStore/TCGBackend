const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface Config {
  port: number;
  jwtSecret: string;
  protoDir: string;
  grpcDeadlineMs: number;
  /** Without it /chat answers 503; the MCP tools still work. */
  anthropicApiKey: string | undefined;
  anthropicModel: string;
  /** Lower is faster and terser; raise it if deck building answers get worse. */
  anthropicEffort: Effort;
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
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL || "claude-opus-5-5",
    anthropicEffort: effort(env.ANTHROPIC_EFFORT),
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

function effort(value: string | undefined): Effort {
  if (!value) {
    return "low";
  }
  if (!(EFFORTS as readonly string[]).includes(value)) {
    throw new Error(`ANTHROPIC_EFFORT must be one of ${EFFORTS.join(", ")}`);
  }
  return value as Effort;
}
