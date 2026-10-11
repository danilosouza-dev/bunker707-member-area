"use client";

import { useEffect } from "react";
import type { PostHog } from "posthog-js";
import { stripSensitiveUrlData } from "@/components/analytics/posthog-privacy";

// Variaveis NEXT_PUBLIC_* entram no bundle no build. Sem a chave, posthog-js nunca e baixado.
const postHogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const postHogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let postHogPromise: Promise<PostHog | null> | null = null;

function loadPostHog() {
  if (!postHogKey) {
    return Promise.resolve(null);
  }

  postHogPromise ??= import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(postHogKey, {
        api_host: postHogHost,
        defaults: "2026-08-30",
        // App Router navega por history.pushState: cada troca de rota vira um $pageview, sem hook manual.
        capture_pageview: "history_change",
        capture_pageleave: "if_capture_pageview",
        // Anonimos nao geram perfil; o perfil nasce no identify com o id interno do aluno.
        person_profiles: "identified_only",
        // Autocapture registra o clique e a tag do elemento, nunca o texto exibido nem atributos
        // (aria-label, title e alt trazem nomes de alunos; href pode trazer codigos na URL).
        mask_all_text: true,
        mask_all_element_attributes: true,
        disable_session_recording: true,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        // Erros ficam no Sentry.
        capture_exceptions: false,
        before_send: stripSensitiveUrlData
      });

      return posthog;
    })
    .catch(() => {
      postHogPromise = null;
      return null;
    });

  return postHogPromise;
}

type PostHogAnalyticsProps = {
  // auth.users.id do aluno ou admin autenticado; null para visitante. Nunca e-mail ou nome.
  userId: string | null;
};

export function PostHogAnalytics({ userId }: PostHogAnalyticsProps) {
  useEffect(() => {
    let active = true;

    void loadPostHog().then((posthog) => {
      if (!active || !posthog) {
        return;
      }

      if (userId && posthog.get_distinct_id() === userId) {
        return;
      }

      // Logout ou troca de conta no mesmo navegador: nunca fundir eventos de duas pessoas.
      if (posthog.get_property("$user_state") === "identified") {
        posthog.reset();
      }

      if (userId) {
        posthog.identify(userId);
      }
    });

    return () => {
      active = false;
    };
  }, [userId]);

  return null;
}
