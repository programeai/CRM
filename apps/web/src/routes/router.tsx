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
import PlaceholderTab from '@/features/clientes/tabs/PlaceholderTab';
import PlaceholderPage from '@/features/_placeholder/PlaceholderPage';
import PipelineBoardPage from '@/features/pipeline/PipelineBoardPage';
import PropostasListPage from '@/features/propostas/PropostasListPage';
import PropostaDetalhePage from '@/features/propostas/PropostaDetalhePage';

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
              { path: 'projetos', element: <PlaceholderTab title="Projetos" /> },
              { path: 'contratos', element: <PlaceholderTab title="Contratos" /> },
            ],
          },
          { path: '/pipeline', element: <PipelineBoardPage /> },
          { path: '/propostas', element: <PropostasListPage /> },
          { path: '/propostas/:id', element: <PropostaDetalhePage /> },
          { path: '/projetos/:id', element: <PlaceholderPage title="Projeto" /> },
          { path: '/demandas', element: <PlaceholderPage title="Demandas" /> },
          { path: '/financeiro', element: <PlaceholderPage title="Financeiro — Recebimentos" /> },
          { path: '/financeiro/contratos', element: <PlaceholderPage title="Contratos" /> },
          {
            path: '/financeiro/contratos/:id',
            element: <PlaceholderPage title="Contrato" />,
          },
        ],
      },
    ],
  },
]);
