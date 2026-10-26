# bff

API Gateway / BFF en NestJS + GraphQL.

- Expone el esquema GraphQL que consume el frontend.
- Llama a los microservicios por gRPC (contratos en `proto/`).
- Reenvía el chat al MCP server por REST (`POST /chat`).
