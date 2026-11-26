/*
 * Bunker707: as duas linhas de trabalho da gravacao no computador de quem apresenta (docs/30 D141), fora da linha da
 * pagina, para a aba escondida (quem apresenta compartilhando outra janela) nao segurar a gravacao:
 * - { papel: 'compor' }: le os quadros direto das faixas e monta um quadro so de 1920x1080, em ritmo fixo, o dobro do da propria camera
 *   (docs/30 D143): a camera sozinha enche o quadro; com a tela compartilhada (ou com mais alguem de camera ligada), o
 *   principal fica a esquerda e as cameras numa coluna estreita a direita, nunca por cima. O que sobra em volta do
 *   principal e ele mesmo desfocado, nunca preto.
 * - { papel: 'gravar' }: escreve cada pedaco no disco (a pasta privada desta origem no navegador) assim que chega. Fechar a
 *   aba perde so o pedaco que ainda nao chegou.
 * Nada daqui fala com a rede.
 */
'use strict';

var W = 1920;
var H = 1080;
// O ritmo fixo da gravacao: um quadro a cada casa de DEN/NUM de segundo, sempre, a 30 por segundo (o padrao de mercado
// para aula com tela: OBS, Zoom e Riverside gravam a 30), na familia da camera: 29,97 para as cameras de video (23,976,
// 29,97, 59,94), 30 para 24, 30 e 60, e 25 para as de 25 e 50. Com a camera a 30, cada quadro dela vira um quadro do
// arquivo; a 24, um a cada quatro aparece duas vezes, como um filme numa tela comum. O player e a Bunny convertem um ritmo
// irregular pela media (25/11/2026: 28,25), e o movimento soluca. O dobro do ritmo (D143, 48 com a camera a 24) dobrava o
// trabalho da linha (docs/30 D147).
var RATES = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [50, 1], [60000, 1001], [60, 1]];
var CONTAINER = { 23.976: [30000, 1001], 24: [30, 1], 25: [25, 1], 29.97: [30000, 1001], 30: [30, 1], 50: [25, 1], 59.94: [30000, 1001], 60: [30, 1] };
// A camera no mesmo ritmo do arquivo: so entao a casa e alinhada ao meio do quadro dela.
var LOCKED = false;
var NUM = 30;
var DEN = 1;
// A imagem espera isto antes de entrar no quadro (a captura chega um pouco adiantada ou atrasada). Anda devagar em volta
// de 40 ms para a casa cair sempre no meio do quadro da camera.
var DELAY = 40;
var placed = false;
// O atraso da camera (a placa de captura HDMI entrega a imagem depois do som): o som, a tela e as outras pessoas esperam o
// mesmo tanto. Medido pelas palmas do produtor em 25/11/2026 na Cam Link 4K: 104 a 115 ms.
var LATE = 0;
var COLUMN = 200;
var TILE_W = 180;
var TILE_H = 240;
var canvas = null;
var ctx = null;
var small = null;
var sctx = null;
// O codificador do video, o do audio e o arquivo (fMP4, escrito em pedacos). Nulos fora de uma gravacao.
var venc = null;
var aenc = null;
var mp4 = null;
var failed = false;
var RATE = 48000;
var CHANNELS = 2;
var BITRATE = 10000000;
// O som do arquivo anda isto para a frente (as amostras vazias do comeco do AAC e a espera do caminho, que o atrasariam):
// um valor para o som que vem da mistura do navegador e outro para o microfone lido direto.
var ADVANCE = 900;
var ADVANCE_VOICE = -1100;
var audio = { bias: null, drop: 0, filled: 0, lead: null, mean: 0, next: null, reader: null, samples: 0, seen: 0, started: false };
// O microfone de quem apresenta, lido direto da faixa (docs/30 D143): fora da mistura do navegador, que segura o som por um
// tempo que varia. Com ele no ar, ele manda no relogio do som e as outras vozes (a mistura) esperam numa fila curta.
var voice = { last: 0, on: false, reader: null, refused: false };
var rest = { frames: 0, list: [] };
// Quanto tempo o som pode chegar atrasado (a captura guarda 2 s na espera) antes de valer como parado. Mais curto que isso,
// a linha ocupada (a tela compartilhada com o som do computador) le o som em rajadas e o silencio entraria em dobro:
// em 26/11/2026, o som de uma live de 234 s saiu com 308 s.
var STALL_MS = 2500;
// O tremor do horario de cada pedaco que nao e buraco.
var GAP_US = 100000;
// Cada imagem que chega (a camera, a tela e a camera de quem mais estiver no ar), na ordem de chegada.
var feeds = new Map();
var people = [];
var timer = null;
var startAt = 0;
var slot = 0;
// As contas de cada 5 s (o relatorio da gravacao): quadros e, do som, as amostras que chegaram do microfone direto (voz) e
// da mistura (mix), as que foram para o arquivo (out), o silencio posto (sil), as trocas entre os dois e o ritmo da voz.
var EMPTY = function () { return { camera: 0, tela: 0, saiu: 0, perdeu: 0, voz: 0, mix: 0, out: 0, sil: 0, troca: 0 }; };
var counts = EMPTY();
var file = null;
var offset = 0;

/** O retangulo que cabe inteiro na caixa, centralizado. */
function fit(width, height, x, y, boxWidth, boxHeight) {
    var scale = Math.min(boxWidth / width, boxHeight / height);
    var w = Math.round(width * scale);
    var h = Math.round(height * scale);

    return [x + Math.round((boxWidth - w) / 2), y + Math.round((boxHeight - h) / 2), w, h];
}

/** A imagem cheia na caixa, cortando a sobra do meio para fora. */
function cover(target, frame, x, y, w, h) {
    var scale = Math.max(w / frame.displayWidth, h / frame.displayHeight);
    var cw = w / scale;
    var ch = h / scale;

    target.drawImage(frame, (frame.displayWidth - cw) / 2, (frame.displayHeight - ch) / 2, cw, ch, x, y, w, h);
}

/** A camera na coluna, em pe, com o nome embaixo quando e de outra pessoa. */
function tile(frame, name, x, y, w, h) {
    cover(ctx, frame, x, y, w, h);
    if (!name) { return; }
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(x, y + h - 26, w, 26);
    ctx.fillStyle = '#fff';
    ctx.fillText(name, x + 8, y + h - 8, w - 16);
}

/** No lugar do preto, a propria imagem desfocada e escurecida (reduzida a 32x18 e ampliada: barato e sem filtro). */
function backdrop(frame) {
    cover(sctx, frame, 0, 0, 32, 18);
    ctx.drawImage(small, 0, 0, 32, 18, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, W, H);
}

/** A imagem desta casa: a mais nova que ja passou da espera; as mais velhas saem. */
function pick(id, at) {
    var feed = feeds.get(id);

    if (!feed) { return null; }
    while (feed.queue.length && feed.queue[0].at <= at) {
        if (feed.shown) { feed.shown.close(); }
        feed.shownAt = feed.queue[0].at;
        feed.shown = feed.queue.shift().frame;
    }

    return feed.shown;
}

/** Mantem a casa no meio do quadro da camera: perto da borda, um atraso de 1 ms repetiria ou pularia quadros. */
function align(at) {
    var feed = feeds.get('camera');
    var period = 1000 * DEN / NUM;

    if (!feed || !feed.shown || !LOCKED) { return; }
    var age = (at - feed.shownAt) / period;
    var off = age - Math.floor(age) - 0.5;

    if (!placed) { placed = true; DELAY += off * period; } else { DELAY += Math.max(-0.05, Math.min(0.05, off * 0.2)); }
    // Os dois relogios divergem aos poucos: no limite, uma casa (um quadro repetido a cada muitos minutos).
    if (DELAY > 40 + period * 0.75) { DELAY -= period; } else if (DELAY < 40 - period * 0.75) { DELAY += period; }
}

function emit(index) {
    var at = startAt + index * 1000 * DEN / NUM - DELAY;
    var screen = pick('tela', at - LATE);
    var camera = pick('camera', at);
    var column = [];

    align(at);
    if (screen && camera) { column.push({ frame: camera, name: '' }); }
    people.slice(0, 5).forEach(function (p) {
        var frame = pick(p.id, at - LATE);

        if (frame) { column.push({ frame: frame, name: p.name }); }
    });
    // O codificador atrasado: este quadro nao entra (nunca uma fila que cresce); o anterior dura mais.
    if (venc.encodeQueueSize > 15) { counts.perdeu += 1; return; }
    var main = screen || camera;

    if (!main && column.length) { main = column.shift().frame; }
    var width = column.length ? W - COLUMN : W;

    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (main) {
        var r = fit(main.displayWidth, main.displayHeight, 0, 0, width, H);

        if (r[2] < W || r[3] < H) { backdrop(main); }
        ctx.drawImage(main, r[0], r[1], r[2], r[3]);
    }
    if (column.length) {
        // Ate 4 no tamanho cheio; com mais, um pouco menores.
        var th = Math.min(TILE_H, Math.floor((H - 24) / column.length) - 12);
        var tw = Math.round(th * TILE_W / TILE_H);
        var top = Math.round((H - column.length * (th + 12) + 12) / 2);

        column.forEach(function (item, n) { tile(item.frame, item.name, W - COLUMN + Math.round((COLUMN - tw) / 2), top + n * (th + 12), tw, th); });
    }
    var frame = new VideoFrame(canvas, { duration: Math.round(1e6 * DEN / NUM), timestamp: Math.round(index * 1e6 * DEN / NUM) });

    counts.saiu += 1;
    venc.encode(frame, { keyFrame: index % Math.round(2 * NUM / DEN) === 0 || mp4.needKey });
    mp4.needKey = false;
    frame.close();
}

/**
 * O som manda no relogio: o audio do arquivo e contado em amostras, e as casas do video andam com ele (dois relogios do
 * aparelho divergem decimos de segundo por hora). So pequenos passos, nunca um pulo de imagem; um buraco de som vira silencio.
 */
function follow() {
    if (!audio.started) { return; }
    var ahead = audio.samples * 1000 / RATE - (performance.now() - startAt);

    // O som parado de verdade (mais que os 2 s que a captura guarda na espera): o que falta e silencio. Um atraso menor nao:
    // o som atrasado chega inteiro depois (a linha ocupada le em rajadas), e o silencio contaria o mesmo trecho duas vezes.
    var behind = ahead - (audio.lead === null ? 0 : audio.lead);

    if (behind < -STALL_MS) { silence(Math.round(-behind * RATE / 1000)); audio.next = null; return; }
    // A distancia normal entre os dois (a espera da mistura), pela media dos primeiros segundos; depois, so a media longa.
    audio.seen += 1;
    audio.mean += (ahead - audio.mean) / Math.min(audio.seen, 90);
    if (audio.seen < 90) { return; }
    if (audio.lead === null) { audio.lead = audio.mean; }
    startAt -= Math.max(-0.05, Math.min(0.05, (audio.mean - audio.lead) * 0.02));
}

function silence(frames) {
    while (frames > 0 && aenc) {
        var n = Math.min(frames, 4800);
        var empty = new AudioData({ data: new Float32Array(n * CHANNELS), format: 'f32-planar', numberOfChannels: CHANNELS, numberOfFrames: n, sampleRate: RATE, timestamp: Math.round(audio.samples * 1e6 / RATE) });

        aenc.encode(empty);
        empty.close();
        audio.samples += n;
        audio.filled += n;
        counts.sil += n;
        counts.out += n;
        frames -= n;
    }
}

/** Esvazia a fila das outras vozes (na troca de quem manda no relogio). */
function clearRest() {
    rest.list = [];
    rest.frames = 0;
}

/** Soma em `planes` as proximas n amostras das outras vozes; o que faltar fica so com a voz. */
function addRest(planes, n) {
    var done = 0;

    while (done < n && rest.list.length) {
        var head = rest.list[0];
        var take = Math.min(n - done, head.n - head.at);

        for (var c = 0; c < CHANNELS; c += 1) {
            for (var i = 0; i < take; i += 1) {
                var v = planes[c * n + done + i] + head.planes[c * head.n + head.at + i];

                planes[c * n + done + i] = v > 1 ? 1 : v < -1 ? -1 : v;
            }
        }
        head.at += take;
        done += take;
        rest.frames -= take;
        if (head.at === head.n) { rest.list.shift(); }
    }
}

/** O microfone parou de entregar: a mistura volta a mandar (o buraco, se houver, vem pelo horario da captura). */
function voiceOff() {
    if (!voice.on) { return; }
    voice.on = false;
    counts.troca += 1;
    audio.next = null;
    clearRest();
}

/** O microfone sem entregar nada por mais tempo que a espera da captura: mudo na sala ou tirado. A mistura volta a mandar. */
function watchVoice() {
    if (voice.on && performance.now() - voice.last > STALL_MS) { voiceOff(); }
}

/** Um pedaco pronto vai para o arquivo, na ordem, com a hora contada em amostras. */
function emitSound(planes, frames, stamp, who) {
    if (!audio.started) {
        audio.started = true;
        audio.bias = who;
        // O primeiro som do arquivo vale a hora em que chegou; o que faltar ate o comeco e silencio.
        var fill = Math.round((performance.now() - startAt) * RATE / 1000) - frames - (who === 'voz' ? ADVANCE_VOICE : ADVANCE) + Math.round(LATE * RATE / 1000);

        if (fill > 0) { silence(fill); } else { audio.drop = -fill; }
    } else if (who === 'voz' && audio.bias !== 'voz') {
        // A gravacao comecou so com a mistura: o microfone direto chega mais cedo que ela, e entra no lugar certo.
        audio.bias = 'voz';
        if (ADVANCE > ADVANCE_VOICE) { silence(ADVANCE - ADVANCE_VOICE); } else { audio.drop = ADVANCE_VOICE - ADVANCE; }
    }
    // Um trecho que a captura perdeu (pelo horario da captura, nunca pelo da chegada) vira silencio do mesmo tamanho. So uma
    // falta de verdade, acima de 100 ms: a mistura entrega os pedacos com o horario tremido (um pouco cedo, um pouco tarde),
    // e contar so os atrasos punha segundos de silencio a mais (26/11/2026: 2,6 s a cada 5 s com a tela compartilhada).
    // O horario esperado anda pelas amostras, nao pelo carimbo de cada pedaco.
    if (audio.next === null) {
        audio.next = stamp;
    } else {
        var gap = stamp - audio.next;

        if (gap > GAP_US && gap < 60e6 && !audio.drop) { silence(Math.round(gap * RATE / 1e6)); audio.next = stamp; }
        else if (gap < -GAP_US || gap >= 60e6) { audio.next = stamp; }
    }
    audio.next += frames * 1e6 / RATE;
    if (audio.drop >= frames) { audio.drop -= frames; return; }
    var out = new AudioData({ data: planes, format: 'f32-planar', numberOfChannels: CHANNELS, numberOfFrames: frames, sampleRate: RATE, timestamp: Math.round(audio.samples * 1e6 / RATE) });

    aenc.encode(out);
    out.close();
    audio.samples += frames;
    counts.out += frames;
}

/** Cada pedaco de som que chega: do microfone direto ('voz') ou da mistura das outras vozes ('mistura'). */
function hear(data, who) {
    if (!aenc || !startAt) { data.close(); return; }
    if (data.sampleRate !== RATE) {
        if (who === 'voz') { counts.taxa = data.sampleRate; }
        data.close();
        // O microfone noutro ritmo de amostras: a pagina o poe na mistura, como antes.
        if (who === 'voz' && !voice.refused) { voice.refused = true; voiceOff(0); self.postMessage({ tipo: 'voz-recusada' }); }

        return;
    }
    var frames = data.numberOfFrames;
    var stamp = data.timestamp;
    var planes = new Float32Array(frames * CHANNELS);

    for (var c = 0; c < CHANNELS; c += 1) {
        data.copyTo(planes.subarray(c * frames, (c + 1) * frames), { format: 'f32-planar', planeIndex: Math.min(c, data.numberOfChannels - 1) });
    }
    data.close();
    counts[who === 'voz' ? 'voz' : 'mix'] += frames;
    if (who === 'voz') {
        counts.taxa = RATE;
        if (voice.refused) { return; }
        voice.last = performance.now();
        if (!voice.on) { voice.on = true; audio.next = null; clearRest(); counts.troca += 1; }
        addRest(planes, frames);
        emitSound(planes, frames, stamp, who);

        return;
    }
    if (!voice.on) { emitSound(planes, frames, stamp, who); return; }
    rest.list.push({ at: 0, n: frames, planes: planes });
    rest.frames += frames;
    // Os dois relogios divergem aos poucos: a fila nunca passa de 1/4 de segundo (o corte cai nas outras vozes, nunca na voz).
    while (rest.frames > RATE / 4 && rest.list.length > 1) { rest.frames -= rest.list[0].n - rest.list[0].at; rest.list.shift(); counts.corte = (counts.corte || 0) + 1; }
}

/** A faixa do microfone lida direto (nula: mudo ou sem microfone). */
function listen(readable) {
    if (voice.reader) { voice.reader.cancel().catch(function () {}); voice.reader = null; }
    voiceOff(0);
    if (!readable) { return; }
    if (voice.refused) { readable.cancel().catch(function () {}); return; }
    var reader = readable.getReader();

    voice.reader = reader;
    (function next() {
        reader.read().then(function (result) {
            if (voice.reader !== reader) { if (result.value) { result.value.close(); } return; }
            if (result.done) { voiceOff(0); return; }
            hear(result.value, 'voz');
            next();
        }).catch(function () { /* a faixa acabou */ });
    }());
}

/* ---- o arquivo: MP4 em fragmentos (ISO 14496-12), um por grupo de 2 s, para gravar enquanto acontece ---- */

function bytes() {
    var size = 0;
    var parts = Array.prototype.slice.call(arguments).map(function (p) { return typeof p === 'string' ? Uint8Array.from(p, function (ch) { return ch.charCodeAt(0); }) : p; });

    parts.forEach(function (p) { size += p.length; });
    var out = new Uint8Array(size);
    var at = 0;

    parts.forEach(function (p) { out.set(p, at); at += p.length; });

    return out;
}

function u32() {
    var out = new Uint8Array(arguments.length * 4);
    var view = new DataView(out.buffer);

    for (var i = 0; i < arguments.length; i += 1) { view.setUint32(i * 4, arguments[i]); }

    return out;
}

function u16() {
    var out = new Uint8Array(arguments.length * 2);
    var view = new DataView(out.buffer);

    for (var i = 0; i < arguments.length; i += 1) { view.setUint16(i * 2, arguments[i]); }

    return out;
}

function u64(value) { return u32(Math.floor(value / 4294967296), value % 4294967296); }

function zeros(n) { return new Uint8Array(n); }

function box(type) {
    var body = bytes.apply(null, Array.prototype.slice.call(arguments, 1));

    return bytes(u32(body.length + 8), type, body);
}

/** Uma caixa com versao e sinais. */
function full(type, version, flags) {
    return box.apply(null, [type, u32(version * 16777216 + flags)].concat(Array.prototype.slice.call(arguments, 3)));
}

var MATRIX = u32(65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824);

function track(id, scale, kind, media, entry, w, h) {
    return box('trak',
        full('tkhd', 0, 3, u32(0, 0, id, 0, 0), zeros(8), u16(0, 0, kind === 'soun' ? 256 : 0, 0), MATRIX, u32(w * 65536, h * 65536)),
        box('mdia',
            full('mdhd', 0, 0, u32(0, 0, scale, 0), u16(21956, 0)),
            full('hdlr', 0, 0, u32(0), kind, zeros(12), 'bunker707\0'),
            box('minf', media, box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
                box('stbl', full('stsd', 0, 0, u32(1), entry), full('stts', 0, 0, u32(0)), full('stsc', 0, 0, u32(0)), full('stsz', 0, 0, u32(0, 0)), full('stco', 0, 0, u32(0))))));
}

function header(avcC, aac) {
    var avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(W, H), u32(4718592, 4718592, 0), u16(1), zeros(32), u16(24, 65535), box('avcC', avcC),
        box('colr', 'nclx', u16(1, 1, 1), new Uint8Array([0])));
    var config = bytes(new Uint8Array([4, 13 + 2 + aac.length, 64, 21, 0, 0, 0]), u32(160000, 160000), new Uint8Array([5, aac.length]), aac);
    var esds = full('esds', 0, 0, new Uint8Array([3, 3 + config.length + 3, 0, 2, 0]), config, new Uint8Array([6, 1, 2]));
    var mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(CHANNELS, 16, 0, 0), u32(RATE * 65536), esds);

    return bytes(
        box('ftyp', 'isom', u32(512), 'isomiso6avc1mp41'),
        box('moov',
            full('mvhd', 0, 0, u32(0, 0, 1000, 0, 65536), u16(256, 0), zeros(8), MATRIX, zeros(24), u32(3)),
            track(1, NUM * 1000, 'vide', full('vmhd', 0, 1, zeros(8)), avc1, W, H),
            track(2, RATE, 'soun', full('smhd', 0, 0, zeros(4)), mp4a, 0, 0),
            box('mvex', full('trex', 0, 0, u32(1, 1, 0, 0, 0)), full('trex', 0, 0, u32(2, 1, 0, 0, 0)))));
}

/** As duracoes dos quadros saem da casa do proximo; o ultimo de todos dura uma casa. */
function fragment(video, sound, next) {
    var vbytes = 0;
    var rows = video.map(function (v, n) {
        vbytes += v.data.length;

        return u32(((n + 1 < video.length ? video[n + 1].slot : next) - v.slot) * DEN * 1000, v.data.length, v.key ? 33554432 : 16842752);
    });
    var arows = sound.map(function (a) { return u32(1024, a.length); });
    var build = function (off) {
        return box('moof',
            full('mfhd', 0, 0, u32(mp4.seq)),
            box('traf', full('tfhd', 0, 131072, u32(1)), full('tfdt', 1, 0, u64(video[0].slot * DEN * 1000)), full('trun', 0, 1793, u32(video.length, off), bytes.apply(null, rows))),
            sound.length ? box('traf', full('tfhd', 0, 131072, u32(2)), full('tfdt', 1, 0, u64(mp4.sound * 1024)), full('trun', 0, 769, u32(sound.length, off + vbytes), bytes.apply(null, arows))) : zeros(0));
    };
    var size = build(0).length + 8;

    var out = bytes(build(size), box('mdat', bytes.apply(null, video.map(function (v) { return v.data; })), bytes.apply(null, sound)));

    mp4.seq += 1;
    mp4.sound += sound.length;

    return out;
}

/** Fecha o grupo que esta na espera e manda para a pagina guardar. */
function cut(next) {
    if (!mp4 || !mp4.avcC || !mp4.aac || !mp4.video.length) { return; }
    var out = mp4.headed ? zeros(0) : header(mp4.avcC, mp4.aac);

    mp4.headed = true;
    out = bytes(out, fragment(mp4.video, mp4.audio, next));
    mp4.video = [];
    mp4.audio = [];
    self.postMessage({ bytes: out.buffer, tipo: 'parte' }, [out.buffer]);
}

function copyOf(value) { return value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)); }

function chunkBytes(chunk) {
    var out = new Uint8Array(chunk.byteLength);

    chunk.copyTo(out);

    return out;
}

function broke(error) {
    if (failed) { return; }
    failed = true;
    self.postMessage({ erro: String(error && error.name || error), tipo: 'quebrou' });
}

/** O ritmo da camera, pela media dos carimbos dela, quando bate (3%) com um ritmo de verdade; senao, 30. */
function cadence(hint) {
    var feed = feeds.get('camera');
    var s = feed ? feed.stamps : [];

    if (s.length < 24) { return; }
    // Um quadro que a captura perdeu conta como casa vazia, senao a media erraria o ritmo.
    var gaps = s.slice(1).map(function (at, n) { return at - s[n]; });
    var middle = gaps.slice().sort(function (x, y) { return x - y; })[Math.floor(gaps.length / 2)];
    var slots = gaps.reduce(function (sum, gap) { return sum + Math.max(1, Math.round(gap / middle)); }, 0);
    var fps = slots * 1e6 / (s[s.length - 1] - s[0]);

    // Dos que batem, o mais perto.
    var found = RATES.map(function (x) { return { off: Math.abs(fps / (x[0] / x[1]) - 1), rate: x }; })
        .sort(function (x, y) { return x.off - y.off; })[0];

    // 2 s de carimbos nao separam 23,976 de 24 nem 29,97 de 30: entre os dois, vale o que o aparelho diz.
    RATES.forEach(function (x) {
        var twin = Math.abs(x[0] / x[1] / (found.rate[0] / found.rate[1]) - 1) < 0.002;

        if (twin && Math.abs(hint - x[0] / x[1]) < 0.015) { found.rate = x; }
    });
    if (found.off < 0.03) {
        var camera = Math.round(found.rate[0] / found.rate[1] * 1000) / 1000;
        var box = CONTAINER[camera] || [30, 1];

        NUM = box[0];
        DEN = box[1];
        LOCKED = Math.abs(camera - NUM / DEN) < 0.01;
    }
    self.postMessage({ medido: fps, ritmo: NUM / DEN, tipo: 'ritmo' });
}

/** Espera ate 2,5 s a camera mostrar o ritmo dela; sem camera, nao espera. */
function measure(hint) {
    var until = performance.now() + 2500;

    return new Promise(function (done) {
        (function wait() {
            var feed = feeds.get('camera');

            if (!feed || feed.stamps.length >= 60 || performance.now() > until) { cadence(hint); done(); } else { setTimeout(wait, 50); }
        }());
    });
}

/** Liga os dois codificadores; a resposta diz se este navegador grava. */
function prepare(readable, hint) {
    // O som e lido desde ja (o de antes do comeco e jogado fora): senao o comeco traria o que ficou na espera.
    audio.reader = readable.getReader();
    (function next() {
        audio.reader.read().then(function (result) { if (!result.done) { hear(result.value, 'mistura'); next(); } }).catch(function () { /* acabou */ });
    }());
    measure(hint).then(function () { open(); });
}

function open() {
    var v = { avc: { format: 'avc' }, bitrate: BITRATE, codec: 'avc1.64002a', framerate: NUM / DEN, hardwareAcceleration: 'prefer-hardware', height: H, latencyMode: 'realtime', width: W };
    var a = { bitrate: 160000, codec: 'mp4a.40.2', numberOfChannels: CHANNELS, sampleRate: RATE };

    Promise.all([VideoEncoder.isConfigSupported(v), AudioEncoder.isConfigSupported(a)]).then(function (ok) {
        if (!ok[0].supported || !ok[1].supported) { self.postMessage({ erro: 'este navegador não grava MP4', tipo: 'quebrou' }); return; }
        mp4 = { aac: null, audio: [], avcC: null, headed: false, needKey: false, seq: 1, sound: 0, video: [], warming: true };
        venc = new VideoEncoder({ error: broke, output: function (chunk, meta) {
            var index = Math.round(chunk.timestamp * NUM / DEN / 1e6);

            if (meta && meta.decoderConfig && meta.decoderConfig.description) { mp4.avcC = copyOf(meta.decoderConfig.description); }
            // O quadro que so acorda o codificador (a placa leva alguns segundos na primeira vez) nao entra no arquivo.
            if (mp4.warming) { return; }
            if (chunk.type === 'key') { cut(index); }
            mp4.video.push({ data: chunkBytes(chunk), key: chunk.type === 'key', slot: index });
        } });
        aenc = new AudioEncoder({ error: broke, output: function (chunk, meta) {
            if (meta && meta.decoderConfig && meta.decoderConfig.description) { mp4.aac = copyOf(meta.decoderConfig.description); }
            mp4.audio.push(chunkBytes(chunk));
        } });
        venc.configure(v);
        aenc.configure(a);
        var wake = new VideoFrame(canvas, { timestamp: 0 });

        venc.encode(wake, { keyFrame: true });
        wake.close();

        return venc.flush().then(function () {
            mp4.warming = false;
            mp4.needKey = true;
            startAt = performance.now();
            self.postMessage({ tipo: 'pronto' });
            beat();
        });
    }).catch(broke);
}

/** Termina o que esta nos codificadores, fecha o ultimo grupo e avisa. */
function end() {
    var v = venc;
    var a = aenc;

    if (timer) { clearTimeout(timer); timer = null; }
    venc = null;
    aenc = null;
    if (audio.reader) { audio.reader.cancel().catch(function () {}); }
    if (voice.reader) { voice.reader.cancel().catch(function () {}); voice.reader = null; }
    Array.from(feeds.keys()).forEach(drop);
    Promise.all([v, a].map(function (e) { return e && e.state === 'configured' ? e.flush() : null; })).catch(broke).then(function () {
        cut(slot);
        [v, a].forEach(function (e) { try { if (e && e.state !== 'closed') { e.close(); } } catch (x) { /* ja fechado */ } });
        self.postMessage({ tipo: 'acabou' });
    });
}

/** O relogio das casas: nunca acumula atraso; uma casa que passou sai logo depois (ate 5; alem disso, pula). */
function beat() {
    timer = null;
    if (!venc) { return; }
    watchVoice();
    var due = Math.floor((performance.now() - startAt) * NUM / DEN / 1000);

    follow();
    if (due - slot > 5) { counts.perdeu += due - slot - 5; slot = due - 5; }
    while (slot <= due) { emit(slot); slot += 1; }
    timer = setTimeout(beat, Math.max(1, startAt + slot * 1000 * DEN / NUM - performance.now()));
}

/**
 * A hora de uma imagem no relogio desta linha: o carimbo da captura (regular) levado ao relogio daqui pela menor
 * diferenca vista, que sobe devagar para acompanhar os dois relogios. Sem carimbo que ande, vale a hora da chegada.
 */
function hourOf(feed, frame) {
    var now = performance.now();
    var diff = now - frame.timestamp / 1000;

    if (feed.diff === null || diff < feed.diff || diff - feed.diff > 500) { feed.diff = diff; } else { feed.diff += 0.005; }

    return Math.min(now, frame.timestamp / 1000 + feed.diff);
}

function drop(id) {
    var feed = feeds.get(id);

    if (!feed) { return; }
    feeds.delete(id);
    if (feed.shown) { feed.shown.close(); }
    feed.queue.forEach(function (item) { item.frame.close(); });
    feed.reader.cancel().catch(function () {});
}

function pump(id, readable) {
    drop(id);
    if (!readable) { return; }
    var feed = { diff: null, queue: [], stamps: [], shownAt: 0, reader: readable.getReader(), shown: null };

    feeds.set(id, feed);
    (function next() {
        feed.reader.read().then(function (result) {
            if (feeds.get(id) !== feed) { if (result.value) { result.value.close(); } return; }
            if (result.done) { drop(id); return; }
            if (id === 'camera' && !startAt && feed.stamps.length < 61) { feed.stamps.push(result.value.timestamp); }
            feed.queue.push({ at: hourOf(feed, result.value), frame: result.value });
            // Nunca uma fila grande na espera: a captura para de entregar com imagens presas.
            if (feed.queue.length > (id === 'camera' ? 4 : 8)) { feed.queue.shift().frame.close(); }
            if (id === 'camera' || id === 'tela') { counts[id] += 1; }
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
        small = new OffscreenCanvas(32, 18);
        sctx = small.getContext('2d', { alpha: false });
        setInterval(function () {
            // O relogio do som, para o relatorio: quanto silencio entrou e a distancia do som para o video agora.
            counts.silencio = Math.round(audio.filled * 1000 / RATE);
            counts.som = audio.lead === null ? null : Math.round(audio.mean - audio.lead);
            counts.espera = Math.round(DELAY);
            self.postMessage({ contas: counts, tipo: 'contas' });
            counts = EMPTY();
        }, 5000);
    } else if (data.papel === 'comecar') {
        // Sem nenhuma imagem (camera desligada e sem tela), a gravacao segue com o preto, no mesmo ritmo.
        LATE = data.atraso || 0;
        prepare(data.audio, data.aparelho || 0);
    } else if (data.papel === 'voz') {
        listen(data.readable || null);
    } else if (data.papel === 'faixa') {
        pump(data.qual, data.readable || null);
    } else if (data.papel === 'pessoas') {
        people = data.pessoas;
    } else if (data.papel === 'fim') {
        end();
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
