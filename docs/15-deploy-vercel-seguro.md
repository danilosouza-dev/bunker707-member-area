# Deploy seguro na Vercel

Este documento descreve o ambiente inicial de producao da area de membros Bunker707. A Vercel executa o Next.js; Supabase continua responsavel por Auth, Postgres e capas publicas; videos permanecem em provedor externo.

## Fronteiras de seguranca

- `NEXT_PUBLIC_SUPABASE_URL` e a chave publica/anonima podem chegar ao navegador. A seguranca desses acessos depende de RLS e privilegios SQL corretos.
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY` sao segredos exclusivos do servidor. Nunca usar prefixo `NEXT_PUBLIC_`, colar em codigo, enviar ao navegador ou incluir em logs.
- previews com codigo nao confiavel nao devem receber a service role de producao. No repositorio privado atual, limitar os segredos ao ambiente `Production`; criar um Supabase separado antes de liberar previews para colaboradores externos.
- o Bunker AI Gateway precisa estar online em HTTPS e protegido pelas chaves distintas de runtime e gestao. Ele nao roda dentro deste deploy Next.js e nao pode apontar para `localhost`.
- capas em `content-assets` sao publicas por decisao de produto. Video, materiais privados, payloads de webhook e documentos de alunos nao pertencem a esse bucket.

## Checklist Supabase obrigatorio

1. Confirmar o projeto correto pelo ref `zbvzfmdjtbibxhkvoeuv`.
2. Aplicar todas as migrations versionadas e conferir as duas colunas da listagem:

   ```bash
   supabase link --project-ref zbvzfmdjtbibxhkvoeuv
   supabase db push --linked
   supabase migration list --linked
   ```

3. Em Authentication, desabilitar criacao publica de usuarios. Convites e criacao administrativa continuam sendo os fluxos de entrada.
4. Exigir senha minima de oito caracteres, manter protecao contra senhas vazadas quando disponivel e revisar limites de tentativa.
5. Em URL Configuration, usar a URL HTTPS canonica da Vercel como Site URL e autorizar exatamente `https://DOMINIO/auth/callback`. Nao usar wildcard amplo em producao.
6. Rodar Database Linter/Security Advisors. Nenhuma tabela exposta pode ficar sem RLS e `anon`/`authenticated` nao podem ler catalogo interno, aulas ou `video_config` diretamente.
7. Confirmar que funcoes `SECURITY DEFINER` fixam `search_path` e concedem execucao somente aos papeis realmente necessarios.
8. Conferir o bucket `content-assets`: publico, limite de 8 MB e apenas JPEG, PNG e WebP.
9. Criar um usuario de teste por convite, validar isolamento de perfil/entitlements e remove-lo depois do teste.

O deploy nao esta liberado quando a migration de hardening existe apenas no Git. O estado remoto e a fonte de verdade operacional.

## Variaveis na Vercel

Configurar no minimo no ambiente `Production`, sem copiar valores para logs ou PRs:

| Variavel | Exposicao | Obrigatoria |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | navegador | sim |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ou `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador | sim |
| `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` | servidor | sim |
| `BUNKER_AI_GATEWAY_URL` | servidor | para agentes por conta |
| `BUNKER_AI_GATEWAY_API_KEY` | servidor | para runtime do gateway |
| `BUNKER_AI_GATEWAY_MANAGEMENT_KEY` | servidor | para gestao do gateway |

Usar apenas uma chave publica Supabase e apenas uma chave privilegiada por ambiente quando possivel. Se as chaves novas publishable/secret estiverem disponiveis, preferi-las e manter as legadas apenas durante a migracao.

## Configuracao Vercel

- importar o repositorio privado `danilosouza-dev/bunker707-member-area`;
- framework Next.js, diretorio raiz do repositorio e comandos padrao;
- branch de producao: `main`;
- runtime Node.js 24, conforme `package.json`;
- Deployment Protection para previews administrativos quando o plano permitir;
- dominio HTTPS canonico antes de finalizar as URLs do Supabase Auth;
- nao armazenar videos na Vercel nem depender do disco efemero para dados persistentes.

A aplicacao aplica CSP com nonce por requisicao, HSTS em producao, bloqueio de framing, politica de permissoes e `no-store` nos fluxos autenticados. Ao adicionar Sentry, PostHog, novo provedor de video ou outro recurso no navegador, atualizar a CSP pela origem minima necessaria e testar antes de publicar.

## Ordem de publicacao

1. Executar `npm run verify`.
2. Publicar a branch de trabalho e revisar o PR para `dev`.
3. Fazer um deploy de teste controlado sem dados/segredos de producao expostos a codigo externo.
4. Confirmar migrations, RLS, Auth e Advisors no Supabase.
5. Promover `dev` para `main` por PR.
6. Configurar as variaveis de `Production` e publicar a `main`.
7. Atualizar Site URL e callback no Supabase para a URL canonica.
8. Executar os testes online abaixo e inspecionar logs de runtime.

## Testes online minimos

- visitante anonimo e redirecionado para `/login`;
- nao existe cadastro publico funcional via API do Supabase;
- aluno convidado autentica, troca senha temporaria quando exigido e ve somente seus entitlements;
- aluno sem acesso recebe bloqueio server-side ao tentar URL direta de aula, streams, progresso, comentarios, Tutor e Modo TV;
- administrador acessa `/admin`; aluno comum nao acessa;
- capas carregam do bucket publico, e nenhum material privado foi colocado nele;
- YouTube automatico/manual, Vimeo e embeds HTTPS permitidos funcionam sem violacoes inesperadas de CSP;
- logout invalida a sessao e respostas autenticadas nao ficam em cache compartilhado;
- logs da Vercel e Supabase nao exibem chaves, senhas, tokens, perguntas de alunos ou payloads privados.

## Operacao continua

- revisar Advisors e dependencias regularmente;
- ativar Sentry e alertas antes de ampliar a base de alunos;
- definir export/backup periodico; o plano Free nao oferece a mesma protecao operacional de um plano pago;
- rotacionar imediatamente qualquer segredo suspeito de exposicao e republicar a Vercel;
- usar um ambiente Supabase separado para staging assim que previews ou colaboradores adicionais entrarem no fluxo.
