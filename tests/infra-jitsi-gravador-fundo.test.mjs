import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

// O fundo desfocado do palco no gravador (docs/30 D139; docs/18 §2.2). Quando o video do palco nao enche o espaco (a tela
// compartilhada, por causa da coluna de miniaturas), o motor desenha atras dele uma camada desfocada do tamanho da pagina.
// No Chrome do gravador, sem placa de video, isso derrubava a pagina para 15 ou 16 desenhos por segundo, e a gravacao da
// tela compartilhada saia com 10 a 13 imagens por segundo (a live de teste de 25/11/2026). Na bancada, o mesmo palco: 19,6
// com o fundo e 30,0 sem ele. O custom-interface_config.js desliga o fundo pela chave do proprio motor, e so no gravador.
// Aqui o arquivo roda como o navegador o roda, com o endereco de cada caso. A prova no arquivo gravado e a bancada
// (gravador-bancada.yml, os modos sala e sala-sem-fundo).

const root = new URL("../", import.meta.url).pathname;
const source = readFileSync(join(root, "infra/jitsi/web/custom-interface_config.js"), "utf8");

/** O interface_config.js do motor ja carregado (a chave do fundo vem desligada dele) e o nosso arquivo no fim. */
function load(hash) {
  const interfaceConfig = { APP_NAME: "Jitsi Meet", DISABLE_VIDEO_BACKGROUND: false };
  const context = { interfaceConfig };
  if (hash !== undefined) context.location = { hash };
  vm.runInNewContext(source, context);
  return interfaceConfig;
}

test("no gravador (config.iAmRecorder=true no endereco, como o Jibri manda), o fundo desfocado do palco fica desligado", () => {
  // O endereco que o Jibri abre: a sala e as chaves dele no hash, com e sem as aspas codificadas.
  for (const hash of [
    '#config.iAmRecorder=true&config.externalConnectUrl=null&config.startWithAudioMuted=true&config.startWithVideoMuted=true&interfaceConfig.APP_NAME="Jibri"',
    "#config.iAmRecorder=%22true%22&config.prejoinConfig.enabled=false",
    "#interfaceConfig.APP_NAME=%22Jibri%22&config.iAmRecorder=true",
  ]) {
    assert.equal(load(hash).DISABLE_VIDEO_BACKGROUND, true, hash);
  }
});

test("para aluno, para quem apresenta e para quem abre a sala pelo endereco, o fundo continua como o motor entrega", () => {
  for (const hash of ['#config.bunkerTheme="dark"&config.disableChat=true', "", "#config.iAmRecorder=false", "#config.iAmRecorderX=true", '#jwt=abc&config.subject="iAmRecorder=true"']) {
    assert.equal(load(hash).DISABLE_VIDEO_BACKGROUND, false, JSON.stringify(hash));
  }
  // Sem endereco nenhum (o arquivo avaliado fora de uma pagina), nada muda e nada quebra.
  assert.equal(load(undefined).DISABLE_VIDEO_BACKGROUND, false);
});

test("o resto do arquivo vale igual nos dois casos: a marca continua fora da tela", () => {
  for (const hash of ["#config.iAmRecorder=true", '#config.bunkerTheme="light"']) {
    const config = load(hash);
    assert.equal(config.APP_NAME, "Bunker707");
    assert.equal(config.SHOW_JITSI_WATERMARK, false);
  }
});

test("um endereco que nao se deixa ler nunca derruba a pagina do motor", () => {
  const interfaceConfig = { DISABLE_VIDEO_BACKGROUND: false };
  const location = {};
  Object.defineProperty(location, "hash", { get() { throw new Error("sem acesso"); } });
  assert.doesNotThrow(() => vm.runInNewContext(source, { interfaceConfig, location }));
  assert.equal(interfaceConfig.DISABLE_VIDEO_BACKGROUND, false);
  assert.equal(interfaceConfig.APP_NAME, "Bunker707");
});
