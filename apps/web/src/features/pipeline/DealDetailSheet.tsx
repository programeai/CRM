import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Pencil, Plus } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TableLink } from '@/components/ui/table-link';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useCan } from '@/hooks/use-can';
import { stringFilter, useUrlFilters } from '@/hooks/use-url-filters';
import { formatDate } from '@/lib/format';
import { translateProposalStatus } from '@/lib/labels';
import { ActivityTimeline } from '@/features/atividades';
import { useProposalsByDeal } from '@/features/propostas/api/hooks';
import { ProposalFormDialog } from '@/features/propostas/ProposalFormDialog';
import { formatMoney } from '@/features/propostas/lib/proposal-format';
import type { ProposalStatus } from '@/features/propostas/api/types';
import { DealFormDialog } from './DealFormDialog';
import { LostReasonDialog } from './LostReasonDialog';
import { NextActivityBadge } from './components/NextActivityBadge';
import { useMoveDeal, useStages } from './api/hooks';
import { formatDealAmount, daysInStage } from './lib/deal-format';
import type { Deal } from './api/types';

const STATUS_BADGE: Record<ProposalStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'secondary',
  SENT: 'outline',
  NEGOTIATING: 'outline',
  ACCEPTED: 'default',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
};

/**
 * Aba ativa do drawer, na URL pelo mesmo motivo que o negócio aberto: quem clica
 * no link de uma proposta sai da tela, e ao voltar precisa cair na aba em que
 * estava — não em Atividades. `'atividades'` é o padrão e fica fora da URL.
 */
const DEAL_TABS = { aba: stringFilter('atividades') };

interface Props {
  /** `undefined` = nada selecionado; o drawer fica fechado. */
  deal?: Deal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detalhe da oportunidade em drawer — o que o clique num card do funil abre.
 *
 * Antes o clique abria direto o formulário de edição, e a oportunidade não tinha
 * onde exibir conteúdo: registrar uma anotação ou agendar um follow-up exigia
 * abrir o cliente e perder o contexto do negócio. Aqui a timeline é o corpo, e
 * editar campos passa a ser uma ação secundária (o `DealFormDialog`, que soterra
 * este drawer enquanto estiver aberto — ver `modal-stack`).
 *
 * O `deal` vem de quem lista (quadro ou aba do cliente), não de uma query
 * própria: o cache do TanStack Query já é a fonte de verdade e re-renderiza este
 * componente quando o registro muda.
 */
export function DealDetailSheet({ deal, open, onOpenChange }: Props) {
  const { data: stages } = useStages();
  const moveDeal = useMoveDeal();
  const { can, canAny } = useCan();
  const { values: tabValues, set: setTab } = useUrlFilters(DEAL_TABS);
  /**
   * Uma condição só para o link do cliente **e** para a aba de atividades: a
   * timeline é servida por `/activities`, que exige a mesma chave de cliente
   * (ver o `@RequirePermission` do controller). Sem a chave, o link levaria a
   * `PermissionRoute` devolver a pessoa ao Dashboard.
   */
  const podeVerCliente = canAny(['cliente:ver', 'cliente:gerenciar']);
  const podeVerProposta = canAny(['proposta:ver', 'proposta:gerenciar']);
  // A aba acompanha a permissão: quem não pode ver atividade cairia numa aba sem
  // painel nenhum (o gatilho e o conteúdo dela não são renderizados).
  const aba = podeVerCliente ? tabValues.aba : 'propostas';

  const [editOpen, setEditOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  /** Estágio isLost escolhido no select, aguardando o motivo da perda. */
  const [pendingLostStageId, setPendingLostStageId] = useState<string | null>(null);

  const dealId = deal?.id ?? '';
  const { data: propostas, isLoading: loadingPropostas } = useProposalsByDeal(
    podeVerProposta ? dealId : '',
  );

  // Trocar de oportunidade (clicar outro card sem fechar) reinicia as abas
  // auxiliares — o motivo de perda pendente era do negócio anterior.
  useEffect(() => {
    setPendingLostStageId(null);
  }, [dealId]);

  if (!deal) return null;

  const stage = (stages ?? []).find((s) => s.id === deal.stageId);
  const dias = daysInStage(deal.stageMovedAt);

  const mover = (stageId: string, lostReasonId?: string) => {
    moveDeal.mutate(
      // Topo da coluna destino: mover pelo detalhe é uma decisão deliberada, e o
      // card recém-movido deve estar visível sem rolar.
      { id: deal.id, body: { stageId, position: 0, lostReasonId } },
      { onSuccess: () => toast.success('Oportunidade movida.') },
    );
  };

  const onStageChange = (stageId: string | null) => {
    if (!stageId || stageId === deal.stageId) return;
    const destino = (stages ?? []).find((s) => s.id === stageId);
    // Mesmo portão do arrastar no quadro: estágio isLost exige motivo, senão a
    // API responde 422.
    if (destino?.isLost) {
      setPendingLostStageId(stageId);
      return;
    }
    mover(stageId);
  };

  const propostasDoDeal = propostas?.data ?? [];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full gap-0 data-[side=right]:sm:max-w-xl"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>{deal.title}</SheetTitle>
            <SheetDescription>
              {/* O cliente leva à tela dele. Como o negócio aberto vive na URL, o
                  "voltar" do navegador traz a pessoa de volta a este drawer — mesmo
                  caminho do link de uma proposta. */}
              {podeVerCliente ? (
                <TableLink to={`/clientes/${deal.clientId}`}>
                  {deal.client.name}
                </TableLink>
              ) : (
                deal.client.name
              )}
              {' · '}
              {deal.serviceType.name}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-3 px-4 pb-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium tabular-nums">
                {formatDealAmount(deal.amount)}
              </span>
              {deal.probability != null && (
                <span className="text-muted-foreground">{deal.probability}%</span>
              )}
              {deal.expectedClose && (
                <span className="text-muted-foreground">
                  Fecha em {formatDate(deal.expectedClose)}
                </span>
              )}
              <span className="text-muted-foreground">
                {deal.assignee ? deal.assignee.name : 'Sem responsável'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {deal.nextActivityAt !== undefined && (
                <NextActivityBadge nextActivityAt={deal.nextActivityAt} />
              )}
              {/* Tempo no estágio: o mesmo dado que gera o "Esfriando" no card,
                  aqui em número em vez de alerta. */}
              <Badge variant="outline" className="font-normal">
                {dias === 0
                  ? 'Entrou hoje no estágio'
                  : `${dias} ${dias === 1 ? 'dia' : 'dias'} neste estágio`}
              </Badge>
              {deal.lostReason && (
                <Badge variant="destructive">{deal.lostReason.name}</Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {can('oportunidade:gerenciar') ? (
                <Select<string>
                  items={(stages ?? []).map((s) => ({ label: s.name, value: s.id }))}
                  value={deal.stageId}
                  onValueChange={onStageChange}
                  disabled={moveDeal.isPending}
                >
                  <SelectTrigger className="flex-1" placeholder="Estágio" />
                  <SelectContent>
                    {(stages ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="secondary" className="flex-1 justify-center py-2">
                  {stage?.name ?? '—'}
                </Badge>
              )}
              {can('oportunidade:gerenciar') && (
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil data-icon="inline-start" />
                  Editar
                </Button>
              )}
            </div>
          </div>

          <Separator />

          <Tabs
            value={aba}
            onValueChange={(value) => setTab({ aba: String(value) })}
            className="min-h-0 flex-1 gap-0"
          >
            <div className="px-4 pt-4">
              <TabsList>
                {podeVerCliente && (
                  <TabsTrigger value="atividades">Atividades</TabsTrigger>
                )}
                {podeVerProposta && (
                  <TabsTrigger value="propostas">
                    Propostas
                    {propostasDoDeal.length > 0 && ` (${propostasDoDeal.length})`}
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {/* Única região com scroll do drawer. */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {podeVerCliente && (
                <TabsContent value="atividades">
                  <ActivityTimeline
                    clientId={deal.clientId}
                    dealId={deal.id}
                    emptyDescription="Registre a primeira atividade desta oportunidade."
                  />
                </TabsContent>
              )}

              {podeVerProposta && (
                <TabsContent value="propostas" className="flex flex-col gap-4">
                  {can('proposta:gerenciar') && (
                    <Button
                      variant="outline"
                      className="self-start"
                      onClick={() => setProposalOpen(true)}
                    >
                      <Plus data-icon="inline-start" />
                      Nova proposta
                    </Button>
                  )}
                  {loadingPropostas ? (
                    <div className="flex flex-col gap-2">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : propostasDoDeal.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {propostasDoDeal.map((proposta) => (
                        <li
                          key={proposta.id}
                          className="flex items-center justify-between gap-4 rounded-lg border p-3"
                        >
                          <div className="flex flex-col gap-1">
                            <TableLink
                              to={`/propostas/${proposta.id}`}
                              className="text-sm font-medium"
                            >
                              {proposta.number} · v{proposta.version}
                            </TableLink>
                            <Badge
                              variant={STATUS_BADGE[proposta.status]}
                              className="self-start"
                            >
                              {translateProposalStatus(proposta.status)}
                            </Badge>
                          </div>
                          <span className="text-sm tabular-nums">
                            {formatMoney(proposta.total)}
                          </span>
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
                        <EmptyDescription>
                          Nenhuma proposta vinculada a esta oportunidade.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </TabsContent>
              )}
            </div>
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Abrem por cima e soterram o drawer (que volta intacto ao fechar). */}
      <DealFormDialog open={editOpen} onOpenChange={setEditOpen} deal={deal} />

      <ProposalFormDialog
        open={proposalOpen}
        onOpenChange={setProposalOpen}
        defaultClientId={deal.clientId}
        defaultDealId={deal.id}
      />

      <LostReasonDialog
        open={!!pendingLostStageId}
        onOpenChange={(o) => !o && setPendingLostStageId(null)}
        onCancel={() => setPendingLostStageId(null)}
        onConfirm={(lostReasonId) => {
          if (pendingLostStageId) mover(pendingLostStageId, lostReasonId);
          setPendingLostStageId(null);
        }}
      />
    </>
  );
}
