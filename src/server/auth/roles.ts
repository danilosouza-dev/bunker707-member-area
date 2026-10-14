// Tabela de papeis do Admin Bunker707 (docs/17 §2.3). Modulo puro: sem "server-only", sem React,
// sem aliases; tests/admin-permissions.test.mjs carrega este arquivo direto pelo Node.
//
// Regra unica: toda Server Action e toda rota /api/admin/** que escreve chama requireRole(acao) ou
// requireApiRole(acao) (src/server/auth/permissions.ts), que consultam canRole(). Nenhuma tela decide
// permissao por conta propria; a UI so usa canRole() para esconder botoes.

import type { AdminRole } from "./session";

export type { AdminRole };

export const ADMIN_ROLES = ["owner", "admin", "editor", "support", "analyst"] as const satisfies readonly AdminRole[];

const everyone: readonly AdminRole[] = ADMIN_ROLES;
const producers: readonly AdminRole[] = ["owner", "admin", "editor"];
const managers: readonly AdminRole[] = ["owner", "admin"];
const staffWithoutAnalyst: readonly AdminRole[] = ["owner", "admin", "editor", "support"];

/**
 * Acoes do admin. Leitura de agregados e livre para todos os papeis; o resto segue a tabela de §2.3.
 * Acrescentar uma acao = acrescentar uma linha aqui e um caso em tests/admin-permissions.test.mjs.
 */
export const ADMIN_ACTION_ROLES = {
  /** Entrar no admin e ver agregados (Hoje, listas, desempenho). */
  "admin.read": everyone,
  /** Produtos: criar e editar produto, modulo, aula, capa, ordem, formacao. */
  "catalog.write": producers,
  /** Produtos: publicar, despublicar, arquivar. */
  "catalog.publish": producers,
  /** Produtos: excluir produto (revoga acessos ligados a ele). Modulos e aulas usam catalog.write. */
  "catalog.delete": managers,
  /** Area de membros: vitrine, destaque, login, fileira de modulos na home e marca. */
  "storefront.write": producers,
  /** Alunos: nome e e-mail. */
  "students.read_basic": staffWithoutAnalyst,
  /** Alunos: telefone, documento, cidade, historico. */
  "students.read_personal": ["owner", "admin", "support"],
  /** Alunos: liberar, estender, suspender e revogar acesso. */
  "students.access": ["owner", "admin", "support"],
  /** Alunos: excluir aluno (conta, acessos e dados pessoais). */
  "students.delete": managers,
  /** Exportar CSV com dados pessoais. */
  "students.export": managers,
  /** Comunicacao: criar e agendar avisos, webinarios e promocoes. */
  "messaging.write": producers,
  /** Comunicacao: publicar ate 500 alunos (acima disso fica aguardando aprovacao). */
  "messaging.publish": producers,
  /** Comunicacao: publicar acima de 500 alunos sem segunda aprovacao, e aprovar o pedido de outro. */
  "messaging.publish_large": managers,
  /** Comunidade: responder como professor, resolver, respostas rapidas. */
  "community.reply": staffWithoutAnalyst,
  /** Comunidade: ocultar, marcar spam, restaurar, palavras bloqueadas. */
  "community.moderate": staffWithoutAnalyst,
  /** Configuracoes > IA: provedores, conexoes, limites. */
  "settings.ai": managers,
  /** Configuracoes > Vendas: segredos das plataformas de venda. */
  "settings.sales": managers,
  /** Configuracoes > Equipe: papeis. */
  "settings.team": ["owner"]
} as const satisfies Record<string, readonly AdminRole[]>;

export type AdminAction = keyof typeof ADMIN_ACTION_ROLES;

export const ADMIN_ACTIONS = Object.keys(ADMIN_ACTION_ROLES) as AdminAction[];

const adminRoleSet = new Set<string>(ADMIN_ROLES);
const adminActionSet = new Set<string>(ADMIN_ACTIONS);

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && adminRoleSet.has(value);
}

export function isAdminAction(value: unknown): value is AdminAction {
  return typeof value === "string" && adminActionSet.has(value);
}

/** Papel pode executar a acao? Papel ausente ou desconhecido nunca pode; acao desconhecida tambem nao. */
export function canRole(role: AdminRole | null | undefined, action: AdminAction): boolean {
  if (!isAdminRole(role) || !isAdminAction(action)) {
    return false;
  }

  return (ADMIN_ACTION_ROLES[action] as readonly AdminRole[]).includes(role);
}

/** Papeis que podem executar a acao, na ordem de ADMIN_ROLES (para requireApiAdmin({ roles })). */
export function rolesFor(action: AdminAction): AdminRole[] {
  return ADMIN_ROLES.filter((role) => canRole(role, action));
}

/** Frase de recusa em portugues do produtor, igual em Server Action e rota. */
export function describeForbidden(action: AdminAction) {
  if (action === "settings.team") {
    return "Só o dono da escola pode mudar a equipe.";
  }

  if (action.startsWith("settings.") || action === "catalog.delete" || action === "students.export") {
    return "Só o dono ou um administrador pode fazer isso.";
  }

  return "Seu papel na equipe não permite esta ação.";
}
