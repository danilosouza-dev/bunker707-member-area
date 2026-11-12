"use client";

import { createContext, useContext, type ReactNode } from "react";
import { NO_DISABLED_FEATURES, type FeatureKey } from "@/server/licensing/features";

// Os modulos desligados na licenca (docs/32 §11.8), lidos no servidor pelo layout do admin e entregues a moldura: o
// menu, a busca e as abas de Comunicacao escondem as telas deles. Fora da moldura (ou no modo "off"), a lista vazia.

const AdminFeaturesContext = createContext<readonly FeatureKey[]>(NO_DISABLED_FEATURES);

export function AdminFeaturesProvider({ children, disabledFeatures }: { children: ReactNode; disabledFeatures: readonly FeatureKey[] }) {
  return <AdminFeaturesContext.Provider value={disabledFeatures}>{children}</AdminFeaturesContext.Provider>;
}

export function useAdminDisabledFeatures(): readonly FeatureKey[] {
  return useContext(AdminFeaturesContext);
}
