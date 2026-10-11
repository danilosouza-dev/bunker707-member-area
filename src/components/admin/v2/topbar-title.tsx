"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Titulo da barra superior no celular (prototipo aprovado): por padrao o nome da area
// (getAdminMobileTitle); a pagina de um produto troca pelo nome do produto. No computador o H1 da
// pagina ja cumpre esse papel, entao isto so aparece abaixo de 768 px.

type AdminTopbarTitleContextValue = {
  setTitle: (title: string | null) => void;
  title: string | null;
};

const AdminTopbarTitleContext = createContext<AdminTopbarTitleContextValue | null>(null);

/** Montado uma vez em AdminShellV2. */
export function AdminTopbarTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ setTitle, title }), [title]);

  return <AdminTopbarTitleContext.Provider value={value}>{children}</AdminTopbarTitleContext.Provider>;
}

/** Troca o titulo da barra do celular enquanto o componente estiver montado (null volta ao da area). */
export function useAdminTopbarTitle(title: string | null) {
  const setTitle = useContext(AdminTopbarTitleContext)?.setTitle;
  const normalized = title?.trim() || null;

  useEffect(() => {
    if (!setTitle) {
      return;
    }

    setTitle(normalized);

    return () => setTitle(null);
  }, [normalized, setTitle]);
}

/** Versao em componente, para paginas e layouts do servidor: <AdminTopbarTitle title={produto.nome} />. */
export function AdminTopbarTitle({ title }: { title: string | null }) {
  useAdminTopbarTitle(title);

  return null;
}

/** Titulo trocado pela pagina, ou null (a barra usa o nome da area). */
export function useAdminTopbarTitleOverride() {
  return useContext(AdminTopbarTitleContext)?.title ?? null;
}
