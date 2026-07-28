import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientsService } from '../../clients/application/clients.service';
import { ContactsService } from '../../contacts/application/contacts.service';
import { IntegrationKeysService } from '../../integracoes/application/integration-keys.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import { LeadIntakeChannelsService } from './lead-intake-channels.service';
import { empilharNota, montarNotaDeLead } from './nota-de-lead';
import type { IntakeLeadDto } from '../api/dto/intake-lead.dto';
import type { ContextoDeIntegracao } from '../api/intake-context';
import type { LeadIntakeChannelRecord } from '../domain/lead-intake-channel.repository';

/** `criado` abriu cadastro novo; `atualizado` reencontrou um contato existente. */
export interface ResultadoDeIngestao {
  status: 'criado' | 'atualizado';
  clientId: string;
}

/** O que a gravação decidiu — inclui o que o aviso e o log precisam saber. */
interface Gravacao extends ResultadoDeIngestao {
  /** Quem ficou responsável, se alguém. É o destinatário do aviso. */
  responsavelId: string | null;
  canalId: string | null;
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
 *  3. **A conta que recebe vem da chave apresentada**, nunca do corpo. Quem a
 *     descobre é o `LeadIntakeKeyGuard`, e ele entrega o `ownerId` já resolvido
 *     no `ContextoDeIntegracao`: aceitar owner pelo corpo seria deixar qualquer
 *     um escrever na conta de qualquer outro.
 *  4. **O roteamento é fixo por canal, e determinístico** — sem round-robin. A
 *     chave leva ao canal, e o canal diz quem atende e qual fonte de lead
 *     classifica. Rotear **esconde** o lead de quem só vê os próprios registros
 *     (`shared/record-scope.ts`), e é por isso que a tela avisa isso ao
 *     configurar. Lead reincidente nunca muda de mão.
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
    private readonly clients: ClientsService,
    private readonly contacts: ContactsService,
    private readonly keys: IntegrationKeysService,
    private readonly canais: LeadIntakeChannelsService,
    private readonly members: WorkspaceMembersService,
    private readonly notifications: NotificationsService,
  ) {}

  async receber(
    dto: IntakeLeadDto,
    contexto: ContextoDeIntegracao,
  ): Promise<ResultadoDeIngestao> {
    const { ownerId } = contexto;

    const gravado = await this.prisma.executarComoOwner(ownerId, () =>
      this.gravar(ownerId, contexto, dto),
    );

    /*
      O destinatário é o RESPONSÁVEL roteado; sem roteamento, o owner — como
      antes desta fase. Quem configurou o canal escolheu quem atende, e é essa
      pessoa que precisa do aviso em minutos. Continua `notificarPeloSistema`
      (não `notificar`) porque não há ator humano nesta rota: `notificar`
      exigiria `AccessContext` no CLS e descartaria o aviso.

      Consequência assumida: com um canal roteado, o owner deixa de receber
      `LEAD_RECEIVED` de todo lead. É o efeito pretendido de configurar
      responsável no canal — quem quiser tudo deixa o canal sem responsável. A
      alternativa (avisar os dois) dobraria a notificação de cada lead.
    */
    await this.notifications.notificarPeloSistema({
      ownerId,
      userId: gravado.responsavelId ?? ownerId,
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
      canalId: gravado.canalId,
      roteado: Boolean(gravado.responsavelId),
    });

    return { status: gravado.status, clientId: gravado.clientId };
  }

  /** Roda dentro da transação com `app.owner_id` setado. */
  private async gravar(
    ownerId: string,
    contexto: ContextoDeIntegracao,
    dto: IntakeLeadDto,
  ): Promise<Gravacao> {
    /*
      O uso é marcado DENTRO da transação: rollback não deve registrar uso. Vem
      antes dos dois caminhos de propósito — lead reincidente também é uso
      bem-sucedido da chave, e `lastUsedAt` responde "esta credencial ainda está
      viva?", não "quantos cadastros ela abriu?".
    */
    if (contexto.keyId) {
      await this.keys.registrarUso(ownerId, contexto.keyId);
    }

    // Caminho legado (`keyId` nulo): não há canal, então não há roteamento nem
    // fonte de lead — exatamente o comportamento anterior a esta fase.
    const canal = contexto.keyId
      ? await this.canais.findByKeyId(ownerId, contexto.keyId)
      : null;
    const responsavelId = await this.resolverResponsavel(ownerId, canal);

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
      /*
        Lead que volta NÃO muda de mão: quem já cuida do cadastro continua
        cuidando, mesmo que o canal aponte para outra pessoa. O responsável do
        canal só entra quando não há ninguém — que é o caso em que o roteamento
        tem algo a resolver. Origem, tags e fonte do cadastro existente também
        ficam como estão: elas contam de onde ele veio na PRIMEIRA vez, e
        reescrever isso apagaria histórico.
      */
      const assumir = Boolean(responsavelId) && !existente.assigneeId;
      await this.clients.update(
        ownerId,
        existente.id,
        {
          notes: empilharNota(existente.notes, nota),
          ...(assumir ? { assigneeId: responsavelId } : {}),
        },
        { avisarResponsavel: false },
      );
      return {
        status: 'atualizado',
        clientId: existente.id,
        responsavelId: existente.assigneeId ?? (assumir ? responsavelId : null),
        canalId: canal?.id ?? null,
      };
    }

    /*
      `name` é a empresa quando a origem pergunta por ela, senão o nome da
      pessoa: `Client` é a conta, `Contact` é quem fala. Sem documento não há de
      onde deduzir `personType`, então o cadastro nasce como o default do schema
      (COMPANY) mesmo quando o lead é pessoa física — corrigir isso pediria
      mudar o contrato de `CreateClientDto`, que de propósito só deduz tipo de
      pessoa a partir do documento.
    */
    const criado = await this.clients.create(
      ownerId,
      {
        name: dto.empresa?.trim() || dto.nome,
        status: 'LEAD',
        /*
          A tag PERMANECE junto da fonte de lead, e não é redundância: `origem`
          é o rótulo cru de quem capturou ("site-institucional", "/agenda-cheia"
          na página) e distingue duas entregas do MESMO canal; `sourceId` é a
          classificação do owner, que alimenta relatório. Perder a tag apagaria
          a granularidade que a captação manda de graça.
        */
        tags: [dto.origem],
        ...(canal?.sourceId ? { sourceId: canal.sourceId } : {}),
        ...(responsavelId ? { assigneeId: responsavelId } : {}),
        notes: nota,
        phone: telefone,
        ...(dto.email ? { email: dto.email } : {}),
        ...(dto.cidade ? { city: dto.cidade } : {}),
      },
      { avisarResponsavel: false },
    );

    await this.contacts.create(ownerId, criado.id, {
      name: dto.nome,
      phone: telefone,
      isPrimary: true,
      ...(dto.email ? { email: dto.email } : {}),
    });

    return {
      status: 'criado',
      clientId: criado.id,
      responsavelId,
      canalId: canal?.id ?? null,
    };
  }

  /**
   * O responsável do canal, se ele ainda for gente da workspace. Configuração
   * velha (a pessoa saiu, foi desativada) NÃO pode fazer a captação falhar: o
   * lead entra sem responsável — visível para todos, que é o estado seguro —
   * e o log registra o descarte para alguém corrigir o canal.
   *
   * `assertMember` (que lança 422) não serve aqui: perderia o lead por uma
   * configuração velha, e do outro lado é um site que não mostra o erro.
   */
  private async resolverResponsavel(
    ownerId: string,
    canal: LeadIntakeChannelRecord | null,
  ): Promise<string | null> {
    if (!canal?.assigneeId) return null;
    if (await this.members.ehMembro(ownerId, canal.assigneeId)) {
      return canal.assigneeId;
    }
    this.logger.warn({
      evento: 'lead.responsavel_ignorado',
      msg: 'Responsável do canal não é mais membro da workspace: lead entrou sem responsável.',
      canalId: canal.id,
    });
    return null;
  }
}
