"use client";

import { BookmarkPlus, Info } from "lucide-react";
import { useRef, useState, type FormEvent, type JSX, type ReactNode, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CampaignKind, NoticeAction } from "@/server/communications/campaign-model";
import type { NoticeDraft } from "@/server/communications/schemas";
import { saveTemplate, saveTemplateFromNotice, type SavedTemplate } from "@/server/communications/template-actions";
import {
  TEMPLATE_LIMITS,
  TEMPLATE_MESSAGES,
  defaultTemplateName,
  templateErrorsFromAction,
  templateNameSchema,
  templateSaveNotes,
  type TemplateFollowUps,
  type TemplateInclude
} from "@/server/communications/template-model";
import { ErrorBanner } from "../../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../../form";
import { AdminSwitch, type RowMenuAction } from "../../settings/kit";
import { adminToast } from "../../toast";
import {
  TEMPLATE_COPY,
  followUpsSwitchLabel,
  initialSaveAsInclude,
  nameCounter,
  saveAsTemplateContentHint,
  saveAsTemplateDescription,
  saveAsTemplateErrors,
  saveAsTemplateFollowUps,
  saveAsTemplateKind,
  savedTemplateToast
} from "./templates-view-model";

// "Salvar como modelo" (docs/28; spec §5.3): do editor do aviso (o que esta na tela, com as mudancas ainda nao
// salvas, sem gravar o aviso, D11) ou do menu "…" da lista e do relatorio (a versao gravada). O nome vem do titulo
// (ou "Modelo de notificação" / "Modelo de pop-up"), com o contador "{n}/80", e as chaves "Levar o conteúdo",
// "Levar o segmento" e, so na notificacao com seguintes, "Levar as notificações seguintes (n)" (desligada e
// desabilitada quando as seguintes so abrem no construtor). Do editor, as notas do que nao vai para o modelo
// aparecem antes de salvar; do menu, no toast. O sucesso so fecha e avisa: nada na tela de onde abriu e atualizado
// (D28). Erro do nome fica no campo; os outros, num banner dentro do dialogo.

export type SaveAsTemplateSource =
  | {
      draft: NoticeDraft;
      followUps: TemplateFollowUps | null;
      followUpsBuilderOnly: boolean;
      /** A linha "Parar" do cartao com kind "other" (objetivo mudado no construtor): templateSaveNotes da noteOtherGoal. */
      followUpsOtherGoal: boolean;
      kind: "editor";
      sourceNoticeId: string | null;
      sourceTemplateIds: readonly string[];
    }
  | { followUpCount: number; kind: "notice"; noticeId: string; noticeKind: CampaignKind; title: string };

export type SaveAsTemplateDialogProps = {
  /**
   * Para onde o foco vai ao fechar (o `finalFocus` do Base UI). Sem ele, volta ao botao que abriu; o menu "…" da lista
   * e do relatorio passa o proprio "…" (o menu ja fechou quando o dialogo abre).
   */
  finalFocus?: () => HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (saved: SavedTemplate) => void;
  open: boolean;
  source: SaveAsTemplateSource;
};

type Banner = { message: string; title: string };

/** O campo do nome (o mesmo id do card Modelo do modo modelo; os dois nunca estao na mesma tela). */
const NAME_ID = "modelo-nome";

function suggestedName(source: SaveAsTemplateSource) {
  return defaultTemplateName({ kind: saveAsTemplateKind(source), title: source.kind === "editor" ? source.draft.title : source.title });
}

export function SaveAsTemplateDialog({ finalFocus, onOpenChange, onSaved, open, source }: SaveAsTemplateDialogProps): JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(() => suggestedName(source));
  const [include, setInclude] = useState<TemplateInclude>(() => initialSaveAsInclude(source));
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Cada abertura comeca do zero: nome sugerido, chaves ligadas, sem erro (ajuste no proprio desenho, sem efeito).
  if (open !== wasOpen) {
    setWasOpen(open);

    if (open) {
      setName(suggestedName(source));
      setInclude(initialSaveAsInclude(source));
      setNameError(null);
      setBanner(null);
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) {
      return;
    }

    const checked = templateNameSchema.safeParse(name);

    if (!checked.success) {
      setNameError(checked.error.issues[0]?.message ?? TEMPLATE_COPY.nameDialog.label);
      field.current?.focus();
      return;
    }

    setBusy(true);
    setNameError(null);
    setBanner(null);

    try {
      const result =
        source.kind === "editor"
          ? await saveTemplate({
              body: { draft: source.draft, followUps: include.followUps ? source.followUps : null, include, source: "notice" },
              name: checked.data,
              origin: "notice_editor",
              sourceNoticeId: source.sourceNoticeId,
              sourceTemplateIds: [...source.sourceTemplateIds]
            })
          : await saveTemplateFromNotice({ include, name: checked.data, noticeId: source.noticeId });

      if (result.ok) {
        adminToast.success(savedTemplateToast(result.data.notes));
        onOpenChange(false);
        onSaved?.(result.data);
        return;
      }

      const errors = saveAsTemplateErrors(templateErrorsFromAction(result.fieldErrors));

      if (errors.name) {
        setNameError(errors.name);
        field.current?.focus();
      }

      if (errors.banner) {
        setBanner({ message: errors.banner, title: TEMPLATE_COPY.errors.saveTitle });
      } else if (!errors.name) {
        setBanner({ message: result.error, title: TEMPLATE_COPY.errors.saveTitle });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={(next) => (!next && !busy ? onOpenChange(false) : undefined)} open={open}>
      <DialogContent
        className="max-w-md rounded-xl border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]"
        data-save-as-template=""
        finalFocus={finalFocus ? () => finalFocus() ?? true : undefined}
        initialFocus={() => {
          // Foco no nome com o texto selecionado (digitar troca o nome inteiro).
          field.current?.select();

          return field.current;
        }}
        showCloseButton={false}
      >
        <form className="flex min-h-0 flex-col" noValidate onSubmit={(event) => void submit(event)}>
          <DialogHeader className="gap-1 px-5 pt-5 pb-2">
            <DialogTitle className="text-base leading-6 font-semibold text-[var(--text-primary)]">{TEMPLATE_COPY.saveAs.title}</DialogTitle>
            <DialogDescription className="text-sm leading-5 text-[var(--text-secondary)]">{saveAsTemplateDescription(saveAsTemplateKind(source))}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-3">
            <SaveAsTemplateFields
              include={include}
              name={name}
              nameError={nameError}
              nameRef={field}
              onIncludeChange={setInclude}
              onNameChange={(value) => {
                setName(value);
                setNameError(null);
              }}
              source={source}
            />
            {banner ? <ErrorBanner title={banner.title}>{banner.message}</ErrorBanner> : null}
          </div>
          <DialogFooter className="px-5 pt-3 pb-5">
            <Button className="px-4 text-[var(--text-secondary)]" disabled={busy} onClick={() => onOpenChange(false)} type="button" variant="ghost">
              {TEMPLATE_COPY.saveAs.cancel}
            </Button>
            <Button className="px-4" disabled={busy} type="submit">
              {busy ? TEMPLATE_COPY.saveAs.saving : TEMPLATE_COPY.saveAs.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SaveAsTemplateFieldsProps = {
  include: TemplateInclude;
  name: string;
  nameError: string | null;
  nameRef?: Ref<HTMLInputElement>;
  onIncludeChange: (include: TemplateInclude) => void;
  onNameChange: (name: string) => void;
  source: SaveAsTemplateSource;
};

/** O corpo do dialogo: o nome, as chaves e (do editor) as notas do que nao vai para o modelo. */
export function SaveAsTemplateFields({ include, name, nameError, nameRef, onIncludeChange, onNameChange, source }: SaveAsTemplateFieldsProps) {
  const followUps = saveAsTemplateFollowUps(source);
  const counter = nameCounter(name);
  const notes = source.kind === "editor" ? templateSaveNotes(source.draft, include, source.followUps, { otherGoal: source.followUpsOtherGoal }) : [];

  return (
    <>
      <AdminField error={nameError} hint={counter} id={NAME_ID} label={TEMPLATE_COPY.nameDialog.label}>
        <input
          aria-describedby={fieldDescribedBy(NAME_ID, { error: nameError, hint: nameError ? null : counter })}
          aria-invalid={nameError ? true : undefined}
          autoComplete="off"
          className={adminInputClass}
          id={NAME_ID}
          maxLength={TEMPLATE_LIMITS.name}
          onChange={(event) => onNameChange(event.target.value)}
          ref={nameRef}
          required
          value={name}
        />
      </AdminField>
      <div className="flex min-w-0 flex-col gap-2" data-save-as-switches="">
        <AdminSwitch
          checked={include.content}
          description={saveAsTemplateContentHint(source)}
          label={TEMPLATE_COPY.saveAs.content}
          onCheckedChange={(checked) => onIncludeChange({ ...include, content: checked })}
        />
        <AdminSwitch
          checked={include.audience}
          description={TEMPLATE_COPY.saveAs.audienceHint}
          label={TEMPLATE_COPY.saveAs.audience}
          onCheckedChange={(checked) => onIncludeChange({ ...include, audience: checked })}
        />
        {followUps ? (
          <AdminSwitch
            checked={followUps.disabled ? false : include.followUps}
            description={followUps.disabled ? TEMPLATE_MESSAGES.noteBuilderOnly : TEMPLATE_COPY.saveAs.followUpsHint}
            disabled={followUps.disabled}
            label={followUpsSwitchLabel(followUps.count)}
            onCheckedChange={(checked) => onIncludeChange({ ...include, followUps: checked })}
          />
        ) : null}
      </div>
      {notes.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-save-as-notes="">
          {notes.map((note) => (
            <li className="flex items-start gap-2 text-[13px] leading-5 text-[var(--text-secondary)]" key={note}>
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** O "…" de um aviso na lista ou no relatorio (o dialogo devolve o foco a ele). */
function noticeMenuTrigger(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-notice-menu="${CSS.escape(id)}"] button`);
}

type NoticeSaveAsTarget = { actions: readonly NoticeAction[]; followUpCount: number; id: string; kind: CampaignKind; title: string };

/**
 * "Salvar como modelo" no menu "…" da lista e do relatorio (spec §6.2): a entrada extra (so quando o aviso pode ser
 * duplicado: passo de fluxo nunca vira modelo) e o dialogo com a versao gravada do aviso (`kind: "notice"`). Quem
 * chama poe o "…" dentro de um elemento com `data-notice-menu={id}` para o foco voltar a ele.
 */
export function useNoticeSaveAsTemplate(): { dialog: ReactNode; extraFor: (notice: NoticeSaveAsTarget) => RowMenuAction[] } {
  const [state, setState] = useState<{ open: boolean; source: Extract<SaveAsTemplateSource, { kind: "notice" }> } | null>(null);

  function extraFor(notice: NoticeSaveAsTarget): RowMenuAction[] {
    if (!notice.actions.includes("duplicate")) {
      return [];
    }

    return [
      {
        icon: <BookmarkPlus aria-hidden="true" className="size-4" />,
        label: TEMPLATE_COPY.saveAs.trigger,
        onSelect: () =>
          setState({
            open: true,
            source: { followUpCount: notice.followUpCount, kind: "notice", noticeId: notice.id, noticeKind: notice.kind, title: notice.title }
          })
      }
    ];
  }

  const dialog = state ? (
    <SaveAsTemplateDialog
      finalFocus={() => noticeMenuTrigger(state.source.noticeId)}
      onOpenChange={(open) => setState((current) => (current ? { ...current, open } : current))}
      open={state.open}
      source={state.source}
    />
  ) : null;

  return { dialog, extraFor };
}
