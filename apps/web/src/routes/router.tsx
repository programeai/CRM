import { createBrowserRouter } from 'react-router';
import ProtectedRoute from '@/app/ProtectedRoute';
import AppLayout from '@/app/AppLayout';
import LoginPage from '@/features/auth/LoginPage';
import ClientesListPage from '@/features/clientes/ClientesListPage';
import ClienteDetalheLayout from '@/features/clientes/ClienteDetalheLayout';
import DadosTab from '@/features/clientes/tabs/DadosTab';
import ContatosTab from '@/features/clientes/tabs/ContatosTab';
import TimelineTab from '@/features/clientes/tabs/TimelineTab';
import PlaceholderTab from '@/features/clientes/tabs/PlaceholderTab';
import PlaceholderPage from '@/features/_placeholder/PlaceholderPage';

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
              { path: 'propostas', element: <PlaceholderTab title="Propostas" /> },
              { path: 'projetos', element: <PlaceholderTab title="Projetos" /> },
              { path: 'contratos', element: <PlaceholderTab title="Contratos" /> },
            ],
          },
          { path: '/pipeline', element: <PlaceholderPage title="Pipeline" /> },
          { path: '/propostas', element: <PlaceholderPage title="Propostas" /> },
          { path: '/propostas/:id', element: <PlaceholderPage title="Proposta" /> },
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
