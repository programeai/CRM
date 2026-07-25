import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { AlignLeft, Folder, Pencil, SquareKanban } from 'lucide-react';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { TASK_PRIORITY_LABELS, translateTaskPriority } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { extractApiMessage } from './lib/api-error';
import { useCreateTask, useProjects, useUpdateTask } from './api/hooks';
import { TaskChecklist } from './components/TaskChecklist';
import { TagDeleteDialog, TagSelect } from './components/TagSelect';
import type { ChecklistItem, Task, TaskPriority, UpdateTaskBody } from './api/types';

interface FormState {
  projectId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  /** yyyy-mm-dd ou '' (sem prazo). */
  dueDate: string;
  tags: string[];
  checklist: ChecklistItem[];
}

const emptyForm = (projectId: string): FormState => ({
  projectId,
  title: '',
  description: '',
  priority: 'MEDIUM',
  dueDate: '',
  tags: [],
  checklist: [],
});

const fromTask = (task: Task): FormState => ({
  projectId: task.projectId,
  title: task.title,
  description: task.description ?? '',
  priority: task.priority,
  dueDate: task.dueDate?.slice(0, 10) ?? '',
  tags: task.tags,
  checklist: task.checklist ?? [],
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task;
  defaultProjectId: string;
}

export function TaskFormDialog({ open, onOpenChange, task, defaultProjectId }: Props) {
  const isEdit = !!task;
  const createTask = useCreateTask();
  const updateTask = useUpdateTask(task?.id ?? '');

  const [form, setForm] = useState<FormState>(() => emptyForm(defaultProjectId));
  const committedTitle = useRef('');

  /** Só é preciso escolher o projeto ao criar a partir da listagem geral (sem projeto de origem). */
  const needsProjectSelect = !isEdit && !defaultProjectId;
  const [projectSearch, setProjectSearch] = useState('');
  const [projectSelectOpen, setProjectSelectOpen] = useState(false);
  const debouncedProjectSearch = useDebouncedValue(projectSearch, 300);
  const { data: projectsPage } = useProjects(
    { search: debouncedProjectSearch || undefined, limit: 50 },
    { enabled: open && needsProjectSelect },
  );
  const projectChoices = (projectsPage?.data ?? []).map((p) => ({
    id: p.id,
    label: `${p.client.name} · ${p.name}`,
  }));
  /** Mapa id→rótulo que o Select usa para exibir o projeto escolhido no gatilho (senão mostra o id). */
  const projectItems = Object.fromEntries(projectChoices.map((p) => [p.id, p.label]));

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  /**
   * Exclusão global de tag: a confirmação é renderizada como IRMÃO deste Dialog
   * (não dentro dele) para sobreviver ao soterramento — ver `TagDeleteDialog`.
   * `focusTagsOnReturn` devolve o foco ao seletor quando o modal reabre.
   */
  const [pendingDeleteTag, setPendingDeleteTag] = useState<string | null>(null);
  const [focusTagsOnReturn, setFocusTagsOnReturn] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProjectSearch('');
    setEditingDesc(false);
    setPendingDeleteTag(null);
    setFocusTagsOnReturn(false);
    const seed = task ? fromTask(task) : emptyForm(defaultProjectId);
    setForm(seed);
    committedTitle.current = seed.title;
  }, [open, task, defaultProjectId]);

  /**
   * Aplica uma mudança de campo: atualiza o estado local e, na edição, persiste
   * imediatamente (PATCH). Em erro, reverte o estado e avisa. Sem toast de
   * sucesso — o board é revalidado e o card reflete a mudança.
   */
  const setField = (patch: Partial<FormState>, api?: UpdateTaskBody) => {
    const prev = form;
    setForm({ ...form, ...patch });
    if (isEdit && api) {
      updateTask.mutate(api, {
        onError: (error) => {
          setForm(prev);
          toast.error(extractApiMessage(error, 'Falha ao salvar a alteração.'));
        },
      });
    }
  };

  const commitTitle = () => {
    if (!isEdit) return; // na criação, o título é validado ao criar
    const title = form.title.trim();
    if (title === committedTitle.current) {
      if (form.title !== title) setForm({ ...form, title });
      return;
    }
    if (title.length < 2) {
      setForm({ ...form, title: committedTitle.current });
      toast.error('O título deve ter no mínimo 2 caracteres.');
      return;
    }
    const prev = committedTitle.current;
    committedTitle.current = title;
    setForm({ ...form, title });
    updateTask.mutate(
      { title },
      {
        onError: (error) => {
          committedTitle.current = prev;
          setForm({ ...form, title: prev });
          toast.error(extractApiMessage(error, 'Falha ao salvar o título.'));
        },
      },
    );
  };

  const openDescEditor = () => {
    setDescDraft(form.description);
    setEditingDesc(true);
  };

  const saveDesc = () => {
    const description = descDraft.trim();
    setEditingDesc(false);
    if (description === form.description.trim()) return;
    setField({ description }, { description: description || null });
  };

  const submitCreate = async () => {
    if (needsProjectSelect && !form.projectId) {
      toast.error('Selecione um projeto.');
      return;
    }
    const title = form.title.trim();
    if (title.length < 2) {
      toast.error('O título deve ter no mínimo 2 caracteres.');
      return;
    }
    try {
      await createTask.mutateAsync({
        projectId: form.projectId,
        title,
        description: form.description.trim() || undefined,
        priority: form.priority,
        dueDate: form.dueDate || undefined,
        tags: form.tags,
        checklist: form.checklist,
      });
      toast.success('Tarefa criada.');
      onOpenChange(false);
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao criar a tarefa.'));
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-4xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="sr-only">{isEdit ? 'Editar demanda' : 'Nova demanda'}</DialogTitle>
          <DialogDescription className="sr-only">
            Detalhes da demanda: título, descrição, checklist, prioridade, prazo e tags.
          </DialogDescription>
          <div className="flex items-start gap-2">
            <SquareKanban className="mt-1.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <textarea
                rows={1}
                value={form.title}
                placeholder="Título da demanda"
                aria-label="Título da demanda"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                className="w-full resize-none rounded-md bg-transparent px-1.5 py-1 font-heading text-base font-medium leading-snug outline-none field-sizing-content hover:bg-muted/60 focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-[minmax(0,1fr)_19rem]">
            {/* Coluna principal: descrição + checklist */}
            <div className="flex min-w-0 flex-col gap-6">
              <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <AlignLeft className="size-4 text-muted-foreground" />
                  <h3 className="flex-1 text-sm font-medium">Descrição</h3>
                  {!editingDesc && form.description.trim() && (
                    <Button variant="ghost" size="sm" onClick={openDescEditor}>
                      <Pencil data-icon="inline-start" />
                      Editar
                    </Button>
                  )}
                </div>
                {editingDesc ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      autoFocus
                      rows={8}
                      value={descDraft}
                      placeholder="Descreva a demanda…"
                      onChange={(e) => setDescDraft(e.target.value)}
                      className="min-h-48 w-full rounded-lg border border-input bg-transparent dark:bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveDesc}>
                        Salvar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingDesc(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={openDescEditor}
                    className={cn(
                      'flex min-h-48 w-full items-start rounded-lg bg-muted/50 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted',
                      !form.description.trim() && 'text-muted-foreground',
                    )}
                  >
                    {form.description.trim() ? (
                      <span className="whitespace-pre-wrap wrap-break-word">{form.description}</span>
                    ) : (
                      'Adicionar uma descrição mais detalhada…'
                    )}
                  </button>
                )}
              </section>

              <TaskChecklist
                value={form.checklist}
                onChange={(checklist) => setField({ checklist }, { checklist })}
              />
            </div>

            {/* Coluna lateral: projeto, prioridade, prazo, tags */}
            <aside className="flex flex-col gap-4 sm:border-l sm:border-border sm:pl-6">
              {isEdit && (
                <Field>
                  <FieldLabel>Projeto</FieldLabel>
                  <Link
                    to={`/projetos/${task.projectId}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-2 rounded-md text-sm font-medium transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{task.project.name}</span>
                  </Link>
                </Field>
              )}

              {needsProjectSelect && (
                <Field>
                  <FieldLabel required>Projeto</FieldLabel>
                  <Select<string>
                    items={projectItems}
                    open={projectSelectOpen}
                    onOpenChange={setProjectSelectOpen}
                    value={form.projectId}
                    onValueChange={(v) => setForm({ ...form, projectId: v ?? '' })}
                  >
                    <SelectTrigger placeholder="Selecione um projeto" />
                    <SelectContent>
                      <div className="p-2">
                        <SearchInput
                          placeholder="Buscar projeto…"
                          value={projectSearch}
                          onValueChange={setProjectSearch}
                        />
                      </div>
                      {projectChoices.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <Field>
                <FieldLabel required>Prioridade</FieldLabel>
                <Select<TaskPriority>
                  items={TASK_PRIORITY_LABELS}
                  value={form.priority}
                  onValueChange={(v) => v && setField({ priority: v }, { priority: v })}
                >
                  <SelectTrigger />
                  <SelectContent>
                    {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {translateTaskPriority(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="dueDate">Prazo</FieldLabel>
                <Input
                  id="dueDate"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) =>
                    setField({ dueDate: e.target.value }, { dueDate: e.target.value || null })
                  }
                />
              </Field>

              <Field>
                <FieldLabel>Tags</FieldLabel>
                <TagSelect
                  value={form.tags}
                  onChange={(tags) => setField({ tags }, { tags })}
                  onRequestDeleteTag={(tag) => {
                    setFocusTagsOnReturn(true);
                    setPendingDeleteTag(tag);
                  }}
                  autoFocus={focusTagsOnReturn}
                  onAutoFocused={() => setFocusTagsOnReturn(false)}
                />
              </Field>
            </aside>
          </div>
        </DialogBody>

        {!isEdit && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={submitCreate} disabled={createTask.isPending}>
              {createTask.isPending && <Spinner data-icon="inline-start" />}
              Criar tarefa
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>

    {/* Confirmação de exclusão global de tag — irmã do Dialog para sobreviver ao
        soterramento; ao fechar, o modal de demanda reabre e o foco volta ao seletor. */}
    <TagDeleteDialog
      tag={pendingDeleteTag}
      onOpenChange={(o) => !o && setPendingDeleteTag(null)}
      onDeleted={(tag) => {
        if (!form.tags.includes(tag)) return; // não estava selecionada aqui → sem PATCH
        const tags = form.tags.filter((t) => t !== tag);
        setField({ tags }, { tags });
      }}
    />
    </>
  );
}
