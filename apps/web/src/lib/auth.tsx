import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { setAccessToken } from './auth-store';

type AuthCtx = {
  isAuthenticated: boolean;
  loading: boolean;
  login: (e: string, p: string) => Promise<void>;
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

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
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
        register,
        acceptInvite,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
