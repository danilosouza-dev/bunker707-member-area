# 25. Comunicação v3b-1: pop-ups com páginas, momentos, frequência e como fechar

Data: 22/10/2026. Pedido do produtor (21/10/2026), depois de testar a v3a na `dev`: `eu quero poder definir a frequência com que esse aluno vai ver esse pop-up. Se vai ser uma vez por dia, se vai ver 10 vezes por dia, se vai ver 5 vezes por dia, até ele clicar, ou até ele clicar e não ver mais. Eu que tenho que definir isso, não tem que ser pré-definido.`; `Não quero esse limite fixo de segurança para mostrar as [pop-ups] para os alunos. Eu que tenho que definir isso manualmente.`; em quais páginas o pop-up aparece e em quais nunca; e, depois do desenho, `tem que ter a opção configurar para o popup fechar clicando no x ou fora ou só no x.`

Este documento registra a primeira parte da **v3b "Pop-ups sob medida"**: **onde** o pop-up aparece (e onde nunca), **quando** (ao abrir a página ou ao concluir uma aula), **quantas vezes** para cada aluno (escolhido pela equipe, sem limite fixo entre pop-ups), em quanto tempo o **Lembrar depois** traz de volta, **como fechar** e as configurações no **Detalhes** do relatório. Vale para qualquer trabalho em pop-ups, Comunicação ou na página da aula que mexa no player. Ele continua a v1 (`docs/22`), a v2 (`docs/23`) e a v3a (`docs/24`). As próximas partes: **v3b-2** (modelos de configuração para pop-ups e notificações, a hora marcada ao vivo, o primeiro acesso, o relatório de onde apareceu e como fecharam) e **v3b-3** (o construtor avançado com enquete no pop-up). **Atualização (22/10/2026):** o visual do pop-up saiu antes, como **Design do pop-up** (`docs/26`: Padrão | Personalizado com vídeo ou imagem com degradê, blocos, fontes enviadas e botões com estilo livre); da v3b-3 resta a enquete no pop-up. Migração `202610220003_communication_v3b1.sql` (as `202610200001`, `202610200002`, `202610210001`, `202610220001` e `202610220002`, já aplicadas na nuvem de teste, não mudam). Tabelas em `docs/05` (seção Comunicação v3b-1), segurança em `docs/06` (seção Comunicação v3b-1), desenho em `docs/12`, decisões em `docs/09` e admin em `docs/17` §1.8.1. Mudam regras da v1 e da v3a: o pop-up **não é mais só da home** (`docs/22` C6), o **24 h do "Até o aluno clicar" vira um intervalo comum, editável** (`docs/24` §10.8), **Mostrar de novo vale em qualquer "Quantas vezes"** (`docs/24` T6) e o **Lembrar depois tem o tempo escolhido pela equipe** (`docs/17` D12).

---

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Onde aparece** | `Só no Início` (padrão) · `Em qualquer página` · `Escolher páginas` (Início, Página do produto, Páginas de aula, Minhas compras, Favoritos, Materiais, Minha jornada, Continue assistindo, Perfil, Suporte; produto e aula com "qualquer" ou os escolhidos), mais **Nunca nestas páginas** (a exceção vence); uma formação vale também para os cursos dela | editor, card **Quando e onde aparece** |
| **Quando aparece** | `Ao abrir a página` (de 0 a 600 s, padrão 3 s) ou `Ao concluir uma aula` (de qualquer produto ou dos escolhidos); `Começa: Em uma data` faz o "a partir de tal hora" | editor, mesmo card |
| **Quantas vezes** | `Uma vez`, ou `Mais de uma vez` com **Limitar por dia** (1 a 100), **Tempo entre uma vez e outra** (1 minuto a 90 dias), **Limite total** (2 a 1.000) e **Para de aparecer** (`Quando o aluno clica no botão` · `Só quando o pop-up terminar`); `Não mostrar de novo` sempre vale | editor, card **Quantas vezes e como fecha** |
| **Lembrar depois** | **Volta em** de 5 minutos a 7 dias (padrão 24 horas), até 2 vezes | mesmo card |
| **Como fechar** | `No X ou clicando fora` (padrão) ou `Só no X` (tocar fora só faz o X pulsar; o Esc continua fechando); o X tem 44 px de toque | mesmo card; legenda da prévia |
| **Um de cada vez** | dois pop-ups na mesma página: o segundo abre 1 s depois de o primeiro fechar; na aula, nunca com o vídeo do nosso player tocando | navegador do aluno |
| **Mostrar de novo** | em qualquer "Quantas vezes" (em `Só quando o pop-up terminar` também zera quem clicou) | menu ⋯ e editor do pop-up no ar |
| **Detalhes** | `Onde`, `Quando aparece`, `Quantas vezes`, `Como fecha` no relatório; segunda linha na coluna Quando da lista | relatório e lista |
| **Mapa, plano e abertura** | o resumo que já existe traz onde algum pop-up pode aparecer (sem ids de produto) e, na página coberta, o plano do aluno (sem conteúdo); `POST /api/popups/[id]/show` confere de novo, grava a abertura e só então devolve o conteúdo | `GET /api/notifications/summary?page=…`, `POST /api/popups/[id]/show` |

Vocabulário na tela (P15): **Pop-up**, **Quando e onde aparece**, **Onde aparece**, **Nunca nestas páginas**, **Quando aparece**, **Quanto tempo depois**, **Quantas vezes e como fecha**, **Mais de uma vez**, **Para de aparecer**, **Volta em**, **Como fechar**. A pílula do tipo `Pop-up na home` virou `Pop-up`. Nunca "campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template" ou "home" (testes de vocabulário em `pop-ups-v3b1-frases` e `pop-ups-v3b1-editor`).

---

## 1. O que o aluno vê

### 1.1 Quando um pop-up abre

Só quando **tudo** isto vale (o navegador confere de 1 a 5 pelo plano; o servidor confere de 1 a 4 de novo na hora de abrir, no `show`):

1. o aluno está no segmento (linha `campaign_deliveries` elegível, mantida pelo recálculo de 15 minutos e na publicação; a equipe nunca tem) e nunca escolheu `Não mostrar de novo`;
2. a página é uma das páginas do pop-up e nenhuma das exceções (1.2);
3. o momento chegou (1.3) e, na página da aula, vale o 1.4;
4. "Quantas vezes" deixa agora (1.5), contando desde o último `Mostrar de novo para quem já viu`, e o `Lembrar depois` venceu;
5. nada aberto por cima (outro diálogo ou gaveta, o sino, o menu da conta, a busca, a IA Diretor, o controle da TV), ninguém digitando, aba visível, nada em tela cheia (nem a tela cheia própria do vídeo no iPhone) e nenhum outro pop-up aberto;
6. é a sessão do próprio aluno (nunca no "ver como").

Dois pop-ups na mesma página ao mesmo tempo: abre primeiro o de início de janela mais recente (sem data de início, o publicado por último; empate pelo id), como antes; o outro abre 1 s depois de o primeiro terminar de fechar, se ainda for a vez dele.

### 1.2 Páginas

| Endereço | Chave | Nome no editor |
|---|---|---|
| `/` | `home` | Início |
| `/conteudo/[id]` | `content:<id>` | Página do produto |
| `/conteudo/[id]/aulas/[moduleId]` | `lesson:<id>` | Páginas de aula |
| `/minhas-compras` | `purchases` | Minhas compras |
| `/favoritos` | `saved` | Favoritos |
| `/materiais` | `materials` | Materiais |
| `/minha-jornada` | `journey` | Minha jornada |
| `/continue-assistindo` | `continue` | Continue assistindo |
| `/perfil` | `profile` | Perfil |
| `/suporte` | `support` | Suporte |

Qualquer outro endereço (`/login`, `/alterar-senha`, `/tv`, `/admin/**`, páginas de erro) não tem chave: pop-up nenhum, nunca. A chave ignora a busca e o `#`; a barra no fim não importa. A aula é `lesson:<id>` (e não `content:<id>` como nas visitas de página da v2), para página do produto e página de aula serem escolhidas separadas. Um curso que abre direto na primeira aula (`settings.coursePresentationMode = "lesson_playlist"`) redireciona antes de a página do produto aparecer: para ele só "Páginas de aula" vale (a frase ao vivo do editor avisa). Escolher uma **formação** cobre também as páginas dos cursos dela, inclusive os que entrarem depois (o servidor expande). Trocar de aula pela playlist não é navegação: continua uma visualização de página, com uma ou mais aulas concluídas.

### 1.3 Momentos ("Quando aparece")

| Momento | O que o aluno vive |
|---|---|
| **Ao abrir a página** | abre N segundos (0 a 600, padrão 3) depois de uma página escolhida abrir (no Início, o primeiro pedido sai 1,5 s depois de carregar, como antes, a não ser que o navegador já saiba o plano). Com a aba escondida, espera ela voltar; com algo por cima ou alguém digitando, confere de novo a cada segundo; desiste 10 minutos depois da hora (nada é gravado). Ficar na página nunca faz abrir de novo: passado o "Tempo entre uma vez e outra", ele volta na **próxima** página escolhida que o aluno abrir |
| **Ao concluir uma aula** | numa página de aula de um dos produtos (ou de qualquer um), N segundos (padrão 3) depois de a aula ficar concluída e o servidor confirmar: no fim do vídeo de arquivo ou do YouTube, ou quando o aluno toca em `Concluir`. Cada aula concluída é uma nova chance (dentro de "Quantas vezes"). Nunca em outra página |
| *Num horário* (não é momento: `Começa: Em uma data`) | a partir dessa data e hora, quem abrir uma das páginas vê (até 1 minuto depois numa aba que já estava aberta). Quem está parado numa página não vê o pop-up surgir na hora exata: isso vem na v3b-2 |

Nada é empurrado para o navegador (sem tempo real, C11).

### 1.4 Na página da aula

- **Nunca com o nosso player tocando**: o `<video>` de arquivo (lido do próprio elemento: nem pausado nem no fim) e o YouTube com os nossos controles (`playing`/`buffering`). Nunca em tela cheia (a da página ou a do vídeo no iPhone) nem com o controle da TV aberto.
- `Ao abrir a página` na aula: só se o aluno **não tocou no player** nesta visualização (deu play no nosso player, ou está com o foco dentro de um player de fora: Bunny, Vimeo, Mux). Numa tela de toque (`pointer: coarse`), aula com player de fora conta como tocada desde o começo (o toque dentro do iframe não chega à nossa página no iPhone). Tocou: aquele pop-up sai desta visualização, nada aparece, nada é gravado.
- `Ao concluir uma aula`: abre para a aula concluída, depois de o servidor gravar:
  - o aluno continua nela e nada toca → abre depois do tempo escolhido;
  - o nosso player tocava essa aula quando ela foi concluída (Concluir no meio do vídeo) → espera pausar ou acabar;
  - antes de abrir, a aula na tela mudou (playlist) ou o vídeo voltou a tocar depois de concluir → essa abertura sai (nada gravado); a próxima aula concluída é nova chance;
  - o aluno saiu da página antes → nada aparece, nada é gravado;
  - uma conclusão desfeita antes da resposta do servidor não conta.
- **Bunny, Vimeo e Mux** (iframes de outro domínio; ler o `postMessage` deles vem na v3b-2): a aula conclui só pelo `Concluir`, e tocar em `Concluir` conta como parado: se o vídeo ainda estiver tocando, o pop-up abre por cima, sem pausar. Escrito na dica do editor e na resposta ao produtor. Com as aulas indo para o Bunny (`docs/09`), esse vai ser o caso comum até a v3b-2.
- O pop-up nunca pausa nem retoma o vídeo da aula (só abre quando nada do nosso toca). Na home, o vídeo do destaque continua como antes: pausa com o pop-up aberto e volta depois.

### 1.5 Quantas vezes (para cada aluno)

`Uma vez`: aparece uma vez; para quando o aluno fecha (X, Esc, fora, saindo da página com ele aberto), clica no botão ou escolhe `Não mostrar de novo`; cada `Lembrar depois` dá mais uma vez, depois do `Volta em`.

`Mais de uma vez` (qualquer combinação; só a parada é obrigatória):

| Campo | Efeito |
|---|---|
| **Limitar por dia** → Vezes por dia (1 a 100) | no máximo N por dia, de meia-noite a meia-noite no horário de Brasília (UTC−3, como o resto do sistema); depois da N-ésima, só depois da meia-noite |
| **Tempo entre uma vez e outra** (1 minuto a 90 dias) | a próxima espera X depois da última; passado X, volta na próxima página escolhida que o aluno abrir (ou na próxima aula concluída), nunca no meio de uma página aberta |
| **Limite total** → Vezes no total (2 a 1.000) | para de vez depois de N; `Lembrar depois` não gasta vez |
| **Para de aparecer** | `Quando o aluno clica no botão` (padrão): o clique para; fechar não. `Só quando o pop-up terminar`: continua no ritmo mesmo depois do clique, até a data de fim. Sem botão no pop-up, a primeira opção fica desligada e um `Mais de uma vez` novo começa em `Só quando o pop-up terminar` |

- Sem limite por dia nem intervalo: aparece em toda página escolhida (ou toda aula concluída), com pelo menos 5 s entre uma e outra, até a parada; o editor avisa, não proíbe.
- `Não mostrar de novo` sempre para de vez, em qualquer modo. Aparece sempre no Padrão; no Personalizado (`docs/26` D34) e no Livre (`docs/27` §1) a equipe pode escondê-lo, e o aluno continua fechando pelo X, pelo `Esc` e (fora de "Só no X") clicando fora.
- `Lembrar depois` (quando permitido) esconde pelo `Volta em` (5 minutos a 7 dias, padrão 24 horas), no máximo 2 vezes desde o último `Mostrar de novo`.
- Mudar "Quantas vezes" de um pop-up no ar vale na hora, contando o que cada aluno já viu.
- Os pop-ups de antes em `Até o aluno clicar` são exatamente `Mais de uma vez` com `Tempo entre uma vez e outra: 1 dia` e `Quando o aluno clica no botão` (P10). Os que não têm botão abrem no editor e são salvos como `Só quando o pop-up terminar` (sem botão, ninguém clica: dá no mesmo; seção 8.1).

### 1.6 Como fechar

- `No X ou clicando fora` (padrão, como antes): o X, o Esc e tocar no véu fecham.
- `Só no X`: tocar no véu não fecha (Base UI `disablePointerDismissal`), só faz o X pulsar (escala 1 → 1,12 → 1 em 300 ms; nada com `prefers-reduced-motion`); o X e o Esc fecham.
- Todo fechamento conta como visto (como antes). O jeito (`x`, `outside`, `esc` ou `page`: saiu da página ou recarregou com ele aberto) vai só para o histórico. `Lembrar depois`, `Não mostrar de novo` e o botão contam como o que são.

### 1.7 Textos, estados, acessibilidade e 375 px

- **Nenhum texto novo para o aluno**: o cartão é o mesmo `MemberPopupCard` (título `h2`, texto, áudio, botão, `Lembrar depois`, `Não mostrar de novo`, o X com `aria-label="Fechar"`). Nada diz onde ou por que ele apareceu.
- **Carregando**: nada aparece até o código da janela carregar e o `show` responder (o código é baixado em tempo ocioso assim que algo é armado, e sempre **antes** do `show`); nunca esqueleto nem carregando por cima da página.
- **Falhas são silenciosas**: resumo ou código da janela falhou → `show` nunca é chamado e nada conta como visto; `show` recusou (409/404/429) ou falhou → nada aparece, nada conta. A única perda aceita: o aluno sai da página com o `show` no ar (contou, não desenhou).
- **Acessibilidade**: o `Dialog` do Base UI de sempre (`aria-modal`, nome = título, descrição = texto, foco preso, rolagem travada, foco volta ao fechar). `Só no X` mantém o Esc. O X mantém o círculo de 36 px e ganha 44 px de toque (uma caixa invisível `before:` em volta), nos dois modos.
- **375 px**: o cartão já cabia; nada novo no lado do aluno.

### 1.8 O que é registrado (invisível para o aluno)

Na linha do próprio aluno em `campaign_deliveries`: cada abertura (`impressions`, `day_impressions` novo, `first_seen_at`, `last_seen_at`), o clique, `dismissed_at`, `snooze_count`/`snoozed_until` (como antes). Eventos em `student_events`, só ids e códigos curtos (seção 5.3). Retenção como antes (24 meses depois da última mudança da linha, menos pop-ups no ar); conta excluída leva tudo.

### 1.9 A pergunta do produtor, respondida para a v3b-1 (para colar; substitui a resposta do `docs/24` §2.4)

> Se um pop-up em **Uma vez** passa para **Mais de uma vez**, quem só fechou **volta a ver** no ritmo que você escolher (por exemplo, até 3 vezes por dia, ou com pelo menos 1 dia entre uma vez e outra), até parar pela regra que você marcou em **Para de aparecer**. Se quiser que todo mundo que já viu volte a contar do zero, ligue **Mostrar de novo para quem já viu** ao salvar (ou use o menu ⋯): agora vale em qualquer "Quantas vezes". Quem escolheu **Não mostrar de novo** continua sem ver; quem clicou no botão também, a não ser que o pop-up esteja em **Só quando o pop-up terminar**. Mudar onde ou quando ele aparece vale na hora, e quem já viu continua contando como visto, também nas páginas novas. Para mostrar para absolutamente todos, use **Duplicar** e publique o novo.

---

## 2. O que a equipe faz (`/admin/comunicacao/avisos`)

### 2.1 Textos da v3a que mudaram

| Onde | Antes | Agora |
|---|---|---|
| Pílula do tipo | `Pop-up na home` | `Pop-up` |
| Dica do tipo | `Aparece no centro da home, 3 segundos depois de abrir. Nunca durante uma aula.` | `Aparece por cima da página, onde e quando você escolher.` |
| Descrição do editor | `Uma notificação no sino ou um pop-up na home, para um segmento.` | `Uma notificação no sino ou um pop-up, para um segmento.` |
| Cabeçalho de Comunicação › Avisos e pop-ups | `Notificações no sino e pop-ups na home do aluno, cada um para um segmento.` | `Notificações no sino e pop-ups para os alunos, cada um para um segmento.` (seção 8.1) |
| Aprovar | `O pop-up entra na home de {n}. …` | `O pop-up passa a aparecer para {318 alunos}, nas páginas e no momento escolhidos. A contagem é refeita na hora de publicar.` |
| Encerrar | `O pop-up sai da home de todos os alunos agora …` | `O pop-up para de aparecer para todos os alunos agora e não volta. Para mostrar de novo, duplique.` |
| Excluir no ar / pausado | `… sai da home …` / `… não volta para a home …` | `O pop-up para de aparecer para todos os alunos agora e o aviso sai desta lista, com o relatório. Não dá para desfazer.` / `O pop-up não volta a aparecer e o aviso sai desta lista, com o relatório. Não dá para desfazer.` |
| Toast de excluir no ar | `Pop-up excluído. Ele saiu da home.` | `Pop-up excluído. Ele não aparece mais para os alunos.` |
| Toast de publicar (no ar agora) | `Pop-up publicado.` | `Pop-up publicado. Em até 1 minuto ele começa a aparecer para quem já está na área.` (janela no futuro: `Pop-up publicado.`) |
| Confirmação do Mostrar de novo | `O pop-up volta a aparecer para quem já viu e não clicou. …` | `O pop-up volta a contar como novo para quem já viu: a contagem de “Quantas vezes” começa de novo. Quem escolheu “Não mostrar de novo” continua como está, e quem clicou no botão também (menos nos pop-ups que só param quando terminam).` |
| Toast do Mostrar de novo | `O pop-up volta a aparecer para {n alunos}.` | `Uma vez`: igual; `Mais de uma vez`: `A contagem de “Quantas vezes” recomeçou para {120 alunos}.` |
| Lista vazia (todos / pop-ups) | `… um pop-up para a home.` / `Crie um pop-up para a home dos alunos.` | `Crie uma notificação para o sino ou um pop-up para os alunos.` / `Crie um pop-up para os alunos.` |
| Caixa do card Quando do pop-up | `Por enquanto o pop-up aparece só na home, nunca durante uma aula, e um de cada vez.` | saiu; a nota do card novo (2.3) |
| `Permitir “Lembrar depois”` | `Volta em 24 h, até 2 vezes.` | `Volta em {1 dia}, até 2 vezes.` (do campo **Volta em**) |
| Retomar com 50 no ar (novo) | — | `Já há 50 pop-ups no ar ou agendados. Encerre um antes de retomar este.` |

A mensagem do servidor `Mostrar de novo vale para pop-ups em “Uma vez”…` não existe mais.

### 2.2 O editor do pop-up, card por card

Notificação não muda (só a prévia do celular, 375 px). No pop-up, a coluna da esquerda fica: **O que** → **Imagem e áudio** → **Para onde leva** → **Para quem** → **Quando e onde aparece** (novo; leva `Começa` e `Termina` do antigo "Quando") → **Quantas vezes e como fecha** (novo; leva "Quantas vezes", `Permitir “Lembrar depois”` e o `Mostrar de novo para quem já viu` da v3a, e ganha `Volta em` e `Como fechar`) → **Revisão**. O card "Quando" antigo fica só para notificações. A 375 px todo controle tem 44 px e as listas ficam numa coluna.

| Card | Descrição |
|---|---|
| Quando e onde aparece | `Em que momento e em quais páginas o pop-up abre.` |
| Quantas vezes e como fecha | `Para cada aluno: quantas vezes aparece, o que faz parar e como ele fecha.` |

### 2.3 Card "Quando e onde aparece"

- **Quando aparece**: `Ao abrir a página` (padrão) · `Ao concluir uma aula`, com a dica de cada um (a do segundo explica fim do vídeo, Concluir, Bunny/Vimeo/Mux, a espera do vídeo parar e a outra aula começada).
- **Onde aparece** (Ao abrir a página): `Só no Início` · `Em qualquer página` · `Escolher páginas` (a lista começa com o que estava escolhido: do `Só no Início` vem com o Início marcado). Lista em ordem do menu: `Início`; `Página do produto` (`Qualquer produto` · `Só estes produtos`, até 20, `Uma formação vale também para os cursos dela.`); `Páginas de aula` (`Qualquer aula` · `Aulas destes produtos`, com a dica do play e do celular); `Minhas compras` · `Favoritos` · `Materiais` · `Minha jornada` · `Continue assistindo` · `Perfil` · `Suporte`.
- **Nunca nestas páginas** (com `Em qualquer página`, ou com `Qualquer produto`/`Qualquer aula` marcados): chave `Nunca mostrar em algumas páginas` (`Ex.: em qualquer página, menos Perfil e Suporte.`) e a mesma lista em modo exceção; desligar limpa as exceções.
- **De quais aulas** (Ao concluir uma aula): `De qualquer produto` · `Só de aulas destes produtos`; com o primeiro, a chave `Menos as aulas de alguns produtos`.
- **Quanto tempo depois**: `Logo` · `3 s` (padrão) · `10 s` · `30 s` · `1 min` · `Outro` (0 a 600 segundos). Com `Logo` na abertura: `Abre assim que a página termina de carregar (no Início, pode levar cerca de 2 segundos).`
- **Começa / Termina** como antes; com `Começa: Em uma data`: `A partir dessa hora, quem abrir uma das páginas escolhidas vê o pop-up.`
- **Frase ao vivo**: `Aparece em qualquer página, menos Perfil e Suporte.` · `Aparece no Início e nas aulas de Formação IA.` · `Aparece ao concluir uma aula de Formação IA.` Produto escolhido em "Página do produto" que abre direto na aula, sem "Páginas de aula" cobrindo: ` (Curso X abre direto na aula: marque também “Páginas de aula”.)`. Sem página escolhida ainda, a frase espera (o campo já diz o que falta).
- **Linhas no pop-up no ar ou pausado**: mudou onde, as exceções ou o momento → `Mudar onde ou quando ele aparece vale na hora. Quem já viu continua contando como visto, também nas páginas novas. Para todos verem de novo, ligue “Mostrar de novo para quem já viu”.`; o início foi para o futuro num pop-up no ar → `Com o início no futuro, o pop-up deixa de aparecer para todos até {25/10/2026 às 20:00}.`
- **Nota fixa**: `Um pop-up de cada vez: se dois tiverem que abrir juntos, o segundo espera o primeiro fechar. Na aula, nunca com o vídeo do nosso player tocando; nos vídeos do Bunny, do Vimeo e do Mux, só antes do play (no computador) ou depois do Concluir.`
- Trocar o momento: para `Ao concluir uma aula` ficam só as páginas de aula (nenhuma → qualquer aula) e as exceções de aula; de volta, elas viram "Páginas de aula". `Quanto tempo depois` nunca muda sozinho.

### 2.4 Card "Quantas vezes e como fecha"

- `Uma vez` (`Aparece uma vez para cada aluno e para quando ele fecha, clica no botão ou escolhe “Não mostrar de novo”. Cada “Lembrar depois” vale mais uma vez.`) · `Mais de uma vez`. Escolher `Mais de uma vez` começa em **Limitar por dia: 1**, sem intervalo, sem total, `Quando o aluno clica no botão` (sem botão: `Só quando o pop-up terminar`); os últimos valores da tela voltam ao ir e voltar.
- Campos de `Mais de uma vez`: **Limitar por dia** (`Conta de meia-noite a meia-noite, no horário de Brasília.`) → `Vezes por dia`; **Tempo entre uma vez e outra** (a dica diz que volta na próxima página, nunca no meio de uma) → `Tempo` + `minutos` · `horas` · `dias` (ligar: 1 dia; um tempo salvo reabre na maior unidade exata: 1.440 = 1 dia, 120 = 2 horas, 90 = 90 minutos); **Limite total** (`“Lembrar depois” não gasta vez.`) → `Vezes no total` (padrão 10); **Para de aparecer** com as dicas de cada pílula; sem botão, a primeira desligada com `Este pop-up não tem botão. Ligue “Levar o aluno a algum lugar” ou escolha outra opção.`
- Linhas debaixo dos campos (podem aparecer várias): o conflito (`Com 1 dia entre uma vez e outra, cabem no máximo 1 vez por dia, não 10. Diminua o tempo entre uma vez e outra ou desligue essa opção.`), sem ritmo (`Sem limite por dia nem tempo entre uma vez e outra, o pop-up aparece toda vez que o aluno abrir uma das páginas escolhidas, …`), as vezes do dia seguidas (`Sem tempo entre uma vez e outra, as 10 vezes do dia podem acontecer seguidas, …`), sem data para acabar com `Só quando o pop-up terminar` (`Sem data para acabar, ele continua aparecendo enquanto o aluno estiver no segmento.`) e a fixa `“Não mostrar de novo” sempre vale: quem escolhe não vê mais este pop-up.`
- `Permitir “Lembrar depois”` (`Volta em {1 dia}, até 2 vezes.`) → **Volta em** (5 minutos a 7 dias); com o intervalo menor que o `Volta em`: `“Lembrar depois” esconde o pop-up por {1 dia}, mais do que o tempo entre uma vez e outra.`
- No pop-up no ar ou pausado: **Mostrar de novo para quem já viu**, **em qualquer modo**, desligada ao abrir, depois de salvar e a cada troca de "Quantas vezes"; o texto muda com a parada (`Para os 120 alunos que já viram e não clicaram: …` / em `Só quando o pop-up terminar`, `Para os 120 alunos que já viram: a contagem de “Quantas vezes” recomeça para eles. …`). "Quantas vezes" diferente do salvo: `Mudar “Quantas vezes” vale na hora para todos, contando as vezes que cada aluno já viu.`
- **Como fechar**: `No X ou clicando fora` · `Só no X` (`Clicar fora não fecha. O Esc continua fechando, para quem usa teclado ou leitor de tela.`).
- **Frase ao vivo**: `Cada aluno vê uma vez (mais uma a cada “Lembrar depois”). Fecha no X, no Esc ou clicando fora.` · `Cada aluno vê até 3 vezes por dia, com pelo menos 2 horas entre uma vez e outra (na próxima página que abrir depois desse tempo), até clicar no botão. Fecha só no X (e no Esc).`
- Toasts de salvar o pop-up no ar (todos terminam com ` Para quem já está com a área aberta, pode levar até 1 minuto.`, menos os do pausado): reiniciado em `Uma vez` → `Pop-up atualizado. Ele volta a aparecer para {120 alunos} que já tinham visto.`; reiniciado em `Mais de uma vez` → `Pop-up atualizado. A contagem de “Quantas vezes” recomeçou para {120 alunos} que já tinham visto.`; sem reiniciar → `Pop-up atualizado. Quem já viu não vê de novo.` / `Pop-up atualizado. Vale na hora, contando as vezes que cada aluno já viu.`

### 2.5 Validação (zod em `schemas.ts`, as mesmas frases na tela; o servidor decide de novo)

| Problema | Campo | Texto |
|---|---|---|
| nenhuma página marcada | `popup.pages` | `Escolha pelo menos uma página.` |
| linha "Só estes produtos" / "Aulas destes produtos" sem produto (só a tela) | `popup.pages` | `Escolha pelo menos um produto.` |
| mais de 20 páginas | `popup.pages` / `popup.exclude` | `Use até 20 páginas.` |
| a mesma página nas duas listas | `popup.exclude` | `Esta página está em “Onde aparece” e em “Nunca nestas páginas”.` |
| as exceções cobrem tudo | `popup.exclude` | `Com essas exceções, o pop-up não aparece em nenhuma página.` |
| `any` nas exceções ou página desconhecida (chamada direta) | `popup.exclude` / `popup.pages` | `Escolha páginas da lista.` |
| `Ao concluir uma aula` com página que não é de aula (chamada direta) | `popup.pages` | `Ao concluir uma aula vale só para páginas de aula.` |
| tempo fora de 0 a 600 | `popup.delaySeconds` | `Use de 0 a 600 segundos.` |
| por dia fora de 1 a 100 | `popup.frequency.maxPerDay` | `Use de 1 a 100 vezes por dia.` |
| intervalo fora de 1 minuto a 90 dias | `popup.frequency.everyMinutes` | `Use de 1 minuto a 90 dias.` |
| total fora de 2 a 1.000 | `popup.frequency.maxTotal` | `Use de 2 a 1.000 vezes. Para uma vez só, escolha “Uma vez”.` |
| sem parada | `popup.frequency.stopOn` | `Escolha quando o pop-up para de aparecer.` |
| `Quando o aluno clica no botão` sem botão (também tirando o botão depois) | `popup.frequency.stopOn` | `Este pop-up não tem botão: escolha quando ele para de aparecer.` |
| `Volta em` fora de 5 minutos a 7 dias | `popup.snoozeMinutes` | `Use de 5 minutos a 7 dias.` |
| sem jeito de fechar | `popup.close` | `Escolha como o aluno fecha o pop-up.` |

Publicar e aprovar (e pedir aprovação) com 50 pop-ups já publicados (este fora da conta) → 422 `Já há 50 pop-ups no ar ou agendados. Encerre um antes de publicar outro.`; retomar → 422 `… Encerre um antes de retomar este.` Notificação nunca leva `popup` (o editor tira a chave; o servidor grava os padrões para notificações).

### 2.6 Prévia, revisão, lista e relatório

- **Prévia**: o mesmo cartão do aluno; palco do celular **`Celular · 375 px`** (era 390), também nas notificações; legenda debaixo do pop-up: `Fecha no X, no Esc ou clicando fora.` / `Fecha só no X (e no Esc).`
- **Revisão**: `Pop-up {para 318 alunos}{, onde e quando}, {período}, {quantas vezes}.` O pop-up padrão (Início, ao abrir, 3 s, Uma vez) fica **exatamente** como antes (`Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez.`). Exemplo: `Pop-up para 318 alunos, em qualquer página, menos Perfil, logo ao abrir, a partir de agora, sem data para acabar, até 3 vezes por dia, com pelo menos 2 horas entre uma vez e outra, até o aluno clicar.` O ritmo de antes lê `com pelo menos 1 dia entre uma vez e outra, até o aluno clicar`. Com um campo do pop-up inválido: `Corrija os campos do pop-up para ver o resumo.`
- **Lista**: na coluna Quando, uma segunda linha quando não é o padrão: `Ao concluir uma aula` · `Em qualquer página` · `Em {n} páginas` · `No Início` (só com exceções ou outro tempo) · `Em Minhas compras` … `No Suporte` · `Na página do produto` · `Nas páginas de aula`, com ` (com exceções)`. O ⋯ oferece **Mostrar de novo para quem já viu** em todo pop-up no ar (dentro da janela) ou pausado; o toast segue o modo. **Duplicar** copia tudo (com as regras de janela de antes).
- **Relatório**: "Detalhes" ganha, depois de `Quando`, `Onde`, `Quando aparece`, `Quantas vezes`, `Como fecha` (ex.: `Em qualquer página, menos Perfil` · `Ao abrir a página, 3 segundos depois` · `Até 3 vezes por dia, até o aluno clicar` · `No X, no Esc ou clicando fora`). O quadro "Lembrar depois" diz o `Volta em` do pop-up (24 h no padrão, como antes; seção 8.1).

### 2.7 Quem pode (permissões e a regra dos 500)

| Ação | `messaging.write` | `messaging.publish` | `messaging.publish_large` |
|---|---|---|---|
| Criar e editar o rascunho com todas as configurações | sim | — | — |
| Publicar | pede aprovação | até 500 | acima de 500, e aprova pedidos |
| Mudar um pop-up no ar ou pausado (páginas, momento, tempo, frequência, `Volta em` e como fecha contam como mudar o que os alunos veem) | não (403) | até 500 | acima de 500 |
| Mostrar de novo para quem já viu (qualquer modo) | — | até 500 reiniciados | acima de 500 |
| Ver o relatório | sim | sim | sim |

O teto de 50 vale para todos. Auditoria (`admin_audit_log`, só ids, contagens e códigos): salvar, pedir aprovação, publicar e aprovar um pop-up gravam `{ popup_trigger, popup_pages: <quantos padrões>, popup_frequency: "once" | "repeat" }`; `communication.popup_reshown` `{ count, via }` como na v3a (agora em qualquer modo).

---

## 3. Dados (migração `202610220003`)

| Tabela / objeto | O que muda | Linhas de antes |
|---|---|---|
| `campaigns` | `popup_pages`, `popup_exclude_pages`, `popup_trigger`, `popup_delay_seconds`, `popup_frequency`, `popup_every_minutes`, `popup_max_per_day`, `popup_max_total`, `popup_stop_on`, `popup_close`, `popup_snooze_minutes`; seis checks (`campaigns_popup_pages_v3b`, `_trigger_v3b`, `_frequency_v3b`, `_close_v3b`, `_snooze_v3b`, `_only_v3b`) | `{home}`, `{}`, `page_load`, `3`, nulos, `any`, `1440`: todo pop-up de antes é "Início, 3 s depois de abrir, fecha em qualquer lugar, Lembrar depois em 24 h"; `popup_frequency` nulo = ler `popup_repeat` (`once` = Uma vez; `until_action` = 1 dia entre uma vez e outra, até clicar). Nenhuma linha é reescrita; a linha passa para o formato novo quando é salva. Notificação fica sempre com os padrões (`campaigns_popup_only_v3b`) |
| `campaign_deliveries` | `day_impressions` (vezes no dia de São Paulo de `last_seen_at`); o check entra `not valid` e é validado sozinho na seção 4 | 0 (uma linha vista hoje antes da v3b-1 conta 1) |
| `communication_popup_pages_ok(text[], boolean)` | nova: formato das páginas (os checks chamam) | — |
| `communication_record_popup_impression(uuid, uuid, timestamptz, timestamptz, timestamptz)` | nova: uma abertura, só se `updated_at` ainda é o lido, a linha é elegível, sem `Não mostrar de novo`, e o pop-up está no ar; devolve `{ impressions, day_impressions }` ou nulo | — |
| `communication_reshow_popup` (v3a) | mesma assinatura e retorno; sai a trava `popup_repeat = 'once'`; em `popup_stop_on = 'never'` entra quem clicou | o app da v3a continua chamando igual |

RLS como estava; cada função nova `security invoker`, só para `service_role` (assinatura exata, teste de guarda). Nenhum índice novo (o plano lê a chave primária `(campaign_id, user_id)` com `user_id = ? and campaign_id in (≤ 60)`). Detalhes em `docs/05`.

**Aplicar na nuvem antes do merge** (seção 10, passo 1). Sem a migração, o app novo para mais que os pop-ups: o admin mostra o aviso de banco desatualizado (as colunas novas estão em `CAMPAIGN_COLUMNS`), o resumo responde `popups: null`, `show` responde 404 e **o job `comunicacao` do tick falha** (lê as campanhas com `CAMPAIGN_COLUMNS`), parando notificações agendadas, seguintes e fluxos até a migração. A migração sozinha não atrapalha o app da v3a. **Depois do merge, não editar pop-ups pela prévia de uma PR mais antiga** (criada antes da v3b-1): ela usa o mesmo banco, e salvar um pop-up `Mais de uma vez` como o "Uma vez" da v3a fere `campaigns_popup_frequency_v3b` (a prévia antiga mostra o erro genérico; o app novo sempre grava `popup_repeat` e `popup_frequency` juntos). Na Hetzner, o `deploy-membros` aplica as migrações antes de trocar o app (`docs/20`).

---

## 4. Por dentro

Todas as regras moram em módulos puros usados pelo servidor, pelo navegador e pelos testes: `popup-display-model.ts` (páginas, exceções, formação, colunas ↔ configuração, "Quantas vezes", plano, mapa, decisão do `show`), `popup-sentences.ts` (as frases da equipe), `popup-editor-model.ts` (os cards), `popup-host-model.ts` (o que o navegador arma e o que bloqueia) e `lesson-media-signal.ts` (o player da aula). O banco só guarda o que precisa ser atômico (a abertura) e os formatos.

### 4.1 Mapa, plano e abertura

1. **Lista no ar** (`popups.ts` + `popup-store.ts`): `unstable_cache` de 60 s, tag `communications`, chave `["communications-live-popups", "v3b1"]` (a chave mudou porque o Data Cache da Vercel sobrevive a deploys); renovada por toda ação de pop-up. Lida com `limit(60)` (folga sobre o teto de 50: duas publicações juntas nunca escondem uma). Cada item: o conteúdo (para o `show`) e as regras, com as páginas e exceções já expandidas (formação → cursos, pela regra do catálogo, em até 2 consultas por renovação e só quando algum padrão cita produto). Uma falha ao ler as formações é registrada (`[comunicacao] cursos das formacoes: …`) e os pop-ups seguem com os padrões sem expandir.
2. **Resumo** (`GET /api/notifications/summary?page=<chave>`): da lista em cache (sem ler o banco) sai o **mapa grosso** (`pages`: onde algum pop-up no ar pode aparecer, com produto e aula reduzidos a `content:*`/`lesson:*`, para nenhum título de produto vazar para alunos fora do segmento; `["any"]` cobre tudo). Página fora do mapa → `plan: null`, **nenhuma leitura**. Página coberta → **uma** consulta às linhas do aluno e o **plano** (ids, páginas exatas, momento, tempo, quando pode de novo, como para; **sem conteúdo**). Erro dos pop-ups vira `popups: null`: o número do sino nunca quebra por causa deles.
3. **Abrir** (`POST /api/popups/[id]/show`, `{ page, trigger }`): confere no ar, segmento, página, momento e "Quantas vezes" sobre a linha lida (`decideShow`); grava pela RPC 5.1 com o `updated_at` **exatamente** como o PostgREST devolveu (microssegundos; nunca por `new Date()`); só então devolve o conteúdo e **quando ele pode voltar** (`next`). Fora da vez → 409 `{ error, reason, nextAt }`; fora do ar, de outro aluno ou fora do segmento → 404 sem dizer se existe. O evento `message_impressed` é gravado depois da resposta (`after()`), até 100 por pop-up, aluno e dia.

Por que é exato: a RPC só atualiza a linha se nada mexeu nela desde a leitura (clique, lembrete, dispensa, recálculo, reinício ou outra abertura mudam `updated_at` pelo gatilho que já existia): duas abas nunca contam a mesma abertura e um clique noutra aba nunca é atropelado.

### 4.2 "Quantas vezes" (`frequencyVerdict`)

Conta desde o último `Mostrar de novo` (`reshown_at`). Paradas de vez primeiro (fora do segmento ou `Não mostrar de novo`; `Uma vez` com clique ou mais vistas que lembretes; `Mais de uma vez` com clique e parada no clique; total atingido). Depois as esperas, e vale a **mais tardia**: `Lembrar depois` valendo; 5 s desde a última (todo modo); limite do dia (próxima meia-noite de São Paulo); intervalo. Com o ritmo de antes ("Até o aluno clicar" = 1 dia, até clicar) dá a mesma resposta da regra da v3a em todos os estados, menos dois, de propósito: vista há menos de 5 s, e uma linha zerada pelo `Mostrar de novo` da v3a quando ainda era "Uma vez" (agora só conta o que veio depois). O `show` também responde quando o pop-up pode voltar (`showNext`): `Uma vez` → nunca; limite do dia → meia-noite; intervalo → última + intervalo; sem ritmo → última + 5 s.

### 4.3 A memória de 1 minuto do navegador (e por que um pop-up novo pode levar até 1 minuto)

`notifications-client.ts` guarda, ao lado do número do sino, a **memória dos pop-ups** (o mapa, o plano e o acerto do relógio pela hora do servidor), com o mesmo dono do sino e 60 s de validade. O topo pede o resumo com `?page=` (quando o número ou a memória passou de 1 minuto) e o pop-up entra nesse pedido; nas páginas seguintes, o navegador decide sozinho se a página pode ter pop-up (`coversPage`) e só pede de novo quando a página é coberta e o plano passou do minuto. A resposta do `show` e o que o aluno faz atualizam o plano guardado (`show` 200 → `next`; 409 → `nextAt`; 404/429/rede → sai; clique → sai, menos em `Só quando o pop-up terminar`; `Não mostrar de novo` e `Lembrar depois` → saem; fechar → nada). Consequência que a equipe lê nos toasts: numa aba que o aluno usou no último minuto, um pop-up novo ou editado pode levar até 1 minuto para aparecer. Na home, o pedido sai 1,5 s depois de abrir (o número do sino vem junto), a não ser que a memória já saiba: aí arma na hora, sem pedido.

### 4.4 O host do pop-up (`member-popup-host.tsx`)

Fica em toda página do aluno que tem chave (AppShell; nunca no "ver como"); cada montagem é uma visualização de página. Com o plano, arma `openingsForPageView` (um temporizador por pop-up, na ordem do plano); na aula, ouve a conclusão (`completed`) e arma `completionOpenings` (a chave da abertura é `pop-up:aula`, então duas aulas concluídas na mesma visualização dão duas chances). O que vence entra numa fila que abre **um de cada vez**: confere o que bloqueia (`blockReason`: outro pop-up, aba escondida, tela cheia, o player tocado ou tocando, troca de aula, camada por cima ou alguém digitando), espera ou descarta (camada por cima = diálogo ou gaveta **na tela** ou um controle aberto no topo do AppShell, `data-member-topbar`; um painel escondido que ficou montado, como o Tutor IA da aula, não conta: `hasBlockingLayer` em `popup-host-model.ts`); desiste 10 minutos depois da hora dele; carrega a janela; só então chama o `show`; com 200, abre (ou espera o bloqueio passar: já contou); o próximo da fila 1 s depois de fechar. Registra o resultado com o jeito de fechar (`x`, `esc`, `outside`, e `page` ao sair ou recarregar com ele aberto; nada num `pagehide` guardado em cache). Nada roda em intervalo além da conferência de 1 s enquanto algo bloqueia; nenhum pedido em laço.

### 4.5 Os sinais da página da aula (`src/lib/lesson-media-signal.ts`)

O host lê o player **na hora de decidir**, nunca um estado espelhado no React: o palco (`[data-lesson-player-stage]`) diz a aula na tela (`data-lesson-id`) e o tipo de player (`data-lesson-player-kind`: `native`, `youtube`, `iframe`); o `<video>` do palco diz se toca (não pausado e não no fim) e se está na tela cheia do iPhone (`webkitDisplayingFullscreen`); o YouTube com os nossos controles avisa `playing` por um evento da `window` (`bunker707:lesson-media`); `touched` vem do play no nosso player, do foco dentro do iframe do palco ou, no toque, de um player de fora. `lesson-experience.tsx` ganhou cinco inserções pequenas (o aviso de tocar em `handlePlayerStart`, os dois atributos do palco, o efeito do YouTube e o aviso de aula concluída nos dois caminhos, lendo se a conclusão ainda é a mais nova **antes** de `settleOptimisticCompletion`, para uma conclusão desfeita nunca ser anunciada). Um script na página poderia disparar o evento ou mudar os atributos; o pior que consegue é abrir um pop-up que o aluno já poderia ver (o servidor confere o resto).

### 4.6 Mostrar de novo em qualquer modo e os caminhos da v1

- `reshowPopup` e `saveNoticeDraft({ reshow })` não recusam mais fora de "Uma vez"; a RPC 5.2 zera quem ainda está no segmento, viu mais vezes do que adiou e não escolheu `Não mostrar de novo` (quem clicou só em `Só quando o pop-up terminar`). Depois do reinício, o total, o dia e o intervalo contam só o que veio depois.
- Salvar um pop-up passa por `withPopupSettings` (`actions.ts`): a configuração do rascunho manda; um rascunho sem `popup` (ou `{ ...rascunho, repeat: "until_action" }`, como os testes da v1) vira o ritmo de antes; um pop-up antigo "Até o aluno clicar" sem botão vira `Só quando o pop-up terminar`.
- **Caminhos da v1 mantidos** para abas abertas antes do deploy (e para os 11 testes da v1, sem mudança): `GET /api/notifications/summary?popup=1` (agora respeitando páginas, momento e frequência para o Início) e o evento `impressed` (gravado pela mesma RPC). Nenhum código novo chama; saem numa limpeza futura. `pickPopup`, `reshowSkipped`, `LivePopup`, `POPUP_RULES.delayMs` e `POPUP_RULES.minHoursBetween` saíram de `campaign-model.ts`.

---

## 5. Rotas e ações

### 5.1 Rotas do aluno

Todas com `no-store`, corpo por `readBoundedJson` (aceita o `text/plain` do `sendBeacon`), sessão pelas claims do JWT (`requireApiSessionUser`) e eventos por `recordCommunicationEvents` (uma falha é só uma linha de log). Id inválido → 400 `Pop-up invalido.`. **Limite**: `show` e todo evento do pop-up tiram de uma cota de **30 por minuto por aluno** (`takeStudentWrite("popup:<id>")`, separada da do sino) **antes de ler o corpo**; passou → 429 `Muitas tentativas. Espere um pouco.` com `Retry-After: 60`.

| Rota | Corpo | Respostas | Evento |
|---|---|---|---|
| `GET /api/notifications/summary?page=<chave>` (chave inválida é ignorada) | — | 200 `{ data: { popup: null, popups: { asOf, pages, plan } \| null, unseen } }` | — |
| `GET /api/notifications/summary?popup=1` (v1) | — | 200 `{ data: { popup, unseen } }` | — |
| `POST /api/popups/[id]/show` (novo) | `{ page, trigger: "page_load" \| "lesson_completed" }`, até 1.000 B | 200 `{ data: { next: { notBefore } \| null, popup } }`; 400 `Pedido invalido.`; 404 `Pop-up nao encontrado.`; 409 `{ error: "Pop-up fora da vez.", reason: "page" \| "trigger" \| "frequency" \| "changed", nextAt }`; 413; 429 | `message_impressed` `{ campaign_id, page, trigger }` (depois da resposta, até 100 por pop-up, aluno e dia) |
| `POST /api/popups/[id]/events` | `{ event, via? }` (`via` só com `closed`: `x` \| `outside` \| `esc` \| `page`), até 8.000 B | 200; 400 `Evento invalido.` (também `via` desconhecido); 404; 409 `Não dá para lembrar depois de novo.` e, no `impressed` da v1, `Pop-up fora da vez.`; 429 | `message_closed` `{ campaign_id, via }`, `message_clicked`, `message_dismissed`, `message_snoozed`, `message_impressed` da v1 `{ campaign_id, page: "home", trigger: "page_load" }` |

O `PopupItem` só ganha `close: "x_only"` em `Só no X`: o objeto do pop-up padrão continua byte a byte o da v1.

### 5.2 Server Actions (`actions.ts`)

| Ação | O que muda |
|---|---|
| `saveNoticeDraft` | `withPopupSettings` antes de gravar; sem a recusa `RESHOW_ONLY_ONCE`; auditoria com as três chaves (2.7); edição no ar com as regras de permissão e dos 500 de antes |
| `publishNotice`, `approveNotice` | teto de 50 (422), também ao pedir aprovação |
| `resumeNotice` | teto de 50 (422, frase do retomar) |
| `reshowPopup` | qualquer modo (409 `Este pop-up não está no ar.` se saiu do ar no meio) |
| `duplicateNotice` | copia todas as configurações (regras de janela de antes) |

`queries.ts`: `NoticeListItem.placementLabel` e `.popupMode`; `NoticeDetail.popupNames` (os nomes dos produtos citados, uma leitura, só quando há); `NoticeEditorOptions.opensOnLesson` (produtos em `lesson_playlist`, uma leitura em paralelo; falha = lista vazia).

### 5.3 Eventos (`student_events`, só ids e códigos)

`message_impressed` ganha `page` e `trigger`; `message_closed` ganha `via`; os outros não mudam. Guardam o que o relatório da v3b-2 precisa (aberturas por tipo de página, último jeito de fechar).

---

## 6. Desempenho

Por visualização de página do aluno:

| Situação | Pedidos | Idas ao banco (em sequência) | A mais na resposta |
|---|---|---|---|
| Página sem pop-up, memória com menos de 1 minuto | **0** | **0** | — |
| Número do sino vencido, página sem pop-up | 1 (o resumo de sempre) | 1 (a contagem do sino; a lista no ar vem do cache) | ≈ 60–150 B |
| Página coberta, plano vencido | 1 (o resumo com a página) | 1 (a contagem ∥ a leitura das linhas) | ≈ 150–250 B por item |
| Um pop-up abre | +1 (`show`) | 2 (linha, RPC); o evento grava depois | o cartão, ≈ 0,6–1,5 KB |
| Cada resultado | +1 beacon | 2 + 1 evento (como antes) | < 100 B |

**Medido** (22/10/2026, `next start` local com o Supabase local, a aluna de teste logada, pedidos em sequência, 30 amostras, 20 no `show`; antes = app da v3a, `d6547d7`; método em `scratchpad/v3/z/measure-popups.mjs`):

| Pedido | Antes p50 / p95 (ms) | Depois p50 / p95 (ms) |
|---|---|---|
| `GET /api/notifications/summary` (só o número) | 13,1 / 30,9 | 11,6 / 21,1 |
| `GET …/summary?page=saved` (página não coberta) | — (a v3a pedia o resumo simples) | 10,7 / 12,3 |
| `GET …/summary?page=home` e `?page=materials` (cobertas, leem o plano) | 11,8 / 14,0 (`?popup=1` da v3a, a home) | 11,4 / 14,0 e 11,5 / 14,6 |
| `GET …/summary?popup=1` (v1) | 11,8 / 14,0 | 11,2 / 14,1 |
| Abrir: `POST /api/popups/[id]/show` (depois) / evento `impressed` (antes) | 22,7 / 33,4 | 18,4 / 22,2 (meta p95 ≤ 150 ms) |

**JavaScript ao abrir** (soma em gzip dos scripts de `/_next/static` que a página baixa, mesmo build de produção antes e depois): +4,36 KB no Início e em Favoritos, +4,49 KB na aula (orçamento ≤ 5 KB); a janela do pop-up continua num pedaço à parte, baixado só quando algo é armado. Na Vercel (teste) todo resumo lê a lista no ar do Data Cache remoto (≈ 5–20 ms) e o `show` é uma função nova (a primeira chamada fria pode levar alguns segundos: por isso 10 s de limite no navegador e o evento depois da resposta); na Hetzner fica na memória.

---

## 7. Decisões

| # | Decisão | Por quê |
|---|---|---|
| P1 | Esta parte = frequência, páginas, dois momentos, "Como fechar", o tempo do "Lembrar depois", sem teto global, "Mostrar de novo" em todo modo e as configurações no "Detalhes"; o cartão simples continua o único visual | o produtor pediu "frequência + páginas + Como fechar" e entregas pequenas |
| P2 | "Quantas vezes" livre: `Uma vez` ou `Mais de uma vez` com por dia, intervalo, total e parada; `Não mostrar de novo` sempre vale; um `Mais de uma vez` novo começa em 1 por dia, até clicar | a lista do produtor; "para quando fecha" **é** `Uma vez` |
| P3 | Sem limite entre pop-ups; a única regra que a equipe vê: um de cada vez; pisos técnicos invisíveis: 5 s entre duas aberturas do mesmo pop-up, 30 chamadas por minuto, 100 eventos de abertura por pop-up, aluno e dia | "Não quero esse limite fixo"; os pisos só seguram um script com o cookie do aluno |
| P4 | Onde aparece: Início, qualquer página ou as escolhidas, mais Nunca nestas páginas (a exceção vence); formação conta os cursos; nunca login, Alterar senha, TV, admin, erro, "ver como"; aula específica fica para depois | "em quais páginas … não mostrar na página X ou Y" |
| P5 | Momentos: ao abrir a página e ao concluir uma aula; "num horário" é `Começa: Em uma data`; hora marcada ao vivo, primeiro acesso e curso concluído na v3b-2; nunca intenção de saída | reaproveita o que existe; o temporizador ao vivo era a parte mais cara e menos confiável |
| P6 | Na aula, nunca interrompe o nosso player; estado lido do elemento; o pop-up nunca pausa a aula | estudar vem primeiro; honesto sobre players que a página não lê |
| P7 | Como fechar: no X ou fora, ou só no X; o Esc sempre fecha; X com 44 px de toque | o pedido do produtor, com a saída de teclado do diálogo WAI-ARIA |
| P8 | Mapa + plano + abertura; conteúdo só no `show` | zero pedido e zero consulta por aluno nas páginas sem pop-up |
| P9 | Uma escrita atômica por abertura, com compare-and-set em `updated_at`; regras num módulo puro; nenhuma regra de frequência no SQL; sem trava consultiva | simples, exato, testável |
| P10 | Pop-ups de antes mantêm o comportamento sem reescrever dados (`popup_frequency` nulo = ler `popup_repeat`) | o app da v3a continua gravando `popup_repeat` até o merge |
| P11 | Mostrar de novo em qualquer modo (sai a trava da RPC); em `Só quando o pop-up terminar` também zera quem clicou | com ritmo por pop-up, o reinício importa em todo modo |
| P12 | Sem tela nova de relatório; "Detalhes" ganha as quatro linhas; os eventos guardam página e jeito de fechar | não foi pedido; tira uma função, colunas e componentes |
| P13 | No máximo 50 pop-ups publicados ao mesmo tempo (no ar ou agendados); a lista é lida com folga (60) | torna visível o `limit(50)` silencioso de antes e limita o plano |
| P14 | Caminhos da v1 mantidos (`?popup=1`, `impressed`) | deploy seguro; 11 testes da v1 sem mudança |
| P15 | Vocabulário (topo deste documento); `Pop-up na home` → `Pop-up` | `docs/17` §1.3, `docs/23` V19 |
| P16 | Migração `202610220003`, aditiva, idempotente, seis seções pelo MCP, sem seção de SQL Editor; aplicada antes do merge | uma migração por entrega; respeita os limites do MCP |
| P17 | Docs: este documento e as atualizações de `docs/22`, `23`, `24`, `17`, `12`, `05`, `06`, `09`, `04`, `18`, `21` e `AGENTS.md` | um documento por entrega |
| P18 | Prévia do celular em 375 px (era 390) | 375 px é a largura de aceite |
| P19 | "Lembrar depois" → Volta em (5 minutos a 7 dias, padrão 24 h), ainda 2 vezes | "Eu que tenho que definir isso": com 30 minutos entre aberturas, 24 h fixas faziam o lembrete esperar mais que fechar |

### 7.1 Escolhas da entrega

O que a implementação decidiu onde o desenho era omisso ou não batia com o código:

- **Configuração e frases** (`popup-display-model.ts`, `popup-sentences.ts`, `schemas.ts`): um rascunho de pop-up com `frequency` "Uma vez" e `repeat: "until_action"` sem linha salva vira o ritmo de antes (`{ ...emptyNoticeDraft("popup"), repeat: "until_action" }`, como os testes da v1); o `popup` de uma notificação é descartado antes de validar (nunca dá erro); `describeMinutes(1440)` lê `1 dia` (o padrão do Volta em aparece `1 dia`, não `24 horas`); minutos múltiplos de 60 nos dois momentos; mesma página nas duas listas e exceções que cobrem tudo dão um erro só, em `popup.exclude`; `Em {n} páginas` conta padrões; um padrão inválido numa linha salva cai sozinho (lista vazia → Início).
- **Servidor do aluno**: `after()` fora de um pedido do Next (testes) grava na hora; `recordPopupEvent` mantém a assinatura da v3a e a rota põe o `via`; o `Volta em` é lido do banco na hora do lembrete, não do cache; sem a migração, o resumo responde `popups: null` e `show`/eventos 404; um `via` válido noutro evento é ignorado.
- **Navegador**: o efeito do YouTube fica antes do retorno cedo da aula vazia (regra dos hooks) e calcula o próprio "tocando"; o pulso anima `scale` (o `scale-[1.12]` do Tailwind 4 usa essa propriedade); um player tocando conta como tocado (autoplay nunca é coberto); um resumo que falha deixa sem pop-up por aquele minuto (nunca um plano velho); a espera de 1,5 s da home vale também para o pedido com página.
- **Editor**: com um campo do pop-up inválido, a revisão diz `Corrija os campos do pop-up para ver o resumo.`; a frase ao vivo espera enquanto nenhuma página está escolhida; o `Outro` do tempo tem o nome acessível `Quantos segundos`.
- **Servidor da equipe**: pop-up antigo "Até o aluno clicar" **sem botão** abre, publica e salva como `Só quando o pop-up terminar` (escolher "clica no botão" sem botão, ou tirar o botão depois, continua 400); o teto também vale ao **pedir aprovação** (um pedido que não poderia ir ao ar não fica esperando); o quadro "Lembrar depois" do relatório diz o `Volta em` (24 h no padrão; `30 minutos` num pop-up de 30 minutos).
- **Fechamento**: o cabeçalho de Comunicação › Avisos e pop-ups ainda dizia `pop-ups na home do aluno` (fora da lista do desenho): virou `pop-ups para os alunos`. O alvo do ⋯ do relatório passa o `popupMode` (o toast do Mostrar de novo saía como "Uma vez" num `Mais de uma vez`). O teste de guarda das rotas do sino cobre também o `show` (sessão pelas claims, cota `popup:` antes de ler o corpo, `Retry-After`).

---

## 8. Fica de fora

| Fora da v3b-1 | Onde está |
|---|---|
| **Na hora marcada** ao vivo (abre em até 1 minuto para quem já está numa página) | v3b-2 (temporizador no navegador a partir do plano, com folga depois da hora do servidor) |
| **No primeiro acesso** | v3b-2. Até lá, para dar boas-vindas: `Uma vez`, `Só no Início` e o segmento "Tempo de acesso: menos de 1 dia" do produto (quem entra até 15 minutos depois da compra pode ver só na visita seguinte, porque o recálculo ainda não criou a linha) |
| **Ao concluir todas as aulas do curso** | v3b-2 |
| **Ao ganhar acesso a um produto** | possível (o motor da v2 tem `access_gained`) |
| **Ao comentar** | não planejado |
| Intenção de saída | nunca (não existe no toque) |
| Uma aula específica como página | depois |
| Relatório "Vezes que apareceu", "Onde apareceu" e "Como fecharam" | v3b-2, a partir dos eventos já gravados |
| Play, pausa e fim do Bunny e do Vimeo (`postMessage`), para "Ao concluir uma aula" e "nunca sobre o vídeo" valerem ali como no nosso player | v3b-2 |
| A linha "Também no ar no Início: …" na Revisão (pop-ups em sequência que a equipe não vê) | v3b-2 (precisa da lista no ar no editor) |
| A etiqueta "Abre direto na aula" no seletor de produto | depois (o seletor da vitrine não tem lugar para etiqueta; a frase ao vivo já avisa) |
| Aparelhos e frequência por visita | nunca |
| Modelos de configuração, construtor avançado e enquete no pop-up | modelos de configuração na v3b-2; o construtor visual entrou no **Design do pop-up** (`docs/26`); a enquete no pop-up fica na v3b-3 |

**Ajustes conhecidos, para depois**: a cota de 30 por minuto é por processo (na Vercel, por instância); com o mapa grosso, assim que algum pop-up no ar cita um produto, toda página de produto (ou de aula) pede o plano uma vez por minuto; ponta a ponta no WebKit dos dois arquivos novos (rodados no Chromium; o WebKit roda no CI); no seletor de produtos da lista de páginas, o `aria-describedby` aponta para um id de erro que não existe (a mensagem fica uma vez no grupo; inofensivo).

---

## 9. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/pop-ups-v3b1-modelo.test.mjs` (23) | chave da página, padrões e exceções, mapa grosso, formação, colunas ↔ configuração (linhas de antes iguais), `reconcilePopupFrequency`, a matriz de `frequencyVerdict` (dia de São Paulo, intervalo, total, 5 s, reinício), a equivalência com a regra da v3a (respostas escritas), `showNext`, `decideShow`, `planPopups`, `pagesCovering`, `reshowTarget` |
| Unitário | `tests/pop-ups-v3b1-frases.test.mjs` (14) | toda frase da revisão, das linhas ao vivo, das notas, do Detalhes e da legenda; o pop-up padrão com a frase de antes; vocabulário |
| Unitário | `tests/pop-ups-v3b1-editor.test.mjs` (20) | os dois cards: lista ↔ padrões, troca de momento, começo de `Mais de uma vez`, unidades, toasts, textos da seção 2.1, cada erro da seção 2.5 no campo certo, vocabulário (inclusive "home") |
| Unitário | `tests/pop-ups-v3b1-rotas.test.mjs` (17) | resumo sem leitura nas páginas sem pop-up e uma leitura na coberta, mapa sem id de produto, `show` (400/404/409/200, `updated_at` exato, 5 s), 429 com a cota separada, 100 eventos por dia, `via`, `Volta em`, formação que falha |
| Unitário | `tests/pop-ups-v3b1-navegador.test.mjs` (21), `tests/pop-ups-v3b1-memoria.test.mjs` (12) | o que o host arma e bloqueia, o sinal do player com um DOM falso, as cinco inserções da aula; a memória de 1 minuto (pedidos por página, home, dono, falha, cada linha da tabela da seção 4.3) |
| Unitário | `tests/comunicacao-avisos-modelo.test.mjs` (28) | o ⋯ com Mostrar de novo em todo modo, `popupEventPatch` com o `Volta em`, a revisão com e sem as partes do pop-up (os testes de `pickPopup` saíram com a função) |
| Guarda | `tests/comunicacao-v3b1.guard.test.mjs` (8), `tests/comunicacao-v3.guard.test.mjs` (7) | migrações antigas sem mudança; a 0003 sem `drop`/`delete`/gatilho, checks em `if not exists`, o check das linhas `not valid` + `validate`, permissões exatas, a RPC de reinício sem `popup_repeat`, os limites do banco iguais aos do app, a expressão das páginas igual; as rotas do pop-up com sessão pelas claims e a cota `popup:` antes do corpo |
| Integração | `tests/integration/pop-ups-paginas-e-frequencia.test.mjs` (11) | qualquer página menos Perfil, só aula, formação, por dia, intervalo, clique vs. terminar, total com lembrete, `Volta em`, 5 s, compare-and-set, ao concluir uma aula, `close`, `day_impressions` depois do reinício |
| Integração | `tests/integration/pop-ups-editor-v3b1.test.mjs` (13), `tests/integration/avisos-crud.test.mjs` (17) | salvar com tudo e ler de volta, ritmo de antes, notificação com os padrões, sem botão 400, teto 422 em publicar/aprovar/retomar, Mostrar de novo em `Mais de uma vez` (500, auditoria), clique em `never`, Duplicar, nomes, `opensOnLesson`, lista; o caso da v3a "Até o aluno clicar → 409" virou reinício |
| Integração | `tests/integration/pop-ups.test.mjs` (11, sem mudança) | os caminhos da v1 |
| Ponta a ponta | `tests/e2e/aluno-ve-pop-up-nas-paginas.spec.ts` (9) | qualquer página menos Perfil, de novo 1 minuto depois (relógio do navegador adiantado) com um resumo só; sem ritmo volta em 5 s sem pedir; aula antes do play; play antes dos 3 s descarta; toque com player de fora não abre (e abre no nosso); ao concluir abre e trocar de aula descarta; `Só no X` a 375 px (fora não fecha, X com 44 px, sem rolagem lateral, Esc fecha, `via: "esc"`); dois no Início, um de cada vez; página sem pop-up sem pedido |
| Ponta a ponta | `tests/e2e/produtor-configura-pop-up.spec.ts` (2) | os dois cards com a validação, as frases, o aviso de conflito, a revisão, a legenda, o toast de 1 minuto, o Detalhes; no ar, a segunda linha da lista, Mostrar de novo em `Mais de uma vez` e a linha de quem já viu |
| Ponta a ponta | `aluno-ve-pop-up`, `produtor-edita-e-exclui-aviso`, `aluno-ve-notificacao-vencer` (atualizados) | o resumo `?page=home` com o plano, a pílula `Pop-up`, o toast novo, Mostrar de novo em `Mais de uma vez`, 375 px |

Ajudas novas em `tests/e2e/fixtures.ts`: `publicarPopUp(browser, { titulo, paginas, excecoes, quando, depoisDe, frequencia, fechar, lembrarEm, inicio, botao })` grava o rascunho no banco e publica pela tela do produtor (renova a lista no ar); `eventosDoPopUp(id, conta)`; `trocarVideoDaAula` e `esperarPlayerDaAula` (o catálogo da área fica 60 s em cache); `popUpsQueAbremNaHome(page)`; `estadoDoPopUpDaAluna` traz `dayImpressions`, `lastSeenAt` e `clickedAt`; `reabrirPopUpParaAluna` zera também o dia e o reinício.

---

## 10. Roteiro de conferência no ambiente de teste

1. **Antes do merge**, aplicar a `202610220003` no Supabase da nuvem: as seções 1 a 6 pelo MCP, na ordem e uma por chamada (ou `apply_migration` com o arquivo inteiro, nome `communication_v3b1`; não há nada para o SQL Editor), e conferir com as consultas do cabeçalho (7 constraints `campaign%v3b`, todas validadas; 2 funções; `popup_repeat` fora da função de reinício). `list_migrations` mostra `202610220003` (se foi por `execute_sql`: `insert into supabase_migrations.schema_migrations (version, name) values ('202610220003', 'communication_v3b1') on conflict do nothing;`, `docs/21` §9.2). Sem a migração, o app novo para também as notificações agendadas e os fluxos.
2. Um pop-up que já existia (Uma vez ou Até o aluno clicar) continua aparecendo só no Início, do mesmo jeito; no editor ele abre com **Só no Início**, **Ao abrir a página · 3 s** e, no segundo caso, **Mais de uma vez · Tempo entre uma vez e outra: 1 dia · Quando o aluno clica no botão**.
3. Novo pop-up **Em qualquer página**, **Nunca mostrar em algumas páginas → Perfil**, **Mais de uma vez** (começa em **Limitar por dia: 1**): desligar **Limitar por dia**, ligar **Tempo entre uma vez e outra: 1 minuto**, **Quando o aluno clica no botão**. Com a aluna de teste (se a aba dela já estava aberta, recarregue ou espere 1 minuto): aparece em Favoritos; fechar no X; abrir Perfil (não aparece); 1 minuto depois, abrir outra página: aparece de novo; clicar no botão: não volta mais.
4. Mesmo pop-up com **Limitar por dia: 2** e **Só quando o pop-up terminar**: aparece 2 vezes no dia e não aparece a terceira; no dia seguinte volta. Com **1 dia** entre uma vez e outra e **10** por dia, o editor avisa que cabe só 1 por dia.
5. **Ao abrir a página** só em **Páginas de aula**: abrir a aula e esperar 3 s sem dar play: aparece. Recarregar e dar play antes dos 3 s: não aparece. No celular, numa aula com vídeo do Bunny: não aparece (como avisado no editor).
6. **Ao concluir uma aula** de um curso: tocar em **Concluir**: o pop-up abre logo depois. Com um vídeo de arquivo ou do YouTube tocando, tocar em Concluir: ele espera o vídeo pausar. Tocar em Concluir e logo abrir outra aula e dar play: não aparece (espera a próxima aula concluída).
7. **Começa: Em uma data** para daqui a 5 minutos: antes da hora não aparece; depois da hora, ao abrir uma página, aparece.
8. **Só no X**: clicar fora não fecha (o X pisca); o Esc fecha; o X fecha. A prévia diz `Fecha só no X (e no Esc).`
9. **Permitir “Lembrar depois” · Volta em 10 minutos**: tocar em **Lembrar depois**; 10 minutos depois, na próxima página, ele volta.
10. Dois pop-ups para o Início ao mesmo tempo: o segundo só aparece depois que o primeiro fecha.
11. Pop-up no ar em **Mais de uma vez**: ⋯ → **Mostrar de novo para quem já viu** agora aparece; a aluna que tinha fechado volta a ver; o aviso diz `A contagem de “Quantas vezes” recomeçou para …`.
12. Relatório do pop-up, em **Detalhes**: **Onde**, **Quando aparece**, **Quantas vezes** e **Como fecha** com o que foi escolhido.
13. No celular (375 px): os cards **Quando e onde aparece** e **Quantas vezes e como fecha** cabem sem rolar para o lado; o pop-up também, e o X é fácil de tocar.

### 10.1 Resposta ao produtor (para colar)

> Vamos entregar os pop-ups sob medida em três partes, para chegar mais rápido. **Esta primeira** dá a você o controle de frequência, páginas e fechamento:
>
> - **Onde aparece**: só no Início, em qualquer página ou nas páginas que você marcar (página do produto, páginas de aula, Minhas compras, Favoritos, Materiais, Minha jornada, Continue assistindo, Perfil, Suporte), e **Nunca nestas páginas** para as exceções. Escolher uma aula específica (e não todas as aulas de um curso) fica para depois.
> - **Quando aparece**: ao abrir a página (logo ou depois de quantos segundos você quiser) ou ao concluir uma aula (de qualquer produto ou dos que você escolher). Para um horário específico, use **Começa: Em uma data**: a partir dessa hora, quem abrir uma das páginas vê o pop-up. Para "agora", publique com **Começa: Ao publicar**: cada aluno vê na próxima página que abrir (quem está parado numa página não vê o pop-up surgir sozinho; isso chega na próxima parte, com a **hora marcada**).
> - **Quantas vezes**: **uma vez** (para quando o aluno fecha, clica no botão ou escolhe “Não mostrar de novo”), ou **mais de uma vez** com os números que você definir: até X vezes por dia, com pelo menos X minutos, horas ou dias entre uma e outra (passado esse tempo, ele volta na próxima página que o aluno abrir; não interrompe uma página que o aluno já está vendo), no máximo X vezes no total, e se para quando o aluno **clica no botão** ou **só quando o pop-up terminar**. “Não mostrar de novo” sempre vale. Você também escolhe em quanto tempo o **Lembrar depois** traz o pop-up de volta.
> - **Como fechar**: no X ou clicando fora, ou só no X (o Esc continua fechando, para quem usa teclado ou leitor de tela).
>
> Nenhum limite fixo decide quantos pop-ups o aluno vê: cada um segue a frequência que você escolher. As regras fixas existem só para não atrapalhar o estudo: um pop-up de cada vez na tela e, na aula, nunca com o vídeo do nosso player tocando. Os números têm um teto só para evitar erro de digitação (até 100 vezes por dia, até 1.000 no total, até 90 dias entre uma vez e outra, “Lembrar depois” até 2 vezes), um mesmo pop-up nunca aparece duas vezes em menos de 5 segundos, e cabem até 50 pop-ups no ar ao mesmo tempo (isso não limita o que o aluno vê).
>
> Na aula: o pop-up "ao abrir a página" só abre antes do play. "Ao concluir uma aula" vale no fim do vídeo (vídeo de arquivo e YouTube) ou quando o aluno toca em **Concluir**; se o vídeo ainda estiver tocando, ele espera parar. Quando as aulas estiverem no **Bunny** (e nos vídeos do Vimeo e do Mux), por enquanto ele vale quando o aluno toca em Concluir e, no celular, não abre "ao abrir a página" nessas aulas; ler o vídeo do Bunny direito vem na próxima parte.
>
> Os pop-ups que já existem continuam iguais. **Mostrar de novo para quem já viu** passa a funcionar em qualquer "Quantas vezes". Depois de publicar ou editar, para quem já está com a área aberta, o pop-up pode levar até 1 minuto para aparecer.
>
> Até chegar o "no primeiro acesso", para dar boas-vindas a quem chega: um pop-up **Uma vez**, **Só no Início**, para o segmento “Tempo de acesso: menos de 1 dia” do produto.
>
> Depois vêm os **modelos de configuração** (para pop-ups e notificações), junto com a **hora marcada** ao vivo, **No primeiro acesso**, **Ao concluir todas as aulas do curso** e o relatório de onde o pop-up apareceu e como fecharam; e por fim o **construtor avançado** com enquete no pop-up. Quais outras ações você quer como momento do pop-up?

### 10.2 Próximos passos (depois da v3b-1)

1. **Design Livre** (entregue, `docs/27`): a terceira opção do card Design, com o editor de tela cheia no estilo do Elementor; o cartão Livre segue as mesmas regras de onde, quando, quantas vezes e como fecha deste documento.
1. **Design do pop-up** (entregue, `docs/26`): o card Design com Padrão | Personalizado (vídeo ou imagem com degradê, selo, título de duas cores, texto, botões com estilo livre, fontes enviadas, prévia de celular e computador). As regras desta página (onde, quando, quantas vezes, como fecha) valem igual para os dois visuais; "Quando o aluno clica no botão" também conta o Segundo botão com link.
2. **v3b-2**: modelos de configuração (pop-ups e notificações), hora marcada ao vivo, No primeiro acesso, Ao concluir todas as aulas do curso, o relatório de onde apareceu e como fecharam, o player do Bunny/Vimeo lido por `postMessage`.
3. **v3b-3**: enquete dentro do pop-up (o design já tem lugar para blocos novos) e, se o produtor pedir, modelos salvos de design e arrastar livre.
