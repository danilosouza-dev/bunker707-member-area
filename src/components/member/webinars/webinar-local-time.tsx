"use client";

import { useSyncExternalStore } from "react";
import { localTimeHint } from "@/lib/webinar-time";

// "(no seu horario: 21:00)" quando o relogio do aparelho esta em outro fuso (docs/30 §1.2). So o navegador
// sabe o fuso: no servidor e na hidratacao nao desenha nada.

const subscribe = () => () => {};

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function WebinarLocalTime({ className, iso }: { className?: string; iso: string }) {
  const hint = useSyncExternalStore(
    subscribe,
    () => localTimeHint(iso, deviceTimeZone()),
    () => ""
  );

  return hint ? <span className={className}>{hint}</span> : null;
}
