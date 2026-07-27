import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { useMe } from '@/features/perfil/api/hooks';
import {
  ASSIGNEE_FILTER_ALL,
  ASSIGNEE_FILTER_ME,
  useWorkspaceMembers,
} from '@/lib/members-lookup';

interface Props {
  /** Valor persistido na URL: `''` (todos), `'me'` ou o id de um membro. */
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

/**
 * Filtro de responsável dos quadros (pipeline e "Minhas demandas"). O default é
 * **todos**: quem não tem a chave `:ver_todos` do recurso já recebe o recorte do
 * backend e não precisa de interface para isso.
 */
export function AssigneeFilterSelect({ value, onValueChange, className }: Props) {
  const { data: members } = useWorkspaceMembers();
  const { data: me } = useMe();
  // O usuário logado já aparece como "Atribuídos a mim" — não repetir pelo nome.
  const others = (members ?? []).filter((m) => m.id !== me?.id);

  const items: Record<string, string> = {
    [ASSIGNEE_FILTER_ALL]: 'Todos os responsáveis',
    [ASSIGNEE_FILTER_ME]: 'Atribuídos a mim',
  };
  for (const m of others) items[m.id] = m.name;

  return (
    <Select<string>
      items={items}
      value={value || ASSIGNEE_FILTER_ALL}
      onValueChange={(v) =>
        onValueChange(!v || v === ASSIGNEE_FILTER_ALL ? '' : (v as string))
      }
    >
      <SelectTrigger className={className} />
      <SelectContent>
        <SelectItem value={ASSIGNEE_FILTER_ALL}>Todos os responsáveis</SelectItem>
        <SelectItem value={ASSIGNEE_FILTER_ME}>Atribuídos a mim</SelectItem>
        {others.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
