import { Navigate, Outlet } from 'react-router';
import { SectionTabs } from '@/components/ui/section-tabs';
import { useCan } from '@/hooks/use-can';
import { ADMIN_TABS } from './tabs';

/**
 * Configuração da workspace em um lugar só. Antes eram cinco itens soltos no
 * grupo "Organização" da sidebar; aqui viram abas, e a sidebar volta a listar
 * só o trabalho do dia a dia.
 *
 * Este layout desenha a moldura — título da seção e abas visíveis para quem
 * está logado. O cabeçalho de cada aba é da tela-filha (`SectionHeading`),
 * porque é ela que tem a ação principal.
 */
export default function AdministracaoLayout() {
  const { canAny } = useCan();
  const tabs = ADMIN_TABS.filter((tab) => canAny(tab.permission ?? []));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Administração</h1>
        <p className="text-sm text-muted-foreground">
          A configuração da sua workspace: quem tem acesso, o que cada papel
          pode fazer, as listas do domínio e o rastro do que mudou.
        </p>
      </div>

      <div className="border-b-2">
        <SectionTabs items={tabs} />
      </div>

      <Outlet />
    </div>
  );
}

/**
 * `/administracao` não tem tela própria: manda para a primeira aba que a pessoa
 * pode ver. Quem só tem `lixeira:ver` cai na Lixeira, não numa tela vazia.
 *
 * Não checa `loading`: a `PermissionRoute` da rota-mãe só monta os filhos
 * depois que as permissões chegaram.
 */
export function AdministracaoIndex() {
  const { canAny } = useCan();
  const first = ADMIN_TABS.find((tab) => canAny(tab.permission ?? []));
  return <Navigate to={first?.to ?? '/'} replace />;
}
