import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";

// Equipe (docs/17 §2.3): funcoes prontas e personalizadas que se somam, permissoes extras por pessoa
// e o que vale so nos cursos escolhidos.
// - modelo puro (textos, o que vai para o banco, regras de mudanca, resumo da lista e auditoria);
// - validacao das Server Actions;
// - escopo por curso: modulo, aula e comentario resolvidos ate o produto dono, com banco falso;
// - leitura de codigo: toda acao diz o curso tocado e toda acao de Equipe e so do dono.

const roles = await import("../src/server/auth/roles.ts");
const team = await import("../src/server/team/model.ts");
const schemas = await import("../src/server/team/schemas.ts");
const scope = await import("../src/server/auth/product-scope.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sorted = (values) => [...values].sort();
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const FN = "11111111-1111-4111-8111-111111111111";
const creator = new Map([[FN, { actions: ["catalog.create"], id: FN, scopedActions: ["catalog.create"] }]]);

test("textos: cada permissao que pode ser dada aparece uma vez, e toda funcao tem descricao", () => {
  const listed = team.TEAM_PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.action));

  assert.deepEqual(sorted(listed), sorted(roles.GRANTABLE_ACTIONS));
  assert.equal(new Set(listed).size, listed.length, "sem repeticao");
  assert.deepEqual(sorted(team.TEAM_PRESET_OPTIONS), sorted(roles.COMBINABLE_PRESETS));

  for (const role of roles.ADMIN_ROLES) {
    assert.ok(team.TEAM_ROLE_DESCRIPTIONS[role]?.length > 20, role);
  }

  for (const action of ["students.export", "students.delete", "students.read_personal", "catalog.delete", "catalog.access", "settings.ai"]) {
    const item = team.TEAM_PERMISSION_GROUPS.flatMap((group) => group.items).find((entry) => entry.action === action);
    assert.equal(item.sensitive, true, `${action} aparece como sensivel`);
  }

  assert.equal(team.functionLabel("instructor", new Map()), "Professor");
  assert.equal(team.functionLabel(FN, new Map([[FN, { name: "Professor com criação" }]])), "Professor com criação");
  assert.equal(team.functionLabel(FN, new Map()), "Função removida");
});

test("o que vai para o banco: linha simples para uma funcao pronta, combinada para o resto", () => {
  const base = { extraActions: [], extraScopedActions: [], functions: [], owner: false, productIds: [] };

  assert.deepEqual(team.storedMemberFor({ ...base, owner: true, functions: ["support"] }, new Map()), { permissions: {}, role: "owner" });
  assert.deepEqual(team.storedMemberFor({ ...base, functions: ["support"] }, new Map()), { permissions: {}, role: "support" });
  assert.deepEqual(team.storedMemberFor({ ...base, functions: ["support"], productIds: ["curso-1"] }, new Map()), { permissions: {}, role: "support" }, "cursos so quando alguma permissao e por curso");
  assert.deepEqual(team.storedMemberFor({ ...base, functions: ["instructor"], productIds: ["a", "a", "b"] }, new Map()), { permissions: { productIds: ["a", "b"] }, role: "instructor" });

  assert.deepEqual(team.storedMemberFor({ ...base, functions: ["instructor", "support"], productIds: ["a"] }, new Map()), {
    permissions: { actions: [], functions: ["instructor", "support"], productIds: ["a"], scopedActions: [] },
    role: "custom"
  });

  // Professor especifico que tambem cria cursos: extra por curso, com os pre-requisitos que o Professor
  // ainda nao da ("montar modulos e aulas" ja vem da funcao).
  assert.deepEqual(team.storedMemberFor({ ...base, extraActions: ["catalog.create"], extraScopedActions: ["catalog.create"], functions: ["instructor"], productIds: ["a"] }, new Map()), {
    permissions: { actions: ["catalog.create", "catalog.write"], functions: ["instructor"], productIds: ["a"], scopedActions: ["catalog.create", "catalog.write"] },
    role: "custom"
  });

  // Extra que a funcao ja da igual nao e gravado: volta a ser a linha simples.
  assert.deepEqual(team.storedMemberFor({ ...base, extraActions: ["community.reply", "students.read_basic"], functions: ["support"] }, new Map()), { permissions: {}, role: "support" });
  assert.deepEqual(team.storedMemberFor({ ...base, extraActions: ["community.reply"], extraScopedActions: ["community.reply"], functions: ["instructor"], productIds: ["a"] }, new Map()), {
    permissions: { productIds: ["a"] },
    role: "instructor"
  });

  // Professor que modera a comunidade toda: o extra "escola toda" fica e vence o "so nos cursos" da funcao.
  const widened = team.storedMemberFor({ ...base, extraActions: ["community.moderate"], functions: ["instructor"], productIds: ["a"] }, new Map());
  assert.deepEqual(widened, { permissions: { actions: ["community.moderate"], functions: ["instructor"], productIds: ["a"], scopedActions: [] }, role: "custom" });
  const widenedAccess = roles.resolveAdminAccess(widened.role, widened.permissions);
  assert.equal(roles.isActionScoped(widenedAccess, "community.moderate"), false);
  assert.equal(roles.isActionScoped(widenedAccess, "community.reply"), true, "responder continua so nos cursos dela");

  assert.deepEqual(team.storedMemberFor({ ...base, functions: [FN], productIds: ["a"] }, creator).role, "custom", "funcao personalizada sempre grava a lista");
  assert.equal(team.storedMemberFor({ ...base, extraActions: ["settings.team", "students.export"] }, new Map()).permissions.actions.includes("settings.team"), false);
});

test("pessoa: funcoes e extras se somam, e o que vem das funcoes aparece com a origem", () => {
  const names = new Map([[FN, { name: "Criador" }]]);
  const sources = team.functionGrantSources(["instructor", "support", FN], creator, names);

  assert.deepEqual(sources.get("catalog.content"), { scope: "courses", sources: ["Professor", "Criador"] });
  assert.deepEqual(sources.get("community.reply"), { scope: "school", sources: ["Professor", "Suporte"] }, "a escola toda vence");
  assert.equal(sources.has("admin.read"), false);

  const grants = team.memberGrantsOf({ extraActions: ["messaging.write"], extraScopedActions: [], functions: ["instructor", FN], owner: false }, creator);
  assert.equal(grants.get("catalog.create"), "courses");
  assert.equal(grants.get("messaging.write"), "school");
  assert.equal(team.needsCourses(grants), true);
  assert.equal(team.needsCourses(team.memberGrantsOf({ extraActions: [], extraScopedActions: [], functions: ["support"], owner: false }, new Map())), false);

  // Extras sem o que as funcoes ja dao com o mesmo alcance (ou maior).
  const fromFunctions = team.functionGrantsOf(["instructor"], new Map());
  const extras = new Map([
    ["catalog.content", "courses"],
    ["community.reply", "school"],
    ["messaging.write", "school"]
  ]);
  assert.deepEqual([...team.withoutRedundantExtras(extras, fromFunctions)], [["community.reply", "school"], ["messaging.write", "school"]]);
  assert.deepEqual([...team.withoutRedundantExtras(new Map([["community.reply", "courses"]]), team.functionGrantsOf(["support"], new Map()))], []);

  const fromRow = team.memberAccessOf("instructor", { actions: ["catalog.delete"], productIds: ["a"] });
  assert.deepEqual(fromRow, { extraActions: [], extraScopedActions: [], functions: ["instructor"], owner: false, productIds: ["a"] }, "papel pronto nao le extras");

  const combined = team.memberAccessOf("custom", { actions: ["students.access"], functions: ["instructor"], productIds: ["a"], scopedActions: [] });
  assert.deepEqual(combined.functions, ["instructor"]);
  assert.deepEqual(combined.extraActions, ["students.access"]);

  const legacyCustom = team.memberAccessOf("custom", { actions: ["students.access"] });
  assert.deepEqual(legacyCustom.functions, [], "Personalizado antigo vira permissoes extras, nada se perde");
  assert.deepEqual(legacyCustom.extraActions, ["students.access"]);
});

test("o que a pessoa enxerga: so quem e da escola toda ve todos os cursos (lista, busca e area do aluno)", () => {
  const MONITOR = "22222222-2222-4222-8222-222222222222";
  const monitorFunction = new Map([
    [MONITOR, { actions: ["community.reply", "community.moderate"], id: MONITOR, scopedActions: ["community.reply", "community.moderate"] }]
  ]);

  // Funcao so de comunidade, por curso: nao abre o catalogo todo.
  const monitor = roles.resolveAdminAccess("custom", { functions: [MONITOR], productIds: ["curso-a"] }, monitorFunction);
  assert.deepEqual(roles.communityScope(monitor), ["curso-a"]);
  assert.deepEqual(roles.catalogScope(monitor), ["curso-a"]);
  assert.equal(roles.isProductInScope(monitor, "curso-b"), false);

  // Funcao que nao abriu (excluida ou ilegivel) nao vira escola toda.
  const broken = roles.resolveAdminAccess("custom", { functions: [MONITOR], productIds: ["curso-a"] }, new Map());
  assert.deepEqual([...broken.actions], ["admin.read"]);
  assert.deepEqual(roles.catalogScope(broken), ["curso-a"]);
  assert.equal(roles.isProductInScope(broken, "curso-b"), false);

  // Equipe da escola toda continua vendo tudo.
  assert.equal(roles.catalogScope(roles.resolveAdminAccess("support", {})), null);
  assert.equal(roles.catalogScope(roles.resolveAdminAccess("custom", { actions: ["messaging.write"] })), null);
  assert.equal(roles.catalogScope(roles.resolveAdminAccess("custom", { functions: ["instructor", "analyst"], productIds: ["curso-a"] })), null, "numeros da escola toda");
  assert.deepEqual(roles.catalogScope(roles.resolveAdminAccess("custom", { functions: ["instructor", "support"], productIds: ["curso-a"] })), ["curso-a"], "catalogo do Professor");
  assert.equal(roles.communityScope(roles.resolveAdminAccess("custom", { functions: ["instructor", "support"], productIds: ["curso-a"] })), null, "comunidade do Suporte");
});

test("funcao personalizada: so o que pode ser dado, com pre-requisitos e alcance", () => {
  assert.deepEqual(team.storedFunctionGrants(["catalog.create", "settings.team"], ["catalog.create"]), {
    actions: ["catalog.content", "catalog.create", "catalog.write"],
    scopedActions: ["catalog.content", "catalog.create", "catalog.write"]
  });
  assert.deepEqual(team.storedFunctionGrants(["catalog.access", "students.export"], ["catalog.access"]), {
    actions: ["catalog.content", "catalog.write", "catalog.access", "students.read_basic", "students.read_personal", "students.export"],
    scopedActions: []
  }, "acesso e venda nunca e por curso");
  assert.deepEqual([...team.presetSelection("instructor")].sort(), [["catalog.content", "courses"], ["community.moderate", "courses"], ["community.reply", "courses"]]);
  assert.equal(team.presetSelection("admin").has("settings.team"), false);
});

test("regras de mudanca: ninguem mexe em si mesmo e a escola nunca fica sem dono", () => {
  const change = (input) => team.teamChangeError({ actorId: OWNER, ownerCount: 1, targetId: OTHER, ...input });

  assert.equal(change({ change: { fromOwner: false, kind: "update", toOwner: false }, targetId: OWNER }), team.SELF_CHANGE_MESSAGE);
  assert.equal(change({ change: { fromOwner: true, kind: "remove" }, targetId: OWNER }), team.SELF_CHANGE_MESSAGE);
  assert.equal(change({ change: { fromOwner: true, kind: "update", toOwner: false } }), team.LAST_OWNER_MESSAGE);
  assert.equal(change({ change: { fromOwner: true, kind: "remove" } }), team.LAST_OWNER_MESSAGE);
  assert.equal(change({ change: { fromOwner: true, kind: "update", toOwner: false }, ownerCount: 2 }), null, "com dois donos, um pode deixar de ser");
  assert.equal(change({ change: { fromOwner: true, kind: "update", toOwner: true } }), null);
  assert.equal(change({ change: { fromOwner: false, kind: "remove" } }), null);
  assert.equal(change({ change: { fromOwner: false, kind: "update", toOwner: true } }), null, "o dono pode promover alguem a dono");
});

test("lista: funcoes, resumo do acesso, donos primeiro e auditoria enxuta", () => {
  const names = new Map([[FN, { name: "Criador" }]]);

  assert.equal(team.describeMemberFunctions({ extraActions: [], functions: [], owner: true }, names), "Dono");
  assert.equal(team.describeMemberFunctions({ extraActions: [], functions: ["instructor", "support"], owner: false }, names), "Professor + Suporte");
  assert.equal(team.describeMemberFunctions({ extraActions: ["catalog.create"], functions: ["instructor"], owner: false }, names), "Professor + 1 extra");
  assert.equal(team.describeMemberFunctions({ extraActions: ["a", "b"], functions: [], owner: false }, names), "Só permissões extras (2)");
  assert.equal(team.describeMemberFunctions({ extraActions: [], functions: [FN], owner: false }, names), "Criador");

  const professor = team.memberGrantsOf({ extraActions: [], extraScopedActions: [], functions: ["instructor"], owner: false }, new Map());
  assert.equal(team.describeMemberAccess({ owner: false, productIds: [] }, professor), "Nenhum curso ainda · 3 permissões");
  assert.equal(team.describeMemberAccess({ owner: false, productIds: ["a", "b"] }, professor), "2 cursos · 3 permissões");
  assert.equal(team.describeMemberAccess({ owner: true, productIds: [] }, professor), "Tudo");

  const ordered = team.sortTeamMembers([
    { fullName: "Zé", owner: false },
    { fullName: "Bia", owner: true },
    { fullName: "Ana", owner: false }
  ]);
  assert.deepEqual(ordered.map((member) => member.fullName), ["Bia", "Ana", "Zé"]);

  const snapshot = team.teamAuditSnapshot("custom", { actions: [], functions: ["instructor"], productIds: Array.from({ length: 30 }, (_, index) => `curso-${index}`) });
  assert.equal(snapshot.productCount, 30);
  assert.equal(snapshot.productIds.length, 20, "no maximo 20 ids na auditoria (teto de 4 KB)");
  assert.deepEqual(team.teamAuditSnapshot("support", {}), { role: "support" });
});

test("validacao: pelo menos uma funcao ou permissao; e-mail normalizado; funcao e acao conhecidas", () => {
  const ok = schemas.addTeamMemberSchema.safeParse({ email: "  Pessoa@Exemplo.com ", functions: ["support"] });
  assert.equal(ok.success, true);
  assert.equal(ok.data.email, "pessoa@exemplo.com");

  const empty = schemas.addTeamMemberSchema.safeParse({ email: "p@exemplo.com" });
  assert.equal(empty.success, false);
  assert.deepEqual(empty.error.issues.map((issue) => [issue.path.join("."), issue.message]), [["functions", "Escolha pelo menos uma função ou permissão."]]);

  assert.equal(schemas.addTeamMemberSchema.safeParse({ email: "p@exemplo.com", owner: true }).success, true, "Dono dispensa funcoes");
  assert.equal(schemas.addTeamMemberSchema.safeParse({ email: "p@exemplo.com", extraActions: ["catalog.create"] }).success, true, "so extras tambem vale");
  assert.equal(schemas.updateTeamMemberSchema.safeParse({ functions: ["owner"], userId: OTHER }).success, false, "Dono nao e funcao combinavel");
  assert.equal(schemas.updateTeamMemberSchema.safeParse({ functions: ["nao-existe"], userId: OTHER }).success, false);
  assert.equal(schemas.updateTeamMemberSchema.safeParse({ functions: [FN], userId: OTHER }).success, true);

  for (const action of ["settings.team", "settings.sales", "admin.read", "catalog.destroy"]) {
    assert.equal(schemas.updateTeamMemberSchema.safeParse({ extraActions: [action], userId: OTHER }).success, false, `${action} nao pode ser marcada`);
  }

  assert.equal(schemas.updateTeamMemberSchema.safeParse({ extraActions: ["students.access"], extraScopedActions: ["students.access"], userId: OTHER }).success, false, "alunos nunca vale por curso");
  assert.equal(schemas.teamMemberIdSchema.safeParse({ userId: "nao-e-uuid" }).success, false);

  assert.equal(schemas.createTeamFunctionSchema.safeParse({ actions: ["catalog.content"], name: "Monitor" }).success, true);
  assert.equal(schemas.createTeamFunctionSchema.safeParse({ actions: [], name: "Monitor" }).error.issues[0].message, "Marque pelo menos uma permissão.");
  assert.equal(schemas.createTeamFunctionSchema.safeParse({ actions: ["catalog.content"], name: "M" }).success, false);
  assert.equal(schemas.updateTeamFunctionSchema.safeParse({ actions: ["catalog.content"], id: "x", name: "Monitor" }).success, false);
});

test("escopo por curso: comentario, aula e modulo chegam ao produto dono (inclusive na lixeira)", async () => {
  actionStubs.db = createFakeDb({
    tables: {
      course_modules: [
        { id: "mod-a", owner_id: "curso-a" },
        { id: "mod-b", owner_id: "curso-b" },
        { id: "mod-solto", owner_id: null }
      ],
      lesson_comments: [{ id: "11111111-1111-4111-8111-111111111111", lesson_id: "aula-b" }],
      lessons: [
        { id: "aula-a", module_id: "mod-a" },
        { id: "aula-b", module_id: "mod-b" },
        { id: "aula-solta", module_id: "mod-solto" }
      ]
    }
  });

  assert.deepEqual(await scope.resolveTargetProductIds({ lessonIds: ["aula-a"] }), ["curso-a"]);
  assert.deepEqual(sorted(await scope.resolveTargetProductIds({ lessonIds: ["aula-a"], moduleIds: ["mod-b"] })), ["curso-a", "curso-b"]);
  assert.deepEqual(await scope.resolveTargetProductIds({ commentIds: ["11111111-1111-4111-8111-111111111111"] }), ["curso-b"]);
  assert.deepEqual(await scope.resolveTargetProductIds({ productIds: ["curso-a"] }), ["curso-a"]);
  assert.equal(await scope.resolveTargetProductIds({ lessonIds: ["aula-que-nao-existe"] }), null, "id inexistente = recusa");
  assert.equal(await scope.resolveTargetProductIds({ lessonIds: ["aula-solta"] }), null, "modulo sem produto dono = recusa");
  assert.equal(await scope.resolveTargetProductIds({ commentIds: ["nao-e-uuid"] }), null, "formato invalido nunca chega ao banco");

  const professor = roles.resolveAdminAccess("instructor", { productIds: ["curso-a"] });
  assert.equal(roles.scopeAllows(professor, "catalog.content", await scope.resolveTargetProductIds({ lessonIds: ["aula-a"] })), true);
  assert.equal(roles.scopeAllows(professor, "catalog.content", await scope.resolveTargetProductIds({ lessonIds: ["aula-a", "aula-b"] })), false);
});

/** Corpo de cada funcao exportada: do `export async function X(` ate o proximo export. */
function exportedFunctions(source) {
  const starts = [...source.matchAll(/export async function (\w+)\(/g)];

  return starts.map((match, index) => ({
    body: source.slice(match.index, index + 1 < starts.length ? starts[index + 1].index : source.length),
    name: match[1]
  }));
}

const bodiesOf = (path) => Object.fromEntries(exportedFunctions(read(path)).map((entry) => [entry.name, entry.body]));

test("toda acao que pode valer por curso diz o curso que toca", () => {
  for (const { body, name } of exportedFunctions(read("src/server/catalog/content-actions.ts"))) {
    assert.match(body, /runAdminAction\("catalog\.content"/, `${name}: modulos e aulas usam catalog.content`);
    assert.match(body, /\{ target: /, `${name}: precisa dizer o curso tocado`);
  }

  const product = bodiesOf("src/server/catalog/product-actions.ts");
  for (const name of ["renameProduct", "updateProductDetails", "setProductHeroCorners", "setProductHeroVideo", "setProductHeroVideoOptions", "setProductImage"]) {
    assert.match(product[name], /runAdminAction\("catalog\.write"/, name);
    assert.match(product[name], /\{ target: \(data\) => \(\{ productIds: \[data\.id\] \}\) \}/, `${name}: detalhes so do curso tocado`);
  }
  for (const name of ["loadPublishChecklist", "publishProduct", "setProductSituation"]) {
    assert.match(product[name], /runAdminAction\("catalog\.publish"/, name);
    assert.match(product[name], /\{ target: \(data\) => \(\{ productIds: \[data\.id\] \}\) \}/, name);
  }
  assert.match(product.updateProductAccess, /runAdminAction\("catalog\.access"/, "acesso e venda: escola toda");
  assert.match(product.deleteProduct, /runAdminAction\("catalog\.delete"/);
  assert.match(product.createProduct, /runAdminAction\("catalog\.create"/);
  assert.match(product.createProduct, /assertCreatorScopeRoom\(access\);/, "lista cheia recusa antes de criar");
  assert.match(product.createProduct, /invalidateCatalog\(\{ from: "action" \}\);\s*await addCreatedCourseToScope\(access, user\.id, id\);/, "curso criado entra na lista de quem cria so nos proprios cursos");
  assert.match(product.createProduct, /canSetAccess \? requested : \{ \.\.\.requested, audience: "with_access" as const, purchaseUrl: null \}/, "sem acesso e venda: so quem tiver acesso, sem link de venda");
  assert.match(product.createProduct, /if \(!canSetAccess && requested\.format === "formacao"\) \{/, "Formação e de quem cuida de acesso e venda");

  // Publicar formacao publica junto os cursos em rascunho: quem publica so nos proprios cursos nao
  // publica curso de fora da lista, e a recusa vem antes de gravar.
  const publishGuard = product.publishProduct.indexOf('isActionScoped(access, "catalog.publish") && draftIds.some((id) => !access.courseIds.includes(id))');
  assert.ok(publishGuard > 0 && publishGuard < product.publishProduct.indexOf("updateRowGuarded"));

  const creatorScope = read("src/server/catalog/creator-scope.ts");
  assert.match(creatorScope, /isActionScoped\(access, "catalog\.create"\) && access\.courseIds\.length >= MAX_SCOPED_PRODUCTS/);
  assert.match(creatorScope, /if \(!added\) \{\s*throw new CatalogRuleError\(CREATOR_SCOPE_FAILED\);/, "curso que nao entrou na lista e avisado");

  const imports = bodiesOf("src/server/catalog/import-actions.ts");
  assert.match(imports.importPlaylist, /assertCreatorScopeRoom\(access\);/);
  assert.match(imports.importPlaylist, /if \(!imported\.importResult\.courseExisted\) \{\s*await addCreatedCourseToScope\(access, user\.id, courseId\);/, "curso que ja existia nunca entra na lista");
  assert.match(imports.importPlaylist, /accessModel: "closed" as const, audience: undefined/);
  assert.match(read("src/server/video/youtube-playlist-import.ts"), /supabase\.rpc\("admin_import_new_youtube_course", \{ course_import: manifest \}\)/, "importar so cria curso novo");

  for (const path of ["src/server/catalog/formation-actions.ts", "src/server/catalog/combo-actions.ts"]) {
    for (const { body, name } of exportedFunctions(read(path))) {
      assert.match(body, /runAdminAction\("catalog\.access"/, `${name}: formacoes e pacotes sao de acesso e venda`);
    }
  }

  assert.match(bodiesOf("src/server/member-area/modules-actions.ts").setProductOpensAs, /runAdminAction\("catalog\.write"[\s\S]*\{ target: \(data\) => \(\{ productIds: \[data\.productId\] \}\) \}/);

  const community = bodiesOf("src/server/community/actions.ts");
  for (const name of ["replyToComment", "resolveComment", "moderateComment", "moderateComments"]) {
    assert.match(community[name], /\{ target: \(data\) => \(\{ commentIds: /, `${name}: confere o curso do comentario`);
  }

  assert.match(read("src/server/auth/permissions.ts"), /if \(!access\.scopedActions\.has\(action\) \|\| target === "any"\) \{/, "so a acao por curso confere o alvo");
});

test("Equipe: toda acao e toda tela sao so do dono; o banco protege o ultimo dono e guarda as funcoes", () => {
  const actions = exportedFunctions(read("src/server/team/actions.ts"));
  assert.deepEqual(sorted(actions.map((entry) => entry.name)), [
    "addTeamMember",
    "createTeamFunction",
    "deleteTeamFunction",
    "removeTeamMember",
    "resendTeamInvite",
    "updateTeamFunction",
    "updateTeamMember"
  ]);

  for (const { body, name } of actions) {
    assert.match(body, /runAdminAction\("settings\.team"/, name);
    assert.match(body, /recordAudit\(db, \{/, `${name}: registra na auditoria`);
  }

  const team = bodiesOf("src/server/team/actions.ts");
  assert.match(team.deleteTeamFunction, /if \(members > 0\) \{/, "funcao em uso nao sai");
  assert.match(team.addTeamMember, /loadReferencedFunctions\(db, input\.functions\)/, "funcao personalizada citada precisa existir");
  assert.match(read("src/server/team/actions.ts"), /throw new TeamFieldError\("productIds", "Escolha pelo menos um curso\."\)/);

  for (const page of ["page.tsx", "novo/page.tsx", "[userId]/page.tsx", "funcoes/page.tsx", "funcoes/nova/page.tsx", "funcoes/[id]/page.tsx"]) {
    assert.match(read(`src/app/admin/(v2)/configuracoes/equipe/${page}`), /requirePageRole\("settings\.team", "\/admin\/configuracoes"\)/, page);
  }

  const roles2 = read("supabase/migrations/202610160001_team_roles.sql");
  assert.match(roles2, /raise exception 'last_owner'/);
  assert.match(roles2, /perform pg_advisory_xact_lock\(hashtext\('public\.admin_roles:last_owner'\)\);/);

  const functions = read("supabase/migrations/202610170001_team_functions.sql");
  assert.match(functions, /create table if not exists public\.admin_functions/);
  assert.match(functions, /alter table public\.admin_functions enable row level security;/);
  assert.match(functions, /revoke all on public\.admin_functions from anon, authenticated;/);
  assert.match(functions, /scoped_actions <@ actions/);
  assert.match(functions, /admin_functions_name_key on public\.admin_functions \(lower\(btrim\(name\)\)\)/);

  // Curso novo na lista de quem criou: um UPDATE so, linha travada, so productIds, mesmo teto do servidor.
  const appendBody = functions.slice(functions.indexOf("function public.admin_add_course_to_member_scope(p_user_id uuid, p_product_id text)"));
  assert.match(appendBody.slice(0, appendBody.indexOf("$$")), /security invoker/);
  assert.match(appendBody, /for update;/);
  assert.match(appendBody, /jsonb_array_length\(current_ids\) >= 100/);
  assert.equal(roles.MAX_SCOPED_PRODUCTS, 100);
  assert.match(appendBody, /set permissions = jsonb_set\(permissions, '\{productIds\}', current_ids \|\| to_jsonb\(p_product_id\)\)/);

  // Importar so cria curso novo: trava por playlist e confere de novo.
  const importBody = functions.slice(functions.indexOf("function public.admin_import_new_youtube_course(course_import jsonb)"));
  assert.match(importBody.slice(0, importBody.indexOf("$$")), /security invoker/);
  assert.match(importBody, /perform pg_advisory_xact_lock\(hashtext\('public\.youtube_course_imports:' \|\| playlist_id_value\)\);/);
  assert.match(importBody, /raise exception 'playlist_already_imported';/);

  for (const signature of ["admin_add_course_to_member_scope(uuid, text)", "admin_import_new_youtube_course(jsonb)"]) {
    assert.ok(functions.includes(`revoke all on function public.${signature} from public, anon, authenticated;`), signature);
    assert.ok(functions.includes(`grant execute on function public.${signature} to service_role;`), signature);
  }

  const access = read("src/server/auth/admin-access.ts");
  assert.match(access, /readCustomFunctions\(db, customFunctionIdsOf\(row\.permissions\)\)/, "a pessoa le so as funcoes que cita");
  assert.match(access, /throw new Error\(`Equipe: nao foi possivel ler as funcoes personalizadas/, "erro ao ler funcoes: sem admin, nunca com mais acesso");
  assert.doesNotMatch(access, /return new Map\(\);\s*\}\s*\}/, "erro nao vira lista vazia");
  assert.match(access, /db\.rpc\("admin_add_course_to_member_scope", \{ p_product_id: productId, p_user_id: userId \}\)/);
});

test("area do aluno: a equipe ve sem compra o que enxerga no catalogo; o Professor, os cursos dele", () => {
  const lessonAccess = read("src/server/access/lesson-access.ts");
  assert.match(lessonAccess, /loadAdminAccess\(userId, supabase\)/, "le as funcoes personalizadas tambem");
  assert.match(lessonAccess, /const isAdmin = Boolean\(staff && isProductInScope\(staff, contentId\)\);/);

  const catalog = read("src/server/access/learning-catalog.ts");
  assert.match(catalog, /loadAdminAccess\(normalizedUserId, supabase\)/);
  assert.match(catalog, /const isAdmin = Boolean\(staff && catalogScope\(staff\) === null\);/);
  assert.doesNotMatch(catalog, /!isAdmin && !isReleaseRuleSatisfied/, "liberacao: a regra de equipe e por curso");

  const store = read("src/server/db/platform-store.ts");
  assert.match(store, /canUseAccessPreview: Boolean\(adminAccess && catalogScope\(adminAccess\) === null\)/);
  assert.match(store, /return access && hasCourseScope\(access\) \? \[\.\.\.access\.courseIds\] : \[\];/);
  assert.match(store, /if \(database\.staffProductIds\?\.length\) \{/, "cursos do Professor entram como acesso liberado, sem virar compra");
});

test("Alunos nunca troca senha, convite ou dados de quem e da equipe (nem o telefone de quem nao ve dados pessoais)", () => {
  const access = read("src/server/students/access.ts");
  assert.match(access, /if \(current && \(await isStaffUser\(db, current\.id\)\)\) \{\s*if \(input\.rejectStaff\) \{\s*throw new StudentAccessError\(409, STAFF_ACCOUNT_MESSAGE\);/);
  assert.match(access, /if \(!staff\) \{\s*await upsertProfile/);

  const actions = bodiesOf("src/server/students/actions.ts");
  assert.match(actions.createStudent, /rejectStaff: true/);
  assert.match(actions.sendStudentAccessEmail, /if \(await isStaffUser\(db, account\.id\)\) \{\s*throw new StudentAccessError\(409/);
  assert.match(actions.updateStudentProfile, /if \(!can\(access, "settings\.team"\) && \(await isStaffUser\(db, input\.userId\)\)\)/);
  assert.match(actions.updateStudentProfile, /can\(access, "students\.read_personal"\) \? input\.phone : \(profile\?\.phone \?\? null\)/);

  const page = read("src/app/admin/(v2)/alunos/[id]/page.tsx");
  assert.match(page, /canSeePersonal \? loaded\.data\.detail : \{ \.\.\.loaded\.data\.detail, phone: null, timeline: \[\] \}/);

  const teamActions = bodiesOf("src/server/team/actions.ts");
  assert.match(teamActions.addTeamMember, /updateUserById\(existing\.id, \{ password: generateTemporaryPassword\(32\) \}\)/);
  assert.ok(teamActions.addTeamMember.indexOf("recordAudit(") < teamActions.addTeamMember.indexOf("sendAccessEmail("), "auditoria antes do e-mail");
  assert.match(teamActions.resendTeamInvite, /if \(account\.last_sign_in_at\) \{/);
});

test("telas: pacotes so com acesso e venda, criar so com criar curso, link de aula so para quem abre o produto", () => {
  assert.match(read("src/app/admin/(v2)/produtos/pacotes/page.tsx"), /requirePageRole\("catalog\.access", "\/admin\/produtos"\)/);
  assert.match(read("src/app/admin/(v2)/produtos/novo/page.tsx"), /if \(!can\(access, "catalog\.create"\)\) \{/);
  assert.match(read("src/app/admin/(v2)/produtos/importar/page.tsx"), /if \(!can\(access, "catalog\.create"\)\) \{/);
  assert.match(read("src/app/admin/(v2)/produtos/page.tsx"), /listProducts\(query, scope\)/);

  for (const page of ["comunidade/page.tsx", "comunidade/comentarios/page.tsx", "comunidade/denuncias/page.tsx", "comunidade/aulas/page.tsx"]) {
    assert.match(read(`src/app/admin/(v2)/${page}`), /lessonPathFor\(access, /, `${page}: "Abrir aula no admin" so para quem abre o produto`);
  }

  assert.match(read("src/server/community/scope.ts"), /canSeeAdminArea\(access, "produtos"\) && isProductInScope\(access, path\.productId\)/);
});
