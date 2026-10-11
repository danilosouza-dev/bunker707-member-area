"use client";

import { createContext, use, useState, type ReactNode } from "react";
import type { ProductHeader, ProductImageSaved } from "@/server/catalog/types";

// Estado compartilhado da pagina do produto (cabecalho + abas). Cada acao de edicao devolve o
// cabecalho (ou, na troca de imagem, o `updatedAt`) novo; guardamos o mais recente aqui para que a
// proxima escrita, em qualquer aba, mande o `expectedUpdatedAt` certo (senao o servidor responde 409
// a toa). O cabecalho vindo do servidor (router.refresh ou navegacao) vence quando for mais novo.

export type ProductCapabilities = {
  canDelete: boolean;
  canPublish: boolean;
  canWrite: boolean;
};

type ProductWorkspaceValue = {
  /** Cabecalho devolvido por uma Server Action (renomear, salvar Detalhes/Acesso, publicar...). */
  applyHeader: (header: ProductHeader) => void;
  /** Capa ou imagem de destaque gravada: a capa aparece na hora no cabecalho e o `updatedAt` novo vale para a proxima escrita. */
  applyImage: (saved: ProductImageSaved) => void;
  capabilities: ProductCapabilities;
  header: ProductHeader;
};

const ProductWorkspaceContext = createContext<ProductWorkspaceValue | null>(null);

function pickNewest(server: ProductHeader, local: ProductHeader | null) {
  if (!local || local.id !== server.id) {
    return server;
  }

  return Date.parse(local.updatedAt) > Date.parse(server.updatedAt) ? local : server;
}

type ProductWorkspaceProviderProps = {
  capabilities: ProductCapabilities;
  children: ReactNode;
  header: ProductHeader;
};

export function ProductWorkspaceProvider({ capabilities, children, header: serverHeader }: ProductWorkspaceProviderProps) {
  const [local, setLocal] = useState<ProductHeader | null>(null);
  const header = pickNewest(serverHeader, local);

  const value: ProductWorkspaceValue = {
    applyHeader: (next) => setLocal(next),
    applyImage: (saved) =>
      setLocal((current) => {
        const base = pickNewest(serverHeader, current);

        return {
          ...base,
          coverUrl: saved.slot === "cover" ? saved.url : base.coverUrl,
          updatedAt: saved.updatedAt
        };
      }),
    capabilities,
    header
  };

  return <ProductWorkspaceContext value={value}>{children}</ProductWorkspaceContext>;
}

export function useProductWorkspace() {
  const value = use(ProductWorkspaceContext);

  if (!value) {
    throw new Error("useProductWorkspace precisa estar dentro de ProductWorkspaceProvider.");
  }

  return value;
}
