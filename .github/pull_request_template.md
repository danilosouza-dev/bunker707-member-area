## Resumo

-

## Testes (docs/18-padrao-de-testes.md)

- [ ] Esta PR traz teste de comportamento do que mudou: unitario, integracao ou ponta a ponta, pela regra de bolso do docs/18 (secao 2.2)
- [ ] Se e correcao: o teste falhava antes e passa agora
- [ ] Se mexe em acesso, progresso, gravacao ou navegacao: tem teste de integracao
- [ ] Se e tela ou fluxo novo do aluno ou do produtor: tem um ponta a ponta do caminho principal
- [ ] Sem teste? Explique aqui por que e atualize o mapa de cobertura do docs/18 (secao 3):

## Verificacao

- [ ] `npm run verify` verde (lint, tipos, unitarios, build)
- [ ] CI verde nos dois jobs: Verify e Integracao e ponta a ponta (Supabase local)

## Checklist

- [ ] Mantem a experiencia do aluno como prioridade do MVP
- [ ] Preserva entitlements internos como fonte de verdade de acesso
- [ ] Nao adiciona segredos, tokens, payloads privados ou dados pessoais reais (nem nos dados de teste)
- [ ] Atualiza documentacao quando muda regra, decisao ou fluxo duravel
- [ ] Migracao nova que o app usa aplicada no Supabase da nuvem antes do merge na dev (docs/21 §9)
