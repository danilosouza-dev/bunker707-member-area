// Live Bunker707 (docs/30 D145): o console das lives numa janela propria, para quem apresenta no Mac. O microfone vem da
// captura da propria Apple (nativo/voz.swift, sem o ganho automatico), onde o Isolamento de Voz do Mac vale; o resto e o
// mesmo site, sem copia: a mesma conta, os mesmos dados. A camera e a tela continuam pelo motor da pagina.
const { app, BrowserWindow, ipcMain, Menu, session, shell, systemPreferences } = require("electron");
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

/* A voz pela captura da Apple: um processo so, enquanto alguma pagina da sala estiver ouvindo. */
const listeners = new Set();
let voice = null;

function voiceBinary() {
  return app.isPackaged ? path.join(process.resourcesPath, "voz") : path.join(__dirname, "nativo", "voz");
}

/** O microfone pedido pela sala (o nome, sem o "(3142:a008)" que o navegador acrescenta). */
let wantedMic = "";

function startVoice(name) {
  const clean = String(name || "").replace(/^(Padrão|Default) - /, "").replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").slice(0, 120);
  // Outro microfone escolhido: a captura recomeca com ele.
  if (voice && clean === wantedMic) {
    return;
  }
  if (voice) {
    voice.stdin.end();
    voice.kill();
    voice = null;
  }
  wantedMic = clean;
  voice = spawn(voiceBinary(), [clean], { stdio: ["pipe", "pipe", "pipe"] });
  const current = voice;
  let rest = Buffer.alloc(0);
  voice.stdout.on("data", (data) => {
    const all = rest.length ? Buffer.concat([rest, data]) : data;
    const usable = all.length - (all.length % 4);
    rest = all.subarray(usable);
    if (!usable) {
      return;
    }
    const bytes = all.buffer.slice(all.byteOffset, all.byteOffset + usable);
    for (const frame of listeners) {
      try {
        frame.send("voz:som", bytes);
      } catch {
        listeners.delete(frame);
      }
    }
  });
  voice.stderr.on("data", (data) => {
    for (const frame of listeners) {
      try {
        frame.send("voz:aviso", String(data).trim());
      } catch {
        listeners.delete(frame);
      }
    }
  });
  voice.on("exit", () => {
    if (voice === current) {
      voice = null;
    }
  });
}

function stopVoiceIfIdle() {
  if (!listeners.size && voice) {
    voice.stdin.end();
    voice = null;
  }
}

ipcMain.on("voz:abrir", (event, name) => {
  if (!event.senderFrame || !trusted(event.senderFrame.url)) {
    return;
  }
  listeners.add(event.senderFrame);
  startVoice(name);
});
ipcMain.on("voz:fechar", (event) => {
  listeners.delete(event.senderFrame);
  stopVoiceIfIdle();
});
app.on("web-contents-created", (_event, contents) => {
  contents.on("destroyed", () => {
    for (const frame of [...listeners]) {
      try {
        if (frame.isDestroyed?.() || frame.detached) listeners.delete(frame);
      } catch {
        listeners.delete(frame);
      }
    }
    stopVoiceIfIdle();
  });
});

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("microphone").catch(() => false);
    await systemPreferences.askForMediaAccess("camera").catch(() => false);
  }
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, done, details) => done(MEDIA.has(permission) && trusted(details.requestingUrl || wc.getURL())));
  // A pagina de teste do microfone e um arquivo: a origem dela e "file://", e vale o endereco inteiro.
  ses.setPermissionCheckHandler((wc, permission, origin, details) => MEDIA.has(permission) && trusted((details && details.requestingUrl) || origin));
  // Compartilhar a tela pelo seletor do proprio Mac.
  ses.setDisplayMediaRequestHandler((request, callback) => callback({}), { useSystemPicker: true });
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
app.on("will-quit", () => voice && voice.kill());
