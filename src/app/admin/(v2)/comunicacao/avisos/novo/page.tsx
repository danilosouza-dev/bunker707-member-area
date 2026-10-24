import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoticeEditor } from "@/components/admin/v2/communication/notice-editor";
import { NOTICES_HREF, parseNoticeKindParam } from "@/components/admin/v2/communication/notices-view-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import { loadNoticeEditorOptions } from "@/server/communications/queries";
import { prepareNoticeStart, type NoticeStartResult } from "@/server/communications/template-queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";

// Publicar agora envia dentro da Server Action desta rota (em lotes).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Novo aviso · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Hora da leitura (renderizado no servidor): o "agora" da previa. */
function readNow() {
  return Date.now();
}

/** O ?modelo= (um so; repetido ou vazio = sem modelo). */
function templateParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * O modelo de onde o aviso comeca (docs/28 D5): o editor abre preenchido e nada e gravado ate salvar. Banco sem a
 * migracao dos modelos = o modelo nao existe (o editor abre em branco com a nota "Este modelo não existe mais").
 */
async function loadStart(templateId: string | null): Promise<NoticeStartResult | null> {
  if (!templateId) {
    return null;
  }

  const loaded = await loadUnlessPendingMigration(() => prepareNoticeStart(templateId));

  return loaded.ok ? loaded.data : { ok: false, reason: "missing" };
}

// Comunicação › Avisos e pop-ups › Novo aviso (docs/22 §2.2): ?tipo=popup abre em pop-up; ?modelo=<id> abre preenchido
// por um modelo (docs/28 §5.6; o ?tipo e ignorado). So quem cria avisos (messaging.write) entra; o resto volta para a
// lista.
export default async function AdminNewNoticePage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(NOTICES_HREF);
  }

  const started = await loadStart(templateParam(params.modelo));
  // As regras do segmento e das seguintes do modelo ganham nome nas opcoes do editor.
  const loaded = await loadUnlessPendingMigration(() => loadNoticeEditorOptions(started?.ok ? { audiences: started.audiences } : {}));

  if (!loaded.ok) {
    return (
      <AdminPage className="gap-6">
        <PageHeader breadcrumb={[{ href: NOTICES_HREF, label: "Avisos e pop-ups" }, { label: "Novo aviso" }]} title="Novo aviso" />
        <PendingMigrationNotice migration="202610200001" />
      </AdminPage>
    );
  }

  return (
    <NoticeEditor
      defaultKind={started?.ok ? started.start.draft.kind : (parseNoticeKindParam(params.tipo) ?? "inbox")}
      initial={null}
      now={readNow()}
      options={loaded.data}
      permissions={{
        canPublish: can(access, "messaging.publish"),
        canPublishLarge: can(access, "messaging.publish_large"),
        canWrite: true
      }}
      start={started?.ok ? started.start : null}
      startProblem={started && !started.ok ? started.reason : null}
    />
  );
}
