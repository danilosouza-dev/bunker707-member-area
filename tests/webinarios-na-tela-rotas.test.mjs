import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { MIN, REPLAY, SESSION, WEBINAR, bancoFalso, escola, iso, janelaDoChat } from "./support/webinarios-sala-banco.mjs";

// A "Na tela" nas rotas da sala (docs/30 §5.1; especificacao de 10/11/2026, §5.2 e §9), sem banco: o banco falso das
// rotas da Sala (tests/support/webinarios-sala-banco.mjs, que conta cada consulta) e a sessao do aluno pelo teste.
// - a consulta de 5 s do chat (GET .../chat?since=&tela=<carimbo>): com o mesmo carimbo, `screen` nulo e nenhuma
//   consulta a mais; sem `tela` (a pagina aberta com o codigo de antes), nulo; com outro carimbo, o estado inteiro (o
//   banner e o QR Code com o id da exibicao, a imagem pela origem do nosso Supabase, a fixada com `links`, a enquete
//   fixada e o resumo das enquetes) em 3 leituras pequenas; o segundo aluno vem da memoria (nenhuma leitura da Na tela);
//   o carimbo novo (a equipe tirou da tela) traz o estado novo na consulta seguinte;
// - Replay: nulo no chat e vazio na sessao; sessao encerrada: o estado vazio, sem leitura da Na tela;
// - GET .../session leva `screen` (e `pinned` continua para a pagina de antes);
// - banco sem a 202611100002: as leituras da Na tela voltam vazias e a sala segue.

const sessao = (globalThis.__naTelaRotasSessao ??= { user: null });

function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }
  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

// A sessao das rotas vem do teste; o cliente do banco e o banco falso de admin-action-stubs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__naTelaRotasSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiSessionUser = requireApiUser;`);
    }
    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    return nextResolve(specifier, context);
  }
});

const ORIGEM = "https://abcdefgh.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGEM;

const chatRoute = await import("../src/app/api/webinars/[id]/chat/route.ts");
const sessionRoute = await import("../src/app/api/webinars/[id]/session/route.ts");
const { resetRoomLimits } = await import("../src/server/webinars/room-limits.ts");
const { clearAuthorPhotoCache } = await import("../src/server/webinars/author-photos.ts");
const { clearScreenStateCache } = await import("../src/server/webinars/screen-queries.ts");
const { clearSharedPollCounts } = await import("../src/server/webinars/room-queries.ts");
const screenModel = await import("../src/server/webinars/screen-model.ts");

const IMAGEM = "webinars/screen/0123456789abcdef01234567.webp";
const BANNER = "eeeeeeee-0000-4000-8000-000000000001";
const QR = "eeeeeeee-0000-4000-8000-000000000002";
const FIXADA_ENQUETE = "eeeeeeee-0000-4000-8000-000000000003";
const SAIU = "eeeeeeee-0000-4000-8000-000000000004";
const ENQUETE = "eeeeeeee-0000-4000-8000-000000000010";
const MENSAGEM = "eeeeeeee-0000-4000-8000-000000000020";
/** As tabelas da Na tela (as que so ela le). */
const TABELAS_DA_TELA = ["webinar_screen_displays", "webinar_polls"];
let proximoAluno = 300;

function novoAluno() {
  proximoAluno += 1;
  const id = `66666666-6666-4666-8666-${String(proximoAluno).padStart(12, "0")}`;
  sessao.user = { id };
  return id;
}

function exibicao(id, kind, extra = {}) {
  return {
    created_at: iso(Date.now() - MIN),
    hidden_at: null,
    hidden_by: null,
    hidden_offset_ms: null,
    hidden_reason: null,
    id,
    item_id: kind === "poll" ? null : "eeeeeeee-0000-4000-8000-0000000000ff",
    kind,
    poll_id: kind === "poll" ? ENQUETE : null,
    session_id: SESSION,
    shown_at: iso(Date.now() - MIN),
    shown_by: null,
    shown_offset_ms: 540_000,
    snapshot: {},
    ...extra
  };
}

const copiaDoBanner = {
  body: "Vagas até sexta.",
  buttonLabel: "Quero entrar",
  closable: false,
  image: { alt: "Foguete subindo", height: 360, path: IMAGEM, width: 640 },
  linkUrl: "https://bunker707.com.br/turma",
  name: "Turma de novembro",
  place: "bottom_left",
  size: "m",
  title: "Turma nova",
  v: 1
};
const copiaDoQr = { body: null, buttonLabel: null, closable: true, image: null, linkUrl: "https://bunker707.com.br/inscricao", name: "Inscrição", place: "top_right", size: "s", title: "Aponte a câmera", v: 1 };

/** A Live gravada no ar ha 10 min, com o banner, o QR Code, a enquete fixada, uma exibicao que ja saiu e a fixada da equipe. */
function montar({ kind = "simulated", status = "live", tela = true } = {}) {
  resetRoomLimits();
  clearAuthorPhotoCache();
  clearScreenStateCache();
  clearSharedPollCounts();
  const db = bancoFalso({ rpc: { webinar_chat_window: janelaDoChat }, tables: escola({ kind, scheduledAt: Date.now() - 10 * MIN, status }) });
  actionStubs.db = db;
  const userId = novoAluno();
  db.tables.profiles.push({ avatar_url: null, created_at: iso(Date.now()), email: "ana@bunker707.test", full_name: "Ana Maria Souza", id: userId, last_sign_in_at: null, phone: null });
  db.tables.webinar_chat_messages.push({ approved: true, author_user_id: null, body: "Material em https://bunker707.com.br/apostila.", created_at: iso(Date.now() - 2 * MIN), deleted_at: null, display_name: "Equipe", id: MENSAGEM, kind: "message", master: false, offset_ms: 480_000, pinned_at: iso(Date.now() - MIN), reply_to_id: null, role: "team", script_item_id: null, session_id: SESSION, source: "team", webinar_id: WEBINAR });
  db.tables.webinar_sessions.find((row) => row.id === SESSION).pinned_message_id = MENSAGEM;
  db.tables.webinar_polls.push({ anonymous: false, closed_at: null, created_at: iso(Date.now() - MIN), created_by: null, id: ENQUETE, kind: "single", open_offset_ms: 0, opened_at: iso(Date.now() - MIN), position: 0, question: "Qual curso?", results_shared_at: null, session_id: SESSION, status: "open", template_poll_id: null, updated_at: iso(Date.now() - MIN), webinar_id: WEBINAR });
  if (tela) {
    db.tables.webinar_screen_displays = [
      exibicao(BANNER, "banner", { snapshot: copiaDoBanner }),
      exibicao(QR, "qr", { snapshot: copiaDoQr }),
      exibicao(FIXADA_ENQUETE, "poll", { snapshot: { name: "Qual curso?", v: 1 } }),
      exibicao(SAIU, "banner", { hidden_at: iso(Date.now() - 2 * MIN), hidden_reason: "replaced", snapshot: copiaDoBanner })
    ];
  }
  return { db, userId };
}

const contexto = () => ({ params: Promise.resolve({ id: WEBINAR }) });
const json = async (response) => ({ body: await response.json(), status: response.status });
const carimbo = (db, id = SESSION) => db.tables.webinar_sessions.find((row) => row.id === id).updated_at;
const desde = () => encodeURIComponent(iso(Date.now() - 5000));

/** A consulta de 5 s do chat, com o carimbo em `tela` (ou sem ele). */
async function consultar(db, { sessionId = SESSION, tela } = {}) {
  const query = `sessao=${sessionId}&since=${desde()}${tela === undefined ? "" : `&tela=${encodeURIComponent(tela)}`}`;
  const antes = db.calls.from.length;
  const resposta = await json(await chatRoute.GET(new Request(`http://localhost/api/webinars/${WEBINAR}/chat?${query}`), contexto()));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  return { calls: db.calls.from.slice(antes), screen: resposta.body.data.screen };
}

const daTela = (calls) => calls.filter((table) => TABELAS_DA_TELA.includes(table));

test("chat com o mesmo carimbo: screen nulo e nenhuma consulta a mais; sem tela (a pagina de antes): nulo", async () => {
  const { db } = montar();
  const sem = await consultar(db);
  assert.equal(sem.screen, null, "sem tela, nada");
  const igual = await consultar(db, { tela: carimbo(db) });
  assert.equal(igual.screen, null);
  assert.deepEqual(igual.calls, sem.calls, "as mesmas consultas da consulta sem tela: nenhuma a mais");
  assert.deepEqual(daTela(igual.calls), []);
});

test("chat com outro carimbo: o estado inteiro em 3 leituras pequenas; o segundo aluno vem da memoria", async () => {
  const { db, userId } = montar();
  const sem = await consultar(db);
  const velho = await consultar(db, { tela: "2026-01-01T00:00:00+00:00" });
  const { screen } = velho;
  assert.equal(screen.stamp, carimbo(db));
  assert.deepEqual(
    screen.items.map((item) => [item.kind, item.displayId]),
    [["banner", BANNER], ["qr", QR]],
    "o banner e o QR Code ativos (a exibicao que saiu fica de fora), o banner primeiro"
  );
  assert.deepEqual(screen.items[0], {
    body: "Vagas até sexta.",
    buttonLabel: "Quero entrar",
    closable: false,
    displayId: BANNER,
    image: { alt: "Foguete subindo", height: 360, url: `${ORIGEM}/storage/v1/object/public/content-assets/${IMAGEM}`, width: 640 },
    kind: "banner",
    linkUrl: "https://bunker707.com.br/turma",
    place: "bottom_left",
    shownAt: db.tables.webinar_screen_displays[0].shown_at,
    size: "m",
    title: "Turma nova"
  });
  assert.deepEqual([screen.items[1].title, screen.items[1].linkUrl, screen.items[1].image, screen.items[1].buttonLabel], ["Aponte a câmera", "https://bunker707.com.br/inscricao", null, null]);
  assert.equal(screen.pinnedPollId, ENQUETE);
  assert.equal(screen.pollsKey, screenModel.pollsKeyOf([{ id: ENQUETE, resultsShared: false, status: "open" }]));
  assert.deepEqual([screen.pinned.id, screen.pinned.body, screen.pinned.links, screen.pinned.mine, screen.pinned.role], [MENSAGEM, "Material em https://bunker707.com.br/apostila.", true, false, "team"]);
  // As leituras a mais: as exibicoes ativas, a fixada pela chave e as enquetes da sessao (uma vez cada).
  const extras = velho.calls.length - sem.calls.length;
  assert.equal(extras, 3, `3 leituras a mais (${velho.calls.join(", ")})`);
  assert.deepEqual(daTela(velho.calls).sort(), ["webinar_polls", "webinar_screen_displays"]);
  assert.ok(db.calls.reads.some((read) => read.table === "webinar_screen_displays" && read.filters.some(([op, column, value]) => op === "is" && column === "hidden_at" && value === null)), "so as ativas, pelo indice unico");

  // O segundo aluno com o carimbo velho: o mesmo estado, da memoria do processo (nenhuma leitura da Na tela).
  const outro = novoAluno();
  db.tables.profiles.push({ avatar_url: null, created_at: iso(Date.now()), email: "bia@bunker707.test", full_name: "Bia Costa", id: outro, last_sign_in_at: null, phone: null });
  const segundo = await consultar(db, { tela: "2026-01-01T00:00:00+00:00" });
  assert.deepEqual(segundo.screen, screen);
  assert.deepEqual(daTela(segundo.calls), [], "da memoria");
  assert.equal(segundo.calls.length, sem.calls.length, "nenhuma consulta a mais que a consulta sem tela");
  assert.notEqual(userId, outro);
});

test("o carimbo novo (a equipe tirou da tela e atualizou a sessao): a consulta seguinte traz o estado novo, mesmo com a memoria quente", async () => {
  const { db } = montar();
  const primeiro = await consultar(db, { tela: "velho" });
  assert.equal(primeiro.screen.items.length, 2);
  // Tirar o banner: a exibicao primeiro, o carimbo depois (store.touchSessionRow).
  Object.assign(db.tables.webinar_screen_displays[0], { hidden_at: iso(Date.now()), hidden_reason: "team" });
  db.tables.webinar_sessions.find((row) => row.id === SESSION).updated_at = iso(Date.now() + 1000);
  const comOAntigo = await consultar(db, { tela: primeiro.screen.stamp });
  assert.equal(comOAntigo.screen.stamp, carimbo(db));
  assert.deepEqual(comOAntigo.screen.items.map((item) => item.kind), ["qr"], "o banner saiu");
  assert.deepEqual(daTela(comOAntigo.calls).sort(), ["webinar_polls", "webinar_screen_displays"], "o carimbo novo releu");
  const emDia = await consultar(db, { tela: comOAntigo.screen.stamp });
  assert.equal(emDia.screen, null);
});

test("Replay: screen nulo no chat (qualquer carimbo) e vazio na sessao; sessao encerrada: o estado vazio, sem leitura da Na tela", async () => {
  const { db } = montar();
  const replay = await consultar(db, { sessionId: REPLAY, tela: "qualquer" });
  assert.equal(replay.screen, null);
  assert.deepEqual(daTela(replay.calls), []);
  const sessaoDoReplay = await json(await sessionRoute.GET(new Request(`http://localhost/api/webinars/${WEBINAR}/session?sessao=${REPLAY}`), contexto()));
  assert.equal(sessaoDoReplay.status, 200, JSON.stringify(sessaoDoReplay.body));
  assert.deepEqual(sessaoDoReplay.body.data.screen, { items: [], pinned: null, pinnedPollId: null, pollsKey: "", stamp: carimbo(db, REPLAY) });

  const encerrada = montar({ status: "ended" });
  const fim = await consultar(encerrada.db, { tela: "velho" });
  assert.deepEqual(fim.screen, { items: [], pinned: null, pinnedPollId: null, pollsKey: "", stamp: carimbo(encerrada.db) });
  assert.deepEqual(daTela(fim.calls), []);
});

test("GET session leva screen (o mesmo estado da consulta do chat) e pinned continua para a pagina de antes", async () => {
  const { db } = montar();
  const resposta = await json(await sessionRoute.GET(new Request(`http://localhost/api/webinars/${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  const { data } = resposta.body;
  assert.equal(data.screen.stamp, carimbo(db));
  assert.deepEqual(data.screen.items.map((item) => item.displayId), [BANNER, QR]);
  assert.equal(data.screen.pinnedPollId, ENQUETE);
  assert.equal(data.screen.pinned.id, MENSAGEM);
  assert.equal(data.pinned.id, MENSAGEM, "pinned continua");
  assert.equal(data.pinned.links, true);
  // O mesmo estado que a consulta do chat leva com um carimbo velho.
  const chat = await consultar(db, { tela: "velho" });
  assert.deepEqual(chat.screen, data.screen);
});

test("a fixada de aluno nunca tem link; a sessao sem nada na tela leva o estado sem itens", async () => {
  const { db } = montar({ tela: false });
  Object.assign(db.tables.webinar_chat_messages.find((row) => row.id === MENSAGEM), { author_user_id: sessao.user.id, display_name: "Ana S.", role: "student", source: "audience" });
  const { screen } = await consultar(db, { tela: "velho" });
  assert.deepEqual(screen.items, []);
  assert.equal(screen.pinnedPollId, null);
  assert.deepEqual([screen.pinned.links, screen.pinned.mine], [false, true], "a propria mensagem do aluno, sem link");
});

test("banco sem a 202611100002: as leituras da Na tela voltam vazias e a consulta do chat segue (200)", async () => {
  const { db } = montar();
  const from = db.from.bind(db);
  // webinar_screen_displays como o postgrest-js responde a uma tabela que nao existe.
  db.from = (name) => {
    if (name !== "webinar_screen_displays") {
      return from(name);
    }
    db.calls.from.push(name);
    const falha = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.webinar_screen_displays' in the schema cache" } };
    const chain = { eq: () => chain, is: () => chain, order: () => chain, range: () => chain, select: () => chain, then: (resolve, reject) => Promise.resolve(falha).then(resolve, reject) };
    return chain;
  };
  const { screen } = await consultar(db, { tela: "velho" });
  assert.deepEqual(screen.items, []);
  assert.equal(screen.pinnedPollId, null);
  assert.equal(screen.pinned.id, MENSAGEM, "a fixada continua (ela nao depende da migracao)");
  assert.equal(screen.stamp, carimbo(db));
});
