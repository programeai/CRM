import { useState } from 'react';
import { CheckCircle2, CircleSlash, MinusCircle, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCan } from '@/hooks/use-can';
import { formatDate } from '@/lib/format';
import { RegistrarConsentimentoDialog } from './RegistrarConsentimentoDialog';
import { useFinalidades, useHistoricoDeConsentimento } from './api/hooks';
import type { SituacaoDeConsentimento, TipoDeTitular } from './api/types';

interface Props {
  subjectType: TipoDeTitular;
  subjectId: string;
  /** Nome do titular, para os textos. */
  titular: string;
}

/**
 * O livro-razão de consentimento de um titular: a situação vigente por finalidade
 * em cima, a linha do tempo completa embaixo.
 *
 * A **linha do tempo mostra tudo**, inclusive o que foi revogado depois — é o
 * ponto do append-only: o art. 8º § 5º manda preservar os tratamentos realizados
 * sob o consentimento anterior, e sumir com a linha revogada apagaria justamente a
 * prova que o § 2º cobra.
 *
 * Serve `Client` e `Contact`: o recorte é o par `subjectType`/`subjectId`, e é por
 * isso que este componente vive em `features/consentimento` e não dentro de
 * clientes ou de contatos.
 */
export function PainelDeConsentimento({
  subjectType,
  subjectId,
  titular,
}: Props) {
  const { data, isLoading, isError } = useHistoricoDeConsentimento(
    subjectType,
    subjectId,
  );
  const { data: finalidades } = useFinalidades();
  const { can } = useCan();
  const [registrando, setRegistrando] = useState(false);

  // O backend é a autoridade (403 pelo AccessGuard); aqui só evitamos mostrar a
  // ação que não seria aceita.
  const podeRegistrar = can('cliente:gerenciar');

  const rotuloDaFinalidade = (key: string) =>
    finalidades?.find((f) => f.key === key)?.label ?? key;

  /** A situação de cada finalidade do catálogo — inclusive as sem registro. */
  const situacaoPorFinalidade = (
    key: string,
  ): SituacaoDeConsentimento | undefined =>
    data?.situacao.find((s) => s.purpose === key);

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Falha ao carregar o histórico de consentimento.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Consentimento"
        description="O que este titular autorizou, quando e sob qual texto. Registro nunca é apagado nem reescrito: revogar entra como manifestação nova."
      >
        {podeRegistrar && (
          <Button onClick={() => setRegistrando(true)}>
            <Plus data-icon="inline-start" />
            Registrar manifestação
          </Button>
        )}
      </SectionHeading>

      {/* Situação vigente: um cartão por finalidade do catálogo. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {isLoading || !finalidades
          ? Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))
          : finalidades.map((f) => {
              const situacao = situacaoPorFinalidade(f.key);
              return (
                <div key={f.key} className="rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    {situacao === undefined ? (
                      <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : situacao.granted ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : (
                      <CircleSlash className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">{f.label}</p>
                      {situacao === undefined ? (
                        <p className="text-xs text-muted-foreground">
                          Sem registro — nunca houve manifestação sobre esta
                          finalidade.
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                situacao.granted ? 'default' : 'destructive'
                              }
                            >
                              {situacao.granted ? 'Consentido' : 'Revogado'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(situacao.occurredAt)}
                            </span>
                          </div>
                          <p className="font-mono text-[0.7rem] text-muted-foreground">
                            texto {situacao.textVersion}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      {/* Linha do tempo: TUDO, na ordem em que aconteceu. */}
      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Finalidade</TableHead>
                <TableHead>Manifestação</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead>Texto</TableHead>
                <TableHead>Registrado por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data && data.historico.length > 0 ? (
                data.historico.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(r.occurredAt)}
                    </TableCell>
                    <TableCell>{rotuloDaFinalidade(r.purpose)}</TableCell>
                    <TableCell>
                      <Badge variant={r.granted ? 'default' : 'destructive'}>
                        {r.granted ? 'Consentiu' : 'Revogou'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.channel}
                      {r.evidence && (
                        <span className="block text-xs text-muted-foreground">
                          {r.evidence}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.textVersion}
                    </TableCell>
                    <TableCell>{r.recordedByName}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmpty colSpan={6}>
                  Nenhuma manifestação registrada para este titular.
                </TableEmpty>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {podeRegistrar && (
        <RegistrarConsentimentoDialog
          open={registrando}
          onOpenChange={setRegistrando}
          subjectType={subjectType}
          subjectId={subjectId}
          titular={titular}
        />
      )}
    </div>
  );
}
