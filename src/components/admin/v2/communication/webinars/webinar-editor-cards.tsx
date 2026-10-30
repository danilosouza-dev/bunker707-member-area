"use client";

import { BellRing, Clapperboard, MonitorPlay, PanelTop, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRODUCT_FORMAT_LABELS, PRODUCT_SITUATION_LABELS } from "@/server/catalog/model";
import type { AudienceDefinition } from "@/server/communications/audience-model";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import {
  ACCESS_MODE_OPTIONS,
  WEBINAR_ADMIN_COPY,
  WEBINAR_EDITOR_LIMITS,
  accessUsesAudience,
  accessUsesProduct,
  nextWebinarSessionAt,
  reminderPreviewText,
  sortWebinarSessions,
  webinarAccessHint,
  webinarAccessNotice,
  webinarAudienceChoices,
  webinarConsoleHref,
  webinarFirstSessionAt,
  webinarRecordingCard,
  type WebinarCardLink,
  type WebinarLiveSessionSummary,
  type WebinarNotifyShortcuts,
  type WebinarPermissions
} from "@/server/webinars/editor-model";
import { toTime, type AccessMode, type ChatMode, type DisplayNameMode, type WebinarDraft, type WebinarSession } from "@/server/webinars/model";
import type { WebinarEditorOptions } from "@/server/webinars/queries";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../../form";
import { AdminSwitch } from "../../settings/kit";
import { StatusChip } from "../../status-chip";
import type { ProductPickerItem } from "../../storefront/product-picker";
import { ProductPicker } from "../../storefront/product-picker";
import { AudienceBuilder, AudienceCount, type AudienceCountState } from "../audience-builder";
import { DateTimeField } from "../notice-when-fields";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { JitCard, type JitCardProps } from "./jit/jit-card";

// Cards do editor do webinario que nao dependem do estado do editor alem do rascunho (docs/30 §2.2): Sessoes,
// Quem pode, Vaga e lembretes, Avisar, Sala, Qualidade, Gravacao e Publicar replay como aula. O card Dados fica
// no editor (precisa do envio da capa e da equipe). Cada campo tem id "webinar-<campo>" para o foco do erro. Fase 4e:
// o card Sessoes termina com o "Comeca quando voce entra" (jit/jit-card.tsx), que salva as proprias regras.

export type CardProps = {
  disabled: boolean;
  draft: WebinarDraft;
  errorFor: (key: string) => string | undefined;
  now: number;
  onBlur: (key: string) => void;
  onChange: (patch: Partial<WebinarDraft>) => void;
};

const copy = WEBINAR_ADMIN_COPY.fields;

export function toPickerItems(products: WebinarEditorOptions["products"]): ProductPickerItem[] {
  return products.map((product) => ({
    accent: product.accent,
    coverUrl: product.coverUrl,
    detail: PRODUCT_FORMAT_LABELS[product.format],
    flags: product.situation === "published" ? [] : [{ label: PRODUCT_SITUATION_LABELS[product.situation], tone: "muted" as const }],
    id: product.id,
    title: product.title
  }));
}

/** Campo numerico inteiro de 40 px (o mesmo desenho dos outros campos). */
function NumberInput({
  describedBy,
  disabled,
  id,
  invalid,
  max,
  min,
  onBlur,
  onChange,
  value
}: {
  describedBy?: string;
  disabled: boolean;
  id: string;
  invalid?: boolean;
  max: number;
  min: number;
  onBlur?: () => void;
  onChange: (value: number | null) => void;
  value: number | null;
}) {
  return (
    <input
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      className={cn(adminInputClass, "w-36")}
      disabled={disabled}
      id={id}
      inputMode="numeric"
      max={max}
      min={min}
      onBlur={onBlur}
      onChange={(event) => {
        const text = event.target.value.trim();

        if (text === "") {
          onChange(null);
          return;
        }

        const parsed = Number(text);
        onChange(Number.isFinite(parsed) ? Math.trunc(parsed) : null);
      }}
      type="number"
      value={value ?? ""}
    />
  );
}

function SoonRow({ hint, label }: { hint?: string; label: string }) {
  return (
    <div className="flex min-h-11 items-start gap-3 opacity-70">
      <span aria-hidden="true" className="relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)]">
        <span className="block size-[18px] translate-x-[2px] rounded-full bg-[var(--text-tertiary)]" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm leading-6 font-medium text-[var(--text-primary)]">
          {label} <span className="font-normal text-[var(--text-tertiary)]">· {WEBINAR_ADMIN_COPY.emBreve}</span>
        </span>
        {hint ? <span className="text-[13px] leading-5 text-[var(--text-secondary)]">{hint}</span> : null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Sessoes (so Live gravada): horas marcadas, Entrada atrasada por sessao e o Replay livre (fase 2)
 * ---------------------------------------------------------------------------------------------- */

type LateJoinChoice = "always" | "until";

const LATE_JOIN_OPTIONS: readonly { label: string; value: LateJoinChoice }[] = [
  { label: copy.lateJoinAlways, value: "always" },
  { label: copy.lateJoinUntil, value: "until" }
];

const SESSION_STATUS_TONE: Record<WebinarSession["status"], "error" | "muted" | "neutral" | "success" | "warning"> = {
  cancelled: "error",
  ended: "muted",
  live: "success",
  scheduled: "neutral",
  waiting: "warning"
};

const SESSION_STATUS_LABEL: Record<WebinarSession["status"], string> = {
  cancelled: WEBINAR_ADMIN_COPY.console.phases.cancelled,
  ended: WEBINAR_ADMIN_COPY.console.phases.ended,
  live: WEBINAR_ADMIN_COPY.console.phases.live,
  scheduled: WEBINAR_ADMIN_COPY.console.phases.scheduled,
  waiting: WEBINAR_ADMIN_COPY.console.phases.waiting
};

export type ReplayControl = {
  busy: boolean;
  /** Alguma sessao ja encerrou: o replay pode abrir. */
  firstEnded: boolean;
  onCancel: () => void;
  onCreate: () => void;
  session: WebinarSession | null;
};

type SessionsCardProps = CardProps & {
  /** Fase 4e: o "Comeca quando voce entra" (as regras gravadas e quem decide); sem ele, o bloco nao aparece. */
  jit?: JitCardProps | null;
  /** Nulo enquanto o webinario nao foi gravado (sem id): o Replay livre e os consoles aparecem depois do primeiro salvar. */
  replay: ReplayControl | null;
  /** As sessoes gravadas, para a situacao e o link do console de cada hora marcada. */
  savedSessions: readonly WebinarSession[];
  webinarId: string | null;
};

export function SessionsCard({ disabled, draft, errorFor, jit = null, now, onBlur, onChange, replay, savedSessions, webinarId }: SessionsCardProps) {
  const sessions = draft.sessions;
  const listError = errorFor("sessions");
  // As sessoes do "Comeca quando voce entra" nunca entram aqui (a lista e das horas marcadas).
  const savedByTime = new Map(
    savedSessions.filter((session) => session.kind === "simulated" && session.status !== "cancelled" && !session.jit).map((session) => [toTime(session.scheduledAt), session])
  );

  function update(index: number, patch: Partial<WebinarDraft["sessions"][number]>) {
    const next = sessions.map((session, position) => (position === index ? { ...session, ...patch } : session));
    onChange({ sessions: next });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-4" role="group" aria-labelledby="webinar-sessions-label">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id="webinar-sessions-label">
          {copy.sessions}
        </span>
        {sessions.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.sessionsEmpty}</p> : null}
        {sessions.map((session, index) => {
          const saved = savedByTime.get(toTime(session.scheduledAt)) ?? null;
          const lateJoin: LateJoinChoice = session.lateJoinMinutes == null ? "always" : "until";
          const lateJoinId = `webinar-sessions-${index}-lateJoinMinutes`;
          const lateJoinError = errorFor(`sessions.${index}.lateJoinMinutes`);

          return (
            <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 last:border-b-0 last:pb-0" data-session-row={index} key={`${index}-${session.scheduledAt}`}>
              <div className="flex min-w-0 flex-wrap items-end gap-2">
                <DateTimeField
                  disabled={disabled || (saved !== null && saved.status !== "scheduled")}
                  error={errorFor(`sessions.${index}.scheduledAt`)}
                  idPrefix={`webinar-sessions-${index}`}
                  label={`Sessão ${index + 1}`}
                  onChange={(iso) => {
                    update(index, { scheduledAt: iso });
                    onBlur(`sessions.${index}.scheduledAt`);
                  }}
                  value={session.scheduledAt}
                />
                <Button
                  aria-label={`${copy.sessionsRemove} ${index + 1}`}
                  className="px-3 text-[var(--text-secondary)]"
                  disabled={disabled || (saved !== null && saved.status !== "scheduled")}
                  onClick={() => onChange({ sessions: sessions.filter((_, position) => position !== index) })}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  {copy.sessionsRemove}
                </Button>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${lateJoinId}-label`}>
                  {copy.lateJoin}
                </span>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <PillGroup
                    ariaLabel={`${copy.lateJoin} da sessão ${index + 1}`}
                    disabled={disabled}
                    name={`webinar-sessions-${index}-lateJoin`}
                    onChange={(choice: LateJoinChoice) => update(index, { lateJoinMinutes: choice === "always" ? null : (session.lateJoinMinutes ?? 15) })}
                    options={LATE_JOIN_OPTIONS}
                    value={lateJoin}
                  />
                  {lateJoin === "until" ? (
                    <label className="flex min-w-0 items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]">
                      <span className="sr-only">{copy.lateJoinMinutes}</span>
                      <NumberInput
                        describedBy={fieldDescribedBy(lateJoinId, { error: lateJoinError })}
                        disabled={disabled}
                        id={lateJoinId}
                        invalid={Boolean(lateJoinError)}
                        max={WEBINAR_EDITOR_LIMITS.lateJoinMax}
                        min={0}
                        onBlur={() => onBlur(`sessions.${index}.lateJoinMinutes`)}
                        onChange={(minutes) => update(index, { lateJoinMinutes: minutes })}
                        value={session.lateJoinMinutes ?? null}
                      />
                      <span>min</span>
                    </label>
                  ) : null}
                </div>
                <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.lateJoinHint}</p>
                {lateJoinError ? <p className="text-[13px] leading-5 text-[var(--error)]">{lateJoinError}</p> : null}
              </div>
              {saved && webinarId ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StatusChip tone={SESSION_STATUS_TONE[saved.status]}>{SESSION_STATUS_LABEL[saved.status]}</StatusChip>
                  <Link
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[var(--text-primary)] underline-offset-4 hover:underline"
                    data-session-console={saved.id}
                    href={webinarConsoleHref(webinarId, saved.id)}
                  >
                    <MonitorPlay aria-hidden="true" className="size-4" />
                    {copy.openConsole}
                  </Link>
                </div>
              ) : null}
            </div>
          );
        })}
        {listError ? <p className="text-[13px] leading-5 text-[var(--error)]">{listError}</p> : null}
        <div>
          <Button
            className="px-3"
            disabled={disabled || sessions.length >= WEBINAR_EDITOR_LIMITS.sessionsMax}
            onClick={() => onChange({ sessions: sortWebinarSessions([...sessions, { lateJoinMinutes: null, scheduledAt: nextWebinarSessionAt(sessions, now) }]) })}
            type="button"
            variant="secondary"
          >
            <Plus aria-hidden="true" className="size-4" />
            {copy.sessionsAdd}
          </Button>
        </div>
      </div>
      {replay ? (
        <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
          <AdminSwitch
            checked={replay.session !== null}
            description={replay.session ? copy.replayOn(formatSaoPauloDateTime(replay.session.scheduledAt)) : replay.firstEnded ? copy.replayHint : copy.replayWaiting}
            disabled={disabled || (!replay.firstEnded && replay.session === null)}
            id="webinar-replay"
            label={copy.replaySwitch}
            onCheckedChange={(checked) => (checked ? replay.onCreate() : replay.onCancel())}
            pending={replay.busy}
          />
          {replay.session ? (
            <Link
              className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[var(--text-primary)] underline-offset-4 hover:underline"
              href={webinarConsoleHref(webinarId ?? "", replay.session.id)}
            >
              <MonitorPlay aria-hidden="true" className="size-4" />
              {WEBINAR_COPY.aluno.replay}: {copy.openConsole}
            </Link>
          ) : null}
        </div>
      ) : null}
      {jit ? <JitCard {...jit} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Quem pode
 * ---------------------------------------------------------------------------------------------- */

type AccessCardProps = CardProps & {
  audienceDescription: string;
  audienceErrors: Record<string, string>;
  countState: AudienceCountState;
  onRetryCount: () => void;
  options: WebinarEditorOptions;
  pickerItems: readonly ProductPickerItem[];
  /** O webinario gravado (null no novo): a regra "Participação em lives" nunca oferece a propria live. */
  webinarId: string | null;
};

export function AccessCard({ audienceDescription, audienceErrors, countState, disabled, draft, errorFor, onBlur, onChange, onRetryCount, options, pickerItems, webinarId }: AccessCardProps) {
  const capacityDisabled = disabled || !draft.registrationRequired;
  const hint = webinarAccessHint(draft.accessMode);
  const notice = webinarAccessNotice(draft);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PillGroup
        ariaLabel={WEBINAR_ADMIN_COPY.cards.quemPode.title}
        disabled={disabled}
        name="webinar-access-mode"
        onChange={(mode: AccessMode) => {
          onChange({ accessMode: mode });
          // Produto ou segmento com Limite de vagas e recusado (a vaga nao segura, D41): o aviso aparece na hora.
          if (mode === "either" && draft.capacity != null) {
            onBlur("capacity");
          }
        }}
        options={ACCESS_MODE_OPTIONS}
        value={draft.accessMode}
      />
      {accessUsesProduct(draft.accessMode) ? (
        <AdminField error={errorFor("productId")} id="webinar-productId" label={copy.product}>
          <ProductPicker
            disabled={disabled}
            emptyText={options.productsLoaded ? undefined : "A lista de produtos não carregou agora."}
            error={errorFor("productId")}
            id="webinar-productId"
            items={pickerItems}
            mode="single"
            onChange={(ids) => {
              onChange({ productId: ids[0] ?? null });
              onBlur("productId");
            }}
            value={draft.productId ? [draft.productId] : []}
          />
        </AdminField>
      ) : null}
      {accessUsesAudience(draft.accessMode) ? (
        <div className="flex min-w-0 flex-col gap-4">
          <AudienceBuilder
            cohorts={options.cohorts}
            disabled={disabled}
            errors={audienceErrors}
            idPrefix="webinario"
            notices={options.notices}
            onChange={(audience: AudienceDefinition) => onChange({ audience })}
            products={pickerItems}
            productsLoaded={options.productsLoaded}
            segments={options.segments}
            value={draft.audience}
            excludeWebinarId={webinarId}
            // O Quem pode e conferido a cada pedido do aluno: so "participou" e "garantiu vaga" (D52).
            webinarFollowUps={false}
            webinars={webinarAudienceChoices(options.webinars, webinarId)}
          />
          <AudienceCount description={audienceDescription} needsApproval={false} onRetry={onRetryCount} state={countState} />
          {hint ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{hint}</p> : null}
          {notice ? (
            <p className="text-xs leading-5 text-[var(--warning)]" data-webinar-access-notice="" role="note">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
      <AdminField
        error={errorFor("capacity")}
        hint={capacityDisabled && !disabled ? copy.capacityOff : draft.capacity ? copy.accessCapacityHint : undefined}
        id="webinar-capacity"
        label={copy.capacity}
        optional
      >
        <NumberInput
          describedBy={fieldDescribedBy("webinar-capacity", { error: errorFor("capacity"), hint: capacityDisabled ? copy.capacityOff : undefined })}
          disabled={capacityDisabled}
          id="webinar-capacity"
          invalid={Boolean(errorFor("capacity"))}
          max={WEBINAR_EDITOR_LIMITS.capacityMax}
          min={1}
          onBlur={() => onBlur("capacity")}
          onChange={(capacity) => onChange({ capacity })}
          value={draft.capacity}
        />
      </AdminField>
      <AdminSwitch
        checked={draft.showRegisteredCount}
        disabled={disabled}
        id="webinar-showRegisteredCount"
        label={copy.showRegisteredCount}
        onCheckedChange={(checked) => onChange({ showRegisteredCount: checked })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Vaga e lembretes
 * ---------------------------------------------------------------------------------------------- */

const REMINDER_TEXT_KEYS = [
  { key: "confirmation", label: copy.confirmationText, preview: "confirmation" },
  { key: "h24", label: copy.h24Text, preview: "h24" },
  { key: "h1", label: copy.h1Text, preview: "h1" },
  { key: "started", label: copy.startedText, preview: "started" }
] as const;

export function RegistrationCard({ disabled, draft, errorFor, now, onBlur, onChange }: CardProps) {
  const at = webinarFirstSessionAt(draft, now);
  const textsDisabled = disabled || !draft.registrationRequired;

  function changeText(key: keyof WebinarDraft["reminderTexts"], value: string) {
    onChange({ reminderTexts: { ...draft.reminderTexts, [key]: value } });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminSwitch
        checked={draft.registrationRequired}
        description={draft.registrationRequired ? copy.registrationOn : copy.registrationOff}
        disabled={disabled}
        id="webinar-registrationRequired"
        label={copy.registration}
        onCheckedChange={(checked) => onChange({ capacity: checked ? draft.capacity : null, registrationRequired: checked })}
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <AdminSwitch checked={draft.reminders.h24} disabled={textsDisabled} id="webinar-reminders-h24" label={copy.h24} onCheckedChange={(h24) => onChange({ reminders: { ...draft.reminders, h24 } })} />
        <AdminSwitch checked={draft.reminders.h1} disabled={textsDisabled} id="webinar-reminders-h1" label={copy.h1} onCheckedChange={(h1) => onChange({ reminders: { ...draft.reminders, h1 } })} />
        <AdminSwitch checked={draft.registrationRequired} description={copy.reminderSinoHint} disabled id="webinar-reminders-sino" label={copy.reminderSino} onCheckedChange={() => undefined} />
        <AdminSwitch
          checked={draft.reminders.email}
          description={copy.emailHint}
          disabled={textsDisabled}
          id="webinar-reminders-email"
          label={copy.email}
          onCheckedChange={(email) => onChange({ reminders: { ...draft.reminders, email } })}
        />
      </div>
      <SoonRow label={copy.whatsapp} />
      <div className="flex min-w-0 flex-col gap-4">
        {REMINDER_TEXT_KEYS.map((item) => {
          const id = `webinar-reminderTexts-${item.key}`;
          const error = errorFor(`reminderTexts.${item.key}`);

          return (
            <AdminField error={error} hint={`${copy.reminderTextEmpty} ${reminderPreviewText(item.preview, draft, at)}`} id={id} key={item.key} label={item.label} optional>
              <textarea
                aria-describedby={fieldDescribedBy(id, { error, hint: copy.reminderTextEmpty })}
                aria-invalid={error ? true : undefined}
                className={cn(adminTextareaClass, "min-h-20")}
                disabled={textsDisabled}
                id={id}
                maxLength={WEBINAR_EDITOR_LIMITS.reminderText}
                onBlur={() => onBlur(`reminderTexts.${item.key}`)}
                onChange={(event) => changeText(item.key, event.target.value)}
                rows={2}
                value={draft.reminderTexts[item.key] ?? ""}
              />
            </AdminField>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.afterLive}</span>
        {(
          [
            { key: "afterAttended", label: copy.afterAttended },
            { key: "afterAbsent", label: copy.afterAbsent }
          ] as const
        ).map((item) => {
          const id = `webinar-reminderTexts-${item.key}`;
          const error = errorFor(`reminderTexts.${item.key}`);

          return (
            <AdminField error={error} id={id} key={item.key} label={item.label} optional>
              <textarea
                aria-describedby={fieldDescribedBy(id, { error })}
                aria-invalid={error ? true : undefined}
                className={cn(adminTextareaClass, "min-h-20")}
                disabled={disabled}
                id={id}
                maxLength={WEBINAR_EDITOR_LIMITS.reminderText}
                onBlur={() => onBlur(`reminderTexts.${item.key}`)}
                onChange={(event) => changeText(item.key, event.target.value)}
                rows={2}
                value={draft.reminderTexts[item.key] ?? ""}
              />
            </AdminField>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Avisar
 * ---------------------------------------------------------------------------------------------- */

/**
 * Um atalho do card Avisar (Aviso no sino, Pop-up): link para o editor da Comunicacao preenchido; desligado, o rotulo
 * apagado (aria-disabled). O motivo vem uma vez so, embaixo dos dois (NotifyCard).
 */
function NotifyShortcut({ hint, icon, id, link }: { hint: string; icon: ReactNode; id: string; link: WebinarCardLink }) {
  const hintId = `webinar-notify-${id}-hint`;

  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-notify-shortcut={id}>
      {link.href ? (
        <Link aria-describedby={hintId} className={cardLinkClass} href={link.href}>
          {icon}
          {link.label}
        </Link>
      ) : (
        <span aria-describedby={hintId} aria-disabled="true" className="inline-flex min-h-9 w-fit items-center gap-1.5 px-2 text-[13px] font-medium text-[var(--text-tertiary)]">
          {icon}
          {link.label}
        </span>
      )}
      <span className="px-2 text-xs leading-5 text-[var(--text-secondary)]" id={hintId}>
        {hint}
      </span>
    </div>
  );
}

type NotifyCardProps = CardProps & {
  /** Aviso no sino e Pop-up (webinarNotifyShortcuts): o endereco ou o motivo de estarem desligados. */
  shortcuts: WebinarNotifyShortcuts;
};

export function NotifyCard({ disabled, draft, errorFor, onBlur, onChange, shortcuts }: NotifyCardProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminSwitch checked={draft.showOnHome} description={copy.homeCardHint} disabled={disabled} id="webinar-showOnHome" label={copy.homeCard} onCheckedChange={(showOnHome) => onChange({ showOnHome })} />
      <AdminField error={errorFor("replayDaysOnHome")} hint={copy.replayDaysHint} id="webinar-replayDaysOnHome" label={copy.replayDays}>
        <NumberInput
          describedBy={fieldDescribedBy("webinar-replayDaysOnHome", { error: errorFor("replayDaysOnHome"), hint: copy.replayDaysHint })}
          disabled={disabled || !draft.showOnHome}
          id="webinar-replayDaysOnHome"
          invalid={Boolean(errorFor("replayDaysOnHome"))}
          max={WEBINAR_EDITOR_LIMITS.replayDaysMax}
          min={0}
          onBlur={() => onBlur("replayDaysOnHome")}
          onChange={(days) => onChange({ replayDaysOnHome: days ?? 0 })}
          value={draft.replayDaysOnHome}
        />
      </AdminField>
      <AdminSwitch checked={draft.showBanner} description={copy.bannerSwitchHint} disabled={disabled} id="webinar-showBanner" label={copy.bannerSwitch} onCheckedChange={(showBanner) => onChange({ showBanner })} />
      <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--border-subtle)] pt-4" data-webinar-notify-shortcuts="">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.notifyLinksTitle}</span>
        <NotifyShortcut hint={copy.notifyInboxHint} icon={<BellRing aria-hidden="true" className="size-4" />} id="inbox" link={shortcuts.inbox} />
        <NotifyShortcut hint={shortcuts.popupHint} icon={<PanelTop aria-hidden="true" className="size-4" />} id="popup" link={shortcuts.popup} />
        {shortcuts.blocked ? (
          <p className="px-2 text-xs leading-5 text-[var(--text-secondary)]" data-webinar-notify-blocked="" role="note">
            {shortcuts.blocked}
          </p>
        ) : null}
        <SoonRow label={copy.flowLink} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Sala
 * ---------------------------------------------------------------------------------------------- */

const CHAT_MODE_OPTIONS: readonly { label: string; value: ChatMode }[] = [
  { label: copy.chatModes.open, value: "open" },
  { label: copy.chatModes.moderated, value: "moderated" },
  { label: copy.chatModes.team_only, value: "team_only" },
  { label: copy.chatModes.off, value: "off" }
];

type SlowModeValue = "off" | "10" | "20" | "30" | "60";

const SLOW_MODE_OPTIONS: readonly { label: string; value: SlowModeValue }[] = [
  { label: copy.slowModes.off, value: "off" },
  { label: copy.slowModes[10], value: "10" },
  { label: copy.slowModes[20], value: "20" },
  { label: copy.slowModes[30], value: "30" },
  { label: copy.slowModes[60], value: "60" }
];

const DISPLAY_NAME_OPTIONS: readonly { label: string; value: DisplayNameMode }[] = [
  { label: copy.displayNames.first_name_initial, value: "first_name_initial" },
  { label: copy.displayNames.nickname, value: "nickname" },
  { label: copy.displayNames.anonymous, value: "anonymous" }
];

export function RoomCard({ disabled, draft, onChange }: CardProps) {
  const room = draft.roomSettings;
  const setRoom = (patch: Partial<WebinarDraft["roomSettings"]>) => onChange({ roomSettings: { ...room, ...patch } });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminSwitch checked description={copy.micOffHint} disabled id="webinar-room-micOff" label={copy.micOff} onCheckedChange={() => undefined} />
      <AdminSwitch checked={false} description={copy.micSelfHint} disabled id="webinar-room-micSelf" label={copy.micSelf} onCheckedChange={() => undefined} />
      <AdminSwitch
        checked={draft.allowStudentCamera}
        description={copy.allowStudentCameraHint}
        disabled={disabled}
        id="webinar-allowStudentCamera"
        label={copy.allowStudentCamera}
        onCheckedChange={(allowStudentCamera) => onChange({ allowStudentCamera })}
      />
      <AdminSwitch checked={room.waitingRoom} disabled={disabled} id="webinar-room-waitingRoom" label={copy.waitingRoom} onCheckedChange={(waitingRoom) => setRoom({ waitingRoom })} />
      <AdminSwitch
        checked={room.practiceSession}
        description={copy.practiceSessionHint}
        disabled={disabled}
        id="webinar-room-practiceSession"
        label={copy.practiceSession}
        onCheckedChange={(practiceSession) => setRoom({ practiceSession })}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id="webinar-room-chatMode-label">
          {copy.chatMode}
        </span>
        <PillGroup ariaLabel={copy.chatMode} disabled={disabled} name="webinar-room-chatMode" onChange={(chatMode: ChatMode) => setRoom({ chatMode })} options={CHAT_MODE_OPTIONS} value={room.chatMode} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.slowMode}</span>
        <PillGroup
          ariaLabel={copy.slowMode}
          disabled={disabled || room.chatMode === "off"}
          name="webinar-room-slowMode"
          onChange={(value: SlowModeValue) => setRoom({ slowModeSeconds: value === "off" ? null : (Number(value) as 10 | 20 | 30 | 60) })}
          options={SLOW_MODE_OPTIONS}
          value={room.slowModeSeconds === null ? "off" : (String(room.slowModeSeconds) as SlowModeValue)}
        />
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <AdminSwitch checked={room.questions} disabled={disabled} id="webinar-room-questions" label={copy.questions} onCheckedChange={(questions) => setRoom({ questions })} />
        <AdminSwitch
          checked={room.anonymousQuestions}
          disabled={disabled || !room.questions}
          id="webinar-room-anonymousQuestions"
          label={copy.anonymousQuestions}
          onCheckedChange={(anonymousQuestions) => setRoom({ anonymousQuestions })}
        />
        <AdminSwitch checked={room.polls} description={copy.pollsHint} disabled={disabled} id="webinar-room-polls" label={copy.polls} onCheckedChange={(polls) => setRoom({ polls })} />
        <AdminSwitch checked={room.reactions} disabled={disabled} id="webinar-room-reactions" label={copy.reactions} onCheckedChange={(reactions) => setRoom({ reactions })} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.displayName}</span>
        <PillGroup
          ariaLabel={copy.displayName}
          disabled={disabled}
          name="webinar-room-displayName"
          onChange={(displayName: DisplayNameMode) => setRoom({ displayName })}
          options={DISPLAY_NAME_OPTIONS}
          value={room.displayName}
        />
      </div>
      {draft.kind === "simulated" ? (
        <>
          <AdminSwitch
            checked={room.newCommentsVisible}
            disabled={disabled}
            id="webinar-room-newCommentsVisible"
            label={copy.newCommentsVisible}
            onCheckedChange={(newCommentsVisible) => setRoom({ newCommentsVisible })}
          />
          <AdminSwitch checked description={copy.newCommentsHistoryHint} disabled id="webinar-room-newCommentsHistory" label={copy.newCommentsHistory} onCheckedChange={() => undefined} />
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Qualidade (D26)
 * ---------------------------------------------------------------------------------------------- */

type StageValue = "720" | "1080";
type FpsValue = "30" | "15";

export function QualityCard({ disabled, draft, onChange }: CardProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.qualityStage}</span>
        <PillGroup
          ariaLabel={copy.qualityStage}
          disabled={disabled}
          name="webinar-quality-stage"
          onChange={(value: StageValue) => onChange({ quality: { ...draft.quality, stage: value === "1080" ? 1080 : 720 } })}
          options={[
            { label: "720p", value: "720" },
            { label: "1080p", value: "1080" }
          ]}
          value={String(draft.quality.stage) as StageValue}
        />
        {draft.quality.stage === 1080 ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.qualityStageHint1080}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.qualityScreen}</span>
        <PillGroup
          ariaLabel={copy.qualityScreen}
          disabled={disabled}
          name="webinar-quality-screenFps"
          onChange={(value: FpsValue) => onChange({ quality: { ...draft.quality, screenFps: value === "15" ? 15 : 30 } })}
          options={[
            { label: copy.qualityScreenOptions[30], value: "30" },
            { label: copy.qualityScreenOptions[15], value: "15" }
          ]}
          value={String(draft.quality.screenFps) as FpsValue}
        />
        <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.qualityScreenHint}</p>
      </div>
      <ul className="flex flex-col gap-1 text-[13px] leading-5 text-[var(--text-secondary)]">
        {copy.qualityFixed.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Gravacao (so Live ao vivo): a situacao do servidor de gravacao e os caminhos para o console (fase 3)
 * ---------------------------------------------------------------------------------------------- */

type RecordingCardProps = CardProps & {
  /** A sala ao vivo existe neste ambiente (liveRoomConfigured, lido no servidor pela pagina). */
  liveRoomReady: boolean;
  /** A sessao `live` gravada (nula antes de publicar); so situacao e gravador, nunca o nome da sala. */
  liveSession: Pick<WebinarLiveSessionSummary, "recorderStatus" | "status"> | null;
  permissions: WebinarPermissions;
  webinarId: string | null;
};

const cardLinkClass =
  "inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[var(--text-primary)] underline-offset-4 hover:underline";

/** Um caminho do card para o console: link quando vale, texto desligado com a explicacao quando falta permissao. */
function CardLink({ icon, id, link }: { icon: ReactNode; id: string; link: WebinarCardLink }) {
  if (link.href) {
    return (
      <Link className={cardLinkClass} data-card-link={id} href={link.href}>
        {icon}
        {link.label}
      </Link>
    );
  }

  return (
    <span className="flex min-w-0 flex-col gap-0.5" data-card-link={id}>
      <span aria-disabled="true" className="inline-flex min-h-9 w-fit items-center gap-1.5 px-2 text-[13px] font-medium text-[var(--text-tertiary)]">
        {icon}
        {link.label}
      </span>
      {link.blocked ? <span className="px-2 text-xs leading-5 text-[var(--text-secondary)]">{link.blocked}</span> : null}
    </span>
  );
}

export function RecordingCard({ disabled, draft, liveRoomReady, liveSession, onChange, permissions, webinarId }: RecordingCardProps) {
  const view = webinarRecordingCard({ autoRecord: draft.autoRecord, liveRoomReady, liveSession, permissions, webinarId });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminSwitch checked={draft.autoRecord} description={view.autoRecordHint} disabled={disabled} id="webinar-autoRecord" label={copy.autoRecord} onCheckedChange={(autoRecord) => onChange({ autoRecord })} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]" data-recorder-status={view.status.value}>
          <span>{copy.recordingStatus}:</span>
          <StatusChip tone={view.status.tone}>{view.status.label}</StatusChip>
        </p>
        {view.pendingNote ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{view.pendingNote}</p> : null}
      </div>
      {view.prepare || view.upload ? (
        <div className="flex min-w-0 flex-col gap-2">
          {view.prepare ? <CardLink icon={<Clapperboard aria-hidden="true" className="size-4" />} id="prepare" link={view.prepare} /> : null}
          {view.upload ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <CardLink icon={<Upload aria-hidden="true" className="size-4" />} id="upload" link={view.upload} />
              <span className="px-2 text-xs leading-5 text-[var(--text-secondary)]">{copy.recordingUploadHint}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {view.roomMissingNote ? (
        <p className="text-xs leading-5 text-[var(--text-tertiary)]" data-live-room-missing="" role="note">
          {view.roomMissingNote}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Publicar replay como aula
 * ---------------------------------------------------------------------------------------------- */

export function ReplayLessonCard({ disabled, draft, errorFor, onBlur, onChange, pickerItems }: CardProps & { pickerItems: readonly ProductPickerItem[] }) {
  const target = draft.replayLessonTarget;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminSwitch
        checked={target !== null}
        disabled={disabled}
        id="webinar-replayLesson"
        label={copy.replayLesson}
        onCheckedChange={(checked) => onChange({ replayLessonTarget: checked ? { autoPublish: false, moduleId: null, productId: "", title: null } : null })}
      />
      {target ? (
        <>
          <AdminField error={errorFor("replayLessonTarget.productId")} id="webinar-replayLessonTarget-productId" label={copy.product}>
            <ProductPicker
              disabled={disabled}
              error={errorFor("replayLessonTarget.productId")}
              id="webinar-replayLessonTarget-productId"
              items={pickerItems}
              mode="single"
              onChange={(ids) => {
                onChange({ replayLessonTarget: { ...target, productId: ids[0] ?? "" } });
                onBlur("replayLessonTarget.productId");
              }}
              value={target.productId ? [target.productId] : []}
            />
          </AdminField>
          <AdminField error={errorFor("replayLessonTarget.moduleId")} hint={copy.replayLessonModuleHint} id="webinar-replayLessonTarget-moduleId" label={copy.replayLessonModule} optional>
            <input
              className={adminInputClass}
              disabled={disabled}
              id="webinar-replayLessonTarget-moduleId"
              maxLength={240}
              onBlur={() => onBlur("replayLessonTarget.moduleId")}
              onChange={(event) => onChange({ replayLessonTarget: { ...target, moduleId: event.target.value } })}
              type="text"
              value={target.moduleId ?? ""}
            />
          </AdminField>
          <AdminField error={errorFor("replayLessonTarget.title")} id="webinar-replayLessonTarget-title" label={copy.replayLessonTitle} optional>
            <input
              className={adminInputClass}
              disabled={disabled}
              id="webinar-replayLessonTarget-title"
              maxLength={WEBINAR_EDITOR_LIMITS.title}
              onBlur={() => onBlur("replayLessonTarget.title")}
              onChange={(event) => onChange({ replayLessonTarget: { ...target, title: event.target.value } })}
              type="text"
              value={target.title ?? ""}
            />
          </AdminField>
          <AdminSwitch
            checked={target.autoPublish}
            disabled={disabled}
            id="webinar-replayLessonTarget-autoPublish"
            label={copy.replayAutoPublish}
            onCheckedChange={(autoPublish) => onChange({ replayLessonTarget: { ...target, autoPublish } })}
          />
        </>
      ) : null}
    </div>
  );
}
