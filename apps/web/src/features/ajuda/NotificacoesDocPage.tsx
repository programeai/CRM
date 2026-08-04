import { CodeBlock } from '@/components/ui/code-block';
import {
  Codigo,
  Destaque,
  Forte,
  Interno,
  Item,
  Lista,
  P,
  Sub,
} from '@/components/ui/prose';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_DESCRIPTIONS,
  translateNotificationChannelKind,
  translateNotificationType,
} from '@/lib/labels';
import { DocPagina, type DocSecao } from './DocPagina';
import { TabelaDoc } from './TabelaDoc';

/**
 * Como receber os avisos do CRM fora dele. É o contrato do `WebhookChannel` e as
 * regras do `NotificationTargetsService` escritos para quem cola a URL do outro
 * lado.
 *
 * A lista de eventos vem de `@/lib/labels` de propósito: tipo novo no enum
 * aparece aqui sozinho, com a mesma descrição da matriz de eventos da tela de
 * preferências. Ao mudar o corpo enviado pelo webhook ou a política de
 * retentativa, atualize as seções 5 e 7 no mesmo PR.
 */

const PAYLOAD = `{
  "tipo": "PAYMENT_DUE",
  "titulo": "Cobrança a vencer",
  "corpo": "Mensalidade 08/2026 de Clínica Bem Viver, R$ 1.250,00, vence em 07/08/2026.",
  "link": "/financeiro",
  "dados": {
    "clienteNome": "Clínica Bem Viver",
    "valor": 1250
  }
}`;

const PAYLOAD_TESTE = `{
  "tipo": "RECORD_ASSIGNED",
  "titulo": "Teste de integração",
  "corpo": "Se você recebeu esta mensagem, a integração está funcionando.",
  "link": null,
  "dados": null
}`;

const URL_TELEGRAM = `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>`;

/** O endereço desta instância, para o exemplo de link completo sair pronto. */
const APP_URL = window.location.origin;

const CABECALHOS: [string, string][] = [
  ['Content-Type', 'Sempre application/json.'],
  [
    'X-CRM-Delivery',
    'Identificador único desta entrega. Use como chave de idempotência: uma retentativa repete o mesmo valor.',
  ],
  ['X-CRM-Timestamp', 'Momento do envio, em segundos desde 1970.'],
  ['User-Agent', 'CRM-ProgrameAi/1.0'],
];

/** O que vem em `dados`, por evento. */
const DADOS: string[][] = [
  ['RECORD_ASSIGNED', 'entity, entityId'],
  ['FOLLOW_UP_DUE', 'clienteNome'],
  ['DEAL_STALE', 'titulo, clienteNome, estagio'],
  ['PROPOSAL_EXPIRING', 'numero, clienteNome'],
  ['PAYMENT_DUE', 'clienteNome, valor'],
  ['PAYMENT_OVERDUE', 'clienteNome, valor'],
  ['TASK_OVERDUE', 'titulo, clienteNome'],
  ['LEAD_RECEIVED', 'leadNome, origem'],
];

const TENTATIVAS: string[][] = [
  ['1ª', 'Na hora do evento'],
  ['2ª', '1 minuto depois da falha'],
  ['3ª', '5 minutos'],
  ['4ª', '30 minutos'],
  ['5ª', '2 horas'],
  ['última', '8 horas'],
];

const SECOES: DocSecao[] = [
  {
    id: 'como-funciona',
    titulo: 'Destinos, eventos e o estado de cada um',
    corpo: (
      <>
        <P>
          Um <Forte>destino</Forte> é um lugar onde você recebe aviso, mais a
          lista de eventos que quer receber ali. Cada pessoa tem os seus: o que
          você configura vale para as <Forte>suas</Forte> notificações, não para
          as da equipe.
        </P>
        <P>
          A conta já nasce com dois destinos prontos e ativos: a{' '}
          <Forte>{translateNotificationChannelKind('IN_APP')}</Forte> (o sino do
          topo) e o <Forte>{translateNotificationChannelKind('EMAIL')}</Forte> da
          conta. Os dois já vêm marcados em todos os eventos.
        </P>
        <P>
          Uma <Forte>integração</Forte> — webhook, Slack, Discord, Telegram —
          nasce diferente: <Forte>não verificada e inativa</Forte>. Ela só passa a
          entregar depois que você clica em <Forte>Testar e ativar</Forte> e o CRM
          consegue entregar de verdade naquele endereço. Enquanto isso, a caixa
          "Ativo" fica desabilitada de propósito.
        </P>
        <Destaque>
          <P>
            Criar integração exige a permissão <Forte>Integrar notificações</Forte>
            . O motivo é o conteúdo: o corpo da mensagem carrega nome de cliente e
            valor de cobrança, e quem tem essa permissão decide para qual sistema
            de fora isso vai.
          </P>
        </Destaque>
      </>
    ),
  },
  {
    id: 'eventos',
    titulo: 'Os eventos e quando saem',
    corpo: (
      <>
        <TabelaDoc
          colunas={['Evento', 'Identificador', 'Quando dispara']}
          linhas={NOTIFICATION_TYPES.map((tipo) => [
            translateNotificationType(tipo),
            <Codigo key={tipo}>{tipo}</Codigo>,
            NOTIFICATION_TYPE_DESCRIPTIONS[tipo],
          ])}
        />
        <P>
          O identificador é o valor que chega no campo <Codigo>tipo</Codigo> do
          webhook — é por ele que a sua automação decide o que fazer.
        </P>
        <Lista>
          <Item>
            <Forte>Ninguém é notificado da própria ação.</Forte> Atribuir um
            registro a si mesmo não gera aviso.
          </Item>
          <Item>
            Os avisos de prazo (follow-up, proposta, cobrança, demanda) são
            varridos <Forte>uma vez por dia, de manhã</Forte>, e cada registro
            avisa uma vez por dia — não a cada minuto.
          </Item>
          <Item>
            Evento novo que o CRM passe a oferecer <Forte>não</Forte> entra
            sozinho nos destinos que já existem. Marque-o na grade do destino
            quando ele aparecer.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'canais',
    titulo: 'O que preencher em cada canal',
    corpo: (
      <>
        <Sub nivel={4}>{translateNotificationChannelKind('SLACK')}</Sub>
        <P>
          Crie um <Forte>Incoming Webhook</Forte> no app do Slack, escolha o canal
          e cole a URL <Codigo>https://hooks.slack.com/services/…</Codigo>. A
          mensagem chega com o título em negrito e um link "Abrir no CRM".
        </P>
        <Sub nivel={4}>{translateNotificationChannelKind('DISCORD')}</Sub>
        <P>
          Nas configurações do canal, em <Forte>Integrações → Webhooks</Forte>,
          crie um webhook e copie a URL. O CRM corta a mensagem em 2000
          caracteres, o limite do Discord.
        </P>
        <Sub nivel={4}>{translateNotificationChannelKind('TELEGRAM')}</Sub>
        <P>
          Aqui você não cola URL: informa o <Forte>token do bot</Forte> (o que o
          @BotFather devolve, no formato <Codigo>123456789:AAE…</Codigo>) e o{' '}
          <Forte>chat id</Forte> do destino. Grupo tem id negativo (
          <Codigo>-1001234567890</Codigo>); canal público pode ser{' '}
          <Codigo>@nome_do_canal</Codigo>. O bot precisa ter sido adicionado ao
          grupo antes do teste. O CRM monta o endereço assim:
        </P>
        <CodeBlock code={URL_TELEGRAM} label="Endereço montado" />
        <Sub nivel={4}>{translateNotificationChannelKind('WEBHOOK')}</Sub>
        <P>
          Para qualquer outro sistema — n8n, Make, Zapier, um endpoint seu. Cole a
          URL que recebe <Codigo>POST</Codigo> e leia a seção 5 para o formato do
          corpo.
        </P>
        <Sub nivel={4}>{translateNotificationChannelKind('EMAIL')}</Sub>
        <P>
          Você pode cadastrar outros endereços além do e-mail da conta — um
          pessoal, o de um sócio. Depende de servidor de e-mail configurado na
          instância; sem ele, o CRM não falha, apenas não entrega por e-mail.
          Além do aviso na hora, há um <Forte>resumo diário</Forte> por e-mail,
          com o que aconteceu nas últimas 24 horas.
        </P>
        <Sub nivel={4}>{translateNotificationChannelKind('IN_APP')}</Sub>
        <P>
          O sino do topo. Não precisa de configuração e não pode ser removida —
          se preferir não receber ali, desative. O histórico continua na central
          mesmo depois de desativar ou remover outros destinos.
        </P>
      </>
    ),
  },
  {
    id: 'url',
    titulo: 'Regras da URL',
    corpo: (
      <>
        <P>
          O CRM recusa o cadastro na hora se o endereço não passar por estas
          regras:
        </P>
        <Lista>
          <Item>
            <Forte>HTTPS obrigatório.</Forte> <Codigo>http://</Codigo> é
            recusado.
          </Item>
          <Item>
            <Forte>Porta padrão.</Forte> Se você escrever a porta, ela tem de ser
            a 443.
          </Item>
          <Item>
            <Forte>Endereço público.</Forte> Domínio que resolve para rede
            interna — <Codigo>localhost</Codigo>, <Codigo>10.x</Codigo>,{' '}
            <Codigo>192.168.x</Codigo>, <Codigo>169.254.x</Codigo> — é recusado.
            Um serviço rodando na sua máquina precisa de um túnel público para
            receber.
          </Item>
          <Item>
            <Forte>Domínio que resolve.</Forte> Se o DNS não responde, o CRM
            avisa em vez de cadastrar um destino que nunca entregaria.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'payload',
    titulo: 'O corpo que o webhook recebe',
    corpo: (
      <>
        <P>
          Sempre <Codigo>POST</Codigo> com <Codigo>application/json</Codigo>, um
          aviso por chamada, cinco campos:
        </P>
        <CodeBlock code={PAYLOAD} label="Corpo enviado" />
        <TabelaDoc
          colunas={['Campo', 'Conteúdo']}
          linhas={[
            [
              <Codigo key="t">tipo</Codigo>,
              'O identificador do evento, da tabela da seção 2.',
            ],
            [
              <Codigo key="ti">titulo</Codigo>,
              'Texto curto em pt-BR, já pronto para exibir.',
            ],
            [
              <Codigo key="c">corpo</Codigo>,
              'A frase completa do aviso, em texto puro — nunca HTML.',
            ],
            [
              <Codigo key="l">link</Codigo>,
              <>
                Caminho <Forte>relativo</Forte> da tela do registro (
                <Codigo>/financeiro</Codigo>, <Codigo>/propostas/&lt;id&gt;</Codigo>
                ), ou <Codigo>null</Codigo>. Para o link completo, junte o
                endereço deste CRM na frente: <Codigo>{APP_URL}/financeiro</Codigo>
                . Slack, Discord e Telegram já recebem o link montado.
              </>,
            ],
            [
              <Codigo key="d">dados</Codigo>,
              <>
                Os campos crus do evento, para a sua automação filtrar sem
                precisar interpretar o texto. Pode ser <Codigo>null</Codigo>.
              </>,
            ],
          ]}
        />
        <Sub nivel={4}>Cabeçalhos</Sub>
        <TabelaDoc
          colunas={['Cabeçalho', 'Para que serve']}
          linhas={CABECALHOS.map(([nome, uso]) => [
            <Codigo key={nome}>{nome}</Codigo>,
            uso,
          ])}
        />
        <Sub nivel={4}>O que vem em dados</Sub>
        <TabelaDoc
          colunas={['Evento', 'Campos']}
          linhas={DADOS.map(([tipo, campos]) => [
            <Codigo key={tipo}>{tipo}</Codigo>,
            <Codigo key={`${tipo}-c`}>{campos}</Codigo>,
          ])}
        />
        <Destaque>
          <P>
            <Forte>Não há assinatura no envio.</Forte> Sem HMAC, sem segredo
            compartilhado: quem conhece a URL consegue mandar corpo parecido para
            ela. Portanto a <Forte>URL é a credencial</Forte> — trate como senha,
            não a publique em repositório e prefira um caminho longo e aleatório.
            Se ela vazar, apague o destino e crie outro: não existe rotação de URL,
            porque trocar o endereço é criar outro destino.
          </P>
        </Destaque>
      </>
    ),
  },
  {
    id: 'testar',
    titulo: 'Testar e ativar',
    corpo: (
      <>
        <P>
          O botão <Forte>Testar e ativar</Forte> não simula nada: ele entrega uma
          mensagem real no endereço cadastrado. Dando certo, o destino fica
          verificado e ativo na mesma hora. Dando errado, o CRM mostra o motivo
          que veio do outro lado e o destino continua desligado.
        </P>
        <CodeBlock code={PAYLOAD_TESTE} label="Corpo do teste" />
        <P>
          O teste chega com <Codigo>tipo</Codigo> de{' '}
          <Codigo>RECORD_ASSIGNED</Codigo> — não trate esse valor como o único
          sinal do que aconteceu, ou o seu fluxo vai reagir ao teste como se fosse
          uma atribuição de verdade. O <Codigo>titulo</Codigo> distingue.
        </P>
        <P>
          Central e e-mail não têm teste: eles já nascem verificados. Para
          conferir o e-mail, marque um evento e espere ele acontecer.
        </P>
      </>
    ),
  },
  {
    id: 'entrega',
    titulo: 'Entrega, retentativa e falha',
    corpo: (
      <>
        <Lista>
          <Item>
            Sucesso é qualquer resposta <Forte>2xx</Forte> em até{' '}
            <Forte>10 segundos</Forte>. Responda rápido e processe depois: o CRM
            desiste da conexão no timeout e trata como falha.
          </Item>
          <Item>
            Falhando, o CRM tenta de novo até <Forte>seis vezes no total</Forte>,
            com espera crescente. Esgotadas as tentativas, aquele aviso é marcado
            como falho e não volta.
          </Item>
          <Item>
            A retentativa repete o mesmo <Codigo>X-CRM-Delivery</Codigo>. Use-o
            para não processar o mesmo aviso duas vezes.
          </Item>
          <Item>
            Um destino que falha não afeta os outros: o mesmo aviso pode chegar no
            Slack e falhar no seu webhook.
          </Item>
          <Item>
            Remover um destino não apaga o histórico da central, e avisos que
            estavam na fila para ele são simplesmente descartados.
          </Item>
        </Lista>
        <TabelaDoc
          colunas={['Tentativa', 'Quando']}
          linhas={TENTATIVAS.map(([n, quando]) => [n, quando])}
        />
        <P>
          Vale para todos os canais de integração, não só o webhook genérico — o
          Telegram, por exemplo, recusa mensagem quando o bot não está no grupo, e
          isso conta como falha e entra na fila de retentativa.
        </P>
      </>
    ),
  },
  {
    id: 'lead',
    titulo: 'Receber o lead assim que ele entra',
    corpo: (
      <>
        <P>
          O caso mais comum de webhook é reagir a lead novo. Marque só o evento{' '}
          <Forte>{translateNotificationType('LEAD_RECEIVED')}</Forte> no destino e
          a sua automação recebe <Codigo>leadNome</Codigo> e{' '}
          <Codigo>origem</Codigo> em <Codigo>dados</Codigo> no instante da
          entrada.
        </P>
        <P>
          Só quem recebe o aviso do lead dispara o webhook: é o responsável do
          canal de captação, ou o owner se o canal não tiver responsável. Se o
          seu fluxo depende disso, confira quem é o responsável em{' '}
          <Interno to="/administracao/captacao">Administração → Captação</Interno>{' '}
          e veja{' '}
          <Interno to="/ajuda/captacao">como entregar lead no CRM</Interno>.
        </P>
        <P>
          Telefone e e-mail do lead <Forte>não</Forte> vão no corpo do aviso, de
          propósito — ele viaja para fora do CRM. Para os dados de contato, sua
          automação precisa buscar o cadastro no CRM ou já tê-los na origem.
        </P>
      </>
    ),
  },
];

export default function NotificacoesDocPage() {
  return (
    <DocPagina
      titulo="Receber notificações fora do CRM"
      descricao="Como configurar cada destino de aviso, o que o Slack, o Telegram e um webhook exigem, e o formato exato do que o CRM envia."
      secoes={SECOES}
    />
  );
}
