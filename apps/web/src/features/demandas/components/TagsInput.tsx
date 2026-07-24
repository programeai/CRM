import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { tagColors } from '@/lib/tag-color';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Editor de tags estilo Trello: chips coloridos (cor determinística por texto,
 * ver `tagColors`) com remoção, e um input que adiciona ao pressionar Enter ou
 * vírgula. Controlado — o pai decide se persiste ou só guarda em estado.
 */
export function TagsInput({ value, onChange }: Props) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const tag = raw.trim();
    if (!tag || value.includes(tag)) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              style={{ ...tagColors(tag), borderColor: 'transparent' }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium leading-4"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remover tag ${tag}`}
                className="-mr-0.5 rounded-sm opacity-80 transition-opacity hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        className="h-8"
        placeholder="Adicionar tag e pressionar Enter"
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          if (next.endsWith(',')) add(next.slice(0, -1));
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          }
          if (e.key === 'Backspace' && !draft && value.length > 0) {
            remove(value[value.length - 1]);
          }
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}
