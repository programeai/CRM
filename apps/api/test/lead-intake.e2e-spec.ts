import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { criarAppDeTeste } from './helpers/app';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import { criarOwner } from './helpers/fixtures';

/**
 * `POST /leads/intake` é a única rota PÚBLICA que escreve em tabela com RLS
 * (`Client`, `Contact`). Ela não passa pelo `OwnerContextInterceptor` — não tem
 * `req.user` —, então o `app.owner_id` é setado à mão por
 * `PrismaService.executarComoOwner`. Se esse contexto quebrar, o RLS responde
 * fail-closed e a captação do site para de gravar **sem erro visível no site**:
 * é por isso que este caminho tem e2e com banco de verdade, e não só spec de
 * regra com Prisma mockado.
 */
/*
  Os dois valores vêm de `test/.env.test` e são repetidos aqui de propósito: o
  `ConfigModule.forRoot()` roda no import do AppModule, antes de qualquer
  `beforeAll`, então setar `process.env` daqui chegaria tarde e a rota
  responderia 503 em todos os casos. Mudar um lado exige mudar o outro.
*/
const TOKEN = 'token-de-ingestao-para-teste-com-32-caracteres';
const EMAIL_DO_OWNER = 'dono-da-ingestao@teste.local';

describe('Ingestão de lead (e2e)', () => {
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

  const enviar = (corpo: Record<string, unknown>, token = TOKEN) =>
    http()
      .post('/api/v1/leads/intake')
      .set('Authorization', `Bearer ${token}`)
      .send(corpo);

  const LEAD = {
    nome: 'Ana Ribeiro',
    whatsapp: '84999398021',
    telefone: '+5584999398021',
    email: 'ana@teste.local',
    empresa: null,
    cidade: 'Mossoró',
    mensagem: 'Quero um site que traga paciente.',
    origem: 'site-institucional',
    pagina: '/',
    recebidoEm: '2026-07-27T17:32:00.000Z',
    qualificacao: { custo: ['folha'] },
    resumo: 'Cenário identificado: Operação no limite',
    cenario: 'Operação no limite',
  };

  it('recusa sem token e com token errado, antes de tocar o banco', async () => {
    await criarOwner(EMAIL_DO_OWNER);

    await http().post('/api/v1/leads/intake').send(LEAD).expect(401);
    await enviar(LEAD, 'token-errado-mas-com-tamanho-suficiente').expect(401);

    expect(await clientAdmin().client.count()).toBe(0);
  });

  it('grava o lead como cliente LEAD com contato principal — passa pelo RLS', async () => {
    const owner = await criarOwner(EMAIL_DO_OWNER);

    const resposta = await enviar(LEAD).expect(200);
    expect(resposta.body).toEqual({
      status: 'criado',
      clientId: expect.any(String),
    });

    const cliente = await clientAdmin().client.findFirstOrThrow({
      include: { contacts: true },
    });
    expect(cliente.ownerId).toBe(owner.id);
    expect(cliente.status).toBe('LEAD');
    expect(cliente.name).toBe('Ana Ribeiro');
    expect(cliente.phone).toBe('+5584999398021');
    expect(cliente.city).toBe('Mossoró');
    expect(cliente.tags).toEqual(['site-institucional']);
    expect(cliente.notes).toContain('Cenário: Operação no limite');
    expect(cliente.notes).toContain('Quero um site que traga paciente.');
    expect(cliente.contacts).toHaveLength(1);
    expect(cliente.contacts[0]).toMatchObject({
      name: 'Ana Ribeiro',
      isPrimary: true,
      ownerId: owner.id,
    });
  });

  it('o mesmo WhatsApp não abre segundo cadastro: empilha a nota', async () => {
    await criarOwner(EMAIL_DO_OWNER);

    const primeira = await enviar(LEAD).expect(200);
    const segunda = await enviar({
      ...LEAD,
      mensagem: 'Voltei, agora quero sistema.',
      cenario: 'Voltou',
    }).expect(200);

    expect(segunda.body).toEqual({
      status: 'atualizado',
      clientId: (primeira.body as { clientId: string }).clientId,
    });
    expect(await clientAdmin().client.count()).toBe(1);
    expect(await clientAdmin().contact.count()).toBe(1);

    const cliente = await clientAdmin().client.findFirstOrThrow();
    expect(cliente.notes).toContain('Voltei, agora quero sistema.');
    expect(cliente.notes).toContain('Quero um site que traga paciente.');
    expect(cliente.notes?.indexOf('Voltei')).toBeLessThan(
      cliente.notes?.indexOf('Quero um site') ?? 0,
    );
  });

  it('emite LEAD_RECEIVED para o destino do owner que assinou o tipo', async () => {
    const owner = await criarOwner(EMAIL_DO_OWNER);
    await clientAdmin().userNotificationTarget.create({
      data: {
        ownerId: owner.id,
        userId: owner.id,
        kind: 'IN_APP',
        label: 'Central',
        config: {},
        types: ['LEAD_RECEIVED'],
        verified: true,
      },
    });

    await enviar(LEAD).expect(200);

    const notificacao = await clientAdmin().notification.findFirstOrThrow({
      include: { deliveries: true },
    });
    expect(notificacao.type).toBe('LEAD_RECEIVED');
    expect(notificacao.userId).toBe(owner.id);
    expect(notificacao.title).toBe('Lead novo');
    expect(notificacao.body).toContain('Operação no limite');
    // O corpo viaja para Telegram/Slack/webhook: contato do lead não entra nele.
    expect(notificacao.body).not.toContain('ana@teste.local');
    expect(notificacao.body).not.toContain('84999398021');
    expect(notificacao.deliveries).toHaveLength(1);
    expect(notificacao.deliveries[0].status).toBe('PENDING');
  });

  it('recusa campo fora do contrato e WhatsApp incompleto', async () => {
    await criarOwner(EMAIL_DO_OWNER);

    await enviar({ ...LEAD, campoInventado: 'x' }).expect(400);
    await enviar({ ...LEAD, whatsapp: '999' }).expect(400);
    expect(await clientAdmin().client.count()).toBe(0);
  });

  it('responde 503 quando o e-mail configurado não é de nenhum owner', async () => {
    await enviar(LEAD).expect(503);
  });
});
