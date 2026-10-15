// Papeis e permissoes do Admin Bunker707 (docs/17 §2.3). Modulo puro: sem "server-only", sem React,
// sem aliases; tests/admin-permissions.test.mjs carrega este arquivo direto pelo Node.
//
// Modelo (padrao de mercado: papeis prontos, um papel personalizado e professor preso aos cursos dele):
// - cada pessoa da equipe tem um papel (admin_roles.role). Os papeis prontos tem um conjunto fixo de
//   permissoes (ROLE_PRESETS), que acompanha o codigo: acao nova entra no papel sem migrar dados;
// - "custom" (Personalizado) usa so o que o dono marcou (admin_roles.permissions.actions). Acao nova
//   nunca entra sozinha num personalizado (menor privilegio);
// - "instructor" (Professor) vale so nos cursos de admin_roles.permissions.productIds.
//
// Regra unica: toda Server Action e toda rota /api/admin/** chama requireRole(acao) ou
// requireApiRole(acao) (src/server/auth/permissions.ts), que consultam can(); quem tem escopo por
// curso passa tambem por requireScope(). A UI so usa can() para esconder botoes e areas.

export const ADMIN_ROLES = ["owner", "admin", "editor", "instructor", "support", "analyst", "custom"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Acoes do admin. Acrescentar uma acao = uma linha aqui, o lugar dela nos papeis prontos, o texto em
 * src/server/team/model.ts e um caso em tests/admin-permissions.test.mjs.
 */
export const ADMIN_ACTIONS = [
  /** Entrar no admin (toda a equipe). Sozinha nao mostra nenhuma area. */
  "admin.read",
  /** Visao geral, desempenho dos produtos e ciclo de vida: numeros agregados, sem dado pessoal. */
  "reports.read",
  /** Modulos e aulas: criar, editar, ordenar, excluir, video, transcricao e Tutor IA da aula. */
  "catalog.content",
  /** Produto: criar, detalhes, capa, regras de acesso, formacoes, pacotes e importacao. */
  "catalog.write",
  /** Produto: publicar, voltar para rascunho, arquivar. */
  "catalog.publish",
  /** Produto: excluir (revoga os acessos ligados a ele). */
  "catalog.delete",
  /** Area de membros: vitrine, destaque, fileira de modulos na home, login e marca. */
  "storefront.write",
  /** Alunos: lista com nome, e-mail, progresso e acessos. */
  "students.read_basic",
  /** Alunos: telefone e historico completo. */
  "students.read_personal",
  /** Alunos: adicionar, importar, liberar, estender, remover acesso, turmas e reenviar convite. */
  "students.access",
  /** Alunos: excluir conta, acessos e dados pessoais. */
  "students.delete",
  /** Alunos: exportar CSV com dados pessoais. */
  "students.export",
  /** Comunicacao: criar e agendar avisos, webinarios e promocoes. */
  "messaging.write",
  /** Comunicacao: publicar ate 500 alunos (acima disso fica aguardando aprovacao). */
  "messaging.publish",
  /** Comunicacao: publicar acima de 500 alunos sem segunda aprovacao, e aprovar o pedido de outro. */
  "messaging.publish_large",
  /** Comunidade: responder como professor, resolver, respostas prontas. */
  "community.reply",
  /** Comunidade: ocultar, marcar spam, restaurar, palavras bloqueadas. */
  "community.moderate",
  /** Configuracoes > Tutor IA: provedores, conexoes, limites e consumo. */
  "settings.ai",
  /** Configuracoes > Vendas: chaves das plataformas de venda. So o dono (padrao de mercado). */
  "settings.sales",
  /** Configuracoes > Equipe: so o dono. */
  "settings.team"
] as const;

export type AdminAction = (typeof ADMIN_ACTIONS)[number];

const adminRoleSet = new Set<string>(ADMIN_ROLES);
const adminActionSet = new Set<string>(ADMIN_ACTIONS);

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && adminRoleSet.has(value);
}

export function isAdminAction(value: unknown): value is AdminAction {
  return typeof value === "string" && adminActionSet.has(value);
}

/** Papeis com conjunto fixo de permissoes. */
export type PresetAdminRole = Exclude<AdminRole, "custom">;

/** So o dono: mudar a equipe e as chaves de venda (nunca entram em outro papel nem num personalizado). */
export const OWNER_ONLY_ACTIONS: readonly AdminAction[] = ["settings.sales", "settings.team"];

const ownerOnlySet = new Set<AdminAction>(OWNER_ONLY_ACTIONS);

/** Permissoes de cada papel pronto (docs/17 §2.3). */
export const ROLE_PRESETS: Readonly<Record<PresetAdminRole, readonly AdminAction[]>> = {
  owner: ADMIN_ACTIONS,
  admin: ADMIN_ACTIONS.filter((action) => !ownerOnlySet.has(action)),
  editor: [
    "admin.read",
    "reports.read",
    "catalog.content",
    "catalog.write",
    "catalog.publish",
    "storefront.write",
    "students.read_basic",
    "messaging.write",
    "messaging.publish",
    "community.reply",
    "community.moderate"
  ],
  instructor: ["admin.read", "catalog.content", "community.reply", "community.moderate"],
  support: ["admin.read", "students.read_basic", "students.read_personal", "students.access", "community.reply", "community.moderate"],
  analyst: ["admin.read", "reports.read"]
};

/** O que o dono pode marcar num personalizado: tudo menos entrar (implicito) e o que e so do dono. */
export const GRANTABLE_ACTIONS: readonly AdminAction[] = ADMIN_ACTIONS.filter((action) => action !== "admin.read" && !ownerOnlySet.has(action));

const grantableSet = new Set<AdminAction>(GRANTABLE_ACTIONS);

/** Acoes que so fazem sentido junto com outra (marcar a de cima marca a de baixo). */
export const ACTION_REQUIRES: Readonly<Partial<Record<AdminAction, readonly AdminAction[]>>> = {
  "catalog.write": ["catalog.content"],
  "catalog.publish": ["catalog.write"],
  "catalog.delete": ["catalog.write"],
  "students.read_personal": ["students.read_basic"],
  "students.access": ["students.read_basic"],
  "students.delete": ["students.read_basic"],
  // O CSV leva telefone: exportar exige ver dados pessoais.
  "students.export": ["students.read_basic", "students.read_personal"],
  "messaging.publish": ["messaging.write"],
  "messaging.publish_large": ["messaging.publish"]
};

/** Fecha a lista com os pre-requisitos (ex.: exportar CSV traz "ver a lista de alunos"). */
export function withRequiredActions(actions: Iterable<AdminAction>): Set<AdminAction> {
  const result = new Set<AdminAction>();
  const pending = [...actions];

  while (pending.length > 0) {
    const action = pending.pop() as AdminAction;

    if (!result.has(action)) {
      result.add(action);
      pending.push(...(ACTION_REQUIRES[action] ?? []));
    }
  }

  return result;
}

/** Acoes que dependem desta (desmarcar "ver a lista de alunos" desmarca liberar, exportar...). */
export function dependentActionsOf(action: AdminAction): AdminAction[] {
  return ADMIN_ACTIONS.filter((candidate) => candidate !== action && withRequiredActions([candidate]).has(action));
}

/** Acoes que um professor pode ter, sempre presas aos cursos dele. */
export const PRODUCT_SCOPED_ACTIONS: readonly AdminAction[] = ["catalog.content", "community.reply", "community.moderate"];

const productScopedSet = new Set<AdminAction>(PRODUCT_SCOPED_ACTIONS);

export function isProductScopedAction(action: AdminAction) {
  return productScopedSet.has(action);
}

/** Permissoes efetivas de uma pessoa da equipe, calculadas uma vez por requisicao. */
export type AdminAccess = {
  readonly actions: ReadonlySet<AdminAction>;
  /** null = escola toda; lista = so estes produtos (Professor). Lista vazia = nenhum curso ainda. */
  readonly productIds: readonly string[] | null;
  readonly role: AdminRole;
};

/** Formato de admin_roles.permissions (jsonb). Campos desconhecidos sao ignorados. */
export type StoredAdminPermissions = {
  actions?: AdminAction[];
  productIds?: string[];
};

/** Mesmo formato de id do catalogo (catalogIdSchema em src/server/catalog/schemas.ts). */
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,240}$/;

export const MAX_SCOPED_PRODUCTS = 100;

function uniqueStrings(values: unknown, accept: (value: string) => boolean, limit: number) {
  if (!Array.isArray(values)) {
    return [];
  }

  const result: string[] = [];

  for (const value of values) {
    if (typeof value === "string" && accept(value) && !result.includes(value)) {
      result.push(value);
    }

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

/** Le admin_roles.permissions sem confiar no conteudo: so acoes conhecidas e ids validos sobrevivem. */
export function parseStoredPermissions(value: unknown): { actions: AdminAction[]; productIds: string[] } {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  return {
    actions: uniqueStrings(record.actions, isAdminAction, ADMIN_ACTIONS.length) as AdminAction[],
    productIds: uniqueStrings(record.productIds, (id) => PRODUCT_ID_PATTERN.test(id), MAX_SCOPED_PRODUCTS)
  };
}

/** Acoes de um personalizado: so as que podem ser dadas, com pre-requisitos, mais "entrar". */
export function customActionsOf(actions: Iterable<AdminAction>): Set<AdminAction> {
  const granted = withRequiredActions([...actions].filter((action) => grantableSet.has(action)));
  granted.add("admin.read");

  return granted;
}

/**
 * Permissoes efetivas a partir da linha de admin_roles. Papel desconhecido = sem acesso (null).
 * Professor sem lista de cursos fica sem curso nenhum (nunca "todos").
 */
export function resolveAdminAccess(role: unknown, stored: unknown): AdminAccess | null {
  if (!isAdminRole(role)) {
    return null;
  }

  const parsed = parseStoredPermissions(stored);

  if (role === "custom") {
    return { actions: customActionsOf(parsed.actions), productIds: null, role };
  }

  if (role === "instructor") {
    return { actions: new Set(ROLE_PRESETS.instructor), productIds: parsed.productIds, role };
  }

  return { actions: new Set(ROLE_PRESETS[role]), productIds: null, role };
}

/** Copia serializavel de AdminAccess, para levar as permissoes do servidor a componentes de cliente. */
export type AdminAccessSnapshot = {
  actions: AdminAction[];
  productIds: string[] | null;
  role: AdminRole;
};

export function toAccessSnapshot(access: AdminAccess): AdminAccessSnapshot {
  return { actions: [...access.actions], productIds: access.productIds ? [...access.productIds] : null, role: access.role };
}

/** No cliente: so esconde o que a pessoa nao pode usar (o servidor confere tudo de novo). */
export function fromAccessSnapshot(snapshot: AdminAccessSnapshot): AdminAccess {
  return {
    actions: new Set(snapshot.actions.filter(isAdminAction)),
    productIds: snapshot.productIds ? [...snapshot.productIds] : null,
    role: snapshot.role
  };
}

/** A pessoa pode executar a acao? Sem acesso ou acao desconhecida, nunca. */
export function can(access: AdminAccess | null | undefined, action: AdminAction): boolean {
  return Boolean(access && isAdminAction(action) && access.actions.has(action));
}

/** Tem pelo menos uma das acoes (areas que abrem com mais de uma permissao). */
export function canAny(access: AdminAccess | null | undefined, actions: readonly AdminAction[]): boolean {
  return actions.some((action) => can(access, action));
}

/** O produto esta dentro do que a pessoa pode ver? Sem escopo (escola toda), sempre. */
export function isProductInScope(access: AdminAccess | null | undefined, productId: string) {
  if (!access) {
    return false;
  }

  return access.productIds === null || access.productIds.includes(productId);
}

/**
 * Abas Detalhes e "Acesso e venda" do produto: quem edita ou publica produto, ou ve os numeros. Quem
 * tem acesso so a alguns cursos (Professor) fica so com Conteudo.
 */
export function canSeeProductSettings(access: AdminAccess | null | undefined) {
  return Boolean(access && access.productIds === null && canAny(access, ["catalog.write", "catalog.publish", "reports.read"]));
}

/**
 * O alvo de uma acao cabe no escopo da pessoa? `touched` = produtos que a acao toca (null = algum id
 * nao existe). Sem escopo (escola toda), sempre; com escopo, o alvo nao pode ser vazio e todo produto
 * tocado tem que ser da pessoa.
 */
export function scopeAllows(access: AdminAccess, touched: readonly string[] | null): boolean {
  const allowed = access.productIds;

  if (allowed === null) {
    return true;
  }

  return Boolean(touched && touched.length > 0 && touched.every((productId) => allowed.includes(productId)));
}

/** Papel pronto pode executar a acao? (tabela de §2.3; o personalizado depende do que foi marcado). */
export function canRole(role: AdminRole | null | undefined, action: AdminAction): boolean {
  if (!isAdminRole(role) || !isAdminAction(action)) {
    return false;
  }

  if (role === "custom") {
    return action === "admin.read";
  }

  return ROLE_PRESETS[role].includes(action);
}

/** Papeis prontos que podem executar a acao, na ordem de ADMIN_ROLES. */
export function rolesFor(action: AdminAction): PresetAdminRole[] {
  return ADMIN_ROLES.filter((role): role is PresetAdminRole => role !== "custom" && canRole(role, action));
}

/** Tabela acao -> papeis prontos (derivada de ROLE_PRESETS; usada por testes e pela documentacao). */
export const ADMIN_ACTION_ROLES = Object.fromEntries(ADMIN_ACTIONS.map((action) => [action, rolesFor(action)])) as unknown as Readonly<
  Record<AdminAction, readonly PresetAdminRole[]>
>;

export const ADMIN_ROLE_LABELS: Readonly<Record<AdminRole, string>> = {
  admin: "Administrador",
  analyst: "Analista",
  custom: "Personalizado",
  editor: "Editor de conteúdo",
  instructor: "Professor",
  owner: "Dono",
  support: "Suporte"
};

/** Frase de recusa em portugues do produtor, igual em Server Action e rota. */
export function describeForbidden(action: AdminAction) {
  if (action === "settings.team") {
    return "Só o dono da escola pode mudar a equipe.";
  }

  if (action === "settings.sales") {
    return "Só o dono da escola pode mexer nas chaves de venda.";
  }

  if (action.startsWith("settings.") || action === "catalog.delete" || action === "students.export") {
    return "Só o dono ou um administrador pode fazer isso.";
  }

  return "Seu papel na equipe não permite esta ação.";
}

/** Recusa de quem tem acesso so a alguns cursos. */
export const OUT_OF_SCOPE_MESSAGE = "Você só tem acesso aos cursos que o dono escolheu para você.";
