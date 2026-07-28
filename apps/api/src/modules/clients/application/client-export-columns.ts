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
