# 23. Comunicação v2: quem envia, tempo no sino, áudio ouvido, notificações seguintes e fluxos

Data: 21/10/2026. Pedido do produtor (20/10/2026), olhando a prévia do sino no editor: trocar o megafone do círculo pela imagem de quem envia (a escola, a própria foto ou a de um professor) e pôr junto com o título um ícone que diga o assunto; escolher quanto tempo a notificação fica no sino ("só um dia, uma semana, quantos dias ele quiser"); e montar "uma automaçãozinha de notificações": uma segunda notificação só para quem não abriu, não ouviu o áudio, não clicou, ou visitou a página mas não comprou, saindo X horas depois ou "faltando 3 horas" para a primeira vencer. Depois pediu que a onda do áudio fique verde quando o aluno ouviu tudo, como no WhatsApp.

Este documento registra o que foi construído sobre a Comunicação v1 (`docs/22`), as regras fixas, as decisões (V1 a V20) e o que fica de fora. Vale para qualquer trabalho em Comunicação, sino, pop-ups, notificações seguintes ou fluxos. Migração `202610200002_communication_v2.sql` (a `202610200001` não muda) e as correções da revisão em `202610210001_communication_v2_fixes.sql` (a `202610200002`, já aplicada na nuvem de teste, também não muda mais). Tabelas em `docs/05` (seção Comunicação), segurança em `docs/06` (seção Comunicação), arquitetura em `docs/04` (Comunicação v2), desenho em `docs/12`, decisões em `docs/09` e admin em `docs/17` §1.8. Muda uma decisão do `docs/17` §1.14: "automações encadeadas" saiu de "fora do MVP" por pedido explícito do produtor em 20/10/2026, só no sino (e-mail, tag e bônus continuam na fase 7).

> **Atualização (22/10/2026): Comunicação v3a** (`docs/24`, migração `202610220001`). Para as notificações seguintes e os fluxos: o conteúdo ganha **Como o aluno chega lá** (cartão clicável), **Permitir reações** (ligada em toda seguinte e todo passo novo) e a **enquete** (que, numa seguinte ou num passo, encerra quando a notificação sai do sino); a regra "O que fez com uma notificação" ganha `reagiu`, `votou na enquete` e `excluiu do sino` (seção 7); as escolhas rápidas ganham `não votou na enquete` e `não reagiu`, e toda escolha de "não fez" pula quem excluiu a notificação de cima do sino (seção 2.2); "clicou no botão" virou **foi para o destino** em toda a tela. A notificação **principal** enviada agora pode ser editada e excluída (`docs/24` §2.2 e §2.3); as seguintes continuam mudando pelo relatório.

---

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Quem envia** | o círculo da notificação mostra quem envia: o ícone da escola (padrão) ou a foto (ou as iniciais) e o nome de alguém da equipe; o megafone saiu | sino; editor, card "O que" |
| **Ícone ao lado do título** | 16 ícones e 5 cores, opcional, antes do título | sino, pop-up, notificações de fluxos |
| **Fica no sino por** | 1, 3, 7, 30 ou 90 dias (padrão), um tempo de 5 minutos a 90 dias (1 hora até os ajustes da v3a, `docs/24` §10) ou até uma data e hora; vencida, some do sino e dos números; `Termina em 3 h` quando falta menos de 1 dia | sino; editor, card "Quando" |
| **Áudio ouvido** | quatro estados na onda (não ouvido, tocando, ouvido até n %, ouvido em verde), guardados no servidor e válidos em outro aparelho | sino |
| **Depois desta notificação** | notificações seguintes configuradas no próprio editor: quando sai (depois do envio ou antes de vencer), para quem (o que o aluno fez ou não fez com a anterior) e o conteúdo, em até 3 níveis | `/admin/comunicacao/avisos/[id]` |
| **Fluxos** | sequências de notificações com regras: quem entra, Notificação, Condição (Sim/Não), esperas, Objetivo e números por passo | `/admin/comunicacao/fluxos` |
| **Ícone da escola** | a imagem do círculo quando a escola envia; padrão `/brand/icon-bunker.svg` | Área de membros › Marca |
| **Motor** | um motor só para notificações seguintes e fluxos: fase 2 do job `comunicacao` no tick de minuto, uma linha de trabalho por (passo, aluno) | `src/server/communications/flow-*.ts` |
| **Visitas de página** | última visita de cada aluno a cada página da área (e o clique em Comprar), só para as páginas que um fluxo no ar usa | `member_page_visits` |
| **"Enviada em seu nome"** | e-mail para a pessoa da equipe cujo nome e foto foram usados | fila `email_outbox`, tipo `sent_as` |

Vocabulário na tela (V19): **Fluxos**, **Notificação seguinte**, **Depois desta notificação**, **Quem envia**, **Ícone ao lado do título**, **Fica no sino por**, **Quem entra**, **Condição** (**Sim** / **Não**), **Esperar** / **Logo depois**, **Objetivo**. Como na v1, nunca "campanha", "público", "audiência", "evento" ou "oferta"; também nunca "automação", "gatilho" ou "lembrete" (lembrete colide com o "Lembrar depois" do pop-up, e o sino se chama Notificações, C1). "Notificações automáticas" continua sendo só o nome das de comentário (`docs/22` §1.2).

---

## 1. O que o aluno vê

### 1.1 Quem envia: o círculo e o nome

| Quem envia | Círculo (40 px) | Nome na linha de baixo |
|---|---|---|
| A escola (padrão) | o **Ícone da escola** (Marca). O padrão, `/brand/icon-bunker.svg`, fica centralizado sobre `#262626`; um ícone enviado preenche o círculo como foto de perfil. Se a imagem não abre: a logo, quando cabe no círculo; senão a inicial `B` | `Bunker707` |
| Alguém da equipe (em `admin_roles` na hora de ler) | a foto do perfil; sem foto, as iniciais | o nome do perfil; sem nome, `Equipe Bunker707` (nunca o e-mail) |
| Quem saiu da equipe ou excluiu a conta | como a escola | `Bunker707` |

- Quem envia é resolvido **na hora de ler** o sino: quem sai da equipe deixa de aparecer em todas as notificações que mandou, inclusive nas antigas, já na leitura seguinte. Sem cópia e sem limpeza.
- Sem selo no aviso da equipe: o megafone saiu como reserva do círculo e como selo. Os selos dos comentários ficam (balão e `@`); comentário sem autor mostra o ícone da escola com o selo do comentário.
- Linha de baixo numa linha só: o nome corta com reticências e `há 2 horas` e `· Termina em 3 h` nunca quebram (a 375 px a coluna de texto tem cerca de 267 px). O leitor de tela lê o nome inteiro (`Prof. Carlos Lima · há 2 horas`).

### 1.2 Ícone ao lado do título

- Opcional, **antes do título** e dentro do mesmo elemento: 16 px no sino, 20 px no pop-up, decorativo (`aria-hidden`). O nome acessível do cartão continua sendo só o título; sem ícone, o título fica igual ao da v1.
- Catálogo (o banco guarda só o id; os desenhos ficam em `src/components/member/notifications/notice-icons.tsx` e trocam sem migração; id desconhecido não desenha nada):

| id | Rótulo | Cor sugerida | id | Rótulo | Cor sugerida |
|---|---|---|---|---|---|
| `promo` | Promoção | Vermelho | `rocket` | Lançamento | Laranja |
| `gift` | Presente | Verde | `flame` | Em alta | Laranja |
| `calendar` | Agenda | Amarelo | `trophy` | Conquista | Amarelo |
| `live` | Ao vivo | Vermelho | `star` | Destaque | Amarelo |
| `lesson` | Aula nova | Branco | `clock` | Prazo | Amarelo |
| `book` | Material | Branco | `mic` | Áudio | Branco |
| `graduation` | Formação | Branco | `megaphone` | Aviso | Vermelho |
| `sparkles` | Novidade | Amarelo | `alert` | Importante | Amarelo |

- Cores (paleta do `docs/12`, sem azul nem roxo; todas com pelo menos 3:1 sobre o painel e sobre o fundo da não lida): Branco `#f4f4f5`, Vermelho `#e50914`, Laranja `#ff7a1a`, Amarelo `#fbbf24`, Verde `#10b981`.
- Vale no sino, no pop-up e nas notificações de fluxos. Sem rótulo extra ("Novo", "Urgente"): o ícone e o título dizem o assunto e a bolinha vermelha já diz "novo" (seção 9).

### 1.3 Tempo no sino e "Termina em"

- Cada linha de aviso tem o próprio fim (`notifications.expires_at`): o menor entre a data escolhida, a chegada + o tempo escolhido, a chegada + 90 dias e, na seguinte com `Até a notificação principal sumir`, o fim da principal para aquele aluno. Comentários e o que chega sem fim ganham 90 dias (gatilho do banco).
- Vencida, ela **some** da lista, do número do sino, das não lidas, do "Marcar todas" e do "abriu o sino"; nenhuma marcação muda uma linha vencida. Clique, resposta e áudio respondem 404; se o cartão ainda está na tela e o aluno responde, aparece `Esta notificação não está mais disponível.`; o botão continua levando à página (o clique só não é registrado).
- `Termina em 3 h`, em âmbar na linha de baixo, só quando faltam 24 h ou menos **e** o tempo total é de até 30 dias: nunca no padrão de 90 dias, depois de Aceitar/Recusar ou em comentário. Com 60 minutos ou mais, horas inteiras (`Termina em 23 h`); abaixo, minutos (mínimo `Termina em 1 min`). Calculado uma vez com a hora do servidor da lista (`asOf`): nada conta no navegador (C11).
- Rodapé: `As notificações ficam aqui por até 90 dias.`
- Mínimo 1 hora, máximo 90 dias (a janela do sino). A linha vencida fica no banco para o relatório até a retenção de 24 meses.

### 1.4 Áudio ouvido, como no WhatsApp

- O áudio é dividido em 48 trechos; um trecho conta quando o que tocou de verdade cobre pelo menos metade dele. **Ouvido = 44 trechos ou mais (90 %)**, a mesma definição da onda verde e da regra `ouviu até o fim`. Pular para o fim não conta; 1,5x e 2x contam. O servidor junta (OU) o que chega de cada visita e aparelho, e o valor só cresce: metade hoje e metade amanhã fica verde.

| Estado | Onda | Sinal além da cor | Nome do grupo para o leitor de tela |
|---|---|---|---|
| Nunca tocado | barras `white/30` | bolinha **branca** de 6 px antes do tempo | `Áudio do aviso, ainda não ouvido` |
| Tocando | até a posição em branco; o já ouvido depois dela `white/60` (verde, se já ouvido) | ícone de pausa | `Áudio do aviso` |
| Ouvido em parte | trechos ouvidos `white/60`, o resto `white/30` | — | `Áudio do aviso, ouvido até {n}%` |
| Ouvido | todas em `emerald-400` (`#34d399`) | `CheckCheck` verde e `Áudio ouvido` só para o leitor | `Áudio do aviso, ouvido` |

- A bolinha branca não se confunde com a vermelha de não lida (cor, lugar e tamanho diferentes). Uma barra da tela conta como ouvida com a maioria estrita dos seus trechos (2 de 4 não; 3 de 4 sim).
- Tocado e pausado antes de completar um trecho já é "ouvido em parte" (`ouvido até 0%`). A bolinha só some ao tocar: pular sem tocar não a tira.
- Otimista: ao chegar a 44 trechos a onda fica verde na hora, e o servidor confirma.
- Pop-up: o player é o da v1, sem bolinha e sem verde, e nada é guardado (aparece uma vez ou até o clique; não há visita seguinte para mostrar "ouvido").
- A prévia do editor mostra os estados pelas pílulas `Áudio na prévia`: `Não ouvido` / `Ouvido`.

### 1.5 Notificações seguintes e de fluxos

- Para o aluno é uma notificação comum, com remetente, ícone, título, texto, imagem, áudio, botão, resposta e tempo no sino próprios; chega como nova (número e bolinha). Nenhuma etiqueta "automática" e nenhuma ligação com a primeira, a não ser que a equipe escreva. Nada é reapresentado (a mesma notificação de novo saiu do pedido na segunda conversa com o produtor).
- Garantias (o editor diz isso em texto):
  - cada notificação de um fluxo chega no máximo uma vez a cada aluno; cada aluno passa por cada fluxo uma vez só;
  - **no máximo 3 notificações de fluxos e notificações seguintes por dia (São Paulo) para cada aluno, com pelo menos 1 hora entre elas**, também na virada da meia-noite. O que passa do limite do dia sai às 8h do dia seguinte; o que o intervalo segura espera o intervalo; nenhum dos dois sai se o prazo acabar antes (por exemplo "faltando 3 horas") ou depois de adiado 7 vezes. Avisos avulsos da equipe e notificações de comentário não contam;
  - quem atinge o **Objetivo** do fluxo (nas seguintes, a linha `Parar as notificações seguintes para quem tiver acesso a …`) não recebe mais nada dele;
  - **Retirar do sino** a principal para as seguintes;
  - a equipe nunca recebe nada de um fluxo (fica de fora antes de qualquer regra e de novo na hora do envio).
- O número do sino atualiza na página seguinte ou ao voltar para a aba (C11); nenhum pedido novo.

### 1.6 "Enviada em seu nome"

- Quando alguém escolhe outra pessoa da equipe em **Quem envia**, essa pessoa recebe um **e-mail**: a equipe entra direto no `/admin`, que não tem sino, então uma linha no sino quase nunca seria vista. Tipo `sent_as` da fila `email_outbox` (`docs/19`), uma vez por pessoa:
  - aviso: ao publicar (agora, agendado ou aprovado); chave `sent-as:campaign:<aviso>:<pessoa>`; assunto `Uma notificação saiu em seu nome`; texto `Ana Souza enviou a notificação “Oferta especial!” para 318 alunos em seu nome, com a sua foto e o seu nome.`;
  - fluxo (do construtor ou das notificações seguintes): ao ativar, aprovar ou aplicar uma mudança que traz alguém novo; chave `sent-as:flow:<fluxo>:<pessoa>`; assunto `Um fluxo de notificações usa o seu nome`; texto `Ana Souza ativou o fluxo “Boas-vindas”, que envia notificações em seu nome, com a sua foto e o seu nome.`;
  - depois, `Se você não combinou isso, fale com Ana Souza ou com o dono da escola.`; botão `Ver a notificação` / `Ver o fluxo` só para quem tem `messaging.write` (Professor, Suporte e Analista recebem sem link); quem publicou sem nome no perfil vira `Alguém da equipe`; rodapé `Você recebeu este e-mail porque faz parte da equipe da Bunker707 e foi escolhido para enviar notificações aos alunos.`
- Nunca para quem publicou nem para quem já saiu da equipe; conta sem e-mail fica só no log. Melhor esforço, depois da resposta (`after()`): falha vira log e a publicação vale. O limite diário da fila vale (o que passar sai no dia seguinte). Metadata só com ids e a contagem.
- A auditoria e o relatório completam: `Criada por Ana Souza · em nome de Carlos Lima`.

### 1.7 O que é registrado (invisível para o aluno)

- Áudio: começou, os 48 trechos ouvidos, a porcentagem e o "ouvido até o fim" (seção 5.1).
- `opened_at`: abriu de verdade (seção 5.4).
- Visitas: a última visita de cada aluno a cada página da área e o clique em Comprar, só enquanto um fluxo ativo ou pausado usa aquela página (seção 5.2). Só ids e chaves normalizadas, nunca endereço com query. 24 meses; conta excluída leva junto.

---

## 2. O que a equipe faz

### 2.1 Navegação e vocabulário

- Comunicação ganhou a aba e o subitem **Fluxos** (`/admin/comunicacao/fluxos`), entre Avisos e pop-ups e Webinários: `Sequências de notificações com regras: quem entra, o que recebe e quando.` É tela real (nunca moldura) e segue o período da barra superior.
- Endereços: `/fluxos` (`?situacao=ativos|rascunhos|encerrados`, `?pagina=`); `/fluxos/novo` (modelos); `/fluxos/[id]`: rascunho abre o construtor; ativo, pausado, encerrado ou concluído abre o relatório, e `?editar=1` abre a edição para quem pode mudar o fluxo no ar (para os outros, o relatório); `?passo=` escolhe o passo. `/avisos/[id]` de uma notificação de fluxo leva a `/fluxos/[fluxo]?passo=[passo]`.
- Cmd+K: `Novo fluxo` (para `messaging.write`); título no celular `Novo fluxo`.
- As páginas usam `requirePageArea("comunicacao")` mais `messaging.write`, como Avisos.

### 2.2 Editor de notificação (`/avisos/novo`, `/avisos/[id]`)

O conteúdo virou um componente só, `NoticeContentFields`, usado também na folha da notificação seguinte e no painel do construtor. Campos novos:

1. **Quem envia** (só notificação no sino; card "O que"). Lista: `Bunker707 (a escola)` (padrão), `Eu (Ana Souza)` e as outras pessoas da equipe em ordem alfabética, `Carlos Lima · Professor`, cada uma com o círculo que o aluno vê. Só quem está em `admin_roles`: sem nome digitado e sem foto avulsa; quem saiu da equipe e estava salvo aparece como `Carlos Lima · fora da equipe`. Uma dica por vez, nesta ordem:
   - a pessoa salva saiu da equipe: `Carlos Lima não está mais na equipe: a notificação sai como Bunker707.`;
   - `Eu` sem foto: `Você ainda não tem foto: o aluno vê as suas iniciais.` com `Colocar a minha foto em Perfil` (`/perfil`, nova aba); com essa dica na tela, o editor relê a equipe quando a janela volta ao foco;
   - outra pessoa: `Quando sair, Carlos Lima recebe um e-mail avisando: “Ana Souza enviou uma notificação em seu nome”.`, e sem foto também `Carlos Lima ainda não tem foto: o aluno vê as iniciais. Peça para Carlos Lima colocar a foto no Perfil da área de membros.`;
   - a escola, para quem tem `storefront.write`: `O círculo mostra o ícone da escola.` com `Trocar em Área de membros › Marca` (nova aba, para não perder o rascunho);
   - padrão: `O aluno vê a foto e o nome de quem envia. Só pessoas da equipe aparecem aqui.`

   O servidor confere ao salvar (400 no campo, `Escolha alguém da equipe.`) e ao publicar ou aprovar (422 `Carlos Lima não está mais na equipe. Escolha quem envia.`). Pop-up não tem Quem envia nem tempo no sino (`Quem envia e o tempo no sino valem só para notificações.`). A dica do Tipo virou `O aluno vê quando abrir o sino.`
2. **Ícone ao lado do título** (opcional; notificação e pop-up). Grupo de opções com `Sem ícone` e os 16 ícones: botões de 44 px com o nome numa dica ao passar o mouse ou focar; abaixo de 640 px, 64 × 56 px com o nome embaixo. O rótulo diz a escolha em texto (`Ícone ao lado do título · Promoção`). Escolhido um ícone, aparece `Cor do ícone · Vermelho` com as 5 cores e seus nomes; escolher o ícone já marca a cor sugerida. Teclado: Tab entra na opção marcada, setas andam e escolhem, Home e End vão ao primeiro e ao último. Dica: `Ajuda o aluno a reconhecer o assunto: uma etiqueta para promoção, um calendário para uma data marcada.`
3. **Fica no sino por** (card "Quando", agora `Agora ou numa data e hora, e quanto tempo fica no sino.`): `1 dia` · `3 dias` · `7 dias` · `30 dias` · `90 dias` (padrão) · `Outro` → `Por um tempo` (número + minutos, horas ou dias; começa em 2 dias; minutos desde os ajustes da v3a, `docs/24` §10) ou `Até uma data` (data e hora de São Paulo, o mesmo campo do agendamento). Dicas: `Depois disso a notificação some do sino do aluno, mesmo que ele não tenha aberto.` e, com 30 dias ou menos, `Quando faltar menos de 1 dia, o aluno vê “Termina em 3 h” ao lado da hora.` Erros: `No mínimo 5 minutos.` · `No máximo 90 dias.` · `Use de 5 minutos a 90 dias.` (até os ajustes da v3a, `Use de 1 hora a 90 dias.`) · `Escolha data e hora.` · `A notificação venceria antes de sair. Escolha um fim pelo menos 1 hora depois do envio.` · `O fim pode ser no máximo 90 dias depois do envio.` A frase de revisão ganha o tempo (`…, fica 3 dias no sino.`).
   - Agendada cuja data final ficou a menos de 1 hora do envio: o job cancela com `A notificação venceria antes de chegar.`
   - Duplicar com `Até uma data` que já passou (ou a menos de 1 hora) volta para `90 dias`, na notificação e em cada seguinte. O teste para mim de um rascunho com data vencida aparece por 1 hora; repetir o teste traz de volta como nova e zera o "abriu" e o áudio.

**Depois desta notificação** (card novo, só notificação no sino, entre "Quando" e "Revisão"): `Envie outra notificação só para quem fez, ou não fez, algo com esta.` Vazio: `Adicionar notificação seguinte`.

- **Linha de parada**, no topo assim que há uma seguinte: `Parar as notificações seguintes para quem tiver acesso a [produto]`, dica `Quem já tem ou ganhar acesso a Formação IA não recebe as notificações seguintes.` Quando o botão da notificação abre um produto, a primeira seguinte já marca a linha com ele. É guardada como Objetivo do fluxo da notificação: conferida antes de cada envio e a cada 15 minutos, então quem compra entre duas seguintes não recebe mais nada e quem já tinha acesso sai na primeira conferência.
- **Cada seguinte** é um cartão (`article` `Notificação seguinte 1`) com o resumo (`1 dia depois do envio · para quem viu no sino, mas não abriu`) e a linha do conteúdo (círculo, ícone, título, `Fica 3 dias no sino` ou `Fica no sino até a principal sumir`):
  - **Quando sai**: número + `minutos` / `horas` / `dias` + `depois do envio` / `antes de vencer` (no segundo nível, `depois do envio da anterior` / `antes de a anterior vencer`); uma linha a partir de 640 px, duas abaixo, controles de 44 px. Embaixo, a frase: `Sai 1 dia depois que a notificação principal chega ao aluno.`, `Sai 3 horas antes de a notificação principal sumir do sino (21 horas depois do envio).` ou, como nota e não erro, `Sai depois que a notificação principal já sumiu do sino.` Limites: depois do envio de 5 minutos a 60 dias, antes de vencer de 15 minutos a 60 dias, de 5 em 5 minutos (`Escolha de 5 minutos a 60 dias.` / `Escolha de 15 minutos a 60 dias.`).
  - **Para quem**: `Quem recebeu a notificação principal e…` com escolhas rápidas, só as que fazem sentido para o conteúdo da anterior. "Abrir" só é oferecido quando há o que abrir (áudio, botão, resposta ou texto longo com `Ver mais`): o sino mostra a notificação curta inteira, então numa só de texto curto não há como saber se o aluno abriu (V7).
    - `nem viu no sino` (sempre; `Quem ainda não abriu o sino vai ver as duas juntas quando abrir.`). É a escolha inicial quando não há o que abrir;
    - `viu no sino, mas não abriu` (com o que abrir; a escolha inicial) e `não abriu` (inclui quem nem abriu o sino), com `Abrir é tocar no cartão, em “Ver mais”, no áudio, no botão ou responder. “Marcar todas como lidas” não conta.`;
    - `viu no sino` (só sem o que abrir), com a nota `Esta notificação não tem áudio, botão, resposta nem texto longo: o aluno lê tudo no sino, então só dá para saber se ele viu.`;
    - com destino (desde a v3a o texto diz "destino", verdade nos três modos do cartão): `abriu, mas não foi para o destino`, `não foi para o destino` e `foi para o destino, mas ainda não tem acesso a [produto]` (foi E não tem acesso: quem já tem o produto nunca entra);
    - com destino numa página acompanhada da área (seção 5.2): `visitou a página para onde a notificação leva, mas ainda não tem acesso a [produto]` e `não visitou a página para onde a notificação leva`;
    - com áudio: `não começou a ouvir o áudio`, `não ouviu o áudio até o fim`, `ouviu o áudio até o fim`;
    - com resposta: `não respondeu`, `aceitou`, `recusou`;
    - v3a, com enquete: `não votou na enquete`; com reações: `não reagiu`;
    - `todos que receberam`;
    - `escolher por regras`: abre o construtor de regras do fluxo (seção 7), já preenchido com a escolha marcada; ao reabrir, uma regra igual a uma escolha rápida volta como essa escolha.
    - **v3a: quem excluiu a notificação de cima do sino não recebe as escolhas de "não fez"** (`não abriu`, `viu no sino, mas não abriu`, `não foi para o destino`, `abriu, mas não foi para o destino`, `não respondeu`, `não votou na enquete`, `não reagiu`, `não começou a ouvir o áudio`, `não ouviu o áudio até o fim`): elas ganham a regra `não excluiu do sino`, com a linha `Quem excluiu a notificação de cima do sino não recebe esta.` embaixo. `nem viu no sino`, `todos que receberam`, as positivas e as de página e produto ficam como estavam. **Seguinte salva pela v2**: continua abrindo na mesma escolha rápida (o formato antigo, sem `não excluiu do sino`, também é reconhecido) e continua enviando pelas regras antigas até alguém salvar de novo; o salvar seguinte grava o formato da v3a. A dica do "abrir" passou a `Abrir é tocar na notificação, em “Ver mais”, no áudio ou no botão, reagir, votar ou responder. “Marcar todas como lidas” não conta.` e "há o que abrir" também conta uma enquete (reações não: um texto curto com reações ainda não diz "não abriu").
  - **Contagem na hora** (500 ms depois de mexer; só números, nunca nomes): `Agora, 120 dos 318 que receberam se encaixam.`; antes do envio, `A contagem aparece depois do envio.`; erro, `Não foi possível contar agora.` com `Tentar de novo`.
  - **Editar notificação** abre a folha `Notificação seguinte 1` com o conteúdo inteiro (título, texto, imagem e áudio, botão, resposta, Quem envia, ícone, Fica no sino por) e a própria prévia; `Concluir` fecha. Abaixo de 768 px a folha ocupa a tela toda. `Enviar teste para mim` fica no cartão (salva antes).
  - **Fica no sino por** de uma seguinte ganha `Até a notificação principal sumir` (`… anterior …` no segundo nível). É o padrão quando `Quando sai` vira `antes de vencer` e o tempo ainda era o padrão de 90 dias: a seguinte "Faltam 3 horas" mostra `Termina em 3 h` e some junto com a principal, para cada aluno.
  - Menu do cartão: `Duplicar`, `Remover` (`Remover esta notificação seguinte?` / `As notificações seguintes que dependem dela saem junto.`) e `Adicionar notificação seguinte a esta` (até 3 níveis contando a principal; até 5 por nível).
- Prévia: com seguintes, as pílulas `Esta notificação` · `Seguinte 1` · `Seguinte 1.1` · `Seguinte 2` trocam o cartão desenhado (o mesmo `NotificationCard`, com remetente, ícone, `Termina em` e estados do áudio).
- Texto fixo no fim do card: `Para não cansar o aluno: no máximo 3 notificações de fluxos e notificações seguintes por dia para cada aluno, com pelo menos 1 hora entre elas. Se passar do limite do dia, sai às 8h do dia seguinte; se o prazo dela acabar antes, não sai. Até 5 notificações seguintes por notificação, em até 3 níveis. Cada aluno recebe cada notificação uma vez só.`
- `Ver como fluxo` (depois de salvar) abre o fluxo da notificação. Se o fluxo foi mudado no construtor para algo que o card não desenha (uma Condição, outra referência de tempo, mais de 3 níveis), o card mostra frases só de leitura, `Esta notificação tem passos que só aparecem no fluxo.` e `Editar no fluxo`. Objetivo diferente de um "têm acesso a" aparece como `Param para quem: {frase}`.
- Trocar o Tipo para Pop-up com seguintes pergunta antes (`Mudar para pop-up?` / `Mudar para pop-up remove as 2 notificações seguintes.`, no singular `Mudar para pop-up remove a notificação seguinte.`); ao salvar, as seguintes saem (o fluxo ainda era rascunho). No pop-up, `As notificações seguintes valem só para notificações no sino.`
- Salvar: `Salvar rascunho` grava a notificação e depois as seguintes. Se só as seguintes falham: `O rascunho foi salvo, mas as notificações seguintes não` / `Salve de novo. O que você escreveu continua aqui.` Antes do envio, as seguintes só mudam com a notificação em rascunho: o editor salva a notificação antes (agendada ou aguardando aprovação volta para rascunho, e o fluxo dela também); chamada direta com a notificação agendada responde 409 `Salve a notificação antes de mudar as notificações seguintes.` `saveNoticeDraft` devolve a versão nova do fluxo quando o salvar também o voltou para rascunho (`flowUpdatedAt`), e o editor manda essa para as seguintes (sem 409 falso). Sem erro de campo (409, 403), o banner mostra a frase do servidor. Quem envia cada seguinte também só pode ser da equipe (400 `Escolha alguém da equipe.` no campo da seguinte, antes e depois do envio). Uma escolha rápida que a notificação de cima não oferece mais (o áudio, o botão ou o texto longo saiu depois) fica marcada com `Esta escolha não vale mais para a notificação de cima. Escolha outra.` e não grava; a árvore recusa no servidor a regra de mensagem impossível (`A notificação escolhida não tem áudio.` / `… não tem botão.` / `… não pede resposta. Escolha outra regra.`), e a Condição nova no construtor começa por `viu` quando a notificação de cima não tem nada para abrir.
- Revisão: `Notificação para 318 alunos, enviada agora, fica 3 dias no sino. Depois: 2 notificações seguintes, que param para quem tiver acesso a Formação IA.`
- **Depois do envio**, a página da notificação é o relatório (v1), com a seção **Notificações seguintes**: os mesmos cartões, em edição preparada para quem tem `messaging.publish` (e `messaging.publish_large` acima de 500 que receberam), com `Alterações não aplicadas`, `Descartar` e `Aplicar alterações` (409 mantém o que foi escrito). A tela que abriu sem fluxo nenhum manda `expectedFlowUpdatedAt: null`: se outra tela criou as seguintes no meio, 409 em vez de gravar por cima; depois de aplicar, a entrada gravada (a principal nas regras) passa a valer na tela. A folha da seguinte diz `As mudanças valem quando você aplicar.` (no editor, `As mudanças ficam no rascunho até você salvar.`). Banner: `Esta notificação já saiu. As mudanças valem a partir de agora: uma notificação seguinte nova conta o tempo de quando cada aluno recebeu esta, e ninguém recebe a mesma notificação duas vezes.`
  - Seguinte nova de primeiro nível chega a todos que receberam a principal, contando de quando cada um recebeu (o motor completa as tarefas no tick, seção 4.3, passo 1); momento que já passou sai no próximo tick, dentro do limite do dia; prazo que passou não sai. A primeira seguinte de uma notificação que saiu sem nenhuma cria o fluxo já ativo. Seguinte nova de segundo nível vale para quem ainda não recebeu a anterior.
  - Sem permissão: só leitura com `Só quem pode publicar muda as notificações seguintes depois do envio.`; acima de 500 sem `publish_large`: `Para mudar um fluxo ativo para este segmento, peça a um dono ou administrador.`
  - Todas as linhas da principal vencidas: só leitura, `Esta notificação já saiu do sino de todos: não dá para adicionar notificações seguintes.` (a ação responde 409 `Esta notificação já saiu do sino de todos.`). Notificação retirada: só leitura, sem ações (409 `Esta notificação foi retirada do sino.`).
  - Remover uma seguinte com gente esperando: `Remover “Faltam 3 horas”?` / `40 alunos estão esperando por ela e não recebem mais. Quem já recebeu continua com ela no sino.`
- **Retirar do sino** de uma notificação com seguintes acrescenta `As notificações seguintes deixam de sair.` e a caixa `Retirar também as notificações seguintes que já saíram (120)`, marcada por padrão (e de novo a cada abertura). O número é o das linhas das seguintes no sino (sem testes), o mesmo que a caixa apaga, inclusive as de uma seguinte removida depois de sair; a lista mostra o mesmo número.
- Lista de Avisos: chip `+2 seguintes` ao lado do tipo; o ícone da mensagem, na cor dele, substitui o ícone do tipo quando não há imagem. As notificações de fluxo não aparecem na lista.
- Notificação de um fluxo (`flow_id` preenchido): toda ação da v1 responde 409 `Esta notificação faz parte de um fluxo. Abra o fluxo para mudar.`

### 2.3 Marca: Ícone da escola

- Card `Ícone da escola` depois de "Logo" (Área de membros › Marca): `Aparece no círculo das notificações que a escola envia. Use uma imagem quadrada.` Prévia do círculo de 40 px e de 64 px sobre `#262626`; dica `A imagem preenche o círculo, como uma foto de perfil. O símbolo padrão fica centralizado.`
- `Enviar imagem` (PNG, WebP ou SVG; JPEG não: `Formato não aceito. Use PNG, WebP ou SVG.`), `Usar o símbolo padrão` e `Ou cole o link do ícone`. Erros: `Use uma imagem quadrada (mesma largura e altura).` (proporção fora de 0,9 a 1,1) e `Use uma imagem de pelo menos 128 × 128 px.`
- SVG nunca é guardado como SVG: o navegador o desenha num PNG de 512 × 512, que sai como WebP de até 512 px como as outras imagens. No SVG só a proporção conta (`viewBox`, ou `width` e `height` em px); SVG sem proporção legível é recusado como não quadrado.
- Link colado: conferido no navegador quando abre em até 8 s (não quadrado é recusado); `.svg` não é medido; link que não abre é aceito (a prévia mostra a inicial e o sino cai na logo ou na inicial).
- Publicado com o resto da Marca (`PUT /api/admin/appearance`, `storefront.write`, toast `Marca publicada. Os alunos já veem o novo visual.`). Fica em `platform_settings.branding.schoolIcon`; sem a chave vale o símbolo padrão (voltar ao padrão apaga a chave). Trocar ou tirar a logo e mudar o estilo não apagam o ícone. Erros do servidor: corpo vazio `Informe a capa da home, a logo, o ícone da escola ou o estilo.`; texto vazio `Envie uma imagem ou informe uma URL para o ícone da escola.`; endereço inválido `O ícone da escola precisa ser um upload valido ou uma URL http(s).`

### 2.4 Lista de fluxos (`/admin/comunicacao/fluxos`)

- Cabeçalho `Fluxos` com `Novo fluxo`; pílulas `Todos` · `Ativos` · `Rascunhos` · `Encerrados` (`?situacao=`; ativos inclui pausados, aguardando aprovação e esperando a notificação; encerrados inclui concluídos).
- Quatro números: `Fluxos ativos` · `No fluxo agora` · `Notificações enviadas` · `Atingiram o objetivo` (sem dado, `—`). Os dois últimos contam do começo do período até agora: a RPC só recebe o início (um intervalo antigo personalizado conta também o que veio depois do fim).
- Colunas: Fluxo (com o chip `Da notificação “Oferta especial!”` nas seguintes de uma notificação), Quem entra (a frase, `≈ 318 alunos` e `e quem entrar depois` nos modos contínuos; `Recebeu “Oferta especial!”` nas seguintes), Situação (`Rascunho`, `Aguardando aprovação`, `Esperando a notificação`, `Ativo`, `Pausado`, `Encerrado`, `Concluído`), Entraram, No fluxo agora, Objetivo, Enviadas. Menu só com as ações possíveis (`Editar`, `Pausar` / `Retomar`, `Encerrar`, `Duplicar`, `Excluir`).
- A 375 px, cartões com nome, situação, `No fluxo agora 140` e `Pausar` / `Retomar` de 44 px no próprio cartão (`docs/17` §1.13).
- Vazio: `Nenhum fluxo ainda` / `Monte uma sequência de notificações que segue o que cada aluno faz.`; por filtro: `Nenhum fluxo ativo` / `Ative um rascunho ou crie um fluxo novo.`, `Nenhum rascunho` / `Crie um fluxo a partir de um modelo.`, `Nenhum fluxo encerrado` / `Os fluxos encerrados ou concluídos aparecem aqui.` `?pagina=` depois do fim volta à última página. Banco sem a 0002: aviso de atualização do banco (`202610200002`).

### 2.5 Construtor de fluxos (`/fluxos/novo`, `/fluxos/[id]`)

**Começo** (`/fluxos/novo`): `Como você quer começar?` com quatro modelos; nada é gravado até `Salvar rascunho` ou a ativação.

| Modelo | Quem entra | Passos |
|---|---|---|
| **Para quem não abriu** | Todos os alunos, `Quem está no segmento agora` | Notificação "Novidade na área" (Novidade, fica 7 dias, botão `Ver agora` para o produto, para haver o que abrir) → Esperar 1 dia → Condição "viram no sino e não abriram" → Sim: "Você viu a novidade?" (fica 3 dias); Não: fim |
| **Boas-vindas a quem ganhou acesso** | `têm acesso a [produto]`, `Só quem entrar no segmento a partir de agora` | "Boas-vindas!" → Esperar 2 dias → Condição "estudaram nos últimos 2 dias" → Não: "Comece pela primeira aula" (Aula nova) |
| **Promoção com prazo** | `não têm acesso a [produto]`; Objetivo `têm acesso a [produto]` | "Condição especial até sexta" (Promoção, fica 3 dias, botão para o produto) → Esperar 1 dia → Condição "clicaram no botão" → Sim: 3 h antes de vencer, "Faltam 3 horas" (Prazo, fica até a primeira sumir); Não: "Você ainda pode aproveitar" |
| **Começar do zero** | Todos os alunos | só Quem entra; `Toque em + para adicionar a primeira notificação.` |

O produto dos modelos precisa ser escolhido antes de **salvar** (o schema recusa a lista vazia com `Escolha pelo menos um produto.` e o botão sem destino com `Escolha para onde o botão leva.`); a ativação também confere (`Escolha o produto.`).

**A partir de 1024 px**: duas colunas. À esquerda, o desenho: cartões de 320 px ligados por conectores, com rolagem lateral própria (a página nunca rola de lado). À direita, o painel do passo (400 px, fixo). Sem passo escolhido, o painel mostra o fluxo: `Nome do fluxo` (até 80, só a equipe vê), Quem entra, `Objetivo (opcional)` e a frase de revisão; o título do topo é um botão que abre esse painel no nome. Topo: rascunho com `Salvar rascunho` e `Ativar fluxo` / `Enviar para aprovação`; no ar, `Alterações não aplicadas` + `Descartar` + `Aplicar alterações` e o menu com `Pausar`, `Encerrar`, `Duplicar`.

**Abaixo de 1024 px e a 375 px**: uma coluna de cartões; cada Condição mostra as pílulas `Sim (120) | Não (160)` e só o lado escolhido; tocar num cartão abre o painel em tela cheia com `Concluir`; as ações secundárias do topo ficam em "Mais ações"; alvos de 44 px. No celular, ver, pausar, retomar, mudar textos e esperas são de primeira classe; montar do zero funciona, mas é pensado para o computador.

**Cartões** (cada um é um botão: `Quem entra: frase`, `Notificação: título`, `Condição: frase`):

- **Quem entra**: a frase, `≈ 318 alunos agora` e o modo: `Quem está no segmento agora` (`Entram todos de uma vez ao ativar.`), `Quem está agora e quem entrar depois` (`Quem passar a se encaixar entra em até 15 minutos.`), `Só quem entrar no segmento a partir de agora` (`Quem já se encaixa ao ativar fica de fora. Bom para “ganhou acesso ao produto”.`), e o texto fixo `Cada aluno passa por este fluxo uma vez só.` Depois de ativar, o modo não muda; no modo `Quem está no segmento agora` as regras também não (`Neste fluxo, quem entra foi decidido ao ativar. Duplique para mudar.`).
- **Notificação**: círculo, ícone, título, `Fica 3 dias no sino` e, com filtro, a frase no plural (`Só para alunos que não abriram a notificação “X”`).
- **Condição**: a frase (`Alunos que abriram a notificação “Oferta especial!”`) e as saídas **Sim** e **Não**; com espera, `Espera até ser Sim, por no máximo 2 dias`.

**Conectores** levam a espera do passo de baixo (`Logo depois`, `Esperar 1 dia`, `Esperar 3 h`, `3 h antes de “Oferta especial!” vencer`) e um `+` de 44 px (`Adicionar passo aqui`) com o menu `Notificação` ou `Condição (Sim ou Não)`. O passo novo nasce com `Esperar 1 dia` depois de uma notificação e `Logo depois` depois de Quem entra ou de uma Condição; a Condição nova começa com "abriu" na notificação mais próxima acima (ou sem regra), a notificação nova começa vazia. No rascunho, inserido no meio, o que vinha depois desce para baixo do passo novo (numa Condição, no Sim: `O que vinha depois ficou no caminho Sim.`). **Num fluxo no ar, o `+` no meio cria um caminho paralelo**: mover os passos de baixo seria mudar a ordem, que é recusada (seção 2.7). Sim e Não lado a lado (Sim à esquerda); lado vazio termina em `Fim: nada mais para quem chega aqui.`; a partir do terceiro nível, pílulas.

**Painel da Notificação**: o conteúdo inteiro com Fica no sino por (com `Até “X” sumir` quando o passo conta de uma notificação, padrão em "antes de vencer"), Quando, `Só para quem… (opcional)` (`Quem não combina não recebe esta notificação e para aqui neste caminho. Para continuar o fluxo com quem não combina, use uma Condição.`) e `Enviar teste para mim`.

**Painel da Condição**: as regras (`Todas as regras` / `Qualquer regra`, um nível de grupo), `Esperar até ser Sim` com `por no máximo [2] [dias]` (`Quem não chegar ao Sim nesse tempo segue pelo Não. Conferimos a cada 15 minutos.`) e Quando.

**Quando**: `Logo depois`; `Esperar` (minutos, horas ou dias, desde o passo anterior); `Antes de uma notificação vencer` (uma das notificações acima no caminho); `Depois do envio de` (em `Mais opções`). Esperas de 5 minutos a 60 dias, de 5 em 5; "esperar até" de 15 minutos a 30 dias; "antes de vencer" a partir de 15 minutos e menor que o tempo no sino daquela notificação (`A notificação “X” fica só 1 dia no sino. Escolha menos de 1 dia antes de vencer.`; conferido quando o tempo dela é uma duração ou o padrão, porque com "até uma data" ou "até a principal sumir" ele só se sabe na hora).

**Objetivo (opcional)**: `O aluno sai do fluxo quando…` + regras (as que fazem sentido sem uma mensagem: produto, ganhou acesso, visita de página, progresso…). `Quem atingir o objetivo não recebe mais nada deste fluxo.` Com Objetivo "têm acesso a Y" e o segmento sem excluir Y: `Quem já tem acesso a Y entra e sai na hora. Adicionar “não têm acesso a Y” ao segmento?` com `Adicionar`.

**Frase de revisão** (no painel e na confirmação de ativar): `Fluxo para 318 alunos agora e quem entrar depois, com 3 notificações e 1 condição. Sai quando o aluno tiver acesso a Formação IA.`

**Remover** (menu do passo, `Remover passo`): Notificação, `Remover “título”?` / `As notificações e condições abaixo dela saem junto.` (no ar e com gente esperando: `12 alunos estão esperando este passo. Ao remover, eles param aqui neste caminho. Quem já recebeu continua com ela no sino.`); Condição, `Remover a condição?` / `Escolha o caminho que fica.` (com gente esperando: `12 alunos estão esperando esta condição e param aqui.`), com `Manter o caminho “Sim”`, `Manter o caminho “Não”`, `Remover tudo daqui para baixo` e `Cancelar`.

**Validação** (o servidor decide de novo; a tela escolhe o passo com erro e põe o foco no campo):

| Problema | Texto | Bloqueia |
|---|---|---|
| Notificação sem título | `Escreva um título.` | salvar |
| Condição sem regra | `A condição precisa de pelo menos uma regra.` | salvar |
| Regra sobre uma notificação que não vem antes no caminho | `Esta regra confere uma notificação que não vem antes dela no caminho.` | salvar |
| "Antes de vencer" de uma notificação que não vem antes | `Escolha uma notificação que vem antes deste passo no caminho.` (sem nenhuma: `Escolha a notificação.`) | salvar |
| Passo abaixo de Condição sem lado | `Escolha o caminho Sim ou Não.` | salvar |
| "Até a principal sumir" num passo que conta do anterior | `Escolha quando ela sai em relação a uma notificação.` | salvar |
| "Página do botão" com botão para fora da área | `O botão desta notificação leva para fora da área: use “clicou no botão”.` | salvar |
| "Página do botão" numa página da área não acompanhada | `Esta página não é acompanhada: use “clicou no botão”.` | salvar |
| Mais de 20 passos | `Use no máximo 20 passos (notificações e condições).` | salvar |
| Mais de 8 passos em sequência | `O fluxo vai até 8 passos em sequência.` | salvar |
| Espera fora do limite | `Escolha de 5 minutos a 60 dias.` | salvar |
| "Esperar até" fora do limite | `Escolha de 15 minutos a 30 dias.` | salvar |
| Objetivo marcado sem regra | `O objetivo precisa de pelo menos uma regra.` | salvar |
| Produto do modelo não escolhido | `Escolha pelo menos um produto.` (salvar) / `Escolha o produto.` (ativar) | salvar e ativar |
| Nenhuma notificação | `Adicione pelo menos uma notificação.` | ativar |
| Segmento vazio no modo `Quem está no segmento agora` | `Nenhum aluno está neste segmento agora.` | ativar |
| 20 fluxos do construtor ativos | `Já há 20 fluxos ativos. Encerre um antes de ativar outro.` | ativar |
| Caminho que termina sem notificação | `Este caminho termina sem nenhuma notificação.` | só aviso no cartão |

### 2.6 Ativar, pausar, retomar, encerrar

| Ação | Quem | Confirmação | O que acontece |
|---|---|---|---|
| **Ativar fluxo** | `messaging.publish`; acima de 500 no segmento agora, `messaging.publish_large` | `Ativar o fluxo?` / `318 alunos entram agora. Os primeiros passos começam em até 1 minuto.` (contínuo: `… e quem entrar no segmento depois entra em até 15 minutos.`; `Só quem entrar…`: `Ninguém entra agora: só quem passar a se encaixar daqui em diante.`) [`Cancelar`] [`Ativar`] | salva antes; numa transação, as notificações do fluxo viram `sent` (com `sent_at`) e só depois o fluxo fica ativo; e-mail `sent_as`; auditoria `communication.flow_activated`. A entrada acontece no tick |
| **Enviar para aprovação** | `messaging.write` sem a permissão acima | — | `Aguardando aprovação`, banner `Aguardando aprovação de um dono ou administrador.`; para quem aprova, `Aprovar e ativar` / `Recusar` (recusar devolve para rascunho: `Pedido recusado. O fluxo voltou a rascunho.`). Salvar um fluxo aguardando aprovação volta para rascunho: `Salvar uma mudança volta o fluxo para rascunho e cancela o pedido.` O pedido é cancelado antes de qualquer conteúdo mudar no lugar (rascunho também toma a versão antes): uma gravação que o banco recusa deixa a versão nova, e quem aprova com a versão que revisou recebe 409 |
| **Pausar** | `messaging.publish` | `Pausar o fluxo?` / `Ninguém entra e nada sai enquanto estiver pausado. As esperas continuam contando: ao retomar, o que venceu sai na hora, respeitando o limite diário.` [`Pausar`] | as tarefas pendentes ficam fora das sondagens e da reserva; um lote no meio termina antes |
| **Retomar** | `messaging.publish` (acima de 500 agora, `publish_large`; senão 403 `Este fluxo passou de 500 alunos. Para retomar, peça a um dono ou administrador.`) | — | o que venceu roda; "antes de vencer" com prazo passado termina como `venceu o prazo` |
| **Encerrar** | `messaging.publish` | `Encerrar o fluxo?` / `Ninguém mais entra e nada mais sai. As notificações já enviadas continuam no sino. Não dá para desfazer.` | tarefas pendentes e reservadas canceladas; passagens encerradas |
| **Duplicar** | `messaging.write` | — | rascunho `{nome} (cópia)` com passos e conteúdos novos e as referências refeitas |
| **Excluir** | `messaging.write`; só Rascunho, Aguardando aprovação, Encerrado ou Concluído (senão 409 `Encerre o fluxo antes de excluir.`) | `Excluir o fluxo?` / `Some da lista. As notificações já enviadas continuam no sino.` | exclusão lógica |

Toasts: `Fluxo ativo. Os primeiros passos começam em até 1 minuto.` · `Fluxo enviado para aprovação.` · `Fluxo pausado. Nada sai até você retomar.` · `Fluxo retomado.` · `Fluxo encerrado.` · `Fluxo duplicado.` · `Fluxo excluído.` · `Alterações aplicadas.` · `Rascunho salvo.` · `Notificação retirada do sino.` · `Teste enviado para o seu sino.`

**Fluxo de uma notificação** (as seguintes): segue a notificação. Publicar ou aprovar a notificação ativa o fluxo junto (ou o põe em aprovação com ela), antes do envio; se o envio falha, o fluxo volta para rascunho. Cancelar o agendamento, recusar o pedido e salvar a notificação agendada voltam o fluxo para rascunho; Retirar do sino encerra (`source_withdrawn`); Excluir exclui (`source_deleted`); Duplicar copia. O construtor desse fluxo (`Ver como fluxo` ou `Editar no fluxo`) é o mesmo, com: banner `Este fluxo segue a notificação “X”: ele começa quando ela sai.` e `Abrir a notificação`; Quem entra só de leitura (`Recebeu a notificação “X”`); passos e Objetivo editáveis (é assim que a notificação ganha o que o card não desenha); antes do envio, com a notificação em rascunho, `Salvar` (sem `Ativar fluxo` nem `Enviar para aprovação`: `activateFlow` responde 409 com o texto do banner); com a notificação agendada ou aguardando aprovação (`Esperando a notificação`), só leitura com `A notificação ainda não saiu: as notificações seguintes mudam na própria notificação.` e só `Abrir a notificação` na lista e no relatório: gravar pelo construtor responde 409 `Salve a notificação antes de mudar as notificações seguintes.` (a aprovação cobre exatamente o que foi revisado) e `Pausar`, `Retomar` e `Encerrar` respondem 409 com o texto do banner (o fluxo segue a notificação; o banner `Aguardando aprovação` com `Salvar uma mudança … cancela o pedido.` é só do fluxo do construtor); no ar, `Aplicar alterações` e o menu `Pausar` / `Retomar`, `Encerrar`, `Abrir a notificação`, sem `Duplicar` nem `Excluir` (são da notificação). Se o job cancela a notificação agendada (venceria antes de chegar, ou a terceira falha), o fluxo dela termina junto (`source_withdrawn`). Publicar ou aprovar regrava as páginas acompanhadas com o botão atual da notificação (trocar o botão depois de gravar as seguintes não deixa a página antiga). O nome é `Seguintes de “{título}”`.

### 2.7 Editar um fluxo no ar (ou pausado)

As mudanças são preparadas: o construtor (ou a seção "Notificações seguintes" do relatório) guarda uma cópia de trabalho com `Alterações não aplicadas`; `Aplicar alterações` manda a árvore inteira com a versão, numa transação. Conflito: 409 `Este fluxo mudou em outra tela há instantes. Recarregue a página para ver a versão atual.`, mantendo a cópia. Banner: `Este fluxo está ativo. As alterações valem quando você aplicar: quem já passou de um passo não recebe de novo; passos novos valem para quem chegar até eles daqui em diante.` O motor gravando (contagem, faixas conferidas, varredura) nunca dá 409 em quem está com o editor aberto.

| Mudança | Pode | Efeito |
|---|---|---|
| Conteúdo de uma notificação (texto, imagem, áudio, botão, resposta, Quem envia, ícone, tempo no sino; desde a v3a também Como o aluno chega lá, Permitir reações e a enquete) | sim | cria uma **versão nova** já enviada (a enquete de um passo não tem **Encerrar enquete**: encerra quando a notificação sai do sino de cada aluno; votos e reações ficam na linha de cada um e o relatório do passo soma as versões pelo id da opção); quem recebeu fica com a dele; ninguém recebe o passo duas vezes. Nota: `Esta notificação já chegou a 120 alunos. Mudar cria uma versão nova: quem já recebeu continua com a anterior.` |
| Quanto esperar (`Esperar 1 dia` → `2 dias`, `3 h antes` → `1 h antes`, máximo do "esperar até") | sim | quem está esperando é reconferido e reagendado a partir de quando chegou (`Vale também para quem já está esperando, contando de quando cada um chegou.`); se o novo momento já passou, roda no próximo tick |
| De onde a espera conta (passo anterior, envio ou fim de uma notificação, ou qual notificação) | **não**, num passo com gente esperando | 422 `Para mudar a referência de tempo, remova este passo e crie outro.` |
| "Só para quem…" e regras de Condição | sim | vale na próxima conferência; quem já passou da Condição não muda de caminho |
| Passo novo | sim | só para quem chegar até ele daqui em diante; exceção: seguinte nova de primeiro nível de uma notificação, que vale para todos que a receberam (seção 2.2) |
| Remover passo | sim, com a confirmação | tarefas dele e de baixo canceladas (`removed`); o que chegou fica; os números ficam como `Passo removido em 21/10` |
| Remover Condição mantendo um caminho | sim | o caminho mantido sobe um nível; quem esperava na Condição para ali |
| Mover passo ou trocar Sim ↔ Não | **não** | 422 `Para mudar a ordem, remova e crie de novo.` |
| Regras de Quem entra | contínuo: sim (`≈ 46 alunos entram com as novas regras.`, com a contagem do segmento novo); `Só quem entrar…`: sim (quem já combina com as regras novas fica de fora na próxima faixa e só entra quem passar a combinar depois); `Quem está no segmento agora`: **não** | 422 `Neste fluxo, quem entra foi decidido ao ativar. Duplique para mudar.` |
| Jeito de entrar (modo) | **não** | 422 `O jeito de entrar não muda depois de ativar. Duplique para mudar.` |
| Objetivo | sim | vale na próxima conferência e na varredura de 15 minutos (pode tirar quem já está dentro) |
| Regra de visita a uma página que nenhum fluxo no ar acompanhava | sim | nota `A visita só é registrada enquanto um fluxo no ar usa esta página: conta a partir de quando você aplicar.` (a nota aparece sempre que um filtro ou Condição no ar tem regra de visita) |
| Nome | sim | — |

Quem aplica: `messaging.publish`, mais `messaging.publish_large` quando quem entra passa de 500 (recontado se as regras mudaram; no fluxo de uma notificação, quem a recebeu). Senão 403 `Para mudar um fluxo ativo para este segmento, peça a um dono ou administrador.` Mudança no ar nunca vira pedido de aprovação (C13). Sem `messaging.publish`, o fluxo no ar é só leitura: `Só quem pode publicar muda um fluxo no ar. Duplique para criar outro.` A chave `Mostrar números` começa desligada na edição e ligada no relatório.

### 2.8 Relatórios

**Todo relatório de notificação** (avulsas também), pela RPC nova `communication_campaign_engagement`:

- funil `Para quem → Viram → Abriram → Clicaram → Voltaram a estudar (7 dias)`, com `Abriram` (base `de quem viu`; só na notificação, pop-up não tem linha por aluno); Clicaram e Voltaram a estudar continuam com a base de quem viu;
- com áudio, `Começaram o áudio 120` e `Ouviram até o fim 90` (base `de quem abriu`);
- `Quem envia: Criada por Ana Souza · em nome de Carlos Lima` quando quem envia é uma pessoa (com nota quando ela não está mais na equipe);
- a seção **Notificações seguintes** (seção 2.2), com os números de cada seguinte.

**Relatório do fluxo**, no desenho e na tabela acessível embaixo (`Números por passo`):

- **Quem entra**: `Entraram 318` (`12 hoje`) · `No fluxo agora 140` · `Atingiram o objetivo 45` · `Terminaram 133`; no fluxo de uma notificação, `Receberam a notificação principal 318` e o funil dela.
- **Notificação**: `Chegaram 300` · `Esperando 12` · `Receberam 260` · `Viram no sino 220` · `Abriram 180` · com áudio `Começaram o áudio` e `Ouviram até o fim` · com botão `Clicaram no botão` · com botão para página acompanhada `Visitaram a página do botão` · com resposta `Aceitaram` / `Recusaram` · `Voltaram a estudar em 7 dias`. Depois `Não receberam 28`, aberto em `fora do filtro · atingiram o objetivo antes · venceu o prazo · limite do dia · passo removido, retirado ou fluxo encerrado` (um só número para passo removido, passo retirado do sino, `Encerrar` e a notificação principal retirada) e, quando há, `falharam` (Chegaram = Esperando + Receberam + Não receberam, também nas notificações seguintes). `limite do dia` tem a ajuda `Não saiu por causa do limite de 3 por dia (ou de 1 hora entre elas): o prazo acabou antes, ou ficou para depois 7 vezes.`; e `Adiadas agora pelo limite do dia 3`.
- **Condição**: `Chegaram 300` · `Sim 120` · `Não 160` · `Esperando 20`.
- Cada passo do funil mostra a parte do anterior; sem dado, `—`. Linha de fila só quando há tarefas atrasadas mais de 10 minutos: `Algumas notificações estão saindo com atraso (fila de 1.240).` Notas da situação (pausado, concluído, encerrado, esperando a notificação).
- Menu do passo de notificação: `Retirar do sino` (`messaging.publish`): `Retirar “X” do sino?` / `Some para os 120 alunos que receberam e não sai mais para ninguém. Quem estava esperando por ela para aqui neste caminho.`

### 2.9 Quem pode e a regra dos 500

| Permissão | Fluxos e notificações seguintes |
|---|---|
| `messaging.write` | ver Fluxos; criar e editar rascunhos (fluxos e seguintes de uma notificação em rascunho); duplicar; excluir (rascunho, aguardando aprovação, encerrado, concluído); teste de um passo para si; pedir a ativação (vira pedido de aprovação sem a permissão de baixo) |
| `messaging.publish` | ativar até 500; pausar, retomar, encerrar; aplicar mudanças no ar (ou nas seguintes de uma notificação enviada) até 500; retirar um passo do sino |
| `messaging.publish_large` | ativar, retomar ou aplicar mudanças acima de 500; aprovar ou devolver o pedido de outra pessoa |

- **Contagem**: o tamanho do **segmento de entrada agora**, em todos os modos (`Só quem entrar…` também conta quem está lá hoje: fecha a brecha de um fluxo que contaria 0). Conferida ao ativar, aprovar, retomar e ao mudar as regras de entrada. No fluxo de uma notificação vale o número dela: a aprovação da notificação cobre as seguintes (elas só alcançam parte de quem a recebeu). O número é o maior entre os que já receberam e o segmento contado no envio: num envio grande cortado pelo orçamento do tick (ainda `sending`), o parcial nunca abre a porta para quem não pode publicar para mais de 500.
- **Crescimento**: um fluxo contínuo pode passar de 500 sem nova aprovação (C12); a regra volta ao editar e ao retomar (403, C13).
- **Auditoria** (só ids e contagens, `entity_type = communication_flow`): `communication.flow_saved`, `flow_approval_requested`, `flow_approved`, `flow_rejected`, `flow_activated`, `flow_changes_applied` (`revision`, `removed_nodes` e a quantidade de versões novas), `flow_paused`, `flow_resumed`, `flow_ended`, `flow_duplicated`, `flow_deleted`, `flow_step_withdrawn`, `communication.follow_ups_saved`. Quem envia vai na metadata: `sender_user_id` nos avisos (também em `approval_requested`) e a lista `sender_user_ids` nos fluxos.
- Professor, Suporte e Analista continuam sem ver Comunicação; o professor escolhido como remetente sabe pelo e-mail (seção 1.6).

### 2.10 Limites fixos (texto, nunca campo)

| Limite | Valor | Onde aparece |
|---|---|---|
| Notificações de fluxos e seguintes por aluno por dia de São Paulo (avisos avulsos e comentários não contam) | 3, com pelo menos 1 h entre elas (também na virada do dia); passou do limite do dia, sai às 8h do dia seguinte; segurada pelo intervalo, espera o intervalo; não sai (`limite do dia`) se isso cair depois do prazo ou depois de 7 adiamentos | card das seguintes e cartão Quem entra; o caso dos 7 adiamentos na ajuda do relatório |
| Passagens por aluno em cada fluxo | 1 | `Cada aluno passa por este fluxo uma vez só.` |
| Passos por fluxo / em sequência | 20 / 8 | validação |
| Esperas | 5 min a 60 dias (de 5 em 5); "esperar até" 15 min a 30 dias | validação |
| Seguintes por notificação / níveis | 5 por nível, 20 no total / 3 níveis (com a principal) | texto do card |
| Fluxos do construtor ativos ao mesmo tempo | 20 (os de notificação não contam) | validação |
| Tempo no sino | 5 min a 90 dias (1 h até os ajustes da v3a, `docs/24` §10) | validação e check `campaigns_validity_v3` |
| Horário de silêncio | nenhum no sino (só é visto quando o aluno abre; sem push e sem som) | só aqui; chega com push e e-mail (`docs/17` §1.8.1 já diz 08–21 h para e-mail) |

---

## 3. Dados (migração `202610200002`)

Colunas e índices em `docs/05` (seção Comunicação). Em resumo:

- `campaigns` ganha `sender_user_id` (nulo = a escola; `on delete set null`), `icon` + `icon_color` (ids do catálogo; o banco confere só o formato), `validity_minutes` (60 a 129.600 na v2; 5 a 129.600 desde a `202610220002`, `docs/24` §10) ou `valid_until` (exclusivos; os dois nulos = 90 dias) e `flow_id` + `flow_node_id` (conteúdo de um passo; situação só `draft`, `sent` ou `canceled`; fora da lista de avisos). Quem envia, tempo no sino e passo de fluxo são só da notificação; o pop-up ganha só o ícone.
- `notifications` ganha `expires_at` (NOT NULL; o gatilho `set_notifications_expiry` põe `created_at + 90 dias` quando o app não manda; check `expires_at > created_at`), `opened_at`, `audio_started_at`, `audio_heard` (48 × "0"/"1"), `audio_heard_percent`, `audio_completed_at` e `flow_id` + `flow_node_id` (chave `flow:<passo>`: uma vez por aluno). `flow_id` é `on delete cascade` (com `set null`, apagar de verdade um fluxo com linhas entregues falhava no check `notifications_flow_v2`; o app nunca apaga fluxo, só exclui com `deleted_at`). O check `notifications_engagement_v2` exige áudio começado → aberto e ouvido → começado, mas **não** aberto → lido: o app sempre grava `read_at` junto com `opened_at`, e a linha aberta pode voltar a "não lida" (os testes da v1 fazem isso).
- Tabelas novas: `communication_flows` (o fluxo: origem `builder` ou `notice`, situação, quem entra e o modo, Objetivo, `watched_page_keys`, versão), `communication_flow_nodes` (a árvore: entrada, notificação, condição; quando, filtro, `expire_with_anchor`, "esperar até"), `communication_flow_runs` (a passagem de cada aluno, uma por fluxo), `communication_flow_tasks` (o trabalho por (passo, aluno): `anchor_at`, `due_at`, `deadline_at`, `not_before`, `deferrals`, `flow_active`, reserva e resultado) e `member_page_visits` (última visita por (aluno, página)).
- RPCs (só `service_role`, `security invoker`): 7.1 `communication_claim_flow_tasks`, 7.2 `communication_enroll_flow`, 7.3 `communication_enroll_notice_recipients`, 7.4 `communication_apply_flow_results`, 7.5 `communication_save_flow`, 7.6 `communication_wake_flow_tasks`, 7.7 `communication_flow_stats`, 7.8 `communication_flow_node_stats`, 7.9 `communication_flow_batch_facts`, 7.10 `communication_campaign_engagement`, 7.11 `communication_record_notification_audio`, 7.12 `communication_overview` (mesmo retorno; "Avisos ativos" passa a contar os fluxos no ar), 7.13 `communication_change_flow_state`, 7.14 `communication_withdraw_flow_step` e 7.15 `communication_release_flow_tasks` (devolve um lote que falhou antes de aplicar, devolvendo a tentativa). `communication_campaign_stats` não muda (um `create or replace` não troca as colunas).
- Retenção: `prune_communication_history()` também apaga tarefas terminadas, passagens de fluxos encerrados ou excluídos e visitas com mais de 24 meses (seção 5.5).
- Aplicação: idempotente, sem `drop … if exists` e sem `drop constraint`; gatilhos com `create or replace trigger`; checks em blocos `if not exists`; seções 1 a 8 pelo MCP do Supabase (em partes, se preciso) e a seção 9 (retenção, com `delete` dentro da função) pelo SQL Editor ou `psql`. **Aplicada antes do deploy que a usa** (não há volta para as colunas da v1; seção 11 e `docs/21` §9).

---

## 4. Motor (um só para seguintes e fluxos)

### 4.1 Modelo

Um fluxo é uma árvore. A raiz é a entrada; no fluxo de uma notificação ela representa a notificação de origem (as linhas `campaign:<id>` dela são a "mensagem" da entrada). Cada outro passo tem um **quando** (`anchor` + `offset_minutes`) e, se for notificação, um filtro opcional. O estado de um aluno é o conjunto das suas tarefas: terminar a entrada, enviar uma notificação ou decidir uma Condição cria as tarefas dos filhos (todos, ou só o lado escolhido). Notificação filtrada, vencida, cortada pelo limite ou retirada não cria filhos: o caminho acaba ali. Único complemento: a seguinte de primeiro nível criada depois do envio ganha tarefas para quem já recebeu, cada uma contando da própria linha. A tarefa guarda só `anchor_at`; o horário real é sempre recalculado das configurações atuais do passo, o que torna o motor seguro para recalcular (V11).

### 4.2 Decisão (função pura, `flow-model.ts`)

`decideFlowTask`, na ordem (a primeira que vale ganha):

1. o aluno está na equipe agora → termina como `filtered`;
2. o fluxo tem Objetivo e o aluno combina → sai pelo Objetivo;
3. horário real = maior entre `dueFromAnchor(passo, anchor_at)` e `not_before`; antes dele → só reagenda (acordado cedo por uma espera editada ou pela varredura, nada mais muda; reagendar não gasta adiamento);
4. notificação: prazo passou → `expired`; filtro não combina → `filtered`; fim calculado a menos de 15 min → `expired`; senão envia (com o fim, o prazo e as tarefas dos filhos);
5. Condição: Sim → filhos do Sim; Não com "esperar até" antes do prazo → reconfere na próxima faixa de 15 minutos; senão filhos do Não. Com "esperar até" e âncora "antes de vencer", o prazo é o menor entre o fim da notificação e o máximo da espera;
6. erro ao avaliar: tentativa 1 e 2 → de novo em 1 e 5 minutos; na 3 → `failed`. Tarefa de passo ou fluxo que não está mais no ar sai como falha ("Passo nao encontrado.") e o RPC de aplicação a transforma no que ela é sob a trava (`removed`, `flow_ended`, devolvida).

Também puras: `validateFlowTree`, `validateFlowGoal` (separada: a árvore não conhece o Objetivo; o salvar e a ativação chamam as duas), `followUpsFromTree` / `treeFromFollowUps` (as seguintes do editor são uma árvore vista pela notificação), `watchedPageKeysOf`, `childTasksOf`, `nextPollAt` e `saoPauloDayBounds`.

### 4.3 O tick (`processFlows`, fase 2 do job `comunicacao`)

Roda depois do trabalho da v1, com orçamento próprio de 25 s, dividindo o mesmo leitor de fatos por chave (`createFactsLoader`: os dados base uma vez por tick; as linhas de cada notificação citada numa regra uma vez por tick, na primeira vez que alguém pede). O tipo `Job` e o registro não mudam.

0. **Tem trabalho?** Três consultas pequenas e indexadas: tarefa vencida (ou reserva esquecida há mais de 2 min) de fluxo ativo; fluxo do construtor com entrada pendente; fluxo de notificação com entrada incompleta e origem já `sent` (embed com a dica da FK, na mesma consulta). Na faixa de 15 minutos, mais uma (varredura do Objetivo e conclusão): só fluxos ainda não conferidos nesta faixa (`goal_swept_at` é o carimbo de "conferido" de todos, com ou sem objetivo; os mais esquecidos primeiro), então mais de 100 fluxos que não terminam não escondem os outros. Sem nada, termina sem ler os alunos. Nenhum embed entre `campaigns` e `communication_flows` sem a dica da chave estrangeira (são duas relações; sem a dica o PostgREST responde `PGRST201`), conferido por teste.
1. **Entrada das seguintes** (até 3 fluxos por tick, os mais antigos primeiro, filtrando na própria sondagem os de notificação `sent`: fluxos de notificações agendadas nunca ocupam o lugar): `communication_enroll_notice_recipients`, só depois de a notificação estar `sent`; âncora `visible_at = maior(created_at da linha, sent_at do aviso)`; completa a seguinte nova de primeiro nível (passagens `done` voltam a `active`) só para quem já tinha entrado quando ela foi criada, e só para passo que **nasceu** de primeiro nível (`born_first_level`, marcado no insert): o passo que subiu porque a Condição saiu nunca vai para quem foi pelo outro caminho, nem para quem esperava na Condição (202610210001).
2. **Entrada do construtor** (ativado agora ou com as regras mudadas): avalia Quem entra; `current` e `current_and_new` criam passagens ativas e as primeiras tarefas; `new_only` cria passagens `baseline` (nunca entram). Em lotes de 500, até 5.000 por tick, retomável.
3. **Entrada contínua** (`current_and_new`, `new_only`) na faixa de 15 minutos, nas horas redondas (:00, :15, :30, :45); desde a v3b-2 os pop-ups recalculam 7 minutos depois (:07, :22, :37, :52, `docs/29` §4.7), então as duas faixas não coincidem mais. Os passos 2 e 3 dividem uma sondagem e o limite de 3 fluxos por tick.
4. **Tarefas vencidas**: lotes de 150, até 20 lotes ou 25 s: reserva (7.1), fatos do lote numa RPC (7.9: notificações por chave, visitas, acessos, passagens e equipe; progresso e comentários só se uma regra pedir, só para os alunos do lote), decisões puras, aplicação numa transação (7.4). Erro `22xxx`/`23xxx` na aplicação: o lote é dividido ao meio até isolar a tarefa ruim, que falha sozinha. Lote que falha antes de aplicar devolve as reservas e a tentativa (7.15). Cada decisão leva a `revision` do fluxo lida antes da árvore (o cache do tick lê o fluxo e depois os passos): se o fluxo foi gravado no meio (7.5 e 7.14 sobem a `revision`), 7.4 devolve a tarefa como `stale_version` sem gastar tentativa e sem criar filhos, e o motor tira o fluxo do cache e decide de novo com a árvore atual; a entrada do construtor (7.2) faz o mesmo com as regras de Quem entra (ninguém entra; o próximo tick refaz). Tarefa presa que sai como `failed` (5 reservas) fecha a passagem sem nada aberto.
5. **Varredura do Objetivo** (uma vez por faixa por fluxo com Objetivo): acorda as tarefas que esperam há mais tempo, menos as empurradas pelo limite diário (`not_before` no futuro).
6. **Conclusão** (uma vez por faixa): fluxo do construtor `current` com a entrada feita e nada aberto, e fluxo de notificação com a entrada completa, nada aberto e **todas as linhas da origem vencidas** viram `Concluído`. Até lá o fluxo de notificação fica ativo sem custo, e por isso dá para acrescentar uma seguinte depois.

Linha do log (quando houve trabalho): `[comunicacao] fluxos: {n} conferidas, {n} enviadas, {n} adiadas, {n} puladas, {n} falha(s), {n} entraram, {ms} ms.` Os mesmos números vão para `job_runs.metadata` da execução do job: `{ tick_run_id, flows: { backfilled, claimed, decided, deferred, entered, failed, finished, ms, job_ms, sent, skipped, woken } }`.

### 4.4 Garantias

| Garantia | Como |
|---|---|
| Um passo roda no máximo uma vez por aluno | chave `(node_id, user_id)` nas tarefas; filhos com `on conflict do nothing` |
| Uma notificação no máximo uma vez por aluno | `dedupe_key = flow:<passo>` com a chave única `(user_id, dedupe_key)`; as versões dividem a chave do passo |
| Um fluxo no máximo uma vez por aluno | chave `(flow_id, user_id)` nas passagens, `baseline` incluída |
| Dois ticks ao mesmo tempo | reserva com `for update skip locked` e carimbo único (`maior(p_now, clock_timestamp())`); a aplicação só mexe nas linhas com aquele carimbo |
| Queda no meio | a reserva vence em 2 min e é retomada; aplicação idempotente; 5 reservas sem terminar → `failed` (e a passagem sem nada aberto termina) |
| Pausar, encerrar, retirar ou mudar durante um lote | a aplicação trava os fluxos do lote `for share`; as mudanças (7.5, 7.13, 7.14) travam `for update` e esperam; versão enviada nunca é editada; decisão tomada sobre uma `revision` velha volta para a fila (`stale_version`) |
| Limite diário exato | trava por aluno na transação antes de contar; o intervalo de 1 h olha para trás também na virada do dia; todo horário usa o `p_now` do tick |
| Adiado não cai de madrugada | adiamento entre 0h e 8h vai para as 8h e fica em `not_before`; a varredura não o acorda |
| A equipe nunca recebe | fora na entrada (as duas RPCs), na decisão e de novo na aplicação |

### 4.5 Custo por tick

- Parado (a maioria dos minutos): 3 leituras indexadas de uma linha (fluxo pausado não soma, nem fluxo de notificação agendada); mais 1 na faixa.
- Com tarefas: 3 idas ao banco por lote de 150 (mais 1 a 4 leituras em pedaços quando uma regra pede progresso ou comentários). Até 3.000 tarefas por minuto: uma seguinte de "+1 dia" de uma notificação de 20.000 alunos sai em cerca de 7 minutos, e o relatório mostra a fila.
- Entrada: avaliação sobre os dados divididos, uma vez por faixa por fluxo contínuo (o aviso de escala de C4 vale).

---

## 5. Registro

### 5.1 Áudio

- Primeiro play: um pedido `POST /api/notifications/[id]/audio { event: "started" }` (fetch), que marca vista, lida, aberta e "começou" e devolve os contadores do sino. Ele **substitui** o `POST /read { ids }` que a v1 mandava no play: o número de pedidos não cresce. Não sai nada quando o servidor já tem trechos ouvidos ou quando o painel já mandou (a linha já está aberta).
- Tocando: um `progress` com a máscara quando ganhou pelo menos 5 trechos e passaram 15 s, e ao pausar e ao terminar (só se cresceu). Ao chegar a 44, na hora. Fecha a aba, esconde ou desmonta: `sendBeacon` (a resposta não é lida). Falha não é repetida: o envio seguinte leva a máscara inteira (OU).
- Servidor: confere que a linha é do aluno, aparece no sino, não venceu e tem áudio; a RPC 7.11 junta a máscara, recalcula a porcentagem e marca o "ouvido" com 44. Eventos em `student_events`, só ids e uma vez cada: `notification_audio_started` e `notification_audio_completed` (com `metadata.campaign_id`). O `progress` não grava evento, e o play não grava mais `notification_read`.

### 5.2 Visitas de página

- Gravadas **no servidor**, na página da área que já abriu (`trackMemberPageVisit`, depois da resposta com `after()`), nas 10 páginas do aluno, depois de o acesso e os dados resolverem (`notFound()` não grava) e **antes de qualquer `redirect()`** (a aula bloqueada conta como visita ao produto, como a página do produto bloqueado). Nada no `proxy.ts` e nenhum pedido a mais do navegador.
- Ordem das conferências: chave nula ou "ver como" → nada; pedido de pré-carregamento (`next-router-prefetch`, `sec-purpose` ou `purpose: prefetch`) → nada; chave fora das acompanhadas → nada; equipe → nada; mesma (aluno, página) gravada há menos de 10 s neste servidor → nada; senão grava. A trava é curta de propósito: o motor compara a hora exata ("visitou depois da notificação"), então ela só absorve recarga e o redirecionamento de `/conteudo/x` para a aula.
- Gravação: atualiza `last_visited_at` quando a linha existe e a data só avança; senão insere com `first_visited_at = last_visited_at` = a hora do app. (Um `upsert` deixando `first_visited_at` no padrão do banco não serve: o `now()` da transação fica depois da hora do app e o check `member_page_visits_order` recusa a primeira visita.)
- Chaves (`page-visit-model.ts`): `/` → `home`; `/conteudo/[id]` e as aulas dele → `content:<id>`; `/minhas-compras`, `/favoritos`, `/materiais`, `/minha-jornada`, `/continue-assistindo`, `/perfil`, `/suporte` → `purchases`, `saved`, `materials`, `journey`, `continue`, `profile`, `support`. O botão de uma notificação vira chave só quando aponta para uma dessas páginas (sem query nem âncora); outro caminho interno e link externo → nenhuma ("clicou no botão" serve).
- Dois `sendBeacon` para o que não é navegação (`POST /api/page-visits`): abrir os detalhes de um produto (`content:<id>`, de novo depois da trava do servidor, 10 s) e clicar em Comprar (`checkout:<id>`, antes de abrir). Todo botão que abre um `purchaseUrl` chama o mesmo `trackCheckoutClick` (modal de detalhes, botão do card na fileira de módulos, Comprar do destaque imersivo); um teste de guarda falha se aparecer outro sem ele. O Comprar do card só abre o modal, que registra.
- Acompanhadas: `watched_page_keys` de cada fluxo (páginas das regras de visita em filtros, condições e Objetivo, e a página do botão de cada notificação do fluxo, inclusive a de origem), unidas sobre os fluxos **ativos e pausados** num cache de 60 s (tag `communications`, renovada por toda ação de fluxo). Sem fluxo no ar, nada é gravado.
- "Visitou desde T" = `last_visited_at ≥ T`: uma linha por (aluno, página) basta. Por isso a regra de visita só existe dentro de fluxos (seção 7).

### 5.3 Compras

Compra é acesso interno (`entitlements`), lido fresco a cada lote. "Ganhou acesso a Y desde T" = acesso a Y (ou à plataforma) aberto agora com `maior(created_at, starts_at) ≥ T`. Reembolso (acesso revogado) é "não ganhou".

### 5.4 Abriu × leu

`opened_at` (abriu de verdade) é gravado pelo clique no cartão e pelo "Ver mais" (`POST /read { ids }`), pelo botão, pela resposta e pelo começo do áudio, sempre junto com vista e lida. "Marcar todas como lidas" e abrir o sino nunca gravam. Um cartão lido pelo "Marcar todas" ainda pode ser aberto: o cartão e o painel olham `openedAt` (a bolinha continua seguindo `readAt`). Os números da v1 não mudam (Viram = `seen_at`); nada é deduzido de `read_at`.

### 5.5 Retenção (`docs/17` D8)

| Dado | Fica |
|---|---|
| `notifications` (com `opened_at` e áudio) | 24 meses (igual); as vencidas ficam para o relatório |
| `communication_flow_tasks` | 24 meses depois de terminar; as pendentes nunca saem |
| `communication_flow_runs` | 24 meses depois de terminar, **só** de fluxo encerrado ou excluído (no fluxo no ar, a passagem garante "uma vez por aluno") |
| `member_page_visits` | 24 meses depois da última visita |
| `student_events` (`notification_audio_*`) | como hoje |
| Conta excluída | leva tudo acima (cascade); o e-mail `sent_as` na fila só tem ids na metadata |

---

## 6. Rotas e Server Actions

### 6.1 Rotas do aluno

Todas com `Cache-Control: private, no-store` e `Vary: Cookie`, corpo por `readBoundedJson` (aceita `text/plain` do `sendBeacon`). As duas novas, de telemetria, só escrevem e são idempotentes: usam `requireApiSessionUser` (as claims do JWT, sem ida ao Auth; uma sessão revogada pode durar até o fim do JWT, a mesma troca das páginas de conteúdo, `docs/06`).

| Rota | Novo / mudou | Entrada | Respostas |
|---|---|---|---|
| `POST /api/notifications/[id]/audio` | novo | `{ event: "started" }` ou `{ event: "progress", heard }` (48 × 0/1), até 2 KB | 200 `{ audioProgress }` (+ `unread` e `unseen` no `started`); 400 `Notificacao invalida.` / `Evento invalido.`; 401 `Sessao obrigatoria.`; 404 quando a linha não é do aluno, não aparece, venceu ou não tem áudio; 413 corpo grande |
| `POST /api/page-visits` | novo | `{ key }` com `^(content\|checkout):[A-Za-z0-9_-]{1,240}$`, até 1.000 bytes | 204 (gravou, ou ignorou: página não acompanhada, equipe, "ver como", menos de 10 s); 400 `Pagina invalida.`; 401 |
| `GET /api/notifications` | mudou | — | itens com `icon`, `expiresAt`, `openedAt`, `audioProgress` (só com áudio) e, no aviso, `actor` = quem envia (só da equipe) ou nulo = a escola; vencidas fora |
| `GET /api/notifications/summary` | mudou | — | `unseen` sem as vencidas; `popup.icon` só quando há ícone (a chave some sem ele) |
| `POST /api/notifications/read` | mudou | v1 + `shown` opcional (até 50 ids) em `{ seen }` e `{ all }` | `{ ids }` também grava `opened_at`; nenhuma marcação mexe em linha vencida; linha de fluxo só é marcada por `seen`/`all` quando é 15 s mais velha que o `asOf` ou está em `shown` (o painel manda os ids das linhas de fluxo mais novas que isso que ele mostrou); `shown` inválido → 400 `Notificacao invalida.`; ignorado em `{ ids }` |
| `POST /api/notifications/[id]/click`, `/response` | mudou | v1 | também gravam `opened_at`; 404 quando vencida |

Banco sem a 0002: o sino e o pop-up respondem vazio, a rota do áudio responde 404, o job registra `migracao 202610200001 pendente ou 202610200002 pendente` e termina, e as telas mostram o aviso de atualização (`202610200002`). Envios, cliques e respostas não funcionam até aplicar: por isso ela vai antes do deploy.

### 6.2 Server Actions

Todas por `runAdminAction` (permissão + zod + versão), com auditoria e `revalidatePath`; toda escrita de fluxo chama `invalidateLivePopups` (tag `communications`, que também guarda as páginas acompanhadas).

**Avisos (`actions.ts`), o que mudou:**

| Ação | Mudança |
|---|---|
| `saveNoticeDraft` | grava Quem envia, ícone e tempo no sino; quem envia fora da equipe → 400 no campo; auditoria com `sender_user_id`. Salvar uma notificação agendada ou aguardando aprovação também volta o fluxo dela para rascunho e devolve a versão nova dele (`flowUpdatedAt`; null quando o fluxo não mudou) |
| `saveNoticeFollowUps` (nova) | `{ noticeId, expectedNoticeUpdatedAt, expectedFlowUpdatedAt? (null = a tela não viu fluxo nenhum: com fluxo no banco, 409), goal: { productId } \| null, followUps }`; quem envia cada seguinte só da equipe (400 no campo); cria o fluxo da notificação no primeiro uso (`origin = notice`, `Seguintes de “{título}”`, o id da entrada é o que o navegador já cita nas regras) e grava pelo mesmo caminho do construtor. Antes do envio, só com a notificação em rascunho (senão 409); depois do envio, `messaging.publish` (+ `publish_large` acima de 500 que receberam) e o fluxo nasce ativo; retirada → 409; concluída → 409; `followUps: []` num rascunho exclui o fluxo. Devolve `{ flowId, flowUpdatedAt, nodeIds, entryNodeId }` |
| `previewFollowUpAudience` (nova) | `{ noticeId, parentNodeId, filter }` → `{ qualified, recipients }`: quem recebeu a anterior, avaliado agora em pedaços de 1.000; `qualified` nulo antes do envio (e para uma anterior ainda não salva). Só números |
| `sendFollowUpTestToMe` (nova) | `{ noticeId, nodeId }`: o teste de uma seguinte no próprio sino (mesma chave `campaign-test:<versão>` do teste do construtor) |
| `listNoticeSenders` (nova) | a equipe para Quem envia (relida quando a janela volta ao foco); `messaging.write` |
| `publishNotice` / `approveNotice` | conferem quem envia (422), o tempo no sino contra o envio e as seguintes (400 `A notificação seguinte {n} tem um problema: {mensagem}.` no campo `followUps.{caminho}.{campo}`) e os remetentes das seguintes; a contagem já lê as notificações citadas nas regras; o fluxo vai para ativo (ou aguardando aprovação) antes do envio e volta para rascunho se o envio falha, com as páginas acompanhadas regravadas pelo botão atual; e-mail `sent_as` do aviso para quem envia a notificação e o do fluxo (`sent-as:flow:<fluxo>:<pessoa>`, com o nome do fluxo) para quem envia só as seguintes |
| `rejectNotice` / `cancelScheduledNotice` | o fluxo da notificação volta para rascunho |
| `withdrawNotice` | `{ id, expectedUpdatedAt, alsoFollowUps = true }`: encerra o fluxo (`source_withdrawn`); com `alsoFollowUps`, cancela as seguintes e apaga as linhas delas (auditoria `follow_ups_removed`) |
| `duplicateNotice` | copia as seguintes (fluxo, passos e rascunhos novos, referências e linha de parada refeitas); "até uma data" vencida volta a 90 dias |
| `deleteNotice` | também exclui o fluxo (`source_deleted`) |
| `sendNoticeTestToMe` | o fim do teste é o calculado, mas pelo menos 1 hora; repetir também refaz `created_at` e `expires_at` e zera o "abriu" e o áudio |
| toda ação que carrega o aviso por id | recusa notificação de fluxo com 409 |

**Fluxos (`flow-actions.ts`, nova):**

| Ação | Permissão | Erros |
|---|---|---|
| `saveFlow` | `messaging.write`; no ar, `messaging.publish` (+ `publish_large` acima de 500) | 400 no campo (`nodes.<id>.<campo>`), 403, 404, 409 (versão), 422 (mudança de estrutura com gente esperando, mover, modo, limites) |
| `activateFlow` | `messaging.write` (publica ou pede aprovação pela contagem agora) | 409 (também no fluxo de notificação); 422 (`Nenhum aluno está neste segmento agora.`, `Já há 20 fluxos ativos…`, `Adicione pelo menos uma notificação.`, `Escolha o produto.`) |
| `approveFlow` / `rejectFlow` | `messaging.publish_large` | 409 |
| `pauseFlow` / `resumeFlow` / `endFlow` | `messaging.publish` (retomar acima de 500, `publish_large`) | 403, 409 |
| `duplicateFlow` / `deleteFlow` | `messaging.write` | 409 `Encerre o fluxo antes de excluir.` |
| `withdrawFlowMessage` | `messaging.publish` | 404, 409; versões do passo canceladas, tarefas dele e de baixo como `withdrawn` (7.14) e as linhas apagadas pelo TypeScript em pedaços |
| `sendFlowMessageTest` | `messaging.write` | 404 |

Ordem do salvar (`saveFlowTree`, `flow-store.ts`): fluxo novo nasce rascunho; para cada notificação que mudou, num fluxo no ar sempre uma versão nova `sent` com `sent_at` (versão enviada nunca é editada: um lote pode estar entregando ela), e num rascunho a versão de rascunho é editada; depois a RPC 7.5 grava a árvore com a versão conferida e `watched_page_keys`. Versões de um salvar que falhou ficam órfãs e invisíveis e saem com o fluxo. A RPC recusa um pai ou uma âncora fora da árvore enviada (`Passo invalido.`).

---

## 7. Regras (segmentos e condições)

`audience-model.ts` continua sendo o único avaliador. Três regras novas:

| Regra | Opções | Segmentos (Avisos, pop-ups, Quem entra) | Fluxos (Condição, "Só para quem…", Objetivo, "Para quem" da seguinte) |
|---|---|---|---|
| **O que fez com uma notificação** (`message`) | `[Fez \| Não fez]` `[recebeu \| viu no sino \| abriu \| começou a ouvir o áudio \| ouviu o áudio até o fim \| clicou no botão \| aceitou \| recusou \| respondeu \| interagiu]` `[notificação]`, só as ações que a notificação tem | **sim**, com qualquer notificação enviada da lista de Avisos ("não ouviu o áudio da notificação X") | sim: as notificações acima no caminho, a de origem, ou uma enviada da lista |
| **Visitou uma página** (`page_visit`) | `[Visitou \| Não visitou]` `[a página do botão da notificação… \| a página de um produto \| Comprar de um produto \| Início \| Minhas compras \| Favoritos \| Materiais \| Minha jornada \| Continue assistindo \| Perfil \| Suporte]` `[desde que entrou no fluxo \| depois de receber a notificação…]` | **não** (`Esta regra só vale dentro de um fluxo.`): só há dado enquanto um fluxo no ar acompanha a página | sim |
| **Ganhou acesso a um produto** (`access_gained`) | `[Ganhou \| Não ganhou] acesso a [produtos]` + desde quando | **não** ("ganhou acesso há menos de X dias" é o Tempo de acesso da v1) | sim |
| **Participação em lives** com as ações do follow-up (`webinar`; webinários fase 4b, 29/10/2026, unida à regra de 30/10/2026 na integração; `docs/30` §1.6 e D52) | `[viu o replay \| viu o card de compra \| saiu antes do card de compra \| clicou para comprar e não comprou \| comprou pelo card]` e as formas com "Não", `[live da lista]` (a live é obrigatória) | **sim**: é o follow-up dos webinários ("participou e não comprou pelo card"), lido de `webinar_follow_up_facts` com a equipe fora e nada da Simulação | **não** (`Replay, card de compra e compra valem só no “Para quem” de avisos e pop-ups e no “Quem entra” de um fluxo.`; no fluxo o seletor só oferece participou e garantiu vaga): o lote do motor não lê o follow-up das lives; no fluxo, elas entram pelo "Quem entra" |

- **v3a** (`docs/24` §6): a ação ganha `reagiu` (qualquer reação ou `com ❤️ Amei`…, só com notificação que permite reações), `votou na enquete` (qualquer opção ou `em “Sábado”`…, só com enquete) e `excluiu do sino` (sempre), no fim da lista e com as mesmas regras de negação; `clicou no botão` passou a se chamar **foi para o destino** (a mesma ação `clicked`: o toque no cartão clicável grava o mesmo clique). Frases: `reagiram com ❤️ à notificação “Aula nova”`, `votaram em “Sábado” na enquete da notificação “Horário da live”`, `excluíram do sino a notificação “Oferta especial!”`, `foram para o destino da notificação “…”`. Validação do fluxo: `A notificação escolhida não aceita reações. Escolha outra regra.`, `A notificação escolhida não tem enquete. Escolha outra regra.`, `Esta opção não existe mais na enquete. Escolha outra.`, `A notificação escolhida não leva a lugar nenhum. Escolha outra regra.`
- **Ações do follow-up** da **Participação em lives** (fase 4 dos webinários, `docs/22` §3 e `docs/30` §1.6): negada, é o contrário da ação para todos ("não viu o replay" inclui quem nem passou pela live; quem tinha vaga e não veio são duas regras, **garantiu vaga** e **não participou**); live removida, não lida ou ainda não escolhida nunca combina, negada ou não. Frases: `viram o replay da live “{título}”`, `não compraram pelo card na live “{título}”`; título que sumiu: `uma live removida`. As lives citadas por essas ações vão em `webinarFollowUpIds` (`audienceFactsRequest`), e a contagem é a mesma na prévia, no envio, no recálculo do pop-up e na entrada do fluxo.
- **Negação implica recebeu**: "não abriu X" é recebeu X e não abriu; quem nunca recebeu X não entra. `interagiu` = abriu, começou o áudio, clicou ou respondeu (desde a v3a também reagiu ou votou; o mesmo que "abriu", porque toda interação grava `opened_at`; por isso não é escolha rápida).
- Uma notificação cujas linhas não foram lidas nunca combina, negada ou não (nunca combina por acaso); lida e sem linha do aluno, é "não recebeu". Só contam notificações `sent` e não excluídas: retirada, cancelada ou excluída vira "não recebeu" para todos.
- Visita e acesso: desde a entrada no fluxo (`entered_at` da passagem) ou desde a chegada da notificação escolhida (sem ela recebida, as duas formas são falsas). Fora de um fluxo, as duas regras são falsas, negadas ou não.
- Frases (`Alunos que …`): `não abriram a notificação “Oferta especial!”`, `ouviram até o fim o áudio da notificação “…”`, `clicaram no botão da notificação “…”`, `visitaram a página de Formação IA desde que entraram no fluxo`, `clicaram em Comprar de Formação IA depois de receber a notificação “…”`, `ganharam acesso a Formação IA desde que entraram no fluxo` (e as formas com `não`). Título que sumiu: `uma notificação removida`.
- Seletor no segmento: as notificações enviadas nos últimos 90 dias (fora as de fluxo, as 200 mais novas) como `{título} · 21/10`, com `Só conta quem recebeu a notificação.`; sem nenhuma, desabilitado com `Nenhuma notificação enviada nos últimos 90 dias.`; uma salva que saiu da lista aparece como `Notificação fora da lista`. No fluxo, primeiro os passos acima (o mais próximo já escolhido), depois as enviadas; sem passo acima, `Nenhuma notificação antes deste passo.`
- Regra nova já vem preenchida: `abriu` a notificação mais próxima (ou `Escolha a notificação.`), `Visitou o Início desde que entrou no fluxo`, `Ganhou acesso a` sem produto (`Escolha o produto`). Os limites da v1 valem (20 regras, um nível de grupo, 50 ids).
- Leitura: cada chamada passa os ids das notificações citadas (`collectMessageCampaignIds`) e só lê as linhas delas (sem teste, páginas de 1.000); a prévia, a publicação, o envio agendado pelo tick, o recálculo do pop-up e a entrada de um fluxo dão a mesma contagem. O motor recebe essas linhas pela RPC do lote.
- **Nota (30/10/2026, `docs/22` §3 e `docs/30` §1.6):** mais duas regras, **Ganhou acesso recentemente** (`access_recent`: hoje no dia de São Paulo ou nas últimas N horas, pelo início do acesso) e **Participação em lives** (`webinar`: participou ou garantiu vaga, numa live ou em qualquer uma). Valem nos segmentos e em todo lugar dos fluxos (condição, "Só para quem…", Objetivo, "Para quem" da seguinte), sem marco "desde": diferente de **Ganhou acesso a um produto**, que conta desde a entrada no fluxo ou desde uma notificação. As vagas e presenças vêm da RPC `communication_webinar_facts` (migração `202610300001`), lidas só quando alguma regra pede: o carregador do tick lê uma vez por tick (`load(ids, { webinars: true })`), o lote do motor lê só os alunos do lote (`p_user_ids`, pedaços de 150) e a prévia das seguintes lê uma vez. Como as notificações não lidas, sem essa leitura (`context.webinarFactsLoaded`) a regra nunca combina, negada ou não. O pedido ao carregador sai de `audienceFactsRequest` (avisos citados + vagas e presenças + o follow-up das lives citadas; dentro dos fluxos só participou e garantiu vaga valem). O índice de aulas publicadas só é lido com regra de progresso, ritmo ou turma (`audienceFactNeeds(...).lessons`; a turma de quem tem a plataforma inteira sai dos conteúdos com aula); entrada, último estudo e comentários não usam. Rollback: a imagem anterior avalia essas duas regras como "não", e numa condição isso manda todo aluno pelo caminho **Não** (no Objetivo, ninguém sai por ele; no "Só para quem…", quem chega para ali); pausar antes os fluxos que as usam numa condição, no Objetivo ou no "Só para quem…" (`docs/20`).

---

## 8. Decisões tomadas

| # | Decisão | Por quê |
|---|---|---|
| V1 | O círculo é **quem envia**: a escola usa o **Ícone da escola** (padrão `/brand/icon-bunker.svg`); pessoa da equipe, a foto ou as iniciais. Sem megafone e sem selo no aviso; os selos de comentário ficam | é o que o produtor circulou, e funciona sem configurar nada |
| V2 | **Só gente da equipe** como remetente, resolvida **na hora de ler** (quem sai vira a escola), e a pessoa **sabe por e-mail** (`sent_as`), mais auditoria e `Criada por … · em nome de …` | mantém "enviar como se fosse um professor" (o Professor não tem `messaging.write`) e avisa onde a equipe lê |
| V3 | **Ícone** opcional, **antes do título**, 16 px / 20 px, decorativo; 16 ids e 5 cores; escolher o ícone escolhe a cor | atende a terceira conversa sem mudar o nome acessível do cartão |
| V4 | **Fica no sino por** por notificação: 1, 3, 7, 30 ou 90 dias (padrão e máximo), de 5 minutos a 90 dias (1 hora até os ajustes da v3a, `docs/24` §10), ou até uma data; fim por linha (`expires_at`); vencida some de tudo | as notificações de fluxo chegam em horas diferentes; 90 dias é a janela do sino |
| V5 | **Termina em** em âmbar com 24 h ou menos e tempo total até 30 dias, nunca depois de responder; nome cortado na linha de baixo; rodapé `até 90 dias` | sem ruído no padrão de 90 dias e cabe em 375 px |
| V6 | **Áudio ouvido** em quatro estados, nunca só pela cor; ouvido = 44 de 48 trechos tocados de verdade, juntados no servidor; bolinha branca; pop-up sem estado | uma definição honesta: pular não engana e dividir em dias conta |
| V7 | `opened_at` separado de `read_at`; "Marcar todas" e abrir o sino não abrem; numa notificação sem nada para abrir, só `viu no sino` / `nem viu no sino` | "não abriu" tem de querer dizer "não abriu" |
| V8 | **Um modelo**: fluxo = árvore de Notificação e Condição (Sim/Não), espera em cada passo; notificação com seguintes = fluxo `origin = notice`; uma linha por (passo, aluno) | o editor e o construtor mexem nas mesmas linhas |
| V9 | **Depois desta notificação** no editor, com Quando sai, Para quem (escolhas rápidas) e o conteúdo numa folha; contagem depois do envio; pílulas na prévia | "deixar configurado ali" sem uma página sem fim |
| V10 | **Fluxos** com aba, quatro modelos, construtor de dois blocos e uma coluna a 375 px; remover Condição pergunta qual caminho fica | o pedido de fluxos com regras; o caso comum fica no editor |
| V11 | Decisão **segura para recalcular**: tarefa acordada cedo só reagenda; horário real = maior entre a âncora e `not_before` | mudanças no ar simples e certas |
| V12 | **Aplicação atômica** por lote com os fluxos travados; mudanças de estado travam o fluxo antes; versão enviada nunca editada; lote dividido ao meio em erro de dado | pausar, encerrar, editar, ticks sobrepostos e quedas não causam envio indevido |
| V13 | **Limite fixo**: 3 por dia de São Paulo por aluno, 1 h entre elas; o que passa vai às 8h do dia seguinte; não sai depois do prazo ou de 7 adiamentos; uma vez por fluxo e por notificação; sem horário de silêncio no sino | a regra de "limites como texto" que o pop-up tinha (`docs/17` §1.8.1); desde a v3b-1 o pop-up não tem mais limite fixo como texto (a frequência é escolhida pela equipe em cada um, `docs/25`), e o limite de 3 por dia dos fluxos continua |
| V14 | **Fatos** numa RPC por lote de 150; progresso e comentários só se uma regra pedir; dados completos só na entrada, na faixa de 15 minutos | sem o corte de 1.000 linhas do PostgREST e parado custa 3 leituras |
| V15 | **Visitas** gravadas no servidor, só das páginas acompanhadas; beacon só para detalhes do produto e Comprar, com guarda de sessão por claims | nada é gravado enquanto nenhum fluxo precisa |
| V16 | **Regras**: `message` em segmentos (qualquer notificação enviada) e em fluxos (um passo acima); `page_visit` e `access_gained` só em fluxos; negação implica recebeu | "não ouviu o áudio da X" vale em qualquer lugar |
| V17 | **Permissões** com o mesmo sentido; ativar, retomar e aplicar mudanças valem como publicar; os 500 contam o segmento de entrada agora; a aprovação da notificação cobre as seguintes; fluxo contínuo pode crescer (C12); mudança no ar nunca vira pedido (C13) | uma regra só para notificações, pop-ups e fluxos |
| V18 | **Mudanças no ar** preparadas e aplicadas numa transação; conteúdo vira versão nova; espera reagenda quem espera; mover é recusado | nada pela metade chega ao aluno |
| V19 | **Vocabulário** da tela (topo deste documento); modelos sem "Lembrete" | `docs/17` §1.3 e as palavras do produtor |
| V20 | **O motor** é a fase 2 do job `comunicacao`, com 25 s próprios, números em `job_runs.metadata`, sem mudar o tipo `Job` | medível, sem job nem fila novos |

### 8.1 Escolhas da entrega

O que a implementação decidiu onde o desenho era omisso ou não batia com o código (já descrito nas seções acima; aqui para não se perder):

- **Banco**: `notifications.flow_id` com `cascade` (seção 3); RPC 7.15 para devolver um lote; carimbo da reserva `maior(p_now, clock_timestamp())` (com só o relógio real, em tempo simulado uma reserva nova parecia velha); 7.5 recusa pai ou âncora fora da árvore; `notifications_engagement_v2` sem "aberta implica lida".
- **Sino**: o "abriu" do play é o `started` do áudio (nenhum `notification_read` no play) e não sai de novo num replay; marcar nunca mexe em linha vencida, nem por `{ ids }`; `shown` acima de 50 ids → 400; "tocado e pausado" é `ouvido até 0%`; barra ouvida pela maioria estrita; comentário sem autor com o ícone da escola; `popup.icon` some quando não há ícone (o teste da v1 compara o objeto inteiro).
- **Marca**: SVG convertido no navegador; JPEG fora (uma linha se o produtor quiser); link colado conferido em 8 s; mensagens novas do servidor (seção 2.3).
- **Editor**: ordem das dicas de Quem envia; `Equipe Bunker707` como nome e `· fora da equipe` na lista; a prévia "chega" 30 s antes de agora (`1 dia` mostra `Termina em 23 h` e `agora`); `Outro` começa em 2 dias; `Abriram` só na notificação; `sender_user_id` também em `approval_requested`; o envio calcula o fim a partir do mais tarde entre o `now` do tick e o relógio (nunca viola `expires_at > created_at`).
- **Regras**: a ordem da v1 no seletor fica (as três novas no fim, filtradas por modo); valores iniciais das regras novas; o seletor lista as enviadas dos últimos 90 dias (até 200); só contam notificações `sent`.
- **Visitas**: atualizar ou inserir com as duas datas (seção 5.2); também `sec-purpose` / `purpose: prefetch`; aula bloqueada conta; corpo do beacon até 1.000 bytes; `sendBeaconPost` dividido com o sino.
- **Motor**: entrada do construtor e contínua na mesma sondagem e no mesmo limite de 3 fluxos; `validateFlowGoal` separada; prazo do "esperar até" com âncora "antes de vencer" = o menor dos dois; tarefa de passo que saiu termina pela aplicação; o limite de "antes de vencer" só é conferido com duração.
- **Fluxos (admin)**: guarda `requirePageArea` + `messaging.write`; produto dos modelos exigido já ao salvar; `+` no meio de um fluxo no ar cria caminho paralelo; Pausar pede confirmação; auditoria com `sender_user_ids` e a contagem de versões novas; números do período com fim por uma segunda leitura da RPC 7.7 desde o fim do período (a RPC só tem "desde"); título abre o painel (sem campo no topo); filtro do cartão no plural; salvar aguardando aprovação volta a rascunho; `activateFlow` no fluxo de notificação → 409; confirmação de aplicar só quando as regras de entrada mudam no modo contínuo; `Mostrar números` desligado na edição.
- **Contratos internos** (para quem mexe no código): um rascunho no formato da v1 (aba aberta antes do deploy) continua válido, porque os campos novos têm padrão no zod; `DecideInput` traz `staff` como campo próprio; `FlowIssue` tem nível `save`, `activation` ou `warning`; `computeExpiresAt` trabalha em milissegundos; `pageKeyOfRoute` recebe o caminho; a frase de revisão recebe o tempo no sino já em texto (evita import circular); `notifySendersOnBehalf` é assíncrona (lê a origem do pedido antes do `after()`); os leitores de fatos por lista de alunos aceitam caches do tick; `getNoticeDetail` carrega as opções da seção de seguintes quando ela está no ar; os campos que podem aparecer juntos na tela (construtor de regras, botão, conteúdo) recebem um `idPrefix` (`aviso` no editor, `seguinte-<id>`, `passo-<id>`, `fluxo-quem-entra`, `fluxo-objetivo`) e o "Áudio na prévia" usa um nome próprio por prévia; os três "Enviar teste para mim" (aviso, seguinte e passo) gravam pela mesma função, `upsertTestNotification` (`store.ts`).
- **Seguintes**: salvar a notificação agendada volta o fluxo para rascunho; seguintes só mudam com a notificação em rascunho antes do envio; o fluxo vai para ativo antes do envio e volta se o envio falha; o id da entrada vem do navegador; `sendFollowUpTestToMe` própria; sem nada para abrir, `nem viu no sino` é a escolha inicial; contagem `null` para uma anterior não salva; a folha ocupa a tela toda abaixo de 768 px (não 1024).

---

## 9. Fica de fora

| Fora | Por quê |
|---|---|
| Reapresentar a mesma notificação | o produtor tirou na segunda conversa; uma seguinte pode repetir o texto |
| Nome digitado ou foto avulsa como remetente | risco de se passar por alguém; a equipe cobre "como se fosse um professor" e o ícone da escola cobre a marca |
| Rótulo curto ("Novo", "Urgente") ou cartão colorido | o ícone e o título já dizem; espera as referências visuais do produtor (o catálogo e `notice-icons.tsx` têm lugar para isso) |
| Horário de silêncio | o sino só é visto quando abre (sem push e sem som); adiados nunca saem entre 0h e 8h; chega com push e e-mail |
| Passos de push, e-mail e WhatsApp; `/perfil/notificacoes` | canais à parte (consentimento, descadastro, custo D6) |
| Pop-up como passo de fluxo, seguintes de pop-up, "ouvido" no áudio do pop-up | o pop-up tem a sua própria frequência, escolhida pela equipe (`docs/25`), e nenhuma linha por aluno com fim |
| Entrar de novo num fluxo, voltas e junções | "uma vez por fluxo" é a regra anti-cansaço mais forte e mantém a árvore legível |
| Disparo na hora por evento ("concluiu a aula X" agora) | a entrada contínua por regras chega em até 15 minutos, sem barramento de eventos |
| Visita de página em segmento comum, histórico antes de um fluxo, visita por aula, contagem de visitas | só se grava enquanto um fluxo precisa; "visitou desde T" só precisa da última |
| Teste A/B, seletor de desfecho, "Salvar quem converteu como segmento" | fases seguintes (`docs/17` §1.8.2 e fase 7) |
| "Testar o fluxo comigo" com o tempo acelerado | o teste de cada passo e a prévia cobrem o conteúdo |
| Linha do tempo do aluno nos fluxos (perfil em Alunos) | outra tela; passagens e tarefas já guardam o que ela precisa |
| Mudar o tempo no sino de uma notificação enviada | regra da v1: enviada não muda (Retirar ou Duplicar) |
| Permissão nova para enviar em nome de alguém | publicar já exige `messaging.publish` ou aprovação, quem publica fica registrado e a pessoa é avisada |
| Linha no sino "enviada em seu nome" ou lista no admin | a equipe entra no `/admin`, sem sino; o e-mail chega |
| Fluxos em Promoções e Webinários | quando as telas existirem |

**Ajustes conhecidos, para depois**:

- a folha da notificação seguinte é tela cheia abaixo de 768 px (o `AdminSheet` de todo o admin), não 1024 px; entre 768 e 1024 px ela ocupa quase toda a largura (800 px);
- salvar um modelo antes de escolher o produto pediria aceitar lista vazia no rascunho;
- JPEG no Ícone da escola, se o produtor quiser;
- rodada do `carga` com um fluxo no ar acompanhando uma página (`docs/20` §12.1), depois do deploy na Hetzner;
- ponta a ponta no WebKit para os testes novos (rodados no Chromium).

---

## 10. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/comunicacao-v2-mensagem.test.mjs` (23) | catálogo de ícones e cores, schemas de quem envia, ícone e tempo no sino, fim calculado (padrão, duração, data, 90 dias, "até a principal sumir", teste de pelo menos 1 hora), `Termina em` (25 h, 24 h, 3 h 59, 59 min 30 s, 40 min, 20 s, 31 dias, respondida, comentário), recusa no pop-up, `publishProblems` da data, limites das seguintes e do construtor, regras de segmento × fluxo, ícone da escola, trechos do áudio |
| Unitário | `tests/comunicacao-fluxos-modelo.test.mjs` (36) | `dueFromAnchor` nas 3 âncoras e no "esperar até", `childTasksOf`, matriz de `decideFlowTask` (equipe, Objetivo, acordado cedo, `not_before`, prazo, filtro, nasce vencida, envio com filhos, `expireWithAnchor`, Sim/Não, espera, tentativas), `validateFlowTree` e `validateFlowGoal` (com a regra de mensagem impossível: sem áudio, botão ou resposta), os 4 modelos, ida e volta seguintes ↔ árvore, `watchedPageKeysOf`, dia de São Paulo |
| Unitário | `tests/comunicacao-job.test.mjs` (24, 8 da v1) | parado = 3 sondagens e nenhum aluno lido; sondagem das seguintes filtrando a origem `sent` na mesma consulta; faixa só com quem não foi conferido nela; leitor dividido entre as fases; sinal de parada; sem a 0002 termina sem erro; divisão ao meio; `revision` em cada decisão; cache do tick (fluxo antes dos passos, esquecido no `stale_version`); lote devolvido; `job_runs.metadata` com `tick_run_id`; dica de chave estrangeira em todo embed |
| Unitário | `tests/comunicacao-segmentos.test.mjs` (47, 21 da v1) | as três regras, negação, chave não lida, frases, normalização, schemas, leitores sobre banco em memória (páginas de 1.000, pedaços de 150) |
| Unitário | `tests/sino-do-aluno-modelo.test.mjs` (19, 10 da v1) | trechos pelos intervalos tocados, OU, barras de 12 a 48, estados, quando mandar (fetch ou beacon), abrir × Marcar todas, linha de baixo, rodapé, `shown` |
| Unitário | `tests/comunicacao-admin-modelo.test.mjs` (27), `tests/comunicacao-avisos-modelo.test.mjs` (27) | prévia com quem envia, ícone, fim e áudio; mudança detectada; cor sugerida; dicas de Quem envia; `Fica no sino por`; funil com `Abriram` e áudio; `Criada por … · em nome de …`; frase de revisão com tempo e seguintes; e-mail `sent_as` e as chaves |
| Unitário | `tests/comunicacao-fluxos-tela.test.mjs` (28), `tests/comunicacao-seguintes-tela.test.mjs` (25) | situações, ações por situação e permissão (fluxo de notificação agendada ou aguardando aprovação: só Abrir a notificação), topo, Condição nova com `viu` quando não há o que abrir, escolha rápida que não vale mais, `falharam` e o rótulo do "removido", trava de Quem entra, Objetivo e `Adicionar`, inserir e remover passos, relatório com `—`, vocabulário; escolhas rápidas por conteúdo (nunca `não abriu` em texto curto; dono que clicou não entra), linha de parada, `with_anchor`, pílulas, frases de Quando sai, contagem, só leitura, caixa de Retirar |
| Unitário | `tests/visitas-de-pagina-modelo.test.mjs` (4), `tests/visitas-de-pagina-beacon.test.mjs` (2, o beacon dos detalhes repete depois da trava), `tests/admin-storefront.test.mjs` (18), `admin-frames`, `admin-v2-shell`, `admin-search` | chaves das páginas; ícone da escola na Marca e no PUT; aba Fluxos, período, `Novo fluxo` |
| Guarda | `tests/comunicacao-v2.guard.test.mjs` (10), `tests/visitas-de-pagina.guard.test.mjs` (6) | 0001 e 0002 sem mudança (hash), 0002 e 202610210001 sem `drop` (a 0003 também sem `delete`, mesmas assinaturas), RLS e permissões de toda RPC, `Job` sem mudança; visita nas 10 páginas antes do `redirect`, nunca no `proxy.ts`, gravação só no `after()`, todo Comprar com `trackCheckoutClick` |
| Integração | `tests/integration/fluxos.test.mjs` (35) | ativar e enviar, `new_only`, `current_and_new`, Condição, "esperar até", Objetivo, pausar/retomar/encerrar, ticks em paralelo, queda, limite do dia (8h, 23:40 → 00:40 → 08:00, adiado que sobrevive à varredura, `cap`), mudanças no ar, retirar passo, "abriu o sino" com os 15 s e `shown`, conclusão; complemento sem o passo que subiu de nível, sondagem com 20 agendados, `stale_version` com a árvore nova, faixa que gira com mais de 100 fluxos, presa que fecha a passagem |
| Integração | `tests/integration/fluxos-admin.test.mjs` (10) | salvar e 409, remetente fora da equipe, ativação abaixo e acima de 500 (analista 403, editor pede, dono aprova; mudança no ar e retomar só com `publish_large`), rascunho ao salvar pendente (também quando o banco recusa a gravação), construtor recusado no fluxo de notificação aguardando aprovação, contagem parcial de um envio cortado, duplicar e excluir, retirar passo e teste |
| Integração | `tests/integration/notificacoes-seguintes.test.mjs` (24) | "não abriu" 1 dia depois (Marcar todas não é abrir), "3 h antes de vencer", envio grande esperando, retirar com e sem as seguintes (o número da caixa é o que sai), segundo nível, cancelar agendamento, duplicar, contagem, `sent_as` do fluxo para quem envia uma seguinte, seguinte nova depois do envio, linha de parada, "até a principal sumir"; agendada editada sem 409 falso, Pausar/Encerrar recusados antes do envio, duas telas no relatório, página do botão trocado, quem envia fora da equipe, job que cancela a agendada encerra o fluxo |
| Integração | `tests/integration/sino-validade-e-audio.test.mjs` (9), `tests/integration/segmento-por-notificacao.test.mjs` (7), `tests/integration/visitas-de-pagina.test.mjs` (5) | vencida some e dá 404, comentário com 90 dias, teste para mim, quem envia ao vivo, rota do áudio, abriu × Marcar todas; a mesma contagem com "não ouviram o áudio da X" na prévia, na publicação, no tick, no pop-up e na entrada; visitas só acompanhadas, sem equipe, "ver como" ou pré-carregamento, 10 s, rota |
| Integração | `avisos-e-notificacoes` (36, os 26 da v1 sem mudança), `pop-ups` (11, sem mudança), `admin-area-de-membros` (8), `retencao-de-dados-pessoais` (8) | 409 na notificação de fluxo, remetente, números de engajamento, agendada vencida cancelada; Ícone da escola no PUT; retenção de tarefas, passagens e visitas |
| Ponta a ponta | `produtor-cria-notificacao-seguinte`, `produtor-monta-fluxo`, `aluno-ouve-audio-do-aviso`, `aluno-ve-notificacao-vencer` | notificação com Quem envia: Eu (foto), Promoção, 1 dia e uma seguinte "não abriu" que chega só a quem marcou todas; fluxo pelo modelo com Sim/Não no relatório e o celular; áudio verde que fica depois de recarregar; nome cortado a 375 px e notificação vencida que some. Os 3 da v1 passam sem mudança |

`adiantarFluxo(flowId)` (`tests/e2e/fixtures.ts`) adianta cada tarefa pendente do fluxo pela própria distância até agora (`anchor_at`, `deadline_at` e `due_at` juntos, `not_before` limpo), porque o motor recalcula da âncora; a ordem é sempre tick → `adiantarFluxo` → tick. Testes que gravam fluxos precisam de `created_by`: `limparComunicacao` apaga primeiro os fluxos das contas de teste (o resto vai em cascata) e só depois avisos, notificações, estados de pop-up e visitas.

---

## 11. Roteiro de conferência no ambiente de teste

1. **Aplicar a `202610200002` no Supabase da nuvem antes do merge da PR na `dev`** (a Vercel publica a `dev` sozinha, e o app novo sem a migração não envia nem registra cliques; a migração sozinha não atrapalha o app da v1). A versão é a do repositório, com a RPC 7.15 e as correções M1 a M4 (seção 8.1, Banco; `docs/21` §9):
   - seções 1 a 8 pelo MCP (`apply_migration`, nome `communication_v2`), de uma vez ou em partes, na ordem do arquivo (fluxos → passos → `campaigns` → `notifications` → passagens e tarefas → visitas → RPCs → permissões). O MCP trava em comando que ele acha destrutivo; a 0002 não tem `drop`, mas, se travar, mande a parte pelo SQL Editor;
   - seção 9 (retenção, `delete` dentro da função) pelo SQL Editor;
   - conferir com as consultas do cabeçalho da migração (`sem_fim = 0`), `select count(*) from pg_proc where proname = 'communication_release_flow_tasks'` (1) e `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_engagement_v2'` (sem `read_at`); `list_migrations` mostra `202610200002`. Se partes foram pelo SQL Editor e a versão não aparece: `insert into supabase_migrations.schema_migrations (version, name) values ('202610200002', 'communication_v2') on conflict do nothing;`
   - o tick do ambiente de teste precisa estar ligado (`docs/21` §5).
   - **as correções da revisão**: a `202610210001_communication_v2_fixes.sql` (seções 1 a 6 pelo MCP, nome `communication_v2_fixes`; sem `drop` nem `delete`) antes do merge da correção na `dev`; conferir o gatilho `set_communication_flow_nodes_first_level` e `list_migrations` com `202610210001` (`docs/21` §9.1).
2. Área de membros › Marca › **Ícone da escola**: enviar uma imagem quadrada, publicar; tentar uma não quadrada (recusa); **Usar o símbolo padrão**.
3. Perfil da sua conta: pôr uma foto. Em `/admin/comunicacao/avisos`, **Novo aviso** → Notificação com **Quem envia: Eu**, ícone **Promoção** (a cor vira Vermelho), um botão para um curso, **Fica no sino por 1 dia**, um áudio curto; **Adicionar notificação seguinte**: `5 minutos depois do envio`, `para quem viu no sino, mas não abriu`, conteúdo pela folha; Para quem: um segmento só com alunos de teste (a equipe nunca recebe). **Enviar teste para mim** e conferir no seu sino.
4. Enviar. Com a aluna A: o círculo mostra a sua foto, o ícone antes do título e `Termina em 23 h`; tocar o áudio até o fim (fica verde); recarregar e abrir noutro navegador (continua verde). Com a aluna B: abrir o sino e tocar só em **Marcar todas como lidas**.
5. Depois de 5 minutos e um tick: B recebe a seguinte; A não. No relatório: `Abriram`, `Começaram o áudio` e `Ouviram até o fim`, e a seção Notificações seguintes com `Receberam 1`.
6. Escolher outra pessoa da equipe em Quem envia numa segunda notificação e enviar: uma linha `sent_as` em `email_outbox` para ela (sai pelo Resend se o envio estiver ligado), nenhuma para você.
7. **Retirar do sino** a primeira: a caixa `Retirar também as notificações seguintes que já saíram (1)` vem marcada; a seguinte some do sino de B.
8. `/admin/comunicacao/fluxos` → **Novo fluxo** → **Para quem não abriu**: escolher o produto, Quem entra só com alunos de teste e, para não esperar um dia, trocar `Esperar 1 dia` por `Esperar 5 minutos`; **Ativar fluxo**. No tick seguinte a primeira notificação chega; uma aluna abre o sino sem abrir o cartão; 5 minutos depois a Condição decide e o relatório mostra `Sim` e `Não`; "Você viu a novidade?" chega a ela 1 hora depois da primeira (o intervalo mínimo entre notificações de fluxos; o relatório mostra `Adiadas agora pelo limite do dia` até lá).
9. A 375 px: a lista mostra o cartão com **Pausar**; pausar e retomar pelo cartão; tocar num passo abre o painel em tela cheia com **Concluir**.
10. Notificação com **Até uma data** daqui a pouco mais de 1 hora: some do sino (e do número) quando passa.
