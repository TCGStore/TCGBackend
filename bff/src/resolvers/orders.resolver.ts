import { UseGuards } from "@nestjs/common";
import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { GraphQLError } from "graphql";

import { AuthGuard, type AuthUser, CurrentUser } from "../auth/auth.guard";
import { toOrder } from "../graphql/mappers";
import { GrpcClients } from "../grpc/clients";
import { isNotFound } from "../grpc/errors";
import type { Address } from "../grpc/types";

@Resolver()
@UseGuards(AuthGuard)
export class OrdersResolver {
  constructor(private readonly grpc: GrpcClients) {}

  @Query()
  cart(@CurrentUser() user: AuthUser) {
    return this.grpc.orders.getCart({ userId: user.id });
  }

  @Mutation()
  addToCart(@CurrentUser() user: AuthUser, @Args("productId") productId: string, @Args("quantity") quantity: number) {
    return this.grpc.orders.addCartItem({ userId: user.id, productId, quantity });
  }

  @Mutation()
  updateCartItem(
    @CurrentUser() user: AuthUser,
    @Args("productId") productId: string,
    @Args("quantity") quantity: number,
  ) {
    return this.grpc.orders.updateCartItem({ userId: user.id, productId, quantity });
  }

  @Mutation()
  clearCart(@CurrentUser() user: AuthUser) {
    return this.grpc.orders.clearCart({ userId: user.id });
  }

  @Mutation()
  async checkout(@CurrentUser() user: AuthUser, @Args("shippingAddress") shippingAddress: Address | null) {
    const address = shippingAddress ?? (await this.grpc.users.getProfile({ userId: user.id })).shippingAddress;
    if (!address) {
      throw new GraphQLError("shippingAddress is required: the profile doesn't have one", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    // The email comes from the JWT; orders-service sends it in the events for the emails.
    const order = await this.grpc.orders.checkout({ userId: user.id, userEmail: user.email, shippingAddress: address });
    return toOrder(order);
  }

  @Query()
  async orders(@CurrentUser() user: AuthUser, @Args("page") page: number, @Args("pageSize") pageSize: number) {
    const { orders, totalCount } = await this.grpc.orders.listOrders({ userId: user.id, page, pageSize });
    return { items: orders.map(toOrder), totalCount };
  }

  @Query()
  async order(@CurrentUser() user: AuthUser, @Args("id") id: string) {
    try {
      return toOrder(await this.grpc.orders.getOrder({ userId: user.id, orderId: id }));
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }
}
