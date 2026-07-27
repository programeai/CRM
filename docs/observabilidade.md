# Observabilidade

Os logs do CRM são lidos pela **stack de observabilidade do host**: um agente
(Alloy) coleta o stdout de todos os containers, o Loki indexa e o Grafana
consulta.

Não há nada a instalar do lado do CRM — subiu container na VPS, está sendo
coletado. O que este projeto faz é **escrever log que dá para pesquisar**: uma
linha JSON por evento, com `level`, `evento` e `requestId`.

## Como o CRM aparece no Grafana

O nome do projeto Compose (`name: crm`) vira o label `stack`, e cada serviço vira
o label `service`:

| Label | Valor |
| --- | --- |
| `stack` | `crm` |
| `service` | `api`, `web`, `postgres` |
| `container` | `crm-api`, `crm-web`, `crm-postgres` |
| `level` | `error`, `warn`, `info`, `debug` (extraído do JSON) |

Consultas do dia a dia (**Explore → Loki**):

| Objetivo | Consulta |
| --- | --- |
| Tudo do CRM | `{stack="crm"}` |
| Só a API | `{stack="crm", service="api"}` |
| Erros do CRM | `{stack="crm", level="error"}` |
| Erros que ninguém previu | `{stack="crm"} \| evento="erro.nao_tratado"` |
| Uma requisição inteira | `{stack="crm"} \| json \| requestId="<id>"` |
| Requisições lentas (>2s) | `{stack="crm", service="api"} \| json \| evento="http.requisicao" \| ms > 2000` |
| Uma rota específica | `{stack="crm", service="api"} \| json \| rota="/api/v1/clients"` |
| Tudo de um usuário | `{stack="crm", service="api"} \| json \| usuarioId="<id>"` |
| 404 de asset no front | `{stack="crm", service="web"} \| json \| status=404` |
| Erros por tipo, na última hora | `sum by (evento) (count_over_time({stack="crm", level="error"}[1h]))` |

## `requestId`: o fio que liga tudo

Toda resposta da API traz o cabeçalho **`x-request-id`**. Esse mesmo id aparece
em todas as linhas de log daquele acesso — o log de acesso, os logs dos services
e o stack do erro, se houver.

Na prática: alguém relata um problema, você pede o `x-request-id` (ou pega do
DevTools → Network → Response Headers) e roda
`{stack="crm"} | json | requestId="<id>"`. Sai a requisição inteira, do 500 até a
linha do service que quebrou.

Se o cliente já mandar um `x-request-id` na requisição, a API **reaproveita** o
valor (útil para amarrar chamadas entre sistemas); senão gera um UUID.

## Eventos que a API emite

`evento` é um nome curto e **estável** — é o que permite contar ocorrência ao
longo do tempo. Os que existem hoje:

| Evento | Quando | Nível |
| --- | --- | --- |
| `http.requisicao` | uma por requisição HTTP (menos o healthcheck) | `info` / `warn` (4xx) / `error` (5xx) |
| `erro.nao_tratado` | exceção não prevista chegando à borda HTTP; inclui `stack` | `error` |
| `processo.excecao_nao_capturada` | erro fora do ciclo de requisição — o processo cai em seguida | `error` |
| `processo.promessa_rejeitada` | promessa rejeitada sem `catch` | `error` |
| `app.iniciada` / `app.falhou_ao_iniciar` | bootstrap | `info` / `error` |
| `email.envio_falhou` / `email.smtp_desabilitado` | envio de e-mail | `error` / `warn` |
| `financeiro.mensalidades_geradas` / `financeiro.cobrancas_vencidas` | rotina diária das 3h | `info` |
| `propostas.expiradas` | rotina diária das 3h | `info` |
| `billing.configuracao_incompleta` / `billing.webhook_ignorado` | Stripe | `warn` / `debug` |
| `funil.estagios_provisionados` | conta nova criada (senha ou OAuth) | `info` |
| `sessao.revogada` | uma sessão encerrada pelo próprio usuário | `info` |
| `sessoes.revogadas` | encerramento em massa (outras sessões, desativação de colaborador) | `info` |
| `auditoria.sem_contexto` | `AuditService.registrar` chamado fora de requisição autenticada (bug de instrumentação) | `warn` |
| `auditoria.registro_falhou` | falha ao gravar trilha de ação do sistema (cron/webhook) — o lote continua | `error` |

O front (`service=web`) emite `http.acesso` pelo nginx, **só para 4xx e 5xx** —
servidor de arquivo estático em modo "loga tudo" seria só ruído. Para registrar
todo acesso, remova o `if=$acesso_logavel` de [`apps/web/nginx.conf`](../apps/web/nginx.conf).

## Como logar em código novo

Use o `Logger` do Nest normalmente — ele já passa pelo `JsonLogger` — e passe um
**objeto com `evento`**:

```ts
private readonly logger = new Logger(ContractsService.name);

this.logger.log({
  evento: 'contrato.ativado',
  msg: 'Contrato ativado e mensalidades programadas.',
  contratoId: contrato.id,
  parcelas: 12,
});

this.logger.error(
  { evento: 'contrato.ativacao_falhou', contratoId: id },
  err instanceof Error ? err.stack : undefined,
);
```

Sai uma linha assim (`requestId` e `contexto` entram sozinhos):

```json
{"level":"info","time":"2026-07-25T12:40:00.000Z","evento":"contrato.ativado","msg":"Contrato ativado e mensalidades programadas.","requestId":"5f0…","contratoId":"ctr_123","parcelas":12,"contexto":"ContractsService"}
```

Regras:

- **`evento` sempre**, em `substantivo.acao_no_passado` e em pt-BR. Nome estável:
  renomear evento quebra a contagem histórica.
- Campos de contexto são livres (`contratoId`, `ms`, `quantidade`) — ficam
  filtráveis com `| json`.
- **Nunca** logue senha, hash, token, cookie ou `authorization`. Chaves com esses
  nomes são redigidas automaticamente ([`log.ts`](../apps/api/src/shared/logging/log.ts)),
  mas o texto livre de `msg` **não é** — o Grafana é publicado na internet e a
  linha vive 30 dias.
- `debug` não é emitido em produção.
- Nada de `console.log`.

### O log **não** é a trilha de auditoria

As duas convivem e respondem perguntas diferentes. O Loki responde **"o que o
sistema fez"** nos últimos 30 dias, em texto livre e sem visão por registro. A
tabela `AuditLog` (ver `modules/audit/`) responde **"quem mudou este registro,
quando e do quê para quê"**, sem limite de tempo, isolada por `ownerId` no RLS e
imutável para a aplicação (`crm_app` só tem `SELECT`/`INSERT`).

Ao instrumentar uma mudança sensível de estado, faça as duas coisas: o `evento`
estruturado continua valendo para operação e alerta, e o `audit.registrar(…)`
grava a trilha — na mesma transação da mudança, então uma requisição que falha
não deixa registro órfão.

Em código transversal (middleware, filtro, bootstrap), onde não há DI, use
`registrarLog('info', { evento: … })` direto de `shared/logging/log.ts`.

## Peças no código

| Arquivo | Papel |
| --- | --- |
| [`shared/logging/log.ts`](../apps/api/src/shared/logging/log.ts) | serializa a linha JSON, redige chaves sensíveis, injeta `requestId` |
| [`shared/logging/json-logger.ts`](../apps/api/src/shared/logging/json-logger.ts) | `LoggerService` do Nest → JSON (instalado em `main.ts`) |
| [`shared/logging/request-context.middleware.ts`](../apps/api/src/shared/logging/request-context.middleware.ts) | `requestId` + log de acesso (middleware Express, antes dos guards) |
| [`shared/logging/all-exceptions.filter.ts`](../apps/api/src/shared/logging/all-exceptions.filter.ts) | registra erro não previsto e responde 500 em pt-BR |
| [`apps/web/nginx.conf`](../apps/web/nginx.conf) | `log_format` JSON do front |

O `requestId` vive no CLS (`nestjs-cls`, já usado para o contexto de RLS): o
middleware Express define o cabeçalho e o `idGenerator` do `AppModule` o copia
para o contexto, de onde o logger o lê.

## Verificar depois do deploy

```bash
# A linha de start deve sair em JSON, com evento app.iniciada
docker compose -f docker-compose.prod.yml logs api | tail -3

# Uma requisição real e o id que ela devolveu
curl -sD - -o /dev/null https://<seu-dominio>/api/v1/health | grep -i x-request-id
```

No Grafana, `{stack="crm"}` deve mostrar as duas coisas em segundos. Se não
mostrar, o problema é do lado da coleta (containers `log-collector`/`loki`), não
do CRM.

## O campo `ip`

**`ip` é o IP do cliente**, derivado do `x-forwarded-for` pelo próprio Express
(`trust proxy`, configurado a partir de `TRUST_PROXY_HOPS` — ver `main.ts`). É o
mesmo valor que o rate limit usa como chave, então o campo `ip` do log e o 429 do
throttler falam do mesmo cliente.

## Limitações conhecidas

- **Sem alerta.** É consulta sob demanda: ninguém avisa quando `erro.nao_tratado`
  aparece. O caminho é uma regra no Grafana
  (`sum(count_over_time({stack="crm", level="error"}[15m])) > 0`), versionada no
  repositório de observabilidade.
- **Sem métrica nem trace.** Só log. Latência por rota sai do campo `ms` do
  `http.requisicao`, que resolve a maior parte das dúvidas de performance.
- **Consulta lenta de banco não aparece isolada.** O sintoma chega como `ms` alto
  na rota. Ligar o log de query do Prisma exigiria cuidado extra para não
  registrar os valores dos parâmetros.
- **Requisição que morre antes da aplicação** (5xx do Traefik, TLS, timeout) só
  aparece se o access log do Traefik estiver ligado — é configuração da VPS, não
  deste repositório.
