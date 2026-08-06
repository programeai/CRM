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

  /*
    ---- Atribuição de anúncio ----

    De qual clique o lead veio. Todos opcionais e todos vazios até o `site-v2`
    passar a enviá-los — a ordem de deploy é API primeiro, site depois, porque o
    inverso responde 400 por `forbidNonWhitelisted` e PERDE o lead.

    Os nomes são o canônico de cada plataforma de propósito: quem integra
    reconhece `fbclid` e `utm_source`, e não reconheceria uma tradução. O único
    em pt-BR é `urlDeEntrada`, que não é nome de plataforma e precisa se
    distinguir de `pagina` (caminho, `/agenda-cheia`) — este é a URL inteira, o
    `event_source_url` da Conversions API.

    Nenhum deles é validado por formato. `@IsUrl` em `urlDeEntrada` reprovaria
    uma URL de staging ou com parâmetro estranho, e reprovar aqui significa
    perder o lead — o dado de contato vale mais do que a limpeza do campo. Os
    limites são generosos pelo mesmo motivo: um `fbclid` cortado é pior do que um
    `fbclid` longo.
  */

  /**
   * O `fbclid` da URL, CRU. Case-sensitive: a doc da Meta é explícita ("do not
   * apply any modifications before using, such as lower or upper case"), então
   * não normalize antes de enviar — o CRM também não normaliza.
   *
   * O instante do clique NÃO vem no corpo: o CRM o estampa a partir de
   * `recebidoEm` (ou da hora da ingestão), que é exatamente o "quando você
   * primeiro observou este fbclid" que a doc pede. É o dado irrecuperável desta
   * fase, e deixá-lo em um lugar só é o que garante que ele nunca falte.
   */
  @IsOptional()
  @IsString({ message: 'fbclid inválido.' })
  @MaxLength(400, { message: 'O fbclid deve ter no máximo 400 caracteres.' })
  fbclid?: string | null;

  /** O cookie `_fbp` do navegador, como ele está (`fb.1.<ms>.<aleatório>`). */
  @IsOptional()
  @IsString({ message: 'fbp inválido.' })
  @MaxLength(100, { message: 'O fbp deve ter no máximo 100 caracteres.' })
  fbp?: string | null;

  /** O `gclid` da URL (Google Ads). Também aceita `gbraid`/`wbraid` no lugar. */
  @IsOptional()
  @IsString({ message: 'gclid inválido.' })
  @MaxLength(400, { message: 'O gclid deve ter no máximo 400 caracteres.' })
  gclid?: string | null;

  /** `utm_source` da URL ("facebook", "google", "instagram"). */
  @IsOptional()
  @IsString({ message: 'utm_source inválido.' })
  @MaxLength(200, {
    message: 'O utm_source deve ter no máximo 200 caracteres.',
  })
  utmSource?: string | null;

  /** `utm_medium` da URL ("cpc", "paid_social", "email"). */
  @IsOptional()
  @IsString({ message: 'utm_medium inválido.' })
  @MaxLength(200, {
    message: 'O utm_medium deve ter no máximo 200 caracteres.',
  })
  utmMedium?: string | null;

  /** `utm_campaign` da URL. */
  @IsOptional()
  @IsString({ message: 'utm_campaign inválido.' })
  @MaxLength(200, {
    message: 'O utm_campaign deve ter no máximo 200 caracteres.',
  })
  utmCampaign?: string | null;

  /** `utm_content` da URL — costuma identificar o criativo. */
  @IsOptional()
  @IsString({ message: 'utm_content inválido.' })
  @MaxLength(200, {
    message: 'O utm_content deve ter no máximo 200 caracteres.',
  })
  utmContent?: string | null;

  /** `utm_term` da URL — costuma identificar a palavra-chave. */
  @IsOptional()
  @IsString({ message: 'utm_term inválido.' })
  @MaxLength(200, { message: 'O utm_term deve ter no máximo 200 caracteres.' })
  utmTerm?: string | null;

  /**
   * A URL COMPLETA onde a pessoa entrou, com esquema e query
   * ("https://programeai.com.br/agenda-cheia?utm_source=facebook"). Diferente de
   * `pagina`, que é só o caminho e vive na nota do cliente.
   */
  @IsOptional()
  @IsString({ message: 'URL de entrada inválida.' })
  @MaxLength(2000, {
    message: 'A URL de entrada deve ter no máximo 2000 caracteres.',
  })
  urlDeEntrada?: string | null;
}
