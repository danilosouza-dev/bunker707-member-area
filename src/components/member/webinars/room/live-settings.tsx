"use client";

import { ImagePlus, Moon, Sun, X } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { UseJitsiDevices } from "@/components/webinars/use-jitsi-devices";
import type { DeviceKind, DeviceOption, DeviceSettings, ReceiveQuality } from "@/lib/jitsi-device-settings";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomTheme } from "@/lib/webinar-room-prefs";
import { LIVE_ROOM_COPY } from "./live-room-model";

// O painel Configurações da sala ao vivo (docs/30 §1.3, §8.5, §9 e D4), aberto pelo botao Configurações da nossa barra
// (live-controls.tsx), no lugar do antigo "Como usar": Som (a faixa de volume; no iPhone some, o botao Som da barra
// continua cortando e voltando), Alto-falante (so quando o navegador deixa trocar e ha duas saidas com nome; antes da
// permissao, a frase de quando aparece), Microfone (a escolha e Reduzir ruído so depois de o apresentador liberar e do
// Falar; antes, a frase), Câmera (a escolha, Espelhar a minha imagem e, fora do celular e com a camera ligada, Desfocar
// o fundo, so depois do aviso de gravacao da camera aceito; com a camera dos alunos desligada no webinario, so essa
// frase), Qualidade do vídeo (Automática ou Economizar dados) e os atalhos do teclado. Depois do Falar ou do aviso
// aceito, com o navegador ainda sem a permissao (o pedido aberto, fechado no X ou bloqueado: a lista vem sem id), a
// secao mostra a frase de liberar o acesso, nunca "nenhum aparelho" nem Reduzir ruído / Espelhar. As secoes vem de
// deviceSettingsFor (src/lib/jitsi-device-settings.ts); quem troca o aparelho e o hook useJitsiDevices, pela sala. A
// caixa Espelhar so aparece depois de ler o espelho guardado na pagina (o iframe guarda o dele e a api nao deixa ler).
// Fechar (no topo) devolve o foco ao botao Configurações. Um controle que some com o foco nele (a secao vira a frase:
// a equipe silenciou, a camera fechou, a queda, um fone desplugado) leva o foco para o Fechar, nunca para o body, onde
// a sala deixaria de ouvir o Esc, os atalhos e a trava do Tab (panelFocusLost). Quem apresenta por esta pagina (sem a nossa barra de midia)
// tem a barra do iframe, que tambem muda ruido, fundo e espelho: para ele, as mesmas acoes sem estado do card do console
// (Ligar / Desligar a redução de ruído, Inverter a minha imagem, Desfocar o fundo / Tirar o efeito do fundo). Os campos tem 44 px; o nome de cada lista e o titulo da secao;
// o painel encolhe e rola por dentro numa coluna curta; nada aqui fala com a rede e nenhuma frase e escrita direto.
// Redesign V2, F2 (docs/31 V2-11): as cores vem dos tokens do tema da sala. F3 (V2-12 e V2-18): abaixo de sm o botao
// de tema sai do cabecalho (nao ha largura) e a linha Tema entra no topo do painel, com o mesmo nome do botao ("Tema
// claro" no escuro, "Tema escuro" no claro); a partir de sm ela some, porque o cabecalho tem o botao.

/** O que o painel le e chama do useJitsiDevices (os testes passam um objeto com o mesmo formato). */
export type LiveSettingsDevices = Pick<
  UseJitsiDevices,
  "blur" | "current" | "espelhar" | "fundo" | "lists" | "maisFundos" | "mirror" | "noise" | "qualidade" | "quality" | "ruido" | "volume" | "volumePercent"
>;

export type LiveSettingsProps = {
  /** A propria camera no ar: quem apresenta com a camera nunca ligada ve a frase de liga-la no lugar da lista vazia. */
  cameraOn?: boolean;
  devices: LiveSettingsDevices;
  /** Troca o aparelho (a sala confere a secao de novo antes do set*Device). */
  onChoose: (kind: DeviceKind, option: DeviceOption) => void;
  /** Fechar: o painel fecha e o foco volta ao botao Configurações da barra. */
  onClose?: () => void;
  /** A sala ao vivo: troca o tema (com `theme`, a linha Tema aparece abaixo de sm). */
  onToggleTheme?: () => void;
  sections: DeviceSettings;
  /** Aluno e Equipe: o atalho da mao e os efeitos com estado (host e co-apresentador usam a barra do iframe). */
  showMedia: boolean;
  /** O tema da sala agora (a linha Tema diz para qual vai). */
  theme?: RoomTheme;
};

const NOTE = "text-xs leading-5 text-room-fg-subtle";
const ROW = "flex min-h-11 cursor-pointer items-center gap-3 text-sm text-room-fg";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus";
/** O botao sem estado do painel (Fechar e as acoes de quem apresenta): o circulo inativo da barra. */
const PANEL_BUTTON = "inline-flex h-11 items-center gap-2 rounded-full bg-room-control px-4 text-sm font-semibold text-room-fg-strong hover:bg-room-control-hover";
const QUALITY_CHOICES: readonly ReceiveQuality[] = ["automatica", "economizar"];

/** O id do titulo de cada secao (o nome acessivel da lista que mora nela). */
export const LIVE_SETTINGS_SECTION_IDS = {
  altoFalante: "live-settings-alto-falante",
  atalhos: "live-settings-atalhos",
  camera: "live-settings-camera",
  microfone: "live-settings-microfone",
  qualidade: "live-settings-qualidade",
  som: "live-settings-som",
  tema: "live-settings-tema"
} as const;

function Section(props: { children: ReactNode; className?: string; id: string; title: string }) {
  return (
    <section aria-labelledby={props.id} className={cn("min-w-0 space-y-2", props.className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-room-fg-subtle" id={props.id}>
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function DeviceSelect(props: { kind: DeviceKind; labelledBy: string; onChoose: LiveSettingsProps["onChoose"]; options: readonly DeviceOption[]; value: string | null }) {
  if (props.options.length === 0) {
    return <p className={NOTE}>{WEBINAR_COPY.aoVivo.config.semAparelho}</p>;
  }
  const value = props.value !== null && props.options.some((option) => option.deviceId === props.value) ? props.value : "";
  return (
    <select
      aria-labelledby={props.labelledBy}
      className={cn("h-11 w-full min-w-0 truncate rounded-[10px] border border-room-input-border bg-room-input-bg px-3 text-sm text-room-fg", FOCUS)}
      data-live-device={props.kind}
      onChange={(event) => {
        const option = props.options.find((item) => item.deviceId === event.target.value);
        if (option) {
          props.onChoose(props.kind, option);
        }
      }}
      value={value}
    >
      {value === "" ? <option disabled hidden value="" /> : null}
      {props.options.map((option) => (
        <option key={option.deviceId} value={option.deviceId}>
          {option.name}
        </option>
      ))}
    </select>
  );
}

/** Uma acao sem estado de quem apresenta (a barra do iframe dele tambem muda o mesmo efeito). */
function Action(props: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className={cn(PANEL_BUTTON, FOCUS)}
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

/**
 * O controle do painel que tinha o foco saiu da tela (a secao virou a frase) e o foco caiu no body: ele volta para o
 * Fechar. `last` e o ultimo elemento do painel com o foco (nulo quando o foco saiu do painel por outro caminho).
 */
export function panelFocusLost(input: { active: unknown; body: unknown; last: { isConnected: boolean } | null }): boolean {
  return input.last !== null && !input.last.isConnected && (input.active === input.body || input.active === null);
}

function Check(props: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <label className={ROW}>
      <input checked={props.checked} className={cn("size-5 shrink-0 accent-room-active-bg", FOCUS)} onChange={(event) => props.onChange(event.target.checked)} type="checkbox" />
      <span className="min-w-0">{props.label}</span>
    </label>
  );
}

export function LiveSettings({ cameraOn = false, devices, onChoose, onClose, onToggleTheme, sections, showMedia, theme }: LiveSettingsProps) {
  const copy = WEBINAR_COPY.aoVivo;
  const config = copy.config;
  const ids = LIVE_SETTINGS_SECTION_IDS;
  const showCamera = sections.camera !== "oculta" || sections.cameraBloqueada;
  // Quem apresenta por esta pagina: acoes sem estado, e a frase de ligar a camera enquanto a lista vem vazia.
  const presenter = !showMedia;
  const cameraFechada = presenter && devices.lists.videoInput.length === 0 && !cameraOn;
  const closeRef = useRef<HTMLButtonElement>(null);
  /** O ultimo controle do painel com o foco, ate o foco sair dele para outro lugar. */
  const lastFocusRef = useRef<HTMLElement | null>(null);

  // Depois de cada pintura: o controle com o foco sumiu junto com a secao? O foco vai para o Fechar (que nunca some).
  useLayoutEffect(() => {
    if (panelFocusLost({ active: document.activeElement, body: document.body, last: lastFocusRef.current })) {
      lastFocusRef.current = null;
      closeRef.current?.focus();
    }
  });

  return (
    <div
      aria-label={LIVE_ROOM_COPY.configuracoes}
      className="max-h-[min(55dvh,30rem)] min-h-0 overflow-y-auto overscroll-contain px-4 py-3"
      data-testid="live-settings"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) {
          lastFocusRef.current = null;
        }
      }}
      onFocus={(event) => {
        lastFocusRef.current = event.target instanceof HTMLElement ? event.target : null;
      }}
      role="group"
    >
      {onClose ? (
        <div className="mb-2 flex justify-end">
          <button
            className={cn(PANEL_BUTTON, "gap-1.5", FOCUS)}
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
            {config.fechar}
          </button>
        </div>
      ) : null}
      {sections.aguardandoSala ? <p className={cn(NOTE, "mb-3")}>{config.foraDaSala}</p> : null}
      {/* Duas colunas do sm ao lg (o painel na largura da coluna); a partir de lg o painel tem 380 px por cima do palco
          e fica numa coluna so, sem cortar os nomes dos aparelhos. */}
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-1">
        {onToggleTheme && theme ? (
          <Section className="sm:hidden" id={ids.tema} title={WEBINAR_COPY.salaV2.tema.titulo}>
            <button className={cn(PANEL_BUTTON, FOCUS)} onClick={onToggleTheme} type="button">
              {theme === "light" ? <Moon aria-hidden="true" className="size-4" /> : <Sun aria-hidden="true" className="size-4" />}
              {theme === "light" ? WEBINAR_COPY.salaV2.tema.escuro : WEBINAR_COPY.salaV2.tema.claro}
            </button>
          </Section>
        ) : null}

        {sections.volume !== "oculta" ? (
          <Section id={ids.som} title={copy.som}>
            <div className="flex items-center gap-3">
              <input
                aria-label={config.volume}
                aria-valuetext={config.volumeValor(devices.volumePercent)}
                className={cn("h-11 min-w-0 flex-1 cursor-pointer accent-room-active-bg", FOCUS)}
                max={100}
                min={0}
                onChange={(event) => devices.volume(Number(event.target.value))}
                step={5}
                type="range"
                value={devices.volumePercent}
              />
              <span aria-hidden="true" className="w-11 shrink-0 text-right text-xs tabular-nums text-room-fg-muted">
                {config.volumeValor(devices.volumePercent)}
              </span>
            </div>
          </Section>
        ) : null}

        {sections.altoFalante !== "oculta" ? (
          <Section id={ids.altoFalante} title={config.altoFalante}>
            {sections.altoFalante === "pronta" ? (
              <DeviceSelect kind="audioOutput" labelledBy={ids.altoFalante} onChoose={onChoose} options={devices.lists.audioOutput} value={devices.current.audioOutput} />
            ) : (
              <p className={NOTE}>{config.altoFalanteAguardando}</p>
            )}
          </Section>
        ) : null}

        {sections.microfone !== "oculta" ? (
          <Section id={ids.microfone} title={copy.microfone}>
            {sections.microfone === "pronta" ? (
              <>
                <DeviceSelect kind="audioInput" labelledBy={ids.microfone} onChoose={onChoose} options={devices.lists.audioInput} value={devices.current.audioInput} />
                {sections.ruido && !presenter ? <Check checked={devices.noise} label={config.reduzirRuido} onChange={devices.ruido} /> : null}
                {sections.ruido && presenter ? (
                  <div className="flex flex-wrap gap-2">
                    <Action onClick={() => devices.ruido(true)}>{config.ruidoLigar}</Action>
                    <Action onClick={() => devices.ruido(false)}>{config.ruidoDesligar}</Action>
                  </div>
                ) : null}
              </>
            ) : (
              <p className={NOTE}>{sections.microfone === "permissao" ? config.microfoneSemPermissao : config.microfoneAguardando}</p>
            )}
          </Section>
        ) : null}

        {showCamera ? (
          <Section id={ids.camera} title={copy.camera}>
            {sections.cameraBloqueada ? (
              <p className={NOTE}>{copy.cameraBloqueada}</p>
            ) : sections.camera === "pronta" ? (
              <>
                {cameraFechada ? (
                  <p className={NOTE}>{config.cameraNaBarraDoVideo}</p>
                ) : (
                  <DeviceSelect kind="videoInput" labelledBy={ids.camera} onChoose={onChoose} options={devices.lists.videoInput} value={devices.current.videoInput} />
                )}
                {sections.espelhar && !presenter && devices.mirror !== null ? <Check checked={devices.mirror} label={config.espelhar} onChange={() => devices.espelhar()} /> : null}
                {sections.desfocar && !presenter ? <Check checked={devices.blur} label={config.desfocar} onChange={devices.fundo} /> : null}
                {presenter ? (
                  <div className="flex flex-wrap gap-2">
                    {sections.espelhar ? <Action onClick={devices.espelhar}>{config.inverterImagem}</Action> : null}
                    {sections.desfocar ? (
                      <>
                        <Action onClick={() => devices.fundo(true)}>{config.desfocar}</Action>
                        <Action onClick={() => devices.fundo(false)}>{config.fundoTirar}</Action>
                      </>
                    ) : null}
                    {sections.maisFundos ? (
                      <Action onClick={devices.maisFundos}>
                        <ImagePlus aria-hidden="true" className="size-4" />
                        {config.maisFundos}
                      </Action>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className={NOTE}>{sections.camera === "permissao" ? config.cameraSemPermissao : config.cameraAguardando}</p>
            )}
          </Section>
        ) : null}

        {sections.qualidade !== "oculta" ? (
          <Section id={ids.qualidade} title={config.qualidade}>
            <div aria-labelledby={ids.qualidade} role="radiogroup">
              {QUALITY_CHOICES.map((choice) => (
                <label className={ROW} key={choice}>
                  <input
                    checked={devices.quality === choice}
                    className={cn("size-5 shrink-0 accent-room-active-bg", FOCUS)}
                    name={ids.qualidade}
                    onChange={() => devices.qualidade(choice)}
                    type="radio"
                    value={choice}
                  />
                  <span>{choice === "automatica" ? config.qualidadeAutomatica : config.qualidadeEconomizar}</span>
                </label>
              ))}
            </div>
            <p className={NOTE}>{config.qualidadeEconomizarTexto}</p>
          </Section>
        ) : null}

        {sections.atalhos ? (
          <Section id={ids.atalhos} title={LIVE_ROOM_COPY.atalhos}>
            <ul className="space-y-0.5 text-xs leading-5 text-room-fg-muted">
              <li>{LIVE_ROOM_COPY.atalhoReagir}</li>
              {showMedia ? <li>{LIVE_ROOM_COPY.atalhoMao}</li> : null}
              <li>{LIVE_ROOM_COPY.atalhoEnquete}</li>
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
