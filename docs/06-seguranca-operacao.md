# Seguranca e Operacao

## Principios

- Nenhuma chave sensivel no browser.
- Service role do Supabase somente no servidor.
- RLS habilitado nas tabelas expostas.
- Webhooks sempre validados.
- Eventos externos sempre idempotentes.
- Logs e auditoria desde o inicio.
- Videos protegidos por provedor especializado.

## Row Level Security

Todas as tabelas acessiveis pelo cliente devem ter RLS.

Politicas iniciais:

- aluno le seu proprio perfil;
- aluno le seu proprio progresso;
- aluno le somente conteudos liberados;
- aluno cria eventos proprios permitidos;
- aluno nao altera entitlement;
- admin/server altera conteudo, acesso e webhooks.

Implementado no MVP atual:

- Supabase Auth e usado como provedor de identidade;
- o middleware do Next.js renova/valida sessao com `@supabase/ssr`;
- `profiles`, `entitlements`, `student_events`, `lesson_progress` e `admin_roles` possuem RLS;
- aluno pode ler/editar somente o proprio perfil, ler os proprios entitlements e gravar eventos proprios;
- aluno nao possui policy para criar, alterar ou remover entitlements;
- `/admin` e as APIs `/api/admin/*` exigem papel em `admin_roles`;
- login, callback e reentrada em `/login` direcionam usuarios administrativos para `/admin` depois da autenticacao;
- `/api/progress/lessons` grava progresso usando `auth.user.id`, nao um id vindo do cliente.

Excecao de desenvolvimento:

- sem variaveis Supabase e fora de producao, o login oferece modo local de desenvolvimento;
- em `localhost` fora de producao, o modo local tambem pode ser usado quando Supabase esta configurado mas inacessivel para desbloquear testes do MVP;
- o modo local usa cookie httpOnly e usuario fixo de desenvolvimento;
- esse modo nao deve existir como autorizacao de producao e e automaticamente indisponivel em `NODE_ENV=production`.

## Webhooks

Regras:

- validar assinatura/token quando a plataforma oferecer;
- salvar payload bruto;
- usar idempotencia;
- processar em background;
- registrar erro sem perder evento;
- permitir reprocessamento seguro.
- mapear evento externo para produto ou combo interno antes de alterar acesso;
- criar ou revogar somente entitlements internos, nunca liberar conteudo direto pelo payload do provider;
- guardar segredos de webhook somente no servidor ou gerenciador de segredos.

## Comentarios e moderacao

Regras:

- aluno so comenta em aula/produto que pode acessar;
- comentario deve passar por bloqueio de palavras antes de ser salvo como publicado;
- comentarios podem ficar pendentes, aprovados, ocultos ou marcados como spam;
- acoes de moderacao devem registrar ator, acao, comentario e horario;
- palavras bloqueadas devem mostrar uma mensagem clara ao aluno sem expor regras internas demais;
- denuncias de comentarios devem entrar na fila de moderacao.

## Agentes de IA

Regras:

- qualquer agente precisa checar entitlement antes de usar contexto de aula, produto ou transcricao;
- agente geral pode apontar links somente para conteudos que o aluno pode ver ou para paginas de detalhe bloqueadas permitidas;
- resposta automatica em comentario deve ser configuravel e auditavel;
- prompts, instrucoes e fontes de treinamento nao devem incluir service keys, payloads privados ou dados pessoais desnecessarios;
- conversas e feedbacks futuros devem respeitar LGPD, retencao e exportacao/remocao quando aplicavel.

## Video

Nao expor arquivo original.

Requisitos:

- playback com token temporario;
- controle de permissao antes de entregar URL;
- thumbnails e duracao vindas do provedor;
- logs de acesso quando possivel.

## LGPD

Pontos de atencao:

- coletar somente dados necessarios;
- informar uso de dados;
- registrar consentimentos quando aplicavel;
- permitir exportacao/remocao futura de dados pessoais;
- mascarar dados sensiveis em logs;
- cuidado com session replay e campos pessoais.

## Observabilidade

Ferramentas recomendadas:

- Sentry para erros;
- PostHog para analytics;
- logs estruturados no servidor;
- tabela de auditoria para acoes sensiveis.

Eventos criticos:

- login;
- alteracao de senha;
- criacao ou reenvio de acesso por convite;
- criacao de senha temporaria pelo admin;
- liberacao/revogacao de acesso;
- webhook processado;
- falha de webhook;
- aula concluida;
- erro de video.

## Backups

Responsabilidades:

- Supabase Postgres: backup automatico do plano escolhido;
- exports periodicos para seguranca;
- assets e materiais em storage com politica de backup;
- videos no provedor com estrategia de recuperacao.

## Operacao inicial

Ambiente minimo:

- development;
- production.

Ambiente recomendado depois:

- development;
- staging;
- production.

Checklist de producao:

- dominio configurado;
- SSL ativo;
- variaveis de ambiente separadas;
- Sentry ativo;
- PostHog ativo;
- backups conferidos;
- RLS revisado;
- Supabase Auth configurado;
- primeiro usuario interno cadastrado em `admin_roles`;
- webhooks com segredo;
- pagina de erro amigavel;
- suporte funcional.

## Cadastro manual e senha temporaria

Regras:

- convite por email e o fluxo preferencial para novos alunos;
- senha temporaria existe apenas para suporte/onboarding e deve exigir troca no primeiro login;
- senha temporaria nao deve ser salva em banco, logs, historico do CRM ou metadata;
- `service_role` so pode ser usado na rota server-side administrativa;
- a tela `/alterar-senha` limpa `must_change_password` somente depois de atualizar a senha do usuario;
- remover aluno ou produto do acesso manual no CRM deve marcar os entitlements `admin-student:*` como `revoked`, sem apagar eventos ou payloads externos;
- o admin deve enviar senha temporaria por canal de atendimento controlado, evitando expor senha permanente por email.
