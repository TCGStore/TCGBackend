# mcp-server

TypeScript (Node.js 22). Las **herramientas (tools)** que usa el agente de IA, expuestas
como un **servidor MCP** estándar. Cada tool llama por gRPC a los microservicios.
Puerto **4100**.

> **¿Qué es MCP?** *Model Context Protocol* es un estándar para conectar herramientas a una
> IA, como un "enchufe universal": cualquier cliente MCP (Claude Code, Claude Desktop, o
> nuestro propio agente) puede ver la lista de tools, sus parámetros, y llamarlas.

Estado: **las tools están listas**. Falta el loop del agente (`POST /chat`, con la API de
Claude), que va a usar estas mismas tools.

## Tools

| Tool | Servicio · RPC | Tipo |
|---|---|---|
| `search_products` | catalog · `SearchProducts` + inventory · `GetStocks` | lectura |
| `get_products` | catalog · `GetProducts` + inventory · `GetStocks` | lectura |
| `check_stock` | inventory · `GetStocks` | lectura |
| `get_cart` | orders · `GetCart` | lectura |
| `add_to_cart`, `update_cart_item` | orders · `AddCartItem`, `UpdateCartItem` | escritura reversible |
| `checkout` | orders · `Checkout` | **requiere confirmación** |
| `get_order`, `list_orders` | orders · `GetOrder`, `ListOrders` | lectura |
| `list_notifications` | notifications · `ListNotifications` | lectura |
| `list_low_stock` | notifications (alertas) + inventory | solo admin, lectura |
| `set_stock` | inventory · `SetStock` | solo admin, **requiere confirmación** |

Diferencias con los servicios, pensadas para la IA:

- **Precios en dólares** (`price_usd: 8.99`, `max_price_usd: 30`), porque así habla el
  cliente ("bajo 30 dólares"). Los servicios siguen en centavos; la conversión está en
  `src/tools/format.ts`.
- **Las búsquedas traen el stock** (`available`), así el agente no necesita otra llamada
  para descartar lo agotado.
- Los errores de los servicios llegan al modelo como texto ("quantity must be positive",
  "OrdersService is unavailable, try again later") para que pueda reaccionar.

## Seguridad: las tres reglas de la propuesta

1. **La identidad la pone el servidor.** Cada petición trae el JWT del usuario
   (`Authorization: Bearer`) y el MCP lo verifica con `JWT_SECRET`, igual que el BFF. Las
   tools toman el `user_id` de ahí: ninguna tool recibe un `user_id` como parámetro, así que
   el modelo no puede pedir el carrito de otro.
2. **Las tools de admin solo existen para admins.** El servidor MCP se arma en cada
   petición con las tools del rol del token: un cliente ni siquiera ve `set_stock`.
3. **Confirmación en dos pasos.** `checkout` y `set_stock` **no ejecutan nada**: devuelven
   una *acción pendiente* (`actionId`, resumen, detalle). Solo se ejecuta cuando llega
   `POST /actions/{actionId}/confirm` con el token del mismo usuario. Ese endpoint es REST,
   no es una tool, así que **el modelo no tiene forma de confirmar por sí mismo**: lo
   llamará el BFF cuando el usuario haga clic en "Confirmar".
   - Cada acción se puede confirmar una sola vez y vence a los 10 minutos.
   - Si el carrito cambió entre que se preparó la compra y el clic, la confirmación falla
     (`409`) y hay que prepararla de nuevo: el usuario compra exactamente lo que vio.
   - Las acciones pendientes viven en memoria, así que el MCP corre con **una sola réplica**.

## Endpoints

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/mcp` | Protocolo MCP (Streamable HTTP, sin sesión: un servidor nuevo por petición) |
| `POST` | `/actions/{id}/confirm` | Ejecuta una acción pendiente. Responde el pedido o el stock nuevo |
| `POST` | `/actions/{id}/cancel` | La descarta |
| `GET` | `/health` | Para Kubernetes |

Todos menos `/health` necesitan `Authorization: Bearer <JWT>`. `404` si la acción no existe,
venció o es de otro usuario.

## Estructura

```
src/
  main.ts          arranque
  app.ts           Express: /mcp, /actions, /health y verificación del JWT
  mcp.ts           arma el servidor MCP con las tools del rol del usuario
  auth.ts          verificación del JWT
  actions.ts       acciones pendientes (confirmación en dos pasos)
  grpc.ts          clientes gRPC (mismo enfoque que el BFF: .proto leídos al arrancar)
  tools/
    define.ts      forma de una tool: nombre, descripción, schema (zod) y función
    catalog.ts     search_products, get_products, check_stock
    orders.ts      carrito, checkout, pedidos, notificaciones
    admin.ts       list_low_stock, set_stock
    format.ts      centavos → dólares, enums, vista de producto/carrito/pedido
test/              vitest: un cliente MCP real contra un servidor gRPC falso
```

Cada tool se define una sola vez en `src/tools/`. El servidor MCP la expone ahora; el
loop del agente la va a pasar al Tool Runner del SDK de Anthropic con el mismo schema.

## Correr en local

Requisitos: Node.js 22 o superior, y los microservicios corriendo.

```bash
make install
make run    # toma JWT_SECRET de ../.env
make test   # no necesita Docker
```

O con Docker desde la raíz: `docker compose up -d --build mcp-server`.

### Probarlo con Claude Code

Como es un servidor MCP estándar, se puede conectar a Claude Code y usar la tienda
conversando, sin el agente ni la API key (útil para la presentación).

1. Saca un token: `mutation { login(email: "...", password: "...") { token } }` en
   <http://localhost:4000/graphql>.
2. Agrega el servidor:

   ```bash
   claude mcp add --transport http tcg-store http://localhost:4100/mcp \
     --header "Authorization: Bearer <token>"
   ```

3. En Claude Code: *"busca cartas de tipo agua bajo 30 dólares y agrega la más barata al
   carrito"*.
4. Para confirmar una compra (mientras no exista el botón del frontend):

   ```bash
   curl -X POST http://localhost:4100/actions/<actionId>/confirm -H "Authorization: Bearer <token>"
   ```

El token dura 24 horas; con un token de admin aparecen también `list_low_stock` y `set_stock`.

### Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `JWT_SECRET` | (obligatoria) | La misma de users-service y el BFF |
| `PORT` | `4100` | |
| `PROTO_DIR` | `../proto` | |
| `GRPC_DEADLINE_MS` | `5000` | Tiempo máximo de cada llamada gRPC |
| `CATALOG_GRPC_TARGET` … `NOTIFICATIONS_GRPC_TARGET` | `localhost:50051` … `50055` | Dirección de cada servicio |

## Dependencias

Usa la **v2** del SDK de MCP (`@modelcontextprotocol/server`), la línea estable actual.
`package.json` fija con `overrides` `@hono/node-server` (dependencia interna del adaptador
de Node) en una versión que corrige una vulnerabilidad; se puede quitar al actualizar
`@modelcontextprotocol/node`.
