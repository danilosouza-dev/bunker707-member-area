import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Frases do Webinario (docs/30 §2.7 e §10.1): todo texto de src/lib/webinar-copy.ts, do modelo de tela do admin
// (editor-model.ts) e das mensagens do zod passa pela lista propria PROIBIDAS_WEBINARIO (sem tirar acentos:
// "público" e proibido, "publicar" nao; "webinar" e proibido, "Webinário" nao). As guardas da Comunicacao
// (FORBIDDEN_COPY e PROIBIDAS) nao leem estes arquivos: o Webinario usa "Sessão" e "lembrete" na tela.

const copyModule = await import("../src/lib/webinar-copy.ts");
const editorModel = await import("../src/server/webinars/editor-model.ts");
const schemas = await import("../src/server/webinars/schemas.ts");

const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = copyModule;

/** Todas as strings de um objeto, chamando as funcoes com alguns argumentos de amostra. */
function collectTexts(value, into = [], seen = new Set()) {
  if (typeof value === "string") {
    into.push(value);
  } else if (typeof value === "function") {
    for (const args of [["Aula de IA", "20:00", "05/11/2026", "20:00"], [2, 5], [1, 1], [0], [["um", "dois"]]]) {
      try {
        collectTexts(value(...args), into, seen);
      } catch {
        // Assinatura diferente: tenta o proximo conjunto de argumentos.
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectTexts(item, into, seen));
  } else if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    Object.values(value).forEach((item) => collectTexts(item, into, seen));
  }

  return into;
}

function assertAllowed(texts, label) {
  assert.ok(texts.length > 0, `${label}: achou os textos`);

  for (const text of texts) {
    const lower = text.toLocaleLowerCase("pt-BR");

    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `${label}: "${text}" usa "${palavra}"`);
    }
  }
}

test("a lista propria: as palavras de §10.1, sem sessão, lembrete e oferta", () => {
  assert.deepEqual(
    [...PROIBIDAS_WEBINARIO],
    ["campanha", "público", "audiência", "evento", "webinar", "simulive", "host", "lobby", "broadcast", "stream", "gatilho", "trigger", "impressão", "home", "template", "layout", "jitsi"]
  );
  assert.ok(!PROIBIDAS_WEBINARIO.includes("sessão"));
  assert.ok(!PROIBIDAS_WEBINARIO.includes("lembrete"));
  assert.ok(!PROIBIDAS_WEBINARIO.includes("oferta"));
  // Sem tirar acentos: "Webinário" e "publicar" passam; "webinar" e "público" nao.
  assert.ok(!"Webinário".toLocaleLowerCase("pt-BR").includes("webinar"));
  assert.ok("o webinar".includes("webinar"));
  assert.ok(!"Publicar".toLocaleLowerCase("pt-BR").includes("público"));
});

test("webinar-copy.ts: todas as frases do aluno, do sino, do e-mail e do admin passam pela lista", () => {
  const texts = collectTexts(WEBINAR_COPY);
  assertAllowed(texts, "WEBINAR_COPY");
  assert.ok(texts.length > 80, `achou os textos (${texts.length})`);
  assert.ok(texts.some((text) => /[áéíóúâêôãõç]/i.test(text)), "os acentos continuam la");
});

test("editor-model.ts (admin) e as mensagens do zod passam pela mesma lista", () => {
  assertAllowed(collectTexts(editorModel.WEBINAR_ADMIN_COPY), "WEBINAR_ADMIN_COPY");
  assertAllowed(Object.values(editorModel.WEBINAR_ACTION_LABELS), "WEBINAR_ACTION_LABELS");
  assertAllowed(Object.values(editorModel.WEBINAR_ACTION_TOASTS), "WEBINAR_ACTION_TOASTS");
  assertAllowed(editorModel.WEBINAR_SITUATION_FILTERS.map((filter) => filter.label), "filtros de situacao");
  assertAllowed(editorModel.WEBINAR_KIND_FILTERS.map((filter) => filter.label), "filtros de tipo");
  assertAllowed(editorModel.WEBINAR_LIST_TABS.map((tab) => tab.label), "abas");
  assertAllowed(editorModel.ACCESS_MODE_OPTIONS.map((option) => option.label), "quem pode");
  assertAllowed(Object.values(schemas.WEBINAR_MESSAGES), "WEBINAR_MESSAGES");

  const draft = editorModel.startWebinarDraft("live");
  const now = Date.parse("2026-10-28T15:00:00.000Z");
  const complete = { ...draft, hostUserId: "0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b", scheduledAt: new Date(now + 86_400_000).toISOString(), title: "Aula de IA" };
  assertAllowed(
    [
      editorModel.webinarReviewSentence({ draft, now, productName: null, registeredCount: 0, situation: null }),
      editorModel.webinarReviewSentence({ draft: complete, now, productName: "Curso de IA", registeredCount: 3, situation: "scheduled" }),
      editorModel.webinarReviewSentence({ draft: { ...complete, accessMode: "either", productId: "curso" }, now, productName: null, registeredCount: 1, situation: null }),
      ...Object.values(editorModel.webinarPreviewCard(draft, now)).filter((value) => typeof value === "string"),
      ...["confirmation", "h24", "h1", "started"].map((kind) => editorModel.reminderPreviewText(kind, complete, complete.scheduledAt)),
      ...Object.values(editorModel.webinarActionConfirm("cancel", { registeredCount: 2, title: "Aula" })).filter((value) => typeof value === "string"),
      ...Object.values(editorModel.webinarActionConfirm("delete", { registeredCount: 0, title: "" })).filter((value) => typeof value === "string")
    ],
    "frases montadas"
  );
});

test("as frases do admin de §2.7 e dos lembretes estao em WEBINAR_COPY, como a spec escreve", () => {
  const admin = WEBINAR_COPY.admin;

  assert.equal(admin.novo, "Novo webinário");
  assert.equal(admin.publicar, "Publicar");
  assert.equal(admin.abrirSala, "Abrir a sala");
  assert.equal(admin.abrirConsole, "Abrir o console");
  assert.equal(admin.encerrarLive, "Encerrar live");
  assert.equal(admin.comecarParaTodos, "Começar para todos");
  assert.equal(admin.semDados, "Sem dados no período");
  assert.equal(admin.semLivesAoVivo, "Sem lives ao vivo ainda");
  assert.deepEqual(admin.situacoes, { cancelled: "Cancelado", draft: "Rascunho", ended: "Encerrado", in_progress: "Em andamento", scheduled: "Agendado" });
  assert.deepEqual(admin.tipos, { live: "Live ao vivo", simulated: "Live gravada" });

  assert.equal(WEBINAR_COPY.aluno.vagaGarantidaToast, "Vaga garantida. Avisamos você 1 dia e 1 hora antes.");
  assert.equal(WEBINAR_COPY.sino.h24("Aula de IA", "20:00"), "Amanhã às 20:00: Aula de IA. Sua vaga está garantida.");
  assert.equal(WEBINAR_COPY.sino.h1("Aula de IA"), "Começa em 1 hora: Aula de IA. Entre pela área de membros.");
  assert.equal(WEBINAR_COPY.sino.comecou("Aula de IA"), "Começou agora: Aula de IA. Entrar.");
  assert.equal(WEBINAR_COPY.email.h24Assunto("20:00", "Aula de IA"), "Amanhã às 20:00: Aula de IA");
  assert.equal(WEBINAR_COPY.email.h1Assunto("Aula de IA"), "Começa em 1 hora: Aula de IA");
  assert.equal(WEBINAR_COPY.email.canceladaAssunto("Aula de IA"), "Live cancelada: Aula de IA");
  assert.match(WEBINAR_COPY.email.h24Corpo("Ana", "Aula de IA", "05/11/2026", "20:00"), /^Olá, Ana\. Sua vaga está garantida para Aula de IA, amanhã, 05\/11\/2026 às 20:00 \(horário de Brasília\)/);
  assert.match(WEBINAR_COPY.email.h24Corpo("Ana", "Aula de IA", "05/11/2026", "20:00"), /cancele sua vaga na página dela\.$/);

  // "Inscritos" fica so nos nomes dos relatorios do Zoom: a lista fala em vagas garantidas.
  const adminTexts = [...collectTexts(admin), ...collectTexts(editorModel.WEBINAR_ADMIN_COPY)];
  assert.ok(!adminTexts.some((text) => /inscrit/i.test(text)), "nada de Inscritos nos rotulos");
  assert.ok(adminTexts.includes("Vagas garantidas"));
});
