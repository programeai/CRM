import {
  IsEmail,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Corpo de `POST /leads/intake`. É o CONTRATO com quem captura o lead lá fora
 * (hoje o site da ProgrameAi, em `site-v2/src/lib/entrega-lead.ts` → tipo
 * `PayloadLead`): os nomes dos campos são os de lá, em pt-BR, e mudar um nome
 * aqui quebra a captação em produção sem quebrar nenhum teste.
 *
 * O `ValidationPipe` global roda com `forbidNonWhitelisted`, então campo que a
 * origem mandar e não estiver declarado aqui responde 400 em vez de ser
 * ignorado calado — é de propósito: dado de lead perdido em silêncio é pior do
 * que uma integração que falha alto.
 *
 * Campo sem valor chega como `null` (a origem diferencia "não perguntamos" de
 * "perguntamos e veio vazio"), e `@IsOptional()` do class-validator ignora
 * `null` **e** `undefined` — é por isso que os opcionais aceitam os dois.
 *
 * Validador novo aqui nasce com `message` em pt-BR: sem ela o class-validator
 * responde em inglês, e nesta rota a mensagem é o único retorno que quem integra
 * de fora tem para descobrir qual campo reprovou.
 */
export class IntakeLeadDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(120, { message: 'O nome deve ter no máximo 120 caracteres.' })
  nome: string;

  /** DDD + número, só dígitos e sem o 55. É a chave de deduplicação. */
  @Matches(/^[1-9][0-9]\d{8,9}$/, {
    message: 'WhatsApp inválido: envie DDD e número, só dígitos, sem o 55.',
  })
  whatsapp: string;

  /** O mesmo número em E.164. Ausente, é montado a partir do `whatsapp`. */
  @IsOptional()
  @IsString({ message: 'Telefone inválido.' })
  @MaxLength(24, { message: 'O telefone deve ter no máximo 24 caracteres.' })
  telefone?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido.' })
  @MaxLength(160, { message: 'O e-mail deve ter no máximo 160 caracteres.' })
  email?: string | null;

  /** Nome da empresa/clínica, quando a origem pergunta. Vira o nome do cliente. */
  @IsOptional()
  @IsString({ message: 'Empresa inválida.' })
  @MaxLength(120, { message: 'A empresa deve ter no máximo 120 caracteres.' })
  empresa?: string | null;

  @IsOptional()
  @IsString({ message: 'Cidade inválida.' })
  @MaxLength(80, { message: 'A cidade deve ter no máximo 80 caracteres.' })
  cidade?: string | null;

  @IsOptional()
  @IsString({ message: 'Mensagem inválida.' })
  @MaxLength(2000, {
    message: 'A mensagem deve ter no máximo 2000 caracteres.',
  })
  mensagem?: string | null;

  /** Rótulo da origem ("site-institucional"). Vira tag do cliente. */
  @IsString({ message: 'A origem é obrigatória.' })
  @MaxLength(60, { message: 'A origem deve ter no máximo 60 caracteres.' })
  origem: string;

  /** Caminho da página que capturou ("/", "/agenda-cheia"). */
  @IsOptional()
  @IsString({ message: 'Página inválida.' })
  @MaxLength(200, { message: 'A página deve ter no máximo 200 caracteres.' })
  pagina?: string | null;

  /** Quando a origem recebeu, em ISO 8601. Ausente, vale a hora da ingestão. */
  @IsOptional()
  @IsISO8601(
    {},
    { message: 'Data de recebimento inválida: use o formato ISO 8601.' },
  )
  recebidoEm?: string | null;

  /**
   * Respostas da qualificação em código, como a origem as guarda. JSON livre de
   * propósito: o formato é da origem (as perguntas mudam sem avisar o CRM), e
   * quem lê é humano, pela nota do cliente. Não é validado campo a campo.
   */
  @IsOptional()
  @IsObject({ message: 'A qualificação deve ser um objeto JSON.' })
  qualificacao?: Record<string, unknown> | null;

  /** As mesmas respostas por extenso, prontas para o minuto antes de ligar. */
  @IsOptional()
  @IsString({ message: 'Resumo inválido.' })
  @MaxLength(4000, { message: 'O resumo deve ter no máximo 4000 caracteres.' })
  resumo?: string | null;

  /** Cenário que a qualificação apontou. Vai no corpo do aviso, sozinho. */
  @IsOptional()
  @IsString({ message: 'Cenário inválido.' })
  @MaxLength(160, { message: 'O cenário deve ter no máximo 160 caracteres.' })
  cenario?: string | null;
}
