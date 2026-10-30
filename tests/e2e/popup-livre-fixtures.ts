import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Browser } from "@playwright/test";
import type { FreeNode, PopupFreeDesignInput } from "../../src/server/communications/popup-free-model";
import { applyFreeStarter } from "../../src/server/communications/popup-free-starters";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { bloquearRedeExterna, contaDeTeste } from "./fixtures";
import { prepararMidiaDoDesign } from "./popup-design-fixtures";

// Dados do design Livre (docs/27) para os testes de ponta a ponta do aluno: o video de teste e a fonte de teste do
// Personalizado (prepararMidiaDoDesign, pacote U) e a capa WebP de tests/fixtures/popup-livre/capa-de-teste.webp
// (880 x 496, um brilho quente sobre o escuro, sem texto) no bucket de imagens, no caminho do Livre
// (communications/free/<24 hex do sha256>.webp). O pop-up e publicado pela tela do produtor, como em
// publicarPopUpComDesign: o rascunho entra no banco com o design Livre e "Publicar pop-up" roda pela tela (o
// servidor confere o design de novo, prepara as linhas dos alunos e renova a lista no ar, que fica 60 s em cache).

const enderecoDoApp = `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";

export type MidiaDoLivre = {
  capa: { height: number; path: string; url: string; width: number };
  fonte: { family: string; id: string; url: string };
  video: { mimeType: "video/webm"; path: string; url: string };
};

async function enviar(bucket: string, caminho: string, bytes: Buffer, contentType: string) {
  const db = createLocalAdminClient();
  const { error } = await db.storage.from(bucket).upload(caminho, bytes, { cacheControl: "60", contentType, upsert: true });

  if (error) {
    throw new Error(`Enviando ${caminho} ao bucket ${bucket}: ${error.message}`);
  }

  return db.storage.from(bucket).getPublicUrl(caminho).data.publicUrl;
}

/** Sobe a capa (WebP do Livre), o video e a fonte de teste. Pode rodar mais de uma vez. */
export async function prepararMidiaDoLivre(): Promise<MidiaDoLivre> {
  const base = await prepararMidiaDoDesign();
  const capa = readFileSync(new URL("../fixtures/popup-livre/capa-de-teste.webp", import.meta.url));
  const path = `communications/free/${createHash("sha256").update(capa).digest("hex").slice(0, 24)}.webp`;
  const url = await enviar("content-assets", path, capa, "image/webp");

  return {
    capa: { height: 496, path, url, width: 880 },
    fonte: base.fonte,
    video: { mimeType: "video/webm", path: base.video.path, url: base.video.url }
  };
}

/**
 * O modelo "Vídeo no topo com degradê" (applyFreeStarter, spec §2.9) com o video e a capa de teste e, se pedido,
 * a fonte enviada no titulo, tamanhos de selo e texto, elementos a mais (antes dos Links) e outro elemento Links.
 */
export function designVideoNoTopo(
  midia: MidiaDoLivre,
  input: { comFonte?: boolean; extra?: FreeNode[]; links?: Partial<Extract<FreeNode, { type: "links" }>>; seloTamanho?: number; textoTamanho?: number } = {}
): PopupFreeDesignInput {
  const { design } = applyFreeStarter("video_top_fade", {
    audio: null,
    cta: { href: "/minhas-compras", label: "Saiba mais", target: "same_tab" },
    poster: { height: midia.capa.height, path: midia.capa.path, width: midia.capa.width },
    video: { mimeType: midia.video.mimeType, path: midia.video.path }
  });
  const children = design.children.flatMap((node): FreeNode[] => {
    if (node.type === "heading" && input.comFonte) {
      return [{ ...node, textStyle: { ...node.textStyle, font: { id: midia.fonte.id, kind: "uploaded" } } }];
    }

    if (node.type === "badge" && input.seloTamanho) {
      return [{ ...node, textStyle: { ...node.textStyle, size: input.seloTamanho } }];
    }

    if (node.type === "text" && input.textoTamanho) {
      return [{ ...node, textStyle: { ...node.textStyle, size: input.textoTamanho } }];
    }

    if (node.type === "links") {
      return [...(input.extra ?? []), { ...node, ...input.links }];
    }

    return [node];
  });

  return { ...design, children };
}

export type PopUpLivreDeTeste = {
  /** Botao principal (o `cta`): obrigatorio quando o design tem o Botão principal. Padrao: /minhas-compras. */
  botao?: { href: string; label: string } | null;
  /** Segundos depois de abrir a pagina. Padrao 1. */
  depoisDe?: number;
  design: PopupFreeDesignInput;
  /** Quando o pop-up termina (ISO); padrao: sem fim. O Contador ate o fim do pop-up precisa dele para publicar. */
  fim?: string;
  titulo: string;
};

/**
 * Publica um pop-up Livre "Uma vez" na home para todos os alunos: o rascunho entra no banco com o design Livre e
 * "Publicar pop-up" roda pela tela do produtor. Devolve o id. Desfaca com zerarComunicacao.
 */
export async function publicarPopUpLivre(browser: Browser, input: PopUpLivreDeTeste) {
  const db = createLocalAdminClient();
  const produtor = await contaDeTeste("produtor");
  const botao = input.botao === undefined ? { href: "/minhas-compras", label: "Saiba mais" } : input.botao;
  const [rascunho] = unwrap(
    await db
      .from("campaigns")
      .insert({
        allow_snooze: true,
        audience: { kind: "everyone" },
        body: "",
        created_by: produtor.id,
        cta_href: botao?.href ?? null,
        cta_label: botao?.label ?? null,
        cta_target: botao ? "same_tab" : null,
        ends_at: input.fim ?? null,
        kind: "popup",
        popup_close: "any",
        popup_delay_seconds: input.depoisDe ?? 1,
        popup_design: input.design,
        popup_exclude_pages: [],
        popup_frequency: "once",
        popup_pages: ["home"],
        popup_repeat: "once",
        popup_snooze_minutes: 1_440,
        popup_stop_on: null,
        popup_trigger: "page_load",
        status: "draft",
        title: input.titulo,
        updated_by: produtor.id
      })
      .select("id"),
    `Gravando o rascunho do pop-up "${input.titulo}"`
  ) as { id: string }[];

  const contexto = await browser.newContext({ baseURL: enderecoDoApp, locale: "pt-BR", storageState: SESSAO_DO_PRODUTOR, timezoneId: "America/Sao_Paulo" });
  await bloquearRedeExterna(contexto);

  try {
    const pagina = await contexto.newPage();
    await pagina.goto(`/admin/comunicacao/avisos/${rascunho.id}`);
    await pagina.waitForLoadState("networkidle");
    await pagina.getByRole("button", { exact: true, name: "Publicar pop-up" }).click();
    await expect(pagina.getByText(/^Pop-up publicado\./)).toBeVisible();
  } finally {
    await contexto.close();
  }

  // O que ficou gravado e o Livre (uma tela antiga trocaria por Padrão).
  const gravado = unwrap(await db.from("campaigns").select("popup_design,status").eq("id", rascunho.id).single(), "Lendo o pop-up publicado") as {
    popup_design: { mode?: string } | null;
    status: string;
  };
  expect(gravado.popup_design?.mode, "o design Livre continua gravado depois de publicar").toBe("free");

  return rascunho.id;
}
