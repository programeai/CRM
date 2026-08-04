import { SetMetadata } from '@nestjs/common';
import type { IntegrationScope } from '../../integracoes/domain/integration-scope';

export const ESCOPO_EXIGIDO = 'escopoExigido';

/** O escopo que a rota exige da chave. Lido pelo `PublicApiKeyGuard`. */
export const EscopoExigido = (escopo: IntegrationScope) =>
  SetMetadata(ESCOPO_EXIGIDO, escopo);
