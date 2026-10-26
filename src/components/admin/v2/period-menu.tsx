"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ADMIN_PERIOD_PARAM } from "./filters";
import {
  ADMIN_PERIOD_PRESET_OPTIONS,
  buildAdminPeriodMenuHref,
  formatAdminPeriodParam,
  parseAdminPeriodParamStrict,
  resolveAdminPeriod,
  DEFAULT_ADMIN_PERIOD_VALUE,
  type AdminPeriod,
  type AdminRangePeriod
} from "./period";
import {
  adminMenuItem,
  adminMenuLabel,
  adminMenuMeta,
  adminMenuPopup,
  adminMenuSeparator,
  adminTopbarControl,
  adminTransition
} from "./styles";
import { useMediaQuery } from "./use-media-query";

// Menu "Periodo" (pedido do produtor: Hoje, 1d, 3d, 7d, 30d e um calendario para escolher o intervalo),
// na forma do prototipo aprovado: botao de 36 px na barra superior ("Período  Últimos 30 dias ▾").
// O endereco (?periodo=) e a fonte da verdade (period.ts); cada troca entra no historico, entao o botao
// voltar desfaz. "Escolher datas…" abre o calendario (carregado so ao abrir) ancorado no botao; no
// celular, em tela cheia.

const PeriodCalendar = dynamic(() => import("./period-calendar").then((module) => module.PeriodCalendar), {
  loading: () => <PeriodCalendarSkeleton />,
  ssr: false
});

type PeriodMenuProps = {
  /** Item "Tudo" (Comunidade): escolhido, tira ?periodo= do endereco. Sem periodo no endereco, fica marcado. */
  allOption?: { label: string } | null;
  /** Oferece "Escolher datas…" (calendario). Padrao: true. */
  allowRange?: boolean;
  className?: string;
  /** Rotulo do menu e do botao. */
  label?: string;
  /** "topbar": botao da barra superior. "inline": select de pagina com o rotulo do lado de fora. */
  variant?: "topbar" | "inline";
};

/** Texto curto do select de pagina: "Hoje", "24 horas", "7 dias". */
const INLINE_PRESET_TEXT: Record<string, string> = {
  "1d": "24 horas",
  "30d": "30 dias",
  "3d": "3 dias",
  "7d": "7 dias",
  hoje: "Hoje"
};

export function PeriodMenu({ allOption = null, allowRange = true, className, label = "Período", variant = "topbar" }: PeriodMenuProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)", true);

  const strict = parseAdminPeriodParamStrict(searchParams.get(ADMIN_PERIOD_PARAM), now);
  const showsAll = Boolean(allOption) && strict === null;
  const period = strict ?? DEFAULT_ADMIN_PERIOD_VALUE;
  const resolved = resolveAdminPeriod(period, now);
  const selectedValue = showsAll ? "tudo" : formatAdminPeriodParam(period);
  const isRange = period.kind === "range";

  function navigate(next: AdminPeriod | null) {
    const href = buildAdminPeriodMenuHref(pathname, searchParams, next, Boolean(allOption));

    startTransition(() => {
      router.push(href, { scroll: false });
    });
  }

  function handleValueChange(value: unknown) {
    if (value === "tudo") {
      navigate(null);
      return;
    }

    const option = ADMIN_PERIOD_PRESET_OPTIONS.find((entry) => entry.preset === value);

    if (option) {
      navigate({ kind: "preset", preset: option.preset });
    }
  }

  function applyRange(range: AdminRangePeriod) {
    setCalendarOpen(false);
    navigate(range);
  }

  const valueTitle = showsAll ? allOption?.label : resolved.label;
  const accessibleValue = showsAll ? allOption?.label : resolved.accessibleLabel;
  const inlineText = showsAll ? allOption?.label : isRange ? resolved.shortLabel : INLINE_PRESET_TEXT[resolved.param] ?? resolved.shortLabel;

  const trigger =
    variant === "topbar" ? (
      <Menu.Trigger
        aria-busy={pending || undefined}
        aria-label={`${label}: ${accessibleValue}`}
        className={cn(adminTopbarControl, className)}
        ref={triggerRef}
        title={valueTitle}
      >
        <CalendarDays aria-hidden="true" className="hidden size-5 text-[var(--text-secondary)] max-md:block" strokeWidth={1.75} />
        <span aria-hidden="true" className="hidden text-[var(--text-tertiary)] min-[1440px]:inline">
          {label}
        </span>
        {isRange || showsAll ? (
          <span aria-hidden="true" className="max-md:hidden">
            {isRange ? resolved.shortLabel : valueTitle}
          </span>
        ) : (
          <>
            <span aria-hidden="true" className="hidden lg:inline">
              {resolved.label}
            </span>
            <span aria-hidden="true" className="hidden md:inline lg:hidden">
              {resolved.shortLabel}
            </span>
          </>
        )}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--text-tertiary)] max-md:hidden" />
      </Menu.Trigger>
    ) : (
      <Menu.Trigger
        aria-busy={pending || undefined}
        aria-label={`${label}: ${accessibleValue}`}
        className={cn(
          "inline-flex h-9 min-w-[92px] items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] pr-2.5 pl-3 text-[13px] leading-5 font-medium whitespace-nowrap text-[var(--text-primary)] outline-none hover:border-[var(--border-strong)] data-popup-open:border-[var(--border-strong)]",
          adminTransition,
          className
        )}
        ref={triggerRef}
        title={valueTitle}
      >
        <span aria-hidden="true">{inlineText}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--text-tertiary)]" />
      </Menu.Trigger>
    );

  const menu = (
    <Menu.Root modal={false} onOpenChange={setMenuOpen} open={menuOpen}>
      {trigger}
      <Menu.Portal>
        <Menu.Positioner align={variant === "inline" ? "start" : "end"} className="z-50 outline-none" collisionPadding={8} sideOffset={6}>
          <Menu.Popup className={cn(adminMenuPopup, "w-60")}>
            <Menu.Group>
              <Menu.GroupLabel className={adminMenuLabel}>{label}</Menu.GroupLabel>
              <Menu.RadioGroup onValueChange={handleValueChange} value={selectedValue}>
                {allOption ? <PeriodRadioItem label={allOption.label} value="tudo" /> : null}
                {ADMIN_PERIOD_PRESET_OPTIONS.map((option) => (
                  <PeriodRadioItem
                    key={option.preset}
                    label={option.label}
                    meta={option.preset === "hoje" ? undefined : option.shortLabel}
                    value={option.preset}
                  />
                ))}
                {isRange ? <PeriodRadioItem label={resolved.label} value={selectedValue} /> : null}
              </Menu.RadioGroup>
            </Menu.Group>
            {allowRange ? (
              <>
                <Menu.Separator className={adminMenuSeparator} />
                <Menu.Item className={adminMenuItem} onClick={() => window.setTimeout(() => setCalendarOpen(true), 0)}>
                  <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.75} />
                  Escolher datas…
                </Menu.Item>
              </>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );

  const calendarProps = {
    initial: resolved,
    now,
    onApply: applyRange,
    onCancel: () => setCalendarOpen(false)
  };

  return (
    <>
      {variant === "inline" ? (
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-[13px] leading-5 font-medium text-[var(--text-tertiary)]">
            {label}
          </span>
          {menu}
        </div>
      ) : (
        menu
      )}

      {allowRange && isDesktop ? (
        <Popover.Root onOpenChange={setCalendarOpen} open={calendarOpen}>
          <Popover.Portal>
            <Popover.Positioner align="end" anchor={triggerRef} className="z-50 outline-none" collisionPadding={8} sideOffset={6}>
              <Popover.Popup
                aria-label="Escolher datas"
                className={cn(
                  "max-h-[var(--available-height)] max-w-[calc(100vw-16px)] overflow-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] shadow-[0_24px_64px_rgba(0,0,0,0.6)] outline-none",
                  "transition-[opacity,scale] duration-150 ease-[var(--ease-admin)] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transition-none"
                )}
                finalFocus={triggerRef}
              >
                {calendarOpen ? <PeriodCalendar {...calendarProps} numberOfMonths={2} /> : null}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : null}

      {allowRange && !isDesktop ? (
        <Dialog.Root onOpenChange={setCalendarOpen} open={calendarOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60" />
            <Dialog.Popup
              className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[var(--surface-1)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-[var(--text-primary)] outline-none"
              finalFocus={triggerRef}
            >
              <Dialog.Title className="px-4 pt-4 text-base leading-6 font-semibold">Escolher datas</Dialog.Title>
              {calendarOpen ? <PeriodCalendar {...calendarProps} compact numberOfMonths={1} /> : null}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </>
  );
}

function PeriodRadioItem({ label, meta, value }: { label: string; meta?: string; value: string }) {
  return (
    <Menu.RadioItem className={cn(adminMenuItem, "group/radio")} closeOnClick value={value}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <span className={cn(adminMenuMeta, "ml-0")}>{meta}</span> : null}
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-transparent group-data-checked/radio:bg-[var(--text-primary)]"
      />
    </Menu.RadioItem>
  );
}

function PeriodCalendarSkeleton() {
  return (
    <div aria-hidden="true" className="flex w-[min(640px,calc(100vw-16px))] flex-col gap-3 p-4">
      <Skeleton className="h-6 w-48 bg-[var(--surface-2)] motion-reduce:animate-none" />
      <Skeleton className="h-[264px] w-full rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />
    </div>
  );
}
