import { Injectable } from '@nestjs/common';
import type { UserTotp } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MAX_FALHAS, TRAVA_MINUTOS } from './totp.constants';
import type { DadosDoSegredo, TotpRepository } from './totp.repository';

/**
 * `PrismaService.db` — e não o client admin — porque `UserTotp` e
 * `UserTotpRecoveryCode` estão **fora do RLS**: funcionam tanto em rota
 * autenticada (dentro da transação do interceptor) quanto em rota `@Public()`
 * (fora dela, pelo client base). É a mesma propriedade de `Session`, e é o que
 * permite o login — que é público — verificar o segundo fator.
 */
@Injectable()
export class PrismaTotpRepository implements TotpRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(userId: string): Promise<UserTotp | null> {
    return this.prisma.db.userTotp.findUnique({ where: { userId } });
  }

  upsertSegredo(userId: string, dados: DadosDoSegredo): Promise<UserTotp> {
    return this.prisma.db.userTotp.upsert({
      where: { userId },
      create: { userId, ...dados },
      // Recomeçar o cadastro zera tudo: um segredo não confirmado não vale nada,
      // e carregar contador de falha do segredo anterior seria só confusão.
      update: {
        ...dados,
        confirmedAt: null,
        lastUsedStep: null,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  async confirmar(userId: string, quando: Date): Promise<void> {
    await this.prisma.db.userTotp.update({
      where: { userId },
      data: { confirmedAt: quando },
    });
  }

  async registrarSucesso(userId: string, passo: bigint): Promise<void> {
    await this.prisma.db.userTotp.update({
      where: { userId },
      // Sucesso zera o placar de falhas — a NIST rev 4 pede isso explicitamente.
      data: { lastUsedStep: passo, failedAttempts: 0, lockedUntil: null },
    });
  }

  async registrarFalha(
    userId: string,
  ): Promise<Pick<UserTotp, 'failedAttempts' | 'lockedUntil'>> {
    const atualizado = await this.prisma.db.userTotp.update({
      where: { userId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true, lockedUntil: true },
    });
    /*
      A trava é decidida DEPOIS do incremento, com o valor REAL do banco: decidir
      antes de ir ao banco abriria corrida entre duas tentativas simultâneas.
    */
    if (atualizado.failedAttempts >= MAX_FALHAS && !atualizado.lockedUntil) {
      return this.prisma.db.userTotp.update({
        where: { userId },
        data: { lockedUntil: new Date(Date.now() + TRAVA_MINUTOS * 60_000) },
        select: { failedAttempts: true, lockedUntil: true },
      });
    }
    return atualizado;
  }

  async apagar(userId: string): Promise<void> {
    /*
      Os DOIS, à mão. `UserTotpRecoveryCode.userId` referencia `User`, e não
      `UserTotp` — então apagar o segredo NÃO leva os códigos por cascata, e
      deixá-los no banco deixaria 16 credenciais de acesso completo à conta
      órfãs. (Sem `confirmedAt` elas não são aceitas, mas material de credencial
      que não serve mais não fica guardado.)

      `deleteMany` e não `delete`: apagar o que não existe não é erro aqui — a
      tela pode pedir para desligar um 2FA que outra aba já desligou.
    */
    await this.prisma.db.userTotpRecoveryCode.deleteMany({ where: { userId } });
    await this.prisma.db.userTotp.deleteMany({ where: { userId } });
  }

  async substituirCodigos(userId: string, hashes: string[]): Promise<void> {
    await this.prisma.db.userTotpRecoveryCode.deleteMany({ where: { userId } });
    await this.prisma.db.userTotpRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    });
  }

  contarCodigosDisponiveis(userId: string): Promise<number> {
    return this.prisma.db.userTotpRecoveryCode.count({
      where: { userId, usedAt: null },
    });
  }

  async consumirCodigo(userId: string, codeHash: string): Promise<boolean> {
    // Compare-and-swap, como `prisma-invite.repository.ts`: o `usedAt: null` no
    // `where` é o que faz dois usos simultâneos do mesmo código resultarem em um.
    const { count } = await this.prisma.db.userTotpRecoveryCode.updateMany({
      where: { userId, codeHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }
}
