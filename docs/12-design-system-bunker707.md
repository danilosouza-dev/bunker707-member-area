# Design system Bunker707

Este documento define a base visual da area de membros Bunker707. A referencia principal e a experiencia Netflix: escura, cinematografica, focada em conteudo, com interface limpa e estados de hover claros. A plataforma nao deve virar uma copia literal de marca, mas deve manter consistencia de comportamento, hierarquia e acabamento.

## Principios

- Conteudo primeiro: imagens, capas, aulas e progresso devem ser mais importantes que molduras decorativas.
- Escuro premium: usar base escura constante, sem variacoes aleatorias de paleta por tela.
- Poucas fontes e pesos: usar uma familia tipografica principal e variar por tamanho/peso, nao por troca de fonte.
- Estados visiveis: todo botao interativo deve ter hover/foco proprio, sem depender de tooltip nativo do navegador.
- Feedback continuo: toda navegacao, salvamento ou mutacao deve reconhecer a acao imediatamente e manter um estado visivel ate a interface confirmar o resultado.
- Bordas discretas: bordas normais devem ser suaves; hover pode reforcar contraste.
- UI previsivel: abrir modulo nao troca aula; trocar aula exige clique em aula.
- Sem excesso de cards: cards devem representar conteudo, modais ou ferramentas reais, nao envolver secoes inteiras.

## Tipografia

Familia padrao: `Inter`, carregada globalmente em `src/app/layout.tsx`.

Nao introduzir outra fonte sem decisao explicita. O padrao visual deve vir de hierarquia, peso e espacamento.

Escala recomendada:

- Hero/titulo grande: 40-64px, `font-black`, apenas em hero ou titulo editorial.
- Titulo de pagina/conteudo: 28-40px, `font-black`.
- Titulo de painel/lista: 13-16px, `font-semibold` ou `font-bold`.
- Texto de corpo: 14-16px, `font-normal` ou `font-medium`.
- Metadados/labels: 11-13px, `font-medium` ou `font-semibold`.
- Tooltips: 13px, `font-medium`, nunca pesado demais.

Regras:

- `letter-spacing` deve permanecer normal.
- Evitar textos longos em maiusculas; usar uppercase apenas para labels pequenos.
- Dentro de paineis compactos, evitar `font-black` quando `font-semibold` resolve.

## Cores

Tokens atuais:

```css
--background: #141414;
--foreground: #f7f7f4;
--muted: #a8a8a2;
--panel: #171717;
--panel-strong: #202020;
--border: rgba(255, 255, 255, 0.1);
--accent: #e50914;
--accent-warm: #ff7a1a;
```

Uso:

- Fundo principal: `#141414`.
- Paineis: `#171717`, `#181818`, `#202020`.
- Hover de painel: `#242424` ou branco com baixa opacidade.
- Texto principal: branco/quase branco.
- Texto secundario: zinc 300-500.
- Destaque Bunker/Netflix-like: `#e50914`.
- Sucesso/concluido: emerald 600/500.
- Avisos/bloqueios: amber 400/500.

Evitar:

- Paletas novas por secao.
- Gradientes coloridos decorativos.
- Roxo/azul dominante, bege dominante ou laranja/marrom dominante.

## Iconografia

Biblioteca padrao: `lucide-react`.

Motivos:

- Mantem o mesmo estilo visual de traco em toda a plataforma.
- Tem boa variedade de icones para acoes, navegacao, conteudo, aulas e estados.
- Usa SVG inline e imports por componente.
- E tree-shakable, entao apenas os icones importados entram no bundle final.
- Tem suporte bom a TypeScript e permite controlar tamanho, cor e espessura via props/classes.

Regras:

- Nao misturar `lucide-react` com outras bibliotecas de icones sem decisao explicita.
- Preferir icones Lucide existentes a SVGs manuais para botoes e controles comuns.
- Usar tamanho padrao de 16-20px para controles compactos e 20-24px para botoes circulares.
- Manter `strokeWidth` visual entre 2.2 e 2.8 em botoes de acao Netflix-like.
- Usar preenchimento (`fill-current`) apenas quando o padrao visual exigir, como play solido.
- Todo icone sem texto visivel precisa de `aria-label` no botao ou texto acessivel equivalente.

## Botoes

### Feedback de navegacao e operacoes

- Toda troca de pagina interna deve exibir feedback imediato, inclusive quando a rota ja estiver em cache ou tiver sido pre-carregada.
- O estado visual de navegacao usa somente um spinner circular vermelho, ancorado de forma estavel no centro do viewport sobre uma camada preta mais escura, desfocada e sem dessaturar a pagina, no estilo Netflix. Apenas um spinner pode ficar visivel durante a transicao, mesmo quando o fallback do App Router estiver montado, e ele permanece ate a nova rota ser renderizada.
- Links, cards com navegacao programatica, redirecionamentos e os comandos voltar/avancar do navegador devem seguir o mesmo padrao global.
- Enquanto a troca esta pendente, cliques repetidos ficam bloqueados. Se a rota exceder o tempo de seguranca, o bloqueio e liberado e uma mensagem de demora e anunciada.
- O texto contextual, como `Abrindo Favoritos...`, fica disponivel para leitores de tela sem adicionar caixas ou avisos visuais. O status deve usar `role="status"`, `aria-live`, `aria-busy` e respeitar `prefers-reduced-motion`.
- Operacoes de criar, editar, publicar, excluir, conectar ou salvar devem manter feedback local contextual ate sucesso ou erro; o indicador global de rota nao substitui o estado da operacao.

### Botao primario claro

Uso: assistir, concluir, acoes centrais. Tambem e o botao opcional do destaque (topo) da home: altura 48 px, icone `ArrowRight` depois do texto, foco visivel e alvo de pelo menos 44 px no celular.

- Fundo branco, texto preto.
- Raio: 6-8px.
- Peso: `font-extrabold`.
- Hover: cinza claro ou brilho leve.

### Botao concluido

Uso: aula concluida.

- Fundo emerald.
- Texto branco.
- Deve alternar para estado nao concluido quando clicado novamente.

### Botoes circulares Netflix-like

Uso: materiais, TV, minha lista, avaliar, voltar sobre video.

- Formato circular.
- Na pagina de aula, minha lista/salvar usa icone de bookmark/salvar, nao o sinal de `+`.
- Borda normal: 1px branco com baixa opacidade.
- Fundo normal: cinza/preto translucido.
- Hover: fundo cinza mais claro e borda branca mais forte.
- Tooltip proprio, nunca `title` nativo.

Tooltip:

- Caixa branca/cinza clara.
- Texto escuro.
- Fonte 13px `font-medium`.
- Seta triangular inferior.
- Deve ficar acima de tudo e nao ser cortado pelo player.

## Player e pagina de aula

- Breadcrumb fica acima do player.
- Player fica alinhado com o topo da playlist lateral.
- Botao de voltar fica sobreposto no canto superior esquerdo do player.
- A camada de video pode ter `overflow-hidden` para preservar cantos arredondados, mas a camada de controles deve permitir tooltip acima do player.
- A barra do player nao usa fundo ou degrade continuo: somente icones, textos e sombras leves ficam sobre o video.
- A timeline tem trilho de 3px, progresso e thumb solido em `--accent`, e fica acima da linha de botoes.
- Ordem à esquerda: play/pausa, retroceder 10 segundos, avancar 10 segundos, volume, slider quando houver espaco e tempo atual/total. Ordem à direita: legenda, engrenagem de configuracoes e tela cheia; nao adicionar outras acoes nesse grupo. A engrenagem reune velocidade e resolucao para manter a barra compacta, usando primeiro nivel com duas linhas iconograficas e submenus verticais separados com voltar, no padrao do YouTube. O painel usa preto translucido com blur, chevrons finos, icones leves e texto regular de 14 px; valores atuais ficam discretos à direita, sem peso excessivo.
- A engrenagem usa o icone Lucide de engrenagem e exibe um selo pequeno da qualidade efetiva. No modo automatico, `AUTO` aparece somente enquanto a qualidade ainda nao foi informada; depois o selo acompanha `HD`, `2K`, `4K` ou `HD+` quando o provider retornar apenas alta resolucao generica. O menu mostra todas as resolucoes reais com dimensoes no desktop, deixa `Automático` como ultima opcao e nao usa scroll interno nem paragrafo explicativo. Em telas estreitas, usa tres colunas e pode ocultar apenas as dimensoes auxiliares para manter todas as resolucoes visiveis.
- Legenda usa o icone `CC`; tela cheia usa o icone de quatro cantos. Todos os botoes preservam nome acessivel, foco visivel e area clicavel de 40-44px conforme a largura.
- Controles de aula anterior/proxima nao ficam no topo da pagina; futuramente podem existir dentro do player.
- Abaixo do player, nao colocar chips de duracao ou contagem antes do titulo; o titulo da aula deve alinhar visualmente com os botoes de acao.

## Playlist lateral da aula

Header:

- Deve mostrar a capa vertical do curso/produto no lado esquerdo.
- A capa deve ocupar a altura do bloco de titulo/progresso para funcionar como referencia visual real, nao como miniatura decorativa pequena.
- Nome do curso usa Inter, `font-semibold`, com ate tres linhas para preservar leitura e respiro.
- Progresso fica ancorado na parte inferior do bloco da capa vertical; o espaco entre titulo e progresso e aceitavel quando a capa exigir altura.
- Nao usar label redundante como `Lista de aulas` quando o contexto ja esta claro.

Comportamento:

- Abrir/fechar modulo nao troca aula em reproducao.
- Aula ativa muda somente quando o aluno clica em uma aula.
- A playlist tem scroll interno proprio.
- Cabecalho/progresso ficam fora da area rolavel.
- Ultimo modulo e ultima aula devem ser totalmente acessiveis.

## Reacoes da aula

Substituem escala de cinco estrelas.

Opcoes:

- `Nao gostei`: polegar para baixo, contorno vermelho quando selecionado.
- `Gostei`: polegar para cima, contorno verde quando selecionado.
- `Amei`: coracao, contorno vermelho de destaque quando selecionado.

Comportamento:

- Botao principal abre pilula escura com tres opcoes.
- Cada opcao tem tooltip branco individual.
- Depois da selecao, a pilula fecha para nao conflitar com outros tooltips.
- A reacao pode liberar materiais que exigem avaliacao.

## Comentarios da aula

- A lista de comentarios deve parecer conversa/thread, nao uma pilha de cards.
- Cada comentario usa avatar circular ou foto de perfil, nome, tempo relativo e texto em fluxo livre, com separadores discretos entre itens.
- Avatares usam cor solida ou foto, sem degrade decorativo; icones/emoji devem preencher bem o circulo, e o indicador de presenca fica na intersecao inferior direita do avatar, com borda na cor do fundo da pagina e sem brilho/esfumacado. Online usa ponto verde; offline usa ponto cinza com centro na cor do fundo.
- Toda pessoa tem etiqueta de funcao ao lado do nome, com `MemberRoleBadge`: `Professor` (vermelho, chapeu de formatura), `Moderador` (neutro, escudo) e `Aluno` (contorno discreto). Vale para comentario e resposta.
- Respostas aparecem indentadas dentro do comentario principal, com recuo e divisor vertical discreto para deixar clara a hierarquia da conversa.
- Todo comentario e resposta deve ter acao `Responder`; ao clicar, o composer entra em modo resposta e preenche automaticamente `@nickname` da pessoa respondida.
- O composer em modo resposta deve mostrar uma faixa de contexto com a mencao ativa e opcao de cancelar antes do envio.
- Mencoes e respostas devem alimentar notificacoes futuras no sininho da plataforma para a pessoa mencionada ou dona do comentario respondido.
- Reacoes de comentario usam chips compactos com emoji/curtida e contador; o estado selecionado reforca a borda/acento sem dominar a leitura.
- O menu `Reagir` deve oferecer uma lista padrao ampla de emojis, como curtir, fogo, insight, coracao, aplausos, risada, surpresa, foguete, de olho e util.
- O menu de tres pontos deve oferecer denuncia de comentario para moderacao.
- Menus de reacao e denuncia devem fechar ao clicar fora deles.
- O composer de novo comentario deve ser diferente dos comentarios publicados: caixa propria de digitacao, textarea evidente e botao de envio alinhado dentro do bloco.
- O composer fica no topo da aba (`src/components/lesson/lesson-comment-composer.tsx`): cartao proprio com avatar do aluno, campo que cresce ate 240 px, placeholder `Compartilhe uma dúvida ou insight sobre a aula`, faixa `Respondendo a @usuario` com cancelar, contador a partir de 1.800 de 2.000 caracteres, dica de `Ctrl/⌘ + Enter` e botao primario `Publicar`/`Responder` com `Enviando...`. Aula bloqueada: campo desabilitado com cadeado e o motivo.

## Aviso de liberacao da aula

- Sobre o video (`src/components/lesson/lesson-release-overlay.tsx`): cadeado, titulo `Esta aula será liberada`, a data em destaque (`Liberação em 08/01/2026`, `Liberação em 08/01/2026 às 14:00` ou `Liberação hoje às 14:00`) e a linha discreta `Conta a partir da data da sua compra.`. Quando a data passa com a pagina aberta, o titulo vira `Esta aula já foi liberada` e aparece `Atualizar agora`.
- Na playlist e nos cards, o selo curto e ambar: `Liberação em 08/01`, `Hoje às 14:00` ou `Após a aula anterior`; a frase completa vai no nome acessivel.
- Datas sempre no fuso de Sao Paulo, iguais no servidor e no navegador. So o texto com `hoje` depende do relogio e usa `suppressHydrationWarning`.

## Aba Materiais da aula

- Painel `src/components/lesson/lesson-materials-panel.tsx` com linhas `MemberMaterialRow`, em dois grupos: `Disponíveis` e `Para liberar` (motivo em ambar, visivel tambem no celular, e o que fazer para liberar).
- Cabecalho curto com a contagem real; o numero da aba so aparece depois de carregar.
- Estados: esqueleto de 3 linhas, vazio compacto (`Esta aula ainda não tem materiais` / `Quando o professor publicar arquivos de apoio, eles aparecem aqui.`) e erro com `Tentar de novo`.

## Tutor IA da aula

- Cabecalho do painel: icone do Tutor em circulo, `Tutor IA`, apoio `Responde com base nesta aula` e ponto de disponibilidade (verde disponivel, cinza indisponivel); acoes Historico e Novo chat a direita.
- Historico recolhivel: trilho a esquerda no computador (>= 1024 px) e folha sobre o painel no celular. Cada item tem titulo, data relativa e menu de tres pontos (Renomear/Excluir).
- Chat vazio: saudacao curta e quatro sugestoes em grade 2x2, com icone e frase completa; clicar preenche o campo.
- Mensagens: aluno em balao a direita; Tutor sem balao, com avatar, Markdown contido e marcadores `[MM:SS]` como chips clicaveis; `Pensando sobre a aula...` com animacao discreta que respeita menos movimento.
- Composer em pilula: campo que cresce ate 6 linhas, botao circular de enviar, dica de `Enter`/`Shift+Enter`, contador perto do limite de 4.000 caracteres e aviso de indisponivel dentro da pilula.

## Cards

- Cards de conteudo devem ser verticais na home.
- Fileiras de cards verticais da home devem usar gap de 12px entre cards.
- Hover pode ampliar e elevar o card, mantendo cantos arredondados. Na home, o card vertical deve ampliar por escala externa sem zoom interno adicional da imagem.
- Largura dos cards: fluida, fracao da fileira por largura de tela (ver "Estilo escolhido pelo produtor"), como as thumbs de Shorts do YouTube; nenhum card de fileira fixa largura em rem.
- Cards verticais expansivos da home devem crescer para dentro somente quando estiverem nas bordas visíveis do carrossel: o primeiro da esquerda preserva a borda esquerda e expande para a direita; o último da direita preserva a borda direita e expande para a esquerda. Os cards internos mantem escala central normal.
- Texto e botoes do hover (`.home-cover-card-content`) aparecem com a mesma transicao da escala do card, sem atraso (`transition-delay`), e ficam numa camada propria onde ha hover (`will-change`). Com atraso, o Chrome criava a camada do texto no meio da escala e re-rasterizava titulo, descricao e botao varias vezes no fim da animacao: as fontes "piscavam" (medido quadro a quadro em 13/10/2026). Qualquer nova transicao dentro do card deve comecar junto com a escala.
- Quando o hover traz para dentro um card parcialmente visivel em qualquer borda, o card adjacente externo deve deslizar temporariamente para o trecho liberado no canto e sinalizar a continuidade do carrossel: o proximo card na direita e o card anterior na esquerda durante a volta. Ambos retornam às posicoes originais ao encerrar o hover.
- Carrosseis com overflow usam setas grandes diretamente sobre as bordas esquerda/direita dos cards, apoiadas por fades escuros limitados à altura visual das capas e dissolvidos sobre o conteudo; o fade exclui o padding vertical usado pelo hover expansivo e o botao da seta nao cria um bloco quadrado separado. No hover/foco, a faixa inteira escurece e se expande discretamente, enquanto a seta aumenta e se desloca na direcao da navegacao para produzir feedback inequivoco. Nao usar o par de botoes circulares no cabecalho da secao. A direcao sem conteudo restante fica oculta.
- O cabecalho da fileira pode mostrar, alinhado à direita, um indicador de paginas composto por segmentos horizontais pequenos; o segmento ativo usa `zinc-200`, os demais `zinc-600`, e o estado acompanha o scroll real da fileira.
- `Continue assistindo` usa hover proprio de video: superficie estavel, zoom interno minimo na imagem igual aos cards de modulo do modal e play aparente no centro, sem a expansao externa grande dos cards verticais.
- Overlay do hover deve priorizar legibilidade.
- Cards bloqueados na home devem usar badge circular escuro/translucido no canto superior direito, com cadeado branco simples centralizado sobre a capa. O icone deve usar o `Lock` da Lucide, sem preenchimento (`fill`), para evitar efeito de massa branca.
- Evitar mostrar metadados demais no hover; detalhes completos ficam em modal ou pagina propria.
- Cards de cursos internos dentro de formacoes e cards de modulos dentro de cursos podem compartilhar o mesmo poster vertical.
- A diferenca atual e funcional: modulos mostram progresso no hover; cursos internos dentro de formacoes nao mostram barra de progresso nem botao `Acessar`.
- O CMS futuro pode permitir tags/selo por card para indicar `Curso`, `Modulo`, `Bonus`, `Projeto` ou outro texto configurado pelo produtor.

## Base visual das paginas do aluno (aluno v2)

As paginas internas do aluno (Minhas compras, Favoritos, Minha jornada, Continue assistindo, Materiais, Suporte, Perfil), a aba Materiais da aula e a etiqueta de funcao dos comentarios usam as pecas de `src/components/member/ui/`. Elas funcionam no servidor (sem `"use client"` e sem estado proprio); filtros e busca que recebem `onChange` so entram dentro de componente de cliente.

- `MemberPage` + `MemberPageHeader` + `MemberSection` (`member-page.tsx`): respiro lateral de 16 px no celular, 32 px no tablet e 48 px no computador; titulo de pagina 28-40 px `font-black`; rotulo pequeno acima do titulo com icone vermelho; acoes a direita no computador. Larguras `wide` (grades), `default` (listas) e `narrow` (leitura).
- `MemberPosterCard` (`member-poster-card.tsx`): card vertical 2:3 para produtos. A capa fica limpa (etiqueta no canto e progresso na borda inferior); titulo, detalhes e "Continuar..." ficam abaixo da capa. Acao extra (ex.: remover dos favoritos) fica fora do link, no canto superior direito. Grade: `memberPosterGridClassName` (2 colunas no celular ate 6 no computador grande, espaco de 12-16 px).
- `MemberLessonCard` (`member-lesson-card.tsx`): aula em 16:9 com zoom minimo, play no centro no hover, barra de progresso na borda e selo de tempo ("faltam 12min"). Aula bloqueada pela liberacao mostra cadeado e a frase de liberacao, sem play.
- `MemberMaterialRow` (`member-material-row.tsx`): material de apoio em linha (icone pelo tipo, titulo, tipo, tamanho, "Gerado com IA"). Liberado abre em nova aba (`rel="noopener noreferrer"`); bloqueado pela regra do material mostra o motivo em ambar, visivel sem hover, e nao tem link.
- `MemberChip` e `MemberRoleBadge` (`member-chip.tsx`): etiquetas curtas. Tons: neutro, contorno, vermelho (destaque), verde (concluido), ambar (liberacao/bloqueio), branco (tipo sobre a capa). Funcao de quem comenta: `Professor` (vermelho, chapeu de formatura), `Moderador` (neutro, escudo) e `Aluno` (contorno discreto).
- `MemberStat`/`MemberStatGrid`: numeros reais do aluno no topo (2 colunas no celular, 4 no computador). Sem dado real, o numero nao aparece.
- `MemberFilterPills` (filtros na mesma tela, `aria-pressed`, rolam na horizontal no celular), `MemberTabNav` (abas que trocam o endereco, sublinhado vermelho, `aria-current`) e `MemberSearchField` (busca com limpar e `Esc`).
- `MemberEmptyState`: estado vazio honesto (o que falta e o proximo passo real), borda tracejada discreta; variante compacta para abas.
- `MemberButton`/`MemberButtonLink`/`memberButtonClassName`: primario claro (branco, texto preto), secundario translucido, fantasma, vermelho da marca e perigo; alturas 36, 40 e 48 px.
- `MemberAvatar`: foto ou iniciais sobre cor solida derivada do nome.
- `MemberProgressBar`: trilho fino; vermelho em andamento, verde em 100%.
- Esqueletos (`member-skeletons.tsx`): todo `loading.tsx` de pagina do aluno desenha a forma final (barra do topo de 64 px, cabecalho, grade ou lista) com `motion-safe:animate-pulse`, sem o marcador do loading global, para o spinner sumir assim que o endereco muda.

Datas mostradas ao aluno usam `src/lib/member-format.ts` (fuso America/Sao_Paulo, "08/01/2026", "08/01/2026 às 14:30", "há 2 dias"). Rotas e itens da barra lateral vem de `src/lib/member-navigation.ts`.

## Estilo escolhido pelo produtor (Marca > Estilo)

- Gravado em `platform_settings.branding.style` (`src/lib/member-style.ts`): `corners` (`soft` | `rounded`), `buttons` (`soft` | `pill`) e `menu` (`sidebar` | `header`). Padrao: discreto, botoes discretos, menu na barra lateral. A capa da pagina do curso segue os mesmos cantos e recuo do destaque da home, salvo escolha do proprio produto (Detalhes > Cantos do banner: como a area, arredondados ou retos; gravada em `content_page_settings.settings.hero.corners`, atributo `data-member-banner` no raiz da pagina). Com o banner arredondado so no produto, a pagina do curso inteira acompanha: o cabecalho recua 64 px (logo e foto do perfil na linha do banner, via prop `bannerCorners` do `AppShell`) e as fileiras usam o mesmo recuo (`--member-row-inset`).
- Tamanho dos cards: fluido, como as thumbs de Shorts do YouTube. A largura e uma fracao da fileira (`.member-row-card`, `--member-row-cols` por largura de tela: 2,2 no celular, 3 a partir de 640 px, 4 de 768, 5 de 1280, 6 de 1700, 7 de 2100 e 8 de 2560; cards de 16:9 em `--member-row-cols-wide`), nos dois estilos de cantos, entao os cards crescem com a janela (227 a 311 px entre 1280 e 1699 px; 294 px em 1920). Nao ha tamanho por produto: a thumbnail do card e uma so (2:3, WebP ate 720 x 1080, imagem a partir de 284 x 426, sem ampliar).
- Luz de fundo do destaque (`HeroGlow`, `src/components/member/hero-glow.tsx`): a cor media da imagem do destaque (ou da capa do video), com a saturacao reforcada, vira um degrade do topo da pagina ate o `#141414` (`.member-hero-glow`, `--member-hero-accent`), como na Netflix. Medida no navegador com uma versao pequena da imagem; no arredondado desce 38vh por tras da primeira fileira (`--member-hero-glow-extend`), no discreto a imagem cobre o destaque e a luz nao aparece.
- Cantos e botoes entram pelos atributos `data-member-corners` e `data-member-buttons` no raiz do `AppShell`; `globals.css` define por atributo as variaveis `--member-cover-radius` (10/16 px), `--member-button-radius` (8 px/pilula) e, para o destaque arredondado, `--member-hero-radius`, `--member-hero-inset` (12 px; 64 px a partir de 640 px, alinhado com a logo; com os links no cabecalho e sem hamburguer, o cabecalho recua 64 px dos dois lados), `--member-hero-top`, `--member-hero-fade` (sem o esfumacado inferior) e `--member-hero-overlap` (a primeira fileira nao sobrepoe). As fileiras usam `--member-row-inset` (20/32/48 px; no arredondado 12 px e 64 px a partir de 640 px, na linha da capa) e, no arredondado, os cards (`member-row-card` 2:3, `member-row-card-wide` 16:9) tem largura calculada para caber um numero inteiro entre as bordas (`--member-row-cols`, 3 a 8 por largura de tela), com rolagem encaixada no inicio do card (`member-row-scroller`), como na Netflix. `MemberButton`, o botao do destaque, `MemberPosterCard`, `MemberLessonCard` e o card de continuar assistindo usam essas variaveis; os padroes ficam em `globals.css` (`:root`), entao a previa do admin desenha o modo discreto.
- Menu no cabecalho (estilo Netflix): a partir de 1024 px os destinos de `Estudar` viram links escritos ao lado da logo (ativo em pilula `white/[0.12]` e negrito) e o hamburguer some; abaixo disso o hamburguer abre a gaveta. Suporte e Perfil ficam no menu da conta.

## Barra lateral e menu da conta (aluno)

- Atualizacao 13/10/2026 (pedido do produtor, referencia "sidebar do YouTube", sempre escuro, sem troca de tema): o cabecalho mostra sempre hamburguer (40 px, redondo) + logo inteira, em todas as larguras; nao ha trilho de icones nem recuo do conteudo. No modo de cantos arredondados a capa do destaque recua 64 px a partir de 640 px (perto da Netflix) e a logo fica nessa linha (hamburguer a 16 px + 40 px + 8 px); o cabecalho recua o mesmo a direita, para a foto do perfil alinhar. O trilho de icones de 72/80 px desta mesma data foi descartado pelo produtor.
- Gaveta `src/components/member/shell/member-sidebar.tsx`: abre por cima da pagina com veu escuro, em todas as larguras; largura `min(300px, 86vw)`, altura total, hamburguer que fecha + logo inteira no topo, grupos `Estudar` e `Conta e ajuda` separados so por uma linha (o nome do grupo fica para o leitor de tela).
- Item com 48 px de altura, texto 15 px e icone Lucide proprio de 24 px com traco 1,5 (Inicio `House`, Minha jornada `Route`, Continue assistindo `CirclePlay`, Minhas compras `LibraryBig`, Favoritos `Bookmark`, Materiais `FolderOpen`, Suporte `LifeBuoy`, Perfil `CircleUser`; a `Compass` e so da IA Diretor). Normal em peso regular `zinc-300`, hover `white/[0.06]`; ativo com fundo `white/[0.1]`, texto branco em negrito e icone preenchido a 18 %. Sem barra nem icone vermelho (decisao de 13/10/2026: o vermelho fica para a marca e para "ao vivo"); foco visivel.
- Sem rodape de conta: perfil e `Sair` ficam so no menu da conta do topo. Produtor/admin ve no topo da gaveta o cartao `Área do produtor` com `Ir para o admin` e `Modo de visualização`.
- Menu da conta no avatar do topo (`member-account-menu.tsx`, so o avatar, sem nome nem seta, como no YouTube; o nome aparece no painel): `Perfil`, `Minhas compras`, `Suporte` e `Sair`; fecha ao clicar fora, com `Esc` ou ao perder o foco; setas percorrem os itens.
- Topo, a direita: busca, sino de lembretes (`member-notifications-menu.tsx`) e conta. Ate o modulo Comunicacao (docs/17, fase 5) entregar avisos, webinarios e promocoes, o sino abre "Nenhum lembrete por enquanto" com o que vai aparecer ali; nunca lembrete ou contador inventado. Sem trofeu ate existirem conquistas reais.

## Modal de detalhes

- O topo do modal deve usar uma capa/hero mais alta, com fade inferior escuro integrado ao fundo do painel.
- Apenas o titulo e os botoes de acao devem ficar sobrepostos a imagem, com os botoes imediatamente abaixo do titulo.
- Descricao, professor, progresso, tipo, duracao/aulas e demais textos informativos devem comecar depois da imagem.

## Imagens

- Usar imagens reais ou capas do conteudo quando disponiveis.
- Evitar imagem escura/blur quando o usuario precisa reconhecer o conteudo.
- Miniaturas de aulas e cursos devem manter aspect ratio estavel.

## CRM admin with shadcn/ui

O CRM admin em `/admin` usa blocos e primitivas oficiais do shadcn/ui como fundacao de componentes. O shell inicial do admin segue o padrao de dashboard/sidebar do shadcn, com tokens Bunker707 dark premium aplicados por CSS variables.

A area do aluno mantem a UI streaming-inspired existente. Tokens shadcn do admin devem ser adicionados em camada sobre `--background`, `--foreground`, `--panel`, `--border` e `--accent`, sem alterar cards, carrosseis, paginas de aula, modais ou sidebar/hamburger do aluno.

No admin, componentes como `Sidebar`, `Card`, `Badge`, `Button` e `Table` devem preferir tokens semanticos (`bg-background`, `bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`) e composicao shadcn. Acentos primarios usam o vermelho Bunker707 via `--primary`/`--sidebar-primary`; superficies permanecem escuras e discretas.

A home do CRM deve ter cara de painel executivo premium, nao wireframe. A primeira dobra precisa mostrar graficos reais, cards densos, insights operacionais para o produtor, produtos com capas e listas de alunos com progresso. Evitar CTAs repetidos, busca falsa, botoes desabilitados sem funcao e textos explicativos que descrevem o proprio painel.

### Editor da vitrine/Home

O editor usa uma grade de tres paineis no desktop: estrutura compacta à esquerda, preview como area de maior peso visual no centro e inspetor fixo à direita. Os paineis usam a mesma familia de superficies escuras do CRM, borda `white/10`, raio entre 8 e 10 px e hierarquia tipografica curta. Em larguras menores, os paineis podem empilhar, mas a estrutura e o inspetor precisam continuar operaveis por toque e o preview deve permitir scroll sem alargar a pagina inteira.

O item selecionado na estrutura usa contraste claro inequivoco; menus de tres pontos fecham depois da acao; arraste tem alternativa por botoes mover para cima/baixo. O topo fixo mostra `Alteracoes nao publicadas` e mantem `Descartar` e `Publicar` juntos. Feedback de publicacao aparece como estado textual persistente, nao apenas por mudanca de cor.

Secoes estruturais usam duas variantes:

- `Compacta`: identificacao do curso/formacao e fileira interna sem dominar a Home;
- `Imersiva`: banner com imagem de fundo, degradê escuro, CTA e cards internos sobrepostos, mantendo contraste de texto e scroll horizontal em telas menores.

Formacoes usam cards internos de cursos; cursos e bootcamps usam cards de modulos. O preview administrativo deve reutilizar o componente da Home publicada para que espacamento, bloqueio e comportamento responsivo nao divirjam.

Na Vitrine do admin novo o tipo de fileira estrutural se chama `Fileira de modulos` (antes "Destaque de um produto"), para nao confundir com a aba Destaque, que e o banner do topo.

### Area de membros: previa real do login e do destaque

As abas Login e Destaque (Area de membros) mostram o componente real do aluno (`LoginExperience`, `HeroSection`), nunca uma imitacao, dentro de `PreviewFrame` (`src/components/admin/v2/member-area/preview-frame.tsx`):

- a moldura desenha uma "tela" de 1280 x 800 (Computador) ou 390 x 844 (Celular) e reduz com `transform` para caber na coluna; o conteudo fica `inert` (sem foco nem clique) e com os tokens do aluno restaurados (o admin troca `--accent` por cinza);
- por isso `LoginExperience` e `HeroSection` respondem a container query e nao a janela: `@container` num elemento de fora e `@min-[640px]:`, `@min-[768px]:`, `@min-[1024px]:`, `@min-[1280px]:` no lugar de `sm:`, `md:`, `lg:`, `xl:`. Um elemento nao consulta o proprio container, entao o `@container` vai num wrapper;
- altura de tela cheia usa `var(--member-preview-vh, 100vh)` (`min-h-[var(--member-preview-vh,100vh)]`) no lugar de `min-h-screen`/`h-screen`; a moldura define a variavel com a altura da tela simulada;
- os dois componentes tem a prop `preview`: sem efeitos de sessao, sem envio de formulario, sem `preload`/`fetchPriority`, e os links viram texto. Na area do aluno nada muda (o container tem a largura da janela); conferir com screenshot antes/depois ao mexer neles;
- `LoginExperience` gera os ids dos campos com `useId` (duas previas na mesma pagina nao repetem id). Nos modelos com imagem ao lado, no celular a imagem aparece escurecida atras do formulario. A logo tem teto de 56 px de altura; no tom Claro vira texto;
- `HeroSection` mostra o botao claro quando ha `cta` visivel; video toca sem som, em repeticao, com `poster`, e quem prefere menos movimento ve a capa parada (`motion-reduce`, so CSS);
- no tom Claro do login, mensagens (erro, aviso de link enviado, login indisponivel), divisoria "ou continue com", botao de mostrar senha e "Esqueci minha senha" usam cores proprias de fundo claro (`panelToneClasses` em `login-experience.tsx`); cor pensada para fundo escuro nunca entra no tom Claro;
- a galeria de modelos do login usa miniaturas vivas (a mesma moldura com o rascunho aplicado a cada modelo), semantica de `radiogroup` (setas trocam, Enter/Espaco escolhem) e o selo "Em uso" no modelo publicado. No login, a partir de 1440 px de janela Computador e Celular aparecem lado a lado (abaixo disso, pilulas trocam); no destaque, pilulas Computador | Celular em todas as larguras. Login e Destaque viram duas colunas (formulario e previa fixa ao lado) a partir de 1024 px de janela.

Controles do admin que salvam na hora (chaves, pilulas, titulo editavel no lugar, botoes que somem depois de gravar) nao ficam `disabled` enquanto gravam: um controle focado que vira `disabled` joga o foco do teclado no corpo da pagina. Use `aria-busy`/`aria-disabled`, ignore o clique no handler (`AdminSwitch` tem `pending`) e, quando o botao some, mova o foco para a proxima acao natural. Em textos com a chave "Mostrar" (destaque), escrever num campo vazio liga a chave sozinho; texto preenchido com a chave desligada mostra "Escondido na home".

### Catalogo no CRM

A area de Catalogo deve manter a listagem e o painel operacional como contexto principal. A criacao e edicao de formacoes, cursos, mentorias, webinarios, produtos, bootcamps, modulos e aulas deve abrir em `Dialog` central amplo, sobre a tela atual, nunca como pagina externa nem como painel inline que empurra a listagem.

Modal de criacao/edicao no Catalogo:

- Deve usar cabecalho escuro premium, breadcrumb curto `Catalogo / Criacao` ou `Catalogo / Edicao`, botao de fechar circular e conteudo rolavel dentro do modal.
- O construtor em passos continua com `Configuracao`, `Modulos` e `Aulas`, mas os passos aparecem dentro do modal.
- Salvar a configuracao inicial deve manter o modal aberto e avancar para `Modulos`; salvar modulo pode avancar para `Aulas`; finalizar apenas fecha o modal e devolve o usuario para a listagem.
- Toda leitura inicial e mutacao do CRM deve mostrar o estado do sistema. Em criacao, edicao, exclusao, reordenacao, upload ou publicacao, o controle acionado troca para spinner e texto especifico, fica bloqueado contra reenvio e e acompanhado por um status global persistente com resultado de sucesso ou erro. O feedback deve usar `role=status`/`aria-live` e nao depender apenas de cor.
- A pagina de fundo fica bloqueada pela primitiva `Dialog` enquanto o modal esta aberto, preservando o estado da busca, filtros e item selecionado no Catalogo; componentes de Catalogo nao devem alterar `document.body.style.overflow` manualmente.
- Edicao por botoes de tabela, card destacado ou painel lateral deve abrir o mesmo modal padronizado.

### Novas areas operacionais do CRM

Combos, Moderacao, Agentes de IA e Integracoes devem seguir o mesmo padrao shadcn dark premium do CRM: cards densos, tabelas/listas operacionais, filtros compactos, badges discretos e botoes com icones Lucide. Essas telas nao devem virar landing pages explicativas nem duplicar o fluxo de Catalogo.

Regras:

- `Produtos` usa o Catalogo/construtor existente;
- `Combos` agrupa produtos existentes e mostra turma, produtos incluidos e status;
- `Comunidade` pode aparecer como placeholder de fase futura, sem ativar experiencia de comunidade para alunos;
- `Moderacao` prioriza filtros por produto, tipo de comentario/resposta e status;
- `Agentes de IA` separa escopos de comentario, tutor de aula, assistente geral e chat da home;
- `Configuracoes > Integracoes` deve mostrar provedores, eventos esperados e status do segredo sem exibir segredos reais.

### Chat flutuante da IA Diretor

- O launcher usa `Compass` com uma pequena `Sparkles`, mede entre 52 e 56 px e fica no canto inferior direito sem cobrir controles centrais da pagina.
- No desktop, o painel fica ancorado acima do launcher, com 420 px de largura, altura limitada ao viewport, superficie `--panel`, borda discreta, raio de 16 px e sombra forte. Nao usa backdrop nem transforma a pagina em modal.
- No celular, o painel ocupa `100dvh`, respeita safe areas e mantem cabecalho, mensagens e composer operaveis com o teclado aberto.
- O cabecalho usa a marca da Diretora (`Compass` + estrela) em circulo, `IA Diretor`, o apoio `Orientação sobre seus cursos e trilhas` e um ponto verde ou cinza de disponibilidade, com acoes iconograficas (e dica propria) para historico, novo chat e fechar.
- A entrada cumprimenta pelo primeiro nome (`Olá, Ana`), repete `Encontre aulas, descubra o que estudar e organize seu próximo passo.` e mostra tres sugestoes como cartoes com icone. Indisponivel: o motivo ocupa o lugar das sugestoes.
- O historico substitui temporariamente a area da conversa dentro do proprio painel, agrupado em `Hoje`, `Ontem`, `Últimos 7 dias`, `Últimos 30 dias` e `Mais antigas` (fuso de Sao Paulo). Cada item usa titulo truncado, data relativa com quantidade de mensagens (`há 2 horas · 6 mensagens`) e menu compacto para renomear ou excluir, sem duas colunas apertadas.
- Pergunta do aluno em balao; resposta da Diretora sem balao, com avatar, tipografia regular, Markdown contido e cards compactos para referencias autorizadas. Cada card mostra tipo, titulo, breadcrumb e `Abrir`; links livres do texto nunca recebem confianca automatica.
- Composer em pilula: campo que cresce ate 6 linhas, `Enter` envia, botao circular, contador a partir de 3.600 de 4.000 caracteres e `Carregando a IA Diretor...` enquanto carrega.
- A camada global fica acima de cards e carrosseis, mas abaixo de modais centrais. Abrir a sidebar principal fecha o chat para evitar duas superficies concorrentes.
- O desktop restaura o foco no launcher ao fechar; `Escape` fecha historico, dialogos internos ou painel na ordem correta. Nomes acessiveis e foco visivel sao obrigatorios.

### CRM de alunos com referencia estrutural operacional

A area de alunos do CRM usa a referencia Hotmart apenas para organizacao e hierarquia, nunca para copia visual. A interface deve permanecer Bunker707 dark premium, com superficies escuras, bordas discretas, acento vermelho controlado e componentes shadcn/ui adaptados aos tokens do produto.

Listagem de alunos:

- Usar titulo `Alunos`, busca, filtro de produto e botao `Filtrar` em uma faixa operacional limpa.
- Metricas continuam existindo, com graficos visiveis em cards escuros discretos.
- A tabela deve ser densa, escura e organizada, com divisores finos, menu de tres pontos por linha e selecao sutil em vermelho.
- O menu de linha deve priorizar as acoes da referencia: detalhes do usuario, reenviar acesso, bloquear acesso a produtos e mudar turma.
- Nao usar fundo claro, azul Hotmart, cinza `#f4f6f8`, superficies brancas ou avatar azul como linguagem visual da pagina.

Modal de detalhes do aluno:

- Deve abrir como `Dialog` central amplo, nao como sheet lateral e nao como pagina externa.
- A organizacao pode se inspirar na referencia: breadcrumb, identidade do aluno, progresso/engajamento, informacoes pessoais e produtos.
- A composicao visual deve ser propria: header escuro premium, resumo lateral, leitura principal e tabela de produtos em superficie escura.
- Nao usar abas para `Visao geral`, `Produtos` e `Atividade`; o modal deve ser uma unica leitura vertical.
- Produtos aparecem em tabela simples com miniatura, nome, progresso, turma, papel, categoria e acesso.
- Evitar scroll interno por aba, paineis aninhados, tiles repetitivos e excesso de acoes visuais dentro da tabela.

Modal de criacao/edicao de aluno:

- Deve usar o mesmo `Dialog` central escuro do perfil.
- O formulario deve ter topo com titulo/contexto leve e uma superficie unica dividida em secoes: identidade, primeiro acesso, origem/status, produtos comprados e notas internas.
- Campos ficam compactos e alinhados; acoes de salvar/cancelar ficam em rodape fixo escuro.
- Seletores de produto usam linhas selecionaveis compactas com miniatura pequena e check visual, em vez de cards grandes.
- Reforcar que entitlements internos seguem como fonte de verdade para acesso.

## Documentacao e evolucao

Quando uma decisao visual mudar, atualizar este documento e os documentos de UX relacionados.

Se forem coletados novos prints da Netflix, registrar apenas o comportamento e os principios visuais relevantes. Nao copiar textos proprietarios, assets, marcas ou uma tela literal.
