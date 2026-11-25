// Bunker707: ajustes do interface_config.js do motor proprio (docs/30 §6.2, D2): sem marca d'agua e sem o
// nome do motor na tela. O script de partida da imagem web anexa este arquivo ao fim do interface_config.js,
// entao cada linha aqui vence o padrao. So funciona em instancia propria: estas chaves ficam fora da
// whitelist do IFrame API (e por isso o iframe de terceiro mostra a marca).
// A licenca Apache-2.0 e a atribuicao ficam em infra/jitsi/LICENSE-jitsi e NOTICE, nao na tela.

interfaceConfig.SHOW_JITSI_WATERMARK = false;
interfaceConfig.SHOW_BRAND_WATERMARK = false;
interfaceConfig.SHOW_POWERED_BY = false;
interfaceConfig.APP_NAME = 'Bunker707';
interfaceConfig.NATIVE_APP_NAME = 'Bunker707';
interfaceConfig.PROVIDER_NAME = 'Bunker707';
interfaceConfig.JITSI_WATERMARK_LINK = '';
interfaceConfig.DEFAULT_LOGO_URL = '';
interfaceConfig.DEFAULT_WELCOME_PAGE_LOGO_URL = '';
interfaceConfig.MOBILE_APP_PROMO = false;
interfaceConfig.SHOW_DEEP_LINKING_IMAGE = false;
interfaceConfig.SHOW_CHROME_EXTENSION_BANNER = false;
interfaceConfig.DISPLAY_WELCOME_FOOTER = false;
interfaceConfig.HIDE_INVITE_MORE_HEADER = true;

// Bunker707: no gravador, sem o fundo desfocado do palco (docs/30 D139). Quando o video do palco nao enche o espaco (a
// tela compartilhada, por causa da coluna de miniaturas), o motor poe atras dele uma copia dele mesmo numa camada
// desfocada do tamanho da pagina, atualizada a cada 200 ms. O Chrome do gravador desenha sem placa de video, e essa
// camada derruba a pagina de 30 para 15 a 20 desenhos por segundo: a gravacao da tela compartilhada saia com 10 a 13
// imagens por segundo. A chave e do proprio motor, que ja desliga o fundo nos navegadores em que ele pesa. So no
// gravador (config.iAmRecorder=true no endereco, que o Jibri manda): alunos e quem apresenta continuam com o fundo. E a
// unica parte deste arquivo que le alguma coisa, e so o endereco da pagina, entre as marcas.
// bunker707:gravador-fundo:inicio
(function () {
    try {
        if (typeof location === 'undefined') { return; }
        if (/config\.iAmRecorder=(?:%22|"|%27|')?true\b/.test(String(location.hash || ''))) {
            interfaceConfig.DISABLE_VIDEO_BACKGROUND = true;
        }
    } catch (e) {
        // Sem a chave, o motor segue como sempre.
    }
})();
// bunker707:gravador-fundo:fim
