/*
 * Bunker707: os participantes simulados desenhados pelo proprio motor de video (docs/30 D120; docs/31 §19).
 *
 * O custom-config.js desta instancia so carrega este arquivo no iframe do nosso app (a chave config.bunkerTheme no
 * hash) e no gravador (config.iAmRecorder=true no hash). Sem isso (uma sala aberta pelo endereco), ele nem entra.
 *
 * O que ele faz: poe na lista de participantes DESTE navegador as pessoas que a pagina manda, sem conexao nenhuma. O
 * motor desenha cada uma como desenha quem esta com a camera desligada (a foto ou as iniciais e o nome), na coluna e na
 * grade. Nada vai ao servidor por causa delas: elas nao tem faixa de audio nem de video, entao o pedido de video do
 * navegador continua sendo so o das pessoas de verdade (conferido no ensaio local com 300, docs/30 §6.9).
 *
 * De onde vem a lista:
 * - na sala do aluno, da pagina que montou o iframe: window.postMessage({ type, people }), aceito so de window.parent
 *   (quem pode montar este iframe e o frame-ancestors do Caddy: so as nossas origens);
 * - no console de quem modera, a pagina manda { type, people, relay: true }: este arquivo nao desenha nada ali e so
 *   repassa a lista ao gravador (o participante escondido), por uma mensagem de ponta so para ele;
 * - no gravador, da mensagem de ponta, aceita so de quem o Prosody marcou como moderador.
 *
 * A ordem (pedido do produtor de 13/11/2026): quem modera, os alunos de verdade na ordem do motor (quem fala e depois
 * o alfabeto), os simulados com foto e os simulados sem foto. A miniatura do proprio aluno e do motor, sempre a
 * primeira. Sem simulado nenhum, este arquivo nao toca na ordem.
 *
 * Os simulados nunca vao para o palco: levam botType, que o motor pula quando escolhe o video grande por falta de
 * opcao (large-video/actions.any.ts), e nunca falam nem tem video.
 *
 * Seletores e nomes de acao conferidos na tag fixada no .env.example (stable-11248): base/participants (as acoes
 * PARTICIPANT_JOINED, PARTICIPANT_UPDATED e PARTICIPANT_LEFT), filmstrip (SET_REMOTE_PARTICIPANTS e
 * remoteParticipants) e base/conference (conference). A cada troca de tag, o ensaio do docs/30 §6.9 se repete.
 * Tudo em try/catch: um erro aqui nunca derruba a sala. Nada daqui cita o motor na tela nem busca nada na rede.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || window.__bunker707Plateia) { return; }
    window.__bunker707Plateia = true;

    var MESSAGE = 'bunker707:plateia';
    var ID = /^sim[pg][0-9a-z]{1,16}$/;
    var MAX_PEOPLE = 300;
    var NAME_MAX = 60;
    var PHOTO_MAX = 512;
    var CHUNK = 100;
    var BOT = 'bunker707-plateia';

    var framed = false;
    try { framed = Boolean(window.parent && window.parent !== window); } catch (e) { framed = false; }

    // O que a pagina (ou o console, no gravador) pediu por ultimo, na ordem pedida.
    var wanted = [];
    // O que ja esta no motor: id -> { name, photo }.
    var applied = {};
    var appliedCount = 0;
    // A conferencia em que os simulados entraram (outra conferencia = o motor ja esqueceu todo mundo).
    var boundConference = null;
    // A ultima lista para o gravador (so no console de quem modera) e o numero do envio.
    var relayPeople = null;
    var relaySeq = 0;
    // As partes de uma lista que chega ao gravador.
    var incoming = null;
    // A ultima ordem vista: sem mudanca na lista do motor, nada e refeito.
    var lastOrder = null;
    var subscribed = false;
    // Enquanto a lista e trocada, a ordem espera: uma correcao so no fim, nunca uma por pessoa.
    var syncing = false;

    function store() {
        try { return (window.APP && window.APP.store) || null; } catch (e) { return null; }
    }

    function conferenceOf(state) {
        var slice = state && state['features/base/conference'];

        return (slice && slice.conference) || null;
    }

    /** A lista conferida: no maximo 300, id no nosso formato e sem repetir, nome de 1 a 60, foto so por https. */
    function clean(input) {
        if (!Array.isArray(input)) { return null; }
        var seen = {};
        var out = [];

        for (var i = 0; i < input.length && out.length < MAX_PEOPLE; i += 1) {
            var item = input[i];

            if (!item || typeof item.id !== 'string' || !ID.test(item.id) || seen[item.id]) { continue; }
            var name = typeof item.name === 'string' ? item.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';

            if (!name) { continue; }
            var photo = typeof item.photo === 'string' && item.photo.length <= PHOTO_MAX && /^https:\/\/[^\s"'<>]+$/.test(item.photo)
                ? item.photo : '';

            seen[item.id] = true;
            out.push({ id: item.id, name: name, photo: photo });
        }

        return out;
    }

    function dispatch(action) {
        var s = store();

        if (!s) { return; }
        try { s.dispatch(action); } catch (e) { /* um simulado que nao entrou nunca derruba a sala */ }
    }

    /** Poe no motor o que falta, tira o que saiu e troca o nome ou a foto que mudou. */
    function sync() {
        var s = store();

        if (!s) { return; }
        var state = s.getState();
        var conference = conferenceOf(state);

        if (!conference) { return; }
        if (conference !== boundConference) {
            // Sala nova (ou de novo): o motor comeca sem ninguem, e as escutas sao desta conferencia.
            applied = {};
            appliedCount = 0;
            lastOrder = null;
            incoming = null;
            boundConference = conference;
            bind(conference, state);
        }

        var next = {};
        var i;

        syncing = true;
        for (i = 0; i < wanted.length; i += 1) { next[wanted[i].id] = wanted[i]; }
        for (var id in applied) {
            if (Object.prototype.hasOwnProperty.call(applied, id) && !next[id]) {
                dispatch({ participant: { conference: conference, id: id }, type: 'PARTICIPANT_LEFT' });
                delete applied[id];
                appliedCount -= 1;
            }
        }
        for (i = 0; i < wanted.length; i += 1) {
            var person = wanted[i];
            var current = applied[person.id];

            if (!current) {
                dispatch({
                    participant: {
                        avatarURL: person.photo || undefined,
                        botType: BOT,
                        conference: conference,
                        id: person.id,
                        name: person.name,
                        role: 'participant'
                    },
                    type: 'PARTICIPANT_JOINED'
                });
                applied[person.id] = person;
                appliedCount += 1;
            } else if (current.name !== person.name || current.photo !== person.photo) {
                dispatch({
                    participant: { avatarURL: person.photo || undefined, conference: conference, id: person.id, name: person.name },
                    type: 'PARTICIPANT_UPDATED'
                });
                applied[person.id] = person;
            }
        }
        syncing = false;
        lastOrder = null;
        order();
    }

    /** A ordem pedida: quem modera, os alunos de verdade (na ordem do motor), os simulados com foto, os sem foto. */
    function order() {
        var s = store();

        if (!s || appliedCount === 0) { return; }
        var state = s.getState();
        var filmstrip = state['features/filmstrip'];
        var current = filmstrip && filmstrip.remoteParticipants;

        if (!Array.isArray(current) || current === lastOrder) { return; }
        var participants = state['features/base/participants'];
        var remote = participants && participants.remote;

        if (!remote || typeof remote.get !== 'function') { return; }
        var first = [];
        var real = [];
        var present = {};
        var i;

        for (i = 0; i < current.length; i += 1) {
            var id = current[i];

            if (applied[id]) { present[id] = true; continue; }
            var participant = remote.get(id);

            // Quem modera e as miniaturas que o motor inventa (a tela compartilhada) ficam em cima, na ordem dele.
            if (participant && (participant.role === 'moderator' || participant.fakeParticipant)) { first.push(id); } else { real.push(id); }
        }
        var withPhoto = [];
        var plain = [];

        for (i = 0; i < wanted.length; i += 1) {
            var person = wanted[i];

            if (present[person.id]) { (person.photo ? withPhoto : plain).push(person.id); present[person.id] = false; }
        }
        // Um simulado que ainda esta no motor e ja saiu da lista pedida fica no fim ate sair: nunca some da ordem.
        for (i = 0; i < current.length; i += 1) {
            if (present[current[i]]) { plain.push(current[i]); }
        }
        var next = first.concat(real, withPhoto, plain);
        var same = next.length === current.length;

        for (i = 0; same && i < next.length; i += 1) { same = next[i] === current[i]; }
        if (same) { lastOrder = current; return; }
        dispatch({ participants: next, type: 'SET_REMOTE_PARTICIPANTS' });
        var after = s.getState()['features/filmstrip'];

        lastOrder = (after && after.remoteParticipants) || null;
    }

    function isRecorder(state) {
        var config = state && state['features/base/config'];

        return Boolean(config && config.iAmRecorder);
    }

    /** As escutas da conferencia: no gravador, a lista que chega; no console de quem modera, o gravador que entra. */
    function bind(conference, state) {
        try {
            if (isRecorder(state)) {
                conference.on('conference.endpoint_message_received', function (participant, payload) {
                    try { receive(participant, payload); } catch (e) { /* mensagem torta: fica a lista de antes */ }
                });
            } else if (framed) {
                conference.on('conference.userJoined', function (id, user) {
                    try {
                        if (relayPeople && user && typeof user.isHidden === 'function' && user.isHidden()) {
                            // O gravador que acabou de entrar: a lista vai quando o canal dele ja abriu.
                            window.setTimeout(relay, 3000);
                        }
                    } catch (e) { /* sem o gravador, nada a repassar */ }
                });
            }
        } catch (e) { /* sem as escutas, a sala segue como antes */ }
    }

    /** No gravador: so quem o Prosody marcou como moderador manda a lista; as partes de um envio se juntam. */
    function receive(participant, payload) {
        if (!payload || payload.type !== MESSAGE) { return; }
        if (!participant || typeof participant.isModerator !== 'function' || !participant.isModerator()) { return; }
        var from = typeof participant.getId === 'function' ? String(participant.getId()) : '';
        var seq = Number(payload.seq);
        var parts = Number(payload.parts);
        var part = Number(payload.part);

        if (!(seq >= 0) || !(parts >= 1 && parts <= Math.ceil(MAX_PEOPLE / CHUNK)) || !(part >= 0 && part < parts) || !Array.isArray(payload.people)) { return; }
        if (!incoming || incoming.from !== from || incoming.seq !== seq || incoming.parts !== parts) {
            incoming = { from: from, got: 0, parts: parts, seq: seq, slots: [] };
        }
        if (!incoming.slots[part]) { incoming.got += 1; }
        incoming.slots[part] = payload.people;
        if (incoming.got < parts) { return; }
        var all = [];

        for (var i = 0; i < parts; i += 1) { all = all.concat(incoming.slots[i] || []); }
        incoming = null;
        var people = clean(all);

        if (!people) { return; }
        wanted = people;
        sync();
    }

    /** No console de quem modera: a lista vai so para o gravador (o participante escondido), em partes de 100. */
    function relay() {
        var s = store();

        if (!s || !relayPeople) { return; }
        var conference = conferenceOf(s.getState());

        if (!conference || typeof conference.getParticipants !== 'function' || typeof conference.sendEndpointMessage !== 'function') { return; }
        var targets = [];
        var all = conference.getParticipants();
        var i;

        for (i = 0; i < all.length; i += 1) {
            if (all[i] && typeof all[i].isHidden === 'function' && all[i].isHidden()) { targets.push(all[i].getId()); }
        }
        if (!targets.length) { return; }
        relaySeq += 1;
        var parts = Math.max(1, Math.ceil(relayPeople.length / CHUNK));

        for (i = 0; i < targets.length; i += 1) {
            for (var part = 0; part < parts; part += 1) {
                try {
                    conference.sendEndpointMessage(targets[i], {
                        part: part,
                        parts: parts,
                        people: relayPeople.slice(part * CHUNK, (part + 1) * CHUNK),
                        seq: relaySeq,
                        type: MESSAGE
                    });
                } catch (e) { /* o canal do gravador ainda nao abriu: o proximo envio leva */ }
            }
        }
    }

    function onMessage(event) {
        syncing = false;
        try {
            if (!framed || !event || event.source !== window.parent) { return; }
            var data = event.data;

            if (!data || data.type !== MESSAGE) { return; }
            var people = clean(data.people);

            if (!people) { return; }
            if (data.relay === true) {
                relayPeople = people;
                // Quem repassa nunca desenha: o console mostra so quem esta de verdade.
                if (wanted.length) { wanted = []; sync(); }
                relay();

                return;
            }
            relayPeople = null;
            wanted = people;
            sync();
        } catch (e) { /* mensagem torta: fica a lista de antes */ }
    }

    function onStoreChange() {
        try {
            var s = store();

            if (!s) { return; }
            var state = s.getState();

            if (conferenceOf(state) !== boundConference) {
                if (conferenceOf(state)) { sync(); } else { boundConference = null; applied = {}; appliedCount = 0; lastOrder = null; }

                return;
            }
            if (appliedCount > 0 && !syncing) { order(); }
        } catch (e) { /* a sala segue sem a ordem nossa */ }
    }

    /** O app sobe depois deste arquivo: espera o store e so entao escuta as mudancas dele. */
    function watch() {
        var s = store();

        if (subscribed) { return; }
        if (!s || typeof s.subscribe !== 'function') { window.setTimeout(watch, 500); return; }
        subscribed = true;
        try { s.subscribe(onStoreChange); } catch (e) { subscribed = false; window.setTimeout(watch, 2000); return; }
        sync();
    }

    try {
        window.addEventListener('message', onMessage);
        watch();
    } catch (e) { /* sem este arquivo, o motor segue como sempre */ }
})();
