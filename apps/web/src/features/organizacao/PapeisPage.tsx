import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  usePermissionCatalog,
  useDeleteRole,
  useRemoveRolePermission,
  useRoles,
} from './api/hooks';
import { PapelFormDialog } from './PapelFormDialog';
import type { PermissionMeta, Role } from './api/types';

const COLUMNS = 6;

function apiError(err: unknown, fallback: string): string {
  return isAxiosError(err) && typeof err.response?.data?.message === 'string'
    ? err.response.data.message
    : fallback;
}

/** Permissões do papel, na linha expandida — rótulos vindos do catálogo. */
function PermissoesDoPapel({
  role,
  metaByKey,
  onRemove,
}: {
  role: Role;
  metaByKey: Map<string, PermissionMeta>;
  onRemove: (key: string) => void;
}) {
  if (role.permissions.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Este papel ainda não concede nenhuma permissão — quem o tiver só verá o
        dashboard.
      </p>
    );
  }

  return (
    <div className="border-l-2 border-primary/30 bg-muted/30 px-4 py-3">
      {role.system && (
        <p className="mb-2 text-xs text-muted-foreground">
          O papel do sistema concede tudo o que o CRM oferece e acompanha
          automaticamente as permissões novas. Não é editável.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Permissão</TableHead>
            <TableHead>O que concede</TableHead>
            {/* Papel do sistema não tem ação: uma coluna de ícones desabilitados
                seria só ruído. */}
            {!role.system && (
              <TableHead className="w-px text-right">Ação</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {role.permissions.map((key) => {
            const meta = metaByKey.get(key);
            return (
              <TableRow key={key}>
                <TableCell className="font-medium">
                  {meta?.label ?? key}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {meta?.description ?? 'Permissão não catalogada'}
                </TableCell>
                {!role.system && (
                  <TableCell className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Remover ${meta?.label ?? key}`}
                      title="Remover permissão"
                      onClick={() => onRemove(key)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function PapeisPage() {
  const { data: roles, isLoading } = useRoles();
  const { data: catalog } = usePermissionCatalog();
  const removePermission = useRemoveRolePermission();
  const deleteRole = useDeleteRole();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [removing, setRemoving] = useState<{ role: Role; key: string } | null>(
    null,
  );

  const metaByKey = new Map(
    (catalog ?? []).flatMap((group) =>
      group.permissions.map((p) => [p.key, p] as const),
    ),
  );

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmRemovePermission = async () => {
    if (!removing) return;
    try {
      await removePermission.mutateAsync({
        id: removing.role.id,
        key: removing.key,
      });
      toast.success('Permissão removida.');
      setRemoving(null);
    } catch (err) {
      toast.error(apiError(err, 'Não foi possível remover a permissão.'));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRole.mutateAsync(deleting.id);
      toast.success('Papel excluído.');
      setDeleting(null);
    } catch (err) {
      toast.error(apiError(err, 'Não foi possível excluir o papel.'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Papéis</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conjuntos de permissões atribuídos aos colaboradores. Você, como
            dono da conta, sempre tem acesso total.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus data-icon="inline-start" />
          Novo papel
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-px" />
              <TableHead>Nome</TableHead>
              <TableHead>Permissões</TableHead>
              <TableHead>Colaboradores</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="w-px text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: COLUMNS }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : roles && roles.length > 0 ? (
              roles.map((role) => {
                const isExpanded = expanded.has(role.id);
                return (
                  <Fragment key={role.id}>
                    <TableRow>
                      <TableCell>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? `Ocultar permissões de ${role.name}`
                              : `Ver permissões de ${role.name}`
                          }
                          onClick={() => toggleExpanded(role.id)}
                        >
                          {isExpanded ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{role.name}</span>
                        {role.description && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {role.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{role.permissions.length}</TableCell>
                      <TableCell>{role.collaboratorsCount}</TableCell>
                      <TableCell>
                        {role.system ? (
                          <Badge variant="secondary">Sistema</Badge>
                        ) : (
                          <Badge variant="outline">Personalizado</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {!role.system && (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(role);
                                setFormOpen(true);
                              }}
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => setDeleting(role)}
                            >
                              Excluir
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={COLUMNS} className="p-0">
                          <PermissoesDoPapel
                            role={role}
                            metaByKey={metaByKey}
                            onRemove={(key) => setRemoving({ role, key })}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <TableEmpty colSpan={COLUMNS}>
                Nenhum papel cadastrado.
              </TableEmpty>
            )}
          </TableBody>
        </Table>
      </div>

      <PapelFormDialog
        key={editing?.id ?? 'novo'}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        role={editing ?? undefined}
      />

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover permissão?"
        description={
          removing
            ? `"${metaByKey.get(removing.key)?.label ?? removing.key}" deixa de valer para quem tem o papel ${removing.role.name}.`
            : undefined
        }
        confirmLabel="Remover"
        pendingLabel="Removendo…"
        pending={removePermission.isPending}
        destructive
        onConfirm={() => void confirmRemovePermission()}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir papel?"
        description={
          deleting
            ? `O papel ${deleting.name} será removido. Esta ação não pode ser desfeita.`
            : undefined
        }
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        pending={deleteRole.isPending}
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
