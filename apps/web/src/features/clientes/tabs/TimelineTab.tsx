import { useOutletContext } from 'react-router';
import { ActivityTimeline } from '@/features/atividades';
import type { Client } from '../api/types';

/**
 * Timeline do cliente: tudo que aconteceu com ele, inclusive o que foi
 * registrado dentro das oportunidades dele (a consulta sem `dealId` não recorta).
 */
export default function TimelineTab() {
  const client = useOutletContext<Client>();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-sm font-medium">Timeline</h2>
      <ActivityTimeline
        clientId={client.id}
        emptyDescription="Registre a primeira atividade deste cliente."
      />
    </div>
  );
}
