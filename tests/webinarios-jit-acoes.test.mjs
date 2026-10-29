import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import {
  HOUR,
  JIT_ON,
  LIVE_WEBINAR,
  MIN,
  RECORDING,
  WEBINAR,
  bancoDoJit,
  escolaDoJit,
  pgIso,
  recordingRow,
  sessionRow
} from "./support/webinarios-v4-jit-banco.mjs";

// As Server Actions do "Comeca quando voce entra" e o Duplicar da fase 4 (docs/30 §2.2, §2.3, §2.6, §8.6, D10 e D25;
// docs/18 §2.2), sem banco: o banco do just-in-time em memoria, a permissao por um duble (sem messaging.publish recusa
// o que liga algo simulado com 403; sem messaging.write recusa tudo), o nome de quem decide pelo duble da sessao e
// "next/cache" so anotando. Aqui: a caixa de §8.6 obrigatoria com algo simulado e a frase de hoje com o nome de quem
// decide; quem decidiu e quando sao do servidor; a mesma decisao segue quando so a janela muda; ligar pede o video; so
// a Live gravada nao cancelada; a auditoria com os valores e sem textos; a versao nova do webinario na resposta; as
// sessoes que nasceram hoje; e duplicar copia a Oferta (rascunho), o Assistente (desligado) e o jit (desligado, sem a
// decisao).

const estado = (globalThis.__jitAcoes ??= { negar: [], revalidados: [] });
const PRODUTORA = "00000000-0000-4000-8000-0000000000f1";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole(action) {
          if (globalThis.__jitAcoes.negar.includes(action)) {
            const error = new Error("Sem permissão para Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === "@/server/auth/session") {
      const source = `
        export async function getAuthenticatedUser() { return globalThis.__adminActionStubs.role.user; }
        export async function getAdminAccessForUser() { return null; }
        export function getUserDisplayName(user) {
          const fullName = (user.user_metadata?.full_name ?? "").trim() || (user.email?.split("@")[0] ?? "Aluno");
          return { fullName, name: fullName.split(/\\s+/)[0] || "Aluno" };
        }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier.endsWith("/db/supabase/client")) {
      const source = `
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    if (specifier === "next/cache") {
      const source = `
        export function revalidatePath(path) { globalThis.__jitAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__jitAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__jitAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "produtora@bunker707.test", id: PRODUTORA, user_metadata: { full_name: "Produtora de Teste" } } };

const actions = await import("../src/server/webinars/jit-actions.ts");
const webinarActions = await import("../src/server/webinars/actions.ts");
const { JIT_MESSAGES } = await import("../src/server/webinars/jit-schemas.ts");
const { normalizeSimulationRules, simulationAckFor } = await import("../src/server/webinars/simulation-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

function usar(options = {}) {
  const db = bancoDoJit({ tables: escolaDoJit(options) });
  actionStubs.db = db;
  estado.negar = [];
  estado.revalidados.length = 0;
  return db;
}

const ok = (result) => {
  assert.equal(result.ok, true, result.ok ? "" : `${result.status} ${result.error} ${JSON.stringify(result.fieldErrors ?? {})}`);
  return result.data;
};
const webinar = (db, id = WEBINAR) => db.tables.webinars.find((row) => row.id === id);
const auditorias = (db) => db.tables.admin_audit_log.filter((row) => row.action === "webinar.jit_saved");

const regras = {
  countRule: { base: 40, jitter: 5, mode: "curve", peak: 120 },
  joins: { enabled: true, everySeconds: 30, max: 20, names: "generic" },
  saleNotices: { enabled: true, items: [{ offsetMs: 12 * MIN, text: "Carlos acabou de garantir a vaga na Formação" }] },
  showLiveBadge: true
};
const frase = (rules = regras, responsible = "Produtora de Teste") => simulationAckFor({ nowMs: Date.now(), responsible, rules: normalizeSimulationRules(rules) });
const pedido = (extra = {}, simulation = null) => ({ settings: { ...JIT_ON, simulation, ...extra }, webinarId: WEBINAR });

test("a caixa de §8.6 e obrigatoria com algo simulado; 403 sem messaging.publish; a frase precisa ser a de hoje com o nome de quem decide", async () => {
  const db = usar({ jit: { ...JIT_ON, enabled: false } });

  const semCaixa = await actions.saveJitSettings(pedido({}, { ...regras }));
  assert.deepEqual([semCaixa.status, semCaixa.fieldErrors?.["settings.simulation.acknowledged"]?.[0]], [400, JIT_MESSAGES.ack]);
  for (const so of [{ showLiveBadge: true }, { countRule: { base: 5, jitter: 0, mode: "fixed", peak: 5 } }, { joins: regras.joins }, { saleNotices: regras.saleNotices }]) {
    assert.equal((await actions.saveJitSettings(pedido({}, so))).status, 400, `${Object.keys(so)[0]} sozinho pede a caixa`);
  }

  estado.negar = ["messaging.publish"];
  const negado = await actions.saveJitSettings(pedido({}, { ...regras, ackText: frase(), acknowledged: true }));
  assert.equal(negado.status, 403, "o selo e os numeros simulados sao de quem publica");
  assert.equal(webinar(db).jit_settings.enabled, false, "nada gravado");
  const semSimulacao = ok(await actions.saveJitSettings(pedido({ everyMinutes: 30 })));
  assert.equal(semSimulacao.settings.everyMinutes, 30, "sem nada simulado, quem so escreve grava");
  estado.negar = ["messaging.write"];
  assert.equal((await actions.saveJitSettings(pedido())).status, 403, "sem messaging.write nada");
  estado.negar = [];

  const outroNome = await actions.saveJitSettings(pedido({}, { ...regras, ackText: frase(regras, "Outra Pessoa"), acknowledged: true }));
  assert.deepEqual([outroNome.status, outroNome.fieldErrors?.["settings.simulation.acknowledged"]?.[0]], [400, WEBINAR_COPY.simulacao.servidor.fraseNaoBate]);
  const outrosNumeros = await actions.saveJitSettings(pedido({}, { ...regras, ackText: frase({ ...regras, saleNotices: { enabled: false, items: [] } }), acknowledged: true }));
  assert.equal(outrosNumeros.status, 400, "a frase diz que os avisos nao aparecem, mas eles estao ligados");
  assert.equal((await actions.saveJitSettings(pedido({ endHour: 8, startHour: 8 }))).fieldErrors?.["settings.endHour"]?.[0], JIT_MESSAGES.hours);
  assert.equal((await actions.saveJitSettings({ ...pedido(), webinarId: "nao-e-id" })).status, 400);
  assert.equal(auditorias(db).length, 1, "so a gravacao sem simulacao");
});

test("grava as regras e a decisao (quem e quando do servidor); a auditoria leva os valores, nunca textos; a versao nova do webinario volta", async () => {
  const db = usar({ jit: { ...JIT_ON, enabled: false } });
  const antes = Date.now();
  const sentenca = frase();
  const salvo = ok(await actions.saveJitSettings(pedido({ lateJoinMinutes: 10 }, { ...regras, ackText: `  ${sentenca} `, acknowledged: true })));

  assert.equal(salvo.settings.enabled, true);
  assert.equal(salvo.settings.lateJoinMinutes, 10);
  assert.equal(salvo.deciderName, "Produtora de Teste");
  assert.equal(salvo.settings.simulation.decidedBy, PRODUTORA);
  assert.ok(Date.parse(salvo.settings.simulation.decidedAt) >= antes, "quando e do servidor");
  assert.equal(salvo.settings.simulation.ackText, sentenca, "a frase marcada, sem os espacos");
  assert.equal(Date.parse(salvo.updatedAt), Date.parse(webinar(db).updated_at), "a versao nova do webinario (jit_settings muda o updated_at)");

  const gravado = webinar(db).jit_settings;
  assert.deepEqual(gravado.simulation.countRule, { base: 40, jitter: 5, mode: "curve", peak: 120 });
  assert.deepEqual(gravado.simulation.joins, { enabled: true, every_seconds: 30, max: 20, names: "generic" }, "no formato das colunas da sessao (docs/30 §4.3)");
  assert.deepEqual(gravado.simulation.saleNotices, { enabled: true, items: [{ offset_ms: 12 * MIN, text: "Carlos acabou de garantir a vaga na Formação" }] });
  assert.equal(gravado.simulation.decidedBy, PRODUTORA);

  const [auditoria] = auditorias(db);
  assert.equal(auditoria.entity_id, WEBINAR);
  assert.equal(auditoria.actor_id, PRODUTORA);
  assert.equal(auditoria.count, 1);
  assert.deepEqual(
    { ...auditoria.metadata },
    {
      count_base: 40,
      count_jitter: 5,
      count_mode: "curve",
      count_peak: 120,
      decided: true,
      decided_by: PRODUTORA,
      enabled: true,
      end_hour: 23,
      every_minutes: 15,
      joins_enabled: true,
      joins_every_seconds: 30,
      joins_max: 20,
      late_join_minutes: 10,
      numbers_simulated: true,
      sale_notices: 1,
      sale_notices_enabled: true,
      show_live_badge: true,
      start_hour: 8,
      was_enabled: false
    }
  );
  assert.doesNotMatch(JSON.stringify(auditoria), /Carlos|Decisão do produtor/, "nem o aviso nem a frase na auditoria");
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}`));

  // So a janela muda, com a frase gravada de volta: a decisao segue como estava (nada de nova decisao).
  const janela = ok(await actions.saveJitSettings(pedido({ everyMinutes: 30, lateJoinMinutes: 10 }, { ...regras, ackText: sentenca, acknowledged: true })));
  assert.equal(janela.settings.everyMinutes, 30);
  assert.equal(janela.settings.simulation.decidedAt, salvo.settings.simulation.decidedAt);
  assert.equal(janela.deciderName, null);
  assert.equal(auditorias(db)[1].metadata.decided, false);

  // Tudo desligado: a Simulacao das sessoes que nascem fica vazia.
  const desligada = ok(await actions.saveJitSettings(pedido({ everyMinutes: 30 }, { countRule: { base: 0, jitter: 0, mode: "off", peak: 0 }, showLiveBadge: false })));
  assert.equal(desligada.settings.simulation, null);
  assert.equal(webinar(db).jit_settings.simulation, null);
});

test("so a Live gravada nao cancelada; ligar pede o video base; desligado sem video grava", async () => {
  const db = usar({ jit: { ...JIT_ON, enabled: false } });
  const aoVivo = await actions.saveJitSettings({ ...pedido(), webinarId: LIVE_WEBINAR });
  assert.deepEqual([aoVivo.status, aoVivo.error], [409, WEBINAR_COPY.jit.servidor.soLiveGravada]);

  db.tables.webinar_recordings = [recordingRow({ bunny_library_id: null, bunny_video_id: null, embed_url: null })];
  const semVideo = await actions.saveJitSettings(pedido());
  assert.deepEqual([semVideo.status, semVideo.fieldErrors?.["settings.enabled"]?.[0]], [400, WEBINAR_COPY.jit.card.semVideo]);
  ok(await actions.saveJitSettings(pedido({ enabled: false, everyMinutes: 60 })));
  assert.equal(webinar(db).jit_settings.everyMinutes, 60);

  const cancelado = usar({ webinar: { cancelled_at: new Date().toISOString() } });
  assert.equal((await actions.saveJitSettings(pedido())).status, 409);
  assert.equal(auditorias(cancelado).length, 0);
});

// O relogio fixo ao meio-dia de Sao Paulo: "5 min atras" nunca cai na vespera (entre 00:00 e 00:05 de SP o relogio de
// verdade quebraria a conta do dia). So o Date: setTimeout e as promessas do banco falso seguem.
const MEIO_DIA_SP = Date.parse("2026-10-29T12:00:00-03:00");

test("loadJitSettings: as regras e so as sessoes jit que nasceram hoje (dia de Sao Paulo)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MEIO_DIA_SP });
  const db = usar();
  const now = Date.now();
  db.tables.webinar_sessions.push(
    sessionRow("cdcdcdcd-0000-4000-8000-000000000001", { jit: true, scheduled_at: pgIso(now - 5 * MIN), status: "live" }),
    sessionRow("cdcdcdcd-0000-4000-8000-000000000002", { jit: true, scheduled_at: pgIso(now - 30 * HOUR), status: "ended" }),
    sessionRow("cdcdcdcd-0000-4000-8000-000000000003", { jit: false, scheduled_at: pgIso(now - 5 * MIN) })
  );
  const data = ok(await actions.loadJitSettings({ webinarId: WEBINAR }));
  assert.deepEqual(data.settings, { ...JIT_ON });
  assert.deepEqual(
    data.sessionsToday.map((session) => session.id),
    ["cdcdcdcd-0000-4000-8000-000000000001"],
    "nem a de ontem nem a marcada"
  );
  assert.match(data.sessionsToday[0].scheduledAt, /Z$/, "a hora em Z, mesmo com o banco devolvendo +00:00");
  estado.negar = ["messaging.write"];
  assert.equal((await actions.loadJitSettings({ webinarId: WEBINAR })).status, 403);
});

test("loadJitSettings na virada do dia: as 00:02 de Sao Paulo a sessao das 23:57 da vespera ja nao e de hoje", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-30T00:02:00-03:00") });
  const db = usar();
  const now = Date.now();
  db.tables.webinar_sessions.push(
    sessionRow("cdcdcdcd-0000-4000-8000-000000000004", { jit: true, scheduled_at: pgIso(now - 5 * MIN), status: "live" }),
    sessionRow("cdcdcdcd-0000-4000-8000-000000000005", { jit: true, scheduled_at: pgIso(now + 13 * MIN), status: "scheduled" })
  );
  const data = ok(await actions.loadJitSettings({ webinarId: WEBINAR }));
  assert.deepEqual(data.sessionsToday.map((session) => session.id), ["cdcdcdcd-0000-4000-8000-000000000005"]);
});

test("duplicar: copia a Oferta (rascunho, com as variantes), o Assistente (desligado, com as perguntas) e o jit (desligado, sem a decisao)", async () => {
  const decidido = {
    ackText: "Decisão do produtor em 28/10/2026: ...",
    countRule: { base: 10, jitter: 0, mode: "fixed", peak: 10 },
    decidedAt: "2026-10-28T15:00:00.000Z",
    decidedBy: PRODUTORA,
    joins: null,
    saleNotices: null,
    showLiveBadge: true
  };
  const db = usar({ jit: { ...JIT_ON, simulation: decidido }, webinar: { assistant_settings: { enabled: true, replyAllDefault: true } } });
  const agora = new Date().toISOString();
  db.tables.webinar_offers.push({
    attribution_days: 7,
    created_at: agora,
    created_by: PRODUTORA,
    deadline_minutes: 30,
    id: "efefefef-0000-4000-8000-000000000001",
    product_id: "prod-formacao",
    show_at_offset_ms: 20 * MIN,
    status: "active",
    title: "Formação",
    trigger_kind: "at_offset",
    updated_at: agora,
    visible_minutes: 15,
    webinar_id: WEBINAR
  });
  for (const label of ["A", "B"]) {
    db.tables.webinar_offer_variants.push({
      badge: null,
      checkout_url: `https://pay.exemplo.test/${label}`,
      coupon: null,
      created_at: agora,
      enabled: true,
      headline: `Variante ${label}`,
      id: `efefefef-0000-4000-8000-00000000000${label === "A" ? 2 : 3}`,
      image_url: null,
      label,
      offer_id: "efefefef-0000-4000-8000-000000000001",
      price_from_label: null,
      price_label: "R$ 997",
      updated_at: agora,
      weight: 1
    });
  }
  db.tables.webinar_assistant_knowledge.push(
    { answer: "Sim, por 1 ano.", created_at: agora, created_by: PRODUTORA, id: "efefefef-0000-4000-8000-000000000010", position: 0, question: "Tem replay?", updated_at: agora, webinar_id: WEBINAR },
    { answer: "Pela área de membros.", created_at: agora, created_by: PRODUTORA, id: "efefefef-0000-4000-8000-000000000011", position: 1, question: "Onde assisto?", updated_at: agora, webinar_id: WEBINAR }
  );

  const copia = ok(await webinarActions.duplicateWebinar({ id: WEBINAR }));
  const nova = webinar(db, copia.id);
  assert.equal(nova.status, "draft");
  assert.equal(db.tables.webinar_sessions.filter((row) => row.webinar_id === copia.id).length, 0, "nenhuma sessao, nem jit");

  const oferta = db.tables.webinar_offers.find((row) => row.webinar_id === copia.id);
  assert.ok(oferta, "a oferta veio");
  assert.equal(oferta.status, "draft");
  assert.equal(oferta.title, "Formação");
  assert.deepEqual(
    db.tables.webinar_offer_variants.filter((row) => row.offer_id === oferta.id).map((row) => row.label).sort(),
    ["A", "B"]
  );

  assert.deepEqual(nova.assistant_settings, { enabled: false, replyAllDefault: true }, "o Assistente vem desligado");
  assert.deepEqual(
    db.tables.webinar_assistant_knowledge.filter((row) => row.webinar_id === copia.id).map((row) => row.question),
    ["Tem replay?", "Onde assisto?"]
  );

  assert.equal(nova.jit_settings.enabled, false, "o jit vem desligado");
  assert.equal(nova.jit_settings.everyMinutes, 15);
  assert.equal(nova.jit_settings.simulation.showLiveBadge, true, "as regras vem");
  assert.deepEqual([nova.jit_settings.simulation.ackText, nova.jit_settings.simulation.decidedAt, nova.jit_settings.simulation.decidedBy], [null, null, null], "a decisao nao: quem liga na copia decide de novo");
  assert.equal(webinar(db).jit_settings.simulation.decidedBy, PRODUTORA, "o original fica como estava");

  const auditoria = db.tables.admin_audit_log.find((row) => row.action === "webinar.duplicated");
  assert.deepEqual([auditoria.metadata.offer_copied, auditoria.metadata.assistant_items, auditoria.metadata.jit_copied], [true, 2, true]);
  const [video] = db.tables.webinar_recordings.filter((row) => row.webinar_id === copia.id);
  const original = db.tables.webinar_recordings.find((row) => row.id === RECORDING);
  assert.equal(video.embed_url, original.embed_url, "o video base vem junto (sem ele o jit da copia nao liga)");
  assert.notEqual(video.id, RECORDING);
});

const queries = await import("../src/server/webinars/queries.ts");
const { emptyWebinarDraft } = await import("../src/server/webinars/model.ts");
const { WEBINAR_MESSAGES } = await import("../src/server/webinars/schemas.ts");

const JIT_HOJE = "cdcdcdcd-0000-4000-8000-0000000000a1";

function rascunhoSemSessao(db) {
  db.tables.webinar_sessions = [];
  const row = webinar(db);
  Object.assign(row, { published_at: null, status: "draft" });
  return row;
}

test("publicar: a Live gravada com o jit ligado publica sem hora marcada; sem o jit pede a sessao; sem o video pede o video", async () => {
  const semJit = usar({ jit: { ...JIT_ON, enabled: false } });
  rascunhoSemSessao(semJit);
  const recusado = await webinarActions.publishWebinar({ id: WEBINAR });
  assert.deepEqual([recusado.status, recusado.fieldErrors?.sessions?.[0]], [400, WEBINAR_MESSAGES.sessionsRequired]);

  const semVideo = usar();
  rascunhoSemSessao(semVideo);
  semVideo.tables.webinar_recordings = [];
  const pedeVideo = await webinarActions.publishWebinar({ id: WEBINAR });
  assert.deepEqual([pedeVideo.status, pedeVideo.fieldErrors?.recordingVideoUrl?.[0]], [400, WEBINAR_MESSAGES.recordingRequired], "o video continua obrigatorio");

  const db = usar();
  rascunhoSemSessao(db);
  const publicado = ok(await webinarActions.publishWebinar({ id: WEBINAR }));
  assert.equal(publicado.status, "published");
  assert.equal(webinar(db).status, "published");
  assert.equal(db.tables.webinar_sessions.length, 0, "nenhuma sessao: elas nascem quando o aluno chega");
});

test("salvar o rascunho publicado: o sincronismo das horas marcadas nunca apaga nem muda a sessao jit", async () => {
  const db = usar();
  const now = Date.now();
  db.tables.webinar_sessions.push(sessionRow(JIT_HOJE, { jit: true, late_join_minutes: 7, recording_id: null, scheduled_at: pgIso(now + 10 * MIN) }));
  const draft = { ...emptyWebinarDraft("simulated"), recordingVideoUrl: recordingRow().embed_url, registrationRequired: true, sessions: [], title: "Agentes quando você entra" };
  ok(await webinarActions.saveWebinarDraft({ draft, id: WEBINAR }));

  assert.equal(db.tables.webinar_sessions.some((row) => row.jit !== true), false, "a hora marcada sem vaga saiu");
  const jit = db.tables.webinar_sessions.find((row) => row.id === JIT_HOJE);
  assert.ok(jit, "a sessao jit ficou");
  assert.deepEqual([jit.late_join_minutes, jit.recording_id], [7, null], "e nada nela mudou");
  assert.equal(db.calls.writes.some((write) => write.table === "webinar_sessions" && write.op === "delete" && JSON.stringify(write.filters).includes(JIT_HOJE)), false);

  const comHora = { ...draft, sessions: [{ lateJoinMinutes: 3, scheduledAt: new Date(now + 10 * MIN).toISOString() }] };
  ok(await webinarActions.saveWebinarDraft({ draft: comHora, id: WEBINAR }));
  const mesmaHora = db.tables.webinar_sessions.filter((row) => Date.parse(row.scheduled_at) === now + 10 * MIN);
  assert.deepEqual(mesmaHora.map((row) => row.jit).sort(), [false, true], "uma hora marcada no mesmo horario de uma jit e outra sessao");
  assert.equal(db.tables.webinar_sessions.find((row) => row.id === JIT_HOJE).late_join_minutes, 7);
});

test("o editor e a lista nao contam nem listam sessoes jit; o editor recebe as regras e as que nasceram hoje", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: MEIO_DIA_SP });
  const db = usar();
  const now = Date.now();
  db.tables.webinar_sessions.push(sessionRow(JIT_HOJE, { jit: true, scheduled_at: pgIso(now - 5 * MIN), started_at: pgIso(now - 5 * MIN), status: "live" }));

  const editor = await queries.getWebinarEditorData(WEBINAR, now);
  assert.deepEqual(editor.sessions.map((session) => session.id), [db.tables.webinar_sessions[0].id], "so a hora marcada");
  assert.equal(editor.draft.sessions.length, 1);
  assert.equal(editor.runningSessionId, null, "a jit no ar nao e a sessao rodando do webinario");
  assert.equal(editor.situation, "scheduled");
  assert.deepEqual(editor.jit, { ...JIT_ON });
  assert.deepEqual(editor.jitSessionsToday.map((session) => [session.id, session.status]), [[JIT_HOJE, "live"]]);

  const lista = await queries.listWebinarsForAdmin({ now, period: { end: new Date(now + 7 * 24 * HOUR), start: new Date(now - 7 * 24 * HOUR) } });
  const item = lista.items.find((row) => row.id === WEBINAR);
  assert.equal(item.sessionsCount, 1, "a jit nao conta");
  assert.equal(item.runningSessionId, null);
  assert.equal(item.situation, "scheduled");
  assert.equal(lista.numbers.liveNow, 0, "nem no Ao vivo agora");
  assert.equal(lista.numbers.webinars, 1, "so a hora marcada no periodo");
});

test("banco sem a 202610290008: ler e gravar respondem 409 com a frase da migracao, nunca o erro cru", async () => {
  const db = usar();
  const original = db.from.bind(db);
  // A coluna webinars.jit_settings (e webinar_sessions.jit) ainda nao existe: o PostgREST responde 42703.
  db.from = (name) => {
    if (name !== "webinars" && name !== "webinar_sessions") {
      return original(name);
    }
    const falha = { data: null, error: { code: "42703", message: `column ${name}.jit does not exist` } };
    const chain = new Proxy({}, { get: (_target, property) => (property === "then" ? (resolve) => resolve(falha) : () => chain) });
    return chain;
  };
  const lido = await actions.loadJitSettings({ webinarId: WEBINAR });
  assert.deepEqual([lido.status, lido.error], [409, WEBINAR_COPY.jit.servidor.precisaMigracao("202610290008")]);
  const gravado = await actions.saveJitSettings(pedido());
  assert.deepEqual([gravado.status, gravado.error], [409, WEBINAR_COPY.jit.servidor.precisaMigracao("202610290008")]);
});
