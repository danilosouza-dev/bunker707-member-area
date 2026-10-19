import "server-only";

// Dados das paginas novas da barra lateral do aluno (Minha jornada, Continue assistindo, Materiais,
// Suporte e Perfil). Cada pagina:
//   requireStudentPageUser(rota) (Suporte e Perfil: requirePageUser) -> getAppShellData(user) -> previa so
//   para admin -> loader daqui.
// getAppShellData e getMemberLibrary usam a mesma leitura do banco em cache por requisicao (o catalogo
// publicado vem do cache compartilhado, platform-store), entao a biblioteca nao repete consulta; leituras independentes rodam em paralelo (Promise.all).
//
// Os loaders devolvem modelos pequenos (student-pages-model.ts): o navegador nunca recebe a
// biblioteca inteira, linhas cruas do banco nem endereco de material bloqueado.

import type { AccessPreviewMode } from "@/lib/access-preview";
import { redactSecrets } from "@/lib/env-value";
import { getMemberSupportChannels, type MemberSupportChannel } from "@/lib/member-support";
import type { AuthenticatedUser, SessionUser } from "@/server/auth/session";
import { getMemberLibrary } from "@/server/db/platform-store";
import { hasSupabaseConfig } from "@/server/db/supabase/client";
import { listStudentLessonMaterials } from "@/server/member-area/lesson-materials";
import { getLoginPageConfigForRequest } from "@/server/member-area/login-queries";
import {
  buildContinueWatchingView,
  buildJourneyView,
  buildProfileAccesses,
  buildProfileDetails,
  buildStudentMaterialsView,
  getStudentMaterialTargets,
  type ContinueWatchingView,
  type JourneyView,
  type ProfileAccessView,
  type ProfileDetailsView,
  type StudentMaterialsView
} from "@/server/member-area/student-pages-model";
import type { StudentProfileRecord } from "@/server/member-area/student-profile";

export async function getJourneyPageData(accessPreviewMode: AccessPreviewMode | undefined, user: SessionUser): Promise<JourneyView> {
  const library = await getMemberLibrary(accessPreviewMode, user);
  return buildJourneyView(library, Date.now());
}

export async function getContinueWatchingPageData(
  accessPreviewMode: AccessPreviewMode | undefined,
  user: SessionUser
): Promise<ContinueWatchingView> {
  const library = await getMemberLibrary(accessPreviewMode, user);
  return buildContinueWatchingView(library, Date.now());
}

export type MaterialsPageData =
  /** Nenhuma aula liberada para este aluno (ainda sem produto ou tudo a liberar). */
  | { state: "no_lessons" }
  /** Banco sem a tabela de materiais (migracao 202610130001 pendente) ou sem configuracao. */
  | { state: "unavailable" }
  /** Falha de leitura: a pagina oferece tentar de novo. */
  | { state: "error" }
  /** Leitura feita; `view.total` pode ser 0 (nenhum material publicado). */
  | { state: "ready"; view: StudentMaterialsView };

/**
 * Materiais de todas as aulas LIBERADAS da biblioteca do aluno. A biblioteca ja filtrou o acesso
 * (conteudo com acesso real, gratuito ou previa do admin) e a liberacao (`isReleaseLocked`), que e o
 * contrato de listStudentLessonMaterials ("quem chama ja validou o acesso a cada aula").
 */
export async function getMaterialsPageData(
  accessPreviewMode: AccessPreviewMode | undefined,
  user: SessionUser
): Promise<MaterialsPageData> {
  const library = await getMemberLibrary(accessPreviewMode, user);
  const targets = getStudentMaterialTargets(library);

  if (targets.lessons.length === 0) {
    return { state: "no_lessons" };
  }

  if (!hasSupabaseConfig()) {
    return { state: "unavailable" };
  }

  try {
    const result = await listStudentLessonMaterials({
      learnerByLessonId: targets.learnerByLessonId,
      lessonIds: targets.lessons.map((lesson) => lesson.lessonId)
    });

    if (!result.available) {
      return { state: "unavailable" };
    }

    return { state: "ready", view: buildStudentMaterialsView(targets, result.materials) };
  } catch (error) {
    console.error("[materiais] leitura dos materiais do aluno", redactSecrets(error instanceof Error ? error.message : String(error)));
    return { state: "error" };
  }
}

export type SupportPageData = {
  channels: MemberSupportChannel[];
};

/** Canais: link de ajuda da tela de entrar (configurado pela escola) + canais fixos documentados. */
export async function getSupportPageData(): Promise<SupportPageData> {
  const loginConfig = await getLoginPageConfigForRequest();
  return { channels: getMemberSupportChannels([loginConfig.form.supportHref]) };
}

export type ProfilePageData = {
  accesses: ProfileAccessView[];
  details: ProfileDetailsView;
};

/**
 * Perfil do proprio aluno: conta (sessao), linha propria de profiles e acessos da biblioteca.
 * A linha de profiles nao depende da previa: a pagina a le junto com getAppShellData (Promise.all) e
 * entrega pronta aqui, para nao virar uma segunda ida ao banco em sequencia.
 */
export async function getProfilePageData(
  accessPreviewMode: AccessPreviewMode | undefined,
  user: AuthenticatedUser,
  displayName: string,
  profile: StudentProfileRecord | null
): Promise<ProfilePageData> {
  const library = await getMemberLibrary(accessPreviewMode, user);
  const now = Date.now();

  return {
    accesses: buildProfileAccesses(library, now),
    details: buildProfileDetails({
      account: { createdAt: user.created_at, email: user.email, lastSignInAt: user.last_sign_in_at },
      displayName,
      profile
    })
  };
}
