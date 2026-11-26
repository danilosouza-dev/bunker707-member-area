// Na sala da live (e na pagina de teste do microfone), o som vem das capturas nativas do aplicativo (nativo/captura.swift):
// - o microfone, pela captura de voz da Apple (Isolamento de Voz do Mac, sem ganho automatico), no lugar do getUserMedia
//   de audio da pagina;
// - o som do computador, junto da tela compartilhada, quando quem apresenta marca "Compartilhar o som do computador" no
//   seletor de tela do aplicativo.
// O som chega em pedacos pelo processo principal e toca num AudioWorklet com uma fila de 60 ms que se ajusta sozinha
// (o relogio do microfone e o da pagina andam um pouco diferentes: sem o ajuste, a fila esvazia ou transborda e o som
// estala). A camera e a tela continuam do navegador.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

const VOICE_ORIGINS = ["https://meet.bunker707.com.br"];

if (VOICE_ORIGINS.includes(location.origin) || location.protocol === "file:") {
  const listeners = { som: null, voz: null };
  ipcRenderer.on("fonte:dados", (_event, kind, bytes) => listeners[kind] && listeners[kind](bytes));
  ipcRenderer.on("fonte:aviso", (_event, kind, text) => console.info(`[${kind}]`, text));
  contextBridge.exposeInMainWorld("bunkerFontes", {
    abrir: (kind, callback, name) => {
      if (kind !== "voz" && kind !== "som") {
        return;
      }
      listeners[kind] = callback;
      ipcRenderer.send("fonte:abrir", kind, typeof name === "string" ? name : "");
    },
    fechar: (kind) => {
      listeners[kind] = null;
      ipcRenderer.send("fonte:fechar", kind);
    },
    somEscolhido: () => ipcRenderer.invoke("tela:som")
  });
  webFrame.executeJavaScript(`(${function shim() {
    const devices = navigator.mediaDevices;
    const originalUser = devices.getUserMedia.bind(devices);
    const originalDisplay = devices.getDisplayMedia.bind(devices);
    const WORKLET = `
      class Fonte extends AudioWorkletProcessor {
        constructor(options) {
          super();
          this.channels = options.processorOptions.channels;
          this.queue = [];
          this.size = 0;
          this.pos = 0;
          this.ready = false;
          this.ratio = 1;
          this.target = 2880;
          this.underruns = 0;
          this.port.onmessage = (event) => {
            const chunk = new Float32Array(event.data);
            this.queue.push(chunk);
            this.size += chunk.length / this.channels;
            // Nunca mais que 300 ms na fila: o atraso nao cresce.
            while (this.size > 14400 && this.queue.length > 1) { this.size -= this.queue[0].length / this.channels - this.pos; this.queue.shift(); this.pos = 0; }
            if (!this.ready && this.size >= this.target) { this.ready = true; }
          };
        }
        sample(offset, channel) {
          let index = this.pos + offset;
          for (const chunk of this.queue) {
            const frames = chunk.length / this.channels;
            if (index < frames) { return chunk[Math.floor(index) * this.channels + channel]; }
            index -= frames;
          }
          return 0;
        }
        process(_inputs, outputs) {
          const out = outputs[0];
          if (!this.ready) { return true; }
          // A fila acima do alvo toca um pouco mais rapido; abaixo, um pouco mais devagar (no maximo 0,5%, inaudivel).
          const error = (this.size - this.target) / this.target;
          this.ratio += (Math.max(-0.005, Math.min(0.005, error * 0.01)) + 1 - this.ratio) * 0.02;
          const n = out[0].length;
          if (this.size < n * this.ratio + 2) { this.ready = false; this.underruns += 1; this.port.postMessage(this.underruns); return true; }
          for (let i = 0; i < n; i += 1) {
            const at = i * this.ratio;
            const base = Math.floor(at);
            const frac = at - base;
            for (let c = 0; c < out.length; c += 1) {
              const ch = Math.min(c, this.channels - 1);
              out[c][i] = this.sample(base, ch) * (1 - frac) + this.sample(base + 1, ch) * frac;
            }
          }
          let used = n * this.ratio;
          this.size -= used;
          this.pos += used;
          while (this.queue.length && this.pos >= this.queue[0].length / this.channels) { this.pos -= this.queue[0].length / this.channels; this.queue.shift(); }
          return true;
        }
      }
      registerProcessor("bunker-fonte", Fonte);`;
    const feeds = {};

    /** A faixa de uma fonte nativa ('voz' mono ou 'som' estereo), criada uma vez e copiada para cada pedido. */
    async function feed(kind, name) {
      if (feeds[kind]) {
        // Outro microfone na sala: a captura troca, a faixa da pagina continua a mesma.
        if (kind === "voz") { window.bunkerFontes.abrir(kind, feeds[kind].push, name); }
        return feeds[kind].track.clone();
      }
      const channels = kind === "som" ? 2 : 1;
      // Sem saida de som: o relogio da pagina nao depende do fone (Bluetooth a 44,1 kHz).
      let ctx;
      try { ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000, sinkId: { type: "none" } }); } catch { ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 }); }
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
      const node = new AudioWorkletNode(ctx, "bunker-fonte", { numberOfInputs: 0, outputChannelCount: [channels], processorOptions: { channels } });
      node.port.onmessage = (event) => { if (event.data % 20 === 1) { console.warn(`[${kind}] fila vazia ${event.data}x`); } };
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = channels;
      node.connect(dest);
      const push = (bytes) => node.port.postMessage(bytes, [bytes]);
      window.bunkerFontes.abrir(kind, push, name);
      await ctx.resume();
      feeds[kind] = { ctx, push, track: dest.stream.getAudioTracks()[0] };
      return feeds[kind].track.clone();
    }

    /** O nome do microfone que a sala pediu (pelo deviceId); sem pedido, o que o navegador usaria. */
    async function micName(audio) {
      const wanted = audio && typeof audio === "object" ? audio.deviceId : undefined;
      const id = typeof wanted === "string" ? wanted : wanted && (wanted.exact || wanted.ideal);
      let list = (await devices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      // Sem uma captura de audio de verdade, o navegador nao conta os nomes dos microfones (nem para a sala escolher):
      // uma abertura rapida libera os nomes, e a faixa e fechada na hora.
      if (!list.some((d) => d.label)) {
        try { (await originalUser({ audio: true })).getTracks().forEach((t) => t.stop()); } catch { /* fica o padrao do Mac */ }
        list = (await devices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      }
      const found = (id && list.find((d) => d.deviceId === id)) || list.find((d) => d.deviceId === "default") || list[0];
      return found ? found.label : "";
    }

    devices.getUserMedia = async (constraints) => {
      if (!constraints || !constraints.audio) {
        return originalUser(constraints);
      }
      const video = constraints.video ? await originalUser({ video: constraints.video }) : null;
      const stream = new MediaStream(video ? video.getVideoTracks() : []);
      stream.addTrack(await feed("voz", await micName(constraints.audio)));
      return stream;
    };

    devices.getDisplayMedia = async (constraints) => {
      const stream = await originalDisplay({ ...(constraints || {}), audio: false });
      if (await window.bunkerFontes.somEscolhido()) {
        stream.addTrack(await feed("som", ""));
        // Parou de compartilhar: o som do computador para junto.
        stream.getVideoTracks()[0]?.addEventListener("ended", () => { window.bunkerFontes.fechar("som"); feeds.som?.ctx.close(); delete feeds.som; });
      }
      return stream;
    };
  }})();`);
}
