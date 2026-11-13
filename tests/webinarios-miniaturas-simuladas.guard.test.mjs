import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Guarda de arquitetura (docs/18 §1.2: conferencia de texto so vale como guarda, em arquivo .guard) dos participantes
// simulados nas miniaturas (docs/30 D117): onde a pagina descarta os sinais de um simulado, quem manda a lista ao
// iframe e quem so repassa. O comportamento de cada parte tem teste: a lista e a mensagem em
// webinarios-miniaturas-simuladas.test.mjs, a rota em webinarios-miniaturas-simuladas-rotas.test.mjs e o arquivo da
// instancia em infra-jitsi-plateia.test.mjs.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("o sinal de um simulado para no useJitsiMeet, antes de qualquer conta da pagina, na sala e no console", () => {
  const hook = read("src/components/webinars/use-jitsi-meet.ts");
  const listener = /instance\.addListener\(signal, \(payload\) => \{([\s\S]*?)latest\.current\.onEvent\?\.\(name, payload\);/.exec(hook);
  assert.ok(listener, "o ponto unico por onde todo sinal do iframe passa");
  assert.match(listener[1], /if \(disposed \|\| aboutSimulatedParticipant\(payload\)\) \{\s*return;\s*\}/, "o descarte e a primeira coisa: nem o estado do hook muda");
  assert.match(hook, /target\.postMessage\(message, meetOrigin\(domain\)\);/, "a lista so vai para a origem do nosso motor, nunca para qualquer janela");
  assert.doesNotMatch(hook, /postMessage\([^)]*["']\*["']/);
});

test("a sala do aluno desenha (sem repasse) e o console so repassa ao gravador; os dois pela mesma lista e pelo numero de simulados de agora", () => {
  const room = read("src/components/member/webinars/room/live-room.tsx");
  assert.match(room, /useRoomAudience\(\{ enabled: !readOnly && !blocked && phase !== "ended", sessionId, simulationKey: naTela\.simulationKey, webinarId \}\)/, "nunca no ver como nem com a live encerrada");
  assert.match(room, /const simulatedNow = simulation\.displayCount\(0, simulationOffsetMs\);/, "o mesmo numero que soma no selo dos presentes");
  assert.match(room, /useAudienceTiles\(\{ joined: room\.jitsiStatus === "joined", people: audienceNow, post: room\.postToFrame \}\);/);
  assert.doesNotMatch(room, /relay/, "a sala do aluno nunca repassa");

  const panel = read("src/components/admin/v2/communication/webinars/session-console/live-room-panel.tsx");
  assert.match(panel, /useAudienceTiles\(\{ joined, people: input\.audience \?\? NO_AUDIENCE, post: meet\.postToFrame, relay: true \}\);/, "o console nunca desenha os simulados no proprio video");
  const consolePage = read("src/components/admin/v2/communication/webinars/session-console/session-console.tsx");
  assert.match(consolePage, /audienceTilesNow\(audienceRoster, simulatedNow\)/);
  assert.match(consolePage, /const simulatedNow = snapshot\?\.simulatedNow \?\? 0;/, "o numero do retrato de 5 s do console");
});

test("a lista dos simulados nunca entra numa metrica real: a rota e o que ela le so leem, e nada cita o historico do aluno", () => {
  for (const path of ["src/app/api/webinars/[id]/audience/route.ts", "src/server/webinars/audience-tiles-store.ts", "src/server/webinars/audience-tiles-model.ts", "src/components/member/webinars/room/use-room-audience.ts"]) {
    const source = read(path).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // O .delete( que sobra e o da memoria do processo (um Map), nunca o de uma tabela: nenhum db.from(...) escreve.
    assert.doesNotMatch(source, /student_events|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|\.from\([^)]*\)[\s\S]{0,40}\.delete\(|recordEvent|sendBeacon/, path);
  }
  assert.match(read("src/server/webinars/audience-tiles-store.ts"), /^import "server-only";/, "a leitura do banco nunca vai para o navegador");
});
