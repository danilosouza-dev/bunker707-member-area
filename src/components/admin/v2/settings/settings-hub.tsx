import {
  ChevronRight,
  Clapperboard,
  Send,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Users,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { isAdminV2Href } from "../nav";
import { StatusChip, type StatusChipTone } from "../status-chip";
import { adminCard, adminTransition } from "../styles";

// Hub de Configuracoes (docs/17 §1.10; prototipo aprovado, tela 14): uma lista, uma linha por
// grupo, com o estado honesto de cada um. So o Tutor IA ja tem tela; o resto diz "Em breve" e nao
// e clicavel (nenhuma linha leva a uma tela vazia).

export type SettingsHubStatus = { label: string; tone: StatusChipTone };

type SettingsHubEntry = {
  description: string;
  href?: string;
  icon: LucideIcon;
  id: string;
  status: SettingsHubStatus | null;
  title: string;
};

const comingSoon: SettingsHubStatus = { label: "Em breve", tone: "muted" };

export function buildSettingsHubEntries(aiStatus: SettingsHubStatus | null): SettingsHubEntry[] {
  return [
    {
      description: "Quem acessa o admin e o que cada papel pode fazer: dono, admin, editor, suporte e analista.",
      icon: Users,
      id: "equipe",
      status: comingSoon,
      title: "Equipe"
    },
    {
      description: "Provedores de vídeo conectados, provedor padrão e custo estimado do mês.",
      icon: Clapperboard,
      id: "video",
      status: comingSoon,
      title: "Vídeo"
    },
    {
      description: "Tutor IA e Diretor: provedores, limites, conexões e consumo.",
      href: "/admin/configuracoes/ia",
      icon: Sparkles,
      id: "ia",
      status: aiStatus,
      title: "Tutor IA"
    },
    {
      description: "Hotmart e Ticto liberando o acesso sozinhas quando a venda chega. Até lá, o acesso é liberado à mão.",
      icon: Tag,
      id: "vendas",
      status: comingSoon,
      title: "Vendas"
    },
    {
      description: "Remetente de e-mail, WhatsApp oficial e notificações push.",
      icon: Send,
      id: "canais",
      status: comingSoon,
      title: "Canais de envio"
    },
    {
      description: "Nome da escola, fuso horário e domínio.",
      icon: SlidersHorizontal,
      id: "geral",
      status: comingSoon,
      title: "Geral"
    }
  ];
}

function EntryBody({ entry }: { entry: SettingsHubEntry }) {
  const Icon = entry.icon;

  return (
    <>
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{entry.title}</span>
        <span className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">{entry.description}</span>
        {entry.status ? (
          <span className="mt-2 sm:hidden">
            <StatusChip tone={entry.status.tone}>{entry.status.label}</StatusChip>
          </span>
        ) : null}
      </span>
      {entry.status ? (
        <span className="hidden shrink-0 sm:block">
          <StatusChip tone={entry.status.tone}>{entry.status.label}</StatusChip>
        </span>
      ) : null}
      <span aria-hidden="true" className="grid w-5 shrink-0 place-items-center text-[var(--text-tertiary)]">
        {entry.href ? <ChevronRight className="size-4" /> : null}
      </span>
    </>
  );
}

export function SettingsHub({ aiStatus }: { aiStatus: SettingsHubStatus | null }) {
  const entries = buildSettingsHubEntries(aiStatus);
  const rowClass = "flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left";

  return (
    <ul className={cn(adminCard, "w-full max-w-[880px] divide-y divide-[var(--border-subtle)] overflow-hidden")}>
      {entries.map((entry) => (
        <li key={entry.id}>
          {entry.href ? (
            <Link
              className={cn(rowClass, adminTransition, "hover:bg-[var(--hover-overlay)]")}
              data-navigation-feedback={isAdminV2Href(entry.href) ? "false" : undefined}
              href={entry.href}
            >
              <EntryBody entry={entry} />
            </Link>
          ) : (
            <div className={rowClass}>
              <EntryBody entry={entry} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
