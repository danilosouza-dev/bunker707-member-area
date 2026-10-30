import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// navigator.sendBeacon com Blob perde o corpo no WebKit: a fila guarda so o endereco do Blob e le os bytes na hora
// de enviar; se o Blob ja foi coletado, o POST sai com Content-Length 0 e a rota responde 400 (JSON invalido). Foi o
// clique do pop-up que nao contava no e2e do WebKit (tests/e2e/produtor-desenha-pop-up.spec.ts). Com texto os bytes
// sao copiados na chamada e o Content-Type e o mesmo (text/plain;charset=UTF-8). Esta guarda pega a volta do Blob.

function arquivos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return arquivos(caminho);
    }
    return /\.(ts|tsx)$/.test(entrada.name) ? [caminho] : [];
  });
}

test("nenhum navigator.sendBeacon em src/ manda Blob: o corpo vai como texto", () => {
  const chamadas = [];
  for (const arquivo of arquivos("src")) {
    const codigo = readFileSync(arquivo, "utf8");
    for (const match of codigo.matchAll(/navigator\.sendBeacon\(([^;]*?)\)\s*[)&|;]/g)) {
      chamadas.push({ arquivo, argumentos: match[1] });
    }
  }
  assert.ok(chamadas.length >= 4, `achou as chamadas (pop-up/sino/visitas, sala x2, aula): ${chamadas.length}`);
  for (const { arquivo, argumentos } of chamadas) {
    assert.doesNotMatch(argumentos, /new Blob\(/, `${arquivo}: sendBeacon(${argumentos})`);
  }
});

test("sendBeaconPost manda o texto como veio, e sem corpo continua sem corpo", async () => {
  const enviados = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      sendBeacon(url, data) {
        enviados.push({ data, url });
        return true;
      }
    }
  });
  globalThis.fetch = async () => {
    throw new Error("o beacon aceitou: nao cai no fetch");
  };
  const { sendBeaconPost } = await import("../src/components/member/notifications/notifications-client.ts");
  sendBeaconPost("/api/popups/p1/events", JSON.stringify({ event: "clicked" }));
  sendBeaconPost("/api/notifications/n1/click");
  assert.deepEqual(enviados, [
    { data: '{"event":"clicked"}', url: "/api/popups/p1/events" },
    { data: undefined, url: "/api/notifications/n1/click" }
  ]);
});
