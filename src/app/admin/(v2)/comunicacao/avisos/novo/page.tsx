import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoticeEditor } from "@/components/admin/v2/communication/notice-editor";
import { NOTICES_HREF, parseNoticeKindParam } from "@/components/admin/v2/communication/notices-view-model";
import { AdminPage } from "@/components/admin/v2/page-container";
import { PageHeader } from "@/components/admin/v2/page-header";
import { PendingMigrationNotice } from "@/components/admin/v2/pending-migration-notice";
import { requirePageArea } from "@/server/auth/permissions";
import { can } from "@/server/auth/roles";
import type { CampaignKind } from "@/server/communications/campaign-model";
import { loadNoticeEditorOptions } from "@/server/communications/queries";
import { prepareNoticeStart, type NoticeStartResult } from "@/server/communications/template-queries";
import { loadUnlessPendingMigration } from "@/server/db/pending-migration";
import { WEBINARS_HREF, webinarAdminHref } from "@/server/webinars/editor-model";
import { prepareWebinarNoticeStart } from "@/server/webinars/notice-shortcut";
import { webinarNoticeRequestOf, webinarRulesNoticeStart } from "@/server/webinars/notice-shortcut-model";

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

/** O ?modelo= (um so; repetido ou vazio = sem). */
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
// por um modelo (docs/28 §5.6; o ?tipo e ignorado); ?webinario=<id> abre a partir de uma live (docs/28 §5.6, docs/30
// §2.2 e §3.4; o ?modelo= vence), por um parse so (webinarNoticeRequestOf): com &tipo=, o aviso preenchido pelo webinario
// salvo (os atalhos do card Avisar); com &seguimento=<acoes>, o aviso em branco com as regras "Participação em lives"
// no "Para quem" (o "Avisar quem não veio" do relatorio; pedido invalido = aviso em branco). Nada e gravado ate salvar,
// como no modelo. So quem cria avisos (messaging.write) entra; o resto volta para a lista.
export default async function AdminNewNoticePage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(NOTICES_HREF);
  }

  const templateId = templateParam(params.modelo);
  const kind = parseNoticeKindParam(params.tipo) ?? "inbox";
  const webinar = templateId ? null : webinarNoticeRequestOf(params);
  const started = webinar?.mode === "webinar" ? await loadWebinarStart(webinar.webinarId, kind, readNow()) : await loadStart(templateId);
  // "Avisar quem não veio": o aviso em branco com as regras da live no "Para quem", sem ler o webinario.
  const rulesStart = webinar?.mode === "rules" ? webinarRulesNoticeStart(kind, webinar.audience) : null;
  // As regras do segmento e das seguintes do modelo (ou as da live) ganham nome nas opcoes do editor.
  const audiences = started?.ok ? started.audiences : rulesStart ? [rulesStart.draft.audience] : null;
  const loaded = await loadUnlessPendingMigration(() => loadNoticeEditorOptions(audiences ? { audiences } : {}));

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
      defaultKind={started?.ok ? started.start.draft.kind : kind}
      initial={null}
      now={readNow()}
      options={loaded.data}
      permissions={{
        canPublish: can(access, "messaging.publish"),
        canPublishLarge: can(access, "messaging.publish_large"),
        canWrite: true
      }}
      start={started?.ok ? started.start : rulesStart}
      startProblem={started && !started.ok ? started.reason : null}
    />
  );
}

/**
 * Avisar › Aviso no sino e Pop-up do editor do webinario (docs/30 §2.2): o aviso comeca do webinario salvo, no mesmo
 * `start` do modelo (nada gravado ate salvar). O atalho so aparece ligado quando vale; se o webinario mudou entre o
 * clique e a leitura (despublicado, encerrado, Quem pode fora dos limites) ou o banco nao tem os webinarios, a pagina
 * volta ao editor do webinario, onde o card Avisar diz o motivo; webinario que nao existe volta para a lista. Fica depois
 * da pagina: o guard de admin (requirePageArea) vem antes de qualquer redirect no arquivo (tests/admin-v2-shell).
 */
async function loadWebinarStart(webinarId: string, kind: CampaignKind, now: number): Promise<NoticeStartResult> {
  const loaded = await loadUnlessPendingMigration(() => prepareWebinarNoticeStart(webinarId, kind, now));
  const result = loaded.ok ? loaded.data : null;

  if (result?.ok) {
    return { audiences: result.audiences, fonts: [], ok: true, start: result.start };
  }

  redirect(result?.reason === "missing" ? WEBINARS_HREF : webinarAdminHref(webinarId));
}
