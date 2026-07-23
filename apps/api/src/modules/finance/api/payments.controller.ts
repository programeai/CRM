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
import { CurrentUserId } from '../../../shared/current-user.decorator';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { PaymentSummaryQueryDto } from './dto/payment-summary-query.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PayPaymentDto } from './dto/pay-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get() list(
    @CurrentUserId() ownerId: string,
    @Query() query: ListPaymentsQueryDto,
  ) {
    return this.payments.list(ownerId, query);
  }

  @Get('summary') summary(
    @CurrentUserId() ownerId: string,
    @Query() query: PaymentSummaryQueryDto,
  ) {
    return this.payments.summary(ownerId, query);
  }

  @Patch(':id') update(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.payments.update(ownerId, id, dto);
  }

  @Post(':id/pay') pay(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
    @Body() dto: PayPaymentDto,
  ) {
    return this.payments.pay(ownerId, id, dto);
  }

  @Post(':id/revert') revert(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.payments.revert(ownerId, id);
  }

  @Post(':id/cancel') cancel(
    @CurrentUserId() ownerId: string,
    @Param('id') id: string,
  ) {
    return this.payments.cancel(ownerId, id);
  }
}
