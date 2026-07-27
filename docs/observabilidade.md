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
| Requisições lentas (>2s) | `{stack="crm", service="api"} \| evento="http.requisicao" \| json \| ms > 2000` |
| Uma rota específica | `{stack="crm", service="api"} \| json \| rota="/api/v1/clients/:id"` |
| Um registro específico | `{stack="crm", service="api"} \| json \| caminho=~".*/<uuid>.*"` |
| Tudo de um usuário | `{stack="crm", service="api"} \| json \| usuarioId="<id>"` |
| Tudo de uma workspace | `{stack="crm", service="api"} \| json \| ownerId="<id>"` |
| 404 de asset no front | `{stack="crm", service="web"} \| json \| status=404` |
| Erros por tipo, na última hora | `sum by (evento) (count_over_time({stack="crm", level="error"}[1h]))` |
| p95 por rota, na última hora | `quantile_over_time(0.95, {stack="crm", service="api"} \| evento="http.requisicao" \| json \| unwrap ms [1h]) by (rota)` |

## Dashboard

O dia a dia sai do dashboard **CRM — visão geral** (pasta *Plataforma*), versionado
no repositório de observabilidade em
`grafana/provisioning/dashboards/arquivos/crm.json`. Ele cobre saúde da API (erros,
taxa de 5xx, p95/p99), rotas mais lentas e com mais erro, credencial recusada e
rate limit por IP, as rotinas diárias e três painéis de investigação — inclusive
um que recebe o `x-request-id` e devolve a requisição inteira.

Mudança na convenção de log deste repositório que quebre uma consulta do
dashboard tem de ser refletida naquele JSON — os dois evoluem juntos. Para
investigação fora do que o dashboard cobre, **Explore → Loki**.

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
| `app.iniciada` / `app.falhou_ao_iniciar` | bootstrap (o segundo também vem do `entrypoint.sh`, antes do Nest existir) | `info` / `error` |
| `app.migracao_falhou` | `prisma migrate deploy` falhou no start do container — a API não sobe até resolver | `error` |
| `email.envio_falhou` / `email.smtp_desabilitado` | envio de e-mail | `error` / `warn` |
| `financeiro.mensalidades_geradas` / `financeiro.cobrancas_vencidas` | rotina diária das 3h | `info` |
| `propostas.expiradas` | rotina diária das 3h | `info` |
| `billing.configuracao_incompleta` / `billing.webhook_ignorado` | Stripe | `warn` / `debug` |
| `funil.estagios_provisionados` | conta nova criada (senha ou OAuth) | `info` |
| `catalogo.item_criado` / `catalogo.item_atualizado` / `catalogo.item_excluido` | manutenção dos catálogos do owner | `info` |
| `catalogo.itens_provisionados` | conta nova criada (senha ou OAuth) | `info` |
| `cadastro.bloqueado` | autocadastro tentado com `REGISTRATION_ENABLED=false` | `warn` |
| `colaborador.convidado` / `colaborador.convite_reemitido` / `colaborador.convite_aceito` | ciclo do convite de colaborador | `info` |
| `colaborador.papel_alterado` | troca de papel de um colaborador | `info` |
| `papel.criado` / `papel.atualizado` / `papel.excluido` | manutenção de papéis e permissões | `info` |
| `sessao.revogada` | uma sessão encerrada pelo próprio usuário | `info` |
| `sessao.substituida` | login novo derrubou a sessão anterior do mesmo dispositivo | `info` |
| `sessoes.expurgadas` | rotina diária das 3h — apaga sessão vencida há mais de 30 dias | `info` |
| `sessoes.revogadas` | encerramento em massa (outras sessões, desativação de colaborador) | `info` |
| `auditoria.sem_contexto` | `AuditService.registrar` chamado fora de requisição autenticada (bug de instrumentação) | `warn` |
| `auditoria.registro_falhou` | falha ao gravar trilha de ação do sistema (cron/webhook) — o lote continua | `error` |
| `notificacao.sem_contexto` | `notificar` chamado fora de requisição autenticada (bug de instrumentação) | `warn` |
| `notificacao.emissao_falhou` | falha ao gravar a notificação — a operação de negócio continua | `error` |
| `notificacao.entrega_falhou` | falha ao entregar num destino; `definitiva: true` quando esgotou as tentativas | `error` |
| `notificacao.lote_entregue` | rodada do dispatch, a cada minuto (só quando há pendente) | `info` |
| `notificacao.destinos_provisionados` | conta nova ou convite aceito | `info` |
| `notificacoes.lembretes_emitidos` | rotina diária das 6h BRT — gatilhos de prazo (só quando há alvo) | `info` |
| `digest.enviado` | rotina diária das 7h BRT — resumo por e-mail (agregado do lote) | `info` |
| `digest.envio_falhou` | falha ao enviar o resumo para um usuário; o lote continua | `error` |

### Os campos do `http.requisicao`

| Campo | O que é |
| --- | --- |
| `rota` | o **molde** da rota (`/api/v1/clients/:id/contacts`) |
| `caminho` | o caminho cru, **só quando difere** do molde |
| `metodo`, `status`, `ms` | verbo, status HTTP e duração |
| `usuarioId` | quem chamou (do `JwtAuthGuard`) |
| `ownerId` | a workspace afetada (do `AccessGuard`) |
| `ip`, `ua` | cliente — ver [O campo `ip`](#o-campo-ip) |

`rota` é **normalizada** de propósito: uuid vira `:id`, número vira `:n` e token
opaco vira `:token`. Sem isso, `sum by (rota)` daria uma série por registro do
banco e o painel de rota mais lenta seria uma lista de uuids. Quando a rota tem
parâmetro, o caminho cru — que diz *qual* registro a requisição tocou — fica em
`caminho`. Segmento de baixa cardinalidade (`google`, `permissions`) **não** é
normalizado: é ele que distingue uma rota da outra.

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

As ações de arquivar/restaurar/expurgar da lixeira (`modules/trash/`) não
ganham `evento` estruturado novo: são só `audit.registrar(…)` — a trilha já
responde "quem arquivou o quê e quando" sem duplicar a informação no Loki.

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
  repositório de observabilidade. Foi o que custou caro em 27/07/2026: a API
  ficou fora 11 horas por migration falha e ninguém soube — a queda era visível
  no Grafana, mas visível não é o mesmo que avisado.
- **API fora não gera erro, gera silêncio.** Com log-only, aplicação parada não
  emite linha nenhuma — o sinal é a *ausência* dela. Por isso o entrypoint emite
  `app.migracao_falhou`/`app.falhou_ao_iniciar` em JSON ao abortar: sem isso, o
  container morre calado e o painel de erros fica zerado justamente na queda. O
  outro sinal é o painel "Requisições na API" em zero.
- **Sem métrica nem trace.** Só log. Latência por rota sai do campo `ms` do
  `http.requisicao`, que resolve a maior parte das dúvidas de performance.
- **Consulta lenta de banco não aparece isolada.** O sintoma chega como `ms` alto
  na rota. Ligar o log de query do Prisma exigiria cuidado extra para não
  registrar os valores dos parâmetros.
- **Requisição que morre antes da aplicação** (5xx do Traefik, TLS, timeout) só
  aparece se o access log do Traefik estiver ligado — é configuração da VPS, não
  deste repositório.
- **Notificação cresce sem política de expurgo.** `Notification` e
  `NotificationDelivery` acumulam para sempre: não há job de poda nem retenção,
  do mesmo modo que a trilha de auditoria (ver a nota da migration
  `20260729100000_audit_log`). Uma entrega `PENDING` que esgotou as tentativas
  vira `FAILED` e fica lá. Com poucos owners é irrelevante; quando incomodar, o
  expurgo passa pelo `crm_user` — `crm_app` não tem `DELETE` em massa como
  caminho previsto. Dívida registrada, não esquecida.
- **O digest das 7h BRT é um pico de e-mail.** Não há fila, rate limit nem
  `pool: true` no transporter, e cron não passa por throttler (o que existe é
  HTTP). O único freio é o limite do provedor SMTP. Monitorar
  `digest.enviado` (campo `falhas`) e `notificacao.lote_entregue`.
