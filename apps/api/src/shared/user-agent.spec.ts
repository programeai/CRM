import { describeUserAgent } from './user-agent';

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Chrome no Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0',
      'Edge no Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      'Safari no macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1',
      'Chrome no iOS',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Firefox no Linux',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
      'Chrome no Android',
    ],
  ])('%s → %s', (ua, esperado) => {
    expect(describeUserAgent(ua)).toBe(esperado);
  });

  it('devolve texto de reserva quando não há User-Agent', () => {
    expect(describeUserAgent(null)).toBe('Dispositivo desconhecido');
    expect(describeUserAgent('')).toBe('Dispositivo desconhecido');
  });

  it('devolve a string crua truncada para User-Agent irreconhecível', () => {
    expect(describeUserAgent('curl/8.4.0')).toBe('curl/8.4.0');
  });
});
