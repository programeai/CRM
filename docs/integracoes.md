# Integrações — API pública do CRM

Guia para quem vai **escrever no CRM a partir de um sistema de fora**: um ERP,
uma automação (n8n, Make, Zapier), um app interno, um script.

Este documento é o guia do integrador. A referência técnica de todas as rotas do
CRM (inclusive as internas) é [`apps/api/ENDPOINTS.md`](../apps/api/ENDPOINTS.md),
e o contrato de máquina é o `openapi.json` da seção 8.

---

## 1. O que a API faz — e o que ela não faz

**Faz:** cria cliente, oportunidade, atividade e demanda na workspace, por
credencial de máquina, sem sessão de usuário.

**Não faz:**

- **Não lê.** Não há `GET`, não há listagem, não há paginação. Quem precisa ler
  usa a interface do CRM ou a exportação de portabilidade
  (`GET /account/export`, que o owner baixa em Configurações → Conta).
- **Não atualiza nem apaga.** Não há `PATCH` nem `DELETE`. A API é uma porta de
  entrada, não um espelho do banco.
- **Não recebe lead de formulário.** Para isso existe a captação, que é outra
  coisa: ela desduplica por telefone, roteia por canal e classifica a fonte. Veja
  a página de ajuda **Captação de leads** dentro do app, ou
  `POST /leads/intake` no `ENDPOINTS.md`.

Se o que você precisa é ler ou alterar, o caminho hoje é a interface. Escrever é
a única direção que a API pública cobre.

---

## 2. A credencial

### Emitir

Em **Administração → API**, botão **Nova chave**. Você dá um nome (que aparece na
trilha de auditoria de tudo que a chave escrever) e marca os escopos.

O valor bruto — `crm_` seguido de 64 caracteres hexadecimais — **aparece uma
única vez**, na tela da criação. Copie e guarde onde você guarda senha: variável
de ambiente, cofre de credencial da automação, secret do CI.

### Recuperar

**Não existe.** O CRM guarda apenas o sha256 do valor; não há como exibi-lo de
novo, e isso não é uma limitação a contornar — é o desenho. Quem perde a chave
**rotaciona**.

### Rotacionar

Gera um valor novo na **mesma** chave (mesmo nome, mesmos escopos, mesma linha na
trilha). A chave anterior **para de autenticar imediatamente** — não há período
de convivência entre a antiga e a nova.

Consequência prática: faça a rotação com o valor novo em mãos e troque-o no
sistema de origem em seguida. Entre uma coisa e outra, as chamadas respondem
`401`.

### Revogar

A chave para de autenticar, mas a **linha permanece** na tabela, marcada como
revogada: a tela e a trilha precisam continuar explicando que ela existiu e o que
escreveu. Uma chave revogada pode ser reativada rotacionando-a.

### Quantas chaves

Uma por sistema integrado. Chave separada por sistema é o que permite revogar um
sem derrubar os outros, e é o que faz a trilha de auditoria dizer **qual**
sistema escreveu cada registro.

---

## 3. Escopo × permissão — não são a mesma coisa

Dois catálogos independentes, de propósito:

| | Permissão | Escopo |
| --- | --- | --- |
| Limita | uma **pessoa** usando o CRM pela interface | uma **credencial de máquina** |
| Onde mora | no papel (`Role`) do colaborador | na própria chave |
| Exemplo | `cliente:gerenciar` | `cliente:escrever` |
| Quem configura | Administração → Papéis | Administração → API |

Uma chave **não é "um usuário robô"**: ela não tem papel, não conta assento, não
aparece na lista de colaboradores e não pode fazer nada além dos escopos marcados
nela. Não existe escopo de leitura, porque não existe rota de leitura.

Os escopos da API pública:

| Escopo | Libera |
| --- | --- |
| `cliente:escrever` | `POST /public/clients` |
| `negociacao:escrever` | `POST /public/deals` |
| `atividade:escrever` | `POST /public/activities` |
| `tarefa:escrever` | `POST /public/tasks` |

Há um quinto escopo no catálogo, `lead:receber`, que **não** pode ser marcado
numa chave de API: ele pertence ao canal de captação, que emite a chave dele
junto do canal. Chave de captação com escopo e sem canal gravaria lead sem
roteamento nem fonte.

---

## 4. As quatro rotas

Base: `https://crm.programeai.com.br/api/v1` (numa instalação própria, o host é o
seu). Todas as rotas pedem:

```
Authorization: Bearer crm_SUA_CHAVE_AQUI
Content-Type: application/json
```

O `Bearer` é sensível a maiúsculas. **É uma chamada de servidor para servidor:**
se a chave for para o JavaScript de uma página, qualquer visitante a lê e passa a
escrever na sua workspace.

Em todas elas, **a workspace de destino vem da chave** — nenhum corpo aceita
`ownerId`, e enviá-lo faz a requisição inteira falhar com `400`.

### 4.1 Criar cliente

```bash
curl -X POST https://crm.programeai.com.br/api/v1/public/clients \
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Clínica Bem Viver",
    "email": "contato@bemviver.com.br",
    "phone": "+5584999398021",
    "status": "ACTIVE",
    "tags": ["erp"],
    "notes": "Importado do ERP em 04/08/2026."
  }'
```

```json
{ "id": "3f8b1c2e-9a44-4f6d-8b71-2c5e0d9a1f33", "status": "ACTIVE" }
```

| Campo | Tipo | Obrigatório | Observação |
| --- | --- | --- | --- |
| `name` | texto (mín. 2) | **sim** | Nome do cadastro |
| `email` | e-mail | não | |
| `phone` | texto | não | |
| `document` | texto | não | CPF (11 dígitos) ou CNPJ (14). O tipo de pessoa é **deduzido** dele; documento repetido responde `409` |
| `status` | `LEAD`, `ACTIVE`, `INACTIVE`, `LOST` | não | Default `LEAD` |
| `tags` | lista de texto | não | |
| `notes` | texto (máx. 5000) | não | |

Sem `assigneeId` de propósito: a integração não conhece os usuários da workspace,
e atribuir responsável é decisão de quem administra.

### 4.2 Criar oportunidade

```bash
curl -X POST https://crm.programeai.com.br/api/v1/public/deals \
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "3f8b1c2e-9a44-4f6d-8b71-2c5e0d9a1f33",
    "title": "Reforma do site institucional",
    "serviceTypeId": "8c1d4a77-2e35-4b90-9f61-7ad0c3b5e214",
    "amount": 12000,
    "probability": 40,
    "expectedClose": "2026-09-30T00:00:00.000Z"
  }'
```

```json
{ "id": "…", "stageId": "…" }
```

`clientId` e `serviceTypeId` são obrigatórios e têm de ser da **sua** workspace —
id de outro owner responde `404`. Sem `stageId`, a oportunidade nasce no primeiro
estágio do seu funil.

### 4.3 Registrar atividade

```bash
curl -X POST https://crm.programeai.com.br/api/v1/public/activities \
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "3f8b1c2e-9a44-4f6d-8b71-2c5e0d9a1f33",
    "typeId": "b2f1e9c4-5d78-4a31-8e02-6c9f4d1b7a55",
    "content": "Cliente pediu proposta por telefone.",
    "scheduledFor": "2026-08-10T14:00:00.000Z"
  }'
```

```json
{ "id": "…" }
```

Com `scheduledFor`, a atividade nasce **agendada**: ela aparece como próximo
passo no card do funil e entra nos lembretes de follow-up. `dealId` é opcional e
vincula a atividade a uma oportunidade do mesmo cliente.

### 4.4 Criar demanda

```bash
curl -X POST https://crm.programeai.com.br/api/v1/public/tasks \
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "5a7c2d18-4b6e-4f03-9d21-8e5f0a3c9b74",
    "title": "Publicar a homepage",
    "description": "Conteúdo aprovado pelo cliente.",
    "priority": "HIGH",
    "dueDate": "2026-08-20T00:00:00.000Z"
  }'
```

```json
{ "id": "…", "status": "BACKLOG" }
```

`status` aceita `BACKLOG`, `TODO`, `IN_PROGRESS`, `REVIEW`, `DONE` (default
`BACKLOG`); `priority` aceita `LOW`, `MEDIUM`, `HIGH`, `URGENT` (default
`MEDIUM`). Demanda criada já como `DONE` nasce com a data de conclusão
preenchida.

### Descobrir os ids que a API pede

`serviceTypeId`, `typeId`, `stageId`, `clientId` e `projectId` são ids da sua
workspace, e a API pública **não lista nada** (seção 1). Os caminhos para
obtê-los:

- Copiar da URL da interface (a ficha do cliente é `/clientes/<id>`, o projeto é
  `/projetos/<id>`);
- Baixar `GET /account/export` em Configurações → Conta: o dump traz os
  catálogos, os estágios do funil e os clientes com os ids;
- Guardar o `id` que a própria API devolveu ao criar o registro — é o caminho
  natural quando o seu sistema cria o cliente e depois a oportunidade dele.

---

## 5. Erros

Toda mensagem vem em **português**. Guarde o corpo do erro no log da sua
integração: é ele que diz o que consertar.

| Código | Significa | O que fazer |
| --- | --- | --- |
| `400` | Campo inválido, faltando ou **fora do contrato** | A resposta lista o que reprovou, um item por problema. Campo não previsto derruba a requisição inteira de propósito: dado descartado em silêncio é pior do que integração que reclama alto |
| `401` | Chave ausente, malformada, inexistente ou revogada | Confira o cabeçalho e se a chave não foi rotacionada. A mensagem é a mesma para inexistente e revogada, para não dizer qual é o caso |
| `403` | A chave existe, mas **não tem o escopo** da rota | Marque o escopo na chave em Administração → API — ou use a chave certa |
| `404` | Id de registro que não existe **ou é de outro owner** | São o mesmo caso, e a resposta não os distingue: uma API que dissesse "existe, mas não é seu" vazaria a existência do registro alheio |
| `409` | Conflito de unicidade (hoje: documento de cliente repetido) | O cadastro já existe. Encontre-o na interface em vez de criar outro |
| `422` | Regra de negócio recusou | A mensagem diz qual |
| `429` | Teto de requisições | Seção 6 |
| `500` | Erro nosso | Repita depois. Em erro, **nada é gravado** — a escrita é transacional |

**Em qualquer erro nada é gravado**, e repetir a chamada é seguro. Cada requisição
roda numa transação: ou o registro e a trilha de auditoria commitam juntos, ou
nenhum dos dois.

Note que **não há idempotência por chave de requisição**: repetir uma chamada
bem-sucedida cria um segundo registro. Se o seu sistema pode reenviar (retry
automático, fila), guarde o `id` devolvido e não reenvie o que já respondeu
`201`.

---

## 6. Teto de requisições

**120 requisições por minuto, por chave.**

Por chave, e não por IP: dez integrações atrás do mesmo NAT não disputam o mesmo
teto, e uma chave abusiva atrás de IP rotativo não escapa dele. Excedendo, a
resposta é `429` com a mensagem em português.

Carga inicial (importar uma base inteira) precisa de fila com espaçamento — cerca
de 2 requisições por segundo cabe no teto com folga. A trilha de auditoria também
cresce com a importação, então prefira rodar uma carga grande fora do horário de
trabalho da equipe.

---

## 7. Política de versão

O prefixo `/api/v1` faz parte do contrato.

- **`v1` é estável.** Nenhuma mudança vai remover campo, tornar campo opcional em
  obrigatório, mudar tipo ou mudar o significado de um valor existente.
- **Campo novo é aditivo** e pode aparecer em qualquer momento: numa resposta,
  como campo opcional num corpo, como valor novo num enum de entrada. Trate
  campo desconhecido na resposta como ignorável — não valide a resposta contra um
  schema fechado.
- **Quebra sai em `/api/v2`**, com as duas versões no ar durante a transição.
- **Não** usamos versionamento por cabeçalho nem por data.

## 8. Contrato de máquina (OpenAPI)

```
GET https://crm.programeai.com.br/api/v1/public/openapi.json
```

Documento OpenAPI 3 com as quatro rotas, os corpos, as respostas e o esquema de
autenticação — gerado dos próprios DTOs, então ele não desatualiza em relação ao
que a API aceita. Importe-o em Insomnia, Postman, Bruno ou num gerador de
cliente.

O documento cobre **apenas** a API pública: as rotas internas do CRM não estão
nele, de propósito. Não há Swagger UI — a documentação legível é esta página e a
ajuda dentro do app, em **Ajuda → API pública**.

---

## 9. Receber eventos do CRM (webhook de saída)

O caminho inverso do resto deste documento: em vez de o seu sistema escrever no
CRM, o CRM chama o seu sistema quando algo de negócio acontece.

Cadastro em **Administração → Webhooks** (permissão `webhook:gerenciar`), com o
guia completo em **Ajuda → Webhooks** dentro do app.

### Não é a mesma coisa que notificação

| | Notificação (Configurações → Notificações) | Webhook (Administração → Webhooks) |
| --- | --- | --- |
| De quem é | de uma **pessoa** (o Slack dela, o e-mail dela) | da **workspace** |
| Quem configura | cada colaborador, para si | quem tem `webhook:gerenciar` |
| Vocabulário | `NotificationType` (`PAYMENT_DUE`) — interno | evento público (`cobranca.a_vencer`) |
| Corpo | texto pronto para exibir (`titulo`, `corpo`) | dado cru para automação (`dados`) |

O vocabulário é separado de propósito: o enum de notificação é interno e pode ser
renomeado; **o nome de um evento de webhook nunca é renomeado**, porque renomear
quebra a integração de quem consome. Só entram nomes novos.

### Os eventos

| Evento | Quando dispara |
| --- | --- |
| `lead.recebido` | Lead entrou por um canal de captação |
| `registro.atribuido` | Cliente, oportunidade, demanda ou atividade ganhou responsável |
| `negociacao.parada` | Oportunidade sem movimento no funil há tempo demais |
| `proposta.a_vencer` | Proposta perto do fim da validade, ou recém-expirada |
| `cobranca.a_vencer` | Recebimento com vencimento próximo |
| `cobranca.vencida` | Recebimento que passou do vencimento |
| `demanda.atrasada` | Demanda com prazo estourado |
| `atividade.a_fazer` | Follow-up agendado chegou na hora |

Você escolhe quais eventos cada webhook recebe. Evento não marcado não gera
entrega.

### O corpo

```json
{
  "evento": "cobranca.vencida",
  "registroId": "9f2c8e10-4b77-4a52-8d31-6e0a7c5b9d84",
  "ocorridoEm": "2026-08-04T14:32:07.481Z",
  "dados": {
    "descricao": "Mensalidade 08/2026",
    "clienteNome": "Clínica Bem Viver",
    "valor": 1250,
    "vencimento": "2026-08-01T00:00:00.000Z",
    "link": "/financeiro"
  }
}
```

`ocorridoEm` é o momento da **emissão**, não o da entrega: numa retentativa ele
não muda. `link` é caminho relativo — junte o endereço do CRM na frente para o
link completo.

Cabeçalhos: `Content-Type`, `X-CRM-Delivery`, `X-CRM-Timestamp`,
`X-CRM-Signature`, `User-Agent`.

### Verificar a assinatura

`HMAC-SHA256`, hexadecimal, de `<timestamp>.<corpo cru>`, com o segredo do
webhook como chave, em `X-CRM-Signature: sha256=<hex>`. É o esquema do Stripe.

Três passos, nenhum opcional:

1. **Recalcular sobre o corpo cru** — os bytes que chegaram, antes de qualquer
   parse. Reserializar o JSON invalida a comparação: `JSON.stringify` não
   reproduz byte a byte o que foi enviado.
2. **Comparar em tempo constante** (`crypto.timingSafeEqual`), nunca com `===`.
3. **Recusar `X-CRM-Timestamp` com mais de ~5 minutos.** É este passo que impede
   replay — sem ele, um corpo capturado hoje pode ser reenviado amanhã com a
   assinatura ainda válida.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

const app = express();

// express.raw, NÃO express.json: a assinatura é sobre os bytes recebidos.
app.post('/crm', express.raw({ type: 'application/json' }), (req, res) => {
  const esperado =
    'sha256=' +
    createHmac('sha256', process.env.CRM_WEBHOOK_SECRET)
      .update(req.header('X-CRM-Timestamp') + '.' + req.body.toString('utf8'))
      .digest('hex');

  const a = Buffer.from(req.header('X-CRM-Signature') ?? '');
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.sendStatus(401);

  const idade = Math.abs(Date.now() / 1000 - Number(req.header('X-CRM-Timestamp')));
  if (!Number.isFinite(idade) || idade > 300) return res.sendStatus(401);

  res.sendStatus(200); // responda rápido: o CRM desiste em 10 segundos
  processar(JSON.parse(req.body.toString('utf8'))).catch(console.error);
});
```

O segredo aparece **uma única vez**, no cadastro. Perdeu, **rotacione** — e a
assinatura anterior para de casar na hora, sem período de convivência.

### Entrega e retentativa

- Sucesso é qualquer **2xx** em até **10 segundos**. Responda rápido e processe
  depois.
- A fila é varrida **a cada minuto**: o evento é gravado na hora e entregue na
  varredura seguinte.
- Falhando: **6 tentativas** (1min, 5min, 30min, 2h, 8h), esgotando em ~10,6h.
- **A mesma entrega pode chegar duas vezes.** Use `X-CRM-Delivery` como chave de
  idempotência: ele repete na retentativa.
- Desativar ou excluir o webhook **descarta** o que estava na fila.

### O que sai da sua workspace

O corpo carrega nome de cliente e valor de cobrança — é o ponto da feature e é o
risco dela. Contra isso agem a permissão `webhook:gerenciar`, HTTPS obrigatório na
porta 443, o bloqueio de endereço de rede interna (com resolução de DNS, contra
DNS rebinding) e o ping de verificação.

**A assinatura não ajuda nisso**, e não é para isso que ela existe: ela protege o
seu receptor contra corpo forjado, não a workspace contra um webhook apontado
para o lugar errado. Quem confere o endereço é você. Todo cadastro, rotação e
exclusão entra na trilha de auditoria.
