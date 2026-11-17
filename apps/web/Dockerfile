# syntax=docker/dockerfile:1.7
# ORVYN web (Next.js standalone). Build from the repo root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.orvyn.dubey.app -t orvyn-web .
ARG NODE_IMAGE=mirror.gcr.io/library/node:22-alpine

FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/today-parse/package.json packages/today-parse/
COPY packages/today-plan/package.json packages/today-plan/
COPY packages/sync-client/package.json packages/sync-client/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @orvyn/web...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
# public values only: baked into the browser bundle
ARG NEXT_PUBLIC_API_URL=https://api.orvyn.dubey.app
ARG NEXT_PUBLIC_GOOGLE_ENABLED=0
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_PUBLIC_GOOGLE_ENABLED=${NEXT_PUBLIC_GOOGLE_ENABLED} \
    NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @orvyn/web... build

FROM ${NODE_IMAGE}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/sign-in > /dev/null || exit 1
CMD ["node", "apps/web/server.js"]
