import { api } from '@/lib/api';
import type {
  CatalogItem,
  CatalogKind,
  CreateCatalogItemBody,
  UpdateCatalogItemBody,
} from './types';

export const catalogosApi = {
  list: (kind: CatalogKind, incluirInativos = false) =>
    api
      .get<CatalogItem[]>(`/catalogos/${kind}`, {
        params: incluirInativos ? { incluirInativos: 'true' } : undefined,
      })
      .then((r) => r.data),
  create: (kind: CatalogKind, body: CreateCatalogItemBody) =>
    api.post<CatalogItem>(`/catalogos/${kind}`, body).then((r) => r.data),
  update: (kind: CatalogKind, id: string, body: UpdateCatalogItemBody) =>
    api.patch<CatalogItem>(`/catalogos/${kind}/${id}`, body).then((r) => r.data),
  remove: (kind: CatalogKind, id: string) =>
    api.delete(`/catalogos/${kind}/${id}`).then((r) => r.data),
};
