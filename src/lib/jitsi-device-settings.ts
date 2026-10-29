// O painel Configurações da sala ao vivo, a parte pura (docs/30 §1.3, §5.4, §6.3, §8.5 e D4): quais secoes aparecem
// para cada papel e em cada momento (Som, Alto-falante, Microfone, Câmera, Qualidade do vídeo e Atalhos), a lista de
// aparelhos que o IFrame API devolve arrumada para a tela (sem id vazio, sem os "default" e "communications" repetidos
// do Chrome, com um nome reserva quando o navegador ainda nao deu o rotulo), os argumentos dos metodos de aparelho
// (so o ID, com o rotulo vazio: do lado do iframe, "setDevice" procura pelo rotulo quando ele vem e pega o PRIMEIRO de
// rotulo igual), quando a troca acabou (deviceSwitchDone: o aparelho em uso ja e o escolhido, o erro dela ou o teto) e
// os comandos de ruido, fundo,
// qualidade e volume conferidos no app da tag stable-11248 (setNoiseSuppressionEnabled recebe { enabled }, nunca o
// toggleNoiseSuppression, que ninguem trata nesta tag; setBlurredBackground recebe "blur" ou "none" e so vale com a
// camera ligada), o que o painel do aluno reaplica num iframe novo (panelEffectsOnSignal) e o espelho guardado na
// pagina (o iframe guarda o dele e a api nao deixa ler). A escolha de microfone e de camera do aluno so fica pronta
// depois do consentimento (o Falar, o aviso de gravacao da camera aceito): trocar de aparelho pede getUserMedia, e o
// aviso de gravacao vem antes da permissao (§8.5). Sem imports: o hook src/components/webinars/use-jitsi-devices.ts, as telas e os testes (node --test)
// carregam este arquivo direto. Nenhuma frase de tela aqui (elas ficam em src/lib/webinar-copy.ts).

/** Os papeis da sala (o mesmo LiveRoomRole de jitsi-room-config.ts, repetido para o arquivo ficar sem imports). */
export type DeviceSettingsRole = "co_host" | "host" | "student" | "team";

/** As tres listas do getAvailableDevices / getCurrentDevices do IFrame API, com os nomes de la. */
export type DeviceKind = "audioInput" | "audioOutput" | "videoInput";

export const DEVICE_KINDS: readonly DeviceKind[] = ["audioInput", "audioOutput", "videoInput"];

/** O metodo do IFrame API que troca cada aparelho (metodos da api, nao executeCommand). */
export const SET_DEVICE_METHOD = {
  audioInput: "setAudioInputDevice",
  audioOutput: "setAudioOutputDevice",
  videoInput: "setVideoInputDevice"
} as const satisfies Record<DeviceKind, string>;

/**
 * "oculta": a secao nao aparece; "aguardando": aparece so a frase do que falta (o Falar, o aviso da camera); "permissao":
 * o aluno ja consentiu, mas o navegador ainda nao deu a permissao daquele tipo (o pedido aberto, fechado no X ou
 * bloqueado: a lista vem sem id), entao so a frase de liberar o acesso, nunca "nenhum aparelho"; "pronta": as escolhas.
 */
export type SectionState = "aguardando" | "oculta" | "permissao" | "pronta";

export type DeviceSettingsInput = {
  /** A camera dos alunos esta permitida no webinario (o token traz); nulo antes do token. */
  allowStudentCamera: boolean | null;
  /** O aluno aceitou o aviso de gravacao da camera nesta abertura da sala. */
  cameraConsented: boolean;
  /** iPhone e iPad: o volume do elemento de audio e so leitura, a faixa de volume some. */
  isIOS: boolean;
  /** Celular: sem desfocar o fundo (o efeito nao roda la) e sem a secao de atalhos do teclado. */
  isMobile: boolean;
  /** Dentro da sala (videoConferenceJoined): antes disso nenhum aparelho e lido nem trocado. */
  joined: boolean;
  /** O apresentador liberou e o aluno tocou em Falar (o micAllowed da sala). */
  micAllowed: boolean;
  /** A lista daquele tipo veio so com aparelhos sem id (o navegador sem a permissao; DevicesSnapshot.semPermissao). */
  semPermissao?: Partial<Record<DeviceKind, boolean>>;
  /** isDeviceChangeAvailable('output') do IFrame API (falso no Safari e antes de ler). */
  outputChangeAvailable: boolean;
  /** As saidas de som que o iframe listou (cruas ou ja arrumadas); so contam as que tem rotulo. */
  outputs: readonly unknown[];
  /** Nulo antes do token: vale como aluno (a nossa barra). */
  role: DeviceSettingsRole | null;
  /** A propria camera ligada: o desfoque do iframe so vale com o video no ar. */
  videoOn: boolean;
};

export type DeviceSettings = {
  /** Fora da sala: so os atalhos e a frase de que as escolhas aparecem ao entrar. */
  aguardandoSala: boolean;
  altoFalante: SectionState;
  /** A secao de atalhos do teclado (fora do celular). */
  atalhos: boolean;
  camera: SectionState;
  /** A camera dos alunos esta desligada no webinario: a secao Câmera mostra so essa frase. */
  cameraBloqueada: boolean;
  /** "Desfocar o fundo": camera pronta e ligada, fora do celular. */
  desfocar: boolean;
  /** "Espelhar a minha imagem": camera pronta. */
  espelhar: boolean;
  /** "Mais opções de fundo" (o dialogo de fundo do iframe): so quem apresenta, fora do celular. */
  maisFundos: boolean;
  microfone: SectionState;
  /** Qualidade do vídeo (Automática / Economizar dados): nunca para quem apresenta (mudaria o envio do palco). */
  qualidade: SectionState;
  /** "Reduzir ruído": microfone pronto. */
  ruido: boolean;
  /** A faixa de volume (o botao Som da barra continua cortando e voltando o som). */
  volume: SectionState;
};

/**
 * As secoes por papel e momento (docs/30 §1.3): o aluno so escolhe microfone e camera depois do consentimento e com a
 * permissao do navegador daquele tipo (antes dela, a frase de liberar o acesso: "permissao").
 */
export function deviceSettingsFor(input: DeviceSettingsInput): DeviceSettings {
  const presenter = input.role === "host" || input.role === "co_host";
  const cameraBloqueada = !presenter && input.allowStudentCamera === false;
  const atalhos = !input.isMobile;
  if (!input.joined) {
    return {
      aguardandoSala: true,
      altoFalante: "oculta",
      atalhos,
      camera: "oculta",
      cameraBloqueada,
      desfocar: false,
      espelhar: false,
      maisFundos: false,
      microfone: "oculta",
      qualidade: "oculta",
      ruido: false,
      volume: "oculta"
    };
  }
  const namedOutputs = deviceOptions(input.outputs).filter((option) => option.label !== "").length;
  // O aluno ja consentiu, mas o navegador ainda nao deu a permissao (a lista sem id): a frase de liberar o acesso.
  const micSemPermissao = !presenter && input.semPermissao?.audioInput === true;
  const cameraSemPermissao = !presenter && input.semPermissao?.videoInput === true;
  // O rotulo das saidas de som (e o proprio setSinkId) depende da permissao do MICROFONE no Chrome e no Firefox, nunca
  // da camera: antes de o aluno falar, ou depois do Falar com o microfone ainda sem a permissao, a frase explica (o
  // aviso da camera aceito nao libera o alto-falante).
  const permissionPending = !presenter && (!input.micAllowed || micSemPermissao);
  const altoFalante: SectionState = !input.outputChangeAvailable ? "oculta" : namedOutputs >= 2 ? "pronta" : permissionPending ? "aguardando" : "oculta";
  const microfone: SectionState = presenter ? "pronta" : !input.micAllowed ? "aguardando" : micSemPermissao ? "permissao" : "pronta";
  const camera: SectionState = presenter ? "pronta" : cameraBloqueada ? "oculta" : !input.cameraConsented ? "aguardando" : cameraSemPermissao ? "permissao" : "pronta";
  return {
    aguardandoSala: false,
    altoFalante,
    atalhos,
    camera,
    cameraBloqueada,
    desfocar: camera === "pronta" && input.videoOn && !input.isMobile,
    espelhar: camera === "pronta",
    maisFundos: presenter && camera === "pronta" && !input.isMobile,
    microfone,
    qualidade: presenter ? "oculta" : "pronta",
    ruido: microfone === "pronta",
    volume: input.isIOS ? "oculta" : "pronta"
  };
}

/** A escolha de aparelho daquele tipo esta liberada (o hook e a tela conferem antes de cada set*Device). */
export function deviceSectionReady(settings: Pick<DeviceSettings, "altoFalante" | "camera" | "microfone">, kind: DeviceKind): boolean {
  switch (kind) {
    case "audioInput":
      return settings.microfone === "pronta";
    case "audioOutput":
      return settings.altoFalante === "pronta";
    default:
      return settings.camera === "pronta";
  }
}

/* ------------------------------------------------------------------------------------------------
 * A lista de aparelhos
 * ---------------------------------------------------------------------------------------------- */

/**
 * Um aparelho pronto para a tela: `label` e o rotulo que o navegador deu (vazio sem a permissao; nunca vai para o
 * set*Device, que recebe so o id), `name` e o que a tela mostra (o rotulo ou o nome reserva) e `isDefault` marca o
 * aparelho que o "default" do Chrome apontava.
 */
export type DeviceOption = { deviceId: string; groupId: string; isDefault: boolean; label: string; name: string };

/** Os ids do Chrome que repetem outro aparelho da lista ("Padrão - …" e "Comunicações - …"). */
const ALIAS_IDS = new Set(["default", "communications"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

type RawDevice = { deviceId: string; groupId: string; label: string };

function rawDevice(value: unknown): RawDevice {
  return { deviceId: text(field(value, "deviceId")), groupId: text(field(value, "groupId")), label: text(field(value, "label")) };
}

/** O aparelho de verdade que um "default" / "communications" repete: pelo rotulo (o fim de "Padrão - X") ou pelo grupo. */
function twinOf(alias: RawDevice, real: readonly RawDevice[]): RawDevice | undefined {
  let byLabel: RawDevice | undefined;
  for (const item of alias.label ? real : []) {
    // O rotulo mais longo que fecha o do "default" (um rotulo curto como "USB" nao rouba o de "Fone USB").
    if (item.label !== "" && alias.label !== item.label && alias.label.endsWith(item.label) && item.label.length > (byLabel?.label.length ?? 0)) {
      byLabel = item;
    }
  }
  return byLabel ?? (alias.groupId ? real.find((item) => item.groupId === alias.groupId) : undefined);
}

/**
 * A lista de um tipo de aparelho para a tela: tira os de id vazio (o navegador sem permissao), junta os "default" e
 * "communications" do Chrome com o aparelho que eles repetem (marcado `isDefault`), tira ids repetidos e da o nome
 * reserva (`fallbackName(posicao)`, por exemplo "Microfone 1") a quem veio sem rotulo. Aceita a propria saida.
 */
export function deviceOptions(list: unknown, fallbackName: (position: number) => string = (position) => String(position)): DeviceOption[] {
  const items = (Array.isArray(list) ? list : []).map(rawDevice).filter((item) => item.deviceId !== "");
  const real = items.filter((item) => !ALIAS_IDS.has(item.deviceId));
  const defaults = new Set<string>();
  const kept: RawDevice[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (ALIAS_IDS.has(item.deviceId)) {
      const twin = twinOf(item, real);
      if (twin) {
        if (item.deviceId === "default") {
          defaults.add(twin.deviceId);
        }
        continue;
      }
    }
    if (seen.has(item.deviceId)) {
      continue;
    }
    seen.add(item.deviceId);
    kept.push(item);
  }
  for (const option of Array.isArray(list) ? list : []) {
    // A propria saida de deviceOptions passada de novo continua com a marca do aparelho padrao.
    if (field(option, "isDefault") === true) {
      defaults.add(text(field(option, "deviceId")));
    }
  }
  return kept.map((item, index) => ({
    deviceId: item.deviceId,
    groupId: item.groupId,
    isDefault: defaults.has(item.deviceId) || item.deviceId === "default",
    label: item.label,
    name: item.label || fallbackName(index + 1)
  }));
}

/**
 * Qual opcao da lista e o aparelho em uso (getCurrentDevices): pelo id; o "default" do Chrome, pelo aparelho que ele
 * repete (o rotulo ou o grupo) ou pela marca `isDefault`; senao, pelo rotulo. Sem como saber: nulo.
 */
export function selectedDeviceId(options: readonly DeviceOption[], current: unknown): string | null {
  const id = text(field(current, "deviceId"));
  const label = text(field(current, "label"));
  const groupId = text(field(current, "groupId"));
  const exact = id ? options.find((option) => option.deviceId === id) : undefined;
  if (exact) {
    return exact.deviceId;
  }
  if (ALIAS_IDS.has(id) || (!id && label)) {
    const twin = twinOf({ deviceId: id, groupId, label }, options);
    if (twin) {
      return twin.deviceId;
    }
  }
  if (id === "default") {
    return options.find((option) => option.isDefault)?.deviceId ?? null;
  }
  return label ? (options.find((option) => option.label === label)?.deviceId ?? null) : null;
}

/**
 * Os argumentos de setAudioInputDevice / setAudioOutputDevice / setVideoInputDevice: o rotulo VAZIO e o id. Na tag
 * stable-11248 o "setDevice" do iframe faz `label ? getDeviceIdByLabel(state, label, kind) : id`, e o
 * getDeviceIdByLabel devolve o PRIMEIRO aparelho de rotulo identico: com o rotulo, duas webcams iguais (o Chrome da o
 * mesmo rotulo as duas) sempre caem na primeira, e um rotulo com espaco nas pontas (aparado na nossa lista) nao acha
 * nada. O id vem do getAvailableDevices do proprio iframe (a mesma origem), entao vale direto.
 */
export function setDeviceArgs(option: Pick<DeviceOption, "deviceId">): [string, string] {
  return ["", option.deviceId];
}

export type DevicesSnapshot = {
  current: Record<DeviceKind, string | null>;
  lists: Record<DeviceKind, DeviceOption[]>;
  /** isMultipleAudioInputSupported do IFrame API. */
  multipleAudioInput: boolean;
  /** isDeviceChangeAvailable('output') do IFrame API. */
  outputChangeAvailable: boolean;
  /**
   * A lista crua daquele tipo tinha aparelhos e todos vieram sem id: o navegador ainda nao deu a permissao (o pedido
   * aberto, fechado no X ou bloqueado), nao "nenhum aparelho". Lista vazia de verdade: falso.
   */
  semPermissao: Record<DeviceKind, boolean>;
};

export const EMPTY_DEVICES: DevicesSnapshot = {
  current: { audioInput: null, audioOutput: null, videoInput: null },
  lists: { audioInput: [], audioOutput: [], videoInput: [] },
  multipleAudioInput: false,
  outputChangeAvailable: false,
  semPermissao: { audioInput: false, audioOutput: false, videoInput: false }
};

/** A lista crua tinha aparelhos e nenhum com id (o navegador sem a permissao daquele tipo). */
function withoutPermission(list: unknown): boolean {
  const items = Array.isArray(list) ? list.map(rawDevice) : [];
  return items.length > 0 && items.every((item) => item.deviceId === "");
}

/** O que o hook leu do IFrame API (getAvailableDevices, getCurrentDevices e os dois "isX"), arrumado para a tela. */
export function devicesSnapshotOf(
  input: { available: unknown; current: unknown; multipleAudioInput: unknown; outputChangeAvailable: unknown },
  fallbackNames: Record<DeviceKind, (position: number) => string>
): DevicesSnapshot {
  const lists = {} as Record<DeviceKind, DeviceOption[]>;
  const current = {} as Record<DeviceKind, string | null>;
  const semPermissao = {} as Record<DeviceKind, boolean>;
  for (const kind of DEVICE_KINDS) {
    lists[kind] = deviceOptions(field(input.available, kind), fallbackNames[kind]);
    current[kind] = selectedDeviceId(lists[kind], field(input.current, kind));
    semPermissao[kind] = withoutPermission(field(input.available, kind));
  }
  return { current, lists, multipleAudioInput: input.multipleAudioInput === true, outputChangeAvailable: input.outputChangeAvailable === true, semPermissao };
}

/* ------------------------------------------------------------------------------------------------
 * Os comandos (executeCommand) do painel
 * ---------------------------------------------------------------------------------------------- */

/** Reduzir ruído: o app da tag fixada so trata setNoiseSuppressionEnabled com { enabled } (nunca toggleNoiseSuppression). */
export function noiseSuppressionCommand(on: boolean): ["setNoiseSuppressionEnabled", { enabled: boolean }] {
  return ["setNoiseSuppressionEnabled", { enabled: on }];
}

/** Desfocar o fundo: "blur" ou "none" (o iframe so aplica com a camera ligada). */
export function blurCommand(on: boolean): ["setBlurredBackground", "blur" | "none"] {
  return ["setBlurredBackground", on ? "blur" : "none"];
}

/**
 * Sem efeito de fundo, mesmo com a camera fechada: setVirtualBackground(false, "") grava o fundo desligado no iframe
 * sem faixa nenhuma (o setBlurredBackground e ignorado com a camera fechada), e a faixa que abrir depois sai sem efeito.
 */
export function backgroundOffCommand(): ["setVirtualBackground", false, ""] {
  return ["setVirtualBackground", false, ""];
}

export type ReceiveQuality = "automatica" | "economizar";

/**
 * A altura que cada escolha da Qualidade do vídeo manda ao iframe (setVideoQuality). Automática e 2160, o valor de
 * entrada do iframe da tag stable-11248 (preferredVideoQuality comeca em VIDEO_QUALITY_LEVELS.ULTRA, o
 * MAX_VIDEO_QUALITY): so com ele a tela compartilhada no palco chega sem teto; com 1080 ela passaria a ter o teto do
 * tamanho do palco (720 num palco de 450 px), e a volta de Economizar nao devolveria o estado de entrada.
 */
export const RECEIVE_QUALITY_HEIGHT: Record<ReceiveQuality, number> = { automatica: 2160, economizar: 360 };

/**
 * A Qualidade do vídeo do aluno: Economizar dados manda setVideoQuality 360; Automática manda 2160 (o valor de entrada
 * do iframe) so quando volta de Economizar (na entrada nada e mandado: o iframe ja nasce nele). A mesma escolha de
 * novo: nada.
 */
export function receiveQualityCommand(next: ReceiveQuality, previous: ReceiveQuality = "automatica"): ["setVideoQuality", number] | null {
  if (next === previous) {
    return null;
  }
  return ["setVideoQuality", RECEIVE_QUALITY_HEIGHT[next]];
}

/** O volume da faixa (0 a 100, de 5 em 5) para setParticipantVolume (0 a 1). */
export function participantVolume(percent: number): number {
  return clampPercent(percent) / 100;
}

/** A faixa de volume vai de 0 a 100; o resto (texto, NaN) volta para 100. */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 100;
  }
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** O volume que cada participante recebe: o Som da barra desligado zera; ligado, o da faixa. */
export function soundLevel(soundOn: boolean, percent: number): number {
  return soundOn ? participantVolume(percent) : 0;
}

/* ------------------------------------------------------------------------------------------------
 * Os efeitos que o painel do aluno guarda e o espelho
 * ---------------------------------------------------------------------------------------------- */

/** Um comando do executeCommand: o nome e os argumentos. */
export type PanelCommand = [string, ...unknown[]];

/**
 * O que o painel do aluno ligou e so ele muda (o aluno nao tem a barra do iframe): o ruido, o desfoque e a qualidade
 * recebida. O painel e a fonte da verdade: o iframe guarda o ruido e o fundo de uma live para outra no armazenamento
 * dele ('features/noise-suppression' e 'features/virtual-background' persistem na tag stable-11248) e a api nao deixa
 * ler, entao cada iframe novo recebe o que o painel mostra (panelEffectsOnSignal). Quem apresenta muda o ruido e o
 * fundo tambem pela barra do iframe (a setinha do microfone, o fundo, a engrenagem): o card dele nao guarda nada disso
 * (as acoes sao sem estado) e nada e reaplicado por cima da escolha feita la.
 */
export type PanelEffects = {
  blur: boolean;
  /** Um iframe novo (a volta depois de uma queda): o desfoque pedido vai uma vez, quando a camera ligar. */
  blurOnNextVideo: boolean;
  noise: boolean;
  quality: ReceiveQuality;
};

export const INITIAL_PANEL_EFFECTS: PanelEffects = { blur: false, blurOnNextVideo: false, noise: false, quality: "automatica" };

/**
 * O que um sinal do iframe pede de novo dos efeitos do painel do aluno. Um iframe novo (videoConferenceJoined: a
 * entrada, a volta depois de uma queda, a live seguinte no mesmo navegador) recebe o que o painel mostra, ligado ou
 * desligado, porque o iframe guarda o ruido e o fundo da live anterior: o ruido sempre (sem faixa de microfone ele so
 * grava o estado, e a faixa que abrir depois do Falar sai com ele), o fundo desligado ja na entrada quando o painel nao
 * desfocou (backgroundOffCommand: a camera que abrir depois do aviso sai sem o desfoque guardado) e a qualidade quando
 * e Economizar. O desfoque ligado fica para quando a camera ligar (so vale com o video no ar), uma vez. Dentro do mesmo
 * iframe nada e reaplicado: a faixa nova da camera (ligar de novo, trocar de aparelho) ja sai com o efeito, porque o
 * iframe cria cada faixa com os efeitos ligados.
 */
export function panelEffectsOnSignal(effects: PanelEffects, name: string, payload: unknown): { commands: PanelCommand[]; effects: PanelEffects } {
  if (name === "videoConferenceJoined") {
    const commands: PanelCommand[] = [noiseSuppressionCommand(effects.noise)];
    if (!effects.blur) {
      commands.push(backgroundOffCommand());
    }
    const quality = receiveQualityCommand(effects.quality);
    if (quality) {
      commands.push(quality);
    }
    return { commands, effects: { ...effects, blurOnNextVideo: effects.blur } };
  }
  if (name === "videoMuteStatusChanged" && field(payload, "muted") === false && effects.blurOnNextVideo) {
    return { commands: effects.blur ? [blurCommand(true)] : [], effects: { ...effects, blurOnNextVideo: false } };
  }
  return { commands: [], effects };
}

/**
 * Depois que a troca do microfone ACABOU (deviceSwitchDone), o Reduzir ruído que o aluno ligou vai de novo: na tag
 * stable-11248 o onAudioDeviceChanged desliga o ruido antes do getUserMedia do aparelho novo (o estado do iframe fica
 * desligado, entao o "ligado" nunca cai no "already enabled") e cria a faixa nova sem ele; mandado antes de a faixa
 * nova entrar, o efeito iria para a faixa velha. A troca da camera nao reaplica nada.
 */
export function panelEffectsAfterSwitch(effects: PanelEffects, kind: DeviceKind): PanelCommand[] {
  return kind === "audioInput" && effects.noise ? [noiseSuppressionCommand(true)] : [];
}

/**
 * "Espelhar a minha imagem" do aluno, guardado no navegador desta pagina. O iframe guarda o proprio espelho (localFlipX)
 * no armazenamento dele de uma live para outra, e o IFrame API nao deixa ler esse valor; como o aluno so muda o espelho
 * pelo nosso painel (o "Flip" do menu da propria miniatura sai com `disableLocalVideoFlip` no configOverwrite do aluno e
 * da Equipe, liveConfigOverwrite), a escolha guardada aqui acompanha a do iframe. O comando (toggleCameraMirror) so
 * inverte. Limite conhecido: quem apresenta no mesmo navegador (o produtor testando os dois papeis) inverte o mesmo
 * localFlipX pela barra do iframe ou pelo console, e a caixa do aluno fica com o valor oposto ate um clique nela.
 */
export const MIRROR_STORAGE_KEY = "bunker707:webinar-espelho";

/** O valor guardado: "0" desligado; nada guardado (ou outro valor) vale o padrao do iframe, espelhado. */
export function storedMirror(value: string | null | undefined): boolean {
  return value !== "0";
}

/* ------------------------------------------------------------------------------------------------
 * Quando a troca de aparelho acabou
 * ---------------------------------------------------------------------------------------------- */

/**
 * Depois do set*Device, o hook confere o aparelho em uso (getCurrentDevices) neste intervalo. A resposta do set*Device
 * sai logo depois do dispatch, ANTES do getUserMedia do aparelho novo (um fone Bluetooth leva uns 2,5 s), e o
 * getCurrentDevices do iframe so passa a dizer o aparelho novo quando a faixa nova entra (TRACK_ADDED): so entao o
 * ruido volta e a lista e aplicada.
 */
export const DEVICE_SWITCH_POLL_MS = 500;

/** O teto da conferencia, contado da resposta do set*Device: a troca que nao acabou ate aqui conta como acabada. */
export const DEVICE_SWITCH_MAX_MS = 10_000;

/**
 * A troca daquele tipo acabou: o aparelho em uso ja e o escolhido (e passou o piso `minMs`), o iframe recusou na
 * resposta (o set*Device respondeu falso: o aparelho nao esta na lista dele), avisou o erro daquele tipo (micError /
 * cameraError: a faixa velha fica), ou o teto venceu. O piso existe porque o getCurrentDevices da tag stable-11248
 * responde `settings.cameraDeviceId ?? userSelectedCameraDeviceId`: o primeiro so e gravado quando uma faixa daquele
 * aparelho entra (TRACK_ADDED) e comeca vazio em cada iframe novo, e o segundo e gravado na hora do set*Device. Num
 * iframe que ainda nao teve faixa de camera, ele diz o escolhido antes de a faixa da troca entrar, e so o piso (a sala
 * passa o teto) segura o toque em Câmera ate la.
 */
export function deviceSwitchDone(input: { chosen: string; current: string | null; elapsedMs: number; failed: boolean; minMs?: number }): boolean {
  return input.failed || input.elapsedMs >= DEVICE_SWITCH_MAX_MS || (input.current === input.chosen && input.elapsedMs >= (input.minMs ?? 0));
}

/** O sinal de erro do iframe que encerra a troca daquele tipo (o alto-falante nao tem). */
export function deviceSwitchErrorOf(name: string): DeviceKind | null {
  if (name === "micError") {
    return "audioInput";
  }
  return name === "cameraError" ? "videoInput" : null;
}

/** A faixa de volume aplica a todos no maximo uma vez neste intervalo enquanto o dedo arrasta. */
export const VOLUME_APPLY_MS = 150;

/* ------------------------------------------------------------------------------------------------
 * O aparelho de quem assiste
 * ---------------------------------------------------------------------------------------------- */

/** iPhone / iPad (o iPadOS se diz Mac, mas tem toque) e celular, pelo userAgent e pelos pontos de toque. */
export function deviceEnvironmentOf(input: { maxTouchPoints?: number; userAgent: string }): { isIOS: boolean; isMobile: boolean } {
  const ua = input.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (input.maxTouchPoints ?? 0) > 1);
  return { isIOS, isMobile: isIOS || /Android|Mobi/i.test(ua) };
}
