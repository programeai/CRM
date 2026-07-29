import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TableLink } from '@/components/ui/table-link';
import { BILLING_TYPE_LABELS, translateBillingType } from '@/lib/labels';
import { formatDate, formatMoney } from '@/lib/format';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { extractApiMessage } from './lib/api-error';
import {
  useCreateContractFromProposal,
  usePreviewContractFromProposal,
} from './api/hooks';
import type { BillingPlanBody, BillingType } from './api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
}

type TipoDeEntrada = 'NENHUMA' | 'PERCENTUAL' | 'VALOR';

interface PlanoValues {
  billingType: BillingType;
  startOffsetDays: number;
  billingDay?: number;
  durationMonths?: number;
  /** Como a entrada é expressa — é UI, não vai no body. */
  tipoDeEntrada: TipoDeEntrada;
  downPaymentPercent?: number;
  downPaymentAmount?: number;
  downPaymentOffsetDays?: number;
  installments?: number;
}

const PLANO_VAZIO: PlanoValues = {
  billingType: 'ONE_TIME',
  startOffsetDays: 0,
  tipoDeEntrada: 'NENHUMA',
};

/** Plano gravado (ou já ajustado na tela) → valores do formulário local. */
function planoParaFormulario(plano: BillingPlanBody | null): PlanoValues {
  if (!plano) return PLANO_VAZIO;
  return {
    billingType: plano.billingType,
    startOffsetDays: plano.startOffsetDays,
    billingDay: plano.billingDay,
    durationMonths: plano.durationMonths,
    tipoDeEntrada:
      plano.downPaymentPercent != null ? 'PERCENTUAL'
      : plano.downPaymentAmount != null ? 'VALOR'
      : 'NENHUMA',
    downPaymentPercent: plano.downPaymentPercent,
    downPaymentAmount: plano.downPaymentAmount,
    downPaymentOffsetDays: plano.downPaymentOffsetDays,
    installments: plano.installments,
  };
}

/** Valores do formulário → corpo do plano, só com os campos do regime escolhido. */
function planoParaBody(v: PlanoValues): BillingPlanBody {
  return {
    billingType: v.billingType,
    startOffsetDays: v.startOffsetDays,
    ...(v.billingType === 'RECURRING'
      ? { billingDay: v.billingDay, durationMonths: v.durationMonths || undefined }
      : {}),
    ...(v.billingType === 'INSTALLMENTS'
      ? {
          installments: v.installments,
          ...(v.tipoDeEntrada === 'PERCENTUAL' ? { downPaymentPercent: v.downPaymentPercent } : {}),
          ...(v.tipoDeEntrada === 'VALOR' ? { downPaymentAmount: v.downPaymentAmount } : {}),
          ...(v.tipoDeEntrada !== 'NENHUMA' ? { downPaymentOffsetDays: v.downPaymentOffsetDays ?? 0 } : {}),
        }
      : {}),
  };
}

/**
 * Tela de conferência do contrato derivado de uma proposta aceita.
 *
 * Os campos do plano são escritos direto neste arquivo, duplicando os do
 * `ProposalFormDialog`. É deliberado: extrair um componente compartilhado
 * significaria uma feature importando o interior de outra
 * (`apps/web/CLAUDE.md`), e os dois contextos divergem — aqui o plano pode
 * nascer vazio (proposta do histórico) e convive com a agenda ao lado.
 *
 * A prévia vem do backend e é refeita a cada ajuste (debounce de 400ms): o
 * rateio de centavos e o valor da última parcela nunca são calculados aqui.
 */
export function GerarContratoDialog({ open, onOpenChange, proposalId }: Props) {
  const navigate = useNavigate();
  const preview = usePreviewContractFromProposal(proposalId);
  const createFromProposal = useCreateContractFromProposal(proposalId);

  const { control, register, watch, reset } = useForm<PlanoValues>({
    defaultValues: PLANO_VAZIO,
  });
  const [description, setDescription] = useState('');
  const [pronto, setPronto] = useState(false);
  const ultimoEnviadoRef = useRef<string | null>(null);

  const billingType = watch('billingType');
  const tipoDeEntrada = watch('tipoDeEntrada');
  const planoAtualKey = pronto ? JSON.stringify(planoParaBody(watch())) : null;
  const debouncedKey = useDebouncedValue(planoAtualKey, 400);

  // Ao abrir: busca a prévia com body vazio → plano gravado na proposta.
  useEffect(() => {
    if (!open) {
      setPronto(false);
      return;
    }
    preview.mutate(
      {},
      {
        onSuccess: (previa) => {
          const carregado = planoParaFormulario(previa.plano);
          reset(carregado);
          setDescription(previa.descricaoSugerida);
          // Com plano gravado, esta prévia já corresponde ao formulário: semear
          // o ref evita uma segunda chamada idêntica. SEM plano (proposta do
          // histórico), os defaults do formulário são um plano diferente do que
          // acabou de ser previsto (nenhum) — deixar o ref nulo faz o efeito de
          // debounce pedir a primeira prévia sozinho. Sem isso o botão "Gerar
          // contrato" nasce desabilitado e só destrava se o usuário encostar
          // num campo, mesmo com os defaults formando um plano válido.
          ultimoEnviadoRef.current = previa.plano
            ? JSON.stringify(planoParaBody(carregado))
            : null;
          setPronto(true);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposalId]);

  // Cada ajuste do plano (debounced) refaz a prévia — nunca em onChange direto.
  useEffect(() => {
    if (!open || !pronto || debouncedKey == null) return;
    if (debouncedKey === ultimoEnviadoRef.current) return;
    ultimoEnviadoRef.current = debouncedKey;
    preview.mutate({ plano: JSON.parse(debouncedKey) as BillingPlanBody });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey, open, pronto]);

  const previa = preview.data;
  const contratosExistentes = previa?.contratosExistentes ?? [];
  const jaTemContrato = contratosExistentes.length > 0;
  const derivado = previa?.derivado ?? null;
  const erroDaPrevia = preview.isError
    ? extractApiMessage(preview.error, 'Não foi possível calcular a prévia.')
    : null;

  const handleGerar = async () => {
    try {
      const criado = await createFromProposal.mutateAsync({
        description: description || undefined,
        plano: planoParaBody(watch()),
      });
      toast.success('Contrato gerado.');
      onOpenChange(false);
      navigate(`/financeiro/contratos/${criado.id}`);
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao gerar o contrato.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Gerar contrato</DialogTitle>
          <DialogDescription>
            Ajuste o plano de cobrança e confira o que será criado antes de gerar o contrato.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {jaTemContrato && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" />
              <span>
                Esta proposta já gerou o contrato "{contratosExistentes[0].description}".
              </span>
              <TableLink
                className="ml-auto shrink-0"
                to={`/financeiro/contratos/${contratosExistentes[0].id}`}
              >
                Ver contrato
              </TableLink>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Coluna esquerda: plano de cobrança */}
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="gc-description">Descrição do contrato</FieldLabel>
                <Input
                  id="gc-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel required>Regime de cobrança</FieldLabel>
                <Controller
                  control={control}
                  name="billingType"
                  render={({ field }) => (
                    <Select<BillingType>
                      items={BILLING_TYPE_LABELS}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger />
                      <SelectContent>
                        {(Object.keys(BILLING_TYPE_LABELS) as BillingType[]).map((b) => (
                          <SelectItem key={b} value={b}>
                            {translateBillingType(b)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="gc-startOffsetDays" required>
                  Começa em (dias após o aceite)
                </FieldLabel>
                <Input
                  id="gc-startOffsetDays"
                  type="number"
                  min={0}
                  max={365}
                  {...register('startOffsetDays', {
                    setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                  })}
                />
              </Field>

              {billingType === 'RECURRING' && (
                <>
                  <Field>
                    <FieldLabel htmlFor="gc-billingDay" required>
                      Dia de vencimento (1–28)
                    </FieldLabel>
                    <Input
                      id="gc-billingDay"
                      type="number"
                      min={1}
                      max={28}
                      {...register('billingDay', {
                        setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                      })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="gc-durationMonths">Duração (meses)</FieldLabel>
                    <Input
                      id="gc-durationMonths"
                      type="number"
                      min={1}
                      max={120}
                      placeholder="Em branco = indeterminado"
                      {...register('durationMonths', {
                        setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                      })}
                    />
                  </Field>
                </>
              )}

              {billingType === 'INSTALLMENTS' && (
                <>
                  <Field>
                    <FieldLabel required>Entrada</FieldLabel>
                    <Controller
                      control={control}
                      name="tipoDeEntrada"
                      render={({ field }) => (
                        <Select<TipoDeEntrada>
                          items={{ NENHUMA: 'Nenhuma', PERCENTUAL: 'Percentual', VALOR: 'Valor' }}
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger />
                          <SelectContent>
                            <SelectItem value="NENHUMA">Nenhuma</SelectItem>
                            <SelectItem value="PERCENTUAL">Percentual</SelectItem>
                            <SelectItem value="VALOR">Valor</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>

                  {tipoDeEntrada === 'PERCENTUAL' && (
                    <Field>
                      <FieldLabel htmlFor="gc-downPaymentPercent" required>
                        Entrada (%)
                      </FieldLabel>
                      <Input
                        id="gc-downPaymentPercent"
                        type="number"
                        min={0.01}
                        max={100}
                        step={0.01}
                        {...register('downPaymentPercent', {
                          setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                        })}
                      />
                    </Field>
                  )}

                  {tipoDeEntrada === 'VALOR' && (
                    <Field>
                      <FieldLabel htmlFor="gc-downPaymentAmount" required>
                        Valor da entrada
                      </FieldLabel>
                      <Controller
                        control={control}
                        name="downPaymentAmount"
                        render={({ field }) => (
                          <MoneyInput
                            id="gc-downPaymentAmount"
                            value={field.value}
                            onValueChange={field.onChange}
                          />
                        )}
                      />
                    </Field>
                  )}

                  {tipoDeEntrada !== 'NENHUMA' && (
                    <Field>
                      <FieldLabel htmlFor="gc-downPaymentOffsetDays">
                        Vencimento da entrada (dias após o aceite)
                      </FieldLabel>
                      <Input
                        id="gc-downPaymentOffsetDays"
                        type="number"
                        min={0}
                        max={365}
                        {...register('downPaymentOffsetDays', {
                          setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                        })}
                      />
                    </Field>
                  )}

                  <Field>
                    <FieldLabel htmlFor="gc-installments" required>
                      Quantidade de parcelas
                    </FieldLabel>
                    <Input
                      id="gc-installments"
                      type="number"
                      min={1}
                      max={120}
                      {...register('installments', {
                        setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                      })}
                    />
                  </Field>
                </>
              )}
            </div>

            {/* Coluna direita: o que será criado */}
            <div className="flex flex-col gap-2">
              <h3 className="font-heading text-sm font-medium">O que será criado</h3>
              <div className="flex-1 rounded-lg border p-4">
                {preview.isPending && !previa ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    Calculando prévia…
                  </div>
                ) : erroDaPrevia ? (
                  <FieldError>{erroDaPrevia}</FieldError>
                ) : !derivado ? (
                  <p className="text-sm text-muted-foreground">
                    Preencha o plano de cobrança para ver a prévia.
                  </p>
                ) : derivado.billingType === 'RECURRING' ? (
                  <p className="text-sm">
                    Nenhuma cobrança é criada agora — o sistema emite a mensalidade de{' '}
                    <strong>{formatMoney(derivado.monthlyAmount)}</strong> todo dia{' '}
                    {derivado.billingDay}, a partir de {formatDate(derivado.startDate)}
                    {derivado.endDate
                      ? `, até ${formatDate(derivado.endDate)}`
                      : ', por tempo indeterminado'}
                    .
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      As cobranças abaixo serão criadas ao gerar o contrato.
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {derivado.cobrancas.length > 0 ? (
                          <>
                            {derivado.cobrancas.map((c, i) => (
                              <TableRow key={i}>
                                <TableCell>{c.description}</TableCell>
                                <TableCell>{formatDate(c.dueDate)}</TableCell>
                                <TableCell>{formatMoney(c.amount)}</TableCell>
                              </TableRow>
                            ))}
                            <TableRow>
                              <TableCell colSpan={2} className="text-right font-semibold">
                                Total
                              </TableCell>
                              <TableCell className="font-semibold">
                                {formatMoney(
                                  derivado.cobrancas.reduce((s, c) => s + c.amount, 0),
                                )}
                              </TableCell>
                            </TableRow>
                          </>
                        ) : (
                          <TableEmpty colSpan={3}>Nenhuma cobrança.</TableEmpty>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={jaTemContrato || !derivado || createFromProposal.isPending}
            onClick={() => void handleGerar()}
          >
            {createFromProposal.isPending && <Spinner data-icon="inline-start" />}
            Gerar contrato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
