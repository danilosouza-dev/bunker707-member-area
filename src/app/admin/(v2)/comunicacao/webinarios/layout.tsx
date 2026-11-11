import type { ReactNode } from "react";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import { requireFeaturePage } from "@/server/licensing/guards";

// Comunicação › Webinários sem o modulo dos Webinarios na licenca (docs/32 §11.8): o 404 sai daqui, do layout, e nao
// da pagina. O notFound() de uma pagina de [id] cairia no not-found.tsx de [id] ("Webinário não encontrado"), que
// diria que o modulo existe; o do layout cai na pagina de nao encontrado da raiz, a mesma de um endereco que nao
// existe. Cada page.tsx confere de novo (o layout nao roda de novo ao navegar entre as paginas daqui). No modo "off"
// so devolve as paginas, como antes.
export default async function AdminWebinarsLayout({ children }: { children: ReactNode }) {
  await requireFeaturePage(WEBINARS_FEATURE);

  return children;
}
