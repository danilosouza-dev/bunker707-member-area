"use client";

import { BellRing, Clock, Plus, Sparkles, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { FlowDraft } from "@/server/communications/flow-schemas";
import type { NoticeEditorOptions } from "@/server/communications/queries";
import { AdminPage } from "../../page-container";
import { PageHeader } from "../../page-header";
import { adminCard, adminTransition } from "../../styles";
import { useAdminTopbarTitle } from "../../topbar-title";
import { FlowBuilder } from "./flow-builder";
import { buildFlowTemplate, FLOW_TEMPLATES, type FlowTemplateId } from "./flow-templates-model";
import { FLOWS_HREF, type FlowPermissions } from "./flows-view-model";

// Novo fluxo (docs/23 §2.5): "Como você quer começar?" com os quatro modelos. Escolher um monta o rascunho
// no navegador e abre o construtor na mesma tela; nada e gravado ate "Salvar rascunho" (que leva para o
// endereco do fluxo). "Trocar de modelo" volta aqui.

const TEMPLATE_ICONS: Record<FlowTemplateId, LucideIcon> = {
  blank: Plus,
  deadline: Clock,
  unopened: BellRing,
  welcome: Sparkles
};

type FlowTemplatesProps = {
  now: number;
  options: NoticeEditorOptions;
  permissions: FlowPermissions;
};

export function FlowTemplates({ now, options, permissions }: FlowTemplatesProps) {
  const [draft, setDraft] = useState<FlowDraft | null>(null);

  useAdminTopbarTitle("Novo fluxo");

  if (draft) {
    return <FlowBuilder initial={null} now={now} onChangeTemplate={() => setDraft(null)} options={options} permissions={permissions} templateDraft={draft} />;
  }

  return (
    <AdminPage className="gap-6">
      <PageHeader
        breadcrumb={[{ href: FLOWS_HREF, label: "Fluxos" }, { label: "Novo fluxo" }]}
        description="Escolha um modelo e ajuste os textos. Nada é salvo até você salvar o rascunho."
        title="Novo fluxo"
      />
      <section aria-labelledby="fluxo-modelos-titulo" className="flex min-w-0 flex-col gap-3">
        <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="fluxo-modelos-titulo">
          Como você quer começar?
        </h2>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {FLOW_TEMPLATES.map((template) => {
            const Icon = TEMPLATE_ICONS[template.id];

            return (
              <button
                className={cn(
                  adminCard,
                  "flex min-h-11 min-w-0 flex-col items-start gap-2 p-4 text-left hover:border-[var(--text-tertiary)] hover:bg-[var(--hover-overlay)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                  adminTransition
                )}
                key={template.id}
                onClick={() => setDraft(buildFlowTemplate(template.id, () => crypto.randomUUID()))}
                type="button"
              >
                <span aria-hidden="true" className="grid size-9 place-items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)]">
                  <Icon className="size-4" />
                </span>
                <span className="text-[15px] leading-6 font-semibold text-[var(--text-primary)]">{template.title}</span>
                <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{template.description}</span>
                <span className="text-xs leading-5 text-[var(--text-tertiary)]">{template.steps}</span>
              </button>
            );
          })}
        </div>
      </section>
    </AdminPage>
  );
}
