# 32. Produto licenciado: a área de membros instalada no servidor do comprador, com licença, instalação por um comando e o add-on de Webinários (proposta, 10/11/2026)

Data: 10/11/2026. Status: **proposta para o produtor decidir**. Nada aqui está aprovado e nenhum arquivo de código foi alterado para produzir este documento.

Pedido do produtor (04/11/2026, em duas mensagens): vender a área de membros como produto que o comprador instala na estrutura dele, no servidor próprio dele; controle profissional de licenças (o comprador compra 1, 2, 3 ou mais e não pode revender, copiar nem passar adiante; "se piratear, estraga o produto"); os webinários como um segundo produto, acoplado como plugin; uma aula, dentro da nossa área de membros, que ensina a instalar com IA (Claude Code ou Codex); o serviço de instalação para quem não quiser instalar sozinho; e uma instalação "de um clique", por um script que faça tudo em qualquer servidor (Hetzner, Contabo, Hostinger, HostGator) e que a IA consiga rodar e consertar quando algo der errado.

Vale para qualquer trabalho em licenças, no instalador, na entrega das versões, na marca branca ou na venda da área como produto. Enquanto for proposta, não muda nenhuma regra dos outros documentos.

Como foi feito: oito frentes de pesquisa em 04/11/2026 (cinco de mercado, com fonte primária, e três lendo este repositório), cada uma conferida por um verificador independente em 10/11/2026; três desenhos da solução por ângulos diferentes (proteção primeiro, simplicidade para o comprador primeiro e lançar rápido), avaliados por juízes independentes; e um teste de ataque ao desenho final em três papéis (pirata, comprador honesto e engenheiro deste repositório). As fontes estão no §15.

Vocabulário desta página: **Licença** (o direito de usar, comprado na Hotmart ou na Ticto), **Chave** (o código que o comprador recebe), **Instalação** (a área rodando num servidor, num endereço), **Ativar** (ligar uma Chave a uma Instalação), **Manutenção** (versões novas e suporte), **Pacote da versão** (o que o instalador baixa), **Add-on** (módulo comprado à parte, como os Webinários), **Emissor** (o nosso serviço que emite e confere licenças) e **Verificador** (a parte do produto que confere a licença dentro da Instalação do comprador). "O produto" é a área de membros vendida a outras escolas; o nome comercial ainda não existe (A10).

## Resumo em uma página

**Em uma frase.** O comprador paga por Instalação, recebe uma Chave, roda um comando no servidor dele e a área sobe com a marca dele. A Chave decide em quantos servidores o produto roda, libera as versões novas e liga o add-on de Webinários.

| Tema | Proposta |
|---|---|
| **O que é uma Licença** | o direito de rodar **uma Instalação de produção** (um endereço público da área, com o banco dela). Uma Instalação de teste por Licença não conta. Quem quer mais compra a oferta de 3 ou de 10 Instalações |
| **Como paga** | Licença **perpétua** da versão comprada, com **12 meses de Manutenção** incluídos (versões novas e suporte); depois, Manutenção anual opcional. Sem renovar, a área continua funcionando na versão em que está (A1) |
| **O que o comprador recebe** | a Chave, a aula de instalação e o direito de baixar o Pacote da versão: o produto já compilado, os arquivos de instalação e o banco pronto para ser criado. **O código-fonte não é entregue** |
| **Instalação** | um comando, em qualquer servidor Linux com acesso de administrador (VPS): confere a máquina, instala o que falta, baixa o pacote com a Chave, gera as senhas, sobe o banco e a área com HTTPS, cria a primeira conta da equipe, ativa a Licença e confere se está tudo no ar. **Não roda em hospedagem compartilhada** |
| **Com a IA** | o pacote traz as instruções para o Claude Code e o Codex, um comando de diagnóstico que responde em formato de máquina e códigos de erro fixos. A IA instala, lê o diagnóstico e conserta; nenhuma senha passa pelo chat |
| **Controle da Licença** | a Chave só ativa o número de Instalações comprado. Cada Instalação fala com o nosso Emissor uma vez por dia e guarda uma licença assinada que vale 30 dias sem contato. Reembolso e chargeback revogam sozinhos |
| **Manutenção vencida** | nada para. Só não chegam versões novas nem suporte |
| **Licença revogada ou cópia sem licença** | a equipe do comprador perde a edição no admin; os alunos só são afetados no caso extremo (Licença revogada há 30 dias) e os dados nunca são apagados (§2.2) |
| **Webinários** | segundo produto, por Instalação. Já vai dentro do pacote e a Licença liga. A Live gravada e o Replay funcionam sem servidor extra; a Live ao vivo pede um segundo servidor para o vídeo, instalado pelo mesmo kit |
| **Marca do comprador** | nome da escola, logo, cores, e-mails e endereços trocados pela Personalização e pelo instalador, sem tocar no código |
| **Nosso lado** | um Emissor pequeno e nosso, no ar 24 horas, que também entrega os pacotes; a tela **Licenças** no nosso admin e a página **Minhas licenças** para o comprador, dentro da nossa área, ao lado da aula de instalação |
| **Jurídico** | contrato de licença de uso (por Instalação, intransferível, sem revenda), registro do programa no INPI, revogação automática no reembolso de 7 dias; um advogado revisa o contrato antes da primeira venda |
| **Prazo** | cinco fases, de 13 a 16 semanas até a venda aberta; os primeiros compradores piloto podem entrar por volta da 8ª semana, com instalação feita por nós (§12) |

**O que a Licença segura e o que não segura.** Segura o que estraga o negócio: a mesma Chave em vários servidores, a cópia de um servidor inteiro, o comprador que pede reembolso e continua usando, e o repasse do pacote para quem não comprou (sem Chave válida não baixa, não ativa e não atualiza). Não segura uma pessoa técnica que abra o produto compilado e arranque a verificação à mão: nenhum produto instalado no servidor do cliente segura isso, e os fornecedores que tentaram com ofuscação só perderam desempenho. Contra essa pessoa valem o contrato, a lei (a pena e a indenização estão no §9) e o fato de que a cópia dela fica parada no tempo, sem versões novas e sem correções de segurança (§7).

**O que você precisa decidir agora** (detalhes e o padrão assumido no §13.2):

1. Licença perpétua com 12 meses de Manutenção, ou assinatura anual (A1).
2. A escada de ofertas: 1, 3 e 10 Instalações (A2).
3. O que o aluno do comprador vê quando a Licença do comprador é revogada (A3).
4. Se o código-fonte nunca é entregue, ou se existe um plano mais caro que entrega (A7).
5. Se a gravação das lives por hora vira um serviço nosso, cobrado por uso (A8).
6. O nome do produto e o endereço dele na internet (A10).
7. Quem são os compradores piloto e em que condições entram (A14).
8. O advogado que revisa o contrato de licença (A16).

---

## 1. O que o comprador compra

### 1.1 Catálogo (estrutura, sem preços)

| Produto | O que é | Como entra na Hotmart e na Ticto |
|---|---|---|
| **Licença da área de membros** | o direito de rodar 1 Instalação de produção, a aula de instalação e 12 meses de Manutenção | produto de pagamento único (parcelável); as ofertas de **3** e de **10 Instalações** são ofertas do mesmo produto, cada uma com o seu link |
| **Manutenção anual** | mais 12 meses de versões novas e suporte para uma Licença que já existe | assinatura anual de um segundo produto; opcional |
| **Add-on Webinários** | liga os Webinários numa Instalação (§5) | produto próprio, por Instalação, com a mesma regra de Manutenção |
| **Instalação feita por nós** | rodamos o kit no servidor do comprador e entregamos a área no ar (§3.5) | produto de preço fixo e escopo fechado; pode ser oferecido junto no checkout |
| **Horas avulsas** | o que foge da instalação padrão: trazer alunos de outra plataforma, personalização, ajuda com o servidor | pacote de horas com validade |
| **Gravação de lives por hora** (só se A8 for sim) | o nosso gravador grava a live do comprador e entrega o vídeo na Bunny dele | consumo (créditos); nos torna operadores de dados do comprador (§9) |

Por que em ofertas e não "quantidade": não encontramos seletor de quantidade no checkout de produto digital da Hotmart; a Ticto manda `item.quantity`, mas os dois lados precisam se comportar igual. O mercado de software instalado vende em degraus (1, 3, 10, ilimitado) e deixa o comprador subir de degrau pagando a diferença (§8).

### 1.2 O que é uma Licença

- **Uma Instalação de produção** é a área rodando num endereço público (por exemplo `membros.escola.com.br`) com o banco dela. Dois endereços com bancos diferentes são duas Instalações, mesmo no mesmo servidor.
- **Uma Instalação de teste por Licença não conta.** Ela mostra a faixa "Ambiente de teste" no topo do admin e da área, para ninguém vender curso nela (A6).
- **A Licença é do comprador e de uma escola.** Não pode ser revendida, emprestada nem usada para hospedar a área de terceiros. Agência que instala para clientes fica fora da primeira versão: cada escola compra a sua (A12).
- **Uma Chave por compra.** A oferta de 3 Instalações entrega uma Chave que ativa até 3. Compras novas aparecem lado a lado em **Minhas licenças**.

### 1.3 O que o comprador recebe

1. **A Chave**, na página **Minhas licenças** da nossa área de membros (e uma cópia por e-mail).
2. **A aula de instalação**, na mesma área: o comprador da Licença é um aluno nosso, pelo mesmo caminho de qualquer venda (§11.10).
3. **O direito de baixar o Pacote da versão** com a Chave: a imagem do produto já compilada, os arquivos do banco e dos serviços, os scripts de instalação e de operação, as instruções para a IA e a lista assinada do que há no pacote.
4. **Versões novas e suporte** enquanto a Manutenção estiver em dia.

O que ele não recebe: o código-fonte, este repositório, os testes, os documentos internos e o Emissor. Hoje a instalação da nossa produção manda o repositório inteiro para o servidor (`infra/cloud/lib.sh`, `sync_repo`); para o comprador isso muda (§11.6).

### 1.4 O caminho do comprador

1. Compra na Hotmart ou na Ticto. O webhook da venda cria a conta dele na nossa área, libera a aula e emite a Licença (§11.10).
2. Entra na nossa área, abre **Minhas licenças** e vê a Chave, o comando de instalação já preenchido e o botão da aula.
3. Contrata um servidor (a aula mostra três provedores e o tamanho certo) e aponta um endereço para ele.
4. Roda o comando, ou entrega o comando para a IA. Em cerca de 15 minutos a área está no ar com HTTPS e a Licença ativa.
5. Entra com a primeira conta da equipe, troca a marca na Personalização, liga a venda dele (Hotmart ou Ticto dele) e cadastra o primeiro curso.
6. Quando sair versão nova, o admin dele avisa; ele roda **atualizar** (ou pede à IA).

## 2. Como a Licença funciona

### 2.1 Chave, ativação e conferência diária

- **Ativar.** O instalador manda ao Emissor a Chave, o endereço da Instalação e um identificador sorteado na hora. Se a Chave ainda tem Instalação livre, o Emissor devolve uma **licença assinada** por nós: um arquivo pequeno que diz de quem é, para qual endereço vale, quais módulos liga (a área, os Webinários), até quando vai a Manutenção e até quando o próprio arquivo vale (30 dias).
- **Conferir.** O produto confere a assinatura dentro do servidor do comprador, com a nossa chave pública que vai gravada dentro do produto. Não depende da internet para abrir uma página: a conferência usa o arquivo guardado.
- **Renovar o arquivo.** Uma vez por dia, a Instalação fala com o Emissor (pelo mesmo agendador de minuto que já envia e-mails e avisos) e troca o arquivo por um novo, válido por mais 30 dias. É nessa conversa que chegam a revogação, a Manutenção renovada, o add-on comprado depois e o aviso de versão nova.
- **O que a Instalação manda nessa conversa:** o número da Licença, o identificador da Instalação, o endereço, a versão do produto e três contagens redondas (alunos ativos, produtos, lives no mês). Nunca nome, e-mail, IP ou atividade de aluno (§9).
- **Se o nosso Emissor cair,** nada acontece por 30 dias, e existe a chave de emergência (§2.2).

É o mesmo desenho de Coder, Mattermost e GitLab (arquivo assinado conferido no servidor do cliente), com a renovação periódica de Metabase, Grafana e n8n e a tolerância de 30 dias da JetBrains (§15).

### 2.2 O que acontece em cada situação

| Situação | A equipe do comprador | O aluno do comprador | Como sai |
|---|---|---|---|
| Licença ativa, Manutenção em dia | tudo | tudo | |
| **Manutenção vencida** | tudo, na versão instalada; uma linha em Configurações: "Atualizações até 10/11/2027 · Renovar" | tudo | renova quando quiser, sem pagar o tempo parado (A11) |
| **Sem contato com o Emissor** (o nosso fora do ar, ou o servidor do comprador sem saída para a internet) | até 7 dias, nada; do 8º ao 30º dia, uma faixa no admin dizendo desde quando; depois de 30 dias, **admin restrito** | tudo, sempre | volta sozinho no primeiro contato; se a falha for nossa, mandamos uma chave de emergência que vale 12 meses sem contato |
| **Instalação a mais** (a Chave já usou todas) | a ativação é recusada no instalador, com a lista das Instalações ativas | a área nova não sobe | desativar uma Instalação em Minhas licenças, ou subir de oferta |
| **Cópia do servidor inteiro** (clone com a mesma licença) | aviso de conflito nas duas e e-mail ao comprador; em 7 dias sem resolver, a cópia mais nova fica com o admin restrito | tudo | o comprador escolhe qual fica, em Minhas licenças |
| **Licença revogada** (reembolso, chargeback, fraude, quebra do contrato) | faixa "Licença revogada" e **admin restrito** em até 24 horas; a exportação dos dados fica sempre aberta | tudo por 30 dias; depois, uma página neutra: "Plataforma temporariamente indisponível. Fale com a escola" (A3) | comprar de novo reativa na hora |
| **Cópia sem licença** (nunca ativou) | só a tela de ativação | a área não inicia | ativar |

**Admin restrito** quer dizer: a equipe entra, vê tudo, exporta os dados, atende os alunos, e as vendas dela continuam liberando acesso; ela não cria nem edita produtos, aulas, avisos, pop-ups e webinários, nem muda a Personalização. Os dados nunca são apagados e nenhuma situação derruba a área de uma hora para a outra.

Por que assim: o padrão do mercado ao vencer é rebaixar e manter o usuário final funcionando (Mattermost, Metabase, Directus, Replicated); o caso mais duro aceito é o GitLab, que deixa a instância somente leitura. Desligar por controle remoto o sistema de quem está em dia, por um erro nosso, é o risco que todos evitam (§15). Por isso só existe efeito sobre o aluno quando não há mais Licença nenhuma, e depois de 30 dias de aviso.

### 2.3 Trocar de servidor ou de endereço

- **Trocar de servidor:** desativar a Instalação antiga em **Minhas licenças** (ou pelo comando, no servidor antigo), restaurar o backup no servidor novo e ativar. Duas trocas por ano por Instalação sem falar com ninguém; a partir da terceira, pelo suporte (A5). A Manutenção vencida não impede a troca: a Licença é perpétua e servidor quebra.
- **Trocar de endereço** (de `membros.escola.com.br` para `alunos.escola.com.br`): é uma reativação com o endereço novo; conta como troca.
- **Servidor que morreu sem desativar:** o comprador desativa por Minhas licenças; a Instalação antiga, se voltar, cai na regra do conflito.

### 2.4 Minhas licenças (comprador) e Licenças (produtor)

- **Minhas licenças**, na nossa área do aluno, ao lado de Minhas compras: cada Licença com a Chave (mostrar e copiar), as Instalações ativas (endereço, versão, último contato), **Desativar**, a data da Manutenção, os add-ons, o comando de instalação já preenchido, a aula e **Renovar**.
- **Licenças**, no nosso admin, em Configurações: a lista com busca, a origem (venda, cortesia, piloto), as Instalações de cada uma, os alertas de conflito, e as ações **Emitir** (cortesia ou piloto), **Suspender**, **Revogar**, **Reativar** e **Estender a Manutenção**, todas no histórico de auditoria. Só o dono da escola (a mesma regra de Configurações › Vendas).

As duas telas só existem na nossa Instalação: elas aparecem quando a área está ligada ao Emissor (§11.2).

### 2.5 Reembolso, chargeback e cancelamento

- **Reembolso** (os 7 dias do arrependimento valem para toda venda da Hotmart e da Ticto, e a Ticto reembolsa sozinha se o vendedor não responde em 3 dias úteis) e **chargeback**: o webhook que já tratamos hoje revoga a Licença na hora. A Instalação fica sabendo na conferência seguinte, em até 24 horas.
- **Manutenção cancelada ou atrasada:** não revoga nada; só deixa a Manutenção vencer na data.
- **Compra do add-on reembolsada:** só o add-on desliga.
- A decisão olha o histórico inteiro das vendas daquela Licença, como já acontece com os acessos dos alunos (`decideEntitlementAfterSale`), para que a ordem dos reembolsos não mude o resultado.

## 3. Instalação em qualquer servidor

### 3.1 Onde roda e onde não roda

| Onde | Roda? | Observação |
|---|---|---|
| Hetzner Cloud, Contabo VPS, Hostinger VPS, DigitalOcean, Vultr e parecidos | sim | qualquer servidor Linux com acesso de administrador (root) |
| HostGator VPS | sim, com ressalva | o servidor precisa estar sem o painel cPanel/WHM, que ocupa as portas da área; a confirmar no ensaio da fase 2 |
| Hospedagem compartilhada (os planos "de site" da Hostinger e da HostGator) | **não** | não dão acesso de administrador nem deixam rodar Docker |

Requisitos, medidos na nossa produção: Ubuntu 24.04 ou 22.04, ou Debian 12; processador x86-64; 2 vCPU; **4 GB de memória no mínimo** (o instalador cria 2 GB de memória de troca) e 8 GB recomendados; 40 GB de disco; as portas 80 e 443 livres; saída para e-mail pela porta 587; e um endereço apontado para o IP do servidor. Com 2 vCPU e 4 GB, a nossa produção respondeu a 100 alunos de teste navegando sem parar, sem nenhum erro (`docs/20` §12.1).

O que o comprador precisa ter, além do servidor: um domínio; uma conta de e-mail transacional (o Resend, que tem plano grátis; outros provedores ficam para depois, A17); e, para aulas em vídeo, Bunny Stream ou YouTube, como na nossa área.

**Um registro de DNS só.** Hoje a nossa produção usa três endereços (área, API e painel do banco). Para o comprador, o kit serve a área e a API no mesmo endereço e deixa o painel do banco fechado, acessível só por dentro do servidor. É a maior causa de instalação travada a menos (D12).

### 3.2 O comando e o que ele faz

O comprador copia de **Minhas licenças** uma linha parecida com esta (os nomes finais saem na fase 2):

```bash
curl -fsSL https://instalar.<produto>.com.br | sudo bash -s -- --endereco membros.escola.com.br --email dono@escola.com.br --chave-em /root/chave.txt
```

1. **Confere antes de mexer** (não altera nada): sistema, processador, memória, disco, portas, se o endereço aponta para este servidor, saída para a internet e para o e-mail. Se algo falta, para com um código de erro e a frase do que fazer.
2. **Prepara o servidor:** Docker, firewall, memória de troca e atualizações de segurança automáticas (o `infra/scripts/bootstrap.sh` de hoje, sem o que é da Hetzner).
3. **Baixa o Pacote da versão** com a Chave e confere a nossa assinatura.
4. **Gera as senhas e os segredos** num arquivo fechado. Nada disso aparece na tela nem no registro da instalação.
5. **Sobe o banco e os serviços** (o Supabase no próprio servidor) e o HTTPS automático.
6. **Cria o banco** (as migrações do pacote) e liga o agendador de minuto.
7. **Sobe a área.**
8. **Cria a primeira conta da equipe:** convite para o e-mail informado e o mesmo link na tela.
9. **Ativa a Licença.**
10. **Confere o resultado** (área respondendo, login, banco fechado para fora, arquivos, agendador rodando) e mostra o resumo.
11. **Liga o backup diário** e pede o destino fora do servidor (§4).

Rodar de novo continua de onde parou e nunca apaga dados. Depois de instalado, o servidor ganha um comando de operação (nome provisório `membros`) com **status**, **diagnóstico**, **atualizar**, **backup**, **restaurar**, **registros** e **licença**.

### 3.3 O kit para a IA

Não encontramos nenhum produto comercial instalado no servidor do cliente que entregue a instalação por agente de IA como parte oficial do produto; os padrões abertos para isso já existem (§15). O pacote traz:

- **Um `AGENTS.md`**, lido pelo Codex e pelo Claude Code, com a ordem obrigatória (conferir, instalar, diagnosticar), o que nunca fazer (mostrar o arquivo de segredos, apagar os volumes do banco, editar a configuração à mão) e como ler os erros.
- **Uma skill de instalação** no formato aberto de skills, que só chama os mesmos comandos do instalador.
- **Diagnóstico em formato de máquina:** `membros diagnostico --json` devolve a versão, o estado de cada serviço, o banco, as portas, o DNS, o certificado, o disco e as últimas linhas de erro, sem segredos.
- **Códigos de erro fixos e documentados** (por exemplo: porta ocupada, endereço que não aponta para o servidor, memória insuficiente, Chave inválida, limite de Instalações, assinatura do pacote que não confere), cada um com a causa e o conserto.
- **Travas que não dependem de a IA obedecer:** o instalador recusa os comandos destrutivos sem uma confirmação digitada pela pessoa, e a configuração sugerida para o Claude Code nega a leitura do arquivo de segredos.

A Chave, a senha do e-mail e as chaves de vídeo entram por arquivo fechado no servidor ou digitadas no terminal, nunca coladas no chat da IA.

### 3.4 A aula

Dois caminhos, do mais simples ao mais guiado: **(a) um comando**, colado no terminal do servidor; **(b) com a IA**, em que o comprador abre o Claude Code ou o Codex no computador dele, entrega o endereço do servidor e a frase pronta da aula, e a IA entra por SSH, confere, instala e roda o diagnóstico. A aula recomenda a IA no computador do comprador, não dentro do servidor, para a conta dele da Anthropic ou da OpenAI não ficar guardada lá. Também cobre: contratar o servidor em três provedores, apontar o endereço, criar a conta do Resend e verificar o domínio, o primeiro acesso, a Personalização, o backup e uma restauração de teste, a atualização e a troca de servidor.

### 3.5 O serviço de instalação

É o mesmo kit, rodado por nós. Escopo fechado: conferir o servidor que o comprador contratou, apontar o endereço com ele, instalar, configurar o e-mail e o vídeo, criar a primeira conta, ligar o backup, fazer uma restauração de teste e entregar um resumo. Fora do escopo: o custo do servidor e do domínio, trazer alunos de outra plataforma e personalização visual (horas avulsas). O acesso é por uma chave SSH temporária, removida no fim, e os segredos do comprador chegam por envelope cifrado (o `infra/cloud/envelope.sh` de hoje), nunca por chat.

## 4. Atualizações, backup e suporte

- **Versões numeradas** (1.0.0, 1.1.0...) com notas em português na nossa área. O admin do comprador mostra "Versão 1.3.0 disponível" (a notícia chega na conferência diária). Hoje a versão é só o código do commit em `/api/health`.
- **Atualizar** é um comando: faz backup, baixa o pacote novo (com a Manutenção em dia), confere a assinatura, aplica as migrações, troca a imagem, confere e, se a conferência falhar, volta para a imagem anterior. O banco nunca volta de versão: as migrações só acrescentam, como já é regra aqui (`docs/13`).
- **Sem atualização automática na primeira versão.** O comprador decide quando; o Watchtower, que muita gente usava para isso, foi arquivado em 12/2025.
- **Backup** diário, cifrado, com o `restic` que já usamos, para um destino fora do servidor escolhido pelo comprador (qualquer armazenamento compatível com S3 ou SFTP). O instalador não termina sem um destino ou sem o comprador assumir por escrito que o backup fica só no servidor. **Restaurar** é um comando, ensaiado na aula.
- **O banco do próprio servidor** (Supabase) viaja travado em cada versão do pacote; o comprador nunca atualiza o Supabase por fora. Troca de versão maior do Postgres é procedimento à parte, feito como serviço.
- **Suporte:** a Manutenção cobre defeito do produto. Problema do servidor do comprador (disco cheio, provedor fora, DNS) é hora avulsa. O canal e o prazo de resposta são decisão do produtor (A15).

## 5. Add-on de Webinários

### 5.1 O que liga e o que o comprador precisa ter

| Parte | O que precisa, além da área | Observação |
|---|---|---|
| Página de webinários, **Garantir vaga**, lembretes pelo sino e por e-mail | nada | |
| **Live gravada** e **Replay** | a conta da Bunny Stream, a mesma das aulas | sem servidor extra; é o que os serviços de webinário gravado cobram por mês |
| **Live ao vivo** | um segundo servidor para o vídeo (2 vCPU e 4 GB para cerca de 30 a 40 alunos com câmera; 4 vCPU e 8 GB para cerca de 100, pelas contas do `docs/30` §7.1), o endereço `meet.` apontado direto para ele e a porta UDP 10000 aberta | instalado pelo mesmo kit, com o perfil de vídeo; o endereço do vídeo não pode passar pelo proxy da Cloudflare |
| **Gravação da live ao vivo** | primeira versão: **Gravar no navegador** ou **Enviar gravação**, que já existem no console da equipe. Depois: um gravador fixo num servidor de 8 GB, pelo kit; ou o nosso gravador por hora, como serviço (A8) | o gravador de hoje é criado pelo nosso GitHub e pela nossa conta da Hetzner (`src/server/webinars/recorder-dispatch.ts`); não serve ao comprador como está |
| **Assistente** e tradução do chat | a chave de um provedor de IA em Configurações › IA | opcionais |

### 5.2 Como a Licença liga

- **Um pacote só.** Os Webinários já vão dentro do produto; a licença assinada diz se estão ligados. É o padrão de GitLab, Mattermost e n8n: o cliente nunca baixa um produto diferente, a licença destrava (§15).
- **Sem o add-on,** o item do menu, as páginas, as rotas, as tarefas de minuto, a faixa "Ao vivo agora" e a regra **Participação em lives** dos segmentos somem. Nada fica aparecendo com erro.
- **Comprou depois:** liga na conferência diária seguinte, ou na hora pelo comando de licença.
- **As tabelas dos Webinários existem em toda Instalação,** vazias em quem não comprou: as 12 migrações deles mexem em tabelas do núcleo (o sino, o histórico do aluno e o registro das vendas) e não dá para pular.

Por que não um plugin separado, baixado à parte: separar pede transformar em pontos de extensão 11 arquivos do núcleo, a regra de segmentos da Comunicação, o tipo de notificação do sino, 5 tarefas de minuto e 12 migrações, e refazer 18 guardas de teste. O ganho seria o comprador sem o add-on não ter o código no servidor, o que não muda o que alguém consegue burlar. Fica para o dia em que existir um segundo add-on (§13.3).

### 5.3 O que muda no produto antes de vender

- A permissão de câmera e microfone da sala é gravada na hora de gerar a imagem, com `meet.bunker707.com.br` (`next.config.ts`). Passa a ser montada a cada pedido, com o endereço de vídeo de cada Instalação.
- O gravador passa a ter um adaptador com **nenhum** como padrão; o nosso (GitHub mais Hetzner) vira uma das opções, só da nossa Instalação.
- A marca dentro do módulo (os rodapés dos e-mails de live, o nome na sala, o identificador do calendário) passa a vir do nome da escola (§6).
- O kit do servidor de vídeo (`infra/jitsi`) ganha um instalador próprio e uma conferência: endereço sem proxy, portas, e o segredo igual ao da área.

## 6. Marca branca

**O que a Personalização já troca hoje** (Área de membros, no admin): a logo e o ícone, o estilo dos botões, dos cantos e do menu, o destaque da página inicial, as fileiras e a tela de login (quatro chaves em `platform_settings`).

**O que ainda está escrito no código com a nossa marca:**

| Onde | Quanto | Exemplo |
|---|---|---|
| Nome da escola em textos de tela | cerca de 10 textos | o nome no sino, "(c) 2026 Bunker707" no rodapé, a mensagem de login indisponível |
| Título das páginas no navegador | 13 páginas e 2 molduras | "Perfil · Bunker707" |
| E-mails | assuntos, cabeçalho, rodapé, cores e remetente | "Seu acesso à Bunker707 está pronto"; remetente padrão `equipe@mail.bunker707.com.br` |
| Cor de destaque | 1 cor fixa | o vermelho `#e50914` em `src/app/globals.css` |
| Imagens padrão | 10 arquivos em `public/` | a logo, os destaques e a arte do login |
| Termos e Privacidade | não existem | o botão **Termos** do rodapé não faz nada |
| Endereços padrão | 4 | o remetente, o endereço do vídeo, o identificador do calendário, o repositório do gravador |
| Instruções da IA Diretor | 1 | "Você é a IA Diretor da plataforma Bunker707" |

**Proposta:** uma chave nova de configuração, **Escola** (nome, nome curto, assinatura do rodapé, e-mail de suporte, remetente, cor de destaque, ícone do navegador), lida pelas páginas, pelos e-mails, pelo sino, pelo login e pela IA Diretor; o instalador pergunta o nome e o remetente; as imagens padrão viram artes neutras; Termos e Privacidade viram páginas com texto editável; e uma guarda de teste passa a falhar se "Bunker707" voltar a aparecer fora da lista de identificadores técnicos. A linha "Feito com <produto>" no rodapé é decisão do produtor (A9).

## 7. O que a Licença segura e o que não segura

| Controle | O que impede | O que não impede |
|---|---|---|
| Chave com número de Instalações e ativação | a mesma Chave em servidores de amigos; a segunda ativação é recusada | |
| Licença assinada, renovada todo dia, válida 30 dias | usar depois do reembolso ou do chargeback; chave inventada ou arquivo copiado de outra escola (a assinatura não confere) | |
| Sequência trocada a cada conferência | a cópia do servidor inteiro: as duas cópias passam a brigar pela mesma sequência e o Emissor vê o conflito | |
| Pacote só com Chave válida e Manutenção em dia | repassar o instalador: sem Chave não baixa; quem tem cópia antiga fica sem versões novas e sem correções de segurança | a cópia antiga continuar rodando como está |
| Produto compilado, sem código-fonte | manter uma versão paralela: cada versão nova teria de ser alterada de novo, à mão | alguém técnico ler o produto compilado e arrancar a verificação |
| Toda cópia em uso carrega uma licença com o nome do comprador | vazamento anônimo: a cópia aponta para quem a ativou | cópia com a verificação arrancada |
| Contrato, registro no INPI e a lei | dá base para notificar, tirar anúncio do ar e processar quem revende (§9) | |
| Serviços que só nós rodamos (Emissor, pacotes, gravador por hora, se houver) | não funcionam sem Licença | |

O que decidimos não fazer: ofuscar o código (o próprio projeto de ofuscação mais usado diz que a saída "ainda é JavaScript", fica de 15 % a 80 % mais lenta e é vulnerável a análise por IA), compilar para formatos fechados (são descompiláveis e amarram a versão do Node) e derrubar à distância a área de quem está em dia. O comprador típico é um produtor de cursos que não programa; a minoria que consegue arrancar a verificação perde as atualizações e responde pelo contrato. É a mesma posição de Laravel, Sidekiq e dos plugins pagos de WordPress, que entregam até o código-fonte e controlam o canal de atualização (§15).

## 8. Modelo comercial

### 8.1 Unidade e escada

A unidade é a **Instalação de produção**, como o "site" dos plugins de WordPress e a "instalação num domínio" do Kirby. A escada proposta é **1, 3 e 10 Instalações**. No mercado, o degrau de 3 custa de 2 a 2,7 vezes o de 1 (WP Rocket e Gravity Forms), e o de 10, perto de 3 vezes (ACF); ninguém vende "2 licenças": vende o degrau seguinte, e quem sobe paga a diferença.

### 8.2 Perpétua com Manutenção, ou assinatura anual

| | Perpétua + 12 meses de Manutenção (proposta) | Assinatura anual |
|---|---|---|
| O que o comprador sente | comprou um produto | alugou |
| Na Hotmart e na Ticto | pagamento único parcelável; a Manutenção é uma assinatura anual à parte | assinatura anual, com a recuperação de cobrança das plataformas |
| Quando para de pagar | a área continua na versão em que está; perde versões novas, suporte e serviços nossos | algum bloqueio é obrigatório, numa área com alunos pagantes dentro |
| Receita recorrente | depende de o comprador querer as versões novas (publicar notas e o que vem por aí) | previsível |
| Quem faz assim | Craft, Kirby, Unraid, e a JetBrains com a "licença perpétua de reserva" | GitLab, Mattermost, os plugins de WordPress |

A proposta é a perpétua, porque o pedido foi "um produto, não um SaaS", porque não obriga a bloquear a escola de quem só deixou de renovar e porque a lei brasileira já manda informar o prazo de validade técnica da versão e dar suporte durante ele (§9). No mercado, a renovação da Manutenção custa uma fração da licença: perto de 20 % a 25 % ao ano no Craft; os plugins de WordPress renovam pelo preço cheio, mas ali a licença é anual e barata.

### 8.3 Add-on e serviços

- **Webinários:** por Instalação, com a mesma regra de Manutenção.
- **Instalação feita por nós:** preço fixo e escopo fechado (§3.5), como o Discourse fazia com a instalação padrão; o que foge do padrão vira horas, como os pacotes da Odoo.
- **Gravação por hora:** só se o produtor quiser operar um serviço (A8). Contraria o "produto, não SaaS" e nos torna operadores dos dados da live.

### 8.4 Hotmart e Ticto

O que as duas suportam, pelo que foi lido: produto de software com entrega em área de membros externa; várias ofertas com preço e link próprios; assinatura anual, também parcelada; e os avisos de compra, reembolso, chargeback e cancelamento que o nosso sistema já trata. O que confirmar antes de anunciar: com o compliance da Hotmart, que "software instalável com chave e aula" é aceito (a política de uso proíbe software "OEM, NFR, cópias ou backup" e não fala de chaves); e com a análise da Ticto para o produto de assinatura.

## 9. Jurídico

O que a lei brasileira já dá (texto conferido, §15):

- **Lei 9.609/1998 (Lei do Software).** O programa é protegido como obra por 50 anos, sem precisar de registro. O uso é objeto de **contrato de licença** (art. 9º). O contrato e a nota fiscal devem trazer o **prazo de validade técnica da versão** (art. 7º), e quem vende deve dar suporte durante esse prazo (art. 8º): é a nossa Manutenção. Reproduzir ou vender cópia sem autorização, para comércio, é crime com reclusão de 1 a 4 anos e multa (art. 12, §§ 1º e 2º); há ação para proibir o ato, com liminar e perdas e danos (art. 14). O art. 6º lista o que o contrato não pode proibir (a cópia de segurança, por exemplo).
- **Lei 9.610/1998, art. 107** (vale para programas no que couber). Quem altera ou inutiliza o dispositivo técnico que restringe a cópia responde por perdas e danos nunca inferiores ao que resulta do art. 103: o preço dos exemplares vendidos ou, quando não se sabe quantos, de 3.000 exemplares. É o artigo a invocar contra quem arranca a verificação de licença.
- **Código de Defesa do Consumidor, art. 49, e Decreto 7.962/2013.** Sete dias de arrependimento em toda venda pela internet; a Hotmart e a Ticto já aplicam. Por isso toda Licença precisa poder ser revogada na primeira semana (§2.5).
- **LGPD.** O comprador é o controlador dos dados dos alunos dele. Nós só recebemos dados do próprio comprador (contato e Licença) e contagens da Instalação; nunca dados de alunos. Se um serviço nosso tratar dados de alunos (a gravação por hora), viramos operadores e o contrato ganha um anexo.
- **Marco Civil, art. 15.** Quem roda a área (o comprador) guarda os registros de acesso dos alunos por 6 meses. Mais um motivo para a nossa conferência não levar registros de aluno.

Cláusulas do contrato de licença (o texto é do advogado): licença de uso, não cessão; uma Instalação de produção por Licença e uma de teste; uso para a própria escola; intransferível e sem sublicença; proibido revender, redistribuir, hospedar para terceiros ou oferecer como serviço; proibido alterar ou contornar a verificação de licença; as exceções do art. 6º preservadas; o que a conferência diária envia; Manutenção e prazo de validade técnica; o que acontece em cada situação do §2.2, escrito antes da compra; rescisão com prazo para corrigir; limite de responsabilidade; marca; foro. Os textos-modelo que inspiram a redação são a Elastic License 2.0, a Fair Core License e as PolyForm.

Antes da primeira venda: **registrar o programa no INPI** (envia-se só um resumo digital do código, com certificado ICP-Brasil; vale 50 anos e é a prova de autoria para as ações acima) e **registrar a marca do produto**.

O que só o advogado decide (A16): se o CDC vale para o comprador pessoa jurídica (para pessoa física e MEI, quase certamente vale); o limite de responsabilidade e o foro; o texto da página neutra e do bloqueio do §2.2 para não virar prática abusiva; o arrependimento de 7 dias quando a instalação feita por nós já foi entregue; e a tributação da licença e do serviço.

## 10. O nosso lado

- **O Emissor precisa ficar no ar 24 horas a partir da primeira Licença vendida.** Hoje a nossa produção fica guardada em snapshot e só é ligada para testes (`docs/21` §10). Com Licenças na rua, o servidor da área (onde o Emissor roda, na primeira versão) fica ligado: cerca de EUR 6,50 por mês num CX23, mais o backup que já existe. O servidor de marketing e o do vídeo podem continuar guardados até o lançamento da escola.
- **Se o Emissor cair,** os compradores não sentem nada por 30 dias. O Emissor tem backup diário, a chave que assina as licenças fica guardada fora do servidor, e a chave de emergência cobre o pior caso.
- **Os pacotes** ficam num armazenamento de arquivos com link temporário (por exemplo o Bunny Storage, que já usamos, ou o R2 da Cloudflare). Cada versão pesa algumas centenas de megabytes; o custo é de centavos por comprador (A18).
- **Rotina de versão:** toda versão passa primeiro pela nossa própria escola, que roda **a mesma imagem que vendemos** e com uma Licença emitida por nós mesmos (D19). Só depois o pacote é publicado para os compradores, com as notas da versão.
- **Suporte:** um canal, um prazo e uma regra do que é do produto e do que é do servidor do comprador (A15). O diagnóstico em formato de máquina (§3.3) é o que torna o suporte viável: o comprador manda um arquivo, não uma descrição.
- **Segurança:** uma falha no produto passa a valer para todas as escolas que o rodam. A correção sai como versão, o aviso chega pelo admin de cada comprador e por e-mail, e a regra de por quanto tempo quem não renovou recebe correções de segurança é a A11.

## 11. Por dentro

### 11.1 Visão geral

```txt
NOSSO SERVIDOR                                          SERVIDOR DO COMPRADOR
+-----------------------------------+                   +-----------------------------------+
| nossa área (a mesma imagem)       |                   | área do comprador (a mesma imagem)|
|  venda Hotmart/Ticto -> Licença   |     ativar        |  Verificador (src/server/         |
|  Minhas licenças / Licenças       | <---------------- |    licensing): licença assinada,  |
|         | adaptador HTTP          |  conferir, 1x/dia |    situações, módulos ligados     |
|         v                         | <---------------- |  tarefa de minuto: conferência    |
| Emissor (services/                |  pacote da versão |  comando de operação              |
|   bunker-licensing): Chaves,      | ----------------> |  Supabase e Caddy                 |
|   ativações, assinatura, versões  |                   +-----------------------------------+
|   banco: esquema licensing        |
+-----------------------------------+
          | link temporário
          v
   armazenamento dos pacotes
```

### 11.2 Emissor (`services/bunker-licensing`)

- **Onde mora:** numa pasta própria em `services/`, como o `services/bunker-ai-gateway`, com Dockerfile e compose seus, escrito por nós em Node. O banco é um esquema `licensing` no nosso Postgres, com as migrações na própria pasta do serviço; **nunca** em `supabase/migrations`, que vai no pacote do comprador. O `.dockerignore` já tira `services/` da imagem do produto.
- **Por que separado do produto:** (1) a única coisa secreta é a chave privada que assina as licenças, e fora do produto ela nunca se confunde com código entregue; (2) um emissor dentro do produto daria a quem quisesse piratear um servidor de licenças pronto, bastando trocar a chave pública gravada; (3) a nossa escola continua rodando exatamente a imagem que os compradores recebem (D19).
- **Por que construir e não comprar:** nenhuma ferramenta de licenças fala com a Hotmart ou com a Ticto, então a ponte da venda até a Licença seria nossa de qualquer jeito, e ela já existe pela metade (`src/server/payments`). O Keygen CE, a única opção gratuita e completa para rodar em casa, traz um Rails com Sidekiq, Postgres e Redis para operar e sai duas vezes por ano sem correção retroativa; o Keygen Cloud começa em US$ 99 por mês antes da primeira venda. O que precisamos é pequeno: Chave, ativação com limite, conferência, revogação e módulos.
- **API pública** (para as Instalações, em `licencas.<nosso domínio>`): `POST /v1/activate`, `POST /v1/check-in`, `POST /v1/deactivate`, `GET /v1/releases` e `GET /v1/releases/{versão}/bundle`. Limite de pedidos por Chave e por IP; nenhuma resposta diz se uma Chave existe além do necessário.
- **API interna** (só para a nossa área, pela rede interna do compose, com segredo): emitir (idempotente pela transação da venda), suspender, revogar, reativar, estender a Manutenção, listar as Licenças de um comprador, listar Instalações e conflitos.
- **Tabelas:** `licensing.licenses` (o hash da Chave, o comprador, o plano, o máximo de Instalações, os módulos, a situação, a Manutenção até, a venda de origem), `licensing.installations` (a Licença, o identificador da Instalação, o endereço, produção ou teste, a situação, a primeira e a última conferência, a versão, o hash da sequência, o conflito desde), `licensing.license_events` (auditoria) e `licensing.releases` (a versão, a data, o caminho do pacote, o resumo sha256, as notas, se é correção de segurança).
- **A chave que assina:** Ed25519, que o Node assina e confere sozinho (`node:crypto`), sem biblioteca. A privada fica num arquivo fechado do serviço, com cópia fora do servidor. A pública vai gravada no produto com um identificador, e uma segunda chave pública de reserva já vai embutida para o dia da troca.
- **A sequência:** cada conferência devolve um número sorteado que a Instalação guarda e apresenta na conferência seguinte. Duas cópias do mesmo servidor passam a apresentar sequências diferentes; é assim que o clone aparece.

### 11.3 Verificador (`src/server/licensing`)

| Arquivo | O que faz |
|---|---|
| `model.ts` (puro) | o formato da licença assinada, as situações do §2.2, os prazos e o que cada situação permite |
| `artifact.ts` (puro) | lê a licença e confere a assinatura com as chaves públicas gravadas |
| `client.ts` (`server-only`) | ativar, conferir e desativar no Emissor, com tempo limite e erros tipados, no molde de `src/server/ai/account-gateway.ts` |
| `store.ts` | a tabela `license_state` (uma linha: a licença assinada, a sequência, a última conferência, o identificador da Instalação), só do servidor |
| `state.ts` | a situação lida uma vez por pedido e guardada em cache, invalidada pela tarefa |
| `require-feature.ts` | `isFeatureEnabled` e `requireFeature`, a fonte única dos módulos ligados |
| tarefa `licenca-conferencia` | entra em `src/server/jobs/registry.ts`; roda no agendador de minuto e trabalha uma vez por dia, numa hora sorteada; uma falha de rede só marca a tarefa como falha e a licença guardada continua valendo |

- **Onde a situação é lida:** em `runAdminAction` e `requireApiRole` (o admin restrito), na moldura do admin (a faixa, no molde do `PendingMigrationNotice`), em `getAppShellData` (a página neutra do caso extremo e a faixa de teste) e nos pontos do add-on (§11.8). Nunca em `src/proxy.ts` e nunca com chamada de rede no caminho de um pedido: o Emissor fora do ar não pode deixar uma página lenta.
- **Por que tabela própria e não `platform_settings`:** a `platform_settings` inteira entra no cache do catálogo que toda página do aluno lê.
- **Relógio:** licença emitida "no futuro" é recusada; a última hora vista fica gravada; se o relógio voltar, a Instalação pede uma conferência antes de qualquer outra decisão.
- **Sem Licença em desenvolvimento e nos testes:** modo vazio, como as outras variáveis opcionais. A guarda `tests/infra-compose-env.guard.test.mjs` exige que a variável nova esteja em `.env.example`, em `infra/compose/.env.example` e no compose.

### 11.4 Os três artefatos

| Artefato | O que é | Quem guarda |
|---|---|---|
| **Chave** | um texto curto e sorteado; o Emissor guarda só o hash | o comprador, em Minhas licenças |
| **Licença assinada** | um JSON com o número da Licença, o identificador e o endereço da Instalação, produção ou teste, os módulos, a Manutenção até, emitida em, vale até (30 dias), a versão do formato e o identificador da chave; mais a assinatura | a Instalação, em `license_state` |
| **Pacote da versão** | um arquivo com a imagem do produto, os arquivos do compose e do Caddy, as migrações, os scripts, o `AGENTS.md` e um manifesto assinado com o resumo de cada parte | o armazenamento dos pacotes; baixado com a Chave |

### 11.5 Uma imagem para todos

Hoje o endereço do Supabase e a chave publicável entram no JavaScript do navegador na hora de gerar a imagem (os `ARG NEXT_PUBLIC_*` do `Dockerfile`; seis arquivos de cliente e as origens de imagem do `next.config.ts` leem esses valores), e o deploy da nossa produção gera uma imagem com os endereços dela. Para vender, a imagem tem de ser a mesma para todos:

- a configuração pública passa a ser entregue ao navegador pelo servidor, a cada página, e o código do servidor passa a ler variáveis de execução;
- a permissão de câmera e microfone e as origens de imagem saem da geração da imagem;
- uma guarda nova gera a imagem sem nenhuma variável pública, confere que ela não contém `bunker707.com.br` e sobe duas escolas diferentes com ela no ensaio.

Caminhos descartados: gerar uma imagem por comprador no nosso CI (não escala e atrasa cada atualização) e gerar no servidor do comprador (entrega o código-fonte e pede 2 GB livres).

### 11.6 Pacote da versão e migrações

- O pacote substitui o envio do repositório inteiro ao servidor.
- As migrações vão no pacote e são aplicadas por um migrador nosso, em `psql`, dentro do contêiner do banco, que grava no mesmo histórico da CLI do Supabase (`supabase_migrations.schema_migrations`). A nossa produção continua compatível e o servidor do comprador não precisa da CLI.
- O registro do agendador de minuto (hoje em `infra/cloud/deploy.sh`) e a primeira conta da equipe (hoje `infra/cloud/equipe.sh`) passam para o instalador.
- **Entrega:** baixar com a Chave, por link temporário, e carregar a imagem com `docker load`. Um registry com credencial por Licença (o registry oficial com um servidor de token nosso) fica para quando o tamanho dos downloads incomodar. O GHCR, onde a imagem é publicada hoje, não serve para isso: só aceita token pessoal clássico, sem credencial por cliente.

### 11.7 Instalador e comando de operação

- **O que reaproveita:** `infra/scripts/bootstrap.sh`, o compose e o Caddy de `infra/compose`, o `generate-secrets`, o `smoke.sh`, o `backup.sh` e o `restore.sh` (com destino genérico). **O que fica de fora:** tudo de `infra/cloud` (Hetzner, Cloudflare e GitHub Actions), `infra/terraform` e `infra/mautic`.
- **Cloudflare opcional:** o Caddy tira o certificado direto; uma opção liga as faixas da Cloudflare para quem usa.
- **Sem perguntas:** tudo por opções ou por arquivo; `--conferir` roda só a conferência e `--simular` mostra o que faria.
- **Testes:** um teste de comportamento do instalador com a infra de mentira que os `tests/infra-*.test.mjs` já usam, e um ensaio em máquina limpa no CI.

### 11.8 Guardas do add-on

Fonte única: `isFeatureEnabled("webinars")`. Os pontos, contados no código:

- as 8 páginas (3 do aluno e 5 do admin);
- as 24 rotas (17 delas passam por `guardRoomRequest`, em `src/server/webinars/room-route.ts`) e os 3 webhooks do gravador e da sala;
- as 63 ações do admin, por uma opção nova em `runAdminAction` (`src/server/actions/run-action.ts`);
- as 5 tarefas em `src/server/jobs/registry.ts`;
- o menu do aluno (`src/lib/member-navigation.ts`), a faixa "Ao vivo agora" (`src/components/app-shell.tsx`) e a fileira da página inicial (`src/app/page.tsx`);
- o menu, a busca e o Hoje do admin, a aba da Comunicação e a regra **Participação em lives**.

A ordem importa: o menu e a faixa somem junto com o bloqueio das rotas, para o navegador do aluno não bater num erro a cada minuto. Testes: uma guarda de arquitetura e um teste de comportamento com a licença sem o add-on; os testes de ponta a ponta ganham a variação "sem add-on".

### 11.9 Marca branca no código

A chave `school` em `platform_settings`; os títulos por `generateMetadata`; os e-mails (`src/server/email/templates` e `config.ts`, com o remetente obrigatório, sem padrão nosso); a cor por variável CSS, como já são os cantos e os botões; as imagens neutras; as páginas de Termos e Privacidade; e a guarda `tests/marca-branca.guard.test.mjs`. Os identificadores técnicos (`bunker707:*` no navegador, o rótulo do guarda da sala) ficam: são contratos com o motor de vídeo e com o navegador, invisíveis ao aluno.

### 11.10 Da venda à Licença

- `sales_product_links` ganha uma coluna opcional com o plano de Licença: a mesma venda libera a aula (o alvo de hoje) e emite a Licença daquele plano.
- `src/server/payments/process-sale.ts` ganha o passo de emissão, por um adaptador HTTP para o Emissor, idempotente pela transação; reembolso e chargeback chamam a revogação, com a mesma decisão por histórico de hoje.
- **Minhas licenças** segue o molde de `src/app/minhas-compras`; **Licenças** segue o de Configurações › Vendas, com uma permissão nova só do dono.
- Tudo isso só liga com o endereço do Emissor configurado, o que só acontece na nossa Instalação.

### 11.11 Testes

Pelo `docs/18`: toda PR com teste de comportamento. Um teste por transição do §2.2 (ativa, Manutenção vencida, sem contato, revogada, conflito, sem licença, renovada); integração contra o banco local para `license_state`; ponta a ponta para o admin restrito e para a página neutra; os testes próprios do Emissor; e guardas: nenhuma variável de licença com `NEXT_PUBLIC_`, a situação lida só pelo módulo único, e nenhuma rota do aluno bloqueada fora de `getAppShellData`.

## 12. Fases e PRs

| Fase | O que entra | Pronta quando | Semanas |
|---|---|---|---|
| **1. Produto instalável** | marca branca (§6 e §11.9); uma imagem para todos (§11.5); os padrões nossos fora do código (remetente, endereço do vídeo, gravador com **nenhum** por padrão, Cloudflare opcional) | a mesma imagem sobe duas escolas com marcas e endereços diferentes no ensaio local, e a guarda de marca passa | 3 a 4 |
| **2. Instalador e kit** | o Pacote da versão e o migrador (§11.6); o instalador e o comando de operação (§3.2 e §11.7); o backup com destino genérico; um endereço só (D12); o kit da IA (§3.3); versões numeradas | instalação do zero em cerca de 15 minutos em três provedores (Hetzner, Contabo e Hostinger VPS), por comando e pela IA; atualização e restauração ensaiadas; a nossa própria produção reinstalada pelo kit | 3 a 4 |
| **3. Licenças** | o Emissor (§11.2); o Verificador e as situações (§11.3); da venda à Licença, Minhas licenças e Licenças (§11.10); o pacote baixado com a Chave | as sete situações do §2.2 reproduzidas em teste; uma compra de teste na Hotmart e outra na Ticto viram Chave em Minhas licenças; o reembolso revoga; a nossa escola roda com Licença emitida por nós | 3 a 4 |
| **4. Add-on Webinários** | as guardas (§11.8); o kit do servidor de vídeo neutro de provedor; o gravador atrás de adaptador (§5.3) | a mesma Instalação com e sem o add-on nos testes; uma live ao vivo num servidor de vídeo instalado pelo kit fora da Hetzner | 2 |
| **5. Piloto e lançamento** | o contrato revisado, o INPI, o nome e a marca do produto, a página de venda, a aula, o canal de suporte e de 3 a 5 compradores piloto | os pilotos no ar, pelo menos dois instalados sozinhos com a IA; a primeira atualização entregue a eles | 2 |

Total: de 13 a 16 semanas. A fase 4 pode correr junto com a 3. O jurídico (contrato, INPI e marca) começa na fase 1, porque depende de terceiros. Cada linha vira de 3 a 5 PRs para a `dev`, com teste de comportamento, no fluxo do `CONTRIBUTING.md`.

**Atalho para vender antes:** com a fase 2 pronta (por volta da 8ª semana), dá para colocar os primeiros pilotos com instalação feita por nós e contrato assinado, antes das licenças completas. Os pilotos recebem a licença na primeira atualização depois da fase 3.

## 13. Decisões

### 13.1 Propostas

| # | Decisão | Por quê | O que muda se mudar |
|---|---|---|---|
| D1 | A unidade da Licença é a Instalação de produção; uma de teste por Licença não conta | é o "site" dos plugins e a "instalação num domínio" do Kirby; não exige contar alunos nem mandar dados deles | licença por aluno ativo pede telemetria de alunos e acerto de contas periódico |
| D2 | Perpétua com 12 meses de Manutenção (A1) | "produto, não SaaS"; não obriga a bloquear quem não renova; casa com o pagamento único parcelado | assinatura anual pede definir o bloqueio no vencimento e muda as ofertas |
| D3 | O comprador recebe o produto compilado, nunca o código-fonte (A7) | o comprador típico não programa; sem o código não dá para manter uma versão paralela | entregar o código facilita a cópia e o suporte a versões alteradas |
| D4 | Emissor próprio e mínimo, em `services/bunker-licensing`, fora da imagem e do pacote | §11.2 | Keygen CE: mais um sistema para operar; Keygen Cloud: US$ 99 por mês |
| D5 | Licença assinada com Ed25519, conferida no servidor do comprador com a chave pública gravada no produto; vale 30 dias | padrão de Coder, Mattermost e Keygen; funciona com o Emissor fora do ar | sem assinatura, qualquer servidor falso emitiria licenças |
| D6 | Conferência uma vez por dia, pela tarefa de minuto; nunca no caminho de um pedido | Metabase, Grafana e n8n renovam em segundo plano; o Emissor fora do ar não deixa página lenta | conferir a cada pedido derrubaria as escolas junto com o Emissor |
| D7 | As situações do §2.2: o aluno só é afetado com a Licença revogada há 30 dias (A3) | o mercado rebaixa e mantém o usuário final; o teto aceito é o somente leitura do GitLab | bloquear o aluno mais cedo aumenta o risco jurídico e de reputação |
| D8 | Entrega por pacote baixado com a Chave e assinatura conferida; registry depois | simples, sem serviço de registry para operar; revogar a Chave corta as versões novas | registry próprio: downloads menores, mais um serviço 24 horas |
| D9 | Uma imagem para todos, com a configuração pública em tempo de execução | sem isso, cada comprador exigiria uma imagem só dele | §11.5 |
| D10 | Migrações no pacote, aplicadas por migrador próprio; o banco nunca volta de versão | tira a CLI do Supabase do servidor do comprador; as migrações já são aditivas | manter a CLI amarra o comprador a uma ferramenta que muda toda semana |
| D11 | Instalador de um comando, sem perguntas, que continua de onde parou; mais o comando de operação | padrão de Coolify, Dokploy, Sentry e Ghost | |
| D12 | Um endereço só para a área e a API no kit do comprador; o painel do banco fechado | um registro de DNS em vez de três; menos instalações travadas | a validar na fase 2; se não der, dois registros (área e API) |
| D13 | Kit da IA: um `AGENTS.md`, uma skill, diagnóstico em JSON, códigos de erro e travas no próprio instalador | os padrões abertos existem; o que não pode falhar vira trava, não texto | |
| D14 | Webinários no mesmo pacote, ligados pela Licença; as migrações deles sempre aplicadas | padrão de GitLab, Mattermost e n8n; separar custa caro e não protege mais | §5.2 |
| D15 | Gravador atrás de adaptador, com **nenhum** por padrão | o de hoje depende do nosso GitHub e da nossa Hetzner | |
| D16 | Marca branca por configuração, com guarda de teste | o comprador não toca no código | |
| D17 | A conferência envia só Licença, Instalação, endereço, versão e contagens redondas | LGPD e Marco Civil; o comprador é o controlador dos dados dos alunos | qualquer dado de aluno nos tornaria operadores |
| D18 | A venda vira Licença pelo caminho de vendas que já existe; Minhas licenças e Licenças só na nossa Instalação | reaproveita webhooks, reprocesso e decisão por histórico | |
| D19 | A nossa escola roda a mesma imagem vendida, com Licença emitida por nós | toda versão é testada em produção por nós antes de chegar ao comprador | |
| D20 | Sem atualização automática na primeira versão; o comprador roda **atualizar** | o Watchtower foi arquivado; backup antes e volta atrás são nossos | |

### 13.2 Abertas para o produtor, com o padrão assumido

| # | Pergunta | Padrão assumido até a resposta |
|---|---|---|
| A1 | Licença perpétua com 12 meses de Manutenção, ou assinatura anual? | perpétua com 12 meses de Manutenção |
| A2 | A escada de ofertas | 1, 3 e 10 Instalações; quem sobe paga a diferença |
| A3 | Licença revogada: o aluno do comprador nunca é bloqueado, ou vê a página neutra depois de 30 dias? | página neutra depois de 30 dias, com o texto revisado pelo advogado |
| A4 | Quantos dias a Instalação funciona sem falar com o Emissor | 30 dias; aviso no admin a partir do 8º |
| A5 | Trocas de servidor ou de endereço por ano, sem falar com o suporte | 2 por Instalação |
| A6 | Instalação de teste sem custo | 1 por Licença, com a faixa "Ambiente de teste" |
| A7 | O código-fonte nunca é entregue, ou existe um plano mais caro que entrega? | nunca |
| A8 | A gravação das lives por hora vira um serviço nosso, por consumo? | não na primeira versão; o comprador grava no navegador ou envia a gravação |
| A9 | "Feito com <produto>" no rodapé da área do comprador | discreto, e a equipe do comprador pode tirar |
| A10 | Nome do produto, marca e endereço na internet | a decidir antes da fase 2 (o instalador e os comandos levam o nome) |
| A11 | Manutenção vencida: quem volta paga o tempo parado? Recebe correção de segurança por quanto tempo? | não paga o tempo parado; correções críticas por 12 meses depois do vencimento |
| A12 | Agência pode instalar para os clientes dela? | não na primeira versão; cada escola compra a sua |
| A13 | O comprador pode usar o Supabase da nuvem no lugar do banco no próprio servidor? | não na primeira versão |
| A14 | Compradores piloto: quantos, quem e em que condições | de 3 a 5, com instalação feita por nós e preço de piloto |
| A15 | Suporte: canal e prazo de resposta | pela área de membros, em dias úteis; a definir |
| A16 | Advogado: quem revisa o contrato de licença, o texto das situações do §2.2 e o arrependimento depois da instalação feita | contratar antes da fase 3 |
| A17 | E-mail do comprador: só Resend na primeira versão, ou qualquer provedor? | só Resend; outros provedores numa versão seguinte |
| A18 | Onde ficam os pacotes e quanto pode custar por mês | o Bunny Storage, que já usamos; poucos reais por mês |

### 13.3 O que fica de fora da primeira versão

Registry próprio; servidores com processador ARM; várias escolas numa mesma Instalação; o plano de agência; a gravação hospedada por nós; o gateway de IA para login por conta (o Tutor IA funciona com chave de API); o Mautic; a atualização automática; a ofuscação do código; uma loja de add-ons; a separação física dos Webinários num pacote à parte.

## 14. Riscos

- **Suporte de servidor para leigos.** O comprador típico nunca administrou um servidor. O instalador, o diagnóstico e a IA reduzem, mas não zeram. Sem a regra do que é do produto e do que é do servidor do comprador (A15), o suporte engole o tempo da equipe.
- **Uma versão que quebra no servidor do comprador.** Cada servidor é um ambiente diferente. Mitigação: backup antes de atualizar, volta atrás da imagem, a nossa escola primeiro (D19) e os pilotos antes da venda aberta.
- **O Emissor fora do ar ou a chave que assina perdida.** A tolerância de 30 dias e a chave de emergência cobrem a queda; a cópia da chave privada fora do servidor cobre a perda; a segunda chave pública embutida cobre a troca.
- **Falha de segurança no produto.** Passa a valer para todas as escolas que o rodam. Pede um canal para receber avisos, correção rápida e a regra da A11.
- **A verificação arrancada e publicada.** Aceito (§7). O que resta é o contrato, a lei e a cópia parada no tempo.
- **Compliance da Hotmart e da Ticto.** Um "não" para software com chave muda o canal de venda, não o produto.
- **Jurídico.** O bloqueio do aluno no caso extremo e a limitação de responsabilidade dependem do advogado (A16).
- **Duas frentes com a mesma equipe.** A escola ainda não lançou e o produto pede de 13 a 16 semanas. As fases 1 e 2 também servem à escola (marca, instalador e atualização da nossa própria produção); as fases 3 a 5 são só do produto.
- **O banco no servidor do comprador.** Troca de versão maior do Postgres e disco cheio são operações que o comprador não sabe fazer. Ficam como serviço e entram no diagnóstico (aviso de disco e de versão).

## 15. Fontes

Lidas em 04/11/2026 e conferidas em 10/11/2026. Os resumos completos de cada frente e as notas de conferência ficaram no scratchpad da sessão que escreveu esta página.

- **Licenças em produtos instalados no servidor do cliente.** Coder: licença em arquivo assinado com Ed25519, conferida sem internet (https://coder.com/docs/admin/licensing e https://github.com/coder/coder/blob/main/enterprise/coderd/license/license.go). Mattermost: licença assinada, carência de 10 dias no código, volta ao plano gratuito ao vencer, chave separada para ambiente que não é produção (https://github.com/mattermost/mattermost/blob/master/server/public/model/license.go e https://docs.mattermost.com/product-overview/self-hosted-subscriptions.html). GitLab: código de ativação ou arquivo, instância somente leitura ao vencer (https://docs.gitlab.com/administration/license_file/ e https://about.gitlab.com/pricing/licensing-faq/cloud-licensing/). Metabase: conferência a cada 12 horas, com 36 horas de tolerância, e volta à edição aberta sem o token (https://github.com/metabase/metabase/blob/master/src/metabase/premium_features/token_check.clj). n8n: chave de ativação com teto de ativações e renovação automática (https://docs.n8n.io/hosting/configuration/environment-variables/licenses/). Directus: licença amarrada ao endereço público, desativar libera a vaga, "a aplicação nunca apaga dados" (https://directus.com/docs/licensing/overview). Grafana: licença ligada ao endereço e renovada a cada 24 horas (https://grafana.com/docs/grafana/next/administration/enterprise-licensing/). Replicated: instância com licença vencida continua rodando, sem baixar imagens nem atualizar (https://docs.replicated.com/vendor/licenses-about). JetBrains: 30 dias sem internet e a licença perpétua de reserva (https://sales.jetbrains.com/hc/en-gb/articles/206544169 e https://sales.jetbrains.com/hc/en-gb/articles/207240845). Unraid: licença perpétua com um ano de atualizações e uma troca automática de dispositivo a cada 12 meses (https://docs.unraid.net/unraid-os/troubleshooting/licensing-faq/).
- **Ferramentas de licença.** Keygen: licença Fair Core, requisitos para rodar em casa, políticas, arquivos de licença assinados com validade e preços da nuvem (https://raw.githubusercontent.com/keygen-sh/keygen-api/master/LICENSE.md, https://keygen.sh/docs/self-hosting/, https://keygen.sh/docs/api/policies/, https://keygen.sh/docs/api/cryptography/ e https://api.keygen.sh/v1/plans?limit=100). Cryptlex, LicenseSpring, 10Duke e Replicated: preços (https://cryptlex.com/pricing, https://licensespring.com/pricing, https://www.10duke.com/resources/faq/ e https://www.replicated.com/pricing). Assinatura Ed25519 nativa do Node (https://nodejs.org/api/crypto.html).
- **Hotmart e Ticto.** Formatos de produto, área de membros externa e taxas da Hotmart (https://suportehotmart.zendesk.com/hc/pt-br/articles/360016600591 e https://suportehotmart.zendesk.com/hc/pt-br/articles/215827858); webhook 2.0.0 (https://developers.hotmart.com/docs/en/2.0.0/webhook/purchase-webhook/); ofertas, planos de assinatura e política de uso (https://help.hotmart.com/pt-br/article/215827788, https://help.hotmart.com/pt-br/article/208424858 e https://hotmart.com/pt-br/legal/politicas-de-uso). Ticto: webhook v2 e reembolso (https://webhook.ticto.dev/docs/v2, https://help.ticto.com.br/sou-produtor/tictools-integracoes/webhook e https://help.ticto.com.br/comprei-pela-ticto/reembolsos-e-suporte/solicitar-reembolso-prazo-e-regras-do-termo-geral-de-compra).
- **Entrega das versões.** GHCR só com token pessoal clássico (https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry); registry oficial com servidor de token (https://distribution.github.io/distribution/spec/auth/token/); Harbor e contas de robô (https://goharbor.io/docs/2.13.0/administration/robot-accounts/); `docker save` e `docker load` (https://docs.docker.com/reference/cli/docker/image/save/); assinatura de imagem (https://docs.sigstore.dev/cosign/signing/signing_with_containers/).
- **Instaladores de um comando.** Coolify (https://coolify.io/docs/get-started/installation e https://coolify.io/docs/get-started/upgrade), Dokploy (https://docs.dokploy.com/docs/core/installation), Supabase no próprio servidor (https://supabase.com/docs/guides/self-hosting/docker), Sentry (https://develop.sentry.dev/self-hosted/ e https://github.com/getsentry/self-hosted/blob/master/install.sh), Discourse (https://github.com/discourse/discourse/blob/main/docs/INSTALL-cloud.md) e Ghost (https://docs.ghost.org/ghost-cli/). Watchtower arquivado em 12/2025 (https://linuxiac.com/docker-update-tool-watchtower-reaches-end-of-maintenance/). Hospedagem compartilhada sem acesso de administrador (https://www.hostgator.com/help/article/hosting-comparison-chart) e os modelos de VPS da Hostinger (https://www.hostinger.com/support/vps/vps-os-and-templates/).
- **Instalação por IA.** `AGENTS.md` (https://agents.md/), como o Codex e o Claude Code o leem (https://learn.chatgpt.com/docs/agent-configuration/agents-md e https://code.claude.com/docs/en/memory), o formato de skills (https://agentskills.io/specification) e as boas práticas do Claude Code para o que não pode falhar (https://code.claude.com/docs/en/best-practices).
- **Proteção do código e quem convive com cópias.** Ofuscação: "a saída ainda é JavaScript", de 15 % a 80 % mais lenta (https://github.com/javascript-obfuscator/javascript-obfuscator); bytecode não é cifra (https://github.com/bytenode/bytenode). Sidekiq: código entregue, credencial do servidor de pacotes ligada à assinatura (https://github.com/sidekiq/sidekiq/wiki/Commercial-FAQ). Laravel Nova: código entregue por repositório autenticado pela licença e conferência do endereço de produção (https://nova.laravel.com/docs/v5/installation). Plugins de WordPress quando a licença vence: WP Rocket (https://docs.wp-rocket.me/article/1711-what-happens-if-my-license-expires), Gravity Forms (https://docs.gravityforms.com/license-expiry/), ACF (https://www.advancedcustomfields.com/?p=444079) e Elementor (https://elementor.com/help/what-happens-to-my-site-if-i-cancel-elementor-pro/).
- **Modelo comercial.** Gravity Forms, ACF e WP Rocket: preços por número de sites (https://www.gravityforms.com/pricing/, https://www.advancedcustomfields.com/pro/ e https://wp-rocket.me/pricing/); Craft: licença perpétua com um ano de atualizações e renovação perto de 20 % (https://craftcms.com/knowledge-base/how-craft-licenses-and-renewals-work); Kirby: uma instalação num domínio (https://getkirby.com/buy); Discourse: instalação padrão por preço fixo (https://meta.discourse.org/t/what-does-one-time-install-include/21488); Odoo: pacotes de horas (https://www.odoo.com/pricing-packs); Mattermost Calls: gravação que exige servidor próprio do cliente (https://docs.mattermost.com/deployment-guide/calls/calls-deployment-guide).
- **Lei brasileira.** Lei 9.609/1998 e Lei 9.610/1998 (https://www2.camara.leg.br/legin/fed/lei/1998/lei-9609-19-fevereiro-1998-364738-publicacaooriginal-1-pl.html e https://www2.camara.leg.br/legin/fed/lei/1998/lei-9610-19-fevereiro-1998-365399-publicacaooriginal-1-pl.html); Código de Defesa do Consumidor e Decreto 7.962/2013 (https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-publicacaooriginal-1-pl.html e https://www2.camara.leg.br/legin/fed/decret/2013/decreto-7962-15-marco-2013-775557-publicacaooriginal-139266-pe.html); Marco Civil (https://www2.camara.leg.br/legin/fed/lei/2014/lei-12965-23-abril-2014-778630-publicacaooriginal-143980-pl.html); guia de agentes de tratamento da ANPD (https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/Segunda_Versao_do_Guia_de_Agentes_de_Tratamento_retificada.pdf); registro de programa no INPI (https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/guia-basico). Licenças-modelo: Elastic License 2.0 (https://www.elastic.co/licensing/elastic-license), Fair Core License (https://fcl.dev/) e PolyForm (https://polyformproject.org/licenses/internal-use/1.0.0).
- **Repositório.** `AGENTS.md`, `CONTRIBUTING.md`, `Dockerfile`, `.dockerignore`, `next.config.ts`, `infra/compose`, `infra/scripts`, `infra/cloud`, `infra/jitsi`, `services/bunker-ai-gateway`, `src/proxy.ts`, `src/server/payments`, `src/server/jobs`, `src/server/webinars`, `src/server/member-area`, `src/server/email`, `supabase/migrations`, `docs/05`, `docs/13`, `docs/18`, `docs/19`, `docs/20`, `docs/21`, `docs/30` e `docs/31`.
