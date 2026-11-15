/*
 * Bunker707: as pecas da Live gravada em teste (docs/30 A62; docs/20 §8B.10). Pedido do produtor de 14/11/2026: "o
 * ideal e que o aluno pense realmente que esta em uma aula ao vivo". Em vez de um video so, o gravador guarda a camera
 * de quem apresenta com o audio e a tela compartilhada em pecas separadas, mais a linha do tempo do palco, para a Live
 * gravada remontar a live depois. Cada gravacao (cada vez que o gravador entra na sala) tem um id proprio e a sua pasta
 * no receptor; cada peca vem em partes (camera-1.webm, tela-1.webm...) e a linha do tempo diz quando cada parte comeca
 * (a marca `arquivo`).
 *
 * Dois jeitos de gravar, escolhidos por webinario na lista do receptor (o cabecalho X-Pecas-Modo do /pecas/ativo):
 * - `direto` (o padrao): o MediaRecorder grava a faixa recebida de quem apresenta, sem redesenhar; a camera com o
 *   audio numa parte, a tela noutra, que comeca no primeiro compartilhamento; uma parte nova quando a faixa muda. A
 *   camera desligada e a tela parada ficam sem quadros, e a linha do tempo diz o que mostrar.
 * - `canvas`: o jeito do primeiro teste, abaixo; no segundo teste em producao (15/11/2026) o canvas, sem placa de
 *   video, deixou so uns 10 quadros por segundo (os quadros chegam inteiros), e fica para comparar.
 *
 * Roda so no gravador (o carregador do custom-config.js liga este arquivo so com config.iAmRecorder=true no hash, que o
 * Jibri manda) e so na sala de um webinario ligado no receptor (GET /pecas/ativo, a lista ativas.txt do servidor C).
 * Fora disso nao faz nada, e a gravacao de sempre (a tela do Jibri, finalize.sh) nao muda em nenhum caso.
 *
 * No `canvas`: as faixas de quem apresenta (o moderador visivel) vao para dois canvas (1280x720 e 1920x1080), redesenhados a
 * cada quadro que chega (o leitor de quadros, MediaStreamTrackProcessor: o elemento de video escondido fora da tela so
 * avisa uns 5 quadros por segundo, o teste de 15/11/2026) e no minimo 1 vez por segundo (preto sem a faixa), e dois
 * MediaRecorder comecam no mesmo instante: camera.webm (o canvas da camera + o audio, por uma faixa de WebAudio que
 * existe o tempo todo) e tela.webm. A qualidade recebida e pedida por cima da que a tela do gravador pede, sem nunca
 * baixar a dela (a camera em pelo menos 720p e a tela em 1080p; sem isso, com a tela no palco, a camera chega em
 * 180p). Os pedacos de 1 s vao em ordem ao receptor (infra/jitsi/pecas), no
 * mesmo endereco da sala, assinados com HMAC-SHA256 pela senha do usuario do gravador. O Jibri da tag fixada manda essa
 * senha no endereco da sala (config.useHostPageLocalStorage=true e appData.localStorageContent, com o JSON codificado
 * duas vezes), e o Jitsi a guarda so na memoria: o localStorage de verdade fica vazio (o teste de 15/11/2026 parou ai,
 * sem nenhuma peca; docs/20 §8B.10). A senha vem do endereco, como o Jitsi le, e o localStorage fica de reserva. Nada
 * de rede para a propria maquina: o Chrome 153 pediria permissao.
 *
 * Cada passo vai ao receptor (GET /pecas/estado, sem segredo nenhum): na sala, sem senha, base, gravando, parado, e
 * cada envio recusado com o codigo. Uma falha no gravador de verdade deixa o motivo no log do receptor.
 *
 * O teste: os 2 primeiros minutos na sala sao a base (sem as pecas); depois as pecas e as medidas a cada 5 s
 * (quadros que chegam por tres medidas: o elemento de video, o leitor de quadros e as estatisticas da conexao
 * (getStats, os quadros recebidos, decodificados e descartados e a altura); os desenhados, o atraso do caminho ate o
 * canvas, a pressao de CPU e a memoria), com o relogio de parede para casar com a CPU que o gravador anota.
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || window.__bunker707Pecas) { return; }
    window.__bunker707Pecas = { estado: 'esperando' };

    // A base dura 2 min; o ensaio local encurta pela variavel da pagina (o Jibri nunca a define).
    var BASE_MS = typeof window.__bunker707PecasBaseMs === 'number' ? window.__bunker707PecasBaseMs : 120000;
    var PEDACO_MS = 1000;
    var MEDIDA_MS = 5000;
    var MAX_MS = 4 * 60 * 60 * 1000;
    var CAM = { h: 720, w: 1280 };
    var SCR = { h: 1080, w: 1920 };
    var FPS = 30;
    var enc = new TextEncoder();
    var api = window.__bunker707Pecas;
    // O endereco como chegou: o carregador do custom-config.js guarda antes de o Jitsi limpar (o hash de agora ja vem
    // sem as contas); sem ele, o hash deste instante.
    var enderecoInicial = String(window.__bunker707PecasEndereco || window.location.hash || '');

    function hex(buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    }
    function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function percentil(xs, p) {
        if (!xs.length) { return null; }
        var s = xs.slice().sort(function (a, b) { return a - b; });
        return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
    }

    // A senha do usuario do gravador: o appData.localStorageContent do endereco (o JSON das contas, codificado mais de uma
    // vez), como o proprio Jitsi le; sem ele, o localStorage, onde o Jibri de antes a punha.
    function senhaDoGravador() {
        var partes = (enderecoInicial + '&' + String(window.location.hash || '')).replace(/^#/, '').split('&');
        for (var i = 0; i < partes.length; i++) {
            var igual = partes[i].indexOf('=');
            if (igual < 0 || partes[i].slice(0, igual) !== 'appData.localStorageContent') { continue; }
            var valor = partes[i].slice(igual + 1);
            for (var volta = 0; volta < 6 && typeof valor === 'string'; volta++) {
                try { valor = JSON.parse(valor); continue; } catch (e) { /* ainda codificado no endereco */ }
                var antes = valor;
                try { valor = decodeURIComponent(valor); } catch (e2) { break; }
                if (valor === antes) { break; }
            }
            if (valor && typeof valor === 'object' && typeof valor.xmpp_password_override === 'string' && valor.xmpp_password_override) {
                return { de: 'endereco', senha: valor.xmpp_password_override };
            }
        }
        try {
            var guardada = window.localStorage.getItem('xmpp_password_override');
            if (guardada) { return { de: 'localStorage', senha: guardada }; }
        } catch (e3) { /* sem localStorage */ }
        return null;
    }

    // O id desta gravacao: o Jibri abre a pagina de novo a cada gravacao, e o Gravar de novo na mesma live nao pode
    // cair na pasta (nem na ordem dos pedacos) da anterior.
    var gravacao = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toLowerCase();
    api.gravacao = gravacao;

    // Cada passo ao receptor, sem segredo: o estado e um detalhe curto (o receptor so anota as salas da lista).
    var salaNome = String(window.location.pathname.split('/').pop() || '').toLowerCase();
    function avisar(estado, detalhe) {
        api.estado = estado;
        try {
            var url = '/pecas/estado?sala=' + encodeURIComponent(salaNome) + '&gravacao=' + gravacao + '&estado=' + encodeURIComponent(estado);
            if (detalhe) { url += '&detalhe=' + encodeURIComponent(String(detalhe).slice(0, 120)); }
            fetch(url, { cache: 'no-store', keepalive: true }).catch(function () {});
        } catch (e) { /* o aviso nunca atrapalha */ }
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
        if (!achada) { avisar('sem-sala'); return; }
        var nome = achada.nome;
        var room = achada.room;
        salaNome = nome;
        var modo = await fetch('/pecas/ativo?sala=' + encodeURIComponent(nome), { cache: 'no-store' }).then(function (r) {
            return r.status === 204 ? (r.headers && r.headers.get && r.headers.get('X-Pecas-Modo') === 'canvas' ? 'canvas' : 'direto') : null;
        }, function () { return null; });
        if (!modo) { api.estado = 'desligado'; return; }
        api.modo = modo;
        avisar('na-sala');
        var achou = senhaDoGravador();
        if (!achou) {
            avisar('sem-senha', 'appData no endereco: ' + (/appData\.localStorageContent=/.test(enderecoInicial) ? 'sim' : 'nao') + ', guardado pelo carregador: ' + (window.__bunker707PecasEndereco ? 'sim' : 'nao'));
            return;
        }
        var chave = await crypto.subtle.importKey('raw', enc.encode(achou.senha), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
        avisar('base', 'senha do ' + achou.de + ', jeito ' + modo);
        var entrouEm = Date.now();

        // ---- o envio: uma fila por arquivo, em ordem; uma falha que nao passa em 4 tentativas para a peca
        var enviados = {};
        function fila(arquivo) {
            var seq = 0;
            var cadeia = Promise.resolve();
            var parada = false;
            var ultimo = null;
            enviados[arquivo] = 0;
            async function um(corpo, n) {
                var buf = typeof corpo === 'string' ? enc.encode(corpo) : new Uint8Array(await corpo.arrayBuffer());
                var resumo = hex(await crypto.subtle.digest('SHA-256', buf));
                for (var tentativa = 0; tentativa < 4; tentativa++) {
                    var ts = Date.now();
                    var assinatura = hex(await crypto.subtle.sign('HMAC', chave, enc.encode(nome + '/' + gravacao + '\n' + arquivo + '\n' + n + '\n' + ts + '\n' + resumo)));
                    try {
                        var r = await fetch('/pecas/' + encodeURIComponent(nome) + '/' + gravacao + '/' + arquivo, {
                            body: buf,
                            cache: 'no-store',
                            headers: { 'Content-Type': 'application/octet-stream', 'X-Pecas-Assinatura': assinatura, 'X-Pecas-Seq': String(n), 'X-Pecas-Ts': String(ts) },
                            method: 'POST'
                        });
                        if (r.status === 204 || r.status === 200) { enviados[arquivo] += buf.length; return; }
                        ultimo = r.status;
                        if (r.status !== 429 && r.status < 500) { break; }
                    } catch (e) { ultimo = 'rede'; }
                    await esperar(1000 * Math.pow(2, tentativa));
                }
                parada = true;
                api.erros = (api.erros || 0) + 1;
                avisar('erro-envio', arquivo + ' pedaco ' + n + ': ' + ultimo);
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
            // Nunca abaixo do que a tela do gravador pede: sem a tela no palco, a camera vem em 1080p para a gravacao de
            // sempre, e o 720p das pecas nao pode baixar a dela (o teste de 15/11/2026 baixou).
            function pelo(fonte, altura) {
                var dela = out.constraints[fonte];
                var h = dela && typeof dela.maxHeight === 'number' ? dela.maxHeight : 0;
                out.constraints[fonte] = Object.assign({}, dela || {}, { maxHeight: Math.max(h, altura) });
                palco.add(fonte);
            }
            if (fontes.cam) { pelo(fontes.cam, CAM.h); }
            if (fontes.scr) { pelo(fontes.scr, SCR.h); }
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
        var aoMudar = null;
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
                ler('cam', cam ? cam.getTrack() : null);
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
                ler('scr', viva ? viva.getTrack() : null);
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
            if (aoMudar) { aoMudar(); }
        }
        // ---- o leitor de quadros: cada quadro decodificado da faixa, sem depender do elemento de video (escondido fora
        // da tela, ele avisa poucos quadros). Fica so o ultimo quadro aberto; o anterior e fechado na hora.
        var ultimo = { cam: null, scr: null };
        var leitores = { cam: null, scr: null };
        var contaLeitor = { cam: 0, scr: 0 };
        var conta = { cam: 0, desenhoCam: 0, desenhoScr: 0, scr: 0 };
        var atrasos = { cam: [], scr: [] };
        var chegou = { cam: null, scr: null };
        function ler(k, faixa) {
            if (leitores[k] && leitores[k].faixa === faixa) { return; }
            if (leitores[k]) { try { leitores[k].leitor.cancel(); } catch (e) { /* ja fechado */ } leitores[k] = null; }
            if (ultimo[k]) { ultimo[k].close(); ultimo[k] = null; }
            if (!faixa || typeof window.MediaStreamTrackProcessor !== 'function') { return; }
            var leitor;
            try { leitor = new window.MediaStreamTrackProcessor({ track: faixa }).readable.getReader(); } catch (e) { return; }
            var meu = { faixa: faixa, leitor: leitor };
            leitores[k] = meu;
            (async function () {
                for (;;) {
                    var r;
                    try { r = await leitor.read(); } catch (e) { return; }
                    if (r.done) { return; }
                    if (leitores[k] !== meu) { r.value.close(); return; }
                    if (ultimo[k]) { ultimo[k].close(); }
                    ultimo[k] = r.value;
                    contaLeitor[k]++;
                    chegou[k] = performance.now();
                    sujo = true;
                }
            })();
        }

        // ---- as estatisticas da conexao com o motor (getStats): o que de fato chega de quem apresenta, por faixa
        var anteriores = {};
        async function estatisticas() {
            var sessao = room.jvbJingleSession;
            var pc = sessao && sessao.peerconnection && sessao.peerconnection.peerconnection;
            if (!pc || typeof pc.getStats !== 'function') { return null; }
            var ids = {
                camera: estado.cam && estado.cam.getTrack() ? estado.cam.getTrack().id : null,
                tela: estado.scr && estado.scr.getTrack() ? estado.scr.getTrack().id : null
            };
            var relatorio = await pc.getStats();
            var saida = {};
            var segundos = MEDIDA_MS / 1000;
            relatorio.forEach(function (r) {
                if (r.type !== 'inbound-rtp' || r.kind !== 'video') { return; }
                var k = r.trackIdentifier && r.trackIdentifier === ids.camera ? 'camera' : (r.trackIdentifier && r.trackIdentifier === ids.tela ? 'tela' : null);
                var a = anteriores[r.id] || {};
                anteriores[r.id] = { d: r.framesDecoded || 0, p: r.packetsLost || 0, q: r.framesDropped || 0, r: r.framesReceived || 0 };
                if (!k) { return; }
                saida[k] = {
                    altura: r.frameHeight || 0,
                    decodificadosPorSegundo: +(((r.framesDecoded || 0) - (a.d || 0)) / segundos).toFixed(1),
                    descartados: (r.framesDropped || 0) - (a.q || 0),
                    fps: r.framesPerSecond || 0,
                    pacotesPerdidos: (r.packetsLost || 0) - (a.p || 0),
                    recebidosPorSegundo: +(((r.framesReceived || 0) - (a.r || 0)) / segundos).toFixed(1)
                };
            });
            return saida;
        }

        var ev = window.JitsiMeetJS.events.conference;
        [ev.TRACK_ADDED, ev.TRACK_REMOVED, ev.TRACK_MUTE_CHANGED, ev.USER_JOINED, ev.USER_LEFT, ev.USER_ROLE_CHANGED].forEach(function (nomeEvento) {
            if (nomeEvento) { room.on(nomeEvento, atualizar); }
        });
        atualizar();

        // ---- as medidas: quadros que chegam, desenhados, altura, atraso ate o canvas, pressao e memoria
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
            var fonteCam = ultimo.cam || (camVideo.videoWidth > 0 ? camVideo : null);
            if (estado.cam && !estado.camMuda && fonteCam) {
                camCtx.drawImage(fonteCam, 0, 0, CAM.w, CAM.h);
                conta.desenhoCam++;
                if (chegou.cam !== null) { atrasos.cam.push(agora - chegou.cam); chegou.cam = null; }
            }
            scrCtx.fillStyle = '#000';
            scrCtx.fillRect(0, 0, SCR.w, SCR.h);
            var fonteScr = ultimo.scr || (scrVideo.videoWidth > 0 ? scrVideo : null);
            if (estado.scr && fonteScr) {
                var largura = fonteScr.displayWidth || fonteScr.videoWidth;
                var altura = fonteScr.displayHeight || fonteScr.videoHeight;
                var s = Math.min(SCR.w / largura, SCR.h / altura);
                var w = largura * s;
                var h = altura * s;
                scrCtx.drawImage(fonteScr, (SCR.w - w) / 2, (SCR.h - h) / 2, w, h);
                conta.desenhoScr++;
                if (chegou.scr !== null) { atrasos.scr.push(agora - chegou.scr); chegou.scr = null; }
            }
        }
        setInterval(function () { sujo = true; }, 1000);

        setInterval(async function () {
            var conexao = null;
            try { conexao = await estatisticas(); } catch (e) { conexao = null; }
            var item = {
                altura: { camera: (ultimo.cam && ultimo.cam.displayHeight) || camVideo.videoHeight || 0, tela: (ultimo.scr && ultimo.scr.displayHeight) || scrVideo.videoHeight || 0 },
                atrasoMs: { camera: [percentil(atrasos.cam, 0.5), percentil(atrasos.cam, 0.95)], tela: [percentil(atrasos.scr, 0.5), percentil(atrasos.scr, 0.95)] },
                bytes: Object.assign({}, enviados),
                desenhadosPorSegundo: { camera: +(conta.desenhoCam / (MEDIDA_MS / 1000)).toFixed(1), tela: +(conta.desenhoScr / (MEDIDA_MS / 1000)).toFixed(1) },
                erros: api.erros || 0,
                fase: inicio === null ? 'base' : 'pecas',
                modo: modo,
                memoriaMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
                pressao: pressao,
                conexao: conexao,
                leitorPorSegundo: { camera: +(contaLeitor.cam / (MEDIDA_MS / 1000)).toFixed(1), tela: +(contaLeitor.scr / (MEDIDA_MS / 1000)).toFixed(1) },
                quadrosPorSegundo: { camera: +(conta.cam / (MEDIDA_MS / 1000)).toFixed(1), tela: +(conta.scr / (MEDIDA_MS / 1000)).toFixed(1) },
                relogio: Date.now(),
                tela: Boolean(estado.scr)
            };
            conta = { cam: 0, desenhoCam: 0, desenhoScr: 0, scr: 0 };
            contaLeitor = { cam: 0, scr: 0 };
            atrasos = { cam: [], scr: [] };
            mandarMedida(JSON.stringify(item) + '\n');
        }, MEDIDA_MS);

        // ---- as pecas, depois da base: cada peca em partes, e a marca `arquivo` na linha do tempo quando uma comeca
        await esperar(Math.max(0, entrouEm + BASE_MS - Date.now()));
        audioCtx.resume().catch(function () {});
        var audioFaixa = audioDest.stream.getAudioTracks()[0];
        var OPCOES = {
            camera: { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 2500000 },
            som: { mimeType: 'audio/webm;codecs=opus' },
            tela: { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4000000 }
        };
        var numero = { camera: 0, tela: 0 };
        var atuais = { camera: null, tela: null };
        var todos = [];
        function novaParte(tipo, faixaVideo, faixas, opcoes) {
            if (atuais[tipo]) { try { atuais[tipo].gravador.stop(); } catch (e) { /* ja parado */ } }
            numero[tipo]++;
            var arquivo = tipo + '-' + numero[tipo] + '.webm';
            var mandar = fila(arquivo);
            var gravador = new MediaRecorder(new MediaStream(faixas), opcoes);
            gravador.ondataavailable = function (e) { if (e.data && e.data.size > 0) { mandar(e.data); } };
            gravador.start(PEDACO_MS);
            atuais[tipo] = { faixa: faixaVideo, gravador: gravador };
            todos.push(gravador);
            marcar('arquivo', { arquivo: arquivo });
        }
        // No `direto`: a parte da camera segue a faixa da camera (sem ela, so a voz); a da tela comeca no primeiro
        // compartilhamento e segue a faixa da tela (parar de compartilhar so deixa a faixa sem quadros).
        function conferirPartes() {
            if (modo !== 'direto' || inicio === null || api.estado !== 'gravando') { return; }
            var cam = estado.cam ? estado.cam.getTrack() : null;
            if (!atuais.camera || atuais.camera.faixa !== cam) {
                novaParte('camera', cam, cam ? [cam, audioFaixa] : [audioFaixa], cam ? OPCOES.camera : OPCOES.som);
            }
            var scr = estado.scr ? estado.scr.getTrack() : null;
            if (scr && (!atuais.tela || atuais.tela.faixa !== scr)) {
                novaParte('tela', scr, [scr], OPCOES.tela);
            }
        }
        inicio = performance.now();
        avisar('gravando', 'camera ' + (estado.camMuda ? 'desligada' : 'ligada') + ', tela ' + (estado.scr ? 'ligada' : 'desligada'));
        marcar('start', { camera: !estado.camMuda, modo: modo, screen: Boolean(estado.scr) });
        if (modo === 'canvas') {
            setInterval(desenhar, 1000 / FPS);
            desenhar();
            novaParte('camera', null, [camCanvas.captureStream(FPS).getVideoTracks()[0], audioFaixa], OPCOES.camera);
            novaParte('tela', null, [scrCanvas.captureStream(FPS).getVideoTracks()[0]], OPCOES.tela);
        } else {
            aoMudar = conferirPartes;
            conferirPartes();
        }
        pedirQualidade();
        function parar() {
            if (api.estado !== 'gravando') { return; }
            avisar('parado', 'erros de envio: ' + (api.erros || 0) + ', partes: camera ' + numero.camera + ', tela ' + numero.tela);
            marcar('stop');
            todos.forEach(function (g) { try { g.stop(); } catch (e) { /* ja parado */ } });
        }
        window.addEventListener('pagehide', parar);
        setTimeout(parar, MAX_MS);
        api.parar = parar;
    }

    comecar().catch(function (e) { avisar('erro', (e && (e.name + ': ' + e.message)) || 'desconhecido'); });
})();
