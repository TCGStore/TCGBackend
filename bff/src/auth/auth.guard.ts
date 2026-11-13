import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable } from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";
import { JwtService } from "@nestjs/jwt";
import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../graphql/context";

export interface AuthUser {
  id: string;
  email: string;
  role: "customer" | "admin";
}

// Claims written by users-service (see proto/README.md).
interface Claims {
  sub?: unknown;
  email?: unknown;
  role?: unknown;
}

/** Verifies the JWT locally with the JWT_SECRET shared with users-service, without a gRPC call. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context).getContext<GraphQLContext>();
    ctx.user = this.authenticate(ctx.req.headers.authorization);
    return true;
  }

  private authenticate(header: string | undefined): AuthUser {
    const token = header?.match(/^Bearer (.+)$/)?.[1];
    if (!token) {
      throw unauthenticated("missing Authorization: Bearer <token> header");
    }

    let claims: Claims;
    try {
      // users-service signs with HS256; any other algorithm in the header is rejected.
      claims = this.jwt.verify<Claims>(token, { algorithms: ["HS256"] });
    } catch {
      throw unauthenticated("invalid or expired token");
    }

    const { sub, email, role } = claims;
    if (typeof sub !== "string" || typeof email !== "string" || (role !== "customer" && role !== "admin")) {
      throw unauthenticated("token is missing claims");
    }
    return { id: sub, email, role };
  }
}

@Injectable()
export class AdminGuard extends AuthGuard {
  override canActivate(context: ExecutionContext): boolean {
    super.canActivate(context);
    const { user } = GqlExecutionContext.create(context).getContext<GraphQLContext>();
    if (user?.role !== "admin") {
      throw new GraphQLError("admins only", { extensions: { code: "FORBIDDEN" } });
    }
    return true;
  }
}

/** For public queries: without a token the visitor is anonymous, but a token sent must be valid. */
@Injectable()
export class OptionalAuthGuard extends AuthGuard {
  override canActivate(context: ExecutionContext): boolean {
    const { req } = GqlExecutionContext.create(context).getContext<GraphQLContext>();
    return req.headers.authorization ? super.canActivate(context) : true;
  }
}

/** The user set by one of the guards above; undefined for anonymous visitors with OptionalAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    GqlExecutionContext.create(context).getContext<GraphQLContext>().user,
);

function unauthenticated(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "UNAUTHENTICATED" } });
}
