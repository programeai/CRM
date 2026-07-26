import { toast } from 'sonner';
import {
  TagDeleteDialog as UiTagDeleteDialog,
  TagSelect as UiTagSelect,
} from '@/components/ui/tag-select';
import { extractApiMessage } from '@/lib/api-error';
import {
  useClientTagUsage,
  useClientTags,
  useDeleteClientTag,
} from '../api/hooks';

const ENTITY = { singular: 'cliente', plural: 'clientes', gender: 'm' } as const;

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** Ver `TagSelect` do design system: a confirmação é responsabilidade do pai. */
  onRequestDeleteTag: (tag: string) => void;
  autoFocus?: boolean;
  onAutoFocused?: () => void;
}

/**
 * Seletor de tags de clientes: o `TagSelect` do design system ligado às tags
 * agregadas dos clientes do dono (`useClientTags`).
 */
export function TagSelect({ value, onChange, ...rest }: Props) {
  const { data: tags } = useClientTags();
  return <UiTagSelect value={value} onChange={onChange} options={tags} {...rest} />;
}

interface TagDeleteDialogProps {
  /** Tag a excluir; `null` mantém o diálogo fechado. */
  tag: string | null;
  onOpenChange: (open: boolean) => void;
  /** Chamado após a exclusão bem-sucedida (para o pai tirar a tag da seleção). */
  onDeleted: (tag: string) => void;
}

/**
 * Confirmação de exclusão global de uma tag de clientes. Renderize como IRMÃO
 * do modal que contém o `TagSelect` — ver o primitivo do design system.
 */
export function TagDeleteDialog({
  tag,
  onOpenChange,
  onDeleted,
}: TagDeleteDialogProps) {
  const { data: usage, isLoading } = useClientTagUsage(tag);
  const deleteTag = useDeleteClientTag();

  const confirm = () => {
    if (!tag) return;
    deleteTag.mutate(tag, {
      onSuccess: ({ removed }) => {
        onDeleted(tag);
        onOpenChange(false);
        toast.success(
          removed > 0
            ? `Tag "${tag}" excluída de ${removed} ${removed === 1 ? 'cliente' : 'clientes'}.`
            : `Tag "${tag}" excluída.`,
        );
      },
      onError: (error) =>
        toast.error(extractApiMessage(error, 'Falha ao excluir a tag.')),
    });
  };

  return (
    <UiTagDeleteDialog
      tag={tag}
      onOpenChange={onOpenChange}
      usage={usage?.map((c) => ({ id: c.id, label: c.name }))}
      isLoading={isLoading}
      isDeleting={deleteTag.isPending}
      onConfirm={confirm}
      entity={ENTITY}
    />
  );
}
