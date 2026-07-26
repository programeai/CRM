import { useState } from 'react';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ChecklistItem } from '../api/types';

interface Props {
  value: ChecklistItem[];
  onChange: (next: ChecklistItem[]) => void;
}

/**
 * Checklist estilo Trello: barra de progresso, itens com edição inline do texto
 * (clique para editar), alternância de conclusão e adição/remoção. É controlado —
 * o pai decide se persiste (edição de tarefa) ou só guarda em estado (criação).
 */
export function TaskChecklist({ value, onChange }: Props) {
  const [adding, setAdding] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  const total = value.length;
  const done = value.filter((i) => i.done).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const toggle = (index: number, checked: boolean) =>
    onChange(value.map((item, i) => (i === index ? { ...item, done: checked } : item)));

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  const add = () => {
    const text = adding.trim();
    if (!text) return;
    onChange([...value, { text, done: false }]);
    setAdding('');
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditingText(value[index].text);
  };

  const commitEdit = () => {
    if (editingIndex === null) return;
    const text = editingText.trim();
    if (text) {
      onChange(value.map((item, i) => (i === editingIndex ? { ...item, text } : item)));
    } else {
      remove(editingIndex);
    }
    setEditingIndex(null);
    setEditingText('');
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ListChecks className="size-4 text-muted-foreground" />
        <h3 className="flex-1 text-sm font-medium">Checklist</h3>
        {total > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {done}/{total}
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {percent}%
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <ul className="flex flex-col">
        {value.map((item, index) => (
          <li key={index} className="group flex items-start gap-2 rounded-md py-1">
            <Checkbox
              className="mt-0.5"
              checked={item.done}
              onCheckedChange={(checked) => toggle(index, !!checked)}
            />
            {editingIndex === index ? (
              <Input
                autoFocus
                className="h-8 flex-1"
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitEdit();
                  }
                  if (e.key === 'Escape') {
                    setEditingIndex(null);
                    setEditingText('');
                  }
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => startEdit(index)}
                className={cn(
                  'flex-1 text-left text-sm leading-snug',
                  item.done && 'text-muted-foreground line-through',
                )}
              >
                {item.text}
              </button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => remove(index)}
              aria-label="Remover item"
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Adicionar um item…"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add} disabled={!adding.trim()}>
          <Plus data-icon="inline-start" />
          Adicionar
        </Button>
      </div>
    </section>
  );
}
