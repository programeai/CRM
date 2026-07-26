import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Troca de papel e/ou ativação-desativação. Os dois campos são opcionais. */
export class UpdateCollaboratorDto {
  @IsOptional()
  @IsUUID('4', { message: 'Selecione um papel válido.' })
  roleId?: string;

  @IsOptional()
  @IsBoolean({ message: 'Situação inválida.' })
  active?: boolean;
}
