"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Ban, Check } from "lucide-react";
import { NOTICE_ICON_GLYPHS } from "@/components/member/notifications/notice-icons";
import { cn } from "@/lib/utils";
import {
  NOTICE_ICON_COLOR_LABELS,
  NOTICE_ICON_COLORS,
  NOTICE_ICON_IDS,
  NOTICE_ICON_LABELS,
  isNoticeIconColor,
  isNoticeIconId,
  type NoticeIconColor
} from "@/server/communications/message-meta";
import type { NoticeIconChoice } from "@/server/communications/schemas";
import { adminTransition } from "../styles";
import { noticeIconColorLabel, noticeIconFieldLabel, pickNoticeIcon } from "./notices-view-model";

// "Ícone ao lado do título" (docs/23; docs/22 §2.2): "Sem ícone" e os 16 icones do catalogo
// (message-meta.ts), e a cor quando ha icone. Dois radiogroups do Base UI (padrao WAI-ARIA: Tab entra na
// opcao marcada e sai do grupo; setas movem e escolhem, com volta; Home/End). O rotulo do campo diz a
// escolha em texto ("· Promoção"). A partir de 640 px o nome do icone aparece ao passar o mouse ou focar;
// abaixo (toque, sem tooltip) fica escrito embaixo do desenho. Escolher um icone ja marca a cor sugerida.

type NoticeIconFieldProps = {
  disabled: boolean;
  /** Prefixo dos ids: "{prefixo}" (grupo do icone) e "{prefixo}-cor". */
  id: string;
  onChange: (icon: NoticeIconChoice) => void;
  value: NoticeIconChoice;
};

const NONE = "none";

/** Os valores da paleta (iguais aos do sino do aluno, notice-icons.tsx); o admin tem outro --accent. */
const COLOR_VALUES: Record<NoticeIconColor, string> = {
  amber: "#fbbf24",
  green: "#10b981",
  orange: "#ff7a1a",
  red: "#e50914",
  white: "#f4f4f5"
};

const labelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";
const optionClass = cn(
  "group relative flex shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border outline-none select-none",
  "h-14 w-16 sm:size-11",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60",
  adminTransition
);

function optionTone(checked: boolean) {
  return checked
    ? "border-[var(--text-primary)] bg-[var(--surface-3)] text-[var(--text-primary)]"
    : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]";
}

/** Nome do icone: tooltip a partir de 640 px; escrito embaixo do desenho no celular. */
function OptionName({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-[11px] leading-none sm:hidden">
        {label}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded-md bg-[var(--text-primary)] px-2 py-1 text-xs whitespace-nowrap text-[var(--surface-1)] shadow sm:group-hover:block sm:group-focus-visible:block"
      >
        {label}
      </span>
    </>
  );
}

export function NoticeIconField({ disabled, id, onChange, value }: NoticeIconFieldProps) {
  const selected = value?.id ?? NONE;
  const glyphColor = value ? COLOR_VALUES[value.color] : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <span className={labelClass} id={`${id}-label`}>
          {noticeIconFieldLabel(value)}
          <span className="font-normal text-[var(--text-tertiary)]"> (opcional)</span>
        </span>
        <RadioGroup
          aria-describedby={`${id}-hint`}
          aria-label="Ícone ao lado do título"
          className="flex min-w-0 flex-wrap gap-2"
          disabled={disabled}
          id={id}
          onValueChange={(next: string) => onChange(pickNoticeIcon(isNoticeIconId(next) ? next : null))}
          value={selected}
        >
          <Radio.Root aria-label="Sem ícone" className={cn(optionClass, optionTone(selected === NONE))} value={NONE}>
            <Ban aria-hidden="true" className="size-5" strokeWidth={2} />
            <OptionName label="Sem ícone" />
          </Radio.Root>
          {NOTICE_ICON_IDS.map((iconId) => {
            const Glyph = NOTICE_ICON_GLYPHS[iconId];
            const checked = selected === iconId;

            return (
              <Radio.Root aria-label={NOTICE_ICON_LABELS[iconId]} className={cn(optionClass, optionTone(checked))} key={iconId} value={iconId}>
                <Glyph aria-hidden="true" className="size-5" strokeWidth={2.2} style={checked ? { color: glyphColor } : undefined} />
                <OptionName label={NOTICE_ICON_LABELS[iconId]} />
              </Radio.Root>
            );
          })}
        </RadioGroup>
        <p className="text-xs leading-5 text-[var(--text-secondary)]" id={`${id}-hint`}>
          Ajuda o aluno a reconhecer o assunto: uma etiqueta para promoção, um calendário para uma data marcada.
        </p>
      </div>

      {value ? (
        <div className="flex min-w-0 flex-col gap-2">
          <span className={labelClass} id={`${id}-cor-label`}>
            {noticeIconColorLabel(value)}
          </span>
          <RadioGroup
            aria-label="Cor do ícone"
            className="flex min-w-0 flex-wrap gap-2"
            disabled={disabled}
            id={`${id}-cor`}
            onValueChange={(next: string) => {
              if (isNoticeIconColor(next)) {
                onChange({ color: next, id: value.id });
              }
            }}
            value={value.color}
          >
            {NOTICE_ICON_COLORS.map((color) => {
              const checked = value.color === color;

              return (
                <Radio.Root
                  className={cn(
                    "inline-flex min-h-[34px] cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap outline-none select-none pointer-coarse:min-h-11",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60",
                    optionTone(checked),
                    adminTransition
                  )}
                  key={color}
                  value={color}
                >
                  {checked ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                  <span aria-hidden="true" className="size-3.5 shrink-0 rounded-full ring-1 ring-white/20" style={{ background: COLOR_VALUES[color] }} />
                  {NOTICE_ICON_COLOR_LABELS[color]}
                </Radio.Root>
              );
            })}
          </RadioGroup>
        </div>
      ) : null}
    </div>
  );
}
