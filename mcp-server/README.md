# mcp-server

TypeScript. MCP server + agente de IA (Claude).

- Recibe mensajes del BFF en `POST /chat` (REST).
- Ejecuta el loop del agente con el SDK de Anthropic.
- Tools: `buscar_cartas`, `consultar_stock`, `armar_mazo`, `crear_pedido`,
  `estado_pedido`, que llaman a los microservicios por gRPC.
- La API key va en la variable de entorno `ANTHROPIC_API_KEY` (nunca en el repo).
