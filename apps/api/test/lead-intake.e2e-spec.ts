import type { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { criarAppDeTeste } from './helpers/app';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import { criarColaborador, criarOwner, criarPapel } from './helpers/fixtures';

/**
 * `POST /leads/intake` é a única rota PÚBLICA que escreve em tabela com RLS
 * (`Client`, `Contact`). Ela não passa pelo `OwnerContextInterceptor` — não tem
 * `req.user` —, então o `app.owner_id` é setado à mão por
 * `PrismaService.executarComoOwner`. Se esse contexto quebrar, o RLS responde
 * fail-closed e a captação do site para de gravar **sem erro visível no site**:
 * é por isso que este caminho tem e2e com banco de verdade, e não só spec de
 * regra com Prisma mockado.
 *
 * O caminho principal (chave de integração) não depende de `test/.env.test`: a
 * credencial é semeada no banco por `criarCanal`. Só o `describe` do legado
 * ainda depende, e o comentário lá explica por quê.
 */
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

  const enviar = (corpo: Record<string, unknown>, credencial: string) =>
    http()
      .post('/api/v1/leads/intake')
      .set('Authorization', `Bearer ${credencial}`)
      .send(corpo);

  /** Semeia canal + chave de um owner e devolve o valor bruto para o teste usar. */
  async function criarCanal(
    ownerId: string,
    opts: {
      nome?: string;
      assigneeId?: string;
      sourceId?: string;
      scopes?: string[];
      revogada?: boolean;
    } = {},
  ) {
    const nome = opts.nome ?? 'Site';
    const valor = `crm_${randomBytes(32).toString('hex')}`;
    const chave = await clientAdmin().integrationKey.create({
      data: {
        ownerId,
        name: nome,
        keyHash: createHash('sha256').update(valor).digest('hex'),
        prefix: valor.slice(0, 12),
        scopes: opts.scopes ?? ['lead:receber'],
        ...(opts.revogada ? { revokedAt: new Date() } : {}),
      },
    });
    const canal = await clientAdmin().leadIntakeChannel.create({
      data: {
        ownerId,
        name: nome,
        keyId: chave.id,
        ...(opts.assigneeId ? { assigneeId: opts.assigneeId } : {}),
        ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
      },
    });
    return { valor, chaveId: chave.id, canalId: canal.id };
  }

  /**
   * `notificarPeloSistema` só grava a linha quando o destinatário TEM um destino
   * assinado no tipo (ver `NotificationsService.notificarPeloSistema`). Todo
   * teste que afirma quem foi avisado precisa semear o destino de cada
   * candidato — inclusive de quem NÃO deve receber, senão "recebeu zero" seria
   * verdade só por falta de destino.
   */
  async function assinarLeadRecebido(ownerId: string, userId: string) {
    await clientAdmin().userNotificationTarget.create({
      data: {
        ownerId,
        userId,
        kind: 'IN_APP',
        label: 'Central',
        config: {},
        types: ['LEAD_RECEIVED'],
        verified: true,
      },
    });
  }

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

  it('recusa sem credencial e com credencial desconhecida, antes de tocar o banco', async () => {
    await criarOwner(EMAIL_DO_OWNER);

    await http().post('/api/v1/leads/intake').send(LEAD).expect(401);
    await enviar(LEAD, `crm_${randomBytes(32).toString('hex')}`).expect(401);

    expect(await clientAdmin().client.count()).toBe(0);
  });

  it('grava o lead do OWNER DA CHAVE, com contato principal — passa pelo RLS', async () => {
    const owner = await criarOwner(EMAIL_DO_OWNER);
    const { valor } = await criarCanal(owner.id);

    const resposta = await enviar(LEAD, valor).expect(200);
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

  it('a chave de um owner não grava na workspace do outro', async () => {
    const a = await criarOwner('a@teste.local');
    const b = await criarOwner('b@teste.local');
    const chaveDeA = await criarCanal(a.id);
    await criarCanal(b.id);

    await enviar(LEAD, chaveDeA.valor).expect(200);

    const clientes = await clientAdmin().client.findMany();
    expect(clientes).toHaveLength(1);
    expect(clientes[0].ownerId).toBe(a.id);
    expect(await clientAdmin().client.count({ where: { ownerId: b.id } })).toBe(
      0,
    );
  });

  it('chave revogada responde 401 e não grava', async () => {
    const owner = await criarOwner(EMAIL_DO_OWNER);
    const { valor } = await criarCanal(owner.id, { revogada: true });

    await enviar(LEAD, valor).expect(401);

    expect(await clientAdmin().client.count()).toBe(0);
  });

  it('chave sem o escopo lead:receber responde 403 e não grava', async () => {
    const owner = await criarOwner(EMAIL_DO_OWNER);
    const { valor } = await criarCanal(owner.id, { scopes: [] });

    await enviar(LEAD, valor).expect(403);

    expect(await clientAdmin().client.count()).toBe(0);
  });

  it('marca lastUsedAt na chave depois do commit', async () => {
    const owner = await criarOwner(EMAIL_DO_OWNER);
    const { valor, chaveId } = await criarCanal(owner.id);

    const antes = await clientAdmin().integrationKey.findUniqueOrThrow({
      where: { id: chaveId },
    });
    expect(antes.lastUsedAt).toBeNull();

    await enviar(LEAD, valor).expect(200);

    const depois = await clientAdmin().integrationKey.findUniqueOrThrow({
      where: { id: chaveId },
    });
    expect(depois.lastUsedAt).not.toBeNull();
  });

  it('o mesmo WhatsApp não abre segundo cadastro: empilha a nota', async () => {
    const owner = await criarOwner(EMAIL_DO_OWNER);
    const { valor } = await criarCanal(owner.id);

    const primeira = await enviar(LEAD, valor).expect(200);
    const segunda = await enviar(
      {
        ...LEAD,
        mensagem: 'Voltei, agora quero sistema.',
        cenario: 'Voltou',
      },
      valor,
    ).expect(200);

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
    const { valor } = await criarCanal(owner.id);
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

    await enviar(LEAD, valor).expect(200);

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
    const owner = await criarOwner(EMAIL_DO_OWNER);
    const { valor } = await criarCanal(owner.id);

    await enviar({ ...LEAD, campoInventado: 'x' }, valor).expect(400);
    await enviar({ ...LEAD, whatsapp: '999' }, valor).expect(400);
    expect(await clientAdmin().client.count()).toBe(0);
  });

  describe('roteamento pelo canal', () => {
    it('o lead nasce com o responsável e a fonte do canal', async () => {
      const owner = await criarOwner(EMAIL_DO_OWNER);
      const papel = await criarPapel(owner.id, ['cliente:ver']);
      const colab = await criarColaborador(
        'colab@teste.local',
        owner.id,
        papel.id,
      );
      const fonte = await clientAdmin().leadSourceCatalog.create({
        data: { ownerId: owner.id, name: 'Tráfego pago' },
      });
      const { valor } = await criarCanal(owner.id, {
        assigneeId: colab.id,
        sourceId: fonte.id,
      });

      await enviar(LEAD, valor).expect(200);

      const cliente = await clientAdmin().client.findFirstOrThrow();
      expect(cliente.assigneeId).toBe(colab.id);
      expect(cliente.sourceId).toBe(fonte.id);
      expect(cliente.tags).toEqual(['site-institucional']); // a tag permanece
    });

    it('LEAD_RECEIVED vai para o responsável quando o canal roteia', async () => {
      const owner = await criarOwner(EMAIL_DO_OWNER);
      const papel = await criarPapel(owner.id, ['cliente:ver']);
      const colab = await criarColaborador(
        'colab@teste.local',
        owner.id,
        papel.id,
      );
      const { valor } = await criarCanal(owner.id, { assigneeId: colab.id });
      // Os DOIS assinam o tipo: o owner não receber tem de ser decisão do
      // roteamento, não falta de destino.
      await assinarLeadRecebido(owner.id, owner.id);
      await assinarLeadRecebido(owner.id, colab.id);

      await enviar(LEAD, valor).expect(200);

      const notificacao = await clientAdmin().notification.findFirstOrThrow();
      expect(notificacao.type).toBe('LEAD_RECEIVED');
      expect(notificacao.userId).toBe(colab.id);
      // O owner deixa de receber: é o efeito pretendido de rotear o canal.
      expect(
        await clientAdmin().notification.count({ where: { userId: owner.id } }),
      ).toBe(0);
    });

    it('responsável desativado é descartado: o lead entra sem responsável', async () => {
      const owner = await criarOwner(EMAIL_DO_OWNER);
      const papel = await criarPapel(owner.id, ['cliente:ver']);
      const colab = await criarColaborador(
        'colab@teste.local',
        owner.id,
        papel.id,
      );
      const { valor } = await criarCanal(owner.id, { assigneeId: colab.id });
      await assinarLeadRecebido(owner.id, owner.id);
      await assinarLeadRecebido(owner.id, colab.id);
      await clientAdmin().user.update({
        where: { id: colab.id },
        data: { active: false },
      });

      // A captação NÃO falha: um site do outro lado não mostraria o erro.
      await enviar(LEAD, valor).expect(200);

      const cliente = await clientAdmin().client.findFirstOrThrow();
      expect(cliente.assigneeId).toBeNull();
      // …e o aviso volta para o owner.
      const notificacao = await clientAdmin().notification.findFirstOrThrow();
      expect(notificacao.userId).toBe(owner.id);
    });

    it('lead reincidente mantém quem já cuidava e não reescreve a fonte', async () => {
      const owner = await criarOwner(EMAIL_DO_OWNER);
      const papel = await criarPapel(owner.id, ['cliente:ver']);
      const jaCuidava = await criarColaborador(
        'ja-cuidava@teste.local',
        owner.id,
        papel.id,
      );
      const doCanal = await criarColaborador(
        'do-canal@teste.local',
        owner.id,
        papel.id,
      );
      const fonteAntiga = await clientAdmin().leadSourceCatalog.create({
        data: { ownerId: owner.id, name: 'Indicação' },
      });
      const fonteDoCanal = await clientAdmin().leadSourceCatalog.create({
        data: { ownerId: owner.id, name: 'Tráfego pago' },
      });
      const { valor } = await criarCanal(owner.id, {
        assigneeId: doCanal.id,
        sourceId: fonteDoCanal.id,
      });
      await assinarLeadRecebido(owner.id, jaCuidava.id);
      await assinarLeadRecebido(owner.id, doCanal.id);
      // Cadastro que já existe, com dono e fonte próprios.
      await clientAdmin().client.create({
        data: {
          ownerId: owner.id,
          name: 'Ana Ribeiro',
          phone: '+5584999398021',
          status: 'LEAD',
          tags: ['indicacao-antiga'],
          assigneeId: jaCuidava.id,
          sourceId: fonteAntiga.id,
        },
      });

      await enviar(LEAD, valor).expect(200);

      expect(await clientAdmin().client.count()).toBe(1);
      const cliente = await clientAdmin().client.findFirstOrThrow();
      expect(cliente.assigneeId).toBe(jaCuidava.id);
      expect(cliente.sourceId).toBe(fonteAntiga.id);
      expect(cliente.tags).toEqual(['indicacao-antiga']);
      // O aviso vai para quem já cuidava, não para o responsável do canal.
      const notificacao = await clientAdmin().notification.findFirstOrThrow();
      expect(notificacao.userId).toBe(jaCuidava.id);
    });

    it('lead reincidente SEM responsável assume o do canal', async () => {
      const owner = await criarOwner(EMAIL_DO_OWNER);
      const papel = await criarPapel(owner.id, ['cliente:ver']);
      const doCanal = await criarColaborador(
        'do-canal@teste.local',
        owner.id,
        papel.id,
      );
      const { valor } = await criarCanal(owner.id, { assigneeId: doCanal.id });
      await clientAdmin().client.create({
        data: {
          ownerId: owner.id,
          name: 'Ana Ribeiro',
          phone: '+5584999398021',
          status: 'LEAD',
          assigneeId: null,
        },
      });

      await enviar(LEAD, valor).expect(200);

      const cliente = await clientAdmin().client.findFirstOrThrow();
      expect(cliente.assigneeId).toBe(doCanal.id);
    });
  });

  describe('caminho legado (token de ambiente)', () => {
    /*
      O token vem de `test/.env.test` e é repetido aqui de propósito: o
      `ConfigModule.forRoot()` roda no import do AppModule, antes de qualquer
      `beforeAll`, então setar `process.env` daqui chegaria tarde. Esta é a
      ÚNICA parte do spec que depende disso — o caminho da chave não depende.
      Mudar um lado exige mudar o outro.
    */
    const TOKEN = 'token-de-ingestao-para-teste-com-32-caracteres';

    it('aceita o token do ambiente e grava na conta de LEAD_INTAKE_OWNER_EMAIL', async () => {
      const owner = await criarOwner(EMAIL_DO_OWNER);

      await enviar(LEAD, TOKEN).expect(200);

      const cliente = await clientAdmin().client.findFirstOrThrow();
      expect(cliente.ownerId).toBe(owner.id);
    });

    it('não roteia nem classifica: assigneeId e sourceId ficam nulos', async () => {
      await criarOwner(EMAIL_DO_OWNER);

      await enviar(LEAD, TOKEN).expect(200);

      const cliente = await clientAdmin().client.findFirstOrThrow();
      expect(cliente.assigneeId).toBeNull();
      expect(cliente.sourceId).toBeNull();
      // A tag da origem continua sendo o que classifica o lead legado.
      expect(cliente.tags).toEqual(['site-institucional']);
    });

    it('sem owner correspondente ao e-mail configurado responde 503', async () => {
      await enviar(LEAD, TOKEN).expect(503);

      expect(await clientAdmin().client.count()).toBe(0);
    });
  });
});
