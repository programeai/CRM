import { useOutletContext } from 'react-router';
import { TagBadge } from '@/components/ui/tag-badge';
import { AD_ATTRIBUTION_LABELS, translatePersonType } from '@/lib/labels';
import { formatDateTime, formatDocument, formatPhone } from '@/lib/format';
import type { Client } from '../api/types';

function Row({
  label,
  value,
  href,
  mono,
}: {
  label: string;
  value?: string | null;
  href?: string | null;
  /** Valor opaco e longo (click id, URL): monoespaçado e quebrando no meio. */
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs break-all' : 'text-sm'}>
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

/** Algum campo de atribuição chegou? Só então a seção existe. */
function temAtribuicao(client: Client): boolean {
  return Boolean(
    client.utmSource ||
      client.utmMedium ||
      client.utmCampaign ||
      client.utmContent ||
      client.utmTerm ||
      client.landingUrl ||
      client.fbclid ||
      client.fbp ||
      client.gclid,
  );
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
        <Row label="Origem" value={client.source?.name} />
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

      {/*
        Atribuição de anúncio. Escondida por inteiro quando não há nada — e o
        normal é não haver: só chega em lead capturado por um site que envia
        `fbclid`/`utm_*`. Uma seção com dez "—" ensinaria que o CRM perdeu o
        dado. Tudo aqui é LEITURA: a única porta de escrita é a captação.
      */}
      {temAtribuicao(client) && (
        <Section title="Atribuição de anúncio">
          <Row
            label={AD_ATTRIBUTION_LABELS.utmSource}
            value={client.utmSource}
          />
          <Row
            label={AD_ATTRIBUTION_LABELS.utmMedium}
            value={client.utmMedium}
          />
          <Row
            label={AD_ATTRIBUTION_LABELS.utmCampaign}
            value={client.utmCampaign}
          />
          <Row
            label={AD_ATTRIBUTION_LABELS.utmContent}
            value={client.utmContent}
          />
          <Row label={AD_ATTRIBUTION_LABELS.utmTerm} value={client.utmTerm} />
          <Row
            label={AD_ATTRIBUTION_LABELS.landingUrl}
            value={client.landingUrl}
            href={client.landingUrl}
            mono
          />
          <Row label={AD_ATTRIBUTION_LABELS.fbclid} value={client.fbclid} mono />
          <Row
            label={AD_ATTRIBUTION_LABELS.fbclidAt}
            value={formatDateTime(client.fbclidAt)}
          />
          <Row label={AD_ATTRIBUTION_LABELS.fbp} value={client.fbp} mono />
          <Row label={AD_ATTRIBUTION_LABELS.gclid} value={client.gclid} mono />
        </Section>
      )}

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
