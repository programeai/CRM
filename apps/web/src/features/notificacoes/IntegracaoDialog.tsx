import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { extractApiMessage } from '@/lib/api-error';
import { useCriarIntegracao } from './api/hooks';
import { ListaDeEventos } from './ListaDeEventos';
import { NOTIFICATION_TYPES } from '@/lib/labels';
import { alternarTipo } from './tipos';

/** Rótulos dos serviços de integração — o `Select` precisa do map. */
const KIND_INTEGRACAO = {
  WEBHOOK: 'Webhook',
  SLACK: 'Slack',
  DISCORD: 'Discord',
  TELEGRAM: 'Telegram',
} as const;
type KindIntegracao = keyof typeof KIND_INTEGRACAO;

const schema = z
  .object({
    label: z.string().min(1, 'O rótulo é obrigatório.'),
    kind: z.enum(['WEBHOOK', 'SLACK', 'DISCORD', 'TELEGRAM']),
    url: z.string().optional(),
    // O Telegram não é "cole uma URL": a Bot API quer um token e um chat_id, que
    // é o que o usuário tem em mãos. A URL sai destes dois no `onSubmit`.
    token: z.string().optional(),
    chatId: z.string().optional(),
    types: z.array(z.enum(NOTIFICATION_TYPES)).min(1, 'Selecione ao menos um evento.'),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'TELEGRAM') {
      if (!v.token?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['token'],
          message: 'O token do bot é obrigatório.',
        });
      }
      if (!v.chatId?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['chatId'],
          message: 'O chat id é obrigatório.',
        });
      }
      return;
    }
    const url = v.url?.trim();
    if (!url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'A URL é obrigatória.',
      });
      return;
    }
    // A API recusa qualquer coisa fora de HTTPS (validarUrlDeWebhook); avisar
    // aqui evita a ida ao servidor só para ouvir isso.
    if (!/^https:\/\//i.test(url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'A URL deve começar com https://.',
      });
    }
  });
type Values = z.infer<typeof schema>;

/**
 * Nasce com os seis tipos marcados: é o mesmo padrão que a API aplica quando o
 * corpo não manda `types` (`TIPOS_PADRAO`). Quem quiser menos, desmarca aqui.
 */
const VAZIO: Values = {
  label: '',
  kind: 'SLACK',
  url: '',
  token: '',
  chatId: '',
  types: [...NOTIFICATION_TYPES],
};

/**
 * Monta o `sendMessage` da Bot API a partir do que o usuário tem em mãos: o
 * token que o @BotFather entrega e o id do chat. É o front que monta porque a
 * `config` do destino guarda só `{ url }` — assim o Telegram entra sem um
 * segundo campo no banco, na API e no DTO.
 *
 * O `chat_id` vai na query, e o adapter da API o move para o corpo JSON. O
 * `encodeURIComponent` importa: chat de canal pode ser `@nome`, e o `@` cru
 * quebraria a query.
 */
function montarUrlTelegram(token: string, chatId: string): string {
  return `https://api.telegram.org/bot${token}/sendMessage?chat_id=${encodeURIComponent(chatId)}`;
}

/**
 * Cadastra um destino de integração (Slack, Discord, Telegram, webhook). Só é
 * renderizado para quem tem `notificacao:integrar` — e o aviso sobre a URL ser o
 * segredo é obrigatório: quem tiver aquele endereço escreve no canal.
 */
export function IntegracaoDialog({
  open,
  onOpenChange,
  onSegredoGerado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Chamado quando a criação gerou segredo de assinatura (só no kind WEBHOOK).
   * Quem exibe é a tela, num diálogo próprio — nunca empilhado sobre este.
   */
  onSegredoGerado: (resultado: { segredo: string; rotulo: string }) => void;
}) {
  const criar = useCriarIntegracao();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: VAZIO });

  // Reabrir o diálogo tem de começar limpo, sem o que ficou da vez anterior.
  useEffect(() => {
    if (open) reset(VAZIO);
  }, [open, reset]);

  const ehTelegram = watch('kind') === 'TELEGRAM';

  const onSubmit = async (v: Values) => {
    const rotulo = v.label.trim();
    try {
      const { segredo } = await criar.mutateAsync({
        label: rotulo,
        kind: v.kind,
        url: ehTelegram
          ? montarUrlTelegram(v.token!.trim(), v.chatId!.trim())
          : v.url!.trim(),
        types: v.types,
      });
      toast.success(
        'Integração criada. Use "Testar e ativar" para começar a receber.',
      );
      onOpenChange(false);
      // Só o kind WEBHOOK gera segredo. Fecha este diálogo antes de a tela abrir
      // o de exibição única: nunca dois modais empilhados.
      if (segredo) onSegredoGerado({ segredo, rotulo });
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao criar a integração.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova integração</DialogTitle>
          <DialogDescription>
            Entregue os avisos num canal do time e marque quais eventos saem por
            ele — dá para mudar depois, no cartão da integração. A integração
            nasce inativa: depois de criar, use "Testar e ativar".
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={handleSubmit(onSubmit)} id="integracao-form">
            <FieldGroup>
              <p className="text-xs text-muted-foreground">
                <strong className="font-medium text-foreground">
                  {ehTelegram ? 'O token é o segredo.' : 'A URL é o segredo.'}
                </strong>{' '}
                Quem tiver {ehTelegram ? 'esse token' : 'esse endereço'} consegue
                escrever no seu canal — trate-o como uma senha. O conteúdo
                enviado carrega nome de cliente e valor de cobrança, então use só
                um destino que você controla.
              </p>
              <Field data-invalid={!!errors.label}>
                <FieldLabel htmlFor="integracao-label" required>
                  Rótulo
                </FieldLabel>
                <Input
                  id="integracao-label"
                  placeholder="Canal do time"
                  aria-invalid={!!errors.label}
                  {...register('label')}
                />
                {errors.label && (
                  <FieldError>{errors.label.message}</FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="integracao-kind" required>
                  Serviço
                </FieldLabel>
                <Controller
                  control={control}
                  name="kind"
                  render={({ field }) => (
                    <Select<KindIntegracao>
                      items={KIND_INTEGRACAO}
                      value={field.value}
                      // O `onValueChange` do base-ui pode emitir null (limpar);
                      // aqui o campo é obrigatório, então null mantém a escolha.
                      onValueChange={(v) => v && field.onChange(v)}
                    >
                      <SelectTrigger id="integracao-kind" />
                      <SelectContent>
                        {(Object.keys(KIND_INTEGRACAO) as KindIntegracao[]).map(
                          (k) => (
                            <SelectItem key={k} value={k}>
                              {KIND_INTEGRACAO[k]}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              {ehTelegram ? (
                <>
                  <Field data-invalid={!!errors.token}>
                    <FieldLabel htmlFor="integracao-token" required>
                      Token do bot
                    </FieldLabel>
                    <Input
                      id="integracao-token"
                      placeholder="123456789:AAE…"
                      aria-invalid={!!errors.token}
                      {...register('token')}
                    />
                    {errors.token ? (
                      <FieldError>{errors.token.message}</FieldError>
                    ) : (
                      <FieldDescription>
                        O que o @BotFather devolve ao criar o bot.
                      </FieldDescription>
                    )}
                  </Field>
                  <Field data-invalid={!!errors.chatId}>
                    <FieldLabel htmlFor="integracao-chat" required>
                      Chat ID
                    </FieldLabel>
                    <Input
                      id="integracao-chat"
                      placeholder="-1001234567890"
                      aria-invalid={!!errors.chatId}
                      {...register('chatId')}
                    />
                    {errors.chatId ? (
                      <FieldError>{errors.chatId.message}</FieldError>
                    ) : (
                      <FieldDescription>
                        O id do chat ou do grupo. Em canal público vale o @nome.
                      </FieldDescription>
                    )}
                  </Field>
                </>
              ) : (
                <Field data-invalid={!!errors.url}>
                  <FieldLabel htmlFor="integracao-url" required>
                    URL (HTTPS)
                  </FieldLabel>
                  <Input
                    id="integracao-url"
                    type="url"
                    placeholder="https://hooks.slack.com/services/…"
                    aria-invalid={!!errors.url}
                    {...register('url')}
                  />
                  {errors.url && <FieldError>{errors.url.message}</FieldError>}
                </Field>
              )}
              <Controller
                control={control}
                name="types"
                render={({ field }) => (
                  <ListaDeEventos
                    selecionados={field.value}
                    onAlternar={(tipo) =>
                      field.onChange(alternarTipo(field.value, tipo))
                    }
                    erro={errors.types?.message}
                  />
                )}
              />
            </FieldGroup>
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
          <Button type="submit" form="integracao-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Criar integração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
