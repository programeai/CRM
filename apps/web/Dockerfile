# syntax=docker/dockerfile:1
#
# Imagem do front (React + Vite servido por nginx). Build a partir da RAIZ:
#   docker build -f apps/web/Dockerfile .
#
# As VITE_* são embutidas no bundle em BUILD-TIME — trocar qualquer uma delas
# exige rebuild da imagem, não basta reiniciar o container.
FROM node:26-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter web --frozen-lockfile
COPY apps/web apps/web
# Base da API que o navegador chama. Em produção é o caminho relativo `/api/v1`
# (mesma origem do front, roteado pelo Traefik até o container da API).
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
# Site key do captcha do registro (Cloudflare Turnstile). Vazia desativa.
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN pnpm --filter web build

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
