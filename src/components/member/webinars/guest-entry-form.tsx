"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { openLinkAsksContact, type OpenLinkField, type OpenLinkSettings } from "@/server/webinars/open-link-model";

// O formulario do link aberto (docs/30 §14): so os campos que a equipe pediu (Opcional com a marca "opcional"), o aceite
// quando pede e-mail ou telefone e o campo escondido contra robos. O Entrar pede a conta de convidado a
// POST /api/webinars/entrar/[slug] e entra com ela aqui no navegador (o limite de logins do Auth conta por pessoa, nao
// pelo servidor: 100 ou mais entram juntas), e abre a pagina do webinario com a sessao nova.

const copy = WEBINAR_COPY.linkAberto.entrar;

type Errors = Partial<Record<OpenLinkField | "consent" | "form", string>>;

type GuestEntryFormProps = {
  consentText: string;
  coverUrl: string | null;
  description: string;
  fields: OpenLinkSettings;
  slug: string;
  source: string | null;
  title: string;
  when: string | null;
};

const inputClass =
  "h-12 w-full rounded-[10px] border border-white/15 bg-white/[0.06] px-4 text-[15px] text-white placeholder:text-zinc-500 focus-visible:border-white/40 focus-visible:outline-none aria-[invalid=true]:border-red-400/70";

export function GuestEntryForm({ consentText, coverUrl, description, fields, slug, source, title, when }: GuestEntryFormProps) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState({ email: "", name: "", phone: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const asksAnything = fields.name !== "off" || fields.email !== "off" || fields.phone !== "off";
  const asksContact = openLinkAsksContact(fields);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setErrors({});
    let leaving = false;

    try {
      const response = await fetch(`/api/webinars/entrar/${encodeURIComponent(slug)}`, {
        body: JSON.stringify({ ...values, consent, source: source ?? "" }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const body = (await response.json().catch(() => null)) as { data?: { email: string; password: string; slug: string }; error?: string; errors?: Errors } | null;

      if (response.status === 422 && body?.errors) {
        setErrors(body.errors);
        return;
      }

      if (!response.ok || !body?.data) {
        setErrors({ form: body?.error ?? copy.erro });
        return;
      }

      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({ email: body.data.email, password: body.data.password });

      if (error) {
        setErrors({ form: copy.erro });
        return;
      }

      // A sessao nova ja esta nos cookies: a pagina do webinario e lida de novo no servidor.
      leaving = true;
      router.replace(`/webinarios/${body.data.slug}`);
      router.refresh();
    } catch {
      setErrors({ form: copy.erro });
    } finally {
      // Saindo para a pagina do webinario, o botao fica em "Entrando" ate a troca.
      if (!leaving) {
        setSubmitting(false);
      }
    }
  }

  function field(name: OpenLinkField, label: string, type: string, autoComplete: string, hint?: string) {
    const mode = fields[name];
    if (mode === "off") {
      return null;
    }
    const inputId = `${id}-${name}`;
    const error = errors[name];
    const describedBy = [hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null].filter(Boolean).join(" ") || undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-200" htmlFor={inputId}>
          {label}
          {mode === "optional" ? <span className="ml-1 font-normal text-zinc-500">({copy.opcional})</span> : null}
        </label>
        <input
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          autoComplete={autoComplete}
          className={inputClass}
          id={inputId}
          inputMode={name === "phone" ? "tel" : name === "email" ? "email" : undefined}
          maxLength={name === "email" ? 254 : name === "phone" ? 24 : 80}
          name={name}
          onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
          required={mode === "required"}
          type={type}
          value={values[name]}
        />
        {hint ? (
          <p className="text-xs leading-5 text-zinc-500" id={`${inputId}-hint`}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <p className="text-[13px] leading-5 text-red-300" id={`${inputId}-error`}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col gap-6 px-4 pt-4 pb-12 sm:pt-10">
      {coverUrl ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-[14px] bg-white/[0.04]">
          <Image alt="" className="object-cover" fill sizes="(max-width: 560px) 100vw, 520px" src={coverUrl} unoptimized={!canOptimizeImageSrc(coverUrl)} />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h1 className="font-[family-name:var(--font-exo-2)] text-2xl leading-tight font-bold text-white sm:text-3xl">{title}</h1>
        {when ? <p className="text-sm font-medium text-zinc-300">{when}</p> : null}
        {description ? <p className="text-sm leading-6 whitespace-pre-line text-zinc-400">{description}</p> : null}
      </div>
      <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
        <p className="text-sm text-zinc-300">{asksAnything ? copy.chamada : copy.chamadaSemCampos}</p>
        {field("name", copy.nome, "text", "name", copy.nomeDica)}
        {field("email", copy.email, "email", "email")}
        {field("phone", copy.telefone, "tel", "tel")}
        {/* Campo escondido contra robos: gente de verdade nunca ve nem preenche. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor={`${id}-website`}>Site</label>
          <input
            autoComplete="off"
            id={`${id}-website`}
            name="website"
            onChange={(event) => setValues((current) => ({ ...current, website: event.target.value }))}
            tabIndex={-1}
            type="text"
            value={values.website}
          />
        </div>
        {asksContact ? (
          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-3 text-[13px] leading-5 text-zinc-300" htmlFor={`${id}-consent`}>
              <input
                aria-describedby={errors.consent ? `${id}-consent-error` : undefined}
                aria-invalid={Boolean(errors.consent)}
                checked={consent}
                className="mt-0.5 size-4 shrink-0 accent-white"
                id={`${id}-consent`}
                name="consent"
                onChange={(event) => setConsent(event.target.checked)}
                type="checkbox"
              />
              <span>{consentText}</span>
            </label>
            {errors.consent ? (
              <p className="text-[13px] leading-5 text-red-300" id={`${id}-consent-error`}>
                {errors.consent}
              </p>
            ) : null}
          </div>
        ) : null}
        {errors.form ? (
          <p className="text-[13px] leading-5 text-red-300" role="alert">
            {errors.form}
          </p>
        ) : null}
        <button className={memberButtonClassName({ className: "w-full", size: "lg", variant: "primary" })} disabled={submitting} type="submit">
          {submitting ? copy.entrando : copy.entrar}
        </button>
        <p className="text-center text-[13px] text-zinc-400">
          {copy.jaTemConta}{" "}
          <a className="font-semibold text-white underline-offset-4 hover:underline" href={`/login?next=${encodeURIComponent(`/webinarios/${slug}`)}`}>
            {copy.entrarComConta}
          </a>
        </p>
      </form>
    </div>
  );
}
