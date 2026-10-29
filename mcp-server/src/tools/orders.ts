import { z } from "zod";

import { ToolError } from "../grpc.js";
import { defineTool } from "./define.js";
import { cartView, fromProto, orderView } from "./format.js";

export const getCart = defineTool({
  name: "get_cart",
  description: "Get the user's cart with current prices and the total.",
  readOnly: true,
  inputSchema: z.object({}),
  async run(_input, { grpc, identity }) {
    return cartView(await grpc.orders.getCart({ userId: identity.userId }));
  },
});

export const addToCart = defineTool({
  name: "add_to_cart",
  description: "Add units of a product to the user's cart. Adds to the quantity already there. Returns the updated cart.",
  readOnly: false,
  inputSchema: z.object({
    product_id: z.string().min(1),
    quantity: z.number().int().min(1).default(1),
  }),
  async run({ product_id, quantity }, { grpc, identity }) {
    return cartView(await grpc.orders.addCartItem({ userId: identity.userId, productId: product_id, quantity }));
  },
});

export const updateCartItem = defineTool({
  name: "update_cart_item",
  description: "Set the quantity of a product already in the cart. Quantity 0 removes it. Returns the updated cart.",
  readOnly: false,
  inputSchema: z.object({
    product_id: z.string().min(1),
    quantity: z.number().int().min(0),
  }),
  async run({ product_id, quantity }, { grpc, identity }) {
    return cartView(await grpc.orders.updateCartItem({ userId: identity.userId, productId: product_id, quantity }));
  },
});

const address = z.object({
  recipient_name: z.string().min(1),
  street: z.string().min(1),
  city: z.string().min(1),
  region: z.string().min(1),
  postal_code: z.string().min(1),
  country: z.string().min(1).describe("ISO 3166-1 alpha-2 code, e.g. CL"),
});

export const checkout = defineTool({
  name: "checkout",
  description:
    "Prepare the purchase of everything in the cart. It does NOT buy anything: it returns a pending action " +
    "that the user must confirm with a button in the store. Never tell the user the purchase is done " +
    "after calling this. Without shipping_address, the address saved in the user's profile is used.",
  readOnly: false,
  inputSchema: z.object({ shipping_address: address.optional() }),
  async run({ shipping_address }, { grpc, identity, actions }) {
    const cart = await grpc.orders.getCart({ userId: identity.userId });
    if (cart.items.length === 0) {
      throw new ToolError("the cart is empty");
    }

    const shippingAddress = shipping_address
      ? {
          recipientName: shipping_address.recipient_name,
          street: shipping_address.street,
          city: shipping_address.city,
          region: shipping_address.region,
          postalCode: shipping_address.postal_code,
          country: shipping_address.country,
        }
      : (await grpc.users.getProfile({ userId: identity.userId })).shippingAddress;
    if (!shippingAddress) {
      throw new ToolError("the user has no saved shipping address: ask for one and pass it as shipping_address");
    }

    const confirmedItems = itemsKey(cart.items);
    const view = cartView(cart);
    return actions.create(
      identity,
      "checkout",
      `Buy ${cart.items.length} product(s) for $${view.total_usd.toFixed(2)}`,
      {
        ...view,
        shipping_address: {
          recipient_name: shippingAddress.recipientName,
          street: shippingAddress.street,
          city: shippingAddress.city,
          region: shippingAddress.region,
          postal_code: shippingAddress.postalCode,
          country: shippingAddress.country,
        },
      },
      async () => {
        // The user confirmed this exact cart; if it changed in between, they must see it again.
        const current = await grpc.orders.getCart({ userId: identity.userId });
        if (itemsKey(current.items) !== confirmedItems) {
          throw new ToolError("the cart changed after the purchase was prepared: prepare it again", 409);
        }
        const order = await grpc.orders.checkout({ userId: identity.userId, userEmail: identity.email, shippingAddress });
        return orderView(order);
      },
    );
  },
});

function itemsKey(items: { productId: string; quantity: number }[]): string {
  return items
    .map((item) => `${item.productId}x${item.quantity}`)
    .sort()
    .join(",");
}

export const getOrder = defineTool({
  name: "get_order",
  description:
    "Get one of the user's orders. A new order is PENDING for a few seconds, then CONFIRMED or CANCELLED; " +
    "cancellation_reason says why (OUT_OF_STOCK or PAYMENT_DECLINED).",
  readOnly: true,
  inputSchema: z.object({ order_id: z.string().min(1) }),
  async run({ order_id }, { grpc, identity }) {
    return orderView(await grpc.orders.getOrder({ userId: identity.userId, orderId: order_id }));
  },
});

export const listOrders = defineTool({
  name: "list_orders",
  description: "List the user's orders, newest first.",
  readOnly: true,
  inputSchema: z.object({
    page: z.number().int().min(1).default(1),
    page_size: z.number().int().min(1).max(50).default(10),
  }),
  async run({ page, page_size }, { grpc, identity }) {
    const { orders, totalCount } = await grpc.orders.listOrders({ userId: identity.userId, page, pageSize: page_size });
    return { total_count: totalCount, orders: orders.map(orderView) };
  },
});

export const listNotifications = defineTool({
  name: "list_notifications",
  description: "List the user's notifications (order created, confirmed or cancelled), newest first.",
  readOnly: true,
  inputSchema: z.object({ unread_only: z.boolean().default(false) }),
  async run({ unread_only }, { grpc, identity }) {
    const { notifications } = await grpc.notifications.listNotifications({
      userId: identity.userId,
      includeAdmin: identity.role === "admin",
      unreadOnly: unread_only,
      page: 1,
      pageSize: 20,
    });
    return {
      notifications: notifications.map((notification) => ({
        type: fromProto("NOTIFICATION_TYPE", notification.type),
        title: notification.title,
        message: notification.message,
        read: notification.read,
        created_at: notification.createdAt,
        order_id: notification.orderId || null,
      })),
    };
  },
});
