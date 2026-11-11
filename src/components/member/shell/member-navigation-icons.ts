import {
  Bookmark,
  CirclePlay,
  CircleUser,
  FolderOpen,
  House,
  LibraryBig,
  LifeBuoy,
  Radio,
  Route,
  ShieldCheck,
  type LucideIcon
} from "lucide-react";
import type { MemberNavigationKey } from "@/lib/member-navigation";

// Icone de cada destino da barra lateral e do menu da conta (src/lib/member-navigation.ts fica sem
// icones). `Compass` fica reservado para a IA Diretor; `Radio` e o icone das lives (o mesmo do sino).
export const memberNavigationIcons: Record<MemberNavigationKey, LucideIcon> = {
  continueWatching: CirclePlay,
  favorites: Bookmark,
  home: House,
  journey: Route,
  // Minhas licencas (docs/32 §2.4): o escudo que a moldura ja carrega (a Area do produtor), para o item so de quem
  // comprou o Bunker Members nao somar um icone ao JavaScript de toda pagina do aluno.
  licenses: ShieldCheck,
  materials: FolderOpen,
  profile: CircleUser,
  purchases: LibraryBig,
  support: LifeBuoy,
  webinars: Radio
};
