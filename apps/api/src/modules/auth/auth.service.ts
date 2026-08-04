import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuthProvider, type AccessRecordKind } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { UsersService } from '../users/users.service';
import { MailService } from '../../mail/mail.service';
import { SessionsService, type DeviceInfo } from './sessions.service';
import { AccessRecordsService } from './access-records.service';
import { TotpService } from './totp/totp.service';
import {
  TIPO_DO_DESAFIO,
  TTL_DO_DESAFIO,
  type PayloadDoDesafio,
} from './totp/desafio-de-2fa';
import type { AccessContext } from '../access/domain/access-context';
import type { OAuthProfile } from './oauth/oauth.service';

/** Validade do token de redefinição de senha. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

/** Par de tokens de uma sessão emitida. */
export interface SessaoEmitida {
  accessToken: string;
  refreshToken: string;
}

/**
 * Resultado do login: sessão **ou** desafio de segundo fator. Nunca os dois — é
 * o que o controller discrimina para decidir se emite o cookie de refresh.
 */
export type ResultadoDeLogin =
  SessaoEmitida | { twoFactorRequired: true; desafio: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private users: UsersService,
    private sessions: SessionsService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
    private accessRecords: AccessRecordsService,
    private totp: TotpService,
  ) {}

  async register(
    name: string,
    email: string,
    password: string,
    device: DeviceInfo = {},
  ) {
    this.assertRegistrationEnabled();
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }
    const user = await this.users.create({
      name,
      email,
      passwordHash: await this.hashSecret(password),
    });
    return this.issueTokens(user.id, device);
  }

  /**
   * Entra ou cadastra via OAuth. Se a identidade do provedor já é conhecida,
   * loga direto. Caso contrário, vincula por e-mail **verificado** a uma conta
   * existente ou cria uma nova conta sem senha.
   */
  async oauthLogin(
    provider: OAuthProvider,
    profile: OAuthProfile,
    device: DeviceInfo = {},
  ) {
    const linked = await this.users.findByProviderAccount(
      provider,
      profile.providerAccountId,
    );
    if (linked) {
      this.assertActive(linked.active);
      return this.issueTokens(linked.id, device, 'LOGIN_OAUTH');
    }

    if (!profile.email || !profile.emailVerified) {
      throw new UnauthorizedException(
        'Não foi possível obter um e-mail verificado do provedor.',
      );
    }

    const existing = await this.users.findByEmail(profile.email);
    if (existing) {
      this.assertActive(existing.active);
      await this.users.linkOAuthAccount(
        existing.id,
        provider,
        profile.providerAccountId,
      );
      return this.issueTokens(existing.id, device, 'LOGIN_OAUTH');
    }

    this.assertRegistrationEnabled();
    const created = await this.users.createWithOAuth({
      name: profile.name,
      email: profile.email,
      provider,
      providerAccountId: profile.providerAccountId,
    });
    return this.issueTokens(created.id, device, 'LOGIN_OAUTH');
  }

  async login(
    email: string,
    password: string,
    device: DeviceInfo = {},
  ): Promise<ResultadoDeLogin> {
    const user = await this.users.findByEmail(email);
    // `passwordHash` nulo = conta só-OAuth ou convite de colaborador ainda não
    // aceito: nos dois casos não há o que verificar, e a resposta é genérica.
    if (
      !user ||
      !user.passwordHash ||
      !(await argon2.verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    // A checagem vem DEPOIS da senha de propósito: sem isso, o erro específico
    // revelaria a existência da conta a quem não sabe a senha.
    this.assertActive(user.active);
    /*
      O segundo fator entra AQUI, e este é o único ponto do arquivo entre a
      validação da senha e a emissão de sessão.

      **Nada de `AccessRecord` neste ramo:** a lei fala de registro de ACESSO, e
      uma senha correta sem o segundo fator não é acesso. Ele é registrado em
      `concluirLoginCom2fa`, com kind `LOGIN_2FA`.
    */
    if (await this.totp.exigeSegundoFator(user.id)) {
      return {
        twoFactorRequired: true,
        desafio: await this.emitirDesafio(user.id),
      };
    }
    return this.issueTokens(user.id, device);
  }

  /**
   * Segundo passo: valida o desafio e o código (TOTP **ou** de recuperação) e
   * emite a sessão. `kind: 'LOGIN_2FA'` distingue o acesso com segundo fator do
   * comum — os dois são acessos bem-sucedidos, que é o que a tabela registra.
   */
  async concluirLoginCom2fa(
    desafio: string,
    codigo: string,
    device: DeviceInfo = {},
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const userId = await this.verificarDesafio(desafio);
    const ok =
      (await this.totp.verificar(userId, codigo)) ||
      (await this.totp.consumirCodigoDeRecuperacao(userId, codigo));
    if (!ok) {
      /*
        Sem o código no log, e sem e-mail: a linha vive 30 dias num Grafana
        publicado. O `TotpService` já emitiu `mfa.codigo_recusado` com o contador
        de falhas; esta linha registra que a recusa foi **no login**, que é o
        caminho que interessa vigiar.
      */
      this.logger.warn({
        evento: 'mfa.login_recusado',
        msg: 'Segundo fator recusado no login.',
        usuarioId: userId,
      });
      throw new UnauthorizedException('Código inválido ou expirado.');
    }
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    // Colaborador desativado ENTRE o primeiro e o segundo passo não entra.
    this.assertActive(user.active);
    return this.issueTokens(userId, device, 'LOGIN_2FA');
  }

  /** O JWT curto que representa "a senha já foi provada". */
  private emitirDesafio(sub: string): Promise<string> {
    const payload: PayloadDoDesafio = { sub, tipo: TIPO_DO_DESAFIO };
    return this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: TTL_DO_DESAFIO,
    });
  }

  /**
   * Valida o desafio e devolve o `userId`. O `tipo: 'mfa'` é conferido à mão e
   * **não** é detalhe: sem ele, um access token válido (mesmo segredo, mesmo
   * `sub`) seria aceito aqui e o segundo fator viraria decoração.
   */
  private async verificarDesafio(desafio: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<PayloadDoDesafio>(desafio, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
      if (payload.tipo !== TIPO_DO_DESAFIO || !payload.sub) {
        throw new Error('tipo inesperado');
      }
      return payload.sub;
    } catch {
      // Expirado, assinatura inválida ou token de outro propósito: a mensagem é
      // a mesma, e ela diz o que a pessoa precisa fazer (entrar de novo).
      throw new UnauthorizedException(
        'A confirmação expirou. Entre com e-mail e senha de novo.',
      );
    }
  }

  /**
   * Freio do autocadastro. Cobre os dois caminhos que criam conta por conta
   * própria: `register()` e o ramo de criação do `oauthLogin()`. Não cobre — e
   * não deve cobrir — o convite de colaborador, que é uma ação deliberada do
   * owner e passa pelo CollaboratorsService, não por aqui.
   */
  private assertRegistrationEnabled() {
    if (this.config.get<boolean>('REGISTRATION_ENABLED') === false) {
      // Sem e-mail no log: a linha vive 30 dias num Grafana publicado.
      this.logger.warn({
        evento: 'cadastro.bloqueado',
        msg: 'Tentativa de autocadastro com REGISTRATION_ENABLED=false.',
      });
      throw new ForbiddenException(
        'O autocadastro está desativado nesta instância. Peça um convite ao responsável pela conta.',
      );
    }
  }

  /** Colaborador desativado não entra nem renova sessão. */
  private assertActive(active: boolean) {
    if (!active) {
      throw new UnauthorizedException(
        'Seu acesso ao CRM foi desativado. Fale com o responsável pela conta.',
      );
    }
  }

  /**
   * Inicia a redefinição de senha. Anti-enumeração: nunca revela se o e-mail
   * existe — o retorno é sempre o mesmo. Invalida tokens pendentes anteriores
   * antes de emitir um novo.
   *
   * A conta criada por login social PASSA por aqui: é o único caminho pelo qual
   * ela ganha uma senha utilizável, e o token vai justamente para o e-mail
   * verificado que o provedor confirmou. Quem não passa é o convite de
   * colaborador ainda pendente (`acceptedAt` nulo) — deixá-lo redefinir senha
   * seria uma porta paralela ao link do convite, que ativaria o acesso sem
   * consumir o convite e deixaria o painel mostrando "PENDING" para sempre.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    // Os dois descartes são logados: sem isto o fluxo é uma caixa-preta — a
    // pessoa vê "enviamos as instruções", nada chega e não há linha nenhuma no
    // Grafana explicando o porquê. O e-mail NÃO entra no log (dado pessoal em
    // linha que vive 30 dias); o `usuarioId` basta para investigar.
    if (!user) {
      this.logger.log({
        evento: 'senha.redefinicao_descartada',
        msg: 'Redefinição de senha pedida para e-mail sem conta.',
        motivo: 'conta_inexistente',
      });
      return;
    }
    if (!user.acceptedAt) {
      this.logger.log({
        evento: 'senha.redefinicao_descartada',
        msg: 'Redefinição de senha pedida para convite ainda não aceito.',
        motivo: 'convite_pendente',
        usuarioId: user.id,
      });
      return;
    }

    await this.users.deletePendingResetTokens(user.id);

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashResetToken(rawToken);
    await this.users.createPasswordResetToken({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });

    const base = this.config.get<string>('FRONTEND_URL') ?? '';
    const resetUrl = `${base}/redefinir-senha?token=${rawToken}`;
    await this.mail.sendPasswordReset(user.email, resetUrl);
    this.logger.log({
      evento: 'senha.redefinicao_solicitada',
      msg: 'Link de redefinição de senha enviado.',
      usuarioId: user.id,
      // Distingue quem está TROCANDO a senha de quem está definindo a primeira
      // (conta de login social) — é a métrica que diz se o caminho novo pegou.
      primeiraSenha: user.passwordSetAt === null,
    });
  }

  /**
   * Conclui a redefinição: valida o token, troca a senha e revoga todas as
   * sessões ativas para forçar novo login em todo dispositivo.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.users.findResetTokenByHash(
      this.hashResetToken(rawToken),
    );
    if (!record) {
      throw new GoneException(
        'Link de redefinição inválido. Solicite um novo.',
      );
    }
    if (record.usedAt) {
      throw new GoneException(
        'Este link de redefinição já foi utilizado. Solicite um novo.',
      );
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new GoneException(
        'Este link de redefinição expirou. Solicite um novo.',
      );
    }

    await this.users.updatePassword(
      record.userId,
      await this.hashSecret(newPassword),
    );
    await this.users.markResetTokenUsed(record.id, new Date());
    await this.users.deletePendingResetTokens(record.userId);
    // Trocar a senha derruba TODOS os dispositivos: é o caminho de quem suspeita
    // que a conta foi acessada por outra pessoa.
    await this.sessions.revokeAll(record.userId);
  }

  /** Hash determinístico (sha256) do token bruto — permite busca indexada. */
  private hashResetToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * `argon2.hash` é tipado como `Promise<any>` na lib; sem `raw: true` sempre
   * retorna a hash codificada (string). Encapsula para conter o `any` num único
   * ponto e expor `Promise<string>` ao restante do serviço.
   */
  private hashSecret(plain: string): Promise<string> {
    return argon2.hash(plain) as Promise<string>;
  }

  /**
   * Renova o par de tokens **na mesma sessão**: o `sid` é estável por
   * dispositivo, então a linha de `Session` acompanha o aparelho ao longo do
   * tempo (é o que dá sentido a "último uso" na lista do perfil).
   */
  async refresh(
    sid: string,
    userId: string,
    refreshToken: string,
    device: DeviceInfo = {},
  ) {
    const session = await this.sessions.findById(sid);
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      !(await argon2.verify(session.tokenHash, refreshToken))
    ) {
      throw new UnauthorizedException();
    }
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    // Desativar o colaborador derruba a sessão dele no próximo refresh, mesmo
    // que o cookie ainda esteja no navegador.
    this.assertActive(user.active);

    const accessToken = await this.jwt.signAsync(
      { sub: userId, sid },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_TTL'),
      },
    );
    const nextRefresh = await this.jwt.signAsync(
      { sub: userId, sid },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_TTL'),
      },
    );
    await this.sessions.rotate(sid, await this.hashSecret(nextRefresh), device);
    return { accessToken, refreshToken: nextRefresh };
  }

  /**
   * Dados da sessão para o frontend. Além do cadastro (sem segredo), devolve o
   * contexto de acesso já resolvido pelo `AccessGuard` — o front usa
   * `permissions` para esconder navegação e ações, e `isOwner` para diferenciar
   * o dono da conta de um colaborador.
   */
  async me(userId: string, access: AccessContext) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    // `ownerId`/`roleId` ficam de fora: são o mesmo dado que `isOwner`/`role`
    // expressam melhor. As colunas de encerramento também saem cruas: viram o
    // objeto `deletion`, que o banner global consome — e assim o front não
    // precisa saber que existem duas colunas que andam em par.
    const {
      passwordHash,
      passwordSetAt,
      ownerId,
      roleId,
      deletionRequestedAt,
      deletionScheduledFor,
      ...safe
    } = user;

    // Encerramento agendado da WORKSPACE, não do próprio registro: no
    // colaborador, `deletionScheduledFor` do PRÓPRIO `User` é sempre nulo (a
    // invariante garante — colaborador não encerra workspace). O banner
    // precisa do agendamento do OWNER, então busca por `access.ownerId` quando
    // quem está logado é um colaborador.
    const agendamento =
      access.ownerId === userId
        ? { deletionRequestedAt, deletionScheduledFor }
        : ((await this.users.findDeletionSchedule(access.ownerId)) ?? {
            deletionRequestedAt: null,
            deletionScheduledFor: null,
          });

    return {
      ...safe,
      isOwner: access.isOwner,
      role: access.roleId ? { id: access.roleId, name: access.roleName } : null,
      permissions: access.permissions,
      /**
       * `false` no owner criado por OAuth que nunca redefiniu a senha. Repare
       * que a pergunta é `passwordSetAt`, NÃO `passwordHash`: a conta de login
       * social tem hash (aleatório, que ninguém conhece) desde o cadastro, e
       * responder por ele faria o diálogo de encerramento pedir uma senha
       * impossível de digitar. O diálogo usa isto para escolher entre pedir a
       * senha ou o e-mail — e é a única informação sobre autenticação que o
       * front recebe.
       */
      hasPassword: passwordSetAt !== null,
      /**
       * Encerramento agendado da WORKSPACE. Vem no `me` de todo mundo, owner ou
       * colaborador: o banner tem de avisar a equipe inteira, e só o owner vê o
       * botão de cancelar.
       */
      deletion: agendamento.deletionScheduledFor
        ? {
            requestedAt: agendamento.deletionRequestedAt,
            scheduledFor: agendamento.deletionScheduledFor,
          }
        : null,
    };
  }

  /** Emite sessão para um usuário já validado (usado no aceite do convite). */
  issueSession(userId: string, device: DeviceInfo = {}) {
    return this.issueTokens(userId, device, 'ACEITE_DE_CONVITE');
  }

  /**
   * Atualiza os dados cadastrais (nome e e-mail) do próprio usuário.
   * Como `email` é único, valida conflito com outra conta antes de gravar.
   */
  async updateProfile(userId: string, data: { name: string; email: string }) {
    const existing = await this.users.findByEmail(data.email);
    if (existing && existing.id !== userId) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }
    const user = await this.users.updateProfile(userId, data);
    const { passwordHash, ...safe } = user;
    return safe;
  }

  /** Encerra apenas a sessão corrente — os outros dispositivos seguem logados. */
  async logout(userId: string, sid?: string, device: DeviceInfo = {}) {
    if (sid) await this.sessions.revoke(sid, userId);
    // Access token emitido antes do `sid` (deploy da Fase 8A) não traz sessão:
    // nesse caso o logout derruba tudo, que é o comportamento antigo.
    else await this.sessions.revokeAll(userId);
    await this.accessRecords.registrar({
      userId,
      kind: 'LOGOUT',
      ip: device.ip,
      userAgent: device.userAgent,
    });
  }

  /** Sessões ativas do próprio usuário, para a tela de perfil. */
  listSessions(userId: string, currentSid?: string) {
    return this.sessions.listForUser(userId, currentSid);
  }

  /** Revoga uma sessão do próprio usuário. 404 para id alheio ou já revogado. */
  async revokeSession(userId: string, id: string) {
    const revogada = await this.sessions.revoke(id, userId);
    if (!revogada) throw new NotFoundException('Sessão não encontrada.');
    this.logger.log({
      evento: 'sessao.revogada',
      msg: 'Sessão revogada pelo próprio usuário.',
      sessaoId: id,
    });
    return { ok: true };
  }

  /** Encerra os demais dispositivos, preservando o que fez a requisição. */
  async revokeOtherSessions(userId: string, currentSid?: string) {
    const quantidade = await this.sessions.revokeAll(userId, currentSid);
    this.logger.log({
      evento: 'sessoes.revogadas',
      msg: 'Demais sessões encerradas pelo próprio usuário.',
      quantidade,
    });
    return { revoked: quantidade };
  }

  /**
   * Emite o par de tokens e abre uma sessão nova. O `sid` (id da sessão) vai no
   * payload dos DOIS tokens: no refresh porque é ele que torna a validação uma
   * busca por chave primária (sem `sid`, validar N sessões custaria N
   * `argon2.verify`); no access porque logout e "revogar esta sessão" precisam
   * saber qual é a sessão corrente numa rota autenticada.
   */
  // --- segundo fator (TOTP) -------------------------------------------------

  /** Estado do 2FA para a tela de Segurança. */
  statusDoSegundoFator(userId: string) {
    return this.totp.status(userId);
  }

  /**
   * Inicia o cadastro: gera o segredo e devolve o QR. **Não liga o 2FA** — só
   * `confirmarSegundoFator` liga, e só com um código válido do autenticador.
   */
  async iniciarSegundoFator(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    // O e-mail é o `label` do `otpauth://`: é o que a pessoa vê no app para saber
    // qual conta é qual quando tem várias.
    return this.totp.iniciar(userId, user.email);
  }

  /** Confirma e liga. Devolve os códigos de recuperação, uma única vez. */
  confirmarSegundoFator(userId: string, codigo: string) {
    return this.totp.confirmar(userId, codigo);
  }

  /** Regenera os códigos, invalidando os antigos. Exige reautenticação. */
  async regenerarCodigosDeRecuperacao(
    userId: string,
    confirmacao: { password?: string; codigo?: string },
  ) {
    await this.assertReautenticado(userId, confirmacao);
    return this.totp.regenerarCodigos(userId);
  }

  /** Desliga o 2FA. Exige reautenticação. */
  async desativarSegundoFator(
    userId: string,
    confirmacao: { password?: string; codigo?: string },
  ): Promise<void> {
    await this.assertReautenticado(userId, confirmacao);
    await this.totp.desativar(userId);
  }

  /**
   * Reautenticação para mexer no próprio segundo fator (OWASP ASVS 3.7.1): a
   * senha **ou** um código válido do autenticador.
   *
   * **`ForbiddenException`, nunca `UnauthorizedException`** — mesmo precedente de
   * `AccountDeletionService.assertReautenticado`: um 401 em rota autenticada
   * dispara o refresh/logout do cliente HTTP, e uma senha errada no diálogo
   * derrubaria a sessão em vez de mostrar a mensagem.
   *
   * O código é aceito como alternativa porque quem entrou por login social e
   * nunca definiu senha não tem senha para provar — `passwordSetAt`, e não
   * `passwordHash IS NOT NULL`, é quem responde isso (conta OAuth nasce com uma
   * senha aleatória que ninguém conhece).
   */
  private async assertReautenticado(
    userId: string,
    confirmacao: { password?: string; codigo?: string },
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();

    if (confirmacao.password && user.passwordSetAt && user.passwordHash) {
      if (await argon2.verify(user.passwordHash, confirmacao.password)) return;
      throw new ForbiddenException('Senha incorreta.');
    }
    if (confirmacao.codigo) {
      if (await this.totp.verificar(userId, confirmacao.codigo)) return;
      throw new ForbiddenException('Código inválido ou expirado.');
    }
    throw new ForbiddenException(
      user.passwordSetAt
        ? 'Confirme com a sua senha ou com um código do autenticador.'
        : 'Confirme com um código do autenticador.',
    );
  }

  private async issueTokens(
    sub: string,
    device: DeviceInfo = {},
    kind: AccessRecordKind = 'LOGIN',
  ) {
    const sid = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub, sid },
        {
          secret: this.config.get('JWT_ACCESS_SECRET'),
          expiresIn: this.config.get('JWT_ACCESS_TTL'),
        },
      ),
      this.jwt.signAsync(
        { sub, sid },
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_TTL'),
        },
      ),
    ]);
    await this.sessions.create({
      id: sid,
      userId: sub,
      tokenHash: await this.hashSecret(refreshToken),
      device,
    });
    // Registro de acesso (Marco Civil art. 15) — depois de a sessão existir,
    // para não registrar acesso de um login que falhou na última linha.
    await this.accessRecords.registrar({
      userId: sub,
      kind,
      ip: device.ip,
      userAgent: device.userAgent,
    });
    return { accessToken, refreshToken };
  }
}
