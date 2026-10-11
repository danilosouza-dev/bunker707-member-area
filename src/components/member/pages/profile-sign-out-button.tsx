"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useState } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { flushPendingSavedItemChanges } from "@/components/saved-item-button";
import { signOutAndLeave } from "@/lib/auth/sign-out";

// "Sair" da aba Segurança do Perfil: mesmo fluxo do menu (salva favoritos pendentes como melhor
// esforco e encerra a sessao pelo servidor).

export function ProfileSignOutButton() {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    await Promise.allSettled([flushPendingSavedItemChanges()]);
    await signOutAndLeave();
  }

  return (
    <MemberButton aria-busy={signingOut} disabled={signingOut} onClick={() => void handleSignOut()} variant="danger">
      {signingOut ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LogOut />}
      {signingOut ? "Saindo..." : "Sair da conta"}
    </MemberButton>
  );
}
