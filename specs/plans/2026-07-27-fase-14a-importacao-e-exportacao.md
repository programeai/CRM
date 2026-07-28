---
date: 2026-07-27T20:55:38-03:00
author: claude
source_prd: specs/research/2026-07-27-fase-14-dados-importacao-exportacao-busca-duplicidade.md
git_commit: 9b90bb6e8167b859b6136a49be0c30f5b30ac8ab
branch: main
status: draft
tags: [spec, dados, importacao, exportacao, clients, contacts, finance, catalogos]
---

# Spec: Fase 14-A — Importação e exportação de dados

## Overview

O CRM nunca leu nem escreveu um arquivo. Não há upload em nenhuma camada, não há
`Content-Disposition` em nenhuma resposta, e `ENDPOINTS.md` não tem uma única rota de
exportação. Esta fase abre as duas pontas: o owner traz a base que já tem (planilha de
clientes e planilha de contatos) e leva embora o que está no sistema (listagem de clientes,
contratos e cobranças, respeitando filtro, permissão e recorte por responsável).

A estratégia é ditada por duas restrições que já existem e que não vamos afrouxar. A
primeira: toda requisição autenticada roda dentro de uma `$transaction` sem opções aberta
pelo `OwnerContextInterceptor`, o que dá **5 segundos de orçamento** e nenhuma possibilidade
de commit parcial — daí o teto de 500 linhas por importação e a serialização em memória (com
teto) em vez de streaming. A segunda: **o recorte por responsável não é protegido pelo
banco** — o RLS só conhece `ownerId`. Por isso a exportação não é um endpoint genérico: cada
rota de export vive no módulo dono e reusa o mesmo `filter` + `scope` que a listagem já
aplica e que já é testado. A serialização (CSV/XLSX, escapatória de fórmula, nome de arquivo)
é a única parte compartilhada.

A ordem das fases põe a metade sem risco primeiro: exportação é leitura pura e entrega valor
sozinha; a importação vem depois, dividida entre o caminho que **não grava nada** (prévia) e o
que grava (commit), para que o desenho mais delicado — mapeamento de coluna, resolução de
origem contra o catálogo do owner, relatório de erro linha a linha — seja exercitado antes de
qualquer `INSERT`.

## Current State

Resumo do que o PRD levantou e que foi reconfirmado no código em `9b90bb6`:

- **Zero I/O de arquivo.** `multer@2.2.0` já está no lockfile (transitivo de
  `@nestjs/platform-express@11`); falta só `@types/multer`.
- **Transação por request** — [owner-context.interceptor.ts:43-51](apps/api/src/prisma/owner-context.interceptor.ts#L43-L51); `prisma.db` devolve `Prisma.TransactionClient`, que não tem `$transaction` ([prisma.service.ts:53-55](apps/api/src/prisma/prisma.service.ts#L53-L55)).
- **`resolveDocument`** ([clients.service.ts:239-261](apps/api/src/modules/clients/application/clients.service.ts#L239-L261)) valida CPF/CNPJ, deduz `personType` e checa unicidade — reusável como está.
- **Catálogos por owner** (Fase 13-A): `Client.sourceId` → `LeadSourceCatalog`, `@@unique([ownerId, name])`, `CatalogosService.list/create/assertUtilizavel` prontos.
- **Recorte por responsável** vive só no código ([record-scope.ts](apps/api/src/shared/record-scope.ts)); compõe-se com `AND`, nunca por spread.
- 22 permissões, 22 policies de RLS, 28 migrations (a última é `20260809100000_notification_lead_received`, da Fase 17, ainda **não commitada** na árvore de trabalho).

**Três correções ao PRD, verificadas no código:**

1. **O próximo número de migration é `20260810100000`, não `20260809100000`.** A Fase 17 já
   ocupou o `20260809`. Confira antes de criar a pasta.
2. **A armadilha do "UUID cru na planilha" já está fechada.** Os seis repositórios de listagem
   já fazem `include` das relações de catálogo (`source`, `serviceType`, `lostReason`, `type`)
   — o exportador recebe `source.name` sem tocar em repositório nenhum.
3. **Contatos não têm listagem própria.** A rota é `GET /clients/:clientId/contacts` e
   `Contact` não tem `createdAt`. Não existe "exportar a listagem de contatos"; a importação
   de contatos casa com um cliente já existente.

## Desired End State

**API**
- `GET /clients/export`, `GET /contracts/export`, `GET /payments/export` devolvem um arquivo
  CSV ou XLSX com exatamente as linhas que a listagem devolveria com os mesmos filtros, o
  mesmo recorte por responsável e a mesma permissão. Acima de 5.000 linhas, `422` em pt-BR
  pedindo para refinar o filtro — nunca truncagem silenciosa.
- `POST /data/import/previa` recebe planilha + tipo (`clientes` | `contatos`) e devolve
  colunas detectadas, mapeamento sugerido, amostra, origens desconhecidas e erros linha a
  linha. **Não grava nada.**
- `POST /data/import` recebe a mesma planilha + o mapeamento e a decisão sobre cada origem
  desconhecida, grava dentro da transação do request e devolve o relatório. Teto de 500 linhas.
- Uma permissão nova: `dados:importar` (categoria Organização, sem backfill). Exportação
  **não** tem chave própria — herda a da listagem.
- Um valor novo em `AuditEntity` (`IMPORT`) e um em `AuditAction` (`IMPORTAR`); uma
  importação registra **um** evento agregado.

**Web**
- Botão "Exportar ▾ (CSV / XLSX)" nas toolbars de Clientes, Contratos e Recebimentos,
  enviando o mesmo objeto de params que já alimenta a query.
- Página `/importacao` (Organização, gated por `dados:importar`) com o wizard de quatro
  passos: arquivo → mapeamento de colunas → origens desconhecidas → prévia e confirmação.

## What We're NOT Doing

- **Busca global e detecção de duplicidade (14-B)** e **mesclagem + unicidade de `document`
  (14-C)** — recortadas pela trilha de produção. Nada neste plano cria índice full-text,
  extensão do Postgres, `client-merge.service` ou índice único parcial.
- **Exportação das outras cinco listagens** (oportunidades, propostas, projetos, demandas,
  timeline). Entram numa fase seguinte reusando `ExportService` e o tipo `ExportColumn<T>`
  sem mudança — o custo por listagem passa a ser um mapa de colunas e uma rota.
- **Importação de qualquer entidade que não seja cliente ou contato.** Timeline em especial
  fica fora: `ActivityTypeCatalog.isFollowUp` é regra (cron de lembrete, dashboard), não
  rótulo, e importar atividade exigiria decidir sobre ela.
- **Tabela de staging.** A prévia não persiste; o commit reenvia o arquivo. Isso mantém as 22
  policies de RLS intactas e evita a decisão de produto sobre expurgo automático que a Fase 8
  registrou como não-trivial.
- **Job assíncrono / fila.** Registrado como evolução se o volume real exigir; hoje custaria
  `PrismaAdminService` (que bypassa RLS) e transferiria o isolamento para o código.
- **Barra de progresso.** Uma requisição só, sem etapas observáveis do lado do cliente — um
  spinner no botão basta. Não criar `components/ui/progress.tsx`.
- **`personType` na planilha.** É deduzido do documento desde `b212eb6`. Uma coluna "Tipo de
  pessoa" na planilha é ignorada de propósito.
- **Colunas customizadas no exportador.** A Fase 13-B (campos customizados) foi adiada; as
  colunas nascem fixas, no código do módulo dono. Quando a 13-B entrar, o mapa de colunas
  passa a se montar a partir de definição — o `ExportColumn<T>` já é a forma certa para isso.

---

## Fase 1: Exportação — escrita de planilha, três rotas e o botão

### Goal

O dado sai do sistema: qualquer listagem de Clientes, Contratos ou Recebimentos vira CSV ou
XLSX com os filtros e o recorte que a tela já aplica.

### Changes

#### Dependências

**Modify**: `apps/api/package.json`

```
pnpm --filter api add csv-stringify@^6.8.1 write-excel-file@^4.1.1
```

Ambos MIT e ativos (publicados em 2026). Ambos são `"type": "module"` mas exportam entrada
CJS na condição `require`, que é o que o `module: nodenext` do `apps/api` (pacote CJS) vai
resolver. A API real de `write-excel-file@4.1.1` foi conferida nos `.d.ts` do pacote e é a do
rewrite: `writeXlsxFile(objects, { columns }).toBuffer()` — **não** o antigo `{ schema, buffer: true }`
que a documentação de versões anteriores descreve.

#### Contrato compartilhado da exportação

**Create**: `apps/api/src/shared/export.ts`

Fica em `shared/` pelo mesmo motivo de [`record-scope.ts`](apps/api/src/shared/record-scope.ts): é um contrato que
três módulos de negócio usam. A *implementação* (serialização) é do `DataModule`; aqui está
só a forma.

```ts
import { UnprocessableEntityException } from '@nestjs/common';

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Teto de linhas de uma exportação. Existe porque a resposta é montada em
 * memória **dentro da transação do request** (5s de orçamento): streaming
 * manteria a transação aberta durante todo o download, segurando conexão do
 * pool. Acima do teto a resposta é 422 com instrução — nunca truncagem
 * silenciosa, que se leria como "exportei tudo".
 */
export const MAX_EXPORT_ROWS = 5000;

/**
 * Uma coluna da planilha exportada. O `value` devolve o valor **já legível**:
 * o rótulo pt-BR do enum, o `name` do item de catálogo, o número como número.
 * Nada de identificador técnico na planilha do usuário (regra do CLAUDE.md).
 *
 * O tipo do retorno importa: só `string` recebe a escapatória de fórmula do
 * CSV — prefixar um número negativo com `'` o transformaria em texto.
 */
export interface ExportColumn<T> {
  /** Cabeçalho em pt-BR. É o que o usuário vê na primeira linha. */
  header: string;
  value: (row: T) => string | number | Date | null;
  /** Largura da coluna no XLSX, em caracteres. Ignorada no CSV. */
  width?: number;
}

export function assertCabeNaExportacao(total: number): void {
  if (total > MAX_EXPORT_ROWS) {
    throw new UnprocessableEntityException(
      `A exportação está limitada a ${MAX_EXPORT_ROWS.toLocaleString('pt-BR')} linhas e o filtro atual seleciona ${total.toLocaleString('pt-BR')}. Refine os filtros e tente de novo.`,
    );
  }
}
```

**Create**: `apps/api/src/modules/data/infra/spreadsheet.writer.ts`

Classe de infraestrutura → **spec que a instancia de verdade**, sem mock (commit `6dc6220`).
É também o ponto único da escapatória de CSV injection.

```ts
import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import writeXlsxFile from 'write-excel-file/node';
import type { ExportColumn } from '../../../shared/export';

/**
 * Célula de texto começando por estes caracteres é interpretada como fórmula
 * pelo Excel e pelo LibreOffice. Prefixar com apóstrofo neutraliza sem perder
 * o conteúdo. Vale só para texto: o valor numérico -100 é número, não fórmula.
 */
const GATILHOS_DE_FORMULA = ['=', '+', '-', '@', '\t', '\r'];

@Injectable()
export class SpreadsheetWriter {
  /** Delimitador `;` e BOM: é o que o Excel em pt-BR abre sem assistente de importação. */
  csv<T>(linhas: T[], colunas: ExportColumn<T>[]): Buffer {
    const registros = linhas.map((linha) =>
      colunas.map((coluna) => this.paraTextoCsv(coluna.value(linha))),
    );
    const texto = stringify(registros, {
      header: true,
      columns: colunas.map((c) => c.header),
      delimiter: ';',
      bom: true,
      record_delimiter: '\r\n',
    });
    return Buffer.from(texto, 'utf8');
  }

  /**
   * XLSX com tipo real por célula — data é data e número é número, então o
   * Excel soma e ordena sem o usuário reconverter nada. Sem escapatória de
   * fórmula: o XLSX distingue `t="s"` (texto) de fórmula na própria estrutura.
   */
  async xlsx<T>(linhas: T[], colunas: ExportColumn<T>[]): Promise<Buffer> {
    return writeXlsxFile(linhas, {
      columns: colunas.map((coluna) => ({
        header: coluna.header,
        width: coluna.width ?? 22,
        cell: (linha: T) => this.celulaXlsx(coluna.value(linha)),
      })),
    }).toBuffer();
  }

  private celulaXlsx(valor: string | number | Date | null) {
    if (valor === null || valor === '') return { value: null, type: String };
    if (valor instanceof Date)
      return { value: valor, type: Date, format: 'dd/mm/yyyy' };
    if (typeof valor === 'number')
      return { value: valor, type: Number, format: '#,##0.00' };
    return { value: valor, type: String };
  }

  /** Texto pt-BR: data `dd/MM/aaaa`, decimal com vírgula, fórmula neutralizada. */
  private paraTextoCsv(valor: string | number | Date | null): string {
    if (valor === null) return '';
    if (valor instanceof Date) return valor.toLocaleDateString('pt-BR');
    if (typeof valor === 'number')
      return valor.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    return GATILHOS_DE_FORMULA.some((g) => valor.startsWith(g))
      ? `'${valor}`
      : valor;
  }
}
```

**Create**: `apps/api/src/modules/data/infra/spreadsheet.writer.spec.ts`

Instancia a classe de verdade (`new SpreadsheetWriter()`) e afirma sobre o buffer produzido:

- CSV começa com BOM (`﻿`) e usa `;`.
- Célula de texto `=SOMA(A1:A9)` sai como `'=SOMA(A1:A9)`; o número `-1500` sai como `-1.500,00` **sem** apóstrofo.
- Data sai como `dd/MM/aaaa`.
- `null` vira célula vazia.
- XLSX: o buffer começa com a assinatura de zip `PK\x03\x04` e tem tamanho > 0. (Não vale reabrir o arquivo aqui — a leitura de XLSX chega na Fase 2 e aí o teste de ida-e-volta fica honesto.)

**Create**: `apps/api/src/modules/data/application/export.service.ts`

```ts
import { Injectable, StreamableFile } from '@nestjs/common';
import type { ExportColumn, ExportFormat } from '../../../shared/export';
import { SpreadsheetWriter } from '../infra/spreadsheet.writer';

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

@Injectable()
export class ExportService {
  constructor(private readonly writer: SpreadsheetWriter) {}

  /**
   * Serializa as linhas que o módulo dono já filtrou. Devolve `StreamableFile`
   * sobre um Buffer **já pronto**: quando o interceptor commita a transação do
   * request, não há mais trabalho de banco pendente — é o que impede o download
   * de segurar a transação aberta.
   */
  async gerar<T>(
    linhas: T[],
    colunas: ExportColumn<T>[],
    formato: ExportFormat,
    nomeBase: string,
  ): Promise<StreamableFile> {
    const buffer =
      formato === 'csv'
        ? this.writer.csv(linhas, colunas)
        : await this.writer.xlsx(linhas, colunas);
    const dia = new Date().toISOString().slice(0, 10);
    return new StreamableFile(buffer, {
      type: CONTENT_TYPE[formato],
      disposition: `attachment; filename="${nomeBase}-${dia}.${formato}"`,
      length: buffer.byteLength,
    });
  }
}
```

**Create**: `apps/api/src/modules/data/data.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ExportService } from './application/export.service';
import { SpreadsheetWriter } from './infra/spreadsheet.writer';

/**
 * Módulo transversal de entrada e saída de dados. Não é módulo de negócio: não
 * tem tabela, e a fronteira que ele publica é o `ExportService`.
 *
 * A exportação é declarada **no módulo dono** de cada listagem, não aqui, e o
 * motivo é de segurança, não de organização: o recorte por responsável
 * (`AssigneeScope`) NÃO é protegido pelo RLS — o banco só conhece `ownerId`. Um
 * exportador genérico que remontasse o `where` seria exatamente onde o
 * vazamento aconteceria. Aqui mora só a serialização.
 */
@Module({
  providers: [SpreadsheetWriter, ExportService],
  exports: [ExportService],
})
export class DataModule {}
```

**Modify**: `apps/api/src/app.module.ts`
Registrar `DataModule` na lista de imports, logo depois de `CatalogosModule`.

#### Clientes

**Create**: `apps/api/src/modules/clients/application/client-export-columns.ts`

```ts
import type { ExportColumn } from '../../../shared/export';
import type { ClientWithAssignee } from '../domain/client.repository';

const STATUS: Record<string, string> = {
  LEAD: 'Lead',
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  LOST: 'Perdido',
};

/**
 * Colunas da planilha de clientes. Espelham os rótulos pt-BR da interface: o
 * `status` sai traduzido e a origem sai por `source.name` (o `include` já vem
 * do repositório) — `sourceId` cru seria um UUID na planilha do usuário.
 */
export const COLUNAS_DE_CLIENTE: ExportColumn<ClientWithAssignee>[] = [
  { header: 'Nome', value: (c) => c.name, width: 32 },
  { header: 'Nome fantasia', value: (c) => c.tradeName },
  { header: 'CPF/CNPJ', value: (c) => c.document },
  { header: 'E-mail', value: (c) => c.email, width: 28 },
  { header: 'Telefone', value: (c) => c.phone },
  { header: 'Site', value: (c) => c.website },
  { header: 'Status', value: (c) => STATUS[c.status] ?? c.status, width: 12 },
  { header: 'Origem', value: (c) => c.source?.name ?? null },
  { header: 'Responsável', value: (c) => c.assignee?.name ?? null },
  { header: 'Tags', value: (c) => c.tags.join(', ') },
  { header: 'CEP', value: (c) => c.zipCode },
  { header: 'Logradouro', value: (c) => c.street, width: 32 },
  { header: 'Número', value: (c) => c.number, width: 10 },
  { header: 'Complemento', value: (c) => c.complement },
  { header: 'Bairro', value: (c) => c.district },
  { header: 'Cidade', value: (c) => c.city },
  { header: 'UF', value: (c) => c.state, width: 6 },
  { header: 'Observações', value: (c) => c.notes, width: 40 },
  { header: 'Criado em', value: (c) => c.createdAt, width: 14 },
];
```

> **Nota para quem implementar:** `STATUS` duplica os rótulos de
> `apps/web/src/lib/labels.ts`. É deliberado e é a única duplicação aceita neste plano — o
> backend não importa do frontend, e `ClientStatus` é enum técnico fechado (não virou
> catálogo na 13-A). Se um valor for acrescentado ao enum, os dois lugares mudam no mesmo PR.

**Create**: `apps/api/src/modules/clients/api/dto/export-clients-query.dto.ts`

```ts
import { IsIn } from 'class-validator';
import { ListClientsQueryDto } from './list-clients-query.dto';
import { EXPORT_FORMATS, type ExportFormat } from '../../../../shared/export';

/**
 * Mesmos filtros da listagem + o formato. Herda `page`/`limit` do
 * `PaginationQueryDto`, que a exportação ignora — o `ValidationPipe` global tem
 * `forbidNonWhitelisted: true`, então declarar a herança é mais barato que
 * responder 400 para quem exportou estando na página 3.
 */
export class ExportClientsQueryDto extends ListClientsQueryDto {
  @IsIn(EXPORT_FORMATS, { message: 'Formato inválido: use csv ou xlsx.' })
  formato: ExportFormat;
}
```

**Modify**: `apps/api/src/modules/clients/api/clients.controller.ts`

A rota entra **junto do bloco de `tags`**, antes de `@Get(':id')` — senão `:id` a captura.

```ts
  // Rotas literais declaradas antes de `:id` para não serem capturadas por ele.
  @RequirePermission('cliente:ver', 'cliente:gerenciar')
  @Get('export')
  export(
    @CurrentAccess() access: AccessContext,
    @Query() query: ExportClientsQueryDto,
  ): Promise<StreamableFile> {
    return this.clients.export(
      access.ownerId,
      query,
      resolveAssigneeScope(access, 'cliente:ver_todos'),
    );
  }
```

**Modify**: `apps/api/src/modules/clients/application/clients.service.ts`

Injetar `ExportService` no construtor e acrescentar:

```ts
  /**
   * Exportação da listagem. Reusa o MESMO `filter` + `scope` de `list()` — é o
   * que garante que a planilha respeite o recorte por responsável, que o banco
   * não protege. O `take` alto substitui a paginação; o `total` do próprio
   * `findManyAndCount` diz se o filtro cabe no teto.
   */
  async export(
    ownerId: string,
    query: ExportClientsQueryDto,
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<StreamableFile> {
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      search: query.search,
      status: query.status,
      sourceId: query.sourceId,
      assigneeId: query.assigneeId,
      scope,
      skip: 0,
      take: MAX_EXPORT_ROWS,
    });
    assertCabeNaExportacao(total);
    return this.exporter.gerar(
      data,
      COLUNAS_DE_CLIENTE,
      query.formato,
      'clientes',
    );
  }
```

**Modify**: `apps/api/src/modules/clients/clients.module.ts`
Acrescentar `DataModule` aos `imports`.

**Modify**: `apps/api/src/modules/clients/application/clients.service.spec.ts`
Caso novo: `export` com `total > MAX_EXPORT_ROWS` lança `UnprocessableEntityException`; e
`export` passa o `scope` recebido adiante para o repositório (mock afirma o argumento) — é o
teste que impede a regressão de vazamento por responsável.

#### Contratos e cobranças

**Create**: `apps/api/src/modules/finance/application/contract-export-columns.ts`
**Create**: `apps/api/src/modules/finance/application/payment-export-columns.ts`

Mesma forma. Colunas propostas:

- **Contratos**: Cliente (`client.name`), Descrição, Regime (`translate` de `BillingType`),
  Status, Valor, Dia do vencimento, Início, Fim, Parcelas, Criado em.
- **Cobranças**: Cliente (`contract.client.name`), Contrato (`contract.description`),
  Descrição, Status (Pendente/Paga/Vencida/Cancelada), Vencimento, Valor, Valor pago, Pago em.

`Decimal` do Prisma **não** é `number`: converter com `Number(p.amount)` no `value`, ou o
`typeof valor === 'number'` do writer não casa e a célula sai como texto.

**Create**: `apps/api/src/modules/finance/api/dto/export-contracts-query.dto.ts`
**Create**: `apps/api/src/modules/finance/api/dto/export-payments-query.dto.ts`
Mesmo molde do DTO de clientes (herdam `ListContractsQueryDto` / `ListPaymentsQueryDto`).

**Modify**: `apps/api/src/modules/finance/api/contracts.controller.ts`
**Modify**: `apps/api/src/modules/finance/api/payments.controller.ts`

`@Get('export')` **antes** de `@Get(':id')` no de contratos; no de cobranças, junto de
`@Get('summary')`. Permissão `financeiro:ver`, `financeiro:gerenciar` nas duas.

**Modify**: `apps/api/src/modules/finance/application/contracts.service.ts`
**Modify**: `apps/api/src/modules/finance/application/payments.service.ts`

Mesmo desenho do de clientes. Nenhum dos dois tem `AssigneeScope` (`Contract` e `Payment` não
têm `assigneeId`), então o filtro é `ownerId` puro — anote isso em comentário, ou o próximo
leitor vai "consertar" acrescentando um scope que não existe.

Para **cobranças** há um detalhe do repositório: quando `sortBy` é ausente ou `'status'`,
`findManyAndCount` passa por `orderedIdsByStatus`, que faz `LIMIT ${take} OFFSET ${skip}` no
`$queryRaw` e depois hidrata com `findMany({ where: { id: { in: ids } } })`. Com
`take: 5000` isso é um `IN` de até 5.000 parâmetros — dentro do limite do Postgres (65.535) e
aceitável, mas registre no PR que foi verificado.

**Modify**: `apps/api/src/modules/finance/finance.module.ts`
Acrescentar `DataModule` aos `imports`.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md`
Três entradas novas, no formato fixo (**Propósito / Auth / Body / Resposta / Erros /
Handler**), cada uma na seção do seu módulo. Exemplo do de clientes:

```markdown
### GET /clients/export
- **Propósito:** Exportar a listagem de clientes em CSV ou XLSX, com **os mesmos filtros, permissões e recorte por responsável** de `GET /clients`. Arquivados ficam de fora, como na listagem.
- **Auth:** Bearer (access token). Permissão: `cliente:ver` ou `cliente:gerenciar`.
- **Body:** — (query: `formato: 'csv' | 'xlsx'` obrigatório, `search?`, `status?`, `sourceId?: uuid`, `assigneeId?: uuid`; `page`/`limit` são aceitos e ignorados).
- **Resposta:** `200` arquivo (`Content-Disposition: attachment; filename="clientes-AAAA-MM-DD.csv"`). CSV usa `;` e BOM UTF-8 (abre direto no Excel pt-BR); XLSX traz data e número com tipo real.
- **Erros:** `400 Formato inválido: use csv ou xlsx.` (ou query inválida), `422 A exportação está limitada a 5.000 linhas e o filtro atual seleciona N. Refine os filtros e tente de novo.`, `401`, `403`.
- **Handler:** `modules/clients/api/clients.controller.ts` → `ClientsController.export`
```

#### Web

**Create**: `apps/web/src/hooks/use-export.ts`

```ts
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

/**
 * Baixa uma exportação da API. O interceptor de resposta não toca o body, então
 * `responseType: 'blob'` funciona — mas o corpo de ERRO também vem como Blob, e
 * sem desembrulhá-lo o usuário veria "[object Blob]" no lugar da mensagem em
 * pt-BR (a do teto de 5.000 linhas, por exemplo).
 *
 * O download é um GET idempotente: se o 401 com refresh em fila reexecutar o
 * request original, o efeito é o mesmo arquivo, sem duplicação.
 */
export function useExport() {
  const [baixando, setBaixando] = useState(false);

  async function exportar(
    caminho: string,
    params: Record<string, unknown>,
    formato: 'csv' | 'xlsx',
    nomeBase: string,
  ) {
    setBaixando(true);
    try {
      const { data } = await api.get<Blob>(caminho, {
        params: { ...params, formato },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nomeBase}-${new Date().toISOString().slice(0, 10)}.${formato}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (erro) {
      toast.error(await mensagemDoBlob(erro));
    } finally {
      setBaixando(false);
    }
  }

  return { exportar, baixando };
}

/** Extrai a mensagem pt-BR de uma resposta de erro que veio como Blob. */
async function mensagemDoBlob(erro: unknown): Promise<string> {
  const corpo = (erro as { response?: { data?: unknown } })?.response?.data;
  if (corpo instanceof Blob) {
    try {
      const { message } = JSON.parse(await corpo.text());
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(' ');
    } catch {
      /* corpo não-JSON cai no genérico */
    }
  }
  return 'Falha ao exportar. Tente de novo.';
}
```

**Create**: `apps/web/src/components/ui/export-button.tsx`

Sobe para `components/ui` porque três features usam (regra do `apps/web/CLAUDE.md`: o
reaproveitamento sobe). Usa `DropdownMenu` e `Button` do design system.

```tsx
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { useExport } from '@/hooks/use-export';

/**
 * Botão "Exportar" das toolbars de listagem. `params` é o MESMO objeto que
 * alimenta a query da tela — é assim que a planilha respeita o filtro sem uma
 * segunda montagem. Sem gate de permissão: quem está na tela já passou pelo
 * `PermissionRoute` dela, e a API é a autoridade.
 */
export function ExportButton({
  caminho,
  params,
  nomeBase,
}: {
  caminho: string;
  params: Record<string, unknown>;
  nomeBase: string;
}) {
  const { exportar, baixando } = useExport();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={baixando} />}>
        {baixando ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
        Exportar
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void exportar(caminho, params, 'csv', nomeBase)}>
          CSV (.csv)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportar(caminho, params, 'xlsx', nomeBase)}>
          Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

> Confira a API do `DropdownMenuTrigger` do projeto antes de escrever — o design system é
> `@base-ui`, que usa `render={<Button />}` no lugar do `asChild` do Radix. Copie do uso que
> já existe em `components/ui/dropdown-menu.tsx` ou de quem já o consome.

**Modify**: `apps/web/src/features/clientes/ClientesListPage.tsx`

Extrair o objeto de params para uma const (hoje ele é montado inline na chamada de
`useClients`) e passar o mesmo objeto aos dois:

```tsx
  const params = {
    search: values.search || undefined,
    status: status === 'ALL' ? undefined : status,
    sourceId: source === 'ALL' ? undefined : source,
  };
  const { data, isLoading } = useClients({ page, limit: LIMIT, ...params });
```

e na toolbar, ao lado do `SearchInput`:

```tsx
        <ExportButton
          caminho="/clients/export"
          params={params}
          nomeBase="clientes"
          // `page`/`limit` de propósito fora: a exportação leva o filtro inteiro,
          // não a página que está na tela.
        />
```

**Modify**: `apps/web/src/features/financeiro/ContratosListPage.tsx`
Não há toolbar hoje — o `ExportButton` entra no cabeçalho, à esquerda do botão "Novo
contrato", dentro do mesmo `flex items-center justify-between`.

**Modify**: `apps/web/src/features/financeiro/RecebimentosPage.tsx`
O `sharedFilters` já existe e é exatamente o objeto certo; acrescentar o `status` filtrado:

```tsx
        <ExportButton
          caminho="/payments/export"
          params={{
            ...sharedFilters,
            status: statusFilter.length ? statusFilter : undefined,
            sortBy: sortBy ?? undefined,
            sortDir: sortBy ? sortDir : undefined,
          }}
          nomeBase="recebimentos"
        />
```

O `paramsSerializer: { indexes: null }` do axios já serializa `status` como
`status=PENDING&status=OVERDUE`, que é o formato que o `@Transform` do
`ListPaymentsQueryDto` normaliza.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api test` — verde, incluindo o `spreadsheet.writer.spec.ts` novo e os casos novos de `clients.service.spec.ts`
- [ ] `pnpm --filter api build` — verde (compila os imports CJS de `csv-stringify/sync` e `write-excel-file/node`)
- [ ] `pnpm --filter api lint` — verde
- [ ] `pnpm --filter web build` — verde
- [ ] `pnpm --filter web lint` — verde

#### Manual Verification
- [ ] `GET /clients/export?formato=csv` baixa `clientes-AAAA-MM-DD.csv`; o arquivo abre no Excel/LibreOffice em pt-BR **sem** assistente de importação, com acentos corretos e colunas separadas
- [ ] Filtrar clientes por status e origem na tela e exportar → a planilha tem exatamente as mesmas linhas da listagem filtrada
- [ ] `formato=xlsx` abre no Excel com "Criado em" reconhecida como data (dá para ordenar) e o valor das cobranças como número (dá para somar)
- [ ] Criar um cliente com `name = "=SOMA(1;1)"`, exportar em CSV e abrir: a célula mostra o texto, **não** o resultado 2
- [ ] Logar como colaborador **sem** `cliente:ver_todos`, com clientes de outro responsável na base → a planilha exportada não os contém
- [ ] Colaborador sem `financeiro:ver` recebe `403` em `GET /payments/export`
- [ ] Com mais de 5.000 clientes no filtro, o toast mostra a mensagem em pt-BR do teto (e não "[object Blob]")

**⏸ PAUSE**: parar para confirmação humana dos testes manuais antes da Fase 2.

---

## Fase 2: Importação — leitura de planilha e prévia

### Goal

O usuário sobe uma planilha e vê, antes de qualquer gravação, o que o sistema entendeu: quais
colunas foram reconhecidas, como ficam as dez primeiras linhas, quais origens não existem no
catálogo dele e quais linhas têm erro.

### Changes

#### Dependências

```
pnpm --filter api add csv-parse@^7.0.1 read-excel-file@^9.3.4
pnpm --filter api add -D @types/multer
```

`multer@2.2.0` já está no lockfile; só faltam os tipos. `read-excel-file/node` aceita `Buffer`
como entrada (confirmado em `node/input.d.ts` do pacote).

#### Leitura da planilha

**Create**: `apps/api/src/modules/data/infra/spreadsheet.reader.ts`

Infraestrutura → spec real. Concentra tudo que é "não confie no arquivo do usuário".

```ts
import {
  Injectable,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import readXlsxFile from 'read-excel-file/node';

/**
 * Teto de linhas de dados por importação. A escrita acontece dentro da
 * transação do request, que tem 5s de orçamento e NÃO permite commit parcial —
 * ou o arquivo inteiro entra, ou nada entra. 500 é o que cabe com folga; acima
 * disso o usuário divide o arquivo.
 *
 * O teto é aplicado no PARSE, não depois: `limits.fileSize` do multer não
 * protege contra um xlsx de 200 KB que descomprime para gigabytes.
 */
export const MAX_IMPORT_ROWS = 500;

/** Assinatura de zip — todo .xlsx é um zip. Não se confia no Content-Type. */
const ASSINATURA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export interface PlanilhaLida {
  /** Cabeçalhos da primeira linha, na ordem original. */
  colunas: string[];
  /** Linhas de dados, indexadas pelo cabeçalho. Tudo já em texto e com trim. */
  linhas: Record<string, string>[];
}

@Injectable()
export class SpreadsheetReader {
  async ler(arquivo: Buffer): Promise<PlanilhaLida> {
    const bruto = this.ehXlsx(arquivo)
      ? await this.lerXlsx(arquivo)
      : this.lerCsv(arquivo);
    return this.montar(bruto);
  }

  private ehXlsx(arquivo: Buffer): boolean {
    return arquivo.subarray(0, 4).equals(ASSINATURA_ZIP);
  }

  private async lerXlsx(arquivo: Buffer): Promise<string[][] > {
    const linhas = await readXlsxFile(arquivo);
    return linhas.map((linha) => linha.map((c) => this.paraTexto(c)));
  }

  /**
   * Delimitador decidido pelo cabeçalho: planilha salva pelo Excel em pt-BR usa
   * `;`, exportação de ferramenta gringa usa `,`. Errar isso devolve uma coluna
   * só com o arquivo inteiro dentro, e o usuário não teria como diagnosticar.
   */
  private lerCsv(arquivo: Buffer): string[][] {
    const texto = arquivo.toString('utf8').replace(/^﻿/, '');
    const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
    const delimiter =
      (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0)
        ? ';'
        : ',';
    return parse(texto, {
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as string[][];
  }

  private montar(bruto: string[][]): PlanilhaLida {
    const [cabecalho, ...corpo] = bruto;
    if (!cabecalho?.length) {
      throw new UnprocessableEntityException(
        'A planilha está vazia ou não tem uma linha de cabeçalho.',
      );
    }
    const colunas = cabecalho.map((c) => c.trim());
    if (colunas.some((c) => c === '')) {
      throw new UnprocessableEntityException(
        'A primeira linha da planilha tem uma coluna sem nome. Dê um nome a todas as colunas do cabeçalho.',
      );
    }
    const repetida = colunas.find((c, i) => colunas.indexOf(c) !== i);
    if (repetida) {
      throw new UnprocessableEntityException(
        `A planilha tem duas colunas com o nome "${repetida}". Renomeie uma delas.`,
      );
    }
    // Linha totalmente vazia no meio do arquivo é ruído de planilha, não erro.
    const uteis = corpo.filter((l) => l.some((c) => c.trim() !== ''));
    if (uteis.length === 0) {
      throw new UnprocessableEntityException(
        'A planilha não tem nenhuma linha de dados abaixo do cabeçalho.',
      );
    }
    if (uteis.length > MAX_IMPORT_ROWS) {
      throw new UnprocessableEntityException(
        `A importação é limitada a ${MAX_IMPORT_ROWS} linhas por arquivo e esta planilha tem ${uteis.length}. Divida o arquivo e importe em partes.`,
      );
    }
    return {
      colunas,
      linhas: uteis.map((linha) =>
        Object.fromEntries(
          colunas.map((coluna, i) => [coluna, (linha[i] ?? '').trim()]),
        ),
      ),
    };
  }

  /** Célula do xlsx → texto. Data vira `dd/MM/aaaa`, como o usuário digitaria. */
  private paraTexto(celula: unknown): string {
    if (celula === null || celula === undefined) return '';
    if (celula instanceof Date) return celula.toLocaleDateString('pt-BR');
    return String(celula).trim();
  }
}
```

> **Detalhe de `readXlsxFile`:** a assinatura tipada devolve `SheetData` (`Row[]`, cada `Row`
> um array de células). Se o TypeScript reclamar do `Buffer` na entrada, é porque o
> `@types/node` não está sendo visto no arquivo — o `Input` do pacote inclui `Buffer`.

**Create**: `apps/api/src/modules/data/infra/spreadsheet.reader.spec.ts`

Instancia de verdade e usa buffers montados no próprio teste — **incluindo um XLSX real
produzido pelo `SpreadsheetWriter` da Fase 1**, que é o teste de ida-e-volta que a Fase 1 não
podia fazer:

- CSV com `;` e BOM → cabeçalho e linhas corretos, BOM removido do primeiro cabeçalho.
- CSV com `,` → delimitador detectado.
- CSV com aspas e `;` dentro do campo → campo íntegro.
- XLSX gerado pelo writer → mesmas colunas e valores de volta.
- Cabeçalho com coluna vazia → `422` com a mensagem em pt-BR.
- Cabeçalho com nome repetido → `422`.
- 501 linhas → `422` citando 500 e 501.
- Só cabeçalho → `422`.
- Linha em branco no meio → ignorada, não conta para o teto.

#### Catálogo de campos importáveis

**Create**: `apps/api/src/modules/data/domain/import.ts`

```ts
export const TIPOS_DE_IMPORTACAO = ['clientes', 'contatos'] as const;
export type TipoDeImportacao = (typeof TIPOS_DE_IMPORTACAO)[number];

export interface CampoImportavel {
  /** Chave técnica — nunca aparece na interface. */
  chave: string;
  /** Rótulo pt-BR exibido no seletor de mapeamento. */
  rotulo: string;
  obrigatorio?: boolean;
  /**
   * Nomes de coluna que casam com este campo na sugestão automática, já
   * normalizados (minúscula, sem acento). O `rotulo` entra sozinho.
   */
  apelidos?: string[];
  /** Campo que resolve contra um catálogo do owner, não contra texto livre. */
  catalogo?: 'fontes-de-lead';
}

/**
 * `personType` NÃO está aqui de propósito: é deduzido do documento desde
 * `b212eb6`. Coluna "Tipo de pessoa" na planilha é ignorada — deixá-la disputar
 * com a dedução daria duas fontes de verdade para o mesmo campo.
 */
export const CAMPOS_DE_CLIENTE: CampoImportavel[] = [
  { chave: 'name', rotulo: 'Nome', obrigatorio: true, apelidos: ['razao social', 'cliente', 'empresa'] },
  { chave: 'tradeName', rotulo: 'Nome fantasia', apelidos: ['fantasia'] },
  { chave: 'document', rotulo: 'CPF/CNPJ', apelidos: ['documento', 'cpf', 'cnpj', 'cpf cnpj'] },
  { chave: 'email', rotulo: 'E-mail', apelidos: ['email'] },
  { chave: 'phone', rotulo: 'Telefone', apelidos: ['fone', 'celular', 'whatsapp'] },
  { chave: 'website', rotulo: 'Site', apelidos: ['website', 'url'] },
  { chave: 'sourceId', rotulo: 'Origem', apelidos: ['fonte', 'fonte de lead'], catalogo: 'fontes-de-lead' },
  { chave: 'status', rotulo: 'Status', apelidos: ['situacao'] },
  { chave: 'tags', rotulo: 'Tags', apelidos: ['etiquetas'] },
  { chave: 'notes', rotulo: 'Observações', apelidos: ['observacao', 'obs', 'notas'] },
  { chave: 'zipCode', rotulo: 'CEP' },
  { chave: 'street', rotulo: 'Logradouro', apelidos: ['endereco', 'rua'] },
  { chave: 'number', rotulo: 'Número', apelidos: ['numero'] },
  { chave: 'complement', rotulo: 'Complemento' },
  { chave: 'district', rotulo: 'Bairro' },
  { chave: 'city', rotulo: 'Cidade' },
  { chave: 'state', rotulo: 'UF', apelidos: ['estado'] },
];

/**
 * Contato é filho de cliente e a planilha não cria o pai: pelo menos uma das
 * duas colunas de identificação do cliente tem de estar mapeada.
 */
export const CAMPOS_DE_CONTATO: CampoImportavel[] = [
  { chave: 'clienteDocumento', rotulo: 'CPF/CNPJ do cliente', apelidos: ['documento do cliente', 'cnpj do cliente', 'cpf do cliente'] },
  { chave: 'clienteNome', rotulo: 'Nome do cliente', apelidos: ['cliente', 'empresa'] },
  { chave: 'name', rotulo: 'Nome do contato', obrigatorio: true, apelidos: ['contato', 'nome'] },
  { chave: 'role', rotulo: 'Cargo', apelidos: ['funcao'] },
  { chave: 'email', rotulo: 'E-mail', apelidos: ['email'] },
  { chave: 'phone', rotulo: 'Telefone', apelidos: ['fone', 'celular', 'whatsapp'] },
  { chave: 'isPrimary', rotulo: 'Principal', apelidos: ['contato principal'] },
];

export function camposDe(tipo: TipoDeImportacao): CampoImportavel[] {
  return tipo === 'clientes' ? CAMPOS_DE_CLIENTE : CAMPOS_DE_CONTATO;
}

/** Erro de uma linha. `linha` é o número na planilha (cabeçalho = 1). */
export interface LinhaComErro {
  linha: number;
  campo?: string;
  mensagem: string;
}

export interface PreviaDeImportacao {
  tipo: TipoDeImportacao;
  totalDeLinhas: number;
  colunas: string[];
  campos: CampoImportavel[];
  /** coluna da planilha → chave do campo (ou `null` para "não importar"). */
  mapeamento: Record<string, string | null>;
  /** Dez primeiras linhas já mapeadas, para conferência visual. */
  amostra: Record<string, string>[];
  /** Valores de Origem que não casam com nenhum item do catálogo do owner. */
  origensDesconhecidas: string[];
  erros: LinhaComErro[];
  /** Quantas linhas passariam sem erro com o mapeamento atual. */
  validas: number;
}
```

#### Normalização e resolução de catálogo

**Create**: `apps/api/src/modules/data/application/normalizar.ts`

```ts
/**
 * Minúscula, sem acento, sem espaço duplicado. É a chave de casamento tanto do
 * nome de coluna quanto do valor de catálogo — é o que faz "Tráfego Pago" da
 * planilha encontrar "Tráfego pago" do catálogo, que é o que o usuário espera.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
```

**Create**: `apps/api/src/modules/data/application/normalizar.spec.ts` — acento, caixa,
espaço duplo, `ç`, string vazia.

**Create**: `apps/api/src/modules/data/application/catalog-resolver.ts`

```ts
import { Injectable } from '@nestjs/common';
import { CatalogosService } from '../../catalogos/application/catalogos.service';
import type { CatalogItem } from '../../catalogos/domain/catalog.repository';
import { normalizar } from './normalizar';

/**
 * Texto da planilha → item do catálogo do owner.
 *
 * Carrega o catálogo UMA vez por requisição e resolve em memória: o orçamento
 * é de 5s para o request inteiro, e uma consulta por linha seriam 500
 * round-trips dentro dele. Catálogo de owner é lista curta (dezenas de itens),
 * então cabe.
 *
 * Inclui os DESATIVADOS: casar com item desativado é legítimo (o dado histórico
 * do owner existe e o registro antigo continua rotulado por ele). O que não faz
 * sentido é *criar* item novo desativado — e isso a criação não faz.
 */
@Injectable()
export class CatalogResolver {
  constructor(private readonly catalogos: CatalogosService) {}

  async carregar(ownerId: string): Promise<CatalogoResolvido> {
    const itens = await this.catalogos.list(ownerId, 'fontes-de-lead', true);
    return new CatalogoResolvido(itens);
  }
}

export class CatalogoResolvido {
  private readonly porNome: Map<string, CatalogItem>;

  constructor(itens: CatalogItem[]) {
    this.porNome = new Map(itens.map((i) => [normalizar(i.name), i]));
  }

  resolver(texto: string): CatalogItem | null {
    return this.porNome.get(normalizar(texto)) ?? null;
  }

  /**
   * Valores distintos que não casaram, na primeira grafia vista. Distintos
   * **por forma normalizada**: "Instagram" e "instagram" são o mesmo
   * desconhecido, e listar os dois faria o usuário criar duas vezes o item —
   * o que estouraria no `@@unique([ownerId, name])` no meio da importação.
   */
  desconhecidos(valores: string[]): string[] {
    const vistos = new Map<string, string>();
    for (const valor of valores) {
      const chave = normalizar(valor);
      if (!chave || this.porNome.has(chave) || vistos.has(chave)) continue;
      vistos.set(chave, valor.trim());
    }
    return [...vistos.values()];
  }

  /** Registra um item recém-criado, para as linhas seguintes já o encontrarem. */
  registrar(item: CatalogItem): void {
    this.porNome.set(normalizar(item.name), item);
  }
}
```

**Create**: `apps/api/src/modules/data/application/catalog-resolver.spec.ts` — o
`CatalogoResolvido` é classe pura, testada por instanciação direta: casamento com acento e
caixa diferentes, item desativado casando, desconhecidos deduplicados por forma normalizada,
`registrar` afetando a resolução seguinte.

#### Referências de cliente (para a importação de contatos)

**Modify**: `apps/api/src/modules/clients/domain/client.repository.ts`

```ts
/** Cliente reduzido ao que a importação precisa para casar uma planilha. */
export interface ClientImportRef {
  id: string;
  name: string;
  document: string | null;
}
```

e no contrato:

```ts
  /**
   * Todos os clientes ativos do owner, reduzidos. Existe para a importação de
   * contatos casar o cliente em memória: uma consulta por linha seriam N
   * round-trips dentro do orçamento de 5s do request.
   */
  findAllRefs(ownerId: string): Promise<ClientImportRef[]>;
```

**Modify**: `apps/api/src/modules/clients/infra/prisma-client.repository.ts`

```ts
  findAllRefs(ownerId: string): Promise<ClientImportRef[]> {
    // Sem `scope`: a importação de contatos precisa reconhecer o cliente mesmo
    // que ele esteja com outro responsável, senão o contato viraria erro de
    // linha por um recorte de leitura. A posse continua garantida pelo ownerId
    // (e pelo RLS).
    return this.prisma.db.client.findMany({
      where: { ownerId, archivedAt: null },
      select: { id: true, name: true, document: true },
    });
  }
```

**Modify**: `apps/api/src/modules/clients/application/clients.service.ts`

```ts
  /** Fronteira pública para a importação de contatos casar o cliente. */
  listImportRefs(ownerId: string): Promise<ClientImportRef[]> {
    return this.repo.findAllRefs(ownerId);
  }
```

#### O serviço de importação — caminho de prévia

**Create**: `apps/api/src/modules/data/application/import.service.ts`

Esta fase implementa só `previa()`. A gravação entra na Fase 3, no mesmo arquivo.

```ts
@Injectable()
export class ImportService {
  constructor(
    private readonly reader: SpreadsheetReader,
    private readonly resolver: CatalogResolver,
    private readonly clients: ClientsService,
  ) {}

  async previa(
    ownerId: string,
    tipo: TipoDeImportacao,
    arquivo: Buffer,
    mapeamentoInformado?: Record<string, string | null>,
  ): Promise<PreviaDeImportacao> {
    const planilha = await this.reader.ler(arquivo);
    const campos = camposDe(tipo);
    const mapeamento =
      mapeamentoInformado ?? sugerirMapeamento(planilha.colunas, campos);
    assertMapeamentoCompleto(tipo, mapeamento, campos);

    const catalogo = await this.resolver.carregar(ownerId);
    const clientes =
      tipo === 'contatos'
        ? indexarClientes(await this.clients.listImportRefs(ownerId))
        : null;

    const linhas = planilha.linhas.map((bruta) => aplicar(bruta, mapeamento));
    const erros = linhas.flatMap((linha, i) =>
      validarLinha(tipo, linha, i + 2, catalogo, clientes),
    );
    const origensDesconhecidas =
      tipo === 'clientes'
        ? catalogo.desconhecidos(linhas.map((l) => l.sourceId ?? '').filter(Boolean))
        : [];

    return {
      tipo,
      totalDeLinhas: linhas.length,
      colunas: planilha.colunas,
      campos,
      mapeamento,
      amostra: linhas.slice(0, 10),
      origensDesconhecidas,
      erros,
      validas: linhas.length - new Set(erros.map((e) => e.linha)).size,
    };
  }
}
```

Funções auxiliares no mesmo arquivo (ou em `import-rules.ts`, se ele passar de ~250 linhas):

- **`sugerirMapeamento(colunas, campos)`** — para cada coluna, casa `normalizar(coluna)`
  contra `normalizar(campo.rotulo)` e cada apelido; primeiro campo que casar e ainda não
  tiver dono vence; coluna sem casamento vira `null`.
- **`assertMapeamentoCompleto(tipo, mapeamento, campos)`** — `400` em pt-BR se um campo
  `obrigatorio` não tem coluna; para `contatos`, `400` se nem `clienteDocumento` nem
  `clienteNome` estão mapeados: *"Mapeie a coluna que identifica o cliente (CPF/CNPJ do
  cliente ou Nome do cliente) — sem ela não dá para saber a quem o contato pertence."*
  Também `400` se o mapeamento cita uma chave que não existe no catálogo de campos.
- **`aplicar(bruta, mapeamento)`** — reindexação da linha por chave de campo.
- **`indexarClientes(refs)`** — dois `Map`: por `document` (só dígitos) e por
  `normalizar(name)`. O de nome guarda **a contagem**, para detectar ambiguidade.
- **`validarLinha(...)`** — devolve `LinhaComErro[]`:

| Regra | Mensagem (pt-BR) |
|---|---|
| Nome vazio | `O nome é obrigatório.` |
| Nome < 2 caracteres | `O nome deve ter no mínimo 2 caracteres.` |
| Documento com dígitos ≠ 11 e ≠ 14 | `Documento inválido: informe um CPF (11 dígitos) ou um CNPJ (14 dígitos).` |
| CPF/CNPJ com dígito verificador errado | `CPF inválido.` / `CNPJ inválido.` |
| Documento repetido **dentro do arquivo** | `Este CPF/CNPJ aparece também na linha N do arquivo.` |
| E-mail sem formato de e-mail | `E-mail inválido.` |
| Status fora do enum | `Status inválido: use Lead, Ativo, Inativo ou Perdido.` |
| (contatos) cliente não encontrado | `Cliente não encontrado na sua base. Cadastre-o antes ou corrija o CPF/CNPJ.` |
| (contatos) nome de cliente ambíguo | `Há mais de um cliente com este nome. Use a coluna de CPF/CNPJ do cliente para identificar qual.` |

A validação de documento chama `isValidDocument`/`inferPersonType` de
[`shared/document.ts`](apps/api/src/shared/document.ts) — **não** reimplementa. Note a
diferença deliberada em relação a `resolveDocument`: a prévia **não** checa unicidade contra o
banco (isso é da Fase 3, no commit), mas **checa** repetição dentro do próprio arquivo, que
`resolveDocument` não teria como ver.

Cliente sem documento é legítimo: importa e `personType` fica no default `COMPANY` do schema.
Isso **não** é erro de linha — vira um aviso agregado da prévia, exposto pela interface na
Fase 4 a partir de `validas` e da amostra.

#### Rota

**Create**: `apps/api/src/modules/data/api/dto/import-previa.dto.ts`

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';
import { TIPOS_DE_IMPORTACAO, type TipoDeImportacao } from '../../domain/import';

/**
 * Campos de `multipart/form-data` chegam como STRING. O `ValidationPipe` global
 * tem `forbidNonWhitelisted: true`, então todo campo do form precisa estar
 * declarado aqui ou a requisição responde 400 — inclusive o que o front manda
 * "por engano".
 */
export class ImportPreviaDto {
  @IsIn(TIPOS_DE_IMPORTACAO, {
    message: 'Tipo de importação inválido: use clientes ou contatos.',
  })
  tipo: TipoDeImportacao;

  /** JSON de `{ "Coluna da planilha": "chaveDoCampo" | null }`. Ausente = o servidor sugere. */
  @IsOptional() @IsString() mapeamento?: string;
}
```

**Create**: `apps/api/src/modules/data/api/import.controller.ts`

```ts
@Controller('data/import')
export class ImportController {
  constructor(private readonly importacao: ImportService) {}

  /**
   * Prévia da importação. NÃO grava nada — é a etapa onde o usuário confere o
   * mapeamento e decide o que fazer com as origens que não estão no catálogo
   * dele. Exige a mesma chave da gravação porque a prévia lê a base de clientes
   * do owner para casar contatos.
   */
  @RequirePermission('dados:importar')
  @Post('previa')
  @UseInterceptors(
    FileInterceptor('arquivo', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  previa(
    @CurrentOwnerId() ownerId: string,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body() dto: ImportPreviaDto,
  ): Promise<PreviaDeImportacao> {
    if (!arquivo) {
      throw new BadRequestException('Envie um arquivo CSV ou XLSX.');
    }
    return this.importacao.previa(
      ownerId,
      dto.tipo,
      arquivo.buffer,
      parseMapeamento(dto.mapeamento),
    );
  }
}
```

`parseMapeamento` (helper local) faz `JSON.parse` protegido e responde
`400 O mapeamento de colunas está mal formado.` em vez de deixar o `SyntaxError` virar 500.

**Modify**: `apps/api/src/modules/data/data.module.ts`
Registrar `ImportController`, `ImportService`, `SpreadsheetReader`, `CatalogResolver`;
importar `CatalogosModule` e `ClientsModule`.

> **Ciclo de módulos a evitar:** `ClientsModule` importa `DataModule` (pelo `ExportService`,
> Fase 1) e `DataModule` precisa de `ClientsService`. Isso é uma dependência circular entre
> módulos do Nest. Resolva com `forwardRef(() => ClientsModule)` no `DataModule` **e**
> `forwardRef(() => DataModule)` no `ClientsModule`. É o menor mal: a alternativa — mover o
> `ExportService` para fora do `DataModule` — separaria import e export sem ganho real.
> Registre o motivo em comentário nos dois lados.

**Modify**: `apps/api/src/shared/permissions.ts`

```ts
  {
    key: 'dados:importar',
    label: 'Importar dados',
    description:
      'Subir planilha de clientes ou de contatos e gravar os registros em massa na base da workspace',
    category: 'Organização',
  },
```

Fica em Organização junto de `lixeira:*`, `auditoria:ver` e `catalogo:gerenciar` — e, como
`lixeira:expurgar`, **sem migration de backfill**: escrita em massa é decisão de governança e
concedê-la automaticamente a todo papel existente seria o oposto do desejado. Owner e papel
`system` recebem em runtime via `ALL_PERMISSION_KEYS`. **Registrar a exceção ao Padrão 3 no PR.**
Não há chave de exportação: quem pode ver a listagem pode exportá-la.

**Modify**: `apps/api/ENDPOINTS.md` — a entrada de `POST /data/import/previa`, numa seção
`## Dados` nova.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api test` — verde, incluindo `spreadsheet.reader.spec.ts`, `normalizar.spec.ts`, `catalog-resolver.spec.ts` e o spec novo de `import.service.spec.ts` (sugestão de mapeamento, validação linha a linha, documento repetido no arquivo, cliente ambíguo)
- [ ] `pnpm --filter api build` e `pnpm --filter api lint` — verdes
- [ ] `curl -F arquivo=@clientes.csv -F tipo=clientes …/data/import/previa` devolve `200` com `mapeamento` sugerido preenchido
- [ ] O mesmo `curl` com um arquivo de 501 linhas devolve `422` com a mensagem do teto

#### Manual Verification
- [ ] Planilha real do Excel em pt-BR (`.xlsx`) sobe e as colunas aparecem corretas, com acento
- [ ] O mesmo arquivo salvo como "CSV UTF-8 (delimitado por vírgulas)" pelo Excel também é lido corretamente (o Excel pt-BR grava com `;`)
- [ ] Colunas com nomes "óbvios" (`Nome`, `CNPJ`, `E-mail`, `Origem`) vêm mapeadas sozinhas
- [ ] Planilha com `Origem = "Instagram"` num owner sem esse item → `origensDesconhecidas: ["Instagram"]`; com `"tráfego pago"` em minúscula → casa com "Tráfego pago" e **não** aparece como desconhecida
- [ ] Nenhum registro novo aparece em `/clientes` depois de chamar a prévia (a fase inteira é read-only)
- [ ] Colaborador sem `dados:importar` recebe `403`

**⏸ PAUSE**: parar para confirmação humana antes da Fase 3.

---

## Fase 3: Importação — gravação

### Goal

O commit grava os clientes ou contatos da planilha dentro da transação do request, resolve as
origens desconhecidas conforme o usuário decidiu e registra um evento de auditoria agregado.

### Changes

#### Migration

**Create**: `apps/api/prisma/migrations/20260810100000_audit_import/migration.sql`

> Confira o número antes de criar a pasta: `20260809100000` já é da Fase 17 (ingestão de
> lead), que está na árvore de trabalho.

```sql
-- Fase 14-A: a trilha passa a cobrir a importação em massa.
--
-- A entidade auditada É a importação, não o cliente: um evento por linha
-- importada seria ruído (500 linhas do mesmo autor no mesmo instante), e usar
-- CLIENT com o id de um dos clientes escolheria arbitrariamente um deles como
-- representante do lote. `AuditLog.entityId` não tem FK justamente para
-- comportar um id que não é de nenhuma tabela — aqui, o id do lote.
--
-- PG16 aceita ADD VALUE dentro do bloco de transação que o Prisma abre; o valor
-- só não pode ser USADO na mesma transação, e esta migration não o usa.
ALTER TYPE "AuditEntity" ADD VALUE 'IMPORT';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORTAR';
```

**Modify**: `apps/api/prisma/schema.prisma`
`IMPORT` em `AuditEntity` e `IMPORTAR` em `AuditAction`, com comentário `/// ← Fase 14-A`
no mesmo estilo do `ACTIVITY // ← Fase 9`.

Sem invariante nova em `prisma/fixtures/invariantes.sql`: a regra do
[`apps/api/CLAUDE.md`](apps/api/CLAUDE.md) pede invariante para migration de **backfill ou
troca de constraint**, e esta não faz nem uma nem outra. O portão
`scripts/validar-migrations-com-dados.sh` continua sendo rodado, para confirmar que o
`ADD VALUE` aplica sobre banco com dado dentro.

#### Serviço

**Modify**: `apps/api/src/modules/data/application/import.service.ts`

```ts
/** Decisão do usuário sobre uma origem que não existe no catálogo dele. */
export interface DecisaoDeOrigem {
  /** O valor exatamente como veio da planilha. */
  valor: string;
  acao: 'criar' | 'usar' | 'ignorar';
  /** Item existente escolhido — obrigatório em `usar`. */
  itemId?: string;
}
```

```ts
  /**
   * Grava a planilha. Tudo dentro da transação do request: ou o arquivo inteiro
   * entra, ou nada entra. Não existe commit parcial pelo caminho normal —
   * `prisma.db` é `Prisma.TransactionClient`, sem `$transaction`.
   *
   * O arquivo é reprocessado do zero (a prévia não persiste), então a validação
   * roda de novo aqui: entre a prévia e o commit alguém pode ter cadastrado um
   * cliente com o mesmo documento.
   */
  async importar(
    ownerId: string,
    tipo: TipoDeImportacao,
    arquivo: Buffer,
    mapeamento: Record<string, string | null>,
    origens: DecisaoDeOrigem[],
    nomeArquivo: string,
    podeGerenciarCatalogo: boolean,
  ): Promise<RelatorioDeImportacao>
```

Sequência:

1. `reader.ler(arquivo)` → aplica o `mapeamento` → `assertMapeamentoCompleto`.
2. `resolver.carregar(ownerId)`.
3. **Aplicar as decisões de origem, antes de qualquer linha.**
   - `acao: 'criar'` → se `!podeGerenciarCatalogo`, `403` em pt-BR:
     *"Criar uma fonte de lead nova exige a permissão de gerenciar catálogos. Escolha uma
     fonte existente ou deixe em branco."* Senão,
     `catalogos.create(ownerId, 'fontes-de-lead', { name: valor.trim() })` e
     `catalogo.registrar(item)`. O `create` já responde `409` para nome repetido e já loga
     `catalogo.item_criado`.
   - `acao: 'usar'` → `catalogos.findOne(ownerId, 'fontes-de-lead', itemId)` (404 se não for
     do owner) e registra o item **sob o texto da planilha**, para as linhas casarem.
   - `acao: 'ignorar'` → registra o valor numa lista de ignorados; a linha grava sem origem.
4. `validarLinha` de novo em **todas** as linhas. Se sobrar erro, **nada é gravado**:
   `422` com o relatório de erros no corpo. O all-or-nothing é consequência da transação, não
   escolha — dizer isso na mensagem: *"A importação foi cancelada: N linha(s) têm erro.
   Nenhum registro foi gravado. Corrija a planilha e envie de novo."*
5. Gravar, **linha a linha, em série** — `clients.create(ownerId, dto)` / `contacts.create(...)`.
   Reusar os services é o que dá de graça a validação de documento, a dedução de `personType`,
   a regra do primeiro contato virar principal e o gatilho de notificação de responsável.
   Não usar `createMany`: ele pularia tudo isso.
   **Em série, com `for…of`, nunca `Promise.all`** — 500 escritas concorrentes na mesma
   transação estouram o pool e a ordem do relatório se perde.
6. Um evento de auditoria:

```ts
    await this.audit.registrar({
      entity: 'IMPORT',
      entityId: importacaoId,       // uuid do lote; AuditLog.entityId não tem FK
      entityLabel: nomeArquivo,
      action: 'IMPORTAR',
      extra: {
        tipo,
        totalDeLinhas: linhas.length,
        criados,
        origensCriadas: criadas.map((c) => c.name),
        origensIgnoradas: ignoradas,
      },
    });
```

   Um evento agregado, não N — mesmo precedente de
   [`contracts.service.ts:234-245`](apps/api/src/modules/finance/application/contracts.service.ts#L234-L245)
   ("N linhas com o mesmo autor e o mesmo instante seriam ruído na tela de auditoria").
   **Nenhum documento e nenhum nome de cliente no `extra`** — o `diff`/`extra` é lido na tela
   de auditoria e a regra do projeto mantém `document` fora da trilha.

7. Log estruturado — contagem e nome de arquivo, **nunca** dado pessoal
   (`docs/observabilidade.md`: "o Grafana é publicado na internet e a linha vive 30 dias"):

```ts
    this.logger.log({
      evento: 'importacao.concluida',
      msg: 'Importação de planilha concluída.',
      tipo,
      importacaoId,
      linhas: linhas.length,
      criados,
      ms: Date.now() - inicio,
    });
```

`evento` novo e **estável**: renomear quebra a contagem histórica no Grafana.

**Retorno**:

```ts
export interface RelatorioDeImportacao {
  tipo: TipoDeImportacao;
  totalDeLinhas: number;
  criados: number;
  origensCriadas: string[];
  origensIgnoradas: string[];
  /** Sempre vazio num 200 — erro cancela a importação inteira (ver o 422). */
  erros: LinhaComErro[];
}
```

#### Rota

**Create**: `apps/api/src/modules/data/api/dto/import-commit.dto.ts`
Como o `ImportPreviaDto`, mas `mapeamento` é **obrigatório** e entra `origens?: string`
(JSON de `DecisaoDeOrigem[]`).

**Modify**: `apps/api/src/modules/data/api/import.controller.ts`

```ts
  @RequirePermission('dados:importar')
  @Post()
  @UseInterceptors(FileInterceptor('arquivo', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  importar(
    @CurrentAccess() access: AccessContext,
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body() dto: ImportCommitDto,
  ): Promise<RelatorioDeImportacao> {
    if (!arquivo) throw new BadRequestException('Envie um arquivo CSV ou XLSX.');
    return this.importacao.importar(
      access.ownerId,
      dto.tipo,
      arquivo.buffer,
      parseMapeamento(dto.mapeamento),
      parseOrigens(dto.origens),
      arquivo.originalname,
      // Criar item de catálogo pela importação continua sendo ato de catálogo:
      // a fronteira de `catalogo:gerenciar` não se dissolve porque a escrita
      // veio por outra porta.
      access.permissions.includes('catalogo:gerenciar'),
    );
  }
```

#### Módulos e web

**Modify**: `apps/api/src/modules/data/data.module.ts` — importar `ContactsModule`
(`forwardRef` se necessário) e `AuditModule` já é `@Global()`.

**Modify**: `apps/api/src/modules/contacts/contacts.module.ts` — exportar `ContactsService`
se ainda não exporta.

**Modify**: `apps/web/src/lib/labels.ts`

```ts
  IMPORT: 'Importação',      // em AUDIT_ENTITY_LABELS
  IMPORTAR: 'Importou',      // em AUDIT_ACTION_LABELS
```

Os dois mapas alimentam os filtros da tela de auditoria por
`Object.keys(...)` ([AuditoriaPage.tsx:53-54](apps/web/src/features/auditoria/AuditoriaPage.tsx#L53-L54)),
então o valor novo aparece no filtro sozinho.

**Modify**: `apps/api/ENDPOINTS.md` — `POST /data/import`.

#### Testes

**Create**: `apps/api/src/modules/data/application/import.service.spec.ts` (ampliar o da
Fase 2) — `jest.Mocked` dos services:
- Uma linha com erro cancela tudo: nenhum `clients.create` é chamado e a exceção é `422`.
- `acao: 'criar'` sem `catalogo:gerenciar` → `403`, e nenhum `catalogos.create`.
- `acao: 'criar'` com a permissão → `catalogos.create` uma vez, e as **duas** linhas com a
  mesma origem usam o item criado (o `registrar` funcionou).
- Um evento de auditoria, não N: `audit.registrar` chamado exatamente uma vez para 3 linhas.
- Gravação em série: os `create` são chamados na ordem das linhas.

**Create**: `apps/api/test/data.e2e-spec.ts`

Cobre o que o mock não cobre — o isolamento real com RLS ligado. Molde:
[`test/rls.e2e-spec.ts`](apps/api/test/rls.e2e-spec.ts).

- Dois owners, cada um com clientes. `GET /clients/export` do owner A **não** traz nenhuma
  linha do owner B.
- Colaborador de A **sem** `cliente:ver_todos`, com clientes atribuídos a outra pessoa: a
  planilha não os contém. É o teste que guarda o risco número um da fase — o recorte por
  responsável não é protegido pelo banco.
- `POST /data/import` de A grava com `ownerId` de A (afirmar lendo do banco depois).
- `POST /data/import` com 501 linhas → `422`, e a contagem de clientes não muda.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api test` — verde
- [ ] `pnpm --filter api test:e2e` — verde, incluindo `data.e2e-spec.ts`
- [ ] `DATABASE_URL=postgresql://crm_user:crm_password@localhost:5435/crm_db apps/api/scripts/validar-migrations-com-dados.sh` — verde (a migration do enum aplica sobre banco com dado dentro)
- [ ] `pnpm --filter api build` e `pnpm --filter api lint` — verdes
- [ ] `pnpm --filter web build` — verde

#### Manual Verification
- [ ] Importar uma planilha de 5 clientes limpos → os 5 aparecem em `/clientes`, com origem e status corretos
- [ ] Importar a mesma planilha de novo → `422`, nenhum cliente duplicado é criado, e a mensagem cita as linhas com o documento já existente
- [ ] Importar planilha em que a linha 4 tem CPF inválido → `422`, e **nenhuma** das outras linhas foi gravada
- [ ] Importar com `Origem = "Instagram"` e ação "criar" → o item aparece em `/catalogos/fontes-de-lead` e os clientes daquele valor apontam para ele
- [ ] Colaborador com `dados:importar` mas **sem** `catalogo:gerenciar` recebe `403` em pt-BR ao tentar "criar", e consegue importar escolhendo "deixar em branco"
- [ ] Importar contatos casando por CNPJ → os contatos aparecem na aba Contatos do cliente certo; o primeiro contato de um cliente que não tinha nenhum vira o principal
- [ ] `/auditoria` mostra **uma** linha "Importou Importação clientes.xlsx", e o detalhe traz as contagens no `extra`
- [ ] `docker compose logs api | grep importacao.concluida` mostra a linha JSON, **sem** nome de cliente e **sem** documento

**⏸ PAUSE**: parar para confirmação humana antes da Fase 4.

---

## Fase 4: Wizard web da importação

### Goal

O owner faz a importação sozinho pela interface, sem `curl`: sobe o arquivo, confere o
mapeamento, decide as origens desconhecidas, vê a prévia e confirma.

### Changes

**Create**: `apps/web/src/components/ui/file-drop.tsx`

Primitivo de upload — não existe nenhum no design system. Área com borda tracejada, estados
`hover`/`dragover`/`disabled`, `<input type="file">` escondido, clique e arrastar, `accept`
por extensão, texto em pt-BR ("Arraste a planilha aqui ou clique para escolher · CSV ou XLSX,
até 5 MB"). Um `onFileSelected(file: File)` só; validação de tamanho e extensão no próprio
primitivo, com mensagem pt-BR inline (`role="alert"`).

**Create**: `apps/web/src/components/ui/stepper.tsx`

Indicador de passo horizontal (`1 Arquivo · 2 Colunas · 3 Origens · 4 Conferir`), com o passo
atual destacado e os já cumpridos com check. Sem navegação própria: quem controla o passo é a
página.

**Create**: `apps/web/src/features/dados/api/types.ts`
Espelha `PreviaDeImportacao`, `CampoImportavel`, `LinhaComErro`, `DecisaoDeOrigem` e
`RelatorioDeImportacao` da API.

**Create**: `apps/web/src/features/dados/api/dados.api.ts`

```ts
export const dadosApi = {
  previa: (form: FormData) =>
    api.post<PreviaDeImportacao>('/data/import/previa', form).then((r) => r.data),
  importar: (form: FormData) =>
    api.post<RelatorioDeImportacao>('/data/import', form).then((r) => r.data),
};
```

Não setar `Content-Type` à mão: com `FormData`, o axios/navegador põe o `boundary` sozinho, e
sobrescrever quebra o parse do multer.

**Create**: `apps/web/src/features/dados/api/hooks.ts` — `usePreviaDeImportacao()` e
`useImportar()` como mutations. `useImportar` invalida `queryKeys.clients.all` (e
`queryKeys.catalogos.list('fontes-de-lead', …)` quando origens foram criadas).

**Modify**: `apps/web/src/lib/query-keys.ts` — namespace `dados`.

**Create**: `apps/web/src/features/dados/ImportacaoPage.tsx`

Página, **não diálogo** — modal sobre modal é proibido e um wizard de quatro passos não cabe
num `Dialog`. Estado local do wizard (`arquivo`, `tipo`, `mapeamento`, `origens`, `previa`,
`relatorio`) em `useState` na página; o `File` fica em memória entre os passos, porque tanto a
prévia quanto o commit reenviam o arquivo.

Passos:
1. **Arquivo** — `Select` de tipo (Clientes / Contatos) + `FileDrop`. Ao escolher, dispara a
   prévia sem mapeamento e avança.
2. **Colunas** — tabela `Coluna da planilha → Campo do CRM`, um `Select` por linha com os
   `campos` que a API devolveu (rótulos pt-BR vêm da API, não duplicados aqui) mais a opção
   "Não importar". Campo obrigatório sem coluna → aviso e botão "Continuar" desabilitado.
   "Continuar" repete a prévia com o mapeamento ajustado.
3. **Origens** — só aparece se `origensDesconhecidas.length > 0`. Uma linha por valor, com
   três opções: "Criar no catálogo" (escondida sem `catalogo:gerenciar`, via `useCan`),
   "Usar uma existente" (`Select` do catálogo) e "Deixar em branco".
4. **Conferir** — contadores (`totalDeLinhas`, `validas`, `erros.length`), a tabela de erros
   (linha · campo · mensagem) e a amostra. Botão "Importar N registros", desabilitado se
   houver erro, com o aviso em pt-BR de que a importação é tudo-ou-nada.

Resultado: card com "N clientes importados", as origens criadas e um link para `/clientes`.

**Modify**: `apps/web/src/app/nav.ts`
Em Organização, antes de "Auditoria":

```ts
      { to: "/importacao", label: "Importação", icon: Upload, permission: ["dados:importar"] },
```

**Modify**: `apps/web/src/routes/router.tsx`

```tsx
          {
            element: <PermissionRoute permission={['dados:importar']} />,
            children: [{ path: '/importacao', element: <ImportacaoPage /> }],
          },
```

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter web build` — verde
- [ ] `pnpm --filter web lint` — verde

#### Manual Verification
- [ ] O wizard completa a importação de uma planilha de clientes de ponta a ponta, sem `curl`
- [ ] Coluna não reconhecida aparece como "Não importar" e dá para escolher o campo à mão
- [ ] Deixar "Nome" sem coluna desabilita "Continuar" e mostra o motivo em pt-BR
- [ ] Planilha sem origem desconhecida **pula** o passo 3
- [ ] O passo de erros mostra número da linha e mensagem em pt-BR, e o botão de importar fica desabilitado
- [ ] Colaborador **sem** `catalogo:gerenciar` não vê a opção "Criar no catálogo"
- [ ] Colaborador **sem** `dados:importar` não vê "Importação" na nav, e `/importacao` redireciona ao Dashboard
- [ ] Nenhum modal abre sobre outro em nenhum passo
- [ ] Tudo em pt-BR: rótulos, botões, estados de carregamento, mensagens de erro

**⏸ PAUSE**: fase final — confirmação humana antes de fechar a Fase 14-A no `ROADMAP.md`.

---

## Testing Strategy

### Unit Tests

- **`spreadsheet.writer.spec.ts`** e **`spreadsheet.reader.spec.ts`** — classes de
  infraestrutura, instanciadas de verdade (regra do commit `6dc6220`; mock testaria o mock).
  O teste de ida-e-volta (writer produz XLSX → reader lê de volta) é o mais valioso dos dois.
- **`normalizar.spec.ts`**, **`catalog-resolver.spec.ts`** — funções e classe puras.
- **`import.service.spec.ts`** — `jest.Mocked` dos services colaboradores. Cobre as regras que
  não têm como ser vistas em outro lugar: cancelamento total no primeiro erro, um evento de
  auditoria em vez de N, fronteira de `catalogo:gerenciar`, gravação em série.
- **`clients.service.spec.ts`** (ampliar) — o `export` repassa o `scope` recebido; teto de
  linhas lança `422`.

**Casos de borda a cobrir explicitamente:** planilha só com cabeçalho; coluna de cabeçalho
vazia; cabeçalho repetido; linha em branco no meio; CSV com `,` e com `;`; BOM; célula com
aspas e delimitador dentro; documento com máscara em três formatos diferentes; a mesma origem
grafada em três caixas; CPF com dígito verificador errado; texto de fórmula na exportação.

### Integration Tests

- **`test/data.e2e-spec.ts`** (Fase 3) — o que só o banco de verdade prova: isolamento entre
  owners na exportação, recorte por responsável na exportação, `ownerId` correto na gravação,
  teto de linhas.
- A suíte e2e existente (`auth`, `rls`) tem de continuar verde. **O `expect(total).toBe(22)`
  das policies em [`rls.e2e-spec.ts:87-89`](apps/api/test/rls.e2e-spec.ts#L87-L89) não muda:
  esta fase não cria tabela nenhuma.** Se ele quebrar, alguém criou uma tabela de staging
  contra a decisão registrada em *What We're NOT Doing*.

### Migration & Rollback

- A única migration é `20260810100000_audit_import`, que acrescenta dois valores de enum.
  Aplicar é `prisma migrate deploy` no `entrypoint.sh`, como sempre.
- **Rollback:** Postgres não remove valor de enum. Se a fase for revertida, o valor fica no
  tipo sem uso — inofensivo. Não escreva migration "de volta".
- **Sem migração de dado.** Nenhuma coluna nova, nenhum backfill, nenhum registro reescrito.
  A permissão `dados:importar` não recebe backfill de propósito (ver Fase 2).

## Environment Considerations

- **CI/CD:** sem passo novo. O portão `scripts/validar-migrations-com-dados.sh` já roda a cada
  push que toca a API e cobre a migration do enum.
- **Migrations:** uma, sem risco de dado.
- **Config/Secrets:** **nenhuma variável de ambiente nova.** O teto de upload é `limits.fileSize`
  do multer, no código; o teto de linhas é constante. Se um dia virarem configuráveis, entram
  em `config/env.validation.ts`, não em `process.env` cru.
- **Limite de body:** multipart não passa pelo body-parser (o multer intercepta antes), então
  o default de 100 kb para JSON do `main.ts` **não** limita o upload. Se a importação um dia
  virar JSON/base64, aí sim é preciso subir o limite globalmente — não é o caso aqui.
- **Traefik/nginx:** o `nginx.conf` do web nunca faz proxy para `/api` e o Traefik não tem
  middleware de buffering, então nada intermediário limita o upload de 5 MB. Confirmar em
  staging mesmo assim, porque é a primeira requisição não-JSON do projeto.
- **Multi-ambiente:** sem diferença entre dev, staging e prod.

## Dependencies & Risks

- **Dependência circular de módulos** entre `ClientsModule` e `DataModule` (export vs. import).
  Resolvida com `forwardRef` nos dois lados, com comentário. Se o Nest reclamar de provider
  indefinido em runtime, é aqui.
- **Resolução CJS/ESM das quatro bibliotecas.** Todas são `"type": "module"` com entrada CJS
  na condição `require`; o `apps/api` é CJS com `moduleResolution: nodenext`, então
  `import x from 'csv-parse/sync'` compila para `require('csv-parse/sync')` e o Node resolve
  o `.cjs`. **Risco concreto no Jest:** se o resolver escolher a entrada ESM, o spec falha com
  `Cannot use import statement outside a module`. Remédio, nessa ordem: (1) confirmar que o
  Jest 30 está honrando `exports` (ele honra por padrão); (2) `moduleNameMapper` apontando o
  subpath para o `.cjs`. Descobrir isso **na Fase 1**, com o primeiro spec do writer — não na
  Fase 3.
- **API de `write-excel-file@4.1.1`.** A documentação circulando na internet descreve
  `{ schema, buffer: true }`, que é de versões anteriores. A versão publicada no npm tem a API
  do rewrite (`{ columns }` + `.toBuffer()`), confirmada nos `.d.ts` do pacote. Ignorar tutorial
  antigo.
- **`Decimal` do Prisma nas colunas de valor.** `contract.value` e `payment.amount` são
  `Decimal`, não `number`. Sem `Number(...)` no `value` da coluna, a célula sai como texto e o
  Excel não soma. Cobrir no teste manual.
- **Ordem de rota:** `@Get('export')` depois de `@Get(':id')` faz o Express casar `:id = "export"`
  e responder `404 Cliente não encontrado.` — um bug que parece de permissão. Já aconteceu com
  as rotas de `tags`.
- **Orçamento de 5s.** 500 linhas × (`clients.create` + validação + notificação) é o pior caso
  do teto. Se estourar em produção, o sintoma é `Transaction API error` do Prisma. Medir com
  500 linhas reais no teste manual da Fase 3; se ficar acima de ~3s, baixar o teto para 250
  **antes** de abrir ao usuário — é o ajuste barato. Subir `transactionOptions.timeout` é
  mudança global e está fora do escopo desta fase.
- **Ordem de execução dentro da fase 3.** Criar item de catálogo antes de validar as linhas
  significa que uma importação cancelada por erro de linha **já criou** o item — o `create`
  do catálogo e o cancelamento estão na mesma transação, então o rollback desfaz os dois.
  Verificar isso no teste manual (importar com origem nova + linha inválida → o item **não**
  deve aparecer no catálogo).
- **Sobreposição com a Fase 19-A (LGPD)**, que é a próxima da trilha e exporta a workspace
  inteira do titular. `ExportService` + `ExportColumn<T>` foram desenhados para servir a ela
  sem mudança: 19-A acrescenta mapas de coluna e chama o mesmo serviço. Não generalize além
  disso agora.
- **Sobreposição com a Fase 13-B (campos customizados), adiada.** O exportador nasce com
  colunas fixas de propósito. Quando a 13-B entrar, `ExportColumn<T>[]` passa a ser montado a
  partir de definição em vez de literal — a forma já é a certa, o conteúdo é que muda.

## References

- PRD: `specs/research/2026-07-27-fase-14-dados-importacao-exportacao-busca-duplicidade.md`
- Trilha de produção: [`ROADMAP.md`](ROADMAP.md#L51-L82) · Fase 14: [`ROADMAP.md`](ROADMAP.md#L451-L490)
- Precedentes de plano: [`fase-13a`](specs/plans/2026-07-27-fase-13a-dominio-configuravel-por-owner.md) (catálogos por owner), [`fase-8c`](specs/plans/2026-07-26-fase-8c-lixeira.md) (permissão de governança sem backfill, read model transversal)
- `write-excel-file@4.1.1` / `read-excel-file@9.3.4` — API confirmada nos `.d.ts` do pacote publicado, não na documentação do repositório (que está à frente da versão do npm)
- [Doc oficial de upload no NestJS](https://docs.nestjs.com/techniques/file-upload)
