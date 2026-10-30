import Anthropic from "@anthropic-ai/sdk";

import { PendingActions } from "./actions.js";
import { Agent } from "./agent.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Conversations } from "./conversations.js";
import { createGrpcClients } from "./grpc.js";

const config = loadConfig();
const grpc = createGrpcClients(config);
const agent = config.anthropicApiKey
  ? new Agent(new Anthropic({ apiKey: config.anthropicApiKey }), config.anthropicModel)
  : null;
if (!agent) {
  console.warn("ANTHROPIC_API_KEY is not set: /chat will answer 503");
}

const app = createApp({
  jwtSecret: config.jwtSecret,
  grpc,
  actions: new PendingActions(),
  agent,
  conversations: new Conversations(),
});

const server = app.listen(config.port, () => {
  console.log(`MCP server at http://localhost:${config.port}/mcp`);
});

// Kubernetes sends SIGTERM before stopping the pod.
process.on("SIGTERM", () => {
  server.close();
  grpc.close();
});
