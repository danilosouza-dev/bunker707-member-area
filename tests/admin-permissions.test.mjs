import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import "./support/resolve-extensionless-ts.mjs";

const {
  ADMIN_ACTIONS,
  ADMIN_ROLES,
  GRANTABLE_ACTIONS,
  OWNER_ONLY_ACTIONS,
  PRODUCT_SCOPED_ACTIONS,
  can,
  canRole,
  canSeeProductSettings,
  customActionsOf,
  dependentActionsOf,
  describeForbidden,
  fromAccessSnapshot,
  isAdminAction,
  isProductInScope,
  parseStoredPermissions,
  resolveAdminAccess,
  rolesFor,
  scopeAllows,
  toAccessSnapshot,
  withRequiredActions
} = await import("../src/server/auth/roles.ts");
const { GENERIC_ACTION_ERROR, actionError, actionOk, toActionError } = await import("../src/lib/action-result.ts");

const presetRoles = ADMIN_ROLES.filter((role) => role !== "custom");
const sorted = (values) => [...values].sort();

test("tabela de papeis prontos segue docs/17 §2.3", () => {
  const expected = {
    "admin.read": ["owner", "admin", "editor", "instructor", "support", "analyst"],
    "catalog.content": ["owner", "admin", "editor", "instructor"],
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

  for (const [action, roles] of Object.entries(expected)) {
    assert.deepEqual(rolesFor(action), roles, action);

    for (const role of presetRoles) {
      assert.equal(canRole(role, action), roles.includes(role), `${role} -> ${action}`);
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
  assert.equal(canRole("admin", "settings.team"), false);
  assert.equal(canRole("admin", "settings.sales"), false, "chaves de venda so com o dono (padrao de mercado)");
  assert.equal(canRole("support", "reports.read"), false, "suporte nao ve os numeros da escola");
});

test("personalizado: so o que o dono marcou, com pre-requisitos, nunca equipe nem vendas", () => {
  assert.deepEqual(sorted(GRANTABLE_ACTIONS), sorted(ADMIN_ACTIONS.filter((action) => !["admin.read", "settings.sales", "settings.team"].includes(action))));

  const access = resolveAdminAccess("custom", { actions: ["students.export", "settings.team", "settings.sales", "root", 7] });

  assert.deepEqual(sorted(access.actions), ["admin.read", "students.export", "students.read_basic", "students.read_personal"], "o CSV leva telefone");
  assert.equal(access.productIds, null, "personalizado vale para a escola toda");
  assert.equal(can(access, "students.export"), true);
  assert.equal(can(access, "settings.team"), false);
  assert.equal(can(access, "students.delete"), false);

  assert.deepEqual(sorted(resolveAdminAccess("custom", {}).actions), ["admin.read"], "sem nada marcado: so entrar (nenhuma area)");
  assert.deepEqual(sorted(resolveAdminAccess("custom", "lixo").actions), ["admin.read"]);
  assert.deepEqual(sorted(customActionsOf(["catalog.delete"])), ["admin.read", "catalog.content", "catalog.delete", "catalog.write"]);
});

test("pre-requisitos: marcar traz o necessario, desmarcar tira o que depende", () => {
  assert.deepEqual(sorted(withRequiredActions(["messaging.publish_large"])), ["messaging.publish", "messaging.publish_large", "messaging.write"]);
  assert.deepEqual(sorted(withRequiredActions(["catalog.publish"])), ["catalog.content", "catalog.publish", "catalog.write"]);
  assert.deepEqual(sorted(dependentActionsOf("students.read_basic")), ["students.access", "students.delete", "students.export", "students.read_personal"]);
  assert.deepEqual(dependentActionsOf("students.read_personal"), ["students.export"], "tirar dados pessoais tira a exportacao");
  assert.deepEqual(sorted(dependentActionsOf("catalog.content")), ["catalog.delete", "catalog.publish", "catalog.write"]);
  assert.deepEqual(dependentActionsOf("reports.read"), []);
});

test("professor: so os cursos escolhidos, nunca 'todos' por engano", () => {
  const access = resolveAdminAccess("instructor", { actions: ["catalog.delete"], productIds: ["curso-1", "curso-1", "id com espaco", "../x", "curso-2"] });

  assert.deepEqual(sorted(access.actions), sorted(["admin.read", "catalog.content", "community.reply", "community.moderate"]), "acoes do papel pronto (marcadas sao ignoradas)");
  assert.deepEqual(access.productIds, ["curso-1", "curso-2"], "ids invalidos e repetidos sao descartados");
  assert.deepEqual(resolveAdminAccess("instructor", {}).productIds, [], "sem lista = nenhum curso (nunca a escola toda)");
  assert.deepEqual(sorted(PRODUCT_SCOPED_ACTIONS), ["catalog.content", "community.moderate", "community.reply"]);

  assert.equal(isProductInScope(access, "curso-1"), true);
  assert.equal(isProductInScope(access, "curso-3"), false);
  assert.equal(isProductInScope(resolveAdminAccess("editor", {}), "qualquer"), true);
  assert.equal(isProductInScope(null, "curso-1"), false);

  assert.equal(scopeAllows(access, ["curso-1"]), true);
  assert.equal(scopeAllows(access, ["curso-1", "curso-3"]), false, "um curso de fora derruba o pedido inteiro");
  assert.equal(scopeAllows(access, []), false, "alvo vazio e recusado");
  assert.equal(scopeAllows(access, null), false, "id que nao existe e recusado");
  assert.equal(scopeAllows(resolveAdminAccess("admin", {}), null), true, "sem escopo, o alvo nao importa");

  assert.equal(canSeeProductSettings(access), false, "professor so ve a aba Conteudo");
  assert.equal(canSeeProductSettings(resolveAdminAccess("analyst", {})), true);
  assert.equal(canSeeProductSettings(resolveAdminAccess("support", {})), false);
});

test("permissoes efetivas: papel desconhecido nao entra; copia para o cliente ida e volta", () => {
  for (const role of [null, undefined, "", "Owner", "student", "root", 1]) {
    assert.equal(resolveAdminAccess(role, {}), null, String(role));
  }

  assert.equal(can(null, "admin.read"), false);
  assert.equal(can(resolveAdminAccess("owner", {}), "catalog.destroy"), false);

  const access = resolveAdminAccess("instructor", { productIds: ["curso-1"] });
  const roundTrip = fromAccessSnapshot(JSON.parse(JSON.stringify(toAccessSnapshot(access))));

  assert.deepEqual(sorted(roundTrip.actions), sorted(access.actions));
  assert.deepEqual(roundTrip.productIds, ["curso-1"]);
  assert.equal(roundTrip.role, "instructor");
  assert.deepEqual(sorted(fromAccessSnapshot({ actions: ["catalog.write", "hack"], productIds: null, role: "custom" }).actions), ["catalog.write"]);

  assert.deepEqual(parseStoredPermissions({ actions: "x", productIds: [1, "ok"] }), { actions: [], productIds: ["ok"] });
});

test("editor cria e publica produto, mas nao exclui nem mexe em equipe ou IA; professor so monta aulas", () => {
  assert.equal(canRole("editor", "catalog.write"), true);
  assert.equal(canRole("editor", "catalog.publish"), true);
  assert.equal(canRole("editor", "catalog.delete"), false);
  assert.equal(canRole("editor", "settings.ai"), false);
  assert.equal(canRole("editor", "settings.team"), false);
  assert.equal(canRole("support", "catalog.write"), false);
  assert.equal(canRole("support", "students.access"), true);
  assert.equal(canRole("instructor", "catalog.content"), true);
  assert.equal(canRole("instructor", "catalog.write"), false, "professor nao cria produto nem mexe em regra de acesso");
  assert.equal(canRole("instructor", "students.read_basic"), false, "professor nao ve a lista de alunos");
  assert.equal(canRole("instructor", "reports.read"), false);
});

test("papel ou acao desconhecidos sao recusados", () => {
  for (const role of [null, undefined, "", "Owner", "student", "root"]) {
    assert.equal(canRole(role, "admin.read"), false, String(role));
  }

  assert.equal(canRole("owner", "catalog.destroy"), false);
  assert.equal(canRole("owner", "__proto__"), false);
  assert.equal(isAdminAction("catalog.write"), true);
  assert.equal(isAdminAction("toString"), false);
});

test("frases de recusa falam a lingua do produtor", () => {
  assert.equal(describeForbidden("settings.team"), "Só o dono da escola pode mudar a equipe.");
  assert.equal(describeForbidden("settings.sales"), "Só o dono da escola pode mexer nas chaves de venda.");
  assert.equal(describeForbidden("settings.ai"), "Só o dono ou um administrador pode fazer isso.");
  assert.equal(describeForbidden("catalog.delete"), "Só o dono ou um administrador pode fazer isso.");
  assert.equal(describeForbidden("catalog.write"), "Seu papel na equipe não permite esta ação.");
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
