import type { Metadata } from "next";

import { TvReceiverExperience } from "@/components/tv-receiver-experience";

export const metadata: Metadata = {
  description: "Conecte uma TV a uma aula da area de membros Bunker707.",
  robots: { follow: false, index: false },
  title: "Modo TV | Bunker707"
};

export default function TvPage() {
  return <TvReceiverExperience />;
}
