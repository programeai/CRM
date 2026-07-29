import { DIAS_DE_TESTE, EMPRESA, PRECO_PLANO } from '@/lib/company';
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
    id: 'quem-oferece',
    titulo: 'Quem oferece o serviço',
    corpo: (
      <>
        <P>
          O {EMPRESA.produto} é um sistema de gestão comercial (CRM) oferecido pela
          internet, na modalidade software como serviço, por:
        </P>
        <div className="space-y-1.5 rounded-lg border border-border p-4">
          <Dado rotulo="Razão social:">{EMPRESA.razaoSocial}</Dado>
          <Dado rotulo="CNPJ:">{EMPRESA.cnpj}</Dado>
          <Dado rotulo="Endereço:">{EMPRESA.endereco}</Dado>
          <Dado rotulo="Representada por:">
            {EMPRESA.representante}, sócio-administrador
          </Dado>
          <Dado rotulo="Contato:">
            <Email endereco={EMPRESA.emailContato} />
          </Dado>
        </div>
        <P>
          Ao longo deste documento, “nós” se refere a essa pessoa jurídica e “você”
          à pessoa física ou jurídica que cria uma conta e usa o serviço.
        </P>
        <Sub>Onde estes Termos valem</Sub>
        <P>
          Estes Termos regem exclusivamente o serviço hospedado por nós em{' '}
          <Forte>{EMPRESA.dominio}</Forte>. O código-fonte do CRM é aberto, sob a
          licença Apache 2.0: se você instalar o sistema em servidor próprio, a
          relação passa a ser com os termos dessa licença, no{' '}
          <Externo href={EMPRESA.repositorio}>repositório do projeto</Externo>, e
          nós não operamos nem respondemos por aquela instalação.
        </P>
      </>
    ),
  },
  {
    id: 'aceite',
    titulo: 'Aceite destes Termos',
    corpo: (
      <>
        <P>
          Ao criar uma conta, entrar com Google ou GitHub, ou usar o serviço de
          qualquer forma, você declara que leu e concorda com estes Termos de Uso e
          com a <Interno to="/privacidade">Política de Privacidade</Interno>, que é
          parte integrante deles.
        </P>
        <P>
          Se você não concorda com alguma cláusula, não use o serviço. Se você
          aceita em nome de uma empresa, declara ter poderes para obrigá-la.
        </P>
      </>
    ),
  },
  {
    id: 'conta',
    titulo: 'Quem pode usar e como funciona a conta',
    corpo: (
      <>
        <Lista>
          <Item>
            É preciso ter <Forte>18 anos ou mais</Forte> e capacidade civil plena
            para manter uma conta. O serviço não é destinado a menores de idade.
          </Item>
          <Item>
            Os dados de cadastro devem ser verdadeiros, completos e mantidos
            atualizados — principalmente o e-mail, que é o canal usado para
            redefinição de senha e avisos sobre a conta.
          </Item>
          <Item>
            A conta é pessoal. Você é responsável por manter a senha em sigilo e por
            tudo que for feito com suas credenciais. Suspeitando de acesso indevido,
            troque a senha e avise em <Email endereco={EMPRESA.emailContato} />.
          </Item>
          <Item>
            Ao entrar com Google ou GitHub, você autoriza esses provedores a nos
            informar seu nome, e-mail e identificador de conta, apenas para criar e
            autenticar seu acesso. Os detalhes estão na{' '}
            <Interno to="/privacidade">Política de Privacidade</Interno>.
          </Item>
          <Item>
            Contas criadas apenas por login social não têm senha própria; para
            definir uma, use o fluxo de redefinição de senha.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'servico',
    titulo: 'O que o serviço faz',
    corpo: (
      <>
        <P>
          O {EMPRESA.produto} organiza o processo comercial de agências e prestadores
          de serviço. As funcionalidades disponíveis hoje incluem:
        </P>
        <Lista>
          <Item>cadastro de clientes e contatos, com histórico de interações;</Item>
          <Item>pipeline de oportunidades por etapa;</Item>
          <Item>elaboração e envio de propostas;</Item>
          <Item>gestão de projetos, demandas e tarefas;</Item>
          <Item>contratos, recebimentos e acompanhamento financeiro.</Item>
        </Lista>
        <P>
          O serviço é uma ferramenta de organização. Ele não presta consultoria
          jurídica, contábil ou fiscal, não emite documentos fiscais e não substitui
          os controles obrigatórios do seu negócio. As decisões comerciais e o
          conteúdo dos documentos gerados são sempre seus.
        </P>
      </>
    ),
  },
  {
    id: 'assinatura',
    titulo: 'Teste, assinatura e pagamento',
    corpo: (
      <>
        <Sub>Período de teste</Sub>
        <P>
          Toda conta nova recebe <Forte>{DIAS_DE_TESTE} dias de teste</Forte> com
          acesso completo, sem cobrança e sem necessidade de cartão. Encerrado o
          teste sem assinatura ativa, o acesso ao CRM é bloqueado — seus dados
          continuam guardados e voltam a ficar acessíveis assim que a assinatura for
          contratada.
        </P>
        <Sub>Assinatura</Sub>
        <Lista>
          <Item>
            O plano custa <Forte>{PRECO_PLANO}</Forte>, cobrado de forma
            recorrente. O valor vigente é sempre o exibido na tela de pagamento no
            momento da contratação.
          </Item>
          <Item>
            A cobrança é processada pela <Forte>Stripe</Forte>. Os dados do cartão
            são informados diretamente a ela e <Forte>não</Forte> transitam nem são
            armazenados nos nossos servidores.
          </Item>
          <Item>
            A assinatura se renova automaticamente a cada ciclo, até que você
            cancele.
          </Item>
          <Item>
            Falha na cobrança (cartão recusado, expirado, sem limite) pode
            suspender o acesso até a regularização.
          </Item>
          <Item>
            Podemos reajustar o preço, comunicando com{' '}
            <Forte>pelo menos 30 dias de antecedência</Forte> por e-mail. O novo
            valor só vale para ciclos posteriores ao aviso, e você pode cancelar
            antes que ele passe a valer.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'cancelamento',
    titulo: 'Cancelamento, arrependimento e reembolso',
    corpo: (
      <>
        <Lista>
          <Item>
            Você pode cancelar quando quiser, pela própria tela de assinatura, sem
            multa nem carência. O acesso permanece até o fim do ciclo já pago e não
            há nova cobrança depois disso.
          </Item>
          <Item>
            <Forte>Direito de arrependimento:</Forte> em contratações feitas pela
            internet, o artigo 49 do Código de Defesa do Consumidor garante ao
            consumidor 7 dias corridos, contados da contratação, para desistir e
            receber de volta o que pagou. Basta pedir por{' '}
            <Email endereco={EMPRESA.emailContato} /> dentro do prazo.
          </Item>
          <Item>
            Fora dessa hipótese, ciclos já iniciados não são reembolsados
            proporcionalmente, salvo quando a lei exigir ou quando a falha for
            nossa.
          </Item>
        </Lista>
        <Destaque>
          <p>
            Antes de encerrar a conta em definitivo, exporte o que precisa: em{' '}
            <Interno to="/configuracoes/conta">Configurações → Conta</Interno> você
            baixa todos os seus dados num arquivo único. Após o encerramento os
            dados são excluídos nos prazos descritos na{' '}
            <Interno to="/privacidade">Política de Privacidade</Interno> e a
            recuperação deixa de ser possível.
          </p>
        </Destaque>
      </>
    ),
  },
  {
    id: 'seus-dados',
    titulo: 'Seus dados e os dados dos seus clientes',
    corpo: (
      <>
        <P>
          Tudo que você cadastra no CRM — clientes, contatos, propostas, contratos,
          valores, anotações — continua sendo <Forte>seu</Forte>. Não reivindicamos
          propriedade sobre esse conteúdo, não o vendemos e não o usamos para
          publicidade.
        </P>
        <P>
          Quando você registra dados pessoais de terceiros (por exemplo, o telefone
          de um contato de cliente), você atua como <Forte>controlador</Forte> desses
          dados na definição da LGPD, e nós como <Forte>operador</Forte>: tratamos
          apenas o necessário para executar o serviço, seguindo suas instruções.
          Cabe a você ter base legal para esse tratamento e atender aos pedidos dos
          titulares.
        </P>
        <P>
          Nós só acessamos o conteúdo da sua conta quando indispensável para operar o
          serviço, resolver um problema que você relatou, ou cumprir ordem legal.
        </P>
      </>
    ),
  },
  {
    id: 'uso-aceitavel',
    titulo: 'Uso aceitável',
    corpo: (
      <>
        <P>Ao usar o serviço, você se compromete a não:</P>
        <Lista>
          <Item>
            violar a lei, direitos de terceiros ou a LGPD com os dados que insere;
          </Item>
          <Item>
            usar a plataforma para enviar spam, mensagens fraudulentas ou conteúdo
            enganoso;
          </Item>
          <Item>
            tentar acessar contas, dados ou áreas do sistema que não são suas, nem
            explorar vulnerabilidades;
          </Item>
          <Item>
            sobrecarregar a infraestrutura de forma deliberada, automatizar acessos
            em volume anormal ou burlar limites técnicos;
          </Item>
          <Item>
            revender, sublicenciar ou oferecer o serviço hospedado a terceiros como
            se fosse seu — para operar sua própria instância, use o código aberto do
            projeto;
          </Item>
          <Item>
            remover avisos de titularidade ou usar a marca {EMPRESA.nome} sem
            autorização.
          </Item>
        </Lista>
        <P>
          Encontrou uma falha de segurança? Avise em{' '}
          <Email endereco={EMPRESA.emailContato} /> antes de divulgar. Relatos
          responsáveis são bem-vindos.
        </P>
      </>
    ),
  },
  {
    id: 'propriedade',
    titulo: 'Propriedade intelectual e código aberto',
    corpo: (
      <>
        <P>
          O código-fonte do CRM é distribuído sob a{' '}
          <Externo href="https://www.apache.org/licenses/LICENSE-2.0">
            licença Apache 2.0
          </Externo>
          , que permite usar, modificar e redistribuir o software nos termos ali
          previstos.
        </P>
        <P>
          A licença de código <Forte>não</Forte> alcança a marca: “{EMPRESA.nome}” e
          “{EMPRESA.produto}”, o nome, o logotipo e a identidade visual são de
          titularidade do mantenedor. Versões derivadas devem adotar nome e
          identidade próprios.
        </P>
      </>
    ),
  },
  {
    id: 'disponibilidade',
    titulo: 'Disponibilidade, suporte e mudanças',
    corpo: (
      <>
        <Lista>
          <Item>
            Trabalhamos para manter o serviço disponível, mas não garantimos
            funcionamento ininterrupto. Podem ocorrer paradas para manutenção,
            atualização ou por falha de terceiros (hospedagem, provedor de e-mail,
            meio de pagamento).
          </Item>
          <Item>
            Manutenções programadas são anunciadas com antecedência sempre que
            possível; emergenciais podem acontecer sem aviso.
          </Item>
          <Item>
            O suporte é prestado por e-mail, em <Email endereco={EMPRESA.emailContato} />,
            em dias úteis.
          </Item>
          <Item>
            O produto evolui: funcionalidades podem ser adicionadas, alteradas ou
            descontinuadas. Se a mudança for significativa e prejudicar você,
            avisamos com antecedência razoável.
          </Item>
        </Lista>
      </>
    ),
  },
  {
    id: 'responsabilidade',
    titulo: 'Limitação de responsabilidade',
    corpo: (
      <>
        <P>
          O serviço é fornecido no estado em que se encontra, sem garantia de que
          atenderá a todas as suas necessidades específicas. Nos limites permitidos
          pela lei brasileira:
        </P>
        <Lista>
          <Item>
            não respondemos por lucros cessantes, perda de oportunidade de negócio
            ou danos indiretos decorrentes do uso ou da indisponibilidade do
            serviço;
          </Item>
          <Item>
            não respondemos por decisões comerciais tomadas com base nas informações
            que você mesmo cadastrou, nem pelo conteúdo de propostas e contratos que
            você gerou;
          </Item>
          <Item>
            nossa responsabilidade total, em qualquer hipótese, fica limitada ao
            valor pago por você nos 12 meses anteriores ao evento.
          </Item>
        </Lista>
        <P>
          Nada aqui afasta direitos que a legislação consumerista garante de forma
          irrenunciável, nem nossa responsabilidade por dolo ou culpa grave.
        </P>
        <Destaque>
          <p>
            <Forte>Backups.</Forte> Mantemos rotinas de backup da infraestrutura,
            mas elas existem para recuperação de desastre — não substituem cópias
            suas. Exporte periodicamente os dados que forem críticos para o seu
            negócio.
          </p>
        </Destaque>
      </>
    ),
  },
  {
    id: 'encerramento',
    titulo: 'Suspensão e encerramento',
    corpo: (
      <>
        <P>
          Você pode encerrar sua conta a qualquer momento, em{' '}
          <Interno to="/configuracoes/conta">Configurações → Conta</Interno>. O
          pedido exige confirmação de identidade e fica{' '}
          <Forte>30 dias em carência</Forte>, período em que o serviço continua
          funcionando e você pode desistir com um clique. Passado o prazo, a conta
          e todos os dados são apagados em definitivo, a assinatura é cancelada e
          a recuperação deixa de ser possível — os detalhes de prazo estão na{' '}
          <Interno to="/privacidade">Política de Privacidade</Interno>.
        </P>
        <P>
          Podemos suspender ou encerrar o acesso quando houver descumprimento destes
          Termos, uso que ameace a segurança ou a estabilidade do serviço,
          inadimplência persistente, ou exigência legal. Salvo urgência ou vedação
          legal, avisamos antes e damos oportunidade de correção, além de prazo
          razoável para você extrair seus dados.
        </P>
      </>
    ),
  },
  {
    id: 'alteracoes',
    titulo: 'Alterações destes Termos',
    corpo: (
      <>
        <P>
          Estes Termos podem ser atualizados para refletir mudanças no produto ou na
          legislação. A data de vigência no topo da página sempre indica a versão
          atual.
        </P>
        <P>
          Mudanças relevantes são comunicadas por e-mail ou por aviso dentro do
          sistema, com antecedência mínima de 15 dias. Continuar usando o serviço
          depois da entrada em vigor significa aceitar a nova versão; se não
          concordar, você pode cancelar a assinatura.
        </P>
      </>
    ),
  },
  {
    id: 'lei-aplicavel',
    titulo: 'Lei aplicável e foro',
    corpo: (
      <>
        <P>
          Estes Termos são regidos pelas leis da República Federativa do Brasil, em
          especial o Código de Defesa do Consumidor (Lei 8.078/1990), o Marco Civil
          da Internet (Lei 12.965/2014) e a Lei Geral de Proteção de Dados (Lei
          13.709/2018).
        </P>
        <P>
          Eventuais controvérsias serão dirimidas no foro da{' '}
          <Forte>{EMPRESA.foro}</Forte>, ressalvado o direito do consumidor de
          demandar no foro de seu domicílio.
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
          Dúvidas sobre estes Termos, sobre a assinatura ou sobre o serviço:{' '}
          <Email endereco={EMPRESA.emailContato} />.
        </P>
        <P>
          Pedidos sobre dados pessoais chegam pela mesma caixa e são tratados nos
          termos da <Interno to="/privacidade">Política de Privacidade</Interno>.
        </P>
      </>
    ),
  },
];

export default function TermosPage() {
  return (
    <LegalLayout
      title="Termos de Uso"
      description={`As regras da relação entre você e o ${EMPRESA.produto}: o que o serviço faz, o que esperamos de você, como funcionam o teste e a assinatura, e quem responde pelo quê.`}
      resumo={
        <>
          <p>
            Você usa o CRM para organizar o comercial da sua agência. Os dados que
            cadastra são seus e não os vendemos. Há{' '}
            {DIAS_DE_TESTE} dias de teste grátis e, depois, uma assinatura de{' '}
            {PRECO_PLANO} que você cancela quando quiser.
          </p>
          <p>
            Em troca, esperamos uso dentro da lei: sem spam, sem tentativa de
            invasão e sem revender o serviço hospedado como se fosse seu.
          </p>
        </>
      }
      secoes={SECOES}
      outroDocumento={{ to: '/privacidade', label: 'Ler a Política de Privacidade →' }}
    />
  );
}
