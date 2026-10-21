"use client";

import { AlertCircle, Bell, Split, TriangleAlert, Users } from "lucide-react";
import type { ReactNode } from "react";
import { NoticeTitleIcon } from "@/components/member/notifications/notice-icons";
import { cn } from "@/lib/utils";
import type { NoticeIconChoice } from "@/server/communications/schemas";
import { RowMenu, type RowMenuAction } from "../../settings/kit";
import { StudentAvatar } from "../../students/student-avatar";
import { adminTransition } from "../../styles";

// Cartoes do construtor e do relatorio de fluxos (docs/23 §2.5): "Quem entra" (a frase, a contagem e o jeito
// de entrar), Notificação (quem envia, o icone e o titulo, o tempo no sino e o filtro) e Condição (a frase e
// "Espera até ser Sim…"). 320 px no computador; a largura toda no celular. O cartao inteiro e um botao (abre
// o painel do passo, ou a folha no celular); o menu "…" fica por cima. Um passo com erro mostra a frase em
// vermelho; um aviso (caminho sem notificacao), em amarelo. Nos fluxos no ar, os numeros ficam embaixo.

type CardShellProps = {
  children: ReactNode;
  /** Rotulo do passo para leitores de tela ("Notificação: Oferta especial!"). */
  label: string;
  menu?: readonly RowMenuAction[];
  menuLabel?: string;
  /** Linha de numeros (relatorio e alteracoes no ar). */
  numbers?: ReactNode;
  onSelect: () => void;
  problem?: { text: string; tone: "error" | "warning" } | null;
  selected: boolean;
  stepId: string;
};

function CardShell({ children, label, menu, menuLabel, numbers, onSelect, problem, selected, stepId }: CardShellProps) {
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-[var(--surface-1)] p-4 lg:w-80",
        selected ? "border-[var(--text-primary)] shadow-[0_0_0_1px_var(--text-primary)]" : "border-[var(--border-strong)] hover:border-[var(--text-tertiary)]",
        problem?.tone === "error" && !selected && "border-[var(--error-border)]",
        adminTransition
      )}
      data-flow-step={stepId}
    >
      <button
        aria-current={selected ? "true" : undefined}
        aria-label={label}
        className="absolute inset-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        onClick={onSelect}
        type="button"
      />
      <div className={cn("pointer-events-none flex min-w-0 flex-col gap-2", menu && menu.length > 0 && "pr-8")}>{children}</div>
      {numbers ? <div className="pointer-events-none border-t border-[var(--border-subtle)] pt-2 text-xs leading-5 text-[var(--text-secondary)] tabular-nums">{numbers}</div> : null}
      {problem ? (
        <p className={cn("pointer-events-none flex items-start gap-1.5 text-xs leading-5", problem.tone === "error" ? "text-[var(--error)]" : "text-[var(--warning)]")}>
          {problem.tone === "error" ? <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
          {problem.text}
        </p>
      ) : null}
      {menu && menu.length > 0 ? (
        <div className="absolute top-2 right-2 z-10">
          <RowMenu actions={menu} label={menuLabel ?? `Ações de ${label}`} />
        </div>
      ) : null}
    </div>
  );
}

function Kind({ children, icon }: { children: string; icon: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs leading-4 font-medium text-[var(--text-tertiary)]">
      {icon}
      {children}
    </span>
  );
}

type EntryCardProps = Omit<CardShellProps, "children" | "label"> & {
  countLine: string | null;
  /** O jeito de entrar ("Quem está no segmento agora"); no fluxo de aviso, nada. */
  modeLabel: string | null;
  sentence: string;
};

export function EntryCard({ countLine, modeLabel, sentence, ...shell }: EntryCardProps) {
  return (
    <CardShell {...shell} label={`Quem entra: ${sentence}`}>
      <Kind icon={<Users aria-hidden="true" className="size-3.5" />}>Quem entra</Kind>
      <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">{sentence}</p>
      {countLine ? <p className="text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">{countLine}</p> : null}
      {modeLabel ? <p className="text-xs leading-5 text-[var(--text-tertiary)]">{modeLabel}</p> : null}
    </CardShell>
  );
}

/** O circulo de quem envia: a foto (ou as iniciais) da pessoa, ou o icone da escola. */
function SenderCircle({ sender, schoolIconUrl }: { schoolIconUrl: string; sender: { avatarUrl: string | null; name: string } | null }) {
  if (sender) {
    return <StudentAvatar avatarUrl={sender.avatarUrl} className="size-6 text-[10px]" name={sender.name} />;
  }

  return (
    <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--border-subtle)] bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element -- icone da escola (svg ou upload), 24 px */}
      <img alt="" className="size-full object-contain p-0.5" src={schoolIconUrl} />
    </span>
  );
}

type MessageCardProps = Omit<CardShellProps, "children" | "label"> & {
  filterLine: string | null;
  icon: NoticeIconChoice;
  schoolIconUrl: string;
  sender: { avatarUrl: string | null; name: string } | null;
  title: string;
  validityLine: string;
};

export function MessageCard({ filterLine, icon, schoolIconUrl, sender, title, validityLine, ...shell }: MessageCardProps) {
  return (
    <CardShell {...shell} label={`Notificação: ${title}`}>
      <Kind icon={<Bell aria-hidden="true" className="size-3.5" />}>Notificação</Kind>
      <div className="flex min-w-0 items-center gap-2">
        <SenderCircle schoolIconUrl={schoolIconUrl} sender={sender} />
        <p className="flex min-w-0 items-center gap-1.5 text-sm leading-5 font-medium text-[var(--text-primary)]">
          <NoticeTitleIcon icon={icon} size="bell" />
          <span className="truncate">{title}</span>
        </p>
      </div>
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{validityLine}</p>
      {filterLine ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{filterLine}</p> : null}
    </CardShell>
  );
}

type ConditionCardProps = Omit<CardShellProps, "children" | "label"> & {
  sentence: string;
  waitLine: string | null;
};

export function ConditionCard({ sentence, waitLine, ...shell }: ConditionCardProps) {
  return (
    <CardShell {...shell} label={`Condição: ${sentence}`}>
      <Kind icon={<Split aria-hidden="true" className="size-3.5" />}>Condição</Kind>
      <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">{sentence}</p>
      {waitLine ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{waitLine}</p> : null}
    </CardShell>
  );
}
