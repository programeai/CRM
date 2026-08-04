import { useState } from 'react';
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmTypedDialog } from '@/components/ui/confirm-typed-dialog';
import { SectionHeading } from '@/components/ui/section-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { extractApiMessage } from '@/lib/api-error';
import { useMe } from '@/features/perfil/api/hooks';
import { AtivarTotpDialog } from './AtivarTotpDialog';
import { CodigosDeRecuperacaoDialog } from './CodigosDeRecuperacaoDialog';
import { ReautenticarDialog } from './ReautenticarDialog';
import type { Reautenticacao } from './api/types';
import {
  useDesativarSegundoFator,
  useRegenerarCodigos,
  useStatusDoSegundoFator,
} from './api/hooks';

/** Os códigos em exibição única, e de onde eles vieram. */
interface CodigosExibidos {
  codigos: string[];
  regenerado: boolean;
}

/**
 * Aba "Segurança" de `/configuracoes`: o segundo fator da **própria** conta.
 *
 * Sem gate por `isOwner`, como Perfil e Dispositivos: o 2FA de alguém é de quem o
 * liga. O owner **não** pode exigi-lo de um colaborador — isso criaria um estado
 * "logado mas obrigado a configurar" em toda rota e no cliente HTTP.
 */
export default function SegurancaPage() {
  const { data: status, isLoading } = useStatusDoSegundoFator();
  const { data: me } = useMe();
  const desativar = useDesativarSegundoFator();
  const regenerar = useRegenerarCodigos();

  const [ativando, setAtivando] = useState(false);
  const [desativando, setDesativando] = useState(false);
  const [regenerando, setRegenerando] = useState(false);
  const [codigos, setCodigos] = useState<CodigosExibidos | null>(null);

  /**
   * Quem entrou por login social e nunca definiu senha não tem senha para provar
   * — para essa conta a reautenticação é por código do autenticador. É o mesmo
   * `hasPassword` que o encerramento de conta usa.
   */
  const temSenha = me?.hasPassword !== false;

  const confirmarDesativacao = async (confirmacao: Reautenticacao) => {
    try {
      await desativar.mutateAsync(confirmacao);
      setDesativando(false);
      toast.success(
        'Segundo fator desativado. O login volta a ser em um passo.',
      );
    } catch (err) {
      toast.error(
        extractApiMessage(err, 'Não foi possível desativar o segundo fator.'),
      );
    }
  };

  /**
   * A API exige reautenticação também aqui (ASVS 3.7.1) — daí o diálogo pedir a
   * senha (ou um código, na conta sem senha) antes de trocar os 16 códigos.
   */
  const confirmarRegeneracao = async (confirmacao: Reautenticacao) => {
    try {
      const { codigosDeRecuperacao } =
        await regenerar.mutateAsync(confirmacao);
      setRegenerando(false);
      setCodigos({ codigos: codigosDeRecuperacao, regenerado: true });
    } catch (err) {
      toast.error(
        extractApiMessage(err, 'Não foi possível gerar códigos novos.'),
      );
    }
  };

  if (isLoading) {
    return (
      <section className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </section>
    );
  }

  // A instância não tem chave de cifra: o 2FA não existe aqui. Mesmo tratamento
  // que SMTP ausente e captcha ausente recebem no resto do app.
  if (!status?.disponivel) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Segurança"
          description="Camadas extras de proteção da sua conta."
        />
        <div className="rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <ShieldOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                O segundo fator não está disponível nesta instalação
              </p>
              <p className="text-sm text-muted-foreground">
                Quem administra o servidor precisa configurar a chave de cifra do
                segundo fator (<code className="font-mono text-xs">TOTP_ENCRYPTION_KEY</code>).
                Enquanto isso, o login continua sendo e-mail e senha.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title="Segurança"
        description="Camadas extras de proteção da sua conta."
      />

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className={
                status.ativo
                  ? 'mt-0.5 size-5 shrink-0 text-primary'
                  : 'mt-0.5 size-5 shrink-0 text-muted-foreground'
              }
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">
                  Verificação em duas etapas (2FA)
                </p>
                {status.ativo ? (
                  <Badge>Ativa</Badge>
                ) : (
                  <Badge variant="outline">Inativa</Badge>
                )}
              </div>
              <p className="max-w-prose text-sm text-muted-foreground">
                {status.ativo
                  ? 'Ao entrar, além da senha o CRM pede um código do seu app autenticador. Só você tem esse app.'
                  : 'Um código de 6 dígitos do seu celular, além da senha. Quem descobrir a sua senha ainda não entra.'}
              </p>
              {status.ativo && (
                <p className="text-sm text-muted-foreground">
                  <strong className="font-medium text-foreground">
                    {status.codigosRestantes}
                  </strong>{' '}
                  {status.codigosRestantes === 1
                    ? 'código de recuperação restante'
                    : 'códigos de recuperação restantes'}
                  {status.codigosRestantes <= 3 && (
                    <span className="text-destructive">
                      {' '}
                      — gere novos antes de acabar.
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {status.ativo ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRegenerando(true)}
                >
                  <KeyRound data-icon="inline-start" />
                  Gerar códigos novos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDesativando(true)}
                >
                  Desativar
                </Button>
              </>
            ) : (
              <Button type="button" onClick={() => setAtivando(true)}>
                <ShieldCheck data-icon="inline-start" />
                Ativar 2FA
              </Button>
            )}
          </div>
        </div>
      </div>

      <AtivarTotpDialog
        open={ativando}
        onOpenChange={setAtivando}
        onAtivado={(lista) => setCodigos({ codigos: lista, regenerado: false })}
      />

      {/*
        Desativar é a operação perigosa desta tela: remove uma camada de proteção
        da conta. Com senha, `ConfirmTypedDialog` — o e-mail digitado E a senha,
        mesmo primitivo do encerramento de conta. Sem senha (login social), o
        primitivo não serve: ele só sabe pedir senha, e a conta não tem uma. Aí a
        prova é o código do autenticador, que é o que a API aceita para ela.
      */}
      {temSenha ? (
        <ConfirmTypedDialog
          open={desativando}
          onOpenChange={setDesativando}
          title="Desativar a verificação em duas etapas?"
          description="A sua conta volta a ser protegida só pela senha, e os seus códigos de recuperação são apagados. Você pode ativar de novo depois, com um QR novo."
          expected={me?.email ?? ''}
          expectedLabel="o seu e-mail"
          secret
          secretLabel="Sua senha"
          confirmLabel="Desativar 2FA"
          pendingLabel="Desativando…"
          pending={desativar.isPending}
          onConfirm={(senha) =>
            void confirmarDesativacao({ password: senha })
          }
        />
      ) : (
        <ReautenticarDialog
          open={desativando}
          onOpenChange={setDesativando}
          title="Desativar a verificação em duas etapas?"
          description="A sua conta volta a ser protegida só pela senha do provedor social, e os seus códigos de recuperação são apagados."
          temSenha={false}
          confirmLabel="Desativar 2FA"
          pendingLabel="Desativando…"
          destructive
          pending={desativar.isPending}
          onConfirm={(c) => void confirmarDesativacao(c)}
        />
      )}

      <ReautenticarDialog
        open={regenerando}
        onOpenChange={setRegenerando}
        title="Gerar códigos de recuperação novos?"
        description="Os 16 códigos atuais deixam de valer imediatamente, inclusive os que você ainda não usou. Guarde os novos no lugar dos antigos."
        temSenha={temSenha}
        confirmLabel="Gerar novos"
        pendingLabel="Gerando…"
        destructive
        pending={regenerar.isPending}
        onConfirm={(c) => void confirmarRegeneracao(c)}
      />

      {/* Diálogo próprio: NUNCA empilhado sobre o de confirmação. */}
      <CodigosDeRecuperacaoDialog
        codigos={codigos?.codigos ?? null}
        regenerado={codigos?.regenerado}
        onFechar={() => setCodigos(null)}
      />
    </section>
  );
}
