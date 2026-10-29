import type { Cart, LineItem, Order, Product, StockLevel } from "../grpc.js";

// The services work in cents; the model reads and writes US dollars, which is
// how customers talk ("under 30 dollars").
export const usd = (cents: number) => cents / 100;
export const cents = (dollars: number) => Math.round(dollars * 100);

// The model sees enums without the proto prefix: PRODUCT_TYPE_CARD <-> CARD.
export function fromProto(prefix: string, value: string): string | null {
  const name = value.slice(prefix.length + 1);
  return name === "UNSPECIFIED" ? null : name;
}

export function toProto(prefix: string, value: string | undefined): string | undefined {
  return value && `${prefix}_${value}`;
}

export function productView(product: Product, stock: StockLevel | undefined) {
  const { card, sealed } = product;
  return {
    id: product.id,
    name: product.name,
    type: fromProto("PRODUCT_TYPE", product.type),
    price_usd: usd(product.priceCents),
    available: stock?.available ?? null,
    ...(card && {
      card: {
        set: `${card.setName} (${card.setCode})`,
        number: card.number,
        rarity: card.rarity,
        language: card.language,
        supertype: fromProto("CARD_SUPERTYPE", card.supertype),
        energy_types: card.types,
        condition: fromProto("CARD_CONDITION", card.condition),
        grading: card.grading && `${card.grading.company} ${card.grading.grade}`,
      },
    }),
    ...(sealed && { sealed: { set: `${sealed.setName} (${sealed.setCode})`, language: sealed.language } }),
    ...(product.description && { description: product.description }),
  };
}

function lineView(item: LineItem) {
  return {
    product_id: item.productId,
    name: item.name,
    unit_price_usd: usd(item.unitPriceCents),
    quantity: item.quantity,
    subtotal_usd: usd(item.subtotalCents),
  };
}

export function cartView(cart: Cart) {
  return { items: cart.items.map(lineView), total_usd: usd(cart.totalCents) };
}

export function orderView(order: Order) {
  return {
    id: order.id,
    status: fromProto("ORDER_STATUS", order.status),
    cancellation_reason: fromProto("CANCELLATION_REASON", order.cancellationReason),
    items: order.items.map(lineView),
    total_usd: usd(order.totalCents),
    created_at: order.createdAt,
  };
}
