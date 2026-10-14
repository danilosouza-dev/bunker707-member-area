import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras puras da area de Alunos do admin (docs/17 §1.7): ritmo, situacao do acesso, datas,
// enderecos, schemas das Server Actions e formatacao. Nada aqui toca banco ou React.

const model = await import("../src/server/students/model.ts");
const hrefs = await import("../src/components/admin/v2/students/hrefs.ts");
const schemas = await import("../src/server/students/schemas.ts");
const format = await import("../src/components/admin/v2/students/format.ts");

const DAY = 86_400_000;
const now = Date.parse("2026-10-14T15:00:00.000Z");
const daysAgo = (days) => new Date(now - days * DAY).toISOString();

test("ritmo: nunca comecou, estudando, em risco (14 dias), inativo (30 dias) e concluiu", () => {
  assert.equal(model.paceOf({ completedLessons: 0, lastStudiedAt: null, now, totalLessons: 10 }), "never_started");
  assert.equal(model.paceOf({ completedLessons: 2, lastStudiedAt: daysAgo(3), now, totalLessons: 10 }), "studying");
  assert.equal(model.paceOf({ completedLessons: 2, lastStudiedAt: daysAgo(13.9), now, totalLessons: 10 }), "studying");
  assert.equal(model.paceOf({ completedLessons: 2, lastStudiedAt: daysAgo(14), now, totalLessons: 10 }), "at_risk");
  assert.equal(model.paceOf({ completedLessons: 2, lastStudiedAt: daysAgo(29), now, totalLessons: 10 }), "at_risk");
  assert.equal(model.paceOf({ completedLessons: 2, lastStudiedAt: daysAgo(30), now, totalLessons: 10 }), "inactive");
  assert.equal(model.paceOf({ completedLessons: 10, lastStudiedAt: daysAgo(90), now, totalLessons: 10 }), "completed", "concluiu vence o tempo parado");
  assert.equal(model.paceOf({ completedLessons: 3, lastStudiedAt: daysAgo(1), now, totalLessons: 0 }), "studying", "sem aulas publicadas nao conta como concluido");
  assert.equal(model.paceOf({ completedLessons: 1, lastStudiedAt: "data-invalida", now, totalLessons: 5 }), "never_started");
  assert.equal(model.PACE_AT_RISK_DAYS, 14);
  assert.equal(model.PACE_INACTIVE_DAYS, 30);
});

test("situacao do acesso deriva de status e datas; so ativo e expirando liberam conteudo", () => {
  const base = { now, startsAt: daysAgo(10) };

  assert.equal(model.accessStateOf({ ...base, endsAt: null, status: "active" }), "active");
  assert.equal(model.accessStateOf({ ...base, endsAt: daysAgo(-12), status: "active" }), "expiring", "termina em 12 dias");
  assert.equal(model.accessStateOf({ ...base, endsAt: daysAgo(-45), status: "active" }), "active", "termina em 45 dias: ainda nao avisa");
  assert.equal(model.accessStateOf({ ...base, endsAt: daysAgo(1), status: "active" }), "expired", "ends_at no passado vale como expirado");
  assert.equal(model.accessStateOf({ ...base, endsAt: null, status: "revoked" }), "revoked");
  assert.equal(model.accessStateOf({ ...base, endsAt: null, status: "suspended" }), "suspended");
  assert.equal(model.accessStateOf({ ...base, endsAt: null, status: "expired" }), "expired");
  assert.equal(model.accessStateOf({ endsAt: null, now, startsAt: daysAgo(-2), status: "active" }), "scheduled");

  for (const state of ["active", "expiring"]) assert.equal(model.isAccessOpen(state), true, state);
  for (const state of ["scheduled", "expired", "suspended", "revoked"]) assert.equal(model.isAccessOpen(state), false, state);
});

test("datas: fim do dia no fuso da escola e extensao a partir do fim atual ou de agora", () => {
  assert.equal(model.accessEndDateToIso("2026-12-31"), "2027-01-01T02:59:59.999Z");
  assert.equal(model.accessEndDateToIso(null), null);
  assert.equal(model.accessEndDateToIso("31/12/2026"), null);

  const future = daysAgo(-10);
  assert.equal(model.extendAccessIso(future, 30, now), new Date(Date.parse(future) + 30 * DAY).toISOString(), "soma ao fim atual");
  assert.equal(model.extendAccessIso(daysAgo(5), 30, now), new Date(now + 30 * DAY).toISOString(), "fim passado: conta de agora");
  assert.equal(model.extendAccessIso(null, 90, now), new Date(now + 90 * DAY).toISOString(), "sem fim: conta de agora");
});

test("tipo do alvo do acesso segue o tipo do conteudo (mesma regra de src/server/access)", () => {
  assert.equal(model.targetTypeForContentKind("Formacao"), "formation");
  assert.equal(model.targetTypeForContentKind("Mentoria"), "mentorship");
  assert.equal(model.targetTypeForContentKind("Webinario"), "webinar");
  assert.equal(model.targetTypeForContentKind("Produto"), "product");
  assert.equal(model.targetTypeForContentKind("Bootcamp"), "bootcamp");
  assert.equal(model.targetTypeForContentKind("Curso"), "standalone_course");
});

test("textos: mensagem da senha temporaria, contagem, progresso e origem", () => {
  const message = model.temporaryPasswordMessage({ email: "ana@exemplo.com", fullName: "Ana Souza", password: "Abc12345!" });
  assert.match(message, /^Olá, Ana!/);
  assert.match(message, /E-mail: ana@exemplo\.com/);
  assert.match(message, /Senha temporária: Abc12345!/);
  assert.equal(model.describeStudentCount(1), "1 aluno");
  assert.equal(model.describeStudentCount(1200), "1.200 alunos");
  assert.equal(model.lessonsProgressLabel(3, 12), "3 de 12 aulas");
  assert.equal(model.lessonsProgressLabel(1, 1), "1 de 1 aula");
  assert.equal(model.lessonsProgressLabel(0, 0), "Sem aulas publicadas");
  assert.equal(model.progressPercentOf(3, 12), 25);
  assert.equal(model.progressPercentOf(5, 0), 0);
  assert.equal(model.progressPercentOf(20, 10), 100);
  assert.equal(model.sourceProviderLabel("manual"), "Liberado pela equipe");
  assert.equal(model.sourceProviderLabel("hotmart"), "Hotmart");
  assert.equal(model.sourceProviderLabel("desconhecido"), "desconhecido");
});

test("enderecos: filtros no endereco, pagina volta a 1 ao filtrar, perfil e adicionar", () => {
  assert.equal(hrefs.studentListHref(), "/admin/alunos");
  assert.equal(hrefs.studentListHref({ page: 3, q: "ana" }, { page: 4 }), "/admin/alunos?busca=ana&pagina=4");
  assert.equal(hrefs.studentListHref({ page: 3, q: "ana" }, { pace: "at_risk" }), "/admin/alunos?ritmo=at_risk&busca=ana", "mudar filtro volta para a pagina 1");
  assert.equal(hrefs.studentListHref({ productId: "curso-x" }, { q: "  " }), "/admin/alunos?produto=curso-x", "busca vazia sai do endereco");
  assert.equal(hrefs.studentSearchHref(" Ana Souza "), "/admin/alunos?busca=Ana+Souza");
  assert.equal(hrefs.studentSearchHref("a".repeat(200)).length, "/admin/alunos?busca=".length + hrefs.STUDENT_SEARCH_MAX_LENGTH);
  assert.equal(hrefs.studentHref("8d1f0c9e-1111-4222-8333-444455556666"), "/admin/alunos/8d1f0c9e-1111-4222-8333-444455556666");
  assert.equal(hrefs.studentHref("abc", "progresso"), "/admin/alunos/abc?aba=progresso");
  assert.equal(hrefs.studentHref("abc", "acessos"), "/admin/alunos/abc");
  assert.equal(hrefs.newStudentHref(), "/admin/alunos/novo");
  assert.equal(hrefs.newStudentHref("curso-x"), "/admin/alunos/novo?produto=curso-x");
  assert.equal(hrefs.hasActiveStudentFilters({ page: 2 }), false);
  assert.equal(hrefs.hasActiveStudentFilters({ pace: "studying" }), true);
});

test("lista: parametros do endereco viram consulta; valor estranho e ignorado", () => {
  assert.deepEqual(schemas.parseStudentListSearchParams(undefined), { page: 1, pageSize: schemas.STUDENT_LIST_PAGE_SIZE });
  assert.deepEqual(
    schemas.parseStudentListSearchParams({ busca: "  Ana ", pagina: "3", produto: "curso-x", ritmo: "inactive" }),
    { page: 3, pace: "inactive", pageSize: 25, productId: "curso-x", q: "Ana" }
  );
  assert.deepEqual(
    schemas.parseStudentListSearchParams({ pagina: "-2", produto: "../x", ritmo: "qualquer" }),
    { page: 1, pageSize: 25 }
  );
});

test("adicionar aluno: e-mail normalizado, telefone opcional, senha curta recusada, convite por padrao do formulario", () => {
  const ok = schemas.createStudentSchema.parse({
    delivery: "invite",
    email: "  Ana@Exemplo.COM ",
    fullName: "  Ana Souza ",
    phone: "",
    productIds: ["curso-x"]
  });
  assert.equal(ok.email, "ana@exemplo.com");
  assert.equal(ok.fullName, "Ana Souza");
  assert.equal(ok.phone, null);
  assert.equal(ok.temporaryPassword, null);
  assert.deepEqual(ok.productIds, ["curso-x"]);

  const short = schemas.createStudentSchema.safeParse({ delivery: "temporary_password", email: "ana@exemplo.com", fullName: "Ana", temporaryPassword: "1234567" });
  assert.equal(short.success, false);
  assert.deepEqual(short.error.issues[0].path, ["temporaryPassword"]);

  const generated = schemas.createStudentSchema.parse({ delivery: "temporary_password", email: "ana@exemplo.com", fullName: "Ana" });
  assert.equal(generated.temporaryPassword, null, "em branco = gerar no servidor");

  assert.equal(schemas.createStudentSchema.safeParse({ delivery: "invite", email: "nao-e-email", fullName: "Ana" }).success, false);
  assert.equal(schemas.studentPhoneSchema.safeParse("+55 11 99999-9999").success, true);
  assert.equal(schemas.studentPhoneSchema.safeParse("abc").success, false);
  assert.equal(schemas.createStudentSchema.safeParse({ delivery: "invite", email: "ana@exemplo.com", endsAt: "2026-13-40", fullName: "Ana" }).success, false, "data invalida");
});

test("acoes de acesso: mudar data exige a data; ids precisam ser uuid", () => {
  const user = "8d1f0c9e-1111-4222-8333-444455556666";
  const entitlement = "0f0f0f0f-2222-4333-8444-555566667777";

  assert.equal(schemas.accessActionSchema.safeParse({ action: "set_end", entitlementId: entitlement, userId: user }).success, false);
  assert.equal(schemas.accessActionSchema.safeParse({ action: "set_end", endsAt: "2027-01-31", entitlementId: entitlement, userId: user }).success, true);
  assert.equal(schemas.accessActionSchema.safeParse({ action: "revoke", entitlementId: "x", userId: user }).success, false);
  assert.equal(schemas.grantAccessSchema.safeParse({ productIds: [], userId: user }).success, false, "pelo menos um produto");
  assert.equal(schemas.deleteStudentSchema.parse({ confirmEmail: " ANA@exemplo.com", userId: user }).confirmEmail, "ana@exemplo.com");
});

test("formatacao: datas relativas, fim do acesso e tons dos chips", () => {
  assert.equal(format.formatRelativeDate(null, now), "Nunca");
  assert.equal(format.formatRelativeDate(daysAgo(0.2), now), "hoje");
  assert.equal(format.formatRelativeDate(daysAgo(1), now), "ontem");
  assert.equal(format.formatRelativeDate(daysAgo(5), now), "há 5 dias");
  assert.equal(format.formatRelativeDate(daysAgo(21), now), "há 3 semanas");
  assert.equal(format.formatRelativeDate(daysAgo(100), now), "há 3 meses");
  assert.equal(format.formatRelativeDate(daysAgo(800), now), "há 2 anos");
  assert.equal(format.formatShortDate("2026-10-14T15:00:00.000Z"), "14/10/2026");
  assert.equal(format.formatShortDate(null), "—");
  assert.equal(format.describeAccessEnd(null, now), "Sem prazo");
  assert.equal(format.describeAccessEnd(daysAgo(-1), now), "Termina amanhã");
  assert.equal(format.describeAccessEnd(daysAgo(-12), now), "Termina em 12 dias");
  assert.equal(format.describeAccessEnd(daysAgo(-60), now), `Até ${format.formatShortDate(daysAgo(-60))}`);
  assert.match(format.describeAccessEnd(daysAgo(3), now), /^Terminou há 3 dias$/);
  assert.equal(format.todayInputValue(now), "2026-10-14");
  assert.equal(format.paceTone("studying"), "success");
  assert.equal(format.paceTone("inactive"), "error");
  assert.equal(format.accessStateTone("revoked"), "error");
  assert.equal(format.accessStateTone("expiring"), "warning");
});

test("permissoes: acoes de alunos usam students.access e excluir exige dono ou administrador", async () => {
  const roles = await import("../src/server/auth/roles.ts");
  assert.deepEqual(roles.rolesFor("students.delete"), ["owner", "admin"]);
  assert.equal(roles.canRole("support", "students.access"), true);
  assert.equal(roles.canRole("support", "students.delete"), false);
});
