#!/usr/bin/env bash
# Configura os metadados e as regras de proteção do repositório no GitHub.
#
# Roda uma vez, DEPOIS de o repositório ser público. Idempotente: rodar de novo
# só reescreve os mesmos valores.
#
#   gh auth switch --user programeai     # precisa ser o DONO (admin)
#   ./scripts/configurar-repositorio.sh
#
# Por que um script e não cliques: descrição, topics e ruleset são a parte da
# configuração que não vive no repositório — sem isto registrado em algum lugar,
# ninguém sabe qual era a regra nem como recriá-la depois de um acidente.
#
# Exige admin no repositório. Em repositório de conta pessoal, só o dono tem
# admin — colaborador com permissão de escrita recebe 404 aqui.
set -euo pipefail

REPO="${REPO:-programeai/CRM}"

echo "==> Metadados de ${REPO}"

# A descrição é o que aparece na busca do GitHub e no cartão do repositório:
# diz o que é, para quem, com que stack e que dá para hospedar sozinho.
gh api -X PATCH "repos/${REPO}" \
  -f description="CRM de agência open source: clientes, pipeline de vendas, propostas, projetos, contratos e financeiro. NestJS + Prisma + React, isolamento por owner com Row Level Security no Postgres. Autohospedável numa VPS com Docker." \
  -f homepage="https://crm.programeai.com.br" \
  -F has_wiki=false \
  -F has_issues=true \
  -F has_projects=false \
  -F allow_merge_commit=true \
  -F allow_squash_merge=true \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  > /dev/null
echo "    descrição, homepage e opções de merge aplicadas (wiki desligada: a documentação mora em docs/)"

# Topics são o único canal de descoberta do GitHub que não depende de estrela:
# é por eles que alguém procurando "self-hosted crm" chega aqui.
gh api -X PUT "repos/${REPO}/topics" \
  -H "Accept: application/vnd.github+json" \
  --input - > /dev/null <<'JSON'
{
  "names": [
    "crm",
    "open-source-crm",
    "self-hosted",
    "sales-pipeline",
    "agency",
    "nestjs",
    "prisma",
    "react",
    "typescript",
    "postgresql",
    "row-level-security",
    "docker",
    "vite",
    "tailwindcss",
    "monorepo",
    "agpl"
  ]
}
JSON
echo "    16 topics aplicados"

echo "==> Proteção da branch main"

# Ruleset e não "branch protection" clássica: ruleset é gratuito em repositório
# público, tem bypass por papel (o dono continua podendo push direto) e fica
# legível na API — a proteção clássica em repo de conta pessoal exige plano pago.
#
# bypass_actors: RepositoryRole 5 = admin. É o que mantém o fluxo do mantenedor
# (commit direto na main) funcionando, enquanto colaborador com escrita passa a
# precisar de PR. Tire este bloco no dia em que quiser se obrigar a PR também.
gh api -X POST "repos/${REPO}/rulesets" --input - > /dev/null <<'JSON'
{
  "name": "main protegida",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash", "merge"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "Testes da API" },
          { "context": "Build da imagem (api)" },
          { "context": "Build da imagem (web)" }
        ]
      }
    }
  ]
}
JSON
echo "    ruleset criado: sem force-push, sem deleção, PR obrigatório (0 aprovações) e os 3 checks do CI"

# Versão publicada tem que ser imutável, e ela só é imutável se a tag não puder
# se mover. Deleção e reescrita bloqueadas; CRIAÇÃO liberada, senão o passo
# "Tag git da versão" do build.yml pararia de funcionar.
gh api -X POST "repos/${REPO}/rulesets" --input - > /dev/null <<'JSON'
{
  "name": "tags de versão imutáveis",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["refs/tags/v*"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
echo "    ruleset criado: tags v* não podem ser deletadas nem reescritas"

echo "==> Segurança"

# Secret scanning + push protection: a segunda barra um segredo ANTES de entrar
# em commit. É o risco novo que um repositório público com contribuidor externo
# cria, e é gratuito em repositório público.
gh api -X PATCH "repos/${REPO}" --input - > /dev/null <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
echo "    secret scanning e push protection habilitados"

echo
echo "Feito. Conferir com:"
echo "  gh repo view ${REPO} --json description,homepageUrl,repositoryTopics"
echo "  gh api repos/${REPO}/rulesets --jq '.[].name'"
echo
echo "Ainda manual na interface (não há API):"
echo "  Settings → Actions → General → Workflow permissions → Read and write"
echo "    (o passo 'Tag git da versão' do build.yml precisa de contents: write)"
echo "  Settings → Actions → General → Fork pull request workflows"
echo "    → Require approval for first-time contributors (default; só confirmar)"
