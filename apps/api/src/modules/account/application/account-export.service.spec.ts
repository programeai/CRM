import { text } from 'node:stream/consumers';
import { AccountExportService } from './account-export.service';
import type {
  AccountDumpRepository,
  DadosDoDump,
} from '../domain/account-dump.repository';
import type { AuditService } from '../../audit/audit.service';
import type { ConfigService } from '@nestjs/config';

const OWNER = 'owner-1';

function dadosMock(): DadosDoDump {
  return {
    conta: {
      id: OWNER,
      nome: 'Fulana',
      email: 'fulana@teste.local',
      criadaEm: new Date(),
      temSenha: true,
      loginSocial: [],
    },
    assinatura: {
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
      createdAt: new Date(),
    },
    colaboradores: [
      {
        nome: 'Colaborador',
        email: 'colab@teste.local',
        ativo: true,
        papel: 'Administrador',
        conviteAceitoEm: new Date(),
        criadoEm: new Date(),
      },
    ],
    papeis: [
      {
        name: 'Administrador',
        description: null,
        system: true,
        permissions: [],
        createdAt: new Date(),
      },
    ],
    funil: [{ name: 'Novo', order: 1, isWon: false, isLost: false }],
    catalogos: {
      fontesDeLead: [{ name: 'Indicação', active: true }],
      tiposDeServico: [{ name: 'Consultoria', active: true }],
      tiposDeAtividade: [{ name: 'Ligação', active: true, isFollowUp: false }],
      motivosDePerda: [{ name: 'Preço', active: true }],
    },
    canaisDeCaptacao: [
      {
        name: 'Site',
        fonte: 'Indicação',
        responsavel: 'Fulana',
        prefixoDaChave: 'crm_aabbccdd',
        createdAt: new Date(),
      },
    ],
    clientes: [
      {
        id: 'cliente-1',
        name: 'Cliente 1',
        tradeName: null,
        personType: 'COMPANY',
        document: null,
        email: null,
        phone: null,
        website: null,
        status: 'LEAD',
        origem: null,
        responsavel: null,
        tags: [],
        notes: null,
        zipCode: null,
        street: null,
        number: null,
        complement: null,
        district: null,
        city: null,
        state: null,
        archivedAt: null,
        createdAt: new Date(),
      },
    ],
    contatos: [],
    oportunidades: [],
    propostas: [],
    projetos: [],
    demandas: [],
    contratos: [],
    cobrancas: [],
    atividades: [],
  };
}

describe('AccountExportService', () => {
  let repo: jest.Mocked<AccountDumpRepository>;
  let audit: { registrar: jest.Mock };
  let config: { get: jest.Mock };
  let service: AccountExportService;

  beforeEach(() => {
    repo = { carregar: jest.fn().mockResolvedValue(dadosMock()) };
    audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn().mockReturnValue('https://crm.programeai.com.br'),
    };
    service = new AccountExportService(
      repo,
      audit as unknown as AuditService,
      config as unknown as ConfigService,
    );
  });

  it('monta o manifest com contagem coerente e a lista do que não está incluído', async () => {
    const arquivo = await service.gerar(OWNER);
    const texto = await text(arquivo.getStream());
    const dump = JSON.parse(texto) as {
      manifesto: {
        versaoDoEsquema: number;
        contagem: Record<string, number>;
        naoIncluido: string[];
      };
    };

    expect(dump.manifesto.versaoDoEsquema).toBe(1);
    expect(dump.manifesto.contagem.clientes).toBe(1);
    expect(dump.manifesto.contagem.colaboradores).toBe(1);
    expect(dump.manifesto.naoIncluido.length).toBeGreaterThan(0);
  });

  it('nunca inclui segredo na string serializada do dump', async () => {
    const arquivo = await service.gerar(OWNER);
    const texto = await text(arquivo.getStream());

    expect(texto).not.toContain('passwordHash');
    expect(texto).not.toContain('keyHash');
    expect(texto).not.toContain('tokenHash');
    expect(texto).not.toContain('stripeCustomerId');
    expect(texto).not.toContain('stripeSubscriptionId');
    expect(texto).not.toContain('$argon2');
  });

  it('registra a trilha com entity ACCOUNT e action EXPORTAR', async () => {
    await service.gerar(OWNER);
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'ACCOUNT', action: 'EXPORTAR' }),
    );
  });
});
