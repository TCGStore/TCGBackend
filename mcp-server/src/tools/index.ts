import type { Identity } from "../auth.js";
import {
  createCardListing,
  createSealedProduct,
  listLowStock,
  setProductPrice,
  setStock,
  updateProduct,
} from "./admin.js";
import { checkStock, getProducts, searchProducts } from "./catalog.js";
import type { Tool } from "./define.js";
import { addToCart, checkout, clearCart, getCart, getOrder, listNotifications, listOrders, updateCartItem } from "./orders.js";

const TOOLS: Tool<any>[] = [
  searchProducts,
  getProducts,
  checkStock,
  getCart,
  addToCart,
  updateCartItem,
  clearCart,
  checkout,
  getOrder,
  listOrders,
  listNotifications,
  listLowStock,
  setStock,
  setProductPrice,
  updateProduct,
  createSealedProduct,
  createCardListing,
];

export function toolsFor(identity: Identity): Tool<any>[] {
  return TOOLS.filter((tool) => !tool.adminOnly || identity.role === "admin");
}

export { runTool, type Tool, type ToolContext } from "./define.js";
