import { LoaderCircle } from "lucide-react";

export default function AdminLoading() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="grid min-h-screen place-items-center bg-background px-6 text-foreground"
      role="status"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-full border border-border bg-muted/30">
          <LoaderCircle className="size-5 animate-spin text-primary" />
        </span>
        <div>
          <p className="text-sm font-semibold">Carregando o Admin Bunker707...</p>
          <p className="mt-1 text-xs text-muted-foreground">Preparando catálogo, estrutura e configurações.</p>
        </div>
      </div>
    </main>
  );
}
