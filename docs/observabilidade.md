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
| Escrita pela API pública, por chave | `{stack="crm", service="api"} \| evento="api_publica.registro_criado" \| json \| chaveId="<id>"` |
| Webhook de saída falhando em definitivo | `{stack="crm", service="api"} \| evento="webhook.entrega_falhou" \| json \| definitiva="true"` |
| Um webhook específico, ponta a ponta | `{stack="crm", service="api"} \| json \| webhookId="<id>"` |

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
| `financeiro.mensalidades_geradas` / `financeiro.cobrancas_vencidas` | rotina diária das 3h BRT | `info` |
| `contrato.derivado_de_proposta` | contrato gerado a partir do plano de cobrança de uma proposta aceita | `info` |
| `propostas.expiradas` | rotina diária das 3h BRT | `info` |
| `billing.configuracao_incompleta` / `billing.webhook_ignorado` | Stripe | `warn` / `debug` |
| `funil.estagios_provisionados` | conta nova criada (senha ou OAuth) | `info` |
| `catalogo.item_criado` / `catalogo.item_atualizado` / `catalogo.item_excluido` | manutenção dos catálogos do owner | `info` |
| `catalogo.itens_provisionados` | conta nova criada (senha ou OAuth) | `info` |
| `cadastro.bloqueado` | autocadastro tentado com `REGISTRATION_ENABLED=false` | `warn` |
| `senha.redefinicao_solicitada` | link de redefinição enviado; `primeiraSenha=true` = conta de login social definindo a primeira | `info` |
| `senha.redefinicao_descartada` | pedido que não gerou e-mail; `motivo` = `conta_inexistente` \| `convite_pendente` | `info` |
| `colaborador.convidado` / `colaborador.convite_reemitido` / `colaborador.convite_aceito` | ciclo do convite de colaborador | `info` |
| `colaborador.papel_alterado` | troca de papel de um colaborador | `info` |
| `papel.criado` / `papel.atualizado` / `papel.excluido` | manutenção de papéis e permissões | `info` |
| `sessao.revogada` | uma sessão encerrada pelo próprio usuário | `info` |
| `sessao.substituida` | login novo derrubou a sessão anterior do mesmo dispositivo | `info` |
| `sessoes.expurgadas` | rotina diária das 3h BRT — apaga sessão vencida há mais de 30 dias | `info` |
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
| `lead.ingerido` / `lead.reingerido` | ingestão externa de lead: cadastro novo / telefone já conhecido (nota empilhada) | `info` |
| `lead.token_recusado` | ingestão recusada por credencial ausente | `warn` |
| `lead.responsavel_ignorado` | o responsável do canal não é mais membro da workspace: o lead entrou sem responsável | `warn` |
| `lead.canal_criado` / `lead.canal_atualizado` / `lead.canal_excluido` | manutenção dos canais de captação | `info` |
| `integracao.chave_emitida` / `integracao.chave_rotacionada` / `integracao.chave_revogada` | ciclo de vida da chave de integração — nunca carregam o valor, só `chaveId` e `prefixo` | `info` / `warn` / `warn` |
| `integracao.chave_recusada` / `integracao.escopo_insuficiente` | chave inexistente/revogada (401) ou sem o escopo da rota (403) | `warn` |
| `api_publica.registro_criado` | escrita bem-sucedida pela API pública — `recurso`, `registroId`, `chaveId` e `ms`; nunca nome, e-mail ou telefone | `info` |
| `api_publica.credencial_ausente` | requisição à API pública sem `Authorization: Bearer` | `warn` |
| `api_publica.rota_sem_escopo` | rota de `/public` sem `@EscopoExigido`: recusada por segurança. **É bug de rota nova**, não de quem chamou | `error` |
| `webhook.cadastrado` / `webhook.verificado` / `webhook.rotacionado` / `webhook.excluido` | ciclo de vida do webhook de saída do owner — carregam `webhookId` e só o **host** da URL, nunca o caminho nem o segredo | `info` / `info` / `warn` / `warn` |
| `webhook.emissao_falhou` | falha ao enfileirar um evento; a operação de negócio NÃO é derrubada | `error` |
| `webhook.sem_contexto` | `emitir` chamado fora de requisição autenticada — bug de instrumentação: use `emitirPeloSistema` | `warn` |
| `webhook.entrega_falhou` | falha ao entregar num webhook do owner; `definitiva: true` = o backoff esgotou (6 tentativas, ~10,6h) | `error` |
| `webhook.lote_entregue` | varredura da outbox de webhooks (cron de 1 min) — só quando há o que entregar | `info` |
| `mfa.cadastro_iniciado` | `POST /auth/2fa/setup` — **nunca** carrega o segredo nem o `otpauth://` | `info` |
| `mfa.ativado` / `mfa.desativado` | o titular ligou/desligou o próprio segundo fator | `warn` |
| `mfa.codigos_de_recuperacao_emitidos` | 16 códigos emitidos (na confirmação ou na regeneração) — só a quantidade, nunca os valores | `info` |
| `mfa.codigo_recusado` | código de segundo fator recusado. **É esta linha, e não `AccessRecord`, que registra a falha** — a tabela de acesso só guarda sucesso, por decisão da 19-A. Traz `falhasConsecutivas`, nunca o código tentado | `warn` |
| `mfa.conta_travada` | verificação recusada por trava de tentativas falhas (10 falhas → 15 min) | `warn` |
| `mfa.codigo_de_recuperacao_usado` | segundo fator provado por código de recuperação, com quantos restam | `warn` |
| `mfa.login_recusado` | o segundo fator foi recusado **no login** (o `mfa.codigo_recusado` acima cobre qualquer verificação). É a linha para vigiar tentativa de invasão em conta com 2FA | `warn` |
| `consentimento.registrado` / `consentimento.revogado` | manifestação de titular registrada. Carrega finalidade, canal e versão do texto — **nunca** nome, e-mail ou telefone do titular | `info` |
| `conta.dados_exportados` | dump de portabilidade gerado (`GET /account/export`) | `info` |
| `conta.encerramento_solicitado` / `conta.encerramento_cancelado` | pedido/cancelamento de encerramento pelo titular | `warn` / `info` |
| `conta.assinatura_marcada_para_nao_renovar` | rotina diária das 5h — `cancel_at_period_end` marcado no Stripe | `info` |
| `conta.cancelamento_de_assinatura_falhou` | rotina diária das 5h — falha ao marcar `cancel_at_period_end`; tenta de novo amanhã | `error` |
| `conta.expurgo_adiado` | rotina diária das 5h — falha ao cancelar a assinatura no Stripe; o owner é pulado sem apagar nada | `error` |
| `conta.expurgada` | rotina diária das 5h BRT — conta e workspace apagadas em definitivo; **`warn`** de propósito, é irreversível | `warn` |
| `retencao.lixeira_expurgada` | rotina diária das **2h BRT** — apaga o que está arquivado há mais de 180 dias, por tabela | `info` |
| `retencao.notificacoes_expurgadas` | rotina das 2h — notificações e entregas com mais de 90 dias | `info` |
| `retencao.auditoria_expurgada` | rotina das 2h — trilha com mais de 5 anos | `info` |
| `retencao.registro_pulado` | registro além do prazo que **não** foi apagado porque ainda tem filho não arquivado. Não é erro (é a doutrina "nenhuma cascata"), mas sem esta linha "0 apagados" seria lido como "nada a fazer" | `info` |
| `retencao.varredura_falhou` | uma das três varreduras falhou; **as outras continuam** | `error` |

> **Todo horário de rotina nesta tabela é BRT.** O container roda em UTC (não há
> `TZ` no compose nem no Dockerfile), então cada `@Cron` declara
> `timeZone: 'America/Sao_Paulo'`. Até 29/07/2026 os crons legados não o
> declaravam e rodavam três horas antes do que o nome anunciava — as rotinas
> "das 3h" saíam à meia-noite BRT. Se você estiver caçando um evento pelo horário
> em log antigo, é isso.

> **Aposentados** (não renomeados: nenhuma consulta histórica muda de
> significado, eles simplesmente deixam de ser emitidos):
>
> - `lead.ingestao_desconfigurada` — existia quando a ausência de
>   `LEAD_INTAKE_TOKEN` fechava a rota com 503. Desde a Fase 17-A a ingestão
>   autentica por chave de integração, e o token ausente é o estado normal.
> - `lead.token_legado_aceito` — a ingestão aceita pelo token de ambiente. Foi a
>   consulta que autorizou o corte: a Fase 19-B só podia entrar depois de ela
>   voltar **zero em 30 dias**, porque cortar antes perderia lead sem erro
>   visível no site. Aposentado na Fase 19-B, junto do caminho legado.
> - `lead.owner_nao_configurado` / `lead.owner_nao_encontrado` — os dois 503 do
>   caminho legado (sem `LEAD_INTAKE_OWNER_EMAIL`, ou e-mail sem owner). Idem.

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
- **Segredo em nome pt-BR escapa da rede automática.** `CHAVE_SENSIVEL`
  ([`log.ts`](../apps/api/src/shared/logging/log.ts)) casa `token`, `secret`,
  `api_key` — mas **não** `chave`. Log de credencial carrega `chaveId` e
  `prefixo`, nunca o valor: a garantia aqui é o campo escolhido, e ela é
  afirmada em `integration-keys.service.spec.ts`.
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

### O log **não** é o registro de acesso do Marco Civil

Um terceiro caso, distinto dos dois acima. O `http.requisicao` vive **30 dias**
no Loki e é ferramenta de **diagnóstico**: uma linha por requisição, útil para
depurar um incidente recente. A tabela `AccessRecord` (`modules/auth/`) vive
**6 meses** e é obrigação de **conformidade** (Marco Civil da Internet, art. 5º,
VIII e art. 15): uma linha por evento de *autenticação* — login, login social,
aceite de convite e logout —, não por requisição. Ela sobrevive ao
encerramento da conta (LGPD art. 16, I) e nunca é exposta na interface; quem
responde a uma requisição judicial é o `userId`. Os dois prazos não são
intercambiáveis: reduzir o do `AccessRecord` para 30 dias descumpriria a lei
mesmo que o Loki continuasse guardando `http.requisicao` por igual período.

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
