import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PaymentsService } from '../application/payments.service';
import { CurrentOwnerId } from '../../../shared/current-user.decorator';
import { RequirePermission } from '../../access/require-permission.decorator';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { PaymentSummaryQueryDto } from './dto/payment-summary-query.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PayPaymentDto } from './dto/pay-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermission('financeiro:ver', 'financeiro:gerenciar')
  @Get()
  list(
    @CurrentOwnerId() ownerId: string,
    @Query() query: ListPaymentsQueryDto,
  ) {
    return this.payments.list(ownerId, query);
  }

  @RequirePermission('financeiro:ver', 'financeiro:gerenciar')
  @Get('summary')
  summary(
    @CurrentOwnerId() ownerId: string,
    @Query() query: PaymentSummaryQueryDto,
  ) {
    return this.payments.summary(ownerId, query);
  }

  @RequirePermission('financeiro:gerenciar')
  @Patch(':id')
  update(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.payments.update(ownerId, id, dto);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post(':id/pay')
  pay(
    @CurrentOwnerId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: PayPaymentDto,
  ) {
    return this.payments.pay(ownerId, id, dto);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post(':id/revert')
  revert(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.payments.revert(ownerId, id);
  }

  @RequirePermission('financeiro:gerenciar')
  @Post(':id/cancel')
  cancel(@CurrentOwnerId() ownerId: string, @Param('id') id: string) {
    return this.payments.cancel(ownerId, id);
  }
}
