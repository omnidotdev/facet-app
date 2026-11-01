# syntax=docker/dockerfile:1

# Build the static Vite/TanStack SPA, then serve it with nginx. The Rust/WASM
# kernel is vendored in src/wasm, so no Rust toolchain is needed at build time.

FROM oven/bun:1.4.4 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS builder
# Vite inlines config at build time, so the AI gateway, identity, and account
# hub URLs arrive as build args (passed by the Fractal service build.args). All
# are optional: with no gateway URL the AI panel hides itself and the app stays
# a pure local CAD tool, and with no account hub the upgrade CTA is hidden
ARG VITE_FACET_API_URL
ARG VITE_AUTH_BASE_URL
ARG VITE_ACCOUNT_URL
ENV VITE_FACET_API_URL=$VITE_FACET_API_URL
ENV VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL
ENV VITE_ACCOUNT_URL=$VITE_ACCOUNT_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
