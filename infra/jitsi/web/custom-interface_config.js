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
