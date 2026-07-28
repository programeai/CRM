import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { criarAppDeTeste } from './helpers/app';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import {
  criarColaborador,
  criarOwner,
  criarPapel,
  SENHA_PADRAO,
} from './helpers/fixtures';

interface RespostaToken {
  accessToken: string;
}
interface RespostaErro {
  message: string;
}
interface DumpDeConta {
  manifesto: { contagem: Record<string, number> };
  clientes: { id: string; name: string }[];
}
interface RespostaEncerramento {
  requestedAt: string;
  scheduledFor: string;
}
interface RespostaMe {
  email: string;
  deletion: { requestedAt: string; scheduledFor: string } | null;
}

describe('Conta — exportação (e2e)', () => {
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

  async function logar(email: string): Promise<string> {
    const resposta = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA_PADRAO });
    const { accessToken }: RespostaToken = resposta.body;
    return accessToken;
  }

  it('o dump de A não contém nenhuma linha de B', async () => {
    const a = await criarOwner('a@teste.local');
    const b = await criarOwner('b@teste.local');
    await clientAdmin().client.create({
      data: { name: 'Cliente do A', ownerId: a.id },
    });
    await clientAdmin().client.create({
      data: {
        name: 'Cliente do B',
        ownerId: b.id,
        email: 'b-secreto@teste.local',
      },
    });

    const token = await logar('a@teste.local');
    const resposta = await http()
      .get('/api/v1/account/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const corpo: DumpDeConta = resposta.body;
    expect(corpo.clientes.map((c) => c.name)).toEqual(['Cliente do A']);
    expect(JSON.stringify(corpo)).not.toContain('Cliente do B');
    expect(JSON.stringify(corpo)).not.toContain('b-secreto@teste.local');
    expect(corpo.manifesto.contagem.clientes).toBe(1);
  });

  it('colaborador recebe 403', async () => {
    const a = await criarOwner('a@teste.local');
    const papel = await criarPapel(a.id, []);
    await criarColaborador('colab@teste.local', a.id, papel.id);

    const token = await logar('colab@teste.local');
    const resposta = await http()
      .get('/api/v1/account/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const corpo: RespostaErro = resposta.body;
    expect(corpo.message).toBe('Esta ação é exclusiva do dono da conta.');
  });

  it('owner com assinatura cancelada ainda recebe 200 (isento do gate de assinatura)', async () => {
    const a = await criarOwner('a@teste.local');
    await clientAdmin().subscription.create({
      data: { ownerId: a.id, status: 'CANCELED' },
    });

    const token = await logar('a@teste.local');
    await http()
      .get('/api/v1/account/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});

describe('Conta — encerramento (e2e)', () => {
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

  async function logar(email: string): Promise<string> {
    const resposta = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA_PADRAO });
    const { accessToken }: RespostaToken = resposta.body;
    return accessToken;
  }

  it('senha certa agenda hoje + 30 dias e reflete no banco', async () => {
    const a = await criarOwner('a@teste.local');
    const token = await logar('a@teste.local');

    const resposta = await http()
      .post('/api/v1/account/deletion')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: SENHA_PADRAO })
      .expect(201);

    const corpo: RespostaEncerramento = resposta.body;
    const dias =
      (new Date(corpo.scheduledFor).getTime() -
        new Date(corpo.requestedAt).getTime()) /
      (24 * 60 * 60 * 1000);
    expect(dias).toBeCloseTo(30, 5);

    const noBanco = await clientAdmin().user.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(noBanco.deletionRequestedAt).not.toBeNull();
    expect(noBanco.deletionScheduledFor).not.toBeNull();
  });

  it('a carência não bloqueia o uso do CRM', async () => {
    await criarOwner('a@teste.local');
    const token = await logar('a@teste.local');
    await http()
      .post('/api/v1/account/deletion')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: SENHA_PADRAO })
      .expect(201);

    await http()
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('GET /auth/me do colaborador traz o agendamento do owner', async () => {
    const a = await criarOwner('a@teste.local');
    const papel = await criarPapel(a.id, []);
    await criarColaborador('colab@teste.local', a.id, papel.id);
    const tokenDoOwner = await logar('a@teste.local');
    await http()
      .post('/api/v1/account/deletion')
      .set('Authorization', `Bearer ${tokenDoOwner}`)
      .send({ password: SENHA_PADRAO })
      .expect(201);

    const tokenDoColaborador = await logar('colab@teste.local');
    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenDoColaborador}`)
      .expect(200);

    const corpo: RespostaMe = me.body;
    expect(corpo.deletion).not.toBeNull();
  });

  it('DELETE /account/deletion zera os dois campos e o me volta a null', async () => {
    await criarOwner('a@teste.local');
    const token = await logar('a@teste.local');
    await http()
      .post('/api/v1/account/deletion')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: SENHA_PADRAO })
      .expect(201);

    await http()
      .delete('/api/v1/account/deletion')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const corpo: RespostaMe = me.body;
    expect(corpo.deletion).toBeNull();
  });

  it('colaborador chamando POST /account/deletion recebe 403 e nada muda no banco', async () => {
    const a = await criarOwner('a@teste.local');
    const papel = await criarPapel(a.id, []);
    await criarColaborador('colab@teste.local', a.id, papel.id);
    const token = await logar('colab@teste.local');

    await http()
      .post('/api/v1/account/deletion')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: SENHA_PADRAO })
      .expect(403);

    const noBanco = await clientAdmin().user.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(noBanco.deletionScheduledFor).toBeNull();
  });

  it('senha errada recebe 403', async () => {
    await criarOwner('a@teste.local');
    const token = await logar('a@teste.local');
    const resposta = await http()
      .post('/api/v1/account/deletion')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'errada' })
      .expect(403);
    const corpo: RespostaErro = resposta.body;
    expect(corpo.message).toBe('Senha incorreta.');
  });
});
