import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Plus, FolderKanban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '@/components/ui/empty';
import { TableLink } from '@/components/ui/table-link';
import { translateProjectStatus } from '@/lib/labels';
import { useProjectsByClient } from '@/features/demandas/api/hooks';
import { ProjectFormDialog } from '@/features/demandas/ProjectFormDialog';
import { PROJECT_STATUS_BADGE } from '@/features/demandas/lib/project-format';
import type { Client } from '../api/types';

export default function ProjetosTab() {
  const client = useOutletContext<Client>();
  const { data, isLoading } = useProjectsByClient(client.id);
  const [formOpen, setFormOpen] = useState(false);

  const projects = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">Projetos</h2>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Novo projeto
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : projects && projects.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <li
              key={project.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <TableLink to={`/projetos/${project.id}`} className="text-sm font-medium">
                  {project.name}
                </TableLink>
                <span className="text-xs text-muted-foreground">
                  <Badge variant={PROJECT_STATUS_BADGE[project.status]}>
                    {translateProjectStatus(project.status)}
                  </Badge>
                </span>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">
                {project._count.tasks} {project._count.tasks === 1 ? 'tarefa' : 'tarefas'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanban />
            </EmptyMedia>
            <EmptyTitle>Nenhum projeto</EmptyTitle>
            <EmptyDescription>Crie o primeiro projeto deste cliente.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultClientId={client.id}
      />
    </div>
  );
}
