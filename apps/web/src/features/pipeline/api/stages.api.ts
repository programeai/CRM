import { api } from '@/lib/api';
import type { CreateStageBody, PipelineStage, UpdateStageBody } from './types';

export const stagesApi = {
  list: () => api.get<PipelineStage[]>('/pipeline-stages').then((r) => r.data),
  create: (body: CreateStageBody) =>
    api.post<PipelineStage>('/pipeline-stages', body).then((r) => r.data),
  update: (id: string, body: UpdateStageBody) =>
    api.patch<PipelineStage>(`/pipeline-stages/${id}`, body).then((r) => r.data),
  reorder: (ids: string[]) =>
    api.patch<PipelineStage[]>('/pipeline-stages/reorder', { ids }).then((r) => r.data),
  remove: (id: string) => api.delete(`/pipeline-stages/${id}`).then((r) => r.data),
};
