import type { PrismaService } from '../../../prisma/prisma.service';
import type { ClientsService } from '../../clients/application/clients.service';
import type { ContactsService } from '../../contacts/application/contacts.service';
import type { IntegrationKeysService } from '../../integracoes/application/integration-keys.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import type { LeadIntakeChannelsService } from './lead-intake-channels.service';
import { LeadsIntakeService } from './leads-intake.service';
import type { IntakeLeadDto } from '../api/dto/intake-lead.dto';
import type { ContextoDeIntegracao } from '../api/intake-context';
import type { LeadIntakeChannelRecord } from '../domain/lead-intake-channel.repository';
import { webhooksEmitterFake } from '../../webhooks/application/webhooks-emitter.mock';

describe('LeadsIntakeService', () => {
  const OWNER = 'owner-1';
  const CHAVE = 'chave-1';
  const COLAB = 'colab-1';

  /** Ordem em que as etapas rodaram — é o que prova que o aviso sai pós-commit. */
  let ordem: string[];
  let prisma: PrismaService;
  let clients: {
    create: jest.Mock;
    update: jest.Mock;
    findByPhoneDigits: jest.Mock;
  };
  let contacts: { create: jest.Mock };
  let keys: { registrarUso: jest.Mock };
  let canais: { findByKeyId: jest.Mock };
  let members: { ehMembro: jest.Mock };
  let notifications: { notificarPeloSistema: jest.Mock };
  let service: LeadsIntakeService;

  const canal = (
    overrides: Partial<LeadIntakeChannelRecord> = {},
  ): LeadIntakeChannelRecord => ({
    id: 'canal-1',
    ownerId: OWNER,
    name: 'Site',
    assigneeId: null,
    sourceId: null,
    keyId: CHAVE,
    createdAt: new Date(),
    ...overrides,
  });

  const lead = (extra: Partial<IntakeLeadDto> = {}): IntakeLeadDto => ({
    nome: 'Ana Ribeiro',
    whatsapp: '84999398021',
    telefone: '+5584999398021',
    origem: 'site-institucional',
    ...extra,
  });

  /**
   * O que o guard publicou. Uma forma só desde a Fase 19-B: o caminho legado por
   * token de ambiente (que publicava `keyId: null`) saiu junto das variáveis.
   */
  const porChave = (): ContextoDeIntegracao => ({
    ownerId: OWNER,
    keyId: CHAVE,
  });

  beforeEach(() => {
    ordem = [];
    prisma = {
      executarComoOwner: jest.fn(
        async (_ownerId: string, fn: () => Promise<unknown>) => {
          const resultado = await fn();
          ordem.push('commit');
          return resultado;
        },
      ),
    } as unknown as PrismaService;
    clients = {
      create: jest.fn().mockResolvedValue({ id: 'cli-1', name: 'Ana Ribeiro' }),
      update: jest.fn().mockResolvedValue({ id: 'cli-9' }),
      findByPhoneDigits: jest.fn().mockResolvedValue(null),
    };
    contacts = { create: jest.fn().mockResolvedValue({ id: 'ct-1' }) };
    keys = {
      registrarUso: jest.fn().mockImplementation(() => {
        ordem.push('registrou uso');
        return Promise.resolve();
      }),
    };
    canais = { findByKeyId: jest.fn().mockResolvedValue(canal()) };
    members = { ehMembro: jest.fn().mockResolvedValue(true) };
    notifications = {
      notificarPeloSistema: jest.fn().mockImplementation(() => {
        ordem.push('notificou');
        return Promise.resolve();
      }),
    };
    service = new LeadsIntakeService(
      prisma,
      clients as unknown as ClientsService,
      contacts as unknown as ContactsService,
      keys as unknown as IntegrationKeysService,
      canais as unknown as LeadIntakeChannelsService,
      members as unknown as WorkspaceMembersService,
      notifications as unknown as NotificationsService,
      webhooksEmitterFake(),
    );
  });

  it('cria o cliente como LEAD, com a origem em tag, e o contato principal', async () => {
    const resultado = await service.receber(
      lead({ email: 'ana@teste.local', cidade: 'Mossoró' }),
      porChave(),
    );

    expect(resultado).toEqual({ status: 'criado', clientId: 'cli-1' });
    expect(clients.create).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({
        name: 'Ana Ribeiro',
        status: 'LEAD',
        tags: ['site-institucional'],
        phone: '+5584999398021',
        email: 'ana@teste.local',
        city: 'Mossoró',
      }),
      { avisarResponsavel: false },
    );
    expect(contacts.create).toHaveBeenCalledWith(
      OWNER,
      'cli-1',
      expect.objectContaining({ name: 'Ana Ribeiro', isPrimary: true }),
    );
  });

  it('grava na workspace que a CHAVE revelou, e nunca no que veio no corpo', async () => {
    await service.receber(lead(), { ownerId: 'owner-da-chave', keyId: CHAVE });

    expect(prisma.executarComoOwner).toHaveBeenCalledWith(
      'owner-da-chave',
      expect.any(Function),
    );
    expect(clients.create).toHaveBeenCalledWith(
      'owner-da-chave',
      expect.anything(),
      expect.anything(),
    );
  });

  it('usa a empresa como nome do cliente e a pessoa como nome do contato', async () => {
    await service.receber(lead({ empresa: 'Clínica Aurora' }), porChave());

    expect(clients.create).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ name: 'Clínica Aurora' }),
      expect.anything(),
    );
    expect(contacts.create).toHaveBeenCalledWith(
      OWNER,
      'cli-1',
      expect.objectContaining({ name: 'Ana Ribeiro' }),
    );
  });

  it('monta o telefone E.164 quando a origem não manda', async () => {
    await service.receber(lead({ telefone: null }), porChave());

    expect(clients.create).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ phone: '+5584999398021' }),
      expect.anything(),
    );
  });

  it('telefone conhecido empilha a nota e NÃO abre segundo cadastro', async () => {
    clients.findByPhoneDigits.mockResolvedValue({
      id: 'cli-9',
      name: 'Ana Ribeiro',
      notes: 'Contato anterior em junho.',
    });

    const resultado = await service.receber(
      lead({ cenario: 'Voltou' }),
      porChave(),
    );

    expect(resultado).toEqual({ status: 'atualizado', clientId: 'cli-9' });
    expect(clients.create).not.toHaveBeenCalled();
    expect(contacts.create).not.toHaveBeenCalled();
    const [, , patch] = clients.update.mock.calls[0] as [
      string,
      string,
      { notes: string },
    ];
    expect(patch.notes).toContain('Contato anterior em junho.');
    expect(patch.notes.startsWith('Lead recebido')).toBe(true);
  });

  it('avisa o owner com o cenário, e só depois do commit', async () => {
    await service.receber(lead({ cenario: 'Operação no limite' }), porChave());

    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith({
      ownerId: OWNER,
      userId: OWNER,
      evento: {
        tipo: 'LEAD_RECEIVED',
        entityId: 'cli-1',
        leadNome: 'Ana Ribeiro',
        origem: 'site-institucional',
        cenario: 'Operação no limite',
        reincidente: false,
      },
    });
    expect(ordem[ordem.length - 2]).toBe('commit');
    expect(ordem[ordem.length - 1]).toBe('notificou');
  });

  it('marca reincidente no aviso quando o contato já existia', async () => {
    clients.findByPhoneDigits.mockResolvedValue({ id: 'cli-9', notes: null });

    await service.receber(lead(), porChave());

    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        evento: expect.objectContaining({ reincidente: true }),
      }),
    );
  });

  describe('uso da chave', () => {
    it('marca o uso DENTRO da transação (antes do commit)', async () => {
      await service.receber(lead(), porChave());

      expect(keys.registrarUso).toHaveBeenCalledWith(OWNER, CHAVE);
      expect(ordem.indexOf('registrou uso')).toBeLessThan(
        ordem.indexOf('commit'),
      );
    });

    it('lead reincidente também marca o uso: a credencial funcionou', async () => {
      clients.findByPhoneDigits.mockResolvedValue({ id: 'cli-9', notes: null });

      await service.receber(lead(), porChave());

      expect(keys.registrarUso).toHaveBeenCalledWith(OWNER, CHAVE);
    });
  });

  describe('roteamento pelo canal', () => {
    it('grava o responsável e a fonte de lead do canal', async () => {
      canais.findByKeyId.mockResolvedValue(
        canal({ assigneeId: COLAB, sourceId: 'fonte-1' }),
      );

      await service.receber(lead(), porChave());

      expect(clients.create).toHaveBeenCalledWith(
        OWNER,
        expect.objectContaining({ assigneeId: COLAB, sourceId: 'fonte-1' }),
        expect.anything(),
      );
    });

    it('a tag da origem PERMANECE junto da fonte de lead', async () => {
      canais.findByKeyId.mockResolvedValue(canal({ sourceId: 'fonte-1' }));

      await service.receber(lead(), porChave());

      const [, patch] = clients.create.mock.calls[0] as [
        string,
        { tags: string[]; sourceId: string },
      ];
      expect(patch.tags).toEqual(['site-institucional']);
      expect(patch.sourceId).toBe('fonte-1');
    });

    it('não avisa RECORD_ASSIGNED: passa avisarResponsavel: false ao ClientsService', async () => {
      canais.findByKeyId.mockResolvedValue(canal({ assigneeId: COLAB }));

      await service.receber(lead(), porChave());

      expect(clients.create).toHaveBeenCalledWith(OWNER, expect.anything(), {
        avisarResponsavel: false,
      });
    });

    it('canal sem responsável grava sem assigneeId e avisa o OWNER', async () => {
      canais.findByKeyId.mockResolvedValue(canal({ assigneeId: null }));

      await service.receber(lead(), porChave());

      const [, patch] = clients.create.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(patch.assigneeId).toBeUndefined();
      expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OWNER }),
      );
    });

    it('canal com responsável avisa o RESPONSÁVEL, não o owner', async () => {
      canais.findByKeyId.mockResolvedValue(canal({ assigneeId: COLAB }));

      await service.receber(lead(), porChave());

      expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: OWNER, userId: COLAB }),
      );
    });

    it('responsável que não é mais membro é descartado, e o lead entra', async () => {
      canais.findByKeyId.mockResolvedValue(canal({ assigneeId: COLAB }));
      members.ehMembro.mockResolvedValue(false);

      const resultado = await service.receber(lead(), porChave());

      expect(resultado.status).toBe('criado');
      const [, patch] = clients.create.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(patch.assigneeId).toBeUndefined();
      // Sem responsável válido, o aviso volta para o owner.
      expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OWNER }),
      );
    });
  });

  describe('lead reincidente', () => {
    it('mantém quem já cuidava, mesmo que o canal aponte para outra pessoa', async () => {
      clients.findByPhoneDigits.mockResolvedValue({
        id: 'cli-9',
        notes: null,
        assigneeId: 'quem-ja-cuidava',
      });
      canais.findByKeyId.mockResolvedValue(canal({ assigneeId: COLAB }));

      await service.receber(lead(), porChave());

      const [, , patch] = clients.update.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(patch.assigneeId).toBeUndefined();
      // E o aviso vai para quem já cuidava, não para o responsável do canal.
      expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'quem-ja-cuidava' }),
      );
    });

    it('SEM responsável assume o do canal', async () => {
      clients.findByPhoneDigits.mockResolvedValue({
        id: 'cli-9',
        notes: null,
        assigneeId: null,
      });
      canais.findByKeyId.mockResolvedValue(canal({ assigneeId: COLAB }));

      await service.receber(lead(), porChave());

      const [, , patch] = clients.update.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(patch.assigneeId).toBe(COLAB);
      expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
        expect.objectContaining({ userId: COLAB }),
      );
    });

    it('não reescreve tags nem fonte: o patch só tem notes (e talvez assigneeId)', async () => {
      clients.findByPhoneDigits.mockResolvedValue({
        id: 'cli-9',
        notes: null,
        assigneeId: null,
      });
      canais.findByKeyId.mockResolvedValue(
        canal({ assigneeId: COLAB, sourceId: 'fonte-1' }),
      );

      await service.receber(lead(), porChave());

      const [, , patch] = clients.update.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ];
      // Origem, tags e fonte contam de onde o cadastro veio na PRIMEIRA vez.
      expect(Object.keys(patch).sort()).toEqual(['assigneeId', 'notes']);
    });

    it('também passa avisarResponsavel: false', async () => {
      clients.findByPhoneDigits.mockResolvedValue({
        id: 'cli-9',
        notes: null,
        assigneeId: null,
      });
      canais.findByKeyId.mockResolvedValue(canal({ assigneeId: COLAB }));

      await service.receber(lead(), porChave());

      expect(clients.update).toHaveBeenCalledWith(
        OWNER,
        'cli-9',
        expect.anything(),
        { avisarResponsavel: false },
      );
    });
  });
});
