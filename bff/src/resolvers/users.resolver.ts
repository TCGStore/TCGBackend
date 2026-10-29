import { UseGuards } from "@nestjs/common";
import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { AuthGuard, type AuthUser, CurrentUser } from "../auth/auth.guard";
import { toAuthPayload, toUser } from "../graphql/mappers";
import { GrpcClients } from "../grpc/clients";
import type { Address } from "../grpc/types";

@Resolver()
export class UsersResolver {
  constructor(private readonly grpc: GrpcClients) {}

  @Mutation()
  async register(@Args("input") input: { email: string; password: string; name: string }) {
    return toAuthPayload(await this.grpc.users.register(input));
  }

  @Mutation()
  async login(@Args("email") email: string, @Args("password") password: string) {
    return toAuthPayload(await this.grpc.users.login({ email, password }));
  }

  @Query()
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    return toUser(await this.grpc.users.getProfile({ userId: user.id }));
  }

  @Mutation()
  @UseGuards(AuthGuard)
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Args("input") input: { name?: string | null; shippingAddress?: Address | null },
  ) {
    const updated = await this.grpc.users.updateProfile({
      userId: user.id,
      // users-service leaves empty or unset fields as they are.
      name: input.name ?? undefined,
      shippingAddress: input.shippingAddress ?? undefined,
    });
    return toUser(updated);
  }
}
