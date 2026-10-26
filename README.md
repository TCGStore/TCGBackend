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
   ├──► catalog-service   (Go + MongoDB)
   ├──► orders-service    (Java Spring Boot + PostgreSQL)
   └──► inventory-service (Python FastAPI + Redis)

orders-service ◄──RabbitMQ──► inventory-service
```

## Estructura

| Carpeta | Contenido |
|---|---|
| `frontend/` | Next.js |
| `bff/` | NestJS + GraphQL |
| `services/catalog-service/` | Go + MongoDB |
| `services/orders-service/` | Java Spring Boot + PostgreSQL |
| `services/inventory-service/` | Python FastAPI + Redis |
| `mcp-server/` | MCP server + agente (TypeScript) |
| `proto/` | Contratos gRPC compartidos |
| `k8s/` | Manifiestos de Kubernetes |

## Desarrollo local

```bash
cp .env.example .env      # completa los valores
docker compose up -d      # levanta MongoDB, PostgreSQL, Redis y RabbitMQ
```

## Flujo de trabajo

- `main`: siempre funcional · `develop`: integración · `feature/<tarea>`: trabajo diario.
- Todo entra a `develop` por pull request revisado por otro integrante.
- No subir `.env` ni API keys.
