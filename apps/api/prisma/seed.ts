import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { defaultPipelineStages } from '../src/shared/default-pipeline-stages';
import {
  defaultActivityTypeCatalog,
  defaultLeadSourceCatalog,
  defaultLostReasonCatalog,
  defaultServiceCatalog,
} from '../src/shared/default-catalogs';

const prisma = new PrismaClient();

/**
 * Seed de demonstração do ProgrameAi CRM.
 *
 * Cria dois usuários (admin/demo), os estágios do pipeline e um dataset
 * realista de uma agência — clientes, contatos, oportunidades, propostas,
 * projetos/demandas, contratos, cobranças e atividades — todo vinculado ao
 * owner `admin@crm.local`. O objetivo é povoar todas as telas (dashboard,
 * pipeline, clientes, propostas, demandas e financeiro) com dados bonitos
 * para prints do README e da landing page.
 *
 * As datas são calculadas em UTC e relativas a "hoje" (mesma convenção das
 * janelas do dashboard e do módulo finance), então o dashboard e o financeiro
 * ficam "vivos" a cada execução. O seed é idempotente: apaga os dados de
 * negócio do owner demo antes de recriar.
 */

// ---------------------------------------------------------------------------
// Helpers de data (UTC, relativas a hoje)
// ---------------------------------------------------------------------------
const now = new Date();
const Y = now.getUTCFullYear();
const M = now.getUTCMonth();
const D = now.getUTCDate();

/** Data em UTC deslocada por `days` a partir de hoje (00:00 UTC). */
const day = (days: number): Date => new Date(Date.UTC(Y, M, D + days));
/** Dia `d` do mês atual + `monthOffset` meses (00:00 UTC). */
const monthDay = (monthOffset: number, d: number): Date =>
  new Date(Date.UTC(Y, M + monthOffset, d));

const dec = (v: number) => new Prisma.Decimal(v);

async function main() {
  const passwordHash = await argon2.hash('changeme123');

  // --- usuários ---------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: 'admin@crm.local' },
    update: {},
    create: {
      email: 'admin@crm.local',
      name: 'Edson Alencar',
      passwordHash,
      acceptedAt: now,
    },
  });
  // Segundo usuário: permite testar isolamento por ownerId (Fase 3 do RLS).
  const demo = await prisma.user.upsert({
    where: { email: 'demo@crm.local' },
    update: {},
    create: {
      email: 'demo@crm.local',
      name: 'Demo',
      passwordHash,
      acceptedAt: now,
    },
  });

  const ownerId = admin.id;

  // --- papel do sistema por owner ---------------------------------------
  // "Administrador" nasce com a conta e vale o catálogo inteiro (resolvido em
  // tempo de execução pelo AccessService), por isso `permissions` fica vazio.
  for (const owner of [admin, demo]) {
    await prisma.role.upsert({
      where: { ownerId_name: { ownerId: owner.id, name: 'Administrador' } },
      update: {},
      create: {
        ownerId: owner.id,
        name: 'Administrador',
        description:
          'Acesso total ao CRM. Papel do sistema — não pode ser editado nem excluído.',
        system: true,
      },
    });
  }
  // Papel de exemplo (editável) para demonstrar o convite de colaborador.
  await prisma.role.upsert({
    where: { ownerId_name: { ownerId, name: 'Comercial' } },
    update: {},
    create: {
      ownerId,
      name: 'Comercial',
      description: 'Clientes, pipeline e propostas — sem acesso ao financeiro.',
      permissions: [
        'cliente:ver',
        'cliente:gerenciar',
        'cliente:ver_todos',
        'oportunidade:ver',
        'oportunidade:gerenciar',
        'oportunidade:ver_todas',
        'proposta:ver',
        'proposta:gerenciar',
      ],
    },
  });

  // --- estágios do pipeline (por owner) ---------------------------------
  // O funil é do owner (RLS por ownerId). Em produção estes estágios nascem no
  // cadastro (ver UsersService); aqui o seed replica para os dois owners de
  // desenvolvimento, o que também exercita o isolamento.
  for (const owner of [admin, demo]) {
    for (const s of defaultPipelineStages()) {
      await prisma.pipelineStage.upsert({
        where: { ownerId_name: { ownerId: owner.id, name: s.name } },
        update: { order: s.order, isWon: s.isWon, isLost: s.isLost },
        create: { ownerId: owner.id, ...s },
      });
    }
  }
  const stages = await prisma.pipelineStage.findMany({ where: { ownerId } });
  const stage = (name: string) => {
    const s = stages.find((x) => x.name === name);
    if (!s) throw new Error(`Estágio não encontrado: ${name}`);
    return s.id;
  };

  // --- catálogo de fontes de lead (por owner) ----------------------------
  // Mesmo molde do funil: em produção nasce no cadastro (ver UsersService);
  // aqui o seed replica para os dois owners de desenvolvimento.
  for (const owner of [admin, demo]) {
    for (const item of defaultLeadSourceCatalog()) {
      await prisma.leadSourceCatalog.upsert({
        where: { ownerId_name: { ownerId: owner.id, name: item.name } },
        update: {},
        create: { ownerId: owner.id, ...item },
      });
    }
  }
  const leadSources = await prisma.leadSourceCatalog.findMany({
    where: { ownerId },
  });
  /** Id da fonte de lead do owner pelo nome padrão — ver default-catalogs.ts. */
  const fonte = (name: string) => {
    const f = leadSources.find((x) => x.name === name);
    if (!f) throw new Error(`Fonte de lead não encontrada: ${name}`);
    return f.id;
  };
  // Mapa 1:1 do enum `LeadSource` (removido na migration 20260805100000) para
  // o nome do catálogo — a mesma tabela usada no backfill da migration.
  const FONTE_POR_ENUM = {
    REFERRAL: 'Indicação',
    PAID_TRAFFIC: 'Tráfego pago',
    ORGANIC: 'Orgânico',
    OUTBOUND: 'Prospecção ativa',
    OTHER: 'Outro',
  } as const;
  const fontePorEnum = (enumValue: keyof typeof FONTE_POR_ENUM) =>
    fonte(FONTE_POR_ENUM[enumValue]);

  // --- catálogo de motivos de perda (por owner) --------------------------
  for (const owner of [admin, demo]) {
    for (const item of defaultLostReasonCatalog()) {
      await prisma.lostReasonCatalog.upsert({
        where: { ownerId_name: { ownerId: owner.id, name: item.name } },
        update: {},
        create: { ownerId: owner.id, ...item },
      });
    }
  }
  const lostReasons = await prisma.lostReasonCatalog.findMany({
    where: { ownerId },
  });
  /** Id do motivo de perda do owner pelo nome padrão — ver default-catalogs.ts. */
  const motivoDePerda = (name: string) => {
    const m = lostReasons.find((x) => x.name === name);
    if (!m) throw new Error(`Motivo de perda não encontrado: ${name}`);
    return m.id;
  };

  // --- catálogo de tipos de serviço (por owner) --------------------------
  for (const owner of [admin, demo]) {
    for (const item of defaultServiceCatalog()) {
      await prisma.serviceCatalog.upsert({
        where: { ownerId_name: { ownerId: owner.id, name: item.name } },
        update: {},
        create: { ownerId: owner.id, ...item },
      });
    }
  }
  const services = await prisma.serviceCatalog.findMany({ where: { ownerId } });
  const servico = (name: string) => {
    const sv = services.find((x) => x.name === name);
    if (!sv) throw new Error(`Tipo de serviço não encontrado: ${name}`);
    return sv.id;
  };
  // Mapa 1:1 do enum `ServiceType` (removido na migration 20260807100000) para
  // o nome do catálogo — a mesma tabela usada no backfill da migration.
  const SERVICO_POR_ENUM = {
    SOFTWARE: 'Software',
    WEBSITE: 'Website',
    PAID_TRAFFIC: 'Tráfego pago',
  } as const;
  const servicoPorEnum = (enumValue: keyof typeof SERVICO_POR_ENUM) =>
    servico(SERVICO_POR_ENUM[enumValue]);

  // --- catálogo de tipos de atividade (por owner) ------------------------
  // `isFollowUp` é REGRA: o cron de lembretes e o dashboard filtram por ela.
  for (const owner of [admin, demo]) {
    for (const item of defaultActivityTypeCatalog()) {
      await prisma.activityTypeCatalog.upsert({
        where: { ownerId_name: { ownerId: owner.id, name: item.name } },
        update: { isFollowUp: item.isFollowUp },
        create: { ownerId: owner.id, ...item },
      });
    }
  }
  const activityTypes = await prisma.activityTypeCatalog.findMany({
    where: { ownerId },
  });
  const tipoDeAtividade = (name: string) => {
    const t = activityTypes.find((x) => x.name === name);
    if (!t) throw new Error(`Tipo de atividade não encontrado: ${name}`);
    return t.id;
  };
  // Mapa 1:1 do enum `ActivityType` (removido na migration 20260808100000).
  const TIPO_POR_ENUM = {
    NOTE: 'Anotação',
    CALL: 'Ligação',
    MEETING: 'Reunião',
    EMAIL: 'E-mail',
    WHATSAPP: 'WhatsApp',
    FOLLOW_UP: 'Follow-up',
  } as const;
  const tipoPorEnum = (enumValue: keyof typeof TIPO_POR_ENUM) =>
    tipoDeAtividade(TIPO_POR_ENUM[enumValue]);

  // --- limpeza dos dados de negócio do owner demo (idempotência) --------
  // Ordem respeita as FKs (filhos antes dos pais); tudo escopado ao owner.
  await prisma.payment.deleteMany({ where: { ownerId } });
  await prisma.task.deleteMany({ where: { ownerId } });
  await prisma.activity.deleteMany({ where: { ownerId } });
  await prisma.proposalItem.deleteMany({ where: { ownerId } });
  await prisma.contract.deleteMany({ where: { ownerId } });
  await prisma.project.deleteMany({ where: { ownerId } });
  await prisma.proposal.deleteMany({ where: { ownerId } });
  await prisma.deal.deleteMany({ where: { ownerId } });
  await prisma.contact.deleteMany({ where: { ownerId } });
  await prisma.client.deleteMany({ where: { ownerId } });

  // =====================================================================
  // CLIENTES + CONTATOS
  // =====================================================================
  const clinica = await prisma.client.create({
    data: {
      ownerId,
      name: 'Clínica Vida Plena',
      tradeName: 'Vida Plena',
      personType: 'COMPANY',
      document: '12.345.678/0001-90',
      email: 'contato@vidaplena.com.br',
      phone: '(11) 3555-1200',
      website: 'https://vidaplena.com.br',
      sourceId: fontePorEnum('REFERRAL'),
      status: 'ACTIVE',
      tags: ['saúde', 'recorrente', 'premium'],
      notes: 'Rede de 3 unidades. Sistema de agendamento e prontuário.',
      zipCode: '01310-100',
      street: 'Av. Paulista',
      number: '1500',
      complement: 'Conj. 802',
      district: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      contacts: {
        create: [
          {
            ownerId,
            name: 'Dra. Helena Marques',
            role: 'Diretora clínica',
            email: 'helena@vidaplena.com.br',
            phone: '(11) 99812-4400',
            isPrimary: true,
          },
          {
            ownerId,
            name: 'Rafael Costa',
            role: 'Gerente administrativo',
            email: 'rafael@vidaplena.com.br',
            phone: '(11) 99745-2210',
          },
        ],
      },
    },
  });

  const contabilidade = await prisma.client.create({
    data: {
      ownerId,
      name: 'Contabilidade Nova Era Ltda',
      tradeName: 'Nova Era Contábil',
      personType: 'COMPANY',
      document: '98.765.432/0001-10',
      email: 'financeiro@novaeracontabil.com.br',
      phone: '(11) 3222-8080',
      website: 'https://novaeracontabil.com.br',
      sourceId: fontePorEnum('ORGANIC'),
      status: 'ACTIVE',
      tags: ['contábil', 'recorrente'],
      notes: 'Portal do cliente para envio de documentos fiscais.',
      zipCode: '04538-133',
      street: 'Av. Brigadeiro Faria Lima',
      number: '3477',
      complement: 'Torre Sul, 14º andar',
      district: 'Itaim Bibi',
      city: 'São Paulo',
      state: 'SP',
      contacts: {
        create: {
          ownerId,
          name: 'Marcos Vinícius Prado',
          role: 'Sócio-diretor',
          email: 'marcos@novaeracontabil.com.br',
          phone: '(11) 98123-9090',
          isPrimary: true,
        },
      },
    },
  });

  const imobiliaria = await prisma.client.create({
    data: {
      ownerId,
      name: 'Imobiliária Lar Ideal',
      tradeName: 'Lar Ideal',
      personType: 'COMPANY',
      document: '45.678.123/0001-55',
      email: 'contato@larideal.com.br',
      phone: '(21) 3888-4500',
      website: 'https://larideal.com.br',
      sourceId: fontePorEnum('PAID_TRAFFIC'),
      status: 'ACTIVE',
      tags: ['imobiliário', 'premium'],
      notes: 'Portal de imóveis com integração ao WhatsApp e CRM próprio.',
      zipCode: '22071-900',
      street: 'Av. Nossa Senhora de Copacabana',
      number: '900',
      district: 'Copacabana',
      city: 'Rio de Janeiro',
      state: 'RJ',
      contacts: {
        create: {
          ownerId,
          name: 'Patrícia Fonseca',
          role: 'Diretora comercial',
          email: 'patricia@larideal.com.br',
          phone: '(21) 99666-1122',
          isPrimary: true,
        },
      },
    },
  });

  const advocacia = await prisma.client.create({
    data: {
      ownerId,
      name: 'Martins & Associados Advocacia',
      tradeName: 'Martins Advogados',
      personType: 'COMPANY',
      document: '33.444.555/0001-22',
      email: 'contato@martinsadv.com.br',
      phone: '(31) 3444-7700',
      website: 'https://martinsadv.com.br',
      sourceId: fontePorEnum('REFERRAL'),
      status: 'ACTIVE',
      tags: ['jurídico', 'recorrente'],
      notes: 'Sistema de gestão de processos e prazos.',
      zipCode: '30140-071',
      street: 'Av. Afonso Pena',
      number: '1200',
      complement: '10º andar',
      district: 'Centro',
      city: 'Belo Horizonte',
      state: 'MG',
      contacts: {
        create: {
          ownerId,
          name: 'Dr. Eduardo Martins',
          role: 'Sócio-fundador',
          email: 'eduardo@martinsadv.com.br',
          phone: '(31) 99888-3030',
          isPrimary: true,
        },
      },
    },
  });

  const transportadora = await prisma.client.create({
    data: {
      ownerId,
      name: 'Transportadora RotaCerta',
      tradeName: 'RotaCerta',
      personType: 'COMPANY',
      document: '77.888.999/0001-33',
      email: 'ti@rotacerta.com.br',
      phone: '(41) 3025-6000',
      website: 'https://rotacerta.com.br',
      sourceId: fontePorEnum('OUTBOUND'),
      status: 'ACTIVE',
      tags: ['logística', 'recorrente'],
      notes: 'Painel de rastreamento de cargas em tempo real.',
      zipCode: '81200-100',
      street: 'Rua João Bettega',
      number: '2500',
      district: 'Portão',
      city: 'Curitiba',
      state: 'PR',
      contacts: {
        create: {
          ownerId,
          name: 'Cláudia Menezes',
          role: 'Gerente de TI',
          email: 'claudia@rotacerta.com.br',
          phone: '(41) 99123-7788',
          isPrimary: true,
        },
      },
    },
  });

  const autopecas = await prisma.client.create({
    data: {
      ownerId,
      name: 'AutoPeças Veloz',
      tradeName: 'Veloz Peças',
      personType: 'COMPANY',
      document: '22.333.444/0001-66',
      email: 'marketing@autopecasveloz.com.br',
      phone: '(51) 3200-4040',
      website: 'https://autopecasveloz.com.br',
      sourceId: fontePorEnum('PAID_TRAFFIC'),
      status: 'ACTIVE',
      tags: ['e-commerce', 'tráfego'],
      notes: 'Gestão de tráfego pago (Google + Meta) para a loja virtual.',
      zipCode: '90230-041',
      street: 'Av. Farrapos',
      number: '1800',
      district: 'Floresta',
      city: 'Porto Alegre',
      state: 'RS',
      contacts: {
        create: {
          ownerId,
          name: 'Bruno Tavares',
          role: 'Proprietário',
          email: 'bruno@autopecasveloz.com.br',
          phone: '(51) 99555-6060',
          isPrimary: true,
        },
      },
    },
  });

  const padaria = await prisma.client.create({
    data: {
      ownerId,
      name: 'Padaria Pão Dourado',
      tradeName: 'Pão Dourado',
      personType: 'COMPANY',
      document: '55.666.777/0001-88',
      email: 'contato@paodourado.com.br',
      phone: '(11) 2444-3300',
      website: 'https://paodourado.com.br',
      sourceId: fontePorEnum('ORGANIC'),
      status: 'ACTIVE',
      tags: ['varejo', 'site'],
      notes: 'Site institucional com cardápio e encomendas online.',
      zipCode: '07110-000',
      street: 'Av. Monteiro Lobato',
      number: '740',
      district: 'Macedo',
      city: 'Guarulhos',
      state: 'SP',
      contacts: {
        create: {
          ownerId,
          name: 'Antônio Ferreira',
          role: 'Proprietário',
          email: 'antonio@paodourado.com.br',
          phone: '(11) 99444-1212',
          isPrimary: true,
        },
      },
    },
  });

  const fitness = await prisma.client.create({
    data: {
      ownerId,
      name: 'Studio Corpo em Foco',
      tradeName: 'Corpo em Foco',
      personType: 'COMPANY',
      document: '11.222.333/0001-44',
      email: 'contato@corpoemfoco.com.br',
      phone: '(48) 3600-2020',
      website: 'https://corpoemfoco.com.br',
      sourceId: fontePorEnum('ORGANIC'),
      status: 'LEAD',
      tags: ['fitness', 'lead-quente'],
      notes: 'Quer site novo + agendamento de aulas. Orçamento em análise.',
      zipCode: '88015-200',
      street: 'Av. Rio Branco',
      number: '380',
      complement: 'Sala 5',
      district: 'Centro',
      city: 'Florianópolis',
      state: 'SC',
      contacts: {
        create: {
          ownerId,
          name: 'Juliana Reis',
          role: 'Sócia',
          email: 'juliana@corpoemfoco.com.br',
          phone: '(48) 99777-8080',
          isPrimary: true,
        },
      },
    },
  });

  const modaviva = await prisma.client.create({
    data: {
      ownerId,
      name: 'ModaViva E-commerce',
      tradeName: 'ModaViva',
      personType: 'COMPANY',
      document: '66.777.888/0001-99',
      email: 'ola@modaviva.com.br',
      phone: '(11) 4002-8922',
      website: 'https://modaviva.com.br',
      sourceId: fontePorEnum('PAID_TRAFFIC'),
      status: 'LEAD',
      tags: ['moda', 'e-commerce', 'lead'],
      notes: 'Escalar tráfego pago para Black Friday. Aguardando aprovação.',
      zipCode: '05422-030',
      street: 'Rua Cardeal Arcoverde',
      number: '2100',
      complement: 'Galpão 3',
      district: 'Pinheiros',
      city: 'São Paulo',
      state: 'SP',
      contacts: {
        create: {
          ownerId,
          name: 'Camila Duarte',
          role: 'Head de marketing',
          email: 'camila@modaviva.com.br',
          phone: '(11) 99222-3344',
          isPrimary: true,
        },
      },
    },
  });

  const restaurante = await prisma.client.create({
    data: {
      ownerId,
      name: 'Restaurante Sabor Caseiro',
      tradeName: 'Sabor Caseiro',
      personType: 'COMPANY',
      document: '99.111.222/0001-77',
      email: 'contato@saborcaseiro.com.br',
      phone: '(62) 3900-1010',
      website: 'https://saborcaseiro.com.br',
      sourceId: fontePorEnum('REFERRAL'),
      status: 'LEAD',
      tags: ['gastronomia', 'lead'],
      notes: 'Indicação da Pão Dourado. Primeiro contato feito.',
      zipCode: '74110-010',
      street: 'Av. T-9',
      number: '1250',
      district: 'Setor Bueno',
      city: 'Goiânia',
      state: 'GO',
      contacts: {
        create: {
          ownerId,
          name: 'Sérgio Almeida',
          role: 'Proprietário',
          email: 'sergio@saborcaseiro.com.br',
          phone: '(62) 99333-4455',
          isPrimary: true,
        },
      },
    },
  });

  const petshop = await prisma.client.create({
    data: {
      ownerId,
      name: 'Pet Shop Amigo Fiel',
      tradeName: 'Amigo Fiel',
      personType: 'COMPANY',
      document: '10.020.030/0001-40',
      email: 'contato@amigofiel.com.br',
      phone: '(11) 2900-5050',
      website: 'https://amigofiel.com.br',
      sourceId: fontePorEnum('ORGANIC'),
      status: 'INACTIVE',
      tags: ['pet', 'varejo'],
      notes: 'Projeto do site entregue em 2025. Sem demanda ativa no momento.',
      zipCode: '03310-000',
      street: 'Rua Tuiuti',
      number: '1580',
      district: 'Tatuapé',
      city: 'São Paulo',
      state: 'SP',
      contacts: {
        create: {
          ownerId,
          name: 'Fernanda Lopes',
          role: 'Gerente',
          email: 'fernanda@amigofiel.com.br',
          phone: '(11) 99111-2020',
          isPrimary: true,
        },
      },
    },
  });

  const escola = await prisma.client.create({
    data: {
      ownerId,
      name: 'Escola Saber Mais',
      tradeName: 'Saber Mais',
      personType: 'COMPANY',
      document: '30.040.050/0001-60',
      email: 'diretoria@sabermais.edu.br',
      phone: '(85) 3100-7070',
      website: 'https://sabermais.edu.br',
      sourceId: fontePorEnum('OUTBOUND'),
      status: 'LOST',
      tags: ['educação'],
      notes: 'Optou por concorrente por questão de orçamento.',
      zipCode: '60160-230',
      street: 'Av. Dom Luís',
      number: '500',
      complement: 'Bloco B',
      district: 'Meireles',
      city: 'Fortaleza',
      state: 'CE',
      contacts: {
        create: {
          ownerId,
          name: 'Roberto Nunes',
          role: 'Diretor',
          email: 'roberto@sabermais.edu.br',
          phone: '(85) 99444-5566',
          isPrimary: true,
        },
      },
    },
  });

  // =====================================================================
  // OPORTUNIDADES (pipeline) — espalhadas pelos estágios
  // =====================================================================
  const dealFitness = await prisma.deal.create({
    data: {
      ownerId,
      clientId: fitness.id,
      stageId: stage('Negociação'),
      title: 'Site + agendamento de aulas',
      serviceTypeId: servicoPorEnum('WEBSITE'),
      amount: dec(18500),
      probability: 70,
      expectedClose: day(9),
      position: 0,
      stageMovedAt: day(-3),
    },
  });

  const dealModa = await prisma.deal.create({
    data: {
      ownerId,
      clientId: modaviva.id,
      stageId: stage('Proposta enviada'),
      title: 'Gestão de tráfego — campanha Black Friday',
      serviceTypeId: servicoPorEnum('PAID_TRAFFIC'),
      amount: dec(9800),
      probability: 55,
      expectedClose: day(14),
      position: 0,
      stageMovedAt: day(-6),
    },
  });

  await prisma.deal.create({
    data: {
      ownerId,
      clientId: restaurante.id,
      stageId: stage('Reunião/Diagnóstico'),
      title: 'Landing page + cardápio digital',
      serviceTypeId: servicoPorEnum('WEBSITE'),
      amount: dec(7200),
      probability: 40,
      expectedClose: day(20),
      position: 0,
      stageMovedAt: day(-2),
    },
  });

  await prisma.deal.create({
    data: {
      ownerId,
      clientId: autopecas.id,
      stageId: stage('Negociação'),
      title: 'Expansão de campanhas — novos produtos',
      serviceTypeId: servicoPorEnum('PAID_TRAFFIC'),
      amount: dec(6500),
      probability: 65,
      expectedClose: day(11),
      position: 1,
      stageMovedAt: day(-4),
    },
  });

  await prisma.deal.create({
    data: {
      ownerId,
      clientId: imobiliaria.id,
      stageId: stage('Proposta enviada'),
      title: 'Módulo de assinatura digital de contratos',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      amount: dec(24000),
      probability: 60,
      expectedClose: day(25),
      position: 1,
      stageMovedAt: day(-8),
    },
  });

  await prisma.deal.create({
    data: {
      ownerId,
      clientId: transportadora.id,
      stageId: stage('Contato feito'),
      title: 'App mobile para motoristas',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      amount: dec(38000),
      probability: 30,
      expectedClose: day(45),
      position: 0,
      stageMovedAt: day(-1),
    },
  });

  await prisma.deal.create({
    data: {
      ownerId,
      clientId: padaria.id,
      stageId: stage('Novo lead'),
      title: 'Loja de encomendas online',
      serviceTypeId: servicoPorEnum('WEBSITE'),
      amount: dec(5400),
      probability: 20,
      expectedClose: day(30),
      position: 0,
      stageMovedAt: day(-12), // "esfriando"
    },
  });

  // Ganhos (alimentam a taxa de conversão dos últimos 90 dias)
  const dealClinicaWon = await prisma.deal.create({
    data: {
      ownerId,
      clientId: clinica.id,
      stageId: stage('Ganhou'),
      title: 'Sistema de agendamento e prontuário',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      amount: dec(42000),
      probability: 100,
      expectedClose: day(-20),
      position: 0,
      stageMovedAt: day(-20),
    },
  });

  const dealAdvocaciaWon = await prisma.deal.create({
    data: {
      ownerId,
      clientId: advocacia.id,
      stageId: stage('Ganhou'),
      title: 'Gestão de processos e prazos',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      amount: dec(36000),
      probability: 100,
      expectedClose: day(-35),
      position: 1,
      stageMovedAt: day(-35),
    },
  });

  await prisma.deal.create({
    data: {
      ownerId,
      clientId: contabilidade.id,
      stageId: stage('Ganhou'),
      title: 'Portal do cliente contábil',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      amount: dec(28000),
      probability: 100,
      expectedClose: day(-50),
      position: 2,
      stageMovedAt: day(-50),
    },
  });

  // Perdido
  await prisma.deal.create({
    data: {
      ownerId,
      clientId: escola.id,
      stageId: stage('Perdeu'),
      title: 'Portal do aluno',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      amount: dec(31000),
      probability: 0,
      lostReasonId: motivoDePerda('Escolheu concorrente'),
      position: 0,
      stageMovedAt: day(-15),
    },
  });

  // =====================================================================
  // PROPOSTAS (+ itens)
  // =====================================================================
  // Aceita este mês (conta em "propostas aceitas no mês")
  await prisma.proposal.create({
    data: {
      ownerId,
      number: 'PROP-2026-0018',
      clientId: clinica.id,
      dealId: dealClinicaWon.id,
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      status: 'ACCEPTED',
      scope:
        '## Escopo\nSistema de agendamento online, prontuário eletrônico e gestão de convênios para 3 unidades.',
      paymentTerms: 'Entrada de 30% + 6 parcelas mensais.',
      deliveryTime: '90 dias',
      validUntil: day(10),
      total: dec(42000),
      sentAt: monthDay(0, 2),
      decidedAt: monthDay(0, 6),
      items: {
        create: [
          {
            ownerId,
            description: 'Módulo de agendamento online',
            quantity: dec(1),
            unitPrice: dec(15000),
            order: 0,
          },
          {
            ownerId,
            description: 'Prontuário eletrônico',
            quantity: dec(1),
            unitPrice: dec(18000),
            order: 1,
          },
          {
            ownerId,
            description: 'Integração com convênios',
            quantity: dec(1),
            unitPrice: dec(9000),
            order: 2,
          },
        ],
      },
    },
  });

  // Enviada (aberta) — vinculada ao deal da imobiliária
  await prisma.proposal.create({
    data: {
      ownerId,
      number: 'PROP-2026-0021',
      clientId: imobiliaria.id,
      dealId: null,
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      status: 'SENT',
      scope:
        '## Escopo\nMódulo de assinatura digital de contratos integrado ao portal existente.',
      paymentTerms: '50% na assinatura + 50% na entrega.',
      deliveryTime: '45 dias',
      validUntil: day(20),
      discount: dec(1000),
      total: dec(24000),
      sentAt: day(-6),
      items: {
        create: [
          {
            ownerId,
            description: 'Integração com provedor de assinatura digital',
            quantity: dec(1),
            unitPrice: dec(16000),
            order: 0,
          },
          {
            ownerId,
            description: 'Fluxo de aprovação e histórico',
            quantity: dec(1),
            unitPrice: dec(9000),
            order: 1,
          },
        ],
      },
    },
  });

  // Em negociação (aberta)
  await prisma.proposal.create({
    data: {
      ownerId,
      number: 'PROP-2026-0022',
      clientId: fitness.id,
      dealId: dealFitness.id,
      serviceTypeId: servicoPorEnum('WEBSITE'),
      status: 'NEGOTIATING',
      scope:
        '## Escopo\nSite responsivo com identidade nova, agendamento de aulas e área do aluno.',
      paymentTerms: 'Entrada de 40% + 3 parcelas.',
      deliveryTime: '40 dias',
      validUntil: day(12),
      total: dec(18500),
      sentAt: day(-4),
      items: {
        create: [
          {
            ownerId,
            description: 'Design e desenvolvimento do site',
            quantity: dec(1),
            unitPrice: dec(12000),
            order: 0,
          },
          {
            ownerId,
            description: 'Módulo de agendamento de aulas',
            quantity: dec(1),
            unitPrice: dec(6500),
            order: 1,
          },
        ],
      },
    },
  });

  // Enviada (aberta) — ModaViva
  await prisma.proposal.create({
    data: {
      ownerId,
      number: 'PROP-2026-0023',
      clientId: modaviva.id,
      dealId: dealModa.id,
      serviceTypeId: servicoPorEnum('PAID_TRAFFIC'),
      status: 'SENT',
      scope:
        '## Escopo\nGestão de tráfego pago (Google Ads + Meta) para a campanha de Black Friday.',
      paymentTerms: 'Fee mensal + verba de mídia à parte.',
      deliveryTime: '3 meses de campanha',
      validUntil: day(15),
      total: dec(9800),
      sentAt: day(-5),
      items: {
        create: {
          ownerId,
          description: 'Fee de gestão (3 meses)',
          quantity: dec(3),
          unitPrice: dec(3266.67),
          order: 0,
        },
      },
    },
  });

  // Rascunho
  await prisma.proposal.create({
    data: {
      ownerId,
      number: 'PROP-2026-0024',
      clientId: transportadora.id,
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      status: 'DRAFT',
      scope: '## Escopo\nApp mobile para motoristas (rascunho em elaboração).',
      deliveryTime: 'A definir',
      total: dec(38000),
      items: {
        create: {
          ownerId,
          description: 'App mobile (iOS + Android) — estimativa',
          quantity: dec(1),
          unitPrice: dec(38000),
          order: 0,
        },
      },
    },
  });

  // Aceita anterior (advocacia) — dentro dos 90 dias
  await prisma.proposal.create({
    data: {
      ownerId,
      number: 'PROP-2026-0009',
      clientId: advocacia.id,
      dealId: dealAdvocaciaWon.id,
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      status: 'ACCEPTED',
      scope: '## Escopo\nSistema de gestão de processos e prazos.',
      paymentTerms: 'Entrada + 8 parcelas.',
      deliveryTime: '75 dias',
      validUntil: day(-20),
      total: dec(36000),
      sentAt: day(-40),
      decidedAt: day(-35),
      items: {
        create: {
          ownerId,
          description: 'Desenvolvimento do sistema de processos',
          quantity: dec(1),
          unitPrice: dec(36000),
          order: 0,
        },
      },
    },
  });

  // Recusada (para taxa de conversão) — escola
  await prisma.proposal.create({
    data: {
      ownerId,
      number: 'PROP-2026-0011',
      clientId: escola.id,
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      status: 'REJECTED',
      scope: '## Escopo\nPortal do aluno com notas e frequência.',
      total: dec(31000),
      sentAt: day(-25),
      decidedAt: day(-15),
      items: {
        create: {
          ownerId,
          description: 'Portal do aluno',
          quantity: dec(1),
          unitPrice: dec(31000),
          order: 0,
        },
      },
    },
  });

  // =====================================================================
  // PROJETOS + DEMANDAS (kanban)
  // =====================================================================
  const projClinica = await prisma.project.create({
    data: {
      ownerId,
      clientId: clinica.id,
      dealId: dealClinicaWon.id,
      name: 'Sistema Vida Plena',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      status: 'ACTIVE',
      startDate: day(-18),
      dueDate: day(40),
    },
  });

  const projAdvocacia = await prisma.project.create({
    data: {
      ownerId,
      clientId: advocacia.id,
      dealId: dealAdvocaciaWon.id,
      name: 'Gestão de Processos — Martins Adv.',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      status: 'ACTIVE',
      startDate: day(-34),
      dueDate: day(20),
    },
  });

  const projContabil = await prisma.project.create({
    data: {
      ownerId,
      clientId: contabilidade.id,
      name: 'Portal do Cliente Contábil',
      serviceTypeId: servicoPorEnum('SOFTWARE'),
      status: 'ACTIVE',
      startDate: day(-48),
      dueDate: day(-2),
    },
  });

  const projAutopecas = await prisma.project.create({
    data: {
      ownerId,
      clientId: autopecas.id,
      name: 'Tráfego Pago — Veloz Peças',
      serviceTypeId: servicoPorEnum('PAID_TRAFFIC'),
      status: 'ACTIVE',
      startDate: day(-60),
    },
  });

  await prisma.project.create({
    data: {
      ownerId,
      clientId: petshop.id,
      name: 'Site Amigo Fiel',
      serviceTypeId: servicoPorEnum('WEBSITE'),
      status: 'DONE',
      startDate: day(-200),
      dueDate: day(-150),
    },
  });

  // --- demandas (tasks) -------------------------------------------------
  type TaskSeed = {
    projectId: string;
    title: string;
    description?: string;
    status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    dueDate?: Date;
    position: number;
    tags?: string[];
    checklist?: { text: string; done: boolean }[];
    completedAt?: Date;
  };

  const tasks: TaskSeed[] = [
    // Vida Plena
    {
      projectId: projClinica.id,
      title: 'Modelar banco de dados do prontuário',
      status: 'DONE',
      priority: 'HIGH',
      position: 0,
      tags: ['backend'],
      completedAt: day(-10),
    },
    {
      projectId: projClinica.id,
      title: 'API de agendamento online',
      description: 'Endpoints de disponibilidade, reserva e cancelamento.',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueDate: day(3),
      position: 0,
      tags: ['backend', 'api'],
      checklist: [
        { text: 'Disponibilidade por profissional', done: true },
        { text: 'Reserva com confirmação', done: false },
        { text: 'Regras de cancelamento', done: false },
      ],
    },
    {
      projectId: projClinica.id,
      title: 'Tela de calendário do profissional',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      dueDate: day(5),
      position: 1,
      tags: ['frontend'],
    },
    {
      projectId: projClinica.id,
      title: 'Integração com convênios',
      status: 'TODO',
      priority: 'MEDIUM',
      dueDate: day(15),
      position: 0,
      tags: ['integração'],
    },
    {
      projectId: projClinica.id,
      title: 'Notificações por WhatsApp',
      status: 'BACKLOG',
      priority: 'LOW',
      position: 0,
    },
    // Martins Adv.
    {
      projectId: projAdvocacia.id,
      title: 'Importar base de processos legada',
      status: 'REVIEW',
      priority: 'HIGH',
      dueDate: day(2),
      position: 0,
      tags: ['migração'],
      checklist: [
        { text: 'Mapear planilha atual', done: true },
        { text: 'Script de importação', done: true },
        { text: 'Validar com o cliente', done: false },
      ],
    },
    {
      projectId: projAdvocacia.id,
      title: 'Alertas de prazos processuais',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      dueDate: day(-1), // atrasada
      position: 2,
      tags: ['backend'],
    },
    {
      projectId: projAdvocacia.id,
      title: 'Dashboard de prazos por advogado',
      status: 'TODO',
      priority: 'MEDIUM',
      dueDate: day(9),
      position: 0,
    },
    {
      projectId: projAdvocacia.id,
      title: 'Ajustar layout do relatório PDF',
      status: 'DONE',
      priority: 'LOW',
      position: 1,
      completedAt: day(-4),
    },
    // Portal contábil
    {
      projectId: projContabil.id,
      title: 'Upload de documentos fiscais',
      status: 'DONE',
      priority: 'HIGH',
      position: 0,
      completedAt: day(-12),
    },
    {
      projectId: projContabil.id,
      title: 'Ajustes de homologação',
      status: 'REVIEW',
      priority: 'HIGH',
      dueDate: day(1),
      position: 1,
      tags: ['qa'],
    },
    {
      projectId: projContabil.id,
      title: 'Correção de bug no login SSO',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      dueDate: day(-3), // atrasada
      position: 3,
      tags: ['bug'],
    },
    // Tráfego Veloz
    {
      projectId: projAutopecas.id,
      title: 'Otimizar campanhas de Search',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      dueDate: day(4),
      position: 4,
      tags: ['ads'],
    },
    {
      projectId: projAutopecas.id,
      title: 'Relatório mensal de performance',
      status: 'TODO',
      priority: 'MEDIUM',
      dueDate: day(6),
      position: 0,
    },
    {
      projectId: projAutopecas.id,
      title: 'Criar públicos de remarketing',
      status: 'BACKLOG',
      priority: 'LOW',
      position: 0,
    },
  ];

  for (const t of tasks) {
    await prisma.task.create({
      data: {
        ownerId,
        projectId: t.projectId,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        position: t.position,
        tags: t.tags ?? [],
        checklist: t.checklist ?? undefined,
        completedAt: t.completedAt,
      },
    });
  }

  // =====================================================================
  // CONTRATOS + COBRANÇAS (financeiro)
  // =====================================================================
  // Helper: cria contrato recorrente + mensalidades de -2 a +3 meses.
  const seedRecurring = async (opts: {
    clientId: string;
    projectId?: string;
    description: string;
    monthlyAmount: number;
    billingDay: number;
    method: 'PIX' | 'TRANSFER' | 'BOLETO' | 'CARD' | 'CASH';
    startMonthsAgo: number;
  }) => {
    const contract = await prisma.contract.create({
      data: {
        ownerId,
        clientId: opts.clientId,
        projectId: opts.projectId,
        description: opts.description,
        billingType: 'RECURRING',
        status: 'ACTIVE',
        monthlyAmount: dec(opts.monthlyAmount),
        billingDay: opts.billingDay,
        startDate: monthDay(-opts.startMonthsAgo, opts.billingDay),
      },
    });
    const label = (mo: number) => {
      const d = monthDay(mo, opts.billingDay);
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `Mensalidade ${mm}/${d.getUTCFullYear()}`;
    };
    for (let mo = -2; mo <= 3; mo++) {
      const due = monthDay(mo, opts.billingDay);
      const isPast = mo < 0;
      const isCurrentPaid = mo === 0 && opts.billingDay <= D; // já venceu no mês
      const paid = isPast || isCurrentPaid;
      await prisma.payment.create({
        data: {
          ownerId,
          contractId: contract.id,
          description: label(mo),
          amount: dec(opts.monthlyAmount),
          dueDate: due,
          status: paid ? 'PAID' : 'PENDING',
          paidAt: paid ? due : null,
          method: paid ? opts.method : null,
        },
      });
    }
    return contract;
  };

  const contractClinica = await seedRecurring({
    clientId: clinica.id,
    projectId: projClinica.id,
    description: 'Sustentação e hospedagem — Sistema Vida Plena',
    monthlyAmount: 3500,
    billingDay: 5,
    method: 'PIX',
    startMonthsAgo: 6,
  });

  await seedRecurring({
    clientId: contabilidade.id,
    projectId: projContabil.id,
    description: 'Manutenção mensal — Portal do Cliente',
    monthlyAmount: 2800,
    billingDay: 10,
    method: 'BOLETO',
    startMonthsAgo: 8,
  });

  const contractAdvocacia = await seedRecurring({
    clientId: advocacia.id,
    projectId: projAdvocacia.id,
    description: 'Suporte e evolução — Gestão de Processos',
    monthlyAmount: 4200,
    billingDay: 15,
    method: 'TRANSFER',
    startMonthsAgo: 4,
  });

  const contractImobiliaria = await seedRecurring({
    clientId: imobiliaria.id,
    description: 'Hospedagem e SLA — Portal de Imóveis',
    monthlyAmount: 5500,
    billingDay: 20,
    method: 'PIX',
    startMonthsAgo: 10,
  });

  // Cobranças avulsas pendentes com vencimento nos próximos dias — populam o
  // painel "próximos vencimentos" do dashboard de forma robusta (relativas a hoje).
  await prisma.payment.createMany({
    data: [
      {
        ownerId,
        contractId: contractClinica.id,
        description: 'Horas extras de suporte',
        amount: dec(850),
        dueDate: day(2),
        status: 'PENDING',
      },
      {
        ownerId,
        contractId: contractAdvocacia.id,
        description: 'Treinamento da equipe',
        amount: dec(1200),
        dueDate: day(5),
        status: 'PENDING',
      },
      {
        ownerId,
        contractId: contractImobiliaria.id,
        description: 'Integração adicional — WhatsApp',
        amount: dec(1500),
        dueDate: day(6),
        status: 'PENDING',
      },
    ],
  });

  await seedRecurring({
    clientId: autopecas.id,
    projectId: projAutopecas.id,
    description: 'Fee mensal de gestão de tráfego',
    monthlyAmount: 3900,
    billingDay: 8,
    method: 'PIX',
    startMonthsAgo: 3,
  });

  // Contrato parcelado — Transportadora (entrada + 8 parcelas), com uma vencida
  const contractParcelado = await prisma.contract.create({
    data: {
      ownerId,
      clientId: transportadora.id,
      description: 'Painel de rastreamento de cargas — implantação',
      billingType: 'INSTALLMENTS',
      status: 'ACTIVE',
      downPayment: dec(12000),
      installments: 8,
      installmentAmount: dec(3250),
      startDate: monthDay(-1, 3),
    },
  });
  await prisma.payment.create({
    data: {
      ownerId,
      contractId: contractParcelado.id,
      description: 'Entrada',
      amount: dec(12000),
      dueDate: monthDay(-1, 3),
      status: 'PAID',
      paidAt: monthDay(-1, 3),
      method: 'TRANSFER',
    },
  });
  for (let i = 1; i <= 8; i++) {
    const due = monthDay(-2 + i, 3);
    const isPast = -2 + i < 0;
    const isThisMonth = -2 + i === 0;
    await prisma.payment.create({
      data: {
        ownerId,
        contractId: contractParcelado.id,
        description: `Parcela ${i}/8`,
        amount: dec(3250),
        dueDate: due,
        // parcela 1 (mês passado) paga; parcela deste mês pendente vencida → OVERDUE; futuras PENDING
        status: isPast ? 'PAID' : isThisMonth ? 'OVERDUE' : 'PENDING',
        paidAt: isPast ? due : null,
        method: isPast ? 'PIX' : null,
      },
    });
  }

  // Contrato de pagamento único — Padaria (site institucional, já pago)
  const contractUnico = await prisma.contract.create({
    data: {
      ownerId,
      clientId: padaria.id,
      description: 'Site institucional com cardápio',
      billingType: 'ONE_TIME',
      status: 'FINISHED',
      startDate: day(-70),
    },
  });
  await prisma.payment.create({
    data: {
      ownerId,
      contractId: contractUnico.id,
      description: 'Pagamento único',
      amount: dec(4800),
      dueDate: day(-65),
      status: 'PAID',
      paidAt: day(-64),
      paidAmount: dec(4800),
      method: 'PIX',
    },
  });

  // =====================================================================
  // ATIVIDADES (timeline + follow-ups agendados)
  // =====================================================================
  await prisma.activity.createMany({
    data: [
      {
        ownerId,
        clientId: clinica.id,
        dealId: dealClinicaWon.id,
        typeId: tipoPorEnum('MEETING'),
        content: 'Reunião de kickoff do projeto. Alinhamento de cronograma.',
        completedAt: day(-17),
        createdAt: day(-17),
      },
      {
        ownerId,
        clientId: clinica.id,
        typeId: tipoPorEnum('NOTE'),
        content: 'Cliente pediu prioridade no módulo de agendamento.',
        createdAt: day(-8),
      },
      {
        ownerId,
        clientId: fitness.id,
        typeId: tipoPorEnum('CALL'),
        content: 'Ligação de apresentação. Enviou material por e-mail.',
        completedAt: day(-5),
        createdAt: day(-5),
      },
      {
        ownerId,
        clientId: modaviva.id,
        typeId: tipoPorEnum('EMAIL'),
        content: 'Proposta de tráfego enviada. Aguardando retorno.',
        completedAt: day(-5),
        createdAt: day(-5),
      },
      {
        ownerId,
        clientId: restaurante.id,
        typeId: tipoPorEnum('WHATSAPP'),
        content: 'Primeiro contato via WhatsApp (indicação da Pão Dourado).',
        completedAt: day(-2),
        createdAt: day(-2),
      },
      // Follow-ups agendados (aparecem em "próximas ações" do dashboard)
      {
        ownerId,
        clientId: fitness.id,
        dealId: dealFitness.id,
        typeId: tipoPorEnum('FOLLOW_UP'),
        content: 'Retornar sobre ajustes na proposta do site.',
        scheduledFor: day(1),
        createdAt: day(-5),
      },
      {
        ownerId,
        clientId: modaviva.id,
        dealId: dealModa.id,
        typeId: tipoPorEnum('FOLLOW_UP'),
        content: 'Cobrar aprovação da campanha de Black Friday.',
        scheduledFor: day(2),
        createdAt: day(-5),
      },
      {
        ownerId,
        clientId: imobiliaria.id,
        typeId: tipoPorEnum('FOLLOW_UP'),
        content: 'Confirmar assinatura da proposta do módulo digital.',
        scheduledFor: day(3),
        createdAt: day(-6),
      },
      {
        ownerId,
        clientId: restaurante.id,
        typeId: tipoPorEnum('FOLLOW_UP'),
        content: 'Agendar reunião de diagnóstico.',
        scheduledFor: day(4),
        createdAt: day(-2),
      },
      {
        ownerId,
        clientId: autopecas.id,
        typeId: tipoPorEnum('FOLLOW_UP'),
        content: 'Apresentar proposta de expansão de campanhas.',
        scheduledFor: day(6),
        createdAt: day(-3),
      },
    ],
  });

  console.log('Seed concluído: dataset de demonstração criado para', 'admin@crm.local');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
