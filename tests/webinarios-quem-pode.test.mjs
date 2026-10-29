import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";
import "./support/transpile-tsx.mjs";
import { scriptedDb } from "./support/webinarios-banco-falso.mjs";

// "Quem pode" do Webinario por regras (docs/30 §1.1, §2.2 e §8.2; D8 e D41; docs/18 §2.2), sem banco:
// - hasWebinarAccess: o modo novo "both" (Quem tem o produto e está no segmento) so abre com os dois; a ancora (vaga
//   garantida ou entrada numa sessao deste webinario) segura o segmento so no Segmento e no "both", nunca o produto
//   ligado nem o produto e a turma que o segmento pede (o reembolsado sai); no "Produto ou segmento" nao ha ancora:
//   vale o produto de agora ou o segmento de agora, sem nenhuma conta de data; a propria live nao conta no proprio
//   segmento ("nunca garantiram vaga em nenhuma live" = em nenhuma outra, sem laco); a equipe sempre entra; a previa
//   "ver como" sem acesso nao ve o "both";
// - a linha do banco: o "both" grava access_mode 'product' + audience_restricts (o app de antes, num rollback, le
//   'product' e continua exigindo o produto) e um valor desconhecido fecha;
// - loadStudentAccessFacts num banco falso: so le o que decide (o segmento do "both" so com o produto e o do "Produto
//   ou segmento" so sem ele; sem a contagem de comentarios de todos os alunos e sem o indice de aulas quando nenhuma
//   regra de progresso, ritmo ou turma usa), as vagas e presencas da pessoa so quando a ancora decide (uma leitura so,
//   dividida com a regra "Participação em lives"; nunca no "Produto ou segmento") e o banco sem a migracao
//   202610300001 sem ancora;
// - o editor: a pilula nova, a frase da Revisao, o produto guardado no "both", a dica "Vale na hora" (sem os 15 min) e,
//   no "Produto ou segmento", a de como segurar a vaga; o aviso com regra de tempo e "Entrar direto, sem vaga" no
//   Segmento e no "both", a contagem do "both" (produto +
//   segmento) e o zod (produto e segmento obrigatorios no "both"; regra de lives que aponta para o proprio webinario
//   recusada);
// - o card Quem pode desenhado: a pilula, a dica, o aviso, o seletor de lives sem a propria live e a frase embaixo do
//   numero sem a troca da propria live (nunca "uma live removida" no rascunho).

const access = await import("../src/server/webinars/access.ts");
const model = await import("../src/server/webinars/model.ts");
const student = await import("../src/server/webinars/student-model.ts");
const vm = await import("../src/server/webinars/editor-model.ts");
const schemas = await import("../src/server/webinars/schemas.ts");
const audienceModel = await import("../src/server/communications/audience-model.ts");
const audienceFacts = await import("../src/server/communications/audience-facts.ts");
const { audienceDefinitionSchema } = await import("../src/server/communications/schemas.ts");
const { PROIBIDAS_WEBINARIO } = await import("../src/lib/webinar-copy.ts");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AccessCard } = await import("../src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx");

const HORA = 3_600_000;
const DIA = 24 * HORA;
// Quinta, 5/11/2026, 12:00 em Sao Paulo (15:00 UTC).
const AGORA = Date.parse("2026-11-05T15:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

const ALUNA = "cccccccc-3333-4333-8333-333333333333";
const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const OUTRO = "aaaaaaaa-1111-4111-8111-222222222222";
const PRODUTO = "curso-x";

/** Segmento estavel para o modelo: entrou na area nos ultimos 7 dias. */
const ENTROU_NA_SEMANA = { kind: "rules", root: { items: [{ days: 7, op: "within", type: "sign_in" }], match: "all" } };
/** O pedido do produtor: ganhou acesso a qualquer produto hoje (dia de Sao Paulo). */
const GANHOU_HOJE = { kind: "rules", root: { items: [{ negate: false, period: { kind: "today" }, productIds: [], type: "access_recent" }], match: "all" } };
/** Ganhou acesso ao Curso X hoje: o segmento cita o produto. */
const GANHOU_X_HOJE = { kind: "rules", root: { items: [{ negate: false, period: { kind: "today" }, productIds: [PRODUTO], type: "access_recent" }], match: "all" } };
/** Nunca garantiram vaga em nenhuma live. */
const NUNCA_GARANTIU_VAGA = { kind: "rules", root: { items: [{ action: "registered", negate: true, type: "webinar", webinarId: null }], match: "all" } };
/** A linha da RPC communication_webinar_facts (uma por aluno). */
const livesDa = (userId, { attended = [], registered = [] } = {}) => ({ attended: attended.length ? attended : null, registered: registered.length ? registered : null, user_id: userId });

function webinar(accessMode, extra = {}) {
  return { accessMode, audience: ENTROU_NA_SEMANA, id: WEBINAR, productId: accessMode === "audience" || accessMode === "everyone" ? null : PRODUTO, ...extra };
}

function acesso(targetId, extra = {}) {
  return {
    created_at: iso(AGORA - 30 * DIA),
    ends_at: null,
    id: `ent-${targetId}`,
    product_id: targetId,
    source_event_id: null,
    source_provider: "hotmart",
    starts_at: iso(AGORA - 30 * DIA),
    status: "active",
    target_id: targetId,
    target_type: "standalone_course",
    updated_at: iso(AGORA - 30 * DIA),
    user_id: ALUNA,
    ...extra
  };
}

/** Os fatos do segmento ja lidos, com a aluna dentro (entrou ontem) ou fora (nunca entrou). */
function carregado(noSegmento) {
  return {
    context: { commentRanks: audienceModel.buildCommentRanks([]), lessonTotals: {}, messageKeys: new Set(), now: AGORA },
    facts: [
      {
        accesses: [],
        cohortIds: [],
        comments: { d7: 0, d30: 0, d90: 0, total: 0 },
        completedByContent: {},
        completedLessons: 0,
        lastSignInAt: noSegmento ? AGORA - DIA : null,
        lastStudiedAt: null,
        pace: "never_started",
        totalLessons: 0,
        userId: ALUNA
      }
    ],
    people: new Map()
  };
}

function fatos({ ancoras = [], equipe = false, noSegmento = false, produto = false } = {}) {
  return {
    anchoredWebinarIds: new Set(ancoras),
    entitlements: produto ? [acesso(PRODUTO)] : [],
    isStaff: equipe,
    loaded: carregado(noSegmento),
    now: AGORA,
    userId: ALUNA
  };
}

/* ------------------------------------------------------------------------------------------------
 * hasWebinarAccess
 * ---------------------------------------------------------------------------------------------- */

test("both: abre so com o produto E o segmento; so o produto, so o segmento ou nenhum = nao", () => {
  const both = webinar("both");

  assert.equal(access.hasWebinarAccess(fatos({ noSegmento: true, produto: true }), both), true, "produto e segmento");
  assert.equal(access.hasWebinarAccess(fatos({ produto: true }), both), false, "so o produto");
  assert.equal(access.hasWebinarAccess(fatos({ noSegmento: true }), both), false, "so o segmento (o segmento so restringe)");
  assert.equal(access.hasWebinarAccess(fatos(), both), false, "nenhum");

  // O produto vem dos acessos: o reembolsado (acesso revogado) e o acesso vencido nao contam; a plataforma conta.
  const revogado = { ...fatos({ noSegmento: true }), entitlements: [acesso(PRODUTO, { status: "revoked" })] };
  const vencido = { ...fatos({ noSegmento: true }), entitlements: [acesso(PRODUTO, { ends_at: iso(AGORA - HORA) })] };
  const plataforma = { ...fatos({ noSegmento: true }), entitlements: [acesso("platform", { target_type: "platform" })] };
  assert.equal(access.hasWebinarAccess(revogado, both), false);
  assert.equal(access.hasWebinarAccess(vencido, both), false);
  assert.equal(access.hasWebinarAccess(plataforma, both), true);
});

test("a ancora: vaga garantida ou entrada numa sessao deste webinario segura o segmento so no Segmento e no both; nunca o produto", () => {
  const ancorada = fatos({ ancoras: [WEBINAR] });

  // Segmento: fora do segmento agora, mas com a vaga (ou a presenca) neste webinario, continua vendo.
  assert.equal(access.hasWebinarAccess(ancorada, webinar("audience")), true, "Segmento com a ancora");
  assert.equal(access.hasWebinarAccess(fatos(), webinar("audience")), false, "Segmento sem a ancora");
  assert.equal(access.hasWebinarAccess(fatos({ ancoras: [OUTRO] }), webinar("audience")), false, "a vaga de outra live nao vale aqui");

  // both: a ancora segura o segmento, mas o produto e conferido sempre de novo.
  assert.equal(access.hasWebinarAccess(fatos({ ancoras: [WEBINAR], produto: true }), webinar("both")), true, "both com o produto e a ancora");
  assert.equal(access.hasWebinarAccess(ancorada, webinar("both")), false, "both sem o produto: a ancora nao abre (o reembolsado sai)");

  // Produto: a ancora nunca abre.
  assert.equal(access.hasWebinarAccess(ancorada, webinar("product")), false, "Quem tem o produto: a vaga nao substitui o produto");

  // Produto ou segmento: sem ancora. A vaga nao segura quem saiu do segmento sem o produto; vale o de agora.
  assert.equal(access.hasWebinarAccess(ancorada, webinar("either")), false, "vaga, fora do segmento e sem o produto: nao ve");
  assert.equal(access.hasWebinarAccess({ ...ancorada, entitlements: [acesso(PRODUTO)] }, webinar("either")), true, "com o produto agora");
  assert.equal(access.hasWebinarAccess({ ...ancorada, loaded: carregado(true) }, webinar("either")), true, "no segmento agora");
});

/** Os fatos do segmento ja lidos com estes acessos (o que a pagina monta pelos acessos da pessoa). */
function carregadoCom(entitlements) {
  const base = carregado(false);

  return { ...base, facts: [{ ...base.facts[0], accesses: audienceFacts.accessFactsOf(audienceFacts.openAccessRows(entitlements, AGORA)) }] };
}

test("Produto ou segmento sem ancora: vaga + saiu do segmento + sem o produto = nao; com o produto agora = sim; o reembolsado com vaga sai, sem nenhuma conta de data", () => {
  // O pedido do produtor: Curso P OU "ganharam acesso hoje a qualquer produto". A aluna garantiu vaga dias atras; tem um
  // ebook aberto ha meses (que seguraria a ancora do Segmento, "qualquer produto").
  const live = webinar("either", { audience: GANHOU_HOJE, productId: "curso-p" });
  const ebook = acesso("ebook", { created_at: iso(AGORA - 200 * DIA), starts_at: iso(AGORA - 200 * DIA) });
  const daAluna = (entitlements) => ({ ...fatos({ ancoras: [WEBINAR] }), entitlements, loaded: carregadoCom(entitlements) });
  const registrante = (entitlements) => ({ entitlements, now: AGORA, userId: ALUNA });

  // Saiu do segmento (o "hoje" passou), com a vaga e sem o P: nao ve e nao recebe aviso.
  assert.equal(access.hasWebinarAccess(daAluna([ebook]), live), false, "vaga + saiu do segmento + sem o produto");
  assert.equal(access.registrantHasWebinarAccess(live, registrante([ebook])), false);

  // Com o P agora: ve e recebe, fora do segmento.
  const p = acesso("curso-p", { created_at: iso(AGORA - 40 * DIA), starts_at: iso(AGORA - 40 * DIA) });
  assert.equal(access.hasWebinarAccess(daAluna([ebook, p]), live), true, "com o produto agora");
  assert.equal(access.registrantHasWebinarAccess(live, registrante([ebook, p])), true);

  // No segmento agora (ganhou outro acesso hoje): ve, mesmo sem o P.
  const hoje = acesso("curso-y", { created_at: iso(AGORA - HORA), starts_at: iso(AGORA - HORA) });
  assert.equal(access.hasWebinarAccess(daAluna([ebook, hoje]), live), true, "no segmento agora");

  // O P perdido, qualquer que seja a historia da linha (reembolsado ontem ou ha um ano, comprado depois da vaga, prazo
  // devolvido, fim encurtado, reaberto e perdido de novo, a plataforma vencida em 2025): fora do segmento, sai. Nenhuma
  // conta de data: so o estado de agora.
  const perdidos = {
    "reembolsado ontem": acesso("curso-p", { status: "revoked", updated_at: iso(AGORA - DIA) }),
    "reembolsado ha um ano": acesso("curso-p", { created_at: iso(AGORA - 400 * DIA), starts_at: iso(AGORA - 400 * DIA), status: "revoked", updated_at: iso(AGORA - 365 * DIA) }),
    "comprado depois da vaga e reembolsado": acesso("curso-p", { created_at: iso(AGORA - DIA), starts_at: iso(AGORA - DIA), status: "revoked", updated_at: iso(AGORA - HORA) }),
    "prazo devolvido": acesso("curso-p", { created_at: iso(AGORA - 290 * DIA), ends_at: iso(AGORA - 12 * DIA), starts_at: iso(AGORA - 290 * DIA), updated_at: iso(AGORA - 5 * DIA) }),
    "fim encurtado": acesso("curso-p", { ends_at: iso(AGORA - 11 * DIA), updated_at: iso(AGORA - DIA) }),
    "reaberto e perdido de novo": acesso("curso-p", { created_at: iso(AGORA - 290 * DIA), ends_at: iso(AGORA + 20 * DIA), starts_at: iso(AGORA - 8 * DIA), status: "revoked", updated_at: iso(AGORA - 6 * DIA) }),
    "plataforma vencida em 2025": acesso("platform", { created_at: "2024-06-01T00:00:00.000Z", ends_at: "2025-06-01T00:00:00.000Z", starts_at: "2024-06-01T00:00:00.000Z", target_type: "platform", updated_at: "2024-06-01T00:00:00.000Z" })
  };

  for (const [nome, linha] of Object.entries(perdidos)) {
    assert.equal(access.hasWebinarAccess(daAluna([ebook, linha]), live), false, `${nome}: a pagina, a sala e o token nao abrem`);
    assert.equal(access.registrantHasWebinarAccess(live, registrante([ebook, linha])), false, `${nome}: sem aviso pela vaga`);
    assert.equal(access.hasWebinarAccess(daAluna([ebook, linha, hoje]), live), true, `${nome}: no segmento agora, entra pelo segmento`);
  }

  // A turma vale como agora: "Mentoria OU turma Bolsa", reembolsada da Mentoria e fora da turma, sai; na turma, entra.
  const bolsa = webinar("either", { audience: { kind: "rules", root: { items: [{ cohortIds: ["bolsa"], type: "cohort" }], match: "all" } }, productId: "mentoria" });
  const naTurma = (cohortIds) => ({ ...daAluna([acesso("mentoria", { status: "revoked" })]), loaded: { ...carregado(false), facts: [{ ...carregado(false).facts[0], cohortIds }] } });
  assert.equal(access.hasWebinarAccess(naTurma([]), bolsa), false);
  assert.equal(access.hasWebinarAccess(naTurma(["bolsa"]), bolsa), true);
});

test("Segmento 'tem o produto X' OU 'ganhou acesso hoje': quem entrou hoje pelo segmento e garantiu vaga continua amanha (a ancora); quem comprou X e foi reembolsado sai (X conferido de novo)", async () => {
  const TEM_X_OU_HOJE = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }, GANHOU_HOJE.root.items[0]], match: "any" } };
  const live = webinar("audience", { audience: TEM_X_OU_HOJE });
  const lives = [livesDa(ALUNA, { registered: [WEBINAR] })];
  // "Amanha": o acesso foi ganho ontem (o "hoje" da vaga ja passou).
  const ontem = (targetId, extra = {}) => acesso(targetId, { created_at: iso(AGORA - DIA), starts_at: iso(AGORA - DIA), ...extra });

  // Ganhou o Curso Y ontem (entrou pelo "ganhou acesso hoje") e garantiu a vaga: hoje esta fora do segmento, mas a vaga segura.
  const pelaRegraDeTempo = bancoDaAluna({ acessos: [ontem("curso-y")], lives });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(pelaRegraDeTempo, ALUNA, [live], AGORA), live), true, "a vaga segura o dia seguinte");
  assert.equal(rpcs(pelaRegraDeTempo, "communication_webinar_facts").length, 1, "a ancora lida uma vez, so da pessoa");
  assert.equal(access.registrantHasWebinarAccess(live, { entitlements: [ontem("curso-y")], now: AGORA, userId: ALUNA }), true, "e recebe os avisos");
  // Sem a vaga, fora.
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(bancoDaAluna({ acessos: [ontem("curso-y")] }), ALUNA, [live], AGORA), live), false);

  // Comprou X ontem, garantiu a vaga e foi reembolsado: sem acesso nenhum aberto, sai (mesmo com a vaga) e nao recebe.
  const reembolsado = ontem(PRODUTO, { status: "revoked" });
  const db = bancoDaAluna({ acessos: [reembolsado], lives });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(db, ALUNA, [live], AGORA), live), false, "X conferido de novo");
  assert.equal(rpcs(db, "communication_webinar_facts").length, 0, "a ancora nem decide: as vagas nem sao lidas");
  assert.equal(access.registrantHasWebinarAccess(live, { entitlements: [reembolsado], now: AGORA, userId: ALUNA }), false);

  // Com X aberto, esta no segmento agora (tem o produto), com ou sem vaga.
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(bancoDaAluna({ acessos: [ontem(PRODUTO)] }), ALUNA, [live], AGORA), live), true);
});

test("a ancora nao segura o produto que o segmento pede: o reembolsado sai, no Segmento e no both", () => {
  // Segmento "ganharam acesso ao Curso X hoje": a aluna comprou X, garantiu vaga e foi reembolsada (acesso revogado).
  const reembolsada = { ...fatos({ ancoras: [WEBINAR] }), entitlements: [acesso(PRODUTO, { status: "revoked" })] };
  const comX = { ...fatos({ ancoras: [WEBINAR] }), entitlements: [acesso(PRODUTO, { created_at: iso(AGORA - 2 * DIA), starts_at: iso(AGORA - 2 * DIA) })] };

  const segmento = webinar("audience", { audience: GANHOU_X_HOJE });
  assert.equal(access.hasWebinarAccess(reembolsada, segmento), false, "Segmento: sem X, a vaga nao segura");
  assert.equal(access.hasWebinarAccess(comX, segmento), true, 'Segmento: com X (ganho anteontem), a vaga segura o "hoje"');
  // No Produto ou segmento nao ha ancora: com X de anteontem e sem a Mentoria, a vaga nao segura o "hoje".
  assert.equal(access.hasWebinarAccess(comX, webinar("either", { audience: GANHOU_X_HOJE, productId: "mentoria" })), false, "either: sem ancora");

  // "both" com o produto da live: a ancora tambem exige X, que o segmento pede.
  const both = webinar("both", { audience: GANHOU_X_HOJE, productId: "mentoria" });
  const mentoria = acesso("mentoria");
  assert.equal(access.hasWebinarAccess({ ...reembolsada, entitlements: [mentoria, acesso(PRODUTO, { status: "revoked" })] }, both), false);
  assert.equal(access.hasWebinarAccess({ ...comX, entitlements: [mentoria, ...comX.entitlements] }, both), true);

  // "qualquer produto": a ancora exige algum acesso aberto; uma regra negada ou de outro tipo nao pede produto.
  const qualquer = webinar("audience", { audience: GANHOU_HOJE });
  assert.equal(access.hasWebinarAccess({ ...fatos({ ancoras: [WEBINAR] }), entitlements: [acesso("outro-curso")] }, qualquer), true);
  assert.equal(access.hasWebinarAccess(fatos({ ancoras: [WEBINAR] }), qualquer), false, "sem acesso nenhum, a vaga nao segura");

  // Num grupo "qualquer" com a turma: a turma vale como agora, entao a reembolsada de X fora da turma sai, mesmo com a
  // vaga; na turma, continua.
  const ouTurma = { kind: "rules", root: { items: [GANHOU_X_HOJE.root.items[0], { cohortIds: ["turma-5"], type: "cohort" }], match: "any" } };
  const naTurma = (cohortIds) => ({ ...reembolsada, loaded: { ...carregado(false), facts: [{ ...carregado(false).facts[0], cohortIds }] } });
  assert.equal(access.hasWebinarAccess(naTurma([]), webinar("audience", { audience: ouTurma })), false, "reembolsada de X e fora da turma");
  assert.equal(access.hasWebinarAccess(naTurma(["turma-5"]), webinar("audience", { audience: ouTurma })), true, "na turma");

  // Tirado da turma (segmento "turma Mentoria"): sai, mesmo com a vaga. Progresso geral sem acesso nenhum: sai.
  const turma = webinar("audience", { audience: { kind: "rules", root: { items: [{ cohortIds: ["turma-5"], type: "cohort" }], match: "all" } } });
  assert.equal(access.hasWebinarAccess(naTurma([]), turma), false);
  const progresso = webinar("audience", { audience: { kind: "rules", root: { items: [{ op: "gte", percent: 50, productId: null, type: "progress" }], match: "all" } } });
  assert.equal(access.hasWebinarAccess(fatos({ ancoras: [WEBINAR] }), progresso), false, "sem acesso nenhum, o progresso geral nao segura");
  assert.equal(access.hasWebinarAccess({ ...fatos({ ancoras: [WEBINAR] }), entitlements: [acesso("outro-curso")] }, progresso), true);
});

test("a propria live nao conta no proprio segmento: 'nunca garantiram vaga em nenhuma live' nao tira quem garantiu a vaga nela", () => {
  // Sem a ancora (para isolar a regra): os fatos ja trazem a vaga nesta live, como a RPC devolve logo depois do clique.
  const lido = (registered) => ({
    ...carregado(true),
    context: { ...carregado(true).context, webinarFactsLoaded: true },
    facts: [{ ...carregado(true).facts[0], webinars: { attended: [], registered } }]
  });
  const either = webinar("either", { audience: NUNCA_GARANTIU_VAGA });
  const semAncora = (registered) => ({ ...fatos(), loaded: lido(registered) });

  assert.equal(access.hasWebinarAccess(semAncora([]), either), true, "antes da vaga: no segmento");
  assert.equal(access.hasWebinarAccess(semAncora([WEBINAR]), either), true, "depois da vaga nesta live: continua (a propria live nao conta)");
  assert.equal(access.hasWebinarAccess(semAncora([OUTRO, WEBINAR]), either), false, "a vaga em outra live tira, como a regra diz");
  assert.equal(access.hasWebinarAccess(semAncora([WEBINAR]), webinar("audience", { audience: NUNCA_GARANTIU_VAGA })), true);
});

test("Todos abre; a equipe sempre entra; modo desconhecido fecha; Produto ou segmento abre com um dos dois", () => {
  const either = webinar("either");

  assert.equal(access.hasWebinarAccess(fatos({ produto: true }), either), true);
  assert.equal(access.hasWebinarAccess(fatos({ noSegmento: true }), either), true);
  assert.equal(access.hasWebinarAccess(fatos(), either), false);
  assert.equal(access.hasWebinarAccess(fatos(), webinar("everyone")), true);

  for (const accessMode of model.ACCESS_MODES) {
    assert.equal(access.hasWebinarAccess(fatos({ equipe: true }), webinar(accessMode)), true, `equipe em ${accessMode}`);
  }
  assert.equal(access.hasWebinarAccess(fatos({ noSegmento: true, produto: true }), webinar("outro-modo")), false);
});

test("a linha do banco: o both grava 'product' + audience_restricts (o app de antes continua exigindo o produto); valor desconhecido fecha", async () => {
  const rows = await import("../src/server/webinars/rows.ts");
  const { webinarRow } = await import("./support/webinarios-banco-falso.mjs");
  const patch = rows.webinarRowPatch({ ...model.emptyWebinarDraft("live"), accessMode: "both", audience: ENTROU_NA_SEMANA, productId: PRODUTO });

  // Nenhum valor novo no access_mode: o check da 0028 continua, e o app de antes le 'product' (exige o produto),
  // nunca um valor que ele nao conhece (que ele le como 'everyone' e abriria a live para todos).
  assert.deepEqual([patch.access_mode, patch.audience_restricts, patch.product_id], ["product", true, PRODUTO]);
  assert.ok(model.ACCESS_MODE_COLUMN_VALUES.includes(patch.access_mode));
  assert.deepEqual(model.ACCESS_MODE_COLUMN_VALUES, ["everyone", "product", "audience", "either"]);
  for (const accessMode of model.ACCESS_MODE_COLUMN_VALUES) {
    const linha = rows.webinarRowPatch({ ...model.emptyWebinarDraft("live"), accessMode, audience: ENTROU_NA_SEMANA, productId: PRODUTO });
    assert.deepEqual([linha.access_mode, linha.audience_restricts], [accessMode, false], accessMode);
    assert.equal(rows.webinarFromRow(webinarRow({ access_mode: accessMode, audience_restricts: false })).accessMode, accessMode);
  }

  assert.equal(rows.webinarFromRow(webinarRow({ access_mode: "product", audience_restricts: true, product_id: PRODUTO })).accessMode, "both");
  assert.equal(rows.webinarFromRow(webinarRow({ access_mode: "audience", audience_restricts: true })).accessMode, "audience", "a coluna so vale com 'product'");
  assert.equal(rows.webinarFromRow(webinarRow({ access_mode: "product" })).accessMode, "product", "linha sem a coluna (antes da 0030): so o produto");
  assert.equal(rows.webinarFromRow(webinarRow({ access_mode: "um-modo-de-amanha" })).accessMode, "both", "fecha, nunca 'Todos'");
  assert.match(rows.WEBINAR_COLUMNS, /\baudience_restricts\b/);
});

test("previa 'ver como': quem nao tem acesso nao ve o both; com acesso e a equipe, ve", () => {
  assert.equal(student.previewCanSee("student_without_access", "both"), false);
  assert.equal(student.previewCanSee("student_with_access", "both"), true);
  assert.equal(student.previewCanSee("producer", "both"), true);
});

/* ------------------------------------------------------------------------------------------------
 * loadStudentAccessFacts: o que e lido
 * ---------------------------------------------------------------------------------------------- */

/**
 * O banco da aluna: os acessos, o perfil, as lives dela pela RPC communication_webinar_facts (`lives`; `semMigracao`
 * responde como o banco sem a 202610300001) e a equipe vazia (ou a aluna na equipe).
 */
function bancoDaAluna({ acessos = [acesso(PRODUTO)], equipe = false, lives = [], semMigracao = false, vagas = [] } = {}) {
  return scriptedDb((query) => {
    if (query.op === "rpc") {
      if (query.table === "communication_webinar_facts") {
        return semMigracao
          ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.communication_webinar_facts(p_user_ids) in the schema cache" } }
          : { data: lives, error: null };
      }
      return { data: [], error: null };
    }
    switch (query.table) {
      case "admin_roles":
        return { data: equipe ? { permissions: {}, role: "owner" } : null, error: null };
      case "entitlements":
        return { count: acessos.length, data: acessos, error: null };
      case "webinar_registrations":
        return { data: vagas, error: null };
      case "profiles":
        return { data: [{ avatar_url: null, created_at: iso(AGORA - 60 * DIA), email: "ana@exemplo.test", full_name: "Ana Souza", id: ALUNA, last_sign_in_at: iso(AGORA - 30 * DIA), phone: null }], error: null };
      default:
        return { count: 0, data: [], error: null };
    }
  });
}

const rpcs = (db, name) => db.queries.filter((query) => query.op === "rpc" && query.table === name);
const leu = (db, table) => db.queries.some((query) => query.op !== "rpc" && query.table === table);

test("so o que as regras pedem: sem regra de comentarios nem de progresso, nada da contagem de todos os alunos nem do indice de aulas", async () => {
  const db = bancoDaAluna({ acessos: [acesso(PRODUTO, { created_at: iso(AGORA - HORA), starts_at: iso(AGORA - HORA) })] });
  const lista = [webinar("both", { audience: GANHOU_HOJE }), webinar("audience", { audience: GANHOU_HOJE, id: OUTRO })];

  const facts = await access.loadStudentAccessFacts(db, ALUNA, lista, AGORA);

  assert.deepEqual(lista.map((item) => access.hasWebinarAccess(facts, item)), [true, true], "ganhou acesso hoje: dentro do segmento");
  assert.equal(rpcs(db, "communication_comment_counts").length, 0, "nenhuma contagem de comentarios de todos os alunos");
  assert.equal(leu(db, "lessons") || leu(db, "course_modules"), false, "nenhum indice de aulas");
  assert.equal(rpcs(db, "communication_webinar_facts").length, 0, "dentro do segmento, a ancora nem e lida");
  assert.equal(db.queries.filter((query) => query.table === "entitlements").length, 1, "os acessos sao lidos uma vez, para o produto e o segmento");

  // Com regra de comentarios (contagem), a contagem volta; o indice de aulas, nao (comentarios nao usa).
  const comRegras = bancoDaAluna();
  const audience = { kind: "rules", root: { items: [{ count: 1, days: 30, op: "gte", type: "comments" }], match: "all" } };
  await access.loadStudentAccessFacts(comRegras, ALUNA, [webinar("audience", { audience })], AGORA);
  assert.equal(rpcs(comRegras, "communication_comment_counts").length, 1);
  assert.equal(leu(comRegras, "lessons") || leu(comRegras, "course_modules"), false, "comentarios nao usam o indice de aulas");

  // Entrada e ultimo estudo leem o perfil e o progresso, nunca o indice de aulas; progresso, ritmo e turma, sim.
  for (const regra of [{ days: 7, op: "within", type: "sign_in" }, { days: 7, op: "within", type: "last_study" }]) {
    const banco = bancoDaAluna();
    await access.loadStudentAccessFacts(banco, ALUNA, [webinar("audience", { audience: { kind: "rules", root: { items: [regra], match: "all" } } })], AGORA);
    assert.ok(leu(banco, "profiles"), regra.type);
    assert.equal(leu(banco, "lessons") || leu(banco, "course_modules"), false, `${regra.type}: sem o indice de aulas`);
  }
  for (const regra of [{ op: "gte", percent: 50, productId: null, type: "progress" }, { paces: ["inactive"], type: "pace" }, { cohortIds: ["turma-5"], type: "cohort" }]) {
    const banco = bancoDaAluna();
    await access.loadStudentAccessFacts(banco, ALUNA, [webinar("audience", { audience: { kind: "rules", root: { items: [regra], match: "all" } } })], AGORA);
    assert.ok(leu(banco, "lessons") || leu(banco, "course_modules"), `${regra.type}: o indice de aulas volta (a turma de quem tem a plataforma sai dele)`);
  }
});

test("segmento so de acesso, de lives ou de produto: os fatos saem dos acessos ja lidos, sem perfil, progresso nem turmas", async () => {
  const leuOAluno = (db) => ["profiles", "lesson_progress", "cohort_memberships", "lessons", "course_modules"].filter((table) => leu(db, table));
  const hoje = acesso(PRODUTO, { created_at: iso(AGORA - HORA), starts_at: iso(AGORA - HORA) });
  const segmentos = {
    "ganhou acesso hoje": GANHOU_HOJE,
    "nunca garantiu vaga": NUNCA_GARANTIU_VAGA,
    "tem o produto": { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } },
    "acesso hoje e lives": { kind: "rules", root: { items: [GANHOU_HOJE.root.items[0], { action: "attended", negate: false, type: "webinar", webinarId: OUTRO }], match: "any" } }
  };

  for (const [nome, audience] of Object.entries(segmentos)) {
    const db = bancoDaAluna({ acessos: [hoje] });
    const live = webinar("audience", { audience });
    const facts = await access.loadStudentAccessFacts(db, ALUNA, [live], AGORA);

    assert.equal(access.hasWebinarAccess(facts, live), true, nome);
    assert.deepEqual(leuOAluno(db), [], `${nome}: nada de perfil, progresso, turmas nem indice de aulas`);
    assert.equal(rpcs(db, "communication_comment_counts").length, 0);
    assert.equal(rpcs(db, "communication_webinar_facts").length, nome.includes("vaga") || nome.includes("lives") ? 1 : 0, `${nome}: as lives so com a regra, uma vez`);
  }

  // Fora do segmento (a vaga em outra live) e com a vaga nesta: a mesma leitura das lives serve a regra e a ancora.
  const comVaga = bancoDaAluna({ acessos: [hoje], lives: [livesDa(ALUNA, { registered: [OUTRO, WEBINAR] })] });
  const live = webinar("audience", { audience: NUNCA_GARANTIU_VAGA });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(comVaga, ALUNA, [live], AGORA), live), true);
  assert.equal(rpcs(comVaga, "communication_webinar_facts").length, 1);
  assert.deepEqual(leuOAluno(comVaga), []);

  // Com regra de entrada (o perfil decide), o perfil volta.
  const comEntrada = bancoDaAluna();
  await access.loadStudentAccessFacts(comEntrada, ALUNA, [webinar("audience")], AGORA);
  assert.ok(leu(comEntrada, "profiles"));
});

test("o segmento so e lido onde decide: no both sem o produto e no Produto ou segmento com o produto, nada de perfil, progresso, turma ou lives", async () => {
  const comLives = { kind: "rules", root: { items: [{ days: 7, op: "within", type: "sign_in" }, { action: "attended", negate: false, type: "webinar", webinarId: null }], match: "all" } };
  const leuOSegmento = (db) => ["profiles", "lesson_progress", "cohort_memberships", "lessons", "course_modules"].some((table) => leu(db, table)) || rpcs(db, "communication_webinar_facts").length > 0;

  // "both" (produto curso-x) e a aluna sem o curso: a resposta ja e nao.
  const semProduto = bancoDaAluna({ acessos: [acesso("outro-curso")] });
  const both = webinar("both", { audience: comLives });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(semProduto, ALUNA, [both], AGORA), both), false);
  assert.equal(leuOSegmento(semProduto), false, "both sem o produto: o segmento nem e lido");

  // "Produto ou segmento" e a aluna com o curso: a resposta ja e sim.
  const comProduto = bancoDaAluna();
  const either = webinar("either", { audience: comLives });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(comProduto, ALUNA, [either], AGORA), either), true);
  assert.equal(leuOSegmento(comProduto), false, "Produto ou segmento com o produto: o segmento nem e lido");

  // Com o produto no both, o segmento e lido.
  const leBoth = bancoDaAluna();
  await access.loadStudentAccessFacts(leBoth, ALUNA, [both], AGORA);
  assert.ok(leuOSegmento(leBoth));
});

test("a ancora e lida so quando decide, uma vez, para a propria pessoa; banco sem a migracao: sem ancora e sem erro", async () => {
  const ontem = acesso(PRODUTO, { created_at: iso(AGORA - DIA), starts_at: iso(AGORA - DIA) });
  const lives = [livesDa(ALUNA, { registered: [WEBINAR] })];

  // Fora do segmento (ganhou ontem), com o produto e a vaga garantida ontem: continua vendo.
  const db = bancoDaAluna({ acessos: [ontem], lives });
  const both = webinar("both", { audience: GANHOU_HOJE });
  const facts = await access.loadStudentAccessFacts(db, ALUNA, [both], AGORA);
  assert.equal(access.hasWebinarAccess(facts, both), true);
  const [chamada] = rpcs(db, "communication_webinar_facts");
  assert.deepEqual(chamada.args, { p_user_ids: [ALUNA] }, "so as lives da propria pessoa");
  assert.equal(rpcs(db, "communication_webinar_facts").length, 1);

  // Sem a vaga: fora. A presenca numa sessao (entrou na sala) tambem segura.
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(bancoDaAluna({ acessos: [ontem] }), ALUNA, [both], AGORA), both), false);
  const presente = bancoDaAluna({ acessos: [ontem], lives: [livesDa(ALUNA, { attended: [WEBINAR] })] });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(presente, ALUNA, [both], AGORA), both), true);

  // No both sem o produto a ancora nao decide: nada de ler as lives.
  const semProduto = bancoDaAluna({ acessos: [acesso("outro-curso", { created_at: iso(AGORA - DIA), starts_at: iso(AGORA - DIA) })], lives });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(semProduto, ALUNA, [both], AGORA), both), false);
  assert.equal(rpcs(semProduto, "communication_webinar_facts").length, 0);

  // Com uma regra "Participação em lives" no segmento, a mesma leitura serve a regra e a ancora.
  const nuncaParticipou = { kind: "rules", root: { items: [{ action: "attended", negate: true, type: "webinar", webinarId: null }], match: "all" } };
  const participou = bancoDaAluna({ lives: [livesDa(ALUNA, { attended: [WEBINAR], registered: [WEBINAR] })] });
  const comRegra = webinar("audience", { audience: nuncaParticipou });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(participou, ALUNA, [comRegra], AGORA), comRegra), true, "ja participou desta live: a propria live nao conta");
  assert.equal(rpcs(participou, "communication_webinar_facts").length, 1, "uma leitura so");
  const emOutra = bancoDaAluna({ lives: [livesDa(ALUNA, { attended: [OUTRO, WEBINAR], registered: [WEBINAR] })] });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(emOutra, ALUNA, [comRegra], AGORA), comRegra), true, "participou de outra live, mas a vaga nesta segura (a ancora)");
  assert.equal(rpcs(emOutra, "communication_webinar_facts").length, 1, "a mesma leitura serve a regra e a ancora");

  // Reembolsada do produto que o segmento pede: a ancora nao decide e as lives nem sao lidas.
  const reembolsada = bancoDaAluna({ acessos: [acesso(PRODUTO, { status: "revoked" })], lives });
  const ganhouX = webinar("audience", { audience: GANHOU_X_HOJE });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(reembolsada, ALUNA, [ganhouX], AGORA), ganhouX), false);
  assert.equal(rpcs(reembolsada, "communication_webinar_facts").length, 0);

  // Banco sem a 202610300001: vale so o segmento, como antes, e nada quebra.
  const semMigracao = bancoDaAluna({ acessos: [ontem], semMigracao: true });
  const erros = [];
  const original = console.error;
  console.error = (...args) => erros.push(args.join(" "));
  try {
    assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(semMigracao, ALUNA, [both], AGORA), both), false);
  } finally {
    console.error = original;
  }
  assert.ok(erros.some((linha) => linha.includes("202610300001")), erros.join("\n"));
});

test("Produto ou segmento: a ancora nunca e lida (nem as vagas nem as presencas da pessoa), so o segmento de agora", async () => {
  const live = webinar("either", { audience: GANHOU_HOJE, productId: "mentoria" });
  const ebook = acesso("ebook", { created_at: iso(AGORA - 300 * DIA), starts_at: iso(AGORA - 300 * DIA) });
  const lives = [livesDa(ALUNA, { registered: [WEBINAR] })];
  const vagas = [{ registered_at: iso(AGORA - 2 * DIA), status: "registered", user_id: ALUNA, webinar_id: WEBINAR }];

  // Fora do segmento, com a vaga, um ebook antigo e a Mentoria reembolsada: nao ve, e nada da vaga e lido.
  const db = bancoDaAluna({ acessos: [ebook, acesso("mentoria", { status: "revoked" })], lives, vagas });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(db, ALUNA, [live], AGORA), live), false);
  assert.equal(rpcs(db, "communication_webinar_facts").length, 0, "nada das lives da pessoa");
  assert.equal(leu(db, "webinar_registrations"), false, "nada das vagas");

  // Com um acesso de hoje (no segmento agora): ve, sem ler a vaga.
  const hoje = bancoDaAluna({ acessos: [ebook, acesso("curso-y", { created_at: iso(AGORA - HORA), starts_at: iso(AGORA - HORA) })], lives, vagas });
  assert.equal(access.hasWebinarAccess(await access.loadStudentAccessFacts(hoje, ALUNA, [live], AGORA), live), true);
  assert.equal(rpcs(hoje, "communication_webinar_facts").length + hoje.queries.filter((query) => query.table === "webinar_registrations").length, 0);
});

test("a equipe nao le acessos, segmento nem ancora", async () => {
  const db = bancoDaAluna({ equipe: true });
  const facts = await access.loadStudentAccessFacts(db, ALUNA, [webinar("both", { audience: GANHOU_HOJE })], AGORA);

  assert.equal(facts.isStaff, true);
  assert.deepEqual(
    db.queries.map((query) => query.table),
    ["admin_roles"]
  );
});

/* ------------------------------------------------------------------------------------------------
 * Editor: modelo e zod
 * ---------------------------------------------------------------------------------------------- */

const draftBoth = (extra = {}) => ({ ...model.emptyWebinarDraft("live"), accessMode: "both", audience: GANHOU_HOJE, productId: PRODUTO, ...extra });

test("editor: a pilula nova, a frase de quem ve, o produto guardado e a dica 'Vale na hora' sem os 15 min", () => {
  assert.deepEqual(
    vm.ACCESS_MODE_OPTIONS.map((option) => [option.value, option.label]),
    [
      ["everyone", "Todos"],
      ["product", "Quem tem o produto"],
      ["audience", "Segmento"],
      ["either", "Produto ou segmento"],
      ["both", "Quem tem o produto e está no segmento"]
    ]
  );
  assert.deepEqual(vm.ACCESS_MODE_OPTIONS.map((option) => option.value), [...model.ACCESS_MODES], "uma pilula por modo do banco");
  assert.equal(vm.accessUsesProduct("both"), true);
  assert.equal(vm.accessUsesAudience("both"), true);
  assert.equal(vm.describeWebinarAccess({ accessMode: "both", capacity: null, registrationRequired: true }, "Curso X"), "quem tem Curso X e está no segmento");
  assert.equal(vm.canonicalWebinarDraft(draftBoth()).productId, PRODUTO, "o both guarda o produto");
  assert.equal(vm.canonicalWebinarDraft(draftBoth({ accessMode: "audience" })).productId, null);

  assert.equal(vm.webinarAccessHint("audience"), "Vale na hora. Quem garantiu vaga continua vendo, mesmo se sair do segmento. O produto e a turma que o segmento pede são conferidos sempre.");
  assert.equal(vm.webinarAccessHint("both"), vm.webinarAccessHint("audience"));
  // Produto ou segmento: sem ancora, nem a vaga nem ter entrado na sala seguram (quem sai do segmento sem o produto no
  // meio da live e cortado quando o acesso guardado da sala vence); e como segurar a vaga (o Segmento com o produto).
  const either = vm.webinarAccessHint("either");
  assert.equal(
    either,
    "Vale na hora, e aqui nem a vaga nem ter entrado na sala seguram: quem sair do segmento sem o produto, mesmo no meio da live, sai da sala e não consegue voltar. Para segurar, use Segmento com o produto como uma das regras (por exemplo, “tem o produto X” ou “ganhou acesso hoje”)."
  );
  assert.equal(vm.webinarAccessHint("product"), null);
  assert.equal(vm.webinarAccessHint("everyone"), null);
  assert.ok(!JSON.stringify(vm.WEBINAR_ADMIN_COPY).includes("15 min."), "nenhum recalculo em faixas prometido");
  const dicas =
    vm.WEBINAR_ADMIN_COPY.fields.accessSegmentHint +
    vm.WEBINAR_ADMIN_COPY.fields.accessTimeRuleNoSeat +
    vm.WEBINAR_ADMIN_COPY.fields.accessEitherHint +
    vm.WEBINAR_ADMIN_COPY.fields.accessTimeRuleEither;
  assert.ok(!/sessão/i.test(dicas));
  for (const palavra of PROIBIDAS_WEBINARIO) {
    assert.ok(!dicas.toLocaleLowerCase("pt-BR").includes(palavra), palavra);
  }
});

test("editor: aviso com regra de tempo e 'Entrar direto, sem vaga', no Segmento e no both (onde a vaga e a ancora)", () => {
  const aviso = vm.WEBINAR_ADMIN_COPY.fields.accessTimeRuleNoSeat;

  assert.equal(vm.webinarAccessNotice(draftBoth({ registrationRequired: false })), aviso);
  assert.equal(vm.webinarAccessNotice(draftBoth({ accessMode: "audience", registrationRequired: false })), aviso);
  assert.equal(vm.webinarAccessNotice(draftBoth({ registrationRequired: true })), null, "com Garantir vaga, a vaga segura");
  assert.equal(vm.webinarAccessNotice(draftBoth({ audience: ENTROU_NA_SEMANA, registrationRequired: false })), null, "sem regra de tempo");
  assert.equal(vm.webinarAccessNotice(draftBoth({ accessMode: "product", registrationRequired: false })), null, "sem segmento");
  assert.equal(vm.webinarAccessNotice(draftBoth({ accessMode: "everyone", registrationRequired: false })), null, "sem segmento");
  const emGrupo = { kind: "rules", root: { items: [{ items: [GANHOU_HOJE.root.items[0], ENTROU_NA_SEMANA.root.items[0]], match: "any" }], match: "all" } };
  assert.equal(vm.webinarAccessNotice(draftBoth({ audience: emGrupo, registrationRequired: false })), aviso, "a regra dentro de um grupo tambem conta");
  for (const palavra of PROIBIDAS_WEBINARIO) {
    assert.ok(!aviso.toLocaleLowerCase("pt-BR").includes(palavra), palavra);
  }
});

test("editor: no Produto ou segmento, a regra de tempo mostra o aviso com ou sem Garantir vaga (sem ancora, ela vence ate no meio da live)", () => {
  // A live das 23:30 as 00:30 com "Curso P ou ganhou acesso hoje": a aluna sem P que entrou na sala as 23:30 sai a
  // meia-noite. Nem a vaga nem a presenca seguram no "either"; o card avisa nos dois casos.
  const aviso = vm.WEBINAR_ADMIN_COPY.fields.accessTimeRuleEither;
  const either = (extra) => draftBoth({ accessMode: "either", ...extra });

  assert.equal(vm.webinarAccessNotice(either({ registrationRequired: true })), aviso, "com Garantir vaga: a vaga nao segura");
  assert.equal(vm.webinarAccessNotice(either({ registrationRequired: false })), aviso, "sem vaga");
  assert.equal(vm.webinarAccessNotice(either({ audience: ENTROU_NA_SEMANA, registrationRequired: true })), null, "sem regra de tempo");
  assert.match(aviso, /com vaga ou sem, mesmo no meio da live/);
  assert.notEqual(aviso, vm.WEBINAR_ADMIN_COPY.fields.accessTimeRuleNoSeat);
  for (const palavra of PROIBIDAS_WEBINARIO) {
    assert.ok(!aviso.toLocaleLowerCase("pt-BR").includes(palavra), palavra);
  }

  // O comportamento que o aviso descreve: ja tendo entrado na sala (a presenca entra nas ancoras), fora do segmento e sem
  // o produto, o "either" fecha a live; no Segmento a mesma presenca segura.
  const live = webinar("either", { audience: GANHOU_HOJE, productId: "curso-p" });
  // O acesso de ontem (o "hoje" ja passou), ainda aberto: sem o P e fora do segmento agora.
  const ontem = [acesso("ebook", { created_at: iso(AGORA - DIA), starts_at: iso(AGORA - DIA) })];
  const entrouNaSala = { ...fatos({ ancoras: [WEBINAR] }), entitlements: ontem, loaded: carregadoCom(ontem) };
  assert.equal(access.hasWebinarAccess(entrouNaSala, live), false, "either: a presenca nao segura");
  assert.equal(access.hasWebinarAccess(entrouNaSala, webinar("audience", { audience: GANHOU_HOJE })), true, "Segmento: a presenca e a ancora");
});

test("editor: a contagem do both conta o produto junto do segmento, sempre num segmento valido", () => {
  const produto = { op: "has", productIds: [PRODUTO], type: "product" };
  const [hoje] = GANHOU_HOJE.root.items;
  const [semana] = ENTROU_NA_SEMANA.root.items;
  const valido = (definition) => audienceDefinitionSchema.safeParse(definition).success;

  // "todas": o produto entra solto junto das regras.
  const todas = vm.webinarCountAudience(draftBoth());
  assert.deepEqual(todas, { kind: "rules", root: { items: [produto, hoje], match: "all" } });

  // "qualquer" sem grupos: o grupo entra inteiro.
  const qualquer = { kind: "rules", root: { items: [hoje, semana], match: "any" } };
  assert.deepEqual(vm.webinarCountAudience(draftBoth({ audience: qualquer })), { kind: "rules", root: { items: [produto, qualquer.root], match: "all" } });

  // "qualquer" com grupo dentro: cada caminho ganha o produto (sem passar de um grupo dentro do principal).
  const fundo = { kind: "rules", root: { items: [hoje, { items: [semana, hoje], match: "all" }, { items: [semana], match: "any" }], match: "any" } };
  const distribuida = vm.webinarCountAudience(draftBoth({ audience: fundo }));
  assert.deepEqual(distribuida, {
    kind: "rules",
    root: {
      items: [
        { items: [produto, hoje], match: "all" },
        { items: [produto, semana, hoje], match: "all" },
        { items: [produto, semana], match: "all" }
      ],
      match: "any"
    }
  });
  for (const definition of [todas, vm.webinarCountAudience(draftBoth({ audience: qualquer })), distribuida]) {
    assert.ok(valido(definition), JSON.stringify(definition));
  }

  // Sem segmento: so o produto; sem produto ou fora do both: o segmento como esta.
  assert.deepEqual(vm.webinarCountAudience(draftBoth({ audience: { kind: "everyone" } })), { kind: "rules", root: { items: [produto], match: "all" } });
  assert.deepEqual(vm.webinarCountAudience(draftBoth({ productId: null })), GANHOU_HOJE);
  assert.deepEqual(vm.webinarCountAudience(draftBoth({ accessMode: "either" })), GANHOU_HOJE);
});

test("zod: o both exige o produto e um segmento; a regra de lives nao aponta para o proprio webinario", () => {
  const issueAt = (result, path) => result.error?.issues.find((issue) => issue.path.join(".") === path)?.message;

  assert.ok(schemas.webinarDraftSchema.safeParse(draftBoth()).success);
  assert.equal(issueAt(schemas.webinarDraftSchema.safeParse(draftBoth({ productId: null })), "productId"), schemas.WEBINAR_MESSAGES.accessProduct);
  assert.equal(issueAt(schemas.webinarDraftSchema.safeParse(draftBoth({ audience: { kind: "everyone" } })), "audience"), "Monte o segmento ou escolha só o produto.");
  assert.deepEqual(
    schemas.publishProblems(draftBoth({ audience: { kind: "everyone" }, productId: null }), AGORA).filter((problem) => ["audience", "productId"].includes(problem.path)),
    [
      { message: schemas.WEBINAR_MESSAGES.accessProduct, path: "productId" },
      { message: schemas.WEBINAR_MESSAGES.accessAudience, path: "audience" }
    ]
  );

  const propria = { action: "attended", negate: true, type: "webinar", webinarId: WEBINAR };
  const outra = { ...propria, webinarId: OUTRO };
  const audience = { kind: "rules", root: { items: [GANHOU_HOJE.root.items[0], { items: [outra, propria], match: "any" }], match: "all" } };
  const salvo = schemas.saveWebinarSchema.safeParse({ draft: draftBoth({ audience }), id: WEBINAR });
  assert.equal(salvo.success, false);
  assert.deepEqual(
    salvo.error.issues.map((issue) => [issue.path.join("."), issue.message]),
    [["draft.audience.root.items.1.items.1", schemas.WEBINAR_MESSAGES.accessSelfRule]]
  );
  assert.ok(schemas.saveWebinarSchema.safeParse({ draft: draftBoth({ audience }), id: OUTRO }).success === false, "em outro webinario, a regra que aponta para ele e recusada");
  assert.ok(schemas.saveWebinarSchema.safeParse({ draft: draftBoth({ audience: { kind: "rules", root: { items: [outra], match: "all" } } }), id: WEBINAR }).success, "outra live passa");
  assert.ok(schemas.saveWebinarSchema.safeParse({ draft: draftBoth({ audience }) }).success, "o novo (sem id) ainda nao tem como apontar para si");
  assert.deepEqual(vm.webinarErrorsFromAction({ "draft.audience.root.items.1.items.1": [schemas.WEBINAR_MESSAGES.accessSelfRule] }), { "audience.root.items.1.items.1": schemas.WEBINAR_MESSAGES.accessSelfRule });
});

test("Limite de vagas no Produto ou segmento (D41): recusado no salvar e no publicar, porque a vaga de quem entrou pelo 'hoje' fica morta no dia seguinte; no Segmento com o produto como regra ela continua valendo", () => {
  // "Curso P ou ganhou acesso hoje", Limite de vagas 100, live amanha as 20h. Hoje a aluna, sem o P, ganha acesso a
  // outro produto e garante a vaga pelo "hoje". AGORA e o dia seguinte: o acesso dela e de ontem.
  const issueAt = (result, path) => result.error?.issues.find((issue) => issue.path.join(".") === path)?.message;
  const pOuHoje = { kind: "rules", root: { items: [{ op: "has", productIds: ["curso-p"], type: "product" }, GANHOU_HOJE.root.items[0]], match: "any" } };
  const ontem = [acesso("ebook", { created_at: iso(AGORA - DIA), starts_at: iso(AGORA - DIA) })];
  const daAluna = { ...fatos({ ancoras: [WEBINAR] }), entitlements: ontem, loaded: carregadoCom(ontem) };
  const registrante = { entitlements: ontem, now: AGORA, userId: ALUNA };

  // Produto ou segmento: no dia seguinte ela nao ve a live, nao recebe aviso e nao consegue soltar a vaga (a pagina da
  // 404), mas a vaga contaria no limite e daria "Esgotado" a quem entra no segmento amanha. Por isso o limite e recusado.
  const either = webinar("either", { audience: GANHOU_HOJE, productId: "curso-p" });
  assert.equal(access.hasWebinarAccess(daAluna, either), false, "either: a vaga nao segura");
  assert.equal(access.registrantHasWebinarAccess(either, registrante), false);
  const eitherComLimite = draftBoth({ accessMode: "either", audience: GANHOU_HOJE, capacity: 100, productId: "curso-p", registrationRequired: true });
  const recusado = schemas.webinarDraftSchema.safeParse(eitherComLimite);
  assert.equal(issueAt(recusado, "capacity"), schemas.WEBINAR_MESSAGES.capacityEither);
  assert.match(schemas.WEBINAR_MESSAGES.capacityEither, /use Segmento com o produto como uma das regras/);
  assert.equal(vm.webinarErrorsFrom(recusado.error.issues).capacity, schemas.WEBINAR_MESSAGES.capacityEither, "a tela mostra no campo Limite de vagas");
  assert.equal(issueAt(schemas.saveWebinarSchema.safeParse({ draft: eitherComLimite, id: WEBINAR }), "draft.capacity"), schemas.WEBINAR_MESSAGES.capacityEither, "o servidor recusa o salvar (e o publicar le o mesmo zod)");
  assert.ok(schemas.webinarDraftSchema.safeParse({ ...eitherComLimite, capacity: null }).success, "sem limite, o Produto ou segmento passa (com o aviso da regra de tempo)");
  for (const palavra of PROIBIDAS_WEBINARIO) {
    assert.ok(!schemas.WEBINAR_MESSAGES.capacityEither.toLocaleLowerCase("pt-BR").includes(palavra), palavra);
  }

  // Segmento com o produto como uma das regras ("Curso P" ou "ganhou acesso hoje"): o limite passa e, no dia seguinte, a
  // vaga dela continua valendo (a ancora): ela ve, recebe os avisos e entra, entao a vaga no limite e de quem vem.
  const segmento = webinar("audience", { audience: pOuHoje });
  assert.equal(access.hasWebinarAccess(daAluna, segmento), true, "Segmento: a vaga segura no dia seguinte");
  assert.equal(access.registrantHasWebinarAccess(segmento, registrante), true);
  assert.ok(schemas.webinarDraftSchema.safeParse(draftBoth({ accessMode: "audience", audience: pOuHoje, capacity: 100, productId: null, registrationRequired: true })).success);
  assert.ok(schemas.webinarDraftSchema.safeParse(draftBoth({ capacity: 100, registrationRequired: true })).success, "Quem tem o produto e está no segmento: o limite passa");
});

/* ------------------------------------------------------------------------------------------------
 * O card Quem pode desenhado
 * ---------------------------------------------------------------------------------------------- */

const OPCOES = {
  cohorts: [],
  currentUserId: null,
  currentUserName: null,
  names: { cohorts: {}, notices: {}, products: { [PRODUTO]: "Curso X" }, segments: {}, webinars: {} },
  notices: [],
  people: [],
  peopleLoaded: true,
  products: [],
  productsLoaded: true,
  segments: [],
  webinars: [
    { id: WEBINAR, startsAt: "2026-11-05T23:00:00.000Z", title: "Live de hoje" },
    { id: OUTRO, startsAt: "2026-10-29T23:00:00.000Z", title: "Live da semana passada" }
  ]
};

function card(draft, webinarId = WEBINAR) {
  return renderToStaticMarkup(
    createElement(AccessCard, {
      audienceDescription: "",
      audienceErrors: {},
      countState: { status: "incomplete" },
      disabled: false,
      draft,
      errorFor: () => undefined,
      now: AGORA,
      onBlur: () => undefined,
      onChange: () => undefined,
      onRetryCount: () => undefined,
      options: OPCOES,
      pickerItems: [],
      webinarId
    })
  );
}

const texto = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

test("card Quem pode: a pilula do both, a dica nova, o aviso com regra de tempo sem vaga e o seletor de lives sem a propria live", () => {
  // Duas regras de lives: uma na live da semana passada e uma (gravada antes, por exemplo) na propria live.
  const naOutra = { action: "attended", negate: false, type: "webinar", webinarId: OUTRO };
  const naPropria = { ...naOutra, webinarId: WEBINAR };
  const audience = { kind: "rules", root: { items: [GANHOU_HOJE.root.items[0], naOutra, naPropria], match: "all" } };
  const comVaga = card(draftBoth({ audience }));
  const comVagaTexto = texto(comVaga);

  assert.match(comVagaTexto, /Quem tem o produto e está no segmento/);
  assert.match(comVagaTexto, /Vale na hora\. Quem garantiu vaga continua vendo, mesmo se sair do segmento\. O produto e a turma que o segmento pede são conferidos sempre\./);
  assert.doesNotMatch(comVagaTexto, /15 min/);
  assert.doesNotMatch(comVaga, /data-webinar-access-notice/, "com Garantir vaga, sem aviso");
  assert.match(comVagaTexto, /Live da semana passada · 29\/10/, "as outras lives estao no seletor");
  assert.doesNotMatch(comVagaTexto, /Live de hoje/, "a propria live nunca e oferecida");
  assert.match(comVagaTexto, /Live fora da lista/, "a regra que ja apontava para a propria live aparece fora da lista");

  // Webinario novo (sem id): todas as lives entram.
  assert.match(texto(card(draftBoth({ audience }), null)), /Live de hoje · 05\/11/);

  const semVaga = card(draftBoth({ audience, registrationRequired: false }));
  assert.match(semVaga, /data-webinar-access-notice/);
  assert.match(texto(semVaga), /Sem Garantir vaga, quem sair do segmento antes de entrar na sala deixa de ver a live/);

  // Produto ou segmento: sem ancora, a dica diz que nem a vaga nem a sala seguram (e como segurar), e o aviso da regra de
  // tempo aparece com Garantir vaga ligado (a vaga nao segura).
  const either = card(draftBoth({ accessMode: "either", registrationRequired: true }));
  assert.match(
    texto(either),
    /Vale na hora, e aqui nem a vaga nem ter entrado na sala seguram: quem sair do segmento sem o produto, mesmo no meio da live, sai da sala e não consegue voltar\. Para segurar, use Segmento com o produto como uma das regras \(por exemplo, “tem o produto X” ou “ganhou acesso hoje”\)\./
  );
  assert.doesNotMatch(texto(either), /Quem garantiu vaga continua vendo/);
  assert.match(either, /data-webinar-access-notice/);
  assert.match(texto(either), /Quem entrou pela regra de tempo e não tem o produto sai quando ela vence \(quando o dia vira, por exemplo\), com vaga ou sem, mesmo no meio da live\./);
  assert.doesNotMatch(texto(either), /Sem Garantir vaga/);

  for (const markup of [comVaga, semVaga, either]) {
    const lower = texto(markup).toLocaleLowerCase("pt-BR");
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${palavra}" no card`);
    }
  }
});

test("card Quem pode: a frase embaixo do numero descreve o segmento como a equipe montou, sem a troca da propria live", () => {
  // O revisor: num rascunho (fora da lista de lives) a frase dizia "uma live removida"; publicado, "na live Esta live".
  const nomes = { ...OPCOES.names };
  const draft = { ...model.emptyWebinarDraft("live"), accessMode: "audience", audience: NUNCA_GARANTIU_VAGA, productId: null };
  const frase = vm.webinarAudienceDescription(draft, nomes);

  assert.equal(frase, audienceModel.describeAudience(NUNCA_GARANTIU_VAGA, nomes));
  assert.doesNotMatch(frase, /removida|nesta live|Esta live|Live de hoje/);
  assert.equal(vm.webinarAudienceDescription(draft, { ...nomes, webinars: { [WEBINAR]: "Esta live" } }), frase, "publicado: a mesma frase");
  // O numero continua com a troca (nao cai a cada vaga nesta live); a frase, nao.
  assert.notDeepEqual(vm.webinarCountAudience(draft, WEBINAR), audienceModel.normalizeAudience(NUNCA_GARANTIU_VAGA));
  // "both": o produto junto, como o numero.
  assert.match(vm.webinarAudienceDescription(draftBoth({ audience: NUNCA_GARANTIU_VAGA }), nomes), /Curso X/);

  // Na tela, com a contagem pronta.
  const markup = renderToStaticMarkup(
    createElement(AccessCard, {
      audienceDescription: frase,
      audienceErrors: {},
      countState: { count: 3, sample: [], status: "ready" },
      disabled: false,
      draft,
      errorFor: () => undefined,
      now: AGORA,
      onBlur: () => undefined,
      onChange: () => undefined,
      onRetryCount: () => undefined,
      options: OPCOES,
      pickerItems: [],
      webinarId: WEBINAR
    })
  );
  assert.ok(texto(markup).includes(frase), texto(markup));
  assert.doesNotMatch(texto(markup), /removida/);
});
