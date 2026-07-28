import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ClientsService } from '../../clients/application/clients.service';
import type { ContactsService } from '../../contacts/application/contacts.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import { LeadsIntakeService } from './leads-intake.service';
import type { IntakeLeadDto } from '../api/dto/intake-lead.dto';

describe('LeadsIntakeService', () => {
  const OWNER = 'owner-1';

  let env: Record<string, string>;
  let findFirst: jest.Mock;
  /** Ordem em que as etapas rodaram — é o que prova que o aviso sai pós-commit. */
  let ordem: string[];
  let prisma: PrismaService;
  let clients: {
    create: jest.Mock;
    update: jest.Mock;
    findByPhoneDigits: jest.Mock;
  };
  let contacts: { create: jest.Mock };
  let notifications: { notificarPeloSistema: jest.Mock };
  let service: LeadsIntakeService;

  const lead = (extra: Partial<IntakeLeadDto> = {}): IntakeLeadDto => ({
    nome: 'Ana Ribeiro',
    whatsapp: '84999398021',
    telefone: '+5584999398021',
    origem: 'site-institucional',
    ...extra,
  });

  beforeEach(() => {
    env = {
      LEAD_INTAKE_OWNER_EMAIL: 'dono@teste.local',
    };
    ordem = [];
    findFirst = jest.fn().mockResolvedValue({ id: OWNER });
    prisma = {
      db: { user: { findFirst } },
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
    notifications = {
      notificarPeloSistema: jest.fn().mockImplementation(() => {
        ordem.push('notificou');
        return Promise.resolve();
      }),
    };
    service = new LeadsIntakeService(
      prisma,
      { get: (chave: string) => env[chave] } as unknown as ConfigService,
      clients as unknown as ClientsService,
      contacts as unknown as ContactsService,
      notifications as unknown as NotificationsService,
    );
  });

  it('cria o cliente como LEAD, com a origem em tag, e o contato principal', async () => {
    const resultado = await service.receber(
      lead({ email: 'ana@teste.local', cidade: 'Mossoró' }),
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
    );
    expect(contacts.create).toHaveBeenCalledWith(
      OWNER,
      'cli-1',
      expect.objectContaining({ name: 'Ana Ribeiro', isPrimary: true }),
    );
  });

  it('usa a empresa como nome do cliente e a pessoa como nome do contato', async () => {
    await service.receber(lead({ empresa: 'Clínica Aurora' }));

    expect(clients.create).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ name: 'Clínica Aurora' }),
    );
    expect(contacts.create).toHaveBeenCalledWith(
      OWNER,
      'cli-1',
      expect.objectContaining({ name: 'Ana Ribeiro' }),
    );
  });

  it('monta o telefone E.164 quando a origem não manda', async () => {
    await service.receber(lead({ telefone: null }));

    expect(clients.create).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ phone: '+5584999398021' }),
    );
  });

  it('telefone conhecido empilha a nota e NÃO abre segundo cadastro', async () => {
    clients.findByPhoneDigits.mockResolvedValue({
      id: 'cli-9',
      name: 'Ana Ribeiro',
      notes: 'Contato anterior em junho.',
    });

    const resultado = await service.receber(lead({ cenario: 'Voltou' }));

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
    await service.receber(lead({ cenario: 'Operação no limite' }));

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
    expect(ordem).toEqual(['commit', 'notificou']);
  });

  it('marca reincidente no aviso quando o contato já existia', async () => {
    clients.findByPhoneDigits.mockResolvedValue({ id: 'cli-9', notes: null });

    await service.receber(lead());

    expect(notifications.notificarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        evento: expect.objectContaining({ reincidente: true }),
      }),
    );
  });

  it('recusa a ingestão sem conta de destino configurada', async () => {
    env = {};

    await expect(service.receber(lead())).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(clients.create).not.toHaveBeenCalled();
  });

  it('recusa quando o e-mail configurado não corresponde a nenhum owner', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.receber(lead())).rejects.toThrow(
      ServiceUnavailableException,
    );
    // Colaborador não serve: a busca exige ownerId nulo (dono de workspace).
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'dono@teste.local', ownerId: null },
      }),
    );
  });
});
