import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda da sala ao vivo V2 (docs/31 V2-6 a V2-8; docs/18 §2.7, por isso .guard): a sala ligada as regras puras do
// painel e do palco, que um teste de tela nao alcanca (o servidor pinta o computador e nada aberto: sem o celular com
// Configurações aberto). O comportamento de cada regra fica em tests/webinarios-sala-v2-modelo.test.mjs
// (roomPanelShown, panelToggleStep e liveSkeletonState); o e2e da sala ao vivo abre Configurações no celular em pe e
// deitado. Aqui so se confere que live-room.tsx usa as regras, e nao uma copia delas.

const root = fileURLToPath(new URL("../", import.meta.url));
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const room = semComentarios(readFileSync(path.join(root, "src/components/member/webinars/room/live-room.tsx"), "utf8"));

test("o painel do chat e o palco da live saem das regras puras: o takeover do celular so abaixo de lg, o painel por roomPanelShown e o esqueleto por liveSkeletonState", () => {
  assert.match(room, /const settingsTakeover = settingsShown && !desktop;/, "Configurações toma o lugar do chat so no celular");
  assert.match(room, /const panelShown = roomPanelShown\(\{ barShown, panelOpen, settingsTakeover \}\);/);
  assert.match(room, /const skeletonState = liveSkeletonState\(\{ blocked, cinema: cinemaOn, panelShown, settingsTakeover \}\);\s*const skeleton = roomSkeleton\("normal", skeletonState\);/, "o minimo de 96 px na caixa do palco");
  assert.doesNotMatch(room, /min-h-24/, "o minimo do palco fica so no esqueleto (a caixa), nunca no palco dentro dela");
  assert.match(room, /!panelShown && !blocked && !settingsTakeover \? <LiveChatOverlay/, "sem o chat sobreposto no palco pequeno");
});

test("o balao e a aba de baixo com Configurações aberto no celular: fecham Configurações e mostram o chat", () => {
  assert.match(room, /function togglePanel\(\) \{\s*const step = panelToggleStep\(\{ panelShown, settingsTakeover \}\);\s*if \(step\.closeSettings\) \{\s*closeSettings\(\);\s*\}\s*setPanelOpen\(step\.panelOpen\);\s*\}/);
  assert.match(room, /function selectTab\(value: Tab\) \{\s*if \(settingsTakeover\) \{\s*closeSettings\(\);\s*setTab\(value\);\s*setPanelOpen\(true\);/);
});
