"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { StatusChip } from "../status-chip";
import { adminCard, adminTransition } from "../styles";
import { AI_PROVIDERS, AI_PROVIDER_PARAM, type AiProviderId, type AiTone } from "./ai-settings-model";

export type AiProviderPickerEntry = {
  /** Linha de apoio, ex.: o modelo escolhido ou "2 chaves · 1 conta". */
  detail: string;
  provider: AiProviderId;
  status: { label: string; tone: AiTone };
};

type AiProviderPickerProps = {
  basePath: string;
  entries: readonly AiProviderPickerEntry[];
  /** Chamado antes de trocar; chame event.preventDefault() para segurar (ex.: alteracoes nao salvas). */
  onNavigate?: (provider: AiProviderId, event: MouseEvent<HTMLAnchorElement>) => void;
  selected: AiProviderId;
};

/** Os tres provedores lado a lado; o escolhido vai para ?provedor= (link compartilhavel). */
export function AiProviderPicker({ basePath, entries, onNavigate, selected }: AiProviderPickerProps) {
  return (
    <nav aria-label="Provedor de IA">
      <ul className="grid gap-3 sm:grid-cols-3">
        {AI_PROVIDERS.map((meta) => {
          const entry = entries.find((item) => item.provider === meta.id);
          const active = meta.id === selected;

          return (
            <li className="min-w-0" key={meta.id}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  adminCard,
                  adminTransition,
                  "flex min-h-[76px] w-full min-w-0 flex-col justify-center gap-1 px-4 py-3",
                  active
                    ? "border-[var(--text-secondary)] bg-[var(--surface-2)]"
                    : "hover:border-[var(--border-strong)] hover:bg-[var(--hover-overlay)]"
                )}
                data-navigation-feedback="false"
                href={`${basePath}?${AI_PROVIDER_PARAM}=${meta.id}`}
                onClick={(event) => onNavigate?.(meta.id, event)}
                replace
                scroll={false}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm leading-5 font-semibold text-[var(--text-primary)]">{meta.label}</span>
                  {entry ? <StatusChip tone={entry.status.tone}>{entry.status.label}</StatusChip> : null}
                </span>
                <span className="truncate text-[13px] leading-5 text-[var(--text-secondary)]">{entry?.detail ?? "Ainda não configurado"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
