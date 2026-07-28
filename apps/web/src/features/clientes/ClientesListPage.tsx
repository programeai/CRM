import { useEffect, useState } from 'react';
import { Plus, Globe, MessageCircle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExportButton } from '@/components/ui/export-button';
import { SearchInput } from '@/components/ui/search-input';
import { ColumnFilter } from '@/components/ui/column-filter';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableLink } from '@/components/ui/table-link';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/ui/pagination';
import {
  CLIENT_STATUS_LABELS,
  translateClientStatus,
} from '@/lib/labels';
import { formatDocument, formatPhone, formatDate, onlyDigits } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  enumFilter,
  idFilter,
  numberFilter,
  stringFilter,
  useUrlFilters,
} from '@/hooks/use-url-filters';
import { useCatalogo } from '@/features/catalogos/api/hooks';
import { useClients } from './api/hooks';
import type { Client, ClientStatus } from './api/types';
import { ClientFormDialog } from './ClientFormDialog';

/** Normaliza a URL do site garantindo o protocolo antes de abrir em nova aba. */
function toSiteUrl(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

/**
 * Monta o link do WhatsApp a partir do telefone. Prefixa o DDI 55 (Brasil)
 * quando o número não inclui código de país (10–11 dígitos).
 */
function toWhatsAppUrl(phone: string): string {
  const digits = onlyDigits(phone);
  const withCountry = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${withCountry}`;
}

const STATUS_BADGE: Record<
  ClientStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  LEAD: 'secondary',
  ACTIVE: 'default',
  INACTIVE: 'outline',
  LOST: 'destructive',
};

const LIMIT = 20;

/** Filtros da listagem persistidos na URL (sobrevivem à ida/volta de uma tela de detalhe). */
const CLIENTES_FILTERS = {
  search: stringFilter(),
  status: enumFilter(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[], 'ALL' as const),
  source: idFilter(),
  page: numberFilter(1),
};

/**
 * Cabeçalho de coluna com filtro de opção única (padrão do design system): o
 * ícone de funil abre um popover com rádios; "Todos" (valor `ALL`) não filtra.
 * O funil fica destacado quando há filtro ativo e "Limpar filtro" volta a `ALL`.
 */
function ColumnRadioFilter<T extends string>({
  label,
  name,
  value,
  onValueChange,
  options,
  translate,
}: {
  label: string;
  name: string;
  value: T | 'ALL';
  onValueChange: (value: T | 'ALL') => void;
  options: T[];
  translate: (value: T) => string;
}) {
  const items: Array<{ value: T | 'ALL'; label: string }> = [
    { value: 'ALL', label: 'Todos' },
    ...options.map((opt) => ({ value: opt, label: translate(opt) })),
  ];
  return (
    <ColumnFilter
      label={label}
      active={value !== 'ALL'}
      onClear={() => onValueChange('ALL')}
      contentClassName="w-52"
    >
      <div className="space-y-1">
        {items.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onValueChange(opt.value)}
              className="size-4 accent-primary"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </ColumnFilter>
  );
}

export default function ClientesListPage() {
  const { values, set } = useUrlFilters(CLIENTES_FILTERS);
  const { status, source, page } = values;
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  // A busca mantém estado local para digitação responsiva; o valor com debounce
  // é o que é escrito na URL (e alimenta a query), evitando reescrever a cada tecla.
  const [search, setSearch] = useState(values.search);
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== values.search) set({ search: debounced, page: 1 });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = {
    search: values.search || undefined,
    status: status === 'ALL' ? undefined : status,
    sourceId: source === 'ALL' ? undefined : source,
  };
  const { data, isLoading } = useClients({ page, limit: LIMIT, ...params });

  // Catálogo de fontes, para o filtro de coluna e a tradução na tabela — não
  // há mais allowlist compilada: o catálogo é dado do owner.
  const { data: fontes } = useCatalogo('fontes-de-lead');
  const nomeDaFonte = new Map((fontes ?? []).map((f) => [f.id, f.name]));

  const total = data?.meta.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Clientes</h1>
        <Button onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Novo cliente
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="max-w-xs"
          placeholder="Buscar por nome ou documento…"
          value={search}
          onValueChange={setSearch}
        />
        <ExportButton
          caminho="/clients/export"
          params={params}
          nomeBase="clientes"
          // `page`/`limit` de propósito fora: a exportação leva o filtro inteiro,
          // não a página que está na tela.
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Status"
                  name="status-filter"
                  value={status}
                  onValueChange={(v) => set({ status: v, page: 1 })}
                  options={Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]}
                  translate={translateClientStatus}
                />
              </TableHead>
              <TableHead>
                <ColumnRadioFilter
                  label="Origem"
                  name="source-filter"
                  value={source}
                  onValueChange={(v) => set({ source: v, page: 1 })}
                  options={(fontes ?? []).map((f) => f.id)}
                  translate={(id) => nomeDaFonte.get(id) ?? '—'}
                />
              </TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-px text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data && data.data.length > 0 ? (
              data.data.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <TableLink to={`/clientes/${client.id}`}>
                      {client.name}
                    </TableLink>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {client.email || '—'}
                      {formatDocument(client.document) ? (
                        <> · {formatDocument(client.document)}</>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{formatPhone(client.phone) || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[client.status]}>
                      {translateClientStatus(client.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{client.source?.name ?? '—'}</TableCell>
                  <TableCell>{formatDate(client.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {client.website && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Abrir site"
                          aria-label="Abrir site"
                          onClick={() =>
                            window.open(
                              toSiteUrl(client.website!),
                              '_blank',
                              'noopener,noreferrer',
                            )
                          }
                        >
                          <Globe />
                        </Button>
                      )}
                      {client.phone && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Abrir WhatsApp"
                          aria-label="Abrir WhatsApp"
                          onClick={() =>
                            window.open(
                              toWhatsAppUrl(client.phone!),
                              '_blank',
                              'noopener,noreferrer',
                            )
                          }
                        >
                          <MessageCircle />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Editar cliente"
                        aria-label="Editar cliente"
                        onClick={() => setEditingClient(client)}
                      >
                        <Pencil />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmpty colSpan={6}>Nenhum cliente encontrado.</TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={page}
        pageSize={LIMIT}
        total={total}
        onPageChange={(p) => set({ page: p })}
        labelSingular="cliente"
        labelPlural="clientes"
      />

      <ClientFormDialog open={formOpen} onOpenChange={setFormOpen} />

      {editingClient && (
        <ClientFormDialog
          open
          onOpenChange={(open) => !open && setEditingClient(null)}
          client={editingClient}
        />
      )}
    </div>
  );
}
