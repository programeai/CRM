import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class ReorderStagesDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Informe a ordem dos estágios.' })
  @IsUUID('4', { each: true, message: 'Estágio inválido.' })
  ids: string[];
}
