# syntax=docker/dockerfile:1

########################
# 1. Build stage
########################
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci

COPY tsconfig.json tailwind.config.js ./
COPY src ./src

RUN npm run build

########################
# 2. Runtime stage
########################
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    CONFIG_PATH=/data/config.json

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "dist/server.js"]
