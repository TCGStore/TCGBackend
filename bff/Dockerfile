# Build context is the repo root (the image needs proto/ at runtime):
#   docker build -f bff/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY bff/package.json bff/package-lock.json ./
RUN npm ci
COPY bff/tsconfig.json bff/tsconfig.build.json bff/nest-cli.json ./
COPY bff/src/ src/
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PROTO_DIR=/app/proto
COPY bff/package.json bff/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ dist/
COPY bff/schema.graphql ./
COPY proto/*.proto proto/
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
