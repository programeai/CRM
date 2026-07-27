export const queryKeys = {
  clients: {
    all: ['clients'] as const,
    list: (params: object) => ['clients', 'list', params] as const,
    detail: (id: string) => ['clients', 'detail', id] as const,
    contacts: (clientId: string) => ['clients', clientId, 'contacts'] as const,
    tags: ['clients', 'tags'] as const,
    tagUsage: (tag: string) => ['clients', 'tags', 'usage', tag] as const,
  },
  activities: {
    byClient: (clientId: string) => ['activities', 'client', clientId] as const,
  },
  deals: {
    all: ['deals'] as const,
    board: (params: object = {}) => ['deals', 'board', params] as const,
    byClient: (clientId: string) => ['deals', 'client', clientId] as const,
  },
  stages: {
    all: ['stages'] as const,
  },
  proposals: {
    all: ['proposals'] as const,
    list: (params: object) => ['proposals', 'list', params] as const,
    detail: (id: string) => ['proposals', 'detail', id] as const,
    versions: (id: string) => ['proposals', 'versions', id] as const,
    byClient: (clientId: string) => ['proposals', 'client', clientId] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: (params: object) => ['projects', 'list', params] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
    byClient: (clientId: string) => ['projects', 'client', clientId] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    board: (projectId: string) => ['tasks', 'board', projectId] as const,
    myBoard: (params: object = {}) => ['tasks', 'board', 'me', params] as const,
    list: (params: object) => ['tasks', 'list', params] as const,
    tags: ['tasks', 'tags'] as const,
    tagUsage: (tag: string) => ['tasks', 'tags', 'usage', tag] as const,
  },
  contracts: {
    all: ['contracts'] as const,
    list: (params: object) => ['contracts', 'list', params] as const,
    detail: (id: string) => ['contracts', 'detail', id] as const,
    byClient: (clientId: string) => ['contracts', 'client', clientId] as const,
  },
  payments: {
    all: ['payments'] as const,
    list: (params: object) => ['payments', 'list', params] as const,
    summary: (params: object) => ['payments', 'summary', params] as const,
  },
  dashboard: {
    summary: (params: object = {}) => ['dashboard', 'summary', params] as const,
    finance: (month?: string) => ['dashboard', 'finance', month ?? 'current'] as const,
  },
  billing: {
    status: ['billing', 'status'] as const,
  },
  collaborators: {
    all: ['collaborators'] as const,
  },
  roles: {
    all: ['roles'] as const,
  },
  permissions: {
    catalog: ['permissions', 'catalog'] as const,
  },
  audit: {
    all: ['audit'] as const,
    list: (params: object) => ['audit', 'list', params] as const,
    byEntity: (entity: string, id: string) =>
      ['audit', 'entity', entity, id] as const,
  },
  invites: {
    detail: (token: string) => ['invites', token] as const,
  },
  clientOptions: (search: string) => ['client-options', search] as const,
  workspaceMembers: ['workspace', 'members'] as const,
  auth: {
    oauthProviders: ['auth', 'oauth-providers'] as const,
    registration: ['auth', 'registration'] as const,
    me: ['auth', 'me'] as const,
    sessions: ['auth', 'sessions'] as const,
  },
} as const;
