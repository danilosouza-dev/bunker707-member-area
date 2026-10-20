# 22. Comunicação v1: notificações no sino e pop-ups

Data: 20/10/2026. Pedido do produtor: o aluno recebe notificações no sino da área de membros (com imagem, áudio que toca ali mesmo e um botão para dentro ou para fora da plataforma, e convites que ele aceita ou recusa); a equipe cria as notificações, envia na hora ou agenda; e cria pop-ups para grupos de alunos escolhidos por regras combinadas (porcentagem de aulas concluídas, quem mais comentou, quem não comentou, quem comprou há menos ou há mais de X dias, produto, e assim por diante).

Este documento registra o que foi construído, as regras fixas, as decisões e o que fica para depois. Ele detalha a fase 5 do `docs/17` (§1.8 Comunicação, §2.4 tabelas, §2.5 eventos, D4 e D12) e vale para qualquer trabalho em Comunicação, sino ou pop-ups.

---

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Sino do aluno** | contador de novas, painel com abas Todas e Não lidas, lista por dia (Hoje, Ontem, Últimos 7 dias, Mais antigas), "Marcar todas como lidas", 90 dias de histórico, carregar mais | topo de todas as páginas do aluno |
| **Notificação de aviso** | título, texto, imagem 16:9, áudio com forma de onda (toca no próprio sino, com velocidade 1x, 1,5x e 2x), botão para uma página da área (mesma aba) ou link externo (nova aba), e pedido de resposta com **Aceitar** e **Recusar** | sino |
| **Notificações automáticas** | "Fulano respondeu seu comentário" e "Fulano mencionou você", com o trecho e o link da aula | sino |
| **Pop-up** | imagem, título, texto, áudio, botão, **Lembrar depois** e **Não mostrar de novo**; só na home, 3 s depois de abrir, no máximo 1 por sessão e 1 a cada 24 h, nunca numa aula | home do aluno |
| **Avisos e pop-ups (admin)** | lista com os quatro números do topo, criar e editar com prévia ao vivo (os mesmos componentes que o aluno vê), segmento por regras E/OU com contagem na hora e 5 nomes de amostra, enviar agora, agendar, enviar teste para mim, aprovação acima de 500 alunos, pausar, retomar, encerrar, cancelar agendamento, retirar do sino, duplicar, excluir e relatório de cada aviso | `/admin/comunicacao/avisos` |
| **Envio agendado** | o job `comunicacao` do tick de minuto envia as notificações vencidas e atualiza quem entra em cada pop-up no ar | `src/server/jobs/communications-job.ts` |

Vocabulário do admin (docs/17 §1.3): **Aviso** é o nome geral; **Notificação** é o aviso do sino; **Pop-up** é o aviso da home; **Segmento** é para quem vai ("Para quem"); **Situação** é o estado. Nunca "campanha", "público", "audiência", "evento" ou "oferta" na tela.

---

## 1. O que o aluno vê

### 1.1 O sino

- O botão do sino mostra um número vermelho com as notificações **novas** (que o aluno ainda não viu no painel). Acima de 9 aparece `9+`. O nome acessível diz quantas são (`Notificações, 3 novas`).
- Ao abrir o painel, o número zera (as notificações ficam **vistas**), mas cada item continua com a bolinha vermelha até o aluno abrir o link, responder ou tocar em **Marcar todas como lidas** (ficam **lidas**). É o mesmo padrão das redes sociais: o número diz "tem coisa nova"; a bolinha diz "você ainda não abriu".
- Abas **Todas** e **Não lidas**, com a contagem ao lado. Lista agrupada por dia no fuso de São Paulo, 20 por vez, com **Carregar mais**.
- Cada item mostra quem mandou (a escola, com a logo, ou a foto de quem respondeu), um selo do tipo no canto da foto, o título, o texto (com **Ver mais** quando é longo), há quanto tempo, a imagem, o áudio, o botão e, quando o aviso pede resposta, **Recusar** e **Aceitar**. Depois de responder aparece `Você aceitou` ou `Você recusou`.
- O áudio toca dentro do sino: play e pausa, forma de onda que avança e aceita clique e arraste para pular, teclado (setas avançam e voltam 5 s), tempo `0:12 / 0:58` e velocidade. Só um áudio toca por vez.
- O botão leva para uma página da área (mesma aba, com o mesmo indicador de navegação do resto da área) ou para um site de fora (nova aba, com `rel="noopener noreferrer"`). O link é conferido de novo na hora de desenhar, como no destaque da home (docs/06).
- Estados honestos: carregando (3 linhas de esqueleto), vazio (`Nenhuma notificação por enquanto`), em dia (`Você está em dia`) e erro (`Não foi possível carregar as notificações.` com **Tentar de novo**).
- Desempenho (docs/17 §2.8): o número do sino é buscado pelo navegador depois que a página aparece, nunca no carregamento da página; fica guardado por 60 s entre uma página e outra e é atualizado quando o aluno volta para a aba. A lista só é buscada quando o aluno abre o sino.

### 1.2 Notificações automáticas

- **Resposta**: quando alguém (aluno, professor ou equipe pelo admin em Comunidade) responde ao comentário de um aluno, o dono do comentário recebe `Nome respondeu seu comentário`, com o trecho da resposta, o nome da aula e o link da aula.
- **Menção**: a tela da aula escreve `@usuario` no começo da resposta quando o aluno responde a uma resposta. Se esse usuário é autor de um comentário da mesma conversa, ele recebe `Nome mencionou você`.
- Ninguém recebe notificação da própria resposta, e a mesma resposta nunca gera duas notificações para a mesma pessoa.
- Se a resposta for escondida pela moderação ou excluída, a notificação some do sino.
- A notificação é gravada depois da resposta, fora do caminho dela: se a gravação falhar, a resposta continua publicada.

### 1.3 O pop-up

- Aparece **só na home**, 3 s depois que ela abre, e espera se outra janela (detalhes de um curso, por exemplo) estiver aberta ou se a aba estiver escondida. Nunca durante uma aula (docs/17 §1.8.1).
- **No máximo 1 por sessão** (guardado no navegador) **e 1 a cada 24 h** (guardado no servidor). Esses limites são fixos e aparecem no editor como texto, não como campo (docs/17 §1.8.1 e D12).
- Botões: o botão do aviso (página da área ou site de fora), **Lembrar depois** (volta em 24 h; no máximo 2 vezes; a equipe pode desligar) e **Não mostrar de novo**. Fechar no X, no Esc ou fora da janela também conta como visto.
- "Quantas vezes": **Uma vez** (some depois que o aluno vê) ou **Até o aluno clicar** (volta no máximo 1 vez por dia até ele clicar no botão ou escolher Não mostrar de novo).
- Enquanto o pop-up está aberto, o vídeo do destaque da home pausa e volta depois.

---

## 2. O que a equipe faz (`/admin/comunicacao/avisos`)

### 2.1 Lista

- Os quatro números do topo seguem o período da barra superior: **Avisos ativos** (pop-ups no ar agora + notificações agendadas ou enviando), **Vistos** no período, **Taxa de clique** (cliques ÷ vistos) e **Voltaram a estudar** (alunos que viram um aviso no período e estudaram nos 7 dias seguintes: pelo menos 10 min assistidos ou 1 aula concluída somando os dias, docs/17 §1.11). Sem dado, o cartão mostra "—".
- Filtro Todos, Notificações e Pop-ups. Colunas: aviso (imagem ou ícone, título e tipo), para quem (a frase do segmento e o número de alunos), quando, situação, vistos e cliques. O menu de cada linha traz só as ações possíveis naquela situação.
- Situações: Rascunho, Aguardando aprovação, Agendado, Enviando, Enviado, Cancelado (notificação); Rascunho, Aguardando aprovação, Agendado (janela ainda não começou), Ativo, Pausado, Encerrado (pop-up).

### 2.2 Criar e editar (`/avisos/novo`, `/avisos/[id]`)

Uma página com o formulário à esquerda e a prévia ao vivo à direita (computador e celular), usando os mesmos componentes que o aluno vê. Quatro blocos:

1. **O que**: tipo (Notificação no sino ou Pop-up na home), título (até 80 caracteres na notificação e 60 no pop-up), texto (até 600 e 240), imagem 16:9 opcional com descrição, áudio opcional (**Enviar arquivo** ou **Gravar agora** no próprio navegador, até 5 minutos e 10 MB, MP3, M4A, OGG, WEBM ou WAV), botão opcional (Um produto, Página da área ou Link externo; abrir na mesma aba ou em nova aba) e, na notificação, **Pedir uma resposta (Aceitar ou Recusar)** com os textos dos dois botões.
2. **Para quem**: Todos os alunos ou Escolher por regras (seção 3), com a contagem na hora (`≈ 318 alunos agora`), 5 nomes de amostra e a frase do segmento. **Usar um segmento salvo** traz os segmentos prontos e salvos em Alunos como regras. A equipe nunca entra na contagem nem recebe avisos.
3. **Quando**: na notificação, Enviar agora ou Agendar (data e hora de São Paulo); no pop-up, começa (ao publicar ou numa data), termina (sem data ou numa data), quantas vezes e se permite Lembrar depois.
4. **Revisão**: uma frase com o resumo (`Pop-up para 318 alunos, de 14/10/2026 às 09:00 a 21/10/2026 às 23:59, no máximo 1 vez.`), **Salvar rascunho**, **Enviar teste para mim** (notificação, chega só no sino de quem clicou) e o botão principal (**Enviar agora**, **Agendar envio**, **Publicar pop-up** ou **Enviar para aprovação**).

Edição: rascunho, aguardando aprovação e notificação agendada voltam para rascunho ao salvar; pop-up no ar pode ser editado sem sair do ar (quem já fechou não vê de novo). Notificação enviada não muda: dá para **Retirar do sino** (some para todos) ou **Duplicar**. Duas pessoas editando ao mesmo tempo: a segunda recebe o aviso de que o aviso mudou em outra tela e recarrega sem perder o que escreveu (409, docs/17 §2.3).

### 2.3 Quem pode (docs/17 D4)

| Permissão | O que libera | Papéis prontos |
|---|---|---|
| `messaging.write` | ver a área, criar, editar, duplicar, excluir rascunho, enviar teste para si | Dono, Admin, Editor |
| `messaging.publish` | enviar, agendar e publicar para até 500 alunos; pausar, retomar, encerrar, cancelar agendamento e retirar do sino | Dono, Admin, Editor |
| `messaging.publish_large` | publicar acima de 500 alunos e aprovar ou recusar o pedido de outra pessoa | Dono, Admin |

Quem não pode publicar (ou passa de 500 sem a terceira permissão) vê **Enviar para aprovação**; o aviso fica **Aguardando aprovação** até um dono ou admin aprovar (a contagem é refeita na aprovação). Toda publicação, aprovação, pausa e retirada fica no registro de auditoria (`admin_audit_log`, só ids e contagens).

### 2.4 Relatório de cada aviso

Para quem (recebeu ou estava elegível) → viram → clicaram → voltaram a estudar em 7 dias. Na notificação com resposta: aceitaram e recusaram. No pop-up: fecharam sem clicar (com alerta acima de 40 %, docs/17 §2.11), Não mostrar de novo e Lembrar depois. Também: a prévia do conteúdo, a frase do segmento, quem criou, quando foi enviado ou publicado e quem aprovou.

---

## 3. Segmentos: as regras

Cada regra pode ser combinada com **Todas as regras** (E) ou **Qualquer regra** (OU). Dentro do grupo principal cabe um grupo com a sua própria escolha de E/OU (um nível), até 20 regras. As regras são avaliadas no servidor sobre os dados de cada aluno (`src/server/communications/audience-model.ts`), com as mesmas definições da lista de Alunos.

| Regra | Opções | Como é contado |
|---|---|---|
| Produto | tem acesso a / não tem acesso a (um ou mais produtos) | acesso aberto agora; acesso à plataforma inteira vale para todos |
| Progresso nas aulas | concluiu pelo menos / no máximo X% das aulas, de um produto ou de tudo o que tem | aulas publicadas concluídas ÷ aulas publicadas; quem não tem aula para medir não entra |
| Comentários | comentou pelo menos N vezes / no máximo N / não comentou / está entre os N que mais comentaram, nos últimos 7, 30 ou 90 dias ou desde sempre | comentários e respostas aprovados do aluno; o ranking empata pela ordem fixa |
| Tempo de acesso | ganhou acesso há menos de / há mais de X dias, a um produto ou a qualquer um | início do acesso aberto (`entitlements.starts_at`, que é a compra ou a liberação manual) |
| Acesso terminando | termina em até X dias, de um produto ou de qualquer um | fim do acesso aberto |
| Último estudo | estudou nos últimos X dias / não estuda há X dias ou nunca estudou | último progresso gravado |
| Entrada na plataforma | nunca entrou / entrou nos últimos X dias / não entra há X dias | último login |
| Ritmo | Estudando, Em risco, Inativo, Nunca começou, Concluiu | mesma regra da lista de Alunos (docs/17 §1.11) |
| Turma | está em uma das turmas | turmas dos produtos com acesso aberto |

Exemplos: "quem comprou o Bootcamp há menos de 7 dias e ainda não estudou"; "quem tem a Formação IA e (não comentou nos últimos 30 dias ou concluiu no máximo 20% das aulas)".

Notificação usa o segmento do momento do envio. Pop-up é recalculado enquanto está no ar (a cada 15 minutos pelo job): quem passa a se encaixar começa a ver; quem deixa de se encaixar para de ver.

---

## 4. Como funciona por dentro

### 4.1 Tabelas (migração `202610200001_communication_v1.sql`, docs/05)

- `campaigns`: cada aviso, com tipo (`inbox` = notificação, `popup`), situação, conteúdo, segmento (`audience`, JSON das regras), agenda, janela, quantas vezes, números do envio e aprovação.
- `notifications`: o sino, uma linha por aluno. A de aviso aponta para o aviso (não copia o texto); as automáticas guardam o trecho e o link. `dedupe_key` única por aluno: o mesmo aviso nunca chega duas vezes.
- `campaign_deliveries`: o pop-up por aluno (elegível, impressões, visto, clicado, Não mostrar de novo, Lembrar depois).
- Bucket público `communication-audio` (só áudio, até 10 MB). As imagens vão para o `content-assets` que já existe (`communications/images`, WebP recortado no navegador, como capas e destaque).
- RPCs só para o servidor: `communication_comment_counts`, `communication_campaign_stats`, `communication_overview`.
- RLS ligado em tudo e nada para o navegador: as rotas e as Server Actions conferem sessão e permissão e leem com a chave de serviço (mesmo padrão de comentários e Tutor).

### 4.2 Envio da notificação

- **Enviar agora**: a Server Action calcula o segmento, grava as linhas do sino em lotes de 500 e marca **Enviado**.
- **Agendar**: o aviso fica **Agendado**; o job `comunicacao` do tick de minuto pega o que venceu (reserva com atualização condicional, como a fila de e-mail), envia e marca **Enviado**. Um tick cortado no meio continua no seguinte sem repetir ninguém (a chave única por aluno garante). Três falhas seguidas cancelam o envio com o motivo gravado.
- Decisão (registrada também em docs/04 e docs/09): o `docs/04` manda "envios em massa" para uma fila de jobs dedicada. Aqui a notificação do sino é uma linha pequena no banco (dois ids e uma chave), gravada em lotes e com limite por execução, então fica no tick. E-mail, push e WhatsApp em massa continuam fora do tick.

### 4.3 Pop-up

- Ao publicar, o servidor calcula quem está no segmento e grava `campaign_deliveries`; o job recalcula a cada 15 minutos enquanto o pop-up está no ar.
- A home pede `GET /api/notifications/summary?popup=1` depois de aparecer. O servidor junta a lista curta de pop-ups no ar (em cache por 60 s, invalidado ao publicar, pausar ou encerrar) com o estado daquele aluno e aplica as regras da seção 1.3 (`pickPopup` em `campaign-model.ts`).

### 4.4 Rotas do aluno

| Rota | Para quê |
|---|---|
| `GET /api/notifications?cursor=&filter=all\|unread` | lista do sino (20 por vez) |
| `GET /api/notifications/summary[?popup=1]` | número do sino e, na home, o pop-up da vez |
| `POST /api/notifications/read` | `{ seen: true }` ao abrir, `{ ids }` ou `{ all: true }` |
| `POST /api/notifications/[id]/click` | abriu o link (aceita `sendBeacon`) |
| `POST /api/notifications/[id]/response` | `{ response: "accepted" \| "declined" }`, uma vez só |
| `POST /api/popups/[id]/events` | `impressed`, `clicked`, `closed`, `dismissed`, `snoozed` (aceita `sendBeacon`) |

Todas exigem sessão, respondem `Cache-Control: private, no-store` e gravam um evento em `student_events` (`notification_read`, `notification_clicked`, `notification_responded`, `message_impressed`, `message_clicked`, `message_closed`, `message_dismissed`, `message_snoozed`), só com ids. Sem a migração aplicada, respondem listas vazias (a área do aluno não quebra antes da migração).

### 4.5 Áudio e gravação

- O áudio sobe por `POST /api/admin/communications/audio` (arquivo, até 10 MB; Server Action tem limite de 1 MB). O servidor confere o tipo pelos primeiros bytes do arquivo, não só pelo nome.
- A duração e a forma de onda (48 barras) são calculadas no navegador da equipe na hora de escolher ou gravar, e gravadas junto com o aviso; o aluno não baixa o áudio para desenhar a onda (`preload="none"`).
- Gravar no navegador precisa do microfone: o cabeçalho `Permissions-Policy` libera `microphone=(self)` só em `/admin`; a área do aluno continua com o microfone bloqueado.
- A CSP já aceitava áudio `https:`; o Supabase local (http) entrou no `media-src` como já estava no `img-src`, só para os testes.
- Disco (docs/20 §10.1): os áudios ficam no Storage do servidor e entram no backup diário. 10 MB por aviso é o teto; um aviso por semana com áudio dá cerca de 0,5 GB por ano.

### 4.6 Retenção e LGPD

- O sino mostra 90 dias. `prune_communication_history()` apaga, todo dia às 06:41 UTC, notificações e estados de pop-up com mais de 24 meses (docs/17 D8).
- Conta excluída leva junto as notificações e os estados de pop-up (chave com `on delete cascade`). Quem respondeu um comentário e depois excluiu a conta aparece como `Alguém`.
- Eventos e auditoria guardam só ids e contagens, nunca o texto do aviso ou do comentário.

---

## 5. Decisões tomadas

| # | Decisão | Por quê |
|---|---|---|
| C1 | O sino se chama **Notificações** (não "Lembretes") | vocabulário fechado do docs/17 §1.3 |
| C2 | Número = novas não vistas; bolinha = não lidas | o número some ao abrir (docs/17 §1.8.5, "lido ao abrir") sem perder o que o aluno ainda não abriu |
| C3 | Notificação de aviso aponta para o aviso; automáticas guardam o trecho | uma linha pequena por aluno e retirar do sino com uma ação |
| C4 | Segmento avaliado no servidor, em TypeScript, com os mesmos dados da lista de Alunos | uma definição só de ritmo, progresso e acesso; a conta vai para uma RPC quando passar de alguns milhares de alunos (o mesmo aviso de escala de `buildStudentIndex`) |
| C5 | Envio do sino no tick (ver 4.2) | não há fila de jobs instalada e a gravação é pequena e idempotente |
| C6 | Pop-up só na home, 1 por sessão e 1 a cada 24 h, sem exceção da equipe | docs/17 §1.8.1 e D12 |
| C7 | "Pedir resposta (Aceitar ou Recusar)" já existe para avisos da equipe | é o mesmo mecanismo que os convites da comunidade vão usar |
| C8 | Áudio em bucket público com nome por hash | como as imagens; o aviso não é conteúdo pago e o link não é adivinhável |
| C9 | Desfecho fixo "voltou a estudar em 7 dias" | o seletor de desfecho do docs/17 §1.8.2 fica para depois; o número já mede o que importa |

---

## 6. Fica para depois

- **Comunidade** (posts de texto, texto com áudio, vídeo, resultados dos alunos, gamificação) e **convites entre membros** no sino: o pedido de resposta já está pronto; falta quem cria o convite. Vídeo de aluno não fica no servidor da área: vai para Bunny ou Mux (AGENTS.md).
- **Salas ao vivo e webinários "tipo Zoom"** dentro da área, com comentários e números de retenção (momento de saída, retenção média e máxima, quem mais comentou): pede um estudo próprio (provedor de vídeo ao vivo, custo e escala) antes do desenho. Quando existir, o pop-up e o sino já levam o convite e o lembrete.
- Outros tipos do docs/17 §1.8.1: faixa no topo, card na home, destaque e toast.
- Canais: e-mail (pela fila `email_outbox`), push e WhatsApp, com a central de preferências `/perfil/notificacoes` e o descadastro sem login.
- Seletor de desfecho ("Como medir"), "Salvar quem converteu como segmento", aba "Avisos recebidos" no perfil do aluno, "Enviar aviso" a partir da lista de Alunos, de Comunidade › Top alunos e dos alertas de Hoje.
- Notificação em tempo real (hoje o número é atualizado a cada abertura de página e ao voltar para a aba, com intervalo mínimo de 60 s).

---

## 7. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/comunicacao-segmentos.test.mjs` | cada regra, grupos E/OU, ranking de comentadores, frases do segmento, limites do schema e conversão dos segmentos de Alunos |
| Unitário | `tests/comunicacao-avisos-modelo.test.mjs` | situações, ações por situação e permissão, aprovação acima de 500, agenda de São Paulo, frase de revisão, escolha do pop-up e seus limites, menção, trecho e cursor |
| Unitário | `tests/sino-do-aluno-modelo.test.mjs` | agrupamento por dia, número do sino e rótulos |
| Integração | `tests/integration/avisos-e-notificacoes.test.mjs` | criar, contar, enviar agora, agendar e o job, idempotência, ler, clicar, responder, retirar, teste para mim, aprovação, permissões e notificações de resposta e menção |
| Integração | `tests/integration/pop-ups.test.mjs` | quem vê, limite de 24 h, uma vez e até clicar, Lembrar depois, Não mostrar de novo, pausar, encerrar, janela e o recálculo pelo job |
| Ponta a ponta | `tests/e2e/produtor-envia-notificacao.spec.ts` | a equipe envia e a aluna vê o número, abre o sino e segue o botão |
| Ponta a ponta | `tests/e2e/aluno-ve-pop-up.spec.ts` | o pop-up aparece na home e Não mostrar de novo vale depois de recarregar |

---

## 8. Roteiro de conferência no ambiente de teste

1. Aplicar a migração `202610200001_communication_v1.sql` no Supabase da nuvem (CONTRIBUTING, passo 5).
2. Em `/admin/comunicacao/avisos`, **Novo aviso** → Notificação, título, texto, uma imagem e um áudio gravado, botão para uma página da área; Para quem: Todos os alunos; **Enviar teste para mim** e conferir no sino da sua conta.
3. Entrar com uma conta de aluno de teste: o sino mostra `1`; abrir, tocar o áudio, clicar no botão.
4. Criar um pop-up para "tem acesso a [um curso]" e **Publicar pop-up**; abrir a home com o aluno de teste: aparece em 3 s; **Não mostrar de novo**; recarregar: não volta.
5. Responder, como professor, um comentário do aluno de teste numa aula: o aluno recebe `Professor respondeu seu comentário` com o link da aula.
6. Agendar uma notificação para daqui a 5 minutos e ver a situação mudar de Agendado para Enviado (o tick do ambiente de teste precisa estar ligado, docs/21 §5).
