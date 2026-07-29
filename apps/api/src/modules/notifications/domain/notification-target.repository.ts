import type {
  NotificationChannelKind,
  NotificationType,
  Prisma,
  UserNotificationTarget,
} from '@prisma/client';

export const NOTIFICATION_TARGET_REPOSITORY = Symbol(
  'NOTIFICATION_TARGET_REPOSITORY',
);

/**
 * Todo o catálogo de tipos — o que um destino provisionado por padrão (conta
 * nova, aceite de convite) recebe. Fonte única para não desatualizar quando um
 * tipo novo entrar no enum.
 *
 * Vale só para destino NOVO. Tipo acrescentado aqui não entra sozinho nos
 * destinos que já existem (`types` é opt-in por destino, e nenhuma migration
 * escreve preferência de usuário): quem já tinha destino configurado marca o
 * tipo novo na tela de preferências.
 */
export const TIPOS_PADRAO: NotificationType[] = [
  'FOLLOW_UP_DUE',
  'DEAL_STALE',
  'PROPOSAL_EXPIRING',
  'PAYMENT_DUE',
  'PAYMENT_OVERDUE',
  'TASK_OVERDUE',
  'RECORD_ASSIGNED',
  'LEAD_RECEIVED',
];

/** Um destino de e-mail elegível ao digest, com o endereço já resolvido. */
export interface DestinoDeDigest {
  ownerId: string;
  userId: string;
  email: string;
}

export interface NotificationTargetRepository {
  /** Destinos ativos+verificados do usuário que assinaram este tipo (request). */
  findElegiveis(
    ownerId: string,
    userId: string,
    tipo: NotificationType,
  ): Promise<Pick<UserNotificationTarget, 'id' | 'kind'>[]>;
  /** Idem, pelo client admin — o cron não tem `app.owner_id`. */
  findElegiveisPeloSistema(
    ownerId: string,
    userId: string,
    tipo: NotificationType,
  ): Promise<Pick<UserNotificationTarget, 'id' | 'kind'>[]>;

  findManyByUser(
    ownerId: string,
    userId: string,
  ): Promise<UserNotificationTarget[]>;
  criar(
    data: Prisma.UserNotificationTargetUncheckedCreateInput,
  ): Promise<UserNotificationTarget>;
  atualizar(
    ownerId: string,
    userId: string,
    id: string,
    data: Prisma.UserNotificationTargetUpdateInput,
  ): Promise<UserNotificationTarget | null>;
  excluir(ownerId: string, userId: string, id: string): Promise<boolean>;

  /** Provisionamento na criação da conta / aceite de convite — client admin. */
  provisionarPadraoPeloSistema(params: {
    ownerId: string;
    userId: string;
    email: string;
    kinds: NotificationChannelKind[];
  }): Promise<void>;

  /**
   * Destinos `EMAIL` ativos e verificados de TODOS os owners — o insumo do digest.
   * Cross-owner pelo client admin. O endereço sai da `config` do destino, não do
   * `User.email`: quem cadastrou um segundo e-mail quer receber NELE.
   */
  findDestinosDeDigestPeloSistema(): Promise<DestinoDeDigest[]>;
}
