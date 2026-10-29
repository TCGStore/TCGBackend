import { z } from "zod";

import type { GrpcClients, Product } from "../grpc.js";
import { defineTool } from "./define.js";
import { cents, productView, toProto } from "./format.js";

async function withStock(grpc: GrpcClients, products: Product[]) {
  if (products.length === 0) {
    return [];
  }
  const { stocks } = await grpc.inventory.getStocks({ productIds: products.map((product) => product.id) });
  const byId = new Map(stocks.map((stock) => [stock.productId, stock]));
  return products.map((product) => productView(product, byId.get(product.id)));
}

const productIds = z.array(z.string().min(1)).min(1).max(100);

export const searchProducts = defineTool({
  name: "search_products",
  description:
    "Search the store catalog: single Pokémon TCG cards and sealed products (booster packs, booster boxes, " +
    "Elite Trainer Boxes). Every filter is optional. Each result includes `available`, the units in stock " +
    "right now. A card in another condition, language or grade is a different product with its own id.",
  readOnly: true,
  inputSchema: z.object({
    query: z.string().optional().describe("Words from the product name, in English, e.g. \"Charizard\" or \"Obsidian Flames\""),
    type: z.enum(["CARD", "BOOSTER_PACK", "BOOSTER_BOX", "ELITE_TRAINER_BOX"]).optional(),
    supertype: z.enum(["POKEMON", "TRAINER", "ENERGY"]).optional().describe("Only for cards"),
    energy_type: z
      .string()
      .optional()
      .describe("Card energy type in English: Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness, Metal, Dragon or Colorless"),
    condition: z.enum(["NEAR_MINT", "LIGHTLY_PLAYED", "MODERATELY_PLAYED", "HEAVILY_PLAYED", "DAMAGED"]).optional(),
    language: z.string().optional().describe("ISO 639-1 code: en, ja, es..."),
    set_code: z.string().optional().describe("e.g. OBF for Obsidian Flames"),
    min_price_usd: z.number().min(0).optional(),
    max_price_usd: z.number().min(0).optional(),
    graded_only: z.boolean().optional().describe("Only graded cards (PSA, BGS, CGC)"),
    page: z.number().int().min(1).default(1),
    page_size: z.number().int().min(1).max(50).default(20),
  }),
  async run(input, { grpc }) {
    const { products, totalCount } = await grpc.catalog.searchProducts({
      query: input.query,
      type: toProto("PRODUCT_TYPE", input.type),
      supertype: toProto("CARD_SUPERTYPE", input.supertype),
      energyType: input.energy_type,
      condition: toProto("CARD_CONDITION", input.condition),
      language: input.language,
      setCode: input.set_code,
      minPriceCents: input.min_price_usd === undefined ? undefined : cents(input.min_price_usd),
      maxPriceCents: input.max_price_usd === undefined ? undefined : cents(input.max_price_usd),
      gradedOnly: input.graded_only,
      page: input.page,
      pageSize: input.page_size,
    });
    return { total_count: totalCount, page: input.page, products: await withStock(grpc, products) };
  },
});

export const getProducts = defineTool({
  name: "get_products",
  description: "Get full details and current stock of products by id. Ids that don't exist are left out.",
  readOnly: true,
  inputSchema: z.object({ product_ids: productIds }),
  async run({ product_ids }, { grpc }) {
    const { products } = await grpc.catalog.getProducts({ ids: product_ids });
    return { products: await withStock(grpc, products) };
  },
});

export const checkStock = defineTool({
  name: "check_stock",
  description:
    "Get the units in stock right now for products by id. Use it to re-check before buying; " +
    "unknown ids return available 0.",
  readOnly: true,
  inputSchema: z.object({ product_ids: productIds }),
  async run({ product_ids }, { grpc }) {
    const { stocks } = await grpc.inventory.getStocks({ productIds: product_ids });
    return {
      stocks: stocks.map((stock) => ({ product_id: stock.productId, available: stock.available, low_stock: stock.lowStock })),
    };
  },
});
