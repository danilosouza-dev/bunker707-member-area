import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras puras da UI de Produtos (frente B): recorte de imagem, filtros da lista, organizacao da
// playlist e montagem dos pedidos das abas Detalhes e Acesso e venda.

const crop = await import("../src/components/admin/v2/products/cover-crop.ts");
const filters = await import("../src/components/admin/v2/products/list-filters.ts");
const ranges = await import("../src/components/admin/v2/products/playlist-ranges.ts");
const forms = await import("../src/components/admin/v2/products/product-forms.ts");
const { updateProductAccessSchema, updateProductDetailsSchema, webpDataUrlSchema } = await import("../src/server/catalog/schemas.ts");

const cover = crop.IMAGE_SPECS.cover;
const coverLarge = crop.IMAGE_SPECS.coverLarge;
const hero = crop.IMAGE_SPECS.hero;

function webpDataUrl(bytes) {
  return `data:image/webp;base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`;
}

test("especificacoes de imagem: saida e minimo na mesma proporcao", () => {
  // Thumbnail do card: tamanho anterior (9:13) ou 284 x 426 (2:3), escolhido no cadastro do produto (13/10/2026).
  assert.deepEqual([cover.outputWidth, cover.outputHeight], [720, 1040]);
  assert.deepEqual([cover.minWidth, cover.minHeight], [540, 780]);
  assert.deepEqual([coverLarge.outputWidth, coverLarge.outputHeight], [284, 426]);
  assert.deepEqual([coverLarge.minWidth, coverLarge.minHeight], [284, 426], "284 x 426 sai no tamanho exato: a origem precisa ter pelo menos isso");
  assert.deepEqual([hero.outputWidth, hero.outputHeight], [1920, 720]);
  assert.deepEqual([cover.ratioLabel, coverLarge.ratioLabel, hero.ratioLabel], ["9:13", "2:3", "8:3"]);

  for (const spec of [cover, coverLarge, hero]) {
    assert.ok(Math.abs(spec.minWidth / spec.minHeight - spec.outputWidth / spec.outputHeight) < 0.001, spec.label);
  }
});

test("recusa origem pequena com a frase do tamanho minimo", () => {
  assert.equal(crop.describeSourceSizeProblem({ height: 780, width: 540 }, cover), null);
  assert.equal(crop.describeSourceSizeProblem({ height: 4000, width: 3000 }, cover), null);
  assert.equal(
    crop.describeSourceSizeProblem({ height: 426, width: 284 }, cover),
    "Esta imagem tem 284×426 px. Use uma imagem a partir de 540×780 px.",
    "284 x 426 so serve no tamanho 284 x 426 do cadastro"
  );
  assert.match(crop.describeSourceSizeProblem({ height: 1000, width: 539 }, cover), /a partir de 540×780/);
  assert.equal(crop.describeSourceSizeProblem({ height: 426, width: 284 }, coverLarge), null);
  assert.equal(crop.describeSourceSizeProblem({ height: 4000, width: 3000 }, coverLarge), null);
  assert.equal(
    crop.describeSourceSizeProblem({ height: 300, width: 200 }, coverLarge),
    "Esta imagem tem 200×300 px. Use uma imagem a partir de 284×426 px."
  );
  assert.match(crop.describeSourceSizeProblem({ height: 1000, width: 283 }, coverLarge), /a partir de 284×426/);
  assert.match(crop.describeSourceSizeProblem({ height: 0, width: 0 }, cover), /Não conseguimos ler/);
  assert.match(crop.describeSourceSizeProblem({ height: 720, width: 1280 }, hero), /a partir de 1440×540/);
});

test("recorte base ocupa o maximo da imagem na proporcao do slot (9:13 ou 2:3)", () => {
  // Paisagem: altura inteira.
  const wide = crop.baseCropSize({ height: 1300, width: 2000 }, cover);
  assert.equal(wide.height, 1300);
  assert.equal(Math.round(wide.width), 900);
  // Retrato estreito: largura inteira.
  const narrow = crop.baseCropSize({ height: 3000, width: 900 }, cover);
  assert.equal(narrow.width, 900);
  assert.equal(Math.round(narrow.height), 1300);

  const initial = crop.initialCropState({ height: 1300, width: 2000 }, cover);
  const rect = crop.cropRect({ height: 1300, width: 2000 }, cover, initial);
  assert.equal(rect.height, 1300);
  assert.equal(Math.round(rect.width), 900);
  assert.deepEqual([Math.round(rect.x), rect.y], [550, 0]);

  // 284 x 426 recorta em 2:3.
  const wideLarge = crop.baseCropSize({ height: 1300, width: 2000 }, coverLarge);
  assert.deepEqual([wideLarge.height, Math.round(wideLarge.width)], [1300, 867]);
  const rectLarge = crop.cropRect({ height: 1300, width: 2000 }, coverLarge, crop.initialCropState({ height: 1300, width: 2000 }, coverLarge));
  assert.deepEqual([Math.round(rectLarge.x), rectLarge.y], [567, 0]);
});

test("saida nunca amplia: imagem pequena sai no tamanho dela, grande sai no tamanho do slot", () => {
  assert.deepEqual(crop.outputSizeFor({ width: 540 }, cover), { height: 780, width: 540 });
  assert.deepEqual(crop.outputSizeFor({ width: 2000 }, cover), { height: 1040, width: 720 });
  assert.deepEqual(crop.outputSizeFor({ width: 720 }, cover), { height: 1040, width: 720 });
  assert.deepEqual(crop.outputSizeFor({ width: 284 }, coverLarge), { height: 426, width: 284 });
  assert.deepEqual(crop.outputSizeFor({ width: 2000 }, coverLarge), { height: 426, width: 284 });
});

test("zoom nunca deixa o recorte com menos pixels que o minimo", () => {
  assert.equal(crop.maxZoomFor({ height: 780, width: 540 }, cover), 1, "imagem no limite nao tem zoom");
  assert.equal(crop.maxZoomFor({ height: 1560, width: 1080 }, cover), 2);
  assert.equal(crop.maxZoomFor({ height: 26000, width: 18000 }, cover), crop.MAX_ZOOM_CAP);
  assert.equal(crop.maxZoomFor({ height: 426, width: 284 }, coverLarge), 1, "284 x 426 exato nao tem zoom");
  assert.equal(crop.maxZoomFor({ height: 852, width: 568 }, coverLarge), 2);

  const source = { height: 2340, width: 1620 };
  const zoomed = crop.zoomCrop(source, cover, crop.initialCropState(source, cover), 10);
  assert.equal(zoomed.zoom, 3);
  const rect = crop.cropRect(source, cover, zoomed);
  assert.equal(rect.width, 540);
  assert.equal(rect.height, 780);
  assert.deepEqual([rect.x, rect.y], [540, 780], "zoom mantem o centro");
});

test("arrastar move o recorte e para nas bordas da imagem", () => {
  const source = { height: 1300, width: 2000 };
  const start = crop.initialCropState(source, cover);

  const right = crop.panCrop(source, cover, start, 10_000, 0);
  assert.equal(Math.round(crop.cropRect(source, cover, right).x), 1100, "encosta na borda direita");

  const left = crop.panCrop(source, cover, start, -10_000, 50);
  const leftRect = crop.cropRect(source, cover, left);
  assert.equal(leftRect.x, 0);
  assert.equal(leftRect.y, 0, "sem zoom nao ha folga vertical");

  const garbage = crop.clampCropState(source, cover, { centerX: Number.NaN, centerY: Number.NaN, zoom: Number.NaN });
  assert.deepEqual(garbage, start, "valor invalido volta ao centro sem zoom");
});

test("escolha da qualidade: primeira que cabe em 150 KB, depois a menor aceita pelo servidor", () => {
  const big = webpDataUrl(200 * 1024);
  const medium = webpDataUrl(160 * 1024);
  const small = webpDataUrl(140 * 1024);

  assert.ok(crop.dataUrlByteLength(small) >= 140 * 1024 && crop.dataUrlByteLength(small) <= 140 * 1024 + 3);
  assert.deepEqual(crop.chooseEncodedImage([big, medium, small]), { dataUrl: small, ok: true });
  assert.deepEqual(crop.chooseEncodedImage([big, medium]), { dataUrl: medium, ok: true }, "medium cabe no limite de texto");
  assert.deepEqual(crop.chooseEncodedImage([webpDataUrl(400 * 1024)]), { error: "too_large", ok: false });
  assert.deepEqual(crop.chooseEncodedImage(["data:image/png;base64,AAAA"]), { error: "unsupported", ok: false });
  assert.deepEqual(crop.chooseEncodedImage([]), { error: "unsupported", ok: false });
  assert.match(crop.describeEncodingProblem("unsupported"), /WebP/);

  // O que a tela entrega passa no schema do servidor.
  assert.equal(webpDataUrlSchema.safeParse(medium).success, true);
  assert.equal(crop.MAX_IMAGE_DATA_URL_LENGTH, 300_000);
});

test("endereco da lista: filtros com os nomes que o servidor le e volta para a pagina 1", () => {
  assert.equal(filters.buildProductListHref({}), "/admin/produtos");
  assert.equal(
    filters.buildProductListHref({ page: 3, situation: "draft" }, { format: "curso" }),
    "/admin/produtos?situacao=draft&formato=curso"
  );
  assert.equal(filters.buildProductListHref({ q: "ia", situation: "draft" }, { page: 2 }), "/admin/produtos?situacao=draft&busca=ia&pagina=2");
  assert.equal(filters.buildProductListHref({ page: 4, q: "ia" }, { q: "  " }), "/admin/produtos");
  assert.equal(filters.buildProductListHref({ situation: "published" }, { situation: undefined }), "/admin/produtos");
  assert.equal(filters.buildProductListHref({ page: 1 }, { page: 1 }), "/admin/produtos");
  assert.equal(filters.buildProductListHref({}, { q: "Prompts & IA" }), "/admin/produtos?busca=Prompts+%26+IA");

  assert.equal(filters.hasActiveProductFilters({ page: 3 }), false);
  assert.equal(filters.hasActiveProductFilters({ q: " x " }), true);
  assert.deepEqual(filters.SITUATION_FILTERS.map((option) => option.label), ["Todos", "Rascunho", "Publicado", "Arquivado"]);
});

test("o endereco montado volta igual pelo parser do servidor", async () => {
  const { parseProductListSearchParams } = await import("../src/server/catalog/schemas.ts");
  const href = filters.buildProductListHref({ format: "mentoria", page: 2, q: "agentes", situation: "archived" }, { page: 2 });
  const params = Object.fromEntries(new URL(href, "https://admin.local").searchParams);

  assert.deepEqual(parseProductListSearchParams(params), { format: "mentoria", page: 2, q: "agentes", situation: "archived" });
});

test("contagem, paginas e tempo relativo em pt-BR", () => {
  assert.equal(filters.describeProductCount(1), "1 produto");
  assert.equal(filters.describeProductCount(1200), "1.200 produtos");
  assert.equal(filters.describePageRange(1, 25, 80), "1–25 de 80");
  assert.equal(filters.describePageRange(4, 25, 80), "76–80 de 80");
  assert.equal(filters.describePageRange(1, 25, 0), "0 de 0");
  assert.equal(filters.pageCount(80, 25), 4);
  assert.equal(filters.pageCount(0, 25), 1);

  const now = new Date("2026-10-10T15:00:00Z");
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();
  assert.equal(filters.formatRelativeUpdated(ago(20_000), now), "agora mesmo");
  assert.equal(filters.formatRelativeUpdated(ago(5 * 60_000), now), "há 5 min");
  assert.equal(filters.formatRelativeUpdated(ago(60 * 60_000), now), "há 1 hora");
  assert.equal(filters.formatRelativeUpdated(ago(5 * 3_600_000), now), "há 5 horas");
  assert.equal(filters.formatRelativeUpdated(ago(30 * 3_600_000), now), "ontem");
  assert.equal(filters.formatRelativeUpdated(ago(3 * 86_400_000), now), "há 3 dias");
  assert.equal(filters.formatRelativeUpdated(ago(8 * 86_400_000), now), "há 1 semana");
  assert.equal(filters.formatRelativeUpdated(ago(20 * 86_400_000), now), "há 2 semanas");
  assert.equal(filters.formatRelativeUpdated(ago(70 * 86_400_000), now), "há 2 meses");
  assert.equal(filters.formatRelativeUpdated(ago(400 * 86_400_000), now), "há 1 ano");
  assert.equal(filters.formatRelativeUpdated(new Date(now.getTime() + 60_000).toISOString(), now), "agora mesmo");
  assert.equal(filters.formatRelativeUpdated("lixo", now), "—");
  assert.equal(filters.formatFullDateTime("2026-10-10T17:32:00Z"), "10/10/2026 às 14:32");
});

test("playlist: adicionar modulo cobre o que falta e depois divide o ultimo", () => {
  const videos = [1, 2, 3, 4, 5, 6].map((position) => ({ position }));

  assert.deepEqual(ranges.singleModuleRange(videos), [{ endPosition: 6, startPosition: 1, title: "Conteúdo do curso" }]);
  assert.deepEqual(ranges.singleModuleRange([]), []);

  const partial = [{ endPosition: 2, startPosition: 1, title: "Módulo 01" }];
  assert.deepEqual(ranges.addModuleRange(videos, partial)[1], { endPosition: 6, startPosition: 3, title: "Módulo 02" });

  const split = ranges.addModuleRange(videos, ranges.singleModuleRange(videos));
  assert.deepEqual(split, [
    { endPosition: 3, startPosition: 1, title: "Conteúdo do curso" },
    { endPosition: 6, startPosition: 4, title: "Módulo 02" }
  ]);

  const single = [{ position: 1 }];
  assert.deepEqual(ranges.addModuleRange(single, ranges.singleModuleRange(single)), ranges.singleModuleRange(single), "um video so nao divide");

  assert.deepEqual(ranges.updateModuleRange(split, 1, { title: "Prática" })[1].title, "Prática");
  assert.equal(ranges.removeModuleRange(split, 0).length, 1);
  assert.equal(ranges.organizationModeFor("automatic"), "automatic");
  assert.equal(ranges.organizationModeFor("single"), "manual_ranges");
  assert.equal(ranges.organizationModeFor("manual"), "manual_ranges");
});

test("playlist: os intervalos montados viram uma previa valida", async () => {
  const { buildYouTubeCourseImportPreview, rebuildYouTubeCoursePreviewWithRanges } = await import("../src/lib/youtube-course-import.ts");
  const items = [1, 2, 3, 4].map((position) => ({ position, title: `Aula ${position}`, videoId: `abcdefghij${position}` }));
  const preview = buildYouTubeCourseImportPreview({ items, playlistId: "PL1234567890", title: "Curso" });
  const twoModules = ranges.addModuleRange(preview.videos, ranges.singleModuleRange(preview.videos));
  const rebuilt = rebuildYouTubeCoursePreviewWithRanges(preview, twoModules);

  assert.deepEqual(rebuilt.modules.map((module) => module.lessons.length), [2, 2]);
  assert.deepEqual(ranges.suggestedProductText({ description: " linha\n\nnova ", title: "x".repeat(90) }), {
    description: "linha nova",
    title: "x".repeat(80)
  });
});

const detailsBase = {
  accent: "lima",
  coursePresentationMode: "module_cards",
  header: { format: "curso" },
  instructorName: null,
  level: "Iniciante",
  lockedActionMode: "details_modal",
  shortDescription: "Aprenda IA."
};

test("Detalhes: envia so o que mudou e vazio limpa", () => {
  const initial = forms.detailsDraftFrom(detailsBase);

  assert.deepEqual(forms.buildDetailsPatch(initial, initial), {});
  assert.deepEqual(forms.buildDetailsPatch(initial, { ...initial, shortDescription: " Aprenda IA. " }), {}, "espacos nas pontas nao contam");
  assert.deepEqual(
    forms.buildDetailsPatch(initial, { ...initial, accent: "roxo", instructorName: " Danilo ", level: "" }),
    { accent: "roxo", instructorName: "Danilo", level: null }
  );

  const patch = forms.buildDetailsPatch(initial, { ...initial, format: "mentoria", lockedActionMode: "external_link" });
  const parsed = updateProductDetailsSchema.safeParse({ ...patch, expectedUpdatedAt: "2026-10-10T12:00:00.000Z", id: "course-ia-1" });
  assert.equal(parsed.success, true, "o pedido montado passa no schema do servidor");
});

test("Detalhes: formatos e niveis oferecidos", () => {
  assert.deepEqual(forms.editableFormats("formacao"), ["formacao"], "Formação nunca troca de formato");
  assert.deepEqual(forms.editableFormats("curso"), ["curso", "mentoria", "bootcamp", "material"]);
  assert.ok(forms.editableFormats("gravacao_live").includes("gravacao_live"));
  assert.ok(!forms.editableFormats("curso").includes("formacao"));
  assert.equal(forms.supportsPresentationMode("formacao"), false);

  assert.deepEqual(forms.levelOptions("").map((option) => option.label), ["Iniciante", "Intermediário", "Avançado", "Não informar"]);
  assert.deepEqual(forms.levelOptions("Do zero ao avançado").map((option) => option.value).slice(3), ["Do zero ao avançado", ""]);
  assert.equal(forms.normalizeLevel("iniciante"), "Iniciante");
  assert.equal(forms.levelOptions("iniciante").length, 4, "nivel com outra caixa casa com o preset");
});

test("Acesso e venda: monta o pedido com o que mudou", () => {
  const initial = forms.accessDraftFrom({
    audience: "with_access",
    maxStudents: null,
    purchaseLabel: null,
    purchaseTarget: "same_tab",
    purchaseUrl: "https://pay.exemplo.com/a",
    release: { mode: "immediate" }
  });

  assert.deepEqual(forms.buildAccessPatch(initial, initial), {});

  const patch = forms.buildAccessPatch(initial, {
    ...initial,
    maxStudents: "120",
    purchaseLabel: " Quero entrar ",
    purchaseUrl: "",
    release: { amount: 7, mode: "after_access", unit: "dias" }
  });
  assert.deepEqual(patch, {
    maxStudents: 120,
    purchaseLabel: "Quero entrar",
    purchaseUrl: null,
    release: { amount: 7, mode: "after_access", unit: "dias" }
  });
  assert.equal(
    updateProductAccessSchema.safeParse({ ...patch, expectedUpdatedAt: "2026-10-10T12:00:00.000Z", id: "course-ia-1" }).success,
    true
  );

  assert.equal(forms.parseMaxStudents(""), null);
  assert.ok(Number.isNaN(forms.parseMaxStudents("12a")));
  assert.equal(updateProductAccessSchema.shape.maxStudents.safeParse(forms.parseMaxStudents("0")).success, false);

  assert.equal(forms.sameReleasePhrase({ date: "2026-11-14T03:00:00.000Z", mode: "fixed_date" }, { date: "2026-11-14T03:00:00Z", mode: "fixed_date" }), true);
  assert.equal(forms.sameReleasePhrase({ amount: 7, mode: "after_access", unit: "dias" }, { amount: 7, mode: "after_access", unit: "horas" }), false);
  assert.equal(forms.isEmptyPatch({}), true);
});

test("erros de validacao: primeira mensagem por campo, do cliente e da Server Action", () => {
  const parsed = updateProductAccessSchema.safeParse({
    expectedUpdatedAt: "2026-10-10T12:00:00.000Z",
    id: "course-ia-1",
    purchaseUrl: "http://inseguro.com",
    release: { amount: 0, mode: "after_access", unit: "dias" }
  });

  assert.equal(parsed.success, false);
  const errors = forms.firstErrorsByField(parsed.error.issues);
  assert.equal(errors.purchaseUrl, "Use um link que comece com https://.");
  assert.equal(errors.release, "Use pelo menos 1.", "release.amount cai no campo da liberacao");

  assert.deepEqual(
    forms.firstServerFieldErrors({ "release.amount": ["Use pelo menos 1.", "outra"], title: ["Use pelo menos 3 caracteres."], vazio: [] }),
    { release: "Use pelo menos 1.", title: "Use pelo menos 3 caracteres." }
  );
  assert.deepEqual(forms.firstServerFieldErrors(undefined), {});
});

test("versao nova do servidor: segue o servidor sem perder o que o produtor editou", () => {
  const before = forms.accessDraftFrom({
    audience: "with_access",
    maxStudents: null,
    purchaseLabel: null,
    purchaseTarget: "same_tab",
    purchaseUrl: null,
    release: { mode: "immediate" }
  });
  const edited = { ...before, purchaseUrl: "https://pay.exemplo.com/novo", release: { amount: 3, mode: "after_access", unit: "dias" } };
  const server = { ...before, maxStudents: "50", purchaseLabel: "Quero entrar", purchaseUrl: "https://pay.exemplo.com/antigo" };
  const rebased = forms.rebaseDraft(before, edited, server);

  assert.equal(rebased.purchaseUrl, "https://pay.exemplo.com/novo", "o campo editado fica");
  assert.deepEqual(rebased.release, { amount: 3, mode: "after_access", unit: "dias" });
  assert.equal(rebased.maxStudents, "50", "o resto segue o servidor");
  assert.equal(rebased.purchaseLabel, "Quero entrar");
  assert.deepEqual(forms.buildAccessPatch(server, rebased), {
    purchaseUrl: "https://pay.exemplo.com/novo",
    release: { amount: 3, mode: "after_access", unit: "dias" }
  });
  assert.deepEqual(forms.rebaseDraft(before, before, server), server, "sem edicao, tudo do servidor");
});

test("limite de alunos: frase propria para texto, e concorda com o schema", () => {
  for (const [text, expected] of [
    ["", null],
    ["  ", null],
    ["120", null],
    ["12a", "Use só números, ou deixe vazio para não limitar."],
    ["-3", "Use só números, ou deixe vazio para não limitar."],
    ["0", "Use pelo menos 1."],
    ["1000001", "Use no máximo 1.000.000."]
  ]) {
    assert.equal(forms.maxStudentsProblem(text), expected, text);

    const value = forms.parseMaxStudents(text);
    if (!Number.isNaN(value)) {
      assert.equal(updateProductAccessSchema.shape.maxStudents.safeParse(value).success, expected === null, `schema: ${text}`);
    }
  }
});

test("textos das abas: duracao, turmas, pacotes e quem ve o link de compra", () => {
  assert.equal(forms.describeDurationTotal("3 h 20 min"), "3 h 20 min · calculada pelas aulas publicadas");
  assert.match(forms.describeDurationTotal(null), /Aparece quando/);
  assert.equal(forms.describeStudentCount(1), "1 aluno");
  assert.equal(forms.describeStudentCount(1200), "1.200 alunos");
  assert.deepEqual(Object.keys(forms.COMBO_STATUS_LABELS).sort(), ["active", "draft", "paused"]);
  assert.equal(forms.showsPurchaseFields("with_access"), true);
  assert.equal(forms.showsPurchaseFields("all_students"), false);
  assert.equal(forms.showsPurchaseFields("hidden"), false);

  assert.equal(forms.describeStudentsWithAccess(0), "Ninguém com acesso ainda");
  assert.equal(forms.describeStudentsWithAccess(1), "1 aluno com acesso");
  assert.equal(forms.describeStudentsWithAccess(1312), "1.312 alunos com acesso");

  // As pilulas oferecem exatamente os valores que o servidor aceita.
  assert.deepEqual(forms.PRESENTATION_MODE_OPTIONS.map((option) => option.value).sort(), ["lesson_playlist", "module_cards"]);
  for (const option of forms.PRESENTATION_MODE_OPTIONS) {
    assert.equal(updateProductDetailsSchema.shape.coursePresentationMode.safeParse(option.value).success, true, option.value);
  }
  for (const option of forms.LOCKED_ACTION_OPTIONS) {
    assert.equal(updateProductDetailsSchema.shape.lockedActionMode.safeParse(option.value).success, true, option.value);
  }
  for (const option of forms.PURCHASE_TARGET_OPTIONS) {
    assert.equal(updateProductAccessSchema.shape.purchaseTarget.safeParse(option.value).success, true, option.value);
  }
});

test("playlist: problemas dos intervalos em frases do produtor", () => {
  const videos = [1, 2, 3, 4, 5, 6].map((position) => ({ position }));
  const ok = [
    { endPosition: 3, startPosition: 1, title: "Fundamentos" },
    { endPosition: 6, startPosition: 4, title: "Prática" }
  ];

  assert.equal(ranges.describeRangeProblem(videos, ok), null);
  assert.equal(ranges.describeRangeProblem(videos, []), "Adicione pelo menos um módulo.");
  assert.equal(ranges.describeRangeProblem(videos, [{ ...ok[0], title: "  " }, ok[1]]), "Dê um nome ao módulo 1.");
  assert.match(ranges.describeRangeProblem(videos, [{ endPosition: 1, startPosition: 3, title: "Fundamentos" }, ok[1]]), /último vídeo precisa vir depois/);
  assert.equal(ranges.describeRangeProblem(videos, [ok[0], { endPosition: 6, startPosition: 3, title: "Prática" }]), "O vídeo 3 está em mais de um módulo.");
  assert.equal(ranges.describeRangeProblem(videos, [ok[0], { endPosition: 9, startPosition: 7, title: "Extra" }, ok[1]]), "O módulo “Extra” não tem nenhum vídeo.");
  assert.equal(ranges.describeRangeProblem(videos, [ok[0]]), "3 vídeos ficaram sem módulo: 4, 5, 6.");
  assert.equal(ranges.describeRangeProblem(videos, [{ endPosition: 5, startPosition: 1, title: "Quase" }]), "O vídeo 6 ficou sem módulo.");
});

test("playlist: organizacao sugerida, nomes acentuados e a previa montada", async () => {
  const { buildYouTubeCourseImportPreview } = await import("../src/lib/youtube-course-import.ts");

  assert.equal(ranges.suggestedOrganization({ compliantLessons: 0, totalLessons: 5 }), "single");
  assert.equal(ranges.suggestedOrganization({ compliantLessons: 2, totalLessons: 5 }), "automatic");
  assert.match(ranges.describeOrganization("automatic", { compliantLessons: 2, totalLessons: 5 }), /^2 de 5 títulos/);
  assert.match(ranges.describeOrganization("automatic", { compliantLessons: 5, totalLessons: 5 }), /^Todos os títulos/);
  assert.match(ranges.describeOrganization("manual", { compliantLessons: 0, totalLessons: 5 }), /começa e termina/);

  assert.equal(ranges.describeFoundLessons(1), "1 aula encontrada");
  assert.equal(ranges.describeFoundLessons(12), "12 aulas encontradas");
  assert.equal(ranges.describeModuleCount(1), "1 módulo");
  assert.equal(ranges.accentModuleTitle("Conteudo do curso"), "Conteúdo do curso");
  assert.equal(ranges.accentModuleTitle("Modulo 03"), "Módulo 03");
  assert.equal(ranges.accentModuleTitle("Modulos avancados"), "Modulos avancados", "so troca o nome padrao");
  assert.deepEqual(ranges.initialManualRanges([{ endPosition: 2, startPosition: 1, title: "Conteudo do curso" }]), [
    { endPosition: 2, startPosition: 1, title: "Conteúdo do curso" }
  ]);

  const items = [1, 2, 3, 4].map((position) => ({ position, title: `Aula ${position}`, videoId: `abcdefghij${position}` }));
  const preview = buildYouTubeCourseImportPreview({ items, playlistId: "PL1234567890", title: "Curso" });

  const automatic = ranges.arrangePlaylist(preview, "automatic", []);
  assert.equal(automatic.problem, null);
  assert.deepEqual(automatic.ranges, [], "pelos titulos, o servidor organiza");

  const single = ranges.arrangePlaylist(preview, "single", []);
  assert.deepEqual(single.modules.map((module) => [module.title, module.lessons.length]), [["Conteúdo do curso", 4]]);

  const manual = ranges.arrangePlaylist(preview, "manual", [
    { endPosition: 1, startPosition: 1, title: "Boas-vindas" },
    { endPosition: 4, startPosition: 2, title: "Prática" }
  ]);
  assert.deepEqual(manual.modules.map((module) => module.lessons.length), [1, 3]);

  const broken = ranges.arrangePlaylist(preview, "manual", [{ endPosition: 2, startPosition: 1, title: "Só o começo" }]);
  assert.equal(broken.modules.length, 0);
  assert.equal(broken.problem, "2 vídeos ficaram sem módulo: 3, 4.");
});
