"use client";

import { CheckCircle2, LoaderCircle, OctagonX } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

export type AdminOperationCopy = {
  error?: string;
  pending: string;
  success: string;
};

type AdminOperationFeedbackState = {
  id: number;
  message: string;
  status: "pending" | "success" | "error";
};

type AdminOperationContextValue = {
  isOperationPending: (key?: string) => boolean;
  runAdminOperation: <T>(
    key: string,
    copy: AdminOperationCopy,
    operation: () => Promise<T>
  ) => Promise<T>;
};

const AdminOperationContext = createContext<AdminOperationContextValue | null>(null);

function AdminOperationStatus({ feedback }: { feedback: AdminOperationFeedbackState | null }) {
  if (!feedback) {
    return null;
  }

  const isPending = feedback.status === "pending";
  const isSuccess = feedback.status === "success";
  const Icon = isPending ? LoaderCircle : isSuccess ? CheckCircle2 : OctagonX;
  const toneClassName = isPending
    ? "border-white/15 bg-[#18191e] text-white"
    : isSuccess
      ? "border-emerald-400/30 bg-[#102019] text-emerald-100"
      : "border-red-400/30 bg-[#271315] text-red-100";

  return (
    <div
      aria-atomic="true"
      aria-live={feedback.status === "error" ? "assertive" : "polite"}
      className={`pointer-events-none fixed left-4 right-4 top-4 z-[120] ml-auto flex min-h-14 max-w-md items-center gap-3 overflow-hidden rounded-[10px] border px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:left-auto ${toneClassName}`}
      role={feedback.status === "error" ? "alert" : "status"}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10">
        <Icon className={`size-4 ${isPending ? "animate-spin" : ""}`} />
      </span>
      <span className="min-w-0 text-sm font-semibold leading-5">{feedback.message}</span>
      {isPending ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-white/10">
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-white/80" />
        </span>
      ) : null}
    </div>
  );
}

export function AdminOperationProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<AdminOperationFeedbackState | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const activeOperationsRef = useRef(new Map<string, Promise<unknown>>());
  const feedbackIdRef = useRef(0);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearDismissTimer, [clearDismissTimer]);

  const runAdminOperation = useCallback(async <T,>(
    key: string,
    copy: AdminOperationCopy,
    operation: () => Promise<T>
  ): Promise<T> => {
    const currentOperation = activeOperationsRef.current.get(key);

    if (currentOperation) {
      return currentOperation as Promise<T>;
    }

    clearDismissTimer();
    const feedbackId = feedbackIdRef.current + 1;
    feedbackIdRef.current = feedbackId;
    setFeedback({ id: feedbackId, message: copy.pending, status: "pending" });
    setPendingKeys((current) => current.includes(key) ? current : [...current, key]);

    const operationPromise = (async () => {
      try {
        const result = await operation();
        setFeedback((current) => current?.id === feedbackId
          ? { id: feedbackId, message: copy.success, status: "success" }
          : current);
        dismissTimerRef.current = setTimeout(() => {
          setFeedback((current) => current?.id === feedbackId ? null : current);
        }, 2600);
        return result;
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : copy.error ?? "Nao foi possivel concluir a operacao.";
        setFeedback((current) => current?.id === feedbackId
          ? { id: feedbackId, message, status: "error" }
          : current);
        dismissTimerRef.current = setTimeout(() => {
          setFeedback((current) => current?.id === feedbackId ? null : current);
        }, 7000);
        throw error;
      } finally {
        activeOperationsRef.current.delete(key);
        setPendingKeys((current) => current.filter((pendingKey) => pendingKey !== key));
      }
    })();

    activeOperationsRef.current.set(key, operationPromise);
    return operationPromise;
  }, [clearDismissTimer]);

  const value = useMemo<AdminOperationContextValue>(() => ({
    isOperationPending: (key?: string) => key ? pendingKeys.includes(key) : pendingKeys.length > 0,
    runAdminOperation
  }), [pendingKeys, runAdminOperation]);

  return (
    <AdminOperationContext.Provider value={value}>
      {children}
      <AdminOperationStatus feedback={feedback} />
    </AdminOperationContext.Provider>
  );
}

export function useAdminOperation() {
  const context = useContext(AdminOperationContext);

  if (!context) {
    throw new Error("useAdminOperation must be used inside AdminOperationProvider.");
  }

  return context;
}
