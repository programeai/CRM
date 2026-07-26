/**
 * Catálogo de permissões do CRM — **fonte única** consumida por:
 *  - `AccessGuard` / `@RequirePermission()` (autorização das rotas);
 *  - `AccessService` (o papel `system` vale o catálogo inteiro);
 *  - `RolesService` (saneia as chaves recebidas do formulário de papel);
 *  - `GET /permissions` (o front monta o editor de papéis e a navegação com
 *    estes rótulos — nunca duplique os textos em pt-BR no `apps/web`).
 *
 * Owner (dono da workspace) tem todas as chaves por definição; papéis são
 * subconjuntos atribuídos a colaboradores.
 */

/** Categorias do catálogo, na ordem de exibição. */
export const PERMISSION_CATEGORIES = [
  'Clientes',
  'Pipeline',
  'Propostas',
  'Operação',
  'Financeiro',
  'Organização',
] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export interface PermissionMeta {
  /** Chave técnica (ex.: `cliente:gerenciar`). Nunca aparece na interface. */
  key: string;
  /** Nome curto exibido ao usuário. */
  label: string;
  /** O que a permissão concede. */
  description: string;
  category: PermissionCategory;
  /**
   * Permissão aplicada no backend, mas **não** exibida no editor de papéis.
   * Continua válida (não é removida ao salvar um papel) — só some da interface.
   * Serve para chaves que ainda não se quer expor.
   */
  hidden?: boolean;
}

export const PERMISSIONS: readonly PermissionMeta[] = [
  // Clientes — inclui contatos e atividades (timeline), que são client-scoped.
  {
    key: 'cliente:ver',
    label: 'Ver clientes',
    description: 'Consultar a base de clientes, contatos e histórico',
    category: 'Clientes',
  },
  {
    key: 'cliente:gerenciar',
    label: 'Gerenciar clientes',
    description: 'Criar, editar e arquivar clientes, contatos e atividades',
    category: 'Clientes',
  },
  // Pipeline
  {
    key: 'oportunidade:ver',
    label: 'Ver pipeline',
    description: 'Consultar o quadro de oportunidades',
    category: 'Pipeline',
  },
  {
    key: 'oportunidade:gerenciar',
    label: 'Gerenciar oportunidades',
    description: 'Criar, mover, ganhar e perder oportunidades',
    category: 'Pipeline',
  },
  // Propostas
  {
    key: 'proposta:ver',
    label: 'Ver propostas',
    description: 'Consultar propostas e suas versões',
    category: 'Propostas',
  },
  {
    key: 'proposta:gerenciar',
    label: 'Gerenciar propostas',
    description: 'Criar, versionar, enviar e decidir propostas',
    category: 'Propostas',
  },
  // Operação
  {
    key: 'projeto:ver',
    label: 'Ver projetos e demandas',
    description: 'Consultar projetos, quadros e demandas',
    category: 'Operação',
  },
  {
    key: 'projeto:gerenciar',
    label: 'Gerenciar projetos',
    description: 'Criar, editar e encerrar projetos',
    category: 'Operação',
  },
  {
    key: 'demanda:gerenciar',
    label: 'Gerenciar demandas',
    description: 'Criar, mover e concluir as demandas dos projetos',
    category: 'Operação',
  },
  // Financeiro
  {
    key: 'financeiro:ver',
    label: 'Ver financeiro',
    description: 'Consultar contratos, recebimentos e indicadores financeiros',
    category: 'Financeiro',
  },
  {
    key: 'financeiro:gerenciar',
    label: 'Gerenciar financeiro',
    description: 'Criar contratos e registrar recebimentos',
    category: 'Financeiro',
  },
  // Organização
  {
    key: 'colaborador:gerenciar',
    label: 'Gerenciar colaboradores',
    description: 'Convidar, desativar e trocar o papel de colaboradores',
    category: 'Organização',
  },
  {
    key: 'papel:gerenciar',
    label: 'Gerenciar papéis',
    description: 'Criar, editar e excluir papéis e suas permissões',
    category: 'Organização',
  },
  {
    key: 'assinatura:gerenciar',
    label: 'Gerenciar assinatura',
    description: 'Ver e alterar o plano de assinatura do CRM',
    category: 'Organização',
  },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

/** Todas as chaves do catálogo — o que o owner e o papel `system` recebem. */
export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map(
  (p) => p.key,
);

export function isPermissionKey(key: string): key is PermissionKey {
  return BY_KEY.has(key);
}

/**
 * Metadados de uma chave. Para chave desconhecida (ex.: permissão removida do
 * catálogo que sobrou num papel antigo), devolve a própria chave como rótulo em
 * vez de quebrar a renderização.
 */
export function permissionMeta(key: string): PermissionMeta {
  return (
    BY_KEY.get(key) ?? {
      key,
      label: key,
      description: 'Permissão não catalogada',
      category: 'Organização',
    }
  );
}

/** Dedupe + descarta chave fora do catálogo — saneia a entrada dos formulários. */
export function sanitizePermissionKeys(keys: string[]): PermissionKey[] {
  return [...new Set(keys)].filter(isPermissionKey);
}

export interface PermissionGroup {
  category: PermissionCategory;
  permissions: PermissionMeta[];
}

/**
 * Catálogo agrupado por categoria, na ordem de {@link PERMISSION_CATEGORIES}.
 * Chaves `hidden` ficam de fora — continuam válidas, só não são exibidas.
 */
export function permissionCatalog(): PermissionGroup[] {
  return PERMISSION_CATEGORIES.map((category) => ({
    category,
    permissions: PERMISSIONS.filter(
      (p) => p.category === category && !p.hidden,
    ),
  })).filter((group) => group.permissions.length > 0);
}

/** Descarta as chaves `hidden` de uma lista — usado ao exibir um papel. */
export function visiblePermissionKeys(keys: string[]): string[] {
  return keys.filter((key) => !BY_KEY.get(key)?.hidden);
}
