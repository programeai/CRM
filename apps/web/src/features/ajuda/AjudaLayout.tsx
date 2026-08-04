import { Outlet } from 'react-router';
import { SectionTabs, type SectionTabItem } from '@/components/ui/section-tabs';

/**
 * Ajuda de integração: as telas cuja configuração não se resolve olhando para os
 * campos — captação de leads, notificações e a API pública — dependem de um
 * contrato com um sistema de fora, e ninguém preenche um contrato que não leu.
 *
 * Fora do gating por permissão, como Configurações: são páginas de leitura, sem
 * dado da workspace. Quem não tem `integracao:gerenciar` pode ler como o CRM
 * recebe lead — só não consegue criar o canal nem emitir chave.
 */
const TABS: SectionTabItem[] = [
  { label: 'Captação de leads', to: '/ajuda/captacao' },
  { label: 'Notificações', to: '/ajuda/notificacoes' },
  { label: 'API pública', to: '/ajuda/api' },
  { label: 'Webhooks', to: '/ajuda/webhooks' },
];

export default function AjudaLayout() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Ajuda</h1>
        <p className="text-sm text-muted-foreground">
          Como ligar o CRM ao que já roda fora dele: o que enviar, o que ele
          envia de volta e o que cada campo faz.
        </p>
      </div>

      <div className="border-b-2">
        <SectionTabs items={TABS} />
      </div>

      <Outlet />
    </div>
  );
}
