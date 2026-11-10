import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { SENHA_DE_TESTE, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "../support/licenca-de-teste.mjs";

// A licença guardada (docs/32 §11.3 e §16; migração 202611100001) contra o banco LOCAL de verdade:
// - RLS sem política com o revoke: anon e a aluna logada recebem 42501 ao ler e ao gravar; só o service_role lê;
// - uma linha só (check), a segunda criação perde, e cada gravação confere a versão lida (a velha não grava nada);
// - o adaptador (store-db.ts) grava só as colunas do patch e lê de volta datas, segredo e marcas como gravou;
// - data inválida no banco (o infinity do Postgres) volta como data inválida e nunca libera nada;
// - os checks do banco e o gatilho do updated_at;
// - a tarefa do tick no modo enforce, pelo runJobsTick e pela tabela de verdade: anda a hora vista um minuto, tenta a
//   conferência com o cliente de hoje ("não configurado"), grava o motivo e o tick fica verde; no modo off, nem toca
//   na tabela;
// - a situação do pedido (getCurrentLicenseState): no modo off, só o modo; no enforce, lê a linha e não grava.
// O modo, as raízes e o endereço são lidos do ambiente na hora (nos testes o Node não grava o build): cada teste os
// liga e o beforeEach os devolve. Só este arquivo cria a linha de license_state (os outros rodam no modo off) e ele
// a apaga antes de cada teste e no fim.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const store = await import("../../src/server/licensing/store.ts");
const { licenseStateDbOf } = await import("../../src/server/licensing/store-db.ts");
const { getCurrentLicenseState } = await import("../../src/server/licensing/current-state.ts");
const { LICENSE_CHECK_IN_JOB_NAME, licenseCheckInJob } = await import("../../src/server/jobs/license-check-in-job.ts");
const { runJobsTick } = await import("../../src/server/jobs/run-tick.ts");

const T = "license_state";
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const ENDERECO = "https://alunos.escola.test";
const SEGREDO = "segredo-de-teste-da-instalacao-0001";
const raiz = novaRaiz("raiz-2026");
// O certificado e a licença ficam em volta de agora (e a licença é vitalícia), para o teste valer em qualquer data do CI.
const emissao = novaChaveDeEmissao(raiz, { notBefore: new Date(Date.now() - 10 * DIA).toISOString(), notAfter: new Date(Date.now() + 300 * DIA).toISOString() });
const emitidaEm = new Date(Math.floor((Date.now() - HORA) / 1000) * 1000);
const licenca = licencaBase({
  issuedAt: emitidaEm.toISOString(),
  expiresAt: new Date(emitidaEm.getTime() + 90 * DIA).toISOString(),
  plan: { kind: "lifetime", steps: [] }
});
const token = assinarLicenca(emissao, licenca);
const adaptador = licenseStateDbOf(db);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();

const AMBIENTE = ["BUNKER_LICENSING_MODE", "BUNKER_LICENSING_ROOTS", "NEXT_PUBLIC_SITE_URL"];
const ambienteAntes = Object.fromEntries(AMBIENTE.map((nome) => [nome, process.env[nome]]));

function devolverAmbiente() {
  for (const nome of AMBIENTE) {
    if (ambienteAntes[nome] === undefined) delete process.env[nome];
    else process.env[nome] = ambienteAntes[nome];
  }
}

function ligarEnforce() {
  process.env.BUNKER_LICENSING_MODE = "enforce";
  process.env.BUNKER_LICENSING_ROOTS = JSON.stringify([raiz.confiavel]);
  process.env.NEXT_PUBLIC_SITE_URL = ENDERECO;
}

async function apagarLinha() {
  unwrap(await db.from(T).delete().gte("id", 0), "Apagando a linha de license_state");
}

/** Uma Instalação ativada e em dia, conferida pela última vez há `desdeAConferencia`. */
function ativada(desdeAConferencia = HORA) {
  const conferida = new Date(Date.now() - desdeAConferencia);
  return {
    token,
    everActivated: true,
    lastSeenAt: emitidaEm,
    lastCheckIn: { emissorTime: conferida, localTime: conferida },
    newestIssuedAt: emitidaEm,
    installationId: "inst_0001",
    installationSecret: SEGREDO,
    checkInSequence: "seq-1",
    checkInAttemptedAt: conferida,
    checkInResult: "ok"
  };
}

beforeEach(async () => {
  devolverAmbiente();
  await apagarLinha();
});

after(async () => {
  devolverAmbiente();
  await apagarLinha();
});

test("RLS: anon e a aluna logada recebem 42501 ao ler e ao gravar (o revoke, não só a RLS sem política); o service_role lê", async () => {
  await adaptador.write({ installationId: "inst_0001", installationSecret: SEGREDO }, null);
  const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const aluna = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await aluna.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");

  for (const [quem, cliente] of [
    ["anon", anon],
    ["aluna", aluna]
  ]) {
    const leitura = await cliente.from(T).select("installation_secret");
    assert.equal(leitura.error?.code, "42501", `${quem} lendo: ${JSON.stringify(leitura.error)}`);
    assert.equal(leitura.data, null);

    const gravacao = await cliente.from(T).update({ ever_activated: true }).eq("id", 1);
    assert.equal(gravacao.error?.code, "42501", `${quem} gravando: ${JSON.stringify(gravacao.error)}`);

    const criacao = await cliente.from(T).insert({ id: 1, ever_activated: true });
    assert.equal(criacao.error?.code, "42501", `${quem} criando: ${JSON.stringify(criacao.error)}`);
  }

  const lida = await adaptador.read();
  assert.equal(lida.installationSecret, SEGREDO);
  assert.equal(lida.everActivated, false, "nada do anon nem da aluna entrou");
});

test("uma linha só: o banco recusa a linha 2 (23514), e a segunda criação da linha 1 perde e devolve null sem mudar nada", async () => {
  const criada = await adaptador.write({ installationId: "inst_0001" }, null);
  assert.equal(criada.version, 1);

  assert.equal(await adaptador.write({ installationId: "inst_9999" }, null), null);
  assert.equal((await adaptador.read()).installationId, "inst_0001");

  const segunda = await db.from(T).insert({ id: 2 });
  assert.equal(segunda.error?.code, "23514", JSON.stringify(segunda.error));
});

test("o adaptador grava só as colunas do patch, confere a versão lida (a velha não grava nada) e lê de volta o que gravou", async () => {
  const agora = new Date(Math.floor(Date.now() / 1000) * 1000 + 123);
  const tudo = {
    ...ativada(),
    unreadableSince: new Date(agora.getTime() - 5 * MINUTO),
    hostMismatchSince: new Date(agora.getTime() - 3 * MINUTO),
    checkInAttemptedAt: agora,
    checkInResult: "em_andamento",
    checkInRequestedAt: new Date(agora.getTime() - MINUTO)
  };

  assert.deepEqual(await adaptador.write(tudo, null), { ...tudo, version: 1 });

  const gravada = await adaptador.write({ checkInResult: "ok", checkInRequestedAt: null }, 1);
  assert.deepEqual(gravada, { ...tudo, checkInResult: "ok", checkInRequestedAt: null, version: 2 }, "o resto da linha ficou");

  assert.equal(await adaptador.write({ checkInResult: "sem_resposta" }, 1), null, "versão velha: nada gravado");
  assert.deepEqual(await adaptador.read(), gravada);
});

test("data inválida no banco (o infinity do Postgres) volta como data inválida: a rodada troca a hora vista pela conta certa e a marca de ilegível congela", async () => {
  await adaptador.write({ ...ativada(), token: null, lastCheckIn: null }, null);
  unwrap(await db.from(T).update({ last_seen_at: "infinity", unreadable_since: "infinity" }).eq("id", 1), "Gravando infinity");

  const lida = await adaptador.read();
  assert.ok(lida.lastSeenAt instanceof Date && Number.isNaN(lida.lastSeenAt.getTime()), "invalida, nunca null");
  assert.ok(Number.isNaN(lida.unreadableSince.getTime()));

  const ler = () =>
    store.loadLicenseState({ mode: "enforce", db: () => adaptador, roots: () => [raiz.confiavel], configuredHost: () => ENDERECO, systemNow: () => new Date() });
  assert.equal((await ler()).evaluation.degree, "escola_congelada", "data inválida nunca libera nada");

  await store.mutateLicenseState(adaptador, (linha) => {
    const plano = store.planLicenseTick(linha, { roots: [raiz.confiavel], configuredHost: ENDERECO, systemNow: new Date() });
    return { patch: plano.patch, outcome: null };
  });

  const depois = await adaptador.read();
  assert.equal(depois.lastSeenAt.toISOString(), new Date(emitidaEm.getTime() + MINUTO).toISOString(), "da licença mais nova aceita, mais um minuto");
  assert.ok(Number.isNaN(depois.unreadableSince.getTime()), "a marca inválida fica como está");
});

test("os checks do banco: licença grande demais, resultado fora do formato, conferência pela metade e versão negativa são recusados (23514)", async () => {
  await adaptador.write({}, null);

  for (const [coluna, valor] of [
    ["token", "x".repeat(16_385)],
    ["check_in_result", "Falhou!"],
    ["last_check_in_emissor_at", new Date().toISOString()],
    ["installation_id", "x".repeat(65)],
    ["check_in_sequence", ""],
    ["version", -1]
  ]) {
    const { error } = await db.from(T).update({ [coluna]: valor }).eq("id", 1);
    assert.equal(error?.code, "23514", `${coluna}: ${JSON.stringify(error)}`);
  }
});

test("updated_at muda pelo gatilho a cada gravação; created_at fica", async () => {
  await adaptador.write({}, null);
  const antes = unwrap(await db.from(T).select("created_at, updated_at").eq("id", 1).single(), "Lendo as datas");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await adaptador.write({ checkInResult: "ok" }, 1);
  const depois = unwrap(await db.from(T).select("created_at, updated_at, version").eq("id", 1).single(), "Lendo as datas de novo");

  assert.ok(Date.parse(depois.updated_at) > Date.parse(antes.updated_at));
  assert.equal(depois.created_at, antes.created_at);
  assert.equal(depois.version, 2);
});

test("o job no modo off não toca na tabela, mesmo com o tick rodando", async () => {
  delete process.env.BUNKER_LICENSING_MODE;
  const tick = await runJobsTick({ jobs: [licenseCheckInJob], supabase: db });

  assert.deepEqual(tick.failed, [], JSON.stringify(tick));
  assert.deepEqual(tick.ran, [LICENSE_CHECK_IN_JOB_NAME]);
  assert.equal(await adaptador.read(), null, "nenhuma linha criada");
});

test("o job no modo enforce: anda a hora vista, tenta a conferência com o cliente de hoje, grava o motivo e o tick fica verde; a rodada seguinte não tenta de novo", async () => {
  ligarEnforce();
  await adaptador.write(ativada(40 * HORA), null);

  const primeira = await runJobsTick({ jobs: [licenseCheckInJob], supabase: db });
  assert.deepEqual(primeira.failed, [], JSON.stringify(primeira));

  const linha = await adaptador.read();
  assert.equal(linha.checkInResult, "nao_configurado");
  assert.ok(Math.abs(Date.now() - linha.checkInAttemptedAt.getTime()) < MINUTO, "a tentativa é de agora");
  assert.equal(linha.token, token, "a licença guardada continua a mesma");
  assert.equal(linha.checkInSequence, "seq-1");
  assert.equal(linha.lastSeenAt.toISOString(), new Date(emitidaEm.getTime() + MINUTO).toISOString(), "um minuto, nunca o relógio");
  assert.equal(linha.version, 3, "criada, a rodada com a reserva e o resultado");

  const segunda = await runJobsTick({ jobs: [licenseCheckInJob], supabase: db });
  assert.deepEqual(segunda.failed, []);

  const depois = await adaptador.read();
  assert.equal(depois.checkInAttemptedAt.getTime(), linha.checkInAttemptedAt.getTime(), "nova tentativa só em 1 hora");
  assert.equal(depois.lastSeenAt.toISOString(), new Date(emitidaEm.getTime() + 2 * MINUTO).toISOString());
  assert.equal(depois.version, 4, "uma gravação só: a hora vista");

  const situacao = await getCurrentLicenseState();
  assert.equal(situacao.evaluation.degree, "ok", "a conferência que falha não limita ninguém");
});

test("a situação do pedido: no modo off só o modo, sem ler; no enforce lê a linha, avalia com o endereço configurado e não grava", async () => {
  delete process.env.BUNKER_LICENSING_MODE;
  assert.deepEqual(await getCurrentLicenseState(), { mode: "off" });

  ligarEnforce();
  assert.equal((await getCurrentLicenseState()).evaluation.degree, "nao_ativada", "sem linha: só a tela de ativação");

  await adaptador.write(ativada(), null);
  const situacao = await getCurrentLicenseState();
  assert.equal(situacao.mode, "enforce");
  assert.equal(situacao.evaluation.degree, "ok");
  assert.equal(situacao.license.installation.host, "alunos.escola.test");
  assert.equal(JSON.stringify(situacao).includes(SEGREDO), false, "o segredo nunca entra na situação");

  process.env.NEXT_PUBLIC_SITE_URL = "https://outra.escola.test";
  const foraDoEndereco = await getCurrentLicenseState();
  assert.equal(foraDoEndereco.evaluation.reasons.some((motivo) => motivo.reason === "endereco_diferente"), true);
  assert.equal(foraDoEndereco.evaluation.restrictions.newAccess, true);

  assert.equal((await adaptador.read()).version, 1, "ler a situação nunca grava");
});
