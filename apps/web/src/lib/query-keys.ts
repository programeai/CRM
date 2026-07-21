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
} as const;
