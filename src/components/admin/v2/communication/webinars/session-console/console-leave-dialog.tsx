"use client";

import { ExternalLink, LogOut } from "lucide-react";
import { useRef, type RefObject } from "react";
import { RoomPill } from "@/components/member/webinars/room/room-pill";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { WEBINAR_COPY } from "@/lib/webinar-copy";

// A janela "Sair do console?" (docs/31 §10): no centro, sobre o veu, no desenho do Sair da sala do aluno (o cartao de
// raio 12 no fundo dos menus da sala, as pilulas do YouTube), dentro da raiz do console (o `container`, no tema dela).
// Abre quando a guarda segura uma saida com o console dentro da sala (use-console-leave-guard.ts). Tres saidas: Abrir
// em nova aba (a pilula de texto logo abaixo do texto: o mesmo endereco noutra aba; a sala fica) e, no rodape, Continuar
// no console (o primeiro foco, e o que o Esc e o clique no veu fazem) e Sair do console (vermelho: sai da sala e so
// entao troca de pagina; enquanto sai, a pilula gira e as outras ficam desligadas). Nenhuma frase escrita aqui.

const copy = WEBINAR_COPY.consoleV2.sair;

export type ConsoleLeaveDialogProps = {
  container: RefObject<HTMLDivElement | null>;
  /** O Sair confirmado em andamento (o console saindo da sala). */
  leaving: boolean;
  onLeave: () => void;
  onNewTab: () => void;
  onStay: () => void;
  open: boolean;
};

export function ConsoleLeaveDialog({ container, leaving, onLeave, onNewTab, onStay, open }: ConsoleLeaveDialogProps) {
  const stayRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next && !leaving) {
          onStay();
        }
      }}
      open={open}
    >
      <DialogContent
        className="max-w-[440px] gap-0 rounded-xl border border-room-panel-border bg-room-menu p-6 text-room-fg shadow-[var(--room-menu-shadow)]"
        container={container}
        data-console-leave=""
        initialFocus={stayRef}
        showCloseButton={false}
      >
        <DialogTitle className="text-xl leading-7 font-bold text-room-fg-strong">{copy.titulo}</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-5 text-room-fg-muted">
          {copy.texto} {copy.dica}
        </DialogDescription>
        <div className="mt-3">
          <RoomPill className="-ml-4" disabled={leaving} icon={ExternalLink} label={copy.novaAba} onClick={onNewTab} tone="text" />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <RoomPill data-console-leave-stay="" disabled={leaving} label={copy.ficar} onClick={onStay} ref={stayRef} tone="tonal" />
          <RoomPill busy={leaving} data-console-leave-confirm="" disabled={leaving} icon={LogOut} label={leaving ? copy.saindo : copy.sair} onClick={onLeave} tone="red" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
