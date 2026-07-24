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
});
