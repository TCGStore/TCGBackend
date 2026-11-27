import { UseGuards } from "@nestjs/common";
import { Args, Context, Mutation, Resolver } from "@nestjs/graphql";

import { AuthGuard, type AuthUser, CurrentUser } from "../auth/auth.guard";
import type { GraphQLContext } from "../graphql/context";
import { toOrder, toProduct } from "../graphql/mappers";
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
    // Re-read from the services so the frontend gets the usual Order, Stock and Product types.
    const none = { order: null, stock: null, product: null };
    switch (kind) {
      case "checkout": {
        const order = await this.grpc.orders.getOrder({ userId: user.id, orderId: result.id! });
        return { ...none, kind: "CHECKOUT", order: toOrder(order) };
      }
      case "set_stock":
        return { ...none, kind: "SET_STOCK", stock: await ctx.loaders.stock.load(result.product_id!) };
      default: {
        // Only admins get these actions, and a hidden product must still come back.
        const product = await this.grpc.catalog.getProduct({ id: result.product_id!, includeUnpriced: true });
        return { ...none, kind: kind.toUpperCase(), product: toProduct(product) };
      }
    }
  }

  @Mutation()
  async cancelAction(@Args("actionId") actionId: string, @Context() ctx: GraphQLContext) {
    await this.mcp.cancelAction(ctx.req.headers.authorization!, actionId);
    return true;
  }
}
