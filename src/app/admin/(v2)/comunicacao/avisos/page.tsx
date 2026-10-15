import type { Metadata } from "next";
import { CommunicationFrame } from "@/components/admin/v2/frames/communication-frame";
import { readAdminPeriod } from "@/components/admin/v2/period";
import { requirePageArea } from "@/server/auth/permissions";

export const metadata: Metadata = {
  title: "Avisos e pop-ups · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Comunicação › Avisos e pop-ups: moldura do prototipo aprovado com os numeros em "—" e o aviso de tela em
// construcao. O periodo vem do menu "Período" da barra superior.
export default async function AdminAnnouncementsPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);
  const period = readAdminPeriod(params, new Date());

  return (
    <CommunicationFrame data-phase={5} period={period} tab="avisos" />
  );
}
