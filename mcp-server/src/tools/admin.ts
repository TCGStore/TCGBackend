import { z } from "zod";

import { type CreateProductRequest, type GrpcClients, ToolError } from "../grpc.js";
import { defineTool, type ToolContext } from "./define.js";
import { cents, productView, toProto, usd } from "./format.js";

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
      grpc.catalog.getProducts({ ids: productIds, includeUnpriced: true }),
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
      grpc.catalog.getProducts({ ids: [product_id], includeUnpriced: true }),
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

const priceUsd = z.number().positive().describe("US dollars, e.g. 149.99");
const initialStock = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Units available for sale right after creating it. Without it the product starts with no stock.");

// Runs on confirm: the product exists even if the stock fails, so that error is returned, not thrown.
async function createWithStock(grpc: GrpcClients, request: CreateProductRequest, stock: number | undefined) {
  const product = await grpc.catalog.createProduct(request);
  if (stock === undefined) {
    return { product_id: product.id, product: productView(product, undefined) };
  }
  try {
    const level = await grpc.inventory.setStock({ productId: product.id, available: stock });
    return { product_id: product.id, product: productView(product, level) };
  } catch (error) {
    const message = error instanceof ToolError ? error.message : "internal error";
    return { product_id: product.id, product: productView(product, undefined), stock_error: message };
  }
}

async function prepareCreate(
  { grpc, identity, actions }: ToolContext,
  request: CreateProductRequest,
  stock: number | undefined,
) {
  // Duplicates and invalid data fail now, before the admin sees a button.
  const preview = await grpc.catalog.createProduct({ ...request, validateOnly: true });
  const price = preview.priceCents === undefined ? "without price (hidden)" : `at $${usd(preview.priceCents).toFixed(2)}`;
  const units = stock === undefined ? "" : `, ${stock} unit(s)`;
  return actions.create(
    identity,
    "create_product",
    `Create ${preview.name} ${price}${units}`,
    { product: productView(preview, undefined), initial_stock: stock ?? null },
    () => createWithStock(grpc, request, stock),
  );
}

export const createSealedProduct = defineTool({
  name: "create_sealed_product",
  description:
    "Admins only. Prepare a new sealed product (booster pack, booster box or Elite Trainer Box). It does NOT " +
    "create anything: it returns a pending action that the admin confirms with a button. Fails right away " +
    "if the product already exists (one per set, type and language).",
  adminOnly: true,
  readOnly: false,
  needsConfirmation: true,
  inputSchema: z.object({
    name: z.string().min(1).describe("In English, e.g. \"Surging Sparks Booster Box\""),
    type: z.enum(["BOOSTER_PACK", "BOOSTER_BOX", "ELITE_TRAINER_BOX"]),
    set_code: z.string().min(1).describe("e.g. SSP"),
    set_name: z.string().min(1).describe("e.g. Surging Sparks"),
    language: z.string().min(2).default("en").describe("ISO 639-1 code"),
    description: z.string().optional().describe("Short, in English, e.g. \"36 booster packs.\""),
    image_url: z.url().optional(),
    price_usd: priceUsd.optional().describe("Without it the product stays hidden from customers"),
    initial_stock: initialStock,
  }),
  async run(input, ctx) {
    return prepareCreate(
      ctx,
      {
        name: input.name,
        type: toProto("PRODUCT_TYPE", input.type)!,
        priceCents: input.price_usd === undefined ? undefined : cents(input.price_usd),
        imageUrl: input.image_url,
        description: input.description,
        sealed: { setCode: input.set_code, setName: input.set_name, language: input.language },
      },
      input.initial_stock,
    );
  },
});

export const createCardListing = defineTool({
  name: "create_card_listing",
  description:
    "Admins only. Prepare a new listing of a card that is already in the catalog, in another condition, " +
    "language or graded (e.g. a Lightly Played copy or a PSA 10). It copies name, set, number, rarity, " +
    "types and image from from_product_id. English Near Mint ungraded listings come from the card import " +
    "and can't be created. It does NOT create anything: it returns a pending action that the admin confirms " +
    "with a button.",
  adminOnly: true,
  readOnly: false,
  needsConfirmation: true,
  inputSchema: z.object({
    from_product_id: z.string().min(1).describe("Id of the card to copy, from search_products"),
    condition: z
      .enum(["NEAR_MINT", "LIGHTLY_PLAYED", "MODERATELY_PLAYED", "HEAVILY_PLAYED", "DAMAGED"])
      .default("NEAR_MINT"),
    language: z.string().min(2).optional().describe("ISO 639-1 code; defaults to the copied card's"),
    grading: z
      .object({
        company: z.string().min(1).describe("PSA, BGS or CGC"),
        grade: z.string().min(1).describe("e.g. \"10\" or \"9.5\""),
      })
      .optional(),
    price_usd: priceUsd.optional().describe("Without it the listing stays hidden from customers"),
    initial_stock: initialStock,
  }),
  async run(input, ctx) {
    const { products } = await ctx.grpc.catalog.getProducts({ ids: [input.from_product_id], includeUnpriced: true });
    const base = products[0];
    if (!base?.card) {
      throw new ToolError(`${input.from_product_id} is not a card in the catalog`, 404);
    }
    return prepareCreate(
      ctx,
      {
        name: base.name,
        type: base.type,
        priceCents: input.price_usd === undefined ? undefined : cents(input.price_usd),
        imageUrl: base.imageUrl,
        card: {
          ...base.card,
          language: input.language ?? base.card.language,
          condition: toProto("CARD_CONDITION", input.condition)!,
          grading: input.grading ?? null,
        },
      },
      input.initial_stock,
    );
  },
});

export const updateProduct = defineTool({
  name: "update_product",
  description:
    "Admins only. Prepare a change of a product's name, description or image. Imported cards can't be " +
    "edited: their data comes from the card import. It does NOT change anything: it returns a pending " +
    "action that the admin confirms with a button.",
  adminOnly: true,
  readOnly: false,
  needsConfirmation: true,
  inputSchema: z.object({
    product_id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional().describe("Empty string removes it"),
    image_url: z.union([z.url(), z.literal("")]).optional().describe("Empty string removes it"),
  }),
  async run({ product_id, name, description, image_url }, { grpc, identity, actions }) {
    const changes = { name, description, imageUrl: image_url };
    const changed = Object.keys(changes).filter((key) => changes[key as keyof typeof changes] !== undefined);
    if (changed.length === 0) {
      throw new ToolError("nothing to change: pass name, description or image_url");
    }
    const request = { id: product_id, ...changes };
    const current = await grpc.catalog.updateProduct({ ...request, validateOnly: true });
    return actions.create(
      identity,
      "update_product",
      `Update ${current.name}: ${changed.join(", ")}`,
      {
        product_id,
        before: { name: current.name, description: current.description, image_url: current.imageUrl },
        after: { name, description, image_url },
      },
      async () => ({ product_id, product: productView(await grpc.catalog.updateProduct(request), undefined) }),
    );
  },
});

export const setProductPrice = defineTool({
  name: "set_product_price",
  description:
    "Admins only. Prepare a price change of a sealed product or a listing created by the staff. " +
    "price_usd null removes the price, which hides the product from customers. Imported cards can't " +
    "be priced by hand: their price comes from the card import. It does NOT change anything: it returns " +
    "a pending action that the admin confirms with a button.",
  adminOnly: true,
  readOnly: false,
  needsConfirmation: true,
  inputSchema: z.object({ product_id: z.string().min(1), price_usd: priceUsd.nullable() }),
  async run({ product_id, price_usd }, { grpc, identity, actions }) {
    const priceCents = price_usd === null ? undefined : cents(price_usd);
    const current = await grpc.catalog.setProductPrice({ id: product_id, priceCents, validateOnly: true });
    const before = current.priceCents === undefined ? "no price" : `$${usd(current.priceCents).toFixed(2)}`;
    const summary =
      price_usd === null
        ? `Hide ${current.name} (remove its price, now ${before})`
        : `Set price of ${current.name} from ${before} to $${price_usd.toFixed(2)}`;
    return actions.create(
      identity,
      "set_product_price",
      summary,
      { product_id, name: current.name, current_price_usd: current.priceCents === undefined ? null : usd(current.priceCents), new_price_usd: price_usd },
      async () => {
        const product = await grpc.catalog.setProductPrice({ id: product_id, priceCents });
        return { product_id, product: productView(product, undefined) };
      },
    );
  },
});
