"use client";

import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { pollDraftSchema, type ConsolePollLaunch } from "@/server/webinars/chat-schemas";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type PollKind } from "@/server/webinars/model";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../../form";
import { SectionCard } from "../../../settings/kit";
import { returnConsoleFocus } from "./console-focus";

// A "Nova enquete" da entrada Enquetes do console (D83; pedido do produtor de 11/11/2026, na Live ao vivo e na gravada),
// no lugar da lista, com o Voltar, no padrao do "Novo comentário" (console-script-comment.tsx): ao abrir, o foco vai ao
// titulo do formulario; ao fechar, quem abriu (console-polls.tsx) devolve o foco ao "Nova enquete". Os campos do card
// Enquetes do editor (o PollDraft, sem anonimato desde o D64): a Pergunta, o Tipo e as Opções (de 2 a 20, com
// Adicionar opção e o remover de cada uma). A conferencia e o mesmo zod do servidor (pollDraftSchema), mostrada depois da
// primeira tentativa, com o erro de cada campo (a chave e o caminho do zod: "question", "options", "options.1.label"),
// junto dos erros que o servidor devolve nos mesmos caminhos. Os botoes: "Abrir agora" e "Abrir e fixar" so com a
// sessao aceitando a equipe (`canOpen`, o mesmo canAct das prontas), "Guardar nas prontas" sempre e Cancelar. Toda
// enquete criada aqui entra nas prontas do webinario (createConsolePoll). Nenhuma frase escrita aqui.

const copy = WEBINAR_ADMIN_COPY.console.polls.create;
const pollsCopy = WEBINAR_ADMIN_COPY.polls;
const pinCopy = WEBINAR_COPY.naTela.enquetes;

const KIND_OPTIONS: readonly { label: string; value: PollKind }[] = [
  { label: pollsCopy.kinds.single, value: "single" },
  { label: pollsCopy.kinds.multiple, value: "multiple" },
  { label: pollsCopy.kinds.survey, value: "survey" }
];

/** Uma opcao no formulario: a chave so serve ao React (adicionar e remover sem trocar o que foi escrito). */
export type ConsolePollOption = { key: string; label: string };

export type ConsolePollFormState = { kind: PollKind; options: ConsolePollOption[]; question: string };

/** O que os botoes mandam (sem a sessao e sem o que fazer depois, que o console poe). */
export type ConsolePollFormInput = { kind: PollKind; options: { label: string }[]; question: string };

let optionCounter = 0;

function optionKey() {
  optionCounter += 1;
  return `opcao-${optionCounter}`;
}

/** O formulario novo: Uma opção, duas opcoes vazias (o minimo) e a pergunta vazia. */
export function emptyConsolePoll(): ConsolePollFormState {
  return { kind: "single", options: Array.from({ length: CHAT_LIMITS.pollOptionsMin }, () => ({ key: optionKey(), label: "" })), question: "" };
}

/** Uma opcao vazia no fim, ate o maximo; no maximo, nada muda. */
export function withNewOption(state: ConsolePollFormState): ConsolePollFormState {
  return state.options.length >= CHAT_LIMITS.pollOptionsMax ? state : { ...state, options: [...state.options, { key: optionKey(), label: "" }] };
}

/** Tira a opcao, ate o minimo; no minimo, nada muda. */
export function withoutOption(state: ConsolePollFormState, key: string): ConsolePollFormState {
  return state.options.length <= CHAT_LIMITS.pollOptionsMin ? state : { ...state, options: state.options.filter((option) => option.key !== key) };
}

/** O que vai para a Server Action: a pergunta e as opcoes sem espacos nas pontas, na ordem. */
export function consolePollInput(state: ConsolePollFormState): ConsolePollFormInput {
  return { kind: state.kind, options: state.options.map((option) => ({ label: option.label.trim() })), question: state.question.trim() };
}

/** Os erros do formulario pelo mesmo zod do servidor (pollDraftSchema), o primeiro de cada caminho ("options.1.label"). */
export function consolePollErrors(state: ConsolePollFormState): Record<string, string> {
  const parsed = pollDraftSchema.safeParse(consolePollInput(state));
  const errors: Record<string, string> = {};

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.map((segment) => String(segment)).join(".") || "form";
      errors[key] ??= issue.message;
    }
  }

  return errors;
}

export type ConsolePollFormProps = {
  /** Uma acao da mesa em andamento: os botoes do rodape ficam desligados. */
  busy: boolean;
  /** A sessao aceita a equipe (canTeamActOn): so entao o "Abrir agora" e o "Abrir e fixar". */
  canOpen: boolean;
  /** O formulario ao abrir (o teste de tela). */
  initialState?: ConsolePollFormState;
  /** Tenta uma vez ao desenhar (o teste de tela dos erros depois da primeira tentativa). */
  initialTried?: boolean;
  onBack: () => void;
  /** "Abrir agora", "Abrir e fixar" ou "Guardar nas prontas"; devolve o resultado (nulo: outra acao em andamento). */
  onSubmit: (input: ConsolePollFormInput, launch: ConsolePollLaunch) => Promise<ActionResult<unknown> | null>;
};

export function ConsolePollForm({ busy, canOpen, initialState, initialTried = false, onBack, onSubmit }: ConsolePollFormProps) {
  const prefix = `console-poll-form-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<ConsolePollFormState>(() => initialState ?? emptyConsolePoll());
  const [tried, setTried] = useState(initialTried);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const localErrors = tried ? consolePollErrors(state) : {};
  const errorOf = (field: string) => serverErrors[field] ?? localErrors[field] ?? null;
  const titleId = `${prefix}-titulo`;

  // Ao abrir no lugar da lista, o foco vai para o titulo do formulario (o botao que abriu saiu da tela).
  useEffect(() => {
    returnConsoleFocus({ heading: titleId, opener: null });
  }, [titleId]);

  /** Uma mudanca: os erros do servidor do campo mudado saem (nas opcoes, todos os delas, porque a ordem pode mudar). */
  function change(next: ConsolePollFormState, fields: readonly ("kind" | "options" | "question")[]) {
    setState(next);
    setServerErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !fields.some((field) => key === field || key.startsWith(`${field}.`)))));
  }

  async function submit(launch: ConsolePollLaunch) {
    setTried(true);
    setFormError(null);
    if (Object.keys(consolePollErrors(state)).length > 0) {
      return;
    }
    const result = await onSubmit(consolePollInput(state), launch);
    if (!result) {
      return;
    }
    if (!result.ok) {
      const fields: Record<string, string> = {};
      for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) {
          fields[key] = messages[0];
        }
      }
      setServerErrors(fields);
      setFormError(Object.keys(fields).length > 0 ? null : result.error);
      return;
    }
    onBack();
  }

  const questionId = `${prefix}-pergunta`;
  const optionsLegendId = `${prefix}-opcoes`;
  const questionError = errorOf("question");
  const optionsError = errorOf("options");
  const kindError = errorOf("kind");

  return (
    <SectionCard
      actions={
        <Button className="h-8! px-2 text-[13px]" data-console-poll-back="" onClick={onBack} type="button" variant="ghost">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {copy.voltar}
        </Button>
      }
      description={copy.dica}
      title={copy.novaEnquete}
      titleFocusable
      titleId={titleId}
    >
      <form className="flex min-w-0 flex-col gap-4" data-console-poll-form="" noValidate onSubmit={(event) => event.preventDefault()}>
        <AdminField error={questionError} id={questionId} label={pollsCopy.question}>
          <input
            aria-describedby={fieldDescribedBy(questionId, { error: questionError })}
            aria-invalid={questionError ? true : undefined}
            className={adminInputClass}
            id={questionId}
            maxLength={CHAT_LIMITS.pollQuestion}
            onChange={(event) => change({ ...state, question: event.target.value }, ["question"])}
            type="text"
            value={state.question}
          />
        </AdminField>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{pollsCopy.kind}</span>
          <PillGroup
            ariaLabel={pollsCopy.kind}
            disabled={busy}
            name={`${prefix}-tipo`}
            onChange={(kind: PollKind) => change({ ...state, kind }, ["kind"])}
            options={KIND_OPTIONS}
            value={state.kind}
          />
          {kindError ? (
            <p className="text-[13px] leading-5 text-[var(--error)]" role="alert">
              {kindError}
            </p>
          ) : null}
        </div>
        <fieldset aria-describedby={optionsError ? `${optionsLegendId}-error` : undefined} className="flex min-w-0 flex-col gap-2 border-0 p-0" data-console-poll-options="">
          <legend className="mb-1 text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={optionsLegendId}>
            {pollsCopy.options}
          </legend>
          {state.options.map((option, index) => {
            const optionId = `${prefix}-opcao-${index + 1}`;
            const optionError = errorOf(`options.${index}.label`);

            return (
              <div className="flex min-w-0 flex-col gap-1" data-console-poll-option={index + 1} key={option.key}>
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    aria-describedby={fieldDescribedBy(optionId, { error: optionError })}
                    aria-invalid={optionError ? true : undefined}
                    aria-label={pollsCopy.optionPlaceholder(index + 1)}
                    className={cn(adminInputClass, "flex-1")}
                    id={optionId}
                    maxLength={CHAT_LIMITS.pollOption}
                    onChange={(event) => change({ ...state, options: state.options.map((item) => (item.key === option.key ? { ...item, label: event.target.value } : item)) }, ["options"])}
                    placeholder={pollsCopy.optionPlaceholder(index + 1)}
                    type="text"
                    value={option.label}
                  />
                  <Button
                    aria-label={`${pollsCopy.removeOption} ${index + 1}`}
                    className="px-2 text-[var(--text-secondary)]"
                    disabled={state.options.length <= CHAT_LIMITS.pollOptionsMin}
                    onClick={() => change(withoutOption(state, option.key), ["options"])}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
                {optionError ? (
                  <p className="text-[13px] leading-5 text-[var(--error)]" id={`${optionId}-error`}>
                    {optionError}
                  </p>
                ) : null}
              </div>
            );
          })}
          {optionsError ? (
            <p className="text-[13px] leading-5 text-[var(--error)]" id={`${optionsLegendId}-error`}>
              {optionsError}
            </p>
          ) : null}
          <div>
            <Button className="px-3" data-console-poll-add-option="" disabled={state.options.length >= CHAT_LIMITS.pollOptionsMax} onClick={() => change(withNewOption(state), ["options"])} type="button" variant="ghost">
              <Plus aria-hidden="true" className="size-4" />
              {pollsCopy.addOption}
            </Button>
          </div>
        </fieldset>
        {formError ? (
          <p className="text-[13px] leading-5 text-[var(--error)]" data-console-poll-form-error="" role="alert">
            {formError}
          </p>
        ) : null}
        {canOpen ? null : <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.soGuardar}</p>}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {canOpen ? (
            <>
              <Button className="px-3" data-console-poll-submit="open" disabled={busy} onClick={() => void submit("open")} type="button">
                {copy.abrirAgora}
              </Button>
              <Button className="px-3" data-console-poll-submit="pin" disabled={busy} onClick={() => void submit("pin")} type="button" variant="secondary">
                {pinCopy.abrirEFixar}
              </Button>
            </>
          ) : null}
          <Button className="px-3" data-console-poll-submit="save" disabled={busy} onClick={() => void submit("save")} type="button" variant="secondary">
            {copy.guardar}
          </Button>
          <Button className="px-3 text-[var(--text-secondary)]" onClick={onBack} type="button" variant="ghost">
            {copy.cancelar}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
