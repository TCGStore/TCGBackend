import type * as pb from "../grpc/types";

// GraphQL enums drop the proto prefix: PRODUCT_TYPE_CARD <-> CARD.
// The proto's *_UNSPECIFIED (value 0, "not set") becomes null.
export function enumFromProto(prefix: string, value: string): string | null {
  const name = value.slice(prefix.length + 1);
  return name === "UNSPECIFIED" ? null : name;
}

export function enumToProto(prefix: string, value: string | null | undefined): string | undefined {
  return value ? `${prefix}_${value}` : undefined;
}

export function toProduct(product: pb.Product) {
  const { card } = product;
  return {
    id: product.id,
    name: product.name,
    type: enumFromProto("PRODUCT_TYPE", product.type),
    priceCents: product.priceCents,
    imageUrl: product.imageUrl || null,
    description: product.description || null,
    card: card && {
      ...card,
      supertype: enumFromProto("CARD_SUPERTYPE", card.supertype),
      condition: enumFromProto("CARD_CONDITION", card.condition),
    },
    sealed: product.sealed ?? null,
  };
}

export function toUser(user: pb.User) {
  return { ...user, role: enumFromProto("ROLE", user.role) };
}

export function toAuthPayload(response: pb.AuthResponse) {
  return {
    token: response.accessToken,
    expiresAt: new Date(response.expiresAt * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    user: toUser(response.user),
  };
}

export function toOrder(order: pb.Order) {
  return {
    ...order,
    status: enumFromProto("ORDER_STATUS", order.status),
    cancellationReason: enumFromProto("CANCELLATION_REASON", order.cancellationReason),
  };
}

export function toNotification(notification: pb.Notification) {
  return {
    ...notification,
    type: enumFromProto("NOTIFICATION_TYPE", notification.type),
    orderId: notification.orderId || null,
    productId: notification.productId || null,
  };
}
