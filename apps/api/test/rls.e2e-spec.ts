import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
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
interface RespostaListaClientes {
  data: { id: string; name: string }[];
  meta: { total: number };
}

describe('Isolamento por ownerId (e2e)', () => {
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

  // -------------------------------------------------------------------------
  // Camada 1: a policy em si, sem passar pela API.
  // -------------------------------------------------------------------------
  describe('policy no banco', () => {
    it('toda tabela com ownerId tem RLS ligado, forçado e com policy', async () => {
      // Meta-teste: tabela nova com ownerId e sem policy quebra AQUI, não em
      // produção. `User` é a única exceção legítima — tem ownerId (vínculo do
      // colaborador) mas fica fora do RLS de propósito, porque o login precisa
      // buscar por e-mail antes de existir contexto de owner
      // (ver 20260724050000_enable_rls). Query validada contra o banco real:
      // sem o filtro de `User` ela acusa falso positivo no primeiro run.
      const desprotegidas = await clientAdmin().$queryRaw<{ nome: string }[]>`
        SELECT c.relname AS nome
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname <> 'User'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = 'public'
              AND col.table_name = c.relname
              AND col.column_name = 'ownerId'
          )
          AND (
            NOT c.relrowsecurity
            OR NOT c.relforcerowsecurity
            OR NOT EXISTS (
              SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname
            )
          )
      `;
      expect(desprotegidas).toEqual([]);
    });

    it('as 18 tabelas protegidas hoje continuam protegidas', async () => {
      // Contagem-âncora: pega remoção acidental de policy numa migration.
      // Subir este número junto com a migration que adiciona a tabela nova é
      // parte do trabalho — é o momento de perguntar se ela precisa de RLS.
      const [{ total }] = await clientAdmin().$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM pg_policies WHERE schemaname = 'public'
      `;
      expect(Number(total)).toBe(18);
    });

    it('crm_app sem app.owner_id definido não enxerga linha nenhuma (fail-closed)', async () => {
      const owner = await criarOwner('a@teste.local');
      await clientAdmin().client.create({
        data: { name: 'Cliente do A', ownerId: owner.id },
      });

      // Conexão como crm_app SEM setar o GUC — é o cenário de bug que a
      // policy precisa fechar sozinha.
      const app_ = new PrismaClient({
        datasources: { db: { url: process.env.APP_DATABASE_URL! } },
      });
      try {
        await expect(app_.client.findMany()).resolves.toEqual([]);
      } finally {
        await app_.$disconnect();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Camada 2: pela API, com dois owners de verdade.
  // -------------------------------------------------------------------------
  describe('owner não alcança dado de outro owner', () => {
    let clienteDoB: { id: string };

    beforeEach(async () => {
      const a = await criarOwner('a@teste.local');
      const b = await criarOwner('b@teste.local');
      await clientAdmin().client.create({
        data: { name: 'Cliente do A', ownerId: a.id },
      });
      clienteDoB = await clientAdmin().client.create({
        data: { name: 'Cliente do B', ownerId: b.id },
      });
    });

    it('a listagem devolve só os próprios clientes', async () => {
      const token = await logar('a@teste.local');
      // Shape do ENDPOINTS.md: `{ data: Client[], meta: { total, page, limit } }`.
      const resposta = await http()
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const corpo: RespostaListaClientes = resposta.body;
      expect(corpo.data.map((c) => c.name)).toEqual(['Cliente do A']);
      expect(corpo.meta.total).toBe(1);
    });

    it('ler cliente do outro owner responde 404, não 403', async () => {
      // 404 e não 403: com RLS a linha é INVISÍVEL, não proibida — e o 404 é o
      // que evita confirmar a existência do registro alheio.
      const token = await logar('a@teste.local');
      const resposta = await http()
        .get(`/api/v1/clients/${clienteDoB.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const corpo: RespostaErro = resposta.body;
      expect(corpo.message).toBe('Cliente não encontrado.');
    });

    it('editar cliente do outro owner responde 404 e não altera a linha', async () => {
      const token = await logar('a@teste.local');
      await http()
        .patch(`/api/v1/clients/${clienteDoB.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Invadido' })
        .expect(404);

      const depois = await clientAdmin().client.findUnique({
        where: { id: clienteDoB.id },
      });
      expect(depois?.name).toBe('Cliente do B');
    });

    it('arquivar cliente do outro owner responde 404 e não arquiva', async () => {
      // Arquivar é POST /:id/archive. O DELETE /:id é o EXPURGO — exige
      // `lixeira:expurgar` e que o registro já esteja arquivado, então não
      // serve para provar isolamento (o 404 poderia vir do 422/403).
      const token = await logar('a@teste.local');
      await http()
        .post(`/api/v1/clients/${clienteDoB.id}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const depois = await clientAdmin().client.findUnique({
        where: { id: clienteDoB.id },
      });
      expect(depois?.archivedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Camada 3: colaborador usa o ownerId do OWNER, não o dele.
  // -------------------------------------------------------------------------
  describe('colaborador enxerga os dados do owner que o convidou', () => {
    it('lista os clientes do owner, não os próprios', async () => {
      // Owner A + papel com `cliente:ver` (acessa a rota) e `cliente:ver_todos`
      // (senão a listagem cai no recorte por responsável, e o teste passaria
      // pelo motivo errado — ver nota da spec sobre resolveAssigneeScope).
      const a = await criarOwner('a@teste.local');
      const papel = await criarPapel(a.id, [
        'cliente:ver',
        'cliente:ver_todos',
      ]);
      await criarColaborador('colab@teste.local', a.id, papel.id);
      await clientAdmin().client.create({
        data: { name: 'Cliente do A', ownerId: a.id },
      });

      const token = await logar('colab@teste.local');
      const resposta = await http()
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const corpo: RespostaListaClientes = resposta.body;
      expect(corpo.data.map((c) => c.name)).toEqual(['Cliente do A']);
    });

    it('colaborador de A não alcança dado de B', async () => {
      const a = await criarOwner('a@teste.local');
      const b = await criarOwner('b@teste.local');
      const papel = await criarPapel(a.id, [
        'cliente:ver',
        'cliente:ver_todos',
      ]);
      await criarColaborador('colab@teste.local', a.id, papel.id);
      const clienteDoB = await clientAdmin().client.create({
        data: { name: 'Cliente do B', ownerId: b.id },
      });

      const token = await logar('colab@teste.local');
      await http()
        .get(`/api/v1/clients/${clienteDoB.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
