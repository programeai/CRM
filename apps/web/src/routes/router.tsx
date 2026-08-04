import { createBrowserRouter, Navigate } from 'react-router';
import ProtectedRoute from '@/app/ProtectedRoute';
import PermissionRoute from '@/app/PermissionRoute';
import AppLayout from '@/app/AppLayout';
import LoginPage from '@/features/auth/LoginPage';
import RegisterPage from '@/features/auth/RegisterPage';
import ForgotPasswordPage from '@/features/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/features/auth/ResetPasswordPage';
import AceitarConvitePage from '@/features/auth/AceitarConvitePage';
import TermosPage from '@/features/legal/TermosPage';
import PrivacidadePage from '@/features/legal/PrivacidadePage';
import ClientesListPage from '@/features/clientes/ClientesListPage';
import ClienteDetalheLayout from '@/features/clientes/ClienteDetalheLayout';
import DadosTab from '@/features/clientes/tabs/DadosTab';
import ContatosTab from '@/features/clientes/tabs/ContatosTab';
import TimelineTab from '@/features/clientes/tabs/TimelineTab';
import OportunidadesTab from '@/features/clientes/tabs/OportunidadesTab';
import PropostasTab from '@/features/clientes/tabs/PropostasTab';
import ProjetosTab from '@/features/clientes/tabs/ProjetosTab';
import DashboardPage from '@/features/dashboard/DashboardPage';
import PipelineBoardPage from '@/features/pipeline/PipelineBoardPage';
import PropostasListPage from '@/features/propostas/PropostasListPage';
import PropostaDetalhePage from '@/features/propostas/PropostaDetalhePage';
import ProjetosListPage from '@/features/demandas/ProjetosListPage';
import ProjetoDetalhePage from '@/features/demandas/ProjetoDetalhePage';
import MinhasDemandasPage from '@/features/demandas/MinhasDemandasPage';
import RecebimentosPage from '@/features/financeiro/RecebimentosPage';
import ContratosListPage from '@/features/financeiro/ContratosListPage';
import ContratoDetalhePage from '@/features/financeiro/ContratoDetalhePage';
import ContratosDoClienteTab from '@/features/financeiro/ContratosDoClienteTab';
import PaywallPage from '@/features/billing/PaywallPage';
import ConfiguracoesLayout from '@/features/configuracoes/ConfiguracoesLayout';
import ContaTab from '@/features/conta/ContaTab';
import PerfilTab from '@/features/perfil/PerfilTab';
import { SessoesAtivas } from '@/features/perfil/SessoesAtivas';
import { PreferenciasDeNotificacao } from '@/features/notificacoes/PreferenciasDeNotificacao';
import ColaboradoresPage from '@/features/organizacao/ColaboradoresPage';
import PapeisPage from '@/features/organizacao/PapeisPage';
import AuditoriaPage from '@/features/auditoria/AuditoriaPage';
import LixeiraPage from '@/features/lixeira/LixeiraPage';
import ImportacaoPage from '@/features/dados/ImportacaoPage';
import CaptacaoPage from '@/features/integracoes/CaptacaoPage';
import AjudaLayout from '@/features/ajuda/AjudaLayout';
import CaptacaoDocPage from '@/features/ajuda/CaptacaoDocPage';
import NotificacoesDocPage from '@/features/ajuda/NotificacoesDocPage';
import AdministracaoLayout, {
  AdministracaoIndex,
} from '@/features/administracao/AdministracaoLayout';
import { ADMIN_PERMISSIONS } from '@/features/administracao/tabs';
import CatalogosRedirect from '@/features/administracao/CatalogosRedirect';

// Chaves de permissão por área — as mesmas do `app/nav.ts` e do
// `@RequirePermission` da API. Basta uma delas para a rota abrir.
const CLIENTES = ['cliente:ver', 'cliente:gerenciar'];
const PIPELINE = ['oportunidade:ver', 'oportunidade:gerenciar'];
const PROPOSTAS = ['proposta:ver', 'proposta:gerenciar'];
const PROJETOS = ['projeto:ver', 'projeto:gerenciar'];
const DEMANDAS = ['projeto:ver', 'projeto:gerenciar', 'demanda:gerenciar'];
const FINANCEIRO = ['financeiro:ver', 'financeiro:gerenciar'];

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/registrar', element: <RegisterPage /> },
  { path: '/esqueci-senha', element: <ForgotPasswordPage /> },
  { path: '/redefinir-senha', element: <ResetPasswordPage /> },
  // Aceite do convite de colaborador: pública por natureza — quem abre o link
  // ainda não tem conta ativa (define a senha aqui e já entra logado).
  { path: '/convite/:token', element: <AceitarConvitePage /> },
  // Documentos legais: rotas públicas por exigência externa — o Google (login
  // social) e o Stripe checam essas URLs sem sessão. Nunca mova para dentro do
  // ProtectedRoute.
  { path: '/termos', element: <TermosPage /> },
  { path: '/privacidade', element: <PrivacidadePage /> },
  // Endereços de antes de Administração virar uma seção só. Ficam fora do
  // `ProtectedRoute` de propósito: sem sessão, o destino é que manda para o
  // login, e a pessoa volta já na aba certa.
  {
    path: '/colaboradores',
    element: <Navigate to="/administracao/colaboradores" replace />,
  },
  { path: '/papeis', element: <Navigate to="/administracao/papeis" replace /> },
  {
    path: '/auditoria',
    element: <Navigate to="/administracao/auditoria" replace />,
  },
  {
    path: '/lixeira',
    element: <Navigate to="/administracao/lixeira" replace />,
  },
  { path: '/catalogos/*', element: <CatalogosRedirect /> },
  { path: '/administracao/catalogos/*', element: <CatalogosRedirect /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          // Dashboard e assinatura ficam fora do gating: são a home de todo
          // colaborador e a tela que explica um bloqueio de assinatura.
          { path: '/', element: <DashboardPage /> },
          { path: '/assinatura', element: <PaywallPage /> },
          // Configurações da própria conta: fora do gating por permissão, como
          // o Dashboard — todo colaborador edita o próprio perfil, vê os
          // próprios dispositivos e escolhe onde ser avisado.
          {
            path: '/configuracoes',
            element: <ConfiguracoesLayout />,
            children: [
              { index: true, element: <PerfilTab /> },
              { path: 'dispositivos', element: <SessoesAtivas /> },
              { path: 'notificacoes', element: <PreferenciasDeNotificacao /> },
              { path: 'conta', element: <ContaTab /> },
            ],
          },
          // Ajuda de integração: páginas de leitura, sem dado da workspace —
          // fora do gating pelo mesmo motivo que Configurações. Quem configura
          // o canal e quem cola a URL do webhook são pessoas diferentes.
          {
            path: '/ajuda',
            element: <AjudaLayout />,
            children: [
              { index: true, element: <Navigate to="captacao" replace /> },
              { path: 'captacao', element: <CaptacaoDocPage /> },
              { path: 'notificacoes', element: <NotificacoesDocPage /> },
            ],
          },
          {
            element: <PermissionRoute permission={CLIENTES} />,
            children: [
              { path: '/clientes', element: <ClientesListPage /> },
              {
                path: '/clientes/:id',
                element: <ClienteDetalheLayout />,
                children: [
                  { index: true, element: <DadosTab /> },
                  { path: 'contatos', element: <ContatosTab /> },
                  { path: 'timeline', element: <TimelineTab /> },
                  { path: 'oportunidades', element: <OportunidadesTab /> },
                  { path: 'propostas', element: <PropostasTab /> },
                  { path: 'projetos', element: <ProjetosTab /> },
                  { path: 'contratos', element: <ContratosDoClienteTab /> },
                ],
              },
            ],
          },
          {
            element: <PermissionRoute permission={PIPELINE} />,
            children: [{ path: '/pipeline', element: <PipelineBoardPage /> }],
          },
          {
            element: <PermissionRoute permission={PROPOSTAS} />,
            children: [
              { path: '/propostas', element: <PropostasListPage /> },
              { path: '/propostas/:id', element: <PropostaDetalhePage /> },
            ],
          },
          {
            element: <PermissionRoute permission={PROJETOS} />,
            children: [
              { path: '/projetos', element: <ProjetosListPage /> },
              { path: '/projetos/:id', element: <ProjetoDetalhePage /> },
            ],
          },
          {
            element: <PermissionRoute permission={DEMANDAS} />,
            children: [{ path: '/demandas', element: <MinhasDemandasPage /> }],
          },
          {
            element: <PermissionRoute permission={FINANCEIRO} />,
            children: [
              { path: '/financeiro', element: <RecebimentosPage /> },
              { path: '/financeiro/contratos', element: <ContratosListPage /> },
              {
                path: '/financeiro/contratos/:id',
                element: <ContratoDetalhePage />,
              },
            ],
          },
          // Administração: configuração da workspace em abas. A guarda de fora
          // é a união das chaves (basta uma para a seção existir); cada aba
          // mantém a sua, para quem entra por link direto.
          {
            element: <PermissionRoute permission={ADMIN_PERMISSIONS} />,
            children: [
              {
                path: '/administracao',
                element: <AdministracaoLayout />,
                children: [
                  { index: true, element: <AdministracaoIndex /> },
                  {
                    element: (
                      <PermissionRoute permission={['colaborador:gerenciar']} />
                    ),
                    children: [
                      { path: 'colaboradores', element: <ColaboradoresPage /> },
                    ],
                  },
                  {
                    element: <PermissionRoute permission={['papel:gerenciar']} />,
                    children: [{ path: 'papeis', element: <PapeisPage /> }],
                  },
                  {
                    element: <PermissionRoute permission={['dados:importar']} />,
                    children: [
                      { path: 'importacao', element: <ImportacaoPage /> },
                    ],
                  },
                  {
                    element: (
                      <PermissionRoute permission={['integracao:gerenciar']} />
                    ),
                    children: [
                      { path: 'captacao', element: <CaptacaoPage /> },
                    ],
                  },
                  {
                    element: <PermissionRoute permission={['auditoria:ver']} />,
                    children: [
                      { path: 'auditoria', element: <AuditoriaPage /> },
                    ],
                  },
                  {
                    element: <PermissionRoute permission={['lixeira:ver']} />,
                    children: [{ path: 'lixeira', element: <LixeiraPage /> }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
