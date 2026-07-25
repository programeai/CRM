import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

/**
 * Liveness da API, usado pelo healthcheck do container em produção
 * (docker-compose.prod.yml). Deliberadamente não toca o banco: o objetivo é
 * dizer se o processo Nest está de pé e respondendo, não se as dependências
 * estão saudáveis — a ordem de subida do Postgres já é tratada pelo
 * `depends_on: service_healthy` do compose.
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }
}
