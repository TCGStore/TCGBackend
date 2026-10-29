import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { loadConfig } from "./config";

async function main() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forConfig(config));
  app.enableCors({ origin: config.corsOrigins });
  // Closes the gRPC channels when Kubernetes stops the pod.
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`GraphQL at http://localhost:${config.port}/graphql`, "bff");
}

main();
