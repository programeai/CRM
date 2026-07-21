import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  PERSON_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
  CLIENT_STATUS_LABELS,
  translatePersonType,
  translateLeadSource,
  translateClientStatus,
} from '@/lib/labels';
import { maskCep, maskDocument, maskPhone, onlyDigits } from '@/lib/format';
import { useCreateClient, useUpdateClient } from './api/hooks';
import type { Client, ClientStatus, LeadSource, PersonType } from './api/types';

const schema = z.object({
  name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres.'),
  tradeName: z.string().optional(),
  personType: z.enum(['INDIVIDUAL', 'COMPANY']),
  document: z.string().optional(),
  email: z.string().email('E-mail inválido.').optional().or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().optional(),
  source: z
    .enum(['REFERRAL', 'PAID_TRAFFIC', 'ORGANIC', 'OUTBOUND', 'OTHER'])
    .optional(),
  status: z.enum(['LEAD', 'ACTIVE', 'INACTIVE', 'LOST']),
  tagsText: z.string().optional(),
  notes: z.string().optional(),
  zipCode: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  complement: z.string().optional(),
  district: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  name: '',
  tradeName: '',
  personType: 'COMPANY',
  document: '',
  email: '',
  phone: '',
  website: '',
  source: undefined,
  status: 'LEAD',
  tagsText: '',
  notes: '',
  zipCode: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
};

function toValues(client: Client): Values {
  return {
    name: client.name,
    tradeName: client.tradeName ?? '',
    personType: client.personType,
    document: client.document ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    website: client.website ?? '',
    source: client.source ?? undefined,
    status: client.status,
    tagsText: client.tags.join(', '),
    notes: client.notes ?? '',
    zipCode: client.zipCode ?? '',
    street: client.street ?? '',
    number: client.number ?? '',
    complement: client.complement ?? '',
    district: client.district ?? '',
    city: client.city ?? '',
    state: client.state ?? '',
  };
}

/** Normaliza string vazia para undefined (o backend rejeita '' em @IsEmail, etc.). */
function blank(value?: string): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function extractApiMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const msg = (error.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(msg)) return msg[0] ?? fallback;
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

interface ViaCepResponse {
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

interface BrasilApiCnpjResponse {
  razao_social?: string;
  nome_fantasia?: string;
  email?: string;
  ddd_telefone_1?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
}

interface ClientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: Client;
}

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: ClientFormDialogProps) {
  const isEdit = !!client;
  const createClient = useCreateClient();
  const updateClient = useUpdateClient(client?.id ?? '');
  const [cepLoading, setCepLoading] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  /** Último CNPJ consultado, para não repetir a busca a cada tecla. */
  const lastCnpjLookup = useRef<string | null>(null);
  /**
   * Último CEP já resolvido — evita reconsultar o ViaCEP e, principalmente,
   * impede que o endereço preenchido pelo autocomplete do CNPJ seja
   * sobrescrito quando o campo CEP perde o foco.
   */
  const lastCepLookup = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (open) {
      reset(client ? toValues(client) : EMPTY);
      lastCnpjLookup.current = null;
      lastCepLookup.current = null;
    }
  }, [open, client, reset]);

  /** Consulta o ViaCEP e preenche o endereço quando o CEP tem 8 dígitos. */
  const lookupCep = async (raw: string) => {
    const cep = raw.replace(/\D/g, '');
    if (cep.length !== 8) return;
    if (lastCepLookup.current === cep) return;
    lastCepLookup.current = cep;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = (await res.json()) as ViaCepResponse;
      if (data.erro) {
        toast.error('CEP não encontrado.');
        return;
      }
      setValue('street', data.logradouro ?? '');
      setValue('district', data.bairro ?? '');
      setValue('city', data.localidade ?? '');
      setValue('state', data.uf ?? '');
      if (data.complemento) setValue('complement', data.complemento);
      setFocus('number');
    } catch {
      toast.error('Falha ao buscar o CEP.');
    } finally {
      setCepLoading(false);
    }
  };

  /**
   * Consulta a BrasilAPI e preenche os dados da empresa quando o CNPJ tem
   * 14 dígitos. Disparada ao completar o documento (último dígito digitado).
   */
  const lookupCnpj = async (digits: string) => {
    if (digits.length !== 14) return;
    if (lastCnpjLookup.current === digits) return;
    lastCnpjLookup.current = digits;
    setCnpjLoading(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
      if (!res.ok) {
        toast.error('CNPJ não encontrado.');
        return;
      }
      const data = (await res.json()) as BrasilApiCnpjResponse;
      if (data.razao_social) setValue('name', data.razao_social);
      if (data.nome_fantasia) setValue('tradeName', data.nome_fantasia);
      if (data.email) setValue('email', data.email.toLowerCase());
      if (data.ddd_telefone_1)
        setValue('phone', onlyDigits(data.ddd_telefone_1).slice(0, 11));
      if (data.cep) {
        const cep = onlyDigits(data.cep);
        setValue('zipCode', cep);
        // Marca o CEP como já resolvido para o ViaCEP não sobrescrever
        // o endereço vindo do CNPJ ao sair do campo CEP.
        if (cep.length === 8) lastCepLookup.current = cep;
      }
      if (data.logradouro) setValue('street', data.logradouro);
      if (data.numero) setValue('number', data.numero);
      if (data.complemento) setValue('complement', data.complemento);
      if (data.bairro) setValue('district', data.bairro);
      if (data.municipio) setValue('city', data.municipio);
      if (data.uf) setValue('state', data.uf);
      toast.success('Dados da empresa preenchidos.');
    } catch {
      toast.error('Falha ao buscar o CNPJ.');
    } finally {
      setCnpjLoading(false);
    }
  };

  const onSubmit = async (v: Values) => {
    const body = {
      name: v.name.trim(),
      tradeName: blank(v.tradeName),
      personType: v.personType,
      document: blank(v.document),
      email: blank(v.email),
      phone: blank(v.phone),
      website: blank(v.website),
      source: v.source,
      status: v.status,
      tags: v.tagsText
        ? v.tagsText
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      notes: blank(v.notes),
      zipCode: blank(v.zipCode),
      street: blank(v.street),
      number: blank(v.number),
      complement: blank(v.complement),
      district: blank(v.district),
      city: blank(v.city),
      state: blank(v.state),
    };
    try {
      if (isEdit) {
        await updateClient.mutateAsync(body);
        toast.success('Cliente atualizado.');
      } else {
        await createClient.mutateAsync(body);
        toast.success('Cliente criado.');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        extractApiMessage(
          error,
          isEdit
            ? 'Falha ao atualizar o cliente.'
            : 'Falha ao criar o cliente.',
        ),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar cliente' : 'Novo cliente'}
          </DialogTitle>
          <DialogDescription>Preencha os dados do cliente.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={handleSubmit(onSubmit)}
            id="client-form"
          >
            <Field className="sm:col-span-2" data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name">Nome</FieldLabel>
              <Input
                id="name"
                aria-invalid={!!errors.name}
                {...register('name')}
              />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="tradeName">Nome fantasia</FieldLabel>
              <Input id="tradeName" {...register('tradeName')} />
            </Field>

            <Field>
              <FieldLabel>Tipo de pessoa</FieldLabel>
              <Controller
                control={control}
                name="personType"
                render={({ field }) => (
                  <Select<PersonType>
                    value={field.value}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <SelectTrigger />
                    <SelectContent>
                      {(Object.keys(PERSON_TYPE_LABELS) as PersonType[]).map(
                        (t) => (
                          <SelectItem key={t} value={t}>
                            {translatePersonType(t)}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field data-invalid={!!errors.document}>
              <FieldLabel htmlFor="document">CPF / CNPJ</FieldLabel>
              <div className="relative">
                <Controller
                  control={control}
                  name="document"
                  render={({ field }) => (
                    <Input
                      id="document"
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      aria-invalid={!!errors.document}
                      value={maskDocument(field.value ?? '')}
                      onChange={(e) => {
                        const digits = onlyDigits(e.target.value);
                        field.onChange(digits);
                        if (digits.length === 14) {
                          setValue('personType', 'COMPANY');
                          void lookupCnpj(digits);
                        }
                      }}
                      onBlur={field.onBlur}
                    />
                  )}
                />
                {cnpjLoading && (
                  <Spinner className="absolute top-1/2 right-3 -translate-y-1/2" />
                )}
              </div>
              {errors.document && (
                <FieldError>{errors.document.message}</FieldError>
              )}
            </Field>

            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="email">E-mail</FieldLabel>
              <Input
                id="email"
                type="email"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
              {errors.email && <FieldError>{errors.email.message}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="phone">Telefone</FieldLabel>
              <Controller
                control={control}
                name="phone"
                render={({ field }) => (
                  <Input
                    id="phone"
                    inputMode="numeric"
                    placeholder="(00) 00000-0000"
                    value={maskPhone(field.value ?? '')}
                    onChange={(e) => field.onChange(onlyDigits(e.target.value))}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="website">Website</FieldLabel>
              <Input id="website" {...register('website')} />
            </Field>

            <Field>
              <FieldLabel>Origem</FieldLabel>
              <Controller
                control={control}
                name="source"
                render={({ field }) => (
                  <Select<LeadSource | ''>
                    value={field.value ?? ''}
                    onValueChange={(v) => field.onChange(v || undefined)}
                  >
                    <SelectTrigger />
                    <SelectContent>
                      <SelectItem value="">Não informada</SelectItem>
                      {(Object.keys(LEAD_SOURCE_LABELS) as LeadSource[]).map(
                        (s) => (
                          <SelectItem key={s} value={s}>
                            {translateLeadSource(s)}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field>
              <FieldLabel>Status</FieldLabel>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select<ClientStatus>
                    value={field.value}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <SelectTrigger />
                    <SelectContent>
                      {(
                        Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]
                      ).map((s) => (
                        <SelectItem key={s} value={s}>
                          {translateClientStatus(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="tagsText">Tags</FieldLabel>
              <Input
                id="tagsText"
                placeholder="Separe por vírgula"
                {...register('tagsText')}
              />
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="notes">Observações</FieldLabel>
              <textarea
                id="notes"
                rows={3}
                className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                {...register('notes')}
              />
            </Field>

            <FieldLegend variant="label" className="sm:col-span-2 mt-2 mb-0">
              Endereço
            </FieldLegend>

            <Field>
              <FieldLabel htmlFor="zipCode">CEP</FieldLabel>
              <div className="relative">
                <Controller
                  control={control}
                  name="zipCode"
                  render={({ field }) => (
                    <Input
                      id="zipCode"
                      inputMode="numeric"
                      placeholder="00000-000"
                      value={maskCep(field.value ?? '')}
                      onChange={(e) =>
                        field.onChange(onlyDigits(e.target.value))
                      }
                      onBlur={(e) => {
                        field.onBlur();
                        void lookupCep(e.target.value);
                      }}
                    />
                  )}
                />
                {cepLoading && (
                  <Spinner className="absolute top-1/2 right-3 -translate-y-1/2" />
                )}
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="number">Número</FieldLabel>
              <Input id="number" {...register('number')} />
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="street">Logradouro</FieldLabel>
              <Input id="street" {...register('street')} />
            </Field>

            <Field>
              <FieldLabel htmlFor="complement">Complemento</FieldLabel>
              <Input id="complement" {...register('complement')} />
            </Field>

            <Field>
              <FieldLabel htmlFor="district">Bairro</FieldLabel>
              <Input id="district" {...register('district')} />
            </Field>

            <Field>
              <FieldLabel htmlFor="city">Cidade</FieldLabel>
              <Input id="city" {...register('city')} />
            </Field>

            <Field>
              <FieldLabel htmlFor="state">UF</FieldLabel>
              <Controller
                control={control}
                name="state"
                render={({ field }) => (
                  <Input
                    id="state"
                    maxLength={2}
                    placeholder="UF"
                    value={field.value ?? ''}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value
                          .replace(/[^a-zA-Z]/g, '')
                          .toUpperCase()
                          .slice(0, 2),
                      )
                    }
                    onBlur={field.onBlur}
                  />
                )}
              />
            </Field>
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
          <Button type="submit" form="client-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isEdit ? 'Salvar' : 'Criar cliente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
