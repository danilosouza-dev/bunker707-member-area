import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda da sala ao vivo V2 (docs/31 V2-6 a V2-8; docs/18 §2.7, por isso .guard): a sala ligada as regras puras do
// painel e do palco, que um teste de tela nao alcanca (o servidor pinta o computador e nada aberto: sem o celular com
// Configurações aberto, sem o painel fechado e sem o card da Oferta). O comportamento de cada regra fica em
// tests/webinarios-sala-v2-modelo.test.mjs (roomPanelShown, panelToggleStep, liveSkeletonState, panelTabsFor,
// chatPillsShown e firstFocusTarget); o e2e da sala ao vivo abre Configurações no celular em pe e deitado e fecha o
// painel pelo X. Aqui so se confere que live-room.tsx e webinar-room.tsx usam as regras, e nao uma copia delas.

const root = fileURLToPath(new URL("../", import.meta.url));
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const room = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/live-room.tsx"), "utf8"));
const recorded = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/webinar-room.tsx"), "utf8"));

test("o painel do chat e o palco da live saem das regras puras: o takeover do celular so abaixo de lg, o painel por roomPanelShown e o esqueleto por liveSkeletonState", () => {
  assert.match(room, /const settingsTakeover = settingsShown && !desktop;/, "Configurações toma o lugar do chat so no celular");
  assert.match(room, /const panelShown = roomPanelShown\(\{ barShown, panelOpen, settingsTakeover \}\);/);
  assert.match(room, /const skeletonState = liveSkeletonState\(\{ blocked, cinema: cinemaOn, panelShown, settingsTakeover \}\);\s*const skeleton = roomSkeleton\("normal", skeletonState\);/, "o minimo de 96 px na caixa do palco");
  assert.doesNotMatch(room, /min-h-24/, "o minimo do palco fica so no esqueleto (a caixa), nunca no palco dentro dela");
  // As pilulas do chat (V2-8) pela regra pura: fora do palco pequeno (Configurações no celular) e da frase de removido.
  assert.match(room, /chatPillsShown\(\{ blocked, design: "normal", offerShown: false, panelShown, settingsTakeover \}\) \? <RoomChatPills messages=\{overlayMessages\(translation\.messages\)\} \/>/);
  assert.doesNotMatch(room, /LiveChatOverlay/, "o chat por cima do palco so no celular saiu");
});

test("o balao com Configurações aberto no celular: fecha Configurações e mostra o chat; a aba nunca abre nem fecha o painel (V2-7)", () => {
  assert.match(room, /function togglePanel\(\) \{\s*const step = panelToggleStep\(\{ panelShown, settingsTakeover \}\);\s*if \(step\.closeSettings\) \{\s*closeSettings\(\);\s*\}\s*setPanelOpen\(step\.panelOpen\);\s*\}/);
  assert.doesNotMatch(room, /setPanelOpen\(!panelOpen\)/, "a aba de baixo que abria e fechava saiu: o balao manda");
  assert.match(room, /onTab=\{setTab\}/);
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
    assert.match(fonte, /const unread = useRoomPanelUnread\(\{ messages: translation\.messages, offsetMs: [^,]+, panelShown \}\);/, nome);
  }
});

test("a gravada: Participantes com quem apresenta e o numero do cabecalho; as pilulas e o selo do Assistente saem com o card da Oferta (V2-4, V2-7 e V2-8)", () => {
  assert.match(recorded, /<LiveParticipantsTab stage=\{panelStageNames\(presenterName\)\} students=\{shownCount\} \/>/, "o mesmo numero do cabecalho (shownCount)");
  assert.match(recorded, /onShownChange=\{setOfferShown\}/);
  assert.match(recorded, /assistantOn=\{bottomBadges && assistant\.state\.enabled && !offerShown\}/);
  assert.match(recorded, /chatPillsShown\(\{ blocked: unavailable, design, offerShown, panelShown, settingsTakeover: false \}\) \? \(\s*<RoomChatPills messages=\{overlayMessages\(translation\.messages\)\} raised=\{kind === "replay"\} \/>/, "no Replay acima da barra da Bunny");
});
