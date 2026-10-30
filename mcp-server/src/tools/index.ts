import type { Identity } from "../auth.js";
import { listLowStock, setStock } from "./admin.js";
import { checkStock, getProducts, searchProducts } from "./catalog.js";
import type { Tool } from "./define.js";
import { addToCart, checkout, getCart, getOrder, listNotifications, listOrders, updateCartItem } from "./orders.js";

const TOOLS: Tool<any>[] = [
  searchProducts,
  getProducts,
  checkStock,
  getCart,
  addToCart,
  updateCartItem,
  checkout,
  getOrder,
  listOrders,
  listNotifications,
  listLowStock,
  setStock,
];

export function toolsFor(identity: Identity): Tool<any>[] {
  return TOOLS.filter((tool) => !tool.adminOnly || identity.role === "admin");
}

export { runTool, type Tool, type ToolContext } from "./define.js";
