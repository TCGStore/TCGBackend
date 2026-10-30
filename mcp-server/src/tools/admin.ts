import { z } from "zod";

import { ToolError } from "../grpc.js";
import { defineTool } from "./define.js";
import { productView } from "./format.js";

export const listLowStock = defineTool({
  name: "list_low_stock",
  description:
    "Admins only. List the products that are low on stock right now, from the store's low stock alerts, " +
    "with their current units.",
  adminOnly: true,
  readOnly: true,
  inputSchema: z.object({}),
  async run(_input, { grpc, identity }) {
    const { notifications } = await grpc.notifications.listNotifications({
      userId: identity.userId,
      includeAdmin: true,
      unreadOnly: false,
      page: 1,
      pageSize: 100,
    });
    const productIds = [
      ...new Set(notifications.filter((n) => n.type === "NOTIFICATION_TYPE_LOW_STOCK").map((n) => n.productId)),
    ];
    if (productIds.length === 0) {
      return { products: [] };
    }

    // An old alert may already be solved, so the current stock decides.
    const [{ products }, { stocks }] = await Promise.all([
      grpc.catalog.getProducts({ ids: productIds }),
      grpc.inventory.getStocks({ productIds }),
    ]);
    const low = new Map(stocks.filter((stock) => stock.lowStock).map((stock) => [stock.productId, stock]));
    return {
      products: products.filter((product) => low.has(product.id)).map((product) => productView(product, low.get(product.id))),
    };
  },
});

export const setStock = defineTool({
  name: "set_stock",
  description:
    "Admins only. Prepare a change of the units available for sale of a product. It does NOT change " +
    "anything: it returns a pending action that the admin must confirm with a button in the store.",
  adminOnly: true,
  readOnly: false,
  needsConfirmation: true,
  inputSchema: z.object({
    product_id: z.string().min(1),
    available: z.number().int().min(0),
  }),
  async run({ product_id, available }, { grpc, identity, actions }) {
    const [{ products }, { stocks }] = await Promise.all([
      grpc.catalog.getProducts({ ids: [product_id] }),
      grpc.inventory.getStocks({ productIds: [product_id] }),
    ]);
    const product = products[0];
    if (!product) {
      throw new ToolError(`product ${product_id} not found`, 404);
    }
    const current = stocks[0]?.available ?? 0;

    return actions.create(
      identity,
      "set_stock",
      `Set stock of ${product.name} from ${current} to ${available}`,
      { product_id, name: product.name, current_available: current, new_available: available },
      async () => {
        const stock = await grpc.inventory.setStock({ productId: product_id, available });
        return { product_id, available: stock.available, low_stock: stock.lowStock };
      },
    );
  },
});
