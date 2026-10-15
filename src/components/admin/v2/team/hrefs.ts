// Enderecos da tela de Equipe (Configuracoes > Equipe).

export const TEAM_PATH = "/admin/configuracoes/equipe";
export const NEW_TEAM_MEMBER_PATH = `${TEAM_PATH}/novo`;

export function teamMemberHref(userId: string) {
  return `${TEAM_PATH}/${encodeURIComponent(userId)}`;
}
