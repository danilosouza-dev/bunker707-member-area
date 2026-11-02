import { SessionConsoleSkeleton } from "@/components/admin/v2/communication/webinars/session-console/session-console-skeleton";

// O console da sessao em tela cheia (docs/31 V2-13), ja sem a barra lateral do admin: o topo (a seta, o titulo, o
// seletor e os botoes), a coluna do palco com a barra e o painel, no escuro.
export default function AdminWebinarConsoleLoading() {
  return <SessionConsoleSkeleton />;
}
