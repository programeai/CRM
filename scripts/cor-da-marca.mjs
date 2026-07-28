#!/usr/bin/env node
// Deriva os tokens da cor da marca a partir de um único hex e imprime os blocos
// prontos para colar.
//
//   node scripts/cor-da-marca.mjs '#28C800'
//   node scripts/cor-da-marca.mjs '#28C800' --conferir   # só audita o que já está no código
//
// Existe porque a parte difícil de trocar a cor da marca não é o hex — é que
// `--primary` do CRM é ao mesmo tempo fundo de botão e cor de texto pequeno
// (`text-primary` aparece em dezenas de telas). Um verde vivo como #28C800 rende
// 2,2:1 sobre branco: perfeito como fundo de botão, ilegível como texto. Então
// cada marca precisa de DUAS variantes da mesma matiz — uma que aguenta ser
// texto sobre claro, outra que brilha sobre escuro — e da tinta certa por cima
// de cada uma. Feito no olho, isso sai errado; feito aqui, sai conferido.
//
// O script não escreve em arquivo nenhum de propósito: ele imprime, você cola.
// São quatro lugares, todos listados na saída.

const ALVO_TEXTO = 4.5; // WCAG AA, texto normal
const ALVO_UI = 3.0; // WCAG AA, componente de interface / texto grande

// ── sRGB ⇄ OKLCH ────────────────────────────────────────────────────────────
const paraLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const paraGama = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function hexParaRgb(hex) {
  const h = hex.replace('#', '');
  const cheio = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(cheio.slice(i, i + 2), 16) / 255);
}

function rgbParaHex(rgb) {
  const byte = (v) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${rgb.map(byte).join('')}`.toUpperCase();
}

function rgbParaOklch([r, g, b]) {
  const R = paraLinear(r);
  const G = paraLinear(g);
  const B = paraLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return [L, Math.hypot(a, bb), h < 0 ? h + 360 : h];
}

function oklchParaRgb([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    paraGama(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    paraGama(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    paraGama(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const dentroDoGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/**
 * Arredonda para os 8 bits por canal que o navegador de fato pinta.
 *
 * Todo contraste é medido em cima disto, nunca no float: o oklch contínuo passa
 * raspando em 4,50:1 num valor que, virado hex, entrega 4,49 — e aí o token que
 * o script aprovou é justamente o que falha na auditoria.
 */
const quantizar = (rgb) => rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255) / 255);

/** Maior croma que ainda cabe no sRGB para um dado (L, matiz). */
function cromaMaximo(L, h) {
  let baixo = 0;
  let alto = 0.4;
  for (let i = 0; i < 40; i++) {
    const meio = (baixo + alto) / 2;
    if (dentroDoGamut(oklchParaRgb([L, meio, h]))) baixo = meio;
    else alto = meio;
  }
  return baixo;
}

// ── Contraste (WCAG 2.x) ────────────────────────────────────────────────────
const luminancia = ([r, g, b]) =>
  0.2126 * paraLinear(r) + 0.7152 * paraLinear(g) + 0.0722 * paraLinear(b);

function contraste(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

// ── Superfícies e tintas reais do CRM (index.css) ───────────────────────────
const BRANCO = [1, 1, 1];
const TINTA_ESCURA = { oklch: 'oklch(0.2064 0.0388 265.55)', hex: '#0F1729' };
const FUNDO_DARK = oklchParaRgb([0.155, 0.02, 266]); // --background do .dark
const CARD_DARK = oklchParaRgb([0.2, 0.028, 266]); // --card do .dark
const PAINEL_AUTH = hexParaRgb('#0b1220'); // showcase do login

/** As superfícies claras que o acento `-on-light` precisa vencer. */
const SUPERFICIES_CLARAS = [{ rgb: BRANCO, alvo: ALVO_TEXTO }];

/**
 * As superfícies escuras que o acento `-on-dark` precisa vencer. O card entra
 * com o alvo de UI (3:1) porque nele o acento é borda/ícone/foco, não corpo de
 * texto — cobrar 4,5 ali estreitaria a paleta sem ninguém ganhar nada.
 */
const SUPERFICIES_ESCURAS = [
  { rgb: FUNDO_DARK, alvo: ALVO_TEXTO },
  { rgb: PAINEL_AUTH, alvo: ALVO_TEXTO },
  { rgb: CARD_DARK, alvo: ALVO_UI },
];

/**
 * Acha a variante da matiz **mais próxima do tom escolhido** que ainda vence
 * todas as superfícies dadas. Por isso a busca caminha a partir do L original
 * em vez de chutar um valor fixo: o primeiro L que passa é o que menos desvia
 * da cor que a pessoa pediu.
 *
 * A direção depende do fundo, e é justamente o que faz o script servir para
 * qualquer marca. Uma cor luminosa (#28C800) já brilha no escuro e precisa ser
 * **aprofundada** para virar texto sobre branco; uma cor escura (#B100FF) já
 * serve sobre branco e precisa ser **clareada** para aparecer no tema escuro.
 * Sem isso, metade das marcas passaria batido com um contraste reprovado.
 */
function variantePara(canonicoRgb, [L0, C0, h], superficies, sentido) {
  for (let passo = 0; passo <= 900; passo++) {
    // L e C são arredondados aqui, e não só na hora de imprimir: o que se mede
    // tem de ser exatamente o valor que vai para o arquivo. A exceção é o passo
    // zero, que preserva a precisão original — senão uma cor que não precisava
    // de ajuste nenhum sairia deslocada em 1 unidade de canal só pelo
    // arredondamento, e o hex no arquivo deixaria de ser o hex escolhido.
    const semAjuste = passo === 0;
    const L = semAjuste ? Number(L0.toFixed(4)) : Number((L0 + sentido * passo * 0.001).toFixed(3));
    if (L <= 0.15 || L >= 0.99) return null;
    const C = semAjuste
      ? Number(C0.toFixed(4))
      : Number(Math.min(C0, cromaMaximo(L, h)).toFixed(3));
    const rgb = semAjuste ? canonicoRgb : quantizar(oklchParaRgb([L, C, h]));
    const venceOFundo = superficies.every((s) => contraste(rgb, s.rgb) >= s.alvo);
    // A tinta entra na busca, e não só na auditoria: cada variante é ao mesmo
    // tempo texto sobre o fundo e fundo de botão, e há uma faixa de luminância
    // média — onde muito roxo e muito azul caem — em que a cor passa no fundo
    // mas nem branco nem tinta escura alcançam 4,5 por cima dela. Sem esta
    // condição a busca para justamente ali e entrega um botão ilegível.
    if (venceOFundo && tintaPara(rgb).razao >= ALVO_TEXTO) return { L, C, h, rgb };
  }
  return null;
}

/** Entre branco e a tinta escura, a que enxerga melhor em cima da cor. */
function tintaPara(rgb) {
  const comBranco = contraste(rgb, BRANCO);
  const comTinta = contraste(rgb, hexParaRgb(TINTA_ESCURA.hex));
  return comBranco >= comTinta
    ? { nome: 'branco', oklch: 'oklch(1 0 0)', hex: '#FFFFFF', razao: comBranco }
    : { nome: 'tinta escura', ...TINTA_ESCURA, razao: comTinta };
}

const fmt = (n) => n.toFixed(2).replace('.', ',');

/** Uma linha do relatório de contraste, alinhada em colunas. */
function linha(rotulo, razao, alvo, nota) {
  const selo = razao >= alvo ? '  ok ' : 'FALHA';
  const alvoTxt = String(alvo).replace('.', ',');
  return `    ${selo}  ${rotulo.padEnd(38, '.')} ${fmt(razao).padStart(5)}:1   mín. ${alvoTxt} · ${nota}`;
}

// ── Execução ────────────────────────────────────────────────────────────────
const [entrada, ...flags] = process.argv.slice(2);
if (!entrada || !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(entrada)) {
  console.error('uso: node scripts/cor-da-marca.mjs \'#RRGGBB\' [--conferir]');
  process.exit(1);
}
const soConferir = flags.includes('--conferir');

const canonicoRgb = quantizar(hexParaRgb(entrada));
const canonicoHex = rgbParaHex(canonicoRgb);
const [L0, C0, h] = rgbParaOklch(canonicoRgb);

// Sobre claro só se pode escurecer; sobre escuro só se pode clarear.
const sobreClaro = variantePara(canonicoRgb, [L0, C0, h], SUPERFICIES_CLARAS, -1);
const sobreEscuro = variantePara(canonicoRgb, [L0, C0, h], SUPERFICIES_ESCURAS, +1);

for (const [variante, onde] of [
  [sobreClaro, 'sobre branco'],
  [sobreEscuro, 'sobre as superfícies escuras do app'],
]) {
  if (!variante) {
    console.error(`\n  ${canonicoHex}: nenhuma variante desta matiz alcança o mínimo AA`);
    console.error(`  ${onde}. Escolha uma matiz com mais alcance tonal.\n`);
    process.exit(1);
  }
}

const oklchDe = ({ L, C, h: hh }) => `oklch(${L} ${C} ${hh.toFixed(2)})`;
const tintaClara = tintaPara(sobreClaro.rgb);
const tintaEscura = tintaPara(sobreEscuro.rgb);

console.log(`\n  Cor da marca: ${canonicoHex}   ${oklchDe({ L: Number(L0.toFixed(4)), C: Number(C0.toFixed(4)), h })}\n`);

const auditoria = [
  linha('acento claro sobre branco', contraste(sobreClaro.rgb, BRANCO), ALVO_TEXTO, 'text-primary'),
  linha(`${tintaClara.nome} sobre o acento claro`, tintaClara.razao, ALVO_TEXTO, 'rótulo de botão'),
  linha('acento escuro sobre o fundo escuro', contraste(sobreEscuro.rgb, FUNDO_DARK), ALVO_TEXTO, 'text-primary no .dark'),
  linha('acento escuro sobre o card escuro', contraste(sobreEscuro.rgb, CARD_DARK), ALVO_UI, 'borda, ícone, foco'),
  linha(`${tintaEscura.nome} sobre o acento escuro`, tintaEscura.razao, ALVO_TEXTO, 'rótulo de botão no .dark'),
  linha('acento escuro no painel do login', contraste(sobreEscuro.rgb, PAINEL_AUTH), ALVO_TEXTO, 'showcase de auth'),
];
console.log('  Contraste');
console.log(auditoria.join('\n'));

const reprovou = auditoria.some((l) => l.includes('FALHA'));

/** Conta o que foi preciso fazer com o tom escolhido para chegar na variante. */
function comoDerivou(variante, superficie, nomeDaSuperficie, verbo) {
  if (Math.abs(variante.L - L0) < 0.002) {
    return `  · ${nomeDaSuperficie}: o tom canônico serve como está.`;
  }
  return (
    `  · ${nomeDaSuperficie}: o canônico rende ${fmt(contraste(canonicoRgb, superficie))}:1, abaixo do mínimo. Foi` +
    `\n    ${verbo} na mesma matiz (h ${h.toFixed(2)}) até ${rgbParaHex(variante.rgb)}.`
  );
}

console.log('\n  Variantes');
console.log(comoDerivou(sobreClaro, BRANCO, 'sobre claro', 'aprofundado'));
console.log(comoDerivou(sobreEscuro, FUNDO_DARK, 'sobre escuro', 'clareado'));

if (soConferir) {
  console.log('');
  process.exit(reprovou ? 1 : 0);
}

if (reprovou) {
  console.log(
    '\n  Alguma linha reprovou: as superfícies do CRM não acomodam esta cor sem' +
      '\n  ajuste à mão. Não cole os blocos abaixo sem resolver a linha em FALHA.',
  );
}

console.log(`
  ─────────────────────────────────────────────────────────────────────────
  1/4  apps/web/src/index.css — bloco "COR DA MARCA"
  ─────────────────────────────────────────────────────────────────────────

    --brand-on-light: ${oklchDe(sobreClaro)};
    --brand-on-light-ink: ${tintaClara.oklch};

    --brand-on-dark: ${oklchDe(sobreEscuro)};
    --brand-on-dark-ink: ${tintaEscura.oklch};

  ─────────────────────────────────────────────────────────────────────────
  2/4  apps/web/src/lib/brand.ts — const MARCA
  3/4  apps/api/src/mail/templates/brand.ts — const MARCA   (mesmo bloco)
  ─────────────────────────────────────────────────────────────────────────

    canonico: '${canonicoHex}',
    sobreClaro: '${rgbParaHex(sobreClaro.rgb)}',
    sobreEscuro: '${rgbParaHex(sobreEscuro.rgb)}',

    E, no layout.ts, o .e-btn-link do bloco prefers-color-scheme: dark —
    a tinta em cima do acento escuro agora é ${tintaEscura.hex} (${tintaEscura.nome}).

  ─────────────────────────────────────────────────────────────────────────
  4/4  o que cita a cor pelo nome (comentários, README, docs de design)
  ─────────────────────────────────────────────────────────────────────────

    grep -rniE '<nome-da-cor-antiga>|#<hex-antigo>' \\
      apps/web/src apps/api/src apps/web/*.md README.md

  Depois: pnpm --filter web build && pnpm --filter api test -- mail
          node scripts/cor-da-marca.mjs '${canonicoHex}' --conferir
`);
