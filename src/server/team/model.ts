// Equipe (docs/17 §2.3): funcoes prontas e personalizadas, permissoes extras por pessoa, regras de
// mudanca e o que vai para a lista e para a auditoria. Modulo puro (sem servidor nem React, imports
// relativos): a tela, as Server Actions e tests/admin-team.test.mjs usam as mesmas funcoes.

import {
  ADMIN_ACTIONS,
  ADMIN_ROLE_LABELS,
  COMBINABLE_PRESETS,
  GRANTABLE_ACTIONS,
  MAX_SCOPED_PRODUCTS,
  closeGrants,
  grantsFromSelection,
  isCombinablePreset,
  memberExtrasOf,
  memberFunctionsOf,
  memberGrants,
  parseStoredPermissions,
  presetGrants,
  splitGrants,
  type ActionScope,
  type AdminAction,
  type AdminRole,
  type CombinablePreset,
  type CustomFunctionDefinition,
  type GrantMap,
  type StoredAdminPermissions
} from "../auth/roles";

/** Funcao personalizada (admin_functions). */
export type TeamCustomFunction = {
  actions: AdminAction[];
  description: string;
  id: string;
  /** Pessoas com esta funcao (preenchido pela lista de funcoes). */
  memberCount?: number;
  name: string;
  scopedActions: AdminAction[];
  updatedAt: string;
};

export type TeamMember = {
  avatarUrl: string | null;
  createdAt: string;
  email: string;
  /** Permissoes extras so desta pessoa. */
  extraActions: AdminAction[];
  /** Quais extras valem so nos cursos da pessoa. */
  extraScopedActions: AdminAction[];
  fullName: string;
  /** Funcoes da pessoa: chaves das funcoes prontas e ids de funcoes personalizadas. */
  functions: string[];
  /** Copiado de auth.users pelo gatilho; null = nunca entrou. */
  lastSignInAt: string | null;
  /** Dono da escola (exclusivo: pode tudo). */
  owner: boolean;
  /** Cursos escolhidos (valem para as permissoes por curso). */
  productIds: string[];
  /** Papel gravado em admin_roles. */
  role: AdminRole;
  /** Para a gravacao condicional (alterado em outro lugar = 409). */
  updatedAt: string;
  userId: string;
};

/** O que a tela manda para gravar uma pessoa (o servidor normaliza e confere). */
export type TeamMemberAccessInput = {
  extraActions: readonly AdminAction[];
  extraScopedActions: readonly AdminAction[];
  functions: readonly string[];
  owner: boolean;
  productIds: readonly string[];
};

/** Funcoes prontas na ordem do seletor (o Dono fica a parte: e exclusivo). */
export const TEAM_PRESET_OPTIONS: readonly CombinablePreset[] = COMBINABLE_PRESETS;

export const TEAM_ROLE_DESCRIPTIONS: Readonly<Record<AdminRole, string>> = {
  admin: "Pode tudo, menos mudar a equipe e as chaves de venda.",
  analyst: "Só vê os números da escola, sem dados pessoais dos alunos.",
  custom: "Combina funções ou tem permissões escolhidas uma a uma.",
  editor: "Cria e publica produtos e aulas, cuida de acesso e venda, da área de membros, dos avisos e da comunidade. Vê nome e e-mail dos alunos.",
  instructor: "Monta módulos e aulas e responde a comunidade só dos cursos escolhidos para ele. Não vê a lista de alunos nem os números da escola.",
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

/** Tudo o que pode ser marcado numa funcao ou como extra, por area (cada acao aparece uma vez). */
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
      {
        action: "catalog.create",
        description: "Inclui importar playlist do YouTube. Quem cria só nos próprios cursos ganha o curso novo na lista.",
        label: "Criar cursos"
      },
      { action: "catalog.write", description: "Nome, descrição, capa, destaque e como o curso abre.", label: "Editar os detalhes do curso" },
      {
        action: "catalog.access",
        description: "Gratuito ou pago, quem pode ver, link de venda, formações e pacotes.",
        label: "Regras de acesso e venda",
        sensitive: true
      },
      { action: "catalog.publish", description: "Faz o curso aparecer (ou sumir) para os alunos.", label: "Publicar e arquivar" },
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

/** Nome de uma funcao (pronta ou personalizada) para a tela; funcao apagada aparece como tal. */
export function functionLabel(ref: string, customFunctions: ReadonlyMap<string, Pick<TeamCustomFunction, "name">>) {
  if (isCombinablePreset(ref)) {
    return ADMIN_ROLE_LABELS[ref];
  }

  return customFunctions.get(ref)?.name ?? "Função removida";
}

/** Definicoes que roles.ts entende, a partir das funcoes personalizadas da tela. */
export function functionDefinitions(customFunctions: Iterable<Pick<TeamCustomFunction, "actions" | "id" | "scopedActions">>) {
  return new Map<string, CustomFunctionDefinition>(
    [...customFunctions].map((item) => [item.id, { actions: item.actions, id: item.id, scopedActions: item.scopedActions }])
  );
}

/** Permissoes de uma funcao pronta que podem ser marcadas (para "juntar" numa funcao personalizada). */
export function presetSelection(preset: CombinablePreset): GrantMap {
  const grants: GrantMap = new Map();

  for (const [action, scope] of presetGrants(preset)) {
    if (GRANTABLE_ACTIONS.includes(action)) {
      grants.set(action, scope);
    }
  }

  return grants;
}

/** Permissoes efetivas da pessoa (o Dono tem tudo). */
export function memberGrantsOf(member: Pick<TeamMemberAccessInput, "extraActions" | "extraScopedActions" | "functions" | "owner">, customFunctions: ReadonlyMap<string, CustomFunctionDefinition>): GrantMap {
  if (member.owner) {
    return presetGrants("owner");
  }

  return memberGrants(member.functions, { actions: member.extraActions, scopedActions: member.extraScopedActions }, customFunctions);
}

/** Alguma permissao da pessoa vale so nos cursos? (entao ela precisa de cursos escolhidos) */
export function needsCourses(grants: ReadonlyMap<AdminAction, ActionScope>) {
  return [...grants.values()].includes("courses");
}

const NO_EXTRAS = { actions: [], scopedActions: [] } as const;

/** Permissoes que so as funcoes da pessoa dao (sem extras). */
export function functionGrantsOf(functions: readonly string[], customFunctions: ReadonlyMap<string, CustomFunctionDefinition>): GrantMap {
  return memberGrants(functions, NO_EXTRAS, customFunctions);
}

/**
 * Tira dos extras o que as funcoes ja dao com o mesmo alcance (ou maior). Fica o extra "escola toda"
 * de uma permissao que a funcao da so nos cursos: e assim que se libera a escola toda para uma pessoa so.
 */
export function withoutRedundantExtras(extras: ReadonlyMap<AdminAction, ActionScope>, functionGrants: ReadonlyMap<AdminAction, ActionScope>): GrantMap {
  const result: GrantMap = new Map();

  for (const [action, scope] of extras) {
    const fromFunctions = functionGrants.get(action);

    if (!fromFunctions || (fromFunctions === "courses" && scope === "school")) {
      result.set(action, scope);
    }
  }

  return result;
}

/** De onde vem cada permissao que as funcoes da pessoa dao (para travar na lista de extras). */
export function functionGrantSources(
  functions: readonly string[],
  customFunctions: ReadonlyMap<string, CustomFunctionDefinition & { name?: string }>,
  names: ReadonlyMap<string, Pick<TeamCustomFunction, "name">>
): Map<AdminAction, { scope: ActionScope; sources: string[] }> {
  const result = new Map<AdminAction, { scope: ActionScope; sources: string[] }>();

  for (const ref of functions) {
    const grants = functionGrantsOf([ref], customFunctions);
    const label = functionLabel(ref, names);

    for (const [action, scope] of grants) {
      if (!GRANTABLE_ACTIONS.includes(action)) {
        continue;
      }

      const current = result.get(action);

      result.set(action, {
        scope: current?.scope === "school" || scope === "school" ? "school" : "courses",
        sources: current ? [...current.sources, label] : [label]
      });
    }
  }

  return result;
}

/**
 * Extras normalizados: so o que pode ser dado, com pre-requisitos, sem repetir o que as funcoes ja dao
 * igual (o que se grava e o que a tela mostra; ler a pessoa fecha os pre-requisitos de novo).
 */
export function normalizedExtras(
  input: Pick<TeamMemberAccessInput, "extraActions" | "extraScopedActions">,
  functionGrants: ReadonlyMap<AdminAction, ActionScope> = new Map()
) {
  return splitGrants(withoutRedundantExtras(grantsFromSelection(input.extraActions, input.extraScopedActions), functionGrants));
}

/**
 * O que vai para admin_roles: Dono = "owner"; uma funcao pronta sem extras = o proprio papel (linha
 * simples, como antes); o resto = "custom" com funcoes, extras e cursos.
 */
export function storedMemberFor(
  input: TeamMemberAccessInput,
  customFunctions: ReadonlyMap<string, CustomFunctionDefinition>
): { permissions: StoredAdminPermissions; role: AdminRole } {
  if (input.owner) {
    return { permissions: {}, role: "owner" };
  }

  const functions = Array.from(new Set(input.functions));
  const extras = normalizedExtras(input, functionGrantsOf(functions, customFunctions));
  const grants = memberGrantsOf({ ...input, functions }, customFunctions);
  const productIds = needsCourses(grants) ? Array.from(new Set(input.productIds)).slice(0, MAX_SCOPED_PRODUCTS) : [];

  if (functions.length === 1 && isCombinablePreset(functions[0]) && extras.actions.length === 0) {
    return { permissions: productIds.length > 0 ? { productIds } : {}, role: functions[0] };
  }

  return {
    permissions: {
      actions: extras.actions,
      functions,
      ...(productIds.length > 0 ? { productIds } : {}),
      scopedActions: extras.scopedActions
    },
    role: "custom"
  };
}

/** Pessoa a partir da linha de admin_roles (linhas antigas de papel pronto e de Personalizado inclusive). */
export function memberAccessOf(role: AdminRole, stored: unknown): Pick<TeamMember, "extraActions" | "extraScopedActions" | "functions" | "owner" | "productIds"> {
  const parsed = parseStoredPermissions(stored);

  if (role === "owner") {
    return { extraActions: [], extraScopedActions: [], functions: [], owner: true, productIds: [] };
  }

  const extras = memberExtrasOf(role, parsed);

  return {
    extraActions: extras.actions.filter((action) => GRANTABLE_ACTIONS.includes(action)),
    extraScopedActions: extras.scopedActions,
    functions: memberFunctionsOf(role, parsed),
    owner: false,
    productIds: parsed.productIds
  };
}

export const LAST_OWNER_MESSAGE = "A escola precisa de pelo menos um dono. Torne outra pessoa dona antes.";
export const SELF_CHANGE_MESSAGE = "Você não pode mudar a sua própria função nem se remover. Peça a outro dono.";

export type TeamChange = { fromOwner: boolean; kind: "remove" } | { fromOwner: boolean; kind: "update"; toOwner: boolean };

/**
 * Regras de mudanca (padrao de mercado): ninguem mexe na propria funcao (evita se trancar fora) e a
 * escola nunca fica sem dono (o banco confere de novo, com trava). Devolve a frase de recusa ou null.
 */
export function teamChangeError(input: { actorId: string; change: TeamChange; ownerCount: number; targetId: string }): string | null {
  if (input.actorId === input.targetId) {
    return SELF_CHANGE_MESSAGE;
  }

  const losesOwner = input.change.fromOwner && (input.change.kind === "remove" || !input.change.toOwner);

  if (losesOwner && input.ownerCount <= 1) {
    return LAST_OWNER_MESSAGE;
  }

  return null;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Funcoes da pessoa para a lista ("Professor + Suporte", "Dono", "Só extras"). */
export function describeMemberFunctions(
  member: Pick<TeamMember, "extraActions" | "functions" | "owner">,
  names: ReadonlyMap<string, Pick<TeamCustomFunction, "name">>
) {
  if (member.owner) {
    return ADMIN_ROLE_LABELS.owner;
  }

  const labels = member.functions.map((ref) => functionLabel(ref, names));
  const extras = member.extraActions.length;

  if (labels.length === 0) {
    return extras > 0 ? `Só permissões extras (${extras})` : "Sem função";
  }

  return extras > 0 ? `${labels.join(" + ")} + ${plural(extras, "extra", "extras")}` : labels.join(" + ");
}

/** Resumo do acesso para a lista ("Tudo", "5 permissões", "2 cursos · 5 permissões", "Nenhum curso ainda · 3 permissões"). */
export function describeMemberAccess(member: Pick<TeamMember, "owner" | "productIds">, grants: ReadonlyMap<AdminAction, ActionScope>) {
  if (member.owner) {
    return "Tudo";
  }

  const count = [...grants.keys()].filter((action) => GRANTABLE_ACTIONS.includes(action)).length;
  const permissions = plural(count, "permissão", "permissões");

  if (!needsCourses(grants)) {
    return permissions;
  }

  return member.productIds.length === 0 ? `Nenhum curso ainda · ${permissions}` : `${plural(member.productIds.length, "curso", "cursos")} · ${permissions}`;
}

/** Ate 20 ids de curso na auditoria (o resto vira contagem): metadata tem teto de 4 KB. */
const AUDIT_PRODUCT_IDS = 20;

/** O que a auditoria guarda de uma pessoa: papel, funcoes, extras e cursos. */
export function teamAuditSnapshot(role: AdminRole | string, permissions: StoredAdminPermissions) {
  const productIds = permissions.productIds ?? [];

  return {
    role,
    ...(permissions.functions ? { functions: permissions.functions } : {}),
    ...(permissions.actions ? { actions: permissions.actions } : {}),
    ...(permissions.scopedActions?.length ? { scopedActions: permissions.scopedActions } : {}),
    ...(permissions.productIds ? { productCount: productIds.length, productIds: productIds.slice(0, AUDIT_PRODUCT_IDS) } : {})
  };
}

/** O que a auditoria guarda de uma funcao personalizada. */
export function teamFunctionAuditSnapshot(fn: Pick<TeamCustomFunction, "actions" | "name" | "scopedActions">) {
  return { actions: fn.actions, name: fn.name, scopedActions: fn.scopedActions };
}

/** Permissoes de uma funcao personalizada, normalizadas para gravar (pre-requisitos e alcance). */
export function storedFunctionGrants(actions: readonly AdminAction[], scopedActions: readonly AdminAction[]) {
  return splitGrants(closeGrants(grantsFromSelection(actions, scopedActions)));
}

/** Donos primeiro, depois por nome (como a lista mostra). */
export function sortTeamMembers<T extends Pick<TeamMember, "fullName" | "owner">>(members: readonly T[]): T[] {
  return [...members].sort((left, right) => Number(right.owner) - Number(left.owner) || left.fullName.localeCompare(right.fullName, "pt-BR"));
}

/** Ordem de exibicao das permissoes (mesma da lista de acoes). */
export function orderedActions(actions: Iterable<AdminAction>) {
  const set = new Set(actions);

  return ADMIN_ACTIONS.filter((action) => set.has(action));
}
