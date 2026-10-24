# 29. Comunicação v3b-2: hora marcada ao vivo, primeiro acesso, curso concluído, relatório do pop-up e players de fora

Data: 23/10/2026. Pedido do produtor: a parte da v3b "Pop-ups sob medida" que o `docs/25` deixou para depois (§8 e §10.2): **(A)** o pop-up com `Começa: Em uma data` abrir na hora certa também para quem já está parado numa página (o aviso da live às 20:00); **(B)** um momento **No primeiro acesso**; **(C)** um momento **Ao concluir um curso**; **(D)** um relatório de onde o pop-up apareceu, em que momento, como os alunos fecharam e quantas vezes cada um viu, com os eventos já gravados; **(E)** ler o player do **Bunny**, do **Vimeo** e do **Mux** na aula, para (1) o pop-up esperar o vídeo parar em vez de desistir no toque e (2) a aula concluir sozinha no fim do vídeo. Os dois momentos novos entram também nos **Modelos** (`docs/28`).

Este documento registra a entrega: o que o aluno e a equipe veem, os dados, como funciona por dentro, o desempenho medido, as decisões, o que fica de fora, os testes e o roteiro de conferência. Vale para qualquer trabalho em pop-ups, Comunicação, relatório do pop-up, momentos do pop-up ou no player da página da aula. Ele continua os docs 22 a 28. Migração `202610260001_communication_v3b2.sql` (as migrações até a `202610250001`, já aplicadas, não mudam). Tabelas em `docs/05` (seção Comunicação v3b-2), segurança em `docs/06` (seção Comunicação v3b-2), arquitetura em `docs/04` (Implementado: Comunicação v3b-2), admin em `docs/17` §1.8, decisões em `docs/09` e testes em `docs/18`. **Mudam regras do `docs/25`**: o "Num horário" de §1.3 vira a hora marcada ao vivo; o descarte por play de §1.4 vira "espera o vídeo parar" em todo player que a página lê (também no vídeo de arquivo e no YouTube, D6); o `show` antes da hora responde 409 em vez de 404 (D4); e as faixas do recálculo dos pop-ups viram em :07, :22, :37 e :52 em vez das horas redondas (§4.7).

---

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Hora marcada ao vivo** | com `Começa: Em uma data`, o pop-up de **Ao abrir a página** (e de **No primeiro acesso**) abre na hora também para quem já está numa das páginas, com alguns segundos de diferença entre os alunos; com o celular travado ou a aba escondida, abre quando o aluno volta; o **Termina** decide até quando | navegador do aluno; o `show` confere |
| **No primeiro acesso** (momento novo) | **Conta como primeiro acesso**: `A primeira vez na área` (conta criada depois do começo do pop-up, ou que nunca tinha entrado) ou `A primeira vez com estes produtos` (acesso ganho depois do começo do pop-up a um dos produtos marcados, até 20, ou acesso a um deles sem nunca ter entrado); quem perde o acesso deixa de ver; até 15 minutos de atraso para quem acabou de comprar | editor, card **Quando e onde aparece**; decidido no recálculo do segmento |
| **Ao concluir um curso** (momento novo) | na página da aula, logo depois de o aluno concluir a última aula publicada que faltava do curso; numa formação, cada curso dela; desmarcar e concluir de novo conta como nova vez (dentro de "Quantas vezes") | editor; a rota de progresso diz quando o curso fechou e o `show` confere no banco |
| **Relatório do pop-up** | **Como o pop-up foi visto** na página do pop-up publicado: 4 números (Vezes que apareceu, Alunos que viram, Viram mais de uma vez, No máximo para um aluno) e 4 blocos (Onde apareceu, com Por produto; Em que momento; Como fecharam; Quantas vezes cada aluno viu), em gráfico ou tabela, desde a publicação, atualizado a cada minuto | `/admin/comunicacao/avisos/[id]` |
| **Bunny, Vimeo e Mux na aula** | a área passa a saber quando o vídeo toca, pausa e acaba (ponte por `postMessage`, sem script de fora); a aula conclui sozinha no fim do vídeo, como no YouTube e no vídeo de arquivo; o progresso usa o tempo real | página da aula |
| **Espera o vídeo parar** | na aula, o pop-up nunca abre com o vídeo tocando, em nenhum player que a página lê: espera parar (antes, desistia se o aluno desse play); só no vídeo colado de outro site continua "mexeu no player = não abre" | navegador do aluno |
| **Modelos** | os dois momentos novos e os produtos do primeiro acesso vão e voltam nos modelos de pop-up (payload versão 1) | `docs/28` |
| **Nenhum limite novo** | cada pop-up segue o **Quantas vezes** escolhido | — |
| **Banco** | migração `202610260001`: produtos do primeiro acesso, a marca do recálculo, índice parcial do histórico, a função do relatório e a política que impede o aluno de gravar linhas de avisos no próprio histórico | antes do merge na `dev` (§10) |

Vocabulário na tela (D19): **Pop-up**, **Quando e onde aparece**, **Quando aparece**, **Ao abrir a página**, **Ao concluir uma aula**, **No primeiro acesso**, **Ao concluir um curso**, **Começa**, **Termina**, **Vezes que apareceu**, **Início**. Nunca "campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template" ou "home" (as guardas de `tests/pop-ups-v3b1-frases.test.mjs` e o `FORBIDDEN_COPY` de `tests/comunicacao-admin-modelo.test.mjs` continuam valendo e os testes novos usam a mesma lista). Nomes internos (`message_impressed`, `trigger`, `first_login`) nunca aparecem em rótulo.

---

## 1. O que o aluno vê

### 1.1 A hora marcada ao vivo

- Pop-up de **Ao abrir a página** (ou **No primeiro acesso**) com `Começa: Em uma data` no futuro: quem já está numa das páginas escolhidas vê o pop-up abrir **na hora** (entre a hora do servidor + 2 s e + 6 s, mais o "Quanto tempo depois", que conta a partir da hora marcada, D2). Quem abre a página depois da hora vê como antes ("Quanto tempo depois" contado da abertura da página).
- **Celular travado, Mac dormindo ou aba escondida até depois da hora**: nada é pedido enquanto dorme; ao voltar (aba visível, volta do cache do navegador ou foco da janela), o pop-up abre (D5). A abertura na hora marcada **não desiste por tempo**: quem volta 15 minutos depois ainda vê, a não ser que o **Termina** já tenha passado (o servidor decide; depois do Termina, nada aparece). Por isso o editor sugere marcar **Termina** num aviso de hora curta.
- **Quem estava com a área aberta antes de a equipe publicar** passa a contar a partir da próxima página que abrir ou de quando voltar para a aba (o pedido do topo traz o plano novo, que arma a hora marcada antes **ou depois** da hora; até 24 h depois do Começa). Um pop-up publicado depois **sem** Começa continua só para a próxima página (nada é relido em laço, §9.1).
- **Relógio adiantado** (o `show` chega antes da hora do servidor): o servidor responde "ainda não" (409) com a hora certa e a hora dele naquele instante, e o navegador tenta **uma** segunda vez, nessa hora, acertando o relógio pela resposta (se o relógio do aparelho mudou depois de o plano chegar, a segunda tentativa não repete o erro).
- **A equipe adiou ou adiantou o Começa**: o plano mais novo desarma a hora velha e arma a nova. Se o Começa foi para antes de a página abrir, ou saiu ("Ao publicar"), a hora velha também cai e o pop-up abre em seguida (como se a página tivesse aberto depois do Começa). Se o pop-up foi pausado ou encerrado e nada mais cobre a página, a hora armada cai sem nada abrir.
- Na hora marcada, o pop-up nunca rouba o foco de quem está digitando, nunca abre com outro diálogo, o sino, o menu ou a busca abertos, e segue **um de cada vez** (dois na mesma hora: o segundo 1 s depois de o primeiro fechar). Na aula, espera o vídeo parar (1.4).

### 1.2 No primeiro acesso

- O aluno vê na **primeira página escolhida que abrir** (Só no Início por padrão), como "Ao abrir a página" (inclusive na hora marcada, se houver Começa).
- **A primeira vez na área**: quem ganhou a conta depois que o pop-up começou, ou ainda não tinha entrado nenhuma vez. Quem já usava a área não vê.
- **A primeira vez com estes produtos**: quem ganhou acesso a um dos produtos marcados depois que o pop-up começou (mesmo que já usasse a área), ou tem acesso a um deles e nunca entrou. O acesso à plataforma inteira vale para qualquer lista. Correspondência exata pelo produto comprado: um curso incluído numa formação é acessado pela formação (para "boas-vindas à Formação IA", escolha a formação). Quem perde o acesso (reembolso, cancelamento, fim) deixa de ver.
- "Começo do pop-up" = o `Começa`; sem ele, a publicação.
- **Atraso de até 15 minutos** para quem acabou de comprar: quem é "aluno novo" é decidido no recálculo do segmento (o job de 15 minutos e a publicação); se o aluno entrar antes, o pop-up aparece na página seguinte depois do recálculo (D9).
- Quem conta como aluno novo **continua** contando depois de entrar (a marca do recálculo, D8), enquanto estiver no segmento e, em "estes produtos", com acesso aberto a um deles ou à plataforma. "Quantas vezes" vale normalmente (um "Mais de uma vez" continua aparecendo para ele).

### 1.3 Ao concluir um curso

- Aparece na **página da aula** logo depois que o aluno conclui a **última aula que faltava** do curso: todas as aulas publicadas dos módulos publicados em "concluídas" (e pelo menos uma aula). É a mesma conta da regra "Progresso 100 %" do segmento (o % do card pode divergir dela; o pop-up segue a do segmento).
- Concluir pelo botão **Concluir** ou pelo fim do vídeo (arquivo, YouTube e, desde esta entrega, Bunny, Vimeo e Mux). Com o vídeo ainda tocando, espera ele parar.
- **Formação**: vale para cada curso dela (as páginas já são expandidas). A formação inteira concluída fica para depois (C2).
- **Cada virada para 100 % é uma nova chance** (dentro de "Quantas vezes"): desmarcar e concluir de novo, ou concluir a aula nova publicada depois, contam (D11), também na mesma página aberta, sem recarregar. Marcar o check de outra aula na playlist (a que faltava) vale: o pop-up abre na aula que está na tela; só trocar de aula depois de concluir descarta.
- Conclusão pelo Modo TV ou pelo envio de saída da página (o aluno fechou a aba) não abre pop-up. Duas abas na mesma aula: só a gravação que fecha o curso responde "fechou" (§4.3).

### 1.4 Na página da aula: o pop-up espera o vídeo parar (D6)

Regra única para "Ao abrir a página", "No primeiro acesso" e a hora marcada:

| Momento | Situação | O que acontece |
|---|---|---|
| de página | vídeo tocando (arquivo, YouTube com os nossos controles, Bunny/Vimeo/Mux com a ponte confirmada) | espera parar (antes e depois do `show`) |
| de página | player do Bunny/Vimeo/Mux ainda no aperto de mão (no máximo 15 s, contados de quando a aula com esse player entrou na tela: a abertura da página ou a troca de aula) | confere de novo a cada 1 s, sem descartar |
| de página | player que a página não lê (vídeo colado de outro site, ou ponte que acabou sem resposta) e o aluno mexeu nele (numa tela de toque, desde o começo) | descarta nesta visualização, como hoje |
| de conclusão (`Ao concluir uma aula`, `Ao concluir um curso`) | outra aula na tela (na aula: a aula concluída saiu da tela; no curso: o aluno trocou de aula depois de concluir, pois a aula que vale é a que estava na tela quando o curso virou) | descarta |
| de conclusão | o vídeo voltou a tocar depois de concluir | descarta |
| de conclusão | o vídeo ainda tocava ao concluir | espera parar |
| qualquer | camada por cima, alguém digitando | confere a cada 1 s |

- **Muda para o arquivo e o YouTube**: tocou antes da hora não descarta mais; com o vídeo tocando, espera parar; parado (pausado, no fim, ou o arquivo que não carregou) abre. A desistência de 10 minutos continua para os momentos que não são a hora marcada: quem assiste mais de 10 minutos sem parar não vê nesta visita.
- **Tela cheia**: o pop-up espera sair da tela cheia, também quando ela é avisada só pela mensagem do player (o Vimeo).
- **Exceção conhecida**: no iPhone, o vídeo do Bunny só responde à página depois do play; ali, antes do play, o pop-up "Ao abrir a página" pode não abrir (como antes). Com play, a ponte confirma e o pop-up espera o vídeo parar.

### 1.5 Vídeos do Bunny, do Vimeo e do Mux

- A aula **conclui sozinha no fim do vídeo** (o botão `Concluir` vira concluído, como no YouTube). Nunca por tempo assistido: só pelo fim (`ended`). No Vimeo em repetição, o fim não sai (não conclui).
- O progresso da aula usa o **tempo real** do vídeo; o cronômetro inventado de 15 s só roda sem a ponte.
- A capa transparente que pede dois toques nos players de fora não muda nesta entrega (E2, §9.1).
- Sem ponte confirmada (navegador sem referrer, como o Brave, extensões, `no-referrer`, ou um player que não responde), tudo fica como antes.

### 1.6 Textos, estados, acessibilidade e 375 px

- **Nenhum texto novo para o aluno**: o cartão é o mesmo (`MemberPopupCard`/`PopupFreeCard`), o diálogo é o mesmo (`aria-modal`, foco preso, foco volta ao fechar, Esc).
- A aula que conclui pelo fim do vídeo usa o estado e o anúncio que o YouTube já tem; nada novo para o leitor de tela.
- 375 px: nada novo do lado do aluno.
- Falhas continuam silenciosas: `show` recusado ou falho, nada aparece e nada conta (`docs/25` §1.7).

### 1.7 O que é registrado (invisível para o aluno)

Nada de dado pessoal novo. Na linha do aluno em `campaign_deliveries`, a marca `first_access_at` (só no "No primeiro acesso", quando o recálculo o achou candidato). Em `student_events`, os mesmos eventos da v3b-1 (`message_impressed` com `page` e `trigger`, que agora pode ser `first_login` ou `course_completed`; `message_closed` com `via`). O aluno deixa de poder gravar linhas de avisos no próprio histórico (só o servidor grava, §5).

---

## 2. O que a equipe faz (`/admin/comunicacao/avisos`)

### 2.1 Card "Quando e onde aparece": quatro momentos

**Quando aparece** (`name="popup-momento"`, `aria-label` "Quando o pop-up aparece"; a 375 px as quatro pílulas quebram linha, 44 px cada): `Ao abrir a página` · `Ao concluir uma aula` · `No primeiro acesso` · `Ao concluir um curso`.

| Chave | Texto |
|---|---|
| `triggerHint.page_load` | `Abre pouco depois de o aluno abrir uma das páginas escolhidas. Com “Começa: Em uma data”, também abre na hora marcada para quem já estiver numa dessas páginas.` |
| `triggerHint.lesson_completed` | `Aparece na página da aula logo depois que a aula fica concluída: no fim do vídeo ou quando o aluno toca em Concluir. Com o vídeo ainda tocando, espera ele parar. Se o aluno já começou outra aula, o pop-up espera a próxima aula concluída. Em vídeo colado de outro site, só quando o aluno toca em Concluir.` |
| `triggerHint.first_login` | `Aparece só para aluno novo (ou para quem acabou de ganhar acesso aos produtos escolhidos), na primeira página escolhida que ele abrir.` (neutro: quem fica de fora em cada escolha é dito em `firstAccessHint`) |
| `triggerHint.course_completed` | `Aparece na página da aula logo depois que o aluno conclui a última aula que faltava do curso (todas as aulas publicadas). Com o vídeo ainda tocando, espera ele parar.` |
| `delayHint.page_load` | `Conta a partir de quando a página abre (na hora marcada, a partir dessa hora).` |
| `delayHint.first_login` | `Conta a partir de quando a página abre.` |
| `delayHint.lesson_completed` | `Conta a partir de quando a aula fica concluída.` |
| `delayHint.course_completed` | `Conta a partir de quando o curso fica concluído.` |
| `lessonHint` (Ao abrir a página, com páginas de aula) | `Na aula, se o vídeo estiver tocando, o pop-up espera ele parar. Se o aluno assistir mais de 10 minutos sem parar, ele não aparece nessa visita. Em vídeo colado de outro site, ele só abre antes do play (no celular, não abre nessas aulas). No iPhone, nas aulas com vídeo do Bunny, ele às vezes não abre: ali o vídeo só responde à página depois do play.` |
| `note` (nota fixa) | `Um pop-up de cada vez: se dois tiverem que abrir juntos, o segundo espera o primeiro fechar. Na aula, nunca com o vídeo tocando: ele espera o vídeo parar. Quando a página não consegue saber se o vídeo toca (vídeo colado de outro site e, no iPhone, às vezes o do Bunny), ele só abre antes do play, e no celular não abre.` |
| `whereHint.any` | `Em todas as páginas da área do aluno, também nas aulas (com o vídeo parado). Nunca no login nem no Modo TV.` |
| `startsAtHint.page_load` e `.first_login` | `A partir dessa hora, quem abrir uma das páginas escolhidas vê o pop-up, e quem já estiver numa delas vê na hora (com alguns segundos de diferença entre os alunos).` |
| `startsAtHint.lesson_completed` | `A partir dessa hora, quem concluir uma aula vê o pop-up. Nada abre sozinho na hora marcada.` |
| `startsAtHint.course_completed` | `A partir dessa hora, quem concluir um curso vê o pop-up. Nada abre sozinho na hora marcada.` |
| `startsAtLiveNote` (Começa no futuro e momento de página) | `Para um aviso de hora curta, marque também “Termina”: quem voltar para a aba depois disso não vê. Publique com antecedência: quem já estava com a área aberta antes de você publicar só vê ao abrir outra página ou voltar para a aba.` |

`frequency.intervalDescription` ganha `first_login` (o texto de `page_load`) e `course_completed`: `Depois desse tempo, ele volta no próximo curso concluído.`

Trocar o momento (`settingsForTrigger`): para `Ao concluir uma aula` ou `Ao concluir um curso` ficam só as páginas de aula (nenhuma → qualquer aula) e as exceções de aula (entre os dois, as páginas ficam como estão); de um momento de aula para `Ao abrir a página` ou `No primeiro acesso`, as aulas escolhidas viram "Páginas de aula"; entre `Ao abrir a página` e `No primeiro acesso`, as páginas ficam; os produtos do primeiro acesso só existem em `No primeiro acesso` (sair apaga, entrar começa vazio); "Quanto tempo depois" nunca muda sozinho.

### 2.2 No primeiro acesso no editor

- **Conta como primeiro acesso** (`name="popup-primeiro-acesso"`): `A primeira vez na área` · `A primeira vez com estes produtos`. Com a segunda, o seletor de produtos de sempre (o mesmo de "Só estes produtos", até 20). Dicas:
  - `A primeira vez na área`: `Vale para quem ganhou a conta depois que o pop-up começou e para quem ainda não tinha entrado nenhuma vez. Quem já usava a área não vê.`
  - `A primeira vez com estes produtos`: `Vale para quem ganhou acesso a um destes produtos depois que o pop-up começou, mesmo que já usasse a área, e para quem tem acesso a um deles mas ainda não tinha entrado. Quem perde o acesso deixa de ver. Para um curso de uma formação, escolha a formação (o acesso vem por ela).`
- Depois: **Onde aparece** igual a "Ao abrir a página" (Só no Início por padrão), **Nunca nestas páginas**, **Quanto tempo depois** e a nota `Para quem acabou de comprar, pode levar até 15 minutos para valer: nesse caso, ele aparece na página seguinte que o aluno abrir.`
- Produto escolhido que não existe mais: o chip `Produto removido`, com o botão "Tirar o produto removido da lista".
- **Trava no ar (D8)**: com o pop-up já publicado, se o momento salvo é `No primeiro acesso`, as outras três pílulas ficam desabilitadas; se não é, a pílula `No primeiro acesso` fica desabilitada; nos dois casos, a linha `Num pop-up que já foi ao ar, “No primeiro acesso” não troca com os outros momentos. Para isso, duplique o pop-up.` debaixo das pílulas, ligada pelo `aria-describedby` do grupo. O servidor recusa do mesmo jeito (400, §2.4). Rascunho nunca publicado troca à vontade.
- No pop-up no ar ou pausado, mudar só os produtos do primeiro acesso mostra `Quem já contava como aluno novo continua contando enquanto tiver acesso a um dos produtos marcados. A mudança vale para quem chegar daqui para frente.`

### 2.3 Ao concluir um curso no editor

**De quais cursos**: `De qualquer curso` (`lesson:*`) · `Só destes produtos` (`lesson:<id>`); com o primeiro, a chave `Menos os cursos de alguns produtos`. Dica `Numa formação, o pop-up aparece ao concluir cada curso dela.` e **Quanto tempo depois** com a dica do curso.

### 2.4 Validação (zod em `schemas.ts`, as mesmas frases na tela; o servidor decide de novo)

| Problema | Campo | Texto |
|---|---|---|
| "A primeira vez com estes produtos" sem produto (só a tela, ao salvar) | `popup.accessProducts` | `Escolha pelo menos um produto.` |
| mais de 20 produtos | `popup.accessProducts` | `Use até 20 produtos.` |
| id inválido (chamada direta) | `popup.accessProducts` | `Escolha produtos da lista.` |
| "Ao concluir um curso · Só destes produtos" sem produto (só a tela) | `popup.pages` | `Escolha pelo menos um produto.` |
| "Ao concluir um curso" com página que não é de aula (chamada direta) | `popup.pages` | `Ao concluir um curso vale só para páginas de aula.` |
| trocar de ou para "No primeiro acesso" num pop-up que já foi ao ar (servidor) | `popup.trigger` | `Num pop-up que já foi ao ar, não dá para trocar de ou para “No primeiro acesso”. Duplique o pop-up.` |

No rascunho salvo, a lista vazia é "A primeira vez na área"; o servidor nunca recusa produtos fora do primeiro acesso: eles somem (o editor nunca manda). Todas as outras de `docs/25` §2.5 continuam.

### 2.5 Frases, revisão e toasts

| Onde | `No primeiro acesso` | `Ao concluir um curso` |
|---|---|---|
| Frase ao vivo | `Aparece na primeira vez que o aluno entra na área, no Início.` / `Aparece na primeira vez depois de ganhar acesso a Formação IA, em qualquer página, menos Perfil.` / `… a 2 produtos, …` | `Aparece ao concluir um curso.` / `Aparece ao concluir um curso de Formação IA.` / `… de 2 produtos.` / com exceções `, menos os cursos de Curso X` |
| Lista (2ª linha) | `No primeiro acesso` (+ ` (com exceções)`) | `Ao concluir um curso` (+ ` (com exceções)`) |
| Detalhes → Quando aparece | `No primeiro acesso à área, 3 segundos depois` / `No primeiro acesso a Formação IA, logo` | `Ao concluir um curso, 3 segundos depois` / `…, logo depois` |
| Detalhes → Onde | como "Ao abrir a página" | como "Ao concluir uma aula" |
| Quantas vezes (sem limite nem intervalo) | como "Ao abrir a página" | `toda vez que o aluno concluir um curso` / ao vivo `toda vez que concluir um curso` / intervalo `(no próximo curso concluído depois desse tempo)` / vezes do dia seguidas `…, uma a cada curso concluído. …` |

**Revisão com "para quem"** (só no primeiro acesso): `Pop-up para quem entrar pela primeira vez (entre {318 alunos} do segmento), no Início, a partir de agora, sem data para acabar, no máximo 1 vez.`; com produtos: `Pop-up para quem entrar pela primeira vez depois de ganhar acesso a Formação IA (entre {318 alunos} do segmento), …`; sem a contagem: `(entre os alunos do segmento)`. O pop-up padrão (Início, ao abrir, 3 s, Uma vez) continua **exatamente** a frase de antes (`docs/25` §2.6). Produto sem nome nas frases: "um produto" (como as frases da v3b-1).

**Toasts**:

| Situação | Texto |
|---|---|
| Publicar (ou aprovar pelo menu da lista) com Começa no futuro e momento de página | `Pop-up publicado. Na hora marcada, ele aparece para quem abrir uma das páginas e para quem já estiver nelas. Para quem está com a área aberta agora, vale a partir da próxima página ou de quando voltar para a aba.` |
| Publicar "No primeiro acesso" no ar agora | `Pop-up publicado. Ele aparece para os alunos novos a partir de agora.` |
| Os outros | como antes (`docs/25` §2.1 e §2.4) |

O toast lê `PublishedNotice.popup` (`{ startsInFuture, trigger }`), que o servidor preenche ao publicar e ao aprovar; sem ele (servidor de antes, notificação), o texto de antes.

### 2.6 Relatório do pop-up

Na página do pop-up que já foi ao ar (`kind = popup` e publicado), logo depois do alerta de fechamento alto e antes de Conteúdo/Detalhes, num `Suspense` (o funil não espera): a seção **Como o pop-up foi visto** (`section[aria-labelledby="aviso-relatorio-popup"]`), `Desde a publicação. Atualiza a cada minuto.`, com o alternador `Ver como tabela` / `Ver como gráfico` (`aria-pressed`; vale para os quatro blocos; não é guardado no navegador).

| Peça | Texto e conta |
|---|---|
| KPI 1 | `Vezes que apareceu` · `somando todos os alunos` (das linhas por aluno: exato) |
| KPI 2 | `Alunos que viram` · `pelo menos 1 vez` |
| KPI 3 | `Viram mais de uma vez` · `{38 %} de quem viu` |
| KPI 4 | `No máximo, para um aluno` · `em média {2,4} vezes por aluno; metade viu até {2}` |
| **Onde apareceu** (h3) | `Início`, `Página do produto`, `Páginas de aula`, `Minhas compras`, `Favoritos`, `Materiais`, `Minha jornada`, `Continue assistindo`, `Perfil`, `Suporte`, `Outra página`, em ordem decrescente (empate pela ordem do menu); sub-bloco **Por produto** (os 10 com mais vezes, a linha `Outros produtos` com as vezes somadas e alunos `—`, `Produto removido`) |
| **Em que momento** (h3) | `Ao abrir a página`, `Ao concluir uma aula`, `No primeiro acesso`, `Ao concluir um curso`, `Outro momento` |
| **Como fecharam** (h3) | `Clicaram no botão`, `Fecharam no X`, `Fecharam no Esc`, `Fecharam clicando fora`, `Saíram da página com ele aberto`, `Lembrar depois`, `Não mostrar de novo`, `Fecharam (sem detalhe)`, `Sem registro` (= aberturas do histórico menos resultados; só quando > 0) |
| **Quantas vezes cada aluno viu** (h3) | `1 vez`, `2 vezes`, `3 a 5 vezes`, `6 a 10 vezes`, `11 vezes ou mais` |
| Linha de barra | `{120} vezes · {80} alunos` + `{45 %} das vezes` (Como fecharam: `das vezes que apareceu`; faixas: `{80} alunos` + `{30 %} de quem viu`) |
| Rodapé | `“Onde apareceu”, “Em que momento” e “Como fecharam” contam cada vez que o pop-up apareceu, pelo histórico (até 100 vezes por aluno por dia). “Vezes que apareceu” e “Quantas vezes cada aluno viu” vêm da conta de cada aluno e são exatas. “Sem registro”: vezes em que o aluno saiu sem o navegador conseguir avisar. A equipe não entra nos números.` + `Nas vezes mais antigas, o histórico não guardava a página nem o jeito de fechar: elas aparecem como Início e “Fecharam (sem detalhe)”.` (chave própria, sem data) |
| Vazio | `Ninguém viu este pop-up ainda. Os números aparecem aqui quando os alunos começarem a ver.` |
| Migração pendente | `Os detalhes de onde e como os alunos fecharam aparecem depois da atualização do banco.` |
| Falha | `Não foi possível carregar estes números agora. Recarregue a página.` |
| Carregando | quatro cartões vazios e um bloco com `aria-busy="true"` e `aria-label="Carregando os números do pop-up"` |

Percentuais com a base de cada bloco (nunca acima de 100 %; base 0 = nada escrito); linha com 0 não aparece. Barras horizontais simples com o número escrito ao lado (a barra `aria-hidden`), nada de pizza. Modo tabela: `<table>` com `<caption>` e `<th scope="col">` (`Página` / `Momento` / `Como fecharam` / `Quantas vezes`, com `Vezes`, `%` e `Alunos`; por produto `Produto`, `Vezes`, `Alunos`); abaixo de 768 px cada linha vira um cartão (`<dl>`), sem rolagem lateral a 375 px. KPIs em 4 colunas (2 abaixo de 768 px).

### 2.7 Modelos (`docs/28`)

Os momentos `No primeiro acesso` e `Ao concluir um curso` e os produtos do primeiro acesso vão e voltam nos modelos de pop-up, pelos mesmos schemas (versão do payload continua **1**; modelo de antes lê igual). A janela continua fora do modelo: para "No primeiro acesso", o "começo do pop-up" é sempre o do aviso criado a partir do modelo. Produto citado que não existe mais: `Produto removido` no editor.

### 2.8 Quem pode e auditoria

As permissões da v3b-1 não mudam (`docs/25` §2.7): mudar o momento ou os produtos do primeiro acesso de um pop-up no ar conta como mudar o que os alunos veem. **Ver o relatório** exige `messaging.write` (a página do aviso já exigia; a analista só leitura fica para a D2). Auditoria de salvar, pedir aprovação, publicar e aprovar: `popup_trigger` já ia; entra `popup_access_products: <quantos>` só no primeiro acesso. **Duplicar** copia o momento e os produtos; o pop-up novo começa do zero (as linhas e as marcas não vão junto; "aluno novo" contado do começo do novo).

---

## 3. Dados (migração `202610260001`)

| Tabela / objeto | O que muda | Linhas de antes |
|---|---|---|
| `campaigns.popup_access_products text[] not null default {}` | os produtos do "No primeiro acesso"; check `campaigns_popup_access_v3b2`: até 20 ids no formato de `POPUP_PRODUCT_ID`, conferidos um por um por `communication_popup_products_ok`, e lista não vazia só com `kind = 'popup'` e `popup_trigger = 'first_login'` | `{}` (nenhuma reescrita) |
| `campaigns.popup_trigger` | só o comentário: `first_login` e `course_completed` já passavam no check da `202610220003` (`course_completed` só com páginas de aula); `at_start` continua sem uso (D1) | — |
| `campaign_deliveries.first_access_at timestamptz` | a marca do recálculo do "No primeiro acesso" (D8) | nulo |
| `communication_popup_products_ok(text[])` | nova, `immutable`: até 20, sem nulo nem vazio, cada id em `^[A-Za-z0-9_-]{1,240}$` (o check chama) | — |
| índice `student_events_campaign_idx` em `(entity_id, event_type) where entity_type = 'campaign'` | o relatório lê o histórico de um pop-up por aqui | montado na aplicação: 1,95 MB para 264 mil linhas de avisos em 2,66 milhões (medido) |
| `communication_popup_report(p_campaign_id uuid) returns table (metric text, item text, total bigint, students bigint)` | nova, `stable`, `security invoker`, só `service_role`: os números do relatório (§4.6) | — |
| política `Students can create own events` (`student_events`) | `alter policy … with check (auth.uid() = user_id and coalesce(entity_type, '') <> 'campaign')` (D20) | as linhas forjadas de antes continuam limitadas pelo teto da função |

Cinco seções aditivas e idempotentes, todas pelo MCP, **uma por chamada e na ordem**, a 5 **sozinha** (se o MCP travar no `alter policy`, ela vai pelo SQL Editor); ou `apply_migration` com o arquivo inteiro, nome `communication_v3b2`. Sem `drop`, `delete`, gatilho nem `create policy`; constraint dentro de `if not exists`; o texto nunca cita a coluna do design do pop-up (guarda do Livre). O `supabase db push` roda o arquivo numa transação: o índice não é `concurrently`, e enquanto ele monta, as escritas em `student_events` (login, aula, sino) esperam (2,3 s para 3,3 milhões de linhas no teste local). **Conte as linhas antes.** sha256 do arquivo: `44566be50ca166161f25b222e01944236470e3a515b6bca7320d61d9f3b76ae8` (guarda `comunicacao-v3b2.guard`, que fixa também os hashes das migrações até a `202610250001`).

**Aplicar antes do merge na `dev`** (roteiro, §10). Sem a migração, `CAMPAIGN_COLUMNS` (que ganhou `popup_access_products`) quebra o admin de avisos e **o job `comunicacao` do tick**, como na v3b-1 (`docs/25` §3): param notificações agendadas, seguintes e fluxos até aplicar. A migração sozinha não atrapalha o app de antes (ele não lê as colunas novas; o navegador de antes não grava `campaign` no histórico). Na Hetzner, o `deploy-membros` aplica antes de trocar o app (`docs/20`).

**Regra de operação (R1)**: **não publicar nem editar "No primeiro acesso" ou "Ao concluir um curso" num ambiente enquanto o app (e o tick) desse ambiente roda a versão de antes.** O app de antes lê momento desconhecido como "Ao abrir a página": o plano dele manda esses pop-ups como "Ao abrir a página"; o tick dele habilita o segmento inteiro num "No primeiro acesso" (desfeito sozinho no recálculo seguinte do app novo, que tira a linha sem a marca e sem ser candidata); e editar ali um "No primeiro acesso · A primeira vez na área" grava o pop-up como "Ao abrir a página", sem erro. Na nuvem, vale entre aplicar a migração e o merge (e para as prévias de PRs anteriores, que usam o mesmo banco); na Hetzner, antes de voltar para a imagem anterior, pausar esses pop-ups (`docs/20` §9).

---

## 4. Por dentro

As regras moram em módulos puros usados pelo servidor, pelo navegador e pelos testes: `popup-display-model.ts` (os quatro momentos, a janela "em breve", o plano, o mapa e a decisão do `show`), `popup-first-access.ts` (quem é aluno novo e o recálculo), `src/lib/course-completion.ts` (a virada do curso), `popup-host-model.ts` (o que o navegador arma, o despertador e o que bloqueia), `src/lib/lesson-embed-bridge.ts` (a ponte com os players de fora), `src/lib/lesson-media-signal.ts` (o player da aula), `popup-report-model.ts` (o relatório) e `popup-sentences.ts`/`popup-editor-model.ts` (a equipe).

### 4.1 Hora marcada

1. **Plano com 24 h à frente** (`planPopups`, `pagesCovering`, `getPopupsAnswer`): a janela vira `popupWindowSoon` (`Começa` até 24 h depois de agora e `Termina` ainda não passou). O pop-up que ainda vai começar entra com `notBefore = Começa`; todo item cujo Começa caiu entre 24 h atrás e 24 h à frente leva `startsAt` (também depois da hora: a página aberta antes dela ainda arma). O mapa grosso cobre também as páginas dos agendados. Nenhum pedido novo: a lista no ar já trazia os agendados (`limit 60`) e as linhas de entrega já existiam antes do início. O navegador de antes ignora `startsAt` e respeita `notBefore`.
2. **`show` antes da hora** (`decideShow`, nova ordem): fora do ar (encerrado ou depois do Termina) → 404; sem linha elegível → 404; **Começa no futuro → 409 `{ error: "Pop-up fora da vez.", nextAt: <Começa>, reason: "not_started" }`** (D4); depois página, momento e frequência como antes. Quem não está no segmento continua recebendo 404: nada vaza.
3. **No navegador** (`openingsForPageView`): item de momento de página com `startsAt` e a página aberta antes de `startsAt + 2 s` = abertura da hora marcada: `at = startsAt (no relógio local, acertado pelo asOf) + 2 s + sorteio de 0 a 4 s + "Quanto tempo depois"`, sem desistência (`giveUpAt: null`), chave `${id}@${startsAt}` (a hora mudou = outra chave). Mais de 24 h à frente ou não permitido pela frequência nessa hora: não arma.
4. **Relógio de parede** (`createArmedClock`, `nextWakeDelay`): toda abertura armada encadeia temporizadores de no máximo 30 s que comparam `Date.now()` com a hora dela; `visibilitychange` (visível), `pageshow` com `persisted` e `focus` conferem na hora o que já venceu. Nenhum pedido sai disso (um `setTimeout` único de horas não segue a hora de parede com o aparelho dormindo).
5. **Plano mais novo com a página aberta** (`subscribePopupMemory` + `newPlanAction` + `reconcileClockOpenings`): quando a memória ganha um plano novo (o topo pediu ao voltar para a aba com o número vencido, ou outra página pediu), o host arma a hora marcada que não estava armada (inclusive de um pop-up publicado depois que a página abriu, desde que com Começa depois da abertura), troca a armada cuja hora mudou e desarma a que saiu do plano; a armada cujo item continua mas não arma mais pela hora (o Começa foi para antes da abertura da página, ou saiu) é desarmada e armada de novo para agora + sorteio + "Quanto tempo depois" (chave `${id}@${startsAt}` ou `${id}@now`, só se a frequência deixar; o mesmo plano de novo não arma outra vez); id já na fila nesta visualização nunca entra de novo. A resposta nova que não cobre mais a página, ou veio sem plano (`answered` da memória, não a falha do pedido), desarma toda hora marcada ainda não vencida; a falha (nada se sabe neste minuto) e a memória vencida não mexem em nada.
6. **409 `not_started`** (`rearmAfterNotStarted`): a abertura da hora marcada arma **uma** segunda tentativa para `nextAt + 2 s + sorteio + "Quanto tempo depois"` (chave `${id}@${nextAt}`), com o relógio acertado pelo `asOf` da própria recusa (`clockOffsetOf`; sem `asOf` legível, o acerto do plano): o relógio do navegador que mudou depois de o plano chegar não repete o erro; mais de 24 h à frente, não (o próximo plano traz).

### 4.2 Primeiro acesso: o recálculo (`dispatch.ts` + `popup-first-access.ts`)

Em `refreshPopupDeliveries`, só para pop-up `first_login`, depois de ler os fatos dos alunos e o segmento:

- `since = firstAccessSince(linha)`: `starts_at`, senão `sent_at`, senão `created_at`;
- **candidato** (`isFirstAccessCandidate`): lista vazia → nunca entrou ou conta criada em `since` ou depois; com produtos → tem acesso aberto a um deles (ou à plataforma) e (nunca entrou ou ganhou esse acesso em `since` ou depois). Os fatos já trazem só os acessos abertos, `lastSignInAt` e agora `createdAt` (`profiles.created_at`, que já era lido): nenhuma leitura nova;
- `firstAccessDeliveryChanges`: marca (`first_access_at = agora`, cria a linha ou volta a deixar elegível, impressões ficam) quem é candidato e ainda não está elegível e marcado; mantém quem tem a marca e continua no segmento (e, em "estes produtos", com acesso aberto a um deles ou à plataforma); **desliga a linha elegível sem marca e sem ser candidata** (a de um app sem esta regra, D8); `audience_count` = candidatos ∪ mantidos.

A leitura das linhas é a de hoje com uma coluna a mais; o filtro é em memória; a marca é gravada uma vez por aluno e pop-up. A publicação e o job de 15 minutos passam pelo mesmo caminho. `isDefaultPlacement` continua exigindo `page_load`: um "No primeiro acesso" no Início nunca é o padrão.

### 4.3 Curso concluído: a virada

- `PUT /api/progress/lessons` (e o `POST` do envio de saída, mesmo código): `requireLessonsAccess` passa a devolver `publishedLessonIds` (as aulas publicadas dos módulos publicados, da leitura que já existia; `null` para a equipe). O "antes" vem de `replaceCompletedLessonsWithPrevious` (`platform-store.ts`): as concluídas que a gravação leu na tentativa que **venceu** o compare-and-swap. `courseJustCompleted({ after, before, published })` diz se este pedido virou o curso de incompleto para completo; só então a resposta é `{ courseCompleted: true, data }` (senão `{ data }`, como antes). Nenhuma leitura nova. Duas abas, o `pause`/`ended` da ponte seguido do Concluir ou o `ended` repetido da Bunny: só a gravação que vira o curso responde `courseCompleted`.
- A página da aula lê a resposta com `courseCompletedOf` (só `courseCompleted === true` vale) e anuncia `{ kind: "completed", contentId, lessonId, courseCompleted: true }` pelos dois caminhos que já anunciavam a conclusão (fim do vídeo e o botão Concluir). O host conta as viradas do curso nesta visualização de página e arma, além dos `lesson_completed` (chave `${id}:${lessonId}`), os `course_completed` da página `lesson:<contentId>` com a chave `${id}:course:${virada}` (desmarcar e concluir de novo na mesma página é outra virada, outra chave, outra chance), na ordem do plano, um de cada vez. A aula guardada na abertura do curso é a que está na tela na hora da virada (`lessonMediaSnapshot().activeLessonId`; sem palco, a concluída), não a aula marcada: o check de outra aula na playlist não vira "outra aula na tela"; só a troca de aula depois descarta.
- O `show` de `course_completed` confere de novo no banco (`fetchCourseCompletionFacts`: progresso ∥ módulos publicados, depois as aulas publicadas; duas idas em sequência, só nesse momento): curso incompleto → 409 `reason: "trigger"`, `nextAt: null`, sem gravar a abertura. Um aviso forjado na página nunca abre um "parabéns" antes da hora.

### 4.4 A ponte com os players de fora (`lesson-embed-bridge.ts`)

- **Sem SDK, sem script de fora, sem mudar a CSP**: só mensagens entre janelas (`postMessage`). Liga **pela origem do `src` do iframe** (lista exata, nunca `endsWith`/`includes`): `https://player.vimeo.com` (protocolo do Vimeo), `https://iframe.mediadelivery.net` e `https://player.mediadelivery.net` (Bunny, um grupo: o `src` de um aceita mensagens dos dois) e `https://player.mux.com` (Player.js). Vale também no código de incorporação com essas origens; outras origens: sem ponte.
- **Mensagem aceita** só com `event.origin` no grupo **e** `event.source === iframe.contentWindow` com `contentWindow` não nulo; texto até 4.096 caracteres com `JSON.parse` protegido; no Player.js, `context === "player.js"`; evento numa lista fixa; números finitos entre 0 e 86.400. **Mandada** sempre com `targetOrigin` exato: a origem do `src` até a primeira mensagem aceita, depois a origem dela (nunca `*`).
- **Ciclo**: começa "pendente"; aperto de mão a cada 400 ms (até 12; Vimeo `{ method: "ping" }`, cuja resposta `{ method: "ping" }` vale como pronto; Player.js `addEventListener` de `ready` com `listener`); no pronto (também tardio, repetido ou com a ponte já sem resposta), as inscrições (`play`, `pause`, `ended`, `timeupdate` e, no Vimeo, `fullscreenchange`) e a pergunta `getPaused`; **só confia ("confirmada") depois da resposta do `getPaused`** (o `ready` do Player.js sai mesmo sem referrer, com `*`, então só a resposta prova a ponte). Sem resposta em 12 tentativas ou 15 s: "sem resposta" (tudo como antes). O `load` do iframe recomeça. O canal próprio da Bunny (`{command:"activate"}`, com `*`) não é usado.
- **Na aula** (`use-lesson-embed-bridge.ts` + `lesson-experience.tsx`): o hook liga só com o player da lista na tela e **baixa a ponte por `import()`** (fora do JS inicial da aula; nunca baixa em aula de arquivo ou YouTube); o iframe entra por um ref de função com estado (o efeito roda de novo quando ele monta depois do primeiro render); os callbacks ficam num ref (um render novo nunca religa); o estado do React só muda quando a ponte, o tocar ou a tela cheia mudam (o `timeupdate`, ~4 por segundo no Vimeo, não redesenha a página). Fim → `syncLessonWatchProgress` com 100 % e `completed` (como o fim do YouTube); tempo (até 1 por segundo) → progresso com o tempo real (a porta de 15 s de sempre segura a gravação); pausa → grava na hora; play → início da aula. O cronômetro inventado não roda com a ponte confirmada. `referrerPolicy`, `sandbox` (com `allow-same-origin`) e a capa transparente do iframe não mudam.

### 4.5 Os sinais da aula e o que bloqueia

- `lessonMediaSnapshot()` ganha `bridge` (`confirmed`, `pending` ou `none`) e `readable` (arquivo, YouTube ou ponte confirmada para a aula na tela). O palco marca `data-lesson-player-bridge` quando o `src` é de um player da lista (calculado por `embedBridgeTarget`): antes do primeiro sinal da aula na tela, esse iframe conta como pendente por até 15 s a partir de quando o palco passou a mostrar um player da lista para essa aula (a abertura da página ou a troca de aula dentro dela, o que vier por último: o módulo guarda a aula e a hora, e `resetLessonMedia` zera), e o módulo do sinal (que vai em toda página) não carrega nem a lista de origens. Sinal de outra aula é ignorado; a troca de aula anuncia "sem resposta" e `playing: false` da anterior (um play velho nunca segura o pop-up) com o DOM já na aula nova: por isso a janela recomeça na troca, senão o pop-up que esperava o vídeo parar seria descartado como "mexeu no player" em vez de conferir de novo.
- O `<video>` do nosso player com `error` (o arquivo não carregou) conta como parado mesmo com `paused` false: no WebKit, o `play()` que falha deixa `paused` false para sempre, e o pop-up esperaria sem fim. A espera do vídeo parar também acorda no evento `error`.
- `blockReason` ganha `bridge_pending` (confere a cada 1 s), avaliado **antes** de `touched` (numa tela de toque, o iframe conta como tocado desde o começo e a confirmação leva até 12 × 400 ms depois do `load`). Tabela completa no §1.4.
- `waitLessonFullscreenEnd`: a espera da tela cheia volta com os avisos de sempre do `document`, com o sinal da ponte `fullscreen: false` e com a conferência de 1 s.

### 4.6 O relatório: função, índice e cache

- `communication_popup_report(id)` (§3) conta **só aluno com linha vista** no pop-up, **nunca mais vezes do que a linha diz** (cada total por aluno e item é limitado por `least(n, impressions)`), **nunca a equipe de hoje** (`admin_roles`). Página, momento e jeito de fechar são conferidos com as mesmas listas do app (`POPUP_PAGE_KEY`, `POPUP_TRIGGERS`, `POPUP_CLOSE_VIAS`; o resto vira `other`/`closed_unknown`); sem página = Início; sem momento = Ao abrir a página; sem jeito (antes da v3b-1) = sem detalhe. Linhas: `opened`, `opened_kind`, `opened_product`, `opened_trigger`, `outcome`, `outcomes`, `times`, `viewers`, `max`, `median`.
- **Como conta** (reescrita no integrador com o mesmo resultado linha a linha, §8.2): uma leitura do histórico pelo índice parcial, cada chave do jsonb lida uma vez por linha (`offset 0`), as páginas fixas por igualdade e o id do produto por `[A-Za-z0-9_-]+` com o teto de 240 pelo tamanho (a repetição `{1,240}` custava ~10 µs por linha), e uma passada por aluno, com a linha do aluno entrando por `union all` no mesmo agrupamento (sem juntar tabelas grandes: a função é planejada sem o valor do id e erra o tamanho; uma variante com junção levou 27 s com 30 mil alunos).
- **Leitura para a tela** (`getPopupReport`, `queries.ts`): `unstable_cache` de 60 s, chave `["communications-popup-report", "v3b2"]` (o id pelos argumentos), tag `communications`; duas leituras: a RPC e os nomes dos produtos citados (só os 10 que a tela mostra pelo nome). Erro de esquema → "migração pendente"; outro erro → "falha" (o erro não entra no cache). `readPopupReportRows` lê cada linha sem confiar no formato (métrica numa lista fixa, item conferido por métrica, números finitos ≥ 0; bigint pode vir como texto).
- Nenhuma ação do aluno invalida o cache: um número novo pode levar até 1 minuto.

### 4.7 Faixas do recálculo dos pop-ups (deslocadas)

`fetchPopupsToRefresh` usa `popupRefreshBandStart(now) = popupRefreshDueBefore(now − 7 min, 15 min) + 7 min` (`POPUP_REFRESH_OFFSET_MS` em `campaign-model.ts`): as faixas viram em **:07, :22, :37 e :52**, fora das horas redondas de uma live (20:00), e o intervalo continua de no máximo 15 minutos (D9 e a dica do editor). Só os pop-ups mudam: os fluxos (`flow-engine.ts`) continuam nas horas redondas. Publicar, retomar e mudar o segmento de um pop-up no ar continuam recalculando na hora; um recálculo que falhou ou foi atropelado por uma mudança deixa `audience_refreshed_at` nulo e o job do minuto seguinte refaz, fora das faixas (nulo sempre vence). Mudar só os produtos de um "No primeiro acesso" no ar muda quem é aluno novo na faixa seguinte (até 15 minutos). Motivo e medida em §7.2.

---

## 5. Segurança

- **Hora marcada**: o `show` continua a única porta do conteúdo; o 409 `not_started` só sai para quem está no segmento (depois do 404 de quem não está), sem conteúdo, só com o Começa que o plano daquele aluno já tinha.
- **Primeiro acesso**: decidido no servidor (a linha de entrega); o navegador não tem como se declarar "novo". A marca nunca vai para quem não poderia ver (candidato = do segmento e, em "estes produtos", com acesso aberto). Os acessos são a verdade (AGENTS.md): o reembolso tira o pop-up de boas-vindas daquele produto.
- **Curso concluído**: o sinal da página pode ser forjado por um script; o `show` confere no banco. O pior: concluir a aula por um fim de vídeo forjado (código rodado no iframe pelo DevTools), o que o aluno já pode fazer pelo botão Concluir. Nada que valha mais que o Concluir depende disso (não há certificado nem liberação paga).
- **Histórico dos avisos**: até a seção 5 da migração, o próprio aluno podia inserir linhas em `student_events` com qualquer `entity_type`. Agora a política recusa `entity_type = 'campaign'` (D20): o custo e o índice não crescem com linhas forjadas e "Onde apareceu"/"Em que momento" não podem mais ser distorcidos daqui para frente. As linhas `campaign` saem só pelo servidor (service role); o navegador só grava `entity_type: "auth"`. Para as linhas forjadas de antes, a função conta só quem tem linha vista, limita por aluno às vezes da linha, confere página/momento/jeito com as listas do app e tira a equipe; com histórico forjado, as partes podem somar mais que o total, e a tela nunca mostra soma nem percentual acima de 100 %.
- **RPCs fechadas**: `communication_popup_report` e `communication_popup_products_ok` revogadas de `public`/`anon`/`authenticated`, só `service_role` (assinatura exata conferida na guarda; o teste de integração exige `42501` do `authenticated`). A página do relatório exige `messaging.write`.
- **Players de fora**: origens exatas + `event.source === iframe.contentWindow` com `contentWindow` não nulo; `targetOrigin` exato, nunca `*`; nenhum SDK (`@vimeo/player`, `player.js`, `@mux/*` fora do `package.json`), nenhum `<script>` nem `import()` de URL, nenhum `innerHTML`; a CSP (`src/proxy.ts`) não ganhou origem em `script-src` (um SDK de fora rodaria na nossa origem com o `'strict-dynamic'`). Manter `Referrer-Policy: strict-origin-when-cross-origin` (`next.config.ts`), o `referrerPolicy` do iframe e o `allow-same-origin` do `sandbox`: sem eles, os receptores Player.js não respondem ou `event.origin` vira `"null"`. Guarda `players-de-fora.guard`.
- **Auditoria e eventos**: só ids, códigos e contagens (`popup_access_products: <quantos>`); nenhum dado pessoal novo; retenção sem mudança (a lacuna da retenção de `student_events` está no §9.1, D2).

---

## 6. Rotas e ações

### 6.1 Rotas do aluno

| Rota | O que muda |
|---|---|
| `GET /api/notifications/summary?page=<chave>` | o mapa e o plano levam os pop-ups que começam nas próximas 24 h; item com `startsAt` (ISO) quando o Começa cai entre 24 h atrás e 24 h à frente; `trigger` nos quatro momentos. Página que só um agendado cobre: uma leitura pela chave primária durante as até 24 h antes do Começa |
| `POST /api/popups/[id]/show` | `{ page, trigger }` com `trigger` em `page_load`, `lesson_completed`, `first_login`, `course_completed` (já validado por `POPUP_TRIGGERS`); novo **409 `{ error: "Pop-up fora da vez.", nextAt, reason: "not_started", asOf }`** antes da hora (era 404); todo 409 leva `asOf` (a hora do servidor na recusa, ISO; o navegador acerta por ela o relógio da segunda tentativa); `course_completed` com o curso incompleto → **409 `reason: "trigger"`, `nextAt: null`**; o `message_impressed` grava `{ campaign_id, page, trigger }` como antes |
| `PUT /api/progress/lessons` (e o `POST` do envio de saída) | **200 `{ courseCompleted: true, data }`** só no pedido que fecha o curso para um aluno; nos outros, `{ data }` como antes (≈ 25 B a mais só na virada); erros iguais |
| `POST /api/popups/[id]/events` | sem mudança |

A cota de 30 por minuto por aluno do pop-up continua (cada aluno faz no máximo 2 chamadas na hora marcada: a abertura e, com o relógio adiantado, a segunda tentativa).

### 6.2 Server Actions e leituras

| O quê | O que muda |
|---|---|
| `saveNoticeDraft` (e todo caminho que grava um pop-up já publicado: editar no ar, pausado, aprovar edição) | recusa trocar de ou para "No primeiro acesso" (`NoticeFieldError("popup.trigger", …)`, 400; o texto mora em `popup-first-access.ts`, porque `actions.ts` é `"use server"`); auditoria com `popup_access_products` |
| `publishNotice`, `approveNotice` | `PublishedNotice.popup = { startsInFuture, trigger }` (preenchido em `goLive`, o caminho comum dos dois; nunca no pedido de aprovação nem na notificação) |
| `duplicateNotice` | copia o momento e os produtos (sem linhas nem marcas) |
| `queries.ts` | `getPopupReport` (§4.6); `popupProductIds` inclui os produtos do primeiro acesso (nomes no Detalhes e nas frases) |
| `/admin/comunicacao/avisos/[id]` | `popupReport` (`Suspense` + `PopupReportLoader`) só para pop-up publicado |

### 6.3 Eventos (`student_events`)

Nenhum evento novo. `message_impressed.trigger` pode ser `first_login` ou `course_completed`. O aluno não grava mais linhas `campaign` (§5). O índice parcial cobre só essas linhas.

---

## 7. Desempenho

### 7.1 Custo por caminho

| Caminho | Antes | Depois |
|---|---|---|
| Resumo `?page=` numa página não coberta | 0 leituras | 0 |
| Resumo `?page=` numa página que só um agendado cobre | 0 (não coberta) | 1 leitura pela chave primária por resumo durante as até 24 h antes do Começa (no máximo uma vez por minuto por aba, pela memória de 60 s) |
| Resumo `?page=` numa página coberta | 1 leitura pela chave primária | igual (a lista de ids pode ter os agendados; continua ≤ 60) |
| `show` de página, de aula ou do primeiro acesso | 3 idas (a linha, a RPC, o `message_impressed` depois da resposta) | igual |
| `show` de "Ao concluir um curso" | — | 3 + 2 em sequência (progresso ∥ módulos; aulas) |
| Hora marcada, alunos parados | — | 1 `show` por aba parada, espalhado em 4 s depois de hora + 2 s |
| Despertador (até 30 s) e conferência ao voltar para a aba | — | 0 pedidos |
| `PUT /api/progress/lessons` | o de hoje | nenhuma leitura nova |
| Recálculo de um "No primeiro acesso" | — | 0 leitura nova; 1 gravação por aluno e pop-up (a marca) |
| Relatório (admin, cache 60 s) | — | 2 leituras: a RPC e os nomes |
| Player de fora tocando, pausando, acabando | — | 0 pedidos (só mensagens entre janelas) |

### 7.2 Medido no integrador (23/10/2026)

Postgres 17.11 local (Supabase em docker, `work_mem` 4 MB), `next build` + `next start` local com as variáveis de teste. Números brutos e scripts no relatório do integrador (`scratchpad/v3/v3b2/Z.md` e `z-work/`).

**Relatório (a RPC, como o app chama, plano genérico)**. Dados: 2.664.046 linhas em `student_events` (547 MB), 264.045 delas de avisos; um pop-up de 3 mil alunos com 24.006 linhas no histórico (2.662 viram) e um de 30 mil com 240.006 (26.662 viram). p50 / p95:

| Função | 3 mil, com índice | 30 mil, com índice | 3 mil, sem índice | 30 mil, sem índice |
|---|---|---|---|---|
| a do desenho (antes da reescrita) | 508 / 661 ms | 5.287 / 5.436 ms | 513 / 600 ms | 3.669 / 3.777 ms |
| **a da migração** | **88 / 145 ms** | **1.036 / 1.315 ms** | 192 / 243 ms | 985 / 1.154 ms |

Metas: p95 ≤ 300 ms com 3 mil (**batida**); ≤ 1 s com 30 mil (p50 no limite, p95 ~30 % acima). Aceito: 30 mil alunos num pop-up é 15 vezes a escala do `docs/17` (300 a 2.000 alunos, onde a função leva dezenas de ms), e o relatório tem cache de 60 s e fica num `Suspense`. Com 30 mil, o tempo vai em ler as 240 mil linhas pelo índice e o jsonb (~400 ms), na passada por aluno (~350 ms, derramando em disco) e nos produtos (~300 ms); `work_mem` de 16 MB não mudou nada. Para ir além, só lendo menos (índice de cobertura ou números guardados por pop-up, D2). Igualdade com a função do desenho conferida com `EXCEPT ALL` nos dois sentidos em 3 mil, 30 mil, num pop-up vazio e num de casos de borda. Índice: 1.952 kB; montado em ~2,3 s (2,66 milhões de linhas).

**200 `show` no mesmo minuto** (2.200 contas de teste com acesso e uma aula concluída; um pop-up por rodada, "Em qualquer página", "Uma vez", começando no minuto da rodada; cada `show` com as três idas e, localmente, duas idas ao Auth por pedido, `AUTH_SESSION_STRATEGY=user`; 3 rodadas com o tick e 3 sem, intercaladas; o tick recalculando 2.212 alunos e gravando 2.203 linhas):

| Modo | Sem tick, p50 / p95 | Com tick, p50 / p95 | Tick | Erros |
|---|---|---|---|---|
| espalhado em 0–4 s (como o navegador, D2), faixas nas horas redondas | 41,9 / 110,5 ms | 40,4 / 106,0 ms | 0,63–0,94 s | 0 |
| todos ao mesmo tempo (pior caso) | 2.218 / 2.846 ms | 2.315 / 2.647 ms | 3,0–3,2 s | 55 respostas 500 em 1.200 |
| espalhado, **faixas deslocadas** (o tick do minuto redondo não tem pop-up vencido) | 36,8 / 164,2 ms | 36,3 / 107,8 ms | 0,31–0,34 s, 0 linhas | 0 |

Leitura: o tick não piora o `show` (com ele, o p95 ficou igual ou menor), mas o p95 com ele passou de 100 ms, a regra do desenho para deslocar as faixas: o deslocamento entrou (§4.7) e foi medido de novo. Entre rodadas, o p95 espalhado varia de 52 a 195 ms (os poucos pedidos mais lentos, ligados ao Auth e à coleta de lixo; o p50 fica em 31–49 ms). Todos ao mesmo tempo, a fila de 200 pedidos num processo e no Auth leva o p50 a ~2 s; os 55 erros (`fetch failed`) vêm do Kong local (o gateway do Supabase da CLI), que fecha conexões acima de ~300 simultâneas (sonda contra o PostgREST local: 200 simultâneos, 0 falhas; 400, 83; 600, 270). Com o espalhamento de 4 s, nenhum erro. Na Hetzner o gateway é o Envoy, ainda não medido assim (R17). Na Hetzner, com a sessão pelas `claims`, o `show` faz menos idas ao Auth. O `show` sequencial da v3b-1 tinha p95 de 22 ms (`docs/25` §6).

**Leituras por minuto do resumo com um agendado em "Em qualquer página"** (Chromium com 50 abas, cada uma um aluno, trocando de página pelo menu a cada 8–12 s durante 3,5 min; o agendado com linhas para os 2.200 alunos):

| Fase | Trocas de página | Resumos com `page` | Com plano (leituras) | Leituras por minuto |
|---|---|---|---|---|
| agendado para daqui a 25 h (fora do horizonte, como antes) | 917 | 163 | 2 | 0,6 |
| agendado para daqui a 2 h (dentro do horizonte) | 920 | 154 | 153 | 44,4 |

O horizonte de 24 h acrescenta no máximo uma leitura pela chave primária por aba por minuto (≈ uma a cada 6 páginas abertas).

**JavaScript ao abrir** (gzip, soma dos `rootMainFiles` com os `entryJSFiles` do layout e da página; o mesmo método do `docs/26` §7):

| Página | Antes (bytes) | Depois (bytes) | Diferença | Orçamento |
|---|---|---|---|---|
| Início | 297.308 | 299.027 | +1.719 B | ≤ 1 KB: **passa ~0,7 KB (excedido e aceito)** |
| Favoritos | 281.118 | 282.837 | +1.719 B | ≤ 1 KB: **passa ~0,7 KB (excedido e aceito)** |
| Aula | 390.199 | 392.832 | +2.633 B | ≤ 3 KB: ok |

O que cresce em toda página é a hora marcada (o modelo do host com o cliente +868 B, o host +346 B, o sinal da aula +337 B, o pedaço do `popup-display-model` usado no navegador 1.229 → 1.391 B), que precisa estar em toda página onde um pop-up ao vivo pode abrir. A ponte (≈ 1,8 KB) fica num pedaço baixado só na aula com player da lista; a janela do pop-up continua à parte. Baixar `reconcileClockOpenings` e `rearmAfterNotStarted` à parte tiraria só ~0,3 KB, continuaria acima do orçamento e poria um download justo no minuto da hora marcada, quando todas as abas abrem juntas: o integrador aceitou o excesso (§8.2).

---

## 8. Decisões

### 8.1 Tabela

Origem: **P** = de produto como veio no pedido; **P\*** = de produto detalhada ou estendida aqui; **E** = de engenharia.

| # | Decisão | Origem | Por quê |
|---|---|---|---|
| D1 | A hora marcada **não é momento novo**: é o comportamento de "Ao abrir a página" (e de "No primeiro acesso") com `Começa: Em uma data`; `at_start` continua sem uso | P\* | o check exige `starts_at` para `at_start` e os Modelos nunca guardam a janela: um modelo com `at_start` abriria inválido; para o aluno dá no mesmo, sem campo novo |
| D2 | Para quem já está na página, "Quanto tempo depois" conta da hora marcada; abertura em hora do servidor + 2 s + 0 a 4 s sorteados + "Quanto tempo depois" | E | a folga cobre o relógio acertado; o sorteio evita todos os alunos no mesmo segundo |
| D3 | O plano leva os pop-ups que começam nas próximas 24 h (`notBefore = Começa`) e todo item com Começa entre 24 h atrás e 24 h à frente leva `startsAt`; o mapa cobre os agendados; um plano mais novo arma a hora marcada antes ou depois da hora | E | custo zero por aluno; sem o `startsAt` depois da hora, quem estava com a aba aberta desde antes da publicação não veria; o navegador antigo ignora `startsAt` e respeita `notBefore` |
| D4 | `show` antes da hora, de aluno do segmento: 409 `not_started` com `nextAt` e `asOf` (era 404); o navegador tenta mais uma vez, com o relógio acertado pelo `asOf` da recusa | E | um relógio que erre alguns ms não pode tirar o pop-up do plano; o acerto do plano pode estar velho (o relógio do aparelho mudou depois), e a segunda tentativa com ele cairia no mesmo instante errado; só quem está no segmento recebe 409 |
| D5 | A abertura na hora marcada não desiste por tempo (o Termina decide no servidor); toda abertura armada segue a hora de parede (despertador de até 30 s e conferência ao voltar) | P\* | aba escondida congela temporizador; um `setTimeout` de horas volta atrasado pelo tempo suspenso |
| D6 | Na aula, regra única: vídeo tocando = espera parar, em todo player que a página lê (arquivo, YouTube, Bunny/Vimeo/Mux com a ponte confirmada); ponte pendente confere a cada 1 s; só no player que a página não lê continua "mexeu = descarta" | P\* | o pedido E(1) estendido ao arquivo e ao YouTube por coerência: uma regra, uma frase no editor (pergunta P1) |
| D7 | "No primeiro acesso" com **Conta como primeiro acesso**: `A primeira vez na área` ou `A primeira vez com estes produtos`, decidido no recálculo do segmento; no navegador e no `show`, como "Ao abrir a página"; produtos numa coluna nova | P\* | as duas leituras cabem no mesmo motor e a segunda é o caso das vendas; os acessos são a verdade (o reembolso tira o pop-up, P10); zero custo por pedido |
| D8 | Linha "pegajosa" só com a marca do recálculo novo (`first_access_at`); linha elegível sem marca e sem ser candidata sai; num pop-up já publicado, trocar de ou para "No primeiro acesso" é recusado (duplique) | E | `last_sign_in_at` muda a cada login (sem a pegajosidade, o recálculo desligaria quem acabou de entrar antes de ver); sem a marca, uma linha de um app antigo ficaria elegível para sempre; a trava evita misturar dois momentos no relatório |
| D9 | Até 15 minutos de atraso para quem acabou de ganhar acesso | E | recalcular mais vezes lê todos os alunos; apressar fica para a B2 |
| D10 | "Ao concluir um curso" = todas as aulas publicadas dos módulos publicados concluídas (a regra "Progresso 100 %" do segmento); a rota de progresso diz a virada; o `show` confere no banco; formação = cada curso | P\* | o % do card pode divergir do segmento; o "antes" vem da gravação que venceu o compare-and-swap (sem leitura nova) |
| D11 | Cada virada para 100 % é nova chance (dentro de "Quantas vezes"); Modo TV e envio de saída não abrem; a formação inteira fica para a C2 | E | o mesmo modelo de "Ao concluir uma aula" |
| D12 | O relatório fica na página do pop-up, desde a publicação (sem o Período), com 4 números e 4 blocos, das linhas por aluno e do histórico já gravado; função medida, índice parcial, cache de 60 s e `Suspense` | P\* | é o que o pedido D descreve (pergunta P5) |
| D13 | Sem `page` nos eventos de resultado nesta entrega ("Como fecharam por página" fica para a D2) | P | "com os eventos já gravados" (pergunta P6) |
| D14 | Ponte própria por `postMessage` (protocolos do Vimeo e Player.js), sem SDK e sem mudar a CSP; origens exatas e `event.source`; `targetOrigin` exato; só confia depois do `getPaused` respondido | E | um SDK de fora rodaria na nossa origem; só a resposta prova a ponte |
| D15 | Com a ponte confirmada, o fim do vídeo conclui a aula e o progresso usa o tempo real; o cronômetro inventado só sem ponte; concluir só no fim | P\* | o pedido E(2); o produto já conclui assim no YouTube e no arquivo |
| D16 | A ponte liga pela origem do `src` do iframe (a Bunny é um grupo de duas origens), não pelo provedor gravado | E | o Vimeo não listado só toca colado; a Bunny pode passar a responder pelo host novo |
| D17 | Modelos: os dois momentos e os produtos entram pelos schemas de sempre; payload continua versão 1; a janela continua fora | P | o pedido manda os momentos novos entrarem nos modelos |
| D18 | Uma migração aditiva e idempotente em cinco seções (a 5ª sozinha), sem `drop`/`delete`/gatilho/`create policy`, sem citar a coluna do design | E | respeita os limites do MCP e a guarda do Livre; o check dos produtos confere id por id |
| D19 | Vocabulário (topo deste documento) | P | `docs/17` §1.3, `docs/25` P15 |
| D20 | O aluno deixa de gravar linhas de avisos no próprio histórico (`<> 'campaign'` na política de insert) | E | o teto da função limita as contas, não o custo: linhas forjadas aos milhões passariam pela função e inchariam o índice |

### 8.2 Decisões do integrador (com medida)

| # | Decisão | Por quê |
|---|---|---|
| Z1 | `communication_popup_report` **reescrita** com o mesmo resultado linha a linha (`EXCEPT ALL` nos dois sentidos = 0 em 3 mil, 30 mil, pop-up vazio e pop-up de casos de borda) | a do desenho levava 508/661 ms com 3 mil e 5,3 s com 30 mil (§7.2); a guarda confere as mesmas listas a partir de `POPUP_PAGE_KEY.source` e o sha256 novo |
| Z2 | **Faixas do recálculo dos pop-ups deslocadas** para :07/:22/:37/:52, com no máximo 15 minutos entre recálculos; os fluxos continuam nas horas redondas | o p95 do `show` com o tick passou de 100 ms (a regra do desenho); a fórmula do desenho (`popupRefreshDueBefore(now − 7 min)`) cortava 7 min antes da virada e deixaria um pop-up até 22 min sem recálculo, então a faixa soma os 7 min de volta (`popupRefreshBandStart`) |
| Z3 | **Orçamento de JavaScript excedido e aceito**: +1,72 KB no Início e em Favoritos (orçamento 1 KB) e +2,63 KB na aula (orçamento 3 KB) | é o código da hora marcada, que precisa estar em toda página; tirar à parte o pouco que dava (~0,3 KB) não fecharia o orçamento e poria um download no minuto da hora marcada |

### 8.3 Escolhas da entrega

O que a implementação decidiu onde o desenho era omisso ou não batia com o código:

- **Servidor**: o texto da trava (`FIRST_ACCESS_SWITCH_MESSAGE`) e a comparação (`switchesFirstAccess`) moram em `popup-first-access.ts` (`actions.ts` é `"use server"` e só exporta funções assíncronas); `PublishedNotice.popup` é preenchido em `goLive`, o caminho comum de publicar e aprovar; `popupSettingsOfRow` corta em 20 os produtos válidos lidos da linha; a lista no ar (`LIVE_POPUP_COLUMNS`) não leva os produtos (o plano nunca os usa; menos dado no cache, que continua com a chave `design2`); o teste de `PublishedNotice.popup` ficou na integração.
- **Navegador**: as origens, as regras e `embedBridgeTarget` moram num módulo pequeno (`src/lib/lesson-embed-origins.ts`, reexportado pela ponte), porque o Turbopack junta módulos inteiros e a ponte inteira entraria no JS de toda página; o hook baixa a ponte por `import()`; o sinal lê `data-lesson-player-bridge` do palco em vez de conferir o `src` (o teto de 15 s é uma constante local, conferida no teste contra `EMBED_BRIDGE_RULES.pendingMaxMs`); o despertador e o `checkDue` viraram a função pura `createArmedClock` (testada com relógio falso); o `enabled` do hook usa `activeLessonVideoProvider !== "youtube"` (o `usesCustomYouTubeControls` só existe depois do retorno cedo da aula vazia); o `onPlay` da aula passa por um ref (o React Compiler desistia da memoização); depois do `load`, a `targetOrigin` continua a da última mensagem aceita (cobre a Bunny que manda o `ready` do host novo antes do `load`); um `completed` com `courseCompleted` diferente de `true` continua um sinal de aula concluída (só a chave some); `onPause` recebe o último tempo guardado (o `pause` do Vimeo não traz tempo); `onTime` só com o vídeo tocando.
- **Editor e relatório**: o chip `Produto removido` (com o botão de tirar) é novo no seletor do primeiro acesso (o seletor de base não mostrava produto escolhido que saiu da lista); `Outros produtos` tem alunos `—` (`students: null`); os nomes são lidos só dos 10 produtos que a tela mostra pelo nome; o toast tipa `result.popup` pela forma (um módulo puro não importa de `"use server"`); `PopupWindowFields` e `NoticeWhenFields` ganharam `now` (a linha da hora marcada depende de "Começa no futuro" e `Date.now()` no render não passa no lint do React Compiler); na revisão do curso, o tempo segue a regra da aula (`3 s` não aparece; `, logo depois`); o cartão "No máximo, para um aluno" quebra a definição em até 3 linhas; a seção do relatório não é um `SectionCard` (seria cartão dentro de cartão).
- **Integrador**: `PlanItem`/`PlanAnswer` do host viraram apelidos de `PopupPlanItem`/`PopupsAnswer`, as listas locais de momentos deram lugar a `isPageTrigger`/`isLessonTrigger` e o horizonte do host lê `POPUP_V3B2_RULES.liveHorizonMs`; Z1 a Z3 acima.

---

## 9. Fica de fora, riscos e testes

### 9.1 Fica de fora

| Fora da v3b-2 | Onde está / por quê |
|---|---|
| **A2**: reler o plano sozinho com o aluno parado na mesma aba (para pegar um pop-up publicado depois, sem Começa) | seria um pedido em laço por aluno; quem abre outra página ou volta para a aba já pega. **Nunca**, a não ser que o produtor peça e aceite o custo |
| "Na hora marcada" como momento próprio (`at_start`) | D1 |
| **B2**: liberar acesso apressar o recálculo do "No primeiro acesso" daquele aluno (leitura só de quem entrou nos últimos minutos) | toca o caminho das vendas e do admin de acessos; o atraso de 15 minutos já é o de qualquer segmento |
| **C2**: "Ao concluir a formação inteira" | precisa da conta de todos os cursos da formação; a formação não tem aulas próprias no índice |
| **D2**: `page` (e `trigger`) nos eventos de resultado ("Como fecharam por página"); o "Período" no relatório; a analista ver o relatório; **retenção de 24 meses de `student_events`** (prometida no `docs/17` §2.4, nunca feita; `202610170004_personal_data_retention.sql` não cobre a tabela) | D13; a página exige `messaging.write` desde a v3a; a retenção é uma lacuna de LGPD própria, com job e migração próprios. **Quando a retenção chegar, o relatório "Desde a publicação" encolhe sem aviso** (o histórico some, as linhas por aluno ficam): o job da D2 guarda antes os números do relatório de cada pop-up, ou a tela troca o `footnoteHistory` por "nos últimos 24 meses" |
| Relatório de pop-up com 30 mil alunos abaixo de 1 s | ler menos: índice de cobertura ou números guardados por pop-up (junto com a D2) |
| A linha **"Também no ar no Início: …"** na Revisão (pop-ups em sequência que a equipe não vê), prevista no `docs/25` §8 | **v3b-3**: precisa da lista dos pop-ups no ar dentro do editor (uma leitura nova por abertura do editor, com as regras de página e frequência de cada um), sem relação com os momentos e o relatório desta entrega |
| **E2**: tirar a capa transparente que pede dois toques nos players de fora; gravar a Bunny no host novo `player.mediadelivery.net` (melhor no iPhone); liberar a tela cheia de Bunny e Mux no `Permissions-Policy` (`next.config.ts`); montar o Vimeo não listado com o `?h=` | mudanças de experiência da aula, cada uma com teste próprio (pergunta P9) |
| Teto de conexões no `fetch` do servidor (o agente do undici), para uma live com milhares de abas | o espalhamento de 4 s não deu erro na medida (§7.2); fica como mitigação se a rodada de carga na Hetzner mostrar um teto parecido com o do Kong local |
| Baixar `reconcileClockOpenings`/`rearmAfterNotStarted` à parte | Z3 |
| Certificado ao concluir o curso | não existe certificado no produto |
| Enquete dentro do pop-up | v3b-3 |

**Ajustes conhecidos, para depois**: os quatro arquivos ponta a ponta novos rodam no Chromium localmente; o WebKit roda no CI. A suíte de integração deixa eventos `campaign` órfãos de contas de teste (o `limparComunicacao` apaga avisos, não o histórico deles): não muda um relatório por id, mas pesa numa conta global de `student_events` no banco local.

### 9.2 Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | App de antes no mesmo banco (prévias antigas; a `dev` entre aplicar a migração e o merge; a volta para a imagem anterior na Hetzner) lê os momentos novos como "Ao abrir a página": o plano e o `show` dele aceitam; o tick dele habilita o segmento inteiro num "No primeiro acesso"; editar ali um "No primeiro acesso · A primeira vez na área" grava "Ao abrir a página" sem erro | a linha sem a marca e sem ser candidata sai no recálculo seguinte do app novo (D8); **regra de operação** (§3, §10 passo 1, `docs/21` §9.5 e `docs/20` §9): não publicar nem editar esses momentos com o app de antes no ar, não usar prévias de PRs anteriores, pausar antes de voltar a imagem. Sem trava no banco (pediria um gatilho) |
| R2 | App de antes abrindo modelo novo: a parte `settings` inteira vira o padrão, com a nota | igual a R1; `docs/28` |
| R3 | Pico na hora marcada: todos os alunos parados chamam o `show` em ~4 s | sorteio de 4 s; lista no ar em cache; medido com 200 (§7.2) |
| R4 | Aba escondida, congelada ou aparelho dormindo | despertador de até 30 s e conferência ao voltar (D5); sem desistência por tempo; o Termina decide; dica no editor |
| R5 | Quem abriu a área antes da publicação e ficou parado sem trocar de página nem voltar para a aba não vê na hora | dica "Publique com antecedência" e a ressalva no toast; o plano mais novo arma antes ou depois da hora (D3) |
| R6 | Relógio do navegador (inclusive o que muda depois de o plano chegar: acerto do sistema, NTP) | acerto pelo `asOf` do plano (erra para o lado seguro), folga de 2 s, 409 com uma segunda tentativa acertada pelo `asOf` da própria recusa |
| R7 | Primeiro acesso: até 15 minutos de atraso; curso que vem pela formação não casa com o curso | dicas no editor; B2 depois |
| R8 | Mudar o Começa de um "No primeiro acesso" já publicado para depois mantém elegíveis os que já tinham a marca | raro; a linha "A mudança vale para quem chegar daqui para frente"; duplicar recomeça; em "estes produtos", a marca nunca segura quem perdeu o acesso |
| R9 | Curso concluído: aula publicada depois reabre a chance; Modo TV e envio de saída não abrem; duas abas podem armar as duas | uma virada só por gravação (compare-and-swap); a frequência decide o resto; o `show` confere no banco |
| R10 | Números do histórico não fecham com os das linhas (teto de 100/dia, envio de saída perdido, volta do cache, 404 no meio); eventos de antes da v3b-1 sem página nem jeito; linhas forjadas antes da seção 5; retenção de `student_events` | "Sem registro" e o rodapé com a base de cada número; antigos como Início e "Fecharam (sem detalhe)"; o teto da função; D2 |
| R11 | O índice trava as escritas em `student_events` enquanto monta; com 30 mil alunos num pop-up, a função leva ~1,0/1,3 s (§7.2) | contar as linhas antes; ~2,3 s para 2,66–3,3 milhões; cache de 60 s e `Suspense` |
| R12 | **Players de verdade**: sem referrer (Brave, `no-referrer`, extensões) a ponte não confirma; a Bunny legada (`iframe.mediadelivery.net`, o host que gravamos) só responde depois do `loadeddata` (no iPhone, ali, a regra "espera parar" só vale depois do play); a tela cheia nativa dentro do iframe no iPhone é invisível para a página (um pause ali pode liberar o pop-up por baixo, que fica aberto quando o aluno sai da tela cheia); Bunny e Mux não avisam tela cheia pelo Player.js; o `iframe.mediadelivery.net` pode passar a levar ao player novo | sem ponte, tudo como antes; ponte pendente confere a cada 1 s; ouvir sempre e perguntar `getPaused` depois de qualquer pronto; a Bunny aceita as duas origens; o pop-up por baixo não se perde. **Conferência em aparelho real antes da PR `dev → main`** (§10.1) |
| R13 | Evento falso do player (DevTools no iframe) conclui a aula | o mesmo que o botão Concluir já permite |
| R14 | Mudança no arquivo e no YouTube (D6): quem dá play e pausa logo vê o pop-up "Ao abrir a página" (antes, não via) | pedido E(1) estendido de propósito; pergunta P1 |
| R15 | `lesson-experience.tsx` é grande e muito mexido | inserções pequenas; o hook só muda estado quando a ponte, o tocar ou a tela cheia mudam |
| R16 | Tick e hora marcada no mesmo minuto | medido (§7.2); faixas deslocadas para :07/:22/:37/:52 (Z2) |
| R17 | **Teto de conexões no gateway da API**: o Kong do Supabase local fecha conexões acima de ~300 simultâneas (55 respostas 500 em 1.200 com 200 `show` todos ao mesmo tempo); na Hetzner o gateway é o Envoy (`docs/20` §2), com limites que ninguém mediu: uma live com milhares de abas pode dar erro 500 no `show` | o espalhamento de 4 s não deu erro com 200; a rodada de carga com um pop-up de hora marcada (`docs/20` §12.1) diz se o teto existe lá; se existir, um teto de conexões no `fetch` do servidor (§9.1) |
| R18 | A medida do `show` local passa pelo Auth duas vezes por pedido (`AUTH_SESSION_STRATEGY=user`) | na Hetzner, com `claims` e chaves assimétricas, o `show` fica mais leve; os números do §7.2 são o lado pesado |

### 9.3 Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/pop-ups-v3b2-modelo.test.mjs` (13) | os quatro momentos; produtos lidos e canônicos (inválidos saem, fora do primeiro acesso somem, configuração de antes byte a byte); schemas e mensagens novas; o plano com o agendado em 1 h (`startsAt` e `notBefore`), fora em 25 h, começado há menos de 24 h com `startsAt`; o mapa; `decideShow` (`not_started`, `not_eligible`, `not_live`); a matriz de `isFirstAccessCandidate`; `firstAccessDeliveryChanges` (inclusive a linha sem marca de um app antigo e quem perdeu o acesso); `firstAccessSince`; `isCourseComplete`/`courseJustCompleted`/`courseCompletedOf`; vocabulário |
| Unitário | `tests/pop-ups-v3b2-rotas.test.mjs` (6) | resumo com agendado (uma leitura, `startsAt`) e página fora (zero); `show` agendado 409 com `{ error, reason, nextAt }`, fora do segmento 404, na hora 200; `course_completed` completo 200 e incompleto 409 sem RPC (só esse momento lê o progresso); a rota de progresso com `courseCompleted` só na virada e o "antes" da gravação |
| Unitário | `tests/pop-ups-v3b2-navegador.test.mjs` (20) | `openingsForPageView` com hora marcada e sorteio fixo, acerto do relógio, `rearmAfterNotStarted`, `givenUp`, a tabela inteira do `blockReason` (inclusive `bridge_pending` antes de `touched`), `completionOpenings` com o curso, `planItemOf`, `lessonMediaSnapshot` com DOM falso, `readLessonMediaSignal`, o plano que chega depois (`reconcileClockOpenings`), o relógio de parede (`createArmedClock`, o aparelho que dormiu, `visibilitychange`/`pageshow`/`focus`) e a tela cheia avisada só por mensagem |
| Unitário | `tests/players-de-fora.test.mjs` (16) | origens exatas e as maliciosas, `event.source` e o iframe desmontado, o grupo da Bunny trocando a `targetOrigin`, `parseEmbedMessage`, o aperto de mão (12 × 400 ms, nunca `*`, pronto tardio), o Vimeo já carregado (resposta ao `ping`), a confirmação só pelo `getPaused`, os estados, o `load` que recomeça, a sessão do hook (callbacks novos não religam, troca de aula anuncia "sem resposta"), `embedAnnouncement` e `shouldReportTime` |
| Unitário | `tests/pop-ups-v3b2-editor.test.mjs` (16), `tests/pop-ups-v3b2-frases.test.mjs` (9), `tests/pop-ups-v3b2-relatorio.test.mjs` (13) | as quatro pílulas, `settingsForTrigger`, `canExclude`, `placementUiOf`, os erros só da tela, a trava (`disabledValues` e `aria-describedby` desenhados), cada texto da §2.1, os toasts; cada frase da §2.5 palavra por palavra, com nomes e `Produto removido`, e o pop-up padrão com a frase de antes; a leitura das linhas, os KPIs, `Sem registro`, ordens, `Outros produtos`, base 0, vazio, cada texto do relatório (rodapé sem data); vocabulário em todos |
| Guarda | `tests/comunicacao-v3b2.guard.test.mjs` (6), `tests/players-de-fora.guard.test.mjs` (6) | migrações até a `202610250001` byte a byte; a 0026 com cinco seções, um `alter policy` exato e nada de `drop`/`delete`/gatilho/`create policy`/`concurrently`; a página da função com as mesmas listas de `POPUP_PAGE_KEY.source` (sem repetição limitada, sem junção), uma linha de números por item das listas; assinatura e permissões exatas; o check dos produtos id por id; o sha256; a ponte sem `*`, sem `<script>`, sem `import()` de URL, sem `innerHTML`; as quatro origens; o `referrerPolicy`, o `sandbox` e o `Referrer-Policy`; nenhum SDK; a CSP sem origem nova; o sinal não carrega a ponte |
| Unitário (atualizados) | `pop-ups-v3b1-modelo` (23), `pop-ups-v3b1-rotas` (18), `pop-ups-v3b1-navegador` (22), `pop-ups-v3b1-memoria` (14), `pop-ups-v3b1-editor` (20), `pop-ups-v3b1-frases` (14), `comunicacao-job` (28), `comunicacao-modelos-modelo` (21), `lesson-progress-server` (6), `lesson-materials-api` (7), `comunicacao-modelos-editor` (19), `comunicacao-modelos-acoes` (10) | de propósito: agendado no plano e no mapa (D3); 409 `not_started` no segmento (D4); 13 colunas; tocar antes vira esperar (D6); `subscribePopupMemory`; quatro pílulas e os textos novos; o recálculo do primeiro acesso com a marca e as viradas :07/:22/:37/:52 (o corte de 15:07:42 passa a 15:07:00); os momentos nos modelos; o "antes" da tentativa vencedora |
| Integração | `tests/integration/pop-ups-v3b2-momentos.test.mjs` (10) | hora marcada (resumo com `startsAt`, 409, 200 com `now` na hora, 404 fora do segmento); primeiro acesso na área (conta nova marcada, conta antiga que nunca entrou continua depois de entrar) e com produtos (acesso novo, antigo não conta, plataforma conta, reembolso tira); linhas de um app antigo saem; a trava 400; o curso (1ª aula sem, 2ª com `courseCompleted`, de novo sem, desmarcar e concluir de novo com, equipe nunca, **dois `PUT` concorrentes = exatamente uma virada**, `show` 200 e 409); modelos com os momentos; `PublishedNotice.popup` |
| Integração | `tests/integration/pop-ups-relatorio.test.mjs` (4), `tests/integration/pop-ups-relatorio-tela.test.mjs` (2), `tests/integration/progresso-aula.test.mjs` (13) | as linhas cruas da RPC (Favoritos, aula do produto, Esc, X, clique, faixas), a equipe fora, o insert forjado recusado pelo RLS (o `auth` passa), linhas de antes limitadas pelas da conta, sem página/momento/jeito, páginas no limite (240 × 241 caracteres, dois pontos, curinga, vazio, maiúscula), `authenticated` com 42501; `getPopupReport` contra o banco (números, nomes do catálogo, vazio); `courseCompleted` no `PUT` e no envio de saída |
| Ponta a ponta | `tests/e2e/aluno-ve-pop-up-na-hora-marcada.spec.ts` | o pop-up "Em qualquer página" com Começa em 25 s abre em Favoritos para a aluna parada (não antes; `page: "saved"`, `trigger: "page_load"`); dois na mesma hora, um de cada vez; na aula com o Vimeo falso tocando, só depois de Pausar |
| Ponta a ponta | `tests/e2e/aluno-ve-pop-up-no-primeiro-acesso-e-curso.spec.ts` | "No primeiro acesso · A primeira vez com estes produtos" publicado pela tela (frase ao vivo e revisão), acesso liberado, recálculo, aparece no Início e não volta ("Uma vez"); "Ao concluir um curso" pelo Concluir na última aula (`trigger: "course_completed"`), desmarcar não abre |
| Ponta a ponta | `tests/e2e/aluno-ve-pop-up-com-video-de-fora.spec.ts` | páginas falsas servidas nas origens reais (Vimeo e Player.js nos três endereços): Tocar antes dos 3 s não abre e Pausar abre; Terminar conclui a aula sem tocar em Concluir e abre "Ao concluir uma aula"; Terminar na última aula abre "Ao concluir um curso"; outra origem mandando `ended` não conclui |
| Ponta a ponta | `tests/e2e/produtor-ve-relatorio-do-pop-up.spec.ts` | a aluna vê em Favoritos e fecha no Esc; o relatório mostra `Favoritos 1`, `Fecharam no Esc 1`, `Vezes que apareceu 1`; "Ver como tabela" e volta; 375 px sem rolagem lateral |
| Ponta a ponta (atualizados) | `tests/e2e/aluno-ve-pop-up-nas-paginas.spec.ts`, `tests/e2e/produtor-configura-pop-up.spec.ts` | "play antes dos 3 s descarta" vira "espera parar" (D6); quatro pílulas, a trava do primeiro acesso no ar (pílulas desabilitadas uma a uma e a linha ligada), o toast com a ressalva e o relatório vazio logo depois de publicar |

Ajudas novas em `tests/e2e/fixtures.ts` (§7.4 item 2 do desenho): `publicarPopUp` com `quando: "first_login" | "course_completed"` e `produtosDoPrimeiroAcesso`; `liberarAcessoDeTeste`/`tirarAcessoDeTeste`; `recalcularPopUp(id)` (zera `audience_refreshed_at` e roda o tick: um `null` sempre recalcula na hora, mesmo com as faixas deslocadas); `concluirAulasDaAluna`; `paginaFalsaDoVimeo`/`paginaFalsaPlayerJs` (`page.route` nas URLs reais; respondem o aperto de mão e o `getPaused`, e escrevem "pronto" para o teste esperar); `relatorioDoPopUp(id)`. Cuidados do WebKit: nada de área de transferência nem de mouse fora da janela, foco conferido antes de teclar, clicar até o efeito aparecer, medir posição só depois de parar, os 3 s contados do topo hidratado, e na hora marcada a partir de `starts_at` com o espalhamento na margem.

Totais na integração (`0be0674`): `npm run verify` verde com **1.869 testes unitários (1.868 passaram, 0 falharam, 1 pulado, o `ssh-keygen` que já era pulado)** e o build; `npm run test:integration` **491/491**; a 0026 aplicada duas vezes, `db:reset` (52 migrações) e mais uma vez por cima, com as consultas do cabeçalho.

---

## 10. Roteiro de conferência no ambiente de teste

**Antes do merge na `dev`** (quem faz o merge; passo a passo em `docs/21` §9.5): aplicar a `202610260001` no Supabase da nuvem. `list_migrations` (com `202610250001`, sem `202610260001`); contar as linhas (`select count(*) from public.student_events;`: até uns 10 milhões, o índice leva segundos, e as escritas na tabela esperam enquanto ele monta); as cinco seções pelo MCP `execute_sql`, **uma por chamada e na ordem**, cada uma começando com `set lock_timeout = '5s';` e a 5 **sozinha** (se o MCP recusar o `alter policy`, pelo SQL Editor), ou `apply_migration` com o arquivo inteiro, nome `communication_v3b2`; as consultas do cabeçalho (constraint validada; 1 função de produtos; 0 pop-ups com produtos; 0 marcas; o índice; as duas funções com `authenticated` = false e `service_role` = true; o relatório de um id qualquer = `max 0 0`, `median 0 0`, `viewers 0 0`; a política com `campaign` no `with check`); e, se foi por `execute_sql`, gravar o histórico (`202610260001`, `communication_v3b2`). Sem a migração, o admin de avisos e o job `comunicacao` do tick param.

1. **Conferir que a `dev` já roda a v3b-2** antes de publicar qualquer "No primeiro acesso" ou "Ao concluir um curso" (R1): abrir **Novo aviso › Pop-up** pelo endereço da `dev` (não por uma prévia de PR) e ver as quatro pílulas em **Quando aparece**. Daqui em diante, **não usar prévias de PRs anteriores** para criar ou editar pop-ups (elas usam o mesmo banco e tratam os momentos novos como "Ao abrir a página").
2. Um pop-up que já existia continua igual (mesmas páginas, mesmo momento, mesma frase na revisão); o relatório dele mostra **Como o pop-up foi visto** com os números de antes (as vezes antigas aparecem como Início e "Fecharam (sem detalhe)").
3. **Hora marcada**: pop-up **Em qualquer página**, **Começa: Em uma data** daqui a 5 minutos e **Termina** 30 minutos depois. Ao publicar, o toast traz a ressalva da hora marcada. Com a aluna de teste parada em Favoritos (sem mexer): não aparece antes; na hora, aparece com alguns segundos de diferença.
4. **Celular travado antes da hora e destravado depois**: mesma montagem, com a aluna no celular numa página escolhida; travar o celular antes da hora e destravar alguns minutos depois: o pop-up abre ao destravar.
5. **Aba aberta desde antes da publicação**: abrir a área numa aba, publicar um pop-up com Começa daqui a 3 minutos, ir para outra aba e voltar só depois da hora (com o número do sino vencido, mais de 1 minuto): o pop-up aparece. Sem voltar nem trocar de página, não aparece na hora (dito no toast e na dica).
6. Depois do **Termina**: voltar para uma aba que ficou escondida: nada aparece.
7. **No primeiro acesso · A primeira vez na área** (**Só no Início**, **Uma vez**): a equipe cria uma conta nova de teste (no segmento do pop-up) depois de publicar; depois do recálculo seguinte (até 15 minutos, ou **Pausar** e **Retomar**), ela entra e vê no Início; recarregar: não vê de novo. A aluna de teste antiga (que já entrou) não vê. A frase ao vivo diz `Aparece na primeira vez que o aluno entra na área, no Início.`
8. **No primeiro acesso · A primeira vez com estes produtos**: escolher um produto que a aluna de teste ainda não tem; publicar; liberar o acesso a ela; em até 15 minutos (o recálculo seguinte; para não esperar, **Pausar** e **Retomar** o pop-up, que recalcula na hora), ela vê na próxima página escolhida que abrir. Num segundo pop-up igual, liberar e logo tirar o acesso (reembolso) antes de ela entrar: ela não vê.
9. **Trava**: no pop-up "No primeiro acesso" no ar, as outras três pílulas estão desabilitadas com a linha `Num pop-up que já foi ao ar, “No primeiro acesso” não troca com os outros momentos. Para isso, duplique o pop-up.`
10. **Ao concluir um curso** (**De qualquer curso**): com a aluna, concluir todas as aulas de um curso menos a última; na última, tocar em **Concluir**: o pop-up abre logo depois. Desmarcar e concluir de novo: conta como nova vez (se "Quantas vezes" deixar).
11. **Vídeo do Bunny, do Vimeo ou do Mux** numa aula com **Ao concluir uma aula**: deixar o vídeo terminar: a aula fica concluída sozinha e o pop-up abre. Com **Ao abrir a página · 3 s** nessa aula: dar play antes dos 3 s: o pop-up espera; pausar: ele abre.
12. **Vimeo em tela cheia no iPhone com um pop-up esperando**: aula com Vimeo e um pop-up **Ao abrir a página** nela; dar play e pôr em tela cheia antes de o pop-up abrir; pausar dentro da tela cheia e sair dela: o pop-up aparece depois de sair (ou já está aberto por baixo e continua aberto até fechar; nunca some sem o aluno ver).
13. **Relatório**: num pop-up visto pela aluna (fechado no Esc), abrir a página dele: **Vezes que apareceu**, **Onde apareceu** (a página certa), **Como fecharam** (`Fecharam no Esc`); **Ver como tabela** e volta; no celular (375 px), sem rolar para o lado. Um número novo pode levar até 1 minuto.
14. **Modelos**: salvar como modelo um pop-up "No primeiro acesso" com produtos e um "Ao concluir um curso"; usar cada um: o editor abre com o momento e os produtos.
15. No celular (375 px): o card **Quando e onde aparece** com as quatro pílulas, a escolha **Conta como primeiro acesso** e **De quais cursos** cabem sem rolar para o lado.

### 10.1 Conferência em aparelho real dos players (risco R12; condição para a PR `dev → main`, não para a PR na `dev`)

Numa aula de teste de cada player, com a aluna de teste e um pop-up **Ao abrir a página · 3 s** e outro **Ao concluir uma aula** nas páginas de aula:

| Aparelho e navegador | Bunny (`iframe.mediadelivery.net`) | Bunny (`player.mediadelivery.net`, colado) | Vimeo | Mux |
|---|---|---|---|---|
| Computador, Chrome | | | | |
| Computador, Safari | | | | |
| iPhone, Safari | | | | |

Em cada célula, conferir e anotar: (a) dar play antes dos 3 s: o pop-up **espera**; pausar: abre; (b) deixar o vídeo terminar: a aula conclui sozinha e "Ao concluir uma aula" abre; (c) tela cheia com um pop-up esperando: nada abre por cima do vídeo em tela cheia; ao sair, o pop-up aparece (ou está aberto por baixo); (d) no iPhone com a Bunny legada, sem play: o pop-up "Ao abrir a página" pode não abrir (esperado, dito no editor); com play e pausa, abre. Num navegador sem referrer (Brave), conferir que tudo fica **como antes** (sem conclusão automática; o pop-up de página só antes do play). Anotar os resultados nesta seção; um player que não confirma a ponte fica como antes e não segura a promoção, mas precisa ser registrado aqui.

### 10.2 Resposta ao produtor (para colar)

> A segunda parte dos pop-ups está pronta para testar na `dev`:
>
> - **Hora marcada ao vivo**: com **Começa: Em uma data**, o pop-up agora abre na hora certa também para quem já está parado numa das páginas escolhidas (por exemplo, o aviso da live às 20:00), mesmo com o celular travado ou a aba escondida até lá: ele abre quando o aluno volta. Pode haver alguns segundos de diferença entre os alunos, para não pesar. Quem já estava com a área aberta antes de você publicar passa a contar a partir da próxima página que abrir ou de quando voltar para a aba: publique com antecedência. Para um aviso de hora curta, marque também **Termina**, assim ninguém vê o pop-up depois que a live acabou.
> - **No primeiro acesso** (momento novo): o aluno vê na primeira página escolhida que abrir. Você escolhe entre **A primeira vez na área** (quem ganhou a conta depois que o pop-up começou, ou ainda não tinha entrado nenhuma vez) e **A primeira vez com estes produtos** (quem ganhou acesso a um dos produtos marcados depois que o pop-up começou, mesmo que já usasse a área, ou quem tem o acesso e nunca entrou). Quem perde o acesso ao produto (reembolso, cancelamento) deixa de ver. Para quem acabou de comprar, pode levar até 15 minutos para valer: nesse caso, ele aparece na página seguinte. Num pop-up que já foi ao ar, esse momento não troca com os outros: para isso, duplique.
> - **Ao concluir um curso** (momento novo): aparece na página da aula logo depois que o aluno conclui a última aula que faltava do curso. Numa formação, vale para cada curso dela.
> - **Relatório do pop-up**: na página de cada pop-up, onde ele apareceu (por página e por produto), em que momento, como os alunos fecharam (botão, X, Esc, clicando fora, saindo da página, Lembrar depois, Não mostrar de novo) e quantas vezes cada aluno viu. Conta desde a publicação e atualiza a cada minuto.
> - **Vídeos do Bunny, do Vimeo e do Mux**: a área passa a saber quando o vídeo toca, pausa e acaba. A aula conclui sozinha no fim do vídeo, como já acontece com o YouTube.
> - Na aula, o pop-up **nunca abre com o vídeo tocando**, em nenhum desses players: ele espera o vídeo parar (antes, se o aluno desse play, o pop-up "ao abrir a página" desistia). Exceção conhecida: no iPhone, o vídeo do Bunny só responde à página depois do play; ali, antes do play, o pop-up pode não abrir.
> - Os dois momentos novos também entram nos **Modelos** de pop-up. Nenhum limite novo: cada pop-up segue o **Quantas vezes** que você escolher.
>
> Só publique pop-ups **No primeiro acesso** ou **Ao concluir um curso** depois de conferir que a entrega está no ar na `dev` (a versão anterior trata esses pop-ups como "Ao abrir a página"), e não use links de prévia de entregas antigas para editar pop-ups.
>
> Assumimos as respostas abaixo para não travar a entrega. Se alguma estiver diferente do que você quer, é só dizer:

| # | Pergunta | O que assumimos |
|---|---|---|
| P1 | Na aula, o pop-up "ao abrir a página" deve **esperar o vídeo parar** também no vídeo de arquivo e no YouTube, em vez de desistir quando o aluno dá play? | Sim, a mesma regra em todo vídeo (D6) |
| P2 | "No primeiro acesso": quem **já tinha acesso mas nunca entrou** conta como aluno novo? | Sim (D7) |
| P3 | O atraso de até 15 minutos para quem acabou de comprar é aceitável nesta entrega? | Sim; deixar mais rápido fica para depois (B2) |
| P4 | "Ao concluir um curso" numa formação: um pop-up por curso concluído está bom, ou você quer também "ao concluir a formação inteira"? Desmarcar e concluir de novo conta como nova vez? | Um por curso; a formação inteira depois (C2); desmarcar e concluir de novo conta, dentro de "Quantas vezes" |
| P5 | O relatório deve seguir o "Período" do topo da lista, ou mostrar desde a publicação? | Desde a publicação, como o resto da página do pop-up (D12) |
| P6 | Quer que, daqui para frente, o histórico guarde a página também no clique e no fechar (para ver "como fecharam em cada página")? Nenhum dado pessoal novo | Fica para depois (D2, D13) |
| P7 | Para quem só lê (analista), o relatório deve abrir? Hoje a página pede permissão de criar avisos | Fica como está |
| P8 | A hora marcada pode abrir com até alguns segundos de diferença entre os alunos? | Sim (D2) |
| P9 | Nos vídeos do Bunny, tirar a capa que pede dois toques e passar a gravar no endereço novo do Bunny (melhor no iPhone)? Liberar tela cheia de Bunny e Mux? | Fica para uma entrega própria da aula (E2), com teste próprio |
| P10 | No "A primeira vez com estes produtos", quem perde o acesso ao produto (reembolso, cancelamento) deixa de ver o pop-up de boas-vindas dele. Está bom? | Sim: os acessos são a verdade (D7) |

### 10.3 Próximos passos (depois da v3b-2)

1. Conferência em aparelho real (§10.1), antes da promoção para a `main`; depois do deploy, a rodada de carga na Hetzner com um pop-up de hora marcada (R17, `docs/20` §12.1).
2. **v3b-3**: a linha "Também no ar no Início: …" na Revisão e a enquete dentro do pop-up.
3. **D2**: `page` nos eventos de resultado, o Período no relatório, a analista ver o relatório e a retenção de `student_events` (guardando antes os números de cada pop-up).
4. **E2**: as mudanças da aula com os players de fora (capa de dois toques, host novo da Bunny, tela cheia de Bunny e Mux, Vimeo com `?h=`).
5. **B2** e **C2**, se o produtor pedir.
