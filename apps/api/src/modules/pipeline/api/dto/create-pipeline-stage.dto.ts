import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePipelineStageDto {
  @IsString({ message: 'O nome do estágio é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsOptional()
  @IsBoolean({
    message: 'O campo "estágio de ganho" deve ser verdadeiro ou falso.',
  })
  isWon?: boolean;

  @IsOptional()
  @IsBoolean({
    message: 'O campo "estágio de perda" deve ser verdadeiro ou falso.',
  })
  isLost?: boolean;
}
