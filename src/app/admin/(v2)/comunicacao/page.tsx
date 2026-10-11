import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { COMMUNICATION_HOME_HREF } from "@/components/admin/v2/frames/communication-model";
import { requirePageAdmin } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// /admin/comunicacao abre na primeira aba (Avisos e pop-ups), levando o periodo e os demais parametros.
export default async function AdminCommunicationPage({ searchParams }: PageProps) {
  const [, params] = await Promise.all([requirePageAdmin(), searchParams]);
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, entry);
    }
  }

  const suffix = query.toString();

  redirect(suffix ? `${COMMUNICATION_HOME_HREF}?${suffix}` : COMMUNICATION_HOME_HREF);
}
