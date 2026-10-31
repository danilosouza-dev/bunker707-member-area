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

// Sem a pagina "abra no aplicativo" e sem pedidos a terceiros (gravatar etc.).
config.disableDeepLinking = true;
config.disableThirdPartyRequests = true;

// Cada um recebe no maximo o palco + 8 miniaturas (quem falou por ultimo).
config.channelLastN = 9;

// Miniatura pequena recebe 180p; maior, 360p; o palco, o maximo (D26).
config.videoQuality = config.videoQuality || {};
config.videoQuality.minHeightForQualityLvl = { 360: 'standard', 720: 'high' };

// Tela compartilhada a 30 quadros (mouse e escrita fluidos); 15 na outra opcao do card Qualidade.
config.desktopSharingFrameRate = { min: 5, max: 30 };

// Barra padrao = a minima (docs/30 §6.3 e §8.1): quem abre a sala direto pelo endereco com o token nao ganha tela
// compartilhada, gravar, seguranca nem a lista de participantes. O host e o co-apresentador recebem a barra deles pelo
// configOverwrite do iframe; aluno e Equipe usam a nossa (barra vazia). E so uma barreira no cliente: a tela e a
// gravacao tambem saem pelas features do token (context.features) e pela moderacao de 'desktop' que o apresentador liga.
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
        link.href = '/css/bunker707.css?v=74ccdd46';
        (document.head || document.documentElement).appendChild(link);
    } catch (e) {
        // Sem a folha nossa, o motor segue com o visual padrao dele.
    }
})();
// bunker707:css-loader:fim
