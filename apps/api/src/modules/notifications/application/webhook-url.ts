import { UnprocessableEntityException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Validação da URL de destino. É a trava que importa nesta feature, e o motivo é
 * o contrário do intuitivo: o risco **não** é alguém forjar um corpo falso para o
 * receptor — é um colaborador apontar o webhook para um servidor dele e sifonar
 * nome de cliente e valor de cobrança. Contra isso agem permissão + HTTPS +
 * bloqueio de IP privado + `verified`; assinatura HMAC não faria nada (por isso
 * ela fica para a Fase 19, junto da máquina de segredo com rotação).
 *
 *  - HTTPS obrigatório;
 *  - resolve o host e recusa loopback, link-local, privado e reservado (SSRF);
 *  - recusa porta fora de 443.
 */
export async function validarUrlDeWebhook(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnprocessableEntityException('O endereço informado é inválido.');
  }

  if (parsed.protocol !== 'https:') {
    throw new UnprocessableEntityException('O endereço precisa usar HTTPS.');
  }

  // Porta explícita fora de 443 quase sempre aponta para um serviço interno.
  if (parsed.port !== '' && parsed.port !== '443') {
    throw new UnprocessableEntityException(
      'O endereço precisa usar a porta padrão do HTTPS (443).',
    );
  }

  for (const ip of await resolverIps(parsed.hostname)) {
    if (ehIpInterno(ip)) {
      throw new UnprocessableEntityException(
        'Este endereço aponta para a rede interna e não pode ser usado.',
      );
    }
  }
}

/**
 * IPs por trás do host. Um nome pode resolver para vários endereços, e **todos**
 * precisam ser públicos: bastaria um interno para o SSRF passar.
 *
 * Host que não resolve é recusado, não aceito — cadastrar um destino que nem
 * existe só produziria entregas falhas depois.
 */
async function resolverIps(hostname: string): Promise<string[]> {
  // O hostname pode já ser um IP literal (inclusive `[::1]`, que o `URL` desnuda).
  const literal = hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal)) return [literal];
  try {
    const enderecos = await lookup(hostname, { all: true });
    return enderecos.map((e) => e.address);
  } catch {
    throw new UnprocessableEntityException(
      'Não foi possível resolver este endereço. Confira o domínio.',
    );
  }
}

/**
 * Faixa não roteável na internet pública: loopback, link-local (inclui o
 * `169.254.169.254` do metadata de cloud), privada, CGNAT, e os equivalentes IPv6.
 */
export function ehIpInterno(ip: string): boolean {
  if (isIP(ip) === 6) return ehIpv6Interno(ip);

  const octetos = ip.split('.').map(Number);
  if (octetos.length !== 4 || octetos.some((o) => Number.isNaN(o))) return true;
  const [a, b] = octetos;

  if (a === 0) return true; // 0.0.0.0/8 — "este host"
  if (a === 10) return true; // 10.0.0.0/8 — privada
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local/metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 — privada
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 — privada
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 — CGNAT
  if (a >= 224) return true; // multicast e reservado
  return false;
}

function ehIpv6Interno(ip: string): boolean {
  const normalizado = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalizado === '::1' || normalizado === '::') return true; // loopback / não especificado
  if (normalizado.startsWith('fe80')) return true; // link-local
  // fc00::/7 — unique local (o primeiro byte é fc ou fd)
  if (/^f[cd]/.test(normalizado)) return true;
  // IPv4 mapeado (`::ffff:10.0.0.1`) — decide pela parte v4.
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalizado);
  if (mapeado) return ehIpInterno(mapeado[1]);
  return false;
}
