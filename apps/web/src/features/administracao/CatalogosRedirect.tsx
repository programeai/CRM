import { Navigate } from 'react-router';

/**
 * Endereços antigos dos catálogos → Administração.
 *
 * Nenhum dos quatro catálogos tem tela: todos nascem, são escolhidos e morrem
 * dentro do `CatalogSelect`, no formulário em que fazem falta. Tipos de atividade
 * foi o último a sair, quando 'Follow-up' passou a ser tipo primitivo e deixou de
 * haver regra para escolher ali. Um link salvo cai na primeira aba que a pessoa
 * pode ver (`AdministracaoIndex`), em vez de num 404.
 */
export default function CatalogosRedirect() {
  return <Navigate to="/administracao" replace />;
}
