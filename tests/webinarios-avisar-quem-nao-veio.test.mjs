import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// Um link so para os dois botoes que comecam um aviso pela live (docs/28 §5.6; docs/30 §2.2 e §3.4):
// /admin/comunicacao/avisos/novo?webinario=<id>. O card Avisar manda &tipo=notificacao|popup (o aviso preenchido pelo
// webinario salvo); o "Avisar quem não veio" do relatorio manda tambem &seguimento=registered,nao-attended (o aviso em
// branco com as regras "Participação em lives" garantiu vaga E não participou no "Para quem"). O endereco ida e volta
// pelo mesmo parse (webinarNoticeRequestOf), o pedido invalido que volta ao aviso em branco, o "Para quem" que passa no
// zod do aviso e combina so com quem tinha vaga e nao veio (pelas vagas e presencas de communication_webinar_facts), e
// as notas do topo do editor sem o "Você começou do modelo" (nao ha modelo). Sem banco: modulos puros pelo Node.

const shortcut = await import("../src/server/webinars/notice-shortcut-model.ts");
const model = await import("../src/server/communications/audience-model.ts");
const { audienceDefinitionSchema } = await import("../src/server/communications/schemas.ts");
const editorModel = await import("../src/components/admin/v2/communication/template-editor-model.ts");
const { parseNoticeKindParam } = await import("../src/components/admin/v2/communication/notices-view-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-06T15:00:00.000Z");

function paramsOf(href) {
  const url = new URL(href, "https://membros.exemplo.test");
  assert.equal(url.pathname, "/admin/comunicacao/avisos/novo");
  return Object.fromEntries(url.searchParams.entries());
}

function aluno(lives) {
  return {
    accesses: [],
    cohortIds: [],
    comments: { d7: 0, d30: 0, d90: 0, total: 0 },
    completedByContent: {},
    completedLessons: 0,
    lastSignInAt: null,
    lastStudiedAt: null,
    pace: "never_started",
    totalLessons: 0,
    userId: "aluno-1",
    ...(lives === undefined ? {} : { webinars: { attended: [], registered: [], ...lives } })
  };
}

test("os dois botoes no mesmo endereco: o card Avisar (so ?tipo=) e o 'Avisar quem não veio' (com ?seguimento=)", () => {
  assert.equal(shortcut.webinarNoticeHref(WEBINAR, "inbox"), `/admin/comunicacao/avisos/novo?webinario=${WEBINAR}&tipo=notificacao`, "o href que o e2e do card Avisar confere");
  assert.equal(
    shortcut.webinarNoticeHref(WEBINAR, "inbox", shortcut.WEBINAR_ABSENTEES),
    `/admin/comunicacao/avisos/novo?webinario=${WEBINAR}&tipo=notificacao&seguimento=registered%2Cnao-attended`
  );

  const card = paramsOf(shortcut.webinarNoticeHref(WEBINAR, "popup"));
  assert.deepEqual(shortcut.webinarNoticeRequestOf(card), { mode: "webinar", webinarId: WEBINAR });
  assert.equal(parseNoticeKindParam(card.tipo), "popup");

  const faltosos = paramsOf(shortcut.webinarNoticeHref(WEBINAR, "inbox", shortcut.WEBINAR_ABSENTEES));
  assert.deepEqual(faltosos, { seguimento: "registered,nao-attended", tipo: "notificacao", webinario: WEBINAR });
  assert.equal(parseNoticeKindParam(faltosos.tipo), "inbox");
});

test("o 'Avisar quem não veio' ida e volta: garantiu vaga E não participou, no grupo principal, no zod do aviso", () => {
  const request = shortcut.webinarNoticeRequestOf(paramsOf(shortcut.webinarNoticeHref(WEBINAR, "inbox", shortcut.WEBINAR_ABSENTEES)));
  const audience = {
    kind: "rules",
    root: {
      items: [
        { action: "registered", negate: false, type: "webinar", webinarId: WEBINAR },
        { action: "attended", negate: true, type: "webinar", webinarId: WEBINAR }
      ],
      match: "all"
    }
  };

  assert.deepEqual(request, { audience, mode: "rules", webinarId: WEBINAR });
  assert.equal(audienceDefinitionSchema.safeParse(audience).success, true, "o aviso salva com este Para quem");
  assert.deepEqual(model.normalizeAudience(audience), audience, "ja vem na forma normal");
  assert.deepEqual(model.audienceFactsRequest(audience), { messageCampaignIds: [], webinarFollowUpIds: [], webinars: true }, "so as vagas e presencas");

  const start = shortcut.webinarRulesNoticeStart("popup", audience);
  assert.deepEqual(start.draft.audience, audience);
  assert.equal(start.draft.kind, "popup");
  assert.deepEqual(start.notes, [WEBINAR_COPY.seguimento.inicioDoAviso]);
  assert.equal(start.templateId, null);
  assert.equal(start.templateName, null);
});

test("so quem garantiu vaga e nao veio combina (o replay sozinho nao conta como vaga)", () => {
  const { audience } = shortcut.webinarNoticeRequestOf({ seguimento: "registered,nao-attended", webinario: WEBINAR });
  const context = { commentRanks: model.buildCommentRanks([]), lessonTotals: {}, now: NOW, webinarFactsLoaded: true };
  const avalia = (lives) => model.evaluateAudience(audience, aluno(lives), context);

  assert.equal(avalia({ registered: [WEBINAR] }), true, "vaga sem presenca");
  assert.equal(avalia({ attended: [WEBINAR], registered: [WEBINAR] }), false, "veio");
  assert.equal(avalia({ followUps: { [WEBINAR]: { clicked: false, leftBeforeOffer: false, offerSeen: false, purchased: false, watchedReplay: true } } }), false, "so viu o replay, sem vaga");
  assert.equal(avalia(undefined), false, "nunca passou pela live");
  assert.equal(model.evaluateAudience(audience, aluno({ registered: [WEBINAR] }), { ...context, webinarFactsLoaded: undefined }), false, "sem as vagas lidas, ninguem");
});

test("um parse so: sem ?webinario= e o Novo aviso de sempre; sem ?seguimento= e o card Avisar; ?seguimento= invalido = aviso em branco", () => {
  for (const params of [{}, { webinario: "" }, { webinario: ["a", "b"] }, { seguimento: "registered" }, { modelo: "x", tipo: "popup" }]) {
    assert.equal(shortcut.webinarNoticeRequestOf(params), null, JSON.stringify(params));
  }

  assert.deepEqual(shortcut.webinarNoticeRequestOf({ tipo: "popup", webinario: ` ${WEBINAR} ` }), { mode: "webinar", webinarId: WEBINAR });
  // O id do card Avisar e conferido no servidor (prepareWebinarNoticeStart: invalido volta para a lista de webinarios).
  assert.deepEqual(shortcut.webinarNoticeRequestOf({ webinario: "nao-e-uuid" }), { mode: "webinar", webinarId: "nao-e-uuid" });

  const invalidos = [
    { seguimento: "registered", webinario: "nao-e-uuid" },
    { seguimento: "", webinario: WEBINAR },
    { seguimento: "registered,nao-oferta", webinario: WEBINAR },
    { seguimento: "registered,nao-registered", webinario: WEBINAR },
    { seguimento: "registered,attended,watched_replay,offer_seen,purchased", webinario: WEBINAR },
    { seguimento: ["registered", "attended"], webinario: WEBINAR }
  ];
  for (const params of invalidos) {
    assert.deepEqual(shortcut.webinarNoticeRequestOf(params), { mode: "blank" }, JSON.stringify(params));
  }

  const compraram = shortcut.webinarNoticeRequestOf({ seguimento: " purchased ", webinario: WEBINAR.toUpperCase() });
  assert.deepEqual(compraram.audience.root.items, [{ action: "purchased", negate: false, type: "webinar", webinarId: WEBINAR }], "as acoes do follow-up tambem, com o id em minusculas");
});

test("a pagina do Novo aviso usa o parse e o start dos dois botoes (o ?modelo= vence)", async () => {
  const { readFile } = await import("node:fs/promises");
  const pagina = await readFile(new URL("../src/app/admin/(v2)/comunicacao/avisos/novo/page.tsx", import.meta.url), "utf8");

  assert.match(pagina, /const webinar = templateId \? null : webinarNoticeRequestOf\(params\);/);
  assert.match(pagina, /webinar\?\.mode === "webinar" \? await loadWebinarStart\(webinar\.webinarId, kind, readNow\(\)\)/);
  assert.match(pagina, /webinar\?\.mode === "rules" \? webinarRulesNoticeStart\(kind, webinar\.audience\) : null/);
  assert.doesNotMatch(pagina, /follow-up-links|WEBINAR_FOLLOW_UP_PARAMS/, "nada do link antigo da fase 4");
});

test("as notas do topo do editor: sem modelo, so a nota de quem preparou (nunca 'Você começou do modelo “”')", () => {
  const base = { mode: "start", notes: [WEBINAR_COPY.seguimento.inicioDoAviso], problem: null, saved: false, templateName: null };
  assert.deepEqual(editorModel.noticeStartNotes(base), [WEBINAR_COPY.seguimento.inicioDoAviso]);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, saved: true }), [], "some depois do primeiro salvar");
  assert.doesNotMatch(WEBINAR_COPY.seguimento.inicioDoAviso, /oferta|sessão|lembrete|evento/i, "as palavras que as guardas da Comunicacao recusam");
});
