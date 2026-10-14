"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useNavigationFeedback, useNavigationFeedbackRouter } from "@/components/navigation-feedback";
import { flushPendingSavedItemChanges } from "@/components/saved-item-button";

// Link interno que grava antes de trocar de pagina: o progresso da aula aberta
// (window.__bunker707FlushLessonProgress, registrado pela pagina da aula) e os favoritos pendentes.
// Mesmo fluxo da barra lateral e do menu da conta (handleProgressAwareNavigation em app-shell.tsx).
// Usado em lugares que tambem aparecem na pagina da aula, como o rodape. Ctrl/Cmd/Shift/Alt ou botao
// do meio seguem o comportamento normal do navegador (abrir em outra aba nao sai da aula).

type MemberProgressLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

declare global {
  interface Window {
    __bunker707FlushLessonProgress?: () => Promise<void>;
  }
}

export function MemberProgressLink({ href, onClick, ...props }: MemberProgressLinkProps) {
  const router = useNavigationFeedbackRouter();
  const { startNavigation } = useNavigationFeedback();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    startNavigation(href);

    void (async () => {
      await window.__bunker707FlushLessonProgress?.();
      await flushPendingSavedItemChanges();
      router.push(href);
    })();
  }

  return <Link {...props} href={href} onClick={handleClick} />;
}
