import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { extractApiMessage } from '@/lib/api-error';
import {
  useAtualizarWebhook,
  useCriarWebhook,
  useEventosDeWebhook,
} from './api/hooks';
import type { Webhook } from './api/types';

const schema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(80, 'Máximo 80 caracteres'),
  url: z
    .string()
    .trim()
    .min(1, 'A URL é obrigatória.')
    // A API recusa qualquer coisa fora de HTTPS (validarUrlDeWebhook); avisar
    // aqui evita a ida ao servidor só para ouvir isso.
    .regex(/^https:\/\//i, 'A URL deve começar com https://.'),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente = cadastro. Presente = edição (sem segredo novo). */
  webhook?: Webhook | null;
  /** Chamado no cadastro, com o segredo — a página o exibe num diálogo próprio. */
  onCriado: (resultado: { segredo: string; nome: string }) => void;
}

/**
 * Cadastro e edição de webhook da workspace. No **cadastro** o salvamento gera o
 * segredo de assinatura, e quem exibe o valor é a página, num diálogo próprio —
 * nunca empilhado sobre este. Na **edição** não há segredo novo: para trocá-lo
 * existe "Rotacionar segredo".
 */
export function WebhookDialog({
  open,
  onOpenChange,
  webhook,
  onCriado,
}: Props) {
  const { data: eventos, isLoading: carregandoEventos } =
    useEventosDeWebhook();
  const criar = useCriarWebhook();
  const atualizar = useAtualizarWebhook();
  const editando = Boolean(webhook);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { nome: '', url: '' },
  });

  useEffect(() => {
    if (open) {
      reset({ nome: webhook?.nome ?? '', url: '' });
      setSelecionados(new Set(webhook?.eventos ?? []));
    }
  }, [open, webhook]); // eslint-disable-line react-hooks/exhaustive-deps

  const alternar = (key: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Trocar a URL derruba a verificação no servidor: o CRM não sabe se o endereço
  // novo responde. A tela avisa antes de a pessoa salvar.
  const trocandoUrl = editando && watch('url').trim().length > 0;

  const onSubmit = async (values: Values) => {
    const eventosEscolhidos = [...selecionados];
    try {
      if (webhook) {
        await atualizar.mutateAsync({
          id: webhook.id,
          body: {
            nome: values.nome,
            eventos: eventosEscolhidos,
            // URL em branco na edição = manter a atual.
            ...(values.url.trim() ? { url: values.url.trim() } : {}),
          },
        });
        toast.success(
          trocandoUrl
            ? 'Webhook atualizado. O endereço mudou: verifique de novo para reativar.'
            : 'Webhook atualizado.',
        );
        onOpenChange(false);
        return;
      }
      const criado = await criar.mutateAsync({
        nome: values.nome,
        url: values.url.trim(),
        eventos: eventosEscolhidos,
      });
      onOpenChange(false);
      onCriado({ segredo: criado.segredo, nome: criado.webhook.nome });
    } catch (err) {
      const message = extractApiMessage(
        err,
        'Não foi possível salvar o webhook. Tente novamente.',
      );
      // Nome repetido é erro de campo, não de sistema.
      if (isAxiosError(err) && err.response?.status === 409) {
        setError('nome', { message });
        return;
      }
      // 422 é a trava de SSRF/HTTPS do servidor: a mensagem nomeia o problema
      // da URL, então ela pertence ao campo.
      if (isAxiosError(err) && err.response?.status === 422) {
        setError('url', { message });
        return;
      }
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editando ? 'Editar webhook' : 'Novo webhook'}
          </DialogTitle>
          <DialogDescription>
            {editando
              ? 'Altere o nome e os eventos. Deixe a URL em branco para mantê-la.'
              : 'Ao salvar, geramos o segredo que o seu receptor usa para verificar a assinatura. Ele aparece uma única vez, e o webhook nasce inativo: depois de criar, use "Verificar".'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            className="space-y-4"
            onSubmit={handleSubmit(onSubmit)}
            id="webhook-form"
          >
            <p className="text-xs text-muted-foreground">
              <strong className="font-medium text-foreground">
                O conteúdo enviado sai da sua workspace.
              </strong>{' '}
              Ele carrega nome de cliente e valor de cobrança, então use só um
              endereço que você controla. A URL também é credencial: quem a
              tiver consegue mandar corpo parecido para ela.
            </p>

            <Field data-invalid={!!errors.nome}>
              <FieldLabel htmlFor="webhook-nome" required>
                Nome
              </FieldLabel>
              <Input
                id="webhook-nome"
                placeholder="n8n de faturamento, Zapier do comercial…"
                aria-invalid={!!errors.nome}
                {...register('nome')}
              />
              {errors.nome && <FieldError>{errors.nome.message}</FieldError>}
            </Field>

            <Field data-invalid={!!errors.url}>
              <FieldLabel htmlFor="webhook-url" required={!editando}>
                URL (HTTPS)
              </FieldLabel>
              <Input
                id="webhook-url"
                type="url"
                placeholder={
                  editando
                    ? `Atual: ${webhook?.host ?? '—'} (em branco mantém)`
                    : 'https://n8n.minhaempresa.com/webhook/crm'
                }
                aria-invalid={!!errors.url}
                {...register('url')}
              />
              {errors.url ? (
                <FieldError>{errors.url.message}</FieldError>
              ) : (
                <FieldDescription>
                  {trocandoUrl
                    ? 'Trocar o endereço desliga o webhook: verifique de novo para reativar.'
                    : 'Porta 443 e endereço público. Rede interna é recusada.'}
                </FieldDescription>
              )}
            </Field>

            <div className="space-y-3">
              <FieldLabel required>Eventos</FieldLabel>
              <div className="space-y-2 rounded-lg border p-3">
                {carregandoEventos ? (
                  <p className="text-sm text-muted-foreground">
                    Carregando eventos…
                  </p>
                ) : (
                  eventos?.map((evento) => (
                    <label
                      key={evento.key}
                      className="flex cursor-pointer items-start gap-3 text-sm"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={selecionados.has(evento.key)}
                        onCheckedChange={() => alternar(evento.key)}
                        aria-label={evento.label}
                      />
                      <span className="flex-1">
                        <span className="font-medium">{evento.label}</span>
                        <span className="block text-muted-foreground">
                          {evento.description}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
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
            form="webhook-form"
            disabled={isSubmitting || selecionados.size === 0}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {editando ? 'Salvar' : 'Criar webhook'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
