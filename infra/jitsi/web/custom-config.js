// Bunker707: ajustes do config.js do Jitsi proprio (docs/30 §6.2; D2, D4, D5, D26).
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
