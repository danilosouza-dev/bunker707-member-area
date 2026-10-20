# 22. Comunicação v1: notificações no sino e pop-ups

Data: 20/10/2026. Pedido do produtor: o aluno recebe notificações no sino da área de membros (com imagem, áudio que toca ali mesmo e um botão para dentro ou para fora da plataforma, e convites que ele aceita ou recusa); a equipe cria as notificações, envia na hora ou agenda; e cria pop-ups para grupos de alunos escolhidos por regras combinadas (porcentagem de aulas concluídas, quem mais comentou, quem não comentou, quem comprou há menos ou há mais de X dias, produto, e assim por diante).

Este documento registra o que foi construído, as regras fixas, as decisões e o que fica para depois. Ele detalha a fase 5 do `docs/17` (§1.8 Comunicação, §2.4 tabelas, §2.5 eventos, D4 e D12) e vale para qualquer trabalho em Comunicação, sino ou pop-ups. Tabelas em `docs/05` (seção Comunicação), segurança em `docs/06` (seção Comunicação), arquitetura em `docs/04` (Implementado: Comunicação v1), desenho em `docs/12` (Sino de notificações e pop-up) e decisões em `docs/09` (Notificações e pop-ups).

---

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Sino do aluno** | número vermelho com as notificações novas (até `9+`), painel com abas Todas e Não lidas (com a contagem das não lidas), lista por dia (Hoje, Ontem, Últimos 7 dias, Mais antigas), "Marcar todas como lidas", 90 dias de histórico, 20 por vez com "Carregar mais" | topo de todas as páginas do aluno, entre a busca e a conta |
| **Notificação de aviso** | título, texto (com "Ver mais"), imagem 16:9, áudio com forma de onda (toca no próprio sino, velocidade 1x, 1,5x e 2x), botão para uma página da área (mesma aba) ou link externo (nova aba), e pedido de resposta com **Aceitar** e **Recusar** | sino |
| **Notificações automáticas** | "Fulano respondeu seu comentário" e "Fulano mencionou você", com o trecho e o link da aula | sino |
| **Pop-up** | imagem, título, texto, áudio, botão, **Lembrar depois** e **Não mostrar de novo**; só na home, 3 s depois de abrir, no máximo 1 por sessão e 1 a cada 24 h, nunca numa aula | home do aluno |
| **Avisos e pop-ups (admin)** | lista com os quatro números do topo, criar e editar com prévia ao vivo (os mesmos componentes que o aluno vê), segmento por regras E/OU com contagem na hora e 5 nomes de amostra (para quem vê a lista de Alunos), enviar agora, agendar, enviar teste para mim, aprovação acima de 500 alunos, pausar, retomar, encerrar, cancelar agendamento, retirar do sino, duplicar, excluir e relatório de cada aviso | `/admin/comunicacao/avisos` |
| **Envio agendado** | o job `comunicacao` do tick de minuto envia as notificações agendadas que venceram e recalcula, a cada 15 minutos, quem vê cada pop-up no ar | `src/server/jobs/communications-job.ts` |

Vocabulário do admin (docs/17 §1.3): **Aviso** é o nome geral; **Notificação** é o aviso do sino; **Pop-up** é o aviso da home; **Segmento** é para quem vai ("Para quem"); **Situação** é o estado. Nunca "campanha", "público", "audiência", "evento" ou "oferta" na tela.

---

## 1. O que o aluno vê

### 1.1 O sino

- O botão do sino mostra um número vermelho com as notificações **novas** (que o aluno ainda não viu no painel). Acima de 9 aparece `9+`. O nome acessível diz quantas são (`Notificações, 3 novas`); o número desenhado fica fora do leitor de tela. Sem novidade, o sino fica sem número (nunca um número inventado).
- Ao abrir o painel, o número zera (as notificações ficam **vistas**), mas cada item continua com a bolinha vermelha (`Não lida` para o leitor de tela) até ficar **lido**: abrir o link ou o botão, responder, tocar o áudio pela primeira vez, abrir o "Ver mais", clicar no cartão fora dos botões ou tocar em **Marcar todas como lidas** (o botão some quando não há nada para ler). É o mesmo padrão das redes sociais: o número diz "tem coisa nova"; a bolinha diz "você ainda não abriu". Abrir o sino e "Marcar todas" só mexem no que aparece no sino: um aviso que ainda está sendo enviado (ou uma resposta escondida pela moderação) continua novo para quando aparecer.
- Abas **Todas** e **Não lidas**; a de não lidas mostra a contagem quando passa de zero. Lista agrupada por dia no fuso de São Paulo, 20 por vez, com **Carregar mais** e, no fim, `As notificações ficam aqui por 90 dias.`
- Notificação de aviso: a escola como remetente (a logo, quando ela é quase quadrada; a logo larga, como a marca escrita, não cabe num círculo de 40 px e dá lugar ao megafone), o título, o texto (recolhido em 4 linhas com **Ver mais** quando passa de 180 caracteres), `Bunker707 · há 2 horas`, a imagem, o áudio, o botão e, quando o aviso pede resposta, **Recusar** e **Aceitar** (os textos dos dois botões são do aviso). Depois de responder aparece `Você aceitou` ou `Você recusou`; a resposta vale uma vez só.
- Notificação de comentário: a foto de quem respondeu com um selo do tipo no canto (balão para resposta, `@` para menção), o nome em negrito, `respondeu seu comentário` ou `mencionou você`, `em {aula}`, o trecho entre aspas e há quanto tempo. O cartão inteiro é o link para a aula.
- O áudio toca dentro do sino: play e pausa, forma de onda que avança e aceita clique e arraste para pular (no celular, um toque parado ou um arraste para o lado; rolar a lista com o dedo em cima da onda não mexe na posição), teclado (setas avançam e voltam 5 s; Home e End vão ao começo e ao fim), tempo (`0:58` antes de tocar, `0:12 / 0:58` depois) e velocidade. Só um áudio toca por vez. Se o arquivo não carrega: `Não foi possível tocar o áudio.` com **Tentar de novo**.
- O botão leva para uma página da área (mesma aba, com o mesmo indicador de navegação do resto da área e o modo "ver como" do produtor) ou para um site de fora (nova aba, com `rel="noopener noreferrer"`). O link é conferido de novo no servidor e na hora de desenhar, como no destaque da home (docs/06): o que não for caminho da área ou `https://` não vira botão.
- Estados honestos: carregando (3 linhas de esqueleto), vazio (`Nenhuma notificação por enquanto`), em dia na aba Não lidas (`Você está em dia`), erro (`Não foi possível carregar as notificações.` com **Tentar de novo**) e sessão vencida (`Sua sessão terminou. Entre de novo para continuar.` com **Entrar de novo**, que leva ao login e volta para a mesma página; tentar de novo não adiantaria).
- Teclado e leitor de tela: o foco vai para o painel ao abrir; `Esc` fecha só o painel (a IA Diretor aberta continua aberta; o painel abre por cima dela) e devolve o foco ao sino. Enquanto a resposta é enviada, os botões ficam indisponíveis sem perder o foco; respondido, o foco vai para `Você aceitou` ou `Você recusou`, que o leitor lê. **Marcar todas como lidas** some ao terminar: o foco vai para o título `Notificações` e o leitor ouve `Todas as notificações foram marcadas como lidas.`. O último **Carregar mais** vira o rodapé: o foco vai para `As notificações ficam aqui por 90 dias.`.
- Desempenho (docs/17 §2.8): o número do sino é buscado pelo navegador depois que a página aparece, nunca no carregamento da página (na home, ele vem junto com o pedido do pop-up, 1,5 s depois: um pedido só); fica guardado por 60 s entre uma página e outra e é buscado de novo quando o aluno volta para a aba e esse tempo passou. Uma falha também espera esses 60 s (numa queda, não sai um pedido por página). Nada roda em intervalo. A lista só é buscada quando o aluno abre o sino, e o código do painel (lista, cartões e player) só é baixado quando o aluno chega perto do sino (mouse em cima ou foco), como a IA Diretor.

### 1.2 Notificações automáticas

- **Resposta**: quando alguém (aluno, professor ou equipe pelo admin em Comunidade) responde ao comentário de um aluno, o dono do comentário recebe `Nome respondeu seu comentário`, com o trecho da resposta (até 280 caracteres), o nome da aula e o link da aula.
- **Menção**: a tela da aula escreve `@usuario` no começo da resposta quando o aluno responde a uma resposta. Se esse usuário é autor de um comentário da mesma conversa, ele recebe `Nome mencionou você`. Como o `@usuario` não é único na escola, a menção só vale quando **um** autor da conversa tem aquele nome; o dono do comentário principal já recebe a resposta e não recebe a menção também.
- Ninguém recebe notificação da própria resposta, e a mesma resposta nunca gera duas notificações para a mesma pessoa.
- A notificação só aparece enquanto a resposta e o comentário respondido estão visíveis na aula: escondida pela moderação ou excluída, ela some do sino e do número; resposta que espera moderação aparece quando é aprovada.
- A notificação é gravada depois da resposta, fora do caminho dela (`after()` do Next): se a gravação falhar, a resposta continua publicada e o erro fica no log.

### 1.3 O pop-up

- Aparece **só na home**, 3 s depois que ela abre, e espera (conferindo de novo a cada segundo) enquanto outra janela estiver aberta por cima (detalhes de um curso, o sino, o menu, o menu da conta ou a busca do topo), o aluno estiver digitando num campo, a página estiver travada por uma delas ou a aba estiver escondida. Nunca durante uma aula (docs/17 §1.8.1) e nunca no modo "ver como" do produtor.
- **No máximo 1 por sessão** (guardado no navegador, em `sessionStorage`; sem ele, vale até recarregar a página) **e 1 a cada 24 h** (guardado no servidor, contando da última vez que o aluno viu qualquer pop-up). Esses limites são fixos e aparecem no editor como texto, não como campo (docs/17 §1.8.1 e D12). Quando o servidor responde que não há pop-up, a volta para a home no mesmo minuto não pergunta de novo.
- Botões: o botão do aviso (página da área ou site de fora), **Lembrar depois** (volta em 24 h, também no pop-up "Uma vez"; no máximo 2 vezes; só aparece quando o aviso permite) e **Não mostrar de novo**. Fechar no X (`Fechar`), no `Esc` ou fora da janela também conta como visto.
- "Quantas vezes": **Uma vez** (some depois que o aluno vê; cada Lembrar depois vale mais uma vez, quando o lembrete vence) ou **Até o aluno clicar** (volta no máximo 1 vez por dia até ele clicar no botão ou escolher Não mostrar de novo).
- Dois pop-ups no ar para o mesmo aluno: aparece o de início mais recente (sem data de início, o publicado por último).
- Enquanto o pop-up está aberto, o vídeo do destaque pausa e volta depois (o arquivo de vídeo e o do YouTube; o do YouTube escuta o aviso `bunker707:overlay` da página e só volta a tocar se foi o pop-up quem pausou).
- A janela do pop-up (com o cartão e o player) só é baixada quando o servidor manda um pop-up; sem ela (rede caiu), nada aparece e nada conta como visto.
- A equipe nunca vê pop-up: ela não entra em nenhum segmento. Para conferir, a prévia do editor.

---

## 2. O que a equipe faz (`/admin/comunicacao/avisos`)

`/admin/comunicacao` abre a lista de Avisos e pop-ups. Webinários e Promoções continuam como telas em construção (fases 5 e 6 do docs/17).

### 2.1 Lista

- Os quatro números do topo seguem o período da barra superior: **Avisos ativos** (pop-ups no ar agora + notificações agendadas ou enviando), **Vistos** no período (notificações vistas no sino + pop-ups vistos pela primeira vez), **Taxa de clique** (cliques ÷ vistos) e **Voltaram a estudar** (alunos que viram um aviso no período e estudaram nos 7 dias seguintes: pelo menos 10 min assistidos ou 1 aula concluída somando os dias, docs/17 §1.11). Testes da equipe e avisos excluídos ficam de fora. Sem dado, o cartão mostra "—".
- Filtro Todos, Notificações e Pop-ups (`?tipo=`), 20 por página. `?pagina=` depois da última (endereço antigo, digitado ou avisos excluídos em outra tela) volta para a última página com avisos, ou para a primeira, mantendo o filtro e o período. Colunas: aviso (imagem ou ícone, título e tipo), para quem (a frase do segmento e o número de alunos), quando, situação, vistos e cliques; aviso que nunca saiu (rascunho, aguardando aprovação, agendado) mostra "—" em vistos e cliques. O menu de cada linha traz só as ações possíveis naquela situação e para aquela pessoa (`availableNoticeActions`); retirar, encerrar e excluir pedem confirmação. No celular dá para pausar um pop-up pela lista (docs/17 §1.13).
- Situações: Rascunho, Aguardando aprovação, Agendado, Enviando, Enviado, Cancelado (notificação); Rascunho, Aguardando aprovação, Agendado (publicado, mas a janela ainda não começou), Ativo, Pausado, Encerrado (pop-up; também quando a janela termina).
- Banco sem a migração `202610200001`: a tela mostra o aviso de atualização do banco em vez de quebrar.

### 2.2 Criar e editar (`/avisos/novo`, `/avisos/[id]`)

Uma página com o formulário à esquerda e a prévia ao vivo à direita (computador e celular), usando os mesmos componentes que o aluno vê: a notificação dentro de uma moldura do painel do sino; o pop-up sobre o fundo escurecido. Quatro blocos:

1. **O que**: tipo (Notificação no sino ou Pop-up na home; não muda depois de publicado), título (até 80 caracteres na notificação e 60 no pop-up), texto (até 600 e 240), imagem 16:9 opcional com descrição (recorte em WebP de 1280 × 720 no navegador, a partir de 960 px de largura, até 420 KB), áudio opcional (**Enviar arquivo** ou **Gravar agora** no próprio navegador, até 5 minutos e 10 MB, MP3, M4A, OGG, WEBM ou WAV), botão opcional (Um produto, Página da área ou Link externo; abrir na mesma aba ou em nova aba) e, na notificação, **Pedir uma resposta (Aceitar ou Recusar)** com os textos dos dois botões (até 24 caracteres).
2. **Para quem**: Todos os alunos ou Escolher por regras (seção 3), com a contagem na hora (`≈ 318 alunos agora`), 5 nomes de amostra (só para quem vê a lista de Alunos, seção 2.3) e a frase do segmento. **Usar um segmento salvo** traz os segmentos prontos e salvos em Alunos como regras; o que não vira regra (busca por nome, semana do ciclo de vida) aparece como aviso. A equipe nunca entra na contagem nem recebe avisos.
3. **Quando**: na notificação, Enviar agora ou Agendar (data e hora de São Paulo); no pop-up, começa (ao publicar ou numa data), termina (sem data ou numa data), quantas vezes e se permite Lembrar depois.
4. **Revisão**: uma frase com o resumo (`Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez.`), **Salvar rascunho**, **Enviar teste para mim** (notificação) e o botão principal (**Enviar agora**, **Agendar envio**, **Publicar pop-up** ou **Enviar para aprovação**), que salva e publica a versão salva. O servidor decide de novo: data no passado (`Escolha uma data no futuro.`) ou segmento sem ninguém (`Nenhum aluno está neste segmento agora.`) não publicam.

**Enviar teste para mim** manda a notificação, como está gravada, só para o sino de quem clicou, marcada como teste: não conta nos números e não muda o aviso. Repetir traz o teste de volta como nova. Pop-up não tem teste: a prévia mostra o que o aluno vê.

**Salvar rascunho** (ou Ctrl+Enter, ⌘+Enter no Mac) sem nenhuma mudança não grava nada: mostra `Nenhuma mudança para salvar.` e o agendamento ou o pedido de aprovação continuam como estavam. Com mudança, o toast conta o que a gravação desfez: `Rascunho salvo. O envio agendado foi cancelado: agende de novo.` ou `Rascunho salvo. O pedido de aprovação foi cancelado.` (o mesmo vale para **Enviar teste para mim** quando ele salvou uma mudança antes). Se publicar ou o teste falham depois de o rascunho ter sido gravado, o banner diz isso (`O rascunho foi salvo, mas o aviso não saiu` / `…mas o teste não saiu`) e a tela fica onde está, com **Abrir rascunho** quando o aviso ainda estava em "Novo aviso".

Áudio: **Gravar agora** para sozinho meio segundo antes dos 5 minutos; passar um pouco do limite pelo atraso da parada não descarta a gravação (a duração fica em 5:00). Se o envio da gravação falha (sem conexão: `Não foi possível enviar o áudio. Tente de novo em instantes.`), ela continua na tela para **Usar gravação** de novo. Entrar no admin a partir do login, da troca de senha ou da área do aluno (**Ir para o admin**, **Configurar link de ajuda**) recarrega a página inteira, porque o microfone só é liberado num documento carregado em `/admin` (seção 4.5). Se mesmo assim a página estiver com o microfone bloqueado, **Gravar agora** mostra `Para gravar, recarregue a página. Salve o rascunho antes.` com **Recarregar a página**; a frase das configurações do navegador fica só para quando a pessoa negou o microfone.

Edição: rascunho, aguardando aprovação e notificação agendada voltam para rascunho ao salvar uma mudança; pop-up no ar ou pausado pode ser editado sem sair do ar por quem pode publicar para aquele segmento (seção 2.3; quem já viu, clicou ou escolheu Não mostrar de novo segue assim; se o segmento mudou, a lista de quem vê é refeita na hora). Notificação enviada não muda: dá para **Retirar do sino** (some para todos; o aviso fica Cancelado) ou **Duplicar** (rascunho novo com o mesmo conteúdo e segmento; data que já passou volta para "agora"). Excluir vale para rascunho, aguardando aprovação, cancelado e encerrado; pop-up no ar precisa ser encerrado antes. Duas pessoas editando ao mesmo tempo: a segunda recebe o aviso de que o aviso mudou em outra tela e recarrega sem perder o que escreveu (409, docs/17 §2.3). O recálculo de quem vê o pop-up, a cada 15 minutos, não conta como edição.

### 2.3 Quem pode (docs/17 D4)

| Permissão | O que libera | Papéis prontos |
|---|---|---|
| `messaging.write` | ver a área, criar, editar (menos o pop-up no ar), duplicar, excluir, enviar teste para si e pedir a publicação (sem a permissão de baixo, vira pedido de aprovação) | Dono, Admin, Editor |
| `messaging.publish` | enviar, agendar e publicar para até 500 alunos; editar e retomar pop-up no ar de até 500 alunos; pausar, encerrar, cancelar agendamento e retirar do sino | Dono, Admin, Editor |
| `messaging.publish_large` | publicar (e editar ou retomar pop-up no ar) acima de 500 alunos e aprovar ou devolver o pedido de outra pessoa | Dono, Admin |

Professor, Suporte e Analista não veem a área. Quem não pode publicar (ou passa de 500 sem a terceira permissão) vê **Enviar para aprovação**; o aviso fica **Aguardando aprovação** até um dono ou admin aprovar (a contagem é refeita na aprovação, e quem aprova vira quem publicou) ou devolver (volta para rascunho). Toda gravação, publicação, pedido, aprovação, devolução, pausa, retomada, encerramento, cancelamento, retirada, duplicação, exclusão e teste fica no registro de auditoria (`admin_audit_log`, só ids e contagens).

- **Pop-up no ar.** Editar ou retomar um pop-up no ar muda o que os alunos veem agora, então vale como publicar: sem `messaging.publish` a gravação é recusada (403, `Só quem pode publicar muda um pop-up no ar. Duplique para criar outro.`) e o menu nem oferece **Editar**; acima de 500 alunos (o segmento novo, quando ele mudou; senão a contagem atual do pop-up), só dono ou admin (403, `Para mudar um pop-up no ar para este segmento, peça a um dono ou administrador.`; ao retomar, `Este pop-up passou de 500 alunos. Para retomar, peça a um dono ou administrador.`). Aqui não há pedido de aprovação: o pop-up continua no ar como estava.
- **Limite na hora do envio.** O limite de 500 é conferido ao publicar, ao aprovar e de novo quando a notificação agendada sai. Publicada por quem não tem `messaging.publish_large` (sem aprovação) e com o segmento acima de 500 na hora de sair, ela não sai: volta para **Aguardando aprovação**, pedida em nome de quem agendou (auditoria `communication.approval_requested` com o motivo `grew_after_schedule`), e, aprovada, sai na hora. Quem publica com `messaging.publish_large` fica registrado como aprovado (`approved_at`); o relatório só mostra "Aprovado" quando houve pedido.
- **Pop-up que cresce no ar (decisão do produto).** O segmento do pop-up no ar pode passar de 500 alunos sem nova aprovação: ele é recalculado a cada 15 minutos e quem publicou já decidiu o segmento (pausar o pop-up a cada crescimento tiraria do ar algo que estava certo). A regra volta a valer quando alguém edita ou retoma o pop-up.
- **Versão conferida.** Publicar e aprovar contam e gravam a mesma versão do aviso (a que foi lida do banco): se outra tela salvou no meio, a ação dá 409 (`Este aviso mudou em outra tela…`) e nada sai. A tela sempre manda a versão que mostrou; versão diferente também é 409, antes de contar.
- **Nomes na prévia.** Os 5 nomes de amostra só vão para quem tem `students.read_basic` (quem vê a lista de Alunos): combinar regras e ler nomes revelaria progresso, estudo e acesso de alunos com nome. Para as outras funções, a prévia mostra a contagem e a frase do segmento, sem nomes.

### 2.4 Relatório de cada aviso

Para quem (recebeu ou estava elegível) → viram → clicaram → voltaram a estudar em 7 dias. Na notificação com resposta: aceitaram e recusaram. No pop-up: fecharam sem clicar (com alerta acima de 40 %, docs/17 §2.11), Não mostrar de novo e Lembrar depois. Também: a prévia do conteúdo, a frase do segmento, quem criou, quando foi enviado ou publicado e quem aprovou. Aguardando aprovação: faixa `Aguardando aprovação de um dono ou administrador.` e, para quem pode, **Aprovar e publicar** e **Recusar**. Pop-up no ar ou pausado abre no relatório com **Editar** (`?editar=1`, só para quem pode editar o pop-up no ar; para o resto, o mesmo endereço abre o relatório).

---

## 3. Segmentos: as regras

Cada regra pode ser combinada com **Todas as regras** (E) ou **Qualquer regra** (OU). Dentro do grupo principal cabem grupos com a sua própria escolha de E/OU (um nível só), até 20 regras ao todo e até 50 produtos ou turmas por regra. As regras são avaliadas no servidor sobre os dados de cada aluno (`src/server/communications/audience-model.ts`), com as mesmas leituras e definições da lista de Alunos (`audience-facts.ts`). A equipe (`admin_roles`) sai antes de qualquer regra.

| Regra | Opções | Como é contado |
|---|---|---|
| Produto | tem acesso a / não tem acesso a (um ou mais produtos) | acesso aberto agora; acesso à plataforma inteira vale para todos |
| Progresso nas aulas | concluiu pelo menos / no máximo X% das aulas, de um produto ou de tudo o que tem | aulas publicadas concluídas ÷ aulas publicadas, arredondado para baixo; quem não tem aula para medir não entra |
| Comentários | comentou pelo menos N vezes / no máximo N / não comentou / está entre os N que mais comentaram, nos últimos 7, 30 ou 90 dias ou desde sempre | comentários e respostas aprovados do aluno (equipe fora, RPC `communication_comment_counts`, lida em páginas de 1.000 porque o PostgREST corta o resultado em 1.000 linhas sem avisar); o ranking só conta quem comentou na janela e empata pela ordem fixa do id |
| Tempo de acesso | ganhou acesso há menos de / há mais de X dias, a um produto ou a qualquer um | início do acesso aberto (`entitlements.starts_at`, que é a compra ou a liberação manual); com produto, o acesso dele ou o da plataforma |
| Acesso terminando | termina em até X dias, de um produto ou de qualquer um | fim do acesso aberto; acesso sem fim não entra |
| Último estudo | estudou nos últimos X dias / não estuda há X dias ou nunca estudou | último progresso gravado |
| Entrada na plataforma | nunca entrou / entrou nos últimos X dias / não entra há X dias | último login (`profiles.last_sign_in_at`) |
| Ritmo | Estudando, Em risco, Inativo, Nunca começou, Concluiu | mesma regra da lista de Alunos (docs/17 §1.11) |
| Turma | está em uma das turmas | turmas dos produtos com acesso aberto |

Dias vão de 1 a 3.650. Exemplos: "quem comprou o Bootcamp há menos de 7 dias e ainda não estudou"; "quem tem a Formação IA e (não comentou nos últimos 30 dias ou concluiu no máximo 20% das aulas)". A frase do segmento (`describeAudience`) é a mesma no editor, na lista e no relatório: `Alunos que têm acesso a Formação IA e (não comentaram nos últimos 30 dias ou concluíram no máximo 20% das aulas)`.

Segmentos salvos em Alunos viram regras (todas juntas): produto, ritmo, turma, "Expiram em 30 dias", "Nunca entraram", "Compraram e não começaram" e "Top comentadores" (os 100 que mais comentaram em 30 dias).

Notificação usa o segmento do momento do envio (acima de 500 sem aprovação, volta para aprovação, seção 2.3). Pop-up é recalculado enquanto está no ar (a cada 15 minutos pelo job, e na hora ao publicar, retomar ou mudar o segmento): quem passa a se encaixar começa a ver; quem deixa de se encaixar para de ver. O que o aluno já fez (viu, clicou, Não mostrar de novo, Lembrar depois) nunca é apagado enquanto o pop-up existe, nem pela retenção de 24 meses (seção 4.6).

---

## 4. Como funciona por dentro

### 4.1 Tabelas (migração `202610200001_communication_v1.sql`, docs/05)

- `campaigns`: cada aviso, com tipo (`inbox` = notificação, `popup`), situação, conteúdo, segmento (`audience`, JSON das regras), agenda, janela, quantas vezes, números do envio e aprovação. `updated_at` é a versão do editor; o gatilho `touch_campaign_version` não muda a versão quando só a contagem do segmento muda (senão o recálculo do job daria 409 em quem está editando).
- `notifications`: o sino, uma linha por aluno. A de aviso aponta para o aviso (não copia o texto); as automáticas guardam o trecho e o link. `dedupe_key` única por aluno: o mesmo aviso nunca chega duas vezes. O banco exige a ordem visto → lido → clicado.
- `campaign_deliveries`: o pop-up por aluno (elegível, impressões, visto, clicado, Não mostrar de novo, Lembrar depois).
- Bucket público `communication-audio` (só áudio, até 10 MB). As imagens vão para o `content-assets` que já existe (`communications/images`, WebP recortado no navegador, como capas e destaque).
- RPCs só para o servidor: `communication_comment_counts`, `communication_campaign_stats`, `communication_overview`.
- RLS ligado em tudo e nada para o navegador: as rotas e as Server Actions conferem sessão e permissão e leem com a chave de serviço (mesmo padrão de comentários e Tutor).
- Deploy antes da migração não quebra nada: o sino fica vazio, o pop-up não aparece, o job registra e termina e as telas do admin mostram o aviso de atualização do banco.

### 4.2 Envio da notificação

- **Enviar agora**: a Server Action conta o segmento, reserva o aviso (`sending`) e grava as linhas do sino ali mesmo, em lotes de 500, até 20.000 alunos por vez; termina como **Enviado**. Um segmento maior (ou um envio interrompido) fica **Enviando** e o job do minuto seguinte termina.
- **Agendar**: o aviso fica **Agendado**; o job `comunicacao` do tick de minuto pega até 3 avisos vencidos por vez (reserva com atualização condicional, como a fila de e-mail: dois ticks nunca pegam o mesmo aviso), envia e marca **Enviado**. Agendado sem aprovação e com o segmento acima de 500 na hora: volta para **Aguardando aprovação**, sem data, e nada sai (seção 2.3). Um envio cortado no meio (fim do orçamento do tick, teto de 20.000 por rodada) solta a reserva e continua no tick seguinte só com quem ainda não recebeu; uma reserva esquecida há mais de 2 minutos (tick que caiu) é retomada. A chave única por aluno garante que ninguém recebe duas vezes. Três falhas seguidas cancelam o envio com o motivo gravado em `last_error`.
- `recipients_count` é o número de linhas gravadas (sem o teste da equipe); `audience_count`, o tamanho do segmento na hora do envio.
- Decisão (registrada também em docs/04 e docs/09): o `docs/04` manda "envios em massa" para uma fila de jobs dedicada. Aqui a notificação do sino é uma linha pequena no banco (dois ids e uma chave), gravada em lotes, com teto por execução e retomável, então fica no tick. E-mail, push e WhatsApp em massa continuam fora do tick.

### 4.3 Pop-up

- Ao publicar (ou retomar), o servidor calcula quem está no segmento e grava `campaign_deliveries`; se esse cálculo falhar, o pop-up fica no ar e o job do minuto seguinte monta a lista. Depois, o job recalcula até 5 pop-ups por minuto, a cada 15 minutos, enquanto eles estão no ar (inclusive os de janela futura, para a lista estar pronta quando ela abrir). As faixas de 15 minutos seguem o relógio (:00, :15, :30, :45): todos os pop-ups vencidos caem no mesmo minuto e dividem uma leitura dos alunos, em vez de cada um ter o próprio relógio.
- Recálculo do job que falha (banco lento, teto de 50.000 linhas) grava só a hora do recálculo e tenta de novo na faixa seguinte, não a cada minuto (sem `last_error`, que contaria como edição e daria 409 em quem está com o editor aberto). Recálculo que termina depois de uma mudança de segmento feita no meio dele não grava a contagem por cima: deixa a hora vazia e o job do minuto seguinte refaz com o segmento atual.
- A primeira publicação grava `sent_at`, que ordena os pop-ups sem data de início e aparece no relatório como "publicado em".
- A home pede `GET /api/notifications/summary?popup=1` 1,5 s depois de aparecer. É o único pedido do resumo na home: o número do sino vem junto, e o topo não pede o seu ali (nas outras páginas, o topo pede depois da hidratação). O servidor junta a lista curta de pop-ups no ar (em cache por 60 s, tag `communications`, invalidada ao publicar, editar, pausar, retomar, encerrar ou excluir) com o estado daquele aluno (duas leituras pequenas: as linhas dele nesses pop-ups e o último pop-up que ele viu) e aplica as regras da seção 1.3 (`pickPopup` em `campaign-model.ts`). O cache só guarda os avisos, nunca dado de aluno.
- Cada ação do aluno vai para `POST /api/popups/[id]/events` (`impressed` ao aparecer; `clicked`, `snoozed`, `dismissed` ou `closed` ao sair). Os contadores mudam só sobre o valor lido: duas abas não passam do limite de Lembrar depois.

### 4.4 Rotas do aluno

| Rota | Para quê |
|---|---|
| `GET /api/notifications?cursor=&filter=all\|unread` | lista do sino (20 por vez, cursor com os microssegundos do banco) com os dois contadores |
| `GET /api/notifications/summary[?popup=1]` | número do sino e, na home, o pop-up da vez |
| `POST /api/notifications/read` | `{ seen: true }` ao abrir, `{ ids }` (1 a 50) ou `{ all: true }` (os dois de "todas" só mexem no que aparece no sino, em lotes de ids); devolve os contadores novos |
| `POST /api/notifications/[id]/click` | abriu o link (sem corpo; aceita `sendBeacon`) |
| `POST /api/notifications/[id]/response` | `{ response: "accepted" \| "declined" }`, uma vez só (a segunda é 409 `Você já respondeu.`) |
| `POST /api/popups/[id]/events` | `impressed`, `clicked`, `closed`, `dismissed`, `snoozed` (aceita o corpo em `text/plain`, como o `sendBeacon` manda); Lembrar depois além do limite é 409 |

Todas exigem sessão (`requireApiUser`), as que recebem corpo leem com teto de 8 KB, e todas respondem `Cache-Control: private, no-store` com `Vary: Cookie`. Id inválido é 400; notificação ou pop-up de outra pessoa (ou que não está mais visível) é 404, sem dizer se existe. As escritas gravam um evento em `student_events`, só com ids: `notification_read` (um por id marcado, ou um com `all` em "Marcar todas"), `notification_clicked`, `notification_responded` e `message_impressed`, `message_clicked`, `message_closed`, `message_dismissed`, `message_snoozed`; abrir o sino (`{ seen: true }`) e as leituras não gravam evento. O evento é secundário: se falhar, vira log e a resposta não muda. Sem a migração aplicada, as leituras respondem vazio, marcar como vista ou lida não faz nada e clique, resposta e eventos do pop-up respondem 404 (a área do aluno não quebra antes da migração).

### 4.5 Áudio e gravação

- O áudio sobe por `POST /api/admin/communications/audio` (`messaging.write`, multipart com o campo `file`, até 10 MB; Server Action tem limite de 1 MB). O servidor confere o tipo pelos primeiros bytes do arquivo, não pelo nome nem pelo tipo informado (MP3, M4A, OGG, WEBM, WAV e AAC puro); tipo errado é 422 (`Use um arquivo de áudio MP3, M4A, OGG, WEBM ou WAV.`) e arquivo grande é 413 (`O áudio deve ter no máximo 10 MB.`). O arquivo vai para `communication-audio/campaigns/{hash}.{ext}` com cache de um ano; o mesmo áudio enviado de novo não duplica.
- A duração e a forma de onda (48 barras) são calculadas no navegador da equipe na hora de escolher ou gravar, e gravadas junto com o aviso; o aluno não baixa o áudio para desenhar a onda (`preload="none"`). No sino estreito ou no celular, a onda mostra de 12 a 48 barras, conforme a largura.
- Gravar no navegador precisa do microfone: o cabeçalho `Permissions-Policy` libera `microphone=(self)` só em `/admin`; a área do aluno continua com o microfone bloqueado (`tests/deployment-security.test.mjs` confere o valor efetivo). O Chrome aplica a política do documento que carregou, não a da rota: por isso o login, a troca de senha e os links da área do aluno para o admin fazem carregamento inteiro (`isAdminPath` em `src/lib/auth/redirect.ts`; `tests/navigation.guard.test.mjs`), e o gravador confere `document.featurePolicy`/`permissionsPolicy` antes de pedir o microfone.
- A CSP já aceitava áudio `https:`; o Supabase local (http) entrou no `media-src` como já estava no `img-src`, só quando ele é a própria máquina (testes).
- Disco (docs/20 §10.1): os áudios e as imagens ficam no Storage do servidor e entram no backup diário. 10 MB por aviso é o teto; um aviso por semana com áudio dá cerca de 0,5 GB por ano. Áudio ou imagem trocados no editor ficam no Storage sem referência (como as capas; a limpeza fica para depois).

### 4.6 Retenção e LGPD

- O sino mostra 90 dias. `prune_communication_history()` apaga, todo dia às 06:41 UTC (`bunker707-communication-prune`), notificações e estados de pop-up com mais de 24 meses (docs/17 D8), menos os estados de pop-up ainda no ar ou pausado: lá fica o Não mostrar de novo (e o "Uma vez" já visto) de quem não mexeu no pop-up há dois anos; apagar faria o recálculo seguinte criar a linha de novo e o pop-up voltar. Sai o estado de pop-up encerrado (também pelo fim da janela) ou excluído.
- Conta excluída leva junto as notificações e os estados de pop-up (chave com `on delete cascade`). Quem respondeu um comentário e depois excluiu a conta aparece com o nome gravado no comentário (sem nome, `Alguém`).
- Eventos e auditoria guardam só ids e contagens, nunca o texto do aviso ou do comentário.

---

## 5. Decisões tomadas

| # | Decisão | Por quê |
|---|---|---|
| C1 | O sino se chama **Notificações** (não "Lembretes") | vocabulário fechado do docs/17 §1.3 |
| C2 | Número = novas não vistas; bolinha = não lidas | o número some ao abrir (docs/17 §1.8.5, "lido ao abrir") sem perder o que o aluno ainda não abriu |
| C3 | Notificação de aviso aponta para o aviso; automáticas guardam o trecho | uma linha pequena por aluno e retirar do sino com uma ação |
| C4 | Segmento avaliado no servidor, em TypeScript, com os mesmos dados da lista de Alunos | uma definição só de ritmo, progresso e acesso; a conta vai para uma RPC quando passar de alguns milhares de alunos (o mesmo aviso de escala de `buildStudentIndex`, com o mesmo teto de 50.000 linhas) |
| C5 | Envio do sino no tick (ver 4.2) | não há fila de jobs instalada e a gravação é pequena, em lotes, com teto por rodada e idempotente |
| C6 | Pop-up só na home, 1 por sessão e 1 a cada 24 h, sem exceção da equipe | docs/17 §1.8.1 e D12 |
| C7 | "Pedir resposta (Aceitar ou Recusar)" já existe para avisos da equipe | é o mesmo mecanismo que os convites da comunidade vão usar |
| C8 | Áudio em bucket público com nome por hash | como as imagens; o aviso não é conteúdo pago e o link não é adivinhável |
| C9 | Desfecho fixo "voltou a estudar em 7 dias" | o seletor de desfecho do docs/17 §1.8.2 fica para depois; o número já mede o que importa |
| C10 | Menção só quando um único autor da conversa tem o `@usuario` | o nome de usuário não é único na escola; melhor não avisar do que avisar a pessoa errada |
| C11 | Sem tempo real: o número do sino é lido ao abrir a página, com 60 s de memória, e ao voltar para a aba | cada chamada custa uma conferência de sessão no Auth; no servidor de 2 vCPU (docs/20 §12.1) nada roda em intervalo |
| C12 | O limite de 500 vale de novo na hora do envio da notificação agendada; o pop-up no ar pode crescer além dele | a notificação sai uma vez só e não volta; o pop-up é recalculado a cada 15 minutos e pausá-lo a cada crescimento tiraria do ar algo que estava certo. Editar ou retomar o pop-up confere de novo (seção 2.3) |
| C13 | Editar ou retomar pop-up no ar sem a permissão é recusado (403), não vira pedido de aprovação | o pop-up está no ar: um pedido deixaria duas versões (a no ar e a pedida) sem um lugar claro para cada uma; Duplicar cria o rascunho para pedir |

---

## 6. Fica para depois

- **Comunidade** (posts de texto, texto com áudio, vídeo, resultados dos alunos, gamificação) e **convites entre membros** no sino: o pedido de resposta já está pronto; falta quem cria o convite. Vídeo de aluno não fica no servidor da área: vai para Bunny ou Mux (AGENTS.md).
- **Salas ao vivo e webinários "tipo Zoom"** dentro da área, com comentários e números de retenção (momento de saída, retenção média e máxima, quem mais comentou): pede um estudo próprio (provedor de vídeo ao vivo, custo e escala) antes do desenho. Quando existir, o pop-up e o sino já levam o convite e o lembrete.
- Outros tipos do docs/17 §1.8.1: faixa no topo, card na home, destaque e toast.
- Canais: e-mail (pela fila `email_outbox`), push e WhatsApp, com a central de preferências `/perfil/notificacoes` e o descadastro sem login.
- Seletor de desfecho ("Como medir"), "Salvar quem converteu como segmento", tabela própria de segmentos da Comunicação, aba "Avisos recebidos" no perfil do aluno, "Enviar aviso" a partir da lista de Alunos, de Comunidade › Top alunos e dos alertas de Hoje.
- Notificação em tempo real (hoje o número é atualizado a cada abertura de página e ao voltar para a aba, com intervalo mínimo de 60 s).
- Limite de pedidos por minuto nas rotas do sino (hoje cada escrita é do próprio aluno, idempotente e com corpo limitado), junto com o `POST /api/events` do docs/17 §2.3.
- Ajustes vistos na entrega: o menu da conta fica por baixo da IA Diretor quando os dois estão abertos (o sino já abre por cima); apagar do Storage áudios e imagens descartados.

---

## 7. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/comunicacao-segmentos.test.mjs` (20) | cada regra, grupos E/OU, ranking de comentadores, frases do segmento, normalização, limites do schema e conversão dos segmentos de Alunos |
| Unitário | `tests/comunicacao-avisos-modelo.test.mjs` (23) | situações, ações por situação e permissão (Editar o pop-up no ar só para quem publica), aprovação acima de 500, agenda de São Paulo, frase de revisão, escolha do pop-up e seus limites (inclusive "Uma vez" com Lembrar depois), eventos do pop-up, versão do editor até o microssegundo, faixas de 15 minutos do recálculo, menção, trecho, cursor com microssegundos, forma de onda e regras do rascunho e da publicação |
| Unitário | `tests/comunicacao-job.test.mjs` (8) | job sem trabalho não lê os alunos; sem a migração termina sem erro; erro de banco de verdade vira falha do job; nome do job; recálculo que falha grava só a hora (faixa seguinte); notificação agendada sem aprovação acima de 500 volta para aprovação e a de até 500 (ou aprovada) sai; comentários por aluno lidos em páginas de 1.000 |
| Unitário | `tests/comunicacao-admin-modelo.test.mjs` (20) | regras puras da tela da equipe: endereços e página depois do fim, editor ou relatório (`?editar=1` só para quem pode editar), "—" em vistos e cliques do que nunca saiu, menu e confirmações, botão principal, salvar sem mudança e os toasts do que foi cancelado, situação depois de publicar, títulos do banner de erro, rascunho e conflito, prévia, segmento (foco depois de remover, nome do botão de cada regra), áudio (parada automática, atraso aceito, microfone bloqueado pela página) e relatório |
| Unitário | `tests/comunicacao-lista.test.mjs` (2) | lista com `?pagina=` depois do fim: o 416 (PGRST103) do PostgREST vira página vazia; outro erro do banco continua erro |
| Unitário | `tests/auth-redirect.test.mjs`, `tests/navigation.guard.test.mjs` | `isAdminPath` e a guarda de que login, troca de senha e os links da área do aluno entram no admin com carregamento inteiro (microfone) |
| Unitário | `tests/comunicacao-audio.test.mjs` (3) | tipo do áudio pelos primeiros bytes, envio ao bucket pelo hash, recusa do que não é áudio e de arquivo acima de 10 MB |
| Unitário | `tests/sino-do-aluno-modelo.test.mjs` (10) | agrupamento por dia, número do sino, nome acessível, memória de 1 minuto, relógio, velocidade e onda do áudio, destino dos links e leitura local |
| Unitário | `tests/sino-do-aluno-resumo.test.mjs` (3) | na home o pedido do pop-up é o único (o topo espera por ele e o pedido comum aproveita o que está em andamento); falha espera o mesmo minuto |
| Unitário | `tests/deployment-security.test.mjs` | microfone liberado só no `/admin` (valor efetivo da `Permissions-Policy`) |
| Unitário | `tests/jobs-tick.test.mjs`, `tests/admin-frames.test.mjs`, `tests/admin-today.test.mjs`, `tests/admin-search.test.mjs`, `tests/admin-v2-shell.test.mjs` | job `comunicacao` no registro depois do `email-outbox`; Avisos deixa de ser moldura (Webinários e Promoções continuam), "Aviso" no Criar do Hoje e "Novo aviso" no Cmd+K |
| Integração | `tests/integration/avisos-e-notificacoes.test.mjs` (25) | permissões (analista 403, sem sessão 401), rascunho inválido, contagem sem a equipe, enviar agora, abrir o sino e ler, clicar, responder, agendar e o job, envio cortado retomado sem duplicar, cancelar agendamento, retirar, teste para mim, duplicar e excluir, página da lista depois do fim, aprovação, notificações de resposta e menção (aula e Comunidade do admin), resposta escondida, paginação, imagem e áudio do aviso, versão conferida ao publicar e aprovar (inclusive segmento salvo no meio da contagem), nomes da prévia só com `students.read_basic` e abrir o sino ou "Marcar todas" sem tocar no aviso ainda sendo enviado |
| Integração | `tests/integration/pop-ups.test.mjs` (11) | quem vê, limite de 24 h, uma vez e até clicar, Lembrar depois (também no "Uma vez"), Não mostrar de novo, pausar, retomar e encerrar, janela futura, o recálculo pelo job, editar ou retomar pop-up no ar só com permissão de publicar (e acima de 500 só dono ou admin), recálculo atrasado que não grava por cima de uma mudança de segmento e retenção de 24 meses que guarda o estado do pop-up no ar |
| Ponta a ponta | `tests/e2e/produtor-envia-notificacao.spec.ts` | a equipe envia e a aluna vê o número, abre o sino e segue o botão |
| Ponta a ponta | `tests/e2e/aluno-ve-pop-up.spec.ts` | o pop-up aparece na home e Não mostrar de novo vale depois de recarregar |

A escola de teste ganhou `limparComunicacao` (`tests/fixtures/escola-de-teste.mjs`), que apaga avisos, notificações e estados de pop-up de toda conta `@bunker707.test`, para nenhum outro teste ver um pop-up.

---

## 8. Roteiro de conferência no ambiente de teste

1. Aplicar a migração `202610200001_communication_v1.sql` no Supabase da nuvem (CONTRIBUTING, passo 5).
2. Em `/admin/comunicacao/avisos`, **Novo aviso** → Notificação, título, texto, uma imagem e um áudio gravado, botão para uma página da área; Para quem: Todos os alunos; **Enviar teste para mim** e conferir no sino da sua conta.
3. Entrar com uma conta de aluno de teste: o sino mostra `1`; abrir, tocar o áudio, clicar no botão.
4. Criar um pop-up para "tem acesso a [um curso]" e **Publicar pop-up**; abrir a home com o aluno de teste: aparece em 3 s; **Não mostrar de novo**; recarregar: não volta.
5. Responder, como professor, um comentário do aluno de teste numa aula: o aluno recebe `Professor respondeu seu comentário` com o link da aula.
6. Agendar uma notificação para daqui a 5 minutos e ver a situação mudar de Agendado para Enviado (o tick do ambiente de teste precisa estar ligado, docs/21 §5).
