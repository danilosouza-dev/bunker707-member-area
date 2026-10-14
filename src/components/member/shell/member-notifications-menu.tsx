"use client";

import { Popover } from "@base-ui/react/popover";
import { Bell, CalendarClock, Megaphone, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

// Lembretes do aluno no topo (sino), entre a busca e a conta. Mostra so o que existir de verdade:
// avisos da escola, convites para webinarios e promocoes chegam com o modulo Comunicacao
// (docs/17 §1.8, fase 5). Ate la o painel diz que nao ha lembretes e o que vai aparecer ali; nunca um
// exemplo nem um numero inventado. O painel vai em portal: o topo tem `overflow-hidden`.

const upcoming = [
  { icon: Megaphone, label: "Avisos da escola" },
  { icon: CalendarClock, label: "Convites e lembretes de webinários" },
  { icon: Tag, label: "Promoções para você" }
] as const;

export function MemberNotificationsMenu({ className }: { className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Lembretes"
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full text-white outline-none transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white data-popup-open:bg-white/10 motion-reduce:transition-none",
          className
        )}
        title="Lembretes"
      >
        <Bell aria-hidden="true" className="size-5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-50 outline-none" collisionPadding={16} side="bottom" sideOffset={10}>
          <Popover.Popup className="w-[min(20rem,calc(100vw-2rem))] origin-[var(--transform-origin)] rounded-[14px] border border-white/10 bg-[#1b1b1b]/95 p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.65)] outline-none backdrop-blur-xl transition-[opacity,transform] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none">
            <Popover.Title className="text-sm font-semibold">Lembretes</Popover.Title>
            <Popover.Description className="mt-1 text-sm text-zinc-400">Nenhum lembrete por enquanto.</Popover.Description>
            <p className="mt-4 text-xs font-semibold text-zinc-500">Quando houver, aparecem aqui:</p>
            <ul className="mt-2 space-y-2">
              {upcoming.map(({ icon: Icon, label }) => (
                <li className="flex items-center gap-2.5 text-sm text-zinc-300" key={label}>
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
                  {label}
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
