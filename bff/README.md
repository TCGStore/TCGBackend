# bff

API Gateway / BFF en NestJS + GraphQL (Apollo). Es lo único con lo que habla el
frontend: traduce cada consulta GraphQL a llamadas gRPC a los microservicios, y por
REST al mcp-server para las acciones del asistente.
Escucha en el puerto **4000** (`/graphql`, y `/health` para Kubernetes).

## El contrato: `schema.graphql`

El esquema está escrito a mano (*schema-first*) en [`schema.graphql`](schema.graphql),
y es el contrato con el frontend, igual que `proto/` lo es entre servicios. Los
cambios se acuerdan con quien hace el frontend.

Mismas convenciones que `proto/README.md`:

- **Dinero en centavos enteros** (`priceCents`, `totalCents`).
- **Fechas como string RFC 3339.**
- **Enums sin prefijo**: `PRODUCT_TYPE_CARD` del proto es `CARD` en GraphQL. El valor
  `*_UNSPECIFIED` del proto ("no definido") llega como `null`.

Para explorarlo, abre <http://localhost:4000/graphql> en el navegador (GraphiQL, con
autocompletado y documentación de cada campo).

## Autenticación

1. El frontend llama a `login` o `register` y recibe un `token` (JWT).
2. En cada petición lo manda en el header `Authorization: Bearer <token>`.
3. El BFF verifica la firma con `JWT_SECRET` **sin llamar a users-service** (es la
   misma clave con la que users-service lo firmó) y saca `id`, `email` y `role`.

Los `user_id` que llegan a los servicios salen siempre del token, nunca de los
argumentos de la consulta: un cliente no puede pedir el carrito o los pedidos de otro.
`setStock` solo funciona con `role: admin`.

Errores: cada error trae `extensions.code` (`UNAUTHENTICATED`, `FORBIDDEN`,
`BAD_USER_INPUT`, `NOT_FOUND`, `ALREADY_EXISTS`, `FAILED_PRECONDITION`,
`SERVICE_UNAVAILABLE`, `INTERNAL_SERVER_ERROR`). Los errores internos de los servicios
se registran en el log del BFF y no se muestran al cliente.

## Estructura

```
schema.graphql         contrato con el frontend
src/
  main.ts              arranque (CORS, puerto)
  app.module.ts        módulos de Nest, GraphQL y /health
  config.ts            variables de entorno
  auth/auth.guard.ts   verificación del JWT (AuthGuard, AdminGuard, @CurrentUser)
  grpc/clients.ts      un cliente gRPC por servicio, con métodos que devuelven promesas
  grpc/errors.ts       código gRPC → código de error GraphQL
  grpc/types.ts        mensajes de proto/ en TypeScript
  graphql/context.ts   DataLoaders (agrupan llamadas, ver abajo)
  graphql/mappers.ts   mensaje gRPC → tipo GraphQL
  mcp/mcp.client.ts    cliente REST del mcp-server
  resolvers/           un resolver por área: catálogo, usuarios, pedidos, notificaciones, chat
test/                  vitest: la app real contra un servidor gRPC falso con los 5 servicios
```

Igual que notifications-service, los `.proto` se leen **al arrancar** (con
`@grpc/proto-loader`), así que no hay código generado. Por eso el Dockerfile se
construye desde la raíz del repo y copia `proto/`.

### DataLoader: por qué una página de 20 productos no hace 20 llamadas

En GraphQL cada campo se resuelve por separado. Si el frontend pide
`products { items { stock { available } } }`, el campo `stock` se resuelve una vez por
producto. Con un DataLoader esas 20 peticiones se juntan en **una sola** llamada
`GetStocks` con los 20 ids. Lo mismo pasa con `product` en las líneas del carrito y
de los pedidos (`GetProducts`).

Además, si inventory-service está caído, `stock` llega en `null` (con un error
`SERVICE_UNAVAILABLE`) pero el catálogo se sigue mostrando.

### Checkout

`checkout` usa la dirección del perfil si no se le pasa `shippingAddress`, y el email del
JWT (orders-service lo manda en los eventos para que notifications-service envíe los
correos). El pedido nace `PENDING` y pasa a `CONFIRMED` o `CANCELLED` un momento después
(la saga por RabbitMQ): el frontend puede consultar `order(id)` o mirar las notificaciones.

### Chat y acciones del asistente

`chat(message, conversationId)` reenvía el mensaje al agente del mcp-server (`POST /chat`)
con el JWT del usuario. Devuelve la respuesta (`reply`), el `conversationId` que hay que
mandar en el siguiente mensaje para seguir la misma conversación, y `actions`.

```graphql
mutation {
  chat(message: "busca cartas de tipo agua bajo 30 dólares") {
    conversationId
    reply
    actions { actionId kind summary expiresAt }
  }
}
```

Una respuesta puede tardar varios segundos (el agente consulta los servicios entre medio),
así que conviene mostrar un "escribiendo...". Errores: `SERVICE_UNAVAILABLE` si Claude no
responde o falta la API key, `FAILED_PRECONDITION` si se manda otro mensaje a la misma
conversación antes de recibir la respuesta anterior.

Cuando el asistente prepara una compra o un cambio de stock, no la ejecuta: la devuelve en
`actions`, con un `actionId` (ver `mcp-server/README.md`). El frontend muestra una tarjeta
con el `summary` y los botones:

- **Confirmar** → `confirmAction(actionId)`. Devuelve `kind` y el `order` creado (o el
  `stock` nuevo, si era un admin cambiando stock).
- **Cancelar** → `cancelAction(actionId)`.

El BFF las reenvía por REST al mcp-server (`POST /actions/{id}/confirm|cancel`) con el
mismo JWT del usuario, y el mcp-server vuelve a verificar que la acción sea suya. Errores:
`NOT_FOUND` si ya se usó o venció (10 minutos), `FAILED_PRECONDITION` si el carrito cambió
desde que se preparó la compra.

## Correr en local

Requisitos: Node.js 22 o superior, y los microservicios corriendo (`docker compose up -d`
desde la raíz).

```bash
make install
make run    # toma JWT_SECRET de ../.env; GraphiQL en http://localhost:4000/graphql
make test   # no necesita Docker
```

O todo con Docker desde la raíz: `docker compose up -d --build bff`.

### Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `JWT_SECRET` | (obligatoria) | La misma de users-service |
| `PORT` | `4000` | |
| `CORS_ORIGINS` | `http://localhost:3000` | Orígenes del frontend, separados por coma |
| `PROTO_DIR` | `../proto` | |
| `GRPC_DEADLINE_MS` | `5000` | Tiempo máximo de cada llamada gRPC |
| `MCP_URL` | `http://localhost:4100` | API REST del mcp-server |
| `CATALOG_GRPC_TARGET` … `NOTIFICATIONS_GRPC_TARGET` | `localhost:50051` … `50055` | Dirección de cada servicio |

### Ejemplo de compra completa

```graphql
mutation { login(email: "admin@tcgstore.local", password: "admin12345") { token } }
```

Con el token en el header (en GraphiQL, pestaña *Headers*:
`{"Authorization": "Bearer <token>"}`):

```graphql
query { products(filter: { type: CARD }) { items { id name priceCents stock { available } } } }

mutation { addToCart(productId: "<id>", quantity: 1) { totalCents } }

mutation {
  checkout(shippingAddress: {
    recipientName: "Ash", street: "Ruta 1", city: "Pueblo Paleta",
    region: "Kanto", postalCode: "00001", country: "CL"
  }) { id status }
}

query { order(id: "<id>") { status cancellationReason } }
query { notifications { items { title message } } }
```

## Dependencias

`package.json` fija con `overrides` dos dependencias internas (`@graphql-tools/utils` y
`multer`) en versiones que corrigen vulnerabilidades. Se pueden quitar cuando se
actualicen `@nestjs/graphql` y `@nestjs/platform-express`.
