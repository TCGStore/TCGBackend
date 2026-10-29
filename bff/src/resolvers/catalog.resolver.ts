import { UseGuards } from "@nestjs/common";
import { Args, Context, Mutation, Parent, Query, ResolveField, Resolver } from "@nestjs/graphql";

import { AdminGuard } from "../auth/auth.guard";
import type { GraphQLContext } from "../graphql/context";
import { enumToProto, toProduct } from "../graphql/mappers";
import { GrpcClients } from "../grpc/clients";
import { isNotFound } from "../grpc/errors";
import type { LineItem } from "../grpc/types";

interface ProductFilter {
  query?: string;
  type?: string;
  setCode?: string;
  language?: string;
  supertype?: string;
  energyType?: string;
  condition?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  gradedOnly?: boolean;
}

@Resolver()
export class CatalogResolver {
  constructor(private readonly grpc: GrpcClients) {}

  @Query()
  async products(
    @Args("filter") filter: ProductFilter | null,
    @Args("page") page: number,
    @Args("pageSize") pageSize: number,
  ) {
    const { products, totalCount } = await this.grpc.catalog.searchProducts({
      ...filter,
      type: enumToProto("PRODUCT_TYPE", filter?.type),
      supertype: enumToProto("CARD_SUPERTYPE", filter?.supertype),
      condition: enumToProto("CARD_CONDITION", filter?.condition),
      page,
      pageSize,
    });
    return { items: products.map(toProduct), totalCount };
  }

  @Query()
  async product(@Args("id") id: string) {
    try {
      return toProduct(await this.grpc.catalog.getProduct({ id }));
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  @Mutation()
  @UseGuards(AdminGuard)
  setStock(@Args("productId") productId: string, @Args("available") available: number) {
    return this.grpc.inventory.setStock({ productId, available });
  }
}

@Resolver("Product")
export class ProductResolver {
  @ResolveField()
  stock(@Parent() product: { id: string }, @Context() ctx: GraphQLContext) {
    return ctx.loaders.stock.load(product.id);
  }
}

// Cart and order lines only carry the name and price; `product` adds the rest
// (image, set, condition) when the frontend asks for it.
async function lineProduct(item: LineItem, ctx: GraphQLContext) {
  const product = await ctx.loaders.product.load(item.productId);
  return product && toProduct(product);
}

@Resolver("CartItem")
export class CartItemResolver {
  @ResolveField()
  product(@Parent() item: LineItem, @Context() ctx: GraphQLContext) {
    return lineProduct(item, ctx);
  }
}

@Resolver("OrderItem")
export class OrderItemResolver {
  @ResolveField()
  product(@Parent() item: LineItem, @Context() ctx: GraphQLContext) {
    return lineProduct(item, ctx);
  }
}
