# Bunker707 Member Area Instructions

## Project Scope

This workspace is for the Bunker707 student member area.

The product is a closed member platform for an AI school. It is not a public storefront and does not include internal checkout in the MVP. Sales happen through external platforms such as Hotmart, Ticto, TikTok, or similar providers. The app receives external events and controls internal access through entitlements.

Current focus: student experience.

Do not prioritize admin/professor dashboard unless the user explicitly asks for it.

## Source Of Truth

Before making product, UX, architecture, or implementation decisions, read the relevant docs:

- `README.md`
- `docs/01-visao-produto.md`
- `docs/02-area-aluno-ux.md`
- `docs/03-referencia-astron.md`
- `docs/04-arquitetura-tecnica.md`
- `docs/05-modelo-dados.md`
- `docs/06-seguranca-operacao.md`
- `docs/07-roadmap-mvp.md`
- `docs/08-backlog-inicial.md`
- `docs/09-decisoes-abertas.md`
- `docs/11-inventario-coleta-astron.md`
- `docs/12-design-system-bunker707.md`
- `docs/13-padroes-engenharia.md`
- `docs/16-auditoria-tecnica-2026-10-01.md`
- `docs/17-admin-produtor-redesign.md` (proposta de reconstrucao da area do produtor; vale para qualquer trabalho em `/admin`)
- `docs/18-padrao-de-testes.md` (padrao de testes, dados de teste e rotina: toda PR de funcionalidade ou correcao traz teste de comportamento)
- `docs/19-infra-hetzner-e-email.md` (infra propria na Hetzner, custos verificados, e-mail transacional no Resend e cronograma; vale para qualquer trabalho de deploy, e-mail ou infra)
- `docs/20-runbook-hetzner.md` (servidor proprio na Hetzner: `infra/`, Dockerfile, deploy, backup, incidentes; nada cobrado e criado sem ok do produtor no chat)
- `docs/21-retomada-migracao-hetzner.md` (estado da migracao para a Hetzner e proximos passos, na ordem; ler primeiro ao retomar esse trabalho)
- `docs/22-comunicacao-notificacoes-e-pop-ups.md` (Comunicacao v1: sino do aluno, avisos e pop-ups criados pela equipe, segmentos por regras, envio pelo tick e limites fixos; vale para qualquer trabalho em Comunicacao, sino ou pop-ups)
- `docs/23-comunicacao-v2-fluxos.md` (Comunicacao v2: quem envia e icone de cada notificacao, tempo no sino, audio ouvido, notificacoes seguintes no editor e Fluxos com regras num motor so no tick, visitas de pagina e o limite de 3 por dia; vale para qualquer trabalho em Comunicacao, sino, notificacoes seguintes ou fluxos)
- `docs/24-comunicacao-v3a-sino-e-avisos.md` (Comunicacao v3a: CRUD dos avisos no menu, editar e excluir a notificacao enviada, "Mostrar de novo" no pop-up "Uma vez", lixeira do aluno, cartao clicavel, Mudar resposta, reacoes, enquetes, regras novas e o sino numa consulta so com a primeira pagina guardada no navegador; vale para qualquer trabalho em Comunicacao, sino, avisos, reacoes ou enquetes)
- `docs/25-comunicacao-v3b1-pop-ups.md` (Comunicacao v3b-1: onde o pop-up aparece e onde nunca, ao abrir a pagina ou ao concluir uma aula, quantas vezes para cada aluno escolhido pela equipe sem limite fixo entre pop-ups, o "Volta em" do Lembrar depois, Como fechar, um de cada vez e nunca com o nosso player tocando, mapa + plano + `POST /api/popups/[id]/show` e a memoria de 1 minuto do navegador; vale para qualquer trabalho em pop-ups, Comunicacao ou no player da pagina da aula)
- `docs/26-comunicacao-design-do-pop-up.md` (Design do pop-up: o card Design com Padrão ou Personalizado, video curto ou imagem que some num degrade, texto por zonas, blocos selo/titulo/texto/botoes/audio/espaco, fontes enviadas sem Google na hora, cores e degrades, X e links, previa de celular e computador, dica de contraste, `popup_design` + `communication_fonts` + buckets de video e fontes, zod no salvar e no ler; vale para qualquer trabalho no visual do pop-up, no card Design do editor, nos envios de video e fonte ou no `MemberPopupCard`)
- `docs/27-comunicacao-design-livre.md` (Design Livre do pop-up: a terceira opcao Livre do card Design, o editor de tela cheia no estilo do Elementor com Elementos, Camadas, desenho com arrastar/alcas/guias, Conteudo/Estilo/Avancado, Pop-up, Revisar, desfazer/refazer e "Salvar rascunho" sem fechar o editor, elementos soltos ou na sequencia, o `PopupFreeCard` num pedaco proprio, o pop-up inteiro encolhido no celular com piso de 12 px, `mode: "free"` na mesma coluna `popup_design` sem migracao, so caminhos dos nossos buckets com o endereco montado pela origem conferida, o contrato do JSON (§9) para a IA; o acabamento L1.1 (§13): Copiar e colar o design, as instrucoes para a IA geradas do §9, "Usar o design Personalizado", o quarto modelo e a dica "texto no celular" so quando o piso muda o encaixe; vale para qualquer trabalho no Livre, no card Design, no `PopupFreeCard`, nos envios de imagem do Livre ou no "Criar com IA")

Update docs when decisions change.

Use `docs/11-inventario-coleta-astron.md` as the detailed UX/functionality reference from the Astron Academy walkthrough. Do not copy personal data, proprietary text, brand assets, or a literal visual clone.

## Product Rules

- The student area comes first.
- Use a streaming-inspired home: hero, overlapping first row, carousels, vertical cards.
- Use a hamburger menu that opens a sidebar.
- Cards should be vertical, not horizontal.
- The platform should show only content the student can access.
- Internal entitlements are the source of truth for access.
- Payment provider data is input, not authorization truth.
- Track student behavior from the start.

## Recommended Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase Postgres with RLS
- Supabase Auth
- Mux or Bunny Stream for video
- PostHog for product analytics
- Sentry for monitoring
- Trigger.dev or Inngest for background jobs
- Hetzner in production (`main`, `deploy-membros`); Vercel + Supabase cloud as the test environment (`dev`, team-created accounts only). Flow: task branch -> PR to `dev` -> producer tests -> PR `dev` -> `main` -> deploy (`CONTRIBUTING.md`)

## Engineering Conventions

- Prefer clear modular code over premature abstractions.
- Keep provider integrations behind adapters.
- Keep access logic separate from payment provider parsing.
- Do not put service keys in browser code.
- Do not host video files in the app server.
- Use mock data for UI-first prototypes when the backend is not ready.
- Add RLS for exposed Supabase tables.
- Treat webhooks as untrusted until validated.
- Make webhook processing idempotent.
- Record raw webhook payloads for audit and reprocessing.

## Repository Standards

- This workspace uses one private GitHub repository for the member area and CMS.
- Treat `main` as the trunk branch; enable GitHub branch protection when the account plan allows it.
- Use Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`, or `revert`.
- Before opening or merging work, run `npm run verify`.
- Keep repo workflow rules in `CONTRIBUTING.md` and `docs/13-padroes-engenharia.md`.
- Never commit local backups, build artifacts, `.env` files, provider service keys, access tokens, raw personal data, or private webhook payloads.

## Suggested App Modules

```txt
src/
  app/
    api/
      webhooks/
      progress/
      search/
      support/
  server/
    auth/
    db/
    access/
    content/
    progress/
    events/
    payments/
    video/
    support/
    jobs/
```

## MVP Priority

1. App shell.
2. Home.
3. Sidebar/hamburger.
4. Vertical cards and carousels.
5. Minhas compras.
6. Course/trail page.
7. Lesson page with player and playlist.
8. Progress.
9. Entitlements.
10. Search, profile and support.

Community, member wall, conversations, ranking, certificates, AI lesson assistant and admin dashboard are later phases unless explicitly requested.
