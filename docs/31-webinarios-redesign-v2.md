# 31. Webinários: redesign V2 da sala, do console e da página de entrada (31/10/2026)

Data: 31/10/2026. Pedido do produtor: a sala ao vivo, a sala da Live gravada, o console da equipe e a página do webinário estavam "feios e desorganizados", com a cara do layout padrão do motor de vídeo. O produtor mandou cinco referências (dois apps de reunião escuros, o Riverside, uma tela clara com 1 + 2 + 4 vídeos e o arquivo "MeetOn" do Figma) e aprovou, em 31/10/2026, a direção V2, desenhada no canvas "Webinários: layout proposto" (claude.ai, pranchas V2 e a página de entrada). As decisões abaixo valem sobre o `docs/30` onde houver conflito; o que não está aqui continua como no `docs/30`.

Vale para qualquer trabalho na sala do aluno, no console da equipe, na página do webinário, na lista `/webinarios`, nos temas claro e escuro da sala e nas funções novas desta página (comentário em destaque, roteiro e simulação na live ao vivo, tela compartilhada com permissão).

## Resumo em uma página

- **Plano A, decidido**: o motor de vídeo continua embutido pelo IFrame API. Dentro do iframe ficam só o vídeo grande e as miniaturas, estilizados por um CSS nosso na instância própria (cantos, fundo por tema, miniaturas 16:9). Tudo ao redor é nosso: cabeçalho, barra, painel, estados, enquete, comentário em destaque, tema. A camada de vídeo própria (lib-jitsi-meet, sem iframe), que permitiria composições como 1 + 2 + 4, fica para uma fase posterior, se os quatro layouts do motor não bastarem (§3).
- **A sala é foco total**: sem Minimizar e sem pílula flutuante. Sair, com a confirmação que já existe, volta para a área. A faixa "Ao vivo agora · Entrar" no topo da área continua sendo o caminho de volta.
- **Uma regra para cada coisa**: a barra age na sala (Reagir, Mão, Câmera, Microfone e Tela quando liberados, Som, Tela cheia, Configurações, Sair); o painel conversa (Chat, Perguntas, Participantes); a situação da transmissão mora no palco ("Ao vivo · 00:42:10" e "Gravando"); o cabeçalho tem só título, data e presentes.
- **Enquete no meio do palco**, como no Zoom; "Responder depois" recolhe para o card da coluna.
- **Tema claro e escuro na sala e no console**, escolha do aluno (e da equipe) guardada no navegador, escuro por padrão. A área continua escura (decisão de 13/10, `docs/12`).
- **Console em tela cheia**, sem a barra lateral do admin, com a mesma organização da sala do aluno e a barra de quem apresenta feita por nós.
- **Funções novas pedidas em 31/10** (§5): comentário em destaque no palco, com animação; roteiro e simulação também na Live ao vivo; tela compartilhada com permissão para um aluno; e a correção da moderação de tela, que hoje não liga (§5.4).

## 1. Decisões de design (aprovadas em 31/10/2026)

| # | Decisão | Onde se vê |
|---|---|---|
| V2-1 | Plano A: iframe do motor com CSS nosso na instância; nada de camada de vídeo própria nesta versão | §3 |
| V2-2 | Sem Minimizar e sem pílula flutuante em nenhuma sala (ao vivo, gravada, replay). Sair volta para a área com a confirmação de hoje | sala |
| V2-3 | Cabeçalho da sala: logo, título (22 px, 800) e, embaixo, "Quinta, 30 de outubro · 20:00 · 60 min · com {apresentador}"; à direita, "{n} assistindo", um traço e o botão de tema. A duração cadastrada aparece só nessa linha; sem ela, a linha omite o trecho. Sem "Tempo restante" e sem selo repetido | sala |
| V2-4 | No canto superior esquerdo do palco: selo vermelho "Ao vivo · 00:42:10" (tempo no ar real, desde o Começar para todos) e, ao lado, "Gravando" só enquanto grava. Canto inferior esquerdo: "{nome} · Apresentador". Canto inferior direito: "Assistente" quando o Assistente de IA está ligado | sala e console |
| V2-5 | Fileira de miniaturas em 16:9, cantos de 12 px, nome em pílula e ícone de microfone no canto; quem fala ganha borda verde. Posição preferida era acima do palco, como no MeetOn; o spike (§3) mostrou que o motor dimensiona e centraliza o vídeo grande pela janela inteira e só desconta a fileira embaixo na tela compartilhada, então a fileira em cima exigiria JS dentro do motor. Fica a coluna à direita (padrão) ou a fileira embaixo | sala e console |
| V2-6 | Barra do aluno (72 px, cantos de 16 px): Sair em vermelho à esquerda; no centro, círculos de 48 px sem rótulo e com nome acessível: Reagir, Mão, Câmera (só com câmera de aluno permitida), Microfone (só depois de liberado), Compartilhar tela (só depois de liberado, §5.3), Som, Tela cheia; à direita, o seletor de layout ("Palco ▾"), Configurações e o balão de mensagem que abre e fecha o painel. Nenhum botão de Perguntas ou Participantes na barra: as abas do painel já são esse controle | sala |
| V2-7 | Painel de 320 px com abas em pílula: Chat, Perguntas com contador, Participantes; X no fim da linha das abas fecha; o balão da barra reabre e mostra o contador vermelho de mensagens novas enquanto fechado. O estado fica guardado no navegador. A aba Enquetes só existe enquanto há enquete aberta (regra de hoje) | sala |
| V2-8 | Com o painel fechado, o palco toma a largura toda, a fileira sobe para quatro miniaturas e as duas últimas mensagens do chat passam em pílulas discretas na base do vídeo | sala |
| V2-9 | Chat no estilo do Zoom: avatar dos dois lados, balão primeiro e, abaixo dele, "{nome} · {papel} · {hora}" em texto cinza, sem etiqueta colorida. Balão dos outros em `#202020`, o meu em branco com texto preto; no claro, `#ededeb` e `#141414`. Papel só para Apresentador, Co-apresentador, Equipe e Assistente | sala e console |
| V2-10 | Enquete: quando a equipe lança, abre centralizada sobre o palco, escurecendo só o palco: pergunta, opções de 48 px, "Enviar resposta" e "Responder depois", que recolhe para o card da coluna ("Enquete aberta · você deixou para depois · Responder agora"). O resultado, quando compartilhado, aparece no mesmo lugar. Abre mesmo com o painel recolhido | sala |
| V2-11 | Cores pelos tokens da área (`docs/12`): `#141414`, `#171717`, `#202020`, bordas branco a 10 %, acento `#e50914` só na marca, no Ao vivo, no Sair e nos contadores; ativo em branco com texto preto; botão primário branco. Claro: `#f4f4f3`, `#ffffff`, bordas preto a 8 a 12 %, ativo em `#141414`. Cantos e botões seguem `--member-cover-radius` e `--member-button-radius` (Marca › Estilo) | sala |
| V2-12 | Tema claro e escuro só na sala e no console: botão no cabeçalho, escolha guardada no navegador por pessoa, escuro por padrão. O iframe recebe o fundo do tema por `DEFAULT_BACKGROUND` e o CSS da instância lê o tema pelo hash da página (§3) | sala e console |
| V2-13 | Console em tela cheia, sem a barra lateral do admin: topo com seta de voltar, "Console da sessão" + título, o seletor de sessão com a situação dentro ("Sessão de 30/10 às 20:00 · no ar"), e à direita tema, Trancar a sala e Encerrar live. Presentes e pico num selo no canto superior direito do palco; mensagens por minuto só na aba Presença | console |
| V2-14 | Barra de quem apresenta feita por nós (o iframe de host e co-host perde a barra própria): Microfone, Câmera, Compartilhar tela, Gravar, Mãos com contador, Lançar enquete; à esquerda a Sala de espera com Admitir todos; à direita "Palco para todos ▾" (seguir a visão), Configurações e o painel. Silenciar todos, Fechar câmeras e Câmeras livres vão para a aba Pessoas, como no Zoom. Liberar direto na miniatura de quem levantou a mão | console |
| V2-15 | Painel do console: Chat, Perguntas, Mãos, Pessoas e ⋯ (Enquetes, Roteiro, Oferta, Atendimento, Presença, Gravação). Quem escreve e Modo lento viram dois seletores compactos; a mensagem pendente aparece num card com Liberar, Recusar e Virar pergunta; cada mensagem tem Mostrar no palco, Fixar, Virar pergunta, Apagar e ⋯ | console |
| V2-16 | Layouts do vídeo que o motor permite, no botão Layout: Palco (padrão), Miniaturas embaixo, Grade e Palco duplo (até 6 no palco). A equipe define o de todos pelo console (seguir a visão, já ligado hoje); o aluno pode trocar o seu, guardado no navegador | sala |
| V2-17 | Página do webinário, dentro da área (escura): capa 16:9 com o título por cima, linha de fatos (data em Brasília, duração, apresentador com avatar), card "O que você vai ver". À direita, o card da vaga: antes, "Começa em 2 d 4 h 12 min", "Garantir minha vaga" em branco, a frase dos lembretes e "{n} vagas garantidas"; na hora, os selos "Ao vivo agora" e "Vaga garantida", "No ar há 12 min" e o botão grande "Entrar na sala". Embaixo, "Como funciona" ou "Antes de entrar" em três linhas | página |
| V2-18 | Celular: cabeçalho com título, "com {apresentador} · {n} assistindo" e Sair; palco 16:9 com os selos; fileira de miniaturas rolável sob o palco; barra com círculos de 44 px (Reagir, Mão, Câmera, Som, Configurações, balão do chat); abas em pílula; chat com campo fixo acima do teclado. O Modo cinema fica no canto do palco. A Sala Live vertical 9:16 da Live gravada continua como no `docs/30` | sala |
| V2-19 | Microfone e tela compartilhada seguem a mesma lógica: só aparecem na barra do aluno depois de a equipe liberar, com o aviso ("O apresentador liberou o seu microfone" / "...a sua tela") e os botões Falar ou Compartilhar e Agora não; somem quando a equipe recolhe | sala e console |

## 2. O que muda no `docs/30`

- §1.3: sai o Minimizar e a pílula (V2-2); o cabeçalho e a barra passam a ser os de V2-3, V2-4 e V2-6; o painel, V2-7 e V2-8; o chat, V2-9; a enquete, V2-10.
- §1.4 e §2.4: a barra de quem apresenta é nossa (V2-14); "Fixar no palco" da tabela de Perguntas vira o comentário em destaque de §5.1, para mensagens do chat, perguntas e itens do roteiro.
- §1.2: a página do webinário é a de V2-17.
- §5.4 e §6.3: o `toolbarButtons` de host e co-host vira `[]` como o do aluno; os comandos da barra nossa (`toggleAudio`, `toggleVideo`, `toggleShareScreen`, `startRecording`, `toggleRaiseHand`, `setFollowMe`, `toggleLobby`) ficam listados ali.
- §8.1: a moderação de tela não está ligada hoje (§5.4); a regra passa a ser a de §5.3.
- §9: o celular é o de V2-18.
- §12: as decisões desta página entram como V2-1 a V2-19.

Estas edições no `docs/30` são feitas na PR de cada fase (§6), nunca antes do código.

## 3. O motor de vídeo: o que fica dentro do iframe e como estilizar

Conferido em 31/10/2026 na tag fixada `stable-11248` (`infra/jitsi/.env.example`), lendo `config.js`, `interface_config.js`, as whitelists do IFrame API e `modules/API/API.js`:

- Dentro do iframe ficam o vídeo grande e as miniaturas. O aluno e a Equipe já entram sem barra (`toolbarButtons: []`); com V2-14, host e co-host também.
- **Por iframe (por pessoa)**, pela whitelist: `DEFAULT_BACKGROUND` (o fundo do tema), `VERTICAL_FILMSTRIP` (coluna à direita ou fileira embaixo), `FILM_STRIP_MAX_HEIGHT`, `VIDEO_LAYOUT_FIT`, `TILE_VIEW_MAX_COLUMNS`, `REMOTE_THUMBNAIL_RATIO` e `LOCAL_THUMBNAIL_RATIO` (16:9; o padrão da tag é 1:1 para as remotas), `DISABLE_DOMINANT_SPEAKER_INDICATOR`, `CONNECTION_INDICATOR_DISABLED`, `filmstrip.disableResizable`, `filmstrip.stageFilmstripParticipants` (1 a 6, o Palco duplo), `tileView`, `disableTileView`. Os comandos `setTileView`, `toggleFilmStrip`, `pinParticipant`, `setLargeVideoParticipant` e `setFollowMe` cobrem os quatro layouts de V2-16.
- **Na instância (para todos)**: um arquivo CSS nosso, montado no contêiner web ao lado de `custom-config.js` e carregado por ele, para os cantos do vídeo grande e das miniaturas, o fundo por tema (lido do hash da página, que o `custom-config.js` enxerga antes do app) e o anel verde de quem fala. Nenhuma frase de tela e nenhum nome do motor (D2 do `docs/30`).
- **Spike (fase 0, §6)**: na instância de teste, com prints para o produtor aprovar: cantos, fundo claro e escuro, miniaturas 16:9 e os quatro layouts. A fileira em cima (V2-5) saiu na leitura do código (abaixo).

**Como ficou a fase 0 (31/10/2026, no código):**

- `infra/jitsi/web/bunker707.css` é a folha; `docker-compose.yml` a monta em `/usr/share/jitsi-meet/css/bunker707.css` (somente leitura), o nginx do próprio web a serve em `/css/bunker707.css`, e `scripts/smoke.sh` confere a folha e o carregador no `config.js` servido.
- O carregador fica no fim de `custom-config.js`, entre as marcas `bunker707:css-loader:inicio` e `:fim`: lê `config.bunkerTheme` no hash (`light` ou `dark`; qualquer outra coisa é escuro), grava `html[data-bunker-theme]` e cria o `<link>` da folha com caminho absoluto (`/css/bunker707.css?v=N`; a sala fica em `/<sala>`). O `config.js` entra inline no `<head>` por SSI do nginx da imagem, antes do app e com `document.head` já existente; sem `document` (o app lê o config num worker quando o SSI não roda) o trecho não faz nada. O nginx manda `expires 1y` para `/css/*` quando a URL tem `?v=`: cada mudança na folha sobe o `v` no carregador e grava o novo sha256 em `bunker707.css.version`, e o teste confere os dois. É a única parte dos dois arquivos de config que toca o DOM; a guarda em `tests/infra-jitsi.test.mjs` segue proibindo rede e script fora dela e, dentro dela, qualquer `fetch`, `import`, `src` ou endereço `http`.
- No app, `src/lib/jitsi-room-config.ts` ganhou `LiveEmbedLook` (`theme` e `layout`, `normalizeLook` com o padrão escuro e Palco): `liveConfigOverwrite` manda `bunkerTheme` (só para o hash), `hideDominantSpeakerBadge` (os selos do palco são da página, V2-4), a `filmstrip` por layout (abaixo) e `tileView.numberOfVisibleTiles` = 9; `liveInterfaceConfigOverwrite` manda `DEFAULT_BACKGROUND` preto, `DISABLE_VIDEO_BACKGROUND` (faixas lisas, sem a cópia desfocada do vídeo), `VERTICAL_FILMSTRIP` pelo layout, `FILM_STRIP_MAX_HEIGHT` 120, as duas razões de miniatura 16:9, `CONNECTION_INDICATOR_DISABLED`, `VIDEO_QUALITY_LABEL_DISABLED` e `VIDEO_LAYOUT_FIT` both (lido em `VideoContainer.js`: a câmera preenche o palco cortando até 30 %, o `MAXIMUM_ZOOMING_COEFFICIENT` da tag, como no Zoom; acima disso, e na tela compartilhada, que nunca é cortada, sobram faixas pretas lisas).
- **Como o motor dimensiona (lido em `LargeVideo.web.tsx`, `VideoContainer.js`, `filmstrip/functions.web.ts`, `filmstrip/actions.web.ts`, `filmstrip/middleware.web.ts` e `Filmstrip.tsx` da tag):** por padrão as miniaturas flutuam sobre o vídeo grande. Na coluna, o motor só estreita o vídeo grande (`calc(100% - coluna)`) e o centraliza no espaço que sobra quando a coluna é redimensionável e tem 180 px ou mais; por isso Palco, Palco duplo e Grade mandam `filmstrip: { disableResizable: false, initialWidth: 213, alwaysShowResizeBar: false }` e o CSS deixa o puxador invisível e sem ponteiro, mas no lugar (os 9 px dele entram na conta). Com a coluna redimensionável a miniatura remota tem sempre 120 px de altura e a local tem largura ÷ 16:9, daí 213 px (119,8). Miniaturas embaixo mantém `disableResizable: true` e `FILM_STRIP_MAX_HEIGHT` vale como altura. O motor limita a coluna a (largura do iframe − 800): o iframe precisa de 1013 px para a coluna inteira e, abaixo de 980 px, as miniaturas voltam a flutuar sobre o vídeo. A página trata isso na fase 1 (o comando `resizeFilmStrip` ajusta a largura em tempo real; `toggleFilmStrip` esconde a coluna; ou a fileira embaixo em telas estreitas), e os prints do spike mostram os dois casos.
- **O que o CSS da instância faz e o que não faz:** cantos de 16 px no `#largeVideoContainer` e sem a sombra do wrapper; o nome que o motor escreve no palco escondido (`[data-testid="stage-display-name"]`); a coluna, a fileira e o fundo cinza do hover transparentes; miniaturas com 12 px de canto, fundo sem câmera no tom do tema, contorno fino por `::after` e o anel de quem fala em verde. Nenhuma margem, largura ou altura nas miniaturas: o motor mede cada item da lista virtual por JS (altura + 4 px de borda transparente) e qualquer margem a mais desalinha a coluna; o teste em `tests/infra-jitsi.test.mjs` proíbe. A fileira em cima do palco saiu: o motor centraliza o vídeo grande pela janela inteira e só desconta a fileira embaixo na tela compartilhada, então subir a fileira exigiria JS dentro do motor (fora do que a instância pode fazer sem fork). As chamadas de hoje seguem sem o visual (padrão), até a fase 1 ligar o botão de tema e o de layout. Duas chaves que o app mandava e a tag ignorava saíram: `prejoinPageEnabled` (só `prejoinConfig.enabled` está na whitelist) e `MOBILE_APP_PROMO` (fora da whitelist do iframe; a instância já a desliga). `tests/webinarios-redesign-motor.test.mjs` confere tudo isso contra as whitelists da tag, copiadas no próprio teste.
- Aplicar na instância de teste: PR para a `dev` e a etapa `deploy-meet` (`.github/workflows/infra.yml`), que recria os contêineres e por isso recusa com live nas próximas 2 h; depois, o `smoke.sh` e os prints com um aluno e um apresentador na sala.

## 4. Simulação e roteiro: o que existe em produção e o que foi pedido

**Em produção hoje** (`main`, PR #142, só na Live gravada, `kind = 'simulated'`): o contador simulado por regra (`simulated_count_rule`, curva com subida, platô e queda, `src/server/webinars/simulation-model.ts`), as entradas simuladas ("{nome} entrou"), os avisos de venda simulados (desligados por padrão até a revisão jurídica, A32 do `docs/30`), e o Roteiro: comentários prontos com nome e papel inventados (`personaName`, `personaRole`), importados por CSV, que entram **num minuto do vídeo** (`at_offset`), **quando o apresentador diz** uma frase (`on_phrase`, pela transcrição da gravação) ou **pelo botão da equipe** (Soltar agora). Tudo marcado por dentro (`source = scripted`, colunas `simulated_*`), fora dos números reais e do CSV real, com a frase de decisão do produtor gravada por sessão (`simulation_ack_text`, `docs/30` §8.6).

**Na Live ao vivo não existe nada disso**: a sala do aluno só liga a simulação com `kind === "simulated"`, o console só mostra o Roteiro no webinário gravado, e as ações de simulação filtram as sessões gravadas.

**Pedido de 31/10**: as mesmas funções na Live ao vivo. Como fica (§5.2): o zero do roteiro e da simulação passa a ser o início real da live (`started_at`); "Num minuto do vídeo" vira "Aos {n} minutos da live"; "Pelo botão da equipe" continua; "Quando o apresentador diz" não existe na live, porque não há transcrição ao vivo (legendas ficam fora da v1, `docs/30` §9). A frase de decisão do produtor ganha a versão "nesta live ao vivo", obrigatória da mesma forma, e os avisos de venda simulados continuam sob A32. Os números simulados nunca entram no relatório real nem nos painéis, igual à gravada.

## 5. Funções novas

### 5.1 Comentário em destaque no palco

- **O que é**: a equipe escolhe uma mensagem do chat, uma pergunta ou um item do roteiro e ela aparece sobre o vídeo, para todos, num card na base do palco: avatar, nome e o texto, com entrada suave (desliza 12 px e aparece em 300 ms, `ease-out`) e saída igual; com `prefers-reduced-motion`, aparece e some sem movimento. Um de cada vez. Fica até a equipe tirar ou outro entrar.
- **Como se liga**: no console, "Mostrar no palco" no ⋯ de cada mensagem e de cada pergunta, e a caixa "mostrar no palco" no item do roteiro (entra sozinha no minuto do item). No console o card mostra "no palco há 40 s" e o X para tirar.
- **Por dentro**: a camada é nossa, sobre o iframe, então vale para todos os alunos pelo mesmo retrato que já leva o `pinnedMessageId` (coluna nova `featured_message_id` em `webinar_sessions`, nula = nada no palco, mais a tabela `webinar_featured_messages` com `session_id`, `message_id`, `from_offset_ms`, `to_offset_ms`, para o replay e o relatório). No replay e na Live gravada o card reaparece no mesmo segundo pelo offset, como o chat. O vídeo gravado pelo gravador **não** tem o card, porque ele grava a conferência do motor, não a nossa tela.
- **Dados que o aluno vê**: só o nome de exibição que o autor já mostra no chat (primeiro nome + inicial, apelido ou "Aluno {n}"), nunca mais que isso (LGPD, `docs/30` §8.5). Mensagens anônimas entram como "Aluno {n}".

### 5.2 Roteiro e simulação na Live ao vivo

- O card Simulação e o card Roteiro passam a existir no webinário `live`, com a frase de decisão na versão "nesta live ao vivo".
- O tick que solta o roteiro passa a ler o offset da live pelo `started_at`; o item `on_phrase` fica indisponível no webinário ao vivo (o editor explica por quê).
- O contador simulado e as entradas simuladas rodam pelo mesmo `simulation-model.ts`, com o zero no `started_at` e o fim no Encerrar live; o relatório mostra o bloco Simulação também para a live e nunca mistura (§3.5 do `docs/30`).
- O comentário em destaque de §5.1 aceita item do roteiro, então "aos 34 minutos entra o comentário de X no palco" é só marcar a caixa no item.

### 5.3 Tela compartilhada com permissão para um aluno

Conferido em 31/10/2026: hoje o aluno não tem o botão de tela em lugar nenhum, o token dele nasce com `screen-sharing: false`, o console não tem a ação, e o IFrame API da tag fixada não tem comando para aprovar a tela de uma pessoa (só áudio e vídeo). Como fica:

- No console, "Liberar tela" no ⋯ da pessoa (e "Recolher tela"). O servidor grava a liberação na sessão (`webinar_session_screen_grants`: `session_id`, `user_id`, `granted_at`, `revoked_at`).
- A página do aluno recebe a liberação pelo retrato de 15 s (ou pelo sinal `bunker707:screen-grant`, como o `LOWER_HAND_SIGNAL`), pede um token novo (o `join-token` passa a emitir `screen-sharing: true` para quem tem a liberação) e remonta o iframe, como no Tentar de novo: alguns segundos de reconexão, avisados na tela. Depois, o aviso "O apresentador liberou a sua tela" com Compartilhar e Agora não, e o botão Compartilhar tela entra na barra (`toggleShareScreen`).
- Recolher: o servidor grava `revoked_at`, o console manda `muteRemoteParticipant(id, 'desktop')` se a tag aceitar (a conferir no spike) e o aluno perde o botão no próximo retrato; o token seguinte volta sem a tela.
- A remontagem é o custo que o spike confirma antes de prometer prazo.

### 5.4 Correção: a moderação de tela não liga

`presenterSetupCommands` manda `toggleModeration(true, 'desktop')` querendo "só moderador compartilha", mas na tag fixada o handler do IFrame API só distingue `video` de qualquer outro valor: `'desktop'` cai na moderação de **áudio** (`modules/API/API.js`, `'toggle-moderation'`). Hoje nada vaza, porque o token e a barra já bloqueiam o aluno, mas o comentário em `src/server/webinars/live-console-model.ts`, o teste e2e que confere o comando e o `docs/30` §8.1 descrevem uma camada que não existe. Na fase 2: tirar o comando, corrigir o comentário, o teste e o doc, e deixar a regra de tela só no token (§5.3). Em lib-jitsi-meet e no app a moderação de desktop existe; o que falta é o comando no IFrame API, então não vale a pena esperar por ela.

## 6. Fases e PRs

Cada PR traz o teste de comportamento da tela e do modelo (`docs/18`), roda `npm run verify` e atualiza o `docs/30` no que mudou. Fluxo: ramo da tarefa → PR para `dev` → o produtor testa → PR `dev` → `main` (`CONTRIBUTING.md`).

| Fase | Entrega | Testes |
|---|---|---|
| 0 | **Spike do motor** (1 PR em `infra/jitsi/` + `src/lib/jitsi-room-config.ts` + prints para o produtor): CSS na instância, fundo por tema, miniaturas 16:9, os quatro layouts. Decidiu V2-5 (sem a fileira em cima). Nada vai para produção sem o ok do produtor no chat (`docs/20`) | `tests/infra-jitsi.test.mjs` (o CSS, o carregador, a montagem e o smoke) e `tests/webinarios-redesign-motor.test.mjs` (o visual por pessoa contra as whitelists da tag) |
| 1 | **Sala do aluno V2**: tokens claro e escuro da sala, cabeçalho, palco com selos, barra de círculos, painel com três abas e recolher, chat no estilo do Zoom, enquete no palco, seletor de layout, sem Minimizar, celular. A Live gravada e o replay usam a mesma casca | `webinarios-sala-ao-vivo-tela`, `webinarios-sala-tela`, `webinarios-sala-vertical-tela`, modelo da barra e do painel, e2e da sala |
| 2 | **Console V2**: tela cheia, topo enxuto, fileira e palco, barra nossa de quem apresenta, painel com abas, Pessoas com as ações de todos; correção de §5.4; tela compartilhada com permissão (§5.3) | `webinarios-console-ao-vivo-tela`, `webinarios-console-ao-vivo-modelo`, e2e `produtor-controla-a-live` |
| 3 | **Página do webinário e lista** (V2-17) | `webinarios-aluno-modelo`, tela da página, e2e de garantir vaga e entrar |
| 4 | **Comentário em destaque** (§5.1) e **roteiro e simulação na live** (§5.2), com a migração das colunas novas antes do merge (R1 do `docs/29`) | tela e modelo do destaque, `webinarios-roteiro-*`, `webinarios-simulacao-*` com `kind = 'live'` |
| 5 | **Relatório e painéis** no mesmo estilo, quando o produtor mandar o print do dashboard | `webinarios-relatorio-tela`, `webinarios-paineis-tela` |

## 7. Riscos

- O CSS dentro do iframe depende da tag fixada; cada atualização do motor passa pelo `scripts/smoke.sh` e pelos prints do spike de novo.
- A coluna de miniaturas ao lado do vídeo exige um iframe com 1013 px ou mais (§3); num notebook de 1366 px com o painel aberto o iframe fica perto de 950 px e as miniaturas voltam a flutuar sobre o vídeo. A fase 1 decide o comportamento (ajustar a coluna, escondê-la ou a fileira embaixo) com os prints dos dois casos.
- A tela compartilhada com permissão exige remontar o iframe do aluno (§5.3); se a remontagem derrubar o som por mais de alguns segundos, a função fica para depois.
- Simulação na live ao vivo: a mesma exposição do CDC da Live gravada (`docs/30` §8.6). A frase de decisão por sessão continua obrigatória e os avisos de venda simulados seguem desligados até a revisão jurídica (A32).

## 8. Abertas para o produtor

| # | Pergunta | Padrão assumido |
|---|---|---|
| V2-A1 | Fileira de miniaturas em cima do palco: o spike mostrou que exigiria JS dentro do motor (§3); fica a coluna à direita ou a fileira embaixo | resolvida no spike: coluna à direita (padrão) ou embaixo |
| V2-A5 | Iframe com menos de 1013 px (notebook com o painel aberto): a coluna encolhe e as miniaturas voltam a flutuar sobre o vídeo (§7). O que a página faz: esconde a coluna, ajusta a largura ou troca para a fileira embaixo | esconder a coluna abaixo de 1013 px (o palco manda no webinário) e mostrar nos prints |
| V2-A2 | Tema padrão da sala | escuro, como a área |
| V2-A3 | Comentário em destaque: tempo de tela | até a equipe tirar ou outro entrar; sem limite fixo |
| V2-A4 | Simulação na live ao vivo: a frase "nesta live ao vivo" passa pela mesma revisão jurídica dos avisos de venda (A32) antes de ir para produção | sim |
