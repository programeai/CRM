import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class MoveDealDto {
  @IsUUID('4', { message: 'Estágio inválido.' })
  stageId: string;

  @IsInt({ message: 'Posição inválida.' })
  @Min(0, { message: 'Posição inválida.' })
  position: number;

  /**
   * Obrigatoriedade é **condicional** (só quando o estágio destino é `isLost`),
   * então fica no service e responde 422 — não 400. Ver `DealsService.move`.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Motivo de perda inválido.' })
  lostReasonId?: string;
}
