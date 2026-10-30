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

  @Mutation()
  async chat(
    @Args("message") message: string,
    @Args("conversationId") conversationId: string | null,
    @Context() ctx: GraphQLContext,
  ) {
    const { actions, ...reply } = await this.mcp.chat(ctx.req.headers.authorization!, message, conversationId ?? undefined);
    return { ...reply, actions: actions.map((action) => ({ ...action, kind: action.kind.toUpperCase() })) };
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
