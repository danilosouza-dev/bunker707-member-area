# Modelos de e-mail do Auth (GoTrue) em portugues

Os mesmos textos que o painel do Supabase cloud tinha em 17/10/2026 (docs/19, secao 2.4). No servidor proprio
nao ha painel: o Caddy serve esta pasta em `SUPABASE_PUBLIC_URL/auth-templates/*.html` e o Auth busca o modelo
pela URL na hora de enviar (`GOTRUE_MAILER_TEMPLATES_*` no compose). Os assuntos ficam em `AUTH_SUBJECT_*` no
`.env`. As variaveis `{{ .SiteURL }}`, `{{ .TokenHash }}`, `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}` e
`{{ .NewEmail }}` sao do GoTrue.

Convite, recuperacao e link magico apontam para `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...`:
o app confirma no servidor (`verifyOtp`) e grava a sessao, em qualquer navegador. Com `{{ .ConfirmationURL }}` o
convite voltava com `#access_token` (fluxo implicito), que o app recusa, e a recuperacao so abria no navegador
que pediu o link (PKCE). Confirmacao de cadastro e troca de e-mail continuam no `ConfirmationURL`.
Se um modelo nao puder ser baixado, o Auth usa o texto padrao dele (em ingles).
