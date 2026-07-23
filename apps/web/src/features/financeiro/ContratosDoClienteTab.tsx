import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Plus, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { TableLink } from '@/components/ui/table-link';
import { translateBillingType, translateContractStatus } from '@/lib/labels';
import type { Client } from '@/features/clientes/api/types';
import { useContractsByClient } from './api/hooks';
import { CONTRACT_STATUS_BADGE } from './lib/finance-format';
import { ContratoFormDialog } from './ContratoFormDialog';

/** Aba "Contratos" na ficha do cliente. */
export default function ContratosDoClienteTab() {
  const client = useOutletContext<Client>();
  const { data, isLoading } = useContractsByClient(client.id);
  const contracts = data?.data ?? [];
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">Contratos</h2>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Novo contrato
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : contracts && contracts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {contracts.map((contract) => (
            <li
              key={contract.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <TableLink
                  to={`/financeiro/contratos/${contract.id}`}
                  className="text-sm font-medium"
                >
                  {contract.description}
                </TableLink>
                <span className="text-xs text-muted-foreground">
                  {translateBillingType(contract.billingType)}
                </span>
              </div>
              <Badge variant={CONTRACT_STATUS_BADGE[contract.status]}>
                {translateContractStatus(contract.status)}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>Nenhum contrato</EmptyTitle>
            <EmptyDescription>Crie o primeiro contrato deste cliente.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <ContratoFormDialog open={formOpen} onOpenChange={setFormOpen} defaultClientId={client.id} />
    </div>
  );
}
