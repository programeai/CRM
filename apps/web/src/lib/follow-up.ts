import { formatDate } from '@/lib/format';

/**
 * Estado do próximo passo de um registro, derivado da data agendada.
 *
 * É o sinal que o card do funil e a timeline compartilham — daí viver em `lib/`
 * e não dentro de uma feature. `nenhum` não é ausência de informação: é a
 * informação mais útil do quadro ("esta oportunidade não tem próximo passo").
 */
export type FollowUpState = 'atrasado' | 'hoje' | 'agendado' | 'nenhum';

/** Milissegundos da meia-noite local — a comparação é por DIA, não por hora. */
function inicioDoDia(value: Date): number {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}

/**
 * Um follow-up marcado para hoje às 9h ainda é "hoje" às 18h: quem agendou
 * escolheu o dia, e o cron de lembretes também dispara por dia. Só vira
 * `atrasado` quando o dia vira.
 */
export function followUpState(
  scheduledFor?: string | Date | null,
): FollowUpState {
  if (!scheduledFor) return 'nenhum';
  const dia = inicioDoDia(new Date(scheduledFor));
  const hoje = inicioDoDia(new Date());
  if (dia < hoje) return 'atrasado';
  if (dia === hoje) return 'hoje';
  return 'agendado';
}

/** Rótulo curto do sinal, para caber no card do funil. */
export function followUpLabel(scheduledFor?: string | Date | null): string {
  switch (followUpState(scheduledFor)) {
    case 'nenhum':
      return 'Sem próximo passo';
    case 'atrasado':
      return 'Atrasado';
    case 'hoje':
      return 'Hoje';
    case 'agendado':
      return formatDate(scheduledFor);
  }
}
