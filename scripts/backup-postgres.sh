#!/usr/bin/env bash
# Backup do Postgres do CRM, com rotação e expiração.
#
# Existe porque a Política de Privacidade afirma que "os backups em rotação também
# expiram" — e uma afirmação dessas precisa de um cronograma real por trás. É a
# doutrina "beyond use" do ICO: quando não se pode sobrescrever de imediato, o que
# se exige é não reutilizar o dado para outra finalidade e deixá-lo expirar por
# cronograma estabelecido. Este arquivo É o cronograma.
#
# Uso (na VPS, pelo cron do host — ver docs/deploy.md):
#   BACKUP_DIR=/var/backups/crm scripts/backup-postgres.sh
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$(pwd)}"
BACKUP_DIR="${BACKUP_DIR:?defina BACKUP_DIR}"
RETENCAO_DIAS="${RETENCAO_DIAS:-30}"
COMPOSE="docker compose -f ${DEPLOY_DIR}/docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"
ARQUIVO="${BACKUP_DIR}/crm-$(date +%F-%H%M).dump"

$COMPOSE exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$ARQUIVO"

# Portão antes de rotacionar: dump vazio ou truncado significa que o pg_dump
# falhou de um jeito que o `set -e` não pegou (pipe). Apagar os backups antigos
# nessa situação é como perder o backup duas vezes.
if [ ! -s "$ARQUIVO" ] || [ "$(stat -c%s "$ARQUIVO")" -lt 1024 ]; then
  echo "backup vazio ou truncado: $ARQUIVO — rotação abortada" >&2
  exit 1
fi

# Ledger de encerramentos, fora do dump e append-only. É o que permite reaplicar
# uma exclusão depois de restaurar um backup ANTERIOR ao pedido — o caso que o
# tombstone dentro do banco (as colunas de encerramento em `User`, que voltam com
# o restore e fazem o cron expurgar de novo) não cobre. Só ownerId e data: nenhum
# dado pessoal.
LEDGER="${BACKUP_DIR}/encerramentos.csv"
$COMPOSE exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F',' -c \
  "SELECT \"entityId\", \"createdAt\" FROM \"AuditLog\"
    WHERE entity = 'ACCOUNT' AND action = 'EXPURGAR'" \
  >> "$LEDGER"
sort -u -o "$LEDGER" "$LEDGER"

# Expiração. `-mtime +N` é o que dá sentido à frase da Política.
find "$BACKUP_DIR" -name 'crm-*.dump' -type f -mtime "+${RETENCAO_DIAS}" -delete

echo "backup ok: $ARQUIVO (retenção ${RETENCAO_DIAS} dias)"
