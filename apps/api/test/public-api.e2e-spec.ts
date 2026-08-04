import type { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { criarAppDeTeste } from './helpers/app';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import { criarOwner } from './helpers/fixtures';

/**
 * `POST /api/v1/public/*` são rotas PÚBLICAS que escrevem em tabelas com RLS
 * (`Client`, `Deal`, `Activity`, `Task`, `AuditLog`, `IntegrationKey`). Não
 * passam pelo `OwnerContextInterceptor` — não têm `req.user` —, então o
 * `app.owner_id` é setado à mão por `PrismaService.executarComoOwner`.
 *
 * Todo caso de sucesso **afirma a linha no banco pelo `clientAdmin()`**, e não
 * só o status da resposta: sem contexto de owner o RLS não estoura, ele grava
 * zero linha e a rota responde sucesso. Esse é o caminho que já quebrou uma vez
 * com a suíte inteira verde.
 */
describe('API pública de escrita (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(limparBanco);
  afterAll(async () => {
    await app.close();
    await fecharBanco();
  });

  const http = () => request(app.getHttpServer());

  const postar = (
    rota: string,
    corpo: Record<string, unknown>,
    credencial?: string,
  ) => {
    const req = http().post(`/api/v1/public/${rota}`);
    if (credencial) req.set('Authorization', `Bearer ${credencial}`);
    return req.send(corpo);
  };

  const TODOS_OS_ESCOPOS = [
    'cliente:escrever',
    'negociacao:escrever',
    'atividade:escrever',
    'tarefa:escrever',
  ];

  /** Semeia chave de API avulsa e devolve o valor bruto para o teste usar. */
  async function criarChave(
    ownerId: string,
    opts: {
      nome?: string;
      scopes?: string[];
      revogada?: boolean;
    } = {},
  ) {
    const valor = `crm_${randomBytes(32).toString('hex')}`;
    const chave = await clientAdmin().integrationKey.create({
      data: {
        ownerId,
        name: opts.nome ?? 'ERP da produção',
        keyHash: createHash('sha256').update(valor).digest('hex'),
        prefix: valor.slice(0, 12),
        scopes: opts.scopes ?? TODOS_OS_ESCOPOS,
        ...(opts.revogada ? { revokedAt: new Date() } : {}),
      },
    });
    return { valor, chaveId: chave.id, nome: chave.name };
  }

  /** O funil e o catálogo de serviços mínimos para uma oportunidade existir. */
  async function semearFunil(ownerId: string) {
    const stage = await clientAdmin().pipelineStage.create({
      data: { ownerId, name: 'Diagnóstico', order: 1 },
    });
    const servico = await clientAdmin().serviceCatalog.create({
      data: { ownerId, name: 'Site institucional' },
    });
    return { stageId: stage.id, serviceTypeId: servico.id };
  }

  async function criarCliente(ownerId: string, nome = 'Acme') {
    return clientAdmin().client.create({
      data: { ownerId, name: nome, status: 'ACTIVE' },
    });
  }

  describe('POST /public/clients', () => {
    it('cria o cliente do OWNER DA CHAVE — a linha existe no banco (passa pelo RLS)', async () => {
      const owner = await criarOwner('dono@teste.local');
      const { valor } = await criarChave(owner.id);

      const resposta = await postar(
        'clients',
        { name: 'Acme Teste', email: 'contato@acme.local' },
        valor,
      ).expect(201);

      expect(resposta.body).toEqual({
        id: expect.any(String),
        status: 'LEAD', // default do schema
      });
      const cliente = await clientAdmin().client.findFirstOrThrow();
      expect(cliente.ownerId).toBe(owner.id);
      expect(cliente.name).toBe('Acme Teste');
      expect(cliente.email).toBe('contato@acme.local');
    });

    it('a chave de um owner grava na workspace DELA, e ownerId pelo corpo é recusado', async () => {
      const a = await criarOwner('a@teste.local');
      const b = await criarOwner('b@teste.local');
      const chaveDeA = await criarChave(a.id);

      // O DTO não tem `ownerId`, e `forbidNonWhitelisted` recusa a requisição
      // inteira: não há como injetar owner pelo corpo.
      await postar(
        'clients',
        { name: 'Acme Teste', ownerId: b.id },
        chaveDeA.valor,
      ).expect(400);
      expect(await clientAdmin().client.count()).toBe(0);

      await postar('clients', { name: 'Acme Teste' }, chaveDeA.valor).expect(
        201,
      );
      const clientes = await clientAdmin().client.findMany();
      expect(clientes).toHaveLength(1);
      expect(clientes[0].ownerId).toBe(a.id);
      expect(
        await clientAdmin().client.count({ where: { ownerId: b.id } }),
      ).toBe(0);
    });

    it('chave sem o escopo da rota responde 403 e não grava', async () => {
      const owner = await criarOwner('dono@teste.local');
      const { valor } = await criarChave(owner.id, {
        scopes: ['tarefa:escrever'],
      });

      const resposta = await postar(
        'clients',
        { name: 'Acme Teste' },
        valor,
      ).expect(403);

      expect((resposta.body as { message: string }).message).toBe(
        'Esta chave de integração não tem permissão para esta operação.',
      );
      expect(await clientAdmin().client.count()).toBe(0);
    });

    it('chave revogada responde 401 e não grava', async () => {
      const owner = await criarOwner('dono@teste.local');
      const { valor } = await criarChave(owner.id, { revogada: true });

      const resposta = await postar(
        'clients',
        { name: 'Acme Teste' },
        valor,
      ).expect(401);

      expect((resposta.body as { message: string }).message).toBe(
        'Chave de integração inválida.',
      );
      expect(await clientAdmin().client.count()).toBe(0);
    });

    it('sem header Authorization responde 401 e não grava', async () => {
      await criarOwner('dono@teste.local');

      await postar('clients', { name: 'Acme Teste' }).expect(401);

      expect(await clientAdmin().client.count()).toBe(0);
    });

    it('registra a trilha com actorType INTEGRACAO e o nome da chave como ator', async () => {
      const owner = await criarOwner('dono@teste.local');
      const { valor, chaveId, nome } = await criarChave(owner.id, {
        nome: 'ERP da produção',
      });

      const resposta = await postar(
        'clients',
        { name: 'Acme Teste' },
        valor,
      ).expect(201);

      const trilha = await clientAdmin().auditLog.findFirstOrThrow();
      expect(trilha.actorType).toBe('INTEGRACAO');
      expect(trilha.actorName).toBe(nome);
      expect(trilha.actorId).toBe(chaveId); // o id da CHAVE, não de um usuário
      expect(trilha.ownerId).toBe(owner.id);
      expect(trilha.entity).toBe('CLIENT');
      expect(trilha.entityId).toBe((resposta.body as { id: string }).id);
      expect(trilha.action).toBe('CRIAR');
    });

    it('marca lastUsedAt no sucesso e NÃO marca quando a transação rola de volta', async () => {
      const owner = await criarOwner('dono@teste.local');
      const { valor, chaveId } = await criarChave(owner.id);

      // Documento inválido reprova DENTRO da transação (BadRequest do service),
      // depois de `registrarUso`: o rollback tem de desfazer a marca de uso.
      await postar(
        'clients',
        { name: 'Acme Teste', document: '123' },
        valor,
      ).expect(400);
      const aposFalha = await clientAdmin().integrationKey.findUniqueOrThrow({
        where: { id: chaveId },
      });
      expect(aposFalha.lastUsedAt).toBeNull();
      expect(await clientAdmin().client.count()).toBe(0);

      await postar('clients', { name: 'Acme Teste' }, valor).expect(201);
      const aposSucesso = await clientAdmin().integrationKey.findUniqueOrThrow({
        where: { id: chaveId },
      });
      expect(aposSucesso.lastUsedAt).not.toBeNull();
    });
  });

  describe('POST /public/deals', () => {
    it('cria a oportunidade no primeiro estágio do funil do owner', async () => {
      const owner = await criarOwner('dono@teste.local');
      const { valor } = await criarChave(owner.id);
      const { stageId, serviceTypeId } = await semearFunil(owner.id);
      const cliente = await criarCliente(owner.id);

      const resposta = await postar(
        'deals',
        {
          clientId: cliente.id,
          title: 'Reforma do site',
          serviceTypeId,
          amount: 12000,
        },
        valor,
      ).expect(201);

      expect(resposta.body).toEqual({ id: expect.any(String), stageId });
      const deal = await clientAdmin().deal.findFirstOrThrow();
      expect(deal.ownerId).toBe(owner.id);
      expect(deal.clientId).toBe(cliente.id);
      expect(deal.title).toBe('Reforma do site');
      expect(deal.stageId).toBe(stageId);
    });

    it('clientId de outro owner responde 404 e não cria oportunidade nenhuma', async () => {
      const a = await criarOwner('a@teste.local');
      const b = await criarOwner('b@teste.local');
      const chaveDeA = await criarChave(a.id);
      const { serviceTypeId } = await semearFunil(a.id);
      await semearFunil(b.id);
      const clienteDeB = await criarCliente(b.id, 'Cliente do B');

      const resposta = await postar(
        'deals',
        {
          clientId: clienteDeB.id,
          title: 'Não deveria existir',
          serviceTypeId,
        },
        chaveDeA.valor,
      ).expect(404);

      expect((resposta.body as { message: string }).message).toBe(
        'Cliente não encontrado.',
      );
      expect(await clientAdmin().deal.count()).toBe(0);
    });
  });

  describe('POST /public/activities', () => {
    it('lança a atividade no histórico do cliente', async () => {
      const owner = await criarOwner('dono@teste.local');
      const { valor } = await criarChave(owner.id);
      const cliente = await criarCliente(owner.id);
      const tipo = await clientAdmin().activityTypeCatalog.create({
        data: { ownerId: owner.id, name: 'Ligação' },
      });

      const resposta = await postar(
        'activities',
        {
          clientId: cliente.id,
          typeId: tipo.id,
          content: 'Cliente pediu proposta por telefone.',
        },
        valor,
      ).expect(201);

      expect(resposta.body).toEqual({ id: expect.any(String) });
      const atividade = await clientAdmin().activity.findFirstOrThrow();
      expect(atividade.ownerId).toBe(owner.id);
      expect(atividade.clientId).toBe(cliente.id);
      expect(atividade.content).toBe('Cliente pediu proposta por telefone.');

      // A trilha nomeia a credencial, e o rótulo é o começo do conteúdo.
      const trilha = await clientAdmin().auditLog.findFirstOrThrow();
      expect(trilha.actorType).toBe('INTEGRACAO');
      expect(trilha.entity).toBe('ACTIVITY');
      expect(trilha.entityLabel).toBe('Cliente pediu proposta por telefone.');
    });
  });

  describe('POST /public/tasks', () => {
    it('abre a demanda no quadro do projeto', async () => {
      const owner = await criarOwner('dono@teste.local');
      const { valor } = await criarChave(owner.id);
      const { serviceTypeId } = await semearFunil(owner.id);
      const cliente = await criarCliente(owner.id);
      const projeto = await clientAdmin().project.create({
        data: {
          ownerId: owner.id,
          clientId: cliente.id,
          name: 'Site institucional',
          serviceTypeId,
        },
      });

      const resposta = await postar(
        'tasks',
        {
          projectId: projeto.id,
          title: 'Publicar homepage',
          priority: 'HIGH',
        },
        valor,
      ).expect(201);

      expect(resposta.body).toEqual({
        id: expect.any(String),
        status: 'BACKLOG',
      });
      const demanda = await clientAdmin().task.findFirstOrThrow();
      expect(demanda.ownerId).toBe(owner.id);
      expect(demanda.projectId).toBe(projeto.id);
      expect(demanda.title).toBe('Publicar homepage');
      expect(demanda.priority).toBe('HIGH');
    });
  });
});
