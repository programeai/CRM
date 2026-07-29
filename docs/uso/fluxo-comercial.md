# Fluxo comercial — do lead à receita

O caminho que um negócio percorre dentro do CRM, e o que o sistema faz sozinho em
cada passagem. Se você só vai ler um documento de uso, leia este.

```
 Cliente (Lead)  →  Oportunidade  →  Proposta  →  Contrato  →  Cobranças
                         │              │            │
                         └──── ganhou ──┴─→ Projeto ─┴─→ Demandas
```

Nada aqui é obrigatório em ordem: dá para cadastrar um contrato direto, sem
proposta, ou um projeto sem oportunidade. O que o fluxo completo dá é a costura —
cada etapa herda os dados da anterior e você não redigita nada.

## 1. O lead entra

Um lead é um **cliente com status Lead**. Três formas de entrar:

- **À mão** — Clientes → Novo cliente.
- **De fora do CRM** — pelo canal de captação (formulário do site, n8n). O lead
  cai como cliente Lead + contato principal, já com responsável e fonte de lead
  do canal, e o owner é notificado na hora. Telefone que já existe na base **não**
  abre cadastro duplicado: a mensagem nova é empilhada no cliente existente.
- **Importação** — Administração → Importação, para trazer a base atual.

O status do cliente é quase todo seu: o CRM só faz **uma** mudança sozinho —
promove de *Lead* para *Ativo* quando você ganha a oportunidade ou aceita a
proposta dele, porque aí ele deixou de ser lead de fato. *Inativo* e *Perdido*
nunca são tocados, e ninguém é rebaixado automaticamente.

Cada cliente tem uma **timeline** de atividades (ligação, reunião, e-mail,
WhatsApp, anotação, follow-up). Atividade do tipo **Follow-up** com data é o que
alimenta os lembretes de 6h e o bloco "Próximas ações" do Dashboard — é assim que
você não esquece de voltar num lead.

## 2. A oportunidade entra no funil

**Pipeline → Nova oportunidade**, ou da aba Oportunidades do cliente.

A oportunidade é o negócio em si: título, valor estimado, tipo de serviço, fonte
de lead e responsável. Sem estágio informado, ela entra no primeiro estágio do seu
funil, no fim da coluna.

Arraste para mover entre estágios. O que acontece em cada movimento:

| Movimento | Efeito |
| --- | --- |
| Qualquer mudança de estágio | Zera o contador de dias parados |
| Para um estágio de **perda** | Exige um motivo de perda (da sua lista) |
| Saindo de um estágio de perda | Limpa o motivo |
| Para um estágio de **ganho** | **Cria um projeto automaticamente** a partir da oportunidade e promove o cliente a *Ativo* |

A criação do projeto é idempotente: uma oportunidade gera **um** projeto, por mais
vezes que você mova o card para dentro e para fora do ganho.

O card mostra o selo **Esfriando** quando a oportunidade está parada há mais de
**7 dias** no mesmo estágio (só em estágios não terminais), e o responsável recebe
um aviso de *Oportunidade esfriando* — uma vez por parada, não todo dia: enquanto
o card não se move, o aviso não repete. Mover a oportunidade para qualquer outro
estágio zera a contagem e o assunto.

**Arquivar** uma oportunidade a tira do funil, das listagens e do Dashboard, e a
manda para a Lixeira. Propostas e projetos vinculados **não** são afetados.

## 3. A proposta

**Propostas → Nova proposta**, ou direto da oportunidade (aí ela já nasce
vinculada).

A proposta nasce como **rascunho**, com número `PROP-AAAA-NNNN` e versão 1. Você
monta os itens; o **total é calculado no backend** a partir dos itens e do
desconto — não existe campo de total editável. Além do escopo e do prazo de
entrega, ela carrega o **plano de cobrança**, que é o que vai gerar o contrato
depois.

### O plano de cobrança

Escolha o regime e os parâmetros. Nenhum valor em dinheiro entra aqui — o dinheiro
vem dos itens:

| Regime | O que você informa |
| --- | --- |
| **Recorrente** | Dia de vencimento (1 a 28) e, opcionalmente, duração em meses |
| **Parcelado** | Nº de parcelas (até 120) e, se houver, a entrada — em percentual ou em valor |
| **À vista** | Só o prazo de início |

Os prazos são sempre **em dias relativos ao aceite**, nunca datas fixas. "Entrada
em 5 dias, primeira parcela em 30" continua valendo se a proposta for aceita três
semanas depois do que você imaginava.

### O ciclo de vida

```
DRAFT ──enviar──→ SENT ──→ NEGOTIATING
  │                 │            │
  │                 └── aceitar ─┴──→ ACCEPTED
  │                 └── recusar ─┴──→ REJECTED
  └── editar/excluir (só em rascunho)          EXPIRED (automático)
```

- **Editar e excluir só em rascunho.** Depois de enviada, proposta não se
  reescreve — o que se faz é uma **versão nova** (mesmo número, versão +1,
  copiando itens e plano, de volta a rascunho). O histórico da negociação fica
  inteiro, versão por versão.
- **Preencher a validade é opcional**, mas é ela que faz a proposta expirar
  sozinha: a rotina das 3h passa para *Expirada* toda proposta enviada ou
  em negociação cuja validade venceu. Sem validade, ela fica aberta para sempre.
- Você é avisado **duas vezes**: 3 dias antes ("vai expirar") e no dia em que
  expirou.
- **Aceitar** move a oportunidade vinculada para o estágio de ganho — e isso, por
  consequência, cria o projeto.

## 4. O contrato

Na proposta aceita, **Criar contrato**. O CRM deriva o contrato e toda a agenda de
cobranças a partir do plano de cobrança, ancorando os prazos na data do aceite, e
mostra uma **tela de conferência** antes de gravar. Nada é criado às suas costas.

Um contrato por cadeia de versões da proposta — se você tem PROP-2026-0007 v1, v2
e v3, sai um contrato, não três.

O que é gerado na hora, por regime:

| Regime | Cobranças criadas na assinatura |
| --- | --- |
| **Parcelado** | Entrada (se houver) + as N parcelas, todas de uma vez |
| **À vista** | Uma cobrança única |
| **Recorrente** | Nenhuma — a rotina diária gera cada mensalidade quando chega a hora |

Depois de criado, o contrato aceita: **pausar** (suspende a geração de novas
mensalidades), **retomar** e **cancelar** (cancela as cobranças em aberto e
preserva as pagas no histórico). Descrição, valor mensal, dia de vencimento e data
de término são editáveis — mas **reajuste de valor só vale para as mensalidades
ainda não geradas**, nunca para as que já existem. Cliente e regime de cobrança são
imutáveis: para trocar, cancele e crie outro.

Também é possível criar contrato direto em **Financeiro → Contratos**, sem
proposta nenhuma. Útil para o cliente antigo que já estava na casa antes do CRM.

## 5. As cobranças

**Financeiro** lista tudo o que os contratos geraram, com os cards de recebido,
a receber e em atraso.

Uma cobrança nasce **Pendente** e caminha assim:

- **Dar baixa** → Paga. Aceita valor recebido **diferente do previsto** (parcial
  ou a mais) — é o valor real que entra no relatório.
- **Estornar** uma paga → volta a Pendente, com o estorno registrado nas
  observações. Nunca destrutivo.
- **Cancelar** uma pendente ou vencida → Cancelada.
- **Editar** (descrição, valor, vencimento) só enquanto Pendente.

A rotina das 3h marca como **Vencida** toda cobrança pendente cujo
vencimento passou, e gera as mensalidades dos contratos recorrentes ativos. Você é
avisado 3 dias antes do vencimento e no dia em que a cobrança venceu.

O **MRR** e o previsto × recebido do mês ficam no Dashboard, aba financeira.

## 6. A entrega

O projeto criado no ganho é o ponto de partida da execução: **Projetos → o
projeto → quadro de demandas**, com as colunas Backlog, A fazer, Em andamento,
Em revisão e Concluída.

Cada demanda tem responsável, prioridade (baixa, média, alta, urgente), prazo,
checklist, descrição e etiquetas. As etiquetas não têm catálogo — são texto livre
por demanda, com autocomplete do que você já usou, e dá para renomear ou excluir
uma etiqueta em todas as demandas de uma vez.

**Demandas** (no menu) é o quadro que atravessa todos os projetos — o "minhas
demandas" de quem executa, ordenado por prazo e prioridade. Demanda com prazo
estourado gera notificação.

Arquivar um projeto **não** arquiva as demandas dele: elas continuam ativas em
Demandas.

## Nada se perde por acidente

Arquivar é reversível: clientes, contatos, oportunidades, propostas, projetos e
demandas arquivados vão para **Administração → Lixeira** e voltam de lá no estado
em que estavam. A exclusão definitiva é uma segunda ação, com permissão própria
(`lixeira:expurgar`), e respeita as dependências — um projeto com demandas não é
expurgado enquanto elas existirem.

Toda alteração relevante fica registrada em **Administração → Auditoria**, com
quem fez, quando, e o antes/depois. As rotinas automáticas aparecem lá como
"Rotina diária" — é onde você confirma por que uma cobrança virou vencida ou uma
proposta expirou.

## Resumindo o que o CRM faz sem você pedir

| Quando | O que acontece |
| --- | --- |
| Oportunidade entra no estágio de ganho | Projeto criado a partir dela (uma vez só) e cliente promovido de Lead a Ativo |
| Proposta é aceita | Oportunidade vinculada vai para o ganho; cliente promovido de Lead a Ativo |
| Contrato parcelado ou à vista é criado | Agenda de cobranças gerada inteira |
| Todo dia às 3h | Mensalidade do mês gerada, cobrança vencida marcada, proposta vencida expirada |
| Todo dia às 6h | Lembretes: follow-up do dia, oportunidade parada há mais de 7 dias, proposta e cobrança a 3 dias, demanda atrasada |
| Todo dia às 7h | Resumo do dia por e-mail |
| Lead entra por canal externo | Cliente Lead criado (ou nota empilhada, se o telefone já existe) e owner notificado |

## Ver também

- [Primeiros passos](./primeiros-passos.md) — configurar funil, catálogos, time e
  papéis
- [`apps/api/ENDPOINTS.md`](../../apps/api/ENDPOINTS.md) — o contrato exato de cada
  rota, para quem for integrar
