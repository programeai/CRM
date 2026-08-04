import { IsEnum, IsUUID } from 'class-validator';
import { ConsentSubjectType } from '@prisma/client';

/** O recorte do histórico. Vem da query porque o titular pode ser dois tipos. */
export class ListConsentQueryDto {
  @IsEnum(ConsentSubjectType, {
    message: 'Tipo de titular inválido: use CLIENT ou CONTACT.',
  })
  subjectType: ConsentSubjectType;

  @IsUUID('4', { message: 'Titular inválido.' })
  subjectId: string;
}
