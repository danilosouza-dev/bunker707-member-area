# 17. Admin do Produtor — especificação do redesign

Data: 2026-10-10. Status: proposta para aprovação do produtor e execução pela engenharia. Nenhum arquivo de código foi alterado para produzir este documento; o repositório foi lido na branch `dev` (working tree não commitada).

Como ler: o **Resumo em uma página** basta para decidir. A **Parte 1** detalha o produto em linguagem de negócio. A **Parte 2** é para a engenharia e para os agentes de IA que vão implementar: arquivos, tabelas, eventos, versões e critérios de aceite. O **glossário** (2.12) traduz um lado para o outro, e o anexo final explica como o documento foi produzido.

## Resumo em uma página

**O problema.** O admin de hoje é uma tela única que carrega tudo antes de mostrar qualquer coisa, inventa números quando não há dados ("487 alunos ativos" com a base vazia), exige cerca de 45 campos e quatro "estados" para cadastrar um curso e expõe termos de engenharia ("Depois do entitlement", "ID do asset"). O motor por trás dele (regras de liberação, turmas, moderação, Tutor IA, importador do YouTube) funciona e fica.

**A decisão.** Trocar toda a camada visual do admin, tela por tela, mantendo o servidor. Seis áreas no menu: **Hoje, Alunos, Produtos, Comunicação, Comunidade, Configurações**. Produto é a entidade central, com abas. Dois estados em vez de cinco. Nenhum número inventado. Toda tela tem endereço próprio e aparece em menos de um segundo.

**As três telas que mudam o dia a dia.**

1. **Hoje**: em 30 segundos, quem precisa de você (perguntas sem resposta, quem comprou e não começou, acessos expirando), quatro números reais e a saúde por produto.
2. **Criar produto e montar o conteúdo**: nome, formato, capa, descrição, quem pode ver; o produto nasce em rascunho e você cola links de vídeo direto na lista de aulas. Meta: produto com 2 módulos e 3 aulas em menos de 2 minutos.
3. **Fila de perguntas**: os comentários de alunos sem resposta, mais antigos primeiro, com resposta na própria linha e respostas rápidas.

**O que justifica ter área própria.** Um módulo de **Comunicação**: avisos e pop-ups segmentados ("quem parou no módulo 2 há 14 dias"), webinários com inscrição e lembrete, promoções com cupom e prazo no card bloqueado, tudo medido (vistos, cliques, quem voltou a estudar).

**Dados dos alunos.** Hoje o sistema só registra login, comentários, perguntas ao Tutor e Modo TV. Entram os eventos de aula (iniciou, assistiu, concluiu) e, a partir deles, as métricas com fórmula e ação: alunos estudando, novos acessos, aulas concluídas, conclusão em 90 dias, alunos em risco, quem mais comenta, aulas onde os alunos travam. O que ainda não tem dado mostra "—", nunca um exemplo.

**Tecnologia.** Continuar no **Next.js** (versão estável 16.4, de 6/10/2026), não trocar por "só React": sem SEO o que importa é velocidade percebida, e ela vem de corrigir como o Next é usado hoje (tudo dinâmico, moldura remontada a cada clique, duas validações de sessão por página, 1 a 2 MB de JavaScript por rota). Tailwind CSS 4.3, shadcn 4 sobre Base UI, TypeScript 6 no lint.

**Vídeo.** O YouTube não permite esconder a logo desde 15/08/2023 e proíbe controles por cima do player, então o player atual (e a forma não oficial de puxar vídeo que alimenta o "modo manual" e o Modo TV) sai. **Bunny Stream** vira o padrão para aulas pagas (≈ US$ 36/mês para 100 h de catálogo e 300 alunos), Mux como opção premium, Vimeo só para acervo já hospedado, YouTube continua grátis e com logo para aulas abertas e para o acervo atual até ser migrado.

**Como vai parecer.** Das referências que você enviou, levamos: fundo quase preto com cards arredondados de borda suave, sidebar escura com ícones, número grande com variação ao lado em cada indicador, uma cor de acento por produto, gráficos de área e barras suaves, tabelas densas, abas em pílula e busca no topo. Não levamos: gradientes coloridos, medidores circulares, pizza, azul ou roxo dominantes. O vermelho da marca fica para a marca, para ações destrutivas e para "ao vivo"; o botão principal do admin é claro, como na área do aluno.

**Prazo.** Sete fases de 1 a 2 semanas, ≈ 13 semanas até apagar o admin antigo. Na primeira semana os números falsos somem; na terceira você já cria produtos na tela nova; na quinta, Alunos; na sétima, o Hoje completo; na nona, o novo player; na décima primeira, Comunicação.

**O que você precisa decidir agora** (detalhes em 1.15): provedor de vídeo (Bunny), onde estão os arquivos originais dos vídeos, regra de conclusão de aula (90 %), quem pode publicar pop-up para muitos alunos, plataforma de webinário, botão principal claro ou vermelho, renomear o tipo "Produto" para "Material", quais produtos migram do YouTube primeiro.

---

## Parte 1 — Produto

### 1.1 O problema em uma página

O admin atual é uma única tela (`/admin`) que carrega o banco inteiro antes de mostrar qualquer coisa, alterna dez "abas" sem endereço próprio e foi crescendo sem um modelo mental. Quatro sintomas explicam a sensação de "confuso e não usável":

1. **O painel mente.** Com a base vazia ele mostra "487 alunos ativos", "612 acessos" e gráficos de amostra. Qualquer número perde a credibilidade.
2. **Não existe "engajamento" como dado.** Progresso e último acesso do CRM são digitados à mão. Em compensação, o banco já grava comentários, reações, perguntas ao Tutor IA e sessões de Modo TV, e isso nunca foi mostrado ao produtor.
3. **Cadastrar um curso é um labirinto.** Na contagem feita na auditoria de 10/10/2026, um curso com 2 módulos e 3 aulas exige 12 cliques e cerca de 45 campos, com quatro campos de estado sobrepostos (mais um calculado no servidor) e termos como "Depois do entitlement" e "ID do asset". No fim, o curso continua em rascunho sem aviso.
4. **A camada visual é inconsistente.** Seis fundos de painel, três estilos de campo, cards dentro de cards e o vermelho da marca usado ao mesmo tempo como botão, erro e cor de gráfico.

O servidor, por outro lado, tem muita coisa boa: regras de liberação, turmas, pacotes, moderação com auditoria, transcrições e perfil de IA por aula, provedores de IA com chave própria, editor da vitrine, importador de playlist do YouTube, envio de acesso por convite ou senha temporária. **A decisão é trocar a camada de apresentação e manter o motor**, substituindo tela por tela até o admin antigo desaparecer.

### 1.2 O teste da manhã e as cinco regras

Toda decisão deste documento passou por um teste simples: o produtor abre o admin às 8h da manhã e, **em 30 segundos**, precisa saber se alguém precisa dele hoje, quantos alunos estão estudando e se algo quebrou. Se a tela não responde isso sem rolar, está errada.

Cinco regras valem para toda a nova área, e cada uma é verificável em revisão de código (Parte 2):

1. **Toda tela tem endereço próprio** (`/admin/alunos/maria`), a moldura aparece em menos de 100 ms e o conteúdo em menos de 1 s. Nenhuma tela carrega mais de 50 linhas sem o produtor pedir.
2. **Nenhum número inventado.** Sem dado, aparece "—" e "Sem dados no período". Nunca um valor fixo, nunca um exemplo sem a faixa "Exemplo".
3. **Produto é a entidade central**, com abas. Estrutura, Combos, Personalização de produto e Moderação por produto deixam de ser telas.
4. **Um estado editável por objeto** (Rascunho / Publicado / Arquivado) e **um conceito de acesso** ("quem pode ver"), escritos em português do produtor. Palavras proibidas na interface: entitlement, RBAC, asset, escopo, persistido, CRM, drip, webhook (fora de Configurações).
5. **Migração sem big-bang.** Cada fase substitui um item do menu; o produtor usa a área nova a partir da primeira fase; o admin antigo fica em `/admin/legado` até a última tela migrar.

### 1.3 Vocabulário: as seis palavras do produtor

| O produtor fala | O que é | Decisão |
|---|---|---|
| **Produto** | O que ele vende ou libera: curso, formação, mentoria, bootcamp, material avulso (inclusive gravações de lives) | O "Tipo de item" vira **Formato** (pills na criação). "Produto" deixa de ser um dos tipos e passa a ser o nome da entidade; o tipo antigo "Produto" vira **Material**. Cursos que vivem dentro de uma formação aparecem só dentro dela ("Cursos desta formação"), nunca na lista principal (regras em 1.6.9). O formato "Webinário" deixa de existir na criação: a gravação de uma live vira aula de um curso ou um Material, e os itens antigos desse tipo passam a se chamar "Gravação de live". "Escopo" e "Catálogo" somem da interface. |
| **Conteúdo** | Módulos e aulas de um produto | Deixa de ser a tela "Estrutura" e vira a aba **Conteúdo** do produto, com um único construtor. Os dois formulários duplicados de módulo/aula morrem. |
| **Acesso** | Quem pode ver o quê, desde quando, até quando, por qual origem | Um só conceito visível. A "situação" (ativo, suspenso, revogado, expirado) é do acesso, não da pessoa. Datas são datas, nunca "Vitalício" digitado. |
| **Aluno** | A pessoa | Um aluno = uma conta. Aluno cadastrado sem conta aparece como **Sem conta** com botão "Enviar convite", em vez de parecer ativo sem estar. **Turma** é um rótulo que se escolhe numa lista (hoje "mudar turma" pula para a próxima sem perguntar). **Ritmo** é o estado de estudo da pessoa (Estudando, Em risco, Inativo, Nunca começou, Concluiu); "Sem conta" é estado do cadastro e aparece à parte. |
| **Comunicação** | Avisos e pop-ups, webinários, promoções | Módulo novo. Na interface usamos as palavras do produtor: **Avisos**, **Webinários**, **Promoções** (não "campanhas", "eventos", "ofertas"). |
| **Comunidade** | Comentários, dúvidas, moderação | Vira uma **fila de perguntas** a responder; moderação é consequência, não a tela principal. |

**Dois estados em vez de cinco.** Hoje um produto tem quatro campos de estado (Acesso, Status, Publicação, Liberação) mais um quinto calculado no servidor. Passa a ter:

- **Situação** (do produtor): Rascunho / Publicado / Arquivado. "Agendado" é Publicado com data futura.
- **Quem pode ver** (do aluno): **Só quem tem acesso** (padrão) / **Todos os alunos** / **Oculto por enquanto**. "Oculto" é um produto publicado que fica fora da vitrine: só quem já tem acesso o vê, dentro de Minhas compras; serve para lançamentos silenciosos e bônus. Quem quer que ninguém veja usa Rascunho.

"Em breve", "Novo" e "Bloqueado" passam a ser calculados e nunca editados: **Bloqueado** = este aluno não tem acesso e há link de compra; **Em breve** = este aluno não tem acesso e não há link de compra, ou a liberação é futura; **Novo** = publicado há menos de 14 dias. "Em andamento" e "Concluído" continuam aparecendo nos cards do aluno, calculados pelo progresso de cada um, e saem do formulário do produto.

**Liberação em frases.** Em vez de modo + tempo + unidade + data + requisito sempre visíveis (em seis cópias), o produtor monta uma frase: "Liberar **na hora** / **7 dias depois de ganhar acesso** / **em 14/11/2026** / **depois de concluir [aula X]**". Os campos só aparecem quando o modo os usa. "Depois da matrícula" e "depois da compra" viram uma coisa só: "depois de ganhar acesso".

**Dicionário obrigatório** (vale como checklist de revisão):

| Proibido | Usar |
|---|---|
| entitlement, "Depois do entitlement" | acesso, "depois de ganhar acesso" |
| ID do asset, código embed | "Cole o link do vídeo"; "Código de incorporação" só atrás de "Outro provedor" |
| Escopo, sellable_product, Visibilidade: students | não exibir |
| RBAC ativo, Entitlements como fonte de verdade, Supabase persistido, Persistido agora, Live CRM, CRM Admin | remover; o produto chama-se **Admin Bunker707** |
| cohort | Turma |
| drip | liberação programada |
| webhook | "venda recebida da Hotmart/Ticto" (só em Configurações > Vendas) |
| Agentes de IA | Tutor IA (em Configurações) |
| campanha, evento, oferta, audiência, público | Aviso, Webinário (só o evento ao vivo, em Comunicação), Promoção, Segmento |
| Webinário (como tipo de produto) | Gravação de live, ou aula dentro de um curso |

### 1.4 O mapa do admin

Barra lateral com **6 áreas de primeiro nível** (hoje são 10) e subitens que só aparecem ao expandir:

```
Hoje
Alunos
Produtos
  Todos os produtos
  Home do aluno
Comunicação
  Avisos e pop-ups
  Webinários
  Promoções
Comunidade
Configurações
---
Ver como aluno · Buscar (Cmd+K) · avatar (tema, sair)
```

Atualização (11/10/2026): na implementação a Home do aluno saiu de Produtos e virou a área de primeiro nível **Área de membros** (o menu tem sete áreas), com os subitens **Vitrine, Destaque, Módulos, Login e Marca**, nesta ordem: as duas peças da home juntas (fileiras e topo), o que fica dentro dos cursos, a página de entrar (muda pouco) e a logo (muda quase nunca). Detalhes no "Registro da rodada Área de membros" (2.10).

Contadores só onde há fila: Comunidade (perguntas sem resposta) e Hoje (itens que precisam de atenção). Em telas menores que 768 px a barra vira um menu deslizante, o mesmo hambúrguer que o aluno já usa.

Dois **filtros globais** vivem no topo e no endereço da página: **Período** (7, 30, 90 dias ou personalizado; padrão 30) e **Produto** (todos ou um). Hoje, Alunos, Desempenho do produto, Comunicação e Comunidade respeitam os dois, e todo número escreve o período no rodapé ("vs. 30 dias anteriores"). Todo link é compartilhável e o botão voltar funciona.

**Busca global (Cmd/Ctrl+K)**: alunos (nome, e-mail), produtos, aulas (com "Produto › Módulo"), ações ("Novo produto", "Adicionar aluno", "Novo aviso", "Importar playlist") e recentes.

Sitemap completo (um endereço por tela):

| Área | Endereços |
|---|---|
| Hoje | `/admin` |
| Alunos | `/admin/alunos`, `/admin/alunos/novo`, `/admin/alunos/importar`, `/admin/alunos/[id]`, `/admin/alunos/turmas`, `/admin/alunos/segmentos` |
| Produtos | `/admin/produtos`, `/admin/produtos/novo`, `/admin/produtos/importar`, `/admin/produtos/pacotes`, `/admin/produtos/[id]` (Conteúdo), `/detalhes`, `/acesso`, `/alunos`, `/desempenho`, `/aulas/[lessonId]` (painel lateral com endereço próprio) |
| Área de membros | `/admin/area-de-membros` (Vitrine), `/destaque`, `/modulos` (`?busca=`, `?pagina=`), `/login`, `/marca`; `/admin/home` redireciona para a Vitrine |
| Comunicação | `/admin/comunicacao` (todas), `/avisos/novo`, `/avisos/[id]`, `/webinarios`, `/webinarios/novo`, `/webinarios/[id]`, `/promocoes`, `/promocoes/nova`, `/promocoes/[id]` |
| Comunidade | `/admin/comunidade` (fila), `/denuncias`, `/top`, `/regras` |
| Configurações | `/admin/configuracoes` (geral), `/equipe`, `/video`, `/ia`, `/vendas`, `/canais` |
| ~~Transitório~~ | ~~`/admin/legado`~~ removido em 14/10/2026: existe um admin só |

### 1.5 Tela "Hoje"

**Propósito**: responder em 30 segundos "alguém precisa de mim?", "quantos estão estudando?", "algo quebrou?". Regra fixa: **Hoje tem três linhas de conteúdo e nada abaixo delas**. Se um número novo quiser entrar, outro sai. Tendências longas, rankings e filas completas vivem em Alunos, Produtos › Desempenho e Comunidade.

**Linha 0 — Cabeçalho.** "Bom dia, Danilo" + data. À direita: período, produto e o botão primário **Criar** (menu: Produto, Aluno, Aviso, Webinário, Promoção).

**Linha 1 — Precisa de atenção hoje.** Até 5 cartões, cada um com um número grande, uma frase e **um** botão, ordenados por urgência. Quando não há nada: "Tudo em dia. Nada precisa de você agora." com a hora da última verificação.

| Alerta | Regra (em linguagem de produto) | Botão | Quando entra |
|---|---|---|---|
| Perguntas sem resposta | comentários de alunos sem resposta do professor há mais de 24 h | **Responder** → Comunidade | Fase 1 (≈ 3ª semana) |
| Acesso sem conta | aluno com produto liberado e sem conta criada | **Enviar convites** (em massa) | Fase 1 |
| Acessos expirando em 7 dias | acesso ativo que termina na próxima semana | **Ver alunos** | Fase 1 |
| Produto publicado sem aula / aula publicada sem vídeo | higiene de catálogo | **Corrigir** → produto | Fase 1 |
| Tutor IA com falhas | mais de 2 % das respostas falharam em 24 h | **Ver conexões** → Configurações › IA | Fase 1 |
| Importação terminou ou falhou | nas últimas 24 h | **Abrir produto** | Fase 1 |
| Compraram e não começaram | acesso liberado há 2 a 7 dias e nenhuma aula iniciada | **Enviar lembrete** → aviso com público pré-preenchido | Fase 2 (≈ 5ª semana, quando o sistema passa a registrar aulas iniciadas) |
| Alunos em risco | acesso ativo, progresso entre 5 % e 80 %, sem estudar há 14 dias | **Enviar aviso** → segmento "Em risco" | Fase 2 |
| Vídeo com problema | vídeo com erro ou processando há mais de 2 h | **Ver aulas** | Fase 4 (com o novo player) |
| Aviso com dispensa alta | mais de 40 % dos alunos fecharam sem clicar | **Pausar** / **Ver relatório** | Fase 5 (com Comunicação) |
| Webinário em 48 h | sem lembrete programado ou com menos de 5 inscritos | **Avisar alunos** | Fase 5 |

Um cartão só existe quando a regra pode ser calculada; nenhum cartão aparece "em branco" antes de o dado existir.

**Linha 2 — Quatro números.** Mesma largura e altura, número grande, seta de variação contra o período anterior e mini-gráfico de 12 pontos. Clicar abre a lista correspondente, **com o mesmo total do número clicado**.

| Número | Significado (definição completa em 1.11) | Ação ao clicar |
|---|---|---|
| **Alunos estudando** | pessoas com acesso ativo que assistiram pelo menos 10 minutos ou concluíram uma aula no período | Alunos filtrados por ritmo "Estudando" |
| **Novos acessos** | acessos liberados no período; a origem (Hotmart, Ticto, manual) aparece ao passar o mouse, e até as vendas automáticas existirem (fase 6) será sempre "manual" | Alunos ordenados por "Entrou em" |
| **Aulas concluídas** | aulas concluídas pelo player no período; marcações manuais aparecem à parte ("+N marcadas à mão") | com um produto selecionado: Desempenho do produto; com "Todos": a tabela "Por produto" da Linha 3, destacada |
| **Conclusão em 90 dias** | de quem começou um produto, quantos terminaram em até 90 dias | idem |

**Linha 3 — Atividade + Por produto.** À esquerda, "Atividade dos alunos": quem assistiu e quem concluiu, por dia, com o período anterior em cinza tracejado. À direita, a tabela "Por produto": capa, nome, com acesso, estudando, conclusão, tendência. Clicar abre o Desempenho do produto.

**O que não está no Hoje**: rankings de alunos (ficam em Comunidade › Top alunos e em Alunos), ciclo de vida semanal (fica no topo de Alunos), fila completa de perguntas (Comunidade), relatórios de avisos (Comunicação), textos de "insight" fixos.

**Estados**: escola nova (zero produtos) mostra um checklist de 4 passos no lugar dos números: "Criar seu primeiro produto", "Adicionar um aluno e liberar acesso", "Publicar", "Enviar o primeiro aviso". Antes de os eventos de aula existirem, os números que dependem deles mostram "—" e a faixa "Coleta de eventos de aula ativa desde DD/MM — períodos anteriores não são comparáveis". Período sem atividade: gráfico com linha zero e "Nenhum aluno estudou nesse período". Erro ao carregar uma seção: aviso persistente naquela seção com "Tentar de novo"; as outras continuam.

### 1.6 Produtos

#### 1.6.1 Lista (`/admin/produtos`)

**Propósito**: achar um produto e ver sua saúde em uma linha. **Conteúdo**: tabela com Produto (capa pequena + nome + formato), Situação (Rascunho / Publicado / Arquivado, mais o calculado "Em breve"), Quem pode ver, Alunos com acesso, Aulas (publicadas/total), Estudando (7 dias), Atualizado. Filtros: Formato, Situação; busca por nome. **Ações**: **Novo produto** (primário), **Importar do YouTube**, clique na linha abre o produto. Aba secundária **Pacotes**. **Estados**: vazio = "Você ainda não tem produtos. Crie o primeiro ou importe uma playlist do YouTube." Sem hero, sem três listagens do mesmo catálogo.

#### 1.6.2 Criar produto em menos de 2 minutos (`/admin/produtos/novo`)

Página de coluna única com cinco blocos. Passo a passo, com os textos exatos:

1. **Nome** (único campo obrigatório; já vem com o cursor; 3 a 80 caracteres).
2. **Formato** — pills: **Curso** (já selecionado), Formação, Mentoria, Bootcamp, Material. Gravações de lives entram como aula de um curso ou como Material (ver 1.8.3).
3. **Thumbnail do card** — arrastar uma imagem ou colar um link. Qualquer imagem a partir de 284×426 serve (de 720×1080 para cima fica nítida em qualquer tela): aparece um recorte 2:3 para ajustar; imagem menor que 720×1080 sai no tamanho dela, sem ampliar. O card do aluno é fluido (cresce com a janela, como as thumbs de Shorts do YouTube), então não há tamanho por produto (13/10/2026). (No admin antigo qualquer imagem que não seja exatamente 720×1040 é recusada.)
4. **Descrição curta** — até 300 caracteres (é o texto do card e do modal do aluno).
5. **Quem pode ver** — pills: **Só quem tem acesso** (já selecionado) / **Todos os alunos** / **Oculto por enquanto**. Com "Só quem tem acesso" aparece o campo **Link de compra** (opcional) com o aviso amarelo "Sem link, o aluno verá 'Em breve'". Não bloqueia.

Botão primário: **Criar produto**. Secundário: **Criar a partir de uma playlist do YouTube**. O produto nasce em **Rascunho** e a tela cai direto na aba Conteúdo. Hero, instrutor, nível, limite de alunos, apresentação e ordem na home ficam nas abas Detalhes e Acesso: é o segundo nível, e só ele.

Meta medida em duas partes, por alguém que nunca usou a tela: (a) criar o produto e cair na aba Conteúdo em até 30 segundos e 4 interações; (b) dessa tela vazia até 2 módulos e 3 aulas com vídeo reconhecido em até 90 segundos. Interação = um clique ou um colar; digitar um nome conta como uma. **O que não está nesta tela**: hero, instrutor, nível, limite de alunos, apresentação, ordem na home, liberação. Tudo isso tem lugar nas abas do produto.

#### 1.6.3 Página do produto e aba Conteúdo (`/admin/produtos/[id]`)

**Cabeçalho fixo**: "Produtos / Nome", nome editável no lugar, chip de Situação com menu (Rascunho / Publicar / Arquivar), **Ver como aluno**, **Publicar** (quando rascunho), menu "…" (Duplicar, Arquivar, Excluir). Abas: **Conteúdo**, **Detalhes**, **Acesso e venda**, **Alunos**, **Desempenho**. Uma barra "Alterações não salvas — Descartar / Salvar" aparece no rodapé só quando há mudança, e a página avisa antes de fechar.

**Conteúdo**: árvore de dois níveis, Módulo › Aula.

- Linha de módulo: alça de arrastar, nome editável no lugar, frase de liberação ("Libera 7 dias depois do acesso"), N aulas, menu (Liberação, Duplicar, Excluir).
- Linha de aula: alça, número, nome, ícone do provedor de vídeo, duração, chip (Publicada / Rascunho / Agendada / Vídeo processando / Vídeo com erro), menu (Duplicar, Mover para…, Excluir).
- **+ Adicionar aula** no fim de cada módulo e **+ Adicionar módulo** no fim da lista: um campo aparece no lugar; Enter cria e abre outro; Esc fecha. **Colar várias linhas cria várias aulas. Colar um link de vídeo no nome cria a aula já com o vídeo reconhecido** e o título sugerido pelo provedor.
- Arrastar com o mouse ou com `Alt+↑/↓`; "Mover para" como alternativa sem arrastar. Reordenar salva tudo de uma vez (hoje é um pedido ao servidor por clique).
- Seleção múltipla: Publicar / Despublicar / Definir liberação / Mover / Excluir.
- Excluir aula ou módulo é imediato, com o aviso "Aula excluída — **Desfazer**" por 10 segundos. Nenhuma janela nativa de confirmação.
- Vazio: "Este produto ainda não tem aulas." + **Adicionar módulo** + **Importar**.

Limites: 50 módulos por produto, 100 aulas por módulo, 20 materiais por aula (100 MB cada).

#### 1.6.4 Painel de aula (abre ao lado, sem sair da árvore)

1. **Vídeo** — um único campo **Cole o link do vídeo** e o botão **Enviar arquivo**. Ao colar, o sistema reconhece o provedor e mostra um chip com um aviso de uma linha: "YouTube — a logo e o título do YouTube aparecem no player"; "Bunny — vídeo protegido, sem logo de terceiros"; "Vimeo — ative a restrição por domínio no Vimeo". Título, miniatura e duração são preenchidos automaticamente. "Enviar arquivo" faz o envio direto para o provedor com barra de progresso, depois "Processando" e "Pronto". Botão **Trocar vídeo**. Links já cadastrados em qualquer um dos seis provedores atuais (YouTube, Vimeo, Bunny, Mux, link direto, código de incorporação) continuam funcionando e editáveis desde a fase 1; envio de arquivo, proteção por link que expira e legendas automáticas chegam com o novo player (fase 4).
2. **Conteúdo** — nome, descrição (texto simples com formatação básica), miniatura (herdada do vídeo, com envio opcional).
3. **Materiais** — arquivos e links, arrastar para ordenar.
4. **Transcrição e Tutor IA** — estado ("Gerada em 12/09", "Sem transcrição"); botões **Gerar legendas (pt)** (com o custo exibido quando houver), **Importar do YouTube**, **Enviar SRT/VTT/TXT**, **Colar texto**; chave "Usar como base do Tutor IA". O processamento acontece em segundo plano e não atrasa o salvar.
5. **Liberação** — a frase montada, com a prévia "O aluno verá esta aula 7 dias depois de ganhar acesso".
6. Rodapé: chave **Publicada**, **Salvar**, **Ver como aluno**. Ao salvar, a linha da árvore atualiza na hora e aparece "Aula salva".

**O que não está no painel**: seletor de provedor, "ID do asset", campos de liberação sempre visíveis, formulário duplicado em outra tela. "Código de incorporação" fica atrás de "Outro provedor" e só aceita endereços de uma lista aprovada em Configurações › Vídeo.

#### 1.6.5 Abas Detalhes, Acesso e venda, Alunos, Desempenho

- **Detalhes**: hero com recorte, **vídeo de destaque** (desde 14/10/2026: link do YouTube ou arquivo direto .mp4/.webm/.mov, com a imagem de destaque como capa, tocando no topo do modal da home e na página do produto; **Opções do vídeo** em pílulas: tocar sozinho, começar com som (com recuo automático para sem som quando o navegador bloqueia), repetir, botão de som, controle de volume, botão de pausar, linha do tempo e, no YouTube, esconder logo e título por recorte, com o aviso de que isso foge às regras do player incorporado e pode ser desligado; remover o vídeo devolve a imagem ao lugar), descrição longa, instrutor, nível, duração total calculada, "Como abre" (Card único / Mostrar módulos), "Ao clicar quando bloqueado" (abrir detalhes / ir ao link de compra), **cor do produto** (seis opções, usada em chips e gráficos do admin).
- **Acesso e venda**: Quem pode ver; Link de compra; texto do botão; liberação padrão; **Pacotes** que incluem este produto; Turmas; limite de alunos; **Próximo passo** (qual produto oferecer a quem concluir este — alimenta "Candidatos a upsell"); para Formação, a lista de cursos descrita em 1.6.9.
- **Alunos**: a tabela de Alunos filtrada pelo produto, com **Liberar acesso para alguém** (busca por e-mail; sem conta, cria e envia o convite junto).
- **Desempenho**: funil por módulo, tabela por aula (iniciaram, concluíram, queda vs. anterior, avaliação, comentários, perguntas ao Tutor por 100 visualizações), distribuição de progresso em faixas de 25 % com "Ver alunos", e as 5 aulas que mais precisam de atenção com **Abrir aula**. Antes de haver eventos: "Os dados aparecem quando os alunos assistirem aulas. Nada aqui é simulado."

#### 1.6.6 Publicar, ver como aluno, duplicar, modelos

**Publicar** abre um checklist: capa, pelo menos 1 aula publicada, vídeos prontos, "quem pode ver" definido, link de compra (aviso, não bloqueia). Botões **Publicar agora** / **Agendar para…**. Confirmação: "Produto publicado — Ver como aluno". Zero aulas publicadas bloqueia com "Publique pelo menos uma aula". **Ver como aluno** abre a área do aluno no modo de visualização que já existe (produtor, aluno com acesso, aluno sem acesso) com a faixa "Você está vendo como aluno"; mostrar rascunhos nesse modo é trabalho novo da fase 1, e o modo nunca grava progresso. **Duplicar** copia estrutura, materiais e regras, nunca alunos. **Modelos** são produtos marcados como modelo: "Curso em vídeo (3 módulos vazios)", "Mentoria (encontros semanais)", "Webinário (1 aula + materiais)".

#### 1.6.7 Importar (`/admin/produtos/importar`)

Três abas, sempre em segundo plano com progresso em números absolutos ("12 de 40 aulas criadas"):

- **Playlist do YouTube** (o melhor fluxo do admin atual, preservado): colar a URL → **Ler playlist** → prévia com "Organizar automaticamente pelos títulos" (o padrão `C01 | M01 | A01` deixa de ser obrigatório), "Tudo em um módulo" ou "Dividir manualmente" → **Importar como rascunho** → ao terminar, "Abrir produto" e o lembrete "Falta publicar".
- **Lista de links**: um link por linha (opcionalmente `Título | link`), prévia com erros por linha, até 200 linhas.
- **CSV**: `modulo,titulo,link,duracao,liberacao_dias`, modelo para baixar, "38 válidas, 2 com erro" antes de confirmar.

#### 1.6.8 Pacotes e Home do aluno

**Pacotes** (`/admin/produtos/pacotes`) são os antigos combos: nome, produtos incluídos, turma, situação, com a frase "Quando a venda deste pacote chegar da Hotmart/Ticto, liberamos todos os produtos de uma vez". Até as vendas automáticas existirem, **Liberar pacote para um aluno** faz isso à mão. Regras definidas agora para o futuro: reembolso ou chargeback de um pacote revoga o acesso a todos os produtos daquele pacote; produto adicionado ao pacote depois da venda **não** é liberado retroativamente por padrão, mas há o botão "Liberar para quem já tem o pacote" (ver decisão em aberto D7).

**Home do aluno** (`/admin/home`) mantém o editor atual da vitrine (seções, arrastar, rascunho e publicar) como aba **Vitrine**, agora mostrando ao lado de cada fileira as impressões e a taxa de clique dos últimos 30 dias; aba **Destaque** (o hero da home ganha botão com link e a opção "usar um Webinário ou Promoção como destaque por um período"); aba **Marca** (logo e capa). Os editores de Página de login e Página de produtos saem até existir persistência de verdade.

Atualização (11/10/2026, rodada Área de membros): a área se chama **Área de membros** (`/admin/area-de-membros`) e tem cinco abas que gravam de verdade e mudam a área do aluno na próxima visita. **Vitrine** (fileiras; o tipo "Destaque de um produto" passou a se chamar **Fileira de módulos**); **Destaque** (o banner do topo da home: imagem ou vídeo com capa, selo, título, descrição, um botão com link para um produto, uma página da área ou um link externo e, desde 13/10/2026, a luz de fundo: automática, na cor da imagem, ou uma cor escolhida); **Módulos** (por curso: como abre, a fileira de módulos na home e quantos módulos têm capa própria; a capa de cada módulo se troca na aba Conteúdo do produto); **Login** (um dos quatro modelos prontos, imagem, frase, tom do formulário, botão do Google e a linha de ajuda); **Marca** (a logo e, desde 13/10/2026, o **Estilo** da área do aluno: cantos das capas discretos ou arredondados, botões discretos ou pílula, menu na barra lateral ou no cabeçalho; o banner foi para Destaque). A medição de impressões e cliques por fileira e "usar um Webinário ou Promoção como destaque por um período" continuam para as fases 3 e 5. O editor de Página de produtos continua só como prévia no admin antigo.

#### 1.6.9 Formação: como se compõe e como o acesso se propaga

Uma **Formação** é um produto cujo conteúdo são **cursos**, não módulos. Na aba Conteúdo de uma formação aparece a lista "Cursos desta formação" com duas ações: **Adicionar curso existente** (busca entre os produtos do formato Curso) e **Criar curso aqui** (abre o mesmo fluxo de 1.6.2, já vinculado). Cursos podem ser reordenados e removidos da formação sem serem apagados.

Regras, escritas uma vez:

- Quem ganha acesso à formação ganha acesso a todos os cursos incluídos, inclusive os adicionados depois (é o oposto do pacote, D7, porque formação é um produto só).
- Um curso incluído herda "Quem pode ver" e a liberação da formação, a menos que tenha regra própria ("libera 7 dias depois do acesso à formação").
- Um curso incluído não aparece na lista principal de Produtos nem na vitrine por conta própria; aparece dentro da formação e em Minhas compras sob ela. Se o mesmo curso também for vendido avulso, ele é um produto próprio que a formação **referencia**, e aí aparece nos dois lugares.
- O Desempenho da formação soma os cursos; cada curso mantém o seu.

É isso que hoje vaza para a interface como "Escopo", "sellable_product" e "included_content"; esses termos somem.

### 1.7 Alunos

> **Atualização (14/10/2026).** O admin antigo foi removido por decisão do produtor ("um projeto só"). Alunos existe no admin novo sobre as contas reais (`auth.users` + `profiles`), com acesso só por `entitlements`: lista (`/admin/alunos`, busca por nome/e-mail, filtros Produto e Ritmo, 25 por página), Adicionar aluno (`/admin/alunos/novo`: nome, e-mail, telefone, produtos a liberar, prazo, entrega por convite / senha temporária / não enviar), perfil (`/admin/alunos/[id]`: conta, ritmo, abas Acessos com estender/mudar data/sem prazo/suspender/revogar/reativar, Progresso e Histórico; Liberar acesso, Enviar e-mail de acesso, Editar dados, Excluir aluno) e a aba Alunos do produto. Ritmo usa o último progresso gravado em aula (aproximado) com os cortes de 1.11 (14/30 dias). Entrega 2 (15/10/2026, abaixo) trouxe exportação, segmentos, turmas, ações em massa, importação e ciclo de vida; ficam para depois Tutor/Comentários no perfil. Módulo: `src/server/students/` (modelo puro, schemas zod, store, contas no Supabase Auth, `access.ts` reutilizável pelos webhooks de venda, Server Actions com `students.*`; `students.delete` é só dono/admin).

> **Entrega 2 (15/10/2026).** Decisões tomadas depois de uma revisão independente (produto, segurança, performance):
> - **Segmentos**: 10 prontos e os salvos pela equipe (`student_segments`, params canônicos do endereço). **Sem coluna lateral** (decisão do produtor em 15/10/2026: repetia as pílulas de ritmo e tirava largura da tabela, que passava a rolar de lado): uma linha de **pílulas com contagem** (Todos, Estudando, Em risco, Inativos, Nunca começaram, Concluíram) e, no fim, o menu **Mais segmentos** com Expiram em 30 dias, **Nunca entraram** (no lugar de "Sem conta": no modelo novo todo aluno é uma conta), **Compraram e não começaram**, Top comentadores (mesma régua de Comunidade › Top alunos) e os salvos, cada um com a sua regra. A pílula troca só o segmento e mantém produto, turma e busca; as contagens valem para esses filtros. Filtro **Turma** na barra. Na tabela, progresso compacto ("7/24"); Turma e Entrou em só em telas largas. Fora, por ora: Origem, Entrou (período), Progresso em faixas, Tag e 50/100 por página.
> - **Exportação**: Server Action `students.export` (dono/admin) devolve o CSV e o navegador baixa; colunas exatamente as de §1.7.4 (sem documento/endereço, que não existem); equipe fora; `;` + BOM, proteção contra fórmula; registrada no `admin_audit_log` sem o texto da busca.
> - **Turmas**: uma turma por (aluno, produto) em `cohort_memberships(user_id, product_id, cohort_id)` — modelo diferente de §2.4 (sem `entitlement_id`), escolhido porque `grantProductAccess` garante um acesso por (aluno, produto); nome único sem diferenciar maiúsculas; `admin_product_cohorts` conta só quem tem acesso aberto. Turma no perfil (aba Acessos), no Adicionar aluno e na importação.
> - **Ações em massa**: barra flutuante no rodapé, na largura da tabela (mesmo desenho da barra de salvar), com Liberar, Estender (30/90/data), Remover, Mudar turma, Reenviar convite e Exportar; lotes de 25 pelo navegador com progresso, teto de 200 por rodada; equipe sempre recusada (as linhas da equipe nem têm caixa de seleção, e a caixa do cabeçalho mostra traço na seleção parcial); **liberar nunca encurta** acesso aberto (regra também no perfil); Desfazer (10 s) restaura o retrato exato de cada acesso. Enviar aviso e Adicionar tag chegam com Comunicação.
> - **Importar CSV**: leitura no navegador (UTF-8 com fallback windows-1252), mapeamento por cabeçalho, prévia com erro por linha (título de produto ambíguo = erro), convite ou sem envio (senha temporária não cabe em lote), lotes de 25 com retomada por `sessionStorage`; conta existente não recebe convite de novo e só ganha campos vazios; teto no servidor de 2.000 linhas/hora por pessoa.
> - **Ciclo de vida**: classificado no banco (`admin_lifecycle_weeks`), ver §1.11; atividade real gravada pelo servidor depois de cada progresso confirmado (`student_daily_activity`), com backfill aproximado.
> - **Auditoria**: `admin_audit_log` (append-only) para criar, liberar, estender/revogar, e-mail de acesso, editar dados, excluir (e-mail como prova), exportar, massa e importação.
> - **Permissões**: as três telas de Alunos exigem `students.read_basic` (analista volta para o Hoje); `profiles.last_sign_in_at` por gatilho em `auth.users`; o aluno só altera nome, telefone e foto do próprio perfil.


#### 1.7.1 Lista (`/admin/alunos`)

**Propósito**: encontrar quem precisa de atenção e agir em massa. No topo, o **ciclo de vida semanal** (12 semanas: Novos, Retidos, Recuperados, Inativos; clique abre o grupo daquela semana). **Conteúdo**: à esquerda, **Segmentos** prontos (Todos, Estudando, Em risco, Nunca começaram, Concluíram, Expiram em 30 dias, Sem conta, Top comentadores) e salvos, com contagem. Tabela com Aluno (avatar, nome, e-mail e o chip **Sem conta** quando for o caso), Produtos (até 2 chips com a cor do produto + "+N"), Último estudo ("há 3 dias"; "Nunca" em âmbar; rotulado "aproximado" enquanto vier do dado antigo), Progresso (barra do produto filtrado), **Ritmo** (Estudando / Em risco / Inativo / Nunca começou / Concluiu, com as definições de 1.11 e o mesmo período do topo), Turma, Entrou em. 25, 50 ou 100 por página. Filtros: Produto, Ritmo, Conta (com / sem), Turma, Origem, Entrou (período), Progresso (0 / 1–25 / 26–75 / 76–99 / 100), Tag; busca por nome ou e-mail. **Salvar como segmento** sempre que houver filtro.

**Ações em massa** (barra fixa ao selecionar): **Liberar acesso**, **Remover acesso**, **Estender acesso**, **Mudar turma**, **Adicionar tag**, **Enviar aviso**, **Reenviar convite**, **Exportar CSV**. Destrutivas pedem confirmação com a contagem ("Remover acesso de 37 alunos ao Bootcamp IA?") e têm "Desfazer" por 10 s. Mais de 50 alunos roda em segundo plano com progresso. **Estados**: vazio com busca = "Nada encontrado para 'x'. Limpar filtros".

#### 1.7.2 Adicionar aluno e importar CSV

`/admin/alunos/novo`: Nome, E-mail, Telefone (opcional), **Produtos a liberar**, Turma (opcional), **Como entregar o acesso** (Convite por e-mail / Senha temporária / Não enviar agora). Botão **Adicionar e liberar acesso**. Confirmação com próximo passo ("Convite enviado para ana@… Ver aluno"). Documento, cidade e UF ficam recolhidos em "Mais dados".

`/admin/alunos/importar`: enviar arquivo (modelo para baixar) → mapear colunas → prévia com erros por linha ("linha 12: e-mail inválido") → escolher entrega de acesso → **Importar N alunos**. Até 2.000 linhas, em segundo plano.

#### 1.7.3 Perfil do aluno (`/admin/alunos/[id]`)

**Cabeçalho**: avatar, nome, e-mail, telefone, ritmo, conta ("criada em DD/MM" ou "Sem conta"), "Entrou em", origem. Botões **Enviar aviso**, **Liberar acesso**, menu "…" (Reenviar convite, Redefinir senha, Mudar turma, Bloquear todos os acessos, Excluir aluno).

**Resumo** lateral: último estudo, horas assistidas, aulas concluídas, comentários e perguntas ao Tutor, todos no período selecionado. Sem índice de engajamento: as cinco contagens dizem tudo e não exigem interpretação. Abas:

- **Linha do tempo**: tudo por dia (acesso liberado, entrou, começou a aula X, concluiu, comentou, perguntou ao Tutor, recebeu aviso, clicou em promoção), em frases.
- **Acessos**: produto, origem, desde, até, situação; **Estender** (+30 d / +90 d / data / sem prazo), **Revogar** (motivo: reembolso, chargeback, pedido do aluno, outro; "Desfazer" 10 s), **Reativar**. Sem conta: "Este aluno ainda não tem conta. Vamos criar e enviar o convite junto."
- **Progresso**: por produto, barra + módulos + última aula; "Marcar aula como concluída" fica registrado como marcação do admin.
- **Comentários**, **Tutor IA** (perguntas por aula e por dia, sem o texto das conversas), **Avisos recebidos** (vistos, clicados, dispensados), **Notas** (tags e observações internas).

**Excluir aluno** (LGPD): dialog "Excluir Ana? Os acessos serão revogados e os dados pessoais anonimizados. Progresso, comentários e estatísticas ficam sem nome. Isto não pode ser desfeito." Botões **Excluir aluno** / **Manter**.

#### 1.7.4 Exportação

CSV do filtro atual: nome, e-mail, telefone, produtos, turma, situação, entrou em, último estudo, progresso por produto, aulas concluídas, comentários (28 d). Sem documento e endereço por padrão. Toda exportação fica registrada (quem, quando, quantas linhas).

### 1.8 Comunicação

É o módulo que justifica ter uma área de membros própria em vez do Hotmart Club. Nasce enxuto e ligado aos segmentos.

#### 1.8.1 Tipos e limites

| Tipo | Onde o aluno vê | Para quê | Limite por aluno (fixo no sistema) |
|---|---|---|---|
| **Pop-up** | centro da home, após 3 s ou 1ª interação; nunca durante uma aula | decisão: webinário em < 72 h, promoção com prazo, aviso obrigatório | 1 por sessão e 1 a cada 24 h; o tipo "crítico" (só do sistema) ignora o limite |
| **Faixa no topo** | abaixo do cabeçalho | estado persistente: contagem regressiva, "sua live começa em 2 h" | 1 ativa por vez; fechar vale 7 dias |
| **Card na home** | fileira "Para você" ou card dentro de uma fileira | promoção ou webinário como item do catálogo | 1 fileira + 1 card por fileira; fechar vale 30 dias |
| **Destaque da home** | o hero | lançamento ou evento da semana | 1 por vez |
| **Notificação (sino)** | caixa de notificações, 90 dias de histórico | tudo o que foi exibido + respostas a comentários + replays | sem limite |
| **Toast** | canto da tela, só reativo | nova aula liberada, comentário respondido | 2 por sessão |
| **E-mail** (fase 5) | caixa de entrada do aluno | convite e lembretes de webinário, promoção com prazo | marketing 2 por semana, 08–21 h; o plano gratuito do serviço de envio limita a 100 e-mails por dia (D6) |
| **WhatsApp** (fase 7) | WhatsApp oficial (API da Meta) | lembrete de webinário; marketing só com autorização explícita | 1 por semana |

Os limites aparecem no editor como texto ("Para não cansar o aluno, mostramos no máximo 1 pop-up por dia"), não como campos.

#### 1.8.2 Criar aviso (`/admin/comunicacao/avisos/novo`)

Uma página: formulário à esquerda, **prévia ao vivo** à direita usando exatamente os componentes que o aluno vê. Quatro blocos:

1. **O que**: tipo (pills), título (≤ 60), texto (≤ 240), imagem 16:9 (opcional), botão (texto + destino: Produto / Aula / Webinário / Promoção / Link externo), chaves "Lembrar depois" e "Não mostrar de novo".
2. **Para quem**: segmento salvo ou construtor rápido (Produto é/não é, Ritmo, Turma, Progresso em faixa, Entrou em). Contagem na hora ("≈ 318 alunos") com 5 nomes de amostra. Opção "Só eu (teste)".
3. **Quando**: Agora / Agendar (data e hora de São Paulo) / Janela (de–até); encerrar em data ou após N conversões.
4. **Como medir**: o **desfecho** que define sucesso (voltou a assistir / concluiu módulo / inscreveu-se / clicou na promoção / comprou), com janela de 7 dias. É sugerido automaticamente pelo tipo e pode ser trocado; só é opcional para "Aviso informativo".

Revisão em uma frase ("Pop-up para 318 alunos da Formação IA sem acesso ao Bootcamp, de 14/10 a 21/10, no máximo 1 vez"), **Enviar teste para mim**, **Publicar**. Acima de 500 alunos, quem não é dono ou admin vê **Enviar para aprovação**, e o aviso fica "Aguardando aprovação" até um dono ou admin aprovar (D4).

Lista (`/admin/comunicacao`): nome, tipo, para quem, período, situação (Rascunho / Aguardando aprovação / Agendado / Ativo / Pausado / Encerrado), vistos, cliques, dispensa %, conversões. Ações: Pausar, Duplicar, Encerrar. No relatório de cada aviso: funil Elegíveis → Vistos → Clicaram → Converteram, dispensa % (alerta > 40 %), quebra por produto e situação, e o botão **Salvar quem converteu como segmento**.

#### 1.8.3 Webinários (`/admin/comunicacao/webinarios`)

Campos: nome, data e hora (fuso de São Paulo), duração, onde (YouTube Live não listado / Zoom / Google Meet / outro link), capa, descrição, quem pode se inscrever (Todos / Segmento / Quem tem o produto X), vagas (opcional), **lembretes** (24 h e 1 h antes por padrão, sino + e-mail; WhatsApp quando houver), "Avisar na home" (cria card e faixa automaticamente), e **Publicar replay como aula em [produto › módulo]** depois do evento.

Lado do aluno: página `/webinarios`, card "Próxima live" na home, **Garantir vaga** em 1 clique, confirmação com arquivo de calendário e links Google/Outlook, faixa "Começa em 1 h — Entrar" para inscritos. Números: inscritos, compareceram (clicaram em Entrar), assistiram o replay.

#### 1.8.4 Promoções (`/admin/comunicacao/promocoes`)

Campos: produto ofertado, título, selo ("-40 % até domingo"), preço de/por (texto), cupom (copiável), link de checkout (Hotmart/Ticto/Kiwify), prazo com contagem regressiva, para quem (padrão: quem não tem o produto; opções: concluíram o produto X, inativos, segmento), onde (card bloqueado / pop-up / faixa / destaque). O card bloqueado do aluno ganha selo, preço e prazo. Todo clique passa por um link curto que registra quem clicou e, quando as vendas automáticas chegarem, fecha a conversão. Até lá, o relatório diz "cliques no checkout" e não "vendas".

#### 1.8.5 O lado do aluno

Isto é parte da entrega, não detalhe: (a) **sino** no cabeçalho com contador de não lidas, painel com lista agrupada por dia, lido ao abrir, link para o destino; (b) **central de preferências** em `/perfil/notificacoes` com chaves por canal (e-mail, WhatsApp, push) e por tema (lives, promoções, novidades), mais link de descadastro que funciona sem login; (c) estado "**Não mostrar de novo**" em pop-ups e cards, e "Lembrar depois" (24 h, no máximo 2 vezes). Os três entram no design system do aluno (`docs/12`) com os mesmos tokens da área do aluno, não do admin.

### 1.9 Comunidade

`/admin/comunidade` abre na fila **Precisam de resposta**: comentários de alunos sem resposta do professor, mais antigos primeiro. No topo, quatro números: Sem resposta, Tempo mediano de resposta (28 d) e p90, Comentários (28 d), Denúncias abertas. Meta: mediana abaixo de 24 h, p90 abaixo de 48 h.

Cada item: avatar, nome, "Produto › Módulo › Aula", texto, reações, "há 5 h". Ações na própria linha: **Responder** (publica com selo Professor), **Responder e marcar como FAQ** (a pergunta e a resposta viram conhecimento do Tutor IA daquela aula), **Resolver** (atendido sem responder), Ocultar, Spam, **Respostas rápidas** (modelos com `{nome}` e `{aula}`), Ver aluno. Navegação por teclado `J/K` com foco visível. Filtros: Produto, Aula, Situação, Período. No celular é a tela mais usada: um item por vez, botões grandes.

Abas: **Denúncias** (motivo, ação, histórico); **Top alunos** (28 d: comentários, respostas a colegas, reações recebidas; "Enviar aviso" e "Marcar como embaixador"); **Aulas com mais dúvidas** (comentários, perguntas, perguntas ao Tutor por 100 visualizações; "Abrir aula"); **Regras** (palavras bloqueadas, respostas rápidas, aprovação automática, resumo diário por e-mail de perguntas sem resposta).

Tudo isso sai de dados que **já existem hoje** (comentários com autor e resposta, reações, denúncias, perguntas ao Tutor), por isso Comunidade entra na fase 1, junto com Produtos.

> Decisão da fase 1 (10/10/2026): as abas "Avaliações" e "Aulas com mais dúvidas" viraram uma aba única **Aulas** (comentários, sem resposta, perguntas ao Tutor IA e a barra Não gostei/Gostei/Amei, ordenável por dúvidas, piores ou melhores). Ver o registro em 2.10.

### 1.10 Configurações

Geral (nome da escola, fuso, domínio); **Equipe** (funções prontas que se combinam, funções personalizadas e permissões extras por pessoa, cada permissão na escola toda ou só nos cursos da pessoa; tabela e regras em §2.3, tela em `/admin/configuracoes/equipe`); **Vídeo** (provedores conectados, provedor padrão, custo estimado do mês, aviso de que o YouTube exibe a marca); **IA** (Tutor e Diretor: provedores, limites, conexões e consumo — telas atuais, que já são reais, movidas para cá); **Vendas** (Hotmart, Ticto, Kiwify: até existir a integração, aparece honestamente como "Em configuração", nunca como "Configurada"; depois, URL para colar na plataforma, segredo e registro de vendas recebidas); **Canais de envio** (remetente de e-mail, WhatsApp, push).

> **Atualização (17/10/2026): Vendas com a Hotmart existe** (`/admin/configuracoes/vendas`, só o dono, `settings.sales`). Cartão da Hotmart com o endereço para colar na Hotmart (origem do site + `/api/webhooks/hotmart`, com Copiar), a instrução de onde cadastrar (Ferramentas › Webhook, versão 2.0.0, aba Autenticação para o token), os eventos a marcar, o campo do token (guardado só no servidor: depois de salvo a tela mostra "Token guardado em <data>", Trocar token e Desconectar), a última venda recebida e quantos produtos/pacotes têm código. Ticto e Kiwify aparecem como "Em configuração". A lista **Vendas recebidas** (50 últimas) mostra data, evento ("Compra aprovada", "Reembolso", "Chargeback", "Assinatura cancelada"…), e-mail mascarado com link para o aluno, produto ou pacote da escola (ou o nome que veio da plataforma) e o resultado (Acesso liberado / revogado / suspenso / Ignorado / Erro) com o motivo escrito e **Reprocessar** para o que falhou ou foi ignorado. A ligação da venda ao catálogo é o campo **Código do produto na Hotmart** em Produtos › Acesso e venda e em Pacotes (`sales_product_links`); venda de pacote libera todos os produtos de uma vez, reembolso ou chargeback tiram todos, pacote em rascunho ou pausado não libera. "Novos acessos" do Hoje passou a dizer a origem no rodapé ("3 pela Hotmart · 2 pela equipe"), e o histórico do aluno já mostrava "(Hotmart)". Módulo `src/server/payments/`; regras em `docs/04` (Webhooks externos), `docs/05` (Webhooks) e `docs/06` (Vendas pela Hotmart). A retenção de 12 meses existe desde 17/10 (`public.prune_personal_data()`, migração `202610170004`; `docs/06`, seção LGPD): a venda antiga continua na lista como "Dados apagados (12 meses)", sem e-mail e sem Reprocessar. Fica para depois: Ticto e Kiwify, gravar `warranty_ends_at`, processamento em job.

### 1.11 Métricas: o que o produtor precisa, com fórmula e ação

Regra de corte: **nenhuma métrica entra sem (a) fórmula e janela visíveis ao passar o mouse, (b) uma ação a um clique e (c) um resultado mensurável.** O que não passa vira exportação ou sai. Todas excluem a equipe e contas de teste. Todas mostram "Atualizado às HH:MM".

Convenção de janela: **tudo segue o período selecionado no topo** (padrão 30 dias), comparado com o período anterior de mesmo tamanho. Só duas exceções, escritas no próprio rótulo: "Conclusão em 90 dias" (olha o grupo de quem entrou no mesmo mês, porque um curso leva semanas para ser concluído) e os limiares de ritmo (Em risco = 14 dias sem estudar, Inativo = 30 dias). Onde aparece "p90", leia "os 10 % mais lentos".

| Métrica | Fórmula | Onde | Ação | Quando |
|---|---|---|---|---|
| **Alunos estudando** (o número principal) | pessoas distintas com acesso ativo que assistiram ≥ 10 min ou concluíram ≥ 1 aula no período | Hoje; Alunos (ritmo) | abre Alunos "Estudando"; queda em 2 semanas seguidas sugere aviso para "Em risco" | Fase 3 (antes, "aproximado" a partir do último acesso à aula) |
| Novos acessos | acessos criados no período, por origem | Hoje; Alunos | Alunos por "Entrou em" + "Enviar boas-vindas" | Fase 1 (origem só a partir da fase 6) |
| Aulas concluídas | conclusões pelo player ou automáticas; manuais à parte | Hoje; Desempenho | Desempenho do produto | Fase 3 |
| Conclusão em 90 dias | concluíram ÷ iniciaram, no grupo de quem entrou no mesmo mês; segundo número: ÷ quem tem acesso há ≥ 30 dias | Hoje; Desempenho | funil por módulo | Fase 3 |
| Ativação em 7 dias | de quem ganhou acesso há ≥ 7 dias, quantos concluíram 1 aula (ou metade de uma) na primeira semana | Desempenho; Alunos | funil acesso → login → home → aula iniciada → concluída | Fase 3 |
| Ritmo do aluno | Estudando (≥ 10 min ou 1 aula no período) / Em risco (acesso ativo, progresso 5–80 %, ≥ 14 dias sem estudar) / Inativo (≥ 30 dias) / Nunca começou / Concluiu | Alunos; perfil | segmento + Enviar aviso | Fase 2 |
| Compraram e não começaram | acesso há 2–7 dias sem aula iniciada | Hoje; Alunos | aviso "Comece por aqui" (dia 2 e dia 5) | Fase 2 |
| Perguntas sem resposta | comentários de alunos sem resposta do professor há > 24 h | Hoje; Comunidade | Responder | Fase 1 |
| Tempo de resposta | mediana e p90 entre a pergunta e a 1ª resposta do professor | Comunidade | meta < 24 h / < 48 h | Fase 1 |
| Top comentadores | comentários aprovados + respostas a colegas + reações recebidas | Comunidade › Top alunos | Enviar aviso / Marcar embaixador | Fase 1 |
| Aulas com mais dúvidas | comentários + perguntas ao Tutor, por 100 visualizações | Comunidade; Desempenho | Abrir aula | Fase 1 (contagem), Fase 3 (por 100 visualizações) |
| Funil de módulos | iniciaram o módulo n ÷ iniciaram o módulo 1 | Desempenho | "Ver alunos parados aqui" → segmento → aviso | Fase 3 |
| Aulas que precisam de atenção | queda vs. aula anterior + conclusão baixa + avaliação negativa + perguntas ao Tutor + comentários sem resposta | Desempenho | Abrir aula | Fase 3 |
| Avaliação da aula | Não gostei / Gostei / Amei (as três opções já existem na aula); saldo = (Amei − Não gostei) ÷ respostas | Desempenho | regravar ou mover quando negativo com ≥ 20 respostas | Fase 1 (o dado já existe; ganha tabela própria na fase 3) |
| Concluídas sem assistir | conclusões manuais ÷ conclusões totais, por produto | Desempenho | revisar a regra de conclusão do produto | Fase 3 |
| Candidatos a upsell | ≥ 70 % ou conclusão do produto A sem acesso ao "próximo passo" B | Desempenho; Alunos | Criar promoção | Fase 3 (exige "Próximo passo" configurado no produto) |
| Acessos expirando | acesso termina em ≤ 30 / 15 / 7 dias, separados em quem estuda e quem não | Hoje; Alunos | quem estuda: renovação; quem não: "termine antes de DD/MM" | Fase 1 |
| Tutor IA | perguntas, % de falhas, custo estimado, aulas com mais perguntas | Configurações › IA; Desempenho | falhas > 2 % → conexões | Fase 1 (o dado já existe) |
| Avisos | elegíveis → vistos → cliques → resultados; % de dispensa; quem voltou a estudar em 7 dias | Comunicação | pausar / duplicar / salvar quem converteu como segmento | Fase 5 |
| Webinários | inscritos ÷ elegíveis; presença ÷ inscritos; replay assistido | Comunicação | replay para quem faltou | Fase 5 |
| Vitrine | impressões e taxa de clique por fileira | Produtos › Home do aluno | reordenar fileiras | Fase 3 |
| Ciclo de vida semanal | Semana ativa = ≥ 10 min assistidos ou ≥ 1 aula concluída (`student_daily_activity`). Novos (primeira semana ativa de toda a história) / Retidos (ativos nesta semana e na anterior) / Recuperados (ativos nesta, parados na anterior, com atividade antes) / Inativos (acesso aberto há ≥ 4 semanas e nenhuma semana ativa nas 4 últimas). Semana começa na segunda, fuso da escola. Backfill aproximado até 15/10/2026. | Alunos (topo) | clique abre o grupo da semana na lista | Entregue (15/10/2026) |

O que **não** contamos, escrito para não voltar: quem só abriu a aula não conta como quem assistiu; login não conta como estudo; não mostramos "progresso médio geral" (mistura quem entrou ontem com quem entrou há 2 anos); total de comentários sem contexto não é indicador; a equipe nunca entra nas contas; nenhum número tem valor de reserva quando falta dado; metas não se comparam com cursos gratuitos abertos.

Referências de mercado para calibrar metas (não para copiar): conclusão mediana de MOOC gratuito 12,6 %; 46 % entre pagantes no edX; cursos pagos sob demanda ≈ 42 % e turmas ≈ 53 % (dado de fornecedor, observacional). Metas iniciais sugeridas, a revisar após 3 meses de dados reais: ativação em 7 dias ≥ 60 %, conclusão em 90 dias de curso gravado ≥ 35 % (de quem iniciou), bootcamp ≥ 60 %, estudando por período ≥ 30 % dos alunos com acesso, "nunca assistiu em 7 dias" < 20 %.

### 1.12 Vídeo: decisão em linguagem de produto

**Por que o YouTube não serve para aula paga.** O YouTube desativou em 15/08/2023 o único recurso que escondia a logo, e suas regras proíbem colocar qualquer botão ou camada por cima do player e separar o áudio do vídeo. O player atual da Bunker707 faz as duas coisas, e o "modo manual" de qualidade e o Modo TV dependem de uma forma não oficial de puxar o vídeo que pode parar de funcionar de um dia para o outro e bloquear todos os alunos ao mesmo tempo. Isso sai. O YouTube continua valendo, de graça e **com a logo visível**, para aulas abertas, bônus, trailers e para todo o acervo atual até ser migrado; o painel de aula avisa isso em uma linha.

**O que muda para o aluno.** Aulas pagas passam a tocar em um player nas cores da escola, sem logo de terceiros, protegido (só quem tem acesso recebe o link, que expira), com retomada de onde parou, velocidade, legendas em português geradas sob demanda e progresso real (hoje, em vídeos que não são do YouTube, o progresso é um cronômetro que anda sozinho). O Modo TV continua funcionando com o novo player.

**Quanto custa (estimativas, conferir antes de contratar).** **Bunny Stream**, o padrão recomendado: ≈ US$ 36/mês para 100 h de catálogo e 300 alunos assistindo 10 h/mês cada; ≈ US$ 225/mês para 500 h e 2.000 alunos, usando a rede de entrega com ponto em São Paulo e armazenamento em duas regiões. Legendas automáticas: US$ 0,10 por minuto de vídeo, só quando você clicar em "Gerar legendas" (≈ US$ 600 uma vez para 100 h). **Mux**, opção premium com proteção forte e melhor análise de qualidade: ≈ US$ 78 e ≈ US$ 1.170/mês nos mesmos cenários. **Vimeo** não serve como principal: segundo a central de ajuda, os planos comuns limitam a entrega a 2 TB/mês, e o cenário de 300 alunos já passa disso (confirmar no plano contratado). **Panda Video** cobra em reais (planos de R$ 97,90 a R$ 497,90 mais excedentes) e sairia ≈ R$ 708/mês no primeiro cenário; funciona no mesmo adaptador se um dia fizer sentido.

**Migração do acervo.** O sistema **não baixa vídeos do YouTube** (também é proibido). Você fornece os arquivos originais (HD, Drive ou o download do próprio canal pelo YouTube Studio, permitido ao dono) e usa **Trocar vídeos em massa** no produto: uma fila de envio por aula com o estado visível ("Ainda no YouTube, com logo" / "Enviando 40 %" / "Processando" / "Pronto"). A aula troca sozinha para o vídeo novo quando ficar pronto e volta ao YouTube se algo falhar. Progresso, avaliações e comentários são por aula, então nada se perde. A decisão D13 define quais produtos migram primeiro.

### 1.13 Produtor no celular

Quatro fluxos precisam funcionar bem em 375 px e são critério de aceite das fases de Alunos e Comunidade: **responder comentário**, **liberar ou estender acesso**, **pausar um aviso**, **ver os números do dia**. Tabelas viram listas de cartões com as três colunas principais; painéis laterais viram tela cheia; alvos de toque de 44 px; botão "Novo" flutuante nas listas.

### 1.14 O que fica fora do MVP (escrito agora para não voltar depois)

WhatsApp (só na fase 7, utilitário primeiro), e-mail em massa com editor visual, testes A/B, editor de texto rico, gamificação, certificados, mural da comunidade, ranking público de alunos, automações encadeadas, aplicativo nativo. Também ficam fora da barra lateral quaisquer telas sem backend real: a lição das telas decorativas de Integrações e Comunidade não se repete.

### 1.15 Decisões em aberto para o produtor

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Provedor de vídeo padrão: Bunny (custo) ou Mux (análise e proteção forte)? | Bunny, com piloto em 1 produto na fase 4 para validar a velocidade no Brasil antes de migrar o acervo |
| D2 | De onde vêm os arquivos originais dos vídeos hoje no YouTube? (HD, Drive, Studio) | Levantar antes da fase 4; define o esforço de "Trocar vídeos em massa" |
| D3 | Regra de conclusão de aula: só fim do vídeo, ou 90 % assistido? | 90 % por padrão, configurável por produto, com "marcada à mão" sempre separada |
| D4 | Quem na equipe pode publicar um pop-up para mais de 500 alunos sem segunda aprovação? | Dono e admin; editor cria e agenda, e a publicação acima de 500 fica "Aguardando aprovação" até um dono ou admin aprovar |
| D5 | Plataforma de webinário padrão: YouTube Live não listado (grátis, exige canal habilitado) ou Zoom Webinars (≈ US$ 80–95/mês além da licença, estimativa)? | YouTube Live não listado; Zoom só se precisar de link único por aluno |
| D6 | E-mail de convites e lembretes: começar no plano gratuito (3.000 por mês, **100 por dia**) ou já no pago (US$ 20 por 50 mil)? | Gratuito só em desenvolvimento; a fase 5 entra no pago desde o primeiro webinário com mais de 100 inscritos, com remetente no domínio da escola |
| D7 | Produto adicionado a um pacote depois da venda: liberar retroativamente por padrão? | Não; botão manual "Liberar para quem já tem o pacote" |
| D8 | Por quanto tempo guardar dados de comportamento (eventos, avisos recebidos) depois que o aluno sai? | 24 meses, anonimizados na exclusão da conta |
| D9 | Admin em tema claro também, ou só escuro? | Só escuro no MVP; a troca de tema já está preparada para depois |
| D10 | Botão principal do admin: claro (branco com texto escuro) ou vermelho da marca? Hoje o design system manda usar o vermelho como primário no admin | Claro, como o botão primário da área do aluno; o vermelho sobra para marca, ações destrutivas e "ao vivo", sem colidir com erro nos gráficos |
| D11 | Renomear o tipo "Produto" para "Material" também na área do aluno (hoje o rótulo aparece no modal de detalhes)? | Sim, com migração de rótulo |
| D12 | Permitir ultrapassar o limite de 1 pop-up por dia em lançamentos? | Não no MVP; o excedente usa Faixa no topo e Destaque da home |
| D13 | Migrar do YouTube: tudo, só produtos pagos, ou só produtos novos daqui em diante? | Só pagos, começando pelo de maior receita; abertos e bônus ficam no YouTube |

A ordem do roadmap tem um ponto negociável, descrito em 2.10: Comunicação pode vir antes do vídeo se um lançamento exigir.

### 1.16 Esboços das três telas críticas

Esboços de estrutura, não de acabamento; **os valores são ilustrativos**. O protótipo clicável da fase 0 parte deles.

**Hoje**

```
┌ Hoje ──────────────────────────── Período [30 dias ▾]  Produto [Todos ▾]  [ Criar ▾ ] ┐
│ Bom dia, Danilo · sexta, 10 de outubro                                                 │
│                                                                                        │
│ Precisa de atenção hoje                                                                │
│ ┌ 7 ──────────────┐ ┌ 12 ─────────────┐ ┌ 5 ───────────────┐ ┌ 1 ─────────────────┐   │
│ │ perguntas sem   │ │ compraram e não │ │ acessos expiram  │ │ produto publicado  │   │
│ │ resposta > 24 h │ │ começaram       │ │ em 7 dias        │ │ sem aula           │   │
│ │ [ Responder ]   │ │ [Enviar lembrete│ │ [ Ver alunos ]   │ │ [ Corrigir ]       │   │
│ └─────────────────┘ └─────────────────┘ └──────────────────┘ └────────────────────┘   │
│                                                                                        │
│ ┌ Alunos estudando ┐ ┌ Novos acessos ──┐ ┌ Aulas concluídas ┐ ┌ Conclusão em 90 d ─┐   │
│ │ 184   ▲ 12 %     │ │ 37    ▲ 4 %     │ │ 1.209  ▼ 3 %     │ │ 41 %   ▲ 2 pts     │   │
│ │ ▁▂▃▃▅▆▅▆▇▇█▇     │ │ ▁▁▂▂▃▂▃▄▃▄▅▄    │ │ ▃▄▅▅▆▆▅▅▆▇▆▆     │ │ ▂▃▃▄▄▅▅▅▆▆▆▆       │   │
│ │ vs. 30 dias ant. │ │ vs. 30 dias ant.│ │ +18 à mão        │ │ de quem iniciou    │   │
│ └──────────────────┘ └─────────────────┘ └──────────────────┘ └────────────────────┘   │
│                                                                                        │
│ ┌ Atividade dos alunos (por dia) ─────────────┐ ┌ Por produto ───────────────────────┐ │
│ │        ╭─╮      ╭──╮   assistiram ──         │ │ ▣ Formação IA     312   96  38 % ▲ │ │
│ │  ╭──╮ ╭╯ ╰─╮ ╭──╯  ╰╮  concluíram ┄┄         │ │ ▣ Bootcamp Agentes 88   61  64 % ▲ │ │
│ │ ─╯  ╰─╯    ╰─╯      ╰─ período anterior ┈┈   │ │ ▣ Clones 2.0      140   22  17 % ▼ │ │
│ └──────────────────────────────────────────────┘ └────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**Criar produto e aba Conteúdo**

```
┌ Produtos / Novo produto ──────────────────────────────────────────────┐
│ Nome            [ Formação IA para Negócios                       ]   │
│ Formato         (Curso)  Formação  Mentoria  Bootcamp  Material       │
│ Capa            ┌──────┐  Arraste uma imagem ou cole um link          │
│                 │ 9:13 │  qualquer imagem a partir de 540×780         │
│                 └──────┘                                              │
│ Descrição curta [ ................................................ ]  │
│ Quem pode ver   (Só quem tem acesso)  Todos os alunos  Oculto por enquanto │
│    Link de compra [ https://pay.hotmart.com/...          ] (opcional) │
│                                                                       │
│ [ Criar produto ]    Criar a partir de uma playlist do YouTube        │
└───────────────────────────────────────────────────────────────────────┘

┌ Produtos / Formação IA para Negócios    ● Rascunho ▾   Ver como aluno   [ Publicar ]   … ┐
│ Conteúdo | Detalhes | Acesso e venda | Alunos | Desempenho                               │
│                                                                                          │
│ ⋮⋮ Módulo 1 · Fundamentos                      Libera na hora           3 aulas    …     │
│    ⋮⋮ 1  Boas-vindas            ▶ YouTube  12:40   Publicada                       …     │
│    ⋮⋮ 2  O que é um agente      ▶ Bunny    18:05   Publicada                       …     │
│    ⋮⋮ 3  Primeiro prompt        ▶ Bunny    22:10   Rascunho                        …     │
│    + Adicionar aula  (cole um ou vários links aqui)                                      │
│ ⋮⋮ Módulo 2 · Prática                          Libera 7 dias depois do acesso  0 aulas   │
│    + Adicionar aula                                                                      │
│ + Adicionar módulo        [ Importar ▾ ]                                                 │
│                                                                                          │
│ ┌ Painel da aula (abre ao lado, a árvore continua visível) ────────────────────────┐     │
│ │ Cole o link do vídeo [ https://...                        ]  [ Enviar arquivo ]  │     │
│ │ ▣ Bunny — vídeo protegido, sem logo de terceiros · 18:05 · miniatura carregada   │     │
│ │ Nome · Descrição · Materiais · Transcrição e Tutor IA                            │     │
│ │ Liberação: Liberar [ na hora ▾ ]                                                 │     │
│ │ ( Publicada )   [ Salvar ]   Ver como aluno                                      │     │
│ └──────────────────────────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Fila de perguntas (Comunidade)**

```
┌ Comunidade ─── Sem resposta 7 · Resposta mediana 9 h (p90 31 h) · Comentários 212 · Denúncias 1 ┐
│ Precisam de resposta | Denúncias | Top alunos | Aulas com mais dúvidas | Regras                   │
│ Filtros: Produto [Todos ▾]  Aula [Todas ▾]  Período [30 dias ▾]                                   │
│                                                                                                   │
│ ◯ Ana Souza · Formação IA › Módulo 2 › Primeiro prompt · há 26 h                                 │
│   "Quando uso o prompt do exemplo o agente responde em inglês. Como forço português?"             │
│   [ Responder ]  [ Responder e marcar como FAQ ]  Resolver  Ocultar  Spam  Ver aluno              │
│   ┌ Resposta (selo Professor) ─────────────────────────────── Respostas rápidas ▾ ┐               │
│   │ Oi, {nome}! ...                                                               │               │
│   └──────────────────────────────────────────────── Cmd+Enter envia ─────────────┘               │
│ ─────────────────────────────────────────────────────────────────────────────────────────────── │
│ ◯ Bruno Lima · Bootcamp Agentes › Módulo 1 › Setup · há 20 h                                     │
│   "O link do material está quebrado."                                                             │
│   [ Responder ]  [ Responder e marcar como FAQ ]  Resolver  Ocultar  Spam  Ver aluno              │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Parte 2 — Engenharia

### 2.1 Next.js ou "só React"? Resposta direta

**Manter Next.js (App Router), na versão estável 16.4.** A ausência de SEO não remove a necessidade de servidor: a plataforma tem mais de 40 route handlers (`src/app/api/**`), a chave de serviço do Supabase fica confinada ao servidor, webhooks de pagamento ainda vão ser construídos, o Tutor IA e o Modo TV rodam no servidor, e a CSP com nonce é gerada por request. Um SPA obrigaria a reescrever `src/server/db/platform-store.ts` como API separada e perderia streaming e Server Components. O que o aluno sente como lentidão vem do **uso** do Next (todas as páginas `force-dynamic`, o shell dentro de cada `page.tsx`, dupla validação de sessão, 1,06 a 1,93 MB de JavaScript por rota), não do framework. As alternativas têm lacunas objetivas hoje: TanStack Start ainda é RC e React Router 8 tem RSC instável.

O admin ganha sensação de aplicativo dentro do Next: `app/admin/layout.tsx` com o shell persistente, uma `page.tsx` Server Component por tela com loader próprio, `loading.tsx` por segmento, `Suspense` por cartão, mutações por Server Actions. Páginas client-heavy (árvore, tabela, formulário) navegam entre si como um SPA.

### 2.2 Versões recomendadas (conferidas em 10/10/2026)

| Pacote | Versão | Data | Nota |
|---|---|---|---|
| `next` | 16.4.0 → patch de segurança previsto para **14/10/2026** | 2026-10-06 | aplicar o patch no dia; `middleware.ts` está depreciado em favor de `proxy.ts`; `next dev --webpack` (`package.json:12`) deve sair |
| `react` / `react-dom` | 19.3.0 | 2026-09-09 | View Transitions estáveis |
| `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 | 2026-07-16 | sem v5 anunciada |
| `shadcn` (CLI, devDependency) | 4.21.4 | 2026-10-07 | Base UI é o padrão desde 07/2026 e o projeto já usa Base UI (`components.json`: `style: base-nova`), então não há migração de primitivos; blocks `sidebar-07` e `dashboard-01` como ponto de partida; densidade pelo preset Rhea (maio/2026, "uma Luma mais compacta", `shadcn/create?preset=b27GcrRo`) ou ajuste do `base-nova`; o pacote `cn` separado (set/2026) é opcional |
| `@base-ui/react` | 1.9.0 | 2026-10-09 | já é a base do projeto; não misturar Radix (Tremor) |
| `typescript` | manter **6.0.x** no lint; `tsc` 7.0.2 opcional só para typecheck | 2026-07-08 | `typescript-eslint` ainda exige TS < 6.1 |
| `@supabase/supabase-js` / `@supabase/ssr` | 2.117.3 / 0.12.7 | 2026-10-07 / 2026-09-08 | guia oficial usa `proxy.ts` + `getClaims()` |
| `@tanstack/react-table` | 9.2.8 | 2026-10-08 | v9 com `useTable` + `tableFeatures` (tree-shaking) |
| `react-hook-form` / `zod` / `@hookform/resolvers` | 7.89.0 / 4.6.5 / 5.9.1 | 2026-09-26 / 2026-09-13 / 2026-08-17 | o mesmo schema valida Server Action e rota |
| `@atlaskit/pragmatic-drag-and-drop` | 4.0.0 | 2026-09-24 | `@dnd-kit/core` sem release desde 12/2024 |
| `recharts` | 3.10.1 (via shadcn `chart`, `next/dynamic`) | 2026-07-25 | hoje 841 KB entram no first load do `/admin` |
| `nuqs` | 2.10.2 | 2026 | filtros na URL |
| `cmdk` (via shadcn Command) | 1.1.1 | 2025-03 | Cmd+K |
| `@sentry/nextjs` | 11.6.0 | 2026-10-08 | hoje ausente em produção |
| `posthog-js` | 1.438.7 | 2026-10-09 | hoje ausente em produção; heartbeat de vídeo fica fora dele |
| `@vercel/speed-insights` | 2.0.0 | 2026-03-10 | hoje ausente em produção |
| `@vimeo/player` / `@mux/mux-player-react` / `hls.js` | 2.30.4 / 3.14.0 / 1.7.3 | 2026 | Bunny não tem SDK npm: REST + iframe + `player.js` |
| `resend` / `react-email` | 6.32.1 / 6.11.1 | 2026 | fase 5 |
| Node | 24.x (default da Vercel; Node 20 em depreciação desde 2026-10-01) | — | `.nvmrc` já é 24 |

### 2.3 Arquitetura

**Pastas**

```
src/app/admin/
  layout.tsx                      AdminShell (sidebar, topbar, Cmd+K, filtros globais); lê admin_roles uma vez
  page.tsx  loading.tsx           Hoje (RSC + Suspense por widget)
  alunos/{page,novo,importar,turmas,segmentos}/  [id]/page.tsx
  produtos/{page,novo,importar,pacotes}/
  produtos/[id]/{layout,page,detalhes,acesso,alunos,desempenho}/
  produtos/[id]/@sheet/(.)aulas/[lessonId]/page.tsx     painel interceptado
  produtos/[id]/aulas/[lessonId]/page.tsx               página inteira no reload
  home/page.tsx
  comunicacao/{page,avisos,webinarios,promocoes}/
  comunidade/{page,denuncias,top,regras}/
  configuracoes/{page,equipe,video,ia,vendas,canais}/
  alunos/                         lista, novo e [id] (Alunos, 14/10/2026); o legado/ foi removido
src/server/
  catalog/        produtos, módulos, aulas, publicar, importar (sai de platform-store.ts)
  access/         entitlements, liberar/estender/revogar, release-policy (existente), cohorts
  students/       lista paginada, perfil 360, facts, segmentos, export
  analytics/      um arquivo por métrica (SQL + definição + teste contra fixture), rollups, atenção hoje
  communications/ campaigns, audiences, deliveries, eligibility, events, offers, notifications
  community/      fila, stats, quick-replies (comment-store.ts migra para cá)
  video/          providers/{youtube,bunny,vimeo,mux,hls}.ts, resolve, playback, webhooks
  events/         catálogo tipado, /api/events, espelho PostHog
  jobs/           Inngest: importações, exports, transcrição, audiências, envios
src/components/admin/
  shell/  ui/ (PageHeader, KpiTile, AttentionCard, ChartCard, DataTable, EmptyState, SaveBar,
          SegmentPicker, ReleaseRulePhrase, VideoField, LessonSheet)
```

`platform-store.ts` (4.012 linhas) é fatiado por domínio ao longo das fases; cada tela nova lê do módulo do seu domínio. Nunca `getAdminDashboardData()` (`platform-store.ts:2625`) nem `initialData` com o banco inteiro (`src/app/admin/page.tsx:5-12`).

**Leitura de dados**

- Loaders por tela com `select` de colunas explícitas, `range()` para paginação, `count: 'exact', head: true` para totais, filtros por `searchParams`.
- Busca por e-mail: o índice `students_email_lower_idx` existe; usar `eq` sobre `lower(email)` via RPC ou coluna gerada, nunca `ilike` livre (`platform-store.ts:1020`). Não criar `email_normalized` redundante.
- Métricas sempre de rollups e RPCs SQL (`admin_dashboard_kpis(period_start, period_end, product_id)`, `get_lifecycle_weeks`, `get_module_funnel`, `get_lesson_health`), nunca agregadas em JavaScript. Reaproveitar `get_ai_usage_summary` (migração `202607160001`).

**Cache do catálogo e a flag global**

- O catálogo (itens, módulos, aulas, settings de página) é igual para todos os alunos e muda só quando o produtor publica. Hoje é relido do Postgres em cada page view (14 queries em `platform-store.ts:1045-1075`).
- `'use cache'`, `cacheTag()` e `cacheLife()` só funcionam com `cacheComponents: true`, uma **flag global** do `next.config.ts` (hoje ausente). Ao ligar, toda leitura dinâmica fora de `<Suspense>` vira erro de build e as 6 páginas `force-dynamic` precisam ser reestruturadas (shell estático + buracos). Isso é orçado como passo próprio na fase 6: ligar a flag com `partialPrefetching`, rodar o codemod `cache-components-instant-false`, remover `force-dynamic` e exportar `ensureStatic` só nos segmentos cuja casca precise ser garantidamente estática.
- **Fase 1, sem a flag**: `const getCatalog = unstable_cache(loadCatalog, ['catalog'], { tags: ['catalog'] })`. `React.cache` não serve para isso (só deduplica dentro de um render). `invalidateCatalog()` é a **única** função chamada por toda mutação de produto/módulo/aula/vitrine: em Server Action usa `updateTag('catalog')` (leitura imediata do que acabou de gravar); em rota REST legada, job ou webhook usa `revalidateTag('catalog', 'max')` (a forma de um argumento está depreciada no Next 16). Teste e2e "publicar → aparece na home em < 2 s" rodando contra um Preview da Vercel, porque o cache em memória de um processo local não reproduz a propagação entre instâncias.
- **Fase 6, com a flag**: migrar `getCatalog` para `'use cache'` + `cacheTag('catalog')` + `cacheLife('hours')` enquanto o legado existir e `'max'` depois de remover `/admin/legado`; como `'use cache'` usa armazenamento em memória por instância por padrão, usar o cache handler da plataforma ou `'use cache: remote'` para o catálogo.

**Mutações**: Server Actions com zod retornando só a entidade alterada; `PUT /api/admin/students` (replace-all com `deleteMissingRows`, `src/server/db/platform-store.ts:3003-3005`; a trava atual só impede remover mais de 10 alunos e mais de 50 % da base, não a sobrescrita silenciosa de campos) ganha **kill-switch no dia em que Alunos v2 entra** (flag server-side devolve 410 e o legado esconde o botão), substituído por `PATCH` por aluno e ações por entitlement.

**Resolver único de acesso** (fase 1, antes de Produtos v2 gravar "Quem pode ver"): a regra de entitlement existe hoje três vezes com semânticas diferentes (`src/server/db/platform-store.ts`, `src/server/access/lesson-access.ts`, `src/server/access/learning-catalog.ts`); `is_locked` já foi retirado das decisões de autorização em 01/10/2026, mas segue como campo. Passa a existir um só resolver em `src/server/access` consumido por home, catálogo e aula, com testes comportamentais (não regex) de `requireLessonAccess` e `getActiveContentEntitlements`, e o critério "card liberado na home nunca devolve 403 na aula".

**Edição concorrente**: toda entidade editável carrega `updated_at`; o Server Action recebe o `updated_at` lido e falha com 409 se mudou. A UI mostra "Alterado por Fulano há 2 min — Recarregar / Sobrescrever". Renomear inline (autosave) usa a mesma checagem. Uploads TUS guardam `provider_upload_id` em `video_assets` e a impressão digital do arquivo em `localStorage`, para retomar depois de recarregar o painel.

**Jobs**: hoje importações, transcrições e processamento do Tutor rodam dentro do request com `export const maxDuration = 60` em 9 rotas, sem fila, retomada nem registro de execução. Inngest (ou Trigger.dev, decisão da equipe; ambos previstos em `AGENTS.md`) entra já na fase 1 para importações e transcrições. Para o tick de minuto (lembretes, envios, rollups horários): `pg_cron` + `pg_net`, que **não estão instalados** (as migrações só criam `pgcrypto` e `supabase_vault`). Migração própria: habilitar as extensões, guardar o segredo da rota no `vault`, chamar `POST /api/jobs/tick` assinado, com tabela `job_runs` (início, fim, erro, tentativas) e dead-letter após 3 falhas; o recomputo de `student_facts` roda à noite, nunca por minuto no primário. Vercel Cron só como redundância diária (Hobby é 1x/dia).

**Auth e segurança**: `proxy.ts` substitui `middleware.ts` (codemod oficial), runtime Node; `getClaims()` com chaves assimétricas ativadas primeiro no staging, com **fallback para `getUser()` por flag**; um único `getUser` por request (hoje são dois: `middleware.ts:147`, na raiz do repositório, e `src/server/auth/session.ts:20`). Tabelas novas com RLS deny para `authenticated` e acesso via rotas/Server Actions; tabelas por aluno com `auth.uid() = user_id`. `POST /api/events` com rate limit por usuário e IP, `occurred_at` do cliente limitado a ±5 min, `user_id` sempre da sessão; a policy "Students can create own events" (`202606150003:98-102`) e os inserts diretos do browser (`login-experience.tsx:193`, `password-change-experience.tsx:97`) são removidos. `GET /r/:token` só redireciona para o `checkout_url` **da promoção dona do token** (sem open redirect). Imagens: recorte e redimensionamento **no cliente** (WebP 720×1040 para capa, 1920×720 para hero, ≤ 150 KB), validação de dimensões no servidor, upload para o Storage e só a referência no banco; `images.remotePatterns` para o host do Storage; sem `sharp` no bundle serverless. `readBoundedJson` em todas as rotas; webhooks com assinatura, idempotência e payload bruto.

**Papéis e permissões** (decisão de 15/10/2026, depois de pesquisa de mercado: Hotmart, Kiwify, Eduzz, Memberkit, Cademí, Greenn, Ticto, Teachable, Thinkific, Kajabi, LearnWorlds, Podia, Circle, Skool, Mighty Networks, Stripe, Shopify, Intercom, Linear, Notion, GitHub e o guia de autorização da OWASP; funções combináveis e personalizadas no mesmo dia, a pedido do produtor).

Modelo: permissões finas por ação (`src/server/auth/roles.ts`), cada uma valendo **na escola toda** ou **só nos cursos escolhidos da pessoa**. Podem valer por curso: montar módulos e aulas, criar cursos, editar os detalhes, publicar, responder e moderar; o resto (acesso e venda inclusive) vale sempre na escola toda. Uma **função** é um pacote dessas permissões, cada uma com o seu alcance:

- **Funções prontas**: Administrador, Editor de conteúdo, Professor (tudo só nos cursos dele), Suporte e Analista. O **Dono** fica à parte: é exclusivo e pode tudo.
- **Funções personalizadas** (`admin_functions`): o dono dá um nome, junta funções prontas ("Professor + Suporte") e marca ou desmarca permissões, com o alcance de cada uma. Uma função pronta vira ponto de partida em "Duplicar e ajustar". Mudar a função muda para todo mundo que a tem; função com alguém nela não é excluída.
- **Pessoa**: uma ou mais funções, mais **permissões extras só dela** (ex.: "Criar cursos, só nos cursos dela" para um professor específico). Na tela, o que já vem das funções aparece travado, com a origem; numa permissão que a função dá só nos cursos, o extra "Escola toda" libera para aquela pessoa. Extra que as funções já dão igual não conta nem é gravado.
- **Soma**: funções e extras se somam, e a escola toda vence "só nos cursos". Pré-requisitos entram com o mesmo alcance: criar cursos traz editar os detalhes e montar módulos e aulas; exportar CSV traz ver dados pessoais. Restringir uma permissão aos cursos restringe junto o que ela exige, a não ser que outra permissão da escola toda ainda precise.
- **Cursos da pessoa**: escolhidos na tela dela quando alguma permissão vale só nos cursos (até 100). Sem lista, nenhum curso (nunca "todos"). Curso criado por quem cria só nos próprios cursos entra na lista dela sozinho, num UPDATE só no banco (`admin_add_course_to_member_scope`), que não desfaz o que o dono mudou ao mesmo tempo.
- **Criar curso sem "Regras de acesso e venda"**: o curso nasce só para quem tiver acesso, sem link de venda e fora de formação (importar playlist também), e Formação não aparece entre os formatos; a tela nem mostra "Quem pode ver" e "Link de compra". Quem cuida de acesso e venda decide depois. Publicar é outra permissão, e quem publica só nos próprios cursos não publica uma formação que levaria junto curso de fora da lista.
- **O que se abre sem compra na área do aluno**: o que a pessoa enxerga no catálogo do admin. O alcance do catálogo (`catalogScope` em `src/server/auth/roles.ts`) segue esta regra:
  - Alguma permissão de catálogo valendo na escola toda (montar aulas, criar cursos, editar os detalhes, acesso e venda, publicar, excluir ou ver os números): catálogo inteiro no admin e todos os cursos sem compra na área do aluno.
  - Permissão de catálogo só nos cursos e nenhuma na escola toda (o Professor sozinho, por exemplo): só os cursos dela.
  - Nenhuma permissão de catálogo: quem só tem permissões da escola toda (Suporte, por exemplo) enxerga tudo; quem tem alguma permissão só nos cursos (uma função só de comunidade por curso, por exemplo) ou ficou sem permissão porque a função não abriu (excluída ou ilegível) fica nos cursos dela. Função que não abriu nunca vira "escola toda".
  - Exemplo: Professor + Analista vê o catálogo inteiro e abre todos os cursos, porque "ver os números" vale na escola toda; Professor + Suporte vê só os cursos dele, porque o Suporte não traz permissão de catálogo.
  - A Comunidade tem alcance próprio (`communityScope`), decidido só por responder e moderar: Professor + Suporte responde em todos os cursos, mas no catálogo continua só nos dele.

Gravação em `admin_roles` (uma linha por pessoa; `permissions` é jsonb lido sem confiar: ação desconhecida, função que não existe mais e id inválido são descartados, e função personalizada que não pode ser lida não dá nada):

- Dono: `role = 'owner'`, `{}`.
- Uma função pronta sem extras: `role` é a própria função (`instructor`, `support`...), com `{ "productIds": [...] }` quando há permissão por curso. Linha de papel pronto vale exatamente o papel.
- O resto: `role = 'custom'`, `{ "functions": [...], "actions": [...extras], "scopedActions": [...extras só nos cursos], "productIds": [...] }`. O Personalizado da primeira versão (`{ "actions": [...] }`) aparece como "Só permissões extras", sem perder nada.
- `admin_functions` (migração `202610170001`): nome único sem diferenciar maiúsculas, descrição, `actions` e `scoped_actions` (dentro de `actions`); RLS ligado e sem política: só o servidor lê e grava.

O que seguimos do mercado: titular com o que não se delega (equipe e chaves de venda), admin "quase dono" sem chaves de venda, papel de conteúdo preso aos cursos atribuídos, suporte sem financeiro nem configurações, conta própria por convite, exportar como permissão à parte, último dono protegido e ninguém mudando a própria função. Funções personalizadas e permissões por pessoa, que lá fora costumam ficar em planos caros, entram porque as brasileiras que também vendem (Hotmart, Ticto, Eduzz) oferecem e o produtor pediu ("funcionário com funcionalidades específicas", "um professor específico ou todos criando curso", "combinar Professor com Suporte").

| Permissão | Dono | Admin | Editor | Professor | Suporte | Analista |
|---|---|---|---|---|---|---|
| Ver os números (Visão geral, desempenho) `reports.read` | sim | sim | sim | não | não | sim |
| Montar módulos e aulas `catalog.content` | sim | sim | sim | só nos cursos dele | não | não |
| Criar cursos e importar playlist `catalog.create` | sim | sim | sim | não | não | não |
| Editar os detalhes do curso `catalog.write` | sim | sim | sim | não | não | não |
| Regras de acesso e venda, formações e pacotes `catalog.access` | sim | sim | sim | não | não | não |
| Publicar e arquivar `catalog.publish` | sim | sim | sim | não | não | não |
| Excluir produto `catalog.delete` | sim | sim | não | não | não | não |
| Área de membros `storefront.write` | sim | sim | sim | não | não | não |
| Alunos: lista `students.read_basic` | sim | sim | nome e e-mail | não | sim | não |
| Alunos: dados pessoais `students.read_personal` | sim | sim | não | não | sim | não |
| Alunos: liberar e remover acesso `students.access` | sim | sim | não | não | sim | não |
| Alunos: excluir e exportar CSV | sim | sim | não | não | não | não |
| Comunicação: criar e publicar até 500 alunos | sim | sim | sim | não | não | não |
| Comunicação: acima de 500 `messaging.publish_large` | sim | sim | precisa de aprovação | não | não | não |
| Comunidade: responder e moderar | sim | sim | sim | só nos cursos dele | sim | não |
| Configurações › Tutor IA `settings.ai` | sim | sim | não | não | não | não |
| Configurações › Vendas (chaves) `settings.sales` | sim | não | não | não | não | não |
| Configurações › Equipe `settings.team` | sim | não | não | não | não | não |

Equipe e chaves de venda nunca entram numa função personalizada nem como extra.

Regras:

- **Servidor decide.** Toda Server Action passa por `runAdminAction(ação, schema, input, handler, { target })`; toda rota `/api/admin/**`, por `requireApiRole(ação, alvo)`; páginas, por `requirePageArea(área)`, `requirePageRole(ação)` ou `requireProductPage(id)`. As permissões da pessoa são calculadas uma vez por requisição (`loadAdminAccess`, `src/server/auth/admin-access.ts`). Menu, busca global e atalhos mostram só o que a pessoa pode abrir (`visibleAdminNav`), mas isso é conveniência.
- **Escopo por curso.** Cada ação que pode valer por curso diz o que toca (produto, módulo, aula ou comentário). Quando, para aquela pessoa, a ação vale só nos cursos, `requireScope` resolve até o produto dono (`src/server/auth/product-scope.ts`, lendo também a lixeira) e confere. Sem alvo, recusa (negar por padrão).
- **O que vê quem tem permissões só nos cursos** (o Professor, por exemplo). "Meus cursos", com as abas que as permissões abrem: Conteúdo; Detalhes para quem edita ou publica; "Acesso e venda" só para quem cuida disso ou vê os números. Pacotes só com acesso e venda; Importar e Novo produto só com criar cursos. A Comunidade, um curso dele por vez (a não ser que responder ou moderar valha na escola toda). A busca, só nos cursos dele. Na área do aluno, os cursos dele abrem como acesso liberado, sem virar compra; aulas com liberação programada seguem a regra. O "Ver como aluno" é só de quem vê o catálogo da escola toda.
- **Área sem permissão** some do menu, e a página leva para a primeira área da pessoa: o Professor cai em Meus cursos; o Suporte, em Alunos (ele não vê os números da escola nem a página do produto: trabalha com o filtro por produto e as ações em massa de Alunos, e o "Abrir aula no admin" da Comunidade some para ele).
- **Conta da equipe não muda por Alunos.** Adicionar aluno recusa e-mail da equipe. Enviar e-mail de acesso também recusa conta da equipe. Dados da equipe, só o dono muda. Sem isso, quem libera acesso conseguiria gerar a senha do dono e entrar como ele. Liberar curso para alguém da equipe continua valendo.
- **Dados pessoais.** Sem "ver dados pessoais", telefone e histórico nem saem do servidor, e editar o aluno mantém o telefone gravado. Exportar CSV exige ver dados pessoais, porque o arquivo leva telefone.
- **Configurações › Equipe**, só o dono, com as abas Pessoas e Funções:
  - adicionar por e-mail: conta existente que já entrou só ganha as funções; conta nova é criada, as funções são gravadas e auditadas, e só então sai o e-mail para criar a senha. Conta que nunca entrou também recebe o e-mail, e a senha antiga dela (uma senha temporária de Alunos, por exemplo) é trocada por uma aleatória antes;
  - mudar funções, extras e cursos, com gravação condicional por `updated_at`;
  - reenviar convite (só para quem nunca entrou);
  - tirar da equipe: a conta continua, como aluno;
  - criar, editar e excluir funções personalizadas (excluir só sem ninguém na função).
- **Ninguém muda a própria função, e a escola nunca fica sem dono.** O servidor confere e o gatilho `guard_last_admin_owner` confere de novo, com uma trava de transação que enfileira as mudanças de dono sem risco de deadlock (migração `202610160001`).
- **Mudança vale na próxima requisição** da pessoa, inclusive a de uma função personalizada: as permissões são lidas a cada requisição, sem derrubar a sessão.
- **Auditoria.** Toda ação de acesso, exportação, publicação de aviso e mudança na equipe grava em `admin_audit_log` (`team.member_added`, `team.member_updated` com antes e depois, `team.member_removed`, `team.invite_resent`, `team.function_created`, `team.function_updated` com antes e depois, `team.function_deleted`).

Próximos passos, fora desta entrega:

- 2FA obrigatória para a equipe (Supabase TOTP, `aal2`);
- pedir a senha de novo para exportar e mudar a equipe;
- Professor vendo os alunos dos próprios cursos (nome e progresso, sem e-mail e telefone);
- separar chaves de IA dos limites de IA;
- Admin vendo a equipe sem poder mudar.

### 2.4 Modelo de dados

**Pré-requisitos (fases 1–2)**

- `students.user_id uuid` com FK para `auth.users`, preenchido por script idempotente com relatório de não casados (hoje o vínculo é só por e-mail, `platform-store.ts:2796-2830`); aluno sem conta = `user_id null` = "Sem conta".
- Datas do CRM (`students.joined_at/first_access_at/last_activity_at`, `student_courses.starts_at/ends_at`) de `text` para `timestamptz` + coluna de status, com **`legacy_text` preservada** e relatório das linhas não parseáveis ("Vitalício", "Agora", "Nunca acessou") para revisão manual antes de apagar.
- `lesson_progress.user_id` e `saved_items.user_id` de `text` para `uuid` com FK, na ordem: coluna nova `user_uuid` → dual write (`replaceCompletedLessons`, heartbeat da TV em `tv-sessions.ts`, saved-items) → troca de leitura e das policies que comparam `auth.uid()::text` → drop da antiga. Teste de regressão: CAS do progresso e TV concorrentes.
- `cohort_memberships(cohort_id, user_id, entitlement_id)`; `entitlements.cohort_id`.
- `lesson_progress`: `first_started_at` por aula dentro de `lesson_watch_states` (ou normalização em 1 linha por aula, que também resolve o CAS).
- Índices: `student_events (event_type, occurred_at desc)`, `(entity_type, entity_id)`; `lesson_comments (status, created_at desc)`; `entitlements (user_id, status, target_type, target_id)`; `lessons (module_id, status, sort_order)`; trigram em títulos e e-mail.
- Remoção das cópias JSON `entitlements`, `metrics`, `chartPoints`, `pipeline`, `webhookEvents`, `moderationItems`, `aiAgents` de `platform_settings` (fase 3).
- `home_sections` / `home_section_items`: existem, têm RLS e **zero uso em `src/`** (a vitrine lê a chave JSON `homeSections` de `platform_settings`, `platform-store.ts:762, 1170`). **Decisão: adotar as tabelas** na fase 6 (editor da Home do aluno), com script de migração do JSON e leitura dupla até o corte; isso dá `section_id` estável para `home_card_impressed/clicked` e CTR por fileira.
- Cor do produto em `content_page_settings.settings->>'accent'` (a tabela é só `content_id` + `settings jsonb`; sem coluna nova), validada contra os seis presets no servidor; não em `content_items`, porque `content_page_settings` já concentra a apresentação por produto.
- `video_config` existentes (`youtube`, `vimeo`, `bunny`, `mux`, `custom_url`, `embed_code` já são aceitos por `src/lib/video-embed.ts`): continuam válidos e editáveis desde a fase 1; na fase 4, aulas já em Bunny/Mux por `assetId` viram `video_assets` por importação do id existente, sem reenvio de arquivo. `embed_code` fica restrito a uma allowlist de hosts cadastrada em Configurações › Vídeo, que alimenta `frame-src`.
- `lesson_ratings(user_id, lesson_id, reaction, rated_at)` materializada a partir do mapa jsonb `lesson_progress.lesson_reactions` (`rated_at` nulo para o legado) e alimentada pelo evento `lesson_rated` daí em diante; é o que permite janela por período na avaliação da aula.
- Liberação: os modos reais são `immediate`, `fixed_date`, `after_enrollment`, `after_purchase`, `after_previous_lesson` e `activity_required` (indisponível) em `src/server/access/release-policy.ts`; "depois de ganhar acesso" colapsa `after_enrollment` e `after_purchase` em um modo `after_access` por script de migração.
- Migração para 2 estados: script em modo **dry-run** que lista "estes N produtos vão mudar de X para Y" (regra: `publicationStatus` vira Situação; `accessModel` + `isLocked` + `purchaseUrl` viram Quem pode ver; `status` textual é descartado e "Em breve/Novo" passam a ser derivados) com relatório de casos ambíguos; o produtor confirma a prévia antes de aplicar; `content_items.status` continua preenchido por derivação no servidor até a área do aluno parar de lê-lo (fase 3), e as colunas globais `content_items.progress`, `course_modules.progress`, `lessons.completed` são removidas na fase 6 com atualização de `docs/05`.

**Tabelas novas (resumo)**

| Tabela | Campos principais | Fase |
|---|---|---|
| `student_facts` | `user_id pk`, `entitlement_keys[]`, `cohort_ids[]`, `tags[]`, `last_watch_at`, `lessons_completed`, `comments_30d`, `reactions_30d`, `tutor_messages_30d`, `last_sign_in_at`, `email_opt_in`, `whatsapp_opt_in`, `has_push`, `updated_at` (triggers incrementais + recomputo noturno) | 2 |
| `audiences` | `id`, `name`, `definition jsonb` (grupos E/OU), `kind dynamic/static`, `last_count`, `last_counted_at`; `audience_static_members` | 2 |
| `admin_audit_log` | `actor_id`, `action`, `entity_type`, `entity_id`, `metadata`, `occurred_at` | 2 |
| `lesson_watch_segments` | append-only, particionada por mês: `user_id`, `lesson_id`, `content_id`, `started_at_seconds`, `ended_at_seconds`, `playback_rate`, `player_mode`, `session_id`, `occurred_at` | 3 |
| `student_daily_activity` | `user_id`, `day`, `watched_seconds`, `lessons_completed`, `comments`, `tutor_messages` | 3 |
| `lesson_daily_stats` | `lesson_id`, `day`, `starts`, `completions`, `completions_manual`, `watched_seconds`, buckets 25/50/75/90 | 3 |
| `product_cohorts` | `content_id`, `cohort_month`, `started`, `activated_7d`, `completed_30d`, `completed_90d`, `retained_w1/w2/w4/w8` | 3 |
| `job_runs` | `job`, `started_at`, `finished_at`, `status`, `attempts`, `error` | 1 |
| `video_assets` | `provider`, `status` (pending_upload → uploading → processing → ready / failed / archived), `provider_library_id`, `provider_asset_id`, `provider_playback_id`, `provider_upload_id`, `privacy_hash`, `thumbnail_url`, `duration_seconds`, `playback_policy`, `captions jsonb`, `error_message`; `lessons.video_asset_id` | 4 |
| `video_provider_events` | `provider`, `event_type`, `provider_asset_id`, `payload jsonb` bruto, `signature_valid`, `idempotency_key unique`, `received_at`, `processed_at` | 4 |
| `notifications` | `user_id`, `kind`, `title`, `body`, `href`, `campaign_id`, `event_id`, `read_at`, `created_at` | 5 |
| `campaigns` | `name`, `kind` (popup/banner/card/hero/toast/inbox), `tier`, `priority`, `status` (inclui `pending_approval`), `approved_by`, `content jsonb`, `audience_id`, `channels jsonb`, `starts_at`, `ends_at`, `frequency jsonb`, `goal_event_type`, `attribution_days`, `revision`, `created_by` | 5 |
| `campaign_deliveries` | `campaign_id`, `user_id`, `impressions`, `first/last_seen_at`, `clicked_at`, `dismissed_at`, `snoozed_until`, `converted_at`; `message_events` (append-only); `campaign_daily_stats` | 5 |
| `events` / `event_registrations` | webinário: `title`, `starts_at`, `ends_at`, `provider`, `join_url`, `visibility`, `audience_id`, `capacity`, `replay_lesson_id`, `status`; inscrição: `status`, `source_campaign_id`, `reminder_24h_sent_at`, `reminder_1h_sent_at`, `joined_at` | 5 |
| `communication_preferences` / `consent_log` / `push_subscriptions` / `scheduled_sends` | preferências por canal e tema, `unsubscribe_token`; registro de consentimento com origem e IP; VAPID; fila idempotente por (campanha, aluno, canal) | 5 |
| `offers` / `attribution_clicks` | promoção: `content_id`, `badge`, `price_label`, `coupon_code`, `checkout_url`, `provider`, `starts_at`, `ends_at`, `audience_id`; clique: `click_token unique`, `user_id`, `campaign_id`, `offer_id`, `clicked_at`, `converted_at`, `webhook_event_id` | 6 |
| `webhook_events` | `provider`, `external_event_id`, `payload jsonb` bruto, `signature_valid`, `processing_status`, `outcome`, `outcome_detail`, `error_message`, alvo e aluno resolvidos → entitlements (feita em 17/10/2026, com `integration_settings` e `sales_product_links`; docs/05) | 6 |

**LGPD: exclusão e retenção.** "Excluir aluno" roda um job que: revoga entitlements; substitui nome/e-mail/telefone em `profiles` e `students` por valores anonimizados; mantém `lesson_progress`, `lesson_comments` (corpo substituído por "[comentário removido]" se o aluno pedir), `student_events`, rollups e `campaign_deliveries` apenas com o `user_id` pseudônimo; apaga `ai_conversations`/`ai_messages` daquele aluno; remove `push_subscriptions` e `communication_preferences`; registra em `admin_audit_log`. Retenção padrão: `message_events` e `student_events` 24 meses; `lesson_watch_segments` 12 meses (rollups permanecem); `webhook_events` e `video_provider_events` 12 meses (feito para `webhook_events` em 17/10/2026 por `public.prune_personal_data()`, que também anonimiza `email_outbox` em 90/180 dias e apaga `email_webhook_events` em 90 dias; `docs/06`, seção LGPD); `admin_audit_log` 5 anos. Nenhum PII vai ao PostHog além do id.

### 2.5 Taxonomia de eventos

Catálogo único em `src/server/events/catalog.ts` (união tipada + schema zod por evento), nomes `objeto_verbo_passado` em snake_case, iguais em Postgres e PostHog, `distinct_id = auth.users.id`. Propriedades comuns: `event_id` (uuid do cliente, para dedupe e `$insert_id`), `session_id`, `occurred_at` (cliente) + `received_at`, `surface` (web/tv), `path`, `content_id`, `module_id`, `lesson_id`, `video_provider`, `player_mode` (embed / native / **synthetic** / tv), `app_version`.

**O que já existe** (confirmado nas migrações; 15 tipos por trigger + 4 da aplicação): `user_signed_in`, `password_changed`, `access_email_sent`, `temporary_password_created`; `lesson_comment_created/reply_created/reacted/reaction_removed/reported`; `lesson_tutor_question_created/answer_completed`, `platform_guide_*`, `*_conversation_deleted_by_student`; `lesson_tv_session_created/connected/session_ended/command_sent`. Correções: triggers de comentário passam a gravar `author_role` e emitir `reaction_removed` na troca; `access_email_sent` migra para `admin_audit_log`; `lesson_tv_command_sent` rebaixado para PostHog. A fila de perguntas e a mediana de resposta já são computáveis hoje porque `lesson_comments` tem `author_role` e `parent_comment_id` (migração `202607100001`); a correção dos eventos é complementar.

**Primeira leva (fase 2, em paralelo a Produtos/Alunos)**: `lesson_started` (`is_rewatch`, `entry_point`), `lesson_progress` (heartbeat de 15 s com `watched_seconds_delta`, `position_seconds`, `max_progress_percent`, `playback_rate` → `lesson_watch_segments`, nunca `student_events`), `lesson_completed` (`completion_source` player/auto/manual/admin), `lesson_rated`, `home_viewed`, `home_card_impressed/clicked` (`section_id`, `position`), `content_opened`, `purchase_cta_clicked`, `search_performed`, `saved_item_toggled`, `entitlement_granted/revoked/expired` (servidor).

**Segunda leva (fase 5–6)**: `message_delivered/impressed/clicked/dismissed/converted`, `webinar_registered/attended`, `comment_replied_by_staff` (`hours_to_reply`), `video_seeked/errored`.

**Destinos**: eventos discretos e acionáveis em `student_events`; heartbeat só em `lesson_watch_segments`; tudo espelhado no PostHog com `$insert_id`. **Volume**: heartbeat de 15 s × 10 h/mês × 2.000 alunos ≈ 4,8 milhões de eventos/mês, acima do free tier do PostHog (1 milhão); por isso o heartbeat **não** vai ao PostHog (só o agregado por sessão em `lesson_paused/ended`), e `page_viewed` é amostrado a 20 % se necessário. `player_mode = synthetic` (o cronômetro de +10 s a cada 10 s em iframes, `lesson-experience.tsx:2469-2497`) é gravado mas **excluído dos rollups** até os adaptadores existirem.

**Backfill**: `lesson_watch_states` já guarda `lastWatchedAt`, `maxProgressPercent` e `durationSeconds` por aula; um backfill único popula `student_daily_activity` e `student_facts.last_watch_at` com rótulo "aproximado", para o dashboard não nascer vazio. A faixa "Coleta de eventos de aula ativa desde DD/MM" marca o corte.

### 2.6 Vídeo: adaptador, provedores, Modo TV e migração

**Interface** `LessonPlayerAdapter`: `mount(container, source, {startSeconds, rate, volume, muted, captionsLanguage})`, `destroy`, `play`, `pause`, `seek`, `getCurrentTime`, `getDuration`, `getState`, `setRate`, `setVolume`, `setMuted`, `setCaptions`, `on(handler)`; eventos `ready`, `timeupdate` (normalizado a 4 Hz), `play`, `pause`, `seeked`, `ended`, `ratechange`, `error` (códigos neutros: `embed_blocked`, `not_found`, `token_expired`, `network`). O hook `useLessonPlayback(adapter, lesson)` substitui as ~1.500 linhas de estado do YouTube em `lesson-experience.tsx`: heartbeat, flush com `sendBeacon` em `pagehide` (hoje inexistente), `maxProgressPercent` monotônico (a regra dos 30 % para avaliar, `lesson-experience.tsx:2533`, continua intacta), retomada, seek do Tutor, Modo TV.

**Implementações**: YouTube pela IFrame API padrão, iframe sem recorte, **nenhum elemento sobre o retângulo do player**, controles Bunker707 fora dele, legendas nativas; Bunny com iframe `player.mediadelivery.net/embed/{lib}/{guid}` + `player.js`, token `SHA256(key + videoId + expires)` gerado em `GET /api/lessons/{id}/playback` depois de `requireLessonAccess`, upload TUS assinado no servidor, webhook HMAC, Transcribe pt sob demanda (confirmar pt-BR na biblioteca antes de prometer o botão); Vimeo via `@vimeo/player` com hash `h` e `dnt=1`; Mux Player com JWT RS256; HLS genérico com hls.js. Tokens nunca persistidos; CSP e Permissions-Policy geradas da lista de provedores habilitados (hoje `frame-src 'self' https:` em `middleware.ts:34` aceita qualquer iframe); `embed_code` só com hosts da allowlist de Configurações › Vídeo.

**Modo TV com provedores tokenizados**: o receptor não tem sessão do aluno, então o servidor resolve a fonte do vídeo na criação da sessão (`tv_sessions`) e expõe `GET /api/tv/receiver/{sessionId}/source`, autenticado pelo código da sessão, que devolve a URL com token de curta duração e é chamado de novo quando o adaptador emite `token_expired`. O receptor hospeda o iframe da Bunny e envia play/pause/seek via `player.js`; sua CSP inclui `player.mediadelivery.net` e `*.gstatic.com` (Chromecast). O contrato de comandos em `src/lib/tv-session-contract.ts` fica; `quality` vira opcional. **Antes do adaptador existir**, quando a flag desligar a extração não oficial, o receptor cai para o embed oficial do YouTube (que ele já usa): o aluno perde só a seleção manual de qualidade, não o Modo TV.

**Extração não oficial** (`src/server/video/youtube-streams.ts`, `youtube-captions.ts`, rotas `/api/video/youtube/*` e `/api/tv/receiver/*/streams|captions`): flag `YOUTUBE_UNOFFICIAL_STREAMS` criada na **fase 0**, com aviso no admin; desligada na fase 4; código removido um ciclo depois.

**Troca de vídeos em massa** (fase 4): tela no produto com o estado por aula; o produtor arrasta vários arquivos (nome casado com o título da aula por heurística, confirmável); fila TUS com retomada; a aula mantém `video_config` antigo até `status = ready` e então recebe `video_asset_id`; thumbnail do provedor copiada para `lesson.image`. Aulas já cadastradas em Bunny/Mux por embed entram pela importação do `assetId` existente, sem reenvio. Nada é baixado do YouTube pelo sistema.

**Custos (estimativas)**: premissas de 4,5 GB armazenados por hora de catálogo e 1,8 GB por hora assistida (mix 720p/1080p). Bunny rede Volume (storage em duas regiões, Frankfurt + São Paulo, a US$ 0,01/GB cada): cenário (a) 100 h / 300 alunos × 10 h ≈ US$ 9 de storage + US$ 27 de entrega ≈ **US$ 36/mês**; cenário (b) 500 h / 2.000 alunos ≈ **US$ 225/mês**; rede Standard na América do Sul (US$ 0,045/GB) elevaria para ≈ US$ 252 e ≈ US$ 1.665. Transcribe US$ 0,10/min/idioma (≈ US$ 600 uma vez para 100 h). DRM Enterprise Bunny US$ 99/mês + licenças (só para cursos premium). Mux (1080p basic, já descontado o crédito mensal de US$ 20 do pay-as-you-go): ≈ US$ 78 (a) e ≈ US$ 1.170 (b); DRM US$ 100/mês + US$ 0,003/licença. Cloudflare Stream: ≈ US$ 210 (a) e ≈ US$ 1.350 (b). Vimeo self-serve: teto de 2 TB/mês de banda segundo a central de ajuda (o cenário (a) usa ≈ 5,4 TB) e remoção da logo só a partir do plano Standard. Panda Video: ≈ R$ 708/mês (a), cobrado em reais.

### 2.7 Regras de design verificáveis (checklist de PR)

Tudo escopado em `[data-scope="admin"]` para não vazar para a área do aluno. Herda de `docs/12` (Inter, fundo escuro constante, botão primário claro, sem excesso de cards) e das referências visuais (sidebar escura com ícones, cards arredondados sobre quase preto, KPI com número grande e delta, uma cor de acento por produto, gráficos suaves, tabelas densas, pill tabs, busca no topo).

**Tokens**
- [ ] Superfícies: `--surface-0 #0f0f10` (app), `--surface-1 #161617` (card), `--surface-2 #1c1c1e` (campo, hover), `--surface-3 #232326` (popover, sheet). Bordas `white/8` e `white/14`. Texto `#f5f5f4` / `#a1a1aa` / `#71717a`; desabilitado `#52525b`. Os gradientes radiais do `body` (`globals.css:84-87`) não entram no admin.
- [ ] O vermelho da marca `#e50914` só na marca, em ações destrutivas e no indicador "Ao vivo". Botão primário do admin é **claro** (`#f5f5f4` com texto escuro). Erro semântico `#f87171`. Verificável: `--primary` do admin ≠ `--destructive`; nenhuma classe `bg-red-*` fora de componentes destrutivos.
- [ ] Semânticas fixas: sucesso `#34d399`, aviso `#fbbf24`, erro `#f87171`, cada uma em 3 usos (texto, fundo 12 %, borda 30 %). Proibido `sky/blue/violet/orange` como categoria.
- [ ] **Uma cor por produto** em `content_page_settings.settings->>'accent'`, seis presets dessaturados: lima `#c4f05a`, laranja `#ffb257`, roxo `#b89cff`, bege `#d9c3a6`, ciano `#67e8f9`, rosa `#f0abfc`. Usados em chips, sparklines, avatar-fallback e séries quando o produto é a dimensão. Como texto sobre `#161617` todos ficam acima de 7:1 (estimativa; validar com axe no CI). Nunca vermelho.
- [ ] Paleta de dados: série 1 neutra `#e4e4e7`; série 2 = acento do produto filtrado (ou cinza médio `#a1a1aa` quando não há produto); período anterior `#52525b` tracejado; máximo 2 séries por gráfico de linha/área e 4 partes em empilhadas. `--chart-1/--chart-2` deixam de ser `#e50914`/`#ff7a1a` (`globals.css:57-58`) dentro do admin. Sem azul como série.
- [ ] Lint: classes de cor fora dos tokens proibidas em `src/app/admin/**` e `src/components/admin/**`; lint de strings com o dicionário proibido da seção 1.3.
- [ ] Vocabulário fechado (lint de strings): Segmento (nunca Público/Audiência), Aviso (genérico), Notificação (tipo do sino), Avisos recebidos (aba do perfil), Webinário (só o evento ao vivo), Promoção (nunca Oferta), Ritmo (estado de estudo do aluno), Situação (estado editável de produto, aviso ou acesso), Canais de envio (em Configurações).
- [ ] Delta de KPI: subida `#34d399`, queda `#f87171`, neutro `#a1a1aa`; `KpiTile` exige a prop `invertDelta` nas métricas em que subir é ruim (dispensa, falhas do Tutor, inativos, concluídas sem assistir).
- [ ] Sidebar: 240 px expandida, 64 px em modo ícones com tooltip; item ativo com fundo `--surface-2` e barra de 2 px em `#f5f5f4` (nunca vermelho); hover `white/4`. Topbar fixa de 56 px com busca de 320 px e avatar de 32 px.
- [ ] Abas de seção (página do produto, Comunidade) com sublinhado de 2 px; filtros com até 6 opções em pills; nunca os dois estilos na mesma linha.

**Tipografia e grid**
- [ ] Inter: 32/600 tabular (KPI), 24/600 (H1), 18/600 (H2), 16/600 (título de card), 14/400–500 (corpo e tabela), 13/500 (label e cabeçalho), 12/500 (meta). Nada abaixo de 12 px; `font-black` só em números de KPI; labels em caixa normal.
- [ ] Escala de 4 px; formulários 640 px; detalhe 2/3 + 1/3 até 1200 px; índices `max-w-[1440px]`; raio 8 px (cards, campos, botões), 6 px (chips), 12 px (dialogs); tabelas e árvore 40–48 px por linha; campos 40 px.

**Componentes**
- [ ] Card só com título próprio; nunca card dentro de card (`catalog-command-center.tsx:548-566`); listas comparáveis são tabelas; nenhuma badge antes do título.
- [ ] KPI: rótulo 13/500, número 32/600, delta com seta + "vs. período anterior", sparkline 100×28 sem eixos, `aria-label` com valor e período; 3 a 6 por tela, sempre na primeira linha; "—" sem dado.
- [ ] Gráficos permitidos: área/linha, barras horizontais ordenadas, empilhadas 100 % até 4 partes, bullet, heatmap 7×24. Proibidos: pizza, donut, gauge, radar, 3D, eixo duplo. Eixo de barras em zero; grade horizontal só; tooltip com linha de referência; mesma cor para a mesma série em toda a aplicação; skeleton da mesma altura; botão **Ver como tabela** em todo gráfico (acessibilidade e exportação).
- [ ] Tabelas: cabeçalho fixo 12–13 px; primeira coluna é o nome legível com avatar/capa 32 px; números à direita; status como chip neutro com ponto colorido; ≤ 2 ações inline + menu; filtros e página na URL; paginação server-side.
- [ ] Formulários: coluna única; label acima; "(opcional)" marcado; validação ao sair do campo; erro abaixo do campo com ícone; salvar explícito com `SaveBar`; `Cmd+Enter` salva; selects com ≤ 6 opções viram pills; switch com o efeito escrito; botão nunca desabilitado por validação.
- [ ] Estados: skeleton com a forma final após 300 ms (nunca o spinner de tela cheia de `src/app/admin/loading.tsx`); vazio com título, 1 frase e 1–2 botões; erro em banner persistente, nunca toast; sucesso em toast 3–4 s com "Desfazer"; nenhum `window.confirm` (hoje em `admin-dashboard.tsx:1466, 1544, 1621`).
- [ ] Motion: 100 / 150–200 / 250–300 ms; saída mais curta; `cubic-bezier(0.2,0,0,1)`; `prefers-reduced-motion`; números não "contam".
- [ ] Acessibilidade: contraste 4,5:1 texto, 3:1 bordas/estados/foco/séries; foco visível 2 px, inclusive na navegação `J/K` da fila; axe no CI para `/admin/**`.
- [ ] Responsivo: < 768 px sidebar drawer, tabela vira lista de cartões, KPIs em 2 colunas, Sheet em tela cheia abaixo de 1024 px; alvos ≥ 44 px; Lighthouse móvel em todo PR das fases 2 e 3.
- [ ] Componentes compartilhados obrigatórios: `PageHeader`, `KpiTile`, `AttentionCard`, `ChartCard`, `DataTable`, `EmptyState`, `SaveBar`, `SegmentPicker`, `ReleaseRulePhrase`, `VideoField`, `LessonSheet`. `MetricCard` deixa de ser reimplementado seis vezes.

### 2.8 Performance: plano e metas

Diagnóstico (de `.next/diagnostics/route-bundle-stats.json` e leitura do código): first load JS de 1,06 MB (home), 1,34 MB (aula), 1,93 MB (admin); `supabase-js` inteiro no cliente só para logout (`app-shell.tsx:31,154`); IA Diretor com react-markdown montado em toda página; heros PNG de 2,2–2,45 MB em `background-image`; `next/image` sempre `unoptimized`; 5 saltos de rede sequenciais por page view; progresso enviado a cada 3 s com ~6 idas ao banco por envio.

| Métrica (p75) | Hoje (estimado) | Meta | Como medir |
|---|---|---|---|
| Shell visível após clique | 800–2.000 ms | ≤ 100 ms | Lighthouse/Performance panel; evento `navigation_shell_visible` |
| TTFB página do aluno | 600–1.500 ms | ≤ 300 ms (home/curso), ≤ 500 ms (aula) | Speed Insights, `Server-Timing` (auth/db/render) |
| TTFB `/admin/*` | não medido | ≤ 400 ms, conteúdo em ≤ 1 s | idem |
| LCP home (móvel) | 4–8 s em 4G | ≤ 2,0 s | Speed Insights, Lighthouse CI |
| INP | em risco (scroll/hover) | ≤ 150 ms | Speed Insights |
| First load JS | 1.057 KB home / 1.342 KB aula / 1.935 KB admin | ≤ 450 KB / ≤ 650 KB / ≤ 700 KB por segmento | orçamento no CI lendo `route-bundle-stats.json` |
| Queries por page view do aluno | 15–17 | ≤ 5 | `pg_stat_statements`, contador no `Server-Timing` |
| Escritas de progresso por aluno/min | 20 | ≤ 4 | `pg_stat_statements` |
| Hero | 2,4 MB PNG | ≤ 250 KB AVIF | `du` no CI |
| `GET /api/messages/eligible` | — | p95 ≤ 50 ms de servidor | Server-Timing |

Ordem: (0) medir primeiro (Speed Insights, Sentry, `Server-Timing`, orçamento de bundle, Lighthouse CI) e **confirmar a região** (não há `vercel.json`; se o Supabase estiver em `sa-east-1`, fixar a função em `gru1`), aplicando já na fase 0 os ganhos rápidos do aluno que não dependem do admin novo (heros em AVIF, `supabase-js` fora do cliente, heartbeat de 15 s com `sendBeacon`, prefetch nos cards); (1) `proxy.ts` + `getClaims` + um só `getUser`; (2) admin novo já nasce por segmentos com `next/dynamic` para gráficos; (3) área do aluno na fase 6: `src/app/(aluno)/layout.tsx` com `AppShell` persistente e `loading.tsx` por segmento, overlay sem blur, prefetch nos links, catálogo em cache por tag, heros em AVIF via `next/image`, `remotePatterns`, `next/dynamic` para Diretor/Tutor/TV/player, remoção do `supabase-js` do cliente, progresso por RPC única a cada 15–30 s com `sendBeacon`; depois, `cacheComponents` + `partialPrefetching` com React Compiler. O endpoint de mensagens é carregado pelo `AppShell` **após a hidratação**, nunca dentro de `getAppShellData`, com campanhas ativas em cache compartilhado + 2 leituras por chave primária e ETag.

### 2.9 Testes e validação com o produtor

- O repositório tem 211 testes node (`tests/*.test.mjs`) e nenhum teste de componente ou e2e. Entra **Playwright** rodando contra o Preview Deployment no CI, com um aluno e um admin de teste: "criar produto com 2 módulos e 3 aulas", "publicar → aparece na home em < 2 s", "liberar acesso em 3 cliques", "pop-up aparece 1 vez por 24 h", "aula Bunny com progresso real". Métricas SQL: um arquivo por métrica com fixture e resultado esperado.
- **Protótipo clicável das 3 telas críticas** (Hoje, Criar produto + Conteúdo, Fila de perguntas) na fase 0, revisado com o produtor antes de codar.
- **Sessão de teste moderada** (think-aloud, 5 tarefas, produtor + 1 pessoa da equipe) ao fim das fases 1 e 3, e obrigatoriamente **antes de apagar `/admin/legado`**. As metas de 1.6.2 são medidas por dois eventos: `admin_product_created` (`seconds_since_form_open`, meta ≤ 30 s e ≤ 4 interações) e `admin_product_first_structure_completed` (tempo desde a criação até a terceira aula com vídeo reconhecido, meta ≤ 90 s), **e** confirmadas na sessão moderada junto com "entender o Hoje em 30 s".

### 2.10 Roadmap em fases, com critério de pronto

Cada fase entrega algo que o produtor usa e desliga a view antiga correspondente. Estimativas para um desenvolvedor em tempo integral (com agentes); fases 5 e 6 podem rodar em paralelo com uma segunda pessoa.

| Fase | Duração | Entrega | Critério de pronto |
|---|---|---|---|
| **0 — Fundações e honestidade** | 1 semana | Next 16.4 + patch de 14/10; `proxy.ts` + `getClaims` com fallback por flag; Turbopack em dev; Sentry, PostHog, Speed Insights; `app/admin/layout.tsx` com shell novo, tokens, componentes base e rotas-esqueleto; admin atual movido para `/admin/legado` (gravável); **hotfix no admin atual** removendo `|| 487/612/64/132/9/2` (`admin-overview.tsx:191-201`), séries sintéticas (`students-command-center.tsx:66-70, 143-152`), badges "RBAC ativo"/"Supabase persistido" e abas mortas; flag `YOUTUBE_UNOFFICIAL_STREAMS` com aviso no admin; migração `pg_cron`/`pg_net` + `job_runs`; Inngest configurado; protótipo clicável das 3 telas; lista "fora do MVP" publicada neste doc; **ganhos rápidos do aluno**: heros em AVIF ≤ 250 KB via `next/image`, logout por Server Action (tira `supabase-js` do bundle do aluno), heartbeat de progresso de 3 s para 15 s com `sendBeacon`, prefetch nos cards | nenhum fallback numérico no código; `/admin` pinta o shell em < 300 ms sem carregar tabela; TTFB da home cai ≥ 150 ms; LCP móvel da home ≤ 3,0 s em preview; protótipo aprovado pelo produtor |
| **1 — Produtos v2 + Comunidade v1** | 2 semanas | Lista, Novo produto, página do produto com Conteúdo (árvore, inline, DnD, colar links), painel de aula (YouTube, Vimeo, URL), Detalhes, Acesso e venda, Publicar com checklist, Ver como aluno, Importar playlist movido, Pacotes; capa com recorte e Storage; catálogo em `unstable_cache` por tag com `invalidateCatalog()`; **resolver único de acesso** e `requireRole` nas Server Actions e nas rotas legadas; `VideoField` lendo os seis provedores atuais em modo embed; "Ver como aluno" com rascunhos para quem tem `admin_roles`, sem gravar progresso; **Comunidade**: fila com responder inline, respostas rápidas, Top comentadores, Aulas com mais dúvidas (comentários + Tutor), Regras; alertas de Hoje já computáveis (perguntas, expirando, higiene de catálogo, Tutor com falhas, importação) | produto com 2 módulos e 3 aulas em < 2 min por usuário novo (medido); zero `window.confirm`; analyst recebe 403 em qualquer escrita; card liberado na home nunca devolve 403 na aula; e2e "publicar → home < 2 s" verde; primeira resposta do professor pelo admin aparece no sino do aluno (sino mínimo); views Catálogo, Estrutura, Combos e Moderação desligadas no legado |
| **2 — Alunos v2 + eventos mínimos** | 2 semanas | `students.user_id`, datas `timestamptz` com `legacy_text`, `cohort_memberships`, `student_facts`, `audiences`, `admin_audit_log`; lista paginada, segmentos salvos, Adicionar aluno, Importar CSV, perfil 360, liberar/estender/revogar por entitlement, exportação; alerta "Acesso sem conta" (depende de `students.user_id`); kill-switch do `PUT /api/admin/students`; `POST /api/events` + catálogo tipado + instrumentação do player e da home (primeira leva); fechamento da policy de insert do browser; migração `lesson_progress.user_id` iniciada (coluna nova + dual write) | liberar acesso em 3 cliques a partir do aluno ou do produto; aluno sem conta recebe convite automático; lista de 10 mil alunos responde em < 500 ms; `lesson_started/completed` chegando em `student_events`; os 4 fluxos no celular funcionam em 375 px; view Alunos desligada no legado |
| **3 — Hoje e métricas honestas** | 2 semanas | Rollups (`lesson_watch_segments`, `student_daily_activity`, `lesson_daily_stats`, `product_cohorts`), backfill de `lesson_watch_states`, RPC `admin_dashboard_kpis`; Hoje completo (atenção, 4 números, gráfico, por produto); ciclo de vida semanal no topo de Alunos; `lesson_ratings`; aba Desempenho; CTR por fileira; remoção dos JSONs decorativos de `platform_settings`; `content_items.status` deixa de ser lido pelo aluno; sessão de teste moderada | todos os números do Hoje batem com SQL de verificação; faixa "coleta ativa desde" visível; `synthetic` excluído dos rollups; nenhum KPI sem tooltip de fórmula; view Visão geral desligada no legado |
| **4 — Vídeo multi-provedor** | 2 semanas | `video_assets` + `video_provider_events`; adaptador + `useLessonPlayback`; Bunny (TUS, webhook, token, player.js, Transcribe), YouTube oficial com branding e sem overlays, Vimeo SDK, HLS; `VideoField` com detecção; Modo TV via adaptador e `GET .../source`; Trocar vídeos em massa; Configurações > Vídeo; CSP por provedor; extração não oficial desligada; piloto com 1 produto | progresso real (não cronômetro) em 100 % das aulas Bunny e Vimeo; aula YouTube sem elemento sobre o iframe; zero chamadas a `youtube.com/youtubei` no servidor; retomada e avaliação aos 30 % sem regressão (testes node) |
| **5 — Comunicação v1** | 2 semanas | `notifications` + sino completo; `campaigns`, `campaign_deliveries`, `message_events`, `campaign_daily_stats`; motor de elegibilidade com caps; `GET /api/messages/eligible`; pop-up, faixa, card, toast e hero no aluno; editor de aviso com prévia real e desfecho; relatório; `/perfil/notificacoes`, `consent_log`, descadastro sem login; Webinários com inscrição, `.ics`, lembretes por sino e e-mail (Resend), replay → aula | aviso segmentado para "Inativos 14 d" aparece 1 vez por 24 h, dispensa persiste, funil no relatório em < 1 min; webinário com lembretes de 24 h e 1 h entregues; p95 do endpoint < 50 ms; "pausar aviso" funciona no celular |
| **6 — Vendas, promoções e consolidação** | 2 semanas | Webhooks Hotmart/Ticto → entitlements (`webhook_events` bruto, assinatura, idempotência, regras de pacote); Promoções com `/r/:token` e atribuição; Home do aluno (Vitrine migrada para `home_sections`, Destaque com CTA, Marca); Configurações completas (Equipe, Vendas, Comunicação); **passe de performance do aluno** (layout de grupo, `cacheComponents`, imagens AVIF, `next/dynamic`, progresso por RPC); sessão de teste moderada; remoção de `/admin/legado` e de `admin-dashboard.tsx`; `platform-store.ts` sem leitores do admin; docs 04/05/09/12/13 atualizados | venda de teste na Ticto libera acesso em < 60 s; nenhuma rota do admin acima de 700 KB; home do aluno ≤ 450 KB e LCP ≤ 2,0 s em preview móvel; auditoria axe sem erros; `npm run verify` com orçamento de bundle |
| **7 — Crescimento** | contínuo | WhatsApp utility (Cloud API), push web (VAPID), A/B de avisos, automações 4×4 (concluiu aula/módulo/curso, marco %, inativo N dias, novo acesso → aviso, e-mail, tag, liberar bônus), Mux/Cloudflare, temas frequentes do Tutor, tema claro | reativação por aviso ≥ 5 % medida em 7 dias |

Total: ≈ 13 semanas até a remoção do legado. A ordem é negociável em um ponto: Comunicação (5) pode trocar com Vídeo (4) se um lançamento exigir, porque a segmentação básica já funciona com entitlements e progresso.

Custos recorrentes além do vídeo, a orçar antes da fase 5: serviço de jobs (Inngest ou Trigger.dev), e-mail (plano pago a partir do primeiro webinário com mais de 100 inscritos), PostHog (gratuito até 1 milhão de eventos/mês, a confirmar; o heartbeat de vídeo fica fora dele), Sentry (plano gratuito limitado), WhatsApp por mensagem entregue; Playwright no CI não tem custo de licença.

#### Registro da fase 1 (integração em 10/10/2026)

Decisões tomadas na implementação da fase 1. As decisões D1–D13 seguem a recomendação da tabela em 1.15.

- **"Oculto por enquanto" é coluna, não JSON:** `content_items.listing` (`listed`/`hidden`, migração `202610110010`). "Quem pode ver" = `access_model` + `listing`. É coluna porque filtra consultas (vitrine, Minhas compras, lista do admin) e precisa de check no banco; `content_page_settings` continua só com apresentação. O admin legado nunca grava `listing`. Detalhes em `docs/05`.
- **Excluir módulo ou aula com Desfazer:** `status = 'deleted'` + `deleted_at`/`deleted_by`, nada apagado nesta fase. As rotas DELETE do admin legado continuam apagando de verdade até as telas Catálogo e Estrutura do legado serem desligadas.
- **Painel da aula abre por `?aula=<id>`** na aba Conteúdo do produto (endereço próprio, Voltar fecha). `/admin/produtos/[id]/aulas/[lessonId]` só redireciona para esse endereço.
- **Comunidade com aba única Aulas** (ver 1.9). Os quatro números e as abas ficam em um componente (`CommunityFrame`) renderizado por cada página, e não em `comunidade/layout.tsx`, porque o layout não recebe `?produto=` e os números seguem o produto filtrado. Ficaram para depois: "Responder e marcar como FAQ", "Marcar como embaixador", "Enviar aviso", aprovação automática e resumo diário por e-mail.
- **Contador da Comunidade no menu:** perguntas sem resposta há mais de 24 h (`community_overdue_count`), lido no layout do admin; se falhar, o menu fica sem contador.
- **Configurações:** o primeiro item do submenu é "Todas as configurações" (a página é o hub); "Geral" é um dos cartões "Em breve". Tutor IA, Vitrine e Marca foram reescritas com os tokens do admin novo; os componentes do legado não mudaram.
- **Vitrine:** prévia simplificada (cards verticais dos produtos publicados e listados; fileiras que dependem do aluno mostram um aviso no lugar de itens inventados). A troca para as tabelas `home_sections` continua na fase 6.
- **Pacotes:** "Liberar pacote para um aluno" fica fora desta fase (D7: liberação retroativa só por botão manual, quando existir).
- **Produto:** a aba Alunos lista quem tem acesso ao produto (progresso nele, ritmo, entrou em), com "Liberar acesso" para alunos existentes e "Adicionar aluno" já com o produto marcado (14/10/2026); "Liberar acesso por e-mail", turmas editáveis, Duplicar e descrição longa ficam para a fase 2.
- **"Ver como aluno" com rascunhos fica para depois (adiado da fase 1):** o modo de prévia que mostra rascunhos para quem tem `admin_roles` mexe na leitura da área do aluno (`platform-store.ts` só lê o que está publicado) e sai junto com a troca da área do aluno para o cache do catálogo. Até lá o botão aparece sempre: em produto Publicado abre a página do produto; no painel da aula abre a própria aula (`/conteudo/{produto}/aulas/{módulo}?lessonId={aula}&accessPreview=producer`); em Rascunho (produto ou aula) fica desativado com "Disponível depois de publicar".
- **Reordenar aceita a estrutura que já existe:** a ordem completa vai inteira para `admin_reorder_product_content`, então o limite é o da importação de playlist (100 módulos, 500 aulas por módulo), e não o de criação (50 módulos, 100 aulas por módulo, 100 por colagem). Um curso importado com um módulo de 150 aulas continua reordenável, inclusive para dividir esse módulo.
- **Escritas de várias etapas são uma transação** (migração `202610110012`): `admin_patch_product_settings` muda só as chaves pedidas de `content_page_settings.settings` (cor, hero, apresentação) sem ler e regravar o JSON inteiro; incluir, tirar e reordenar cursos da Formação (`admin_add_course_to_formation`, `admin_remove_course_from_formation`, `admin_reorder_formation_courses`) e salvar Pacote (`admin_save_combo`) mudam tudo junto ou nada. Ordem desatualizada vira 409.
- **Importar playlist só cria curso novo:** se a playlist já virou curso (`youtube_course_imports`), "Ler playlist" mostra "Esta playlist já virou o curso X. Abra o curso para editar." com o link, e importar responde 409. A sincronização do admin antigo continua, mas a RPC `import_youtube_course` agora mantém a situação (Publicado continua Publicado) e a capa quando nenhuma capa nova vem, só exclui aulas da própria playlist (`yt-lesson-<playlist>-*`), não publica de novo aulas em Rascunho nem as que o produtor excluiu (`deleted_by` preenchido) e não esconde módulos que ainda têm aulas criadas pelo produtor.
- **Colar várias aulas:** as linhas que não viraram aula (link não reconhecido, além do limite de 100 por vez) ficam listadas embaixo do campo, cada uma com o motivo e "Corrigir", que traz a linha de volta para o campo.
- **"Ver aluno" na Comunidade** leva para a lista de Alunos já filtrada (`/admin/alunos?busca=Nome`).
- **Deploy antes da migração:** as migrações `202610110010`, `202610110011`, `202610110012` e `202610110020` podem ser aplicadas depois do deploy. A área do aluno e o admin legado não dependem delas; as telas novas que dependem mostram "Esta tela precisa da atualização do banco (migrações 202610110010-0020)" em vez de quebrar (`src/server/db/pending-migration.ts`).

#### Registro da rodada Área de membros (integração em 11/10/2026)

Pedido do produtor: "Quero poder editar login, escolher algum template de login que já tem disponível, home, módulos". Entregue em três frentes (Login, Destaque, Módulos) sobre uma fundação comum, **sem migração nova** (a numeração reservada `202610120001+` não foi usada). Tudo grava no banco e muda a área do aluno; nenhuma prévia sem gravação.

- **Menu e abas:** Área de membros → Vitrine, Destaque, Módulos, Login, Marca (mesma lista no menu lateral, nas abas e na migalha de navegação; `src/components/admin/v2/nav.ts` e `storefront/storefront-tabs.tsx`). Todas as páginas chamam `requirePageAdmin()` antes de ler dados e só liberam edição com `canRole(role, "storefront.write")`; em Módulos, "Como abre" e capa usam `catalog.write`. As duas permissões são de dono, administrador e editor: analista e suporte veem tudo em modo leitura, com aviso. As Server Actions decidem de novo (`runAdminAction`).
- **Onde grava (D1):** Login em `platform_settings.loginPage` (JSON `version: 1`, validado por zod no cliente e no servidor). Destaque em `platform_settings.hero` (a chave que a home já lia), com os campos novos `cta`, `poster` e `visibility.cta`. Fileira de módulos em `platform_settings.homeSections` (a Vitrine). "Como abre" em `content_page_settings.settings.coursePresentationMode` pela RPC atômica `admin_patch_product_settings`. Capa do módulo em `course_modules.image`. Formatos em `docs/05`.
- **Conflito de edição (D2/D3):** a versão de cada chave de `platform_settings` é a coluna `updated_at`, carimbada por toda gravação (o admin novo e as três gravações do `platform-store.ts`: vitrine, aparência e coleções do legado); a tabela não tem gatilho, que fica sugerido para a fase 6. A tela manda de volta a versão lida; mudou no meio, a gravação responde 409 "Esta configuração mudou em outra tela há instantes", a tela mostra um aviso fixo com "Recarregar" e o rascunho fica: em Login e Destaque, "Recarregar" segue o que está no banco e mantém os campos que o produtor mudou. A conferência é sempre no próprio UPDATE (`... where updated_at = <lida>`), nunca "confere e depois grava": isso vale também para a rota da Vitrine (`PUT /api/admin/home-sections`, usada pela Vitrine nova e pela antiga), que devolve a versão exata da gravação que acabou de fazer, nunca uma releitura.
- **Ações de estado desejado (D4):** ligar/desligar a fileira de módulos e trocar "Como abre" releem o banco na hora e aplicam só a mudança pedida (a fileira tenta de novo uma vez se alguém gravou a Vitrine no meio). Um clique em Módulos nunca apaga uma mudança da Vitrine, nem o contrário: a Vitrine nova passou a mandar a versão das fileiras ao publicar.
- **Fileira de módulos = Vitrine (D5):** `content_page_settings.homeModuleSection` não tinha efeito depois que a Vitrine é publicada; o interruptor "Mostrar os módulos numa fileira da home" (tela Módulos e aba Detalhes do produto) liga/desliga uma fileira `content_structure` do produto na Vitrine e cria uma ("compacta", para todos os alunos) antes de "Produtos à venda" quando ela não existe. Vitrine nunca publicada: a primeira gravação fixa a ordem padrão atual mais a fileira. `homeModuleSection` virou só espelho para o admin antigo.
- **Prévia real sem iframe (D6):** o app proíbe iframe (`X-Frame-Options: DENY`, `frame-ancestors 'none'`). A prévia desenha o componente do aluno (`LoginExperience`, `HeroSection`) dentro de `PreviewFrame` (tela de 1280 × 800 ou 390 × 844 reduzida, `inert`, com os tokens do aluno). Para isso os dois componentes respondem a container query e têm o modo `preview` (sem sessão, sem envio, sem pré-carregamento). Na área do aluno o resultado é o mesmo de antes (conferido por screenshot em 1280 e 390 px).
- **Imagens (D7):** recorte e WebP no navegador (`ImageField` com slot), envio ao Storage logo depois do recorte (`uploadMemberAreaImage`, que confere medida e peso no cabeçalho WebP), e só a URL no rascunho e no banco. Medidas: destaque 1920 × 720, login lateral 1200 × 1500, login de fundo 1920 × 1080, thumbnail do card e capa própria de módulo 2:3 até 720 × 1080 (sem ampliar imagens menores). Vídeo do destaque só por link https (`.mp4`, `.webm`, `.mov`), com capa obrigatória. Imagem enviada e depois descartada fica no Storage sem referência (aceito; limpeza fica para depois).
- **Cache (D8):** `/login` lê com `unstable_cache` (tags `member-area-login` e `catalog`, rede de segurança de 1 h); publicar o login chama `updateTag`. Se a leitura falha, o login cai no visual padrão sem guardar esse padrão em cache. Home e módulos são lidos sem cache hoje; mesmo assim toda gravação invalida o catálogo.
- **Login:** os quatro modelos ganharam nomes em português ("Formulário à esquerda", "Imagem à esquerda", "Central sobre a imagem", "Lateral sobre a imagem"); o editor mostra só o que o modelo usa, com miniaturas vivas e prévia de computador e celular. A logo do login é a da Marca (D9; no tom Claro vira texto). `?template=` no endereço do `/login` deixou de valer. A linha "Ainda não tem acesso? Fale com o suporte" só aparece com link (https ou e-mail, D10); antes apontava para `#`. Desvios: nos modelos com imagem ao lado, a imagem agora aparece escurecida atrás do formulário no celular (antes o fundo opaco a escondia); as imagens do visual continuam sem o otimizador do Next (a imagem padrão ficava borrada); a logo ganhou teto de 56 px de altura. Logado, o produtor não vê o `/login` (é redirecionado): para conferir, janela anônima.
- **Destaque:** liga/desliga, imagem ou vídeo com capa, selo, título e descrição com "Mostrar" (texto escondido continua guardado) e o botão (texto, destino em "Um produto", "Página da área" ou "Link externo", e "Abrir em" mesma aba ou nova aba). O link do botão é conferido ao gravar e de novo ao desenhar (`resolveHomeHero` e o próprio `HeroSection`, porque o admin antigo desenha o topo sem passar pela home): `javascript:`, `//host`, `/\host`, `http:` e `/api` somem. Quem prefere menos movimento vê a capa parada no lugar do vídeo. Sem botão, a home ficou igual à de antes. **Marca** ficou só com a logo e um link "A imagem do topo da home agora fica em Destaque."
- **Módulos:** tabela por produto (Curso, Mentoria, Bootcamp, Material e Gravação de live; formação abre nos cursos dela e fica de fora, assim como os cursos de dentro de uma formação), com busca e 25 por página, "Como abre" (Mostrar módulos / Abrir direto nas aulas), "Fileira na home" (interruptor e título editável no lugar) e "Capas" ("3 de 5 com capa própria"). Com menos de 900 px de área útil vira cartões, com os mesmos controles empilhados. A capa de cada módulo se troca no menu do módulo, aba Conteúdo ("Trocar capa do módulo…"), com "Usar a capa do produto". A tela depende da RPC `admin_product_list` (migração `202610110011`) e mostra o aviso de atualização do banco sem ela.
- **(Histórico; o admin antigo foi removido em 14/10/2026.) Admin antigo não apaga o que o admin novo grava:** ele grava `platform_settings` chave por chave e nunca toca em `loginPage`; a aparência antiga (`PUT /api/admin/appearance`) envia a imagem primeiro e só depois relê o `hero` e grava com a versão lida (`updatePlatformSettingLatest`: tenta de novo uma vez se mudou no meio, depois 409), trocando só ligado, imagem e tipo de mídia, então botão, textos, capa e `visibility.cta` publicados em Destaque sobrevivem, inclusive se forem publicados enquanto a imagem sobe; o editor de módulo do admin antigo só manda a capa quando o produtor mudou a imagem no formulário; o salvar de curso relê `content_page_settings` e espalha as chaves que não conhece. A Vitrine do admin antigo agora manda a versão das fileiras que leu (`homeSectionsUpdatedAt` no `AdminDashboardData`) e recebe 409 em vez de apagar uma fileira ligada em Módulos ou uma mudança da Vitrine nova (`tests/member-area-integration.test.mjs` trava esse comportamento). Riscos que ficam até o legado ser desligado: o formulário de curso do admin antigo manda sempre todos os campos que carregou, então salvar com a tela aberta desde antes de uma mudança no admin novo desfaz "Como abre"; o de módulo faz o mesmo com nome, descrição e liberação (a capa não: só vai quando muda) — recarregue o admin antigo antes de editar; o interruptor "Módulos na home" do admin antigo só muda o espelho e não tem efeito com a Vitrine publicada; os editores "Página de login" e "Página de produtos" do admin antigo continuam só prévia (o de login mostra o padrão, não o que foi publicado); a aparência antiga ainda troca a imagem do topo.
- **Revisão da rodada (11/10/2026):** (1) Vitrine com gravação condicional, ver "Conflito de edição"; (2) a aparência do admin antigo deixou de apagar o que o Destaque publicou enquanto a imagem subia; (3) o editor de módulo do admin antigo deixou de desfazer a capa trocada no admin novo; (4) link de imagem colado (capa de produto, capa de módulo, imagens da Área de membros) só passa se for https e sem espaço, aspas, parênteses, `<`, `>` ou `\` (`imageLinkSchema`), e os cards do aluno desenham o fundo sempre entre aspas (`cssImageUrl`, `src/lib/css-url.ts`): um endereço com `)` não injeta mais CSS na home; (5) `?next=` do login, do `/auth/callback` e da troca de senha recusa `/\host` e `/%5Chost` (redirecionamento aberto, `src/lib/auth/redirect.ts`, que agora monta o caminho com o parser de URL e exige a mesma origem); (6) tom Claro do login com erro, aviso de link enviado, "Login temporariamente indisponível", divisória, botão de mostrar senha e "Esqueci minha senha" em cores próprias (antes sumiam no painel claro); (7) a frase do tom Translúcido depende do modelo (com a imagem ao lado, só no celular ela fica atrás do formulário); (8) Login: configuração salva inválida não abre mais a barra de publicar sozinha (aviso com "Publicar o padrão"); publicar e desfazer atualizam o roteador (voltar à aba mostra o publicado), igual Destaque, Vitrine e a tabela de Módulos; (9) Destaque: escrever num texto vazio liga "Mostrar" sozinho (e o botão, quando texto e destino ficam completos), texto com "Mostrar" desligado ganha o aviso "Escondido na home"; o "Desfazer" de uma publicação antiga some quando há outra mais nova e, se ainda assim falhar, vira aviso simples; duas colunas a partir de 1024 px, como o Login; (10) controles que salvam na hora (Como abre, título e chave da fileira, "Usar a capa do produto") não ficam `disabled` enquanto gravam, para o foco do teclado não cair no corpo da página; (11) a prévia da capa do módulo mostra o card como o aluno vê (nome e quantidade de aulas, 2:3), sem o rótulo "Módulo N"; (12) na Vitrine, no celular, a linha do banner quebra em vez de cortar o atalho "Editar em Destaque".
- **Produto que saiu de venda na Vitrine:** excluir um produto (ou tirá-lo de venda) nunca trava a publicação da vitrine. A regra é uma só, a mesma que a home do aluno já aplicava (`pruneHomeSectionRefs` em `src/server/storefront/model.ts`): o produto sai das fileiras de escolha manual, a fileira de módulos dele sai inteira e a escolha manual que fica vazia por causa disso sai também. Ela roda em três lugares: ao excluir o produto (`deleteContentItem` relê `homeSections` e grava com a versão lida; vitrine nunca publicada não ganha a chave; se essa limpeza falhar, a exclusão continua valendo), ao abrir e ao publicar a Vitrine (o rascunho já nasce limpo, com o aviso neutro "1 produto que não está mais à venda saiu de “Para você”. Publique para salvar.") e em `publishHomeSections`, que limpa em vez de recusar (defesa contra a tela antiga e contra uma exclusão entre abrir e publicar). Os outros erros continuam: título vazio, fileira automática repetida e escolha manual que o produtor deixou vazia. A tela Módulos não precisou mudar: ela não confere as outras fileiras.
- **Fica para depois:** evento `home_hero_cta_clicked` e CTR por fileira (fase 3); destaque por um período a partir de um Webinário ou Promoção (fase 5); apagar do Storage as imagens descartadas; trocar as imagens padrão em PNG (2,2 a 2,4 MB) por AVIF/WebP; imagem separada para o celular no destaque; login com Apple, links de rodapé e rótulos de e-mail/senha editáveis; mostrar na prévia do login o estado de erro (hoje só o formulário vazio aparece); aviso no admin antigo apontando para Área de membros; gatilho de `updated_at` em `platform_settings`; validação com login de verdade (publicar e abrir `/login` numa janela anônima, publicar o destaque com botão e vídeo, ligar uma fileira e conferir a home), que nesta rodada foi feita por testes e por telas de exemplo.

### 2.11 Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Big-bang disfarçado (construir todo o shell antes de ligar uma tela) | cada fase desliga uma view do legado; o produtor usa o novo desde a fase 1 |
| Dupla fonte de verdade e escrita concorrente durante a migração (`student_courses` vs. `entitlements`, `video_config` vs. `video_assets`, `status` derivado) | código novo escreve só na fonte de verdade e deriva o legado; kill-switch do `PUT` replace-all no dia de Alunos v2; `updated_at` em toda mutação; testes de contrato nas rotas do aluno |
| Métricas nascem vazias ou aproximadas | backfill de `lesson_watch_states`, rótulo "aproximado", faixa "coleta ativa desde", "—" em vez de fallback |
| Cache do catálogo invalidado errado; `cacheComponents` global quebra páginas dinâmicas | `invalidateCatalog()` única (`updateTag` em Server Action, `revalidateTag(tag, 'max')` fora dela), e2e de publicação em Preview; flag só na fase 6, com o codemod `cache-components-instant-false` e `ensureStatic` exportado por segmento onde a casca precisar ser estática |
| Extração não oficial do YouTube quebra antes da fase 4 | flag na fase 0, aviso no admin, receptor TV cai para embed oficial |
| Bunny no Brasil (latência, docs em migração) e origem dos arquivos originais | piloto em 1 produto; YouTube oficial continua válido; decisão D2 antes da fase 4 |
| Pop-ups viram spam e reclamação pública | caps fixos no motor, dispensa fácil, alerta > 40 %, tier crítico só do sistema, aprovação acima de 500 alunos |
| Atribuição de vendas não verificada na Hotmart (campo `sck` no payload 2.0) | validar no histórico de webhooks antes de codar; Ticto primeiro; fallback por e-mail + 7 dias |
| Volume de eventos estoura o PostHog; `pg_cron` sobrecarrega o primário | heartbeat só em `lesson_watch_segments`; tick leve por minuto, recomputos à noite, `job_runs` com alerta |
| Reescrita do player regride retomada/avaliação/TV | adaptadores YouTube e Native replicando o comportamento atual atrás de `player_engine_v2` por produto; testes node do cálculo de progresso |
| Escopo cresce (WhatsApp, A/B, editor rico) | lista "fora do MVP" na seção 1.14; nada entra na sidebar sem backend real |
| LGPD em segmentação, e-mail e WhatsApp | LIA documentada, opt-out em todo envio, consentimento registrado, exportações auditadas, exclusão com anonimização |

### 2.12 Glossário produtor ↔ técnico

| O produtor diz | A engenharia lê |
|---|---|
| Produto | `content_items` com `commerce_scope = sellable_product` |
| Formato (Curso, Formação, Mentoria…) | `content_items.kind` |
| Material / Gravação de live | antigo `kind = "Produto"` / antigo `kind = "Webinario"` |
| Cursos desta formação | `content_items` com `commerce_scope = included_content` e `parent_content_id` |
| Conteúdo / Módulo / Aula | `course_modules`, `lessons` |
| Situação (Rascunho / Publicado / Arquivado) | `publication_status` |
| Quem pode ver | `access_model` + `purchase_url` + marcação de oculto; `is_locked` já não autoriza nada desde 01/10/2026 e deixa de ser campo |
| Em breve / Novo / Bloqueado | derivados no servidor; nunca gravados |
| Liberação ("7 dias depois de ganhar acesso") | `release_rule` (`ReleaseRuleConfig`; modos `immediate`, `fixed_date`, `after_access` = antigos `after_enrollment` + `after_purchase`, `after_previous_lesson`) |
| Acesso | `entitlements` (`starts_at`, `ends_at`, `status`, `source_event_id`) |
| Origem (Hotmart, Ticto, manual) | prefixo de `source_event_id` / `webhook_events.provider` |
| Aluno / Sem conta | `profiles` (`auth.users`) / `students` sem `user_id` |
| Turma | `cohorts` + `cohort_memberships` |
| Pacote | `product_combos` + `product_combo_items` |
| Segmento / Público | `audiences` avaliadas sobre `student_facts` |
| Aviso (Pop-up, Faixa, Card, Destaque, Toast) | `campaigns.kind` |
| Avisos recebidos (aba do perfil) | `campaign_deliveries` + `message_events` do aluno |
| Webinário | `events` + `event_registrations` |
| Promoção | `offers` + `attribution_clicks` |
| Notificação (sino) | `notifications` |
| Desfecho de um aviso | `campaigns.goal_event_type` + janela de atribuição |
| Vendas recebidas | `webhook_events` (Hotmart/Ticto) |
| Código do produto na Hotmart | `sales_product_links` (provider, external_product_id → product_id ou combo_id) |
| Hotmart conectada / Precisa de atenção / Em configuração | `integration_settings.status` (+ plataforma sem adaptador = "Em configuração") |
| Cor do produto | `content_page_settings.settings->>'accent'` |
| Vídeo pronto / processando / com erro; vídeo protegido | `video_assets.status`; token de playback de curta duração (Bunny SHA256, Mux JWT) |
| Cole o link do vídeo | detecção de provedor por host + `POST /api/admin/video/resolve` |
| Ritmo (Estudando / Em risco / Inativo / Nunca começou / Concluiu) | `student_facts` (último estudo, progresso, aulas concluídas) com o período global e os limiares 14 / 30 dias |
| Marcada à mão / Aproximado / Coleta ativa desde | `completion_source = manual/admin` / derivado de `lesson_watch_states` / data do primeiro `lesson_started` em produção |
| Ver como aluno | `?accessPreview=producer\|student_with_access\|student_without_access` + cookie `bunker707_access_preview` (`src/lib/access-preview.ts`); rascunhos visíveis para `admin_roles` são entrega da fase 1 |
| Tutor IA / Diretor; marcar como FAQ | `ai_conversations`, `ai_messages`; par pergunta/resposta em `lesson_ai_profiles` |
| Equipe: dono, funções prontas (admin, editor, professor, suporte, analista), funções personalizadas e permissões extras | `admin_roles.role` (owner, admin, editor, instructor, support, analyst, custom) + `admin_roles.permissions` (funções, extras e alcance, cursos da pessoa) + `admin_functions` |
| Registro de quem fez o quê | `admin_audit_log` |
| Admin antigo | `/admin/legado` (`admin-dashboard.tsx`), removido na fase 6 |

### 2.13 Referências

Versões e datas de pacotes: registro npm (`npm view <pacote> version time`), consultado em 2026-10-10.

- Next.js 16.4: https://nextjs.org/blog/next-16-4 ; 16.3: https://nextjs.org/blog/next-16-3 ; 16.2: https://nextjs.org/blog/next-16-2 ; 16.0: https://nextjs.org/blog/next-16 ; atualização de segurança de outubro/2026: https://nextjs.org/blog/upcoming-nextjs-security-update-october-2026 ; navegação instantânea: https://nextjs.org/docs/app/guides/instant-navigation ; migração para Cache Components: https://nextjs.org/docs/app/guides/migrating-to-cache-components ; self-hosting: https://nextjs.org/docs/app/guides/self-hosting ; PWA/push: https://nextjs.org/docs/app/guides/progressive-web-apps
- shadcn Rhea (maio/2026): https://ui.shadcn.com/docs/changelog/2026-05-rhea ; Next `unstable_cache`: https://nextjs.org/docs/app/api-reference/functions/unstable_cache ; `revalidateTag`/`updateTag`: https://nextjs.org/docs/app/api-reference/functions/revalidateTag
- React 19.3: https://react.dev/blog/2026/09/09/react-19-3 ; React Compiler: https://react.dev/learn/react-compiler/installation
- Tailwind 4.3: https://tailwindcss.com/blog/tailwindcss-v4-3 ; Tailwind na Shopify: https://tailwindcss.com/blog/tailwind-is-joining-shopify
- shadcn: CLI v4 https://ui.shadcn.com/docs/changelog/2026-03-cli-v4 ; Base UI padrão https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default ; blocks https://ui.shadcn.com/docs/changelog/2026-02-blocks ; chart https://ui.shadcn.com/docs/components/chart ; data-table https://ui.shadcn.com/docs/components/base/data-table ; command https://ui.shadcn.com/docs/components/base/command
- TypeScript 7: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ ; Next `useTypeScriptCli`: https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli
- Supabase: Next.js SSR https://supabase.com/docs/guides/auth/server-side/nextjs ; `getClaims` https://supabase.com/docs/reference/javascript/auth-getclaims ; signing keys https://supabase.com/docs/guides/auth/signing-keys ; Cron https://supabase.com/docs/guides/cron ; Queues https://supabase.com/docs/guides/queues ; Realtime limits https://supabase.com/docs/guides/realtime/limits
- TanStack Table v9: https://tanstack.com/table/latest/docs/framework/react/guide/migrating ; TanStack Start: https://tanstack.com/start/latest/docs/framework/react/overview ; React Router 8: https://remix.run/blog/react-router-v8
- Vercel: Node.js https://vercel.com/docs/functions/runtimes/node-js/node-js-versions ; depreciação do Node 20 https://vercel.com/changelog/node-js-20-is-being-deprecated ; Speed Insights https://vercel.com/docs/speed-insights/quickstart ; Cron https://vercel.com/docs/cron-jobs/usage-and-pricing ; regiões https://vercel.com/docs/regions
- YouTube: parâmetros do player (`modestbranding` depreciado em 15/08/2023) https://developers.google.com/youtube/player_parameters ; Required Minimum Functionality https://developers.google.com/youtube/terms/required-minimum-functionality ; Developer Policies https://developers.google.com/youtube/terms/developer-policies ; Termos https://www.youtube.com/static?template=terms ; modo de privacidade https://support.google.com/youtube/answer/171780 ; vídeos não listados https://support.google.com/youtube/answer/157177 ; Live API https://developers.google.com/youtube/v3/live/docs
- Bunny Stream: preços https://bunny.net/docs/stream/pricing e https://bunny.net/pricing/stream/ e https://bunny.net/pricing/cdn/ ; rede https://bunny.net/network/ ; storage SP https://bunny.net/blog/bunny-storage-brazil-sao-paulo-expansion ; segurança https://bunny.net/docs/stream/security-options ; token de embed https://bunny.net/docs/stream-embed-token-authentication ; player https://bunny.net/docs/stream/player-settings ; TUS https://bunny.net/docs/stream/tus-resumable-uploads ; webhook https://bunny.net/docs/stream-webhook ; estatísticas https://bunny.net/docs/stream/statistics ; Transcribe https://bunny.net/stream/transcribe-ai/ ; DRM Enterprise https://bunny.net/stream/media-cage-enterprise-multi-drm-digital-rights-management/
- Mux: preços https://www.mux.com/pricing/video ; estimativa de custos https://www.mux.com/docs/pricing/estimating-video-costs ; playback seguro https://www.mux.com/docs/guides/secure-video-playback ; DRM https://www.mux.com/docs/guides/protect-videos-with-drm ; legendas https://www.mux.com/docs/guides/add-autogenerated-captions-and-use-transcripts ; webhooks https://www.mux.com/docs/guides/listen-for-webhooks ; Mux Data https://data.mux.com/pricing
- Cloudflare Stream: preços https://developers.cloudflare.com/stream/pricing/ ; segurança https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/ ; legendas https://developers.cloudflare.com/stream/edit-videos/adding-captions/ ; webhooks https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/
- Vimeo: planos https://help.vimeo.com/hc/en-us/articles/12425432033937 ; embed por plano https://help.vimeo.com/hc/en-us/articles/12426275096337 ; Analytics API (Enterprise) https://help.vimeo.com/hc/en-us/articles/21426264125969 ; player.js https://github.com/vimeo/player.js
- Panda Video: planos https://www.pandavideo.com/br/planos/ ; docs https://docs.pandavideo.com/
- E-mail e mensagens: Resend https://resend.com/pricing ; Postmark https://postmarkapp.com/pricing ; WhatsApp Cloud API https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing ; Knock https://knock.app/pricing ; Novu https://github.com/novuhq/novu ; PostHog surveys https://posthog.com/surveys/pricing ; PostHog flags https://posthog.com/docs/feature-flags/cutting-costs
- Regras de mensagens in-app: Braze https://www.braze.com/docs/user_guide/channels/in_app_messages/faq/ ; Customer.io https://docs.customer.io/messaging/channels/in-app/send-in-app-message/ ; Chameleon https://help.chameleon.io/en/articles/3513345-rate-limiting-experiences ; Appcues https://docs.appcues.com/user-experiences-targeting/setting-up-flow-frequency
- Atribuição de vendas: Hotmart `sck` https://help.hotmart.com/pt-BR/article/como-posso-identificar-a-origem-das-minhas-vendas-/216441797 ; Ticto webhook v2 https://webhook.ticto.dev/docs/v2
- Benchmarks de EAD: Jordan 2015 (IRRODL, conclusão mediana de MOOC 12,6 %); Reich & Ruipérez-Valiente 2019 (*Science*, 46 % entre verificados); Guo, Kim & Rubin 2014 (L@S, vídeos curtos); Kim et al. 2014 (L@S, picos de re-assistida); Wistia State of Video 2022/2026; Mixpanel Benchmarks 2024; Recurly Research (churn em Educação); Kajabi Automations (janelas 7/30/60/90 dias); Hotmart Insights (ciclo de vida semanal, via https://suportehotmart.zendesk.com); Kajabi anúncios https://help.kajabi.com/en/articles/12695191-send-a-product-announcement ; Circle eventos https://go.circle.so/events
- LGPD: Guia ANPD sobre legítimo interesse (02/02/2024) via https://www.mattosfilho.com.br/unico/anpd-legitimo-interesse-lgpd/ e https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/glossario-anpd/l
- Design: NN/g (dashboards, wizards, progressive disclosure, formulários, confirmações, drag and drop, dark mode), Few (*Common pitfalls in dashboard design*), Tufte, WCAG 2.2 (1.4.3, 1.4.11), Material dark theme, Carbon layers, Geist (Vercel), Shopify Polaris (forms, alerts, page), GitHub Primer (saving), Refactoring UI.
- Documentos internos: `docs/04-arquitetura-tecnica.md`, `docs/05-modelo-dados.md`, `docs/06-seguranca-operacao.md`, `docs/07-roadmap-mvp.md`, `docs/09-decisoes-abertas.md`, `docs/12-design-system-bunker707.md`, `docs/13-padroes-engenharia.md`, `docs/16-auditoria-tecnica-2026-10-01.md`, `AGENTS.md`.

Números marcados como "estimativa" neste documento (custos de vídeo por cenário, volume de eventos, contraste dos acentos, durações de fase) foram calculados a partir das fontes acima e das premissas declaradas, e devem ser confirmados com dados reais antes de contratos ou metas formais.

---

## Anexo — Como este documento foi produzido

Dez relatórios independentes (10/10/2026): quatro auditorias do código atual (UX e fluxos do admin, dados e eventos disponíveis, performance, integração de vídeo) e seis pesquisas externas (stack Next/React/Tailwind/shadcn, provedores de vídeo e preços, benchmark de 18 plataformas de cursos, framework de métricas de alunos, UX de cadastro de curso e regras de design de dashboard, mensagens in-app e comunicação). Em cima deles, três propostas concorrentes (lente produtor, lente dados, lente simplicidade e performance), dois julgamentos independentes (UX/produto e engenharia/dados), uma síntese e três revisões adversariais (completude, correção técnica, usabilidade). Os juízes divergiram no vencedor; a síntese usa o modelo de produto da proposta "produtor", a disciplina de engenharia da "simples-rápido" e o rigor de dados da "dados". Onde as propostas se contradisseram, prevaleceu o veredito dos juízes verificado no código; onde as revisões apontaram erros, o texto foi corrigido (entre eles: plano de cache da fase 1, alerta "Acesso sem conta" movido para a fase 2, janela da avaliação de aula, provedores de vídeo já existentes, parâmetro real do modo de visualização como aluno, teto diário do e-mail gratuito). Versões de pacotes conferidas no registro npm e preços nas páginas oficiais na mesma data.
