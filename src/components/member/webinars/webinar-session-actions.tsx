"use client";

import { CalendarPlus, CheckCircle2, ChevronDown, Radio } from "lucide-react";
import { useState } from "react";
import { MemberButton, MemberButtonLink, memberButtonClassName } from "@/components/member/ui/member-button";
import { MemberChip } from "@/components/member/ui/member-chip";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { StudentPhase } from "@/server/webinars/model";
import { cancelWebinarRegistration, registerForWebinar, WebinarsRequestError } from "./webinars-client";

// Garantir vaga em 1 clique (docs/30 §1.2): sem formulario, a area ja sabe quem e o aluno. A confirmacao
// "Vaga garantida. Avisamos voce 1 dia e 1 hora antes." e inline, em aria-live (o lado do aluno nao tem
// Toaster), com o menu Adicionar ao calendario (Baixar arquivo, Google Agenda, Outlook) e Cancelar minha vaga.
// Um pedido por vez (o botao trava enquanto espera); 409 do servidor muda a situacao na hora (vagas
// esgotadas, live encerrada ou cancelada). No "ver como" da equipe nada e gravado: os botoes ficam desligados.
// Com a sessao ja aberta e limite de vagas (A12), o aluno sem vaga garante aqui e o Entrar aparece em seguida.

export type SessionCalendarLinks = { downloadUrl: string; googleUrl: string; outlookUrl: string };

type Status = { text: string; tone: "error" | "ok" };

const menuItemClassName =
  "flex h-10 items-center gap-2 rounded-[8px] px-3 text-sm font-semibold text-zinc-200 outline-none transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

function CalendarMenu({ links }: { links: SessionCalendarLinks }) {
  const copy = WEBINAR_COPY.aluno;

  return (
    <details className="relative">
      <summary className={memberButtonClassName({ className: "cursor-pointer list-none [&::-webkit-details-marker]:hidden", variant: "secondary" })}>
        <CalendarPlus aria-hidden="true" />
        {copy.adicionarCalendario}
        <ChevronDown aria-hidden="true" />
      </summary>
      <ul className="absolute left-0 top-full z-20 mt-2 min-w-[14rem] rounded-[12px] border border-white/10 bg-[#1b1b1b] p-1 shadow-[0_18px_48px_rgba(0,0,0,0.5)]">
        <li>
          <a className={menuItemClassName} download href={links.downloadUrl}>
            {copy.baixarArquivo}
          </a>
        </li>
        <li>
          <a className={menuItemClassName} href={links.googleUrl} rel="noreferrer" target="_blank">
            {copy.googleAgenda}
          </a>
        </li>
        <li>
          <a className={menuItemClassName} href={links.outlookUrl} rel="noreferrer" target="_blank">
            {copy.outlook}
          </a>
        </li>
      </ul>
    </details>
  );
}

export function WebinarSessionActions({
  calendar: initialCalendar,
  enterHref = null,
  phase: initialPhase,
  readOnly,
  registered: initialRegistered,
  sessionId,
  source,
  webinarId
}: {
  /** Links do calendario quando o aluno ja tem vaga (vindos do servidor). */
  calendar: SessionCalendarLinks | null;
  /** A sala desta sessao, quando ela ja abriu: com a vaga garantida, o Entrar aparece junto. */
  enterHref?: string | null;
  phase: StudentPhase;
  /** "Ver como" da equipe: mostra, mas nao grava. */
  readOnly: boolean;
  registered: boolean;
  sessionId: string;
  /** Link de origem (?origem=), guardado na vaga para o relatorio. */
  source: string | null;
  webinarId: string;
}) {
  const copy = WEBINAR_COPY.aluno;
  const [phase, setPhase] = useState<StudentPhase>(initialPhase);
  const [registered, setRegistered] = useState(initialRegistered);
  const [calendar, setCalendar] = useState<SessionCalendarLinks | null>(initialCalendar);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  async function register() {
    setBusy(true);
    setStatus(null);

    try {
      const answer = await registerForWebinar(webinarId, { sessionId, source }, copy.erroVaga);
      setRegistered(true);
      setPhase("registered");
      setCalendar({ downloadUrl: answer.calendarUrl, googleUrl: answer.googleUrl, outlookUrl: answer.outlookUrl });
      setStatus({ text: copy.vagaGarantidaToast, tone: "ok" });
    } catch (error) {
      const failure = error instanceof WebinarsRequestError ? error : null;

      if (failure?.reason === "sold_out") {
        setPhase("sold_out");
      } else if (failure?.reason === "ended") {
        setPhase("ended");
      } else if (failure?.reason === "cancelled") {
        setPhase("cancelled");
      }

      setStatus({ text: failure?.message ?? copy.erroVaga, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setStatus(null);

    try {
      await cancelWebinarRegistration(webinarId, { sessionId }, copy.erroCancelar);
      setRegistered(false);
      setCalendar(null);
      setPhase("scheduled");
      setStatus({ text: copy.vagaCanceladaToast, tone: "ok" });
    } catch (error) {
      const failure = error instanceof WebinarsRequestError ? error : null;
      setStatus({ text: failure?.message ?? copy.erroCancelar, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) {
    return (
      <div className="grid gap-2">
        <MemberButton aria-disabled="true" disabled size="lg" variant="primary">
          {copy.garantirVaga}
        </MemberButton>
        <p className="text-xs text-zinc-500">{copy.previaSemGravar}</p>
      </div>
    );
  }

  let controls = null;

  if (registered) {
    controls = (
      <div className="flex flex-wrap items-center gap-2">
        {enterHref ? (
          <MemberButtonLink href={enterHref} size="lg" variant="primary">
            <Radio />
            {copy.entrar}
          </MemberButtonLink>
        ) : null}
        <MemberChip icon={CheckCircle2} size="md" tone="success">
          {copy.selo.vagaGarantida}
        </MemberChip>
        {calendar ? <CalendarMenu links={calendar} /> : null}
        <MemberButton disabled={busy} onClick={cancel} variant="ghost">
          {copy.cancelarVaga}
        </MemberButton>
      </div>
    );
  } else if (phase === "sold_out") {
    controls = <p className="text-sm leading-6 text-zinc-300">{copy.esgotado}</p>;
  } else if (phase === "ended") {
    controls = <p className="text-sm leading-6 text-zinc-300">{copy.encerrada}</p>;
  } else if (phase === "cancelled") {
    controls = <p className="text-sm leading-6 text-zinc-300">{copy.cancelada}</p>;
  } else {
    controls = (
      <MemberButton disabled={busy} onClick={register} size="lg" variant="primary">
        {copy.garantirVaga}
      </MemberButton>
    );
  }

  return (
    <div className="grid gap-2">
      {controls}
      <p aria-live="polite" className={`min-h-5 text-sm font-medium ${status?.tone === "error" ? "text-red-300" : "text-emerald-300"}`}>
        {status?.text ?? ""}
      </p>
    </div>
  );
}
