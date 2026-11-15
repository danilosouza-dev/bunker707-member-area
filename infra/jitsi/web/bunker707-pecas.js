/*
 * Bunker707: as pecas da Live gravada em teste (docs/30 A62; docs/20 §8B.7). Pedido do produtor de 14/11/2026: "o
 * ideal e que o aluno pense realmente que esta em uma aula ao vivo". Em vez de um video so, o gravador guarda a camera
 * de quem apresenta com o audio e a tela compartilhada em pecas separadas, do mesmo tamanho (a tela fica preta quando
 * ninguem compartilha), mais a linha do tempo do palco, para a Live gravada remontar a live depois.
 *
 * Roda so no gravador (o carregador do custom-config.js liga este arquivo so com config.iAmRecorder=true no hash, que o
 * Jibri manda) e so na sala de um webinario ligado no receptor (GET /pecas/ativo, a lista ativas.txt do servidor C).
 * Fora disso nao faz nada, e a gravacao de sempre (a tela do Jibri, finalize.sh) nao muda em nenhum caso.
 *
 * Como: as faixas de quem apresenta (o moderador visivel) vao para dois canvas (1280x720 e 1920x1080), redesenhados
 * quando chega quadro novo e no minimo 5 vezes por segundo (preto sem a faixa), e dois MediaRecorder comecam no mesmo
 * instante: camera.webm (o canvas da camera + o audio, por uma faixa de WebAudio que existe o tempo todo) e tela.webm.
 * A qualidade recebida e pedida por cima da que a tela do gravador pede (a camera em 720p e a tela em 1080p; sem isso,
 * com a tela no palco, a camera chega em 180p). Os pedacos de 2 s vao em ordem ao receptor (infra/jitsi/pecas), no
 * mesmo endereco da sala, assinados com HMAC-SHA256 pela senha do usuario do gravador, que o proprio Jibri poe no
 * localStorage (xmpp_password_override). Nada de rede para a propria maquina: o Chrome 153 pediria permissao.
 *
 * O teste: os 2 primeiros minutos na sala sao a base (sem as pecas); depois as pecas e as medidas a cada 5 s
 * (quadros que chegam e que sao desenhados, a altura recebida, o atraso do caminho ate o canvas, a pressao de CPU e a
 * memoria), com o relogio de parede para casar com a CPU que o gravador anota (infra/cloud/jibri.sh).
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || window.__bunker707Pecas) { return; }
    window.__bunker707Pecas = { estado: 'esperando' };

    // A base dura 2 min; o ensaio local encurta pela variavel da pagina (o Jibri nunca a define).
    var BASE_MS = typeof window.__bunker707PecasBaseMs === 'number' ? window.__bunker707PecasBaseMs : 120000;
    var PEDACO_MS = 2000;
    var MEDIDA_MS = 5000;
    var MAX_MS = 4 * 60 * 60 * 1000;
    var CAM = { h: 720, w: 1280 };
    var SCR = { h: 1080, w: 1920 };
    var FPS = 30;
    var enc = new TextEncoder();
    var api = window.__bunker707Pecas;

    function hex(buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    }
    function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function percentil(xs, p) {
        if (!xs.length) { return null; }
        var s = xs.slice().sort(function (a, b) { return a - b; });
        return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
    }

    async function sala() {
        for (var i = 0; i < 600; i++) {
            var conf = window.APP && window.APP.conference;
            var room = conf && conf._room;
            if (room && typeof room.isJoined === 'function' && room.isJoined()) {
                var nome = String(conf.roomName || window.location.pathname.split('/').pop() || '').toLowerCase();
                return { nome: nome, room: room };
            }
            await esperar(500);
        }
        return null;
    }

    async function comecar() {
        var achada = await sala();
        if (!achada) { api.estado = 'sem-sala'; return; }
        var nome = achada.nome;
        var room = achada.room;
        var ativo = await fetch('/pecas/ativo?sala=' + encodeURIComponent(nome), { cache: 'no-store' }).then(function (r) { return r.status === 204; }, function () { return false; });
        if (!ativo) { api.estado = 'desligado'; return; }
        var senha = null;
        try { senha = window.localStorage.getItem('xmpp_password_override'); } catch (e) { senha = null; }
        if (!senha) { api.estado = 'sem-senha'; return; }
        var chave = await crypto.subtle.importKey('raw', enc.encode(senha), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
        api.estado = 'base';
        var entrouEm = Date.now();

        // ---- o envio: uma fila por arquivo, em ordem; uma falha que nao passa em 4 tentativas para a peca
        var enviados = {};
        function fila(arquivo) {
            var seq = 0;
            var cadeia = Promise.resolve();
            var parada = false;
            enviados[arquivo] = 0;
            async function um(corpo, n) {
                var buf = typeof corpo === 'string' ? enc.encode(corpo) : new Uint8Array(await corpo.arrayBuffer());
                var resumo = hex(await crypto.subtle.digest('SHA-256', buf));
                for (var tentativa = 0; tentativa < 4; tentativa++) {
                    var ts = Date.now();
                    var assinatura = hex(await crypto.subtle.sign('HMAC', chave, enc.encode(nome + '\n' + arquivo + '\n' + n + '\n' + ts + '\n' + resumo)));
                    try {
                        var r = await fetch('/pecas/' + encodeURIComponent(nome) + '/' + arquivo, {
                            body: buf,
                            cache: 'no-store',
                            headers: { 'Content-Type': 'application/octet-stream', 'X-Pecas-Assinatura': assinatura, 'X-Pecas-Seq': String(n), 'X-Pecas-Ts': String(ts) },
                            method: 'POST'
                        });
                        if (r.status === 204 || r.status === 200) { enviados[arquivo] += buf.length; return; }
                        if (r.status !== 429 && r.status < 500) { break; }
                    } catch (e) { /* a rede: tenta de novo */ }
                    await esperar(1000 * Math.pow(2, tentativa));
                }
                parada = true;
                api.erros = (api.erros || 0) + 1;
            }
            return function (corpo) {
                if (parada) { return; }
                var n = seq++;
                cadeia = cadeia.then(function () { return parada ? null : um(corpo, n); });
            };
        }
        var mandarLinha = fila('linha-do-tempo.jsonl');
        var mandarMedida = fila('metricas.jsonl');

        // ---- as faixas de quem apresenta
        function elemento(tag) {
            var el = document.createElement(tag);
            el.muted = true;
            el.autoplay = true;
            el.playsInline = true;
            el.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none';
            document.body.appendChild(el);
            return el;
        }
        var camVideo = elemento('video');
        var scrVideo = elemento('video');
        var audioEl = elemento('audio');
        var audioCtx = new AudioContext();
        var audioDest = audioCtx.createMediaStreamDestination();
        var audioFonte = null;
        var audioId = null;
        var estado = { cam: null, camMuda: true, scr: null };
        var fontes = { cam: null, scr: null };
        var sujo = true;
        var inicio = null;
        var linha = [];
        function marcar(kind, extra) {
            if (inicio === null) { return; }
            var item = Object.assign({ kind: kind, relogio: Date.now(), t: Math.round(performance.now() - inicio) }, extra || {});
            linha.push(item);
            mandarLinha(JSON.stringify(item) + '\n');
        }
        function apresentador() {
            var lista = room.getParticipants();
            for (var i = 0; i < lista.length; i++) {
                if (!lista[i].isHidden() && lista[i].getRole() === 'moderator') { return lista[i]; }
            }
            return null;
        }
        var pedido = null;
        var setOriginal = room.setReceiverConstraints.bind(room);
        function comNossas(c) {
            var out = Object.assign({}, c || {}, { constraints: Object.assign({}, (c && c.constraints) || {}) });
            var palco = new Set((c && c.onStageSources) || []);
            if (fontes.cam) { out.constraints[fontes.cam] = { maxHeight: CAM.h }; palco.add(fontes.cam); }
            if (fontes.scr) { out.constraints[fontes.scr] = { maxHeight: SCR.h }; palco.add(fontes.scr); }
            out.onStageSources = Array.from(palco);
            return out;
        }
        function pedirQualidade() {
            if (inicio === null) { return; }
            try { setOriginal(comNossas(pedido || { defaultConstraints: { maxHeight: 180 }, lastN: -1 })); } catch (e) { /* a tela do gravador pede de novo */ }
        }
        room.setReceiverConstraints = function (c) {
            pedido = c;
            return setOriginal(inicio === null ? c : comNossas(c));
        };
        function atualizar() {
            var p = apresentador();
            var faixas = p ? p.getTracks() : [];
            var cam = null, scr = null, aud = null;
            faixas.forEach(function (t) {
                if (t.getType() === 'audio') { aud = t; }
                else if (t.getVideoType() === 'desktop') { scr = t; }
                else if (t.getType() === 'video') { cam = t; }
            });
            if ((cam && cam.getTrack()) !== (estado.cam && estado.cam.getTrack())) {
                estado.cam = cam;
                camVideo.srcObject = cam ? new MediaStream([cam.getTrack()]) : null;
                if (cam) { camVideo.play().catch(function () {}); }
                sujo = true;
            }
            var muda = !cam || cam.isMuted();
            if (muda !== estado.camMuda) { estado.camMuda = muda; sujo = true; marcar(muda ? 'camera_off' : 'camera_on'); }
            var viva = scr && !scr.isMuted() ? scr : null;
            if ((viva && viva.getTrack()) !== (estado.scr && estado.scr.getTrack())) {
                var antes = Boolean(estado.scr);
                estado.scr = viva;
                scrVideo.srcObject = viva ? new MediaStream([viva.getTrack()]) : null;
                if (viva) { scrVideo.play().catch(function () {}); }
                sujo = true;
                if (Boolean(viva) !== antes) { marcar(viva ? 'screen_on' : 'screen_off'); }
            }
            fontes = { cam: cam && cam.getSourceName ? cam.getSourceName() : null, scr: scr && scr.getSourceName ? scr.getSourceName() : null };
            pedirQualidade();
            var faixa = aud ? aud.getTrack() : null;
            if ((faixa ? faixa.id : null) !== audioId) {
                audioId = faixa ? faixa.id : null;
                if (audioFonte) { audioFonte.disconnect(); }
                audioFonte = null;
                if (faixa) {
                    var s = new MediaStream([faixa]);
                    audioEl.srcObject = s; // o Chrome so entrega audio remoto ao WebAudio com um elemento tocando
                    audioFonte = audioCtx.createMediaStreamSource(s);
                    audioFonte.connect(audioDest);
                }
            }
        }
        var ev = window.JitsiMeetJS.events.conference;
        [ev.TRACK_ADDED, ev.TRACK_REMOVED, ev.TRACK_MUTE_CHANGED, ev.USER_JOINED, ev.USER_LEFT, ev.USER_ROLE_CHANGED].forEach(function (nomeEvento) {
            if (nomeEvento) { room.on(nomeEvento, atualizar); }
        });
        atualizar();

        // ---- as medidas: quadros que chegam, desenhados, altura, atraso ate o canvas, pressao e memoria
        var conta = { cam: 0, desenhoCam: 0, desenhoScr: 0, scr: 0 };
        var atrasos = { cam: [], scr: [] };
        var chegou = { cam: null, scr: null };
        function vigiar(video, k) {
            function quadro(agora) {
                conta[k]++;
                chegou[k] = agora;
                sujo = true;
                video.requestVideoFrameCallback(quadro);
            }
            video.requestVideoFrameCallback(quadro);
        }
        vigiar(camVideo, 'cam');
        vigiar(scrVideo, 'scr');
        var pressao = null;
        try {
            if (window.PressureObserver) {
                new window.PressureObserver(function (registros) { pressao = registros[registros.length - 1].state; }).observe('cpu', { sampleInterval: 1000 });
            }
        } catch (e) { pressao = null; }

        var camCanvas = Object.assign(document.createElement('canvas'), { height: CAM.h, width: CAM.w });
        var scrCanvas = Object.assign(document.createElement('canvas'), { height: SCR.h, width: SCR.w });
        var camCtx = camCanvas.getContext('2d');
        var scrCtx = scrCanvas.getContext('2d');
        function desenhar() {
            if (!sujo) { return; }
            sujo = false;
            var agora = performance.now();
            camCtx.fillStyle = '#000';
            camCtx.fillRect(0, 0, CAM.w, CAM.h);
            if (estado.cam && !estado.camMuda && camVideo.videoWidth > 0) {
                camCtx.drawImage(camVideo, 0, 0, CAM.w, CAM.h);
                conta.desenhoCam++;
                if (chegou.cam !== null) { atrasos.cam.push(agora - chegou.cam); chegou.cam = null; }
            }
            scrCtx.fillStyle = '#000';
            scrCtx.fillRect(0, 0, SCR.w, SCR.h);
            if (estado.scr && scrVideo.videoWidth > 0) {
                var s = Math.min(SCR.w / scrVideo.videoWidth, SCR.h / scrVideo.videoHeight);
                var w = scrVideo.videoWidth * s;
                var h = scrVideo.videoHeight * s;
                scrCtx.drawImage(scrVideo, (SCR.w - w) / 2, (SCR.h - h) / 2, w, h);
                conta.desenhoScr++;
                if (chegou.scr !== null) { atrasos.scr.push(agora - chegou.scr); chegou.scr = null; }
            }
        }
        setInterval(function () { sujo = true; }, 200);

        setInterval(function () {
            var item = {
                altura: { camera: camVideo.videoHeight || 0, tela: scrVideo.videoHeight || 0 },
                atrasoMs: { camera: [percentil(atrasos.cam, 0.5), percentil(atrasos.cam, 0.95)], tela: [percentil(atrasos.scr, 0.5), percentil(atrasos.scr, 0.95)] },
                bytes: Object.assign({}, enviados),
                desenhadosPorSegundo: { camera: +(conta.desenhoCam / (MEDIDA_MS / 1000)).toFixed(1), tela: +(conta.desenhoScr / (MEDIDA_MS / 1000)).toFixed(1) },
                erros: api.erros || 0,
                fase: inicio === null ? 'base' : 'pecas',
                memoriaMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
                pressao: pressao,
                quadrosPorSegundo: { camera: +(conta.cam / (MEDIDA_MS / 1000)).toFixed(1), tela: +(conta.scr / (MEDIDA_MS / 1000)).toFixed(1) },
                relogio: Date.now(),
                tela: Boolean(estado.scr)
            };
            conta = { cam: 0, desenhoCam: 0, desenhoScr: 0, scr: 0 };
            atrasos = { cam: [], scr: [] };
            mandarMedida(JSON.stringify(item) + '\n');
        }, MEDIDA_MS);

        // ---- as pecas, depois da base
        await esperar(Math.max(0, entrouEm + BASE_MS - Date.now()));
        audioCtx.resume().catch(function () {});
        setInterval(desenhar, 1000 / FPS);
        desenhar();
        var camStream = new MediaStream([camCanvas.captureStream(FPS).getVideoTracks()[0], audioDest.stream.getAudioTracks()[0]]);
        var scrStream = new MediaStream([scrCanvas.captureStream(FPS).getVideoTracks()[0]]);
        var gravadores = [
            [new MediaRecorder(camStream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 2500000 }), fila('camera.webm')],
            [new MediaRecorder(scrStream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4000000 }), fila('tela.webm')]
        ];
        gravadores.forEach(function (par) {
            par[0].ondataavailable = function (e) { if (e.data && e.data.size > 0) { par[1](e.data); } };
        });
        inicio = performance.now();
        gravadores.forEach(function (par) { par[0].start(PEDACO_MS); });
        api.estado = 'gravando';
        marcar('start', { camera: !estado.camMuda, screen: Boolean(estado.scr) });
        pedirQualidade();
        function parar() {
            if (api.estado !== 'gravando') { return; }
            api.estado = 'parado';
            marcar('stop');
            gravadores.forEach(function (par) { try { par[0].stop(); } catch (e) { /* ja parado */ } });
        }
        window.addEventListener('pagehide', parar);
        setTimeout(parar, MAX_MS);
        api.parar = parar;
    }

    comecar().catch(function () { api.estado = 'erro'; });
})();
