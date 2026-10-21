"use client";

import { AlertCircle, ExternalLink, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listNoticeSenders } from "@/server/communications/actions";
import { isDefaultSchoolIcon } from "@/server/communications/message-meta";
import type { NoticeSender } from "@/server/communications/schemas";
import { adminTransition } from "../styles";
import {
  SCHOOL_SENDER_VALUE,
  noticeSenderHint,
  noticeSenderOptions,
  type NoticeSenderChoice,
  type NoticeSenderOption
} from "./notices-view-model";

// "Quem envia" da notificacao (docs/23; docs/22 §2.2): a escola (padrao, com o icone da escola), "Eu" ou
// outra pessoa da equipe, cada opcao com o circulo que o aluno ve. So a equipe (admin_roles) aparece; o
// servidor confere de novo ao salvar e ao publicar. Uma dica por vez embaixo (notices-view-model.ts):
// sem foto, o link para Perfil abre em outra aba e, enquanto essa dica esta na tela, a equipe e relida
// quando a janela volta ao foco (a foto nova aparece sem recarregar).

type NoticeSenderFieldProps = {
  /** Quem esta com o editor aberto pode trocar o icone em Marca (storefront.write). */
  canEditBrand: boolean;
  disabled: boolean;
  error?: string;
  /** id do seletor (foco do erro). */
  id: string;
  onChange: (sender: NoticeSender) => void;
  /** Equipe relida (foto nova em Perfil). */
  onSendersChange?: (senders: NoticeSenderChoice[]) => void;
  /** Quem estava gravado (para o nome de quem saiu da equipe). */
  saved?: { id: string; name: string } | null;
  schoolIconUrl: string;
  schoolName: string;
  senders: readonly NoticeSenderChoice[];
  value: NoticeSender;
};

const triggerClass = cn(
  "h-11 w-full min-w-0 rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-2 text-sm text-[var(--text-primary)] hover:border-[var(--text-tertiary)] data-[size=default]:h-11",
  adminTransition
);
const contentClass = "max-h-80 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0";

/** O circulo que o aluno ve: o icone da escola (o simbolo padrao centralizado) ou a pessoa. */
function SenderAvatar({ option }: { option: NoticeSenderOption }) {
  if (option.isSchool) {
    const src = option.avatarUrl;

    return (
      <span aria-hidden="true" className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-[#262626] ring-1 ring-white/10">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- icone de Marca (qualquer host), 28 px
          <img alt="" className={cn("size-full", isDefaultSchoolIcon(src) ? "object-contain p-1" : "object-cover")} src={src} />
        ) : null}
      </span>
    );
  }

  return <MemberAvatar imageSrc={option.avatarUrl} name={option.name} size="xs" />;
}

function OptionLabel({ option }: { option: NoticeSenderOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SenderAvatar option={option} />
      <span className="min-w-0 truncate">{option.label}</span>
    </span>
  );
}

export function NoticeSenderField({
  canEditBrand,
  disabled,
  error,
  id,
  onChange,
  onSendersChange,
  saved,
  schoolIconUrl,
  schoolName,
  senders,
  value
}: NoticeSenderFieldProps) {
  const options = noticeSenderOptions({ saved, schoolIconUrl, schoolName, senders });
  const hint = noticeSenderHint({ canEditBrand, saved, schoolName, sender: value, senders });
  const selected = value?.userId ?? SCHOOL_SENDER_VALUE;
  const reloading = useRef(false);
  const describedBy = error ? `${id}-error` : `${id}-hint`;

  // "Colocar a minha foto em Perfil" abre outra aba: ao voltar para esta, rele a equipe uma vez.
  useEffect(() => {
    if (!hint.watchesProfile || !onSendersChange) {
      return;
    }

    function handleFocus() {
      if (reloading.current) {
        return;
      }

      reloading.current = true;
      void listNoticeSenders()
        .then((result) => {
          if (result.ok) {
            onSendersChange?.(result.data);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          reloading.current = false;
        });
    }

    window.addEventListener("focus", handleFocus);

    return () => window.removeEventListener("focus", handleFocus);
  }, [hint.watchesProfile, onSendersChange]);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={id} id={`${id}-label`}>
        Quem envia
      </label>
      <Select
        disabled={disabled}
        items={options.map((option) => ({ label: option.label, value: option.value }))}
        onValueChange={(next) => onChange(!next || next === SCHOOL_SENDER_VALUE ? null : { userId: String(next) })}
        value={selected}
      >
        <SelectTrigger aria-describedby={describedBy} aria-invalid={error ? true : undefined} aria-labelledby={`${id}-label`} className={triggerClass} id={id}>
          <SelectValue className="min-w-0">
            {(current: string | null) => {
              const option = options.find((item) => item.value === current) ?? options[0];

              return <OptionLabel option={option} />;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className={contentClass}>
          {options.map((option) => (
            // O texto da opcao encolhe (nome comprido termina em "…" dentro da lista); 44 px no toque.
            <SelectItem className="min-h-10 pointer-coarse:min-h-11 [&>*:first-child]:min-w-0 [&>*:first-child]:shrink" key={option.value} value={option.value}>
              <OptionLabel option={option} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${id}-error`}>
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : (
        <p
          className={cn("flex items-start gap-1.5 text-xs leading-5", hint.tone === "warning" ? "text-[var(--warning)]" : "text-[var(--text-secondary)]")}
          id={`${id}-hint`}
        >
          {hint.tone === "warning" ? <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : null}
          <span className="min-w-0">
            {hint.text}
            {hint.link ? (
              <>
                {" "}
                <a
                  className="inline-flex items-center gap-1 font-medium text-[var(--text-primary)] underline underline-offset-2 hover:no-underline"
                  href={hint.link.href}
                  rel={hint.link.newTab ? "noopener" : undefined}
                  target={hint.link.newTab ? "_blank" : undefined}
                >
                  {hint.link.label}
                  {hint.link.newTab ? (
                    <>
                      <ExternalLink aria-hidden="true" className="size-3" />
                      <span className="sr-only"> (abre em outra aba)</span>
                    </>
                  ) : null}
                </a>
              </>
            ) : null}
          </span>
        </p>
      )}
    </div>
  );
}
