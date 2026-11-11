"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { saveLicenseHolder } from "@/server/licensing/interno/student-actions";

// O titular e o aceite dos termos em Minhas licencas (docs/32 §1.2 e §1.4 passo 3): no primeiro acesso, antes da primeira
// Chave, o nome ou a razao social, o CPF ou o CNPJ, um segundo e-mail (diferente do da conta) e o aceite da versao dos
// termos. Quando so os termos mudaram, so o aceite: o servidor reaproveita o titular que o Emissor ja tem (o documento
// nunca volta para o navegador). As regras e as frases dos campos sao as do servidor (holder.ts).

type Fields = "nome" | "documento" | "email2" | "termos";

const inputClassName =
  "h-11 w-full rounded-[10px] border border-white/12 bg-black/30 px-3 text-[15px] text-white outline-none placeholder:text-zinc-600 focus-visible:border-white/40 aria-[invalid=true]:border-red-400/60";

export function HolderForm({
  accountEmail,
  onlyTerms,
  terms
}: {
  accountEmail: string;
  /** O titular ja existe; falta so aceitar a versao nova dos termos. */
  onlyTerms: boolean;
  terms: { paragraphs: readonly string[]; title: string; version: string };
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    setSaving(true);
    setFailure(null);
    const result = await saveLicenseHolder({
      documento: text("documento"),
      email2: text("email2"),
      nome: text("nome"),
      somenteTermos: onlyTerms,
      termos: form.get("termos") === "on"
    });
    setSaving(false);

    if (!result.ok) {
      const fields = Object.fromEntries(Object.entries(result.fieldErrors ?? {}).map(([field, messages]) => [field, messages[0]])) as Partial<Record<Fields, string>>;
      setErrors(fields);
      // So o aceite na tela (os termos mudaram): um erro de outro campo vira a frase geral, nunca some.
      const shownField = onlyTerms ? Boolean(fields.termos) : Object.keys(fields).length > 0;
      setFailure(shownField ? null : result.error);
      return;
    }

    setErrors({});
    router.refresh();
  }

  const field = (name: Exclude<Fields, "termos">, label: string, props: { autoComplete: string; hint?: string; inputMode?: "email" | "text"; type?: string }) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="text-sm font-semibold text-white" htmlFor={`titular-${name}`}>
        {label}
      </label>
      <input
        aria-describedby={[props.hint ? `titular-${name}-dica` : null, errors[name] ? `titular-${name}-erro` : null].filter(Boolean).join(" ") || undefined}
        aria-invalid={errors[name] ? true : undefined}
        autoComplete={props.autoComplete}
        className={inputClassName}
        id={`titular-${name}`}
        inputMode={props.inputMode}
        name={name}
        required
        type={props.type ?? "text"}
      />
      {props.hint ? (
        <p className="text-[13px] leading-5 text-zinc-500" id={`titular-${name}-dica`}>
          {props.hint}
        </p>
      ) : null}
      {errors[name] ? (
        <p className="text-[13px] leading-5 text-red-300" id={`titular-${name}-erro`}>
          {errors[name]}
        </p>
      ) : null}
    </div>
  );

  return (
    <form className="flex min-w-0 flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      {onlyTerms ? null : (
        <>
          {field("nome", "Nome completo ou razão social", { autoComplete: "name", hint: "Quem é dono da Licença. Aparece no admin da escola instalada." })}
          {field("documento", "CPF ou CNPJ", { autoComplete: "off", inputMode: "text" })}
          {field("email2", "Segundo e-mail de contato", {
            autoComplete: "email",
            hint: `Diferente de ${accountEmail}. Avisamos os dois sobre a Licença (vencimento, renovação).`,
            inputMode: "email",
            type: "email"
          })}
        </>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-semibold text-white">{terms.title}</p>
        <div className="max-h-56 overflow-y-auto rounded-[10px] border border-white/10 bg-black/25 p-4 text-[13px] leading-6 text-zinc-300" tabIndex={0}>
          {terms.paragraphs.map((paragraph) => (
            <p className="mb-2 last:mb-0" key={paragraph}>
              {paragraph}
            </p>
          ))}
          <p className="mt-3 text-xs text-zinc-500">{`Versão ${terms.version}`}</p>
        </div>
        <label className="flex items-start gap-3 text-sm leading-6 text-zinc-200">
          <input aria-describedby={errors.termos ? "titular-termos-erro" : undefined} aria-invalid={errors.termos ? true : undefined} className="mt-1 size-4 shrink-0 accent-white" name="termos" type="checkbox" />
          Li e aceito os termos de uso da Licença.
        </label>
        {errors.termos ? (
          <p className="text-[13px] leading-5 text-red-300" id="titular-termos-erro">
            {errors.termos}
          </p>
        ) : null}
      </div>

      {failure ? (
        <p className="text-sm leading-6 text-red-300" role="alert">
          {failure}
        </p>
      ) : null}

      <div>
        <button className={memberButtonClassName({ variant: "primary" })} disabled={saving} type="submit">
          {saving ? "Salvando…" : onlyTerms ? "Aceitar os termos" : "Salvar e continuar"}
        </button>
      </div>
    </form>
  );
}
