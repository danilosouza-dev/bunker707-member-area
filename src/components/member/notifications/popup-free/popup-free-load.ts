import type * as PopupFreeCardModule from "./popup-free-card";

// A unica porta do pedaco do cartao Livre (docs/27; spec §3.1 e §3.6): o host chama (pela janela do pop-up) antes
// do POST /show quando o plano diz `design: "free"` (sem o codigo, nada abre e nada conta como visto) e o
// MemberPopupCard usa no React.lazy. O cartao, os estilos, popup-free-render.ts e os 24 icones ficam neste pedaco,
// baixado so para pop-up Livre: o JS inicial e a janela do Padrão/Personalizado nao crescem.
//
// O pedaco ja baixado fica guardado aqui: a janela le dele o nome e a descricao do dialogo do Livre
// (popupFreeDialogAria, reexportado pelo cartao) sem puxar popup-free-render.ts para o pedaco da janela.

let loaded: typeof PopupFreeCardModule | undefined;

export const loadPopupFreeCard = (): Promise<typeof PopupFreeCardModule> => import("./popup-free-card").then((module) => (loaded = module));

/** O pedaco do cartao Livre, se ja chegou (o host baixa antes de abrir um Livre). */
export const loadedPopupFreeCard = () => loaded;
