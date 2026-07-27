import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  COLLABORATOR_REPOSITORY,
  type CollaboratorRepository,
  type CollaboratorView,
} from '../domain/collaborator.repository';
import { InvitesService } from './invites.service';
import { RolesService } from './roles.service';

/** Situação do colaborador, derivada — não é coluna no banco. */
export type CollaboratorStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';

export interface CollaboratorResponse {
  id: string;
  name: string;
  email: string;
  active: boolean;
  status: CollaboratorStatus;
  role: { id: string; name: string; system: boolean } | null;
  createdAt: Date;
}

@Injectable()
export class CollaboratorsService {
  private readonly logger = new Logger(CollaboratorsService.name);

  constructor(
    @Inject(COLLABORATOR_REPOSITORY)
    private readonly collaborators: CollaboratorRepository,
    private readonly roles: RolesService,
    private readonly invites: InvitesService,
  ) {}

  async list(ownerId: string): Promise<CollaboratorResponse[]> {
    const rows = await this.collaborators.findManyByOwner(ownerId);
    return rows.map(toResponse);
  }

  /**
   * Cria o colaborador **sem senha** e emite o convite: a senha é definida pelo
   * próprio convidado no link. Enquanto o convite não é aceito, o login é
   * negado (não há hash para verificar).
   */
  async invite(
    ownerId: string,
    data: { name: string; email: string; roleId: string },
  ): Promise<{ collaborator: CollaboratorResponse; inviteUrl: string }> {
    const email = data.email.trim().toLowerCase();

    // Papel tem de ser do próprio owner (o findOrFail já filtra por ownerId).
    const role = await this.roles.findOrFail(ownerId, data.roleId);

    if (await this.collaborators.existsByEmail(email)) {
      throw new ConflictException('Já existe uma conta com este e-mail.');
    }

    const created = await this.collaborators.create({
      ownerId,
      name: data.name.trim(),
      email,
      roleId: role.id,
    });

    const inviteUrl = await this.invites.issue({
      ownerId,
      ownerName: await this.collaborators.findOwnerName(ownerId),
      userId: created.id,
      name: created.name,
      email: created.email,
      roleName: role.name,
    });

    this.logger.log({
      evento: 'colaborador.convidado',
      msg: 'Colaborador convidado.',
      colaboradorId: created.id,
      papelId: role.id,
    });
    return { collaborator: toResponse(created), inviteUrl };
  }

  /** Novo link para quem ainda não aceitou — invalida o anterior. */
  async resendInvite(
    ownerId: string,
    id: string,
  ): Promise<{ inviteUrl: string }> {
    const collaborator = await this.findOrFail(ownerId, id);
    if (collaborator.acceptedAt) {
      throw new ConflictException(
        'Este colaborador já ativou o acesso. Se ele perdeu a senha, use "Esqueci minha senha".',
      );
    }
    const inviteUrl = await this.invites.issue({
      ownerId,
      ownerName: await this.collaborators.findOwnerName(ownerId),
      userId: collaborator.id,
      name: collaborator.name,
      email: collaborator.email,
      roleName: collaborator.role?.name ?? '',
    });
    this.logger.log({
      evento: 'colaborador.convite_reemitido',
      msg: 'Convite de colaborador reemitido.',
      colaboradorId: collaborator.id,
    });
    return { inviteUrl };
  }

  /**
   * Troca de papel e ativação/desativação. Só mexe em colaborador do próprio
   * owner — o owner não é colaborador de ninguém, então não é alcançável aqui,
   * e `requesterId` impede mexer em si mesmo.
   */
  async update(
    params: { ownerId: string; requesterId: string },
    id: string,
    data: { roleId?: string; active?: boolean },
  ): Promise<CollaboratorResponse> {
    const { ownerId, requesterId } = params;
    if (id === requesterId) {
      throw new ForbiddenException(
        'Você não pode alterar o seu próprio acesso.',
      );
    }
    const current = await this.findOrFail(ownerId, id);

    if (data.roleId && data.roleId !== current.role?.id) {
      await this.roles.findOrFail(ownerId, data.roleId);
    }

    const updated = await this.collaborators.update(id, ownerId, data);

    // Desativar sem revogar deixaria vivos os refresh tokens dos navegadores dele.
    if (data.active === false) {
      const revogadas = await this.collaborators.revokeSessions(id, ownerId);
      this.logger.log({
        evento: 'sessoes.revogadas',
        msg: 'Sessões do colaborador revogadas na desativação.',
        colaboradorId: id,
        quantidade: revogadas,
      });
    }

    if (data.roleId && data.roleId !== current.role?.id) {
      this.logger.log({
        evento: 'colaborador.papel_alterado',
        msg: 'Papel do colaborador alterado.',
        colaboradorId: id,
        papelId: data.roleId,
      });
    }
    if (data.active !== undefined && data.active !== current.active) {
      this.logger.log({
        evento: data.active
          ? 'colaborador.reativado'
          : 'colaborador.desativado',
        msg: data.active ? 'Colaborador reativado.' : 'Colaborador desativado.',
        colaboradorId: id,
      });
    }
    return toResponse(updated);
  }

  private async findOrFail(
    ownerId: string,
    id: string,
  ): Promise<CollaboratorView> {
    const collaborator = await this.collaborators.findByIdAndOwner(id, ownerId);
    if (!collaborator) {
      throw new NotFoundException('Colaborador não encontrado.');
    }
    return collaborator;
  }
}

function toResponse(collaborator: CollaboratorView): CollaboratorResponse {
  return {
    id: collaborator.id,
    name: collaborator.name,
    email: collaborator.email,
    active: collaborator.active,
    // `acceptedAt` nulo = convite enviado e ainda não aceito.
    status: !collaborator.acceptedAt
      ? 'PENDING'
      : collaborator.active
        ? 'ACTIVE'
        : 'INACTIVE',
    role: collaborator.role,
    createdAt: collaborator.createdAt,
  };
}
