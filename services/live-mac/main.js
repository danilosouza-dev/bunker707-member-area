// Live Bunker707 (docs/30 D145): o console das lives numa janela propria, para quem apresenta no Mac. O microfone vem da
// captura da propria Apple (nativo/voz.swift, sem o ganho automatico), onde o Isolamento de Voz do Mac vale; o resto e o
// mesmo site, sem copia: a mesma conta, os mesmos dados. A camera e a tela continuam pelo motor da pagina.
const { app, BrowserWindow, desktopCapturer, ipcMain, Menu, session, shell, systemPreferences } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SITE = "https://membros.bunker707.com.br";
const START = `${SITE}/admin/comunicacao/webinarios`;
const ORIGINS = new Set([SITE, "https://meet.bunker707.com.br"]);
// O endereco como o motor o escreve (o espaco de "Live Bunker707.app" vira %20).
const PROVA = pathToFileURL(path.join(__dirname, "pagina", "prova.html")).href;
const MEDIA = new Set(["media", "display-capture", "fullscreen", "clipboard-sanitized-write", "notifications"]);

function trusted(url) {
  try {
    if (url === PROVA) {
      return true;
    }
    return ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function open(url) {
  const win = new BrowserWindow({ width: 1440, height: 900, backgroundColor: "#0b0b0c", title: "Live Bunker707", webPreferences: { autoplayPolicy: "no-user-gesture-required", contextIsolation: true, nodeIntegrationInSubFrames: true, preload: path.join(__dirname, "preload.js"), sandbox: true } });
  win.loadURL(url);
  win.on("page-title-updated", (event) => event.preventDefault());
  // Link de fora do site abre no navegador do dia a dia.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (trusted(target)) {
      return { action: "allow" };
    }
    shell.openExternal(target);
    return { action: "deny" };
  });
  return win;
}

/* As capturas nativas (nativo/captura.swift): a voz e o som do computador, um processo de cada, enquanto alguma pagina ouvir. */
const sources = { som: { arg: "", listeners: new Set(), proc: null }, voz: { arg: "", listeners: new Set(), proc: null } };

function captureBinary() {
  return app.isPackaged ? path.join(process.resourcesPath, "captura") : path.join(__dirname, "out", "captura");
}

function sendTo(kind, channel, payload) {
  for (const frame of sources[kind].listeners) {
    try {
      frame.send(channel, kind, payload);
    } catch {
      sources[kind].listeners.delete(frame);
    }
  }
}

function stopSource(kind) {
  const source = sources[kind];
  if (source.proc) {
    source.proc.stdin.end();
    source.proc.kill();
    source.proc = null;
  }
}

function startSource(kind, name) {
  const source = sources[kind];
  // O microfone sem o "Padrão - " e o "(3142:a008)" que o navegador acrescenta ao nome.
  const arg = kind === "voz" ? String(name || "").replace(/^(Padrão|Default) - /, "").replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").slice(0, 120) : "";
  if (source.proc && source.arg === arg) {
    return;
  }
  stopSource(kind);
  source.arg = arg;
  const proc = spawn(captureBinary(), kind === "voz" ? ["voz", arg] : ["som"], { stdio: ["pipe", "pipe", "pipe"] });
  source.proc = proc;
  const frameBytes = 4 * (kind === "som" ? 2 : 1);
  let rest = Buffer.alloc(0);
  proc.stdout.on("data", (data) => {
    const all = rest.length ? Buffer.concat([rest, data]) : data;
    const usable = all.length - (all.length % frameBytes);
    rest = all.subarray(usable);
    if (usable) {
      sendTo(kind, "fonte:dados", all.buffer.slice(all.byteOffset, all.byteOffset + usable));
    }
  });
  proc.stderr.on("data", (data) => sendTo(kind, "fonte:aviso", String(data).trim()));
  proc.on("exit", () => {
    if (source.proc === proc) {
      source.proc = null;
    }
  });
}

function forgetFrame(frame) {
  for (const kind of Object.keys(sources)) {
    if (sources[kind].listeners.delete(frame) && !sources[kind].listeners.size) {
      stopSource(kind);
    }
  }
}

ipcMain.on("fonte:abrir", (event, kind, name) => {
  if (!sources[kind] || !event.senderFrame || !trusted(event.senderFrame.url)) {
    return;
  }
  sources[kind].listeners.add(event.senderFrame);
  startSource(kind, name);
});
ipcMain.on("fonte:fechar", (event, kind) => {
  if (!sources[kind]) {
    return;
  }
  sources[kind].listeners.delete(event.senderFrame);
  if (!sources[kind].listeners.size) {
    stopSource(kind);
  }
});
app.on("web-contents-created", (_event, contents) => {
  contents.on("destroyed", () => {
    for (const kind of Object.keys(sources)) {
      for (const frame of [...sources[kind].listeners]) {
        let gone = true;
        try {
          gone = frame.isDestroyed?.() || frame.detached;
        } catch {
          gone = true;
        }
        if (gone) {
          forgetFrame(frame);
        }
      }
    }
  });
});

/* O seletor de tela do aplicativo (pagina/tela.html): a tela ou a janela, e o som do computador. */
let soundChosen = false;
ipcMain.handle("tela:som", () => soundChosen);

function pickScreen(parent) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      backgroundColor: "#151517",
      height: 620,
      minimizable: false,
      modal: Boolean(parent),
      parent: parent || undefined,
      resizable: false,
      title: "Compartilhar a tela",
      webPreferences: { contextIsolation: true, preload: path.join(__dirname, "pagina", "tela-preload.js"), sandbox: true },
      width: 820
    });
    let answered = false;
    const answer = (value) => {
      if (answered) {
        return;
      }
      answered = true;
      ipcMain.removeHandler("tela:fontes");
      ipcMain.removeAllListeners("tela:escolha");
      resolve(value);
      if (!picker.isDestroyed()) {
        picker.close();
      }
    };
    ipcMain.removeHandler("tela:fontes");
    ipcMain.handle("tela:fontes", async () => {
      // Sem a permissao de Gravacao de tela o Mac nao lista nada: o seletor mostra o caminho dos Ajustes.
      // Pedir a lista e o que faz o Mac perguntar pela permissao (a consulta "tem permissao?" diz nao antes da pergunta).
      try {
        const list = await desktopCapturer.getSources({ fetchWindowIcons: false, thumbnailSize: { height: 180, width: 320 }, types: ["screen", "window"] });
        if (!list.length) {
          return { semPermissao: true };
        }
        return { fontes: list.filter((s) => !s.name.startsWith("Live Bunker707")).map((s) => ({ id: s.id, name: s.name, screen: s.id.startsWith("screen:"), thumb: s.thumbnail.toDataURL() })) };
      } catch {
        return { semPermissao: true };
      }
    });
    ipcMain.removeAllListeners("tela:ajustes");
    ipcMain.on("tela:ajustes", () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"));
    ipcMain.on("tela:escolha", (_event, id, sound) => answer(id ? { id, sound: Boolean(sound) } : null));
    picker.on("closed", () => answer(null));
    picker.loadFile(path.join(__dirname, "pagina", "tela.html"));
  });
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("microphone").catch(() => false);
    await systemPreferences.askForMediaAccess("camera").catch(() => false);
  }
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, done, details) => done(MEDIA.has(permission) && trusted(details.requestingUrl || wc.getURL())));
  // A pagina de teste do microfone e um arquivo: a origem dela e "file://", e vale o endereco inteiro.
  ses.setPermissionCheckHandler((wc, permission, origin, details) => MEDIA.has(permission) && trusted((details && details.requestingUrl) || origin));
  // Compartilhar a tela pelo seletor do aplicativo: o do Mac entregava a tela a 5 quadros por segundo e sem o som.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const chosen = await pickScreen(BrowserWindow.getFocusedWindow());
      if (!chosen) {
        callback({});
        return;
      }
      const all = await desktopCapturer.getSources({ thumbnailSize: { height: 0, width: 0 }, types: ["screen", "window"] });
      const source = all.find((s) => s.id === chosen.id);
      soundChosen = Boolean(source) && chosen.sound;
      callback(source ? { video: source } : {});
    } catch (error) {
      console.error("[tela]", error);
      callback({});
    }
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { label: "Ver", submenu: [{ role: "reload", label: "Recarregar" }, { role: "togglefullscreen", label: "Tela cheia" }, { type: "separator" }, { label: "Testar o microfone", click: () => open(PROVA) }] },
      { role: "windowMenu" }
    ])
  );
  open(START);
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  stopSource("voz");
  stopSource("som");
});
