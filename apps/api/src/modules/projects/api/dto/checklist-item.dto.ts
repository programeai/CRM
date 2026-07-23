import { IsBoolean, IsString, MinLength } from 'class-validator';

export class ChecklistItemDto {
  @IsString({ message: 'O texto do item é obrigatório.' })
  @MinLength(1, { message: 'O texto do item é obrigatório.' })
  text: string;

  @IsBoolean({ message: 'Valor inválido.' })
  done: boolean;
}
