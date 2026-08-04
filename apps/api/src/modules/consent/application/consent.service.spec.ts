import { NotFoundException } from '@nestjs/common';
import type { ConsentRecord } from '@prisma/client';
import { ConsentService } from './consent.service';
import { textoVigente } from '../domain/consent-text';
import type { ConsentRepository } from '../domain/consent.repository';
import type { ClientsService } from '../../clients/application/clients.service';
import type { ContactsService } from '../../contacts/application/contacts.service';
import type { UsersService } from '../../users/users.service';
import type { CreateConsentDto } from '../api/dto/create-consent.dto';

const OWNER = 'owner-1';
const CLIENTE = 'cliente-1';
const AUTOR = { userId: 'u1', nome: 'Ana Ribeiro' };

function dto(over: Partial<CreateConsentDto> = {}): CreateConsentDto {
  return {
    subjectType: 'CLIENT',
    subjectId: CLIENTE,
    purpose: 'comunicacao_marketing',
    granted: true,
    channel: 'formulario-site',
    ...over,
  };
}

function linha(over: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: 'r1',
    ownerId: OWNER,
    subjectType: 'CLIENT',
    subjectId: CLIENTE,
    purpose: 'comunicacao_marketing',
    granted: true,
    textVersion: '2026-08-1',
    channel: 'formulario-site',
    evidence: null,
    informedRetention: null,
    recordedByUserId: 'u1',
    recordedByName: 'Ana Ribeiro',
    occurredAt: new Date('2026-08-01T10:00:00Z'),
    createdAt: new Date('2026-08-01T10:00:00Z'),
    ...over,
  };
}

describe('ConsentService', () => {
  let repo: jest.Mocked<ConsentRepository>;
  let clients: { findOne: jest.Mock };
  let contacts: { findOne: jest.Mock };
  let users: { findById: jest.Mock };
  let service: ConsentService;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    repo = {
      findHistorico: jest.fn().mockResolvedValue([]),
      criar: jest.fn((dados) => Promise.resolve(linha(dados))),
      carregarParaDump: jest.fn().mockResolvedValue([]),
    };
    clients = { findOne: jest.fn().mockResolvedValue({ id: CLIENTE }) };
    contacts = { findOne: jest.fn().mockResolvedValue({ id: 'contato-1' }) };
    users = {
      findById: jest
        .fn()
        .mockResolvedValue({ name: 'Agência Alfa', email: 'dpo@alfa.local' }),
    };
    service = new ConsentService(
      repo,
      clients as unknown as ClientsService,
      contacts as unknown as ContactsService,
      users as unknown as UsersService,
    );
    logSpy = jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
  });

  describe('registrar', () => {
    /*
      Art. 8º § 5º: a revogação preserva "ratificados os tratamentos realizados sob
      amparo do consentimento anteriormente manifestado". Sobrescrever a linha
      apagaria a prova de que o consentimento existiu.
    */
    it('revogação é LINHA NOVA (granted: false), nunca update da anterior', async () => {
      await service.registrar(OWNER, dto({ granted: false }), AUTOR);

      expect(repo.criar).toHaveBeenCalledWith(
        expect.objectContaining({ granted: false }),
      );
      // A interface do repositório não tem `update` nem `delete` — o banco os
      // recusa para `crm_app`, e prometê-los aqui seria prometer o que não há.
      expect(repo).not.toHaveProperty('update');
      expect(repo).not.toHaveProperty('delete');
    });

    /*
      Aceitar a versão pelo corpo deixaria registrar consentimento a um texto que
      nunca foi exibido — o oposto de comprovar (art. 8º § 2º).
    */
    it('textVersion vem do CATÁLOGO, e um valor no corpo é ignorado', async () => {
      const esperada = textoVigente('comunicacao_marketing').version;

      await service.registrar(
        OWNER,
        // `textVersion` não existe no DTO; o cast simula um cliente insistente.
        { ...dto(), textVersion: 'inventada' } as CreateConsentDto,
        AUTOR,
      );

      const [dados] = repo.criar.mock.calls[0];
      expect(dados.textVersion).toBe(esperada);
      expect(dados.textVersion).not.toBe('inventada');
    });

    it('grava quem registrou, por id E por nome denormalizado', async () => {
      await service.registrar(OWNER, dto(), AUTOR);
      expect(repo.criar).toHaveBeenCalledWith(
        expect.objectContaining({
          recordedByUserId: 'u1',
          recordedByName: 'Ana Ribeiro',
        }),
      );
    });

    it('sem occurredAt vale agora; com ele, respeita a data da manifestação', async () => {
      await service.registrar(OWNER, dto(), AUTOR);
      const [semData] = repo.criar.mock.calls[0];
      expect(semData.occurredAt).toBeInstanceOf(Date);

      repo.criar.mockClear();
      await service.registrar(
        OWNER,
        dto({ occurredAt: '2026-07-15T09:00:00.000Z' }),
        AUTOR,
      );
      const [comData] = repo.criar.mock.calls[0];
      expect(comData.occurredAt.toISOString()).toBe('2026-07-15T09:00:00.000Z');
    });

    /*
      `subjectId` não tem FK (o titular é Client OU Contact), então o banco não
      reclamaria de um id de outra workspace. Quem fecha é o `findOne`, que
      responde 404.
    */
    it('titular de OUTRO owner não entra: o 404 do findOne sobe', async () => {
      clients.findOne.mockRejectedValue(
        new NotFoundException('Cliente não encontrado.'),
      );

      await expect(service.registrar(OWNER, dto(), AUTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.criar).not.toHaveBeenCalled();
    });

    it('valida CONTACT pelo ContactsService, e CLIENT pelo ClientsService', async () => {
      await service.registrar(OWNER, dto(), AUTOR);
      expect(clients.findOne).toHaveBeenCalledWith(OWNER, CLIENTE);
      expect(contacts.findOne).not.toHaveBeenCalled();

      await service.registrar(
        OWNER,
        dto({ subjectType: 'CONTACT', subjectId: 'contato-1' }),
        AUTOR,
      );
      expect(contacts.findOne).toHaveBeenCalledWith(OWNER, 'contato-1');
    });

    it('o log distingue registro de revogação e não carrega PII do titular', async () => {
      await service.registrar(OWNER, dto({ granted: true }), AUTOR);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'consentimento.registrado' }),
      );

      logSpy.mockClear();
      await service.registrar(OWNER, dto({ granted: false }), AUTOR);
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'consentimento.revogado' }),
      );
      // Nome, e-mail e telefone do titular ficam fora: o Grafana é publicado.
      const linhas = JSON.stringify(logSpy.mock.calls);
      expect(linhas).not.toContain('Ana Ribeiro');
    });
  });

  describe('historico e situação vigente', () => {
    /*
      A situação é resolvida pela ÚLTIMA manifestação de cada finalidade — e o
      histórico inteiro continua visível, que é o ponto do append-only.
    */
    it('a última manifestação por finalidade vence, e o histórico é preservado', async () => {
      repo.findHistorico.mockResolvedValue([
        // Do mais recente para o mais antigo, como o repositório ordena.
        linha({
          id: 'r3',
          purpose: 'comunicacao_marketing',
          granted: false,
          occurredAt: new Date('2026-08-03T10:00:00Z'),
        }),
        linha({
          id: 'r2',
          purpose: 'comunicacao_whatsapp',
          granted: true,
          occurredAt: new Date('2026-08-02T10:00:00Z'),
        }),
        linha({
          id: 'r1',
          purpose: 'comunicacao_marketing',
          granted: true,
          occurredAt: new Date('2026-08-01T10:00:00Z'),
        }),
      ]);

      const r = await service.historico(OWNER, 'CLIENT', CLIENTE);

      expect(r.situacao).toEqual([
        expect.objectContaining({
          purpose: 'comunicacao_marketing',
          granted: false,
        }),
        expect.objectContaining({
          purpose: 'comunicacao_whatsapp',
          granted: true,
        }),
      ]);
      // As TRÊS linhas continuam no histórico: a revogada não some.
      expect(r.historico).toHaveLength(3);
      expect(r.historico.map((h) => h.id)).toEqual(['r3', 'r2', 'r1']);
    });

    it('finalidade sem manifestação nenhuma simplesmente não aparece na situação', async () => {
      repo.findHistorico.mockResolvedValue([]);
      const r = await service.historico(OWNER, 'CLIENT', CLIENTE);
      expect(r.situacao).toEqual([]);
      expect(r.historico).toEqual([]);
    });

    it('duas finalidades são independentes', async () => {
      repo.findHistorico.mockResolvedValue([
        linha({ id: 'r2', purpose: 'comunicacao_whatsapp', granted: false }),
        linha({ id: 'r1', purpose: 'comunicacao_marketing', granted: true }),
      ]);
      const r = await service.historico(OWNER, 'CLIENT', CLIENTE);
      expect(
        r.situacao.find((s) => s.purpose === 'comunicacao_marketing')?.granted,
      ).toBe(true);
      expect(
        r.situacao.find((s) => s.purpose === 'comunicacao_whatsapp')?.granted,
      ).toBe(false);
    });
  });

  describe('texto', () => {
    /*
      O controlador desses dados é o OWNER, não a ProgrameAi (que é operadora).
      Codificar o nome no catálogo faria o texto mentir em toda instância.
    */
    it('preenche o controlador com o nome e o e-mail do owner', async () => {
      const r = await service.texto(OWNER, 'comunicacao_marketing');

      expect(r.version).toBe(textoVigente('comunicacao_marketing').version);
      expect(r.text).toContain('Agência Alfa');
      expect(r.text).toContain('dpo@alfa.local');
      // Nenhum marcador sobra sem substituir.
      expect(r.text).not.toContain('{controlador}');
      expect(r.text).not.toContain('{contato}');
    });

    it('o texto cobre o que o art. 9º manda ter sido informado', async () => {
      const r = await service.texto(OWNER, 'comunicacao_marketing');
      expect(r.text).toContain('Finalidade:');
      expect(r.text).toContain('Forma e duração:');
      expect(r.text).toContain('Controlador:');
      expect(r.text).toContain('Contato');
      expect(r.text).toContain('Uso compartilhado:');
      expect(r.text).toContain('Meus direitos:');
      // …e diz que a revogação não desfaz o passado (art. 8º § 5º).
      expect(r.text).toContain('não desfaz o que foi feito');
    });

    it('o compartilhamento com terceiro declara ser autorização ESPECÍFICA', async () => {
      // Art. 7º § 5º: consentimento específico e destacado para compartilhar.
      const r = await service.texto(OWNER, 'compartilhamento_terceiro');
      expect(r.text).toContain('art. 7º, § 5º');
      expect(r.text).toContain('separada das demais');
    });
  });
});
