"use client";

import { Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import {
  AUDIENCE_MIGRATION,
  AUDIENCE_SHORTCUTS,
  audienceChangeValue,
  audienceChangeWhen,
  audienceCurrentLabel,
  audienceFormState,
  audienceVaryExample,
  audienceVaryFormOf,
  audienceVaryLabel,
  type AudiencePhase,
  type AudienceVaryForm,
  type SimulationAudienceView
} from "@/server/webinars/simulation-audience-model";
import type { SimulatedCountVary } from "@/server/webinars/model";
import { adminInputClass } from "../../../form";
import { SimulationVaryFields } from "./simulation-vary-fields";

// O controle "Participantes simulados" (docs/30 D79; pedido do produtor de 11/11/2026: "Quantos eu queria aumentar e
// tudo mais"), o mesmo no console da sessao (no alto da entrada Presença, aberto tambem pelo selo dos presentes) e no
// card Simulacao do editor depois do comeco: o numero somado agora ("+300"), a sala chegando nele durante a rampa de
// 90 s, quem mudou por ultimo e quando, o campo "Somar à plateia" com os atalhos (+50, +100, +300, +500: o campo fica
// com o numero), o Aplicar direto e o Tirar (volta a +0). Sem frase nem caixa desde 12/11/2026 (decisao do produtor,
// docs/30 D86): o servidor grava sozinho a frase da mudanca no registro (quem, quando e o numero). Sem permissao
// (messaging.publish), com a sessao encerrada ou sem a 202611140002, o numero sem os botoes e a frase do motivo. As
// mudancas ficam num <details> com a hora, o +N e quem. O link leva ao outro lado (o console leva ao card do editor; o
// card, ao console). Quem usa faz o pedido (`onApply`) e diz se deu certo (o formulario volta ao vazio). Nenhuma frase
// escrita aqui; as cores pelos tokens do admin, como o resto do painel do console.
// "Variar sozinho" (rodada v9, pedido do produtor de 12/11/2026; docs/30 D90): debaixo do campo, a caixa que liga a
// variacao (ate X %, para onde, a cada Y a Z segundos) com a frase de exemplo; o pedido leva o +N e a variacao. Com o
// campo do numero vazio, o Aplicar vale para o numero de agora (ligar, mudar ou desligar a variacao sem digitar de
// novo). Debaixo do numero de agora, a variacao que vale em uma frase; nas mudancas, "+300, varia até 5%".

const COPY = WEBINAR_COPY.simulacao.plateia;

export type SimulationAudienceControlProps = {
  audience: SimulationAudienceView;
  /** Outra acao em andamento (o console) ou este pedido a caminho. */
  busy: boolean;
  canPublish: boolean;
  /** O prefixo dos ids (o console e cada sessao do card). */
  idBase: string;
  /** O atalho para o outro lado: o card do editor (no console) ou o console (no card). */
  link?: { href: string; label: string } | null;
  /** O relogio da Simulacao agora (simulationClockMs): a rampa em curso. */
  offsetMs: number;
  /** O pedido: o +N (0 no Tirar) e o "Variar sozinho" (nulo: o numero parado). Devolve se deu certo. */
  onApply: (input: { extra: number; vary: SimulatedCountVary | null }) => Promise<boolean>;
  phase: AudiencePhase;
  /** O id do titulo (o selo dos presentes leva o foco a ele). */
  titleId?: string;
};

export function SimulationAudienceControl(props: SimulationAudienceControlProps) {
  const { audience, idBase } = props;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Os campos do "Variar sozinho" comecam no que vale agora (a tela aberta depois de outra pessoa mudar ja mostra).
  const [vary, setVary] = useState<AudienceVaryForm>(() => audienceVaryFormOf(audience.current.vary));
  const busy = props.busy || sending;
  const state = audienceFormState({
    busy,
    canPublish: props.canPublish,
    current: audience.current,
    pendingMigration: audience.pendingMigration,
    phase: props.phase,
    text,
    vary
  });
  const currentVary = audienceVaryLabel(audience.current.mode === "fixed" ? audience.current.vary : null);
  const titleId = props.titleId ?? `${idBase}-titulo`;
  const fieldId = `${idBase}-somar`;
  const last = audience.changes[0] ?? null;
  const target = audienceCurrentLabel(audience.current);
  const ramping = props.phase === "on_air" && audience.rampEndsAtMs !== null && Number.isFinite(props.offsetMs) && props.offsetMs < audience.rampEndsAtMs;
  const reason = props.phase === "ended" ? COPY.encerrada : !props.canPublish ? COPY.semPermissao : audience.pendingMigration ? WEBINAR_COPY.simulacao.servidor.precisaMigracaoPlateia(AUDIENCE_MIGRATION) : null;

  const edit = (next: string) => setText(next);

  async function apply(extra: number, nextVary: SimulatedCountVary | null) {
    setSending(true);
    const ok = await props.onApply({ extra, vary: extra > 0 ? nextVary : null });
    setSending(false);
    if (ok) {
      setText("");
      // O Tirar desliga a variacao junto (ela so vale com numero maior que zero).
      if (!(extra > 0)) {
        setVary((current) => ({ ...current, on: false }));
      }
    }
  }

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-3" data-simulation-audience="">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-[13px] leading-5 font-semibold text-[var(--text-primary)] outline-none" id={titleId} tabIndex={-1}>
            {COPY.titulo}
          </h3>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.descricao}</p>
        </div>
        {props.link ? (
          <Link className="shrink-0 text-[13px] leading-5 font-medium text-[var(--text-primary)] underline underline-offset-2" data-simulation-audience-link="" href={props.link.href}>
            {props.link.label}
          </Link>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <dl className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs leading-4 text-[var(--text-tertiary)]">{COPY.agora}</dt>
          <dd className="text-2xl leading-8 font-semibold text-[var(--text-primary)] tabular-nums" data-simulation-audience-now="">
            {target}
          </dd>
        </dl>
        {!reason && state.canRemove ? (
          <Button
            aria-label={COPY.tirarRotulo}
            className="px-3"
            data-simulation-audience-remove=""
            disabled={busy}
            onClick={() => void apply(0, null)}
            type="button"
            variant="secondary"
          >
            <Undo2 aria-hidden="true" className="size-4" />
            {COPY.tirar}
          </Button>
        ) : null}
      </div>

      {currentVary ? (
        <p className="text-xs leading-5 text-[var(--text-secondary)]" data-simulation-audience-vary="">
          {currentVary}
        </p>
      ) : null}
      {ramping ? (
        <p aria-live="polite" className="text-xs leading-5 text-[var(--text-secondary)]" data-simulation-audience-ramp="">
          {COPY.subindo(audience.current.mode === "fixed" ? audience.current.base : 0)}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-[var(--text-secondary)]" data-simulation-audience-last="">
        {last ? COPY.ultima(last.changedByName, formatSaoPauloDateTime(last.changedAt), COPY.origens[last.source]) : COPY.semMudanca}
      </p>

      {reason ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-simulation-audience-reason="">
          {reason}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3" data-simulation-audience-form="">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={fieldId}>
              {COPY.campo}
            </label>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <input
                aria-describedby={state.error ? `${fieldId}-error` : `${fieldId}-hint`}
                aria-invalid={state.error ? true : undefined}
                className={cn(adminInputClass, "w-32")}
                disabled={busy}
                id={fieldId}
                inputMode="numeric"
                min={0}
                onChange={(event) => edit(event.target.value)}
                placeholder="300"
                step={1}
                type="number"
                value={text}
              />
              <div aria-label={COPY.atalhos} className="flex min-w-0 flex-wrap items-center gap-1.5" role="group">
                {AUDIENCE_SHORTCUTS.map((value) => (
                  <Button
                    aria-label={COPY.atalhoRotulo(value)}
                    aria-pressed={state.extra === value}
                    className="h-8! px-2.5 text-[13px] tabular-nums"
                    data-simulation-audience-shortcut={value}
                    disabled={busy}
                    key={value}
                    onClick={() => edit(String(value))}
                    type="button"
                    variant="secondary"
                  >
                    {COPY.valor(value)}
                  </Button>
                ))}
              </div>
            </div>
            {state.error ? (
              <p className="text-xs leading-5 text-[var(--error)]" id={`${fieldId}-error`}>
                {state.error}
              </p>
            ) : state.same ? (
              <p className="text-xs leading-5 text-[var(--text-secondary)]" id={`${fieldId}-hint`}>
                {state.vary ? COPY.variar.igual : COPY.igual}
              </p>
            ) : (
              <p className="text-xs leading-5 text-[var(--text-secondary)]" id={`${fieldId}-hint`}>
                {COPY.campoDica}
              </p>
            )}
          </div>

          <SimulationVaryFields
            disabled={busy}
            errors={state.varyErrors}
            example={audienceVaryExample(state.applyExtra, vary)}
            form={vary}
            idBase={idBase}
            onChange={setVary}
          />

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              className="px-4"
              data-simulation-audience-apply=""
              disabled={!state.canApply}
              onClick={() => {
                if (state.applyExtra !== null) {
                  void apply(state.applyExtra, state.vary);
                }
              }}
              type="button"
            >
              {sending ? COPY.aplicando : COPY.aplicar}
            </Button>
          </div>
          <p className="text-xs leading-5 text-[var(--text-tertiary)]">{props.phase === "before" ? COPY.antesDoComeco : COPY.noAr}</p>
        </div>
      )}

      {audience.changes.length > 0 ? (
        <details className="min-w-0 text-xs leading-5 text-[var(--text-secondary)]" data-simulation-audience-history="">
          <summary className="cursor-pointer font-medium text-[var(--text-primary)]">{`${COPY.historico} (${audience.changes.length})`}</summary>
          <ul className="mt-1 flex min-w-0 flex-col gap-0.5">
            {audience.changes.map((change) => (
              <li className="tabular-nums" key={change.id}>
                {COPY.mudancaLinha(audienceChangeWhen(change.atMs), audienceChangeValue(change), change.changedByName)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
