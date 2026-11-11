"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConsolePanelOpen, useConsoleTheme } from "@/components/member/webinars/room/use-room-prefs";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import type { LiveEmbedLook } from "@/lib/jitsi-room-config";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ConsolePollLaunch, ModerationAction } from "@/server/webinars/chat-schemas";
import {
  CONSOLE_POLL_MS,
  canTeamActOn,
  consoleClockLabel,
  consoleClockMs,
  consolePhaseOf,
  consoleScriptClockMs,
  scriptQueue,
  type ConsoleMessage,
  type ConsoleSnapshot
} from "@/server/webinars/console-model";
import type { SessionConsoleData } from "@/server/webinars/console-queries";
import {
  CONSOLE_POLL_START,
  consoleMoreEntriesFor,
  consolePanelViewOf,
  consoleRailStep,
  consolePollStep,
  consolePresenceBadge,
  consoleStageTopLeft,
  consoleTabCounts,
  consoleTabsFor,
  consoleTopActionsFor,
  type ConsolePanelView,
  type ConsolePoll,
  type ConsolePollOrigin
} from "@/server/webinars/console-v2-model";
import { editAssistantAnswer } from "@/server/webinars/assistant-actions";
import type { AttendanceSnapshot } from "@/server/webinars/assistant-queries";
import { WEBINAR_ADMIN_COPY, webinarAdminHref, webinarConsoleHref, webinarReportHref, type WebinarPermissions } from "@/server/webinars/editor-model";
import {
  alignChat,
  attachRecording,
  banStudent,
  endLiveSession,
  kickFromSession,
  markRecordingAnchor,
  muteInChat,
  openLiveRoom,
  prepareRecorder,
  releaseRecorder,
  requestRecording,
  setBrowserRecording,
  setRoomLock,
  setSelfUnmute,
  startLiveSession,
  undoSessionBan,
  unbanStudent
} from "@/server/webinars/live-actions";
import { LIVE_CONSOLE_COPY, banLabels, desiredLobby, handRows, liveControlsFor, type LiveConsolePerson } from "@/server/webinars/live-console-model";
import { NO_BAN } from "@/server/webinars/live-model";
import type { ChatMode, QuestionStatus, SlowModeSeconds } from "@/server/webinars/model";
import { LIVE_SCRIPT_LATE_MAX_MS } from "@/server/webinars/persona-model";
import {
  answerQuestion,
  closePoll,
  createConsolePoll,
  deleteQuestionReply,
  endSessionNow,
  launchPoll,
  moderateMessage,
  openSessionNow,
  pinPoll,
  replyToQuestion,
  sendTeamMessage,
  setQuestionStatus,
  setSessionChatMode,
  unpinPoll
} from "@/server/webinars/room-actions";
import { sessionDurationMs } from "@/server/webinars/room-model";
import { archiveScreenItem, hideScreenItem, saveScreenItem, showScreenItem, uploadScreenImage } from "@/server/webinars/screen-actions";
import { screenStageKinds } from "@/server/webinars/screen-model";
import { fireScriptItem, saveScriptComment, sendScriptedComment, uploadPersonaPhoto } from "@/server/webinars/script-actions";
import { EmptyState } from "../../../empty-state";
import { ErrorBanner } from "../../../error-banner";
import { adminTextareaClass } from "../../../form";
import { ConfirmDialog } from "../../../settings/kit";
import { adminToast } from "../../../toast";
import { ConsoleAttendance } from "./console-attendance";
import { ConsoleBar } from "./console-bar";
import { ConsoleChat } from "./console-chat";
import { ConsoleLeaveDialog } from "./console-leave-dialog";
import { CONSOLE_LEAVE_WAIT_MS, consoleLeaveGuarded, type ConsoleLeaveTarget } from "./console-leave-model";
import { consoleSkeleton } from "./console-layout-model";
import { ConsoleOffer } from "./console-offer";
import { ConsolePanel } from "./console-panel";
import { ConsoleRail, visibleConsoleTabControl } from "./console-rail";
import { ConsolePeopleTab } from "./console-people-tab";
import type { ConsolePollFormInput } from "./console-poll-form";
import { ConsolePolls } from "./console-polls";
import { ConsolePresencePanel } from "./console-presence";
import { ConsoleQuestions } from "./console-questions";
import { ConsoleScreen, consoleScreenCount } from "./console-screen";
import type { ScreenItemSaveInput } from "./console-screen-form";
import { ConsoleScript } from "./console-script";
import type { ScriptCommentFormInput } from "./console-script-comment";
import { ConsoleShell } from "./console-shell";
import { ConsoleStage } from "./console-stage";
import { ConsoleTopBar } from "./console-top-bar";
import { LiveAlignChat } from "./live-align-chat";
import { LiveAttachRecording, type AttachInput } from "./live-attach-recording";
import { LiveHands } from "./live-hands";
import { LiveBarredList, LivePersonMenuItems, livePersonMenuGroups, type PersonAction } from "./live-participants";
import { LiveRecorder } from "./live-recorder";
import { useLiveRoom } from "./live-room-panel";
import { useConsoleLeaveGuard } from "./use-console-leave-guard";
import { clearMessageTranslations } from "@/server/webinars/translation-actions";

// O console da sessao (docs/30 §2.4; fase 2b): o seletor de sessoes, a fase pelo relogio do servidor (skew medido
// na carga, como a sala do aluno), os presentes agora, Abrir e Encerrar com confirmacao (messaging.publish), e os
// quatro paineis: Chat (moderacao, quem pode escrever, modo lento, a mensagem da equipe), Roteiro (Soltar agora),
// Enquetes (abrir, encerrar, compartilhar) e Perguntas (responder, ao vivo, dispensar, reabrir). O retrato vem do
// servidor a cada 5 s pela rota /api/admin/webinars/[id]/console; cada acao busca o retrato de novo ao terminar.
// Erros ficam num banner (nunca toast); sucesso vira toast (menos a mensagem da equipe, que aparece na lista). Na Live
// ao vivo (fase 3, docs/30 §1.4, §2.4, §6.4 e §6.7) o topo troca Abrir/Encerrar por Abrir a sala (Sessao de pratica),
// Comecar para todos e Encerrar live (com
// confirmacao: para a gravacao, encerra no servidor e fecha a sala para todos), e a mesa ganha a sala no meio
// (live-room-panel.tsx: o iframe pelo useJitsiMeet com os botoes nossos ao redor), Mao levantada, Participantes (com o
// ⋯ de remover, silenciar e banir, tambem no chat), o cartao Gravacao, "Alinhar chat" e "Enviar gravacao". Sem a sala
// neste ambiente, "A sala ao vivo ainda nao esta configurada" e o resto do console funciona. Fase 4c (docs/30 §2.4 e
// D24): o painel Atendimento (console-attendance.tsx, com a propria leitura) devolve as marcas das perguntas para o
// painel Perguntas, e o Chat ganha "Corrigir resposta" nas respostas do Assistente (editAssistantAnswer). O painel
// Presenca (console-presence.tsx) abre a coluna da direita com o pico, as mensagens por minuto e os ultimos 30 minutos.
// Console V2 (docs/31 V2-12 e V2-13, fase 2 do redesign): a tela cheia, sem a barra lateral do admin (a moldura sabe
// pelo caminho, isAdminFullScreenPath), na raiz com o tema (ConsoleShell, escuro por padrao, guardado em chave
// propria), o topo enxuto (ConsoleTopBar: a seta, o titulo, o seletor, o Atualizar, o momento e os presentes, o Tema e
// os botoes de situacao de consoleTopActionsFor) e o esqueleto de consoleSkeleton, que nunca move o iframe. O tema vai
// ao iframe so na montagem (o look); trocar com a sala no ar nao remonta. As confirmacoes abrem no portal da raiz
// (container={portalRef}). Na live, o palco (console-stage.tsx, docs/31 V2-4) leva o momento ("Ao vivo · 00:42:10"),
// o Gravando, os presentes com o pico e quem esta no video grande, e o topo fica sem esses selos (os presentes voltam
// ao topo so abaixo de sm, onde o palco nao os mostra); na gravada e no Replay (sem palco) o momento e os presentes
// continuam no topo. Embaixo do palco, a barra de quem apresenta (console-bar.tsx, docs/31 V2-14): a Sala de espera,
// Microfone, Câmera, Compartilhar tela, Gravar, Mãos, Lançar enquete, a visao, Configurações e o balao do painel
// (aberto ou fechado, guardado em chave propria); o ⋮ da miniatura do video manda o Remover do aluno ligado a linha para
// o nosso Remover (onKickPerson). O painel com abas (console-panel.tsx, docs/31 V2-15): Chat, Perguntas, Mãos e
// Pessoas na live (Chat e Perguntas na gravada e no Replay), com o numero das perguntas abertas e das maos, e o ⋯ com
// Enquetes, Roteiro, Oferta, Atendimento, Presença e Gravação conforme a sessao; tudo montado, o que nao esta na tela
// com `hidden`. A aba e a entrada escolhidas ficam so na memoria da pagina; Mãos, Lançar enquete e o Gravar por
// preparar abrem o painel nelas (openPanel) e o foco vai a aba (ou ao ⋯) escolhida. A Na tela (docs/30 §2.4;
// especificacao de 10/11/2026, R1 e R2): o Chat recebe a fixada lida pela chave (o bloco Fixada agora), o relogio para
// o "há 2 min" e o "Fixar ao enviar" (sendTeamMessage com `pin`, aviso "Mensagem fixada."); as Enquetes recebem a
// enquete fixada do retrato (pinnedPollId), o Fixar e o Desafixar (pinPoll, unpinPoll) e o "Abrir e fixar" (launchPoll
// com `pin`), com os avisos "Enquete fixada." e "Enquete desafixada.". A entrada Na tela (R3 e R4, console-screen.tsx):
// o que esta na tela com os numeros, os prontos e os formularios do banner e do QR Code (saveScreenItem, depois
// showScreenItem no Mostrar agora; uploadScreenImage; showScreenItem, hideScreenItem e archiveScreenItem), com os avisos
// "Na tela dos alunos em até 5 s.", "Saiu da tela.", "Salvo nos prontos." e "Excluído dos prontos."; o contador da
// entrada (consoleScreenCount) e, no palco da live, a pilula "Na tela: Banner · QR Code" (screenStageKinds). A
// moderacao por pessoa na Live gravada (R5, §6.2): o ⋯ de cada mensagem da turma com os mesmos itens da live sem os do
// video (recordedPersonMenu: Silenciar 5/15/60 min e ate o fim, Remover da sala e Banir, desligado sem messaging.publish
// com a frase), os rotulos do autor barrado na mensagem e o bloco "Removidos, silenciados e banidos" do retrato
// (snapshot.barred) embaixo dos seletores do Chat, com os Desfazer; as acoes sao as mesmas da live (onPersonAction, sem
// o comando ao iframe: la nao ha sala). Adendo de 10/11/2026: a parte simulada do contador separada no selo dos
// presentes (R7) e o Roteiro tambem na sessao da Live ao vivo (R8, a fila pelo relogio desde o Começar para todos), com
// o "Novo comentário" (Enviar agora, Guardar na lista) e a foto de quem comenta (R9; uploadPersonaPhoto). A "Nova
// enquete" das Enquetes (D83, 11/11/2026): createConsolePoll guarda nas prontas e, no "Abrir agora" e no "Abrir e
// fixar", abre (e fixa) na sessao, com os avisos "Enquete guardada nas prontas.", "Enquete aberta para a turma." e
// "Enquete fixada."; abrir que falha depois de guardar vai para o banner do console (a enquete ja esta nas prontas).

const copy = WEBINAR_ADMIN_COPY.console;
const liveCopy = WEBINAR_COPY.consoleAoVivo;
const naTelaCopy = WEBINAR_COPY.naTela.console;
const comentariosCopy = WEBINAR_COPY.naTela.comentarios;
const novaEnqueteCopy = WEBINAR_ADMIN_COPY.console.polls.create;

type Failure = { message: string; status: number };

type SessionConsoleProps = {
  currentUserId: string;
  data: SessionConsoleData;
  /** A leitura do retrato na montagem (o teste de tela; o console sempre comeca respondendo). */
  initialPoll?: ConsolePoll;
  /** O nonce da pagina (cabecalho x-nonce do src/proxy.ts) para o <script> da sala ao vivo. */
  nonce?: string | null;
  permissions: WebinarPermissions;
  /** Hora do servidor na carga, para o skew do relogio da sessao. */
  serverNow: number;
  /** WEBINAR_TRANSLATION_ENABLED=on (lido no servidor): o "Refazer tradução" das mensagens. */
  translationEnabled?: boolean;
};

type BanTarget = { name: string; participantId: string | null; userId: string };

export function SessionConsole({ currentUserId, data, initialPoll = CONSOLE_POLL_START, nonce = null, permissions, serverNow, translationEnabled = false }: SessionConsoleProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(data.snapshot);
  const [skew] = useState(() => serverNow - Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // A leitura do retrato: o que a regiao viva do Atualizar diz e a faixa do sem resposta (consolePollStep); e quantas
  // leituras estao a caminho (o giro do icone; o clique no Atualizar durante uma leitura fica sem efeito).
  const [poll, setPoll] = useState<ConsolePoll>(initialPoll);
  const [reading, setReading] = useState(false);
  const readsRef = useRef(0);
  const [confirming, setConfirming] = useState<"end" | "open" | null>(null);
  const [confirmingLiveEnd, setConfirmingLiveEnd] = useState(false);
  const [banTarget, setBanTarget] = useState<BanTarget | null>(null);
  const [banReason, setBanReason] = useState("");
  const [recordUnavailable, setRecordUnavailable] = useState(false);
  const [attendance, setAttendance] = useState<AttendanceSnapshot | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Onde as confirmacoes e os menus do console abrem: dentro da raiz, no tema (o ConsoleShell liga o ref ao div). */
  const portalRef = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useConsoleTheme();
  const [panelOpen, setPanelOpen] = useConsolePanelOpen();
  /** A aba ou a entrada do ⋯ escolhida no painel, so na memoria da pagina (o Chat ao abrir). */
  const [panelView, setPanelView] = useState<ConsolePanelView>({ tab: "chat" });
  // O tema do console vai ao iframe na montagem (no hash, para o CSS da instancia); trocar depois nao remonta a sala.
  const look = useMemo<LiveEmbedLook>(() => ({ layout: "stage", theme }), [theme]);
  const session = snapshot?.session ?? null;
  const sessionId = session?.id ?? null;
  const webinar = data.webinar;
  const durationMs = sessionDurationMs(webinar.recordingDurationSeconds, webinar.durationMinutes);
  const nowMs = tick + skew;
  // O topo conta o tempo da sessao (desde o Iniciar live na ao vivo) e para no encerramento; o roteiro segue o relogio
  // dele (consoleScriptClockMs: o do video na gravada, consoleOffsetMs; desde o Começar para todos na Live ao vivo, R8).
  const clockMs = session ? consoleClockMs(session, durationMs, nowMs) : Number.NaN;
  const phase = session ? consolePhaseOf(session, durationMs, nowMs) : null;
  const canAct = session ? canTeamActOn(session) : false;
  const scriptClockMs = session ? consoleScriptClockMs(session, tick, skew) : Number.NaN;
  // Na Live ao vivo no ar, o tick ainda solta o item ate 5 min atrasado: so depois disso, "Minuto já passou".
  const scriptLateMs = session?.kind === "live" && session.status === "live" ? LIVE_SCRIPT_LATE_MAX_MS : 0;
  const queue = useMemo(() => (snapshot ? scriptQueue(snapshot.scriptItems, snapshot.scriptFired, scriptClockMs, { lateMs: scriptLateMs }) : []), [snapshot, scriptClockMs, scriptLateMs]);
  const live = session?.kind === "live" ? (snapshot?.live ?? null) : null;
  const livePeople = useMemo(() => new Map((live?.people ?? []).map((person) => [person.userId, person])), [live]);
  // A Live gravada: os barrados do retrato e os itens por pessoa sem sala (silenciar, remover e banir; nada de video).
  const recorded = session?.kind === "simulated";
  const barredPeople = useMemo(() => new Map((recorded ? (snapshot?.barred ?? []) : []).map((person) => [person.userId, person])), [recorded, snapshot]);
  const recordedControls = useMemo(() => ({ ...liveControlsFor({ canPublish: permissions.canPublish, moderator: true, role: "team" }), cameras: false, stage: false }), [permissions.canPublish]);

  const markAnchor = useCallback(async () => {
    if (!sessionId) {
      return false;
    }

    const result = await markRecordingAnchor({ sessionId });

    if (!result.ok) {
      setFailure({ message: result.error, status: result.status });
      return false;
    }

    return true;
  }, [sessionId]);

  // A reserva "Gravar no navegador" ligou ou desligou: a sessao guarda para o selo Gravando do aluno (sem toast: o
  // proximo retrato mostra; uma falha so deixa o selo esperar a leitura seguinte).
  const onBrowserRecording = useCallback(
    (on: boolean) => {
      if (sessionId) {
        void setBrowserRecording({ on, sessionId });
      }
    },
    [sessionId]
  );

  const room = useLiveRoom({
    canPublish: permissions.canPublish,
    container: stageRef,
    currentUserId,
    enabled: live !== null,
    live,
    look,
    nonce,
    onAnchor: markAnchor,
    onBrowserRecording,
    // O Remover do ⋮ da miniatura do video com o aluno ligado a linha: o mesmo Remover da lista (o registro, depois o motor).
    // O ⋮ do motor nao fica desligado com outra acao da mesa em andamento: em vez de nada acontecer, o aviso de tentar de novo.
    onKickPerson: (person, participantId) => {
      if (busyKey) {
        adminToast.info(WEBINAR_COPY.consoleV2.pessoas.tenteDeNovo);
        return;
      }
      onPersonAction(person, participantId, { type: "kick" });
    },
    session,
    webinar
  });

  // Sair da pagina com o console dentro da sala (docs/31 §10): a sala mora nesta pagina, e trocar de pagina na mesma aba
  // tirava quem apresenta da sala para todos (o video parado para quem assiste) ate ele voltar. A guarda segura o link,
  // o Voltar do navegador e o seletor de sessoes e pergunta; o Sair confirmado sai da sala antes de trocar de pagina.
  const [leaveTarget, setLeaveTarget] = useState<ConsoleLeaveTarget | null>(null);
  const [leaving, setLeaving] = useState(false);
  const guarded = consoleLeaveGuarded({ joined: room.joined });
  const leaveGuard = useConsoleLeaveGuard({ active: guarded, onAsk: setLeaveTarget });
  const frameStatusRef = useRef(room.frameStatus);

  useEffect(() => {
    frameStatusRef.current = room.frameStatus;
  });

  // Fora da sala (encerrou, caiu), a pergunta que estava aberta nao vale mais: a saida segue sem ela (a troca e lida
  // no desenho, sem efeito).
  const [wasGuarded, setWasGuarded] = useState(guarded);
  if (wasGuarded !== guarded) {
    setWasGuarded(guarded);
    if (!guarded && !leaving) {
      setLeaveTarget(null);
    }
  }

  /** O Sair confirmado: solta a guarda, sai da sala (quem assiste ve a saida na hora) e so entao troca de pagina. */
  async function leaveConsole() {
    const target = leaveTarget;
    if (!target || leaving) {
      return;
    }
    setLeaving(true);
    leaveGuard.allow();
    if (room.command("hangup")) {
      const started = Date.now();
      await new Promise<void>((resolve) => {
        const check = () => {
          if (frameStatusRef.current !== "joined" || Date.now() - started >= CONSOLE_LEAVE_WAIT_MS) {
            resolve();
          } else {
            window.setTimeout(check, 100);
          }
        };
        check();
      });
    }
    if (target.kind === "back") {
      window.history.back();
      return;
    }
    const next = new URL(target.href, window.location.href);
    if (next.origin === window.location.origin) {
      router.push(`${next.pathname}${next.search}${next.hash}`);
    } else {
      window.location.assign(next.href);
    }
  }

  /** Abrir em nova aba: o mesmo endereco noutra aba; o console e a sala ficam onde estao. */
  function leaveInNewTab() {
    if (leaveTarget?.href) {
      window.open(leaveTarget.href, "_blank", "noopener");
    }
    setLeaveTarget(null);
  }

  // O relogio da tela anda a cada segundo; o skew foi medido na carga (hora do servidor menos a do aparelho).
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1_000);

    return () => window.clearInterval(id);
  }, []);

  /**
   * Le o retrato de novo. So o clique no Atualizar fala na regiao viva ("Atualizando…"); o laco de 5 s, a volta a aba e o
   * retrato depois de cada acao ficam quietos, e o sem resposta so fala na passagem (consolePollStep). O Atualizar nunca
   * fica desligado durante a leitura (o foco do teclado cairia no comeco da pagina a cada 5 s): o clique so nao faz nada.
   */
  const refresh = useCallback(
    async (origin: ConsolePollOrigin = "auto") => {
      if (!sessionId || (origin === "click" && readsRef.current > 0)) {
        return;
      }

      readsRef.current += 1;
      setReading(true);
      setPoll((current) => consolePollStep(current, { origin, step: "start" }));

      try {
        const response = await fetch(`/api/admin/webinars/${webinar.id}/console?sessao=${encodeURIComponent(sessionId)}`, { cache: "no-store", credentials: "same-origin" });

        if (!response.ok) {
          throw new Error(String(response.status));
        }

        const body = (await response.json()) as { data: ConsoleSnapshot };
        setSnapshot(body.data);
        setPoll((current) => consolePollStep(current, { origin, step: "ok" }));
      } catch {
        setPoll((current) => consolePollStep(current, { origin, step: "fail" }));
      } finally {
        readsRef.current -= 1;
        setReading(readsRef.current > 0);
      }
    },
    [sessionId, webinar.id]
  );

  // A cada 5 s (so com a aba visivel) e ao voltar para a aba.
  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let timer: number | null = null;
    let stopped = false;

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (!stopped && document.visibilityState === "visible") {
          await refresh();
        }

        if (!stopped) {
          schedule();
        }
      }, CONSOLE_POLL_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }

      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, sessionId]);

  /** Roda uma acao da mesa: banner no erro, retrato novo no sucesso. Devolve se deu certo. */
  async function run<T>(key: string, action: () => Promise<ActionResult<T>>, onOk?: (data: T) => void): Promise<boolean> {
    if (busyKey) {
      return false;
    }

    setBusyKey(key);
    setFailure(null);
    const result = await action();
    setBusyKey(null);

    if (!result.ok) {
      setFailure({ message: Object.values(result.fieldErrors ?? {})[0]?.[0] ?? result.error, status: result.status });
      return false;
    }

    onOk?.(result.data);
    await refresh();
    return true;
  }

  async function openNow() {
    if (!sessionId) {
      return;
    }

    const ok = await run("open", () => openSessionNow({ sessionId }));
    setConfirming(null);

    if (ok) {
      adminToast.success(WEBINAR_ADMIN_COPY.toasts.opened);
      router.refresh();
    }
  }

  async function endNow() {
    if (!sessionId) {
      return;
    }

    const ok = await run("end", () => endSessionNow({ sessionId }));
    setConfirming(null);

    if (ok) {
      adminToast.success(WEBINAR_ADMIN_COPY.toasts.ended);
      router.refresh();
    }
  }

  function changeSession(nextId: string) {
    const href = webinarConsoleHref(webinar.id, nextId);
    // Trocar de sessao remonta o console (a chave da pagina): dentro da sala, pergunta antes, como qualquer saida.
    if (guarded) {
      setLeaveTarget({ href, kind: "session" });
      return;
    }
    router.push(href);
  }

  /* Live ao vivo: situacao da sessao */

  async function openRoom() {
    if (sessionId && (await run("live:open", () => openLiveRoom({ sessionId })))) {
      router.refresh();
    }
  }

  async function startForAll() {
    if (!sessionId || !live) {
      return;
    }

    const ok = await run("live:start", () => startLiveSession({ sessionId }), () =>
      room.syncLobby(desiredLobby({ practiceSession: webinar.practiceSession !== false, roomLocked: live.roomLocked, status: "live", waitingRoom: webinar.waitingRoom === true }))
    );

    if (ok) {
      router.refresh();
    }
  }

  /** Encerrar live: para a gravacao, encerra no servidor e so entao fecha a sala para todos (endConference) e sai. */
  async function endLive() {
    if (!sessionId || !live) {
      return;
    }

    if (room.room.recording.on || live.recorder.status === "recording") {
      room.command("stopRecording", room.room.recording.mode === "local" ? "local" : "file");
    }

    const ok = await run("live:end", () => endLiveSession({ sessionId }), () => {
      room.command("endConference");
      room.command("hangup");
    });
    setConfirmingLiveEnd(false);

    if (ok) {
      adminToast.success(WEBINAR_ADMIN_COPY.toasts.ended);
      router.refresh();
    }
  }

  function lockRoom(locked: boolean) {
    if (!sessionId || !live || !session) {
      return;
    }

    void run("live:lock", () => setRoomLock({ locked, sessionId }), () =>
      room.syncLobby(desiredLobby({ practiceSession: webinar.practiceSession !== false, roomLocked: locked, status: session.status, waitingRoom: webinar.waitingRoom === true }))
    );
  }

  // O microfone sozinho (docs/31 caminho A): grava (so quem apresenta, conferido no servidor), depois o console manda a sala.
  function selfUnmuteNow(allowed: boolean) {
    if (!sessionId || !live) {
      return;
    }

    void run("live:mic-self", () => setSelfUnmute({ allowed, sessionId }), () => room.applySelfUnmute(allowed));
  }

  /* Live ao vivo: gravacao */

  function recordNow() {
    if (!sessionId) {
      return;
    }

    void run("live:rec-start", () => requestRecording({ sessionId }), (reply) => {
      setRecordUnavailable(reply.action === "unavailable");

      if (reply.action === "start") {
        room.command("startRecording", { mode: "file" });
      }
    });
  }

  function stopRecording() {
    room.command("stopRecording", room.room.recording.mode === "local" ? "local" : "file");
  }

  async function attach(input: AttachInput): Promise<boolean> {
    if (!sessionId) {
      return false;
    }

    return run("live:attach", () => attachRecording({ ...input, sessionId }), () => adminToast.success(liveCopy.gravacaoLigada));
  }

  /* Live ao vivo: pessoas (na sala e no chat) */

  function onPersonAction(person: LiveConsolePerson | null, participantId: string | null, action: PersonAction) {
    if (!sessionId) {
      return;
    }

    switch (action.type) {
      case "spotlight":
        if (!participantId) {
          return;
        }
        if (action.on) {
          room.command("setLargeVideoParticipant", participantId);
          room.command("pinParticipant", participantId);
        } else {
          room.command("pinParticipant");
          room.command("setLargeVideoParticipant");
        }
        room.dispatch({ id: action.on ? participantId : null, type: "spotlight" });
        return;
      case "stage":
        if (!participantId) {
          return;
        }
        if (action.on) {
          room.command("askToUnmute", participantId);
          room.command("approveVideo", participantId);
        } else {
          room.command("muteRemoteParticipant", participantId, "audio");
          room.command("muteRemoteParticipant", participantId, "video");
          room.command("rejectParticipant", participantId, "audio");
          room.command("rejectParticipant", participantId, "video");
          if (room.room.spotlight === participantId) {
            room.command("pinParticipant");
            room.command("setLargeVideoParticipant");
          }
        }
        room.dispatch({ id: participantId, on: action.on, type: "stage" });
        return;
      case "closeCamera":
        if (participantId) {
          room.command("muteRemoteParticipant", participantId, "video");
        }
        return;
      default:
        break;
    }

    if (!person) {
      return;
    }

    const userId = person.userId;
    const key = `person:${userId}`;

    switch (action.type) {
      case "mute":
        void run(key, () => muteInChat({ minutes: action.minutes, sessionId, userId }));
        return;
      case "kick":
        void run(key, () => kickFromSession({ sessionId, userId }), () => {
          if (participantId) {
            room.command("kickParticipant", participantId);
            room.dispatch({ id: participantId, type: "kicked" });
          }
        });
        return;
      case "ban":
        setBanReason("");
        setBanTarget({ name: person.displayName, participantId, userId });
        return;
      case "undo":
        void run(key, () => undoSessionBan({ kind: action.kind, sessionId, userId }));
        return;
      case "unban":
        void run(key, () => unbanStudent({ userId }));
        return;
      default:
        return;
    }
  }

  /* Na tela: o banner e o QR Code */

  /**
   * O "Novo comentário" do Roteiro (R8 e R9): "Enviar agora" solta o comentario no chat da sessao (sendScriptedComment) e
   * "Guardar na lista" vira um item "Pelo botão da equipe" (saveScriptComment). Devolve o resultado para o formulario
   * mostrar os erros por campo (nulo: outra acao em andamento); no sucesso, o aviso e o retrato de novo.
   */
  async function submitComment(input: ScriptCommentFormInput, mode: "save" | "send") {
    if (!sessionId || busyKey) {
      return null;
    }
    setBusyKey("script:comment");
    setFailure(null);
    const payload = { ...input, sessionId };
    const result = mode === "send" ? await sendScriptedComment(payload) : await saveScriptComment(payload);
    setBusyKey(null);
    if (result.ok) {
      adminToast.success(mode === "send" ? comentariosCopy.avisos.enviado : comentariosCopy.avisos.guardado);
      if (result.data.photoApplied > 0 && input.personaAvatarPath) {
        adminToast.info(comentariosCopy.avisos.fotoEmTodos(input.personaName, result.data.photoApplied));
      }
      await refresh();
    }
    return result;
  }

  /**
   * A "Nova enquete" das Enquetes (D83): guarda nas prontas e, no "Abrir agora" e no "Abrir e fixar", abre (e fixa) na
   * sessao (createConsolePoll). Devolve o resultado para o formulario pôr os erros nos campos (nulo com outra acao em
   * andamento); abrir que falha depois de guardar (`launchError`) vai para o banner do console, porque a enquete ja esta
   * nas prontas e o formulario fecha. No sucesso, o aviso e o retrato de novo (a lista das prontas com a nova).
   */
  async function submitPoll(input: ConsolePollFormInput, launch: ConsolePollLaunch) {
    if (!sessionId || busyKey) {
      return null;
    }
    setBusyKey("poll:create");
    setFailure(null);
    const result = await createConsolePoll({ ...input, launch, sessionId });
    setBusyKey(null);
    if (result.ok) {
      if (result.data.launchError) {
        setFailure(result.data.launchError);
      } else if (launch === "save") {
        adminToast.success(novaEnqueteCopy.avisos.guardada);
      } else {
        adminToast.success(launch === "pin" && result.data.pinned ? naTelaCopy.avisos.enqueteFixada : novaEnqueteCopy.avisos.aberta);
      }
      await refresh();
    }
    return result;
  }

  /**
   * O Excluir confirmado de um banner ou QR Code pronto: o resultado volta para a confirmacao, que mostra a falha dentro
   * dela (o banner do console fica por baixo do dialogo); no sucesso, o aviso e o retrato de novo.
   */
  async function archiveScreen(itemId: string) {
    if (busyKey) {
      return null;
    }
    setBusyKey(`screen:${itemId}`);
    setFailure(null);
    const result = await archiveScreenItem({ id: itemId });
    setBusyKey(null);
    if (result.ok) {
      adminToast.success(naTelaCopy.avisos.excluido);
      await refresh();
    }
    return result;
  }

  /**
   * O Salvar do formulario do banner e do QR Code: salva e, no Mostrar agora, mostra na sessao. Devolve o resultado do
   * salvar para o formulario pôr os erros nos campos (nulo com outra acao em andamento); a falha do Mostrar depois de
   * salvo vai para o banner do console (o item ja esta nos prontos).
   */
  async function saveScreen(input: ScreenItemSaveInput, show: boolean) {
    if (!sessionId || busyKey) {
      return null;
    }

    setBusyKey("screen:save");
    setFailure(null);
    const saved = await saveScreenItem(input);

    if (!saved.ok) {
      setBusyKey(null);
      return saved;
    }

    if (show) {
      const shown = await showScreenItem({ itemId: saved.data.item.id, sessionId });

      if (shown.ok) {
        adminToast.success(naTelaCopy.avisos.naTela);
      } else {
        setFailure({ message: shown.error, status: shown.status });
      }
    } else {
      adminToast.success(naTelaCopy.avisos.salvo);
    }

    setBusyKey(null);
    await refresh();
    return saved;
  }

  async function confirmBan() {
    if (!sessionId || !banTarget) {
      return;
    }

    const target = banTarget;
    const ok = await run(`person:${target.userId}`, () => banStudent({ reason: banReason.trim() || undefined, sessionId, userId: target.userId }), () => {
      if (target.participantId) {
        room.command("kickParticipant", target.participantId);
        room.dispatch({ id: target.participantId, type: "kicked" });
      }
    });

    if (ok) {
      setBanTarget(null);
    }
  }

  // Os itens da pessoa no ⋯ de uma mensagem da turma (Silenciar, Remover, Banir); nada para a equipe e para quem o
  // retrato nao liga. Sem o participante (participantId nulo), os itens da sala ficam de fora.
  function chatPersonMenu(message: ConsoleMessage) {
    const person = message.authorUserId ? (livePeople.get(message.authorUserId) ?? null) : null;

    if (!person || person.staff || !livePersonMenuGroups({ controls: room.controls, participantId: null, person }).any) {
      return null;
    }

    return (
      <LivePersonMenuItems
        canPublish={permissions.canPublish}
        controls={room.controls}
        joined={room.joined}
        onAction={(action) => onPersonAction(person, person.participantId, action)}
        participantId={null}
        person={person}
      />
    );
  }

  /**
   * A pessoa de uma mensagem da turma na Live gravada: a do retrato quando esta barrada (com o estado, para os Desfazer
   * do ⋯), senao pelo nome da mensagem e sem banimento. Nada para quem nao e aluno (o servidor tambem recusa a equipe).
   */
  function recordedPersonOf(message: ConsoleMessage): LiveConsolePerson | null {
    if (!message.authorUserId || message.source !== "audience" || message.role !== "student") {
      return null;
    }
    return barredPeople.get(message.authorUserId) ?? { ban: NO_BAN, displayName: message.displayName, joinedAt: null, participantId: null, staff: false, userId: message.authorUserId };
  }

  // Os itens da pessoa no ⋯ de uma mensagem da turma na Live gravada (sem participante: so as acoes do servidor).
  function recordedPersonMenu(message: ConsoleMessage) {
    const person = recordedPersonOf(message);

    if (!person) {
      return null;
    }

    return <LivePersonMenuItems canPublish={permissions.canPublish} controls={recordedControls} joined={false} onAction={(action) => onPersonAction(person, null, action)} participantId={null} person={person} />;
  }

  /** Os rotulos do autor barrado (na live, pela lista da sala; na gravada, pelo retrato). */
  function personBadgesOf(message: ConsoleMessage): readonly string[] {
    const person = message.authorUserId ? (live ? livePeople.get(message.authorUserId) : barredPeople.get(message.authorUserId)) : undefined;
    return person && !person.staff ? banLabels(person.ban) : [];
  }

  const sessionDisabledTitle = room.controls.sessionEnabled ? undefined : LIVE_CONSOLE_COPY.soQuemPublica;
  const topActions =
    session && phase
      ? consoleTopActionsFor({ canPublish: permissions.canPublish, controls: room.controls, kind: session.kind, phase, status: session.status })
      : [];
  // Sem palco (a gravada e o Replay) o painel nunca fecha: ele e o corpo inteiro.
  const panelShown = live === null || panelOpen;
  const skeleton = consoleSkeleton({ hasStage: live !== null, panelOpen });
  const tabs = session ? consoleTabsFor({ kind: session.kind }) : [];
  const entries = session ? consoleMoreEntriesFor({ hasPresence: Boolean(snapshot?.presence), kind: session.kind, webinarKind: webinar.kind }) : [];
  const shownView = consolePanelViewOf({ entries, tabs, view: panelView });
  const screen = snapshot?.screen ?? { active: [], items: [], pending: false, stats: {} };
  const counts = { ...consoleTabCounts({ hands: live ? handRows(room.room, live.people).length : 0, questions: snapshot?.questions ?? [] }), tela: consoleScreenCount({ active: screen.active, pinnedMessageId: snapshot?.pinnedMessageId ?? null }) };
  const stageKinds = screenStageKinds(screen.active);
  // R7: a parte simulada do contador vem separada no fim ("· +300 simulados"), so para a equipe.
  const presentLabel = session ? consolePresenceBadge({ peak: snapshot?.presence?.peak?.present ?? null, presentNow: snapshot?.presentNow ?? 0, simulated: snapshot?.simulatedNow ?? null }) : null;
  // O nome do apresentador da pagina (o perfil de quem apresenta, lido no servidor) para o selo de outro moderador no
  // video grande, como o aluno ve (docs/31 V2-A25), em todo console, inclusive no do proprio Apresentador.
  const presenterName = live ? (webinar.presenterName ?? null) : null;

  function onTopAction(id: "end_live" | "end_session" | "open_room" | "open_session" | "start") {
    switch (id) {
      case "open_room":
        void openRoom();
        return;
      case "start":
        void startForAll();
        return;
      case "end_live":
        setConfirmingLiveEnd(true);
        return;
      case "open_session":
        setConfirming("open");
        return;
      case "end_session":
        setConfirming("end");
        return;
      default:
        return;
    }
  }

  /**
   * Abre o painel na aba ou na entrada do ⋯ (Mãos, Lançar enquete e o Gravar por preparar, na barra) e leva o foco a ela,
   * depois de o painel aparecer: o item do trilho a partir de lg (com palco), a aba ou o ⋯ do painel abaixo de lg.
   */
  function openPanel(view: ConsolePanelView) {
    setPanelOpen(true);
    setPanelView(view);
    window.requestAnimationFrame(() => {
      visibleConsoleTabControl(document, "tab" in view ? view.tab : view.more)?.focus();
    });
  }

  /**
   * O X do painel (so a partir de lg): o foco vai ao item do trilho do que estava na tela antes de o painel sumir (senao
   * ele cairia no body); sem o trilho na tela, ao balao da barra.
   */
  function closePanel() {
    const target = visibleConsoleTabControl(document, "tab" in shownView ? shownView.tab : shownView.more) ?? document.querySelector<HTMLButtonElement>('[data-console-bar] [data-room-bar-item="panel"]');
    target?.focus();
    setPanelOpen(false);
  }

  /**
   * O toque num item do trilho (uma aba ou uma entrada, no trilho ou no Mais): abre o painel nele ou, no que ja esta na
   * tela, fecha o painel (consoleRailStep).
   */
  function onRail(item: ConsolePanelView) {
    const next = consoleRailStep({ closable: live !== null, item, panelShown, view: shownView });
    setPanelView(next.view);
    setPanelOpen(next.panelOpen);
  }


  const readOnly = Boolean(session) && !canAct;
  const onlyPublishers = live !== null && room.controls.session && !room.controls.sessionEnabled;
  // Sem resposta do retrato, na tela (docs/31 V2-A50): o chat, as pendentes, as perguntas e os presentes param de
  // atualizar, e quem apresenta precisa saber que modera dados velhos.
  const offline = Boolean(sessionId) && poll.offline;
  const banner =
    failure || offline || readOnly || onlyPublishers ? (
      <>
        {offline ? (
          <p className="text-[13px] leading-5 font-medium text-room-warn-fg" data-console-offline="">
            {WEBINAR_COPY.consoleV2.semResposta}
          </p>
        ) : null}
        {failure ? (
          <ErrorBanner
            action={
              <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
                {WEBINAR_COPY.consoleV2.fecharAviso}
              </Button>
            }
            title={failure.status === 409 ? WEBINAR_ADMIN_COPY.failures.conflictTitle : WEBINAR_ADMIN_COPY.failures.generic}
          >
            {failure.message}
          </ErrorBanner>
        ) : null}
        {readOnly ? <p className="text-[13px] leading-5 text-room-fg-muted">{copy.readOnly}</p> : null}
        {onlyPublishers ? <p className="text-[13px] leading-5 text-room-fg-muted">{LIVE_CONSOLE_COPY.soQuemPublica}</p> : null}
      </>
    ) : null;

  const top = (
    <ConsoleTopBar
      actions={topActions}
      busyKey={busyKey}
      canWrite={permissions.canWrite}
      className={skeleton.top}
      clockLabel={session && phase && !live ? consoleClockLabel(clockMs, phase) : ""}
      disabledTitle={sessionDisabledTitle}
      editorHref={webinarAdminHref(webinar.id)}
      onAction={onTopAction}
      onBlocked={(reason) => adminToast.info(reason)}
      onChangeSession={changeSession}
      onLock={lockRoom}
      onRefresh={() => void refresh("click")}
      onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
      poll={poll}
      presentLabel={presentLabel}
      presentNarrowOnly={live !== null}
      reading={reading}
      reportHref={webinarReportHref(webinar.id)}
      roomLocked={live?.roomLocked === true}
      sessionId={sessionId}
      sessions={data.sessions}
      theme={theme}
      title={webinar.title}
    />
  );

  return (
    <>
      <ConsoleShell banner={banner} classNames={skeleton} portalRef={portalRef} theme={theme} top={top}>
        {!snapshot || !session ? (
          <div className={skeleton.body}>
            <div className={skeleton.panel}>
              <EmptyState description={WEBINAR_ADMIN_COPY.simulation.noSessions} title={WEBINAR_ADMIN_COPY.fields.sessionsEmpty} />
            </div>
          </div>
        ) : (
          <div className={skeleton.body} data-console-slot="body">
            {live && skeleton.stageColumn ? (
              <div className={skeleton.stageColumn} data-console-slot="stage-column" data-live-console="">
                <ConsoleStage
                  busy={busyKey !== null}
                  className={skeleton.stage ?? ""}
                  handle={room}
                  live={live}
                  presentLabel={presentLabel}
                  presenterName={presenterName}
                  screenLabel={stageKinds.length > 0 ? naTelaCopy.pilulaPalco(stageKinds.map((kind) => WEBINAR_COPY.naTela.tipos[kind])) : null}
                  session={session}
                  stageRef={stageRef}
                  topLeft={consoleStageTopLeft({ durationMs, nowMs: tick, session, skewMs: skew })}
                />
                <div className={skeleton.bar ?? ""} data-console-slot="bar">
                  <ConsoleBar
                    busyKey={busyKey}
                    canPublish={permissions.canPublish}
                    handle={room}
                    handsCount={counts.maos}
                    live={live}
                    nowMs={nowMs}
                    onOpenPanel={openPanel}
                    onRecord={recordNow}
                    onStopRecording={stopRecording}
                    onTogglePanel={() => setPanelOpen(!panelOpen)}
                    panelOpen={panelOpen}
                    session={session}
                  />
                </div>
              </div>
            ) : null}
            <ConsolePanel
              className={skeleton.panel}
              closable={live !== null}
              rail={skeleton.rail !== null}
              counts={counts}
              entries={entries}
              more={{
                atendimento: (
                  // docs/30 §2.4 e D24 (fase 4c): o Atendimento le pelo proprio pedido e sobe as marcas para as Perguntas; fica
                  // montado (a batida de 30 s de quem atende) com qualquer aba na tela.
                  <ConsoleAttendance canAct={canAct} currentUserId={currentUserId} key={session.id} onSnapshot={setAttendance} sessionId={session.id} webinarId={webinar.id} />
                ),
                enquetes: (
                  <ConsolePolls
                    busyKey={busyKey}
                    canAct={canAct}
                    launched={snapshot.polls.launched}
                    onClose={(pollId: string, shareResults: boolean) => void run(`poll:${pollId}`, () => closePoll({ pollId, sessionId: session.id, shareResults }))}
                    onCreate={submitPoll}
                    onLaunch={(pollId: string, pin: boolean) =>
                      void run(`poll:${pollId}`, () => launchPoll({ pin, pollId, sessionId: session.id }), (launched) => {
                        if (pin && launched.pinned) {
                          adminToast.success(naTelaCopy.avisos.enqueteFixada);
                        }
                      })
                    }
                    onPin={(pollId: string) => void run(`poll:${pollId}`, () => pinPoll({ pollId, sessionId: session.id }), () => adminToast.success(naTelaCopy.avisos.enqueteFixada))}
                    onUnpin={(pollId: string) =>
                      void run(`poll:${pollId}`, () => unpinPoll({ sessionId: session.id }), (result) => {
                        if (result.unpinned) {
                          adminToast.success(naTelaCopy.avisos.enqueteDesafixada);
                        }
                      })
                    }
                    pinnedPollId={snapshot.pinnedPollId ?? null}
                    templates={snapshot.polls.templates}
                  />
                ),
                gravacao: live ? (
                  <>
                    <LiveRecorder
                      busyKey={busyKey}
                      canPublish={permissions.canPublish}
                      controls={room.controls}
                      joined={room.joined}
                      nowMs={nowMs}
                      onBrowserRecord={() => room.command("startRecording", { mode: "local", onlySelf: false })}
                      onPrepare={() => void run("live:rec-prepare", () => prepareRecorder({ sessionId: session.id }))}
                      onRelease={() => void run("live:rec-release", () => releaseRecorder({ sessionId: session.id }))}
                      recorder={live.recorder}
                      recording={room.room.recording}
                      status={session.status}
                      unavailable={recordUnavailable}
                    />
                    {live.recording ? (
                      <LiveAlignChat
                        busyKey={busyKey}
                        canWrite={permissions.canWrite}
                        key={`${live.recording.id}:${live.recording.anchorOffsetMs}`}
                        messages={snapshot.messages}
                        onSave={(anchorOffsetMs) => {
                          const recordingId = live.recording?.id;
                          if (recordingId) {
                            void run("live:align", () => alignChat({ anchorOffsetMs, recordingId }), () => adminToast.success(liveCopy.alinharSalvo));
                          }
                        }}
                        recording={live.recording}
                      />
                    ) : null}
                    <LiveAttachRecording busyKey={busyKey} canWrite={permissions.canWrite} onAttach={attach} recording={live.recording} />
                  </>
                ) : null,
                // Fase 4b (docs/30 §2.4): a Oferta na sessao gravada e no Replay, com a propria leitura.
                oferta: session.kind !== "live" ? <ConsoleOffer canAct={canAct} sessionId={session.id} webinarId={webinar.id} /> : null,
                // docs/30 §2.4: a Presenca (pico, mensagens por minuto, curva dos ultimos 30 min), pela visao do relatorio em cache.
                presenca: snapshot.presence ? <ConsolePresencePanel presence={snapshot.presence} presentNow={snapshot.presentNow} /> : null,
                tela:
                  session.kind !== "replay" ? (
                    <ConsoleScreen
                      busyKey={busyKey}
                      canAct={canAct}
                      nowMs={nowMs}
                      onArchive={archiveScreen}
                      onHide={(displayId: string) => run(`screen:${displayId}`, () => hideScreenItem({ displayId }), () => adminToast.success(naTelaCopy.avisos.saiu))}
                      onSave={saveScreen}
                      onShow={(itemId: string) =>
                        void run(`screen:${itemId}`, () => showScreenItem({ itemId, sessionId: session.id }), () => adminToast.success(naTelaCopy.avisos.naTela))
                      }
                      onUnpinMessage={(messageId: string) => run(`moderate:${messageId}`, () => moderateMessage({ action: "unpin", messageId }))}
                      onUnpinPoll={(pollId: string) =>
                        run(`poll:${pollId}`, () => unpinPoll({ sessionId: session.id }), (result) => {
                          if (result.unpinned) {
                            adminToast.success(naTelaCopy.avisos.enqueteDesafixada);
                          }
                        })
                      }
                      onUpload={(image: string) => uploadScreenImage({ image })}
                      pinned={snapshot.pinned ?? null}
                      polls={snapshot.polls.launched}
                      screen={screen}
                      webinarId={webinar.id}
                      webinarSlug={webinar.slug}
                    />
                  ) : null,
                // O Roteiro na gravada e, desde o adendo de 10/11/2026 (R8), na sessao da Live ao vivo, com o "Novo comentário".
                roteiro:
                  webinar.kind === "simulated" || session.kind === "live" ? (
                    <ConsoleScript
                      busyKey={busyKey}
                      canAct={canAct}
                      live={session.kind === "live"}
                      onComment={submitComment}
                      onFire={(itemId: string) => void run(`fire:${itemId}`, () => fireScriptItem({ itemId, sessionId: session.id }))}
                      onUpload={(image: string) => uploadPersonaPhoto({ image })}
                      queue={queue}
                    />
                  ) : null
              }}
              onClose={closePanel}
              onView={setPanelView}
              open={panelShown}
              panes={{
                chat: (
                  <ConsoleChat
                    askedMessageIds={snapshot.askedMessageIds}
                    barred={
                      recorded && (snapshot.barred ?? []).length > 0 ? (
                        <LiveBarredList busyKey={busyKey} canPublish={permissions.canPublish} onAction={onPersonAction} people={snapshot.barred ?? []} />
                      ) : null
                    }
                    busyKey={busyKey}
                    canAct={canAct}
                    currentUserAvatarUrl={data.viewer?.avatarUrl ?? null}
                    currentUserId={currentUserId}
                    hostUserId={webinar.hostUserId}
                    messages={snapshot.messages}
                    onChatMode={(chatMode: ChatMode, slowModeSeconds: SlowModeSeconds | null) => void run("chat-mode", () => setSessionChatMode({ chatMode, sessionId: session.id, slowModeSeconds }))}
                    onEditAssistant={(messageId: string, body: string) =>
                      run(`moderate:${messageId}`, () => editAssistantAnswer({ body, messageId }), () => adminToast.success(WEBINAR_COPY.assistente.console.corrigida))
                    }
                    onModerate={(action: ModerationAction, messageId: string) => run(`moderate:${messageId}`, () => moderateMessage({ action, messageId }))}
                    onRetranslate={
                      translationEnabled
                        ? (messageId: string) =>
                            void run(
                              `moderate:${messageId}`,
                              () => clearMessageTranslations({ messageId }),
                              (cleared) => adminToast.success(cleared.removed > 0 ? WEBINAR_COPY.traducao.console.refeita(cleared.removed) : WEBINAR_COPY.traducao.console.semTraducao)
                            )
                        : null
                    }
                    nowMs={nowMs}
                    // Sem aviso: a mensagem enviada aparece na lista, como na sala do aluno. Com o "Fixar ao enviar", o
                    // aviso "Mensagem fixada." (a Na tela).
                    onSend={(body: string, pin: boolean) =>
                      run("send", () => sendTeamMessage({ body, pin, sessionId: session.id }), () => {
                        if (pin) {
                          adminToast.success(naTelaCopy.avisos.mensagemFixada);
                        }
                      })
                    }
                    personBadges={live || recorded ? personBadgesOf : null}
                    personMenu={live ? chatPersonMenu : recorded ? recordedPersonMenu : null}
                    pinned={snapshot.pinned ?? null}
                    pinnedMessageId={snapshot.pinnedMessageId}
                    session={session}
                    // A lista escondida (outra aba, uma entrada do ⋯, o painel fechado) nao rola com o que chega: ao
                    // voltar, quem estava no fim volta ao fim.
                    shown={panelShown && "tab" in shownView && shownView.tab === "chat"}
                  />
                ),
                maos: live ? <LiveHands handle={room} people={live.people} /> : null,
                perguntas: (
                  <ConsoleQuestions
                    busyKey={busyKey}
                    canAct={canAct}
                    currentUserAvatarUrl={data.viewer?.avatarUrl ?? null}
                    marks={attendance && attendance.sessionId === session.id ? attendance.questionMarks : null}
                    onAnswer={(questionId: string, answerText: string, answeredLive: boolean) => run(`question:${questionId}`, () => answerQuestion({ answerText: answerText || undefined, answeredLive, questionId }))}
                    onDeleteReply={(replyId: string) =>
                      run(`reply:${replyId}`, () => deleteQuestionReply({ replyId }), () => adminToast.success(WEBINAR_ADMIN_COPY.console.questions.replyDeleted))
                    }
                    onReply={(questionId: string, body: string) =>
                      run(`question:${questionId}`, () => replyToQuestion({ body, questionId }), () => adminToast.success(WEBINAR_ADMIN_COPY.console.questions.replied))
                    }
                    onStatus={(questionId: string, status: QuestionStatus) => void run(`question:${questionId}`, () => setQuestionStatus({ questionId, status }))}
                    questions={snapshot.questions}
                  />
                ),
                pessoas: live ? <ConsolePeopleTab busyKey={busyKey} canPublish={permissions.canPublish} handle={room} onAction={onPersonAction} onSelfUnmute={selfUnmuteNow} people={live.people} /> : null
              }}
              tabs={tabs}
              view={shownView}
            />
            {skeleton.rail ? <ConsoleRail className={skeleton.rail} counts={counts} entries={entries} onItem={onRail} panelShown={panelShown} tabs={tabs} view={shownView} /> : null}
          </div>
        )}
      </ConsoleShell>

      <ConsoleLeaveDialog container={portalRef} leaving={leaving} onLeave={() => void leaveConsole()} onNewTab={leaveInNewTab} onStay={() => setLeaveTarget(null)} open={leaveTarget !== null} />

      <ConfirmDialog
        busy={busyKey === "open" || busyKey === "end"}
        container={portalRef}
        confirmLabel={confirming === "end" ? copy.endConfirm.confirmLabel : copy.openConfirm.confirmLabel}
        description={confirming === "end" ? copy.endConfirm.description : copy.openConfirm.description}
        destructive={confirming === "end"}
        onConfirm={() => void (confirming === "end" ? endNow() : openNow())}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
          }
        }}
        open={confirming !== null}
        title={confirming === "end" ? copy.endConfirm.title : copy.openConfirm.title}
      />

      <ConfirmDialog
        busy={busyKey === "live:end"}
        container={portalRef}
        cancelLabel={liveCopy.cancelar}
        confirmLabel={liveCopy.encerrarLive}
        description={liveCopy.encerrarConfirmarTexto}
        destructive
        onConfirm={() => void endLive()}
        onOpenChange={(open) => setConfirmingLiveEnd(open)}
        open={confirmingLiveEnd}
        title={liveCopy.encerrarConfirmar}
      />

      <ConfirmDialog
        busy={banTarget !== null && busyKey === `person:${banTarget.userId}`}
        container={portalRef}
        cancelLabel={liveCopy.cancelar}
        confirmLabel={liveCopy.banir}
        description={liveCopy.banirConfirmarTexto}
        destructive
        onConfirm={() => void confirmBan()}
        onOpenChange={(open) => {
          if (!open) {
            setBanTarget(null);
          }
        }}
        open={banTarget !== null}
        title={liveCopy.banirConfirmar}
      >
        {banTarget ? (
          <p className="mb-3 text-sm leading-5 font-medium text-[var(--text-primary)]" data-live-ban-target={banTarget.userId}>
            {banTarget.name}
          </p>
        ) : null}
        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor="console-ban-reason">
          {liveCopy.motivo}
          <textarea className={cn(adminTextareaClass, "min-h-16")} id="console-ban-reason" maxLength={200} onChange={(event) => setBanReason(event.target.value)} rows={2} value={banReason} />
        </label>
      </ConfirmDialog>
    </>
  );
}
