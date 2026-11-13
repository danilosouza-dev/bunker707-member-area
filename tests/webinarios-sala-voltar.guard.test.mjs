import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Guarda de texto (docs/18 §2.2) de quem sai e volta a Live ao vivo (docs/30 D121 e D122): onde a sala pede o
// historico do chat, e que so a live pede. O comportamento do pedido esta em tests/webinarios-sala-rotas.test.mjs
// (a rota), o do Sair em tests/webinarios-sala-sair.test.mjs e o do modulo do Prosody em tests/infra-jitsi.test.mjs.

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const ROOM = "src/components/member/webinars/room";

test("so a sala da Live ao vivo pede o historico do chat; a gravada e o replay, nunca", () => {
  const live = semComentarios(ler(`${ROOM}/live-room.tsx`));
  const chatDaLive = live.slice(live.indexOf("const chat = useRoomChat({"), live.indexOf("});", live.indexOf("const chat = useRoomChat({")));
  assert.match(chatDaLive, /backlog: true,/);
  const gravada = semComentarios(ler(`${ROOM}/webinar-room.tsx`));
  const chatDaGravada = gravada.slice(gravada.indexOf("const chat = useRoomChat({"), gravada.indexOf("});", gravada.indexOf("const chat = useRoomChat({")));
  assert.ok(chatDaGravada.length > 0);
  assert.doesNotMatch(chatDaGravada, /backlog/, "na gravada o chat aparece no segundo dele");
});

test("o historico e pedido uma vez, depois da primeira janela, do comeco dela para tras, e nunca segura o chat de agora", () => {
  const dados = semComentarios(ler(`${ROOM}/use-room-data.ts`));
  const chat = dados.slice(dados.indexOf("export function useRoomChat("), dados.indexOf("const seeked = useCallback("));
  assert.match(chat, /const backlog = input\.backlog === true;/, "desligado por padrao");
  assert.match(chat, /let backlogLeft = backlog \? 3 : 0;/, "ate tres tentativas, e nenhuma sem a chave");
  assert.match(chat, /if \(firstWindowFromMs === null\) \{\s*firstWindowFromMs = next\.fromMs;\s*void fetchBacklog\(next\.fromMs\);\s*\}/, "do comeco da primeira janela para tras, sem esperar (void)");
  assert.match(chat, /if \(stopped\) \{\s*return;\s*\}\s*backlogLeft = 0;/, "respondeu: nao pede de novo");
  assert.match(chat, /setMessages\(\(previous\) => mergeMessages\(previous, answer\.data\.messages\)\)/, "junta ao que ja esta na tela, sem repetir");
  assert.match(chat, /\}, \[backlog, enabled, sessionId, webinarId\]\);/);
  const api = semComentarios(ler(`${ROOM}/room-api.ts`));
  assert.match(api, /roomApiPath\(webinarId, "chat", \{ before: beforeMs, sessao: sessionId \}\)/, "so `before` e a sessao: nem janela, nem cursor");
});

test("o servidor limita o historico: 200 mensagens, uma consulta, so na live", () => {
  const modelo = semComentarios(ler("src/server/webinars/room-model.ts"));
  assert.match(modelo, /export const CHAT_BACKLOG_MESSAGES = 200;/);
  const consultas = semComentarios(ler("src/server/webinars/room-queries.ts"));
  const historico = consultas.slice(consultas.indexOf("export async function readChatBacklog("), consultas.indexOf("export async function readRecentChat("));
  assert.match(historico, /if \(context\.session\.kind !== "live" \|\| !Number\.isInteger\(input\.beforeMs\)\) \{\s*return \{ messages: \[\], mode: "backlog", serverTime \};/);
  assert.match(historico, /Math\.min\(input\.beforeMs, chatWindowLimitMs\(context\.session, now\) \+ 1\)/, "nunca alem do segundo do servidor");
  assert.equal(historico.match(/await listChatBacklogRows\(/g).length, 1, "uma consulta so");
  const banco = semComentarios(ler("src/server/webinars/chat-store.ts"));
  const linhas = banco.slice(banco.indexOf("export async function listChatBacklogRows("), banco.indexOf("export async function listSessionChatRows("));
  assert.match(linhas, /\.eq\("session_id", input\.sessionId\)\.is\("deleted_at", null\)\.lt\("offset_ms", Math\.trunc\(input\.beforeMs\)\)/, "so a propria sessao, sem as apagadas");
  assert.match(linhas, /approved\.eq\.true,author_user_id\.eq\.\$\{input\.userId\}/, "as aprovadas e as do proprio aluno na moderacao");
  assert.match(linhas, /\.limit\(limit\)/);
  assert.doesNotMatch(linhas, /\.(insert|update|upsert|delete)\(/, "so leitura");
});
