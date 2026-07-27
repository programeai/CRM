import { Outlet } from 'react-router';
import { SectionTabs, type SectionTabItem } from '@/components/ui/section-tabs';

/**
 * Abas da própria conta: nenhuma declara `permission`. Todo mundo — owner ou
 * colaborador — edita o próprio perfil, vê os próprios dispositivos e escolhe
 * onde ser avisado. Assinatura fica de fora: é `/assinatura`, a tela que
 * explica um bloqueio e o destino de retorno do Stripe.
 */
const TABS: SectionTabItem[] = [
  { label: 'Perfil', to: '/configuracoes', end: true },
  { label: 'Dispositivos', to: '/configuracoes/dispositivos' },
  { label: 'Notificações', to: '/configuracoes/notificacoes' },
];

export default function ConfiguracoesLayout() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Sua conta neste CRM: dados de acesso, dispositivos conectados e onde
          você recebe cada aviso.
        </p>
      </div>

      <div className="border-b-2">
        <SectionTabs items={TABS} />
      </div>

      <Outlet />
    </div>
  );
}
