import { Injectable, Logger } from '@nestjs/common';
import type { AccessRecordKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Retenção do registro de acesso. **Seis meses é obrigação legal** (Marco Civil
 * art. 15), não escolha de produto: não torne isto configurável por env, e não
 * reduza. É o número que a Política de Privacidade publica.
 */
export const RETENCAO_REGISTRO_DE_ACESSO_DIAS = 180;

@Injectable()
export class AccessRecordsService {
  private readonly logger = new Logger(AccessRecordsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava o acesso. **Engole a própria falha:** um registro que não entrou é um
   * problema de conformidade a investigar no log, não uma razão para impedir
   * alguém de entrar no CRM. O `error` é o alarme.
   */
  async registrar(entrada: {
    userId: string;
    kind: AccessRecordKind;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.db.accessRecord.create({
        data: {
          userId: entrada.userId,
          kind: entrada.kind,
          ip: entrada.ip ?? null,
          userAgent: entrada.userAgent?.slice(0, 255) ?? null,
        },
      });
    } catch (erro) {
      this.logger.error(
        {
          evento: 'acesso.registro_falhou',
          msg: 'Falha ao gravar o registro de acesso (Marco Civil art. 15).',
          usuarioId: entrada.userId,
          tipo: entrada.kind,
        },
        erro instanceof Error ? erro.stack : undefined,
      );
    }
  }

  /** Faxina por data de corte. Devolve quantas linhas saíram. */
  async purgeBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.db.accessRecord.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }
}
