# 32. Produto licenciado: a área de membros instalada no servidor do comprador, com licença, instalação por um comando e o add-on de Webinários (proposta, 10/11/2026)

Data: 10/11/2026. Status: **proposta para o produtor decidir**. Nada aqui está aprovado e nenhum arquivo de código foi alterado para produzir este documento.

Pedido do produtor (04/11/2026, em duas mensagens): vender a área de membros como produto que o comprador instala na estrutura dele, no servidor próprio dele; controle profissional de licenças (o comprador compra 1, 2, 3 ou mais e não pode revender, copiar nem passar adiante; "se piratear, estraga o produto"); os webinários como um segundo produto, acoplado como plugin; uma aula, dentro da nossa área de membros, que ensina a instalar com IA (Claude Code ou Codex); o serviço de instalação para quem não quiser instalar sozinho; e uma instalação "de um clique", por um script que faça tudo em qualquer servidor (Hetzner, Contabo, Hostinger, HostGator) e que a IA consiga rodar e consertar quando algo der errado.

Vale para qualquer trabalho em licenças, no instalador, na entrega das versões, na marca branca ou na venda da área como produto. Enquanto for proposta, não muda nenhuma regra dos outros documentos.

Como foi feito: oito frentes de pesquisa em 04/11/2026 (cinco de mercado, com fonte primária, e três lendo este repositório); em 10/11/2026, cada frente foi conferida por um verificador independente, três desenhos da solução foram escritos por ângulos diferentes (proteção primeiro, simplicidade para o comprador primeiro e lançar rápido) e o rascunho foi atacado no papel de quem quer piratear. O que ficou sem rodar está no §16. As fontes estão no §15.

Vocabulário desta página: **Licença** (o direito de usar, comprado na Hotmart ou na Ticto), **Instalação** (a área rodando num servidor, num endereço), **Chave de ativação** (o código de uso único que liga uma Instalação à Licença), **Manutenção** (versões novas e suporte), **Pacote da versão** (o que o instalador baixa), **Add-on** (módulo comprado à parte, como os Webinários), **Emissor** (o nosso serviço que emite e confere licenças), **Verificador** (a parte do produto que confere a licença dentro da Instalação do comprador) e **lote fundador** (os primeiros compradores, instalados por nós). "O produto" é a área de membros vendida a outras escolas; o nome comercial ainda não existe (A10).

## Resumo em uma página

**Em uma frase.** O comprador paga por Instalação, roda um comando no servidor dele e a área sobe com a marca dele. A Licença decide em quantos servidores o produto roda, libera as versões novas e liga o add-on de Webinários.

| Tema | Proposta |
|---|---|
| **O que é uma Licença** | o direito de rodar **uma Instalação de produção** (um endereço público da área, com o banco dela), mais uma de teste. Quem quer mais compra de novo ou compra o produto de 3 ou de 10 Instalações |
| **Como paga** | Licença **perpétua** da versão comprada, com **12 meses de Manutenção** incluídos (versões novas e suporte); depois, Manutenção anual opcional. Sem renovar, a área continua funcionando na versão em que está (A1) |
| **O que o comprador recebe** | a aula de instalação, a página **Minhas licenças** e o Pacote da versão: o produto já compilado, os arquivos de instalação e o banco pronto para ser criado. **O código-fonte não é entregue** |
| **Instalação** | um comando, em qualquer servidor Linux com acesso de administrador (VPS): confere a máquina, instala o que falta, baixa o pacote, gera as senhas, sobe o banco e a área com HTTPS, cria a primeira conta da equipe, ativa a Licença e confere se está tudo no ar. **Não roda em hospedagem compartilhada** |
| **Com a IA** | o pacote traz as instruções para o Claude Code e o Codex, um comando de diagnóstico que responde em formato de máquina e códigos de erro fixos. A IA instala, lê o diagnóstico e conserta; nenhuma senha passa pelo chat |
| **Controle da Licença** | cada Instalação nasce de uma Chave de ativação de uso único e fica presa ao endereço dela. Uma vez por dia ela fala com o nosso Emissor e guarda uma licença assinada que vale 30 dias sem contato. Reembolso e chargeback revogam sozinhos |
| **Manutenção vencida** | nada para. Só não chegam versões novas nem suporte |
| **Licença irregular** (revogada, endereço errado, muito tempo sem contato) | a escola **congela** por etapas: primeiro um aviso, depois a equipe para de editar, depois param as matrículas novas. **O aluno que já está dentro nunca perde o acesso** e os dados nunca são apagados (§2.2) |
| **Webinários** | segundo produto, por Instalação. Já vai dentro do produto e a Licença liga. A Live gravada e o Replay só pedem uma conta da Bunny; a Live ao vivo pede um segundo servidor para o vídeo, instalado pelo mesmo kit |
| **Marca do comprador** | nome da escola, logo, cores, e-mails e endereços trocados pela Personalização e pelo instalador, sem tocar no código |
| **Nosso lado** | um Emissor pequeno e nosso, no ar 24 horas; a tela **Licenças** no nosso admin; e a página **Minhas licenças** para o comprador, dentro da nossa área, ao lado da aula de instalação |
| **Jurídico** | contrato de licença de uso (por Instalação, intransferível, sem revenda), registro do programa no INPI, revogação automática no reembolso de 7 dias; um advogado revisa o contrato antes da primeira venda |
| **Prazo** | primeiro o **lote fundador**: até 10 compradores, instalados por nós, por volta da 6ª à 8ª semana. A venda aberta, com o comprador instalando sozinho, entre a 16ª e a 20ª semana (§12) |

**O que a Licença segura e o que não segura.** Segura quem não mexe em código, que é quase todo comprador: a mesma Licença em servidores de amigos, a cópia do servidor para um segundo endereço, o comprador que pede reembolso e continua vendendo curso, e o repasse do instalador (sem Licença não ativa nem atualiza). Não segura uma pessoa técnica que abra o produto compilado e arranque a verificação: nenhum produto instalado no servidor do cliente segura isso, e ofuscar só tira desempenho. Contra essa pessoa valem o contrato e a lei (§9), o nome do comprador gravado em cada cópia licenciada e o fato de que a cópia alterada fica sem as versões novas e sem as correções de segurança, a menos que o trabalho seja refeito a cada versão (§7).

**O que você precisa decidir agora** (detalhes e o padrão assumido no §13.2):

1. Licença perpétua com 12 meses de Manutenção, ou assinatura anual (A1).
2. Os produtos de 1, 3 e 10 Instalações (A2).
3. Até onde vai o congelamento quando a Licença é revogada: o aluno que já está dentro mantém o acesso, ou a área sai do ar depois de um prazo (A3).
4. Se o código-fonte nunca é entregue, ou se existe um plano mais caro que entrega (A7).
5. Se a gravação das lives por hora vira um serviço nosso, cobrado por uso (A8).
6. O nome, a marca e o endereço do produto (A10).
7. O lote fundador: quantos compradores, quem e em que condições (A14).
8. O advogado que revisa o contrato de licença (A16).
9. Quando a nossa produção volta a ficar ligada 24 horas e se o Emissor ganha um servidor só dele (A19).

---

## 1. O que o comprador compra

### 1.1 Catálogo (estrutura, sem preços)

| Produto | O que é | Como entra na Hotmart e na Ticto |
|---|---|---|
| **Licença da área de membros** | o direito de rodar 1 Instalação de produção, a aula de instalação e 12 meses de Manutenção | produto de pagamento único (parcelável). As Licenças de **3** e de **10 Instalações** são produtos próprios, cada um com o seu código |
| **Manutenção anual** | mais 12 meses de versões novas e suporte para uma Licença que já existe | assinatura anual de outro produto; opcional |
| **Add-on Webinários** | liga os Webinários numa Instalação escolhida (§5) | produto próprio, por Instalação, com a mesma regra de Manutenção |
| **Instalação feita por nós** | rodamos o kit no servidor do comprador e entregamos a área no ar (§3.5) | produto de preço fixo e escopo fechado. Na Hotmart, o formato "Serviço Online" não entra como oferta adicional do checkout; o formato certo se confirma com o compliance |
| **Horas avulsas** | o que foge da instalação padrão: trazer alunos de outra plataforma, personalização, ajuda com o servidor | pacote de horas |
| **Gravação de lives por hora** (só se A8 for sim) | o nosso gravador grava a live do comprador e entrega o vídeo na Bunny dele | consumo (créditos); nos torna operadores de dados do comprador (§9) |

Por que produtos próprios e não "quantidade" nem "ofertas": o nosso sistema reconhece a venda pelo código do produto (`data.product.id` na Hotmart e `item.product_id` na Ticto), não pelo código da oferta nem pela quantidade, e o reprocesso usa o que ficou guardado. Um produto por tamanho funciona hoje, nas duas plataformas, sem mexer nos adaptadores. Quem quer 2 Instalações compra duas vezes a Licença de 1: as compras somam.

### 1.2 O que é uma Licença

- **Uma Instalação de produção** é a área rodando num endereço público (por exemplo `membros.escola.com.br`) com o banco dela. Dois endereços com bancos diferentes são duas Instalações, mesmo no mesmo servidor.
- **Uma Instalação de teste para cada uma de produção.** Ela só ativa num subendereço do mesmo domínio da produção (por exemplo `teste.escola.com.br`), aceita até 20 alunos e mostra a faixa "Ambiente de teste" no admin e na área. São limites aplicados pelo produto, não só um aviso (A6).
- **A Licença é do comprador e das escolas dele.** Não pode ser revendida, emprestada nem usada para hospedar a área de terceiros. O admin de toda Instalação mostra "Licenciado para" com o nome do comprador. Agência que instala para clientes fica fora da primeira versão (A12).
- **Compras somam.** Cada compra aparece em **Minhas licenças** com as Instalações dela.

### 1.3 O que o comprador recebe

1. **A página Minhas licenças**, na nossa área de membros, onde ele gera a Chave de ativação de cada Instalação. O e-mail da compra leva o link dessa página, nunca a Chave.
2. **A aula de instalação**, na mesma área: o comprador da Licença é um aluno nosso, pelo mesmo caminho de qualquer venda (§11.10).
3. **O Pacote da versão:** a imagem do produto já compilada, os arquivos do banco e dos serviços, os scripts de instalação e de operação, as instruções para a IA e a lista assinada do que há no pacote.
4. **Versões novas e suporte** enquanto a Manutenção estiver em dia.

O que ele não recebe: o código-fonte, este repositório, os testes, os documentos internos e o Emissor. Hoje o deploy da nossa produção manda o repositório inteiro para o servidor (`infra/cloud/lib.sh`, `sync_repo`); para o comprador isso muda (§11.6).

### 1.4 O caminho do comprador (na venda aberta)

1. Compra na Hotmart ou na Ticto. O aviso da venda cria a conta dele na nossa área, libera a aula e emite a Licença (§11.10).
2. Entra na nossa área, abre **Minhas licenças**, clica em **Nova instalação**, informa o endereço e copia o comando, que já leva a Chave de ativação (vale 24 horas e só serve uma vez).
3. Contrata um servidor (a aula mostra três provedores e o tamanho certo) e aponta o endereço para ele.
4. Roda o comando, ou entrega o comando para a IA. A meta é a área no ar em cerca de 15 minutos, com HTTPS e a Licença ativa; o número se confirma no ensaio em três provedores (§12).
5. Entra com a primeira conta da equipe, troca a marca na Personalização, liga a venda dele (Hotmart ou Ticto dele) e cadastra o primeiro curso.
6. Quando sair versão nova, o admin dele avisa; ele roda **atualizar** (ou pede à IA).

No lote fundador, os passos 3 e 4 são feitos por nós (§12).

## 2. Como a Licença funciona

### 2.1 Ativação e conferência diária

- **Ativar.** O instalador manda ao Emissor a Chave de ativação, o endereço da Instalação e um identificador sorteado na hora. Se a Licença ainda tem Instalação livre, o Emissor devolve uma **licença assinada** por nós: um arquivo pequeno que diz de quem é, para qual endereço vale, quais módulos liga (a área, os Webinários), até quando vai a Manutenção e até quando o próprio arquivo vale. Devolve também um segredo só daquela Instalação, usado nas conferências seguintes.
- **Conferir.** O produto confere a assinatura dentro do servidor do comprador, com a nossa chave pública gravada no produto, e confere que **o endereço em que está rodando é o endereço da licença**. Nenhuma página depende da internet para abrir: a conferência usa o arquivo guardado.
- **Renovar o arquivo.** Uma vez por dia, a Instalação fala com o Emissor (pelo mesmo agendador de minuto que já envia e-mails e avisos) e troca o arquivo por um novo, válido por mais 30 dias. É nessa conversa que chegam a revogação, a Manutenção renovada, o add-on comprado depois e o aviso de versão nova. O admin do comprador tem o botão **Verificar agora**.
- **Nos primeiros 10 dias depois da compra,** o arquivo vale só até o 10º dia. É o prazo do arrependimento: quem compra, instala, corta a conversa com o Emissor e pede o dinheiro de volta fica com uma licença que vence em dias, não em um mês.
- **O que a Instalação manda nessa conversa:** o número da Licença, o identificador da Instalação, o endereço e as versões do produto e do pacote. Nenhuma contagem e nenhum dado de aluno (§9).
- **Se o nosso Emissor cair,** nada acontece por 30 dias, e existe uma segunda saída (§2.2).

É o desenho de Coder e Mattermost (licença assinada, conferida no servidor do cliente), com a renovação periódica de Metabase, Grafana, Directus e n8n, o vínculo ao endereço público do Directus e do Grafana e a tolerância de 30 dias da JetBrains (§15).

### 2.2 O que acontece em cada situação

Três degraus, sempre nesta ordem, e nada além deles:

- **Aviso:** uma faixa no admin, dizendo o que houve, a data do próximo degrau e o botão **Exportar dados**.
- **Admin limitado:** a equipe da escola entra, vê tudo, exporta tudo e atende quem já é aluno (trocar senha, remover acesso, pedidos da LGPD). Não cria nem publica conteúdo, não envia avisos, não cria webinário, não conecta integração e não muda a aparência.
- **Escola congelada:** admin limitado e nenhuma matrícula nova, nem à mão, nem por importação, nem por venda. A venda que chega fica guardada e é liberada pelo **Reprocessar**, que já existe, assim que a Licença for regularizada. Nada se perde.

| Situação | A equipe do comprador | O aluno do comprador | Como sai |
|---|---|---|---|
| Licença ativa, Manutenção em dia | tudo | tudo | |
| **Manutenção vencida** | tudo, na versão coberta; avisos 60, 30 e 7 dias antes e uma linha em Configurações: "Atualizações até 10/11/2027 · Renovar" | tudo | renova quando quiser (A11) |
| **Sem contato com o Emissor** (o nosso fora do ar, ou o servidor do comprador sem saída) | até o 7º dia, nada; do 8º dia, Aviso; no 30º, quando a licença guardada vence, Admin limitado; no 60º, Escola congelada | quem já é aluno: tudo, sempre | volta sozinho no primeiro contato. Se a falha for nossa, publicamos uma extensão assinada, que toda Instalação busca num segundo endereço |
| **Instalação a mais** (a Licença já usou todas) | a ativação é recusada no instalador, com a lista das Instalações ativas | a área nova não sobe | desativar uma Instalação em Minhas licenças, ou comprar mais |
| **Endereço diferente do da licença** (cópia do servidor em outro domínio, ou domínio trocado sem avisar) | Aviso na hora: "esta Instalação está em outro endereço"; em 7 dias, Admin limitado; em 30, Escola congelada | quem já é aluno: tudo | trocar o endereço em Minhas licenças (§2.3) ou ativar outra Instalação |
| **Licença revogada** (reembolso, chargeback, fraude, quebra do contrato) | no dia em que a revogação chega: Aviso, e fim das versões novas e dos serviços nossos; em 7 dias, Admin limitado; em 30, Escola congelada | quem já é aluno: tudo (A3 traz a opção mais dura) | comprar de novo ou ganhar a disputa reativa. Quem já teve reembolso espera a nossa liberação |
| **Cópia sem licença** (o produto vendido, sem licença válida) | só a tela de ativação e o diagnóstico | a área não inicia | ativar |

Regras que valem para todas as linhas: os dados nunca são apagados; nada acontece de uma hora para a outra; o aluno nunca vê aviso sobre a Licença da escola; e o que o Emissor manda é sempre um dado assinado, nunca um comando.

Por que assim. Os três desenhos independentes chegaram à mesma regra por caminhos diferentes: a licença irregular congela a escola e não derruba o aluno que já está dentro. Uma escola congelada não serve para quem quer usar sem pagar (não publica aula nova e não matricula ninguém), e uma falha nossa nunca tira do ar a escola de quem está em dia. No mercado, o que é unânime é não apagar dados e avisar antes; sobre o usuário final há de tudo: o Mattermost e a Metabase só rebaixam, o GitLab deixa a instância somente leitura e o Directus chega a bloquear o login de quem não é administrador (§15). O degrau mais duro, tirar a área do ar para os alunos, fica como decisão do produtor com parecer do advogado (A3).

No lote fundador, o Verificador roda os primeiros 60 dias em **modo de observação**: registra e avisa, sem limitar nada, para pegar alarme falso antes que ele custe caro a quem pagou.

### 2.3 Trocar de servidor ou de endereço

- **Trocar de servidor, mesmo endereço:** restaurar o backup no servidor novo e apontar o endereço. A licença continua valendo; nada a fazer em Minhas licenças.
- **Trocar de endereço** (de `membros.escola.com.br` para `alunos.escola.com.br`): em **Minhas licenças**, **Trocar endereço**; a Instalação recebe a licença nova na conferência seguinte. Duas trocas por ano por Instalação sem falar com ninguém; a partir da terceira, pelo suporte (A5). A Manutenção vencida não impede a troca.
- **Servidor que morreu:** **Desativar** em Minhas licenças libera a vaga para uma ativação nova. Se o servidor antigo voltar, ele fica sem renovação e segue a escada do "sem contato".

### 2.4 Minhas licenças (comprador) e Licenças (produtor)

- **Minhas licenças**, na nossa área do aluno, ao lado de Minhas compras: cada Licença com as Instalações ativas (endereço, versão, último contato), **Nova instalação** (gera a Chave de ativação e o comando), **Trocar endereço**, **Desativar**, a data da Manutenção, os add-ons e a qual Instalação cada um está ligado, a aula e **Renovar**.
- **Licenças**, no nosso admin, em Configurações: a lista com busca, a origem (venda, cortesia, fundador), as Instalações de cada uma, os alertas (duas cópias brigando pela mesma Instalação; Instalações de uma mesma Licença em escolas sem relação entre si; comprador que já pediu reembolso antes) e as ações **Emitir**, **Suspender**, **Revogar**, **Reativar** e **Estender a Manutenção**, todas no histórico de auditoria e avisadas por e-mail ao dono. Só o dono da escola, como em Configurações › Vendas.
- **Licença**, no admin do comprador, em Configurações: a situação, "Licenciado para", o endereço, a Manutenção, a versão e **Verificar agora**.

As duas primeiras telas só existem na nossa Instalação: ligam por um módulo que só a nossa própria licença assinada traz, não por uma variável de ambiente (§11.3).

### 2.5 Reembolso, chargeback e cancelamento

- **Reembolso** (os 7 dias do arrependimento valem para toda venda da Hotmart e da Ticto) e **chargeback**: o aviso que já tratamos hoje revoga a Licença. A Instalação fica sabendo na conferência seguinte, em até 24 horas, e começa a escada do §2.2. O pedido de reembolso ainda em análise (o `PURCHASE_PROTEST` da Hotmart) não revoga.
- **Comprador que já teve reembolso ou chargeback:** a Licença nova fica aguardando a nossa liberação. Comprar, usar um mês e pedir o dinheiro de volta não vira rotina.
- **Manutenção cancelada ou atrasada:** não revoga nada; só deixa a Manutenção vencer na data.
- **Compra do add-on reembolsada:** só o add-on desliga.
- Cada Licença fica presa à venda que a emitiu: o reembolso daquela venda revoga aquela Licença. Ela não passa pela regra dos acessos dos alunos (`decideEntitlementAfterSale`), que em alguns casos mantém o acesso depois de um reembolso.

## 3. Instalação em qualquer servidor

### 3.1 Onde roda e onde não roda

| Onde | Roda? | Observação |
|---|---|---|
| Hetzner Cloud, Contabo VPS, Hostinger VPS, DigitalOcean, Vultr e parecidos | sim | qualquer servidor Linux com acesso de administrador (root) |
| HostGator VPS | sim, com ressalva | o servidor precisa estar sem o painel cPanel/WHM, que ocupa as portas da área; a confirmar no ensaio |
| Hospedagem compartilhada (os planos "de site" da Hostinger e da HostGator) | **não** | não dão acesso de administrador nem deixam rodar Docker |

Requisitos: Ubuntu 24.04 ou 22.04, ou Debian 12; processador x86-64; 2 vCPU; **4 GB de memória no mínimo** (o instalador cria 2 GB de memória de troca) e 8 GB recomendados; 40 GB de disco; as portas 80 e 443 livres; saída para e-mail pela porta 587; e um endereço apontado para o IP do servidor.

O que foi medido: a nossa produção roda desde 19/10/2026 com 2 vCPU e 4 GB. No teste de carga daquele dia, 30 alunos de teste navegando sem parar ficaram bem dentro do limite (95 % das páginas em até 0,8 s); com 100, não houve erro, mas a área ficou lenta (95 % em até 3,9 s). O teste é anterior à Comunicação v2 e aos Webinários e precisa ser repetido antes de virar promessa na página de venda (`docs/20` §12.1).

O que o comprador precisa ter, além do servidor: um domínio; uma conta de e-mail transacional (o Resend, que tem plano grátis, na primeira fase; outros provedores depois, A17); e, para as aulas, vídeo no YouTube, no Vimeo, na Bunny ou na Mux, como na nossa área.

**Um registro de DNS só, se o teste passar.** Hoje a nossa produção usa dois endereços obrigatórios (a área e a API) e um opcional (o painel do banco, que fica desligado). Para o comprador, a meta é servir a área e a API no mesmo endereço e deixar o painel do banco fora do kit. Isso se decide com um teste no começo da fase 2; se não der, ficam dois registros (D14).

### 3.2 O comando e o que ele faz

O comprador copia de **Minhas licenças** uma linha parecida com esta (os nomes finais saem na fase 2):

```bash
curl -fsSL https://instalar.<produto>.com.br | sudo bash -s -- --endereco membros.escola.com.br --email dono@escola.com.br --ativacao <chave de uso único>
```

1. **Confere antes de mexer** (não altera nada): sistema, processador, memória, disco, portas, se o endereço aponta para este servidor, saída para a internet e para o e-mail. Se algo falta, para com um código de erro e a frase do que fazer.
2. **Prepara o servidor:** Docker, firewall, memória de troca e atualizações de segurança. Parte do `infra/scripts/bootstrap.sh` de hoje, que precisa de ajustes para servidor de terceiros (§11.7).
3. **Baixa o Pacote da versão** e confere a nossa assinatura.
4. **Gera as senhas e os segredos** num arquivo que só o administrador do servidor lê. Nada disso aparece na tela nem no registro da instalação.
5. **Sobe o banco e os serviços** (o Supabase no próprio servidor) e o HTTPS automático.
6. **Cria o banco** (as migrações do pacote) e liga o agendador de minuto.
7. **Sobe a área.**
8. **Ativa a Licença.**
9. **Cria a primeira conta da equipe:** convite para o e-mail informado e o mesmo link na tela.
10. **Confere o resultado** (área respondendo, login, banco fechado para fora, arquivos, agendador rodando) e mostra o resumo.
11. **Liga o backup diário** e pede o destino fora do servidor (§4).

Rodar de novo continua de onde parou e nunca apaga dados. Depois de instalado, o servidor ganha um comando de operação (nome provisório `membros`) com **status**, **diagnóstico**, **atualizar**, **backup**, **restaurar**, **registros** e **licença**.

### 3.3 O kit para a IA

Entregar a instalação por agente de IA como parte oficial do produto ainda é raro (achamos um caso, a Kodus, que publica uma skill de instalação no repositório do instalador), e os padrões abertos para isso já existem (§15). O pacote traz:

- **Um `AGENTS.md`**, lido pelo Codex e pelo Claude Code, e um `CLAUDE.md` de uma linha que só o importa, para as versões do Claude Code que não leem o `AGENTS.md` sozinhas. Ali estão a ordem obrigatória (conferir, instalar, diagnosticar), o que nunca fazer (mostrar o arquivo de segredos, apagar os volumes do banco, editar a configuração à mão) e como ler os erros.
- **Uma skill de instalação** no formato aberto de skills, dentro do próprio pacote, que só chama os mesmos comandos do instalador.
- **Diagnóstico em formato de máquina:** `membros diagnostico --json` devolve a versão, o estado de cada serviço, o banco, as portas, o DNS, o certificado, o disco, a idade do último backup, a situação da Licença e as últimas linhas de erro, sem segredos.
- **Códigos de erro fixos e documentados** (por exemplo: porta ocupada, endereço que não aponta para o servidor, memória insuficiente, Chave de ativação vencida, limite de Instalações, assinatura do pacote que não confere), cada um com a causa e o conserto.
- **Travas que não dependem de a IA obedecer:** o instalador recusa os comandos destrutivos sem uma confirmação digitada pela pessoa; o arquivo de segredos só o administrador lê; e, depois de instalado, a IA trabalha por uma **conta de operador** que só roda o comando de operação. A configuração sugerida para o Claude Code também nega a leitura do arquivo de segredos, o que ajuda mas não cobre todo caminho, e por isso não é a única trava.

A senha do e-mail e as chaves de vídeo entram por arquivo fechado no servidor ou digitadas no terminal, nunca coladas no chat da IA.

### 3.4 A aula

Dois caminhos, do mais simples ao mais guiado: **(a) um comando**, colado no terminal do servidor; **(b) com a IA**, em que o comprador abre o Claude Code ou o Codex no computador dele, entrega o endereço do servidor e a frase pronta da aula, e a IA entra por SSH, confere, instala e roda o diagnóstico. A aula recomenda a IA no computador do comprador, não dentro do servidor, para a conta dele da Anthropic ou da OpenAI não ficar guardada lá. Também cobre: contratar o servidor em três provedores, apontar o endereço, criar a conta do Resend e verificar o domínio, o primeiro acesso, a Personalização, o backup e uma restauração de teste, a atualização e a troca de servidor.

### 3.5 O serviço de instalação

É o mesmo kit, rodado por nós. Escopo fechado: conferir o servidor que o comprador contratou, apontar o endereço com ele, instalar, configurar o e-mail e o vídeo, criar a primeira conta, ligar o backup, fazer uma restauração de teste e entregar o relatório do diagnóstico. Fora do escopo: o custo do servidor e do domínio, trazer alunos de outra plataforma e personalização visual (horas avulsas). O acesso é por uma chave SSH temporária, removida no fim, e os segredos do comprador chegam por envelope cifrado (o `infra/cloud/envelope.sh` de hoje), nunca por chat. O serviço não pode usar o nosso fluxo de infra atual, que só cria e opera máquinas na nossa conta da Hetzner; depende do instalador por SSH da fase 1.

Um cuidado jurídico: se o comprador é consumidor e se arrepende nos 7 dias, os contratos acessórios caem junto, sem custo para ele (Decreto 7.962, art. 5º, § 2º). O serviço de instalação tende a ser acessório da Licença. Ou a instalação começa depois do 7º dia, ou o risco é assumido (A16).

## 4. Atualizações, backup e suporte

- **Versões numeradas** (1.0.0, 1.1.0...) com notas em português na nossa área. O admin do comprador mostra "Versão 1.3.0 disponível" (a notícia chega na conferência diária). Hoje a versão é só o código do commit em `/api/health`.
- **Atualizar** é um comando: faz backup, baixa o pacote novo (com a Manutenção em dia), confere a assinatura, aplica as migrações, troca a imagem, confere e, se a conferência falhar, volta para a imagem anterior. As imagens antigas são apagadas, menos a anterior (hoje ficam todas no disco).
- **O banco nunca volta de versão.** Para isso as migrações do produto passam a seguir uma regra escrita e testada: só acrescentam; o que precisa ser apagado sai em duas versões. Essa regra ainda não existe: há migração que apaga tabela (`202610140001`) e o `docs/20` §9 lista cuidados manuais para voltar versão, que um comprador não saberia seguir.
- **Sem atualização automática na primeira versão.** As ferramentas que trocam a imagem sozinhas (o Watchtower e o fork ativo dele) não fazem backup, não aplicam migração e não voltam atrás; isso é o nosso comando que faz.
- **Backup** diário, cifrado, com o `restic` que já usamos, para um destino fora do servidor escolhido pelo comprador (armazenamento compatível com S3 ou SFTP). O `backup.sh` e o `restore.sh` de hoje já servem, com o destino genérico por fazer; a restauração foi ensaiada em 17/10/2026. O instalador não termina sem um destino ou sem o comprador assumir por escrito que o backup fica só no servidor.
- **O banco do próprio servidor** (Supabase) viaja travado em cada versão do pacote; o comprador nunca atualiza o Supabase por fora. Troca de versão maior do Postgres é procedimento à parte, feito como serviço.
- **Suporte:** a Manutenção cobre defeito do produto. Problema do servidor do comprador (disco cheio, provedor fora, DNS) é hora avulsa. O canal e o prazo de resposta são decisão do produtor (A15).

## 5. Add-on de Webinários

### 5.1 O que liga e o que o comprador precisa ter

| Parte | O que precisa, além da área | Observação |
|---|---|---|
| Página de webinários, **Garantir vaga**, lembretes pelo sino e por e-mail | nada | |
| **Live gravada** e **Replay** | uma conta da Bunny Stream | é requisito do add-on: a Live gravada e o Replay só aceitam vídeo da Bunny (as aulas aceitam também YouTube, Vimeo e Mux). Sem servidor extra |
| **Live ao vivo** | um segundo servidor para o vídeo (2 vCPU e 4 GB para cerca de 30 a 40 alunos com câmera; 4 vCPU e 8 GB para cerca de 100, pelas contas do `docs/30` §7.1), o endereço `meet.` apontado direto para ele e a porta UDP 10000 aberta | instalado pelo mesmo kit, com o perfil de vídeo; o endereço do vídeo não pode passar pelo proxy da Cloudflare |
| **Gravação da live ao vivo** | primeira versão: **Gravar no navegador** ou **Enviar gravação**, que já existem no console da equipe. Depois: um gravador fixo em servidor próprio (4 vCPU e 8 GB gravam em 720p; 1080p pede 8 vCPU e 16 GB); ou o nosso gravador por hora, como serviço (A8) | o gravador de hoje é criado pelo nosso GitHub e pela nossa conta da Hetzner (`src/server/webinars/recorder-dispatch.ts`); não serve ao comprador como está |
| **Assistente** e tradução do chat | a chave de um provedor de IA em Configurações › IA | opcionais |

### 5.2 Como a Licença liga

- **Na mesma imagem.** Os Webinários já vão dentro do produto; a licença assinada de cada Instalação diz se estão ligados. É como a edição Enterprise do GitLab, do Mattermost e do n8n: um pacote só, e a licença destrava (§15).
- **Por Instalação escolhida.** Cada compra do add-on é ligada, em Minhas licenças, a uma Instalação. Mudar de Instalação conta como troca (§2.3).
- **Sem o add-on,** o item do menu, as páginas, as rotas, as tarefas de minuto, a faixa "Ao vivo agora", o atalho **Avisar** e a regra **Participação em lives** dos segmentos somem. Nada fica aparecendo com erro, e as notificações antigas de live deixam de apontar para uma página que não existe.
- **Comprou depois:** liga na conferência diária seguinte, ou na hora pelo **Verificar agora**.
- **As tabelas dos Webinários existem em toda Instalação,** vazias em quem não comprou. Aplicar sempre é o caminho mais barato: as migrações deles mexem em tabelas do núcleo e as guardas de teste conferem o histórico inteiro das migrações.

O que esta escolha custa, sem enfeite. Ligar pela Licença é o mais barato de construir, mas o código do add-on vai para todo comprador: quem alterar o produto compilado destrava os Webinários junto. A alternativa que protege mais é uma **segunda edição da imagem**, com os Webinários dentro, entregue só a quem comprou; ela pede transformar em pontos de extensão 11 arquivos do núcleo, a regra de segmentos da Comunicação, o tipo de notificação do sino e as tarefas de minuto. Fica como passo seguinte, se aparecer cópia alterada circulando (§13.3).

### 5.3 O que muda no produto antes de vender

- A permissão de câmera e microfone da sala é gravada na hora de gerar a imagem, com `meet.bunker707.com.br` (`next.config.ts`). Passa a ser montada a cada pedido, com o endereço de vídeo de cada Instalação.
- O gravador passa a ter um adaptador com **nenhum** como padrão; o nosso (GitHub mais Hetzner) vira uma das opções, só da nossa Instalação, e o endereço fixo do nosso repositório sai do código.
- A marca dentro do módulo (os rodapés dos e-mails de live, o nome na sala, os títulos das três páginas, o identificador do calendário) passa a vir do nome da escola (§6).
- O kit do servidor de vídeo (`infra/jitsi`) ganha um instalador próprio e uma conferência (endereço sem proxy, portas, segredo igual ao da área), deixa de depender de um script que fica fora da pasta dele e **fecha a porta 5222**: hoje o compose a publica para a internet e quem a limita é só o firewall da Hetzner.
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

**Proposta:** uma chave nova de configuração, **Escola** (nome, nome curto, assinatura do rodapé, e-mail de suporte, remetente, cor de destaque, ícone do navegador), lida pelas páginas, pelos e-mails, pelo sino, pelo login, pelo Modo TV e pela IA Diretor; o instalador pergunta o nome e o remetente e gera os e-mails do login com eles; as imagens padrão viram artes neutras; Termos e Privacidade viram páginas com texto editável; e uma guarda de teste passa a falhar se "Bunker707" voltar a aparecer fora da lista de identificadores técnicos. Para o lote fundador basta o mínimo (nome, remetente, e-mails, títulos, rodapé, imagens neutras); a cor, o ícone e as páginas legais entram na fase 2.

## 7. O que a Licença segura e o que não segura

Três tipos de pessoa: **A** compartilha ou revende sem mexer em código (o caso comum, os grupos de rateio); **B** compra, instala, pede reembolso e continua usando; **C** altera o produto compilado.

| Controle | O que impede | O que não impede |
|---|---|---|
| Chave de ativação de uso único e número de Instalações | A: o comando repassado não ativa de novo, e a Licença não ativa além do que foi comprado | C |
| Licença presa ao endereço, conferida pelo produto | A: o servidor copiado para outro domínio cai na escada do §2.2 sem precisar falar com o Emissor | quem esconde o endereço verdadeiro atrás de outro servidor (trabalho técnico) e C |
| Licença assinada que vence (30 dias; 10 nos primeiros dias) e ordem assinada de revogação | B: com contato, congela em 30 dias; cortando o contato, a licença vence sozinha e a escola congela do mesmo jeito | quem edita o banco à mão para matricular; C |
| Sequência trocada a cada conferência | mostra, na nossa tela Licenças, duas cópias usando a mesma Instalação. É detecção, não bloqueio | a cópia que nunca fala com o Emissor (cai no endereço e no vencimento) |
| Pacote só para Licença em dia, com cada download registrado | repassar atualizações: quem não tem Licença não baixa versão nova | o pacote que já foi baixado circular. Ele é igual para todos: não aponta para quem vazou |
| Produto compilado, sem código-fonte, sem mapas de fonte | reaproveitar o código e manter uma versão paralela com conforto | C, que lê o produto compilado com ajuda de IA em horas ou dias e pode até automatizar a alteração a cada versão |
| "Licenciado para" no admin de toda Instalação | a revenda disfarçada: o cliente final vê o nome de outra pessoa | a cópia alterada, que não mostra nome nenhum |
| Admin limitado e Escola congelada | o uso do admin e as matrículas pela área | quem tem acesso direto ao banco. Por isso o painel do banco fica fora do kit do comprador |
| Contrato, registro no INPI e a lei | dá base para notificar, tirar anúncio do ar e processar quem revende com nome e CNPJ (§9) | pirata anônimo ou fora do país |
| Serviços que só nós rodamos (Emissor, pacotes, gravador por hora, se houver) | A, B e C: não há como alterar o que roda no nosso servidor | só cobre o que é serviço; o núcleo roda sem eles |

O que decidimos não fazer: ofuscar o código (o projeto de ofuscação mais usado diz que a saída "ainda é JavaScript", fica de 15 % a 80 % mais lenta e é vulnerável a análise por IA), compilar para formatos fechados (não cifram nada e amarram a versão do Node) e tirar do ar à distância a escola de quem está em dia. O comprador típico é um produtor de cursos que não programa. A minoria que altera o produto perde as atualizações, o suporte e os serviços, e responde pelo contrato. É a posição de Laravel e Sidekiq, que entregam até o código-fonte e controlam o canal de atualização, e dos plugins pagos de WordPress, que continuam funcionando com a licença vencida (§15).

O vazamento que a lei garante: qualquer pessoa pode comprar, baixar e pedir o dinheiro de volta em 7 dias. O pacote vai circular. Por isso ele não vale nada sem ativação.

## 8. Modelo comercial

### 8.1 Unidade e tamanhos

A unidade é a **Instalação de produção**, como o "site" dos plugins de WordPress e a "instalação num domínio" do Kirby. No mercado há dois formatos: **degraus** (1, 3, 10 ou ilimitado, nos plugins de WordPress) e **quantidade com desconto por volume** (Kirby e Yoast). Como o nosso sistema reconhece a venda pelo produto, a proposta são três produtos: Licença de **1**, de **3** e de **10 Instalações**. Nos degraus do mercado, 3 custam de 1,3 a 2,7 vezes o preço de 1, e 10 custam de 1,7 a 3 vezes.

### 8.2 Perpétua com Manutenção, ou assinatura anual

| | Perpétua + 12 meses de Manutenção (proposta) | Assinatura anual |
|---|---|---|
| O que o comprador sente | comprou um produto | alugou |
| Na Hotmart e na Ticto | pagamento único parcelável; a Manutenção é uma assinatura anual à parte | assinatura anual, com a recuperação de cobrança das plataformas |
| Quando para de pagar | a área continua na versão coberta; perde versões novas, suporte e serviços nossos | a escola congela (§2.2), numa área com alunos pagantes dentro |
| Receita recorrente | depende de o comprador querer as versões novas: pede notas de versão e um plano público do que vem | previsível |
| Quem faz assim | Craft, Kirby, Unraid, e a JetBrains com a "licença perpétua de reserva" | GitLab, Mattermost, Metabase, os plugins de WordPress |

A proposta é a perpétua, porque o pedido foi "um produto, não um SaaS", porque não obriga a congelar a escola de quem só deixou de renovar e porque a lei brasileira já manda informar o prazo de validade técnica da versão e dar suporte durante ele (§9). No mercado, a renovação da Manutenção custa uma fração da licença: perto de 20 % a 25 % ao ano no Craft; os plugins de WordPress renovam pelo preço cheio, mas ali a licença é anual e barata.

### 8.3 Add-on e serviços

- **Webinários:** por Instalação, com a mesma regra de Manutenção.
- **Instalação feita por nós:** preço fixo e escopo fechado (§3.5), como o Discourse fazia com a instalação padrão e como instaladores de terceiros fazem hoje; o que foge do padrão vira horas, como os pacotes da Odoo.
- **Gravação por hora:** só se o produtor quiser operar um serviço (A8). Contraria o "produto, não SaaS", nos torna operadores dos dados da live e pede mais do que hoje: o nosso gravador precisaria das senhas do servidor de vídeo do comprador.

### 8.4 Hotmart e Ticto

O que as duas suportam, pelo que foi lido: produto de software com entrega em área de membros externa; pagamento único e assinatura anual; e os avisos de compra, reembolso, chargeback e cancelamento de assinatura que o nosso sistema já trata. O que falta do nosso lado para a Manutenção por assinatura: tratar a renovação, o atraso e a troca de plano, que hoje são ignorados (§11.10). O que confirmar antes de anunciar: com o compliance da Hotmart, que "software instalável com licença e aula" é aceito (a política de uso proíbe software "OEM, NFR, cópias ou backup" e não fala de licenças) e qual é o formato certo do serviço de instalação; e com a análise da Ticto para o produto de assinatura. Começar pela plataforma que aprovar primeiro (A21).

## 9. Jurídico

O que a lei brasileira já dá (texto conferido, §15):

- **Lei 9.609/1998 (Lei do Software).** O programa é protegido como obra por 50 anos, sem precisar de registro. O uso é objeto de **contrato de licença** (art. 9º). O contrato e a nota fiscal devem trazer o **prazo de validade técnica da versão** (art. 7º), e quem vende deve dar suporte durante esse prazo (art. 8º): é a nossa Manutenção. Reproduzir ou vender cópia sem autorização, para comércio, é crime com reclusão de 1 a 4 anos e multa (art. 12, §§ 1º e 2º); há ação para proibir o ato, com liminar e perdas e danos (art. 14). O art. 6º lista atos que não ofendem o direito do titular (a cópia de segurança, por exemplo); o contrato os preserva por escrito.
- **Lei 9.610/1998, art. 107** (vale para programas no que couber). Pune com perdas e danos quem altera ou inutiliza o dispositivo técnico que evita ou restringe a cópia. Usá-lo contra quem arranca a verificação de licença é uma tese para o advogado avaliar, não uma regra assentada: a verificação restringe o uso, e não achamos decisão que aplique o artigo a esse caso.
- **Código de Defesa do Consumidor, art. 49, e Decreto 7.962/2013.** Sete dias de arrependimento em toda venda pela internet; a Hotmart e a Ticto já aplicam. Por isso toda Licença precisa poder ser revogada na primeira semana (§2.5), e os contratos acessórios caem junto (§3.5).
- **LGPD.** O comprador é o controlador dos dados dos alunos dele. Nós só recebemos dados do próprio comprador (o contato e a Licença, que são dados pessoais quando ele é pessoa física ou MEI) e os identificadores da Instalação; nunca dados de alunos. Se um serviço nosso tratar dados de alunos (a gravação por hora), viramos operadores e o contrato ganha um anexo.
- **Marco Civil, art. 15.** Quem roda a área (o comprador) guarda os registros de acesso dos alunos por 6 meses. Mais um motivo para a nossa conferência não levar registros de aluno.

Cláusulas do contrato de licença (o texto é do advogado): licença de uso, não cessão; Instalações de produção e de teste; uso para as escolas do próprio comprador; intransferível e sem sublicença; proibido revender, redistribuir, hospedar para terceiros ou oferecer como serviço; proibido alterar ou contornar a verificação de licença; os atos do art. 6º preservados; o que a conferência diária envia; Manutenção e prazo de validade técnica; o que acontece em cada situação do §2.2, escrito antes da compra; o nome do comprador mostrado no admin; rescisão com prazo para corrigir; limite de responsabilidade; marca; foro. O contrato é proprietário. As licenças abertas mais citadas (Elastic License 2.0, Fair Core License, PolyForm) foram escritas para código público e permitem redistribuir: delas só se aproveita a redação da cláusula contra contornar a verificação e a do uso interno.

Antes da primeira venda: **registrar o programa no INPI** (envia-se só um resumo digital do código, com certificado ICP-Brasil; vale 50 anos e é a prova de autoria para as ações acima) e **registrar a marca do produto**.

O que só o advogado decide (A16): se o CDC vale para o comprador (quem compra para vender cursos usa o programa na atividade profissional, e o critério dos tribunais é a vulnerabilidade no caso concreto); o limite de responsabilidade e o foro; o texto das situações do §2.2 para não virar prática abusiva, e se a opção mais dura da A3 se sustenta; o arrependimento de 7 dias quando a instalação feita por nós já foi entregue; a tese do art. 107; e a tributação da licença e do serviço.

## 10. O nosso lado

- **A nossa produção volta a ficar ligada 24 horas antes do primeiro comprador do lote fundador.** Hoje ela fica guardada em snapshot e só é ligada para testes (`docs/21` §10). O servidor da área custa cerca de EUR 6 por mês num CX23 (EUR 6,49 pela API em 19/10/2026; EUR 5,99 no site em 10/11/2026, com a linha marcada sem estoque; o tipo seguinte de 4 GB vai de EUR 17 a 20). O servidor de marketing e o do vídeo podem continuar guardados até o lançamento da escola.
- **O Emissor tem banco só dele desde o primeiro dia e ganha um servidor só dele na venda aberta** (A19). A nossa área é um site público com login de alunos, e os compradores recebem a mesma imagem que ela roda: quem a invadir não pode encontrar ali a chave que assina licenças nem a tabela de licenças.
- **Duas chaves.** A chave **raiz** fica fora de qualquer servidor e só assina a chave de **emissão**, que fica no Emissor e pode ser trocada sem mexer no produto. O produto leva gravada a raiz e uma raiz de reserva. Isso cobre tanto a chave perdida quanto a chave copiada.
- **Se o Emissor cair,** os compradores não sentem nada por 30 dias. Ele tem backup diário, fica atrás da proteção da Cloudflare, num endereço separado do da escola, e a segunda saída é uma **extensão assinada** publicada no armazenamento dos pacotes, que toda Instalação busca quando o Emissor não responde. Para um caso isolado existe a licença de emergência: uma licença comum, presa à Instalação e ao endereço, válida por 90 dias, nunca emitida para Licença no prazo de reembolso ou em disputa.
- **Os pacotes** ficam num armazenamento de arquivos com link temporário (por exemplo o Bunny Storage, que já usamos). Cada versão pesa algumas centenas de megabytes; o custo é de centavos por comprador (A18).
- **Rotina de versão:** toda versão passa primeiro pela nossa própria escola, que vira a **Instalação número 1** do produto: a mesma imagem, o mesmo kit e uma Licença emitida por nós mesmos (D21). Só depois o pacote vai para os compradores, com as notas da versão.
- **Suporte:** um canal, um prazo e uma regra do que é do produto e do que é do servidor do comprador (A15). O diagnóstico em formato de máquina (§3.3) é o que torna o suporte viável: o comprador manda um arquivo, não uma descrição.
- **Segurança:** uma falha no produto passa a valer para todas as escolas que o rodam. A correção sai como versão, o aviso chega pelo admin de cada comprador e por e-mail, e a regra de por quanto tempo quem não renovou recebe correções de segurança é a A11.

## 11. Por dentro

### 11.1 Visão geral

```txt
NOSSO LADO                                              SERVIDOR DO COMPRADOR
+-----------------------------------+                   +-----------------------------------+
| nossa área (Instalação número 1)  |                   | área do comprador (o mesmo produto)|
|  venda Hotmart/Ticto -> Licença   |     ativar        |  Verificador (src/server/         |
|  Minhas licenças / Licenças       | <---------------- |    licensing): licença assinada,  |
|         | adaptador HTTP          |  conferir, 1x/dia |    endereço, degraus, módulos     |
|         v                         | <---------------- |  tarefa de minuto: conferência    |
| Emissor (services/                |  pacote da versão |  comando de operação              |
|   bunker-licensing): Licenças,    | ----------------> |  Supabase e Caddy                 |
|   Instalações, assinatura,        |                   +-----------------------------------+
|   versões; banco próprio          |
+-----------------------------------+
          | link temporário
          v
   armazenamento dos pacotes (e a extensão assinada de emergência)
```

### 11.2 Emissor (`services/bunker-licensing`)

- **Onde mora:** numa pasta própria em `services/`, como o `services/bunker-ai-gateway`, com Dockerfile e compose seus, escrito por nós em Node. Tem **banco próprio**, com as migrações na pasta do serviço; **nunca** em `supabase/migrations`, que vai no pacote do comprador. O `.dockerignore` já tira `services/` da imagem do produto. No lote fundador roda no servidor da nossa área; na venda aberta, num servidor só dele (A19). Operar um segundo sistema com compose, segredos e backup próprios não é novidade aqui: o Mautic e o Jitsi já rodam assim.
- **Por que separado do produto:** (1) a chave que assina as licenças e a tabela de Licenças não ficam no mesmo lugar que um site público com login de alunos; (2) um emissor dentro do produto daria a quem quisesse piratear um servidor de licenças pronto, bastando trocar a chave pública gravada; (3) a nossa escola continua rodando exatamente o produto que os compradores recebem (D21). Dois dos três desenhos também separam; o de lançar rápido começa como módulo da área e separa depois.
- **Por que construir e não comprar:** nenhuma ferramenta de licenças fala com a Hotmart ou com a Ticto, então a ponte da venda até a Licença seria nossa de qualquer jeito, e ela já existe pela metade (`src/server/payments`). O Keygen na nuvem é grátis até 100 licenças ativas e custa US$ 99 por mês daí em diante; o que pesa contra ele é cada escola depender de um serviço de fora para ativar e renovar, e não haver caminho de saída da nuvem para a edição de rodar em casa. O Keygen de rodar em casa é completo e recebe correções, mas traz um Rails com Sidekiq, Redis e outro Postgres para operar. O que precisamos é pequeno: Licença, ativação com limite, conferência, revogação e módulos.
- **API pública** (para as Instalações, em endereço próprio): `POST /v1/activate`, `POST /v1/check-in`, `POST /v1/deactivate`, `GET /v1/releases` e `GET /v1/releases/{versão}/bundle`. Limite de pedidos por Instalação e por IP; nenhuma resposta diz mais do que o necessário.
- **API interna** (só para a nossa área, com credencial estreita): emitir por venda, só com a transação conferida; suspender, revogar, reativar, estender a Manutenção; listar. A emissão por cortesia pede um segundo fator, toda emissão manda e-mail ao dono e há um teto por dia.
- **Tabelas:** `licenses` (o comprador, o produto, o máximo de Instalações, a situação, a Manutenção até, a venda de origem), `installations` (a Licença, o identificador, o endereço, produção ou teste, os módulos ligados, a situação, a primeira e a última conferência, as versões, o segredo da Instalação em hash, a sequência), `activation_keys` (uso único, validade de 24 horas), `license_events` (auditoria, com cada download) e `releases` (a versão, a data, o caminho do pacote, o resumo sha256, as notas, se é correção de segurança).
- **As chaves que assinam:** Ed25519, que o Node assina e confere sozinho (`node:crypto`). A raiz fica fora de servidor e assina a chave de emissão; o produto leva gravadas a raiz e uma raiz de reserva (§10).
- **A sequência:** cada conferência devolve um número sorteado que a Instalação guarda e apresenta na seguinte. Duas cópias usando a mesma Instalação passam a apresentar sequências diferentes e aparecem na tela Licenças. Uma restauração de backup legítima ressincroniza sozinha.
- **Venda repetida e assinatura:** a emissão é única por transação; na Manutenção por assinatura, cada cobrança tem transação nova e o mesmo código de assinatura, então a chave de repetição usa o código da assinatura.
- **Emissor fora do ar na hora da venda:** a venda fica registrada, o aviso da plataforma recebe resposta de sucesso e a emissão é refeita pela tarefa de minuto. A Hotmart reenvia até cinco vezes e desliga a configuração de quem responde com erro, então a resposta é decidida de propósito, não herdada.

### 11.3 Verificador (`src/server/licensing`)

| Arquivo | O que faz |
|---|---|
| `model.ts` (puro) | o formato da licença assinada, as situações e os degraus do §2.2, os prazos e o que cada degrau permite |
| `artifact.ts` (puro) | lê a licença e confere a assinatura com as chaves públicas gravadas |
| `client.ts` (`server-only`) | ativar, conferir e desativar no Emissor, com tempo limite e erros tipados, no molde de `src/server/ai/account-gateway.ts` |
| `store.ts` | a tabela `license_state` (uma linha: a licença assinada, o segredo e a sequência da Instalação, a última conferência, a última hora vista), só do servidor |
| `state.ts` | a situação guardada na memória do processo por alguns minutos e relida da tabela; a tarefa a renova. Uma memória só por renderização não serve, porque há rotas consultadas sem parar |
| `require-feature.ts` | `isFeatureEnabled` e `requireFeature`, a fonte única dos módulos ligados |
| tarefa `licenca-conferencia` | entra em `src/server/jobs/registry.ts`; roda no agendador de minuto e trabalha uma vez por dia, numa hora sorteada; uma falha de rede só marca a tarefa como falha e a licença guardada continua valendo |

- **O produto vendido sempre exige licença.** Isso é fixado quando a imagem é gerada, como já são `APP_VERSION` e as `NEXT_PUBLIC_*`; nenhuma variável de ambiente afrouxa a licença e o endereço do Emissor é fixo no produto. O desenvolvimento e os testes usam uma imagem gerada sem a exigência. Guarda nova: a imagem publicada, sem variáveis e sem licença, mostra só a tela de ativação.
- **As telas de vendedor** (Minhas licenças e Licenças) ligam por um módulo que só a nossa licença assinada traz.
- **O endereço:** o Verificador compara o endereço da licença com o endereço configurado da Instalação (o mesmo que monta os links dos e-mails e dos convites, obrigatório no kit) e com o endereço dos pedidos.
- **Admin limitado:** hoje as 175 ações do admin passam por `runAdminAction` (30 arquivos) e 21 rotas passam por `requireApiRole`, mas nenhum dos dois sabe se a chamada lê ou grava. Cada ação passa a declarar isso (e as rotas, pelo método), com uma guarda de teste que não deixa ação nova sem declaração.
- **Escola congelada:** `provisionStudentAccess` e `processSaleEvent` recusam matrícula nova; a venda fica guardada e reprocessável; reembolso e chargeback dos alunos da escola continuam sendo processados.
- **Onde a situação aparece:** na moldura do admin (a faixa, no molde do `PendingMigrationNotice`) e na tela Licença. Nenhuma página do aluno consulta a licença, fora a faixa do ambiente de teste.
- **Por que tabela própria e não `platform_settings`:** a `platform_settings` inteira entra no cache do catálogo que toda página do aluno lê.
- **Relógio:** a hora que vale é a maior entre o relógio, a última hora vista e a emissão da licença mais nova recebida. Licença emitida "no futuro" é recusada. Relógio que voltou sem uma conferência bem-sucedida conta como sem contato desde a última hora vista.
- **Variáveis novas:** a guarda `tests/infra-compose-env.guard.test.mjs` exige que toda variável do `.env.example` lida em `src/` chegue ao serviço da área no compose.

### 11.4 Os artefatos

| Artefato | O que é | Quem guarda |
|---|---|---|
| **Chave de ativação** | um código sorteado de 128 bits ou mais, com prefixo e dígito de conferência; uso único, vale 24 horas | aparece em Minhas licenças, dentro do comando |
| **Segredo da Instalação** | criado na ativação; identifica a Instalação nas conferências e nos downloads | a Instalação; o Emissor guarda só o hash |
| **Licença assinada** | um JSON com o número da Licença, o nome do comprador, o identificador e o endereço da Instalação, produção ou teste, os módulos, a Manutenção até, emitida em, vale até, a versão do formato e o identificador da chave; mais a assinatura | a Instalação, em `license_state` |
| **Pacote da versão** | a imagem do produto, os arquivos do compose e do Caddy, as migrações, os scripts, as instruções da IA e um manifesto assinado com o resumo de cada parte | o armazenamento dos pacotes |

### 11.5 Uma imagem para todos

Hoje não existe uma imagem que sirva a dois endereços. São fixados quando a imagem é gerada: o endereço do Supabase e a chave publicável (os `ARG NEXT_PUBLIC_*` do `Dockerfile`, que o Next grava nos pacotes do navegador e do servidor), as chaves do PostHog e do Sentry, as origens aceitas pelo otimizador de imagens (`src/lib/image-hosts.ts`), a permissão de câmera e microfone com o endereço do vídeo (`next.config.ts`, que nem é argumento do `Dockerfile`) e as 10 imagens da marca em `public/`. O deploy da nossa produção gera uma imagem com os endereços dela.

Três caminhos:

| Caminho | Como | Quando |
|---|---|---|
| Imagem por Instalação, gerada no nosso CI | o que o `deploy-membros` já faz; a equipe leva a imagem ao servidor | o lote fundador (até 10 compradores) |
| Marcador trocado na subida do contêiner | a imagem é gerada com marcadores no lugar dos valores, e um script os troca pelos valores da Instalação ao iniciar; é o que o Dockerfile oficial do Cal.com faz | candidato para a fase 2 |
| Configuração pública em tempo de execução | o servidor entrega a configuração ao navegador a cada página; as origens de imagem e a permissão da sala saem da geração | candidato para a fase 2 |

A escolha entre os dois últimos sai de um teste no primeiro dia da fase 2 (o comportamento do Next com as variáveis públicas ausentes e a saída para as origens de imagem). Gerar no servidor do comprador está descartado: entrega o código-fonte e pede 2 GB livres.

Guarda nova da imagem publicada: não contém `bunker707.com.br`, não contém mapa de fonte com o código original nem a pasta `src/`, e sobe duas escolas diferentes no ensaio.

### 11.6 Pacote da versão e migrações

- O pacote substitui o envio do repositório inteiro ao servidor. Guarda nova: o pacote não contém `src/`, `tests/`, `docs/`, `infra/cloud/` nem nada do Emissor.
- As migrações vão no pacote e são aplicadas por um migrador nosso, em `psql`, dentro do contêiner do banco, que grava no mesmo histórico da CLI do Supabase (`supabase_migrations.schema_migrations`). A nossa produção continua compatível e o servidor do comprador não precisa da CLI.
- As guardas de hoje conferem o histórico inteiro das migrações: nenhuma migração antiga pode ser movida, renomeada ou editada. A regra nova das migrações (§4) vale daqui para a frente.
- As imagens de terceiros do compose (as do Supabase e o Caddy) hoje são fixadas por etiqueta; no pacote passam a ser fixadas pelo resumo de cada uma.
- O registro do agendador de minuto (hoje em `infra/cloud/deploy.sh`) e a primeira conta da equipe (hoje `infra/cloud/equipe.sh`) passam para o instalador.
- **Entrega:** no lote fundador, a equipe leva. Na fase 2, o instalador baixa por link temporário, com a credencial da Instalação, e carrega a imagem com `docker load`; a assinatura é a do manifesto, conferida fora de qualquer registry. Um registry com credencial por Instalação fica para quando o tamanho dos downloads incomodar; já existem peças prontas para isso (o servidor de token `docker_auth` e o registry Zot). O GHCR, onde a imagem é publicada hoje, daria acesso de leitura por conta do GitHub de cada comprador, o que exige que o comprador tenha conta e token no GitHub.

### 11.7 Instalador e comando de operação

- **O que reaproveita:** `infra/scripts/bootstrap.sh`, o compose e o Caddy de `infra/compose`, o `generate-secrets`, o `deploy.sh` do servidor, o `smoke.sh`, o `backup.sh` e o `restore.sh`. **O que fica de fora:** tudo de `infra/cloud` (Hetzner, Cloudflare e GitHub Actions), `infra/terraform` e `infra/mautic`.
- **O que o `bootstrap.sh` precisa mudar para servidor de terceiros:** hoje ele para se não recebe uma chave SSH (em muitos provedores o servidor nasce com senha), fecha o login por senha, zera o firewall existente, deixa a porta 22 sem limite contando com o firewall da Hetzner, liga o reinício automático e só conhece o Ubuntu.
- **Cloudflare opcional:** o Caddy de hoje assume a Cloudflare na frente. No kit, ele tira o certificado direto e uma opção liga as faixas da Cloudflare para quem usa.
- **A conferência final** usa os endereços públicos, então o instalador confere o DNS e o certificado antes dela.
- **Sem perguntas:** tudo por opções ou por arquivo; `--conferir` roda só a conferência e `--simular` mostra o que faria.
- **Testes:** um teste de comportamento do instalador com a infra de mentira de `tests/fixtures`, um ensaio em máquina limpa no CI e os testes do compose que já existem (`tests/infra-compose.test.mjs` e `tests/infra-compose-env.guard.test.mjs`).

### 11.8 Guardas do add-on

Fonte única: `isFeatureEnabled("webinars")`. Os pontos, conferidos no código:

- as 8 páginas (3 do aluno e 5 do admin);
- as 24 rotas: das 21 do aluno, 15 passam por `guardRoomRequest` (`src/server/webinars/room-route.ts`), 5 chamam a sessão direto e a do calendário não tem sessão; mais as 3 do admin;
- os 3 webhooks do gravador e da sala;
- as 63 ações, todas por `runAdminAction` (`src/server/actions/run-action.ts`), que ganha uma opção de módulo;
- as 5 tarefas: a lista de `src/server/jobs/registry.ts` é uma constante montada sem leitura do banco e três testes conferem o texto dela; cada tarefa ganha um campo de módulo e é o agendador (`run-tick.ts`) que a pula;
- o menu do aluno (`src/lib/member-navigation.ts`), a faixa "Ao vivo agora" (`src/components/app-shell.tsx`) e a fileira da página inicial (`src/app/page.tsx`); passar os módulos ligados à moldura da área toca as 13 páginas que a montam, e dois testes fixam a lista do menu;
- o menu, a busca e o Hoje do admin, a aba da Comunicação, o atalho **Avisar** e as notificações antigas de live no sino;
- a regra **Participação em lives:** some do construtor de segmentos e é recusada na gravação. Com as tabelas vazias, a forma negada da regra ("não participou") combinaria com todos os alunos.

A ordem importa: o menu e a faixa somem junto com o bloqueio das rotas, para o navegador do aluno não bater num erro a cada minuto. Testes: uma guarda de arquitetura e um teste de comportamento com a licença sem o add-on; os testes de ponta a ponta ganham a variação "sem add-on".

### 11.9 Marca branca no código

A chave `school` em `platform_settings`; o título pelo modelo da moldura raiz, como o admin já faz; os e-mails da área (`src/server/email/templates` e `config.ts`, com o remetente obrigatório, sem padrão nosso) e os do login (`infra/compose/volumes/auth-templates` e os assuntos do compose, gerados pelo instalador); a cor por variável; as imagens neutras; o Modo TV lendo a Marca; as páginas de Termos e Privacidade; e a guarda `tests/marca-branca.guard.test.mjs`. Os identificadores técnicos (`bunker707:*` no navegador, o rótulo do guarda da sala, os cabeçalhos `X-Bunker-*`) ficam: são contratos com o motor de vídeo, com o gravador e com o navegador, invisíveis ao aluno, e mudá-los pede trocar os dois lados no mesmo deploy.

### 11.10 Da venda à Licença

- `sales_product_links` ganha uma coluna opcional com o produto de Licença: a mesma venda libera a aula (o alvo de hoje, que continua sendo um ou outro) e emite a Licença.
- `src/server/payments/process-sale.ts` ganha o passo de emissão, por um adaptador HTTP para o Emissor. A Licença fica presa ao vínculo da venda (`sale_grants`): reembolso e chargeback daquela venda chamam a revogação direto, sem a decisão por histórico que vale para os acessos dos alunos.
- Os adaptadores tratam hoje cinco avisos por plataforma (compra aprovada, fim da garantia ou retomada, reembolso, chargeback e cancelamento de assinatura). A Manutenção por assinatura pede tratar também a renovação, o atraso e a troca de plano. O Kiwify continua sem adaptador.
- **Minhas licenças** segue o molde de `src/app/minhas-compras`; **Licenças** segue o de Configurações › Vendas, com uma permissão nova só do dono.

### 11.11 Testes

Pelo `docs/18`: toda PR com teste de comportamento. Um teste por transição do §2.2 (ativa, Manutenção vencida, sem contato nos dias 8, 30 e 60, endereço trocado, revogada nos dias 0, 7 e 30, sem licença, relógio atrasado, assinatura inválida, regularizada); integração contra o banco local: ação de escrita recusada no Admin limitado, venda guardada e reprocessável na Escola congelada; ponta a ponta das telas; os testes próprios do Emissor (a venda aprovada emite uma Licença só, mesmo com aviso repetido; o reembolso revoga; a ativação além das vagas é recusada; desativar libera a vaga); e guardas: nenhuma variável de licença com `NEXT_PUBLIC_`, a situação lida só pelo módulo único, nenhuma página do aluno consultando a licença, e as guardas da imagem e do pacote (§11.5 e §11.6).

## 12. Fases e PRs

A ordem segue uma regra do desenho de lançar rápido: **só entra antes da primeira Instalação fora de casa o que não dá para acrescentar depois sem quebrar promessa** (o Verificador, a guarda do add-on, a marca mínima e o contrato). Colocar verificação de licença em quem já instalou sem ela foi o erro que o ACF reconheceu em 2023.

| Fase | O que entra | Pronta quando | Semanas |
|---|---|---|---|
| **0. Decisões e preparo** | as decisões do §13.2; o advogado e o contrato; o pedido no INPI; o nome e a marca; a consulta ao compliance da Hotmart e da Ticto; as chaves geradas, com a raiz guardada fora de servidor; a nossa produção religada | o contrato em redação, a resposta do compliance e a produção no ar | 1 a 2, junto com a fase 1 |
| **1. Lote fundador** | a marca branca mínima (§6); o Verificador em modo de observação e os degraus (§11.3); o Emissor, a venda que vira Licença, Minhas licenças e Licenças (§11.2 e §11.10); a guarda do add-on (§11.8); o kit inicial: o pacote, o migrador, o instalador rodado por nós, com a imagem gerada por Instalação | as situações do §2.2 reproduzidas em teste; uma compra de teste vira Licença e o reembolso revoga; a nossa escola roda como Instalação número 1; de 2 a 3 compradores fundadores instalados por nós em dois provedores, com o relatório do diagnóstico e uma restauração feita | 5 a 6 |
| **2. Instalação pelo comprador, com a IA** | uma imagem para todos (§11.5); o pacote baixado com a credencial da Instalação; o instalador de um comando e os ajustes do preparo do servidor (§11.7); o diagnóstico e os códigos de erro; o kit da IA (§3.3); o backup com destino genérico; um endereço só, se o teste passar; a cor, o ícone e as páginas legais; a aula | a mesma imagem sobe duas escolas; instalação do zero em três provedores (Hetzner, Contabo e Hostinger VPS); uma instalação feita pelo Claude Code e outra pelo Codex seguindo só as instruções do pacote; atualização e restauração ensaiadas | 4 a 5 |
| **3. Add-on à venda** | o kit do servidor de vídeo neutro de provedor, com a porta fechada; o gravador atrás de adaptador (§5.3); a marca nos textos de live; os produtos do add-on | uma live ao vivo num servidor de vídeo instalado pelo kit fora da Hetzner; a compra liga o módulo e o reembolso desliga | 2 a 3 |
| **4. Venda aberta** | o Emissor em servidor próprio; os alertas da tela Licenças com e-mail; outro provedor de e-mail além do Resend; as correções que o lote fundador trouxer; a página de venda | o fim do modo de observação; a primeira atualização entregue a todos os fundadores | 3 a 4 |

Total: de 15 a 20 semanas, com o lote fundador entrando por volta da 6ª à 8ª. Os três desenhos independentes estimaram 13, 20 e 27 semanas (20 com duas frentes ao mesmo tempo); esta proposta fica no meio, e o que não se acelera é o ensaio em servidor de verdade, o teste do produtor na `dev`, o compliance, o advogado e os fundadores. A fase 3 pode correr junto com a 2. Cada linha vira de 3 a 6 PRs para a `dev`, com teste de comportamento, no fluxo do `CONTRIBUTING.md`.

## 13. Decisões

### 13.1 Propostas

| # | Decisão | Por quê | O que muda se mudar |
|---|---|---|---|
| D1 | A unidade da Licença é a Instalação de produção, com uma de teste para cada uma | é o "site" dos plugins e a "instalação num domínio" do Kirby; não exige contar alunos nem mandar dados deles | licença por aluno ativo pede dados de alunos e acerto de contas periódico |
| D2 | Perpétua com 12 meses de Manutenção (A1) | "produto, não SaaS"; não obriga a congelar quem só não renova; casa com o pagamento único parcelado | assinatura anual pede congelar no vencimento e muda os produtos |
| D3 | O comprador recebe o produto compilado, nunca o código-fonte (A7) | o comprador típico não programa; sem o código não dá para reaproveitar nem manter versão paralela com conforto | entregar o código facilita a cópia e o suporte a versões alteradas |
| D4 | Emissor próprio e mínimo, em `services/bunker-licensing`, com banco próprio; servidor próprio na venda aberta | §11.2 | como módulo da área: mais rápido, mas a chave e as Licenças ficam junto do site público; Keygen: mais um sistema, ou dependência de fora |
| D5 | Licença assinada com Ed25519, conferida no servidor do comprador; raiz fora de servidor e chave de emissão trocável; vale 30 dias (10 nos primeiros dias) | padrão de Coder, Mattermost e Keygen; funciona com o Emissor fora do ar; cobre a chave perdida e a copiada | sem assinatura, qualquer servidor falso emitiria licenças |
| D6 | Conferência uma vez por dia, pela tarefa de minuto; nunca no caminho de um pedido | Metabase, Grafana, Directus e n8n renovam em segundo plano | conferir a cada pedido derrubaria as escolas junto com o Emissor |
| D7 | Três degraus (Aviso, Admin limitado, Escola congelada); o aluno que já está dentro nunca perde o acesso (A3) | regra a que os três desenhos chegaram; uma falha nossa nunca tira do ar a escola de quem está em dia | tirar a área do ar aumenta o risco jurídico e o de derrubar quem pagou |
| D8 | O Verificador confere o endereço da licença contra o endereço da Instalação | a cópia do servidor em outro domínio é pega sem depender do Emissor | sem isso, a cópia que não fala com o Emissor passa |
| D9 | O produto vendido sempre exige licença, fixado na geração da imagem; nenhuma variável afrouxa | o comprador é dono do servidor e do arquivo de configuração | um modo sem licença por variável desligaria tudo em minutos |
| D10 | Entrega: pela equipe no lote fundador; depois, pacote baixado com a credencial da Instalação e manifesto assinado; registry mais tarde | simples, sem serviço de registry para operar | registry próprio: downloads menores, mais um serviço 24 horas |
| D11 | Uma imagem para todos na fase 2; imagem por Instalação só no lote fundador | gerar por Instalação não escala e põe a equipe em toda atualização | §11.5 |
| D12 | Migrações no pacote, aplicadas por migrador próprio; regra escrita de só acrescentar; o banco nunca volta de versão | tira a CLI do Supabase do servidor do comprador; o comprador não sabe voltar versão | sem a regra, voltar a imagem pode deixar o banco à frente do produto |
| D13 | Instalador de um comando, sem perguntas, que continua de onde parou; mais o comando de operação | padrão de Coolify, Dokploy, Sentry e Ghost | |
| D14 | Um endereço só para a área e a API, se o teste da fase 2 passar; o painel do banco fora do kit | um registro de DNS em vez de dois; quem tem o painel do banco passa pelo Admin limitado | dois registros (área e API) |
| D15 | Kit da IA dentro do pacote: `AGENTS.md`, `CLAUDE.md` que o importa, skill, diagnóstico em JSON, códigos de erro, conta de operador | os padrões abertos existem; o que não pode falhar vira trava, não texto | |
| D16 | Webinários na mesma imagem, ligados pela Licença, por Instalação; as migrações deles sempre aplicadas | o mais barato de construir; é o desenho das edições Enterprise | segunda edição da imagem: protege mais o add-on e custa uma reforma no núcleo (§5.2) |
| D17 | Gravador atrás de adaptador, com **nenhum** por padrão | o de hoje depende do nosso GitHub e da nossa Hetzner | |
| D18 | Marca branca por configuração, com guarda de teste | o comprador não toca no código | |
| D19 | A conferência envia só a Licença, a Instalação, o endereço e as versões | LGPD e Marco Civil; o comprador é o controlador dos dados dos alunos | qualquer dado de aluno nos tornaria operadores |
| D20 | A venda vira Licença pelo caminho de vendas que já existe; tamanhos como produtos próprios; as telas de vendedor ligadas por módulo da nossa licença | reaproveita avisos, reprocesso e decisão por histórico; funciona sem mexer nos adaptadores | quantidade no checkout pede mudar os adaptadores e o que é guardado |
| D21 | A nossa escola é a Instalação número 1: o mesmo produto, o mesmo kit, Licença emitida por nós | toda versão passa por nós em produção antes de chegar ao comprador | |
| D22 | Sem atualização automática na primeira versão; o comprador roda **atualizar** | backup antes, migração e volta atrás são do nosso comando | |
| D23 | Verificador em modo de observação nos primeiros 60 dias do lote fundador | alarme falso não pode limitar quem pagou | |
| D24 | Licença antes de qualquer Instalação fora de casa | não dá para acrescentar verificação depois sem quebrar promessa | pilotos sem Verificador são o produto inteiro entregue sem controle |

### 13.2 Abertas para o produtor, com o padrão assumido

| # | Pergunta | Padrão assumido até a resposta |
|---|---|---|
| A1 | Licença perpétua com 12 meses de Manutenção, ou assinatura anual? | perpétua com 12 meses de Manutenção |
| A2 | Os tamanhos | Licença de 1, de 3 e de 10 Instalações, como produtos próprios; as compras somam; subir de tamanho pagando a diferença fica para depois |
| A3 | Licença revogada: o aluno que já está dentro mantém o acesso, ou a área sai do ar depois de um prazo? | mantém o acesso; a escola congela. A opção mais dura (área fora do ar, só com ordem assinada de revogação) depende do parecer do advogado |
| A4 | Os prazos do silêncio | aviso no 8º dia, Admin limitado no 30º, Escola congelada no 60º |
| A5 | Trocas de endereço por ano, sem falar com o suporte | 2 por Instalação, mesmo com a Manutenção vencida |
| A6 | Instalação de teste | uma para cada Instalação de produção, no mesmo domínio, até 20 alunos |
| A7 | O código-fonte nunca é entregue, ou existe um plano mais caro que entrega? | nunca, na primeira versão |
| A8 | A gravação das lives por hora vira um serviço nosso, por consumo? | não na primeira versão; o comprador grava no navegador ou envia a gravação |
| A9 | O nome do produto aparece na área do comprador? | não para o aluno; no admin aparece "Licenciado para" com o nome do comprador |
| A10 | Nome, marca e endereço do produto | uma marca nova e neutra, com domínio próprio e registro no INPI, decidida na fase 0 |
| A11 | Manutenção vencida: quem volta paga o tempo parado? Recebe correção de segurança por quanto tempo? | não paga o tempo parado; correções críticas da versão coberta por 6 meses |
| A12 | Agência pode instalar para os clientes dela? | não na primeira versão; proibido no contrato |
| A13 | O comprador pode usar o Supabase da nuvem no lugar do banco no próprio servidor? | não na primeira versão |
| A14 | Lote fundador: quantos, quem e em que condições | até 10, com instalação e atualizações feitas por nós e preço de fundador |
| A15 | Suporte: canal e prazo de resposta | pela nossa área de membros, em dias úteis; a definir |
| A16 | Advogado: quem revisa o contrato, as situações do §2.2, a opção dura da A3 e o arrependimento depois da instalação feita | contratar na fase 0; nenhuma oferta no ar sem o contrato |
| A17 | E-mail do comprador | Resend na fase 1; outros provedores na fase 4 |
| A18 | Onde ficam os pacotes e quanto pode custar por mês | o Bunny Storage, que já usamos; poucos reais por mês |
| A19 | Quando a nossa produção volta a ficar ligada 24 horas, e se o Emissor ganha servidor só dele | produção ligada antes do primeiro fundador; Emissor em servidor próprio na venda aberta (de EUR 6 a 20 por mês, conforme o estoque) |
| A20 | A Instalação manda também dados de saúde (tarefas rodando, idade do backup, disco) para avisarmos o comprador? | desligado; o comprador liga se quiser |
| A21 | Plataforma de venda | começar pela que aprovar no compliance primeiro |
| A22 | Tamanho de servidor prometido na página de venda | 4 GB no mínimo e 8 GB recomendados, dizendo o que foi medido |

### 13.3 O que fica de fora da primeira versão

Registry próprio; servidores com processador ARM; várias escolas numa mesma Instalação; o plano de agência; subir de tamanho pagando a diferença; a gravação hospedada por nós; o gateway de IA para login por conta (o Tutor IA funciona com a chave de API do comprador); o Mautic; a atualização automática; a ofuscação do código; a segunda edição da imagem para os Webinários; uma loja de add-ons; os catálogos de aplicativos dos provedores (a DigitalOcean aceita software comercial de terceiros).

## 14. Riscos

- **Suporte de servidor para leigos.** O comprador típico nunca administrou um servidor. O instalador, o diagnóstico e a IA reduzem, mas não zeram. Sem a regra do que é do produto e do que é do servidor do comprador (A15), o suporte engole o tempo da equipe. O lote fundador serve para medir isso antes da venda aberta.
- **Alarme falso do Verificador.** Limitar quem pagou é o pior erro deste desenho. O que segura: o modo de observação, os prazos longos, o **Verificar agora** e a extensão assinada.
- **Uma versão que quebra no servidor do comprador.** Cada servidor é um ambiente diferente. O que segura: backup antes de atualizar, volta atrás da imagem, a regra das migrações, a nossa escola primeiro (D21) e os fundadores antes da venda aberta.
- **O Emissor fora do ar, ou a chave que assina perdida ou copiada.** A tolerância de 30 dias e a extensão assinada cobrem a queda; a raiz fora de servidor e a chave de emissão trocável cobrem a perda e a cópia.
- **Falha de segurança no produto.** Passa a valer para todas as escolas que o rodam. Pede um canal para receber avisos, correção rápida e a regra da A11.
- **A verificação arrancada e publicada.** Aceito (§7). O que resta é o contrato, a lei e o trabalho refeito a cada versão.
- **Compliance da Hotmart e da Ticto.** Um "não" para software com licença muda o canal de venda, não o produto. A consulta é da fase 0.
- **Jurídico.** O texto das situações, o limite de responsabilidade e o arrependimento com a instalação feita dependem do advogado (A16).
- **Duas frentes com a mesma equipe.** A escola ainda não lançou e o produto pede de 15 a 20 semanas. A marca branca, o instalador e a atualização também servem à nossa própria produção; o Emissor e as telas de licença são só do produto.
- **O banco no servidor do comprador.** Troca de versão maior do Postgres e disco cheio são operações que o comprador não sabe fazer. Ficam como serviço e entram no diagnóstico (aviso de disco, de backup e de versão).
- **Estoque e preço de servidor.** A linha barata da Hetzner aparece sem estoque com frequência; o custo do nosso lado pode triplicar de um mês para o outro (§10).

## 15. Fontes

Lidas em 04/11/2026 e conferidas em 10/11/2026. Os resumos de cada frente, as notas de conferência, os três desenhos e o ataque ficaram no scratchpad da sessão que escreveu esta página.

- **Licenças em produtos instalados no servidor do cliente.** Coder: licença em arquivo assinado com Ed25519, conferida sem internet, com a lista de instalações aplicada (https://coder.com/docs/admin/licensing e https://github.com/coder/coder/blob/main/enterprise/coderd/licenses.go). Mattermost: licença assinada, carência de 10 dias no código, volta ao plano gratuito ao vencer, chave separada para ambiente que não é produção (https://github.com/mattermost/mattermost/blob/master/server/public/model/license.go e https://docs.mattermost.com/product-overview/self-hosted-subscriptions.html). GitLab: código de ativação ou arquivo, instância somente leitura ao vencer (https://docs.gitlab.com/administration/license_file/). Metabase: conferência a cada 12 horas, com 36 horas de tolerância, e volta à edição aberta sem o token (https://github.com/metabase/metabase/blob/master/src/metabase/premium_features/token_check.clj). n8n: chave de ativação de uso único por instância e renovação obrigatória a cada 10 dias (https://docs.n8n.io/hosting/configuration/environment-variables/licenses/). Directus: licença amarrada ao projeto e ao endereço público, conferida ao menos a cada 12 horas, estado bloqueado quando a licença cai com uso acima do plano básico, "a aplicação nunca apaga dados" (https://directus.com/docs/licensing/overview). Grafana: licença ligada ao endereço e renovada a cada 24 horas (https://grafana.com/docs/grafana/next/administration/enterprise-licensing/). Replicated: instância com licença vencida continua rodando, sem baixar imagens nem atualizar (https://docs.replicated.com/vendor/licenses-about). JetBrains: 30 dias sem internet e a licença perpétua de reserva (https://sales.jetbrains.com/hc/en-gb/articles/206544169 e https://sales.jetbrains.com/hc/en-gb/articles/207240845). Unraid: licença perpétua com um ano de atualizações e troca automática de dispositivo uma vez a cada 12 meses (https://docs.unraid.net/unraid-os/troubleshooting/licensing-faq/).
- **Ferramentas de licença.** Keygen: licença Fair Core, requisitos para rodar em casa, políticas, arquivos de licença assinados com validade e preços da nuvem, com o plano grátis até 100 licenças ativas (https://raw.githubusercontent.com/keygen-sh/keygen-api/master/LICENSE.md, https://keygen.sh/docs/self-hosting/, https://keygen.sh/docs/api/policies/, https://keygen.sh/docs/api/cryptography/ e https://api.keygen.sh/v1/plans?limit=100). Cryptlex, LicenseSpring, 10Duke e Replicated: preços (https://cryptlex.com/pricing, https://licensespring.com/pricing, https://www.10duke.com/resources/faq/ e https://www.replicated.com/pricing). Assinatura Ed25519 nativa do Node (https://nodejs.org/api/crypto.html).
- **Hotmart e Ticto.** Formatos de produto e área de membros externa da Hotmart (https://suportehotmart.zendesk.com/hc/pt-br/articles/360016600591 e https://suportehotmart.zendesk.com/hc/pt-br/articles/215827858); webhook 2.0.0 (https://developers.hotmart.com/docs/en/2.0.0/webhook/purchase-webhook/); planos de assinatura, oferta adicional do checkout e política de uso (https://help.hotmart.com/pt-br/article/208424858, https://help.hotmart.com/pt-br/article/360019967392 e https://hotmart.com/pt-br/legal/politicas-de-uso). Ticto: webhook v2 e reembolso (https://webhook.ticto.dev/docs/v2, https://help.ticto.com.br/sou-produtor/tictools-integracoes/webhook e https://help.ticto.com.br/comprei-pela-ticto/reembolsos-e-suporte/solicitar-reembolso-prazo-e-regras-do-termo-geral-de-compra).
- **Entrega das versões.** GHCR: token pessoal clássico e acesso de leitura por conta (https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry); registry oficial com servidor de token (https://distribution.github.io/distribution/spec/auth/token/), o servidor de token `docker_auth` (https://github.com/cesanta/docker_auth) e o registry Zot (https://zotregistry.dev/v2.1.23/articles/authn-authz/); `docker save` e `docker load` (https://docs.docker.com/reference/cli/docker/image/save/); o marcador trocado na subida do contêiner, no Cal.com (https://raw.githubusercontent.com/calcom/cal.com/main/scripts/replace-placeholder.sh), e o que o Next diz sobre variáveis públicas (https://nextjs.org/docs/app/guides/self-hosting).
- **Instaladores de um comando.** Coolify (https://coolify.io/docs/get-started/installation e https://coolify.io/docs/get-started/upgrade), Dokploy (https://docs.dokploy.com/docs/core/installation), Supabase no próprio servidor (https://supabase.com/docs/guides/self-hosting/docker), Sentry (https://develop.sentry.dev/self-hosted/ e https://github.com/getsentry/self-hosted/blob/master/install.sh), Discourse (https://github.com/discourse/discourse/blob/main/docs/INSTALL-cloud.md) e Ghost (https://docs.ghost.org/ghost-cli/). O fork ativo do Watchtower (https://github.com/nicholas-fedor/watchtower/releases). Hospedagem compartilhada sem acesso de administrador (https://www.hostgator.com/help/article/hosting-comparison-chart) e os modelos de VPS da Hostinger (https://www.hostinger.com/support/vps/vps-os-and-templates/). Preços da Hetzner em 10/11/2026 (https://www.hetzner.com/cloud/cost-optimized/).
- **Instalação por IA.** `AGENTS.md` (https://agents.md/), como o Codex e o Claude Code o leem (https://learn.chatgpt.com/docs/agent-configuration/agents-md e https://code.claude.com/docs/en/memory), o formato de skills (https://agentskills.io/specification), as boas práticas do Claude Code para o que não pode falhar (https://code.claude.com/docs/en/best-practices) e a skill de instalação da Kodus (https://github.com/kodustech/kodus-installer).
- **Proteção do código e quem convive com cópias.** Ofuscação: "a saída ainda é JavaScript", de 15 % a 80 % mais lenta (https://github.com/javascript-obfuscator/javascript-obfuscator); bytecode não é cifra (https://github.com/bytenode/bytenode). Sidekiq: código entregue, credencial do servidor de pacotes ligada à assinatura (https://github.com/sidekiq/sidekiq/wiki/Commercial-FAQ). Laravel Nova: código entregue por repositório autenticado pela licença e conferência do endereço de produção (https://nova.laravel.com/docs/v5/installation). Plugins de WordPress quando a licença vence: WP Rocket (https://docs.wp-rocket.me/article/1711-what-happens-if-my-license-expires), Gravity Forms (https://docs.gravityforms.com/license-expiry/), ACF, que passou a exigir a licença em 2023 (https://www.advancedcustomfields.com/?p=444079), e Elementor (https://elementor.com/help/what-happens-to-my-site-if-i-cancel-elementor-pro/).
- **Modelo comercial.** Gravity Forms, ACF, WP Rocket e Elementor: preços por número de sites (https://www.gravityforms.com/pricing/, https://www.advancedcustomfields.com/pro/, https://wp-rocket.me/pricing/ e https://elementor.com/pricing/); Kirby e Yoast: quantidade com desconto por volume (https://getkirby.com/buy e https://yoast.com/wordpress/plugins/seo/); Craft: licença perpétua com um ano de atualizações e renovação perto de 20 % (https://craftcms.com/knowledge-base/how-craft-licenses-and-renewals-work); instalação por preço fixo: Discourse e Literate Computing (https://meta.discourse.org/t/what-does-one-time-install-include/21488 e https://www.literatecomputing.com/services/discourse-installation-services/); Odoo: pacotes de horas (https://www.odoo.com/pricing-packs); Mattermost Calls: gravação que exige servidor próprio do cliente (https://docs.mattermost.com/deployment-guide/calls/calls-deployment-guide).
- **Lei brasileira.** Lei 9.609/1998 e Lei 9.610/1998 (https://www2.camara.leg.br/legin/fed/lei/1998/lei-9609-19-fevereiro-1998-364738-publicacaooriginal-1-pl.html e https://www2.camara.leg.br/legin/fed/lei/1998/lei-9610-19-fevereiro-1998-365399-publicacaooriginal-1-pl.html); Código de Defesa do Consumidor e Decreto 7.962/2013 (https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-publicacaooriginal-1-pl.html e https://www2.camara.leg.br/legin/fed/decret/2013/decreto-7962-15-marco-2013-775557-publicacaooriginal-139266-pe.html); Marco Civil (https://www2.camara.leg.br/legin/fed/lei/2014/lei-12965-23-abril-2014-778630-publicacaooriginal-143980-pl.html); guia de agentes de tratamento da ANPD (https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/Segunda_Versao_do_Guia_de_Agentes_de_Tratamento_retificada.pdf); registro de programa no INPI (https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/guia-basico). Licenças abertas citadas: Elastic License 2.0 (https://www.elastic.co/licensing/elastic-license), Fair Core License (https://fcl.dev/) e PolyForm (https://polyformproject.org/licenses/internal-use/1.0.0).
- **Repositório.** `AGENTS.md`, `CONTRIBUTING.md`, `Dockerfile`, `.dockerignore`, `next.config.ts`, `infra/compose`, `infra/scripts`, `infra/cloud`, `infra/jitsi`, `services/bunker-ai-gateway`, `src/proxy.ts`, `src/lib/image-hosts.ts`, `src/server/actions/run-action.ts`, `src/server/payments`, `src/server/jobs`, `src/server/webinars`, `src/server/member-area`, `src/server/email`, `supabase/migrations`, `docs/05`, `docs/13`, `docs/18`, `docs/19`, `docs/20`, `docs/21`, `docs/30` e `docs/31`.

## 16. O que ficou sem rodar

A sessão de 10/11/2026 bateu no limite semanal de uso no meio do trabalho. Fica registrado o que foi e o que não foi feito, para ninguém ler esta página como mais conferida do que é:

- **Feito:** as oito pesquisas; a conferência das oito, com as correções aplicadas aqui; os três desenhos (o de simplicidade para o comprador parou antes das fases e das decisões); e o ataque no papel de quem quer piratear, com as mudanças aplicadas (§2.2, §7, §10 e §11.3).
- **Não rodou:** o ataque nos papéis de comprador honesto (o que dá errado para quem instala numa VPS comum), de engenheiro deste repositório (a viabilidade do §11 e as estimativas do §12) e de jurídico e comercial (o §9 e o §8 contra a lei e contra as plataformas); e o painel de juízes sobre os três desenhos, cuja comparação foi feita por quem escreveu esta página.
- **Ainda não foi testado em máquina:** nada do §11 foi construído. Os pontos que dependem de teste antes de virar promessa estão marcados no texto: um endereço só (D14), o caminho da imagem única (§11.5), os 15 minutos de instalação (§1.4) e os números de carga (§3.1).
