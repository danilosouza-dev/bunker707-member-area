// Papeis, funcoes e permissoes do Admin Bunker707 (docs/17 §2.3). Modulo puro: sem "server-only", sem
// React, sem aliases; tests/admin-permissions.test.mjs carrega este arquivo direto pelo Node.
//
// Modelo (funcoes que se somam, padrao Hotmart/Ticto/Eduzz):
// - permissoes finas por acao (ADMIN_ACTIONS). Algumas podem valer so nos cursos escolhidos da pessoa
//   (SCOPABLE_ACTIONS: conteudo, criar, editar e publicar curso, e comunidade);
// - funcoes prontas (ROLE_PRESETS) sao pacotes fixos que acompanham o codigo. O Dono e exclusivo;
// - funcoes personalizadas (tabela admin_functions) sao pacotes que o dono monta;
// - cada pessoa (admin_roles) tem uma ou mais funcoes, permissoes extras so dela e a lista de cursos.
//   As permissoes se somam: se uma fonte da a acao para a escola toda e outra so nos cursos, vale a
//   escola toda. Pre-requisitos entram juntos (exportar CSV traz ver dados pessoais).
//
// Regra unica: toda Server Action e toda rota /api/admin/** chama requireRole(acao) ou
// requireApiRole(acao) (src/server/auth/permissions.ts), que consultam can(); acao que vale so nos
// cursos da pessoa passa tambem por requireScope(). A UI so usa can() para esconder botoes e areas.

export const ADMIN_ROLES = ["owner", "admin", "editor", "instructor", "support", "analyst", "custom"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Papeis com conjunto fixo de permissoes. */
export type PresetAdminRole = Exclude<AdminRole, "custom">;

/** Funcoes prontas que se combinam numa pessoa ou numa funcao personalizada (o Dono ja pode tudo). */
export const COMBINABLE_PRESETS = ["admin", "editor", "instructor", "support", "analyst"] as const satisfies readonly PresetAdminRole[];

export type CombinablePreset = (typeof COMBINABLE_PRESETS)[number];

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
  /** Criar curso (e importar playlist). Por curso: o curso criado entra na lista da pessoa. */
  "catalog.create",
  /** Detalhes do produto: nome, descricao, capa, destaque e como abre. */
  "catalog.write",
  /** Regras de acesso e venda: gratuito ou pago, quem pode ver, vitrine, formacoes e pacotes. */
  "catalog.access",
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
  /** Comunidade: responder como equipe, resolver, respostas prontas. */
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

/** Alcance de uma permissao: a escola toda ou so os cursos escolhidos da pessoa. */
export type ActionScope = "school" | "courses";

const adminRoleSet = new Set<string>(ADMIN_ROLES);
const adminActionSet = new Set<string>(ADMIN_ACTIONS);
const combinablePresetSet = new Set<string>(COMBINABLE_PRESETS);

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && adminRoleSet.has(value);
}

export function isAdminAction(value: unknown): value is AdminAction {
  return typeof value === "string" && adminActionSet.has(value);
}

export function isCombinablePreset(value: unknown): value is CombinablePreset {
  return typeof value === "string" && combinablePresetSet.has(value);
}

/** So o dono: mudar a equipe e as chaves de venda (nunca entram em outra funcao nem como extra). */
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
    "catalog.create",
    "catalog.write",
    "catalog.access",
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

/** Acoes de papel pronto que valem so nos cursos da pessoa (o Professor). */
export const PRESET_SCOPED_ACTIONS: Readonly<Partial<Record<PresetAdminRole, readonly AdminAction[]>>> = {
  instructor: ["catalog.content", "community.reply", "community.moderate"]
};

/** O que pode ser marcado numa funcao personalizada ou como extra: tudo menos entrar (implicito) e o que e so do dono. */
export const GRANTABLE_ACTIONS: readonly AdminAction[] = ADMIN_ACTIONS.filter((action) => action !== "admin.read" && !ownerOnlySet.has(action));

const grantableSet = new Set<AdminAction>(GRANTABLE_ACTIONS);

export function isGrantableAction(value: unknown): value is AdminAction {
  return isAdminAction(value) && grantableSet.has(value);
}

/** Acoes que podem valer so nos cursos escolhidos da pessoa. */
export const SCOPABLE_ACTIONS: readonly AdminAction[] = [
  "catalog.content",
  "catalog.create",
  "catalog.write",
  "catalog.publish",
  "community.reply",
  "community.moderate"
];

const scopableSet = new Set<AdminAction>(SCOPABLE_ACTIONS);

export function isScopableAction(action: AdminAction) {
  return scopableSet.has(action);
}

/** Acoes que so fazem sentido junto com outra (marcar a de cima marca a de baixo). */
export const ACTION_REQUIRES: Readonly<Partial<Record<AdminAction, readonly AdminAction[]>>> = {
  "catalog.create": ["catalog.write"],
  "catalog.write": ["catalog.content"],
  "catalog.access": ["catalog.write"],
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

/* ------------------------------------------------------------------------------------------------
 * Permissoes com alcance (escola toda ou so os cursos da pessoa)
 * ---------------------------------------------------------------------------------------------- */

/** Permissoes de uma funcao, de uma pessoa ou de uma combinacao: acao -> alcance. */
export type GrantMap = Map<AdminAction, ActionScope>;

/** Soma uma permissao: a escola toda vence "so nos cursos"; acao que nao pode ser por curso vale para a escola toda. */
export function addGrant(grants: GrantMap, action: AdminAction, scope: ActionScope) {
  if (grants.get(action) === "school") {
    return;
  }

  grants.set(action, scope === "courses" && isScopableAction(action) ? "courses" : "school");
}

/** Soma todas as permissoes de `source` em `target` (a escola toda vence). */
export function mergeGrants(target: GrantMap, source: ReadonlyMap<AdminAction, ActionScope>) {
  for (const [action, scope] of source) {
    addGrant(target, action, scope);
  }

  return target;
}

/** Pre-requisitos entram com o mesmo alcance da acao que pede (por curso so quando ele pode ser por curso). */
export function closeGrants(grants: GrantMap): GrantMap {
  let changed = true;

  while (changed) {
    changed = false;

    for (const [action, scope] of [...grants]) {
      for (const required of ACTION_REQUIRES[action] ?? []) {
        const before = grants.get(required);
        addGrant(grants, required, scope);
        changed ||= grants.get(required) !== before;
      }
    }
  }

  return grants;
}

/** Permissoes marcadas (funcao personalizada ou extras): so as que podem ser dadas, com pre-requisitos. */
export function grantsFromSelection(actions: Iterable<unknown>, scopedActions: Iterable<unknown> = []): GrantMap {
  const scoped = new Set([...scopedActions].filter(isAdminAction));
  const grants: GrantMap = new Map();

  for (const action of actions) {
    if (isGrantableAction(action)) {
      addGrant(grants, action, scoped.has(action) ? "courses" : "school");
    }
  }

  return closeGrants(grants);
}

/** Permissoes de uma funcao pronta (o Professor vale so nos cursos da pessoa). */
export function presetGrants(preset: PresetAdminRole): GrantMap {
  const scoped = new Set(PRESET_SCOPED_ACTIONS[preset] ?? []);
  const grants: GrantMap = new Map();

  for (const action of ROLE_PRESETS[preset]) {
    addGrant(grants, action, scoped.has(action) ? "courses" : "school");
  }

  return grants;
}

/** Acoes e quais delas valem so nos cursos, para gravar (ordem da lista de acoes). */
export function splitGrants(grants: ReadonlyMap<AdminAction, ActionScope>) {
  const actions = ADMIN_ACTIONS.filter((action) => grants.has(action));

  return { actions, scopedActions: actions.filter((action) => grants.get(action) === "courses") };
}

/* ------------------------------------------------------------------------------------------------
 * Permissoes efetivas de uma pessoa
 * ---------------------------------------------------------------------------------------------- */

/** Funcao personalizada lida do banco (admin_functions). */
export type CustomFunctionDefinition = {
  actions: readonly string[];
  id: string;
  scopedActions: readonly string[];
};

/** Formato de admin_roles.permissions (jsonb). Campos desconhecidos sao ignorados. */
export type StoredAdminPermissions = {
  /** Permissoes extras so desta pessoa (no Personalizado antigo, a lista inteira). */
  actions?: AdminAction[];
  /** Funcoes da pessoa: chaves das funcoes prontas combinaveis e ids de funcoes personalizadas. */
  functions?: string[];
  /** Cursos escolhidos para a pessoa (valem para as permissoes por curso). */
  productIds?: string[];
  /** Quais extras valem so nos cursos da pessoa. */
  scopedActions?: AdminAction[];
};

/** Mesmo formato de id do catalogo (catalogIdSchema em src/server/catalog/schemas.ts). */
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,240}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_SCOPED_PRODUCTS = 100;
export const MAX_MEMBER_FUNCTIONS = 20;

export function isCustomFunctionId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

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
export function parseStoredPermissions(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  return {
    actions: uniqueStrings(record.actions, isAdminAction, ADMIN_ACTIONS.length) as AdminAction[],
    functions: uniqueStrings(record.functions, (ref) => isCombinablePreset(ref) || isCustomFunctionId(ref), MAX_MEMBER_FUNCTIONS),
    productIds: uniqueStrings(record.productIds, (id) => PRODUCT_ID_PATTERN.test(id), MAX_SCOPED_PRODUCTS),
    scopedActions: uniqueStrings(record.scopedActions, isAdminAction, ADMIN_ACTIONS.length) as AdminAction[]
  };
}

/** Ids das funcoes personalizadas citadas na pessoa (para ler so essas de admin_functions). */
export function customFunctionIdsOf(stored: unknown): string[] {
  return parseStoredPermissions(stored).functions.filter(isCustomFunctionId);
}

/** Permissoes efetivas de uma pessoa da equipe, calculadas uma vez por requisicao. */
export type AdminAccess = {
  readonly actions: ReadonlySet<AdminAction>;
  /** Cursos escolhidos para a pessoa: valem para as acoes de `scopedActions`. */
  readonly courseIds: readonly string[];
  /** Funcoes da pessoa (chaves prontas e ids de funcoes personalizadas). Vazio para o Dono. */
  readonly functions: readonly string[];
  /** Papel gravado: "owner", um papel pronto unico ou "custom" quando combina funcoes ou tem extras. */
  readonly role: AdminRole;
  /** Acoes que valem so nos cursos da pessoa. */
  readonly scopedActions: ReadonlySet<AdminAction>;
};

/** Funcoes da pessoa: numa linha combinada ("custom"), as gravadas; num papel pronto, o proprio papel. */
export function memberFunctionsOf(role: AdminRole, stored: ReturnType<typeof parseStoredPermissions>): string[] {
  if (role === "custom") {
    return stored.functions;
  }

  return isCombinablePreset(role) ? [role] : [];
}

/** Extras da pessoa: so numa linha combinada ("custom"). Papel pronto vale exatamente o papel. */
export function memberExtrasOf(role: AdminRole, stored: ReturnType<typeof parseStoredPermissions>) {
  return role === "custom" ? { actions: stored.actions, scopedActions: stored.scopedActions } : { actions: [], scopedActions: [] };
}

/** Permissoes somadas de funcoes e extras (sem o Dono). Funcao personalizada desconhecida nao da nada. */
export function memberGrants(
  functions: readonly string[],
  extras: { actions: readonly unknown[]; scopedActions: readonly unknown[] },
  customFunctions: ReadonlyMap<string, CustomFunctionDefinition> = new Map()
): GrantMap {
  const grants: GrantMap = new Map();

  for (const ref of functions) {
    if (isCombinablePreset(ref)) {
      mergeGrants(grants, presetGrants(ref));
    } else {
      const definition = customFunctions.get(ref);

      if (definition) {
        mergeGrants(grants, grantsFromSelection(definition.actions, definition.scopedActions));
      }
    }
  }

  mergeGrants(grants, grantsFromSelection(extras.actions, extras.scopedActions));

  return closeGrants(grants);
}

/**
 * Permissoes efetivas a partir da linha de admin_roles e das funcoes personalizadas que ela cita.
 * Papel desconhecido = sem acesso (null). Dono = tudo. Permissao por curso sem curso nao alcanca nada.
 */
export function resolveAdminAccess(
  role: unknown,
  stored: unknown,
  customFunctions: ReadonlyMap<string, CustomFunctionDefinition> = new Map()
): AdminAccess | null {
  if (!isAdminRole(role)) {
    return null;
  }

  if (role === "owner") {
    return { actions: new Set(ADMIN_ACTIONS), courseIds: [], functions: [], role, scopedActions: new Set() };
  }

  const parsed = parseStoredPermissions(stored);
  const functions = memberFunctionsOf(role, parsed);
  const grants = memberGrants(functions, memberExtrasOf(role, parsed), customFunctions);

  grants.set("admin.read", "school");

  return {
    actions: new Set(grants.keys()),
    courseIds: parsed.productIds,
    functions,
    role,
    scopedActions: new Set([...grants].filter(([, scope]) => scope === "courses").map(([action]) => action))
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

/** A acao vale so nos cursos da pessoa? */
export function isActionScoped(access: AdminAccess | null | undefined, action: AdminAction) {
  return Boolean(access?.scopedActions.has(action));
}

/** A pessoa tem alguma permissao por curso? (Os cursos dela abrem na area do aluno.) */
export function hasCourseScope(access: AdminAccess | null | undefined) {
  return Boolean(access && access.scopedActions.size > 0);
}

const CATALOG_AREA_ACTIONS: readonly AdminAction[] = [
  "catalog.content",
  "catalog.create",
  "catalog.write",
  "catalog.access",
  "catalog.publish",
  "catalog.delete",
  "reports.read"
];
const COMMUNITY_AREA_ACTIONS: readonly AdminAction[] = ["community.reply", "community.moderate"];

/** Alguma permissao (alem de entrar no admin) vale para a escola toda? */
function hasSchoolWidePermission(access: AdminAccess) {
  return [...access.actions].some((action) => action !== "admin.read" && !access.scopedActions.has(action));
}

/**
 * Cursos que limitam uma area: null = escola toda. Alguma permissao da area na escola toda: null; todas
 * so nos cursos: os cursos da pessoa. Sem permissao na area, vale o resto: so a equipe da escola toda
 * (Suporte, Analista) enxerga tudo; quem tem algo so nos cursos, ou nada (funcao que nao abriu), fica
 * nos cursos dela. Isto decide tambem o que a pessoa abre sem compra na area do aluno.
 */
function areaScope(access: AdminAccess, area: readonly AdminAction[]): readonly string[] | null {
  const held = area.filter((action) => access.actions.has(action));

  if (held.length === 0) {
    return hasCourseScope(access) || !hasSchoolWidePermission(access) ? access.courseIds : null;
  }

  return held.some((action) => !access.scopedActions.has(action)) ? null : access.courseIds;
}

/** Produtos que a pessoa enxerga no admin (lista, pagina do produto, busca): null = todos. */
export function catalogScope(access: AdminAccess): readonly string[] | null {
  return areaScope(access, CATALOG_AREA_ACTIONS);
}

/** Cursos da Comunidade da pessoa: null = todos. */
export function communityScope(access: AdminAccess): readonly string[] | null {
  return areaScope(access, COMMUNITY_AREA_ACTIONS);
}

/** O produto esta dentro do que a pessoa enxerga? (catalogo da escola toda: sempre). */
export function isProductInScope(access: AdminAccess | null | undefined, productId: string) {
  if (!access) {
    return false;
  }

  const scope = catalogScope(access);

  return scope === null || scope.includes(productId);
}

/**
 * O alvo de uma acao cabe no que a pessoa pode? `touched` = produtos que a acao toca (null = algum id
 * nao existe). Acao da escola toda: sempre. Acao por curso: alvo nao vazio e todo produto tocado nos
 * cursos da pessoa.
 */
export function scopeAllows(access: AdminAccess, action: AdminAction, touched: readonly string[] | null): boolean {
  if (!access.scopedActions.has(action)) {
    return true;
  }

  return Boolean(touched && touched.length > 0 && touched.every((productId) => access.courseIds.includes(productId)));
}

/** Aba Detalhes do produto: quem edita, publica ou cuida de acesso e venda, ou ve os numeros. */
export function canSeeProductDetails(access: AdminAccess | null | undefined) {
  return canAny(access, ["catalog.write", "catalog.access", "catalog.publish", "reports.read"]);
}

/** Aba "Acesso e venda" do produto: quem cuida de acesso e venda ou ve os numeros (nunca por curso). */
export function canSeeProductAccess(access: AdminAccess | null | undefined) {
  return canAny(access, ["catalog.access", "reports.read"]);
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

/** Copia serializavel de AdminAccess, para levar as permissoes do servidor a componentes de cliente. */
export type AdminAccessSnapshot = {
  actions: AdminAction[];
  courseIds: string[];
  functions: string[];
  role: AdminRole;
  scopedActions: AdminAction[];
};

export function toAccessSnapshot(access: AdminAccess): AdminAccessSnapshot {
  return {
    actions: [...access.actions],
    courseIds: [...access.courseIds],
    functions: [...access.functions],
    role: access.role,
    scopedActions: [...access.scopedActions]
  };
}

/** No cliente: so esconde o que a pessoa nao pode usar (o servidor confere tudo de novo). */
export function fromAccessSnapshot(snapshot: AdminAccessSnapshot): AdminAccess {
  const actions = new Set(snapshot.actions.filter(isAdminAction));

  return {
    actions,
    courseIds: [...snapshot.courseIds],
    functions: [...snapshot.functions],
    role: snapshot.role,
    scopedActions: new Set(snapshot.scopedActions.filter((action) => isAdminAction(action) && actions.has(action)))
  };
}

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

  return "Sua função na equipe não permite esta ação.";
}

/** Recusa de quem tem a acao so em alguns cursos. */
export const OUT_OF_SCOPE_MESSAGE = "Você só tem acesso aos cursos que o dono escolheu para você.";
