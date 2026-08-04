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
 * Como um sistema de fora escreve no CRM. É o contrato das quatro rotas de
 * `/public` escrito para quem configura a integração do outro lado — o mesmo
 * conteúdo dos DTOs públicos e do `docs/integracoes.md`, sem obrigar ninguém a
 * ler código.
 *
 * Ao mexer num DTO público (campo novo, limite, obrigatoriedade) ou nas respostas
 * do `PublicWriteService`, atualize esta página **e** o `docs/integracoes.md` no
 * mesmo PR: as duas são a referência que o integrador tem, e um campo
 * documentado a mais aqui vira `400` na prática.
 */

const BASE = endpointDaApi('public');

const CURL_CLIENTE = `curl -X POST ${BASE}/clients \\
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Clínica Bem Viver",
    "email": "contato@bemviver.com.br",
    "phone": "+5584999398021",
    "status": "ACTIVE"
  }'`;

const RESPOSTA_CLIENTE = `{
  "id": "3f8b1c2e-9a44-4f6d-8b71-2c5e0d9a1f33",
  "status": "ACTIVE"
}`;

const CURL_OPORTUNIDADE = `curl -X POST ${BASE}/deals \\
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "clientId": "3f8b1c2e-9a44-4f6d-8b71-2c5e0d9a1f33",
    "title": "Reforma do site institucional",
    "serviceTypeId": "8c1d4a77-2e35-4b90-9f61-7ad0c3b5e214",
    "amount": 12000,
    "probability": 40
  }'`;

const CURL_ATIVIDADE = `curl -X POST ${BASE}/activities \\
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "clientId": "3f8b1c2e-9a44-4f6d-8b71-2c5e0d9a1f33",
    "typeId": "b2f1e9c4-5d78-4a31-8e02-6c9f4d1b7a55",
    "content": "Cliente pediu proposta por telefone.",
    "scheduledFor": "2026-08-10T14:00:00.000Z"
  }'`;

const CURL_DEMANDA = `curl -X POST ${BASE}/tasks \\
  -H "Authorization: Bearer crm_SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "projectId": "5a7c2d18-4b6e-4f03-9d21-8e5f0a3c9b74",
    "title": "Publicar a homepage",
    "priority": "HIGH",
    "dueDate": "2026-08-20T00:00:00.000Z"
  }'`;

const RESPOSTA_ERRO = `{
  "message": [
    "O nome deve ter no mínimo 2 caracteres.",
    "O campo ownerId não é aceito nesta rota."
  ],
  "error": "Bad Request",
  "statusCode": 400
}`;

const ESCOPOS: string[][] = [
  ['cliente:escrever', 'POST /public/clients', 'Abrir cadastro de cliente ou lead'],
  [
    'negociacao:escrever',
    'POST /public/deals',
    'Abrir oportunidade no funil de um cliente existente',
  ],
  [
    'atividade:escrever',
    'POST /public/activities',
    'Lançar atividade no histórico de um cliente',
  ],
  [
    'tarefa:escrever',
    'POST /public/tasks',
    'Abrir demanda no quadro de um projeto existente',
  ],
];

const CAMPOS_CLIENTE: string[][] = [
  ['name', 'texto (mín. 2)', 'Sim', 'Nome do cadastro.'],
  ['email', 'e-mail', 'Não', 'Gravado no cliente.'],
  ['phone', 'texto', 'Não', 'Gravado no cliente.'],
  [
    'document',
    'texto',
    'Não',
    'CPF (11 dígitos) ou CNPJ (14). O tipo de pessoa é deduzido dele; documento repetido responde 409.',
  ],
  [
    'status',
    'LEAD | ACTIVE | INACTIVE | LOST',
    'Não',
    'Em branco, o cadastro nasce como LEAD.',
  ],
  ['tags', 'lista de texto', 'Não', 'Etiquetas livres do cadastro.'],
  ['notes', 'texto (máx. 5000)', 'Não', 'Observações.'],
];

const CAMPOS_OPORTUNIDADE: string[][] = [
  ['clientId', 'uuid', 'Sim', 'Cliente da sua workspace. De outro owner, 404.'],
  ['title', 'texto (mín. 2)', 'Sim', 'Título do card no funil.'],
  [
    'serviceTypeId',
    'uuid',
    'Sim',
    'Item do seu catálogo de serviços. Sem ele o funil não aceita o card.',
  ],
  [
    'stageId',
    'uuid',
    'Não',
    'Em branco, a oportunidade nasce no primeiro estágio do seu funil.',
  ],
  ['amount', 'número', 'Não', 'Valor, com até 2 casas.'],
  ['probability', 'inteiro 0-100', 'Não', 'Chance de fechar.'],
  ['expectedClose', 'data ISO 8601', 'Não', 'Data prevista de fechamento.'],
];

const CAMPOS_ATIVIDADE: string[][] = [
  ['clientId', 'uuid', 'Sim', 'Cliente da sua workspace.'],
  ['typeId', 'uuid', 'Sim', 'Item do seu catálogo de tipos de atividade.'],
  ['content', 'texto', 'Sim', 'O que aconteceu. Vira o corpo da atividade.'],
  [
    'dealId',
    'uuid',
    'Não',
    'Vincula a atividade a uma oportunidade do mesmo cliente.',
  ],
  [
    'scheduledFor',
    'data ISO 8601',
    'Não',
    'Agenda a atividade: é o que a torna um follow-up pendente e a faz aparecer no card do funil.',
  ],
];

const CAMPOS_DEMANDA: string[][] = [
  ['projectId', 'uuid', 'Sim', 'Projeto da sua workspace.'],
  ['title', 'texto (mín. 2)', 'Sim', 'Título da demanda.'],
  ['description', 'texto', 'Não', 'Descrição.'],
  [
    'status',
    'BACKLOG | TODO | IN_PROGRESS | REVIEW | DONE',
    'Não',
    'Em branco, BACKLOG. Criada como DONE, já nasce concluída.',
  ],
  ['priority', 'LOW | MEDIUM | HIGH | URGENT', 'Não', 'Em branco, MEDIUM.'],
  ['dueDate', 'data ISO 8601', 'Não', 'Prazo.'],
  ['tags', 'lista de texto', 'Não', 'Etiquetas da demanda.'],
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
    'A chave existe, mas não tem o escopo da rota.',
    'Marque o escopo na chave em Administração → API, ou use a chave certa.',
  ],
  [
    '404',
    'Id que não existe — ou que é de outra workspace.',
    'São o mesmo caso, e a resposta não os distingue de propósito.',
  ],
  [
    '409',
    'Documento de cliente já cadastrado.',
    'O cadastro já existe: encontre-o na interface em vez de criar outro.',
  ],
  [
    '429',
    'Mais de 120 chamadas por minuto com a mesma chave.',
    'Espere e tente de novo. Carga grande precisa de fila com espaçamento.',
  ],
];

const SECOES: DocSecao[] = [
  {
    id: 'o-que-faz',
    titulo: 'O que a API pública faz',
    corpo: (
      <>
        <P>
          É a porta para um <Forte>sistema de fora escrever no CRM</Forte>: um
          ERP, uma automação (n8n, Make, Zapier), um app interno, um script. São
          quatro rotas, e todas criam registro: cliente, oportunidade, atividade
          e demanda.
        </P>
        <P>
          A autenticação é por <Forte>chave de API</Forte>, emitida por você em{' '}
          <Interno to="/administracao/api">Administração → API</Interno>. Não há
          sessão, cookie nem usuário envolvido — quem chama é um servidor.
        </P>
        <Destaque>
          <P>
            <Forte>Ela não lê e não altera.</Forte> Não existe{' '}
            <Codigo>GET</Codigo>, <Codigo>PATCH</Codigo> nem{' '}
            <Codigo>DELETE</Codigo>. Quem precisa ler usa a interface ou baixa a
            exportação em Configurações → Conta. A API é uma porta de entrada, não
            um espelho do banco.
          </P>
          <P>
            <Forte>Lead de formulário não vem por aqui.</Forte> Para isso existe
            a captação, que desduplica por telefone, roteia por canal e
            classifica a fonte —{' '}
            <Interno to="/ajuda/captacao">veja como entregar lead</Interno>.
          </P>
        </Destaque>
        <Destaque>
          <P>
            <Forte>É uma chamada de servidor para servidor.</Forte> A chave é um
            segredo: se ela for para o JavaScript de uma página, qualquer
            visitante a lê e passa a escrever na sua workspace. Chame o CRM do
            backend, de uma função serverless ou de uma automação.
          </P>
        </Destaque>
      </>
    ),
  },
  {
    id: 'credencial',
    titulo: 'Emitir, rotacionar e revogar a chave',
    corpo: (
      <>
        <Lista ordenada>
          <Item>
            Em <Interno to="/administracao/api">Administração → API</Interno>,
            clique em <Forte>Nova chave</Forte>. Dê um nome que identifique o
            sistema — ele aparece na trilha de auditoria de tudo que a chave
            escrever.
          </Item>
          <Item>
            Marque os <Forte>escopos</Forte>. Cada rota exige o seu; chave sem o
            escopo responde <Codigo>403</Codigo>.
          </Item>
          <Item>
            Ao salvar, a chave aparece <Forte>uma única vez</Forte>. Copie e
            guarde onde você guarda senha: variável de ambiente, cofre da
            automação, secret do CI.
          </Item>
        </Lista>
        <Sub nivel={4}>Perdi a chave</Sub>
        <P>
          <Forte>Recuperar não existe</Forte>, e não é limitação a contornar: o
          CRM guarda apenas o hash do valor. Quem perde{' '}
          <Forte>rotaciona</Forte> — a chave ganha um valor novo, e a anterior
          para de autenticar <Forte>na hora</Forte>, sem período de convivência.
          Faça a rotação com o valor novo em mãos e troque-o no sistema de origem
          em seguida.
        </P>
        <Sub nivel={4}>Revogar</Sub>
        <P>
          A chave para de autenticar, mas a linha <Forte>permanece</Forte> na
          tabela com o selo "Revogada": a tela e a trilha precisam continuar
          explicando que ela existiu e o que escreveu. Rotacionar uma chave
          revogada a reativa.
        </P>
        <P>
          <Forte>Uma chave por sistema integrado.</Forte> É o que permite revogar
          um sem derrubar os outros — e o que faz a trilha dizer qual sistema
          escreveu cada registro.
        </P>
      </>
    ),
  },
  {
    id: 'escopo',
    titulo: 'Escopo não é permissão',
    corpo: (
      <>
        <P>
          São dois catálogos independentes, de propósito.{' '}
          <Forte>Permissão</Forte> limita uma pessoa usando o CRM pela interface e
          mora no papel do colaborador. <Forte>Escopo</Forte> limita uma
          credencial de máquina e mora na própria chave.
        </P>
        <P>
          Uma chave <Forte>não é "um usuário robô"</Forte>: não tem papel, não
          conta assento, não aparece entre os colaboradores e não faz nada além
          dos escopos marcados nela. Não há escopo de leitura porque não há rota
          de leitura.
        </P>
        <TabelaDoc
          colunas={['Escopo', 'Libera', 'Para quê']}
          linhas={ESCOPOS.map(([escopo, rota, descricao]) => [
            <Codigo key={escopo}>{escopo}</Codigo>,
            <Codigo key={rota}>{rota}</Codigo>,
            descricao,
          ])}
        />
        <P>
          Há um quinto escopo no catálogo, <Codigo>lead:receber</Codigo>, que{' '}
          <Forte>não</Forte> pode ser marcado numa chave de API: ele pertence ao
          canal de captação, que emite a chave dele junto do canal.
        </P>
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
            ['Endereço base', <Codigo key="u">{BASE}</Codigo>],
            ['Método', <Codigo key="m">POST</Codigo>],
            [
              'Autenticação',
              <>
                Cabeçalho <Codigo>Authorization: Bearer crm_…</Codigo>. O{' '}
                <Codigo>Bearer</Codigo> é sensível a maiúsculas.
              </>,
            ],
            ['Formato', <Codigo key="c">Content-Type: application/json</Codigo>],
            ['Limite', 'Até 120 chamadas por minuto, por chave.'],
          ]}
        />
        <Destaque>
          <P>
            <Forte>A workspace de destino vem da chave, nunca do corpo.</Forte>{' '}
            Nenhum corpo aceita <Codigo>ownerId</Codigo>, e enviá-lo faz a
            requisição inteira falhar com <Codigo>400</Codigo>. É o que garante
            que uma chave só escreve na conta de quem a emitiu.
          </P>
        </Destaque>
      </>
    ),
  },
  {
    id: 'clientes',
    titulo: 'Criar cliente',
    corpo: (
      <>
        <TabelaDoc
          colunas={['Campo', 'Tipo', 'Obrigatório', 'O que faz']}
          linhas={CAMPOS_CLIENTE.map(([campo, ...resto]) => [
            <Codigo key={campo}>{campo}</Codigo>,
            ...resto,
          ])}
        />
        <P>
          Sem responsável de propósito: a integração não conhece os usuários da
          workspace, e atribuir é decisão de quem administra.
        </P>
        <CodeBlock
          code={CURL_CLIENTE}
          label="Requisição"
          copiedLabel="Comando copiado."
        />
        <CodeBlock code={RESPOSTA_CLIENTE} label="Resposta 201" />
      </>
    ),
  },
  {
    id: 'oportunidades',
    titulo: 'Criar oportunidade',
    corpo: (
      <>
        <TabelaDoc
          colunas={['Campo', 'Tipo', 'Obrigatório', 'O que faz']}
          linhas={CAMPOS_OPORTUNIDADE.map(([campo, ...resto]) => [
            <Codigo key={campo}>{campo}</Codigo>,
            ...resto,
          ])}
        />
        <CodeBlock
          code={CURL_OPORTUNIDADE}
          label="Requisição"
          copiedLabel="Comando copiado."
        />
        <P>
          A resposta traz <Codigo>id</Codigo> e o <Codigo>stageId</Codigo> em que
          o card nasceu.
        </P>
      </>
    ),
  },
  {
    id: 'atividades',
    titulo: 'Registrar atividade',
    corpo: (
      <>
        <TabelaDoc
          colunas={['Campo', 'Tipo', 'Obrigatório', 'O que faz']}
          linhas={CAMPOS_ATIVIDADE.map(([campo, ...resto]) => [
            <Codigo key={campo}>{campo}</Codigo>,
            ...resto,
          ])}
        />
        <CodeBlock
          code={CURL_ATIVIDADE}
          label="Requisição"
          copiedLabel="Comando copiado."
        />
      </>
    ),
  },
  {
    id: 'demandas',
    titulo: 'Criar demanda',
    corpo: (
      <>
        <TabelaDoc
          colunas={['Campo', 'Tipo', 'Obrigatório', 'O que faz']}
          linhas={CAMPOS_DEMANDA.map(([campo, ...resto]) => [
            <Codigo key={campo}>{campo}</Codigo>,
            ...resto,
          ])}
        />
        <CodeBlock
          code={CURL_DEMANDA}
          label="Requisição"
          copiedLabel="Comando copiado."
        />
      </>
    ),
  },
  {
    id: 'ids',
    titulo: 'Descobrir os ids que a API pede',
    corpo: (
      <>
        <P>
          <Codigo>clientId</Codigo>, <Codigo>serviceTypeId</Codigo>,{' '}
          <Codigo>typeId</Codigo>, <Codigo>stageId</Codigo> e{' '}
          <Codigo>projectId</Codigo> são ids da sua workspace, e a API pública não
          lista nada. Os caminhos:
        </P>
        <Lista>
          <Item>
            <Forte>Copiar da URL da interface.</Forte> A ficha do cliente é{' '}
            <Codigo>/clientes/&lt;id&gt;</Codigo>, o projeto é{' '}
            <Codigo>/projetos/&lt;id&gt;</Codigo>.
          </Item>
          <Item>
            <Forte>Baixar a exportação</Forte> em{' '}
            <Interno to="/configuracoes/conta">Configurações → Conta</Interno>: o
            arquivo traz os catálogos, os estágios do funil e os clientes com os
            ids.
          </Item>
          <Item>
            <Forte>Guardar o id que a própria API devolveu</Forte> — é o caminho
            natural quando o seu sistema cria o cliente e depois a oportunidade
            dele.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'erros',
    titulo: 'O que a API responde quando dá errado',
    corpo: (
      <>
        <CodeBlock code={RESPOSTA_ERRO} label="Resposta 400" />
        <TabelaDoc
          colunas={['Código', 'Quando acontece', 'O que fazer']}
          linhas={ERROS.map(([codigo, ...resto]) => [
            <Codigo key={codigo}>{codigo}</Codigo>,
            ...resto,
          ])}
        />
        <P>
          Em qualquer erro, <Forte>nada é gravado</Forte>: cada requisição roda
          numa transação, então o registro e a trilha de auditoria commitam juntos
          ou nenhum dos dois. Repetir a chamada depois de corrigir é seguro.
        </P>
        <Destaque>
          <P>
            <Forte>Não há idempotência por chave de requisição.</Forte> Repetir
            uma chamada que respondeu <Codigo>201</Codigo> cria um{' '}
            <Forte>segundo</Forte> registro. Se o seu sistema pode reenviar
            (retry automático, fila), guarde o <Codigo>id</Codigo> devolvido e não
            reenvie o que já deu certo.
          </P>
        </Destaque>
        <P>
          Note que <Codigo>404</Codigo> cobre "não existe" e "é de outra
          workspace" com a mesma resposta, de propósito: uma API que dissesse
          "existe, mas não é seu" vazaria a existência do registro alheio.
        </P>
      </>
    ),
  },
  {
    id: 'contrato',
    titulo: 'Contrato de máquina e versão',
    corpo: (
      <>
        <P>
          O documento OpenAPI 3 das quatro rotas — corpos, respostas e esquema de
          autenticação — é servido pela própria API e gerado dos mesmos DTOs que
          ela valida, então não desatualiza:
        </P>
        <CodeBlock
          code={`${endpointDaApi('public/openapi.json')}`}
          label="OpenAPI"
          copiedLabel="Endereço copiado."
        />
        <P>
          Importe-o em Insomnia, Postman, Bruno ou num gerador de cliente. Ele
          cobre <Forte>apenas</Forte> a API pública: as rotas internas do CRM não
          estão nele.
        </P>
        <Sub nivel={4}>Política de versão</Sub>
        <Lista>
          <Item>
            <Codigo>v1</Codigo> é <Forte>estável</Forte>: nenhuma mudança vai
            remover campo, tornar opcional em obrigatório, mudar tipo ou mudar o
            significado de um valor existente.
          </Item>
          <Item>
            <Forte>Campo novo é aditivo</Forte> e pode aparecer a qualquer
            momento. Trate campo desconhecido na resposta como ignorável — não
            valide a resposta contra um schema fechado.
          </Item>
          <Item>
            <Forte>Quebra sai em <Codigo>/api/v2</Codigo></Forte>, com as duas
            versões no ar durante a transição.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'auditoria',
    titulo: 'Onde ver o que a integração escreveu',
    corpo: (
      <>
        <P>
          Cada registro criado pela API entra na{' '}
          <Interno to="/administracao/auditoria">trilha de auditoria</Interno>{' '}
          com o <Forte>nome da chave</Forte> como autor — não um usuário, porque
          não houve pessoa. É como você responde "quem criou este cliente?" quando
          a resposta é um sistema.
        </P>
        <P>
          A coluna <Forte>Último uso</Forte> em{' '}
          <Interno to="/administracao/api">Administração → API</Interno> mostra a
          última chamada bem-sucedida da chave. É o jeito mais rápido de confirmar
          que a integração está viva — e "Nunca usada" numa chave antiga quase
          sempre significa valor errado no sistema de origem.
        </P>
      </>
    ),
  },
];

export default function ApiDocPage() {
  return (
    <DocPagina
      titulo="Escrever no CRM por API"
      descricao="Como um sistema de fora cria cliente, oportunidade, atividade e demanda na sua workspace, com chave de API e escopo por rota."
      secoes={SECOES}
    />
  );
}
