"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

const minimumVisibleDuration = 350;
const navigationTimeout = 15_000;
const delayedMessageDuration = 4_000;

type NavigationFeedbackState = {
  fromRoute: string;
  id: number;
  message: string;
  phase: "loading" | "delayed";
  startedAt: number;
  targetRoute?: string;
};

type StartNavigationOptions = {
  force?: boolean;
  fromRoute?: string;
  message?: string;
};

type NavigationFeedbackContextValue = {
  startNavigation: (href: string, options?: StartNavigationOptions) => boolean;
};

const NavigationFeedbackContext = createContext<NavigationFeedbackContextValue | null>(null);

function getRouteSignature(url: URL) {
  return `${url.pathname}${url.search}`;
}

function getCurrentRouteSignature() {
  return getRouteSignature(new URL(window.location.href));
}

function getNavigationMessage(url: URL, requestedMessage?: string) {
  if (requestedMessage) {
    return requestedMessage;
  }

  if (url.origin !== window.location.origin) {
    return "Abrindo destino externo...";
  }

  if (url.pathname === "/") {
    return "Abrindo Home...";
  }

  if (url.pathname === "/favoritos") {
    return "Abrindo Favoritos...";
  }

  if (url.pathname === "/minhas-compras") {
    return "Abrindo Minhas compras...";
  }

  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
    return "Abrindo área do produtor...";
  }

  if (url.pathname.includes("/aulas/")) {
    return "Abrindo aula...";
  }

  if (url.pathname.startsWith("/conteudo/")) {
    return "Abrindo conteúdo...";
  }

  if (url.pathname === "/login") {
    return "Abrindo acesso...";
  }

  return "Abrindo página...";
}

function getAnchorMessage(anchor: HTMLAnchorElement, url: URL) {
  const explicitMessage = anchor.dataset.navigationMessage;

  if (explicitMessage) {
    return explicitMessage;
  }

  const routeMessage = getNavigationMessage(url);

  if (routeMessage !== "Abrindo página...") {
    return routeMessage;
  }

  const label = (anchor.getAttribute("aria-label") || anchor.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(abrir|acessar|ver|ir para)\s+/i, "")
    .slice(0, 60);

  return label ? `Abrindo ${label}...` : routeMessage;
}

function shouldHandleAnchorClick(event: MouseEvent, anchor: HTMLAnchorElement, url: URL) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey ||
    anchor.hasAttribute("download") ||
    anchor.dataset.navigationFeedback === "false" ||
    (event.target instanceof Element && event.target.closest("[data-home-row-hover-bridge]")) ||
    (anchor.target && anchor.target !== "_self")
  ) {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const currentUrl = new URL(window.location.href);

  if (getRouteSignature(url) === getRouteSignature(currentUrl)) {
    return false;
  }

  return true;
}

export function NavigationFeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeSignature = `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  const [feedback, setFeedback] = useState<NavigationFeedbackState | null>(null);
  const feedbackRef = useRef<NavigationFeedbackState | null>(null);
  const lastCommittedRouteRef = useRef(routeSignature);
  const completionTimerRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  const delayedClearTimerRef = useRef<number | null>(null);
  const navigationIdRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }

    if (timeoutTimerRef.current !== null) {
      window.clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }

    if (delayedClearTimerRef.current !== null) {
      window.clearTimeout(delayedClearTimerRef.current);
      delayedClearTimerRef.current = null;
    }
  }, []);

  const finishNavigation = useCallback(
    (id: number) => {
      const currentFeedback = feedbackRef.current;

      if (!currentFeedback || currentFeedback.id !== id) {
        return;
      }

      if (timeoutTimerRef.current !== null) {
        window.clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }

      const elapsed = Date.now() - currentFeedback.startedAt;
      const remainingDuration = Math.max(minimumVisibleDuration - elapsed, 0);

      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }

      completionTimerRef.current = window.setTimeout(() => {
        if (feedbackRef.current?.id !== id) {
          return;
        }

        feedbackRef.current = null;
        setFeedback(null);
        completionTimerRef.current = null;
      }, remainingDuration);
    },
    []
  );

  const startNavigation = useCallback(
    (href: string, options: StartNavigationOptions = {}) => {
      let destination: URL;

      try {
        destination = new URL(href, window.location.href);
      } catch {
        return false;
      }

      const currentRoute = getCurrentRouteSignature();
      const targetRoute = destination.origin === window.location.origin ? getRouteSignature(destination) : undefined;

      if (!options.force && targetRoute === currentRoute) {
        return false;
      }

      if (
        feedbackRef.current?.phase === "loading" &&
        feedbackRef.current.targetRoute &&
        feedbackRef.current.targetRoute === targetRoute
      ) {
        return true;
      }

      clearTimers();

      const nextFeedback: NavigationFeedbackState = {
        fromRoute: options.fromRoute ?? currentRoute,
        id: navigationIdRef.current + 1,
        message: getNavigationMessage(destination, options.message),
        phase: "loading",
        startedAt: Date.now(),
        targetRoute
      };

      navigationIdRef.current = nextFeedback.id;
      feedbackRef.current = nextFeedback;
      setFeedback(nextFeedback);

      timeoutTimerRef.current = window.setTimeout(() => {
        if (feedbackRef.current?.id !== nextFeedback.id) {
          return;
        }

        const delayedFeedback: NavigationFeedbackState = {
          ...nextFeedback,
          message: "A página está demorando mais que o esperado.",
          phase: "delayed"
        };

        feedbackRef.current = delayedFeedback;
        setFeedback(delayedFeedback);
        timeoutTimerRef.current = null;
        delayedClearTimerRef.current = window.setTimeout(() => {
          if (feedbackRef.current?.id !== nextFeedback.id) {
            return;
          }

          feedbackRef.current = null;
          setFeedback(null);
          delayedClearTimerRef.current = null;
        }, delayedMessageDuration);
      }, navigationTimeout);

      return true;
    },
    [clearTimers]
  );

  useEffect(() => {
    lastCommittedRouteRef.current = routeSignature;

    const currentFeedback = feedbackRef.current;

    if (!currentFeedback || routeSignature === currentFeedback.fromRoute) {
      return;
    }

    const currentFeedbackId = currentFeedback.id;

    function finishWhenDestinationIsRendered() {
      if (document.querySelector("[data-route-loading]")) {
        return false;
      }

      finishNavigation(currentFeedbackId);
      return true;
    }

    if (finishWhenDestinationIsRendered()) {
      return;
    }

    const loadingObserver = new MutationObserver(() => {
      if (finishWhenDestinationIsRendered()) {
        loadingObserver.disconnect();
      }
    });

    loadingObserver.observe(document.body, { childList: true, subtree: true });

    return () => loadingObserver.disconnect();
  }, [finishNavigation, routeSignature]);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>("a[href]");

      if (!anchor) {
        return;
      }

      let destination: URL;

      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (!shouldHandleAnchorClick(event, anchor, destination)) {
        return;
      }

      startNavigation(destination.href, { message: getAnchorMessage(anchor, destination) });
    }

    function handleHistoryNavigation() {
      startNavigation(window.location.href, {
        force: true,
        fromRoute: lastCommittedRouteRef.current,
        message: "Mudando de página..."
      });
    }

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handleHistoryNavigation);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("popstate", handleHistoryNavigation);
    };
  }, [startNavigation]);

  useEffect(() => {
    if (!feedback) {
      document.body.removeAttribute("aria-busy");
      document.documentElement.removeAttribute("data-navigation-pending");
      return;
    }

    document.body.setAttribute("aria-busy", "true");
    document.documentElement.setAttribute("data-navigation-pending", "true");

    return () => {
      document.body.removeAttribute("aria-busy");
      document.documentElement.removeAttribute("data-navigation-pending");
    };
  }, [feedback]);

  useEffect(() => clearTimers, [clearTimers]);

  const contextValue = useMemo(() => ({ startNavigation }), [startNavigation]);

  return (
    <NavigationFeedbackContext.Provider value={contextValue}>
      {children}
      {feedback ? (
        <div
          aria-atomic="true"
          aria-live={feedback.phase === "delayed" ? "assertive" : "polite"}
          className={`fixed inset-0 z-[9999] bg-[radial-gradient(circle_at_50%_45%,rgba(0,0,0,0.52)_0%,rgba(0,0,0,0.76)_100%)] backdrop-blur-[7px] ${
            feedback.phase === "loading" ? "cursor-progress" : "pointer-events-none"
          }`}
          data-navigation-feedback
          role="status"
        >
          <span
            aria-hidden="true"
            className="fixed left-[50vw] top-[50vh] block h-14 w-14 -translate-x-1/2 -translate-y-1/2"
            data-navigation-spinner-anchor
          >
            <span className="navigation-feedback-spinner absolute inset-0 block rounded-full border-[3px] border-white/15 border-r-[var(--accent)] border-t-[var(--accent)] shadow-[0_0_24px_rgba(229,9,20,0.24)]" />
          </span>
          <span className="sr-only">{feedback.message}</span>
        </div>
      ) : null}
    </NavigationFeedbackContext.Provider>
  );
}

export function useNavigationFeedback() {
  const context = useContext(NavigationFeedbackContext);

  if (!context) {
    throw new Error("useNavigationFeedback must be used inside NavigationFeedbackProvider");
  }

  return context;
}

export function useNavigationFeedbackRouter() {
  const router = useRouter();
  const { startNavigation } = useNavigationFeedback();

  return useMemo(
    () => ({
      back() {
        startNavigation(window.location.href, {
          force: true,
          fromRoute: getCurrentRouteSignature(),
          message: "Voltando..."
        });
        router.back();
      },
      forward() {
        startNavigation(window.location.href, {
          force: true,
          fromRoute: getCurrentRouteSignature(),
          message: "Avançando..."
        });
        router.forward();
      },
      prefetch: router.prefetch,
      push(href: Parameters<typeof router.push>[0], options?: Parameters<typeof router.push>[1]) {
        startNavigation(href);
        router.push(href, options);
      },
      refresh() {
        router.refresh();
      },
      replace(href: Parameters<typeof router.replace>[0], options?: Parameters<typeof router.replace>[1]) {
        startNavigation(href);
        router.replace(href, options);
      }
    }),
    [router, startNavigation]
  );
}
