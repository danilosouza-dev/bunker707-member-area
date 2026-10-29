"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { assign, loadAttendanceSnapshot, pingAttendant, setReplyAll } from "@/server/webinars/assistant-actions";
import { ATTENDANT_PING_MS, type AttendanceQueueItem } from "@/server/webinars/assistant-model";
import type { AttendanceSnapshot } from "@/server/webinars/assistant-queries";
import { CONSOLE_POLL_MS } from "@/server/webinars/console-model";
import { answerQuestion, sendTeamMessage } from "@/server/webinars/room-actions";
import { PendingMigrationNotice } from "../../../pending-migration-notice";
import { SectionCard } from "../../../settings/kit";
import { adminToast } from "../../../toast";
import { AttendancePanel } from "../assistant/attendance-panel";

// O painel Atendimento do console (docs/30 §2.4, fase 4; §1.6 e D24): quem da equipe esta atendendo, a distribuicao
// das perguntas novas (feita na propria leitura, loadAttendanceSnapshot, a cada 5 s com a aba visivel), Assumir,
// Devolver, Passar para, Responder, o "Pediu a equipe" e o "Responder tudo" do Assistente. "Atender" bate o
// "Atendendo agora" na hora e a cada 30 s enquanto o painel esta aberto (sem batida ha 90 s, a pessoa sai da
// distribuicao); "Pausar" marca ausente. Banco sem a 202610300004: o aviso da migracao. A leitura nova sobe para o
// console (`onSnapshot`), que mostra as marcas no painel Perguntas.

export type ConsoleAttendanceProps = {
  canAct: boolean;
  currentUserId: string;
  /** Fase 4c: o retrato novo sobe para o console (as marcas do painel Perguntas); nulo sem a migracao. */
  onSnapshot?: (snapshot: AttendanceSnapshot | null) => void;
  sessionId: string;
  webinarId: string;
};

type Loaded = { kind: "pending"; migration: string } | { kind: "ready"; snapshot: AttendanceSnapshot } | null;

const COPY = WEBINAR_COPY.assistente.console;

export function ConsoleAttendance({ canAct, currentUserId, onSnapshot, sessionId, webinarId }: ConsoleAttendanceProps) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [attending, setAttending] = useState<boolean | null>(null);
  const snapshotRef = useRef(onSnapshot);

  useEffect(() => {
    snapshotRef.current = onSnapshot;
  });

  const refresh = useCallback(async () => {
    try {
      const result = await loadAttendanceSnapshot({ sessionId });
      if (!result.ok) {
        setError(result.error || COPY.erroCarregar);
        return;
      }
      setError(null);
      if (result.data.pendingMigration) {
        setLoaded({ kind: "pending", migration: result.data.migration });
        snapshotRef.current?.(null);
        return;
      }
      const snapshot: AttendanceSnapshot = result.data;
      setLoaded({ kind: "ready", snapshot });
      setAttending((current) => current ?? snapshot.me.online);
      snapshotRef.current?.(snapshot);
    } catch {
      setError(COPY.erroCarregar);
    }
  }, [sessionId]);

  // A cada 5 s com a aba visivel, e ao voltar para a aba.
  useEffect(() => {
    let stopped = false;
    const first = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => {
      if (!stopped && document.visibilityState === "visible") {
        void refresh();
      }
    }, CONSOLE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // "Atendendo agora": a batida a cada 30 s enquanto a pessoa atende (o servidor tira da distribuicao sem batida).
  useEffect(() => {
    if (!attending || !canAct) {
      return;
    }
    const id = window.setInterval(() => {
      void pingAttendant({ sessionId, status: "online" });
    }, ATTENDANT_PING_MS);
    return () => window.clearInterval(id);
  }, [attending, canAct, sessionId]);

  async function run<T>(key: string, action: () => Promise<ActionResult<T>>, success?: string): Promise<boolean> {
    if (busyKey) {
      return false;
    }
    setBusyKey(key);
    setError(null);
    const result = await action().catch(() => null);
    setBusyKey(null);
    if (!result) {
      setError(COPY.erroCarregar);
      return false;
    }
    if (!result.ok) {
      setError(Object.values(result.fieldErrors ?? {})[0]?.[0] ?? result.error);
      return false;
    }
    if (success) {
      adminToast.success(success);
    }
    await refresh();
    return true;
  }

  async function toggleAttending(online: boolean) {
    if (await run("attendance:ping", () => pingAttendant({ sessionId, status: online ? "online" : "away" }))) {
      setAttending(online);
    }
  }

  function answer(item: AttendanceQueueItem, text: string) {
    const key = `attendance:${item.target}:${item.id}`;
    return item.target === "question"
      ? run(key, () => answerQuestion({ answerText: text, questionId: item.id }), COPY.respostaEnviada)
      : run(key, () => sendTeamMessage({ body: text, kind: "answer", replyToId: item.id, sessionId }), COPY.respostaEnviada);
  }

  if (!loaded) {
    return (
      <SectionCard title={COPY.titulo} titleId="console-attendance-title">
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-console-attendance={webinarId} role="status">
          {error ?? COPY.carregando}
        </p>
      </SectionCard>
    );
  }

  if (loaded.kind === "pending") {
    return (
      <SectionCard title={COPY.titulo} titleId="console-attendance-title">
        <PendingMigrationNotice migration={loaded.migration} size="compact" />
      </SectionCard>
    );
  }

  return (
    <AttendancePanel
      busyKey={busyKey}
      canAct={canAct}
      currentUserId={currentUserId}
      error={error}
      onAnswer={answer}
      onAssign={(item, userId) => void run(`attendance:${item.target}:${item.id}`, () => assign({ id: item.id, sessionId, target: item.target, userId }))}
      onReplyAll={(on) => void run("attendance:reply-all", () => setReplyAll({ on, sessionId }))}
      onToggleAttending={(online) => void toggleAttending(online)}
      snapshot={{ ...loaded.snapshot, me: { ...loaded.snapshot.me, online: attending ?? loaded.snapshot.me.online } }}
    />
  );
}
