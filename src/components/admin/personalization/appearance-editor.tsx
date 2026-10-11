"use client";

import {
  ArrowLeft,
  ImageIcon,
  ImageOff,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  Upload
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import type { AdminDashboardData, HomeHeroConfig, PlatformBrandingConfig } from "@/lib/platform-types";

type AppearanceEditorProps = {
  branding: PlatformBrandingConfig;
  hero: HomeHeroConfig;
  onBack: () => void;
  onPublished: (data: AdminDashboardData) => void;
};

type HeroDraft = {
  enabled: boolean;
  image: string;
};

const defaultHeroImage = "/hero/bunker-707-red-front-hero.png";
const defaultLogoImage = "/brand/logo-bunker.svg";
const maxUploadBytes = 8 * 1024 * 1024;
const supportedUploadTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const panelClassName = "rounded-[10px] border border-white/10 bg-[#111113] shadow-[0_22px_70px_rgba(0,0,0,0.24)]";
const inputClassName = "min-h-10 w-full rounded-[8px] border border-white/10 bg-black/25 px-3 text-sm text-white outline-none transition focus:border-white/25";
const actionButtonClassName = "inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-zinc-200 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

function readUploadAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(new Error("Nao foi possivel ler a imagem.")));
    reader.readAsDataURL(file);
  });
}

async function readValidatedUpload(file: File) {
  if (!supportedUploadTypes.has(file.type)) {
    throw new Error("Formato nao suportado. Use JPG, PNG ou WebP.");
  }

  if (file.size > maxUploadBytes) {
    throw new Error("A imagem deve ter no maximo 8 MB.");
  }

  return readUploadAsDataUrl(file);
}

function getHeroDraft(hero: HomeHeroConfig): HeroDraft {
  return {
    enabled: hero.enabled !== false && Boolean(hero.image),
    image: hero.image
  };
}

export function AppearanceEditor({ branding, hero, onBack, onPublished }: AppearanceEditorProps) {
  const [publishedHero, setPublishedHero] = useState<HeroDraft>(() => getHeroDraft(hero));
  const [publishedLogo, setPublishedLogo] = useState<string | null>(branding.logoImage);
  const [heroDraft, setHeroDraft] = useState<HeroDraft>(() => getHeroDraft(hero));
  const [logoDraft, setLogoDraft] = useState<string | null>(branding.logoImage);
  const [heroUrlInput, setHeroUrlInput] = useState("");
  const [logoUrlInput, setLogoUrlInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: "error" | "success" } | null>(null);

  const heroDirty = heroDraft.enabled !== publishedHero.enabled || (heroDraft.enabled && heroDraft.image !== publishedHero.image);
  const logoDirty = logoDraft !== publishedLogo;
  const dirty = heroDirty || logoDirty;
  const heroPreviewImage = useMemo(
    () => (heroDraft.enabled && heroDraft.image ? heroDraft.image : null),
    [heroDraft]
  );

  async function handleHeroUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const src = await readValidatedUpload(file);
      setHeroDraft({ enabled: true, image: src });
      setHeroUrlInput("");
      setNotice(null);
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Nao foi possivel ler a imagem.", tone: "error" });
    }
  }

  async function handleLogoUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const src = await readValidatedUpload(file);
      setLogoDraft(src);
      setLogoUrlInput("");
      setNotice(null);
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Nao foi possivel ler a imagem.", tone: "error" });
    }
  }

  function applyHeroUrl() {
    const url = heroUrlInput.trim();

    if (!url) {
      return;
    }

    setHeroDraft({ enabled: true, image: url });
    setHeroUrlInput("");
    setNotice(null);
  }

  function applyLogoUrl() {
    const url = logoUrlInput.trim();

    if (!url) {
      return;
    }

    setLogoDraft(url);
    setLogoUrlInput("");
    setNotice(null);
  }

  function discardChanges() {
    setHeroDraft(publishedHero);
    setLogoDraft(publishedLogo);
    setHeroUrlInput("");
    setLogoUrlInput("");
    setNotice(null);
  }

  async function publishChanges() {
    setPublishing(true);
    setNotice(null);

    try {
      const payload: {
        hero?: { enabled: boolean; image?: string };
        logo?: { image: string | null };
      } = {};

      if (heroDirty) {
        payload.hero = heroDraft.enabled
          ? {
              enabled: true,
              ...(heroDraft.image !== publishedHero.image ? { image: heroDraft.image } : {})
            }
          : { enabled: false };
      }

      if (logoDirty) {
        payload.logo = { image: logoDraft };
      }

      const response = await fetch("/api/admin/appearance", {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const result = await response.json() as { data?: AdminDashboardData; error?: string };

      if (!response.ok || !result.data) {
        throw new Error(result.error ?? "Nao foi possivel salvar a aparencia.");
      }

      const nextHero = getHeroDraft(result.data.hero);
      setPublishedHero(nextHero);
      setHeroDraft(nextHero);
      setPublishedLogo(result.data.branding.logoImage);
      setLogoDraft(result.data.branding.logoImage);
      setNotice({ message: "Identidade visual publicada com sucesso.", tone: "success" });
      onPublished(result.data);
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Nao foi possivel salvar a aparencia.",
        tone: "error"
      });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-[4.25rem] z-30 -mx-4 border-y border-white/10 bg-[#0b0b0b]/94 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-zinc-200 transition hover:bg-white/10 hover:text-white"
              onClick={onBack}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
            <div>
              <p className="text-xs font-black uppercase text-zinc-500">Personalizacao</p>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-white">Identidade visual</h2>
                {dirty ? (
                  <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[10px] font-black text-amber-200">
                    Alteracoes nao publicadas
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-10 items-center rounded-[8px] border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!dirty || publishing}
              onClick={discardChanges}
              type="button"
            >
              Descartar
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-white px-3 text-xs font-black text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!dirty || publishing}
              onClick={() => void publishChanges()}
              type="button"
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {publishing ? "Publicando" : "Publicar"}
            </button>
          </div>
        </div>
      </div>

      {notice ? (
        <div
          className={`rounded-[8px] border px-4 py-3 text-sm font-bold ${
            notice.tone === "success"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/25 bg-red-400/10 text-red-200"
          }`}
        >
          {notice.message}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <div className={panelClassName}>
          <div className="border-b border-white/10 p-4">
            <p className="text-sm font-black text-white">Capa da home</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Banner exibido no topo da home do aluno. Recomendado: 1920 x 720 px (JPG, PNG ou WebP, ate 8 MB).
            </p>
          </div>
          <div className="space-y-4 p-4">
            <div className="relative aspect-[16/6] overflow-hidden rounded-[8px] border border-white/10 bg-[#141414]">
              {heroPreviewImage ? (
                <>
                  <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${heroPreviewImage})` }} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-black/30" />
                </>
              ) : (
                <div className="grid h-full place-items-center text-center">
                  <div>
                    <ImageOff className="mx-auto h-8 w-8 text-zinc-600" />
                    <p className="mt-2 text-xs font-black text-zinc-400">Capa removida</p>
                    <p className="mt-1 text-[11px] text-zinc-600">A home comeca direto nas secoes de conteudo.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <label className={`${actionButtonClassName} cursor-pointer`}>
                <Upload className="h-4 w-4" />
                Enviar imagem
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    void handleHeroUpload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
              <button
                className={actionButtonClassName}
                disabled={!heroDraft.enabled}
                onClick={() => setHeroDraft((current) => ({ ...current, enabled: false }))}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
                Remover capa
              </button>
              <button
                className={actionButtonClassName}
                disabled={heroDraft.enabled && heroDraft.image === defaultHeroImage}
                onClick={() => setHeroDraft({ enabled: true, image: defaultHeroImage })}
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
                Usar capa padrao
              </button>
            </div>

            <div className="grid gap-1.5">
              <p className="text-[10px] font-black uppercase text-zinc-500">Ou usar URL da imagem</p>
              <div className="flex gap-2">
                <input
                  className={inputClassName}
                  onChange={(event) => setHeroUrlInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      applyHeroUrl();
                    }
                  }}
                  placeholder="https://..."
                  value={heroUrlInput}
                />
                <button className={actionButtonClassName} disabled={!heroUrlInput.trim()} onClick={applyHeroUrl} type="button">
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className={panelClassName}>
          <div className="border-b border-white/10 p-4">
            <p className="text-sm font-black text-white">Logo da plataforma</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Exibida no topo, no menu lateral e no rodape da area do aluno. PNG ou WebP com fundo transparente, ate 8 MB.
              Sem logo, o nome Bunker707 aparece no lugar.
            </p>
          </div>
          <div className="space-y-4 p-4">
            <div className="flex min-h-24 items-center rounded-[8px] border border-white/10 bg-[#141414] px-5 py-4">
              {logoDraft ? (
                <Image
                  alt="Logo da plataforma"
                  className="h-auto max-h-14 w-auto max-w-[260px] object-contain object-left"
                  height={56}
                  src={logoDraft}
                  unoptimized
                  width={260}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <ImageIcon className="h-6 w-6 text-zinc-600" />
                  <div>
                    <p className="text-lg font-black uppercase tracking-wide text-white">Bunker707</p>
                    <p className="text-[11px] text-zinc-600">Logo removida. O nome da plataforma e exibido como texto.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <label className={`${actionButtonClassName} cursor-pointer`}>
                <Upload className="h-4 w-4" />
                Enviar logo
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    void handleLogoUpload(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
              <button
                className={actionButtonClassName}
                disabled={logoDraft === null}
                onClick={() => setLogoDraft(null)}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
                Remover logo
              </button>
              <button
                className={actionButtonClassName}
                disabled={logoDraft === defaultLogoImage}
                onClick={() => setLogoDraft(defaultLogoImage)}
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
                Usar logo padrao
              </button>
            </div>

            <div className="grid gap-1.5">
              <p className="text-[10px] font-black uppercase text-zinc-500">Ou usar URL da logo</p>
              <div className="flex gap-2">
                <input
                  className={inputClassName}
                  onChange={(event) => setLogoUrlInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      applyLogoUrl();
                    }
                  }}
                  placeholder="https://..."
                  value={logoUrlInput}
                />
                <button className={actionButtonClassName} disabled={!logoUrlInput.trim()} onClick={applyLogoUrl} type="button">
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
