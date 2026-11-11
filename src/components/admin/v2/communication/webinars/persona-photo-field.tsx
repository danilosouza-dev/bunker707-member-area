"use client";

import { ImageUp, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { FreeImageLimits } from "@/server/communications/popup-free-model";
import { PERSONA_AVATAR_LIMITS, personaAvatarUrl } from "@/server/webinars/persona-model";
import type { UploadedPersonaPhoto } from "@/server/webinars/script-actions";

// A Foto (opcional) de quem comenta (adendo de 10/11/2026, R9), no card Roteiro do editor e no "Novo comentário" do
// console: a previa redonda (a foto do nosso bucket, pelo endereco montado com a origem do Supabase), Enviar foto /
// Trocar / Remover (o navegador reduz a 512 px e ate 100.000 bytes em WebP pelo prepareFreeImage do Livre, carregado so
// quando a equipe escolhe a imagem, e envia pelo uploadPersonaPhoto, que devolve so o caminho), a dica do formato, a
// linha do consentimento ("Use imagem gerada ou com autorização...") e, com a foto e o nome, a caixa "Usar esta foto em
// todos os comentários de {nome}" (ligada por padrao; quem usa decide o que ela faz). Nenhuma frase escrita aqui. O
// "enviando" fica com quem usa (`uploading` e `onUploadingChange`): o Salvar do editor e o "Enviar agora" e o "Guardar
// na lista" do console esperam a foto chegar (um envio no meio sairia sem a foto e deixaria o arquivo sem dono).

const COPY = WEBINAR_COPY.naTela.comentarios;

/** Os limites da foto no navegador (o mesmo preparo do Livre, com o lado, o peso e as frases da foto de quem comenta). */
export const PERSONA_PHOTO_PREP: FreeImageLimits = {
  bytes: PERSONA_AVATAR_LIMITS.bytes,
  messages: { sides: COPY.erros.fotoLado, tooLarge: COPY.erros.fotoPesada },
  side: { max: PERSONA_AVATAR_LIMITS.sideMax, min: PERSONA_AVATAR_LIMITS.sideMin }
};

export type PersonaPhotoFieldProps = {
  /** A caixa "Usar esta foto em todos os comentários de {nome}". */
  applyToAll: boolean;
  disabled: boolean;
  idBase: string;
  /** O nome de quem comenta (a caixa so aparece com ele). */
  name: string;
  onApplyToAllChange: (checked: boolean) => void;
  /** A foto nova (o caminho devolvido pelo envio) ou nula (Remover). */
  onChange: (path: string | null) => void;
  /** Envia o WebP preparado no navegador (uploadPersonaPhoto). */
  onUpload: (image: string) => Promise<ActionResult<UploadedPersonaPhoto>>;
  /** A origem do nosso Supabase (o endereco da previa); sem ela, a do ambiente. */
  origin?: string | null;
  /** A foto subindo (o estado e de quem usa: o envio do formulario espera). */
  onUploadingChange: (uploading: boolean) => void;
  /** O caminho da foto de agora (nulo, sem foto). */
  path: string | null;
  uploading: boolean;
};

export function PersonaPhotoField({ applyToAll, disabled, idBase, name, onApplyToAllChange, onChange, onUpload, onUploadingChange, origin, path, uploading }: PersonaPhotoFieldProps) {
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const url = personaAvatarUrl(path, origin === undefined ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? null) : origin);
  const trimmedName = name.trim();
  const labelId = `${idBase}-foto`;

  async function pick(file: File | undefined) {
    if (!file) {
      return;
    }
    onUploadingChange(true);
    setError(null);
    try {
      // O preparo do Livre so carrega quando a equipe escolhe uma imagem.
      const { prepareFreeImage } = await import("@/components/admin/v2/communication/popup-free/free-image-prepare");
      const result = await onUpload(await prepareFreeImage(file, PERSONA_PHOTO_PREP));
      if (!result.ok) {
        setError(result.fieldErrors?.image?.[0] ?? result.error);
        return;
      }
      onChange(result.data.path);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : COPY.erros.fotoFormato);
    } finally {
      onUploadingChange(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-persona-photo="">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={labelId}>
        {COPY.foto}
      </span>
      <div aria-labelledby={labelId} className="flex min-w-0 flex-wrap items-center gap-2" role="group">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a foto de quem comenta, no nosso bucket, pequena e sem otimizacao.
          <img
            alt={trimmedName ? COPY.fotoDe(trimmedName) : COPY.fotoDeQuemComenta}
            className="size-10 shrink-0 rounded-full border border-[var(--border-subtle)] object-cover"
            data-persona-photo-preview=""
            height={40}
            src={url}
            width={40}
          />
        ) : null}
        <Button className="h-8! px-2 text-[13px]" data-persona-photo-send="" disabled={disabled || uploading} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
          {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <ImageUp aria-hidden="true" className="size-4" />}
          {uploading ? COPY.enviandoFoto : path ? COPY.trocarFoto : COPY.enviarFoto}
        </Button>
        {path ? (
          <Button className="h-8! px-2 text-[13px]" data-persona-photo-remove="" disabled={disabled || uploading} onClick={() => onChange(null)} type="button" variant="ghost">
            {COPY.removerFoto}
          </Button>
        ) : null}
        <input
          accept="image/jpeg,image/png,image/webp"
          aria-label={COPY.enviarFoto}
          className="sr-only"
          disabled={disabled || uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void pick(file);
          }}
          ref={fileInput}
          tabIndex={-1}
          type="file"
        />
      </div>
      {uploading ? (
        <p aria-live="polite" className="sr-only" role="status">
          {COPY.enviandoFoto}
        </p>
      ) : null}
      {error ? (
        <p className="text-[13px] leading-5 text-[var(--error)]" data-persona-photo-error="" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs leading-5 text-[var(--text-secondary)]">{COPY.fotoDica}</p>
      )}
      <p className="text-xs leading-5 text-[var(--text-secondary)]" data-persona-photo-consent="">
        {COPY.fotoConsentimento}
      </p>
      {path && trimmedName ? (
        <label className="flex min-w-0 items-start gap-2 text-[13px] leading-5 text-[var(--text-primary)]" htmlFor={`${idBase}-todos`}>
          <input
            checked={applyToAll}
            className="mt-0.5 size-4 shrink-0 accent-[var(--text-primary)]"
            data-persona-photo-all=""
            disabled={disabled || uploading}
            id={`${idBase}-todos`}
            onChange={(event) => onApplyToAllChange(event.target.checked)}
            type="checkbox"
          />
          {COPY.usarEmTodos(trimmedName)}
        </label>
      ) : null}
    </div>
  );
}
