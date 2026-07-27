import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { criarAppDeTeste } from './helpers/app';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import { criarOwner, SENHA_PADRAO } from './helpers/fixtures';

interface RespostaToken {
  accessToken: string;
}
interface RespostaErro {
  message: string;
}
interface RespostaMe {
  email: string;
}
interface SessaoListada {
  id: string;
  device: string;
  current: boolean;
}

describe('Auth (e2e)', () => {
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

  /** `nome=valor` do cookie pedido, pronto para voltar num `.set('Cookie', …)`. */
  const cookie = (resposta: request.Response, nome: string): string => {
    const enviados = resposta.headers['set-cookie'] as unknown as string[];
    const bruto = (enviados ?? []).find((c) => c.startsWith(`${nome}=`));
    if (!bruto) throw new Error(`A resposta não trouxe o cookie ${nome}.`);
    return bruto.split(';')[0];
  };

  const logar = (email: string, cookies: string[] = []) =>
    http()
      .post('/api/v1/auth/login')
      .set('Cookie', cookies)
      .send({ email, password: SENHA_PADRAO });

  const listarSessoes = async (accessToken: string) => {
    const resposta = await http()
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return resposta.body as SessaoListada[];
  };

  it('registro cria conta e devolve token — toca db.user e db.session fora de transação', async () => {
    const resposta = await http()
      .post('/api/v1/auth/register')
      .send({
        email: 'novo@teste.local',
        name: 'Novo',
        password: SENHA_PADRAO,
      })
      .expect(201);

    const corpo: RespostaToken = resposta.body;
    expect(corpo.accessToken).toEqual(expect.any(String));
    // O cookie de refresh é httpOnly e vive em /api/v1/auth.
    expect(resposta.headers['set-cookie']).toBeDefined();
  });

  it('login devolve accessToken e cookie de refresh', async () => {
    await criarOwner('owner@teste.local');

    const resposta = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: SENHA_PADRAO })
      .expect(201);

    const corpo: RespostaToken = resposta.body;
    expect(corpo.accessToken).toEqual(expect.any(String));
  });

  it('login com senha errada responde 401 em pt-BR', async () => {
    await criarOwner('owner@teste.local');

    const resposta = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: 'errada' })
      .expect(401);

    const corpo: RespostaErro = resposta.body;
    expect(corpo.message).toBe('Credenciais inválidas');
  });

  it('token do login abre rota autenticada (/auth/me)', async () => {
    await criarOwner('owner@teste.local');
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: SENHA_PADRAO });
    const { accessToken }: RespostaToken = login.body;

    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const corpo: RespostaMe = me.body;
    expect(corpo.email).toBe('owner@teste.local');
  });

  it('rota autenticada sem token responde 401', async () => {
    await http().get('/api/v1/auth/me').expect(401);
  });

  it('refresh rotaciona a sessão e devolve token novo', async () => {
    await criarOwner('owner@teste.local');
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: SENHA_PADRAO });

    const cookie: string[] = login.headers['set-cookie'];
    const refresh = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(201);

    const corpo: RespostaToken = refresh.body;
    expect(corpo.accessToken).toEqual(expect.any(String));
  });

  it('logout revoga a sessão: o refresh anterior deixa de valer', async () => {
    await criarOwner('owner@teste.local');
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: SENHA_PADRAO });
    const cookie: string[] = login.headers['set-cookie'];
    const { accessToken }: RespostaToken = login.body;

    await http()
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', cookie)
      .expect(201);

    await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  describe('sessões por dispositivo', () => {
    it('login emite o cookie device_id no path da API', async () => {
      await criarOwner('owner@teste.local');
      const login = await logar('owner@teste.local');
      const bruto = (login.headers['set-cookie'] as unknown as string[]).find(
        (c) => c.startsWith('device_id='),
      );
      expect(bruto).toContain('HttpOnly');
      expect(bruto).toContain('Path=/api/v1');
    });

    it('dois logins do mesmo dispositivo deixam uma sessão só', async () => {
      await criarOwner('owner@teste.local');
      const primeiro = await logar('owner@teste.local');
      const dispositivo = cookie(primeiro, 'device_id');

      const segundo = await logar('owner@teste.local', [dispositivo]);
      const { accessToken }: RespostaToken = segundo.body;

      const sessoes = await listarSessoes(accessToken);
      expect(sessoes).toHaveLength(1);
      expect(sessoes[0].current).toBe(true);
    });

    it('a sessão substituída morre: o refresh anterior deixa de valer', async () => {
      await criarOwner('owner@teste.local');
      const primeiro = await logar('owner@teste.local');
      const cookiesDoPrimeiro = primeiro.headers[
        'set-cookie'
      ] as unknown as string[];

      await logar('owner@teste.local', [cookie(primeiro, 'device_id')]);

      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookiesDoPrimeiro)
        .expect(401);
    });

    it('dispositivo diferente não derruba o primeiro — os dois aparecem', async () => {
      await criarOwner('owner@teste.local');
      await logar('owner@teste.local');
      // Sem repassar o device_id: é outro aparelho, e ganha o seu próprio.
      const outro = await logar('owner@teste.local');
      const { accessToken }: RespostaToken = outro.body;

      const sessoes = await listarSessoes(accessToken);
      expect(sessoes).toHaveLength(2);
      expect(sessoes.filter((s) => s.current)).toHaveLength(1);
    });

    it('sessão anterior ao cookie é adotada no refresh e colapsa no login seguinte', async () => {
      const owner = await criarOwner('owner@teste.local');
      const login = await logar('owner@teste.local');
      // Simula o legado: linha criada antes do device_id existir.
      await clientAdmin().session.updateMany({
        where: { userId: owner.id },
        data: { deviceId: null },
      });

      const refresh = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', login.headers['set-cookie'] as unknown as string[])
        .expect(201);

      const novoLogin = await logar('owner@teste.local', [
        cookie(refresh, 'device_id'),
      ]);
      const { accessToken }: RespostaToken = novoLogin.body;
      expect(await listarSessoes(accessToken)).toHaveLength(1);
    });
  });

  it('colaborador desativado não entra, com mensagem própria', async () => {
    // Fixture: owner + colaborador com active=false.
    const owner = await criarOwner('owner@teste.local');
    await clientAdmin().user.create({
      data: {
        email: 'inativo@teste.local',
        name: 'Colab Inativo',
        passwordHash: await argon2.hash(SENHA_PADRAO),
        acceptedAt: new Date(),
        ownerId: owner.id,
        active: false,
      },
    });

    const resposta = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'inativo@teste.local', password: SENHA_PADRAO })
      .expect(401);

    const corpo: RespostaErro = resposta.body;
    expect(corpo.message).toBe(
      'Seu acesso ao CRM foi desativado. Fale com o responsável pela conta.',
    );
  });
});
