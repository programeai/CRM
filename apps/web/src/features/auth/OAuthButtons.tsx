import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

type Providers = { google: boolean; github: boolean };

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
      <path d="M12 1C5.92 1 1 5.92 1 12c0 4.86 3.15 8.98 7.52 10.44.55.1.75-.24.75-.53v-1.86c-3.06.67-3.7-1.47-3.7-1.47-.5-1.27-1.22-1.61-1.22-1.61-1-.68.08-.67.08-.67 1.1.08 1.68 1.14 1.68 1.14.98 1.68 2.57 1.2 3.2.92.1-.71.38-1.2.7-1.47-2.44-.28-5.01-1.22-5.01-5.43 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.91 0 0 .92-.3 3.02 1.13a10.5 10.5 0 0 1 5.5 0c2.1-1.43 3.02-1.13 3.02-1.13.6 1.51.22 2.63.11 2.91.7.77 1.13 1.75 1.13 2.95 0 4.22-2.58 5.15-5.03 5.42.4.34.75 1.01.75 2.04v3.03c0 .29.2.64.76.53A11.01 11.01 0 0 0 23 12c0-6.08-4.92-11-11-11Z" />
    </svg>
  );
}

/** Ir para o backend inicia o fluxo OAuth (redirecionamento de página inteira). */
function goToProvider(provider: 'google' | 'github') {
  window.location.href = `${import.meta.env.VITE_API_URL}/auth/oauth/${provider}`;
}

export function OAuthButtons() {
  const { data } = useQuery<Providers>({
    queryKey: queryKeys.auth.oauthProviders,
    queryFn: async () => (await api.get('/auth/oauth/providers')).data,
    staleTime: 5 * 60 * 1000,
  });

  if (!data?.google && !data?.github) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">ou continue com</span>
        <Separator className="flex-1" />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {data?.google && (
          <Button
            type="button"
            variant="outline"
            onClick={() => goToProvider('google')}
          >
            <GoogleIcon />
            Google
          </Button>
        )}
        {data?.github && (
          <Button
            type="button"
            variant="outline"
            onClick={() => goToProvider('github')}
          >
            <GithubIcon />
            GitHub
          </Button>
        )}
      </div>
    </div>
  );
}
