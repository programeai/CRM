import { createBrowserRouter } from 'react-router';
import ProtectedRoute from '@/app/ProtectedRoute';
import AppLayout from '@/app/AppLayout';
import LoginPage from '@/features/auth/LoginPage';
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
          { path: '/clientes', element: <PlaceholderPage title="Clientes" /> },
          { path: '/clientes/:id', element: <PlaceholderPage title="Cliente" /> },
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
