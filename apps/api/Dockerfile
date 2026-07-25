# syntax=docker/dockerfile:1
#
# Imagem da API (NestJS + Prisma). Build a partir da RAIZ do monorepo:
#   docker build -f apps/api/Dockerfile .
#
# Alpine em todos os stages para manter o mesmo engine do Prisma
# (linux-musl-openssl-3.0.x) entre build e runtime.
ARG NODE_IMAGE=node:22-alpine

# ---------------------------------------------------------------------------
# deps — node_modules completo a partir do lockfile (camada cacheável)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter api --frozen-lockfile

# ---------------------------------------------------------------------------
# build — gera o Prisma Client e compila o Nest
# ---------------------------------------------------------------------------
FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter api exec prisma generate && pnpm --filter api build

# ---------------------------------------------------------------------------
# prod-deps — node_modules sem devDeps, com o Prisma Client regerado.
# A CLI do Prisma sobrevive ao prune porque está em `dependencies` (o entrypoint
# roda `migrate deploy` em runtime).
# ---------------------------------------------------------------------------
FROM deps AS prod-deps
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --filter api --frozen-lockfile --prod \
  && pnpm --filter api exec prisma generate

# ---------------------------------------------------------------------------
# runtime — imagem final
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache openssl
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3000

# Usuário não-root próprio (o node:alpine já ocupa o uid 1000 com `node`).
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nestjs

# O node_modules do pnpm é um grafo de symlinks para /repo/node_modules/.pnpm —
# os dois diretórios precisam ir para os MESMOS caminhos usados no build.
COPY --from=prod-deps --chown=nestjs:nodejs /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=nestjs:nodejs /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=nestjs:nodejs /repo/apps/api/dist ./apps/api/dist
# schema + migrations: usados pelo `migrate deploy` do entrypoint.
COPY --from=build --chown=nestjs:nodejs /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=nestjs:nodejs /repo/apps/api/package.json ./apps/api/
COPY --chown=nestjs:nodejs apps/api/docker/entrypoint.sh ./apps/api/docker/entrypoint.sh
RUN chmod +x ./apps/api/docker/entrypoint.sh

USER nestjs
EXPOSE 3000

ENTRYPOINT ["./apps/api/docker/entrypoint.sh"]
CMD ["node", "apps/api/dist/src/main.js"]
