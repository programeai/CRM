export const queryKeys = {
  clients: {
    all: ['clients'] as const,
    list: (params: object) => ['clients', 'list', params] as const,
    detail: (id: string) => ['clients', 'detail', id] as const,
    contacts: (clientId: string) => ['clients', clientId, 'contacts'] as const,
  },
  activities: {
    byClient: (clientId: string) => ['activities', 'client', clientId] as const,
  },
  deals: {
    all: ['deals'] as const,
    board: ['deals', 'board'] as const,
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
    list: (params: object) => ['tasks', 'list', params] as const,
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
  },
  clientOptions: (search: string) => ['client-options', search] as const,
} as const;
