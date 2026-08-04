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
import { DocPagina, type DocSecao } from './DocPagina';
import { TabelaDoc } from './TabelaDoc';

/**
 * Como receber os eventos de negócio da workspace num sistema de fora. É o
 * contrato do `OwnerWebhooksEmitterService` e do catálogo de
 * `domain/owner-webhook-event.ts` escrito para quem monta o receptor.
 *
 * O catálogo de eventos é repetido aqui porque a página precisa dizer o que vem
 * em `dados` de cada um — o que a API não devolve. Ao acrescentar evento no
 * backend, atualize a tabela da seção 2 no mesmo PR.
 */

const PAYLOAD = `{
  "evento": "cobranca.vencida",
  "registroId": "9f2c8e10-4b77-4a52-8d31-6e0a7c5b9d84",
  "ocorridoEm": "2026-08-04T14:32:07.481Z",
  "dados": {
    "descricao": "Mensalidade 08/2026",
    "clienteNome": "Clínica Bem Viver",
    "valor": 1250,
    "vencimento": "2026-08-01T00:00:00.000Z",
    "link": "/financeiro"
  }
}`;

const PAYLOAD_TESTE = `{
  "evento": "webhook.teste",
  "dados": {
    "mensagem": "Se você recebeu esta mensagem, o webhook está funcionando."
  },
  "ocorridoEm": "2026-08-04T14:30:00.000Z"
}`;

/** Verificação da assinatura, em Node. O corpo tem de ser os BYTES recebidos. */
const VERIFICACAO = `import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

const SEGREDO = process.env.CRM_WEBHOOK_SECRET;
const JANELA_SEGUNDOS = 300; // 5 minutos

const app = express();

// express.raw, NÃO express.json: a assinatura é sobre os bytes que chegaram.
app.post('/crm', express.raw({ type: 'application/json' }), (req, res) => {
  const assinatura = req.header('X-CRM-Signature') ?? '';
  const timestamp = req.header('X-CRM-Timestamp') ?? '';

  // 1. Recalcula sobre o corpo CRU.
  const esperado =
    'sha256=' +
    createHmac('sha256', SEGREDO)
      .update(timestamp + '.' + req.body.toString('utf8'))
      .digest('hex');

  // 2. Compara em tempo constante. Tamanhos diferentes já reprovam.
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.sendStatus(401);
  }

  // 3. Recusa timestamp fora da janela — é isto que impede replay.
  const idade = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(idade) || idade > JANELA_SEGUNDOS) {
    return res.sendStatus(401);
  }

  const evento = JSON.parse(req.body.toString('utf8'));

  // Responda 2xx rápido e processe depois: o CRM desiste em 10 segundos.
  res.sendStatus(200);
  processar(evento).catch(console.error);
});`;

/** Evento, quando dispara e o que vem em `dados`. */
const EVENTOS: string[][] = [
  [
    'lead.recebido',
    'Um lead entrou por um canal de captação.',
    'leadNome, origem, cenario, reincidente, link',
  ],
  [
    'registro.atribuido',
    'Cliente, oportunidade, demanda ou atividade ganhou responsável.',
    'entidade, titulo, responsavelId, link',
  ],
  [
    'negociacao.parada',
    'Oportunidade sem movimento no funil há tempo demais.',
    'titulo, clienteNome, estagio, dataAlvo',
  ],
  [
    'proposta.a_vencer',
    'Proposta enviada perto do fim da validade — ou que acabou de expirar.',
    'numero, clienteNome, validaAte / dataAlvo, link',
  ],
  [
    'cobranca.a_vencer',
    'Recebimento com vencimento próximo.',
    'titulo, clienteNome, valor, dataAlvo',
  ],
  [
    'cobranca.vencida',
    'Recebimento que passou do vencimento.',
    'descricao, clienteNome, valor, vencimento, link',
  ],
  [
    'demanda.atrasada',
    'Demanda com prazo estourado.',
    'titulo, clienteNome, dataAlvo',
  ],
  [
    'atividade.a_fazer',
    'Follow-up agendado chegou na hora.',
    'titulo, clienteNome, dataAlvo',
  ],
];

const CABECALHOS: string[][] = [
  ['Content-Type', 'Sempre application/json.'],
  [
    'X-CRM-Delivery',
    'Identificador único desta entrega. Use como chave de idempotência: uma retentativa repete o mesmo valor.',
  ],
  [
    'X-CRM-Timestamp',
    'Momento do envio, em segundos desde 1970. Entra no cálculo da assinatura e é o insumo anti-replay.',
  ],
  ['X-CRM-Signature', 'sha256= seguido do HMAC. Ver a seção 5.'],
  ['User-Agent', 'CRM-ProgrameAi/1.0'],
];

const TENTATIVAS: string[][] = [
  ['1ª', 'Na hora do evento (até 1 minuto depois: a fila é varrida a cada minuto)'],
  ['2ª', '1 minuto depois da falha'],
  ['3ª', '5 minutos'],
  ['4ª', '30 minutos'],
  ['5ª', '2 horas'],
  ['última', '8 horas'],
];

const SECOES: DocSecao[] = [
  {
    id: 'o-que-e',
    titulo: 'O que sai por aqui',
    corpo: (
      <>
        <P>
          Um <Forte>webhook da workspace</Forte> é um endereço seu que o CRM
          chama quando algo de negócio acontece: um lead entrou, uma cobrança
          venceu, uma demanda atrasou. É o caminho para ligar o CRM a uma
          automação (n8n, Make, Zapier) ou a um sistema seu.
        </P>
        <Destaque>
          <P>
            <Forte>
              Não confunda com as notificações pessoais.
            </Forte>{' '}
            Em{' '}
            <Interno to="/configuracoes/notificacoes">
              Configurações → Notificações
            </Interno>{' '}
            cada pessoa escolhe onde <Forte>ela</Forte> quer ser avisada — o
            Slack dela, o e-mail dela. Aqui é a <Forte>workspace</Forte> que
            fala: o evento sai uma vez por webhook cadastrado, independente de
            quem está logado ou de quem é o responsável pelo registro.
          </P>
        </Destaque>
        <P>
          Toda entrega vai <Forte>assinada</Forte> com um segredo próprio do
          webhook, para o seu receptor confirmar que ela veio do CRM. E toda
          entrega é <Forte>retentada</Forte> se o seu endereço estiver fora do
          ar.
        </P>
      </>
    ),
  },
  {
    id: 'eventos',
    titulo: 'Os eventos e o que vem em cada um',
    corpo: (
      <>
        <P>
          Você escolhe quais eventos cada webhook recebe. Evento não marcado não
          gera entrega nenhuma.
        </P>
        <TabelaDoc
          colunas={['Evento', 'Quando dispara', 'Campos em dados']}
          linhas={EVENTOS.map(([key, quando, campos]) => [
            <Codigo key={key}>{key}</Codigo>,
            quando,
            <Codigo key={`${key}-c`}>{campos}</Codigo>,
          ])}
        />
        <Destaque>
          <P>
            <Forte>O nome do evento é contrato.</Forte> Ele não vai ser
            renomeado: só entram nomes novos. Pode usá-lo como chave de
            roteamento no seu fluxo sem medo — mas trate evento{' '}
            <Forte>desconhecido</Forte> como ignorável, porque nomes novos podem
            aparecer.
          </P>
        </Destaque>
      </>
    ),
  },
  {
    id: 'cadastrar',
    titulo: 'Cadastrar e ativar',
    corpo: (
      <>
        <Lista ordenada>
          <Item>
            Em <Interno to="/administracao/webhooks">Administração →
            Webhooks</Interno>, clique em <Forte>Novo webhook</Forte>. Dê um nome
            que identifique o destino e cole a URL <Forte>HTTPS</Forte> do seu
            receptor.
          </Item>
          <Item>
            Marque os <Forte>eventos</Forte> que ele deve receber.
          </Item>
          <Item>
            Ao salvar, o <Forte>segredo de assinatura</Forte> aparece uma única
            vez. Copie e guarde como senha (variável de ambiente, cofre da
            automação).
          </Item>
          <Item>
            O webhook nasce <Forte>inativo</Forte>. Clique em{' '}
            <Forte>Verificar</Forte>: o CRM entrega uma mensagem de teste no
            endereço, e só se ela chegar o webhook é ativado. Endereço que o CRM
            nunca alcançou produziria só entregas falhas.
          </Item>
        </Lista>
        <CodeBlock code={PAYLOAD_TESTE} label="Corpo do teste" />
        <P>
          O teste chega com <Codigo>evento: "webhook.teste"</Codigo>, que{' '}
          <Forte>não</Forte> está no catálogo — trate-o como um caso próprio no
          seu fluxo, ou simplesmente responda 2xx e ignore.
        </P>
        <Destaque>
          <P>
            <Forte>A URL precisa ser pública e HTTPS na porta 443.</Forte>{' '}
            Endereço de rede interna (loopback, faixa privada, link-local, CGNAT)
            é recusado, em IPv4 e IPv6, e o CRM resolve o DNS para conferir — não
            é só o texto da URL que é validado.
          </P>
          <P>
            Trocar a URL de um webhook existente <Forte>desliga</Forte> ele:
            verifique de novo para reativar.
          </P>
        </Destaque>
      </>
    ),
  },
  {
    id: 'payload',
    titulo: 'O corpo e os cabeçalhos',
    corpo: (
      <>
        <P>
          Sempre <Codigo>POST</Codigo> com <Codigo>application/json</Codigo>, um
          evento por chamada, quatro campos no topo:
        </P>
        <CodeBlock code={PAYLOAD} label="Corpo enviado" />
        <TabelaDoc
          colunas={['Campo', 'Conteúdo']}
          linhas={[
            [
              <Codigo key="e">evento</Codigo>,
              'A chave do evento, da tabela da seção 2.',
            ],
            [
              <Codigo key="r">registroId</Codigo>,
              'O id do registro que originou o evento, na sua workspace.',
            ],
            [
              <Codigo key="o">ocorridoEm</Codigo>,
              'Quando o evento aconteceu, em ISO 8601 UTC. É o momento da EMISSÃO, não o da entrega — numa retentativa ele não muda.',
            ],
            [
              <Codigo key="d">dados</Codigo>,
              'Os campos do evento, para o seu fluxo filtrar sem interpretar texto. O que vem em cada um está na seção 2.',
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
        <P>
          O <Codigo>link</Codigo> que aparece em <Codigo>dados</Codigo> é um
          caminho <Forte>relativo</Forte> da tela do registro. Para o link
          completo, junte o endereço deste CRM na frente.
        </P>
      </>
    ),
  },
  {
    id: 'assinatura',
    titulo: 'Verificar a assinatura',
    corpo: (
      <>
        <P>
          A assinatura é <Codigo>HMAC-SHA256</Codigo>, em hexadecimal, de{' '}
          <Codigo>&lt;timestamp&gt;.&lt;corpo cru&gt;</Codigo>, com o segredo do
          webhook como chave, no cabeçalho <Codigo>X-CRM-Signature</Codigo> com o
          prefixo <Codigo>sha256=</Codigo>. É o mesmo esquema do Stripe.
        </P>
        <P>
          A verificação tem <Forte>três passos</Forte>, e nenhum é opcional:
        </P>
        <Lista ordenada>
          <Item>
            Recalcular o HMAC sobre o <Forte>corpo cru</Forte> — os bytes exatos
            que chegaram, <Forte>antes</Forte> de qualquer parse. Se o seu
            framework já converteu o JSON em objeto e você reserializar, a
            assinatura não vai casar: <Codigo>JSON.stringify</Codigo> não
            reproduz byte a byte o que foi enviado.
          </Item>
          <Item>
            Comparar em <Forte>tempo constante</Forte> (
            <Codigo>crypto.timingSafeEqual</Codigo>), nunca com{' '}
            <Codigo>===</Codigo>.
          </Item>
          <Item>
            Recusar <Codigo>X-CRM-Timestamp</Codigo> muito antigo — 5 minutos é a
            janela recomendada. <Forte>É este passo que impede replay:</Forte> sem
            ele, um corpo capturado hoje pode ser reenviado amanhã com a mesma
            assinatura válida.
          </Item>
        </Lista>
        <CodeBlock
          code={VERIFICACAO}
          label="Node.js"
          copiedLabel="Código copiado."
        />
        <Sub nivel={4}>Rotacionar o segredo</Sub>
        <P>
          A ação <Forte>Rotacionar segredo</Forte> gera outro e o exibe uma vez.
          O anterior <Forte>para de valer na hora</Forte>, sem período de
          convivência: faça a rotação com o valor novo em mãos e troque-o no
          receptor em seguida.
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
            <Forte>10 segundos</Forte>. Responda rápido e processe depois — o CRM
            desiste da conexão no timeout e trata como falha.
          </Item>
          <Item>
            A fila é varrida <Forte>a cada minuto</Forte>. O evento não sai no
            mesmo instante em que acontece: ele é gravado na hora e entregue na
            varredura seguinte.
          </Item>
          <Item>
            Falhando, são <Forte>6 tentativas</Forte> com espera crescente,
            esgotando em cerca de <Forte>10 horas e meia</Forte>. Depois disso a
            entrega é marcada como falha em definitivo e não é retomada.
          </Item>
          <Item>
            Desativar ou excluir o webhook <Forte>descarta</Forte> o que ainda
            estava na fila: quem desligou não quer que o acumulado continue
            saindo.
          </Item>
        </Lista>
        <TabelaDoc
          colunas={['Tentativa', 'Quando']}
          linhas={TENTATIVAS.map(([n, quando]) => [
            <Forte key={n}>{n}</Forte>,
            quando,
          ])}
        />
        <Destaque>
          <P>
            <Forte>A mesma entrega pode chegar duas vezes.</Forte> Uma resposta
            que demorou mais que o timeout conta como falha do lado do CRM mesmo
            que você já a tenha processado. Use{' '}
            <Codigo>X-CRM-Delivery</Codigo> como chave de idempotência: ele
            repete na retentativa, e é assim que o seu fluxo não age duas vezes.
          </P>
        </Destaque>
        <P>
          A coluna <Forte>Último uso</Forte> na tela de webhooks mostra a última
          entrega bem-sucedida — é o jeito mais rápido de confirmar que o
          receptor está vivo.
        </P>
      </>
    ),
  },
  {
    id: 'seguranca',
    titulo: 'O que sai da sua workspace',
    corpo: (
      <>
        <P>
          O corpo carrega <Forte>nome de cliente e valor de cobrança</Forte>.
          Isso é o ponto da feature — e é também o risco dela: um webhook
          apontado para fora é um caminho de saída de dado da sua base.
        </P>
        <Lista>
          <Item>
            A permissão <Forte>Gerenciar webhooks</Forte> é o que controla quem
            pode cadastrar. Ela é separada das outras de propósito.
          </Item>
          <Item>
            HTTPS obrigatório, porta 443, e endereço de rede interna recusado.
          </Item>
          <Item>
            O ping de verificação garante que o endereço existe e responde antes
            de qualquer evento real sair.
          </Item>
          <Item>
            <Forte>A assinatura não protege contra isso.</Forte> Ela protege o
            seu receptor contra corpo forjado; ela não impede que um webhook
            legítimo aponte para o lugar errado. Quem confere o endereço é você.
          </Item>
        </Lista>
        <P>
          Todo cadastro, rotação e exclusão de webhook entra na{' '}
          <Interno to="/administracao/auditoria">trilha de auditoria</Interno>,
          com quem fez e quando.
        </P>
      </>
    ),
  },
];

export default function WebhooksDocPage() {
  return (
    <DocPagina
      titulo="Receber os eventos do CRM"
      descricao="Como cadastrar um endereço que recebe os eventos de negócio da workspace, verificar a assinatura das entregas e lidar com retentativa."
      secoes={SECOES}
    />
  );
}
