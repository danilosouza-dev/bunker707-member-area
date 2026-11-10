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
const questionsTab = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/room-questions.tsx"), "utf8"));
const replyField = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/room-reply-field.tsx"), "utf8"));

test("o painel do chat e o palco da live saem das regras puras: o takeover do celular so abaixo de lg, o painel por roomPanelShown e o esqueleto por liveSkeletonState", () => {
  assert.match(room, /const settingsTakeover = settingsShown && !desktop;/, "Configurações toma o lugar do chat so no celular");
  assert.match(room, /const panelShown = roomPanelShown\(\{ barShown, panelOpen, settingsTakeover \}\);/);
  assert.match(room, /const skeletonState = liveSkeletonState\(\{ blocked, cinema: cinemaOn, panelShown, settingsTakeover \}\);\s*const skeleton = roomSkeleton\("normal", skeletonState\);/, "o minimo de 96 px na caixa do palco");
  assert.doesNotMatch(room, /min-h-24/, "o minimo do palco fica so no esqueleto (a caixa), nunca no palco dentro dela");
  // As pilulas do chat (V2-8) pela regra pura: fora do palco pequeno (Configurações no celular) e da frase de removido.
  // As pilulas do chat pela regra pura; com um item da Na tela embaixo, so no palco estreito (RoomWideHidden, so CSS).
  assert.match(room, /chatPillsShown\(\{ blocked, design: "normal", offerShown: false, panelShown, settingsTakeover \}\) \? \(\s*<RoomWideHidden hidden=\{!placement\.chatPills\}>\s*<RoomChatPills kind="live" messages=\{overlayMessages\(translation\.messages\)\} \/>/);
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

test("a gravada: Participantes com quem apresenta e o numero do selo do palco (docs/31 §11.5); as pilulas e o selo do Assistente saem com o card da Oferta (V2-4, V2-7 e V2-8)", () => {
  assert.match(recorded, /<LiveParticipantsTab presenterKnown=\{[^}]+\} stage=\{panelStageNames\(presenterName\)\} students=\{momentBadge\.showCount \? shownCount : null\} \/>/, "o mesmo numero do selo do palco, pela mesma condicao");
  // O numero de quem assiste: no palco, ao lado do selo do momento (roomPresentBadge), e fora do cabecalho nas duas salas.
  assert.match(recorded, /const presentBadge = roomPresentBadge\(momentBadge\.showCount \? shownCount : null\);/, "a gravada: o selo do palco");
  assert.match(recorded, /<RoomStageBadges[\s\S]*?present=\{presentBadge\}/);
  assert.match(room, /<LiveParticipantsTab presenterKnown=\{[^}]+\} stage=\{stage\} students=\{presentShown\} \/>/, "a live: o numero do selo do palco, que some com a live encerrada");
  // Com a Simulacao na live (adendo de 10/11/2026, R7): o real mais a parte simulada, como na gravada.
  assert.match(room, /const presentShown = phase === "ended" \? null : simulation\.displayCount\(presentNow, simulationOffsetMs\);\s*const presentBadge = roomPresentBadge\(presentShown\);/);
  assert.match(room, /<RoomStageBadges[\s\S]*?present=\{presentBadge\}/);
  for (const [nome, fonte] of [
    ["live-room", room],
    ["webinar-room", recorded]
  ]) {
    assert.doesNotMatch(fonte.match(/<RoomHeader[\s\S]*?\/>/)?.[0] ?? "presentNow", /presentNow/, `${nome}: o cabecalho nao recebe mais o numero`);
  }
  // O chat no estilo do YouTube (o comentario): a gravada passa o balao de antes so para a gaveta do vertical, e as duas
  // salas contam o tempo do comentario do agora do servidor (skewMs).
  assert.match(recorded, /error=\{chat\.error\}\s+look=\{vertical \? "classic" : "comment"\}\s+messages=\{translation\.messages\}/, "a gravada: o comentario no desenho normal, o balao na gaveta do vertical");
  assert.match(recorded, /<RoomChatPanel[\s\S]*?skewMs=\{clock\.skewMs\}/);
  assert.match(room, /<RoomChatPanel[\s\S]*?skewMs=\{skewMs\}/);
  assert.match(recorded, /onShownChange=\{setOfferShown\}/);
  // O card avisa a sala pela mesma regra que decide se ele aparece (offerOnScreen).
  assert.match(offer, /const onScreen = offerOnScreen\(\{ closedKey, enabled, hasView: view !== null, shown: state\.shown, windowKey: state\.windowKey \}\);/);
  assert.match(offer, /onShownChange\?\.\(onScreen\);/);
  assert.match(offer, /\{onScreen && view \? \(/, "o card na tela e o aviso a sala sao o mesmo valor");
  assert.match(recorded, /assistantOn=\{stageAssistantShown\(\{ assistantEnabled: assistant\.state\.enabled, bottomBadges, offerShown \}\)\}\s*assistantWideHidden=\{!placement\.assistant\}/);
  assert.match(
    recorded,
    /chatPillsShown\(\{ blocked: unavailable, design, offerShown, panelShown, settingsTakeover: false \}\) \? \(\s*<RoomWideHidden hidden=\{!placement\.chatPills\}>\s*<RoomChatPills kind=\{kind\} messages=\{overlayMessages\(translation\.messages\)\} \/>/,
    "no Replay acima da barra da Bunny e com o nome Chat da live"
  );
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
    // A janela no centro (RoomLeaveDialog): o Voltar fecha, o Sair sai, e o Tab fica preso nela enquanto esta aberta.
    assert.match(fonte, /\{confirmLeave \? <RoomLeaveDialog onCancel=\{\(\) => setConfirmLeave\(false\)\} onLeave=\{leave\} \/> : null\}/, nome);
    assert.match(fonte, /trapRoomFocus\(event, confirmLeave \? \(rootRef\.current\?\.querySelector<HTMLElement>\("\[data-room-confirm\]"\) \?\? rootRef\.current\) : rootRef\.current\);/, nome);
  }
  // O chat reaberto vai ao fim (chatListOnShow) nas duas salas; a gaveta do vertical monta de novo a cada abertura.
  assert.match(room, /shown=\{panelShown\}/);
  assert.match(recorded, /shown=\{vertical \|\| panelShown\}/);
  assert.match(chatPanel, /useLayoutEffect\(\(\) => \{\s*chatListOnShow\(listRef\.current, \{ shown, stick: stickRef\.current \}\);\s*\}, \[shown\]\);/);
});

test("a gravada: a capa Ativar som pela regra pura e a tela cheia da caixa do palco que sai com a barra (o giro para o vertical)", () => {
  assert.match(recorded, /const soundCover = soundCoverShown\(\{ barShown, kind, muted, soundTouched \}\);/);
  assert.match(recorded, /muted=\{soundCover\}/, "a capa Ativar som e a mesma conta que manda a Na tela para a faixa");
  assert.match(recorded, /if \(was && !barShown\) \{\s*leaveStageFullscreen\(document, stageBoxRef\.current\);\s*refocusRoom\(rootRef\.current, document\.activeElement\);/);
});

test("a live: o selo do apresentador, a coluna so dentro do iframe, o Microfone ligado e o pedido do microfone pelas regras puras", () => {
  assert.match(room, /presenterName=\{phase === "live" \? presenterBadgeFor\(\{ joined, presenterName, signals: room\.signals \}\) : null\}/);
  assert.match(room, /stageColumnShown\(room\.signals, joined\)/);
  // Com o microfone sozinho (docs/31 caminho A), o Microfone fica tambem sem o Liberar.
  assert.match(room, /const micShown = barShown && ourBar && \(room\.signals\.micAllowed \|\| room\.signals\.audioOn \|\| live\.selfUnmute === true\);/, "o mesmo criterio de liveBarItems");
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

test("o campo de responder do fio ligado as regras puras (docs/30 §1.3): fecha no render quando a pergunta deixa de aceitar resposta (questionReplyGone), o Responder de novo nao apaga (questionReplyOpenStep), o Esc em todo o campo (replyFieldKey) e o foco de volta ao Responder (returnFocusFromReply)", () => {
  assert.match(questionsTab, /if \(replyOpenId !== null && !replySending && \(!replyWritable \|\| questionReplyGone\(questions, replyOpenId\)\)\) \{\s*closeReply\(\);/);
  assert.match(questionsTab, /canWrite: replyWritable,/);
  assert.doesNotMatch(questionsTab, /useEffect\(\(\) => \{[^}]*closeReply\(\)/, "nunca num efeito: o lint recusa");
  assert.match(questionsTab, /const next = questionReplyOpenStep\(\{ draft: replyDraft, openId: replyOpenId, status: replyStatus \}, questionId\);/);
  assert.match(replyField, /<form className="flex items-start" data-room-reply-field="" onKeyDown=\{onKeyDown\} onSubmit=\{submit\}>/);
  assert.doesNotMatch(replyField, /<textarea[^>]*onKeyDown/);
  assert.match(replyField, /replyFieldKey\(\{ ctrl: event\.ctrlKey, inText: event\.target === areaRef\.current, key: event\.key, meta: event\.metaKey \}\)/);
  assert.match(questionsTab, /if \(was && !replyOpenId\) \{\s*returnFocusFromReply\(tabRef\.current, document\.activeElement, document\.body, `\[data-room-question="\$\{was\}"\] \[data-room-reply-open\]`\);/);
});

test("a Na tela nas duas salas pelas regras puras (especificacao de 10/11/2026, §3.2 a §3.4): o lugar por screenPlacement, a capa que manda para a faixa, a Oferta da gravada, as metricas so fora do ver como, e nenhuma peca do pop-up da Comunicacao", () => {
  assert.match(room, /const screenForced = screenStripForcedLive\(\{ entry: room\.entry, screen \}\);/);
  assert.match(room, /const placement = screenPlacement\(\{ items: screenForced \? \[\] : screenItems, offerShown: false, pinnedPills: !screenForced && pinnedPillsOn \}\);/);
  assert.match(room, /useRoomScreenEvents\(\{ enabled: !readOnly && pinnedOn, pollOver: stagePoll !== null, sessionId, webinarId \}\)/);
  assert.match(room, /<RoomScreenLayer\s+engineBar=\{joined && !ourBar\}\s+forced=\{screenForced\}\s+fullscreen=\{fullscreenOn\}/, "a barra do motor na pagina da sala: a margem de baixo de 96 px");
  assert.match(recorded, /const screenForced = screenStripForcedRecorded\(\{ hasVideo: session\.video !== null, soundCover, stageState \}\);/);
  assert.match(recorded, /const placement = screenPlacement\(\{ items: screenForced \|\| vertical \? \[\] : screenItems, offerShown, pinnedPills: !screenForced && pinnedPillsOn \}\);/, "a Oferta no palco empurra o item de baixo a direita");
  assert.match(recorded, /useRoomScreenEvents\(\{ enabled: !readOnly && pinnedOn, pollOver: stagePoll !== null, sessionId, webinarId \}\)/);
  assert.match(recorded, /topLeftExtra=\{<RoomSimulationSales layout="cell"/, "o aviso de venda na celula de cima a esquerda da camada");
  assert.match(recorded, /screen=\{vertical && pinnedOn \? <RoomScreenDock handlers=\{screenHandlers\} items=\{screenItems\} \/> : null\}/, "a doca do vertical");
  for (const [nome, fonte] of [
    ["live-room", room],
    ["webinar-room", recorded]
  ]) {
    // O foco que estava num item que saiu volta para a sala.
    assert.match(fonte, /if \(was !== screenKey\) \{\s*refocusRoom\(rootRef\.current, document\.activeElement\);/, nome);
    assert.match(fonte, /closeScreenItem\(displayId\);\s*sendScreenEvent\(\{ displayId, form, name: "closed" \}\);/, `${nome}: fechar e por exibicao e manda o fechou`);
  }
  // A sala continua sem nada do pop-up da Comunicacao (docs/25: a sala esta na lista de "onde nunca").
  const pasta = path.join(root, "src/components/member/webinars/room/screen");
  for (const arquivo of ["room-screen-model.ts", "room-screen-layer.tsx", "room-screen-card.tsx", "room-screen-strip.tsx", "room-wide-hidden.tsx", "use-room-screen.ts", "room-pinned.tsx"]) {
    const fonte = readFileSync(path.join(pasta, arquivo), "utf8");
    assert.doesNotMatch(fonte, /from "[^"]*(?:communications\/popup|popup-free|member-popup|MemberPopup|popup-design)[^"]*"/i, arquivo);
  }
  for (const fonte of [room, recorded]) {
    assert.doesNotMatch(fonte, /from "[^"]*(?:communications\/popup|popup-free|member-popup|popup-design)[^"]*"/i);
  }
});
