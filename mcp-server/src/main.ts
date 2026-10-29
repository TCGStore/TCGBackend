import { PendingActions } from "./actions.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createGrpcClients } from "./grpc.js";

const config = loadConfig();
const grpc = createGrpcClients(config);
const app = createApp({ jwtSecret: config.jwtSecret, grpc, actions: new PendingActions() });

const server = app.listen(config.port, () => {
  console.log(`MCP server at http://localhost:${config.port}/mcp`);
});

// Kubernetes sends SIGTERM before stopping the pod.
process.on("SIGTERM", () => {
  server.close();
  grpc.close();
});
