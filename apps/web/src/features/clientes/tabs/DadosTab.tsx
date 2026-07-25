import { useOutletContext } from 'react-router';
import { TagBadge } from '@/components/ui/tag-badge';
import {
  translatePersonType,
  translateLeadSource,
} from '@/lib/labels';
import { formatDocument, formatPhone } from '@/lib/format';
import type { Client } from '../api/types';

function Row({
  label,
  value,
  href,
}: {
  label: string;
  value?: string | null;
  href?: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {value ? (
          href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          '—'
        )}
      </dd>
    </div>
  );
}

function toWebsiteUrl(website?: string | null): string | null {
  if (!website) return null;
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-sm font-medium">{title}</h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

export default function DadosTab() {
  const client = useOutletContext<Client>();

  const address = [
    client.street && client.number
      ? `${client.street}, ${client.number}`
      : client.street,
    client.complement,
    client.district,
    client.city && client.state ? `${client.city} - ${client.state}` : client.city,
    client.zipCode,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-8">
      <Section title="Identificação">
        <Row label="Nome" value={client.name} />
        <Row label="Nome fantasia" value={client.tradeName} />
        <Row label="Tipo de pessoa" value={translatePersonType(client.personType)} />
        <Row label="Documento" value={formatDocument(client.document)} />
        <Row label="Origem" value={translateLeadSource(client.source)} />
      </Section>

      <Section title="Contato">
        <Row label="E-mail" value={client.email} />
        <Row label="Telefone" value={formatPhone(client.phone)} />
        <Row
          label="Website"
          value={client.website}
          href={toWebsiteUrl(client.website)}
        />
      </Section>

      <Section title="Endereço">
        <Row label="Endereço" value={address} />
      </Section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-medium">Tags</h2>
        {client.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {client.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-sm font-medium">Observações</h2>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {client.notes || '—'}
        </p>
      </section>
    </div>
  );
}
