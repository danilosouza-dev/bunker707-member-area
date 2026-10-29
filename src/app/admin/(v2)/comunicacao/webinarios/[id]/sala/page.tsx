import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SessionConsole } from "@/components/admin/v2/communication/webinars/session-console/session-console";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { getSessionConsoleData } from "@/server/webinars/console-queries";
import { WEBINARS_MIGRATION } from "@/server/webinars/db";
import { WEBINARS_HREF, WEBINAR_ADMIN_COPY, WEBINAR_SESSION_PARAM, webinarAdminHref } from "@/server/webinars/editor-model";

// Abrir, encerrar, soltar o roteiro e as acoes da sala ao vivo rodam Server Actions desta rota.
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Console da sessão · Comunicação"
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  const text = Array.isArray(value) ? value[0] : value;

  return text?.trim() || null;
}

// Comunicacao › Webinarios › um webinario › Console (docs/30 §2.4): a mesa da equipe durante a sessao, com o
// seletor de sessoes (?sessao=), o relogio, os presentes, o chat com a moderacao, o roteiro com "Soltar agora", as
// enquetes e as perguntas. So quem cria avisos (messaging.write) entra; abrir e encerrar pedem messaging.publish. Na
// Live ao vivo (fase 3) a mesa ganha a sala no meio: o external_api.js do Jitsi proprio entra por um <script> com o
// nonce desta pagina (cabecalho x-nonce do src/proxy.ts; a CSP com 'strict-dynamic' aceita sem origem nova), e o
// next.config.ts libera camera, microfone e tela para o Jitsi proprio nesta rota.
export default async function AdminWebinarConsolePage({ params, searchParams }: PageProps) {
  const [{ access, user }, { id }, query, requestHeaders] = await Promise.all([requirePageArea("comunicacao"), params, searchParams, headers()]);

  if (!can(access, "messaging.write")) {
    redirect(WEBINARS_HREF);
  }

  const now = new Date();
  const loaded = await loadUnlessPendingMigration(() => getSessionConsoleData(id, firstParam(query[WEBINAR_SESSION_PARAM]), now));

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader
          breadcrumb={[{ href: WEBINARS_HREF, label: WEBINAR_ADMIN_COPY.header.breadcrumbList }, { href: webinarAdminHref(id), label: WEBINAR_ADMIN_COPY.header.pendingTitle }, { label: WEBINAR_ADMIN_COPY.console.breadcrumb }]}
          title={WEBINAR_ADMIN_COPY.console.title}
        />
        <PendingMigrationNotice migration={WEBINARS_MIGRATION} />
      </AdminPage>
    );
  }

  if (!loaded.data) {
    notFound();
  }

  // A chave remonta o console ao trocar de sessao (?sessao=): o estado do chat e do relogio e da sessao escolhida.
  return (
    <SessionConsole
      currentUserId={user.id}
      data={loaded.data}
      key={loaded.data.snapshot?.session.id ?? "sem-sessao"}
      nonce={requestHeaders.get("x-nonce")}
      permissions={{ canPublish: can(access, "messaging.publish"), canWrite: true }}
      serverNow={now.getTime()}
    />
  );
}
