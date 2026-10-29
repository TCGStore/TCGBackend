import { UseGuards } from "@nestjs/common";
import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";

import { AuthGuard, type AuthUser, CurrentUser } from "../auth/auth.guard";
import { toNotification } from "../graphql/mappers";
import { GrpcClients } from "../grpc/clients";

// includeAdmin comes from the JWT role, never from the client (notifications.proto).
function reader(user: AuthUser) {
  return { userId: user.id, includeAdmin: user.role === "admin" };
}

@Resolver()
@UseGuards(AuthGuard)
export class NotificationsResolver {
  constructor(private readonly grpc: GrpcClients) {}

  @Query()
  async notifications(
    @CurrentUser() user: AuthUser,
    @Args("unreadOnly") unreadOnly: boolean,
    @Args("page") page: number,
    @Args("pageSize") pageSize: number,
  ) {
    const { notifications, totalCount } = await this.grpc.notifications.listNotifications({
      ...reader(user),
      unreadOnly,
      page,
      pageSize,
    });
    return { items: notifications.map(toNotification), totalCount };
  }

  @Query()
  async unreadNotificationCount(@CurrentUser() user: AuthUser) {
    return (await this.grpc.notifications.getUnreadCount(reader(user))).count;
  }

  @Mutation()
  async markNotificationsRead(@CurrentUser() user: AuthUser, @Args("ids") ids: string[] | null) {
    const { updatedCount } = await this.grpc.notifications.markAsRead({ ...reader(user), notificationIds: ids ?? [] });
    return updatedCount;
  }
}
