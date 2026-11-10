# 32. Produto licenciado: a área de membros instalada no servidor do comprador, com Licença anual ou vitalícia, instalação por um comando e módulos vendidos à parte (proposta, 10/11/2026)

Data: 10/11/2026. Status: **proposta em discussão**. Em 10/11/2026 o produtor respondeu à primeira versão desta página e decidiu três pontos, listados logo abaixo; o resto continua esperando a decisão dele. Nada foi construído e nenhum arquivo de código foi alterado para produzir este documento.

Pedido do produtor (04/11/2026, em duas mensagens): vender a área de membros como produto que o comprador instala na estrutura dele, no servidor próprio dele; controle profissional de licenças (o comprador compra 1, 2, 3 ou mais e não pode revender, copiar nem passar adiante; "se piratear, estraga o produto"); os webinários como um segundo produto, acoplado como plugin; uma aula, dentro da nossa área de membros, que ensina a instalar com IA (Claude Code ou Codex); o serviço de instalação para quem não quiser instalar sozinho; e uma instalação "de um clique", por um script que faça tudo em qualquer servidor (Hetzner, Contabo, Hostinger, HostGator) e que a IA consiga rodar e consertar quando algo der errado.

**O que o produtor respondeu em 10/11/2026**, depois de ler a primeira versão desta página:

1. **Decidiu:** a Licença é **anual**, com **anos adicionais** comprados à parte, ou **vitalícia**. Os preços ele define depois (§8.2).
2. **Decidiu:** uma Licença vale para **uma área de membros**. Ninguém usa de graça: nem outra pessoa, nem o próprio cliente em vários ambientes ou em várias áreas (§1.2 e §7).
3. **Decidiu:** os Webinários e os módulos que vierem são **vendidos à parte**, numa lista de módulos dentro da área de membros da Bunker707, onde ficam também os nossos cursos e a compra da área. Só compra módulo quem comprou a área (§5.1).
4. **Perguntou** se precisa de um painel para gerenciar as licenças e sugeriu algo só para os clientes do produto, num subdomínio de `bunker707.com.br`. A resposta desta página é sim (§2.4 e §10); falta ele confirmar.
5. **Pediu** que toda a configuração seja clara e simples, a ponto de virar diferencial e não objeção, e perguntou como o cliente põe o domínio dele, por exemplo `alunos.meucurso.com` (§3.1).
6. **Não entendeu** para que serve o advogado. A explicação em palavras simples está no começo do §9.

O que essas respostas mudaram, e o que ainda depende dele, está no §13.

Vale para qualquer trabalho em licenças, no instalador, na entrega das versões, na marca branca, nos módulos vendidos à parte ou na venda da área como produto. Enquanto for proposta, não muda nenhuma regra dos outros documentos.

Como foi feito: oito frentes de pesquisa em 04/11/2026 (cinco de mercado, com fonte primária, e três lendo este repositório); em 10/11/2026, cada frente foi conferida por um verificador independente, três desenhos da solução foram escritos por ângulos diferentes (proteção primeiro, simplicidade para o comprador primeiro e lançar rápido) e a proposta foi atacada em quatro papéis (quem quer piratear, o comprador honesto, o jurídico e comercial e o engenheiro deste repositório). O que rodou e o que não rodou está no §16. As fontes estão no §15. As respostas do produtor de 10/11/2026 foram aplicadas depois disso.

Vocabulário desta página: **Licença** (o direito de usar, comprado na Hotmart ou na Ticto; é anual ou vitalícia), **validade** (a data até quando a Licença anual vale), **Ano adicional** (a compra que soma 12 meses à validade), **titular** (a pessoa ou a empresa dona da Licença), **Instalação** (a área rodando num servidor, num endereço), **Chave de ativação** (o código de uso único que liga uma Instalação à Licença), **Pacote da versão** (o que o instalador baixa), **Módulo** (uma parte do produto vendida à parte e ligada pela Licença, como os Webinários), **Emissor** (o nosso serviço que emite e confere licenças), **Painel de licenças** (o site do Emissor em que a nossa equipe cuida dos clientes do produto), **Verificador** (a parte do produto que confere a licença dentro da Instalação do comprador) e **lote fundador** (os primeiros compradores, instalados por nós). "O produto" é a área de membros vendida a outras escolas; o nome comercial ainda não existe (A10).

## Resumo em uma página

**Em uma frase.** O comprador paga por Instalação, por um ano de cada vez ou uma vez para sempre, roda um comando no servidor dele e a área sobe com a marca dele, no domínio dele. A Licença decide em quantos endereços o produto roda, até quando, e quais módulos estão ligados.

| Tema | Proposta |
|---|---|
| **O que é uma Licença** | o direito de rodar **uma Instalação**: uma área de membros, num endereço público, com o banco dela. Sem ambiente de teste e sem segunda área na mesma Licença. Quem quer duas ou dez compra de novo: as compras somam, com desconto por volume para o mesmo titular (A2) |
| **Como paga** | **Licença anual:** vale 12 meses, com versões novas e suporte, e cada **Ano adicional** comprado soma mais 12. Ou **Licença vitalícia:** paga uma vez e não tem data de fim. Os preços são do produtor (§8.2) |
| **O que o comprador recebe** | a aula de instalação, a página **Minhas licenças** e o Pacote da versão: o produto já compilado, os arquivos de instalação e o banco pronto para ser criado. **O código-fonte não é entregue** |
| **Instalação** | um comando, em qualquer servidor Linux com acesso de administrador (VPS): confere a máquina, instala o que falta, baixa o pacote, gera as senhas, sobe o banco e a área com HTTPS, configura e testa o e-mail, ativa a Licença e cria a primeira conta. **Não roda em hospedagem compartilhada.** O script leva de 15 a 30 minutos; do zero à primeira aula no ar são de 2 a 4 horas, e até 48 quando o DNS demora |
| **Domínio do comprador** | ele cria **um registro** no painel onde comprou o domínio, apontando `alunos.meucurso.com` para o servidor (dois, se o teste do endereço único não passar, D14). A página **Nova instalação** mostra o registro pronto e confere; o instalador emite o HTTPS e renova sozinho. Mais três registros para os e-mails saírem com o domínio dele (§3.1) |
| **Com a IA** | o kit da IA é uma pasta que o comprador baixa no computador dele. A IA entra no servidor por uma conta de operador, instala, lê o diagnóstico e conserta. A Chave de ativação e as senhas nunca passam pelo chat |
| **Controle da Licença** | cada Instalação nasce de uma Chave de ativação de uso único e fica presa ao endereço dela. Uma vez por dia ela fala com o nosso Emissor e guarda uma licença assinada que vale de 30 a 90 dias sem contato, e nunca além do período pago. Reembolso e chargeback revogam sozinhos |
| **Licença anual vencida** | e-mails 60, 30 e 7 dias antes; 15 dias de carência com tudo funcionando; depois vale a mesma escada da linha de baixo. Renovou, a escola volta inteira na hora (§2.2) |
| **Licença irregular** (pagamento desfeito, endereço errado, muito tempo sem contato) | a escola **congela** por etapas, cada uma avisada por e-mail: primeiro um aviso, depois a equipe para de editar, depois param as contas novas. **Quem já é aluno nunca perde o acesso** e os dados nunca são apagados (§2.2) |
| **Se o produto acabar** | o contrato traz uma cláusula de continuidade: se encerrarmos o produto ou o Emissor ficar fora do ar por mais de 60 dias, sai uma licença definitiva, que não vence, para toda Licença em dia (A23) |
| **Recuperação** | backup diário cifrado, fora do servidor, e um **kit de recuperação** que o comprador guarda consigo. Sem ele, o backup não abre se o servidor morrer |
| **Módulos** | partes do produto vendidas à parte, numa loja de **Módulos** dentro da nossa área de membros, só para quem tem a Licença. O módulo já vai dentro do produto e a Licença liga: comprou, liga sozinho, sem instalar nada. O primeiro é o de **Webinários**: a Live gravada e o Replay só pedem uma conta da Bunny; a Live ao vivo pede um segundo servidor para o vídeo, instalado pelo mesmo kit (§5) |
| **Marca do comprador** | nome da escola, logo, cores, e-mails e endereços trocados pela Personalização e pelo instalador, sem tocar no código |
| **Nosso lado** | um Emissor pequeno e nosso, no ar 24 horas; o **Painel de licenças**, num subdomínio nosso e com login próprio, onde a equipe vê clientes, Licenças, Instalações, vencimentos e módulos; e, na nossa área de membros, as páginas **Minhas licenças** e **Módulos** para o comprador, ao lado da aula de instalação |
| **Jurídico** | contrato de licença de uso (por Instalação, intransferível, sem revenda) pronto e aceito antes de qualquer Instalação fora de casa; anexo de tratamento de dados desde o lote fundador; registro do programa no INPI; advogado e contador na fase 0 |
| **Prazo** | primeiro o **lote fundador**: até 10 compradores, instalados por nós. A venda aberta, com o comprador instalando sozinho, vem depois (§12) |

**O que a Licença segura e o que não segura.** Segura quem não mexe em código, que é quase todo comprador: a mesma Licença em servidores de amigos, a cópia do servidor para um segundo endereço, a segunda área de membros do próprio comprador, quem paga um ano e quer usar para sempre, o comprador que pede reembolso e continua vendendo curso, e o repasse do instalador (sem Licença não ativa nem atualiza). Não segura uma pessoa técnica que abra o produto compilado e arranque a verificação: nenhum produto instalado no servidor do cliente segura isso, e ofuscar só tira desempenho. Contra essa pessoa valem o contrato e a lei (§9), o nome do titular gravado em cada cópia licenciada e o fato de que a cópia alterada fica sem as versões novas e sem as correções de segurança, a menos que o trabalho seja refeito a cada versão (§7).

**O que você precisa decidir agora** (detalhes e o padrão assumido no §13.2):

1. Os preços da Licença anual, do Ano adicional, da vitalícia e dos módulos (A30).
2. O que a vitalícia inclui: versões novas para sempre, e atendimento do suporte por quanto tempo (A31).
3. Os prazos da Licença anual vencida, e se existe um degrau mais duro que o congelamento (A4 e A3).
4. Se o módulo é pagamento único ou anual (A33).
5. Vender só a Licença de 1 Instalação, com desconto por volume, ou também pacotes de 3 e de 10 (A2).
6. Se o código-fonte nunca é entregue, ou se existe um plano mais caro que entrega (A7).
7. Se a gravação das lives por hora vira um serviço nosso, cobrado por uso (A8).
8. O nome e a marca do produto: se ele é vendido como Bunker707 ou com um nome próprio (A10).
9. O lote fundador: quantos compradores, quem e em que condições (A14).
10. O advogado e o contador (A16 e A24).
11. Quando a nossa produção volta a ficar ligada 24 horas e se o Emissor ganha um servidor só dele (A19).
12. Quem guarda a chave que garante a continuidade (A23).

---

## 1. O que o comprador compra

### 1.1 Catálogo (estrutura, sem preços)

| Produto | O que é | Como entra na Hotmart e na Ticto |
|---|---|---|
| **Licença anual** | o direito de rodar 1 Instalação por 12 meses, com a aula de instalação, as versões novas e o suporte | produto de pagamento único (§8.4 traz a configuração). Quem quer mais de uma Instalação compra de novo; a segunda e a terceira do mesmo titular saem com cupom |
| **Ano adicional** | mais 12 meses para uma Licença anual. Pode ser comprado antes do vencimento, quantas vezes o titular quiser | outro produto de pagamento único, comprado pelo botão **Renovar** de Minhas licenças |
| **Licença vitalícia** | o direito de rodar 1 Instalação sem data de fim, com as versões novas enquanto o produto existir (A31) | produto de pagamento único |
| **Troca para vitalícia** (só se a A32 for sim) | transforma uma Licença anual em vitalícia | produto de pagamento único, oferecido só a quem já tem a Licença |
| **Módulos** (o primeiro é o de Webinários) | cada módulo comprado liga numa Licença escolhida (§5) | um produto por módulo, comprado na loja de **Módulos**. Vale enquanto a Licença valer (A33) |
| **Instalação feita por nós** | rodamos o kit no servidor do comprador e entregamos a área no ar (§3.5) | produto de preço fixo e escopo fechado. Na Hotmart, o formato "Serviço Online" não entra como oferta adicional do checkout; o formato certo se confirma com o compliance |
| **Horas avulsas** | o que foge da instalação padrão: trazer alunos de outra plataforma, personalização, ajuda com o servidor | pacote de horas |
| **Gravação de lives por hora** (só se A8 for sim) | o nosso gravador grava a live do comprador e entrega o vídeo na Bunny dele | consumo (créditos) |

Por que um produto de 1 e compras que somam: o nosso sistema reconhece a venda pelo código do produto (`data.product.id` na Hotmart e `item.product_id` na Ticto), não pelo código da oferta nem pela quantidade, e o reprocesso usa o que ficou guardado. Um pacote de 10 com desconto grande atrai justamente a agência que instala para terceiros, que o contrato proíbe na primeira versão. Os pacotes de 3 e de 10 entram junto com o plano de agência (A2 e A12). Pelo mesmo motivo, dois ou três anos pagos de uma vez são outros produtos na plataforma, que o Emissor soma como 24 ou 36 meses.

### 1.2 O que é uma Licença

- **Uma Instalação** é a área rodando num endereço público (por exemplo `membros.escola.com.br`) com o banco dela. Dois endereços com bancos diferentes são duas Instalações, mesmo no mesmo servidor.
- **Uma Licença, uma área de membros.** Não existe Instalação de teste nem segunda área na mesma Licença: foi a decisão do produtor em 10/11/2026. O segundo ambiente do mesmo comprador (outra escola, outro endereço, uma cópia para experimentar) pede outra Licença, e a ativação recusa a vaga já usada. Para ensaiar uma restauração sem tocar na escola de verdade existe o modo isolado do §4, que roda no mesmo servidor e não envia nada.
- **A Licença é anual ou vitalícia.** A anual vale 12 meses e ganha mais 12 a cada Ano adicional. O prazo começa na ativação ou 30 dias depois da compra, o que vier primeiro, para ninguém perder um mês enquanto contrata o servidor (A4). A vitalícia não tem data de fim (§8.2).
- **A Licença tem um titular.** Quem paga nem sempre é o dono da escola. No primeiro acesso a Minhas licenças, o comprador informa o titular (nome ou razão social, CPF ou CNPJ) e um segundo e-mail de contato. O admin de toda Instalação mostra "Licenciado para" com esse nome.
- **A Licença é do titular e das escolas dele.** Não pode ser revendida, emprestada nem usada para hospedar a área de terceiros. O contrato admite a sucessão: CNPJ novo do mesmo dono, venda da escola e herança. Agência que instala para clientes fica fora da primeira versão (A12).
- **Compras somam.** Cada compra de Licença aparece em **Minhas licenças** com a Instalação dela.

### 1.3 O que o comprador recebe

1. **A página Minhas licenças**, na nossa área de membros, onde ele informa o titular, aceita o contrato e gera a Chave de ativação de cada Instalação. O e-mail da compra leva o link dessa página e o contrato em PDF, nunca a Chave.
2. **A aula de instalação**, na mesma área: o comprador da Licença é um aluno nosso, pelo mesmo caminho de qualquer venda (§11.10).
3. **O Pacote da versão:** a imagem do produto já compilada, os arquivos do banco e dos serviços, os scripts de instalação e de operação e a lista assinada do que há no pacote. E o **kit da IA**, uma pasta pública para o computador dele (§3.3).
4. **Versões novas e suporte** enquanto a Licença estiver em dia. O pacote da versão que ele tem instalada continua disponível para reinstalar e restaurar mesmo com a Licença anual vencida: recuperar os dados nunca depende de renovar. Licença revogada não baixa nada.
5. **A loja de Módulos**, na mesma área, onde ele compra os módulos e escolhe em qual Licença cada um liga (§5.1).

O que ele não recebe: o código-fonte, este repositório, os testes, os documentos internos e o Emissor. Hoje o deploy da nossa produção manda o repositório inteiro para o servidor (`infra/cloud/lib.sh`, `sync_repo`); para o comprador isso muda (§11.6).

### 1.4 O caminho do comprador (na venda aberta)

1. **Antes de comprar,** pode ver uma escola de demonstração e rodar no servidor dele uma conferência que não pede Licença e diz se a máquina serve (A26).
2. Compra na Hotmart ou na Ticto, pela página de venda ou, se já é aluno nosso, pela página do produto dentro da nossa área. O aviso da venda cria a conta dele, ou usa a que ele já tem, libera a aula e emite a Licença (§11.10).
3. Entra na nossa área, abre **Minhas licenças**, informa o titular e aceita o contrato.
4. Contrata um servidor (a aula mostra o plano certo em três provedores) e cria a conta de e-mail.
5. Clica em **Nova instalação** e escreve o endereço que quer para a escola, por exemplo `alunos.meucurso.com`, e o IP do servidor. A página mostra o registro de DNS a criar, com o botão **Copiar**, e **Conferir endereço** fica verde quando o domínio já aponta para o servidor (§3.1). Só então a página gera a Chave de ativação (vale 24 horas) e o comando. Ele roda o comando, ou entrega o trabalho para a IA. A Chave só é gasta no fim: se a instalação parar no meio, o mesmo comando continua.
6. Entra com a primeira conta da equipe. O admin abre numa lista **Para a escola funcionar**, com o que ainda falta: a marca, a venda dele (Hotmart ou Ticto dele), o vídeo, o kit de recuperação guardado e o primeiro curso.
7. Quando sair versão nova, o admin dele avisa; ele roda **atualizar** (ou pede à IA).
8. Quando quiser um módulo, abre **Módulos** na nossa área e compra. O módulo liga sozinho na conferência seguinte, ou na hora pelo **Verificar agora** (§5.1).
9. Perto do fim do ano, recebe os avisos e compra o **Ano adicional** pelo botão **Renovar**.

No lote fundador, os passos 4 e 5 são feitos por nós (§12).

## 2. Como a Licença funciona

### 2.1 Ativação e conferência diária

- **Ativar.** O instalador manda ao Emissor a Chave de ativação, o endereço da Instalação e um identificador sorteado na hora. Se a Licença tem Instalação livre, o Emissor devolve uma **licença assinada** por nós: um arquivo pequeno que diz quem é o titular, para qual endereço vale, quais módulos liga (a área, os Webinários), se a Licença é anual ou vitalícia, até quando a anual vale e até quando o próprio arquivo vale. Devolve também um segredo só daquela Instalação, usado nas conferências seguintes. Ativar de novo no mesmo endereço não gasta outra vaga.
- **Conferir.** O produto confere a assinatura dentro do servidor do comprador, com a nossa chave pública gravada no produto, e confere que **o endereço em que está rodando é o endereço da licença**. Nenhuma página depende da internet para abrir: a conferência usa o arquivo guardado.
- **Renovar o arquivo.** Uma vez por dia, a Instalação fala com o Emissor (pelo mesmo agendador de minuto que já envia e-mails e avisos) e troca o arquivo por um novo. É nessa conversa que chegam a revogação, o Ano adicional comprado, o módulo comprado depois e o aviso de versão nova. O admin do comprador tem o botão **Verificar agora**.
- **Quanto tempo o arquivo vale sem contato:** durante a garantia da compra, só até três dias depois do fim dela (a plataforma avisa quando a garantia acaba; na Hotmart é o `PURCHASE_COMPLETE`, que já tratamos); nos seis primeiros meses, 30 dias; depois, 90 dias. Na Licença anual, o arquivo nunca vale além do fim do período pago mais os 15 dias de carência: a data de fim vai gravada e assinada, e o produto a obedece mesmo sem falar conosco. Quem compra, instala, corta a conversa com o Emissor e pede o dinheiro de volta fica com uma licença que vence em dias. Quem paga um ano e corta a conversa fica com uma licença que acaba no fim do ano. Quem pagou e está em dia há meses aguenta três meses de silêncio nosso.
- **O que foi comprado e ainda está na garantia entra com prazo curto.** O Ano adicional, a troca para vitalícia e o módulo entram na licença assinada na hora, mas só até três dias depois do fim da garantia daquela compra. Passada a garantia, entram por inteiro. O resto do arquivo continua valendo como antes. Sem isso, quem comprasse um Ano adicional, cortasse a conversa com o Emissor e pedisse o reembolso ficaria com meses de uso de graça.
- **O que a Instalação manda nessa conversa:** o número da Licença, o identificador da Instalação, o endereço e as versões do produto e do pacote. Nenhuma contagem e nenhum dado de aluno (§9).
- **Se o nosso Emissor cair,** nada acontece enquanto o arquivo guardado valer, e existem duas saídas a mais (§2.2 e §10).

É o desenho de Coder e Mattermost (licença assinada, conferida no servidor do cliente), com a renovação periódica de Metabase, Grafana, Directus e n8n, o vínculo ao endereço público do Directus e do Grafana e a tolerância de 30 dias da JetBrains (§15).

### 2.2 O que acontece em cada situação

Três degraus, sempre nesta ordem, e nada além deles:

- **Aviso:** uma faixa no admin, dizendo o que houve, a data do próximo degrau, o botão **Exportar dados** e o pedido para pausar as ofertas da escola enquanto não regularizar.
- **Admin limitado:** a equipe da escola entra, vê tudo, exporta tudo e atende quem já é aluno (trocar senha, remover acesso, pedidos da LGPD). Não cria nem publica conteúdo, não envia avisos, não cria webinário, não conecta integração e não muda a aparência.
- **Escola congelada:** admin limitado e nenhuma **conta nova**. Quem já tem conta continua sendo atendido por inteiro: compra nova, renovação, retomada e extensão de prazo são processadas. A venda de quem ainda não tem conta fica guardada; a equipe recebe um e-mail a cada uma, quem pagou recebe um e-mail neutro dizendo que a escola vai liberar o acesso, e as guardadas são liberadas sozinhas quando a Licença for regularizada.

Todo degrau é avisado também por e-mail, duas vezes: pelo Emissor, para o titular, e pela própria Instalação, para o dono da escola. Uma faixa num admin que ninguém abre não é aviso.

| Situação | A equipe do comprador | O aluno do comprador | Como sai |
|---|---|---|---|
| Licença em dia (a anual dentro do prazo, ou a vitalícia) | tudo | tudo | |
| **Licença anual perto de vencer** | tudo; e-mails 60, 30 e 7 dias antes, para o titular e para o dono da escola; uma linha em Configurações: "Licença até 10/11/2027 · Renovar"; e a faixa de Aviso nos últimos 30 dias | tudo | comprar um Ano adicional pelo botão **Renovar** |
| **Licença anual vencida** | do vencimento ao 15º dia, a carência: tudo funciona, com Aviso. Do 16º dia: Admin limitado, e as versões novas param. 30 dias depois: Escola congelada | quem já é aluno: tudo, sempre | comprar um Ano adicional: a escola volta inteira na conferência seguinte, ou na hora pelo **Verificar agora**, e as vendas guardadas são liberadas |
| **Sem contato com o Emissor** (o nosso fora do ar, ou o servidor do comprador sem saída) | até o 7º dia, nada; do 8º dia, Aviso; quando a licença guardada vence (30 ou 90 dias, §2.1), Admin limitado; 30 dias depois, Escola congelada. Na garantia, a licença curta vence antes: Admin limitado no vencimento | quem já é aluno: tudo, sempre | volta sozinho no primeiro contato. Se a falha for nossa, publicamos uma extensão assinada, que toda Instalação busca num segundo endereço |
| **Instalação a mais** (a Licença já usou a vaga) | a ativação é recusada no instalador, que mostra onde a vaga está em uso | a área nova não sobe | desativar a Instalação antiga em Minhas licenças, ou comprar outra Licença |
| **Endereço diferente do da licença** (cópia do servidor em outro domínio, ou domínio trocado sem avisar) | Aviso depois de algumas horas de divergência repetida: "esta Instalação está em outro endereço"; em 7 dias, Admin limitado; em 30, Escola congelada | quem já é aluno: tudo | trocar o endereço (§2.3) ou ativar outra Instalação |
| **Pagamento desfeito** (reembolso ou chargeback confirmado) | no dia em que a revogação chega: Aviso, e fim das versões novas e dos serviços nossos; em 7 dias, Admin limitado; em 30, Escola congelada | quem já é aluno: tudo | comprar de novo ou ganhar a disputa reativa |
| **Licença suspensa** (chargeback em disputa, ou suspeita em análise) | Aviso, e pausa das versões novas, até a disputa ou a análise terminar. Não desce mais degraus | tudo | o resultado da disputa ou da análise |
| **Descumprimento do contrato** (revenda, Instalação para terceiros, fraude) | notificação por e-mail com a prova e 30 dias para corrigir; depois, fim das versões e dos serviços nossos e Admin limitado. Escola congelada só com parecer do advogado no caso ou ordem judicial | quem já é aluno: tudo | corrigir no prazo |
| **Cópia nunca ativada** (o produto vendido, sem licença e sem alunos) | só a tela de ativação e o diagnóstico | a área não inicia | ativar |

Regras que valem para todas as linhas: os dados nunca são apagados; nada acontece de uma hora para a outra; o aluno nunca vê aviso sobre a Licença da escola; uma Instalação que já teve licença válida nunca cai abaixo de Escola congelada; relógio errado sozinho nunca limita ninguém; e o que o Emissor manda é sempre um dado assinado, nunca um comando.

Por que assim. Os três desenhos independentes chegaram à mesma regra por caminhos diferentes: a licença irregular congela a escola e não derruba quem já é aluno. Uma escola congelada não serve para quem quer usar sem pagar (não publica aula nova e não ganha aluno novo), e uma falha nossa nunca tira do ar a escola de quem está em dia. O custo do congelamento é real e fica com a escola: quem paga um curso durante o congelamento espera pelo acesso, e por isso o Aviso já pede para pausar as ofertas. No mercado, o que é unânime é não apagar dados e avisar antes; sobre o usuário final há de tudo: o Mattermost e a Metabase só rebaixam, o GitLab deixa a instância somente leitura e o Directus chega a bloquear o login de quem não é administrador (§15). O degrau mais duro, tirar a área do ar para os alunos, não entra na primeira versão (A3). Com a Licença anual, a escada passa a valer também para quem só deixou de renovar. É mais firme do que os plugins de WordPress, que continuam funcionando sem atualização, e perto do GitLab, que deixa a instância vencida somente leitura. Os prazos seguem o mercado: o Mattermost avisa 60 dias antes e dá 10 dias de carência; o GitLab avisa 30 dias antes e ainda traz 14 dias de carência no código (§15).

No lote fundador, o Verificador roda os primeiros 60 dias em **modo de observação**: registra e avisa, sem limitar nada, para pegar alarme falso antes que ele custe caro a quem pagou.

### 2.3 Trocar de servidor, de endereço e recuperar

- **Trocar de servidor, mesmo endereço:** instalar no servidor novo no modo de restauração, que não pede Chave de ativação, restaurar o backup e apontar o endereço. A licença vem dentro do backup e continua valendo. Funciona também com a Licença anual vencida: a escola volta no degrau em que estava.
- **Trocar de endereço** (de `membros.escola.com.br` para `alunos.escola.com.br`): Minhas licenças autoriza, e um comando no servidor executa: a configuração, o certificado, os modelos de e-mail e o endereço antigo redirecionando por 30 dias. Para isso o produto passa a guardar só o caminho dos arquivos, não o endereço inteiro. Duas trocas por ano por Instalação sem falar com ninguém; a partir da terceira, pelo suporte (A5). No lote fundador, a troca é feita por nós.
- **Servidor que morreu sem backup da licença:** **Desativar** em Minhas licenças libera a vaga para uma ativação nova. Desativar pede confirmação por e-mail e pode ser desfeito em 48 horas.
- **Sem falar conosco:** para quem não consegue chegar ao Emissor, existe a licença por arquivo, baixada em Minhas licenças e levada à mão para o servidor. Vale por até 12 meses e nunca além do período pago.

### 2.4 Minhas licenças e Módulos (comprador) e o Painel de licenças (nossa equipe)

- **Minhas licenças**, na nossa área do aluno, ao lado de Minhas compras. No primeiro acesso: o titular (nome ou razão social, CPF ou CNPJ, endereço), um segundo e-mail e o aceite da versão do contrato, que fica registrado. Depois: cada Licença com o tipo (anual ou vitalícia), a validade e o botão **Renovar**, a Instalação dela (endereço, versão, último contato), **Nova instalação**, **Trocar endereço**, **Desativar**, a licença por arquivo, os módulos ligados e a aula. Uma compra ainda não aplicada (o Ano adicional ou o módulo de quem tem mais de uma Licença) aparece no topo, pedindo a escolha da Licença.
- **Módulos**, na mesma área: a loja do §5.1.
- **Painel de licenças**, da nossa equipe, fora do admin da escola: um site pequeno, servido pelo próprio Emissor num subdomínio nosso (por exemplo `licencas.bunker707.com.br`), com login próprio e segundo fator. Telas: **Clientes** (quem comprou, o titular, o contato, as compras e a versão do contrato aceita), **Licenças** (o tipo, a validade, a situação e a origem: venda, cortesia ou fundador), **Instalações** (o endereço, a versão, o último contato e os módulos ligados), **Vencimentos** (quem vence em 60, 30 e 7 dias, quem está na carência e quem está limitado), **Módulos** (o catálogo e quem tem o quê), **Alertas** (duas cópias brigando pela mesma Instalação; titular com várias Instalações em escolas sem relação entre si; comprador que já pediu reembolso antes; compra de módulo ou de Ano adicional parada, sem Licença), **Versões** e **Auditoria**. Ações: **Emitir**, **Estender**, **Suspender**, **Revogar**, **Reativar**, **Liberar vaga**, **Passar para vitalícia** e **Ligar** ou **Desligar** módulo. Revogar e Suspender pedem o motivo e a prova. Tudo vai para a auditoria e é avisado por e-mail ao dono (§10 e §11.2).
- **Licença**, no admin do comprador, em Configurações: a situação, "Licenciado para", o endereço, o tipo e a validade, os módulos ligados, a versão e **Verificar agora**.

Minhas licenças e Módulos só existem na nossa Instalação: ligam por um módulo que só a nossa própria licença assinada traz, não por uma variável de ambiente (§11.3). O Painel de licenças não faz parte do produto: mora no Emissor, e o comprador nunca o recebe.

### 2.5 Reembolso, chargeback e cancelamento

- **Reembolso** (os 7 dias de garantia das plataformas) e **chargeback confirmado**: o aviso que já tratamos hoje revoga a Licença. A Instalação fica sabendo na conferência seguinte, em até 24 horas, e começa a escada do §2.2. O pedido de reembolso ainda em análise (o `PURCHASE_PROTEST` da Hotmart) e o chargeback em disputa só suspendem.
- **Comprador que já teve reembolso ou chargeback:** a Licença nova espera a nossa liberação, por no máximo um dia útil. Se negarmos, o dinheiro volta na hora. O critério fica escrito no contrato.
- **Ano adicional:** reembolsado, a validade volta ao que era. Se com isso a Licença fica vencida, vale a escada da Licença anual vencida, contada da data de fim. A **troca para vitalícia** reembolsada devolve a Licença ao tipo anual, com a validade que tinha.
- **Módulo:** é acessório da Licença. Compra do módulo reembolsada desliga só o módulo, e os Replays já publicados ficam no ar por 30 dias. Licença revogada desliga os módulos junto.
- Cada Licença fica presa à venda que a emitiu: o reembolso daquela venda revoga aquela Licença. Ela não passa pela regra dos acessos dos alunos (`decideEntitlementAfterSale`), que em alguns casos mantém o acesso depois de um reembolso.

## 3. Instalação em qualquer servidor

### 3.1 Onde roda e onde não roda

| Onde | Roda? | Observação |
|---|---|---|
| Hetzner Cloud, Contabo VPS, Hostinger VPS | sim | os três em que a instalação será ensaiada (§12). O plano mínimo de cada um sai do ensaio: na Hostinger, por exemplo, o plano de 4 GB tem 1 vCPU e não serve |
| HostGator VPS, DigitalOcean, Vultr e parecidos | deve rodar | não ensaiados. Na HostGator o servidor precisa estar sem o painel cPanel/WHM, que ocupa as portas da área |
| Hospedagem compartilhada (os planos "de site" da Hostinger e da HostGator) | **não** | não dão acesso de administrador nem deixam rodar Docker |

Requisitos: servidor virtual de verdade (KVM), com acesso de administrador e um IPv4 público; Ubuntu 24.04 ou Debian 12 ou 13 (Ubuntu 26.04 depois de ensaiado); processador x86-64; **2 vCPU**, que vem antes da memória; **4 GB de memória no mínimo** (o instalador cria 2 GB de memória de troca) e 8 GB recomendados; 40 GB de disco; as portas 80 e 443 livres e alcançáveis de fora; e saída para o e-mail.

O que foi medido: a nossa produção roda desde 19/10/2026 com 2 vCPU e 4 GB. No teste de carga daquele dia, 30 alunos de teste navegando sem parar ficaram bem dentro do limite (95 % das páginas em até 0,8 s); com 100, não houve erro, mas a área ficou lenta (95 % em até 3,9 s). O teste é anterior à Comunicação v2 e aos Webinários. A página de venda precisa dizer alunos ao mesmo tempo por tamanho de servidor, medidos de novo (`docs/20` §12.1).

O que o comprador precisa ter, além do servidor:

- **um domínio**, com acesso ao painel de DNS;
- **uma conta de e-mail transacional.** Na primeira fase, o Resend. O plano grátis manda 100 e-mails por dia, e cada venda gasta cerca de três: dá para uns 30 alunos novos por dia. Alguns provedores bloqueiam a porta 587; o kit aceita as portas alternativas do Resend (2587 e 2465) e a conferência testa a saída;
- **onde vender:** o produto só reconhece vendas da Hotmart e da Ticto;
- **vídeo:** YouTube, Vimeo, Bunny ou Mux, como na nossa área;
- **um cartão internacional,** porque servidor e e-mail são cobrados em dólar ou euro;
- **para o caminho com IA,** a assinatura do Claude Code ou do Codex.

**O endereço da escola: o domínio do comprador.** O comprador escolhe o endereço, por exemplo `alunos.meucurso.com`, e faz uma coisa só: cria **um registro** no painel onde comprou o domínio.

| Campo | O que escrever |
|---|---|
| Tipo | A |
| Nome | `alunos`, a parte que vem antes do domínio |
| Valor | o IP do servidor, que o provedor mostra no painel dele |

Como isso fica simples na prática:

- **Nova instalação**, em Minhas licenças, pede o endereço e o IP e mostra o registro pronto, com o botão **Copiar** e o passo a passo dos painéis mais comuns (Registro.br, Cloudflare, Hostinger, GoDaddy e HostGator).
- **Conferir endereço** consulta o domínio de fora e fica verde quando ele já aponta para o servidor. A propagação costuma levar minutos e pode levar até 48 horas.
- **O HTTPS é automático.** O instalador só pede o certificado depois que o endereço confere, emite pelo Let's Encrypt e renova sozinho. É o que o nosso Caddy já faz hoje (`infra/compose/caddy/Caddyfile`). O comprador não compra nem instala certificado.
- **Os e-mails com o domínio dele** pedem mais três registros, do Resend. O mesmo assistente mostra os três, com Copiar e Conferir, e a instalação só fica verde quando um e-mail de teste chega.
- **Quem usa a Cloudflare** pode deixar o proxy dela ligado ou desligado no endereço da área; o instalador pergunta e ajusta. No endereço do vídeo, da Live ao vivo, o proxy fica sempre desligado.
- **O domínio sem subdomínio** (`meucurso.com`) também serve, com o Nome `@`. A aula recomenda o subdomínio, para o site de vendas do comprador continuar onde está.
- **Trocar depois** é um botão e um comando (§2.3).

Hoje a nossa área usa dois endereços, um para a área e um para a API. O teste do endereço único, que deixa só o registro acima, sobe para antes do primeiro fundador, para ninguém precisar migrar depois (D14). Se o teste não passar, são dois registros: o da área e o da API. A Live ao vivo pede mais um, para o vídeo. Duas ideias ficam para avaliar depois da primeira versão (A34): o instalador criar os registros sozinho para quem usa a Cloudflare, com um token que o comprador gera só para aquele domínio (já fazemos isso na nossa zona, em `infra/cloud/lib.sh`), e um endereço provisório nosso, para a escola subir antes de o DNS ficar pronto.

### 3.2 O comando e o que ele faz

O comprador copia de **Minhas licenças** uma linha parecida com esta (os nomes finais saem na fase 2):

```bash
curl -fsSL https://instalar.<produto>.com.br | sudo bash -s -- --endereco membros.escola.com.br --email dono@escola.com.br --ativacao <chave de uso único>
```

1. **Confere antes de mexer** (não altera nada e não gasta a Chave): sistema, virtualização, processador, memória, disco, portas, se o endereço aponta para este servidor, saída para a internet e para o e-mail, e se a Chave e a vaga valem. Um serviço nosso bate de fora nas portas 80 e 443, porque de dentro do servidor não dá para saber se o provedor as bloqueia. Se algo falta, para com um código de erro e a frase do que fazer.
2. **Prepara o servidor:** Docker, firewall, memória de troca e atualizações de segurança. Nunca tranca o dono para fora do próprio servidor. Parte do `infra/scripts/bootstrap.sh` de hoje, que precisa de ajustes para servidor de terceiros (§11.7).
3. **Baixa o Pacote da versão** e confere a nossa assinatura.
4. **Gera as senhas e os segredos** num arquivo que só o administrador do servidor lê. Nada disso aparece na tela nem no registro da instalação.
5. **Sobe o banco e os serviços** (o Supabase no próprio servidor) e o HTTPS automático.
6. **Cria o banco** (as migrações do pacote) e liga o agendador de minuto.
7. **Sobe a área.**
8. **Configura e testa o e-mail:** mostra os registros de DNS do e-mail, espera a verificação do domínio e manda um e-mail de teste. Sem entrega, a conferência final fica vermelha: uma área que não manda convite nem "esqueci a senha" não está no ar.
9. **Ativa a Licença.**
10. **Cria a primeira conta da equipe** e mostra o link de entrada do dono, de uso único. Um comando gera esse link de novo, sem depender do e-mail.
11. **Confere o resultado** (área respondendo, login, banco fechado para fora, arquivos, agendador rodando, e-mail entregue) e mostra o resumo.
12. **Liga o backup diário,** pede o destino fora do servidor e entrega o kit de recuperação (§4).

Dois modos: **guiado**, que pergunta o que falta, e **com arquivo de respostas**, que a pessoa preenche antes e a IA usa. Rodar de novo continua de onde parou e nunca apaga dados. Depois de instalado, o servidor ganha um comando de operação (nome provisório `membros`) com: status, diagnóstico, atualizar, voltar versão, backup, restaurar, ensaio de restauração, e-mail, endereço, link do dono, disco, vídeo, registros, licença, suporte e desinstalar.

### 3.3 O kit para a IA

Entregar a instalação por agente de IA como parte oficial do produto ainda é raro (achamos um caso, a Kodus, que publica uma skill de instalação), e os padrões abertos para isso já existem (§15).

A IA roda no computador do comprador e entra no servidor por SSH. Instruções guardadas dentro do servidor não chegam a ela. Por isso o kit da IA é uma **pasta pública, baixada no computador do comprador**, com:

- **Um `AGENTS.md`**, lido pelo Codex e pelo Claude Code, e um `CLAUDE.md` de uma linha que só o importa, para as versões do Claude Code que não leem o `AGENTS.md` sozinhas. Ali estão a ordem obrigatória (conferir, instalar, diagnosticar), o que nunca fazer (mostrar o arquivo de segredos, apagar os volumes do banco, editar a configuração à mão) e como ler os erros.
- **Uma skill de instalação** no formato aberto de skills, que só chama os mesmos comandos do instalador.
- **O passo da chave SSH,** que a aula mostra, e a regra de que a IA trabalha desde o início por uma **conta de operador**, que só roda o comando de operação.
- **O que a IA nunca recebe:** a Chave de ativação e o link de entrada do dono. Esses dois passos a pessoa faz, ou o instalador lê de um arquivo fechado.

Do lado do servidor:

- **Diagnóstico em formato de máquina:** `membros diagnostico --json` devolve a versão, o estado de cada serviço, o banco, as portas, o DNS, o certificado, o disco, a idade do último backup, a situação da Licença e as últimas linhas de erro, sem segredos e sem dado pessoal de aluno. Os trechos de registro vêm marcados como dado não confiável: são texto que veio de fora, não instrução para a IA.
- **Códigos de erro fixos e documentados** (porta ocupada, endereço que não aponta para o servidor, memória insuficiente, Chave vencida, vaga em uso, assinatura do pacote que não confere, e-mail sem entrega). Cada um diz a causa, o conserto e **de quem é o problema**: do produto, coberto pelo suporte da Licença, ou do servidor do comprador.
- **Travas que não dependem de a IA obedecer:** o instalador recusa os comandos destrutivos sem uma confirmação digitada pela pessoa; o arquivo de segredos só o administrador lê; a conta de operador não o alcança.

### 3.4 A aula

Dois caminhos, do mais simples ao mais guiado: **(a) um comando**, colado no terminal do servidor; **(b) com a IA**, em que o comprador baixa o kit da IA, abre o Claude Code ou o Codex no computador dele e entrega o endereço do servidor. A aula recomenda a IA no computador do comprador, não dentro do servidor, para a conta dele da Anthropic ou da OpenAI não ficar guardada lá. Também cobre: escolher o plano certo em três provedores, apontar o endereço, criar a conta do Resend e verificar o domínio, criar a chave SSH, o primeiro acesso, a Personalização, guardar o kit de recuperação, fazer um ensaio de restauração, atualizar e trocar de servidor.

### 3.5 O serviço de instalação

É o mesmo kit, rodado por nós. Escopo fechado: conferir o servidor que o comprador contratou, apontar o endereço com ele, instalar, configurar o e-mail e o vídeo, criar a primeira conta, ligar o backup, entregar o kit de recuperação, fazer um ensaio de restauração e entregar o relatório do diagnóstico, que o comprador aceita. Fora do escopo: o custo do servidor e do domínio, trazer alunos de outra plataforma e personalização visual (horas avulsas). O acesso é por uma chave SSH temporária, removida no fim, e os segredos do comprador chegam por um formulário cifrado no navegador, nunca por chat. O serviço não pode usar o nosso fluxo de infra atual, que só cria e opera máquinas na nossa conta da Hetzner; depende do instalador da fase 1.

Garantia e reembolso do serviço precisam de uma página própria (A25): o que conta como entregue (o relatório aceito), o prazo, a devolução se não entregarmos e por quanto tempo esperamos o comprador fornecer o servidor. Dois cuidados jurídicos: se o comprador é consumidor e se arrepende nos 7 dias, os contratos acessórios caem junto, sem custo para ele (Decreto 7.962, art. 5º, § 2º), e o prazo do arrependimento pode contar da entrega do serviço. Segurar a instalação até o 7º dia castiga quem pagou por ela: no lote fundador o risco é assumido, e na venda aberta o comprador escolhe.

## 4. Atualizações, backup, recuperação e suporte

**Versões e atualização**

- **Versões numeradas** (1.0.0, 1.1.0...) com notas em português na nossa área. O admin do comprador mostra "Versão 1.3.0 disponível" (a notícia chega na conferência diária). Hoje a versão é só o código do commit em `/api/health`. Uma versão nunca vai aos compradores no mesmo dia em que entra na nossa escola.
- **Atualizar** é um comando: faz backup, baixa o pacote novo (com a Licença em dia), confere a assinatura, mostra aos alunos uma página "Voltamos já", aplica as migrações, troca a imagem, confere e, se a conferência falhar, volta para a imagem anterior. As imagens antigas são apagadas, menos a anterior (hoje ficam todas no disco).
- **Voltar versão** também é um comando: volta à imagem anterior, mantendo o banco. Só é promessa porque um teste do CI sobe a imagem anterior contra o banco novo a cada versão.
- **O banco nunca volta de versão.** A regra que sustenta isso é: a versão anterior do produto funciona no banco novo, provada no CI a cada versão (§11.6). Hoje ela não vale para todo o histórico: há migração que apaga tabela (`202610140001`) e o `docs/20` §9 lista cuidados manuais para voltar versão, que um comprador não saberia seguir. As notas de cada versão dizem de quais versões dá para atualizar direto.
- **Na primeira versão, atualizar pede terminal ou IA.** O botão **Atualizar** no admin fica para depois (A27), e a página de venda diz isso.
- **Sem atualização automática.** As ferramentas que trocam a imagem sozinhas (o Watchtower e o fork ativo dele) não fazem backup, não aplicam migração e não voltam atrás; isso é o nosso comando que faz.
- **Versões enquanto a Licença vale.** Toda Licença em dia baixa qualquer versão publicada. Com a Licença anual vencida, o pacote da versão instalada continua disponível para reinstalar e restaurar, e as correções críticas de segurança continuam chegando por 6 meses (A11). Licença revogada não baixa nada.
- **O banco do próprio servidor** (Supabase) viaja travado em cada versão do pacote; o comprador nunca atualiza o Supabase por fora. Troca de versão maior do Postgres é procedimento à parte, feito como serviço.

**Backup e recuperação**

- **Backup** diário, cifrado, com o `restic` que já usamos, para um destino fora do servidor escolhido pelo comprador (armazenamento compatível com S3 ou SFTP). O instalador não termina sem um destino ou sem o comprador assumir por escrito que o backup fica só no servidor.
- **Kit de recuperação.** Hoje a senha que cifra o backup só existe dentro do servidor: se o servidor morre, o backup não abre. O instalador cria uma segunda chave do backup e uma folha com o destino e essa chave, que a pessoa guarda fora do servidor e confirma digitando. O ensaio de restauração é feito com essa chave. O ensaio de 17/10/2026 foi em disco local, na mesma máquina, e não prova a recuperação depois de um servidor perdido.
- **Ensaio de restauração.** `restaurar --ensaio` abre o backup num banco temporário e isolado, no mesmo servidor, sem enviar nada e sem falar com o Emissor, e diz se a escola está lá dentro. Sem esse modo, um ensaio sobrescreveria a escola de verdade ou faria os alunos receberem tudo em dobro. Como não existe Instalação de teste (§1.2), é também o jeito de olhar um backup antigo sem gastar outra Licença.
- **Exportar dados** entrega, no mínimo, alunos, acessos, progresso, cursos e vendas, em arquivos que abrem em qualquer planilha. **Desinstalar** existe, com confirmação.

**Saúde do servidor e suporte**

- **Saúde do servidor.** Um vigia local avisa o dono por e-mail e por faixa no admin: disco enchendo, backup parado, certificado perto de vencer, agendador parado e avisos de venda sem processar. Um comando libera disco. Sem isso, o comprador só descobre o problema quando a escola cai. Um monitor nosso, que só chama o endereço público da escola, pode ser oferecido como opção (A28).
- **Suporte:** a Licença em dia cobre defeito do produto; problema do servidor do comprador (disco cheio, provedor fora, DNS) é hora avulsa. Como essa fronteira é invisível para quem não programa, cada código de erro diz de quem é. Nos primeiros 30 dias depois da instalação, a garantia cobre os dois lados. Dois prazos: escola fora do ar e o resto. O canal e os prazos são decisão do produtor (A15).

## 5. Módulos

### 5.1 Como um módulo funciona e a loja de Módulos

Módulo é uma parte do produto vendida à parte. O nome proposto é **Módulo**, e não plugin: plugin lembra um arquivo que a pessoa baixa e instala, e aqui não se instala nada.

- **Já vai dentro do produto.** Todo módulo viaja desligado na mesma imagem que todo comprador recebe, e a licença assinada de cada Instalação diz quais estão ligados. É como a edição Enterprise do GitLab, do Mattermost e do n8n: um pacote só, e a licença destrava (§15).
- **Comprou, liga sozinho.** O módulo comprado entra na licença assinada na conferência diária seguinte, ou na hora pelo **Verificar agora**. O comprador não roda comando, não baixa arquivo e não reinicia nada.
- **A loja fica na nossa área de membros,** na página **Módulos**, ao lado de Minhas licenças e da aula. Cada módulo aparece com o que faz, o que pede além da área (um segundo servidor, uma conta de vídeo) e a situação para cada Licença do comprador: **Comprar**, **Ligado**, **Comprado, falta escolher a Licença** ou **Pede a versão 1.4 ou mais nova**.
- **Só compra quem tem a Licença da área.** A página e o botão **Comprar** só existem para quem tem Licença em dia. O pagamento continua na Hotmart ou na Ticto. Como o link do checkout pode circular, a trava de verdade fica do nosso lado: módulo sem Licença não tem onde ligar. Quem comprar assim é avisado por e-mail e escolhe: compra a Licença, e o módulo liga nela, ou pede o reembolso dentro da garantia.
- **Um módulo por Licença.** Cada compra liga o módulo numa Licença. Quem tem uma Licença só não escolhe nada. O módulo acompanha a Licença na troca de servidor e de endereço. Mover um módulo de uma Licença para outra é pelo suporte.
- **Comprado junto com a primeira Licença,** o módulo liga nela assim que ela existe.
- **Módulo novo pede versão nova.** Um módulo lançado depois da versão instalada só liga depois que o comprador atualiza. A loja e o admin dele avisam.
- **Vale enquanto a Licença valer.** O módulo não tem validade própria no padrão assumido (A33). Com a Licença anual vencida, a escola inteira segue a escada do §2.2, com os módulos junto.
- **Sem o módulo, nada aparece.** O item do menu, as páginas, as rotas e as tarefas de minuto do módulo somem. Nada fica aparecendo com erro (§11.8).
- **A regra para os módulos que vierem:** todo módulo novo nasce atrás da mesma guarda dos Webinários, com uma chave própria, e as tabelas dele existem em toda Instalação, vazias em quem não comprou. Pôr um módulo novo à venda é um registro no catálogo do Emissor (o nome, a descrição, a versão mínima e o código do produto em cada plataforma), sem versão nova do Emissor.

O que esta escolha custa, sem enfeite. Ligar pela Licença é o mais barato de construir e o mais simples para o comprador, mas o código de todo módulo vai para todo comprador: quem alterar o produto compilado destrava os módulos junto. A alternativa que protege mais é uma **segunda edição da imagem**, com o módulo dentro, entregue só a quem comprou. Para os Webinários, ela pede transformar em pontos de extensão 11 arquivos do núcleo, a regra de segmentos da Comunicação, o tipo de notificação do sino e as tarefas de minuto. Fica como passo seguinte, se aparecer cópia alterada circulando (§13.3).

### 5.2 Webinários: o que liga e o que o comprador precisa ter

| Parte | O que precisa, além da área | Observação |
|---|---|---|
| Página de webinários, **Garantir vaga**, lembretes pelo sino e por e-mail | nada | |
| **Live gravada** e **Replay** | uma conta da Bunny Stream | é requisito do módulo: a Live gravada e o Replay só aceitam vídeo da Bunny (as aulas aceitam também YouTube, Vimeo e Mux). Sem servidor extra |
| **Live ao vivo** | um segundo servidor para o vídeo, o endereço `meet.` apontado direto para ele e a porta UDP 10000 aberta | instalado pelo mesmo kit, com o perfil de vídeo. O endereço do vídeo não pode passar pelo proxy da Cloudflare. A capacidade é estimativa, não medida: cerca de 30 a 40 alunos com câmera em 2 vCPU e 4 GB, cerca de 100 em 4 vCPU e 8 GB (`docs/30` §7.1), e depende também da banda e da região do servidor |
| **Gravação da live ao vivo** | **sem gravação automática na primeira versão:** **Gravar no navegador** ou **Enviar gravação**, que já existem no console da equipe. Depois: um gravador fixo em servidor próprio (4 vCPU e 8 GB gravam em 720p; 1080p pede 8 vCPU e 16 GB); ou o nosso gravador por hora, como serviço (A8) | o gravador de hoje é criado pelo nosso GitHub e pela nossa conta da Hetzner (`src/server/webinars/recorder-dispatch.ts`); não serve ao comprador como está |
| **Assistente** e tradução do chat | a chave de um provedor de IA em Configurações › IA | opcionais |

### 5.3 Webinários: como a Licença liga

- **Sem o módulo,** o item do menu, as páginas, as rotas, as tarefas de minuto, a faixa "Ao vivo agora", o bloco do chat das lives no Perfil, o atalho **Avisar** e a regra **Participação em lives** dos segmentos somem. Nada fica aparecendo com erro, e as notificações antigas de live deixam de apontar para uma página que não existe.
- **Módulo desligado depois de usado** (reembolso do módulo): os Replays já publicados ficam no ar por 30 dias.
- **As tabelas dos Webinários existem em toda Instalação,** vazias em quem não comprou. Aplicar sempre é o caminho mais barato: as migrações deles mexem em tabelas do núcleo e as guardas de teste conferem o histórico inteiro das migrações.

### 5.4 Webinários: o que muda no produto antes de vender

- A permissão de câmera e microfone da sala é gravada na hora de gerar a imagem, com `meet.bunker707.com.br` (`next.config.ts`). Passa a ser montada a cada pedido, com o endereço de vídeo de cada Instalação.
- O gravador passa a ter um adaptador com **nenhum** como padrão; o nosso (GitHub mais Hetzner) vira uma das opções, só da nossa Instalação, e o endereço fixo do nosso repositório sai do código.
- A marca dentro do módulo (os rodapés dos e-mails de live, o nome na sala, os títulos das três páginas, o identificador do calendário) passa a vir do nome da escola (§6).
- O kit do servidor de vídeo (`infra/jitsi`) ganha um instalador próprio e uma conferência (endereço sem proxy, portas, segredo igual ao da área), deixa de depender de um script que fica fora da pasta dele e **fecha a porta 5222**: hoje o compose a publica para a internet e quem a limita é só o firewall da Hetzner.
- O kit passa a incluir o serviço de retransmissão (TURN), que hoje está pendente (`docs/20` §8B.4): sem ele, aluno em rede fechada de empresa ou de escola não entra na sala.
- O segredo que a área e o servidor de vídeo dividem deixa de ser copiado à mão: os dois se pareiam por um código de uso único. O admin ganha o **Testar sala**.
- Hoje não existe um liga e desliga do módulo inteiro: as variáveis `WEBINAR_*` só controlam a sala ao vivo, o Assistente e a tradução. A guarda por Licença é nova (§11.8).

## 6. Marca branca

**O que a Personalização já troca hoje** (Área de membros, no admin): a logo e o ícone, o estilo dos botões, dos cantos e do menu, o destaque da página inicial, as fileiras e a tela de login (quatro chaves em `platform_settings`).

**O que ainda está escrito com a nossa marca:**

| Onde | Quanto | Exemplo |
|---|---|---|
| Nome da escola em textos de tela | cerca de 30 linhas em 20 arquivos | o nome no sino, "(c) 2026 Bunker707" no rodapé, a mensagem de login indisponível |
| Título das páginas no navegador | 11 páginas e 2 molduras | "Perfil · Bunker707"; basta a moldura raiz ganhar um título com o nome da escola |
| E-mails da área | assuntos, cabeçalho, rodapé, cores e remetente | "Seu acesso à Bunker707 está pronto"; remetente padrão `equipe@mail.bunker707.com.br` |
| E-mails do login (convite, recuperar senha, link de acesso, confirmação) | 4 modelos e 6 assuntos, em `infra/compose` | ficam fora de `src/` e o aluno vê |
| Cor de destaque | o vermelho `#e50914` repetido em várias variáveis de `src/app/globals.css` e em mais dois pontos | |
| Imagens padrão | 10 arquivos em `public/` (13 MB); 4 são lidos pelo código | a logo, o destaque com "Bunker 707" em neon, uma capa com o nome do produtor |
| Modo TV | a logo fixa, que não lê a Marca | |
| Termos e Privacidade | não existem | o botão **Termos** do rodapé não faz nada |
| Endereços e identificadores padrão | o remetente, o endereço do vídeo na permissão da sala, o identificador do calendário, o repositório do gravador | |
| Instruções da IA Diretor | 1 | "Você é a IA Diretor da plataforma Bunker707" |
| Nomes da infra no servidor | o projeto do compose, os 13 contêineres, os volumes, a rede, as pastas e o serviço de backup | o aluno não vê; o comprador vê na lista de contêineres. Decide-se antes do primeiro fundador (§11.7 e A10) |

**Proposta:** uma chave nova de configuração, **Escola** (nome, nome curto, assinatura do rodapé, e-mail de suporte, remetente, cor de destaque, ícone do navegador), lida pelas páginas, pelos e-mails, pelo sino, pelo login, pelo Modo TV e pela IA Diretor; o instalador pergunta o nome e o remetente e gera os e-mails do login com eles; as imagens padrão viram artes neutras; e uma guarda de teste passa a falhar se "Bunker707" voltar a aparecer fora da lista de identificadores técnicos.

**Termos e Privacidade entram já no lote fundador,** como páginas de texto editável: a escola do comprador vai ao ar tratando dados de alunos e precisa das duas. Junto vai o inventário do que o produto coleta, para o comprador escrever a política dele. A nossa própria área também precisa de Termos, Privacidade e identificação de quem vende antes do primeiro fundador. A cor e o ícone do navegador entram na fase 2.

## 7. O que a Licença segura e o que não segura

Três tipos de pessoa: **A** compartilha ou revende sem mexer em código (o caso comum, os grupos de rateio); **B** compra, instala, pede reembolso e continua usando; **C** altera o produto compilado.

| Controle | O que impede | O que não impede |
|---|---|---|
| Chave de ativação de uso único e uma vaga por Licença, sem Instalação de teste | A: o comando repassado não ativa de novo, e a Licença não ativa além do que foi comprado. Vale para o próprio comprador: a segunda área dele pede outra Licença | C |
| Licença presa ao endereço, conferida pelo produto | A: o servidor copiado para outro domínio cai na escada do §2.2 sem precisar falar com o Emissor | quem esconde o endereço verdadeiro atrás de outro servidor (trabalho técnico) e C |
| Licença assinada que vence (dias, na garantia; 30 dias; depois 90) e ordem assinada de revogação | B: com contato, congela em 30 dias; cortando o contato, a licença vence sozinha e a escola congela do mesmo jeito | quem edita o banco à mão para matricular; C |
| Validade da Licença anual gravada na licença assinada | quem paga um ano e quer usar para sempre: o produto obedece a data de fim mesmo sem contato com o Emissor, e a escola segue a escada do §2.2 | quem edita o banco à mão para matricular; C |
| Sequência trocada a cada conferência | mostra, nos Alertas do Painel de licenças, duas cópias usando a mesma Instalação. É detecção, não bloqueio | a cópia que nunca fala com o Emissor (cai no endereço e no vencimento) |
| Pacote só para Licença válida, com cada download registrado | repassar atualizações: quem não tem Licença não baixa versão nova | o pacote que já foi baixado circular. Ele é igual para todos: não aponta para quem vazou |
| Módulo ligado só pela licença assinada | usar um módulo sem comprar, para quem não mexe em código | C, que destrava todos os módulos de uma vez (§5.1) |
| Produto compilado, sem código-fonte, sem mapas de fonte | reaproveitar o código e manter uma versão paralela com conforto | C, que lê o produto compilado com ajuda de IA em horas ou dias e pode até automatizar a alteração a cada versão |
| "Licenciado para" no admin de toda Instalação | a revenda disfarçada: o cliente final vê o nome de outra pessoa | a cópia alterada, que não mostra nome nenhum |
| Admin limitado e Escola congelada | o uso do admin e as contas novas pela área | quem tem acesso direto ao banco. Por isso o painel do banco fica fora do kit do comprador |
| Contrato, registro no INPI e a lei | dá base para notificar, tirar anúncio do ar e processar quem revende com nome e CNPJ (§9) | pirata anônimo ou fora do país |
| Serviços que só nós rodamos (Emissor, pacotes, gravador por hora, se houver) | A, B e C: não há como alterar o que roda no nosso servidor | só cobre o que é serviço; o núcleo roda sem eles |

O que decidimos não fazer: ofuscar o código (o projeto de ofuscação mais usado diz que a saída "ainda é JavaScript", fica de 15 % a 80 % mais lenta e é vulnerável a análise por IA), compilar para formatos fechados (não cifram nada e amarram a versão do Node) e tirar do ar à distância a escola de quem está em dia. O comprador típico é um produtor de cursos que não programa. A minoria que altera o produto perde as atualizações, o suporte, os módulos novos e os serviços, e responde pelo contrato. É a posição de Laravel e Sidekiq, que entregam até o código-fonte e controlam o canal de atualização. No vencimento, a Licença anual é mais firme do que os plugins pagos de WordPress, que continuam funcionando sem atualização: aqui a escola congela por etapas, perto do que o GitLab faz ao deixar a instância somente leitura (§15).

**O ideal do produtor e até onde ele vai.** O pedido de 10/11/2026 foi: o cliente instala e usa a Licença que comprou, e ninguém usa de graça, nem outra pessoa, nem o próprio cliente num segundo ambiente ou numa segunda área. Para quem não altera o produto, o desenho entrega isso por inteiro: uma Licença, um endereço, uma escola, um prazo. Para quem altera o produto compilado, nenhum desenho entrega: o programa roda no servidor dele, sob o controle dele. O que encarece esse caminho é o conjunto: refazer a alteração a cada versão, ficar sem correção de segurança, sem módulo novo e sem suporte, e responder pelo contrato com o nome do titular gravado na cópia licenciada.

O vazamento que a lei garante: qualquer pessoa pode comprar, baixar e pedir o dinheiro de volta em 7 dias. O pacote vai circular. Por isso ele não vale nada sem ativação.

## 8. Modelo comercial

### 8.1 Unidade e volume

A unidade é a **Instalação**, como o "site" dos plugins de WordPress e a "instalação num domínio" do Kirby. No mercado há dois formatos: **degraus** (1, 3, 10 ou ilimitado, nos plugins de WordPress, em que 3 custam de 1,3 a 2,7 vezes o preço de 1) e **quantidade com desconto pequeno por volume** (o Kirby dá 5 %, 10 % e 15 % a partir de 5, 10 e 15 licenças; o Yoast também vende por unidade). Os multiplicadores grandes vêm de plugins baratos; quem licencia por instalação costuma dar desconto pequeno por unidade. A proposta segue o segundo formato: uma Licença de 1 Instalação, comprada quantas vezes o titular quiser, com cupom para as seguintes. Os pacotes com desconto grande ficam para o plano de agência (A2).

### 8.2 Anual, anos adicionais e vitalícia

Decisão do produtor em 10/11/2026. A primeira versão desta página propunha a licença perpétua com 12 meses de atualizações. Ficou a Licença com prazo, mais firme contra o uso sem pagar, ao lado da vitalícia.

| | Licença anual | Licença vitalícia |
|---|---|---|
| O que o comprador paga | um ano por vez; compra Anos adicionais quando quiser, um ou vários | uma vez |
| Validade | 12 meses, mais 12 a cada Ano adicional | sem data de fim |
| Versões novas e suporte | enquanto a Licença vale | versões enquanto o produto existir; o atendimento do suporte é a decidir (A31) |
| Quando o prazo acaba | avisos, carência e a escada do §2.2; quem já é aluno não perde o acesso | não se aplica |
| Na Hotmart e na Ticto | pagamento único a cada compra, sem assinatura na primeira versão | pagamento único |
| Quem faz parecido | GitLab e Mattermost, por assinatura anual: vencida, o GitLab fica somente leitura e o Mattermost rebaixa de plano. Os plugins de WordPress, também anuais: vencidos, continuam funcionando sem atualização | Unraid: a Lifetime custa US$ 249, ao lado dos planos de US$ 49 e US$ 109, que trazem um ano de atualizações e extensão de US$ 36 por ano. LifterLMS: um pacote vitalício ao lado dos planos anuais |

**Por que o Ano adicional é compra avulsa, e não assinatura.** O nosso sistema já trata a compra, o fim da garantia, o reembolso e o chargeback de um pagamento único. A renovação, o atraso e a troca de plano de uma assinatura são ignorados hoje. Com a compra avulsa não há cobrança automática para dar errado nem parcela em atraso para tratar, e o comprador pode pagar dois ou três anos de uma vez. O custo é que nada renova sozinho: a renovação depende dos avisos (60, 30 e 7 dias antes) e do botão **Renovar**. A renovação automática por assinatura pode entrar depois, como opção (§13.3).

**Quando o Ano adicional é comprado.** Antes do vencimento ou dentro da carência, os 12 meses somam na data de fim. Depois da carência, contam do dia da compra: o comprador não paga pelos dias em que a escola ficou limitada (A11).

**Os cuidados com a vitalícia.** É uma promessa que custa para sempre e é paga uma vez. O ACF vendeu licenças vitalícias até 2020, continua honrando, e em 2021 foi criticado ao pedir que esses clientes passassem ao plano anual (§15). Três cuidados: dizer por escrito o que ela inclui (A31); cobrar um preço que pague os anos de versões e de atendimento que vêm depois; e guardar no contrato o direito de parar de vender a vitalícia a qualquer momento, sem mexer nas que já foram vendidas. A única referência de preço conferida é a do Unraid, em que a vitalícia custa 2,3 vezes o plano maior com um ano de atualizações.

**O custo da Licença anual, sem enfeite.** Uma escola com alunos pagantes dentro fica limitada se o dono esquecer ou decidir não renovar. É por isso que os avisos começam 60 dias antes e vão a dois e-mails, que existe a carência, que a volta é na hora e que o aluno que já está dentro não perde o acesso. O texto dessa escada no contrato é trabalho do advogado (§9).

### 8.3 Módulos e serviços

- **Módulos:** um produto por módulo, comprado para uma Licença. No padrão assumido, pagamento único, valendo enquanto a Licença valer, e o Ano adicional tem um preço só, com ou sem módulos (A33).
- **Instalação feita por nós:** preço fixo e escopo fechado (§3.5), como o Discourse fazia com a instalação padrão e como instaladores de terceiros fazem hoje; o que foge do padrão vira horas, como os pacotes da Odoo.
- **Gravação por hora:** só se o produtor quiser operar um serviço (A8). Contraria o "produto, não SaaS", nos torna operadores dos dados da live e pede mais do que hoje: o nosso gravador precisaria das senhas do servidor de vídeo do comprador.

### 8.4 Hotmart e Ticto

O que as duas suportam, pelo que foi lido: produto de software com entrega em área de membros externa; pagamento único e assinatura anual; e os avisos de compra, fim da garantia, reembolso, chargeback e cancelamento de assinatura que o nosso sistema já trata.

A configuração proposta dos produtos de Licença, de Ano adicional e de módulo: pagamento único; garantia de 7 dias; venda só no Brasil no começo; parcelamento só pelo emissor do cartão. Os parcelados financiados pela plataforma e os recuperadores de cobrança ficam desligados nesses produtos: senão aparece a "parcela em atraso" de uma Licença já ativada, que pediria mais uma linha na escada do §2.2.

O que o modelo escolhido poupa do nosso lado: como nada é assinatura, não é preciso tratar a renovação, o atraso e a troca de plano. O que falta: o mapa de produtos do Emissor dizer o que cada código é (Licença anual, Ano adicional, vitalícia, troca para vitalícia ou módulo) e a compra cair na Licença certa (§11.10).

O que confirmar antes de anunciar: com o compliance da Hotmart, que "software instalável com licença e aula" é aceito (a política de uso proíbe software "OEM, NFR, cópias ou backup" e não fala de licenças) e qual é o formato certo do serviço de instalação; com a Ticto, o tipo de produto (o tipo Software é tratado como assinatura) e o que ela pede como prova de autoria. Nas duas, como deixar fora da vitrine os produtos que só fazem sentido para quem já tem a Licença (o Ano adicional e os módulos). Começar pela plataforma que aprovar primeiro (A21).

A conta por venda, a fazer com o contador (A24): o preço, menos a taxa da plataforma (na Hotmart, 9,9 % mais R$ 2,49; na Ticto, 6,99 % mais R$ 2,49 de referência), menos o imposto, menos o custo de suporte daquele comprador.

### 8.5 O que a página de venda precisa dizer

- Roda em servidor próprio com acesso de administrador. **Não roda em hospedagem compartilhada.**
- O que o comprador paga por fora, todo mês: o servidor, o domínio, o e-mail acima do plano grátis e o vídeo. E, para instalar com IA, a assinatura da IA.
- As vendas da escola dele precisam ser pela Hotmart ou pela Ticto.
- Quanto tempo leva de verdade: o script e a jornada inteira (§1.4).
- Quantos alunos ao mesmo tempo cada tamanho de servidor aguenta, com o número medido.
- Atualizar pede terminal ou IA.
- A Live ao vivo pede um segundo servidor e não grava sozinha na primeira versão.
- A Licença vale para uma área de membros, num endereço, sem ambiente de teste; tem um titular e não pode ser revendida. A anual vale 12 meses, e a página diz o que acontece quando vence (§2.2); a vitalícia diz o que inclui (A31). E a cláusula de continuidade.
- Os módulos são vendidos à parte, só para quem tem a Licença, e o que cada um pede além da área.
- O sumário do contrato e a política de garantia e reembolso.

## 9. Jurídico

**Para que serve o advogado, em palavras simples.** A Licença é um contrato. É o texto que o comprador aceita antes de instalar que proíbe revender, copiar e usar em mais de um lugar. A trava técnica segura quase todo mundo; o contrato é o que permite agir contra quem passa por ela: notificar, tirar anúncio do ar, cobrar multa e processar. O advogado entra uma vez, antes da primeira venda, para quatro coisas: escrever esse contrato; conferir se as consequências automáticas (a escola que fica limitada quando a Licença vence ou é revogada) estão escritas de um jeito que a lei aceita; escrever o anexo de dados, porque ao instalar e dar suporte a nossa equipe mexe em dados dos alunos do comprador; e conferir os direitos sobre o programa (a autoria e o registro no INPI). O contador cuida do imposto e da nota. Nada disso trava o desenho nem a construção: trava a primeira entrega a um cliente.

O que a lei brasileira já dá (texto conferido, §15):

- **Lei 9.609/1998 (Lei do Software).** O programa é protegido como obra por 50 anos, sem precisar de registro. O uso é objeto de **contrato de licença** (art. 9º). O contrato e a nota fiscal devem trazer o **prazo de validade técnica da versão** (art. 7º), e quem vende deve prestar os serviços técnicos complementares durante esse prazo (art. 8º). Esse prazo ainda não está definido. A proposta, para o advogado confirmar: na Licença anual, o período pago; na vitalícia, 12 meses para cada versão publicada, com a versão mais nova sempre disponível. Reproduzir ou vender cópia sem autorização, para comércio, é crime com reclusão de 1 a 4 anos e multa (art. 12, §§ 1º e 2º); a ação penal depende de queixa, com prazo de seis meses; há ação para proibir o ato, com liminar e perdas e danos (art. 14). O art. 6º lista atos que não ofendem o direito do titular (a cópia de segurança, por exemplo); o contrato os preserva por escrito.
- **Lei 9.610/1998, art. 107** (vale para programas no que couber). Pune com perdas e danos quem altera ou inutiliza o dispositivo técnico que evita ou restringe a cópia. Usá-lo contra quem arranca a verificação de licença é uma tese para o advogado avaliar, não uma regra assentada: a verificação restringe o uso, e não achamos decisão que aplique o artigo a esse caso.
- **Código de Defesa do Consumidor, art. 49, e Decreto 7.962/2013.** Sete dias de arrependimento para o consumidor em venda pela internet; nas plataformas, a garantia de 7 dias vale para toda venda, por regra delas. Por isso toda Licença precisa poder ser revogada na primeira semana (§2.5), e os contratos acessórios caem junto (§3.5).
- **LGPD.** O comprador é o controlador dos dados dos alunos dele. A conferência diária não leva dado de aluno, mas isso não basta: **somos operadores desses dados desde o lote fundador**, sempre que instalamos, atualizamos, damos suporte com acesso ao servidor, trazemos alunos de outra plataforma ou gravamos uma live. Por isso os contratos de licença e de serviço levam um anexo de tratamento de dados desde a fase 1; a imagem entregue ao comprador não pode levar as nossas chaves de análise de uso e de erros (hoje elas entram na geração da imagem, §11.5); o diagnóstico não leva dado pessoal de aluno; e o comprador recebe o nosso aviso de privacidade sobre os dados dele, que são dados pessoais quando o titular é pessoa física ou MEI.
- **Marco Civil, art. 15.** A empresa que roda a área (o comprador) guarda os registros de acesso dos alunos por 6 meses. O produto precisa dizer onde esses registros ficam e garantir que a limpeza de dados antigos não os apague antes do prazo; isso está por conferir.

Cláusulas do contrato de licença (o texto é do advogado): licença de uso, não cessão; uma Instalação por Licença, num endereço, sem ambiente de teste; o titular e a sucessão (CNPJ novo, venda da escola, herança); uso para as escolas do próprio titular; intransferível e sem sublicença; proibido revender, redistribuir, hospedar para terceiros ou oferecer como serviço; multa por Instalação a mais; proibido alterar ou contornar a verificação de licença; os atos do art. 6º preservados; obras derivadas; o que a conferência diária envia; o prazo da Licença anual e os Anos adicionais; o que a vitalícia inclui e o direito de parar de vendê-la; os módulos como acessórios da Licença; o prazo de validade técnica; o que acontece em cada situação do §2.2, escrito antes da compra, com o critério da liberação de quem já teve reembolso; o nome do titular mostrado no admin; a exportação dos dados na saída; **a continuidade** (a licença definitiva se o produto acabar, §10); notificação e prazo para corrigir antes de qualquer medida por descumprimento; tolerância que não vira renúncia; limite de responsabilidade; marca; foro; e o anexo de tratamento de dados. O contrato é proprietário. As licenças abertas mais citadas não servem de modelo: a Elastic License 2.0 e a Fair Core License foram escritas para código público e permitem redistribuir; delas se aproveita a redação da cláusula contra contornar a verificação. A PolyForm Internal Use, que proíbe distribuir, ajuda na redação do uso interno.

Antes da primeira venda, na fase 0:

- **A cadeia de direitos.** Um parecer sobre a autoria de um programa escrito com assistência de IA, as cessões por escrito de quem colaborou e o titular do registro igual a quem vende.
- **O registro do programa no INPI** (envia-se só um resumo digital do código, com certificado ICP-Brasil; vale 50 anos). Dá presunção de autoria e de data para as ações acima; não é condição da proteção.
- **O registro da marca do produto.**
- **Os avisos de terceiros.** O pacote leva a lista das licenças das bibliotecas que o produto usa, com uma guarda de teste.
- **A referência visual.** A área nasceu de um estudo da Astron Academy (`docs/03` e `docs/11`), com a regra de não copiar. Vender como concorrente dela pede que o advogado confira os termos de uso da Astron e o resultado visual (concorrência desleal e conjunto-imagem). Se nada aparecer, fica como risco aceito.
- **Fiscal e nota,** com o contador (A24): quem vende, a atividade da empresa, o imposto sobre a licença e sobre o serviço, e a nota automática com o número da Licença e o prazo de validade técnica.

O que só o advogado decide (A16): se o CDC vale para o comprador (quem compra para vender cursos usa o programa na atividade profissional, e o critério dos tribunais é a vulnerabilidade no caso concreto); o limite de responsabilidade e o foro; o texto das situações do §2.2 para não virar prática abusiva, em especial a escada da Licença anual vencida, que limita a escola de quem só não renovou, e se cabe um degrau mais duro (A3); o que a palavra "vitalícia" promete e por quanto tempo; o arrependimento de 7 dias quando a instalação feita por nós já foi entregue; e a tese do art. 107. Nada nesta página substitui o advogado e o contador.

## 10. O nosso lado

- **A nossa produção volta a ficar ligada 24 horas antes do primeiro comprador do lote fundador.** Hoje ela fica guardada em snapshot e só é ligada para testes (`docs/21` §10). O servidor da área custa cerca de EUR 6 por mês num CX23 (EUR 6,49 pela API em 19/10/2026; EUR 5,99 no site em 10/11/2026, com a linha marcada sem estoque; o tipo seguinte de 4 GB vai de EUR 17 a 20). O servidor de marketing e o do vídeo podem continuar guardados até o lançamento da escola.
- **Do que uma instalação nova ou uma recuperação depende:** da nossa área (Minhas licenças e a aula), do Emissor, do armazenamento dos pacotes e do endereço do instalador. Os quatro precisam de meta de disponibilidade e de uma página pública de situação. A recuperação no mesmo endereço fala direto com o Emissor e com os pacotes, sem passar pela nossa área, que é a Instalação número 1 e recebe toda versão primeiro.
- **O Emissor tem banco só dele desde o primeiro dia e ganha um servidor só dele na venda aberta** (A19). A nossa área é um site público com login de alunos, e os compradores recebem o mesmo produto que ela roda: quem a invadir não pode encontrar ali a chave que assina licenças nem a tabela de licenças. O **Painel de licenças** mora no Emissor pelo mesmo motivo: emitir, estender e revogar à mão só se faz ali, com login próprio e segundo fator, e a credencial que a nossa área usa para falar com o Emissor não alcança essas ações (D32).
- **Duas chaves.** A chave **raiz** fica fora de qualquer servidor e só assina a chave de **emissão**, que fica no Emissor e pode ser trocada sem mexer no produto. O produto leva gravada a raiz e uma raiz de reserva. Isso cobre tanto a chave perdida quanto a chave copiada.
- **Se o Emissor cair,** os compradores não sentem nada enquanto a licença guardada valer (30 ou 90 dias). Ele tem backup diário, fica atrás da proteção da Cloudflare, num endereço separado do da escola. A segunda saída é uma **extensão assinada** publicada no armazenamento dos pacotes, que toda Instalação busca quando o Emissor não responde. A terceira é a licença por arquivo, de 12 meses (§2.3).
- **Se o produto acabar.** Uma Licença vitalícia não pode depender de nós para sempre, e quem pagou um ano não pode perder o que pagou. O contrato traz a cláusula de continuidade: se encerrarmos o produto, ou se o Emissor ficar fora do ar por mais de 60 dias, é publicada a licença definitiva, que não vence, para toda Licença em dia naquele momento, anual ou vitalícia. Para isso valer mesmo sem nós, uma cópia da chave raiz fica com um depositário (A23).
- **Os pacotes** ficam num armazenamento de arquivos com link temporário (por exemplo o Bunny Storage, que já usamos). Cada versão pesa algumas centenas de megabytes; o custo é de centavos por comprador (A18).
- **Rotina de versão:** toda versão passa primeiro pela nossa própria escola, que vira a **Instalação número 1** do produto: o mesmo produto, o mesmo kit (mais os sites do Emissor e do marketing no nosso Caddy) e uma Licença emitida por nós mesmos (D21). Só dias depois o pacote vai para os compradores, com as notas da versão.
- **Segurança:** uma falha no produto passa a valer para todas as escolas que o rodam. A correção sai como versão, o aviso chega pelo admin de cada comprador e por e-mail, e nesses casos a versão mais nova fica liberada também para quem está com a Licença anual vencida há até 6 meses (A11).

## 11. Por dentro

### 11.1 Visão geral

```txt
NOSSO LADO                                              SERVIDOR DO COMPRADOR
+-----------------------------------+                   +-----------------------------------+
| nossa área (Instalação número 1)  |                   | área do comprador (o mesmo produto)|
|  venda Hotmart/Ticto -> fila      |     ativar        |  Verificador (src/server/         |
|  Minhas licenças / Módulos        | <---------------- |    licensing): licença assinada,  |
|         | adaptador HTTP          |  conferir, 1x/dia |    endereço, validade, degraus,   |
|         v                         | <---------------- |    módulos                        |
| Emissor (services/                |  pacote da versão |  tarefa de minuto: conferência    |
|   bunker-licensing): Licenças,    | ----------------> |  comando de operação              |
|   Instalações, módulos,           |                   |  Supabase e Caddy                 |
|   assinatura, versões;            |                   +-----------------------------------+
|   banco próprio                   |
| Painel de licenças (só a equipe)  |
+-----------------------------------+
          | link temporário
          v
   armazenamento dos pacotes (e a extensão assinada de emergência)
```

### 11.2 Emissor (`services/bunker-licensing`)

- **Onde mora:** numa pasta própria em `services/`, com Dockerfile e compose seus, escrito por nós em Node. É o primeiro serviço nosso fora do app: o `services/bunker-ai-gateway`, que mora ao lado, é um proxy de terceiros, só de desenvolvimento local. Por isso o Emissor pede o que ainda não existe: banco próprio, migrações na pasta do serviço (**nunca** em `supabase/migrations`, que vai no pacote do comprador), etapa própria de deploy, segredos, DNS e site no Caddy. O `.dockerignore` já tira `services/` da imagem do produto. No lote fundador roda no servidor da nossa área; na venda aberta, num servidor só dele (A19).
- **Backup do Emissor:** perder um dia de ativações deixaria Instalações válidas sem registro. O backup dele é de hora em hora, e depois de uma restauração vale a regra de readoção: a Instalação que apresenta um segredo válido e uma licença assinada por nós é aceita de volta, e a sequência recomeça.
- **Por que separado do produto:** (1) a chave que assina as licenças e a tabela de Licenças não ficam no mesmo lugar que um site público com login de alunos; (2) um emissor dentro do produto daria a quem quisesse piratear um servidor de licenças pronto, bastando trocar a chave pública gravada; (3) a nossa escola continua rodando exatamente o produto que os compradores recebem (D21). Dois dos três desenhos também separam; o de lançar rápido começa como módulo da área e separa depois.
- **Por que construir e não comprar:** nenhuma ferramenta de licenças fala com a Hotmart ou com a Ticto, então a ponte da venda até a Licença seria nossa de qualquer jeito, e ela já existe pela metade (`src/server/payments`). O Keygen na nuvem é grátis até 100 licenças ativas e custa US$ 99 por mês daí em diante; o que pesa contra ele é cada escola depender de um serviço de fora para ativar e renovar, e não haver caminho de saída da nuvem para a edição de rodar em casa. O Keygen de rodar em casa é completo e recebe correções, mas traz um Rails com Sidekiq, Redis e outro Postgres para operar. O que precisamos é pequeno: Licença, ativação com limite, conferência, revogação e módulos.
- **API pública** (para as Instalações): `POST /v1/preflight` (confere a Chave e a vaga sem gastar, e bate de fora nas portas do servidor), `POST /v1/activate` (repetível no mesmo endereço), `POST /v1/check-in`, `POST /v1/deactivate`, `GET /v1/releases` e `GET /v1/releases/{versão}/bundle`. Fica em endereço próprio, numa zona sem o desafio automático de robôs da Cloudflare, que barraria conferências feitas por servidor. Limite de pedidos por Instalação e por IP; nenhuma resposta diz mais do que o necessário.
- **API interna** (só para a nossa área, com credencial estreita): emitir e revogar por venda, só com a transação conferida; e o autoatendimento do comprador que está logado (listar as Licenças dele, gerar a Chave de ativação, desativar, autorizar a troca de endereço, baixar a licença por arquivo e aplicar uma compra a uma Licença). Emitir por cortesia, estender, suspender, revogar à mão e reativar não passam por ela: só existem no Painel de licenças.
- **Painel de licenças:** as telas do §2.4, servidas pelo próprio Emissor num endereço separado do da API pública (por exemplo `licencas.bunker707.com.br`), só para a nossa equipe. O login é próprio, com segundo fator por aplicativo de códigos e sessão curta; não usa o login da escola. Toda ação grava quem fez, quando e por quê, e a emissão por cortesia manda e-mail ao dono e tem um teto por dia. No lote fundador entra o mínimo: Clientes, Licenças, Instalações, **Emitir**, **Estender**, **Suspender**, **Revogar**, **Liberar vaga** e Auditoria. Vencimentos, Módulos, Alertas com e-mail e Versões entram nas fases seguintes (§12).
- **Tabelas:** `licenses` (o comprador, o titular e o aceite do contrato, o tipo: anual ou vitalícia, a situação, o início do prazo, a validade, o fim da garantia), `purchases` (as compras de cada Licença: a própria Licença, cada Ano adicional, a troca para vitalícia e cada módulo, cada uma com a plataforma, a transação e o código do produto; é daqui que sai "só o módulo desliga" e "a validade volta ao que era"; a compra ainda não aplicada fica aqui, sem Licença), `product_map` (o código do produto em cada plataforma e o que ele é: Licença anual, Ano adicional com os meses que soma, vitalícia, troca para vitalícia ou módulo), `modules` (o catálogo da loja: a chave, o nome, a descrição, a versão mínima e se está à venda), `installations` (a Licença, o identificador, o endereço, os módulos ligados, a situação, a primeira e a última conferência, as versões, o segredo da Instalação em hash, a sequência), `activation_keys` (uso único, validade de 24 horas), `license_events` (auditoria, com cada download e cada ação do Painel), `operators` (as contas do Painel, com o segundo fator) e `releases` (a versão, a data, o caminho do pacote, o resumo sha256, as notas, se é correção de segurança).
- **As chaves que assinam:** Ed25519, que o Node assina e confere sozinho (`node:crypto`). A raiz fica fora de servidor e assina a chave de emissão; o produto leva gravadas a raiz e uma raiz de reserva (§10).
- **A sequência:** cada conferência devolve um número sorteado que a Instalação guarda e apresenta na seguinte. Duas cópias usando a mesma Instalação passam a apresentar sequências diferentes e aparecem nos Alertas do Painel de licenças. Uma restauração de backup legítima ressincroniza sozinha.
- **Venda repetida:** a emissão é única por plataforma, transação e código do produto, porque na Ticto uma transação traz vários produtos. O Ano adicional soma os 12 meses uma vez só, mesmo com o aviso repetido.
- **Ambientes:** a `dev` e os testes falam com um simulador do Emissor, com uma raiz de teste. Só a produção fala com o Emissor de verdade.

### 11.3 Verificador (`src/server/licensing`)

| Arquivo | O que faz |
|---|---|
| `model.ts` (puro) | o formato da licença assinada, as situações e os degraus do §2.2, os prazos (dias na garantia, 30 e 90; a validade da Licença anual e a carência) e o que cada degrau permite |
| `artifact.ts` (puro) | lê a licença e confere a assinatura com as chaves públicas gravadas |
| `client.ts` (`server-only`) | ativar, conferir e desativar no Emissor, com tempo limite e erros tipados, no molde de `src/server/ai/account-gateway.ts` |
| `store.ts` | a tabela `license_state` (uma linha: a licença assinada, o segredo e a sequência da Instalação, a última conferência, a última hora vista), só do servidor |
| `state.ts` | a situação guardada na memória do processo por alguns minutos e relida da tabela; a tarefa a renova. Uma memória só por renderização não serve, porque há rotas consultadas sem parar |
| `require-feature.ts` | `isFeatureEnabled` e `requireFeature`, a fonte única dos módulos ligados |
| tarefa `licenca-conferencia` | entra em `src/server/jobs/registry.ts`; roda no agendador de minuto e trabalha uma vez por dia, numa hora sorteada, com tempo limite curto e nova tentativa de hora em hora quando falha. Falha de rede nunca vira erro do agendador, e a licença guardada continua valendo |

- **O produto vendido sempre exige licença.** A exigência, o endereço do Emissor e as raízes entram como texto no código gerado (pela chave `env` do `next.config.ts`), não como variável do contêiner: a `APP_VERSION`, por exemplo, é lida ao rodar, e o comprador a troca no compose. Nenhuma variável de ambiente afrouxa a licença. O desenvolvimento e os testes usam um build sem a exigência, com a raiz de teste e o simulador do Emissor. Antes da produção há três conferências: um job do CI que testa a imagem com a exigência (sem licença, só a tela de ativação), a nossa Instalação de homologação, com Licença própria emitida por nós, e a nossa escola.
- **As páginas de vendedor** (Minhas licenças e Módulos) ligam por um módulo que só a nossa licença assinada traz. O Painel de licenças não é do produto (§11.2).
- **O endereço:** o Verificador compara o endereço da licença com o endereço configurado da Instalação (o mesmo que monta os links dos e-mails e dos convites, obrigatório no kit) e com o endereço dos pedidos. Para não dar alarme falso, olha só os pedidos do admin que chegam pelo proxy com nome público (pedidos internos, a saúde do contêiner e o agendador não contam), compara o endereço normalizado (com ou sem `www`, maiúsculas, porta) e só avisa depois de divergência repetida por horas.
- **A validade:** a data de fim da Licença anual vem dentro da licença assinada. O Verificador conta os avisos, a carência e os degraus a partir dela, sem depender do Emissor: cortar o contato não adia o vencimento. O Ano adicional comprado chega como uma licença assinada nova, na conferência seguinte, ou pela licença por arquivo.
- **Quatro classes de ação.** Hoje as 175 ações do admin passam por `runAdminAction` (30 arquivos) e 21 rotas passam por `requireApiRole`, e nenhum dos dois sabe o que a chamada faz. Cada ação passa a declarar uma de quatro classes: leitura; atendimento (trocar senha, remover acesso, pedidos da LGPD); matrícula; e conteúdo e configuração. O Admin limitado barra a quarta; a Escola congelada barra também a matrícula de conta nova. Uma guarda de teste não deixa ação nova sem classe.
- **Onde o congelamento barra:** o acesso nasce em `grantResolvedProducts` (`src/server/students/access.ts`), e três caminhos de matrícula não passam por `provisionStudentAccess`. A guarda fica em `grantResolvedProducts` e nos ramos que reabrem ou estendem acesso, deixando passar quem já tem conta. Reembolso e chargeback dos alunos da escola continuam sendo processados.
- **Venda guardada:** responde sucesso à plataforma, ganha situação própria e volta sozinha, em lote, quando a licença regulariza. O **Reprocessar** de hoje é uma venda por clique, só do dono, e vale por 12 meses: não serve para isso.
- **Avisos por e-mail:** cada degrau e cada venda guardada viram e-mail pela fila que já existe (`email_outbox`): para o dono da escola e, na venda guardada, um e-mail neutro para quem pagou. O Emissor avisa o titular pelo lado dele.
- **Saúde do contêiner:** `/api/health` continua respondendo sucesso sem licença, para o Docker não reiniciar o produto em laço.
- **Onde a situação aparece:** na moldura do admin (a faixa, no molde do `PendingMigrationNotice`) e na tela Licença. Nenhuma página do aluno é barrada pela situação da licença: as páginas do aluno só consultam os módulos ligados (§11.8).
- **Por que tabela própria e não `platform_settings`:** a `platform_settings` inteira entra no cache do catálogo que toda página do aluno lê.
- **Relógio:** a hora que vale é a maior entre o relógio e a última hora vista, com tolerância de 48 horas. A cada conferência boa, a última hora vista é realinhada com a hora assinada pelo Emissor, para um relógio adiantado uma única vez não prender a Instalação no futuro. Relógio errado sozinho nunca limita: no pior caso, conta como sem contato.
- **Variáveis novas:** a guarda `tests/infra-compose-env.guard.test.mjs` exige que toda variável do `.env.example` lida em `src/` chegue ao serviço da área no compose.

### 11.4 Os artefatos

| Artefato | O que é | Quem guarda |
|---|---|---|
| **Chave de ativação** | um código sorteado de 128 bits ou mais, com prefixo e dígito de conferência; uso único, vale 24 horas | aparece em Minhas licenças, dentro do comando |
| **Segredo da Instalação** | criado na ativação; identifica a Instalação nas conferências e nos downloads | a Instalação; o Emissor guarda só o hash |
| **Licença assinada** | um JSON com o número da Licença, o titular, o identificador e o endereço da Instalação, o tipo (anual ou vitalícia), a validade da Licença, os módulos (cada um com prazo próprio enquanto a compra dele estiver na garantia), emitida em, vale até, a versão do formato e o identificador da chave; mais a assinatura | a Instalação, em `license_state` |
| **Pacote da versão** | a imagem do produto, os arquivos do compose e do Caddy, as migrações, os scripts, a lista das licenças de terceiros e um manifesto assinado com o resumo de cada parte | o armazenamento dos pacotes |

### 11.5 Uma imagem para todos

Hoje não existe uma imagem que sirva a dois endereços. São fixados quando a imagem é gerada: o endereço do Supabase e a chave publicável (os `ARG NEXT_PUBLIC_*` do `Dockerfile`, que o Next grava nos pacotes do navegador e do servidor), as chaves do PostHog e do Sentry, as origens aceitas pelo otimizador de imagens (`src/lib/image-hosts.ts`), a permissão de câmera e microfone com o endereço do vídeo (`next.config.ts`, que nem é argumento do `Dockerfile`) e as 10 imagens da marca em `public/`. O deploy da nossa produção gera uma imagem com os endereços dela.

**O que um build de conferência já mostrou** (10/11/2026, sem nenhuma variável pública na geração e com as variáveis só ao rodar):

- **No servidor, funciona:** o código do servidor lê as variáveis ao rodar e a CSP sai com o endereço dado ao rodar. Mas só depois de tirar do `Dockerfile` as linhas 35 a 40, que declaram as variáveis vazias: com elas, o Next grava o valor vazio no código.
- **No navegador, não funciona:** 8 arquivos leem a variável no topo do módulo: o login e a troca de senha, o cartão e o editor Livre, o envio de vídeo, o PostHog, o Sentry e a lista de origens de imagem.
- **As imagens do Storage quebram todas:** a lista de origens fica gravada, e o otimizador recusa a capa da escola.
- **A permissão da sala** fica gravada com o nosso endereço, qualquer que seja o ambiente.
- **Os mapas de fonte** que vão para a imagem já são vazios; a guarda só precisa manter isso.

**O que muda:** o `Dockerfile` sem aquelas linhas; os 8 arquivos lendo uma configuração que o servidor entrega na página; a permissão da sala saindo do `next.config.ts` e indo para o `src/proxy.ts`; uma saída para as imagens (um carregador próprio pelo redimensionador do Storage, que já está no compose, ou o marcador trocado na subida do contêiner, que é o que o Dockerfile oficial do Cal.com faz; a origem curinga não, porque o otimizador aceita endereço interno); o PostHog e o Sentry desligados por padrão no produto (se o comprador quiser os dele, entram pela mesma configuração); o HSTS sem `includeSubDomains`, para não prender os outros subdomínios do comprador; e o Speed Insights só na Vercel. A Vercel continua com as variáveis na geração: a leitura aceita os dois caminhos.

**A simplificação que o endereço único permite:** com a API no mesmo endereço da área e uma chave publicável igual em todas as Instalações (ela é pública por natureza, e o gateway só a compara com a do arquivo de configuração), não sobra nenhuma variável pública do Supabase por Instalação.

| Caminho | Como | Quando |
|---|---|---|
| Imagem por Instalação, gerada no nosso CI | a imagem vai ao servidor por `docker save` e `docker load`, pelo SSH, sem login de registry no servidor do comprador. O deploy de hoje entra no GHCR de dentro do servidor com o token do workflow; isso não pode ir para o servidor de um comprador | o lote fundador (até 10 compradores) |
| Uma imagem para todos | as mudanças acima | a fase 2 |

Gerar no servidor do comprador está descartado: entrega o código-fonte e pede 2 GB livres.

Guarda nova da imagem publicada: não contém `bunker707.com.br` (hoje aparece em 3 arquivos da imagem), não contém as nossas chaves de análise de uso e de erros, não contém mapa de fonte com o código original nem a pasta `src/`, e sobe duas escolas diferentes no ensaio. A guarda das chaves vale já para a imagem por Instalação do lote fundador.

Para o fundador não precisar migrar na fase 2, decide-se antes do primeiro o que fica gravado no servidor e nos dados dele: o teste do endereço único é da fase 0; o produto passa a guardar as imagens pelo caminho e não pelo endereço inteiro (`src/server/db/media-assets.ts`); e os nomes da infra ficam decididos (§11.7). O regime de fundador termina quando a imagem única existir: a equipe passa cada fundador para ela e, dali em diante, ele atualiza sozinho.

### 11.6 Pacote da versão e migrações

- O pacote substitui o envio do repositório inteiro ao servidor. Guarda nova: o pacote não contém `src/`, `tests/`, `docs/`, `infra/cloud/` nem nada do Emissor, e contém a lista das licenças das bibliotecas de terceiros.
- **O que do Supabase vai no kit:** o Postgres, o Auth, o PostgREST, o Storage com o redimensionador de imagens, o gateway e o Caddy. Ficam fora o Realtime, o Supavisor e o Edge Runtime, que o app não usa (não há canal de tempo real nem chamada a funções em `src/`): são 873 dos 1.706 MB baixados numa instalação e 423 MiB de memória em repouso. O Studio e o postgres-meta já ficam fora. Mudam junto um teste do compose e a conferência final, que hoje exigem o Realtime, e a medida de memória é refeita com esse kit (A29).
- As migrações vão no pacote e são aplicadas por um migrador nosso, em `psql`, dentro do contêiner do banco: roda como `postgres`, um arquivo por transação, com trava contra duas execuções ao mesmo tempo, gravando no mesmo histórico da CLI do Supabase (`supabase_migrations.schema_migrations`). Um teste prova que ele chega ao mesmo esquema que a CLI. A nossa produção continua compatível e o servidor do comprador não precisa da CLI.
- **A regra que protege a volta atrás** não é "só acrescentar" (19 das 64 migrações redefinem uma função que já existia): é **a versão anterior do produto funciona no banco novo**, provada no CI a cada versão. A regra de só acrescentar já existe, com guarda, para as migrações da fase 4 dos Webinários (`tests/support/webinarios-migracao-guarda.mjs`); passa a valer para todas daqui para a frente.
- As guardas de hoje conferem o histórico inteiro das migrações: nenhuma migração antiga pode ser movida, renomeada ou editada.
- As imagens de terceiros do compose hoje são fixadas por etiqueta; no pacote passam a ser fixadas pelo resumo de cada uma.
- O registro do agendador de minuto (hoje em `infra/cloud/deploy.sh`) e a primeira conta da equipe (hoje `infra/cloud/equipe.sh`) passam para o instalador.
- **Rotina de versão:** o número, o pacote, quem assina o manifesto e onde essa chave fica são uma linha de trabalho da fase 1.
- **Entrega:** no lote fundador, a equipe leva. Na fase 2, o instalador baixa por link temporário, com a credencial da Instalação, e carrega a imagem com `docker load`; a assinatura é a do manifesto, conferida fora de qualquer registry. Um registry com credencial por Instalação fica para quando o tamanho dos downloads incomodar; já existem peças prontas para isso (o servidor de token `docker_auth` e o registry Zot). O GHCR daria acesso de leitura por conta do GitHub de cada comprador, o que exige que o comprador tenha conta e token no GitHub.

### 11.7 Instalador e comando de operação

- **O que reaproveita:** `infra/scripts/bootstrap.sh`, o compose e o Caddy de `infra/compose`, o `generate-secrets`, o `deploy.sh` do servidor, o `smoke.sh`, o `backup.sh` (que já lê o destino de uma variável) e o `restore.sh`. **O que fica de fora:** `infra/cloud` (Hetzner, Cloudflare e GitHub Actions), `infra/terraform` e `infra/mautic`. Duas peças saem de `infra/cloud` e vão para o kit: o envelope de segredos e a criação da chave dele. O gerador de segredos passa a rodar dentro da imagem do produto, para não pedir Node no servidor.
- **O que o `bootstrap.sh` precisa mudar para servidor de terceiros:** hoje ele para se não recebe uma chave SSH (em muitos provedores o servidor nasce com senha), fecha o login por senha, zera o firewall existente, deixa a porta 22 sem limite contando com o firewall da Hetzner, liga o reinício automático e só conhece o repositório do Docker para Ubuntu. Esses ajustes são pré-requisito do lote fundador fora da Hetzner.
- **O que depende do endereço público por dentro.** Hoje o servidor do app fala com o banco pelo nome público, passando pelo Caddy com TLS, e o Auth baixa o modelo de cada e-mail pelo mesmo caminho; se não consegue, manda o e-mail padrão dele, em inglês, sem erro no registro. Com o DNS ou o certificado errados, tudo falha junto, e o diagnóstico vê "banco fora" com o banco de pé. A decisão é da fase 1: ou o app passa a falar com o gateway pela rede interna (o endereço público fica só para montar links), ou o instalador confere, de dentro dos contêineres, o certificado e o download de um modelo, cada um com o seu código de erro. Nas duas, os modelos do login passam a ser servidos por um endereço interno.
- **Cloudflare opcional:** o Caddy de hoje assume a Cloudflare na frente. No kit, ele tira o certificado direto e uma opção liga as faixas da Cloudflare para quem usa.
- **A conferência final** usa os endereços públicos, então o instalador confere o DNS e o certificado antes dela.
- **Dois modos:** guiado, que pergunta o que falta, e com arquivo de respostas; `--conferir` roda só a conferência (sem Licença, para testar o servidor antes de comprar) e `--simular` mostra o que faria. Há ainda o modo de restauração, que instala sem Chave de ativação para receber um backup.
- **Nunca tranca o dono para fora:** o preparo do servidor não fecha o acesso que o dono usa sem antes confirmar o novo.
- **Certificados:** o kit não depende de uma autoridade só e reaproveita os certificados numa reinstalação, para não bater no limite de emissões.
- **Os nomes da infra.** O projeto do compose, os 13 contêineres, os volumes, a rede, as pastas do servidor, o serviço de backup, quatro tarefas agendadas no banco e os segredos do cofre levam `bunker707` no nome. O aluno nunca vê; o comprador vê na lista de contêineres. Trocar depois muda os volumes e a rede em cada Instalação. Decide-se antes do primeiro fundador (A10): ou ficam como identificador técnico, ou o kit nasce com nome neutro e a nossa produção é migrada uma vez. As tarefas agendadas no banco ficam como estão nos dois casos: as migrações que as criam são fixadas pelas guardas.
- **Testes:** a infra de mentira de `tests/fixtures` imita a Hetzner, a Cloudflare e o SSH do `infra/cloud`; o instalador pede um dublê novo. No runner do CI roda a instalação em modo local, com a conferência; o ensaio em provedor de verdade é manual, com o ok do produtor. Guardas que mudam: os quatro testes que conferem a lista de tarefas, a variável do gravador no compose e os textos da marca.

### 11.8 Guardas de módulo

Fonte única: `isFeatureEnabled`, com a chave do módulo. Os Webinários são o primeiro, com `isFeatureEnabled("webinars")`, e os pontos abaixo foram conferidos no código. Todo módulo novo repete a lista com a chave dele:

- as 8 páginas (3 do aluno e 5 do admin);
- as 24 rotas: das 21 do aluno, 15 passam por `guardRoomRequest` (`src/server/webinars/room-route.ts`), 5 chamam a sessão direto e a do calendário não tem sessão; mais as 3 do admin;
- os 3 webhooks do gravador e da sala;
- as 63 ações, todas por `runAdminAction` (`src/server/actions/run-action.ts`), que ganha uma opção de módulo;
- as 5 tarefas: a lista de `src/server/jobs/registry.ts` é uma constante montada sem leitura do banco e quatro testes conferem o texto dela; cada tarefa ganha um campo de módulo e é o agendador (`run-tick.ts`) que a pula;
- o menu do aluno (`src/lib/member-navigation.ts`), a faixa "Ao vivo agora" (`src/components/app-shell.tsx`), a fileira da página inicial (`src/app/page.tsx`) e o bloco **Privacidade › Chat das lives** do Perfil; passar os módulos ligados à moldura da área toca as 13 páginas que a montam, e dois testes fixam a lista do menu;
- o menu, a busca e o Hoje do admin, a aba da Comunicação, o atalho **Avisar** e as notificações antigas de live no sino;
- a regra **Participação em lives:** some do construtor de segmentos e é recusada nas ações de salvar. Com as tabelas vazias, a forma negada da regra ("não participou") combinaria com todos os alunos.

O que não some: a tarefa de limpeza agendada no banco, que roda sobre tabelas vazias, e o tipo de produto "Webinário" do catálogo, que é do núcleo e anterior ao módulo.

A ordem importa: o menu e a faixa somem junto com o bloqueio das rotas, para o navegador do aluno não bater num erro a cada minuto. Testes: uma guarda de arquitetura e um teste de comportamento com a licença sem o módulo; os testes de ponta a ponta ganham a variação "sem o módulo". Uma guarda nova não deixa página, rota, ação ou tarefa de módulo sem a guarda.

### 11.9 Marca branca no código

A chave `school` em `platform_settings`; o título pelo modelo da moldura raiz, como o admin já faz; os e-mails da área (`src/server/email/templates` e `config.ts`, com o remetente obrigatório, sem padrão nosso) e os do login (`infra/compose/volumes/auth-templates` e os assuntos do compose, gerados pelo instalador); a cor por variável; as imagens neutras; o Modo TV lendo a Marca; as páginas de Termos e Privacidade; e a guarda `tests/marca-branca.guard.test.mjs`. Os identificadores técnicos (`bunker707:*` no navegador, o rótulo do guarda da sala, os cabeçalhos `X-Bunker-*`, as tarefas agendadas no banco) ficam: são contratos com o motor de vídeo, com o gravador, com o navegador e com as migrações, invisíveis ao aluno. Os nomes da infra são decisão à parte (§11.7).

### 11.10 Da venda à Licença

- **No lote fundador não há ponte.** A Licença do fundador sai pela ação **Emitir**, com a origem "fundador" e o titular e o aceite do contrato registrados. A ponte e Minhas licenças entram na fase 2, e com isso o compliance das plataformas sai do caminho da fase 1.
- **A aula continua sendo liberada pelo caminho de hoje:** o produto da aula ligado ao código da plataforma. Hoje cada produto do nosso catálogo aceita um código por plataforma, e isso basta.
- **O mapa "código do produto na plataforma, produto de Licença" fica no Emissor,** não no banco do produto: nada de vendedor entra no banco do comprador. A Licença anual, o Ano adicional, a vitalícia e cada módulo têm cada um o seu código na plataforma.
- `src/server/payments/process-sale.ts` ganha um passo que roda **antes** das saídas antecipadas da regra de acesso e entrega o aviso normalizado a uma **fila de pedidos ao Emissor** (emitir e revogar), reenviada pela tarefa de minuto. Com o Emissor fora do ar, nem a emissão nem a revogação se perdem, e a plataforma recebe resposta de sucesso. A Hotmart reenvia até cinco vezes e desliga a configuração de quem responde com erro, então a resposta é decidida de propósito.
- **A Licença fica presa à transação,** não ao vínculo `sale_grants`, que é sempre o par venda e acesso. O reembolso daquela transação revoga aquela Licença, sem a decisão por histórico que vale para os acessos dos alunos.
- Os adaptadores tratam hoje cinco avisos por plataforma (compra aprovada, fim da garantia ou retomada, reembolso, chargeback e cancelamento de assinatura). Como a Licença, o Ano adicional e os módulos são pagamento único, esses avisos bastam. A renovação automática por assinatura pediria tratar também a renovação, o atraso e a troca de plano (§13.3). O Kiwify continua sem adaptador.
- **A compra cai na conta do comprador e é aplicada a uma Licença.** O Ano adicional e o módulo chegam ligados ao comprador pelo e-mail da compra, como toda venda. Quem tem uma Licença só recebe na hora. Quem tem mais de uma escolhe em Minhas licenças qual Licença recebe. Quem ainda não tem Licença fica com a compra parada: ela é aplicada sozinha quando a primeira Licença dele for emitida (o aviso do módulo pode chegar antes do aviso da Licença), ele é avisado por e-mail e a equipe vê o caso nos Alertas do Painel. O botão **Renovar** e o **Comprar** da loja podem levar a Licença escolhida no link do checkout, para poupar a escolha. Hoje isso não funciona: os dois adaptadores não leem os campos de origem do checkout e os descartam ao guardar o aviso. Fica como melhoria a conferir, não como dependência.
- **Minhas licenças** e **Módulos** seguem o molde de `src/app/minhas-compras`. O Painel de licenças é do Emissor (§11.2).

### 11.11 Testes

Pelo `docs/18`: toda PR com teste de comportamento.

- **Verificador:** um teste por transição do §2.2 (em dia, anual perto de vencer, vencida na carência, no 16º dia e 30 dias depois, Ano adicional chegando dentro e fora da carência, a compra na garantia com prazo curto, vitalícia, sem contato no 8º dia, no vencimento da licença guardada e 30 dias depois, a licença curta da garantia, endereço trocado, pagamento desfeito nos dias 0, 7 e 30, Licença suspensa, sem licença, relógio atrasado e adiantado, assinatura inválida, regularizada).
- **Integração, contra o banco local:** ação de conteúdo recusada no Admin limitado; conta nova recusada e conta existente atendida na Escola congelada; venda guardada liberada em lote.
- **Emissor:** a venda aprovada emite uma Licença só, mesmo com aviso repetido; uma transação com dois produtos emite dois; o reembolso revoga; o Ano adicional soma 12 meses uma vez só e o reembolso dele devolve a validade; a compra de módulo sem Licença fica parada e não liga nada; a ativação além da vaga é recusada; ativar de novo no mesmo endereço não gasta vaga; desativar libera a vaga; a readoção depois de uma restauração; e nenhuma ação do Painel passa sem o segundo fator.
- **Imagem e pacote:** as guardas do §11.5 e do §11.6, e o job que sobe a imagem com a exigência de licença.
- **Instalador:** o dublê novo, a instalação em modo local no runner e o ensaio manual em provedor.
- **Ponta a ponta:** as telas de licença, a loja de Módulos e as variações "sem o módulo" e "Admin limitado".
- **Guardas:** nenhuma variável de licença com `NEXT_PUBLIC_`; a situação lida só pelo módulo único; nenhuma ação sem classe; nenhuma página do aluno barrada pela situação da licença.

## 12. Fases e PRs

Duas regras de ordem. A primeira vem do desenho de lançar rápido: **só entra antes da primeira Instalação fora de casa o que não dá para acrescentar depois sem quebrar promessa** (o Verificador, a guarda de módulo, a marca mínima e o contrato). Colocar verificação de licença em quem já instalou sem ela foi o erro que o ACF reconheceu em 2023. A segunda vem do ataque do engenheiro: **decide-se antes do primeiro fundador o que fica gravado no servidor e nos dados dele** (o endereço único, os caminhos dos arquivos, os nomes da infra e os serviços do kit), porque trocar depois é migração em cada Instalação.

As semanas contam só a engenharia. O que depende de fora (advogado, contador, plataformas, fundadores) fica numa coluna à parte, porque é isso que costuma atrasar: pelo histórico deste repositório, escrever código não é o gargalo.

| Fase | Engenharia | Pronta quando (engenharia) | Depende de fora | Semanas |
|---|---|---|---|---|
| **0. Decisões e preparo** | o teste do endereço único e da chave publicável fixa; a decisão dos nomes da infra e dos serviços do kit; as chaves geradas, com a raiz fora de servidor; a nossa produção religada; Termos, Privacidade e identificação de quem vende na nossa área | os testes respondidos e escritos aqui; a produção no ar | as decisões do §13.2; o advogado e o contrato; o contador; a cadeia de direitos e o pedido no INPI; o nome e a marca; a conferência da referência visual; a consulta ao compliance das plataformas; o depositário | 2 a 3, junto com a fase 1 |
| **1. Lote fundador** | a marca branca mínima, com Termos e Privacidade (§6); os arquivos guardados pelo caminho; o Verificador em modo de observação, com a validade da Licença anual e a carência, os degraus, as classes de ação e os avisos por e-mail (§11.3); o Emissor, com o Painel de licenças mínimo (login com segundo fator, Clientes, Licenças, Instalações, **Emitir**, **Estender**, **Suspender**, **Revogar** e Auditoria) e a operação dele (deploy, backup, DNS); a tela Licença do comprador; a guarda de módulo (§11.8); o kit inicial: o pacote, o migrador, a rotina de versão e assinatura, o instalador rodado por nós, os ajustes do preparo do servidor, o diagnóstico, o e-mail como passo da instalação, o backup com destino genérico, o kit de recuperação e o ensaio de restauração (§4); a imagem por Instalação, sem as nossas chaves de análise; a nossa produção passada para o kit | as situações do §2.2 reproduzidas em teste; a nossa escola roda pelo kit, como Instalação número 1, com Licença emitida por nós; uma instalação de ensaio do zero em dois provedores, com o diagnóstico e um ensaio de restauração feito com o kit de recuperação | **o contrato pronto e aceito** e o anexo de tratamento de dados; de 2 a 3 fundadores, depois até 10 | 8 a 10 |
| **2. Instalação pelo comprador, com a IA** | uma imagem para todos (§11.5); a venda que vira Licença, Ano adicional ou vitalícia, com a fila e o mapa no Emissor, e Minhas licenças com o titular, o aceite, o botão **Renovar** e a compra aplicada à Licença (§11.10); o assistente de domínio em **Nova instalação** (§3.1); os Vencimentos no Painel; o pacote baixado com a credencial da Instalação; o instalador de um comando, com os dois modos e a conferência de fora (§11.7); os códigos de erro; o kit da IA no computador do comprador (§3.3); a saúde do servidor; voltar versão e a página "Voltamos já"; a troca de endereço por comando; a cor e o ícone; os fundadores passados para a imagem única | a mesma imagem sobe duas escolas; instalação do zero em três provedores (Hetzner, Contabo e Hostinger VPS), com o plano mínimo de cada um anotado; uma instalação feita pelo Claude Code e outra pelo Codex seguindo só o kit; atualização, volta de versão e restauração ensaiadas; a carga medida de novo | o produto aprovado na plataforma e uma compra de teste de verdade; a aula gravada | 6 a 8 |
| **3. Módulos à venda** | a loja de **Módulos**, o catálogo no Emissor e os Módulos no Painel (§5.1); o kit do servidor de vídeo neutro de provedor, com a porta fechada, o serviço de retransmissão e o pareamento por código; o **Testar sala**; o gravador atrás de adaptador (§5.4); a marca nos textos de live | uma compra de módulo liga sozinha numa Instalação e o reembolso desliga; uma live ao vivo num servidor de vídeo instalado pelo kit fora da Hetzner, com um aluno em rede fechada | o produto do módulo aprovado na plataforma | 4 a 5 |
| **4. Venda aberta** | o Emissor em servidor próprio; a página de situação; os Alertas do Painel com e-mail; outro provedor de e-mail além do Resend; a escola de demonstração; as correções que o lote fundador trouxer | o fim do modo de observação; a primeira atualização entregue a todos os fundadores | a página de venda (§8.5) e a política de garantia e reembolso publicadas | 3 a 4 |

Total de engenharia: de 21 a 27 semanas em série; de 17 a 22 com a fase 3 correndo junto da 2. O lote fundador entra por volta da 9ª à 11ª semana, se o contrato estiver pronto. As respostas do produtor de 10/11/2026 somaram cerca de uma semana à fase 1 (o Painel tem login próprio) e uma à fase 3 (a loja), e tiraram da fase 2 a assinatura das atualizações e a Instalação de teste; são estimativas, não medidas. Os três desenhos independentes estimaram 13, 20 e 27 semanas (20 com duas frentes ao mesmo tempo); os ataques do comprador honesto e do engenheiro acrescentaram trabalho de recuperação, de e-mail, de avisos e de preparo do servidor que nenhum dos três tinha contado. Cada fase vira de 5 a 10 PRs para a `dev`, com teste de comportamento, no fluxo do `CONTRIBUTING.md`.

Uma saída para encurtar a fase 1, se for preciso: restringir os primeiros fundadores à Hetzner, com conta e armazenamento de backup deles. Os ajustes do preparo do servidor e o destino genérico de backup passam para a fase 2 (A14).

## 13. Decisões

### 13.1 Decididas e propostas

| # | Decisão | Por quê | O que muda se mudar |
|---|---|---|---|
| D1 | A unidade da Licença é a Instalação: uma área de membros, num endereço, com o banco dela | é o "site" dos plugins e a "instalação num domínio" do Kirby; não exige contar alunos nem mandar dados deles | licença por aluno ativo pede dados de alunos e acerto de contas periódico |
| D2 | **Decisão do produtor (10/11/2026):** Licença anual, com Anos adicionais comprados à parte, ou Licença vitalícia; os preços são dele (§8.2) | mais firme contra o uso sem pagar do que a perpétua com 12 meses de atualizações, que era a proposta anterior; a vitalícia atende quem não quer renovar | a perpétua não limitava quem só deixava de renovar; a assinatura com cobrança automática pede tratar renovação, atraso e troca de plano |
| D3 | O comprador recebe o produto compilado, nunca o código-fonte (A7) | o comprador típico não programa; sem o código não dá para reaproveitar nem manter versão paralela com conforto | entregar o código facilita a cópia e o suporte a versões alteradas |
| D4 | Emissor próprio e mínimo, em `services/bunker-licensing`, com banco próprio; servidor próprio na venda aberta | §11.2 | como módulo da área: mais rápido, mas a chave e as Licenças ficam junto do site público; Keygen: mais um sistema, ou dependência de fora |
| D5 | Licença assinada com Ed25519, conferida no servidor do comprador; raiz fora de servidor e chave de emissão trocável; vale dias na garantia, 30 dias nos seis primeiros meses e 90 depois, e nunca além do período pago mais a carência | padrão de Coder, Mattermost e Keygen; funciona com o Emissor fora do ar; cobre a chave perdida e a copiada; quem está em dia aguenta três meses de silêncio nosso | prazo único de 30 dias: mais simples, e congela quem pagou se ficarmos um mês fora |
| D6 | Conferência uma vez por dia, pela tarefa de minuto; nunca no caminho de um pedido | Metabase, Grafana, Directus e n8n renovam em segundo plano | conferir a cada pedido derrubaria as escolas junto com o Emissor |
| D7 | Três degraus (Aviso, Admin limitado, Escola congelada), todos avisados por e-mail, valendo também para a Licença anual vencida depois de 15 dias de carência; o congelamento barra contas novas e quem já é aluno nunca perde o acesso (A3 e A4) | regra a que os três desenhos chegaram; uma falha nossa nunca tira do ar a escola de quem está em dia | tirar a área do ar aumenta o risco jurídico e o de derrubar quem pagou |
| D8 | O Verificador confere o endereço da licença contra o endereço da Instalação | a cópia do servidor em outro domínio é pega sem depender do Emissor | sem isso, a cópia que não fala com o Emissor passa |
| D9 | O produto vendido sempre exige licença, gravado no código gerado; nenhuma variável afrouxa; a imagem com a exigência é testada no CI e na nossa Instalação de homologação | o comprador é dono do servidor e do arquivo de configuração | um modo sem licença por variável desligaria tudo em minutos |
| D10 | Entrega: pela equipe no lote fundador; depois, pacote baixado com a credencial da Instalação e manifesto assinado; registry mais tarde | simples, sem serviço de registry para operar | registry próprio: downloads menores, mais um serviço 24 horas |
| D11 | Uma imagem para todos na fase 2; imagem por Instalação só no lote fundador | gerar por Instalação não escala e põe a equipe em toda atualização | §11.5 |
| D12 | Migrações no pacote, aplicadas por migrador próprio; a versão anterior do produto funciona no banco novo, provado no CI; o banco nunca volta de versão; voltar a imagem é um comando | tira a CLI do Supabase do servidor do comprador; o comprador não sabe voltar versão à mão | sem a regra, voltar a imagem pode deixar o banco à frente do produto |
| D13 | Instalador de um comando, com modo guiado e modo com arquivo de respostas, que continua de onde parou; mais o comando de operação | padrão de Coolify, Dokploy, Sentry e Ghost | |
| D14 | Um endereço só para a área e a API, se o teste passar antes do primeiro fundador; o painel do banco fora do kit | um registro de DNS em vez de dois; quem tem o painel do banco passa pelo Admin limitado | dois registros (área e API) |
| D15 | Kit da IA no computador do comprador: `AGENTS.md`, `CLAUDE.md` que o importa e skill; no servidor, diagnóstico em JSON, códigos de erro e conta de operador; a IA nunca recebe a Chave nem o link do dono | a IA roda fora do servidor; o que não pode falhar vira trava, não texto | instruções só dentro do servidor não chegam à IA |
| D16 | Todo módulo vai na mesma imagem, desligado, e a Licença liga, por Licença; as migrações dele são sempre aplicadas. Os Webinários são o primeiro | o mais barato de construir e o mais simples para o comprador, que não instala nada; é o desenho das edições Enterprise | segunda edição da imagem: protege mais o módulo e custa uma reforma no núcleo (§5.1) |
| D17 | Gravador atrás de adaptador, com **nenhum** por padrão; sem gravação automática na primeira versão | o de hoje depende do nosso GitHub e da nossa Hetzner | |
| D18 | Marca branca por configuração, com guarda de teste; Termos e Privacidade já no lote fundador | o comprador não toca no código e vai ao ar tratando dados de alunos | |
| D19 | A conferência envia só a Licença, a Instalação, o endereço e as versões; a imagem do comprador não leva as nossas chaves de análise | LGPD e Marco Civil; o comprador é o controlador dos dados dos alunos | |
| D20 | No lote fundador, a Licença sai pela ação **Emitir** do Painel. Na fase 2, a venda vira Licença por uma fila de pedidos ao Emissor, que guarda o mapa dos códigos de produto; uma Licença por compra, e as compras somam; o Ano adicional e o módulo caem na conta do comprador e são aplicados a uma Licença; as páginas de vendedor ligadas por módulo da nossa licença | tira o compliance do caminho do lote fundador; nada de vendedor entra no banco do comprador; nem emissão nem revogação se perdem com o Emissor fora do ar | quantidade ou oferta no checkout pede mudar os adaptadores e o que é guardado |
| D21 | A nossa escola é a Instalação número 1: o mesmo produto, o mesmo kit, Licença emitida por nós; os compradores recebem a versão dias depois | toda versão passa por nós em produção antes de chegar ao comprador | |
| D22 | Sem atualização automática na primeira versão; o comprador roda **atualizar** | backup antes, migração e volta atrás são do nosso comando | |
| D23 | Verificador em modo de observação nos primeiros 60 dias do lote fundador | alarme falso não pode limitar quem pagou | |
| D24 | Licença e contrato aceito antes de qualquer Instalação fora de casa | não dá para acrescentar verificação nem contrato depois sem quebrar promessa | fundadores sem Verificador são o produto inteiro entregue sem controle |
| D25 | Kit de recuperação obrigatório e ensaio de restauração em modo isolado | hoje a senha do backup só existe no servidor que pode morrer | sem ele, o primeiro desastre de um comprador é perda total |
| D26 | E-mail como passo da instalação; sem entrega, a instalação não fica verde | sem e-mail não há convite nem recuperação de senha | uma área "no ar" que não deixa ninguém entrar |
| D27 | Continuidade: licença por arquivo, extensão assinada e cláusula de licença definitiva para toda Licença em dia, com depositário da chave (A23) | uma Licença vitalícia não pode depender de nós para sempre, e quem pagou um ano não pode perder o que pagou | sem isso, "vitalícia" vale só enquanto o nosso serviço existir |
| D28 | Somos operadores dos dados dos alunos sempre que tocamos no servidor do comprador: anexo de tratamento de dados desde o lote fundador | instalação, atualização, suporte com acesso e migração são tratamento em nome do comprador | |
| D29 | Descumprimento do contrato não segue a escada automática: notificação com prova, prazo para corrigir e, no máximo, Admin limitado sem parecer ou ordem judicial | a revogação por ato só nosso é a que mais expõe juridicamente | |
| D30 | O kit leva só os serviços do Supabase que o produto usa; Realtime, Supavisor e Edge Runtime ficam fora (A29) | metade do download e 423 MiB de memória em repouso sem uso | mantê-los custa memória no servidor de 4 GB e três imagens a mais para atualizar |
| D31 | Antes do primeiro fundador, fica decidido o que é gravado no servidor e nos dados dele: o endereço único, os arquivos pelo caminho e os nomes da infra | trocar depois é migração em cada Instalação | |
| D32 | Painel de licenças próprio, servido pelo Emissor num subdomínio de `bunker707.com.br`, com login próprio e segundo fator; emitir, estender e revogar à mão só existem ali. É a resposta à pergunta do produtor de 10/11/2026; falta ele confirmar | separa os clientes do produto dos alunos da escola; quem invadir a escola não emite Licença; a escola continua igual ao produto que o comprador recebe | uma tela no admin da escola: cerca de uma semana a menos, com o poder de emitir dentro de um site público sem segundo fator |
| D33 | **Decisão do produtor (10/11/2026):** os módulos são vendidos à parte, numa loja de **Módulos** dentro da nossa área de membros, e só compra quem tem a Licença da área. O módulo comprado liga sozinho pela Licença | o comprador não instala nada; pôr um módulo novo à venda é um registro no catálogo, sem versão nova do Emissor | módulo entregue como arquivo à parte pede uma arquitetura de extensões que o produto não tem |
| D34 | **Decisão do produtor (10/11/2026):** uma Licença vale para uma área de membros, num endereço, sem Instalação de teste e sem segunda área, nem para o próprio comprador | fecha o segundo ambiente como brecha; o ensaio de restauração roda isolado no mesmo servidor | com a Instalação de teste, quem quisesse experimentar uma versão antes teria onde; pode voltar como opção à parte (A6) |
| D35 | O domínio do comprador entra por um assistente em **Nova instalação**: um registro de DNS para criar, **Copiar**, **Conferir endereço**, e o HTTPS emitido e renovado pelo instalador. É a resposta ao pedido do produtor de configuração simples | o DNS é o passo em que quem não é técnico mais trava; o certificado já é automático no nosso Caddy | sem o assistente, o comprador descobre o erro de DNS no meio da instalação |

### 13.2 Abertas para o produtor, com o padrão assumido

| # | Pergunta | Padrão assumido até a resposta |
|---|---|---|
| A1 | Licença perpétua com 12 meses de atualizações, ou assinatura anual? | **respondida em 10/11/2026:** Licença anual com Anos adicionais, ou vitalícia (D2) |
| A2 | Vender só a Licença de 1 Instalação, ou também pacotes de 3 e de 10? | só a de 1; as compras somam, com cupom de 5 % a 15 % para as seguintes do mesmo titular. Os pacotes entram com o plano de agência |
| A3 | O congelamento é o teto, ou existe um degrau mais duro (a área fora do ar) para a Licença revogada ou vencida há muito tempo? | o congelamento é o teto na primeira versão. Na Licença anual, o fim do prazo é conhecido desde a compra, o que torna o degrau mais duro mais fácil de defender; mesmo assim, só com parecer do advogado |
| A4 | Os prazos | **silêncio:** aviso no 8º dia; Admin limitado quando a licença guardada vence (30 dias nos seis primeiros meses, 90 depois); Escola congelada 30 dias depois. **Licença anual:** o ano começa na ativação ou 30 dias depois da compra, o que vier primeiro; e-mails 60, 30 e 7 dias antes do fim; 15 dias de carência; Admin limitado no 16º dia; Escola congelada 30 dias depois |
| A5 | Trocas de endereço por ano, sem falar com o suporte | 2 por Instalação, mesmo com a Licença vencida |
| A6 | Instalação de teste | **respondida em 10/11/2026:** nenhuma (D34). Se um dia fizer falta, volta como opção à parte |
| A7 | O código-fonte nunca é entregue, ou existe um plano mais caro que entrega? | nunca, na primeira versão |
| A8 | A gravação das lives por hora vira um serviço nosso, por consumo? | não na primeira versão; o comprador grava no navegador ou envia a gravação |
| A9 | O nome do produto aparece na área do comprador? | não para o aluno; no admin aparece "Licenciado para" com o nome do titular |
| A10 | Nome e marca do produto; e os nomes da infra no servidor do comprador, que hoje levam `bunker707` | o produtor já indicou que a compra, a loja de Módulos e o Painel ficam na Bunker707, em `bunker707.com.br`. Continua em aberto o nome que o comprador vê no instalador, no contrato e nos e-mails do produto: a marca Bunker707, ou uma marca nova, com registro no INPI. Até a resposta, o kit nasce com nomes neutros na infra e a nossa produção é migrada uma vez |
| A11 | Ano adicional comprado depois do vencimento: conta de quando? Correção de segurança para a Licença vencida, por quanto tempo? | até o fim da carência, soma na data de fim; depois, conta do dia da compra. Correções críticas por 6 meses depois do vencimento, liberando a versão mais nova nesses casos |
| A12 | Agência pode instalar para os clientes dela? | não na primeira versão; proibido no contrato |
| A13 | O comprador pode usar o Supabase da nuvem no lugar do banco no próprio servidor? | não na primeira versão |
| A14 | Lote fundador: quantos, quem e em que condições | até 10, com instalação e atualizações feitas por nós, contrato aceito, Licença emitida por nós e preço de fundador; em qualquer provedor ensaiado (restringir à Hetzner encurta a fase 1) |
| A15 | Suporte: canal e prazos | pela nossa área de membros; dois prazos (escola fora do ar e o resto); a definir |
| A16 | Advogado: quem redige o contrato e revisa as situações do §2.2, o arrependimento, a cadeia de direitos e a referência visual | contratar na fase 0; nenhuma Instalação fora de casa sem o contrato |
| A17 | E-mail do comprador | Resend na fase 1; outros provedores na fase 4 |
| A18 | Onde ficam os pacotes e quanto pode custar por mês | o Bunny Storage, que já usamos; poucos reais por mês |
| A19 | Quando a nossa produção volta a ficar ligada 24 horas, e se o Emissor ganha servidor só dele | produção ligada antes do primeiro fundador; Emissor em servidor próprio na venda aberta (de EUR 6 a 20 por mês, conforme o estoque) |
| A20 | A Instalação manda também dados de saúde (tarefas rodando, idade do backup, disco) para nós? | não; o vigia local avisa o dono |
| A21 | Plataforma de venda | começar pela que aprovar no compliance primeiro |
| A22 | Tamanho de servidor prometido na página de venda | o plano mínimo por provedor que sair do ensaio, com 2 vCPU e 4 GB como piso e a carga medida de novo |
| A23 | Quem é o depositário da chave que garante a licença definitiva | o escritório do advogado, com a regra escrita no contrato |
| A24 | Fiscal e nota: quem vende, o imposto e a nota automática | definir com o contador na fase 0 |
| A25 | Garantia e reembolso do produto e do serviço de instalação | 7 dias para a Licença; para o serviço, devolução se não entregarmos; página própria antes da venda aberta |
| A26 | Escola de demonstração e conferência sem Licença antes da compra | as duas, na venda aberta |
| A27 | Botão **Atualizar** no admin | depois da primeira versão; até lá, terminal ou IA, dito na página de venda |
| A28 | Monitor nosso do endereço público de cada escola | opcional, na venda aberta |
| A29 | O kit leva só os serviços do Supabase que o produto usa? | sim; a nossa produção passa a rodar igual, e a memória é medida de novo |
| A30 | Os preços: Licença anual, Ano adicional, vitalícia, troca para vitalícia e cada módulo | do produtor. O desenho só pede que cada um seja um produto próprio na plataforma, de pagamento único |
| A31 | O que a vitalícia inclui | usar sem data de fim; versões novas, com as correções, enquanto o produto existir; atendimento do suporte incluído por 12 meses e, depois, por hora avulsa; a venda da vitalícia pode ser encerrada a qualquer momento, sem mexer nas já vendidas |
| A32 | Quem tem a anual pode passar para a vitalícia? | sim, por um produto próprio, oferecido em Minhas licenças, com preço do produtor; transforma a Licença escolhida e não devolve os meses que faltavam |
| A33 | O módulo é pagamento único ou anual? | pagamento único por Licença, valendo enquanto a Licença valer; o Ano adicional tem um preço só, com ou sem módulos |
| A34 | Domínio ainda mais simples | na primeira versão, o assistente do §3.1. A avaliar depois: o instalador criar os registros sozinho para quem usa a Cloudflare, e um endereço provisório nosso para a escola subir antes do DNS |

### 13.3 O que fica de fora da primeira versão

Registry próprio; servidores com processador ARM; várias escolas numa mesma Instalação; o plano de agência e os pacotes de 3 e de 10; a gravação hospedada por nós e a gravação automática da Live ao vivo; o gateway de IA para login por conta (o Tutor IA funciona com a chave de API do comprador); o Mautic; a atualização automática e o botão Atualizar; a ofuscação do código; a segunda edição da imagem para os módulos; o degrau "área fora do ar"; vendas fora da Hotmart e da Ticto; a renovação automática da Licença anual por assinatura; a Instalação de teste; mover um módulo de uma Licença para outra sem o suporte; módulos feitos por terceiros; os catálogos de aplicativos dos provedores (a DigitalOcean aceita software comercial de terceiros).

## 14. Riscos

- **Suporte de servidor para leigos.** O comprador típico nunca administrou um servidor. O instalador, o diagnóstico, a saúde do servidor e a IA reduzem, mas não zeram. O lote fundador serve para medir isso antes da venda aberta.
- **O primeiro desastre de um comprador.** Servidor perdido, disco cheio, backup que não abre. O que segura: o kit de recuperação, o ensaio de restauração e o vigia local (§4). Sem eles, a primeira perda de dados vira a história do produto.
- **Alarme falso do Verificador.** Limitar quem pagou é o pior erro deste desenho. O que segura: o modo de observação, os prazos longos, os avisos por e-mail, o **Verificar agora** e a extensão assinada.
- **O custo do congelamento para terceiros.** Quem paga um curso numa escola congelada espera pelo acesso. O que reduz: o pedido de pausar as ofertas desde o Aviso, o e-mail a cada venda guardada e a liberação automática.
- **A escola limitada por esquecimento.** Com a Licença anual, quem esquece de renovar tem a escola limitada com alunos pagantes dentro, e a reclamação vem para nós. O que segura: os e-mails 60, 30 e 7 dias antes, para dois endereços, a carência de 15 dias, a volta na hora ao renovar e a regra de que o aluno que já está dentro não perde o acesso.
- **A promessa da vitalícia.** Custa versões e atendimento para sempre, com uma receita só. O que segura: dizer por escrito o que ela inclui (A31), o preço, e o direito de parar de vendê-la.
- **O Painel de licenças como alvo.** Quem entrar nele emite Licenças. O que segura: login próprio com segundo fator, poucas contas, auditoria de toda ação, e-mail ao dono a cada emissão por cortesia e a chave raiz fora de qualquer servidor.
- **Uma versão que quebra no servidor do comprador.** Cada servidor é um ambiente diferente. O que segura: backup antes de atualizar, voltar versão testado, a regra das migrações, a nossa escola primeiro (D21) e os fundadores antes da venda aberta.
- **O Emissor fora do ar, a chave perdida ou copiada, ou o fim do produto.** A tolerância de 30 a 90 dias, a extensão assinada e a licença por arquivo cobrem a queda; a raiz fora de servidor e a chave de emissão trocável cobrem a perda e a cópia; a cláusula de continuidade cobre o fim.
- **A nossa área como ponto único.** Minhas licenças, a aula e os pacotes dependem dela. Por isso a recuperação fala direto com o Emissor (§10).
- **Falha de segurança no produto.** Passa a valer para todas as escolas que o rodam. Pede um canal para receber avisos, correção rápida e a regra da A11.
- **A verificação arrancada e publicada.** Aceito (§7). O que resta é o contrato, a lei e o trabalho refeito a cada versão.
- **Compliance da Hotmart e da Ticto.** Um "não" para software com licença muda o canal de venda, não o produto. A consulta é da fase 0.
- **Jurídico.** O texto das situações, o limite de responsabilidade, o arrependimento com a instalação feita, a autoria com assistência de IA e a referência visual dependem do advogado (A16). Somos operadores de dados desde o lote fundador (D28).
- **Duas frentes com a mesma equipe.** A escola ainda não lançou e o produto pede de 21 a 27 semanas de engenharia. A marca branca, o instalador, a recuperação e a atualização também servem à nossa própria produção; o Emissor e as telas de licença são só do produto.
- **O banco no servidor do comprador.** Troca de versão maior do Postgres é operação que o comprador não sabe fazer. Fica como serviço.
- **Estoque e preço de servidor.** A linha barata da Hetzner aparece sem estoque com frequência; o custo do nosso lado pode triplicar de um mês para o outro (§10).

## 15. Fontes

Lidas em 04/11/2026 e conferidas em 10/11/2026. Os resumos de cada frente, as notas de conferência, os três desenhos e o ataque ficaram no scratchpad da sessão que escreveu esta página.

- **Licenças em produtos instalados no servidor do cliente.** Coder: licença em arquivo assinado com Ed25519, conferida sem internet, com a lista de instalações aplicada (https://coder.com/docs/admin/licensing e https://github.com/coder/coder/blob/main/enterprise/coderd/licenses.go). Mattermost: licença assinada, carência de 10 dias no código, volta ao plano gratuito ao vencer, chave separada para ambiente que não é produção (https://github.com/mattermost/mattermost/blob/master/server/public/model/license.go e https://docs.mattermost.com/product-overview/self-hosted-subscriptions.html). GitLab: código de ativação ou arquivo, instância somente leitura ao vencer (https://docs.gitlab.com/administration/license_file/). Metabase: conferência a cada 12 horas, com 36 horas de tolerância, e volta à edição aberta sem o token (https://github.com/metabase/metabase/blob/master/src/metabase/premium_features/token_check.clj). n8n: chave de ativação de uso único por instância e renovação obrigatória a cada 10 dias (https://docs.n8n.io/hosting/configuration/environment-variables/licenses/). Directus: licença amarrada ao projeto e ao endereço público, conferida ao menos a cada 12 horas, estado bloqueado quando a licença cai com uso acima do plano básico, "a aplicação nunca apaga dados" (https://directus.com/docs/licensing/overview). Grafana: licença ligada ao endereço e renovada a cada 24 horas (https://grafana.com/docs/grafana/next/administration/enterprise-licensing/). Replicated: instância com licença vencida continua rodando, sem baixar imagens nem atualizar (https://docs.replicated.com/vendor/licenses-about). JetBrains: 30 dias sem internet e a licença perpétua de reserva (https://sales.jetbrains.com/hc/en-gb/articles/206544169 e https://sales.jetbrains.com/hc/en-gb/articles/207240845). Unraid: licença perpétua com um ano de atualizações e troca automática de dispositivo uma vez a cada 12 meses (https://docs.unraid.net/unraid-os/troubleshooting/licensing-faq/). Prazos de aviso e de carência citados no §2.2: no Mattermost, aviso 60 dias antes e 10 dias de carência (os mesmos arquivos acima); no GitLab, aviso 30 dias antes e 14 dias de carência no código (https://gitlab.com/gitlab-org/gitlab/-/raw/master/ee/app/models/license.rb).
- **Ferramentas de licença.** Keygen: licença Fair Core, requisitos para rodar em casa, políticas, arquivos de licença assinados com validade e preços da nuvem, com o plano grátis até 100 licenças ativas (https://raw.githubusercontent.com/keygen-sh/keygen-api/master/LICENSE.md, https://keygen.sh/docs/self-hosting/, https://keygen.sh/docs/api/policies/, https://keygen.sh/docs/api/cryptography/ e https://api.keygen.sh/v1/plans?limit=100). Cryptlex, LicenseSpring, 10Duke e Replicated: preços (https://cryptlex.com/pricing, https://licensespring.com/pricing, https://www.10duke.com/resources/faq/ e https://www.replicated.com/pricing). Assinatura Ed25519 nativa do Node (https://nodejs.org/api/crypto.html).
- **Hotmart e Ticto.** Formatos de produto e área de membros externa da Hotmart (https://suportehotmart.zendesk.com/hc/pt-br/articles/360016600591 e https://suportehotmart.zendesk.com/hc/pt-br/articles/215827858); webhook 2.0.0 (https://developers.hotmart.com/docs/en/2.0.0/webhook/purchase-webhook/); planos de assinatura, oferta adicional do checkout e política de uso (https://help.hotmart.com/pt-br/article/208424858, https://help.hotmart.com/pt-br/article/360019967392 e https://hotmart.com/pt-br/legal/politicas-de-uso). Ticto: webhook v2 e reembolso (https://webhook.ticto.dev/docs/v2, https://help.ticto.com.br/sou-produtor/tictools-integracoes/webhook e https://help.ticto.com.br/comprei-pela-ticto/reembolsos-e-suporte/solicitar-reembolso-prazo-e-regras-do-termo-geral-de-compra).
- **Entrega das versões.** GHCR: token pessoal clássico e acesso de leitura por conta (https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry); registry oficial com servidor de token (https://distribution.github.io/distribution/spec/auth/token/), o servidor de token `docker_auth` (https://github.com/cesanta/docker_auth) e o registry Zot (https://zotregistry.dev/v2.1.23/articles/authn-authz/); `docker save` e `docker load` (https://docs.docker.com/reference/cli/docker/image/save/); o marcador trocado na subida do contêiner, no Cal.com (https://raw.githubusercontent.com/calcom/cal.com/main/scripts/replace-placeholder.sh), e o que o Next diz sobre variáveis públicas (https://nextjs.org/docs/app/guides/self-hosting).
- **Instaladores de um comando.** Coolify (https://coolify.io/docs/get-started/installation e https://coolify.io/docs/get-started/upgrade), Dokploy (https://docs.dokploy.com/docs/core/installation), Supabase no próprio servidor (https://supabase.com/docs/guides/self-hosting/docker), Sentry (https://develop.sentry.dev/self-hosted/ e https://github.com/getsentry/self-hosted/blob/master/install.sh), Discourse (https://github.com/discourse/discourse/blob/main/docs/INSTALL-cloud.md) e Ghost (https://docs.ghost.org/ghost-cli/). O fork ativo do Watchtower (https://github.com/nicholas-fedor/watchtower/releases). Hospedagem compartilhada sem acesso de administrador (https://www.hostgator.com/help/article/hosting-comparison-chart) e os modelos de VPS da Hostinger (https://www.hostinger.com/support/vps/vps-os-and-templates/). Preços da Hetzner em 10/11/2026 (https://www.hetzner.com/cloud/cost-optimized/).
- **Instalação por IA.** `AGENTS.md` (https://agents.md/), como o Codex e o Claude Code o leem (https://learn.chatgpt.com/docs/agent-configuration/agents-md e https://code.claude.com/docs/en/memory), o formato de skills (https://agentskills.io/specification), as boas práticas do Claude Code para o que não pode falhar (https://code.claude.com/docs/en/best-practices) e a skill de instalação da Kodus (https://github.com/kodustech/kodus-installer).
- **Proteção do código e quem convive com cópias.** Ofuscação: "a saída ainda é JavaScript", de 15 % a 80 % mais lenta (https://github.com/javascript-obfuscator/javascript-obfuscator); bytecode não é cifra (https://github.com/bytenode/bytenode). Sidekiq: código entregue, credencial do servidor de pacotes ligada à assinatura (https://github.com/sidekiq/sidekiq/wiki/Commercial-FAQ). Laravel Nova: código entregue por repositório autenticado pela licença e conferência do endereço de produção (https://nova.laravel.com/docs/v5/installation). Plugins de WordPress quando a licença vence: WP Rocket (https://docs.wp-rocket.me/article/1711-what-happens-if-my-license-expires), Gravity Forms (https://docs.gravityforms.com/license-expiry/), ACF, que passou a exigir a licença em 2023 (https://www.advancedcustomfields.com/?p=444079), e Elementor (https://elementor.com/help/what-happens-to-my-site-if-i-cancel-elementor-pro/).
- **Modelo comercial.** Gravity Forms, ACF, WP Rocket e Elementor: preços por número de sites (https://www.gravityforms.com/pricing/, https://www.advancedcustomfields.com/pro/, https://wp-rocket.me/pricing/ e https://elementor.com/pricing/); Kirby e Yoast: quantidade com desconto por volume, de 5 % a 15 % no Kirby (https://getkirby.com/buy e https://yoast.com/wordpress/plugins/seo/); Craft: licença perpétua com um ano de atualizações e renovação perto de 20 % (https://craftcms.com/knowledge-base/how-craft-licenses-and-renewals-work); instalação por preço fixo: Discourse e Literate Computing (https://meta.discourse.org/t/what-does-one-time-install-include/21488 e https://www.literatecomputing.com/services/discourse-installation-services/); Odoo: pacotes de horas (https://www.odoo.com/pricing-packs); Mattermost Calls: gravação que exige servidor próprio do cliente (https://docs.mattermost.com/deployment-guide/calls/calls-deployment-guide). Vitalícia ao lado de planos com prazo: Unraid (https://unraid.net/blog/pricing-change e https://account.unraid.net/buy) e LifterLMS (https://lifterlms.com/pricing/); as vitalícias antigas do ACF (https://wptavern.com/acf-solicits-lifetime-license-holders-for-contributions-urging-them-to-purchase-annual-subscriptions).
- **Lei brasileira.** Lei 9.609/1998 e Lei 9.610/1998 (https://www2.camara.leg.br/legin/fed/lei/1998/lei-9609-19-fevereiro-1998-364738-publicacaooriginal-1-pl.html e https://www2.camara.leg.br/legin/fed/lei/1998/lei-9610-19-fevereiro-1998-365399-publicacaooriginal-1-pl.html); Código de Defesa do Consumidor e Decreto 7.962/2013 (https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-publicacaooriginal-1-pl.html e https://www2.camara.leg.br/legin/fed/decret/2013/decreto-7962-15-marco-2013-775557-publicacaooriginal-139266-pe.html); Marco Civil (https://www2.camara.leg.br/legin/fed/lei/2014/lei-12965-23-abril-2014-778630-publicacaooriginal-143980-pl.html); guia de agentes de tratamento da ANPD (https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/Segunda_Versao_do_Guia_de_Agentes_de_Tratamento_retificada.pdf); registro de programa no INPI (https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/guia-basico). Licenças abertas citadas: Elastic License 2.0 (https://www.elastic.co/licensing/elastic-license), Fair Core License (https://fcl.dev/) e PolyForm (https://polyformproject.org/licenses/internal-use/1.0.0).
- **Repositório.** `AGENTS.md`, `CONTRIBUTING.md`, `Dockerfile`, `.dockerignore`, `next.config.ts`, `infra/compose`, `infra/scripts`, `infra/cloud`, `infra/jitsi`, `services/bunker-ai-gateway`, `src/proxy.ts`, `src/lib/image-hosts.ts`, `src/server/actions/run-action.ts`, `src/server/payments`, `src/server/jobs`, `src/server/webinars`, `src/server/member-area`, `src/server/email`, `supabase/migrations`, `docs/05`, `docs/13`, `docs/18`, `docs/19`, `docs/20`, `docs/21`, `docs/30` e `docs/31`.

## 16. O que rodou e o que não rodou

A sessão de 10/11/2026 bateu no limite semanal de uso no meio do trabalho, e parte dos agentes parou antes do fim. Fica registrado o que foi e o que não foi feito, para ninguém ler esta página como mais conferida do que é:

- **Feito:** as oito pesquisas; a conferência das oito, com as correções aplicadas aqui; os três desenhos (o de simplicidade para o comprador parou antes das fases e das decisões); e o ataque em quatro papéis, com as mudanças aplicadas: quem quer piratear (17 achados; §2.2, §7, §10 e §11.3), o jurídico e comercial (17 achados; §2.2, §8, §9 e §10), o comprador honesto (29 achados; §1.4, §2, §3, §4 e §5) e o engenheiro deste repositório (16 achados; §11, §12 e as 13 afirmações sobre o código que estavam erradas ou incompletas).
- **Não rodou:** o painel de juízes sobre os três desenhos, cuja comparação foi feita por quem escreveu esta página. E as mudanças vindas dos três últimos ataques não passaram por um ataque novo.
- **Ainda não foi testado em servidor:** nada do §11 foi construído. O agente engenheiro gerou o produto sem as variáveis públicas e o subiu no ambiente dele para conferir o §11.5; nada foi instalado em servidor de verdade. Os pontos que dependem de teste antes de virar promessa estão marcados no texto: um endereço só (D14), a chave publicável fixa (§11.5), os tempos de instalação (§1.4), o plano mínimo por provedor (§3.1), os números de carga (§3.1) e a memória do kit sem os serviços que o produto não usa (A29).
- **O que só profissional decide:** o contrato, a aplicação do CDC, a autoria com assistência de IA e a referência visual, com o advogado; o imposto e a nota, com o contador. As leis foram lidas no texto; nenhuma decisão de tribunal foi lida na íntegra.
- **Depois das respostas do produtor (10/11/2026):** a Licença anual com Anos adicionais ou vitalícia, a regra de uma Licença para uma área, a loja de Módulos, o Painel de licenças e o assistente de domínio foram escritos nesta página no mesmo dia. Foram conferidos no repositório: o HTTPS automático do Caddy, os dois endereços de hoje, a criação de registros na Cloudflare pela API e o fato de os adaptadores de venda não guardarem os campos de origem do checkout. Não foi conferido: como a Hotmart e a Ticto deixam um produto fora da vitrine, e se devolvem no aviso da venda a Licença escolhida no link do checkout. Os prazos da Licença anual vencida e o que a vitalícia inclui são padrões assumidos, à espera do produtor e do advogado.
