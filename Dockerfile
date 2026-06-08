# Stage 1: Build TypeScript source code
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && rm -f package*.json

COPY --from=builder /app/dist ./dist

# Use node non-root user for security
USER node

ENTRYPOINT ["node", "dist/index.js"]
