"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { DayPicker, type ChevronProps, type DateRange } from "react-day-picker";
import { ptBR } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ADMIN_PERIOD_MIN_DATE,
  civilDateToPickerDate,
  formatAdminDateRange,
  formatAdminDayCount,
  getAdminCalendarStartMonth,
  getAdminPeriodShortcuts,
  getAdminToday,
  isSameAdminPeriod,
  pickerDateToCivilDate,
  validateAdminPeriodRange,
  type AdminRangePeriod,
  type ResolvedAdminPeriod
} from "./period";
import { adminTransition } from "./styles";

// Calendario do menu Periodo (react-day-picker 10.0.1, sem a folha de estilo da biblioteca: as classes
// abaixo seguem os tokens do admin). Datas do calendario sao datas locais ao meio-dia; a ponte com o
// fuso da escola esta em period.ts (civilDateToPickerDate/pickerDateToCivilDate). O botao Aplicar nunca
// fica desativado: um intervalo invalido mostra a mensagem de validateAdminPeriodRange.

type PeriodCalendarProps = {
  /** Celular: atalhos em linha no topo, um mes so e rodape colado embaixo. */
  compact?: boolean;
  /** Periodo atual; o intervalo dele vem marcado ao abrir. */
  initial: ResolvedAdminPeriod;
  now: Date;
  numberOfMonths: 1 | 2;
  onApply: (range: AdminRangePeriod) => void;
  onCancel: () => void;
};

function CalendarChevron({ className, orientation }: ChevronProps) {
  const Icon = orientation === "left" ? ChevronLeft : ChevronRight;

  return <Icon aria-hidden="true" className={cn("size-4", className)} />;
}

const dayButton = cn(
  "grid size-9 place-items-center rounded-lg text-[13px] font-medium tabular-nums text-[var(--text-primary)] outline-none",
  "hover:bg-[var(--press-overlay)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)]",
  adminTransition
);

// Faixa do intervalo (celulas do meio) e pontas claras, como o botao primario do admin.
const rangeBand = "bg-[var(--press-overlay)]";
const rangeEdge = "[&>button]:bg-[var(--text-primary)] [&>button]:font-semibold [&>button]:text-[var(--surface-0)] [&>button]:hover:bg-[var(--text-primary)]";

const navButton = cn(
  "absolute top-0 z-[1] grid size-9 place-items-center rounded-lg text-[var(--text-secondary)] outline-none hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)] aria-disabled:pointer-events-none aria-disabled:opacity-30",
  adminTransition
);

export function PeriodCalendar({ compact = false, initial, now, numberOfMonths, onApply, onCancel }: PeriodCalendarProps) {
  const today = getAdminToday(now);
  const [range, setRange] = useState<DateRange | undefined>({
    from: civilDateToPickerDate(initial.from),
    to: civilDateToPickerDate(initial.to)
  });
  const [month, setMonth] = useState(() => civilDateToPickerDate(getAdminCalendarStartMonth(initial.to, numberOfMonths)));
  const [attempted, setAttempted] = useState(false);
  const shortcuts = getAdminPeriodShortcuts(now);

  const from = pickerDateToCivilDate(range?.from);
  const to = pickerDateToCivilDate(range?.to) ?? from;
  const validation = validateAdminPeriodRange(from, to, now);
  const activeShortcut = validation.ok ? shortcuts.find((shortcut) => isSameAdminPeriod(shortcut.period, validation.period)) : undefined;

  function pickShortcut(period: AdminRangePeriod) {
    setRange({ from: civilDateToPickerDate(period.from), to: civilDateToPickerDate(period.to) });
    setMonth(civilDateToPickerDate(getAdminCalendarStartMonth(period.to, numberOfMonths)));
    setAttempted(false);
  }

  function apply() {
    if (validation.ok) {
      onApply(validation.period);
      return;
    }

    setAttempted(true);
  }

  const summary = validation.ok
    ? `${formatAdminDateRange(validation.period.from, validation.period.to)} · ${formatAdminDayCount(validation.days)}`
    : validation.message;
  const showProblem = !validation.ok && (attempted || validation.reason !== "invalid");

  return (
    <div className={cn("flex min-w-0 flex-col", compact ? "flex-1" : "w-max max-w-full")}>
      <div className={cn("flex min-w-0", compact ? "flex-col" : "flex-row")}>
        <ul
          aria-label="Atalhos"
          className={cn(
            "flex shrink-0 gap-1",
            compact
              ? "overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              : "w-40 flex-col border-r border-[var(--border-subtle)] p-2"
          )}
        >
          {shortcuts.map((shortcut) => {
            const active = activeShortcut?.id === shortcut.id;

            return (
              <li className="shrink-0" key={shortcut.id}>
                <button
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-[34px] w-full items-center rounded-[6px] px-2.5 text-left text-[13px] font-medium whitespace-nowrap",
                    compact && "rounded-full border border-[var(--border-strong)] px-3.5",
                    active
                      ? "bg-[var(--press-overlay)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
                    compact && active && "border-[var(--text-primary)] bg-[var(--surface-3)]",
                    adminTransition
                  )}
                  onClick={() => pickShortcut(shortcut.period)}
                  type="button"
                >
                  {shortcut.label}
                </button>
              </li>
            );
          })}
        </ul>

        <div className={cn("min-w-0", compact ? "flex justify-center px-4 pt-2" : "p-3")}>
          <DayPicker
            classNames={{
              caption_label: "text-sm leading-9 font-semibold text-[var(--text-primary)] first-letter:uppercase",
              chevron: "",
              day: "p-0 text-center",
              day_button: dayButton,
              disabled: "[&>button]:pointer-events-none [&>button]:text-[var(--text-disabled)]",
              hidden: "invisible",
              month: "relative flex flex-col gap-2",
              month_caption: "flex h-9 items-center justify-center",
              month_grid: "border-separate border-spacing-0",
              months: cn("flex", numberOfMonths > 1 ? "gap-6" : ""),
              outside: "[&>button]:text-[var(--text-disabled)]",
              range_end: cn(rangeBand, "rounded-r-lg", rangeEdge),
              range_middle: cn(rangeBand, "[&>button]:rounded-none"),
              range_start: cn(rangeBand, "rounded-l-lg", rangeEdge),
              root: "relative",
              selected: "",
              today: "[&>button]:underline [&>button]:decoration-[var(--text-tertiary)] [&>button]:underline-offset-4",
              button_next: cn(navButton, "right-0"),
              button_previous: cn(navButton, "left-0"),
              week: "",
              weekday: "h-8 w-9 text-xs font-medium text-[var(--text-tertiary)]",
              weekdays: "",
              weeks: ""
            }}
            components={{ Chevron: CalendarChevron }}
            disabled={[{ before: civilDateToPickerDate(ADMIN_PERIOD_MIN_DATE) }, { after: civilDateToPickerDate(today) }]}
            endMonth={civilDateToPickerDate(today)}
            excludeDisabled
            locale={ptBR}
            mode="range"
            month={month}
            navLayout="around"
            numberOfMonths={numberOfMonths}
            onMonthChange={setMonth}
            onSelect={(next) => {
              setRange(next);
              setAttempted(false);
            }}
            resetOnSelect
            selected={range}
            showOutsideDays={false}
            startMonth={civilDateToPickerDate(ADMIN_PERIOD_MIN_DATE)}
          />
        </div>
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--border-subtle)] px-4 py-3",
          compact && "sticky bottom-0 mt-auto bg-[var(--surface-1)]"
        )}
      >
        <p
          aria-live="polite"
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-5 tabular-nums",
            showProblem ? "text-[var(--error)]" : validation.ok ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"
          )}
        >
          {summary}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button className="px-3.5 text-[var(--text-secondary)]" onClick={onCancel} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-3.5 font-semibold" onClick={apply} type="button">
            Aplicar
          </Button>
        </div>
      </div>
    </div>
  );
}
