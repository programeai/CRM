#!/bin/sh
# Entrypoint de produção da API. Roda a cada start do container; todas as etapas
# são idempotentes:
#   1. aplica as migrations (como DATABASE_URL = crm_user, dono do schema);
#   2. alinha a senha da role de aplicação `crm_app` com APP_DB_PASSWORD;
#   3. sobe o servidor Nest (CMD).
set -e

PRISMA="node apps/api/node_modules/prisma/build/index.js"
SCHEMA="apps/api/prisma/schema.prisma"

# ---------------------------------------------------------------------------
# 1. Migrations
# ---------------------------------------------------------------------------
# `migrate deploy` já falha se o banco não responder; tentamos algumas vezes
# para tolerar o intervalo entre o Postgres subir e aceitar conexões.
echo "==> Aplicando migrations..."
tentativa=1
until $PRISMA migrate deploy --schema="$SCHEMA"; do
  if [ "$tentativa" -ge 10 ]; then
    echo "!! Banco indisponível após $tentativa tentativas. Abortando." >&2
    exit 1
  fi
  echo "   banco ainda indisponível (tentativa $tentativa) — nova tentativa em 3s..."
  tentativa=$((tentativa + 1))
  sleep 3
done
echo "==> Migrations aplicadas."

# ---------------------------------------------------------------------------
# 2. Senha da role de aplicação (RLS)
# ---------------------------------------------------------------------------
# A migration 20260724040000_create_app_role cria `crm_app` com uma senha fixa
# de desenvolvimento. Em produção a senha real vem de APP_DB_PASSWORD e é
# aplicada aqui — é o único ponto onde ela é gravada no banco, e o mesmo valor
# monta a APP_DATABASE_URL no compose.
if [ -n "$APP_DB_PASSWORD" ]; then
  # ALTER ROLE não aceita placeholder: a senha entra literal na instrução. Um
  # apóstrofo quebraria o comando (e permitiria injeção), então recusamos.
  case "$APP_DB_PASSWORD" in
    *"'"*|*'\'*)
      echo "!! APP_DB_PASSWORD não pode conter apóstrofo (') nem barra invertida." >&2
      echo "   Gere com: openssl rand -hex 32" >&2
      exit 1
      ;;
  esac
  echo "==> Alinhando a senha da role crm_app..."
  echo "ALTER ROLE crm_app WITH PASSWORD '$APP_DB_PASSWORD';" \
    | $PRISMA db execute --stdin --schema="$SCHEMA"
  echo "==> Role crm_app atualizada."
else
  echo "!! APP_DB_PASSWORD não definida — crm_app segue com a senha da migration." >&2
fi

echo "==> Iniciando a API..."
exec "$@"
