// Messages as @grpc/proto-loader returns them: camelCase, int64 as number, enums by
// full name ("PRODUCT_TYPE_CARD") and unset scalars as "" or 0.

// catalog.proto

export interface Product {
  id: string;
  name: string;
  type: string;
  priceCents: number;
  imageUrl: string;
  description: string;
  card?: CardDetails;
  sealed?: SealedDetails;
}

export interface CardDetails {
  setCode: string;
  setName: string;
  number: string;
  rarity: string;
  language: string;
  supertype: string;
  types: string[];
  condition: string;
  grading: { company: string; grade: string } | null;
}

export interface SealedDetails {
  setCode: string;
  setName: string;
  language: string;
}

export interface SearchProductsRequest {
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
  page?: number;
  pageSize?: number;
}

export interface CatalogService {
  getProduct(request: { id: string }): Promise<Product>;
  getProducts(request: { ids: string[] }): Promise<{ products: Product[] }>;
  searchProducts(request: SearchProductsRequest): Promise<{ products: Product[]; totalCount: number }>;
}

// inventory.proto

export interface StockLevel {
  productId: string;
  available: number;
  reserved: number;
  lowStock: boolean;
}

export interface InventoryService {
  getStocks(request: { productIds: string[] }): Promise<{ stocks: StockLevel[] }>;
  setStock(request: { productId: string; available: number }): Promise<StockLevel>;
}

// orders.proto and users.proto (same fields in both)

export interface Address {
  recipientName: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

// orders.proto

export interface LineItem {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
}

export interface Cart {
  userId: string;
  items: LineItem[];
  totalCents: number;
}

export interface Order {
  id: string;
  userId: string;
  status: string;
  items: LineItem[];
  totalCents: number;
  shippingAddress: Address;
  cancellationReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrdersService {
  getCart(request: { userId: string }): Promise<Cart>;
  addCartItem(request: { userId: string; productId: string; quantity: number }): Promise<Cart>;
  updateCartItem(request: { userId: string; productId: string; quantity: number }): Promise<Cart>;
  clearCart(request: { userId: string }): Promise<Cart>;
  checkout(request: { userId: string; userEmail: string; shippingAddress: Address }): Promise<Order>;
  getOrder(request: { userId: string; orderId: string }): Promise<Order>;
  listOrders(request: { userId: string; page: number; pageSize: number }): Promise<{ orders: Order[]; totalCount: number }>;
}

// users.proto

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  shippingAddress: Address | null;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresAt: number;
  user: User;
}

export interface UsersService {
  register(request: { email: string; password: string; name: string }): Promise<AuthResponse>;
  login(request: { email: string; password: string }): Promise<AuthResponse>;
  getProfile(request: { userId: string }): Promise<User>;
  updateProfile(request: { userId: string; name?: string; shippingAddress?: Address }): Promise<User>;
}

// notifications.proto

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  orderId: string;
  productId: string;
}

interface Reader {
  userId: string;
  includeAdmin: boolean;
}

export interface NotificationsService {
  listNotifications(
    request: Reader & { unreadOnly: boolean; page: number; pageSize: number },
  ): Promise<{ notifications: Notification[]; totalCount: number }>;
  getUnreadCount(request: Reader): Promise<{ count: number }>;
  markAsRead(request: Reader & { notificationIds: string[] }): Promise<{ updatedCount: number }>;
}
