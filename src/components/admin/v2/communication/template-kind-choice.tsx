"use client";

import { BellRing, PanelTop, PencilRuler, Shapes, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TEMPLATES_HREF, type TemplateType } from "@/server/communications/template-model";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { adminCard, adminTransition } from "../styles";
import { useAdminTopbarTitle } from "../topbar-title";
import { TEMPLATE_EDITOR_COPY, TEMPLATE_KIND_CHOICES } from "./template-editor-model";

// Novo modelo (docs/28 §5.5): "Que tipo de modelo você quer criar?" com os quatro cartoes (Notificação, Pop-up,
// Design Personalizado e Design Livre). Cada cartao e um link (foco visivel com o anel de 2 px) para /modelos/novo?tipo=..., que abre o editor em modo
// modelo vazio; nada e gravado ate "Salvar modelo". No molde de "Novo fluxo" (flows/flow-templates.tsx).

const ICONS: Record<TemplateType, LucideIcon> = {
  design_custom: Shapes,
  design_free: PencilRuler,
  inbox: BellRing,
  popup: PanelTop
};

export function TemplateKindChoice() {
  const copy = TEMPLATE_EDITOR_COPY.choice;

  useAdminTopbarTitle(copy.title);

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={[{ href: TEMPLATES_HREF, label: TEMPLATE_EDITOR_COPY.breadcrumb.list }, { label: TEMPLATE_EDITOR_COPY.breadcrumb.new }]}
        description={copy.description}
        title={copy.title}
      />
      <ul aria-label={copy.listLabel} className="m-0 grid min-w-0 list-none gap-3 p-0 sm:grid-cols-2">
        {TEMPLATE_KIND_CHOICES.map((choice) => {
          const Icon = ICONS[choice.type];

          return (
            <li className="min-w-0" key={choice.type}>
              <Link
                className={cn(
                  adminCard,
                  "flex h-full min-h-11 min-w-0 flex-col items-start gap-2 p-4 text-left hover:border-[var(--text-tertiary)] hover:bg-[var(--hover-overlay)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                  adminTransition
                )}
                data-template-kind={choice.type}
                href={choice.href}
              >
                <span aria-hidden="true" className="grid size-9 place-items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
                  <Icon className="size-4" />
                </span>
                <span className="text-[15px] leading-6 font-semibold text-[var(--text-primary)]">{choice.title}</span>
                <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{choice.description}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </AdminPage>
  );
}
