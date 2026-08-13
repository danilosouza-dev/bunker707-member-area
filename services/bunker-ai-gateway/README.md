# Bunker AI LB

Servico persistente do Tutor IA para conectar contas, renovar tokens e traduzir
os protocolos de Gemini, Claude e Codex. O escalonamento pertence ao backend do
Bunker707: cada requisicao inclui uma credencial especifica em
`X-Bunker-Auth-ID`, e o gateway executa somente naquela conta.

## Por que existe um patch

O upstream CLIProxyAPI possui internamente o suporte a credencial fixada, mas a
API HTTP publica nao o expoe. Este servico fixa a revisao `v7.2.80` pelo commit
`09da52ad509e2c18e7b9540db3b98c2214c280aa` e aplica um patch minimo que le o
cabecalho privado. Isso permite que prioridade, round-robin, cooldown, saude e
fallback sejam decididos e auditados pelo Bunker707.

## Configuracao local

O Docker Desktop precisa estar aberto. Os dois arquivos de ambiente abaixo sao
locais, cobertos pelo `.gitignore` e nunca devem ser commitados.

No `.env.local` do Next.js:

```env
BUNKER_AI_GATEWAY_URL=http://127.0.0.1:8317
BUNKER_AI_GATEWAY_API_KEY=<chave-runtime-url-safe-com-32-ou-mais-caracteres>
BUNKER_AI_GATEWAY_MANAGEMENT_KEY=<chave-management-distinta>
```

No `.env.bunker-ai-gateway.local` do container:

```env
BUNKER_AI_GATEWAY_API_KEY=<a-mesma-chave-runtime-do-next>
MANAGEMENT_PASSWORD=<a-mesma-chave-management-do-next>
```

As duas credenciais precisam ser URL-safe, ter pelo menos 32 caracteres e ser
diferentes. A porta interna e fixa em `8317`. O Compose publica somente
`127.0.0.1:8317`, remove capabilities, limita recursos e logs, impede elevacao
de privilegios e monta um volume persistente em `/data/auth`.

## Operacao

A partir da raiz do repositorio:

```bash
npm run ai-gateway:up
npm run ai-gateway:status
npm run ai-gateway:smoke
npm run ai-gateway:logs
```

`ai-gateway:up` constroi a revisao fixada e inicia o servico. O smoke test
confirma runtime autenticado, gestao autenticada e bloqueio de gestao anonima.
Depois de alterar qualquer variavel do gateway, reinicie tambem o Next.js para
que ele releia o ambiente.

Para parar o gateway sem apagar as contas:

```bash
npm run ai-gateway:down
```

O comando preserva o volume nomeado `bunker707-ai-gateway-auth`. Remover esse
volume apaga os logins e exige conectar todas as contas novamente.

## Conectar uma conta

Com o gateway e o Next.js ativos:

1. abra `Configuracoes > Integracoes > Contas conectadas`;
2. escolha Gemini, ChatGPT/Codex ou Claude e clique em `Conectar conta`;
3. informe um nome, abra o login e autentique no provedor;
4. ao terminar, copie a URL local completa que ficou no navegador;
5. cole essa URL no modal da Bunker707 e conclua;
6. em `Modelos e limites`, escolha um dos modelos de texto detectados no
   gateway e salve a politica do provedor;
7. use `Testar conexao` antes de colocar a conta no pool do Tutor.

Cada provedor pode ter uma ou varias contas. A Bunker707 decide qual conexao
responde, registra o consumo por conexao e usa as demais conforme prioridade,
saude, cooldown e fallback.

## Producao e seguranca

- `BUNKER_AI_GATEWAY_API_KEY`: chave usada somente pelo backend para inferencia.
- `MANAGEMENT_PASSWORD`: chave distinta usada para OAuth e administracao.
- porta HTTP interna: fixa em `8317` para manter Compose, healthcheck e Next.js
  no mesmo contrato.
- `/data/auth`: precisa de storage persistente, privado, criptografado e com
  backup controlado.
- fora de localhost, o gateway deve usar HTTPS e rede privada ou allowlist; a
  porta nunca deve ser publicada diretamente para alunos ou para a internet.
- o endpoint upstream `/v0/management/oauth-callback` valida o `state`, mas nao
  passa pelo middleware da chave de gestao. Por isso rede privada/allowlist e
  obrigatoria em producao, nao apenas uma recomendacao.
- o painel administrativo do upstream permanece desativado.
- o Compose deste repositorio operacionaliza somente o desenvolvimento local.
  Um Next.js implantado nao alcanca `127.0.0.1` deste Mac; producao exige um
  gateway persistente na mesma rede privada do backend, com HTTPS interno,
  volume criptografado, backup e politicas de acesso.

O uso de login por assinatura pessoal e experimental e depende dos termos,
limites e disponibilidade de cada provedor. Ele nao transforma um plano de
consumidor em cota oficial de API. A integracao oficial por API continua sendo a
rota suportada para operacao comercial previsivel.
