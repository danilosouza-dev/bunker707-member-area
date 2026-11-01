import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda da sala ao vivo V2 (docs/31 V2-6 a V2-8; docs/18 §2.7, por isso .guard): a sala ligada as regras puras do
// painel e do palco, que um teste de tela nao alcanca (o servidor pinta o computador e nada aberto: sem o celular com
// Configurações aberto, sem o painel fechado e sem o card da Oferta). O comportamento de cada regra fica em
// tests/webinarios-sala-v2-modelo.test.mjs (roomPanelShown, panelToggleStep, liveSkeletonState, panelTabsFor,
// chatPillsShown, firstFocusTarget, panelUnreadMark, offerOnScreen e stageAssistantShown) e o do trilho a direita em
// tests/webinarios-sala-yt-modelo.test.mjs (railStep); o e2e da sala ao vivo abre
// Configurações no celular em pe e deitado e fecha o painel pelo X. Aqui so se confere que live-room.tsx,
// webinar-room.tsx e room-offer.tsx usam as regras, e nao uma copia delas.

const root = fileURLToPath(new URL("../", import.meta.url));
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const room = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/live-room.tsx"), "utf8"));
const recorded = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/webinar-room.tsx"), "utf8"));
const offer = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/room-offer.tsx"), "utf8"));
const hook = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/use-live-room.ts"), "utf8"));
const chatPanel = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/room-chat.tsx"), "utf8"));
const roomPanel = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/room-panel.tsx"), "utf8"));

test("o painel do chat e o palco da live saem das regras puras: o takeover do celular so abaixo de lg, o painel por roomPanelShown e o esqueleto por liveSkeletonState", () => {
  assert.match(room, /const settingsTakeover = settingsShown && !desktop;/, "Configurações toma o lugar do chat so no celular");
  assert.match(room, /const panelShown = roomPanelShown\(\{ barShown, panelOpen, settingsTakeover \}\);/);
  assert.match(room, /const skeletonState = liveSkeletonState\(\{ blocked, cinema: cinemaOn, panelShown, settingsTakeover \}\);\s*const skeleton = roomSkeleton\("normal", skeletonState\);/, "o minimo de 96 px na caixa do palco");
  assert.doesNotMatch(room, /min-h-24/, "o minimo do palco fica so no esqueleto (a caixa), nunca no palco dentro dela");
  // As pilulas do chat (V2-8) pela regra pura: fora do palco pequeno (Configurações no celular) e da frase de removido.
  assert.match(room, /chatPillsShown\(\{ blocked, design: "normal", offerShown: false, panelShown, settingsTakeover \}\) \? <RoomChatPills kind="live" messages=\{overlayMessages\(translation\.messages\)\} \/>/);
  assert.doesNotMatch(room, /LiveChatOverlay/, "o chat por cima do palco so no celular saiu");
});

test("o balao com Configurações aberto no celular: fecha Configurações e mostra o chat; a aba da linha so troca de aba; o trilho abre e fecha pela regra pura (railStep) nas duas salas", () => {
  assert.match(room, /function togglePanel\(\) \{\s*const step = panelToggleStep\(\{ panelShown, settingsTakeover \}\);\s*if \(step\.closeSettings\) \{\s*closeSettings\(\);\s*\}\s*setPanelOpen\(step\.panelOpen\);\s*\}/);
  assert.doesNotMatch(room, /setPanelOpen\(!panelOpen\)/, "a aba de baixo que abria e fechava saiu: o balao manda");
  assert.match(room, /onTab=\{setTab\}/);
  // O trilho a direita (a partir de lg): o item abre naquela aba e, aberto, fecha so com a barra na tela (railStep), nunca
  // por um setPanelOpen(!panelOpen) que fecharia o painel da sessao encerrada sem jeito de reabrir.
  for (const [nome, fonte] of [
    ["live-room", room],
    ["webinar-room", recorded]
  ]) {
    assert.match(fonte, /function onRail\(item: RoomPanelTab\) \{\s*const step = railStep\(\{ closable: barShown, item, panelShown, tab \}\);\s*setTab\(step\.tab\);\s*setPanelOpen\(step\.panelOpen\);/, nome);
    assert.match(fonte, /<RoomRail kind=\{?[^ ]+ onItem=\{onRail\} panelShown=\{panelShown\} pollOpen=\{openPolls\.length > 0\} tab=\{tab\} tabs=\{tabs\} unread=\{unread\} \/>/, nome);
    // O X devolve o foco ao item do trilho da aba que estava aberta.
    assert.match(fonte, /returnFocusFromPanel\(rootRef\.current, document\.activeElement, document\.getElementById\(ROOM_PANEL_ID\), tab\);/, nome);
  }
  // O trilho fica com o painel: na live, fora da frase de removido ou banido; na gravada, nunca no vertical nem fora do
  // acesso (D41).
  assert.match(room, /\{blocked \? null : \(\s*<>\s*\{\s*\}\s*<RoomPanel[\s\S]*?<\/RoomPanel>\s*\{\s*\}\s*<RoomRail /);
  assert.match(recorded, /\{vertical \|\| unavailable \? null : \(\s*<>\s*\{\s*\}\s*<RoomPanel[\s\S]*?<\/RoomPanel>\s*\{\s*\}\s*<RoomRail /);
  assert.equal(room.match(/<RoomRail /g)?.length, 1);
  assert.equal(recorded.match(/<RoomRail /g)?.length, 1);
});

test("o painel das duas salas: as abas pela regra das tres salas, o primeiro foco, o contador do balao e o X (V2-7 e V2-8)", () => {
  assert.match(room, /const tabs = panelTabsFor\(\{ kind: "live", openPolls: openPolls\.length, tab \}\);/);
  assert.match(recorded, /const tabs = panelTabsFor\(\{ kind, openPolls: openPolls\.length, tab \}\);/);
  for (const [nome, fonte] of [
    ["live-room", room],
    ["webinar-room", recorded]
  ]) {
    assert.match(fonte, /const firstFocus = firstFocusTarget\(\{ panelShown \}\);/, nome);
    assert.match(fonte, /panelFirstFocus=\{firstFocus === "panel-toggle"\}/, nome);
    assert.match(fonte, /panelUnread=\{unread\}/, nome);
    assert.match(fonte, /<RoomPanel\s+className=\{skeleton\.panel\}\s+closable=\{barShown\}[\s\S]*?firstFocus=\{firstFocus === "tab"\}\s+id=\{ROOM_PANEL_ID\}[\s\S]*?onClose=\{\(\) => setPanelOpen\(false\)\}[\s\S]*?open=\{panelShown\}/, nome);
    // O contador do balao e do Chat do trilho conta enquanto o Chat nao esta na tela (o painel fechado ou noutra aba).
    assert.match(fonte, /const chatShown = panelShown && tab === "chat";/, nome);
    assert.match(fonte, /const unread = useRoomPanelUnread\(\{ chatLoaded: chat\.loaded, kind[^,]*, messages: translation\.messages, offsetMs: [^,]+, chatShown \}\);/, nome);
  }
  // A live diz que e a live: o contador dela conta so pelos ids (panelUnreadMark), porque o zero do offset anda.
  assert.match(room, /useRoomPanelUnread\(\{ chatLoaded: chat\.loaded, kind: "live",/);
  // A aba escolhida entra inteira na vista quando as quatro nao cabem (docs/31 V2-A18): a lista rola pela regra pura
  // (tabScrollLeft, no modelo) ao trocar de aba, ao mudar a lista e ao abrir; o e2e da enquete confere a aba na vista.
  assert.match(roomPanel, /const next = tabScrollLeft\(\{[\s\S]*?\}\);\s*if \(next !== list\.scrollLeft\) \{\s*list\.scrollLeft = next;\s*\}\s*\}, \[open, tab, tabsKey\]\);/);
});

test("a gravada: Participantes com quem apresenta e o numero do cabecalho; as pilulas e o selo do Assistente saem com o card da Oferta (V2-4, V2-7 e V2-8)", () => {
  assert.match(recorded, /<LiveParticipantsTab stage=\{panelStageNames\(presenterName\)\} students=\{momentBadge\.showCount \? shownCount : null\} \/>/, "o mesmo numero do cabecalho, pela mesma condicao");
  assert.match(recorded, /presentNow=\{momentBadge\.showCount \? shownCount : null\}/, "o cabecalho");
  assert.match(room, /<LiveParticipantsTab stage=\{stage\} students=\{presentShown\} \/>/, "a live: o numero do cabecalho, que some com a live encerrada");
  assert.match(recorded, /onShownChange=\{setOfferShown\}/);
  // O card avisa a sala pela mesma regra que decide se ele aparece (offerOnScreen).
  assert.match(offer, /const onScreen = offerOnScreen\(\{ closedKey, enabled, hasView: view !== null, shown: state\.shown, windowKey: state\.windowKey \}\);/);
  assert.match(offer, /onShownChange\?\.\(onScreen\);/);
  assert.match(offer, /\{onScreen && view \? \(/, "o card na tela e o aviso a sala sao o mesmo valor");
  assert.match(recorded, /assistantOn=\{stageAssistantShown\(\{ assistantEnabled: assistant\.state\.enabled, bottomBadges, offerShown \}\)\}/);
  assert.match(recorded, /chatPillsShown\(\{ blocked: unavailable, design, offerShown, panelShown, settingsTakeover: false \}\) \? \(\s*<RoomChatPills kind=\{kind\} messages=\{overlayMessages\(translation\.messages\)\} \/>/, "no Replay acima da barra da Bunny e com o nome Chat da live");
});

test("a correcao final da fase 1: as duas salas ligadas as regras puras do Esc, da enquete depois da hidratacao, da confirmacao de Sair e do chat ao reabrir", () => {
  for (const [nome, fonte] of [
    ["live-room", room],
    ["webinar-room", recorded]
  ]) {
    // O Esc pela regra pura (roomEscapeStep): a enquete no palco recolhe antes do "Sair da sala?".
    assert.match(fonte, /const step = roomEscapeStep\(\{ confirmLeave, popoverOpen: [^,]+, stagePoll: stagePoll\?\.mode \?\? null \}\);/, nome);
    assert.match(fonte, /\} else if \(step === "poll_later" && stagePoll\) \{\s*setDeferred\(deferPoll\(deferred, stagePoll\.poll\.id\)\);/, nome);
    assert.match(fonte, /\} else if \(step === "poll_seen" && stagePoll\) \{\s*setDeferred\(markPollResultSeen\(deferred, stagePoll\.poll\.id\)\);/, nome);
    // A enquete e o card "deixou para depois" so depois da hidratacao, sem os resultados que ja vinham na pagina.
    assert.match(fonte, /const hydrated = useRoomHydrated\(\);\s*const \[arrivedResults\] = useState\(\(\) => resultsOnArrival\(payload\.polls\)\);/, nome);
    assert.match(fonte, /barShown && hydrated \? stagePollFor\(\{ deferredIds: deferred\.later, polls, seenResultIds: \[\.\.\.deferred\.seen, \.\.\.arrivedResults\] \}\) : null/, nome);
    // A confirmacao de Sair: o foco entra no Voltar e volta para quem a abriu.
    assert.match(fonte, /const rememberLeaveOpener = useRoomConfirmFocus\(rootRef, confirmLeave\);/, nome);
    assert.match(fonte, /rememberLeaveOpener\(\);\s*setConfirmLeave\(true\);/, nome);
    assert.match(fonte, /data-room-confirm="" role="alertdialog"/, nome);
    assert.match(fonte, /<RoomButton data-room-first-focus onClick=\{\(\) => setConfirmLeave\(false\)\}/, "o primeiro foco da confirmacao e o Voltar");
  }
  // O chat reaberto vai ao fim (chatListOnShow) nas duas salas; a gaveta do vertical monta de novo a cada abertura.
  assert.match(room, /shown=\{panelShown\}/);
  assert.match(recorded, /shown=\{vertical \|\| panelShown\}/);
  assert.match(chatPanel, /useLayoutEffect\(\(\) => \{\s*chatListOnShow\(listRef\.current, \{ shown, stick: stickRef\.current \}\);\s*\}, \[shown\]\);/);
});

test("a gravada: a capa Ativar som pela regra pura e a tela cheia da caixa do palco que sai com a barra (o giro para o vertical)", () => {
  assert.match(recorded, /muted=\{soundCoverShown\(\{ barShown, kind, muted, soundTouched \}\)\}/);
  assert.match(recorded, /if \(was && !barShown\) \{\s*leaveStageFullscreen\(document, stageBoxRef\.current\);\s*refocusRoom\(rootRef\.current, document\.activeElement\);/);
});

test("a live: o selo do apresentador, a coluna so dentro do iframe, o Microfone ligado e o pedido do microfone pelas regras puras", () => {
  assert.match(room, /presenterName=\{phase === "live" \? presenterBadgeFor\(\{ joined, presenterName, signals: room\.signals \}\) : null\}/);
  assert.match(room, /stageColumnShown\(room\.signals, joined\)/);
  assert.match(room, /const micShown = barShown && ourBar && \(room\.signals\.micAllowed \|\| room\.signals\.audioOn\);/, "o mesmo criterio de liveBarItems");
  // O onEvent: o iframe novo volta ao padrao do motor no primeiro sinal; o video grande pelo id lido do IFrame API; o
  // pedido do microfone pelo micAskOnSignal (o recolhimento antes do passo), nunca pelo micAskStep direto.
  const onEvent = hook.slice(hook.indexOf("const onEvent = useCallback("), hook.indexOf("const configOverwrite = useMemo("));
  assert.match(onEvent, /if \(frame !== null && frame !== signalFrameRef\.current\) \{\s*signalFrameRef\.current = frame;\s*filmstripSentRef\.current = null;\s*setSignals\(signalsForNewFrame\);/);
  assert.match(onEvent, /if \(name === "largeVideoChanged"\) \{\s*handleSignal\(name, \{ id: onStageParticipantOf\(frame\) \}\);\s*return;/);
  assert.match(onEvent, /const ask = micAskOnSignal\(micAskRef\.current, name, payload, ownIdRef\.current\);/);
  assert.doesNotMatch(onEvent, /micAskStep\(|micAskRecalled\(/, "o recolhimento e o passo numa funcao so");
});

test("as ligacoes da barra da live que o teste de tela nao alcanca: Reagir, Configurações e o menu da Visão do vídeo nunca abertos juntos; a largura do iframe e o tema vao para o hook", () => {
  // Movidas de tests/webinarios-sala-ao-vivo-tela.test.mjs (docs/18 §2.7: texto do codigo so em .guard).
  assert.match(room, /function toggleReactions\(\) \{\s*if \(!reactionsOpen\) \{\s*if \(settingsOpen\) \{\s*closeSettings\(\);\s*\}\s*closeViewMenu\(\);/, "Reagir fecha Configurações e o menu da Visão do vídeo");
  assert.match(room, /function toggleSettings\(\) \{\s*if \(settingsOpen\) \{\s*closeSettings\(true\);\s*return;\s*\}\s*if \(reactionsOpen\) \{\s*returnFocusFrom\(LIVE_REACTIONS_ID\);\s*setReactionsOpen\(false\);\s*\}\s*closeViewMenu\(\);\s*setSettingsOpen\(true\);/, "Configurações fecha Reagir e o menu da Visão do vídeo");
  assert.match(room, /if \(shortcut === "react"\) \{\s*toggleReactions\(\);/, "o atalho R tambem");
  assert.match(room, /\} else if \(step === "close_popovers"\) \{\s*returnFocusFrom\(LIVE_REACTIONS_ID\);\s*setReactionsOpen\(false\);\s*closeSettings\(\);\s*closeViewMenu\(\);/, "o Esc fecha os tres, com o foco de volta ao botao");
  assert.match(room, /useLiveRoom\(\{\s*allowed,\s*canSwitchDevice,\s*container: frameRef,\s*deviceNames: DEVICE_NAMES,\s*frameTitle: WEBINAR_COPY\.aoVivo\.palco,\s*frameWidth: geometry\.frameWidth,\s*lobby: live\.lobby === true,\s*look,\s*nonce,/);
});
