// Bunker707: ajustes do config.js do motor proprio (docs/30 §6.2; D2, D4, D5, D26).
// O script de partida da imagem web anexa este arquivo ao fim do config.js gerado, entao cada linha aqui
// vence o padrao. So funciona em instancia propria: estas chaves ficam fora da whitelist do IFrame API.
// Os tetos de bitrate por codec e as resolucoes vem do .env (VIDEOQUALITY_BITRATE_*, RESOLUTION*).

// Sem logo no canto (A10); DYNAMIC_BRANDING_URL fica pronto para ligar o nosso.
config.defaultLogoUrl = '';

// O nome vem do JWT; ninguem muda o proprio nome nem ve a propria miniatura.
config.readOnlyName = true;
config.disableSelfView = true;

// O titulo e o contador sao os nossos (o selo Ao vivo com o numero real de presentes).
config.hideConferenceSubject = true;
config.hideConferenceTimer = true;

// So o host silencia; o aluno nao abre menu sobre ninguem.
config.disableRemoteMute = true;

// Chat, enquetes e reacoes sao sempre os nossos (D5); o iframe tambem manda isso por papel.
config.disableChat = true;
config.disablePolls = true;
config.disableReactions = true;

// Sem a pagina "abra no aplicativo".
config.disableDeepLinking = true;

// A foto do Perfil na miniatura (docs/30 D115): na tag fixada, o motor so carrega foto por endereco com os pedidos a
// terceiros ligados; com a chave desligada, a miniatura so aceita foto embutida e mostra as iniciais. O que a chave
// barrava fica barrado um por um: o Gravatar, a analise de uso e o Giphy aqui; o video compartilhado (YouTube) e a
// foto anunciada por outro endereco saem no Prosody (mod_bunker_presence_guard), que so repassa a foto do token. O
// ENABLE_THIRD_PARTY_REQUESTS=0 do .env continua: este arquivo vem depois do config.js gerado e vence.
config.disableThirdPartyRequests = false;
config.gravatar = { disabled: true };
config.analytics = config.analytics || {};
config.analytics.disabled = true;
config.giphy = { enabled: false };

// Cada um recebe no maximo o palco + 8 miniaturas (quem falou por ultimo).
config.channelLastN = 9;

// Miniatura pequena recebe 180p; maior, 360p; o palco, o maximo (D26).
config.videoQuality = config.videoQuality || {};
config.videoQuality.minHeightForQualityLvl = { 360: 'standard', 720: 'high' };

// Tela compartilhada a 30 quadros (mouse e escrita fluidos); 15 na outra opcao do card Qualidade.
config.desktopSharingFrameRate = { min: 5, max: 30 };

// Barra padrao = a minima (docs/30 §6.3 e §8.1): quem abre a sala direto pelo endereco com o token nao ganha tela
// compartilhada, gravar, seguranca nem a lista de participantes. O host e o co-apresentador recebem a barra deles pelo
// configOverwrite do iframe; aluno e Equipe usam a nossa (barra vazia). E so uma barreira no cliente: as features do
// token (context.features) desligam tambem o botao e o atalho da tela do proprio motor, mas o comando de tela do
// IFrame API nao as confere (docs/30 §8.1).
config.toolbarButtons = ['camera', 'raisehand', 'fullscreen', 'hangup'];

// A reserva "Gravar no navegador" do console (docs/30 §6.7) usa a gravacao local: fica ligada de forma explicita,
// sem depender do padrao da imagem.
config.localRecording = { disable: false };

// Bunker707: o CSS nosso dentro do iframe (docs/31 §3). Este arquivo roda como script da pagina, inline no <head>,
// antes do app: le o tema no hash (`#config.bunkerTheme="light"`, chave que o app descarta por estar fora da
// whitelist, mas que fica na URL) e SO ENTAO liga /css/bunker707.css, servido por este mesmo nginx (montado em
// docker-compose.yml). Sem a chave nada acontece: a instancia e uma so e atende a producao; so o app que ja tem a V2
// manda a chave, e o gravador e o app de antes seguem com o visual padrao do motor. Sem a folha, o motor segue com
// o visual padrao dele. E a unica parte deste arquivo que toca o DOM: so cria o <link> para um caminho desta origem
// (nada de rede nem de script), entre as marcas abaixo.
// bunker707:css-loader:inicio
(function () {
    if (typeof document === 'undefined' || typeof window === 'undefined') { return; }
    try {
        var hash = String((window.location && window.location.hash) || '');
        var match = /config\.bunkerTheme=(?:%22|"|%27|')?(light|dark)\b/.exec(hash);
        if (!match) { return; }
        document.documentElement.setAttribute('data-bunker-theme', match[1]);
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        // O v e o comeco do sha256 da folha (a guarda da infra confere e diz o valor novo): o nginx guarda /css/* por
        // um ano quando a URL tem ?v=, entao uma folha nova chega sempre num endereco novo. Caminho absoluto por
        // clareza (a pagina tem <base href="/">, entao um relativo tambem resolveria).
        link.href = '/css/bunker707.css?v=33ebf1db';
        (document.head || document.documentElement).appendChild(link);
    } catch (e) {
        // Sem a folha nossa, o motor segue com o visual padrao dele.
    }
})();
// bunker707:css-loader:fim

// Bunker707: os participantes simulados desenhados pelo proprio motor (docs/30 D120). Como o carregador do CSS acima,
// este roda como script da pagina, antes do app: so liga /libs/bunker707-plateia.js, servido por este mesmo nginx
// (montado em docker-compose.yml), e so em dois casos: o iframe do nosso app (a chave config.bunkerTheme no hash) e o
// gravador (config.iAmRecorder=true no hash, que o Jibri manda). Uma sala aberta pelo endereco nao carrega nada. O
// arquivo so poe na lista de participantes deste navegador o que a nossa pagina manda (ou, no gravador, o que um
// moderador manda); sem ele, o motor segue como sempre. So cria a tag de script para um caminho desta origem, entre as
// marcas. O nome da tag nunca aparece escrito com os sinais de menor e maior neste arquivo, nem em comentario: ele entra
// inline no index.html, depois de um texto de comentario de HTML no config.js gerado, e a tag escrita ali faria o
// navegador nao fechar o bloco (o index inteiro quebraria; conferido no ensaio local de 13/11/2026).
// bunker707:plateia-loader:inicio
(function () {
    if (typeof document === 'undefined' || typeof window === 'undefined') { return; }
    try {
        var hash = String((window.location && window.location.hash) || '');
        var ours = /config\.bunkerTheme=/.test(hash);
        var recorder = /config\.iAmRecorder=(?:%22|"|%27|')?true\b/.test(hash);
        if (!ours && !recorder) { return; }
        var script = document.createElement('script');
        // O v e o comeco do sha256 do arquivo (a guarda da infra confere e diz o valor novo), como no CSS.
        script.src = '/libs/bunker707-plateia.js?v=a332a0ce';
        script.async = true;
        (document.head || document.documentElement).appendChild(script);
    } catch (e) {
        // Sem o arquivo, o motor segue como sempre.
    }
})();
// bunker707:plateia-loader:fim
