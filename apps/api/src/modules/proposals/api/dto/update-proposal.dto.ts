import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateProposalDto } from './create-proposal.dto';

export class UpdateProposalDto extends PartialType(
  OmitType(CreateProposalDto, ['clientId', 'dealId'] as const),
) {}
