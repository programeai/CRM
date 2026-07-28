import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { criarAppDeTeste } from './helpers/app';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import { criarColaborador, criarOwner, SENHA_PADRAO } from './helpers/fixtures';
import { AccountPurgeJob } from '../src/modules/account/application/account-purge.job';

interface RespostaToken {
  accessToken: string;
}

/**
 * Semeia uma workspace completa: as 10 tabelas de negócio + catálogos + canal
 * de captação com chave + colaborador + notificações + trilha de auditoria.
 * É o cenário que fecha o risco descrito no spec: a ordem de FK só é provada
 * por um e2e com dado de verdade, e é aqui que a colisão
 * `LeadIntakeChannel.sourceId` apareceria se a ordem estivesse errada.
 */
async function semearWorkspaceCompleta(email: string) {
  const db = clientAdmin();
  const owner = await criarOwner(email);
  const papel = await db.role.create({
    data: { ownerId: owner.id, name: 'Administrador', system: true },
  });
  const colaborador = await criarColaborador(
    `colab-${email}`,
    owner.id,
    papel.id,
  );

  const estagio = await db.pipelineStage.create({
    data: { ownerId: owner.id, name: 'Novo', order: 1 },
  });
  const fonte = await db.leadSourceCatalog.create({
    data: { ownerId: owner.id, name: 'Indicação' },
  });
  const tipoDeServico = await db.serviceCatalog.create({
    data: { ownerId: owner.id, name: 'Consultoria' },
  });
  const tipoDeAtividade = await db.activityTypeCatalog.create({
    data: { ownerId: owner.id, name: 'Ligação' },
  });
  const motivoDePerda = await db.lostReasonCatalog.create({
    data: { ownerId: owner.id, name: 'Preço' },
  });

  const chave = await db.integrationKey.create({
    data: {
      ownerId: owner.id,
      name: 'Site',
      keyHash: `hash-${email}`,
      prefix: 'crm_aabbccdd',
      scopes: ['lead:receber'],
    },
  });
  await db.leadIntakeChannel.create({
    data: {
      ownerId: owner.id,
      name: 'Site institucional',
      sourceId: fonte.id,
      keyId: chave.id,
    },
  });

  const cliente = await db.client.create({
    data: {
      ownerId: owner.id,
      name: `Cliente de ${email}`,
      sourceId: fonte.id,
    },
  });
  await db.contact.create({
    data: { ownerId: owner.id, clientId: cliente.id, name: 'Contato' },
  });
  const deal = await db.deal.create({
    data: {
      ownerId: owner.id,
      clientId: cliente.id,
      stageId: estagio.id,
      title: 'Negócio',
      serviceTypeId: tipoDeServico.id,
      lostReasonId: motivoDePerda.id,
      position: 1,
    },
  });
  const proposta = await db.proposal.create({
    data: {
      ownerId: owner.id,
      number: `PROP-${email}`,
      clientId: cliente.id,
      dealId: deal.id,
      serviceTypeId: tipoDeServico.id,
      total: 1000,
    },
  });
  await db.proposalItem.create({
    data: {
      ownerId: owner.id,
      proposalId: proposta.id,
      description: 'Item',
      unitPrice: 1000,
      order: 1,
    },
  });
  const projeto = await db.project.create({
    data: {
      ownerId: owner.id,
      clientId: cliente.id,
      dealId: deal.id,
      name: 'Projeto',
      serviceTypeId: tipoDeServico.id,
    },
  });
  await db.task.create({
    data: {
      ownerId: owner.id,
      projectId: projeto.id,
      title: 'Tarefa',
      position: 1,
    },
  });
  const contrato = await db.contract.create({
    data: {
      ownerId: owner.id,
      clientId: cliente.id,
      projectId: projeto.id,
      description: 'Contrato',
      billingType: 'ONE_TIME',
    },
  });
  await db.payment.create({
    data: {
      ownerId: owner.id,
      contractId: contrato.id,
      description: 'Cobrança',
      amount: 1000,
      dueDate: new Date(),
    },
  });
  await db.activity.create({
    data: {
      ownerId: owner.id,
      clientId: cliente.id,
      typeId: tipoDeAtividade.id,
      content: 'Nota',
    },
  });

  const target = await db.userNotificationTarget.create({
    data: {
      ownerId: owner.id,
      userId: owner.id,
      kind: 'IN_APP',
      label: 'App',
      config: {},
    },
  });
  const notificacao = await db.notification.create({
    data: {
      ownerId: owner.id,
      userId: owner.id,
      type: 'RECORD_ASSIGNED',
      entity: 'CLIENT',
      entityId: cliente.id,
      title: 'Título',
      body: 'Corpo',
    },
  });
  await db.notificationDelivery.create({
    data: {
      ownerId: owner.id,
      notificationId: notificacao.id,
      userId: owner.id,
      targetId: target.id,
      kind: 'IN_APP',
    },
  });

  await db.auditLog.create({
    data: {
      ownerId: owner.id,
      actorType: 'USER',
      actorId: owner.id,
      actorName: owner.name,
      entity: 'CLIENT',
      entityId: cliente.id,
      entityLabel: cliente.name,
      action: 'CRIAR',
      diff: { nome: { antes: null, depois: cliente.name } },
    },
  });

  return { owner, colaborador };
}

async function contagemPorTabela(ownerId: string) {
  const db = clientAdmin();
  return {
    clientes: await db.client.count({ where: { ownerId } }),
    contatos: await db.contact.count({ where: { ownerId } }),
    oportunidades: await db.deal.count({ where: { ownerId } }),
    propostas: await db.proposal.count({ where: { ownerId } }),
    itensDeProposta: await db.proposalItem.count({ where: { ownerId } }),
    projetos: await db.project.count({ where: { ownerId } }),
    demandas: await db.task.count({ where: { ownerId } }),
    contratos: await db.contract.count({ where: { ownerId } }),
    cobrancas: await db.payment.count({ where: { ownerId } }),
    atividades: await db.activity.count({ where: { ownerId } }),
    fontesDeLead: await db.leadSourceCatalog.count({ where: { ownerId } }),
    tiposDeServico: await db.serviceCatalog.count({ where: { ownerId } }),
    tiposDeAtividade: await db.activityTypeCatalog.count({
      where: { ownerId },
    }),
    motivosDePerda: await db.lostReasonCatalog.count({ where: { ownerId } }),
    estagios: await db.pipelineStage.count({ where: { ownerId } }),
    canaisDeCaptacao: await db.leadIntakeChannel.count({ where: { ownerId } }),
    chavesDeIntegracao: await db.integrationKey.count({ where: { ownerId } }),
    trilha: await db.auditLog.count({ where: { ownerId } }),
    sessoes: await db.session.count({
      where: { user: { OR: [{ id: ownerId }, { ownerId }] } },
    }),
    assinaturas: await db.subscription.count({ where: { ownerId } }),
    papeis: await db.role.count({ where: { ownerId } }),
    notificacoes: await db.notification.count({ where: { ownerId } }),
    destinos: await db.userNotificationTarget.count({ where: { ownerId } }),
    usuarios: await db.user.count({
      where: { OR: [{ id: ownerId }, { ownerId }] },
    }),
  };
}

describe('AccountPurgeJob (e2e)', () => {
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

  it('expurga a workspace de A, preserva B intacto, e deixa uma única linha de trilha sem PII', async () => {
    const { owner: a } = await semearWorkspaceCompleta('a@teste.local');
    const { owner: b } = await semearWorkspaceCompleta('b@teste.local');

    const antesDeB = await contagemPorTabela(b.id);

    // Login de A ANTES do expurgo, para provar o 401 depois.
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'a@teste.local', password: SENHA_PADRAO });
    const { accessToken }: RespostaToken = login.body;

    await clientAdmin().user.update({
      where: { id: a.id },
      data: {
        deletionRequestedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        deletionScheduledFor: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });

    const job = app.get(AccountPurgeJob);
    await job.run();

    const depoisDeA = await contagemPorTabela(a.id);
    expect(depoisDeA).toEqual({
      clientes: 0,
      contatos: 0,
      oportunidades: 0,
      propostas: 0,
      itensDeProposta: 0,
      projetos: 0,
      demandas: 0,
      contratos: 0,
      cobrancas: 0,
      atividades: 0,
      fontesDeLead: 0,
      tiposDeServico: 0,
      tiposDeAtividade: 0,
      motivosDePerda: 0,
      estagios: 0,
      canaisDeCaptacao: 0,
      chavesDeIntegracao: 0,
      trilha: 1, // só a linha do próprio expurgo
      sessoes: 0,
      assinaturas: 0,
      papeis: 0,
      notificacoes: 0,
      destinos: 0,
      usuarios: 0, // owner + colaborador, ambos apagados
    });

    const depoisDeB = await contagemPorTabela(b.id);
    expect(depoisDeB).toEqual(antesDeB);

    const trilhaDeA = await clientAdmin().auditLog.findMany({
      where: { ownerId: a.id },
    });
    expect(trilhaDeA).toHaveLength(1);
    expect(trilhaDeA[0].entity).toBe('ACCOUNT');
    expect(trilhaDeA[0].action).toBe('EXPURGAR');
    expect(trilhaDeA[0].actorType).toBe('CRON');
    expect(JSON.stringify(trilhaDeA[0].diff)).not.toContain('@');

    // A amarração entre as Fases 3 e 4: o registro de acesso (Marco Civil
    // art. 15) sobrevive ao expurgo — é o único dado do owner, além da própria
    // trilha do expurgo, que continua no banco.
    const registrosDeAcesso = await clientAdmin().accessRecord.findMany({
      where: { userId: a.id },
    });
    expect(registrosDeAcesso.length).toBeGreaterThan(0);

    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('owner com carência não vencida não é tocado', async () => {
    const { owner: a } = await semearWorkspaceCompleta('a@teste.local');
    await clientAdmin().user.update({
      where: { id: a.id },
      data: {
        deletionRequestedAt: new Date(),
        deletionScheduledFor: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      },
    });

    const job = app.get(AccountPurgeJob);
    await job.run();

    const depois = await contagemPorTabela(a.id);
    expect(depois.clientes).toBe(1);
    expect(depois.usuarios).toBe(2);
  });
});
