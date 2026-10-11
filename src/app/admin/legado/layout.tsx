import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Admin antigo · Bunker707",
  robots: { follow: false, index: false }
};

// Faixa de transicao (docs/17 §1.2, regra 5): o admin atual vive aqui ate a ultima fase migrar.
// Fica no layout para que a pagina continue identica ao admin atual.
export default function AdminLegacyLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div
        className="flex min-h-8 items-center justify-center gap-1 border-b border-[rgba(255,255,255,0.08)] bg-[#0f0f10] px-4 py-1.5 text-xs text-[#a1a1aa] md:justify-end"
        role="note"
      >
        <span>Admin antigo. O novo está em</span>
        <Link
          className="rounded-[4px] font-medium text-[#f5f5f4] underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5f5f4]"
          href="/admin"
        >
          /admin
        </Link>
      </div>
      {children}
    </>
  );
}
