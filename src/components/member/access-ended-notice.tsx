"use client";

import { Lock, ShoppingCart } from "lucide-react";
import { trackCheckoutClick } from "@/components/member/page-visit-beacon";

// O aviso do curso vencido na página do curso (docs/05, "Prazo de acesso por curso"): a frase com a data do
// término e, quando o produto tem link de compra, o botão Comprar. Sem link, só a frase. O acesso é negado no
// servidor (entitlements); este aviso só explica por que o curso está fechado.

type AccessEndedNoticeProps = {
  contentId: string;
  /** "Seu acesso terminou em dd/mm/aaaa". */
  label: string;
  purchaseLabel?: string;
  purchaseTarget?: "same_tab" | "new_tab";
  purchaseUrl?: string;
};

export function AccessEndedNotice({ contentId, label, purchaseLabel, purchaseTarget, purchaseUrl }: AccessEndedNoticeProps) {
  return (
    <div
      className="mx-5 mb-8 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-orange-400/30 bg-orange-500/10 px-4 py-3 sm:mx-8 lg:mx-12"
      data-access-ended=""
      role="status"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-orange-200">
        <Lock aria-hidden="true" className="h-4 w-4 shrink-0" />
        {label}
      </p>
      {purchaseUrl ? (
        <a
          className="inline-flex min-h-11 items-center gap-2 rounded-[8px] bg-emerald-600 px-5 text-sm font-extrabold text-white transition hover:bg-emerald-500"
          href={purchaseUrl}
          onClick={() => trackCheckoutClick(contentId)}
          rel={purchaseTarget === "new_tab" ? "noopener noreferrer" : undefined}
          target={purchaseTarget === "new_tab" ? "_blank" : undefined}
        >
          <ShoppingCart aria-hidden="true" className="h-4 w-4 fill-current" />
          {purchaseLabel ?? "Comprar"}
        </a>
      ) : null}
    </div>
  );
}
