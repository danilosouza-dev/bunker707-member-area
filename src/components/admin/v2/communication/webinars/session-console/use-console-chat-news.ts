"use client";

import { useState } from "react";
import { consoleChatNewCount, consoleChatSeenIds, type ConsoleChatNewsMessage } from "@/server/webinars/console-v2-model";

// As mensagens novas do Chat do console (rodada v12, docs/30 D106; teste do produtor de 12/11/2026: "um usuário comenta
// no chat e o apresentador não recebe notificação no ícone de mensagem"). Enquanto o Chat nao esta na tela (o painel
// fechado, ou aberto noutra aba ou entrada), o item Chat do trilho e a aba levam o numero das mensagens que outras
// pessoas escreveram desde que ele saiu (consoleChatNotifies: o aluno da turma e os colegas da equipe; nunca a propria,
// o roteiro, o chat original nem o assistente). Quando o Chat sai da tela, o console guarda os ids do que ja estava la
// (a marca); voltar ao Chat zera. Trocar de sessao no topo marca de novo: o que a outra sessao ja tinha nao e novidade.
// A conta vem do retrato de 5 s que o console ja le: nenhum pedido a mais. A marca muda na renderizacao (o estado
// derivado do React), sem efeito.

type ChatMark = { seenIds: ReadonlySet<string>; sessionId: string | null };

export function useConsoleChatNews(input: { chatShown: boolean; messages: readonly ConsoleChatNewsMessage[]; sessionId: string | null; viewerId: string | null }): number {
  const { chatShown, messages, sessionId, viewerId } = input;
  const markNow = (): ChatMark => ({ seenIds: consoleChatSeenIds(messages), sessionId });
  const [mark, setMark] = useState<ChatMark | null>(() => (chatShown ? null : markNow()));
  const [wasShown, setWasShown] = useState(chatShown);

  if (wasShown !== chatShown) {
    setWasShown(chatShown);
    setMark(chatShown ? null : markNow());
  } else if (mark && mark.sessionId !== sessionId) {
    setMark(markNow());
  }

  return chatShown || !mark || mark.sessionId !== sessionId ? 0 : consoleChatNewCount({ messages, seenIds: mark.seenIds, viewerId });
}
