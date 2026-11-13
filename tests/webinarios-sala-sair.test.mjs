import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O Sair da sala do aluno (docs/30 D119; docs/18 §2.2). A pagina tirava o iframe do motor de video no mesmo passo em
// que pedia a saida: quando o motor nao chegava a avisar o servidor da sala, a conexao ficava guardada por 1 min, a
// miniatura de quem saiu continuava na tela de todos e, voltando nesse meio tempo, a pessoa aparecia duas vezes (teste
// do produtor de 13/11/2026). Agora a pagina espera o aviso de saida do motor (ou o prazo) antes de tirar o iframe e
// de trocar de pagina. Aqui, a regra pura com um relogio falso e a ligacao dela no hook e na sala.

const { CONSOLE_LEAVE_WAIT_MS } = await import("../src/components/admin/v2/communication/webinars/session-console/console-leave-model.ts");
const { createRoomLeave, ROOM_LEAVE_WAIT_MS } = await import("../src/components/member/webinars/room/live-room-model.ts");

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** Um relogio falso: guarda o que foi marcado e roda o que venceu quando o tempo anda. */
function relogio() {
  let agora = 0;
  const marcados = [];
  return {
    anda(ms) {
      agora += ms;
      for (const item of marcados.filter((entry) => !entry.rodou && entry.em <= agora)) {
        item.rodou = true;
        item.callback();
      }
    },
    later: (callback, ms) => marcados.push({ callback, em: agora + ms, rodou: false }),
    marcados
  };
}

test("o prazo da espera e o mesmo do console: 1,5 s", () => {
  assert.equal(ROOM_LEAVE_WAIT_MS, 1_500);
  assert.equal(ROOM_LEAVE_WAIT_MS, CONSOLE_LEAVE_WAIT_MS);
});

test("dentro da sala de video, o iframe so sai quando o motor avisa a saida", () => {
  const tempo = relogio();
  const saida = createRoomLeave(tempo.later);
  let fechou = 0;
  saida.start({ finish: () => (fechou += 1), wait: true });
  assert.equal(fechou, 0, "pedir a saida nao tira o iframe");
  assert.equal(saida.pending(), true);
  tempo.anda(96);
  assert.equal(fechou, 0, "sem o aviso, o iframe continua");
  saida.gone();
  assert.equal(fechou, 1, "o aviso do motor (videoConferenceLeft ou readyToClose) solta o iframe");
  assert.equal(saida.pending(), false);
  saida.gone();
  tempo.anda(5_000);
  assert.equal(fechou, 1, "um segundo aviso (o readyToClose depois do videoConferenceLeft) e o prazo nao fecham de novo");
});

test("o motor nao avisou: no prazo o iframe sai de todo jeito, uma vez so", () => {
  const tempo = relogio();
  const saida = createRoomLeave(tempo.later);
  let fechou = 0;
  saida.start({ finish: () => (fechou += 1), wait: true });
  tempo.anda(ROOM_LEAVE_WAIT_MS - 1);
  assert.equal(fechou, 0);
  tempo.anda(1);
  assert.equal(fechou, 1, "ninguem fica preso na sala por causa do motor");
  saida.gone();
  assert.equal(fechou, 1, "o aviso atrasado nao fecha de novo");
});

test("sem o que esperar (o iframe nao estava na sala de video, ou nao aceitou o pedido), a saida e na hora", () => {
  const tempo = relogio();
  const saida = createRoomLeave(tempo.later);
  let fechou = 0;
  saida.start({ finish: () => (fechou += 1), wait: false });
  assert.equal(fechou, 1);
  assert.equal(saida.pending(), false);
  assert.equal(tempo.marcados.length, 0, "nenhum relogio marcado");
});

test("um segundo Sair com a saida a caminho nao comeca outra: so a continuacao troca", () => {
  const tempo = relogio();
  const saida = createRoomLeave(tempo.later);
  const rodou = [];
  saida.start({ finish: () => rodou.push("perdeu o acesso"), wait: true });
  saida.start({ finish: () => rodou.push("Sair"), wait: true });
  assert.equal(tempo.marcados.length, 1, "um prazo so");
  saida.gone();
  assert.deepEqual(rodou, ["Sair"], "a continuacao do ultimo pedido, uma vez");
  // Mesmo que o segundo pedido diga que nao ha o que esperar, a saida a caminho continua esperando o motor.
  const outra = createRoomLeave(tempo.later);
  const fim = [];
  outra.start({ finish: () => fim.push("a"), wait: true });
  outra.start({ finish: () => fim.push("b"), wait: false });
  assert.deepEqual(fim, [], "o iframe nao sai antes do aviso");
  outra.gone();
  assert.deepEqual(fim, ["b"]);
});

test("uma entrada nova no meio da espera: a saida antiga nao fecha a sala nova", () => {
  const tempo = relogio();
  const saida = createRoomLeave(tempo.later);
  let fechou = 0;
  saida.start({ finish: () => (fechou += 1), wait: true });
  saida.cancel();
  assert.equal(saida.pending(), false);
  saida.gone();
  tempo.anda(ROOM_LEAVE_WAIT_MS);
  assert.equal(fechou, 0, "nem o aviso nem o prazo da saida antiga valem mais");
  // E a proxima saida funciona como a primeira.
  saida.start({ finish: () => (fechou += 1), wait: true });
  saida.gone();
  assert.equal(fechou, 1);
});

test("a ligacao no hook e na sala: o Sair pede a saida, espera o motor e so entao troca de pagina", () => {
  const hook = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  const hangUp = hook.slice(hook.indexOf("const hangUp = useCallback("), hook.indexOf("const toggleHand = useCallback("));
  assert.match(hangUp, /const finish = \(\) => \{\s*setEntry\("idle"\);\s*onGone\?\.\(\);\s*\};/, "tirar o iframe e a continuacao (trocar de pagina) andam juntos");
  assert.equal(hangUp.match(/setEntry\("idle"\)/g).length, 1, "o iframe nunca sai fora da espera");
  assert.match(hangUp, /const inConference = frame !== null && joinedApiRef\.current === frame;/, "so espera com este iframe dentro da sala de video");
  assert.match(hangUp, /const asked = commandRef\.current\("hangup"\);\s*beaconQueue\(\);\s*leaveWait\.start\(\{ finish, wait: asked && inConference \}\);/);
  assert.ok(hangUp.indexOf("leaveWait.pending()") < hangUp.indexOf('commandRef.current("hangup")'), "com a saida a caminho, nada e pedido de novo");
  const onEvent = hook.slice(hook.indexOf("const onEvent = useCallback("), hook.indexOf("const configOverwrite = useMemo("));
  assert.match(onEvent, /if \(leavingRef\.current\) \{\s*if \(name === "videoConferenceLeft" \|\| name === "readyToClose"\) \{\s*leaveWaitRef\.current\?\.gone\(\);\s*\}\s*return;\s*\}/, "saindo, so o aviso de saida do motor vale");
  assert.match(hook, /const enter = useCallback\(\(\) => \{\s*leavingRef\.current = false;\s*leaveWaitRef\.current\?\.cancel\(\);/, "entrar de novo desfaz a espera");
  const sala = semComentarios(ler("src/components/member/webinars/room/live-room.tsx"));
  assert.match(sala, /function leave\(\) \{\s*room\.hangUp\(\(\) => router\.push\(webinarHref\)\);\s*\}/, "a pagina so troca depois da saida");
  assert.doesNotMatch(sala, /room\.hangUp\(\);\s*router\.push/, "nunca mais os dois no mesmo passo");
});
