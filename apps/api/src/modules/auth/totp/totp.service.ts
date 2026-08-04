import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import { NodeCryptoPlugin } from '@otplib/plugin-crypto-node';
import { toDataURL } from 'qrcode';
import {
  cifrarSegredo,
  decifrarSegredo,
} from '../../../shared/crypto/segredo-cifrado';
import {
  BYTES_DO_CODIGO,
  EMISSOR,
  MAX_FALHAS,
  QUANTIDADE_DE_CODIGOS,
  TOLERANCIA_SEGUNDOS,
  TRAVA_MINUTOS,
} from './totp.constants';
import { TOTP_REPOSITORY, type TotpRepository } from './totp.repository';

/** O que a tela de Segurança precisa saber. */
export interface StatusDoSegundoFator {
  /** `false` = a instância não tem `TOTP_ENCRYPTION_KEY`: 2FA indisponível aqui. */
  disponivel: boolean;
  /** `true` = o usuário confirmou o autenticador e o login vai exigir código. */
  ativo: boolean;
  codigosRestantes: number;
}

/** O material do cadastro. Os três são o MESMO segredo, em codificações diferentes. */
export interface CadastroIniciado {
  /** PNG em `data:` URI, para um `<img>`. */
  qrDataUrl: string;
  uri: string;
  segredoBase32: string;
}

/**
 * Segundo fator TOTP. Cinco responsabilidades, e três delas **não** vêm de
 * biblioteca nenhuma:
 *
 *  1. **Segredo cifrado em repouso** — AES-256-GCM com `keyVersion`. TOTP é HMAC
 *     simétrico: hash é impossível por construção.
 *  2. **Replay** — código aceito grava `lastUsedStep`, e passo menor ou igual é
 *     recusado. Normativo (RFC 6238 §5.2; NIST SP 800-63B), e a própria doc do
 *     `otplib` diz que a biblioteca é *stateless* e não faz isso.
 *  3. **Limite por conta** — `failedAttempts`/`lockedUntil`. O `@Throttle` limita
 *     por IP; isto limita a CONTA, que é o que a norma pede.
 *  4. **Códigos de recuperação** — consumo por *compare-and-swap*, e não o
 *     *check-then-act* do `PasswordResetToken`: dois usos simultâneos do mesmo
 *     código passariam.
 *  5. **Serviço opcional** — sem `TOTP_ENCRYPTION_KEY` o 2FA está desligado na
 *     instância, e `isEnabled()` responde por isso (mesmo contrato de
 *     `MailService`/`CaptchaService`).
 *
 * O `otpauth://` URI e o segredo em base32 **nunca** entram em log: são o segredo
 * inteiro em texto (aviso explícito da doc do `otplib`, e da OWASP Logging).
 *
 * **Nota de build:** o bundle CJS do `otplib` v13 não inlina as dependências —
 * ele faz `require('@scure/base')`, que é ESM-only. Em runtime funciona porque o
 * `require(esm)` do Node ≥20.19/≥22.12 está ligado (o deploy roda Node 24), mas o
 * Jest precisa transformar esses pacotes: é o que faz o `transformIgnorePatterns`
 * de `package.json` e de `test/jest-e2e.json` abrir exceção para `@scure/base`,
 * `@noble/hashes`, `otplib` e `@otplib/*`. Trocar por `otpauth` (CJS-puro)
 * dispensaria isso e tocaria só `iniciar` e `verificar`.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);

  /**
   * O crypto do `node:crypto`, explícito. O default do `otplib` v13 é o
   * `@noble/hashes` puro-JS; a matriz de compatibilidade do próprio projeto marca
   * este plugin como *"Recommended"* em Node, e ele é o que usa o HMAC nativo.
   * Instância única: o plugin não guarda estado por chamada.
   */
  private readonly crypto = new NodeCryptoPlugin();

  constructor(
    @Inject(TOTP_REPOSITORY) private readonly repo: TotpRepository,
    private readonly config: ConfigService,
  ) {}

  /** A instância tem chave de cifra? Sem ela, 2FA não existe aqui. */
  isEnabled(): boolean {
    return this.chave().length > 0;
  }

  async status(userId: string): Promise<StatusDoSegundoFator> {
    if (!this.isEnabled()) {
      return { disponivel: false, ativo: false, codigosRestantes: 0 };
    }
    const totp = await this.repo.find(userId);
    const ativo = Boolean(totp?.confirmedAt);
    return {
      disponivel: true,
      ativo,
      codigosRestantes: ativo
        ? await this.repo.contarCodigosDisponiveis(userId)
        : 0,
    };
  }

  /**
   * Gera o segredo, grava **cifrado** com `confirmedAt: null` e devolve o QR.
   *
   * **Não liga o 2FA** — só `confirmar` liga, e só com um código válido. Sem essa
   * separação, um QR que a pessoa não conseguiu ler trancaria a conta dela.
   */
  async iniciar(userId: string, email: string): Promise<CadastroIniciado> {
    this.assertDisponivel();
    // `generateSecret` é SÍNCRONO no otplib v13 (devolve a string base32 direto),
    // ao contrário de `generate`/`verify`. Sem `await`, de propósito.
    const segredo = generateSecret();
    const uri = generateURI({ secret: segredo, label: email, issuer: EMISSOR });
    await this.repo.upsertSegredo(userId, cifrarSegredo(segredo, this.chave()));
    this.logger.log({
      evento: 'mfa.cadastro_iniciado',
      msg: 'Cadastro de segundo fator iniciado.',
      usuarioId: userId,
      // NUNCA o segredo nem o URI: os dois são o segredo inteiro em texto.
    });
    return {
      // QR gerado no SERVIDOR porque o front não tem encoder. Não é uma medida de
      // segurança: o QR e a string base32 são o mesmo segredo em duas
      // codificações, e a entrada manual é prática universal (GitHub, AWS).
      qrDataUrl: await toDataURL(String(uri)),
      uri: String(uri),
      segredoBase32: segredo,
    };
  }

  /**
   * Confirma com um código válido → liga o 2FA e emite os códigos de
   * recuperação, uma única vez.
   */
  async confirmar(
    userId: string,
    codigo: string,
  ): Promise<{ codigosDeRecuperacao: string[] }> {
    this.assertDisponivel();
    const totp = await this.repo.find(userId);
    if (!totp) {
      throw new UnprocessableEntityException(
        'Comece o cadastro do segundo fator antes de confirmar.',
      );
    }
    if (!(await this.verificar(userId, codigo))) {
      throw new UnprocessableEntityException(
        'Código inválido. Confira o app autenticador e tente de novo.',
      );
    }
    await this.repo.confirmar(userId, new Date());
    this.logger.warn({
      evento: 'mfa.ativado',
      msg: 'Segundo fator ativado pelo titular.',
      usuarioId: userId,
    });
    return { codigosDeRecuperacao: await this.gerarCodigos(userId) };
  }

  /**
   * Verifica um código TOTP. Aplica, nesta ordem: trava por conta, janela de
   * drift, anti-replay. Devolve `false` em vez de lançar — quem chama decide se
   * o "não" é 401 (login) ou 422 (confirmação).
   *
   * A trava vem PRIMEIRO de propósito: conta travada não deve nem gastar CPU
   * verificando, e não deve aceitar código correto (senão a trava não trava).
   */
  async verificar(userId: string, codigo: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    /*
      Formato antes de tudo, e **sem contar falha**: o `otplib` LANÇA
      `TokenLengthError` em token que não tem 6 dígitos, e o login tenta
      `verificar(codigo) || consumirCodigoDeRecuperacao(codigo)` com o mesmo
      valor — um código de recuperação (17 caracteres) chegava aqui e virava 500
      em vez de cair no segundo caminho.

      Não conta como falha de TOTP porque não é uma tentativa de TOTP: quem manda
      um código de recuperação não errou o autenticador. Se o valor também não for
      um código de recuperação válido, é o `consumirCodigoDeRecuperacao` que
      registra a falha.
    */
    if (!/^\d{6}$/.test(codigo)) return false;
    const totp = await this.repo.find(userId);
    if (!totp) return false;

    if (totp.lockedUntil && totp.lockedUntil > new Date()) {
      this.logger.warn({
        evento: 'mfa.conta_travada',
        msg: 'Verificação de segundo fator recusada: conta travada por tentativas falhas.',
        usuarioId: userId,
        travadaAte: totp.lockedUntil.toISOString(),
      });
      return false;
    }

    const resultado = await verify({
      secret: decifrarSegredo(totp, this.chave()),
      token: codigo,
      crypto: this.crypto,
      // Um passo para cada lado (RFC 6238 §5.2). O default do otplib é ZERO.
      epochTolerance: TOLERANCIA_SEGUNDOS,
      /*
        Anti-replay pelo limite inferior EXCLUSIVO: o `otplib` recusa qualquer
        passo <= `afterTimeStep`. É a metade que a biblioteca oferece; a outra
        (persistir o passo) é a coluna `lastUsedStep`.
      */
      ...(totp.lastUsedStep !== null
        ? { afterTimeStep: Number(totp.lastUsedStep) }
        : {}),
    });

    if (!resultado.valid) {
      await this.registrarFalha(userId);
      return false;
    }
    /*
      O `verify` funcional do otplib serve TOTP e HOTP, e só o resultado de TOTP
      carrega `timeStep` — daí o `in` em vez de acessar direto. Na prática é
      sempre o de TOTP (é a estratégia default), e sem o passo não há como gravar
      o anti-replay: por isso o `else` é um erro alto, não um sucesso silencioso.
    */
    if (!('timeStep' in resultado)) {
      throw new Error(
        'Verificação de TOTP sem timeStep: impossível gravar a defesa de replay.',
      );
    }
    await this.repo.registrarSucesso(userId, BigInt(resultado.timeStep));
    return true;
  }

  /** Consome um código de recuperação (compare-and-swap). */
  async consumirCodigoDeRecuperacao(
    userId: string,
    codigo: string,
  ): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const totp = await this.repo.find(userId);
    // Sem 2FA confirmado não há código de recuperação a consumir.
    if (!totp?.confirmedAt) return false;
    if (totp.lockedUntil && totp.lockedUntil > new Date()) return false;

    // Normaliza como a tela exibe: grupos separados por hífen, caixa alta.
    const ok = await this.repo.consumirCodigo(
      userId,
      this.hash(codigo.trim().toUpperCase().replace(/\s+/g, '')),
    );
    if (!ok) {
      await this.registrarFalha(userId);
      return false;
    }
    /*
      Código de recuperação usado com sucesso também zera o placar de falhas: ele
      É uma prova de posse aceita, e manter a conta a um passo da trava depois de
      uma recuperação bem-sucedida puniria quem acabou de se autenticar.
    */
    await this.repo.registrarSucesso(userId, totp.lastUsedStep ?? BigInt(0));
    this.logger.warn({
      evento: 'mfa.codigo_de_recuperacao_usado',
      msg: 'Segundo fator provado por código de recuperação.',
      usuarioId: userId,
      restantes: await this.repo.contarCodigosDisponiveis(userId),
    });
    return true;
  }

  /** Regenera os 16 códigos, invalidando os antigos. */
  async regenerarCodigos(
    userId: string,
  ): Promise<{ codigosDeRecuperacao: string[] }> {
    this.assertDisponivel();
    const totp = await this.repo.find(userId);
    if (!totp?.confirmedAt) {
      throw new UnprocessableEntityException(
        'Ative o segundo fator antes de gerar códigos de recuperação.',
      );
    }
    return { codigosDeRecuperacao: await this.gerarCodigos(userId) };
  }

  /** Desliga: apaga o segredo e todos os códigos de recuperação. */
  async desativar(userId: string): Promise<void> {
    await this.repo.apagar(userId);
    this.logger.warn({
      evento: 'mfa.desativado',
      msg: 'Segundo fator desativado pelo titular.',
      usuarioId: userId,
    });
  }

  /**
   * `true` se o usuário exige segundo fator no login. É o único ponto que o
   * `AuthService` consulta antes de emitir sessão.
   *
   * `confirmedAt` — nunca "existe linha de `UserTotp`" — é o que responde isso:
   * um cadastro iniciado e não concluído não pode trancar a conta.
   */
  async exigeSegundoFator(userId: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const totp = await this.repo.find(userId);
    return Boolean(totp?.confirmedAt);
  }

  /**
   * Gera e grava os códigos. O valor em claro volta UMA vez, aqui — o banco
   * guarda só o sha256.
   *
   * 16 bytes = 128 bits de entropia, acima do piso de 112 da ASVS 6.5.2, que é o
   * que torna o hash rápido defensável (e evita o custo de N derivações de KDF
   * por palpite errado). Formato em dois grupos de hífen, para caber num papel.
   */
  private async gerarCodigos(userId: string): Promise<string[]> {
    const codigos = Array.from({ length: QUANTIDADE_DE_CODIGOS }, () =>
      this.gerarCodigo(),
    );
    await this.repo.substituirCodigos(
      userId,
      codigos.map((c) => this.hash(c)),
    );
    this.logger.log({
      evento: 'mfa.codigos_de_recuperacao_emitidos',
      msg: 'Códigos de recuperação de segundo fator emitidos.',
      usuarioId: userId,
      quantidade: codigos.length,
      // NUNCA os códigos: eles são credencial de acesso completo à conta.
    });
    return codigos;
  }

  /** `A1B2C3D4-E5F6G7H8` — base32 sem os caracteres ambíguos do Crockford. */
  private gerarCodigo(): string {
    const alfabeto = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // sem I, L, O, U
    const bytes = randomBytes(BYTES_DO_CODIGO);
    const letras = Array.from(bytes, (b) => alfabeto[b % alfabeto.length]);
    const metade = letras.length / 2;
    return `${letras.slice(0, metade).join('')}-${letras.slice(metade).join('')}`;
  }

  /** sha256, determinístico: o código chega sozinho e a busca é indexada. */
  private hash(codigo: string): string {
    return createHash('sha256').update(codigo).digest('hex');
  }

  private async registrarFalha(userId: string): Promise<void> {
    const { failedAttempts, lockedUntil } =
      await this.repo.registrarFalha(userId);
    // Sem o código no log, e sem e-mail: a linha vive 30 dias num Grafana
    // publicado. É esta linha — não `AccessRecord` — que registra a falha.
    this.logger.warn({
      evento: 'mfa.codigo_recusado',
      msg: 'Código de segundo fator recusado.',
      usuarioId: userId,
      falhasConsecutivas: failedAttempts,
      travada: Boolean(lockedUntil && lockedUntil > new Date()),
    });
  }

  private chave(): string {
    return this.config.get<string>('TOTP_ENCRYPTION_KEY') ?? '';
  }

  /**
   * 422 (não 500) quando a instância não tem chave de cifra: é configuração
   * ausente, não defeito — e a mensagem tem de dizer isso a quem clicou.
   */
  private assertDisponivel(): void {
    if (!this.isEnabled()) {
      throw new UnprocessableEntityException(
        'O segundo fator não está disponível nesta instalação do CRM. Peça a quem administra o servidor para configurar a chave de cifra.',
      );
    }
  }

  /** Exposto para a mensagem de erro de quem chama poder citar os números. */
  get limites(): { maxFalhas: number; travaMinutos: number } {
    return { maxFalhas: MAX_FALHAS, travaMinutos: TRAVA_MINUTOS };
  }
}
