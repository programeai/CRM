import { IsEmail, IsString, IsUUID, Length } from 'class-validator';

export class CreateCollaboratorDto {
  @IsString({ message: 'Informe o nome do colaborador.' })
  @Length(2, 120, { message: 'O nome deve ter entre 2 e 120 caracteres.' })
  name: string;

  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @IsUUID('4', { message: 'Selecione um papel válido.' })
  roleId: string;
}
