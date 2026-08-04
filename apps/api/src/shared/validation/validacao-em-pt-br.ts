import {
  BadRequestException,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * As mensagens de erro que o FRAMEWORK gera, traduzidas.
 *
 * As mensagens de campo vivem nos DTOs, uma por validador (`@IsString({ message
 * })`) — regra do `CLAUDE.md`, e é lá que elas devem nascer. O que sobra aqui é
 * o que nenhum DTO alcança: o texto que o `ValidationPipe` e o `ParseUUIDPipe`
 * montam sozinhos, e que sairia em inglês na resposta.
 *
 * Importa porque a rota pública de ingestão de lead (`POST /leads/intake`)
 * responde direto a um sistema de terceiro: a mensagem é o único retorno que
 * quem integra tem para descobrir o que reprovou.
 */

/** Reescreve a mensagem do `forbidNonWhitelisted`, preservando os filhos. */
function traduzirRegrasDoFramework(
  erros: ValidationError[],
): ValidationError[] {
  return erros.map((erro) => {
    const constraints = erro.constraints && {
      ...erro.constraints,
      ...(erro.constraints.whitelistValidation && {
        whitelistValidation: `O campo ${erro.property} não é aceito nesta rota.`,
      }),
    };
    return {
      ...erro,
      constraints,
      children: erro.children && traduzirRegrasDoFramework(erro.children),
    };
  });
}

/**
 * O `ValidationPipe` global. Só troca o texto do `whitelistValidation` — o
 * achatamento (inclusive o prefixo `pai.filho` dos objetos aninhados) continua
 * sendo o do Nest, de propósito: reimplementá-lo mudaria a forma da resposta de
 * toda rota que valida objeto aninhado (item de proposta, checklist de demanda).
 */
export class ValidationPipeEmPtBr extends ValidationPipe {
  protected flattenValidationErrors(
    validationErrors: ValidationError[],
  ): string[] {
    return super.flattenValidationErrors(
      traduzirRegrasDoFramework(validationErrors),
    );
  }
}

/**
 * `:id` de rota. Instância única (em vez da classe `ParseUUIDPipe`) porque é o
 * que permite passar a mensagem — o default é
 * "Validation failed (uuid is expected)".
 *
 * Sem `version`: a classe crua também não fixa versão, e travar em v4 aqui
 * mudaria o que já é aceito hoje.
 */
export const idDeRota = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Identificador inválido.'),
});
