import { Navigate } from 'react-router';

/**
 * Endereços antigos dos catálogos → a única tela de catálogo que sobrou.
 *
 * Serviços, fontes de lead e motivos de perda deixaram de ter página: passaram a
 * nascer e morrer dentro do `CatalogSelect`, no formulário em que aparecem. Um
 * link salvo para eles não tem mais destino próprio, então cai em Tipos de
 * atividade — sucessora da tela de Catálogos — em vez de num 404.
 */
export default function CatalogosRedirect() {
  return <Navigate to="/administracao/tipos-de-atividade" replace />;
}
