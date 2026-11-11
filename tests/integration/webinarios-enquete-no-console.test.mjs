import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import {
  LIVE_AO_VIVO_DE_TESTE,
  LIVE_GRAVADA_DE_TESTE,
  limparWebinarios,
  seedEscolaDeTeste,
  seedLiveAoVivoDeTeste,
  seedLiveGravadaEncerradaDeTeste,
  usuarioDeTeste
} from "../fixtures/escola-de-teste.mjs";

// A "Nova enquete" do console (D83; pedido do produtor de 11/11/2026; docs/18 §3) contra o banco LOCAL de verdade, na
// Live ao vivo de teste no ar e na Live gravada encerrada:
// - createConsolePoll cria UMA enquete pronta no fim das prontas do webinario, sem mexer nas outras (nem na que outra
//   pessoa da equipe gravou no meio); a nova aparece no retrato do console (a rota de 5 s) e no editor;
// - "Abrir agora" abre na sessao (a copia aberta da nova) e a aluna responde pela rota das enquetes da sala, com a
//   contagem no retrato; "Abrir e fixar" abre e fixa (a fixada de antes sai como `replaced`) e a consulta de 5 s do chat
//   da aluna traz a fixada;
// - o teto de 20 prontas: a 21a recebe 409 e nada e gravado;
// - recusas: o analista (sem messaging.write) recebe 403 em tudo; "Abrir agora" e "Abrir e fixar" na sessao encerrada
//   recebem 409 sem gravar, e "Guardar nas prontas" nela funciona; sessao que nao existe, 404;
// - o Salvar do card do editor com a pagina aberta antes (loadedIds sem a nova) nao apaga a enquete criada no console.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const roomActions = await import("../../src/server/webinars/room-actions.ts");
const pollsRoute = await import("../../src/app/api/webinars/[id]/polls/route.ts");
const chatRoute = await import("../../src/app/api/webinars/[id]/chat/route.ts");
const consoleRoute = await import("../../src/app/api/admin/webinars/[id]/console/route.ts");
const { getWebinarEditorData } = await import("../../src/server/webinars/queries.ts");
const { resetRoomLimits } = await import("../../src/server/webinars/room-limits.ts");
const { CHAT_MESSAGES } = await import("../../src/server/webinars/chat-schemas.ts");

const produtor = usuarioDeTeste(contas.produtor);
const professor = usuarioDeTeste(contas.professor);
const analista = usuarioDeTeste(contas.analista);
const aluna = usuarioDeTeste(contas.aluna);
const AO_VIVO = LIVE_AO_VIVO_DE_TESTE;
const ENCERRADA = LIVE_GRAVADA_DE_TESTE;
const SESSAO_FECHADA = "Essa sessão não aceita mais ações da equipe.";

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

function falhou(result, status) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.status, status, JSON.stringify(result));
  return result;
}

/** As Server Actions sempre como o produtor (as rotas da sala entram como a aluna no meio). */
const comoProdutor = (action) => (actAs(produtor), action());

const json = async (response) => ({ body: await response.json(), status: response.status });
const contextoDe = (webinarId) => ({ params: Promise.resolve({ id: webinarId }) });
const pedidoDaSala = (webinarId, path, method = "GET", body) =>
  new Request(`http://localhost/api/webinars/${webinarId}/${path}`, body === undefined ? { method } : { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method });

async function prontas(webinarId = AO_VIVO.id) {
  return unwrap(
    await db.from("webinar_polls").select("id, question, position, created_by, updated_at, session_id").eq("webinar_id", webinarId).is("session_id", null).order("position", { ascending: true }).order("created_at", { ascending: true }),
    "Lendo as prontas"
  );
}

async function retratoDoConsole() {
  actAs(produtor);
  const resposta = await json(await consoleRoute.GET(new Request(`http://localhost/api/admin/webinars/${AO_VIVO.id}/console?sessao=${AO_VIVO.sessaoId}`), contextoDe(AO_VIVO.id)));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return resposta.body.data;
}

/** Uma enquete pronta gravada direto no banco, como outra pessoa da equipe (o professor) faria noutro console. */
async function prontaDaOutraPessoa(question, position) {
  const poll = unwrap(
    await db.from("webinar_polls").insert({ anonymous: false, created_by: professor.id, kind: "single", position, question, session_id: null, status: "draft", webinar_id: AO_VIVO.id }).select("id").single(),
    "Gravando a pronta da outra pessoa"
  );
  unwrap(await db.from("webinar_poll_options").insert(["Sim", "Não"].map((label, index) => ({ label, poll_id: poll.id, position: index }))), "Gravando as opcoes");
  return poll.id;
}

async function auditoria(action) {
  return unwrap(await db.from("admin_audit_log").select("action, actor_id, metadata, occurred_at").eq("action", action).eq("entity_id", AO_VIVO.id).order("occurred_at", { ascending: false }).limit(5), `Lendo a auditoria ${action}`);
}

const nova = (extra = {}) => ({ kind: "single", options: [{ label: "Prompts" }, { label: "Agentes" }], question: "Qual tema na próxima?", sessionId: AO_VIVO.sessaoId, ...extra });

before(async () => {
  await limparWebinarios(db);
  await seedLiveAoVivoDeTeste(db, { comecouHa: 3 * 60_000, status: "live" });
  await seedLiveGravadaEncerradaDeTeste(db);
  resetRoomLimits();
});

after(async () => {
  actAs(null);
  await limparWebinarios(db);
});

test("1. sem messaging.write (o analista): 403 em Guardar, Abrir agora e Abrir e fixar; nada gravado", async () => {
  actAs(analista);
  for (const launch of ["save", "open", "pin"]) {
    falhou(await roomActions.createConsolePoll(nova({ launch })), 403);
  }
  actAs(null);
  falhou(await roomActions.createConsolePoll(nova()), 401);
  assert.equal((await prontas()).length, 0);
});

test("2. Guardar nas prontas: uma pronta nova no fim, sem mexer nas outras (nem na da outra pessoa gravada no meio); o retrato do console e o editor trazem a nova", async () => {
  ok(
    await comoProdutor(() =>
      roomActions.savePolls({
        polls: [
          { kind: "single", options: [{ label: "Sim" }, { label: "Não" }], question: "Vem na próxima?" },
          { kind: "multiple", options: [{ label: "A" }, { label: "B" }], question: "Quais temas?" }
        ],
        webinarId: AO_VIVO.id
      })
    )
  );
  await prontaDaOutraPessoa("Da outra pessoa?", 2);
  const antes = await prontas();

  const criada = ok(await comoProdutor(() => roomActions.createConsolePoll(nova())));
  assert.deepEqual([criada.launched, criada.launchError, criada.pinned], [null, null, false]);
  assert.deepEqual([criada.poll.sessionId, criada.poll.status, criada.poll.position, criada.poll.question], [null, "draft", 3, "Qual tema na próxima?"]);
  const depois = await prontas();
  assert.deepEqual(depois.slice(0, 3), antes, "as outras prontas como estavam (inclusive o updated_at)");
  assert.deepEqual(depois.map((row) => row.question), ["Vem na próxima?", "Quais temas?", "Da outra pessoa?", "Qual tema na próxima?"]);
  assert.equal(depois[3].created_by, produtor.id);
  const opcoes = unwrap(await db.from("webinar_poll_options").select("label, position").eq("poll_id", criada.poll.id).order("position", { ascending: true }), "Lendo as opcoes da nova");
  assert.deepEqual(opcoes.map((row) => row.label), ["Prompts", "Agentes"]);
  const copias = unwrap(await db.from("webinar_polls").select("id").eq("session_id", AO_VIVO.sessaoId), "Lendo as copias da sessao");
  assert.equal(copias.length, 0, "guardar nao abre nada");

  const retrato = await retratoDoConsole();
  assert.deepEqual(retrato.polls.templates.map((poll) => poll.question), ["Vem na próxima?", "Quais temas?", "Da outra pessoa?", "Qual tema na próxima?"]);
  const editor = await getWebinarEditorData(AO_VIVO.id);
  assert.ok(editor.polls.some((poll) => poll.id === criada.poll.id), "o card Enquetes do editor traz a nova");
  const [linha] = await auditoria("webinar.poll_created");
  assert.equal(linha.actor_id, produtor.id);
  assert.deepEqual(linha.metadata, { kind: "single", launch: "save", options: 2, poll_id: criada.poll.id, session_id: AO_VIVO.sessaoId });
});

test("3. Abrir agora: a copia aberta da nova na sessao; a aluna ve a enquete pela rota da sala, responde (201) e o retrato do console conta", async () => {
  const criada = ok(await comoProdutor(() => roomActions.createConsolePoll(nova({ launch: "open", options: [{ label: "Sim" }, { label: "Não" }, { label: "Talvez" }], question: "Vai fazer o desafio?" }))));
  assert.equal(criada.launchError, null);
  assert.deepEqual([criada.launched.sessionId, criada.launched.status, criada.launched.templatePollId], [AO_VIVO.sessaoId, "open", criada.poll.id]);
  assert.ok(criada.launched.openedAt);

  resetRoomLimits();
  actAs(aluna);
  const lista = await json(await pollsRoute.GET(pedidoDaSala(AO_VIVO.id, `polls?sessao=${AO_VIVO.sessaoId}`), contextoDe(AO_VIVO.id)));
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  const daAluna = lista.body.data.polls.find((poll) => poll.id === criada.launched.id);
  assert.ok(daAluna, "a enquete aberta esta na lista da aluna");
  assert.deepEqual(daAluna.options.map((option) => option.label), ["Sim", "Não", "Talvez"]);
  actAs(aluna);
  const resposta = await json(await pollsRoute.POST(pedidoDaSala(AO_VIVO.id, "polls", "POST", { optionIds: [daAluna.options[2].id], pollId: criada.launched.id, sessionId: AO_VIVO.sessaoId }), contextoDe(AO_VIVO.id)));
  assert.equal(resposta.status, 201, JSON.stringify(resposta.body));

  const retrato = await retratoDoConsole();
  const lancada = retrato.polls.launched.find((poll) => poll.id === criada.launched.id);
  assert.equal(lancada.counts.answers, 1);
  assert.equal(lancada.counts.byOption[daAluna.options[2].id], 1);
  const [linha] = await auditoria("webinar.poll_launched");
  assert.deepEqual([linha.metadata.poll_id, linha.metadata.template_poll_id], [criada.launched.id, criada.poll.id]);
});

test("4. Abrir e fixar: abre e fixa a nova (a fixada de antes sai como replaced); a consulta de 5 s do chat da aluna traz a fixada", async () => {
  const primeira = ok(await comoProdutor(() => roomActions.createConsolePoll(nova({ launch: "pin", question: "Primeira fixada?" }))));
  assert.equal(primeira.pinned, true);
  const segunda = ok(await comoProdutor(() => roomActions.createConsolePoll(nova({ launch: "pin", question: "Segunda fixada?" }))));
  assert.deepEqual([segunda.pinned, segunda.launchError], [true, null]);

  const exibicoes = unwrap(await db.from("webinar_screen_displays").select("poll_id, hidden_reason").eq("session_id", AO_VIVO.sessaoId).eq("kind", "poll"), "Lendo as exibicoes de enquete");
  assert.deepEqual(Object.fromEntries(exibicoes.map((row) => [row.poll_id, row.hidden_reason])), { [primeira.launched.id]: "replaced", [segunda.launched.id]: null });

  resetRoomLimits();
  actAs(aluna);
  const query = new URLSearchParams({ sessao: AO_VIVO.sessaoId, since: new Date(Date.now() - 5000).toISOString(), tela: "2026-01-01T00:00:00+00:00" });
  const chat = await json(await chatRoute.GET(pedidoDaSala(AO_VIVO.id, `chat?${query}`), contextoDe(AO_VIVO.id)));
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.equal(chat.body.data.screen.pinnedPollId, segunda.launched.id);
  assert.equal((await retratoDoConsole()).pinnedPollId, segunda.launched.id);
});

test("5. o teto de 20 prontas: a 21a recebe 409 (Até 20 enquetes por webinário.) e nada e gravado", async () => {
  const faltam = 20 - (await prontas()).length;
  for (let index = 0; index < faltam; index += 1) {
    ok(await comoProdutor(() => roomActions.createConsolePoll(nova({ question: `Pergunta ${index + 1}?` }))));
  }
  assert.equal((await prontas()).length, 20);
  const recusada = falhou(await comoProdutor(() => roomActions.createConsolePoll(nova({ launch: "open", question: "A vigésima primeira?" }))), 409);
  assert.equal(recusada.error, CHAT_MESSAGES.tooManyPolls);
  assert.equal((await prontas()).length, 20);
  assert.ok(!(await prontas()).some((row) => row.question === "A vigésima primeira?"));
});

test("6. fora da sessao: Abrir agora e Abrir e fixar na sessao encerrada recebem 409 sem gravar; Guardar nas prontas nela funciona; sessao que nao existe, 404", async () => {
  const antes = await prontas(ENCERRADA.id);
  for (const launch of ["open", "pin"]) {
    const recusada = falhou(await comoProdutor(() => roomActions.createConsolePoll(nova({ launch, sessionId: ENCERRADA.sessaoId }))), 409);
    assert.equal(recusada.error, SESSAO_FECHADA);
  }
  assert.deepEqual(await prontas(ENCERRADA.id), antes, "nada gravado");

  const guardada = ok(await comoProdutor(() => roomActions.createConsolePoll(nova({ sessionId: ENCERRADA.sessaoId }))));
  assert.deepEqual([guardada.poll.webinarId, guardada.poll.sessionId, guardada.launched], [ENCERRADA.id, null, null]);
  assert.equal((await prontas(ENCERRADA.id)).length, antes.length + 1);

  falhou(await comoProdutor(() => roomActions.createConsolePoll(nova({ sessionId: "bbbbbbbb-0000-4000-8000-0000000009ff" }))), 404);
});

test("7. o Salvar do card do editor aberto antes (loadedIds sem a nova) nao apaga a enquete criada no console", async () => {
  await seedLiveAoVivoDeTeste(db, { comecouHa: 3 * 60_000, status: "live" });
  const salvas = ok(await comoProdutor(() => roomActions.savePolls({ polls: [{ kind: "single", options: [{ label: "Sim" }, { label: "Não" }], question: "Vem na próxima?" }], webinarId: AO_VIVO.id }))).polls;
  // O editor esta aberto com a lista carregada; no console, a Nova enquete.
  const doConsole = ok(await comoProdutor(() => roomActions.createConsolePoll(nova()))).poll;
  const salvo = ok(
    await comoProdutor(() =>
      roomActions.savePolls({
        loadedIds: salvas.map((poll) => poll.id),
        polls: [{ id: salvas[0].id, kind: "single", options: [{ id: salvas[0].options[0].id, label: "Sim" }, { id: salvas[0].options[1].id, label: "Não, desta vez" }], question: "Vem na próxima?" }],
        webinarId: AO_VIVO.id
      })
    )
  );
  assert.deepEqual([salvo.created, salvo.updated, salvo.deleted], [0, 1, 0]);
  assert.ok((await prontas()).some((row) => row.id === doConsole.id), "a do console fica");
  assert.ok(salvo.polls.some((poll) => poll.id === doConsole.id), "e volta para o card");
});
