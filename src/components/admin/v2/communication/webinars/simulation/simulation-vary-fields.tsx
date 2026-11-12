"use client";

import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { SIMULATION_LIMITS, type SimulatedCountVaryDirection } from "@/server/webinars/model";
import type { AudienceVaryForm, AudienceVaryResult } from "@/server/webinars/simulation-audience-model";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../../form";

// "Variar sozinho" (rodada v9, pedido do produtor de 12/11/2026; docs/30 D90): os campos da variacao dos participantes
// simulados, os mesmos no controle do console e do card Simulacao depois do comeco (simulation-audience-control.tsx) e
// no bloco "Participantes simulados" do card antes do comeco (simulation-rules-fields.tsx, no "Real + número fixo"). A
// caixa liga; ligada, aparecem "Até (%)", "Para onde varia" (Para mais e para menos, Só para mais, Só para menos) e "A
// cada, de ... até ... segundos", com a frase de exemplo feita dos numeros da tela ("Com +300 e 5%, o número fica entre
// 285 e 315."). So os campos: quem usa guarda o formulario (AudienceVaryForm), confere (audienceVaryOfForm) e monta o
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
        <div className="flex min-w-0 flex-col gap-3" data-simulation-vary-fields="">
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <AdminField error={errors.percent} id={percentId} label={COPY.ate}>
              {numberInput(percentId, form.percent, errors.percent, SIMULATION_LIMITS.varyPercentMin, SIMULATION_LIMITS.varyPercentMax, (percent) => patch({ percent }))}
            </AdminField>
            <AdminField error={errors.everyMin} id={minId} label={COPY.aCadaDe}>
              {numberInput(minId, form.everyMin, errors.everyMin, SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax, (everyMin) => patch({ everyMin }))}
            </AdminField>
            <AdminField error={errors.everyMax} id={maxId} label={COPY.aCadaAte}>
              {numberInput(maxId, form.everyMax, errors.everyMax, SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax, (everyMax) => patch({ everyMax }))}
            </AdminField>
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
