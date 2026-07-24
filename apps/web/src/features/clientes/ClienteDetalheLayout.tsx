import { useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Archive, Pencil, UserX } from 'lucide-react';
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
import { SectionTabs, type SectionTabItem } from '@/components/ui/section-tabs';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGoBack } from '@/hooks/use-go-back';
import { translateClientStatus } from '@/lib/labels';
import { useClient, useArchiveClient } from './api/hooks';
import { ClientFormDialog } from './ClientFormDialog';
import type { ClientStatus } from './api/types';

const STATUS_BADGE: Record<
  ClientStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  LEAD: 'secondary',
  ACTIVE: 'default',
  INACTIVE: 'outline',
  LOST: 'destructive',
};

export default function ClienteDetalheLayout() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useGoBack('/clientes');
  const { data: client, isLoading, isError } = useClient(id);
  const archiveClient = useArchiveClient();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const tabs: SectionTabItem[] = [
    {
      label: 'Dados',
      to: `/clientes/${id}`,
      end: true,
      description: 'Informações cadastrais e de contato do cliente.',
    },
    {
      label: 'Contatos',
      to: `/clientes/${id}/contatos`,
      description: 'Pessoas de contato vinculadas a este cliente.',
    },
    {
      label: 'Timeline',
      to: `/clientes/${id}/timeline`,
      description: 'Histórico de interações e atividades do cliente.',
    },
    {
      label: 'Oportunidades',
      to: `/clientes/${id}/oportunidades`,
      description: 'Oportunidades de negócio associadas a este cliente.',
    },
    {
      label: 'Propostas',
      to: `/clientes/${id}/propostas`,
      description: 'Propostas comerciais enviadas para este cliente.',
    },
    {
      label: 'Projetos',
      to: `/clientes/${id}/projetos`,
      description: 'Projetos deste cliente, em andamento ou concluídos.',
    },
    {
      label: 'Contratos',
      to: `/clientes/${id}/contratos`,
      description: 'Contratos firmados com este cliente.',
    },
  ];

  const activeTab =
    tabs.find((tab) =>
      tab.end
        ? location.pathname === tab.to
        : location.pathname.startsWith(tab.to),
    ) ?? tabs[0];

  const confirmArchive = async () => {
    try {
      await archiveClient.mutateAsync(id);
      toast.success('Cliente arquivado.');
      navigate('/clientes');
    } catch {
      toast.error('Falha ao arquivar o cliente.');
    } finally {
      setArchiveOpen(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !client) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserX />
          </EmptyMedia>
          <EmptyTitle>Cliente não encontrado.</EmptyTitle>
          <EmptyDescription>
            <Button variant="link" onClick={goBack}>
              Voltar para clientes
            </Button>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit px-0 text-muted-foreground"
          onClick={goBack}
        >
          <ArrowLeft data-icon="inline-start" />
          Voltar
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="font-heading text-2xl font-semibold">
                {client.name}
              </h1>
              <Badge
                variant={STATUS_BADGE[client.status]}
                className={client.status === 'LOST' ? 'text-white' : undefined}
              >
                {translateClientStatus(client.status)}
              </Badge>
            </div>
            {client.tradeName && (
              <p className="text-sm text-muted-foreground">{client.tradeName}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil data-icon="inline-start" />
              Editar
            </Button>
            <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
              <Archive data-icon="inline-start" />
              Arquivar
            </Button>
          </div>
        </div>
      </div>

      <div className="border-b-2">
        <SectionTabs items={tabs} />
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-semibold">
            {activeTab.label}
          </h2>
          {activeTab.description && (
            <p className="text-sm text-muted-foreground">
              {activeTab.description}
            </p>
          )}
        </div>
        <Outlet context={client} />
      </div>

      <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={client} />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Arquivar cliente"
        description={`Tem certeza que deseja arquivar “${client.name}”? Ele sairá da listagem padrão.`}
        confirmLabel="Arquivar"
        pendingLabel="Arquivando…"
        destructive
        pending={archiveClient.isPending}
        onConfirm={() => void confirmArchive()}
      />
    </div>
  );
}
