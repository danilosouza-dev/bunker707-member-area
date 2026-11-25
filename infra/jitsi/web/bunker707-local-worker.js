/*
 * Bunker707: as duas linhas de trabalho da gravacao no computador de quem apresenta (docs/30 D141), fora da linha da
 * pagina, para a aba escondida (quem apresenta compartilhando outra janela) nao segurar a gravacao:
 * - { papel: 'compor' }: le os quadros direto das faixas e monta um quadro so de 1920x1080, como o palco da sala: a camera
 *   sozinha enche o quadro; com a tela compartilhada (ou com mais alguem de camera ligada), o principal fica a esquerda e
 *   as cameras numa coluna a direita, nunca por cima. Qualquer imagem nova vira um quadro da gravacao, no maximo 60 por
 *   segundo: a camera pequena anda no ritmo dela, e nao no da tela.
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
// Cada imagem que chega (a camera, a tela e a camera de quem mais estiver no ar), na ordem de chegada.
var feeds = new Map();
var people = [];
var timer = null;
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

/** A camera no quadradinho da coluna, cheia (cortando a sobra), com o nome embaixo quando e de outra pessoa. */
function tile(frame, name, x, y, w, h) {
    var scale = Math.max(w / frame.displayWidth, h / frame.displayHeight);
    var cw = w / scale;
    var ch = h / scale;

    ctx.drawImage(frame, (frame.displayWidth - cw) / 2, (frame.displayHeight - ch) / 2, cw, ch, x, y, w, h);
    if (!name) { return; }
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(x, y + h - 28, w, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(name, x + 8, y + h - 8, w - 16);
}

function emit() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!writer) { return; }
    var now = performance.now();
    var screen = feeds.get('tela');
    var camera = feeds.get('camera');
    var others = people.filter(function (p) { return feeds.get(p.id) && feeds.get(p.id).frame; }).slice(0, 5);
    var column = [];

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    screen = screen && screen.frame;
    camera = camera && camera.frame;
    if (screen && camera) { column.push({ frame: camera, name: '' }); }
    others.forEach(function (p) { column.push({ frame: feeds.get(p.id).frame, name: p.name }); });
    var main = screen || camera;

    if (!main && column.length) { main = column.shift().frame; }
    var width = column.length ? W - 336 : W;

    if (main) {
        var r = fit(main.displayWidth, main.displayHeight, 0, 0, width, H);

        ctx.drawImage(main, r[0], r[1], r[2], r[3]);
    }
    var top = Math.round((H - column.length * 180 + 9) / 2);

    column.forEach(function (item, n) { tile(item.frame, item.name, W - 320, top + n * 180, 304, 171); });
    lastEmitAt = now;
    // O gravador atrasado: este quadro nao entra (nunca uma fila que cresce).
    if (writer.desiredSize !== null && writer.desiredSize <= 0) { counts.perdeu += 1; return; }
    var stamp = Math.max(lastStamp + 1, Math.round(now * 1000));

    lastStamp = stamp;
    var frame = new VideoFrame(canvas, { timestamp: stamp });

    counts.saiu += 1;
    writer.write(frame).catch(function () { frame.close(); });
}

/** Uma imagem nova: um quadro ja, ou assim que passar 1/60 de segundo do anterior. */
function request() {
    var wait = lastEmitAt + 16 - performance.now();

    if (wait <= 1) { emit(); } else if (!timer) { timer = setTimeout(emit, wait); }
}

function drop(id) {
    var feed = feeds.get(id);

    if (!feed) { return; }
    feeds.delete(id);
    if (feed.frame) { feed.frame.close(); }
    feed.reader.cancel().catch(function () {});
}

function pump(id, readable) {
    drop(id);
    if (!readable) { request(); return; }
    var feed = { frame: null, reader: readable.getReader() };

    feeds.set(id, feed);
    (function next() {
        feed.reader.read().then(function (result) {
            if (feeds.get(id) !== feed) { if (result.value) { result.value.close(); } return; }
            if (result.done) { drop(id); request(); return; }
            if (feed.frame) { feed.frame.close(); }
            feed.frame = result.value;
            if (id === 'camera' || id === 'tela') { counts[id] += 1; }
            request();
            next();
        }).catch(function () { /* a faixa acabou */ });
    }());
}

self.onmessage = function (event) {
    var data = event.data || {};

    if (data.papel === 'compor') {
        canvas = new OffscreenCanvas(W, H);
        ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        ctx.font = '600 16px sans-serif';
        writer = data.writable.getWriter();
        // Sem nenhuma imagem (camera desligada e sem tela), a gravacao segue com o preto.
        setInterval(function () { if (performance.now() - lastEmitAt > 250) { emit(); } }, 100);
        setInterval(function () { self.postMessage({ contas: counts, tipo: 'contas' }); counts = { camera: 0, tela: 0, saiu: 0, perdeu: 0 }; }, 5000);
    } else if (data.papel === 'faixa') {
        pump(data.qual, data.readable || null);
    } else if (data.papel === 'pessoas') {
        people = data.pessoas;
        request();
    } else if (data.papel === 'fim') {
        var ending = writer;

        writer = null;
        Array.from(feeds.keys()).forEach(drop);
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
