import type { SectionTabItem } from '@/components/ui/section-tabs';

/**
 * As abas de Administração — tudo que é configuração **da workspace**, e não da
 * própria conta (essa é `/configuracoes`, no menu do avatar).
 *
 * Esta lista é a fonte única da navegação: `app/nav.ts` deriva daqui a
 * permissão do item de sidebar e `routes/router.tsx` deriva a guarda da
 * rota-mãe. Cada rota-filha mantém a própria `PermissionRoute` com a chave
 * exata — a autoridade continua sendo o backend.
 *
 * O título e a descrição de cada aba ficam na tela correspondente, via
 * `SectionHeading`: é lá que mora a ação principal, que precisa nascer na mesma
 * linha do título.
 */
export const ADMIN_TABS: SectionTabItem[] = [
  {
    label: 'Colaboradores',
    to: '/administracao/colaboradores',
    permission: ['colaborador:gerenciar'],
  },
  {
    label: 'Papéis',
    to: '/administracao/papeis',
    permission: ['papel:gerenciar'],
  },
  // Nenhum dos quatro catálogos (serviços, fontes de lead, tipos de atividade,
  // motivos de perda) tem aba: todos nascem e morrem dentro do `CatalogSelect`,
  // no formulário em que fazem falta. Tipos de atividade foi o último a sair,
  // quando 'Follow-up' virou tipo primitivo — sem marca para mover, não sobrou
  // regra a configurar aqui.
  {
    label: 'Importação',
    to: '/administracao/importacao',
    permission: ['dados:importar'],
  },
  {
    label: 'Captação',
    to: '/administracao/captacao',
    permission: ['integracao:gerenciar'],
  },
  {
    label: 'API',
    to: '/administracao/api',
    permission: ['integracao:gerenciar'],
  },
  {
    label: 'Webhooks',
    to: '/administracao/webhooks',
    permission: ['webhook:gerenciar'],
  },
  {
    label: 'Auditoria',
    to: '/administracao/auditoria',
    permission: ['auditoria:ver'],
  },
  {
    label: 'Lixeira',
    to: '/administracao/lixeira',
    permission: ['lixeira:ver'],
  },
];

/** Basta uma destas para a seção existir para a pessoa. */
export const ADMIN_PERMISSIONS = ADMIN_TABS.flatMap(
  (tab) => tab.permission ?? [],
);
