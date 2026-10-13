"use client";

import { Popover } from "@base-ui/react/popover";
import { Bell, ChevronRight, LayoutDashboard, MessageCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatAdminNavCount, type AdminNavCounts } from "./nav";
import { adminMenuLabel, adminMenuPopup, adminTransition } from "./styles";

type Reminder = { count: number; href: string; icon: LucideIcon; text: (count: number) => string };

/**
 * Lembretes do produtor na barra superior. So dados reais (os mesmos contadores do menu): itens que
 * precisam de atencao hoje e perguntas de alunos sem resposta ha mais de 24 h. Sem pendencia, o sino
 * fica sem ponto e o painel diz "Tudo em dia". Nunca um exemplo.
 */
export function NotificationsMenu({ counts }: { counts: AdminNavCounts }) {
  const [open, setOpen] = useState(false);
  const allReminders: Reminder[] = [
    {
      count: counts.hoje ?? 0,
      href: "/admin",
      icon: LayoutDashboard,
      text: (count) => (count === 1 ? "1 item precisa de atenção hoje" : `${count} itens precisam de atenção hoje`)
    },
    {
      count: counts.comunidade ?? 0,
      href: "/admin/comunidade",
      icon: MessageCircle,
      text: (count) =>
        count === 1 ? "1 pergunta de aluno sem resposta há mais de 24 h" : `${count} perguntas de alunos sem resposta há mais de 24 h`
    }
  ];
  const reminders = allReminders.filter((reminder) => formatAdminNavCount(reminder.count) !== null);
  const pending = reminders.length > 0;

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        aria-label={pending ? "Lembretes (há pendências)" : "Lembretes"}
        className={cn(
          "relative grid size-9 shrink-0 place-items-center rounded-full text-[var(--text-secondary)] outline-none hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] data-popup-open:bg-[var(--hover-overlay)] data-popup-open:text-[var(--text-primary)]",
          adminTransition
        )}
        title="Lembretes"
      >
        <Bell aria-hidden="true" className="size-5" strokeWidth={1.75} />
        {pending ? (
          <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[var(--text-primary)] ring-2 ring-[var(--surface-0)]" />
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" className="z-50 outline-none" collisionPadding={8} side="bottom" sideOffset={8}>
          <Popover.Popup className={cn(adminMenuPopup, "w-80")}>
            <Popover.Title className={adminMenuLabel}>Lembretes</Popover.Title>
            {pending ? (
              <ul className="mt-1 flex flex-col">
                {reminders.map((reminder) => {
                  const Icon = reminder.icon;

                  return (
                    <li key={reminder.href}>
                      <Link
                        className="flex min-h-11 items-center gap-3 rounded-[6px] px-2.5 py-2 text-sm leading-5 text-[var(--text-primary)] outline-none hover:bg-[var(--press-overlay)] focus-visible:bg-[var(--press-overlay)]"
                        href={reminder.href}
                        onClick={() => setOpen(false)}
                      >
                        <Icon aria-hidden="true" className="size-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.75} />
                        <span className="min-w-0 flex-1">{reminder.text(reminder.count)}</span>
                        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--text-tertiary)]" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-2.5 pt-1 pb-2 text-sm leading-5 text-[var(--text-secondary)]">Tudo em dia. Nenhum lembrete agora.</p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
