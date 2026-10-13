"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown, LogOut } from "lucide-react";
import { useState } from "react";
import { signOutAndLeave } from "@/lib/auth/sign-out";
import { cn } from "@/lib/utils";
import { getInitials } from "./format";
import { adminMenuItem, adminMenuPopup, adminMenuSeparator, adminTransition } from "./styles";

export type AdminAccount = {
  email: string;
  name: string;
  roleLabel: string;
};

type AccountMenuProps = {
  account: AdminAccount;
  className?: string;
  /** Barra lateral recolhida: so o avatar, com o nome no title. */
  compact?: boolean;
};

/**
 * Conta no rodape da barra lateral (prototipo aprovado): avatar redondo de 32 px com borda, nome 14/500,
 * papel 12 px e seta para baixo. Abre para cima com o e-mail e "Sair". A barra superior nao tem avatar.
 */
export function AccountMenu({ account, className, compact = false }: AccountMenuProps) {
  const [signingOut, setSigningOut] = useState(false);
  const initials = getInitials(account.name);

  function handleSignOut() {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    void signOutAndLeave();
  }

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={`Conta de ${account.name}`}
        className={cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left outline-none hover:bg-[var(--hover-overlay)] data-popup-open:bg-[var(--hover-overlay)]",
          compact && "justify-center px-0",
          adminTransition,
          className
        )}
        title={compact ? account.name : undefined}
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-3)] text-[13px] font-semibold text-[var(--text-primary)]"
        >
          {initials}
        </span>
        <span className={cn("grid min-w-0 flex-1", compact && "sr-only")}>
          <span className="truncate text-sm leading-[1.2] font-medium text-[var(--text-primary)]">{account.name}</span>
          <span className="truncate text-xs leading-[1.2] text-[var(--text-tertiary)]">{account.roleLabel}</span>
        </span>
        {compact ? null : <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--text-tertiary)]" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" className="z-50 outline-none" collisionPadding={8} side="top" sideOffset={8}>
          <Menu.Popup className={cn(adminMenuPopup, "w-60")}>
            <div className="px-2.5 py-1.5">
              <p className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{account.name}</p>
              {account.email ? <p className="truncate text-xs leading-4 text-[var(--text-secondary)]">{account.email}</p> : null}
              <p className="mt-0.5 text-xs leading-4 text-[var(--text-tertiary)]">{account.roleLabel}</p>
            </div>
            <Menu.Separator className={adminMenuSeparator} />
            <Menu.Item className={adminMenuItem} disabled={signingOut} onClick={handleSignOut}>
              <LogOut aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
              {signingOut ? "Saindo…" : "Sair"}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
