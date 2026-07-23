import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '@/components/ui/empty';
import { TableLink } from '@/components/ui/table-link';
import { translateProposalStatus } from '@/lib/labels';
import { useProposalsByClient } from '@/features/propostas/api/hooks';
import { ProposalFormDialog } from '@/features/propostas/ProposalFormDialog';
import { formatMoney } from '@/features/propostas/lib/proposal-format';
import type { ProposalStatus } from '@/features/propostas/api/types';
import type { Client } from '../api/types';

const STATUS_BADGE: Record<ProposalStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'secondary',
  SENT: 'outline',
  NEGOTIATING: 'outline',
  ACCEPTED: 'default',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
};

export default function PropostasTab() {
  const client = useOutletContext<Client>();
  const { data, isLoading } = useProposalsByClient(client.id);
  const [formOpen, setFormOpen] = useState(false);

  const proposals = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">Propostas</h2>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Nova proposta
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : proposals.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {proposals.map((proposal) => (
            <li
              key={proposal.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <TableLink to={`/propostas/${proposal.id}`} className="text-sm font-medium">
                  {proposal.number} · v{proposal.version}
                </TableLink>
                <span className="text-xs text-muted-foreground">
                  <Badge variant={STATUS_BADGE[proposal.status]}>
                    {translateProposalStatus(proposal.status)}
                  </Badge>
                </span>
              </div>
              <span className="text-sm tabular-nums">{formatMoney(proposal.total)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>Nenhuma proposta</EmptyTitle>
            <EmptyDescription>Crie a primeira proposta deste cliente.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <ProposalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultClientId={client.id}
      />
    </div>
  );
}
