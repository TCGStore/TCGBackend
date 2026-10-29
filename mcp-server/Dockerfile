# Build context is the repo root (the image needs proto/ at runtime):
#   docker build -f mcp-server/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci
COPY mcp-server/tsconfig.json mcp-server/tsconfig.build.json ./
COPY mcp-server/src/ src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PROTO_DIR=/app/proto
COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ dist/
COPY proto/*.proto proto/
USER node
EXPOSE 4100
CMD ["node", "dist/main.js"]
