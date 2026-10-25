import "server-only";

// Qual botao do pop-up Livre o aluno clicou (docs/25 §5.1; docs/27 L47): "cta" (o Botao principal) ou "link:<id>" (um
// "Abrir um link", pelo id do elemento). Vai em metadata.button do message_clicked, so com ids (docs/06), para o
// relatorio por botao ter dados desde o primeiro dia (o relatorio de hoje soma todos em "Clicaram no botão").
// O valor vem do navegador: so passa com a forma certa E quando o design do pop-up no ar tem esse botao visivel (no
// computador ou no celular); o resto e ignorado sem 400 (o clique grava sem a chave). Padrão e Personalizado nunca
// levam a chave. So do servidor: o navegador nunca importa este modulo (fora de popup-display-model.ts, que vai para
// o JS de toda pagina do aluno).

import { isSafeHeroCtaHref } from "@/server/member-area/home-hero-links";
import { describeError } from "./db";
import type { FreeNode, PopupFreeDesign } from "./popup-free-model";
import { resolveFreeForDevice } from "./popup-free-render";
import { livePopupFreeDesign } from "./popups";

/** "cta" ou "link:" + o id do elemento no formato de FREE_ID_PATTERN (popup-free-model.ts; um teste confere que bate). */
export const POPUP_CLICKED_BUTTON_PATTERN = /^(?:cta|link:[a-z][a-z0-9]{0,15})$/;

/** A forma do valor: "cta" ou "link:<id>"; o resto (outro tipo, texto longo, maiuscula, outro prefixo) e null. */
export function popupClickedButton(value: unknown): string | null {
  return typeof value === "string" && POPUP_CLICKED_BUTTON_PATTERN.test(value) ? value : null;
}

/** Algum elemento que o aluno ve (sem `hidden` e fora de caixa escondida) satisfaz `match`. */
function someVisible(nodes: readonly FreeNode[], match: (node: FreeNode) => boolean): boolean {
  return nodes.some((node) => !node.hidden && (match(node) || (node.type === "box" && someVisible(node.children, match))));
}

/**
 * O botao existe no design e o aluno pode ter clicado nele: "cta" pede um Botao principal visivel e o aviso com botao
 * (`hasCta`); "link:<id>" pede o "Abrir um link" com esse id, destino conferido e visivel. Vale o computador ou o
 * celular (devices.mobile pode mostrar o que o computador esconde, e o contrario).
 */
export function popupClickedButtonInDesign(button: string, design: PopupFreeDesign, hasCta: boolean): boolean {
  const id = button.startsWith("link:") ? button.slice("link:".length) : null;

  if (id === null && (button !== "cta" || !hasCta)) {
    return false;
  }

  const match =
    id === null
      ? (node: FreeNode) => node.type === "button" && node.action.kind === "cta"
      : (node: FreeNode) => node.type === "button" && node.id === id && node.action.kind === "link" && isSafeHeroCtaHref(node.action.href);

  return someVisible(design.children, match) || someVisible(resolveFreeForDevice(design, "mobile").children, match);
}

/**
 * O botao para metadata.button, ou null. Nada e lido sem a forma certa; o design vem da lista no ar em cache (a mesma
 * do show). Uma falha na leitura vira log e null: o historico e secundario e nunca muda a resposta da rota.
 */
export async function resolvePopupClickedButton(campaignId: string, value: unknown): Promise<string | null> {
  const button = popupClickedButton(value);

  if (!button) {
    return null;
  }

  try {
    const live = await livePopupFreeDesign(campaignId);

    return live && popupClickedButtonInDesign(button, live.freeDesign, live.hasCta) ? button : null;
  } catch (error) {
    console.error(`[comunicacao] botao clicado do pop-up ${campaignId}: ${describeError(error)}`);

    return null;
  }
}
