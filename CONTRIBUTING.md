# Contributing

Este repositorio privado concentra a area de membros Bunker707 e o CMS. O padrao e tratar cada mudanca como entrega de produto: pequena, revisavel, testavel e documentada quando mudar uma decisao duravel.

## Fluxo

1. Criar uma branch a partir de `dev` (a `main` so recebe a promocao da `dev`, por PR, depois do ok no chat).
2. Manter o escopo pequeno e alinhado ao MVP atual.
3. Escrever o teste de comportamento do que mudou (secao Testes abaixo).
4. Rodar `npm run verify` antes de abrir PR ou pedir merge. O CI roda tambem integracao e ponta a ponta; para rodar tudo local, `npm run verify:full` (precisa do Docker aberto e de `npm run db:start`).
5. Abrir PR para `dev` usando o template do repositorio, com o checklist de testes preenchido.
6. Atualizar `README.md`, `docs/` ou `AGENTS.md` quando uma regra, decisao ou fluxo mudar.

GitHub branch protection deve ser habilitado para `main` quando o plano da conta permitir. Enquanto isso, trate PR + CI + `npm run verify` como regra operacional obrigatoria.

## Branches

Use nomes curtos e descritivos:

- `feat/minhas-compras`
- `fix/card-bloqueado`
- `docs/padroes-repositorio`
- `chore/ajuste-ci`

## Commits

Use Conventional Commits:

```txt
feat: adicionar busca do aluno
fix: corrigir estado de aula bloqueada
docs: documentar padrao de webhooks
refactor: separar regra de acesso do parser de pagamento
test: cobrir progresso da aula
chore: atualizar dependencias
ci: ajustar pipeline de verificacao
```

Tipos permitidos: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` e `revert`.

## Qualidade

O comando padrao de verificacao e:

```bash
npm run verify
```

Ele executa lint, typecheck, testes unitarios e build. O CI roda esse comando e, em paralelo, a integracao e a ponta a ponta com o Supabase local; os dois jobs precisam estar verdes para a PR entrar. Para iterar mais rapido durante o desenvolvimento:

```bash
npm run lint
npm run typecheck
npm test
```

## Testes

O padrao de testes (tipos, onde cada um fica, como rodar, dados de teste e a rotina) esta em [docs/18-padrao-de-testes.md](docs/18-padrao-de-testes.md). Em resumo:

- toda PR de funcionalidade ou correcao traz teste de comportamento do que mudou (unitario, integracao ou ponta a ponta, conforme a regra de bolso do doc);
- correcao traz um teste que falhava antes e passa depois;
- conferir texto do codigo-fonte com expressao regular nao e teste de comportamento; so vale como guarda de regra de arquitetura, em arquivo `.guard.test.mjs`;
- sem teste, so com justificativa escrita na PR e pendencia anotada no mapa de cobertura do doc.

Onde cada tipo fica e como rodar:

```bash
npm test                    # unitarios (tests/*.test.mjs), sem banco; e o que roda no pre-commit
npm run db:start            # Supabase local em Docker: migracoes do zero, .env.test.local e escola de teste
npm run test:integration    # tests/integration/, contra o banco local
npm run test:e2e            # tests/e2e/, Playwright em Chromium e WebKit (uma vez: npx playwright install chromium webkit)
npm run verify:full         # verify + integracao + ponta a ponta (o que o CI faz)
npm run db:stop
```

Os testes de integracao e ponta a ponta so rodam contra o Supabase local (ha uma trava para isso): nunca contra o projeto compartilhado de dev/producao, e nunca com dados de pessoa real.

## Seguranca

- Nunca commitar `.env`, tokens, chaves de servico, payloads privados ou dados pessoais reais.
- Dados de pagamento vindos de provedores externos sao entrada, nao fonte final de autorizacao.
- A fonte de verdade de acesso deve continuar sendo o modelo interno de entitlements.
- Webhooks devem ser validados, idempotentes e auditaveis antes de liberar acesso real.
