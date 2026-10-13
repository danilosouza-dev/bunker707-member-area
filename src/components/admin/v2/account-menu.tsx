"use client";

import { Menu } from "@base-ui/react/menu";
import { LogOut } from "lucide-react";
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
};

/**
 * Conta na barra superior, a direita (pedido do produtor, 13/10/2026): avatar redondo de 32 px com
 * borda e o nome no title. Abre para baixo com nome, e-mail, papel e "Sair".
 */
export function AccountMenu({ account, className }: AccountMenuProps) {
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
          "grid size-9 shrink-0 place-items-center rounded-full outline-none hover:bg-[var(--hover-overlay)] data-popup-open:bg-[var(--hover-overlay)]",
          adminTransition,
          className
        )}
        title={account.name}
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-3)] text-[13px] font-semibold text-[var(--text-primary)]"
        >
          {initials}
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" className="z-50 outline-none" collisionPadding={8} side="bottom" sideOffset={8}>
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
