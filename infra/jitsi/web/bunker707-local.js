/*
 * Bunker707: a gravacao no computador de quem apresenta (docs/30 D141). Carregado pelo custom-config.js (stable-11248) so
 * no iframe do nosso app; so faz alguma coisa no iframe de quem modera, e nunca no gravador. Grava direto da camera, da
 * tela compartilhada e do microfone deste navegador, antes de a imagem ser comprimida para a sala e passar pela internet:
 * - o video: a camera; ou a tela a esquerda e as cameras numa coluna a direita, nunca por cima, com quem mais estiver de
 *   camera ligada (bunker707-local-worker.js, papel "compor");
 * - o audio: o microfone (com o tratamento que a sala ja pediu; mudo na sala e mudo aqui) e as vozes que chegam da sala;
 * - o arquivo: MP4 (H.264) quando o navegador sabe, senao WebM, escrito no disco a cada 2 s (papel "gravar"). Sem a pasta
 *   privada do navegador, os pedacos ficam na memoria, com o aviso. Uma gravacao que ficou de uma aba fechada aparece
 *   para baixar ou apagar.
 * Usa as faixas do proprio motor, nunca uma copia: desligou a camera ou a tela na sala, ela some daqui e o aparelho apaga.
 * - com o console novo (docs/30 D142): a pagina que montou o iframe manda "ola" e passa a mandar: o painel daqui some, o
 *   console comeca e para, e cada pedaco vai para ela (window.postMessage, so para a origem que mandou o "ola"), que guarda
 *   no disco dela e envia para a Bunny. Quem pode montar este iframe e o frame-ancestors do Caddy: so as nossas origens.
 * Nada daqui fala com a rede. O estado mostra tambem o microfone em uso e o tratamento que o navegador aplicou.
 * Tudo em try/catch: um erro aqui nunca derruba a sala.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || window.__bunker707Local) { return; }
    window.__bunker707Local = true;

    var framed = false;

    try { framed = Boolean(window.parent && window.parent !== window); } catch (e) { framed = true; }
    if (!framed || !window.MediaRecorder || !window.MediaStreamTrackProcessor || !window.MediaStreamTrackGenerator || !window.Worker) { return; }

    var WORKER = '/libs/bunker707-local-worker.js?v=43341991';
    var PREFIX = 'gravacao-local-';
    var TYPES = ['video/mp4;codecs=avc1.64002a,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus'];
    var MESSAGE = 'bunker707:gravacao-local';
    // A origem da pagina que montou o iframe e mandou o "ola" (o console novo); nula, vale o painel daqui.
    var host = null;
    var rec = null;
    var panel = null;
    var ui = {};
    var left = [];
    var listed = false;

    function call(target, name) {
        try { return target && typeof target[name] === 'function' ? target[name]() : undefined; } catch (e) { return undefined; }
    }

    function conference() {
        try {
            var state = window.APP.store.getState();

            if (state['features/base/config'].iAmRecorder) { return null; }

            return state['features/base/conference'].conference || null;
        } catch (e) { return null; }
    }

    /** A faixa do navegador da camera, da tela ou do microfone deste participante, so se estiver no ar. */
    function localTrack(conf, kind) {
        var tracks = call(conf, 'getLocalTracks') || [];

        for (var i = 0; i < tracks.length; i += 1) {
            var video = call(tracks[i], 'getType') === 'video';
            var is = !video ? 'mic' : call(tracks[i], 'getVideoType') === 'desktop' ? 'tela' : 'camera';

            if (is === kind && call(tracks[i], 'isMuted') !== true) {
                var media = call(tracks[i], 'getTrack');

                if (media && media.readyState === 'live') { return media; }
            }
        }

        return null;
    }

    function remoteAudio(conf) {
        var out = [];
        var people = call(conf, 'getParticipants') || [];

        for (var i = 0; i < people.length; i += 1) {
            var tracks = call(people[i], 'getTracks') || [];

            for (var j = 0; j < tracks.length; j += 1) {
                var media = call(tracks[j], 'getType') === 'audio' ? call(tracks[j], 'getTrack') : null;

                if (media && media.readyState === 'live') { out.push(media); }
            }
        }

        return out;
    }

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function stampName() {
        var d = new Date();

        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    }

    /* ---- a gravacao ---- */

    function setVideo(r, kind, track) {
        if (r.video[kind] === track) { return; }
        r.video[kind] = track;
        if (!track) { r.composer.postMessage({ papel: 'faixa', qual: kind, readable: null }); return; }
        var readable = new window.MediaStreamTrackProcessor({ maxBufferSize: 2, track: track }).readable;

        r.composer.postMessage({ papel: 'faixa', qual: kind, readable: readable }, [readable]);
    }

    /** A camera de quem mais estiver no ar (no maximo 5), com o nome que a sala mostra. */
    function syncPeople(r, conf) {
        var list = [];
        var all = call(conf, 'getParticipants') || [];

        for (var i = 0; i < all.length && list.length < 5; i += 1) {
            var tracks = call(all[i], 'isHidden') === true ? [] : call(all[i], 'getTracks') || [];

            for (var j = 0; j < tracks.length; j += 1) {
                if (call(tracks[j], 'getType') !== 'video' || call(tracks[j], 'getVideoType') === 'desktop' || call(tracks[j], 'isMuted') === true) { continue; }
                var media = call(tracks[j], 'getTrack');

                if (media && media.readyState === 'live') { list.push({ id: 'p' + call(all[i], 'getId'), media: media, name: String(call(all[i], 'getDisplayName') || '') }); break; }
            }
        }
        Object.keys(r.video).forEach(function (id) { if (id.charAt(0) === 'p' && !list.some(function (p) { return p.id === id; })) { setVideo(r, id, null); delete r.video[id]; } });
        list.forEach(function (p) { setVideo(r, p.id, p.media); });
        var key = JSON.stringify(list.map(function (p) { return [p.id, p.name]; }));

        if (key !== r.people) { r.people = key; r.composer.postMessage({ papel: 'pessoas', pessoas: list.map(function (p) { return { id: p.id, name: p.name }; }) }); }
    }

    function syncAudio(r, conf) {
        var mic = localTrack(conf, 'mic');
        var want = (mic ? [mic] : []).concat(remoteAudio(conf));

        want.forEach(function (track) {
            if (r.audio.has(track)) { return; }
            try {
                var node = r.ctx.createMediaStreamSource(new window.MediaStream([track]));

                node.connect(r.mix);
                r.audio.set(track, node);
            } catch (e) { /* esta voz fica fora */ }
        });
        Array.from(r.audio.keys()).forEach(function (track) {
            if (want.indexOf(track) < 0) { try { r.audio.get(track).disconnect(); } catch (e) { /* ja solto */ } r.audio.delete(track); }
        });
        if (mic && mic !== r.mic) { r.mic = mic; r.notes.push('microfone: ' + micText(mic)); }
    }

    function micText(track) {
        var s = {};
        var c = {};

        try { s = track.getSettings(); } catch (e) { /* sem os ajustes */ }
        try { c = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { /* sem */ }

        return (track.label || 'sem nome') + ' | eco ' + s.echoCancellation + ', ruido ' + s.noiseSuppression + ', volume ' + s.autoGainControl
            + ', isolamento ' + (s.voiceIsolation === undefined ? 'nao informado' : s.voiceIsolation) + ' (pode: ' + (c.voiceIsolation ? c.voiceIsolation.join('/') : 'nao informado') + ')'
            + ', ' + s.sampleRate + ' Hz, ' + s.channelCount + ' canal';
    }

    function sync() {
        var conf = conference();

        if (!rec || !conf) { return; }
        try {
            setVideo(rec, 'camera', localTrack(conf, 'camera'));
            setVideo(rec, 'tela', localTrack(conf, 'tela'));
            syncPeople(rec, conf);
            syncAudio(rec, conf);
        } catch (e) { rec.notes.push('erro: ' + (e && e.name)); }
    }

    function start() {
        var conf = conference();

        if (rec || !conf) { return; }
        var type = TYPES.filter(function (t) { return window.MediaRecorder.isTypeSupported(t); })[0];

        if (!type) { say('Este navegador não grava vídeo. Use o Chrome.'); return; }
        var r = { audio: new Map(), bytes: 0, chunks: [], counts: [], mic: null, name: PREFIX + stampName() + (type.indexOf('mp4') > 0 ? '.mp4' : '.webm'), notes: ['formato: ' + type], pending: Promise.resolve(), startedAt: Date.now(), type: type, video: { camera: null, tela: null } };

        r.composer = new window.Worker(WORKER);
        r.remote = host !== null;
        r.disk = r.remote ? null : new window.Worker(WORKER);
        r.generator = new window.MediaStreamTrackGenerator({ kind: 'video' });
        r.ctx = new window.AudioContext({ latencyHint: 'playback', sampleRate: 48000 });
        r.mix = r.ctx.createMediaStreamDestination();
        // Uma fonte muda sempre ligada: com todos em silencio o audio do arquivo continua andando.
        var quiet = r.ctx.createConstantSource();
        var zero = r.ctx.createGain();

        zero.gain.value = 0;
        quiet.connect(zero).connect(r.mix);
        quiet.start();
        r.ctx.resume().catch(function () {});
        r.composer.postMessage({ papel: 'compor', writable: r.generator.writable }, [r.generator.writable]);
        r.composer.onmessage = function (e) { if (e.data.tipo === 'contas') { r.counts.push(e.data.contas); r.last = e.data.contas; } };
        if (r.disk) { r.disk.onmessage = function (e) {
            if (e.data.tipo === 'aberto') { r.onDisk = true; begin(r); }
            else if (e.data.tipo === 'escrito') { r.bytes = e.data.bytes; }
            else if (e.data.tipo === 'fechado') { finish(r); }
            else if (e.data.tipo === 'erro' && !r.started) { r.notes.push('sem a pasta do navegador (' + e.data.erro + '): na memória'); begin(r); }
            else if (e.data.tipo === 'erro') { r.notes.push('erro ao escrever: ' + e.data.erro); say('Erro ao salvar no disco: pare a gravação e baixe o arquivo.'); }
        }; }
        rec = r;
        if (r.remote) {
            tell({ formato: r.type, nome: r.name, tipo: 'abrir' });
            window.setTimeout(function () { if (rec === r && !r.started) { refuse(r, 'o console não abriu o arquivo'); } }, 8000);
        } else { r.disk.postMessage({ nome: r.name, papel: 'gravar' }); }
        sync();
    }

    function begin(r) {
        r.started = true;
        r.startedAt = Date.now();
        r.recorder = new window.MediaRecorder(new window.MediaStream([r.generator, r.mix.stream.getAudioTracks()[0]]), { audioBitsPerSecond: 160000, mimeType: r.type, videoBitsPerSecond: 8000000, videoKeyFrameIntervalDuration: 2000 });
        r.recorder.ondataavailable = function (e) {
            if (!e.data || !e.data.size) { return; }
            if (!r.remote && !r.onDisk) { r.chunks.push(e.data); r.bytes += e.data.size; return; }
            // Na ordem: cada pedaco so depois do anterior.
            r.pending = r.pending.then(function () { return e.data.arrayBuffer(); }).then(function (bytes) {
                if (!r.remote) { r.disk.postMessage({ bytes: bytes, papel: 'pedaco' }, [bytes]); return; }
                r.bytes += bytes.byteLength;
                tell({ bytes: bytes, nome: r.name, tipo: 'pedaco' }, [bytes]);
            });
        };
        r.recorder.onstop = function () { r.pending.then(function () { if (r.onDisk) { r.disk.postMessage({ papel: 'fechar' }); } else { finish(r); } }); };
        r.recorder.onstart = function () { if (r.remote) { tell({ nome: r.name, tipo: 'comecou' }); } };
        r.recorder.onerror = function (e) { r.notes.push('erro do gravador: ' + (e.error && e.error.name)); };
        r.recorder.start(2000);
        render();
    }

    function stop() {
        var r = rec;

        if (!r || !r.recorder || r.recorder.state === 'inactive') { return; }
        r.seconds = Math.round((Date.now() - r.startedAt) / 1000);
        r.recorder.stop();
        r.composer.postMessage({ papel: 'fim' });
    }

    function finish(r) {
        rec = null;
        release(r);
        var totals = { camera: 0, perdeu: 0, saiu: 0, tela: 0 };

        r.counts.forEach(function (c) { Object.keys(totals).forEach(function (k) { totals[k] += c[k]; }); });
        r.report = ['gravação no computador', r.name, 'duração ' + r.seconds + ' s, ' + Math.round(r.bytes / 1e6) + ' MB']
            .concat(r.notes, ['quadros: câmera ' + totals.camera + ', tela ' + totals.tela + ', gravados ' + totals.saiu + ', perdidos ' + totals.perdeu,
                'por 5 s (câmera/tela/gravados/perdidos): ' + r.counts.map(function (c) { return [c.camera, c.tela, c.saiu, c.perdeu].join('/'); }).join(' ')]).join('\n');
        if (r.remote) { tell({ nome: r.name, relatorio: r.report, segundos: r.seconds, tipo: 'fim' }); tellState(); return; }
        var ready = r.onDisk ? directory().then(function (d) { return d.getFileHandle(r.name); }).then(function (h) { return h.getFile(); }) : Promise.resolve(new window.Blob(r.chunks, { type: r.type }));

        ready.then(function (blob) { var item = { blob: blob, name: r.name, report: r.report, size: blob.size };

            left.unshift(item); render(); download(item); say('Gravação pronta: o arquivo foi para a pasta Downloads. Se não foi, clique em Baixar.'); }).catch(function () { say('Não consegui abrir o arquivo. Recarregue a sala: ele aparece aqui.'); });
        render();
    }

    function release(r) {
        try { r.composer.terminate(); if (r.disk) { r.disk.terminate(); } r.ctx.close(); } catch (e) { /* ja fechado */ }
    }

    /* ---- o console (docs/30 D142) ---- */

    /** So para a origem que mandou o "ola", nunca para qualquer uma. */
    function tell(message, transfer) {
        if (!host) { return; }
        message.type = MESSAGE;
        try { window.parent.postMessage(message, host, transfer || []); } catch (e) { /* a pagina saiu */ }
    }

    function tellState() {
        var conf = conference();
        var mic = localTrack(conf, 'mic');

        tell({
            bytes: rec ? rec.bytes : 0,
            gravando: Boolean(rec && rec.started),
            microfone: mic ? micText(mic) : null,
            nome: rec ? rec.name : null,
            perdidos: rec && rec.last ? rec.last.perdeu : 0,
            pode: call(conf, 'isModerator') === true,
            quadros: rec && rec.last ? Math.round(rec.last.saiu / 5) : null,
            segundos: rec && rec.started ? Math.round((Date.now() - rec.startedAt) / 1000) : 0,
            tipo: 'estado'
        });
    }

    /** Nao deu para comecar: solta tudo e conta o motivo. */
    function refuse(r, why) {
        if (rec === r) { rec = null; }
        release(r);
        tell({ motivo: why, nome: r.name, tipo: 'falhou' });
        tellState();
    }

    window.addEventListener('message', function (event) {
        var data = event.data;

        if (event.source !== window.parent || !data || typeof data !== 'object' || data.type !== MESSAGE) { return; }
        try {
            if (data.pedido === 'ola') {
                // Com uma gravacao do painel em curso, o painel segue ate ela acabar.
                if (rec && !rec.remote) { return; }
                host = event.origin;
                tellState();

                return;
            }
            if (event.origin !== host) { return; }
            if (data.pedido === 'comecar') {
                if (!rec && call(conference(), 'isModerator') === true) { start(); }
                if (!rec) { tell({ motivo: 'este navegador não grava a sala', nome: null, tipo: 'falhou' }); }
            } else if (data.pedido === 'parar') {
                if (rec && !rec.started) { refuse(rec, 'parada antes de começar'); } else { stop(); }
            } else if (rec && rec.remote && data.nome === rec.name && data.pedido === 'guardado' && !rec.started) { begin(rec); }
            else if (rec && rec.remote && data.nome === rec.name && data.pedido === 'sem-disco') {
                if (rec.started) { rec.notes.push('o console não conseguiu guardar'); stop(); } else { refuse(rec, 'sem espaço no disco'); }
            }
        } catch (e) { /* a sala segue */ }
    });

    /* ---- os arquivos que ficaram ---- */

    function directory() { return window.navigator.storage.getDirectory(); }

    function listOld() {
        if (listed) { return; }
        listed = true;
        directory().then(function (dir) {
            var it = dir.values();

            return (function next() {
                return it.next().then(function (step) {
                    if (step.done) { return null; }
                    var h = step.value;

                    if (h.kind !== 'file' || h.name.indexOf(PREFIX) !== 0 || (rec && rec.name === h.name)) { return next(); }

                    return h.getFile().then(function (f) { if (f.size > 0 && !left.some(function (x) { return x.name === f.name; })) { left.push({ blob: f, name: f.name, size: f.size }); } }).catch(function () {}).then(next);
                });
            }());
        }).then(render).catch(function () { /* sem a pasta do navegador */ });
    }

    function save(blob, name) {
        var a = window.document.createElement('a');
        var url = window.URL.createObjectURL(blob);

        a.href = url;
        a.download = name;
        a.click();
        window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 600000);
    }

    /** O video e, quando ha, o relatorio da gravacao. */
    function download(item) {
        save(item.blob, item.name);
        if (item.report) { window.setTimeout(function () { save(new window.Blob([item.report], { type: 'text/plain' }), item.name + '.txt'); }, 1500); }
    }

    /* ---- o painel ---- */

    function make(tag, style, text) {
        var el = window.document.createElement(tag);

        el.setAttribute('style', style);
        if (text) { el.textContent = text; }

        return el;
    }

    function button(text, onClick) {
        var b = make('button', 'min-height:40px;padding:0 16px;border-radius:8px;border:1px solid #777;background:#222;color:#fff;font:600 14px sans-serif;cursor:pointer', text);

        b.type = 'button';
        b.onclick = onClick;

        return b;
    }

    function say(text) { if (ui.note) { ui.note.textContent = text; } }

    function render() {
        if (!panel) { return; }
        ui.row.textContent = '';
        if (!rec) { ui.row.appendChild(button('Gravar no meu computador', start)); }
        else if (rec.recorder) { ui.row.appendChild(button('Parar a gravação no computador', stop)); }
        ui.files.textContent = '';
        left.forEach(function (item) {
            var line = make('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px');

            line.appendChild(make('span', 'font:12px sans-serif', item.name.replace(PREFIX, '') + ' (' + Math.round(item.size / 1e6) + ' MB)'));
            line.appendChild(button('Baixar', function () { download(item); }));
            line.appendChild(button('Apagar', function () {
                if (!window.confirm('Apagar ' + item.name + ' deste navegador? Baixe antes se ainda precisar.')) { return; }
                left = left.filter(function (x) { return x !== item; });
                directory().then(function (d) { return d.removeEntry(item.name); }).catch(function () {});
                render();
            }));
            ui.files.appendChild(line);
        });
    }

    function tick() {
        try {
            var conf = conference();
            var mod = call(conf, 'isModerator') === true;

            if (!panel && mod && window.document.body) {
                panel = make('div', 'position:fixed;left:12px;top:60px;z-index:2147483000;max-width:420px;padding:10px;border-radius:10px;background:rgba(0,0,0,.82);color:#fff');
                panel.id = 'bunker707-gravacao-local';
                ui.row = make('div', 'display:flex;gap:6px');
                ui.note = make('div', 'font:12px sans-serif;margin-top:6px;color:#ccc');
                ui.mic = make('div', 'font:11px sans-serif;margin-top:4px;color:#999');
                ui.files = make('div', '');
                [ui.row, ui.note, ui.mic, ui.files].forEach(function (el) { panel.appendChild(el); });
                window.document.body.appendChild(panel);
                render();
                listOld();
            }
            if (!panel) { return; }
            // Com o console mandando, o painel so aparece para os arquivos que ficaram aqui de antes.
            panel.style.display = host ? (left.length ? 'block' : 'none') : mod || rec ? 'block' : 'none';
            if (ui.row) { ui.row.style.display = host ? 'none' : 'flex'; }
            if (host) { tellState(); }
            var mic = localTrack(conf, 'mic');

            ui.mic.textContent = mic ? 'Microfone: ' + micText(mic) : 'Microfone desligado na sala.';
            if (rec && rec.recorder) {
                var s = Math.round((Date.now() - rec.startedAt) / 1000);

                say('Gravando ' + Math.floor(s / 60) + ':' + pad(s % 60) + ', ' + Math.round(rec.bytes / 1e6) + ' MB' + (rec.last ? ', ' + (rec.last.saiu / 5).toFixed(0) + ' quadros por segundo' + (rec.last.perdeu ? ', ' + rec.last.perdeu + ' perdidos' : '') : '') + (rec.onDisk ? '' : ' (na memória)'));
            }
            sync();
        } catch (e) { /* a sala segue */ }
    }

    window.addEventListener('beforeunload', function (e) { if (rec) { e.preventDefault(); e.returnValue = ''; } });
    window.setInterval(tick, 1000);
}());
