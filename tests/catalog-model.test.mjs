import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

const model = await import("../src/server/catalog/model.ts");
const { CATALOG_TAG, planCatalogInvalidation } = await import("../src/server/catalog/cache-policy.ts");

test("formato <-> kind preserva os tipos gravados (Produto = Material, Webinario = Gravacao de live)", () => {
  for (const format of model.PRODUCT_FORMATS) {
    assert.equal(model.formatFromKind(model.kindForFormat(format)), format, format);
  }

  assert.equal(model.kindForFormat("material"), "Produto");
  assert.equal(model.kindForFormat("gravacao_live"), "Webinario");
  assert.equal(model.formatFromKind("Material"), "material");
  assert.equal(model.formatFromKind("Aula"), null);
  assert.equal(model.formatFromKind(undefined), null);
  assert.equal(model.PRODUCT_FORMAT_LABELS.formacao, "Formação");
  assert.ok(!model.CREATABLE_PRODUCT_FORMATS.includes("gravacao_live"), "Gravacao de live nao aparece em Novo produto");
});

test("quem pode ver: tres opcoes ida e volta pelas colunas", () => {
  for (const audience of model.PRODUCT_AUDIENCES) {
    const columns = model.audienceToColumns(audience);
    assert.equal(
      model.audienceFromColumns({ accessModel: columns.access_model, listing: columns.listing }),
      audience,
      audience
    );
  }

  assert.deepEqual(model.audienceToColumns("hidden"), { access_model: "closed", is_locked: true, listing: "hidden" });
  assert.deepEqual(model.audienceToColumns("all_students"), { access_model: "free", is_locked: false, listing: "listed" });
  assert.equal(model.audienceFromColumns({ accessModel: null, listing: null }), "with_access", "legado sem colunas = fechado");
  assert.equal(model.audienceFromColumns({ accessModel: "free", listing: "hidden" }), "hidden", "oculto vence");
});

test("oculto some da vitrine e so aparece para quem tem acesso", () => {
  assert.equal(model.isListedInStorefront({ listing: "listed" }), true);
  assert.equal(model.isListedInStorefront({}), true, "linha antiga sem a coluna continua listada");
  assert.equal(model.isListedInStorefront({ listing: "hidden" }), false);
  assert.equal(model.canSeeProduct({ listing: "hidden" }, true), true);
  assert.equal(model.canSeeProduct({ listing: "hidden" }, false), false);
  assert.equal(model.canSeeProduct({ listing: "listed" }, false), true);
});

test("campos legados derivados nunca escondem o produto de quem comprou", () => {
  assert.equal(model.deriveLegacyContentStatus("with_access"), "Bloqueado");
  assert.equal(model.deriveLegacyContentStatus("hidden"), "Bloqueado");
  assert.equal(model.deriveLegacyContentStatus("all_students"), "Liberado");
  assert.equal(model.deriveLegacyPurchaseLabel({ audience: "with_access", purchaseUrl: "https://pay.hotmart.com/x" }), "Comprar");
  assert.equal(model.deriveLegacyPurchaseLabel({ audience: "with_access", purchaseUrl: "" }), null);
  assert.equal(model.deriveLegacyPurchaseLabel({ audience: "all_students", purchaseUrl: "https://x.com" }), null);
  assert.equal(model.deriveLegacyPurchaseLabel({ audience: "with_access", purchaseLabel: " Quero entrar ", purchaseUrl: "" }), "Quero entrar");
});

test("Em breve e Novo sao calculados", () => {
  assert.equal(model.isComingSoonForVisitors({ audience: "with_access", purchaseUrl: "", situation: "published" }), true);
  assert.equal(model.isComingSoonForVisitors({ audience: "with_access", purchaseUrl: "https://x.com", situation: "published" }), false);
  assert.equal(model.isComingSoonForVisitors({ audience: "with_access", purchaseUrl: null, situation: "draft" }), false);
  assert.equal(model.isComingSoonForVisitors({ audience: "all_students", purchaseUrl: null, situation: "published" }), false);

  const now = new Date("2026-10-10T12:00:00Z");
  assert.equal(model.isNewProduct("2026-10-01T12:00:00Z", now), true);
  assert.equal(model.isNewProduct("2026-09-20T12:00:00Z", now), false);
  assert.equal(model.isNewProduct("2026-10-20T12:00:00Z", now), false, "data futura nao e Novo");
  assert.equal(model.isNewProduct(null, now), false);
  assert.equal(model.situationFromPublicationStatus("draft"), "draft");
  assert.equal(model.situationFromPublicationStatus(null), "published");
});

test("bucket, prefixo e id seguem o leitor atual do aluno", () => {
  assert.equal(model.bucketForProduct("formacao"), "formations");
  assert.equal(model.bucketForProduct("bootcamp"), "bootcamps");
  assert.equal(model.bucketForProduct("curso", "included_content"), "formation_internal_courses");
  assert.equal(model.bucketForProduct("material"), "courses");
  assert.equal(model.idPrefixForProduct("curso", "included_content"), "formation-course");
  assert.equal(model.idPrefixForProduct("material"), "product");

  assert.equal(model.slugifyTitle("  Formação IA: Agentes & Automação!  "), "formacao-ia-agentes-automacao");
  assert.equal(model.makeCatalogId("course", "Prompts do Zero", 1_760_000_000_000), `course-prompts-do-zero-${(1_760_000_000_000).toString(36)}`);
  assert.equal(model.makeCatalogId("course", "!!!", 35), "course-z", "sem slug: so prefixo e tempo");
  assert.match(model.makeCatalogId("course", "a".repeat(200), 1), /^course-a{48}-1$/);
  assert.match(model.makeCatalogId("lesson", "Aula 1"), /^lesson-aula-1-[0-9a-z]+$/);
});

test("aula nova: publicada em produto rascunho, rascunho em produto ja publicado", () => {
  assert.equal(model.initialLessonStatus("draft"), "published");
  assert.equal(model.initialLessonStatus("published"), "draft");
  assert.equal(model.initialLessonStatus("archived"), "draft");
  assert.equal(model.isRestorableStatus("published"), true);
  assert.equal(model.isRestorableStatus("deleted"), false);
});

test("colar varias linhas cria varias aulas, com ou sem link", () => {
  const pasted = model.parseLessonPaste([
    "Boas-vindas | https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "",
    "   https://vimeo.com/123456789   ",
    "Só o título",
    "Título com | barra no meio",
    '<iframe src="https://iframe.mediadelivery.net/embed/1/abc-def"></iframe>'
  ].join("\r\n"));

  assert.deepEqual(pasted, [
    { title: "Boas-vindas", videoInput: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { title: "", videoInput: "https://vimeo.com/123456789" },
    { title: "Só o título" },
    { title: "Título com | barra no meio" },
    { title: "", videoInput: '<iframe src="https://iframe.mediadelivery.net/embed/1/abc-def"></iframe>' }
  ]);
  assert.deepEqual(model.parseLessonPaste("   \n  "), []);
});

test("liberacao em frases: after_enrollment e after_purchase viram 'depois de ganhar acesso'", () => {
  assert.deepEqual(model.releaseRuleToPhrase(undefined), { mode: "immediate" });
  assert.deepEqual(model.releaseRuleToPhrase({ mode: "immediate" }), { mode: "immediate" });
  assert.deepEqual(model.releaseRuleToPhrase({ delayValue: "7", mode: "after_purchase" }), { amount: 7, mode: "after_access", unit: "dias" });
  assert.deepEqual(model.releaseRuleToPhrase({ delayUnit: "horas", delayValue: "12", mode: "after_enrollment" }), {
    amount: 12,
    mode: "after_access",
    unit: "horas"
  });
  assert.deepEqual(model.releaseRuleToPhrase({ delayValue: "0", mode: "after_enrollment" }), { mode: "immediate" });
  assert.deepEqual(model.releaseRuleToPhrase({ delayValue: "abc", mode: "after_enrollment" }), { mode: "immediate" });
  assert.deepEqual(model.releaseRuleToPhrase({ fixedDate: "2026-11-14T03:00:00.000Z", mode: "fixed_date" }), {
    date: "2026-11-14T03:00:00.000Z",
    mode: "fixed_date"
  });
  assert.deepEqual(model.releaseRuleToPhrase({ mode: "fixed_date" }), { mode: "immediate" });
  assert.deepEqual(model.releaseRuleToPhrase({ mode: "activity_required" }), { mode: "immediate" });

  assert.equal(model.releasePhraseToRule({ mode: "immediate" }), null);
  assert.deepEqual(model.releasePhraseToRule({ amount: 7, mode: "after_access", unit: "dias" }), {
    delayUnit: "dias",
    delayValue: "7",
    mode: "after_enrollment"
  });
  assert.deepEqual(model.releasePhraseToRule({ mode: "after_previous_lesson" }), { mode: "after_previous_lesson" });

  for (const phrase of [
    { mode: "immediate" },
    { amount: 3, mode: "after_access", unit: "dias" },
    { date: "2026-11-14T03:00:00.000Z", mode: "fixed_date" },
    { mode: "after_previous_lesson" }
  ]) {
    assert.deepEqual(model.releaseRuleToPhrase(model.releasePhraseToRule(phrase)), phrase, phrase.mode);
  }

  assert.equal(model.describeReleasePhrase({ mode: "immediate" }), "Libera na hora");
  assert.equal(model.describeReleasePhrase({ amount: 7, mode: "after_access", unit: "dias" }), "Libera 7 dias depois do acesso");
  assert.equal(model.describeReleasePhrase({ amount: 1, mode: "after_access", unit: "dias" }), "Libera 1 dia depois do acesso");
  assert.equal(model.describeReleasePhrase({ date: "2026-11-14T15:00:00.000Z", mode: "fixed_date" }), "Libera em 14/11/2026");
  assert.equal(model.describeReleasePhrase({ mode: "after_previous_lesson" }), "Libera depois da aula anterior");
});

test("previa da liberacao em frase completa e datas em Sao Paulo", () => {
  assert.equal(model.describeReleaseForStudent({ mode: "immediate" }, "aula"), "O aluno verá esta aula assim que ganhar acesso.");
  assert.equal(
    model.describeReleaseForStudent({ amount: 7, mode: "after_access", unit: "dias" }, "aula"),
    "O aluno verá esta aula 7 dias depois de ganhar acesso."
  );
  assert.equal(
    model.describeReleaseForStudent({ date: "2026-11-14T03:00:00.000Z", mode: "fixed_date" }, "módulo"),
    "O aluno verá este módulo a partir de 14/11/2026."
  );
  assert.equal(model.releaseDateInputToIso("2026-11-14"), "2026-11-14T03:00:00.000Z");
  assert.equal(model.releaseDateInputToIso("14/11/2026"), null);
  assert.equal(model.releaseIsoToDateInput("2026-11-14T03:00:00.000Z"), "2026-11-14");
  assert.equal(model.releaseIsoToDateInput("2026-11-14T02:59:00.000Z"), "2026-11-13", "23h59 em Sao Paulo ainda e dia 13");
  assert.equal(model.releaseIsoToDateInput("lixo"), "");
});

test("checklist de publicar: so capa e zero aulas bloqueiam", () => {
  const ready = model.evaluatePublishChecklist({
    audience: "with_access",
    format: "curso",
    hasCover: true,
    publishedLessons: 3,
    publishedLessonsWithoutVideo: 0,
    purchaseUrl: "https://pay.hotmart.com/x"
  });
  assert.equal(ready.canPublish, true);
  assert.ok(ready.items.every((item) => item.state === "ok"));

  const warnings = model.evaluatePublishChecklist({
    audience: "with_access",
    format: "curso",
    hasCover: true,
    publishedLessons: 1,
    publishedLessonsWithoutVideo: 1,
    purchaseUrl: ""
  });
  assert.equal(warnings.canPublish, true, "aviso nao bloqueia");
  assert.deepEqual(
    warnings.items.filter((item) => item.state === "warning").map((item) => item.id),
    ["videos", "purchase_url"]
  );

  const blocked = model.evaluatePublishChecklist({
    audience: "all_students",
    format: "formacao",
    hasCover: false,
    publishedLessons: 0,
    publishedLessonsWithoutVideo: 0
  });
  assert.equal(blocked.canPublish, false);
  assert.deepEqual(blocked.items.filter((item) => item.state === "blocker").map((item) => item.id), ["cover", "lessons"]);
  assert.match(blocked.items.find((item) => item.id === "lessons").detail, /curso desta formação/);
  assert.equal(blocked.items.some((item) => item.id === "purchase_url"), false, "aberto a todos nao pede link");
});

test("cor do produto: gravada quando valida, senao estavel pelo id", () => {
  assert.equal(model.resolveProductAccent("qualquer", "roxo"), "roxo");
  assert.equal(model.resolveProductAccent("curso-a", "vermelho"), model.resolveProductAccent("curso-a"));
  assert.equal(model.resolveProductAccent("curso-a"), model.resolveProductAccent("curso-a"));
  assert.ok(model.PRODUCT_ACCENT_ORDER.includes(model.resolveProductAccent("outro-id")));
  assert.equal(model.isProductAccent("toString"), false);
  assert.equal(Object.values(model.PRODUCT_ACCENTS).some((hex) => /e50914/i.test(hex)), false, "nunca o vermelho da marca");
});

test("cache do catalogo: updateTag em Server Action, revalidateTag 'max' fora dela", () => {
  assert.equal(CATALOG_TAG, "catalog");
  assert.deepEqual(planCatalogInvalidation("action"), { api: "updateTag", tag: "catalog" });
  assert.deepEqual(planCatalogInvalidation("route"), { api: "revalidateTag", profile: "max", tag: "catalog" });
  assert.throws(() => planCatalogInvalidation("job"), /desconhecida/);
});
