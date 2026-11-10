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
- `docs/21-retomada-migracao-hetzner.md` (estado da migracao para a Hetzner e proximos passos, na ordem; ler primeiro ao retomar esse trabalho; desde 03/11/2026 a producao fica guardada em snapshot, secao 10)
- `docs/22-comunicacao-notificacoes-e-pop-ups.md` (Comunicacao v1: sino do aluno, avisos e pop-ups criados pela equipe, segmentos por regras, envio pelo tick e limites fixos; vale para qualquer trabalho em Comunicacao, sino ou pop-ups)
- `docs/23-comunicacao-v2-fluxos.md` (Comunicacao v2: quem envia e icone de cada notificacao, tempo no sino, audio ouvido, notificacoes seguintes no editor e Fluxos com regras num motor so no tick, visitas de pagina e o limite de 3 por dia; vale para qualquer trabalho em Comunicacao, sino, notificacoes seguintes ou fluxos)
- `docs/24-comunicacao-v3a-sino-e-avisos.md` (Comunicacao v3a: CRUD dos avisos no menu, editar e excluir a notificacao enviada, "Mostrar de novo" no pop-up "Uma vez", lixeira do aluno, cartao clicavel, Mudar resposta, reacoes, enquetes, regras novas e o sino numa consulta so com a primeira pagina guardada no navegador; vale para qualquer trabalho em Comunicacao, sino, avisos, reacoes ou enquetes)
- `docs/25-comunicacao-v3b1-pop-ups.md` (Comunicacao v3b-1: onde o pop-up aparece e onde nunca, ao abrir a pagina ou ao concluir uma aula, quantas vezes para cada aluno escolhido pela equipe sem limite fixo entre pop-ups, o "Volta em" do Lembrar depois, Como fechar, um de cada vez e nunca com o nosso player tocando, mapa + plano + `POST /api/popups/[id]/show` e a memoria de 1 minuto do navegador; vale para qualquer trabalho em pop-ups, Comunicacao ou no player da pagina da aula)
- `docs/26-comunicacao-design-do-pop-up.md` (Design do pop-up: o card Design com Padrão ou Personalizado, video curto ou imagem que some num degrade, texto por zonas, blocos selo/titulo/texto/botoes/audio/espaco, fontes enviadas sem Google na hora, cores e degrades, X e links, previa de celular e computador, dica de contraste, `popup_design` + `communication_fonts` + buckets de video e fontes, zod no salvar e no ler; vale para qualquer trabalho no visual do pop-up, no card Design do editor, nos envios de video e fonte ou no `MemberPopupCard`)
- `docs/27-comunicacao-design-livre.md` (Design Livre do pop-up: a terceira opcao Livre do card Design, o editor de tela cheia no estilo do Elementor com Elementos, Camadas, desenho com arrastar/alcas/guias, Conteudo/Estilo/Avancado, Pop-up, Revisar, desfazer/refazer e "Salvar rascunho" sem fechar o editor, elementos soltos ou na sequencia, o `PopupFreeCard` num pedaco proprio, o pop-up inteiro encolhido no celular com piso de 12 px, `mode: "free"` na mesma coluna `popup_design` sem migracao, so caminhos dos nossos buckets com o endereco montado pela origem conferida, o contrato do JSON (§9) para a IA; o acabamento L1.1 (§13): Copiar e colar o design, as instrucoes para a IA geradas do §9, "Usar o design Personalizado", o quarto modelo e a dica "texto no celular" so quando o piso muda o encaixe; vale para qualquer trabalho no Livre, no card Design, no `PopupFreeCard`, ou nos envios de imagem do Livre)
- `docs/28-comunicacao-modelos.md` (Modelos da Comunicacao: a aba Modelos com Notificacao, Pop-up e Design (Personalizado ou Livre), "Salvar como modelo" no editor e no ⋯, "Novo aviso" com modelos e "Usar" que abre o aviso preenchido sem gravar, o modo modelo do editor e a pagina do modelo de Design, "Meus modelos" no card Design e a aba Modelos do editor Livre, `communication_templates` (migracao `202610250001`) com payload versao 1 lido parte por parte, datas que nunca entram, o salvar que nunca apaga arquivo e a limpeza lendo os modelos pelo jsonb cru; vale para qualquer trabalho em modelos, no card Design, no editor do aviso ou na limpeza de arquivos)
- `docs/29-comunicacao-v3b2-momentos-relatorio-e-players.md` (Comunicacao v3b-2: a hora marcada ao vivo (com `Começa: Em uma data` o pop-up abre na hora para quem ja esta na pagina, plano ate 24 h antes, 409 `not_started` com uma segunda tentativa, despertador pela hora de parede, sem pedido em laco), os momentos "No primeiro acesso" (decidido no recalculo do segmento, com a marca `first_access_at` e os produtos em `popup_access_products`) e "Ao concluir um curso" (a virada pela rota de progresso, conferida no `show`), o relatorio do pop-up (`communication_popup_report`, indice parcial em `student_events`, cache de 60 s), a ponte por `postMessage` com o Bunny, o Vimeo e o Mux (origens exatas, sem SDK, o fim do video conclui a aula, o pop-up espera o video parar), a politica que impede o aluno de gravar linhas de avisos no historico, as faixas do recalculo em :07/:22/:37/:52, a migracao `202610260001` antes do merge e a regra de nao publicar os momentos novos com o app de antes no ar (R1); vale para qualquer trabalho em pop-ups, momentos do pop-up, relatorio do pop-up, recalculo do segmento ou no player da pagina da aula)
- `docs/30-webinarios.md` (Webinarios: Live ao vivo no Jitsi proprio sem marca d'agua (cx23 agora, cx33 depois; Jibri por hora em servidor separado, gravacao em 1080p), Live gravada com o chat original por offset e todas as funcoes do Hot Webinar por fases, chat/reacoes/enquetes/perguntas/presenca no nosso banco, paineis "Lives ao vivo" e "Lives gravadas" com CSV nos nomes do Zoom, regra de qualidade por tamanho na tela (palco 720p/1080p, tela 1080p a 30 quadros, miniaturas ate 360p), CDC/LGPD, fases 1 a 4 e decisoes D1-D26; vale para qualquer trabalho em webinarios, lives, sala ao vivo, live gravada, roteiro de chat, Jitsi, Jibri ou nos paineis de lives)
- `docs/31-webinarios-redesign-v2.md` (Redesign V2 dos webinarios, aprovado em 31/10/2026: plano A com o iframe do motor estilizado por CSS na instancia, sala do aluno sem Minimizar, selos Ao vivo e Gravando no palco, barra de circulos, painel com tres abas e recolher, chat no estilo do Zoom, enquete no meio do palco, temas claro e escuro so na sala e no console, console em tela cheia com a barra de quem apresenta nossa, pagina do webinario, celular, os quatro layouts do motor, e as funcoes novas: comentario em destaque no palco, roteiro e simulacao na live ao vivo, tela compartilhada com permissao e a correcao da moderacao de tela; o console no estilo do YouTube e a saida protegida do console com a sala no ar (§10); vale sobre o docs/30 onde houver conflito, para qualquer trabalho na sala, no console, na pagina do webinario ou nos temas da sala)
- `docs/32-produto-licenciado.md` (PROPOSTA em discussao, com as tres respostas do produtor de 10/11/2026 marcadas no texto (testes do produto na Hetzner, simulando cliente novo): vender a area de membros como produto licenciado instalado no servidor do comprador, com o nome provisorio Area Bunker; Licenca anual com Anos adicionais ou vitalicia, uma Licenca para uma area de membros num endereco, sem Instalacao de teste; Chave de ativacao de uso unico, licenca assinada presa ao endereco e conferencia diaria pelo tick; tres degraus (Aviso, Admin limitado, Escola congelada), que valem tambem para a Licenca anual vencida depois de 15 dias de carencia; o Admin limitado nunca barra o que a lei e a seguranca pedem, a Escola congelada barra todo acesso novo e o aluno que ja esta dentro nao perde o que tem; o Emissor no repositorio privado proprio `bunker-licensing`, com o Painel de licencas da equipe em `licencas.bunker707.com.br` e a tela Planos em que o produtor escolhe o que esta a venda (o Ano adicional de 12 meses nunca desliga com Licenca anual de pe), e o Verificador em `src/server/licensing`; lote fundador instalado pela equipe antes da venda aberta; uma imagem para todos e o Pacote da versao; instalador de um comando, assistente de dominio e kit da IA; modulos de pagamento unico vendidos a parte numa loja dentro da nossa area, ligados pela Licenca e declarados num manifesto, com os Webinarios como o primeiro; a compra aplicada a Licenca pelo codigo no checkout, pelo e-mail ou pelo resgate; o §7.1 sobre a copia alterada (tirar a conferencia custa horas a quem sabe; conferencia que conta o que esta rodando, radar por denuncia, Node sem arquivo carregado antes e, so com o Emissor em servidor proprio, a marca do comprador em cada pacote); marca branca; kit de recuperacao e clausula de continuidade; decisoes D1-D38, abertas A1-A35 e o que rodou e nao rodou no §16; ler antes de qualquer trabalho em licencas, no instalador, na entrega das versoes, na marca branca, nos modulos vendidos a parte ou na venda da area como produto)

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
- Hetzner in production (`main`, `deploy-membros`; kept in snapshot until launch since 03/11/2026: `restaurar` before any deploy or test there, `snapshot` with `CONFIRMAR=apagar` after, docs/20 §4A.7 and docs/21 §10); Vercel + Supabase cloud as the test environment (`dev`, team-created accounts only). Flow: task branch -> PR to `dev` -> producer tests -> PR `dev` -> `main` -> deploy (`CONTRIBUTING.md`)

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
