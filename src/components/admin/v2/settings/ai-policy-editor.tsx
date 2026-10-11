"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { SaveBar } from "../save-bar";
import { adminToast } from "../toast";
import { AiProviderPicker } from "./ai-provider-picker";
import {
  AI_PROVIDER_PARAM,
  aiPolicyFormToPayload,
  buildAiProviderEntries,
  getAiProviderMeta,
  isAiPolicyFormDirty,
  makeAiPolicyForm,
  validateAiModel,
  validateAiPolicyForm,
  validateAiPolicyNumber,
  type AiConnectionSummary,
  type AiPolicyConfig,
  type AiPolicyErrors,
  type AiPolicyForm,
  type AiPolicyNumberField,
  type AiProviderId
} from "./ai-settings-model";
import { AdminSwitch, ConfirmDialog, SectionCard } from "./kit";

const BASE_PATH = "/admin/configuracoes/ia";

type AiPolicyEditorProps = {
  canEdit: boolean;
  configs: AiPolicyConfig[];
  connections: Pick<AiConnectionSummary, "authMode" | "provider" | "status">[];
  provider: AiProviderId;
};

type NumberFieldSpec = {
  field: AiPolicyNumberField;
  hint: string;
  inputMode: "decimal" | "numeric";
  label: string;
};

const limitFields: NumberFieldSpec[] = [
  {
    field: "dailyQuestionLimit",
    hint: "Quantas perguntas cada aluno pode fazer ao Tutor por dia.",
    inputMode: "numeric",
    label: "Perguntas por aluno em 24 h"
  },
  {
    field: "monthlyQuestionLimit",
    hint: "Teto do mês para este provedor, somando todos os alunos.",
    inputMode: "numeric",
    label: "Perguntas por mês neste provedor"
  }
];

const answerFields: NumberFieldSpec[] = [
  {
    field: "maxOutputTokens",
    hint: "Em tokens (cerca de 4 caracteres cada). Respostas maiores custam mais.",
    inputMode: "numeric",
    label: "Tamanho máximo da resposta"
  },
  {
    field: "contextMaxCharacters",
    hint: "Quanto da transcrição da aula o Tutor lê para responder, em caracteres.",
    inputMode: "numeric",
    label: "Tamanho máximo do contexto"
  },
  {
    field: "temperature",
    hint: "De 0 a 1. Mais baixo deixa as respostas mais previsíveis.",
    inputMode: "decimal",
    label: "Temperatura"
  }
];

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error || fallback);
  }

  return payload.data;
}

/** Modelo e limites de um provedor (PUT /api/admin/ai-providers, a mesma rota do admin antigo). */
export function AiPolicyEditor({ canEdit, configs: initialConfigs, connections, provider }: AiPolicyEditorProps) {
  const router = useRouter();
  const meta = getAiProviderMeta(provider);
  const [configs, setConfigs] = useState(initialConfigs);
  const current = configs.find((config) => config.provider === provider) ?? null;
  const [baseline, setBaseline] = useState<AiPolicyForm>(() => makeAiPolicyForm(provider, current));
  const [form, setForm] = useState<AiPolicyForm>(baseline);
  const [errors, setErrors] = useState<AiPolicyErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<AiProviderId | null>(null);
  const [detectedModels, setDetectedModels] = useState<string[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = canEdit && isAiPolicyFormDirty(form, baseline);
  const providerConnections = connections.filter((connection) => connection.provider === provider);
  const entries = useMemo(() => buildAiProviderEntries("policy", configs, connections), [configs, connections]);

  useEffect(() => {
    if (!dirty) {
      return;
    }

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Modelos que as contas conectadas oferecem: so sugestoes, nunca troca o campo sozinho.
  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/admin/ai-connections/models?provider=${provider}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { data?: unknown };
        const models = response.ok && Array.isArray(payload.data) ? payload.data.filter((item): item is string => typeof item === "string") : [];
        setDetectedModels(models);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetectedModels([]);
        }
      });

    return () => controller.abort();
  }, [provider]);

  function update<Key extends keyof AiPolicyForm>(field: Key, value: AiPolicyForm[Key]) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
    setSaveError(null);

    if (errors[field]) {
      setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
    }
  }

  function validateField(field: keyof AiPolicyForm) {
    let error: string | null = null;

    if (field === "defaultModel") {
      error = validateAiModel(form.defaultModel);
    } else if (field !== "enabled" && field !== "isDefault") {
      error = validateAiPolicyNumber(field, form[field]);
    }

    setErrors((currentErrors) => ({ ...currentErrors, [field]: error ?? undefined }));
  }

  function discard() {
    setForm(baseline);
    setErrors({});
    setSaveError(null);
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();

    if (!canEdit || saving) {
      return;
    }

    const nextErrors = validateAiPolicyForm(form);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSaveError("Revise os campos destacados.");
      const first = Object.keys(nextErrors)[0];
      formRef.current?.querySelector<HTMLElement>(`#ia-${first}`)?.focus();
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/admin/ai-providers", {
        body: JSON.stringify(aiPolicyFormToPayload(provider, form)),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const data = await readJson<AiPolicyConfig[]>(response, "Não foi possível salvar a política deste provedor.");
      const saved = data.find((config) => config.provider === provider) ?? null;
      const nextForm = makeAiPolicyForm(provider, saved);

      setConfigs(data);
      setBaseline(nextForm);
      setForm(nextForm);
      setErrors({});
      adminToast.success(`Política do ${meta.shortLabel} salva`);
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível salvar a política deste provedor.");
    } finally {
      setSaving(false);
    }
  }

  function guardProviderChange(next: AiProviderId, event: MouseEvent<HTMLAnchorElement>) {
    if (next === provider || !dirty) {
      return;
    }

    event.preventDefault();
    setPendingProvider(next);
  }

  function renderNumberField(spec: NumberFieldSpec) {
    const id = `ia-${spec.field}`;
    const error = errors[spec.field];

    return (
      <AdminField error={error} hint={spec.hint} id={id} key={spec.field} label={spec.label}>
        <Input
          aria-describedby={fieldDescribedBy(id, { error, hint: spec.hint })}
          aria-invalid={error ? true : undefined}
          className={cn(adminInputClass, "max-w-56 tabular-nums")}
          disabled={!canEdit}
          id={id}
          inputMode={spec.inputMode}
          onBlur={() => validateField(spec.field)}
          onChange={(event) => update(spec.field, event.target.value)}
          value={form[spec.field]}
        />
      </AdminField>
    );
  }

  const modelError = errors.defaultModel;
  const modelHint = current ? "Nome exato do modelo na API do provedor." : "Escolha o modelo e salve para ligar este provedor no Tutor.";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AiProviderPicker basePath={BASE_PATH} entries={entries} onNavigate={guardProviderChange} selected={provider} />

      {!canEdit ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
          Só o dono ou um administrador pode mudar o Tutor IA. Você está vendo a configuração atual.
        </p>
      ) : null}

      {providerConnections.length === 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm leading-5 text-[var(--text-primary)]">
          <span>O {meta.shortLabel} ainda não tem chave nem conta conectada; sem isso o Tutor não consegue usá-lo.</span>
          <Link
            className="font-medium underline underline-offset-4 hover:text-[var(--text-secondary)]"
            data-navigation-feedback="false"
            href={`${BASE_PATH}/conexoes?${AI_PROVIDER_PARAM}=${provider}`}
          >
            Conectar {meta.shortLabel}
          </Link>
        </p>
      ) : null}

      <SectionCard
        className="max-w-[720px]"
        description="Vale para todas as chaves e contas deste provedor."
        title={`Política do ${meta.label}`}
      >
        <form className="flex max-w-[640px] flex-col" noValidate onSubmit={(event) => void save(event)} ref={formRef}>
          <fieldset className="flex flex-col gap-4 pb-6">
            <legend className="sr-only">Modelo</legend>
            <AdminField error={modelError} hint={modelHint} id="ia-defaultModel" label="Modelo">
              <Input
                aria-describedby={fieldDescribedBy("ia-defaultModel", { error: modelError, hint: modelHint })}
                aria-invalid={modelError ? true : undefined}
                autoComplete="off"
                className={cn(adminInputClass, "font-mono text-[13px]")}
                disabled={!canEdit}
                id="ia-defaultModel"
                list={`ia-models-${provider}`}
                onBlur={() => validateField("defaultModel")}
                onChange={(event) => update("defaultModel", event.target.value)}
                spellCheck={false}
                value={form.defaultModel}
              />
            </AdminField>
            <datalist id={`ia-models-${provider}`}>
              {(detectedModels ?? []).map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            {detectedModels && detectedModels.length > 0 && canEdit ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs leading-5 text-[var(--text-secondary)]">Modelos das contas conectadas</p>
                <div className="flex flex-wrap gap-2">
                  {detectedModels.slice(0, 12).map((model) => (
                    <button
                      className={cn(
                        "inline-flex h-8 max-w-full items-center rounded-md border px-2.5 font-mono text-xs",
                        model === form.defaultModel.trim()
                          ? "border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]"
                          : "border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      )}
                      key={model}
                      onClick={() => update("defaultModel", model)}
                      type="button"
                    >
                      <span className="truncate">{model}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-4 border-t border-[var(--border-subtle)] py-6">
            <legend className="float-left mb-1 w-full text-sm leading-5 font-semibold text-[var(--text-primary)]">Limites</legend>
            <div className="clear-both flex flex-col gap-4">{limitFields.map(renderNumberField)}</div>
          </fieldset>

          <fieldset className="flex flex-col gap-4 border-t border-[var(--border-subtle)] py-6">
            <legend className="float-left mb-1 w-full text-sm leading-5 font-semibold text-[var(--text-primary)]">Respostas</legend>
            <div className="clear-both flex flex-col gap-4">{answerFields.map(renderNumberField)}</div>
          </fieldset>

          <fieldset className="flex flex-col gap-4 border-t border-[var(--border-subtle)] pt-6">
            <legend className="float-left mb-1 w-full text-sm leading-5 font-semibold text-[var(--text-primary)]">Ordem de uso</legend>
            <div className="clear-both flex flex-col gap-4">
              <AdminSwitch
                checked={form.enabled}
                description="Desligado, o Tutor e o Diretor não usam este provedor."
                disabled={!canEdit}
                id="ia-enabled"
                label="Provedor ligado"
                onCheckedChange={(checked) => update("enabled", checked)}
              />
              <AdminSwitch
                checked={form.isDefault}
                description="Os outros provedores ligados só entram se este falhar."
                disabled={!canEdit}
                id="ia-isDefault"
                label="Tentar este provedor primeiro"
                onCheckedChange={(checked) => update("isDefault", checked)}
              />
              {renderNumberField({
                field: "priority",
                hint: "Quando o primeiro falha, os provedores com número maior são tentados antes.",
                inputMode: "numeric",
                label: "Prioridade"
              })}
            </div>
          </fieldset>
        </form>
      </SectionCard>

      <SaveBar
        error={saveError}
        onDiscard={discard}
        onSave={() => void save()}
        open={dirty}
        saveLabel="Salvar política"
        saving={saving}
      />

      <ConfirmDialog
        confirmLabel="Descartar e trocar"
        description={`As mudanças na política do ${meta.shortLabel} ainda não foram salvas.`}
        onConfirm={() => {
          const next = pendingProvider;
          setPendingProvider(null);

          if (next) {
            discard();
            router.replace(`${BASE_PATH}?${AI_PROVIDER_PARAM}=${next}`, { scroll: false });
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPendingProvider(null);
          }
        }}
        open={pendingProvider !== null}
        title="Descartar as alterações?"
      />
    </div>
  );
}
