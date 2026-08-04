# Primeiros passos

Guia para quem acabou de criar a conta e vai configurar o CRM para a própria
agência. Leva uns quinze minutos.

Se você ainda não tem uma instância no ar, comece por
[autohospedagem.md](../autohospedagem.md).

## O que a conta nova já vem pronta

A primeira conta criada numa instância nasce **owner** da workspace: dona dos
dados, com todas as permissões, e não pode ser desativada. Ela já vem
provisionada — você não configura nada disso do zero:

| O que | Conteúdo inicial |
| --- | --- |
| **Funil** | 7 estágios: Novo lead, Contato feito, Reunião/Diagnóstico, Proposta enviada, Negociação, Ganhou, Perdeu |
| **Tipos de serviço** | Software, Website, Tráfego pago |
| **Fontes de lead** | Indicação, Tráfego pago, Orgânico, Prospecção ativa, Outro |
| **Tipos de atividade** | Anotação, Ligação, Reunião, E-mail, WhatsApp, Follow-up |
| **Motivos de perda** | Preço, Prazo, Sem resposta, Escolheu concorrente, Sem verba, Fora do perfil, Outro |
| **Papel** | "Administrador" — acesso total, papel do sistema (não editável nem excluível) |
| **Notificações** | Destinos no app e por e-mail, já ligados |

Tudo isso é **seu**, não é catálogo global: renomeie, reordene, acrescente e
exclua livremente. Mudar uma lista aqui não afeta nenhuma outra conta.

> **Assinatura.** A conta nasce com 14 dias de teste registrados. Em instância
> autohospedada (`BILLING_ENABLED=false`, o padrão) isso não bloqueia nada e
> nenhuma tela de cobrança aparece — o campo existe, o portão não.

## 1. Ajuste o funil ao seu processo

**Pipeline → Configurar estágios.**

Arraste para reordenar, renomeie, e exclua o que não usa (só dá para excluir
estágio sem oportunidade dentro). Dois marcadores mudam o comportamento do
sistema, não só o nome:

- **Estágio de ganho** — mover uma oportunidade para cá **cria um projeto
  automaticamente** a partir dela e promove o cliente de *Lead* para *Ativo*.
- **Estágio de perda** — mover para cá **exige um motivo de perda** (da sua lista
  de motivos).

Mantenha exatamente um de cada. Renomear "Ganhou" para "Fechado" não muda nada
além do texto; desmarcar o ganho desliga a criação automática de projeto.

## 2. Ajuste os catálogos conforme aparecem

Os quatro catálogos **não têm tela própria de configuração** — de propósito. Cada
um nasce e morre dentro do formulário onde faz falta: ao cadastrar uma
oportunidade, o campo "Tipo de serviço" deixa você criar um tipo novo ali mesmo.

Duas regras que valem a pena saber antes de mexer:

- O tipo de atividade **Follow-up** é primitivo: não pode ser excluído. É ele que
  alimenta os lembretes diários e o bloco "Próximas ações" do Dashboard — sem
  nenhum tipo marcado como follow-up, você perderia os dois.
- Item de catálogo excluído não reescreve o passado: registros antigos continuam
  apontando para o que foi excluído.

## 3. Convide o time

**Administração → Colaboradores → Convidar.**

O convite cria a conta **sem senha** e manda um link de uso único, válido por
**7 dias**. Quem recebe define a senha e já entra autenticado.

- Sem SMTP configurado na instância, **o link aparece na tela** no momento do
  convite — copie e mande pelo canal que preferir. O fluxo não depende de e-mail.
- Emitir um convite novo invalida o anterior: só o último link vale.
- **Desativar** um colaborador derruba a sessão dele na requisição seguinte, sem
  esperar o token expirar. Não apaga nada do que ele produziu.

Colaborador enxerga e escreve **os dados do owner**, limitado pelo papel — e não
paga assento (herda a assinatura do owner).

## 4. Desenhe os papéis

**Administração → Papéis.**

O papel "Administrador" já existe e dá acesso total. Para acesso parcial, crie
papéis próprios combinando as permissões — elas vêm em pares `ver`/`gerenciar`
por módulo (cliente, oportunidade, proposta, projeto, demanda, financeiro), mais
as transversais (catálogo, colaborador, papel, auditoria, lixeira, importação,
integração, assinatura).

Três permissões merecem atenção porque mudam o **escopo do que se vê**, não o que
se pode fazer:

| Permissão | Sem ela | Com ela |
| --- | --- | --- |
| `cliente:ver_todos` | Vê só os clientes de que é responsável, mais os sem responsável | Vê a base inteira |
| `oportunidade:ver_todas` | Idem, no funil e na listagem | Vê o funil inteiro |
| `demanda:ver_todas` | Vê só as próprias demandas, mais as sem responsável | Vê todas |

É o padrão certo para uma equipe de vendas em que cada pessoa cuida da própria
carteira. O efeito colateral a conhecer: **permissão faltando se manifesta como
menu que não aparece** — o item de navegação some quando a pessoa não tem nenhuma
das chaves dele. Se um colaborador disser "não tenho a aba Financeiro", olhe o
papel antes de olhar o código.

## 5. Traga sua base atual

**Administração → Importação** (permissão `dados:importar`).

Importa **clientes e contatos** de uma planilha CSV ou XLSX de até 5 MB. Como
funciona:

1. Você envia a planilha e escolhe o tipo (clientes ou contatos).
2. O CRM devolve uma **prévia** — as colunas que detectou, o mapeamento que
   sugere, uma amostra de 10 linhas já mapeadas e os erros linha a linha. Nada foi
   gravado ainda.
3. Você ajusta o mapeamento, decide o que fazer com cada fonte de lead que não
   existe no seu catálogo (criar, usar uma existente ou ignorar) e confirma.

A importação é **tudo ou nada**: uma linha com erro cancela o lote inteiro, sem
gravar nenhuma. Corrija a planilha e reenvie.

Oportunidades, propostas e o resto não têm importação — entram à mão, conforme o
funil roda. No sentido inverso, a **exportação** em CSV/XLSX existe nas listagens
de clientes, contratos e cobranças.

## 6. Confira as notificações

**Menu do avatar → Configurações → Notificações.**

O CRM emite oito tipos de aviso: follow-up do dia, oportunidade esfriando,
proposta a expirar, cobrança a vencer, cobrança vencida, demanda atrasada,
registro atribuído a você e lead recebido. Cada um pode ir para o app e/ou para o
e-mail.

> Conta criada **antes** de um tipo novo existir não o recebe automaticamente:
> preferência de notificação é opt-in por destino, e nenhuma atualização escreve
> escolha sua. Marque o tipo aqui para passar a receber.

Quando esses avisos chegam:

| Rotina | Horário | O que faz |
| --- | --- | --- |
| Lembretes | 06:00 (BRT) | Follow-up do dia, oportunidade parada há mais de 7 dias, proposta expirando em 3 dias, cobrança vencendo em 3 dias, demanda atrasada |
| Resumo diário | 07:00 (BRT) | Digest por e-mail do que o lembrete emitiu |
| Rotina financeira e de propostas | 03:00 (BRT) | Marca cobrança vencida, gera mensalidade do mês, expira proposta vencida |

Sem `SMTP_HOST` na instância, o canal de e-mail é marcado como *ignorado* — não é
falha, é canal desligado. As notificações no app continuam funcionando.

Para mandar aviso a um sistema de fora (Slack, Telegram, webhook), o formato do
que o CRM envia e as regras de entrega estão em **Ajuda → Notificações**
(`/ajuda/notificacoes`).

## 7. Se você recebe lead de fora do CRM

**Administração → Captação** (permissão `integracao:gerenciar`).

Crie um canal para cada origem externa ("Site institucional", "n8n"). O canal
guarda quem atende o lead e como ele é classificado, e emite a **chave** que
autentica a entrega. A chave aparece **uma única vez**, na criação — quem perde,
rotaciona.

O endereço, os campos aceitos e as respostas de erro estão dentro do próprio app,
em **Ajuda → Captação de leads** (`/ajuda/captacao`) — é a página para mandar a
quem vai configurar o outro lado, e o endereço ali já vem montado com o host da
instância. A referência da rota para quem lê código fica em
[`apps/api/ENDPOINTS.md`](../../apps/api/ENDPOINTS.md) → "Leads (ingestão
externa)".

## 8. Ligue a verificação em duas etapas

**Configurações → Segurança** (não precisa de permissão: é a sua própria conta).

Com o 2FA ligado, entrar passa a pedir a senha **e** um código de 6 dígitos do seu
app autenticador (Google Authenticator, 1Password, Authy, Bitwarden). Quem
descobrir a sua senha ainda não entra.

1. Clique em **Ativar 2FA** e leia o QR com o app. Não conseguiu ler? Use "Não
   consigo ler o QR" e digite o segredo à mão.
2. Digite o código que o app mostrar. **É só aí que o 2FA liga** — um QR que você
   não conseguiu ler não tranca a sua conta.
3. **Guarde os 16 códigos de recuperação.** Copie ou baixe o `.txt`; eles aparecem
   uma única vez.

> **Os códigos de recuperação são a sua saída se você perder o celular.** Cada um
> serve uma vez. Sem eles e sem o app, **ninguém recupera o acesso** — não há
> caminho de suporte que devolva uma conta com 2FA e sem os dois. Guarde-os fora
> do celular: gerenciador de senhas, ou impressos.

Cada pessoa liga o 2FA para si. **O owner não pode exigi-lo do time** nem
configurá-lo por alguém — é decisão de cada titular sobre a própria conta.

Se a aba disser "não está disponível nesta instalação", falta a chave de cifra do
segundo fator no servidor (`TOTP_ENCRYPTION_KEY`) — ver
[autohospedagem.md](../autohospedagem.md).

## 9. Registre o consentimento dos seus clientes

Na ficha do cliente, aba **Consentimento** (e, para cada contato, o ícone de escudo
na aba Contatos).

O CRM guarda **o que cada titular autorizou**: uma linha por finalidade
(comunicação de marketing, contato por WhatsApp, compartilhamento com terceiro,
retenção após o contrato), com o meio pelo qual ele se manifestou, a data e **a
versão do texto que foi mostrado a ele**.

Três coisas que valem entender antes de usar:

- **Revogar não apaga nada.** A revogação entra como registro novo, e a
  manifestação anterior continua no histórico. É o que a LGPD manda preservar
  (art. 8º, § 5º) — e é o que faz o registro servir de prova.
- **Não há "aceitou tudo".** Autorização genérica é nula por lei (art. 8º, § 4º),
  então cada finalidade é registrada por si.
- **O texto é exibido antes de você confirmar**, e é a versão dele que fica
  gravada. Se o texto mudar, os registros antigos continuam apontando para o que
  foi mostrado na época.

> **O CRM registra; ele não comunica.** Nenhum e-mail ou WhatsApp sai do CRM para
> os seus clientes — este é o livro-razão que você consulta **antes** de disparar
> pelas suas ferramentas. Honrar a revogação nelas é o seu passo.

O que você registra aqui entra no seu arquivo de portabilidade (Configurações →
Conta → Exportar meus dados) e é apagado no encerramento da conta.

## Antes de considerar a instância pronta

- [ ] Funil ajustado, com um estágio de ganho e um de perda marcados
- [ ] Time convidado e papéis conferidos
- [ ] SMTP configurado, se você quer convite e redefinição de senha por e-mail
- [ ] **Autocadastro fechado** (`REGISTRATION_ENABLED=false`) — senão qualquer
      pessoa com o endereço cria conta na sua instância
- [ ] Backup do banco agendado — ver [autohospedagem.md](../autohospedagem.md)
- [ ] **Verificação em duas etapas ligada** na sua conta, com os códigos de
      recuperação guardados fora do celular

## Próximo passo

[Fluxo comercial](./fluxo-comercial.md) — como o lead percorre o CRM até virar
receita.
