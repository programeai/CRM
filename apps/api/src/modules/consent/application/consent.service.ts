import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConsentRecord, ConsentSubjectType } from '@prisma/client';
import { ClientsService } from '../../clients/application/clients.service';
import { ContactsService } from '../../contacts/application/contacts.service';
import { UsersService } from '../../users/users.service';
import {
  CONSENT_REPOSITORY,
  type ConsentRepository,
} from '../domain/consent.repository';
import {
  textoPreenchido,
  textoVigente,
  type TextoDeConsentimento,
} from '../domain/consent-text';
import type { ConsentPurpose } from '../domain/consent-purpose';
import type { CreateConsentDto } from '../api/dto/create-consent.dto';

/** Uma linha do livro-razão, como a API a devolve. */
export interface ConsentRecordNaApi {
  id: string;
  subjectType: ConsentSubjectType;
  subjectId: string;
  purpose: string;
  granted: boolean;
  textVersion: string;
  channel: string;
  evidence: string | null;
  informedRetention: string | null;
  recordedByName: string;
  occurredAt: Date;
  createdAt: Date;
}

/** A situação VIGENTE de uma finalidade: a última manifestação vence. */
export interface SituacaoDeConsentimento {
  purpose: string;
  granted: boolean;
  occurredAt: Date;
  textVersion: string;
}

export interface HistoricoDeConsentimento {
  situacao: SituacaoDeConsentimento[];
  historico: ConsentRecordNaApi[];
}

/**
 * Livro-razão de consentimento dos titulares (`Client`/`Contact`).
 *
 * O que este service **não** faz, e é decisão de escopo explícita: **não envia
 * nada a ninguém**. Nenhum e-mail ou WhatsApp sai do CRM para `Client`/`Contact` —
 * todo destinatário do `MailService` é `User`. O CRM é o livro-razão que o owner
 * consulta ANTES de comunicar por fora; a superfície de envio (com
 * `List-Unsubscribe` da RFC 8058, DKIM cobrindo os headers e as 48h do Gmail) é
 * outra fase, e prometê-la aqui seria pior do que não tê-la.
 *
 * **Não há trilha de auditoria destes registros**, e não é esquecimento: a tabela
 * **é** a trilha — append-only no banco, com `REVOKE UPDATE, DELETE`. Duplicá-la no
 * `AuditLog` guardaria a mesma PII de terceiro duas vezes.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    @Inject(CONSENT_REPOSITORY) private readonly repo: ConsentRepository,
    private readonly clients: ClientsService,
    private readonly contacts: ContactsService,
    private readonly users: UsersService,
  ) {}

  /** Histórico completo + a situação vigente por finalidade. */
  async historico(
    ownerId: string,
    subjectType: ConsentSubjectType,
    subjectId: string,
  ): Promise<HistoricoDeConsentimento> {
    await this.assertTitularDoOwner(ownerId, subjectType, subjectId);
    const linhas = await this.repo.findHistorico(
      ownerId,
      subjectType,
      subjectId,
    );
    return {
      situacao: this.resolverSituacao(linhas),
      historico: linhas.map(paraApi),
    };
  }

  /**
   * Registra manifestação. `granted: false` é a **revogação**, e ela é linha nova
   * — nunca `UPDATE` da anterior (art. 8º § 5º, "ratificados os tratamentos
   * realizados").
   *
   * A versão do texto **não vem do corpo**: vem de `textoVigente(purpose)`.
   * Aceitar versão pelo corpo deixaria registrar consentimento a um texto que
   * nunca foi exibido, o que é o oposto de comprovar.
   */
  async registrar(
    ownerId: string,
    dto: CreateConsentDto,
    autor: { userId: string; nome: string },
  ): Promise<ConsentRecordNaApi> {
    await this.assertTitularDoOwner(ownerId, dto.subjectType, dto.subjectId);
    const texto = textoVigente(dto.purpose as ConsentPurpose);
    const criado = await this.repo.criar({
      ownerId,
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      purpose: dto.purpose,
      granted: dto.granted,
      textVersion: texto.version,
      channel: dto.channel,
      evidence: dto.evidence ?? null,
      informedRetention: dto.informedRetention ?? null,
      recordedByUserId: autor.userId,
      recordedByName: autor.nome,
      // Sem `occurredAt` no corpo, vale agora: quem registra na hora não precisa
      // digitar a data. Com ele, respeita a manifestação que veio antes.
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });
    /*
      Sem nome, e-mail nem telefone do titular: a linha vive 30 dias num Grafana
      publicado. O que interessa contar é QUE houve manifestação e de que tipo.
    */
    this.logger.log({
      evento: dto.granted
        ? 'consentimento.registrado'
        : 'consentimento.revogado',
      msg: dto.granted
        ? 'Consentimento de titular registrado.'
        : 'Revogação de consentimento registrada.',
      titularTipo: dto.subjectType,
      titularId: dto.subjectId,
      finalidade: dto.purpose,
      versaoDoTexto: texto.version,
      canal: dto.channel,
    });
    return paraApi(criado);
  }

  /**
   * O texto vigente de uma finalidade, com o controlador preenchido. A tela exibe
   * isto ANTES de registrar — é o que faz o consentimento ser informado.
   *
   * O controlador é o **owner**, não a ProgrameAi: ela é operadora. Daí o nome e o
   * e-mail vindos da conta do owner.
   */
  async texto(
    ownerId: string,
    purpose: ConsentPurpose,
  ): Promise<{ version: string; text: string }> {
    const vigente: TextoDeConsentimento = textoVigente(purpose);
    const owner = await this.users.findById(ownerId);
    return {
      version: vigente.version,
      text: textoPreenchido(vigente, {
        // Sem o owner (não deve acontecer numa rota autenticada), o texto sai com
        // um marcador genérico em vez de "undefined" no meio da frase.
        nome: owner?.name ?? 'o controlador dos dados',
        contato: owner?.email ?? 'o contato informado pelo controlador',
      }),
    };
  }

  /** As linhas do owner para o dump de portabilidade (19-A). */
  async paraDump(ownerId: string): Promise<ConsentRecordNaApi[]> {
    const linhas = await this.repo.carregarParaDump(ownerId);
    return linhas.map(paraApi);
  }

  /**
   * A situação vigente por finalidade: a manifestação mais recente vence. O
   * histórico vem ordenado do mais novo para o mais antigo, então a PRIMEIRA
   * ocorrência de cada finalidade é a que vale.
   */
  private resolverSituacao(linhas: ConsentRecord[]): SituacaoDeConsentimento[] {
    const vista = new Set<string>();
    const situacao: SituacaoDeConsentimento[] = [];
    for (const linha of linhas) {
      if (vista.has(linha.purpose)) continue;
      vista.add(linha.purpose);
      situacao.push({
        purpose: linha.purpose,
        granted: linha.granted,
        occurredAt: linha.occurredAt,
        textVersion: linha.textVersion,
      });
    }
    return situacao;
  }

  /**
   * O titular tem de ser da workspace de quem está registrando. Sem isto, um
   * `subjectId` de outro owner entraria na tabela — e `subjectId` não tem FK (o
   * titular pode ser `Client` ou `Contact`), então o banco não reclamaria. Os dois
   * `findOne` respondem 404 quando o registro é de outra workspace.
   */
  private async assertTitularDoOwner(
    ownerId: string,
    subjectType: ConsentSubjectType,
    subjectId: string,
  ): Promise<void> {
    if (subjectType === 'CLIENT') {
      await this.clients.findOne(ownerId, subjectId);
      return;
    }
    await this.contacts.findOne(ownerId, subjectId);
  }
}

/** A única saída para a fronteira HTTP. */
export function paraApi(r: ConsentRecord): ConsentRecordNaApi {
  return {
    id: r.id,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    purpose: r.purpose,
    granted: r.granted,
    textVersion: r.textVersion,
    channel: r.channel,
    evidence: r.evidence,
    informedRetention: r.informedRetention,
    recordedByName: r.recordedByName,
    occurredAt: r.occurredAt,
    createdAt: r.createdAt,
  };
}
