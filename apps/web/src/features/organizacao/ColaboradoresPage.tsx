import { useState } from 'react';
import { Send, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useMe } from '@/features/perfil/api/hooks';
import {
  useCollaborators,
  useResendInvite,
  useRoles,
  useUpdateCollaborator,
} from './api/hooks';
import { ConvidarColaboradorDialog } from './ConvidarColaboradorDialog';
import { LinkConviteBox } from './LinkConviteBox';
import type { Collaborator, CollaboratorStatus } from './api/types';

const STATUS_LABELS: Record<CollaboratorStatus, string> = {
  PENDING: 'Convite pendente',
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
};

const STATUS_BADGE: Record<
  CollaboratorStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  PENDING: 'secondary',
  ACTIVE: 'default',
  INACTIVE: 'destructive',
};

/** Mensagem de erro da API, com texto de reserva. */
function apiError(err: unknown, fallback: string): string {
  return isAxiosError(err) && typeof err.response?.data?.message === 'string'
    ? err.response.data.message
    : fallback;
}

export default function ColaboradoresPage() {
  const { data: me } = useMe();
  const { data: collaborators, isLoading } = useCollaborators();
  const { data: roles } = useRoles();
  const update = useUpdateCollaborator();
  const resend = useResendInvite();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [toggling, setToggling] = useState<Collaborator | null>(null);
  // Link devolvido ao reenviar o convite, exibido para copiar.
  const [resentInvite, setResentInvite] = useState<{
    url: string;
    expiresInDays: number;
  } | null>(null);

  const changeRole = async (collaborator: Collaborator, roleId: string) => {
    if (roleId === collaborator.role?.id) return;
    try {
      await update.mutateAsync({ id: collaborator.id, body: { roleId } });
      toast.success('Papel atualizado.');
    } catch (err) {
      toast.error(apiError(err, 'Não foi possível alterar o papel.'));
    }
  };

  const confirmToggle = async () => {
    if (!toggling) return;
    const activating = !toggling.active;
    try {
      await update.mutateAsync({
        id: toggling.id,
        body: { active: activating },
      });
      toast.success(activating ? 'Acesso reativado.' : 'Acesso desativado.');
      setToggling(null);
    } catch (err) {
      toast.error(apiError(err, 'Não foi possível alterar a situação.'));
    }
  };

  const resendFor = async (collaborator: Collaborator) => {
    try {
      const result = await resend.mutateAsync(collaborator.id);
      setResentInvite({
        url: result.inviteUrl,
        expiresInDays: result.inviteExpiresInDays,
      });
    } catch (err) {
      toast.error(apiError(err, 'Não foi possível gerar um novo convite.'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Colaboradores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quem tem acesso ao seu CRM. Cada colaborador vê os mesmos dados que
            você, limitado pelas permissões do papel.
          </p>
        </div>
        <Button
          onClick={() => setInviteOpen(true)}
          disabled={!roles || roles.length === 0}
          title={
            roles && roles.length === 0
              ? 'Crie um papel antes de convidar alguém'
              : undefined
          }
        >
          <UserPlus data-icon="inline-start" />
          Convidar colaborador
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Convidado em</TableHead>
              <TableHead className="w-px text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : collaborators && collaborators.length > 0 ? (
              collaborators.map((collaborator) => (
                <TableRow key={collaborator.id}>
                  <TableCell>
                    <span className="font-medium">{collaborator.name}</span>
                    {collaborator.id === me?.id && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (você)
                      </span>
                    )}
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {collaborator.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    {/* O próprio usuário não troca o seu papel (a API recusa). */}
                    {collaborator.id === me?.id ? (
                      <Badge variant="outline">
                        {collaborator.role?.name ?? '—'}
                      </Badge>
                    ) : (
                      <Select<string>
                        items={(roles ?? []).map((r) => ({
                          value: r.id,
                          label: r.name,
                        }))}
                        value={collaborator.role?.id ?? ''}
                        onValueChange={(v) =>
                          void changeRole(collaborator, v as string)
                        }
                      >
                        <SelectTrigger
                          className="h-9 w-48"
                          placeholder="Sem papel"
                          aria-label={`Papel de ${collaborator.name}`}
                        />
                        <SelectContent>
                          {(roles ?? []).map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[collaborator.status]}>
                      {STATUS_LABELS[collaborator.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(collaborator.createdAt)}</TableCell>
                  <TableCell>
                    {collaborator.id !== me?.id && (
                      <div className="flex items-center justify-end gap-2">
                        {collaborator.status === 'PENDING' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void resendFor(collaborator)}
                            disabled={resend.isPending}
                          >
                            <Send data-icon="inline-start" />
                            Reenviar convite
                          </Button>
                        )}
                        <Button
                          variant={collaborator.active ? 'outline' : 'default'}
                          size="sm"
                          onClick={() => setToggling(collaborator)}
                        >
                          {collaborator.active ? 'Desativar' : 'Reativar'}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmpty colSpan={5}>
                Nenhum colaborador ainda. Convide alguém para dividir o trabalho
                no CRM.
              </TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      <ConvidarColaboradorDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles ?? []}
      />

      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(open) => !open && setToggling(null)}
        title={toggling?.active ? 'Desativar acesso?' : 'Reativar acesso?'}
        description={
          toggling?.active
            ? `${toggling.name} perde o acesso na próxima ação e a sessão dele é encerrada. Os dados criados por ele permanecem.`
            : `${toggling?.name} volta a acessar o CRM com o papel atual.`
        }
        confirmLabel={toggling?.active ? 'Desativar' : 'Reativar'}
        pendingLabel="Salvando…"
        pending={update.isPending}
        destructive={toggling?.active}
        onConfirm={() => void confirmToggle()}
      />

      {/* Link do convite reemitido — diálogo próprio para não empilhar modais. */}
      <Dialog
        open={!!resentInvite}
        onOpenChange={(open) => !open && setResentInvite(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo convite gerado</DialogTitle>
            <DialogDescription>
              Reenviamos o convite por e-mail. Se preferir, repasse o link
              abaixo por outro canal.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {resentInvite && (
              <LinkConviteBox
                url={resentInvite.url}
                expiresInDays={resentInvite.expiresInDays}
              />
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={() => setResentInvite(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
