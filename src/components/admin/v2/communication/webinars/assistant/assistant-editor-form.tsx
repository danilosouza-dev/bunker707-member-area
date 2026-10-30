"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { saveAssistant } from "@/server/webinars/assistant-actions";
import { ASSISTANT_LIMITS, type AssistantKnowledgeItem, type AssistantSettings } from "@/server/webinars/model";
import { ErrorBanner } from "../../../error-banner";
import { AdminField, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../../../form";
import { AdminSwitch } from "../../../settings/kit";
import { adminToast } from "../../../toast";
import { addKnowledge, assistantFormOf, assistantSaveInput, canAddKnowledge, knowledgeErrorsOf, removeKnowledge, updateKnowledge, type AssistantForm } from "./assistant-editor-model";

// O formulario do card Assistente (docs/30 §1.6, §2.2, §6.6 e D24): "Ligar o Assistente neste webinario", "Comecar
// cada sessao com Responder tudo" (com a dica do que acontece desligado) e as perguntas e respostas cadastradas (o que
// o Assistente precisa saber alem do video), com Adicionar, Remover e o salvar proprio (saveAssistant). Os erros do zod
// aparecem junto de cada campo; o banner guarda o erro geral (nunca toast); o sucesso vira toast. Quem so le ve tudo
// desligado.

const COPY = WEBINAR_COPY.assistente.card;

export type AssistantEditorFormProps = {
  canWrite: boolean;
  disabled: boolean;
  items: readonly AssistantKnowledgeItem[];
  onSaved?: (updatedAt: string) => void;
  settings: AssistantSettings;
  webinarId: string;
};

export function AssistantEditorForm({ canWrite, disabled, items, onSaved, settings, webinarId }: AssistantEditorFormProps) {
  const [form, setForm] = useState<AssistantForm>(() => assistantFormOf(settings, items));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, { answer?: string; question?: string }>>({});
  const locked = disabled || !canWrite || saving;

  async function save() {
    setSaving(true);
    setFailure(null);
    const result = await saveAssistant(assistantSaveInput(form, webinarId)).catch(() => null);
    setSaving(false);
    if (!result) {
      setFailure(COPY.erro);
      return;
    }
    if (!result.ok) {
      setErrors(knowledgeErrorsOf(form, result.fieldErrors));
      setFailure(result.error || COPY.erro);
      return;
    }
    setErrors({});
    setForm(assistantFormOf(result.data.settings, result.data.items));
    onSaved?.(result.data.updatedAt);
    adminToast.success(COPY.salvo);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-assistant-card="">
      {failure ? <ErrorBanner>{failure}</ErrorBanner> : null}
      {!canWrite ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.somenteLeitura}</p> : null}

      <AdminSwitch checked={form.enabled} disabled={locked} id={`assistant-enabled-${webinarId}`} label={COPY.ligar} onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))} />
      <AdminSwitch
        checked={form.replyAllDefault}
        description={COPY.responderTudoDica}
        disabled={locked}
        id={`assistant-reply-all-${webinarId}`}
        label={COPY.responderTudoPadrao}
        onCheckedChange={(replyAllDefault) => setForm((current) => ({ ...current, replyAllDefault }))}
      />

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm leading-5 font-semibold text-[var(--text-primary)]">{COPY.perguntasERespostas}</h3>
          <span className="text-xs leading-5 text-[var(--text-tertiary)] tabular-nums">{COPY.contador(form.items.length, ASSISTANT_LIMITS.knowledgeMax)}</span>
        </div>
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{COPY.perguntasERespostasDica}</p>
        {form.items.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">{COPY.semPerguntas}</p> : null}
        <ol className="flex min-w-0 flex-col gap-3" data-assistant-knowledge="">
          {form.items.map((item, index) => {
            const questionId = `assistant-q-${item.key}`;
            const answerId = `assistant-a-${item.key}`;
            const error = errors[item.key] ?? {};
            return (
              <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] p-3" data-assistant-item={item.key} key={item.key}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs leading-5 font-medium text-[var(--text-tertiary)]">{COPY.numero(index + 1)}</span>
                  <Button
                    aria-label={`${COPY.remover}: ${COPY.numero(index + 1)}`}
                    className="h-8! px-2 text-[13px] text-[var(--text-secondary)]"
                    disabled={locked}
                    onClick={() => setForm((current) => removeKnowledge(current, item.key))}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    {COPY.remover}
                  </Button>
                </div>
                <AdminField error={error.question} id={questionId} label={COPY.pergunta}>
                  <input
                    aria-describedby={fieldDescribedBy(questionId, { error: error.question })}
                    aria-invalid={error.question ? true : undefined}
                    className={adminInputClass}
                    disabled={locked}
                    id={questionId}
                    maxLength={ASSISTANT_LIMITS.question}
                    onChange={(event) => setForm((current) => updateKnowledge(current, item.key, { question: event.target.value }))}
                    value={item.question}
                  />
                </AdminField>
                <AdminField error={error.answer} id={answerId} label={COPY.resposta}>
                  <textarea
                    aria-describedby={fieldDescribedBy(answerId, { error: error.answer })}
                    aria-invalid={error.answer ? true : undefined}
                    className={cn(adminTextareaClass, "min-h-20")}
                    disabled={locked}
                    id={answerId}
                    maxLength={ASSISTANT_LIMITS.answer}
                    onChange={(event) => setForm((current) => updateKnowledge(current, item.key, { answer: event.target.value }))}
                    rows={3}
                    value={item.answer}
                  />
                </AdminField>
              </li>
            );
          })}
        </ol>
        <div>
          <Button className="px-3" disabled={locked || !canAddKnowledge(form)} onClick={() => setForm((current) => addKnowledge(current))} type="button" variant="secondary">
            <Plus aria-hidden="true" className="size-4" />
            {COPY.adicionar}
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button className="px-4" disabled={locked} onClick={() => void save()} type="button">
          {COPY.salvar}
        </Button>
      </div>
    </div>
  );
}
