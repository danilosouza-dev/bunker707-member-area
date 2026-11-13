"use client";

import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { SIMULATION_LIMITS, type SimulatedCountVaryDirection } from "@/server/webinars/model";
import type { AudienceVaryForm, AudienceVaryResult } from "@/server/webinars/simulation-audience-model";
import { PillGroup, adminInputClass, fieldDescribedBy } from "../../../form";

// "Variar sozinho" (rodada v9, pedido do produtor de 12/11/2026; docs/30 D90): os campos da variacao dos participantes
// simulados, os mesmos no controle do console e do card Simulacao depois do comeco (simulation-audience-control.tsx) e
// no bloco "Participantes simulados" do card antes do comeco (simulation-rules-fields.tsx, no "Real + número fixo"). A
// caixa liga; ligada, uma linha por regra, com o nome a esquerda e o campo a direita (o teste do produtor de 12/11/2026
// achou os tres campos lado a lado desalinhados no painel estreito, docs/30 D92): "Varia até (%)", "Muda a cada
// (segundos)" com os dois numeros ("20 a 60") e "Para onde varia" (Para mais e para menos, Só para mais, Só para
// menos), com a frase de exemplo feita dos numeros da tela ("Com +300 e 5%, o número fica entre 285 e 315."). So os campos: quem usa guarda o formulario (AudienceVaryForm), confere (audienceVaryOfForm) e monta o
// exemplo (audienceVaryExample). Nenhuma frase escrita aqui.

const COPY = WEBINAR_COPY.simulacao.plateia.variar;

const DIRECTIONS: { label: string; value: SimulatedCountVaryDirection }[] = [
  { label: COPY.direcoes.both, value: "both" },
  { label: COPY.direcoes.up, value: "up" },
  { label: COPY.direcoes.down, value: "down" }
];

export type SimulationVaryFieldsProps = {
  disabled: boolean;
  errors: AudienceVaryResult["errors"];
  /** A frase de exemplo com os numeros da tela (audienceVaryExample); nula com erro nos campos. */
  example: string | null;
  form: AudienceVaryForm;
  /** O prefixo dos ids (o console e cada sessao do card). */
  idBase: string;
  onChange: (next: AudienceVaryForm) => void;
};

export function SimulationVaryFields({ disabled, errors, example, form, idBase, onChange }: SimulationVaryFieldsProps) {
  const toggleId = `${idBase}-variar`;
  const percentId = `${idBase}-variar-percentual`;
  const minId = `${idBase}-variar-de`;
  const maxId = `${idBase}-variar-ate`;
  const patch = (next: Partial<AudienceVaryForm>) => onChange({ ...form, ...next });
  const numberInput = (id: string, value: string, error: string | undefined, min: number, max: number, onValue: (value: string) => void) => (
    <input
      aria-describedby={fieldDescribedBy(id, { error })}
      aria-invalid={error ? true : undefined}
      className={cn(adminInputClass, "w-full")}
      disabled={disabled}
      id={id}
      inputMode="numeric"
      max={max}
      min={min}
      onChange={(event) => onValue(event.target.value)}
      step={1}
      type="number"
      value={value}
    />
  );

  const errorLine = (id: string, error: string | undefined) =>
    error ? (
      <p className="text-[13px] leading-5 text-[var(--error)]" id={`${id}-error`}>
        {error}
      </p>
    ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border-subtle)] p-3" data-simulation-vary={form.on ? "on" : "off"}>
      <label className="flex min-w-0 cursor-pointer items-start gap-2 text-[13px] leading-5 text-[var(--text-primary)]" htmlFor={toggleId}>
        <input
          checked={form.on}
          className="mt-0.5 size-4 shrink-0 accent-[var(--text-primary)]"
          data-simulation-vary-toggle=""
          disabled={disabled}
          id={toggleId}
          onChange={(event) => patch({ on: event.target.checked })}
          type="checkbox"
        />
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{COPY.titulo}</span>
          <span className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.dica}</span>
        </span>
      </label>

      {form.on ? (
        // Uma linha por regra, o nome a esquerda e o campo a direita, sempre na mesma coluna: nada desalinha quando o
        // painel e estreito (o rotulo quebra, o campo fica no lugar).
        <div className="flex min-w-0 flex-col gap-3" data-simulation-vary-fields="">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <label className="min-w-0 text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={percentId}>
                {COPY.ate}
              </label>
              <div className="w-20 shrink-0">
                {numberInput(percentId, form.percent, errors.percent, SIMULATION_LIMITS.varyPercentMin, SIMULATION_LIMITS.varyPercentMax, (percent) => patch({ percent }))}
              </div>
            </div>
            {errorLine(percentId, errors.percent)}
          </div>
          <div aria-labelledby={`${idBase}-variar-a-cada`} className="flex min-w-0 flex-col gap-1" role="group">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="min-w-0 text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${idBase}-variar-a-cada`}>
                {COPY.aCada}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <label className="sr-only" htmlFor={minId}>
                  {COPY.aCadaDe}
                </label>
                <div className="w-20">
                  {numberInput(minId, form.everyMin, errors.everyMin, SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax, (everyMin) => patch({ everyMin }))}
                </div>
                <span aria-hidden="true" className="text-[13px] leading-5 text-[var(--text-secondary)]">
                  {COPY.aCadaEntre}
                </span>
                <label className="sr-only" htmlFor={maxId}>
                  {COPY.aCadaAte}
                </label>
                <div className="w-20">
                  {numberInput(maxId, form.everyMax, errors.everyMax, SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax, (everyMax) => patch({ everyMax }))}
                </div>
              </div>
            </div>
            {errorLine(minId, errors.everyMin)}
            {errorLine(maxId, errors.everyMax)}
          </div>
          <PillGroup ariaLabel={COPY.direcao} disabled={disabled} name={`${idBase}-variar-direcao`} onChange={(direction) => patch({ direction })} options={DIRECTIONS} value={form.direction} />
          {example ? (
            <p aria-live="polite" className="text-xs leading-5 text-[var(--text-secondary)]" data-simulation-vary-example="">
              {example}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
