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
  materials: FolderOpen,
  profile: CircleUser,
  purchases: LibraryBig,
  support: LifeBuoy,
  webinars: Radio
};
