"use client";

import { createContext, useContext } from "react";
import type { PlatformBrandingConfig } from "@/lib/platform-types";
import { normalizeSchoolIcon } from "@/server/communications/message-meta";

const defaultLogoImage = "/brand/logo-bunker.svg";

const PlatformBrandingContext = createContext<PlatformBrandingConfig | undefined>(undefined);

export function PlatformBrandingProvider({
  branding,
  children
}: {
  branding?: PlatformBrandingConfig;
  children: React.ReactNode;
}) {
  return <PlatformBrandingContext.Provider value={branding}>{children}</PlatformBrandingContext.Provider>;
}

export function usePlatformLogoImage() {
  const branding = useContext(PlatformBrandingContext);
  return branding === undefined ? defaultLogoImage : branding.logoImage;
}

/** Icone da escola de Marca (quadrado): o enviado em Marca ou, sem ele, o simbolo padrao (SCHOOL_DEFAULT_ICON). */
export function usePlatformSchoolIcon() {
  const branding = useContext(PlatformBrandingContext);
  return normalizeSchoolIcon(branding?.schoolIcon);
}
