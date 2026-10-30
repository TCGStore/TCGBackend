# Pokémon TCG Store

Tienda online de productos Pokémon enfocada en el juego de cartas (TCG):
cartas individuales y producto sellado, con un agente de IA (Claude) que
atiende a los clientes por chat.

## Arquitectura

```
Frontend (Next.js + Apollo Client)
   │ GraphQL
   ▼
BFF (NestJS + GraphQL) ──REST──► MCP server + agente (TypeScript) ──► Claude API
   │ gRPC                              │ gRPC (tools)
   ├──► catalog-service       (Go + MongoDB)
   ├──► orders-service        (Java Spring Boot + PostgreSQL)
   ├──► inventory-service     (Python + Redis)
   ├──► users-service         (C# .NET + PostgreSQL)
   └──► notifications-service (TypeScript + MongoDB) ──► Mailpit

RabbitMQ (exchange topic tcg.events): orders, inventory y notifications
```

## Repositorios

El proyecto está separado en siete repositorios:

| Repo | Contenido |
|---|---|
| [TCGFrontend](https://github.com/TCGStore/TCGFrontend) | Next.js |
| [TCGBackend](https://github.com/TCGStore/TCGBackend) (este) | BFF, MCP server, contratos (`proto/`), `docker-compose.yml` y `k8s/` |
| [TCGCatalogService](https://github.com/TCGStore/TCGCatalogService) | Go + MongoDB |
| [TCGOrderService](https://github.com/TCGStore/TCGOrderService) | Java Spring Boot + PostgreSQL |
| [TCGInventoryService](https://github.com/TCGStore/TCGInventoryService) | Python + Redis |
| [TCGUserService](https://github.com/TCGStore/TCGUserService) | C# .NET + PostgreSQL |
| [TCGNotificationService](https://github.com/TCGStore/TCGNotificationService) | TypeScript + MongoDB |

Estructura de este repo:

| Carpeta | Contenido |
|---|---|
| `bff/` | NestJS + GraphQL |
| `mcp-server/` | MCP server + agente (TypeScript) |
| `proto/` | Contratos gRPC y eventos (fuente de verdad, ver `proto/README.md`) |
| `scripts/sync-proto.sh` | Copia los contratos a los repos de los servicios |
| `k8s/` | Manifiestos de Kubernetes |

## Desarrollo local

`docker-compose.yml` construye los microservicios desde los repos hermanos, así que
los siete deben estar clonados en la misma carpeta:

```
pokemon-tcg-store/
├── TCGBackend/
├── TCGFrontend/
├── TCGCatalogService/
├── TCGOrderService/
├── TCGInventoryService/
├── TCGUserService/
└── TCGNotificationService/
```

```bash
# desde TCGBackend/
cp .env.example .env      # completa los valores
docker compose up -d      # levanta los servicios, el BFF, el MCP y la infraestructura
```

## Flujo de trabajo

- `main`: siempre funcional · `develop`: integración · `feature/<tarea>`: trabajo diario.
- Todo entra a `develop` por pull request revisado por otro integrante.
- No subir `.env` ni API keys.
