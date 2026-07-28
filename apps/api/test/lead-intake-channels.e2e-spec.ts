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

interface RespostaCanalCriado {
  chave: string;
  canal: {
    id: string;
    name: string;
    assignee: { id: string; name: string } | null;
    source: { id: string; name: string; active: boolean } | null;
    chave: { id: string; mascarada: string } | null;
  };
}

/** O valor bruto da chave tem esta cara — e não pode aparecer em GET nenhum. */
const VALOR_BRUTO = /crm_[0-9a-f]{64}/;

describe('Canais de captação de lead (e2e)', () => {
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

  async function criarCanal(
    token: string,
    corpo: Record<string, unknown> = { name: 'Site' },
  ) {
    const resposta = await http()
      .post('/api/v1/leads/canais')
      .set('Authorization', `Bearer ${token}`)
      .send(corpo)
      .expect(201);
    return resposta.body as RespostaCanalCriado;
  }

  it('cria canal com chave e devolve o valor UMA vez', async () => {
    await criarOwner('a@teste.local');
    const token = await logar('a@teste.local');

    const criado = await criarCanal(token);

    expect(criado.chave).toMatch(VALOR_BRUTO);
    expect(criado.canal.name).toBe('Site');
    expect(criado.canal.chave?.mascarada).toMatch(/^crm_[0-9a-f]{8}•{8}$/);
    // A chave nasceu com o escopo da ingestão, e só com ele.
    const chave = await clientAdmin().integrationKey.findFirstOrThrow();
    expect(chave.scopes).toEqual(['lead:receber']);
  });

  it('a listagem devolve a chave mascarada e nunca o valor', async () => {
    await criarOwner('a@teste.local');
    const token = await logar('a@teste.local');
    const criado = await criarCanal(token);

    const resposta = await http()
      .get('/api/v1/leads/canais')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const corpo = JSON.stringify(resposta.body);
    expect(corpo).not.toContain(criado.chave);
    expect(corpo).not.toMatch(VALOR_BRUTO);
    expect(corpo).not.toMatch(/keyHash/);
    expect(corpo).toContain('•');
  });

  it('grava o responsável e a fonte de lead escolhidos', async () => {
    const owner = await criarOwner('a@teste.local');
    const papel = await criarPapel(owner.id, ['cliente:ver']);
    const colab = await criarColaborador(
      'colab@teste.local',
      owner.id,
      papel.id,
    );
    const fonte = await clientAdmin().leadSourceCatalog.create({
      data: { ownerId: owner.id, name: 'Tráfego pago' },
    });
    const token = await logar('a@teste.local');

    const criado = await criarCanal(token, {
      name: 'Landing',
      assigneeId: colab.id,
      sourceId: fonte.id,
    });

    expect(criado.canal.assignee).toEqual({ id: colab.id, name: colab.name });
    expect(criado.canal.source).toEqual({
      id: fonte.id,
      name: 'Tráfego pago',
      active: true,
    });
  });

  it('recusa responsável de outra workspace com 422', async () => {
    await criarOwner('a@teste.local');
    const b = await criarOwner('b@teste.local');
    const papelDeB = await criarPapel(b.id, ['cliente:ver']);
    const colabDeB = await criarColaborador(
      'colab-b@teste.local',
      b.id,
      papelDeB.id,
    );
    const token = await logar('a@teste.local');

    await http()
      .post('/api/v1/leads/canais')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Site', assigneeId: colabDeB.id })
      .expect(422);

    expect(await clientAdmin().leadIntakeChannel.count()).toBe(0);
    // A chave também não sobrou: a validação roda antes da emissão.
    expect(await clientAdmin().integrationKey.count()).toBe(0);
  });

  it('recusa fonte de lead de outro owner com 404', async () => {
    await criarOwner('a@teste.local');
    const b = await criarOwner('b@teste.local');
    const fonteDeB = await clientAdmin().leadSourceCatalog.create({
      data: { ownerId: b.id, name: 'Indicação do B' },
    });
    const token = await logar('a@teste.local');

    await http()
      .post('/api/v1/leads/canais')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Site', sourceId: fonteDeB.id })
      .expect(404);

    expect(await clientAdmin().integrationKey.count()).toBe(0);
  });

  it('recusa nome repetido no mesmo owner com 409', async () => {
    await criarOwner('a@teste.local');
    const token = await logar('a@teste.local');
    await criarCanal(token, { name: 'Site' });

    await http()
      .post('/api/v1/leads/canais')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Site' })
      .expect(409);

    expect(await clientAdmin().leadIntakeChannel.count()).toBe(1);
  });

  it('editar troca responsável e fonte sem emitir chave nova', async () => {
    const owner = await criarOwner('a@teste.local');
    const papel = await criarPapel(owner.id, ['cliente:ver']);
    const colab = await criarColaborador(
      'colab@teste.local',
      owner.id,
      papel.id,
    );
    const token = await logar('a@teste.local');
    const criado = await criarCanal(token);

    await http()
      .patch(`/api/v1/leads/canais/${criado.canal.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigneeId: colab.id })
      .expect(200);

    const canal = await clientAdmin().leadIntakeChannel.findFirstOrThrow();
    expect(canal.assigneeId).toBe(colab.id);
    // A MESMA chave continua valendo: editar canal não rotaciona credencial.
    expect(canal.keyId).toBe(criado.canal.chave?.id);
    expect(await clientAdmin().integrationKey.count()).toBe(1);
  });

  it('apagar o canal apaga a chave: a credencial deixa de autenticar', async () => {
    await criarOwner('a@teste.local');
    const token = await logar('a@teste.local');
    const criado = await criarCanal(token);

    await http()
      .delete(`/api/v1/leads/canais/${criado.canal.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(await clientAdmin().leadIntakeChannel.count()).toBe(0);
    expect(await clientAdmin().integrationKey.count()).toBe(0);

    await http()
      .post('/api/v1/leads/intake')
      .set('Authorization', `Bearer ${criado.chave}`)
      .send({
        nome: 'Ana Ribeiro',
        whatsapp: '84999398021',
        origem: 'site-institucional',
      })
      .expect(401);
  });

  it('o canal de outro owner responde 404, não 403', async () => {
    await criarOwner('a@teste.local');
    const b = await criarOwner('b@teste.local');
    const tokenDeB = await logar('b@teste.local');
    const canalDeB = await criarCanal(tokenDeB, { name: 'Site do B' });
    const tokenDeA = await logar('a@teste.local');

    await http()
      .patch(`/api/v1/leads/canais/${canalDeB.canal.id}`)
      .set('Authorization', `Bearer ${tokenDeA}`)
      .send({ name: 'Sequestrado' })
      .expect(404);

    expect(b.id).toBeTruthy();
  });

  it('sem `integracao:gerenciar` responde 403', async () => {
    const owner = await criarOwner('a@teste.local');
    const papel = await criarPapel(owner.id, ['cliente:ver']);
    await criarColaborador('colab@teste.local', owner.id, papel.id);
    const token = await logar('colab@teste.local');

    await http()
      .get('/api/v1/leads/canais')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await http()
      .post('/api/v1/leads/canais')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Site' })
      .expect(403);
  });
});
