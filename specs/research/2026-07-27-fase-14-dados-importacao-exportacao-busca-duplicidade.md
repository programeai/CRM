---
date: 2026-07-27T11:06:39-03:00
researcher: claude
git_commit: 4e0f72216695f7169fead5ecb372606a777d289a
branch: main
topic: "Fase 14 — Dados: importação CSV/XLSX, exportação de listagens, busca global e duplicidade/mesclagem de clientes"
tags: [research, dados, importacao, exportacao, busca, duplicidade, mesclagem, clients, contacts, postgres, rls]
status: complete
---

# Research: Fase 14 — Dados: importação, exportação, busca global e duplicidade

## Research Question

Implementar as seis frentes da Fase 14 do roadmap ([`ROADMAP.md:367-385`](../../ROADMAP.md#L367-L385)): (1) importação CSV/XLSX de clientes e contatos com mapeamento de colunas, prévia e relatório de erros; (2) exportação CSV/XLSX de qualquer listagem respeitando filtros **e permissões**; (3) busca global sobre seis entidades (clientes, contatos, propostas por número, contratos, projetos, tarefas); (4) detecção de duplicidade por documento/e-mail/telefone na criação; (5) mesclagem de clientes duplicados movendo contatos, oportunidades, propostas, contratos e timeline; (6) `document` com unicidade por owner quando informado.

**Restrições já fechadas antes desta pesquisa (são premissa, não conclusão):**

- É a fase **mais complexa do P1** por decisão explícita de ordenação ([`ROADMAP.md:269-274`](../../ROADMAP.md#L269-L274)), e a única que "reescreve chave de registro financeiro".
- A mesclagem "pede a trilha da Fase 8 e testes de posse" — a trilha de auditoria não é opcional nessa frente.
- A busca é **full-text com índice novo no Postgres**, não `ILIKE` melhorado.
- A unicidade de `document` "só entra depois de resolver as duplicatas já existentes" — reconciliação de dados antes de constraint.
- A Fase 14 é **dependência declarada da Fase 10** ("Exportação dos relatórios (depende da Fase 14)", [`ROADMAP.md:302`](../../ROADMAP.md#L302)); o mecanismo de export precisa servir relatório agregado depois, não só listagem CRUD.
- Nenhuma dependência pendente própria: a única fase citada é a 8, já concluída.

## Summary

**É campo aberto: o projeto nunca leu nem escreveu um arquivo.** Não existe upload nem download em nenhuma camada — grep por `FormData|responseType|Blob|createObjectURL|multipart|download|input type="file"` em `apps/web/src` retorna **zero**, e grep por `StreamableFile|Content-Disposition|createReadStream|res.download|@Header(` em `apps/api/src` também retorna **zero**. `@Res()` aparece só duas vezes, ambas para redirect de OAuth ([`auth.controller.ts:218,243`](../../apps/api/src/modules/auth/auth.controller.ts#L218)). Não há nenhum `createMany` em todo o `apps/api/src` — não existe hoje um único caminho de escrita em lote. Não há índice GIN, trigram, `tsvector` nem `CREATE EXTENSION` em nenhuma das 18 migrations. E não existe `@unique` em `Client.document`: a unicidade é de aplicação desde a Fase 1, por decisão registrada.

**O que o código já dá de graça é substancial.** As seis FKs que a mesclagem precisa religar já estão inventariadas e contadas por [`ClientRepository.countChildren`](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts#L101-L134) — o mesmo método serve de verificação pós-merge (deve devolver 0 no absorvido). A detecção de duplicidade por documento exato já existe em [`resolveDocument`](../../apps/api/src/modules/clients/application/clients.service.ts#L163-L180), com o parâmetro `exceptId` já previsto. O par de códigos HTTP canônico para "estado errado" (`422`) e "vínculo pendente" (`409`) está em [`shared/purge.ts`](../../apps/api/src/shared/purge.ts#L17-L28). A paginação e o recorte por responsável são helpers compartilhados ([`shared/pagination.ts`](../../apps/api/src/shared/pagination.ts), [`shared/record-scope.ts`](../../apps/api/src/shared/record-scope.ts)). O `TrashModule` é o molde arquitetural pronto de read model que atravessa cinco tabelas sem fazer cinco módulos exportarem services. E `multer@2.2.0` **já está no lockfile**, transitivo de `@nestjs/platform-express@11` — só falta `@types/multer`.

**Os bloqueios estruturais são cinco, e nenhum deles é o parser de planilha.** (1) **A transação por request é uma jaula de 5 segundos**: o `OwnerContextInterceptor` envolve o handler inteiro em `$transaction` sem opções ([`owner-context.interceptor.ts:43-51`](../../apps/api/src/prisma/owner-context.interceptor.ts#L43-L51)), então valem os defaults do Prisma (`timeout` 5000ms, `maxWait` 2000ms), e `prisma.db` dentro do request é um `Prisma.TransactionClient` ([`prisma.service.ts:53-55`](../../apps/api/src/prisma/prisma.service.ts#L53-L55)) — que **não tem `$transaction`**. Importar 500 linhas e mesclar N filhos disputam esse mesmo orçamento, e não há como fatiar em commits parciais pelo caminho normal. (2) **O recorte por responsável não é protegido pelo banco** — o RLS só conhece `ownerId`, e o escopo por `assigneeId` vive exclusivamente no código ([`fase-7b:30`](../../specs/plans/2026-07-26-fase-7b-responsavel-por-registro.md)); qualquer `$queryRaw` de busca ou exportador genérico que não passe o `scope` vaza registros de outros responsáveis **com o RLS ligado e funcionando**. É o risco número um da fase. (3) **Um export em streaming mantém a transação do request aberta durante todo o download**, porque o interceptor faz `await lastValueFrom(next.handle())`. (4) **`document` está na lista de campos omitidos do diff de auditoria** ([`shared/audit-diff.ts:10-30`](../../apps/api/src/shared/audit-diff.ts#L10-L30)) e o `AuditLog` é append-only por `REVOKE UPDATE, DELETE` — a trilha de uma mesclagem tem de estar completa no `INSERT`, e hoje não registraria o documento envolvido. (5) **A unicidade de `document` exige índice único parcial**, porque o campo é opcional e N nulos precisam coexistir — decisão que a Fase 1 tomou explicitamente ao recusar o `@unique`.

## Codebase Map

### Arquivos afetados

#### Cria

| Arquivo | Papel |
|---|---|
| `apps/api/src/modules/data/data.module.ts` | Módulo transversal de dados (import + export). Molde: [`trash.module.ts`](../../apps/api/src/modules/trash/trash.module.ts) — read/write model que atravessa tabelas sem fazer os módulos exportarem services |
| `apps/api/src/modules/data/api/import.controller.ts` | `POST /data/import/preview` e `POST /data/import/commit` (multipart) |
| `apps/api/src/modules/data/api/export.controller.ts` | Rota(s) de exportação — a **primeira** resposta de arquivo da API |
| `apps/api/src/modules/data/application/import.service.ts` | Mapeamento de colunas → validação linha a linha → relatório de erros → escrita |
| `apps/api/src/modules/data/application/export.service.ts` | Serialização CSV/XLSX a partir das linhas que o módulo dono já filtrou |
| `apps/api/src/modules/data/infra/spreadsheet.reader.ts` | Leitura CSV/XLSX. **Classe de infraestrutura → spec real, sem mock** (commit `6dc6220`) |
| `apps/api/src/modules/data/infra/spreadsheet.writer.ts` | Escrita CSV/XLSX; ponto único da escapatória de CSV injection |
| `apps/api/src/modules/search/search.module.ts` | Busca global sobre 6 entidades |
| `apps/api/src/modules/search/api/search.controller.ts` | `GET /search?q=` |
| `apps/api/src/modules/search/application/search.service.ts` | Filtra por permissão da sessão e aplica o recorte por responsável por entidade |
| `apps/api/src/modules/search/infra/prisma-search.repository.ts` | Consultas por entidade; `$queryRaw` sempre via `this.prisma.db` (senão o RLS fecha) |
| `apps/api/src/modules/clients/application/client-merge.service.ts` | Mesclagem: religa as 6 FKs, resolve `isPrimary`, arquiva o absorvido, registra a trilha |
| `apps/api/prisma/migrations/<ts>_search_extensions/migration.sql` | `CREATE EXTENSION` (`pg_trgm`, `unaccent`, `btree_gin`) + `f_unaccent` |
| `apps/api/prisma/migrations/<ts>_search_indexes/migration.sql` | Índices de busca das 6 entidades |
| `apps/api/prisma/migrations/<ts>_client_document_unique/migration.sql` | Índice único **parcial** por owner — depois da reconciliação |
| `apps/web/src/features/dados/ImportacaoPage.tsx` | Wizard de importação (upload → mapeamento → prévia → resultado) |
| `apps/web/src/features/dados/api/*` | `data.api.ts` + `hooks.ts`, no padrão de `features/<f>/api/` |
| `apps/web/src/features/clientes/MesclarClienteDialog.tsx` | Escolha do vencedor + prévia do que será movido |
| `apps/web/src/components/ui/file-drop.tsx` | Primitivo de upload — **não existe nenhum** no design system |
| `apps/web/src/components/ui/progress.tsx` | Barra de progresso — **não existe** |
| `apps/web/src/components/ui/command.tsx` (ou equivalente) | Busca global no topbar; `cmdk` **não é dependência** |
| `apps/web/src/hooks/use-export.ts` | Download de blob reutilizável pelas listagens |

#### Modifica — API

| Arquivo | O que muda | Por quê |
|---|---|---|
| [`prisma/schema.prisma`](../../apps/api/prisma/schema.prisma) | `AuditAction` ganha `MESCLAR` (e `IMPORTAR`, se a decisão for auditar import); avaliar `AuditEntity` | O enum declara "cresce conforme a trilha cobre mais domínio" (`:597`); hoje não há valor para nenhuma das duas ações |
| [`shared/permissions.ts`](../../apps/api/src/shared/permissions.ts) | Chaves novas (`dados:importar`, `dados:exportar`, `cliente:mesclar`) | Catálogo é fonte única e os rótulos pt-BR **nunca** são duplicados no front (`apps/web/CLAUDE.md`) |
| [`shared/audit-diff.ts:10-30`](../../apps/api/src/shared/audit-diff.ts#L10-L30) | Decidir o tratamento de `document` no diff | `document` está em `CAMPOS_OMITIDOS`; uma mesclagem que não registra o documento envolvido é trilha cega justamente no dado que causou a duplicata |
| [`modules/clients/application/clients.service.ts:163-180`](../../apps/api/src/modules/clients/application/clients.service.ts#L163-L180) | `resolveDocument` passa a devolver candidatos em vez de só lançar `409`; nova detecção por e-mail/telefone | Hoje a duplicidade é binária e só por documento exato |
| [`modules/clients/domain/client.repository.ts`](../../apps/api/src/modules/clients/domain/client.repository.ts) | Contrato de `findDuplicateCandidates` e dos `updateMany` de religamento | Repository pattern: a `application` depende da interface, nunca do Prisma |
| [`modules/clients/infra/prisma-client.repository.ts`](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts) | Religamento das 6 FKs; consulta de candidatos | `countChildren` (`:101-134`) já é o inventário e serve de verificação pós-merge |
| [`modules/clients/api/clients.controller.ts`](../../apps/api/src/modules/clients/api/clients.controller.ts) | `POST /clients/:id/merge` | Precedente de rota de ação: `POST /clients/:id/archive` |
| Repositórios de listagem dos 6 módulos | Método de leitura sem paginação para export, reusando o **mesmo** `where` | Exportar "respeitando filtros e permissões" só é honesto se reusar o filtro do módulo; ver a armadilha do `where` duplicado em [`prisma-payment.repository.ts:134`](../../apps/api/src/modules/finance/infra/prisma-payment.repository.ts#L134) |
| [`ENDPOINTS.md`](../../apps/api/ENDPOINTS.md) | Todas as rotas novas, formato fixo | Definition of Done: PR que mexe em controller sem doc está incompleto |
| `test/*.e2e-spec.ts` | Posse na mesclagem e no export; recorte por responsável na busca | "testes de posse" pedidos pelo roadmap; o e2e de RLS já existe (`a5f273b`) |

#### Modifica — Web

| Arquivo | O que muda |
|---|---|
| [`lib/labels.ts`](../../apps/web/src/lib/labels.ts) | Mapa **inverso** (rótulo pt-BR → enum) por enum, para o mapeamento de colunas; e `translateAuditAction` para os valores novos |
| [`app/AppLayout.tsx:118-120`](../../apps/web/src/app/AppLayout.tsx#L118-L120) | Campo de busca global no vão vazio do header, entre `SidebarTrigger` e o bloco `ml-auto` |
| [`app/nav.ts`](../../apps/web/src/app/nav.ts) | Item de Importação em Organização, com `permission: ['dados:importar']` |
| [`routes/router.tsx`](../../apps/web/src/routes/router.tsx) | Rota da importação sob `PermissionRoute` |
| Toolbars das listagens | Botão "Exportar" reusando o objeto de params que já vai para a query |
| [`features/clientes/ClientFormDialog.tsx:45-67`](../../apps/web/src/features/clientes/ClientFormDialog.tsx#L45-L67) | Aviso de possível duplicata antes de salvar |
| [`lib/query-keys.ts`](../../apps/web/src/lib/query-keys.ts) | Namespaces `search` e `data` |

### Padrões existentes a seguir

**Padrão: a transação já está aberta — não abra outra (é a restrição que governa import e merge)**

```ts
// De apps/api/src/prisma/owner-context.interceptor.ts:43-51
return from(
  this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, true)`;
    this.cls.set(PRISMA_TX, tx);
    const result: unknown = await lastValueFrom(next.handle());
    return result;
  }),
);
```

```ts
// De apps/api/src/prisma/prisma.service.ts:53-55
get db(): PrismaTx | PrismaClient {
  return this.cls.get<PrismaTx>(PRISMA_TX) ?? this.base;
}
```

**Por que importa**: toda requisição autenticada **já roda dentro de uma transação**, e o tipo devolvido dentro do request é `Prisma.TransactionClient` — que não expõe `$transaction`. Consequências diretas e não negociáveis: (a) a mesclagem ganha a atomicidade que o roadmap pede ("num só `$transaction`") **de graça**, sem escrever `$transaction` nenhum — vários repositórios já anotam isso ([`prisma-proposal.repository.ts:86`](../../apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts#L86): "atômico via transação do request; sem `$transaction` aninhado"); (b) uma importação **não pode** commitar em lotes pelo caminho normal — ou a requisição inteira cabe em 5s ou nada é gravado; (c) `timeout`/`maxWait` nunca foram configurados (grep por `transactionOptions|maxWait|timeout` em `apps/api/src` retorna zero), então subir o orçamento é uma mudança global que afeta todas as rotas, não um ajuste local. A única saída fora do request é o `PrismaAdminService`, que é `crm_user` **superuser e bypassa RLS** — usá-lo para import significa filtrar `ownerId` à mão, sem a rede de proteção do banco.

**Padrão: recorte por responsável se compõe com `AND`, nunca por spread**

```ts
// De apps/api/src/shared/record-scope.ts:41-53
/**
 * **Sempre componha com `AND: [fragmento]`**, nunca por spread no objeto raiz: o
 * `where` de `Client` já usa `OR` para a busca textual, e um segundo `OR` no mesmo
 * nível sobrescreveria o primeiro silenciosamente.
 */
```

```ts
// De apps/api/src/modules/clients/infra/prisma-client.repository.ts:38-69
const where: Prisma.ClientWhereInput = {
  ownerId: filter.ownerId,
  ...(filter.includeArchived ? {} : { archivedAt: null }),
  ...(filter.search ? { OR: [
      { name:      { contains: filter.search, mode: 'insensitive' } },
      { tradeName: { contains: filter.search, mode: 'insensitive' } },
      { document:  { contains: filter.search, mode: 'insensitive' } } ] } : {}),
  ...(scoped ? { AND: [scoped] } : {}),   // AND, não spread — senão sobrescreve o OR da busca
};
```

**Por que importa**: a busca global é textual (`OR` de vários campos) **e** recortada por responsável (`OR` de `assigneeId`). É exatamente a colisão que o comentário descreve, agora em seis entidades em vez de uma. O plano da Fase 7B chegou a criar item de verificação manual para isso. E o ponto mais grave: **o banco não protege esse recorte** — o RLS conhece só `ownerId`. Um `$queryRaw` de busca que esqueça o `assigneeId` devolve registros de outros responsáveis sem que nenhuma policy reclame. As chaves por recurso: `Client` e `Activity` → `cliente:ver_todos`; `Deal` → `oportunidade:ver_todas`; `Task` → `demanda:ver_todas`. `Contact`, `Proposal`, `Project`, `Contract` e `Payment` **não têm `assigneeId`** e portanto não têm recorte — para elas o filtro é `ownerId` puro.

**Padrão: agregar leitura de vários módulos num read model próprio (é o molde da busca global e do export)**

```ts
// De apps/api/src/modules/trash/infra/prisma-trash.repository.ts:35-54
const [clients, contacts, deals, projects, tasks] = await Promise.all([...]);
// concatena, ordena por archivedAt desc e pagina em memória
```

**Por que importa**: o plano da lixeira registrou a decisão ([`fase-8c:533-537`](../../specs/plans/2026-07-26-fase-8c-lixeira.md)): "agregar leituras de módulos diferentes num repositório de leitura é mais honesto que fazer cinco módulos exportarem services só para isso". A busca global atravessa seis entidades — é o mesmo desenho. **Divergência necessária**: a lixeira pagina em memória porque "uma lixeira com centenas de itens já é sinal de que falta expurgar"; a busca global não tem esse teto natural e precisa de `LIMIT` por entidade no banco. Diga isso no plano, ou o próximo leitor vai "consertar" a busca para ficar igual à lixeira.

**Padrão: rota que agrega módulos devolve `null` no bloco que a sessão não pode ver**

```ts
// De apps/api/src/modules/dashboard/api/dashboard.controller.ts:21-30
// Rota sem @RequirePermission recebe as permissões da sessão e devolve null
// no bloco que o usuário não pode ver — não vaza agregado por falta de decorator.
```

**Por que importa**: é a regra do `apps/api/CLAUDE.md` para rota transversal, e a busca global é o caso mais puro dela — um colaborador sem `financeiro:ver` **não pode** receber contratos no resultado. O desenho correto é uma rota sem `@RequirePermission` que recebe `@CurrentAccess()` e decide entidade por entidade, não uma rota com uma chave só.

**Padrão: guardas de estado e vínculo com os códigos HTTP canônicos do projeto**

```ts
// De apps/api/src/shared/purge.ts:17-28
export function assertArquivado(archivedAt: Date | null, recurso: string): void {
  if (!archivedAt) throw new UnprocessableEntityException(
    `Só é possível excluir em definitivo ${recurso} que já esteja na lixeira. Arquive antes.`);
}
export function assertSemFilhos(quantidade: number, mensagem: string): void {
  if (quantidade > 0) throw new ConflictException(mensagem);
}
```

**Por que importa**: `422` = estado errado, `409` = vínculo pendente. A mesclagem reusa esse vocabulário (mesclar consigo mesmo, mesclar cliente arquivado, mesclar cliente de outro owner) em vez de inventar códigos. E a decisão de projeto que a acompanha ([`purge.ts:12-15`](../../apps/api/src/shared/purge.ts#L12-L15)): "nenhuma cascata... um expurgo com filho pendurado responderia 500 de FK; aqui vira 409 com instrução". A mesclagem é a resposta de produto a essa recusa — ela **religa** e arquiva, nunca apaga em cascata.

**Padrão: o inventário das 6 FKs já existe e serve de verificação pós-merge**

```ts
// De apps/api/src/modules/clients/infra/prisma-client.repository.ts:101-134
const [contacts, activities, deals, proposals, projects, contracts] = await Promise.all([
  this.prisma.db.contact.count({ where: { clientId: id } }),
  this.prisma.db.activity.count({ where: { clientId: id } }),
  this.prisma.db.deal.count({ where: { clientId: id } }),
  this.prisma.db.proposal.count({ where: { clientId: id } }),
  this.prisma.db.project.count({ where: { clientId: id } }),
  this.prisma.db.contract.count({ where: { clientId: id } }),
]);
// monta descricao pt-BR: "3 oportunidades, 1 contrato"
```

**Por que importa**: são exatamente as seis tabelas a religar, e a `descricao` em pt-BR já serve para a prévia da mesclagem na interface ("serão movidos 3 contatos, 2 oportunidades…"). Depois do merge, `countChildren(absorvido).total` **tem de ser 0** — é o critério de sucesso mais direto que existe. Lição transferível de [`fase-8c:48`](../../specs/plans/2026-07-26-fase-8c-lixeira.md): **contagem de integridade não filtra `archivedAt`** — ignorar arquivados violaria a FK `RESTRICT` e responderia 500.

**Padrão: um evento de trilha agregado para escrita multi-linha**

```ts
// De apps/api/src/modules/finance/application/contracts.service.ts:234-245
// Um registro agregado, não N: N linhas de Payment com o mesmo autor e o
// mesmo instante seriam ruído na tela de auditoria.
await this.audit.registrar({ entity: 'CONTRACT', entityId: id, entityLabel: c.description,
  action: 'CANCELAR', antes: c, depois: cancelado, extra: { cobrancasCanceladas: emAberto } });
```

**Por que importa**: é o precedente para a mesclagem (1 evento com `extra: { clienteAbsorvidoId, contatosMovidos, oportunidadesMovidas, … }`) e para a importação (1 evento com `extra: { arquivo, linhas, criados, erros }`). O contraponto existe e é deliberado: os crons gravam **1 evento por linha** ([`finance-billing.job.ts:34-46`](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L34-L46)) porque o `ownerId` é o da cobrança, não o do ator. A pergunta "agregado ou N" ficou explicitamente aberta na Fase 8 ([`fase-8:454`](../../specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md)) e a Fase 14 a reabre nos dois casos mais extremos.

**Padrão: filtro na URL, não em `useState`**

```ts
// De apps/web/src/features/clientes/ClientesListPage.tsx:65-70,126,139-145
const CLIENTES_FILTERS = { search: stringFilter(), status: enumFilter(...), page: numberFilter(1) };
const { values, set } = useUrlFilters(CLIENTES_FILTERS);
const { data } = useClients({ page, limit: LIMIT, search: values.search || undefined, ... });
```

**Por que importa**: o objeto de params que alimenta a query é literalmente o que o botão "Exportar" precisa enviar — a exportação "respeitando filtros" é reaproveitamento direto, não uma segunda montagem de filtro. O mapa de codecs deve ser estável (definido fora do componente), e a busca usa `useDebouncedValue(search, 300)` com a URL recebendo só o valor debounced ([`ClientesListPage.tsx:133-137`](../../apps/web/src/features/clientes/ClientesListPage.tsx#L133-L137)).

**Padrão: esconder ação por permissão na toolbar**

```tsx
// De apps/web/src/features/lixeira/LixeiraPage.tsx:44,166-175
const { can } = useCan();
{can('lixeira:expurgar') && (
  <Button variant="ghost" size="sm" className="text-destructive">Excluir em definitivo</Button>
)}
```

**Por que importa**: é o molde exato para "Exportar", "Importar" e "Mesclar". O backend é a autoridade; o front só evita mostrar o que levaria `403`.

**Padrão: máscara na exibição, dígitos crus na persistência**

```ts
// De apps/web/src/lib/format.ts:19-24 (regra) e apps/api/src/modules/clients/application/clients.service.ts:163-180
if (!isValidDocument(clean, personType)) throw new BadRequestException('CPF inválido.');
if (await this.repo.existsByDocument(ownerId, clean, exceptId))
  throw new ConflictException('Já existe um cliente com este documento.');
```

**Por que importa**: `document` é gravado **só com dígitos**. A importação tem de normalizar antes de comparar (a planilha vem com máscara em qualquer formato), e a unicidade no banco só é coerente porque o dado já está normalizado. Note a assimetria existente: o Zod do formulário **não valida CPF/CNPJ** ([`ClientFormDialog.tsx:48`](../../apps/web/src/features/clientes/ClientFormDialog.tsx#L45-L67): `document: z.string().optional()`) — toda a validação real está no backend, em [`shared/document.ts`](../../apps/api/src/shared/document.ts). A validação de importação deve chamar a mesma função, não reimplementar.

### Data Flow

**Importação (proposto, dois passos):**

```
Planilha → POST /data/import/preview (multipart, FileInterceptor+memoryStorage)
  → spreadsheet.reader (csv-parse | exceljs stream)
  → detecção de cabeçalho → sugestão de mapeamento (rótulo pt-BR → campo, via mapa inverso de labels.ts)
  → validação linha a linha (mesmas regras de shared/document.ts + Zod/class-validator)
  → devolve { colunas, amostra, mapeamentoSugerido, erros[] }  — NADA é gravado
Usuário ajusta o mapeamento na interface
  → POST /data/import/commit → escrita dentro da transação do request (5s!)
  → 1 evento de trilha agregado + relatório { criados, ignorados, erros[] }
```

**Exportação:** `GET /<recurso>?<filtros>&formato=csv` (ou rota irmã) → o **módulo dono** monta o `where` com o mesmo `filter` + `scope` da listagem → repositório devolve as linhas sem paginação (com teto) → `export.service` serializa → resposta com `Content-Disposition`. O caminho crítico é o `where`: em `payments` ele existe **duplicado** (Prisma e `Prisma.sql`) e o próprio arquivo avisa que os dois precisam ficar em sincronia ([`prisma-payment.repository.ts:134`](../../apps/api/src/modules/finance/infra/prisma-payment.repository.ts#L134)).

**Busca global:** `GET /search?q=` → `search.service` lê `@CurrentAccess()` → para cada uma das 6 entidades: a sessão tem a permissão de leitura? → resolve `AssigneeScope` na chave daquele recurso → consulta com `LIMIT` por entidade, `archivedAt: null`, dentro da transação do request (RLS ativo) → resultado agrupado por entidade.

**Mesclagem:** `POST /clients/:vencedorId/merge { absorvidoId }` → carrega os dois (posse por `ownerId`; ambos existem; não são o mesmo) → `countChildren(absorvido)` para o relatório → 6 `updateMany` de `clientId` → resolve `isPrimary` dos contatos → arquiva o absorvido → 1 evento `MESCLAR` com `extra` → verificação `countChildren(absorvido).total === 0`. Tudo numa transação implícita; nenhum `$transaction` escrito à mão.

### Mapa das FKs — o que a mesclagem move e o que não move

Seis tabelas têm `clientId`, todas **obrigatórias** e todas `ON DELETE RESTRICT ON UPDATE CASCADE` (default do Prisma, SQL em `20260721002325_init/migration.sql:271-319`):

| Modelo | Campo | Schema |
|---|---|---|
| `Contact` | `clientId` | [`schema.prisma:214-215`](../../apps/api/prisma/schema.prisma#L214-L215) |
| `Deal` | `clientId` | `:249-250` |
| `Proposal` | `clientId` | `:286-287` |
| `Project` | `clientId` | `:327-328` |
| `Contract` | `clientId` | `:381-382` |
| `Activity` | `clientId` | `:431-432` |

**Divergência no roadmap a resolver no plano**: [`ROADMAP.md:373`](../../ROADMAP.md#L373) lista "contatos, oportunidades, propostas, contratos e timeline" (5) e [`:383`](../../ROADMAP.md#L383) lista "contatos, oportunidades, propostas, contratos, **cobranças** e timeline" (6, com cobranças). Nenhuma das duas está completa e a segunda está imprecisa: **`Project` falta nas duas**, e **`Payment` não tem `clientId`** — ele chega ao cliente por `Contract` ([`schema.prisma:409`](../../apps/api/prisma/schema.prisma#L409)), então cobranças migram junto com o contrato, sem religamento próprio. A lista correta é a das 6 tabelas acima.

**Três coisas que a mesclagem *não* precisa fazer** (registrar para o `/spec` não inventar trabalho):

1. **`ownerId` não muda.** O RLS torna impossível mesclar entre owners (a policy é `FOR ALL` com `USING` = `WITH CHECK`, então um cliente de outro owner é literalmente invisível). Os `ownerId` denormalizados das filhas ([`20260724025450_denormalize_owner_id`](../../apps/api/prisma/migrations/20260724025450_denormalize_owner_id/migration.sql)) já são iguais nos dois lados.
2. **`Deal.position` não colide.** A posição é escopada por `stageId` ([`@@index([stageId, position])`](../../apps/api/prisma/schema.prisma#L272)); religar `clientId` não toca `stageId` nem `position`. A invariante "0-based contígua sem furos" da Fase 2 fica intacta.
3. **`Proposal.number` não colide.** É `@unique` **global** ([`:281`](../../apps/api/prisma/schema.prisma#L281)) e a mesclagem não cria proposta nem renumera.

**Uma coisa que ela precisa fazer e ninguém está guardando hoje:** `Contact.isPrimary` **não tem constraint no banco** — a regra "único contato principal por cliente" é só de aplicação, registrada como tal desde a Fase 1 ([`fase-1:141`](../../specs/research/2026-07-21-fase-1-clientes.md)). Mesclar dois clientes que ambos têm um contato principal produz **dois `isPrimary = true`** no cliente vencedor, e o banco não reclama.

## External Research

### Inventário local (versões reais)

`apps/api/package.json`: `@nestjs/common|core|platform-express ^11.0.1`, `@nestjs/schedule ^6.1.3`, `prisma`/`@prisma/client ^6.19.3`, `class-validator ^0.15.1`, `nestjs-cls ^6.2.1`, `helmet ^8.3.0`, TypeScript `^5.7.3`.
`apps/web/package.json`: `react ^19.2.7`, `vite ^8.1.1`, `zod ^4.4.3`, `axios ^1.18.1`, `@tanstack/react-query ^5.101.3`, `react-hook-form ^7.82.0`.

**Nada de CSV/XLSX/upload instalado** — nem `papaparse`, `xlsx`, `exceljs`, `fast-csv`, `csv-parse`, `file-saver`, `cmdk`, `@tanstack/react-table`. **Exceção que economiza uma decisão**: `multer@2.2.0` **já está no `pnpm-lock.yaml`** (transitivo de `@nestjs/platform-express@11`), então `FileInterceptor` funciona sem instalar nada; falta apenas `@types/multer` como devDependency, porque o multer 2.2.0 não embarca `.d.ts`.

**Plataforma HTTP: Express, não Fastify** — `main.ts` usa `app.getHttpAdapter().getInstance().set('trust proxy', …)`, `cookieParser()` e `rawBody: true`. Multipart idiomático = multer via `FileInterceptor`, sem troca de adapter.

**Postgres 16 em dev e prod** (`postgres:16-alpine` em `docker-compose.yml` e `docker-compose.prod.yml`). As migrations rodam como `crm_user`, **superuser** ([`entrypoint.sh:37`](../../apps/api/docker/entrypoint.sh#L37)), então `CREATE EXTENSION` funciona em dev **e** em prod. A aplicação conecta como `crm_app` (`NOSUPERUSER NOBYPASSRLS`, só DML, sem DDL).

**Limite de body: nenhum configurado.** `main.ts` não passa `bodyParser`, então vale o default de **100 kb para JSON**; o Traefik não tem middleware de buffering e o `nginx.conf` do web **nunca faz proxy para `/api`**. Consequência: multipart não passa pelo body-parser (multer intercepta antes), então **o único limite real de upload é o `limits.fileSize` do multer**. Se a importação for por JSON/base64 em vez de multipart, aí sim é preciso subir o limite globalmente.

### Bibliotecas de planilha (dados de npm em 2026-07-27)

| Pacote | Versão | Publicada | Licença | Streaming | Risco |
|---|---|---|---|---|---|
| `csv-parse` | 7.0.1 | 2026-07-02 | MIT | sim, stream nativo | nenhum; ativo |
| `csv-stringify` | 6.8.1 | 2026-07-02 | MIT | sim | nenhum; ativo |
| `exceljs` | 4.4.0 | **2023-10-19** | MIT | sim, leitura e escrita | **repo inativo**; advisories **transitivos** (`tmp <0.2.4` GHSA-52f5-9888-hmc6; `uuid` GHSA-w5hq-g745-h8pq); 21,8 MB |
| `xlsx` (SheetJS CE) | **0.18.5 no npm** | — | Apache-2.0 | parcial | **descartado** — ver abaixo |
| `read-excel-file` | 9.3.4 | 2026-07-21 | MIT | sim (leitura) | ativo; só leitura |
| `write-excel-file` | 4.1.1 | 2026-06-08 | MIT | não (memória) | ativo; só escrita |
| `papaparse` | 5.5.4 | 2026-06-19 | MIT | parcial no Node | ativo; ideal no **browser** |

**`xlsx` do npm está descartado, e o motivo é o nosso caso de uso exato.** O npm está travado em 0.18.5, afetada por [CVE-2023-30533](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) (prototype pollution **ao ler arquivo malicioso**, corrigido em 0.19.3) e [CVE-2024-22363](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) (ReDoS, corrigido em 0.20.2). Nenhuma correção foi publicada no npm — o projeto migrou a distribuição para `cdn.sheetjs.com` e o pacote do registro está abandonado ([issue oficial #3316](https://git.sheetjs.com/sheetjs/sheetjs/issues/3316)). Como a importação lê arquivo enviado pelo usuário — o vetor literal da CVE-2023-30533 — está fora. Instalar por tarball do CDN quebraria o lockfile reprodutível.

**Duas combinações defensáveis:**

- **`csv-parse@7` + `csv-stringify@6` + `exceljs@4.4.0`** — única com streaming real nas quatro direções (ler csv, ler xlsx, escrever csv, escrever xlsx), tudo MIT, sem CVE no próprio código. Os dois advisories são transitivos e resolvíveis com `pnpm.overrides` na raiz. Custo: uma dependência estagnada desde 2023 e 21,8 MB.
- **`csv-parse@7` + `csv-stringify@6` + `read-excel-file@9` + `write-excel-file@4`** — todas ativas em 2026, ~6 MB somadas. Custo: escrita xlsx sem streaming (monta em memória) e menos controle de formatação. Para um CRM de agência (milhares de linhas, não milhões) é adequada, e é a escolha mais defensável se "zero dependência abandonada" for requisito.

`papaparse` fica reservado ao **frontend**, para a prévia do CSV no navegador antes do upload. Nota estrutural honesta: XLSX é um zip, então "streaming" sempre passa por descompactar o XML; o ganho de memória é menor que o nome sugere.

**Dois cuidados que viram código:**
1. **CSV injection no export** — célula começando com `=`, `+`, `-`, `@`, TAB ou CR vira fórmula no Excel. Prefixar com `'` ou rejeitar. Vale para todo campo de texto vindo do usuário (nome, descrição, observação).
2. **Zip bomb no import** — `limits.fileSize` não protege contra um xlsx de 200 KB que descomprime para 2 GB. Impor teto de **linhas** durante o parse e abortar.

### Multipart no NestJS 11

A [doc oficial](https://docs.nestjs.com/techniques/file-upload) é explícita que o pacote "is not compatible with the `FastifyAdapter`" — irrelevante aqui. Mínimo:

```ts
@UseInterceptors(FileInterceptor('arquivo', {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}))
importar(@UploadedFile() file: Express.Multer.File) {}
```

O `FileTypeValidator` do `ParseFilePipeBuilder` "validates the mime-type using file content magic number" — não confia no `Content-Type` do cliente, o que importa porque `text/csv` é trivialmente falsificável. **Gotcha do projeto**: o `ValidationPipe` global tem `whitelist: true, forbidNonWhitelisted: true` ([`main.ts:75-79`](../../apps/api/src/main.ts#L75-L79)) — todo campo de texto do `multipart/form-data` precisa estar declarado no DTO, ou a requisição responde `400`.

### Busca full-text no Postgres 16

**O `search` do Prisma não serve aqui.** `fullTextSearchPostgres` **continua preview** (confirmado na [lista de preview features](https://www.prisma.io/docs/orm/reference/preview-features/client-preview-features)), não expõe a `regconfig` (não dá para fixar `'portuguese'`), não devolve `ts_rank` e não integra `unaccent`. O caminho é `$queryRaw` com tagged template (nunca `$queryRawUnsafe` com input do usuário), **sempre via `this.prisma.db`** — fora da transação do request o RLS devolve zero linhas sem erro. Precedente de raw nesse padrão já existe em [`prisma-payment.repository.ts:164`](../../apps/api/src/modules/finance/infra/prisma-payment.repository.ts#L164).

**tsvector com coluna gerada + GIN** (recomendação da [doc PG16 §12.2.2](https://www.postgresql.org/docs/16/textsearch-tables.html)):

```sql
ALTER TABLE "Client" ADD COLUMN "busca" tsvector
  GENERATED ALWAYS AS (to_tsvector('pt_unaccent',
    coalesce("name",'') || ' ' || coalesce("tradeName",'') || ' ' || coalesce("email",''))) STORED;
CREATE INDEX "Client_busca_idx" ON "Client" USING GIN ("busca");
```

Consultar com `websearch_to_tsquery`, que **nunca lança erro** com input arbitrário — ao contrário de `to_tsquery`. A doc é inequívoca que só a versão de 2 argumentos de `to_tsvector` serve em índice de expressão, e que uma query que não repita a expressão indexada **não usa o índice**.

**pg_trgm quando o alvo é nome próprio, substring e autocomplete** ([PG16 F.34](https://www.postgresql.org/docs/16/pgtrgm.html)):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Client_name_trgm_idx" ON "Client" USING GIN ("name" gin_trgm_ops);
```

Divisão recomendada para as 6 entidades: **trigram** para `Client.name`/`tradeName`, `Contact.name`, `Deal.title`, `Project.name`, `Task.title`, `Proposal.number` (o tokenizador do tsvector só casa lexema inteiro; trigram casa `"cme"` dentro de `"Acme"` e tolera typo via `similarity`); **tsvector** só se entrar texto livre longo (`Project.description`, `Payment.description`). A doc adverte que padrão com menos de 3 caracteres "will degenerate to a full-index scan" — **exigir ≥3 caracteres no backend**.

**Documento numérico não serve a nenhum dos dois cru**: `12.345.678/0001-90` é picado de forma inútil pelo tsvector. Como `document` já é persistido só com dígitos, um btree para igualdade + trigram para parcial resolve.

**Interação com RLS** — o predicado `"ownerId" = current_setting('app.owner_id', true)` entra implicitamente em toda query. Para o planner não varrer o GIN do tenant errado:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE INDEX "Client_owner_busca_idx" ON "Client" USING GIN ("ownerId", "busca");
```

**Ganho barato e imediato, sem tocar em repositório nenhum**: os `contains`/`mode:'insensitive'` já existentes geram `ILIKE '%x%'` e hoje fazem seq scan. Um `CREATE INDEX … USING GIN (col gin_trgm_ops)` **na coluna crua** passa a ser usado por esses `ILIKE` sem mudar uma linha de TypeScript. Índice sobre *expressão* (`lower()`, `f_unaccent()`) **não** será usado pelo Prisma, porque a query dele não repete a expressão — só compensa nos endpoints com `$queryRaw`.

### unaccent (acentuação em português)

Duas abordagens, e a diferença importa ([PG16 F.47](https://www.postgresql.org/docs/16/unaccent.html)):

**(a) Integrado à configuração de busca textual — preferível para tsvector:**
```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE TEXT SEARCH CONFIGURATION pt_unaccent ( COPY = portuguese );
ALTER TEXT SEARCH CONFIGURATION pt_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
```
`to_tsvector('pt_unaccent', …)` de 2 argumentos é imutável, então serve em coluna gerada sem truque.

**(b) Wrapper `IMMUTABLE` — necessário para ILIKE/trigram**, porque `unaccent()` é declarada `STABLE` (depende de arquivo de dicionário no servidor) e o Postgres recusa usá-la em índice de expressão:
```sql
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT SET search_path = public, pg_temp
AS $func$ SELECT unaccent('unaccent', $1) $func$;
```
Ressalva honesta: marcar como `IMMUTABLE` é uma mentira benigna — se `unaccent.rules` mudar no servidor, os índices ficam silenciosamente corrompidos e precisam de `REINDEX`. Com a imagem fixada em `postgres:16-alpine` o risco é nulo, mas **ancore a versão da imagem**. `EXECUTE` em funções é `PUBLIC` por default no PG16, então `crm_app` usa `f_unaccent`/`similarity` sem GRANT extra — confirmar, porque `crm_app` só recebeu GRANTs de DML explícitos.

## Historical Context

- **A ausência do `@unique` em `document` foi decisão consciente da Fase 1**, não esquecimento: [`fase-1 plan:42`](../../specs/plans/2026-07-21-fase-1-clientes.md) põe "`@unique` de `document` no banco" em *What We're NOT Doing*, porque "a unicidade é checada em aplicação (evita migration de constraint **e permite `document` nulo repetido**)". O "nulo repetido" é o requisito que força **índice único parcial** (`WHERE "document" IS NOT NULL`), não `@@unique([ownerId, document])` puro. Era a Open Question 5 daquela fase ([`fase-1 research:142,158`](../../specs/research/2026-07-21-fase-1-clientes.md)).
- **O precedente mais próximo do que a migration de unicidade vai enfrentar** é o commit `ac5c84d` ("derruba o unique de `name` antes de replicar os estágios") — uma migration que **removeu** um `UNIQUE` porque ele impedia dados legítimos. A Fase 14 faz o inverso, e vai enfrentar o mesmo tipo de conflito com dados vivos: o roadmap já manda resolver as duplicatas antes.
- **"Nenhuma cascata" é regra do projeto, não detalhe** ([`purge.ts:12-15`](../../apps/api/src/shared/purge.ts#L12-L15), [`fase-8c:45`](../../specs/plans/2026-07-26-fase-8c-lixeira.md)): "expurgar não apaga filhos. Filho `RESTRICT` presente → `409` com a instrução do que expurgar antes." A mesclagem é o contorno de produto para essa recusa — religa e arquiva; não deve inventar cascata.
- **A trilha commita junto com a mudança — e some junto no erro** ([`fase-8 research:398`](../../specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md)): "Vantagem: a trilha commita junto. Armadilha: se o handler lançar, o registro de auditoria some junto." Uma importação de 500 linhas numa transação de request perde tudo no erro da linha 499.
- **A pergunta "1 evento agregado ou N" ficou aberta na Fase 8** ([`:454`](../../specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md)) e a Fase 14 a reabre nos dois casos mais extremos do projeto (import de N clientes, merge que move N filhos). O mesmo documento questionou explicitamente se `document` deve ficar fora do `diff` persistido — hoje está fora.
- **Permissão destrutiva não ganha backfill** ([`fase-8c:339`](../../specs/plans/2026-07-26-fase-8c-lixeira.md)): "`lixeira:expurgar` é destrutiva — conceder automaticamente seria o oposto do desejado. Owner e papel `system` recebem em runtime. Registrar a exceção ao Padrão 3 no PR." `cliente:mesclar` e `dados:importar` seguem esse molde; `dados:exportar` provavelmente segue o Padrão 3 normal.
- **A permissão do ato não é a do módulo** ([`fase-8c:519-531`](../../specs/plans/2026-07-26-fase-8c-lixeira.md)): "quem gerencia oportunidades pode arquivar, mas apagar de vez é uma decisão de governança". Mesclar é irreversível e reescreve registro financeiro — pelo precedente, não deve viajar em `cliente:gerenciar`.
- **"Incluir arquivados" nas listagens normais foi recusado** ([`fase-8c:49`](../../specs/plans/2026-07-26-fase-8c-lixeira.md)): "o único lugar de ver arquivado é `/lixeira`". Logo, exportação de listagem e busca global **não** incluem arquivados.
- **Cron que apaga dado de negócio sozinho é decisão de produto** ([`fase-8c:46`](../../specs/plans/2026-07-26-fase-8c-lixeira.md)). Se a importação criar tabela de staging com expurgo automático, isso é decisão explícita, não detalhe de implementação.
- **`Contact` não tem `createdAt` nem `updatedAt`** ([`fase-8c:29,408`](../../specs/plans/2026-07-26-fase-8c-lixeira.md)) — import/export de contatos não pode ordenar nem deduplicar por data de criação.
- **A exceção arquitetural do front já tem precedente e justificativa**: a lixeira importa o `*.api.ts` de cinco features, contra a regra "uma feature não importa o interior de outra", com comentário no arquivo ([`fase-8c:709,869`](../../specs/plans/2026-07-26-fase-8c-lixeira.md)). Busca global e exportação batem na mesma parede; a alternativa registrada é "mover os `*.api.ts` para `lib/`, refatoração maior".
- **`SPEC.md` §3.1 já fecha o que sustenta esta fase**: CPF/CNPJ "opcional, validado quando informado" (`:74`) — daí o índice parcial; "cliente não pode ser excluído se tiver proposta ou projeto vinculado → usar arquivamento" (`:85`) — daí a mesclagem religar em vez de apagar; e a ficha exibe "dados, contatos, timeline, propostas, projetos/demandas e contratos" (`:86`), que é exatamente a lista do que o merge move. **A seção §4 (Modelo de Dados) do SPEC está defasada** e já foi registrada como tal ([`fase-8 research:388`](../../specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md)) — trate `schema.prisma` como fonte.
- **Sobreposições a vigiar.** (a) **Fase 13** declara que campos customizados entram "nos formulários, nos filtros **e na exportação**" e que tudo passa "a se montar a partir de definição, não de código" ([`ROADMAP.md:355,363`](../../ROADMAP.md#L355)) — e a 13 vem **antes** da 14 na ordem: um exportador com colunas hardcoded nasce para ser reescrito. (b) **Fase 10** depende do export para relatórios ([`:302`](../../ROADMAP.md#L302)). (c) **Fase 19** tem "exportar e excluir dados do titular" (LGPD, [`:464`](../../ROADMAP.md#L464)) — é outra coisa, e a fronteira merece uma linha no plano. (d) **Fase 17** (entrada de lead por webhook) precisará de dedup na criação — a detecção desta fase é a base dela. (e) A **Fase 9** define a cadeia de derivação de responsável para entidades sem `assigneeId` (`Proposal → Client.assigneeId`, `Payment → Contract → Client`); se o export quiser recortar proposta/cobrança por responsável, esse precedente nasce lá.
- **Git.** As 18 migrations seguem `AAAAMMDDHHMMSS_descricao_em_ingles` com `HHMMSS=100000`, um dia por migration, SQL à mão com comentários pt-BR. A última é `20260730100000_soft_delete_lixeira` (commit `1ad972d`), então **o próximo número livre hoje é `20260731100000`** — mas a Fase 9 (PRD escrito, não implementado) e a Fase 13 devem entrar antes. Outros commits que restringem: `c1d15ae` ("esconde os registros arquivados de todas as leituras" — toda leitura nova nasce obrigada a filtrar `archivedAt: null`), `8d58edd` (AuditLog imutável para a aplicação), `6dc6220` ("exige spec sem mock para classe de infraestrutura" — o parser de planilha cai nessa regra), `b9b0ad2` (ownerId denormalizado), `5509cac` (`normalizarRota()` já normaliza rotas novas no log de acesso).
- **Working tree pendente** (`git status`): `ROADMAP.md` modificado (troca de posição das fases 9↔10; o bloco da Fase 14 está intacto), `specs/plans/2026-07-26-fase-7b-…md` com uma linha alterada, e `specs/research/2026-07-27-fase-9-…md` **não commitado**. Nada disso bloqueia a Fase 14, mas o número da migration depende de quem commitar primeiro.
- **Não existe ADR no repositório.** As decisões vivem em quatro lugares por convenção: `SPEC.md §8` (defasado), as notas `>` de cada fase do `ROADMAP.md`, a seção *What We're NOT Doing* de cada plano, e a seção *Decisões fechadas* dos PRDs. Comentários de bloco no código ([`audit.module.ts:8-16`](../../apps/api/src/modules/audit/audit.module.ts#L8-L16), [`trash.service.ts:9-15`](../../apps/api/src/modules/trash/application/trash.service.ts#L9-L15)) e nas migrations fazem o papel de ADR local.

## Constraints & Considerations

**Transação e orçamento de 5s**
- `prisma.db` dentro do request é `Prisma.TransactionClient` ([`prisma.service.ts:53-55`](../../apps/api/src/prisma/prisma.service.ts#L53-L55)) — **sem `$transaction`**. A mesclagem ganha atomicidade de graça; a importação perde a possibilidade de commit parcial.
- `timeout` 5000ms / `maxWait` 2000ms (defaults do Prisma; nunca configurados). Grep por `transactionOptions|maxWait|timeout` em `apps/api/src` → zero. Mudar isso é global.
- Não existe `createMany` em nenhum lugar do `apps/api/src`. O único padrão de escrita em lote hoje é loop de `update` ([`prisma-client.repository.ts:156`](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts#L156), remoção de tag).
- `PrismaAdminService` é a única porta para trabalho fora do request — mas é `crm_user` **superuser que bypassa RLS**, então o `ownerId` passa a ser responsabilidade do código.

**Banco e RLS**
- Policies `owner_isolation` `FOR ALL` com `USING` = `WITH CHECK` = `"ownerId" = current_setting('app.owner_id', true)`, com `FORCE ROW LEVEL SECURITY`, **fail-closed** (GUC ausente → NULL → zero linhas, sem erro) — [`20260724050000_enable_rls`](../../apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql).
- `crm_app` não tem DDL: a importação **não pode** criar índice nem tabela temporária de trabalho em runtime.
- `CREATE EXTENSION` exige superuser e funciona nas migrations (`crm_user`). Ponha os três (`pg_trgm`, `unaccent`, `btree_gin`) numa migration dedicada, **antes** das que criam índices.
- Índice único de `document` tem de ser **parcial** (`WHERE "document" IS NOT NULL`) e **por owner** — e só entra depois da reconciliação das duplicatas existentes.
- `Contact.isPrimary` não tem constraint; `Client.email`/`phone` não têm índice nenhum hoje. Detecção de duplicidade por e-mail/telefone sem índice é seq scan sob `ownerId`.

**Segurança e vazamento**
- **O recorte por responsável não é protegido pelo banco.** Qualquer `$queryRaw` ou exportador que não receba e aplique o `AssigneeScope` vaza registros com o RLS ligado. Risco número um.
- Busca global cruza fronteiras de permissão: sem `financeiro:ver`, contratos **não** podem aparecer. O molde é o `GET /dashboard/summary` (devolve `null` por bloco).
- CSV injection no export; zip bomb e magic-number no import.
- `document` está em `CAMPOS_OMITIDOS` do diff ([`audit-diff.ts:10-30`](../../apps/api/src/shared/audit-diff.ts#L10-L30)); `AuditLog` é append-only (`REVOKE UPDATE, DELETE`), então o payload precisa estar completo no `INSERT` — não há "grava provisório e atualiza depois".
- Log estruturado: **nome de cliente e documento não entram em `msg`** — "o Grafana é publicado na internet e a linha vive 30 dias" ([`docs/observabilidade.md:149-152`](../../docs/observabilidade.md)). Contagem e nome de arquivo, sim; dado pessoal, não. Evento novo em `substantivo.acao_no_passado` e **estável** (renomear quebra a contagem histórica).

**HTTP e web**
- Um export em streaming mantém a transação do request aberta durante o download (`await lastValueFrom(next.handle())`) — segura conexão do pool e gera bloat de vacuum. Teto de linhas explícito, ou geração assíncrona.
- `ValidationPipe` global com `whitelist: true, forbidNonWhitelisted: true`: query param ou campo de form não declarado no DTO → `400`.
- `paramsSerializer: { indexes: null }` no axios ([`lib/api.ts:5-12`](../../apps/web/src/lib/api.ts#L5-L12)) — arrays viram `status=A&status=B`.
- O interceptor de resposta não toca o body, então `responseType: 'blob'` funciona — mas o `401` com refresh em fila reexecuta o request original ([`api.ts:39-61`](../../apps/web/src/lib/api.ts#L39-L61)); confirme que um download reexecutado não duplica efeito.
- **O design system não tem**: upload/dropzone, stepper/wizard, progress bar, command palette (`cmdk` ausente), seleção de linhas em tabela (`@tanstack/react-table` ausente). `table.tsx` tem o *estilo* de seleção pronto (`data-[state=selected]:bg-muted`, `:43`) mas nenhuma lógica. `Cmd+K` está livre — o único atalho registrado é `Cmd+B` do sidebar ([`sidebar.tsx:33,98-111`](../../apps/web/src/components/ui/sidebar.tsx#L33)).
- **Não existe mapa inverso de rótulo → enum** em `labels.ts`, e ele tem de ser **por enum**, não global: `'Tráfego pago'` é `LeadSource.PAID_TRAFFIC` **e** `ServiceType.PAID_TRAFFIC`; `'Ativo'` existe em três enums. O fallback de `make()` ([`labels.ts:11`](../../apps/web/src/lib/labels.ts#L11)) devolve o valor cru quando não há tradução.
- Modal sobre modal é proibido; o wizard de importação deve ser **página**, não diálogo empilhado — ou usar os primitivos que aplicam soterramento automático.

**Definition of Done (do template de PR)**
- Tudo pt-BR; enum novo traduzido em `labels.ts` no mesmo PR; `ENDPOINTS.md` no mesmo commit com os rótulos fixos (**Propósito / Auth / Body / Resposta / Erros / Handler**); log novo com `evento` e sem segredo; `pnpm --filter api test` e `build` verdes; mudança de modelo começando no `schema.prisma` com migration. Service testa por instanciação direta com `jest.Mocked<Repository>`; **classe de infraestrutura (o parser de planilha) tem spec que a instancia de verdade**.

## Open Questions

As três primeiras têm peso de desenho e deveriam ser respondidas antes do `/spec`. As demais podem ser decididas no plano.

1. **A importação cabe em uma requisição de 5s, ou vira trabalho assíncrono?** Um lote de 500 clientes com validação de CPF/CNPJ e checagem de duplicidade linha a linha não cabe com folga, e o caminho normal não permite commit parcial. As opções são: (a) teto baixo de linhas por requisição (ex.: 200) e a interface fatia o arquivo; (b) subir `transactionOptions.timeout` globalmente — afeta todas as rotas; (c) job assíncrono via `PrismaAdminService`, que bypassa RLS e transfere o isolamento para o código. **Recomendação:** (a) para a primeira entrega — é a única que não afrouxa uma garantia global nem abre mão do RLS; o teto vira mensagem em pt-BR no relatório de erros. Registrar (c) como evolução se o volume real exigir.
2. **Exportação: genérica ou por módulo?** "Qualquer listagem respeitando filtros e permissões" empurra para um exportador genérico; mas o filtro, a permissão e o recorte por responsável vivem no módulo dono, e um exportador que os reimplemente é exatamente onde o vazamento acontece (o recorte não é protegido pelo banco). **Recomendação:** rota de export **no módulo dono**, reusando o mesmo `filter`+`scope` da listagem, com a serialização CSV/XLSX num serviço compartilhado. Isso mantém a garantia de permissão onde ela já é testada, e ainda atende a Fase 10 (o relatório exporta pelo seu próprio módulo). Custo: N rotas em vez de uma.
3. **Mesclagem: a trilha grava 1 evento ou N?** Precedentes divergem por motivo declarado — agregado em [`contracts.service.ts:234-236`](../../apps/api/src/modules/finance/application/contracts.service.ts#L234-L236), N eventos nos crons. **Recomendação:** 1 evento `MESCLAR` no cliente vencedor com `extra` contando o que foi movido, **mais** 1 evento no absorvido (para quem abrir o histórico dele entender para onde o registro foi) — o `entityId` do `AuditLog` não tem FK justamente para a trilha sobreviver ao registro. Não gravar N eventos por filho movido.
4. **O `document` entra no diff da mesclagem?** Hoje está em `CAMPOS_OMITIDOS`, e a duplicata é causada exatamente por ele. **Recomendação:** manter fora do `diff` e registrar no `extra` apenas os **últimos 4 dígitos** ou um booleano `documentosConflitantes` — a trilha fica útil sem publicar CPF na tabela.
5. **A mesclagem arquiva o absorvido ou o expurga?** Arquivar preserva a possibilidade de auditar; expurgar é o que o usuário espera de "mesclar". **Recomendação:** arquivar (o `countChildren` já será 0, então o expurgo posterior é permitido pelas guardas atuais e fica como decisão separada do usuário na lixeira).
6. **Qual estratégia de índice por entidade?** trigram em tudo é mais simples e cobre substring/typo; tsvector rende ranking e stemming, mas só compensa em texto livre longo. **Recomendação:** trigram nas 6 entidades na primeira entrega (e o efeito colateral gratuito de acelerar os `ILIKE` que já existem); tsvector só se a busca em `description`/`notes` entrar no escopo.
7. **Nomes das chaves de permissão.** `dados:importar` / `dados:exportar` / `cliente:mesclar`, em qual categoria? `Organização` é onde `lixeira:*` e `auditoria:ver` moram, mas exportar é ação de quem usa o módulo, não de governança. Pode ser que `dados:exportar` não deva existir como chave separada (quem pode ver a listagem pode exportá-la).
8. **A prévia da importação persiste?** Se o mapeamento e a amostra ficarem só em memória do cliente, o commit reenvia o arquivo. Se persistirem, isso é tabela de staging — e política de expurgo dela é decisão de produto pelo precedente da Fase 8.

## Code References Index

**Transação, RLS, Prisma**
- [`prisma/owner-context.interceptor.ts:43-51`](../../apps/api/src/prisma/owner-context.interceptor.ts#L43-L51) — transação por request + `set_config('app.owner_id')`
- [`prisma/prisma.service.ts:53-55`](../../apps/api/src/prisma/prisma.service.ts#L53-L55) — `db` devolve `TransactionClient` (sem `$transaction`)
- [`prisma/prisma-admin.service.ts:11-27`](../../apps/api/src/prisma/prisma-admin.service.ts#L11-L27) — client `crm_user` que bypassa RLS
- [`migrations/20260724050000_enable_rls/migration.sql`](../../apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql) — policies `FORCE`, fail-closed
- [`migrations/20260724040000_create_app_role/migration.sql`](../../apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql) — `crm_app` sem DDL, sem BYPASSRLS
- [`migrations/20260724025450_denormalize_owner_id/migration.sql`](../../apps/api/prisma/migrations/20260724025450_denormalize_owner_id/migration.sql) — `ownerId` nas filhas
- [`migrations/20260730100000_soft_delete_lixeira/migration.sql`](../../apps/api/prisma/migrations/20260730100000_soft_delete_lixeira/migration.sql) — última migration; "sem cascata", FKs seguem RESTRICT

**Cliente, duplicidade, FKs**
- [`clients/application/clients.service.ts:163-180`](../../apps/api/src/modules/clients/application/clients.service.ts#L163-L180) — `resolveDocument` com `exceptId`
- [`clients/application/clients.service.ts:95-141`](../../apps/api/src/modules/clients/application/clients.service.ts#L95-L141) — archive/restore/purge, sem cascata
- [`clients/infra/prisma-client.repository.ts:101-134`](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts#L101-L134) — `countChildren`: as 6 FKs
- [`clients/infra/prisma-client.repository.ts:38-69`](../../apps/api/src/modules/clients/infra/prisma-client.repository.ts#L38-L69) — `where` com `OR` de busca + `AND` de recorte
- [`shared/document.ts`](../../apps/api/src/shared/document.ts) — `isValidCPF`/`isValidCNPJ`/`isValidDocument`
- [`schema.prisma:168-226`](../../apps/api/prisma/schema.prisma#L168-L226) — `Client` e `Contact`; `document` sem `@unique`; `isPrimary` sem constraint

**Permissão, recorte, agregação**
- [`shared/record-scope.ts:41-62`](../../apps/api/src/shared/record-scope.ts#L41-L62) — `AND`, nunca spread; recorte não é RLS
- [`shared/permissions.ts`](../../apps/api/src/shared/permissions.ts) — catálogo de 20 chaves; nenhuma de import/export/merge
- [`modules/access/access.guard.ts:64-77`](../../apps/api/src/modules/access/access.guard.ts#L64-L77) — chaves como "ou"
- [`modules/dashboard/api/dashboard.controller.ts:21-30`](../../apps/api/src/modules/dashboard/api/dashboard.controller.ts#L21-L30) — rota transversal devolve `null` por bloco
- [`modules/trash/infra/prisma-trash.repository.ts:35-54`](../../apps/api/src/modules/trash/infra/prisma-trash.repository.ts#L35-L54) — read model de 5 tabelas (molde da busca)
- [`shared/purge.ts:12-28`](../../apps/api/src/shared/purge.ts#L12-L28) — `422`/`409` e a regra "nenhuma cascata"
- [`shared/soft-delete.ts:12-17`](../../apps/api/src/shared/soft-delete.ts#L12-L17) — `ATIVO`/`ativoWhere`

**Trilha de auditoria**
- [`modules/audit/audit.service.ts:13-24,58,95`](../../apps/api/src/modules/audit/audit.service.ts#L13-L24) — `EntradaDeAuditoria`, `registrar`, `registrarPeloSistema`
- [`shared/audit-diff.ts:10-30,63-80`](../../apps/api/src/shared/audit-diff.ts#L10-L30) — `CAMPOS_OMITIDOS` (inclui `document`) e `calcularDiff`
- [`migrations/20260729100000_audit_log/migration.sql:65`](../../apps/api/prisma/migrations/20260729100000_audit_log/migration.sql#L65) — `REVOKE UPDATE, DELETE`
- [`finance/application/contracts.service.ts:234-245`](../../apps/api/src/modules/finance/application/contracts.service.ts#L234-L245) — evento agregado
- [`finance/application/finance-billing.job.ts:34-46`](../../apps/api/src/modules/finance/application/finance-billing.job.ts#L34-L46) — 1 evento por linha
- [`schema.prisma:598-635`](../../apps/api/prisma/schema.prisma#L598-L635) — `AuditEntity`/`AuditAction` (sem `MESCLAR`/`IMPORTAR`)

**Listagem, paginação, busca atual**
- [`shared/pagination.ts`](../../apps/api/src/shared/pagination.ts) — `normalizePage`/`paginated`, `MAX_LIMIT = 100`
- [`shared/dto/pagination-query.dto.ts:5`](../../apps/api/src/shared/dto/pagination-query.dto.ts#L5) — DTO base de todas as listagens
- [`finance/infra/prisma-payment.repository.ts:41-107,134-158`](../../apps/api/src/modules/finance/infra/prisma-payment.repository.ts#L41-L107) — `where` duplicado (Prisma + `Prisma.sql`)
- [`finance/domain/payment.repository.ts:32-40`](../../apps/api/src/modules/finance/domain/payment.repository.ts#L32-L40) — `PAYMENT_SORT_FIELDS`
- [`main.ts:75-79`](../../apps/api/src/main.ts#L75-L79) — `ValidationPipe` com `forbidNonWhitelisted`

**Web**
- [`lib/api.ts:5-63`](../../apps/web/src/lib/api.ts#L5-L63) — axios, refresh em fila, `paramsSerializer`
- [`lib/query-keys.ts`](../../apps/web/src/lib/query-keys.ts) — convenção central de chaves
- [`lib/labels.ts:9-12`](../../apps/web/src/lib/labels.ts#L9-L12) — `make()`; 18 tradutores, nenhum inverso
- [`lib/format.ts:19-54`](../../apps/web/src/lib/format.ts#L19-L54) — máscara na exibição, dígitos na persistência
- [`hooks/use-url-filters.ts:17-121`](../../apps/web/src/hooks/use-url-filters.ts#L17-L121) — codecs de filtro na URL
- [`features/clientes/ClientesListPage.tsx:65-70,126,139-166`](../../apps/web/src/features/clientes/ClientesListPage.tsx#L65-L70) — toolbar, filtros, params da query
- [`features/clientes/ClientFormDialog.tsx:45-67`](../../apps/web/src/features/clientes/ClientFormDialog.tsx#L45-L67) — Zod do cliente (sem validação de documento)
- [`app/AppLayout.tsx:118-120`](../../apps/web/src/app/AppLayout.tsx#L118-L120) — vão vazio do header (busca global)
- [`components/ui/sidebar.tsx:33,98-111`](../../apps/web/src/components/ui/sidebar.tsx#L33) — único atalho registrado (`Cmd+B`)
- [`hooks/use-can.ts:13-32`](../../apps/web/src/hooks/use-can.ts#L13-L32) — `can`/`canAny`
- [`features/lixeira/LixeiraPage.tsx:166-175`](../../apps/web/src/features/lixeira/LixeiraPage.tsx#L166-L175) — ação escondida por permissão

**Infra e docs**
- [`docker-compose.yml`](../../docker-compose.yml) / [`docker-compose.prod.yml`](../../docker-compose.prod.yml) — `postgres:16-alpine` nos dois
- [`apps/api/docker/entrypoint.sh:37`](../../apps/api/docker/entrypoint.sh#L37) — `migrate deploy` como `crm_user` (superuser)
- [`docs/observabilidade.md:145-174`](../../docs/observabilidade.md) — `evento` estável, `msg` não é redigido, "o log não é a trilha"
- [`ROADMAP.md:367-385`](../../ROADMAP.md#L367-L385) — escopo e nota de complexidade da fase
