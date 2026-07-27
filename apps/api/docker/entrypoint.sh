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
# 0. Falha de boot é log estruturado
# ---------------------------------------------------------------------------
# Uma linha JSON por aborto, para a queda cair em `{stack="crm", level="error"}`
# no Grafana. Sem isso, API que morre aqui não emite NENHUMA linha de erro — o
# painel de erros fica zerado justamente quando a aplicação está fora, que foi o
# que deixou a queda de 27/07/2026 passar 11 horas sem ninguém notar.
# `msg` entra literal no JSON: use texto simples, sem aspas nem barra invertida.
abortar() {
  printf '{"level":"error","time":"%s","evento":"%s","msg":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"
  exit 1
}

# ---------------------------------------------------------------------------
# 1. Migrations
# ---------------------------------------------------------------------------
# Só erro de conexão é transitório e merece nova tentativa — é o intervalo entre
# o Postgres subir e aceitar conexões. Migration que falhou (P3009), SQL inválido
# ou permissão negada não melhoram com insistência: repetir dez vezes só enterra
# a causa real sob dez cópias de "banco indisponível", que foi exatamente o que
# atrasou o diagnóstico da queda de 27/07/2026.
echo "==> Aplicando migrations..."
tentativa=1
while :; do
  if saida=$($PRISMA migrate deploy --schema="$SCHEMA" 2>&1); then
    printf '%s\n' "$saida"
    break
  fi
  printf '%s\n' "$saida" >&2

  case "$saida" in
    *P3009*)
      echo "!! Há migration marcada como FALHA no banco; nenhuma nova será aplicada." >&2
      echo "   1) veja o erro original que derrubou a migration:" >&2
      echo "      select migration_name, started_at, logs from _prisma_migrations where finished_at is null;" >&2
      echo "   2) se a transação reverteu por inteiro (o normal), marque como revertida e corrija a causa:" >&2
      echo "      prisma migrate resolve --rolled-back <nome_da_migration>" >&2
      abortar 'app.migracao_falhou' 'Migration marcada como falha no banco (P3009). A API nao sobe ate resolver.'
      ;;
    *P1001*|*P1002*) ;;
    *)
      abortar 'app.migracao_falhou' 'Falha ao aplicar migrations que nao e de conexao. Ver stderr do container.'
      ;;
  esac

  if [ "$tentativa" -ge 10 ]; then
    abortar 'app.falhou_ao_iniciar' 'Banco inalcancavel apos 10 tentativas.'
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
      echo "   Gere com: openssl rand -hex 32" >&2
      abortar 'app.falhou_ao_iniciar' 'APP_DB_PASSWORD nao pode conter apostrofo nem barra invertida.'
      ;;
  esac
  echo "==> Alinhando a senha da role crm_app..."
  echo "ALTER ROLE crm_app WITH PASSWORD '$APP_DB_PASSWORD';" \
    | $PRISMA db execute --stdin --schema="$SCHEMA"
  echo "==> Role crm_app atualizada."
else
  echo "   Sem APP_DB_PASSWORD a role crm_app fica com a senha de desenvolvimento" >&2
  echo "   gravada pela migration — que é pública neste repositório." >&2
  echo "   Gere com: openssl rand -hex 32   (sem apóstrofo nem barra invertida)" >&2
  abortar 'app.falhou_ao_iniciar' 'APP_DB_PASSWORD nao definida.'
fi

echo "==> Iniciando a API..."
exec "$@"
