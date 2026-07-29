import { EMPRESA } from '@/lib/company';
import { LegalLayout, type Secao } from './LegalLayout';
import {
  Dado,
  Destaque,
  Email,
  Externo,
  Forte,
  Interno,
  Item,
  Lista,
  P,
  Sub,
} from './prose';

const SECOES: Secao[] = [
  {
    id: 'controlador',
    titulo: 'Quem trata seus dados',
    corpo: (
      <>
        <P>
          Esta Política explica quais dados pessoais o {EMPRESA.produto} coleta, por
          que coleta, com quem compartilha e o que você pode exigir a respeito.
          Aplica-se ao serviço hospedado em <Forte>{EMPRESA.dominio}</Forte>.
        </P>
        <div className="space-y-1.5 rounded-lg border border-border p-4">
          <Dado rotulo="Controlador:">{EMPRESA.razaoSocial}</Dado>
          <Dado rotulo="CNPJ:">{EMPRESA.cnpj}</Dado>
          <Dado rotulo="Endereço:">{EMPRESA.endereco}</Dado>
          <Dado rotulo="Encarregado (DPO):">{EMPRESA.encarregado}</Dado>
          <Dado rotulo="Canal de privacidade:">
            <Email endereco={EMPRESA.emailPrivacidade} />
          </Dado>
        </div>
        <P>
          Se você instalou o CRM em servidor próprio a partir do{' '}
          <Externo href={EMPRESA.repositorio}>código aberto do projeto</Externo>, os
          dados ficam na sua infraestrutura e o controlador é você — esta Política
          não se aplica àquela instalação.
        </P>
      </>
    ),
  },
  {
    id: 'papeis',
    titulo: 'Dois tipos de dado, dois papéis diferentes',
    corpo: (
      <>
        <P>
          A distinção abaixo atravessa toda esta Política e vale a pena entender
          antes de seguir:
        </P>
        <Lista>
          <Item>
            <Forte>Dados da sua conta.</Forte> Seu nome, e-mail, autenticação e
            assinatura. Aqui somos <Forte>controlador</Forte>: decidimos as
            finalidades descritas nesta Política.
          </Item>
          <Item>
            <Forte>Dados que você cadastra no CRM.</Forte> Clientes, contatos,
            propostas, contratos. Aqui somos <Forte>operador</Forte>: tratamos esses
            dados por sua conta e ordem, apenas para fazer o serviço funcionar. Quem
            define finalidade e base legal é você, e é a sua política de privacidade
            que responde aos titulares desses dados.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'dados-coletados',
    titulo: 'Quais dados coletamos',
    corpo: (
      <>
        <Sub>Dados que você informa</Sub>
        <Lista>
          <Item>
            <Forte>Cadastro:</Forte> nome e e-mail. A senha nunca é guardada em
            texto — armazenamos apenas um hash criptográfico (argon2), que não
            permite recuperar a senha original.
          </Item>
          <Item>
            <Forte>Conteúdo do CRM:</Forte> os registros que você cria — clientes,
            contatos, oportunidades, propostas, projetos, tarefas, contratos,
            recebimentos e anotações. Podem conter dados pessoais de terceiros que
            você optou por registrar.
          </Item>
          <Item>
            <Forte>Suporte:</Forte> o conteúdo das mensagens que você nos envia.
          </Item>
        </Lista>

        <Sub>Dados recebidos do Google ou do GitHub (login social)</Sub>
        <P>
          Se você escolher entrar com Google ou GitHub, solicitamos os escopos
          mínimos de identificação (no Google, <code className="font-mono text-[0.85em]">openid email profile</code>) e
          recebemos do provedor:
        </P>
        <Lista>
          <Item>seu identificador de conta no provedor;</Item>
          <Item>seu endereço de e-mail e a indicação de que foi verificado;</Item>
          <Item>seu nome de exibição.</Item>
        </Lista>
        <P>
          Guardamos apenas esses três dados, para criar sua conta e reconhecer você
          nos próximos acessos. O token de acesso do provedor é usado uma única vez,
          no momento do login, e descartado em seguida —{' '}
          <Forte>não</Forte> armazenamos tokens do Google ou do GitHub e{' '}
          <Forte>não</Forte> acessamos qualquer outro dado dessas contas (e-mails,
          arquivos, contatos, agenda, repositórios).
        </P>
        <Destaque>
          <p>
            <Forte>Uso limitado dos dados do Google.</Forte> Os dados obtidos por
            meio do login com Google são usados exclusivamente para autenticação e
            identificação da sua conta no CRM. Não são vendidos, não alimentam
            publicidade, não treinam modelos de inteligência artificial e não são
            compartilhados com terceiros além dos operadores listados nesta
            Política.
          </p>
        </Destaque>

        <Sub>Dados gerados pelo uso</Sub>
        <Lista>
          <Item>
            <Forte>Registros de acesso:</Forte> data, hora e endereço IP de cada
            login, login social e saída da sua conta, persistidos em tabela
            própria por 6 meses — determinação do Marco Civil da Internet (art.
            15), sem exceção. Diagnóstico técnico da requisição (rota, método,
            código de resposta, tempo de processamento) é guardado à parte, por
            apenas 30 dias, só para depuração de incidentes.
          </Item>
          <Item>
            <Forte>Registros de erro:</Forte> informações técnicas necessárias para
            diagnosticar falhas. Nossos registros são estruturados para não conter
            senhas, tokens nem dados de cartão.
          </Item>
        </Lista>
        <P>
          Não usamos ferramentas de análise comportamental, rastreadores
          publicitários ou perfis de marketing. Não fazemos decisões automatizadas
          que afetem seus interesses.
        </P>

        <Sub>Dados de pagamento</Sub>
        <P>
          A cobrança é processada pela Stripe. O número do cartão é informado
          diretamente a ela e <Forte>nunca</Forte> passa pelos nossos servidores. Do
          nosso lado ficam apenas o identificador do cliente e da assinatura na
          Stripe, o status da assinatura e as datas do ciclo — o suficiente para
          liberar ou bloquear o acesso.
        </P>
      </>
    ),
  },
  {
    id: 'finalidades',
    titulo: 'Para que usamos e com que base legal',
    corpo: (
      <>
        <P>Cada tratamento tem uma finalidade e uma base legal da LGPD (art. 7º):</P>
        <Lista>
          <Item>
            <Forte>Criar e manter sua conta, autenticar acessos e prestar o
            serviço</Forte> — execução de contrato (inciso V).
          </Item>
          <Item>
            <Forte>Processar a assinatura, cobrar e controlar o acesso</Forte> —
            execução de contrato (inciso V).
          </Item>
          <Item>
            <Forte>Enviar e-mails operacionais</Forte> (redefinição de senha, avisos
            de cobrança, mudanças nos Termos) — execução de contrato (inciso V).
          </Item>
          <Item>
            <Forte>Garantir segurança, prevenir fraude e abuso</Forte> (inclusive o
            captcha na tela de cadastro) — legítimo interesse (inciso IX).
          </Item>
          <Item>
            <Forte>Diagnosticar erros e melhorar a estabilidade</Forte> — legítimo
            interesse (inciso IX).
          </Item>
          <Item>
            <Forte>Guardar registros de acesso e documentos fiscais</Forte> —
            cumprimento de obrigação legal (inciso II).
          </Item>
          <Item>
            <Forte>Exercer direitos em processo</Forte>, se necessário — inciso VI.
          </Item>
        </Lista>
        <P>
          Não vendemos dados pessoais, não os cedemos para fins publicitários e não
          os usamos para treinar modelos de inteligência artificial.
        </P>
      </>
    ),
  },
  {
    id: 'cookies',
    titulo: 'Cookies e armazenamento no navegador',
    corpo: (
      <>
        <P>
          Usamos apenas o estritamente necessário para o serviço funcionar. Não há
          cookies de publicidade nem de rastreamento entre sites, e por isso não
          exibimos banner de consentimento de cookies.
        </P>
        <Lista>
          <Item>
            <Forte>Cookie de sessão (essencial):</Forte> um cookie{' '}
            <code className="font-mono text-[0.85em]">httpOnly</code> guarda seu
            token de renovação de sessão, o que mantém você logado sem reexpor
            credenciais. Fica inacessível a scripts da página.
          </Item>
          <Item>
            <Forte>Armazenamento local (essencial):</Forte> o token de acesso de
            curta duração e a preferência de tema (claro/escuro) ficam no seu
            navegador. Você pode apagá-los limpando os dados do site — isso encerra
            a sessão.
          </Item>
          <Item>
            <Forte>Captcha:</Forte> a tela de cadastro pode carregar o Cloudflare
            Turnstile, que usa recursos próprios no navegador para distinguir humano
            de robô. É uma medida antiabuso, sem perfilamento publicitário.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'compartilhamento',
    titulo: 'Com quem compartilhamos',
    corpo: (
      <>
        <P>
          Só compartilhamos dados com prestadores necessários para operar o serviço,
          cada um limitado ao mínimo indispensável e obrigado a proteger a
          informação:
        </P>
        <Lista>
          <Item>
            <Forte>Provedor de hospedagem</Forte> — servidor onde a aplicação e o
            banco de dados rodam.
          </Item>
          <Item>
            <Forte>Stripe</Forte> — processamento de pagamentos e gestão da
            assinatura.
          </Item>
          <Item>
            <Forte>Cloudflare</Forte> — captcha antiabuso na tela de cadastro.
          </Item>
          <Item>
            <Forte>Provedor de e-mail transacional</Forte> — entrega das mensagens
            operacionais (redefinição de senha, avisos).
          </Item>
          <Item>
            <Forte>Google e GitHub</Forte> — apenas quando você escolhe o login
            social, e apenas no momento da autenticação.
          </Item>
        </Lista>
        <P>
          Também podemos divulgar dados para cumprir ordem judicial ou requisição de
          autoridade competente, sempre nos limites da lei, e informamos você quando
          isso for permitido. Numa eventual reorganização societária, os dados podem
          ser transferidos ao sucessor, mantidas as condições desta Política.
        </P>
        <Sub>Transferência internacional</Sub>
        <P>
          Alguns desses prestadores mantêm servidores fora do Brasil. Nesses casos, a
          transferência é feita com apoio nas hipóteses do art. 33 da LGPD e nas
          garantias contratuais oferecidas por cada fornecedor.
        </P>
      </>
    ),
  },
  {
    id: 'retencao',
    titulo: 'Por quanto tempo guardamos',
    corpo: (
      <>
        <Lista>
          <Item>
            <Forte>Dados da conta e conteúdo do CRM:</Forte> enquanto sua conta
            existir.
          </Item>
          <Item>
            <Forte>Ao pedir o encerramento da conta:</Forte> o pedido fica{' '}
            <Forte>30 dias</Forte> em carência, cancelável a qualquer momento por
            você na própria interface. Nesse período o CRM continua funcionando
            normalmente e nada é apagado.
          </Item>
          <Item>
            <Forte>Passada a carência:</Forte> a conta e todo o conteúdo do CRM
            são apagados em definitivo, junto com a trilha de auditoria e o
            histórico de notificações — ressalvado o que a lei obriga a manter
            (abaixo). A recuperação deixa de ser possível.
          </Item>
          <Item>
            <Forte>Backups:</Forte> mantemos backups do banco com rotação de{' '}
            <Forte>30 dias</Forte>. Um dado apagado pode continuar existindo num
            backup ainda não expirado por até esse prazo; ele não é usado para
            nenhuma outra finalidade, e a exclusão é reaplicada se um backup
            precisar ser restaurado.
          </Item>
          <Item>
            <Forte>Registros de acesso:</Forte> 6 meses, por determinação do Marco
            Civil da Internet (art. 15). São mantidos{' '}
            <Forte>mesmo após o encerramento da conta</Forte> — é obrigação legal,
            e a LGPD (art. 16, I) autoriza expressamente essa conservação. Guardam
            data, hora e endereço IP dos seus acessos, e nada do conteúdo do CRM.
          </Item>
          <Item>
            <Forte>Registros fiscais e de cobrança:</Forte> pelos prazos exigidos
            pela legislação fiscal e prescricional.
          </Item>
          <Item>
            <Forte>Tokens de redefinição de senha:</Forte> expiram em poucas horas e
            são invalidados no primeiro uso.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'seguranca',
    titulo: 'Como protegemos',
    corpo: (
      <>
        <Lista>
          <Item>tráfego cifrado de ponta a ponta com TLS (HTTPS);</Item>
          <Item>
            senhas guardadas como hash argon2; tokens de redefinição guardados apenas
            como hash;
          </Item>
          <Item>
            sessão com token de acesso de curta duração e renovação por cookie{' '}
            <code className="font-mono text-[0.85em]">httpOnly</code>, revogável a
            qualquer momento;
          </Item>
          <Item>
            isolamento no banco por linha (RLS), de modo que consultas não alcancem
            dados de outra conta;
          </Item>
          <Item>
            cabeçalhos de segurança no navegador, incluindo política de conteúdo
            (CSP) restritiva;
          </Item>
          <Item>
            acesso administrativo à infraestrutura restrito e registros de auditoria
            sem segredos.
          </Item>
        </Lista>
        <P>
          Nenhum sistema é infalível. Se ocorrer incidente de segurança com risco
          relevante aos seus direitos, comunicaremos você e a ANPD nos prazos da
          LGPD (art. 48), informando o que aconteceu e o que fazer.
        </P>
      </>
    ),
  },
  {
    id: 'direitos',
    titulo: 'Seus direitos',
    corpo: (
      <>
        <P>
          A LGPD (art. 18) garante a você, a qualquer momento e sem custo, o direito
          de:
        </P>
        <Lista>
          <Item>confirmar que tratamos seus dados e acessá-los;</Item>
          <Item>corrigir dados incompletos, inexatos ou desatualizados;</Item>
          <Item>
            pedir anonimização, bloqueio ou eliminação de dados desnecessários,
            excessivos ou tratados em desconformidade;
          </Item>
          <Item>
            pedir portabilidade a outro fornecedor e obter os dados em formato
            legível por máquina;
          </Item>
          <Item>
            pedir a eliminação dos dados tratados com base em consentimento;
          </Item>
          <Item>
            saber com quem compartilhamos e revogar consentimento quando for a base
            aplicável;
          </Item>
          <Item>opor-se a tratamento fundado em legítimo interesse.</Item>
        </Lista>
        <P>
          Boa parte disso você resolve sozinho, sem precisar escrever para
          ninguém. Em <Interno to="/configuracoes/conta">Configurações → Conta</Interno>{' '}
          você <Forte>baixa todos os seus dados</Forte> num arquivo único, em
          formato legível por máquina (portabilidade), e{' '}
          <Forte>encerra a conta</Forte> em definitivo. Dados de perfil são
          editáveis, registros do CRM podem ser alterados ou excluídos e a
          assinatura é gerenciável na tela de assinatura.
        </P>
        <P>
          Para os demais pedidos, escreva para{' '}
          <Email endereco={EMPRESA.emailPrivacidade} />. Respondemos em até{' '}
          <Forte>15 dias</Forte>. Podemos pedir confirmação de identidade antes de
          atender, justamente para não entregar dados a quem não é o titular. Você
          também pode reclamar diretamente à{' '}
          <Externo href="https://www.gov.br/anpd">ANPD</Externo>.
        </P>
        <Destaque>
          <p>
            É titular de dados que <Forte>outra pessoa</Forte> cadastrou no CRM dela
            — por exemplo, alguém registrou você como contato de um cliente? O pedido
            deve ir para essa empresa, que é a controladora desses dados. Se nos
            escrever, encaminhamos e avisamos você.
          </p>
        </Destaque>
      </>
    ),
  },
  {
    id: 'criancas',
    titulo: 'Crianças e adolescentes',
    corpo: (
      <P>
        O serviço é destinado a maiores de 18 anos, no exercício de atividade
        profissional. Não coletamos dados de crianças e adolescentes de forma
        deliberada. Se identificarmos cadastro de menor de idade, a conta é encerrada
        e os dados eliminados. Ficou sabendo de um caso? Avise em{' '}
        <Email endereco={EMPRESA.emailPrivacidade} />.
      </P>
    ),
  },
  {
    id: 'alteracoes',
    titulo: 'Alterações desta Política',
    corpo: (
      <>
        <P>
          Esta Política pode ser atualizada quando o produto, os fornecedores ou a
          legislação mudarem. A data de vigência no topo indica sempre a versão
          atual.
        </P>
        <P>
          Mudanças relevantes — nova finalidade, novo compartilhamento, prazo de
          guarda maior — são comunicadas por e-mail ou por aviso no sistema com
          antecedência mínima de 15 dias. Quando a mudança depender de consentimento,
          pediremos o seu antes de aplicá-la.
        </P>
      </>
    ),
  },
  {
    id: 'contato',
    titulo: 'Contato',
    corpo: (
      <>
        <P>
          Dúvidas, pedidos ou reclamações sobre dados pessoais:{' '}
          <Email endereco={EMPRESA.emailPrivacidade} />, aos cuidados do encarregado{' '}
          {EMPRESA.encarregado}.
        </P>
        <P>
          A mesma caixa atende assuntos comerciais, de assinatura e de suporte. As
          regras de uso do serviço estão nos{' '}
          <Interno to="/termos">Termos de Uso</Interno>.
        </P>
      </>
    ),
  },
];

export default function PrivacidadePage() {
  return (
    <LegalLayout
      title="Política de Privacidade"
      description={`Como o ${EMPRESA.produto} coleta, usa, compartilha e protege dados pessoais — os seus e os de quem você cadastra no CRM — de acordo com a Lei Geral de Proteção de Dados.`}
      resumo={
        <>
          <p>
            Coletamos o mínimo: nome e e-mail para sua conta, registros técnicos de
            acesso e o status da sua assinatura. Se você entra com Google, recebemos
            apenas nome, e-mail e identificador — nada além disso, e nunca para
            publicidade.
          </p>
          <p>
            Não vendemos dados, não usamos rastreadores publicitários e não treinamos
            modelos de IA com o seu conteúdo. Dados de cartão ficam na Stripe e não
            passam pelos nossos servidores.
          </p>
        </>
      }
      secoes={SECOES}
      outroDocumento={{ to: '/termos', label: 'Ler os Termos de Uso →' }}
    />
  );
}
