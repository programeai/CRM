export const LEAD_INTAKE_CHANNEL_REPOSITORY = Symbol(
  'LEAD_INTAKE_CHANNEL_REPOSITORY',
);

export interface LeadIntakeChannelRecord {
  id: string;
  ownerId: string;
  name: string;
  assigneeId: string | null;
  sourceId: string | null;
  keyId: string | null;
  createdAt: Date;
}

export interface LeadIntakeChannelRepository {
  findManyByOwner(ownerId: string): Promise<LeadIntakeChannelRecord[]>;
  findById(
    ownerId: string,
    id: string,
  ): Promise<LeadIntakeChannelRecord | null>;
  /** O canal que a chave autentica. Roda DENTRO do contexto do owner. */
  findByKeyId(
    ownerId: string,
    keyId: string,
  ): Promise<LeadIntakeChannelRecord | null>;
  create(data: {
    ownerId: string;
    name: string;
    assigneeId?: string | null;
    sourceId?: string | null;
    keyId: string;
  }): Promise<LeadIntakeChannelRecord>;
  update(
    ownerId: string,
    id: string,
    data: {
      name?: string;
      assigneeId?: string | null;
      sourceId?: string | null;
    },
  ): Promise<LeadIntakeChannelRecord>;
  delete(ownerId: string, id: string): Promise<void>;
}
