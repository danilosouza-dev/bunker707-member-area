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
import { WEBINAR_NOTICE_PARAM } from "@/server/webinars/notice-shortcut-model";
import { emptyTemplateStart, type NoticeStart } from "@/server/communications/template-model";
import { WEBINAR_FOLLOW_UP_PARAMS, webinarFollowUpAudienceOf } from "@/server/webinars/follow-up-links";
import { WEBINAR_COPY } from "@/lib/webinar-copy";

// Publicar agora envia dentro da Server Action desta rota (em lotes).
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Novo aviso · Comunicação"
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** O aviso em branco com o "Para quem" do webinario e a nota do topo (o editor no modo "start", sem modelo). */
function webinarFollowUpStart(kind: "inbox" | "popup", audience: NonNullable<ReturnType<typeof webinarFollowUpAudienceOf>>): NoticeStart {
  const base = emptyTemplateStart(kind);

  return { ...base, draft: { ...base.draft, audience }, notes: [WEBINAR_COPY.seguimento.inicioDoAviso] };
}

/** Hora da leitura (renderizado no servidor): o "agora" da previa. */
function readNow() {
  return Date.now();
}

/** O ?modelo= ou o ?webinario= (um so; repetido ou vazio = sem). */
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
// por um modelo (docs/28 §5.6; o ?tipo e ignorado); ?webinario=<id>&tipo= abre preenchido pelo webinario (docs/30 §2.2,
// os atalhos do card Avisar; o ?modelo= vence). ?webinario=<id>&seguimento=<acoes> (docs/30 §3.4, o "Avisar quem não
// veio" do relatorio do webinario) abre o aviso em branco com o "Para quem" ja na regra "Webinário"
// (webinar_follow_up); nada e gravado ate salvar, como no modelo. INTEGRACAO (provisorio, ate a unificacao): as duas
// entradas dividem o ?webinario= e o ?seguimento= decide qual vale. So quem cria avisos (messaging.write) entra; o resto
// volta para a lista.
export default async function AdminNewNoticePage({ searchParams }: PageProps) {
  const [{ access }, params] = await Promise.all([requirePageArea("comunicacao"), searchParams]);

  if (!can(access, "messaging.write")) {
    redirect(NOTICES_HREF);
  }

  const templateId = templateParam(params.modelo);
  // Com ?seguimento=, o ?webinario= e o do relatorio (fase 4, a regra "Webinário"); sem ele, o do card Avisar.
  const isFollowUp = !templateId && templateParam(params[WEBINAR_FOLLOW_UP_PARAMS.actions]) !== null;
  const webinarId = templateId || isFollowUp ? null : templateParam(params[WEBINAR_NOTICE_PARAM]);
  const started = webinarId ? await loadWebinarStart(webinarId, parseNoticeKindParam(params.tipo) ?? "inbox", readNow()) : await loadStart(templateId);
  // Sem modelo: o "Para quem" pedido pelo relatorio do webinario (a regra "Webinário"), sem gravar nada.
  const followUp = started || !isFollowUp ? null : webinarFollowUpAudienceOf(params);
  const followUpStart: NoticeStart | null = followUp ? webinarFollowUpStart(parseNoticeKindParam(params.tipo) ?? "inbox", followUp) : null;
  // As regras do segmento e das seguintes do modelo ganham nome nas opcoes do editor.
  const loaded = await loadUnlessPendingMigration(() =>
    loadNoticeEditorOptions(started?.ok ? { audiences: started.audiences } : followUp ? { audiences: [followUp] } : {})
  );

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
      start={started?.ok ? started.start : followUpStart}
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
