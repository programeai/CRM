# Autohospedagem

Como subir a sua própria instância do CRM numa VPS, do zero, em cerca de dez
minutos. É **gratuito e não exige licença nenhuma** (Apache 2.0).

O stack é o [`docker-compose.selfhost.yml`](../docker-compose.selfhost.yml):
quatro containers, autossuficiente, com **HTTPS automático**. Não depende de nada
pré-existente na VPS além do Docker.

> **Este arquivo ou o `docker-compose.prod.yml`?** Use **este**. O
> `docker-compose.prod.yml` é o deploy do mantenedor: ele puxa imagens de um
> Docker Hub específico e espera um Traefik já configurado no host, então não
> funciona copiado e colado. Comparação completa em
> [Qual compose usar](#qual-compose-usar).

## O que você vai precisar

| Requisito | Detalhe |
| --- | --- |
| **VPS** | 2 GB de RAM e 2 vCPU. O build do front consome bem mais memória que a aplicação em si — em 1 GB o `vite build` é morto pelo OOM killer (contorno em [Problemas comuns](#problemas-comuns)). |
| **Disco** | 10 GB. O build usa alguns GB em camadas intermediárias; sobra folga para o banco. |
| **Docker** | Engine 24+ com o plugin Compose v2 (`docker compose`, sem hífen). |
| **Domínio** | Um nome (ex.: `crm.suaempresa.com.br`) com registro **A** apontando para o IP da VPS. Endereço IP puro **não serve** — ver [Por que um domínio é obrigatório](#por-que-um-domínio-é-obrigatório). |
| **Portas 80 e 443** | Abertas na internet. A 80 é usada pela Let's Encrypt para validar o domínio e para redirecionar `http` → `https`. |

Se o Docker ainda não estiver instalado:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # depois saia e entre de novo na sessão SSH
```

## Subindo

**1. Aponte o DNS primeiro.** O certificado só é emitido depois que o domínio
resolve para esta VPS. Confira antes de continuar:

```bash
dig +short crm.suaempresa.com.br    # tem que devolver o IP da sua VPS
```

**2. Clone o repositório**

```bash
git clone https://github.com/programeai/CRM.git
cd CRM
```

**3. Gere o `.env`**

```bash
./scripts/gerar-env-autohospedagem.sh
```

O script copia [`.env.selfhost.example`](../.env.selfhost.example) para `.env`
(com permissão `600`) e sorteia os quatro segredos obrigatórios —
`POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `JWT_ACCESS_SECRET` e
`JWT_REFRESH_SECRET` — com `openssl rand -hex 32`. Ele nunca sobrescreve um
`.env` que já exista.

**4. Preencha os dois valores que só você sabe**

```bash
nano .env
```

```env
CRM_DOMAIN=crm.suaempresa.com.br
ACME_EMAIL=voce@suaempresa.com.br
```

Todo o resto é opcional — SMTP, login social, captcha, Stripe — e em branco se
desativa sozinho. Cada bloco do `.env` explica o que ganha quem preenche.

**5. Suba**

```bash
docker compose -f docker-compose.selfhost.yml up -d --build
```

O `--build` compila as imagens da API e do front a partir do código do
repositório. **A primeira vez leva de 5 a 15 minutos** e é a etapa mais lenta de
tudo; nos comandos seguintes o cache do Docker faz o resto ser quase instantâneo.

**6. Acompanhe o primeiro boot**

```bash
docker compose -f docker-compose.selfhost.yml logs -f
```

Você está esperando três coisas:

- `crm-postgres` → `database system is ready to accept connections`
- `crm-api` → `==> Migrations aplicadas.` e depois `==> Iniciando a API...`
- `crm-caddy` → `certificate obtained successfully`

Confira que os quatro containers estão saudáveis:

```bash
docker compose -f docker-compose.selfhost.yml ps
```

**7. Crie a sua conta**

Abra `https://crm.suaempresa.com.br/registrar`.

Não existe usuário padrão nem seed de admin em produção — a primeira conta é a
que você cria aqui, e ela nasce **owner** da workspace (dona dos dados, com todas
as permissões).

> As credenciais `admin@crm.local` / `changeme123` que aparecem no README são do
> **seed de demonstração do ambiente de desenvolvimento** e não existem nesta
> instância.

**8. Feche o autocadastro**

Este é o passo que mais gente esquece. Com o cadastro aberto, qualquer pessoa que
souber o endereço cria uma conta na sua instância.

```bash
sed -i 's/^REGISTRATION_ENABLED=true/REGISTRATION_ENABLED=false/' .env
docker compose -f docker-compose.selfhost.yml up -d
```

Isso fecha `/registrar` **e** a criação de conta nova via OAuth. Convidar
colaboradores continua funcionando — é uma ação sua, de dentro do CRM, e não é
afetada.

Se preferir manter o cadastro aberto (uma instância pública, por exemplo),
configure o captcha (`TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`). Ele
reduz abuso automatizado, mas **não é controle de acesso**.

## Como o stack é montado

```
        internet
           │  :80 → redireciona para :443
           │  :443
     ┌─────▼──────────────────────────────────┐
     │ crm-caddy      TLS automático          │   rede "publica"
     │   /api/*  ─────────────────┐           │
     │   todo o resto ──┐         │           │
     └──────────────────┼─────────┼───────────┘
                        │         │
            ┌───────────▼──┐  ┌───▼─────────────┐
            │ crm-web      │  │ crm-api         │
            │ nginx :80    │  │ NestJS :3000    │
            │ bundle Vite  │  └───┬─────────────┘
            └──────────────┘      │  rede "interna"
                              ┌───▼─────────────┐
                              │ crm-postgres    │
                              │ :5432 (fechado) │
                              └─────────────────┘
```

O que essa topologia garante:

- **Front e API na mesma origem.** O bundle é buildado com
  `VITE_API_URL=/api/v1`, um caminho relativo — logo não há CORS nem cookie
  cross-site, e `FRONTEND_URL`, `API_URL` e `COOKIE_DOMAIN` são todos o mesmo
  host.
- **O Postgres não é exposto.** Sem `ports`, ele só existe dentro da rede
  `interna` — nem o Caddy o alcança. Acesso por `docker compose exec`.
- **TLS sem configuração.** O Caddy pede o certificado à Let's Encrypt no
  primeiro boot e renova sozinho depois. Os certificados vivem no volume
  `caddy_data`.
- **Isolamento por owner no banco.** A aplicação conecta como `crm_app`, uma role
  `NOSUPERUSER/NOBYPASSRLS` sujeita às policies de Row Level Security por
  `ownerId`. Migrations e crons usam `crm_user`, dono do schema. É por isso que
  `APP_DB_PASSWORD` existe e é obrigatória.

## Por que um domínio é obrigatório

O CRM guarda a sessão num cookie `httpOnly` marcado como `Secure`, e navegador
não aceita cookie `Secure` numa origem sem HTTPS válido. Com um endereço IP puro
não há certificado possível, então o cookie é descartado silenciosamente: a tela
de login aceita a senha e volta para a tela de login, **sem nenhum erro**.

Se quiser apenas experimentar na sua própria máquina, use `CRM_DOMAIN=localhost`.
O Caddy assina com a CA interna dele — o navegador mostra aviso de certificado,
mas o `localhost` é tratado como origem segura e o login funciona. Para uso real,
domínio.

## Operação

Todos os comandos rodam de dentro do diretório do repositório clonado.

```bash
CO="docker compose -f docker-compose.selfhost.yml"

$CO ps                     # estado e saúde dos containers
$CO logs -f api            # log da API (JSON estruturado, uma linha por evento)
$CO logs -f caddy          # emissão/renovação de certificado
$CO restart api
$CO down                   # derruba tudo, PRESERVANDO os dados
```

Health da API sem passar pelo proxy:

```bash
$CO exec api node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>r.json()).then(console.log)"
```

Abrir o psql:

```bash
$CO exec postgres psql -U crm_user -d crm_db
```

### Atualizando para uma versão nova

```bash
git pull
docker compose -f docker-compose.selfhost.yml up -d --build
```

As migrations do banco são aplicadas **automaticamente** a cada start da API, pelo
entrypoint. Nada de manual.

> Tire um backup antes de atualizar. Migration não tem botão de desfazer.

### Backup do banco

Dump pontual:

```bash
docker compose -f docker-compose.selfhost.yml exec -T postgres \
  pg_dump -U crm_user -d crm_db --format=custom > "crm-$(date +%F).dump"
```

Rotina no cron do host, com retenção — [`scripts/backup-postgres.sh`](../scripts/backup-postgres.sh):

```cron
0 2 * * * DEPLOY_DIR=/caminho/do/CRM COMPOSE_FILE=docker-compose.selfhost.yml BACKUP_DIR=/var/backups/crm /caminho/do/CRM/scripts/backup-postgres.sh >> /var/log/crm-backup.log 2>&1
```

Restauração:

```bash
docker compose -f docker-compose.selfhost.yml exec -T postgres \
  pg_restore --clean --if-exists -U crm_user -d crm_db < crm-2026-07-28.dump
```

O volume `crm_pgdata` sobrevive a `down` e `up`. **`docker compose down -v` apaga
o banco inteiro** — não rode isso numa instância com dados.

## Problemas comuns

| Sintoma | Causa e solução |
| --- | --- |
| `required variable CRM_DOMAIN is missing a value` | Você não editou o `.env`. O compose se recusa a subir sem domínio, e-mail ACME e os quatro segredos — é de propósito. |
| Container `crm-caddy` reiniciando com `wrong argument count ... 'email'` | `ACME_EMAIL` está vazia no `.env`. |
| Caddy não obtém o certificado | Nesta ordem: (1) o DNS aponta para esta VPS? `dig +short <dominio>`; (2) as portas 80 e 443 estão abertas no firewall **e** no painel do provedor? (3) `$CO logs caddy` traz o motivo. Cuidado com o [rate limit da Let's Encrypt](https://letsencrypt.org/docs/rate-limits/) ao repetir tentativas — teste a configuração antes de insistir. |
| Build do front morre com `Killed` ou código 137 | Falta de RAM no build (o `vite build` é o pico). Adicione swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`. |
| `crm-api` reinicia com `APP_DB_PASSWORD nao definida` | A variável ficou em branco. Sem ela a role `crm_app` continuaria com a senha de desenvolvimento, que é **pública neste repositório** — por isso o boot aborta em vez de seguir. |
| `APP_DB_PASSWORD nao pode conter apostrofo nem barra invertida` | Ela entra literal num `ALTER ROLE`. Gere com `openssl rand -hex 32`, que produz só hexadecimal. |
| `Migration marcada como falha no banco (P3009)` | Uma migration quebrou antes. O log da API traz as duas consultas do diagnóstico. Não reinicie em loop: a API não sobe até isso ser resolvido. |
| Login aceita a senha e volta para a tela de login | Cookie `Secure` descartado por falta de HTTPS válido. Ver [Por que um domínio é obrigatório](#por-que-um-domínio-é-obrigatório). |
| Trocou `VITE_TURNSTILE_SITE_KEY` e nada mudou | As `VITE_*` são embutidas no bundle em **build-time**. Precisa de `up -d --build`, não só de restart. |
| E-mail de convite ou de redefinição de senha não chega | Sem `SMTP_HOST` o envio é desativado e o link só é escrito no log: `$CO logs api \| grep -i redefinicao`. |
| Porta 80 já ocupada (`address already in use`) | Outro serviço (nginx ou Apache do host) está na 80. Pare-o, ou use o `docker-compose.prod.yml` com o proxy que você já tem. |

## Qual compose usar

| | `docker-compose.selfhost.yml` | `docker-compose.prod.yml` |
| --- | --- | --- |
| **Para quem** | Quem clona o repositório e quer subir a própria instância | O mantenedor, via GitHub Actions |
| **Imagens** | Compiladas na VPS, do código do repositório | Puxadas de um Docker Hub específico |
| **Reverse proxy / TLS** | Incluído (Caddy, automático) | Traefik **já configurado no host**, com resolver ACME |
| **Pré-requisito na VPS** | Só Docker | Rede externa `traefik-proxy` + resolver ACME + secrets no GitHub |
| **Configuração** | `.env` na raiz | `.env` gerado pelo workflow de deploy a partir de secrets |

Já tem um Traefik rodando e não quer um segundo proxy? Aí o
[`docker-compose.prod.yml`](../docker-compose.prod.yml) é a base certa — troque
os blocos `image:` por `build:` como no selfhost e siga o
[docs/deploy.md](./deploy.md).

## Segurança da sua instância

O que o stack já faz por você: Postgres fechado ao host, isolamento por `ownerId`
via Row Level Security no banco, senha com argon2, refresh token em cookie
`httpOnly` com hash persistido, rate limit em `/auth/*`, HSTS e CSP no nginx do
front, containers rodando como usuário não-root.

O que fica com você:

- **Feche o autocadastro** depois de criar sua conta (passo 8).
- **Firewall**: deixe abertas só 22, 80 e 443. O Postgres não precisa de porta.
- **Backup testado** — backup que nunca foi restaurado não é backup.
- **Nunca commite o `.env`.** Ele já está no `.gitignore`; o script de geração o
  cria com permissão `600`.
- **Atualize** com `git pull` + `up -d --build` quando sair correção de segurança.
- Encontrou uma falha? **Não abra issue pública** — use o
  [reporte privado](https://github.com/programeai/CRM/security/advisories/new).

## Log e observabilidade

Todo container do stack escreve **uma linha JSON por evento** no stdout, com
`evento` estável em pt-BR — formato pronto para Alloy/Loki/Grafana. O log local é
rotacionado em 10 MB × 3 arquivos por container, para não encher o disco.

Para ler no dia a dia basta `docker compose logs`. Para plugar numa stack de
observabilidade, o formato e as consultas prontas estão em
[observabilidade.md](./observabilidade.md).
