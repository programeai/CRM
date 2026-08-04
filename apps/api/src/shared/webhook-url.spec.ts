import { UnprocessableEntityException } from '@nestjs/common';
import { ehIpInterno, validarUrlDeWebhook } from './webhook-url';

// O DNS é a fronteira externa: mockado para o teste não depender de rede.
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));
import { lookup } from 'node:dns/promises';
const buscarDns = lookup as jest.MockedFunction<typeof lookup>;

describe('validarUrlDeWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Por padrão, um host que resolve para IP público.
    buscarDns.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
  });

  it('aceita uma URL HTTPS pública', async () => {
    await expect(
      validarUrlDeWebhook('https://hooks.slack.com/services/T000/B000/xxx'),
    ).resolves.toBeUndefined();
  });

  it('recusa http:// (sem TLS)', async () => {
    await expect(
      validarUrlDeWebhook('http://exemplo.com.br/hook'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      validarUrlDeWebhook('http://exemplo.com.br/hook'),
    ).rejects.toThrow('O endereço precisa usar HTTPS.');
  });

  it('recusa URL malformada', async () => {
    await expect(validarUrlDeWebhook('nem-url')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('recusa porta fora de 443', async () => {
    await expect(
      validarUrlDeWebhook('https://exemplo.com.br:8443/hook'),
    ).rejects.toThrow(/porta padrão/);
  });

  it('recusa localhost', async () => {
    buscarDns.mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(validarUrlDeWebhook('https://localhost/hook')).rejects.toThrow(
      /rede interna/,
    );
  });

  it('recusa 127.0.0.1 literal', async () => {
    await expect(validarUrlDeWebhook('https://127.0.0.1/x')).rejects.toThrow(
      /rede interna/,
    );
    // IP literal não vai ao DNS.
    expect(buscarDns).not.toHaveBeenCalled();
  });

  it('recusa 10.0.0.1 (rede privada)', async () => {
    await expect(validarUrlDeWebhook('https://10.0.0.1/x')).rejects.toThrow(
      /rede interna/,
    );
  });

  it('recusa 169.254.169.254 (metadata de cloud)', async () => {
    await expect(
      validarUrlDeWebhook('https://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow(/rede interna/);
  });

  it('recusa [::1] (loopback IPv6)', async () => {
    await expect(validarUrlDeWebhook('https://[::1]/x')).rejects.toThrow(
      /rede interna/,
    );
  });

  it('recusa host público que resolve TAMBÉM para IP interno (DNS rebinding)', async () => {
    buscarDns.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ] as never);

    await expect(
      validarUrlDeWebhook('https://parece-publico.com.br/hook'),
    ).rejects.toThrow(/rede interna/);
  });

  it('recusa host que não resolve', async () => {
    buscarDns.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      validarUrlDeWebhook('https://nao-existe.invalido/hook'),
    ).rejects.toThrow(/resolver este endereço/);
  });
});

describe('ehIpInterno', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:10.0.0.1',
  ])('considera %s interno', (ip) => {
    expect(ehIpInterno(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1', // fora da faixa 172.16/12
    '192.167.1.1', // fora da faixa 192.168/16
    '2606:4700::1111',
  ])('considera %s público', (ip) => {
    expect(ehIpInterno(ip)).toBe(false);
  });
});
