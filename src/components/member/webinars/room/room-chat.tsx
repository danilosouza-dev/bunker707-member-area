"use client";

import { MoreHorizontal, Pin, SendHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberChip, type MemberChipTone } from "@/components/member/ui/member-chip";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { composerState, type ComposerState, type RoomMessage } from "@/lib/webinar-room-client";
import { CHAT_CONSENT_VERSION, CHAT_LIMITS, type ChatMode, type ChatRole, type DisplayNameMode, type SimulatedPhase } from "@/server/webinars/model";
import type { ChatPostBody } from "./room-api";

// O painel do chat da Sala (docs/30 §1.3, §1.6, §8.5 e §9): a lista em role="log" (em rajada, o leitor de tela
// ouve "N mensagens novas" em vez de cada uma), a mensagem fixada no topo, os selos Equipe / Apresentador /
// Assistente, a pendente do proprio aluno ("Aguardando a equipe"), o aceite na primeira mensagem (o texto de §8.5,
// palavra por palavra, com "Entendi e quero participar" e "Participar como anonimo", e como o nome aparece), o
// compositor (desligado, so a equipe, modo lento com a contagem) e o menu "..." com Remover minhas mensagens.

export type RoomChatPanelProps = {
  busy?: boolean;
  chatMode: ChatMode;
  consented: boolean;
  defaultDisplayMode: DisplayNameMode;
  displayName: string | null;
  error: string | null;
  messages: readonly RoomMessage[];
  nowMs: number;
  onRemoveMine: () => Promise<number>;
  onSend: (body: Omit<ChatPostBody, "sessionId">) => Promise<{ pending: boolean }>;
  phase: SimulatedPhase | "replay";
  pinned: RoomMessage | null;
  /** "Ver como" da equipe: mostra, mas nao grava. */
  readOnly: boolean;
  slowUntilMs: number | null;
};

const ROLE_BADGES: Partial<Record<ChatRole, { label: string; tone: MemberChipTone }>> = {
  ai: { label: WEBINAR_COPY.sala.selos.assistente, tone: "outline" },
  host: { label: WEBINAR_COPY.sala.selos.apresentador, tone: "accent" },
  team: { label: WEBINAR_COPY.sala.selos.equipe, tone: "neutral" }
};

export function RoomMessageItem({ message }: { message: RoomMessage }) {
  const badge = ROLE_BADGES[message.role];
  const prefix = badge ? `${badge.label}: ` : "";

  return (
    <li className={cn("rounded-[10px] px-2 py-1.5", message.mine ? "bg-white/[0.05]" : undefined)} data-room-message={message.id}>
      <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <span className="sr-only">{prefix}</span>
        <span className={cn("font-bold", badge ? "text-white" : "text-zinc-200")}>{message.displayName}</span>
        {badge ? (
          <MemberChip size="sm" tone={badge.tone}>
            {badge.label}
          </MemberChip>
        ) : null}
        {message.pending ? (
          <MemberChip size="sm" tone="warning">
            {WEBINAR_COPY.sala.aguardandoEquipe}
          </MemberChip>
        ) : null}
      </p>
      <p className="whitespace-pre-line break-words text-sm leading-5 text-zinc-100">{message.body}</p>
    </li>
  );
}

function RoomPinned({ message }: { message: RoomMessage }) {
  return (
    <div className="border-b border-white/10 bg-[#161616] px-3 py-2" data-testid="room-pinned">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        <Pin aria-hidden="true" className="size-3" />
        {WEBINAR_COPY.sala.fixada}
      </p>
      <p className="mt-0.5 text-sm text-zinc-100">
        <span className="font-bold text-white">{message.displayName}</span> {message.body}
      </p>
    </div>
  );
}

export type ConsentChoice = { displayMode: DisplayNameMode; nickname: string };

/** O aceite (docs/30 §8.5): o texto exato, como o nome aparece e os dois botoes. */
export function RoomConsentBox({ busy, defaultDisplayMode, onAccept, onCancel }: { busy?: boolean; defaultDisplayMode: DisplayNameMode; onAccept: (choice: ConsentChoice) => void; onCancel: () => void }) {
  const copy = WEBINAR_COPY.sala;
  const id = useId();
  const [mode, setMode] = useState<DisplayNameMode>(defaultDisplayMode === "anonymous" ? "first_name_initial" : defaultDisplayMode);
  const [nickname, setNickname] = useState("");
  const nicknameInvalid = mode === "nickname" && (nickname.trim().length < CHAT_LIMITS.nicknameMin || nickname.trim().length > CHAT_LIMITS.nicknameMax);

  return (
    <div className="border-t border-white/10 bg-[#161616] px-3 py-3" data-testid="room-consent" role="group" aria-labelledby={`${id}-title`}>
      <p className="text-sm leading-6 text-zinc-100" id={`${id}-title`}>
        {copy.consentimento}
      </p>
      <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-zinc-400">{copy.comoAparece}</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {(["first_name_initial", "nickname"] as const).map((option) => (
            <label className="inline-flex min-h-8 items-center gap-2 text-zinc-200" key={option}>
              <input checked={mode === option} className="accent-white" name={`${id}-mode`} onChange={() => setMode(option)} type="radio" value={option} />
              {option === "nickname" ? copy.responderComo.apelido : copy.responderComo.nome}
            </label>
          ))}
        </div>
        {mode === "nickname" ? (
          <input
            aria-invalid={nicknameInvalid || undefined}
            aria-label={copy.responderComo.apelido}
            className="mt-2 h-10 w-full rounded-[10px] border border-white/15 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-zinc-500 focus-visible:border-white/40"
            maxLength={CHAT_LIMITS.nicknameMax}
            onChange={(event) => setNickname(event.target.value)}
            placeholder={copy.apelidoPlaceholder}
            value={nickname}
          />
        ) : null}
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-2">
        <MemberButton disabled={busy || nicknameInvalid} onClick={() => onAccept({ displayMode: mode, nickname: nickname.trim() })} size="sm" variant="primary">
          {copy.consentimentoBotao}
        </MemberButton>
        <MemberButton disabled={busy} onClick={() => onAccept({ displayMode: "anonymous", nickname: "" })} size="sm" variant="secondary">
          {copy.participarComoAnonimo}
        </MemberButton>
        <MemberButton disabled={busy} onClick={onCancel} size="sm" variant="ghost">
          {WEBINAR_COPY.admin.cancelar}
        </MemberButton>
      </div>
    </div>
  );
}

function composerHint(state: ComposerState, phase: SimulatedPhase | "replay"): string {
  const copy = WEBINAR_COPY.sala;
  switch (state.reason) {
    case "chat_off":
      return copy.chatDesligado;
    case "team_only":
      return copy.chatSoEquipe;
    case "slow_mode":
      return copy.modoLento(state.waitSeconds);
    case "ended":
      return phase === "replay" ? "" : copy.encerrada;
    default:
      return "";
  }
}

export function RoomChatPanel(props: RoomChatPanelProps) {
  const { busy = false, chatMode, consented, defaultDisplayMode, error, messages, nowMs, onRemoveMine, onSend, phase, pinned, readOnly, slowUntilMs } = props;
  const copy = WEBINAR_COPY.sala;
  const [draft, setDraft] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLOListElement | null>(null);
  const knownRef = useRef<Set<string>>(new Set());
  const stickRef = useRef(true);
  const state = composerState({ chatMode, consented, nowMs, phase, slowUntilMs });
  const hint = composerHint(state, phase);

  // Mensagens novas: anuncia "N mensagens novas" em rajada; a lista rola so quando o aluno esta no fim.
  useEffect(() => {
    const fresh = messages.filter((message) => !knownRef.current.has(message.id));
    if (fresh.length === 0) {
      return;
    }
    fresh.forEach((message) => knownRef.current.add(message.id));
    if (fresh.length > 1) {
      setAnnounce(copy.mensagensNovas(fresh.length));
    }
    const list = listRef.current;
    if (list && stickRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [copy, messages]);

  function handleScroll() {
    const list = listRef.current;
    if (list) {
      stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    }
  }

  async function deliver(extra: Partial<ChatPostBody> = {}) {
    const text = draft.trim();
    if (!text || readOnly) {
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      const answer = await onSend({ body: text, kind: "message", ...extra });
      setDraft("");
      setConsentOpen(false);
      setStatus(answer.pending ? copy.aguardandoEquipe : null);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
    } finally {
      setSending(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (state.disabled || !draft.trim()) {
      return;
    }
    if (!consented) {
      setConsentOpen(true);
      return;
    }
    void deliver();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  async function removeMine() {
    setConfirmRemove(false);
    setMenuOpen(false);
    try {
      const removed = await onRemoveMine();
      setStatus(removed > 0 ? WEBINAR_COPY.privacidade.feito(removed) : WEBINAR_COPY.privacidade.nadaParaRemover);
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : copy.erroEnviar);
    }
  }

  const single = messages.length <= 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="room-chat">
      {pinned ? <RoomPinned message={pinned} /> : null}
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{phase === "replay" ? copy.abas.chatDaLive : copy.abas.chat}</p>
        <div className="relative">
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="Mais opções"
            className="grid size-9 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] rounded-[12px] border border-white/10 bg-[#1b1b1b] p-1 shadow-[0_18px_48px_rgba(0,0,0,0.5)]" role="menu">
              <button
                className="flex h-10 w-full items-center rounded-[8px] px-3 text-left text-sm font-semibold text-zinc-200 hover:bg-white/[0.07] hover:text-white"
                disabled={readOnly}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmRemove(true);
                }}
                role="menuitem"
                type="button"
              >
                {copy.removerMinhasMensagens}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {confirmRemove ? (
        <div className="mx-3 mt-2 rounded-[12px] border border-red-400/25 bg-red-500/10 p-3" role="alertdialog" aria-label={WEBINAR_COPY.privacidade.confirmar}>
          <p className="text-sm font-bold text-white">{WEBINAR_COPY.privacidade.confirmar}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-300">{WEBINAR_COPY.privacidade.confirmarTexto}</p>
          <div className="mt-2 flex gap-2">
            <MemberButton onClick={() => void removeMine()} size="sm" variant="danger">
              {copy.removerMinhasMensagens}
            </MemberButton>
            <MemberButton onClick={() => setConfirmRemove(false)} size="sm" variant="ghost">
              {WEBINAR_COPY.admin.cancelar}
            </MemberButton>
          </div>
        </div>
      ) : null}

      <ol
        aria-label={copy.abas.chat}
        aria-live={single ? "polite" : "off"}
        aria-relevant="additions"
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2"
        onScroll={handleScroll}
        ref={listRef}
        role="log"
      >
        {messages.length === 0 ? <li className="px-2 py-6 text-center text-sm text-zinc-500">{error ?? copy.semMensagens}</li> : null}
        {messages.map((message) => (
          <RoomMessageItem key={message.id} message={message} />
        ))}
      </ol>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {consentOpen && !consented ? (
        <RoomConsentBox
          busy={sending}
          defaultDisplayMode={defaultDisplayMode}
          onAccept={(choice) =>
            void deliver({
              anonymous: choice.displayMode === "anonymous",
              consent: true,
              consentVersion: CHAT_CONSENT_VERSION,
              displayMode: choice.displayMode,
              ...(choice.displayMode === "nickname" ? { nickname: choice.nickname } : {})
            })
          }
          onCancel={() => setConsentOpen(false)}
        />
      ) : null}

      <form className="border-t border-white/10 bg-[#111] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" onSubmit={submit}>
        <div className="flex items-end gap-2">
          <textarea
            aria-label={copy.escreva}
            className="max-h-24 min-h-11 flex-1 resize-none rounded-[12px] border border-white/15 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus-visible:border-white/40 disabled:opacity-50"
            disabled={state.disabled || readOnly || busy}
            maxLength={CHAT_LIMITS.body}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hint || copy.escreva}
            rows={1}
            value={draft}
          />
          <button
            aria-label={copy.enviar}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40"
            disabled={state.disabled || readOnly || sending || !draft.trim()}
            type="submit"
          >
            <SendHorizontal aria-hidden="true" className="size-4" />
          </button>
        </div>
        <p aria-live="polite" className={cn("mt-1 min-h-4 px-1 text-[11px]", status && status !== copy.aguardandoEquipe ? "text-amber-200" : "text-zinc-500")}>
          {status ?? (readOnly ? WEBINAR_COPY.aluno.previaSemGravar : hint)}
        </p>
      </form>
    </div>
  );
}
