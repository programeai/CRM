/**
 * Cores das tags e contraste de texto.
 *
 * As tags recebem uma cor de fundo determinística (derivada do próprio texto),
 * e a cor do texto é escolhida entre preto e branco pela função de contraste,
 * garantindo legibilidade sobre qualquer fundo.
 */

/** Converte `#rgb` ou `#rrggbb` em componentes RGB (0–255). */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const int = parseInt(h, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/**
 * Decide entre texto preto ou branco para máxima legibilidade sobre a cor de
 * fundo informada, usando a luminância relativa (WCAG 2.x). O limiar `0.179` é
 * o ponto em que o contraste com branco e com preto se equivalem.
 *
 * @param background cor de fundo em hex (`#rgb` ou `#rrggbb`)
 * @returns `#000000` (preto) para fundos claros, `#ffffff` (branco) para escuros
 */
export function readableTextColor(background: string): '#000000' | '#ffffff' {
  const { r, g, b } = hexToRgb(background);
  const toLinear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

/**
 * Paleta de fundos das tags. Cores de saturação/luminância variadas — algumas
 * pedem texto preto, outras branco — o que fica a cargo de `readableTextColor`.
 */
const TAG_PALETTE = [
  '#0E7C7B', // teal (marca)
  '#2563EB', // azul
  '#7C3AED', // roxo
  '#DB2777', // rosa
  '#DC2626', // vermelho
  '#EA580C', // laranja
  '#CA8A04', // âmbar
  '#16A34A', // verde
  '#0891B2', // ciano
  '#4F46E5', // índigo
  '#FACC15', // amarelo (claro → texto preto)
  '#A3E635', // lima (claro → texto preto)
  '#F9A8D4', // rosa claro (→ texto preto)
  '#64748B', // cinza-azulado
];

/** Cor de fundo determinística para uma tag (mesmo texto → mesma cor). */
export function tagBackgroundColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}

/** Estilo pronto (fundo + texto contrastante) para uma tag. */
export function tagColors(tag: string): { backgroundColor: string; color: string } {
  const backgroundColor = tagBackgroundColor(tag);
  return { backgroundColor, color: readableTextColor(backgroundColor) };
}
