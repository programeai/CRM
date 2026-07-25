/**
 * Logger do Nest que escreve JSON em vez do formato colorido de console.
 *
 * Instalado no bootstrap (`main.ts`), passa a valer para **tudo**: as mensagens
 * do próprio framework e todo `new Logger(Classe.name)` já existente no código.
 * Nada precisa ser reescrito para virar pesquisável.
 *
 * Como logar com campos (forma preferida em código novo):
 *
 * ```ts
 * this.logger.log({ evento: 'financeiro.mensalidades_geradas', quantidade: 12 });
 * this.logger.error({ evento: 'email.falhou', destinatario }, erro.stack);
 * ```
 *
 * Passar uma string continua funcionando — só entra como `msg`, sem `evento`.
 */
import type { LoggerService } from '@nestjs/common';
import { registrarLog, type CamposLog, type NivelLog } from './log';

/** Heurística para distinguir um stack trace de um nome de contexto. */
function pareceStack(texto: string): boolean {
  return texto.includes('\n') && /\n\s+at /.test(texto);
}

export class JsonLogger implements LoggerService {
  log(message: unknown, ...params: unknown[]): void {
    this.emitir('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.emitir('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emitir('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emitir('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emitir('debug', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.emitir('error', message, params);
  }

  /**
   * Reconstrói uma linha estruturada a partir da assinatura variádica do Nest.
   * O framework anexa o contexto (`new Logger('MailService')`) como último
   * parâmetro e o `error()` costuma receber o stack no meio — daí a separação
   * por tipo/forma em vez de por posição fixa.
   */
  private emitir(nivel: NivelLog, message: unknown, params: unknown[]): void {
    const campos: CamposLog = {};
    const textos: string[] = [];
    let stack: string | undefined;
    let contexto: string | undefined;

    if (message instanceof Error) {
      textos.push(message.message);
      stack ??= message.stack;
    } else if (message !== null && typeof message === 'object') {
      Object.assign(campos, message);
    } else {
      textos.push(String(message));
    }

    params.forEach((param, indice) => {
      const ultimo = indice === params.length - 1;
      if (param instanceof Error) {
        textos.push(param.message);
        stack ??= param.stack;
        return;
      }
      if (typeof param === 'string') {
        if (pareceStack(param)) {
          stack ??= param;
          return;
        }
        if (ultimo) {
          contexto = param;
          return;
        }
        textos.push(param);
        return;
      }
      if (param !== null && typeof param === 'object') {
        Object.assign(campos, param);
      }
    });

    const msg = [campos.msg, ...textos].filter(Boolean).join(' ') || undefined;
    registrarLog(nivel, { ...campos, msg, contexto, stack });
  }
}
