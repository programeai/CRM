import { Injectable } from '@nestjs/common';
import type { ConsentRecord, ConsentSubjectType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ConsentRepository,
  DadosDeConsentimento,
} from '../domain/consent.repository';

/**
 * Só `findMany` e `create`. Nada de `update`/`delete`: o banco os recusa para
 * `crm_app` (`REVOKE UPDATE, DELETE ON "ConsentRecord"`), e a invariante do portão
 * de CI reprova se o privilégio voltar.
 */
@Injectable()
export class PrismaConsentRepository implements ConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findHistorico(
    ownerId: string,
    subjectType: ConsentSubjectType,
    subjectId: string,
  ): Promise<ConsentRecord[]> {
    return this.prisma.db.consentRecord.findMany({
      where: { ownerId, subjectType, subjectId },
      // Do mais recente para o mais antigo: é a ordem da linha do tempo na tela.
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  criar(dados: DadosDeConsentimento): Promise<ConsentRecord> {
    return this.prisma.db.consentRecord.create({ data: dados });
  }

  carregarParaDump(ownerId: string): Promise<ConsentRecord[]> {
    return this.prisma.db.consentRecord.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
