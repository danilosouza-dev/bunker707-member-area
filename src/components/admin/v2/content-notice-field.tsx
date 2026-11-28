"use client";

import { Input } from "@/components/ui/input";
import {
  CONTENT_NOTICE_LABELS,
  CONTENT_NOTICE_TEXT_MAX,
  contentNoticeFromField,
  contentNoticeToField,
  type ContentNotice,
  type ContentNoticeChoice
} from "@/lib/content-notice";
import { PillGroup, adminInputClass } from "./form";

// O aviso da liberação "sem data" (docs/17 §1.6.5a), dentro do campo Liberação: pilulas Em breve / Em gravação /
// Outro texto e, no ultimo, o texto de ate 24 caracteres. E o que o aluno le no lugar da data.

const OPTIONS = [
  { label: CONTENT_NOTICE_LABELS.coming_soon, value: "coming_soon" },
  { label: CONTENT_NOTICE_LABELS.recording, value: "recording" },
  { label: "Outro texto", value: "custom" }
] as const satisfies readonly { label: string; value: ContentNoticeChoice }[];

type ContentNoticeFieldProps = {
  disabled?: boolean;
  error?: string | null;
  /** Prefixo dos ids e do `name` dos radios (unico na tela). */
  id: string;
  onChange: (notice: ContentNotice) => void;
  value: ContentNotice;
};

export function ContentNoticeField({ disabled = false, error, id, onChange, value }: ContentNoticeFieldProps) {
  const field = contentNoticeToField(value);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${id}-label`}>
        O que o aluno lê
      </span>
      <PillGroup
        ariaLabel="O que o aluno lê"
        disabled={disabled}
        name={id}
        onChange={(choice) => onChange(contentNoticeFromField(choice, field.text))}
        options={OPTIONS}
        value={field.choice}
      />
      {field.choice === "custom" ? (
        <Input
          aria-describedby={error ? `${id}-texto-error` : undefined}
          aria-invalid={error ? true : undefined}
          aria-label="Texto do aviso"
          autoComplete="off"
          className={adminInputClass}
          disabled={disabled}
          id={`${id}-texto`}
          maxLength={CONTENT_NOTICE_TEXT_MAX}
          // O texto vai como foi digitado (com os espacos); o servidor apara e recusa o vazio.
          onChange={(event) => onChange({ kind: "custom", text: event.target.value })}
          placeholder="Ex.: Aulas a partir de março"
          value={field.text}
        />
      ) : null}
      {error ? (
        <p className="text-[13px] leading-5 text-[var(--error)]" id={`${id}-texto-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
