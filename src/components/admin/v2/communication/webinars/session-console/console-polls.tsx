"use client";

import { Button } from "@/components/ui/button";
import { pollPercent, type ConsolePollView } from "@/server/webinars/console-model";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import type { Poll } from "@/server/webinars/model";
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";

// O painel Enquetes do console (docs/30 §2.4): as prontas (os modelos do editor) com Abrir, e as desta sessao com
// as contagens ao vivo, Encerrar e Compartilhar resultado.

const copy = WEBINAR_ADMIN_COPY.console.polls;
const pollsCopy = WEBINAR_ADMIN_COPY.polls;

type ConsolePollsProps = {
  busyKey: string | null;
  canAct: boolean;
  launched: readonly ConsolePollView[];
  onClose: (pollId: string, shareResults: boolean) => void;
  onLaunch: (templateId: string) => void;
  templates: readonly Poll[];
};

export function ConsolePolls({ busyKey, canAct, launched, onClose, onLaunch, templates }: ConsolePollsProps) {
  const openTemplates = new Set(launched.filter((poll) => poll.status === "open").map((poll) => poll.templatePollId));

  return (
    <SectionCard title={copy.title} titleId="console-polls-title">
      <div className="flex min-w-0 flex-col gap-4">
        {launched.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-3">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.launched}</span>
            <ul className="flex min-w-0 flex-col gap-3" data-console-polls-launched="">
              {launched.map((poll) => (
                <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-console-poll={poll.id} data-poll-status={poll.status} key={poll.id}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-sm leading-5 font-medium text-[var(--text-primary)]">{poll.question}</span>
                    <StatusChip tone={poll.status === "open" ? "success" : "muted"}>{poll.status === "open" ? copy.open : copy.closed}</StatusChip>
                    {poll.resultsSharedAt ? <StatusChip tone="neutral">{copy.shared}</StatusChip> : null}
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
                        <Button className="h-8! px-2 text-[13px]" disabled={busyKey === `poll:${poll.id}`} onClick={() => onClose(poll.id, false)} type="button" variant="secondary">
                          {copy.close}
                        </Button>
                      ) : null}
                      {!poll.resultsSharedAt ? (
                        <Button className="h-8! px-2 text-[13px]" disabled={busyKey === `poll:${poll.id}`} onClick={() => onClose(poll.id, true)} type="button" variant="secondary">
                          {copy.share}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
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
                    {poll.anonymous ? ` · ${pollsCopy.anonymous.toLocaleLowerCase("pt-BR")}` : ""}
                  </span>
                </span>
                {openTemplates.has(poll.id) ? (
                  <StatusChip tone="success">{copy.open}</StatusChip>
                ) : (
                  <Button className="h-8! px-2 text-[13px]" disabled={!canAct || busyKey === `poll:${poll.id}`} onClick={() => onLaunch(poll.id)} type="button" variant="secondary">
                    {copy.launch}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}
