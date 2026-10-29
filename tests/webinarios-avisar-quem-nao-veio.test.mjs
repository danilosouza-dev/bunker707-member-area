import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// "Avisar quem não veio" (docs/30 §3.4, bloco Vagas: a lista de faltosos vira regra da Comunicacao; §1.6 "Follow-up por
// segmento", fase 4b): o link do relatorio abre /admin/comunicacao/avisos/novo com as regras "Webinário" (garantiu vaga
// E nao compareceu) no "Para quem"; o endereco ida e volta, o pedido invalido que volta ao aviso em branco, o "Para quem"
// que passa no zod do aviso e combina so com quem tinha vaga e nao veio, e as notas do topo do editor sem o "Você
// começou do modelo" (nao ha modelo). Sem banco: modulos puros pelo Node.

const links = await import("../src/server/webinars/follow-up-links.ts");
const model = await import("../src/server/communications/audience-model.ts");
const { audienceDefinitionSchema } = await import("../src/server/communications/schemas.ts");
const editorModel = await import("../src/components/admin/v2/communication/template-editor-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-06T15:00:00.000Z");
const SEM_NADA = { attended: false, clicked: false, leftBeforeOffer: false, offerSeen: false, purchased: false, registered: false, watchedReplay: false };

function paramsOf(href) {
  const url = new URL(href, "https://membros.exemplo.test");
  assert.equal(url.pathname, "/admin/comunicacao/avisos/novo");
  return Object.fromEntries(url.searchParams.entries());
}

function aluno(fato) {
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
    ...(fato === undefined ? {} : { webinarFollowUps: { [WEBINAR]: { ...SEM_NADA, ...fato } } })
  };
}

test("o link do relatorio ida e volta: garantiu vaga E nao compareceu, no grupo principal, no zod do aviso", () => {
  const href = links.webinarFollowUpNoticeHref({ steps: links.WEBINAR_ABSENTEES, webinarId: WEBINAR });
  const params = paramsOf(href);
  assert.deepEqual(params, { seguimento: "registered,nao-attended", webinario: WEBINAR });

  const audience = links.webinarFollowUpAudienceOf(params);
  assert.deepEqual(audience, {
    kind: "rules",
    root: {
      items: [
        { action: "registered", negate: false, type: "webinar_follow_up", webinarId: WEBINAR },
        { action: "attended", negate: true, type: "webinar_follow_up", webinarId: WEBINAR }
      ],
      match: "all"
    }
  });
  assert.equal(audienceDefinitionSchema.safeParse(audience).success, true, "o aviso salva com este Para quem");
  assert.deepEqual(model.normalizeAudience(audience), audience, "ja vem na forma normal");
});

test("so quem garantiu vaga e nao veio combina (o replay sozinho nao conta como vaga)", () => {
  const audience = links.webinarFollowUpAudienceOf({ seguimento: "registered,nao-attended", webinario: WEBINAR });
  const context = { commentRanks: model.buildCommentRanks([]), lessonTotals: {}, messageKeys: new Set([model.webinarRuleKey(WEBINAR)]), now: NOW };
  const avalia = (fato) => model.evaluateAudience(audience, aluno(fato), context);

  assert.equal(avalia({ registered: true }), true, "vaga sem presenca");
  assert.equal(avalia({ attended: true, registered: true }), false, "veio");
  assert.equal(avalia({ watchedReplay: true }), false, "so viu o replay, sem vaga");
  assert.equal(avalia(undefined), false, "nunca passou pelo webinario");
});

test("pedido invalido volta ao aviso em branco: id que nao e uuid, acao fora da lista, repetida, vazia ou demais", () => {
  const casos = [
    {},
    { seguimento: "registered", webinario: "nao-e-uuid" },
    { seguimento: "registered" },
    { webinario: WEBINAR },
    { seguimento: "", webinario: WEBINAR },
    { seguimento: "registered,nao-oferta", webinario: WEBINAR },
    { seguimento: "registered,nao-registered", webinario: WEBINAR },
    { seguimento: "registered,attended,watched_replay,offer_seen,purchased", webinario: WEBINAR },
    { seguimento: ["registered", "attended"], webinario: WEBINAR }
  ];
  for (const params of casos) {
    assert.equal(links.webinarFollowUpAudienceOf(params), null, JSON.stringify(params));
  }
  assert.equal(links.webinarFollowUpAudienceOf({ seguimento: " purchased ", webinario: WEBINAR.toUpperCase() })?.root.items[0].webinarId, WEBINAR, "o id em minusculas");
});

test("as notas do topo do editor: sem modelo, so a nota de quem preparou (nunca 'Você começou do modelo “”')", () => {
  const base = { mode: "start", notes: [WEBINAR_COPY.seguimento.inicioDoAviso], problem: null, saved: false, templateName: null };
  assert.deepEqual(editorModel.noticeStartNotes(base), [WEBINAR_COPY.seguimento.inicioDoAviso]);
  assert.deepEqual(editorModel.noticeStartNotes({ ...base, saved: true }), [], "some depois do primeiro salvar");
  assert.doesNotMatch(WEBINAR_COPY.seguimento.inicioDoAviso, /oferta|sessão|lembrete|evento/i, "as palavras que as guardas da Comunicacao recusam");
});
