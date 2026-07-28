import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientsService } from '../../clients/application/clients.service';
import { ContactsService } from '../../contacts/application/contacts.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { empilharNota, montarNotaDeLead } from './nota-de-lead';
import type { IntakeLeadDto } from '../api/dto/intake-lead.dto';

/** `criado` abriu cadastro novo; `atualizado` reencontrou um contato existente. */
export interface ResultadoDeIngestao {
  status: 'criado' | 'atualizado';
  clientId: string;
}

/**
 * Ingestão de lead vindo de fora (site, landing page).
 *
 * Três decisões de produto moram aqui, e nenhuma é detalhe de implementação:
 *
 *  1. **Lead vira `Client` com status `LEAD` e um `Contact` principal, não um
 *     `Deal`.** Oportunidade exige tipo de serviço, e a captação não sabe qual é
 *     — quem descobre isso é a conversa de diagnóstico. Abrir deal aqui encheria
 *     o funil de card sem valor e sem serviço, que é pior do que não ter card.
 *  2. **Contato repetido não abre segundo cadastro.** A chave é o telefone: o
 *     mesmo número que preencheu duas vezes é a mesma pessoa, e o lead novo
 *     entra como nota empilhada no cadastro que já existe. Duplicata em CRM é
 *     dívida silenciosa — dois históricos, duas pessoas ligando.
 *  3. **A conta que recebe vem do ambiente**, nunca do corpo. Ver
 *     `resolverOwner`.
 *
 * A escrita roda sob o contexto de RLS do owner (`executarComoOwner`) porque a
 * rota é pública e não passa pelo `OwnerContextInterceptor`. O aviso sai DEPOIS
 * do commit, de propósito: notificação com link para registro que ainda não
 * existe é pior do que notificação atrasada.
 */
@Injectable()
export class LeadsIntakeService {
  private readonly logger = new Logger(LeadsIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly clients: ClientsService,
    private readonly contacts: ContactsService,
    private readonly notifications: NotificationsService,
  ) {}

  async receber(dto: IntakeLeadDto): Promise<ResultadoDeIngestao> {
    const ownerId = await this.resolverOwner();

    const gravado = await this.prisma.executarComoOwner(ownerId, () =>
      this.gravar(ownerId, dto),
    );

    /*
      `notificarPeloSistema` e não `notificar`: não há ator humano nesta rota, e
      a regra "ninguém é notificado da própria ação" do caminho autenticado
      descartaria justamente este aviso (destinatário e owner são a mesma pessoa).
      O destinatário é o OWNER porque lead que acabou de chegar ainda não tem
      responsável a quem endereçar.
    */
    await this.notifications.notificarPeloSistema({
      ownerId,
      userId: ownerId,
      evento: {
        tipo: 'LEAD_RECEIVED',
        entityId: gravado.clientId,
        leadNome: dto.nome,
        origem: dto.origem,
        cenario: dto.cenario ?? undefined,
        reincidente: gravado.status === 'atualizado',
      },
    });

    // Sem nome, telefone ou e-mail: a linha vive 30 dias num Grafana publicado.
    this.logger.log({
      evento: gravado.status === 'criado' ? 'lead.ingerido' : 'lead.reingerido',
      msg: 'Lead recebido por ingestão externa.',
      clienteId: gravado.clientId,
      origem: dto.origem,
      qualificado: Boolean(dto.cenario),
    });

    return gravado;
  }

  /** Roda dentro da transação com `app.owner_id` setado. */
  private async gravar(
    ownerId: string,
    dto: IntakeLeadDto,
  ): Promise<ResultadoDeIngestao> {
    const telefone = dto.telefone?.trim() || `+55${dto.whatsapp}`;
    const nota = montarNotaDeLead({
      origem: dto.origem,
      pagina: dto.pagina,
      recebidoEm: dto.recebidoEm,
      cenario: dto.cenario,
      resumo: dto.resumo,
      mensagem: dto.mensagem,
      email: dto.email,
      cidade: dto.cidade,
    });

    const existente = await this.clients.findByPhoneDigits(
      ownerId,
      dto.whatsapp,
    );
    if (existente) {
      await this.clients.update(ownerId, existente.id, {
        notes: empilharNota(existente.notes, nota),
      });
      return { status: 'atualizado', clientId: existente.id };
    }

    /*
      `name` é a empresa quando a origem pergunta por ela, senão o nome da
      pessoa: `Client` é a conta, `Contact` é quem fala. Sem documento não há de
      onde deduzir `personType`, então o cadastro nasce como o default do schema
      (COMPANY) mesmo quando o lead é pessoa física — corrigir isso pediria
      mudar o contrato de `CreateClientDto`, que de propósito só deduz tipo de
      pessoa a partir do documento.
    */
    const criado = await this.clients.create(ownerId, {
      name: dto.empresa?.trim() || dto.nome,
      status: 'LEAD',
      // Tag em vez de fonte de lead: `LeadSourceCatalog` é do owner e pode não
      // ter um item correspondente. Tag preserva a atribuição sem inventar
      // catálogo na conta de ninguém.
      tags: [dto.origem],
      notes: nota,
      phone: telefone,
      ...(dto.email ? { email: dto.email } : {}),
      ...(dto.cidade ? { city: dto.cidade } : {}),
    });

    await this.contacts.create(ownerId, criado.id, {
      name: dto.nome,
      phone: telefone,
      isPrimary: true,
      ...(dto.email ? { email: dto.email } : {}),
    });

    return { status: 'criado', clientId: criado.id };
  }

  /**
   * A conta que recebe os leads, resolvida pelo e-mail do owner no ambiente.
   *
   * Duas coisas explicam a escolha. A primeira é segurança: o corpo da
   * requisição não pode escolher em qual workspace grava, e o token não carrega
   * essa informação. A segunda é o estágio do produto: a instância é
   * single-tenant na prática (uma implantação por assinante), então uma variável
   * de ambiente basta e não exige tela nenhuma.
   *
   * Quando a multiempresa entrar, o caminho é uma chave de integração POR owner
   * (hash no banco, gerada na tela de configurações) e este método sai daqui —
   * o owner passa a vir da chave apresentada, não do ambiente.
   *
   * `prisma.db` fora de transação alcança `User` porque essa tabela não tem RLS
   * (é o que já permite login e registro rodarem em rota pública).
   */
  private async resolverOwner(): Promise<string> {
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
