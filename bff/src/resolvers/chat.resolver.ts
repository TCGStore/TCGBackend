import { randomUUID } from "node:crypto";

import { UseGuards } from "@nestjs/common";
import { Args, Context, Mutation, Resolver } from "@nestjs/graphql";

import { AuthGuard, type AuthUser, CurrentUser } from "../auth/auth.guard";
import type { GraphQLContext } from "../graphql/context";
import { toOrder } from "../graphql/mappers";
import { GrpcClients } from "../grpc/clients";
import { McpClient } from "../mcp/mcp.client";

@Resolver()
@UseGuards(AuthGuard)
export class ChatResolver {
  constructor(
    private readonly mcp: McpClient,
    private readonly grpc: GrpcClients,
  ) {}

  // Fixed reply so the frontend can build the chat now. It will forward the
  // message to the mcp-server (POST /chat) once the agent exists.
  @Mutation()
  chat(@Args("conversationId") conversationId: string | null) {
    return {
      conversationId: conversationId ?? randomUUID(),
      reply: "El asistente todavía no está disponible. ¡Pronto podrás pedirle cartas y mazos!",
    };
  }

  @Mutation()
  async confirmAction(
    @CurrentUser() user: AuthUser,
    @Args("actionId") actionId: string,
    @Context() ctx: GraphQLContext,
  ) {
    const { kind, result } = await this.mcp.confirmAction(ctx.req.headers.authorization!, actionId);
    // Re-read from the services so the frontend gets the usual Order and Stock types.
    if (kind === "checkout") {
      const order = await this.grpc.orders.getOrder({ userId: user.id, orderId: result.id! });
      return { kind: "CHECKOUT", order: toOrder(order), stock: null };
    }
    return { kind: "SET_STOCK", order: null, stock: await ctx.loaders.stock.load(result.product_id!) };
  }

  @Mutation()
  async cancelAction(@Args("actionId") actionId: string, @Context() ctx: GraphQLContext) {
    await this.mcp.cancelAction(ctx.req.headers.authorization!, actionId);
    return true;
  }
}
