/** Formata CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) a partir dos dígitos. */
export function formatDocument(value?: string | null): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value;
}

/** Formata telefone BR: (00) 00000-0000 ou (00) 0000-0000. */
export function formatPhone(value?: string | null): string {
  if (!value) return '';
  const d = value.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return value;
}

/* ------------------------------------------------------------------ *
 * Máscaras progressivas — aplicadas ENQUANTO o usuário digita no input.
 * Diferente das funções `format*` acima (só exibição de valores prontos),
 * estas formatam também valores parciais e limitam o comprimento. Ligue-as
 * ao `onChange` do input e persista sempre os dígitos crus (sem pontuação).
 * ------------------------------------------------------------------ */

/** Mantém apenas os dígitos de uma string. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Máscara progressiva de CEP: `00000-000` (limita a 8 dígitos). */
export function maskCep(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * Máscara progressiva de telefone/celular BR (limita a 11 dígitos):
 * `(11) 99999-0000` (celular) ou `(11) 3333-4444` (fixo). Formata parciais.
 */
export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Máscara progressiva de CPF/CNPJ (limita a 14 dígitos): até 11 dígitos usa
 * o formato de CPF (`000.000.000-00`); acima disso, CNPJ (`00.000.000/0000-00`).
 */
export function maskDocument(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatDate(value?: string | Date | null): string {
  if (!value) return '';
  return dateFmt.format(new Date(value));
}
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '';
  return dateTimeFmt.format(new Date(value));
}
