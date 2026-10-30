import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CalendarClock, ImageOff, Radio, TriangleAlert } from "lucide-react";
import { MemberButtonLink } from "@/components/member/ui/member-button";
import { MemberChip, type MemberChipTone } from "@/components/member/ui/member-chip";
import { MemberEmptyState } from "@/components/member/ui/member-empty-state";
import { MemberPage, MemberSection } from "@/components/member/ui/member-page";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { withAccessPreviewParam, type AccessPreviewMode } from "@/lib/access-preview";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { StudentPhase } from "@/server/webinars/model";
import { liveEnterState } from "@/server/webinars/live-banner";
import { phaseLabel, roomHref, type StudentSessionView, type StudentWebinarView } from "@/server/webinars/student-model";
import type { SessionCalendarLinks, WebinarPageData } from "@/server/webinars/student-queries";
import { WebinarCountdown } from "./webinar-countdown";
import { LiveRoomWatcher, WebinarEnterButton, WebinarReplayButton } from "./webinar-enter-button";
import { WebinarFacts } from "./webinar-facts";
import { WebinarLocalTime } from "./webinar-local-time";
import { WebinarSessionActions } from "./webinar-session-actions";
import { JitEnter } from "./jit/jit-enter";

// /webinarios/[slug] (docs/30 §1.2): a tabela de situacoes. Agendado (Garantir vaga), Vaga garantida (selo,
// Adicionar ao calendario e Cancelar minha vaga), Vagas esgotadas (sem botao), Aguardando o apresentador e
// Ao vivo (Entrar: na Live gravada abre a Sala de 15 min antes ate o fim, fase 2; na Live ao vivo, fase 3, abre a
// sala quando a equipe abriu ou o apresentador comecou; da hora marcada ate a equipe abrir, "Aguardando o
// apresentador" sem link e a pagina reconsulta a cada 15 s; sem a sala neste ambiente, o botao diz "em breve"),
// Encerrada ("Essa live acabou." e Assistir o replay quando ha a sessao replay) e Cancelado (o motivo que a equipe
// escreveu). Com limite de vagas (A12) so quem garantiu entra: sem a vaga, Garantir vaga e depois Entrar. Na Live
// gravada o aluno escolhe a sessao antes de garantir a vaga. Horarios em Sao Paulo; "(no seu horario: 21:00)"
// quando o aparelho esta em outro fuso. Sem acesso a pagina nem existe (notFound na page.tsx). Fase 4e: com o
// "Comeca quando voce entra" ligado, a pagina mostra "A próxima sessão começa em {n} min" e o Entrar (sem Garantir
// vaga; jit/jit-enter.tsx), o selo no lugar da situacao quando nao ha hora marcada e, se houver, as sessoes marcadas
// embaixo como antes; as sessoes `jit` nunca aparecem uma a uma.

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

function PhaseBlock({
  accessPreviewMode,
  calendars,
  liveRoomConfigured,
  readOnly,
  serverNow,
  source,
  view
}: {
  accessPreviewMode?: AccessPreviewMode;
  calendars: Record<string, SessionCalendarLinks>;
  liveRoomConfigured: boolean;
  readOnly: boolean;
  serverNow: number;
  source: string | null;
  view: StudentWebinarView;
}) {
  const copy = WEBINAR_COPY.aluno;
  const primary = view.primary;

  if (view.phase === "cancelled") {
    return (
      <MemberSurface variant="inset">
        <p className="text-sm font-semibold text-white">{copy.cancelada}</p>
        {view.cancelReason ? <p className="mt-1 text-sm leading-6 text-zinc-400">{view.cancelReason}</p> : null}
      </MemberSurface>
    );
  }

  if (view.phase === "ended") {
    return (
      <MemberSurface variant="inset">
        <p className="text-sm font-semibold text-white">{copy.encerrada}</p>
        {view.replayAvailable ? <WebinarReplayButton accessPreviewMode={accessPreviewMode} replaySessionId={view.replaySessionId} slug={view.slug} /> : null}
      </MemberSurface>
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
        <p className="text-sm leading-6 text-zinc-400">{copy.semVaga}</p>
        {watcher}
      </>
    );
  }

  if (view.kind === "simulated") {
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

  if (view.phase === "waiting" || view.phase === "live") {
    const roomOpen = liveEnterState(primary, { liveRoomConfigured, nowMs: serverNow }) === "enter";
    // Com limite de vagas so quem garantiu entra (A12): sem a vaga, Garantir vaga e, com a sala aberta, Entrar.
    const seatMissing = !readOnly && view.registrationRequired && view.capacity !== null && !primary.registered;

    return (
      <MemberSurface variant="inset">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          {view.phase === "live" ? <Radio aria-hidden="true" className="size-4 text-[var(--accent)]" /> : null}
          {view.phase === "live" ? copy.selo.aoVivo : copy.aguardando}
        </p>
        {view.phase === "waiting" ? <p className="mt-1 text-sm leading-6 text-zinc-400">{copy.aguardandoTexto}</p> : null}
        {seatMissing ? (
          <div className="mt-3">
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
      </MemberSurface>
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
  const cover = view.coverUrl?.trim();
  const upcoming = UPCOMING.includes(view.phase);

  return (
    <MemberPage width="default">
      <nav aria-label="Voltar" className="mb-6">
        <Link className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-400 outline-none transition hover:text-white focus-visible:underline" href={backHref}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          {copy.titulo}
        </Link>
      </nav>

      <article className="grid gap-6 sm:grid-cols-[200px_1fr] sm:gap-8 lg:grid-cols-[240px_1fr] lg:gap-10">
        <div className="mx-auto w-full max-w-[220px] sm:mx-0 sm:max-w-none">
          <div className="relative aspect-[2/3] overflow-hidden rounded-[var(--member-cover-radius)] bg-[#1f1f1f] ring-1 ring-white/[0.08]">
            {cover ? (
              <Image alt="" className="object-cover" fill priority sizes="(min-width: 1024px) 240px, (min-width: 640px) 200px, 220px" src={cover} unoptimized={!canOptimizeImageSrc(cover)} />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#262626,#151515)] text-zinc-500">
                <ImageOff aria-hidden="true" className="size-7" strokeWidth={1.8} />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <MemberChip tone="neutral">{view.kindLabel}</MemberChip>
            {view.jit ? (
              <MemberChip icon={Radio} tone="outline">
                {WEBINAR_COPY.jit.aluno.selo}
              </MemberChip>
            ) : null}
            {!view.jit || primary ? (
              <MemberChip icon={view.phase === "live" ? Radio : undefined} tone={PHASE_TONES[view.phase]}>
                {phaseLabel(view.phase)}
              </MemberChip>
            ) : null}
          </div>
          <h1 className="mt-3 text-[28px] font-black leading-[1.08] text-white sm:text-4xl">{view.title}</h1>
          {view.description ? (
            <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-6 text-zinc-400 sm:text-[15px] sm:leading-7">{view.description}</p>
          ) : null}

          {primary ? <WebinarFacts className="mt-5" durationLabel={view.durationLabel} presenterName={view.presenterName} session={primary} /> : null}
          {!primary && view.jit ? (
            <p className="mt-5 text-sm text-zinc-400">
              {copy.duracao}: <span className="text-zinc-200">{view.durationLabel}</span>
              {view.presenterName ? (
                <>
                  {" · "}
                  {copy.apresentador}: <span className="text-zinc-200">{view.presenterName}</span>
                </>
              ) : null}
            </p>
          ) : null}

          {primary && upcoming ? (
            <p className="mt-5 flex items-center gap-2 text-lg font-bold text-white">
              <CalendarClock aria-hidden="true" className="size-5 shrink-0 text-[var(--accent)]" strokeWidth={2.2} />
              <WebinarCountdown fallback={copy.aguardando} serverNow={serverNow} targetIso={primary.scheduledAt} />
            </p>
          ) : null}
          {primary && upcoming && primary.registeredCount !== null && view.kind !== "simulated" ? (
            <p className="mt-1 text-xs text-zinc-500">{copy.vagasGarantidas(primary.registeredCount)}</p>
          ) : null}

          {view.jit ? (
            <div className="mt-6">
              <JitEnter accessPreviewMode={accessPreviewMode} jit={view.jit} readOnly={readOnly} serverNow={serverNow} webinarId={view.id} />
            </div>
          ) : null}

          <div className="mt-6">
            <PhaseBlock
              accessPreviewMode={accessPreviewMode}
              calendars={calendars}
              liveRoomConfigured={liveRoomConfigured}
              readOnly={readOnly}
              serverNow={serverNow}
              source={source}
              view={view}
            />
          </div>
        </div>
      </article>
    </MemberPage>
  );
}
