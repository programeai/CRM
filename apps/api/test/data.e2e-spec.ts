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

/**
 * Cobre o que o mock não cobre: o isolamento de verdade com RLS ligado. É o
 * teste que guarda o risco número um da fase — o recorte por responsável não
 * é protegido pelo banco. Molde: `test/rls.e2e-spec.ts`.
 */
describe('Dados — importação e exportação (e2e)', () => {
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

  describe('GET /clients/export', () => {
    it('não traz nenhuma linha do outro owner', async () => {
      const a = await criarOwner('a@teste.local');
      const b = await criarOwner('b@teste.local');
      await clientAdmin().client.create({
        data: { name: 'Cliente do A', ownerId: a.id },
      });
      await clientAdmin().client.create({
        data: { name: 'Cliente do B', ownerId: b.id },
      });

      const token = await logar('a@teste.local');
      const resposta = await http()
        .get('/api/v1/clients/export?formato=csv')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const texto = resposta.text;
      expect(texto).toContain('Cliente do A');
      expect(texto).not.toContain('Cliente do B');
    });

    it('colaborador sem cliente:ver_todos não exporta clientes de outro responsável', async () => {
      const a = await criarOwner('a@teste.local');
      const papel = await criarPapel(a.id, ['cliente:ver']); // sem ver_todos
      const colab = await criarColaborador('colab@teste.local', a.id, papel.id);
      await clientAdmin().client.create({
        data: {
          name: 'Cliente do colaborador',
          ownerId: a.id,
          assigneeId: colab.id,
        },
      });
      await clientAdmin().client.create({
        data: { name: 'Cliente de outro responsável', ownerId: a.id },
      });
      const outroUser = await criarOwner('outro@teste.local');
      await clientAdmin().client.update({
        where: {
          id: (
            await clientAdmin().client.findFirstOrThrow({
              where: { name: 'Cliente de outro responsável' },
            })
          ).id,
        },
        data: { assigneeId: outroUser.id },
      });

      const token = await logar('colab@teste.local');
      const resposta = await http()
        .get('/api/v1/clients/export?formato=csv')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const texto = resposta.text;
      expect(texto).toContain('Cliente do colaborador');
      expect(texto).not.toContain('Cliente de outro responsável');
    });
  });

  describe('POST /data/import', () => {
    it('grava com o ownerId de quem chamou', async () => {
      const a = await criarOwner('a@teste.local');
      await criarOwner('b@teste.local'); // só para provar que não vaza para cá
      const token = await logar('a@teste.local');

      const csv = 'Nome;CNPJ\r\nAcme Importada;11222333000181\r\n';
      const resposta = await http()
        .post('/api/v1/data/import')
        .set('Authorization', `Bearer ${token}`)
        .field('tipo', 'clientes')
        .field('mapeamento', JSON.stringify({ Nome: 'name', CNPJ: 'document' }))
        .attach('arquivo', Buffer.from(csv, 'utf8'), 'clientes.csv')
        .expect(201);

      expect(resposta.body).toMatchObject({ criados: 1 });
      const gravado = await clientAdmin().client.findFirstOrThrow({
        where: { name: 'Acme Importada' },
      });
      expect(gravado.ownerId).toBe(a.id);
    });

    it('501 linhas → 422, e a contagem de clientes não muda', async () => {
      await criarOwner('a@teste.local');
      const token = await logar('a@teste.local');

      const linhas = Array.from({ length: 501 }, (_, i) => `Cliente ${i}`);
      const csv = 'Nome\r\n' + linhas.join('\r\n') + '\r\n';

      await http()
        .post('/api/v1/data/import')
        .set('Authorization', `Bearer ${token}`)
        .field('tipo', 'clientes')
        .field('mapeamento', JSON.stringify({ Nome: 'name' }))
        .attach('arquivo', Buffer.from(csv, 'utf8'), 'clientes.csv')
        .expect(422);

      const total = await clientAdmin().client.count();
      expect(total).toBe(0);
    });

    it('uma linha com erro cancela tudo — nenhum cliente é gravado', async () => {
      await criarOwner('a@teste.local');
      const token = await logar('a@teste.local');

      const csv = 'Nome;CNPJ\r\nAcme;123\r\nBeta;\r\n'; // CNPJ inválido na linha 2
      await http()
        .post('/api/v1/data/import')
        .set('Authorization', `Bearer ${token}`)
        .field('tipo', 'clientes')
        .field('mapeamento', JSON.stringify({ Nome: 'name', CNPJ: 'document' }))
        .attach('arquivo', Buffer.from(csv, 'utf8'), 'clientes.csv')
        .expect(422);

      const total = await clientAdmin().client.count();
      expect(total).toBe(0);
    });

    it('colaborador sem dados:importar recebe 403', async () => {
      const a = await criarOwner('a@teste.local');
      const papel = await criarPapel(a.id, ['cliente:ver']); // sem dados:importar
      await criarColaborador('colab@teste.local', a.id, papel.id);
      const token = await logar('colab@teste.local');

      const csv = 'Nome\r\nAcme\r\n';
      await http()
        .post('/api/v1/data/import')
        .set('Authorization', `Bearer ${token}`)
        .field('tipo', 'clientes')
        .field('mapeamento', JSON.stringify({ Nome: 'name' }))
        .attach('arquivo', Buffer.from(csv, 'utf8'), 'clientes.csv')
        .expect(403);
    });
  });
});
