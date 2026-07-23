import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { ProjectStatus } from '@prisma/client';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['clientId', 'proposalId'] as const),
) {
  @IsOptional()
  @IsEnum(ProjectStatus, { message: 'Status inválido.' })
  status?: ProjectStatus;
}
