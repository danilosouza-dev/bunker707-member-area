/*
 * A previa da Live gravada remontada a partir das pecas (docs/30 A62; docs/20 §8B.10), so para a equipe, servida pelo
 * receptor com o link assinado. Nao e a sala do aluno (a entrega 2): e o jeito de ver, com as pecas de um teste, se a
 * remontagem fica como ao vivo.
 *
 * A camera (com a voz) manda e a tela segue: a diferenca entre as duas e corrigida pela velocidade da tela (de 0,8 a
 * 1,2) e, acima de 0,5 s, com um pulo; quando a tela esta no palco e para para carregar, a camera espera. A linha do
 * tempo diz o que aparece em cada instante: sem a tela, a camera no palco; com a tela, a tela no palco e a camera na
 * coluna ao lado; a camera desligada vira o cartao "Camera desligada". Cada peca vem em partes (camera-1.webm,
 * tela-1.webm...), e a marca `arquivo` diz quando cada uma comeca: o relogio e o da linha do tempo, e cada video toca a
 * parte que cobre o instante.
 */
(function (raiz) {
    'use strict';

    /** As marcas da linha do tempo (uma por linha, JSON), em ordem de tempo. */
    function lerLinha(texto) {
        return String(texto || '')
            .split('\n')
            .map(function (l) { try { return l.trim() ? JSON.parse(l) : null; } catch (e) { return null; } })
            .filter(function (m) { return m && typeof m.t === 'number' && typeof m.kind === 'string'; })
            .sort(function (a, b) { return a.t - b.t; });
    }

    /** O palco no instante `ms` (desde o comeco das pecas): a tela ligada? a camera ligada? */
    function estadoEm(marcas, ms) {
        var estado = { camera: true, tela: false };
        for (var i = 0; i < marcas.length; i++) {
            var m = marcas[i];
            if (m.t > ms) { break; }
            if (m.kind === 'start') {
                if (typeof m.camera === 'boolean') { estado.camera = m.camera; }
                if (typeof m.screen === 'boolean') { estado.tela = m.screen; }
            } else if (m.kind === 'screen_on') { estado.tela = true; }
            else if (m.kind === 'screen_off') { estado.tela = false; }
            else if (m.kind === 'camera_on') { estado.camera = true; }
            else if (m.kind === 'camera_off') { estado.camera = false; }
        }
        return estado;
    }

    /**
     * A correcao da tela pela camera: `diferenca` = tela - camera, em segundos. Acima de 0,5 s, pula para a camera;
     * de 0,04 a 0,5 s, anda mais devagar (tela na frente) ou mais depressa (tela atras), entre 0,8 e 1,2; abaixo, 1.
     */
    function correcao(diferenca) {
        var d = Number(diferenca) || 0;
        if (Math.abs(d) > 0.5) { return { pular: true, taxa: 1 }; }
        if (Math.abs(d) < 0.04) { return { pular: false, taxa: 1 }; }
        return { pular: false, taxa: Math.max(0.8, Math.min(1.2, 1 - d)) };
    }

    /** As partes de uma peca ('camera' ou 'tela') pelas marcas `arquivo`; sem marca nenhuma, a parte 1 desde o comeco. */
    function partes(marcas, tipo) {
        var lista = marcas
            .filter(function (m) { return m.kind === 'arquivo' && typeof m.arquivo === 'string' && m.arquivo.indexOf(tipo + '-') === 0; })
            .map(function (m) { return { arquivo: m.arquivo, t: m.t }; });
        return lista.length || marcas.some(function (m) { return m.kind === 'arquivo'; }) ? lista : [{ arquivo: tipo + '-1.webm', t: 0 }];
    }

    /** A parte que cobre o instante `ms`: a ultima que comecou ate ele; antes da primeira, nenhuma. */
    function parteEm(lista, ms) {
        var achada = null;
        for (var i = 0; i < lista.length; i++) { if (lista[i].t <= ms) { achada = lista[i]; } }
        return achada;
    }

    /** 125 -> "2:05". */
    function relogio(segundos) {
        var s = Math.max(0, Math.floor(Number(segundos) || 0));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    var api = { correcao: correcao, estadoEm: estadoEm, lerLinha: lerLinha, parteEm: parteEm, partes: partes, relogio: relogio };
    raiz.__previa = api;
    if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('previa')) { return; }

    // ---- a pagina
    var busca = window.location.search;
    var caminho = window.location.pathname.split('/').filter(Boolean);
    var base = '/' + caminho.slice(0, 4).join('/') + '/';
    var url = function (arquivo) { return base + arquivo + busca; };
    var cam = document.getElementById('camera');
    var tela = document.getElementById('tela');
    var palco = document.getElementById('previa');
    var botao = document.getElementById('tocar');
    var barra = document.getElementById('barra');
    var tempo = document.getElementById('tempo');
    var medidas = document.getElementById('medidas');
    var marcas = [];
    var partesCam = [];
    var partesTela = [];
    var parteCam = null;
    var parteTela = null;
    var total = 0;
    var diferencas = [];

    /** O instante da linha do tempo (ms): a parte da camera que toca mais o tempo dela. */
    function agora() { return (parteCam ? parteCam.t : 0) + cam.currentTime * 1000; }

    function carregar(video, parte, ms, tocar) {
        video.src = url(parte.arquivo);
        video.addEventListener('loadedmetadata', function () {
            video.currentTime = Math.max(0, (ms - parte.t) / 1000);
            if (tocar) { video.play().catch(function () {}); }
        }, { once: true });
    }

    function irPara(ms, tocar) {
        var c = parteEm(partesCam, ms) || partesCam[0];
        if (c !== parteCam) { parteCam = c; carregar(cam, c, ms, tocar); } else { cam.currentTime = Math.max(0, (ms - c.t) / 1000); }
        conferirTela(ms, tocar);
    }

    function conferirTela(ms, tocar) {
        var t = parteEm(partesTela, ms);
        if (t && t !== parteTela) { parteTela = t; carregar(tela, t, ms, tocar); }
        if (!t) { parteTela = null; }
    }

    function aplicar(ms) {
        var e = estadoEm(marcas, ms);
        palco.dataset.tela = e.tela && parteTela ? 'ligada' : 'desligada';
        palco.dataset.camera = e.camera ? 'ligada' : 'desligada';
        return e;
    }

    function seguir() {
        var ms = agora();
        // A proxima parte da camera comecou: troca, sem parar.
        var proxima = parteEm(partesCam, ms);
        if (proxima && proxima !== parteCam) { irPara(ms, !cam.paused); }
        conferirTela(ms, !cam.paused);
        var e = aplicar(ms);
        if (parteTela && !cam.paused && !cam.seeking && !tela.seeking && tela.readyState > 0) {
            var d = tela.currentTime - (ms - parteTela.t) / 1000;
            var c = correcao(d);
            if (c.pular) { tela.currentTime = Math.max(0, (ms - parteTela.t) / 1000); }
            tela.playbackRate = c.taxa;
            if (e.tela) { diferencas.push(Math.abs(d)); }
        }
        barra.max = String(total / 1000);
        barra.value = String(ms / 1000);
        tempo.textContent = relogio(ms / 1000) + ' / ' + relogio(total / 1000);
        if (diferencas.length) {
            var ord = diferencas.slice().sort(function (a, b) { return a - b; });
            medidas.textContent = 'Tela x câmera com a tela no palco: mediana ' + Math.round(ord[Math.floor(ord.length / 2)] * 1000) + ' ms, pior ' + Math.round(ord[ord.length - 1] * 1000) + ' ms';
        }
        window.requestAnimationFrame(seguir);
    }

    // A camera espera a tela no palco carregar: essa pausa nao pausa a tela (senao as duas esperam uma pela outra).
    var esperandoTela = false;
    cam.addEventListener('waiting', function () { tela.pause(); });
    cam.addEventListener('playing', function () { if (parteTela) { tela.play().catch(function () {}); } });
    cam.addEventListener('pause', function () { if (!esperandoTela) { tela.pause(); } botao.textContent = esperandoTela ? 'Carregando…' : 'Tocar'; });
    cam.addEventListener('play', function () { botao.textContent = 'Pausar'; });
    tela.addEventListener('waiting', function () {
        if (esperandoTela || cam.paused || !aplicar(agora()).tela) { return; }
        esperandoTela = true;
        cam.pause();
    });
    tela.addEventListener('playing', function () {
        if (!esperandoTela) { return; }
        esperandoTela = false;
        cam.play().catch(function () {});
    });
    botao.addEventListener('click', function () {
        if (esperandoTela) { esperandoTela = false; tela.pause(); botao.textContent = 'Tocar'; return; }
        if (cam.paused) { cam.play().catch(function () {}); } else { cam.pause(); }
    });
    barra.addEventListener('input', function () { irPara(Number(barra.value) * 1000, !cam.paused); });

    fetch(url('linha-do-tempo.jsonl'), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (texto) {
            marcas = lerLinha(texto);
            partesCam = partes(marcas, 'camera');
            partesTela = partes(marcas, 'tela');
            var fim = marcas.filter(function (m) { return m.kind === 'stop'; }).pop();
            total = fim ? fim.t : (marcas.length ? marcas[marcas.length - 1].t : 0);
            var lista = document.getElementById('trocas');
            var nomes = { camera_off: 'câmera desligada', camera_on: 'câmera ligada', screen_off: 'tela desligada', screen_on: 'tela ligada', start: 'começo', stop: 'fim' };
            lista.textContent = marcas.filter(function (m) { return m.kind !== 'arquivo'; }).map(function (m) { return relogio(m.t / 1000) + ' ' + (nomes[m.kind] || m.kind); }).join(' · ');
            irPara(0, false);
            cam.addEventListener('loadedmetadata', function () { if (!total && isFinite(cam.duration)) { total = cam.duration * 1000; } }, { once: true });
            window.requestAnimationFrame(seguir);
        });
})(typeof window !== 'undefined' ? window : globalThis);
