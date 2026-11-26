// Na sala da live (e na prova), o microfone vem da captura da Apple feita pelo proprio aplicativo (nativo/voz.swift), com
// o isolamento de voz do Mac e sem ganho automatico: o getUserMedia de audio da pagina recebe esse som. A camera e a tela
// continuam do navegador.
const { contextBridge, ipcRenderer, webFrame } = require("electron");

const VOICE_ORIGINS = ["https://meet.bunker707.com.br"];

if (VOICE_ORIGINS.includes(location.origin) || location.protocol === "file:") {
  let listener = null;
  ipcRenderer.on("voz:som", (_event, bytes) => listener && listener(bytes));
  ipcRenderer.on("voz:aviso", (_event, text) => console.info("[voz]", text));
  contextBridge.exposeInMainWorld("bunkerVoz", {
    abrir: (callback, name) => {
      listener = callback;
      ipcRenderer.send("voz:abrir", typeof name === "string" ? name : "");
    },
    fechar: () => {
      listener = null;
      ipcRenderer.send("voz:fechar");
    }
  });
  webFrame.executeJavaScript(`(${function shim() {
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    const WORKLET = `
      class Voz extends AudioWorkletProcessor {
        constructor() {
          super();
          this.queue = [];
          this.head = 0;
          this.size = 0;
          this.ready = false;
          this.port.onmessage = (event) => {
            const chunk = new Float32Array(event.data);
            this.queue.push(chunk);
            this.size += chunk.length;
            // Nunca mais que 200 ms na fila: o atraso nao cresce.
            while (this.size > 9600 && this.queue.length > 1) { this.size -= this.queue[0].length - this.head; this.queue.shift(); this.head = 0; }
            // Comeca com 30 ms na fila, para os pedacos que chegam tortos.
            if (!this.ready && this.size >= 1440) { this.ready = true; }
          };
        }
        process(_inputs, outputs) {
          const out = outputs[0][0];
          if (!this.ready) { return true; }
          let i = 0;
          while (i < out.length && this.queue.length) {
            const chunk = this.queue[0];
            const take = Math.min(out.length - i, chunk.length - this.head);
            out.set(chunk.subarray(this.head, this.head + take), i);
            i += take;
            this.head += take;
            this.size -= take;
            if (this.head === chunk.length) { this.queue.shift(); this.head = 0; }
          }
          if (i < out.length) { this.ready = false; }
          return true;
        }
      }
      registerProcessor("bunker-voz", Voz);`;
    let source = null;
    let port = null;

    /** O nome do microfone que a sala pediu (pelo deviceId); sem pedido, o que o navegador usaria. */
    async function micName(audio) {
      const wanted = audio && typeof audio === "object" ? audio.deviceId : undefined;
      const id = typeof wanted === "string" ? wanted : wanted && (wanted.exact || wanted.ideal);
      let list = (await devices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      // Sem uma captura de audio de verdade, o navegador nao conta os nomes dos microfones (nem para a sala escolher):
      // uma abertura rapida libera os nomes, e a faixa e fechada na hora.
      if (!list.some((d) => d.label)) {
        try {
          (await original({ audio: true })).getTracks().forEach((t) => t.stop());
        } catch {
          // Sem a permissao, fica o microfone padrao do Mac.
        }
        list = (await devices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      }
      const found = (id && list.find((d) => d.deviceId === id)) || list.find((d) => d.deviceId === "default") || list[0];
      return found ? found.label : "";
    }

    async function voice(audio) {
      const name = await micName(audio);
      if (source) {
        // Outro microfone na sala: a captura troca, a faixa da pagina continua a mesma.
        window.bunkerVoz.abrir((bytes) => port.postMessage(bytes, [bytes]), name);
      }
      if (!source) {
        const ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
        const node = new AudioWorkletNode(ctx, "bunker-voz", { numberOfInputs: 0, outputChannelCount: [1] });
        const dest = ctx.createMediaStreamDestination();
        dest.channelCount = 1;
        node.connect(dest);
        port = node.port;
        window.bunkerVoz.abrir((bytes) => port.postMessage(bytes, [bytes]), name);
        await ctx.resume();
        source = dest.stream.getAudioTracks()[0];
      }
      return source.clone();
    }

    devices.getUserMedia = async (constraints) => {
      if (!constraints || !constraints.audio) {
        return original(constraints);
      }
      const video = constraints.video ? await original({ video: constraints.video }) : null;
      const stream = new MediaStream(video ? video.getVideoTracks() : []);
      stream.addTrack(await voice(constraints.audio));
      return stream;
    };
  }})();`);
}
