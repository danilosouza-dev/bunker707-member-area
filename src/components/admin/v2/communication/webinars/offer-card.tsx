"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { WebinarKind } from "@/server/webinars/model";
import { loadOfferEditor, type OfferEditorData } from "@/server/webinars/offer-actions";
import { ErrorBanner } from "../../error-banner";
import { PendingMigrationNotice } from "../../pending-migration-notice";
import { OfferEditorForm } from "./offer/offer-editor-form";

// O card Oferta do editor (docs/30 §2.2): variantes A/B/C/D, Quando aparece, Some em, prazo, divisao e atribuicao, com
// o salvar proprio (saveOffer). webinar-editor.tsx monta este card num webinario gravado (Live gravada e Live ao vivo,
// onde a oferta aparece so no replay). O card le a Oferta e os produtos pela Server Action loadOfferEditor ao abrir
// (Tentar de novo quando falha); banco sem a 202610290005, o aviso da migracao no lugar do formulario.

const COPY = WEBINAR_COPY.oferta.card;

export type OfferCardProps = {
  canWrite: boolean;
  disabled: boolean;
  kind: WebinarKind;
  webinarId: string;
};

type Loaded = { data: OfferEditorData; webinarId: string } | { error: string; webinarId: string };

export function OfferCard({ canWrite, disabled, kind, webinarId }: OfferCardProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;
    loadOfferEditor({ webinarId })
      .then((result) => {
        if (!stopped) {
          setLoaded(result.ok ? { data: result.data, webinarId } : { error: result.error || COPY.erroCarregar, webinarId });
        }
      })
      .catch(() => {
        if (!stopped) {
          setLoaded({ error: COPY.erroCarregar, webinarId });
        }
      });
    return () => {
      stopped = true;
    };
  }, [attempt, webinarId]);

  const current = loaded && loaded.webinarId === webinarId ? loaded : null;

  if (!current) {
    return (
      <p className="text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
        {COPY.carregando}
      </p>
    );
  }

  if ("error" in current) {
    return (
      <ErrorBanner
        action={
          <Button
            className="px-3"
            onClick={() => {
              setLoaded(null);
              setAttempt((value) => value + 1);
            }}
            type="button"
            variant="secondary"
          >
            {COPY.tentarDeNovo}
          </Button>
        }
      >
        {current.error}
      </ErrorBanner>
    );
  }

  if (current.data.pendingMigration) {
    return <PendingMigrationNotice migration={current.data.migration} size="compact" />;
  }

  return (
    <OfferEditorForm
      canWrite={canWrite}
      disabled={disabled}
      key={current.data.offer?.id ?? "nova"}
      kind={kind}
      offer={current.data.offer}
      products={current.data.products}
      productsLoaded={current.data.productsLoaded}
      webinarId={webinarId}
    />
  );
}
