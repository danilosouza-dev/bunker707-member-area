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
 * Nomes conferidos na tag fixada no .env.example (stable-11248): os sinais conference.participant_property_changed,
 * conference.userJoined, conference.userLeft, conference.trackAdded, conference.trackRemoved e track.trackMuteChanged;
 * setLocalParticipantProperty, getProperty, getTracks, getVideoType, getSourceName e getOriginalStream da biblioteca;
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
    }

    try {
        window.addEventListener('message', onMessage);
        watch();
    } catch (e) { /* sem este arquivo, o motor segue como sempre */ }
})();
