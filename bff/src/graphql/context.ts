import DataLoader from "dataloader";
import type { Request } from "express";

import type { AuthUser } from "../auth/auth.guard";
import type { GrpcClients } from "../grpc/clients";
import type { Product, StockLevel } from "../grpc/types";

// Both services accept at most 100 ids per call.
const MAX_BATCH_IDS = 100;

export interface GraphQLContext {
  req: Request;
  user?: AuthUser;
  loaders: Loaders;
}

export type Loaders = ReturnType<typeof createLoaders>;

/** Created per request: the `stock` of a whole page becomes one GetStocks call, not one per product. */
export function createLoaders(grpc: GrpcClients) {
  return {
    product: new DataLoader<string, Product | null>(
      async (ids) => {
        const { products } = await grpc.catalog.getProducts({ ids: [...ids] });
        const byId = new Map(products.map((product) => [product.id, product]));
        return ids.map((id) => byId.get(id) ?? null);
      },
      { maxBatchSize: MAX_BATCH_IDS },
    ),
    stock: new DataLoader<string, StockLevel | null>(
      async (ids) => {
        const { stocks } = await grpc.inventory.getStocks({ productIds: [...ids] });
        const byId = new Map(stocks.map((stock) => [stock.productId, stock]));
        return ids.map((id) => byId.get(id) ?? null);
      },
      { maxBatchSize: MAX_BATCH_IDS },
    ),
  };
}
