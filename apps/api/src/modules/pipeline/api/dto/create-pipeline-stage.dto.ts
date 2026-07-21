import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePipelineStageDto {
  @IsString({ message: 'O nome do estágio é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsOptional() @IsBoolean() isWon?: boolean;
  @IsOptional() @IsBoolean() isLost?: boolean;
}
