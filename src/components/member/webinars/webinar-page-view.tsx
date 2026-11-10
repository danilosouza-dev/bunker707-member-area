import Image from "next/image";
import Link from "next/link";
import { CalendarClock, ChevronRight, Radio, TriangleAlert } from "lucide-react";
import { HeroGlow } from "@/components/member/hero-glow";
import { MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip, type MemberChipTone } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberPage, MemberSection } from "@/components/member/ui/member-page";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { heroTitleScale } from "@/lib/webinar-time";
import type { StudentPhase } from "@/server/webinars/model";
import { liveEnterState } from "@/server/webinars/live-banner";
import { phaseLabel, roomHref, type StudentSessionView, type StudentWebinarView } from "@/server/webinars/student-model";
import type { SessionCalendarLinks, WebinarPageData } from "@/server/webinars/student-queries";
import { WebinarCountdown, WebinarOnAir } from "./webinar-countdown";
import { LiveRoomWatcher, WebinarEnterButton, WebinarReplayButton } from "./webinar-enter-button";
import { WebinarFactsRow } from "./webinar-facts";
import { WebinarLocalTime } from "./webinar-local-time";
import { WebinarSessionActions } from "./webinar-session-actions";
import { JitEnter } from "./jit/jit-enter";

// /webinarios/[slug] (docs/30 §1.2; docs/31 V2-17, refeita no padrao da area em 10/11/2026 a pedido do produtor: a pagina
// de antes, com a capa pequena de um lado e uma lista de campos do outro, nao parecia parte da area). O desenho e o da
// pagina do curso: o destaque no topo, com os mesmos cantos, recuo e altura que o produtor escolhe em Marca > Estilo
// (--member-hero-*), a luz na cor da capa (HeroGlow) e o esfumacado de baixo. A capa do webinario e vertical (2:3, uma
// so, docs/30 §2.2): ela enche o fundo do destaque bem desfocada e escurecida, e aparece nitida ao lado do texto, como o
// cartao vertical da area. No destaque: o caminho (Início › Webinários › o titulo), os selos (o tipo e a situacao), o
// titulo grande, a descricao, a linha de fatos (a data em Sao Paulo com o horario do aparelho quando o fuso e outro, a
// duracao e quem apresenta) e a acao da situacao, sem cartao em volta:
//   Agendado (a contagem e Garantir vaga), Vaga garantida (o selo, Adicionar ao calendario e Cancelar minha vaga), Vagas
//   esgotadas (sem botao), Aguardando o apresentador e Ao vivo (Entrar: na Live gravada abre a Sala de 15 min antes ate o
//   fim, fase 2; na Live ao vivo, fase 3, abre a sala quando a equipe abriu ou o apresentador comecou; da hora marcada
//   ate a equipe abrir, "Aguardando o apresentador" sem link e a pagina reconsulta a cada 15 s; sem a sala neste
//   ambiente, o botao diz "em breve"), Encerrada ("Essa live acabou." e Assistir o replay quando ha a sessao replay) e
//   Cancelado (o motivo que a equipe escreveu).
// Com limite de vagas (A12) so quem garantiu entra: sem a vaga, Garantir vaga e depois Entrar. Fase 4e: com o "Comeca
// quando voce entra" ligado, a pagina mostra "A próxima sessão começa em {n} min" e o Entrar (sem Garantir vaga;
// jit/jit-enter.tsx) e o selo no lugar da situacao quando nao ha hora marcada. Embaixo do destaque: na Live gravada, as
// sessoes para escolher (as `jit` nunca aparecem uma a uma), e "Como funciona" ou "Antes de entrar" em tres linhas. Sem
// acesso a pagina nem existe (notFound na page.tsx).

const PHASE_TONES: Record<StudentPhase, MemberChipTone> = {
  cancelled: "warning",
  ended: "outline",
  live: "accent",
  registered: "success",
  scheduled: "neutral",
  sold_out: "warning",
  waiting: "warning"
};

const UPCOMING: readonly StudentPhase[] = ["scheduled", "registered", "sold_out"];

/** O texto do destaque: 14/24 (15/28 a partir de sm), no tom do texto do destaque da pagina do curso. */
const HERO_TEXT = "text-sm leading-6 text-zinc-300 sm:text-[15px] sm:leading-7";
/** A frase da situacao no destaque (cancelada, encerrada, aguardando, no ar): 20/28 peso 700 (24/32 a partir de sm), como a contagem. */
const HERO_STATUS = "flex items-center gap-2 text-xl font-bold text-white sm:text-2xl";
/** O titulo do destaque pelo tamanho do texto (heroTitleScale): o curto grande, o comprido menor. */
const TITLE_SIZES = {
  lg: "text-[32px] sm:text-5xl lg:text-[56px]",
  md: "text-[28px] sm:text-[40px] lg:text-[44px]",
  sm: "text-2xl sm:text-[32px] lg:text-4xl"
} as const;

function SessionRow({
  accessPreviewMode,
  calendar,
  durationMinutes,
  readOnly,
  seatRequired,
  serverNow,
  session,
  slug,
  source,
  webinarId
}: {
  accessPreviewMode?: AccessPreviewMode;
  calendar: SessionCalendarLinks | null;
  durationMinutes: number;
  readOnly: boolean;
  /** A live tem limite de vagas: so quem garantiu entra (A12). */
  seatRequired: boolean;
  serverNow: number;
  session: StudentSessionView;
  slug: string;
  source: string | null;
  webinarId: string;
}) {
  const copy = WEBINAR_COPY.aluno;
  const inProgress = session.phase === "waiting" || session.phase === "live";
  // Com limite de vagas so quem garantiu entra (A12): sem a vaga, a sessao aberta mostra Garantir vaga e depois Entrar.
  const seatMissing = inProgress && !readOnly && session.kind !== "live" && seatRequired && !session.registered;

  return (
    <MemberSurface as="li" padding="sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-white">{session.whenLabel}</p>
            <MemberChip tone={PHASE_TONES[session.phase]}>{phaseLabel(session.phase)}</MemberChip>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            <span>({copy.horarioBrasilia})</span> <WebinarLocalTime iso={session.scheduledAt} />
          </p>
          <p className="mt-1 text-sm text-zinc-300">
            {inProgress ? (
              copy.aguardandoTexto
            ) : (
              <WebinarCountdown fallback={copy.aguardando} serverNow={serverNow} targetIso={session.scheduledAt} />
            )}
            {session.registeredCount !== null ? ` · ${copy.vagasGarantidas(session.registeredCount)}` : ""}
          </p>
        </div>
        <div className="shrink-0">
          {inProgress && !seatMissing ? (
            <WebinarEnterButton accessPreviewMode={accessPreviewMode} durationMinutes={durationMinutes} serverNow={serverNow} session={session} slug={slug} />
          ) : (
            <WebinarSessionActions
              calendar={calendar}
              enterHref={seatMissing ? roomHref(slug, session.id) : null}
              phase={seatMissing ? "scheduled" : session.phase}
              readOnly={readOnly}
              registered={session.registered}
              sessionId={session.id}
              source={source}
              webinarId={webinarId}
            />
          )}
        </div>
      </div>
    </MemberSurface>
  );
}

type PhaseProps = {
  accessPreviewMode?: AccessPreviewMode;
  calendars: Record<string, SessionCalendarLinks>;
  liveRoomConfigured: boolean;
  readOnly: boolean;
  serverNow: number;
  source: string | null;
  view: StudentWebinarView;
};

/** A acao da situacao, dentro do destaque (sem cartao em volta). Na Live gravada com sessoes para escolher, nada: a lista vem embaixo. */
function HeroAction({ accessPreviewMode, calendars, liveRoomConfigured, readOnly, serverNow, source, view }: PhaseProps) {
  const copy = WEBINAR_COPY.aluno;
  const primary = view.primary;

  if (view.phase === "cancelled") {
    return (
      <div data-webinar-status="cancelled">
        <p className={HERO_STATUS}>{copy.cancelada}</p>
        {view.cancelReason ? <p className={`mt-1 max-w-2xl ${HERO_TEXT}`}>{view.cancelReason}</p> : null}
      </div>
    );
  }

  if (view.phase === "ended") {
    return (
      <div data-webinar-status="ended">
        <p className={HERO_STATUS}>{copy.encerrada}</p>
        {view.replayAvailable ? <WebinarReplayButton accessPreviewMode={accessPreviewMode} replaySessionId={view.replaySessionId} slug={view.slug} /> : null}
      </div>
    );
  }

  if (!primary) {
    return null;
  }

  // A Live ao vivo ainda nao aberta: a pagina reconsulta a cada 15 s (de 15 min antes ate a equipe abrir a sala), com
  // ou sem vaga; o Entrar aparece quando a sessao vira `waiting` ou `live`.
  const watcher = view.kind === "live" ? <LiveRoomWatcher liveRoomConfigured={liveRoomConfigured} serverNow={serverNow} session={primary} /> : null;

  if (!view.registrationRequired && UPCOMING.includes(view.phase)) {
    return (
      <>
        <p className={HERO_TEXT}>{copy.semVaga}</p>
        {watcher}
      </>
    );
  }

  // A Live gravada: as sessoes para escolher ficam embaixo do destaque (SessionsSection).
  if (view.kind === "simulated") {
    return null;
  }

  if (view.phase === "waiting" || view.phase === "live") {
    const roomOpen = liveEnterState(primary, { liveRoomConfigured, nowMs: serverNow }) === "enter";
    // Com limite de vagas so quem garantiu entra (A12): sem a vaga, Garantir vaga e, com a sala aberta, Entrar.
    const seatMissing = !readOnly && view.registrationRequired && view.capacity !== null && !primary.registered;

    return (
      <div data-webinar-status={view.phase}>
        {/* No ar: "No ar há 12 min" (o selo de cima ja diz Ao vivo); na espera, "Aguardando o apresentador". */}
        <p className={HERO_STATUS}>
          {view.phase === "live" ? <Radio aria-hidden="true" className="size-6 shrink-0 text-[var(--accent)]" strokeWidth={2.2} /> : null}
          {view.phase === "live" ? (
            <>
              <span className="sr-only">{copy.selo.aoVivo}. </span>
              <WebinarOnAir className="tabular-nums" serverNow={serverNow} startedAtIso={primary.startedAt ?? primary.scheduledAt} />
            </>
          ) : (
            copy.aguardando
          )}
        </p>
        {view.phase === "waiting" ? <p className={`mt-1 ${HERO_TEXT}`}>{copy.aguardandoTexto}</p> : null}
        {seatMissing ? (
          <div className="mt-4">
            <WebinarSessionActions
              calendar={calendars[primary.id] ?? null}
              enterHref={roomOpen ? roomHref(view.slug, primary.id) : null}
              phase="scheduled"
              readOnly={readOnly}
              registered={primary.registered}
              sessionId={primary.id}
              source={source}
              webinarId={view.id}
            />
          </div>
        ) : (
          <WebinarEnterButton
            accessPreviewMode={accessPreviewMode}
            durationMinutes={view.durationMinutes}
            liveRoomConfigured={liveRoomConfigured}
            serverNow={serverNow}
            session={primary}
            slug={view.slug}
          />
        )}
        {watcher}
      </div>
    );
  }

  return (
    <>
      <WebinarSessionActions
        calendar={calendars[primary.id] ?? null}
        phase={primary.phase}
        readOnly={readOnly}
        registered={primary.registered}
        sessionId={primary.id}
        source={source}
        webinarId={view.id}
      />
      {watcher}
    </>
  );
}

/** As sessoes da Live gravada para escolher, embaixo do destaque (as encerradas e as canceladas ficam de fora). */
function SessionsSection({ accessPreviewMode, calendars, readOnly, serverNow, source, view }: Omit<PhaseProps, "liveRoomConfigured">) {
  const copy = WEBINAR_COPY.aluno;
  const open = view.sessions.filter((session) => session.phase !== "ended" && session.phase !== "cancelled");

  return (
    <MemberSection count={open.length} description={copy.escolhaSessao} id="sessoes" title={copy.sessoes}>
      <ul className="grid gap-3">
        {open.map((session) => (
          <SessionRow
            accessPreviewMode={accessPreviewMode}
            calendar={calendars[session.id] ?? null}
            durationMinutes={view.durationMinutes}
            key={session.id}
            readOnly={readOnly}
            seatRequired={view.registrationRequired && view.capacity !== null}
            serverNow={serverNow}
            session={session}
            slug={view.slug}
            source={source}
            webinarId={view.id}
          />
        ))}
      </ul>
    </MemberSection>
  );
}

/** "Como funciona" (antes) ou "Antes de entrar" (com a sala aberta): tres linhas numeradas, sem cartao (docs/31 V2-17). */
function HowItWorks({ live }: { live: boolean }) {
  const copy = WEBINAR_COPY.aluno.pagina;
  const steps = live ? copy.passos.naHora : copy.passos.antes;

  return (
    <MemberSection id="como-funciona" title={live ? copy.antesDeEntrar : copy.comoFunciona}>
      <ol className="grid max-w-5xl gap-4 sm:grid-cols-3 sm:gap-6">
        {steps.map((step, index) => (
          <li className="flex items-start gap-3 text-sm leading-6 text-zinc-300" key={step}>
            <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-white/[0.08] text-xs font-bold tabular-nums text-white">
              {index + 1}
            </span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
    </MemberSection>
  );
}

/** O caminho no topo do destaque, como o da pagina do curso: Início › Webinários › o titulo. */
function Breadcrumbs({ accessPreviewMode, title }: { accessPreviewMode?: AccessPreviewMode; title: string }) {
  const copy = WEBINAR_COPY.aluno;
  const link = "rounded-[6px] px-1 py-0.5 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

  return (
    <nav aria-label={copy.pagina.caminho} className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-zinc-300">
      <Link className={link} href={withAccessPreviewParam(MEMBER_ROUTES.home, accessPreviewMode)}>
        {copy.pagina.inicio}
      </Link>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
      <Link className={link} href={withAccessPreviewParam(MEMBER_ROUTES.webinars, accessPreviewMode)}>
        {copy.titulo}
      </Link>
      {/* No celular o titulo vem logo abaixo, grande: o caminho para em Webinários. */}
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-zinc-500 max-sm:hidden" />
      <span aria-current="page" className="min-w-0 max-w-[min(100%,48ch)] truncate px-1 py-0.5 text-white max-sm:sr-only">
        {title}
      </span>
    </nav>
  );
}

export function WebinarPageView({
  accessPreviewMode,
  data,
  liveRoomConfigured = false,
  source
}: {
  accessPreviewMode?: AccessPreviewMode;
  data: Exclude<WebinarPageData, { state: "not_found" }>;
  /** A sala ao vivo existe neste ambiente (liveRoomConfigured(process.env), lido no servidor); sem ela, "em breve". */
  liveRoomConfigured?: boolean;
  /** Link de origem (?origem=) ja conferido pela pagina. */
  source: string | null;
}) {
  const copy = WEBINAR_COPY.aluno;
  const backHref = withAccessPreviewParam(MEMBER_ROUTES.webinars, accessPreviewMode);

  if (data.state === "error") {
    return (
      <MemberPage width="default">
        <MemberEmptyState
          action={
            <MemberButtonLink href={backHref} variant="primary">
              {copy.titulo}
            </MemberButtonLink>
          }
          description={copy.erroCarregar}
          icon={TriangleAlert}
          title={copy.erroCarregarTitulo}
        />
      </MemberPage>
    );
  }

  const { calendars, view } = data.page;
  const serverNow = data.now;
  const readOnly = Boolean(accessPreviewMode);
  const primary = view.primary;
  const cover = view.coverUrl?.trim() || null;
  const upcoming = UPCOMING.includes(view.phase);
  const inProgress = view.phase === "waiting" || view.phase === "live";
  const phase = { accessPreviewMode, calendars, liveRoomConfigured, readOnly, serverNow, source, view };
  // As sessoes para escolher: so na Live gravada com vaga (sem vaga, "é só entrar na hora" ja diz tudo no destaque).
  const sessions = view.kind === "simulated" && Boolean(primary) && view.phase !== "cancelled" && view.phase !== "ended" && (view.registrationRequired || !upcoming);

  return (
    <div className="min-h-screen bg-[#141414] pb-24 text-white" data-webinar-page="">
      {/* O destaque com os cantos, o recuo e a luz da pagina do curso (Marca > Estilo). */}
      <div className="relative flow-root">
        <HeroGlow src={cover} />
        <section className="relative z-[1] mx-[var(--member-hero-inset)] mt-[var(--member-hero-top)] overflow-hidden rounded-[var(--member-hero-radius)]" data-webinar-hero="">
          {/* O fundo: a capa vertical bem desfocada (uma versao pequena, esticada), escurecida para o texto. */}
          {cover ? (
            <Image alt="" aria-hidden="true" className="scale-125 object-cover opacity-70 blur-3xl" fill priority sizes="320px" src={cover} unoptimized={!canOptimizeImageSrc(cover)} />
          ) : (
            <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(120deg,#262626,#161616)]" />
          )}
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-[#141414]/95 via-[#141414]/75 to-[#141414]/35" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent via-[#141414]/80 to-[#141414] opacity-[var(--member-hero-fade)]" />

          {/* O texto comeca no recuo da pagina (como o da pagina do curso e as fileiras), nao centrado. */}
          <div className="relative z-10 flex w-full max-w-[1440px] flex-col px-5 pb-12 pt-24 sm:px-8 sm:pb-14 lg:px-12 lg:pt-28">
            <Breadcrumbs accessPreviewMode={accessPreviewMode} title={view.title} />

            <article className={cn("mt-8 grid gap-7 lg:mt-10", cover ? "lg:grid-cols-[minmax(0,760px)_280px] lg:items-end lg:justify-between lg:gap-14" : "lg:max-w-[760px]")}>
              {/* A capa nitida: em cima no celular, a direita no computador. Sem capa, so o texto (nenhum cartao vazio). */}
              {cover ? (
                <div className="w-[136px] sm:w-[168px] lg:order-last lg:w-full">
                  <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--member-cover-radius)] bg-[#1f1f1f] shadow-[0_24px_64px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.1]" data-webinar-cover="">
                    <Image alt="" className="object-cover" fill priority sizes="(min-width: 1024px) 280px, (min-width: 640px) 168px, 136px" src={cover} unoptimized={!canOptimizeImageSrc(cover)} />
                  </div>
                </div>
              ) : null}

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <MemberChip tone="neutral">{view.kindLabel}</MemberChip>
                  {view.jit ? (
                    <MemberChip icon={Radio} tone="outline">
                      {WEBINAR_COPY.jit.aluno.selo}
                    </MemberChip>
                  ) : null}
                  {/* A situacao; "Vaga garantida" fica so junto dos botoes (com o icone), nao duas vezes. */}
                  {(!view.jit || primary) && view.phase !== "registered" ? (
                    <MemberChip icon={view.phase === "live" ? Radio : undefined} tone={PHASE_TONES[view.phase]}>
                      {phaseLabel(view.phase)}
                    </MemberChip>
                  ) : null}
                </div>
                <h1 className={`mt-4 break-words font-black leading-[1.08] text-white ${TITLE_SIZES[heroTitleScale(view.title)]}`}>{view.title}</h1>
                {view.description ? <p className={`mt-4 max-w-2xl whitespace-pre-line break-words ${HERO_TEXT}`}>{view.description}</p> : null}

                {primary || view.jit ? <WebinarFactsRow className="mt-6" durationLabel={view.durationLabel} presenterName={view.presenterName} session={primary} /> : null}

                {primary && upcoming ? (
                  <div className="mt-7" data-webinar-countdown="">
                    <p className="flex items-center gap-2 text-xl font-bold text-white sm:text-2xl">
                      <CalendarClock aria-hidden="true" className="size-6 shrink-0 text-[var(--accent)]" strokeWidth={2.2} />
                      <WebinarCountdown className="tabular-nums" fallback={copy.aguardando} serverNow={serverNow} targetIso={primary.scheduledAt} />
                    </p>
                    {primary.registeredCount !== null && view.kind !== "simulated" ? <p className="mt-1 text-sm text-zinc-400">{copy.vagasGarantidas(primary.registeredCount)}</p> : null}
                  </div>
                ) : null}

                {view.jit ? (
                  <div className="mt-7">
                    <JitEnter accessPreviewMode={accessPreviewMode} jit={view.jit} readOnly={readOnly} serverNow={serverNow} webinarId={view.id} />
                  </div>
                ) : null}

                <div className="mt-6 max-w-xl empty:hidden" data-webinar-action="">
                  <HeroAction {...phase} />
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      {/* Embaixo do destaque, no recuo das fileiras da area (--member-row-inset). */}
      <div className="grid w-full max-w-[1440px] gap-12 px-[var(--member-row-inset)] pt-10">
        {sessions ? <SessionsSection accessPreviewMode={accessPreviewMode} calendars={calendars} readOnly={readOnly} serverNow={serverNow} source={source} view={view} /> : null}
        {view.phase !== "cancelled" && view.phase !== "ended" ? <HowItWorks live={inProgress} /> : null}
      </div>
    </div>
  );
}
