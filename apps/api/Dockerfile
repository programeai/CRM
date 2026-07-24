# build
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter api --frozen-lockfile
COPY apps/api apps/api
RUN pnpm --filter api exec prisma generate && pnpm --filter api build

# runtime
FROM node:22-alpine AS runtime
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter api exec prisma migrate deploy && node apps/api/dist/src/main.js"]
