#!/usr/bin/env bash
# Gera o .env da autohospedagem a partir de .env.selfhost.example, já com os
# quatro segredos preenchidos (openssl rand -hex 32).
#
#   ./scripts/gerar-env-autohospedagem.sh
#
# O que ele NÃO faz: adivinhar CRM_DOMAIN e ACME_EMAIL. Esses dois você edita à
# mão depois — o script avisa e o compose recusa subir sem eles.
#
# Nunca sobrescreve um .env existente: numa instância no ar, trocar
# APP_DB_PASSWORD e os segredos de JWT sem querer derruba as sessões e, pior,
# deixa a APP_DATABASE_URL fora de sincronia com a senha gravada no banco.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
MODELO="$RAIZ/.env.selfhost.example"
DESTINO="$RAIZ/.env"

if [ ! -f "$MODELO" ]; then
  echo "!! Não encontrei $MODELO — rode este script de dentro do repositório." >&2
  exit 1
fi

if [ -f "$DESTINO" ]; then
  echo "!! $DESTINO já existe. Nada foi alterado." >&2
  echo "   Para começar de novo, mova o atual: mv .env .env.antigo" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "!! openssl não encontrado — é ele que gera os segredos." >&2
  echo "   Debian/Ubuntu: sudo apt install openssl" >&2
  exit 1
fi

# hex é o formato certo aqui: sem apóstrofo e sem barra invertida, os dois
# caracteres que o entrypoint da API recusa em APP_DB_PASSWORD (ela entra
# literal num ALTER ROLE), e sem `$`, que o Compose interpretaria como variável.
segredo() { openssl rand -hex 32; }

# Preenche só as linhas `CHAVE=` (vazias) do modelo, uma a uma. Preservar os
# comentários é de propósito: o .env gerado continua sendo a documentação de si
# mesmo para quem for editá-lo na VPS depois.
preencher() {
  local chave="$1" valor="$2" arquivo="$3"
  # O valor é hex puro, então não há metacaractere de sed para escapar.
  sed -i "s|^${chave}=$|${chave}=${valor}|" "$arquivo"
}

cp "$MODELO" "$DESTINO"
chmod 600 "$DESTINO"

for chave in POSTGRES_PASSWORD APP_DB_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  preencher "$chave" "$(segredo)" "$DESTINO"
done

echo "==> .env criado com POSTGRES_PASSWORD, APP_DB_PASSWORD, JWT_ACCESS_SECRET"
echo "    e JWT_REFRESH_SECRET gerados (permissão 600)."
echo
echo "Faltam dois valores que só você sabe — edite o .env:"
echo "  CRM_DOMAIN   o domínio da instância, com DNS já apontado para esta VPS"
echo "  ACME_EMAIL   e-mail da conta Let's Encrypt"
echo
echo "Depois: docker compose -f docker-compose.selfhost.yml up -d --build"
