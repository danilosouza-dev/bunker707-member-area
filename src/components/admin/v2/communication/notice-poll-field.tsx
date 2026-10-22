"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { POLL_LIMITS, type PollDefinition } from "@/server/communications/interactions-model";
import { PillGroup } from "../form";
import { HeroTextField } from "../member-area/home-hero/fields";
import { AdminSwitch } from "../settings/kit";
import { DateTimeField } from "./notice-when-fields";
import {
  POLL_END_OPTIONS,
  POLL_FIELD_COPY,
  addPollOption,
  canAddPollOption,
  canRemovePollOption,
  defaultPollClosesAt,
  pollEndMode,
  pollOptionFieldLabel,
  removePollOption,
  removePollOptionLabel,
  setPollOptionLabel,
  type PollEndMode
} from "./notices-view-model";

// Campos da enquete de uma notificacao (docs/24 §2.5), dentro de "Interação": pergunta, de 2 a 6 opcoes
// (cada uma com id proprio de 8 hexadecimais, fixo enquanto o rascunho e editado: o voto do aluno guarda o
// id), uma ou varias respostas, resultado para quem votar e quando encerra. No editor do aviso a enquete
// pode encerrar numa data (Sao Paulo); na folha da notificacao seguinte e no passo do fluxo
// (`canEndAtDate` false) ela so encerra quando a notificacao sai do sino (a hora de envio deles e relativa).
//
// Os erros vem de quem chama com as chaves do zod ("poll.question", "poll.options.2.label",
// "poll.closesAt"); `disabled` trava tudo (salvando, ou a notificacao ja enviada).

type NoticePollFieldProps = {
  /** false na folha da seguinte e no passo do fluxo: sem as pilulas "Encerra". */
  canEndAtDate: boolean;
  disabled: boolean;
  errorFor: (key: string) => string | undefined;
  /** Prefixo dos ids ("aviso" no editor: "aviso-enquete-pergunta", "aviso-enquete-opcao-1"...). */
  idPrefix: string;
  onBlurField: (key: string) => void;
  onChange: (poll: PollDefinition) => void;
  /** Hora do envio (agora ou a agendada): base da primeira data sugerida para o fim. */
  sendAt: number;
  value: PollDefinition;
};

const labelClass = "text-[13px] leading-5 font-medium text-[var(--text-primary)]";

export function NoticePollField({ canEndAtDate, disabled, errorFor, idPrefix, onBlurField, onChange, sendAt, value }: NoticePollFieldProps) {
  const id = (suffix: string) => `${idPrefix}-enquete-${suffix}`;
  // Data escolhida antes de voltar para "Quando sair do sino" (volta a ela ao escolher a data de novo).
  const rememberedClosesAt = useRef<string | null>(value.closesAt);
  // Depois de adicionar ou remover, o foco vai para o campo certo (o novo, ou o de cima do removido).
  const focusAfterRender = useRef<string | null>(null);
  const endMode = pollEndMode(value);
  const optionsError = errorFor("poll.options");

  useEffect(() => {
    const target = focusAfterRender.current;

    if (target) {
      focusAfterRender.current = null;
      document.getElementById(target)?.focus();
    }
  });

  function add() {
    const next = addPollOption(value);

    if (next !== value) {
      focusAfterRender.current = id(`opcao-${next.options.length}`);
      onChange(next);
    }
  }

  function remove(index: number) {
    const next = removePollOption(value, index);

    if (next !== value) {
      // O campo de cima do removido; "Adicionar opção" volta a aparecer, mas o foco fica no texto.
      focusAfterRender.current = id(`opcao-${index}`);
      onChange(next);
    }
  }

  function changeEnd(mode: PollEndMode) {
    if (mode === endMode) {
      return;
    }

    if (mode === "leave") {
      rememberedClosesAt.current = value.closesAt;
      onChange({ ...value, closesAt: null });
      return;
    }

    onChange({ ...value, closesAt: rememberedClosesAt.current || defaultPollClosesAt(sendAt, Date.now()) });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 border-l-2 border-[var(--border-subtle)] pl-4">
      <HeroTextField
        disabled={disabled}
        error={errorFor("poll.question")}
        id={id("pergunta")}
        label={POLL_FIELD_COPY.questionLabel}
        max={POLL_LIMITS.question}
        onBlur={() => onBlurField("poll.question")}
        onChange={(question) => onChange({ ...value, question })}
        placeholder={POLL_FIELD_COPY.questionPlaceholder}
        value={value.question}
      />

      <div className="flex min-w-0 flex-col gap-3">
        {value.options.map((option, index) => (
          // A chave e o id da opcao: remover uma do meio nao troca o texto das outras.
          <div className="relative min-w-0" key={option.id}>
            <HeroTextField
              disabled={disabled}
              error={errorFor(`poll.options.${index}.label`) ?? errorFor(`poll.options.${index}.id`) ?? errorFor(`poll.options.${index}`)}
              id={id(`opcao-${index + 1}`)}
              label={pollOptionFieldLabel(index)}
              max={POLL_LIMITS.option}
              onBlur={() => onBlurField(`poll.options.${index}.label`)}
              onChange={(label) => onChange(setPollOptionLabel(value, index, label))}
              value={option.label}
            />
            {canRemovePollOption(index) ? (
              // No lugar da chave "Mostrar" do HeroTextField: alinhado ao rotulo, 44 px de alvo.
              <Button
                aria-label={removePollOptionLabel(index)}
                className="absolute top-0 right-0 h-11 px-3 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                disabled={disabled}
                onClick={() => remove(index)}
                type="button"
                variant="ghost"
              >
                {POLL_FIELD_COPY.remove}
              </Button>
            ) : null}
          </div>
        ))}

        {optionsError ? <p className="text-[13px] leading-5 text-[var(--error)]">{optionsError}</p> : null}

        {canAddPollOption(value) ? (
          <Button className="min-h-11 self-start px-4" disabled={disabled} onClick={add} type="button" variant="secondary">
            <Plus aria-hidden="true" className="size-4" />
            {POLL_FIELD_COPY.addOption}
          </Button>
        ) : (
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{POLL_FIELD_COPY.maxOptions}</p>
        )}
      </div>

      <AdminSwitch
        checked={value.multiple}
        description={value.multiple ? POLL_FIELD_COPY.multipleOn : POLL_FIELD_COPY.multipleOff}
        disabled={disabled}
        id={id("varias")}
        label={POLL_FIELD_COPY.multipleLabel}
        onCheckedChange={(multiple) => onChange({ ...value, multiple })}
      />

      <AdminSwitch
        checked={value.showResults}
        description={value.showResults ? POLL_FIELD_COPY.resultsOn : POLL_FIELD_COPY.resultsOff}
        disabled={disabled}
        id={id("resultado")}
        label={POLL_FIELD_COPY.resultsLabel}
        onCheckedChange={(showResults) => onChange({ ...value, showResults })}
      />

      {canEndAtDate ? (
        <div className="flex min-w-0 flex-col gap-3">
          <span className={labelClass}>{POLL_FIELD_COPY.endLabel}</span>
          <PillGroup ariaLabel="Quando a enquete encerra" disabled={disabled} name={id("encerra")} onChange={changeEnd} options={POLL_END_OPTIONS} value={endMode} />
          {value.closesAt !== null ? (
            <>
              <DateTimeField
                disabled={disabled}
                error={errorFor("poll.closesAt")}
                idPrefix={id("fim")}
                label={POLL_FIELD_COPY.endDateLabel}
                onChange={(closesAt) => onChange({ ...value, closesAt })}
                value={value.closesAt}
              />
              <p className="-mt-1 text-xs leading-5 text-[var(--text-secondary)]">{POLL_FIELD_COPY.endHint}</p>
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{POLL_FIELD_COPY.openWhileInBell}</p>
          {errorFor("poll.closesAt") ? <p className="text-[13px] leading-5 text-[var(--error)]">{errorFor("poll.closesAt")}</p> : null}
        </div>
      )}
    </div>
  );
}
