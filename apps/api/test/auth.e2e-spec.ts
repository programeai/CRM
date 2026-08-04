import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { MailService } from '../src/mail/mail.service';
import { criarAppDeTeste } from './helpers/app';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import { criarOwner, SENHA_PADRAO } from './helpers/fixtures';
import { generate } from 'otplib';
import { NodeCryptoPlugin } from '@otplib/plugin-crypto-node';

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
interface RespostaSetup2fa {
  qrDataUrl: string;
  uri: string;
  segredoBase32: string;
}
interface RespostaCodigos {
  codigosDeRecuperacao: string[];
}
interface RespostaStatus2fa {
  disponivel: boolean;
  ativo: boolean;
  codigosRestantes: number;
}
interface RespostaDesafio2fa {
  twoFactorRequired: true;
  desafio: string;
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
      .expect(200);

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

  /**
   * Rota `@Public()` que responde `{ ok: true }` aconteça o que acontecer — a
   * resposta genérica é anti-enumeração. Ou seja: o HTTP não distingue "enviou"
   * de "descartou em silêncio", e foi exatamente assim que a conta de login
   * social ficou um beco sem saída sem ninguém perceber. O que estes testes
   * afirmam é a LINHA NO BANCO, único sinal observável do que de fato ocorreu.
   */
  describe('forgot-password', () => {
    const pedirRedefinicao = (email: string) =>
      http().post('/api/v1/auth/forgot-password').send({ email }).expect(201);

    const tokensDe = (userId: string) =>
      clientAdmin().passwordResetToken.findMany({ where: { userId } });

    it('conta de login social (sem senha escolhida) recebe token de redefinição', async () => {
      const social = await clientAdmin().user.create({
        data: {
          email: 'social@teste.local',
          name: 'Entrou pelo Google',
          // Como o `createWithOAuth` grava: hash aleatório, `passwordSetAt` nulo.
          passwordHash: await argon2.hash('aleatoria-que-ninguem-conhece'),
          passwordSetAt: null,
          acceptedAt: new Date(),
        },
      });

      await pedirRedefinicao('social@teste.local');

      expect(await tokensDe(social.id)).toHaveLength(1);
    });

    it('convite de colaborador ainda pendente NÃO recebe token', async () => {
      // Porta paralela ao link do convite: ativaria o acesso sem consumir o
      // convite, e o painel mostraria "PENDING" para sempre.
      const pendente = await clientAdmin().user.create({
        data: {
          email: 'pendente@teste.local',
          name: 'Convidada',
          passwordHash: null,
          acceptedAt: null,
        },
      });

      await pedirRedefinicao('pendente@teste.local');

      expect(await tokensDe(pendente.id)).toHaveLength(0);
    });

    it('e-mail sem conta não cria nada e responde igual', async () => {
      await pedirRedefinicao('ninguem@teste.local');
      expect(await clientAdmin().passwordResetToken.findMany()).toHaveLength(0);
    });

    /**
     * A conta OAuth ANTIGA — criada antes da senha aleatória, logo com
     * `passwordHash` nulo no banco. Nenhuma migration lhe dá um hash (argon2
     * não roda em SQL), então quem a destrava é a guarda por `acceptedAt`. Se
     * alguém reintroduzir `!user.passwordHash` ali, ela volta a ser um beco sem
     * saída e SÓ este teste percebe: as contas novas continuariam funcionando.
     *
     * Vai até o fim de propósito — pedir, redefinir e entrar com a senha nova —
     * porque é o percurso real de quem hoje está preso ao Google.
     */
    it('conta OAuth ANTIGA (passwordHash nulo) redefine a senha e passa a logar com ela', async () => {
      const enviados: string[] = [];
      const espiao = jest
        .spyOn(MailService.prototype, 'sendPasswordReset')
        .mockImplementation((_to, resetUrl) => {
          enviados.push(resetUrl);
          return Promise.resolve();
        });

      try {
        const legada = await clientAdmin().user.create({
          data: {
            email: 'legada@teste.local',
            name: 'OAuth de antes do PR',
            passwordHash: null,
            passwordSetAt: null,
            acceptedAt: new Date(),
          },
        });

        await pedirRedefinicao('legada@teste.local');
        expect(enviados).toHaveLength(1);

        const token = new URL(enviados[0]).searchParams.get('token');
        expect(token).toBeTruthy();

        const NOVA_SENHA = 'senha-escolhida-agora-123';
        await http()
          .post('/api/v1/auth/reset-password')
          .send({ token, password: NOVA_SENHA })
          .expect(201);

        await http()
          .post('/api/v1/auth/login')
          .send({ email: 'legada@teste.local', password: NOVA_SENHA })
          .expect(200);

        // A conta deixou de ser "só social": o hash existe e o carimbo também,
        // então o diálogo de encerramento volta a pedir senha em vez de e-mail.
        const depois = await clientAdmin().user.findUniqueOrThrow({
          where: { id: legada.id },
        });
        expect(depois.passwordHash).not.toBeNull();
        expect(depois.passwordSetAt).not.toBeNull();
      } finally {
        espiao.mockRestore();
      }
    });
  });

  describe('registro de acesso (Marco Civil art. 15)', () => {
    it('login bem-sucedido grava uma linha AccessRecord com kind=LOGIN e o ip preenchido', async () => {
      const owner = await criarOwner('owner@teste.local');
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'owner@teste.local', password: SENHA_PADRAO })
        .expect(200);

      const registros = await clientAdmin().accessRecord.findMany({
        where: { userId: owner.id },
      });
      expect(registros).toHaveLength(1);
      expect(registros[0].kind).toBe('LOGIN');
      expect(registros[0].ip).not.toBeNull();
    });

    it('login com senha errada grava zero linhas', async () => {
      const owner = await criarOwner('owner@teste.local');
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'owner@teste.local', password: 'errada' })
        .expect(401);

      const registros = await clientAdmin().accessRecord.findMany({
        where: { userId: owner.id },
      });
      expect(registros).toHaveLength(0);
    });

    it('refresh grava zero linhas — não é um acesso novo, é a mesma sessão', async () => {
      const owner = await criarOwner('owner@teste.local');
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'owner@teste.local', password: SENHA_PADRAO });
      const cookie: string[] = login.headers['set-cookie'];

      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(201);

      const registros = await clientAdmin().accessRecord.findMany({
        where: { userId: owner.id },
      });
      expect(registros).toHaveLength(1); // só o LOGIN, o refresh não soma
      expect(registros[0].kind).toBe('LOGIN');
    });

    it('logout grava uma linha kind=LOGOUT', async () => {
      const owner = await criarOwner('owner@teste.local');
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'owner@teste.local', password: SENHA_PADRAO });
      const { accessToken }: RespostaToken = login.body;
      const cookie: string[] = login.headers['set-cookie'];

      await http()
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', cookie)
        .expect(201);

      const registros = await clientAdmin().accessRecord.findMany({
        where: { userId: owner.id, kind: 'LOGOUT' },
      });
      expect(registros).toHaveLength(1);
    });
  });

  /*
    Segundo fator (TOTP). O ciclo inteiro por HTTP, com o código gerado no próprio
    teste pela MESMA biblioteca que a API usa para verificar: é isso que prova que
    o segredo entregue no QR é o segredo que o servidor guardou (cifrado) e
    consegue recuperar.

    `TOTP_ENCRYPTION_KEY` vem de `test/.env.test` — setar no spec chegaria tarde
    (o `ConfigModule.forRoot()` roda no import do AppModule).
  */
  describe('segundo fator (TOTP)', () => {
    const cryptoPlugin = new NodeCryptoPlugin();

    /**
     * Loga e devolve o access token. Sem `.expect(status)`: o `POST /auth/login`
     * responde 201 (default do Nest) hoje, e a fase do login em dois passos muda
     * isso para 200 — travar o número aqui faria este helper quebrar por uma
     * mudança que não é sobre ele.
     */
    const logar = async (email: string): Promise<string> => {
      const r = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: SENHA_PADRAO });
      const { accessToken } = r.body as RespostaToken;
      if (!accessToken) {
        throw new Error(`Login não devolveu accessToken (status ${r.status}).`);
      }
      return accessToken;
    };

    /** Liga o 2FA por HTTP e devolve o segredo e os códigos de recuperação. */
    const ligar2fa = async (token: string) => {
      const setup = await http()
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { segredoBase32 } = setup.body as RespostaSetup2fa;

      const codigo = await generate({
        secret: segredoBase32,
        crypto: cryptoPlugin,
      });
      const confirm = await http()
        .post('/api/v1/auth/2fa/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ codigo })
        .expect(200);
      return {
        segredoBase32,
        codigos: (confirm.body as RespostaCodigos).codigosDeRecuperacao,
      };
    };

    it('ciclo completo: setup → confirm → status ativo → desativar → inativo', async () => {
      await criarOwner('dono@teste.local');
      const token = await logar('dono@teste.local');

      // Antes de tudo: disponível na instância, mas inativo para a pessoa.
      const antes = await http()
        .get('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(antes.body as RespostaStatus2fa).toEqual({
        disponivel: true,
        ativo: false,
        codigosRestantes: 0,
      });

      const { codigos } = await ligar2fa(token);
      expect(codigos).toHaveLength(16);
      expect(new Set(codigos).size).toBe(16);

      const depois = await http()
        .get('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(depois.body as RespostaStatus2fa).toEqual({
        disponivel: true,
        ativo: true,
        codigosRestantes: 16,
      });

      await http()
        .delete('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: SENHA_PADRAO })
        .expect(204);

      const final = await http()
        .get('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((final.body as RespostaStatus2fa).ativo).toBe(false);
      expect(await clientAdmin().userTotp.count()).toBe(0);
      /*
        Os códigos vão junto — e NÃO por cascata: `UserTotpRecoveryCode`
        referencia `User`, não `UserTotp`. É o `apagar` do repositório que apaga
        os dois, para não deixar 16 credenciais de acesso completo à conta
        órfãs no banco. Este caso é o que trava isso.
      */
      expect(await clientAdmin().userTotpRecoveryCode.count()).toBe(0);
    });

    it('o segredo é guardado CIFRADO: a coluna não contém o base32 do QR', async () => {
      await criarOwner('dono@teste.local');
      const token = await logar('dono@teste.local');
      const { segredoBase32 } = await ligar2fa(token);

      const linha = await clientAdmin().userTotp.findFirstOrThrow();
      expect(linha.ciphertext).not.toContain(segredoBase32);
      // `lastUsedStep` é BIGINT e o `JSON.stringify` não o serializa: o replacer
      // converte para string só para a varredura pelo segredo.
      expect(
        JSON.stringify(linha, (_k, v: unknown) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      ).not.toContain(segredoBase32);
      // Formato do AES-256-GCM: IV de 12 bytes e tag de 16, em hex.
      expect(linha.iv).toMatch(/^[0-9a-f]{24}$/);
      expect(linha.tag).toMatch(/^[0-9a-f]{32}$/);
      expect(linha.keyVersion).toBe(1);
    });

    it('confirm com código ERRADO responde 422 em pt-BR e NÃO liga o 2FA', async () => {
      await criarOwner('dono@teste.local');
      const token = await logar('dono@teste.local');
      await http()
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const r = await http()
        .post('/api/v1/auth/2fa/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ codigo: '000000' })
        .expect(422);

      expect((r.body as RespostaErro).message).toBe(
        'Código inválido. Confira o app autenticador e tente de novo.',
      );
      const linha = await clientAdmin().userTotp.findFirstOrThrow();
      expect(linha.confirmedAt).toBeNull();
      expect(await clientAdmin().userTotpRecoveryCode.count()).toBe(0);
    });

    it('o mesmo código não é aceito duas vezes (replay, RFC 6238 §5.2)', async () => {
      await criarOwner('dono@teste.local');
      const token = await logar('dono@teste.local');
      const { segredoBase32 } = await ligar2fa(token);

      // O `confirm` já consumiu o passo atual; reusar o MESMO código para
      // reautenticar na desativação tem de falhar.
      const codigo = await generate({
        secret: segredoBase32,
        crypto: cryptoPlugin,
      });
      const r = await http()
        .delete('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${token}`)
        .send({ codigo })
        .expect(403);

      expect((r.body as RespostaErro).message).toBe(
        'Código inválido ou expirado.',
      );
      // O 2FA continua ligado: o "não" da reautenticação não desliga nada.
      expect(await clientAdmin().userTotp.count()).toBe(1);
    });

    /*
      403 e NUNCA 401: um 401 em rota autenticada dispara o refresh/logout do
      cliente HTTP, e uma senha errada no diálogo derrubaria a sessão em vez de
      mostrar a mensagem. Mesmo precedente do encerramento de conta.
    */
    it('desativar com senha ERRADA responde 403 (não 401) e mantém o 2FA', async () => {
      await criarOwner('dono@teste.local');
      const token = await logar('dono@teste.local');
      await ligar2fa(token);

      const r = await http()
        .delete('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'senha-errada' })
        .expect(403);

      expect((r.body as RespostaErro).message).toBe('Senha incorreta.');
      expect(await clientAdmin().userTotp.count()).toBe(1);
      // A sessão continua valendo — é o ponto do 403.
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('desativar SEM confirmação nenhuma responde 403', async () => {
      await criarOwner('dono@teste.local');
      const token = await logar('dono@teste.local');
      await ligar2fa(token);

      await http()
        .delete('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
      expect(await clientAdmin().userTotp.count()).toBe(1);
    });

    it('regenerar os códigos invalida os antigos, mantendo 16', async () => {
      await criarOwner('dono@teste.local');
      const token = await logar('dono@teste.local');
      const { codigos: antigos } = await ligar2fa(token);

      const r = await http()
        .post('/api/v1/auth/2fa/recovery-codes')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: SENHA_PADRAO })
        .expect(200);

      const novos = (r.body as RespostaCodigos).codigosDeRecuperacao;
      expect(novos).toHaveLength(16);
      // Nenhum código antigo sobrevive.
      expect(novos.filter((c) => antigos.includes(c))).toHaveLength(0);
      expect(await clientAdmin().userTotpRecoveryCode.count()).toBe(16);
    });

    it('o setup NÃO liga o 2FA sozinho — só o confirm liga', async () => {
      await criarOwner('dono@teste.local');
      const token = await logar('dono@teste.local');

      await http()
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const status = await http()
        .get('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      // Existe linha no banco, mas `confirmedAt` nulo: um QR que a pessoa não
      // conseguiu ler não pode trancar a conta dela.
      expect(await clientAdmin().userTotp.count()).toBe(1);
      expect((status.body as RespostaStatus2fa).ativo).toBe(false);
    });

    it('as rotas de 2FA exigem sessão', async () => {
      await http().get('/api/v1/auth/2fa').expect(401);
      await http().post('/api/v1/auth/2fa/setup').expect(401);
      await http()
        .post('/api/v1/auth/2fa/confirm')
        .send({ codigo: '123456' })
        .expect(401);
      await http().delete('/api/v1/auth/2fa').send({}).expect(401);
    });
  });

  /*
    Login em dois passos. O que estes casos protegem, em ordem de importância:

     1. **O login de quem NÃO tem 2FA não muda** — é o caminho de todo mundo.
     2. O primeiro passo não emite sessão nem cookie: senha correta sem o segundo
        fator não é acesso.
     3. O desafio é `tipo: 'mfa'` e nada mais serve no lugar dele — nem um access
        token válido do mesmo usuário.
     4. `AccessRecord` só ganha linha no SUCESSO, com kind `LOGIN_2FA`. A falha
        fica no log (`mfa.codigo_recusado` / `mfa.login_recusado`), nunca aqui: a
        tabela registra acesso, e a 19-A decidiu que ela só guarda sucesso.
  */
  describe('login em dois passos (2FA)', () => {
    const cryptoPlugin = new NodeCryptoPlugin();

    /** Cria o owner, liga o 2FA e devolve o segredo e os códigos. */
    const ownerCom2fa = async (email = 'dono@teste.local') => {
      const owner = await criarOwner(email);
      const primeiro = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: SENHA_PADRAO })
        .expect(200);
      const token = (primeiro.body as RespostaToken).accessToken;

      const setup = await http()
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const { segredoBase32 } = setup.body as RespostaSetup2fa;
      const confirm = await http()
        .post('/api/v1/auth/2fa/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({
          codigo: await generate({
            secret: segredoBase32,
            crypto: cryptoPlugin,
          }),
        })
        .expect(200);
      return {
        owner,
        email,
        segredoBase32,
        codigos: (confirm.body as RespostaCodigos).codigosDeRecuperacao,
        tokenDoPrimeiroLogin: token,
      };
    };

    /** Primeiro passo: senha. Devolve o corpo, seja sessão ou desafio. */
    const primeiroPasso = (email: string) =>
      http()
        .post('/api/v1/auth/login')
        .send({ email, password: SENHA_PADRAO })
        .expect(200);

    it('1) login SEM 2FA continua igual: accessToken + cookie de refresh', async () => {
      await criarOwner('sem2fa@teste.local');

      const r = await primeiroPasso('sem2fa@teste.local');

      expect((r.body as RespostaToken).accessToken).toBeDefined();
      expect(r.body).not.toHaveProperty('twoFactorRequired');
      expect(cookie(r, 'refresh_token')).toContain('refresh_token=');
    });

    it('2) login COM 2FA devolve o desafio, SEM accessToken e SEM cookie', async () => {
      const { email } = await ownerCom2fa();

      const r = await primeiroPasso(email);

      const corpo = r.body as RespostaDesafio2fa;
      expect(corpo.twoFactorRequired).toBe(true);
      expect(corpo.desafio).toEqual(expect.any(String));
      expect(r.body).not.toHaveProperty('accessToken');
      // Nenhum cookie de refresh: não há sessão ainda.
      const enviados = (r.headers['set-cookie'] ?? []) as unknown as string[];
      expect(enviados.some((c) => c.startsWith('refresh_token='))).toBe(false);
    });

    it('3) segundo passo com código correto: 200 + cookie, e AccessRecord LOGIN_2FA', async () => {
      const { owner, email, segredoBase32 } = await ownerCom2fa();
      const { body } = await primeiroPasso(email);
      const { desafio } = body as RespostaDesafio2fa;

      /*
        O `confirm` do cadastro já consumiu o passo atual (anti-replay), então o
        código do login tem de ser de OUTRO passo — aqui, o seguinte. É o mesmo
        que acontece na vida real: a pessoa espera o app virar o código.
      */
      const codigo = await generate({
        secret: segredoBase32,
        crypto: cryptoPlugin,
        epoch: (Math.floor(Date.now() / 1000 / 30) + 1) * 30,
      });

      const r = await http()
        .post('/api/v1/auth/login/2fa')
        .send({ desafio, codigo })
        .expect(200);

      expect((r.body as RespostaToken).accessToken).toBeDefined();
      expect(cookie(r, 'refresh_token')).toContain('refresh_token=');

      const registros = await clientAdmin().accessRecord.findMany({
        where: { userId: owner.id, kind: 'LOGIN_2FA' },
      });
      expect(registros).toHaveLength(1);
      expect(registros[0].ip).toBeTruthy();
    });

    it('4) código errado: 401 e NENHUMA linha nova em AccessRecord', async () => {
      const { owner, email } = await ownerCom2fa();
      const { body } = await primeiroPasso(email);
      const { desafio } = body as RespostaDesafio2fa;

      const antes = await clientAdmin().accessRecord.count({
        where: { userId: owner.id },
      });

      const r = await http()
        .post('/api/v1/auth/login/2fa')
        .send({ desafio, codigo: '000000' })
        .expect(401);

      expect((r.body as RespostaErro).message).toBe(
        'Código inválido ou expirado.',
      );
      // A falha NÃO entra na tabela de acesso — ela só guarda sucesso (19-A).
      expect(
        await clientAdmin().accessRecord.count({ where: { userId: owner.id } }),
      ).toBe(antes);
    });

    it('5) access token NÃO serve como desafio — o `tipo: mfa` fecha isso', async () => {
      const { email, segredoBase32, tokenDoPrimeiroLogin } =
        await ownerCom2fa();
      const codigo = await generate({
        secret: segredoBase32,
        crypto: cryptoPlugin,
        epoch: (Math.floor(Date.now() / 1000 / 30) + 1) * 30,
      });

      // Mesmo segredo de assinatura, mesmo `sub`, e ainda assim recusado.
      const r = await http()
        .post('/api/v1/auth/login/2fa')
        .send({ desafio: tokenDoPrimeiroLogin, codigo })
        .expect(401);
      expect((r.body as RespostaErro).message).toBe(
        'A confirmação expirou. Entre com e-mail e senha de novo.',
      );

      // …e o desafio de VERDADE, do mesmo usuário, funciona.
      const { body } = await primeiroPasso(email);
      await http()
        .post('/api/v1/auth/login/2fa')
        .send({ desafio: (body as RespostaDesafio2fa).desafio, codigo })
        .expect(200);
    });

    it('6) desafio de OUTRO usuário não abre a sessão deste', async () => {
      const a = await ownerCom2fa('a@teste.local');
      await ownerCom2fa('b@teste.local');

      const { body } = await primeiroPasso('b@teste.local');
      const desafioDeB = (body as RespostaDesafio2fa).desafio;

      // O código é o de A, o desafio é o de B: o par não fecha.
      const codigoDeA = await generate({
        secret: a.segredoBase32,
        crypto: cryptoPlugin,
        epoch: (Math.floor(Date.now() / 1000 / 30) + 1) * 30,
      });
      await http()
        .post('/api/v1/auth/login/2fa')
        .send({ desafio: desafioDeB, codigo: codigoDeA })
        .expect(401);
    });

    it('7) desafio malformado ou vazio: 401 com mensagem em pt-BR', async () => {
      const { email } = await ownerCom2fa();
      await primeiroPasso(email);

      const r = await http()
        .post('/api/v1/auth/login/2fa')
        .send({ desafio: 'nao-e-um-jwt-de-verdade', codigo: '123456' })
        .expect(401);
      expect((r.body as RespostaErro).message).toBe(
        'A confirmação expirou. Entre com e-mail e senha de novo.',
      );
    });

    it('8) código de RECUPERAÇÃO funciona uma vez; a segunda tentativa é 401', async () => {
      const { owner, email, codigos } = await ownerCom2fa();
      const codigo = codigos[0];

      const primeira = await primeiroPasso(email);
      await http()
        .post('/api/v1/auth/login/2fa')
        .send({
          desafio: (primeira.body as RespostaDesafio2fa).desafio,
          codigo,
        })
        .expect(200);

      // O contador de códigos caiu.
      expect(
        await clientAdmin().userTotpRecoveryCode.count({
          where: { userId: owner.id, usedAt: null },
        }),
      ).toBe(15);

      // O MESMO código, de novo: não passa (compare-and-swap no consumo).
      const segunda = await primeiroPasso(email);
      await http()
        .post('/api/v1/auth/login/2fa')
        .send({
          desafio: (segunda.body as RespostaDesafio2fa).desafio,
          codigo,
        })
        .expect(401);
    });

    it('9) GET /auth/me só responde DEPOIS do segundo passo', async () => {
      const { email, segredoBase32 } = await ownerCom2fa();
      const { body } = await primeiroPasso(email);
      const { desafio } = body as RespostaDesafio2fa;

      // O desafio não é access token: não abre rota autenticada.
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${desafio}`)
        .expect(401);

      const codigo = await generate({
        secret: segredoBase32,
        crypto: cryptoPlugin,
        epoch: (Math.floor(Date.now() / 1000 / 30) + 1) * 30,
      });
      const segundo = await http()
        .post('/api/v1/auth/login/2fa')
        .send({ desafio, codigo })
        .expect(200);

      const me = await http()
        .get('/api/v1/auth/me')
        .set(
          'Authorization',
          `Bearer ${(segundo.body as RespostaToken).accessToken}`,
        )
        .expect(200);
      expect((me.body as RespostaMe).email).toBe(email);
    });

    it('desligar o 2FA devolve o login a UM passo', async () => {
      const { email, tokenDoPrimeiroLogin } = await ownerCom2fa();

      await http()
        .delete('/api/v1/auth/2fa')
        .set('Authorization', `Bearer ${tokenDoPrimeiroLogin}`)
        .send({ password: SENHA_PADRAO })
        .expect(204);

      const r = await primeiroPasso(email);
      expect((r.body as RespostaToken).accessToken).toBeDefined();
      expect(r.body).not.toHaveProperty('twoFactorRequired');
    });
  });
});
