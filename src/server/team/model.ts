// Equipe (docs/17 §2.3): textos das funcoes e permissoes, regras de mudanca e o resumo que vai para a
// lista e para a auditoria. Modulo puro (sem servidor nem React, imports relativos): a tela, as Server
// Actions e tests/admin-team.test.mjs usam as mesmas funcoes.

import {
  ADMIN_ROLE_LABELS,
  GRANTABLE_ACTIONS,
  MAX_SCOPED_PRODUCTS,
  ROLE_PRESETS,
  customActionsOf,
  type AdminAction,
  type AdminRole,
  type StoredAdminPermissions
} from "../auth/roles";

export type TeamMember = {
  /** Acoes marcadas (so no Personalizado). */
  actions: AdminAction[];
  avatarUrl: string | null;
  createdAt: string;
  email: string;
  fullName: string;
  /** Copiado de auth.users pelo gatilho; null = nunca entrou. */
  lastSignInAt: string | null;
  /** Cursos (so no Professor). */
  productIds: string[];
  role: AdminRole;
  /** Para a gravacao condicional (alterado em outro lugar = 409). */
  updatedAt: string;
  userId: string;
};

/** Ordem do seletor de funcao: da mais comum para a mais rara; Dono por ultimo, com aviso. */
export const TEAM_ROLE_OPTIONS: readonly AdminRole[] = ["admin", "editor", "instructor", "support", "analyst", "custom", "owner"];

export const TEAM_ROLE_DESCRIPTIONS: Readonly<Record<AdminRole, string>> = {
  admin: "Pode tudo, menos mudar a equipe e as chaves de venda.",
  analyst: "Só vê os números da escola, sem dados pessoais dos alunos.",
  custom: "Você escolhe, uma a uma, o que a pessoa pode fazer.",
  editor: "Cria e publica produtos e aulas, edita a área de membros e os avisos e responde a comunidade. Vê nome e e-mail dos alunos.",
  instructor: "Monta módulos e aulas e responde a comunidade só dos cursos que você escolher. Não vê a lista de alunos nem os números da escola.",
  owner: "Pode tudo, inclusive mudar a equipe e as chaves de venda. Dê só para sócios.",
  support: "Atende os alunos: vê os dados, libera e remove acessos, reenvia convites e responde a comunidade."
};

export type TeamPermissionItem = {
  action: AdminAction;
  description: string;
  label: string;
  /** Mexe com dado pessoal, dinheiro ou exclusao: a tela destaca. */
  sensitive?: boolean;
};

export type TeamPermissionGroup = { id: string; items: readonly TeamPermissionItem[]; label: string };

/** Tudo o que o dono pode marcar num Personalizado, por area (cada acao aparece uma vez). */
export const TEAM_PERMISSION_GROUPS: readonly TeamPermissionGroup[] = [
  {
    id: "numeros",
    items: [{ action: "reports.read", description: "Visão geral, desempenho dos produtos e ciclo de vida, sem dado pessoal.", label: "Ver os números da escola" }],
    label: "Números"
  },
  {
    id: "produtos",
    items: [
      { action: "catalog.content", description: "Criar, editar, ordenar e excluir módulos e aulas, com vídeo e transcrição.", label: "Montar módulos e aulas" },
      { action: "catalog.write", description: "Detalhes, capa, regras de acesso, formações, pacotes e importação.", label: "Criar e editar produtos" },
      { action: "catalog.publish", description: "Faz o produto aparecer (ou sumir) para os alunos.", label: "Publicar e arquivar produtos" },
      { action: "catalog.delete", description: "Também remove os acessos ligados ao produto.", label: "Excluir produtos", sensitive: true }
    ],
    label: "Produtos e aulas"
  },
  {
    id: "membros",
    items: [{ action: "storefront.write", description: "Vitrine, destaque, módulos da home, página de login e marca.", label: "Editar a área de membros" }],
    label: "Área de membros"
  },
  {
    id: "alunos",
    items: [
      { action: "students.read_basic", description: "Nome, e-mail, progresso e acessos.", label: "Ver a lista de alunos" },
      { action: "students.read_personal", description: "Telefone e histórico completo de cada aluno.", label: "Ver dados pessoais", sensitive: true },
      { action: "students.access", description: "Adicionar e importar alunos, estender, remover, turmas e reenviar convite.", label: "Liberar e remover acessos" },
      { action: "students.export", description: "Baixar a lista com e-mail e telefone.", label: "Exportar CSV", sensitive: true },
      { action: "students.delete", description: "Apaga a conta, os acessos e os dados pessoais.", label: "Excluir alunos", sensitive: true }
    ],
    label: "Alunos"
  },
  {
    id: "comunicacao",
    items: [
      { action: "messaging.write", description: "Rascunhos e agendamentos de avisos, webinários e promoções.", label: "Criar avisos e pop-ups" },
      { action: "messaging.publish", description: "Para até 500 alunos de uma vez.", label: "Publicar avisos" },
      { action: "messaging.publish_large", description: "Acima de 500 alunos, e aprovar o pedido de outra pessoa.", label: "Publicar para muitos alunos", sensitive: true }
    ],
    label: "Comunicação"
  },
  {
    id: "comunidade",
    items: [
      { action: "community.reply", description: "Responder na comunidade, marcar como resolvida e usar respostas prontas.", label: "Responder alunos" },
      { action: "community.moderate", description: "Ocultar, marcar spam, restaurar e palavras bloqueadas.", label: "Moderar comentários" }
    ],
    label: "Comunidade"
  },
  {
    id: "configuracoes",
    items: [{ action: "settings.ai", description: "Provedores, chaves de API, limites e consumo.", label: "Tutor IA", sensitive: true }],
    label: "Configurações"
  }
];

const permissionLabels = new Map(TEAM_PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => [item.action, item.label] as const)));

export function permissionLabel(action: AdminAction) {
  return permissionLabels.get(action) ?? action;
}

/** Permissoes (que podem ser marcadas) de uma funcao, na ordem da tela. */
export function actionsOfRole(role: AdminRole, customActions: readonly AdminAction[] = []): AdminAction[] {
  const granted = role === "custom" ? customActionsOf(customActions) : new Set<AdminAction>(ROLE_PRESETS[role]);

  return GRANTABLE_ACTIONS.filter((action) => granted.has(action));
}

/** O que vai para admin_roles.permissions: so o que a funcao usa (o resto e descartado). */
export function storedPermissionsFor(role: AdminRole, input: { actions?: readonly AdminAction[]; productIds?: readonly string[] }): StoredAdminPermissions {
  if (role === "custom") {
    return { actions: actionsOfRole("custom", input.actions ?? []) };
  }

  if (role === "instructor") {
    return { productIds: Array.from(new Set(input.productIds ?? [])).slice(0, MAX_SCOPED_PRODUCTS) };
  }

  return {};
}

export const LAST_OWNER_MESSAGE = "A escola precisa de pelo menos um dono. Torne outra pessoa dona antes.";
export const SELF_CHANGE_MESSAGE = "Você não pode mudar a sua própria função nem se remover. Peça a outro dono.";

export type TeamChange = { kind: "remove"; from: AdminRole | null } | { from: AdminRole | null; kind: "update"; to: AdminRole };

/**
 * Regras de mudanca (padrao de mercado): ninguem mexe na propria funcao (evita se trancar fora) e a
 * escola nunca fica sem dono (o banco confere de novo, com trava). Devolve a frase de recusa ou null.
 */
export function teamChangeError(input: { actorId: string; change: TeamChange; ownerCount: number; targetId: string }): string | null {
  if (input.actorId === input.targetId) {
    return SELF_CHANGE_MESSAGE;
  }

  const losesOwner = input.change.from === "owner" && (input.change.kind === "remove" || input.change.to !== "owner");

  if (losesOwner && input.ownerCount <= 1) {
    return LAST_OWNER_MESSAGE;
  }

  return null;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const ROLE_ACCESS_SUMMARY: Readonly<Partial<Record<AdminRole, string>>> = {
  admin: "Tudo, menos equipe e vendas",
  analyst: "Só números",
  editor: "Produtos, área de membros, avisos e comunidade",
  owner: "Tudo",
  support: "Alunos e comunidade"
};

/** Resumo do acesso para a lista ("2 cursos", "5 permissões", "Alunos e comunidade"). */
export function describeMemberAccess(member: Pick<TeamMember, "actions" | "productIds" | "role">) {
  if (member.role === "instructor") {
    return member.productIds.length === 0 ? "Nenhum curso ainda" : plural(member.productIds.length, "curso", "cursos");
  }

  if (member.role === "custom") {
    return plural(actionsOfRole("custom", member.actions).length, "permissão", "permissões");
  }

  return ROLE_ACCESS_SUMMARY[member.role] ?? ADMIN_ROLE_LABELS[member.role];
}

/** Ate 20 ids de curso na auditoria (o resto vira contagem): metadata tem teto de 4 KB. */
const AUDIT_PRODUCT_IDS = 20;

/** O que a auditoria guarda de uma funcao: papel, acoes (Personalizado) e cursos (Professor). */
export function teamAuditSnapshot(role: AdminRole | string, permissions: StoredAdminPermissions) {
  const productIds = permissions.productIds ?? [];

  return {
    role,
    ...(permissions.actions ? { actions: permissions.actions } : {}),
    ...(permissions.productIds ? { productCount: productIds.length, productIds: productIds.slice(0, AUDIT_PRODUCT_IDS) } : {})
  };
}

/** Owners primeiro, depois por nome (como a lista mostra). */
export function sortTeamMembers<T extends Pick<TeamMember, "fullName" | "role">>(members: readonly T[]): T[] {
  return [...members].sort((left, right) => {
    const ownerOrder = Number(right.role === "owner") - Number(left.role === "owner");

    return ownerOrder || left.fullName.localeCompare(right.fullName, "pt-BR");
  });
}
