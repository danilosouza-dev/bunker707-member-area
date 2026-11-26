// O seletor de tela do aplicativo: so a lista de telas e janelas e a escolha.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("seletor", {
  escolher: (id, sound) => ipcRenderer.send("tela:escolha", id, sound),
  ajustes: () => ipcRenderer.send("tela:ajustes"),
  fontes: () => ipcRenderer.invoke("tela:fontes")
});
