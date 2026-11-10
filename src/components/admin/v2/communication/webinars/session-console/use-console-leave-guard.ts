"use client";

import { useCallback, useEffect, useRef } from "react";
import { consoleLinkLeave, type ConsoleLeaveTarget } from "./console-leave-model";

// A guarda da saida do console (docs/31 §10; a regra pura em console-leave-model.ts). Ligada (`active`: o console dentro
// da sala), ela segura as tres saidas da pagina na mesma aba:
// - o clique num link (a seta de voltar, o Ver relatorio, qualquer link da pagina ou dos menus no portal): o ouvinte do
//   documento na captura corre antes do React, e o preventDefault faz o Link do Next desistir (ele confere o
//   defaultPrevented) e o navegador nao seguir o href; a janela pergunta;
// - o Voltar e o Avancar do navegador entre paginas do app: o evento `navigate` da Navigation API, que o navegador
//   deixa cancelar quando a ida e dentro do mesmo documento (o roteador do Next nao ve nada, porque o popstate nao
//   chega); sem a API, ou com a ida cancelavel recusada pelo navegador, a saida acontece como antes;
// - recarregar, fechar a aba, digitar outro endereco ou o Voltar para uma pagina de fora: o `beforeunload`, que so
//   mostra a pergunta do proprio navegador.
// `allow()` solta a guarda para a saida confirmada (o Sair da janela), ate a guarda ligar de novo.

export type ConsoleLeaveGuard = {
  /** Solta a guarda para a saida confirmada (o link, o Voltar ou o seletor de sessoes seguem sem perguntar). */
  allow: () => void;
};

/** O evento `navigate` da Navigation API, so o que a guarda le (o tipo ainda nao esta no lib.dom do TypeScript). */
type NavigateEventLike = Event & { destination?: { url?: string }; navigationType?: string };

export function useConsoleLeaveGuard({ active, onAsk }: { active: boolean; onAsk: (target: ConsoleLeaveTarget) => void }): ConsoleLeaveGuard {
  const allowed = useRef(false);
  const ask = useRef(onAsk);

  useEffect(() => {
    ask.current = onAsk;
  });

  useEffect(() => {
    if (!active) {
      return;
    }
    allowed.current = false;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowed.current) {
        return;
      }
      event.preventDefault();
      // O Chrome antigo so pergunta com o returnValue preenchido; o texto nunca aparece (o navegador usa o dele).
      event.returnValue = "";
    };

    const onClick = (event: MouseEvent) => {
      if (allowed.current || event.defaultPrevented) {
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      const href = consoleLinkLeave({
        button: event.button,
        currentHref: window.location.href,
        download: anchor.hasAttribute("download"),
        href: anchor.getAttribute("href"),
        modified: event.ctrlKey || event.metaKey || event.shiftKey || event.altKey,
        target: anchor.getAttribute("target")
      });
      if (!href) {
        return;
      }
      event.preventDefault();
      ask.current({ href, kind: "link" });
    };

    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const onNavigate = (event: Event) => {
      const navigate = event as NavigateEventLike;
      if (allowed.current || navigate.navigationType !== "traverse" || !event.cancelable) {
        return;
      }
      event.preventDefault();
      ask.current({ href: navigate.destination?.url ?? "", kind: "back" });
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    navigation?.addEventListener("navigate", onNavigate);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      navigation?.removeEventListener("navigate", onNavigate);
    };
  }, [active]);

  const allow = useCallback(() => {
    allowed.current = true;
  }, []);

  return { allow };
}
