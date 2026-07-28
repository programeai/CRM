import { api } from '@/lib/api';
import type { PreviaDeImportacao, RelatorioDeImportacao } from './types';

export const dadosApi = {
  // Não seta `Content-Type` à mão: com `FormData`, o axios/navegador põe o
  // `boundary` sozinho, e sobrescrever quebra o parse do multer.
  previa: (form: FormData) =>
    api.post<PreviaDeImportacao>('/data/import/previa', form).then((r) => r.data),
  importar: (form: FormData) =>
    api.post<RelatorioDeImportacao>('/data/import', form).then((r) => r.data),
};
