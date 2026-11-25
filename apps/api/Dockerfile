# syntax=docker/dockerfile:1.7
# ORVYN API (and worker: same image, PROCESS_ROLE=worker). Build from the repo root:
#   docker build -f apps/api/Dockerfile -t orvyn-api .
ARG NODE_IMAGE=mirror.gcr.io/library/node:22-alpine

FROM ${NODE_IMAGE} AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/today-parse/package.json packages/today-parse/
COPY packages/today-plan/package.json packages/today-plan/
COPY packages/money/package.json packages/money/
COPY packages/vault-crypto/package.json packages/vault-crypto/
COPY packages/library/package.json packages/library/
COPY packages/activity/package.json packages/activity/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --filter @orvyn/api...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @orvyn/api... build \
 && pnpm --filter @orvyn/api deploy --legacy --prod /out \
 && cp -r apps/api/dist apps/api/drizzle /out/

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# local file store (FILES_STORE=local): a volume mounted here inherits this ownership
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
