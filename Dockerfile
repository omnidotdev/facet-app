# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# Build the static Vite/TanStack SPA, then serve it with nginx. The Rust/WASM
# kernel is vendored in src/wasm, so no Rust toolchain is needed at build time.

FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS base
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

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
