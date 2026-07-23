import { createBrowserRouter } from 'react-router';
import ProtectedRoute from '@/app/ProtectedRoute';
import AppLayout from '@/app/AppLayout';
import LoginPage from '@/features/auth/LoginPage';
import ClientesListPage from '@/features/clientes/ClientesListPage';
import ClienteDetalheLayout from '@/features/clientes/ClienteDetalheLayout';
import DadosTab from '@/features/clientes/tabs/DadosTab';
import ContatosTab from '@/features/clientes/tabs/ContatosTab';
import TimelineTab from '@/features/clientes/tabs/TimelineTab';
import OportunidadesTab from '@/features/clientes/tabs/OportunidadesTab';
import PropostasTab from '@/features/clientes/tabs/PropostasTab';
import ProjetosTab from '@/features/clientes/tabs/ProjetosTab';
import PlaceholderPage from '@/features/_placeholder/PlaceholderPage';
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

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <PlaceholderPage title="Dashboard" /> },
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
          { path: '/pipeline', element: <PipelineBoardPage /> },
          { path: '/propostas', element: <PropostasListPage /> },
          { path: '/propostas/:id', element: <PropostaDetalhePage /> },
          { path: '/projetos', element: <ProjetosListPage /> },
          { path: '/projetos/:id', element: <ProjetoDetalhePage /> },
          { path: '/demandas', element: <MinhasDemandasPage /> },
          { path: '/financeiro', element: <RecebimentosPage /> },
          { path: '/financeiro/contratos', element: <ContratosListPage /> },
          { path: '/financeiro/contratos/:id', element: <ContratoDetalhePage /> },
        ],
      },
    ],
  },
]);
