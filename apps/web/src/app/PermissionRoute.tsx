import { Navigate, Outlet } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { useCan } from '@/hooks/use-can';

/**
 * Guarda de rota por permissão. Complementa o `ProtectedRoute` (que só checa
 * sessão): sem uma das chaves exigidas, manda para o Dashboard em vez de
 * renderizar uma tela que só produziria 403 em cada requisição.
 *
 * Basta **uma** das chaves, como no `@RequirePermission` da API. A autoridade
 * continua sendo o backend; isto é conveniência de navegação.
 */
export default function PermissionRoute({
  permission,
}: {
  permission: string[];
}) {
  const { canAny, loading } = useCan();

  // Sem as permissões carregadas ainda não há decisão a tomar — redirecionar
  // aqui expulsaria o usuário da própria rota que ele tem direito de ver.
  if (loading) {
    return (
      <div className="grid min-h-64 place-items-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  if (!canAny(permission)) return <Navigate to="/" replace />;
  return <Outlet />;
}
