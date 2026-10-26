# proto

Contratos gRPC compartidos por el BFF, el MCP server y los microservicios.

- `catalog.proto`   → catalog-service
- `orders.proto`    → orders-service
- `inventory.proto` → inventory-service

Cualquier cambio aquí afecta a varios servicios: se acuerda con el equipo antes de hacer merge.
