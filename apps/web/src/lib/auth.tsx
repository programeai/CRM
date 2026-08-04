import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { setAccessToken } from './auth-store';

/**
 * O que o `login` devolve. `desafio` presente = a senha foi aceita mas falta o
 * segundo fator, e a sessão **não** foi aberta — a tela troca o formulário pelo
 * passo do código e chama `concluirLoginCom2fa`.
 */
export type ResultadoDeLogin =
  | { autenticado: true }
  | { autenticado: false; desafio: string };

type AuthCtx = {
  isAuthenticated: boolean;
  loading: boolean;
  login: (e: string, p: string) => Promise<ResultadoDeLogin>;
  /** Segundo passo: troca o desafio + o código pela sessão. */
  concluirLoginCom2fa: (desafio: string, codigo: string) => Promise<void>;
  register: (
    name: string,
    e: string,
    p: string,
    captchaToken?: string,
  ) => Promise<void>;
  /**
   * Aceita o convite de colaborador: define a senha e já autentica (o link veio
   * no e-mail do próprio convidado). Fica aqui, e não na página, para o token de
   * acesso entrar na sessão pelo mesmo caminho de `login`/`register`.
   */
  acceptInvite: (token: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setAuth] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .post('/auth/refresh')
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        setAuth(true);
      })
      .catch(() => {
        setAccessToken(null);
        setAuth(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (
    email: string,
    password: string,
  ): Promise<ResultadoDeLogin> => {
    const { data } = await api.post('/auth/login', { email, password });
    /*
      A API responde **200** com `{ twoFactorRequired, desafio }` quando falta o
      segundo fator — não 401. É o que permite `lib/api.ts` ficar intacto: o
      interceptor dispara o fluxo de refresh em todo 401 e, falhando, manda para
      /login; um 401 aqui poria a tela em laço.
    */
    if (data?.twoFactorRequired) {
      return { autenticado: false, desafio: data.desafio as string };
    }
    setAccessToken(data.accessToken);
    setAuth(true);
    return { autenticado: true };
  };
  const concluirLoginCom2fa = async (desafio: string, codigo: string) => {
    const { data } = await api.post('/auth/login/2fa', { desafio, codigo });
    setAccessToken(data.accessToken);
    setAuth(true);
  };
  const register = async (
    name: string,
    email: string,
    password: string,
    captchaToken?: string,
  ) => {
    const { data } = await api.post('/auth/register', {
      name,
      email,
      password,
      captchaToken,
    });
    setAccessToken(data.accessToken);
    setAuth(true);
  };
  const acceptInvite = async (token: string, password: string) => {
    const { data } = await api.post(
      `/collaborators/invite/${token}/accept`,
      { password },
    );
    setAccessToken(data.accessToken);
    setAuth(true);
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setAuth(false);
  };
  return (
    <Ctx.Provider
      value={{
        isAuthenticated,
        loading,
        login,
        concluirLoginCom2fa,
        register,
        acceptInvite,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
