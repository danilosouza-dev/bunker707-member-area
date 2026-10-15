import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { actionStubs, createFakeDb } from "./support/admin-action-stubs.mjs";

// Equipe (docs/17 §2.3): funcoes prontas, Personalizado e Professor preso aos cursos dele.
// - modelo puro (textos, regras de mudanca, o que vai para o banco e para a auditoria);
// - validacao das Server Actions;
// - escopo por curso: modulo, aula e comentario resolvidos ate o produto dono, com banco falso;
// - leitura de codigo: toda acao de conteudo diz o curso tocado e toda acao de Equipe e so do dono.

const roles = await import("../src/server/auth/roles.ts");
const team = await import("../src/server/team/model.ts");
const schemas = await import("../src/server/team/schemas.ts");
const scope = await import("../src/server/auth/product-scope.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sorted = (values) => [...values].sort();
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

test("textos: cada permissao que pode ser dada aparece uma vez, e toda funcao tem descricao", () => {
  const listed = team.TEAM_PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.action));

  assert.deepEqual(sorted(listed), sorted(roles.GRANTABLE_ACTIONS));
  assert.equal(new Set(listed).size, listed.length, "sem repeticao");
  assert.deepEqual(sorted(team.TEAM_ROLE_OPTIONS), sorted(roles.ADMIN_ROLES));
  assert.equal(team.TEAM_ROLE_OPTIONS.at(-1), "owner", "Dono por ultimo no seletor");

  for (const role of roles.ADMIN_ROLES) {
    assert.ok(team.TEAM_ROLE_DESCRIPTIONS[role]?.length > 20, role);
    assert.ok(roles.ADMIN_ROLE_LABELS[role], role);
  }

  for (const action of ["students.export", "students.delete", "students.read_personal", "catalog.delete", "settings.ai"]) {
    const item = team.TEAM_PERMISSION_GROUPS.flatMap((group) => group.items).find((entry) => entry.action === action);
    assert.equal(item.sensitive, true, `${action} aparece como sensivel`);
  }
});

test("o que vai para o banco: so o que a funcao usa", () => {
  assert.deepEqual(team.storedPermissionsFor("custom", { actions: ["students.export", "catalog.content"], productIds: ["x"] }), {
    actions: ["catalog.content", "students.read_basic", "students.read_personal", "students.export"]
  });
  assert.deepEqual(team.storedPermissionsFor("instructor", { actions: ["catalog.delete"], productIds: ["a", "b", "a"] }), { productIds: ["a", "b"] });
  assert.deepEqual(team.storedPermissionsFor("support", { actions: ["catalog.delete"], productIds: ["a"] }), {});
  assert.deepEqual(team.storedPermissionsFor("owner", {}), {});
  assert.equal(team.storedPermissionsFor("instructor", { productIds: Array.from({ length: 150 }, (_, index) => `curso-${index}`) }).productIds.length, roles.MAX_SCOPED_PRODUCTS);

  // Personalizado comeca com o que a funcao anterior podia (sem equipe e vendas).
  assert.deepEqual(team.actionsOfRole("owner"), [...roles.GRANTABLE_ACTIONS]);
  assert.deepEqual(team.actionsOfRole("analyst"), ["reports.read"]);
});

test("regras de mudanca: ninguem mexe em si mesmo e a escola nunca fica sem dono", () => {
  const change = (input) => team.teamChangeError({ actorId: OWNER, ownerCount: 1, targetId: OTHER, ...input });

  assert.equal(change({ change: { from: "editor", kind: "update", to: "support" }, targetId: OWNER }), team.SELF_CHANGE_MESSAGE);
  assert.equal(change({ change: { from: "owner", kind: "remove" }, targetId: OWNER }), team.SELF_CHANGE_MESSAGE);
  assert.equal(change({ change: { from: "owner", kind: "update", to: "admin" } }), team.LAST_OWNER_MESSAGE);
  assert.equal(change({ change: { from: "owner", kind: "remove" } }), team.LAST_OWNER_MESSAGE);
  assert.equal(change({ change: { from: "owner", kind: "update", to: "admin" }, ownerCount: 2 }), null, "com dois donos, um pode virar admin");
  assert.equal(change({ change: { from: "owner", kind: "update", to: "owner" } }), null, "dono continua dono");
  assert.equal(change({ change: { from: "support", kind: "remove" } }), null);
  assert.equal(change({ change: { from: "instructor", kind: "update", to: "owner" } }), null, "o dono pode promover alguem a dono");
});

test("lista: resumo do acesso, donos primeiro e auditoria enxuta", () => {
  assert.equal(team.describeMemberAccess({ actions: [], productIds: [], role: "instructor" }), "Nenhum curso ainda");
  assert.equal(team.describeMemberAccess({ actions: [], productIds: ["a"], role: "instructor" }), "1 curso");
  assert.equal(team.describeMemberAccess({ actions: [], productIds: ["a", "b"], role: "instructor" }), "2 cursos");
  assert.equal(team.describeMemberAccess({ actions: ["students.export"], productIds: [], role: "custom" }), "3 permissões");
  assert.equal(team.describeMemberAccess({ actions: [], productIds: [], role: "support" }), "Alunos e comunidade");

  const ordered = team.sortTeamMembers([
    { fullName: "Zé", role: "editor" },
    { fullName: "Bia", role: "owner" },
    { fullName: "Ana", role: "support" }
  ]);
  assert.deepEqual(ordered.map((member) => member.fullName), ["Bia", "Ana", "Zé"]);

  const snapshot = team.teamAuditSnapshot("instructor", { productIds: Array.from({ length: 30 }, (_, index) => `curso-${index}`) });
  assert.equal(snapshot.productCount, 30);
  assert.equal(snapshot.productIds.length, 20, "no maximo 20 ids na auditoria (teto de 4 KB)");
  assert.deepEqual(team.teamAuditSnapshot("support", {}), { role: "support" });
});

test("validacao: professor precisa de curso, personalizado de permissao; e-mail normalizado", () => {
  const ok = schemas.addTeamMemberSchema.safeParse({ email: "  Pessoa@Exemplo.com ", role: "support" });
  assert.equal(ok.success, true);
  assert.equal(ok.data.email, "pessoa@exemplo.com");
  assert.deepEqual(ok.data.actions, []);

  const noCourse = schemas.addTeamMemberSchema.safeParse({ email: "p@exemplo.com", role: "instructor" });
  assert.equal(noCourse.success, false);
  assert.deepEqual(noCourse.error.issues.map((issue) => [issue.path.join("."), issue.message]), [["productIds", "Escolha pelo menos um curso."]]);

  const noAction = schemas.updateTeamMemberSchema.safeParse({ role: "custom", userId: OTHER });
  assert.equal(noAction.success, false);
  assert.equal(noAction.error.issues[0].message, "Marque pelo menos uma permissão.");

  for (const action of ["settings.team", "settings.sales", "admin.read", "catalog.destroy"]) {
    assert.equal(schemas.updateTeamMemberSchema.safeParse({ actions: [action], role: "custom", userId: OTHER }).success, false, `${action} nao pode ser marcada`);
  }

  assert.equal(schemas.addTeamMemberSchema.safeParse({ email: "p@exemplo.com", role: "root" }).success, false);
  assert.equal(schemas.teamMemberIdSchema.safeParse({ userId: "nao-e-uuid" }).success, false);
  assert.equal(schemas.addTeamMemberSchema.safeParse({ email: "p@exemplo.com", productIds: ["../segredo"], role: "instructor" }).success, false);
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
  assert.equal(await scope.resolveTargetProductIds({ lessonIds: ["id com espaco"] }), null);

  const professor = roles.resolveAdminAccess("instructor", { productIds: ["curso-a"] });
  assert.equal(roles.scopeAllows(professor, await scope.resolveTargetProductIds({ lessonIds: ["aula-a"] })), true);
  assert.equal(roles.scopeAllows(professor, await scope.resolveTargetProductIds({ lessonIds: ["aula-a", "aula-b"] })), false, "uma aula de outro curso recusa o lote");
});

/** Corpo de cada funcao exportada: do `export async function X(` ate o proximo export. */
function exportedFunctions(source) {
  const starts = [...source.matchAll(/export async function (\w+)\(/g)];

  return starts.map((match, index) => ({
    body: source.slice(match.index, index + 1 < starts.length ? starts[index + 1].index : source.length),
    name: match[1]
  }));
}

test("toda acao de conteudo diz o curso que toca (o Professor nunca alcanca outro curso)", () => {
  const content = exportedFunctions(read("src/server/catalog/content-actions.ts"));
  assert.ok(content.length >= 9);

  for (const { body, name } of content) {
    assert.match(body, /runAdminAction\("catalog\.content"/, `${name}: modulos e aulas usam catalog.content`);
    assert.match(body, /\{ target: /, `${name}: precisa dizer o curso tocado`);
  }

  assert.match(read("src/server/catalog/module-cover-actions.ts"), /\{ target: \(data\) => \(\{ moduleIds: \[data\.moduleId\] \}\) \}/);

  const community = Object.fromEntries(exportedFunctions(read("src/server/community/actions.ts")).map((entry) => [entry.name, entry.body]));
  for (const name of ["replyToComment", "resolveComment", "moderateComment", "moderateComments"]) {
    assert.match(community[name], /\{ target: \(data\) => \(\{ commentIds: /, `${name}: confere o curso do comentario`);
  }
  for (const name of ["saveQuickReply", "deleteQuickReply"]) {
    assert.doesNotMatch(community[name], /target:/, `${name}: vale para a escola toda (quem tem escopo e recusado)`);
  }

  // Acoes do produto em si continuam catalog.write (o Professor nao tem).
  for (const { body, name } of exportedFunctions(read("src/server/catalog/product-actions.ts"))) {
    assert.match(body, /runAdminAction\("catalog\.(write|publish|delete)"/, name);
  }
});

test("Equipe: toda acao e toda tela sao so do dono; o banco protege o ultimo dono", () => {
  const actions = exportedFunctions(read("src/server/team/actions.ts"));
  assert.deepEqual(sorted(actions.map((entry) => entry.name)), ["addTeamMember", "removeTeamMember", "resendTeamInvite", "updateTeamMember"]);

  for (const { body, name } of actions) {
    assert.match(body, /runAdminAction\("settings\.team"/, name);
    assert.match(body, /recordAudit\(db, \{/, `${name}: registra na auditoria`);
  }

  for (const page of ["page.tsx", "novo/page.tsx", "[userId]/page.tsx"]) {
    assert.match(read(`src/app/admin/(v2)/configuracoes/equipe/${page}`), /requirePageRole\("settings\.team", "\/admin\/configuracoes"\)/, page);
  }

  const migration = read("supabase/migrations/202610160001_team_roles.sql");
  assert.match(migration, /check \(role in \('owner', 'admin', 'editor', 'instructor', 'support', 'analyst', 'custom'\)\)/);
  assert.match(migration, /raise exception 'last_owner'/);
  assert.match(migration, /perform pg_advisory_xact_lock\(hashtext\('public\.admin_roles:last_owner'\)\);/, "enfileira antes de contar (sem deadlock)");
  assert.match(migration, /before update of role or delete on public\.admin_roles/);
  assert.match(migration, /revoke insert, update, delete on public\.admin_roles from anon, authenticated;/);
  assert.match(read("src/server/team/store.ts"), /error\.message\?\.includes\("last_owner"\)/, "o erro do banco vira a frase do produtor");
});

test("area do aluno: a equipe ve tudo sem compra, mas o Professor so os cursos dele", () => {
  const lessonAccess = read("src/server/access/lesson-access.ts");
  assert.match(lessonAccess, /\.select\("role, permissions"\)/);
  assert.match(lessonAccess, /const isAdmin = Boolean\(staff && isProductInScope\(staff, contentId\)\);/);

  const catalog = read("src/server/access/learning-catalog.ts");
  assert.match(catalog, /select\("role, permissions"\)/);
  assert.match(catalog, /const staffSees = \(contentId: string\) => Boolean\(staff && isProductInScope\(staff, contentId\)\);/);
  assert.doesNotMatch(catalog, /!isAdmin && !isReleaseRuleSatisfied/, "liberacao por tempo/aula: a regra de equipe e por curso");

  // "Ver como aluno com acesso" mostraria tudo aberto: so para a equipe da escola toda.
  assert.match(read("src/server/db/platform-store.ts"), /canUseAccessPreview: Boolean\(adminAccess && adminAccess\.productIds === null\)/);

  const professor = roles.resolveAdminAccess("instructor", { productIds: ["curso-a"] });
  assert.equal(roles.isProductInScope(professor, "curso-a"), true);
  assert.equal(roles.isProductInScope(professor, "curso-b"), false);
  assert.equal(roles.isProductInScope(roles.resolveAdminAccess("support", {}), "curso-b"), true);
});

test("Alunos nunca troca senha, convite ou dados de quem e da equipe (nem o telefone de quem nao ve dados pessoais)", () => {
  const access = read("src/server/students/access.ts");
  assert.match(access, /if \(current && \(await isStaffUser\(db, current\.id\)\)\) \{\s*if \(input\.rejectStaff\) \{\s*throw new StudentAccessError\(409, STAFF_ACCOUNT_MESSAGE\);/);
  assert.match(access, /return \{ existing: true, staff: true, user: current \};/, "venda futura: so ganha o acesso, sem mexer na senha");
  assert.match(access, /if \(!staff\) \{\s*await upsertProfile/, "nome e telefone da equipe ficam como estao");

  const actions = Object.fromEntries(exportedFunctions(read("src/server/students/actions.ts")).map((entry) => [entry.name, entry.body]));
  assert.match(actions.createStudent, /rejectStaff: true/, "Adicionar aluno recusa e-mail da equipe (senha temporaria do dono)");
  assert.match(actions.sendStudentAccessEmail, /if \(await isStaffUser\(db, account\.id\)\) \{\s*throw new StudentAccessError\(409/);
  assert.match(actions.updateStudentProfile, /if \(!can\(access, "settings\.team"\) && \(await isStaffUser\(db, input\.userId\)\)\)/, "so o dono muda dados da equipe");
  assert.match(actions.updateStudentProfile, /can\(access, "students\.read_personal"\) \? input\.phone : \(profile\?\.phone \?\? null\)/, "sem dados pessoais, o telefone gravado fica");

  const page = read("src/app/admin/(v2)/alunos/[id]/page.tsx");
  assert.match(page, /canSeePersonal \? loaded\.data\.detail : \{ \.\.\.loaded\.data\.detail, phone: null, timeline: \[\] \}/, "telefone e historico nem saem do servidor");

  const team = Object.fromEntries(exportedFunctions(read("src/server/team/actions.ts")).map((entry) => [entry.name, entry.body]));
  assert.match(team.addTeamMember, /updateUserById\(existing\.id, \{ password: generateTemporaryPassword\(32\) \}\)/, "senha temporaria antiga deixa de valer");
  assert.ok(team.addTeamMember.indexOf("recordAudit(") < team.addTeamMember.indexOf("sendAccessEmail("), "auditoria antes do e-mail");
  assert.match(team.resendTeamInvite, /if \(account\.last_sign_in_at\) \{/, "convite de novo so para quem nunca entrou");
});

test("Professor: pacotes fora, cursos dele abertos na area do aluno, link de aula so para quem abre o produto", () => {
  assert.match(read("src/app/admin/(v2)/produtos/pacotes/page.tsx"), /requirePageRole\("catalog\.write", "\/admin\/produtos"\)/);

  const store = read("src/server/db/platform-store.ts");
  assert.match(store, /const \[database, staffProductIds\] = await Promise\.all\(\[/);
  assert.match(store, /if \(database\.staffProductIds\?\.length\) \{/, "cursos do Professor entram como acesso liberado, sem virar compra");

  for (const page of ["comunidade/page.tsx", "comunidade/comentarios/page.tsx", "comunidade/denuncias/page.tsx", "comunidade/aulas/page.tsx"]) {
    assert.match(read(`src/app/admin/(v2)/${page}`), /lessonPathFor\(access, /, `${page}: Suporte nao ve "Abrir aula no admin"`);
  }
});
