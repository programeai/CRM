import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * O caminho legado da ingestão: token compartilhado no ambiente e conta de
 * destino por e-mail. **Não evolua este arquivo** — ele existe para a captação
 * em produção não parar entre o deploy da API e o do site, e sai inteiro
 * quando o `site-v2` estiver emitindo com chave de integração.
 *
 * Os eventos de log (`lead.owner_nao_configurado`, `lead.owner_nao_encontrado`) e
 * as mensagens de 503 são idênticos aos de antes desta fase: renomear qualquer um
 * quebraria a contagem histórica no Grafana.
 *
 * O que **saiu** foi `lead.ingestao_desconfigurada`: antes desta fase, ausência
 * de `LEAD_INTAKE_TOKEN` era um defeito de configuração que fechava a rota com
 * 503. Agora é o estado NORMAL — em dev nunca houve token, e em produção ele
 * desaparece quando o `site-v2` migrar para a chave. Emitir o aviso aqui poria
 * uma linha de `warn` em cada lead legítimo que entra por chave. O evento não é
 * renomeado, é aposentado: nenhuma consulta histórica muda de significado.
 */
@Injectable()
export class TokenLegadoService {
  private readonly logger = new Logger(TokenLegadoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * `true` só quando o valor apresentado É o token do ambiente. Sem
   * `LEAD_INTAKE_TOKEN` configurado devolve `false` — e aí a credencial segue
   * para a autenticação por chave, que é o caminho normal.
   *
   * Comparação sobre o SHA-256 dos dois lados: `timingSafeEqual` exige buffers
   * do mesmo tamanho (com tamanhos diferentes ele lança, e o próprio lançar
   * vaza o tamanho do segredo), e o digest normaliza isso em 32 bytes.
   */
  confere(valor: string): boolean {
    const esperado = this.config.get<string>('LEAD_INTAKE_TOKEN') ?? '';
    if (!esperado) return false;
    const digest = (v: string) =>
      createHash('sha256').update(v, 'utf8').digest();
    return timingSafeEqual(digest(valor), digest(esperado));
  }

  /**
   * A conta que recebe, pelo e-mail do owner no ambiente. `User` não tem RLS
   * (é o que já permite login e registro rodarem em rota pública), então
   * `prisma.db` fora de transação a alcança.
   */
  async resolverOwner(): Promise<string> {
    const email = this.config.get<string>('LEAD_INTAKE_OWNER_EMAIL') ?? '';
    if (!email) {
      this.logger.error({
        evento: 'lead.owner_nao_configurado',
        msg: 'LEAD_INTAKE_OWNER_EMAIL ausente: ingestão de lead sem conta de destino.',
      });
      throw new ServiceUnavailableException(
        'A ingestão de leads não está configurada nesta instância.',
      );
    }

    const owner = await this.prisma.db.user.findFirst({
      // `ownerId: null` = é owner de workspace, não colaborador. Colaborador não
      // tem workspace própria, e gravar "na conta dele" não significa nada.
      where: { email, ownerId: null },
      select: { id: true },
    });
    if (!owner) {
      this.logger.error({
        evento: 'lead.owner_nao_encontrado',
        msg: 'Nenhum owner com o e-mail de LEAD_INTAKE_OWNER_EMAIL nesta instância.',
      });
      throw new ServiceUnavailableException(
        'A conta que recebe os leads não existe nesta instância.',
      );
    }
    return owner.id;
  }
}
