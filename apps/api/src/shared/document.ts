/** Remove tudo que não é dígito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function isValidCNPJ(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

/**
 * Deduz o tipo de pessoa pelo tamanho do documento — 11 dígitos é CPF (pessoa
 * física), 14 é CNPJ (pessoa jurídica). É o backend que decide isso: o tipo não
 * é escolha de quem cadastra, é consequência do documento informado. Devolve
 * `null` quando o tamanho não corresponde a nenhum dos dois.
 */
export function inferPersonType(
  document: string,
): 'INDIVIDUAL' | 'COMPANY' | null {
  const digits = onlyDigits(document);
  if (digits.length === 11) return 'INDIVIDUAL';
  if (digits.length === 14) return 'COMPANY';
  return null;
}

/** Valida CPF (PF) ou CNPJ (PJ) conforme o tipo de pessoa. */
export function isValidDocument(
  document: string,
  personType: 'INDIVIDUAL' | 'COMPANY',
): boolean {
  return personType === 'INDIVIDUAL'
    ? isValidCPF(document)
    : isValidCNPJ(document);
}
