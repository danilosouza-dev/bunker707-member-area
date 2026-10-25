// O aparelho da tela do aluno (docs/27 §1 e §9.10): ate 767 px e o celular. Um modulo minusculo, sem imports, que
// o cartao Livre (popup-free-card.tsx) e a janela do pop-up (member-popup-dialog.tsx) leem pelo mesmo
// useSyncExternalStore: girar o celular com o pop-up aberto troca o desenho do cartao e o nome do dialogo juntos.

/** Quando o aluno ve os valores do celular (docs/27 §1): tela de ate 767 px, a mesma regra em todo lugar. */
export const FREE_MOBILE_QUERY = "(max-width: 767px)";

export type FreeDevice = "desktop" | "mobile";

type MediaWindow = { matchMedia?: (query: string) => { matches: boolean } };

/** O aparelho pela largura da tela; sem matchMedia, o computador. */
export function freeDeviceOfWindow(win: MediaWindow): FreeDevice {
  return typeof win.matchMedia === "function" && win.matchMedia(FREE_MOBILE_QUERY).matches ? "mobile" : "desktop";
}

/** Avisa quando a tela cruza os 767 px (girar o celular, redimensionar a janela). */
export function subscribeFreeDevice(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(FREE_MOBILE_QUERY) : null;

  query?.addEventListener?.("change", onChange);

  return () => query?.removeEventListener?.("change", onChange);
}

/** O aparelho agora (no navegador). */
export const freeDeviceSnapshot = (): FreeDevice => freeDeviceOfWindow(window);

/** No servidor (previa do admin desenhada antes do navegador): o computador. */
export const freeServerDevice = (): FreeDevice => "desktop";
