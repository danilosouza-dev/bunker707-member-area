// Quem cuida da Licenca na escola (docs/32 §2.2 e §2.4): as contas da equipe com papel de dono ou de administrador. Sao
// elas que veem a tela Licenca, ativam, conferem, desativam e carregam a licenca por arquivo, e sao elas que recebem os
// e-mails da Instalacao a cada degrau. Puro, sem "server-only" e sem "@/": os testes carregam direto.
//
// Papel, nao permissao: uma funcao personalizada pode somar as mesmas permissoes do Administrador sem ser administrador.
// Vale o Dono, o Administrador e a pessoa com a funcao pronta Administrador combinada com outras (papel "custom").

import { isAdminRole, memberFunctionsOf, parseStoredPermissions, type AdminAccess } from "../auth/roles";

/** A pessoa (permissoes ja resolvidas) e dona ou administradora da escola? */
export function isLicenseManager(access: AdminAccess | null | undefined): boolean {
  if (!access) {
    return false;
  }

  return access.role === "owner" || access.role === "admin" || access.functions.includes("admin");
}

/** A linha de admin_roles (papel e permissoes gravadas) e de um dono ou administrador? Papel desconhecido: nao. */
export function isLicenseManagerRow(role: unknown, permissions: unknown): boolean {
  if (!isAdminRole(role)) {
    return false;
  }

  if (role === "owner" || role === "admin") {
    return true;
  }

  return memberFunctionsOf(role, parseStoredPermissions(permissions)).includes("admin");
}
