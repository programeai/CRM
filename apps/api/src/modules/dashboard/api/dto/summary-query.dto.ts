import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class SummaryQueryDto {
  /** Alternador "Somente meus" — recorta os blocos ao usuário logado. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean({ message: 'Filtro "somente meus" inválido.' })
  onlyMine?: boolean;
}
