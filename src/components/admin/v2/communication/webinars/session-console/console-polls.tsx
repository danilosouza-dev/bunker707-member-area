"use client";

import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { pollPercent, type ConsolePollView } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import type { Poll } from "@/server/webinars/model";
import { pollPinnable } from "@/server/webinars/screen-model";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// O painel Enquetes do console (docs/30 §2.4): as prontas (os modelos do editor) com Abrir, e as desta sessao com
// as contagens ao vivo, Encerrar e Compartilhar resultado. A enquete fixada (a Na tela, R2; especificacao de
// 10/11/2026, §6.3): em "Nesta sessão", numa enquete aberta ou encerrada com o resultado compartilhado
// (screen-model.pollPinnable), o Fixar; a fixada (o pinnedPollId do retrato) leva o selo Fixada e o Desafixar. Em
// "Prontas", o "Abrir e fixar" ao lado do Abrir. O Compartilhar resultado mantem a fixada (agora com as barras); o
// Encerrar sem compartilhar desafixa (o servidor tira da tela). Os avisos ficam com quem chama (session-console.tsx).

const copy = WEBINAR_ADMIN_COPY.console.polls;
const pollsCopy = WEBINAR_ADMIN_COPY.polls;
const pinCopy = WEBINAR_COPY.naTela.enquetes;

type ConsolePollsProps = {
  busyKey: string | null;
  canAct: boolean;
  launched: readonly ConsolePollView[];
  onClose: (pollId: string, shareResults: boolean) => void;
  /** Abrir uma pronta; `pin`: o "Abrir e fixar". */
  onLaunch: (templateId: string, pin: boolean) => void;
  /** Fixar uma enquete desta sessao (troca a fixada de antes). */
  onPin: (pollId: string) => void;
  /** Desafixar a enquete fixada (a que esta em `pinnedPollId`). */
  onUnpin: (pollId: string) => void;
  /** A enquete fixada da sessao (snapshot.pinnedPollId); nula sem ela. */
  pinnedPollId: string | null;
  templates: readonly Poll[];
};

export function ConsolePolls({ busyKey, canAct, launched, onClose, onLaunch, onPin, onUnpin, pinnedPollId, templates }: ConsolePollsProps) {
  const openTemplates = new Set(launched.filter((poll) => poll.status === "open").map((poll) => poll.templatePollId));

  return (
    <SectionCard title={copy.title} titleId="console-polls-title">
      <div className="flex min-w-0 flex-col gap-4">
        {launched.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-3">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.launched}</span>
            <ul className="flex min-w-0 flex-col gap-3" data-console-polls-launched="">
              {launched.map((poll) => {
                const pinned = pinnedPollId === poll.id;
                const busy = busyKey === `poll:${poll.id}`;

                return (
                  <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-console-poll={poll.id} data-poll-pinned={pinned ? "" : undefined} data-poll-status={poll.status} key={poll.id}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm leading-5 font-medium text-[var(--text-primary)]">{poll.question}</span>
                      <StatusChip tone={poll.status === "open" ? "success" : "muted"}>{poll.status === "open" ? copy.open : copy.closed}</StatusChip>
                      {poll.resultsSharedAt ? <StatusChip tone="neutral">{copy.shared}</StatusChip> : null}
                      {pinned ? <StatusChip tone="neutral">{pinCopy.fixada}</StatusChip> : null}
                      <span className="text-xs leading-5 text-[var(--text-tertiary)]">{copy.answers(poll.counts.answers)}</span>
                    </div>
                    <ul className="flex min-w-0 flex-col gap-1">
                      {poll.options.map((option) => {
                        const percent = pollPercent(poll.counts, option.id);

                        return (
                          <li className="flex min-w-0 flex-col gap-0.5 text-[13px] leading-5" key={option.id}>
                            <span className="flex min-w-0 items-center justify-between gap-2 text-[var(--text-primary)]">
                              <span className="truncate">{option.label}</span>
                              <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">
                                {poll.counts.byOption[option.id] ?? 0} · {percent}%
                              </span>
                            </span>
                            <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                              <span className="block h-full rounded-full bg-[var(--text-secondary)]" style={{ width: `${percent}%` }} />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {canAct ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {poll.status === "open" ? (
                          <Button className="h-8! px-2 text-[13px]" disabled={busy} onClick={() => onClose(poll.id, false)} type="button" variant="secondary">
                            {copy.close}
                          </Button>
                        ) : null}
                        {!poll.resultsSharedAt ? (
                          <Button className="h-8! px-2 text-[13px]" disabled={busy} onClick={() => onClose(poll.id, true)} type="button" variant="secondary">
                            {copy.share}
                          </Button>
                        ) : null}
                        {pinned ? (
                          <Button className="h-8! px-2 text-[13px]" data-console-poll-pin="unpin" disabled={busy} onClick={() => onUnpin(poll.id)} type="button" variant="secondary">
                            {pinCopy.desafixar}
                          </Button>
                        ) : pollPinnable(poll) ? (
                          <Button className="h-8! px-2 text-[13px]" data-console-poll-pin="pin" disabled={busy} onClick={() => onPin(poll.id)} type="button" variant="secondary">
                            {pinCopy.fixar}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col gap-3">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.templates}</span>
          {templates.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</p> : null}
          <ul className="flex min-w-0 flex-col gap-2" data-console-polls-templates="">
            {templates.map((poll) => (
              <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-console-poll-template={poll.id} key={poll.id}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm leading-5 text-[var(--text-primary)]">{poll.question}</span>
                  <span className="text-xs leading-5 text-[var(--text-tertiary)]">
                    {pollsCopy.kinds[poll.kind]} · {poll.options.length} {pollsCopy.options.toLocaleLowerCase("pt-BR")}
                  </span>
                </span>
                {openTemplates.has(poll.id) ? (
                  <StatusChip tone="success">{copy.open}</StatusChip>
                ) : (
                  <span className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button className="h-8! px-2 text-[13px]" disabled={!canAct || busyKey === `poll:${poll.id}`} onClick={() => onLaunch(poll.id, false)} type="button" variant="secondary">
                      {copy.launch}
                    </Button>
                    <Button className="h-8! px-2 text-[13px]" data-console-poll-launch-pin="" disabled={!canAct || busyKey === `poll:${poll.id}`} onClick={() => onLaunch(poll.id, true)} type="button" variant="secondary">
                      {pinCopy.abrirEFixar}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}
