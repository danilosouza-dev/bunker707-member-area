import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import "./support/resolve-extensionless-ts.mjs";

const roles = await import("../src/server/auth/roles.ts");
const { GENERIC_ACTION_ERROR, actionError, actionOk, toActionError } = await import("../src/lib/action-result.ts");

const {
  ADMIN_ACTIONS,
  ADMIN_ROLES,
  GRANTABLE_ACTIONS,
  OWNER_ONLY_ACTIONS,
  SCOPABLE_ACTIONS,
  can,
  canRole,
  canSeeProductAccess,
  canSeeProductDetails,
  catalogScope,
  communityScope,
  dependentActionsOf,
  describeForbidden,
  fromAccessSnapshot,
  grantsFromSelection,
  isAdminAction,
  isProductInScope,
  memberGrants,
  parseStoredPermissions,
  resolveAdminAccess,
  rolesFor,
  scopeAllows,
  toAccessSnapshot,
  withRequiredActions
} = roles;

const presetRoles = ADMIN_ROLES.filter((role) => role !== "custom");
const sorted = (values) => [...values].sort();
const FN_A = "11111111-1111-4111-8111-111111111111";
const FN_B = "22222222-2222-4222-8222-222222222222";

test("tabela de papeis prontos segue docs/17 §2.3", () => {
  const expected = {
    "admin.read": ["owner", "admin", "editor", "instructor", "support", "analyst"],
    "catalog.access": ["owner", "admin", "editor"],
    "catalog.content": ["owner", "admin", "editor", "instructor"],
    "catalog.create": ["owner", "admin", "editor"],
    "catalog.delete": ["owner", "admin"],
    "catalog.publish": ["owner", "admin", "editor"],
    "catalog.write": ["owner", "admin", "editor"],
    "community.moderate": ["owner", "admin", "editor", "instructor", "support"],
    "community.reply": ["owner", "admin", "editor", "instructor", "support"],
    "messaging.publish": ["owner", "admin", "editor"],
    "messaging.publish_large": ["owner", "admin"],
    "messaging.write": ["owner", "admin", "editor"],
    "reports.read": ["owner", "admin", "editor", "analyst"],
    "settings.ai": ["owner", "admin"],
    "settings.sales": ["owner"],
    "settings.team": ["owner"],
    "storefront.write": ["owner", "admin", "editor"],
    "students.access": ["owner", "admin", "support"],
    "students.delete": ["owner", "admin"],
    "students.export": ["owner", "admin"],
    "students.read_basic": ["owner", "admin", "editor", "support"],
    "students.read_personal": ["owner", "admin", "support"]
  };

  assert.deepEqual(sorted(ADMIN_ACTIONS), sorted(Object.keys(expected)));

  for (const [action, roleList] of Object.entries(expected)) {
    assert.deepEqual(rolesFor(action), roleList, action);

    for (const role of presetRoles) {
      assert.equal(canRole(role, action), roleList.includes(role), `${role} -> ${action}`);
    }

    // Personalizado nao tem tabela: depende do que o dono marcou.
    assert.equal(canRole("custom", action), action === "admin.read", `custom -> ${action}`);
  }
});

test("analista so le numeros; dono pode tudo; equipe e vendas so do dono", () => {
  for (const action of ADMIN_ACTIONS) {
    assert.equal(canRole("owner", action), true, `owner pode ${action}`);
    assert.equal(canRole("analyst", action), action === "admin.read" || action === "reports.read", `analyst -> ${action}`);
  }

  assert.deepEqual(sorted(OWNER_ONLY_ACTIONS), ["settings.sales", "settings.team"]);
  assert.deepEqual(sorted(GRANTABLE_ACTIONS), sorted(ADMIN_ACTIONS.filter((action) => !["admin.read", "settings.sales", "settings.team"].includes(action))));
  assert.equal(canRole("admin", "settings.team"), false);
  assert.equal(canRole("admin", "settings.sales"), false, "chaves de venda so com o dono (padrao de mercado)");
  assert.equal(canRole("support", "reports.read"), false, "suporte nao ve os numeros da escola");
  assert.deepEqual(sorted(SCOPABLE_ACTIONS), sorted(["catalog.content", "catalog.create", "catalog.write", "catalog.publish", "community.reply", "community.moderate"]));
});

test("pre-requisitos: marcar traz o necessario, desmarcar tira o que depende", () => {
  assert.deepEqual(sorted(withRequiredActions(["messaging.publish_large"])), ["messaging.publish", "messaging.publish_large", "messaging.write"]);
  assert.deepEqual(sorted(withRequiredActions(["catalog.create"])), ["catalog.content", "catalog.create", "catalog.write"], "criar curso traz editar detalhes e montar aulas");
  assert.deepEqual(sorted(withRequiredActions(["catalog.access"])), ["catalog.access", "catalog.content", "catalog.write"]);
  assert.deepEqual(sorted(withRequiredActions(["students.export"])), ["students.export", "students.read_basic", "students.read_personal"], "o CSV leva telefone");
  assert.deepEqual(sorted(dependentActionsOf("students.read_basic")), ["students.access", "students.delete", "students.export", "students.read_personal"]);
  assert.deepEqual(dependentActionsOf("students.read_personal"), ["students.export"]);
  assert.deepEqual(sorted(dependentActionsOf("catalog.content")), ["catalog.access", "catalog.create", "catalog.delete", "catalog.publish", "catalog.write"]);
  assert.deepEqual(dependentActionsOf("reports.read"), []);
});

test("alcance: por curso so onde pode, pre-requisito herda o alcance e a escola toda vence", () => {
  const create = grantsFromSelection(["catalog.create"], ["catalog.create"]);
  assert.deepEqual([...create].sort(), [["catalog.content", "courses"], ["catalog.create", "courses"], ["catalog.write", "courses"]]);

  const access = grantsFromSelection(["catalog.access"], ["catalog.access"]);
  assert.equal(access.get("catalog.access"), "school", "acesso e venda nunca vale so num curso");
  assert.equal(access.get("catalog.write"), "school", "quem cuida de venda de todos precisa ver todos");

  const merged = memberGrants(["instructor", "support"], { actions: [], scopedActions: [] });
  assert.equal(merged.get("catalog.content"), "courses", "Professor: aulas so nos cursos dele");
  assert.equal(merged.get("community.reply"), "school", "Suporte: responde em todos os cursos (a escola toda vence)");
  assert.equal(merged.get("students.access"), "school");

  const ignored = grantsFromSelection(["settings.team", "settings.sales", "admin.read", "nada"], []);
  assert.equal(ignored.size, 0, "so o que pode ser dado entra");
});

test("pessoa: funcoes prontas e personalizadas se somam com os extras dela", () => {
  const custom = new Map([
    [FN_A, { actions: ["catalog.create", "catalog.publish"], id: FN_A, scopedActions: ["catalog.create", "catalog.publish"] }],
    [FN_B, { actions: ["messaging.write"], id: FN_B, scopedActions: [] }]
  ]);
  const access = resolveAdminAccess(
    "custom",
    { actions: ["students.export"], functions: ["instructor", FN_A, FN_B, "33333333-3333-4333-8333-333333333333"], productIds: ["curso-1"], scopedActions: [] },
    custom
  );

  assert.equal(can(access, "catalog.create"), true);
  assert.equal(access.scopedActions.has("catalog.create"), true, "criar so nos cursos dele");
  assert.equal(access.scopedActions.has("catalog.write"), true, "editar detalhes, herdado do criar, tambem so nos cursos");
  assert.equal(can(access, "catalog.access"), false, "nao mexe em preco nem em quem pode ver");
  assert.equal(can(access, "messaging.write"), true);
  assert.equal(access.scopedActions.has("messaging.write"), false);
  assert.equal(can(access, "students.read_personal"), true, "extra de exportar traz os pre-requisitos");
  assert.equal(can(access, "admin.read"), true);
  assert.deepEqual(access.courseIds, ["curso-1"]);
  assert.equal(access.functions.length, 4, "funcao apagada fica na lista, mas nao da nada");

  assert.deepEqual(sorted(resolveAdminAccess("custom", {}).actions), ["admin.read"], "sem nada: so entrar (nenhuma area)");
  assert.deepEqual(sorted(resolveAdminAccess("custom", "lixo").actions), ["admin.read"]);
});

test("linhas antigas continuam valendo: papel pronto, Professor com cursos e Personalizado com lista", () => {
  const instructor = resolveAdminAccess("instructor", { actions: ["catalog.delete"], productIds: ["curso-1", "curso-1", "id com espaco", "curso-2"] });
  assert.deepEqual(sorted(instructor.actions), sorted(["admin.read", "catalog.content", "community.reply", "community.moderate"]));
  assert.deepEqual(instructor.courseIds, ["curso-1", "curso-2"], "ids invalidos e repetidos sao descartados");
  assert.deepEqual(instructor.functions, ["instructor"]);

  const customV1 = resolveAdminAccess("custom", { actions: ["students.access"] });
  assert.deepEqual(sorted(customV1.actions), ["admin.read", "students.access", "students.read_basic"]);
  assert.equal(customV1.scopedActions.size, 0, "o Personalizado antigo vale para a escola toda");

  const owner = resolveAdminAccess("owner", { functions: ["support"] });
  assert.deepEqual(sorted(owner.actions), sorted(ADMIN_ACTIONS), "dono e exclusivo: pode tudo");

  for (const role of [null, undefined, "", "Owner", "student", "root", 1]) {
    assert.equal(resolveAdminAccess(role, {}), null, String(role));
  }

  assert.deepEqual(parseStoredPermissions({ actions: "x", functions: ["owner", "admin", "nao-uuid", FN_A], productIds: [1, "ok"] }), {
    actions: [],
    functions: ["admin", FN_A],
    productIds: ["ok"],
    scopedActions: []
  });
});

test("escopo: a pessoa so alcanca os cursos dela onde a permissao e por curso", () => {
  const professor = resolveAdminAccess("instructor", { productIds: ["curso-a"] });

  assert.equal(scopeAllows(professor, "catalog.content", ["curso-a"]), true);
  assert.equal(scopeAllows(professor, "catalog.content", ["curso-a", "curso-b"]), false, "um curso de fora derruba o pedido inteiro");
  assert.equal(scopeAllows(professor, "catalog.content", []), false, "alvo vazio e recusado");
  assert.equal(scopeAllows(professor, "catalog.content", null), false, "id que nao existe e recusado");
  assert.equal(scopeAllows(professor, "admin.read", null), true, "acao da escola toda nao confere curso");
  assert.deepEqual(catalogScope(professor), ["curso-a"]);
  assert.deepEqual(communityScope(professor), ["curso-a"]);
  assert.equal(isProductInScope(professor, "curso-a"), true);
  assert.equal(isProductInScope(professor, "curso-b"), false);

  const professorSupport = resolveAdminAccess("custom", { functions: ["instructor", "support"], productIds: ["curso-a"] });
  assert.deepEqual(catalogScope(professorSupport), ["curso-a"], "no catalogo, so os cursos dele");
  assert.equal(communityScope(professorSupport), null, "na comunidade, todos os cursos (vem do Suporte)");
  assert.equal(scopeAllows(professorSupport, "community.reply", ["curso-b"]), true);

  const support = resolveAdminAccess("support", {});
  assert.equal(catalogScope(support), null, "sem permissao de catalogo: nada a limitar");
  assert.equal(isProductInScope(support, "qualquer"), true);
  assert.equal(isProductInScope(null, "curso-a"), false);

  assert.equal(canSeeProductDetails(professor), false, "Professor puro so ve a aba Conteudo");
  assert.equal(canSeeProductDetails(resolveAdminAccess("custom", { actions: ["catalog.write"], productIds: ["curso-a"], scopedActions: ["catalog.write"] })), true);
  assert.equal(canSeeProductAccess(resolveAdminAccess("custom", { actions: ["catalog.write"], productIds: ["curso-a"], scopedActions: ["catalog.write"] })), false);
  assert.equal(canSeeProductAccess(resolveAdminAccess("analyst", {})), true);
});

test("copia para o cliente ida e volta, sem confiar no que vier", () => {
  const access = resolveAdminAccess("custom", { functions: ["instructor"], productIds: ["curso-1"] });
  const roundTrip = fromAccessSnapshot(JSON.parse(JSON.stringify(toAccessSnapshot(access))));

  assert.deepEqual(sorted(roundTrip.actions), sorted(access.actions));
  assert.deepEqual(sorted(roundTrip.scopedActions), sorted(access.scopedActions));
  assert.deepEqual(roundTrip.courseIds, ["curso-1"]);
  assert.deepEqual(roundTrip.functions, ["instructor"]);
  assert.deepEqual(
    sorted(fromAccessSnapshot({ actions: ["catalog.write", "hack"], courseIds: [], functions: [], role: "custom", scopedActions: ["catalog.write", "students.access"] }).scopedActions),
    ["catalog.write"],
    "alcance so de acao que a pessoa tem"
  );
  assert.equal(can(null, "admin.read"), false);
  assert.equal(can(access, "catalog.destroy"), false);
  assert.equal(isAdminAction("catalog.write"), true);
  assert.equal(isAdminAction("toString"), false);
});

test("editor cria, publica e cuida de venda; professor so monta aulas; suporte atende", () => {
  assert.equal(canRole("editor", "catalog.create"), true);
  assert.equal(canRole("editor", "catalog.access"), true);
  assert.equal(canRole("editor", "catalog.delete"), false);
  assert.equal(canRole("editor", "settings.ai"), false);
  assert.equal(canRole("instructor", "catalog.content"), true);
  assert.equal(canRole("instructor", "catalog.create"), false, "professor pronto nao cria curso (da para somar como extra)");
  assert.equal(canRole("instructor", "students.read_basic"), false, "professor nao ve a lista de alunos");
  assert.equal(canRole("support", "community.reply"), true, "suporte ja responde alunos");
  assert.equal(canRole("support", "catalog.write"), false);
});

test("frases de recusa falam a lingua do produtor", () => {
  assert.equal(describeForbidden("settings.team"), "Só o dono da escola pode mudar a equipe.");
  assert.equal(describeForbidden("settings.sales"), "Só o dono da escola pode mexer nas chaves de venda.");
  assert.equal(describeForbidden("settings.ai"), "Só o dono ou um administrador pode fazer isso.");
  assert.equal(describeForbidden("catalog.delete"), "Só o dono ou um administrador pode fazer isso.");
  assert.equal(describeForbidden("catalog.write"), "Sua função na equipe não permite esta ação.");
});

test("toActionError: zod vira 400 com erros por campo", () => {
  const schema = z.object({ title: z.string().min(3, "Use pelo menos 3 caracteres."), url: z.string().max(2, "Longo demais.") });
  const result = schema.safeParse({ title: "a", url: "abc" });
  const failure = toActionError(result.error);

  assert.equal(failure.ok, false);
  assert.equal(failure.status, 400);
  assert.equal(failure.error, "Use pelo menos 3 caracteres.");
  assert.deepEqual(failure.fieldErrors, { title: ["Use pelo menos 3 caracteres."], url: ["Longo demais."] });
});

test("toActionError: status conhecido passa a mensagem; o resto nunca vaza", () => {
  const forbidden = Object.assign(new Error("Seu papel na equipe não permite esta ação."), { status: 403 });
  const conflict = Object.assign(new Error("Alterado em outro lugar."), { status: 409 });

  assert.deepEqual(toActionError(forbidden), { error: "Seu papel na equipe não permite esta ação.", ok: false, status: 403 });
  assert.deepEqual(toActionError(conflict), { error: "Alterado em outro lugar.", ok: false, status: 409 });
  assert.deepEqual(toActionError(new Error("duplicate key value violates unique constraint")), {
    error: GENERIC_ACTION_ERROR,
    ok: false,
    status: 500
  });
  assert.deepEqual(toActionError(Object.assign(new Error("segredo"), { status: 500 })).error, GENERIC_ACTION_ERROR);
  assert.deepEqual(toActionError(Object.assign(new Error("x"), { status: 418 })).status, 500);
  assert.deepEqual(toActionError("texto solto").status, 500);
  assert.deepEqual(actionOk({ id: "a" }), { data: { id: "a" }, ok: true });
  assert.deepEqual(actionError(404, "Não encontrado.", {}), { error: "Não encontrado.", ok: false, status: 404 });
});
