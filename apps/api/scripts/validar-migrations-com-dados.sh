#!/usr/bin/env bash
# Portão de CI: aplica TODAS as migrations contra um banco com dado dentro.
#
# O problema que ele resolve
# --------------------------
# Migration só era exercitada contra banco recém-criado: o `global-setup.ts` do
# e2e cria o banco, roda `migrate deploy` numa base vazia e só depois semeia.
# Migration de backfill é justamente a que se comporta diferente com dado — e
# banco vazio faz o caminho perigoso não ser percorrido. Em 27/07/2026 a
# migration 20260726120000_pipeline_stages_per_owner passou verde no CI e
# derrubou a API em produção por 11 horas: ela replica o funil por owner com um
# CROSS JOIN sobre `User`, e sem nenhum User o CROSS JOIN não insere nada, então
# o índice único que ela violava nunca era tocado.
#
# Como funciona
# -------------
#  1. copia schema + migrations para um diretório temporário;
#  2. aplica SÓ o init (removendo as posteriores DA CÓPIA);
#  3. insere a fixture (prisma/fixtures/banco-populado.sql);
#  4. devolve as migrations à cópia e aplica o resto — agora sobre dado real;
#  5. confere as invariantes (prisma/fixtures/invariantes.sql).
#
# O passo 2 existe para a fixture depender só do schema do init, que é estável.
# Se ela fosse inserida no fim, cada migration nova exigiria atualizar a fixture.
#
# Tudo acontece numa CÓPIA, nunca no diretório do repositório. A primeira versão
# deste script movia as migrations reais e as devolvia num trap — o que perde a
# corrida contra um SIGKILL e deixa a árvore de trabalho sem migrations. Como
# alguém pode estar editando o repo enquanto isto roda (e o runner reusa o
# checkout nos passos seguintes, incluindo o build da imagem), o preço de errar é
# alto demais para depender de trap.
#
# Uso: DATABASE_URL=postgresql://user:senha@host:porta/qualquer_banco \
#        apps/api/scripts/validar-migrations-com-dados.sh
set -euo pipefail

cd "$(dirname "$0")/.."          # apps/api

CORTE=20260721002325_init        # última migration aplicada ANTES da fixture
BANCO=crm_validacao_migrations

: "${DATABASE_URL:?defina DATABASE_URL apontando para o Postgres de teste}"

# Troca o nome do banco na URL, preservando usuário, senha, host, porta e query.
url_para_banco() {
  printf '%s' "$DATABASE_URL" | sed -E "s#(://[^/]+/)[^?]+#\1$1#"
}

URL_ADMIN=$(url_para_banco postgres)
URL_ALVO=$(url_para_banco "$BANCO")

TRABALHO=$(mktemp -d)
trap 'rm -rf "$TRABALHO"' EXIT
cp -R prisma "$TRABALHO/prisma"
ESQUEMA="$TRABALHO/prisma/schema.prisma"

executar_sql() { pnpm exec prisma db execute --url "$1" --file "$2" > /dev/null; }
aplicar()      { DATABASE_URL="$URL_ALVO" pnpm exec prisma migrate deploy --schema "$ESQUEMA"; }

echo "==> 1/5 Recriando o banco de validação ($BANCO)"
pnpm exec prisma db execute --url "$URL_ADMIN" --stdin > /dev/null <<SQL
DROP DATABASE IF EXISTS "$BANCO";
SQL
pnpm exec prisma db execute --url "$URL_ADMIN" --stdin > /dev/null <<SQL
CREATE DATABASE "$BANCO";
SQL

echo "==> 2/5 Aplicando as migrations até $CORTE"
for caminho in "$TRABALHO"/prisma/migrations/*/; do
  nome=$(basename "$caminho")
  # `>` de bash compara string; os nomes começam com timestamp, então a ordem
  # lexicográfica é a ordem cronológica — o mesmo critério que o Prisma usa.
  if [[ "$nome" > "$CORTE" ]]; then
    rm -rf "$caminho"
  fi
done
aplicar

echo "==> 3/5 Inserindo a fixture de banco povoado"
executar_sql "$URL_ALVO" prisma/fixtures/banco-populado.sql

echo "==> 4/5 Aplicando as migrations restantes sobre dado real"
rm -rf "$TRABALHO/prisma/migrations"
cp -R prisma/migrations "$TRABALHO/prisma/migrations"
aplicar

echo "==> 5/5 Conferindo as invariantes"
executar_sql "$URL_ALVO" prisma/fixtures/invariantes.sql

echo "==> Migrations válidas com dado dentro."
