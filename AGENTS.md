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
- Clerk or Supabase Auth
- Mux or Bunny Stream for video
- PostHog for product analytics
- Sentry for monitoring
- Trigger.dev or Inngest for background jobs
- Vercel initially, with portability to Hetzner

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
- Use `main` as the protected trunk branch.
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
