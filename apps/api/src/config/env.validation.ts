import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri().required(), // crm_user (migrations/seed/crons — superuser, bypassa RLS)
  APP_DATABASE_URL: Joi.string().uri().required(), // crm_app (conexão da app — sujeita a RLS)
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  FRONTEND_URL: Joi.string().uri().required(),
  COOKIE_DOMAIN: Joi.string().default('localhost'),
  // Quantidade de proxies confiáveis à frente da API (`trust proxy` do Express).
  // É o que faz req.ip ser o IP do cliente e não o do proxy — e req.ip é a chave
  // do rate limit (ThrottlerGuard) e o `remoteip` enviado ao Turnstile.
  //   1 → topologia padrão: só o reverse proxy do host (Traefik).
  //   0 → API exposta direto, sem proxy nenhum na frente.
  //   2 → CDN + proxy (ex.: Cloudflare na frente do Traefik).
  // Nunca use um valor maior do que a quantidade real de saltos: o excedente
  // passa a confiar em `x-forwarded-for` escrito pelo próprio cliente.
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(1),
  // Base pública da API, usada para montar o redirect_uri do OAuth
  // (deve bater com o cadastrado no provedor). Ex.: http://localhost:3000
  API_URL: Joi.string().uri().default('http://localhost:3000'),
  // Credenciais OAuth — opcionais: cada provedor só é habilitado se as suas
  // duas variáveis estiverem presentes.
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),
  GITHUB_CLIENT_ID: Joi.string().allow('').default(''),
  GITHUB_CLIENT_SECRET: Joi.string().allow('').default(''),
  // Captcha (Cloudflare Turnstile) — opcional: em branco desativa a verificação.
  TURNSTILE_SECRET_KEY: Joi.string().allow('').default(''),
  // Autocadastro público. Default `true` para não travar quem sobe o projeto do
  // zero: com o cadastro fechado a primeira conta seria impossível de criar (não
  // há seed de admin em produção). Numa instância já em uso, `false` fecha as
  // DUAS portas de autocadastro — POST /auth/register e a criação de conta nova
  // pelo OAuth. O convite de colaborador é do owner e não é afetado.
  REGISTRATION_ENABLED: Joi.boolean().default(true),
  // SMTP para envio de e-mail (ex.: redefinição de senha) — opcional: sem
  // SMTP_HOST o envio é desativado e o link é apenas logado (ver MailService).
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASSWORD: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().allow('').default(''),
  // Ingestão externa de lead (POST /leads/intake) — opcional, e as DUAS são
  // necessárias juntas: faltando qualquer uma a rota responde 503 em vez de
  // aceitar lead sem saber onde gravar. O token é o segredo compartilhado com
  // quem captura (o site); o e-mail é o do OWNER cuja workspace recebe.
  // Gerar o token com `openssl rand -base64 48`. Mínimo de 32 caracteres: é a
  // única credencial de uma rota pública de escrita.
  LEAD_INTAKE_TOKEN: Joi.string().allow('').min(32).default(''),
  // `tlds: false` porque a validação de TLD do Joi usa uma lista própria: com ela
  // ligada, o boot morre em domínio interno (`@empresa.local`) e em qualquer TLD
  // novo que a lista ainda não conheça. Aqui só interessa o formato.
  LEAD_INTAKE_OWNER_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .allow('')
    .default(''),
  // Billing (Stripe) — opcional: só é usado na instância SaaS hospedada pelo
  // owner. Na autohospedagem, BILLING_ENABLED fica false e o Stripe nunca
  // é inicializado (ver StripeService).
  BILLING_ENABLED: Joi.boolean().default(false),
  STRIPE_SECRET_KEY: Joi.string().allow('').default(''),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  STRIPE_PRICE_ID: Joi.string().allow('').default(''),
});
