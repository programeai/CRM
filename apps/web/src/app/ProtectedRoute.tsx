import { Navigate, Outlet } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';

export default function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
