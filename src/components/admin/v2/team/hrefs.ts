// Enderecos da tela de Equipe (Configuracoes > Equipe): pessoas e funcoes.

export const TEAM_PATH = "/admin/configuracoes/equipe";
export const NEW_TEAM_MEMBER_PATH = `${TEAM_PATH}/novo`;
export const TEAM_FUNCTIONS_PATH = `${TEAM_PATH}/funcoes`;
export const NEW_TEAM_FUNCTION_PATH = `${TEAM_FUNCTIONS_PATH}/nova`;

export function teamMemberHref(userId: string) {
  return `${TEAM_PATH}/${encodeURIComponent(userId)}`;
}

export function teamFunctionHref(id: string) {
  return `${TEAM_FUNCTIONS_PATH}/${encodeURIComponent(id)}`;
}

/** Nova funcao ja com as permissoes de uma funcao pronta ("Duplicar e ajustar"). */
export function newTeamFunctionFromPresetHref(preset: string) {
  return `${NEW_TEAM_FUNCTION_PATH}?a_partir_de=${encodeURIComponent(preset)}`;
}
