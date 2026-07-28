/**
 * Superfície pública da feature. Atividade é um registro transversal (cliente e
 * oportunidade), então mais de uma feature a consome — todas por aqui, nunca
 * pelo interior da pasta.
 */
export { ActivityTimeline } from './ActivityTimeline';
export type { Activity, ActivityScope } from './api/types';
