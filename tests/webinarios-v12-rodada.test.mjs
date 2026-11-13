import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A rodada v12 dos webinarios (quarto teste do produtor de 12/11/2026; docs/30 D105 a D107; docs/31 §17; docs/18 §2.2),
// sem banco e sem navegador:
// - as mensagens novas no Chat do console (D106; "um usuário comenta no chat e o apresentador não recebe notificação
//   no ícone de mensagem"): o que avisa quem esta no console, a marca do que ja estava la, a conta, o numero no item
//   Chat do trilho com o nome "Chat, 3 mensagens novas", o "Chat 3" na aba abaixo de lg, e a marca que muda quando o
//   Chat sai da tela e quando a sessao troca;
// - a chave "Mostrar quantas pessoas estão na sala" no console (D107; "Isso tem que estar na hora de criar o webnario e
//   também no console"): o pedido, a chave na entrada Presença com o rotulo do editor, o selo dos presentes que termina
//   em "só a equipe vê" e abre a Presença, e a chave que continua no card Sala do editor, o mesmo de Novo webinário.
// As miniaturas sem o Embaixo (D105) ficam em tests/webinarios-v9-miniaturas.test.mjs; a acao e a conta no banco de
// verdade, em tests/integration/webinarios-v12.test.mjs.

const v2 = await import("../src/server/webinars/console-v2-model.ts");
const schemas = await import("../src/server/webinars/chat-schemas.ts");
const { ConsoleRail } = await import("../src/components/admin/v2/communication/webinars/session-console/console-rail.tsx");
const { ConsolePanel } = await import("../src/components/admin/v2/communication/webinars/session-console/console-panel.tsx");
const presence = await import("../src/components/admin/v2/communication/webinars/session-console/console-presence.tsx");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { WEBINAR_ADMIN_COPY, WEBINAR_EDITOR_CARDS } = await import("../src/server/webinars/editor-model.ts");

const html = (element) => renderToStaticMarkup(element);
const textOf = (markup) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const noop = () => undefined;
const CONSOLE = "src/components/admin/v2/communication/webinars/session-console";
const EU = "00000000-0000-4000-8000-0000000000e1";
const COLEGA = "00000000-0000-4000-8000-0000000000e2";
const ALUNA = "00000000-0000-4000-8000-0000000000a1";
const SESSAO = "bbbbbbbb-0000-4000-8000-000000000802";
const mensagem = (id, source, authorUserId, kind = "message") => ({ authorUserId, id, kind, source });

/* ------------------------------------------------------------------------------------------------
 * As mensagens novas no Chat do console (D106)
 * ---------------------------------------------------------------------------------------------- */

test("o que avisa quem esta no console: o aluno da turma e o colega da equipe; nunca a propria, o roteiro, o chat original, o assistente nem a linha de sistema", () => {
  assert.equal(v2.consoleChatNotifies(mensagem("m1", "audience", ALUNA), EU), true, "o comentario do aluno");
  assert.equal(v2.consoleChatNotifies(mensagem("m2", "audience", ALUNA, "question"), EU), true, "a pergunta que espera a equipe liberar no chat moderado");
  assert.equal(v2.consoleChatNotifies(mensagem("m3", "team", COLEGA), EU), true, "o colega da equipe");
  assert.equal(v2.consoleChatNotifies(mensagem("m4", "team", EU), EU), false, "a propria mensagem");
  assert.equal(v2.consoleChatNotifies(mensagem("m5", "team", EU), COLEGA), true, "a mesma mensagem avisa o colega");
  assert.equal(v2.consoleChatNotifies(mensagem("m6", "team", EU), null), true, "sem saber quem olha, toda mensagem de gente conta");
  for (const origem of ["scripted", "original", "ai"]) {
    assert.equal(v2.consoleChatNotifies(mensagem("m7", origem, null), EU), false, origem);
  }
  assert.equal(v2.consoleChatNotifies(mensagem("m8", "team", COLEGA, "system"), EU), false, "a linha de sistema");
  assert.equal(v2.consoleChatNotifies(mensagem("m9", "audience", null), EU), true, "o aluno sem id (a conta apagada) ainda e um aluno");
});

test("a conta: so o que chegou depois da marca e avisa; com o Chat na tela (sem marca), zero", () => {
  const antes = [mensagem("m1", "audience", ALUNA), mensagem("m2", "team", EU), mensagem("m3", "scripted", null)];
  const marca = v2.consoleChatSeenIds(antes);
  assert.deepEqual([...marca].sort(), ["m1", "m2", "m3"]);
  assert.equal(v2.consoleChatNewCount({ messages: antes, seenIds: marca, viewerId: EU }), 0, "no instante da marca, nada de novo");

  const depois = [
    ...antes,
    mensagem("m4", "audience", ALUNA),
    mensagem("m5", "team", EU),
    mensagem("m6", "scripted", null),
    mensagem("m7", "team", COLEGA),
    mensagem("m8", "ai", null),
    mensagem("m9", "audience", ALUNA, "question")
  ];
  assert.equal(v2.consoleChatNewCount({ messages: depois, seenIds: marca, viewerId: EU }), 3, "duas da aluna e uma do colega");
  assert.equal(v2.consoleChatNewCount({ messages: depois, seenIds: marca, viewerId: COLEGA }), 3, "para o colega: duas da aluna e a minha");
  assert.equal(v2.consoleChatNewCount({ messages: depois, seenIds: null, viewerId: EU }), 0, "com o Chat na tela, nenhum numero");
  // A mensagem antiga que sai da janela do retrato e a que a equipe apaga nao viram numero negativo nem contam.
  assert.equal(v2.consoleChatNewCount({ messages: depois.slice(4), seenIds: marca, viewerId: EU }), 2);
  assert.equal(v2.consoleChatNewCount({ messages: [], seenIds: marca, viewerId: EU }), 0);
  // As Perguntas e as Mãos continuam com a conta delas, sem o Chat (ele vem a parte).
  assert.deepEqual(v2.consoleTabCounts({ hands: 1, questions: [{ status: "open" }] }), { maos: 1, perguntas: 1 });
});

test("o trilho: o item Chat com o numero das mensagens novas e o nome 'Chat, 3 mensagens novas'; com zero ou sem a conta, nada", () => {
  const railOf = (counts) =>
    html(createElement(ConsoleRail, { className: "hidden lg:flex", counts, entries: ["enquetes"], onItem: noop, panelShown: true, tabs: ["chat", "perguntas", "maos", "pessoas"], view: { tab: "perguntas" } }));
  const chatDe = (markup) => markup.slice(markup.lastIndexOf("<button", markup.indexOf('data-console-rail="chat"')), markup.indexOf("</button>", markup.indexOf('data-console-rail="chat"')));

  const comNovas = chatDe(railOf({ chat: 3, maos: 0, perguntas: 0 }));
  assert.match(comNovas, /aria-label="Chat, 3 mensagens novas"/);
  assert.match(comNovas, /<span aria-hidden="true"[^>]*data-room-unread="">3<\/span>/, "o contador vermelho, so na tela");
  assert.match(chatDe(railOf({ chat: 1, maos: 0, perguntas: 0 })), /aria-label="Chat, 1 mensagem nova"/);

  for (const counts of [{ chat: 0, maos: 0, perguntas: 0 }, { maos: 0, perguntas: 0 }]) {
    const semNovas = chatDe(railOf(counts));
    assert.doesNotMatch(semNovas, /aria-label=/, "o nome e o rotulo visivel");
    assert.doesNotMatch(semNovas, /data-room-unread/);
  }
  // As Perguntas continuam com o nome delas.
  assert.match(railOf({ chat: 3, maos: 0, perguntas: 2 }), /aria-label="Perguntas, 2 abertas"[^>]*data-console-rail="perguntas"/);
  assert.equal(WEBINAR_COPY.consoleV2.trilho.mensagensNovas(1), "1 mensagem nova");
  assert.equal(WEBINAR_COPY.consoleV2.trilho.mensagensNovas(12), "12 mensagens novas");
});

test("abaixo de lg e sem palco, a aba Chat so leva numero com mensagens novas ('Chat 3'); as Perguntas e as Mãos, sempre", () => {
  const abasDe = (counts) =>
    Array.from(
      html(
        createElement(ConsolePanel, {
          className: "relative flex",
          closable: true,
          counts,
          entries: ["enquetes"],
          more: { enquetes: "E" },
          onClose: noop,
          onView: noop,
          open: true,
          panes: { chat: "C", maos: "M", perguntas: "P", pessoas: "S" },
          rail: true,
          tabs: ["chat", "perguntas", "maos", "pessoas"],
          view: { tab: "perguntas" }
        })
      ).matchAll(/role="tab"[^>]*>([^<]+)</g)
    ).map((match) => match[1]);
  assert.deepEqual(abasDe({ chat: 3, maos: 0, perguntas: 1 }), ["Chat 3", "Perguntas 1", "Mãos 0", "Pessoas"]);
  assert.deepEqual(abasDe({ chat: 0, maos: 0, perguntas: 1 }), ["Chat", "Perguntas 1", "Mãos 0", "Pessoas"], "sem novidade, so o nome");
  assert.deepEqual(abasDe({ maos: 2, perguntas: 0 }), ["Chat", "Perguntas 0", "Mãos 2", "Pessoas"], "sem a conta (um duble de antes), so o nome");
});

test("a marca: guardada quando o Chat sai da tela, solta quando ele volta, refeita quando a sessao troca; a conta sai do retrato de 5 s, sem pedido a mais", () => {
  const hook = fonte(`${CONSOLE}/use-console-chat-news.ts`);
  assert.match(hook, /const \[mark, setMark\] = useState<ChatMark \| null>\(\(\) => \(chatShown \? null : markNow\(\)\)\);/, "o console que ja abre fora do Chat marca o que encontrou");
  assert.match(hook, /if \(wasShown !== chatShown\) \{\s*setWasShown\(chatShown\);\s*setMark\(chatShown \? null : markNow\(\)\);\s*\} else if \(mark && mark\.sessionId !== sessionId\) \{\s*setMark\(markNow\(\)\);\s*\}/);
  assert.match(hook, /return chatShown \|\| !mark \|\| mark\.sessionId !== sessionId \? 0 : consoleChatNewCount\(\{ messages, seenIds: mark\.seenIds, viewerId \}\);/);
  assert.doesNotMatch(hook, /useEffect|fetch\(|setInterval|setTimeout/, "sem efeito e sem pedido proprio: so o estado derivado do retrato");

  // O console: o Chat esta na tela com o painel na tela E na aba Chat; a conta vai ao trilho e a aba pelo mesmo `counts`.
  const console_ = fonte(`${CONSOLE}/session-console.tsx`);
  assert.match(
    console_,
    /const chatNew = useConsoleChatNews\(\{ chatShown: panelShown && "tab" in shownView && shownView\.tab === "chat", messages: snapshot\?\.messages \?\? NO_CHAT_MESSAGES, sessionId, viewerId: currentUserId \}\);/
  );
  assert.match(console_, /const counts = \{\s*\.\.\.consoleTabCounts\([^;]*?\),\s*chat: chatNew,\s*tela: consoleScreenCount\(/);
  assert.equal((console_.match(/counts=\{counts\}/g) ?? []).length, 2, "o painel e o trilho");
});

/* ------------------------------------------------------------------------------------------------
 * A chave "Mostrar quantas pessoas estão na sala" no console (D107)
 * ---------------------------------------------------------------------------------------------- */

test("o pedido: a sessao e a chave; o resto e recusado", () => {
  assert.deepEqual(schemas.showPresentCountSchema.parse({ sessionId: SESSAO, shown: false }), { sessionId: SESSAO, shown: false });
  assert.equal(schemas.showPresentCountSchema.safeParse({ sessionId: SESSAO, shown: true }).success, true);
  for (const errado of [{ sessionId: SESSAO }, { shown: true }, { sessionId: "sessao", shown: true }, { sessionId: SESSAO, shown: "nao" }, { sessionId: SESSAO, shown: 0 }]) {
    assert.equal(schemas.showPresentCountSchema.safeParse(errado).success, false, JSON.stringify(errado));
  }
  // A acao passa pela guarda dos webinarios (a licenca do modulo), nunca pelo runAdminAction direto, e grava so a chave dela.
  const acoes = fonte("src/server/webinars/room-actions.ts");
  const acao = acoes.slice(acoes.indexOf("export async function setShowPresentCount("), acoes.indexOf("/* ----", acoes.indexOf("export async function setShowPresentCount(")));
  assert.match(acao, /return runWebinarAction\("messaging\.write", "atendimento", showPresentCountSchema, input,/);
  assert.match(acao, /if \(!canTeamActOn\(session\)\) \{\s*throw new WebinarError\(SESSION_CLOSED_MESSAGE, 409\);/);
  assert.match(acao, /updateWebinarRow\(db, webinar\.id, \{ room_settings: \{ \.\.\.current, showPresentCount: data\.shown \} \}, \{ expectedUpdatedAt: webinar\.updated_at \}\)/);
  assert.match(acao, /action: "webinar\.show_present_count"/);
});

test("a chave na entrada Presença: o rotulo e a frase do editor, ligada ou desligada como esta gravado, esperando enquanto grava e desligada sem poder agir", () => {
  const chave = (props) => html(createElement(presence.ConsolePresentCount, { busy: false, canAct: true, onChange: noop, shown: true, ...props }));
  const botao = (markup) => markup.slice(markup.indexOf("<button"), markup.indexOf(">", markup.indexOf("<button")) + 1);

  const ligada = chave({});
  assert.equal(presence.CONSOLE_PRESENT_COUNT_ID, "console-present-count");
  assert.match(ligada, /id="console-present-count-title"/);
  assert.ok(textOf(ligada).includes("Número de pessoas na sala"));
  assert.ok(textOf(ligada).includes("Vale para todas as sessões deste webinário. A sala dos alunos acompanha em até 1 minuto."));
  // O mesmo rotulo e a mesma frase do card Sala do editor: a pessoa reconhece a chave.
  assert.ok(textOf(ligada).includes(WEBINAR_ADMIN_COPY.fields.showPresentCount));
  assert.ok(textOf(ligada).includes(WEBINAR_ADMIN_COPY.fields.showPresentCountHint));
  assert.match(ligada, /data-console-present-count="shown"/);
  assert.match(botao(ligada), /aria-checked="true"/);
  assert.match(botao(ligada), /id="console-present-count"/);
  assert.match(botao(ligada), /role="switch"/);
  assert.doesNotMatch(botao(ligada), /disabled=""|aria-busy/);

  const desligada = chave({ shown: false });
  assert.match(desligada, /data-console-present-count="hidden"/);
  assert.match(botao(desligada), /aria-checked="false"/);

  assert.match(botao(chave({ busy: true })), /aria-busy="true"/, "enquanto grava, a chave espera");
  assert.match(botao(chave({ canAct: false })), /disabled=""/, "a sessao encerrada ou sem a permissao");

  // Nenhuma frase com a palavra proibida nem com o nome do motor de video.
  assert.doesNotMatch(JSON.stringify(WEBINAR_COPY.consoleV2.numeroDePessoas), /personagem|jitsi|iframe/i);
});

test("o selo dos presentes: com a chave desligada termina em 'só a equipe vê', depois do pico e dos simulados; ligada, como sempre", () => {
  assert.equal(v2.consolePresenceBadge({ peak: 14, presentNow: 12 }), "12 presentes · pico 14");
  assert.equal(v2.consolePresenceBadge({ hiddenFromStudents: false, peak: 14, presentNow: 12 }), "12 presentes · pico 14");
  assert.equal(v2.consolePresenceBadge({ hiddenFromStudents: true, peak: 14, presentNow: 12 }), "12 presentes · pico 14 · só a equipe vê");
  assert.equal(v2.consolePresenceBadge({ hiddenFromStudents: true, peak: null, presentNow: 1 }), "1 presente · só a equipe vê");
  assert.equal(v2.consolePresenceBadge({ hiddenFromStudents: true, peak: 1, presentNow: 1, simulated: 300 }), "1 presente · pico 1 · +300 simulados · só a equipe vê");
  assert.equal(WEBINAR_COPY.consoleV2.numeroDePessoas.abrirPresenca("7 presentes"), "7 presentes. Abrir a Presença");
});

test("a fiacao do console: a chave no alto da Presença (nunca no Replay), o aviso depois de gravar, o selo que diz a chave desligada e abre a Presença, e o retrato que traz o que esta gravado", () => {
  const console_ = fonte(`${CONSOLE}/session-console.tsx`);
  // A entrada Presença existe na live e na gravada mesmo sem a leitura da presenca: la fica a chave.
  assert.deepEqual(v2.consoleMoreEntriesFor({ hasPresence: false, kind: "live", webinarKind: "live" }).includes("presenca"), true);
  assert.deepEqual(v2.consoleMoreEntriesFor({ hasPresence: false, kind: "simulated", webinarKind: "simulated" }).includes("presenca"), true);
  assert.deepEqual(v2.consoleMoreEntriesFor({ hasPresence: false, kind: "replay", webinarKind: "simulated" }).includes("presenca"), false);
  const presenca = console_.slice(console_.indexOf("presenca:"), console_.indexOf("tela:", console_.indexOf("presenca:")));
  assert.match(presenca, /session\.kind !== "replay" \|\| snapshot\.presence \? \(/);
  assert.match(
    presenca,
    /\{session\.kind !== "replay" \? \(\s*<ConsolePresentCount busy=\{busyKey === "present-count"\} canAct=\{canAct && permissions\.canWrite\} onChange=\{showPresentCountNow\} shown=\{presentShown\} \/>\s*\) : null\}/
  );
  assert.match(
    console_,
    /void run\("present-count", \(\) => setShowPresentCount\(\{ sessionId, shown \}\), \(\) => adminToast\.success\(shown \? v2Copy\.numeroDePessoas\.mostrando : v2Copy\.numeroDePessoas\.escondido\)\);/
  );
  assert.equal(WEBINAR_COPY.consoleV2.numeroDePessoas.mostrando, "Os alunos voltam a ver quantas pessoas estão na sala.");
  assert.equal(WEBINAR_COPY.consoleV2.numeroDePessoas.escondido, "Os alunos não veem mais quantas pessoas estão na sala.");
  // O que os alunos veem vem do retrato (ausente no de antes: ligado); o selo so diz a chave fora do Replay.
  assert.match(console_, /const presentShown = snapshot\?\.showPresentCount !== false;/);
  assert.match(console_, /hiddenFromStudents: session\.kind !== "replay" && !presentShown,/);
  assert.match(console_, /const presentOpens = entries\.includes\("presenca"\);/);
  // O retrato le a chave do webinario a cada leitura.
  assert.match(fonte("src/server/webinars/console-queries.ts"), /showPresentCount: input\.webinar \? roomSettingsOfRow\(input\.webinar\.room_settings\)\.showPresentCount : true,/);
});

test("a chave continua no card Sala do editor, o mesmo de Novo webinário e de editar, para a Live ao vivo e a gravada", () => {
  // O card Sala esta na lista de cards de todo tipo de webinario, e a pagina Novo webinário usa o mesmo editor.
  assert.ok(WEBINAR_EDITOR_CARDS.includes("sala"));
  const novo = fonte("src/app/admin/(v2)/comunicacao/webinarios/novo/page.tsx");
  assert.match(novo, /import \{ WebinarEditor \} from "@\/components\/admin\/v2\/communication\/webinars\/webinar-editor";/);
  assert.match(novo, /<WebinarEditor/);
  const cards = fonte("src/components/admin/v2/communication/webinars/webinar-editor-cards.tsx");
  const sala = cards.slice(cards.indexOf("export function RoomCard("), cards.indexOf("export function", cards.indexOf("export function RoomCard(") + 10));
  assert.match(sala, /<AdminSwitch\s+checked=\{room\.showPresentCount\}\s+description=\{copy\.showPresentCountHint\}\s+disabled=\{disabled\}\s+id="webinar-room-showPresentCount"\s+label=\{copy\.showPresentCount\}/);
  assert.doesNotMatch(sala.slice(sala.indexOf('id="webinar-room-showPresentCount"') - 200, sala.indexOf('id="webinar-room-showPresentCount"')), /draft\.kind/, "sem depender do tipo: vale na live e na gravada");
});

/* ------------------------------------------------------------------------------------------------
 * A chave chega ao aluno em segundos (D107): a memoria de 15 s e o sinal que diz se o numero esta escondido
 * ---------------------------------------------------------------------------------------------- */

test("a memoria da chave: vale 15 s por webinario; esquecida pela acao do console, o proximo sinal le o banco; cada webinario a sua", async () => {
  const memory = await import("../src/server/webinars/present-count-memory.ts");
  const W1 = "aaaaaaaa-0000-4000-8000-000000000001";
  const W2 = "aaaaaaaa-0000-4000-8000-000000000002";
  const T0 = Date.parse("2026-11-12T22:00:00.000Z");
  memory.resetPresentCountMemory();
  assert.equal(memory.PRESENT_COUNT_REFRESH_MS, 15_000, "o intervalo do sinal de presenca: a mudanca chega no sinal seguinte ou no outro");
  assert.equal(memory.rememberedPresentCount(W1, T0), null, "nada guardado: le o banco");

  memory.rememberPresentCount(W1, false, T0);
  assert.equal(memory.rememberedPresentCount(W1, T0), false);
  assert.equal(memory.rememberedPresentCount(W1, T0 + 14_999), false, "dentro dos 15 s");
  assert.equal(memory.rememberedPresentCount(W1, T0 + 15_000), null, "vencida: le o banco de novo");
  assert.equal(memory.rememberedPresentCount(W2, T0), null, "cada webinario a sua");

  memory.rememberPresentCount(W2, true, T0);
  memory.forgetPresentCount(W1);
  assert.equal(memory.rememberedPresentCount(W1, T0 + 1), null, "a acao do console esquece so a do webinario dela");
  assert.equal(memory.rememberedPresentCount(W2, T0 + 1), true);
  memory.resetPresentCountMemory();
  assert.equal(memory.rememberedPresentCount(W2, T0 + 1), null);

  // O modulo e puro (a acao do console nao carrega as rotas da sala por causa dele).
  assert.doesNotMatch(fonte("src/server/webinars/present-count-memory.ts"), /^import /m);
  const acoes = fonte("src/server/webinars/room-actions.ts");
  assert.match(acoes, /import \{ forgetPresentCount \} from "\.\/present-count-memory";/);
  assert.match(acoes, /updateWebinarRow\(db, webinar\.id, \{ room_settings: \{ \.\.\.current, showPresentCount: data\.shown \} \}, \{ expectedUpdatedAt: webinar\.updated_at \}\);[\s\S]{0,200}?forgetPresentCount\(webinar\.id\);/);
});

test("o sinal de 15 s rele a chave a parte e diz se o numero esta escondido; as duas salas seguem o ultimo sinal e, antes dele, a sessao", () => {
  // O servidor: uma leitura por webinario (os sinais juntos esperam a mesma), e a falha da leitura nunca derruba a presenca.
  const rota = fonte("src/server/webinars/room-route.ts");
  const leitura = rota.slice(rota.indexOf("export async function loadPresentCountShown("), rota.indexOf("/** Zera o acesso guardado"));
  assert.match(leitura, /const remembered = rememberedPresentCount\(webinarId, now\);\s*if \(remembered !== null\) \{\s*return remembered;\s*\}/);
  assert.match(leitura, /const reading = presentCountReads\.get\(webinarId\);\s*if \(reading\) \{\s*return reading;\s*\}/);
  assert.match(leitura, /const shown = row \? roomSettingsOfRow\(row\.room_settings\)\.showPresentCount : fallback;\s*rememberPresentCount\(webinarId, shown, now\);/);
  assert.match(leitura, /\} catch \{\s*return fallback;\s*\} finally \{\s*presentCountReads\.delete\(webinarId\);/);
  const sinal = fonte("src/app/api/webinars/[id]/heartbeat/route.ts");
  assert.match(sinal, /context: \{ durationMs: room\.durationMs, recordingId: room\.recording\?\.id \?\? null, session: room\.session, showPresentCount \},/);
  assert.match(sinal, /return ok\(\{ ended: result\.ended, offsetMs: result\.offsetMs, presentHidden: !showPresentCount, presentNow: result\.presentNow, serverTime: result\.serverTime \}\);/);

  // A sala: o gancho do sinal entrega o `presentHidden`; a resposta do servidor de antes (sem ele) deixa a sessao valer.
  const gancho = fonte("src/components/member/webinars/room/use-room-data.ts");
  assert.match(gancho, /readRef\.current\.onAnswer\?\.\(\{ ended: answer\.ended, presentHidden: answer\.presentHidden, presentNow: answer\.presentNow \}\);/);
  for (const arquivo of ["live-room.tsx", "webinar-room.tsx"]) {
    const sala = fonte(`src/components/member/webinars/room/${arquivo}`);
    assert.match(sala, /const \[heartbeatHidden, setHeartbeatHidden\] = useState<boolean \| null>\(null\);/, arquivo);
    assert.match(sala, /setHeartbeatHidden\(typeof answer\.presentHidden === "boolean" \? answer\.presentHidden : null\);/, arquivo);
    assert.match(sala, /const presentHidden = heartbeatHidden \?\? session\.presentHidden === true;/, arquivo);
  }
});
