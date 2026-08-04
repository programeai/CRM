import { UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { UserTotp } from '@prisma/client';
import { generate } from 'otplib';
import { NodeCryptoPlugin } from '@otplib/plugin-crypto-node';
import { TotpService } from './totp.service';
import { decifrarSegredo } from '../../../shared/crypto/segredo-cifrado';
import { MAX_FALHAS, QUANTIDADE_DE_CODIGOS } from './totp.constants';
import type { TotpRepository } from './totp.repository';

const CHAVE = randomBytes(32).toString('hex');
const USUARIO = 'u1';
/** Relógio fixo: 2026-08-04T12:00:00Z. `epoch / 30` cai num passo redondo. */
const AGORA = new Date('2026-08-04T12:00:00.000Z');
const PASSO_ATUAL = Math.floor(AGORA.getTime() / 1000 / 30);

const cryptoPlugin = new NodeCryptoPlugin();

/** Token válido para um passo específico, gerado pela mesma lib que verifica. */
function tokenNoPasso(segredo: string, passo: number): Promise<string> {
  return generate({
    secret: segredo,
    crypto: cryptoPlugin,
    // `epoch` em segundos: o começo do passo pedido.
    epoch: passo * 30,
  });
}

describe('TotpService', () => {
  let repo: jest.Mocked<TotpRepository>;
  let config: { get: jest.Mock };
  let service: TotpService;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  /** O segredo em claro do "usuário" do teste, para gerar tokens válidos. */
  let segredo: string;
  /** A linha de `UserTotp` que o repositório devolve. Mutável por caso. */
  let linha: UserTotp | null;

  beforeEach(async () => {
    jest.useFakeTimers({ now: AGORA, doNotFake: ['nextTick'] });
    config = { get: jest.fn(() => CHAVE) };
    repo = {
      find: jest.fn(() => Promise.resolve(linha)),
      upsertSegredo: jest.fn((_id, dados) => {
        // Ecoa o que foi gravado, como o Prisma faria.
        linha = {
          userId: USUARIO,
          ...dados,
          confirmedAt: null,
          lastUsedStep: null,
          failedAttempts: 0,
          lockedUntil: null,
          createdAt: AGORA,
        } as UserTotp;
        return Promise.resolve(linha);
      }),
      confirmar: jest.fn((_id, quando: Date) => {
        if (linha) linha.confirmedAt = quando;
        return Promise.resolve();
      }),
      registrarSucesso: jest.fn((_id, passo: bigint) => {
        if (linha) {
          linha.lastUsedStep = passo;
          linha.failedAttempts = 0;
          linha.lockedUntil = null;
        }
        return Promise.resolve();
      }),
      registrarFalha: jest.fn(() => {
        if (linha) {
          linha.failedAttempts += 1;
          if (linha.failedAttempts >= MAX_FALHAS && !linha.lockedUntil) {
            linha.lockedUntil = new Date(AGORA.getTime() + 15 * 60_000);
          }
        }
        return Promise.resolve({
          failedAttempts: linha?.failedAttempts ?? 1,
          lockedUntil: linha?.lockedUntil ?? null,
        });
      }),
      apagar: jest.fn(() => {
        linha = null;
        return Promise.resolve();
      }),
      substituirCodigos: jest.fn().mockResolvedValue(undefined),
      contarCodigosDisponiveis: jest
        .fn()
        .mockResolvedValue(QUANTIDADE_DE_CODIGOS),
      consumirCodigo: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<TotpRepository>;

    linha = null;
    service = new TotpService(repo, config as unknown as ConfigService);
    logSpy = jest
      .spyOn(
        (service as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(
        (service as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    // Todo caso parte de um cadastro iniciado, salvo os que dizem o contrário.
    const iniciado = await service.iniciar(USUARIO, 'ana@teste.local');
    segredo = iniciado.segredoBase32;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('iniciar', () => {
    it('grava o segredo CIFRADO e com confirmedAt nulo — não liga o 2FA', () => {
      const [, dados] = repo.upsertSegredo.mock.calls[0];
      expect(dados.ciphertext).not.toContain(segredo);
      expect(JSON.stringify(dados)).not.toContain(segredo);
      // …e o que foi gravado decifra de volta no segredo do QR.
      expect(decifrarSegredo(dados, CHAVE)).toBe(segredo);
      expect(linha?.confirmedAt).toBeNull();
    });

    it('devolve QR, URI e base32 — o MESMO segredo em três codificações', async () => {
      const r = await service.iniciar(USUARIO, 'ana@teste.local');
      expect(r.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(r.uri).toContain('otpauth://totp/');
      expect(r.uri).toContain(`secret=${r.segredoBase32}`);
      expect(r.uri).toContain('issuer=ProgrameAi%20CRM');
    });

    /*
      O segredo base32 e o `otpauth://` são o segredo INTEIRO em texto. A doc do
      otplib e a OWASP Logging são explícitas: nunca em log.
    */
    it('não escreve o segredo nem o otpauth:// em NENHUM log', async () => {
      const r = await service.iniciar(USUARIO, 'ana@teste.local');
      const linhas = JSON.stringify([
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
      ]);
      expect(linhas).not.toContain(r.segredoBase32);
      expect(linhas).not.toContain('otpauth://');
      expect(linhas).not.toContain('secret=');
    });
  });

  describe('verificar — janela de drift', () => {
    it('aceita o código do passo ATUAL', async () => {
      await expect(
        service.verificar(USUARIO, await tokenNoPasso(segredo, PASSO_ATUAL)),
      ).resolves.toBe(true);
    });

    it('aceita o passo ANTERIOR e o SEGUINTE (±1, RFC 6238 §5.2)', async () => {
      await expect(
        service.verificar(
          USUARIO,
          await tokenNoPasso(segredo, PASSO_ATUAL - 1),
        ),
      ).resolves.toBe(true);

      // Reinicia o estado: o caso anterior gravou `lastUsedStep`.
      linha!.lastUsedStep = null;
      await expect(
        service.verificar(
          USUARIO,
          await tokenNoPasso(segredo, PASSO_ATUAL + 1),
        ),
      ).resolves.toBe(true);
    });

    it('RECUSA dois passos de distância — janela grande permite replay', async () => {
      await expect(
        service.verificar(
          USUARIO,
          await tokenNoPasso(segredo, PASSO_ATUAL - 2),
        ),
      ).resolves.toBe(false);
      await expect(
        service.verificar(
          USUARIO,
          await tokenNoPasso(segredo, PASSO_ATUAL + 2),
        ),
      ).resolves.toBe(false);
    });
  });

  /*
    RFC 6238 §5.2: "The verifier MUST NOT accept the second attempt of the OTP
    after the successful validation has been issued for the first OTP." Nenhuma
    biblioteca resolve isso — o `otplib` é stateless e só oferece o parâmetro.
  */
  describe('verificar — replay', () => {
    it('o MESMO código aceito duas vezes: a segunda é recusada', async () => {
      const codigo = await tokenNoPasso(segredo, PASSO_ATUAL);

      await expect(service.verificar(USUARIO, codigo)).resolves.toBe(true);
      await expect(service.verificar(USUARIO, codigo)).resolves.toBe(false);
    });

    it('o passo aceito é PERSISTIDO — é ele que fecha a janela', async () => {
      await service.verificar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );
      expect(repo.registrarSucesso).toHaveBeenCalledWith(
        USUARIO,
        BigInt(PASSO_ATUAL),
      );
    });

    it('depois de aceitar o passo atual, o passo ANTERIOR também é recusado', async () => {
      await service.verificar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );
      await expect(
        service.verificar(
          USUARIO,
          await tokenNoPasso(segredo, PASSO_ATUAL - 1),
        ),
      ).resolves.toBe(false);
    });
  });

  describe('verificar — limite por conta', () => {
    it(`${MAX_FALHAS} falhas consecutivas travam a conta`, async () => {
      for (let i = 0; i < MAX_FALHAS; i++) {
        await expect(service.verificar(USUARIO, '000000')).resolves.toBe(false);
      }
      expect(linha?.failedAttempts).toBe(MAX_FALHAS);
      expect(linha?.lockedUntil).toBeInstanceOf(Date);
    });

    it('conta travada recusa MESMO o código correto — senão a trava não trava', async () => {
      linha!.lockedUntil = new Date(AGORA.getTime() + 60_000);

      await expect(
        service.verificar(USUARIO, await tokenNoPasso(segredo, PASSO_ATUAL)),
      ).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'mfa.conta_travada' }),
      );
    });

    it('sucesso ZERA o placar de falhas (NIST rev 4 pede isso)', async () => {
      await service.verificar(USUARIO, '000000');
      await service.verificar(USUARIO, '000000');
      expect(linha?.failedAttempts).toBe(2);

      await service.verificar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );

      expect(repo.registrarSucesso).toHaveBeenCalled();
      expect(linha?.failedAttempts).toBe(0);
      expect(linha?.lockedUntil).toBeNull();
    });

    it('o log da recusa não carrega o código tentado', async () => {
      await service.verificar(USUARIO, '424242');
      const linhas = JSON.stringify(warnSpy.mock.calls);
      expect(linhas).toContain('mfa.codigo_recusado');
      expect(linhas).not.toContain('424242');
    });
  });

  describe('confirmar', () => {
    it('com código válido: liga o 2FA e emite 16 códigos DISTINTOS', async () => {
      const { codigosDeRecuperacao } = await service.confirmar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );

      expect(linha?.confirmedAt).toBeInstanceOf(Date);
      expect(codigosDeRecuperacao).toHaveLength(QUANTIDADE_DE_CODIGOS);
      expect(new Set(codigosDeRecuperacao).size).toBe(QUANTIDADE_DE_CODIGOS);
      // Grava só o sha256 — nunca o valor.
      const [, hashes] = repo.substituirCodigos.mock.calls[0];
      expect(hashes).toHaveLength(QUANTIDADE_DE_CODIGOS);
      expect(hashes[0]).toBe(
        createHash('sha256').update(codigosDeRecuperacao[0]).digest('hex'),
      );
      expect(JSON.stringify(hashes)).not.toContain(codigosDeRecuperacao[0]);
    });

    it('com código ERRADO: 422 em pt-BR e o 2FA NÃO liga', async () => {
      await expect(service.confirmar(USUARIO, '000000')).rejects.toThrow(
        'Código inválido. Confira o app autenticador e tente de novo.',
      );
      expect(linha?.confirmedAt).toBeNull();
      expect(repo.substituirCodigos).not.toHaveBeenCalled();
    });

    it('sem cadastro iniciado: 422 dizendo para começar', async () => {
      linha = null;
      await expect(service.confirmar(USUARIO, '000000')).rejects.toThrow(
        'Comece o cadastro do segundo fator antes de confirmar.',
      );
    });

    it('os códigos emitidos não aparecem em log nenhum', async () => {
      const { codigosDeRecuperacao } = await service.confirmar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );
      const linhas = JSON.stringify([
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
      ]);
      for (const codigo of codigosDeRecuperacao) {
        expect(linhas).not.toContain(codigo);
      }
    });
  });

  describe('códigos de recuperação', () => {
    beforeEach(async () => {
      await service.confirmar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );
    });

    it('consome pelo hash, em compare-and-swap', async () => {
      await expect(
        service.consumirCodigoDeRecuperacao(USUARIO, 'A1B2C3D4-E5F6G7H8'),
      ).resolves.toBe(true);
      expect(repo.consumirCodigo).toHaveBeenCalledWith(
        USUARIO,
        createHash('sha256').update('A1B2C3D4-E5F6G7H8').digest('hex'),
      );
    });

    /*
      O compare-and-swap vive no repositório (`updateMany where usedAt: null`);
      aqui o que se prova é que o service RESPEITA o "não" dele — o segundo uso do
      mesmo código não passa.
    */
    it('o segundo uso do mesmo código não passa', async () => {
      repo.consumirCodigo
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await expect(
        service.consumirCodigoDeRecuperacao(USUARIO, 'A1B2C3D4-E5F6G7H8'),
      ).resolves.toBe(true);
      await expect(
        service.consumirCodigoDeRecuperacao(USUARIO, 'A1B2C3D4-E5F6G7H8'),
      ).resolves.toBe(false);
    });

    it('normaliza caixa e espaço antes de comparar', async () => {
      await service.consumirCodigoDeRecuperacao(USUARIO, ' a1b2c3d4-e5f6g7h8 ');
      expect(repo.consumirCodigo).toHaveBeenCalledWith(
        USUARIO,
        createHash('sha256').update('A1B2C3D4-E5F6G7H8').digest('hex'),
      );
    });

    it('código errado conta como falha por conta', async () => {
      repo.consumirCodigo.mockResolvedValue(false);
      await service.consumirCodigoDeRecuperacao(USUARIO, 'NAO-EXISTE');
      expect(repo.registrarFalha).toHaveBeenCalled();
    });

    it('conta travada não aceita código de recuperação', async () => {
      linha!.lockedUntil = new Date(AGORA.getTime() + 60_000);
      await expect(
        service.consumirCodigoDeRecuperacao(USUARIO, 'A1B2C3D4-E5F6G7H8'),
      ).resolves.toBe(false);
      expect(repo.consumirCodigo).not.toHaveBeenCalled();
    });

    it('regenerar invalida os antigos: substitui os 16 de uma vez', async () => {
      repo.substituirCodigos.mockClear();
      const { codigosDeRecuperacao } = await service.regenerarCodigos(USUARIO);

      expect(codigosDeRecuperacao).toHaveLength(QUANTIDADE_DE_CODIGOS);
      expect(repo.substituirCodigos).toHaveBeenCalledTimes(1);
      const [, hashes] = repo.substituirCodigos.mock.calls[0];
      expect(hashes).toHaveLength(QUANTIDADE_DE_CODIGOS);
    });

    it('regenerar sem 2FA ativo é 422', async () => {
      linha!.confirmedAt = null;
      await expect(service.regenerarCodigos(USUARIO)).rejects.toThrow(
        'Ative o segundo fator antes de gerar códigos de recuperação.',
      );
    });
  });

  describe('status e desativar', () => {
    it('status reflete o cadastro não confirmado como INATIVO', async () => {
      await expect(service.status(USUARIO)).resolves.toEqual({
        disponivel: true,
        ativo: false,
        codigosRestantes: 0,
      });
    });

    it('status ativo traz a contagem de códigos restantes', async () => {
      await service.confirmar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );
      await expect(service.status(USUARIO)).resolves.toEqual({
        disponivel: true,
        ativo: true,
        codigosRestantes: QUANTIDADE_DE_CODIGOS,
      });
    });

    it('exigeSegundoFator olha confirmedAt, não a existência da linha', async () => {
      // Cadastro iniciado e nunca concluído NÃO pode trancar a conta.
      await expect(service.exigeSegundoFator(USUARIO)).resolves.toBe(false);
      await service.confirmar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );
      await expect(service.exigeSegundoFator(USUARIO)).resolves.toBe(true);
    });

    it('desativar apaga o segredo e deixa de exigir o fator', async () => {
      await service.confirmar(
        USUARIO,
        await tokenNoPasso(segredo, PASSO_ATUAL),
      );
      await service.desativar(USUARIO);

      expect(repo.apagar).toHaveBeenCalledWith(USUARIO);
      await expect(service.exigeSegundoFator(USUARIO)).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ evento: 'mfa.desativado' }),
      );
    });
  });

  /*
    Sem `TOTP_ENCRYPTION_KEY` o 2FA está desligado na instância — mesmo contrato de
    "serviço opcional" de SMTP e captcha, e é o que mantém a autohospedagem
    subindo sem variável nova obrigatória.
  */
  describe('sem chave de cifra na instância', () => {
    beforeEach(() => {
      config.get.mockReturnValue('');
    });

    it('isEnabled é false e o status diz `disponivel: false`', async () => {
      expect(service.isEnabled()).toBe(false);
      await expect(service.status(USUARIO)).resolves.toEqual({
        disponivel: false,
        ativo: false,
        codigosRestantes: 0,
      });
    });

    it('iniciar lança 422 em pt-BR, nomeando o que falta', async () => {
      await expect(service.iniciar(USUARIO, 'ana@teste.local')).rejects.toThrow(
        UnprocessableEntityException,
      );
      await expect(service.iniciar(USUARIO, 'ana@teste.local')).rejects.toThrow(
        /não está disponível nesta instalação/,
      );
    });

    it('verificar e exigeSegundoFator respondem false, sem tocar o banco', async () => {
      repo.find.mockClear();
      await expect(service.verificar(USUARIO, '000000')).resolves.toBe(false);
      await expect(service.exigeSegundoFator(USUARIO)).resolves.toBe(false);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });
});
