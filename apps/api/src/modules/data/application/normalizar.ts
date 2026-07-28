/**
 * Minúscula, sem acento, sem espaço duplicado. É a chave de casamento tanto do
 * nome de coluna quanto do valor de catálogo — é o que faz "Tráfego Pago" da
 * planilha encontrar "Tráfego pago" do catálogo, que é o que o usuário espera.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
