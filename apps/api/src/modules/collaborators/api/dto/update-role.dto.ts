import { CreateRoleDto } from './create-role.dto';

/**
 * Edição de papel envia o registro completo (nome, descrição e o conjunto de
 * permissões), como o formulário do painel faz — não é um patch parcial.
 */
export class UpdateRoleDto extends CreateRoleDto {}
