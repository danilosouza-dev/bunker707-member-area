# Padroes de engenharia e repositorio

## Repositorio

O projeto deve viver em um unico repositorio privado no GitHub, contendo a area de membros do aluno e o CMS/admin. O repositorio representa um produto unico, com fronteiras internas claras entre experiencia do aluno, conteudo, acesso, pagamentos externos, progresso, suporte e administracao.

## Branch principal

- `main` e a branch principal e e a producao: so ela vai para o servidor da Hetzner (etapa `deploy-membros`, que recusa outra branch).
- `dev` e o ambiente de teste: a Vercel a publica com o Supabase da nuvem, so com contas criadas pela equipe; tudo passa por ela antes da `main` (ambientes e fluxo em `CONTRIBUTING.md`, decisao de 19/10/2026).
- Mudancas devem entrar por branches curtas e pull requests.
- A branch `main` deve estar sempre em estado publicavel.
- GitHub branch protection deve ser habilitado quando o plano da conta permitir; ate la, a protecao fica no processo operacional de PR, CI e verificacao local.

## Commits

Use Conventional Commits para manter historico rastreavel:

- `feat`: nova capacidade de produto;
- `fix`: correcao de comportamento;
- `docs`: documentacao;
- `refactor`: reorganizacao sem alterar comportamento esperado;
- `test`: cobertura de teste;
- `chore`: manutencao;
- `ci`: pipeline e automacoes;
- `build`: dependencias ou configuracao de build;
- `perf`: melhoria de performance;
- `revert`: reversao explicita.

Exemplos:

```txt
feat: adicionar pagina minhas compras
fix: corrigir overlay de card bloqueado
docs: documentar padroes de engenharia
ci: adicionar pipeline de verificacao
```

## Verificacao

Antes de abrir ou mesclar PR:

```bash
npm run verify
```

Esse comando cobre lint, typecheck, testes automatizados e build e termina com a regua do pedaco do cartao Livre (`npm run livre:medir`, `scripts/livre-medir-cartao.mjs`): depois do build, ela mede o que o aluno baixa a mais quando o pop-up e Livre e falha acima de 12 KB (12.288 B gzip). O teto e as cotas de cada entrega estao no `docs/27` §7; uma PR que mexe no cartao Livre escreve la o antes e o depois, medidos na mesma pasta.

Alteracoes em acesso, persistencia ou navegacao devem incluir teste de regressao que prove a invariante afetada. Para mudancas perceptiveis no browser, o gate de codigo nao substitui uma validacao autenticada da rota, do console e da requisicao real.

Como escrever esses testes, onde cada um fica, como rodar e a rotina de PR estao em `docs/18-padrao-de-testes.md`. Em resumo:

- toda PR `feat` ou `fix` traz teste de comportamento do que mudou: unitario com dubles (`tests/*.test.mjs`), integracao contra o Supabase local (`tests/integration/`) ou ponta a ponta com Playwright (`tests/e2e/`), pela regra de bolso do docs/18;
- correcao traz um teste que falhava antes e passa depois;
- acesso, progresso, gravacao ou navegacao: integracao obrigatoria; tela ou fluxo novo do aluno ou do produtor: um ponta a ponta do caminho principal;
- teste que so confere texto do codigo-fonte por expressao regular nao conta como teste de regressao de comportamento; so entra como guarda de regra de arquitetura, em `*.guard.test.mjs`;
- sem teste, so com justificativa escrita na PR e pendencia anotada no mapa de cobertura do docs/18.

O CI roda dois jobs em toda PR e push para `dev` e `main`: Verify (`npm run verify`, com a regua do cartao Livre no fim) e Integracao e ponta a ponta (Supabase local em Docker, migracoes do zero, escola de teste, `npm run test:integration` e `npm run test:e2e`). `npm run verify:full` roda tudo isso localmente. Os testes com banco so rodam contra o Supabase local, nunca contra o projeto compartilhado.

## Organizacao de produto

- A experiencia do aluno vem antes do admin/professor.
- O CMS faz parte do mesmo produto e do mesmo repositorio, mas deve manter codigo modular.
- Regras de acesso ficam separadas de parsers de provedores de pagamento.
- Entitlements internos sao a fonte de verdade para acesso.
- Dados de runtime devem vir do Supabase real. Nao usar seed automatico, mock, fixture ou fallback local para catalogo, alunos, acessos, aulas, progresso, favoritos ou configuracoes.
- Leituras do aluno devem ser filtradas pela identidade autenticada antes de montar o modelo de pagina.
- Escritas devem ser granulares; e proibido sincronizar ou regravar o snapshot completo da plataforma para alterar uma entidade.
- `platform_settings` e gravada uma chave por vez e com versao: telas novas usam `writePlatformSettingGuarded` (`src/server/member-area/settings-store.ts`), que so grava se `updated_at` continua o que a tela leu (senao, 409); quem grava por outro caminho carimba `updated_at` na mesma gravacao. A tabela nao tem gatilho para isso.
- A checagem de versao fica no proprio UPDATE (`.eq("updated_at", lida)`), nunca em "le, confere e depois grava": entre conferir e gravar outra tela pode gravar (a rota da Vitrine fazia isso e perdia a fileira ligada em Modulos). A resposta devolve a versao desta gravacao, nunca uma releitura. Quem muda so parte de uma chave sem ter versao na tela (aparencia do admin antigo) usa `updatePlatformSettingLatest`: rele na hora (depois de qualquer trabalho demorado, como enviar imagem), aplica a mudanca e grava com a versao lida, tentando de novo uma vez.
- Endereco vindo do banco dentro de CSS (`background-image`) passa por `cssImageUrl` (`src/lib/css-url.ts`: entre aspas e escapado), e link de imagem colado e validado por `imageLinkSchema` (https, sem espaco, aspas, parenteses, `<`, `>` ou `\`). Destino de redirecionamento vindo do endereco (`?next=`) passa por `getSafeRedirectPath`, que monta com o parser de URL e exige a mesma origem (`/\host` vira outro site no navegador).
- Regra de acesso de aula deve ser centralizada e reutilizada por progresso, comentarios, reacoes e denuncias.
- APIs do Tutor IA devem reutilizar a mesma regra central de acesso, validar ownership da conversa e selecionar contexto somente da transcricao ativa da aula autorizada.
- Chaves de provedores de IA pertencem ao Vault/servidor; respostas administrativas podem expor apenas metadados e os ultimos quatro caracteres.
- Importacao de transcricao deve ser idempotente por checksum, versionada e feita no cadastro/revisao da aula, nunca novamente a cada pergunta do aluno.
- Binarios e Data URLs nao pertencem a colunas de dominio nem ao HTML; persistir assets no Storage apropriado e guardar somente a referencia.

## Limites arquiteturais

- Componentes e stores acima de aproximadamente 1.000 linhas devem ser tratados como candidatos a decomposicao por dominio, sem criar abstracoes vazias.
- Novas regras nao devem aumentar `lesson-experience.tsx` ou `platform-store.ts` quando puderem viver em modulo de dominio testavel (ex.: `src/server/students/`).
- Refatoracoes desses arquivos devem ser incrementais e acompanhadas por testes de contrato para evitar regressao visual ou de persistencia.

- Links para paginas por aluno (aula, progresso, perfil) usam o prefetch padrao do Next; nunca `<Link prefetch>` (prefetch cheio), que guarda a pagina por ate 5 min no navegador e mostra estado velho. O teste `tests/member-area-link-prefetch.test.mjs` guarda essa regra nos cards que levam a aula.

## Desenvolvimento em volume externo

Em volumes ExFAT no macOS, arquivos AppleDouble e blocos de alocacao grandes podem tornar `node_modules`, `.next`, lint e compilacao desnecessariamente lentos.

Com o repositorio em volume APFS (situacao atual), `next dev` usa o Turbopack padrao do Next 16 (o `package.json` ja foi ajustado); a observacao sobre Webpack abaixo vale apenas para volumes exFAT.

- usar Webpack no `next dev`: o banco de persistencia do Turbopack pode falhar nesse volume com `Failed to open database`;
- manter `.next` fisicamente dentro do workspace nesta versao do Next. Um symlink para fora do projeto separa os contextos internos de `AsyncLocalStorage` e quebra o prerender com `Expected workStore to be initialized`;
- `node_modules` pode usar APFS ou link simbolico local quando necessario, desde que o root do Turbopack seja resolvido para o projeto;
- excluir ajustes locais apenas em `.git/info/exclude` quando a configuracao for especifica da maquina;
- remover `._*` gerados pelo macOS e garantir que nunca sejam versionados;
- nao transformar esse ajuste local em dependencia obrigatoria para CI ou outros colaboradores.

## Seguranca operacional

- Nao commitar `.env`, chaves, tokens, dumps, payloads privados ou dados pessoais reais.
- Service keys nunca devem entrar em codigo client-side.
- Webhooks devem ser tratados como nao confiaveis ate validacao.
- Processamento de webhook deve ser idempotente e auditavel.
- Video deve ser servido por plataforma propria de video, nao pelo servidor da aplicacao.
