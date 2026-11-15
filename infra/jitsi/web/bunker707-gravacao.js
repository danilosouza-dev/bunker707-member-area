/*
 * Bunker707: o modo da gravacao (docs/30 A63 e D125). Duas gravacoes, o mesmo gravador:
 * - "sala", a de sempre: o gravador grava a pagina do motor como ela e (o palco, as miniaturas);
 * - "tela", o Gravar para Live gravada: o video sai so com a tela compartilhada de quem modera, sem palco, sem
 *   miniatura, sem nome, preto quando ninguem compartilha, e com o audio so de quem modera.
 *
 * O custom-config.js desta instancia so carrega este arquivo no iframe do nosso app (a chave config.bunkerTheme no
 * hash) e no gravador (config.iAmRecorder=true no hash). Sem isso (uma sala aberta pelo endereco), ele nem entra.
 *
 * Como o modo chega ao gravador, sem corrida com a entrada dele na sala:
 * - no console de quem modera, a pagina manda { type: 'bunker707:gravacao', modo: 'tela' | 'sala' } antes de mandar
 *   gravar; este arquivo poe o modo numa propriedade do proprio participante (setLocalParticipantProperty), que vai na
 *   presenca dele para todos da sala, e o gravador que entra depois ja a encontra quando entra;
 * - no gravador, o modo e "tela" quando algum participante que o Prosody marcou como moderador tem a propriedade em
 *   "tela" (de aluno, nunca); decidido "tela", fica ate o fim desta pagina, que e uma gravacao so (cada Gravar abre a
 *   pagina do gravador de novo): o console que recarrega no meio nao muda o video. O gravador conta o modo que aplicou
 *   na propriedade dele, e o console avisa a pagina: { type: 'bunker707:gravacao-aplicada', modo }.
 *
 * No modo "tela", o gravador:
 * - cobre a pagina inteira com uma camada preta e, dentro dela, um video nosso so com a faixa da tela compartilhada
 *   mais recente de quem modera (a que o motor lista por ultimo em remoteScreenShares); sem tela, a camada fica preta;
 * - fixa essa tela no palco do motor (PIN_PARTICIPANT, so neste navegador), para ela chegar na qualidade do palco
 *   mesmo que a visao seguida de quem apresenta tenha outra pessoa no palco;
 * - zera o volume de quem nao modera (SET_VOLUME, so neste navegador): na gravacao fica so a voz de quem modera.
 *
 * A fluidez (docs/30 A65: o video gravado precisa de 30 quadros por segundo), medida a cada 10 s, so com um gravador na
 * sala e sem mudar nada no video:
 * - no gravador, uma linha "bunker707-fluidez ..." no console (o Jibri guarda no log do navegador, e o finalize.sh manda
 *   as linhas no aviso de fim): para cada video que chega, o codec, o decodificador, a altura, quantos quadros por
 *   segundo chegaram e quantos ele abriu, os descartados, o tempo para abrir cada quadro, os congelamentos e a espera
 *   no buffer; quantos quadros por segundo o video da pagina desenhou (a camada no modo tela, o palco do motor na sala)
 *   e quantas voltas de desenho a pagina deu; e o que cada moderador disse que esta enviando;
 * - no console de quem modera, o que o proprio navegador envia de cada video (a altura, os quadros por segundo e o que
 *   segura o envio: cpu, banda ou nada), numa propriedade do participante (bunkerEnvio), que o gravador escreve na linha.
 * So numeros e palavras curtas; nada de nome, conteudo ou endereco.
 *
 * Nomes conferidos na tag fixada no .env.example (stable-11248): os sinais conference.participant_property_changed,
 * conference.userJoined, conference.userLeft, conference.trackAdded, conference.trackRemoved e track.trackMuteChanged;
 * setLocalParticipantProperty, getProperty, getTracks, getVideoType, getSourceName, getOriginalStream, getLocalTracks e
 * jvbJingleSession.peerconnection.peerconnection (a conexao com o servidor, para o getStats) da biblioteca;
 * as acoes PIN_PARTICIPANT e SET_VOLUME; as fatias base/conference, base/config, large-video e video-layout. A cada
 * troca de tag, o ensaio do docs/30 A63 se repete. Tudo em try/catch: um erro aqui nunca derruba a sala nem a gravacao.
 * Nada daqui busca nada na rede; a unica mensagem para fora e a palavra do modo, para a pagina que montou o iframe.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || window.__bunker707Gravacao) { return; }
    window.__bunker707Gravacao = true;

    var MESSAGE = 'bunker707:gravacao';
    var APPLIED_MESSAGE = 'bunker707:gravacao-aplicada';
    // A propriedade do participante que modera (o pedido) e a do gravador (o que ele aplicou).
    var PROP = 'bunkerGravacao';
    var PROP_APPLIED = 'bunkerGravacaoAplicada';
    var MODES = { sala: true, tela: true };
    var LAYER_ID = 'bunker707-gravacao-tela';

    var framed = false;
    try { framed = Boolean(window.parent && window.parent !== window); } catch (e) { framed = false; }

    // No console: o modo que a pagina pediu por ultimo (nulo: nenhum pedido) e o ultimo aviso mandado a pagina.
    var wanted = null;
    var reported;
    // No gravador: o modo desta gravacao (nulo ate decidir), o que ja foi contado na propriedade, a tela na camada, a
    // tela fixada por este arquivo e quem teve o volume zerado.
    var mode = null;
    var announced = null;
    var shownSource = null;
    var pinnedSource = null;
    var pinnedAt = 0;
    var silenced = {};
    var layer = null;
    var video = null;
    // A conferencia em que as escutas estao (outra conferencia = escutar de novo).
    var boundConference = null;
    var subscribed = false;
    // A fluidez: o ultimo retrato de cada video (para a conta por segundo), os quadros desenhados, as voltas de desenho
    // e o ultimo envio contado na propriedade.
    var STATS_MS = 10000;
    var PROP_SENDING = 'bunkerEnvio';
    var lastIn = {};
    var lastOut = {};
    var paintCount = 0;
    var paintTarget = null;
    var paintQuality = null;
    var rafCount = 0;
    var sentReport = null;
    var measuring = false;

    function store() {
        try { return (window.APP && window.APP.store) || null; } catch (e) { return null; }
    }

    function conferenceOf(state) {
        var slice = state && state['features/base/conference'];

        return (slice && slice.conference) || null;
    }

    function isRecorder(state) {
        var config = state && state['features/base/config'];

        return Boolean(config && config.iAmRecorder);
    }

    function participantsOf(conference) {
        try { return (conference && typeof conference.getParticipants === 'function' && conference.getParticipants()) || []; } catch (e) { return []; }
    }

    function call(target, name) {
        try { return target && typeof target[name] === 'function' ? target[name]() : undefined; } catch (e) { return undefined; }
    }

    function dispatch(action) {
        var s = store();

        if (!s) { return; }
        try { s.dispatch(action); } catch (e) { /* uma acao que estoura nunca derruba a gravacao */ }
    }

    /* ---- no console de quem modera ---- */

    /** Poe o modo pedido na propriedade do proprio participante (vai na presenca: o gravador que entrar ja encontra). */
    function publish(conference) {
        if (!wanted || !conference || typeof conference.setLocalParticipantProperty !== 'function') { return; }
        try { conference.setLocalParticipantProperty(PROP, wanted); } catch (e) { /* a sala ainda nao entrou: vai na proxima mudanca */ }
    }

    /**
     * O modo que o gravador da sala aplicou (a propriedade do participante escondido), para a pagina mostrar. So no
     * iframe de quem modera (o console): o iframe do aluno nao avisa nada.
     */
    function report(conference) {
        if (!framed || call(conference, 'isModerator') !== true) { return; }
        var all = participantsOf(conference);
        var applied = null;

        for (var i = 0; i < all.length; i += 1) {
            var value = call(all[i], 'isHidden') ? readProperty(all[i], PROP_APPLIED) : null;

            if (value && MODES[value]) { applied = value; }
        }
        if (applied === reported) { return; }
        reported = applied;
        // So a palavra do modo (ou nulo) vai para fora; o pai e a pagina que montou o iframe (o frame-ancestors do Caddy).
        try { window.parent.postMessage({ modo: applied, type: APPLIED_MESSAGE }, '*'); } catch (e) { /* sem o aviso, o console segue */ }
    }

    function readProperty(participant, name) {
        try { return participant && typeof participant.getProperty === 'function' ? participant.getProperty(name) : null; } catch (e) { return null; }
    }

    function onMessage(event) {
        try {
            if (!framed || !event || event.source !== window.parent) { return; }
            var data = event.data;

            if (!data || data.type !== MESSAGE || !MODES[data.modo]) { return; }
            wanted = data.modo;
            var s = store();

            publish(s ? conferenceOf(s.getState()) : null);
        } catch (e) { /* mensagem torta: fica o pedido de antes */ }
    }

    /* ---- no gravador ---- */

    /** O modo desta gravacao: "tela" quando algum moderador pediu; decidido "tela", fica (sticky). */
    function decide(conference) {
        if (mode === 'tela') { return; }
        var all = participantsOf(conference);

        for (var i = 0; i < all.length; i += 1) {
            if (call(all[i], 'isModerator') === true && readProperty(all[i], PROP) === 'tela') {
                mode = 'tela';
                break;
            }
        }
        if (!mode && call(conference, 'isJoined') === true) { mode = 'sala'; }
        if (mode && announced !== mode && typeof conference.setLocalParticipantProperty === 'function') {
            try { conference.setLocalParticipantProperty(PROP_APPLIED, mode); announced = mode; } catch (e) { /* tenta na proxima mudanca */ }
        }
    }

    /** A tela compartilhada de quem modera: a mais recente da lista do motor; sem ela, a primeira que achar. */
    function screenOf(conference, state) {
        var all = participantsOf(conference);
        var found = {};
        var first = null;

        for (var i = 0; i < all.length; i += 1) {
            if (call(all[i], 'isModerator') !== true) { continue; }
            var tracks = call(all[i], 'getTracks') || [];

            for (var j = 0; j < tracks.length; j += 1) {
                var track = tracks[j];

                if (!track || call(track, 'getType') !== 'video' || call(track, 'getVideoType') !== 'desktop' || call(track, 'isMuted') === true) { continue; }
                var source = call(track, 'getSourceName');

                if (!source) { continue; }
                found[source] = track;
                if (!first) { first = source; }
            }
        }
        var layout = state && state['features/video-layout'];
        var order = (layout && layout.remoteScreenShares) || [];

        for (var k = order.length - 1; k >= 0; k -= 1) {
            if (found[order[k]]) { return { source: order[k], track: found[order[k]] }; }
        }

        return first ? { source: first, track: found[first] } : null;
    }

    /** A camada preta por cima da pagina inteira, com o video nosso dentro (criada uma vez). */
    function ensureLayer() {
        if (layer) { return; }
        var doc = window.document;

        layer = doc.createElement('div');
        layer.id = LAYER_ID;
        layer.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:#000;overflow:hidden;pointer-events:none');
        video = doc.createElement('video');
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000');
        layer.appendChild(video);
        (doc.body || doc.documentElement).appendChild(layer);
    }

    /** Mostra so a tela (ou o preto), fixa a tela no palco e deixa so a voz de quem modera. */
    function render(conference, state) {
        ensureLayer();
        var screen = screenOf(conference, state);
        var source = screen ? screen.source : null;

        if (source !== shownSource) {
            var stream = screen ? call(screen.track, 'getOriginalStream') : null;

            try { video.srcObject = stream || null; } catch (e) { /* sem a faixa, a camada fica preta */ }
            if (stream) { try { var playing = video.play(); if (playing && typeof playing.catch === 'function') { playing.catch(function () {}); } } catch (e) { /* toca no proximo quadro */ } }
            shownSource = stream ? source : null;
        }
        var large = state && state['features/large-video'];

        var now = Date.now();

        // Fixa a tela nova; se outra pessoa voltou ao palco (a visao seguida de quem apresenta), fixa de novo, no maximo
        // a cada 3 s (nunca um vai e volta a cada mudanca do store).
        if (source && (!large || large.participantId !== source) && (source !== pinnedSource || now - pinnedAt > 3000)) {
            pinnedSource = source;
            pinnedAt = now;
            dispatch({ participant: { id: source }, type: 'PIN_PARTICIPANT' });
        } else if (!source && pinnedSource) {
            // A tela saiu: solta a fixacao, para o motor nunca ficar preso a um participante que ja nao existe.
            pinnedSource = null;
            dispatch({ participant: { id: null }, type: 'PIN_PARTICIPANT' });
        }
        var all = participantsOf(conference);

        for (var i = 0; i < all.length; i += 1) {
            var id = call(all[i], 'getId');

            if (!id || call(all[i], 'isHidden') === true) { continue; }
            var moderator = call(all[i], 'isModerator') === true;

            if (!moderator && !silenced[id]) {
                silenced[id] = true;
                dispatch({ participantId: id, type: 'SET_VOLUME', volume: 0 });
            } else if (moderator && silenced[id]) {
                // Virou moderador no meio: a voz volta.
                silenced[id] = false;
                dispatch({ participantId: id, type: 'SET_VOLUME', volume: 1 });
            }
        }
    }

    /* ---- a fluidez (docs/30 A65) ---- */

    function round(value) { return Math.round(value * 10) / 10; }

    function peerConnectionOf(conference) {
        try {
            var session = conference && conference.jvbJingleSession;
            var tpc = session && session.peerconnection;

            return (tpc && tpc.peerconnection && typeof tpc.peerconnection.getStats === 'function' && tpc.peerconnection) || null;
        } catch (e) { return null; }
    }

    function hasRecorder(conference) {
        var all = participantsOf(conference);

        for (var i = 0; i < all.length; i += 1) { if (call(all[i], 'isHidden') === true) { return true; } }

        return false;
    }

    /** A faixa do motor pelo id da faixa do navegador: "tela" ou "camera", com * quando e de quem modera. */
    function labelOf(conference, trackId, local) {
        var lists = [];

        if (local) {
            lists.push({ moderator: true, tracks: call(conference, 'getLocalTracks') || [] });
        } else {
            var all = participantsOf(conference);

            for (var i = 0; i < all.length; i += 1) { lists.push({ moderator: call(all[i], 'isModerator') === true, tracks: call(all[i], 'getTracks') || [] }); }
        }
        for (var j = 0; j < lists.length; j += 1) {
            for (var k = 0; k < lists[j].tracks.length; k += 1) {
                var track = lists[j].tracks[k];
                var media = call(track, 'getTrack');

                if (media && media.id === trackId) {
                    return (call(track, 'getVideoType') === 'desktop' ? 'tela' : 'camera') + (lists[j].moderator && !local ? '*' : '');
                }
            }
        }

        return 'video';
    }

    /** Conta os quadros desenhados do video que vai para a gravacao (requestVideoFrameCallback) e as voltas de desenho. */
    function watchPaint(target) {
        if (!target || target === paintTarget || typeof target.requestVideoFrameCallback !== 'function') { return; }
        paintTarget = target;
        paintQuality = null;
        var onFrame = function () {
            if (paintTarget !== target) { return; }
            paintCount += 1;
            try { target.requestVideoFrameCallback(onFrame); } catch (e) { /* para de contar */ }
        };

        try { target.requestVideoFrameCallback(onFrame); } catch (e) { /* sem a conta */ }
    }

    function countRaf() {
        rafCount += 1;
        try { window.requestAnimationFrame(countRaf); } catch (e) { /* sem a conta */ }
    }

    /** No gravador: a linha da fluidez dos ultimos 10 s. */
    function measureRecorder(conference, pc) {
        var paintedNow = paintCount;
        var rafNow = rafCount;

        paintCount = 0;
        rafCount = 0;
        pc.getStats().then(function (report) {
            var codecs = {};
            var rows = [];

            report.forEach(function (r) { if (r.type === 'codec') { codecs[r.id] = String(r.mimeType || '').split('/')[1] || '?'; } });
            report.forEach(function (r) {
                if (r.type !== 'inbound-rtp' || r.kind !== 'video') { return; }
                var prev = lastIn[r.id];

                lastIn[r.id] = r;
                if (!prev || !(r.timestamp > prev.timestamp)) { return; }
                var dt = (r.timestamp - prev.timestamp) / 1000;
                var decoded = (r.framesDecoded || 0) - (prev.framesDecoded || 0);
                var received = (r.framesReceived || 0) - (prev.framesReceived || 0);

                if (decoded <= 0 && received <= 0) { return; }
                var emitted = (r.jitterBufferEmittedCount || 0) - (prev.jitterBufferEmittedCount || 0);

                rows.push([
                    labelOf(conference, r.trackIdentifier, false),
                    codecs[r.codecId] || '?',
                    String(r.decoderImplementation || '?').replace(/[^A-Za-z0-9_.()-]/g, ''),
                    (r.frameHeight || 0) + 'p',
                    'rec=' + round(received / dt),
                    'dec=' + round(decoded / dt),
                    'drop=' + ((r.framesDropped || 0) - (prev.framesDropped || 0)),
                    'ms=' + round(((r.totalDecodeTime || 0) - (prev.totalDecodeTime || 0)) * 1000 / Math.max(1, decoded)),
                    'fz=' + ((r.freezeCount || 0) - (prev.freezeCount || 0)),
                    'jb=' + Math.round(emitted > 0 ? ((r.jitterBufferDelay || 0) - (prev.jitterBufferDelay || 0)) * 1000 / emitted : 0)
                ].join(' '));
            });
            var lost = 0;

            if (paintTarget && typeof paintTarget.getVideoPlaybackQuality === 'function') {
                var q = paintTarget.getVideoPlaybackQuality();

                lost = paintQuality ? q.droppedVideoFrames - paintQuality.droppedVideoFrames : 0;
                paintQuality = q;
            }
            var sending = [];
            var all = participantsOf(conference);

            for (var i = 0; i < all.length; i += 1) {
                var text = call(all[i], 'isModerator') === true ? readProperty(all[i], PROP_SENDING) : null;

                if (typeof text === 'string' && /^[a-z0-9:.,]{1,200}$/.test(text)) { sending.push(text); }
            }
            var head = 't=' + Math.round(Date.now() / 1000) + ' m=' + (mode || '?') + ' pintou=' + round(paintedNow / (STATS_MS / 1000)) + ' perdeu=' + lost + ' raf=' + round(rafNow / (STATS_MS / 1000));

            // Uma linha so, sem aspas nem barra invertida: o finalize.sh a tira do log do navegador como texto.
            console.log('bunker707-fluidez ' + [head].concat(rows).concat(sending.length ? ['envio ' + sending.join(';')] : []).join(' | '));
        }).catch(function () { /* sem a medida desta vez */ });
    }

    /** No console de quem modera: o que este navegador envia, na propriedade lida pelo gravador. */
    function measureSender(conference, pc) {
        pc.getStats().then(function (report) {
            var sources = {};
            var best = {};

            report.forEach(function (r) { if (r.type === 'media-source' && r.kind === 'video') { sources[r.id] = r.trackIdentifier; } });
            report.forEach(function (r) {
                if (r.type !== 'outbound-rtp' || r.kind !== 'video' || r.active === false) { return; }
                var prev = lastOut[r.id];

                lastOut[r.id] = r;
                var fps = typeof r.framesPerSecond === 'number' ? r.framesPerSecond : prev && r.timestamp > prev.timestamp ? ((r.framesSent || 0) - (prev.framesSent || 0)) * 1000 / (r.timestamp - prev.timestamp) : 0;

                if (!(fps > 0)) { return; }
                var label = labelOf(conference, sources[r.mediaSourceId], true);
                var current = best[label];

                if (!current || (r.frameHeight || 0) > current.height) {
                    best[label] = { fps: fps, height: r.frameHeight || 0, reason: String(r.qualityLimitationReason || 'none').replace(/[^a-z]/g, '') };
                }
            });
            var parts = [];

            Object.keys(best).sort().forEach(function (label) { parts.push(label + ':' + best[label].height + 'p:' + Math.round(best[label].fps) + 'fps:' + best[label].reason); });
            var text = parts.join(',');

            if (text && text !== sentReport && typeof conference.setLocalParticipantProperty === 'function') {
                sentReport = text;
                conference.setLocalParticipantProperty(PROP_SENDING, text);
            }
        }).catch(function () { /* sem a medida desta vez */ });
    }

    /** A cada 10 s, com um gravador na sala: o gravador escreve a linha; o console de quem modera conta o envio. */
    function measure() {
        try {
            var s = store();
            var state = s && s.getState();
            var conference = conferenceOf(state);
            var pc = peerConnectionOf(conference);

            if (!conference || !pc) { return; }
            if (isRecorder(state)) {
                var layerVideo = mode === 'tela' ? video : null;

                watchPaint(layerVideo || (window.document && window.document.getElementById('largeVideo')));
                measureRecorder(conference, pc);
            } else if (framed && call(conference, 'isModerator') === true && hasRecorder(conference)) {
                measureSender(conference, pc);
            }
        } catch (e) { /* a medida nunca mexe na sala */ }
    }

    function startMeasuring() {
        if (measuring || typeof window.setInterval !== 'function') { return; }
        measuring = true;
        try { window.setInterval(measure, STATS_MS); } catch (e) { measuring = false; return; }
        try { if (typeof window.requestAnimationFrame === 'function') { window.requestAnimationFrame(countRaf); } } catch (e) { /* sem a conta */ }
    }

    /* ---- os dois ---- */

    function bind(conference, state) {
        var recorder = isRecorder(state);
        var again = function () { try { update(); } catch (e) { /* a proxima mudanca refaz */ } };
        var events = recorder
            ? ['conference.participant_property_changed', 'conference.userJoined', 'conference.userLeft', 'conference.trackAdded', 'conference.trackRemoved', 'track.trackMuteChanged', 'conference.joined']
            : ['conference.participant_property_changed', 'conference.userJoined', 'conference.userLeft'];

        for (var i = 0; i < events.length; i += 1) {
            try { conference.on(events[i], again); } catch (e) { /* sem a escuta, a mudanca do store refaz */ }
        }
    }

    function update() {
        var s = store();

        if (!s) { return; }
        var state = s.getState();
        var conference = conferenceOf(state);

        if (!conference) { return; }
        if (conference !== boundConference) {
            boundConference = conference;
            // A conferencia de novo na mesma pagina (a conexao voltou): o gravador conta o modo de novo na presenca nova,
            // e o modo desta gravacao continua o mesmo.
            announced = null;
            bind(conference, state);
            // Sala nova (ou de novo) no console: o pedido vai de novo na presenca nova.
            if (!isRecorder(state)) { publish(conference); }
        }
        if (isRecorder(state)) {
            decide(conference);
            if (mode === 'tela') { render(conference, state); }

            return;
        }
        report(conference);
    }

    function onStoreChange() {
        try { update(); } catch (e) { /* a sala segue como antes */ }
    }

    /** O app sobe depois deste arquivo: espera o store e so entao escuta as mudancas dele. */
    function watch() {
        var s = store();

        if (subscribed) { return; }
        if (!s || typeof s.subscribe !== 'function') { window.setTimeout(watch, 500); return; }
        subscribed = true;
        try { s.subscribe(onStoreChange); } catch (e) { subscribed = false; window.setTimeout(watch, 2000); return; }
        onStoreChange();
        startMeasuring();
    }

    try {
        window.addEventListener('message', onMessage);
        watch();
    } catch (e) { /* sem este arquivo, o motor segue como sempre */ }
})();
