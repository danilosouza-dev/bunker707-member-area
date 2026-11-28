import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Liberação "sem data" (docs/17 §1.6.5a): a equipe fecha um produto, um modulo ou uma aula com um aviso no lugar
// de uma data ("Em breve", "Em gravação" ou um texto proprio). O aluno nao abre aquele item e le o aviso onde
// leria "Liberação em 08/01"; o produto "sem data" pode ser publicado sem aula.

const notice = await import("../src/lib/content-notice.ts");
const { isReleaseRuleSatisfied, resolveReleaseState } = await import("../src/server/access/release-policy.ts");
const { getReleaseRuleNotice, pickReleaseNotice } = await import("../src/lib/release-rules.ts");
const { isMemberReleaseState } = await import("../src/lib/release-state.ts");
const model = await import("../src/server/catalog/model.ts");
const { releasePhraseSchema, updateModuleSchema, updateProductAccessSchema } = await import("../src/server/catalog/schemas.ts");
const forms = await import("../src/components/admin/v2/products/product-forms.ts");
const lessonDraft = await import("../src/components/admin/v2/content/lesson-draft.ts");

const now = Date.parse("2026-11-28T15:00:00.000Z");
const recording = { mode: "no_date", notice: { kind: "recording" } };

function stateFor(releaseRule, matchingEntitlements = []) {
  return resolveReleaseState({ completedLessonIds: new Set(), matchingEntitlements, now, releaseRule });
}

test("aviso gravado: so os tres tipos valem, e o texto proprio precisa existir", () => {
  assert.deepEqual(notice.normalizeContentNotice({ kind: "coming_soon" }), { kind: "coming_soon" });
  assert.deepEqual(notice.normalizeContentNotice({ kind: "recording", text: "sobra" }), { kind: "recording" }, "texto so acompanha o tipo proprio");
  assert.deepEqual(notice.normalizeContentNotice({ kind: "custom", text: "  Aulas em março  " }), { kind: "custom", text: "Aulas em março" });

  for (const invalid of [null, undefined, "recording", [], {}, { kind: "outro" }, { kind: "custom" }, { kind: "custom", text: "   " }, { kind: "custom", text: 7 }]) {
    assert.equal(notice.normalizeContentNotice(invalid), null, JSON.stringify(invalid));
  }

  assert.equal(notice.normalizeContentNotice({ kind: "custom", text: "x".repeat(80) }).text.length, notice.CONTENT_NOTICE_TEXT_MAX);
  assert.equal(notice.contentNoticeLabel({ kind: "coming_soon" }), "Em breve");
  assert.equal(notice.contentNoticeLabel({ kind: "recording" }), "Em gravação");
  assert.equal(notice.contentNoticeLabel({ kind: "custom", text: "Aulas em março" }), "Aulas em março");
  assert.equal(notice.noDateNoticeLabel({ kind: "lixo" }), "Em breve", "regra sem data com aviso fora do formato cai em Em breve");
  assert.equal(notice.noDateNoticeLabel(undefined), "Em breve");
});

test("servidor: sem data fica fechado para todo mundo, com ou sem acesso, com o aviso da equipe", () => {
  const comAcesso = [{ starts_at: "2020-01-01T00:00:00.000Z" }];

  assert.deepEqual(stateFor(recording), { label: "Em gravação", status: "no_date" });
  assert.deepEqual(stateFor(recording, comAcesso), { label: "Em gravação", status: "no_date" }, "acesso antigo nao abre");
  assert.deepEqual(stateFor({ mode: "no_date", notice: { kind: "custom", text: "Aulas em março" } }), { label: "Aulas em março", status: "no_date" });
  assert.deepEqual(stateFor({ mode: "no_date" }), { label: "Em breve", status: "no_date" }, "sem aviso gravado, Em breve");
  assert.equal(isMemberReleaseState(stateFor(recording)), true);
  assert.equal(
    isReleaseRuleSatisfied({ completedLessonIds: new Set(["qualquer"]), matchingEntitlements: comAcesso, now, releaseRule: recording }),
    false,
    "as APIs da aula e a IA perguntam por aqui: nunca liberado"
  );
  assert.deepEqual(stateFor({ mode: "immediate" }), { status: "released" }, "trocar a liberacao abre de novo");
});

test("aluno: o aviso entra onde entraria a data, no titulo e no selo curto", () => {
  for (const entity of ["curso", "modulo", "aula"]) {
    const shown = getReleaseRuleNotice(recording, entity, stateFor(recording), now);

    assert.equal(shown.isLocked, true);
    assert.equal(shown.kind, "no_date");
    assert.equal(shown.title, "Em gravação");
    assert.equal(shown.shortLabel, "Em gravação", "selo do card do modulo e da linha da aula");
    assert.equal(shown.detail, "Ainda sem data de liberação.");
    assert.equal(shown.availableAt, undefined, "nada promete data");
  }

  // Previa do produtor e visitante chegam sem estado (ou "unknown"): a regra sozinha da o mesmo aviso.
  assert.equal(getReleaseRuleNotice(recording, "aula", undefined, now).title, "Em gravação");
  assert.equal(getReleaseRuleNotice(recording, "aula", { status: "unknown" }, now).title, "Em gravação");
  assert.equal(getReleaseRuleNotice({ mode: "no_date", notice: { kind: "coming_soon" } }, "modulo", undefined, now).shortLabel, "Em breve");
});

test("aula com data dentro de modulo sem data: vale o sem data (o mais restritivo)", () => {
  const dated = getReleaseRuleNotice(
    { fixedDate: "2026-12-10T03:00:00.000Z", mode: "fixed_date" },
    "aula",
    { availableAt: "2026-12-10T03:00:00.000Z", precision: "day", status: "scheduled" },
    now
  );
  const noDate = getReleaseRuleNotice(recording, "modulo", stateFor(recording), now);

  assert.equal(dated.shortLabel, "Liberação em 10/12", "a liberacao por data continua como era");
  assert.equal(pickReleaseNotice([dated, noDate]).kind, "no_date");
  assert.equal(pickReleaseNotice([noDate, dated]).kind, "no_date");
});

test("admin: Sem data vai e volta da regra gravada e aparece na linha da arvore", () => {
  const phrase = { mode: "no_date", notice: { kind: "recording" } };

  assert.deepEqual(model.releasePhraseToRule(phrase), { mode: "no_date", notice: { kind: "recording" } });
  assert.deepEqual(model.releaseRuleToPhrase(model.releasePhraseToRule(phrase)), phrase);
  assert.deepEqual(
    model.releaseRuleToPhrase({ mode: "no_date", notice: { kind: "custom", text: " Aulas em março " } }),
    { mode: "no_date", notice: { kind: "custom", text: "Aulas em março" } }
  );
  assert.deepEqual(model.releaseRuleToPhrase({ mode: "no_date" }), { mode: "no_date", notice: { kind: "coming_soon" } }, "regra sem aviso abre em Em breve");
  assert.equal(model.describeReleasePhrase(phrase), "Sem data · Em gravação");
  assert.match(model.describeReleaseForStudent(phrase, "módulo"), /não abre este módulo e lê “Em gravação”/);
  assert.match(model.describeReleaseForStudent({ mode: "no_date", notice: { kind: "coming_soon" } }, "aula"), /esta aula e lê “Em breve”/);
});

test("admin: o servidor confere o aviso; Outro texto sem texto e texto longo sao recusados", () => {
  assert.deepEqual(releasePhraseSchema.parse({ mode: "no_date", notice: { kind: "recording", text: "sobra" } }), {
    mode: "no_date",
    notice: { kind: "recording" }
  });
  assert.deepEqual(releasePhraseSchema.parse({ mode: "no_date", notice: { kind: "custom", text: "  Aulas em março " } }).notice, {
    kind: "custom",
    text: "Aulas em março"
  });

  const vazio = releasePhraseSchema.safeParse({ mode: "no_date", notice: { kind: "custom", text: "   " } });
  assert.equal(vazio.success, false);
  assert.equal(vazio.error.issues[0].message, "Escreva o texto do aviso.");
  assert.equal(releasePhraseSchema.safeParse({ mode: "no_date", notice: { kind: "custom", text: "x".repeat(25) } }).success, false);
  assert.equal(releasePhraseSchema.safeParse({ mode: "no_date", notice: { kind: "outro" } }).success, false);
  assert.equal(releasePhraseSchema.safeParse({ mode: "no_date" }).success, false);

  // Os tres niveis usam o mesmo campo: modulo (e aula) pela aba Conteudo, produto pela aba Acesso e venda.
  assert.equal(updateModuleSchema.safeParse({ id: "module-1", release: { mode: "no_date", notice: { kind: "coming_soon" } } }).success, true);

  const access = updateProductAccessSchema.safeParse({
    expectedUpdatedAt: "2026-11-28T12:00:00.000Z",
    id: "formacao-ia",
    release: { mode: "no_date", notice: { kind: "custom", text: "" } }
  });
  assert.equal(forms.firstErrorsByField(access.error.issues).release, "Escreva o texto do aviso.", "o erro cai no campo Liberação");
});

test("admin: trocar so o aviso conta como mudanca; espacos nas pontas nao", () => {
  const a = { mode: "no_date", notice: { kind: "coming_soon" } };
  const custom = (text) => ({ mode: "no_date", notice: { kind: "custom", text } });

  assert.equal(forms.sameReleasePhrase(a, { mode: "no_date", notice: { kind: "coming_soon" } }), true);
  assert.equal(forms.sameReleasePhrase(a, { mode: "no_date", notice: { kind: "recording" } }), false);
  assert.equal(forms.sameReleasePhrase(a, { mode: "immediate" }), false);
  assert.equal(forms.sameReleasePhrase(custom("Aulas em março"), custom(" Aulas em março ")), true);
  assert.equal(forms.sameReleasePhrase(custom("Aulas em março"), custom("Aulas em abril")), false);

  const base = { description: "", durationLabel: "", release: a, status: "published", title: "Aula 1", videoInput: "" };
  assert.deepEqual(lessonDraft.changedFields(base, { ...base, release: { mode: "no_date", notice: { kind: "recording" } } }), ["release"]);
  assert.deepEqual(lessonDraft.changedFields(base, { ...base, release: { mode: "no_date", notice: { kind: "coming_soon" } } }), []);
});

test("publicar: produto sem data vai ao ar sem aula; sem isso, zero aulas continua bloqueando", () => {
  const base = { audience: "all_students", hasCover: true, publishedLessons: 0, publishedLessonsWithoutVideo: 0 };

  for (const format of ["formacao", "curso"]) {
    const bloqueado = model.evaluatePublishChecklist({ ...base, format });
    assert.equal(bloqueado.canPublish, false, `${format} vazio com outra liberacao continua bloqueado`);
    assert.match(bloqueado.items.find((item) => item.id === "lessons").detail, /“Sem data” em Acesso e venda › Liberação/, "o bloqueio aponta a saida");

    const semData = model.evaluatePublishChecklist({ ...base, contentNoticeLabel: "Em gravação", format });
    const lessons = semData.items.find((item) => item.id === "lessons");
    assert.equal(semData.canPublish, true, `${format} vazio e sem data publica`);
    assert.equal(lessons.state, "warning");
    assert.match(lessons.detail, /fechado, com o aviso “Em gravação”/);
  }

  assert.equal(model.evaluatePublishChecklist({ ...base, contentNoticeLabel: "   ", format: "curso" }).canPublish, false, "aviso em branco nao libera");
  assert.equal(
    model.evaluatePublishChecklist({ ...base, contentNoticeLabel: "Em breve", format: "curso", hasCover: false }).canPublish,
    false,
    "sem data nao dispensa a capa"
  );
  assert.equal(
    model.evaluatePublishChecklist({ ...base, contentNoticeLabel: "Em gravação", format: "curso", publishedLessons: 2 }).items.find((item) => item.id === "lessons").state,
    "ok"
  );
});
