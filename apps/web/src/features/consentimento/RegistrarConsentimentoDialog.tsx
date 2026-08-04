import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { extractApiMessage } from '@/lib/api-error';
import {
  useFinalidades,
  useRegistrarConsentimento,
  useTextoDeConsentimento,
} from './api/hooks';
import type { TipoDeTitular } from './api/types';

/** Canais sugeridos. Texto livre no fim: a realidade tem mais que um enum. */
const CANAIS = {
  'formulario-site': 'Formulário do site',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  telefone: 'Telefone',
  presencial: 'Presencial',
  contrato: 'Cláusula de contrato assinado',
} as const;
type Canal = keyof typeof CANAIS;

const MANIFESTACOES = {
  consentiu: 'Consentiu',
  revogou: 'Revogou',
} as const;
type Manifestacao = keyof typeof MANIFESTACOES;

const schema = z.object({
  purpose: z.string().min(1, 'Escolha a finalidade.'),
  manifestacao: z.enum(['consentiu', 'revogou']),
  channel: z.string().min(2, 'Informe como o titular se manifestou.'),
  occurredAt: z.string().optional(),
  evidence: z.string().max(500, 'Máximo 500 caracteres').optional(),
  informedRetention: z
    .string()
    .max(200, 'Máximo 200 caracteres')
    .optional(),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectType: TipoDeTitular;
  subjectId: string;
  /** Nome do titular, só para o texto do diálogo. */
  titular: string;
}

/**
 * Registra uma manifestação de consentimento. **Revogar é este mesmo diálogo com
 * "Revogou"** — não há tela de edição nem de exclusão, e não é omissão: a tabela é
 * append-only no banco, porque o art. 8º § 5º manda preservar os tratamentos
 * realizados sob o consentimento anterior.
 *
 * O **texto vigente é exibido antes de confirmar**, e é a versão dele que fica
 * gravada. Sem isso, o registro não comprova nada: o art. 8º § 2º cobra a prova de
 * que o consentimento foi obtido *informado*.
 */
export function RegistrarConsentimentoDialog({
  open,
  onOpenChange,
  subjectType,
  subjectId,
  titular,
}: Props) {
  const { data: finalidades, isLoading: carregandoFinalidades } =
    useFinalidades();
  const registrar = useRegistrarConsentimento();
  const [finalidade, setFinalidade] = useState<string | null>(null);
  const { data: texto, isLoading: carregandoTexto } =
    useTextoDeConsentimento(finalidade);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      purpose: '',
      manifestacao: 'consentiu',
      channel: 'formulario-site',
      occurredAt: '',
      evidence: '',
      informedRetention: '',
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        purpose: '',
        manifestacao: 'consentiu',
        channel: 'formulario-site',
        occurredAt: '',
        evidence: '',
        informedRetention: '',
      });
      setFinalidade(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const revogando = watch('manifestacao') === 'revogou';

  const onSubmit = async (v: Values) => {
    try {
      await registrar.mutateAsync({
        subjectType,
        subjectId,
        purpose: v.purpose,
        granted: v.manifestacao === 'consentiu',
        channel: v.channel.trim(),
        ...(v.evidence?.trim() ? { evidence: v.evidence.trim() } : {}),
        ...(v.informedRetention?.trim()
          ? { informedRetention: v.informedRetention.trim() }
          : {}),
        // `<input type="date">` dá `AAAA-MM-DD`; a API quer ISO 8601.
        ...(v.occurredAt
          ? { occurredAt: new Date(`${v.occurredAt}T12:00:00`).toISOString() }
          : {}),
      });
      toast.success(
        revogando
          ? 'Revogação registrada. A manifestação anterior continua no histórico.'
          : 'Consentimento registrado.',
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(
        extractApiMessage(err, 'Não foi possível registrar a manifestação.'),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Registrar manifestação</DialogTitle>
          <DialogDescription>
            O que {titular} autorizou (ou revogou), quando e por qual meio. Este
            registro é a sua prova de que o consentimento existiu — e ele nunca é
            apagado nem reescrito.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            className="space-y-4"
            onSubmit={handleSubmit(onSubmit)}
            id="consentimento-form"
          >
            <Field data-invalid={!!errors.purpose}>
              <FieldLabel htmlFor="purpose" required>
                Finalidade
              </FieldLabel>
              {carregandoFinalidades ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Controller
                  control={control}
                  name="purpose"
                  render={({ field }) => (
                    <Select<string>
                      items={Object.fromEntries(
                        (finalidades ?? []).map((f) => [f.key, f.label]),
                      )}
                      value={field.value || null}
                      onValueChange={(v) => {
                        if (!v) return;
                        field.onChange(v);
                        setFinalidade(v);
                      }}
                    >
                      <SelectTrigger id="purpose" />
                      <SelectContent>
                        {(finalidades ?? []).map((f) => (
                          <SelectItem key={f.key} value={f.key}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
              {errors.purpose ? (
                <FieldError>{errors.purpose.message}</FieldError>
              ) : (
                <FieldDescription>
                  {finalidades?.find((f) => f.key === finalidade)
                    ?.description ??
                    'Uma manifestação por finalidade — autorização genérica é nula por lei.'}
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="manifestacao" required>
                O titular
              </FieldLabel>
              <Controller
                control={control}
                name="manifestacao"
                render={({ field }) => (
                  <Select<Manifestacao>
                    items={MANIFESTACOES}
                    value={field.value}
                    onValueChange={(v) => v && field.onChange(v)}
                  >
                    <SelectTrigger id="manifestacao" />
                    <SelectContent>
                      {(Object.keys(MANIFESTACOES) as Manifestacao[]).map(
                        (k) => (
                          <SelectItem key={k} value={k}>
                            {MANIFESTACOES[k]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
              {revogando && (
                <FieldDescription>
                  A revogação entra como registro novo. A manifestação anterior
                  continua no histórico — é o que a lei manda preservar.
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={!!errors.channel}>
              <FieldLabel htmlFor="channel" required>
                Como se manifestou
              </FieldLabel>
              <Controller
                control={control}
                name="channel"
                render={({ field }) => (
                  <Select<Canal>
                    items={CANAIS}
                    value={(field.value as Canal) || null}
                    onValueChange={(v) => v && field.onChange(v)}
                  >
                    <SelectTrigger id="channel" />
                    <SelectContent>
                      {(Object.keys(CANAIS) as Canal[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {CANAIS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.channel && (
                <FieldError>{errors.channel.message}</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="occurredAt">Data da manifestação</FieldLabel>
              {/* `type="date"` nativo: não há primitivo de data no design
                  system ainda (ver a regra em apps/web/CLAUDE.md). */}
              <Input id="occurredAt" type="date" {...register('occurredAt')} />
              <FieldDescription>
                Em branco, vale hoje. Preencha se o titular se manifestou antes.
              </FieldDescription>
            </Field>

            <Field data-invalid={!!errors.evidence}>
              <FieldLabel htmlFor="evidence">Evidência</FieldLabel>
              <Input
                id="evidence"
                placeholder="Id do envio do formulário, número do protocolo, onde está o print…"
                {...register('evidence')}
              />
              {errors.evidence ? (
                <FieldError>{errors.evidence.message}</FieldError>
              ) : (
                <FieldDescription>
                  Onde encontrar a prova, se alguém questionar.
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={!!errors.informedRetention}>
              <FieldLabel htmlFor="informedRetention">
                Prazo de retenção informado
              </FieldLabel>
              <Input
                id="informedRetention"
                placeholder="Enquanto a autorização valer; 5 anos após o fim do contrato…"
                {...register('informedRetention')}
              />
              {errors.informedRetention ? (
                <FieldError>{errors.informedRetention.message}</FieldError>
              ) : (
                <FieldDescription>
                  O que você disse ao titular sobre por quanto tempo guardaria os
                  dados. A ANPD trata a ausência dessa informação como
                  consentimento não informado.
                </FieldDescription>
              )}
            </Field>

            {/*
              O texto vigente, exibido ANTES de confirmar. É a versão dele que
              fica gravada — e é isso que faz o registro comprovar algo.
            */}
            {finalidade && (
              <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium">
                    Texto apresentado ao titular
                  </p>
                  {texto && (
                    <span className="font-mono text-[0.7rem] text-muted-foreground">
                      versão {texto.version}
                    </span>
                  )}
                </div>
                {carregandoTexto ? (
                  <Skeleton className="h-24 w-full" />
                ) : (
                  <p className="max-h-40 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                    {texto?.text}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  <strong className="font-medium text-foreground">
                    É esta versão que fica registrada.
                  </strong>{' '}
                  Se o texto mudar, as manifestações antigas continuam apontando
                  para a versão que foi mostrada na época.
                </p>
              </div>
            )}
          </form>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="consentimento-form"
            disabled={isSubmitting || !finalidade}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {revogando ? 'Registrar revogação' : 'Registrar consentimento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
