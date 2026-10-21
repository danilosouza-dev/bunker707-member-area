# Backlog Inicial

## Produto

- Nome visual final definido para a interface: Bunker707.
- Logotipo oficial horizontal aplicado como asset inicial em `public/brand/logo-bunker.png`.
- Definir paleta visual.
- Definir capas iniciais de formacoes, cursos avulsos e bootcamps.
- Definir categorias da home.
- Definir nomenclatura: formacao, curso avulso, mentoria, webinario, produto, curso interno, bootcamp, modulo, aula.

## UX/UI

- Wireframe da home.
- Wireframe da pagina de login configuravel.
- Wireframe da sidebar.
- Wireframe do card vertical.
- Wireframe da pagina da aula.
- Wireframe de Minhas compras.
- Wireframe do perfil/acessos.
- Estado vazio da busca.
- Estado bloqueado de conteudo.
- Estado de progresso concluido.

## Frontend

- Criar app Next.js.
- Configurar Tailwind.
- Configurar shadcn/ui.
- Criar pagina de login com templates configuraveis.
- Criar layout autenticado.
- Criar componentes: Header, Sidebar, Hero, ContentRow, VerticalCard.
- Criar acao visual e persistida de salvar/favoritar em cards, modais e pagina de aula.
- Criar paginas: Home, Minhas compras, Favoritos, Curso, Aula, Perfil, Suporte.
- Criar seed inicial de dados.
- Testar responsividade.
- Criar rota `/admin` com CMS UI-first.
- Criar dashboard administrativo com visao geral, catalogo, estrutura, personalizacao, alunos/turmas e acessos.
- Criar area `Personalizacao` no CRM com lista inicial de destinos editaveis e, apos clique em `Personalizar`, previa fiel da experiencia do aluno para login, pagina de produtos, paginas dos cursos, estrutura interna e vitrine/home.
- Criar persistencia CRUD do CMS para formacoes, cursos, mentorias, webinarios, produtos, modulos e aulas, incluindo ordenacao e exclusao individual de modulos e aulas com limpeza de referencias.
- Implementado: cadastro do Catalogo em construtor por passos, com configuracao inicial, modulos e aulas no mesmo local.
- Implementado: feedback acessivel de carregamento e persistencia no CRM, com spinner e texto contextual nos controles de curso, modulo, aula e turma, status global de sucesso/erro e bloqueio contra envios duplicados.
- Permitir que o produtor ative, no CMS, uma secao da home com capa pequena do curso e cards menores dos modulos de um curso especifico.
- Permitir upload local da capa vertical do card em 720 x 1040 px e hero opcional em 1920 x 720 px para paginas de cursos/produtos.
- Adicionar no cadastro de aula os campos de descricao, duracao, thumbnail e player: YouTube, Vimeo, Bunny Stream, Mux, URL propria ou codigo embed.
- Criar configuracao de acesso por item: fechado, gratuito, limite de estudantes, link externo de compra e abertura em mesma/nova aba.
- Criar persistencia do CMS para regras de drip/agendamento dentro de formacoes, cursos, mentorias, webinarios, produtos, modulos e aulas, alem de secoes da home e CRM.
- Criar modo de preview local na area de membros para produtor/admin, aluno com acesso e aluno sem acesso.
- Criar CRM UI-first de alunos com lista geral, filtros, detalhe do aluno, cadastro/edicao/remocao local e visao por curso.
- Refinar CRM de alunos com listagem enxuta, engajamento por nivel, produtos alinhados na linha e modal sem scroll duplo.
- Permitir abrir e fechar a sidebar do CMS pelo hamburger, seguindo o padrao da area do aluno.
- Criar suporte a turmas/coortes com conteudos extras por segmento, visiveis apenas para a turma correspondente.
- Criar item `Combos` no CRM para agrupar produtos existentes e definir turma padrao.
- Criar item `Comunidade` na sidebar do CRM como placeholder de fase futura.
- Implementado: item `Moderacao` no CRM filtra comentarios persistidos por produto, tipo, status, denuncia e texto.
- Implementado: cadastro persistido de palavras bloqueadas com mensagem segura para o aluno.
- Criar item `Agentes de IA` no CRM para configurar agentes de comentarios, tutor de aula, assistente geral e chat da home.
- Criar `Configuracoes > Integracoes` no CRM para configurar Hotmart, Ticto, TikTok, Kiwify e Manual sem expor segredos no browser.

## Backend

- Escolher Auth: Supabase Auth definido para o MVP.
- Criar schema inicial.
- Configurar Supabase.
- Criar policies RLS.
- Criar camada de acesso/entitlements.
- Criar APIs de progresso autenticadas.
- Criar modelo de progresso contextual por produto.
- Criar modelo de tarefas praticas: quizzes, desafios e projetos.
- Criar modelo e API autenticada de itens salvos/favoritos.
- Criar APIs de busca.
- Criar suporte simples.
- Criar schema real de combos/produtos internos e mapeamento para entitlements.
- Implementado: API persistida de comentarios, respostas, reacoes e denuncias com validacao de entitlement.
- Implementado: API administrativa de moderacao e palavras bloqueadas com auditoria transacional.
- Implementado: aba `Tutor IA` ao lado de `Comentários` e `Materiais`, com respostas reais baseadas na aula, timestamps clicaveis e estados explicitos quando a transcricao ou o provedor ainda nao estao prontos.
- Criar tabela persistida de configuracoes de integracao.
- Implementado para o tutor de aula: provedores BYOK, transcricoes, chunks, perfis analisados, conversas e mensagens persistidas; cada aluno mantem varios chats independentes por aula e retoma qualquer historico anterior.
- Implementado para a IA Diretor: chat global separado do Tutor, catalogo autorizado por aluno, recuperacao lexical de aulas/assuntos, referencias internas verificadas e historico com varios chats, renomeacao e exclusao logica.
- Implementado para aulas do YouTube: Modo TV proprio com `/tv`, codigo/QR temporario de uso unico, token armazenado somente como hash, controle remoto e sincronizacao de progresso pelo Supabase. Cast/AirPlay nativos e outros providers ficam para evolucao.

## Video

- Escolher Mux, Bunny Stream ou Cloudflare Stream.
- Definir como armazenar video_asset_id.
- Definir estrategia de thumbnails.
- Definir token/playback seguro.

## Integracoes

- Criar webhook manual de teste.
- Criar webhook Hotmart.
- Criar webhook Ticto.
- Criar webhook TikTok quando a operacao exigir.
- Criar adaptador Kiwify quando essa plataforma entrar no fluxo comercial.
- Mapear vendas externas para produto ou combo interno.
- Criar tabela de eventos brutos.
- Criar job de processamento.
- Criar logs de falhas.

## Analytics

- Definir eventos iniciais.
- Integrar PostHog.
- Integrar Sentry.
- Registrar eventos de progresso.
- Registrar eventos de busca e suporte.

## Conteudo inicial

- Criar formacao principal.
- Criar curso avulso inicial.
- Criar modulos.
- Criar aulas persistidas.
- Criar materiais persistidos.

## Fase futura

- Comunidade.
- Mural de membros.
- Conversas.
- Ranking.
- Certificados.
- Implementado antecipadamente: IA da aula; agentes gerais e de comentarios continuam como evolucoes separadas.
- Implementado antecipadamente: notificacoes no sino e pop-ups na home (Comunicacao v1, 20/10/2026; secao Entregue abaixo); faixa, card, toast, e-mail, push, WhatsApp e preferencias continuam como evolucoes.
- Dashboard administrativo.
## Entregue — importacao de cursos por playlist

- preview administrativo de playlist do YouTube;
- assistente nativo `Criar curso com YouTube`;
- parser de curso/modulo/aula e avisos de nomenclatura;
- organizacao automatica ou definicao manual de modulos pelo primeiro e ultimo video;
- validacao de cobertura integral, lacunas, sobreposicoes e intervalos vazios;
- escolha entre card unico e cards de modulos;
- capa opcional e card textual sem capa;
- importacao transacional, idempotente e sempre em rascunho;
- testes de contrato e seguranca.

## Entregue — Comunicacao v1: notificacoes e pop-ups (20/10/2026)

Detalhes em `docs/22`.

- tabelas `campaigns`, `notifications` e `campaign_deliveries`, bucket `communication-audio` e retencao de 24 meses (migracao `202610200001`);
- sino do aluno com numero de novas, abas `Todas` e `Não lidas`, lista por dia, marcar como lidas, 90 dias de historico e carregar mais;
- notificacao de aviso com imagem 16:9, audio com forma de onda e velocidade, botao interno ou externo e resposta `Aceitar`/`Recusar`;
- notificacao automatica de resposta e de mencao nos comentarios (aula e Comunidade do admin);
- pop-up so na home, 1 por sessao e 1 a cada 24 h, `Lembrar depois` e `Não mostrar de novo`;
- Comunicacao > Avisos e pop-ups no admin: lista com os numeros do periodo, editor com previa real, imagem, audio enviado ou gravado no navegador, segmento por regras E/OU com contagem ao vivo, enviar agora, agendar, teste para mim, aprovacao acima de 500 alunos, pausar, retomar, encerrar, retirar, duplicar, excluir e relatorio;
- job `comunicacao` no tick de minuto (envio agendado retomavel e recalculo do segmento dos pop-ups);
- testes unitarios, de integracao e de ponta a ponta (`docs/18`).
