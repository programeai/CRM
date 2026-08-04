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
import { endpointDaApi } from './endpoint';

/**
 * Como entregar lead no CRM. É o contrato de `POST /leads/intake` escrito para
 * quem configura a integração do outro lado — o mesmo conteúdo do
 * `IntakeLeadDto` e do `LeadIntakeKeyGuard`, sem obrigar ninguém a ler código.
 *
 * Ao mexer no DTO (campo novo, limite, obrigatoriedade) ou nas respostas do
 * `LeadsIntakeService`, atualize esta página no mesmo PR: ela é a referência que
 * o usuário tem, e um campo documentado a mais aqui vira `400` na prática.
 */

const ENDPOINT = endpointDaApi('leads/intake');

const CURL = `curl -X POST ${ENDPOINT} \\
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "nome": "Ana Ribeiro",
    "whatsapp": "84999398021",
    "origem": "site-institucional"
  }'`;

const CORPO_MINIMO = `{
  "nome": "Ana Ribeiro",
  "whatsapp": "84999398021",
  "origem": "site-institucional"
}`;

const CORPO_COMPLETO = `{
  "nome": "Ana Ribeiro",
  "whatsapp": "84999398021",
  "telefone": "+5584999398021",
  "email": "ana@exemplo.com.br",
  "empresa": "Clínica Bem Viver",
  "cidade": "Mossoró",
  "mensagem": "Quero um site que traga paciente.",
  "origem": "landing-agenda-cheia",
  "pagina": "/agenda-cheia",
  "recebidoEm": "2026-08-04T17:32:00.000Z",
  "resumo": "Faturamento entre 20k e 50k. Sem processo de follow-up.",
  "cenario": "Operação no limite"
}`;

const RESPOSTA_OK = `{
  "status": "criado",
  "clientId": "3f8b1c2e-9a44-4f6d-8b71-2c5e0d9a1f33"
}`;

const RESPOSTA_ERRO = `{
  "message": [
    "WhatsApp inválido: envie DDD e número, só dígitos, sem o 55.",
    "O campo campoInventado não é aceito nesta rota."
  ],
  "error": "Bad Request",
  "statusCode": 400
}`;

/** Campo, tipo, obrigatoriedade, limite e o que ele faz no CRM. */
const CAMPOS: string[][] = [
  [
    'nome',
    'texto',
    'Sim',
    '2 a 120',
    'Nome da pessoa. Vira o contato principal do cadastro.',
  ],
  [
    'whatsapp',
    'texto',
    'Sim',
    '10 ou 11 dígitos',
    'DDD e número, só dígitos, sem o 55. É por ele que o CRM reconhece quem já é cadastrado.',
  ],
  [
    'origem',
    'texto',
    'Sim',
    'até 60',
    'Rótulo de quem capturou. Vira tag do cliente e a primeira linha da nota.',
  ],
  [
    'telefone',
    'texto',
    'Não',
    'até 24',
    'O mesmo número em formato internacional. Em branco, o CRM grava +55 na frente do whatsapp.',
  ],
  ['email', 'e-mail', 'Não', 'até 160', 'Gravado no cliente e no contato.'],
  [
    'empresa',
    'texto',
    'Não',
    'até 120',
    'Quando vem, é o nome do cadastro; o nome da pessoa fica no contato.',
  ],
  ['cidade', 'texto', 'Não', 'até 80', 'Gravado no cliente e citado na nota.'],
  [
    'mensagem',
    'texto',
    'Não',
    'até 2000',
    'O que a pessoa escreveu. Entra na nota, no fim.',
  ],
  [
    'pagina',
    'texto',
    'Não',
    'até 200',
    'Caminho que capturou (/, /agenda-cheia). Entra na nota.',
  ],
  [
    'recebidoEm',
    'data ISO 8601',
    'Não',
    '—',
    'Quando o formulário foi preenchido. Em branco, vale a hora da chamada.',
  ],
  [
    'resumo',
    'texto',
    'Não',
    'até 4000',
    'Texto corrido com o que a origem apurou. Entra na nota como parágrafo.',
  ],
  [
    'cenario',
    'texto',
    'Não',
    'até 160',
    'Uma etiqueta de diagnóstico. Entra na nota e no aviso de lead novo.',
  ],
  [
    'qualificacao',
    'objeto JSON',
    'Não',
    '—',
    'Aceito por compatibilidade e não guardado. Ver o aviso abaixo.',
  ],
];

const ERROS: string[][] = [
  [
    '400',
    'Campo inválido, faltando ou não previsto.',
    'A resposta lista o que reprovou, um item por problema.',
  ],
  [
    '401',
    'Chave ausente, malformada, revogada ou inexistente.',
    'Confira o cabeçalho Authorization e se a chave não foi rotacionada.',
  ],
  [
    '403',
    'A chave existe, mas não é de captação.',
    'Use a chave gerada pelo canal, em Administração → Captação.',
  ],
  [
    '429',
    'Mais de 30 chamadas por minuto do mesmo IP.',
    'Espere e tente de novo. Envio em massa precisa de fila com espaçamento.',
  ],
];

const SECOES: DocSecao[] = [
  {
    id: 'como-funciona',
    titulo: 'O que a captação faz',
    corpo: (
      <>
        <P>
          Um <Forte>canal de captação</Forte> é uma porta de entrada com chave
          própria. O seu site, landing page ou automação faz uma chamada HTTP
          para o CRM apresentando essa chave, e o CRM abre na hora um cliente com
          status <Forte>Lead</Forte> e o contato principal dele, com uma nota
          contando de onde veio.
        </P>
        <P>
          Quem <Forte>atende</Forte> e como o lead é <Forte>classificado</Forte>{' '}
          são configuração do canal, não do payload: o sistema de fora não
          escolhe responsável nem fonte de lead. Isso mantém o roteamento na mão
          de quem administra a workspace, e é por isso que dois formulários com
          regras diferentes pedem dois canais.
        </P>
        <P>
          A captação <Forte>não cria oportunidade</Forte> no pipeline. Uma
          oportunidade exige tipo de serviço e valor, que o formulário não sabe
          — a entrada no funil continua sendo uma decisão de quem atende.
        </P>
        <Destaque>
          <P>
            <Forte>É uma chamada de servidor para servidor.</Forte> A chave é um
            segredo: se ela for para o JavaScript da sua página, qualquer visitante
            a lê e passa a escrever na sua workspace. Chame o CRM do backend do
            site, de uma função serverless ou de uma automação (n8n, Make,
            Zapier). O CRM só aceita o navegador na origem do próprio app, então
            um <Codigo>fetch</Codigo> direto da sua página também seria barrado
            pelo CORS.
          </P>
        </Destaque>
      </>
    ),
  },
  {
    id: 'configurar',
    titulo: 'Configurar o canal',
    corpo: (
      <>
        <Lista ordenada>
          <Item>
            Em <Interno to="/administracao/captacao">Administração → Captação</Interno>
            , clique em <Forte>Novo canal</Forte>. Dê um nome que identifique a
            origem — "Site institucional", "Landing agenda cheia", "n8n".
          </Item>
          <Item>
            Escolha o <Forte>responsável</Forte>. Todo lead do canal nasce com
            essa pessoa. Sem responsável, o lead fica visível para toda a equipe
            — e é assim que o aviso de lead novo chega ao owner.
          </Item>
          <Item>
            Escolha a <Forte>fonte de lead</Forte>, se quiser classificar o lead
            nos relatórios. A <Codigo>origem</Codigo> que o site manda continua
            sendo gravada como tag, junto disto.
          </Item>
          <Item>
            Ao salvar, a chave aparece <Forte>uma única vez</Forte>. Copie e
            guarde no sistema de origem como segredo (variável de ambiente,
            credencial da automação). Se perder, rotacione para gerar outra — o
            CRM guarda só o hash e não tem como mostrar de novo.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'chamada',
    titulo: 'A chamada',
    corpo: (
      <>
        <TabelaDoc
          colunas={['Item', 'Valor']}
          linhas={[
            ['Método', <Codigo key="m">POST</Codigo>],
            ['Endereço', <Codigo key="u">{ENDPOINT}</Codigo>],
            [
              'Autenticação',
              <>
                Cabeçalho <Codigo>Authorization: Bearer crm_…</Codigo> com a
                chave do canal. O <Codigo>Bearer</Codigo> é sensível a maiúsculas.
              </>,
            ],
            ['Formato', <Codigo key="c">Content-Type: application/json</Codigo>],
            ['Limite', 'Até 30 chamadas por minuto, por IP de origem.'],
          ]}
        />
        <CodeBlock code={CURL} label="Requisição" copiedLabel="Comando copiado." />
        <P>
          Não há assinatura de payload nem verificação de IP: a chave é a única
          credencial. Trate-a como senha e rotacione ao suspeitar de vazamento.
        </P>
      </>
    ),
  },
  {
    id: 'campos',
    titulo: 'Campos aceitos',
    corpo: (
      <>
        <P>
          São treze campos, e só três são obrigatórios:{' '}
          <Codigo>nome</Codigo>, <Codigo>whatsapp</Codigo> e{' '}
          <Codigo>origem</Codigo>. Os opcionais aceitam <Codigo>null</Codigo> ou
          podem simplesmente não vir.
        </P>
        <TabelaDoc
          colunas={['Campo', 'Tipo', 'Obrigatório', 'Limite', 'O que faz']}
          linhas={CAMPOS.map(([campo, ...resto]) => [
            <Codigo key={campo}>{campo}</Codigo>,
            ...resto,
          ])}
        />
        <Destaque>
          <P>
            <Forte>Campo fora dessa lista faz a chamada falhar com 400.</Forte>{' '}
            É de propósito: dado de lead descartado em silêncio é pior do que uma
            integração que reclama alto. Se o seu formulário tem uma pergunta que
            não cabe em nenhum campo, mande o texto dela dentro de{' '}
            <Codigo>resumo</Codigo> ou <Codigo>mensagem</Codigo>.
          </P>
          <P>
            <Forte>
              <Codigo>qualificacao</Codigo> é aceito e não é guardado.
            </Forte>{' '}
            Ele existe para não quebrar integrações antigas que já o enviam, mas
            nada do seu conteúdo chega ao cadastro. O que aparece para quem
            atende é <Codigo>resumo</Codigo> e <Codigo>cenario</Codigo>.
          </P>
        </Destaque>
        <Sub nivel={4}>Sobre o whatsapp</Sub>
        <P>
          Só dígitos, DDD na frente, sem o código do país:{' '}
          <Codigo>84999398021</Codigo> passa, <Codigo>5584999398021</Codigo> e{' '}
          <Codigo>(84) 99939-8021</Codigo> não. São 10 ou 11 dígitos. É o campo
          que o CRM usa para reconhecer um contato que já existe, então normalize
          antes de enviar.
        </P>
        <Sub nivel={4}>Sobre o nome do cadastro</Sub>
        <P>
          Quando <Codigo>empresa</Codigo> vem preenchido, ele é o nome do
          cliente e <Codigo>nome</Codigo> fica no contato principal. Sem{' '}
          <Codigo>empresa</Codigo>, o cadastro recebe o nome da pessoa.
        </P>
      </>
    ),
  },
  {
    id: 'exemplos',
    titulo: 'Exemplos de corpo',
    corpo: (
      <>
        <CodeBlock
          code={CORPO_MINIMO}
          label="Mínimo"
          copiedLabel="Exemplo copiado."
        />
        <CodeBlock
          code={CORPO_COMPLETO}
          label="Completo"
          copiedLabel="Exemplo copiado."
        />
      </>
    ),
  },
  {
    id: 'respostas',
    titulo: 'O que a API responde',
    corpo: (
      <>
        <P>
          Deu certo: <Codigo>200</Codigo> com o id do cliente e o que aconteceu
          com ele. <Codigo>criado</Codigo> é cadastro novo;{' '}
          <Codigo>atualizado</Codigo> é contato que já existia — e não é erro.
        </P>
        <CodeBlock code={RESPOSTA_OK} label="Resposta 200" />
        <P>
          Deu errado: a resposta traz a lista do que reprovou. Guarde o corpo do
          erro no log da sua integração — é ele que diz qual campo consertar.
        </P>
        <CodeBlock code={RESPOSTA_ERRO} label="Resposta 400" />
        <TabelaDoc
          colunas={['Código', 'Quando acontece', 'O que fazer']}
          linhas={ERROS.map(([codigo, ...resto]) => [
            <Codigo key={codigo}>{codigo}</Codigo>,
            ...resto,
          ])}
        />
        <P>
          Em qualquer erro, <Forte>nada é gravado</Forte> — pode repetir a
          chamada com segurança depois de corrigir. As mensagens vêm em português
          e nomeiam o campo que reprovou.
        </P>
      </>
    ),
  },
  {
    id: 'reincidente',
    titulo: 'Quando o mesmo contato volta',
    corpo: (
      <>
        <P>
          Antes de abrir cadastro, o CRM procura um cliente não arquivado com
          aquele telefone. Achando, ele <Forte>não duplica</Forte>: responde{' '}
          <Codigo>atualizado</Codigo> e empilha a nota nova acima da anterior, no
          mesmo cadastro.
        </P>
        <Lista>
          <Item>
            <Forte>Tag, fonte e responsável do cadastro antigo não são
            reescritos</Forte> — eles contam de onde a pessoa veio na primeira
            vez. A exceção é um cadastro que estava sem responsável: aí o
            responsável do canal assume.
          </Item>
          <Item>
            O aviso muda de <Forte>Lead novo</Forte> para{' '}
            <Forte>Lead voltou a procurar</Forte>, dizendo que já havia cadastro.
          </Item>
          <Item>
            O e-mail não desempata nada: dois telefones diferentes com o mesmo
            e-mail geram dois cadastros.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'aviso',
    titulo: 'Quem é avisado do lead',
    corpo: (
      <>
        <P>
          Cada lead recebido dispara o evento <Forte>Lead recebido</Forte> para{' '}
          <Forte>o responsável do canal</Forte>. Canal sem responsável avisa o
          owner. Ou seja: ao rotear um canal para alguém, o owner deixa de
          receber os avisos daquele canal — quem quiser tudo deixa o canal sem
          responsável.
        </P>
        <P>
          Onde esse aviso chega (central, e-mail, Slack, Telegram, webhook) é
          escolha de cada pessoa em{' '}
          <Interno to="/configuracoes/notificacoes">
            Configurações → Notificações
          </Interno>
          . Para mandar o lead a um sistema de fora quando ele entra, veja{' '}
          <Interno to="/ajuda/notificacoes">como integrar notificações</Interno>.
        </P>
      </>
    ),
  },
  {
    id: 'chave',
    titulo: 'Trocar ou desligar a chave',
    corpo: (
      <>
        <Lista>
          <Item>
            <Forte>Rotacionar</Forte> gera uma chave nova e mata a atual{' '}
            <Forte>na hora</Forte>, sem período de convivência. Quem estiver
            enviando com a antiga para de conseguir até você trocar o valor no
            sistema de origem — faça a troca com a nova chave em mãos.
          </Item>
          <Item>
            <Forte>Excluir o canal</Forte> apaga a chave junto, e ela para de
            autenticar imediatamente. Os leads que já entraram por ali
            permanecem.
          </Item>
          <Item>
            Cada canal tem a sua chave: revogar um não derruba os outros. É o
            motivo para criar um canal por origem em vez de compartilhar uma
            chave entre vários sites.
          </Item>
        </Lista>
        <P>
          A coluna <Forte>Último uso</Forte> na tela de captação mostra a última
          chamada bem-sucedida da chave. É o jeito mais rápido de confirmar que a
          integração do outro lado está viva — e "Nunca usada" num canal antigo
          quase sempre significa chave errada no sistema de origem.
        </P>
        <P>
          Para validar o encaixe antes de mexer no seu site, rode o comando da
          seção 3 com a chave real e um telefone de teste: a resposta{' '}
          <Codigo>200</Codigo> traz o <Codigo>clientId</Codigo> do cadastro que
          acabou de nascer, e o cadastro fica na lista de clientes para você
          conferir e apagar.
        </P>
      </>
    ),
  },
];

export default function CaptacaoDocPage() {
  return (
    <DocPagina
      titulo="Entregar lead no CRM"
      descricao="Como configurar um canal de captação e o que o seu site ou automação deve enviar para o lead cair no CRM sem ninguém digitar."
      secoes={SECOES}
    />
  );
}
