import { IsEnum, IsInt, Min } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class MoveTaskDto {
  @IsEnum(TaskStatus, { message: 'Status inválido.' })
  status: TaskStatus;

  @IsInt({ message: 'Posição inválida.' })
  @Min(0, { message: 'Posição inválida.' })
  position: number;
}
