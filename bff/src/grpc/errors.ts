import { status, type ServiceError } from "@grpc/grpc-js";
import { Logger } from "@nestjs/common";
import { GraphQLError } from "graphql";

const logger = new Logger("grpc");

// Errors the client can act on keep the service's message.
const CLIENT_ERRORS: Partial<Record<status, string>> = {
  [status.INVALID_ARGUMENT]: "BAD_USER_INPUT",
  [status.NOT_FOUND]: "NOT_FOUND",
  [status.ALREADY_EXISTS]: "ALREADY_EXISTS",
  [status.FAILED_PRECONDITION]: "FAILED_PRECONDITION",
  [status.UNAUTHENTICATED]: "UNAUTHENTICATED",
  [status.PERMISSION_DENIED]: "FORBIDDEN",
};

export function toGraphQLError(error: ServiceError, service: string, method: string): GraphQLError {
  const code = CLIENT_ERRORS[error.code];
  if (code) {
    return new GraphQLError(error.details, { extensions: { code } });
  }

  // Anything else is logged and hidden from the client.
  logger.error(`${service}.${method} failed: ${status[error.code]} ${error.details}`);
  if (error.code === status.UNAVAILABLE || error.code === status.DEADLINE_EXCEEDED) {
    return new GraphQLError(`${service} is unavailable`, { extensions: { code: "SERVICE_UNAVAILABLE" } });
  }
  return new GraphQLError("internal error", { extensions: { code: "INTERNAL_SERVER_ERROR" } });
}

export function isNotFound(error: unknown): boolean {
  return error instanceof GraphQLError && error.extensions.code === "NOT_FOUND";
}
