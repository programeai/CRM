import { Outlet } from 'react-router';
import { SectionTabs, type SectionTabItem } from '@/components/ui/section-tabs';
import { useCan } from '@/hooks/use-can';

/**
 * Abas da própria conta. As três primeiras não declaram permissão: todo mundo —
 * owner ou colaborador — edita o próprio perfil, vê os próprios dispositivos e
 * escolhe onde ser avisado. "Conta" é a exceção e o primeiro gate por `isOwner`
 * da interface: exportar a workspace e encerrá-la não são "própria conta" no
 * sentido do colaborador. Assinatura fica de fora: é `/assinatura`.
 */
const TABS: SectionTabItem[] = [
  { label: 'Perfil', to: '/configuracoes', end: true },
  { label: 'Dispositivos', to: '/configuracoes/dispositivos' },
  // Segurança fica ao lado de Dispositivos, e sem gate por `isOwner`: o segundo
  // fator é da própria conta, e o owner **não** pode exigi-lo de um colaborador
  // (isso criaria um estado "logado mas obrigado a configurar" em toda rota).
  { label: 'Segurança', to: '/configuracoes/seguranca' },
  { label: 'Notificações', to: '/configuracoes/notificacoes' },
];

const TAB_DA_CONTA: SectionTabItem = {
  label: 'Conta',
  to: '/configuracoes/conta',
};

export default function ConfiguracoesLayout() {
  const { isOwner } = useCan();
  const tabs = isOwner ? [...TABS, TAB_DA_CONTA] : TABS;

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
        <SectionTabs items={tabs} />
      </div>

      <Outlet />
    </div>
  );
}
