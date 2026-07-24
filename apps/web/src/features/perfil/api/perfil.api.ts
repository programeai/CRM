import { api } from '@/lib/api';

export type Me = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type UpdateProfileBody = {
  name: string;
  email: string;
};

export const perfilApi = {
  me: () => api.get<Me>('/auth/me').then((r) => r.data),
  update: (body: UpdateProfileBody) =>
    api.patch<Me>('/auth/me', body).then((r) => r.data),
};
