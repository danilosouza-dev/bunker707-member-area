# Decisoes Abertas

## Stack

### Auth

Decisao atual:

- Supabase Auth no MVP.

Motivos:

- reduzir fornecedores;
- integrar sessao, banco e RLS;
- manter o MVP enxuto.

Clerk pode ser reavaliado no futuro se a prioridade virar recursos avancados de identidade, como passkeys, MFA mais polido ou gestao externa de organizacoes.

### ORM

Opcoes:

- Drizzle;
- Prisma.

Recomendacao atual:

- Drizzle se quisermos SQL mais explicito e leve;
- Prisma se quisermos produtividade com schema bem conhecido.

Decisao pendente.

### Video

Opcoes:

- Bunny Stream;
- Mux;
- Cloudflare Stream.

Recomendacao atual:

- Bunny Stream para custo inicial menor;
- Mux para experiencia de desenvolvedor e analytics de video mais fortes.

Decisao temporaria para a origem gratuita:

- aceitar videos nao listados do YouTube e apresentar somente controles Bunker707, sem branding ou links clicaveis para o provedor;
- manter `Automatica` via embed e oferecer no modo manual apenas as resolucoes reais encontradas para o video, inclusive `2160p` (`3840x2160`) quando disponivel;
- no modo manual, entregar ao navegador fluxos temporarios diretos e separados de audio e video, sem proxy pela aplicacao;
- tratar a extracao manual como integracao nao oficial, sujeita a expiracao e quebras por mudancas do YouTube, sem promessa de sigilo, DRM ou protecao da origem;
- (2026-10-10) a extracao manual ganhou o desligamento `YOUTUBE_UNOFFICIAL_STREAMS=off` (padrao `on` na fase 0, desligada na fase 4 de `docs/17-admin-produtor-redesign.md`), que deixa o aluno e o Modo TV so com `Automático` no embed oficial e mantem as legendas;
- (2026-10-14) o `Automático` renderiza o iframe oficial com altura interna minima de 1080 px CSS, reduzido com `transform: scale()` ate o palco (ver `docs/04-arquitetura-tecnica.md`), porque o embed escolhe a qualidade pelo tamanho do viewport e ficava em 720p. No mesmo dia foi verificado que o `googlevideo` rejeita (`403`) requisicoes com `Range` aberto e nao libera CORS para a aplicacao, entao o modo manual nao reproduz em nenhum navegador: desligar `YOUTUBE_UNOFFICIAL_STREAMS` em producao e seguir com a migracao para Bunny (fase 4) para controle real de qualidade.
- (2026-10-14) a legenda do player e do Modo TV passa a vir primeiro da transcricao guardada da aula (`lesson_transcripts`, enviada/colada/importada no admin) e so depois do YouTube ao vivo, porque em producao o YouTube nega a legenda ao servidor (IP de datacenter). O botao "Importar do YouTube" do admin tambem roda no servidor e tende a falhar em producao; o caminho confiavel e enviar o SRT/VTT baixado do YouTube Studio.

A escolha de um provedor pago definitivo continua pendente.

### Modo TV

Decisao tomada e implementada para a primeira versao:

- usar um receptor web proprio da Bunker707 em `/tv`, sem chamar o recurso de Chromecast, Google Cast ou AirPlay;
- o aluno autenticado cria uma sessao para a aula autorizada, abre o modal `Assistir na TV` e recebe endereco, QR e codigo temporario de seis caracteres;
- a TV consome o codigo uma unica vez e recebe um token temporario; somente o hash desse token fica no Supabase;
- depois da conexao, o modal vira controle remoto para play, pause, voltar 10 segundos, avancar 10 segundos e encerrar;
- comandos e estado usam polling/heartbeat persistido em `tv_sessions`, com revisao monotona, presenca e expiracao. O tempo reproduzido atualiza `lesson_progress` do aluno;
- o QR nao recebe link do YouTube. O receptor pareado usa somente o ID canonico no embed `youtube-nocookie.com`, que continua tecnicamente observavel e nao equivale a DRM;
- a primeira versao cobre YouTube. Cast/AirPlay nativos e receptores para outros providers ficam como evolucao futura.

### Deploy

Opcao inicial:

- Vercel.

Opcao futura:

- Hetzner com Docker/Nginx.

Decisao atual:

- comecar em Vercel, mantendo portabilidade.

## Produto

### Progresso

Decisao tomada:

- nao usar formacao atual fixa, curso atual fixo ou barra de progresso geral do aluno no sidebar.
- progresso deve ser contextual por formacao, curso, bootcamp, modulo ou aula.
- separar progresso de consumo de aulas e progresso pratico, incluindo quizzes, desafios, projetos e demais tarefas configuraveis.
- conclusao real de um produto pode depender apenas de aulas ou tambem de entregas praticas obrigatorias, conforme regra configurada.

### Comunidade no MVP

Decisao atual:

- comunidade completa nao entra no MVP essencial;
- o CRM pode exibir item `Comunidade` como placeholder operacional para manter a arquitetura de navegacao;
- a area do aluno so deve receber comunidade quando categorias, topicos, notificacoes e moderacao estiverem persistidos;
- o pre-requisito de notificacoes foi atendido em 20/10/2026 (sino com avisos, respostas e mencoes; o pedido de resposta `Aceitar`/`Recusar` ja serve para convites; secao Notificacoes e pop-ups abaixo). Faltam categorias, topicos e a moderacao propria da comunidade.

### Ranking no MVP

Recomendacao:

- fase 2;
- eventos de conclusao ja devem preparar os dados.

### Chat interno

Recomendacao:

- fase futura;
- avaliar custo operacional e moderacao.

### Tutor IA, Bunker AI LB e IA Diretor

Decisao tomada e implementada para o tutor de aula:

- o produtor configura modelo e limites de Gemini, OpenAI/GPT ou Anthropic/Claude em `Agentes de IA` e pode cadastrar varias chaves de API ou conectar varias contas em cada provedor; `Configuracoes > Integracoes` permanece reservado aos provedores externos da operacao comercial;
- cada chave fica no Supabase Vault e nunca volta ao browser; contas conectadas passam pelo Bunker AI Gateway isolado e aparecem apenas por nome/dica, saude e identificador;
- o Bunker AI LB respeita prioridade e, entre conexoes equivalentes, usa a menos recentemente utilizada; conexoes pausadas, em cooldown ou que exigem autenticacao ficam fora da selecao normal;
- 429, falhas transitorias e indisponibilidade atualizam cooldown/backoff e acionam fallback para a proxima conexao. A resposta registra tentativas e a conexao exata usada;
- conectar conta de consumidor e opcao experimental, dependente dos termos e limites do provedor; nao significa que uma assinatura ChatGPT, Google AI ou Claude conceda cota oficial de API;
- a opcao de o aluno consumir creditos comprados diretamente da Bunker707 foi adiada e nao aparece nesta entrega;
- aulas do YouTube importam a legenda publica automaticamente. Quando ela nao existe, ou para outros providers, o produtor envia SRT, VTT, TXT ou cola a transcricao;
- a importacao salva uma versao permanente no Supabase, cria chunks e analisa a aula quando houver provedor configurado; nenhuma pergunta busca a legenda novamente no YouTube;
- a aba `Tutor IA` ao lado de `Comentários` e `Materiais` usa respostas reais, sem mock, e so envia depois de validar sessao, ownership, entitlement, transcricao e limites;
- o historico nao expira automaticamente, fica separado por aluno, aula e conversa e permite varios chats independentes para a mesma aula;
- cada chat pode ser renomeado pelo aluno por um menu compacto de ações; o novo titulo e persistido no Supabase somente depois de validar ownership;
- `Excluir chat` remove a conversa do historico e do contexto futuro do aluno por meio de `student_deleted_at`, mas preserva o registro no backend para analises internas agregadas; pedidos formais de privacidade continuam podendo exigir apagamento ou anonimizacao real;
- somente timestamps derivados pelo servidor de uma cue citada e semanticamente validada levam ao player; o seek comeca 3 segundos antes da legenda correspondente. A IA nunca calcula o horario e citacoes antigas ou livres permanecem sem clique. Transcricoes sem tempo usam `Trecho N`;
- o produtor acompanha consumo real por periodo: total, tipo de agente, tutor/aula, aluno, ranking dos alunos que mais usam IA, provedor/modelo, conexao e dia;
- o ranking de uso e operacional/custo, nao uma classificacao de desempenho do aluno, e fica restrito ao CRM administrativo;
- a IA Diretor usa o tipo interno `platform_guide` e um chat global separado. Ela consulta somente a estrutura e o conteudo autorizados ao aluno para orientar, localizar aulas e recomendar caminhos ou trilhas;
- o primeiro release usa ranking lexical de titulos, descricoes, perfis e chunks, sem embeddings. Referencias opacas retornadas pelo modelo sao resolvidas em links internos somente pelo servidor;
- creditos especificos para a IA Diretor continuam adiados; perguntas e tokens ja sao auditados separadamente para permitir cotas futuras;
- a IA Diretor nao e outro tutor: o Tutor IA funciona como professor de uma aula especifica; a IA Diretor funciona como orientador amplo da escola. Historicos, prompts, fontes e metricas permanecem separados para o aluno nao misturar os dois contextos;
- agentes de comentarios continuam como evolucao separada.

### Combos de produtos

Decisao tomada:

- combos sao pacotes internos compostos por produtos existentes;
- a compra externa de um combo deve resolver os produtos incluidos e criar entitlements internos para cada produto/alvo;
- combo nao e checkout interno e nao autoriza conteudo diretamente;
- todo combo pode ter turma, usando `Turma A` como padrao visual quando nenhuma turma foi criada;
- remover produtos de um combo ativo exige cuidado operacional e auditoria, porque pode afetar ofertas ja vendidas.

### Moderacao de comentarios

Decisao tomada:

- o CRM tera item `Moderacao` para comentarios e respostas de aulas;
- filtros principais: produto, tipo (`comentario` ou `resposta`) e status (`pendente`, `aprovado`, `ocultado`, `spam`);
- palavras bloqueadas impedem o envio e retornam mensagem amigavel ao aluno;
- comentarios persistidos e acoes de moderacao devem ter auditoria antes de liberar a funcionalidade em producao.

### Integracoes

Decisao tomada:

- integracoes ficam dentro de `Configuracoes > Integracoes`;
- provedores iniciais: Hotmart, Ticto, TikTok, Kiwify e Manual;
- segredos reais nao ficam no browser;
- eventos externos alimentam adaptadores e entitlements internos.

### Area do aluno v2 (2026-10-11)

Decisao tomada:

- liberacao "X dias/horas depois da compra/inscricao" mostra ao aluno a data real (`Liberação em 08/01/2026`), calculada no servidor com a mesma conta que abre a aula: inicio do acesso ativo mais antigo (`entitlements.starts_at`) + atraso, no fuso de Sao Paulo. Sem acesso real (visitante, previa do produtor, gratuito sem compra) continua a frase generica;
- garantia de 7 dias: por enquanto a conta usa a data da compra. A Hotmart informa o fim da garantia no webhook (`purchase.warranty_expire_date`); quando o pipeline de webhooks gravar esse campo no acesso, a regra podera contar a partir dele (`anchor: "warranty_end"`). A conta ja esta pronta; falta a coluna e a opcao no admin;
- aula ainda nao liberada nao envia video ao navegador; a tela destrava sozinha quando a data passa ou quando a aula anterior e concluida;
- comentarios mostram etiqueta de funcao para todos: `Professor` (quem da equipe monta modulos e aulas: dono, admin, editor, professor ou funcao com essa permissao), `Moderador` (o resto da equipe) e `Aluno`;
- o topo da area do aluno nao mostra trofeu ate existirem conquistas reais; o avatar abre o menu da conta. O sino seguia a mesma regra e voltou em 20/10/2026, com notificacoes reais (secao Notificacoes e pop-ups abaixo);
- Suporte sem formulario enquanto nao existir caixa de entrada no admin para responder; a pagina mostra os canais configurados e perguntas frequentes;
- Perfil so leitura nesta fase; editar nome/telefone/foto depende de unificar as tres origens do nome (cadastro do aluno, `profiles` e conta);
- materiais de aula vem da tabela `lesson_materials` (migracao `202610130001`); a lista fixa de exemplo saiu. O cadastro de materiais no admin e a proxima etapa.

### Notificacoes e pop-ups (20/10/2026)

Pedido do produtor: notificacoes no sino com imagem, audio que toca ali mesmo, botao para dentro ou para fora da plataforma e convites que o aluno aceita ou recusa; a equipe cria, envia na hora ou agenda; pop-ups para grupos de alunos escolhidos por regras combinadas. Construido como Comunicacao v1 (fase 5 do `docs/17`, sem webinarios e promocoes); detalhes em `docs/22`.

Decisao tomada (tabela C1-C13 em `docs/22` §5):

- o sino se chama `Notificações` (nao "Lembretes"), como no vocabulario do `docs/17` §1.3; o numero conta as novas nao vistas e some ao abrir o sino, e a bolinha de cada item marca o que o aluno ainda nao abriu;
- a notificacao de aviso aponta para o aviso (uma linha pequena por aluno; retirar do sino e uma acao so); as automaticas de comentario guardam o trecho e o link da aula;
- o segmento ("Para quem") e avaliado no servidor, em TypeScript, com as mesmas leituras e regras da lista de Alunos (produto, progresso, comentarios, tempo de acesso, acesso terminando, ultimo estudo, entrada na plataforma, ritmo e turma), em grupos E/OU com um nivel, ate 20 regras. A equipe nunca entra. Vai para uma RPC quando a escola passar de alguns milhares de alunos (o mesmo aviso de escala da lista de Alunos);
- envio da notificacao agendada e recalculo do segmento dos pop-ups no tick de minuto (job `comunicacao`), excecao a regra do `docs/04` que manda envio em massa para a fila de jobs: a fila ainda nao existe, e a linha do sino e minuscula, gravada em lotes de 500, com teto de 20.000 por rodada e retomavel sem duplicar. E-mail, push e WhatsApp em massa continuam fora do tick;
- pop-up so na home, nunca numa aula, 3 s depois de abrir, no maximo 1 por sessao e 1 a cada 24 h, sem excecao para nenhum tipo (o tipo "critico" do sistema fica para depois); `Lembrar depois` volta em 24 h, no maximo 2 vezes; `Não mostrar de novo` vale para sempre (`docs/17` §1.8.1 e D12);
- aprovacao acima de 500 alunos como no `docs/17` D4: editor publica ate 500; dono e admin publicam acima e aprovam o pedido de outra pessoa. O limite vale de novo na hora do envio da notificacao agendada (sem aprovacao e acima de 500, volta para aprovacao em vez de sair) e ao editar ou retomar um pop-up no ar (sem a permissao, 403, sem pedido); o pop-up no ar pode crescer alem de 500 sem nova aprovacao (`docs/22` §2.3, C12 e C13);
- o pedido de resposta (`Aceitar`/`Recusar`) ja existe nos avisos da equipe e e o mecanismo que os convites da comunidade vao usar;
- audio em bucket publico proprio (`communication-audio`, ate 10 MB, nome pelo hash), como as imagens: aviso nao e conteudo pago. Gravar no navegador exige o microfone, liberado so no `/admin`;
- o desfecho de cada aviso e fixo, "voltou a estudar em 7 dias"; o seletor de desfecho ("Como medir") fica para depois;
- mencao so avisa quando um unico autor da conversa tem o `@usuario`, porque o nome de usuario nao e unico na escola;
- sem tempo real: o numero do sino e lido depois que a pagina aparece, vale 1 minuto entre paginas e e relido ao voltar para a aba; nada roda em intervalo (cada chamada custa uma conferencia de sessao no Auth);
- eventos: `notification_read`, `notification_clicked`, `notification_responded` no sino e `message_impressed`, `message_clicked`, `message_closed`, `message_dismissed`, `message_snoozed` no pop-up, so com ids (`docs/05`, secao Eventos).

Fica em aberto:

- convites entre membros e a comunidade (posts de texto, texto com audio, video, resultados, gamificacao): o pedido de resposta esta pronto; falta quem cria o convite. Video de aluno vai para Bunny ou Mux, nunca para o servidor da area;
- salas ao vivo e webinarios "tipo Zoom" dentro da area, com comentarios e numeros de retencao (momento de saida, retencao media e maxima, quem mais comentou): pede um estudo proprio (provedor de video ao vivo, custo e escala) antes do desenho. Estudo feito e decidido em 28/10/2026: `docs/30-webinarios.md` (Jitsi proprio sem marca d'agua no cx23, Jibri por hora, live gravada com o chat original, paineis separados). Decidido; as fases 1 e 2 entregues e a fase 3 (a sala ao vivo no app, migracao `202610290002`) pronta em 29/10/2026, com as decisoes novas D33 a D39 no `docs/30` §12.1; os servidores C e D seguem esperando o ok do produtor no chat (`docs/20` §8B). A fase 4 (29/10/2026, migrações `202610290004`, `0005`, `0006`, `0008` e `0009`; `docs/21` §9.9) decidiu e entregou o resto: os painéis "Lives ao vivo" e "Lives gravadas" com o Exportar nos nomes do Zoom; a Oferta A/B/C/D com a compra ligada ao último clique pelo webhook (atribuição de 7 dias) e a receita de `webhook_events.amount_cents`; o follow-up pelas ações da regra **Participação em lives** dos segmentos (a regra **Webinário** da 4b, unida a ela na integração de 30/10/2026; vale no "Para quem" e no "Quem entra", nunca dentro de um fluxo nem no Quem pode); a Simulação completa fora de todo número real; o Assistente de IA (nunca na linha mestre) com os atendentes e o modo híbrido; a Sala Live vertical; o "Começa quando você entra" por horário (uma sessão por horário, a turma do dia no chat); e a tradução do chat guardada por texto e idioma (decisões D40 a D50 no `docs/30` §12.1). Seguem em aberto, com o padrão assumido (`docs/30` §12.3, A27 a A32): a janela padrão do just-in-time, os limites do Assistente, uma Oferta ativa por webinário, a cascata dos cliques e dos pedidos à IA, a tradução guardada sem autor e a revisão jurídica dos avisos de venda simulados (desligados por padrão);
- outros tipos e canais: faixa no topo, card na home, destaque, toast, e-mail (pela fila `email_outbox`), push e WhatsApp;
- central de preferencias `/perfil/notificacoes` e descadastro sem login, que chegam junto com o primeiro canal fora da plataforma;
- seletor de desfecho, "Salvar quem converteu como segmento", aba "Avisos recebidos" no perfil do aluno e "Enviar aviso" a partir de Alunos, Comunidade e Hoje.

### Comunicacao v2: quem envia, tempo no sino, notificacoes seguintes e fluxos (21/10/2026)

Pedido explicito do produtor (20/10/2026): mudar o icone do circulo (a escola, a propria foto ou a de um professor) e por um icone de assunto junto com o titulo; escolher quanto tempo a notificacao fica no sino; uma "automacaozinha de notificacoes" (segunda notificacao para quem nao abriu, nao ouviu, nao clicou, ou visitou e nao comprou, depois de X horas ou faltando X horas para vencer); e a onda do audio verde quando o aluno ouviu tudo. Detalhes em `docs/23`; migracao `202610200002`. Muda a decisao do `docs/17` §1.14 ("automacoes encadeadas" fora do MVP), so no sino.

Decisao tomada (tabela V1-V20 em `docs/23` §8; resumo em `docs/22` §5, C14-C20):

- V1 o circulo e quem envia: o Icone da escola da Marca (padrao `/brand/icon-bunker.svg`) ou a foto (ou as iniciais) de alguem da equipe; sem megafone e sem selo no aviso;
- V2 **enviada em seu nome**: so pessoas da equipe (`admin_roles`) podem ser escolhidas, sem nome digitado nem foto avulsa; quem envia e resolvido na hora de ler o sino (quem sai da equipe vira a escola, tambem nas notificacoes antigas); a pessoa escolhida recebe o e-mail `sent_as` (`Uma notificação saiu em seu nome` / `Um fluxo de notificações usa o seu nome`), uma vez por aviso ou por fluxo, nunca para quem publicou; auditoria com `sender_user_id` e a linha `Criada por … · em nome de …` no relatorio. Sem permissao nova: publicar ja pede `messaging.publish` ou aprovacao. Sem linha no sino da equipe (a equipe entra direto no `/admin`, que nao tem sino);
- V3 icone opcional antes do titulo (16 ids, 5 cores da paleta), decorativo, no sino, no pop-up e nos fluxos; sem rotulo "Novo"/"Urgente" ate as referencias do produtor;
- V4 **Fica no sino por**: 1, 3, 7, 30 ou 90 dias (padrao e maximo), de 5 minutos a 90 dias (1 hora ate os ajustes da v3a, `docs/24` §10) ou ate uma data; fim por linha (`notifications.expires_at`); vencida some da lista, dos numeros e do "Marcar todas"; comentarios continuam com 90 dias;
- V5 `Termina em 3 h` com 24 h ou menos e tempo total ate 30 dias; rodape `As notificações ficam aqui por até 90 dias.`;
- V6 audio ouvido = 44 de 48 trechos tocados de verdade, somados no servidor entre visitas e aparelhos; quatro estados, nunca so pela cor; audio do pop-up sem estado;
- V7 `opened_at` (abriu de verdade) separado de `read_at`: "Marcar todas" e abrir o sino nao abrem; numa notificacao sem nada para abrir so se oferece "viu no sino";
- V8 um modelo so: fluxo e uma arvore de Notificacao e Condicao (Sim/Nao); as notificacoes seguintes do editor sao um fluxo `origin = notice`; uma linha de trabalho por (passo, aluno);
- V9 e V10 seguintes no proprio editor (card "Depois desta notificação", ate 5 por nivel e 3 niveis) e a aba Fluxos com quatro modelos e construtor;
- V11 e V12 motor seguro para recalcular e aplicacao atomica por lote (pausar, encerrar, editar, ticks sobrepostos e quedas nao causam envio indevido);
- V13 **limite diario**: no maximo 3 notificacoes de fluxos e notificacoes seguintes por aluno por dia de Sao Paulo, com pelo menos 1 hora entre elas (tambem na virada do dia); passou do limite do dia, sai as 8h do dia seguinte; nao sai depois do prazo ou de 7 adiamentos; avisos avulsos da equipe e comentarios nao contam; sem horario de silencio no sino (nao toca nem manda push). Muda a linha "Notificação (sino)" do `docs/17` §1.8.1 (era "sem limite");
- V14 fatos numa RPC por lote de 150; progresso e comentarios so quando uma regra pede;
- V15 visitas de pagina gravadas no servidor, so das paginas que um fluxo ativo ou pausado usa; beacon so para abrir detalhes de um produto e clicar em Comprar;
- V16 regra "O que fez com uma notificação" nos segmentos e nos fluxos; visita de pagina e "ganhou acesso desde" so nos fluxos; negacao implica "recebeu";
- V17 permissoes com o mesmo sentido: ativar, retomar e aplicar mudancas valem como publicar; os 500 contam o segmento de entrada agora; a aprovacao da notificacao cobre as seguintes; fluxo continuo pode crescer (C12); mudanca no ar nunca vira pedido (C13);
- V18 mudancas num fluxo no ar sao preparadas e aplicadas juntas (`Aplicar alterações`); conteudo vira versao nova; mover e recusado;
- V19 vocabulario: Fluxos, Notificação seguinte, Depois desta notificação, Quem envia, Ícone ao lado do título, Fica no sino por, Quem entra, Condição, Esperar, Objetivo; nunca "automação", "gatilho" ou "lembrete" na tela;
- V20 o motor e a fase 2 do job `comunicacao` no tick (mesma excecao de C5 ao `docs/04`: sem fila nova), com 25 s proprios e numeros em `job_runs.metadata`.

Fica em aberto:

- passos por e-mail, push e WhatsApp e o disparo na hora por evento ("concluiu a aula X" agora): hoje a entrada continua chega em ate 15 minutos;
- rotulo curto ou cartao colorido, quando chegarem as referencias visuais do produtor (o catalogo de icones ja tem lugar);
- JPEG no Icone da escola (hoje PNG, WebP ou SVG);
- A/B, seletor de desfecho e linha do tempo do aluno nos fluxos.

### Comunicacao v3a: CRUD dos avisos, lixeira, cartao clicavel, reacoes, enquete e sino rapido (22/10/2026)

Pedido do produtor (21/10/2026), depois de testar a v2 na `dev`: CRUD das notificacoes no menu ⋯; o aluno tirar a notificacao do proprio sino (lixeira); a notificacao inteira clicavel, com ou sem botao, com sinal de que e clicavel; voltar atras depois de Aceitar ou Recusar; titulo mais destacado; reacoes como no WhatsApp; enquete direto nas mensagens; o sino demorando para abrir a lista; e a pergunta (duas vezes) sobre o pop-up "Uma vez" que vira "Até o aluno clicar". Detalhes em `docs/24`; migracao `202610220001`. **Muda decisoes**: a regra da v1 "Notificação enviada não muda" (`docs/22` §2.2) e "Excluir so rascunho, aguardando, cancelado e encerrado" caem; reacoes e enquetes entram no sino (antes fora de qualquer fase); "limite de pedidos nas rotas do sino" (`docs/22` §6) entra para as quatro escritas do aluno.

Decisao tomada (tabela T1-T23 em `docs/24` §8; resumo em `docs/22` §5, C21-C27):

- T1-T5 **CRUD no ⋯**: Ver relatorio, Editar, Duplicar, Excluir e as acoes de estado em toda situacao em que fazem sentido. A **notificacao enviada pode ser editada** (titulo, texto, imagem, icone, Quem envia, destino e modo, textos de Aceitar/Recusar, reacoes), em silencio (sem "editada", sem marcar como nova); travados o tipo, o segmento, o envio, o tempo no sino, o audio, ligar/desligar a resposta e a enquete (menos Encerrar enquete). Editar a enviada vale como publicar (`messaging.publish`; acima de 500 que receberam, `publish_large`; 403, nunca pedido). **Excluir em qualquer situacao menos "Enviando"**; agendado, enviado e pop-up no ar/pausado pedem `messaging.publish`; a enviada sai de todos os sinos;
- T6-T7 **pop-up**: "Mostrar de novo para quem já viu" so no pop-up "Uma vez" (no editor e no menu); quem escolheu "Não mostrar de novo" e quem clicou nunca voltam; em "Até o aluno clicar" quem so fechou ja volta 24 h depois do ultimo pop-up que viu (o limite global decide), entao ali nao ha reinicio. A resposta ao produtor esta no `docs/24` §2.4;
- T8 **lixeira do aluno** em todo cartao, com Desfazer ate o painel fechar; excluida sai de tudo e continua "recebeu"; o relatorio mostra quantos excluiram;
- T9 **cartao clicavel** em tres modos (Pelo botão; Pelo botão ou tocando; Só tocando, com o texto ao lado da seta), um link acessivel por cartao mais um link decorativo, todo controle dentro continua clicavel;
- T10 **Mudar resposta** enquanto a notificacao esta no sino; os relatorios contam a atual e quantos mudaram; `responded_at` = a primeira;
- T11 titulo de 15 px em negrito;
- T12 **reacoes**: 6 emoji fixos, uma por aluno, o aluno ve so a propria (sem numeros para ele: privacidade e custo); ligadas por padrao no que e novo, desligadas no que ja existia; nem no pop-up nem no comentario;
- T13 **enquetes** nas notificacoes, seguintes e passos de fluxo: 2 a 6 opcoes, uma ou varias, resultado para quem votar, fim por data ou quando sai do sino, exclusivas com Aceitar/Recusar, travadas depois do envio; o modelo puro e o que a v3b reaproveita no pop-up;
- T14-T15 regras `reagiu`, `votou na enquete`, `excluiu do sino`; quem excluiu nao recebe as seguintes de "nao fez"; "foi para o destino" no lugar de "clicou no botão"; reagir e votar contam como abrir;
- T16-T18 **sino rapido**: uma RPC por pagina com a regra de visibilidade num lugar so; sessao pelas claims do JWT em toda rota do sino; a primeira pagina buscada na intencao e guardada no navegador (5 s reabre como esta, 10 min mostra e atualiza), sem polling (C11 continua). Medido: lista p50 30 → 11 ms, 8 → 1 pedido ao banco (`docs/24` §7);
- T19 eventos `notification_reacted`, `notification_voted`, `notification_hidden` e `changed` em `notification_responded`;
- T20 migracao aditiva sem `drop` nem `delete`, toda pelo MCP, antes do deploy;
- T22 no maximo 30 escritas por minuto por aluno nas quatro rotas de escrita e 20 eventos por linha;
- T23 excluir ou retirar uma notificacao citada nas regras de outros avisos ou fluxos avisa com o numero, sem impedir.

Fica em aberto (v3b "Pop-ups sob medida", documento proprio):

- paginas e exclusoes do pop-up, gatilhos (depois de uma aula, primeiro login, horario para todos, atraso), frequencia (a cada N minutos/horas/dias, no maximo N vezes, por sessao) e limites globais editaveis. **Vai mudar** C6 / `docs/17` §1.8.1 / D12 ("so na home, 1 por sessao e 1 a cada 24 h");
- o construtor avancado do pop-up por blocos estruturados (nunca HTML cru: XSS guardado e a CSP com nonce), enquete no pop-up e "Como fechar" (so no X ou no X e fora);
- e, da v3a: numeros de reacao para o aluno, "editada", resposta livre, mais de uma enquete, Desfazer depois de fechar o painel e "Limpar tudo" ficam fora (`docs/24` §9).

### Comunicacao v3a, ajustes depois do primeiro teste (22/10/2026)

O produtor testou a v3a na `dev`: minutos no tempo do sino; escolher se o aluno pode excluir; o lugar das reacoes e da lixeira; a demora do dialogo ao excluir. Detalhes em `docs/24` §10; migracao `202610220002`. **Muda decisoes**: T8 (lixeira em todo cartao) vira "lixeira quando a equipe deixa"; V4/C16 (tempo no sino a partir de 1 hora) vira a partir de 5 minutos.

Decisao tomada:

- **"Permitir que o aluno exclua do sino"** por notificacao (`campaigns.allow_hide`, ligada por padrao e em tudo o que ja existia), no card Interacao; muda depois do envio; desligada, o cartao fica sem o "⋯" e o servidor recusa excluir (403); o Desfazer vale sempre; comentarios sempre podem ser excluidos;
- **tempo no sino em minutos**: "Por um tempo" de 5 minutos a 90 dias (minutos, horas ou dias); "Até uma data" continua pedindo pelo menos 1 hora depois do envio;
- **cartao**: sai a linha de acoes; o Reagir fica no fim da linha do botao, da resposta ou de quem envia (a reacao vira uma pilula pequena no mesmo lugar) e excluir vai para o "⋯" do canto de cima (no computador aparece com o mouse; no toque, sempre);
- **enquete de um passo de fluxo que ja chegou a alguem nao muda** (num fluxo no ar ou pausado; a tela trava e o servidor recusa com a mesma frase); a contagem que o aluno ve soma todas as versoes do passo;
- **excluir mais rapido**: os passos independentes em paralelo e sem `revalidatePath` em Excluir e Retirar do sino; o dialogo fecha quando a acao volta e a lista atualiza depois;
- **sino por aluno no navegador**: o numero e a pagina guardada tem dono (o id do aluno); o filtro "Não lidas" descarta a pagina guardada do "Todas"; reagir e votar so marcam aberto depois que o servidor aceita.

### Comunicacao v3b-1: pop-ups com paginas, momentos, frequencia e como fechar (22/10/2026)

Decisoes do produtor de 21/10/2026, depois de testar a v3a (`Eu que tenho que definir isso, não tem que ser pré-definido.`; `Não quero esse limite fixo de segurança`), mais o pedido de "Como fechar". Detalhes em `docs/25`; migracao `202610220003`. **Muda decisoes**: C6 (pop-up so na home) vira "onde e quando a equipe escolher, um de cada vez"; C23 e T6 (Mostrar de novo so em "Uma vez") viram "em qualquer Quantas vezes"; D12 (limite de 1 pop-up por dia) fica fechada: frequencia por pop-up, escolhida pela equipe; o "Lembrar depois" de 24 h fixas vira o **Volta em** de cada pop-up.

Decisao tomada:

- **sem limite fixo entre pop-ups**: cada pop-up segue a frequencia escolhida pela equipe (Uma vez, ou Mais de uma vez com limite por dia, tempo entre uma vez e outra, limite total e o que faz parar); as unicas regras fixas sao **um de cada vez** e, na aula, **nunca com o video do nosso player tocando**; os pisos tecnicos (5 s entre duas aberturas do mesmo pop-up, 30 chamadas por minuto, 100 eventos de abertura por dia) nunca sao vistos por uma pessoa;
- **onde aparece**: Inicio, qualquer pagina ou as marcadas, com Nunca nestas paginas (a excecao vence); formacao conta os cursos; aula especifica fica para depois;
- **quando aparece**: ao abrir a pagina (0 a 600 s) ou ao concluir uma aula; o horario e o `Começa: Em uma data`; hora marcada ao vivo, primeiro acesso e curso concluido na v3b-2; intencao de saida nunca;
- **como fechar**: no X ou fora, ou so no X, com o Esc sempre fechando (padrao WAI-ARIA, dito na dica do editor);
- **Mostrar de novo** em qualquer modo; nos pop-ups que so param quando terminam, zera tambem quem clicou;
- **ate 50 pop-ups publicados ao mesmo tempo** (no ar ou agendados), por publicar, aprovar, pedir aprovacao e retomar; nao limita o que o aluno ve;
- **pop-ups de antes sem reescrever dados**: "Ate o aluno clicar" = Mais de uma vez com 1 dia entre uma vez e outra, ate clicar; sem botao, abre e salva como "So quando o pop-up terminar".

Em aberto: as acoes que o produtor quer como momento do pop-up (a resposta ao produtor pergunta, `docs/25` §10.1); os modelos de configuracao (entregues em `docs/28`) e o construtor avancado com enquete (v3b-3). Hora marcada ao vivo, primeiro acesso e curso concluido: entregues na v3b-2 (abaixo).

### Design do pop-up (22/10/2026)

Pedido do produtor depois da v3b-1: montar o visual do pop-up como num editor, a partir de uma referencia (video curto no topo sumindo num degrade, selo, titulo de duas cores, texto cinza, botao em pilula). Detalhes em `docs/26`; migracao `202610230001`. **Antecipa parte da v3b-3** (o construtor) sem a enquete; nenhuma decisao anterior muda.

Decisao tomada (com o produtor, antes do desenho):

- **Padrão | Personalizado** no card Design; o Padrão e o de sempre e o padrao de todo pop-up (os que existem nao mudam); a notificacao nunca tem design;
- **texto por zonas** (abaixo da midia, subindo sobre ela, ou sobre ela em cima/meio/embaixo), sem arrastar livre;
- **fontes prontas** (Inter, Exo 2 e pilhas do sistema) e **enviadas** (WOFF2, WOFF, TTF, OTF ate 2 MB, conferidas pelos bytes) numa biblioteca; **nada do Google Fonts em tempo de execucao** (privacidade: baixar e enviar);
- **midia**: nenhuma, imagem (a do aviso, tambem a capa) ou video (MP4 H.264 ou WEBM ate 15 MB, no Storage, mudo, em repeticao); menos movimento ou economia de dados = so a capa;
- **botao principal = o botao de sempre** (mesmo clique contado); segundo botao Fechar, Lembrar depois ou Abrir um link (o link conta como o clique, tambem para "Para de aparecer: Quando o aluno clica no botao");
- **texto de verdade** com estilos so por objeto validado; zod estrito no salvar e no ler; URLs so dos nossos buckets;
- **contraste** como dica, sem impedir salvar; nome acessivel = o titulo do design.

Fora desta entrega: arrastar livre, enquete no pop-up (v3b-3), salvar design como modelo reutilizavel (o design ja e autocontido), HTML/CSS da equipe (nunca), limpeza dos arquivos sem uso no Storage (job futuro). No fechamento, o modelo "Midia no topo com degrade" passou a subir 28 % com degrade de 65 % (o contrato dizia 12 % e 55 %), depois da conferencia com a referencia (`docs/26` D22).

Em aberto: se o produtor quer **modelos salvos** de design (o formato ja permite) e **arrastar livre** depois de usar as zonas.

### Design Livre do pop-up (23/10/2026)

Pedido do produtor depois do Personalizado: "criar o que eu quiser da forma que eu quiser", montando o pop-up do zero, elemento por elemento, como no Elementor. Detalhes em `docs/27`; sem migracao. Responde ao "arrastar livre" que estava em aberto acima.

Decisoes tomadas com o produtor (23/10):

- **terceira opcao Livre** no card Design; Padrao e Personalizado continuam iguais; o editor e de tela cheia (Elementos e Camadas, desenho com arrastar, alcas e guias, Conteudo / Estilo / Avancado, desfazer e refazer, Revisar);
- **no celular o pop-up inteiro encolhe na mesma proporcao**, com texto nunca abaixo de 12 px e 44 px de toque (aceito pelo produtor); valores proprios do celular por elemento ficam para o PR L3, com lugar reservado nos dados;
- o editor Livre **so abre em telas a partir de 1.024 px**; no celular e no tablet de pe, so a previa;
- **copiar e colar o design** (para pedir mudancas ao Claude ou ChatGPT do produtor por fora) vem no proximo PR (L1.1); **"Criar com IA"** pela conta conectada no gateway vem depois (L2);
- o design guarda so caminhos dos nossos buckets e o endereco e montado na hora pela origem conferida; o X sempre visivel e erro que impede salvar.

Fechado em 28/10/2026: o produtor **descartou o "Criar com IA"** (L2); nao sera feito, e as perguntas sobre a conta conectada e a imagem de referencia deixam de valer. O copiar e colar com as instrucoes para a IA (L1.1) continua.

### Comunicacao: o que o produtor quer em seguida (28/10/2026)

Decisoes do produtor de 28/10/2026, ao revisar o que ficou adiado em 26/10 (`docs/27` §10):

- **enquete no pop-up**: desejada; e a enquete do construtor avancado que estava em aberto na v3b-1 (v3b-3, acima);
- **contador no pop-up** (L6f do Livre): desejado, "aqueles contadores de oferta que tem em paginas de venda", para criar urgencia, com o aluno podendo clicar no botao; **feito** em 28/10 (`docs/27` §13.13), com as decisoes de 26/10 (`docs/27` §13.11). O produtor pode mandar exemplos de contadores para ajustar o visual (casas, cores, tamanhos) sem mudar o contrato;
- **"Criar com IA"**: descartado (acima);
- **textura e mistura** (L6e): **descartada** depois da explicacao ("Nao precisa colocar negocio de textura, de mistura, essas coisas");
- **animacao de entrada** (L6d): registrada como **descartada** junto ("essas coisas"), a confirmar com o produtor; se ele quiser, volta com as criticas guardadas no `docs/27` §10;
- **texto escrito direto no desenho** (L6g) e o L4c: continuam adiados, sem mudanca.

### Modelos da Comunicacao (25/10/2026)

Pedido do produtor: guardar a configuracao de uma notificacao, de um pop-up ou so do design para comecar avisos novos, e reusar o design (Personalizado ou Livre) "com outros videos e tudo mais". Detalhes em `docs/28`; migracao `202610250001`. **Fecha** o "Em aberto: modelos salvos de design" (Design do pop-up, acima) e os "modelos de configuracao (v3b-2)" da v3b-1.

Decisoes tomadas com o produtor (23/10):

- tres tipos: **Notificacao**, **Pop-up** e **Design** (Personalizado ou Livre); o tipo e o modo do design nao mudam depois de criado;
- o modelo guarda a configuracao sempre e, se o produtor quiser, o conteudo, o segmento e (na notificacao) as notificacoes seguintes; data e hora de envio, a janela do pop-up, "ate uma data" e o fim marcado da enquete nunca vao;
- **Usar** abre o aviso novo preenchido e nada e gravado ate salvar; mudar ou excluir um modelo nunca mexe nos avisos feitos com ele;
- o modelo segura os arquivos que cita (o pop-up pode ser excluido e o modelo continua com o video, as imagens, o audio e as fontes); excluir o modelo manda o que mais nada usa para a limpeza de 30 dias;
- quem cria avisos cria e edita modelos (`messaging.write`); o aluno nunca ve um modelo; limite de 200 modelos na escola.

Em aberto (a v1 segue com a escolha indicada, `docs/28` §8): o "Novo aviso" com modelos ficou como **menu no botao** (e nao uma tela "Como voce quer comecar?"); com "Levar o segmento" desligado, o aviso comeca em **Todos os alunos**; excluir um modelo pede **so confirmacao** (sem Desfazer no toast).

### Comunicacao v3b-2: hora marcada ao vivo, primeiro acesso, curso concluido, relatorio do pop-up e players de fora (23/10/2026)

O resto da v3b que o `docs/25` deixou para depois (hora marcada ao vivo, "No primeiro acesso", "Ao concluir todas as aulas do curso", o relatorio de onde apareceu e como fecharam, o player do Bunny/Vimeo lido por `postMessage`). Detalhes em `docs/29`; migracao `202610260001`. **Muda decisoes**: o "Num horario" da v3b-1 (so na proxima pagina aberta) vira a hora marcada ao vivo; na aula, o "tocou no player = o pop-up desiste" da v3b-1 vira "espera o video parar" em todo player que a pagina le; o `show` antes da hora passa de 404 a 409; as faixas do recalculo dos pop-ups saem das horas redondas.

Decisao tomada (spec revisada duas vezes e integracao com medida; as perguntas abaixo seguem com a resposta assumida):

- **D1 hora marcada nao e momento novo**: e o comportamento de "Ao abrir a pagina" (e de "No primeiro acesso") com `Começa: Em uma data`; `at_start` continua sem uso (os Modelos nunca guardam a janela, entao um modelo com `at_start` abriria invalido). Abre em hora do servidor + 2 s + 0 a 4 s sorteados + "Quanto tempo depois"; nao desiste por tempo (o Termina decide); segue a hora de parede (despertador de ate 30 s, sem pedido em laco); o plano leva os pop-ups ate 24 h antes;
- **D6 regra unica na aula**: video tocando = espera parar, no arquivo, no YouTube e no Bunny/Vimeo/Mux com a ponte confirmada; ponte pendente confere a cada 1 s; so o player que a pagina nao le continua "mexeu = descarta" (pedido E(1) estendido ao arquivo e ao YouTube por coerencia; pergunta P1);
- **D7 "No primeiro acesso"** com **Conta como primeiro acesso**: "A primeira vez na area" (conta criada depois do comeco do pop-up, ou que nunca entrou) ou "A primeira vez com estes produtos" (acesso aberto ganho depois do comeco a um dos produtos, ate 20, ou acesso sem nunca ter entrado; a plataforma inteira vale); decidido **no recalculo do segmento**, nunca no navegador; quem perde o acesso deixa de ver (os acessos sao a verdade; P10); ate 15 minutos de atraso (P3, B2 depois);
- **D8 a marca `first_access_at`**: so a linha marcada pelo recalculo novo continua elegivel depois de o aluno entrar; linha elegivel sem marca e sem ser candidata sai (a de um app de antes); num pop-up que ja foi ao ar, trocar de ou para "No primeiro acesso" e recusado (duplique);
- **D10 "Ao concluir um curso"** = todas as aulas publicadas dos modulos publicados concluidas (a regra "Progresso 100 %" do segmento); a rota de progresso diz a virada pela gravacao que venceu o compare-and-swap; o `show` confere no banco; formacao = cada curso (a inteira na C2; P4); cada virada e nova chance;
- **D12 relatorio na pagina do pop-up, desde a publicacao** (sem o Periodo; P5): 4 numeros e 4 blocos, das linhas por aluno (exatas) e do historico ja gravado (ate 100 por aluno e dia), pela funcao `communication_popup_report` (so `service_role`), com indice parcial em `student_events`, cache de 60 s e `Suspense`; sem `page` nos eventos de resultado (D13, P6); a analista so leitura nao abre (P7);
- **D14 ponte propria por `postMessage`** com o Vimeo e o Player.js (Bunny e Mux): sem SDK, sem script de fora e sem mudar a CSP; origens exatas (a Bunny e um grupo de duas) e `event.source`; `targetOrigin` exato; so confia depois da resposta ao `getPaused`; com ela, o fim do video conclui a aula e o progresso usa o tempo real; sem ela, tudo como antes;
- **D20 o aluno nao grava linhas de avisos no proprio historico**: a politica de insert de `student_events` recusa `entity_type = 'campaign'` (`alter policy`); as linhas forjadas de antes ficam presas no teto da funcao;
- **integrador, com medida** (`docs/29` §7.2 e §8.2): a funcao do relatorio foi **reescrita** com o mesmo resultado linha a linha (88/145 ms com 3 mil alunos; 1,04/1,32 s com 30 mil, ~30 % acima da meta de 1 s, aceito: 15 vezes a escala do `docs/17`); as **faixas do recalculo dos pop-ups** viram em :07, :22, :37 e :52 (o p95 do `show` com o tick passava de 100 ms; os fluxos ficam nas horas redondas); o **orcamento de JavaScript** do Inicio e de Favoritos foi **excedido e aceito** (+1,72 KB, orcamento 1 KB; a aula +2,63 KB, dentro dos 3 KB): e o codigo da hora marcada, que precisa estar em toda pagina.

Regra de operacao (R1): **nao publicar nem editar "No primeiro acesso" ou "Ao concluir um curso" num ambiente enquanto o app (e o tick) dele roda a versao de antes**; nao usar previas de PRs anteriores; pausar esses pop-ups antes de voltar a imagem na Hetzner (`docs/21` §9.5, `docs/20` §9).

Em aberto (perguntas ao produtor, `docs/29` §10.2; a entrega segue com a resposta assumida entre parenteses): P1 esperar o video parar tambem no arquivo e no YouTube (sim); P2 quem ja tinha acesso e nunca entrou conta como aluno novo (sim); P3 ate 15 minutos de atraso (sim); P4 um pop-up por curso da formacao e desmarcar e concluir de novo conta (sim; formacao inteira na C2); P5 relatorio desde a publicacao (sim); P6 `page` no clique e no fechar daqui para frente (depois, D2); P7 analista ver o relatorio (fica como esta); P8 alguns segundos de diferenca na hora marcada (sim); P9 capa de dois toques, host novo da Bunny e tela cheia de Bunny e Mux (depois, E2); P10 quem perde o acesso deixa de ver o pop-up de boas-vindas (sim).

**Pendencia (LGPD)**: a retencao de 24 meses de `student_events` prometida no `docs/17` §2.4 **nunca foi feita** (`202610170004_personal_data_retention.sql` nao cobre a tabela). Quando vier (job e migracao proprios, D2), o relatorio "Desde a publicacao" do pop-up encolhe sem aviso (o historico some, as linhas por aluno ficam): o job guarda antes os numeros do relatorio de cada pop-up, ou a tela troca a frase do historico do rodape (`footnoteHistory`) por "nos ultimos 24 meses".

Depois desta entrega: a conferencia em aparelho real dos players (condicao para a PR `dev -> main`, `docs/29` §10.1); a v3b-3 (a linha "Tambem no ar no Inicio: ..." na Revisao e a enquete no pop-up); D2, E2, B2 e C2 (`docs/29` §9.1).

## Design

### Login

Decisao tomada:

- a tela de login sera configuravel pelo produtor no CMS futuro.
- os modelos iniciais sao: dividido com visual a direita, dividido com visual a esquerda, formulario central translucido sobre imagem e formulario lateral translucido sobre imagem.
- o formulario deve permitir superficie configuravel: transparente, borda sutil ou painel.
- a configuracao deve ser persistida no backend quando a tela de login entrar no escopo administrativo.
- a tela de login nao deve virar vitrine publica nem checkout; suporte e links legais ficam discretos.
- a autenticacao real usa Supabase Auth, com email/senha, OAuth e recuperacao de senha.

Decisao tomada (2026-10-11, rodada Area de membros; detalhes em `docs/17`, "Registro da rodada Area de membros", e formato em `docs/05`):

- o login e editado em Area de membros > Login no admin novo e gravado em `platform_settings.loginPage` (JSON versao 1), sem tabela nova; `login_page_settings` continua como desenho futuro;
- o produtor escolhe um dos quatro modelos prontos ("Formulario a esquerda", "Imagem a esquerda", "Central sobre a imagem", "Lateral sobre a imagem") e edita so o que o modelo usa: imagem lateral ou de fundo, frase da imagem, tom do formulario, titulo e texto, botao do Google e a linha de ajuda;
- a "superficie configuravel" virou o tom do formulario: Escuro, Translucido ou Claro (transparente/borda/painel nao foram implementados); posicao do formulario segue o modelo;
- a logo do login e a logo da Marca; no tom Claro aparece o nome em texto;
- a linha "Ainda nao tem acesso? Fale com o suporte" so aparece com link `https://` ou e-mail;
- `?template=` no endereco do `/login` deixou de valer; a previa dos modelos fica no admin, desenhada com o proprio componente do login;
- Apple, links de rodape e rotulos de e-mail/senha editaveis ficam fora desta rodada.

### CMS/Admin

Nota (2026-10-11, rodada Area de membros): a area Area de membros do admin novo tem as abas Vitrine, Destaque, Modulos, Login e Marca, todas gravando de verdade. A fileira de modulos de um curso na home e uma fileira da Vitrine (o tipo "Destaque de um produto" virou "Fileira de modulos"); `content_page_settings.homeModuleSection` ficou so como espelho para o admin antigo. "Como abre" e a capa de cada modulo tambem se editam no admin novo. Cada chave de `platform_settings` tem versao (`updated_at`): duas telas mexendo na mesma chave dao 409 em vez de uma apagar a outra, inclusive a Vitrine do admin antigo. Sem migracao nova. Registro completo em `docs/17` (2.10).

Nota (2026-10-10, fase 1 do admin novo): decisoes da rodada registradas em `docs/17` (secao 2.10, "Registro da fase 1"): "Oculto por enquanto" vira a coluna `content_items.listing` (nao chave de JSON); excluir modulo ou aula no admin novo marca `status = 'deleted'` com Desfazer (o legado ainda apaga de verdade); o painel da aula abre por `?aula=<id>` na aba Conteudo do produto; a Comunidade tem uma aba unica Aulas no lugar de "Avaliacoes" e "Aulas com mais duvidas"; o deploy pode sair antes das migracoes 202610110010-0020, e as telas novas mostram um aviso ate elas serem aplicadas.

Nota (2026-10-10): `docs/17-admin-produtor-redesign.md` propoe a reconstrucao completa da area do produtor (sidebar de 6 areas, produto como entidade central, dois estados, modulo de Comunicacao, player multi-provedor). Quando o produtor aprovar as decisoes D1-D13 daquele documento, as decisoes abaixo sobre sidebar, catalogo em modal, construtor em passos e capa 720x1040 ficam substituidas.

Decisao tomada:

- conectar o CMS em `/admin` a uma camada server-side persistida somente em Supabase Postgres/RLS, sem fallback local ou dados sinteticos de runtime.
- o design do CMS segue a linha escura, densa e operacional da referencia Netflix-style Ad Manager enviada no Figma, sem copiar marca, textos ou assets proprietarios.
- o CMS deve controlar catalogo, personalizacao, home, formacoes, cursos avulsos, mentorias, webinarios, produtos genericos, cursos internos de formacoes, bootcamps, modulos, aulas, materiais, turmas e alunos.
- a area `Personalizacao` aparece na sidebar principal do CRM, abre primeiro uma lista de destinos editaveis (`Vitrine`, `Pagina de login`, `Pagina de produtos` e produtos/cursos) e so depois abre o editor visual do item escolhido.
- ao personalizar a vitrine/home, o produtor deve ver uma representacao fiel da home real do aluno em modo editor, com controles editaveis para banner, textos, cards/secoes, ordem, origem dos conteudos e visibilidade sobre a propria pagina.
- a vitrine/home em modo editor deve consumir as mesmas linhas e componentes da home publicada, preservando card horizontal de `Continue assistindo`, thumbnails/resume frames de aulas, cards verticais e secoes de modulos sem inventar textos ou formatos que nao existem na pagina final.
- a personalizacao altera apresentacao e composicao visual, mas a liberacao final continua dependendo de entitlements internos, regras de entrega e visibilidade por aluno.
- a primeira etapa de criacao do CMS cria um item educacional/produto: formacao, curso, mentoria, webinario, produto ou bootcamp. Dentro dele, o produtor monta trilhas/modulos e aulas.
- cada item educacional pode ter capa, descricao, modelo de acesso `closed` ou `free`, limite de estudantes ilimitado ou numerico, link externo de compra e comportamento do link em mesma aba ou nova aba.
- o cadastro principal do Catalogo funciona como um construtor em passos: configuracao inicial, modulos e aulas. O produtor pode salvar apenas a configuracao inicial e completar a estrutura depois.
- todo fluxo CRUD do Catalogo permanece no modal central sobre a listagem. Novo item, novo curso, modulo e aula nao devem abrir como pagina separada nem substituir a tela inteira do catalogo; catalogo, modulos e aulas podem ser reordenados por comandos de mover, persistindo a ordem em `sort_order`; modulos e aulas podem ser excluidos individualmente com confirmacao explicita.
- a exclusao de modulo ou aula e fisica no Supabase: dependencias relacionais sao removidas por cascata, favoritos e referencias de progresso sao limpos por triggers na mesma transacao e eventos comportamentais historicos permanecem append-only.
- a capa vertical enviada pelo produtor para cards deve usar 720 x 1040 px nesta fase, alinhada ao formato do curso Clones Perfeito 2.0 e aos cards verticais atuais.
- a hero opcional da pagina propria de curso/produto usa 1920 x 720 px e fica salva em `content_page_settings.hero`, separada da capa vertical do card.
- itens bloqueados por compra aparecem na vitrine e, ao clicar no card, abrem o modal de detalhes. O modal mostra o CTA de compra externa configurado, sem checkout interno.
- regras de liberacao pertencem ao item editado, podendo ser configuradas em formacao, curso, mentoria, webinario, produto, modulo, aula ou material. Elas precisam cobrir pelo menos: liberacao imediata, agendamento por data/hora, depois de tantas horas ou dias da inscricao/entitlement do aluno, depois da compra/entitlement, aula anterior concluida, percentual assistido, avaliacao enviada, comentario enviado e tarefa concluida.
- quando uma regra de entrega bloqueia modulo ou aula, a area do aluno deve mostrar overlay com cadeado e mensagem de liberacao no card/thumbnail. A data deve ser calculada por aluno quando houver inscricao/entitlement real.
- no localhost/admin, a area de membros tem modo de preview por query string: sessao atual, produtor/admin, aluno com acesso e aluno sem acesso. Aluno com acesso remove bloqueios de compra/entitlement, mas regras de data ou drip continuam bloqueando. Aluno sem acesso mostra a vitrine bloqueada e nao preenche `Minhas compras`.
- aulas cadastradas pelo CMS precisam incluir descricao, duracao, thumbnail e configuracao de player. Os provedores iniciais sao YouTube, Vimeo, Bunny Stream, Mux, URL propria/player proprio e codigo embed. A plataforma armazena referencia/configuracao do video, nao o arquivo de video no servidor da aplicacao.
- a sidebar principal do CMS deve ser enxuta: Visao geral, Alunos, Catalogo, Estrutura e Personalizacao. Liberação e acessos nao sao areas soltas no menu principal.
- entitlements continuam sendo a fonte de verdade de acesso; eventos de Hotmart, Ticto, TikTok ou outros provedores sao entradas externas auditaveis, nao autorizacao direta.
- cadastro manual de aluno oferece convite por email como fluxo padrao e senha temporaria como alternativa; senha temporaria marca `must_change_password = true` no Supabase Auth e obriga troca em `/alterar-senha`.
- o acesso ao CMS e protegido por papel/permissao administrativa em `admin_roles`.
- a area de membros e o CRM/backoffice sao experiencias separadas: `/` e a home do produto final do aluno; `/admin` e a home do CRM. Logos dentro da area de membros voltam para `/`; logos dentro do CRM voltam para `/admin`.
- usuarios admin/produtor devem ter um atalho da sidebar da area de membros para o CRM, e o CRM deve ter um atalho visivel para abrir a area de membros e conferir a experiencia final do aluno.

### Fundo

Decisao tomada:

- o fundo base da area de membros deve usar `#141414`, alinhado ao fundo da Netflix, para melhorar a leitura dos cards em hover e evitar que paineis escuros se confundam com preto absoluto.

### Cards

Decisao tomada:

- `Continue assistindo` usa thumbnails horizontais com barra de progresso.
- no hover de `Continue assistindo`, o card pode mostrar um play discreto no centro da thumbnail, mas nao deve esconder titulo, contexto, aula ou percentual assistido.
- `Continue assistindo` nao deve ter CTA grande nem botao de detalhes/seta para baixo; a acao e continuar a aula.
- `Continue assistindo` deve nascer de progresso real de aula, salvando segundos e percentual assistidos por usuario.
- a thumbnail da playlist so mostra `Assistindo...` depois que o aluno clicar no player/botao de reproduzir na sessao atual.
- retomada de aula deve posicionar no ponto salvo sem autoplay; avaliacao fica liberada permanentemente para a aula depois que o maior percentual assistido chega a 30%, mesmo que o aluno volte a posicao atual do video.
- fileiras configuraveis da home nao aparecem para o aluno quando ficam sem itens depois de aplicar acesso, progresso e regras de liberacao. Isso vale para secoes futuras como `Em breve`.
- o CMS deve oferecer uma opcao para exibir na home os modulos de um curso especifico. Essa secao usa uma capa vertical reduzida do curso à esquerda, mantendo proporcao da capa principal, e deixa à direita o rotulo pequeno como `Cursos Online`, titulo e botao abaixo do titulo.
- quando o aluno tem acesso, o botao da capa reduzida e `Acessar` e leva para a pagina do curso. Quando nao tem acesso, o botao e `Comprar` e pode abrir modal ou link externo de compra, em mesma aba ou nova aba, conforme configuracao do CMS.
- clicar diretamente em um card de modulo dessa secao leva para a pagina de aula/playlist do modulo, com os modulos listados na sidebar direita, quando o aluno tem acesso. O card de modulo nao exibe botao proprio; o hover mostra titulo, metadado curto e progresso sobre o overlay. Sem acesso ao curso, clicar em modulo abre o modal de detalhes do curso por padrao.
- os cards dos modulos nessa secao usam tamanho intermediario: menores que cards principais de cursos/formacoes/bootcamps e maiores que os cards internos da pagina do curso.
- a secao de modulos de curso escolhido continua respeitando entitlement como fonte de verdade; o dado de pagamento externo nao libera a secao diretamente.
- demais fileiras usam cards verticais exibidos em 398 x 574.88 no desktop.
- as imagens de capa enviadas para esses cards devem ter 720 x 1040 px, mantendo a mesma proporcao usada no card.
- capas devem ser tratadas como posters premium: arte e titulo forte; informacoes detalhadas ficam em metadata, modal e pagina propria do conteudo.
- cards verticais podem exibir a logo horizontal completa oficial da Bunker707 no canto superior esquerdo apenas no hover, em tamanho discreto.
- cards verticais aparecem somente como capa no estado normal; no hover, os cards da home saltam mais para frente com escala maior, leve elevacao, transicao suave, cantos arredondados preservados, imagem escurecida e informacoes/acoes dentro do proprio card.
- o hover dos cards verticais usa degrade escuro de baixo para cima, bem forte na area das informacoes e suave no topo, priorizando legibilidade sobre capas com muito contraste ou texto na arte.
- o hover dos cards verticais deve ter apenas titulo, descricao curta, acao principal, botao de salvar/favoritar quando o aluno tiver acesso, botao de detalhes e, quando ha progresso, um anel de progresso no canto superior direito (diferente da barra dos modulos, 14/10/2026); status, duracao, quantidade de aulas e tipo ficam no modal/pagina propria.
- professor, foto do professor, Instagram e informacoes complementares nao aparecem no hover dos cards verticais; ficam no modal e/ou na pagina propria do conteudo.
- qualquer elemento com hover interativo deve usar cursor de mao/pointer.
- clicar no card ou em `Acessar` leva para a pagina propria do curso/formacao/bootcamp; clicar na seta para baixo abre o modal de detalhes.
- cards verticais sem compra/entitlement ativo devem ficar preferencialmente em uma fileira de `Vitrine` ou outra fileira configurada para oferta, com capa em preto e branco no estado normal, cadeado preto sem caixa/moldura, sem texto no topo; no hover a capa volta a ter cor, o cadeado permanece visivel, e o card exibe somente titulo, descricao curta e botao verde solido `Comprar`, largo e com texto branco, sem botao de salvar/favoritar.
- `Minhas compras` substitui a separacao inicial entre `Minhas formacoes`, `Meus cursos avulsos` e `Meus bootcamps`; ela agrupa todos os produtos com entitlement ativo do aluno.
- `Minhas compras` tambem substitui `Meu Conteudo` como item principal da sidebar. `Formacoes` nao deve aparecer como item principal no MVP; deve ser filtro/tipo dentro de `Minhas compras`.
- `Produtos a venda`/`Vitrine` e configuravel no dashboard, mas a resolucao por aluno remove qualquer produto que ele ja tenha comprado ou possa acessar.
- fileiras configuraveis devem poder ter regra de visibilidade: apenas alunos/compradores, apenas nao compradores/visitantes ou todos.
- uma fileira `Em breve` pode mostrar proximos cursos, formacoes, bootcamps, novidades e listas de espera.
- a vitrine mostra apenas produtos vendaveis: formacoes, bootcamps e cursos avulsos.
- uma formacao e sempre um produto vendavel proprio; ao comprar a formacao, o aluno recebe acesso a todos os cursos internos dela.
- cursos internos de uma formacao nunca devem aparecer como produto separado na vitrine e nunca devem ser vendidos separadamente.
- cursos internos de uma formacao aparecem somente dentro do modal ou pagina da formacao.
- setas dos carrosseis fazem scroll horizontal suave e ficam desativadas quando nao houver mais conteudo para navegar naquela direcao.
- carrosseis de cards verticais devem ter respiro vertical interno suficiente para o hover ampliado nao ser cortado pelo container de scroll horizontal.
- cards internos de cursos e modulos podem usar acao explicita em botao ou acao implicita pelo clique no card, conforme configuracao futura do CMS.
- cursos, bootcamps, mentorias, webinarios e produtos com aulas podem usar dois modos configuraveis no CMS: `module_cards`, em que o card do curso abre uma pagina com cards de modulos, e `lesson_playlist`, exibido para o produtor como `Card unico`, em que o card do curso abre direto a pagina de aula com os modulos na playlist lateral.
- a escolha entre esses dois modos deve ser um switch explicito no CMS; falta de imagem em um modulo nao deve mudar a navegacao, porque alguns modulos podem ter capa e outros nao.
- decisao atual Bunker707: cards de modulos de cursos avulsos ficam sem botao retangular `Acessar`; o card inteiro e clicavel, com hover, progresso e metadados dentro do poster.
- decisao atual Bunker707: cards de cursos internos dentro de formacoes tambem usam acao implicita e levam direto para a pagina de aula/playlist, sem etapa intermediaria de cards de modulos.
- decisao atual Bunker707: cursos internos dentro de formacoes usam o mesmo padrao de poster vertical dos cards de modulos, mas sem botao `Acessar` e sem barra de progresso no card.
- o CMS futuro pode permitir tags/selo por card, como `Curso`, `Modulo`, `Bonus`, `Projeto` ou texto definido pelo produtor, para diferenciar niveis sem exigir um componente visual diferente.

### Modal de detalhes

Decisao tomada:

- o modal de detalhes deve ser inspirado no modelo da Netflix, mas adaptado para educacao e hierarquia de conteudo.
- formacoes mostram cursos internos da formacao, em cards, com expansao para ver mais.
- cursos internos dentro de formacoes podem abrir pagina propria de modulos ou direto o formato de aula/playlist, conforme configuracao. No caso atual da Bunker707, abrem direto a pagina de aula/playlist.
- cursos avulsos mostram modulos, em cards, com expansao para ver mais modulos. No caso atual da Bunker707, esses cards nao exibem botao retangular de acesso.
- bootcamps mostram modulos, em cards, com expansao para ver mais modulos.
- secoes do modal com cards escondidos devem mostrar um preview recortado dos proximos cards com degrade e botao circular de expansao, para indicar visualmente que ha mais conteudo abaixo.
- aulas aparecem em formato de lista detalhada com thumbnail, titulo, descricao e duracao quando o aluno abre ou expande um modulo.
- no desktop, ao abrir um modulo, o modulo selecionado ocupa a primeira posicao visual à esquerda e a lista de aulas aparece à direita; ao ocultar, os cards voltam ao grid normal.
- quando o modulo aberto vier de uma area expandida/escondida, o modal deve rolar suavemente ate o foco do modulo selecionado.
- no mobile, o modulo selecionado e a lista de aulas podem ficar empilhados em coluna unica.
- abrir aulas, trocar o modulo selecionado e ocultar aulas devem ter animacoes suaves de reorganizacao, sem troca seca de layout.
- todos os cards verticais internos do modal, inclusive em formacoes bloqueadas, devem compartilhar o mesmo hover: o card nao move, nao cresce e nao altera sombra; apenas a imagem interna recebe zoom leve e escurecimento discreto, com transicao lenta e suave.
- hovers de cards verticais nao devem revelar filetes claros, bordas brancas acidentais ou linhas de subpixel na base do card.
- a area de episodios da Netflix nao deve ser usada diretamente em formacoes e cursos.
- o modal nao deve ter `Conteudos relacionados` nesta fase; deve manter apenas a hierarquia principal do conteudo e um bloco `Sobre` no final.
- o modal deve ser renderizado acima de todos os elementos da aplicacao, inclusive header.
- o modal nao deve ter scroll interno no proprio painel; a camada externa do modal rola pelo viewport, com barra visivel no canto da tela, enquanto a pagina de fundo fica bloqueada.
- o wheel/scroll deve mover o modal mesmo quando o mouse estiver sobre a area escura fora do painel.
- a abertura do modal deve ser suave, com fade no backdrop, leve escala/movimento no painel e micro transicao de fechamento.
- cards de cursos internos dentro de uma formacao nao devem exibir tags extras como `Incluso na formacao`, `Curso pratico`, `Curso base` ou similares.

### Footer

Decisao tomada:

- a home da area de membros deve ter um footer discreto com marca, suporte e documentos, sem linguagem de vitrine publica.
- a logo oficial horizontal da Bunker707 deve substituir o monograma temporario no header, sidebar e footer, usando o asset `public/brand/logo-bunker.png`.
- a logo oficial deve funcionar como link para voltar para a home em todos os locais onde aparecer.

### Hero

Decisao tomada:

- primeira linha de cards deve sobrepor o fim da hero.
- hero e configuravel pela area interna da escola e pode ser apenas visual/editorial, sem obrigatoriedade de botoes, progresso ou acao de assistir.
- degrades coloridos/editoriais da hero nao devem ser fixos no frontend; o padrao da home e neutro/escuro e cores/intensidade devem ser configuraveis futuramente no dashboard da escola.
- consumo principal acontece nos cards e fileiras, nao necessariamente na hero.
- na home, o header fica transparente sobre a hero com degrade sutil; apos scroll, assume fundo preto solido por transicao suave de opacidade/altura, revelando o preto de cima para baixo, sem borda inferior e sem piscadas.
- os controles do header nao devem trocar de estado visual durante o scroll; apenas o fundo do header transiciona.
- (2026-10-11) o topo da home e editado em Area de membros > Destaque: imagem ou video (so link https, com capa obrigatoria), selo, titulo e descricao opcionais e um botao opcional (botao primario claro) que leva a um produto, a uma pagina da area ou a um link externo, na mesma aba ou em nova aba. Continua valendo que a hero pode ser so visual. Quem prefere menos movimento ve a capa parada. A Marca ficou so com a logo.

### Sidebar

Decisao tomada:

- menu hamburguer abre sidebar.
- sidebar abre e fecha com transicao suave lateral e backdrop em fade.
- (2026-10-11) itens em dois grupos, `Estudar` e `Conta e ajuda`, vindos de `src/lib/member-navigation.ts`; todo item leva a uma pagina real (sem item cinza ou desabilitado). Teclado completo: foco preso, `Esc` fecha e devolve o foco ao botao do menu.

## Dados

### Playlists do YouTube

Decisao tomada:

- cada playlist representa um curso;
- o importador e uma funcionalidade nativa do produto-base, nao uma customizacao de uma implantacao;
- nomenclatura canonica: `C01 - Nome do curso | M01 - Nome do modulo | A01 - Nome da aula`;
- o formato anterior `M01 - Nome do modulo | A01 - Nome da aula` permanece compativel;
- o formato compacto `M01 A01 - Nome da aula` tambem e aceito e gera nome generico para o modulo;
- o produtor escolhe organizacao automatica ou manual; no modo manual define cada modulo pelo video inicial e final;
- titulos fora do padrao entram em `Conteudo do curso` no modo automatico e podem ser reorganizados sem renomear os videos pelo modo manual;
- todo video precisa pertencer exatamente a um modulo antes da importacao manual;
- `lesson_playlist` e o modo padrao, com `module_cards` opcional;
- capa e opcional e nao recebe fallback automatico;
- toda importacao e rascunho e nao concede acesso.

### Fonte da verdade de acesso

Decisao tomada:

- entitlement interno da Bunker707.

### Venda

Decisao tomada:

- venda fora da plataforma.

### Checkout interno

Decisao tomada:

- nao havera checkout interno no MVP.
