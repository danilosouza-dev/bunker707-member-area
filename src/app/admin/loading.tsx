"use client";

import { usePathname } from "next/navigation";
import { isAdminLegacyPath } from "@/components/admin/v2/nav";
import { AdminShellSkeleton } from "@/components/admin/v2/skeletons";
import AdminLegacyLoading from "./legado/loading";

// Este loading envolve todo /admin, inclusive o admin antigo, que nao usa a moldura nova.
// Admin novo: skeleton com a forma final (docs/17 §2.7), nunca o spinner de tela cheia.
// Admin antigo (/admin/legado): o mesmo estado de carregamento do proprio legado.
export default function AdminLoading() {
  const pathname = usePathname();

  return isAdminLegacyPath(pathname) ? <AdminLegacyLoading /> : <AdminShellSkeleton />;
}
