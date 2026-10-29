# 30. Webinários: lives ao vivo e lives gravadas dentro da área (28/10/2026)

Data: 28/10/2026. Pedido do produtor: webinários dentro da área de membros no estilo do Zoom (o apresentador no palco, os alunos assistem, comentam, reagem, levantam a mão, respondem enquetes e abrem a câmera se quiserem; o apresentador controla tudo, inclusive o microfone e a câmera de cada aluno), com o motor de vídeo próprio (Jitsi Meet numa instância nossa) sem a marca d'água nem o nome do Jitsi; a Live gravada com o chat original da live real reaparecendo no mesmo segundo e todas as funções do Hot Webinar, por fases; as métricas em dois painéis separados no admin (Lives ao vivo e Lives gravadas), mais o relatório de cada Webinário com exportação nos nomes dos relatórios do Zoom; custo baixo: um servidor cx23 da Hetzner agora (cx33 depois, quando houver estoque; o script que fica procurando o cx33 fica para mais tarde) e o gravador num servidor separado, cobrado por hora, criado antes da live e apagado no fim. Arquitetura preparada para crescer sem refazer o que foi feito.

Vale para qualquer trabalho em webinários, lives, sala ao vivo, live gravada, roteiro de chat, Jitsi, Jibri ou nos painéis de lives.

Nota sobre a pesquisa: os fatos de infraestrutura, Jitsi, Zoom, Hetzner e Bunny desta página vêm de fontes oficiais (§13). A lista de funções do Hot Webinar (§1.6) foi conferida na página inicial de hotwebinar.com.br em 28/10/2026 (planos Start R$ 397, Growth R$ 697 e Elite R$ 997 por mês; o próprio site diz que não faz live de verdade); os nomes da coluna "Equivalente no Hot Webinar" são os da página.

Glossário de identificadores (vale para o documento inteiro): tabelas `webinars`, `webinar_sessions`, `webinar_presenters`, `webinar_registrations`, `webinar_recordings`, `webinar_recording_events`, `webinar_chat_messages`, `webinar_chat_script_items`, `webinar_reactions`, `webinar_presence_samples`, `webinar_attendance`, `webinar_polls`, `webinar_poll_options`, `webinar_poll_answers`, `webinar_questions`, `webinar_question_votes`, `webinar_session_bans`, `webinar_offers`, `webinar_offer_variants`, `webinar_offer_clicks`; colunas da Sessão `scheduled_at`, `started_at`, `ended_at`, `recording_anchor_at`, `room_name`, `recorder_status`, `chat_mode`, `chat_slow_mode_seconds`; ajuste do chat `webinar_recordings.anchor_offset_ms`; rotas do aluno `src/app/api/webinars/[id]/…` (`session`, `chat`, `heartbeat`, `reactions`, `questions`, `polls`, `offer-click`, `join-token`, `register`); webhook do gravador `POST /api/webhooks/recorder` com `WEBINAR_RECORDER_WEBHOOK_SECRET`; token `WEBINAR_JWT_APP_ID` + `WEBINAR_JWT_SECRET` no app e `JWT_APP_ID` + `JWT_APP_SECRET` no Jitsi; servidor do Jitsi `bunker707-meet` em `meet.<domínio>` com as etapas `provision-meet`, `deploy-meet`, `secrets-meet`, `exec-meet`; gravador `bunker707-jibri-<sessão>` com as etapas `jibri-up`, `jibri-down`, `exec-jibri`; presença por balde de 30 s com sinal a cada 15 s e saída depois de 90 s (3 baldes) sem sinal.

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Webinário** (duas formas) | **Live ao vivo**: o apresentador no palco do nosso Jitsi (sem marca nem nome do Jitsi), os alunos assistem, comentam, reagem, levantam a mão, respondem enquetes e abrem a câmera se quiserem (miniatura em até 360p); o palco vai em 720p ou 1080p e a tela compartilhada em 1080p a 30 quadros. **Live gravada**: o vídeo da Bunny toca pelo relógio do servidor, sem pausar nem voltar, com o chat da live real reaparecendo no mesmo segundo e a turma de hoje comentando junto | `/webinarios/[slug]` |
| **Página `/webinarios`** | três blocos: **Próxima live** (com contagem regressiva), **Em andamento** e **Replays**; só o que o aluno pode ver | área do aluno |
| **Card "Próxima live"** e **faixa "Ao vivo agora"** | o card entra na página inicial quando a equipe marca **Avisar**; a faixa no topo de todas as páginas enquanto a live está no ar (**Ao vivo agora · título · Entrar**), dispensável por 1 dia; para quem garantiu vaga, **Começa em 1 h: Entrar** | página inicial e cabeçalho |
| **Garantir vaga** | 1 clique, confirmação com **Adicionar ao calendário** (arquivo, Google, Outlook), lembretes 24 h e 1 h antes pelo sino e por e-mail; opcional (quem tem acesso entra sem vaga, salvo quando a equipe limita vagas) | página do Webinário |
| **Sala** | palco grande, fileira de participantes, painel à direita com **Chat / Perguntas / Participantes / Enquetes**, barra de controles embaixo, selo **Ao vivo** com o número real de presentes; no celular o painel vira gaveta; **Minimizar** vira pílula flutuante e o aluno navega na área sem sair da live | `/webinarios/[slug]` |
| **Controles do apresentador** | os do Zoom: silenciar todos, liberar microfone de quem levantou a mão (o aluno aceita), fechar a câmera de um aluno ou de todos, permitir ou não câmeras de alunos, remover, trancar, sala de espera, destacar, compartilhar tela, gravar, enquetes, responder perguntas, quem pode escrever no chat, modo lento, apagar mensagem, silenciar no chat, banir | sala (apresentador) e console da equipe |
| **Chat nosso** | cada mensagem com hora e segundo da gravação; é o que permite o replay sincronizado e os relatórios; o chat do Jitsi fica desligado | Supabase |
| **Qualidade** (D26) | palco 720p ou 1080p (opção por webinário), tela compartilhada 1080p a 30 quadros por segundo, miniaturas até 360p (180p na fileira pequena), câmera de aluno até 360p, gravação em 1080p; cada aluno recebe o tamanho que cabe na tela dele e cai sozinho para 720p ou 360p em 4G | editor, card **Qualidade** |
| **Sessões da Live gravada** | **Em horários marcados** (várias por dia) e **Replay livre** na fase 2; **Começa quando você entra** na fase 4; selo Ao vivo, contador e entradas/saídas simulados são opções por sessão, decididas e registradas | editor, cards **Sessões** e **Simulação** |
| **Roteiro de chat** | comentários prontos ou gerados por IA que a sala solta **num minuto do vídeo**, **quando o apresentador diz uma frase** (pela transcrição) ou **pelo botão da equipe**; importa e exporta CSV | editor, card **Roteiro de chat** |
| **Oferta** | card de compra na sala com variantes A/B/C/D, link de checkout fora (Hotmart/Ticto), conversão lida pelos webhooks de venda que já existem | editor, card **Oferta** |
| **Admin** | `/admin/comunicacao/webinarios` (lista com números do período), `/novo`, `/[id]` (editor + relatório); abas **Webinários · Lives ao vivo · Lives gravadas**; CSV com os nomes dos relatórios do Zoom; período pelo menu da barra superior | admin |
| **Console da equipe** | durante a sessão: fila de mão levantada, perguntas, moderação, disparar o roteiro, atender o chat, enquetes | `/admin/comunicacao/webinarios/[id]/sala` |
| **Infra** | servidor C `bunker707-meet` (cx23) para o vídeo ao vivo; servidor D `bunker707-jibri-<sessão>` (cpx42, por hora, gravação em 1080p) só para gravar; nada criado antes da fase 3 e sem ok do produtor no chat | §7 |
| **Fases** | 1 agenda + vaga + lembretes (sem vídeo) · 2 Live gravada · 3 Live ao vivo · 4 painéis, CSV e o resto do Hot Webinar | §11 e §12 |

Vocabulário na tela: **Webinário**, **Live ao vivo**, **Live gravada**, **Sessão**, **Garantir vaga**, **Vaga garantida**, **Vagas garantidas** (o total, no lugar de "Inscritos"), **Replay**, **Apresentador**, **Equipe**, **Assistente** (o agente de IA), **Ao vivo**, **Aguardando o apresentador**, **Encerrada**, **Roteiro de chat**, **Oferta**, **Solta em**, **Modo lento**, **Viram a oferta**, **Página inicial**. "Inscritos" e "Inscrição" ficam só nos nomes dos relatórios do Zoom (**Registration**) e nos identificadores do banco. Nunca "campanha", "evento", "audiência", "público", "webinar", "simulive", "host", "lobby", "broadcast", "stream", "gatilho", "impressão" ou "home" em rótulo. Os nomes do Zoom aparecem só neste documento, entre parênteses, para a equipe se achar.

**Meta de capacidade**: ~100 alunos simultâneos na fase 1 (D7) é meta, não limite medido; os números por vCPU de §7 são contas derivadas, a medir no piloto.

---

## 1. O que o aluno vê

### 1.1 Onde o Webinário aparece

- **`/webinarios`** (fase 1), no menu lateral e no cabeçalho ao lado de Estudar, com três blocos em cards verticais (`docs/12`): **Próxima live** (o mais próximo em destaque, com capa, data e hora de São Paulo, duração, apresentador e a contagem regressiva **Começa em 2 d 4 h 12 min**; os seguintes numa fileira), **Em andamento** (as salas abertas agora, botão **Entrar**) e **Replays** (os encerrados que têm replay, com o selo **Replay** e, quando a equipe publicou como aula, **Ver na aula**).
- **Card "Próxima live" na página inicial** (fase 1): entra quando a equipe marca **Avisar › Card na página inicial**, numa fileira própria "Lives" acima das fileiras de produto, com o mesmo card vertical e a contagem regressiva. Some sozinho ao encerrar (ou vira **Replay disponível** por 7 dias, opção da equipe; número proposto, §12.3).
- **Faixa "Ao vivo agora"** (fase 3; na Live gravada, fase 2, só nas sessões com o selo ligado): uma linha no topo de todas as páginas da área, fora do login e do Modo TV, com **Ao vivo agora · {título} · Entrar**. O X dispensa por 1 dia naquele navegador (guardado no navegador). Para quem garantiu vaga, de 60 minutos antes até o começo: **Começa em 1 h: Entrar** (a conta desce: **Começa em 12 min**). A faixa nunca aparece dentro da própria sala.
- **Sino e e-mail**: a confirmação de vaga, os lembretes de 24 h e 1 h e o aviso **Começou agora** chegam pelo sino (`docs/22`) e, os lembretes, também por e-mail (fila `email_outbox`, `src/server/email/outbox.ts`). Convite e lembrete extras podem vir por aviso, pop-up ou fluxo da Comunicação, como a equipe decidir.
- **Só o que pode**: o aluno vê um Webinário quando passa pelo **Quem pode** da equipe (Todos / Segmento / Quem tem o produto X). Quem não pode não vê card, faixa nem página; o endereço direto responde **Esta live não está disponível para você** e, se o Webinário tiver produto ligado com link de compra, **Ver como participar**.
- **Acesso por segmento e o recálculo**: o segmento da Comunicação é recalculado só nas faixas :07/:22/:37/:52 (`docs/29`). Um aluno que acabou de entrar no segmento pode levar até 15 minutos para ver o Webinário; a página do Webinário avisa isso para a equipe no card **Quem pode** ("Quem entrar no segmento agora vê o webinário em até 15 min"). Com `access_mode = 'either'` (produto **ou** segmento), o acesso por produto vale na hora (lê os entitlements) e o por segmento vale na faixa seguinte; basta um dos dois para entrar. Com `product` ou `audience`, vale só aquele.

### 1.2 A página do Webinário e o Garantir vaga (fase 1)

| Estado | O que aparece | Botão |
|---|---|---|
| **Agendado** | capa, título, descrição, **Quarta, 5/11 às 20:00 (horário de Brasília)**, duração, apresentador, contagem regressiva, "{n} alunos com vaga garantida" (só se a equipe ligar) | **Garantir vaga** |
| **Vaga garantida** | o mesmo, com o selo **Vaga garantida** e **Adicionar ao calendário** (arquivo `.ics`, Google Agenda, Outlook) | **Cancelar minha vaga** |
| **Vagas esgotadas** (só com limite de vagas) | "As vagas acabaram. O replay fica disponível depois." | sem botão |
| **Aguardando o apresentador** (da hora marcada até o apresentador abrir a sala; Live gravada: até 15 min antes da sessão) | sala de espera com a capa, "O apresentador já vai começar", chat aberto se a equipe deixou | **Entrar** |
| **Ao vivo** | o mesmo card com o selo **Ao vivo** e o número de presentes | **Entrar** |
| **Encerrada** | "Essa live acabou." e, quando o replay fica pronto, o player | **Assistir o replay** |
| **Cancelado** | "Essa live foi cancelada." com o motivo que a equipe escreveu | nenhum |

- **Garantir vaga** é um clique, sem formulário: a área já sabe quem é o aluno. A confirmação é um toast **Vaga garantida. Avisamos você 1 dia e 1 hora antes.** com **Adicionar ao calendário**.
- **Adicionar ao calendário** abre três opções:
  - **Baixar arquivo** (`.ics`, servido pela nossa rota, sem serviço de fora);
  - **Google Agenda** (link de "criar compromisso" já preenchido);
  - **Outlook** (link equivalente do Outlook na web).
  O compromisso leva título, data e hora, duração, o endereço da sala e "Entre pela área de membros". Lembrete do calendário: 15 minutos antes (o do aparelho, não o nosso).
- Na Live gravada com **Em horários marcados**, o aluno escolhe a sessão antes de garantir vaga (**Quarta 20:00 · Quinta 10:00 · Quinta 20:00**); com **Começa quando você entra** (fase 4), não há vaga: só **Entrar**.
- A vaga é **opcional** (D8): quem tem acesso entra na hora sem ela; ela serve para os lembretes e para o **Começa em 1 h: Entrar**. Com **limite de vagas** ligado pela equipe, só quem garantiu vaga entra (a decidir, §12.3). Não há lista de espera nesta versão: com as vagas esgotadas o botão some e o replay fica para todos com acesso.
- Horários sempre em **São Paulo**; se o relógio do aparelho estiver em outro fuso, uma linha menor mostra **(no seu horário: 21:00)**.
- Quem perde o acesso ao produto (reembolso, fim) perde a vaga sem aviso na tela; o lembrete não é enviado.
- **Como ficou na entrega 1b (29/10/2026)**: a confirmação **Vaga garantida. Avisamos você 1 dia e 1 hora antes.** é uma linha inline com `aria-live` (a área do aluno não monta Toaster), com **Adicionar ao calendário** ao lado; a faixa **Começa em 1 h: Entrar** nasce só na página inicial (o encaixe no cabeçalho de todas as páginas chega com a faixa **Ao vivo agora**, fase 3); **Entrar** (Aguardando o apresentador / Ao vivo) e **Assistir o replay** aparecem desligados com **em breve** até as fases 3 e 2; no "ver como" da equipe nada é gravado (botões desligados e nenhuma vaga lida).

### 1.3 A sala da Live ao vivo (fase 3)

A sala abre em tela cheia por cima da área, no mesmo desenho dos cinco prints do produtor:

| Parte | O que tem | Celular |
|---|---|---|
| **Cabeçalho** | título, selo **Ao vivo** com o tempo no ar (**Ao vivo · 00:42:10**), o número real de presentes (**{n} assistindo**), **Minimizar** e **Sair** | igual, menor |
| **Palco** | o apresentador (ou quem ele destacou, ou a tela compartilhada) em 16:9; com dois no palco, lado a lado; **Tela cheia** no canto | o palco ocupa a largura |
| **Fileira** (filmstrip) | o apresentador, os co-apresentadores, quem está com o microfone liberado e os alunos que abriram a câmera, em páginas de até 8 miniaturas (quem falou por último primeiro); cada aluno recebe no máximo 8 vídeos pequenos além do palco (D26) | vira uma fileira rolável sob o palco, com menos miniaturas |
| **Painel à direita** | abas **Chat** · **Perguntas** · **Participantes** · **Enquetes** (a aba Enquetes só aparece quando há enquete aberta; **Participantes** mostra o palco e o número de alunos, nunca a lista inteira dos alunos) | vira gaveta pela aba de baixo; o chat sobreposto no vídeo com as 3 últimas mensagens quando a gaveta está fechada |
| **Barra do aluno** | **Reagir** (👏 ❤️ 😂 🔥 👍 😮: seis reações, as mesmas de `webinar_reactions`), **Levantar a mão** / **Abaixar a mão**, **Câmera** (desligada ao entrar; o aluno liga se quiser, depois do aviso de gravação e de consumo), **Microfone** (só aparece depois de liberado), **Tela cheia**, **Som** | igual, 44 px cada |
| **Barra do apresentador** | Microfone, Câmera, Compartilhar tela, Gravar, Enquete, Reações, Mão levantada ({n}), Participantes, Mais (§1.4) e **Encerrar live** | o apresentador usa computador |

- **Sem marca e sem nome do Jitsi** (D2): dentro do vídeo (instância própria, §6.2) e também na nossa página: nenhum texto de carregamento, de erro ou de ajuda cita "Jitsi"; o `external_api.js` é servido do nosso hostname (`meet.<domínio>`), nunca de `meet.jit.si`; o único lugar em que o nome aparece é a página de créditos de software livre da área (licença Apache-2.0, ao lado dos outros créditos, em Ajuda › Termos; sem logo e sem link na sala).
- **Minimizar**: a sala vira uma pílula flutuante no canto inferior (capa pequena, **Ao vivo**, **Voltar**) e o aluno navega pela área ouvindo a live. O pop-up da Comunicação não abre com a pílula no ar (`src/lib/lesson-media-signal.ts`, a mesma trava do player da aula).
- **Estados**: **Aguardando o apresentador** (sala de espera com chat, se a equipe deixou; quando a sala está trancada: "A sala está cheia ou fechada. Fique aqui: avisamos quando abrir.") → **Ao vivo** → **Encerrada** ("Essa live acabou. O replay fica pronto em algumas horas." e, pronto, o botão **Assistir o replay**).
- **Perder a conexão**: o vídeo mostra **Reconectando…** e volta sozinho; o chat continua pelo nosso app (ele não depende do Jitsi); as mensagens enviadas sem conexão ficam com um relógio e saem ao voltar. Para a presença, uma queda menor que **90 s (3 baldes)** não conta como saída (padrão, a confirmar no piloto; §4.7, D19). Depois de 3 tentativas: **Não conseguimos voltar. Tentar de novo** e o chat segue funcionando.
- **Câmera do aluno** (D4): todo aluno pode abrir a câmera se quiser. Ela entra desligada; o primeiro clique mostra o aviso de gravação de §8.5 (imagem) e o consumo (cerca de 0,3 GB por hora enviados); o vídeo do aluno sai em no máximo 360p e aparece nas miniaturas, nunca no palco (só quando o apresentador o convida ao palco). O apresentador pode fechar a câmera de um aluno ou de todos, e pode desligar as câmeras de alunos no webinário inteiro (card Sala). O microfone só existe quando o apresentador libera (§1.4): o aluno vê o aviso de gravação de §8.5 e os botões **Falar** / **Agora não** (o navegador exige esse clique, igual ao Zoom). Enquanto fala, ele entra na fileira; o apresentador pode silenciar de volta a qualquer momento.
- **Chat**: nome como **primeiro nome + inicial** (ou o apelido do perfil); mensagens da equipe com o selo **Equipe**, do apresentador com **Apresentador**, do agente de IA com **Assistente**. Na **primeira mensagem** do aluno em qualquer Webinário aparece o texto de consentimento de §8.5 (o mesmo, palavra por palavra; passa por revisão jurídica, A4) com os botões **Entendi e quero participar** e **Participar como anônimo** (aparece como **Aluno {n}**, número por sessão). O botão **Remover minhas mensagens** fica no menu ⋯ do chat e em Perfil › Privacidade. Respostas em linha (responder a uma mensagem), sem mensagem privada entre alunos. Com **chat moderado**, a mensagem mostra **Aguardando a equipe** até ser liberada. Com **modo lento**: **Você pode enviar de novo em 20 s**. Palavras bloqueadas e limite de rajada são os das aulas (`src/server/comments/comment-validation.ts`).
- **Perguntas**: aba própria. **Fazer uma pergunta** (opção **Anônima**), lista com **Curtir** para subir a pergunta, situação **Respondida ao vivo** / **Respondida por escrito** (com o texto) / **Dispensada** (some para quem não é o autor); filtro **Todas** / **Respondidas**. Uma mensagem do chat pode virar pergunta pela equipe (fica ligada por `webinar_questions.message_id`).
- **Reações**: sobem flutuando pelo canto do palco por 3 s, sem som, respeitando `prefers-reduced-motion` (viram um contador discreto).
- **Enquetes**: a enquete aberta aparece na aba e como um card por cima do chat; resposta única ou múltipla; **Enviar**; depois, o resultado só se o apresentador compartilhar; a enquete fecha com **Encerrada**.
- **Encerrada → Replay**: a mesma página vira o replay (player da Bunny com barra livre) com o chat da live reaparecendo pelo segundo do vídeo (aba **Chat da live**) e as perguntas respondidas por escrito. O replay é a Live gravada no modo **Replay livre** (§1.6).

### 1.4 Controles do apresentador (nome equivalente do Zoom entre parênteses)

| Controle | O que faz | Onde |
|---|---|---|
| **Silenciar todos** (Mute all) | corta o microfone de todo mundo no palco e dos alunos liberados | Participantes |
| **Fechar câmera** (Stop video) | fecha a câmera de um aluno; ele pode reabrir, a menos que as câmeras de alunos estejam desligadas no webinário | Participantes › ⋯ |
| **Fechar todas as câmeras** / **Permitir câmeras dos alunos** (Stop all video / Allow participants to start video) | fecha todas de uma vez; com a permissão desligada, nenhum aluno abre a câmera (`toggleModeration` de vídeo) | Participantes |
| **Permitir que o aluno abra o microfone sozinho** (Allow participants to unmute themselves) | opção visível, **desligada** por padrão e fixa assim na v1: o aluno só fala depois de **Liberar microfone** | Participantes |
| **Liberar microfone** (Ask to unmute) | na fila de mão levantada, **Liberar**; o aluno aceita com um clique; **Silenciar** desfaz | Mão levantada |
| **Abaixar a mão** (Lower hand) | abaixa a mão de um aluno só, sem liberar | Mão levantada › ⋯ |
| **Abaixar todas as mãos** (Lower all hands) | limpa a fila | Mão levantada |
| **Remover da sala** (Remove) | tira o aluno; ele vê "Você foi removido desta live" e não volta nesta sessão (`webinar_session_bans`, `kind = kicked`) | Participantes › ⋯ |
| **Banir** | remove e impede de entrar em qualquer Webinário até a equipe desfazer no admin | Participantes › ⋯ |
| **Trancar a sala** (Lock meeting) | ninguém mais entra; quem chegar vê a sala de espera com a frase de sala trancada | Mais |
| **Sala de espera** (Waiting room / lobby) | ligada: todo aluno espera até **Admitir** / **Admitir todos**; desligada por padrão (quem pode, entra). A **Sessão de prática** é o lobby do Jitsi ligado até **Começar para todos**; depois disso o lobby segue esta opção | Mais e Participantes |
| **Destacar** (Spotlight) | fixa um participante do palco para todos; **Tirar destaque** | fileira › ⋯ |
| **Convidar ao palco** (Promote to panelist) | sobe um aluno ou membro da equipe com câmera e microfone; **Tirar do palco** (Demote) | Participantes › ⋯ |
| **Compartilhar tela** (Share screen) | tela, janela ou aba, com som da aba quando o navegador deixa | barra |
| **Gravar** / **Parar gravação** (Record) | liga a gravação no servidor de gravação criado para a sessão (D3); selo **Gravando** para todos; sem o servidor pronto, o botão fica desligado com "Gravação não preparada para esta live" ou, enquanto prepara, "Preparando a gravação, {n} min" (§6.7) | barra |
| **Enquete** (Polls) | criar na hora ou abrir uma pronta; **Abrir**, **Encerrar**, **Compartilhar resultado**; anônima ou não | barra |
| **Perguntas** (Q&A) | **Responder ao vivo** (marca e mostra a pergunta no palco), **Responder por escrito**, **Dispensar** / **Reabrir**; ordenar por **Mais curtidas** / **Mais recentes**; **Permitir anônimas** | aba Perguntas |
| **Quem pode escrever no chat** (Chat: Everyone / Hosts and panelists / No one) | **Todos** / **Só a equipe** / **Ninguém** | Mais › Chat |
| **Chat moderado** | toda mensagem espera a equipe liberar | Mais › Chat |
| **Modo lento** (Slow mode) | um envio a cada 10 / 20 / 30 / 60 s por aluno (`chat_slow_mode_seconds`) | Mais › Chat |
| **Apagar mensagem** | some para todos, com "mensagem removida pela equipe" para o autor | chat › ⋯ |
| **Silenciar no chat** (Mute participant chat) | o aluno continua assistindo, mas não escreve por 5 / 15 / 60 min ou até o fim (`webinar_session_bans`, `kind = muted`, `until_at`) | chat › ⋯ |
| **Fixar mensagem** (Pin) | fixa no topo do chat (um link, um aviso) | chat › ⋯ |
| **Encerrar live** (End webinar for all) | confirma, para a gravação, fecha a sala e manda todo mundo para a tela **Encerrada** | barra |
| **Seguir a visão do apresentador** (Follow host's view) | o que o apresentador destaca é o que todos veem; sempre ligado na v1 | sem botão |
| **Sessão de prática** (Practice session) | o apresentador e a equipe entram antes sem os alunos (lobby do Jitsi ligado); **Começar para todos** abre a sala | antes de iniciar |

Quem faz o quê (regra única, §5.4 e D15): o **Apresentador** (host) é o membro da equipe marcado no card Dados (`webinars.host_user_id`, precisa de `messaging.publish`) e tem tudo; o **co-apresentador** (`webinar_presenters`, `role = co_host`) tem tudo menos **Encerrar live** e **Banir**; a **Equipe** (`messaging.write`) tem os controles do nosso app (chat, perguntas, enquetes, fila de mão levantada, silenciar no chat) e só tem **Remover da sala** e **Silenciar todos** (controles do Jitsi, que exigem `moderator` no token) quando marcada no editor como moderadora da sala (caixa **Pode remover e silenciar na sala**); a Equipe não tem câmera nem microfone no palco a menos que seja convidada.

### 1.5 A sala e a Comunicação

- **Nenhum pop-up dentro da sala** nem com a pílula do Minimizar no ar (a página do Webinário entra na lista de "onde nunca" do `docs/25`).
- A **faixa "Ao vivo agora"** e o **sino** convivem: a faixa é a chamada enquanto a live está no ar; o sino guarda o histórico (lembretes, **Começou agora**, **Replay disponível**). O sino abre por cima da sala minimizada, nunca por cima da sala aberta.
- O card da página inicial e a faixa somem sozinhos ao encerrar; um aviso ou pop-up criado pela equipe no card **Avisar** segue as regras da Comunicação (Termina, Quantas vezes) e a equipe o encerra como qualquer aviso.
- Com dois Webinários ao mesmo tempo, a faixa mostra o mais recente e **+1 ao vivo** leva para `/webinarios`.

### 1.6 A Live gravada (fase 2, com partes nas fases 3 e 4)

**Sessões.** A mesma gravação pode ter várias sessões, e cada uma tem o próprio modo:

| Modo | O que o aluno vê | Equivalente no Hot Webinar (conferido no site em 28/10/2026) | Fase |
|---|---|---|---|
| **Em horários marcados** | a sessão aparece em Próxima live com a hora; quem entra atrasado cai no minuto em que a sessão está (sem voltar); várias por dia (ex.: 10:00, 15:00, 20:00) | sessões recorrentes em vários horários do dia | 2 |
| **Replay livre** | player com barra, pausar e voltar; o chat da live reaparece pelo segundo do vídeo; dá para comentar | replay com 100 % das funções | 2 |
| **Começa quando você entra** | ao abrir a página, "A próxima sessão começa em 5 min" e a sala abre para aquele aluno; cada aluno tem a própria linha do tempo; o chat original reaparece do mesmo jeito; os comentários novos da turma do dia aparecem pelo segundo em que foram escritos | just-in-time | 4 (PR 4e; a pesquisa recomendou deixar fora da v1) |

**A sala** é a mesma da Live ao vivo (§1.3), com estas diferenças:

- O vídeo é o player da Bunny **travado no relógio do servidor**: sem barra, sem pausar, sem voltar. Entra sem som para passar pelo bloqueio do navegador e mostra o botão **Ativar som** por cima do vídeo até o primeiro toque. Quem sai e volta cai no minuto atual, não onde parou. Se o aparelho atrasar mais que 2 s, o player é recolocado no ponto certo sem o aluno notar.
- O cabeçalho mostra **Sessão das 20:00** e o tempo decorrido. O selo **Ao vivo** e o contador simulado só aparecem quando a equipe ligou na **Simulação** daquela sessão (D10); sem eles, o selo é **Sessão** e o contador é o número real da turma.
- **O chat original reaparece** mensagem por mensagem, no mesmo segundo em que foi escrita na live real, com o primeiro nome de quem autorizou (quem removeu ou não autorizou aparece como **Aluno {n}**). **Comentários novos** da turma de hoje aparecem na hora para quem está na mesma sessão, marcados por dentro como da turma (`source = audience`); só entram no histórico das turmas seguintes depois que a equipe aprovar (como o "salvar comentários reais" do Hot Webinar).
- O aluno comenta, pergunta, reage e responde enquetes normalmente; mão levantada, microfone e câmera não existem na Live gravada.
- Ao fim do vídeo: **Encerrada**, com **Assistir de novo** (abre o Replay livre) quando a equipe deixa.

**As funções do Hot Webinar, uma a uma:**

| Função | O que o aluno vê | Equivalente no Hot Webinar (conferido no site) | Fase |
|---|---|---|---|
| **Roteiro de chat** | comentários prontos (escritos pela equipe ou gerados por IA) chegando no chat como se fossem de alunos ou da equipe, soltos (a) num minuto do vídeo, (b) quando o apresentador diz uma frase (alinhado pela transcrição da gravação, a mesma infraestrutura de `src/server/ai/transcripts.ts`) ou (c) pelo botão da equipe na hora | chat simulado / comentários programados | 2 (a, c) · 2 (b, se a transcrição estiver pronta; senão 4) |
| **Importar e exportar CSV do roteiro** | nada; é da equipe (traz o chat da live real ou de outra ferramenta) | importar chat em CSV | 2 |
| **Selo "Ao vivo" por sessão** | o selo no cabeçalho e na faixa, só quando a equipe ligou e registrou a decisão (D10) | selo de live | 2 (só o selo, com a decisão registrada; ponto aberto §12.3: o produtor pode querer já na primeira Live gravada) |
| **Contador de plateia simulado** | "{n} assistindo" com o número que a equipe configurou somado ao real; só quando ligado na sessão | contador de participantes | 4 |
| **Entradas e saídas simuladas** | "Ana M. entrou" no chat em ritmo configurado; só quando ligado | notificações de entrada | 4 |
| **Notificações de venda simuladas** | "Carlos acabou de garantir a vaga na Formação" num toast discreto; só quando ligado | notificações de compra | 4 |
| **Agente de IA no chat** | respostas com o selo **Assistente** a perguntas da turma, 24 h, com o conhecimento do Webinário e do produto (reaproveita o gateway de IA e o padrão do Tutor em `src/server/ai/tutor.ts`); o aluno pode pedir **Falar com a equipe** | IA que responde no chat | 4 |
| **Atendentes humanos** (modo híbrido) | mensagens com o selo **Equipe**, de quem está atendendo na hora; sem ninguém, "A equipe responde depois pelo sino" | atendimento humano com distribuição | 2 (a equipe responde) · 4 (distribuição entre atendentes) |
| **Oferta** | um card de compra que aparece no minuto que a equipe marcou (ou pelo botão), com título, preço, selo, prazo e **Quero participar**, que abre o checkout em outra aba; cada aluno vê sempre a mesma variante (A, B, C ou D) | oferta com testes A/B e conversão por sala | 4 (uma variante só: a decidir se antecipa para 2, §12.3) |
| **Sala Live vertical 9:16** | no celular em pé: vídeo em tela cheia, selo e contador no topo, chat sobreposto embaixo, card de oferta como uma pílula que abre | sala para celular | 4 |
| **Tradução automática** | chat e roteiro em PT, EN ou ES pela escolha do aluno (legendas do vídeo ficam de fora) | tradução | 4 (fase final) |
| **Follow-up por segmento** | nada na sala; depois, avisos e pop-ups da Comunicação para "viu a oferta", "saiu antes da oferta", "clicou e não comprou", como regras novas do segmento | segmentação pós-webinário | 2 (vaga garantida / compareceu / viu o replay) · 4 (as da oferta) |
| **Métricas** | nada na sala | relatório de visitantes, participantes, cliques, compras, retenção, receita | 2 (relatório do Webinário) · 4 (painéis) |

Tudo o que é simulado fica marcado por dentro: as mensagens do roteiro como `source = scripted`, e o contador, as entradas e os avisos de venda nas colunas `simulated_*` da Sessão (§4.3), com os totais congelados em `webinar_sessions.simulation_summary` no fim. Nada disso entra nas métricas reais nem no histórico do chat das turmas seguintes (§3.5).

**Detalhes que mudam a experiência:**

- **Começa quando você entra** (fase 4): a espera de alguns minutos existe para a sala parecer marcada e para o aluno ativar o som; nela, o chat mostra as mensagens de espera do roteiro (segundo negativo). Como cada aluno tem a própria linha do tempo, "a turma" é quem entrou na mesma janela de 15 minutos (valor proposto, a confirmar; a janela é da equipe) e os comentários novos aparecem pelo segundo em que foram escritos. O contador real conta essa janela.
- **Replay livre**: o chat reaparece pelo segundo do vídeo também ao voltar ou pular; as mensagens novas entram pelo segundo em que o aluno estava, nunca pela hora de parede.
- **Oferta**: a variante é sorteada uma vez por aluno e Webinário, guardada e repetida em qualquer sessão ou replay; o aluno que já comprou (webhook de venda) não vê mais o card.
- **Sala Live vertical 9:16**: é a mesma página em outro desenho para o celular em pé, com vídeo em tela cheia e o chat por cima; o aluno gira o aparelho e volta ao desenho normal. Vale para a Live gravada e para o Replay; na Live ao vivo depende de o palco ser gravado em 9:16 (fica de fora até lá).
- **Tradução**: a escolha do idioma fica no perfil do aluno; as mensagens originais são guardadas no idioma em que foram escritas, e a tradução é feita uma vez por mensagem e guardada (nunca na hora, para cada aluno).
- **Agente de IA** (`role = ai`, `source = ai`): responde só quando chamado (a aba **Perguntas** ou "@assistente" no chat) ou quando a equipe liga **Responder tudo**, e nunca enquanto um atendente humano está com a pergunta; nunca finge ser aluno nem equipe; a resposta sai com o selo **Assistente** e a equipe pode apagar ou corrigir. Uma resposta do Assistente a um aluno real não é simulação: no relatório ela fica no bloco próprio **Respostas do Assistente** (§3.5).

### 1.7 Textos, acessibilidade e 375 px

- A sala é um diálogo de tela cheia (`aria-modal`, foco preso, Esc fecha com confirmação quando ao vivo). O chat anuncia mensagens novas pelo leitor de tela em `aria-live="polite"`, nunca cada reação; perguntas e enquetes têm caminho pelo teclado; a fila de reações respeita `prefers-reduced-motion`.
- A 375 px: palco na largura, gaveta com as abas, barra do aluno com 44 px por botão, a faixa global com uma linha e o X, a pílula do Minimizar com 56 px.
- Vídeo sem legendas na v1 (legendas automáticas ficam de fora; o replay pode ganhar legendas pela Bunny depois).
- Falhas são ditas em uma frase e com um botão (**Tentar de novo**), nunca em silêncio: a sala não abre sem a chave do servidor, sem acesso ou com a sessão encerrada. Nenhuma dessas frases cita o Jitsi (D2).

### 1.8 O que é registrado (invisível para o aluno)

- Vaga garantida e cancelada, lembretes enviados, **Entrar** clicado, entrada e saída da sala com hora (cada uma, não só a última), presença a cada 15 s (balde de 30 s) com o segundo do vídeo e o estado (tocando, sem som, aba escondida), som ativado, mensagem, reação, pergunta, curtida, resposta de enquete, mão levantada, microfone aceito, oferta vista e clicada, variante da oferta, replay assistido. Tudo em `student_events` com `entity_type = 'webinar'` e nas tabelas do Webinário (§4).
- O aceite do chat fica registrado uma vez por aluno (`webinar_chat_consented`, com `consent_version`), com a hora.
- Nada do aluno vai para o Jitsi além do nome de tela e do papel, numa chave assinada pelo nosso servidor que vale só para aquela sala e por aquele tempo.

---

## 2. O que a equipe faz (`/admin/comunicacao/webinarios`)

### 2.1 A lista

A aba **Webinários** da Comunicação troca a moldura atual (`src/app/admin/(v2)/comunicacao/webinarios/page.tsx`, hoje com "—" e "em construção") por:

- **Abas da página** (`section-tabs.tsx`): **Webinários · Lives ao vivo · Lives gravadas**. As duas últimas são os painéis de §3; antes da fase 3, a aba **Lives ao vivo** existe com o estado vazio **Sem lives ao vivo ainda**.
- **Números do período** (menu **Período** da barra superior, `src/components/admin/v2/period.ts`): **Webinários**, **Vagas garantidas**, **Compareceram** (entraram na sala), **Assistiram o replay**, **Ao vivo agora**. Sem dado: "—" e "Sem dados no período".
- **Tabela**: capa pequena, título, **Live ao vivo** / **Live gravada**, data e hora (São Paulo), situação, vagas garantidas, presentes (pico), quem criou. Filtros em pílula: **Todos · Rascunho · Agendado · Em andamento · Encerrado · Cancelado** e **Ao vivo · Gravada**. Busca por título.
- Menu ⋯ por linha: **Abrir**, **Abrir a sala** (quando agendado ou em andamento), **Duplicar**, **Cancelar**, **Excluir** (só rascunho).
- Botão no topo: **Novo webinário**.

### 2.2 Novo e o editor (`/novo` e `/[id]`)

**Novo webinário** pergunta primeiro o tipo em duas pílulas (**Live ao vivo** / **Live gravada**) e abre o editor em cards, no mesmo molde do editor do aviso (`src/components/admin/v2/communication/notice-editor.tsx`). Rascunho salva sem exigir nada; **Publicar** exige o que cada card marca.

| Card | Campos | Regras e frases |
|---|---|---|
| **Dados** | tipo (trava depois de publicar), título, capa (16:9 e 2:3, como as de produto), descrição, **Apresentador** (um membro da equipe com `messaging.publish`; vira `host_user_id`), **Co-apresentadores** (contas da área, até 5; `webinar_presenters` com `role = co_host`), **Equipe da sala** (membros com `messaging.write`; caixa **Pode remover e silenciar na sala** por pessoa), **data e hora** (São Paulo), **duração** prevista; na Live gravada, **Vídeo** (escolher na biblioteca da Bunny ou enviar; mostra duração e se já tem transcrição) | "Publique com pelo menos 1 hora de antecedência: quem já está com a área aberta só vê o card na próxima página." Live gravada sem vídeo pronto não publica: "O vídeo ainda está processando na Bunny." |
| **Sessões** (só Live gravada) | lista de sessões: **Em horários marcados** (data/hora, repetir todo dia / em dias da semana, até quando), **Replay livre** (liberar depois da última sessão / sempre / nunca), **Começa quando você entra** (aparece desligado com "em breve" até a fase 4; depois: a cada 15 / 30 / 60 min, janela de horas); **Entrada atrasada** (até o fim / até {n} min) | "Cada sessão tem a própria Simulação e o próprio relatório." |
| **Quem pode** | **Todos** / **Segmento** / **Quem tem o produto X** (o construtor de segmentos da Comunicação, `src/components/admin/v2/communication/audience-builder.tsx`); **Limite de vagas** (opcional, número); **Mostrar quantos garantiram vaga** | "Quem não passa por aqui não vê o webinário em lugar nenhum." Com limite: "Só quem garantir vaga entra." Com segmento: "Quem entrar no segmento agora vê o webinário em até 15 min." |
| **Vaga e lembretes** | **Garantir vaga** ligado (padrão) ou "Entrar direto, sem vaga"; lembretes **1 dia antes** e **1 hora antes** (ligados por padrão) pelo **sino** e por **e-mail** (WhatsApp aparece desligado com "em breve"); textos da confirmação, do lembrete de 1 dia, do lembrete de 1 hora e do **Começou agora**, com prévia; **Depois da live**: e-mail para quem veio e outro para quem não veio (opcional) | "O e-mail sai pela fila com os outros e-mails da área (Resend)." Texto vazio volta ao padrão (§2.7). |
| **Avisar** | **Card na página inicial** (e por quantos dias o Replay disponível fica), **Faixa no topo** (ao vivo e 1 h antes para quem garantiu vaga), **Pop-up** e **Fluxo** (atalhos que abrem um aviso ou um fluxo da Comunicação já ligado a este Webinário, com o botão **Entrar na live**) | "O pop-up segue as regras dos pop-ups (um de cada vez, nunca na sala)." |
| **Sala** | controles padrão ao começar: **Todos entram sem microfone** (fixo), **Permitir que o aluno abra o microfone sozinho** (desligado, fixo na v1), **Câmeras dos alunos** (permitidas por padrão; entram desligadas e o aluno liga se quiser; `allow_student_camera`), **Sala de espera** (desligada), **Sessão de prática** (ligada: é o lobby do Jitsi até **Começar para todos**); **Chat**: aberto / moderado / só a equipe / desligado, **Modo lento** (desligado / 10 / 20 / 30 / 60 s); **Perguntas** (ligadas, anônimas permitidas), **Enquetes** (prontas para abrir na hora), **Reações** (ligadas); **Como o aluno aparece**: primeiro nome + inicial (padrão) / apelido / sempre anônimo; na Live gravada: **Comentários novos aparecem para a turma** (ligado) e **Entram no histórico só depois de aprovados** (fixo) | "A câmera do aluno sai em 360p, entra desligada e o apresentador fecha quando quiser." |
| **Qualidade** (D26) | **Câmera do palco**: 720p (padrão) ou 1080p; **Tela compartilhada**: 1080p a 30 quadros por segundo (padrão) ou 15 (menos banda, mesma nitidez para texto parado); **Miniaturas**: até 360p (fixo; 180p na fileira pequena, automático); **Câmera dos alunos**: até 360p (fixo); **Gravação**: 1080p (fixo) | "Cada aluno recebe o tamanho que cabe na tela dele; em 4G cai sozinho para 720p ou 360p." Com 1080p no palco, o card mostra a banda por aluno (cerca de 5 a 8 Mbit/s) e a meta de alunos do servidor (§7.1). |
| **Roteiro de chat** (só Live gravada) | linha do tempo do vídeo com as mensagens: **Importar CSV** (da nossa live real, de outra ferramenta; colunas tempo, nome, papel, mensagem; aviso se a duração do vídeo não bate), **Gerar com IA** (quantas, tom, idioma, a partir da transcrição), editar em linha (texto, nome, papel, segundo), **Solta em**: **Num minuto do vídeo** / **Quando o apresentador diz** (campo de frase; a sala mostra o segundo achado na transcrição e um **Ouvir**) / **Pelo botão da equipe** (vira um botão nomeado no console); **Alinhar chat** (+/− segundos com prévia, para chat importado da live real; grava `anchor_offset_ms` na gravação); **Exportar CSV** | "Mensagens do roteiro nunca entram nas métricas reais." Sem transcrição: "Transcreva o vídeo para soltar mensagens por frase dita." |
| **Simulação** (só Live gravada, por sessão) | fase 2: **Selo "Ao vivo"** (desligado por padrão) com a caixa de confirmação de §8.6; fase 4: **Contador de plateia** (real / real + {n} / real + faixa que varia), **Entradas e saídas** (desligado / a cada {n} s com nomes genéricos), **Notificações de venda** (desligado / lista de nomes e produtos, ritmo) | Aviso curto fixo no card: "Pela lei (CDC, art. 37), nunca anuncie uma sessão gravada como ao vivo fora da área de membros. Dentro dela, o selo e os números simulados são sua decisão e ficam registrados com seu nome e a data." Números simulados aparecem no relatório só no bloco **Simulação**. |
| **Oferta** (fase 4) | variantes **A / B / C / D** (título, selo, preço de/por em texto, cupom, **link de checkout**, imagem), **Quando aparece** (num minuto do vídeo / pelo botão / nunca), **Some em** (minutos ou até o fim), **Divisão** (igual entre as variantes ligadas) | "O checkout é fora (Hotmart, Ticto). A compra é ligada ao aluno pelos webhooks de venda que já existem." |
| **Gravação** (só Live ao vivo) | **Gravar automaticamente** (ligado): "Um servidor de gravação é criado antes da live e apagado no fim, cobrado por hora (uma live de 2 h gravada em 1080p custa cerca de EUR 0,30)." com a situação (`recorder_status`: **Não preparado** `none` / **Preparando** `preparing` / **Pronto** `ready` / **Gravando** `recording` / **Enviando para a Bunny** `uploading` / **Pronto na Bunny** `uploaded` / **Falhou no envio** `upload_failed` / **Sem gravador hoje** `unavailable` / **Apagado** `gone`); **Enviar arquivo** (reserva: gravação do navegador do apresentador ou do OBS) | Sem o servidor pronto na hora, o apresentador vê o botão Gravar desligado e a equipe recebe o aviso no console. |
| **Publicar replay como aula** | **Produto › módulo** (como `docs/17` §1.8.3), título da aula, **publicar sozinho quando o replay ficar pronto** | "O replay vira uma aula com vídeo da Bunny; o chat da live fica na página do webinário." |

Campos em branco mostram "—" na prévia; a prévia à direita desenha a página do aluno e o card da página inicial no celular e no computador, como no editor do aviso.

**Como ficou na entrega 1a (29/10/2026)**, o que a tabela acima promete e ficou para as fases seguintes (tudo aparece desligado com **em breve** ou não aparece):

- **Dados**: uma capa só (2:3, a mesma do card do aluno; o 16:9 não existe no modelo: uma coluna `cover_url`); o Apresentador é um `Select` com quem tem `messaging.publish`; co-apresentadores e Equipe com busca e a caixa "Pode remover e silenciar na sala".
- **Vídeo da Live gravada**: um campo com o endereço `https` do player da Bunny (sem biblioteca, duração nem transcrição; isso chega com o roteiro, fase 2).
- **Sessões**: só **Em horários marcados**, uma a uma (sem repetir / até quando); **Replay livre** nasce na fase 2; **Começa quando você entra** e **Entrada atrasada** ficam em "em breve" (o rascunho só guarda `scheduledAt` por sessão; `late_join_minutes` entra no contrato da fase 2).
- **Quem pode**: quatro pílulas (Todos · Quem tem o produto · Segmento · Produto ou segmento); "Produto ou segmento" só com os dois montados.
- **Vaga e lembretes**: WhatsApp em "em breve"; o sino sempre ligado. **Avisar**: Card na página inicial e Faixa no topo; Pop-up e Fluxo como linhas "em breve" (sem o atalho que cria o aviso ligado ao webinário).
- **Gravação**: situação fixa "Não preparado" e Enviar arquivo em "em breve"; **Roteiro de chat**, **Simulação** e **Oferta** não aparecem (fases 2 e 4). **Publicar replay como aula**: produto pelo `ProductPicker` e o módulo por um identificador em texto.
- Botões **Abrir a sala**, **Abrir o console**, **Encerrar live**, **Ver relatório** e **Publicar replay** desligados com "em breve" (topo do editor, menu ⋯ e a linha agendada da lista). Na lista, **Presentes (pico)**, **Compareceram** e **Assistiram o replay** mostram "—"; as abas Lives ao vivo / Lives gravadas só com o estado vazio.
- **Duplicar** aparece no menu ⋯ em qualquer situação (§2.1); **Excluir** (só rascunho) pede `messaging.publish`. Publicado: salvar aplica as regras de publicar (menos a data passada que não mudou) e o tipo trava.

### 2.3 Situações e botões

| Situação | Como entra | Botões no topo |
|---|---|---|
| **Rascunho** | ao criar | **Salvar**, **Publicar**, **Excluir** |
| **Agendado** | **Publicar** (card na página inicial, faixa e lembretes passam a valer; `room_name` é gerado aqui, §8.1) | **Salvar**, **Abrir a sala** (sessão de prática), **Cancelar**, **Duplicar** |
| **Em andamento** | o apresentador clica **Começar para todos** (Live ao vivo) ou a sessão chega na hora (Live gravada) | **Abrir o console**, **Encerrar** |
| **Encerrado** | **Encerrar live**, o fim do vídeo da última sessão, ou 2 h depois da hora marcada sem ninguém começar (aviso para a equipe antes; número proposto, §12.3) | **Ver relatório**, **Publicar replay**, **Duplicar** |
| **Cancelado** | **Cancelar** com motivo; sino e e-mail **Live cancelada** para quem tinha vaga | **Duplicar** |

- **Duplicar** copia tudo menos data, vagas, chat e relatório. **Cancelar** depois de publicado pede confirmação com o número de alunos com vaga.
- Mudar data ou hora de um agendado reenvia a confirmação ("A live mudou para…") e recalcula os lembretes.

### 2.4 O console da equipe durante a sessão (`/[id]/sala`)

Uma tela só, para quem está apresentando ou atendendo, com a mesma sala do aluno no meio e, ao redor:

| Painel | O que faz |
|---|---|
| **Mão levantada** | fila por ordem, **Liberar** / **Abaixar a mão** / **Pular**, quem está falando com **Silenciar** |
| **Perguntas** | fila com curtidas, **Responder ao vivo**, **Responder por escrito**, **Dispensar**, **Fixar no palco** |
| **Chat** | tudo que o aluno vê mais os pendentes do chat moderado (**Liberar** / **Recusar**), ⋯ com **Apagar**, **Silenciar 5/15/60 min**, **Remover**, **Banir**, **Fixar**; **Quem pode escrever** e **Modo lento** no topo; respostas da equipe saem com o selo **Equipe**; na Live gravada, **Aprovar para as próximas turmas** nas mensagens novas |
| **Roteiro** (Live gravada) | a linha do tempo correndo com o que já saiu e o que vem; os botões nomeados **Pelo botão da equipe**; **Soltar agora** em qualquer mensagem; **Pausar roteiro** |
| **Enquetes** | as prontas: **Abrir**, **Encerrar**, **Compartilhar resultado**; criar uma nova |
| **Oferta** (Live gravada, fase 4) | **Mostrar agora** / **Esconder**, contagem de cliques por variante ao vivo |
| **Presença** | número de presentes agora, pico, mensagens por minuto, curva dos últimos 30 minutos |
| **Gravação** (Live ao vivo) | situação do servidor de gravação (`recorder_status`); **Gravar** / **Parar**; o segundo da âncora (`recording_anchor_at`, hora em que a gravação começou) e **Alinhar chat** (+/− s, grava `anchor_offset_ms`) depois do fim |
| **Atendimento** (fase 4) | quem da equipe está online, distribuição das perguntas novas entre os atendentes, **Assumir**; o Assistente de IA fica em silêncio nas perguntas que um atendente assumiu |

Cada ação da equipe fica no histórico do Webinário (quem, o quê, quando) e na auditoria do admin.

### 2.5 O relatório de cada Webinário (`/[id]`, aba **Relatório**)

Aparece depois da primeira sessão, com cache de 60 s por função SQL como o relatório do pop-up (`docs/29` §2.6 e §4.6): números (vagas garantidas, compareceram, taxa de comparecimento, pico de presentes, tempo médio assistido, assistiram o replay, mensagens, perguntas, reações, respostas de enquete, cliques na oferta, compras), a curva **Presentes minuto a minuto** com as maiores quedas marcadas, **Quem mais comentou** e **Mais quentes** (fórmula escrita na tela), as perguntas e enquetes, e, na Live gravada, por sessão, com o bloco **Simulação** separado e o bloco **Respostas do Assistente** separado. Os CSVs seguem os nomes dos relatórios do Zoom: **Registration**, **Attendee**, **Performance**, **Q&A**, **Poll**, **Survey**. Os painéis **Lives ao vivo** e **Lives gravadas** cruzam todos os Webinários do período (§3).

### 2.6 Quem pode e auditoria

- Ver e editar: `messaging.write`; publicar, iniciar, encerrar e cancelar: `messaging.publish` (como a Comunicação; chaves em `src/server/auth/roles.ts`, página protegida por `requirePageArea("comunicacao")` em `src/server/auth/permissions.ts`).
- Apresentar: o membro da equipe marcado como **Apresentador** no card Dados (`webinars.host_user_id`; precisa de `messaging.publish`) ganha a chave de apresentador da sala; co-apresentadores vêm de `webinar_presenters`; **Equipe** no console: qualquer um com `messaging.write`. Um Professor (`docs/17`) sem `messaging.publish` entra como co-apresentador (A2).
- Toda mudança de situação, cada escolha da **Simulação** e cada ação de moderação ficam na auditoria com quem e quando.

### 2.7 Frases de tela

| Onde | Frase |
|---|---|
| botão | **Garantir vaga** · **Cancelar minha vaga** · **Entrar** · **Assistir o replay** · **Adicionar ao calendário** |
| toast | `Vaga garantida. Avisamos você 1 dia e 1 hora antes.` |
| sino, 24 h | `Amanhã às 20:00: {título}. Sua vaga está garantida.` |
| sino, 1 h | `Começa em 1 hora: {título}. Entre pela área de membros.` |
| sino, começo | `Começou agora: {título}. Entrar.` |
| e-mail, 24 h (template `webinar-reminder-24h` na fila `email_outbox`) | assunto `Amanhã às {hora}: {título}`; corpo: "Olá, {primeiro nome}. Sua vaga está garantida para {título}, amanhã, {data} às {hora} (horário de Brasília). Entre pela área de membros: {link}. Para não receber lembretes desta live, cancele sua vaga na página dela." |
| e-mail, 1 h (template `webinar-reminder-1h`) | assunto `Começa em 1 hora: {título}`; corpo: "Olá, {primeiro nome}. {título} começa às {hora} (horário de Brasília). Entre pela área de membros: {link}." |
| e-mail, cancelada (template `webinar-cancelled`) | assunto `Live cancelada: {título}`; corpo com o motivo escrito pela equipe |
| faixa | `Ao vivo agora · {título} · Entrar` · `Começa em 1 h: Entrar` |
| sala | `Aguardando o apresentador` · `Reconectando…` · `Essa live acabou.` · `Falar` / `Agora não` (depois do aviso de gravação de §8.5) · `Preparando a gravação, {n} min` |
| chat | consentimento e botão **Entendi e quero participar** (texto em §8.5) · `Aguardando a equipe` · `Você pode enviar de novo em {n} s` · `mensagem removida pela equipe` · `Remover minhas mensagens` |
| Live gravada | `Ativar som` · `Sessão das {hora}` · `A próxima sessão começa em {n} min` |
| admin | `Novo webinário` · `Publicar` · `Abrir a sala` · `Abrir o console` · `Encerrar live` · `Começar para todos` · `Sem dados no período` · `Sem lives ao vivo ainda` |
| sino, plano B (servidor do Jitsi fora do ar com live marcada, §7.4) | `A live {título} de hoje mudou: assista à sessão gravada às {hora}. Entrar.` |

Regra dos lembretes no tick: o de 1 h **não sai** se o de 24 h daquele aluno ainda não saiu por atraso do tick e faltam mais de 50 min; nesse caso sai só o de 24 h com o texto ajustado ("Hoje às {hora}"). Cada lembrete sai uma vez (`reminder_24h_sent_at`, `reminder_1h_sent_at`).

### 2.8 O que a equipe não encontra nesta versão

- Salas simultâneas (breakout rooms), legendas automáticas e intérpretes, transmissão para YouTube/RTMP, pesquisa pós-live (Survey) no navegador ao sair (o CSV **Survey** nasce vazio até ela existir), aprovação manual de vaga, lista de espera, tela de criação de links de origem (Source tracking) e WhatsApp nos lembretes.
- Link de origem: a v1 **lê** `?origem=` na página do Webinário e guarda em `webinar_registrations.source` (aparece no relatório e no CSV Registration); não há tela para criar links.
- Quando um desses faltar na tela, o rótulo diz **em breve** e nunca some em silêncio.

### 2.9 Zoom → Bunker707, numa página só (para o produtor conferir)

| No Zoom | Na Bunker707 | Quem | Fase |
|---|---|---|---|
| Mute all | Silenciar todos | Apresentador, co-apresentador, Equipe moderadora | 3 |
| Allow participants to unmute themselves | Permitir que o aluno abra o microfone sozinho (desligado, fixo) | Apresentador | 3 |
| Ask to unmute | Liberar microfone (o aluno aceita) | Apresentador, co-apresentador | 3 |
| Stop video / Stop all video / Allow participants to start video | Fechar câmera / Fechar todas as câmeras / Permitir câmeras dos alunos | Apresentador, co-apresentador | 3 |
| Lower hand / Lower all hands | Abaixar a mão / Abaixar todas as mãos | Apresentador, co-apresentador, Equipe | 3 |
| Remove | Remover da sala | Apresentador, co-apresentador, Equipe moderadora | 3 |
| (sem equivalente) | Banir de qualquer Webinário | Apresentador | 3 |
| Lock meeting | Trancar a sala | Apresentador, co-apresentador | 3 |
| Waiting room | Sala de espera | Apresentador, co-apresentador | 3 |
| Practice session | Sessão de prática → Começar para todos | Apresentador | 3 |
| Spotlight | Destacar | Apresentador, co-apresentador | 3 |
| Promote to panelist / Demote | Convidar ao palco / Tirar do palco | Apresentador, co-apresentador | 3 |
| Share screen | Compartilhar tela | Apresentador, co-apresentador | 3 |
| Record | Gravar / Parar gravação (Jibri por hora) | Apresentador | 3 |
| Polls | Enquetes (nossas) | Apresentador, co-apresentador, Equipe | 2 |
| Q&A | Perguntas (aba própria, nossa) | Apresentador, co-apresentador, Equipe | 2 |
| Chat: Everyone / Hosts and panelists / No one | Quem pode escrever no chat | Apresentador, Equipe | 2 |
| Slow mode | Modo lento 10 / 20 / 30 / 60 s | Apresentador, Equipe | 2 |
| Mute participant chat | Silenciar no chat 5 / 15 / 60 min | Apresentador, Equipe | 2 |
| Pin | Fixar mensagem | Apresentador, Equipe | 2 |
| End webinar for all | Encerrar live | Apresentador | 3 |
| Follow host's view | Seguir a visão do apresentador (sempre ligado) | automático | 3 |
| Registration report | CSV Registration | Equipe (`messaging.write`) | 4 |
| Attendee report | CSV Attendee + lista por aluno | Equipe | 2 (lista) · 4 (CSV) |
| Performance report | CSV Performance | Equipe | 4 |
| Q&A report | CSV Q&A | Equipe | 4 |
| Poll report | CSV Poll | Equipe | 4 |
| Survey report | CSV Survey (vazio até a pesquisa do fim existir) | Equipe | 4 |
| Event performance over time | gráfico "Lives ao longo do tempo" no painel Lives ao vivo | Equipe | 4 |

---

## 3. Métricas e painéis

Tudo nesta seção lê o que a §4 grava. Nada é estimado: um número que o banco não tem aparece como `—`, como a aba Desempenho do produto já faz (`src/components/admin/v2/products/performance-model.ts`, "Nada aqui é simulado"). Os números simulados da live gravada (contador, entradas, comentários do roteiro, avisos de venda) ficam **só** no bloco **Simulação** (§3.5) e nunca entram em nenhum outro número, gráfico, exportação ou regra da Comunicação (D6, D10). O CSV **Performance** e os dois painéis nunca somam o contador simulado: a frase `Estes números são da simulação e não entram em nenhum outro número.` aparece no bloco Simulação e no cabeçalho do CSV `Simulacao`. Um teste de guarda confere que nenhuma consulta de métrica real lê `source in ('scripted')` nem as colunas `simulated_*` (§10.2).

### 3.1 O que vale para os dois painéis

| Regra | Como |
|---|---|
| Onde | `/admin/comunicacao/webinarios` troca a moldura de hoje (`src/app/admin/(v2)/comunicacao/webinarios/page.tsx`, `CommunicationFrame` com `—`) por: a lista, **Novo webinário**, `[id]` (editor e relatório) e os dois painéis, **Lives ao vivo** e **Lives gravadas**, como abas da página (`section-tabs.tsx`) |
| Período | o menu **Período** da barra superior (`readAdminPeriod` / `resolveAdminPeriod`, `src/components/admin/v2/period.ts`): entram as sessões com `scheduled_at` dentro da janela; a comparação "vs. período anterior" dos cartões usa o período anterior que o próprio modelo calcula |
| Filtros da barra | **Produto** (o filtro global `product-filter.tsx`: webinários cujo acesso é por esse produto); o produto também aparece como coluna nas tabelas dos painéis |
| Quem vê | `requirePageArea("comunicacao")`, isto é, `messaging.write`, como os avisos; exportar CSV também `messaging.write` e grava auditoria (`recordAudit`, `src/server/audit/log.ts`) |
| Cache | função SQL por painel e por sessão + `unstable_cache` de 60 s com o minuto do relógio na chave e a tag `webinars`, o mesmo desenho de `getPopupReport` (`popupReportCacheMinute`, `src/server/communications/queries.ts`; `docs/29` §4.6). Nenhuma ação do aluno invalida; as ações da equipe invalidam pela tag |
| Desenho | `KpiTile` (4 por linha, 2 abaixo de 768 px), `ChartCard` com o alternador `Ver como tabela` / `Ver como gráfico` obrigatório em todo gráfico com dados (`chart-card.tsx`), recharts por `src/components/ui/chart.tsx`, barras horizontais simples nos blocos de distribuição (como `popup-report-section.tsx`), tabela `<table>` com `<caption>` e cartões `<dl>` abaixo de 768 px, nada de pizza |
| Equipe | quem tem linha em `admin_roles` nunca conta como aluno (igual ao relatório do pop-up) |
| Carregando / vazio / migração | `Suspense` por bloco; `Sem dados no período`; `Sem lives ao vivo ainda` na aba Lives ao vivo antes da fase 3; `pending-migration-notice.tsx` quando a função SQL não existe |

### 3.2 Painel "Lives ao vivo" (sessões `kind = 'live'`)

**Números do topo** (período; delta contra o período anterior):

| Cartão | Conta | Definição no rodapé |
|---|---|---|
| Lives realizadas | sessões `live` com `ended_at` no período | `encerradas no período` |
| Vagas garantidas | linhas de `webinar_registrations` com `status = 'registered'` dessas sessões | `Garantir vaga` |
| Presentes | alunos únicos com pelo menos 1 amostra de presença | `pelo menos 30 s na sala` |
| Comparecimento | presentes que tinham vaga ÷ vagas garantidas | `Comparecimento: só webinários com Garantir vaga` |
| Pico de presentes | maior `presentes no balde` entre as sessões (média quando há mais de uma) | `no melhor momento` |
| Tempo médio assistido | média de `baldes distintos × 30 s` por presente | `por aluno presente` |
| Viram até o fim | alunos com último balde ≥ 95 % da duração ÷ presentes | `95 %, como no Zoom` |
| Mensagens | `webinar_chat_messages` de alunos (`source = 'audience'`, `deleted_at is null`) | `só alunos` |
| Perguntas respondidas | `status = 'answered'` ÷ perguntas feitas | sem rodapé |
| Viram o replay | alunos únicos com amostra na sessão `replay` do mesmo webinário, até agora | `desde que o replay abriu` |

**Gráficos** (um `ChartCard` cada, altura 280 / 208 px):

| Gráfico | Eixos | Observações |
|---|---|---|
| Presença minuto a minuto | x = minuto desde o início (`recording_anchor_at`; antes dele, "antes de começar"), y = presentes | linha; seletor **Live** (a mais recente do período por padrão); os 5 pontos de queda marcados |
| Retenção média | x = % da duração (0 a 100, de 5 em 5), y = % dos únicos | média das lives do período, cada live normalizada pela própria duração; linha fina por live quando ≤ 5 lives |
| Vagas × Presentes × Replay | uma barra tripla por live | ordem por data |
| Lives ao longo do tempo | x = data da live, y = presentes (barra) e Viram até o fim (linha, eixo da direita) | o "Event performance over time" do Zoom |

**Tabela** `Lives do período`: Live · Produto · Data · Vagas garantidas · Presentes · Comparecimento · Pico · Tempo médio · Até o fim · Mensagens · Perguntas · Replay · **Relatório** (link para `[id]?sessao=`). Ordem por data; abaixo de 768 px cada linha vira cartão. **Filtros da aba**: Situação (`Realizadas` / `Agendadas` / `Canceladas`), Apresentador, Produto.

### 3.3 Painel "Lives gravadas" (sessões `kind = 'simulated'`)

**Números do topo**:

| Cartão | Conta | Definição |
|---|---|---|
| Sessões realizadas | sessões `simulated` encerradas no período | `todas as horas marcadas` |
| Visitantes | alunos únicos com `webinar_joined` na sessão (abriram a Sala) | `abriram a Sala` |
| Participantes | alunos únicos com ≥ 1 amostra de presença | `pelo menos 30 s assistindo` |
| Tempo médio assistido | `baldes distintos × 30 s`, média | sem rodapé |
| Viram até o fim | último balde ≥ 95 % da duração da gravação ÷ participantes | `95 %` |
| Viram a oferta | participantes presentes em algum balde da janela da oferta | `card da oferta na tela` |
| Cliques na oferta | `webinar_offer_clicks` únicos por aluno | sem rodapé |
| Compras | cliques com `converted_sale_grant_id` | `pelos webhooks de venda` |
| Conversão | compras ÷ participantes | `por sessão, na tabela` |
| Receita | **a medir**: `webhook_events` não guarda o valor da venda hoje (§4.2); até lá o cartão mostra `—` | sem rodapé |

**Gráficos**: Presença minuto a minuto (seletor **Sessão**, pontos de queda e a janela da oferta sombreada); Retenção média por webinário (as sessões do mesmo webinário, para comparar horários); **Por horário do dia** (x = hora de São Paulo, y = participantes e conversão: diz quais horários valem a pena, D6); **Oferta por variante** (A/B/C/D: viram, clicaram, compraram, conversão). **Tabela** `Sessões do período`: Webinário · Produto · Horário · Visitantes · Participantes · Tempo médio · Até o fim · Viram a oferta · Cliques · Compras · Conversão · Relatório. **Filtros da aba**: Webinário, Horário do dia, `Com oferta`, Variante, Produto. O bloco **Simulação** do painel (§3.5) fica por último, com a cor de fundo diferente e a frase `Estes números são da simulação e não entram em nenhum outro número.`

### 3.4 Página de relatório de cada webinário (`/admin/comunicacao/webinarios/[id]`, aba **Relatório**)

Seletor **Sessão** no topo (as lives ao vivo, as horas marcadas e o replay). Os blocos, cada um num `Suspense`:

| Bloco | O que mostra | Fonte |
|---|---|---|
| **Presença** | curva minuto a minuto; **Pico** (valor e minuto); **Média** de presentes; **Pontos de queda** top 5 (minuto, quantos saíram, e o trecho da transcrição daquele minuto quando há `lesson_transcripts` ligada à gravação); **Tempo médio** e **máximo** assistido; **Viram até o fim** (95 %) | `webinar_presence_samples` (sessão em andamento) ou `presence_curve` (encerrada) |
| **Chat** | mensagens por minuto alinhadas ao vídeo (mesmo eixo x da presença); **Quem mais comentou** (10, com nome e mensagens); **Alunos mais quentes** (10, pontuação 0–100 com a fórmula escrita no rodapé, §3.6); **Reações na linha do tempo** por tipo (área empilhada; os seis tipos: 👏 clap, ❤️ love, 😂 laugh, 🔥 fire, 👍 like, 😮 wow) e total por tipo | `webinar_chat_messages` (`source in ('audience','original')` da sessão), `webinar_reactions` |
| **Perguntas** | feitas / respondidas / dispensadas; **Mais votadas** (10) com situação e quem respondeu; linha do tempo das perguntas | `webinar_questions` |
| **Enquetes** | por enquete: respostas por opção (barras) e a lista por aluno com hora e offset; anônima: só as barras | `webinar_polls*` |
| **Vagas** | vagas garantidas, compareceram, faltaram (vaga sem presença), por link de origem (`source`, lido de `?origem=`) e por aviso de origem (`source_campaign_id`); lista de faltosos para virar regra da Comunicação | `webinar_registrations` |
| **Oferta** | viram a oferta (presentes na janela), cliques, compras, receita (`—` até a coluna existir), por variante A/B/C/D; conversão por sessão | `webinar_offers*`, `webinar_offer_clicks`, `sale_grants` |
| **Replay** | vistos, % assistido médio, curva da sessão `replay`; e quantos dos presentes da live voltaram no replay | sessão `replay` |
| **Respostas do Assistente** | quantas respostas o agente de IA deu, tempo médio de resposta, quantas foram apagadas ou corrigidas pela equipe; fora da Simulação e fora das mensagens de aluno/equipe | `source = 'ai'` |
| **Simulação** | §3.5 | colunas `simulated_*`, `simulation_summary` + `source = 'scripted'` |
| **Lista por aluno** | §3.4.1 | função `webinar_attendees` (lê `webinar_attendance` depois do fim) |

#### 3.4.1 Lista por aluno (estilo Attendee report)

`data-table.tsx` com busca por nome; uma linha por aluno presente ou com vaga: Aluno · Vaga (sim/não, hora) · **Entrou** (primeira amostra) · **Saiu** (última amostra + 15 s) · **Entradas** (trechos: um intervalo sem amostra por mais de 90 s, 3 baldes, abre outro trecho, como o Zoom lista cada entrada) · **Tempo na sessão** · Até o fim · Mensagens · Reações · Perguntas · Enquetes · Oferta clicada (variante) · Pontuação. Clicar no aluno abre a ficha dele em `/admin/alunos/[id]`. Vaga sem presença aparece com `—` (é o "Absentee" do Zoom).

### 3.5 Bloco "Simulação" (só live gravada; nunca entra nos números reais)

| Linha | Conta |
|---|---|
| Selo "Ao vivo" | ligado ou desligado nesta sessão; `decidido por {nome} em {data}` (`simulation_decided_by`, `simulation_decided_at`, D10) |
| Contador simulado | a regra escolhida (`simulated_count_rule`) e o maior número mostrado (`simulation_summary.counter_max`); ao lado, o número real de participantes, para a equipe comparar |
| Entradas simuladas | quantas apareceram (`simulated_joins`, total em `simulation_summary.joins_shown`) |
| Avisos de venda simulados | quantos apareceram (`simulation_summary.sale_notices_shown`) |
| Comentários do roteiro | disparados por **Solta em** (`Num minuto do vídeo` / `Quando o apresentador diz` / `Pelo botão da equipe`), e os itens do roteiro que não dispararam (frase não encontrada ou sessão encerrada antes) |

As respostas do Assistente de IA **não** ficam aqui: são respostas reais a alunos reais e têm o bloco próprio de §3.4. Toda consulta real filtra `source in ('audience','original','team')` (alunos e equipe) ou `author_user_id is not null`; `scripted` só aparece neste bloco e `ai` só no bloco do Assistente. Nas exportações da §3.7 nenhuma linha simulada sai; existe um CSV separado `Simulacao`.

### 3.6 Fórmulas (texto e SQL)

Todas as contas partem do **balde de 30 s**: cada aluno manda o sinal de presença a cada 15 s (o mesmo `LESSON_PROGRESS_HEARTBEAT_MS` de `src/components/lesson-experience.tsx`), o servidor calcula `bucket = floor(offset_s / 30)` e grava **uma linha por aluno, sessão e balde** (upsert; dois sinais no mesmo balde não contam duas vezes). Na live ao vivo o offset é `now() − recording_anchor_at` (antes da âncora, `started_at`; o sinal do servidor, nunca o relógio do aluno); na live gravada e no replay é o tempo do vídeo. Duração da sessão em baldes: `D = ceil(duration_seconds / 30)` (`webinar_recordings.duration_seconds`; na live, `ended_at − recording_anchor_at`). Saída: 90 s (3 baldes) sem sinal fecha o trecho (padrão, a confirmar no piloto).

| Métrica | Texto | SQL (dentro de `webinar_report`) |
|---|---|---|
| Presentes por balde | alunos distintos com amostra no balde | `select bucket, count(distinct user_id) n from webinar_presence_samples where session_id = $1 group by bucket` |
| Únicos da sessão | alunos distintos com qualquer amostra | `select count(distinct user_id) from webinar_presence_samples where session_id = $1` |
| Retenção no balde | presentes no balde ÷ únicos | `n::numeric / nullif(unicos, 0)` |
| Retenção média (painel) | média da retenção de cada live em cada 5 % da duração | `width_bucket(bucket, 0, D, 20)` por live, depois `avg` entre lives |
| Pico | maior `n` e o balde dele | `order by n desc, bucket limit 1` |
| Média de presentes | média de `n` nos baldes de 0 a D | `avg(n)` com os baldes vazios valendo 0 (`generate_series(0, D-1)` + `left join`) |
| Ponto de queda | maior derivada negativa: a maior queda de um balde para o seguinte; top 5 em minutos distintos | `with c as (…n por balde…), d as (select bucket, n - lag(n) over (order by bucket) delta from c) select bucket, delta from d where delta < 0 order by delta, bucket limit 5` (agrupado por `bucket / 2` para não listar o mesmo minuto duas vezes) |
| Tempo assistido por aluno | baldes distintos × 30 s | `count(distinct bucket) * 30` por `user_id` |
| Tempo médio / máximo | média e máximo do anterior entre os presentes | `avg(...)`, `max(...)` |
| Viram até o fim | alunos cujo último balde ≥ 95 % de D ÷ únicos | `count(*) filter (where max_bucket >= ceil(0.95 * D) - 1)` |
| Comparecimento | presentes que tinham vaga ÷ vagas garantidas | `count(distinct p.user_id) filter (where r.user_id is not null) / count(distinct r.user_id)` |
| Mensagens por minuto | mensagens de aluno por `offset_ms / 60000` | `select floor(offset_ms / 60000) m, count(*) from webinar_chat_messages where session_id = $1 and source in ('audience','original') and deleted_at is null group by m` |
| Entrou / Saiu | primeira e última amostra; trecho novo quando faltam mais de 3 baldes (90 s) | `first_at`, `last_at + interval '15 seconds'`; `lag(bucket)` para abrir trechos |
| Viram a oferta | presentes em algum balde entre `show_at_offset_ms` e `hide_at_offset_ms` | `count(distinct user_id) filter (where bucket between floor(show/30000) and ceil(hide/30000))` |
| Conversão da oferta | compras ÷ participantes (e ÷ cliques, na linha de baixo) | `count(*) filter (where converted_sale_grant_id is not null)` |
| % assistido do replay | média de `baldes distintos ÷ D` entre quem viu | `avg(least(1, distinct_buckets::numeric / D))` |

**Alunos mais quentes** (pesos: **decisão do produtor**, sugeridos aqui e guardados em `WEBINAR_HOT_WEIGHTS` em `src/server/webinars/report-model.ts`, proposto):

```text
pontos = mensagens × 1 + perguntas × 2 + reações × 0,5 + enquetes respondidas × 1 + floor(minutos presentes ÷ 10) × 1
pontuação = round(100 × pontos ÷ maior pontos da sessão)      -- 0 a 100; a sessão sem ninguém dá 0
```

```sql
with p as (select user_id, count(distinct bucket) * 30 / 60 as minutos from webinar_presence_samples where session_id = $1 group by user_id),
     m as (select author_user_id u, least(count(*) filter (where kind = 'message'), 50) msgs, count(*) filter (where kind = 'question') perguntas
           from webinar_chat_messages where session_id = $1 and source = 'audience' and deleted_at is null group by 1),
     r as (select user_id u, count(*) reacoes from webinar_reactions where session_id = $1 group by 1),
     e as (select user_id u, count(*) enquetes from webinar_poll_answers where session_id = $1 group by 1),
     s as (select p.user_id, coalesce(msgs,0)*1 + coalesce(perguntas,0)*2 + coalesce(reacoes,0)*0.5 + coalesce(enquetes,0)*1 + floor(minutos/10)*1 as pontos
           from p left join m on m.u = p.user_id left join r on r.u = p.user_id left join e on e.u = p.user_id)
select user_id, round(100 * pontos / nullif(max(pontos) over (), 0)) as pontuacao from s order by pontos desc limit 10;
```

Perguntas contam em `webinar_questions` (não em `webinar_chat_messages`) quando a sessão tem a aba Perguntas ligada; a função soma as duas sem contar a mesma pergunta duas vezes (`webinar_questions.message_id`). Teto por aluno: **50 mensagens** por sessão na pontuação (quem manda 300 não vira o mais quente só por volume; decisão do produtor).

### 3.7 Exportações CSV (nomes do Zoom)

Botão **Exportar** no relatório e nos painéis, menu com os seis relatórios; o arquivo sai por `src/lib/csv.ts` como a exportação de alunos (`src/server/students/export-model.ts`), nome `webinario-{slug}-{sessao}-{relatorio}.csv`, datas em São Paulo (`formatSaoPauloDateTime`), auditoria `webinar_export` com o relatório e a sessão. Dados pessoais (nome, e-mail) só aqui e na lista por aluno; nunca nos gráficos.

| Arquivo | Uma linha por | Colunas |
|---|---|---|
| **Registration** | vaga | Nome · E-mail · Data da vaga · Situação (Vaga garantida / Cancelada) · Link de origem · Aviso de origem · Compareceu (Sim/Não) · Viu o replay (Sim/Não) · Lembrete 24 h (enviado em) · Lembrete 1 h |
| **Attendee** | aluno presente ou com vaga | Compareceu · Nome · E-mail · Hora da vaga · Entrou · Saiu · Entradas · Tempo na sessão (min) · Até o fim (95 %) · Mensagens · Reações · Perguntas · Enquetes respondidas · Oferta clicada (variante) · Pontuação (0–100) · Dispositivo (celular / computador, do `webinar_joined`) |
| **Performance** | sessão (no painel, todas do período) | Webinário · Sessão · Tipo (Ao vivo / Gravada / Replay) · Data · Duração · Vagas garantidas · Presentes · Comparecimento · Pico · Minuto do pico · Tempo médio · Tempo máximo · Até o fim · Mensagens · Alunos que comentaram · Reações · Perguntas feitas · Respondidas · Dispensadas · Enquetes respondidas · Viram a oferta · Cliques · Compras · Conversão · Replay vistos. Cabeçalho com a frase: `Estes números são reais; a simulação não entra em nenhum deles.` |
| **Q&A** | pergunta | Nº · Hora · Minuto do vídeo (mm:ss) · Nome (ou `Aluno {n}`) · E-mail (vazio se anônima) · Pergunta · Votos · Situação (Aberta / Respondida / Dispensada) · Respondida por · Resposta · Ao vivo (Sim/Não) · Hora da resposta |
| **Poll** | resposta | Enquete · Pergunta · Nome · E-mail · Hora · Minuto do vídeo · Resposta(s) (separadas por `;` na múltipla) ; enquete anônima: Nome e E-mail vazios |
| **Survey** | resposta à pesquisa do fim (enquete `kind = 'survey'`, fase 4) | Nome · E-mail · Hora · Pergunta · Resposta |
| **Simulacao** (extra, só live gravada) | item simulado | Tipo (Comentário do roteiro / Contador / Entrada / Aviso de venda) · Minuto do vídeo · Solta em · Persona · Texto · Disparou (Sim/Não). Cabeçalho: `Estes números são da simulação e não entram em nenhum outro número.` |

---

## 4. Dados

### 4.1 Migrações, por fase

| Fase | Migração (nome proposto) | O que cria |
|---|---|---|
| 1 | `202610280001_webinars_v1.sql` (escrita em 28/10/2026) | `webinars`, `webinar_sessions`, `webinar_presenters`, `webinar_recordings` (com `embed_url`), `webinar_registrations`, `alter policy` em `student_events` (o `webinar_registered` já é gravado pelo servidor), índice parcial, `set_updated_at`, RLS; `notifications` ganha o kind `'webinar'` (lembretes e avisos de live no sino sem campanha, D27) e `communication_visible_notifications` mostra esse kind; a função `webinar_report` já nasce aqui (devolve só Vagas até a fase 2) |
| 2 | `202610290001_webinars_v2_chat.sql` (escrita em 29/10/2026) | `webinar_chat_consents` (o aceite, D29), `webinar_recording_transcripts` (as cues da gravação, D30), `webinar_chat_script_items`, `webinar_chat_messages` (com `webinar_id` e `master`, D31), `webinar_reactions`, `webinar_polls`, `webinar_poll_options`, `webinar_poll_answers`, `webinar_questions`, `webinar_question_votes`, `webinar_presence_samples`, `webinar_attendance`; em `webinar_sessions`: `show_live_badge` + `simulation_decided_by/at` + `simulation_ack_text` (a decisão da D10), `presence_curve`, `script_fired_at`, `pinned_message_id`; em `webinar_recordings`: `purge_due_at`; funções `webinar_chat_window`, `webinar_open_session`, `webinar_close_session`, `webinar_report` (corpo completo, mesma assinatura), `webinar_attendees`, `prune_webinar_history` (pg_cron 06:47 UTC). Catorze seções pelo MCP, a 13 (os deletes da retenção) sozinha; guarda `webinarios-v2.guard` |
| 3 | `…_webinars_v3_live.sql` | `webinar_sessions.room_name`, `webinar_sessions.recorder_status`, `webinar_session_bans`, `webinar_recording_events` (webhook do gravador, bruto) |
| 4 | `…_webinars_v4_offers.sql` (e uma por PR 4b…4f) | `webinar_offers`, `webinar_offer_variants`, `webinar_offer_clicks`, `webinar_sessions.simulated_count_rule`, `simulated_joins`, `simulated_sale_notices`, `simulation_summary`, `webhook_events.amount_cents` + `currency` (receita), `webinar_panel` |

Cada migração é aditiva e idempotente, aplicada **antes do merge** (`docs/21` §9), sem `drop`, `delete` nem `create policy` solto (`alter policy` só na de `student_events`). Nada muda em `campaigns`, `lesson_progress` ou `lessons`.

### 4.2 Tabelas

Todas com `id uuid primary key default gen_random_uuid()`, `created_at`, e `updated_at` + gatilho `set_updated_at` onde há edição. `user_id` sempre `references auth.users(id) on delete cascade` (o aluno apagado some com as linhas; o relatório recalcula). Textos com `check (char_length(...) <= n)`.

| Tabela | Colunas principais | Índices e chaves |
|---|---|---|
| `webinars` | `slug text unique`, `kind` (`live` / `simulated`), `title`, `description`, `cover_url`, `status` (`draft` / `published` / `archived`), `host_user_id` (o Apresentador, marcado no card Dados), `access_mode` (`everyone` / `product` / `audience` / `either`), `product_id text` (acesso por produto, `entitlements.target_type = 'webinar'`), `audience jsonb` (segmento da Comunicação, mesmo formato de `campaigns.audience`), `registration_required bool` (Garantir vaga), `capacity int`, `show_registered_count bool`, `reminders jsonb` (`{h24: true, h1: true, email: true}`), `reminder_texts jsonb` (textos da equipe; vazio = padrão), `show_on_home bool`, `replay_days_on_home int`, `show_banner bool`, `scheduled_at` (Live ao vivo: a hora marcada; a sessão `live` nasce dela ao publicar), `duration_minutes`, `allow_student_camera bool default true` (D4), `quality jsonb` (`{ "stage": 720 | 1080, "screenFps": 30 | 15 }`, zod no salvar e no ler; miniaturas, câmera de aluno e gravação são fixas, D26), `room_settings jsonb` (os padrões da sala do card Sala; a sessão copia ao abrir, D28), `auto_record bool`, `replay_lesson_target jsonb` (`{ productId, moduleId, title, autoPublish }`), `chat_retention_days int`, `recording_retention_days int` (D10), `published_at`, `cancelled_at`, `cancel_reason`, `created_by`, `deleted_at` | `(status, deleted_at)`; `(scheduled_at)`; `slug` |
| `webinar_presenters` (fase 1) | `webinar_id`, `user_id` (conta da área, A7), `role` (`co_host` / `team`), `can_moderate_room bool default false` (a caixa "Pode remover e silenciar na sala", só para `team`), `valid_until` | `primary key (webinar_id, user_id)` |
| `webinar_sessions` | `webinar_id`, `kind` (`live` / `simulated` / `replay`), `scheduled_at`, `started_at`, `ended_at`, `recording_anchor_at` (a âncora: quando a gravação começou, de verdade), `status` (`scheduled` / `waiting` / `live` / `ended` / `cancelled`), `recording_id` → `webinar_recordings`, `source_session_id` (a live cujo chat a sessão gravada repete), `late_join_minutes`, `chat_mode` (`open` / `moderated` / `team_only` / `off`), `chat_slow_mode_seconds int` (nulo, 10, 20, 30 ou 60), `show_live_badge bool`, `simulation_decided_by`, `simulation_decided_at`, `simulation_ack_text`, `simulated_count_rule jsonb` (fase 4), `simulated_joins jsonb` (fase 4), `simulated_sale_notices jsonb` (fase 4), `simulation_summary jsonb` (fase 4, congelado no fim), `presence_curve jsonb` (congelada no fim, §4.5), `room_name text` (fase 3), `recorder_status` (fase 3: `none` / `preparing` / `ready` / `recording` / `uploading` / `uploaded` / `upload_failed` / `unavailable` / `gone`) | `(webinar_id, scheduled_at)`; `(status, scheduled_at)` para o tick; `(kind, ended_at)` para os painéis; um `replay` por webinário (índice único parcial) |
| `webinar_registrations` | `webinar_id`, `session_id` (nulo = qualquer sessão), `user_id`, `status` (`registered` / `cancelled`), `source text` (link de origem lido de `?origem=`), `source_campaign_id` (o aviso que trouxe), `reminder_24h_sent_at`, `reminder_1h_sent_at`, `started_notice_sent_at`, `cancelled_notice_sent_at`, `calendar_token` (gerado pelo banco), `registered_at`, `cancelled_at` | `unique (webinar_id, user_id, coalesce(session_id, uuid_nil()))`; `(session_id, status)`; `(user_id)` |
| `webinar_chat_messages` | `webinar_id`, `session_id`, `offset_ms int` (em relação ao zero do vídeo da sessão: a hora marcada na gravada, a âncora na live; pode ser negativo: antes de começar), `author_user_id` (nulo em `scripted` / `ai` / `system`), `display_name` (primeiro nome + inicial, apelido ou `Aluno {n}`, D10), `role` (`host` / `team` / `student` / `guest` / `ai`), `source` (`original` / `audience` / `team` / `scripted` / `ai`), `body text ≤ 1000`, `kind` (`message` / `question` / `answer` / `system`), `reply_to_id`, `script_item_id` (qual item do roteiro disparou; único por sessão), **`master bool`** (a linha mestre que as sessões gravadas repetem: tudo o que foi escrito numa sessão `live` e o que a equipe promove, D31), `approved bool`, `approved_by`, `approved_at`, `pinned_at`, `deleted_at`, `deleted_by`, `deleted_reason` (`student` / `team` / `consent_revoked`) | `(session_id, offset_ms)` para a janela; `(session_id, created_at desc)` para a sala; `(author_user_id)` para "Remover minhas mensagens"; `(webinar_id, offset_ms) where master` para a linha mestre; único `(session_id, script_item_id)` |
| `webinar_chat_script_items` | `webinar_id`, `trigger_kind` (`at_offset` / `on_phrase` / `manual`), `offset_ms`, `phrase text`, `phrase_delay_ms` (o atraso depois da frase), `resolved_offset_ms` (achado nas cues de `webinar_recording_transcripts` da gravação, já com o atraso), `resolved_transcript_id`, `persona_name`, `persona_role` (`student` / `team`), `body`, `kind` (`message` / `question`), `status` (`draft` / `ready` / `unresolved` / `disabled`), `position`, `generated_by_ai bool`, `created_by`; ao abrir a sessão gravada (`webinar_open_session`) cada item `ready` com minuto vira uma mensagem `scripted` daquela sessão; o `manual` espera **Soltar agora** | `(webinar_id, position)`; `(webinar_id, status)` |
| `webinar_chat_consents` (fase 2, D29) | `user_id` (pk), `consent_version`, `display_mode` (`first_name_initial` / `nickname` / `anonymous`), `nickname`, `consented_at`, `revoked_at` ("Remover minhas mensagens"); uma linha por aluno, vale para todos os webinários | `primary key (user_id)` |
| `webinar_recording_transcripts` (fase 2, D30) | `recording_id` (única), `language`, `source_format` (`json3` / `srt` / `vtt` / `txt`), `full_text`, `cues jsonb` (as mesmas cues de `lesson_transcripts`: `startSeconds`, `endSeconds`, `text`), `checksum`, `created_by` | `unique (recording_id)` |
| `webinar_reactions` | `session_id`, `user_id`, `offset_ms`, `reaction` (`like` / `love` / `clap` / `fire` / `laugh` / `wow`: as seis da barra do aluno) | `(session_id, offset_ms)`; `(session_id, user_id)` |
| `webinar_polls` | `webinar_id`, `session_id` (nulo = modelo da enquete; a cópia lançada tem sessão), `template_poll_id` (o modelo de que a cópia nasceu), `question`, `kind` (`single` / `multiple` / `survey`), `anonymous bool`, `status` (`draft` / `open` / `closed`), `open_offset_ms`, `opened_at`, `closed_at`, `results_shared_at` ("Compartilhar resultado"), `position`, `created_by` | `(session_id, status)`; `(webinar_id, position) where session_id is null` |
| `webinar_poll_options` | `poll_id`, `label`, `position` | `(poll_id, position)` |
| `webinar_poll_answers` | `poll_id`, `session_id`, `user_id`, `option_ids uuid[]`, `offset_ms`, `deleted_at` | `unique (poll_id, user_id)`; `(session_id, user_id)`; `(user_id)` para "Remover minhas mensagens" |
| `webinar_questions` | `session_id`, `user_id`, `display_name`, `anonymous bool`, `body`, `message_id` (quando veio do chat), `status` (`open` / `answered` / `dismissed`), `upvotes int`, `answered_by`, `answer_text`, `answered_live bool`, `answered_at`, `offset_ms`, `deleted_at`, `deleted_reason` | `(session_id, status, upvotes desc)`; `(user_id)` para "Remover minhas mensagens" |
| `webinar_question_votes` | `question_id`, `user_id` | `primary key (question_id, user_id)` |
| `webinar_presence_samples` | `session_id`, `user_id`, `bucket int` (30 s), `state` (`playing` / `paused` / `buffering` / `hidden`), `offset_seconds` (a última posição do vídeo), `first_at`, `last_at`, `samples smallint` | **`primary key (session_id, user_id, bucket)`**; `(session_id, bucket)` para a curva. Sem `id`, sem `updated_at` (linha enxuta) |
| `webinar_attendance` (fase 2) | `session_id`, `user_id`, `first_at`, `last_at`, `entries int` (trechos: um a mais a cada buraco de mais de 3 baldes), `seconds int` (cada balde vale no máximo 30 s), `max_bucket`, `reached_end bool` (≥ 95 % dos baldes, M2); resumida no fim da sessão pela `webinar_close_session` a partir das amostras; `webinar_attendees` lê dela depois do fim | `primary key (session_id, user_id)`; `(user_id)` |
| `webinar_offers` | `webinar_id`, `product_id`, `title`, `show_at_offset_ms`, `hide_at_offset_ms`, `status`, `attribution_days int default 7` | `(webinar_id)` |
| `webinar_offer_variants` | `offer_id`, `label` (`A` / `B` / `C` / `D`), `headline`, `price_label`, `badge`, `checkout_url`, `weight int` | `unique (offer_id, label)` |
| `webinar_offer_clicks` | `offer_id`, `variant_id`, `session_id`, `user_id`, `offset_ms`, `click_token text unique`, `converted_sale_grant_id` → `sale_grants`, `converted_at` | `(offer_id, user_id)`; `(session_id)`; `(converted_sale_grant_id)` |
| `webinar_recordings` | `webinar_id`, `session_id`, `provider` (`bunny`), `bunny_library_id`, `bunny_video_id`, `embed_url` (o endereço do player colado pela equipe na Live gravada), `duration_seconds`, `status` (`pending_upload` / `uploading` / `processing` / `ready` / `failed`), `source` (`jibri` / `upload` / `obs` / `bunny`), `file_name`, `anchor_offset_ms int default 0` (o ajuste fino ± segundos do "Alinhar chat"), `size_bytes`, `sha256`, `error_message` | `(session_id)`; `unique (provider, bunny_video_id)` |
| `webinar_recording_events` (fase 3) | `session_id`, `state` (`ready` / `recording` / `uploaded` / `upload_failed` / `unavailable` / `gone`), `room`, `file_name`, `payload jsonb` bruto ≤ 64 KB, `signature_valid`, `processing_status`, `received_at`, `processed_at`, `error_message` | `unique (session_id, state, coalesce(file_name, ''))` (idempotência) |
| `webinar_session_bans` (fase 3) | `session_id`, `user_id`, `kind` (`kicked` / `muted`), `until_at` (nulo = até o fim; o silêncio de 5 / 15 / 60 min), `by_user_id`, `reason` | `primary key (session_id, user_id, kind)` |

Variante da oferta por aluno: determinística, `hashtext(user_id || offer_id) % soma dos pesos`, calculada no servidor; não precisa de tabela, e "viram" e clique caem sempre na mesma variante. Conversão: o job `webinar-offer-conversions` do tick liga o clique ao `sale_grants` do mesmo `user_id` e `product_id` criado entre o clique e `clicked_at + attribution_days`; a venda vem só do webhook (`webhook_events` → `process-sale.ts`), nunca de um clique.

### 4.3 Colunas de simulação (D6, D10)

| Coluna (`webinar_sessions`) | Fase | Formato | Regra |
|---|---|---|---|
| `show_live_badge bool default false` | 2 | sem formato | o selo "Ao vivo" na Sala e na faixa; `false` mostra o selo **Sessão** |
| `simulation_decided_by`, `simulation_decided_at`, `simulation_ack_text` | 2 | uuid, timestamptz, text | gravados por `saveSimulation`; `simulation_ack_text` guarda a frase de §8.6 exatamente como foi mostrada e marcada; o relatório e a auditoria mostram quem decidiu (D10) |
| `simulated_count_rule jsonb` | 4 | `{ "mode": "off" \| "fixed" \| "curve", "base": int, "peak": int, "jitter": int }` | zod no salvar e no ler; `off` por padrão; o número mostrado nunca sai do bloco Simulação |
| `simulated_joins jsonb` | 4 | `{ "enabled": bool, "every_seconds": int, "max": int, "names": "generic" }` | nomes genéricos (`Maria S.`), nunca nomes de alunos reais |
| `simulated_sale_notices jsonb` | 4 | `{ "enabled": bool, "items": [{ "offset_ms": int, "text": string }] }` | sem regra extra |
| `simulation_summary jsonb` | 4 | `{ "counter_max": int, "joins_shown": int, "sale_notices_shown": int }` | congelado no fim da sessão, como `presence_curve`; é o que o bloco Simulação lê |

Uma sessão `live` tem as regras simuladas obrigatoriamente desligadas (`check`). O CSV e as regras da Comunicação nunca leem estas colunas. Ponto aberto para o produtor (§12.3): a fase 2 traz só o selo com a decisão registrada; se ele quiser o contador já na primeira Live gravada, `simulated_count_rule` sobe para `webinars_v2`.

### 4.4 RLS, permissões e `set_updated_at`

- Todas as tabelas `webinar_*`: `enable row level security; revoke all from anon, authenticated; grant select, insert, update, delete to service_role` (o padrão de `lesson_comments` e de `webhook_events`). **Nenhuma política para `authenticated`**: o aluno nunca lê nem grava direto; só pelas rotas da §5.1, que conferem a sessão e o acesso (`requireWebinarAccess`, reaproveitando o critério de `src/server/access/lesson-access.ts`: `entitlements` com `target_type = 'webinar'`, acesso à plataforma, ou o segmento) e gravam com a service role. A equipe grava por Server Action.
- As funções SQL (`webinar_report`, `webinar_attendees`, `webinar_panel`, `prune_webinar_history`) são `security invoker`, `revoke all … from public, anon, authenticated; grant execute to service_role` (assinatura exata conferida numa guarda como `comunicacao-v3b2.guard`; o teste de integração exige `42501` do `authenticated`).
- Realtime (se a medição da fase 2 escolher): canal **Broadcast** por sessão, com token assinado no servidor, nunca `postgres_changes` nas tabelas (com o `revoke` acima o aluno não as veria mesmo).
- `set_updated_at` em `webinars`, `webinar_sessions`, `webinar_chat_script_items`, `webinar_polls`, `webinar_questions`, `webinar_offers`, `webinar_offer_variants`, `webinar_recordings`.

### 4.5 `webinar_presence_samples`: tamanho e retenção

- Tamanho: 1 aluno × 2 h = 240 linhas; 100 alunos = 24 mil; 500 alunos (fase 2 do D1) = 120 mil por sessão. Escrita: um upsert por aluno a cada 15 s (100 alunos = ~7 por segundo), pela chave primária.
- **No fim da sessão** (`endLiveSession` ou o tick que fecha a hora marcada), a curva por balde é calculada uma vez e congelada em `webinar_sessions.presence_curve` (`[{b, n}]`), junto com pico, média, tempo médio e máximo e "até o fim", e a lista por aluno é resumida em `webinar_attendance`: os painéis leem só isso e nunca voltam às amostras.
- **Retenção**: `prune_webinar_history()` (`pg_cron` às 06:47 UTC, depois de `prune_communication_history`, `docs/22`) apaga as amostras **90 dias** depois do `ended_at` (decisão do produtor; a curva congelada e `webinar_attendance` ficam). O mesmo job apaga as mensagens da sessão (menos a linha mestre), as reações, as perguntas e as respostas de enquete depois de `chat_retention_days` do fim da sessão; a **linha mestre** só sai de webinário arquivado ou excluído, passada a retenção dele (as sessões seguintes dependem dela); e marca a gravação (`webinar_recordings.purge_due_at`) depois de `recording_retention_days`: quem apaga na Bunny é o job `webinar-recordings` da fase 3 (D10).

### 4.6 A função `webinar_report(p_session_id uuid)` e o cache

- Mesma forma de `communication_popup_report`: `returns table (metric text, item text, total bigint, students bigint)`, `language sql`, `stable`, `security invoker`, `set search_path = pg_catalog, public`; só `service_role`. Linhas (`metric / item`): `presence / <bucket>`, `unique / ''`, `peak / <bucket>`, `avg_present / ''`, `drop / <bucket>` (5), `watch_avg / ''` e `watch_max / ''` (segundos), `reached_end / ''`, `chat_minute / <minuto>`, `chat_total / ''`, `top_chat / <user_id>`, `hot / <user_id>` (total = pontuação), `reaction / <tipo>`, `reaction_minute / <tipo>:<minuto>`, `question / open|answered|dismissed`, `top_question / <question_id>` (total = votos), `poll / <poll_id>:<option_id>`, `registration / registered|attended|absent`, `registration_source / <source>`, `offer / <variant>:seen|clicks|purchases`, `replay / viewers|watched_pct`, `ai / replies|avg_seconds|edited`, `sim_script / fired|missed`, `sim_counter / max`, `sim_joins / shown`, `sim_sales / shown`.
- Conta **só alunos** (`not exists (select 1 from admin_roles …)`), **só `source in ('audience','original')`** nas métricas de chat, e lê `presence_curve` quando a sessão já encerrou (as amostras só para a sessão em andamento). Com a sessão ao vivo a função roda a cada minuto para a equipe: medir com 500 alunos × 240 baldes antes da fase 3 (meta: p95 ≤ 300 ms, como o relatório do pop-up em 3 mil alunos, `docs/29` §7.2).
- **Como ficou na `202610290001`**: as linhas `offer / …`, `ai / …`, `sim_counter`, `sim_joins` e `sim_sales` chegam na fase 4; `registration / cancelled` continua (fase 1); sessão inexistente devolve zero linhas; a função foi conferida num Postgres 16 local com dados sintéticos (um aluno até o fim, um que saiu e voltou, um que só passou; a equipe fora de tudo), e o relatório ao vivo (pelas amostras) bate com o congelado (pela curva).
- `getWebinarReport(sessionId)` (`src/server/webinars/report-queries.ts`): `unstable_cache` de 60 s, chave `["webinars-report", "v1", sessionId, minuto]`, tag `webinars`; nomes dos alunos do top 10 numa segunda leitura (`profiles`), fora do cache; `readWebinarReportRows` sem confiar no formato (bigint pode vir como texto). `webinar_panel(p_kind, p_start, p_end)` faz o mesmo para os painéis (como `communication_overview(p_start, p_end)`), e `webinar_attendees(p_session_id)` devolve a lista por aluno (sem cache: é a base do CSV).

### 4.7 Registros novos no histórico (`student_events`)

`entity_type = 'webinar'`, `entity_id = session_id`, gravados **só pelo servidor** (`recordEvents` em `src/server/students/store.ts` / `recordCommunicationEvents` em `src/server/communications/route-support.ts`), com `metadata` mínimo (ids, códigos e números; **nunca o texto** da mensagem, `docs/05`):

| `event_type` | `metadata` | Quando |
|---|---|---|
| `webinar_registered` | `{ webinar_id, session_id, source, campaign_id }` | Garantir vaga (e `cancelled: true` ao cancelar) |
| `webinar_joined` | `{ kind, device: "mobile" \| "desktop" }` | abriu a Sala (uma vez por abertura) |
| `webinar_left` | `{ kind, seconds_present, reason: "closed" \| "ended" \| "kicked" \| "timeout" }` | o envio de saída ou 90 s (3 baldes) sem sinal |
| `webinar_chat_sent` | `{ message_id, kind, offset_ms, length }` | mensagem aceita |
| `webinar_reaction_sent` | `{ reaction, offset_ms }` | reação aceita |
| `webinar_question_sent` | `{ question_id, offset_ms, anonymous }` | pergunta aceita |
| `webinar_poll_answered` | `{ poll_id, offset_ms, options: n }` | resposta aceita |
| `webinar_offer_clicked` | `{ offer_id, variant, offset_ms }` | clique na oferta |
| `webinar_replay_started` | `{ recording_id }` | primeira amostra na sessão `replay` |
| `webinar_camera_toggled` | `{ on: bool, offset_ms }` | o aluno ligou ou desligou a câmera (D4); o aceite do aviso de gravação da imagem vai junto na primeira vez (`consented: true`) |
| `webinar_chat_consented` | `{ consent_version, display: "first_name" \| "nickname" \| "anonymous" }` | o aceite da primeira mensagem (D10); o mesmo `event_type` com `{ revoked: true, consent_version }` em "Remover minhas mensagens" |

Sino (fase 1, D27): os lembretes de 24 h e 1 h, o **Começou agora**, a mudança de hora e o cancelamento entram em `notifications` com `kind = 'webinar'`, `title`, `body` e `href` na própria linha (sem campanha), `payload = { webinarId, sessionId, kind }`, `expires_at` = hora marcada + duração + 2 h e `dedupe_key = webinar:<sessão>:<tipo>:<hora marcada>`; a equipe nunca recebe. O kind entra no check de `notifications` e no ramo da função `communication_visible_notifications` pela `202610280001`.

Política (fase 1): `alter policy "Students can create own events" on student_events … with check (auth.uid() = user_id and coalesce(entity_type, '') not in ('campaign', 'webinar'))` (o navegador continua gravando só `auth`). Índice parcial `student_events_webinar_idx on (entity_id, event_type) where entity_type = 'webinar'` (não é `concurrently`: contar as linhas antes, como na `202610260001`). As regras da Comunicação (`viu a oferta`, `saiu antes da oferta`, `clicou sem comprar`) leem estes registros e as tabelas da §4.2, nunca o bloco Simulação.

---

## 5. Rotas e ações

### 5.1 Rotas do aluno (`src/app/api/webinars/[id]/…`, como `src/app/api/popups/[id]/…`)

Esta tabela é a fonte dos nomes das rotas no documento inteiro. Todas com `requireApiUser` + `requireWebinarAccess` + `readBoundedJson` (≤ 4 KB) + `jsonRouteError` + `noStore`, exceto `heartbeat` (abaixo); `[id]` é o webinário, `sessionId` vai no corpo ou em `?sessao=`. Limites de escrita por aluno (os mesmos de §8.3 e D16): chat 5 por 60 s (`lessonCommentBurstLimit`), reações 1 por segundo e até 20 por minuto, perguntas 2 por minuto, e por cima o teto global de `STUDENT_WRITE_LIMIT` (30 por minuto, `src/server/communications/student-write-limit.ts`) somando tudo; o sinal de presença fica fora dos limites. Erros: 401 sem sessão, 403 sem acesso, 404 sessão inexistente, 409 `{ reason }` fora de hora (`not_started` / `ended` / `chat_off` / `banned` / `muted`), 429 com `Retry-After`.

| Rota | Pedido | Resposta |
|---|---|---|
| `GET …/session?sessao=` | nenhum corpo | `{ serverTime, session: { kind, status, scheduledAt, startedAt, endedAt, recordingAnchorAt, offsetMs (autoritativo na gravada), lateJoinMinutes, chatMode, chatSlowModeSeconds, showLiveBadge, simulatedCount (só com a regra ligada), video: { provider: "bunny", videoId, token, expires }, polls: [abertas], offer: { variant, headline, priceLabel, badge, showAtMs, hideAtMs } }, me: { registered, consented, displayName, banned, mutedUntil } }`; o navegador guarda `skew = serverTime − Date.now()` e ressincroniza a cada 60 s e ao voltar para a aba |
| `GET …/chat?sessao=&from=&to=` ou `?sessao=&since=&after=` | a janela por offset em ms (`webinar_chat_window`: as linhas da sessão + a linha mestre; ao entrar, 5 min para trás e 2 min para a frente, depois janelas de 2 min a cada 90 s; no máximo 15 min por pedido) ou as mensagens novas da sessão desde o instante `since` (ISO), `after` (id) desempatando o mesmo instante, a cada 5 s | `{ messages: [{ id, offsetMs, displayName, role, source, body, kind, replyToId }], next }`; `scripted` vai para o aluno como `role: "student"` ou `"team"` conforme a persona (a origem só no banco); `ai` vai sempre como `role: "ai"` e aparece com o selo **Assistente** (nunca convertido em `team`) |
| `POST …/chat` | `{ sessionId, body, kind: "message" \| "question", anonymous, consent: true, consentVersion }` (o `consent` obrigatório na primeira; grava `webinar_chat_consented`) | 201 `{ message }`; valida por `comment-validation.ts` (palavras bloqueadas, rajada); `chat_mode = 'moderated'` grava `approved = false` e devolve `{ pending: true }`; modo lento devolve 429 com `Retry-After` |
| `DELETE …/chat` (e `DELETE /api/webinars/chat`, sem webinário, para Perfil › Privacidade) | `{ all: true }` | "Remover minhas mensagens" (D10): `deleted_at` + `deleted_reason = 'consent_revoked'` em `webinar_chat_messages`, `webinar_questions` e `webinar_poll_answers` de todas as sessões; 200 `{ removed: n }` |
| `POST …/heartbeat` | `{ sessionId, offsetSeconds, state, visible, leave? }` a cada 15 s; `leave: true` por `sendBeacon` ao sair. Guarda: `requireApiSessionUser` (só a assinatura do JWT da sessão, como `src/app/api/page-visits/route.ts`) + conferência do acesso guardada em cache por sessão (um `requireWebinarAccess` por aluno e sessão, não por sinal) | `{ serverTime, offsetMs, ended, presentNow }`; upsert do balde; na live o offset é do servidor; o primeiro sinal grava `webinar_joined`, `leave` grava `webinar_left` |
| `POST …/reactions` | `{ sessionId, reaction }` (≤ 1 por segundo, ≤ 20 por minuto) | 201; `GET …/reactions?sessao=&since=` devolve as contagens dos últimos 10 s para a animação |
| `GET` / `POST …/questions` | `POST { sessionId, body, anonymous }`; `POST …/questions/[qid]/vote` alterna o voto | lista `open` + `answered` com votos, ordem `Mais votadas` / `Mais recentes` |
| `GET` / `POST …/polls` | `POST { sessionId, pollId, optionIds }` | `unique (poll_id, user_id)`: segunda resposta = 409; `GET` devolve as abertas e, depois de fechada com "Compartilhar resultado", as contagens |
| `POST …/offer-click` | `{ sessionId, offerId }` | `{ url }` = `checkout_url` da variante do aluno + `?b7=<click_token>`; o navegador abre em outra aba; grava `webinar_offer_clicks` e `webinar_offer_clicked` |
| `POST …/join-token` | `{ sessionId }` (só `kind = 'live'` em `waiting` / `live`) | `{ jwt, room, domain, role }` (§5.4); 409 fora de hora; o banido não recebe |
| `POST …/room-events` | `{ sessionId, events: [{ name, at, data }] }` em lotes de até 20 (os sinais do iframe de §6.3: `videoConferenceJoined/Left`, `raiseHandUpdated`, `audioMuteStatusChanged`, `errorOccurred`) | 202; vira linhas em `student_events` com códigos, nunca texto |
| `POST …/register` | `{ sessionId?, source? }` (Garantir vaga); `DELETE` cancela | `{ registration, calendarUrl }`; `webinar_registered` |
| `GET …/calendar?token=` | `calendar_token` | o arquivo `.ics` |

### 5.2 Server Actions do admin (`src/server/webinars/actions.ts`, zod em `schemas.ts`)

As ações da equipe são sempre Server Actions; não há rotas `/moderar`, `/encerrar` ou `/gravar`.

| Ação | Permissão | O que faz |
|---|---|---|
| `saveWebinarDraft`, `publishWebinar`, `archiveWebinar`, `duplicateWebinar` | `messaging.write`; publicar `messaging.publish` | o CRUD; publicar valida acesso, sessões e, com Garantir vaga, os lembretes, e gera `room_name` (§8.1); duplicar copia roteiro, enquetes e oferta, nunca vagas nem números |
| `savePresenters` | `messaging.write` | `webinar_presenters` (co-apresentadores e Equipe da sala, com `can_moderate_room`) |
| `createSession`, `cancelSession`, `rescheduleSession` | `messaging.write` | horas marcadas (várias por dia, D6); cancelar avisa quem tem vaga pelo sino + e-mail |
| `startLiveSession`, `markRecordingAnchor`, `endLiveSession` | `messaging.publish` | `status`, `started_at`; a âncora `recording_anchor_at = now()` quando o Jibri confirma `recordingStatusChanged on` (o navegador do host chama a ação na hora; hora do servidor, nunca a do navegador); o fim congela a curva e `webinar_attendance` (§4.5) e cria a sessão `replay` quando a gravação ficar `ready` |
| `requestRecorder`, `releaseRecorder` | `messaging.publish` | pedem ao workflow "Infra (Hetzner)" a máquina do Jibri antes da live e a devolução no fim (etapas `jibri-up` / `jibri-down`; cada criação com ok do produtor no chat, `docs/20`); mudam `recorder_status` |
| `attachRecording`, `alignChat` | `messaging.write` | liga um vídeo da Bunny (id ou envio) à sessão; `alignChat` grava `webinar_recordings.anchor_offset_ms` ± segundos com prévia (escolhe uma mensagem, vê o vídeo naquele ponto) |
| `saveScriptItems`, `importChatScriptCsv`, `exportChatScriptCsv`, `resolveScriptPhrases`, `generateScriptWithAi` | `messaging.write` | o roteiro; o CSV de 4 colunas (`Tempo;Nome;Papel;Mensagem`, até 5 000 linhas / 1 MB); `on_phrase` resolvido por `lesson_transcripts.cues` da gravação (o item fica `unresolved` quando a frase não é achada); a geração reaproveita o gateway de `src/server/ai` |
| `promoteToOriginal`, `approveMessage`, `deleteMessage`, `pinMessage` | `messaging.write` | moderação: uma mensagem `audience` de uma sessão gravada pode virar `original` do webinário (aparece nas próximas; só com o consentimento gravado) |
| `launchPoll`, `closePoll`, `shareResults`, `answerQuestion`, `dismissQuestion`, `reopenQuestion`, `lowerHand` | `messaging.write` | a mesa da equipe durante a sessão |
| `muteInChat`, `kickFromSession`, `banStudent`, `unbanStudent` | silenciar e remover: `messaging.write`; banir: `messaging.publish` | `webinar_session_bans` (`kind` e `until_at`); na live o host também chama `kickParticipant` no iframe |
| `saveOffer`, `saveOfferVariants` | `messaging.write` | fase 4 |
| `saveSimulation` | `messaging.publish` | `show_live_badge` + `simulation_decided_by/at` + `simulation_ack_text` (fase 2); `simulated_count_rule`, `simulated_joins`, `simulated_sale_notices` (fase 4); auditoria com os valores (D10) |
| `exportWebinarCsv` | `messaging.write` | §3.7; auditoria `webinar_export` |
| `removeStudentMessages` | `messaging.publish` | a pedido do aluno (LGPD), com motivo na auditoria |

Toda ação grava `recordAudit` com ids e contagens; `revalidateTag("webinars")` e a tag `communications` quando mexe no sino.

### 5.3 Webhook do gravador: `POST /api/webhooks/recorder`

- Um endereço só, um segredo só: `WEBINAR_RECORDER_WEBHOOK_SECRET` (no `.env` do servidor do app e na máquina do Jibri). Quem chama: as etapas `jibri-up` / `jibri-down` do workflow (`ready`, `unavailable`, `gone`) e o `finalize.sh` da máquina do Jibri (D3) depois de enviar o MP4 para a Bunny Stream (`uploaded` / `upload_failed`); o app grava `recording` pela ação `markRecordingAnchor`.
- Corpo: `{ sessionId, state: "ready" | "recording" | "uploaded" | "upload_failed" | "unavailable" | "gone", room, fileName, startedAt (o sufixo yyyy-MM-dd-HH-mm-ss do arquivo), durationSeconds, sizeBytes, sha256, bunnyLibraryId, bunnyVideoId, error }`; só `sessionId` e `state` são obrigatórios.
- **Assinatura**: cabeçalhos `X-Bunker-Timestamp` e `X-Bunker-Signature` = HMAC-SHA256 de `timestamp + "." + corpo`, conferida em tempo constante com tolerância de 5 minutos, o mesmo desenho de `verifySvixSignature` (`src/server/email/webhook-signature.ts`) e do `hottok` da Hotmart (`src/app/api/webhooks/hotmart/route.ts`). O segredo entra na máquina do Jibri pelo workflow na criação e nunca fica no repositório.
- Fluxo: assinatura inválida → 401 e nada gravado; válida → linha bruta em `webinar_recording_events` (`unique (session_id, state, coalesce(file_name, ''))`: repetição responde 200 sem refazer) → `recorder_status` da Sessão atualizado → com `uploaded`, `webinar_recordings` (`source = 'jibri'`, `status = 'processing'`) e o job `webinar-recordings` do tick consulta a Bunny até `ready`, grava `duration_seconds`, liga à sessão e cria o `replay`; sessão desconhecida → 202 `ignored` com log. `upload_failed` → e-mail para o produtor pela fila `email_outbox` (`enqueueEmail`) e a reserva da D3 (envio manual no admin).
- `GET /api/webhooks/recorder/[sessionId]` (mesma assinatura, no cabeçalho): devolve `{ recorderStatus, recordingStatus }` para o `jibri-down` conferir antes de apagar (§6.7).
- O corpo é limitado a 64 KB (`readBoundedJson`); `payload` guardado inteiro para auditoria e reprocessamento, como `webhook_events`.

### 5.4 O token JWT do Jitsi (emitido no servidor)

- `src/server/webinars/jitsi-token.ts` (proposto), HS256. No app: `WEBINAR_JWT_APP_ID=bunker707` e `WEBINAR_JWT_SECRET`; no Jitsi: `JWT_APP_ID=bunker707`, `JWT_APP_SECRET` (o mesmo valor), `JWT_ACCEPTED_ISSUERS=bunker707`, `JWT_ACCEPTED_AUDIENCES=bunker707`. Só no servidor (nunca em código do navegador nem em `NEXT_PUBLIC_*`); a instância roda `AUTH_TYPE=jwt`, `ENABLE_GUESTS=0`: **ninguém entra sem token**, ao contrário do parceiro.
- Claims: `iss = aud = "bunker707"`, `sub = <hostname do Jitsi>` (`meet.<domínio>`), `room = webinar_sessions.room_name` (nunca `*`), `nbf = agora − 60 s`, `exp = min(fim previsto + 30 min, agora + 6 h)`, `iat`; `context.user = { id: user_id, name: display_name (primeiro nome + inicial ou apelido), avatar }` sem e-mail (não é preciso e é dado pessoal a menos); `context.user.moderator = true` e `affiliation = "owner"` (`mod_token_affiliation` no Prosody, `ENABLE_AUTO_OWNER=0` no Jicofo para o primeiro aluno nunca virar moderador) conforme a matriz abaixo; `context.features = { recording: host, livestreaming: false, "screen-sharing": host | co_host, "outbound-call": false }`; o aluno não tem `moderator` nem `features`.
- Matriz de papéis (regra única do documento): **host** = `webinars.host_user_id` (`moderator: true`); **co-apresentador** = `webinar_presenters` com `role = co_host` (`moderator: true`); **Equipe** = `messaging.write` (`moderator: true` só com `can_moderate_room` marcado no editor; senão `false`); **aluno** = quem passou em `requireWebinarAccess` (`moderator: false`); banido (`webinar_session_bans`, `kind = kicked`) = 409. O token não é guardado; cada `join-token` emite um novo e grava `webinar_joined` na primeira entrada.
- O navegador recebe `{ jwt, room, domain, role }` e monta o iframe com `configOverwrite` (`disableChat`, `disablePolls`, `disableReactions`, `startSilent` para o aluno, `toolbarButtons` por papel, `constraints` por papel: aluno até 360p, palco 720p ou 1080p conforme `quality.stage`, D26): o chat, as reações e as enquetes são sempre os nossos (D5), e o relatório lê só o nosso banco; os sinais do iframe (`videoConferenceJoined/Left`, `raiseHandUpdated`, `recordingStatusChanged`) só completam a presença da live e marcam a âncora.

### 5.5 Decisões desta parte (a confirmar com o produtor)

| # | Decisão | Alternativa descartada |
|---|---|---|
| M1 | Balde de 30 s a partir do sinal de 15 s; uma linha por aluno, sessão e balde; saída depois de 90 s (3 baldes) | guardar cada sinal (dobro das linhas, mesma curva) |
| M2 | "Até o fim" = último balde ≥ 95 % da duração (o número do Zoom) | 100 % (pune quem sai nos créditos) |
| M3 | Pesos dos "mais quentes": mensagem 1, pergunta 2, reação 0,5, enquete 1, cada 10 min 1; teto de 50 mensagens; 0–100 pelo maior da sessão | pontuação absoluta (não compara sessões de tamanhos diferentes) |
| M4 | Ponto de queda = maior derivada negativa entre baldes vizinhos, top 5 em minutos distintos | média móvel (esconde a queda de um corte brusco) |
| M5 | Amostras apagadas 90 dias depois da sessão; curva congelada e `webinar_attendance` ficam | guardar para sempre (120 mil linhas por sessão de 500) |
| M6 | Simulação só em bloco e CSV próprios; `source = scripted` em cada linha do roteiro e `simulated_*` + `simulation_summary` na Sessão; o Assistente (`source = ai`) em bloco próprio, fora da Simulação | coluna booleana por sessão (não separa mensagem a mensagem) |
| M7 | Variante da oferta por hash determinístico (sem tabela); conversão ligada ao `sale_grants` em até 7 dias | tabela de sorteio por aluno; conversão pelo clique |
| M8 | Receita fica `—` até `webhook_events` ganhar `amount_cents` / `currency` (fase 4) | ler o valor do `payload` bruto a cada relatório |
| M9 | Lista por aluno e CSV sem cache; gráficos com cache de 60 s pelo minuto na chave | cache único (dados pessoais ficariam no Data Cache) |
| M10 | O aluno nunca lê nem grava `webinar_*` direto: só rotas e service role; Realtime, se entrar, só Broadcast com token do servidor | RLS por aluno (abre o chat inteiro à leitura direta e fecha a porta do roteiro) |

---

## 6. Por dentro

### 6.1 Três servidores e o que fala com o quê

| Servidor | Papel | O que roda | Dados que ficam nele |
|---|---|---|---|
| `bunker707-membros` (A, cx23, já existe) | o app e o banco | Next.js + Supabase self-hosted + Caddy (`infra/compose/docker-compose.yml`) | tudo que importa: Webinários, Sessões, vagas, chat, presença, relatórios |
| `bunker707-meet` (C, cx23, novo, fase 3) | o vídeo da Live ao vivo | docker-jitsi-meet (web, prosody, jicofo, jvb, coturn) + Caddy (`infra/jitsi/`) | nenhum dado de aluno; só configuração versionada e o `.env` |
| `bunker707-jibri-<sessão>` (D, cpx42, por hora, só durante a gravação; grava em 1080p, D26) | gravar a Live ao vivo | um container `jitsi/jibri` (`infra/jitsi/jibri/`) | o MP4 até subir para a Bunny; depois o servidor é apagado |

Regras que valem para tudo: o vídeo gravado nunca passa pelo servidor A (D11, AGENTS.md); o servidor C não tem banco nem chat (D5); nada é criado ou cobrado na Hetzner antes da fase 3 e sem ok do produtor no chat (D13, `docs/20`); o Jibri nunca roda na mesma máquina do Jitsi (D3; manual do Jitsi: 8 GB só para ele, uma gravação por máquina).

### 6.2 O stack do Jitsi em `infra/jitsi/` (novo, no padrão de `infra/mautic/`)

```txt
infra/jitsi/
  docker-compose.yml          web, prosody, jicofo, jvb (coturn é o passo seguinte; as portas ficam reservadas);
                              perfil `borda` com o Caddy (como o Mautic)
  caddy/Caddyfile             HTTPS automático em meet.<domínio>; proxy para web:8000 (o site da imagem escuta em
                              8000, HTTP, sem privilégio; websocket passa)
  prosody/plugins/mod_token_affiliation.lua   host e co-apresentador viram moderadores pelo token
  .env.example                todas as chaves comentadas (abaixo); generate-secrets.sh/.mjs gera as senhas
  web/custom-interface_config.js   sem marca d'água e sem nome Jitsi (D2)
  web/custom-config.js        logo, teto de bitrate, chat/enquetes/reações desligados
  jibri/docker-compose.yml    o container do gravador (roda no servidor D)
  jibri/finalize.sh           envia o MP4 para a Bunny e avisa o app (§6.7)
  scripts/_env.sh, smoke.sh, update.sh, logs.sh, jibri-status.sh, volumes.sh   no padrão de infra/mautic/scripts
  LICENSE-jitsi, NOTICE       Apache-2.0: a licença fica; a marca não aparece
```

`.env` do servidor C (valores de exemplo; os segredos vêm pelo envelope, §7.3):

```bash
JITSI_IMAGE_VERSION=stable-11248      # tag stable fixada; sobe só pelo update.sh (§7.4; docs/20 §8B.6)
PUBLIC_URL=https://meet.bunker707.com.br
TZ=UTC                                # hora de parede em UTC em todo servidor nosso
# Quem entra: só com JWT do nosso app (ninguém entra pelo link)
ENABLE_AUTH=1
AUTH_TYPE=jwt
JWT_APP_ID=bunker707                  # iss e aud do token
JWT_APP_SECRET=<envelope>             # o mesmo valor fica no app como WEBINAR_JWT_SECRET
JWT_ACCEPTED_ISSUERS=bunker707
JWT_ACCEPTED_AUDIENCES=bunker707
ENABLE_GUESTS=0                       # sem convidado anônimo
XMPP_MUC_MODULES=token_affiliation    # host vira moderador pelo JWT (context.user.moderator=true)
ENABLE_AUTO_OWNER=0                   # o primeiro que entra NÃO vira moderador (aluno nunca manda na sala)
# Sala
ENABLE_XMPP_WEBSOCKET=1               # transporte recomendado
ENABLE_LOBBY=1                        # sala de espera e Sessão de prática (D4)
ENABLE_PREJOIN_PAGE=0                 # a nossa página é a entrada
ENABLE_WELCOME_PAGE=0
ENABLE_CLOSE_PAGE=0                   # ao sair, volta para a nossa página
ENABLE_BREAKOUT_ROOMS=0
ENABLE_THIRD_PARTY_REQUESTS=0         # nada de gravatar nem chamadas de fora no navegador do aluno
DISABLE_DEEP_LINKING=1                # nunca oferece o app do Jitsi no celular (D2)
DISABLE_POLLS=1                       # enquetes são nossas (D5)
DISABLE_REACTIONS=1                   # reações são nossas (D5)
DISABLE_PRIVATE_CHAT=1                # chat é nosso (D5); o do Jitsi fica escondido no iframe
DISABLE_REMOTE_VIDEO_MENU=1           # aluno não abre menu sobre ninguém
START_WITH_AUDIO_MUTED=1              # todo mundo entra mudo (os nomes START_AUDIO_MUTED/START_VIDEO_MUTED
START_WITH_VIDEO_MUTED=1              # antigos ficam também, a imagem lê os dois)
RESOLUTION=1080                       # teto do palco (D26); o aluno fica em 360p pelo constraints do iframe dele (§6.3)
RESOLUTION_MIN=180
DESKTOP_SHARING_FRAMERATE_MIN=5
DESKTOP_SHARING_FRAMERATE_MAX=30      # tela compartilhada a 30 quadros (15 na opção do card Qualidade)
VIDEOQUALITY_BITRATE_FULL=4000000     # 1080p no palco cabe em ~4 Mbit/s
# Gravação
ENABLE_RECORDING=1                    # liga o botão e o domínio escondido do gravador
JIBRI_XMPP_USER=jibri
JIBRI_XMPP_PASSWORD=<gerado>
JIBRI_RECORDER_USER=recorder
JIBRI_RECORDER_PASSWORD=<gerado>
JIBRI_BREWERY_MUC=jibribrewery
# Rede
JVB_PORT=10000                        # UDP da mídia
JVB_ADVERTISE_IPS=<IPv4 público>      # o JVB está atrás do NAT do Docker; a etapa deploy-meet grava
XMPP_PUBLIC_BIND=0.0.0.0              # 5222 publicada só para o Jibri; o firewall da Hetzner limita a origem
TURN_HOST=meet.bunker707.com.br       # TURN reservado (coturn é o passo seguinte)
TURN_PORT=3478
TURNS_HOST=meet.bunker707.com.br
TURNS_PORT=5349
TURN_CREDENTIALS=<gerado>
# Memória da JVM para caber num cx23 de 4 GB (nomes conferidos no env.example da tag fixada)
VIDEOBRIDGE_MAX_MEMORY=1536m          # o JVB: um palco 1080p e 100-150 alunos cabem com folga
JICOFO_MAX_MEMORY=512m                # um palco por vez
```

`web/custom-interface_config.js` (D2; só funciona em instância própria, porque essas chaves estão fora da whitelist do IFrame API):

```js
interfaceConfig.SHOW_JITSI_WATERMARK = false;
interfaceConfig.SHOW_BRAND_WATERMARK = false;
interfaceConfig.SHOW_POWERED_BY = false;
interfaceConfig.APP_NAME = 'Bunker707';
interfaceConfig.PROVIDER_NAME = 'Bunker707';
interfaceConfig.JITSI_WATERMARK_LINK = '';
interfaceConfig.DEFAULT_WELCOME_PAGE_LOGO_URL = '';
interfaceConfig.MOBILE_APP_PROMO = false;
interfaceConfig.SHOW_CHROME_EXTENSION_BANNER = false;
```

`web/custom-config.js`:

```js
config.defaultLogoUrl = '';                      // ou DYNAMIC_BRANDING_URL para o logo da Bunker707
config.readOnlyName = true;                      // o nome vem do JWT
config.disableSelfView = true;
config.hideConferenceSubject = true;
config.hideConferenceTimer = true;               // o contador é o nosso
config.disableRemoteMute = true;                 // só o host silencia
config.channelLastN = 9;                         // cada um recebe no máximo o palco + 8 miniaturas (quem falou por último)
config.videoQuality = {
  maxBitratesVideo: { VP8: { low: 200000, standard: 500000, high: 4000000 } },  // 1080p no palco cabe em ~4 Mbit/s
  minHeightForQualityLvl: { 360: 'standard', 720: 'high' }                     // miniatura pequena recebe 180p; maior, 360p; palco, o máximo
};
config.desktopSharingFrameRate = { min: 5, max: 30 };   // tela compartilhada a 30 quadros (mouse e escrita fluidos); 15 na opção do card Qualidade
```

A regra de qualidade (D26) é a que o Jitsi já aplica com simulcast: cada vídeo sai de quem transmite em três tamanhos ao mesmo tempo, e cada aluno recebe o tamanho que cabe no espaço do vídeo na tela dele (palco grande recebe o maior, miniatura recebe o menor); em 4G o Jitsi mede a conexão e desce sozinho para 720p ou 360p. Os tetos por papel vão no `configOverwrite` de cada iframe (§6.3): palco 720p ou 1080p (`quality.stage`), tela compartilhada 1080p a 30 quadros (ou 15), câmera de aluno até 360p (`constraints.video.height.max = 360` no iframe do aluno), miniaturas até 360p e 180p na fileira pequena (`minHeightForQualityLvl`). A gravação do Jibri é a tela desse mesmo site, em 1080p, então o MP4 também sai sem marca. O `external_api.js` é servido por `meet.<domínio>`, nunca por `meet.jit.si`.

**Rede.** `meet.<domínio>` é um registro A/AAAA **só DNS** (`cf_dns_upsert ... false` em `infra/cloud/lib.sh`, que já aceita o parâmetro `proxied`): WebRTC/UDP não passa pelo proxy da Cloudflare. Consequência: o IP do servidor C fica visível; a proteção é o firewall da Hetzner, o fail2ban e o Caddy (sem Cloudflare na frente, o Caddyfile dele **não** importa `cloudflare-trusted-proxies.caddyfile`). Firewall da Hetzner para o C, nova função `fw_rules_meet` ao lado de `fw_rules` em `lib.sh`:

| Porta | De onde | Para quê |
|---|---|---|
| TCP 80, 443 | qualquer lugar | site do Jitsi, `external_api.js`, websocket XMPP, Let's Encrypt |
| UDP 10000 | qualquer lugar | mídia (JVB) |
| UDP 3478, TCP 5349 | qualquer lugar | TURN/TURNS (alunos em rede fechada) |
| TCP 5222 | só o IP do Jibri da vez | o gravador fala com o prosody; regra posta pelo `jibri-up` e tirada pelo `jibri-down` |
| TCP 22 | só durante a etapa (padrão `fw_open_ssh`) | deploy e operação |
| ICMP | qualquer lugar | ping do monitor |

TURN em 443/TCP (o que mais passa em rede corporativa) exige um segundo endereço IP só para o coturn ou o nginx do stack dividindo a 443 por SNI; fica como opção B, decidida depois da live piloto (I7).

### 6.3 O que muda no app

- **CSP** (`src/proxy.ts`): nada muda. O `external_api.js` é carregado por um `<script>` com o nonce da página (`'nonce-…' 'strict-dynamic'` já em `src/proxy.ts`), então nenhuma origem nova entra em `script-src`; a guarda de §10.2 confere isso. `frame-src 'self' https:` já aceita o iframe; `connect-src` não muda, porque o websocket e a mídia saem do iframe (origem do Jitsi), não da nossa página.
- **Permissions-Policy** (`next.config.ts`, `permissionsPolicy`): hoje `camera=()`, `microphone=()` e `display-capture=()` em toda página do aluno. Com isso o iframe do Jitsi não consegue abrir o microfone de quem levantou a mão nem a câmera do Apresentador ou do aluno. Regra nova só para `/webinarios/:path*`: `camera=(self "https://meet.<domínio>")`, `microphone=(self "https://meet.<domínio>")`, `display-capture=(self "https://meet.<domínio>")`; `tests/deployment-security.test.mjs` confere o valor efetivo. No iframe, `allow="camera; microphone; display-capture; autoplay; fullscreen"` (o `external_api.js` já põe esse `allow`; se o iframe for montado por nós, vai explícito).
- **JWT** (`src/server/webinars/jitsi-token.ts`, HS256 com `WEBINAR_JWT_SECRET`, `WEBINAR_JWT_APP_ID=bunker707`): emitido por `POST /api/webinars/[id]/join-token` depois de conferir o acesso (D8) e o estado da Sessão. Claims e matriz de papéis exatamente como §5.4: `iss = aud = bunker707`, `sub = meet.<domínio>`, `room = room_name`, `nbf = agora − 60 s`, `exp = min(fim previsto + 30 min, agora + 6 h)`; host e co-apresentador `moderator: true`; Equipe `moderator: true` só com `can_moderate_room`; aluno `false`. O token nunca é guardado; a chave fica só no `.env` dos servidores A e C.
- **Embed**: `external_api.js` com `configOverwrite` por papel (`toolbarButtons` do host: `microphone, camera, desktop, raisehand, participants-pane, recording, security, hangup`; do aluno: `camera, raisehand, fullscreen, hangup`; `disableChat`, `disablePolls`, `disableReactions` sempre; `constraints` por papel, D26: aluno `{ video: { height: { ideal: 360, max: 360 } } }`, host e co-apresentador `{ video: { height: { ideal: 720 ou 1080, max: idem } } }` conforme `quality.stage`; tela compartilhada em 1080p com `desktopSharingFrameRate` 30 ou 15 conforme `quality.screen_fps`; com `allow_student_camera = false`, o aluno não recebe o botão `camera`). Os controles de Zoom (silenciar todos, fechar câmeras, liberar quem levantou a mão, remover, trancar, destacar, gravar) são botões nossos que chamam `executeCommand` (`muteEveryone` de áudio ou de vídeo, `toggleModeration` de áudio ou de vídeo, `askToUnmute`, `kickParticipant`, `toggleLobby`, `setLargeVideoParticipant`, `startRecording {mode:'file'}`).
- **Sinais do IFrame API que alimentam o app**: `videoConferenceJoined/Left`, `participantJoined/Left`, `raiseHandUpdated`, `dominantSpeakerChanged`, `participantRoleChanged`, `recordingStatusChanged`, `errorOccurred`. Vão para `POST /api/webinars/[id]/room-events` em lotes (§5.1) e viram linhas em `student_events` (`entity_type = 'webinar'`, já na exceção da política de insert do aluno desde a fase 1, como foi feito com `'campaign'` em `docs/29`). Reações e enquetes não existem no IFrame API: são nossas de ponta a ponta (D5).
- **Presença**: sinal a cada 15 s para `POST /api/webinars/[id]/heartbeat` com `{ sessionId, offsetSeconds, state, visible }` e `sendBeacon` com `leave: true` ao sair, o mesmo padrão do progresso da aula (`lesson-experience.tsx`). Aba escondida no iOS para de bater: a linha fica com `visible = false`, não vira "saiu" antes dos 90 s.
- **Chat**: `POST /api/webinars/[id]/chat` grava `created_at` do servidor e `offset_ms` (§6.5). Distribuição para quem está na sala: Realtime do Supabase (`realtime` já roda no compose, 210 MiB ocioso em `docs/20` §4.3, e `wss://` já está no `connect-src`) **ou** polling de 3 a 5 s. D5 manda medir: com a etapa `carga` (`infra/cloud/carga.sh`) ampliada para 100 alunos virtuais no chat, no servidor A de 4 GB. Enquanto não houver medida, o padrão é polling (sem serviço novo no caminho).

### 6.4 Uma Live ao vivo do começo ao fim

1. **Agendar** (admin, fase 1): Webinário + Sessão `kind = live`, `scheduled_at`, duração, acesso (D8). Nenhum servidor é tocado.
2. **Lembretes** (tick): job `webinar-reminders` em `src/server/jobs/registry.ts`, 24 h e 1 h antes, sino + e-mail pela fila `email_outbox` (`src/server/email/outbox.ts`); só para quem clicou **Garantir vaga** (regra do atraso em §2.7).
3. **Preparar gravação** (admin, 30 min antes, ou agendado pelo tick em `scheduled_at − 30 min`): `requestRecorder` dispara o workflow "Infra (Hetzner)" na etapa `jibri-up` pela API do GitHub (§6.7). `recorder_status = preparing`.
4. **Gravador pronto**: o `jibri-up` chama `POST /api/webhooks/recorder` (assinado) com `state = ready`; `recorder_status = ready`; o admin mostra "Gravação pronta". Sem gravador (Hetzner sem estoque): `state = unavailable`, o admin mostra "Gravar no navegador" (reserva, D3).
5. **Host entra**: `POST /api/webinars/[id]/join-token` devolve o JWT de moderador; o iframe abre em `meet.<domínio>`; `mod_token_affiliation` dá `owner`; a Sessão de prática é o lobby do Jitsi ligado até o host clicar **Começar para todos**; depois disso o lobby segue a opção Sala de espera (desligada por padrão).
6. **Alunos entram** por `/webinarios/[slug]`: JWT de aluno, mudo e com a câmera desligada (ele liga se quiser, em 360p, depois do aviso de gravação); o Jitsi mostra o palco e até 8 miniaturas; o chat ao lado é o nosso.
7. **Gravar**: o host clica **Gravar** → `startRecording {mode:'file'}` → o Jibri entra como participante escondido (não conta na plateia) → `recordingStatusChanged {on:true}` chega ao navegador do host → a ação `markRecordingAnchor` grava `recording_anchor_at = now()` (hora do servidor, nunca a do navegador) e `recorder_status = recording`. Essa é a **âncora** (§6.5). Se o host clicar antes de `ready`, o botão mostra "Preparando a gravação, {n} min" e o clique fica na fila: a gravação começa sozinha quando o `ready` chegar (§6.7).
8. **Durante**: chat, reações, enquetes, mão levantada e presença no nosso banco; o host controla a sala pelos botões nossos; `errorOccurred` vai para o Sentry pelo app.
9. **Encerrar**: o host clica **Encerrar live** → `stopRecording` + `hangup` para todos → `endLiveSession` grava `ended_at = now()`, congela a curva e `webinar_attendance`; o Jibri grava o fim e roda o `finalize.sh`.
10. **Replay**: o `finalize.sh` sobe o MP4 para a Bunny e chama `POST /api/webhooks/recorder` com `state = uploaded` e o `bunnyVideoId`; o app cria `webinar_recordings` em `processing`; quando a Bunny termina de codificar (consulta no tick), a gravação fica `ready` e a sessão `replay` é criada (§5.2 `endLiveSession`); opcionalmente vira aula em [produto › módulo], como `docs/17` §1.8.3.
11. **Apagar o gravador**: o tick, ao ver `uploaded`, chama `releaseRecorder` → `jibri-down`; `jibri-down` só apaga com `uploaded` (ou `FORCAR=1`) e manda `state = gone`.
12. **Relatório**: função SQL com cache de 60 s, como o relatório do pop-up (`docs/29` §2.6 e §4.6), lendo presença, chat e `student_events`.

### 6.5 A âncora e o offset

- Toda mensagem, reação, enquete e batida de presença tem `created_at` (hora do servidor A) e `offset_ms = created_at − recording_anchor_at`. Antes da âncora, o offset é negativo (sala de espera) e não entra no Replay.
- O Jibri não grava a hora de início no `metadata.json`; o nome do arquivo leva `_yyyy-MM-dd-HH-mm-ss` do relógio do Jibri (UTC, `TZ=UTC`). O `finalize.sh` manda esse carimbo (`startedAt`); o app mostra a diferença para `recording_anchor_at` como conferência.
- O Jibri entra alguns segundos depois do clique (quanto: a medir na live piloto). Por isso o admin tem **Alinhar chat** (±segundos, com prévia: escolhe uma mensagem e vê o vídeo naquele ponto). O ajuste grava `webinar_recordings.anchor_offset_ms`; nenhum offset de mensagem é reescrito.
- Replay e Live gravada usam o mesmo relógio: `posição no vídeo = offset_ms − anchor_offset_ms`.

### 6.6 A Live gravada por dentro

- **Relógio**: `GET /api/webinars/[id]/session` devolve `serverTime`, `startedAt`, `endedAt`, `video` (Bunny) e as regras da Sessão. O navegador guarda `skew = serverTime − Date.now()` (corrigido por metade do tempo de ida e volta), refaz a cada 60 s e ao voltar da aba escondida. Alvo: `target = (Date.now() + skew) − scheduled_at` (a hora marcada da Sessão é o zero do vídeo). Tolerância entre alunos: ±1 s, suficiente para o chat parecer ao vivo. Quem entra atrasado entra no ponto atual; quem pausa ou cai volta no ponto atual, não onde parou.
- **Player da Bunny**: iframe `iframe.mediadelivery.net` com `autoplay=true&muted=true` e o botão **Ativar som** (o navegador bloqueia som automático). A ponte já existente lê o Player.js (`src/lib/lesson-embed-bridge.ts`, origens exatas em `src/lib/lesson-embed-origins.ts`, `onTime` no máximo 1 vez por segundo); ganha dois comandos novos, `play` e `setCurrentTime`. Regra: a cada `timeupdate`, se `|currentTime − target| > 2 s`, `setCurrentTime(target)`; a cada `seeked` fora do alvo, volta para o alvo. Barra de progresso escondida (configuração do player na biblioteca da Bunny, a conferir; se não houver, o componente cobre a barra). Sem voltar, sem pausar: a Sessão simula o ao vivo; só o Replay livre tem barra.
- **Janela de mensagens**: o navegador baixa `GET /api/webinars/[id]/chat?sessao=&from=<offset>&to=<offset+120 s>` a cada 90 s (a RPC `webinar_chat_window`: as linhas da própria sessão, inclusive o roteiro já solto, mais a linha mestre `master` da sessão de origem deslocada pela âncora e as promovidas do webinário, D31) e revela cada linha quando `offset_player ≥ offset_ms`; as mensagens novas da turma de hoje chegam pela consulta de 5 s (`?since=&after=`), e a sessão abre e encerra pelo tick (`webinar_open_session` solta o roteiro pronto uma vez; `webinar_close_session` resume a presença e congela a curva). As mensagens novas da turma atual entram com `offset_ms = server_now − scheduled_at` e chegam pelo mesmo canal do ao vivo (§6.3, Realtime ou polling, a medir). Entram na linha mestre só depois da aprovação da Equipe (D10: consentimento na primeira mensagem, **Remover minhas mensagens**).
- **Solta em "Quando o apresentador diz"** (D6-b): resolvido **ao salvar**, não ao vivo. A transcrição do vídeo entra no mesmo lugar das aulas (`lesson_transcripts`; `src/server/ai/transcripts.ts` já quebra VTT/SRT em `cues` com `startSeconds`). A Equipe digita a frase; o servidor procura nas `cues` (texto normalizado, busca aproximada), acha `startSeconds` e grava a mensagem com `offset_ms = startSeconds × 1000 + atraso escolhido`. Não achou: o editor avisa e oferece o offset na mão. Na hora da Sessão é só mais uma linha por offset.
- **Solta em "Pelo botão da equipe"** (D6-c): **Soltar agora** na tela da Equipe grava a linha com o offset atual e ela chega pelo canal das mensagens novas; pode ser promovida à linha mestre.
- **Contador simulado e entradas/saídas** (D6, D10; fase 4): regra por Sessão (`simulated_count_rule`, `simulated_joins`), calculada **no servidor** como função do offset mais uma semente da Sessão: todos veem o mesmo número; nada é gravado em `student_events`; os totais vão para `simulation_summary` no fim; o relatório mostra num bloco "Simulação" separado. A escolha fica registrada na Sessão (`simulation_decided_by/at`, `simulation_ack_text`).
- **Agente de IA no chat** (D6; fase 4): reaproveita o gateway (`src/server/ai/account-gateway.ts`, `provider-adapter.ts`) e o padrão do Tutor (`src/server/ai/tutor.ts`): contexto = as `cues` em volta do offset atual + perguntas e respostas cadastradas no Webinário; responde como `role = ai`, `source = ai`, selo **Assistente**; só quando chamado ("@assistente", aba Perguntas) ou com **Responder tudo** ligado, e nunca enquanto um atendente humano está com a pergunta; limite por aluno e por minuto; nunca entra na linha mestre sem aprovação. Roda depois da resposta do `POST /chat` (`after()` do Next 16), com teto de tempo; fila só se a medição pedir (trabalho pesado não entra no tick, regra do `registry.ts`). Custo em tokens: a medir.
- **Sala Live vertical 9:16** (fase 4): mesma Sessão, mesmo relógio, mesmas rotas; é outro desenho da mesma página (vídeo em `cover`, chat sobreposto, selo e contador, card de oferta que abre o checkout em outra aba). Nada novo na infra.

### 6.7 O Jibri por hora

**Etapas novas** no `.github/workflows/infra.yml` e em `infra/cloud/run.sh`: `jibri-up`, `jibri-down`, `exec-jibri` (socorro), além de `provision-meet`, `deploy-meet`, `secrets-meet` e `exec-meet` para o servidor C (mesmo padrão de `deploy-marketing`/`secrets-marketing`). Script novo `infra/cloud/jibri.sh`, carregando `lib.sh`:

`jibri-up` (OPCOES: `SESSAO=<id>`, `JIBRI_TYPE=cpx42`; 8 vCPU e 16 GB para gravar 1080p a 30 quadros, D26):

1. Cria `bunker707-jibri-<sessão>` (labels `app=bunker707`, `papel=jibri`, `sessao=<id>`) com `hz server create`, tentando `fsn1`, depois `FALLBACK_LOCATIONS` (`nbg1 hel1`), reaproveitando o laço de `create_server` em `provision.sh`; cloud-init = `infra/cloud/cloud-init.yaml` + Docker + `docker pull jitsi/jibri:$JITSI_IMAGE_VERSION`. Firewall próprio sem porta de entrada (só a 22 durante a etapa).
2. `wait_ssh`; grava `/opt/jibri/.env` com `set_env` (0600): `XMPP_SERVER=meet.<domínio>`, domínios XMPP iguais aos do C, `JIBRI_XMPP_PASSWORD`, `JIBRI_RECORDER_PASSWORD`, `JIBRI_RECORDING_RESOLUTION=1920x1080` (gravação em 1080p, D26), `JIBRI_FINALIZE_RECORDING_SCRIPT_PATH=/config/finalize.sh`, `JIBRI_SINGLE_USE_MODE=1`, `TZ=UTC`, `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY`, `WEBINAR_RECORDER_WEBHOOK_URL`, `WEBINAR_RECORDER_WEBHOOK_SECRET`, `SESSAO`; copia `infra/jitsi/jibri/{docker-compose.yml,finalize.sh}`.
3. Põe no firewall do C a regra TCP 5222 para o IP do Jibri.
4. `docker compose up -d` (`shm_size: 2gb`); espera o health do Jibri (porta e caminho a conferir na imagem da tag fixada) responder ocioso.
5. Chama `POST /api/webhooks/recorder` com `{ sessionId, state: "ready" }` (assinatura HMAC-SHA256 com carimbo de hora, §5.3; o app guarda o corpo bruto e é idempotente por `(session_id, state, file_name)`).
6. Fecha a 22 (`fw_close_all`). Tempo total: a medir (o `pull` da imagem é a parte lenta). Depois da primeira live, um snapshot "jibri-base" (EUR 0,0143/GB/mês, uns centavos) tira o `pull` do caminho crítico (I5).

**Gravar antes de o Jibri ficar pronto**: o botão **Gravar** fica com "Preparando a gravação, {n} min" (estimativa pelo tempo medido nas últimas subidas; sem medida, "em alguns minutos"); o clique do host fica guardado na Sessão (`recording_requested_at`) e o navegador do host dispara `startRecording` sozinho quando o `GET …/session` devolver `recorderStatus = ready`. Se a live passar do `exp` do token do Jibri (o Jibri entra com o próprio usuário XMPP, sem JWT nosso, então não vence; o que vence é o token do host, e a página pede outro `join-token` sem derrubar a gravação).

`finalize.sh` (roda no Jibri, recebe a pasta da gravação): acha o MP4; lê tamanho, `sha256` e o carimbo `yyyy-MM-dd-HH-mm-ss` do nome; duração por `ffprobe`; **cria o vídeo** na biblioteca da Bunny Stream (API de upload: criar o vídeo, depois enviar o arquivo; com 3 tentativas; TUS se o arquivo passar do tamanho que a medição indicar); chama o webhook com `{ sessionId, state: "uploaded", room, fileName, startedAt, durationSeconds, sizeBytes, sha256, bunnyLibraryId, bunnyVideoId }`. Falhou o upload: `state = upload_failed` com `error`, o arquivo fica no servidor e o `jibri-down` recusa apagar; a Equipe técnica busca por `exec-jibri` (ou `scp` pela etapa) e sobe pelo admin.

`jibri-down` (OPCOES: `SESSAO=<id>` ou todos com `papel=jibri`; `FORCAR=1`): confere no app (`GET /api/webhooks/recorder/[sessionId]`, §5.3) que o estado é `uploaded` (ou que não houve gravação), apaga o servidor, tira a regra 5222 do C, chama o webhook com `state = gone`. Rede de segurança contra servidor esquecido: o tick avisa a Equipe no sino se um Jibri passar de 6 h, e um disparo diário de `jibri-down` sem `SESSAO` apaga o que estiver `uploaded`/sem gravação (I6; o workflow hoje só roda por `workflow_dispatch`, então o disparo diário é o app pela API do GitHub, não um `schedule` novo no YAML).

**Quem dispara**: o app, com um token do GitHub restrito a este repositório e só a "Actions: write" (`GITHUB_INFRA_TOKEN`, pelo envelope). Assim o app nunca tem o `HCLOUD_TOKEN` e cada subida e descida fica registrada no histórico do workflow. O produtor vê um botão: **Preparar gravação** (ou o agendamento automático em `scheduled_at − 30 min`).

**Custo por live**: cpx42 (8 vCPU, 16 GB) = EUR 81,99/mês na API da conta em 28/10 (`plan`), ou seja, ≈ EUR 0,112/h (a Hetzner cobra por hora até o teto mensal; os preços da página já incluem o IPv4, `docs/19`/`docs/21` somam EUR 0,50 à parte; vale a fatura). Live de 2 h + 30 min de preparo = cerca de 2,5 h ≈ **EUR 0,28** (EUR 0,34 se a Hetzner arredondar para a hora cheia; conferir na primeira fatura). O IPv4 por hora do Jibri é desprezível (a conferir na fatura). Dentro dos "20 centavos por hora" que o produtor aceitou. Se a live piloto mostrar que o cpx32 (4 vCPU, 8 GB, ≈ EUR 0,058/h) grava 1080p a 30 quadros sem perder quadros, o tipo desce para cpx32 e a live passa a custar ≈ EUR 0,15 (A26).

**"Currently unavailable"**: o `jibri-up` tenta cpx42 em 3 locais; depois `ccx23`; depois `cpx32` gravando em 720p (`JIBRI_RECORDING_RESOLUTION=1280x720`, com aviso no admin de que o replay sai em 720p). Sem nenhum: o webhook recebe `state = unavailable`, o admin mostra "Sem gravador hoje: gravar no navegador" (Chromium, captura da aba) ou OBS, com **Enviar gravação** no admin depois (D3). A live acontece do mesmo jeito; só o Replay demora.

---

## 7. Infra, operação e custo

### 7.1 O cx23 do Jitsi (2 vCPU, 4 GB): até onde vai

Memória (o manual do Jitsi sugere 8 GB e chama 4 GB de "pequeno"; a aposta é caber com tetos na JVM e swap de 2 GB do `bootstrap.sh`):

| Serviço | Memória esperada | Base |
|---|---|---|
| jvb (JVM) | teto da JVM (variável a conferir no `env.example` da tag) | a medir |
| jicofo (JVM) | teto da JVM (idem) | a medir |
| prosody | dezenas de MiB; usa um núcleo só | manual do Jitsi; a medir |
| web (nginx) | dezenas de MiB | a medir |
| coturn | dezenas de MiB | a medir |
| caddy | ~26 MiB | medido no servidor A (`docs/20` §4.3) |
| sistema + Docker | 300 a 400 MiB | `docs/20` §4.3 |
| **Soma** | **a medir (estimativa)** | `status-ssh` mostra `free -h`; se não couber, cx33 |

CPU e banda (o limite de verdade):

| Medida | Número | Fonte |
|---|---|---|
| Banda por aluno que recebe (D26) | palco 720p ≈ 2 Mbit/s; palco 1080p ou tela 1080p a 30 quadros ≈ 4 Mbit/s (manual do Jitsi: 720p ≈ 2,5 Mbit/s no pior caso; tela parada comprime bem mais); mais as miniaturas: 8 × 180p ≈ 1,2 Mbit/s na fileira pequena, 8 × 360p ≈ 4 Mbit/s na grade grande | manual; `custom-config.js` |
| Banda por aluno que envia a câmera | ≈ 0,65 Mbit/s (360p mais a camada de 180p) | manual |
| O que 1 vCPU do JVB entrega | ~73 Mbit/s (um único teste de terceiros, ~3 GHz, AES-NI); no cx23 a vCPU é compartilhada | a medir no cx23 |
| 30 alunos, todos com câmera, palco 1080p | ≈ 160 a 240 Mbit/s no servidor: cabe no cx23, perto do limite confortável; com palco 720p, ≈ 100 Mbit/s | conta derivada, a medir no piloto |
| 100 alunos, todos com câmera, palco 1080p | ≈ 520 a 800 Mbit/s: pede cx33 ou cpx32 e é a hora de preparar a fase 2 de escala; com palco 720p e miniaturas em 180p, ≈ 320 Mbit/s | conta derivada, a medir |
| Velocidade da porta da VM | não publicada pela Hetzner | confirmar com o suporte antes da fase 3 |
| Tráfego de 4 lives de 90 min com 100 alunos | 0,9 a 2,2 TB por mês (3,2 a 8 Mbit/s por aluno): conta derivada, a medir; + o Jibri como mais um espectador + o upload do MP4 (2 a 4 GB por live em 1080p, a medir) | 20 TB inclusos na UE; EUR 0 |
| Meta da fase 1 | **~30 a 40 alunos com câmera no cx23**; **~100** só com cx33 ou cpx32, ou com o palco em 720p e miniaturas em 180p (meta, não limite medido) | D1, D7, D26 |
| Latência São Paulo ↔ Falkenstein | ~190 ms ida e volta (187 a 196 ms) | `docs/19` §3.3; D12: live piloto com 5-10 alunos mede |

Ordem de medida (D12): piloto com 5-10 alunos → 30 → 100 alunos virtuais pela etapa `carga` ampliada (navegadores sem cabeça entrando na sala) antes da primeira live de verdade com 100. O que olhar: CPU e steal do cx23 (`top`), saída de rede (`vnstat`/`ifstat`), perda de pacotes e bitrate nas estatísticas do JVB (API interna, só por SSH), e no aluno o `errorOccurred` e as quedas no `student_events`.

### 7.2 O caminho para 300-500

| Passo | Quando | O que muda | Limite novo |
|---|---|---|---|
| cx33 (4 vCPU, 8 GB; EUR 8,99 na página em 28/10, 9,99 em `docs/21`; vale o console) | quando houver estoque; o script que fica procurando fica para depois (decisão do produtor); **a troca só com ok do produtor no chat** (com IPv4 pode passar de EUR 10/mês, D12) | ver o procedimento abaixo | ≈ 290 Mbit/s de JVB por conta derivada; na prática ~100 alunos com câmera e palco 1080p (a medir) |
| Palco em 720p e miniaturas em 180p | passar de ~40 alunos com câmera no cx23, ou a piloto mostrar perda em 4G | `quality.stage = 720` no webinário e o `minHeightForQualityLvl` de §6.2 | ≈ 3,2 Mbit/s por aluno |
| Fase 2: palco no Jitsi, alunos por HLS | ~150-300 simultâneos ou duas lives ao mesmo tempo | o Jibri faz `startRecording {mode:'stream'}` RTMP para o Mux (`low`, ~5 s; US$ 0,03125/min de entrada + US$ 0,001/min entregue após 100 mil min grátis/mês) ou Cloudflare Stream (US$ 1/1.000 min); a página do aluno troca o iframe por um player HLS; o chat e tudo o mais continuam iguais | banda sai do servidor C; atraso de ~5 s |
| Alternativa: modo "visitors" | mesmo gatilho; só se o atraso de 5 s incomodar | Prosodies visitantes (500 por nó, não é teto rígido), `jicofo.visitors`; o README oficial ainda é "Work In Progress" | a medir; mais operação |

**Troca do cx23 pelo cx33 sem perder configuração** (nada de dados mora no C): caminho preferido é o **rescale pelo console da Hetzner** (desliga, troca o tipo mantendo disco e IP, liga; nenhuma mudança de DNS; tempo a medir), feito fora de qualquer live nas 2 h seguintes; caminho B é `provision-meet` com `MEET_TYPE=cx33` num servidor novo + `deploy-meet` + `secrets-meet` + `cf_apply_dns` apontando `meet.<domínio>` para o IP novo, e só então apagar o antigo (o JWT não muda: o `sub` é o hostname, não o IP). A arquitetura já nasce pronta para a fase 2: o vídeo é uma peça trocável (iframe do Jitsi ou player HLS) e o resto (JWT, chat, presença, relatório, Replay) não muda.

### 7.3 Segredos

| Segredo | Onde fica | Como chega |
|---|---|---|
| `JWT_APP_SECRET` (C) = `WEBINAR_JWT_SECRET` (A); `JWT_APP_ID` = `WEBINAR_JWT_APP_ID` = `bunker707` | `.env` do C e do A | gerado na etapa (`openssl rand -hex 32`), entregue aos dois por envelope (`infra/cloud/envelope.sh`, `docs/20` §4A.6) |
| `JIBRI_XMPP_PASSWORD`, `JIBRI_RECORDER_PASSWORD`, `TURN_CREDENTIALS` | `.env` do C | `generate-secrets.sh` do stack, no padrão do Mautic |
| `BUNNY_API_KEY` + `BUNNY_LIBRARY_ID` | só no Jibri (upload) | ver abaixo |
| `WEBINAR_RECORDER_WEBHOOK_SECRET` | A e Jibri | envelope para o A; ver abaixo para o Jibri |
| `GITHUB_INFRA_TOKEN` (Actions: write, só este repositório) | `.env` do A | envelope |

O Jibri vive cerca de 2,5 h por live de 2 h e não tem `transfer.key`: o envelope não serve. Proposta (I4): um segredo do repositório no GitHub, `JIBRI_SECRETS` (várias linhas `CHAVE=VALOR`, mascarado no log), que o `jibri-up` grava por SSH com `set_env` e umask 077, como o `deploy.sh` faz com o `.env`. É um lugar novo para segredo, por isso está nos pontos em aberto. Nunca em `opcoes`, nunca no cloud-init (a Hetzner guarda o user-data).

### 7.4 Operação

**Atualizar o Jitsi.** Uma versão stable a cada 4-8 semanas. `infra/jitsi/scripts/update.sh --check` compara `JITSI_IMAGE_VERSION` com a última tag stable (padrão de `infra/scripts/update.sh`); `--apply` troca a tag no `.env.example` e no compose do Jibri (as duas imagens sempre na mesma linha). Caminho: ensaio local (`docs/20` §4) → PR → `deploy-meet` (`compose pull` + `up -d` + `smoke.sh`) **nunca com live nas próximas 2 h** (a etapa consulta a agenda pública do app e recusa). Ritmo: toda stable, no máximo duas atrasadas; correção de segurança na hora. O stack do servidor A não muda por causa disso.

**Monitorar.** O Sentry não cobre o servidor C. No monitor de fora (`docs/20` §12, Better Stack): HTTPS em `https://meet.<domínio>/` (200, palavra-chave `Bunker707`), certificado (aviso 14 dias antes), ping. **Quem recebe o alerta**: o mesmo e-mail e o mesmo canal do monitor do servidor A (o produtor e a Equipe técnica, `docs/20` §12); se o monitor acusar queda com live marcada nas próximas 24 h, o plano B é a **Live gravada do dia**: a Equipe (a) abre uma sessão `simulated` do último replay do mesmo Webinário ou do Webinário anterior no horário marcado, (b) manda pelo sino, com um clique no admin, o texto pronto de §2.7 ("A live {título} de hoje mudou: assista à sessão gravada às {hora}. Entrar.") para quem garantiu vaga, e (c) só depois reprovisiona o C. Antes de cada live: botão **Testar sala** no admin (o host entra numa sala de teste, vê câmera, microfone e `recordingStatusChanged` com um Jibri de teste quando houver). Durante: `errorOccurred` e quedas em `student_events`, lidos pelo painel "Lives ao vivo". Por SSH (`status-ssh` estendido ao C): `docker compose ps`, `free -h`, a saída de rede.

**Backup.** Nada de dados no C: configuração em `infra/jitsi/` (git) e `.env` refeito por `secrets-meet`. Perdeu o servidor: `provision-meet` + `deploy-meet` + `secrets-meet` (tempo a medir), DNS refeito pelo `cf_apply_dns`. O chat, a presença e os relatórios estão no servidor A, cobertos pelo `backup.sh` de sempre. O MP4 fica na Bunny; o Jibri é descartável por desenho.

**Runbook a acrescentar no `docs/20` (nova seção "Webinários: servidores C e D")**:

| Sintoma | Verificar | Ação |
|---|---|---|
| Aluno vê a sala mas sem vídeo nem áudio | UDP 10000 e TURN no firewall do C; `errorOccurred` no painel | `exec-meet` com `docker compose logs jvb`; testar com TURN forçado; opção B do TURN em 443 (I7) |
| Host entra como participante, não como moderador | `XMPP_MUC_MODULES=token_affiliation`, `ENABLE_AUTO_OWNER=0`, claim `moderator` no JWT | conferir o token em `/api/webinars/[id]/join-token` (sem imprimir a chave); `docker compose logs prosody` |
| "Gravação pronta" não chega | Jibri no brewery? regra 5222 no firewall do C? | `exec-jibri` com `docker compose logs jibri`; refazer `jibri-up` |
| Hetzner sem cpx32 | log do `jibri-up` ("unavailable" nos 3 locais e nos tipos de reserva) | gravar no navegador/OBS; **Enviar gravação** no admin |
| Upload falhou (`upload_failed`) | `exec-jibri`: arquivo em `/opt/jibri/recordings` | copiar o MP4, subir pelo admin; só então `jibri-down FORCAR=1` |
| Jibri esquecido ligado | `status` lista `papel=jibri` com mais de 6 h | `jibri-down` |
| Certificado do `meet` inválido | `docker compose logs caddy` no C; DNS só DNS (sem proxy) | `docker compose restart caddy`; porta 80 aberta |
| Servidor C sumiu | painel da Hetzner | plano B "Live gravada do dia" (acima) + sino com o texto pronto; reprovisionar (tempo a medir) |
| Segredo vazou | | trocar `JWT_APP_SECRET` / `WEBINAR_JWT_SECRET` nos dois `.env` (derruba quem está na sala; fazer fora de live) |

### 7.5 Custo mensal

| Item | Valor | Observação |
|---|---|---|
| Servidor C, cx23 | EUR 6,49 | preço do `docs/21` (a página da Hetzner mostrou 5,99 em 28/10, já com IPv4, e `docs/19` anotou 5,49; vale o do console) |
| IPv4 do C | EUR 0,50 | convenção de `docs/19`/`docs/21` (a página já inclui); vale a fatura |
| Jibri por live | ≈ EUR 0,28 a 0,34 (cerca de 2,5 h de cpx42 a EUR 0,112/h, gravação em 1080p) | 4 lives/mês ≈ EUR 1,10 a 1,40; cai para ≈ EUR 0,15 por live se o cpx32 der conta do 1080p (A26); IPv4 por hora desprezível, a conferir |
| Snapshot "jibri-base" (opcional) | centavos (EUR 0,0143/GB comprimido) | tamanho a medir |
| Tráfego do C | EUR 0 | conta derivada de 0,4 a 0,68 TB/mês, dentro dos 20 TB |
| cx33 (quando houver) | EUR 8,99 na página em 28/10; 9,99 em `docs/21`; vale o console | troca o cx23; com IPv4 pode passar de EUR 10/mês: precisa de ok do produtor na hora da troca (D12) |
| Bunny Stream, entrega | por 1.000 views de 60 min a 720p (~1,125 GB cada): ~US$ 51 na América do Sul (US$ 0,045/GB), ~US$ 11 EU/NA, ~US$ 6 no tier Volume | armazenamento por GB/mês: conferir no painel |
| Bunny, transcrição do Replay (Solta em por frase) | a conferir | ou legenda enviada pela Equipe, como nas aulas |
| Agente de IA | tokens, a medir | pelo gateway já existente |
| **Fixo** | **≈ EUR 7/mês** (C) | mais ≈ EUR 0,30 por live gravada pelo Jibri em 1080p e a Bunny pelas views |

Nada disso é criado antes da fase 3 e sem o ok do produtor no chat (D13).

### 7.6 Escolhas desta seção (para a tabela de Decisões)

| # | Escolha | Por quê |
|---|---|---|
| I1 | Caddy na frente do stack do Jitsi (perfil `borda`), não o Let's Encrypt embutido do `web` | mesmo padrão dos outros dois servidores (`infra/mautic/caddy`), um só jeito de operar TLS |
| I2 | Qualidade pelo tamanho na tela (D26): palco 720p ou 1080p (≈ 4 Mbit/s), tela compartilhada 1080p a 30 quadros, miniaturas até 360p (180p na fileira pequena), câmera de aluno até 360p, `channelLastN = 9`; gravação em 1080p | é o simulcast que o Jitsi já faz; o produtor pediu tela nítida a 30 quadros e gravação em 1080p; o custo é banda, dimensionada em §7.1 |
| I3 | O app dispara `jibri-up`/`jibri-down` pelo workflow com um token do GitHub só de Actions | o app nunca segura o `HCLOUD_TOKEN`; tudo fica no histórico do workflow |
| I4 | Segredos do Jibri num segredo do repositório gravados por SSH | o servidor por hora não tem `transfer.key`; ver ponto em aberto |
| I5 | Snapshot "jibri-base" depois da primeira live | tira o `docker pull` dos 30 minutos de preparo |
| I6 | `jibri-down` só apaga com `uploaded`; aviso no sino com 6 h; varredura diária disparada pelo app | nunca perder um MP4, nunca pagar servidor esquecido |
| I7 | TURN nas portas padrão (3478/5349) na fase 3; 443/TCP só se a piloto mostrar alunos em rede fechada | 443 exige segundo IP ou nginx por SNI; medir antes de pagar |
| I8 | Polling de 3-5 s como padrão do chat até a etapa `carga` medir o Realtime | D5 manda medir; polling não põe serviço novo no caminho do servidor A de 4 GB |
| I9 | Solta em por frase resolvido ao salvar, pela transcrição | zero reconhecimento de voz ao vivo; o Replay fica previsível |
| I10 | Permissions-Policy aberta só em `/webinarios/:path*` para `meet.<domínio>` | sem isso, microfone e câmera não abrem no iframe; o resto da área continua fechado |

---

## 8. Segurança, LGPD e CDC

### 8.1 Quem entra na sala e como

| Regra | Como fica | Onde |
|---|---|---|
| Ninguém entra sem JWT | O Jitsi próprio sobe com `ENABLE_AUTH=1`, `AUTH_TYPE=jwt` e `ENABLE_GUESTS=0`. Todo mundo, aluno ou equipe, entra com um token emitido pelo nosso servidor. Sem token, a sala recusa. | compose do servidor do Jitsi (`infra/jitsi/`, fase 3) |
| Token emitido só no servidor | `POST /api/webinars/[id]/join-token` confere a sessão (`requireApiUser`, `src/server/auth/guards.ts`), confere o acesso ao webinário (acesso por produto ou segmento, §8.2) e só então assina o JWT (HS256 com `WEBINAR_JWT_APP_ID=bunker707` / `WEBINAR_JWT_SECRET`; no Jitsi `JWT_APP_ID` / `JWT_APP_SECRET` com os mesmos valores). O segredo mora no `.env` do servidor do app e no do Jitsi; nunca em variável `NEXT_PUBLIC_*`. | `src/server/webinars/jitsi-token.ts` (novo) |
| Validade curta | `iss = aud = bunker707`, `sub = meet.<domínio>`, `nbf = agora − 60 s`, `exp = min(fim previsto + 30 min, agora + 6 h)`. Quem perde a conexão pede outro token pela mesma rota (a página faz isso sozinha). O token leva `room` com o nome da sala. | mesma rota |
| Sala com nome não adivinhável | `room` = `w-<id do webinário>-<16 caracteres aleatórios>` gerado na publicação e guardado em `webinar_sessions.room_name`. O nome nunca aparece na URL do aluno: a página é `/webinarios/[slug]` e o iframe recebe o nome só pelo token. | migração da fase 3 |
| Host moderador pelo token | O token do host e do co-apresentador leva `context.user.moderator = true` e `affiliation: owner`; o Prosody carrega `mod_token_affiliation` e o Jicofo sobe com `ENABLE_AUTO_OWNER=0` (sem isso o primeiro a entrar vira dono da sala). O token do aluno não leva `moderator`. | compose do Jitsi |
| Papel vem do admin (regra única, §5.4) | `host` = `webinars.host_user_id`, marcado no card Dados (precisa de `messaging.publish`, `src/server/auth/roles.ts`); `co-apresentador` = `webinar_presenters` com `role = co_host`, escolhido no editor entre contas da área (A7), com `valid_until`; `equipe` (modera e responde no chat) = `messaging.write`, com `moderator: true` só quando marcada como moderadora da sala no editor (`can_moderate_room`); `aluno` = o resto. Um papel nunca é escolhido pelo navegador. | `src/server/webinars/roles.ts` (novo) |
| Lobby e tranca | `ENABLE_LOBBY=1`; a Sessão de prática é o lobby ligado até **Começar para todos**; depois, o host tranca a sala pelo botão (comando `toggleLobby`). Quem chega com a sala trancada espera; o host libera um a um ou todos. | iframe (comandos do IFrame API) |
| Aluno sem poderes no iframe | `readOnlyName`, `startAudioMuted`, `startVideoMuted`, `disableRemoteMute`, `remoteVideoMenu.disabled`, `disableChat`, `disablePolls`, `disableReactions`, `disablePrivateChat`; barra do aluno só com Câmera (entra desligada, sai em 360p pelo `constraints`; some com `allow_student_camera = false`), Levantar a mão, Tela cheia e Sair. Moderação de áudio ligada pelo host (`toggleModeration`); o aluno só fala depois do `askToUnmute` e do clique dele; o host fecha qualquer câmera (`muteEveryone` de vídeo ou por participante). | `configOverwrite` e `interfaceConfigOverwrite` da página |
| Gravação só pelo host | O botão Gravar só aparece para `host`; o comando `startRecording` sai do navegador do host, mas o nosso servidor é quem cria o Jibri (fase 3) e grava `recording_anchor_at`. Um aluno que force o comando no console não tem `moderator` no token e o Jitsi recusa. | página do host |

### 8.2 Rotas do app

- Toda rota `/api/webinars/[id]/*` (§5.1) começa com `requireApiUser` (401 sem sessão). Em seguida `requireWebinarAccess(user, webinarId)` (novo, em `src/server/webinars/access.ts`): acesso por produto lê os entitlements (`target_type = 'webinar'` ou o produto ligado, como já existe nas migrações `202606150003` e `202606150004`), acesso por segmento reaproveita o recálculo da Comunicação (nas faixas :07/:22/:37/:52; um aluno novo no segmento leva até 15 min para entrar; com `access_mode = 'either'` basta um dos dois, §1.1); fora do acesso, 404 (não revela que o webinário existe), como o `show` do pop-up (`docs/29` §5).
- Ações da equipe são Server Actions (§5.2) com `requireApiRole("messaging.write")` ou `("messaging.publish")` (`src/server/auth/permissions.ts`); páginas do admin por `requirePageArea("comunicacao")`.
- Sinal de presença (`POST /api/webinars/[id]/heartbeat`) usa `requireApiSessionUser` (só assinatura do JWT da sessão, como `src/app/api/page-visits/route.ts`) + a conferência do acesso guardada em cache por aluno e sessão: grava e é idempotente por balde de 30 s.
- O webhook do gravador (`POST /api/webhooks/recorder`, §5.3) não tem sessão: exige assinatura HMAC-SHA256 do corpo com `WEBINAR_RECORDER_WEBHOOK_SECRET`, carimbo de tempo com janela de 5 min, é idempotente por `(session_id, state, file_name)` e guarda o corpo cru em `webinar_recording_events` para auditoria e reprocessamento (regra do AGENTS.md para webhooks). O arquivo nunca chega ao app: o Jibri envia o MP4 direto para a Bunny e o webhook só traz o `bunnyVideoId`.
- Validação com zod em toda entrada (mensagem, reação, voto, oferta, roteiro CSV), no salvar e no ler, como o `popup_design` (`docs/26`).
- Nada de chave no navegador: `WEBINAR_JWT_SECRET`, `WEBINAR_RECORDER_WEBHOOK_SECRET`, token da Bunny e token da Hetzner ficam no servidor (e os da infra só nos segredos do workflow "Infra (Hetzner)", `.github/workflows/infra.yml`).

### 8.3 Chat: rajada, moderação e palavras bloqueadas

| Controle | Regra | Reaproveita |
|---|---|---|
| Rajada (o conjunto único de §5.1 e D16) | chat: 5 mensagens por 60 s por aluno (`lessonCommentBurstLimit`/`lessonCommentBurstWindowMs` de `src/server/comments/comment-validation.ts`); reações: 1 por segundo e até 20 por minuto; perguntas: 2 por minuto; voto em enquete: 1 por pergunta; por cima de tudo, o teto global `STUDENT_WRITE_LIMIT` de 30 escritas por minuto | contagem no servidor, como `comment-store.ts` e `student-write-limit.ts` |
| Tamanho e conteúdo | mesmo limite de caracteres e mesma limpeza dos comentários da aula; link só de domínio nosso ou da oferta cadastrada; mensagem com palavra bloqueada é recusada antes de gravar | `lesson_comment_blocked_words` (`src/server/community/rules.ts`) |
| Modo lento (Slow mode) | a equipe liga "1 mensagem a cada N s" por sessão (N em 10, 20, 30, 60); vale para alunos, não para a equipe | coluna `chat_slow_mode_seconds` em `webinar_sessions` |
| Apagar | a equipe apaga uma mensagem (`deleted_at` + quem apagou); some para todos na hora; no replay e na live gravada ela nunca reaparece | padrão de `moderate_lesson_comment` |
| Silenciar no chat | tira o direito de escrever daquele aluno naquela sessão por 5 / 15 / 60 min ou até o fim (`webinar_session_bans`, `kind = muted`, `until_at`); ele continua assistindo | novo |
| Remover / banir | tira o aluno da sala (`kickParticipant` no iframe) e bloqueia novo token até o fim da sessão (`webinar_session_bans`, `kind = kicked`); banir estende para qualquer Webinário até a equipe desfazer; fica no relatório | novo |
| Denúncia | o aluno denuncia uma mensagem; cai na fila da equipe no painel da sessão | padrão de denúncia dos comentários |

#### 8.3.1 O que a revisão de segurança da fase 2 fechou (29/10/2026)

A revisão adversarial da sala da Live gravada (rotas do aluno e Server Actions da equipe) achou oito pontos; todos estão corrigidos no código e cobertos por teste (`tests/webinarios-sala-rotas.test.mjs`, `tests/webinarios-roteiro-acoes.test.mjs`):

| Ponto | Como ficou | Onde |
|---|---|---|
| Pergunta pelo chat moderado aparecia na aba Perguntas antes de a equipe liberar | a pergunta (`webinar_questions`) só nasce quando a equipe libera a mensagem (`moderateMessage` → `approve`), anônima quando o nome gravado é o `Aluno {n}` do próprio aluno; apagar a mensagem apaga (soft, motivo `team`) a pergunta ligada | `room-writes.ts`, `room-actions.ts`, `chat-store.ts` |
| Pergunta publicava o nome sem o aceite e ignorava em silêncio a Anônima desligada | a pergunta segue a regra do chat (D10): sem o aceite gravado, o corpo traz o aceite (a aba abre o mesmo quadro do chat) ou responde 409 `consent_required`; Anônima com a opção desligada no card Sala responde 400; a sessão manda `anonymousQuestions` e a aba só mostra a caixa quando está ligada | `room-writes.ts`, `chat-schemas.ts`, `room-questions.tsx` |
| Replay cancelado continuava abrindo | a sessão `replay` com `status = cancelled` responde 404 na sessão e em todas as rotas da sala | `room-queries.ts`, `student-queries.ts` |
| O vídeo da Bunny (com o token) saía fora da entrada | `GET .../session` só manda `video` quando a entrada está aberta (`join.ok`); a live (fase 3) não usa a Bunny; na gravada o token vale até o fim do vídeo + 15 min (no máximo 6 h) | `room-queries.ts` (`roomJoinFor`, `roomVideoFor`) |
| A janela do chat da gravada deixava ler o chat original de depois de agora | na gravada e na live a janela para no segundo do servidor + 120 s (+10 s de folga do aparelho) e a resposta traz a janela de verdade (a seguinte começa dali); no replay, até onde o aluno pedir | `room-queries.ts` (`chatWindowLimitMs`) |
| Modo lento e reações passavam em pedidos simultâneos | o modo lento reserva a vez antes de qualquer `await` e devolve a vez se a mensagem não for gravada (palavra bloqueada, falha); as reações conferem 1/s e 20/min na memória antes da contagem no banco (o banco segue como o limite entre instâncias); a poda das janelas olha a última escrita de cada chave, num mapa por limite | `room-limits.ts` |
| Curtir pergunta não conferia a hora nem a dispensada | curtir fora da hora da sessão responde 409; a dispensada de outro aluno, 404 (como na lista) | `room-writes.ts` |
| Limite de vagas não valia na sala (A12) | com o limite ligado, só quem garantiu a vaga entra: as rotas da sala respondem 403, a sessão diz `join: { ok: false, reason: "no_seat" }` sem o vídeo, a página da sala mostra a frase e a página da live troca o **Entrar** por **Garantir vaga** (e mostra **Entrar** logo depois); o replay não pede vaga; o "ver como" da equipe abre sem vaga | `room-queries.ts`, `student-queries.ts`, `webinar-page-view.tsx`, `webinar-session-actions.tsx` |

### 8.4 CSP e iframe

- O `external_api.js` é carregado do nosso domínio do Jitsi (`meet.<domínio>`) com o `nonce` da página: a CSP de `src/proxy.ts` usa `'strict-dynamic'`, e um `<script>` com nonce pode ter qualquer origem, então **nenhuma origem nova entra em `script-src`** (mesma regra do `docs/29` §5 para os players; §6.3 diz o mesmo). A guarda confere isso.
- `frame-src 'self' https:` já cobre o iframe do Jitsi e o da Bunny. O iframe leva `allow="camera; microphone; display-capture; autoplay; fullscreen"` (hoje nenhum player de aula usa `allow`; o `Permissions-Policy` de `next.config.ts` libera os mesmos itens só em `/webinarios/:path*` para a origem do Jitsi, I10).
- O iframe fala com a página só pelo `postMessage` do IFrame API; a página só aceita mensagens com `event.source === iframe.contentWindow` e origem exata, como a ponte dos players (`src/lib/lesson-embed-bridge.ts`).
- O servidor do Jitsi só expõe TCP 80/443 e UDP 10000 (mais 3478/5349 do TURN); SSH só durante a etapa do workflow, como o servidor do app (`docs/20` §4A.4).

### 8.5 LGPD

**Consentimento na primeira mensagem do chat** (clique em **Entendi e quero participar**, registrado em `student_events` como `webinar_chat_consented` com `consent_version`; o mesmo texto e o mesmo botão em §1.3 e §2.7; passa por revisão jurídica, A4):

> Ao enviar mensagens neste chat, você autoriza que o seu primeiro nome e o texto da mensagem apareçam para os outros alunos durante esta sessão e nas reexibições dela. Você pode remover as suas mensagens a qualquer momento em Perfil › Privacidade.

**Aviso de gravação ao liberar o microfone** (aparece quando o host libera e antes de o aluno aceitar, com os botões **Falar** / **Agora não**):

> Esta sessão está sendo gravada. Ao ativar o microfone, a sua voz entra na gravação, que pode ser reexibida para outros alunos. Você pode recusar e continuar participando pelo chat.

**Aviso de gravação ao ligar a câmera** (no primeiro clique em **Câmera**, com os botões **Ligar câmera** / **Agora não**; o aceite vai em `webinar_camera_toggled` com `consented: true`, D4):

> Esta sessão está sendo gravada. Ao ligar a câmera, a sua imagem entra na gravação, que pode ser reexibida para outros alunos, e o consumo de dados aumenta. Você pode continuar só assistindo e participando pelo chat.

Regras:

- **Nome exibido**: primeiro nome + inicial do sobrenome por padrão; o aluno pode escolher um apelido ou **Participar como anônimo** (aparece como **Aluno {n}**, número por sessão). A escolha fica em `profiles` e vale para as próximas sessões.
- **"Remover minhas mensagens"** em Perfil › Privacidade (seção nova em `/perfil`; o rodapé já tem o link Privacidade, `src/components/member-footer.tsx`) e no ⋯ do chat: apaga as mensagens, perguntas e respostas de enquete do aluno da linha mestre e de todas as sessões (`deleted_reason = 'consent_revoked'`), e registra `webinar_chat_consented` com `{ revoked: true, consent_version }` (um `event_type` só). Mensagens de quem revogou nunca entram numa live gravada nova.
- **Live real feita antes desta regra** (gravações importadas de outra ferramenta): a linha mestre entra anonimizada ("Aluno 1", "Aluno 2") até haver consentimento daquele aluno.
- **Prazo de guarda**: gravação na Bunny e chat no banco por **24 meses** depois da última sessão que os usou (sugestão; a decidir pelo produtor, §12.3; `chat_retention_days` / `recording_retention_days`). O job de retenção (`202610170004_personal_data_retention.sql` guarda 12 meses de webhooks e 90/180 dias de e-mail; `student_events` ainda não tem prazo, `docs/29` §9.1) ganha a limpeza do chat e um aviso no painel 30 dias antes de uma gravação vencer.
- **Mínimo de dado**: o relatório mostra nome e e-mail só para quem tem `messaging.write`; a exportação CSV leva os mesmos campos dos relatórios do Zoom e nada além; a Sala Live vertical e o replay não mostram o e-mail de ninguém.
- **Oferta e compra**: a conversão vem dos webhooks de venda já existentes (Hotmart/Ticto); o app não guarda dado de pagamento.

### 8.6 CDC (art. 37)

| Dentro da área de membros | Fora da área (nunca) |
|---|---|
| Live gravada em horário marcado, com o selo "Ao vivo" **se o produtor ligar por sessão** (`show_live_badge`) | Anunciar como "ao vivo" uma sessão gravada: anúncio, e-mail de venda, página de captura, post, WhatsApp |
| Contador de plateia e entradas/saídas simulados **se o produtor ligar por sessão** (`simulated_count_rule`, `simulated_joins`), sempre marcados por dentro (colunas `simulated_*` da Sessão) e fora das métricas reais | Mostrar número simulado como se fosse real em qualquer relatório, print ou divulgação |
| Chat original reaparecendo no mesmo segundo e comentários prontos marcados como `source = scripted` | Prazo de oferta "só hoje" que se repete em toda sessão sem ser verdade (a oferta e o prazo são cadastrados por sessão, e o relatório guarda o que foi mostrado) |
| Convite e lembrete pelo sino, pop-up e e-mail dizem "Sessão às 20h" sem a palavra "ao vivo" quando a sessão é gravada | |

Frase que fica registrada em cada sessão gravada que ligar o selo ou os números simulados (gravada em `webinar_sessions.simulation_ack_text`, com `simulation_decided_at` e `simulation_decided_by`):

> Decisão do produtor em DD/MM/AAAA: nesta sessão gravada, dentro da área de membros, o selo "Ao vivo" [fica ligado/desligado] e os números de plateia [são simulados/são reais]. Fora da área de membros, esta sessão nunca é anunciada como ao vivo. Responsável: <nome>.

O editor não deixa publicar a sessão com o selo ou os números simulados ligados sem essa confirmação (uma caixa de marcar com o texto acima).

---

## 9. Acessibilidade e celular

| Ponto | Regra |
|---|---|
| Chat pelo teclado | Tab entra na lista e no campo; setas percorrem as mensagens; Enter envia; Esc volta para o vídeo. Botões de reação, Levantar a mão e Enquete têm nome acessível e atalho (R, M, E) anunciado no "Como usar". |
| Leitor de tela | Lista de mensagens em `role="log"` com `aria-live="polite"`; em rajada (mais de 1 mensagem por segundo) o anúncio junta "N mensagens novas" em vez de ler cada uma; mensagens da equipe e do host têm prefixo "Equipe:" / "Apresentador:"; as do agente, "Assistente:". Enquete é um `fieldset` com `legend`; o resultado é anunciado uma vez. |
| Contraste | Tema escuro do `docs/12`; texto do chat e selos com contraste mínimo 4,5:1; o card de oferta não depende só de cor para mostrar o prazo (texto + ícone). O chat sobreposto da Sala Live vertical tem fundo em degradê para manter o contraste sobre o vídeo. |
| Movimento | Reações animadas, contador e o degradê do selo respeitam `prefers-reduced-motion` (já usado em `src/components/member/notifications/member-popup.tsx`): com a preferência ligada, a reação aparece parada 1,5 s e some, sem subir pela tela. |
| iOS Safari: som | Na live gravada e no replay, o player da Bunny abre com `autoplay=true&muted=true` e um botão "Ativar som" por cima; sem o toque, o vídeo toca mudo (regra do Safari). Na live ao vivo, o iframe do Jitsi começa com áudio só depois do primeiro toque na página ("Entrar na sala"). |
| iOS Safari: aba em segundo plano | O Safari congela a aba: o sinal de 15 s para e o vídeo pausa. Tratamento: (a) `visibilitychange`/`pagehide` enviam um último `sendBeacon` com `state: hidden`; (b) o servidor não marca saída por falta de um sinal; ele fecha o trecho de presença quando passam **90 s (3 baldes)** sem sinal e abre outro quando o sinal volta, então o relatório mostra "entrou/saiu" por trecho, não por batida perdida; (c) ao voltar, a live gravada realinha pelo relógio do servidor (`offset = agora − scheduled_at`), sem continuar de onde parou; (d) na live ao vivo, o Jitsi reconecta sozinho e a página pede outro token se o antigo venceu. |
| iOS Safari: tela cheia | A tela cheia nativa do iframe esconde o nosso chat; a página oferece "Modo cinema" (vídeo grande + chat embaixo) em vez de tela cheia no iPhone, como o cuidado R12 do `docs/29`. |
| 375 px | Vídeo em cima (16:9, largura total), abas Chat / Perguntas / Participantes embaixo, campo de mensagem fixo no rodapé acima do teclado; sem rolagem lateral; os controles do host cabem numa segunda linha rolável. A Sala Live vertical 9:16 é outro desenho da mesma página, ligado no celular em pé (fase 4); não é um ajuste da sala de 375 px desta versão. |
| Câmera do aluno no celular | Entra desligada; o primeiro clique mostra o aviso de gravação e o consumo (≈ 0,3 GB por hora enviados; receber o palco em 1080p ≈ 1,8 GB por hora, em 720p ≈ 0,9 GB); em 4G a qualidade recebida cai sozinha e a câmera enviada fica em 360p (D26). |
| Legendas | Fora da v1 (o Jitsi pede Jigasi + provedor de transcrição). A transcrição da gravação (Bunny) alimenta legendas no replay quando existir, pela infraestrutura de `lesson_transcripts`. |

---

## 10. Testes

Padrão do `docs/18`: unitário em `tests/*.test.mjs`, integração em `tests/integration/*.test.mjs` contra o Supabase local, ponta a ponta em `tests/e2e/*.spec.ts` (Chromium e WebKit). Toda PR traz o teste do que mudou; correção traz o teste que falhava antes.

### 10.1 Dublês novos (em `tests/support/` e `tests/e2e/fixtures.ts`)

- **Relógio falso**: as funções de offset e sincronização recebem `now()` por parâmetro (como `createArmedClock`, `docs/29`); nos testes, `mock.timers` do `node:test`.
- **`JitsiMeetExternalAPI` falso** (`tests/e2e/fixtures.ts`, `salaFalsaDoJitsi(page)`): `page.route` responde ao endereço real do `external_api.js` (em `meet.<domínio>`) com um script que define `window.JitsiMeetExternalAPI` (construtor que guarda `roomName`, `jwt`, `configOverwrite`; `addListener`, `executeCommand`, `getParticipantsInfo`, `dispose`) e um `window.__salaFalsa` que o teste usa para disparar `videoConferenceJoined`, `participantJoined/Left`, `raiseHandUpdated`, `audioMuteStatusChanged`, `recordingStatusChanged` e `errorOccurred`, e para ler os comandos recebidos (`muteEveryone`, `askToUnmute`, `kickParticipant`, `toggleLobby`, `startRecording`). O mesmo padrão de `paginaFalsaDoVimeo`.
- **Player falso da Bunny** (`paginaFalsaPlayerJs`, já existe): ganha `setCurrentTime`/`getCurrentTime` e `seeked` para a live gravada.
- **Workflow e gravador falsos**: o app não fala com a Hetzner (I3); o disparo do workflow (API do GitHub) fica atrás de um adaptador com implementação falsa que registra "jibri-up/jibri-down pedidos"; o webhook do gravador falso assina com o segredo de teste (`WEBINAR_RECORDER_WEBHOOK_SECRET` de teste) e manda `ready`, `uploaded`, `upload_failed`, `unavailable`, `gone`.
- **Realtime**: o CI sobe o Supabase local sem o Realtime (`db.mjs start --ci`); por isso o chat fala com um adaptador `ChatFeed` com duas implementações (Realtime e polling). Integração e ponta a ponta usam a de polling; a de Realtime é medida na live piloto (§10.3) e, se ficar, ganha um teste de integração com o serviço ligado só localmente.
- **Frases de tela**: `tests/webinarios-frases.test.mjs` (fase 1) confere os rótulos do Webinário contra uma lista própria `PROIBIDAS_WEBINARIO` = `campanha`, `público`, `audiência`, `evento`, `webinar` (sem acento), `simulive`, `host`, `lobby`, `broadcast`, `stream`, `gatilho`, `trigger`, `impressão`, `home`, `template`, `layout`, `Jitsi`; **sem** `sessão`, `lembrete` e `oferta`, que o Webinário usa na tela. As guardas da Comunicação não mudam: `FORBIDDEN_COPY` em `tests/comunicacao-admin-modelo.test.mjs` é `/campanha|público|audiência|evento|oferta/i` e a constante `PROIBIDAS` (linha 334) de `tests/pop-ups-v3b1-frases.test.mjs` inclui `sessão`, `lembrete`, `gatilho`, `impressão`, `home`, `template` e `layout`; por isso os textos do Webinário ficam em arquivo próprio (`src/lib/webinar-copy.ts`, proposto) e nunca entram nas telas que essas duas guardas leem. Precisa de ok de quem cuida dos testes da Comunicação (§12.3).

### 10.2 Tabela por entrega

| Entrega | Unitário | Integração | Ponta a ponta |
|---|---|---|---|
| **Fase 1** modelo, CRUD, `/webinarios`, Garantir vaga, lembretes | schemas zod do webinário, da sessão e de `webinar_presenters` (datas, fuso, acesso); mapeadores de linha; textos do convite e dos lembretes (§2.7, inclusive a regra do 1 h quando o 24 h atrasou); cálculo dos lembretes 24 h e 1 h com relógio falso; frases de tela contra `PROIBIDAS_WEBINARIO` | CRUD do admin com `messaging.write` (analista 403); aluno fora do acesso recebe 404 em `/api/webinars/[id]/session`; Garantir vaga grava uma vez (segundo clique não duplica); o job do tick enfileira o sino e o `email_outbox` só para quem tem vaga e só uma vez por lembrete; política de `student_events` recusa `entity_type = 'webinar'` vindo do aluno; RLS: aluno não lê vaga de outro | `produtor-cria-webinario.spec.ts` (criar, publicar, ver na lista); `aluno-garante-vaga.spec.ts` (card na página inicial, página `/webinarios`, Garantir vaga, confirmação, 375 px) |
| **Fase 2** live gravada | `offsetAlvo(now, scheduledAt, skew)`; `mensagensVisiveis(linha, offset)` libera exatamente as de `offset_ms <= atual`; `corrigirDessincronia` chama `setCurrentTime` só acima de 2 s; Solta em: por offset, por frase (casamento com a transcrição, com e sem acento) e manual, com relógio falso; leitor/gerador do CSV (4 colunas, limite de linhas, UTF-8, linha inválida apontada); **guarda de simulação**: nenhuma consulta de métrica real lê `source in ('scripted')` nem `simulated_*` (o teste varre as funções SQL e `report-model.ts`) | mensagem gravada com `offset_ms` do servidor, nunca do navegador; rajada 5/60 s, 20 reações/min e palavra bloqueada recusadas; apagar some do replay; modo lento 10/20/30/60; presença por balde de 30 s (upsert, dois sinais no mesmo balde = 1 linha; 90 s sem sinal abre outro trecho); `webinar_report(id)` com dados de teste: presentes por minuto, retenção, mensagens por minuto, conferidos contra números calculados à mão no próprio teste; `webinar_attendance` resumida no fim; `authenticated` recebe 42501 na RPC; cache de 60 s com o dublê do Data Cache; `saveSimulation` grava `simulation_ack_text` e recusa publicar o selo sem a caixa marcada; "Remover minhas mensagens" apaga chat, perguntas e respostas de enquete | `aluno-assiste-live-gravada.spec.ts`: entra 90 s depois do início e o player falso recebe `setCurrentTime(90)`; mensagens da linha mestre aparecem no segundo certo; a mensagem nova aparece para uma segunda aba (polling); "Ativar som"; 375 px. `produtor-monta-roteiro-de-chat.spec.ts`: importa CSV, dispara um comentário manual, vê no relatório. `aluno-remove-suas-mensagens.spec.ts` |
| **Fase 3** sala ao vivo | emissão do JWT (claims `iss`/`aud`/`sub`/`nbf`/`exp`, `moderator` pela matriz de §5.4, sala não adivinhável `w-<id>-<16>`); `configOverwrite` por papel: aluno sem chat/enquete/reação do Jitsi, com `camera` na barra (some com `allow_student_camera = false`) e `constraints` de 360p; host com 720p ou 1080p conforme `quality.stage` e tela a 30 ou 15 quadros conforme `quality.screen_fps`; máquina de estados `recorder_status` (`none → preparing → ready → recording → uploading → uploaded → gone`, com `upload_failed` e `unavailable` em cada passo) | `join-token` 401 sem sessão, 404 fora do acesso, 200 com token válido; aluno banido não recebe token; Equipe sem `can_moderate_room` recebe `moderator: false`; webhook do gravador: assinatura errada 401, repetido idempotente por `(session_id, state, file_name)`, corpo cru guardado, replay criado com o `bunnyVideoId`; âncora `recording_anchor_at` gravada uma vez pela ação `markRecordingAnchor` | `aluno-assiste-live-ao-vivo.spec.ts` com o `JitsiMeetExternalAPI` falso: entra, vê o palco, liga a câmera (vê o aviso de gravação e o consumo; `toggleVideo` chega à sala falsa e `webinar_camera_toggled` é gravado), levanta a mão (`raiseHandUpdated`), recebe `askToUnmute` e o aviso de gravação com Falar / Agora não, manda mensagem no nosso chat, reage; nenhum texto da página contém "Jitsi". `produtor-controla-a-live.spec.ts`: Silenciar todos envia `muteEveryone`, Trancar envia `toggleLobby`, Remover envia `kickParticipant` e grava `webinar_session_bans`, Gravar grava a âncora e mostra "Gravando"; Gravar antes de `ready` mostra "Preparando a gravação" e dispara sozinho no `ready` |
| **Fase 4** painéis, exportação, resto do Hot Webinar | fórmulas dos painéis (média, mediana, retenção por balde, taxa de conversão por sala A/B/C/D); nomes e colunas dos CSV do Zoom (Registration, Attendee, Performance, Q&A, Poll, Survey) e o cabeçalho do Performance sem simulação; distribuição de atendentes; o Assistente cala quando um atendente assumiu; textos da tradução só nas chaves | painéis "Lives ao vivo" e "Lives gravadas" com o Período e o filtro Produto; conversão lida do webhook de venda de teste (`tests/integration/vendas-hotmart.test.mjs` e `tests/integration/vendas-ticto.test.mjs`); agente de IA com o provedor falso de `tests/support/integration-ai-provider.mjs` (resposta com `role = ai`, nunca `team`); `simulation_summary` congelado no fim e fora de `webinar_panel` | `produtor-ve-paineis-das-lives.spec.ts` (dois painéis, Período, CSV baixado com as colunas certas, 375 px) |
| **Guardas** (`*.guard.test.mjs`) | migrações byte a byte; RPC dos relatórios revogada de `authenticated`; CSP sem origem nova em `script-src`; `external_api.js` só com nonce e só de `meet.<domínio>`; Permissions-Policy aberta só em `/webinarios/:path*` (`tests/deployment-security.test.mjs`); nenhum SDK do Jitsi no `package.json`; segredo do JWT e do webhook nunca em `NEXT_PUBLIC_*`; citações `docs/30 §N` apontando para títulos que existem | | |

### 10.3 Roteiro de conferência manual da live piloto (fase 3, 5 a 10 alunos reais)

1. Servidor do Jitsi no ar: abrir a sala pelo app no computador e no iPhone; sem marca d'água, sem o nome Jitsi, nome "Bunker707" no título; abrir o endereço do Jitsi direto, sem token: recusado.
2. Host entra: é moderador (consegue silenciar todos); o primeiro aluno a entrar **não** é moderador (sem botões de moderação, `participantRoleChanged` nunca chega como `moderator`).
3. Aluno: assiste, comenta no nosso chat, reage, abre a câmera (vê o aviso, aparece na fileira em 360p; o host fecha a câmera dele e depois libera de novo), levanta a mão; o host libera o microfone; o aluno vê o aviso e precisa aceitar; fala; o host silencia de novo. Conferir no computador do host que a tela compartilhada chega em 1080p a 30 quadros e que a câmera dele chega em 1080p quando está no palco e em 540p ou 270p quando vira miniatura (D26).
4. Tranca a sala: quem chega espera no lobby; o host libera um.
5. Remove um aluno: ele sai e não consegue voltar (token recusado); aparece no relatório.
6. Gravar: o workflow cria o Jibri (anotar o tempo até "Gravando"); ao encerrar, o MP4 chega na Bunny, o webhook cria o replay e o servidor do Jibri é apagado (conferir no painel da Hetzner que não ficou nada cobrando).
7. Replay: o chat da live reaparece no segundo certo; se estiver fora de fase, o "Alinhar chat" (± segundos, `anchor_offset_ms`) corrige e o resultado fica salvo.
8. Medir e anotar nesta seção: latência ida e volta de São Paulo (a medir), CPU e banda do cx23 com N alunos e com N câmeras abertas (a medir), se o cpx32 grava 1080p a 30 quadros sem perder quadros (A26), p95 das rotas do chat e da presença (a medir), quedas em 4G (a medir), tempo do `jibri-up` (a medir), memória de cada container do C (a medir). Esses números decidem o cx33 e a fase 2 de escala (D1) e confirmam os 90 s de tolerância da presença (D19).
9. iPhone: aba em segundo plano por 2 min e volta: a presença mostra dois trechos, o vídeo volta; som só depois do toque.
10. Depois da live: os números simulados não existem no relatório da live ao vivo (bloco "Simulação" só aparece em sessão gravada que os ligou).

---

## 11. Fases e PRs

Cada PR vai para a `dev`, com testes conforme §10 e a migração aplicada no Supabase da nuvem **antes do merge** (`docs/21` §9); na produção o `deploy-membros` aplica (`docs/20` §9). Nome das migrações: `AAAAMMDD0001_webinars_<fase>.sql`, com a data do dia da PR; todas aditivas e idempotentes, sem `drop`/`delete`, como as da Comunicação.

| Fase | PRs | O que entra | Migração | Servidor novo? |
|---|---|---|---|---|
| **1. Base** | 1a modelo + CRUD; 1b página do aluno + Garantir vaga; 1c lembretes | tabelas `webinars`, `webinar_sessions`, `webinar_presenters`, `webinar_registrations`, `webinar_recordings`; `/admin/comunicacao/webinarios` (lista, novo, `[id]`, abas com "Sem lives ao vivo ainda") no lugar da moldura; `/webinarios` e `/webinarios/[slug]` com contagem regressiva; card "Próxima live" na página inicial; Garantir vaga; lembretes 24 h e 1 h pelo sino + `email_outbox` no job do tick; convite por aviso/pop-up/fluxo; frases em `webinar-copy.ts` com a guarda própria | `webinars_v1` (tabelas, RLS, índices por `scheduled_at`, `alter policy` em `student_events` com `'webinar'`, índice parcial) | não |
| **2. Live gravada** | 2a VOD + chat por offset; 2b roteiro (CSV, Solta em por offset/frase/manual); 2c presença + enquetes + perguntas + relatório da sessão | player da Bunny travado no relógio do servidor; sessões **Em horários marcados** (várias por dia) e **Replay livre**; `webinar_chat_messages` com `offset_ms` e `source`; linha mestre e aprovação; consentimento LGPD e nome exibido; moderação do §8.3; `webinar_presence_samples` + `webinar_attendance`; enquetes e Perguntas em aba própria; RPC `webinar_report` com cache de 60 s; `show_live_badge` + `simulation_decided_by/at` + `simulation_ack_text` do §8.6; Perfil › Privacidade com "Remover minhas mensagens" | `webinars_v2` (chat, presença, roteiro, enquetes, perguntas, RPC do relatório, `prune_webinar_history`) | não |
| **3. Sala ao vivo** | 3a Jitsi próprio (`infra/jitsi/`), JWT e página do aluno; 3b controles do host; 3c Jibri por hora + webhook + replay | servidor C (etapas novas `provision-meet`, `deploy-meet`, `secrets-meet`, `exec-meet`), custom-config sem marca, token, papéis, chat nosso com o Jitsi sem chat; controles do host; Jibri criado e apagado pelo workflow (`jibri-up`, `jibri-down`, `exec-jibri`); âncora da gravação e "Alinhar chat" | `webinars_v3` (`room_name`, `recorder_status`, `webinar_session_bans`, `webinar_recording_events`) | **sim: só com ok do produtor no chat** (cx23 do Jitsi; cpx42 do Jibri por hora, gravação em 1080p) |
| **4. Painéis e Hot Webinar** | 4a painéis "Lives ao vivo" e "Lives gravadas" + CSV do Zoom; 4b ofertas A/B/C/D + conversão + follow-up + Simulação completa (contador, entradas/saídas, avisos de venda); 4c agente de IA + atendentes + modo híbrido; 4d Sala Live vertical; 4e **Começa quando você entra** (just-in-time); 4f tradução PT/EN/ES | tudo o que está no D6 que não entrou antes; segmentação de follow-up como regras da Comunicação | `webinars_v4a` … `v4f`, uma por PR (`v4b` traz `simulated_count_rule`, `simulated_joins`, `simulated_sale_notices`, `simulation_summary`, `webinar_offers*`, `webhook_events.amount_cents` + `currency`; `v4a` traz `webinar_panel`) | não (fase 2 de escala do D1 só quando passar de ~100-150 simultâneos) |

**Estado (29/10/2026)**: a fase 1 está entregue na branch `claude/nifty-mendel-tx2kro` (1a, 1b e 1c, sem PR aberta ainda), com a migração `202610280001` aplicada na nuvem de teste e conferida lá (`docs/21` §9.6) e a guarda `webinarios-migracao.guard` fixando o texto. O que a fase 1 deixa combinado para a 2: `late_join_minutes` por sessão no rascunho (hoje "em breve" no editor), a sessão `replay`, o `webinar_report` completo, o "Começou agora" (`queueWebinarStartedNotices`, pronto em `notify.ts`, chamado quando a sessão abre) e a faixa "Ao vivo agora" em todas as páginas (fase 3). Integração e ponta a ponta da fase 1 existem e rodam no CI (o contêiner da IA não tem Docker nem navegadores).

Docs a atualizar em cada fase (na mesma PR):

| Doc | O que muda |
|---|---|
| `docs/04` seções "Video" e "Eventos do aluno" | Jitsi próprio como motor ao vivo; Bunny para gravado; registros `webinar_*` em `student_events` |
| `docs/05` | acrescentar as tabelas `webinar_*` |
| `docs/17` §2.4 (tabela `events`/`event_registrations`, linha ~821) e §1.8.3, D5 | trocar `events`/`event_registrations` pelas `webinar_*`; provedor passa de YouTube Live/Zoom para Jitsi próprio; números novos |
| `docs/09` ("salas ao vivo ... pede um estudo próprio", linha 206) | vira "decidido: `docs/30`" |
| `docs/22` §6 "Fica para depois" (Salas ao vivo e webinários) | sai da lista; aponta para `docs/30` |
| `docs/25` §1 "onde nunca" | ganha `/webinarios/[slug]` e a pílula do Minimizar |
| `docs/20` runbook | seções novas: servidor do Jitsi, Jibri por hora, atualização do Jitsi (release a cada 4-8 semanas), monitor do Jitsi no Better Stack e quem recebe o alerta, plano B "Live gravada do dia", firewall, incidentes |
| `docs/18` §3 | mapa de cobertura com as linhas de webinário |
| `README.md` e `AGENTS.md` | `docs/30` na lista de docs |

---

## 12. Decisões

### 12.1 Tabela

| # | Decisão | Por quê | O que muda se mudar |
|---|---|---|---|
| D1 | Jitsi Meet próprio (docker-jitsi-meet, Apache-2.0) num cx23 da Hetzner (`bunker707-meet`, `meet.<domínio>`); cx33 depois, só com ok do produtor; fase 2 de escala por HLS (Jibri RTMP → Mux/Cloudflare Stream) ou modo visitors acima de ~100-150 simultâneos | a marca só sai em instância própria; custo dentro do teto; arquitetura pronta para crescer | trocar de motor refaz a fase 3 inteira (token, iframe, Jibri); as fases 1, 2 e 4 não mudam |
| D26 | Qualidade pelo tamanho na tela: palco 720p (padrão) ou 1080p por webinário; tela compartilhada 1080p a 30 quadros (ou 15); miniaturas até 360p (180p na fileira pequena); câmera de aluno até 360p; gravação em 1080p no Jibri (cpx42 por hora); em 4G a qualidade recebida cai sozinha | pedido do produtor (28/10): tela nítida com mouse e escrita fluidos, gravação em 1080p; é o simulcast do Jitsi, sem nada inventado | 1080p no palco custa ~60 % mais banda que 720p (§7.1); gravação em 720p voltaria ao cpx32 e à metade do custo por live |
| D27 | O sino recebe os lembretes e avisos de live como `notifications.kind = 'webinar'` (título, texto e link na própria linha, sem campanha; `dedupe_key` por sessão e tipo; `communication_visible_notifications` mostra o kind enquanto não vence) | o kind `notice` exige campanha e o pipeline das campanhas (segmento, aprovação, envio pelo tick) não serve para um lembrete por vaga | criar uma campanha por lembrete traria segmento, aprovação acima de 500 e relatório de pop-up para cada lembrete |
| D29 | O aceite do chat (D10) fica em `webinar_chat_consents` (uma linha por aluno: versão do texto, como o nome aparece, apelido, hora do aceite e da retirada), não em `profiles`: a tabela é só do service_role, a retirada é uma coluna e o histórico guarda o `consent_version` | guardar em `profiles` (coluna lida por toda a área) ou só em `student_events` (não dá para consultar rápido) |
| D30 | A transcrição da gravação de um webinário fica em `webinar_recording_transcripts` (uma por gravação, as mesmas cues de `lesson_transcripts`, parseadas por `normalizeManualTranscript`), porque a gravação não é uma aula; quando o replay virar aula (fase 3) a transcrição pode ser copiada para `lesson_transcripts` | exigir a aula antes de resolver as frases |
| D31 | A linha mestre é a coluna `master` de `webinar_chat_messages`: tudo o que foi escrito numa sessão `live` nasce `master`; nas gravadas, só o que a equipe promove; `webinar_chat_window` junta as linhas da sessão com a linha mestre da sessão de origem (deslocada pela `anchor_offset_ms` da gravação na leitura, nunca reescrita) e as promovidas do mesmo webinário | copiar a linha mestre para cada sessão (dobra as linhas e perde o "Alinhar chat") |
| D32 | A sessão `replay` nasce quando a primeira sessão encerra com a gravação pronta (`finishSession`), com `status = 'live'` (= disponível) e `source_session_id` apontando para a sessão encerrada; a equipe cancela para esconder; o aluno entra na sala 15 minutos antes da hora marcada (`ROOM_OPENS_MINUTES_BEFORE`) e, ao entrar, recebe os últimos 5 minutos do chat e a janela de 2 minutos à frente | criar o replay à mão sempre |
| D28 | Os padrões da sala (card Sala) e a Qualidade (card Qualidade) ficam em `webinars.room_settings` e `webinars.quality` (jsonb com zod no salvar e no ler); a sessão copia `chat_mode` e `chat_slow_mode_seconds` ao abrir e os demais valem para a sala inteira | menos colunas na fase 1; a sessão só precisa do que muda ao vivo | passar tudo para colunas da sessão é uma migração aditiva depois |
| D2 | Sem marca d'água nem nome Jitsi: `custom-interface_config.js` e `custom-config.js`; nenhum texto da nossa página cita o Jitsi; `external_api.js` só de `meet.<domínio>`; licença Apache-2.0 na página de créditos da área | o IFrame API não deixa; o parceiro falhou por isso | voltar ao iframe de terceiro traz a marca de volta |
| D3 | Gravação pelo Jibri em servidor separado, por hora, criado e apagado pelo workflow; reserva: gravação local no Chromium ou OBS com upload | o cx23 não comporta o Jibri; custo por live de 2 h gravada em 1080p ≈ EUR 0,30 (D26) | Jibri fixo custa o mês inteiro; sem Jibri, só a reserva (sem webhook, replay manual) |
| D4 | Aluno assiste, comenta, reage, levanta a mão, vota e **abre a câmera se quiser** (entra desligada, sai em 360p, aparece nas miniaturas, com aviso de gravação e de consumo); o host controla tudo (tabela de §2.9), inclusive fechar câmeras, desligar as câmeras de alunos no webinário e liberar microfones (o aluno aceita com um clique, como no Zoom) | pedido do produtor (28/10): a sala com câmeras como no Zoom; a banda cabe com a regra de qualidade (D26) | sem câmera de aluno, o cx23 vai mais longe (~100 alunos com palco 720p); com ela, ~30 a 40 no cx23 e ~100 só no cx33 ou cpx32 |
| D5 | Chat, reações, enquetes, perguntas e presença no nosso app, com hora absoluta e offset; chat do Jitsi desligado | replay sincronizado e relatórios; o chat do Jitsi não persiste | com o chat do Jitsi, a live gravada perde o chat original e os relatórios ficam só com entrada/saída |
| D6 | Live gravada com todas as funções do Hot Webinar, por fases; o simulado marcado por dentro como `source = scripted` (roteiro) ou nas colunas `simulated_*` da Sessão (contador, entradas, avisos de venda), fora das métricas reais | pedido do produtor; o bloco "Simulação" separado protege o relatório | tirar os simulados só remove opções por sessão; nada no modelo muda |
| D7 | 10-30 alunos no começo, ~100 na fase 1 (meta); 300-500 depois | dimensiona o cx23 e a fase 2 | acima de ~150 na fase 1 antecipa o HLS |
| D8 | Acesso por produto e/ou segmento (o segmento vale na faixa seguinte do recálculo); Garantir vaga opcional, só para lembretes; sem lista de espera | os acessos são a verdade (AGENTS.md); vagas não fazem sentido numa área fechada | inscrição obrigatória pede limite de vagas, lista de espera e 403 na sala |
| D9 | `/admin/comunicacao/webinarios`; abas Webinários · Lives ao vivo · Lives gravadas; relatório por webinário; CSV com os nomes do Zoom; Período da barra; permissões da Comunicação; cache de 60 s por função SQL | é a moldura prevista no `docs/17`; o padrão do relatório do pop-up já existe | painel próprio fora de Comunicação muda menu e permissões |
| D10 | CDC: nunca "ao vivo" fora da área; selo e números simulados por sessão com a decisão registrada (`simulation_decided_by/at`, `simulation_ack_text`); LGPD: consentimento com versão, remoção, nome reduzido, aviso de gravação, prazo de guarda | art. 37 do CDC e arts. 7, 8, 12 e 18 da LGPD | sem o registro por sessão, a responsabilidade fica sem rastro; sem consentimento, a reexibição do chat não tem base legal |
| D11 | Gravado sempre na Bunny Stream; ao vivo por WebRTC no Jitsi | vídeo nunca no servidor do app; a Bunny já é o provedor das aulas | outro provedor de VOD muda a ponte do player e o script do Jibri |
| D12 | Até ~EUR 10/mês no Jitsi; Jibri por hora; Hetzner na Europa com live piloto para medir a latência; cx33 com IPv4 pode passar do teto e precisa de ok na hora | custo; os números reais vêm da piloto | se incomodar, servidor nos EUA ou Vultr São Paulo: só o `provision-meet` muda |
| D13 | Ordem: base → live gravada → sala ao vivo → painéis e Hot Webinar; nada na Hetzner antes da fase 3 e sem ok | valor cedo sem servidor novo; regra do `docs/20` | antecipar a fase 3 adianta custo e risco sem o chat e os relatórios prontos |
| D14 | JWT só do servidor, HS256, `WEBINAR_JWT_APP_ID=bunker707` / `WEBINAR_JWT_SECRET` (= `JWT_APP_ID` / `JWT_APP_SECRET` no Jitsi), `iss = aud = bunker707`, `sub = meet.<domínio>`, `nbf = agora − 60 s`, `exp = min(fim previsto + 30 min, agora + 6 h)`, `room` não adivinhável (`w-<id>-<16>`) em `webinar_sessions.room_name`; `ENABLE_GUESTS=0`, `ENABLE_AUTO_OWNER=0`, `mod_token_affiliation` | ninguém entra sem passar pelo nosso acesso; o primeiro aluno nunca vira moderador | `exp` longo deixa um token vazado valer por horas; guest ligado abre a sala a quem tiver o nome |
| D15 | Papéis: host = `webinars.host_user_id` marcado no card Dados (precisa de `messaging.publish`); co-apresentador = `webinar_presenters` (conta da área, escolhido no editor); Equipe = `messaging.write`, `moderator` só com `can_moderate_room`; aluno = o resto | reaproveita as permissões da Comunicação; nada decidido no navegador | uma permissão nova (`webinars.host`) pede migração em `admin_roles` e telas da equipe |
| D16 | Limites: chat 5 por 60 s (a dos comentários); reações 1/s e até 20/min; perguntas 2/min; teto global `STUDENT_WRITE_LIMIT` 30/min; modo lento 10 / 20 / 30 / 60 s por sessão; apagar, silenciar (5/15/60 min), remover, banir e denunciar | limites já aceitos pelo produto; moderação ao vivo precisa existir enquanto o host apresenta | limites maiores pedem medida nova no cx23 do app |
| D17 | Webhook do gravador único (`POST /api/webhooks/recorder`, `WEBINAR_RECORDER_WEBHOOK_SECRET`) assinado (HMAC, janela de 5 min), idempotente por `(session_id, state, file_name)`, corpo cru guardado; o arquivo vai direto para a Bunny | regra de webhook do AGENTS.md; o app nunca recebe vídeo | sem assinatura, qualquer um cria replays |
| D18 | `external_api.js` com nonce; nenhuma origem nova em `script-src`; iframe com `allow` explícito; Permissions-Policy aberta só em `/webinarios/:path*`; mensagens só com `event.source` e origem exata | mesma regra do `docs/29` §5 | abrir `script-src` para a origem do Jitsi deixa um script dele rodar na nossa origem |
| D19 | Presença por baldes de 30 s com sinal a cada 15 s; 90 s (3 baldes) sem sinal fecha o trecho (padrão, a confirmar no piloto); aba escondida manda `sendBeacon`; o relatório mostra trechos | iOS congela a aba; batida perdida não é saída | baldes menores multiplicam linhas (um aluno em 2 h já são 240) |
| D20 | Chat atrás de um adaptador com Realtime e polling; o CI testa polling; Realtime medido na piloto | o Realtime existe no compose mas o app nunca o usou e o CI não o sobe | ficar só no polling custa Auth por pedido (`docs/09`); só no Realtime deixa o CI sem teste |
| D21 | Prazo de guarda de gravação e chat: 24 meses (padrão assumido), com aviso 30 dias antes | alinhado ao prazo prometido para `student_events` no `docs/17` §2.4 | prazo menor apaga replays em uso; maior pede justificativa de LGPD |
| D22 | Perguntas em aba própria e tabela `webinar_questions`, com `message_id` quando a pergunta vem do chat; fila do host ordenada por votos; na fase 2 | D4 e os prints pedem a aba; o relatório Q&A do Zoom sai dela | perguntas só como marca no chat tiram o voto e a fila |
| D23 | Legendas e transcrição ao vivo fora da v1; legendas só no replay, pela transcrição da gravação | Jigasi + provedor é custo e servidor a mais | legendas ao vivo pedem outro serviço no servidor do Jitsi |
| D24 | Agente de IA com `role = ai`, selo **Assistente**, nunca mostrado como equipe nem como aluno; responde só quando chamado ou com "Responder tudo", e cala quando um atendente assumiu; relatório em bloco próprio, fora da Simulação | "nunca finge" (D10); a resposta a um aluno real não é número inventado | mostrar a IA como Equipe engana o aluno e mistura o relatório |
| D25 | Fases da Live gravada: "Em horários marcados" e "Replay livre" na fase 2; "Começa quando você entra" na 4e; a Simulação da fase 2 é só o selo com a decisão registrada; contador, entradas/saídas e avisos de venda na 4b | D6 e D13 põem a Live gravada com sessões na fase 2; just-in-time muda o conceito de turma | antecipar o contador para a fase 2 é só mover colunas para `webinars_v2` (ponto aberto A11) |

### 12.2 O que fica de fora da v1

- Aluno no palco sem convite (a câmera do aluno fica nas miniaturas, D4); legendas ao vivo (D23); lista de espera (D8); "Permitir que o aluno abra o microfone sozinho" ligado (fica desligado e fixo).
- Script que fica procurando estoque de cx33 (pedido do produtor: depois).
- Fase 2 de escala (HLS/visitors), WhatsApp nos lembretes, tradução automática (fase 4f), Sala Live vertical (4d), atendentes humanos com distribuição (4c), "Começa quando você entra" (4e), tela de criação de links de origem.
- Chat do Jitsi, enquetes e reações nativas do Jitsi (desligados de propósito, D5).
- Certificado de presença; sala de reunião 1:1 (`ENABLE_P2P=0`); gravação do nosso chat dentro do vídeo (o Jibri grava só o palco; o replay junta o chat por offset).
- Importar gravações de outras ferramentas com chat: entra só se o produtor tiver acervo (§12.3).

### 12.3 Abertas, com o padrão assumido

| # | Pergunta ao produtor | Padrão assumido até a resposta |
|---|---|---|
| A1 | Prazo de guarda da gravação e do chat: 24 meses? | 24 meses (D21) |
| A2 | Professores (papel do `docs/17`) podem ser host das lives dos cursos deles, ou só quem tem `messaging.publish`? | só `messaging.publish`; professor entra como co-apresentador (D15) |
| A3 | Realtime ou polling no chat? | medir na piloto; polling de 3 s até lá (D20) |
| A4 | Texto do consentimento e do aviso de gravação (§8.5) passam por revisão jurídica antes da fase 2? | usamos os textos do §8.5 na `dev`; produção só depois do ok |
| A5 | Há acervo (gravações + log de chat) para a primeira live gravada? | não; a primeira nasce da primeira live ao vivo feita com o nosso chat (isso inverte a ordem de valor do D13; se não houver acervo, a fase 2 só tem conteúdo depois da fase 3) |
| A6 | Nome exibido padrão: primeiro nome + inicial, ou apelido obrigatório? | primeiro nome + inicial, com apelido e anônimo opcionais |
| A7 | Co-apresentador precisa de conta na área de membros? | sim (token exige sessão); convidado sem conta fica para depois |
| A8 | Monitor do servidor do Jitsi: Better Stack gratuito, como o do app (`docs/20` §12)? Quem recebe o alerta? | sim, um monitor HTTPS na página do Jitsi e um no TURN; alerta para os mesmos destinatários do servidor A |
| A9 | Confirmar o hostname do Jitsi: `meet.<domínio>`? | `meet.<domínio>`, só DNS, sem proxy da Cloudflare (D1) |
| A10 | Logo da Bunker707 no canto do vídeo ou nenhum? | nenhum (`defaultLogoUrl = ''`); `DYNAMIC_BRANDING_URL` fica pronto para ligar |
| A11 | Selo "Ao vivo" e contador simulado já na primeira Live gravada? | fase 2 traz só o selo com a decisão registrada; contador, entradas/saídas e avisos de venda na 4b (D25) |
| A12 | Limite de vagas: com o limite ligado, só quem garantiu vaga entra na sala, ou todo mundo com acesso entra e o limite só trava o botão? | só quem garantiu vaga entra |
| A13 | Oferta de uma variante só (card + link de checkout) já na fase 2? | fase 4b |
| A14 | Janela da "turma" no "Começa quando você entra": 15 min e o contador real só dessa janela? | 15 min (fase 4e) |
| A15 | Solta em "Quando o apresentador diz" depende da transcrição do vídeo da Live gravada (hoje `lesson_transcripts` é da aula): transcrever o vídeo da Bunny pela mesma fila ou a Equipe envia a legenda? | a Equipe envia a legenda como nas aulas; transcrição paga da Bunny a conferir (fase 2 se pronta, senão 4) |
| A16 | Faixa "Ao vivo agora" numa sessão gravada: segue a mesma regra do selo (só com `show_live_badge`)? | sim |
| A17 | Vocabulário: os testes do Webinário usam a lista própria `PROIBIDAS_WEBINARIO` (sem `sessão`, `lembrete` e `oferta`); ok de quem cuida das guardas da Comunicação? | lista própria, textos em `webinar-copy.ts` |
| A18 | Pesos dos "alunos mais quentes" e teto de 50 mensagens (M3); retenção das amostras em 90 dias (M5); atribuição da compra em 7 dias (M7)? | os valores de §5.5 |
| A19 | "Presente" conta qualquer amostra do balde (inclusive pausado ou aba escondida) ou só `state = 'playing'`? | qualquer amostra (como o Zoom conta tempo na sessão); a curva "com o vídeo tocando" como linha secundária, a medir |
| A20 | Pesquisa do fim (Survey) de verdade, ou só o CSV vazio pelo nome do Zoom? | CSV nasce vazio; a pesquisa só se o produtor pedir (fase 4) |
| A21 | Segredos do Jibri num segredo do repositório (`JIBRI_SECRETS`, I4), fora da doutrina de `docs/20` §4A.6? | sim, até haver alternativa (o Jibri pedir o `.env` ao C por canal assinado) |
| A22 | Token do GitHub só de Actions no app (I3) para disparar `jibri-up`/`jibri-down`? | sim; senão o botão **Preparar gravação** vira disparo manual da Equipe pelo workflow |
| A23 | TURN em 443/TCP desde o início (segundo IP ou nginx por SNI)? | portas padrão na fase 3; 443 só se a piloto mostrar alunos em rede fechada (I7) |
| A24 | Replay disponível por 7 dias na página inicial e encerramento automático 2 h depois da hora marcada sem início? | 7 dias e 2 h |
| A25 | Dispositivo no Attendee report sem país nem rede (o Zoom tem)? | fica de fora de propósito |
| A26 | Gravação em 1080p: cpx42 por hora (≈ EUR 0,30 por live) ou o cpx32 (≈ EUR 0,15), se a piloto mostrar que ele grava 1080p a 30 quadros sem perder quadros? | cpx42; a piloto testa o cpx32 |

Números marcados como "a medir" ou "a conferir" neste documento (tempo do `jibri-up`, memória de cada container do C, alunos por vCPU, tráfego mensal, latência real, p95 do chat e da presença, porta do health do Jibri, nomes das variáveis da JVM, transcrição da Bunny, barra escondida do player) são preenchidos na live piloto (§10.3) e ao criar `infra/jitsi/`; até lá, nenhum deles é promessa.

---

## 13. Fontes

- Jitsi Meet Handbook: requisitos, escala e recomendações do Jibri (https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-requirements e https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-scalable); IFrame API, comandos e sinais, whitelist do `interfaceConfigOverwrite` (https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe); `interface_config.js` e `config.js` (https://github.com/jitsi/jitsi-meet/blob/master/interface_config.js e https://github.com/jitsi/jitsi-meet/blob/master/config.js); JWT e `mod_token_affiliation` (https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker e https://github.com/jitsi-contrib/prosody-plugins/tree/main/token_affiliation).
- docker-jitsi-meet: `env.example`, tags stable, Jibri, TURN, licença Apache-2.0 (https://github.com/jitsi/docker-jitsi-meet e https://github.com/jitsi/docker-jitsi-meet/releases).
- Zoom Support: controles do Zoom Webinar (host, panelist, attendee), Practice session, Q&A, Polls e os relatórios Registration, Attendee, Performance, Q&A, Poll, Survey (https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064178 e https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063667).
- Hot Webinar: lista de funções e planos da página inicial (https://www.hotwebinar.com.br/), lida em 28/10/2026 (Start R$ 397, Growth R$ 697, Elite R$ 997 por mês; o site responde "Posso fazer webinários ao vivo? Não.").
- Hetzner Cloud: preços de cx23, cx33 e cpx32, cobrança por hora e teto mensal, tráfego incluso, snapshots, IPv4 (https://www.hetzner.com/cloud/ e https://docs.hetzner.com/cloud/billing/).
- Latência entre regiões (referência para São Paulo ↔ Europa): Azure network round-trip latency statistics (https://learn.microsoft.com/azure/networking/azure-network-latency); medição própria em `docs/19` §3.3.
- Bunny Stream: API de upload (criar vídeo + enviar arquivo, TUS), preços de entrega por região, Player.js (https://docs.bunny.net/reference/video_createvideo, https://docs.bunny.net/docs/stream-embed-player e https://bunny.net/pricing/stream/).
- Mux e Cloudflare Stream (fase 2 de escala): preços de live por minuto (https://www.mux.com/pricing e https://developers.cloudflare.com/stream/pricing/).
- Repositório: `AGENTS.md`, `docs/04`, `docs/05`, `docs/12`, `docs/13`, `docs/17` §1.8.3 e §2.4, `docs/18`, `docs/19` §3.3, `docs/20`, `docs/21` §9, `docs/22` a `docs/29`; a pesquisa de 28/10/2026 (resumos e fatos completos no scratchpad desta sessão).
