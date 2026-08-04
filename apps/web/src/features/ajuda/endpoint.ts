/**
 * O endereço absoluto de uma rota da API **desta instância**, montado da mesma
 * variável que o app usa para falar com ela (`VITE_API_URL` já inclui o
 * `/api/v1`). Assim as páginas de ajuda mostram o endereço real de quem está
 * lendo — inclusive em instalação própria — em vez de um host de exemplo que
 * ninguém sabe substituir.
 *
 * Em produção essa variável é **relativa** (`/api/v1`, mesmo host do front atrás
 * do proxy). No que a ajuda exibe ela não pode ser: quem lê vai colar isso num
 * sistema que roda fora, e caminho relativo não resolve lá. Daí o host da janela
 * na frente.
 *
 * Vive aqui, e não dentro de uma das páginas, porque tem dois consumidores:
 * a ajuda da captação e a da API pública.
 */
export function endpointDaApi(caminho: string): string {
  const base = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');
  const absoluta = /^https?:\/\//i.test(base)
    ? base
    : `${window.location.origin}${base}`;
  return `${absoluta}/${caminho.replace(/^\/+/, '')}`;
}
