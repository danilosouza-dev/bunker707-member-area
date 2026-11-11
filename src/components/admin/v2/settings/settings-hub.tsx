import {
  ChevronRight,
  Clapperboard,
  Download,
  KeyRound,
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
// grupo, com o estado honesto de cada um. Equipe, Tutor IA e Vendas ja tem tela; o resto diz "Em breve"
// e nao e clicavel (nenhuma linha leva a uma tela vazia). Cada pessoa ve so as linhas que pode usar:
// Equipe e Vendas so o dono; Tutor IA quem tem settings.ai. A linha Licenca (docs/32 §2.4) so existe no produto
// vendido (modo "enforce") e so para o dono e os administradores: a pagina passa `license` so nesse caso. A linha
// Exportar dados (docs/32 §4) e do dono e dos administradores, nos dois modos e em todo degrau da Licenca.

export type SettingsHubStatus = { label: string; tone: StatusChipTone };

type SettingsHubEntry = {
  description: string;
  href?: string;
  icon: LucideIcon;
  id: string;
  status: SettingsHubStatus | null;
  title: string;
};

/** O que a pessoa pode abrir no hub (vem das permissoes dela, no servidor). */
export type SettingsHubAccess = {
  canAi: boolean;
  /** Dono ou administrador (src/server/licensing/admin-access.ts): Exportar dados. */
  canExportData?: boolean;
  canSales: boolean;
  canTeam: boolean;
  /** Pessoas na equipe (so para quem ve a Equipe); null = sem leitura. */
  teamCount: number | null;
};

const comingSoon: SettingsHubStatus = { label: "Em breve", tone: "muted" };

const FULL_ACCESS: SettingsHubAccess = { canAi: true, canSales: true, canTeam: true, teamCount: null };

function teamStatus(count: number | null): SettingsHubStatus | null {
  if (count === null) {
    return null;
  }

  return { label: count === 1 ? "1 pessoa" : `${count} pessoas`, tone: "neutral" };
}

export function buildSettingsHubEntries(
  aiStatus: SettingsHubStatus | null,
  access: SettingsHubAccess = FULL_ACCESS,
  salesStatus: SettingsHubStatus | null = null,
  license: { status: SettingsHubStatus | null } | null = null
): SettingsHubEntry[] {
  const licenseEntries: SettingsHubEntry[] = license
    ? [
        {
          description: "A Licença desta área de membros: situação, validade, módulos, Verificar agora e ativação.",
          href: "/admin/configuracoes/licenca",
          icon: KeyRound,
          id: "licenca",
          status: license.status,
          title: "Licença"
        }
      ]
    : [];
  const entries: SettingsHubEntry[] = [
    ...licenseEntries,
    {
      description: "Quem entra no admin e o que cada pessoa pode fazer: dono, administrador, editor, professor, suporte, analista ou personalizado.",
      href: "/admin/configuracoes/equipe",
      icon: Users,
      id: "equipe",
      status: teamStatus(access.teamCount),
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
      description: "Hotmart e Ticto liberando o acesso sozinhas quando a venda chega; Kiwify em configuração. O que chegou aparece aqui.",
      href: "/admin/configuracoes/vendas",
      icon: Tag,
      id: "vendas",
      status: salesStatus,
      title: "Vendas"
    },
    {
      description: "Baixar um ZIP com os alunos, os acessos, o progresso, os cursos e as vendas, em planilhas, com um LEIA-ME que explica cada arquivo.",
      href: "/admin/configuracoes/dados",
      icon: Download,
      id: "dados",
      status: null,
      title: "Exportar dados"
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

  // Linhas so de quem pode usar (as "Em breve" valem para todos que veem Configuracoes).
  const visibility: Record<string, boolean> = { dados: access.canExportData === true, equipe: access.canTeam, ia: access.canAi, vendas: access.canSales };

  return entries.filter((entry) => visibility[entry.id] ?? true);
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

export function SettingsHub({
  access,
  aiStatus,
  license = null,
  salesStatus = null
}: {
  access?: SettingsHubAccess;
  aiStatus: SettingsHubStatus | null;
  /** So no produto vendido e para o dono e os administradores: a linha da tela Licenca. */
  license?: { status: SettingsHubStatus | null } | null;
  salesStatus?: SettingsHubStatus | null;
}) {
  const entries = buildSettingsHubEntries(aiStatus, access, salesStatus, license);
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
