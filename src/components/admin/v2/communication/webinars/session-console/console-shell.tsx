"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";
import type { RoomTheme } from "@/lib/webinar-room-prefs";
import { AdminToaster } from "../../../toast";

// A raiz do console V2 de quem apresenta (docs/31 V2-12 e V2-13): a tela cheia, sem a barra lateral do admin, no tema
// escolhido. O data-room-theme (os --room-* da sala) e o data-console-root (a ponte que redefine os tokens do admin por
// eles, globals.css) ficam no MESMO elemento. Nao e dialogo nem camada por cima: os menus e as confirmacoes do console
// vao para o [data-console-portal], dentro da raiz, e seguem o tema; os avisos (adminToast) tambem, pelo AdminToaster
// montado aqui com o tema (a moldura nao monta o dela na tela cheia), em cima, no meio, abaixo do topo. O ref do portal nasce no SessionConsole, que e o
// pai das confirmacoes: elas recebem o container direto; os menus dos filhos leem o mesmo ref por useConsolePortal().

const ConsolePortalContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** Onde os menus do console abrem (dentro da raiz, no tema); nulo fora do console (o body, como em todo o admin). */
export function useConsolePortal(): RefObject<HTMLDivElement | null> | null {
  return useContext(ConsolePortalContext);
}

type ConsoleShellProps = {
  /** A faixa dos avisos logo abaixo do topo (o erro e as frases de so leitura); nada quando vazia. */
  banner?: ReactNode;
  /** O corpo: a coluna do palco e o painel (consoleSkeleton). */
  children: ReactNode;
  /** As classes da raiz e da faixa (consoleSkeleton). */
  classNames: { banner: string; root: string };
  /** O ref do [data-console-portal] (nasce no SessionConsole). */
  portalRef: RefObject<HTMLDivElement | null>;
  theme: RoomTheme;
  /** O topo (ConsoleTopBar). */
  top: ReactNode;
};

export function ConsoleShell({ banner, children, classNames, portalRef, theme, top }: ConsoleShellProps) {
  return (
    <div className={classNames.root} data-console-root="" data-field-focus="own" data-room-theme={theme}>
      <ConsolePortalContext.Provider value={portalRef}>
        {top}
        {banner ? <div className={classNames.banner}>{banner}</div> : null}
        {children}
      </ConsolePortalContext.Provider>
      <div data-console-portal="" ref={portalRef} />
      <AdminToaster placement="console" theme={theme} />
    </div>
  );
}
