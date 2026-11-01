# Multi-stage production Dockerfile for Campus Mess Frontend (Vite + Nginx)

# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json ./frontend/

RUN npm ci

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY package*.json ./
COPY frontend ./frontend

RUN npm run build --workspace=@campus-mess/frontend

# Stage 3: Production Nginx Server
FROM nginx:1.27-alpine AS runner

# Install curl for healthcheck
RUN apk add --no-cache curl

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy build artifacts and custom configuration
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]

