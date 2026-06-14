# Padroes de engenharia e repositorio

## Repositorio

O projeto deve viver em um unico repositorio privado no GitHub, contendo a area de membros do aluno e o CMS/admin. O repositorio representa um produto unico, com fronteiras internas claras entre experiencia do aluno, conteudo, acesso, pagamentos externos, progresso, suporte e administracao.

## Branch principal

- `main` e a branch principal.
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

Esse comando cobre lint, typecheck, testes automatizados e build.

## Organizacao de produto

- A experiencia do aluno vem antes do admin/professor.
- O CMS faz parte do mesmo produto e do mesmo repositorio, mas deve manter codigo modular.
- Regras de acesso ficam separadas de parsers de provedores de pagamento.
- Entitlements internos sao a fonte de verdade para acesso.
- Dados mockados sao aceitaveis em prototipos UI-first, desde que estejam isolados.

## Seguranca operacional

- Nao commitar `.env`, chaves, tokens, dumps, payloads privados ou dados pessoais reais.
- Service keys nunca devem entrar em codigo client-side.
- Webhooks devem ser tratados como nao confiaveis ate validacao.
- Processamento de webhook deve ser idempotente e auditavel.
- Video deve ser servido por plataforma propria de video, nao pelo servidor da aplicacao.
