"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { loadAssistantEditor, type AssistantEditorData } from "@/server/webinars/assistant-actions";
import { ErrorBanner } from "../../error-banner";
import { PendingMigrationNotice } from "../../pending-migration-notice";
import { AssistantEditorForm } from "./assistant/assistant-editor-form";
import { assistantCardNotice } from "./assistant/assistant-editor-model";

// O card Assistente do editor (docs/30 §1.6, §2.2, §6.6 e D24): ligado no webinario, "Responder tudo" padrao e as
// perguntas e respostas cadastradas, com o salvar proprio. webinar-editor.tsx monta este card num webinario gravado. O
// card le pela Server Action loadAssistantEditor ao abrir (Tentar de novo quando falha); banco sem a 202610290006, o
// aviso da migracao; sem WEBINAR_ASSISTANT_ENABLED=on no ambiente ou sem conexao de IA ativa, so a frase (o formulario
// fica escondido e nada quebra).

const COPY = WEBINAR_COPY.assistente.card;

export type AssistantCardProps = {
  canWrite: boolean;
  disabled: boolean;
  /** assistant_settings muda o updated_at do webinario: o editor recebe a versao nova (o proximo Salvar nao da 409). */
  onSaved?: (updatedAt: string) => void;
  webinarId: string;
};

type Loaded = { data: AssistantEditorData; webinarId: string } | { error: string; webinarId: string };

/** O card desenhado a partir do que a leitura devolveu (o teste de tela desenha cada estado). */
export function AssistantCardBody({ canWrite, data, disabled, onSaved, webinarId }: AssistantCardProps & { data: AssistantEditorData }) {
  if (data.pendingMigration) {
    return <PendingMigrationNotice migration={data.migration} size="compact" />;
  }
  const notice = assistantCardNotice(data);
  if (notice) {
    return (
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-assistant-notice={notice} role="status">
        {notice === "env" ? COPY.desligadoNoAmbiente : COPY.semIa}
      </p>
    );
  }
  return <AssistantEditorForm canWrite={canWrite} disabled={disabled} items={data.items} key={webinarId} onSaved={onSaved} settings={data.settings} webinarId={webinarId} />;
}

export function AssistantCard({ canWrite, disabled, onSaved, webinarId }: AssistantCardProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;
    loadAssistantEditor({ webinarId })
      .then((result) => {
        if (!stopped) {
          setLoaded(result.ok ? { data: result.data, webinarId } : { error: result.error || COPY.erroCarregar, webinarId });
        }
      })
      .catch(() => {
        if (!stopped) {
          setLoaded({ error: COPY.erroCarregar, webinarId });
        }
      });
    return () => {
      stopped = true;
    };
  }, [attempt, webinarId]);

  const current = loaded && loaded.webinarId === webinarId ? loaded : null;

  if (!current) {
    return (
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
        {COPY.carregando}
      </p>
    );
  }

  if ("error" in current) {
    return (
      <ErrorBanner
        action={
          <Button
            className="px-3"
            onClick={() => {
              setLoaded(null);
              setAttempt((value) => value + 1);
            }}
            type="button"
            variant="secondary"
          >
            {COPY.tentarDeNovo}
          </Button>
        }
      >
        {current.error}
      </ErrorBanner>
    );
  }

  return <AssistantCardBody canWrite={canWrite} data={current.data} disabled={disabled} onSaved={onSaved} webinarId={webinarId} />;
}
