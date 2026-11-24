import "server-only";

import { redirect } from "next/navigation";
import { requireStudentPageUser } from "../auth/guards";
import { getSessionUserOrGuest, type SessionUser } from "../auth/session";
import { webinarsDb } from "./db";
import { loadOpenLinkWebinar } from "./guests";
import { isGuestUser, webinarEntryPath } from "./open-link-model";

// Quem olha a pagina do webinario e a sala (docs/30 §14): o aluno e a equipe como sempre; o convidado do link aberto
// tambem (o acesso ao webinario deixa ele ver so o dele); sem sessao, o formulario quando o link do webinario esta
// ligado, e o login nos outros casos (sem dizer se o webinario existe).

export type WebinarViewer = { guest: boolean; user: SessionUser };

export async function resolveWebinarViewer(slug: string, nextPath: string): Promise<WebinarViewer> {
  const user = await getSessionUserOrGuest();

  if (!user) {
    let open = false;
    try {
      open = Boolean(await loadOpenLinkWebinar(webinarsDb(), slug));
    } catch (error) {
      // Sem conseguir ler o webinario, o login de sempre.
      console.error(`[webinarios] link aberto nao lido: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (open) {
      redirect(webinarEntryPath(slug));
    }
    // Sem sessao: o login, com a volta para esta pagina.
    return { guest: false, user: await requireStudentPageUser(nextPath) };
  }

  return { guest: isGuestUser(user), user };
}
