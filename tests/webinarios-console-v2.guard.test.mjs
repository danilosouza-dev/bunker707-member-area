import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Guarda do console V2 de quem apresenta (docs/31 V2-12 a V2-15 e §5.4; docs/18 §2.2 item 4, por isso .guard): o
// texto do codigo-fonte que nenhum teste de tela alcanca. O comportamento fica nos testes de tela
// (webinarios-console-ao-vivo-tela, webinarios-console-tela, admin-v2-shell-tela) e nos de funcao pura
// (webinarios-console-v2-modelo, webinarios-console-ao-vivo-modelo, webinarios-console-modelo). Aqui:
// - as frases do console so dos arquivos de copy: nenhum texto nem rotulo escrito direto no JSX da pasta inteira;
// - as superficies do console nos tokens, sem os hex fixos de antes, e as pecas da sala que o console usa sem o
//   --accent do shadcn (cinza na ponte do console);
// - o console ligado as regras puras (as abas, o ⋯, os botoes do topo, o esqueleto, a barra, o vigia, a coluna) e o
//   [data-live-stage] escrito uma vez so;
// - nada de moderacao de tela pelo IFrame API, nem rejectParticipant ou muteEveryone de tela (§5.4);
// - as confirmacoes do console dentro da raiz com o tema, sem data-scope nos arquivos do console;
// - nenhum texto promete barrar um cliente que ignora o pedido de mudo (o vigia so para o cliente padrao, §7);
// - os sinais que so o console ouve fora da lista da sala do aluno;
// - os comandos do IFrame API ligados aos botoes, a ancora, o Gravar da fila e as Configurações de quem apresenta.

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const ler = (caminho) => readFileSync(path.join(root, caminho), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const CONSOLE = "src/components/admin/v2/communication/webinars/session-console";
const ROOM = "src/components/member/webinars/room";

/** Os arquivos da pasta do console (uma peca nova entra sozinha, uma apagada sai sozinha). */
const FONTES = readdirSync(path.join(root, CONSOLE))
  .filter((nome) => /\.tsx?$/.test(nome))
  .sort()
  .map((nome) => `${CONSOLE}/${nome}`);
const TSX = FONTES.filter((caminho) => caminho.endsWith(".tsx"));
const fonte = (nome) => {
  const caminho = `${CONSOLE}/${nome}`;
  assert.ok(FONTES.includes(caminho), `arquivo esperado: ${caminho}`);
  return semComentarios(ler(caminho));
};

/** Arquivos (.ts, .tsx, .mjs, .js) de uma pasta, nas subpastas tambem. */
function arquivosDe(pasta) {
  const lista = [];
  const visitar = (atual) => {
    for (const nome of readdirSync(path.join(root, atual))) {
      const caminho = `${atual}/${nome}`;
      if (statSync(path.join(root, caminho)).isDirectory()) {
        visitar(caminho);
      } else if (/\.(?:tsx?|mjs|js)$/.test(nome)) {
        lista.push(caminho);
      }
    }
  };
  visitar(pasta);
  return lista.sort();
}

/* ------------------------------------------------------------------------------------------------
 * As frases: o detector da sala (tests/webinarios-sala-frases.guard.test.mjs) na pasta do console
 * ---------------------------------------------------------------------------------------------- */

/** Os atributos que quem apresenta le ou ouve: o nome acessivel, a dica, o campo vazio, a imagem e o rotulo das pecas. */
const ROTULOS = new Set(["alt", "aria-description", "aria-label", "aria-placeholder", "aria-roledescription", "aria-valuetext", "label", "placeholder", "title"]);

/** Duas letras seguidas: o que separa uma frase de um espaco, de um ponto do meio ou de um numero. */
const temLetras = (texto) => /\p{L}{2,}/u.test(texto.replace(/&[#\w]+;/g, " "));

/** Os pedacos fixos de um texto em aspas ou em crases (o que fica fora dos ${}), ou null se nao e um texto. */
function pedacosFixos(no) {
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) {
    return [no.text];
  }
  if (ts.isTemplateExpression(no)) {
    return [no.head.text, ...no.templateSpans.map((trecho) => trecho.literal.text)];
  }
  return null;
}

/** Os textos que uma expressao entre chaves pode desenhar: o proprio texto, os dois lados do ? : e o fim do && e do ??. */
function textosDaExpressao(no) {
  if (!no) {
    return [];
  }
  const fixos = pedacosFixos(no);
  if (fixos) {
    return fixos.filter(temLetras);
  }
  if (ts.isParenthesizedExpression(no) || ts.isAsExpression(no) || ts.isSatisfiesExpression(no)) {
    return textosDaExpressao(no.expression);
  }
  if (ts.isConditionalExpression(no)) {
    return [...textosDaExpressao(no.whenTrue), ...textosDaExpressao(no.whenFalse)];
  }
  if (ts.isBinaryExpression(no)) {
    const operador = no.operatorToken.kind;
    if (operador === ts.SyntaxKind.AmpersandAmpersandToken) {
      return textosDaExpressao(no.right);
    }
    if (operador === ts.SyntaxKind.BarBarToken || operador === ts.SyntaxKind.QuestionQuestionToken) {
      return [...textosDaExpressao(no.left), ...textosDaExpressao(no.right)];
    }
  }
  return [];
}

/**
 * O que esta escrito direto no desenho, pela arvore do TypeScript: o texto entre as tags, o texto entre chaves no lugar
 * de um filho e os rotulos de ROTULOS em aspas ou em chaves. O CSS de um <style> nao e frase.
 */
function escritosDireto(codigo, arquivo = "peca.tsx") {
  const arvore = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achados = [];
  const visitar = (no) => {
    if (ts.isJsxElement(no) && no.openingElement.tagName.getText() === "style") {
      ts.forEachChild(no.openingElement, visitar);
      return;
    }
    if (ts.isJsxText(no) && temLetras(no.text)) {
      achados.push(`texto: ${no.text.trim()}`);
    }
    if (ts.isJsxExpression(no) && no.parent && (ts.isJsxElement(no.parent) || ts.isJsxFragment(no.parent))) {
      for (const texto of textosDaExpressao(no.expression)) {
        achados.push(`texto: ${texto.trim()}`);
      }
    }
    if (ts.isJsxAttribute(no) && no.initializer && ROTULOS.has(no.name.getText())) {
      const valor = no.initializer;
      const textos = ts.isStringLiteral(valor) ? [valor.text].filter(temLetras) : ts.isJsxExpression(valor) ? textosDaExpressao(valor.expression) : [];
      for (const texto of textos) {
        achados.push(`${no.name.getText()}: ${texto.trim()}`);
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arvore);
  return achados;
}

test("o detector acha o texto e o rotulo escritos direto (o placeholder com um endereco tambem) e deixa passar a frase pela copy", () => {
  assert.deepEqual(escritosDireto('<span className="x">Encerrar live</span>'), ["texto: Encerrar live"]);
  assert.deepEqual(escritosDireto('<span>{aberto ? "Fechar" : copy.abrir}</span>'), ["texto: Fechar"]);
  assert.deepEqual(escritosDireto('<input placeholder="https://iframe.mediadelivery.net/embed/…" />'), ["placeholder: https://iframe.mediadelivery.net/embed/…"]);
  assert.deepEqual(escritosDireto('<RoomBarButton label="Gravar" />'), ["label: Gravar"]);
  assert.deepEqual(escritosDireto("<input placeholder={copy.enderecoPlayerExemplo} />"), []);
  assert.deepEqual(escritosDireto('<span>{" · "}</span>'), [], "o ponto do meio");
  assert.deepEqual(escritosDireto('<div role="log" aria-live="off" data-console-slot="top" className="flex gap-2" />'), [], "os codigos");
});

test("a lista de pecas vem da pasta do console e tem as do console V2", () => {
  for (const peca of [
    "console-bar.tsx", "console-chat.tsx", "console-layout-model.ts", "console-panel.tsx", "console-people-tab.tsx", "console-shell.tsx",
    "console-stage.tsx", "console-top-bar.tsx", "live-attach-recording.tsx", "live-hands.tsx", "live-participants.tsx", "live-recorder.tsx",
    "live-room-panel.tsx", "session-console-skeleton.tsx", "session-console.tsx"
  ]) {
    assert.ok(FONTES.includes(`${CONSOLE}/${peca}`), `${peca} na guarda`);
  }
  // As pecas de antes que o console V2 substituiu nao voltam.
  for (const saiu of ["live-controls.tsx", "live-settings-card.tsx"]) {
    assert.ok(!FONTES.includes(`${CONSOLE}/${saiu}`), `${saiu} saiu (a barra nossa, a aba Pessoas e as Configurações da barra)`);
  }
});

test("as frases do console sao todas dos arquivos de copy: nenhum texto escrito direto no desenho, e as pecas da sala ao vivo (live-*.tsx) so com WEBINAR_COPY", () => {
  assert.ok(TSX.length >= 20, `os .tsx do console: ${TSX.length}`);
  for (const caminho of TSX) {
    assert.deepEqual(escritosDireto(ler(caminho), caminho), [], `${caminho}: texto ou rotulo escrito direto`);
  }
  const live = TSX.filter((caminho) => /\/live-[^/]+\.tsx$/.test(caminho));
  assert.ok(live.includes(`${CONSOLE}/live-room-panel.tsx`));
  for (const caminho of live) {
    assert.doesNotMatch(semComentarios(ler(caminho)), /WEBINAR_ADMIN_COPY/, `${caminho}: as frases da sala ao vivo sao de WEBINAR_COPY`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * As cores: os tokens do tema, sem os hex de antes nem o --accent cinza da ponte
 * ---------------------------------------------------------------------------------------------- */

test("as superficies do console nao voltam aos hex fixos de antes (#0b0b0b, #111, #0f0f0f, #161616, #1b1b1b, #121212)", () => {
  const HEX = ["0b0b0b", "111", "0f0f0f", "161616", "1b1b1b", "121212"];
  const proibido = new RegExp(`#(?:${HEX.join("|")})(?![0-9a-f])`, "i");
  const arquivos = [...FONTES, "src/components/admin/v2/admin-shell.tsx", "src/app/admin/(v2)/comunicacao/webinarios/[id]/sala/loading.tsx"];
  for (const caminho of arquivos) {
    assert.doesNotMatch(semComentarios(ler(caminho)), proibido, caminho);
  }
});

test("as pecas da sala que o console usa pintam o acento pelo --room-accent, nunca pelo --accent do shadcn (cinza na ponte do console)", () => {
  // As pecas importadas pela pasta do console e as que elas importam da propria sala (o selo do palco usa o cabecalho).
  const direto = new Set();
  for (const caminho of FONTES) {
    for (const [, modulo] of ler(caminho).matchAll(/from "@\/components\/member\/webinars\/room\/([^"]+)"/g)) {
      direto.add(modulo);
    }
  }
  const pecas = new Set();
  for (const modulo of direto) {
    const caminho = `${ROOM}/${modulo}.tsx`;
    try {
      statSync(path.join(root, caminho));
    } catch {
      continue;
    }
    pecas.add(caminho);
    for (const [, vizinho] of ler(caminho).matchAll(/from "\.\/([^"]+)"/g)) {
      try {
        statSync(path.join(root, `${ROOM}/${vizinho}.tsx`));
        pecas.add(`${ROOM}/${vizinho}.tsx`);
      } catch {
        // Um modulo .ts (modelo, gancho): sem desenho.
      }
    }
  }
  for (const peca of ["room-ui", "room-stage-badges", "room-bar", "room-panel", "room-chat", "room-view-menu", "live-settings", "room-header"]) {
    assert.ok(pecas.has(`${ROOM}/${peca}.tsx`), `${peca}.tsx entre as pecas do console`);
  }
  for (const caminho of pecas) {
    assert.doesNotMatch(semComentarios(ler(caminho)), /var\(--accent\)/, `${caminho}: o acento pelo --room-accent (bg-room-accent)`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * As regras puras e o palco
 * ---------------------------------------------------------------------------------------------- */

test("o console usa as regras puras, nao uma copia delas: as abas, o ⋯, o topo, o esqueleto, a barra, o vigia, a coluna e o Remover do ⋮", () => {
  const main = fonte("session-console.tsx");
  for (const regra of ["consoleTabsFor", "consoleMoreEntriesFor", "consoleTopActionsFor", "consoleSkeleton", "consoleTabCounts", "consolePanelViewOf", "consolePresenceBadge", "consoleStageTopLeft"]) {
    assert.match(main, new RegExp(`\\b${regra}\\(`), `session-console.tsx chama ${regra}`);
  }
  assert.match(fonte("session-console-skeleton.tsx"), /\bconsoleSkeleton\(/, "o esqueleto do carregamento e o mesmo");
  const bar = fonte("console-bar.tsx");
  assert.match(bar, /\bconsoleBarItemsFor\(/);
  assert.match(bar, /\bconsoleRecordButton\(/);
  const panel = fonte("live-room-panel.tsx");
  for (const regra of ["screenShareWatchStep", "rolesToRead", "menuKickPlan", "participantMenuClickOf", "consoleFilmstripShouldToggle", "consoleScreenShareMode"]) {
    assert.match(panel, new RegExp(`\\b${regra}\\(`), `live-room-panel.tsx chama ${regra}`);
  }
  // O primeiro sinal de um iframe novo vale como a saida do anterior (o Tentar de novo depois de um erro fatal nao recebe
  // o videoConferenceLeft): o preparo de quem apresenta, a sala de espera, as leituras e os pedidos do vigia recomecam.
  const novo = panel.slice(panel.indexOf("if (newFrame) {"), panel.indexOf('dispatch({ type: "frame" });'));
  for (const reset of ["setupDone.current = false;", "lobbySent.current = null;", "leftCountRef.current += 1;", "stoppedRef.current = new Set();", "setSharing(false);"]) {
    assert.ok(novo.includes(reset), `o iframe novo faz ${reset}`);
  }
  for (const [fonteDe, regra] of [["console-people-tab.tsx", "consoleRowFocusAfter"], ["live-hands.tsx", "consoleRowFocusAfter"], ["session-console.tsx", "consolePollStep"]]) {
    assert.match(fonte(fonteDe), new RegExp(`\\b${regra}\\(`), `${fonteDe} chama ${regra}`);
  }
  const stage = fonte("console-stage.tsx");
  assert.match(stage, /\bconsoleColumnPolicy\(/);
  assert.match(stage, /\bconsoleStageBadgeFor\(/);
  const chat = fonte("console-chat.tsx");
  for (const regra of ["consoleChatQueue", "consoleMessageMeta", "consoleChatFocusAfter"]) {
    assert.match(chat, new RegExp(`\\b${regra}\\(`), `console-chat.tsx chama ${regra}`);
  }
  assert.match(fonte("console-top-bar.tsx"), /\bconsoleSessionOptionLabel\(/);
  assert.match(semComentarios(ler("src/components/admin/v2/admin-shell.tsx")), /\bisAdminFullScreenPath\(/, "a moldura sem a barra lateral pelo caminho");
});

test("o [data-live-stage] (o pai do iframe) e escrito uma vez so, no palco do console, e nunca muda de pai", () => {
  const usos = FONTES.flatMap((caminho) => Array.from(semComentarios(ler(caminho)).matchAll(/\bdata-live-stage(?=[=\s>])/g), () => caminho));
  assert.deepEqual(usos, [`${CONSOLE}/console-stage.tsx`]);
});

test("as preferencias do console em chaves proprias: o tema e o painel pelos prefStore das chaves do console", () => {
  const prefs = semComentarios(ler(`${ROOM}/use-room-prefs.ts`));
  assert.match(prefs, /const consoleThemeStore = prefStore\(CONSOLE_THEME_KEY\);/);
  assert.match(prefs, /const consolePanelStore = prefStore\(CONSOLE_PANEL_KEY\);/);
  assert.match(prefs, /export function useConsoleTheme\(\)[^{]*\{[^}]*useStoredValue\(consoleThemeStore\)[\s\S]*?consoleThemeStore\.write\(/);
  assert.match(prefs, /export function useConsolePanelOpen\(\)[^{]*\{[\s\S]*?useStoredValue\(consolePanelStore\)[\s\S]*?consolePanelStore\.write\(/);
});

/* ------------------------------------------------------------------------------------------------
 * A tela compartilhada (docs/31 §5.4 e §7)
 * ---------------------------------------------------------------------------------------------- */

test("nada de moderacao de tela pelo IFrame API em src: nenhum toggleModeration com desktop (cai na de audio), nem rejectParticipant (recusaria o audio) ou muteEveryone (pegaria o co-apresentador) de tela", () => {
  const arquivos = arquivosDe("src");
  assert.ok(arquivos.length > 200, `os arquivos de src: ${arquivos.length}`);
  for (const caminho of arquivos) {
    const codigo = semComentarios(ler(caminho));
    assert.doesNotMatch(codigo, /toggleModeration["'`]?\s*,[^)\]\n]*["'`]desktop["'`]|\["toggleModeration",[^\]]*"desktop"/, `${caminho}: toggleModeration de tela`);
    assert.doesNotMatch(codigo, /(?:rejectParticipant|muteEveryone)["'`]?\s*,[^)\]\n]*["'`]desktop["'`]|\["(?:rejectParticipant|muteEveryone)",[^\]]*"desktop"/, `${caminho}: rejectParticipant ou muteEveryone de tela`);
  }
  // O vigia para a tela pelo mudo de tela de cada um (o unico jeito que o IFrame API da tag tem).
  assert.match(fonte("live-room-panel.tsx"), /command\("muteRemoteParticipant", id, "desktop"\)/);
});

test("nenhum texto promete barrar um cliente adulterado: o vigia so para o cliente padrao (docs/31 §7 fala em cliente modificado)", () => {
  const arquivos = [...arquivosDe("src/server/webinars"), ...arquivosDe("src/components/admin/v2/communication/webinars"), "docs/30-webinarios.md", "docs/31-webinarios-redesign-v2.md"];
  for (const caminho of arquivos) {
    assert.doesNotMatch(ler(caminho), /cliente adulterad/i, caminho);
  }
  assert.match(ler("docs/31-webinarios-redesign-v2.md"), /cliente modificado/);
});

test("os sinais que so o console ouve ficam fora da lista da sala do aluno (cada sinal da lista passa pela sala em toda pagina de aluno)", async () => {
  const embed = await import("../src/lib/jitsi-room-config.ts");
  // Os cinco, inclusive os da tela: um sinal nas duas listas passaria duas vezes pelo console (a juncao abaixo).
  assert.deepEqual([...embed.CONSOLE_EXTRA_EVENTS].sort(), ["contentSharingParticipantsChanged", "moderationStatusChanged", "participantMenuButtonClick", "participantMuted", "screenSharingStatusChanged"]);
  for (const sinal of embed.CONSOLE_EXTRA_EVENTS) {
    assert.ok(!embed.JITSI_LISTENED_EVENTS.includes(sinal), `${sinal} fora da sala do aluno`);
  }
  assert.equal(new Set(embed.JITSI_LISTENED_EVENTS).size, embed.JITSI_LISTENED_EVENTS.length, "a lista da sala sem nome repetido");
  assert.equal(new Set(embed.CONSOLE_EXTRA_EVENTS).size, embed.CONSOLE_EXTRA_EVENTS.length, "a lista do console sem nome repetido");
  // O console monta com a lista da sala mais a dele.
  assert.match(fonte("live-room-panel.tsx"), /\[\.\.\.JITSI_LISTENED_EVENTS, \.\.\.CONSOLE_EXTRA_EVENTS\]/);
});

/* ------------------------------------------------------------------------------------------------
 * As confirmacoes e a moldura
 * ---------------------------------------------------------------------------------------------- */

test("as confirmacoes do console abrem dentro da raiz com o tema (container={portalRef}), e nenhum arquivo do console escreve data-scope", () => {
  const main = fonte("session-console.tsx");
  const dialogos = Array.from(main.matchAll(/<ConfirmDialog\b(?:=>|[^>])*>/g), ([abertura]) => abertura);
  assert.ok(dialogos.length >= 3, `as confirmacoes do console: ${dialogos.length}`);
  for (const abertura of dialogos) {
    assert.match(abertura, /\scontainer=\{portalRef\}/, abertura.slice(0, 80));
  }
  for (const caminho of FONTES) {
    assert.doesNotMatch(semComentarios(ler(caminho)), /data-scope/, `${caminho}: o data-scope="admin" fica so na moldura`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Os comandos do IFrame API ligados aos botoes (vindos de tests/webinarios-console-ao-vivo-tela.test.mjs)
 * ---------------------------------------------------------------------------------------------- */

test("o iframe pelo useJitsiMeet com o token do join-token e o nonce da pagina; os comandos do IFrame API ligados aos botoes; a ancora no recordingStatusChanged; o Gravar da fila uma vez", () => {
  const panel = fonte("live-room-panel.tsx");
  // Sem argumento de tipo explicito: o useJitsiMeet le a lista de sinais da montagem.
  assert.match(panel, /useJitsiMeet\(\{/);
  assert.match(panel, /\/api\/webinars\/\$\{encodeURIComponent\(webinarId\)\}\/join-token/);
  // O tema do console vai ao iframe na montagem (docs/31 V2-12), pelo mesmo `look` da sala do aluno; a superficie console
  // (V2-14): quem apresenta usa a nossa barra, e o Compartilhar tela e pelo navegador.
  assert.match(panel, /liveConfigOverwrite\(token\.reply\.role, token\.reply\.settings, look, "console", screenShare\)/);
  assert.match(panel, /nonce: input\.nonce/);
  assert.match(panel, /tokenRefreshDelayMs\(/, "o token novo antes do exp");
  assert.match(panel, /name === "recordingStatusChanged" && shouldMarkAnchor\(/, "a ancora sai do recordingStatusChanged");
  assert.match(panel, /shouldAutoStartRecording\([\s\S]*?command\("startRecording", \{ mode: "file" \}\)/, "o Gravar da fila dispara sozinho");
  // A moderacao de audio e a de video (sem camera de aluno) e o seguir a visao saem de presenterSetupCommands
  // (live-console-model), mandados um a um ao virar moderador; a de tela nao liga pelo IFrame API (docs/31 §5.4).
  assert.match(panel, /presenterSetupCommands\(\{ allowStudentCamera: webinar\.allowStudentCamera !== false, role \}\)\)\s*\{\s*command\(name, \.\.\.args\);/, "os comandos do apresentador ao virar moderador");
  assert.match(panel, /command\("toggleLobby", value\)/);
  // Câmeras livres: so o comando; o estado vem do moderationStatusChanged de video (o e2e confere o eco).
  assert.match(panel, /command\("toggleModeration", !allowed, "video"\)/, "Câmeras livres");

  // As acoes de todos e a Sala de espera na aba Pessoas (docs/31 V2-14).
  const people = fonte("console-people-tab.tsx");
  assert.match(people, /command\("muteEveryone", "audio"\)[\s\S]*?copy\.silenciarTodos/);
  assert.match(people, /command\("muteEveryone", "video"\)[\s\S]*?copy\.fecharCameras/);
  assert.match(people, /command\("answerKnockingParticipant", id, true\)/);

  const hands = fonte("live-hands.tsx");
  assert.match(hands, /command\("askToUnmute", id\)/);
  assert.match(hands, /command\("muteRemoteParticipant", id, "audio"\)/);
  assert.match(hands, /command\("rejectParticipant", id, "audio"\)/);
  assert.match(hands, /command\("sendEndpointTextMessage", id, lowerHandMessage\(\)\)/);

  const main = fonte("session-console.tsx");
  assert.match(main, /kickFromSession\(\{ sessionId, userId \}\), \(\) => \{[\s\S]*?room\.command\("kickParticipant", participantId\)/, "Remover: o servidor primeiro, depois o iframe");
  assert.match(main, /banStudent\([\s\S]*?room\.command\("kickParticipant", target\.participantId\)/);
  assert.match(main, /requestRecording\(\{ sessionId \}\)[\s\S]*?reply\.action === "start"[\s\S]*?room\.command\("startRecording", \{ mode: "file" \}\)/);
  assert.match(main, /room\.command\("stopRecording"/);
  assert.match(main, /endLiveSession\(\{ sessionId \}\), \(\) => \{\s*room\.command\("endConference"\);\s*room\.command\("hangup"\);/);
  assert.match(main, /startLiveSession\(\{ sessionId \}\), \(\) =>\s*room\.syncLobby\(desiredLobby\(/, "Começar para todos desliga a sala de espera");
  assert.match(main, /setRoomLock\(\{ locked, sessionId \}\), \(\) =>\s*room\.syncLobby\(/, "Trancar liga a sala de espera");
  assert.match(main, /room\.command\("askToUnmute", participantId\);\s*room\.command\("approveVideo", participantId\);/, "Convidar ao palco");
  assert.match(main, /room\.command\("setLargeVideoParticipant", participantId\);\s*room\.command\("pinParticipant", participantId\);/, "Destacar");
  assert.match(main, /markRecordingAnchor\(\{ sessionId \}\)/);

  const page = semComentarios(ler("src/app/admin/(v2)/comunicacao/webinarios/[id]/sala/page.tsx"));
  assert.match(page, /headers\(\)/);
  assert.match(page, /nonce=\{requestHeaders\.get\("x-nonce"\)\}/);
});

test("as Configurações de quem apresenta: os aparelhos pelo useJitsiDevices do console, a troca so com a secao pronta e so de quem apresenta, a engrenagem do motor so de aparelhos pelo papel, o Esc que fecha e nada de setVideoQuality", () => {
  const panel = fonte("live-room-panel.tsx");
  assert.match(panel, /useJitsiDevices\(\{[\s\S]*?podeTrocar: \(kind\) => deviceSettingsRef\.current !== null && deviceSectionReady\(deviceSettingsRef\.current, kind\)/);
  assert.match(panel, /deviceSettingsRef\.current = presenter \? deviceSettings : null;/, "so quem apresenta troca");
  assert.match(panel, /chooseDevice = \(kind: DeviceKind, option: DeviceOption\) => presenter && deviceSectionReady\(deviceSettings, kind\) && escolher\(kind, option\)/);
  assert.match(panel, /deviceSettingsFor\(\{[\s\S]*?role,[\s\S]*?videoOn: joined && videoOn/);
  assert.match(panel, /devicesSignalRef\.current\(name, payload\)/, "deviceListChanged e o ruido de volta numa entrada nova");
  assert.match(panel, /useMemo\(\(\) => liveInterfaceConfigOverwrite\(tokenRole, look\), \[tokenRole, look\]\)/, "a engrenagem so de aparelhos depende do papel (e o visual do tema, na montagem)");
  // Ruido, fundo e espelho sem estado nem reaplicacao: o menu da miniatura e o dialogo de fundo do motor tambem os mudam.
  assert.match(panel, /useJitsiDevices\(\{[\s\S]*?efeitosNoIframe: true,/);

  const bar = fonte("console-bar.tsx");
  assert.match(bar, /<LiveSettings[\s\S]*?cameraOn=\{handle\.videoOn\}[\s\S]*?onChoose=\{handle\.chooseDevice\}[\s\S]*?presenterBar="ours"/);
  assert.match(bar, /event\.key === "Escape"/);
  for (const codigo of [panel, bar]) {
    assert.doesNotMatch(codigo, /setVideoQuality|qualidade\(|volume\(|toggleNoiseSuppression/, "quem apresenta nao baixa o proprio palco");
  }
  const hook = semComentarios(ler("src/components/webinars/use-jitsi-devices.ts"));
  assert.match(hook, /const maisFundos = useCallback\(\(\) => \{\s*executeCommand\("toggleVirtualBackgroundDialog"\);/);
});
