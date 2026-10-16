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
- a area do aluno so deve receber comunidade quando categorias, topicos, notificacoes e moderacao estiverem persistidos.

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
- o topo da area do aluno nao mostra sino nem trofeu ate existirem notificacoes e conquistas reais; o avatar abre o menu da conta;
- Suporte sem formulario enquanto nao existir caixa de entrada no admin para responder; a pagina mostra os canais configurados e perguntas frequentes;
- Perfil so leitura nesta fase; editar nome/telefone/foto depende de unificar as tres origens do nome (cadastro do aluno, `profiles` e conta);
- materiais de aula vem da tabela `lesson_materials` (migracao `202610130001`); a lista fixa de exemplo saiu. O cadastro de materiais no admin e a proxima etapa.

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
