/*
 * Bunker707: as duas linhas de trabalho da gravacao no computador de quem apresenta (docs/30 D141), fora da linha da
 * pagina, para a aba escondida (quem apresenta compartilhando outra janela) nao segurar a gravacao:
 * - { papel: 'compor' }: le os quadros da camera e da tela direto das faixas, monta um quadro so de 1920x1080 (so a camera;
 *   ou a tela inteira com a camera num canto) e o entrega ao gravador. Um quadro novo da tela, ou da camera quando a tela
 *   esta parada ou nao existe, vira um quadro da gravacao no mesmo instante: nada e repetido para encher 30 por segundo.
 * - { papel: 'gravar' }: escreve cada pedaco no disco (a pasta privada desta origem no navegador) assim que chega. Fechar a
 *   aba perde so o pedaco que ainda nao chegou.
 * Nada daqui fala com a rede.
 */
'use strict';

var W = 1920;
var H = 1080;
var canvas = null;
var ctx = null;
var writer = null;
var latest = { camera: null, tela: null };
var runs = { camera: 0, tela: 0 };
var lastScreenAt = 0;
var lastEmitAt = 0;
var lastStamp = 0;
var counts = { camera: 0, tela: 0, saiu: 0, perdeu: 0 };
var file = null;
var offset = 0;

/** O retangulo que cabe inteiro na caixa, centralizado. */
function fit(width, height, x, y, boxWidth, boxHeight) {
    var scale = Math.min(boxWidth / width, boxHeight / height);
    var w = Math.round(width * scale);
    var h = Math.round(height * scale);

    return [x + Math.round((boxWidth - w) / 2), y + Math.round((boxHeight - h) / 2), w, h];
}

function emit() {
    if (!writer) { return; }
    var now = performance.now();

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    var main = latest.tela || latest.camera;

    if (main) {
        var r = fit(main.displayWidth, main.displayHeight, 0, 0, W, H);

        ctx.drawImage(main, r[0], r[1], r[2], r[3]);
    }
    if (latest.tela && latest.camera) {
        var c = fit(latest.camera.displayWidth, latest.camera.displayHeight, W - 384 - 32, H - 216 - 32, 384, 216);

        ctx.drawImage(latest.camera, c[0], c[1], c[2], c[3]);
    }
    lastEmitAt = now;
    // O gravador atrasado: este quadro nao entra (nunca uma fila que cresce).
    if (writer.desiredSize !== null && writer.desiredSize <= 0) { counts.perdeu += 1; return; }
    var stamp = Math.max(lastStamp + 1, Math.round(now * 1000));

    lastStamp = stamp;
    var frame = new VideoFrame(canvas, { timestamp: stamp });

    counts.saiu += 1;
    writer.write(frame).catch(function () { frame.close(); });
}

function pump(kind, readable) {
    var run = ++runs[kind];

    if (latest[kind]) { latest[kind].close(); latest[kind] = null; }
    if (!readable) { emit(); return; }
    var reader = readable.getReader();

    (function next() {
        reader.read().then(function (result) {
            if (run !== runs[kind]) {
                if (result.value) { result.value.close(); }
                reader.cancel().catch(function () {});

                return;
            }
            if (result.done) { if (latest[kind]) { latest[kind].close(); latest[kind] = null; } emit(); return; }
            if (latest[kind]) { latest[kind].close(); }
            latest[kind] = result.value;
            counts[kind] += 1;
            var now = performance.now();

            if (kind === 'tela') { lastScreenAt = now; emit(); }
            // Com a tela andando, o ritmo e o dela; parada (ou sem tela), o da camera.
            else if (!latest.tela || now - lastScreenAt > 100) { emit(); }
            next();
        }).catch(function () { /* a faixa acabou */ });
    }());
}

self.onmessage = function (event) {
    var data = event.data || {};

    if (data.papel === 'compor') {
        canvas = new OffscreenCanvas(W, H);
        ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        writer = data.writable.getWriter();
        // Sem nenhuma imagem (camera desligada e sem tela), a gravacao segue com o preto.
        setInterval(function () { if (performance.now() - lastEmitAt > 250) { emit(); } }, 100);
        setInterval(function () { self.postMessage({ contas: counts, tipo: 'contas' }); counts = { camera: 0, tela: 0, saiu: 0, perdeu: 0 }; }, 5000);
    } else if (data.papel === 'faixa') {
        pump(data.qual, data.readable || null);
    } else if (data.papel === 'fim') {
        var ending = writer;

        writer = null;
        runs.camera += 1;
        runs.tela += 1;
        ['camera', 'tela'].forEach(function (kind) { if (latest[kind]) { latest[kind].close(); latest[kind] = null; } });
        if (ending) { ending.close().catch(function () {}); }
    } else if (data.papel === 'gravar') {
        navigator.storage.getDirectory()
            .then(function (dir) { return dir.getFileHandle(data.nome, { create: true }); })
            .then(function (handle) { return handle.createSyncAccessHandle(); })
            .then(function (access) { file = access; file.truncate(0); self.postMessage({ tipo: 'aberto' }); })
            .catch(function (error) { self.postMessage({ erro: String(error && error.name), tipo: 'erro' }); });
    } else if (data.papel === 'pedaco') {
        try {
            offset += file.write(new Uint8Array(data.bytes), { at: offset });
            file.flush();
            self.postMessage({ bytes: offset, tipo: 'escrito' });
        } catch (error) { self.postMessage({ erro: String(error && error.name), tipo: 'erro' }); }
    } else if (data.papel === 'fechar') {
        try { file.flush(); file.close(); } catch (error) { /* ja fechado */ }
        self.postMessage({ bytes: offset, tipo: 'fechado' });
    }
};
