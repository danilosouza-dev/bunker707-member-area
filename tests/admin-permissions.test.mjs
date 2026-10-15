import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import "./support/resolve-extensionless-ts.mjs";

const { ADMIN_ACTIONS, ADMIN_ROLES, canRole, describeForbidden, isAdminAction, rolesFor } = await import(
  "../src/server/auth/roles.ts"
);
const { GENERIC_ACTION_ERROR, actionError, actionOk, toActionError } = await import("../src/lib/action-result.ts");

const writeActions = ADMIN_ACTIONS.filter((action) => action !== "admin.read");

test("tabela de papeis segue docs/17 §2.3", () => {
  const expected = {
    "admin.read": ["owner", "admin", "editor", "support", "analyst"],
    "catalog.delete": ["owner", "admin"],
    "catalog.publish": ["owner", "admin", "editor"],
    "catalog.write": ["owner", "admin", "editor"],
    "community.moderate": ["owner", "admin", "editor", "support"],
    "community.reply": ["owner", "admin", "editor", "support"],
    "messaging.publish": ["owner", "admin", "editor"],
    "messaging.publish_large": ["owner", "admin"],
    "messaging.write": ["owner", "admin", "editor"],
    "settings.ai": ["owner", "admin"],
    "settings.sales": ["owner", "admin"],
    "settings.team": ["owner"],
    "storefront.write": ["owner", "admin", "editor"],
    "students.access": ["owner", "admin", "support"],
    "students.delete": ["owner", "admin"],
    "students.export": ["owner", "admin"],
    "students.read_basic": ["owner", "admin", "editor", "support"],
    "students.read_personal": ["owner", "admin", "support"]
  };

  assert.deepEqual([...ADMIN_ACTIONS].sort(), Object.keys(expected).sort());

  for (const [action, roles] of Object.entries(expected)) {
    assert.deepEqual(rolesFor(action), roles, action);

    for (const role of ADMIN_ROLES) {
      assert.equal(canRole(role, action), roles.includes(role), `${role} -> ${action}`);
    }
  }
});

test("analista nunca escreve; dono pode tudo", () => {
  for (const action of writeActions) {
    assert.equal(canRole("analyst", action), false, `analyst nao pode ${action}`);
    assert.equal(canRole("owner", action), true, `owner pode ${action}`);
  }

  assert.equal(canRole("analyst", "admin.read"), true);
});

test("editor cria e publica produto, mas nao exclui nem mexe em equipe ou IA", () => {
  assert.equal(canRole("editor", "catalog.write"), true);
  assert.equal(canRole("editor", "catalog.publish"), true);
  assert.equal(canRole("editor", "catalog.delete"), false);
  assert.equal(canRole("editor", "settings.ai"), false);
  assert.equal(canRole("editor", "settings.team"), false);
  assert.equal(canRole("support", "catalog.write"), false);
  assert.equal(canRole("support", "students.access"), true);
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
