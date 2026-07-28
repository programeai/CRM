import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/public.decorator';
import { LeadsIntakeService } from '../application/leads-intake.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import { LeadIntakeTokenGuard } from './lead-intake-token.guard';

/**
 * Porta de entrada dos leads capturados fora do CRM.
 *
 * `@Public()` desliga o `JwtAuthGuard` — quem chama é um servidor, não uma
 * sessão — e o `LeadIntakeTokenGuard` volta a fechar a rota com o token da
 * integração. As duas linhas andam juntas: `@Public()` sem o guard abaixo
 * publicaria uma rota de escrita na internet.
 *
 * Rate limit de 30/min por IP: a captação legítima é de unidades por dia, e o
 * teto existe para que um formulário em laço (ou um robô que passe pela
 * armadilha do site) não gere mil cadastros antes de alguém perceber.
 */
@Controller('leads')
export class LeadsIntakeController {
  constructor(private readonly service: LeadsIntakeService) {}

  @Public()
  @UseGuards(LeadIntakeTokenGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('intake')
  // 200, não 201: a ingestão pode ter atualizado um cadastro que já existia, e é
  // o campo `status` da resposta que diz qual dos dois aconteceu.
  @HttpCode(200)
  receber(@Body() dto: IntakeLeadDto) {
    return this.service.receber(dto);
  }
}
