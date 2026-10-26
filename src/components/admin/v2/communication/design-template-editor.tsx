"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { freeErrorKeys } from "@/server/communications/popup-free-schema";
import type { NoticeEditorOptions } from "@/server/communications/queries";
import type { NoticeDraft } from "@/server/communications/schemas";
import { saveTemplate } from "@/server/communications/template-actions";
import {
  TEMPLATE_LIMITS,
  TEMPLATE_MESSAGES,
  TEMPLATES_HREF,
  hasReadNotes,
  templateDesignSupportOf,
  templateDraftInputSchema,
  templateErrorsFromAction,
  templateNameSchema,
  type TemplateDesignMode
} from "@/server/communications/template-model";
import type { TemplateEditorInput } from "@/server/communications/template-queries";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { AdminLinkButton } from "../link-button";
import type { PreviewDevice } from "../member-area/preview-frame";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { useWarnBeforeUnload } from "../products/use-warn-before-unload";
import { ConfirmDialog, SectionCard } from "../settings/kit";
import type { ProductPickerItem } from "../storefront/product-picker";
import { adminCard } from "../styles";
import { adminToast } from "../toast";
import { useAdminTopbarTitle } from "../topbar-title";
import { NoticePreview, PreviewDeviceChoice } from "./notice-preview";
import { canonicalNoticeDraft, isSameNoticeDraft, noticeErrorsFrom, rebaseNoticeDraft, type NoticeFieldErrors } from "./notices-view-model";
import { PopupDesignField } from "./popup-design/popup-design-field";
import { withSyncedDesign } from "./popup-design/popup-design-editor-model";
import { freeTemplateRecoveryKey } from "./popup-free/free-editor-recovery";
import { isEditorSaveShortcut } from "./save-shortcut";
import {
  TEMPLATE_EDITOR_COPY,
  noticeFromTemplateHref,
  templateEditHref,
  templateEditorTitle,
  templateNameCounter,
  templateSaveFailureTitle
} from "./template-editor-model";

// Pagina do modelo de Design (docs/28 §5.7): /modelos/[id] e /modelos/novo?tipo=design-personalizado|design-livre. Na
// esquerda, o card Modelo (so o nome) e o card Design com o modo fixo (sem a escolha Padrão/Personalizado/Livre, sem
// "Meus modelos" e sem o destino do botao principal, que e escolhido em cada aviso); na direita, a mesma previa do
// editor do aviso (com design, o celular e o computador juntos; sem design ainda, a escolha Computador | Celular);
// embaixo, "Salvar modelo" (Ctrl+Enter). O modelo e lido so na montagem (D28): o "Recarregar" de um 409 rebaseia como
// no editor do aviso. Uma parte que nao abriu (D29) pede confirmacao no primeiro salvar (o editor Livre pergunta
// dentro dele). O primeiro salvar de um modelo novo troca para o endereco dele (com o editor Livre aberto, no
// Concluir sem mudanca depois do ultimo salvar).

type DesignTemplateEditorProps = {
  /** Hora da leitura (servidor): base do "agora" na previa. */
  now: number;
  options: NoticeEditorOptions;
  /** kind "design" com o modo do design. */
  template: TemplateEditorInput;
};

type Failure = { message: string; status: number; title: string };
type FreeSaveResult = { message?: string; ok: true } | { errors: Record<string, string>; message: string; ok: false };

/** So as chaves do card Design (e o texto do botao principal) contam aqui: o rascunho e um apoio da previa. */
function designErrorsOf(errors: NoticeFieldErrors): NoticeFieldErrors {
  return Object.fromEntries(
    Object.entries(errors)
      .map(([key, message]) => [key === "support.ctaLabel" ? "cta.label" : key, message] as const)
      .filter(([key]) => key === "design" || key.startsWith("design.") || key === "freeDesign" || key.startsWith("freeDesign.") || key.startsWith("cta.") || key === "name")
  );
}

/** Os produtos dos destinos (segundo botao, links do Livre), como no editor do aviso. */
function toPickerItems(products: NoticeEditorOptions["products"]): ProductPickerItem[] {
  return products.map((product) => ({
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: PRODUCT_FORMAT_LABELS[product.format],
    flags: product.situation === "published" ? [] : [{ label: PRODUCT_SITUATION_LABELS[product.situation], tone: "muted" as const }],
    id: product.id,
    title: product.title
  }));
}

export function DesignTemplateEditor({ now, options, template }: DesignTemplateEditorProps) {
  const router = useRouter();
  const copy = TEMPLATE_EDITOR_COPY;
  // D28: o modelo entra so aqui, na montagem.
  const [mode] = useState<TemplateDesignMode>(() => template.designMode ?? "custom");
  const [draft, setDraft] = useState<NoticeDraft>(() => template.start.draft);
  const [saved, setSaved] = useState<NoticeDraft>(() => template.start.draft);
  const [name, setName] = useState(() => template.name);
  const [savedName, setSavedName] = useState(() => template.name);
  const [version, setVersion] = useState<{ id: string; updatedAt: string } | null>(() =>
    template.id && template.updatedAt ? { id: template.id, updatedAt: template.updatedAt } : null
  );
  const [serverVersion, setServerVersion] = useState<string | null>(template.updatedAt);
  const [notes, setNotes] = useState<string[]>(() => template.notes);
  const [readPending, setReadPending] = useState(() => hasReadNotes(template.notes));
  const [confirmRead, setConfirmRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [serverErrors, setServerErrors] = useState<NoticeFieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [designBusy, setDesignBusy] = useState<string | null>(null);
  const [imageUpload, setImageUpload] = useState<string | null>(null);
  const [popupFonts, setPopupFonts] = useState(() => options.popupFonts);
  const [resetKey, setResetKey] = useState(0);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const freeEditorOpen = useRef(false);
  const pendingId = useRef<string | null>(null);
  const saveShortcut = useRef<() => void>(() => undefined);
  const bannerRef = useRef<HTMLDivElement>(null);

  // O modelo mudou no servidor ("Recarregar" depois de um 409): o que o produtor nao mexeu passa a ser o da versao nova.
  if (template.updatedAt !== serverVersion) {
    setServerVersion(template.updatedAt);

    if (template.id && template.updatedAt && (!version || Date.parse(template.updatedAt) !== Date.parse(version.updatedAt))) {
      setDraft(rebaseNoticeDraft(saved, draft, template.start.draft));
      setSaved(template.start.draft);
      setName(name === savedName ? template.name : name);
      setSavedName(template.name);
      setVersion({ id: template.id, updatedAt: template.updatedAt });
      setNotes(template.notes);
      setReadPending(hasReadNotes(template.notes));
      setFailure(null);
      setServerErrors({});
      setResetKey((key) => key + 1);
    }
  }

  const dirty = !isSameNoticeDraft(saved, draft) || name !== savedName;
  const pickerItems = useMemo(() => toPickerItems(options.products), [options.products]);
  const clientErrors = useMemo(() => {
    const parsed = templateDraftInputSchema.safeParse(draft);
    const errors = designErrorsOf(parsed.success ? {} : freeErrorKeys(draft.freeDesign ?? null, noticeErrorsFrom(parsed.error.issues)));
    const checkedName = templateNameSchema.safeParse(name);

    if (!checkedName.success) {
      errors.name = checkedName.error.issues[0]?.message ?? copy.card.nameLabel;
    }

    if (!draft.design && !draft.freeDesign) {
      errors.design = TEMPLATE_MESSAGES.pickDesign;
    }

    return errors;
  }, [copy.card.nameLabel, draft, name]);
  const freeProblems = useMemo(
    () =>
      draft.freeDesign
        ? Object.fromEntries(Object.entries({ ...clientErrors, ...serverErrors }).filter(([key]) => key === "freeDesign" || key.startsWith("freeDesign.")))
        : {},
    [clientErrors, draft.freeDesign, serverErrors]
  );
  const title = templateEditorTitle({ id: version?.id ?? null, kind: "design", mode, savedName });

  useWarnBeforeUnload(dirty || designBusy !== null || imageUpload !== null);
  useAdminTopbarTitle(title);

  useEffect(() => {
    saveShortcut.current = () => void save();
  });

  // Ctrl+Enter salva o modelo (com o editor Livre aberto, o salvar e o dele). Nunca com o foco num dialogo, num
  // painel, na lista de uma escolha ou num menu ("Enviar fonte", as confirmacoes; save-shortcut.ts, docs/28 D32).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (freeEditorOpen.current) {
        return;
      }

      if (isEditorSaveShortcut(event)) {
        event.preventDefault();
        saveShortcut.current();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function errorFor(key: string) {
    return serverErrors[key] ?? (submitted ? clientErrors[key] : undefined);
  }

  function change(patch: Partial<NoticeDraft>) {
    setDraft((current) => withSyncedDesign(current, patch));
    setServerErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !Object.keys(patch).some((field) => key === field || key.startsWith(`${field}.`)))));

    if (failure && failure.status !== 409) {
      setFailure(null);
    }
  }

  function showFailure(next: Omit<Failure, "title"> & { title?: string }) {
    setFailure({ ...next, title: next.title ?? templateSaveFailureTitle(next.status) });
    window.requestAnimationFrame(() => bannerRef.current?.scrollIntoView({ block: "nearest" }));
  }

  function openSaved(id: string) {
    if (template.id) {
      return;
    }

    if (freeEditorOpen.current) {
      pendingId.current = id;
      return;
    }

    router.replace(templateEditHref(id), { scroll: false });
  }

  async function save(opts: { confirmed?: boolean; fromFreeEditor?: boolean } = {}): Promise<FreeSaveResult> {
    const quiet = opts.fromFreeEditor === true;

    if (busy) {
      return { errors: {}, message: "Espere o salvar terminar.", ok: false };
    }

    if (readPending && !opts.confirmed && !quiet) {
      setConfirmRead(true);
      return { errors: {}, message: "", ok: false };
    }

    if (designBusy || imageUpload) {
      const message = designBusy ?? "Espere a imagem terminar de enviar e tente de novo.";
      showFailure({ message, status: 0 });
      return { errors: {}, message, ok: false };
    }

    setSubmitted(true);

    if (Object.keys(clientErrors).length > 0) {
      const message = "Revise os campos destacados.";
      setServerErrors({});
      showFailure({ message, status: 400 });
      return { errors: clientErrors, message, ok: false };
    }

    setFailure(null);
    setServerErrors({});
    setBusy(true);
    const sent = draft;
    const result = await saveTemplate({
      body: { design: sent.design ?? null, freeDesign: sent.freeDesign ?? null, source: "design", support: templateDesignSupportOf(sent) },
      ...(version ? { expectedUpdatedAt: version.updatedAt, id: version.id } : {}),
      name,
      origin: "template_editor",
      sourceTemplateIds: []
    }).catch(() => null);
    setBusy(false);

    if (!result) {
      const message = "Não foi possível salvar agora. Tente de novo.";
      showFailure({ message, status: 500 });
      return { errors: {}, message, ok: false };
    }

    if (!result.ok) {
      const fieldErrors = designErrorsOf(freeErrorKeys(sent.freeDesign ?? null, templateErrorsFromAction(result.fieldErrors)));
      setServerErrors(fieldErrors);
      showFailure({ message: result.status === 409 ? TEMPLATE_MESSAGES.changed : result.error, status: result.status });
      return { errors: fieldErrors, message: result.error, ok: false };
    }

    setVersion({ id: result.data.id, updatedAt: result.data.updatedAt });
    setSaved(canonicalNoticeDraft(sent));
    setName(result.data.name);
    setSavedName(result.data.name);
    setReadPending(false);
    setNotes([]);
    setSubmitted(false);

    if (!quiet) {
      adminToast.success([copy.saved, ...result.data.notes].join(" "));
    }

    openSaved(result.data.id);
    return { message: copy.saved, ok: true };
  }

  function changeFreeEditorOpen(open: boolean, result?: { dirtySinceSave: boolean }) {
    freeEditorOpen.current = open;

    if (open) {
      return;
    }

    const id = pendingId.current;
    pendingId.current = null;

    if (id && result && !result.dirtySinceSave) {
      openSaved(id);
    }
  }

  const conflict = failure?.status === 409;
  const nameError = errorFor("name");
  const counter = templateNameCounter(name);
  const savedId = version?.id ?? null;

  return (
    <AdminPage className="gap-6 pb-28">
      <PageHeader
        actions={
          savedId ? (
            dirty ? (
              <Button disabled title={copy.header.useDirty} type="button" variant="secondary">
                {copy.design.use}
              </Button>
            ) : (
              <AdminLinkButton href={noticeFromTemplateHref(savedId)} variant="secondary">
                {copy.design.use}
              </AdminLinkButton>
            )
          ) : null
        }
        breadcrumb={[{ href: TEMPLATES_HREF, label: copy.breadcrumb.list }, { label: savedId ? copy.breadcrumb.edit : copy.breadcrumb.new }]}
        description={`${copy.design.descriptions[mode]}${version ? copy.header.updatedAt(formatSaoPauloDateTime(version.updatedAt)) : ""}`}
        title={title}
      />

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <SectionCard title={copy.card.title}>
            <AdminField error={nameError} hint={counter} id="modelo-nome" label={copy.card.nameLabel}>
              <input
                aria-describedby={fieldDescribedBy("modelo-nome", { error: nameError, hint: nameError ? null : counter })}
                aria-invalid={nameError ? true : undefined}
                autoComplete="off"
                className={adminInputClass}
                disabled={busy}
                id="modelo-nome"
                maxLength={TEMPLATE_LIMITS.name}
                onChange={(event) => {
                  setName(event.target.value);
                  setServerErrors((current) => {
                    const next = { ...current };
                    delete next.name;
                    return next;
                  });
                }}
                required
                value={name}
              />
            </AdminField>
          </SectionCard>

          {notes.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]" role="note">
              {notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}

          {failure ? (
            <div ref={bannerRef}>
              <ErrorBanner
                action={
                  conflict ? (
                    <Button
                      className="px-3"
                      onClick={() => {
                        setFailure(null);
                        router.refresh();
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Recarregar
                    </Button>
                  ) : (
                    <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
                      Fechar
                    </Button>
                  )
                }
                title={failure.title}
              >
                {failure.message}
              </ErrorBanner>
            </div>
          ) : null}

          <PopupDesignField
            disabled={busy}
            draft={draft}
            errorFor={errorFor}
            fonts={popupFonts}
            freeEditor={{
              // O modelo de Design nao guarda o "Lembrar depois" (docs/28 §1.7): a chave de Links › Conteúdo vira a nota.
              allowSnoozeEditable: false,
              recoveryKey: freeTemplateRecoveryKey(template.id),
              saveConfirm: readPending
                ? { cancelLabel: copy.confirmRead.cancel, confirmLabel: copy.confirmRead.confirm, description: copy.confirmRead.description, title: copy.confirmRead.title }
                : null,
              saveLabel: copy.review.save,
              showTemplatesTab: false,
              subtitle: copy.title(name.trim() || savedName)
            }}
            freeProblems={freeProblems}
            freeServerErrors={draft.freeDesign ? serverErrors : {}}
            key={`design-${resetKey}`}
            noticeId={null}
            onBusyChange={setDesignBusy}
            onChange={(patch) => change(patch)}
            onFontsChange={setPopupFonts}
            onFreeEditorOpenChange={changeFreeEditorOpen}
            onImageUploadChange={setImageUpload}
            onSaveDraft={() => save({ confirmed: true, fromFreeEditor: true })}
            products={pickerItems}
            productsLoaded={options.productsLoaded}
            templateMode={{ mode }}
          />

          <SectionCard title={copy.review.title}>
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button className="px-4" disabled={busy} onClick={() => void save()} type="button">
                  {busy ? copy.review.saving : copy.review.save}
                </Button>
              </div>
              <p className="text-xs leading-5 text-[var(--text-tertiary)]">{copy.review.hint}</p>
            </div>
          </SectionCard>
        </div>

        <section
          aria-labelledby="modelo-previa-titulo"
          className={cn(adminCard, "flex min-w-0 flex-col gap-3 p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain")}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="modelo-previa-titulo">
                Prévia
              </h2>
              <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-secondary)]">
                {copy.preview}
              </p>
            </div>
            {/* Com design, celular e computador juntos (sem a escolha), como no editor do aviso. */}
            <PreviewDeviceChoice draft={draft} name="modelo-previa-aparelho" onChange={setDevice} value={device} />
          </div>
          <NoticePreview branding={options.branding} device={device} draft={draft} fonts={popupFonts} imageUrl={imageUpload ?? draft.image?.url ?? null} now={now} senders={options.senders} />
        </section>
      </div>

      <ConfirmDialog
        cancelLabel={copy.confirmRead.cancel}
        confirmLabel={copy.confirmRead.confirm}
        description={copy.confirmRead.description}
        onConfirm={() => {
          setConfirmRead(false);
          void save({ confirmed: true });
        }}
        onOpenChange={setConfirmRead}
        open={confirmRead}
        title={copy.confirmRead.title}
      />
    </AdminPage>
  );
}
