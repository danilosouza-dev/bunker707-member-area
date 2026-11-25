// A linha que guarda a gravacao no computador (docs/30 D142): escreve cada pedaco na pasta privada do navegador (OPFS,
// desta origem) assim que chega. So um arquivo por vez; fechar a aba perde so o pedaco que ainda nao chegou. Nada daqui
// fala com a rede. Arquivo publico (e nao do pacote): a escrita sincrona da pasta so existe dentro de um Worker.
"use strict";

let handle = null;
let offset = 0;

self.onmessage = async (event) => {
  const data = event.data || {};

  try {
    if (data.papel === "abrir") {
      const dir = await navigator.storage.getDirectory();
      const file = await dir.getFileHandle(data.nome, { create: true });
      handle = await file.createSyncAccessHandle();
      handle.truncate(0);
      offset = 0;
      self.postMessage({ tipo: "aberto" });
    } else if (data.papel === "pedaco") {
      if (!handle) {
        throw new Error("sem arquivo aberto");
      }
      const bytes = new Uint8Array(data.bytes);
      // O disco cheio pode escrever so uma parte: conta como erro, nunca como pedaco guardado.
      if (handle.write(bytes, { at: offset }) !== bytes.byteLength) {
        throw new Error("disco cheio");
      }
      offset += bytes.byteLength;
      handle.flush();
      self.postMessage({ bytes: offset, tipo: "escrito" });
    } else if (data.papel === "fechar") {
      if (handle) {
        handle.flush();
        handle.close();
        handle = null;
      }
      self.postMessage({ bytes: offset, tipo: "fechado" });
    }
  } catch (error) {
    self.postMessage({ erro: String((error && error.message) || error), tipo: "erro" });
  }
};
