import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class MoveDealDto {
  @IsUUID('4', { message: 'Estágio inválido.' })
  stageId: string;

  @IsInt({ message: 'Posição inválida.' })
  @Min(0, { message: 'Posição inválida.' })
  position: number;

  @IsOptional() @IsString() lostReason?: string;
}
