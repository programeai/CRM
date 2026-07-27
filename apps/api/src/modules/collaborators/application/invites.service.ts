import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { MailService } from '../../../mail/mail.service';
import {
  INVITE_REPOSITORY,
  type InviteRepository,
  type InviteWithUser,
} from '../domain/invite.repository';
import { AuditService } from '../../audit/audit.service';

/** Validade do convite. Precisa acompanhar o texto do e-mail e da interface. */
export const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Dados exibidos na página pública do convite. */
export interface InvitePreview {
  name: string;
  email: string;
  /** Nome do owner que convidou — dá contexto de qual conta é o acesso. */
  ownerName: string;
}

/**
 * Convite de colaborador. O banco guarda apenas o **sha256** do token; o valor
 * bruto só existe no link entregue por e-mail (e devolvido uma vez ao owner,
 * para ele repassar por outro canal se o e-mail não chegar).
 *
 * Token de 32 bytes e uso único: emitir um convite novo invalida o anterior.
 */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    @Inject(INVITE_REPOSITORY) private readonly invites: InviteRepository,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Emite um convite, invalida os anteriores e envia o e-mail. Devolve o link
   * para a interface exibir — é o que mantém o fluxo utilizável sem SMTP.
   */
  async issue(params: {
    ownerId: string;
    ownerName: string;
    userId: string;
    name: string;
    email: string;
    roleName: string;
  }): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    await this.invites.replaceForUser({
      ownerId: params.ownerId,
      userId: params.userId,
      tokenHash: this.hash(rawToken),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    const inviteUrl = this.buildUrl(rawToken);
    await this.mail.sendCollaboratorInvite({
      to: params.email,
      name: params.name,
      ownerName: params.ownerName,
      roleName: params.roleName,
      inviteUrl,
    });
    return inviteUrl;
  }

  /** Consulta sem consumir, para renderizar a página do convite. */
  async preview(rawToken: string): Promise<InvitePreview> {
    const invite = await this.findValidOrFail(rawToken);
    return {
      name: invite.user.name,
      email: invite.user.email,
      ownerName: invite.owner.name,
    };
  }

  /**
   * Define a senha do colaborador e consome o convite. Devolve o `userId` para
   * o controller emitir a sessão — o convidado já entra logado.
   */
  async accept(rawToken: string, password: string): Promise<string> {
    const invite = await this.findValidOrFail(rawToken);
    const consumed = await this.invites.consumeAndActivate({
      inviteId: invite.id,
      userId: invite.userId,
      passwordHash: (await argon2.hash(password)) as string,
    });
    // Perdeu a corrida com outro envio do mesmo link.
    if (!consumed) throw this.expiredError();

    this.logger.log({
      evento: 'colaborador.convite_aceito',
      msg: 'Convite de colaborador aceito.',
      colaboradorId: invite.userId,
      ownerId: invite.ownerId,
    });
    // Rota @Public(): não há AccessContext no CLS, mas o autor É conhecido — o
    // próprio convidado. Vai pelo caminho de sistema (ownerId explícito, client
    // admin), com `actorType: 'USER'` e o `actorId` preenchido.
    await this.audit.registrarPeloSistema({
      ownerId: invite.ownerId,
      actorType: 'USER',
      actorId: invite.userId,
      actorName: invite.user.name,
      entity: 'USER',
      entityId: invite.userId,
      entityLabel: invite.user.name,
      action: 'ACEITAR',
      extra: { conviteId: invite.id },
    });
    return invite.userId;
  }

  /**
   * Convite vigente: existe, não usado, não expirado, colaborador ativo e ainda
   * sem senha definida. Qualquer desvio responde a **mesma** mensagem — não faz
   * diferença para o convidado saber qual dos casos ocorreu.
   */
  private async findValidOrFail(rawToken: string): Promise<InviteWithUser> {
    const invite = await this.invites.findByTokenHash(this.hash(rawToken));
    if (
      !invite ||
      invite.usedAt ||
      invite.expiresAt.getTime() < Date.now() ||
      invite.user.acceptedAt
    ) {
      throw this.expiredError();
    }
    if (!invite.user.active) {
      throw new ForbiddenException(
        'Este acesso foi desativado. Fale com o responsável pela conta.',
      );
    }
    return invite;
  }

  private expiredError() {
    return new GoneException(
      'Este convite não é mais válido. Peça um novo ao responsável pela conta.',
    );
  }

  /** Hash determinístico: permite busca indexada pelo token do link. */
  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private buildUrl(rawToken: string): string {
    const base = this.config.get<string>('FRONTEND_URL') ?? '';
    return `${base}/convite/${rawToken}`;
  }
}
