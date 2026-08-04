import { useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, Archive, History, Pencil, UserX } from 'lucide-react';
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
import { useCan } from '@/hooks/use-can';
import { translateClientStatus } from '@/lib/labels';
import { formatPhone } from '@/lib/format';
import { useClient, useArchiveClient } from './api/hooks';
import { ClientFormDialog } from './ClientFormDialog';
import { HistoricoDialog } from '@/features/auditoria/HistoricoDialog';
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
  const { canAny } = useCan();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [historicoOpen, setHistoricoOpen] = useState(false);

  // As abas atravessam módulos (propostas, projetos, financeiro): cada uma
  // declara o que exige e as que o colaborador não pode ver são removidas —
  // sem isso ele clicaria numa aba que só devolveria 403.
  const allTabs: SectionTabItem[] = [
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
      permission: ['oportunidade:ver', 'oportunidade:gerenciar'],
    },
    {
      label: 'Propostas',
      to: `/clientes/${id}/propostas`,
      description: 'Propostas comerciais enviadas para este cliente.',
      permission: ['proposta:ver', 'proposta:gerenciar'],
    },
    {
      label: 'Projetos',
      to: `/clientes/${id}/projetos`,
      description: 'Projetos deste cliente, em andamento ou concluídos.',
      permission: ['projeto:ver', 'projeto:gerenciar'],
    },
    {
      label: 'Contratos',
      to: `/clientes/${id}/contratos`,
      description: 'Contratos firmados com este cliente.',
      permission: ['financeiro:ver', 'financeiro:gerenciar'],
    },
    {
      label: 'Consentimento',
      to: `/clientes/${id}/consentimento`,
      description:
        'O que este titular autorizou, quando e sob qual texto. Registro append-only.',
      // Sem permissão própria: consentimento é parte do cadastro do titular, e
      // quem vê o cliente vê o que ele autorizou. Registrar exige
      // `cliente:gerenciar`, e o botão é escondido por quem monta o painel.
    },
  ];
  const tabs = allTabs.filter((tab) => canAny(tab.permission ?? []));

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
              <Badge variant={STATUS_BADGE[client.status]}>
                {translateClientStatus(client.status)}
              </Badge>
            </div>
            {(() => {
              const subtitle = [
                client.tradeName,
                client.email,
                formatPhone(client.phone),
              ]
                .filter(Boolean)
                .join(' · ');
              return subtitle ? (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              ) : null;
            })()}
          </div>
          <div className="flex items-center gap-2">
            {canAny(['auditoria:ver']) && (
              <Button variant="outline" onClick={() => setHistoricoOpen(true)}>
                <History data-icon="inline-start" />
                Histórico
              </Button>
            )}
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

      <HistoricoDialog
        open={historicoOpen}
        onOpenChange={setHistoricoOpen}
        entity="CLIENT"
        entityId={id}
        label={client.name}
      />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Arquivar cliente"
        description={`Tem certeza que deseja arquivar “${client.name}”? Ele sai das listagens e vai para a lixeira, de onde pode ser restaurado.`}
        confirmLabel="Arquivar"
        pendingLabel="Arquivando…"
        destructive
        pending={archiveClient.isPending}
        onConfirm={() => void confirmArchive()}
      />
    </div>
  );
}
