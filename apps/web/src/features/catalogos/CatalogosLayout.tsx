import { Outlet } from 'react-router';
import { SectionTabs, type SectionTabItem } from '@/components/ui/section-tabs';

/**
 * Catálogos são da **workspace**, não da conta — por isso ficam aqui e não em
 * `/configuracoes`, que é a tela da própria pessoa. A seção inteira exige
 * `catalogo:gerenciar` (ver a rota e `app/nav.ts`), então as abas não declaram
 * `permission` individual.
 */
const TABS: SectionTabItem[] = [
  { label: 'Serviços', to: '/catalogos', end: true },
  { label: 'Fontes de lead', to: '/catalogos/fontes-de-lead' },
  { label: 'Tipos de atividade', to: '/catalogos/tipos-de-atividade' },
  { label: 'Motivos de perda', to: '/catalogos/motivos-de-perda' },
];

export default function CatalogosLayout() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Catálogos</h1>
        <p className="text-sm text-muted-foreground">
          As listas do domínio da sua workspace: tipos de serviço, fontes de
          lead, tipos de atividade e motivos de perda.
        </p>
      </div>

      <div className="border-b-2">
        <SectionTabs items={TABS} />
      </div>

      <Outlet />
    </div>
  );
}
