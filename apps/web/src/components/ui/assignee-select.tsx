import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  buildMemberItems,
  NO_ASSIGNEE,
  useWorkspaceMembers,
} from '@/lib/members-lookup';

interface Props {
  /** `null`/ausente = sem responsável. */
  value?: string | null;
  onValueChange: (assigneeId: string | null) => void;
  /** Responsável atual, para o gatilho exibir o nome de quem já não é membro. */
  current?: { id: string; name: string } | null;
}

/**
 * Seletor de responsável — os quatro formulários (cliente, oportunidade, demanda
 * e atividade) usam o mesmo controle, por isso ele vive no design system.
 */
export function AssigneeSelect({ value, onValueChange, current }: Props) {
  const { data: members } = useWorkspaceMembers();
  const items = buildMemberItems(members ?? [], current);
  return (
    <Select<string>
      items={items}
      value={value ?? NO_ASSIGNEE}
      onValueChange={(v) =>
        onValueChange(!v || v === NO_ASSIGNEE ? null : (v as string))
      }
    >
      <SelectTrigger placeholder="Sem responsável" />
      <SelectContent>
        <SelectItem value={NO_ASSIGNEE}>Sem responsável</SelectItem>
        {(members ?? []).map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
