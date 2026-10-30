# proto

Contratos compartidos por el BFF, el MCP server y los microservicios.

Esta carpeta es la **fuente de verdad**. Cada microservicio guarda en su propio repo
(carpeta `proto/`) una copia de los archivos que usa; no se editan allá.

| Archivo | Servidor | Clientes |
|---|---|---|
| `catalog.proto` | catalog-service (Go) | BFF, MCP, orders-service |
| `inventory.proto` | inventory-service (Python) | BFF, MCP |
| `orders.proto` | orders-service (Java) | BFF, MCP |
| `users.proto` | users-service (C#) | BFF |
| `notifications.proto` | notifications-service (TypeScript) | BFF |
| `events.md` | Eventos de RabbitMQ (no son gRPC) | orders, inventory, notifications |

Cualquier cambio aquí afecta a varios servicios: se acuerda con el equipo antes de hacer merge.
Después del merge, `./scripts/sync-proto.sh` copia los archivos a los repos de los servicios
(clonados junto a este) y se abre un PR en cada uno que haya cambiado.

## Convenciones

- **Dinero en centavos enteros** (`int64 price_cents`), nunca `float`.
- **Fechas como string RFC 3339** (`"2026-10-26T18:00:00Z"`), para no depender de
  `google.protobuf.Timestamp` en cinco lenguajes.
- **Enums con prefijo y valor 0 `*_UNSPECIFIED`**: en proto3 el 0 es el valor por
  defecto, así que nunca debe significar algo real.
- **`user_id` viaja en el request.** El BFF lo saca del JWT ya verificado; los
  servicios confían en él porque solo el BFF y el MCP pueden llamarlos dentro del clúster.
- **Nunca reutilizar ni cambiar el número de un campo** (`= 1`, `= 2`...). Para
  quitar uno, se borra y se marca con `reserved 3;`.
- **Errores con códigos gRPC estándar:** `NOT_FOUND`, `INVALID_ARGUMENT`,
  `ALREADY_EXISTS`, `UNAUTHENTICATED`, `FAILED_PRECONDITION`.
- Cada servicio implementa además el health check estándar `grpc.health.v1`
  (lo usan las probes de Kubernetes) y activa server reflection para probar con `grpcurl`.

## JWT

Lo emite users-service y lo verifica el BFF con la misma clave (`JWT_SECRET`).

- Algoritmo `HS256`, expira en 24 horas.
- Claims: `sub` (id del usuario), `email`, `role` (`customer` o `admin`), `iat`, `exp`.

## Puertos gRPC

| Servicio | Puerto |
|---|---|
| catalog-service | 50051 |
| orders-service | 50052 |
| inventory-service | 50053 |
| users-service | 50054 |
| notifications-service | 50055 |
