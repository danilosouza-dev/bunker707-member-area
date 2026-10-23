import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Browser } from "@playwright/test";
import type { PopupDesign, PopupVideo } from "../../src/server/communications/popup-design-model";
import { pngQuadrado } from "../support/imagem-de-teste.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { bloquearRedeExterna, contaDeTeste } from "./fixtures";

// Dados do "Design do pop-up" (docs/26) para os testes de ponta a ponta do aluno: a capa (PNG gerado) no bucket
// de imagens, o video de teste (WEBM VP8 de 1 s, que o Chromium do Playwright toca) no bucket dos videos dos
// pop-ups e a fonte de teste (subconjunto da Inter em WOFF2) no bucket de fontes, com a linha da biblioteca
// criada pela conta do produtor (zerarComunicacao apaga a linha; os arquivos ficam, como no app: D21). Os
// arquivos de amostra sao os de tests/fixtures/popup-design (pacote U). O pop-up e publicado pela tela do
// produtor, como em publicarPopUp (a lista no ar fica 60 s em cache no servidor e so a publicacao a renova).

const enderecoDoApp = `http://127.0.0.1:${process.env.E2E_PORT ?? "3100"}`;
const SESSAO_DO_PRODUTOR = "tests/e2e/.auth/produtor.json";
const amostras = new URL("../fixtures/popup-design/", import.meta.url);

/** Caminho fixo do video de teste (videos/<uuid>.webm). */
const CAMINHO_DO_VIDEO = "videos/e2e0de51-90a1-4b2c-8d3e-5f6a7b8c9d0e.webm";
const CAMINHO_DA_CAPA = "communications/e2e-design/capa.png";
/** Familia CSS da fonte de teste quando o teste cria a linha (bf_ + 12 hex). */
const FAMILIA_DE_TESTE = "bf_e2e0de5190a1";

export type MidiaDoDesign = {
  capa: { alt: string; url: string };
  fonte: { family: string; id: string; url: string };
  video: PopupVideo;
};

async function enviar(bucket: string, caminho: string, bytes: Buffer, contentType: string) {
  const db = createLocalAdminClient();
  const { error } = await db.storage.from(bucket).upload(caminho, bytes, { cacheControl: "60", contentType, upsert: true });

  if (error) {
    throw new Error(`Enviando ${caminho} ao bucket ${bucket}: ${error.message}`);
  }

  return db.storage.from(bucket).getPublicUrl(caminho).data.publicUrl;
}

/**
 * Sobe a capa, o video e a fonte de teste e garante a fonte na biblioteca (reaproveita a linha do mesmo arquivo
 * se ja existir). Pode rodar mais de uma vez.
 */
export async function prepararMidiaDoDesign(): Promise<MidiaDoDesign> {
  const db = createLocalAdminClient();
  const produtor = await contaDeTeste("produtor");
  const fonte = readFileSync(new URL("fonte-de-teste.woff2", amostras));
  const caminhoDaFonte = `fonts/${createHash("sha256").update(fonte).digest("hex").slice(0, 24)}.woff2`;

  const capaUrl = await enviar("content-assets", CAMINHO_DA_CAPA, pngQuadrado(480), "image/png");
  const videoUrl = await enviar("communication-popup-video", CAMINHO_DO_VIDEO, readFileSync(new URL("video-de-teste.webm", amostras)), "video/webm");
  const fonteUrl = await enviar("communication-fonts", caminhoDaFonte, fonte, "font/woff2");

  const existente = unwrap(
    await db.from("communication_fonts").select("id,family_key").eq("file_path", caminhoDaFonte).is("deleted_at", null).maybeSingle(),
    "Lendo a fonte de teste"
  ) as { family_key: string; id: string } | null;
  const linha =
    existente ??
    (unwrap(
      await db
        .from("communication_fonts")
        .insert({
          created_by: produtor.id,
          family_key: FAMILIA_DE_TESTE,
          file_path: caminhoDaFonte,
          format: "woff2",
          name: "Fonte de teste E2E",
          size_bytes: fonte.length,
          style: "normal",
          weight: 400
        })
        .select("id,family_key")
        .single(),
      "Gravando a fonte de teste na biblioteca"
    ) as { family_key: string; id: string });

  return {
    capa: { alt: "", url: capaUrl },
    fonte: { family: linha.family_key, id: linha.id, url: fonteUrl },
    video: { mimeType: "video/webm", path: CAMINHO_DO_VIDEO, url: videoUrl }
  };
}

export type PopUpComDesignDeTeste = {
  /** Botao principal (o `cta`). Padrao: sem botao. */
  botao?: { href: string; label: string } | null;
  /** Segundos depois de abrir a pagina. Padrao 1. */
  depoisDe?: number;
  /** null = Padrão (o cartao de sempre). */
  design: PopupDesign | null;
  imagem?: { alt: string; url: string } | null;
  texto?: string;
  titulo: string;
};

/**
 * Publica um pop-up "Uma vez" na home para todos os alunos, com o design dado: o rascunho entra no banco (o
 * design ja na forma do contrato) e "Publicar pop-up" roda pela tela do produtor (confere o design de novo,
 * prepara as linhas dos alunos e renova a lista no ar). Devolve o id. Desfaca com zerarComunicacao.
 */
export async function publicarPopUpComDesign(browser: Browser, input: PopUpComDesignDeTeste) {
  const db = createLocalAdminClient();
  const produtor = await contaDeTeste("produtor");
  const [rascunho] = unwrap(
    await db
      .from("campaigns")
      .insert({
        allow_snooze: true,
        audience: { kind: "everyone" },
        body: input.texto ?? "",
        created_by: produtor.id,
        cta_href: input.botao?.href ?? null,
        cta_label: input.botao?.label ?? null,
        cta_target: input.botao ? "same_tab" : null,
        image_alt: input.imagem ? input.imagem.alt || null : null,
        image_url: input.imagem?.url ?? null,
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

  return rascunho.id;
}
