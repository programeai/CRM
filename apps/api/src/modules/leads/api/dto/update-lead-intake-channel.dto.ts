import { PartialType } from '@nestjs/mapped-types';
import { CreateLeadIntakeChannelDto } from './create-lead-intake-channel.dto';

/** Os mesmos campos, todos opcionais. A chave não se edita: rotaciona-se. */
export class UpdateLeadIntakeChannelDto extends PartialType(
  CreateLeadIntakeChannelDto,
) {}
