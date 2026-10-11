"use client";

import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Painel lateral do admin (docs/17 §1.6.4 e §2.7), na forma do prototipo aprovado:
//
//   ┌ cabecalho 72 px ── [midia 40] titulo 16/600 · linha de apoio 13 px ── [acoes] [X 32] ┐
//   │ corpo (rola sozinho; secoes com AdminSheetSection, linha + 24 px entre elas)          │
//   └ rodape 64 px ── conteudo livre, ex.: chave Publicada + Ver como aluno + Salvar ───────┘
//
// - Flutua sobre a pagina a 8 px das bordas, raio 12, com veu escuro (nunca empurra o layout).
// - Largura min(560 px, tela - 16 px) ("md") ou 800 px ("lg"); abaixo de 768 px, tela cheia.
// - Esc, clique no veu e o X fecham; `onBeforeClose` pode impedir (alteracoes nao salvas).
// - O foco vai para `initialFocus` (ou para o primeiro campo) e volta para quem abriu.
// - Sombra no cabecalho so com o corpo rolado; no rodape so quando ainda ha conteudo abaixo.

type AdminSheetProps = {
  children: ReactNode;
  className?: string;
  /** Texto do botao X para leitores de tela. */
  closeLabel?: string;
  /** Linha de apoio abaixo do titulo, ex.: "Módulo 1, aula 1 de 4". */
  description?: ReactNode;
  /** Contexto da linha de apoio, ex.: nome do produto. Com `description`, vira "Produto · Módulo 1, aula 1 de 4". */
  eyebrow?: ReactNode;
  /** Rodape fixo. Sem rodape, o corpo vai ate o fim. */
  footer?: ReactNode;
  /** Acoes pequenas no cabecalho, antes do X (ex.: aula anterior/proxima). */
  headerActions?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Capa ou avatar de 40 px a esquerda do titulo. */
  media?: ReactNode;
  /** Chamado antes de fechar; devolva false para manter aberto (ex.: perguntar sobre alteracoes). */
  onBeforeClose?: () => boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: "md" | "lg";
  title: ReactNode;
};

const sizeClass = {
  lg: "md:w-[min(800px,calc(100vw-16px))]",
  md: "md:w-[min(560px,calc(100vw-16px))]"
} as const;

export function AdminSheet({
  children,
  className,
  closeLabel = "Fechar painel",
  description,
  eyebrow,
  footer,
  headerActions,
  initialFocus,
  media,
  onBeforeClose,
  onOpenChange,
  open,
  size = "md",
  title
}: AdminSheetProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const measure = useCallback(() => {
    const body = bodyRef.current;

    if (!body) {
      return;
    }

    setScrolled(body.scrollTop > 0);
    setHasMore(body.scrollTop + body.clientHeight < body.scrollHeight - 1);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;

    if (!open || !body || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => measure());
    observer.observe(body);

    for (const child of Array.from(body.children)) {
      observer.observe(child);
    }

    return () => observer.disconnect();
  }, [measure, open, children]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && onBeforeClose && !onBeforeClose()) {
      return;
    }

    onOpenChange(nextOpen);
  }

  const supportLine =
    eyebrow && description ? (
      <>
        {eyebrow}
        <span aria-hidden="true"> · </span>
        {description}
      </>
    ) : (
      (description ?? eyebrow ?? null)
    );

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/55",
            "transition-opacity duration-250 ease-[var(--ease-admin)] data-ending-style:opacity-0 data-ending-style:duration-200 data-starting-style:opacity-0",
            "motion-reduce:transition-none"
          )}
        />
        <Dialog.Popup
          className={cn(
            "fixed inset-0 z-50 flex h-dvh w-full max-w-full flex-col overflow-hidden bg-[var(--surface-1)] text-[var(--text-primary)] outline-none",
            "md:inset-y-2 md:right-2 md:left-auto md:h-auto md:rounded-xl md:border md:border-[var(--border-strong)] md:shadow-[0_24px_64px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.3)]",
            "transition-transform duration-250 ease-[var(--ease-admin)] data-ending-style:translate-x-[calc(100%+16px)] data-ending-style:duration-200 data-starting-style:translate-x-[calc(100%+16px)]",
            "motion-reduce:transition-none",
            sizeClass[size],
            className
          )}
          initialFocus={initialFocus}
        >
          <header
            className={cn(
              "relative z-[2] grid h-18 shrink-0 items-center gap-x-3 bg-[var(--surface-1)] pr-3 pl-4 md:pr-4 md:pl-6",
              media ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
              "transition-shadow duration-150 ease-[var(--ease-admin)]",
              scrolled && "shadow-[0_1px_0_var(--border-subtle),0_8px_16px_rgba(0,0,0,0.35)]"
            )}
          >
            {media ? <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden">{media}</div> : null}
            <div className="flex min-w-0 flex-col">
              <Dialog.Title className="truncate text-base leading-5 font-semibold tracking-[-0.005em] text-[var(--text-primary)]">
                {title}
              </Dialog.Title>
              {supportLine ? (
                <Dialog.Description className="truncate text-[13px] leading-5 text-[var(--text-secondary)]">{supportLine}</Dialog.Description>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1 self-start pt-[18px]">
              {headerActions}
              <Dialog.Close
                render={
                  <Button
                    aria-label={closeLabel}
                    className="size-8! min-w-8! text-[var(--text-secondary)] hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)]"
                    // data-slot explicito: o Dialog.Close nao pode tirar o botao do tema do admin.
                    data-slot="button"
                    size="icon"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <XIcon aria-hidden="true" className="size-4" />
              </Dialog.Close>
            </div>
          </header>

          <div
            className="flex min-h-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-1 pb-6 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin] md:px-6 md:pb-8"
            onScroll={measure}
            ref={bodyRef}
          >
            {children}
          </div>

          {footer ? (
            <footer
              className={cn(
                "relative z-[2] flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 md:px-6",
                "transition-shadow duration-150 ease-[var(--ease-admin)]",
                hasMore && "shadow-[0_-8px_16px_rgba(0,0,0,0.25)]"
              )}
            >
              {footer}
            </footer>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type AdminSheetSectionProps = {
  /** Texto curto a direita do titulo, ex.: "1 item". */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  title: ReactNode;
};

/**
 * Secao do corpo do painel: titulo 13/600 e meta 12/500 a direita, 12 px ate o conteudo; linha e 24 px
 * entre secoes (nunca card dentro do painel).
 */
export function AdminSheetSection({ aside, children, className, title }: AdminSheetSectionProps) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 border-t border-[var(--border-subtle)] pt-6 first:border-t-0 first:pt-0",
        className
      )}
    >
      <div className="flex min-h-5 items-baseline justify-between gap-3">
        <h3 className="text-[13px] leading-5 font-semibold text-[var(--text-primary)]">{title}</h3>
        {aside ? <span className="min-w-0 truncate text-xs leading-4 font-medium text-[var(--text-tertiary)]">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}
