import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * Retorna para a tela anterior no histórico de navegação.
 *
 * Telas de detalhe são acessadas a partir de vários lugares (listagens, abas de
 * cliente, buscas), então o "voltar" deve respeitar de onde o usuário veio. Quando
 * não há histórico dentro do app (acesso direto por link/refresh), cai para `fallback`.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(() => {
    // `key === 'default'` marca a primeira entrada da sessão: não há para onde voltar.
    if (location.key === 'default') {
      navigate(fallback);
    } else {
      navigate(-1);
    }
  }, [navigate, location.key, fallback]);
}
