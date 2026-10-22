"use client";

import { AlertCircle, Info } from "lucide-react";
import { useState } from "react";
import type { CampaignStatus } from "@/server/communications/campaign-model";
import type { PopupSettings, PopupTrigger } from "@/server/communications/popup-display-model";
import { describePopupPlacement, opensOnLessonNote, type PopupNames } from "@/server/communications/popup-sentences";
import type { NoticeDraft } from "@/server/communications/schemas";
import { PillGroup } from "../form";
import { AdminSwitch } from "../settings/kit";
import { ProductPicker, type ProductPickerItem } from "../storefront/product-picker";
import { PopupWindowFields } from "./notice-when-fields";
import { popupPlacementChangeNotes } from "./notices-view-model";
import { PopupNumberInput } from "./popup-frequency-fields";
import { PopupPagesChecklist } from "./popup-pages-checklist";
import {
  NO_PENDING_LINES,
  POPUP_DELAY_OPTIONS,
  POPUP_EDITOR_COPY,
  POPUP_LESSON_SCOPE_OPTIONS,
  POPUP_PLACEMENT_OPTIONS,
  POPUP_TRIGGER_OPTIONS,
  canExclude,
  checklistOf,
  delayChoiceOf,
  lessonScopeOf,
  patternsOfChecklist,
  pendingOfChecklist,
  placementUiOf,
  popupSettingsOfDraft,
  settingsForPlacementChoice,
  settingsForTrigger,
  syncPlacementUi,
  tidyPopupPlacement,
  type PopupChecklist,
  type PopupDelayChoice,
  type PopupLessonScope,
  type PopupPlacementChoice,
  type PopupPlacementUi
} from "./popup-editor-model";

// Card "Quando e onde aparece" do pop-up (v3b-1, docs/25 §2.3): o momento ("Ao abrir a página" ou "Ao
// concluir uma aula"), onde aparece (so no Inicio, qualquer pagina ou as paginas marcadas, com "Nunca
// nestas páginas"), de quais aulas no segundo momento, "Quanto tempo depois", "Começa" e "Termina", a frase
// ao vivo (com o aviso do curso que abre direto na aula), as linhas do pop-up no ar e a nota fixa. O que nao
// vira padrao (a escolha de "Onde aparece", a chave das excecoes, a linha marcada sem produto) e o
// PopupPlacementUi, guardado pelo editor: os erros "Escolha pelo menos um produto." saem dele
// (popupPlacementProblems). A 375 px cada controle tem 44 px e as listas ficam numa coluna.

type PopupPlacementFieldsProps = {
  disabled: boolean;
  draft: Pick<NoticeDraft, "popup" | "repeat" | "window">;
  errorFor: (key: string) => string | undefined;
  /** Pop-up no ar ou pausado: o que esta salvo (as linhas de aviso comparam com ele). */
  live: { saved: Pick<NoticeDraft, "popup" | "repeat" | "window">; status: CampaignStatus } | null;
  names: PopupNames;
  now: number;
  onChange: (patch: Partial<NoticeDraft>) => void;
  onUiChange: (ui: PopupPlacementUi) => void;
  /** Produtos que abrem direto na primeira aula (a frase ao vivo avisa). */
  opensOnLesson: readonly string[];
  products: readonly ProductPickerItem[];
  productsLoaded: boolean;
  ui: PopupPlacementUi;
};

const labelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";
const hintClass = "text-[13px] leading-5 text-[var(--text-secondary)]";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={id}>
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  ) : null;
}

function lessonIds(patterns: readonly string[]) {
  return patterns.filter((pattern) => pattern.startsWith("lesson:") && pattern !== "lesson:*").map((pattern) => pattern.slice("lesson:".length));
}

export function PopupPlacementFields({
  disabled,
  draft,
  errorFor,
  live,
  names,
  now,
  onChange,
  onUiChange,
  opensOnLesson,
  products,
  productsLoaded,
  ui
}: PopupPlacementFieldsProps) {
  const copy = POPUP_EDITOR_COPY.placement;
  const settings = popupSettingsOfDraft(draft);
  const lesson = settings.trigger === "lesson_completed";
  // "Outro" fica aberto enquanto o produtor digita, mesmo quando o numero bate com uma pilula.
  const [otherDelay, setOtherDelay] = useState(() => delayChoiceOf(settings.delaySeconds) === "other");
  const delayChoice: PopupDelayChoice = otherDelay ? "other" : delayChoiceOf(settings.delaySeconds);
  const exceptionsShown = ui.exceptions && canExclude(settings);

  /** Grava a configuracao (sem excecoes quando elas nao cabem) e o estado da tela junto. */
  function apply(next: PopupSettings, nextUi: PopupPlacementUi = ui) {
    const tidy = tidyPopupPlacement(next);
    onChange({ popup: tidy });
    onUiChange(syncPlacementUi(nextUi, tidy));
  }

  function changeTrigger(trigger: PopupTrigger) {
    const next = settingsForTrigger(settings, trigger);
    apply(next, placementUiOf(next));
  }

  function changeChoice(choice: PopupPlacementChoice) {
    apply(settingsForPlacementChoice(settings, choice), { ...ui, choice, pending: { ...ui.pending, pages: NO_PENDING_LINES } });
  }

  function changePages(checklist: PopupChecklist) {
    apply({ ...settings, pages: patternsOfChecklist(checklist) }, { ...ui, pending: { ...ui.pending, pages: pendingOfChecklist(checklist) } });
  }

  function changeExclude(checklist: PopupChecklist) {
    apply({ ...settings, exclude: patternsOfChecklist(checklist) }, { ...ui, pending: { ...ui.pending, exclude: pendingOfChecklist(checklist) } });
  }

  function toggleExceptions(on: boolean) {
    if (on) {
      onUiChange({ ...ui, exceptions: true });
      return;
    }

    apply({ ...settings, exclude: [] }, { ...ui, exceptions: false, pending: { ...ui.pending, exclude: NO_PENDING_LINES } });
  }

  function changeLessonScope(scope: PopupLessonScope) {
    const pages = scope === "any" ? ["lesson:*"] : [];
    apply({ ...settings, pages }, { ...ui, pending: { ...ui.pending, pages: { content: false, lesson: scope === "some" } } });
  }

  function changeLessonProducts(ids: readonly string[]) {
    apply({ ...settings, pages: ids.map((id) => `lesson:${id}`) }, { ...ui, pending: { ...ui.pending, pages: { content: false, lesson: ids.length === 0 } } });
  }

  function changeDelayChoice(choice: PopupDelayChoice) {
    if (choice === "other") {
      setOtherDelay(true);
      return;
    }

    setOtherDelay(false);
    onChange({ popup: { ...settings, delaySeconds: Number(choice) } });
  }

  const lessonScope = lessonScopeOf(settings);
  const pagesError = errorFor("popup.pages");
  const excludeError = errorFor("popup.exclude");
  // Sem pagina escolhida ainda (lista vazia, produto por escolher), a frase espera: o campo ja diz o que falta.
  const sentence = settings.pages.length > 0 ? `${describePopupPlacement(settings, names)}${opensOnLessonNote(settings, opensOnLesson, names) ?? ""}` : null;
  const changeNotes = live
    ? popupPlacementChangeNotes({ now, saved: { popup: popupSettingsOfDraft(live.saved), window: live.saved.window }, shown: { popup: settings, window: draft.window }, status: live.status })
    : [];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-2">
        <span className={labelClass}>{copy.triggerLabel}</span>
        <PillGroup ariaLabel={copy.triggerAria} disabled={disabled} name="popup-momento" onChange={changeTrigger} options={POPUP_TRIGGER_OPTIONS} value={settings.trigger} />
        <p className={hintClass}>{copy.triggerHint[settings.trigger]}</p>
        <FieldError id="popup-momento-error" message={errorFor("popup.trigger")} />
      </div>

      {lesson ? (
        <div className="flex min-w-0 flex-col gap-3">
          <span className={labelClass}>{copy.lessonScopeLabel}</span>
          <PillGroup ariaLabel={copy.lessonScopeAria} disabled={disabled} name="popup-aulas" onChange={changeLessonScope} options={POPUP_LESSON_SCOPE_OPTIONS} value={lessonScope} />
          {lessonScope === "some" ? (
            productsLoaded ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <ProductPicker
                  disabled={disabled}
                  emptyText={copy.productsEmpty}
                  error={pagesError}
                  hint={copy.formationHint}
                  id="popup-paginas-aulas"
                  items={products}
                  mode="multiple"
                  onChange={changeLessonProducts}
                  value={lessonIds(settings.pages)}
                />
                <p className="text-xs leading-5 text-[var(--text-secondary)]" id="popup-paginas-aulas-hint">
                  {copy.formationHint}
                </p>
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-[var(--warning)]">{copy.productsUnavailable}</p>
            )
          ) : null}
          <FieldError id="popup-paginas-aulas-error" message={pagesError} />

          {canExclude(settings) ? (
            <div className="flex min-w-0 flex-col gap-2">
              <AdminSwitch checked={ui.exceptions} disabled={disabled} id="popup-excecoes-ligar" label={copy.lessonExceptionsLabel} onCheckedChange={toggleExceptions} />
              {exceptionsShown ? (
                productsLoaded ? (
                  <ProductPicker
                    disabled={disabled}
                    emptyText={copy.productsEmpty}
                    error={excludeError}
                    hint={copy.formationHint}
                    id="popup-excecoes"
                    items={products}
                    mode="multiple"
                    onChange={(ids) => apply({ ...settings, exclude: ids.map((id) => `lesson:${id}`) })}
                    value={lessonIds(settings.exclude)}
                  />
                ) : (
                  <p className="text-[13px] leading-5 text-[var(--warning)]">{copy.productsUnavailable}</p>
                )
              ) : null}
              {exceptionsShown ? (
                <p className="text-xs leading-5 text-[var(--text-secondary)]" id="popup-excecoes-hint">
                  {copy.formationHint}
                </p>
              ) : null}
              <FieldError id="popup-excecoes-error" message={excludeError} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <span className={labelClass}>{copy.whereLabel}</span>
          <PillGroup ariaLabel={copy.whereAria} disabled={disabled} name="popup-onde" onChange={changeChoice} options={POPUP_PLACEMENT_OPTIONS} value={ui.choice} />
          <p className={hintClass}>{copy.whereHint[ui.choice]}</p>
          {ui.choice === "pages" ? (
            <PopupPagesChecklist
              checklist={checklistOf(settings.pages, ui.pending.pages)}
              disabled={disabled}
              error={pagesError}
              id="popup-paginas"
              legend={copy.pagesLegend}
              list="pages"
              onChange={changePages}
              products={products}
              productsLoaded={productsLoaded}
            />
          ) : (
            <FieldError id="popup-onde-error" message={pagesError} />
          )}

          {canExclude(settings) ? (
            <div className="flex min-w-0 flex-col gap-3">
              <AdminSwitch
                checked={ui.exceptions}
                description={copy.exceptionsDescription}
                disabled={disabled}
                id="popup-excecoes-ligar"
                label={copy.exceptionsLabel}
                onCheckedChange={toggleExceptions}
              />
              {exceptionsShown ? (
                <PopupPagesChecklist
                  checklist={checklistOf(settings.exclude, ui.pending.exclude)}
                  disabled={disabled}
                  error={excludeError}
                  id="popup-excecoes"
                  legend={copy.exceptionsLegend}
                  list="exclude"
                  onChange={changeExclude}
                  products={products}
                  productsLoaded={productsLoaded}
                />
              ) : (
                <FieldError id="popup-excecoes-error" message={excludeError} />
              )}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <span className={labelClass} id="popup-atraso-label">
          {copy.delayLabel}
        </span>
        <PillGroup ariaLabel={copy.delayLabel} disabled={disabled} name="popup-atraso" onChange={changeDelayChoice} options={POPUP_DELAY_OPTIONS} value={delayChoice} />
        {delayChoice === "other" ? (
          <PopupNumberInput
            ariaLabel={copy.delayOtherLabel}
            disabled={disabled}
            error={errorFor("popup.delaySeconds")}
            id="popup-atraso-outro"
            max={600}
            min={0}
            onChange={(delaySeconds) => onChange({ popup: { ...settings, delaySeconds } })}
            suffix={copy.delayOtherSuffix}
            value={settings.delaySeconds}
          />
        ) : (
          <FieldError id="popup-atraso-error" message={errorFor("popup.delaySeconds")} />
        )}
        <p className={hintClass}>{settings.delaySeconds === 0 && !lesson ? copy.delayZeroHint : copy.delayHint[settings.trigger]}</p>
      </div>

      <PopupWindowFields
        disabled={disabled}
        errors={{ endsAt: errorFor("window.endsAt"), startsAt: errorFor("window.startsAt") }}
        onChange={(window) => onChange({ window })}
        window={draft.window}
      />

      <div className="flex min-w-0 flex-col gap-2">
        <p aria-live="polite" className="text-sm leading-6 text-[var(--text-primary)]">
          {sentence}
        </p>
        {changeNotes.map((note) => (
          <p className="flex items-start gap-2 text-[13px] leading-5 text-[var(--text-secondary)]" key={note}>
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{note}</span>
          </p>
        ))}
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">{copy.note}</span>
      </p>
    </div>
  );
}
