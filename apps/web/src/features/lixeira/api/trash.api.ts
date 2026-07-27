import { api } from '@/lib/api';
import type { ListTrashParams, Paginated, TrashItem } from './types';

export const trashApi = {
  list: (params: ListTrashParams) =>
    api.get<Paginated<TrashItem>>('/trash', { params }).then((r) => r.data),
};
