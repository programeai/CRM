import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../../mail/mail.service';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
  type ContaDoTitular,
} from '../domain/account.repository';
import {
  CARENCIA_DE_ENCERRAMENTO_DIAS,
  type EncerramentoAgendado,
} from '../domain/account-deletion';

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @Inject(ACCOUNT_REPOSITORY) private readonly repo: AccountRepository,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Agenda o encerramento. Nada de Stripe aqui: é I/O de rede e este método roda
   * dentro da transação do request (ver `BillingService.agendarCancelamentoPorEncerramento`).
   * O e-mail sai inline seguindo o precedente do convite de colaborador
   * (`CollaboratorsService.invite`), e engole a própria falha — o aviso na
   * interface é o caminho que não depende de SMTP.
   */
  async solicitar(
    ownerId: string,
    confirmacao: { password?: string; email?: string },
  ): Promise<EncerramentoAgendado> {
    const conta = await this.exigirConta(ownerId);
    if (conta.deletionScheduledFor) {
      throw new ConflictException(
        'O encerramento desta conta já está agendado. Cancele antes de pedir de novo.',
      );
    }
    await this.assertReautenticado(conta, confirmacao);

    const requestedAt = new Date();
    const scheduledFor = new Date(
      requestedAt.getTime() +
        CARENCIA_DE_ENCERRAMENTO_DIAS * 24 * 60 * 60 * 1000,
    );
    await this.repo.agendarEncerramento(ownerId, { requestedAt, scheduledFor });

    await this.audit.registrar({
      entity: 'ACCOUNT',
      entityId: ownerId,
      // Nome, não e-mail: a linha morre no expurgo junto com a conta, mas não há
      // razão para duplicar o endereço na trilha.
      entityLabel: conta.name,
      action: 'ENCERRAR',
      extra: {
        agendadoPara: scheduledFor.toISOString(),
        carenciaDias: CARENCIA_DE_ENCERRAMENTO_DIAS,
      },
    });
    this.logger.warn({
      evento: 'conta.encerramento_solicitado',
      msg: 'Encerramento de conta agendado pelo titular.',
      ownerId,
      agendadoPara: scheduledFor.toISOString(),
      carenciaDias: CARENCIA_DE_ENCERRAMENTO_DIAS,
    });
    await this.mail.sendAccountDeletionScheduled({
      to: conta.email,
      name: conta.name,
      scheduledFor,
    });

    return { requestedAt, scheduledFor };
  }

  /** Desfaz o agendamento. Só é possível DENTRO da janela — depois não há conta. */
  async cancelar(ownerId: string): Promise<void> {
    const conta = await this.exigirConta(ownerId);
    if (!conta.deletionScheduledFor) {
      throw new ConflictException('Esta conta não tem encerramento agendado.');
    }
    await this.repo.cancelarEncerramento(ownerId);
    await this.audit.registrar({
      entity: 'ACCOUNT',
      entityId: ownerId,
      entityLabel: conta.name,
      action: 'CANCELAR',
      extra: {
        agendamentoDesfeitoDe: conta.deletionScheduledFor.toISOString(),
      },
    });
    this.logger.log({
      evento: 'conta.encerramento_cancelado',
      msg: 'Encerramento de conta cancelado pelo titular.',
      ownerId,
    });
  }

  /**
   * Reautenticação (OWASP ASVS 3.7.1: transação sensível exige reconfirmação).
   * Dois caminhos porque `passwordHash` é nullable: owner criado por OAuth não
   * tem senha, e negar-lhe o direito de encerrar seria pior do que aceitar a
   * confirmação por digitação do e-mail — que é o que GitHub e Notion fazem. A
   * proteção real contra sequestro, nos dois casos, é a carência de 30 dias
   * somada ao e-mail de aviso.
   *
   * `ForbiddenException`, nunca `UnauthorizedException`: um 401 em rota
   * autenticada dispara o refresh/logout do cliente HTTP, e uma senha errada no
   * diálogo derrubaria a sessão em vez de mostrar a mensagem.
   */
  private async assertReautenticado(
    conta: ContaDoTitular,
    confirmacao: { password?: string; email?: string },
  ): Promise<void> {
    if (conta.passwordHash) {
      if (
        !confirmacao.password ||
        !(await argon2.verify(conta.passwordHash, confirmacao.password))
      ) {
        throw new ForbiddenException('Senha incorreta.');
      }
      return;
    }
    const informado = confirmacao.email?.trim().toLowerCase();
    if (!informado || informado !== conta.email.toLowerCase()) {
      throw new ForbiddenException(
        'O e-mail informado não confere com o da conta.',
      );
    }
  }

  private async exigirConta(ownerId: string): Promise<ContaDoTitular> {
    const conta = await this.repo.findById(ownerId);
    if (!conta) {
      throw new UnauthorizedException(
        'Sua sessão não é mais válida. Entre novamente.',
      );
    }
    return conta;
  }
}
