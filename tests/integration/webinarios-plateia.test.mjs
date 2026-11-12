import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { LIVE_AO_VIVO_DE_TESTE, limparWebinarios, seedEscolaDeTeste, seedLiveAoVivoDeTeste, SENHA_DE_TESTE, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Os participantes simulados mudados a qualquer momento (docs/30 D79 e D80; teste do produtor de 11/11/2026) contra o
// banco LOCAL de verdade, com a migracao 202611140002 aplicada, na Live ao vivo de teste no ar:
// - o aluno logado nao le webinar_simulation_changes (so o service_role);
// - aplicar +300 com a live no ar grava a mudanca (o offset desde o Começar para todos, a regra, a frase, quem e de
//   onde), a decisao da sessao passa a ser a frase dela e a consulta de 5 s do chat leva a sala o resumo novo da decisao
//   (simulationKey); a janela da Simulacao pela rota devolve +300 depois da rampa de 90 s; o retrato do console traz o
//   controle com o numero de agora e quem mudou;
// - sem messaging.publish, recusa (403); nada gravado (a frase e a caixa sairam da tela em 12/11/2026, D85: o servidor
//   grava a frase sozinho);
// - depois do Encerrar live, recusa (409); o tick do resumo junta os trechos de cada regra (o maior numero que a turma
//   viu, igual a conta do modelo com as linhas do banco) e o relatorio da live lista as mudancas.
// - (revisao v8, achado 6) o card do editor aberto antes de uma mudanca feita no console, na espera, recebe 409 com a
//   frase e nao grava por cima; lido de novo, grava (a escrita condicional pela hora da decisao no PostgREST de verdade).
// Nao roda na rodada que escreveu (outras frentes usavam o mesmo banco local); quem junta roda.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const AO_VIVO = LIVE_AO_VIVO_DE_TESTE;
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const aluna = usuarioDeTeste(contas.aluna);

const simulationActions = await import("../../src/server/webinars/simulation-actions.ts");
const simulationModel = await import("../../src/server/webinars/simulation-model.ts");
const simulationStore = await import("../../src/server/webinars/simulation-store.ts");
const simulationRoute = await import("../../src/app/api/webinars/[id]/simulation/route.ts");
const chatRoute = await import("../../src/app/api/webinars/[id]/chat/route.ts");
const liveActions = await import("../../src/server/webinars/live-actions.ts");
const { getConsoleSnapshot } = await import("../../src/server/webinars/console-queries.ts");
const { resetRoomAccessCache } = await import("../../src/server/webinars/room-route.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { clearScreenStateCache } = await import("../../src/server/webinars/screen-queries.ts");
const { SIMULATION_LIMITS } = await import("../../src/server/webinars/model.ts");
const { WEBINAR_COPY } = await import("../../src/lib/webinar-copy.ts");

const RAMP = SIMULATION_LIMITS.countRampSeconds * 1000;
const SEM_NADA = { badgeOn: false, joinsSimulated: false, saleNoticesSimulated: false };
const frase = (extra) => simulationModel.simulationAudienceAckFor({ extra, flags: SEM_NADA, live: true, nowMs: Date.now(), responsible: contas.produtor.nome });
const contexto = { params: Promise.resolve({ id: AO_VIVO.id }) };

before(async () => {
  await limparWebinarios(db);
  await seedLiveAoVivoDeTeste(db, { comecouHa: 10 * 60_000, status: "live" });
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
});

async function janela(fromMs) {
  resetRoomAccessCache();
  actAs(aluna);
  const resposta = await simulationRoute.GET(new Request(`http://localhost/api/webinars/${AO_VIVO.id}/simulation?sessao=${AO_VIVO.sessaoId}&from=${fromMs}&to=${fromMs + 120_000}`), contexto);
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  return corpo.data;
}

/** A consulta de 5 s do chat como a aluna, com um carimbo velho: devolve o estado da Na tela (com o resumo da decisao). */
async function estadoPeloChat() {
  resetRoomLimits();
  clearScreenStateCache();
  actAs(aluna);
  const query = new URLSearchParams({ sessao: AO_VIVO.sessaoId, since: new Date(Date.now() - 5000).toISOString(), tela: "2026-01-01T00:00:00+00:00" });
  const resposta = await chatRoute.GET(new Request(`http://localhost/api/webinars/${AO_VIVO.id}/chat?${query}`), contexto);
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200, JSON.stringify(corpo));
  return corpo.data.screen;
}

test("1. o aluno logado nao le webinar_simulation_changes (so o service_role)", async () => {
  const cliente = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await cliente.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");
  const negado = await cliente.from("webinar_simulation_changes").select("id").limit(1);
  assert.equal(negado.error?.code, "42501", JSON.stringify(negado.error));
  await cliente.auth.signOut();
});

test("2. sem messaging.publish, recusa e nada e gravado", async () => {
  actAs(analista);
  const semPermissao = await simulationActions.saveSimulatedAudience({ extra: 300, sessionId: AO_VIVO.sessaoId });
  assert.equal(semPermissao.status, 403, JSON.stringify(semPermissao));
  const linhas = unwrap(await db.from("webinar_simulation_changes").select("id").eq("session_id", AO_VIVO.sessaoId), "Lendo as mudancas");
  assert.equal(linhas.length, 0);
  actAs(null);
});

test("3. +300 com a live no ar: a mudanca no banco, a decisao da sessao, a sala recebe o resumo novo e a janela devolve +300 depois da rampa; o console ve o controle", async () => {
  const antes = await estadoPeloChat();
  actAs(produtor);
  const texto = frase(300);
  const salvo = await simulationActions.saveSimulatedAudience({ extra: 300, sessionId: AO_VIVO.sessaoId });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));

  const [mudanca] = unwrap(await db.from("webinar_simulation_changes").select("at_offset_ms, count_rule, ack_text, changed_by, source").eq("session_id", AO_VIVO.sessaoId), "Lendo a mudanca");
  assert.ok(Math.abs(mudanca.at_offset_ms - 10 * 60_000) < 30_000, `o offset desde o Começar para todos (${mudanca.at_offset_ms})`);
  assert.deepEqual([mudanca.count_rule.mode, mudanca.count_rule.base, mudanca.ack_text, mudanca.changed_by, mudanca.source], ["fixed", 300, texto, contas.produtor.id, "console"]);
  const sessao = unwrap(await db.from("webinar_sessions").select("simulated_count_rule, simulation_ack_text, simulation_decided_by").eq("id", AO_VIVO.sessaoId).single(), "Lendo a sessao");
  assert.deepEqual([sessao.simulated_count_rule.mode, sessao.simulated_count_rule.base, sessao.simulation_ack_text, sessao.simulation_decided_by], ["fixed", 0, texto, contas.produtor.id], "Real + 0 antes da mudanca; a decisao e a frase dela");

  // A consulta de 5 s que a sala ja faz traz o resumo novo da decisao: a sala pede a janela de novo em segundos.
  const depois = await estadoPeloChat();
  assert.ok(depois.simulationKey, "a decisao registrada vai resumida");
  assert.notEqual(depois.simulationKey, antes.simulationKey ?? "", "o resumo mudou");

  // A janela pela rota: antes da mudanca so o real; depois da rampa, +300 para todos.
  const antesDaMudanca = await janela(Math.max(0, mudanca.at_offset_ms - 130_000));
  assert.ok(antesDaMudanca.counter.every((point) => point.extra === 0), "antes da mudanca, +0 (o real)");
  // A janela comeca no ponto de 15 s em que o pedido cai (o de antes do fim da rampa ainda sobe): um passo de folga.
  const depoisDaRampa = await janela(mudanca.at_offset_ms + RAMP + 15_000);
  assert.equal(depoisDaRampa.enabled, true);
  assert.ok(depoisDaRampa.counter.length > 0 && depoisDaRampa.counter.every((point) => point.extra === 300), JSON.stringify(depoisDaRampa.counter));
  const naRampa = await janela(mudanca.at_offset_ms);
  assert.ok(naRampa.counter.some((point) => point.extra > 0 && point.extra < 300), "no meio da rampa, entre o real e +300");

  const retrato = await getConsoleSnapshot(AO_VIVO.id, AO_VIVO.sessaoId, new Date());
  assert.equal(retrato.audience.current.base, 300);
  assert.equal(retrato.audience.changes[0].changedByName, contas.produtor.nome);
  assert.equal(retrato.audience.pendingMigration, false);
  actAs(null);
});

test("4. depois do Encerrar live, recusa; o resumo do fim junta os trechos de cada regra e o relatorio lista as mudancas", async () => {
  const { runSimulationSummariesTick } = await import("../../src/server/webinars/simulation-tick.ts");
  const { getWebinarReportPage } = await import("../../src/server/webinars/report-queries.ts");
  const { simulationLines } = await import("../../src/server/webinars/report-page-model.ts");
  // O Tirar no ar (+0, sem caixa) antes de encerrar: dois trechos (+300 e o real).
  actAs(produtor);
  const tirar = await simulationActions.saveSimulatedAudience({ extra: 0, sessionId: AO_VIVO.sessaoId, source: "editor" });
  assert.equal(tirar.ok, true, JSON.stringify(tirar));
  // Os trechos ficam no passado para o teste nao esperar a rampa: +300 aos 2 min, o Tirar aos 6 min.
  const linhas = unwrap(await db.from("webinar_simulation_changes").select("id, created_at").eq("session_id", AO_VIVO.sessaoId).order("created_at"), "Lendo as mudancas");
  unwrap(await db.from("webinar_simulation_changes").update({ at_offset_ms: 2 * 60_000 }).eq("id", linhas[0].id), "+300 aos 2 min");
  unwrap(await db.from("webinar_simulation_changes").update({ at_offset_ms: 6 * 60_000 }).eq("id", linhas[1].id), "o Tirar aos 6 min");

  const encerrou = await liveActions.endLiveSession({ sessionId: AO_VIVO.sessaoId });
  assert.equal(encerrou.ok, true, JSON.stringify(encerrou));
  const recusada = await simulationActions.saveSimulatedAudience({ extra: 100, sessionId: AO_VIVO.sessaoId });
  assert.deepEqual([recusada.status, recusada.error], [409, WEBINAR_COPY.simulacao.servidor.plateiaEncerrada]);

  const tick = await runSimulationSummariesTick({ db, now: new Date() });
  assert.equal(tick.frozen, 1, JSON.stringify(tick));
  const sessao = unwrap(await db.from("webinar_sessions").select("started_at, ended_at, simulation_summary").eq("id", AO_VIVO.sessaoId).single(), "Lendo o resumo");
  const simulation = await simulationStore.fetchSessionSimulation(db, AO_VIVO.sessaoId);
  const esperado = simulationModel.simulationTotals(simulation, { endMs: simulationModel.liveSimulationEndOffsetMs({ endedAt: sessao.ended_at, startedAt: sessao.started_at }), videoMs: simulationModel.liveSimulationShapeMs(60) }, true);
  assert.equal(sessao.simulation_summary.counter_max, esperado.counterMax);
  assert.equal(sessao.simulation_summary.counter_max, 300, "o +300 inteiro entre os 2 e os 6 min");

  const page = await getWebinarReportPage(AO_VIVO.id, { sessionId: AO_VIVO.sessaoId });
  const lines = simulationLines(page.selected.simulation);
  assert.ok(lines.includes("Participantes simulados: 2 mudanças"), lines.join("\n"));
  assert.ok(lines.includes(`02:00 · +300 · ${contas.produtor.nome}, pelo console`), lines.join("\n"));
  assert.ok(lines.includes(`06:00 · +0 · ${contas.produtor.nome}, pelo editor`), lines.join("\n"));
  assert.ok((page.selected.report.presence.peak?.n ?? 0) < 300, "o numero real sem a parte simulada");
  actAs(null);
});

test("5. revisao v8, achado 6: o card do editor aberto antes da mudanca feita no console (na espera) nao grava por cima: 409 com a frase; lido de novo, grava sobre a decisao de agora", async () => {
  await limparWebinarios(db);
  await seedLiveAoVivoDeTeste(db, { status: "scheduled" });
  actAs(produtor);
  const ler = async () => {
    const lido = await simulationActions.loadSessionSimulations({ webinarId: AO_VIVO.id });
    assert.equal(lido.ok, true, JSON.stringify(lido));
    return lido.data.simulations.find((item) => item.sessionId === AO_VIVO.sessaoId);
  };
  const carregado = await ler();
  assert.equal(carregado.decidedAt, null);

  // No console, antes do Começar para todos: +200 (a regra da sessao passa a ser a nova).
  const doConsole = await simulationActions.saveSimulatedAudience({ extra: 200, sessionId: AO_VIVO.sessaoId });
  assert.equal(doConsole.ok, true, JSON.stringify(doConsole));

  // O card aberto antes salva o numero dele: recusado, o +200 fica.
  const regras = { countRule: { base: 40, jitter: 0, mode: "fixed", peak: 40 }, joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: false, items: [] }, showLiveBadge: false };
  const recusado = await simulationActions.saveSessionSimulation({ ...regras, expectedDecidedAt: carregado.decidedAt, sessionId: AO_VIVO.sessaoId });
  assert.deepEqual([recusado.status, recusado.error], [409, WEBINAR_COPY.simulacao.servidor.mudouEmOutroLugar]);
  const sessao = unwrap(await db.from("webinar_sessions").select("simulated_count_rule").eq("id", AO_VIVO.sessaoId).single(), "Lendo a sessao");
  assert.equal(sessao.simulated_count_rule.base, 200, "o +200 do console fica");

  // Lido de novo (o Recarregar): a hora como o banco devolve vai de volta, e a escrita condicional do PostgREST passa.
  const recarregado = await ler();
  assert.ok(recarregado.decidedAt);
  const salvo = await simulationActions.saveSessionSimulation({ ...regras, expectedDecidedAt: recarregado.decidedAt, sessionId: AO_VIVO.sessaoId });
  assert.equal(salvo.ok, true, JSON.stringify(salvo));
  const depois = unwrap(await db.from("webinar_sessions").select("simulated_count_rule").eq("id", AO_VIVO.sessaoId).single(), "Lendo a sessao");
  assert.equal(depois.simulated_count_rule.base, 40);
  actAs(null);
});
