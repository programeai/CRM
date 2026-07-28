import type { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
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

interface RespostaChave {
  id: string;
  nome: string;
  mascarada: string;
}

interface RespostaChaveEmitida {
  valor: string;
}

/**
 * Não há endpoint de criação avulsa nesta fase — chave nasce junto do canal de
 * captação (Fase 2). Aqui as chaves são semeadas direto pelo `clientAdmin()`.
 */
describe('Chaves de integração (e2e)', () => {
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

  async function semearChave(ownerId: string, nome = 'Site') {
    const valor = `crm_${randomBytes(32).toString('hex')}`;
    const chave = await clientAdmin().integrationKey.create({
      data: {
        ownerId,
        name: nome,
        keyHash: createHash('sha256').update(valor).digest('hex'),
        prefix: valor.slice(0, 12),
        scopes: ['lead:receber'],
      },
    });
    return { valor, chave };
  }

  describe('GET /integracoes/chaves', () => {
    it('lista as chaves mascaradas, sem hash nenhum no corpo', async () => {
      const owner = await criarOwner('a@teste.local');
      const { valor, chave } = await semearChave(owner.id);
      const token = await logar('a@teste.local');

      const resposta = await http()
        .get('/api/v1/integracoes/chaves')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const lista: RespostaChave[] = resposta.body;
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({
        id: chave.id,
        nome: 'Site',
        mascarada: `${chave.prefix}••••••••`,
      });
      const corpo = JSON.stringify(resposta.body);
      expect(corpo).not.toContain(valor);
      expect(corpo).not.toMatch(/keyHash/);
    });

    it('sem `integracao:gerenciar` a rota responde 403', async () => {
      const owner = await criarOwner('a@teste.local');
      const papel = await criarPapel(owner.id, ['cliente:ver']);
      await criarColaborador('colab@teste.local', owner.id, papel.id);
      const token = await logar('colab@teste.local');

      await http()
        .get('/api/v1/integracoes/chaves')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });

  describe('POST /integracoes/chaves/:id/rotacionar', () => {
    it('devolve o valor novo uma vez e invalida o anterior no banco', async () => {
      const owner = await criarOwner('a@teste.local');
      const { valor: valorAntigo, chave } = await semearChave(owner.id);
      const token = await logar('a@teste.local');

      const resposta = await http()
        .post(`/api/v1/integracoes/chaves/${chave.id}/rotacionar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const { valor: valorNovo }: RespostaChaveEmitida = resposta.body;
      expect(valorNovo).toMatch(/^crm_[0-9a-f]{64}$/);
      expect(valorNovo).not.toBe(valorAntigo);

      const atualizada = await clientAdmin().integrationKey.findUniqueOrThrow({
        where: { id: chave.id },
      });
      expect(atualizada.keyHash).toBe(
        createHash('sha256').update(valorNovo).digest('hex'),
      );
      expect(atualizada.keyHash).not.toBe(chave.keyHash);
    });

    it('a chave de outro owner responde 404, não 403', async () => {
      await criarOwner('a@teste.local');
      const b = await criarOwner('b@teste.local');
      const { chave } = await semearChave(b.id);
      const token = await logar('a@teste.local');

      await http()
        .post(`/api/v1/integracoes/chaves/${chave.id}/rotacionar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('DELETE /integracoes/chaves/:id', () => {
    it('revogar preenche revokedAt e a linha continua no banco', async () => {
      const owner = await criarOwner('a@teste.local');
      const { chave } = await semearChave(owner.id);
      const token = await logar('a@teste.local');

      await http()
        .delete(`/api/v1/integracoes/chaves/${chave.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const revogada = await clientAdmin().integrationKey.findUniqueOrThrow({
        where: { id: chave.id },
      });
      expect(revogada.revokedAt).not.toBeNull();
    });
  });
});
