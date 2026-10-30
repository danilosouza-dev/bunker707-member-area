"use client";

import { ImagePlus } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { UseJitsiDevices } from "@/components/webinars/use-jitsi-devices";
import type { DeviceKind, DeviceOption, DeviceSettings } from "@/lib/jitsi-device-settings";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { adminInputClass } from "../../../form";

// O card Configurações de quem apresenta no console (docs/30 §1.4 e §5.4), aberto pelo botao Configurações nas acoes do
// palco (live-room-panel.tsx), so para o Apresentador e o co-apresentador: Microfone (a escolha, Ligar / Desligar a
// redução de ruído), Alto-falante (so quando o navegador deixa trocar a saida e ha duas com nome) e Câmera (a escolha,
// ou, com a lista vazia e a camera fechada, a frase de liga-la na barra do video; Inverter a minha imagem; Desfocar o
// fundo / Tirar o efeito do fundo com a camera ligada e fora do celular; e Mais opções de fundo, o dialogo de fundo do
// proprio iframe). Ruido, fundo e espelho sao acoes sem estado: quem apresenta tambem os muda pela barra do iframe (a
// setinha do microfone, o fundo, a engrenagem, a miniatura), e o iframe guarda o espelho de uma live para outra, entao
// uma caixa marcada aqui mentiria. Nunca a Qualidade do vídeo (setVideoQuality muda o envio: quem apresenta nao baixa
// o proprio palco) nem a faixa de volume. As secoes vem de deviceSettingsFor (src/lib/jitsi-device-settings.ts) com o
// papel da sala; os aparelhos e os comandos do hook useJitsiDevices, pelo LiveRoomHandle. Esc fecha. Nenhuma frase e
// escrita direto e nada aqui fala com a rede.

/** O id do card (o aria-controls do botao Configurações). */
export const LIVE_SETTINGS_CARD_ID = "console-live-settings";

/** O id do titulo de cada secao (o nome acessivel da lista que mora nela). */
export const LIVE_SETTINGS_CARD_SECTION_IDS = {
  altoFalante: "console-live-settings-alto-falante",
  camera: "console-live-settings-camera",
  microfone: "console-live-settings-microfone",
  titulo: "console-live-settings-title"
} as const;

/** O que o card le e chama do useJitsiDevices (os testes passam um objeto com o mesmo formato). */
export type LiveSettingsCardDevices = Pick<UseJitsiDevices, "current" | "espelhar" | "fundo" | "lists" | "maisFundos" | "ruido">;

export type LiveSettingsCardProps = {
  /** A propria camera no ar: fechada e sem a permissao do navegador, a lista de cameras vem vazia. */
  cameraOn: boolean;
  devices: LiveSettingsCardDevices;
  /** Troca o aparelho (o console confere a secao de novo antes do set*Device). */
  onChoose: (kind: DeviceKind, option: DeviceOption) => void;
  /** Esc: fecha o card e devolve o foco ao botao Configurações. */
  onClose: () => void;
  sections: DeviceSettings;
};

const copy = WEBINAR_COPY.consoleAoVivo;
const config = WEBINAR_COPY.aoVivo.config;
const NOTE = "text-xs leading-5 text-[var(--text-tertiary)]";

function Section(props: { children: ReactNode; id: string; title: string }) {
  return (
    <section aria-labelledby={props.id} className="flex min-w-0 flex-col gap-2">
      <h4 className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={props.id}>
        {props.title}
      </h4>
      {props.children}
    </section>
  );
}

function DeviceSelect(props: { kind: DeviceKind; labelledBy: string; onChoose: LiveSettingsCardProps["onChoose"]; options: readonly DeviceOption[]; value: string | null }) {
  if (props.options.length === 0) {
    return <p className={NOTE}>{config.semAparelho}</p>;
  }
  const value = props.value !== null && props.options.some((option) => option.deviceId === props.value) ? props.value : "";
  return (
    <select
      aria-labelledby={props.labelledBy}
      className={cn(adminInputClass, "w-full min-w-0 truncate")}
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

/** Uma acao sem estado (o comando vai na hora; a barra do iframe tambem muda o mesmo efeito). */
function Action(props: { children: ReactNode; onClick: () => void }) {
  return (
    <Button className="px-3" onClick={props.onClick} type="button" variant="secondary">
      {props.children}
    </Button>
  );
}

export function LiveSettingsCard({ cameraOn, devices, onChoose, onClose, sections }: LiveSettingsCardProps) {
  const ids = LIVE_SETTINGS_CARD_SECTION_IDS;
  // A camera nunca ligada neste navegador: sem a permissao, nenhuma camera com id (a frase diz onde liga-la).
  const cameraFechada = devices.lists.videoInput.length === 0 && !cameraOn;

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <section
      aria-labelledby={ids.titulo}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] px-3 py-3"
      data-live-settings=""
      id={LIVE_SETTINGS_CARD_ID}
      onKeyDown={onKeyDown}
    >
      <div className="min-w-0">
        <h3 className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={ids.titulo}>
          {copy.configuracoes}
        </h3>
        <p className={NOTE}>{copy.configuracoesTexto}</p>
      </div>

      {sections.aguardandoSala ? (
        <p className={NOTE}>{config.foraDaSala}</p>
      ) : (
        <div className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
          {sections.microfone === "pronta" ? (
            <Section id={ids.microfone} title={WEBINAR_COPY.aoVivo.microfone}>
              <DeviceSelect kind="audioInput" labelledBy={ids.microfone} onChoose={onChoose} options={devices.lists.audioInput} value={devices.current.audioInput} />
              {sections.ruido ? (
                <div className="flex flex-wrap gap-2">
                  <Action onClick={() => devices.ruido(true)}>{config.ruidoLigar}</Action>
                  <Action onClick={() => devices.ruido(false)}>{config.ruidoDesligar}</Action>
                </div>
              ) : null}
            </Section>
          ) : null}

          {sections.altoFalante === "pronta" ? (
            <Section id={ids.altoFalante} title={config.altoFalante}>
              <DeviceSelect kind="audioOutput" labelledBy={ids.altoFalante} onChoose={onChoose} options={devices.lists.audioOutput} value={devices.current.audioOutput} />
            </Section>
          ) : null}

          {sections.camera === "pronta" ? (
            <Section id={ids.camera} title={WEBINAR_COPY.aoVivo.camera}>
              {cameraFechada ? (
                <p className={NOTE}>{config.cameraNaBarraDoVideo}</p>
              ) : (
                <DeviceSelect kind="videoInput" labelledBy={ids.camera} onChoose={onChoose} options={devices.lists.videoInput} value={devices.current.videoInput} />
              )}
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
              {/* O desfoque so vale com o video no ar: com a camera fechada, a frase de onde liga-la (uma so). */}
              {sections.maisFundos && !sections.desfocar && !cameraFechada ? <p className={NOTE}>{copy.configuracoesDesfocar}</p> : null}
            </Section>
          ) : null}
        </div>
      )}
    </section>
  );
}
