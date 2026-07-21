import { Construction } from 'lucide-react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

export default function PlaceholderTab({ title }: { title: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Construction />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          Em breve — disponível em uma próxima fase.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
