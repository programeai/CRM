import { api } from '@/lib/api';
import type {
  CatalogItem,
  CatalogKind,
  CreateCatalogItemBody,
  DeleteCatalogItemResult,
} from './types';

/** Três operações, sem `PATCH`: a API de catálogo não edita item nenhum. */
export const catalogosApi = {
  list: (kind: CatalogKind) =>
    api.get<CatalogItem[]>(`/catalogos/${kind}`).then((r) => r.data),
  create: (kind: CatalogKind, body: CreateCatalogItemBody) =>
    api.post<CatalogItem>(`/catalogos/${kind}`, body).then((r) => r.data),
  remove: (kind: CatalogKind, id: string) =>
    api
      .delete<DeleteCatalogItemResult>(`/catalogos/${kind}/${id}`)
      .then((r) => r.data),
};
