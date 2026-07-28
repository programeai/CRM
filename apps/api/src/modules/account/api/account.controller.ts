import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { OwnerOnly } from '../../access/owner-only.decorator';
import { AllowWithoutSubscription } from '../../billing/allow-without-subscription.decorator';
import { AccountExportService } from '../application/account-export.service';
import { AccountDeletionService } from '../application/account-deletion.service';
import { RequestDeletionDto } from './dto/request-deletion.dto';

@Controller('account')
export class AccountController {
  constructor(
    private readonly exportar: AccountExportService,
    private readonly encerramento: AccountDeletionService,
  ) {}

  /**
   * Portabilidade (LGPD art. 18, V e art. 19, § 3º). `@OwnerOnly()` porque o dump
   * é da workspace inteira; `@AllowWithoutSubscription()` porque a Política
   * promete o direito "a qualquer momento e sem custo" — sem isso, o BillingGuard
   * responderia 402 justamente a quem quer levar os dados e sair.
   *
   * Throttle apertado: é a rota mais cara da API por chamada.
   */
  @OwnerOnly()
  @AllowWithoutSubscription()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('export')
  export(@CurrentOwnerId() ownerId: string): Promise<StreamableFile> {
    return this.exportar.gerar(ownerId);
  }

  /**
   * Pede o encerramento (LGPD art. 18, VI e Termos § "Suspensão e
   * encerramento"). Não apaga nada agora: agenda para
   * `CARENCIA_DE_ENCERRAMENTO_DIAS` dias e devolve a data.
   */
  @OwnerOnly()
  @AllowWithoutSubscription()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('deletion')
  solicitarEncerramento(
    @CurrentOwnerId() ownerId: string,
    @Body() dto: RequestDeletionDto,
  ) {
    return this.encerramento.solicitar(ownerId, dto);
  }

  /** Cancela o encerramento agendado, dentro da janela de carência. */
  @OwnerOnly()
  @AllowWithoutSubscription()
  @Delete('deletion')
  async cancelarEncerramento(@CurrentOwnerId() ownerId: string) {
    await this.encerramento.cancelar(ownerId);
    return { ok: true };
  }
}
